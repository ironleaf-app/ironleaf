// node --test tests/systems-move-carry.test.mjs — the Systems tidy-up finishes, or says why
// (the plan item 2, 8 Nov 2026). Whatever stops the move (an error moving a file to the Bin, the app
// closing, a file OneDrive holds) is kept in the receipt and shown in plain words on the Systems page, with
// Carry on. A OneDrive-held file (EPERM/EACCES) is retried a few times with short waits before the run stops.
// A move the person already started, stopped by the app closing or a briefly locked file, carries on by itself
// the next time the vault opens, with the same receipt, backup and Undo — and a move never starts by itself.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-systems-move-carry-'));
let M;
const TODAY = new Date(2026, 9, 8, 9, 30);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${JSON.stringify(path.join(root, 'src/main/work-modules.ts'))};`, `export * as systemMove from ${JSON.stringify(path.join(root, 'src/main/life-records/system-move.ts'))};`, `export * as systemTables from ${JSON.stringify(path.join(root, 'src/main/life-records/system-tables.ts'))};`, `export { LIFE_RECORDS_GROUP } from ${JSON.stringify(path.join(root, 'src/main/life-records.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`, `export { createVaultBin } from ${JSON.stringify(path.join(root, 'src/main/bin.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const AREAS = JSON.stringify({ version: 1, areas: [{ id: 'business', name: 'Business', folder: 'Business' }, { id: 'home', name: 'Home', folder: 'Home' }] });
const BASE = 'Home/Systems and Home Lab';
const MACHINE = (address) => `---\ntype: machine\nkind: "Server"\nrole: Media and backups\nos: Ubuntu 24.04.1 LTS\naddress: ${address}\nlocation: Garage rack\nstatus: Up\nchecked: 2026-10-23\n---\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: Ubuntu 24.04.1 LTS, up 11 days. |\n\n## Notes\n\n`;
const SERVICE = (machine, port) => `---\ntype: service\nkind: "Web app"\nruns_on: "[[${machine}]]"\nurl: http://${machine.toLowerCase()}.local:${port}\nport: "${port}"\nstatus: Up\ndepends_on: []\nrunbook:\nchecked: 2026-10-23\n---\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: running. |\n\n## Notes\n\n`;

const smallVault = () => ({
  '.neuralvault/areas.json': AREAS,
  [`${BASE}/Machines/Juniper.md`]: MACHINE('192.168.1.40'),
  [`${BASE}/Services/svc.md`]: SERVICE('Juniper', '8001'),
});

function core(files, extra = {}) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  const bin = M.createVaultBin({ root: dir, now: () => TODAY.getTime() });
  const vaultObj = {
    root: dir,
    any: async (rel) => existsSync(path.join(dir, rel)),
    trash: async (rel, why) => {
      await bin.put(rel, { by: 'test', ...(why ? { why } : {}) });
      index.delete?.(rel);
    },
  };
  const optionsStore = { file: null };
  const w = new M.WorkModules(
    {
      vault: () => vaultObj,
      index,
      prefs: () => ({ templatesFolder: 'Templates', modules: { systems: { on: true } } }),
      writeNote: async (rel, text) => {
        mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        writeFileSync(path.join(dir, rel), text);
        index.set(rel, text, 0, text.length);
      },
      importFiles: async (paths, folder) => paths.map((p) => `${folder}/${path.basename(p)}`),
      pickFiles: async () => [],
      saveFile: async () => null,
      post: () => 0,
      editProject: async () => ({}),
      projects: () => [],
      records: () => ({}),
      requireCreate: async () => {},
      now: () => TODAY,
      login: async () => ({ username: 'madeup', value: 'made-up-value' }),
      dataDir,
      device: { id: '00000000-0000-0000-0000-000000000001', name: 'TEST-PC' },
      appVersion: '9.9.0',
      optionsStore,
      ...extra,
    },
    M.LIFE_RECORDS_GROUP,
  );
  w.setOptions = async (id, patch) => {
    const cur = optionsStore.file ? JSON.parse(optionsStore.file) : {};
    const next = { ...cur, [id]: { ...(cur[id] ?? {}), settings: { ...((cur[id] ?? {}).settings ?? {}), ...((patch ?? {}).settings ?? {}) } } };
    optionsStore.file = JSON.stringify(next);
    const abs = path.join(dir, '.neuralvault', 'module-options.json');
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, optionsStore.file);
    return next;
  };
  w.options = async () => (optionsStore.file ? JSON.parse(optionsStore.file) : {});
  const part = (id) => w.parts.find((p) => p.id === id);
  const read = (rel) => readFileSync(path.join(dir, rel), 'utf8');
  const receipt = () => JSON.parse(readFileSync(path.join(dir, '.neuralvault', 'systems-move.json'), 'utf8'));
  return { w, dir, index, part, read, bin, dataDir, receipt };
}

const failWith = (code) => Object.assign(new Error(`${code}: locked by something else`), { code });

test('a file whose move throws EPERM once still folds: locked files retry a few times, then stop plainly', async () => {
  const c = core(smallVault());
  await M.systemMove.runMovePhase(c.w, 'backup');
  await M.systemMove.runMovePhase(c.w, 'tables');
  const realBin = M.createVaultBin({ root: c.dir, now: () => TODAY.getTime() });
  let calls = 0;
  const once = { list: (...a) => realBin.list(...a), put: async (...a) => (++calls === 1 ? Promise.reject(failWith('EPERM')) : realBin.put(...a)) };
  await M.systemMove.runMovePhase(c.w, 'moves', { bin: once });
  assert.equal(calls, 3, 'the refused move retried and went through (2 notes, one refusal)');
  await M.systemMove.runMovePhase(c.w, 'finish');
  const m = await c.part('systems').ops.model();
  assert.equal(m.services.length + m.machines.length, 2, 'both notes folded after the retry');
});

test('a file OneDrive keeps holding stops the run, and the reason is kept in the receipt', async () => {
  const c = core(smallVault());
  await M.systemMove.runMovePhase(c.w, 'backup');
  await M.systemMove.runMovePhase(c.w, 'tables');
  const realBin = M.createVaultBin({ root: c.dir, now: () => TODAY.getTime() });
  let calls = 0;
  const stuck = { list: (...a) => realBin.list(...a), put: async (...a) => (++calls, Promise.reject(failWith('EACCES'))) };
  const err = await M.systemMove.runMovePhase(c.w, 'moves', { bin: stuck }).then(() => '', (e) => e.message);
  assert.match(err, /Juniper|svc/, 'it names the stuck note');
  assert.doesNotMatch(err, /EPERM|EACCES|ENOENT/, 'in plain words, never a code');
  assert.ok(calls >= 3 && calls <= 5, `retried a few times with short waits (saw ${calls} tries)`);
  const r = c.receipt();
  assert.ok(r.stopped, 'the reason is kept in the receipt');
  assert.match(r.stopped.words, /Juniper|svc/, 'naming the stuck note');
  assert.doesNotMatch(r.stopped.words, /EPERM|EACCES/, 'in plain words');
  assert.equal(r.stopped.code, 'EACCES', 'with the code kept for the next open to read');
  assert.match(r.stopped.name ?? '', /Juniper|svc/, 'naming the stuck note, machine-readable too');
  const st = await c.part('systems').ops['move-state']();
  assert.equal(st.interrupted, true);
  assert.match(st.stoppedWords.join(' '), /Juniper|svc/, 'the Systems page says why, with Carry on');
  assert.doesNotMatch(st.stoppedWords.join(' '), /EPERM|EACCES/);
});

test('a move stopped by the app closing or a brief lock carries on by itself; a move never starts by itself', async () => {
  // Nothing started: nothing carries on, and no backup or receipt appears from nowhere.
  const fresh = core(smallVault());
  assert.equal(await M.systemMove.maybeResumeMove(fresh.w), null, 'no receipt, nothing to carry on');
  assert.equal(existsSync(path.join(fresh.dir, '.neuralvault', 'systems-move.json')), false, 'no receipt from nowhere');
  // The app closed mid-move (a receipt with no reason): the next open finishes it, same receipt, backup and Undo.
  const c = core(smallVault());
  const systems = c.part('systems');
  await M.systemMove.runMovePhase(c.w, 'backup');
  await M.systemMove.runMovePhase(c.w, 'tables');
  const before = c.receipt();
  assert.equal(before.stopped, undefined, 'an app close leaves no reason');
  // Found that way, the reason is kept and said (and the next open still carries on: no code, no wait).
  const found = await c.part('systems').ops['move-state']();
  assert.equal(found.interrupted, true);
  assert.match(found.stoppedWords.join(' '), /app closed part way through/);
  assert.match(c.receipt().stopped.words, /app closed part way through/, 'kept in the receipt');
  const words = await M.systemMove.maybeResumeMove(c.w);
  assert.match(words ?? '', /finish|folded/i, 'it carries on by itself');
  const after = c.receipt();
  assert.equal(after.phase, 'done');
  assert.equal(after.startedAt, before.startedAt, 'the same receipt');
  assert.equal(after.backup.zip, before.backup.zip, 'the same backup');
  assert.equal(after.moved.length, 2, 'both notes folded');
  const undone = await systems.ops['move-undo']();
  assert.match(undone, /back/, 'and the one Undo still puts every file back');
  for (const [rel, text] of Object.entries(smallVault())) assert.equal(c.read(rel), text, `${rel} back byte for byte`);
});

test('a brief lock carries on by itself next open; a full disk waits for the person', async () => {
  // EPERM last time, clear now: carries on.
  const c = core(smallVault());
  await M.systemMove.runMovePhase(c.w, 'backup');
  await M.systemMove.runMovePhase(c.w, 'tables');
  const realBin = M.createVaultBin({ root: c.dir, now: () => TODAY.getTime() });
  const stuck = { list: (...a) => realBin.list(...a), put: async (...a) => Promise.reject(failWith('EPERM')) };
  await M.systemMove.runMovePhase(c.w, 'moves', { bin: stuck }).then(() => assert.fail('should stop'), () => undefined);
  assert.equal(c.receipt().stopped.code, 'EPERM');
  const words = await M.systemMove.maybeResumeMove(c.w);
  assert.match(words ?? '', /finish|folded/i, 'a cleared lock carries on by itself');
  assert.equal(c.receipt().phase, 'done');
  // A full disk last time: waits for the person (Carry on stays on the page, nothing runs by itself).
  const d = core(smallVault());
  await M.systemMove.runMovePhase(d.w, 'backup');
  await M.systemMove.runMovePhase(d.w, 'tables');
  const full = { list: (...a) => realBin.list(...a), put: async (...a) => Promise.reject(failWith('ENOSPC')) };
  await M.systemMove.runMovePhase(d.w, 'moves', { bin: full }).then(() => assert.fail('should stop'), () => undefined);
  assert.equal(d.receipt().stopped.code, 'ENOSPC');
  assert.equal(await M.systemMove.maybeResumeMove(d.w), null, 'a full disk waits for the person');
  assert.equal((await d.part('systems').ops['move-state']()).interrupted, true, 'Carry on stays on the page');
});

test('a list file OneDrive holds retries too, keeps its reason, and carries on once clear', async () => {
  const c = core(smallVault());
  await M.systemMove.runMovePhase(c.w, 'backup');
  await M.systemMove.runMovePhase(c.w, 'tables');
  // Hold one list file read-only, like a sync hold refusing the write, and run the lists again.
  const list = path.join(c.dir, `${BASE}/Services.md`);
  chmodSync(list, 0o444);
  const err = await M.systemMove.runMovePhase(c.w, 'tables').then(() => '', (e) => e.message);
  assert.match(err, /Couldn't write the lists/);
  assert.doesNotMatch(err, /EPERM|EACCES/);
  assert.equal(c.receipt().stopped.code, 'EACCES', 'the file’s own code kept for the next open');
  chmodSync(list, 0o644);
  const words = await M.systemMove.maybeResumeMove(c.w);
  assert.match(words ?? '', /finish|folded/i, 'a cleared hold carries on by itself');
  assert.equal(c.receipt().phase, 'done');
});

test('never a dropped row for a note the person moved themself, unless the Bin has it', async () => {
  // The person moved the note elsewhere mid-move: its row stays (dropping it would lose the record —
  // the lists are the only place it shows), and the note stays where they put it, untouched.
  const c = core(smallVault());
  const systems = c.part('systems');
  await M.systemMove.runMovePhase(c.w, 'backup');
  await M.systemMove.runMovePhase(c.w, 'tables');
  const rel = `${BASE}/Services/svc.md`;
  const movedTo = 'Home/Notes/svc.md';
  mkdirSync(path.join(c.dir, 'Home/Notes'), { recursive: true });
  writeFileSync(path.join(c.dir, movedTo), c.read(rel));
  rmSync(path.join(c.dir, rel));
  c.index.delete?.(rel);
  c.index.set(movedTo, c.read(movedTo), 0, c.read(movedTo).length);
  await M.systemMove.runMovePhase(c.w, 'moves');
  await M.systemMove.runMovePhase(c.w, 'finish');
  assert.match(c.read(`${BASE}/Services.md`), /\|\s*svc\s*\|/, 'the row stays in the list, so the record still shows');
  const m = await systems.ops.model();
  assert.ok(m.services.some((s) => s.name === 'svc'), 'the record still lists (their note shadows the kept row)');
  assert.equal(c.read(movedTo), smallVault()[rel], 'their note untouched where they put it');
  // But a note they took out to the Bin themselves may drop its row: the Bin has it.
  const d = core(smallVault());
  const systems2 = d.part('systems');
  await M.systemMove.runMovePhase(d.w, 'backup');
  await M.systemMove.runMovePhase(d.w, 'tables');
  await d.bin.put(rel, { by: 'The person', why: 'taken out' });
  d.index.delete?.(rel);
  await M.systemMove.runMovePhase(d.w, 'moves');
  await M.systemMove.runMovePhase(d.w, 'finish');
  const m2 = await systems2.ops.model();
  assert.ok(!m2.services.some((s) => s.name === 'svc' && s.path.includes('#')), 'no shadow row for a note in the Bin');
});
