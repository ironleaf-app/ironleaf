// node --test tests/work-sites.test.mjs — Sites and Equipment (Wave 6 part b): sites and devices read from plain notes
// (src/shared/work-sites.ts), their records and views, a change written as one property or one cell (a hand-made table's
// own columns kept), the agent tools through a real gate (src/main/work/sites.ts through src/main/work-modules.ts), the
// bell's notices said once, and nothing at all while the module is off. A made-up company, Harbour Retail; a fixed day
// (Sat 24 Oct 2026).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-sites-'));
let S;
let M;
const TODAY = new Date(2026, 9, 24, 10, 0);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(entry, ['work-sites', 'work-modules', 'record-views', 'sensitivity', 'module-records'].map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${JSON.stringify(path.join(root, 'src/main/work-modules.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`, `export { makeGate } from ${JSON.stringify(path.join(root, 'src/main/agent-gate.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const CENTRAL = `---
type: site
kind: Store
code: HR-01
address: 12 Wharf Street
contact: "[[Sam Taylor]]"
status: Active
project: "[[Harbour Central Refit]]"
---
## Rooms

| Room | Floor | Purpose | Notes |
| --- | --- | --- | --- |
| Comms room | Ground | Network rack | Key at the office |
| Shop floor | Ground | Tills | |

## Patch points

| Point | Room | Switch | Port | VLAN | Device | Status | Date | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | Shop floor | SW1 | 1 | 20 | Till 1 | Live | | |
| A-02 | Shop floor | SW1 | 2 | 20 | Till 2 | To patch | 2026-10-24 | |
| A-03 | Comms room | SW1 | 24 | 99 | Access point | Planned | 2026-11-03 | New AP |

## Notes

Back door code is with the manager.
`;
// A table written by hand: its own column order, a column the module doesn't know, no Date column.
const DEPOT = `---
type: site
kind: Warehouse
status: Planned
---
# Depot

## Patch schedule

| Device | Outlet | Owner | Switch | Port | Status |
|---|---|---|---|---|---|
| Label printer | D-1 | Stores | SW9 | 3 | To patch |
`;
const device = (p) => `---\ntype: device\n${Object.entries(p).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n## Notes\n\n`;
const notes = () => [
  { path: 'Work/Sites and Equipment/Sites/Harbour Central.md', title: 'Harbour Central', type: 'site', props: { type: 'site', kind: 'Store', code: 'HR-01', address: '12 Wharf Street', contact: '[[Sam Taylor]]', status: 'Active', project: '[[Harbour Central Refit]]' }, content: CENTRAL, files: ['Work/Sites and Equipment/Sites/Files/Harbour Central/front.jpg', 'Work/Sites and Equipment/Sites/Files/Harbour Central/plan.pdf'] },
  { path: 'Work/Sites and Equipment/Sites/Depot.md', title: 'Depot', type: 'site', props: { type: 'site', kind: 'warehouse', status: 'planned' }, content: DEPOT },
  { path: 'Work/Sites and Equipment/Equipment/Till 1.md', title: 'Till 1', type: 'device', props: { kind: 'POS', site: '[[Harbour Central]]', room: 'Shop floor', serial: 'PX-1001', status: 'In use', warranty: '2026-11-20' }, content: '' },
  { path: 'Work/Sites and Equipment/Equipment/Till 2.md', title: 'Till 2', type: 'device', props: { kind: 'pos', site: 'HR-01', room: 'Shop floor', serial: 'PX-1002', status: 'in use', warranty: '2028-01-01', eol: '2026-10-20' }, content: '' },
  { path: 'Work/Sites and Equipment/Equipment/Spare laptop.md', title: 'Spare laptop', type: 'device', props: { kind: 'Laptop', site: '[[Harbour Central]]', status: 'Spare', make: 'Brightline', model: 'L14', serial: 'BL-77' }, content: '' },
  { path: 'Work/Sites and Equipment/Equipment/Old switch.md', title: 'Old switch', type: 'device', props: { kind: 'Switch', site: '[[Harbour Central]]', status: 'Retired', warranty: '2026-10-30' }, content: '' },
];

test('the model: sites with rooms, patch points and devices; warranties and end of life; a hand-made table read by its columns', () => {
  const W = S.workSites;
  const m = W.sitesModel(notes(), TODAY, 90);
  assert.deepEqual(m.sites.map((s) => s.name), ['Depot', 'Harbour Central']);
  const c = m.sites.find((s) => s.name === 'Harbour Central');
  assert.deepEqual(c.rooms.map((r) => [r.name, r.devices]), [['Comms room', 0], ['Shop floor', 2]]);
  assert.equal(c.devices, 3, 'the retired switch is left out');
  assert.equal(c.inUse, 2);
  assert.equal(c.spare, 1);
  assert.equal(c.toPatch, 2);
  assert.deepEqual(c.photos, ['Work/Sites and Equipment/Sites/Files/Harbour Central/front.jpg']);
  assert.equal(c.project, 'Harbour Central Refit');
  const till2 = m.devices.find((d) => d.name === 'Till 2');
  assert.equal(till2.kind, 'POS', 'a kind in any case reads as the known word');
  assert.equal(till2.sitePath, c.path, 'a site named by its code is that site');
  assert.equal(till2.status, 'In use');
  assert.equal(till2.lifecycle, 'End of life');
  assert.equal(m.devices.find((d) => d.name === 'Till 1').lifecycle, 'Warranty ends soon');
  assert.deepEqual(m.spare.map((d) => d.name), ['Spare laptop']);
  assert.deepEqual(m.lifecycle.map((l) => `${l.device.name} ${l.what} ${l.days}`), ['Till 2 eol -4', 'Till 1 warranty 27']);
  assert.equal(m.lifecycle[1].words, 'Warranty ends in 27 days (Fri 20 Nov)');
  // To patch, soonest first; the one due today is due.
  assert.deepEqual(m.toPatch.map((x) => `${x.siteName} ${x.point} ${x.due}`), ['Harbour Central A-02 true', 'Harbour Central A-03 false', 'Depot D-1 false']);
  const d = m.sites.find((s) => s.name === 'Depot');
  assert.equal(d.kind, 'Warehouse');
  assert.equal(d.status, 'Planned');
  assert.equal(d.patchHeading, 'Patch schedule');
  assert.deepEqual([d.patch[0].point, d.patch[0].device, d.patch[0].switch, d.patch[0].port], ['D-1', 'Label printer', 'SW9', '3']);
  assert.equal(d.patchCols.date, -1, 'no Date column');
});

test('records and views: every site, room, patch point and device, each with where it is written', () => {
  const W = S.workSites;
  const rs = W.siteRecords(W.sitesModel(notes(), TODAY, 90));
  const kinds = rs.reduce((a, r) => ({ ...a, [r.kind]: (a[r.kind] ?? 0) + 1 }), {});
  assert.deepEqual(kinds, { site: 2, room: 2, patch: 4, device: 4 });
  const a2 = rs.find((r) => r.kind === 'patch' && r.title === 'A-02');
  assert.deepEqual(a2.fields, { site: 'Harbour Central', room: 'Shop floor', switch: 'SW1', port: '2', vlan: '20', device: 'Till 2', status: 'To patch', date: '2026-10-24' });
  assert.deepEqual(a2.ref, { at: 'table', heading: 'Patch points', row: 1, cols: { title: 0, room: 1, switch: 2, port: 3, vlan: 4, device: 5, status: 6, date: 7, notes: 8 } });
  assert.equal(rs.find((r) => r.kind === 'site' && r.title === 'Harbour Central').projectName, 'Harbour Central Refit');
  const views = W.siteSectionViews('inventory');
  assert.equal(views[0].groupBy, 'site');
  const run = S.recordViews.runRecordView(rs, views[0], TODAY);
  assert.equal(run.rows.length, 4);
  assert.ok(S.recordViews.fieldsOf(rs).find((f) => f.key === 'warranty').type === 'date');
  for (const sec of ['sites', 'inventory', 'patch', 'lifecycle']) assert.ok(W.siteSectionViews(sec).length, sec);
});

test('new notes, a row added to a hand-made table, a column added, and the CSV of a patch schedule', () => {
  const W = S.workSites;
  const t = W.newSiteText({ name: 'Bayside', kind: 'office', code: 'BS-2', contact: 'Jo Park' });
  assert.match(t, /^---\ntype: site\nkind: Office\ncode: BS-2\naddress:\ncontact: "\[\[Jo Park\]\]"\nstatus: Active\nproject:\n---\n## Rooms\n/);
  assert.match(W.newDeviceText({ kind: 'laptop', serial: '00123', warranty: '31/3/2027' }), /kind: Laptop\nsite:\nroom:\nmake:\nmodel:\nserial: "00123"\n[\s\S]*warranty: 2027-03-31/);
  assert.equal(W.deviceName({ kind: 'Laptop', make: 'Brightline', model: 'L14', serial: 'BL-9' }), 'Brightline L14 (BL-9)');
  // The Depot's own columns: the new row's cells go in its order; a day given adds a Due column (packs uplift
  // item 15), every row given a cell.
  const next = W.withRow(DEPOT, W.PATCH_HEADING, 'Patch points', W.PATCH_HEAD, W.PATCH_COLS, { title: 'D-2', switch: 'SW9', port: '4', status: 'Planned', date: '2026-11-10' });
  assert.match(next, /\| Device \| Outlet \| Owner \| Switch \| Port \| Status \| Due \|\n\|---\|---\|---\|---\|---\|---\| --- \|\n\| Label printer \| D-1 \| Stores \| SW9 \| 3 \| To patch \|  \|\n\|  \| D-2 \|  \| SW9 \| 4 \| Planned \| 2026-11-10 \|\n/);
  assert.ok(next.startsWith(DEPOT.split('## Patch schedule')[0]), 'everything above kept');
  // A site with no Rooms section gets one, before its Notes.
  const roomy = W.withRow('---\ntype: site\n---\n## Notes\n\nHello\n', W.ROOMS_HEADING, 'Rooms', W.ROOM_HEAD, W.ROOM_COLS, { title: 'Office', floor: '1' });
  assert.equal(roomy, '---\ntype: site\n---\n## Rooms\n\n| Room | Floor | Purpose | Notes |\n| --- | --- | --- | --- |\n| Office | 1 |  |  |\n\n## Notes\n\nHello\n');
  const c = W.sitesModel(notes(), TODAY, 90).sites.find((s) => s.name === 'Harbour Central');
  const csv = W.patchCsv(c);
  assert.match(csv, /^﻿Site,Point,Room,Switch,Port,VLAN,Device,Status,Date,Notes\r\nHarbour Central,A-01,Shop floor,SW1,1,20,Till 1,Live,,\r\n/);
});

test('agent tools: answers from what the asker may read, a refusal said, writes planned without guessing', () => {
  const W = S.workSites;
  const m = W.sitesModel(notes(), TODAY, 90);
  const list = W.answerSiteTool({ model: m, on: true }, 'site_list', {});
  assert.match(list, /2 sites:/);
  assert.match(list, /Harbour Central \(HR-01\): Store, Active, 12 Wharf Street; contact Sam Taylor; project Harbour Central Refit; 2 rooms, 3 devices \(2 in use, 1 spare\), 3 patch points \(2 to do\)/);
  const reg = W.answerSiteTool({ model: m, on: true }, 'site_register', { site: 'hr-01' });
  assert.match(reg, /- Shop floor, Ground, Tills: Till 1, Till 2/);
  assert.match(reg, /- A-02 \(Shop floor\): switch SW1, port 2, VLAN 20, to Till 2; To patch on Sat 24 Oct/);
  assert.match(reg, /1 photo kept with it/);
  assert.match(W.answerSiteTool({ model: m, on: true }, 'site_register', { site: 'Nowhere' }), /There is no site called “Nowhere”.*Sites: Depot, Harbour Central/);
  assert.match(W.answerSiteTool({ model: m, on: true }, 'device_find', { query: 'px-1002' }), /Till 2: POS at Harbour Central \(Shop floor\); In use; serial PX-1002; warranty ends in 434 days \(Sat 1 Jan 2028\); reached end of life 4 days ago/);
  assert.match(W.answerSiteTool({ model: m, on: true }, 'device_find', { status: 'Spare' }), /^1 device:\n- Spare laptop/);
  assert.match(W.answerSiteTool({ model: m, on: true }, 'equipment_expiring', {}), /Till 2 at Harbour Central \(serial PX-1002\): Reached end of life 4 days ago[\s\S]*Till 1 .*Warranty ends in 27 days/);
  assert.doesNotMatch(W.answerSiteTool({ model: m, on: true }, 'equipment_expiring', {}), /Old switch/, 'a retired device is never said');
  assert.match(W.answerSiteTool({ model: m, on: false }, 'site_list', {}), /module is off/);
  assert.match(W.answerSiteTool({ model: W.sitesModel([], TODAY), on: true, refused: 2, agent: 'Chat bot' }, 'site_list', {}), /2 site or device notes are at a level Chat bot isn’t allowed/);
  const plan = W.planDeviceAdd({ kind: 'laptop', make: 'Brightline', model: 'L15', serial: 'BL-88', site: 'Harbour Central', warranty: '2029-10-01' }, { on: true, model: m });
  assert.equal(plan.name, 'Brightline L15 (BL-88)');
  assert.match(plan.text, /site: "\[\[Harbour Central\]\]"/);
  assert.match(plan.words, /Added Brightline L15 \(BL-88\) to Sites at Harbour Central, warranty to Mon 1 Oct 2029\./);
  assert.throws(() => W.planDeviceAdd({ kind: 'Laptop', site: 'Moonbase' }, { on: true, model: m }), /no site called “Moonbase”/);
  assert.throws(() => W.planDeviceAdd({ kind: 'Laptop', serial: 'bl-77' }, { on: true, model: m }), /serial bl-77 is already/);
  assert.throws(() => W.planDeviceAdd({ kind: 'Laptop', warranty: 'soon' }, { on: true, model: m }), /warranty day as YYYY-MM-DD/);
});

// ── The main side ────────────────────────────────────────────────────────────────────────────────────────────────────

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

function core(files, switches, projects) {
  const { dir, index } = vault(files);
  const posted = [];
  const written = [];
  const w = new M.WorkModules({
    vault: () => ({ root: dir, any: async (rel) => Object.prototype.hasOwnProperty.call(files, rel) || written.some((x) => x.rel === rel) }),
    index,
    prefs: () => ({ templatesFolder: 'Templates', modules: switches.now }),
    writeNote: async (rel, text) => {
      written.push({ rel, text });
      writeFileSync(path.join(dir, rel), text);
      index.set(rel, text, 0, text.length);
    },
    importFiles: async () => [],
    pickFiles: async () => [],
    saveFile: async (o) => ((written.push({ rel: `export:${o.name}.${o.ext}`, text: String(o.data) }), `/exports/${o.name}.${o.ext}`)),
    post: (items) => {
      const fresh = items.filter((i) => !posted.some((p) => p.key === i.key));
      posted.push(...fresh);
      return fresh.length;
    },
    editProject: async () => ({}),
    projects: () => projects ?? [{ path: 'Work/Projects/Harbour Central Refit/Harbour Central Refit.md', name: 'Harbour Central Refit' }],
    records: () => ({}),
    requireCreate: async () => {},
    now: () => TODAY,
  });
  return { w, dir, index, posted, written, sites: w.parts.find((p) => p.id === 'sites') };
}

const FILES = () => ({
  '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] }),
  'Work/Sites and Equipment/Sites/Harbour Central.md': CENTRAL,
  'Work/Sites and Equipment/Sites/Depot.md': DEPOT,
  'Work/Sites and Equipment/Equipment/Till 1.md': device({ kind: 'POS', site: '"[[Harbour Central]]"', room: 'Shop floor', serial: 'PX-1001', status: 'In use', warranty: '2026-11-20' }),
  'Work/Sites and Equipment/Equipment/Till 2.md': device({ kind: 'POS', site: '"[[Harbour Central]]"', room: 'Shop floor', serial: 'PX-1002', status: 'In use', eol: '2026-10-20' }),
  'Work/Notes/Plan.md': '# Plan\n',
});

test('main side: each change is one property or one cell, rows added and taken out, the CSV exported, a project’s sites', async () => {
  const files = FILES();
  const switches = { now: { sites: { on: true } } };
  const { sites, dir, written } = core(files, switches);
  const rel = 'Work/Sites and Equipment/Sites/Harbour Central.md';
  const read = () => readFileSync(path.join(dir, rel), 'utf8');
  const view = await sites.ops.model();
  assert.equal(view.folder, 'Work/Sites and Equipment');
  assert.equal(view.sites.length, 2);
  // A patch point's switch port changed: that one cell.
  await sites.ops['set-field']({ kind: 'patch', path: rel, ref: { row: 1 }, title: 'A-02', field: 'port', value: '7' });
  const after1 = read();
  assert.equal(after1, CENTRAL.replace('| A-02 | Shop floor | SW1 | 2 |', '| A-02 | Shop floor | SW1 | 7 |'));
  // The row changed since it was shown: nothing written, said in words.
  await assert.rejects(sites.ops['set-field']({ kind: 'patch', path: rel, ref: { row: 1 }, title: 'A-09', field: 'port', value: '8' }), /changed just now/);
  await assert.rejects(sites.ops['set-field']({ kind: 'patch', path: rel, ref: { row: 1 }, field: 'date', value: 'whenever' }), /Give a day/);
  // A property: one line.
  await sites.ops['set-field']({ kind: 'site', path: rel, field: 'address', value: '14 Wharf Street' });
  assert.equal(read(), after1.replace('address: 12 Wharf Street', 'address: 14 Wharf Street'));
  await assert.rejects(sites.ops['set-field']({ kind: 'site', path: rel, field: 'serial', value: 'x' }), /can’t be changed here/);
  // The Depot's hand-made table: a day set adds a Due column (packs uplift item 15); its own columns and Owner column kept.
  const depot = 'Work/Sites and Equipment/Sites/Depot.md';
  await sites.ops['set-field']({ kind: 'patch', path: depot, ref: { row: 0 }, field: 'date', value: '3/11/2026' });
  assert.match(readFileSync(path.join(dir, depot), 'utf8'), /\| Device \| Outlet \| Owner \| Switch \| Port \| Status \| Due \|\n\|---\|---\|---\|---\|---\|---\| --- \|\n\| Label printer \| D-1 \| Stores \| SW9 \| 3 \| To patch \| 2026-11-03 \|/);

  // Rows added and taken out.
  assert.equal(await sites.ops['add-room'](rel, { title: 'Back office', floor: 'First' }), 'Added the room Back office.');
  assert.match(read(), /\| Shop floor \| Ground \| Tills \| \|\n\| Back office \| First \|  \|  \|\n\n## Patch points/);
  assert.equal(await sites.ops['add-patch'](rel, { title: 'B-01', room: 'Back office', status: 'to patch', date: '2026-11-05' }), 'Added patch point B-01.');
  assert.match(read(), /\| B-01 \| Back office \|  \|  \|  \|  \| To patch \| 2026-11-05 \|  \|\n\n## Notes/);
  await assert.rejects(sites.ops['add-patch'](rel, { room: 'x' }), /needs its label/);
  assert.match(await sites.ops['remove-row'](rel, 'rooms', 2, 'Back office'), /Took Back office out of rooms/);
  assert.doesNotMatch(read(), /Back office \| First/);
  // A device made, moved to the spare pool.
  const made = await sites.ops['add-device']({ kind: 'Laptop', make: 'Brightline', model: 'L14', serial: 'BL-1', site: 'Harbour Central', warranty: '2027-02-01' });
  assert.equal(made, 'Work/Sites and Equipment/Equipment/Brightline L14 (BL-1).md');
  await assert.rejects(sites.ops['add-device']({ kind: 'Laptop', serial: 'bl-1' }), /serial bl-1 is already here/);
  assert.match(await sites.ops['move-device'](made, { status: 'Spare', room: '' }), /in the spare pool/);
  assert.match(readFileSync(path.join(dir, made), 'utf8'), /status: Spare/);
  await assert.rejects(sites.ops['add-site']({ name: 'harbour central' }), /already a site called/);
  // The CSV.
  assert.equal(await sites.ops['export-patch-csv'](rel), '/exports/Harbour Central patch schedule.csv');
  assert.match(written.at(-1).text, /Harbour Central,A-02,Shop floor,SW1,7,20,Till 2,To patch,2026-10-24,/);
  // The project page's part: its site, and what needs attention there.
  const proj = await sites.ops.project('Work/Projects/Harbour Central Refit/Harbour Central Refit.md');
  assert.equal(proj.tile.rows[0].words, 'Harbour Central');
  assert.deepEqual(proj.attention.map((a) => [a.words, a.tone]), [
    ['Patch A-02 at Harbour Central today', 'warn'],
    ['Till 2 at Harbour Central: reached end of life 4 days ago', 'bad'],
    ['Till 1 at Harbour Central: warranty ends in 27 days (Fri 20 Nov)', 'warn'],
  ]);
  assert.deepEqual(await sites.ops.project('Work/Notes/Plan.md'), { tile: null, attention: [] });
});

test('main side: through a gate, notices said once, and switched off nothing shows and nothing is lost', async () => {
  const L = S.sensitivity;
  const files = FILES();
  const switches = { now: { sites: { on: true } } };
  const { w, index, posted, dir } = core(files, switches);
  assert.equal(await w.check(), 3, 'Till 2 at end of life, Till 1’s warranty, patching due today');
  assert.deepEqual(posted.map((p) => p.title).sort(), ['Patch A-02 at Harbour Central today', 'Till 1’s warranty ends in 27 days', 'Till 2 has reached end of life']);
  assert.equal(await w.check(), 0, 'said once');
  // Devices marked Personal: a chat bot sees none and is told why; the former host app sees them.
  const store = { ...L.emptyStore(), types: { device: 'personal' }, folders: { 'Work/Private': 'personal' } };
  const sens = {
    stamp: () => 'x',
    level: (rel) => L.levelOf(store, rel, index.get(rel)?.props?.sensitivity, index.get(rel)?.props?.type).level,
    decide: (who, rel, name) => L.decide(store, who, rel, sens.level(rel), name),
    useGrant: () => false,
    allows: (who, level) => L.allows(store, who, level),
    audit: () => {},
  };
  const bot = await w.callTool('device_find', {}, M.makeGate(sens, 'neuralbot', 'Chat bot'));
  assert.match(bot.text, /No equipment yet\.\n2 site or device notes are at a level Chat bot isn’t allowed/);
  const spark = await w.callTool('device_find', { query: 'PX-1001' }, M.makeGate(sens, 'neuralspark', 'the host app'));
  assert.match(spark.text, /Till 1: POS at Harbour Central/);
  const added = await w.callTool('device_add', { kind: 'Printer', site: 'Depot', serial: 'PR-5' }, M.makeGate(sens, 'neuralspark', 'the host app'));
  assert.match(added.text, /Added Printer PR-5 to Sites at Depot\. \[Work\/Sites and Equipment\/Equipment\/Printer PR-5\.md\]/);
  // Switched off: no tools, no notices, the tool says so, every note as it was.
  switches.now = { sites: { on: false } };
  assert.deepEqual(w.toolsOn(), []);
  assert.equal(await w.check(), 0);
  assert.match((await w.callTool('site_list', {}, null)).text, /switched off/);
  for (const [rel, text] of Object.entries(files)) assert.equal(readFileSync(path.join(dir, rel), 'utf8'), text, `${rel} kept as it was`);
  // Its level: Open by default (a Work module), the person's own type level wins.
  assert.equal(L.levelOf(L.emptyStore(), 'x.md', undefined, 'device').level, 'open');
});

test('9.5 batch 10: Meeting Rooms count as rooms; tables without trailing pipes still read (F111)', () => {
  const W = S.workSites;
  const site = W.readSite({ path: 'S.md', title: 'Shop', props: { type: 'site' }, content: '## Meeting Rooms\n\n| Room | Floor |\n| --- | --- |\n| Comms room | Ground\n| Shop floor | Ground\n', type: 'site' }, '2026-10-24');
  assert.deepEqual(site.rooms.map((r) => [r.name, r.floor]), [['Comms room', 'Ground'], ['Shop floor', 'Ground']]);
  assert.equal(site.roomsHeading, 'Meeting Rooms');
});

test('9.5 batch 10: a device added by an assistant carries no hardcoded note (F113)', () => {
  const W = S.workSites;
  const m = W.sitesModel([], TODAY, 90);
  const p = W.planDeviceAdd({ kind: 'Laptop', make: 'Brightline' }, { on: true, model: m });
  assert.ok(!p.text.includes('Added by an assistant'));
});

test('9.5 batch 10: a patch point goes live with its day in one change (F127)', () => {
  const W = S.workSites;
  const body = '| Point | Room | Status |\n| --- | --- | --- |\n| A-02 | Shop floor | To patch |\n';
  const out = W.applyPatchLive(body, 0, 'A-02', '2026-10-24');
  assert.match(out, /\| A-02 \| Shop floor \| Live \| 2026-10-24 \|/);
  assert.throws(() => W.applyPatchLive(body, 0, 'A-09', '2026-10-24'), /changed just now/);
  assert.throws(() => W.applyPatchLive(body, 3, 'A-02', '2026-10-24'), /isn’t in the table/);
});

test('9.5 batch 10: a project matches by its name or its file (F130)', () => {
  assert.deepEqual(S.workModules.projectNameKeys({ path: 'Work/Projects/HCR.md', name: 'Harbour Central Refit' }), ['harbour central refit', 'hcr']);
});

test('9.5 batch 11: marking live writes status and day at once; a file-linked site shows on its project (F127, F130)', async () => {
  const files = FILES();
  const switches = { now: { sites: { on: true } } };
  const { w, sites, written, dir, index } = core(files, switches);
  const rel = 'Work/Sites and Equipment/Sites/Harbour Central.md';
  const before = written.length;
  const words = await sites.tool('site_patch_mark_live', { site: 'Harbour Central', point: 'A-02' }, { gated: index, agent: 't' });
  assert.match(words, /Marked A-02 at Harbour Central live/);
  assert.equal(written.length - before, 1, 'one write, never Live with no date');
  assert.match(readFileSync(path.join(dir, rel), 'utf8'), /\| A-02 \| Shop floor \| SW1 \| 2 \| 20 \| Till 2 \| Live \| 2026-10-24 \|/);
  // A site filed under its project's file, not its name.
  const files2 = FILES();
  files2['Work/Sites and Equipment/Sites/Annex.md'] = '---\ntype: site\nstatus: Active\nproject: "[[HCR]]"\n---\n## Notes\n\nAnnex.\n';
  const v2 = core(files2, switches, [{ path: 'Work/Projects/Renewal/HCR.md', name: 'Harbour Central Refit' }]);
  const tile = await v2.sites.ops.project('Work/Projects/Renewal/HCR.md');
  assert.ok(tile.tile && tile.tile.rows.some((r) => r.words === 'Annex'), 'the file-linked site shows');
});
