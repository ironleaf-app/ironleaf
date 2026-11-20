// node --test tests/module-uplift-8-5.test.mjs — 8.5 uplift (30 Oct 2026: make the modules actually do something):
// Weekly Update's gathered first draft and its singular name, Vendors' quote read from a file's words and an order's
// papers, Home's seasonal starter packs, warranty claim-or-extend steps, fail-closed secret screening and the utility
// row's one Finance bill, and Vehicles' distance log for tax time with electric energy wording. Made-up names,
// amounts and days only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-uplift85-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  const mods = ['weekly-updates', 'work-vendors', 'house', 'vehicles', 'module-tools', 'life-modules'];
  writeFileSync(entry, mods.map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = new Date(2026, 9, 30);

test('Weekly is its singular name, and a gathered draft only moves the projects’ own words', () => {
  assert.equal(S.lifeModules.moduleInfo('weekly').name, 'Weekly');
  const base = [{ name: 'Harbour', project: 'Harbour Fit-out', flag: 'On track', status: '', progress: ['Trial shipped'], next: [], blockers: [], none: true, noneWords: 'None', metrics: [], notes: '' }];
  const projects = [{ path: 'Work/Projects/Harbour Fit-out/Harbour Fit-out.md', name: 'Harbour Fit-out', health: '', status: '', due: '', progress: null, next: ['Council meeting'], updates: ['Trial shipped', 'Decks fitted'], risks: ['Switch delivery late'] }, { path: 'P.md', name: 'Depot', health: '', status: '', due: '', progress: null, next: [], updates: ['Gates measured'], risks: [] }];
  const g = S.weeklyUpdates.gatheredSections(projects, base);
  assert.equal(g.sections.length, 2, 'a project with something to say gets a section');
  assert.deepEqual(g.sections[0].progress, ['Trial shipped', 'Decks fitted'], 'a line already there is not repeated');
  assert.deepEqual(g.sections[0].next, ['Council meeting']);
  assert.deepEqual(g.sections[0].blockers, ['Switch delivery late']);
  assert.equal(g.sections[0].none, false);
  assert.equal(S.weeklyUpdates.gatheredSections(projects, g.sections).added, 0, 'gathering twice adds nothing');
});

test('a quote is read from a file’s words, and its items land in the new note', () => {
  const words = 'Quote Q-4821\nFrom: Harbour Print\nValid until 30 November 2026\nSignage panels  4 x $500\nDelivery  1 x $240\nTotal: $2,240';
  const read = S.workVendors.readQuoteFromText(words);
  assert.equal(read.vendor, 'Harbour Print');
  assert.equal(read.amount, 2240);
  assert.equal(read.validUntil, '2026-11-30');
  assert.equal(read.reference, 'Q-4821');
  assert.equal(read.items.length, 2);
  const plan = S.workVendors.planVendorWrite('quote_add', { vendor: read.vendor, amount: read.amount, valid_until: read.validUntil, reference: read.reference, items: read.items }, { folders: { vendor: 'V', quote: 'Q', contract: 'C', order: 'O' }, vendors: [], today: '2026-10-30', currency: 'AUD' });
  assert.match(plan.text, /Signage panels/);
  assert.match(plan.text, /2240/);
  const none = S.workVendors.readQuoteFromText('A friendly letter with no prices in it.');
  assert.equal(none.amount, null, 'nothing is guessed from words without an amount');
  assert.equal(none.validUntil, null);
});

test('an order keeps its papers (its files ride with its record)', () => {
  const note = { path: 'Work/Vendors/Purchase orders/PO 4501.md', title: 'PO 4501', props: { type: 'purchase-order', vendor: '[[Harbour Print]]', amount: 2240, status: 'Raised' }, content: '---\ntype: purchase-order\n---\n## Notes\n', type: 'purchase-order', files: ['Work/Vendors/Files/PO 4501/delivery note.pdf'] };
  const m = S.workVendors.vendorsModel([note], TODAY, 30);
  assert.deepEqual(m.orders[0].files, ['Work/Vendors/Files/PO 4501/delivery note.pdf']);
});

test('Home: a seasonal pack is dated from its season and never duplicates a job', () => {
  const plan = S.house.planSeasonalPack('before-winter', '2026-10-30', ['Clean the gutters']);
  assert.equal(plan.pack, 'Before winter');
  assert.deepEqual(plan.skipped, ['Clean the gutters']);
  assert.ok(plan.jobs.every((j) => j.next_due && j.next_due >= '2027-05-01' && j.next_due <= '2027-05-31'), `dated in May 2027: ${plan.jobs.map((j) => j.next_due)}`);
  assert.ok(plan.jobs.some((j) => j.name === 'Heater service'));
});

test('Home: the warranty checklist uses what is kept, and says nothing is paid without the person', () => {
  const steps = S.house.warrantyChecklist({ name: 'Bosch dishwasher', warranty: '2026-11-20', warrantyDays: 21, manuals: ['receipt.pdf'], supplier: 'The Good Guys' }, '2026-10-30');
  assert.equal(steps.length, 4);
  assert.match(steps.join(' '), /The Good Guys/);
  assert.match(steps.join(' '), /Nothing is booked or paid without your say/);
  assert.deepEqual(S.house.warrantyChecklist({ name: 'X', warranty: null, warrantyDays: null, manuals: [], supplier: '' }, '2026-10-30'), []);
});

test('Home: secret screening fails closed on spellings it was not taught, and leaves plain words alone', () => {
  for (const line of ['Wi-Fi password: made-up-123', 'the pass word is made-up-123', 'wireless key made-up-123', 'router log-in: admin / made-up-123', 'API token: made-up-123', 'credentials are admin and made-up-123']) {
    const out = S.house.withoutSecrets(line);
    assert.ok(!out.includes('made-up-123'), `${line} -> ${out}`);
    assert.match(out, /left out/);
  }
  assert.equal(S.house.withoutSecrets('Power: AGL, plan Everyday, phone 1300 000 000'), 'Power: AGL, plan Everyday, phone 1300 000 000');
  for (const line of ['Garage code: 1234', 'code: hunter2', 'Spare key: KX-9917']) {
    const out = S.house.withoutSecrets(line);
    assert.match(out, /left out/, `${line} -> ${out}`);
  }
  assert.equal(S.house.withoutSecrets('dress code: smart casual'), 'dress code: smart casual', 'plain words pass');
  assert.equal(S.house.withoutSecrets('Key dates: 12 Nov'), 'Key dates: 12 Nov', 'plain words pass');
});

test('Home: a utility row finds its one Finance bill, by provider or by what it is', () => {
  const bills = [{ name: 'AGL electricity', due: '2026-11-14', amount: 212 }, { name: 'Water', due: null, amount: null }];
  assert.equal(S.house.utilityBillMatch({ utility: 'Power', provider: 'AGL' }, bills)?.due, '2026-11-14');
  assert.equal(S.house.utilityBillMatch({ utility: 'Electricity', provider: '' }, bills)?.name, 'AGL electricity');
  assert.equal(S.house.utilityBillMatch({ utility: 'Gas', provider: 'Origin' }, bills), null);
});

const VEHICLE = `---
type: vehicle
kind: Car
make: Roadster
model: Wagon
year: 2019
rego: ABC123
fuel: Electric
status: Active
---
## Fuel log

| Date | Odometer | Litres | Cost | Full | Station | Notes |
| --- | --- | --- | --- | --- | --- | --- |

## Service history

| Date | Odometer | What | Where | Cost | Notes |
| --- | --- | --- | --- | --- | --- | --- |

## Distance log

| Date | Reason | From | To | Km | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-08-10 | Client visit | Home | Depot | 42 | |
| 2027-02-10 | Delivery | Depot | Harbour | 58 | |

## Notes
`;

test('Vehicles: trips add up per financial year, and an electric vehicle is spoken of as energy', () => {
  const m = S.vehicles.vehiclesModel([{ path: 'Home/Vehicles/Wagon.md', title: 'Wagon', props: { type: 'vehicle', kind: 'Car', fuel: 'Electric', status: 'Active' }, content: VEHICLE, type: 'vehicle' }], TODAY);
  const v = m.vehicles[0];
  assert.equal(v.trips.length, 2);
  assert.deepEqual(S.vehicles.distanceByYear(v.trips), [{ year: '2026-27', km: 100, trips: 2 }], 'August and February are the one financial year');
  assert.match(S.vehicles.newVehicleText({ make: 'Roadster' }), /## Distance log/);
  const answer = S.vehicles.answerVehicleTool({ model: m, on: true }, 'vehicle_distance', {});
  assert.match(answer, /2026-27: 100 km/);
  const fuel = S.vehicles.answerVehicleTool({ model: m, on: true }, 'vehicle_fuel_trend', {});
  assert.match(fuel, /energy/, 'never litres for an electric vehicle');
  assert.throws(() => S.vehicles.planTripAdd({ reason: 'Client visit' }, m), /kilometres/);
  assert.match(S.vehicles.planTripAdd({ reason: 'Client visit', km: 12 }, m).words, /12 km/);
});

test('every new tool has plain step words and belongs to its module', () => {
  for (const name of ['weekly_update_gather', 'quote_add_from_text', 'home_seasonal_pack', 'vehicle_distance', 'vehicle_trip_add']) {
    const t = S.moduleTools.MODULE_TOOLS.find((x) => x.name === name);
    assert.ok(t, `${name} is offered`);
    assert.ok(t.step.length >= 8 && !t.step.includes('_'), `${name}'s step is plain words: ${t.step}`);
    assert.ok(S.lifeModules.moduleInfo(t.module), `${name}'s module is in the catalogue`);
  }
});
