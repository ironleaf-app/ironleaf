// node --test tests/systems-records.test.mjs — machine records as data, notes only when written (5 Nov 2026).
// Machines, services and runbooks live as rows in one readable file per kind in the vault (Machines.md,
// Services.md, Runbooks.md beside their folders); a record opens as a normal page from its row; it becomes a note
// file only when typed into (words in the notes area, an edited step, or a recorded run). The one-time move takes a
// full backup first, shows a preview in plain words, folds only machine-made frames (when unsure a file stays a
// note), moves folded notes to the Bin, and undoes everything byte for byte. Proven on an invented vault with the
// shape: 4 machines, 61 services, 57 runbooks, a few with real words, some with edited steps, one with a recorded
// run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clockFrom } from './clock-from.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-systems-records-'));
let S;
let M;
const TODAY = new Date(2026, 9, 24, 10, 0);
clockFrom(TODAY);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(entry, ['system-tables', 'lists', 'goals', 'systems', 'business', 'memories', 'life-records', 'life-modules', 'module-records', 'module-tools', 'sensitivity'].map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${JSON.stringify(path.join(root, 'src/main/work-modules.ts'))};`, `export * as systemMove from ${JSON.stringify(path.join(root, 'src/main/life-records/system-move.ts'))};`, `export * as systemTables from ${JSON.stringify(path.join(root, 'src/main/life-records/system-tables.ts'))};`, `export { LIFE_RECORDS_GROUP } from ${JSON.stringify(path.join(root, 'src/main/life-records.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`, `export { makeGate } from ${JSON.stringify(path.join(root, 'src/main/agent-gate.ts'))};`, `export { createVaultBin } from ${JSON.stringify(path.join(root, 'src/main/bin.ts'))};`, `export * as vaultSync from ${JSON.stringify(path.join(root, 'src/main/vault-sync.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const AREAS = JSON.stringify({ version: 1, areas: [{ id: 'business', name: 'Business', folder: 'Business' }, { id: 'home', name: 'Home', folder: 'Home' }, { id: 'family', name: 'Family', folder: 'Family' }, { id: 'me', name: 'Me', folder: 'Me' }] });
const BASE = 'Home/Systems and Home Lab';
const sha = (t) => createHash('sha256').update(t).digest('hex');

const MACHINE = (name, address, extra = '') => `---\ntype: machine\nkind: "Server"\nrole: Media and backups\nos: Ubuntu 24.04.1 LTS\naddress: ${address}\nlocation: Garage rack\nstatus: Up\nchecked: 2026-10-23\n---\n## Credentials\n\n- Admin: [locked](secret:Ab12Cd34Ef)\n\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: Ubuntu 24.04.1 LTS, up 11 days. |\n${extra}\n## Notes\n\n`;
const SERVICE = (name, machine, port) => `---\ntype: service\nkind: "Web app"\nruns_on: "[[${machine}]]"\nurl: http://${machine.toLowerCase()}.local:${port}\nport: "${port}"\nstatus: Up\ndepends_on: []\nrunbook:\nchecked: 2026-10-23\n---\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: running. |\n\n## Notes\n\n`;
const RUNBOOK_FACTORY = (name, target, steps) => `---\ntype: runbook\nfor: ["[[${target}]]"]\nevery: "On demand"\nlast_run:\n---\n## Steps\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n## Runs\n\n| Date | Result | Note |\n| --- | --- | --- |\n\n## Notes\n\n`;

// The invented vault with the shape: 4 machines, 61 services, 57 runbooks. Most are machine-made frames; a few
// hold real words, some have edited steps, one has a recorded run.
function ownerShapeFiles() {
  const files = { '.neuralvault/areas.json': AREAS };
  const machines = ['Juniper', 'Wilbur', 'N holds', 'Garage Pi'];
  machines.forEach((m, i) => {
    files[`${BASE}/Machines/${m}.md`] = MACHINE(m, `192.168.1.${40 + i}`);
  });
  // One machine note holds the person's own words: it stays a note.
  files[`${BASE}/Machines/Juniper.md`] += 'Juniper hums on hot days. Move it off the top shelf before summer.\n';
  let n = 0;
  for (const m of machines) {
    const count = m === 'Juniper' ? 16 : 15;
    for (let i = 1; i <= count; i++) {
      n++;
      const name = `tide-app-${n}`;
      files[`${BASE}/Services/${name}.md`] = SERVICE(name, m, String(8000 + n));
    }
  }
  assert.equal(n, 61);
  // Two services with real words stay notes.
  files[`${BASE}/Services/tide-app-3.md`] += 'This one serves the photo library. Do not stop it during a backup.\n';
  files[`${BASE}/Services/tide-app-40.md`] = files[`${BASE}/Services/tide-app-40.md`].replace('| 2026-10-23 | Up | Checked: running. |', '| 2026-10-23 | Up | Checked: running. |\n| 2026-10-24 | Degraded | Disk at 92 percent. Cleared old logs by hand. |');
  return { files, machines };
}

// The 57 runbook notes: what the checker wrote per machine over its full service list (update, backups, restore,
// eight restarts and one shared restarter each), plus restart notes for services found one check at a time.
function addFactoryRunbooks(files, S) {
  const sys = S.systems;
  const T = S.systemTables;
  const byMachine = { Juniper: [], Wilbur: [], 'N holds': [], 'Garage Pi': [] };
  const names = Object.keys(byMachine);
  for (let n = 1; n <= 61; n++) byMachine[names[n <= 16 ? 0 : n <= 31 ? 1 : n <= 46 ? 2 : 3]].push(`tide-app-${n}`);
  for (const m of names) {
    const svcs = [...byMachine[m]].sort().map((name) => ({ name, kind: 'Web app' }));
    for (const g of sys.runbooksFromCheck(m, 'Ubuntu 24.04.1 LTS', svcs)) {
      files[`${BASE}/Runbooks/${g.name}.md`] = RUNBOOK_FACTORY(g.name, g.for, g.steps);
    }
  }
  for (const [svc, m] of [['tide-app-9', 'Juniper'], ['tide-app-8', 'Juniper'], ['tide-app-25', 'Wilbur'], ['tide-app-26', 'Wilbur'], ['tide-app-40', 'N holds'], ['tide-app-41', 'N holds'], ['tide-app-55', 'Garage Pi'], ['tide-app-56', 'Garage Pi'], ['tide-app-57', 'Garage Pi']]) {
    files[`${BASE}/Runbooks/Restart ${svc}.md`] = RUNBOOK_FACTORY(`Restart ${svc}`, svc, T.fillPatternSteps('restart', { machine: m, service: svc }));
  }
  const count = Object.keys(files).filter((f) => f.startsWith(`${BASE}/Runbooks/`)).length;
  assert.equal(count, 57);
}

function vault(files) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  return { dir, index };
}

function core(files, switches, extra = {}) {
  const { dir, index } = vault(files);
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  const posted = [];
  const written = [];
  const bin = M.createVaultBin({ root: dir, now: () => TODAY.getTime() });
  const vaultObj = {
    root: dir,
    any: async (rel) => {
      try {
        readFileSync(path.join(dir, rel));
        return true;
      } catch {
        return written.some((x) => x.rel === rel);
      }
    },
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
      prefs: () => ({ templatesFolder: 'Templates', modules: switches.now }),
      writeNote: async (rel, text) => {
        written.push({ rel, text });
        mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        writeFileSync(path.join(dir, rel), text);
        index.set(rel, text, 0, text.length);
      },
      importFiles: async (paths, folder) => paths.map((p) => `${folder}/${path.basename(p)}`),
      pickFiles: async () => [],
      saveFile: async () => null,
      post: (items) => {
        const fresh = items.filter((i) => !posted.some((p) => p.key === i.key));
        posted.push(...fresh);
        return fresh.length;
      },
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
  // The module options file lives in the vault like the product's.
  w.setOptions = async (id, patch) => {
    const cur = optionsStore.file ? JSON.parse(optionsStore.file) : {};
    const next = { ...cur, [id]: { ...(cur[id] ?? {}), settings: { ...((cur[id] ?? {}).settings ?? {}), ...((patch ?? {}).settings ?? {}) }, ...(patch?.remindDays !== undefined ? { remindDays: patch.remindDays } : {}) } };
    optionsStore.file = JSON.stringify(next);
    const abs = path.join(dir, '.neuralvault', 'module-options.json');
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, optionsStore.file);
    return next;
  };
  w.options = async () => (optionsStore.file ? JSON.parse(optionsStore.file) : {});
  const part = (id) => w.parts.find((p) => p.id === id);
  const read = (rel) => readFileSync(path.join(dir, rel), 'utf8');
  const listDir = (sub) => {
    const d = path.join(dir, BASE, sub);
    return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.md')).sort() : [];
  };
  return { w, dir, index, posted, written, part, read, listDir, bin, dataDir, optionsStore };
}

const smallVault = () => ({
  '.neuralvault/areas.json': AREAS,
  [`${BASE}/Machines/Juniper.md`]: MACHINE('Juniper', '192.168.1.40'),
  [`${BASE}/Services/tide-app-1.md`]: SERVICE('tide-app-1', 'Juniper', '8001'),
});

/** A gate for an agent, with the person's levels (`store`). */
function gateFor(index, store, who, name) {
  const L = S.sensitivity;
  const sens = {
    stamp: () => 'x',
    level: (rel) => L.levelOf(store, rel, index.get(rel)?.props?.sensitivity, index.get(rel)?.props?.type).level,
    decide: (w, rel, n) => L.decide(store, w, rel, sens.level(rel), n),
    useGrant: () => false,
    allows: (w, level) => L.allows(store, w, level),
    audit: () => {},
  };
  return M.makeGate(sens, who, name);
}

test('tables: one readable file per kind, one row per line, with a version a person can read', () => {
  const T = S.systemTables;
  for (const kind of ['machine', 'service', 'runbook']) {
    const text = T.renderSystemsTable(kind, { rows: [], logs: {}, runs: {} });
    assert.match(text, /^---\ntype: systems-table\ntable: (machines|services|runbooks)\nversion: 1\n---\n/, `${kind} has readable frontmatter with a version`);
    assert.match(text, /^# (Machines|Services|Runbooks)\n/m, `${kind} has a plain heading`);
    const back = T.readSystemsTable(text);
    assert.equal(back.kind, kind);
    assert.equal(back.version, 1);
    assert.deepEqual(back.rows, []);
  }
  // A service row renders on one line and parses back with every fact.
  const text = T.renderSystemsTable('service', {
    rows: [{ name: 'Photo library', cells: { kind: 'Media', runsOn: '[[Media box]]', url: 'http://media.local:2342', port: '2342', status: 'Up', dependsOn: '', runbook: '', checked: '2026-10-23', logins: '' }, note: null }],
    logs: { 'photo library': [{ date: '2026-10-23', status: 'Up', note: 'Checked: running.' }] },
    runs: {},
  });
  const lines = text.split('\n').filter((l) => l.includes('Photo library'));
  assert.equal(lines.length, 2, 'one table line and one health line name the service');
  assert.match(lines[0], /^\| Photo library \| Media \|/);
  const back = T.readSystemsTable(text);
  assert.equal(back.rows.length, 1);
  assert.equal(back.rows[0].cells.port, '2342');
  assert.equal(back.rows[0].cells.runsOn, '[[Media box]]');
  assert.equal(back.logs['photo library'].length, 1);
});

test('tables: writing keeps what it does not understand, byte for byte', () => {
  const T = S.systemTables;
  const base = T.renderSystemsTable('service', { rows: [{ name: 'A', cells: { kind: 'Other', runsOn: '', url: '', port: '', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null }], logs: {}, runs: {} });
  const withUnknown = `${base}\n## Merged from OFFICE-PC (3 Nov 2026)\n\n| B | Other |  |  |  | Up |  |  |  |  |  |\n\n> A line a person wrote by hand stays too.\n`;
  const next = T.updateSystemsTable(withUnknown, 'service', (doc) => ({ ...doc, rows: [...doc.rows, { name: 'C', cells: { kind: 'Other', runsOn: '', url: '', port: '', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null }] }));
  assert.ok(next.includes('> A line a person wrote by hand stays too.\n'), 'a hand-written line survives a write');
  assert.ok(next.includes('| B | Other |'), 'a merged row survives a write');
  assert.ok(next.includes('| C | Other |'), 'the new row is there');
  const back = T.readSystemsTable(next);
  assert.ok(back.rows.some((r) => r.name === 'C'));
});

test('tables: two PCs writing at once keep every row from both sides', () => {
  const T = S.systemTables;
  const mine = T.renderSystemsTable('service', { rows: [{ name: 'A', cells: { kind: 'Other', runsOn: '', url: '', port: '', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null }], logs: {}, runs: {} });
  const theirs = T.renderSystemsTable('service', {
    rows: [
      { name: 'A', cells: { kind: 'Other', runsOn: '', url: '', port: '', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null },
      { name: 'B', cells: { kind: 'Media', runsOn: '', url: '', port: '', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null },
    ],
    logs: {},
    runs: {},
  });
  const m = T.mergeSystemsTables(mine, theirs, 'OFFICE-PC’s copy', '4 Nov 2026');
  assert.equal(m.changed, true);
  for (const line of theirs.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (line === '---' || /^type:|^table:|^version:|^# /.test(line)) continue;
    assert.ok(m.text.split('\n').map((l) => l.trim()).includes(line), `keeps their line: ${line.slice(0, 60)}`);
  }
  const back = T.readSystemsTable(m.text);
  assert.deepEqual(back.rows.map((r) => r.name).sort(), ['A', 'B']);
  // Same record changed on both PCs: both lines kept, mine read first.
  const mine2 = T.renderSystemsTable('service', { rows: [{ name: 'A', cells: { kind: 'Other', runsOn: '', url: '', port: '1', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null }], logs: {}, runs: {} });
  const theirs2 = T.renderSystemsTable('service', { rows: [{ name: 'A', cells: { kind: 'Other', runsOn: '', url: '', port: '2', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null }], logs: {}, runs: {} });
  const m2 = T.mergeSystemsTables(mine2, theirs2, 'OFFICE-PC’s copy', '4 Nov 2026');
  assert.ok(m2.text.includes('| 1 |') && m2.text.includes('| 2 |'), 'both versions kept, neither lost');
  assert.deepEqual(T.readSystemsTable(m2.text).rows.map((r) => r.cells.port), ['1']);
  assert.deepEqual(T.readSystemsTable(m2.text).dupes, ['A']);
});

test('filler: factory runbooks fold; edited steps, runs and real words stay', () => {
  const T = S.systemTables;
  const sys = S.systems;
  const steps = sys.runbooksFromCheck('Juniper', 'Ubuntu 24.04.1 LTS', [{ name: 'tide-app-1', kind: 'Web app' }]);
  const upd = steps.find((r) => r.name === 'Update Juniper');
  const factory = { type: 'runbook', title: 'Update Juniper', props: { for: '[[Juniper]]', every: 'On demand', last_run: '' }, content: RUNBOOK_FACTORY('Update Juniper', 'Juniper', upd.steps) };
  const c1 = T.classifySystemsNote(factory, { osByName: { juniper: 'Ubuntu 24.04.1 LTS' }, servicesByMachine: { juniper: [{ name: 'tide-app-1' }] } });
  assert.equal(c1.fold, true, `a factory runbook folds: ${c1.why}`);
  const edited = { ...factory, content: factory.content.replace('1. ', '1. First ring Wilbur. Then ') };
  assert.equal(T.classifySystemsNote(edited, {}).fold, false, 'edited steps stay a note');
  const run = { ...factory, content: factory.content.replace('| --- | --- | --- |', '| --- | --- | --- |\n| 2026-10-20 | Done | Went well. |') };
  assert.equal(T.classifySystemsNote(run, {}).fold, false, 'a recorded run stays a note');
  const words = { ...factory, content: `${factory.content}Ring Wilbur first on Sundays.\n` };
  assert.equal(T.classifySystemsNote(words, {}).fold, false, 'real words stay a note');
  const svc = { type: 'service', title: 'tide-app-1', props: { kind: 'Web app', runs_on: '[[Juniper]]', port: '8001', status: 'Up' }, content: SERVICE('tide-app-1', 'Juniper', '8001') };
  const c2 = T.classifySystemsNote(svc, {});
  assert.equal(c2.fold, true, `a check-made service folds: ${c2.why}`);
  const svcWords = { ...svc, content: `${svc.content}Do not stop this during a backup.\n` };
  assert.equal(T.classifySystemsNote(svcWords, {}).fold, false, 'a service with real words stays');
  const svcLogin = { ...svc, content: `${svc.content}\n## Credentials\n\n- Admin: [locked](secret:Ab12Cd34Ef)\n` };
  assert.equal(T.classifySystemsNote(svcLogin, {}).fold, false, 'a service with a linked login stays');
  const odd = { type: 'service', title: 'Odd', props: {}, content: 'no frontmatter at all, just words\n' };
  assert.equal(T.classifySystemsNote(odd, {}).fold, false, 'when unsure a file stays a note');
});

test('move on a realistic vault: backup first, preview, fold, Undo puts every byte back', async () => {
  const { files } = ownerShapeFiles();
  addFactoryRunbooks(files, S);
  // Edited steps, a recorded run and real words stay notes.
  files[`${BASE}/Runbooks/Restart tide-app-1.md`] = files[`${BASE}/Runbooks/Restart tide-app-1.md`].replace('1. ', '1. Ring Wilbur first. Then ');
  files[`${BASE}/Runbooks/Restart tide-app-8.md`] = files[`${BASE}/Runbooks/Restart tide-app-8.md`].replace('2. ', '2. Ring Wilbur first. Then ');
  files[`${BASE}/Runbooks/Update Wilbur.md`] = files[`${BASE}/Runbooks/Update Wilbur.md`].replace('| --- | --- | --- |', '| --- | --- | --- |\n| 2026-10-20 | Done | Took ten minutes. |');
  files[`${BASE}/Runbooks/Check backups on Wilbur.md`] += 'Wilbur backs up to the USB drive on Sundays.\n';
  const before = {};
  for (const [rel, text] of Object.entries(files)) before[rel] = sha(text);
  const c = core(files, { now: { systems: { on: true } } });
  const systems = c.part('systems');
  const state0 = await systems.ops['move-state']();
  assert.equal(state0.offer, true, 'the move is offered on a vault full of frames');
  const preview = await systems.ops['move-preview']();
  assert.ok(preview.fold.length > 100, `most of the 122 fold, got ${preview.fold.length}`);
  assert.ok(preview.stay.length >= 5, `real words stay, got ${preview.stay.length}`);
  assert.match(preview.words.join('\n'), /backup/i, 'the preview says a backup comes first');
  assert.match(preview.words.join('\n'), /Bin/, 'the preview says folded notes go to the Bin');
  // The model before the move, for the same-after comparison.
  const modelBefore = await systems.ops.model();
  assert.equal(modelBefore.machines.length, 4);
  assert.equal(modelBefore.services.length, 61);
  assert.equal(modelBefore.runbooks.length, 57);
  const words = await systems.ops['move-run']();
  assert.match(words, /backup/i, 'the move says where the backup went');
  const backups = readdirSync(path.join(c.dataDir, 'backups'));
  assert.equal(backups.length, 1, 'a full backup was taken first');
  assert.ok(backups[0].endsWith('.zip'), 'the backup is a zip');
  // Folded notes are in the Bin; stays are byte-identical.
  assert.ok(c.listDir('Services').length <= 3, `service frames folded, left ${c.listDir('Services').length}`);
  assert.ok(c.listDir('Runbooks').length <= 4, `runbook frames folded, left ${c.listDir('Runbooks').length}`);
  for (const s of preview.stay) assert.equal(sha(c.read(s.rel)), before[s.rel], `${s.rel} untouched byte for byte`);
  const binItems = await c.bin.list();
  assert.ok(binItems.length >= 110, `folded notes went to the Bin, got ${binItems.length}`);
  // The model after the move lists, counts and links the same records.
  const modelAfter = await systems.ops.model();
  assert.equal(modelAfter.machines.length, 4);
  assert.equal(modelAfter.services.length, 61, 'every service still lists');
  assert.equal(modelAfter.runbooks.length, 57, 'every runbook still lists');
  assert.deepEqual(modelAfter.services.map((s) => s.name).sort(), modelBefore.services.map((s) => s.name).sort());
  assert.deepEqual(modelAfter.runbooks.map((r) => r.name).sort(), modelBefore.runbooks.map((r) => r.name).sort());
  const svc = modelAfter.services.find((s) => s.name === 'tide-app-9');
  assert.equal(svc.port, '8009', 'a row record keeps its facts');
  assert.equal(svc.machinePath, modelAfter.machines.find((m) => m.name === 'Juniper').path, 'a row service still links its machine');
  assert.ok(svc.health.length >= 1, 'a row record keeps its checks');
  const rb = modelAfter.runbooks.find((r) => r.name === 'Update Juniper');
  assert.ok(rb.steps.length >= 3, 'a folded runbook still opens with its steps');
  assert.equal(rb.for[0].name, 'Juniper', 'a folded runbook still links what it is for');
  // One Undo puts every file back byte for byte.
  const undone = await systems.ops['move-undo']();
  assert.match(undone, /back/i);
  for (const [rel, digest] of Object.entries(before)) assert.equal(sha(c.read(rel)), digest, `${rel} back byte for byte`);
  const modelBack = await systems.ops.model();
  assert.equal(modelBack.services.length, 61);
  assert.equal(modelBack.runbooks.length, 57);
});

test('move: a crash at each step resumes and still ends byte-right', async () => {
  const { files } = ownerShapeFiles();
  const sys = S.systems;
  for (const m of ['Juniper']) for (const g of sys.runbooksFromCheck(m, 'Ubuntu 24.04.1 LTS', [{ name: 'tide-app-1', kind: 'Web app' }]).slice(0, 2)) files[`${BASE}/Runbooks/${g.name}.md`] = RUNBOOK_FACTORY(g.name, g.for, g.steps);
  for (const step of ['backup', 'tables', 'moves-3', 'moves-all']) {
    const c = core({ ...files }, { now: { systems: { on: true } } });
    const systems = c.part('systems');
    // Drive the move one phase at a time, then pretend the app died.
    await M.systemMove.runMovePhase(c.w, 'backup');
    if (['tables', 'moves-3', 'moves-all'].includes(step)) await M.systemMove.runMovePhase(c.w, 'tables');
    if (step === 'moves-3') {
      await M.systemMove.runMovePhase(c.w, 'moves', { limit: 3 });
      // The app died after a note reached the Bin but before the receipt said so: resume reconciles from the Bin.
      // The next note comes from the receipt's frozen plan: the preview re-reads from the lists, where rows
      // already written read as stay (a row already there is never folded again).
      const receipt = JSON.parse(readFileSync(path.join(c.dir, '.neuralvault', 'systems-move.json'), 'utf8'));
      const next = receipt.planned.map((f) => f.rel).find((rel) => {
        try {
          c.read(rel);
          return true;
        } catch {
          return false;
        }
      });
      await c.bin.put(next, { by: 'Systems tidy-up', why: 'folded into the Systems lists' });
      c.index.delete?.(next); // a restart rebuilds the index from the disk, where the note is already gone
    }
    if (step === 'moves-all') {
      await M.systemMove.runMovePhase(c.w, 'moves', { limit: 1000 });
    }
    const mid = await systems.ops['move-state']();
    assert.equal(mid.interrupted, true, `after a crash at ${step} the move says it did not finish`);
    const words = await systems.ops['move-resume']();
    assert.match(words, /finish|done|folded/i, `resume after ${step} finishes: ${words}`);
    const after = await systems.ops.model();
    assert.equal(after.services.length, 61, `every service lists after resume from ${step}`);
    const names = after.services.map((s) => s.name);
    assert.equal(new Set(names).size, names.length, `no doubled rows after resume from ${step}`);
  }
});

test('move: the second PC writing the tables at the same time loses nothing', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await systems.ops['move-run']();
  // This PC adds a row; the other PC, from the same starting file, adds another. OneDrive keeps both
  // versions; the merge keeps every row.
  const rel = `${BASE}/Services.md`;
  const start = c.read(rel);
  await M.systemTables.addTableRow(c.w, 'service', { name: 'A-local', cells: { kind: 'Other', runsOn: '', url: '', port: '', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null });
  const mine = c.read(rel);
  const T = S.systemTables;
  const theirs = T.updateSystemsTable(start, 'service', (doc) => ({ ...doc, rows: [...doc.rows, { name: 'B-remote', cells: { kind: 'Other', runsOn: '', url: '', port: '', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null }] }));
  const merged = T.mergeSystemsTables(mine, theirs, 'OFFICE-PC’s copy', '5 Nov 2026');
  writeFileSync(path.join(c.dir, rel), merged.text);
  c.index.set(rel, merged.text, 0, merged.text.length);
  const m = await systems.ops.model();
  assert.ok(m.services.some((s) => s.name === 'A-local'), 'this PC’s row kept');
  assert.ok(m.services.some((s) => s.name === 'B-remote'), 'the other PC’s row kept');
  assert.ok(m.services.some((s) => s.name === 'tide-app-1'), 'the folded row kept');
});

test('move: needs the new version on both PCs, and says so in plain words', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  // Only this PC ever opened it: may go ahead.
  const solo = await systems.ops['move-state']();
  assert.equal(solo.offer, true);
  assert.equal(solo.pcsBlock, null);
  // The other PC is on an older version: blocked, in plain words.
  mkdirSync(path.join(c.dir, '.neuralvault', 'pcs'), { recursive: true });
  writeFileSync(path.join(c.dir, '.neuralvault', 'pcs', '00000000-0000-0000-0000-000000000001.json'), JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', name: 'TEST-PC', at: new Date(TODAY.getTime() - 60000).toISOString(), version: '9.9.0' }));
  writeFileSync(path.join(c.dir, '.neuralvault', 'pcs', '11111111-1111-1111-1111-111111111111.json'), JSON.stringify({ id: '11111111-1111-1111-1111-111111111111', name: 'OFFICE-PC', at: new Date(TODAY.getTime() - 60000).toISOString(), version: '1.0.0' }));
  const blocked = await systems.ops['move-state']();
  assert.ok(blocked.pcsBlock && blocked.pcsBlock.names.includes('OFFICE-PC'), 'names the PC that needs updating');
  await assert.rejects(() => systems.ops['move-run'](), /OFFICE-PC/, 'the move refuses while the other PC is behind');
  // The other PC updated: allowed.
  writeFileSync(path.join(c.dir, '.neuralvault', 'pcs', '11111111-1111-1111-1111-111111111111.json'), JSON.stringify({ id: '11111111-1111-1111-1111-111111111111', name: 'OFFICE-PC', at: new Date(TODAY.getTime() - 60000).toISOString(), version: '9.9.0' }));
  const ok = await systems.ops['move-state']();
  assert.equal(ok.pcsBlock, null);
  await systems.ops['move-run']();
});

test('move: a very old vault and a vault with no Systems at all', async () => {
  // No areas, no types, no .neuralvault: the move still works from the default folders.
  const old = {
    'Systems and Home Lab/Services/old-svc.md': SERVICE('old-svc', 'old-box', '9000'),
    'Systems and Home Lab/Machines/old-box.md': MACHINE('old-box', '192.168.1.99'),
  };
  const c = core(old, { now: { systems: { on: true } } });
  const systems = c.part('systems');
  const preview = await systems.ops['move-preview']();
  assert.ok(preview.fold.some((f) => f.name === 'old-svc'), 'the old frame folds');
  await systems.ops['move-run']();
  const m = await systems.ops.model();
  assert.ok(m.services.some((s) => s.name === 'old-svc'), 'the old service still lists');
  // No Systems at all: nothing offered, nothing breaks.
  const c2 = core({ 'Notes/Hello.md': '# Hello\n\nJust a note.\n' }, { now: { systems: { on: true } } });
  const s2 = await c2.part('systems').ops['move-state']();
  assert.equal(s2.offer, false, 'no offer with no Systems records');
  const m2 = await c2.part('systems').ops.model();
  assert.deepEqual(m2.machines, []);
  assert.deepEqual(m2.services, []);
});

test('typing promotes a row to a note; plain fixes stay in the row', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await systems.ops['move-run']();
  let m = await systems.ops.model();
  const row = m.services.find((s) => s.name === 'tide-app-1');
  assert.match(row.path, /Services\.md#/, 'folded records live behind row paths');
  // A corrected address stays in the row: no note file.
  await systems.ops['set-field']({ kind: 'service', path: row.path, field: 'url', value: 'http://juniper.local:9001' });
  m = await systems.ops.model();
  assert.equal(m.services.find((s) => s.name === 'tide-app-1').url, 'http://juniper.local:9001');
  assert.equal(c.listDir('Services').length, 0, 'a corrected address makes no note');
  // Words in the notes area make it a note; the row keeps pointing at it.
  const rel = await systems.ops['note-words'](row.path, 'Do not stop this during a backup.');
  assert.match(rel, /\.md$/);
  assert.match(c.read(rel), /Do not stop this during a backup/);
  m = await systems.ops.model();
  const back = m.services.find((s) => s.name === 'tide-app-1');
  assert.equal(back.path, rel, 'the note is the record now');
  // A recorded run promotes a runbook.
  const c2 = core(smallVault(), { now: { systems: { on: true } } });
  const s2 = c2.part('systems');
  await s2.ops['add-runbook']({ name: 'Morning checks', for: 'Juniper', every: 'Daily' });
  let m2 = await s2.ops.model();
  const rbRow = m2.runbooks.find((r) => r.name === 'Morning checks');
  assert.match(rbRow.path, /Runbooks\.md#/, 'a new runbook starts as a row');
  await s2.ops['mark-run'](rbRow.path, { result: 'Done', note: 'All well.' });
  m2 = await s2.ops.model();
  assert.match(m2.runbooks.find((r) => r.name === 'Morning checks').path, /\.md$/, 'a recorded run makes it a note');
});

test('self-check: one OK takes every found service at once, with one Undo; runbooks come as rows', async () => {
  const files = {
    '.neuralvault/areas.json': AREAS,
    [`${BASE}/Machines/Juniper.md`]: MACHINE('Juniper', '192.168.1.40'),
    [`${BASE}/Machines/Wilbur.md`]: MACHINE('Wilbur', '192.168.1.41'),
  };
  const probeFor = (...svcs) => `@@os\nUbuntu 24.04.1 LTS\n@@uptime\n1000000 0\n@@disk\n/dev/sda1 100 43 57 43% /\n@@memory\n7800 2100\n@@updates\n3\n@@security\n1\n@@services\n${svcs.join('\n')}\n@@containers\n@@ports\n`;
  const c = core(files, { now: { systems: { on: true } } }, { probe: async (address) => String(address).includes('41') ? probeFor('tide-app-3.service', 'tide-app-4.service') : probeFor('tide-app-1.service', 'tide-app-2.service') });
  const systems = c.part('systems');
  await systems.ops['check-all']();
  assert.equal(c.listDir('Services').length, 0, 'the beat writes no notes');
  assert.equal(c.listDir('Runbooks').length, 0, 'the beat writes no runbook notes either');
  const m = await systems.ops.model();
  assert.equal(m.found.length, 2, 'both machines hold what the beat found');
  // One OK takes them all at once, as rows, with one Undo.
  const added = await systems.ops['found-add-all']();
  assert.match(added.words, /4 service/, `one OK takes every found service: ${added.words}`);
  const after = await systems.ops.model();
  assert.equal(after.services.length, 4);
  assert.ok(after.services.every((s) => s.path.includes('#')), 'found services arrive as rows, not notes');
  assert.equal(c.listDir('Services').length, 0, 'still no service notes');
  const undone = await systems.ops['undo-created']({ paths: added.created });
  assert.match(undone.words ?? undone, /took them back|Bin|back/i);
  const back = await systems.ops.model();
  assert.equal(back.services.length, 0, 'one Undo takes every row from the press back');
  // Check now still creates when a person asked, but as rows sharing one set of steps.
  const r = await systems.ops.check(`${BASE}/Machines/Juniper.md`);
  assert.equal(c.listDir('Services').length, 0, 'Check now writes no service notes');
  assert.equal(c.listDir('Runbooks').length, 0, 'Check now writes no runbook notes: no more copies per machine');
  const m3 = await systems.ops.model();
  assert.ok(m3.services.length >= 2, 'Check now still adds what it found, as rows');
  assert.ok(m3.runbooks.length >= 3, 'the runbooks it needs arrive as rows');
  const upd = m3.runbooks.find((x) => x.name === 'Update Juniper');
  assert.ok(upd && upd.steps.length >= 3, 'a runbook row opens with its shared steps filled in');
  assert.match(r.words ?? r, /adds/i);
  assert.ok((r.created ?? []).length >= 5, 'every row from one press is returned together for one Undo');
});

test('gates: an agent refused Systems reads no rows; the person’s own agents read them', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  await c.part('systems').ops['move-run']();
  const store = S.sensitivity.emptyStore();
  const outside = gateFor(c.index, store, 'agent:chief', 'Chief');
  const map = await c.w.callTool('system_map', {}, outside);
  assert.doesNotMatch(map.text, /tide-app-1/, 'a refused agent is not shown folded rows');
  const spark = gateFor(c.index, { ...store, access: { neuralspark: ['open', 'work', 'personal'] } }, 'neuralspark', 'the host app');
  const map2 = await c.w.callTool('system_map', {}, spark);
  assert.match(map2.text, /tide-app-1/, 'an allowed agent reads folded rows through the same tool');
});

test('links: a [[name]] to a folded record resolves to its row for checks that cannot wait', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  await c.part('systems').ops['move-run']();
  const resolve = M.systemTables.makeRowResolver(c.index);
  assert.equal(resolve('[[tide-app-1]]'), `${BASE}/Services.md#tide-app-1`);
  assert.equal(resolve('Juniper'), null, 'notes still resolve through the index, not the rows');
  assert.equal(resolve('no such thing'), null);
});

test('sync: a conflict copy of a list merges row by row, every row kept', async () => {
  const T = S.systemTables;
  const dir = mkdtempSync(path.join(work, 'sync-'));
  const start = T.renderSystemsTable('service', { rows: [{ name: 'A', cells: { kind: 'Other', runsOn: '', url: '', port: '', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null }], logs: {}, runs: {} });
  writeFileSync(path.join(dir, 'Services.md'), start);
  const theirs = T.updateSystemsTable(start, 'service', (doc) => ({ ...doc, rows: [...doc.rows, { name: 'B', cells: { kind: 'Other', runsOn: '', url: '', port: '', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null }] }));
  // OneDrive's own copy, as it arrives (see findConflictCopies).
  writeFileSync(path.join(dir, 'Services (conflict, 5 Nov 2026 10.30 am, from OFFICE-PC).md'), theirs);
  const trashed = [];
  const sync = M.vaultSync.createVaultSync({
    root: () => dir,
    device: { id: '00000000-0000-0000-0000-000000000001', name: 'TEST-PC' },
    version: '9.9.0',
    identityId: async () => 'vault-id',
    place: async () => ({ kind: 'onedrive', name: 'OneDrive' }),
    pcs: async () => [],
    mayWrite: async () => true,
    readNote: async (rel) => readFileSync(path.join(dir, rel), 'utf8'),
    writeNote: async (rel, text) => writeFileSync(path.join(dir, rel), text),
    trash: async (rel) => {
      trashed.push(rel);
      rmSync(path.join(dir, rel));
    },
    move: async () => undefined,
    rescan: async () => undefined,
    windowsOnly: false,
  });
  const done = await sync.fix('merge', 'Services (conflict, 5 Nov 2026 10.30 am, from OFFICE-PC).md');
  assert.match(done.words, /merged into Services\.md, every line kept/);
  const back = T.readSystemsTable(readFileSync(path.join(dir, 'Services.md'), 'utf8'));
  assert.deepEqual(back.rows.map((r) => r.name).sort(), ['A', 'B'], 'both PCs’ rows kept');
  assert.deepEqual(trashed, ['Services (conflict, 5 Nov 2026 10.30 am, from OFFICE-PC).md']);
});

test('a row record is taken out from its own page, like a note from its own', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await systems.ops['move-run']();
  let m = await systems.ops.model();
  const row = m.services.find((s) => s.name === 'tide-app-1').path;
  const words = await systems.ops['remove-record'](row);
  assert.match(words, /Took tide-app-1 out of the list/);
  m = await systems.ops.model();
  assert.equal(m.services.length, 0, 'the row is gone');
});

test('records from rows answer the same tools, links and searches as notes did', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  const mapBefore = await c.w.callTool('system_map', {}, null);
  assert.match(mapBefore.text, /tide-app-1/);
  await systems.ops['move-run']();
  const mapAfter = await c.w.callTool('system_map', {}, null);
  assert.match(mapAfter.text, /tide-app-1/, 'the service map still names folded services');
  assert.match(mapAfter.text, /Juniper/, 'the map still names the machine');
  const found = await c.w.callTool('system_find', { query: 'tide-app-1' }, null);
  assert.match(found.text, /tide-app-1/, 'find still finds a folded service');
  assert.match(found.text, /8001/, 'find still shows its facts');
  const status = await c.w.callTool('system_status', {}, null);
  assert.match(status.text, /1 machine, 1 service/, 'counts read the same');
  // A [[link]] naming a folded record resolves to its row; search names it too.
  const rowPath = await systems.ops['resolve-row']('tide-app-1');
  assert.match(rowPath, /Services\.md#tide-app-1/);
  const hits = await systems.ops['search-rows']('tide-app');
  assert.ok(hits.some((h) => h.name === 'tide-app-1'), 'row search names the folded service');
  assert.equal(await systems.ops['resolve-row']('no such thing'), null);
});
