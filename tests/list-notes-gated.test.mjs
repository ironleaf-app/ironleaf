// node --test tests/list-notes-gated.test.mjs — list_notes failed every time in the side chat (20 Nov 2026, on Ironleaf
// 2.0.0). The side chat always reaches the notes through its gate (agent-gate.ts gateIndex), which refuses any index
// call it doesn't list; list_notes and recent_notes call index.isQuiet, which wasn't listed, so both threw "Agents don't
// use the index's isQuiet." on every call. Also: the folder the model names is forgiven (slashes, case, a note's path),
// a folder that isn't there says which ones are, and a file the drive refuses (a OneDrive file only in the cloud, a
// locked file) is skipped and counted instead of failing the whole listing.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-listfix-'));
let M;
let V;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};\nexport { gateNotes, gateIndex } from ${JSON.stringify(path.join(root, 'src/main/agent-gate.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'agent.mjs'), format: 'esm' }, logLevel: 'silent' });
  const electron = { name: 'electron-stand-in', resolveId: (id) => (id === 'electron' ? '\0electron' : null), load: (id) => (id === '\0electron' ? 'export const shell = { trashItem: async () => {} }; export const app = { getPath: () => "" };' : null) };
  await build({ input: path.join(root, 'src/main/vault.ts'), platform: 'node', plugins: [electron], output: { file: path.join(work, 'v.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  M = await import(pathToFileURL(path.join(work, 'agent.mjs')).href);
  V = await import(pathToFileURL(path.join(work, 'v.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const run = (tools, name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });

const NOTES = ['01 Work/Plan.md', '01 Work/Clients/Acme.md', 'Daily/2026-11-20.md', 'Home/Garden.md', 'Reminders.md'];

function host({ listing } = {}) {
  const index = new M.VaultIndex();
  for (const p of NOTES) index.set(p, `# ${path.basename(p, '.md')}\n`, Date.now(), 10);
  const folders = ['01 Work', '01 Work/Clients', 'Daily', 'Empty', 'Home'];
  return {
    index,
    listing: listing ?? (async () => ({ files: NOTES.map((rel) => ({ rel, kind: 'note' })), folders })),
    exists: async () => false,
    read: async () => '',
    write: async () => {},
    move: async () => ({ path: '', linksUpdated: 0 }),
    trash: async () => {},
    clean: (rel) => (typeof rel === 'string' && rel && !rel.split('/').includes('..') ? rel.replace(/^\/+/, '') : ''),
    today: () => 'Friday 20 November 2026 (2026-11-20)',
  };
}

const gate = {
  who: 'side-chat', name: 'The side chat', key: () => 'k', level: () => 'open', sees: () => true, allowsLevel: () => true,
  check: () => {}, note: () => {}, listed: () => {},
};
const sideChat = (h) => new M.AgentTools(M.gateNotes(h, gate), [], () => {});

test('the side chat (gated) lists notes, recent notes and the overview without failing', async () => {
  const tools = sideChat(host());
  const r = await run(tools, 'list_notes', { folder: '01 Work' });
  assert.equal(r.isError, undefined, r.text);
  assert.match(r.text, /01 Work\/Plan\.md/);
  assert.match(r.text, /Folders: 01 Work\/Clients/);
  const recent = await run(tools, 'recent_notes', {});
  assert.equal(recent.isError, undefined, recent.text);
  assert.match(recent.text, /Home\/Garden\.md/);
  const top = await run(tools, 'list_notes', {});
  assert.equal(top.isError, undefined, top.text);
  const over = await run(tools, 'notes_overview', {});
  assert.equal(over.isError, undefined, over.text);
});

test('the folder named is forgiven: slashes, case, a note path', async () => {
  for (const folder of ['01 Work/', '/01 Work', '\\01 Work\\', '01 work', '01 WORK/', './01 Work', '01 Work/Plan.md', '01 Work/Plan', '01 work/plan.md']) {
    const r = await run(sideChat(host()), 'list_notes', { folder });
    assert.equal(r.isError, undefined, `${folder}: ${r.text}`);
    assert.match(r.text, /^Folders: 01 Work\/Clients\n2 notes/, `${folder} lists 01 Work: ${r.text}`);
  }
  const nested = await run(sideChat(host()), 'list_notes', { folder: '01 work\\clients' });
  assert.match(nested.text, /01 Work\/Clients\/Acme\.md/);
  const empty = await run(sideChat(host()), 'list_notes', { folder: 'empty/' });
  assert.match(empty.text, /0 notes/, 'an empty folder that is there lists as empty, not missing');
});

test('a folder that is not there says so and names the folders at the top', async () => {
  const r = await run(sideChat(host()), 'list_notes', { folder: 'Projects' });
  assert.equal(r.isError, undefined, r.text);
  assert.match(r.text, /There is no folder Projects/);
  assert.match(r.text, /01 Work, Daily, Empty, Home/);
  assert.doesNotMatch(r.text, /Clients/, 'only the folders at the top');
});

test('a listing that fails still lists the notes, saying what failed in plain words', async () => {
  const listing = async () => {
    throw Object.assign(new Error('EPERM: operation not permitted, scandir'), { code: 'EPERM', path: 'C:\\Users\\x\\OneDrive\\Documents\\NeuralVault' });
  };
  const r = await run(sideChat(host({ listing })), 'list_notes', { folder: 'Home' });
  assert.equal(r.isError, undefined, r.text);
  assert.match(r.text, /Home\/Garden\.md/);
  assert.match(r.text, /Windows refused access/);
  const top = await run(sideChat(host({ listing })), 'list_notes', {});
  assert.match(top.text, /Folders: 01 Work, Daily, Home/, 'folders come from the notes then');
});

test('a tool failing on a file error tells the model what failed, not a bare code', () => {
  const cloud = Object.assign(new Error('UNKNOWN: The cloud file provider is not running.'), { code: 'UNKNOWN', path: '\\\\?\\C:\\v\\a.md' });
  assert.match(M.fileErrorWords(cloud), /\(C:\\v\\a\.md\): the file is only in OneDrive.s cloud/);
  assert.match(M.fileErrorWords(Object.assign(new Error('x'), { code: 'ENAMETOOLONG' })), /too long/);
  assert.equal(M.fileErrorWords(new Error('plain')), null);
});

test('pickFolder and noFolderWords', () => {
  const folders = ['01 Work', 'Daily'];
  assert.deepEqual(M.pickFolder('', folders, []), { folder: '' });
  assert.deepEqual(M.pickFolder('/', folders, []), { folder: '' });
  assert.deepEqual(M.pickFolder('Reminders.md', folders, ['Reminders.md']), { folder: '' });
  assert.deepEqual(M.pickFolder('daily\\', folders, []), { folder: 'Daily' });
  assert.deepEqual(M.pickFolder('Nope', folders, []), { missing: 'Nope' });
  // Two folders that differ only by case (a Linux or synced vault): the case given must match.
  assert.deepEqual(M.pickFolder('work', ['Work', 'work'], []), { folder: 'work' });
  assert.deepEqual(M.pickFolder('WORK', ['Work', 'work'], []), { missing: 'WORK' });
  assert.match(M.noFolderWords('X', ['A', 'A/B', 'C']), /no folder X.*A, C\./);
});

test('Vault.listAll skips and counts entries the drive refuses (cloud-only, locked), never failing the list', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-listfix-vault-'));
  try {
    for (const rel of ['A/one.md', 'A/cloud.md', 'B/two.md', 'Locked/x.md', 'top.md']) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), '# x\n');
    }
    const v = await V.Vault.open(dir);
    const real = v.io;
    v.io = {
      readdir: async (d) => {
        if (path.basename(d) === 'Locked') throw Object.assign(new Error('EPERM: operation not permitted, scandir'), { code: 'EPERM' });
        return real.readdir(d);
      },
      stat: async (abs) => {
        if (path.basename(abs) === 'cloud.md') throw Object.assign(new Error('UNKNOWN: The cloud file provider is not running.'), { code: 'UNKNOWN', errno: -4094 });
        return real.stat(abs);
      },
    };
    const all = await v.listAll();
    assert.deepEqual(all.files.map((f) => f.rel), ['A/one.md', 'B/two.md', 'top.md']);
    assert.ok(all.folders.includes('Locked'), 'a folder that can’t be opened still shows');
    assert.equal(all.skipped, 2);
    assert.deepEqual(v.lastSkipped.map((s) => s.code).sort(), ['EPERM', 'UNKNOWN']);
    const md = await v.listMarkdown();
    assert.deepEqual(md.map((f) => f.rel), ['A/one.md', 'B/two.md', 'top.md']);
    // The notes folder itself refused: that one still fails, plainly.
    v.io = { ...v.io, readdir: async () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); } };
    await assert.rejects(() => v.listAll(), /EPERM/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
