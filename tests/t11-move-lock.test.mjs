// node --test tests/t11-move-lock.test.mjs — break tonight's carrying-on tidy-up (t11, 8 Nov 2026).
// The brief: can it run twice at once, with two windows or two PCs? Two windows share one process, so the
// in-process guard holds them. Two PCs share only the vault folder, and nothing there held them: both opens
// could carry the same move on at once, writing the same lists and folding the same notes. One PC holds a
// lock file in the vault while it runs; the other waits in plain words, and a lock left by a dead app goes
// stale and is taken over, never blocking for good.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-t11-move-lock-'));
let M;
const TODAY = new Date(2026, 9, 8, 9, 30);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${JSON.stringify(path.join(root, 'src/main/work-modules.ts'))};`, `export * as systemMove from ${JSON.stringify(path.join(root, 'src/main/life-records/system-move.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`, `export { LIFE_RECORDS_GROUP } from ${JSON.stringify(path.join(root, 'src/main/life-records.ts'))};`, `export { createVaultBin } from ${JSON.stringify(path.join(root, 'src/main/bin.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    const { symlinkSync } = await import('node:fs');
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

function core(files, device = { id: '00000000-0000-0000-0000-000000000001', name: 'TEST-PC' }) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  const optionsStore = { file: null };
  const w = new M.WorkModules(
    {
      vault: () => ({ root: dir, any: async (rel) => existsSync(path.join(dir, rel)), trash: async () => 0 }),
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
      device,
      appVersion: '9.9.0',
      optionsStore,
    },
    M.LIFE_RECORDS_GROUP,
  );
  w.setOptions = async (id, patch) => {
    const cur = optionsStore.file ? JSON.parse(optionsStore.file) : {};
    const next = { ...cur, [id]: { ...(cur[id] ?? {}), settings: { ...((cur[id] ?? {}).settings ?? {}), ...((patch ?? {}).settings ?? {}) } } };
    optionsStore.file = JSON.stringify(next);
    return next;
  };
  w.options = async () => (optionsStore.file ? JSON.parse(optionsStore.file) : {});
  const receiptPath = path.join(dir, '.neuralvault', 'systems-move.json');
  const lockPath = path.join(dir, '.neuralvault', 'systems-move.lock');
  return { w, dir, receiptPath, lockPath, receipt: () => JSON.parse(readFileSync(receiptPath, 'utf8')) };
}

const lockOf = (c) => JSON.parse(readFileSync(c.lockPath, 'utf8'));

test('another PC mid-run holds this one off, in plain words, changing nothing', async () => {
  const c = core(smallVault());
  mkdirSync(path.dirname(c.lockPath), { recursive: true });
  writeFileSync(c.lockPath, JSON.stringify({ pc: 'other-pc-id', name: 'OFFICE-PC', at: Date.now() }));
  const err = await M.systemMove.runMove(c.w).then(() => '', (e) => String(e?.message ?? e));
  assert.match(err, /OFFICE-PC/, 'it names the PC already tidying');
  assert.doesNotMatch(err, /EPERM|EACCES|EBUSY|ENOENT|EEXIST/, 'in plain words, never a code');
  assert.equal(existsSync(c.receiptPath), false, 'nothing started: no receipt, no backup');
  assert.equal(lockOf(c).pc, 'other-pc-id', 'the other PC still holds its lock');
});

test('a lock left by a dead app goes stale and is taken over', async () => {
  const c = core(smallVault());
  mkdirSync(path.dirname(c.lockPath), { recursive: true });
  writeFileSync(c.lockPath, JSON.stringify({ pc: 'dead-pc-id', name: 'OLD-PC', at: Date.now() - 30 * 60 * 1000 }));
  const words = await M.systemMove.runMove(c.w);
  assert.match(words, /folded|done/i, 'the move runs once the stale lock is taken over');
  assert.equal(c.receipt().phase, 'done', 'and finishes');
  assert.equal(existsSync(c.lockPath), false, 'the lock is released after the run');
});

test('carrying on by itself waits when another PC holds the run', async () => {
  const c = core(smallVault());
  await M.systemMove.runMovePhase(c.w, 'backup');
  await M.systemMove.runMovePhase(c.w, 'tables');
  const before = c.receipt();
  mkdirSync(path.dirname(c.lockPath), { recursive: true });
  writeFileSync(c.lockPath, JSON.stringify({ pc: 'other-pc-id', name: 'OFFICE-PC', at: Date.now() }));
  assert.equal(await M.systemMove.maybeResumeMove(c.w), null, 'no second run starts');
  assert.deepEqual(c.receipt(), before, 'the receipt is untouched for the PC holding the run');
});
