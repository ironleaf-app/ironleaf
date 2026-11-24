// node --test tests/systems-move-break.test.mjs — trying to break the records move (the v5-records-as-data move:
// 122 files folded into three lists, one backup, one Undo). Each test loses a person's words on an invented vault
// first, then proves the fix: words in odd places stay notes, same names stay, mid-move changes stay, Undo keeps what
// the person did since, the gate blocks when unsure, unreadable files are named, and a crash inside the Bin loses
// nothing. When unsure, a file stays a note.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';

const readdirSyncLocal = (d) => readdirSync(d, { withFileTypes: true });
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clockFrom } from './clock-from.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-systems-move-break-'));
let S;
let M;
const TODAY = new Date(2026, 9, 24, 10, 0);
clockFrom(TODAY);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(entry, ['system-tables', 'systems', 'life-records', 'life-modules', 'module-records', 'sensitivity'].map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${JSON.stringify(path.join(root, 'src/main/work-modules.ts'))};`, `export * as systemMove from ${JSON.stringify(path.join(root, 'src/main/life-records/system-move.ts'))};`, `export * as systemTables from ${JSON.stringify(path.join(root, 'src/main/life-records/system-tables.ts'))};`, `export { LIFE_RECORDS_GROUP } from ${JSON.stringify(path.join(root, 'src/main/life-records.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`, `export { makeGate } from ${JSON.stringify(path.join(root, 'src/main/agent-gate.ts'))};`, `export { createVaultBin } from ${JSON.stringify(path.join(root, 'src/main/bin.ts'))};`].join('\n'));
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

const MACHINE = (name, address) => `---\ntype: machine\nkind: "Server"\nrole: Media and backups\nos: Ubuntu 24.04.1 LTS\naddress: ${address}\nlocation: Garage rack\nstatus: Up\nchecked: 2026-10-23\n---\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: Ubuntu 24.04.1 LTS, up 11 days. |\n\n## Notes\n\n`;
const SERVICE = (name, machine, port) => `---\ntype: service\nkind: "Web app"\nruns_on: "[[${machine}]]"\nurl: http://${machine.toLowerCase()}.local:${port}\nport: "${port}"\nstatus: Up\ndepends_on: []\nrunbook:\nchecked: 2026-10-23\n---\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: running. |\n\n## Notes\n\n`;
const RUNBOOK_FACTORY = (name, target, steps) => `---\ntype: runbook\nfor: ["[[${target}]]"]\nevery: "On demand"\nlast_run:\n---\n## Steps\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n## Runs\n\n| Date | Result | Note |\n| --- | --- | --- |\n\n## Notes\n\n`;

const smallVault = () => ({
  '.neuralvault/areas.json': AREAS,
  [`${BASE}/Machines/Juniper.md`]: MACHINE('Juniper', '192.168.1.40'),
  [`${BASE}/Services/svc.md`]: SERVICE('svc', 'Juniper', '8001'),
});

function core(files, switches, extra = {}) {
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
    any: async (rel) => {
      try {
        readFileSync(path.join(dir, rel));
        return true;
      } catch {
        return false;
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
  return { w, dir, index, part, read, bin, dataDir };
}

/** The same vault opened again (an app restart: the index rebuilt from the disk, the receipt still there). */
function reopen(dir, dataDir, switches = { now: { systems: { on: true } } }) {
  const index = new M.VaultIndex();
  const all = [];
  const scan = (d, base) => {
    for (const e of readdirSyncLocal(d)) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === '.git' || rel === '.neuralvault/bin') continue;
        scan(path.join(d, e.name), rel);
      } else if (e.isFile() && rel.endsWith('.md') && !rel.startsWith('.neuralvault/bin/')) all.push(rel);
    }
  };
  scan(dir, '');
  for (const rel of all) {
    const text = readFileSync(path.join(dir, rel), 'utf8');
    index.set(rel, text, 0, text.length);
  }
  const bin = M.createVaultBin({ root: dir, now: () => TODAY.getTime() + 3600000 });
  const vaultObj = {
    root: dir,
    any: async (rel) => existsSync(path.join(dir, rel)),
    trash: async (rel, why) => {
      await bin.put(rel, { by: 'test', ...(why ? { why } : {}) });
      index.delete?.(rel);
    },
  };
  const optionsStore = { file: existsSync(path.join(dir, '.neuralvault', 'module-options.json')) ? readFileSync(path.join(dir, '.neuralvault', 'module-options.json'), 'utf8') : null };
  const w = new M.WorkModules(
    {
      vault: () => vaultObj,
      index,
      prefs: () => ({ templatesFolder: 'Templates', modules: switches.now }),
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
      now: () => new Date(TODAY.getTime() + 3600000),
      login: async () => ({ username: 'madeup', value: 'made-up-value' }),
      dataDir,
      device: { id: '00000000-0000-0000-0000-000000000001', name: 'TEST-PC' },
      appVersion: '9.9.0',
      optionsStore,
    },
    M.LIFE_RECORDS_GROUP,
  );
  w.setOptions = async (id, patch) => {
    const cur = optionsStore.file ? JSON.parse(optionsStore.file) : {};
    const next = { ...cur, [id]: { ...(cur[id] ?? {}), settings: { ...((cur[id] ?? {}).settings ?? {}), ...((patch ?? {}).settings ?? {}) } } };
    optionsStore.file = JSON.stringify(next);
    writeFileSync(path.join(dir, '.neuralvault', 'module-options.json'), optionsStore.file);
    return next;
  };
  w.options = async () => (optionsStore.file ? JSON.parse(optionsStore.file) : {});
  const part = (id) => w.parts.find((p) => p.id === id);
  const read = (rel) => readFileSync(path.join(dir, rel), 'utf8');
  return { w, dir, index, part, read, bin, dataDir };
}

/** A gate for an agent, with the person's levels (`store`). */
function gateFor(c, store, who, name) {
  const L = S.sensitivity;
  const sens = {
    stamp: () => 'x',
    level: (rel) => L.levelOf(store, rel, c.index.get(rel)?.props?.sensitivity, c.index.get(rel)?.props?.type).level,
    decide: (w, rel, n) => L.decide(store, w, rel, sens.level(rel), n),
    useGrant: () => false,
    allows: (w, level) => L.allows(store, w, level),
    audit: () => {},
  };
  return M.makeGate(sens, who, name);
}

test('break: words in odd places stay notes, never fold', () => {
  const T = S.systemTables;
  const BODY = `## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: running. |\n\n## Notes\n\n`;
  const svc = (body, props = {}, fm = '') => ({
    type: 'service',
    title: 'tide-app-1',
    props: { kind: 'Web app', runs_on: '[[Juniper]]', port: '8001', status: 'Up', ...props },
    content: `---\ntype: service\nkind: "Web app"\nruns_on: "[[Juniper]]"\nurl: http://juniper.local:8001\nport: "8001"\nstatus: Up\ndepends_on: []\nrunbook:\nchecked: 2026-10-23${fm}\n---\n${body}`,
  });
  const stays = [
    ['words before the first heading', svc(`Call Wilbur about this one.\n\n${BODY}`)],
    ['a custom frontmatter key', svc(BODY, { owner: 'Wilbur' }, '\nowner: Wilbur')],
    ['a tag in frontmatter', svc(BODY, { tags: ['urgent'] }, '\ntags: [urgent]')],
    ['an alias in frontmatter', svc(BODY, { alias: 'Photos' }, '\nalias: Photos')],
    ['a privacy marking in frontmatter', svc(BODY, { sensitivity: 'family' }, '\nsensitivity: family')],
    ['a comment in the body', svc(`<!-- ask Wilbur before stopping -->\n\n${BODY}`)],
    ['an extra section with words', svc(`${BODY}## Wiring\n\nPlug 3, second shelf.\n`)],
    ['notes under a smaller heading', svc(`## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: running. |\n\n### Notes\n\nDo not stop this.\n`)],
    ['a line under the health log', svc(`## Health log\n\nRing Wilbur if red.\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: running. |\n\n## Notes\n\n`)],
    ['a table of its own', svc(`${BODY}## Ports\n\n| What | Port |\n| --- | --- |\n| web | 8001 |\n`)],
    ['a checklist elsewhere', svc(`${BODY}## Todo\n\n- [ ] renew cert\n- [x] rebooted\n`)],
    ['a person link elsewhere', svc(`See [[Wilbur]] about this.\n\n${BODY}`)],
    ['an attached picture elsewhere', svc(`![[rack-photo.png]]\n\n${BODY}`)],
    ['a reminder elsewhere', svc(`## Todo\n\n- check disk \u23F0 2026-11-06\n\n${BODY}`)],
    ['a reminder inside a check line', svc(`## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: running \u23F0 2026-11-06 |\n\n## Notes\n\n`)],
    ['a link inside a check line', svc(`## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: running, see [[Wilbur]]. |\n\n## Notes\n\n`)],
    ['a tag inside a check line', svc(`## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: running #slow. |\n\n## Notes\n\n`)],
    ['a byte-order mark', { type: 'service', title: 'tide-app-1', props: {}, content: '﻿' + svc(BODY).content }],
    ['files kept with it', { ...svc(BODY), files: [`${BASE}/Services/Files/tide-app-1/rack-photo.png`] }],
  ];
  for (const [name, n] of stays) assert.equal(T.classifySystemsNote(n, {}).fold, false, `${name} stays a note`);
  // A runbook's extras stay too: a line among the steps, a line among the runs, its own details.
  const sys = S.systems;
  const upd = sys.runbooksFromCheck('Juniper', 'Ubuntu 24.04.1 LTS', [{ name: 'tide-app-1', kind: 'Web app' }]).find((r) => r.name === 'Update Juniper');
  const factory = { type: 'runbook', title: 'Update Juniper', props: { for: '[[Juniper]]', every: 'On demand', last_run: '' }, content: RUNBOOK_FACTORY('Update Juniper', 'Juniper', upd.steps) };
  const ctx = { osByName: { juniper: 'Ubuntu 24.04.1 LTS' }, servicesByMachine: { juniper: [{ name: 'tide-app-1' }] } };
  assert.equal(T.classifySystemsNote(factory, ctx).fold, true, 'the factory runbook still folds');
  assert.equal(T.classifySystemsNote({ ...factory, content: factory.content.replace('## Steps\n\n', '## Steps\n\nRing Wilbur first on Sundays.\n\n') }, ctx).fold, false, 'a line among the steps stays');
  assert.equal(T.classifySystemsNote({ ...factory, content: factory.content.replace('## Runs\n\n| Date | Result | Note |', '## Runs\n\nTook ten minutes last time.\n\n| Date | Result | Note |') }, ctx).fold, false, 'a line among the runs stays');
  assert.equal(T.classifySystemsNote({ ...factory, props: { ...factory.props, owner: 'Wilbur' }, content: factory.content.replace('last_run:\n', 'last_run:\nowner: Wilbur\n') }, ctx).fold, false, 'its own details stay');
});

test('break: an inline comment in the details stays a note', () => {
  const T = S.systemTables;
  const BODY = `## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: running. |\n\n## Notes\n\n`;
  const frame = `---\ntype: service\nkind: "Web app"\nruns_on: "[[Juniper]]"\nurl: http://juniper.local:8001\nport: "8001"\nstatus: Up\ndepends_on: []\nrunbook:\nchecked: 2026-10-23\n---\n${BODY}`;
  const svc = (content) => ({ type: 'service', title: 'tide-app-1', props: { kind: 'Web app', runs_on: '[[Juniper]]', port: '8001', status: 'Up' }, content });
  assert.equal(T.classifySystemsNote(svc(frame.replace('port: "8001"', 'port: "8001" # the fast one')), {}).fold, false, 'a comment after a known key stays');
  assert.equal(T.classifySystemsNote(svc(frame.replace('checked: 2026-10-23\n', 'checked: 2026-10-23\n# Wilbur set this up\n')), {}).fold, false, 'a comment line of its own stays');
  assert.equal(T.classifySystemsNote(svc(frame.replace('kind: "Web app"', 'kind: "C# box"')), {}).fold, true, 'a # inside quotes is a value, and still folds');
});

// A copy of the real notes, 5 Nov 2026: 88 of 123 stayed because the app itself writes an empty Credentials section
// into a record. The invented vaults here never had one. Empty is the frame; anything in it stays a note.
test('break: an empty Credentials section is the app\'s own frame; anything in it stays', () => {
  const T = S.systemTables;
  const svc = (content) => ({ type: 'service', title: 'bolt', props: { kind: 'Other', status: 'Up' }, content });
  const frame = `---\ntype: service\nkind: "Other"\nurl:\nport:\nstatus: Up\ndepends_on: []\nrunbook:\nchecked:\n---\n## Credentials\n\n\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n\n## Notes\n\n`;
  assert.equal(T.classifySystemsNote(svc(frame), {}).fold, true, 'the real frame folds');
  assert.equal(T.classifySystemsNote(svc(frame.replace('## Credentials\n\n', '## Credentials\n\n- Admin: [locked](secret:abc)\n')), {}).fold, false, 'a linked login stays');
  assert.equal(T.classifySystemsNote(svc(frame.replace('## Credentials\n\n', '## Credentials\n\nthe password is on the fridge\n')), {}).fold, false, 'words under Credentials stay');
});

test('break: near-filler still folds (blank lines, CRLF, long lines, renamed checks)', () => {
  const T = S.systemTables;
  const BODY = `## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: running. |\n\n## Notes\n\n`;
  const svc = (content) => ({ type: 'service', title: 'tide-app-1', props: { kind: 'Web app', runs_on: '[[Juniper]]', port: '8001', status: 'Up' }, content });
  const frame = `---\ntype: service\nkind: "Web app"\nruns_on: "[[Juniper]]"\nurl: http://juniper.local:8001\nport: "8001"\nstatus: Up\ndepends_on: []\nrunbook:\nchecked: 2026-10-23\n---\n${BODY}`;
  assert.equal(T.classifySystemsNote(svc(frame), {}).fold, true, 'the frame folds');
  assert.equal(T.classifySystemsNote(svc(`${frame}\n\n\n`), {}).fold, true, 'extra blank lines fold');
  assert.equal(T.classifySystemsNote(svc(frame.replace(/\n/g, '\r\n')), {}).fold, true, 'a CRLF file folds');
  assert.equal(T.classifySystemsNote(svc(frame.replace('Checked: running.', `Checked: running. ${'x'.repeat(5000)}`)), {}).fold, true, 'a very long check line folds');
  assert.equal(T.classifySystemsNote(svc(frame.replace('## Health log', '## Checks')), {}).fold, true, 'a renamed checks heading folds');
});

test('break: one name in two folders stays two notes, both listed after', async () => {
  const files = smallVault();
  files[`${BASE}/Services/dup.md`] = SERVICE('dup', 'Juniper', '8001');
  files['Home/Other/dup.md'] = SERVICE('dup', 'Juniper', '9001');
  const c = core(files, { now: { systems: { on: true } } });
  const systems = c.part('systems');
  const preview = await systems.ops['move-preview']();
  assert.equal(preview.fold.filter((f) => f.name === 'dup').length, 0, 'neither same-named note folds');
  assert.equal(preview.stay.filter((f) => f.name === 'dup').length, 2, 'both stay');
  await systems.ops['move-run']();
  const m = await systems.ops.model();
  assert.deepEqual(m.services.filter((s) => s.name === 'dup').map((s) => s.port).sort(), ['8001', '9001'], 'both records list with their own facts');
});

test('break: a record already in the list stays a note', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await M.systemTables.addTableRow(c.w, 'service', { name: 'svc', cells: { kind: 'Other', runsOn: '', url: '', port: '9999', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null });
  const preview = await systems.ops['move-preview']();
  assert.equal(preview.fold.some((f) => f.name === 'svc'), false, 'the note stays when its row is already there');
  await systems.ops['move-run']();
  const m = await systems.ops.model();
  assert.equal(m.services.find((s) => s.name === 'svc').path, `${BASE}/Services/svc.md`, 'the note is the record');
});

test('break: privacy-marked notes stay notes', async () => {
  const fam = SERVICE('svc', 'Juniper', '8001').replace('status: Up', 'status: Up\nsensitivity: family');
  const files = smallVault();
  files[`${BASE}/Services/svc.md`] = fam;
  const c = core(files, { now: { systems: { on: true } } });
  const preview = await c.part('systems').ops['move-preview']();
  assert.equal(preview.fold.some((f) => f.name === 'svc'), false, 'a family-marked note stays');
  // Marked through the vault's privacy file instead of the note.
  const c2 = core(smallVault(), { now: { systems: { on: true } } });
  mkdirSync(path.join(c2.dir, '.neuralvault'), { recursive: true });
  writeFileSync(path.join(c2.dir, '.neuralvault', 'sensitivity.json'), JSON.stringify({ version: 1, folders: {}, types: {}, items: { [`${BASE}/Services/svc.md`]: 'family' }, access: {}, photos: 'ask', ignored: [] }));
  const preview2 = await c2.part('systems').ops['move-preview']();
  assert.equal(preview2.fold.some((f) => f.name === 'svc'), false, 'a file marked family in privacy settings stays');
});

test('break: the gate blocks on an unreadable PC, reads numbered days, names stale PCs', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  mkdirSync(path.join(c.dir, '.neuralvault', 'pcs'), { recursive: true });
  const pc = (name, body) => writeFileSync(path.join(c.dir, '.neuralvault', 'pcs', name), body);
  // A corrupt file from another PC blocks: unsure means wait.
  pc('11111111-1111-1111-1111-111111111111.json', 'not json{{{');
  const s1 = await systems.ops['move-state']();
  assert.ok(s1.pcsBlock, 'an unreadable PC file blocks the move');
  await assert.rejects(() => systems.ops['move-run'](), /couldn.t be read/, 'the refusal says so in plain words');
  // A numbered day counts the same as a written one.
  pc('11111111-1111-1111-1111-111111111111.json', JSON.stringify({ name: 'OFFICE-PC', at: Date.now() - 60000, version: '1.0.0' }));
  const s2 = await systems.ops['move-state']();
  assert.ok(s2.pcsBlock && s2.pcsBlock.names.includes('OFFICE-PC'), 'a numbered day still blocks when behind');
  // A stale PC is named, not blocking.
  pc('11111111-1111-1111-1111-111111111111.json', JSON.stringify({ name: 'OFFICE-PC', at: new Date(Date.now() - 40 * 86400000).toISOString(), version: '1.0.0' }));
  const s3 = await systems.ops['move-state']();
  assert.equal(s3.pcsBlock, null, 'a stale PC does not block');
  const preview = await systems.ops['move-preview']();
  assert.ok(preview.words.join('\n').includes('OFFICE-PC'), 'the stale PC is named in the preview');
});

test('break: a note that cannot be read is left alone and named, never folded', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  // On disk but never indexed: an online-only file whose read failed (the indexer leaves it out).
  const rel = `${BASE}/Services/ghost.md`;
  writeFileSync(path.join(c.dir, rel), SERVICE('ghost', 'Juniper', '8100'));
  const preview = await systems.ops['move-preview']();
  assert.equal(preview.fold.some((f) => f.name === 'ghost'), false, 'never folded');
  assert.ok(preview.words.join('\n').includes('ghost'), 'named in the preview');
  const words = await systems.ops['move-run']();
  assert.match(words, /ghost/, 'the result says it was left alone');
  assert.equal(c.read(rel), SERVICE('ghost', 'Juniper', '8100'), 'untouched on disk');
});

test('break: a note changed mid-move stays a note, with no shadow row', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await M.systemMove.runMovePhase(c.w, 'backup');
  const rel = `${BASE}/Services/svc.md`;
  const edited = `${c.read(rel)}Do not stop this during backups.\n`;
  writeFileSync(path.join(c.dir, rel), edited);
  c.index.set(rel, edited, 0, edited.length);
  await M.systemMove.runMovePhase(c.w, 'tables');
  await M.systemMove.runMovePhase(c.w, 'moves');
  const words = await M.systemMove.runMovePhase(c.w, 'finish');
  assert.match(words, /stayed|left/i, 'the finish says a note stayed');
  assert.equal(c.read(rel), edited, 'the note is still where it was, words and all');
  const m = await systems.ops.model();
  assert.deepEqual(m.services.filter((s) => s.name === 'svc').map((s) => s.path), [rel], 'the note is the one record, no shadow row');
});

test('break: an outside edit between plan and move still undoes cleanly', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await M.systemMove.runMovePhase(c.w, 'backup');
  // Another PC changed the file; this index still holds the old words.
  const rel = `${BASE}/Services/svc.md`;
  const newer = c.read(rel).replace('8001', '8002');
  writeFileSync(path.join(c.dir, rel), newer);
  await M.systemMove.runMovePhase(c.w, 'tables');
  await M.systemMove.runMovePhase(c.w, 'moves');
  await M.systemMove.runMovePhase(c.w, 'finish');
  assert.equal(await systems.ops['move-undo']().then((w) => /back/.test(w)), true, 'Undo still puts it back');
  assert.equal(c.read(rel), newer, 'the newer words came back');
});

test('break: a locked file stops the move in plain words, and Undo puts back', async () => {
  const files = smallVault();
  files[`${BASE}/Services/aaa.md`] = SERVICE('aaa', 'Juniper', '8002');
  const c = core(files, { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await M.systemMove.runMovePhase(c.w, 'backup');
  await M.systemMove.runMovePhase(c.w, 'tables');
  chmodSync(path.join(c.dir, BASE, 'Machines'), 0o555);
  let err = '';
  try {
    await M.systemMove.runMovePhase(c.w, 'moves');
  } catch (e) {
    err = e.message;
  } finally {
    chmodSync(path.join(c.dir, BASE, 'Machines'), 0o755);
  }
  assert.match(err, /Juniper/, 'it names the stuck note');
  assert.doesNotMatch(err, /EACCES|EPERM|ENOENT/, 'in plain words, not an error code');
  const st = await systems.ops['move-state']();
  assert.equal(st.interrupted, true, 'the move says it did not finish');
  const undone = await systems.ops['move-undo']();
  assert.match(undone, /back/, 'Undo puts back what moved');
  assert.equal(c.read(`${BASE}/Services/aaa.md`), files[`${BASE}/Services/aaa.md`], 'the moved note is back byte for byte');
  assert.equal(c.read(`${BASE}/Machines/Juniper.md`), files[`${BASE}/Machines/Juniper.md`], 'the stuck note was never touched');
});

test('break: a full disk at the lists fails plainly, then carries on and ends right', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await M.systemMove.runMovePhase(c.w, 'backup');
  // The disk fills while the second list is written: the first list is already there.
  const realWrite = c.w.d.writeNote;
  c.w.d.writeNote = async (rel, text) => {
    if (rel.endsWith('Services.md')) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    return realWrite(rel, text);
  };
  const err = await M.systemMove.runMovePhase(c.w, 'tables').then(() => '', (e) => e.message);
  c.w.d.writeNote = realWrite;
  assert.match(err, /disk is full/, 'says the disk is full in plain words');
  assert.match(err, /Carry on/, 'says to carry on');
  assert.doesNotMatch(err, /ENOSPC/, 'never the error code');
  const st = await systems.ops['move-state']();
  assert.equal(st.interrupted, true, 'the move says it did not finish');
  const words = await systems.ops['move-resume']();
  assert.match(words, /finish|folded/i, 'carrying on finishes');
  const m = await systems.ops.model();
  assert.equal(m.services.length, 1, 'every service lists once');
  assert.equal(m.machines.length, 1, 'every machine lists once');
  // Every moved row carries its fingerprint, the retried list among them, so Undo still knows a row
  // the person changed since from one they did not touch.
  const receipt = JSON.parse(readFileSync(path.join(c.dir, '.neuralvault', 'systems-move.json'), 'utf8'));
  const sigged = Object.values(receipt.rowSig ?? {}).reduce((n, byKind) => n + Object.keys(byKind).length, 0);
  assert.equal(sigged, receipt.planned.length, 'every moved row fingerprinted after the retry');
  const rowPath = m.machines.find((x) => x.name === 'Juniper').path;
  await systems.ops['set-field']({ kind: 'machine', path: rowPath, field: 'address', value: '192.168.1.99' });
  const undone = await systems.ops['move-undo']();
  assert.match(undone, /stay|stays/i, 'the fixed record stays in the list with its fix');
  const back = await systems.ops.model();
  assert.equal(back.machines.find((x) => x.name === 'Juniper').address, '192.168.1.99', 'the fix is still there');
});

test('break: a full disk at the moves fails plainly, then carries on and ends right', async () => {
  const files = smallVault();
  files[`${BASE}/Services/aaa.md`] = SERVICE('aaa', 'Juniper', '8002');
  const c = core(files, { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await M.systemMove.runMovePhase(c.w, 'backup');
  await M.systemMove.runMovePhase(c.w, 'tables');
  // A stand-in for the Bin: the second note's move fails as a full disk fails.
  const realBin = M.createVaultBin({ root: c.dir, now: () => TODAY.getTime() });
  let n = 0;
  const standin = { list: (...a) => realBin.list(...a), put: async (...a) => (++n === 2 ? Promise.reject(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })) : realBin.put(...a)) };
  const err = await M.systemMove.runMovePhase(c.w, 'moves', { bin: standin }).then(() => '', (e) => e.message);
  assert.match(err, /disk is full/, 'says the disk is full in plain words');
  assert.match(err, /already in the Bin/, 'says what moved so far');
  assert.doesNotMatch(err, /ENOSPC/, 'never the error code');
  const st = await systems.ops['move-state']();
  assert.equal(st.interrupted, true, 'the move says it did not finish');
  const words = await systems.ops['move-resume']();
  assert.match(words, /finish|folded/i, 'carrying on finishes');
  const m = await systems.ops.model();
  assert.equal(m.services.length, 2, 'every service lists once');
  assert.equal(m.machines.length, 1, 'every machine lists once');
  assert.equal(new Set([...m.services, ...m.machines].map((s) => s.name)).size, 3, 'no doubled rows');
  await systems.ops['move-undo']();
  for (const [rel, text] of Object.entries(files)) assert.equal(c.read(rel), text, `${rel} back byte for byte`);
});

test('break: a failed backup says so plainly and changes nothing', async () => {
  const blocker = path.join(work, `blocker-${Date.now()}`);
  writeFileSync(blocker, 'x');
  const c = core(smallVault(), { now: { systems: { on: true } } }, { dataDir: path.join(blocker, 'nope') });
  const err = await c.part('systems').ops['move-run']().then(() => '', (e) => e.message);
  assert.match(err, /back ?up/i, 'it says the backup failed');
  assert.match(err, /nothing changed/i, 'it says nothing changed');
  assert.doesNotMatch(err, /ENOTDIR|ENOENT|EACCES/, 'in plain words, not an error code');
  assert.equal(existsSync(path.join(c.dir, '.neuralvault', 'systems-move.json')), false, 'no receipt');
  assert.equal(existsSync(path.join(c.dir, `${BASE}/Services.md`)), false, 'no lists written');
});

test('break: Undo after typing keeps the typed record and names it, with no duplicate', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await systems.ops['move-run']();
  const m0 = await systems.ops.model();
  const rowPath = m0.services.find((s) => s.name === 'svc').path;
  await systems.ops['note-words'](rowPath, 'My own words here.');
  const undone = await systems.ops['move-undo']();
  assert.match(undone, /back/, 'the untouched notes come back');
  assert.match(undone, /stay|stays/i, 'it says the typed record stays in the list');
  const m = await systems.ops.model();
  assert.equal(m.services.filter((s) => s.name === 'svc').length, 1, 'no duplicate record');
  assert.match(c.read(`${BASE}/Services/svc.md`), /My own words here/, 'the typed words are in the note');
});

test('break: Undo after a list fix keeps the fix and names it', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await systems.ops['move-run']();
  const m0 = await systems.ops.model();
  const rowPath = m0.services.find((s) => s.name === 'svc').path;
  await systems.ops['set-field']({ kind: 'service', path: rowPath, field: 'url', value: 'http://fixed.local:9001' });
  const undone = await systems.ops['move-undo']();
  assert.match(undone, /stay|stays/i, 'it says the fixed record stays in the list');
  const m = await systems.ops.model();
  assert.equal(m.services.find((s) => s.name === 'svc').url, 'http://fixed.local:9001', 'the fix is still there');
  assert.equal(m.services.find((s) => s.name === 'svc').path, `${BASE}/Services.md#svc`, 'still the row');
});

test('break: Undo counts notes already back, and only names what is missing', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await systems.ops['move-run']();
  const items = await c.bin.list();
  await c.bin.forget(items.find((i) => i.path.endsWith('Juniper.md')).id);
  const first = await systems.ops['move-undo']().then(() => '', (e) => e.message);
  assert.match(first, /Juniper/, 'it names the missing note');
  assert.match(first, /backup/i, 'it names the backup');
  assert.equal(c.read(`${BASE}/Services/svc.md`), smallVault()[`${BASE}/Services/svc.md`], 'the other note came back');
  const retry = await systems.ops['move-undo']().then(() => '', (e) => e.message);
  assert.match(retry, /Juniper/, 'the retry still names the missing note');
  assert.doesNotMatch(retry, /Services\/svc/, 'but not the note that is already back');
});

test('break: Undo works after a restart, and a second Undo says so', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const before = { ...smallVault() };
  await c.part('systems').ops['move-run']();
  const r = reopen(c.dir, c.dataDir);
  const undone = await r.part('systems').ops['move-undo']();
  assert.match(undone, /back/, 'Undo works after a restart');
  for (const [rel, text] of Object.entries(before)) assert.equal(r.read(rel), text, `${rel} back byte for byte`);
  assert.equal(await r.part('systems').ops['move-undo'](), 'Nothing to put back.', 'a second Undo says so');
});

test('break: a record added since the move stays added through Undo', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await systems.ops['move-run']();
  await systems.ops['add-service']({ name: 'brand-new', runs_on: 'Juniper', port: '8200' });
  await systems.ops['move-undo']();
  const m = await systems.ops.model();
  assert.ok(m.services.some((s) => s.name === 'brand-new'), 'the new record is still there');
  assert.ok(m.services.some((s) => s.name === 'svc'), 'the folded note is back too');
});

test('break: two names sharing one slug open their own pages', async () => {
  const files = smallVault();
  files[`${BASE}/Services/A B.md`] = SERVICE('A B', 'Juniper', '8001');
  files[`${BASE}/Services/A-B.md`] = SERVICE('A-B', 'Juniper', '8002');
  const c = core(files, { now: { systems: { on: true } } });
  await c.part('systems').ops['move-run']();
  const m = await c.part('systems').ops.model();
  const paths = m.services.filter((s) => s.name === 'A B' || s.name === 'A-B').map((s) => s.path);
  assert.equal(new Set(paths).size, 2, 'each record has its own page');
  for (const p of paths) {
    const hit = await M.systemTables.rowByPath(c.w, p);
    assert.ok(hit, `${p} opens`);
  }
  const a = await M.systemTables.rowByPath(c.w, m.services.find((s) => s.name === 'A B').path);
  const b = await M.systemTables.rowByPath(c.w, m.services.find((s) => s.name === 'A-B').path);
  assert.equal(a.row.cells.port, '8001', 'A B opens its own facts');
  assert.equal(b.row.cells.port, '8002', 'A-B opens its own facts');
  assert.equal(await M.systemTables.resolveRowTarget(c.w, 'A-B'), m.services.find((s) => s.name === 'A-B').path, 'a link to A-B opens A-B');
});

test('break: a row without a name is kept byte for byte across writes', () => {
  const T = S.systemTables;
  const row = (name, cells = {}) => ({ name, cells: { kind: 'Other', runsOn: '', url: '', port: '', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '', ...cells }, note: null });
  let text = T.renderSystemsTable('service', { rows: [row('Good', { port: '1' })] });
  text = text.replace('| Good |', '|  | Other |  |  | 9999 | Up |  |  |  |  |  |\n| Good |');
  const next = T.updateSystemsTable(text, 'service', (doc) => doc);
  assert.ok(next.includes('9999'), 'the nameless row survives a write');
  assert.ok(T.readSystemsTable(next).rows.some((r) => r.name === 'Good'), 'the named row still reads');
});

test('break: pipe, link and dotted names round-trip through the lists', () => {
  const T = S.systemTables;
  const row = (name) => ({ name, cells: { kind: 'Other', runsOn: '', url: '', port: '', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null });
  for (const name of ['a|b', 'photo.lib', 'Café box']) {
    const back = T.readSystemsTable(T.renderSystemsTable('service', { rows: [row(name)] }));
    assert.deepEqual(back.rows.map((r) => r.name), [name], `${name} round-trips`);
  }
});

test('break: a note with files kept with it stays a note', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  mkdirSync(path.join(c.dir, BASE, 'Services', 'Files', 'svc'), { recursive: true });
  writeFileSync(path.join(c.dir, BASE, 'Services', 'Files', 'svc', 'rack-photo.png'), 'fake-bytes');
  const preview = await systems.ops['move-preview']();
  assert.equal(preview.fold.some((f) => f.name === 'svc'), false, 'a note with files stays');
  await systems.ops['move-run']();
  assert.equal(c.read(`${BASE}/Services/svc.md`), smallVault()[`${BASE}/Services/svc.md`], 'untouched');
});

test('break: a refused agent is told rows are refused, not that there are none', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const store = S.sensitivity.emptyStore();
  const before = await c.w.callTool('system_map', {}, gateFor(c, store, 'agent:chief', 'Chief'));
  assert.match(before.text, /isn.t allowed/, 'before the move it says refused');
  await c.part('systems').ops['move-run']();
  const after = await c.w.callTool('system_map', {}, gateFor(c, store, 'agent:chief', 'Chief'));
  assert.match(after.text, /isn.t allowed/, 'after the move it still says refused, not none');
  assert.doesNotMatch(after.text, /svc/, 'and shows nothing');
});

test('break: a crash inside the Bin loses nothing', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const rel = `${BASE}/Services/svc.md`;
  const words = c.read(rel);
  // The app died after the note moved but before its card was written: the intent file says where it was.
  const id = 'm38000-abcdef';
  mkdirSync(path.join(c.dir, '.neuralvault', 'bin', id, 'item'), { recursive: true });
  writeFileSync(path.join(c.dir, '.neuralvault', 'bin', id, 'item', 'svc.md'), words);
  writeFileSync(path.join(c.dir, '.neuralvault', 'bin', id, 'moving.json'), JSON.stringify({ id, path: rel, kind: 'note', title: 'svc', by: 'Systems tidy-up', at: TODAY.getTime(), why: 'folded into the Systems lists' }));
  rmSync(path.join(c.dir, rel));
  c.index.delete?.(rel);
  const items = await c.bin.list();
  assert.ok(items.some((i) => i.path === rel), 'the note is listed in the Bin again');
  const r = await c.bin.restore(id);
  assert.equal(r.restored, rel, 'it comes back where it was');
  assert.equal(c.read(rel), words, 'word for word');
  // The app died before anything moved: the intent file is cleaned, the original untouched.
  const id2 = 'm38001-abcdef';
  mkdirSync(path.join(c.dir, '.neuralvault', 'bin', id2), { recursive: true });
  writeFileSync(path.join(c.dir, '.neuralvault', 'bin', id2, 'moving.json'), JSON.stringify({ id: id2, path: rel, kind: 'note', title: 'svc', by: 'Systems tidy-up', at: TODAY.getTime() }));
  const items2 = await c.bin.list();
  assert.equal(items2.some((i) => i.id === id2), false, 'no phantom item');
  assert.equal(c.read(rel), words, 'the original untouched');
  assert.equal(existsSync(path.join(c.dir, '.neuralvault', 'bin', id2, 'moving.json')), false, 'the intent file cleaned');
});

test('break: a deleted list still undoes every note', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await systems.ops['move-run']();
  rmSync(path.join(c.dir, `${BASE}/Services.md`));
  c.index.delete?.(`${BASE}/Services.md`);
  const st = await systems.ops['move-state']();
  assert.ok(st.done && st.undoable, 'Undo is still offered');
  await systems.ops['move-undo']();
  const m = await systems.ops.model();
  assert.ok(m.services.some((s) => s.name === 'svc'), 'the note is back and listed');
});

test('break: a record changed on both PCs is said on its page, with one way to choose', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await systems.ops['move-run']();
  const T = S.systemTables;
  const rel = `${BASE}/Services.md`;
  const start = c.read(rel);
  // This PC set the port to 9001; the other PC, from the same file, set it to 9002. The merge keeps both lines.
  const m0 = await systems.ops.model();
  await systems.ops['set-field']({ kind: 'service', path: m0.services.find((s) => s.name === 'svc').path, field: 'port', value: '9001' });
  const mine = c.read(rel);
  const theirs = T.updateSystemsTable(start, 'service', (doc) => ({ ...doc, rows: doc.rows.map((r) => (r.name === 'svc' ? { ...r, cells: { ...r.cells, port: '9002' } } : r)) }));
  const merged = T.mergeSystemsTables(mine, theirs, 'OFFICE-PC’s copy', '5 Nov 2026');
  writeFileSync(path.join(c.dir, rel), merged.text);
  c.index.set(rel, merged.text, 0, merged.text.length);
  // The page still reads first-wins, but now says so, with the other version beside it.
  const m1 = await systems.ops.model();
  assert.equal(m1.services.find((s) => s.name === 'svc').port, '9001', 'the page shows this PC’s version');
  assert.equal(m1.conflicts.length, 1, 'the disagreement is named');
  assert.equal(m1.conflicts[0].name, 'svc');
  assert.deepEqual(m1.conflicts[0].others.map((o) => o.cells.port), ['9002'], 'the other PC’s version is there to choose');
  // One way to choose: keep the other version, and the list holds one line.
  const kept = await systems.ops['resolve-conflict']({ kind: 'service', name: 'svc', keep: 1 });
  assert.match(kept.words, /Kept your choice/, 'said in plain words');
  const m2 = await systems.ops.model();
  assert.equal(m2.services.find((s) => s.name === 'svc').port, '9002', 'the chosen version is the record now');
  assert.equal(m2.conflicts.length, 0, 'nothing left to choose');
  const after = c.read(rel);
  assert.equal(after.split('\n').filter((l) => l.startsWith('| svc |')).length, 1, 'one line in the file');
  assert.ok(!T.readSystemsTable(after).dupes.length, 'the file reads clean');
  assert.match(after.split('\n').find((l) => l.startsWith('| svc |')), /9002/, 'the chosen facts are in the line');
  assert.ok(!after.includes('## Merged from'), 'no emptied merge section left behind');
});

test('break: a deleted list is said on the Systems page, with the Undo or the backup', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  assert.deepEqual((await systems.ops['move-state']()).missingLists, [], 'no lists missed before the move');
  await systems.ops['move-run']();
  assert.deepEqual((await systems.ops['move-state']()).missingLists, [], 'no lists missed while they are there');
  rmSync(path.join(c.dir, `${BASE}/Services.md`));
  c.index.delete?.(`${BASE}/Services.md`);
  const st = await systems.ops['move-state']();
  assert.deepEqual(st.missingLists, [`${BASE}/Services.md`], 'the gone list is named');
  assert.match(st.missingWords.join(' '), /Services\.md.*gone/, 'said plainly');
  assert.match(st.missingWords.join(' '), /Undo puts every folded note back/, 'the Undo offered');
  assert.equal(st.undoable, true, 'Undo still offered');
  await systems.ops['move-undo']();
  assert.deepEqual((await systems.ops['move-state']()).missingLists, [], 'nothing missed once put back');
  // Without the Undo (the Bin emptied since), the backup is offered instead.
  const c2 = core(smallVault(), { now: { systems: { on: true } } });
  const systems2 = c2.part('systems');
  await systems2.ops['move-run']();
  rmSync(path.join(c2.dir, `${BASE}/Services.md`));
  c2.index.delete?.(`${BASE}/Services.md`);
  for (const it of await c2.bin.list()) await c2.bin.forget(it.id);
  const st2 = await systems2.ops['move-state']();
  assert.equal(st2.undoable, false, 'no Undo once the Bin no longer holds the notes');
  assert.match(st2.missingWords.join(' '), /backup.*still has everything/, 'the backup offered instead');
  assert.match(st2.missingWords.join(' '), /\.zip/, 'with where it is');
});

test('break: folded rows keep their links both ways, and the graph shows them', async () => {
  const files = smallVault();
  files['Home/Log.md'] = '# Log\n\nSaw [[svc]] slow today, on [[Juniper]].\n';
  // svc also names a plain note, so a row can link a note that never folds.
  files[`${BASE}/Services/svc.md`] = files[`${BASE}/Services/svc.md`].replace('depends_on: []', 'depends_on: ["[[Log]]"]');
  const c = core(files, { now: { systems: { on: true } } });
  const systems = c.part('systems');
  const beforeTiff = c.index.backlinks(`${BASE}/Machines/Juniper.md`).map((b) => b.source).sort();
  assert.deepEqual(beforeTiff, [`${BASE}/Services/svc.md`, 'Home/Log.md'].sort(), 'before: the machine note shows its notes');
  await systems.ops['move-run']();
  const m = await systems.ops.model();
  const svcRow = m.services.find((s) => s.name === 'svc').path;
  const tiffRow = m.machines.find((x) => x.name === 'Juniper').path;
  assert.match(svcRow, /Services\.md#/);
  assert.match(tiffRow, /Machines\.md#/);
  // One way: the note shows the rows it names, not missing notes.
  assert.deepEqual(c.index.outgoing('Home/Log.md').map((o) => o.resolved).sort(), [svcRow, tiffRow].sort(), 'the note reaches both rows');
  // The other way: each row shows what links to it, as its note did.
  assert.ok(c.index.backlinks(svcRow).map((b) => b.source).includes('Home/Log.md'), 'the service row shows the note');
  assert.deepEqual(c.index.backlinks(tiffRow).map((b) => b.source).sort(), ['Home/Log.md', svcRow].sort(), 'the machine row shows the note and the service row, as before');
  // A row linking a plain note shows on the note too: no link lost either way.
  assert.ok(c.index.backlinks('Home/Log.md').map((b) => b.source).includes(svcRow), 'the plain note shows the row that names it');
  // The graph stands the rows where their notes stood.
  const g = c.index.graph('');
  const ids = new Set(g.nodes.map((n) => n.id));
  assert.ok(ids.has(svcRow) && ids.has(tiffRow), 'both rows are in the graph');
  const edges = g.links.map((l) => `${l.source} -> ${l.target}`);
  assert.ok(edges.includes(`Home/Log.md -> ${svcRow}`), 'note to row');
  assert.ok(edges.includes(`Home/Log.md -> ${tiffRow}`), 'note to row');
  assert.ok(edges.includes(`${svcRow} -> ${tiffRow}`), 'row to row, from Runs on');
  assert.ok(edges.includes(`${svcRow} -> Home/Log.md`), 'row to note, from Depends on');
  assert.ok(!edges.some((e) => e.includes('unresolved:svc') || e.includes('unresolved:juniper')), 'no missing shadows of folded records');
});

test('break: a note typed into while tidying folds from its newest words', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await M.systemMove.runMovePhase(c.w, 'backup');
  await M.systemMove.runMovePhase(c.w, 'tables');
  const svcRel = `${BASE}/Services/svc.md`;
  const edited = c.read(svcRel).replace('| 2026-10-23 | Up | Checked: running. |', '| 2026-10-23 | Up | Checked: running. |\n| 2026-10-24 | Up | Checked: still running after the kernel patch. |');
  writeFileSync(path.join(c.dir, svcRel), edited);
  c.index.set(svcRel, edited, 0, edited.length);
  await M.systemMove.runMovePhase(c.w, 'moves');
  await M.systemMove.runMovePhase(c.w, 'finish');
  const m = await systems.ops.model();
  const svc = m.services.find((s) => s.name === 'svc');
  assert.ok(JSON.stringify(svc.health ?? []).includes('kernel patch'), 'the row carries the newest check, not the list as first written');
});

test('break: a row fixed while tidying keeps the fix over note drift', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await M.systemMove.runMovePhase(c.w, 'backup');
  await M.systemMove.runMovePhase(c.w, 'tables');
  const m0 = await systems.ops.model();
  await systems.ops['set-field']({ kind: 'service', path: m0.services.find((s) => s.name === 'svc').path, field: 'port', value: '9001' });
  const svcRel = `${BASE}/Services/svc.md`;
  const edited = c.read(svcRel).replace('port: "8001"', 'port: "8002"');
  writeFileSync(path.join(c.dir, svcRel), edited);
  c.index.set(svcRel, edited, 0, edited.length);
  await M.systemMove.runMovePhase(c.w, 'moves');
  await M.systemMove.runMovePhase(c.w, 'finish');
  const m = await systems.ops.model();
  assert.equal(m.services.find((s) => s.name === 'svc').port, '9001', 'the person’s fix wins over the note’s drift');
});

test('break: a record added while the lists are written is merged in, never written over', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await M.systemMove.runMovePhase(c.w, 'backup');
  const realWrite = c.w.d.writeNote;
  let injected = false;
  c.w.d.writeNote = async (rel, text) => {
    if (!injected) {
      injected = true;
      await M.systemTables.addTableRow(c.w, 'service', { name: 'agent-box', cells: { kind: 'Web app', runsOn: '', url: '', port: '9009', status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' } });
    }
    return realWrite(rel, text);
  };
  await M.systemMove.runMovePhase(c.w, 'tables');
  c.w.d.writeNote = realWrite;
  await M.systemMove.runMovePhase(c.w, 'moves');
  await M.systemMove.runMovePhase(c.w, 'finish');
  const m = await systems.ops.model();
  assert.deepEqual(m.services.map((s) => s.name).sort(), ['agent-box', 'svc'], 'the added record and the folded one, each once');
  await systems.ops['move-undo']();
  const back = await systems.ops.model();
  assert.equal(back.services.find((s) => s.name === 'agent-box').path.includes('#') && true, true, 'the added record stays a row after Undo');
});

test('break: a second tidy-up while one runs waits instead of doubling', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  const [a, b] = await Promise.allSettled([systems.ops['move-run'](), systems.ops['move-run']()]);
  const words = [a, b].map((r) => (r.status === 'fulfilled' ? r.value : r.reason.message).slice(0, 60));
  assert.equal([a.status, b.status].sort().join(','), 'fulfilled,rejected', `one runs (${words.join(' | ')})`);
  assert.match([a, b].find((r) => r.status === 'rejected').reason.message, /already running/, 'the second waits in plain words');
  const m = await systems.ops.model();
  assert.equal(m.services.filter((s) => s.name === 'svc').length, 1, 'folded once, never doubled');
});

test('break: a vault renamed mid-move says its folder is gone, then carries on', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const systems = c.part('systems');
  await M.systemMove.runMovePhase(c.w, 'backup');
  renameSync(c.dir, `${c.dir}-renamed`);
  const err = await M.systemMove.runMovePhase(c.w, 'tables').then(() => '', (e) => e.message);
  assert.match(err, /notes folder is no longer there/, 'said plainly');
  renameSync(`${c.dir}-renamed`, c.dir);
  await systems.ops['move-resume']();
  const m = await systems.ops.model();
  assert.equal(m.services.length, 1, 'carrying on finishes');
  assert.equal(m.machines.length, 1, 'every record folded');
});

test('break: two backups in a minute keep their own zips', async () => {
  const c = core(smallVault(), { now: { systems: { on: true } } });
  const a = await M.systemMove.backupVault(c.w);
  const b = await M.systemMove.backupVault(c.w);
  assert.notEqual(a.zip, b.zip, 'each backup its own name');
  assert.ok(existsSync(a.zip) && existsSync(b.zip), 'both zips on disk');
  assert.match(b.zip, /-2\.zip$/, 'the second numbered, not overwritten');
});

test('break: every clashing list is named, not just the last', async () => {
  const files = smallVault();
  files[`${BASE}/Machines.md`] = '# My own machines note\n\nNot a list.\n';
  files[`${BASE}/Services.md`] = '# My own services note\n\nNot a list.\n';
  const c = core(files, { now: { systems: { on: true } } });
  const preview = await c.part('systems').ops['move-preview']();
  assert.ok(preview.clash && preview.clash.includes('Machines.md'), 'Machines.md named');
  assert.ok(preview.clash && preview.clash.includes('Services.md'), 'Services.md named');
  await assert.rejects(() => c.part('systems').ops['move-run'](), /Machines\.md/, 'the move refuses');
});
