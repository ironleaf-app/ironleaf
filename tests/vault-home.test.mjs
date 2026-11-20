// node --test tests/vault-home.test.mjs — One standard home for vaults (src/main/vault-home.ts, src/shared/vault-home.ts,
// src/shared/vault-merge.ts, src/main/zip.ts; 23 Oct 2026: the desktop opened a second, local vault while a laptop,
// the former host app and a chat bot used the synced one). Made-up PCs in temporary folders, never anyone's real vault:
// Windows' Documents moved into OneDrive, Google Drive's backed-up computers, Dropbox's backups; a vault's identity
// written once and recognised at another path; the warning rule; the person's PCs as the former host app gives them;
// Export vault → Import vault round trip byte for byte; merges that lose nothing (and change nothing the second time);
// another app's export.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipFolder } from './zip-folder.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-home-'));
let H, S, M, Z, V;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const electron = { name: 'electron-stand-in', resolveId: (id) => (id === 'electron' ? '\0electron' : null), load: (id) => (id === '\0electron' ? 'export const shell = { trashItem: async () => {} }; export const app = { getPath: () => "" };' : null) };
  const one = async (input, file) => {
    await build({ input: path.join(root, input), platform: 'node', plugins: [electron], output: { file: path.join(work, file), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, file)).href);
  };
  H = await one('src/main/vault-home.ts', 'home.mjs');
  S = await one('src/shared/vault-home.ts', 'shared.mjs');
  M = await one('src/shared/vault-merge.ts', 'merge.mjs');
  Z = await one('src/main/zip.ts', 'zip.mjs');
  V = await one('src/main/vault.ts', 'vault.mjs');
});
after(() => rmSync(work, { recursive: true, force: true }));

const put = (abs, data) => {
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
};
const deps = { path, platform: process.platform };
/** Every file under a folder with its SHA-256. */
function hashes(dir, skip = () => false) {
  const out = {};
  const walk = (rel) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip(r)) continue;
      if (e.isDirectory()) walk(r);
      else out[r] = createHash('sha256').update(readFileSync(path.join(dir, r))).digest('hex');
    }
  };
  walk('');
  return out;
}
/** A lived-in vault: notes, a project, a picture, an asset, Ironleaf's own hidden folder. */
function livedIn(dir, notes = 6) {
  for (let i = 1; i <= notes; i++) put(path.join(dir, 'Notes', `Call ${i}.md`), `# Call ${i}\n\nAgreed the tiling order.\n`);
  put(path.join(dir, 'Projects', 'Kitchen Refit', 'Kitchen Refit.md'), '---\ntype: project\nstatus: active\nowner: Sam Lee\n---\n# Kitchen Refit\n\n## Summary\n\nNew benches by March.\n');
  put(path.join(dir, 'Attachments', 'bench.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]));
  put(path.join(dir, 'Assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
}

// ── A vault's identity ────────────────────────────────────────────────────────────────────────────────────────────
test('a vault’s identity is written once, and the same vault is recognised at another path', async () => {
  const a = path.join(work, 'id', 'PC1', 'OneDrive', 'Documents', 'Ironleaf');
  livedIn(a, 2);
  assert.equal(await H.readIdentity(a), null);
  const first = await H.ensureIdentity(a);
  assert.match(first.id, /^[0-9a-f-]{36}$/);
  assert.equal(first.name, 'Ironleaf');
  assert.ok(!Number.isNaN(Date.parse(first.created)));
  const again = await H.ensureIdentity(a, 'Another name');
  assert.deepEqual(again, first, 'never written over');
  // The same folder synced to a second PC under another user's folder: the same identity.
  const b = path.join(work, 'id', 'PC2', 'OneDrive - Tessaly', 'Documents', 'Ironleaf');
  cpSync(a, b, { recursive: true });
  const there = await H.readIdentity(b);
  assert.equal(there.id, first.id);
  assert.ok(S.sameVault({ id: first.id, path: a }, { id: there.id, path: b }));
  assert.ok(!S.sameVault({ id: first.id, path: a }, { id: 'other-id-1234', path: a }), 'an identity outweighs a path');
  // A broken file isn't an identity.
  const c = path.join(work, 'id', 'broken');
  put(path.join(c, '.neuralvault', 'vault.json'), '{nope');
  assert.equal(await H.readIdentity(c), null);
  assert.equal(H.cleanIdentity({ id: '../../x', name: 'x' }), null);
});

// ── The vaults on a PC ──────────────────────────────────────────────────────────────────────────────────────────────
function aPc(name) {
  const home = path.join(work, name, 'Users', 'mia');
  const oneDrive = path.join(home, 'OneDrive');
  const documents = path.join(oneDrive, 'Documents'); // Windows' Documents, moved into OneDrive
  const gMount = path.join(work, name, 'G');
  const myDrive = path.join(gMount, 'My Drive');
  const dropbox = path.join(home, 'Dropbox');
  for (const d of [documents, myDrive, dropbox]) mkdirSync(d, { recursive: true });
  const places = { roots: [{ service: 'onedrive', path: oneDrive, name: 'OneDrive' }, { service: 'gdrive', path: myDrive, name: 'Google Drive' }, { service: 'dropbox', path: dropbox, name: 'Dropbox' }], network: [] };
  return { home, oneDrive, documents, gMount, myDrive, dropbox, places };
}

test('a new PC finds vaults in redirected Documents, OneDrive, Google Drive (and its backed-up computers) and Dropbox backups', async () => {
  const pc = aPc('finder');
  const main = path.join(pc.documents, 'Ironleaf');
  livedIn(main, 9);
  await H.ensureIdentity(main);
  // An extra vault inside the home, a vault of its own.
  const work2 = path.join(main, 'Work');
  livedIn(work2, 3);
  await H.ensureIdentity(work2, 'Work');
  // Google Drive's backup of another PC's Documents; Dropbox Backup's copy of a laptop's Documents.
  const gBackup = path.join(pc.gMount, 'Other computers', 'Office-PC', 'Documents', 'Ironleaf');
  livedIn(gBackup, 4);
  const dBackup = path.join(pc.dropbox, 'My PC (LAPTOP-7)', 'Documents', 'Ironleaf');
  livedIn(dBackup, 2);
  // A folder that isn't a vault, and an empty Ironleaf folder: neither found.
  mkdirSync(path.join(pc.myDrive, 'Ironleaf'), { recursive: true });
  put(path.join(pc.dropbox, 'Ironleaf', 'readme.txt'), 'hello');

  const spots = await H.homeSpots(pc.documents, pc.places, deps);
  assert.equal(spots[0].path, main, 'Documents\\Ironleaf first');
  assert.equal(spots[0].kind, 'onedrive', 'the home is in OneDrive (Documents moved there)');
  const found = await H.findHomeVaults(spots, { timeoutMs: 5000 });
  const byPath = Object.fromEntries(found.map((f) => [f.path, f]));
  assert.ok(byPath[main], 'the main vault');
  assert.equal(byPath[main].notes, 10, 'its own notes, not Work’s (9 calls + the project)');
  assert.ok(byPath[work2], 'the extra vault inside the home');
  assert.equal(byPath[work2].vaultName, 'Work');
  assert.equal(byPath[work2].notes, 4);
  assert.ok(byPath[gBackup], 'Google Drive’s backed-up computer');
  assert.match(byPath[gBackup].name, /Other computers › Office-PC/);
  assert.ok(byPath[dBackup], 'Dropbox Backup');
  assert.equal(found.length, 4, found.map((f) => f.path).join('\n'));
  assert.equal(H.pickFirst(found, main).path, main, 'a new PC opens the one with the most notes');
});

test('a home holding only extra vaults: each folder of notes in it is a vault', async () => {
  const pc = aPc('extras');
  const home = path.join(pc.documents, 'Ironleaf');
  livedIn(path.join(home, 'Club'), 2);
  livedIn(path.join(home, 'Family'), 5);
  const found = await H.findHomeVaults(await H.homeSpots(pc.documents, { roots: [], network: [] }, deps));
  assert.deepEqual(found.map((f) => path.basename(f.path)).sort(), ['Club', 'Family']);
  assert.equal(H.pickFirst(found, home).vaultName, 'Family');
});

test('nothing found on a new PC: no vault is picked (the new, empty one is made)', async () => {
  const pc = aPc('nothing');
  const found = await H.findHomeVaults(await H.homeSpots(pc.documents, pc.places, deps));
  assert.deepEqual(found, []);
  assert.equal(H.pickFirst(found, path.join(pc.documents, 'Ironleaf')), null);
});

test('a vault inside another (with its own identity) is kept out of that vault’s notes', async () => {
  const main = path.join(work, 'nested', 'Ironleaf');
  livedIn(main, 2);
  const inner = path.join(main, 'Work');
  livedIn(inner, 3);
  put(path.join(main, 'Plain folder', 'Idea.md'), '# Idea\n');
  await H.ensureIdentity(inner, 'Work');
  const v = await V.Vault.open(main);
  const all = await v.listAll();
  assert.ok(!all.files.some((f) => f.rel.startsWith('Work/')), 'no file of Work');
  assert.ok(!all.folders.includes('Work'), 'Work isn’t a folder of this vault');
  assert.ok(all.files.some((f) => f.rel === 'Plain folder/Idea.md'), 'an ordinary folder still is');
  assert.equal(v.isIgnored('Work/Notes/Call 1.md'), true);
  assert.throws(() => v.resolve('Work/Notes/new.md'), /reserved/);
  const md = await v.listMarkdown();
  assert.ok(!md.some((f) => f.rel.startsWith('Work/')));
  v.close();
});

// ── Where a vault goes, and the warning ─────────────────────────────────────────────────────────────────────────────
test('a move into Documents\\Ironleaf: the home itself when it holds no vault, else a folder in it', () => {
  const home = path.join('/u', 'OneDrive', 'Documents', 'Ironleaf');
  assert.equal(S.moveTargetIn(home, '/u/Documents/Work', true, path), path.join(home, 'Work'));
  assert.equal(S.moveTargetIn(home, '/u/Documents/Work', false, path), home);
  assert.equal(S.moveTargetIn(home, home, true, path), null);
  assert.equal(S.moveTargetIn(home, path.join(home, 'Club'), true, path), null);
});

const local = { kind: 'local', name: 'this PC', words: '' };
const synced = { kind: 'onedrive', name: 'OneDrive', words: '', root: '/x' };
const now = Date.parse('2026-10-23T10:00:00Z');
const laptop = (vault, seen = now - 3600e3) => ({ id: 'pc-lap', name: 'Laptop', me: false, online: false, lastSeen: seen, vault });
const me = { id: 'pc-desk', name: 'Office-PC', me: true, online: true, lastSeen: now, vault: null };
const shared = { id: 'vault-shared-1', name: 'Ironleaf', place: 'onedrive', placeName: 'OneDrive' };

test('the warning: only on this PC while another PC has another vault open', () => {
  const current = { path: '/u/Documents/Work', id: 'vault-work-22', name: 'Work' };
  const vaults = [{ path: current.path, id: current.id, name: 'Work' }, { path: '/u/OneDrive/Documents/Ironleaf', id: 'vault-shared-1', name: 'Ironleaf' }];
  const w = S.homeWarning({ place: local, current, pcs: [me, laptop(shared)], now, vaults, moveTo: '/u/OneDrive/Documents/Ironleaf/Work', homeLabel: 'Documents\\Ironleaf' });
  assert.ok(w);
  assert.equal(w.title, 'Your PCs have different vaults open');
  assert.match(w.words, /Laptop has “Ironleaf”, synced with OneDrive open\. This one, “Work”, is only on this PC/);
  assert.match(w.words, /“Ironleaf” is on this PC too/);
  assert.match(w.words, /Move it to Documents\\Ironleaf/);
  assert.deepEqual(w.openHere, { path: '/u/OneDrive/Documents/Ironleaf', name: 'Ironleaf' });
  assert.equal(w.moveTo, '/u/OneDrive/Documents/Ironleaf/Work');
  assert.deepEqual(w.others, [{ pc: 'Laptop', vault: 'Ironleaf', placeName: 'OneDrive' }]);
  // The vault they use isn't on this PC: no Open, still the move.
  const w2 = S.homeWarning({ place: local, current, pcs: [me, laptop(shared)], now, vaults: vaults.slice(0, 1), moveTo: '/m', homeLabel: 'Documents\\Ironleaf' });
  assert.equal(w2.openHere, null);
  assert.doesNotMatch(w2.words, /on this PC too/);
});

test('no warning: synced, the same vault everywhere, no other PC known, or the other PC long gone', () => {
  const current = { path: '/u/Documents/Work', id: 'vault-work-22', name: 'Work' };
  const base = { current, now, vaults: [], moveTo: null, homeLabel: 'Documents\\Ironleaf' };
  assert.equal(S.homeWarning({ ...base, place: synced, pcs: [me, laptop(shared)] }), null, 'synced');
  assert.equal(S.homeWarning({ ...base, place: local, pcs: [me, laptop({ ...shared, id: 'vault-work-22' })] }), null, 'the same vault (by identity, whatever its path)');
  assert.equal(S.homeWarning({ ...base, place: local, pcs: null }), null, 'other PCs not known');
  assert.equal(S.homeWarning({ ...base, place: local, pcs: [me] }), null, 'no other PC');
  assert.equal(S.homeWarning({ ...base, place: local, pcs: [me, laptop(shared, now - 90 * 864e5)] }), null, 'not seen for 90 days');
  assert.equal(S.homeWarning({ ...base, place: local, pcs: [me, laptop(null)] }), null, 'its vault not known');
  assert.equal(S.homeWarning({ ...base, place: { kind: 'network', name: 'a network drive', words: '' }, pcs: [me, laptop(shared)] }), null, 'a network drive every PC reaches');
});

test('the person’s PCs as the host app gives them are checked', () => {
  const pcs = H.cleanPcs({
    computers: [
      { id: 'a1', name: 'Office-PC', me: true, online: true, lastSeen: now, vault: { id: 'v1', name: 'Ironleaf', path: 'C:\\Users\\mia\\OneDrive\\Documents\\Ironleaf', place: 'onedrive', placeName: 'OneDrive' } },
      { id: 'b2', name: 'Laptop\u0007', online: false, lastSeen: 'soon', vault: { name: 'Work', place: 'weird' } },
      { name: 'no id' },
      'junk',
    ],
  });
  assert.equal(pcs.length, 2);
  assert.equal(pcs[0].vault.placeName, 'OneDrive');
  assert.equal(pcs[1].name, 'Laptop');
  assert.equal(pcs[1].lastSeen, null);
  assert.deepEqual(pcs[1].vault, { id: null, name: 'Work', place: 'local', placeName: 'this PC' });
  assert.equal(H.cleanPcs(null), null);
  assert.equal(H.cleanPcs({ nope: 1 }), null);
});

// ── Export and import ───────────────────────────────────────────────────────────────────────────────────────────────
test('Export vault → Import vault into a new vault on another PC: every file the same, its identity and settings taken', async () => {
  const a = path.join(work, 'rt', 'PC1', 'Ironleaf');
  livedIn(a, 5);
  put(path.join(a, '.neuralvault', 'views', 'board.json'), '{"kept":true}');
  put(path.join(a, 'Big', 'scan.pdf'), Buffer.alloc(300_000, 7));
  put(path.join(a, 'Empty.md'), '');
  put(path.join(a, 'Ünïcode — notes', 'Café.md'), '# Café\n\nFlat white.\n');
  const id = await H.ensureIdentity(a);
  // A vault of its own inside isn't part of this one's export.
  livedIn(path.join(a, 'Work'), 1);
  await H.ensureIdentity(path.join(a, 'Work'), 'Work');
  const zip = path.join(work, 'rt', 'Ironleaf export.zip');
  const done = await H.exportVault(a, zip, { settings: { prefs: { palette: 'sand' }, dailyFolder: 'Days' }, library: { 'workspace.json': '{"tabs":["Notes/Call 1.md"]}' }, identity: id, version: '6.3.0' });
  assert.ok(existsSync(zip));
  assert.match(done.words, /Import vault/);
  // Any zip program reads it.
  const listing = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(listing.includes('Ünïcode — notes/Café.md'));
  assert.ok(listing.includes('.neuralvault/export/export.json'));
  assert.ok(!listing.some((n) => n.startsWith('Work/')), 'the vault inside wasn’t exported');
  execFileSync('unzip', ['-tq', zip]);

  const b = path.join(work, 'rt', 'PC2', 'Ironleaf');
  mkdirSync(b, { recursive: true });
  const src = await H.readImport(zip, b, { tempDir: path.join(work, 'rt', 'temp') });
  assert.equal(src.plan.kind, 'vault');
  assert.equal(src.plan.sourceName, 'Ironleaf');
  assert.equal(src.plan.into, '');
  let applied = null;
  const summary = await H.importInto(b, src, { targetIsNew: true, applySettings: async (s, lib) => (applied = { s, lib }) });
  await src.done();
  assert.equal(summary.settings, 'applied');
  assert.deepEqual(applied.s.prefs, { palette: 'sand' });
  assert.equal(applied.lib['workspace.json'], '{"tabs":["Notes/Call 1.md"]}');
  assert.equal(summary.merged.length, 0);
  assert.equal(summary.keptApart.length, 0);
  const skipExport = (r) => r.startsWith('.neuralvault/export') || r.startsWith('Work') || r.startsWith('.neuralvault/import-batches');
  assert.deepEqual(hashes(b, skipExport), hashes(a, skipExport), 'byte for byte');
  assert.equal((await H.readIdentity(b)).id, id.id, 'the same vault, recognised on the second PC');
  assert.ok(!existsSync(path.join(work, 'rt', 'temp', readdirSync(path.join(work, 'rt', 'temp'))[0] ?? 'none')), 'the unpacked copy is gone');
});

test('importing into a vault already in use: identical once, differing notes combined keeping every line, pictures kept apart, nothing renamed, the second time nothing changes', async () => {
  const mine = path.join(work, 'merge', 'Laptop', 'Ironleaf');
  const theirs = path.join(work, 'merge', 'Office-PC', 'Work');
  livedIn(mine, 3);
  livedIn(theirs, 3);
  const myId = await H.ensureIdentity(mine);
  await H.ensureIdentity(theirs, 'Work');
  // The same note, changed differently on each PC.
  const hub = '---\nstatus: active\nowner: Sam Lee\n---\n# Desk Hub\n\n## Actions\n\n- [ ] Order tiles — Sam\n- [ ] Book plumber\n\n## Notes\n\nQuote from Tessaly due Friday.\n';
  const hubThere = '---\nstatus: on hold\nowner: Sam Lee\npriority: high\n---\n# Desk Hub\n\n## Actions\n\n- [ ] Order tiles — Sam\n- [x] Ring Darcy about the bench\n\n## Decisions\n\n- Go with the oak benchtop\n\n## Notes\n\nQuote from Tessaly due Friday.\nTessaly said 3 weeks lead time.\n';
  put(path.join(mine, 'Desk Hub.md'), hub);
  put(path.join(theirs, 'Desk Hub.md'), hubThere);
  // A picture that differs; a note only there; a Git backup's record (never brought in).
  put(path.join(theirs, 'Attachments', 'bench.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]));
  put(path.join(theirs, 'Meetings', 'Tessaly 21 Oct.md'), '# Tessaly 21 Oct\n\n- Lead time 3 weeks\n');
  put(path.join(theirs, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const before = hashes(mine);
  const kept = [];
  const src = await H.readImport(theirs, mine, { tempDir: path.join(work, 'merge', 'temp') });
  assert.equal(src.plan.kind, 'vault');
  assert.equal(src.plan.sourceName, 'Work');
  const s = await H.importInto(mine, src, { targetIsNew: false, day: '23 Oct 2026', beforeChange: (rel, text) => kept.push([rel, text]) });
  assert.deepEqual(s.merged, ['Desk Hub.md']);
  assert.deepEqual(kept, [['Desk Hub.md', hub]], 'the note here kept for recovery first');
  assert.deepEqual(s.keptApart, [{ rel: 'Attachments/bench.png', at: 'Merged from Work/Attachments/bench.png' }]);
  assert.equal(s.added, 1, 'the meeting note');
  assert.equal(s.identical, 5, 'three calls, the project and the logo');
  // Said once per folder now (5 Nov 2026, u3 moving-in: the walk skips `.git` wholesale, so the summary names the
  // folder instead of every object file — the same history staying behind, without 10,000 skipped lines).
  assert.ok(s.skipped.some((x) => x.rel === '.git'));
  assert.equal(s.settings, null);
  assert.match(s.words, /Nothing was renamed or lost\./);
  const merged = readFileSync(path.join(mine, 'Desk Hub.md'), 'utf8');
  assert.ok(merged.startsWith(hub.replace(/\n+$/, '').split('\n## Notes')[0].replace('owner: Sam Lee', 'owner: Sam Lee\npriority: high')), merged);
  assert.match(merged, /## Merged from Work \(23 Oct 2026\)/);
  assert.match(merged, /- status: on hold/, 'the other value of a property is noted');
  assert.match(merged, /### Actions\n\n- \[x\] Ring Darcy about the bench/);
  assert.match(merged, /### Decisions\n\n- Go with the oak benchtop/);
  assert.match(merged, /### Notes\n\nTessaly said 3 weeks lead time\./);
  assert.ok(M.keepsEveryLine(merged, hubThere), 'every line of the other copy is there');
  assert.ok(M.keepsEveryLine(merged, hub), 'and every line of this one');
  // The picture here untouched, theirs beside it under the same name.
  assert.equal(readFileSync(path.join(mine, 'Attachments', 'bench.png')).length, 12);
  assert.equal(readFileSync(path.join(mine, 'Merged from Work', 'Attachments', 'bench.png')).length, 7);
  assert.equal((await H.readIdentity(mine)).id, myId.id, 'this vault keeps its own identity');
  for (const [rel, h] of Object.entries(before)) if (rel !== 'Desk Hub.md') assert.equal(hashes(mine)[rel], h, `${rel} untouched`);
  await src.done();
  // Again: nothing changes.
  const snap = hashes(mine);
  const src2 = await H.readImport(theirs, mine, { tempDir: path.join(work, 'merge', 'temp') });
  const s2 = await H.importInto(mine, src2, { targetIsNew: false, day: '24 Oct 2026' });
  assert.equal(s2.added, 0);
  assert.deepEqual(s2.merged, []);
  assert.deepEqual(s2.keptApart, []);
  assert.deepEqual(hashes(mine), snap);
  assert.match(s2.words, /Nothing new from Work/);
});

test('merging notes: losslessness on awkward notes', () => {
  const cases = [
    ['# A\n\nOne\n', '# A\n\nOne\nTwo\n'],
    ['No heading\n', '---\ntags: [a, b]\n---\nNo heading\nAnd more\n'],
    ['---\ntags:\n  - a\n---\n# T\n', '---\ntags:\n  - b\n---\n# T\n\n## New part\n\nText\n\n- list\n  - nested\n'],
    ['# CRLF\r\n\r\nLine\r\n', '# CRLF\n\nLine\nOther\n'],
    ['', '# Was empty here\n\nWords.\n'],
  ];
  for (const [here, other] of cases) {
    const m = M.mergeNote(here, other, 'Laptop', '23 Oct 2026');
    assert.ok(m.changed);
    assert.ok(M.keepsEveryLine(m.text, other), `${JSON.stringify(other)} → ${JSON.stringify(m.text)}`);
    assert.ok(M.keepsEveryLine(m.text, here));
    assert.equal(M.mergeNote(m.text, other, 'Laptop', '24 Oct 2026').changed, false, 'merging again changes nothing');
  }
  assert.ok(/\r\n/.test(M.mergeNote(cases[3][0], cases[3][1], 'X', 'd').text), 'Windows line ends kept');
  assert.equal(M.mergeNote('# Same\n', '# Same\r\n\n', 'X', 'd').changed, false, 'the same words');
});

test('notes from another app: Markdown, HTML and CSV exports become notes in a folder of their own', async () => {
  const exp = path.join(work, 'apps', 'Evernote export');
  put(path.join(exp, 'Trip plan.html'), '<!doctype html><html><head><title>Trip plan</title><style>p{color:red}</style></head><body><h2>Flights</h2><p>Qantas <b>QF1</b> on <i>Friday</i>, see <a href="https://example.com/booking">booking</a>.</p><ul><li>Passport</li><li>Adapter<ul><li>UK plug</li></ul></li></ul><div><input type="checkbox" checked> Pack bags</div><p>Tom &amp; Ana&nbsp;both</p><img src="Trip plan_files/map.png" alt="Map"><table><tr><th>Day</th><th>Where</th></tr><tr><td>Mon</td><td>London</td></tr></table></body></html>');
  put(path.join(exp, 'Trip plan_files', 'map.png'), Buffer.from([1, 2, 3]));
  put(path.join(exp, 'Contacts.csv'), 'Name,Phone,Notes\nAna,0400 000 000,"Likes tea, not coffee"\nTom,0411 111 111,\n');
  put(path.join(exp, 'Plain.md'), '# Plain\n\nAlready Markdown.\n');
  const vault = path.join(work, 'apps', 'Ironleaf');
  livedIn(vault, 1);
  const src = await H.readImport(exp, vault, { tempDir: path.join(work, 'apps', 'temp') });
  assert.equal(src.plan.kind, 'notes');
  assert.equal(src.plan.into, 'Evernote export');
  const s = await H.importInto(vault, src, { targetIsNew: false });
  assert.equal(s.converted, 2);
  assert.equal(s.into, 'Evernote export');
  const trip = readFileSync(path.join(vault, 'Evernote export', 'Trip plan.md'), 'utf8');
  assert.match(trip, /^# Trip plan\n/);
  assert.match(trip, /## Flights/);
  assert.match(trip, /Qantas \*\*QF1\*\* on \*Friday\*, see \[booking\]\(https:\/\/example\.com\/booking\)\./);
  assert.match(trip, /- Passport\n- Adapter\n {2}- UK plug/);
  assert.match(trip, /\[x\] Pack bags/);
  assert.match(trip, /Tom & Ana both/);
  assert.match(trip, /!\[Map\]\(Trip%20plan_files\/map\.png\)/);
  assert.match(trip, /\| Day \| Where \|\n\| --- \| --- \|\n\| Mon \| London \|/);
  assert.doesNotMatch(trip, /color:red/);
  assert.ok(existsSync(path.join(vault, 'Evernote export', 'Trip plan.html')), 'the original kept beside it');
  assert.ok(existsSync(path.join(vault, 'Evernote export', 'Trip plan_files', 'map.png')));
  const contacts = readFileSync(path.join(vault, 'Evernote export', 'Contacts.md'), 'utf8');
  assert.match(contacts, /^# Contacts\n\n\| Name \| Phone \| Notes \|\n\| --- \| --- \| --- \|\n\| Ana \| 0400 000 000 \| Likes tea, not coffee \|/);
  assert.equal(readFileSync(path.join(vault, 'Evernote export', 'Plain.md'), 'utf8'), '# Plain\n\nAlready Markdown.\n');
});

test('a zip of one folder (as Windows’ Send to › Compressed folder makes it) imports that folder; a name climbing out is never written', async () => {
  const d = path.join(work, 'zips');
  put(path.join(d, 'src', 'Club notes', 'Minutes.md'), '# Minutes\n');
  zipFolder(path.join(d, 'club.zip'), path.join(d, 'src', 'Club notes'));
  const vault = path.join(d, 'Ironleaf');
  livedIn(vault, 1);
  const src = await H.readImport(path.join(d, 'club.zip'), vault, { tempDir: path.join(d, 'temp') });
  assert.equal(src.plan.kind, 'notes');
  assert.equal(src.plan.into, 'club');
  const s = await H.importInto(vault, src, { targetIsNew: false });
  await src.done();
  assert.equal(s.added, 1);
  assert.ok(existsSync(path.join(vault, 'club', 'Minutes.md')));
  // A zip with "../evil.md" in it.
  await Z.writeZip(path.join(d, 'evil.zip'), [{ name: '../evil.md', data: Buffer.from('x') }, { name: 'ok/fine.md', data: Buffer.from('# Fine\n') }]);
  const out = path.join(d, 'out');
  const r = await Z.extractZip(path.join(d, 'evil.zip'), out);
  assert.deepEqual(r.files, ['ok/fine.md']);
  assert.equal(r.skipped[0].rel, '../evil.md');
  assert.ok(!existsSync(path.join(d, 'evil.md')));
  assert.equal(Z.safeEntryName('C:/Windows/x'), null);
  assert.equal(Z.safeEntryName('a/./b'), null);
  await assert.rejects(H.readImport(path.join(d, 'src', 'Club notes', 'Minutes.md'), vault, { tempDir: path.join(d, 'temp') }), /zip file Ironleaf can read/);
  await assert.rejects(H.readImport(vault, vault, { tempDir: path.join(d, 'temp') }), /this vault, or holds it/);
});

test('the import’s summary reads plainly', () => {
  const w = S.importWords({ sourceName: 'Work', into: '', added: 3, identical: 80, merged: ['a.md'], keptApart: [{ rel: 'x.png', at: 'Merged from Work/x.png' }], converted: 0, skipped: [], settings: 'kept' });
  assert.equal(w, 'From Work: 3 new files, 1 note combined with the one here, 80 files already here, the same, 1 file that differed kept beside its own in “Merged from Work”. This vault’s own settings were kept. Nothing was renamed or lost.');
});

// ── Import uplift (9.5, nv-import F12, F20): HTML keeps its shapes ─────────────────────────────────────────────────

test('F12: tables head only on <th>, embedded pictures stay or are said, titles never double, ticks become tasks', () => {
  const headed = M.htmlToMarkdown('<html><head><title>Stock</title></head><body><table><tr><th>Item</th><th>Qty</th></tr><tr><td>Nails</td><td>40</td></tr></table></body></html>');
  assert.match(headed.markdown, /\| Item \| Qty \|\n\| --- \| --- \|\n\| Nails \| 40 \|/);
  const plain = M.htmlToMarkdown('<html><body><table><tr><td>Mon</td><td>London</td></tr><tr><td>Tue</td><td>Paris</td></tr></table></body></html>');
  assert.match(plain.markdown, /\|  \|  \|\n\| --- \| --- \|\n\| Mon \| London \|\n\| Tue \| Paris \|/, 'no <th>: every row stays data');
  const tiny = `data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`;
  const embedded = M.htmlToMarkdown(`<html><body><p><img src="${tiny}" alt="Sketch"></p></body></html>`);
  assert.match(embedded.markdown, /!\[Sketch\]\(data:image\/png;base64,/, 'a small embedded picture stays inline');
  assert.deepEqual(embedded.skipped, []);
  const huge = `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024)}`;
  const big = M.htmlToMarkdown(`<html><body><p><img src="${huge}" alt="Poster"></p></body></html>`);
  assert.doesNotMatch(big.markdown, /data:image/, 'a huge one does not bloat the note');
  assert.deepEqual(big.skipped, [{ what: 'Poster', why: 'an embedded picture over 1 MB was left out' }]);
  const dup = M.htmlToMarkdown('<html><head><title>Trip plan</title></head><body><h1>Trip plan</h1><p>Go.</p></body></html>');
  assert.equal(dup.markdown.match(/^# Trip plan$/gm).length, 1, 'the title is not doubled');
  const ticks = M.htmlToMarkdown('<html><body><div><input type="checkbox" aria-checked="true"> Pack bags</div><div><input type="checkbox"> Book taxi</div></body></html>');
  assert.match(ticks.markdown, /^- \[x\] Pack bags$/m);
  assert.match(ticks.markdown, /^- \[ \] Book taxi$/m);
});

test('F20: a headingless CSV table keeps every row under generic columns', () => {
  const md = M.csvToMarkdown('Apples,4.50\nPears,3.20\n', 'Prices');
  assert.match(md, /^# Prices\n\n\| Column 1 \| Column 2 \|\n\| --- \| --- \|\n\| Apples \| 4.50 \|\n\| Pears \| 3.20 \|/);
  const headed = M.csvToMarkdown('Fruit,Price\nApples,4.50\n', 'Prices');
  assert.match(headed, /\| Fruit \| Price \|\n\| --- \| --- \|\n\| Apples \| 4.50 \|/);
});

// ── Import uplift (9.5, nv-import F9, F10): Word and OneNote archives become notes ────────────────────────────────

const docxXml = (body) => `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>${body}</w:body></w:document>`;
const docxPara = (text, style = '', extra = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>` : extra ? `<w:pPr>${extra}</w:pPr>` : ''}<w:r><w:rPr></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

test('F9: a Word file becomes a note — headings, lists, tables, bold, links, pictures, ticks', async () => {
  const numbering = `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/plan" TargetMode="External"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/plot.png"/></Relationships>`;
  const pic = `<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Plot" descr="Garden plot"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId6"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const tick = `<w:p><w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="1"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>Buy seeds</w:t></w:r></w:sdtContent></w:sdt></w:p>`;
  const body = [
    docxPara('Garden plan', 'Heading1'),
    `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bed one</w:t></w:r><w:r><w:t> gets </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>tomatoes</w:t></w:r></w:p>`,
    docxPara('Dig it over', '', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
    docxPara('Plant out', '', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'),
    `<w:p><w:hyperlink r:id="rId5"><w:r><w:t>full plan</w:t></w:r></w:hyperlink></w:p>`,
    `<w:p>${pic}</w:p>`,
    tick,
    `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Bed</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Crop</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Beans</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
  ].join('');
  const dir = path.join(work, 'word9');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await Z.writeZip(path.join(dir, 'Plan.docx'), [
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: 'word/document.xml', data: Buffer.from(docxXml(body)) },
    { name: 'word/numbering.xml', data: Buffer.from(numbering) },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(rels) },
    { name: 'word/media/plot.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]) },
  ]);
  writeFileSync(path.join(dir, 'Old.doc'), Buffer.from('not a word file'));
  const vault = path.join(work, 'word9vault');
  mkdirSync(vault, { recursive: true });
  const src = await H.readImport(dir, vault, { tempDir: path.join(work, 'word9temp') });
  assert.equal(src.plan.kind, 'notes');
  const s = await H.importInto(vault, src, { targetIsNew: false });
  await src.done();
  assert.equal(s.converted, 1);
  const note = readFileSync(path.join(vault, 'word9', 'Plan.md'), 'utf8');
  assert.match(note, /^# Plan\n/);
  assert.match(note, /^# Garden plan$/m);
  assert.match(note, /\*\*Bed one\*\* gets \*tomatoes\*/);
  assert.match(note, /^- Dig it over$/m);
  assert.match(note, /^1\. Plant out$/m);
  assert.match(note, /\[full plan\]\(https:\/\/example\.com\/plan\)/);
  assert.match(note, /!\[Garden plot\]\(Plan_files\/plot\.png\)/);
  assert.match(note, /^- \[x\] Buy seeds$/m);
  assert.match(note, /\| Bed \| Crop \|/);
  assert.ok(existsSync(path.join(vault, 'word9', 'Plan_files', 'plot.png')), 'the picture unpacked beside the note');
  assert.ok(existsSync(path.join(vault, 'word9', 'Plan.docx')), 'the original kept');
  assert.ok(s.skipped.some((x) => /Old\.doc/.test(x.rel) && /\.docx/.test(x.why)), `old Word said: ${JSON.stringify(s.skipped)}`);
});

test('F3: a folder import stops halfway with no half file, and continues', async () => {
  const dir = path.join(work, 'stop3');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const t of ['One', 'Two', 'Three', 'Four']) writeFileSync(path.join(dir, `${t}.md`), `# ${t}\n\nWords for ${t}.\n`);
  const vault = path.join(work, 'stop3vault');
  rmSync(vault, { recursive: true, force: true });
  mkdirSync(vault, { recursive: true });
  const signal = { stopped: false };
  let calls = 0;
  const src = await H.readImport(dir, vault, { tempDir: path.join(work, 'stop3temp') });
  const partial = await H.importInto(vault, src, {
    targetIsNew: false,
    signal,
    onProgress: () => {
      calls++;
      if (calls >= 2) signal.stopped = true;
    },
  });
  await src.done();
  assert.equal(partial.stopped, true);
  assert.match(partial.words, /Stopped halfway/);
  assert.ok(partial.added >= 1 && partial.added < 4, `some, not all: ${partial.added}`);
  for (const f of readdirSync(path.join(vault, 'stop3'))) {
    if (f.endsWith('.md')) assert.ok(readFileSync(path.join(vault, 'stop3', f), 'utf8').endsWith('\n'), `${f} kept whole`);
  }
  const src2 = await H.readImport(dir, vault, { tempDir: path.join(work, 'stop3temp2') });
  const done = await H.importInto(vault, src2, { targetIsNew: false });
  await src2.done();
  assert.equal(done.stopped, undefined);
  assert.equal(done.identical, partial.added, 'what came in agreed');
  assert.equal(done.added, 4 - partial.added, 'the rest added');
});

test('F10: a OneNote web archive (.mht) becomes a note with its pictures; .one is said', async () => {
  const png64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]).toString('base64');
  const mht = ['MIME-Version: 1.0', 'Content-Type: multipart/related; boundary="b1"; type="text/html"', '', '--b1', 'Content-Type: text/html; charset="utf-8"', 'Content-Transfer-Encoding: quoted-printable', 'Content-Location: page.html', '', '<html><head><title>Trip ideas</title></head><body><h2>Flights</h2><p>Qantas on <b>Friday</b>.</p><p><img src="cid:pic1" alt="Map"></p></body></html>', '--b1', 'Content-Type: image/png', 'Content-Transfer-Encoding: base64', 'Content-ID: <pic1>', 'Content-Location: map.png', '', png64, '--b1--', ''].join('\r\n');
  const direct = M.mhtToMarkdown(mht, 'Trip', 'Trip_files');
  assert.match(direct.markdown, /^# Trip ideas\n/);
  assert.match(direct.markdown, /## Flights/);
  assert.match(direct.markdown, /!\[Map\]\(Trip_files\/map\.png\)/);
  assert.equal(direct.files.length, 1);
  const dir = path.join(work, 'mht10');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'Trip.mht'), mht);
  writeFileSync(path.join(dir, 'Notebook.one'), Buffer.from('not a notebook'));
  const vault = path.join(work, 'mht10vault');
  mkdirSync(vault, { recursive: true });
  const src = await H.readImport(dir, vault, { tempDir: path.join(work, 'mht10temp') });
  const s = await H.importInto(vault, src, { targetIsNew: false });
  await src.done();
  assert.equal(s.converted, 1);
  assert.ok(existsSync(path.join(vault, 'mht10', 'Trip_files', 'map.png')));
  assert.ok(s.skipped.some((x) => /Notebook\.one/.test(x.rel) && /\.mht/.test(x.why)), `one said: ${JSON.stringify(s.skipped)}`);
});
