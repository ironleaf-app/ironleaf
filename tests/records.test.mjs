// node --test tests/records.test.mjs — the connected vault (src/shared/records.ts): every piece of a project read as a
// record with a stable id and type from the plain Markdown people keep, and the links found by themselves (owners,
// attendees, contacts, a meeting's actions, files a note names, items about the same thing, a key date on a meeting's
// day); and the questions screens and the assistant ask of it. Made-up notes only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-records-'));
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/records.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const PROJECT = 'Projects/Harbour Fit-out/Harbour Fit-out.md';
const project = `---
type: project
status: active
health: at risk
owner: Ana Ruiz
due: 2026-04-30
---
# Harbour Fit-out

Fit-out of the harbour café.

## Workstreams

| Workstream | Owner | Status | Progress | Next step |
| --- | --- | --- | --- | --- |
| Joinery | Sam Okafor | at risk | 40 | Confirm the Tasmanian oak counter |
| Electrical | Mia Tran | on track | 70 | Book the switchboard upgrade |

## What's next

- [ ] Send the joinery quote — Sam Okafor · by 2026-03-13 ([[2026-03-10 Site walk]])
- [ ] Approve the lighting plan — Ana Ruiz · by 2026-03-01
- [ ] Order the Tasmanian oak slab — Ana Ruiz
- [x] Sign the lease — Ana Ruiz · by 2026-02-01

## Key dates

| Date | Milestone | Status |
| --- | --- | --- |
| 2026-03-10 | Site walk with the builders | done |
| 2026-03-20 | Joinery install starts | next |
| 2026-02-20 | Council permit lodged | late |

## People

- **Ana Ruiz** — Owner
- **Sam Okafor** — Joinery lead
- **Coastline Joinery Pty Ltd** — Joinery supplier

## Risks and issues

| Risk | Impact | Owner | Status |
| --- | --- | --- | --- |
| Tasmanian oak slab could arrive late | High | Sam Okafor | Open |
| Permit may need a second lodgement | Medium | | Open |

## Decisions

- **2026-03-10** — Use Tasmanian oak for the counter. *Why:* Matches the bar

## Documents

- [[Attachments/joinery-quote.pdf|joinery-quote.pdf]] — the joinery quote
- \`Drawings/counter-v2.pdf\` — counter drawing, version 2

## Notes

- [ ] A private reminder the notes keep — not an action of the project's lists
`;

const meeting = `---
type: meeting
date: 2026-03-10
project: "[[Harbour Fit-out]]"
attendees: [Ana Ruiz, Sam Okafor, Mia Tran]
---
# Site walk

## Decisions

- Counter goes on the north wall

## Actions

- Sam to send the joinery quote by Friday
- [ ] Book the electrician — Mia Tran — by 14 Mar 2026
- [ ] What needs doing — who — by when
`;

const sam = `---
type: person
role: Joinery lead
org: Coastline Joinery Pty Ltd
email: sam@example.com
---
# Sam Okafor

## Open

- [ ] Ask Sam about the second counter
`;

const mia = `---
type: person
role: Electrician
---
# Mia Tran
`;

const brief = `# Counter brief

The counter drawing is ![[counter-sketch.png]] and the quote is [[joinery-quote.pdf]].

- [ ] Check the sketch with [[Sam Okafor]] 📅 2026-03-12
`;

const template = `---
type: project
---
# Template project

## What's next

- [ ] An example step — Someone · by 2026-01-01
`;

const NOTES = [
  { path: PROJECT, title: 'Harbour Fit-out', content: project, props: { type: 'project', status: 'active', health: 'at risk', owner: 'Ana Ruiz', due: '2026-04-30' } },
  { path: 'Meetings/2026-03-10 Site walk.md', title: '2026-03-10 Site walk', content: meeting, props: { type: 'meeting', date: '2026-03-10', project: '[[Harbour Fit-out]]', attendees: ['Ana Ruiz', 'Sam Okafor', 'Mia Tran'] } },
  { path: 'People/Sam Okafor.md', title: 'Sam Okafor', content: sam, props: { type: 'person', role: 'Joinery lead', org: 'Coastline Joinery Pty Ltd', email: 'sam@example.com' } },
  { path: 'People/Mia Tran.md', title: 'Mia Tran', content: mia, props: { type: 'person', role: 'Electrician' } },
  { path: 'Projects/Harbour Fit-out/Counter brief.md', title: 'Counter brief', content: brief, props: {} },
  { path: 'Templates/Projects/Example.md', title: 'Example', content: template, props: { type: 'project' } },
];
const FILES = ['Attachments/joinery-quote.pdf', 'Attachments/counter-sketch.png', 'Projects/Harbour Fit-out/Files/site-photo.jpg', 'Assets/Logos/unrelated.png'];

function resolver(notes, files) {
  const all = [...notes.map((n) => n.path), ...files];
  return (target) => {
    const t = target.trim();
    if (all.includes(t)) return t;
    if (all.includes(`${t}.md`)) return `${t}.md`;
    const name = t.split('/').pop().replace(/\.md$/, '').toLowerCase();
    return all.find((p) => p.split('/').pop().replace(/\.md$/, '').toLowerCase() === name) ?? null;
  };
}
const build = (notes = NOTES, files = FILES, extra = {}) => R.buildRecordModel({ notes, files, resolve: resolver(notes, files), today: '2026-03-11', me: 'Ana Ruiz', ...extra });
const near = (m, id) => R.connectedTo(m, id).map((x) => ({ id: x.record.id, kinds: x.kinds, whys: x.whys }));
const linked = (m, a, b, kind) => near(m, a).some((x) => x.id === b && (!kind || x.kinds.includes(kind)));

test('every piece of a project is a record with a stable id and type', () => {
  const m = build();
  const r = (id) => m.records.get(id);
  assert.equal(r(`project:${PROJECT}`).type, 'project');
  const quote = r(`action:${PROJECT}#send-the-joinery-quote`);
  assert.ok(quote, 'the project’s next step');
  assert.equal(quote.owner, 'Sam Okafor');
  assert.equal(quote.due, '2026-03-13');
  assert.equal(quote.item, 'next:0');
  assert.equal(quote.line, project.split('\n').findIndex((l) => l.includes('Send the joinery quote')));
  assert.equal(r(`action:${PROJECT}#sign-the-lease`).done, true);
  const ws = r(`workstream:${PROJECT}#joinery`);
  assert.equal(ws.owner, 'Sam Okafor');
  assert.equal(ws.progress, 40);
  assert.equal(ws.status, 'at risk');
  const walk = r(`milestone:${PROJECT}#site-walk-with-the-builders`);
  assert.equal(walk.date, '2026-03-10');
  assert.equal(walk.item, 'dates:0');
  const slab = r(`risk:${PROJECT}#tasmanian-oak-slab-could-arrive-late`);
  assert.equal(slab.level, 'high');
  assert.equal(slab.owner, 'Sam Okafor');
  assert.ok(r(`decision:${PROJECT}#use-tasmanian-oak-for-the-counter`));
  assert.equal(r('person:sam okafor').path, 'People/Sam Okafor.md');
  assert.equal(r('person:ana ruiz').path, PROJECT, 'someone named only in a project is a person too');
  assert.equal(r('org:coastline-joinery').type, 'org');
  assert.equal(r('meeting:Meetings/2026-03-10 Site walk.md').date, '2026-03-10');
  assert.equal(r('file:Attachments/joinery-quote.pdf').type, 'file');
  const drawing = r(`file:${PROJECT}::Drawings/counter-v2.pdf`);
  assert.equal(drawing.folderFile, 'Drawings/counter-v2.pdf', 'a document in the project’s folder on the PC');
  assert.ok(r('file:Projects/Harbour Fit-out/Files/site-photo.jpg'), 'a file the project keeps in its folder');
  assert.ok(!r('file:Assets/Logos/unrelated.png'), 'a file nothing names and no project keeps is not a record');
  // Notes and templates.
  assert.ok(![...m.records.values()].some((x) => x.path.startsWith('Templates/')), 'templates are left out');
  assert.ok(![...m.records.values()].some((x) => x.title.startsWith('A private reminder')), 'the person’s own Notes section isn’t read for actions');
  assert.ok(![...m.records.values()].some((x) => /what needs doing/i.test(x.title)), 'the meeting template’s example line is not an action');
});

test('ids stay the same when other lines change, and two of the same name stay apart', () => {
  const a = build();
  const edited = NOTES.map((n) => (n.path === PROJECT ? { ...n, content: n.content.replace('Fit-out of the harbour café.', 'Fit-out of the harbour café.\n\nA second paragraph.\n') } : n));
  const b = build(edited);
  for (const id of a.records.keys()) assert.ok(b.records.has(id), `kept ${id}`);
  const twice = NOTES.map((n) => (n.path === PROJECT ? { ...n, content: n.content.replace('## Key dates', '- [ ] Order the Tasmanian oak slab — Mia Tran\n\n## Key dates') } : n));
  const c = build(twice);
  assert.ok(c.records.has(`action:${PROJECT}#order-the-tasmanian-oak-slab`));
  assert.ok(c.records.has(`action:${PROJECT}#order-the-tasmanian-oak-slab~2`));
});

test('links are found by themselves, each with its reason from both ends', () => {
  const m = build();
  const quote = `action:${PROJECT}#send-the-joinery-quote`;
  const meet = 'meeting:Meetings/2026-03-10 Site walk.md';
  assert.ok(linked(m, quote, 'person:sam okafor', 'owner'));
  assert.deepEqual(near(m, quote).find((x) => x.id === 'person:sam okafor').whys, ['Owner']);
  assert.ok(near(m, 'person:sam okafor').find((x) => x.id === quote).whys.includes('Theirs to do'));
  assert.ok(linked(m, 'person:mia tran', meet, 'attendee'), 'attendees');
  assert.ok(linked(m, meet, `project:${PROJECT}`, 'project'), 'a meeting’s project property');
  // The meeting's own actions, and the project's copy filed from it.
  const fromMeeting = [...m.records.values()].filter((r) => r.type === 'action' && r.path === meet.slice(8));
  assert.deepEqual(fromMeeting.map((r) => r.title).sort(), ['Book the electrician', 'Send the joinery quote'].sort());
  const sentBy = fromMeeting.find((r) => r.title.startsWith('Send'));
  assert.equal(sentBy.owner, 'Sam Okafor', 'who, read from "Sam to …" as the one Sam the vault knows');
  assert.equal(sentBy.when, 'Friday');
  assert.ok(linked(m, sentBy.id, 'person:sam okafor', 'owner'), 'a first name the vault knows once is that person');
  assert.equal(m.records.get(quote).source, meet, 'the project’s step links to the meeting it came from');
  assert.ok(linked(m, quote, meet, 'source'));
  assert.ok(linked(m, `decision:Meetings/2026-03-10 Site walk.md#counter-goes-on-the-north-wall`, meet, 'source'), 'a meeting’s decisions');
  // Contacts and organisations.
  assert.ok(linked(m, 'org:coastline-joinery', `project:${PROJECT}`, 'contact'));
  assert.ok(linked(m, 'person:sam okafor', 'org:coastline-joinery', 'org'));
  assert.ok(near(m, `project:${PROJECT}`).find((x) => x.id === 'person:sam okafor').whys.includes('Joinery lead'));
  // Files a note names, and the project's documents.
  const brief = 'note:Projects/Harbour Fit-out/Counter brief.md';
  assert.ok(linked(m, brief, 'file:Attachments/counter-sketch.png', 'file'));
  assert.ok(linked(m, `project:${PROJECT}`, 'file:Attachments/joinery-quote.pdf', 'file'));
  assert.ok(linked(m, brief, `project:${PROJECT}`, 'project'), 'a note in the project’s folder belongs to it');
  const check = `action:Projects/Harbour Fit-out/Counter brief.md#check-the-sketch-with-sam-okafor`;
  assert.equal(m.records.get(check).due, '2026-03-12');
  assert.ok(linked(m, check, 'person:sam okafor'), 'an action linking to a person');
  // Items of one project about the same thing; a key date on a meeting's day.
  assert.ok(linked(m, `decision:${PROJECT}#use-tasmanian-oak-for-the-counter`, `risk:${PROJECT}#tasmanian-oak-slab-could-arrive-late`, 'about'));
  assert.match(near(m, `risk:${PROJECT}#tasmanian-oak-slab-could-arrive-late`).find((x) => x.kinds.includes('about')).whys[0], /^Both about Tasmanian/);
  assert.ok(linked(m, `milestone:${PROJECT}#site-walk-with-the-builders`, meet, 'same-day'));
});

test('the peek groups everything connected', () => {
  const m = build();
  const peek = R.peekOf(m, { type: 'person', name: 'Sam Okafor' });
  assert.equal(peek.record.id, 'person:sam okafor');
  const keys = peek.groups.map((g) => g.key);
  assert.deepEqual(keys, R.GROUP_ORDER.filter((k) => keys.includes(k)), 'in the peek’s order');
  assert.ok(keys.includes('actions') && keys.includes('meetings') && keys.includes('timeline') && keys.includes('projects'));
  const actions = peek.groups.find((g) => g.key === 'actions').items.map((x) => x.record);
  assert.ok(actions.findIndex((r) => r.done) === -1 || actions.findIndex((r) => r.done) > actions.findIndex((r) => !r.done), 'open first');
  assert.equal(peek.record.facts.find((f) => f.key === 'org').ref, 'org:coastline-joinery');
  // A screen asks by what it drew.
  assert.equal(R.resolveRef(m, { type: 'action', path: PROJECT, title: 'Send the joinery quote' }).id, `action:${PROJECT}#send-the-joinery-quote`);
  const line = project.split('\n').findIndex((l) => l.includes('Approve the lighting plan'));
  assert.equal(R.resolveRef(m, { type: 'action', path: PROJECT, line }).title, 'Approve the lighting plan');
  assert.equal(R.resolveRef(m, { path: 'Meetings/2026-03-10 Site walk.md' }).type, 'meeting');
  assert.equal(R.resolveRef(m, { type: 'file', path: PROJECT, folderFile: 'Drawings/counter-v2.pdf' }).type, 'file');
});

test('what is open with a person, from a meeting, and what a project needs', () => {
  const m = build();
  const sam = R.personOpenItems(m, 'Sam');
  assert.equal(sam.person.id, 'person:sam okafor');
  assert.ok(sam.theirs.some((r) => r.title === 'Send the joinery quote'));
  assert.ok(sam.about.some((r) => r.title === 'Ask Sam about the second counter'), 'in their note');
  assert.ok(sam.about.some((r) => r.title.startsWith('Check the sketch')), 'linking to them');
  assert.deepEqual(sam.workstreams.map((r) => r.title), ['Joinery']);
  assert.deepEqual(sam.risks.map((r) => r.title), ['Tasmanian oak slab could arrive late']);
  assert.equal(R.personOpenItems(m, 'Sam', { project: 'Projects/Other/Other.md' }).theirs.length, 0);
  assert.equal(R.personOpenItems(m, 'Nobody Here'), null);

  const items = R.meetingItems(m, 'Site walk');
  assert.equal(items.project.id, `project:${PROJECT}`);
  assert.ok(items.actions.some((r) => r.title === 'Book the electrician'));
  assert.ok(items.actions.some((r) => r.path === PROJECT), 'and the step filed from it');
  assert.deepEqual(items.decisions.map((r) => r.title), ['Counter goes on the north wall']);
  assert.deepEqual(items.people.map((r) => r.title).sort(), ['Ana Ruiz', 'Mia Tran', 'Sam Okafor']);
  assert.deepEqual(items.milestones.map((r) => r.title), ['Site walk with the builders']);

  const att = R.projectAttention(m, PROJECT);
  assert.deepEqual(att.overdue.map((r) => r.title), ['Approve the lighting plan']);
  assert.ok(att.dueSoon.some((r) => r.title === 'Send the joinery quote'));
  assert.ok(att.mine.some((r) => r.title === 'Order the Tasmanian oak slab'));
  assert.ok(att.waiting.some((r) => r.owner === 'Sam Okafor') && !att.waiting.some((r) => r.owner === 'Ana Ruiz'));
  assert.deepEqual(att.lateMilestones.map((r) => r.title), ['Council permit lodged']);
  assert.deepEqual(att.nextMilestones.map((r) => r.title), ['Joinery install starts']);
  assert.deepEqual(att.workstreamsAtRisk.map((r) => r.title), ['Joinery']);
  assert.equal(att.openRisks[0].level, 'high', 'high risks first');
});

test('the project hub reads the connected vault: actions written only in meetings and notes count, once (WS1, 24 Oct 2026)', async () => {
  const m = build();
  const elsewhere = R.connectedActions(m, PROJECT);
  const titles = elsewhere.map((a) => a.what);
  assert.ok(titles.includes('Book the electrician'), 'a meeting’s tick box');
  assert.ok(titles.some((t) => t.startsWith('Check the sketch')), 'a task line in a note of the project');
  assert.ok(!titles.includes('Send the joinery quote'), 'filed into What’s next: the project’s line, not twice');
  const book = elsewhere.find((a) => a.what === 'Book the electrician');
  assert.equal(book.who, 'Mia Tran');
  assert.equal(book.due, '2026-03-14');
  assert.equal(book.from, '2026-03-10 Site walk');
  assert.equal(typeof book.task, 'string', 'a tick box: ticked where it is written');
  assert.deepEqual(R.projectAttention(m, PROJECT).elsewhere, elsewhere, 'the screen gets the same list');

  const hub = R.projectNeeds(m, PROJECT);
  const mia = hub.waiting.find((g) => g.person === 'Mia Tran');
  assert.ok(mia && mia.items.some((a) => a.what === 'Book the electrician' && a.ref.kind === 'record' && a.from === '2026-03-10 Site walk'));
  assert.ok(hub.mine.some((a) => a.what.startsWith('Check the sketch')), 'my own task line in a note of the project is mine');
  assert.equal(hub.actions.filter((a) => /joinery quote/i.test(a.what)).length, 1);
  // A meeting's line no one took, overdue: in Needs attention, with no owner, opening the meeting's line.
  const late = { path: 'Meetings/2026-03-02 Supplier call.md', title: '2026-03-02 Supplier call', content: '---\ntype: meeting\ndate: 2026-03-02\nproject: "[[Harbour Fit-out]]"\n---\n## Actions\n\n- Chase the council about the permit by 5 Mar 2026\n', props: { type: 'meeting', date: '2026-03-02', project: '[[Harbour Fit-out]]' } };
  const m2 = build([...NOTES, late]);
  const hub2 = R.projectNeeds(m2, PROJECT);
  const att = hub2.attention.find((a) => /Chase the council/.test(a.title));
  assert.ok(att, 'overdue meeting action needs attention');
  assert.equal(att.ref.kind, 'record');
  assert.match(att.detail, /overdue · No owner/);
  assert.ok(hub2.unowned.some((a) => /Chase the council/.test(a.what) && a.task === undefined));
});

test('records found by name: people by first name, projects by initials', () => {
  const notes = [...NOTES, { path: 'Projects/Spring Garden Show 2027/Spring Garden Show 2027.md', title: 'Spring Garden Show 2027', content: '---\ntype: project\n---\n# Spring Garden Show 2027\n', props: { type: 'project' } }];
  const m = build(notes);
  assert.equal(R.findRecords(m, 'Mia')[0].id, 'person:mia tran');
  assert.equal(R.findRecords(m, 'SGS 2027', ['project'])[0].title, 'Spring Garden Show 2027');
  assert.equal(R.findRecords(m, 'harbour', ['project'])[0].id, `project:${PROJECT}`);
  assert.match(R.recordLine(m.records.get(`action:${PROJECT}#approve-the-lighting-plan`), m), /^Action: Approve the lighting plan · who: Ana Ruiz · due 2026-03-01 \(overdue\) · open · project: Harbour Fit-out/);
});

test('action words read plainly', () => {
  assert.deepEqual(R.actionParts('Retry the failed payment twice — Priya Nair — due 2026-11-06', ['Priya Nair']), { what: 'Retry the failed payment twice', who: 'Priya Nair', when: '2026-11-06' }, 'a date after a second dash is never a person (p16-owner-tail)');
  assert.deepEqual(R.actionParts('Retry the failed payment twice — Priya Nair, due 2026-11-06', ['Priya Nair']), { what: 'Retry the failed payment twice', who: 'Priya Nair', when: '2026-11-06' }, 'a date after a comma is never a person (p16-owner-tail)');
  assert.deepEqual(R.actionParts('Retry the failed payment twice — Priya Nair, due 2026-11-06', []), { what: 'Retry the failed payment twice', when: '2026-11-06' }, 'a bare name nobody knows is a mention, never an owner (5 Nov 2026, u3 moving-in)');
  assert.deepEqual(R.actionParts('Send the quote — Sam Okafor · by Fri 13 Mar'), { what: 'Send the quote', when: 'Fri 13 Mar' }, 'unknown bare tail: the day still splits, the name stays a mention');
  assert.deepEqual(R.actionParts('Send the quote — Sam Okafor · by Fri 13 Mar', [], new Date(), true), { what: 'Send the quote', who: 'Sam Okafor', when: 'Fri 13 Mar' }, 'a project step’s bare name is its owner (deliberate)');
  assert.deepEqual(R.actionParts('**Call the council.** They asked on 2 Mar — [[Permit notes]], [[Council]]'), { what: 'Call the council' });
  assert.deepEqual(R.actionParts('Label the cable trays — [[Priya Sharma]] · by 10 Nov 2026', ['Priya Sharma']), { what: 'Label the cable trays', who: 'Priya Sharma', when: '10 Nov 2026' }, 'a linked owner on its own reads as its words (t166: the project page blamed its owner)');
  assert.deepEqual(R.actionParts('Label the cable trays — [[People/Priya Sharma|Priya]] · by 10 Nov 2026', ['Priya Sharma']), { what: 'Label the cable trays', who: 'Priya Sharma', when: '10 Nov 2026' }, 'a linked owner with a path and alias reads too (t166)');
  assert.deepEqual(R.actionParts('Label the cable trays — [[Random Note]]', ['Priya Sharma']), { what: 'Label the cable trays' }, 'a link naming nothing known still splits, never an owner (t166)');
  assert.deepEqual(R.actionParts('Northgate: confirm the quote by 12 Mar'), { what: 'Northgate: confirm the quote by 12 Mar' }, 'a place is not who');
  assert.deepEqual(R.actionParts('Mia to book the electrician', ['Mia Tran']), { what: 'Book the electrician', who: 'Mia Tran' });
  assert.deepEqual(R.actionParts('Send review — jesse', ['Jesse Arlow']), { what: 'Send review', who: 'Jesse Arlow' }, 'lowercase first name of known person is who');
  assert.deepEqual(R.actionParts('Fix depot — Northgate'), { what: 'Fix depot — Northgate' }, 'an unknown single place is not who');
  assert.deepEqual(R.actionParts('Call back — Lee', ['Alex Lee']), { what: 'Call back', who: 'Alex Lee' }, 'a unique last name of a known person is who');
  assert.deepEqual(R.actionParts('Call back — Lee', ['Alex Lee', 'Sam Lee']), { what: 'Call back — Lee' }, 'two people sharing a last name: no guess');
  assert.deepEqual(R.actionParts('Send review — Lee', ['Lee Kaur', 'Alex Lee']), { what: 'Send review', who: 'Lee Kaur' }, 'a first name wins over another person’s last name');
});

test('one action written twice shows once, and someone with no page says so', () => {
  const m = build();
  const meet = 'meeting:Meetings/2026-03-10 Site walk.md';
  const actions = R.groupConnected(m, meet).find((g) => g.key === 'actions').items;
  const quotes = actions.filter((x) => /send the joinery quote/i.test(x.record.title));
  assert.equal(quotes.length, 1, 'the meeting’s line and the project step filed from it: once');
  assert.equal(quotes[0].record.path, 'Meetings/2026-03-10 Site walk.md', 'the copy written in the meeting');
  assert.ok(quotes[0].whys.includes('Also in Harbour Fit-out'));
  const fromProject = R.groupConnected(m, `project:${PROJECT}`).find((g) => g.key === 'actions').items.filter((x) => /send the joinery quote/i.test(x.record.title));
  assert.equal(fromProject.length, 1);
  assert.equal(fromProject[0].record.path, PROJECT, 'from the project: its own step');
  assert.equal(m.records.get('person:sam okafor').page, true);
  assert.ok(!m.records.get('person:ana ruiz').page, 'named in a project only: no page of her own');
});

test('no one, and two people named together', () => {
  const notes = NOTES.map((n) => (n.path === PROJECT ? { ...n, content: n.content.replace('- [ ] Order the Tasmanian oak slab — Ana Ruiz', '- [ ] Order the Tasmanian oak slab — Unassigned\n- [ ] Brief the painters — Mia Tran with Sam Okafor (Coastline) · Fri 13 Mar 2026, 9:00 AM\n- [ ] Finalise the joinery order — Sam Okafor · by Week of 16 Mar 2026') } : n));
  const m = build(notes);
  const slab = m.records.get(`action:${PROJECT}#order-the-tasmanian-oak-slab`);
  assert.equal(slab.owner, undefined, '"Unassigned" is no one');
  const paint = m.records.get(`action:${PROJECT}#brief-the-painters`);
  assert.equal(paint.due, '2026-03-13', 'a day with its time');
  assert.equal(m.records.get(`action:${PROJECT}#finalise-the-joinery-order`).due, '2026-03-16', '"by Week of 16 Mar"');
  const joinery = R.connectedTo(m, `action:${PROJECT}#finalise-the-joinery-order`).find((x) => x.record.id === `workstream:${PROJECT}#joinery`);
  assert.ok(!joinery || !joinery.whys.some((w) => /Finalise/.test(w)), 'a sentence’s first word is not what it is about');
  assert.ok(linked(m, paint.id, 'person:mia tran', 'owner') && linked(m, paint.id, 'person:sam okafor', 'owner'), 'both are its owners');
  assert.ok(R.projectAttention(m, PROJECT).unassigned.some((r) => r.id === slab.id) === false, 'a step of the project file with no one is the owner’s own');
});

test('the assistant’s answers: everything about a thing, what is open with someone, a meeting’s items', () => {
  const m = build();
  const about = R.answerRecordTool(m, 'connected_to', { what: 'Sam' });
  assert.match(about, /^Person: Sam Okafor/);
  assert.match(about, /Actions \(\d+\):\n[\s\S]*- Action: Send the joinery quote/);
  assert.match(about, /\[person:sam okafor\]/);
  const mine = R.answerRecordTool(m, 'person_open_items', { project: 'harbour' });
  assert.match(mine, /^Person: Ana Ruiz/, 'no one named: the person themselves (the owner of most projects)');
  // The person themselves on a project: the project hub's own Needs attention, actions and waiting (one source).
  assert.match(mine, /Needs attention \(1\):\n- Approve the lighting plan — 10 days overdue · You \(2026-03-01\) \[action:/);
  assert.match(mine, /Waiting on others \(\d+\):[\s\S]*Sam Okafor/);
  assert.match(mine, /Mia Tran:\n- Action: Book the electrician · who: Mia Tran · due 2026-03-14 · from: 2026-03-10 Site walk/, 'an action written only in the meeting');
  const sam = R.answerRecordTool(m, 'person_open_items', { person: 'Sam' });
  assert.match(sam, /Theirs to do, open \(\d+\):\n- Action: Send the joinery quote/);
  assert.doesNotMatch(sam, /Overdue on the project/, 'someone else: their items only');
  const meeting = R.answerRecordTool(m, 'meeting_items', { meeting: 'site walk' });
  assert.match(meeting, /Actions \(\d+ open of \d+\):/);
  assert.match(meeting, /Decisions \(1\):\n- Decision: Counter goes on the north wall/);
  assert.match(R.answerRecordTool(m, 'connected_to', { what: 'Nobody at all' }), /^Nothing in the vault is called/);
  assert.equal(R.answerRecordTool(m, 'something_else', {}), null);
  assert.deepEqual(R.RECORD_TOOLS.map((t) => t.name), ['connected_to', 'person_open_items', 'meeting_items']);
});

// 26 Oct 2026: a note of its own type (a module's Bill) opens as itself, with its fields (the bill opened as an empty
// "Note").
test('a typed note shows its own fields and kind', () => {
  const facts = R.propFacts({ type: 'bill', amount: 65, cycle: 'Monthly', autopay: true, due: '2026-11-14', account: '', tags: ['money'] });
  // Tags are facts too (9.2 round 2); the rest is unchanged.
  assert.deepEqual(facts.map((f) => [f.label, f.value]), [['Amount', '$65.00'], ['How often', 'Monthly'], ['Autopay', 'Yes'], ['Due', '2026-11-14'], ['Tags', 'money']]);
});

// 10.0 second round N13: an action says where it is written — Written here on a note, From this meeting on a
// meeting — never the empty "An action in it".
test('an action names where it is written', () => {
  const m = build();
  const briefActions = near(m, 'note:Projects/Harbour Fit-out/Counter brief.md').filter((x) => x.id.startsWith('action:'));
  assert.ok(briefActions.length > 0, 'the note holds an action');
  assert.ok(briefActions.some((x) => x.whys.includes('Written here')), 'an action written in the note says Written here');
  const meetActions = near(m, 'meeting:Meetings/2026-03-10 Site walk.md').filter((x) => x.id.startsWith('action:'));
  assert.ok(meetActions.length > 0, 'the meeting holds an action');
  assert.ok(meetActions.some((x) => x.whys.includes('From this meeting')), 'an action written in the meeting says From this meeting');
  const whys = [...briefActions, ...meetActions].flatMap((x) => x.whys).join(' | ');
  assert.ok(!whys.includes('An action in it') && !whys.includes('An action from it'), 'the empty labels are gone');
});

// v8-vault-assistant F8: one deed held by a project and a meeting lists once — reworded lines file by their subject,
// and the project's line carries the meeting behind it. A joint chase stays apart from a split follow-up.
test('a reworded deed files and lists once; a joint chase never files into a split follow-up', () => {
  const CART = 'Projects/Cart Fix/Cart Fix.md';
  const cart = `---\ntype: project\nstatus: active\nowner: Ana Ruiz\n---\n# Cart Fix\n\nThe cart fix.\n\n## What's next\n\n- [ ] Send the receipt v2 for review \u2014 Sam Okafor\n- [ ] Chase PAY-101 and PAY-102 \u2014 Sam Okafor\n`;
  const standup = `---\ntype: meeting\ndate: 2026-11-03\nproject: "[[Cart Fix]]"\nattendees: [Sam Okafor]\n---\n# 2026-11-03 Cart standup\n\n## Actions\n\n- [ ] Receipt v2 review \u2014 Sam Okafor\n- [ ] PAY-101 follow-up \u2014 Sam Okafor\n`;
  const notes = [
    { path: CART, title: 'Cart Fix', content: cart, props: { type: 'project', status: 'active', owner: 'Ana Ruiz' } },
    { path: 'Meetings/2026-11-03 Cart standup.md', title: '2026-11-03 Cart standup', content: standup, props: { type: 'meeting', date: '2026-11-03', project: '[[Cart Fix]]', attendees: ['Sam Okafor'] } },
  ];
  const m = build(notes, []);
  const meet = 'meeting:Meetings/2026-11-03 Cart standup.md';
  const review = [...m.records.values()].find((r) => r.type === 'action' && r.path === CART && /receipt v2/i.test(r.title));
  const reviewLine = [...m.records.values()].find((r) => r.type === 'action' && r.path !== CART && /receipt v2/i.test(r.title));
  assert.ok(review && reviewLine, 'both lines are read');
  assert.ok(linked(m, review.id, reviewLine.id, 'source'), 'the reworded deed files by its subject');
  const sam = R.personOpenItems(m, 'Sam');
  const theirs = sam.theirs.map((r) => r.title);
  assert.equal(theirs.filter((t) => /receipt v2/i.test(t)).length, 1, 'one deed lists once');
  assert.ok(theirs.some((t) => /Send the receipt v2 for review/.test(t)), 'the project’s line carries it');
  assert.match(R.recordLine(review, m), /from: 2026-11-03 Cart standup/, 'with the meeting behind it');
  // The joint chase and the split follow-up are different deeds: both list.
  assert.ok(theirs.some((t) => /Chase PAY-101 and PAY-102/.test(t)), 'the joint chase lists');
  assert.ok(theirs.some((t) => /PAY-101 follow-up/.test(t)), 'the split follow-up lists beside it');
  const chase = [...m.records.values()].find((r) => r.type === 'action' && /Chase PAY/.test(r.title));
  const split = [...m.records.values()].find((r) => r.type === 'action' && r.path !== CART && /PAY-101/.test(r.title));
  assert.ok(!linked(m, chase.id, split.id, 'source'), 'no filing between them');
  const att = R.projectAttention(m, CART);
  assert.equal([...att.waiting, ...att.mine].filter((r) => /receipt v2/i.test(r.title)).length, 1, 'the overview lists it once too');
});

// 10 Nov 2026 and a lone "Maren" read as Person. A code, email routing or a first name alone is never someone:
// not from a meeting's attendees, and not from a note merely kept in People. An explicit type still wins.
test('a code, email routing or first name alone is never a person', () => {
  const notes = [
    { path: 'Meetings/2026-03-12 Circuit review.md', title: '2026-03-12 Circuit review', content: '---\ntype: meeting\ndate: 2026-03-12\nattendees: [Q47 on copy, Maren, Sam Okafor]\n---\n# Circuit review\n', props: { type: 'meeting', date: '2026-03-12', attendees: ['Q47 on copy', 'Maren', 'Sam Okafor'] } },
    { path: 'People/Q47 on copy.md', title: 'Q47 on copy', content: '# Q47 on copy\n', props: {} },
    { path: 'People/Maren.md', title: 'Maren', content: '# Maren\n', props: {} },
    { path: 'People/Maren Porter.md', title: 'Maren Porter', content: '---\ntype: person\n---\n# Maren Porter\n', props: { type: 'person' } },
    { path: 'People/Jo.md', title: 'Jo', content: '---\ntype: person\n---\n# Jo\n', props: { type: 'person' } },
  ];
  const m = build(notes, []);
  const people = [...m.records.values()].filter((r) => r.type === 'person').map((r) => r.title);
  assert.ok(!people.includes('Q47 on copy'), 'the circuit code is nobody: ' + people.join(', '));
  assert.ok(!people.includes('Maren'), 'a first name alone in People is nobody: ' + people.join(', '));
  assert.ok(people.includes('Sam Okafor'), 'a plain attendee still is');
  assert.ok(people.includes('Maren Porter'), 'a full name typed person still is');
  assert.ok(people.includes('Jo'), 'an explicit type wins for a single name');
  assert.equal(m.records.get('note:People/Q47 on copy.md')?.type, 'note', 'the code note stays a note');
  assert.equal(m.records.get('note:People/Maren.md')?.type, 'note', 'the first-name note stays a note');
});

// 10 Nov 2026: the Client file edits a business where it stands, through the same property mapping as a person.
test('a business writes its contact facts like a person', () => {
  const w = R.noteFactWrite({ type: 'org', page: true }, 'email', { email: 'old@example.com' }, 'new@example.com');
  assert.deepEqual(w, { key: 'email', value: 'new@example.com' });
  const p = R.noteFactWrite({ type: 'org', page: true }, 'phone', {}, '0400 111 222');
  assert.deepEqual(p, { key: 'phone', value: '0400 111 222' });
  assert.equal(R.noteFactWrite({ type: 'org', page: true }, 'role', {}, 'Manager'), null, 'a business has no role to write');
  assert.equal(R.canEditNoteFact({ type: 'org', page: true }, 'email'), true);
  assert.equal(R.canEditNoteFact({ type: 'org', page: false }, 'email'), false, 'named only, with no page: nowhere to write');
});
