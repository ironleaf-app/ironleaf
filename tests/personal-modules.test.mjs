// node --test tests/personal-modules.test.mjs — Home, Vehicles, Career and Travel (Wave 7 part a): their records read
// from plain notes (src/shared/house.ts, vehicles.ts, career.ts, travel.ts), fuel use between full tanks, maintenance that
// comes round, an application's stages and timeline, a trip's forecast against its budget; a change written as one
// property or one cell (a hand-made table's own columns kept); and the main side on the work modules' machinery
// (src/main/personal-modules.ts): window jobs, agent tools through a real gate, the bell said once, Inbox filing, and
// nothing at all while a module is off. A made-up household; a fixed day (Sat 24 Oct 2026).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-personal-'));
let S;
let M;
const TODAY = new Date(2026, 9, 24, 10, 0);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(entry, ['vehicles', 'house', 'career', 'travel', 'personal-records', 'personal-modules', 'record-views', 'sensitivity', 'module-records', 'module-tools', 'life-modules'].map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${JSON.stringify(path.join(root, 'src/main/work-modules.ts'))};`, `export * from ${JSON.stringify(path.join(root, 'src/main/personal-modules.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`, `export { makeGate } from ${JSON.stringify(path.join(root, 'src/main/agent-gate.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── Fixtures: a made-up household ────────────────────────────────────────────────────────────────────────────────────

// The fuel log is written by hand: its columns in another order, a part fill between two full tanks, and a Notes column
// the module never writes.
const WAGON = `---
type: vehicle
kind: Car
make: Roadster
model: Wagon
year: 2019
rego: ABC123
rego_due: 2026-11-05
insurer: Harbour Mutual
insurance_due: 2027-03-01
service_due: 2027-02-01
service_km: 60500
fuel: Petrol
status: Active
---
## Fuel log

| Date | Litres | Cost | Odometer | Full | Station | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-01 | 40 | 76.00 | 59000 | Yes | Northside | |
| 2026-08-20 | 38 | 72.20 | 59500 | Yes | Northside | |
| 2026-09-05 | 20 | 39.00 | 59750 | No | Southgate | top-up |
| 2026-09-12 | 21 | 41.16 | 60000 | Yes | Northside | |
| 2026-10-10 | 44 | 88.00 | 60400 | Yes | Northside | long drive |

## Service history

| Date | Odometer | What | Where | Cost | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-02-01 | 50500 | Logbook service | Corner Garage | 420 | |

## Notes

Spare key in the drawer.
`;

const HOME = `---
type: house
address: 4 Example Lane
ownership: Renting
moved_in: 2024-02-01
contact: "[[Pat Agent]]"
---
## Rooms

| Room | Floor | Notes |
| --- | --- | --- |
| Kitchen | Ground | |
| Laundry | Ground | |

## Utilities

| Utility | Provider | Plan | Account | Phone | Notes |
| --- | --- | --- | --- | --- | --- |
| Electricity | Brightpower | Flat rate | 1234 5678 | 13 00 00 | |

## Network and printers

| Thing | Details | Notes |
| --- | --- | --- |
| Wi-Fi | HomeNet-5G, password: hunter22 | |
| Printer | Inkwell P300, ink at 20% | |

## Notes

`;
const app = (p, body = '') => `---\ntype: job-application\n${Object.entries(p).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body}`;
const FILES = () => ({
  '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'home', name: 'Home', folder: 'Home' }, { id: 'me', name: 'Me', folder: 'Me' }] }),
  'Home/Vehicles/Family wagon.md': WAGON,
  'Home/House/Home.md': HOME,
  'Home/House/Appliances/Dishwasher.md': `---\ntype: appliance\nkind: Dishwasher\nroom: Kitchen\nmake: Brightline\nmodel: DW-5\nserial: DW5-0001\npurchased: 2024-11-20\nprice: 899\nsupplier: Appliance Barn\nwarranty: 2026-11-20\nstatus: In use\n---\n## Service history\n\n| Date | What | By | Cost | Notes |\n| --- | --- | --- | --- | --- |\n\n## Notes\n\n`,
  'Home/House/Maintenance/Clean the gutters.md': `---\ntype: upkeep\nevery: Half-yearly\nlast_done: 2026-04-10\nroom: Roof\nwho: Sam\nstatus: Active\n---\n## Done\n\n| Date | By | Cost | Notes |\n| --- | --- | --- | --- |\n| 2026-04-10 | Sam | | |\n\n## Notes\n\n`,
  'Home/House/Maintenance/Test the smoke alarms.md': `---\ntype: upkeep\nevery: Yearly\nnext_due: 2027-03-01\nstatus: Active\n---\n## Done\n\n| Date | By | Cost | Notes |\n| --- | --- | --- | --- |\n\n## Notes\n\n`,
  'Me/Career/Applications/Analyst at Brightwater.md': app({ company: '"[[Brightwater]]"', role: 'Analyst', stage: 'Interview', applied: '2026-10-01', contacts: '["[[Jo Recruiter]]"]', cv: '"[[CV v2]]"', next_step: 'Send the work sample', next_date: '2026-10-23' }, '## Interviews\n\n| Date | Time | Kind | With | Where | Outcome | Notes |\n| --- | --- | --- | --- | --- | --- | --- |\n| 2026-10-14 | 09:00 | Phone screen | Jo Recruiter | Phone | Went well | |\n| 2026-10-25 | 10:30 | Video | Panel | Video link | Booked | |\n\n## Timeline\n\n- 2026-10-01 — Applied through a job board\n- 2026-10-14 — Moved to Interview\n\n## Notes\n\n'),
  'Me/Career/Applications/Planner at Northfield.md': app({ company: '"[[Northfield]]"', role: 'Planner', stage: 'Applied', applied: '2026-10-05' }, '## Interviews\n\n| Date | Time | Kind | With | Where | Outcome | Notes |\n| --- | --- | --- | --- | --- | --- | --- |\n\n## Timeline\n\n- 2026-10-05 — Applied\n\n## Notes\n\n'),
  'Me/Career/Applications/Coordinator at Eastway.md': app({ company: '"[[Eastway]]"', role: 'Coordinator', stage: 'Rejected', applied: '2026-09-01' }),
  'Me/Career/Cover letters/Cover letter Brightwater.md': `---\ntype: cover-letter\napplication: "[[Analyst at Brightwater]]"\ncompany: "[[Brightwater]]"\nwritten: 2026-09-30\nversion:\n---\nDear hiring team,\n\nI would love to join Brightwater as an analyst.\n\nKind regards,\n`,
  'Me/Documents and ID/CV v2.md': `---\ntype: id-document\nkind: CV\nholder:\nissuer:\nnumber:\nissued: 2026-09-01\nexpires:\nremind:\nversion: v2\n---\n## Files\n\n\n## Notes\n\n`,
  'Me/Documents and ID/Passport (Sam).md': `---\ntype: id-document\nkind: Passport\nholder: Sam\nexpires: 2027-02-01\n---\n`,
  'Me/Travel/Trips/Harbour City Nov 2026.md': `---\ntype: trip\ndestination: Harbour City\npurpose: Work\nstarts: 2026-10-28\nends: 2026-10-30\nstatus: Booked\nbudget: 1200\ntravellers: ["[[Sam]]"]\n---\n## Itinerary\n\n| Date | Time | Kind | What | Until | Where | Booking | Cost | Paid | Notes |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| 2026-10-28 | 07:05 | Flight | QF 412 to Harbour City | 08:35 | Terminal 3 | QX7P2 | 289 | Yes | |\n| 2026-10-28 | 15:00 | Hotel | Harbour Lodge | Fri 30 Oct | 12 Pier Rd | HL-9921 | 640 | No | |\n| 2026-10-30 | 18:40 | Flight | QF 431 home | 20:10 | | QX7P2 | 310 | Yes | |\n\n## Expenses\n\n| Date | What | Category | Amount | Paid by | Notes |\n| --- | --- | --- | --- | --- | --- |\n\n## Notes\n\n`,
  'Me/Travel/Trips/Lake weekend.md': `---\ntype: trip\ndestination: Lake Town\npurpose: Family\nstarts: 2026-12-11\nends: 2026-12-13\nstatus: Planning\nbudget: 500\n---\n## Itinerary\n\n| Date | Time | Kind | What | Until | Where | Booking | Cost | Paid | Notes |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n\n## Expenses\n\n| Date | What | Category | Amount | Paid by | Notes |\n| --- | --- | --- | --- | --- | --- |\n| 2026-12-11 | Fuel | Transport | 60 | Card | |\n\n## Notes\n\n`,
  'People/Jo Recruiter.md': '---\ntype: person\nrole: Recruiter\nemail: jo@example.com\n---\n',
});
const notesOf = (type, files = FILES()) =>
  Object.entries(files)
    .filter(([rel, t]) => rel.endsWith('.md') && new RegExp(`^---\\ntype: ${type}\\n`).test(t))
    .map(([rel, content]) => {
      const props = {};
      for (const l of content.split('\n---')[0].split('\n').slice(1)) {
        const m = /^([a-z_]+):\s*(.*)$/.exec(l);
        if (m) props[m[1]] = /^(\[\s*"|")/.test(m[2]) ? JSON.parse(m[2]) : m[2];
      }
      return { path: rel, title: path.posix.basename(rel, '.md'), props, content, type };
    });

// ── Vehicles ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('vehicles: fuel use between full tanks (a part fill counted, never skewing), its trend, what is due by day and km', () => {
  const V = S.vehicles;
  const m = V.vehiclesModel(notesOf('vehicle'), TODAY, 30);
  const v = m.vehicles[0];
  assert.equal(v.name, 'Family wagon');
  assert.equal(v.odometer, 60400, 'the highest odometer in its fuel log or service history');
  assert.deepEqual(
    v.fills.map((f) => f.per100),
    [null, 7.6, null, 8.2, 11],
    '38 L over 500 km; the part fill’s 20 L plus 21 L over 500 km; 44 L over 400 km',
  );
  assert.equal(v.fills[0].price, 1.9);
  assert.equal(v.per100, 8.9);
  assert.equal(v.trend, null, 'three readings are not enough for a trend');
  assert.equal(v.spend12, 316.36);
  assert.equal(v.costPer100, 17.17, '(72.20 + 39 + 41.16 + 88) over 1,400 km');
  assert.deepEqual(
    v.dues.map((d) => `${d.what} ${d.late} ${d.soon}`),
    ['rego false true', 'insurance false false', 'service false true'],
  );
  assert.equal(v.dues[0].words, 'Rego due in 12 days (Thu 5 Nov)');
  assert.equal(v.dues[2].kmLeft, 100);
  assert.equal(v.dues[2].words, 'Service due in 100 km', 'the km is nearer than the day');
  // Driving pace (8.3 wave 1): about 1,200 km a month lately, so the service distance comes in days, not February.
  assert.ok(v.kmPerMonth > 1100 && v.kmPerMonth < 1300, `km a month from the dated readings (${v.kmPerMonth})`);
  assert.equal(v.serviceEta, '2026-10-27');
  assert.match(V.answerVehicleTool({ model: m, on: true }, 'vehicle_list'), /service distance reached about/);
  assert.deepEqual(m.due.map((d) => d.what), ['service', 'rego']);
  // A fifth reading gives a trend.
  const more = WAGON.replace('| 2026-10-10 | 44 | 88.00 | 60400 | Yes | Northside | long drive |', '| 2026-10-10 | 44 | 88.00 | 60400 | Yes | Northside | long drive |\n| 2026-10-20 | 46 | 92.00 | 60800 | Yes | Northside | |');
  const m2 = V.vehiclesModel([{ ...notesOf('vehicle')[0], content: more }], TODAY, 30);
  assert.equal(m2.vehicles[0].trend, 'worse');
  // Records for the views, and each page's views.
  const rs = V.vehicleRecords(m);
  assert.deepEqual(
    rs.reduce((a, r) => ({ ...a, [r.kind]: (a[r.kind] ?? 0) + 1 }), {}),
    { vehicle: 1, fuel: 5, servicing: 1, 'due-date': 3 },
  );
  for (const sec of ['vehicles', 'fuel', 'service', 'reminders']) assert.ok(V.vehicleSectionViews(sec).length, sec);
  const run = S.recordViews.runRecordView(rs, V.vehicleSectionViews('fuel')[2], TODAY);
  assert.equal(run.rows.length, 5);
});

test('vehicles: tools answer from the notes, never guess, and the plans check what an assistant gives', () => {
  const V = S.vehicles;
  const m = V.vehiclesModel(notesOf('vehicle'), TODAY, 30);
  const list = V.answerVehicleTool({ model: m, on: true }, 'vehicle_list');
  assert.match(list, /Family wagon \(ABC123\): Car, Petrol; odometer 60,400 km; rego due in 12 days \(Thu 5 Nov\); insurance due in 128 days/);
  assert.match(V.answerVehicleTool({ model: m, on: true }, 'vehicle_due'), /Due in the next 30 days:\n- Family wagon \(ABC123\): Rego due in 12 days[\s\S]*Service due in 100 km/);
  assert.match(V.answerVehicleTool({ model: m, on: true }, 'vehicle_fuel_trend', {}), /8\.9 L\/100 km over its last full tanks; \$17\.17 per 100 km/);
  assert.match(V.answerVehicleTool({ model: m, on: false }, 'vehicle_list'), /off in Ironleaf/);
  const fill = V.planFuelAdd({ odometer: 60950, litres: 42.5, cost: 81.6 }, m);
  assert.equal(fill.path, 'Home/Vehicles/Family wagon.md', 'the only vehicle when none is named');
  assert.deepEqual(fill.values, { date: '2026-10-24', odometer: '60950', litres: '42.5', cost: '81.6', full: 'Yes', station: '', notes: '' });
  assert.throws(() => V.planFuelAdd({ vehicle: 'Wagon', odometer: 1000, litres: 40 }, m), /well below/);
  assert.throws(() => V.planFuelAdd({ vehicle: 'Wagon', odometer: 610200, litres: 40 }, m), /well above/, 'an extra digit the other way is checked too');
  assert.throws(() => V.planFuelAdd({ vehicle: 'Hovercraft', litres: 40 }, m), /no vehicle called “Hovercraft”/);
  assert.throws(() => V.planFuelAdd({}, m), /needs the litres or the cost/);
  const svc = V.planServiceAdd({ what: 'Logbook service', odometer: 60450, cost: 455, next_due: '2027-10-24', next_km: 70450 }, m);
  assert.deepEqual(svc.props, { service_due: '2027-10-24', service_km: 70450 });
  assert.match(svc.words, /Recorded Logbook service for Family wagon \(\$455\); next due Sun 24 Oct 2027 or at 70,450 km\./);
  assert.throws(() => V.planRenewed({ what: 'rego', until: '2026-01-01' }, m), /already passed/);
  assert.deepEqual(V.planRenewed({ what: 'insurance', until: '2028-03-01', insurer: 'Bay Insurance' }, m).props, { insurance_due: '2028-03-01', insurer: 'Bay Insurance' });
  assert.deepEqual(V.nextService({ date: '2026-10-24', odometer: 60450 }, { months: 12, km: 10000 }), { date: '2027-10-24', km: 70450 });
  assert.match(V.newVehicleText({ kind: 'ute', make: 'Hauler', model: 'X', year: '2020', rego: 'xyz789', odometer: '12000' }), /^---\ntype: vehicle\nkind: Ute\nmake: Hauler\nmodel: X\nyear: 2020\nrego: XYZ789\n[\s\S]*odometer: 12000\n---\n## Fuel log\n\n\| Date \| Odometer \| Litres \| Cost \| Full \| Station \| Notes \|/);
});

// ── Home ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('home: rooms, utilities, network notes, appliances with warranties, jobs that come round, and no password for an assistant', () => {
  const H = S.house;
  const notes = [...notesOf('house'), ...notesOf('appliance'), ...notesOf('upkeep')];
  const m = H.houseModel(notes, TODAY, 60, 14);
  const h = m.homes[0];
  assert.equal(h.address, '4 Example Lane');
  assert.equal(h.ownership, 'Renting');
  assert.deepEqual(h.rooms.map((r) => r.values.room), ['Kitchen', 'Laundry']);
  assert.equal(h.utilities[0].values.provider, 'Brightpower');
  const dw = m.appliances[0];
  assert.equal(dw.warrantyState, 'Warranty ends soon');
  assert.equal(H.warrantyWords(dw, m.today), 'Warranty ends in 27 days (Fri 20 Nov)');
  const gutters = m.jobs.find((j) => j.name === 'Clean the gutters');
  assert.equal(gutters.nextDue, '2026-10-10', 'six months after it was last done');
  assert.equal(gutters.worked, true);
  assert.equal(gutters.state, 'Overdue');
  assert.equal(H.jobWords(gutters, m.today), 'Overdue by 14 days');
  assert.deepEqual(m.due.map((j) => j.name), ['Clean the gutters']);
  assert.equal(m.jobs.find((j) => j.name === 'Test the smoke alarms').state, 'Later');
  const done = H.doneChange(gutters, { date: '2026-10-24', by: 'Sam', cost: 0 });
  assert.deepEqual(done.props, { last_done: '2026-10-24', next_due: '2027-04-24' });
  assert.deepEqual(H.doneChange({ every: 'Once' }, { date: '2026-10-24' }).props, { last_done: '2026-10-24', next_due: null, status: 'Done' });
  assert.equal(H.nextAfter('Monthly', '2026-01-31'), '2026-02-28', 'the 31st into a shorter month lands on its last day');
  const info = H.answerHouseTool({ model: m, on: true }, 'home_info', {});
  assert.match(info, /Home, 4 Example Lane \(renting\); moved in Thu 1 Feb 2024; landlord or agent Pat Agent/);
  assert.match(info, /- Electricity: Brightpower; Flat rate; account 1234 5678; phone 13 00 00/);
  assert.doesNotMatch(info, /hunter22/, 'a password written in a note is never given to an assistant');
  assert.match(info, /Wi-Fi: HomeNet-5G, \[left out: it reads like a password; keep it in Secrets\]/);
  assert.match(H.answerHouseTool({ model: m, on: true }, 'home_maintenance_due', {}), /Clean the gutters: Overdue by 14 days; last done Fri 10 Apr; half-yearly; Sam does it/);
  assert.match(H.answerHouseTool({ model: m, on: true }, 'home_appliance_find', { query: 'dishwasher' }), /Brightline DW-5; serial DW5-0001; bought Wed 20 Nov 2024 from Appliance Barn for \$899; warranty ends in 27 days/);
  assert.throws(() => H.planJobAdd({ what: 'Clean the gutters', every: 'Yearly' }, m), /already a job/);
  assert.throws(() => H.planApplianceAdd({ kind: 'Fridge', serial: 'dw5-0001' }, m), /already in House/);
  assert.match(H.planJobAdd({ what: 'Service the heater', every: 'Yearly', last_done: '2026-05-01' }, m).text, /every: Yearly\nlast_done: 2026-05-01\nnext_due: 2027-05-01/);
  const rs = H.houseRecords(m);
  assert.deepEqual(
    rs.reduce((a, r) => ({ ...a, [r.kind]: (a[r.kind] ?? 0) + 1 }), {}),
    { room: 2, utility: 1, appliance: 1, upkeep: 2 },
  );
});

// ── Career ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test('career: the pipeline, interviews coming, follow-ups, the CV from Documents and ID, the letter, contacts and the timeline', () => {
  const C = S.career;
  const people = [{ name: 'Jo Recruiter', path: 'People/Jo Recruiter.md', role: 'Recruiter', email: 'jo@example.com' }];
  const notes = [...notesOf('job-application'), ...notesOf('cover-letter'), ...notesOf('id-document').filter((n) => /CV/.test(n.title))];
  const m = C.careerModel(notes, TODAY, 2, people);
  assert.deepEqual(m.applications.map((a) => `${a.name} ${a.stage} ${a.open}`), ['Analyst at Brightwater Interview true', 'Planner at Northfield Applied true', 'Coordinator at Eastway Rejected false']);
  assert.equal(m.stages.Interview, 1);
  assert.equal(m.stages.Applied, 1);
  const a = m.applications[0];
  assert.equal(a.cvPath, 'Me/Documents and ID/CV v2.md', 'the CV is the Documents and ID record');
  assert.equal(a.letterPath, null, 'no letter linked yet');
  assert.deepEqual(a.timeline, [{ date: '2026-10-01', words: 'Applied through a job board' }, { date: '2026-10-14', words: 'Moved to Interview' }]);
  assert.deepEqual(m.upcoming.map((i) => `${i.applicationName} ${i.date} ${i.time}`), ['Analyst at Brightwater 2026-10-25 10:30']);
  assert.equal(C.interviewWords(m.upcoming[0], m.today), 'Video tomorrow at 10:30');
  assert.deepEqual(m.followUps.map((x) => x.name), ['Analyst at Brightwater'], 'its next step was due yesterday');
  assert.equal(m.letters[0].applicationPath, a.path);
  assert.equal(m.letters[0].words, 14);
  assert.deepEqual(m.cvs.map((c) => `${c.name} ${c.usedBy.length}`), ['CV v2 1']);
  assert.deepEqual(m.contacts.map((c) => `${c.name} ${c.role} ${c.applications.length} ${c.last}`), ['Jo Recruiter Recruiter 1 2026-10-14']);
  assert.match(C.answerCareerTool({ model: m, on: true }, 'career_application_list', { stage: 'open' }), /2 applications \(1 applied, 1 interview, 1 rejected in all\):\n- Analyst at Brightwater: Interview, applied Thu 1 Oct; 2 interviews; next: Send the work sample by Fri 23 Oct/);
  assert.match(C.answerCareerTool({ model: m, on: true }, 'career_application_get', { application: 'brightwater' }), /Sent: CV CV v2\.[\s\S]*- Analyst at Brightwater: Video tomorrow at 10:30 with Panel \(Video link\); Booked/);
  assert.match(C.answerCareerTool({ model: m, on: true }, 'career_interviews', {}), /Interviews in the next 14 days:\n- Analyst at Brightwater: Video tomorrow at 10:30/);
  const plan = C.planStage(m.applications[1], 'Offer', m.today, 'Verbal offer');
  assert.deepEqual(plan, { props: { stage: 'Offer' }, line: '2026-10-24 — Offer received: Verbal offer', words: 'Planner at Northfield is now at Offer.' });
  const iv = C.planInterview({ application: 'Northfield', date: '2026-10-29', time: '2pm', kind: 'In person', with: 'Alex Lead' }, m);
  assert.equal(iv.stage, 'Interview', 'an interview moves an earlier application on');
  assert.deepEqual(iv.values, { date: '2026-10-29', time: '14:00', kind: 'In person', with: 'Alex Lead', where: '', outcome: 'Booked', notes: '' });
  assert.throws(() => C.planInterview({ application: 'Northfield', date: 'next week' }, m), /day as YYYY-MM-DD/);
  assert.throws(() => C.planApplicationAdd({ role: 'Analyst', company: 'Brightwater' }, m), /already an open application/);
  assert.match(C.newApplicationText({ role: 'Designer', company: 'Westpoint', source: 'a referral' }, '2026-10-24'), /stage: Applied\napplied: 2026-10-24\nsource: a referral[\s\S]*## Timeline\n\n- 2026-10-24 — Applied through a referral\n/);
  assert.deepEqual(
    C.careerRecords(m).reduce((x, r) => ({ ...x, [r.kind]: (x[r.kind] ?? 0) + 1 }), {}),
    { application: 3, interview: 2, letter: 1, cv: 1 },
  );
  assert.equal(C.careerSectionViews('pipeline')[0].layout, 'board');
});

// ── Travel ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test('travel: a trip day by day, its forecast against its budget, the months ahead and a passport checked against the trip', () => {
  const T = S.travel;
  const passports = [{ name: 'Passport (Sam)', path: 'Me/Documents and ID/Passport (Sam).md', holder: 'Sam', expires: '2027-02-01' }];
  const m = T.travelModel(notesOf('trip'), TODAY, 7, passports);
  const x = m.upcoming[0];
  assert.equal(x.name, 'Harbour City Nov 2026');
  assert.equal(x.phase, 'Upcoming');
  assert.equal(T.tripWhen(x, m.today), 'Leaving in 4 days (Wed 28 Oct)');
  assert.equal(x.nights, 2);
  assert.deepEqual([x.booked, x.spent, x.paid, x.forecast, x.left], [1239, 0, 599, 1239, -39]);
  assert.deepEqual(x.days.map((d) => `${d.date} ${d.items.length}`), ['2026-10-28 2', '2026-10-30 1']);
  assert.equal(T.bookingWords(x.days[0].items[0]), 'Flight: QF 412 to Harbour City at 07:05 until 08:35');
  assert.equal(x.passports[0].ok, false);
  assert.match(x.passports[0].words, /expires Mon 1 Feb 2027, within six months of coming home/);
  assert.deepEqual(m.months.slice(0, 3).map((mo) => `${mo.month} ${mo.forecast} ${mo.budget}`), ['2026-10 1239 1200', '2026-11 0 0', '2026-12 60 500']);
  assert.deepEqual(m.categories, [{ category: 'Flights', amount: 599 }, { category: 'Accommodation', amount: 640 }, { category: 'Transport', amount: 60 }].sort((a, b) => b.amount - a.amount));
  assert.match(T.answerTravelTool({ model: m, on: true, currency: 'AUD' }, 'travel_trip_get', {}), /Wed 28 Oct:\n  - Flight: QF 412 to Harbour City at 07:05 until 08:35; Terminal 3; booking QX7P2; \$289 paid/);
  assert.match(T.answerTravelTool({ model: m, on: true, currency: 'AUD' }, 'travel_trip_get', {}), /Cost: bookings \$1,239 \+ spending \$0 = forecast \$1,239; budget \$1,200, \$39 over\./);
  assert.match(T.answerTravelTool({ model: m, on: true, currency: 'AUD' }, 'travel_forecast', { months: 3 }), /Travel forecast for the next 3 months: \$1,299 against \$1,700 budgeted\./);
  const b = T.planBooking({ trip: 'harbour', kind: 'Car hire', what: 'Compact car', date: '2026-10-28', time: '9:00', cost: 120 }, m);
  assert.deepEqual(b.values, { date: '2026-10-28', time: '09:00', kind: 'Car hire', what: 'Compact car', until: '', where: '', booking: '', cost: '120', paid: '', notes: '' });
  const e = T.planExpense({ trip: 'Lake', what: 'Dinner', amount: 85, category: 'food' }, m);
  assert.match(e.words, /Added Dinner \(\$85\) to Lake weekend; \$355 of its budget left\./);
  assert.throws(() => T.planTripAdd({ destination: 'Bay', starts: '2026-12-10', ends: '2026-12-01' }, m), /ends before it starts/);
  assert.equal(T.planTripAdd({ destination: 'Bay Town', starts: '2027-01-15' }, m).name, 'Bay Town Jan 2027');
  assert.match(T.planTripAdd({ destination: 'Bay Town', starts: '2027-01-15' }, m).text, /^ends:$/m, 'no return day written: left open, not the day it starts');
  const open = T.readTrip({ path: 'x.md', title: 'Open trip', props: { starts: '2026-10-20' }, content: '', type: 'trip' }, '2026-10-24');
  assert.equal(open.ends, null);
  assert.equal(open.phase, 'Away', 'started with no return day: still away, never back');
  assert.equal(T.tripWhen(open, '2026-10-24'), 'Away now · day 5');
  assert.deepEqual(
    T.travelRecords(m).reduce((a, r) => ({ ...a, [r.kind]: (a[r.kind] ?? 0) + 1 }), {}),
    { trip: 2, booking: 3, expense: 1 },
  );
});

test('travel: a trip’s days short for titles and lists, never clipped mid-word', () => {
  const T = S.travel;
  assert.equal(T.tripRangeShort({ starts: '2027-01-10', ends: '2027-01-17' }), '10–17 Jan');
  assert.equal(T.tripRangeShort({ starts: '2027-01-10', ends: '2027-01-10' }), '10 Jan');
  assert.equal(T.tripRangeShort({ starts: '2026-12-28', ends: '2027-01-04' }), '28 Dec – 4 Jan');
  assert.equal(T.tripRangeShort({ starts: null, ends: null }), '');
  assert.equal(T.tripRangeWords({ starts: '2027-01-10', ends: '2027-01-17' }), '10 to 17 Jan');
  assert.equal(T.tripRangeWords({ starts: '2027-01-10', ends: null }), '10 Jan');
});

// ── The catalogue ────────────────────────────────────────────────────────────────────────────────────────────────────

test('amounts: thousands, millions and plain figures read as written', () => {
  const R = S.personalRecords;
  assert.equal(R.readAmount('$1.5k'), 1500, '"k" is thousands, never dropped');
  assert.equal(R.readAmount('$2.5m'), 2500000);
  assert.equal(R.readAmount('$1,234.50'), 1234.5);
  assert.equal(R.readAmount('AUD 89'), 89);
  assert.equal(R.readAmount('-12'), -12);
  assert.equal(R.readAmount('lots'), null);
});

test('the catalogue: four modules off by default, each Personal, in their areas, with tools and their own step words', () => {
  const L = S.lifeModules;
  for (const id of ['house', 'vehicles', 'career', 'travel']) {
    const info = L.moduleInfo(id);
    assert.ok(info, id);
    assert.equal(L.moduleOn({}, id), false, `${id} is off for a new vault`);
    assert.equal(info.level, 'personal');
    assert.ok(info.offer?.does && info.offer?.signals, `${id} is offered in its own words`);
    const rm = S.moduleRecords.moduleById(id);
    assert.ok(rm.types.length && rm.sections.length && rm.tools.length);
    for (const t of rm.tools) {
      const def = S.moduleTools.moduleToolDef(t);
      assert.ok(def, `${t} is one of the module tools`);
      assert.equal(def.module, id);
      assert.ok(def.step && !/^\w+_\w+$/.test(def.step), `${t} has its own step words`);
    }
  }
  assert.equal(S.moduleRecords.typeFolder('vehicle', [{ id: 'home', folder: 'Home' }]), 'Home/Vehicles');
  assert.equal(S.moduleRecords.typeFolder('job-application', [{ id: 'me', folder: 'Me' }]), 'Me/Career/Applications');
  assert.equal(S.moduleRecords.typeFolder('trip', null), 'Travel/Trips', 'a vault without areas keeps them at the top');
  assert.equal(S.sensitivity.levelOf(S.sensitivity.emptyStore(), 'x.md', undefined, 'appliance').level, 'personal');
});

// ── The main side ────────────────────────────────────────────────────────────────────────────────────────────────────

function core(files, switches) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  const posted = [];
  const written = [];
  const w = new M.WorkModules(
    {
      vault: () => ({ root: dir, any: async (rel) => Object.prototype.hasOwnProperty.call(files, rel) || written.some((x) => x.rel === rel) }),
      index,
      prefs: () => ({ templatesFolder: 'Templates', modules: switches.now }),
      writeNote: async (rel, text) => {
        written.push({ rel, text });
        mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        writeFileSync(path.join(dir, rel), text);
        index.set(rel, text, 0, text.length);
      },
      importFiles: async () => [],
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
    },
    M.PERSONAL_GROUP,
  );
  const part = (id) => w.parts.find((p) => p.id === id);
  const read = (rel) => readFileSync(path.join(dir, rel), 'utf8');
  return { w, dir, index, posted, written, part, read };
}
const ALL_ON = () => ({ now: { house: { on: true }, vehicles: { on: true }, career: { on: true }, travel: { on: true } } });

test('main side: each change is one property or one cell of a hand-made table, every other character kept', async () => {
  const files = FILES();
  const { part, read } = core(files, ALL_ON());
  const rel = 'Home/Vehicles/Family wagon.md';
  const v = part('vehicles');
  // A cell of the hand-made fuel log (its own column order), by its column's name.
  await v.ops['set-field']({ kind: 'fuel', path: rel, field: 'cost', value: '$41.50', ref: { row: 3 }, title: '2026-09-12' });
  assert.equal(read(rel), WAGON.replace('| 2026-09-12 | 21 | 41.16 | 60000 |', '| 2026-09-12 | 21 | 41.5 | 60000 |'));
  await assert.rejects(v.ops['set-field']({ kind: 'fuel', path: rel, field: 'cost', value: '1', ref: { row: 3 }, title: '2026-01-01' }), /changed just now/);
  await assert.rejects(v.ops['set-field']({ kind: 'fuel', path: rel, field: 'litres', value: 'lots', ref: { row: 3 } }), /Give the litres as a number/);
  // A property.
  await v.ops['set-field']({ kind: 'vehicle', path: rel, field: 'rego_due', value: '5/11/2027' });
  assert.match(read(rel), /\nrego_due: 2027-11-05\n/);
  // A fill-up added from the page lands as a row in the table's own column order.
  assert.match(await v.ops['add-fill'](rel, { odometer: 60900, litres: 40, cost: 80, full: true, station: 'Northside' }), /Logged a fill-up for Family wagon: 40 L for \$80 at 60,900 km\./);
  assert.match(read(rel), /\| 2026-10-24 \| 40 \| 80 \| 60900 \| Yes \| Northside \|\s+\|\n\n## Service history/);
  // A service with the next one's day and km.
  await v.ops['add-service'](rel, { what: 'Logbook service', odometer: 60950, cost: 455, next_due: '2027-10-24', next_km: 70950 });
  assert.match(read(rel), /service_due: 2027-10-24\nservice_km: 70950/);
  assert.match(read(rel), /\| 2026-10-24 \| 60950 \| Logbook service \|  \| 455 \|  \|/);
  // Renewed.
  assert.equal(await v.ops.renewed(rel, 'insurance', '2028-03-01'), 'Family wagon’s insurance now runs to Wed 1 Mar 2028.');
  // A row taken out, the rest kept.
  await v.ops['remove-row'](rel, 'fuel', 2, '2026-09-05');
  assert.doesNotMatch(read(rel), /2026-09-05/);
  assert.match(read(rel), /Spare key in the drawer\./);

  // Home: a job marked done moves on, with a Done row; a utility cell; a room added.
  const h = part('house');
  const job = 'Home/House/Maintenance/Clean the gutters.md';
  assert.equal(await h.ops['mark-done'](job, { by: 'Sam' }), 'Marked “Clean the gutters” done. Next due Sat 24 Apr 2027.');
  assert.match(read(job), /last_done: 2026-10-24\n[\s\S]*next_due: 2027-04-24/);
  assert.match(read(job), /\| 2026-10-24 \| Sam \|/);
  await h.ops['set-field']({ kind: 'utility', path: 'Home/House/Home.md', field: 'phone', value: '13 11 11', ref: { row: 0 }, title: 'Electricity' });
  assert.match(read('Home/House/Home.md'), /\| Electricity \| Brightpower \| Flat rate \| 1234 5678 \| 13 11 11 \|/);
  await h.ops['add-row']('Home/House/Home.md', 'rooms', { room: 'Garage', floor: 'Ground' });
  assert.match(read('Home/House/Home.md'), /\| Laundry \| Ground \| \|\n\| Garage \| Ground \|  \|\n/);

  // Career: a stage moved on the board (a property) is written to the timeline too.
  const c = part('career');
  const appRel = 'Me/Career/Applications/Planner at Northfield.md';
  await c.ops['set-field']({ kind: 'application', path: appRel, field: 'stage', value: 'Interview' });
  assert.match(read(appRel), /stage: Interview/);
  assert.match(read(appRel), /- 2026-10-05 — Applied\n- 2026-10-24 — Moved to Interview\n/);
  assert.match(await c.ops['add-interview'](appRel, { date: '2026-10-29', time: '14:00', kind: 'In person' }), /Added in person on Thu 29 Oct at 14:00 for Planner at Northfield\./);
  assert.match(await c.ops['set-stage'](appRel, 'Rejected', 'The role went internal'), /now at Rejected/);
  assert.match(read(appRel), /- 2026-10-24 — Not successful: The role went internal\n/);
  // A letter started from the last one, linked to its application.
  const letter = await c.ops['write-letter']('Me/Career/Applications/Analyst at Brightwater.md', '');
  assert.equal(letter, 'Me/Career/Cover letters/Cover letter Brightwater 2.md');
  assert.match(read(letter), /application: "\[\[Analyst at Brightwater\]\]"[\s\S]*---\nDear hiring team,\n\nI would love to join Brightwater/);
  assert.match(read('Me/Career/Applications/Analyst at Brightwater.md'), /letter: "\[\[Cover letter Brightwater 2\]\]"/);
  // A new CV version is a Documents and ID record.
  const cv = await c.ops['add-cv']({ version: 'v3' });
  assert.equal(cv, 'Me/Documents and ID/CV v3.md');
  assert.match(read(cv), /^---\ntype: id-document\nkind: CV\n/);

  // Travel: a booking and an expense as rows.
  const t = part('travel');
  const trip = 'Me/Travel/Trips/Lake weekend.md';
  assert.match(await t.ops['add-booking'](trip, { kind: 'Hotel', what: 'Lakeside Cabins', date: '2026-12-11', cost: 380, paid: false }), /Added Hotel: Lakeside Cabins on Fri 11 Dec to Lake weekend \(\$380\)\./);
  assert.match(read(trip), /\| 2026-12-11 \|  \| Hotel \| Lakeside Cabins \|  \|  \|  \| 380 \| No \|  \|/);
  await t.ops['set-field']({ kind: 'booking', path: trip, field: 'reference', value: 'LC-77', ref: { row: 0 }, title: 'Lakeside Cabins' });
  assert.match(read(trip), /\| Lakeside Cabins \|  \|  \| LC-77 \| 380 \|/);
});

test('main side: through a gate, notices said once, Inbox filing, and switched off nothing shows and nothing is lost', async () => {
  const L = S.sensitivity;
  const files = FILES();
  const switches = ALL_ON();
  const { w, index, posted, part, read } = core(files, switches);
  assert.equal(await w.check(), 7);
  assert.deepEqual(posted.map((p) => p.title).sort(), [
    'Analyst at Brightwater: Send the work sample',
    'Clean the gutters is overdue',
    'Dishwasher’s warranty ends in 27 days',
    'Family wagon: rego due in 12 days (Thu 5 Nov)',
    'Family wagon: service due in 100 km',
    'Leaving checklist: Harbour City Nov 2026',
    'Video tomorrow at 10:30: Analyst at Brightwater',
  ]);
  assert.equal(await w.check(), 0, 'said once');
  // The default levels: The former host app may read and change Personal notes; a chat bot may not, and
  // is told why.
  const store = L.emptyStore();
  const sens = {
    stamp: () => 'x',
    level: (rel) => L.levelOf(store, rel, index.get(rel)?.props?.sensitivity, index.get(rel)?.props?.type).level,
    decide: (who, rel, name) => L.decide(store, who, rel, sens.level(rel), name),
    useGrant: () => false,
    allows: (who, level) => L.allows(store, who, level),
    audit: () => {},
  };
  const bot = M.makeGate(sens, 'neuralbot', 'Chat bot');
  const spark = M.makeGate(sens, 'neuralspark', 'the host app');
  assert.match((await w.callTool('vehicle_list', {}, bot)).text, /No vehicles yet\.\n1 vehicle note is at a level Chat bot isn’t allowed/);
  assert.match((await w.callTool('vehicle_fuel_add', { litres: 30, cost: 60 }, bot)).text, /Chat bot/);
  assert.match((await w.callTool('travel_trip_get', {}, spark)).text, /Harbour City Nov 2026, Harbour City: Wed 28 Oct – Fri 30 Oct \(2 nights\)/);
  assert.match((await w.callTool('home_maintenance_done', { job: 'smoke alarms', date: '2026-10-20' }, spark)).text, /Marked “Test the smoke alarms” done\. Next due Wed 20 Oct 2027\. \[Home\/House\/Maintenance\/Test the smoke alarms\.md\]/);
  assert.match((await w.callTool('career_application_add', { role: 'Designer', company: 'Westpoint' }, spark)).text, /Added Designer at Westpoint to Career at Applied\. \[Me\/Career\/Applications\/Designer at Westpoint\.md\]/);
  assert.match((await w.callTool('travel_expense_add', { trip: 'Harbour', what: 'Taxi', amount: 42, category: 'Transport' }, spark)).text, /Added Taxi \(\$42\) to Harbour City Nov 2026; \$81 over its budget\./);
  assert.match((await w.callTool('home_info', {}, spark)).text, /Passwords are kept in Secrets/);
  // The Inbox: a fill-up written on the go goes into the car's log; a manual goes with its appliance.
  const { personalInbox } = M;
  const inbox = personalInbox(w);
  const line = { id: 'line:1:a', kind: 'line', path: 'Inbox.md', text: 'Filled up the wagon 41.2 L $79.10 at 61,020 km', words: 'Filled up the wagon 41.2 L $79.10 at 61,020 km', task: false, embeds: [], links: [] };
  const sugg = await inbox.suggestions(line);
  assert.deepEqual(sugg.map((s) => [s.target.module, s.target.type, s.target.label, s.why]), [['vehicles', 'fuel', 'Log a fill-up for Family wagon', 'A fill-up: 41.2 L, $79.10']]);
  const filed = await inbox.file(line, sugg[0].target);
  assert.match(filed.words, /Logged a fill-up for Family wagon: 41\.2 L for \$79\.10 at 61,020 km\./);
  assert.match(read('Home/Vehicles/Family wagon.md'), /\| 2026-10-24 \| 41\.2 \| 79\.1 \| 61020 \| Yes \|/);
  const manual = { id: 'Inbox/Brightline DW-5 manual.pdf', kind: 'file', path: 'Inbox/Brightline DW-5 manual.pdf', text: '', words: 'Brightline DW-5 manual.pdf', task: false, embeds: [], links: [] };
  const ms = await inbox.suggestions(manual);
  assert.equal(ms[0]?.target.label, 'Keep with the Dishwasher');
  assert.deepEqual(await inbox.file(manual, ms[0].target), { words: 'Kept Brightline DW-5 manual.pdf with the Dishwasher.', paths: ['Home/House/Appliances/Dishwasher.md'], keepWith: 'Home/House/Appliances/Dishwasher.md' });
  // Switched off: no tools, no notices, the tool says so, nothing offered from the Inbox, every note as it was.
  const before = Object.fromEntries(Object.keys(files).filter((r) => r.endsWith('.md')).map((r) => [r, read(r)]));
  switches.now = { house: { on: false }, vehicles: { on: false }, career: { on: false }, travel: { on: false } };
  assert.deepEqual(w.toolsOn(), []);
  assert.equal(await w.check(), 0);
  assert.match((await w.callTool('vehicle_list', {}, null)).text, /switched off/);
  assert.deepEqual(await inbox.suggestions(line), []);
  for (const [rel, text] of Object.entries(before)) assert.equal(read(rel), text, `${rel} kept as it was`);
  // One module on: only its tools.
  switches.now = { travel: { on: true } };
  assert.deepEqual([...new Set(w.toolsOn().map((t) => t.module))], ['travel']);
  void part;
});

test('9.2 Inbox filing: paint is not a fill-up, a dentist booking is no trip, a real fill-up still files', async () => {
  const { w } = core(FILES(), ALL_ON());
  const { personalInbox } = M;
  const inbox = personalInbox(w);
  const line = (words) => ({ id: `line:${words}`, kind: 'line', path: 'Inbox.md', text: words, words, task: false, embeds: [], links: [] });
  const paint = await inbox.suggestions(line('Bought 20L of paint $45 for the fence'));
  assert.deepEqual(paint.filter((s) => s.target.module === 'vehicles' && s.target.type === 'fuel'), [], 'paint is never a fill-up');
  const dentist = await inbox.suggestions(line('booking a dentist appointment for Tuesday'));
  assert.deepEqual(dentist.filter((s) => s.target.module === 'travel'), [], 'a booking is no trip');
  const fill = await inbox.suggestions(line('Filled up 41.2 L $79.10 at Northside'));
  assert.ok(fill.some((s) => s.target.module === 'vehicles' && s.target.type === 'fuel'), 'an unnamed fill-up with fuel words still files');
});

test('9.5 batch 14: a job done, a service, a stage move and a calendar import each land in one write (F161)', async () => {
  // A crash between writes must be impossible: the second write throws, so anything split fails here.
  const crash2nd = (w) => {
    let calls = 0;
    const change = w.change.bind(w);
    w.change = (async (rel, fn) => (++calls > 1 ? Promise.reject(new Error('the second write never runs')) : change(rel, fn)));
    return () => calls;
  };
  {
    const { w, part, read } = core(FILES(), ALL_ON());
    const job = 'Home/House/Maintenance/Clean the gutters.md';
    const calls = crash2nd(w);
    await part('house').ops['mark-done'](job, { by: 'Sam' });
    assert.equal(calls(), 1, 'the Done row and its properties land together');
    const note = read(job);
    assert.match(note, /next_due: 2027-04-24/);
    assert.match(note, /\| 2026-10-24 \| Sam \| +\| +\|/);
  }
  {
    const { w, part, read } = core(FILES(), ALL_ON());
    const rel = 'Home/Vehicles/Family wagon.md';
    const calls = crash2nd(w);
    await part('vehicles').ops['add-service'](rel, { what: 'Logbook service', odometer: 60950, cost: 455, next_due: '2027-10-24', next_km: 70950 });
    assert.equal(calls(), 1, 'the service row and its properties land together');
    const note = read(rel);
    assert.match(note, /service_due: 2027-10-24/);
    assert.match(note, /Logbook service/);
  }
  {
    const { w, part, read } = core(FILES(), ALL_ON());
    const appRel = 'Me/Career/Applications/Planner at Northfield.md';
    const calls = crash2nd(w);
    assert.match(await part('career').ops['set-stage'](appRel, 'Rejected', 'The role went internal'), /now at Rejected/);
    assert.equal(calls(), 1, 'the stage and its timeline line land together');
    assert.match(read(appRel), /stage: Rejected/);
  }
  {
    const { w, index, read } = core(FILES(), ALL_ON());
    const L = S.sensitivity;
    const store = L.emptyStore();
    const sens = {
      stamp: () => 'x',
      level: (rel) => L.levelOf(store, rel, index.get(rel)?.props?.sensitivity, index.get(rel)?.props?.type).level,
      decide: (who, rel, name) => L.decide(store, who, rel, sens.level(rel), name),
      useGrant: () => false,
      allows: (who, level) => L.allows(store, who, level),
      audit: () => {},
    };
    const spark = M.makeGate(sens, 'neuralspark', 'the host app');
    const calls = crash2nd(w);
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20261211T090000', 'DTEND:20261211T100000', 'SUMMARY:QF 900 to Lake Town', 'LOCATION:Terminal 1', 'END:VEVENT', 'BEGIN:VEVENT', 'DTSTART:20261212T150000', 'SUMMARY:Lakeside Hotel check-in', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    assert.match((await w.callTool('travel_import_calendar', { trip: 'Lake weekend', calendar: ics }, spark)).text, /2 bookings/);
    assert.equal(calls(), 1, 'every imported row lands in one write');
    const note = read('Me/Travel/Trips/Lake weekend.md');
    assert.match(note, /QF 900 to Lake Town/);
    assert.match(note, /Lakeside Hotel check-in/);
  }
});

test('9.5 batch 14: every life part reads a value the one way: garbage never becomes a note (F157)', async () => {
  const { part } = core(FILES(), ALL_ON());
  await assert.rejects(part('career').ops['add-application']({ role: NaN }), /needs the role or the company/, 'one shared reading: not-a-value is missing, never “NaN” written down');
});
