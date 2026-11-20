// node --test tests/module-purpose.test.mjs — modules with a purpose (8.0 SPEC section D): what needs the person
// comes first in a stable order, and Finance's spent words never contradict the figure beside them.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-purpose-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as P from ${JSON.stringify(path.join(root, 'src/shared/module-purpose.ts'))};`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'purpose.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ P } = await import(pathToFileURL(path.join(work, 'purpose.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

test('what needs the person first: overdue, then today, then soon, then the rest, done left out', () => {
  const items = [
    { title: 'Later bill', due: '2026-11-20' },
    { title: 'No day', due: null },
    { title: 'Done one', due: '2026-10-01', done: true },
    { title: 'Due today', due: '2026-10-29' },
    { title: 'Most overdue', due: '2026-10-10' },
    { title: 'A bit overdue', due: '2026-10-28' },
    { title: 'Due soon', due: '2026-11-02' },
  ];
  assert.deepEqual(P.attentionOrder(items, '2026-10-29').map((i) => i.title), ['Most overdue', 'A bit overdue', 'Due today', 'Due soon', 'Later bill', 'No day']);
  // The input is not rearranged.
  assert.equal(items[0].title, 'Later bill');
});

test('spent words say where the figure comes from and never ask for an import beside a figure', () => {
  assert.match(P.spentLine(686.33, 0, 'Oct'), /Nothing recorded for Oct yet/);
  assert.match(P.spentLine(686.33, 12, 'Oct'), /From 12 entries/);
  assert.doesNotMatch(P.spentLine(686.33, 12, 'Oct'), /[Ii]mport your bank/);
  assert.match(P.spentLine(20, 1, 'Oct'), /From 1 entry\b/);
});

const TODAY = '2026-10-29';
const lead = (cards) => P.selectNeeds(cards, TODAY).map((c) => c.title);

test('when in words: late, today, tomorrow, in days', () => {
  assert.equal(P.whenWords('2026-10-26', TODAY), '3 days late');
  assert.equal(P.whenWords('2026-10-28', TODAY), '1 day late');
  assert.equal(P.whenWords('2026-10-29', TODAY), 'today');
  assert.equal(P.whenWords('2026-10-30', TODAY), 'tomorrow');
  assert.equal(P.whenWords('2026-11-03', TODAY), 'in 5 days');
  assert.equal(P.whenWords(null, TODAY), '');
});

test('finance: bills due lead, autopay shown but opened not marked, amount is the detail, Mark paid', () => {
  // 9.2 reverses "autopay left out": an autopay bill due tomorrow is money going out and shows (it pays itself, so
  // it opens); one past its day with no confirmation may not have gone through, and is marked paid like any
  // overdue bill.
  const cards = P.selectNeeds(P.financeNeeds([
    { name: 'Far bill', next: '2026-12-20', amount: 50 },
    { name: 'Auto bill', next: '2026-10-30', amount: 20, autopay: true },
    { name: 'Late bill', next: '2026-10-26', amount: 89, account: 'Everyday' },
    { name: 'Soon bill', next: '2026-11-03', amount: 120 },
    { name: 'Stuck autopay', next: '2026-10-20', amount: 60, autopay: true, overdue: true },
  ], TODAY), TODAY);
  assert.deepEqual(cards.map((c) => c.title), ['Stuck autopay', 'Late bill', 'Auto bill', 'Soon bill']);
  assert.equal(cards[0].action, 'Mark paid');
  assert.equal(cards[2].action, 'Open');
  assert.match(cards[2].detail, /Autopay/);
  assert.equal(cards[1].action, 'Mark paid');
  assert.match(cards[1].detail, /89/);
});

test('documents: documents and IDs expiring lead, Renew', () => {
  assert.deepEqual(lead(P.documentsNeeds([
    { name: 'Passport', kind: 'Passport', expires: '2027-05-01' },
    { name: 'Licence', kind: 'Driver licence', expires: '2026-11-03' },
    { name: 'Old card', kind: 'ID card', expires: '2026-10-20' },
  ], TODAY)), ['Old card', 'Licence']);
  assert.equal(P.selectNeeds(P.documentsNeeds([{ name: 'Licence', expires: '2026-11-03' }], TODAY), TODAY)[0].action, 'Renew');
});

test('sites: warranties ending and patch work due lead', () => {
  assert.deepEqual(lead(P.sitesNeeds(
    [{ device: 'Switch', what: 'Warranty ends', date: '2026-11-05' }, { device: 'Old server', what: 'End of life', date: '2026-10-27' }],
    [{ title: 'Patch panel A', due: '2026-10-29' }, { title: 'Patch panel B', due: '2027-01-01' }],
    TODAY)), ['Old server: end of life', 'Patch panel A', 'Switch: warranty ends']);
});

test('vendors: quotes waiting and contracts ending lead', () => {
  assert.deepEqual(lead(P.vendorsNeeds(
    [{ name: 'Quote 1', vendor: 'Harbour Electrical', validUntil: '2026-11-02', amount: 4820, open: true }, { name: 'Decided', vendor: 'X', validUntil: '2026-10-30', amount: 1, open: false }],
    [{ name: 'Support contract', vendor: 'Northwind', ends: '2026-10-28', amount: 900 }],
    TODAY)), ['Northwind: contract', 'Harbour Electrical: quote']);
});

test('weekly: the weekly update not sent this week leads, Send; sent means calm', () => {
  const due = P.selectNeeds(P.weeklyNeeds({ week: TODAY, status: 'Draft', sent: '', path: 'w.md' }, TODAY, '2026-10-30', TODAY), TODAY);
  assert.equal(due.length, 1);
  assert.equal(due[0].action, 'Send');
  assert.deepEqual(P.weeklyNeeds({ week: TODAY, status: 'Sent', sent: TODAY, path: 'w.md' }, TODAY, '2026-10-30', TODAY), []);
});

test('business: certificates expiring and open support lead', () => {
  assert.deepEqual(lead(P.businessNeeds(
    [{ name: 'Main site', date: '2026-11-04', kind: 'Certificate expires' }, { name: 'Shop', date: '2027-02-01', kind: 'Domain renews' }],
    [{ title: 'Checkout broken', customer: 'Harbour Cafe', priority: 'Urgent', received: '2026-10-28' }],
    TODAY)), ['Checkout broken', 'Main site']);
});

test('systems: runbooks due and machines down lead', () => {
  assert.deepEqual(lead(P.systemsNeeds(
    [{ name: 'Back up the NAS', nextDue: '2026-10-27' }, { name: 'Patch servers', nextDue: '2026-12-01' }],
    [{ name: 'NAS', status: 'Down' }],
    TODAY)), ['Back up the NAS', 'NAS is down']);
});

test('systems: a machine never checked needs its login, with an Add its login button', () => {
  const cards = P.selectNeeds(P.systemsNeeds(
    [],
    [],
    TODAY,
    [{ name: 'Office NAS', path: 'Machines/Office NAS.md', title: 'Office NAS needs its login so the host app can check it', action: 'Add its login' }],
  ), TODAY);
  assert.equal(cards.length, 1, 'an unchecked machine needs the person, so the calm line is not shown');
  assert.equal(cards[0].title, 'Office NAS needs its login so the host app can check it');
  assert.equal(cards[0].action, 'Add its login', 'its one button adds its login');
});

test('goals: milestones due, habits for today and goals off track lead', () => {
  const cards = P.selectNeeds(P.goalsNeeds(
    [{ title: 'Run 15 km', goalName: 'Half marathon', due: '2026-11-01' }, { title: 'Done one', due: '2026-10-28', done: true }],
    [{ name: 'Run', doneToday: false }, { name: 'Read', doneToday: true }],
    [{ name: 'Save for a car', status: 'Behind', nextDue: null }],
    TODAY), TODAY);
  assert.deepEqual(cards.map((c) => c.title), ['Run', 'Run 15 km', 'Save for a car']);
  assert.equal(cards[0].action, 'Log it');
});

test('memories: creative projects due lead, done left out', () => {
  assert.deepEqual(lead(P.memoriesNeeds([
    { name: 'Birthday poster', due: '2026-11-02', status: 'Making' },
    { name: 'Old card', due: '2026-10-28', status: 'Done' },
    { name: 'Far invite', due: '2027-01-10', status: 'Idea' },
  ], TODAY)), ['Birthday poster']);
});

test('lists: what is under way leads with no day', () => {
  const cards = P.selectNeeds(P.listsNeeds([{ title: 'Severance', listName: 'Watch list' }, { title: 'Dune', listName: 'Reading list' }], TODAY), TODAY);
  assert.deepEqual(cards.map((c) => c.title), ['Severance', 'Dune']);
  assert.equal(cards[0].due, null);
});

test('career: follow-ups due and interviews coming lead', () => {
  assert.deepEqual(lead(P.careerNeeds(
    [{ name: 'App', company: 'Harbour Lane', nextDate: '2026-10-27', nextStep: 'Send portfolio' }],
    [{ name: 'Interview', company: 'Northwind', date: '2026-11-03' }, { name: 'Far', company: 'Far Co', date: '2027-01-01' }],
    TODAY)), ['Harbour Lane', 'Interview: Northwind']);
});

test('travel: trips coming up lead, past trips left out', () => {
  assert.deepEqual(lead(P.travelNeeds([
    { name: 'Tasmania', starts: '2026-11-06', phase: 'Upcoming' },
    { name: 'Old trip', starts: '2026-09-01', phase: 'Back' },
    { name: 'Far trip', starts: '2027-03-01', phase: 'Upcoming' },
  ], TODAY)), ['Tasmania']);
});

test('house: maintenance due and warranties ending lead', () => {
  assert.deepEqual(lead(P.houseNeeds(
    [{ name: 'Clean gutters', nextDue: '2026-10-26', state: 'Overdue' }, { name: 'Done job', nextDue: '2026-10-28', state: 'Done' }],
    [{ name: 'Dishwasher', warranty: '2026-11-08' }, { name: 'Fridge', warranty: '2028-01-01' }],
    TODAY)), ['Clean gutters', 'Dishwasher: warranty']);
});

test('vehicles: rego, insurance and service due lead', () => {
  assert.deepEqual(lead(P.vehiclesNeeds([
    { vehicle: 'Wagon', what: 'Service', date: '2026-11-10', detail: 'At 85,000 km' },
    { vehicle: 'Wagon', what: 'Rego', date: '2026-10-25' },
    { vehicle: 'Ute', what: 'Insurance', date: '2027-01-01' },
  ], TODAY)), ['Wagon: rego', 'Wagon: service']);
});

test('publications: an edition due leads, a sent one does not', () => {
  assert.equal(P.selectNeeds(P.publicationsNeeds({ label: 'Weekend Post No. 13', date: '2026-10-31', status: 'Draft' }, TODAY), TODAY).length, 1);
  assert.deepEqual(P.publicationsNeeds({ label: 'Weekend Post No. 12', date: '2026-10-24', status: 'Sent' }, TODAY), []);
  assert.deepEqual(P.selectNeeds(P.publicationsNeeds({ label: 'Far edition', date: '2027-02-01', status: 'Draft' }, TODAY), TODAY), []);
});

test('family: events and birthdays coming up lead', () => {
  assert.deepEqual(lead(P.familyNeeds(
    [{ what: 'Swimming carnival', who: 'Mia', date: '2026-11-01' }, { what: 'Far event', date: '2027-01-01' }],
    [{ name: 'Josh', day: '2026-10-29' }],
    TODAY)), ['Josh\'s birthday', 'Swimming carnival']);
});

test('health: appointments, check-in and habits lead, Log it', () => {
  const cards = P.selectNeeds(P.healthNeeds(
    [{ title: 'GP check', date: '2026-11-02' }, { title: 'Far physio', date: '2027-01-01' }],
    true,
    [{ name: 'Walk', doneToday: false }, { name: 'Stretch', doneToday: true }],
    TODAY), TODAY);
  assert.deepEqual(cards.map((c) => c.title), ['Today\'s check-in', 'Walk', 'GP check']);
  assert.equal(cards[0].action, 'Log it');
});

test('needs lead holds at most 4 cards, overdue first', () => {
  const bills = [1, 2, 3, 4, 5, 6].map((n) => ({ name: `Bill ${n}`, next: `2026-11-0${n}`, amount: n }));
  bills.push({ name: 'Late one', next: '2026-10-20', amount: 9 });
  const cards = P.selectNeeds(P.financeNeeds(bills, TODAY), TODAY);
  assert.equal(cards.length, 4);
  assert.equal(cards[0].title, 'Late one');
});

test('nothing needs you: the calm line, with the next date when there is one', () => {
  assert.equal(P.nothingNeedsYou(null, TODAY), 'Nothing needs you here this week.');
  const next = P.nextNeedsDate(P.financeNeeds([{ name: 'Far bill', next: '2026-12-20', amount: 50 }], TODAY), TODAY);
  assert.equal(P.nothingNeedsYou(next, TODAY), 'Nothing needs you here this week. Next: Far bill, in 52 days (20 Dec).');
  // Nothing in the window still reads calm through the lead itself.
  assert.deepEqual(P.selectNeeds(P.documentsNeeds([{ name: 'Passport', expires: '2029-03-12' }], TODAY), TODAY), []);
});

test('tour steps are the module words, its fills and a labelled example, in that order', () => {
  const steps = P.tourSteps({ name: 'Vehicles', words: 'Cars with rego.', fills: 'Send a photo of the rego papers.', example: { title: 'Wagon', lines: ['Rego due 1 Feb'] } });
  assert.deepEqual(steps.map((s) => s.title), ['What Vehicles keeps', 'It fills itself', 'What a record looks like']);
  assert.equal(steps[2].example.title, 'Wagon');
});
