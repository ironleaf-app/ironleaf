// node --test tests/uplift-85.test.mjs — 8.5 uplift for Travel, Career, Sites and Equipment, Family, Health, Goals,
// Lists, Memories and Publications: the assistant can prepare for an interview and see past outcomes, check a trip
// before leaving and bring bookings in from a calendar file, walk a patch list and retire kit, search album words,
// take an item off a list, and see the health week in numbers. Pure shared logic (src/shared/*) with made-up people
// and a fixed day (Sat 24 Oct 2026); nothing here touches a real vault.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-uplift85-'));
let S;
const TODAY = new Date(2026, 9, 24, 10, 0);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(entry, ['career', 'travel', 'work-sites', 'memories', 'lists', 'health', 'life-tools', 'module-tools'].map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const APP = `---
type: job-application
company: "[[Harbour Labs]]"
role: Product lead
stage: Interview
applied: 2026-10-10
salary: "$140,000"
contacts: "[[Priya Nair]]"
next_step: Send work samples
next_date: 2026-10-26
---
## Interviews

| Date | Time | Kind | With | Where | Outcome | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-27 | 14:00 | Panel | Priya Nair | Office | Booked | |

## Timeline

| Date | What |
| --- | --- |
| 2026-10-10 | Applied |
`;
const careerNotes = () => [
  { path: 'Me/Career/Product lead at Harbour Labs.md', title: 'Product lead at Harbour Labs', type: 'job-application', props: { company: '[[Harbour Labs]]', role: 'Product lead', stage: 'Interview', applied: '2026-10-10', salary: '$140,000', contacts: '[[Priya Nair]]', next_step: 'Send work samples', next_date: '2026-10-26' }, content: APP },
  { path: 'Me/Career/Designer at Old Co.md', title: 'Designer at Old Co', type: 'job-application', props: { company: '[[Old Co]]', role: 'Designer', stage: 'Rejected', applied: '2026-08-01', salary: '$95,000' }, content: '' },
];

test('career: a prep sheet and past outcomes from what is written, never guessed', () => {
  const C = S.career;
  const m = C.careerModel(careerNotes(), TODAY);
  const prep = C.answerCareerTool({ model: m, on: true }, 'career_prep', { application: 'Harbour Labs' });
  assert.match(prep, /Harbour Labs/);
  assert.match(prep, /Priya Nair/);
  assert.match(prep, /Send work samples/);
  const out = C.answerCareerTool({ model: m, on: true }, 'career_outcomes', {});
  assert.match(out, /1 interview/);
  assert.match(out, /Old Co/);
  assert.match(out, /\$95,000/);
  assert.equal(C.answerCareerTool({ model: m, on: false }, 'career_prep', { application: 'Harbour Labs' }).includes('off'), true);
});

test('career: adding a contact joins the application, once', () => {
  const C = S.career;
  const m = C.careerModel(careerNotes(), TODAY);
  const plan = C.planContactAdd({ application: 'Harbour Labs', contact: 'Sam Taylor' }, m);
  assert.deepEqual(plan.contacts, ['Priya Nair', 'Sam Taylor']);
  assert.throws(() => C.planContactAdd({ application: 'Harbour Labs', contact: 'Priya Nair' }, m), /already/);
});

const TRIP = `---
type: trip
destination: Hobart
starts: 2026-10-30
ends: 2026-11-02
budget: 1800
travellers: "[[Mia Harris]]"
---
## Itinerary

| Date | Time | Kind | What | Until | Where | Booking | Cost | Paid | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-30 | 09:05 | Flight | QF 101 Hobart | 10:35 | Hobart | ABC123 | 320 | No | |

## Expenses

| Date | What | Category | Amount | Paid by | Notes |
| --- | --- | --- | --- | --- | --- |
`;
const ICS = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20261112T090500', 'DTEND:20261112T103500', 'SUMMARY:Flight QF 202 Sydney to Hobart', 'LOCATION:Sydney Airport', 'DESCRIPTION:Booking ref XYZ789', 'END:VEVENT', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261112', 'SUMMARY:Harbour Lodge check-in', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

test('travel: the leaving checklist names passports, unpaid and unbooked worries', () => {
  const T = S.travel;
  const m = T.travelModel([{ path: 'Me/Travel/Hobart.md', title: 'Hobart Nov 2026', type: 'trip', props: { destination: 'Hobart', starts: '2026-10-30', ends: '2026-11-02', budget: 1800, travellers: '[[Mia Harris]]' }, content: TRIP }], TODAY, 7, [{ name: 'Passport (Mia Harris)', path: 'Me/Documents/Passport.md', holder: 'Mia Harris', expires: '2027-02-01' }]);
  const words = T.answerTravelTool({ model: m, on: true }, 'travel_checklist', { trip: 'Hobart' });
  assert.match(words, /passport/i);
  assert.match(words, /six months/i);
  assert.match(words, /not marked paid|unpaid/i);
});

test('travel: bookings come in from a calendar file, codes only as written', () => {
  const T = S.travel;
  const rows = T.parseCalendarBookings(ICS);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, '2026-11-12');
  assert.equal(rows[0].time, '09:05');
  assert.equal(rows[0].booking, 'XYZ789');
  assert.equal(rows[1].booking, '');
  const m = T.travelModel([{ path: 'Me/Travel/Hobart.md', title: 'Hobart Nov 2026', type: 'trip', props: { destination: 'Hobart', starts: '2026-11-12', ends: '2026-11-15' }, content: TRIP }], TODAY);
  const plan = T.planCalendarImport({ trip: 'Hobart', calendar: ICS }, m);
  assert.equal(plan.rows.length, 2);
  assert.throws(() => T.planCalendarImport({ trip: 'Hobart', calendar: 'no events here' }, m), /no bookings/i);
});

const SITE = `---
type: site
kind: Store
code: HR-01
status: Active
---
## Patch points

| Point | Room | Switch | Port | VLAN | Device | Status | Date | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-02 | Shop floor | SW1 | 2 | 20 | Till 2 | To patch | 2026-10-24 | |
| A-03 | Comms room | SW1 | 24 | 99 | Access point | Planned | 2026-11-03 | |
`;
test('sites: the patch walking list, and retiring a device', () => {
  const W = S.workSites;
  const notes = [
    { path: 'Work/Sites/Harbour.md', title: 'Harbour Central', type: 'site', props: { kind: 'Store', code: 'HR-01', status: 'Active' }, content: SITE },
    { path: 'Work/Sites/Till 1.md', title: 'Till 1', type: 'device', props: { kind: 'POS', site: '[[Harbour Central]]', room: 'Shop floor', serial: 'PX-1', status: 'In use' }, content: '' },
  ];
  const m = W.sitesModel(notes, TODAY, 90);
  const list = W.answerSiteTool({ model: m, on: true }, 'site_patch_due', {});
  assert.match(list, /A-02/);
  assert.match(list, /Harbour Central/);
  const plan = W.planDeviceRetire({ device: 'PX-1' }, { on: true, model: m });
  assert.equal(plan.status, 'Retired');
  assert.throws(() => W.planDeviceRetire({ device: 'nope' }, { on: true, model: m }), /no device/i);
});

test('memories: search finds photos by the words written about them', () => {
  const M = S.memories;
  const album = `---
type: album
kind: Event
place: Beach
people: "[[Grandma Rose]]"
---
## Photos

| File | Who | Caption | Date |
| --- | --- | --- | --- |
| beach.jpg | Grandma Rose | Grandma at the beach | 2025-01-02 |
`;
  const m = M.memoriesModel([{ path: 'Family/Memories/Beach day.md', title: 'Beach day', type: 'album', props: { kind: 'Event', place: 'Beach', people: '[[Grandma Rose]]' }, content: album, files: ['Family/Memories/Files/Beach day/beach.jpg'] }], TODAY);
  const hit = M.answerMemoryTool({ model: m, on: true }, 'memory_search', { query: 'beach Grandma' });
  assert.match(hit, /beach\.jpg/);
  assert.match(M.answerMemoryTool({ model: m, on: true }, 'memory_search', { query: 'snow' }), /No photo or album matches/);
});

test('lists: what is next on each list, and no tool deletes', () => {
  const L = S.lists;
  const list = `---
type: list
kind: Watching
---
## Items

| Title | Status | Where | Rating | Link | Note | Added |
| --- | --- | --- | --- | --- | --- | --- |
| Dune Two | Watching | | | | | 2026-10-01 |
| Slow Film | To watch | | | | | 2026-10-02 |
`;
  const m = L.listsModel([{ path: 'Me/Lists/Films.md', title: 'Films', type: 'list', props: { kind: 'Watching' }, content: list }], TODAY);
  const next = L.answerListTool({ model: m, on: true }, 'list_next', {});
  assert.match(next, /Dune Two/);
  assert.ok(!S.moduleTools.MODULE_TOOLS.some((t) => /_delete|_remove|_trash/.test(t.name)), 'no module tool deletes');
});

test('health: the week in numbers (sessions done against the aim)', () => {
  const H = S.health;
  const db = H.emptyDb(0);
  db.sessions = [
    { id: 'a', day: '2026-10-20', title: 'Run', kind: 'cardio', exercises: [], at: 1 },
    { id: 'b', day: '2026-10-22', title: 'Weights', kind: 'strength', exercises: [], at: 2 },
  ];
  const week = H.weekSessionSummary(db, '2026-10-24');
  assert.equal(week.done, 2);
  assert.equal(week.target, 3);
});

test('every new tool has plain step words and a module', () => {
  const names = ['career_prep', 'career_outcomes', 'career_contact_add', 'travel_checklist', 'travel_import_calendar', 'site_patch_due', 'device_retire', 'memory_search', 'list_next', 'family_week_ahead', 'health_week', 'publication_next'];
  for (const n of names) {
    const t = S.moduleTools.MODULE_TOOLS.find((x) => x.name === n);
    assert.ok(t, `${n} is offered`);
    assert.ok(t.step.length >= 8 && !t.step.includes('_'), `${n} step words`);
  }
});
