// node --test tests/people-meetings.test.mjs — People and Meetings (Job B, 29 Oct 2026, SPEC B): an organisation read from an email's domain, you owe and owes you from open actions, last and next meeting, the people filters and their order; a meeting's people from attendees: and Who came, meetings grouped by day, action counts, and prep before a meeting with actions after it. Made-up people and meetings only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-people-meetings-'));
let P, WM, R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/people.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/shared/work-meetings.ts'))};\nexport { buildRecordModel } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'pm.mjs'), format: 'esm' }, logLevel: 'silent' });
  const m = await import(pathToFileURL(path.join(work, 'pm.mjs')).href);
  P = m; WM = m; R = m;
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = '2026-10-29';
const note = (p, title, props, content) => ({ path: p, title, props, content, mtime: 0 });
function model() {
  const project = ['---', 'type: project', '---', '# Harbour Fit-out', '', '## What\'s next', '', '- [ ] Send Sam Okafor the revised plan — Ana Ruiz · by 2026-11-02', '- [ ] Confirm the cabling quote — Sam Okafor · by 2026-11-05', '- [x] Book the site walk — Sam Okafor', '', '## People', '', '- **Sam Okafor** — Joinery lead', '- **Priya Shah** — Client lead', ''].join('\n');
  const sam = ['---', 'type: person', 'role: Joinery lead', 'email: sam@bluepeak.com', '---', '# Sam Okafor', ''].join('\n');
  const priya = ['---', 'type: person', 'role: Client lead', 'org: Tessaly', 'email: priya@outlook.com', '---', '# Priya Shah', ''].join('\n');
  const past = ['---', 'type: meeting', 'date: 2026-10-20', 'attendees: [Sam Okafor]', 'project: "[[Harbour Fit-out]]"', '---', '# Site walk', '', 'Who came: Priya Shah', '', '## Actions', '', '- [ ] Fix the door swing — Sam Okafor', '- [x] Measure the counter — Ana Ruiz', ''].join('\n');
  const next = ['---', 'type: meeting', 'date: 2026-11-03', 'attendees: [Sam Okafor, Priya Shah]', '---', '# Fit-out check-in', '', '## Actions', '', '- [ ] Bring the samples — Priya Shah', ''].join('\n');
  return R.buildRecordModel({ notes: [note('Projects/Harbour Fit-out/Harbour Fit-out.md', 'Harbour Fit-out', { type: 'project' }, project), note('People/Sam Okafor.md', 'Sam Okafor', { type: 'person', role: 'Joinery lead', email: 'sam@bluepeak.com' }, sam), note('People/Priya Shah.md', 'Priya Shah', { type: 'person', role: 'Client lead', org: 'Tessaly', email: 'priya@outlook.com' }, priya), note('Meetings/2026-10-20 Site walk.md', 'Site walk', { type: 'meeting', date: '2026-10-20', attendees: ['Sam Okafor'], project: '[[Harbour Fit-out]]' }, past), note('Meetings/2026-11-03 Fit-out check-in.md', 'Fit-out check-in', { type: 'meeting', date: '2026-11-03', attendees: ['Sam Okafor', 'Priya Shah'] }, next)], resolve: () => null, today: TODAY, me: 'Ana Ruiz' });
}

test('an organisation comes from the note, else from the email domain as a company name', () => {
  assert.equal(P.organisationFromEmail('sam@bluepeak.com'), 'Blue Peak');
  assert.equal(P.organisationFromEmail('j@tessaly.com'), 'Tessaly');
  assert.equal(P.organisationFromEmail('a@mail.bluepeak.com'), 'Blue Peak');
  assert.equal(P.organisationFromEmail('a@acme-corp.com.au'), 'Acme Corp');
  assert.equal(P.organisationFromEmail('priya@outlook.com'), undefined, 'a personal mailbox names no company');
  assert.equal(P.organisationFromEmail('a@startup.io'), 'Startup');
  assert.equal(P.organisationFromEmail('a@startup.ai'), 'Startup');
  assert.equal(P.organisationFromEmail('a@acme.biz'), 'Acme');
  assert.equal(P.organisationFromEmail('a@tessaly.co.uk'), 'Tessaly');
  assert.equal(P.organisationFromEmail('a@acme.com.au'), 'Acme');
  assert.equal(P.organisationFromEmail(''), undefined);
  const cards = P.personCards(model());
  const sam = cards.find((c) => c.name === 'Sam Okafor');
  const priya = cards.find((c) => c.name === 'Priya Shah');
  assert.equal(sam.orgName, 'Blue Peak');
  assert.equal(sam.orgFromEmail, true);
  assert.equal(priya.orgName, 'Tessaly', 'the note wins over the mailbox');
  assert.equal(priya.orgFromEmail, false);
});

test('last contact reads “last spoke” and ordinary dates, never a future day (9.5 fourth pass)', () => {
  const m = model();
  const priya = (props) => P.personCards(m, (p) => (p.endsWith('Priya Shah.md') ? props : undefined)).find((c) => c.name === 'Priya Shah');
  assert.equal(priya({ 'Last spoke': '22 Oct 2026' }).lastContact.date, '2026-10-22');
  assert.equal(priya({ 'last contact': '22 Oct 2026' }).lastContact.date, '2026-10-22');
  assert.equal(priya({ 'last contact': '2026-12-25' }).lastContact, undefined, 'a future day is not a last contact');
});

test('you owe counts your open actions that name them; owes you counts theirs; done actions count for neither', () => {
  const sam = P.personCards(model()).find((c) => c.name === 'Sam Okafor');
  assert.equal(sam.owesYou, 2, 'the cabling quote and the door swing are Sam\'s to do (the ticked site walk is not)');
  assert.ok(sam.youOwe >= 1, 'your open plan for Sam is yours to do');
  assert.ok(sam.youOweItems.some((x) => /revised plan/.test(x.title)));
  assert.ok(sam.owesYouItems.some((x) => /cabling quote/.test(x.title)));
  assert.equal(sam.youOwe + sam.owesYou, sam.open, 'the two sides add up to everything open with them');
});

test('last met is the latest past meeting; next meeting is the soonest to come', () => {
  const sam = P.personCards(model()).find((c) => c.name === 'Sam Okafor');
  assert.equal(sam.lastContact.date, '2026-10-20');
  assert.equal(sam.nextMeeting.date, '2026-11-03');
  assert.equal(sam.nextMeeting.title, 'Fit-out check-in');
});

test('filters keep their people, search matches the organisation, and the list is sorted by most to act on', () => {
  const cards = P.personCards(model()).filter((c) => c.type === 'person');
  assert.ok(P.filterPeople(cards, 'owes-you', TODAY).some((c) => c.name === 'Sam Okafor'));
  assert.ok(P.filterPeople(cards, 'you-owe', TODAY).some((c) => c.name === 'Sam Okafor'));
  assert.ok(P.filterPeople(cards, 'recent', TODAY).some((c) => c.name === 'Sam Okafor'), 'met nine days ago is recent');
  assert.deepEqual(P.filterPeople(cards, 'recent', TODAY).filter((c) => c.name === 'Priya Shah').length, 0, 'no past meeting, so not met recently');
  assert.ok(P.filterPeople(cards, 'all', TODAY, 'blue peak').some((c) => c.name === 'Sam Okafor'), 'search finds the domain organisation');
  assert.ok(P.filterPeople(cards, 'all', TODAY, 'harbour').some((c) => c.name === 'Sam Okafor'), 'search finds the project they are in');
  assert.ok(P.filterPeople(cards, 'all', TODAY, 'site walk').some((c) => c.name === 'Sam Okafor'), 'search finds a meeting they were at');
  const sorted = P.sortPeopleByAction(cards);
  assert.equal(sorted[0].name, 'Sam Okafor', 'the most open between you comes first');
});

test('an email reads on its sender’s card through the sender prop (t243)', () => {
  const mail = ['---', 'type: email', 'subject: Awning quote lapses Friday', 'sender: "[[Sam Okafor]]"', '---', '# Awning quote lapses Friday', '', 'Twelve hundred fitted.', ''].join('\n');
  const m = R.buildRecordModel({ notes: [note('People/Sam Okafor.md', 'Sam Okafor', { type: 'person', email: 'sam@bluepeak.com' }, '# Sam Okafor\n'), note('Inbox/Awning quote lapses Friday.md', 'Awning quote lapses Friday', { type: 'email', subject: 'Awning quote lapses Friday', sender: '[[Sam Okafor]]' }, mail)], resolve: () => null, today: TODAY, me: 'Ana Ruiz' });
  const sam = P.personCards(m).find((c) => c.name === 'Sam Okafor');
  assert.ok(sam.notes.some((n) => n.title === 'Awning quote lapses Friday'), 'the email is among their notes');
  assert.ok(P.personTimeline(sam).some((e) => e.title === 'Awning quote lapses Friday'), 'and on their timeline');
});

test('a meeting reads its people from attendees: and from Who came, each once', () => {
  const m = WM.readMeeting({ path: 'Meetings/2026-10-20 Site walk.md', title: 'Site walk', props: { type: 'meeting', date: '2026-10-20', attendees: ['Sam Okafor'] }, content: 'Who came: Priya Shah, Sam Okafor\n\n## Actions\n\n- [ ] Fix the door swing — Sam Okafor' });
  assert.deepEqual([...m.people].sort(), ['Priya Shah', 'Sam Okafor']);
});

test('meetings group by day: today and this week coming up, past newest first, actions counted', () => {
  const mk = (date, time, done) => ({ path: `Meetings/${date}.md`, title: `${date} Meet`, date, dated: true, time, where: '', people: [], project: '', series: '', agenda: [], decisions: [], actions: [{ line: 1, raw: '', what: 'Do it', done }, { line: 2, raw: '', what: 'Do more', done: false }], summary: '', transcripts: 0, recordings: 0 });
  const g = WM.groupMeetingsByDay([mk('2026-11-10', '09:00', false), mk('2026-10-29', '10:00', false), mk('2026-10-30', '09:00', true), mk('2026-10-20', '09:00', false)], TODAY);
  assert.deepEqual(g.upcomingThisWeek.map((x) => x.date), ['2026-10-29', '2026-10-30']);
  assert.equal(g.upcomingThisWeek[0].label, 'Today');
  assert.deepEqual(g.past.map((x) => x.date), ['2026-10-20']);
  assert.deepEqual(WM.meetingActionCounts(mk('2026-10-29', '10:00', true)), { total: 2, open: 1 });
  assert.equal(WM.meetingPhase(mk('2026-10-29', '10:00', false), TODAY), 'before', 'a meeting today is still for prep');
  assert.equal(WM.meetingPhase(mk('2026-10-20', '09:00', false), TODAY), 'after');
  assert.equal(WM.meetingDayLabel('2026-10-30', TODAY), 'Tomorrow');
});
