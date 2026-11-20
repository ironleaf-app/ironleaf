// SPDX-License-Identifier: AGPL-3.0-or-later
// node --test tests/linked-files-per-pc.test.mjs — a file linked where it is: its place is this PC's own (security
// review, 20 Nov 2026; src/main/vault-files.ts › LinkedRefs, src/shared/file-records.ts). The vault's .files.json used
// to hold the whole path, and anyone who shares or syncs the vault can write that file: a path naming \\host\share made
// the stat send this PC's sign-in (an NTLM hash) to that host, and Open handed whatever it named to the shell. Now the
// path lives in Ironleaf's own data (per vault), the vault's file keeps only the link's id, a path arriving in the
// vault's file is never followed (this PC's own earlier links are taken over once), shares are refused, and a linked
// file that would run a program is never opened (Show in folder instead). Made-up files in a temp folder.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-linked-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/file-records.ts'))};\nexport { VaultFiles, registerVaultFiles, linkablePath, runsWhenOpened, isNetworkPath } from ${JSON.stringify(path.join(root, 'src/main/vault-files.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'vf.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'vf.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;
function setup() {
  const base = path.join(work, `case-${++n}`);
  const vault = path.join(base, 'Vault');
  const data = path.join(base, 'data');
  mkdirSync(path.join(vault, 'Projects', 'Harbour'), { recursive: true });
  writeFileSync(path.join(vault, 'Projects', 'Harbour', 'Harbour.md'), '---\ntype: project\n---\n# Harbour\n');
  const host = {
    root: () => vault,
    listAll: async () => [],
    notes: () => [],
    resolve: () => null,
    readNote: async () => '',
    movePath: async (from, to) => ({ path: to, linksUpdated: 0 }),
    added: async () => {},
    dataDir: data,
    readText: async () => ({ state: 'none' }),
    prefs: () => ({ attachmentsFolder: 'Attachments', filesWithRecord: true }),
  };
  const outside = path.join(base, 'PC');
  mkdirSync(outside, { recursive: true });
  return { base, vault, data, host, outside, side: path.join(vault, 'Projects', 'Harbour', 'Files', '.files.json') };
}
const RECORD = 'Projects/Harbour/Harbour.md';
const FOLDER = 'Projects/Harbour/Files';

test('a link’s place is kept on this PC: the vault’s file has its id only, and this PC reads it back', async () => {
  const c = setup();
  const file = path.join(c.outside, 'Survey.txt');
  writeFileSync(file, 'Survey of the rooms.\n');
  const vf = new M.VaultFiles(c.host);
  const r = await vf.reference({ record: RECORD, path: file });
  const side = readFileSync(c.side, 'utf8');
  // (Where it came from stays in its source words, as for any file: words, never followed.)
  assert.equal(side.replace(/"from": "[^"]*"/, '').includes(JSON.stringify(file).slice(1, -1)), false, 'no path in the vault’s file');
  const entry = Object.values(JSON.parse(side).files)[0];
  assert.equal(entry.ref.path, undefined);
  assert.match(entry.ref.id, /^[A-Za-z0-9_-]{8,40}$/);
  const kept = JSON.parse(readFileSync(path.join(c.data, 'linked-files.json'), 'utf8'));
  assert.deepEqual(Object.values(kept.vaults).map((v) => v.links[entry.ref.id].path), [file], 'kept in Ironleaf’s own data, by vault');
  // Another start of Ironleaf on this PC finds it.
  const again = new M.VaultFiles(c.host);
  assert.equal(await again.referencePath(r.folder, r.name), file);
  assert.equal((await again.catalogue()).find((x) => x.ref).ref.missing, false);
  // Another PC (no record of this link) knows it is linked, not where.
  const other = new M.VaultFiles({ ...c.host, dataDir: path.join(c.base, 'other-pc') });
  await assert.rejects(() => other.referencePath(r.folder, r.name), /linked on another PC/);
  assert.equal((await other.catalogue()).find((x) => x.ref).ref.missing, true);
  // Forgotten: gone from this PC's record too.
  await again.forgetReference(r.folder, r.name);
  const after1 = JSON.parse(readFileSync(path.join(c.data, 'linked-files.json'), 'utf8'));
  assert.deepEqual(Object.values(after1.vaults).flatMap((v) => Object.keys(v.links)), []);
});

test('a path that arrives in the vault’s file is never followed (a share, a program, anything)', async () => {
  const c = setup();
  const vf = new M.VaultFiles(c.host);
  // This PC has read the vault once already (nothing linked then): its links are its own from now on.
  const first = path.join(c.outside, 'Mine.txt');
  writeFileSync(first, 'mine');
  await vf.reference({ record: RECORD, path: first });
  // Someone with the vault (shared, synced) writes links into its file.
  const planted = JSON.parse(readFileSync(c.side, 'utf8'));
  const calc = path.join(c.outside, 'calc.txt');
  writeFileSync(calc, 'x');
  for (const [name, p] of [['Report.pdf', '\\\\evil.example\\share\\Report.pdf'], ['Notes.txt', calc], ['Again.txt', '//evil.example/share/a.txt']]) {
    planted.files[name] = { name, version: 1, versions: [], record: RECORD, ref: { path: p, size: 1, mtime: 1 } };
  }
  writeFileSync(c.side, JSON.stringify(planted));
  const s = await vf.readSidecar(FOLDER);
  for (const name of ['Report.pdf', 'Notes.txt', 'Again.txt']) {
    assert.equal(M.entryOf(s, name).ref.path, '', `${name}: not followed`);
    await assert.rejects(() => vf.referencePath(FOLDER, name), /linked on another PC/);
  }
  assert.equal(M.entryOf(s, 'Mine.txt').ref.path, first, 'this PC’s own link still works');
  // parseSidecar never takes a path from the file at all.
  assert.equal(M.parseSidecar(JSON.stringify(planted)).files['report.pdf'].ref.path, '');
});

test('links an earlier version wrote into this PC’s vault are taken over once (never a share)', async () => {
  const c = setup();
  const mine = path.join(c.outside, 'Plan.xlsx');
  writeFileSync(mine, 'plan');
  mkdirSync(path.dirname(c.side), { recursive: true });
  writeFileSync(
    c.side,
    JSON.stringify({ version: 1, files: { 'Plan.xlsx': { name: 'Plan.xlsx', version: 1, versions: [], record: RECORD, ref: { path: mine, size: 4, mtime: 1 } }, 'Share.pdf': { name: 'Share.pdf', version: 1, versions: [], record: RECORD, ref: { path: '\\\\nas\\team\\Share.pdf', size: 4, mtime: 1 } } } }),
  );
  const vf = new M.VaultFiles(c.host);
  assert.equal(await vf.referencePath(FOLDER, 'Plan.xlsx'), mine, 'its own earlier link');
  await assert.rejects(() => vf.referencePath(FOLDER, 'Share.pdf'), /another PC/, 'a share is never taken over');
  // After the first read, a new old-style path is not taken over.
  const later = JSON.parse(readFileSync(c.side, 'utf8'));
  const sneaky = path.join(c.outside, 'Sneaky.txt');
  writeFileSync(sneaky, 's');
  later.files['Sneaky.txt'] = { name: 'Sneaky.txt', version: 1, versions: [], record: RECORD, ref: { path: sneaky, size: 1, mtime: 1 } };
  writeFileSync(c.side, JSON.stringify(later));
  await assert.rejects(() => new M.VaultFiles(c.host).referencePath(FOLDER, 'Sneaky.txt'), /another PC/);
  // The next change to that folder moves the taken-over link into this PC's record and out of the vault's file.
  await vf.changeSidecar(FOLDER, () => {});
  const side = JSON.parse(readFileSync(c.side, 'utf8'));
  assert.equal(side.files['Plan.xlsx'].ref.path, undefined);
  assert.equal(await new M.VaultFiles(c.host).referencePath(FOLDER, 'Plan.xlsx'), mine);
});

test('a share or a device path is never linked (or even looked at)', async () => {
  const c = setup();
  const vf = new M.VaultFiles(c.host);
  for (const p of ['\\\\evil.example\\share\\x.pdf', '//evil.example/share/x.pdf', '\\\\?\\C:\\x.pdf', '\\\\.\\pipe\\x']) {
    await assert.rejects(() => vf.reference({ record: RECORD, path: p }), /whole path|Only a file on this PC/, p);
  }
  // A link on this PC that leads to a share is refused too.
  assert.equal(M.linkablePath('/home/o/x.pdf', 'linux'), true);
  assert.equal(M.linkablePath('C:\\Users\\o\\x.pdf', 'win32'), true);
  for (const [p, os] of [['\\\\host\\s\\x', 'win32'], ['//host/s/x', 'win32'], ['\\\\?\\C:\\x', 'win32'], ['relative.pdf', 'win32'], ['/no-drive.pdf', 'win32'], ['//host/x', 'linux']]) assert.equal(M.linkablePath(p, os), false, p);
});

test('a linked file that would run a program is never opened: Show in folder instead', async () => {
  const c = setup();
  const vf = new M.VaultFiles(c.host);
  const script = path.join(c.outside, 'deploy.sh');
  writeFileSync(script, '#!/bin/sh\necho hi\n');
  const plain = path.join(c.outside, 'Readme.txt');
  writeFileSync(plain, 'words');
  const marked = path.join(c.outside, 'tool');
  writeFileSync(marked, 'x');
  chmodSync(marked, 0o755);
  for (const f of [script, plain, marked]) await vf.reference({ record: RECORD, path: f });
  const handlers = new Map();
  const opened = [];
  const shown = [];
  M.registerVaultFiles(vf, { handle: (ch, fn) => handlers.set(ch, fn), requireCreate: async () => {}, chooseFiles: async () => null, openPath: async (p) => void opened.push(p), showInFolder: (p) => void shown.push(p) });
  await assert.rejects(() => handlers.get('vfiles:open-ref')(FOLDER, 'deploy.sh'), /runs a program when it is opened.*Show in folder/);
  if (process.platform !== 'win32') await assert.rejects(() => handlers.get('vfiles:open-ref')(FOLDER, 'tool'), /runs a program/);
  await handlers.get('vfiles:open-ref')(FOLDER, 'Readme.txt');
  assert.deepEqual(opened, [plain], 'only the plain file reaches the shell');
  await handlers.get('vfiles:show-ref')(FOLDER, 'deploy.sh');
  assert.deepEqual(shown, [script], 'shown in its folder');
  for (const p of ['a.exe', 'B.BAT', 'c.cmd', 'd.com', 'e.scr', 'f.ps1', 'g.vbs', 'h.js', 'i.jar', 'j.msi', 'k.lnk', 'l.AppImage', 'm.sh', 'n.desktop', 'o.hta', 'p.reg']) assert.equal(M.runsWhenOpened(p, 0o644, 'win32'), true, p);
  for (const p of ['a.pdf', 'b.docx', 'c.png', 'd.txt']) assert.equal(M.runsWhenOpened(p, 0o644, 'linux'), false, p);
  assert.equal(M.runsWhenOpened('tool', 0o755, 'linux'), true);
  assert.equal(M.runsWhenOpened('tool', 0o755, 'win32'), false);
});
