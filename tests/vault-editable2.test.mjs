// node --test tests/vault-editable2.test.mjs — everything shown is editable where it
// is shown, round 2 (p10-vault-editable, 4 Nov 2026: "everything is editable" —
// finish the list). The same mechanisms, further: a run sheet's tick boxes carry
// their words so the peek ticks them the way the project page and Tasks do; a
// peek title renames its workstream, milestone, action, risk or decision; a
// person or organisation named in a project changes their role there; a file the
// project keeps changes its one line; a task line's words and owner change
// keeping its day, marks and tags; a meeting's, person's or note's facts change
// in the note's own properties. Each check is the round trip the person sees:
// edit in place -> the note's text changes -> every other view shows it at once,
// with the person's other words kept. Made-up vault only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-editable2-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { recordFactEdit, canEditFact, recordFactText } from ${JSON.stringify(path.join(root, 'src/shared/record-edits.ts'))};`,
      `export { parseProject, serializeProject, applyProjectEdit } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`,
      `export { buildRecordModel, peekOf, canEditNoteFact, noteFactWrite } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};`,
      `export { setTaskBox, taskEditableRest, setTaskRest, setTaskWho, splitTaskRest, parseTaskLine } from ${JSON.stringify(path.join(root, 'src/shared/tasks.ts'))};`,
      `export { splitDueMarks } from ${JSON.stringify(path.join(root, 'src/shared/hub.ts'))};`,
      `export { setNoteProp } from ${JSON.stringify(path.join(root, 'src/shared/views.ts'))};`,
      '',
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'shared.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'shared.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const P = 'Projects/Harbourview Fete/Harbourview Fete.md';
const NOTE = `---
type: project
status: active
owner: Alex Chen
---

# Harbourview Fete

## What's next

- [ ] Confirm the cake stall map — Alex Chen · by 20 Nov 2026

## Workstreams

| Workstream | Owner     | Status      |
| ---------- | --------- | ----------- |
| Stalls     | Alex Chen | In progress |

## Run sheet

### Setup

- [ ] Paint the fence — Sam Lee · by 21 Nov 2026
- [x] Mow the oval — Sam Lee

## Key dates

| Date       | Milestone           | Status |
| ---------- | ------------------- | ------ |
| 2026-11-20 | Stall map locked in | next   |

## People

- Alex Chen — stalls
- Sam Lee — music and MC

## Risks and issues

| Risk               | Impact | Owner     | Status |
| ------------------ | ------ | --------- | ------ |
| Wet weather backup | high   | Alex Chen | Open   |

## Decisions

- **12 Oct 2026** — Entry stays free. *Why:* so every family can come.

## Documents

- \`posters/fete-poster.png\` — the poster for the noticeboard
`;

const MEETING = 'Meetings/2026-11-03 Fete committee.md';
const MEETING_NOTE = `---
type: meeting
date: 2026-11-03
time: 6:30 pm
attendees: Alex Chen, Sam Lee
project: "[[Harbourview Fete]]"
---

# Fete committee

## Agenda

- [ ] Send the agenda — Alex Chen · by 6 Nov 2026
`;

const PERSON = 'People/Alex Chen.md';
const PERSON_NOTE = `---
type: person
role: Stall coordinator
org: Harbourview Primary
email: alex@example.com
phone: 0400 000 000
---

# Alex Chen
`;

const PLAIN = 'Notes/Fete budget.md';
const PLAIN_NOTE = `---
status: draft
priority: high
---

# Fete budget

- [ ] Cost the PA hire 📅 2026-11-10
- [ ] Ask Priya about cakes — Priya Nair #fete 🔼
`;

/** The records model over the made-up notes, as the peek reads it. */
const modelOf = (files) =>
  S.buildRecordModel({
    notes: files,
    resolve: () => null,
    today: '2026-11-04',
    me: 'Alex Chen',
  });
const stdModel = (content = NOTE, meeting = MEETING_NOTE, person = PERSON_NOTE, plain = PLAIN_NOTE) =>
  modelOf([
    { path: P, title: 'Harbourview Fete', content, props: { type: 'project' } },
    { path: MEETING, title: 'Fete committee', content: meeting, props: { type: 'meeting', date: '2026-11-03', time: '6:30 pm', attendees: 'Alex Chen, Sam Lee', project: '[[Harbourview Fete]]' } },
    { path: PERSON, title: 'Alex Chen', content: person, props: { type: 'person', role: 'Stall coordinator', org: 'Harbourview Primary', email: 'alex@example.com', phone: '0400 000 000' } },
    { path: PLAIN, title: 'Fete budget', content: plain, props: { status: 'draft', priority: 'high' } },
  ]);
const factOf = (record, key) => record.facts.find((f) => f.key === key)?.value;
/** Apply one record-fact edit the way the peek does, and return the note as written. */
const written = (content, record, fact, value, projectPath) => {
  const p = S.parseProject(content, P);
  const edit = S.recordFactEdit(p, record, fact, value, projectPath);
  assert.ok(edit, `no edit for ${record.type}/${fact}`);
  S.applyProjectEdit(p, edit, '4 Nov 2026');
  return S.serializeProject(p, content);
};
/** Apply one properties-fact write the way the peek does, and return the note as written. */
const propWritten = (content, record, fact, value, props) => {
  const w = S.noteFactWrite(record, fact, props, value);
  assert.ok(w, `no write for ${record.type}/${fact}`);
  return S.setNoteProp(content, w.key, w.value);
};

test('a run sheet action carries its words, and ticking keeps its owner and date', () => {
  const rec = S.peekOf(stdModel(), { id: `action:${P}#paint-the-fence` })?.record;
  assert.ok(rec, 'the peek reads the run sheet action');
  assert.equal(rec.item, undefined);
  assert.equal(rec.task, 'Paint the fence — Sam Lee · by 21 Nov 2026');
  assert.equal(rec.owner, 'Sam Lee');
  const line = NOTE.split('\n').find((l) => l.includes('Paint the fence'));
  assert.equal(S.setTaskBox(line, true), '- [x] Paint the fence — Sam Lee · by 21 Nov 2026');
  // And a done one unticks the same way.
  const done = NOTE.split('\n').find((l) => l.includes('Mow the oval'));
  assert.equal(S.setTaskBox(done, false), '- [ ] Mow the oval — Sam Lee');
});

test('peek titles rename their workstream, milestone, action, risk and decision', () => {
  const m = stdModel();
  const ws = S.peekOf(m, { id: `workstream:${P}#stalls` })?.record;
  assert.ok(ws, 'the peek reads the Stalls workstream');
  let text = written(NOTE, ws, 'title', 'Stalls and rides');
  assert.match(text, /\| Stalls and rides\s+\| Alex Chen \|/);
  const ms = S.peekOf(m, { id: `milestone:${P}#stall-map-locked-in` })?.record;
  assert.ok(ms);
  text = written(text, S.peekOf(modelOf([{ path: P, title: 'Harbourview Fete', content: text, props: { type: 'project' } }]), { id: `milestone:${P}#stall-map-locked-in` })?.record, 'title', 'Stall map agreed');
  assert.equal(S.parseProject(text, P).dates[0].what, 'Stall map agreed');
  assert.ok(S.peekOf(modelOf([{ path: P, title: 'Harbourview Fete', content: text, props: { type: 'project' } }]), { id: `milestone:${P}#stall-map-agreed` })?.record);
  const ac = S.peekOf(m, { id: `action:${P}#confirm-the-cake-stall-map` })?.record;
  assert.ok(ac);
  text = written(text, S.peekOf(modelOf([{ path: P, title: 'Harbourview Fete', content: text, props: { type: 'project' } }]), { id: `action:${P}#confirm-the-cake-stall-map` })?.record, 'title', 'Confirm the stall map');
  assert.equal(S.parseProject(text, P).next[0].what, 'Confirm the stall map');
  const rk = S.peekOf(m, { id: `risk:${P}#wet-weather-backup` })?.record;
  assert.ok(rk);
  text = written(text, S.peekOf(modelOf([{ path: P, title: 'Harbourview Fete', content: text, props: { type: 'project' } }]), { id: `risk:${P}#wet-weather-backup` })?.record, 'title', 'Wet weekend backup');
  assert.equal(S.parseProject(text, P).risks[0].what, 'Wet weekend backup');
  const dc = S.peekOf(m, { id: `decision:${P}#entry-stays-free` })?.record;
  assert.ok(dc);
  text = written(text, S.peekOf(modelOf([{ path: P, title: 'Harbourview Fete', content: text, props: { type: 'project' } }]), { id: `decision:${P}#entry-stays-free` })?.record, 'title', 'Entry stays free for all');
  assert.equal(S.parseProject(text, P).decisions[0].what, 'Entry stays free for all.');
  // An empty rename is refused, never an empty title.
  assert.equal(S.recordFactEdit(S.parseProject(text, P), ms, 'title', '  '), null);
});

test('a person named in a project changes their role there', () => {
  const m = stdModel();
  // Alex has their own page, so the one record is their page's (its role is their note's).
  const page = [...m.records.values()].find((r) => r.type === 'person' && r.page);
  assert.ok(page);
  assert.equal(factOf(page, 'role'), 'Stall coordinator');
  const sam = [...m.records.values()].find((r) => r.type === 'person' && r.title === 'Sam Lee' && !r.page);
  assert.ok(sam, 'the peek reads Sam where the project names him');
  assert.equal(factOf(sam, 'role'), 'music and MC');
  const p = S.parseProject(NOTE, P);
  assert.equal(S.canEditFact(p, sam, 'role', P), true);
  assert.equal(S.recordFactText(p, sam, 'role', P), 'music and MC');
  const text = written(NOTE, sam, 'role', 'music, MC and raffle', P);
  assert.match(text, /- \*\*Sam Lee\*\* — music, MC and raffle/);
  assert.equal(S.parseProject(text, P).people[1].role, 'music, MC and raffle');
  const again = modelOf([{ path: P, title: 'Harbourview Fete', content: text, props: { type: 'project' } }]);
  const sam2 = [...again.records.values()].find((r) => r.type === 'person' && r.title === 'Sam Lee');
  assert.equal(factOf(sam2, 'role'), 'music, MC and raffle');
  // Someone with their own page changes in their note, not the project's list.
  assert.equal(S.canEditFact(p, { ...sam, page: true }, 'role', P), false);
  // Someone named somewhere else (a meeting) is not written into this project.
  assert.equal(S.recordFactEdit(p, { ...sam, path: MEETING }, 'role', 'x', P), null);
});

test('a file the project keeps changes its one line', () => {
  const m = stdModel();
  const file = S.peekOf(m, { id: `file:${P}::posters/fete-poster.png` })?.record;
  assert.ok(file, 'the peek reads the project file');
  assert.equal(factOf(file, 'what'), 'the poster for the noticeboard');
  const p = S.parseProject(NOTE, P);
  assert.equal(S.canEditFact(p, file, 'what'), true);
  assert.equal(S.recordFactText(p, file, 'what'), 'the poster for the noticeboard');
  const text = written(NOTE, file, 'what', 'the poster, printed A3');
  assert.match(text, /the poster, printed A3/);
  assert.equal(S.parseProject(text, P).documents[0].what, 'the poster, printed A3');
  // Clearing takes the line off; the file stays pinned.
  const cleared = written(text, S.peekOf(modelOf([{ path: P, title: 'Harbourview Fete', content: text, props: { type: 'project' } }]), { id: `file:${P}::posters/fete-poster.png` })?.record, 'what', '');
  assert.equal(S.parseProject(cleared, P).documents.length, 1);
  assert.equal(S.parseProject(cleared, P).documents[0].what, undefined);
});

test('a task line changes its words and owner, keeping its day, marks and tags', () => {
  const line = '- [ ] Cost the PA hire 📅 2026-11-10';
  assert.equal(S.taskEditableRest(line), 'Cost the PA hire');
  assert.deepEqual(S.splitTaskRest('Cost the PA hire'), { title: 'Cost the PA hire', tail: '' });
  assert.equal(S.setTaskRest(line, 'Price the PA hire'), '- [ ] Price the PA hire 📅 2026-11-10');
  const owned = '- [ ] Ask Priya about cakes — Priya Nair #fete 🔼';
  assert.equal(S.taskEditableRest(owned), 'Ask Priya about cakes — Priya Nair #fete 🔼');
  assert.deepEqual(S.splitTaskRest(S.taskEditableRest(owned)), { title: 'Ask Priya about cakes', tail: ' — Priya Nair #fete 🔼' });
  assert.equal(S.setTaskRest(owned, 'Ask Priya about slices — Priya Nair #fete 🔼'), '- [ ] Ask Priya about slices — Priya Nair #fete 🔼');
  // tail stays).
  assert.equal(S.setTaskWho('- [ ] Collect the keys', 'Sam Lee'), '- [ ] Collect the keys — Sam Lee');
  assert.equal(S.setTaskWho('- [ ] Collect the keys 📅 2026-11-10', 'Sam Lee'), '- [ ] Collect the keys — Sam Lee 📅 2026-11-10');
  assert.equal(S.setTaskWho(owned, 'Alex Chen'), '- [ ] Ask Priya about cakes — Alex Chen #fete 🔼');
  assert.equal(S.setTaskWho('- [ ] Paint the fence — Sam Lee · by 21 Nov 2026', ''), '- [ ] Paint the fence — by 21 Nov 2026');
  assert.equal(S.setTaskWho(owned, ''), '- [ ] Ask Priya about cakes #fete 🔼');
  // A block id stays last; an empty rest is refused.
  assert.equal(S.setTaskRest('- [ ] Tidy ^abc123', 'Tidy well'), '- [ ] Tidy well ^abc123');
  assert.equal(S.setTaskRest(line, '   '), line);
  assert.equal(S.taskEditableRest('not a task'), null);
  // The day still reads after the words change.
  const changed = S.setTaskRest(line, 'Price the PA hire');
  assert.equal(S.parseTaskLine(changed)?.due, '2026-11-10');
  assert.equal(S.parseTaskLine(changed)?.words, 'Price the PA hire');
  const reowned = S.setTaskWho(line, 'Sam Lee');
  assert.equal(S.parseTaskLine(reowned)?.due, '2026-11-10');
});

test('due marks split from a line in the order written, keeping a day link as words', () => {
  const { rest, marks } = S.splitDueMarks('Fix the tap due:: 2026-11-12 📅 2026-11-10');
  assert.deepEqual(marks, [' due:: 2026-11-12', ' 📅 2026-11-10']);
  assert.equal(rest, 'Fix the tap');
  const kept = S.splitDueMarks('See [[2026-11-10]] about the hall 📅 2026-11-10');
  assert.deepEqual(kept.marks, [' 📅 2026-11-10']);
  assert.equal(kept.rest, 'See [[2026-11-10]] about the hall');
  assert.deepEqual(S.splitDueMarks('Just words'), { rest: 'Just words', marks: [] });
});

test('a meeting changes its day, time, attendees and project in its own note', () => {
  const m = stdModel();
  const rec = S.peekOf(m, { id: `meeting:${MEETING}` })?.record;
  assert.ok(rec, 'the peek reads the meeting');
  assert.equal(factOf(rec, 'date'), '2026-11-03');
  assert.equal(factOf(rec, 'time'), '6:30 pm');
  const props = { type: 'meeting', date: '2026-11-03', time: '6:30 pm', attendees: 'Alex Chen, Sam Lee', project: '[[Harbourview Fete]]' };
  for (const fact of ['date', 'time', 'attendees', 'project']) assert.equal(S.canEditNoteFact(rec, fact), true, fact);
  assert.equal(S.canEditNoteFact(rec, 'kind'), false);
  let text = propWritten(MEETING_NOTE, rec, 'date', '2026-11-10', props);
  assert.match(text, /date: 2026-11-10/);
  assert.match(text, /time: 6:30 pm/);
  text = propWritten(text, rec, 'time', '7 pm', { ...props, date: '2026-11-10' });
  assert.match(text, /time: 7 pm/);
  text = propWritten(text, rec, 'attendees', 'Alex Chen, Sam Lee, Priya Nair', props);
  assert.match(text, /attendees: Alex Chen, Sam Lee, Priya Nair/);
  const m2 = modelOf([
    { path: P, title: 'Harbourview Fete', content: NOTE, props: { type: 'project' } },
    { path: MEETING, title: 'Fete committee', content: text, props: { type: 'meeting', date: '2026-11-10', time: '7 pm', attendees: 'Alex Chen, Sam Lee, Priya Nair', project: '[[Harbourview Fete]]' } },
  ]);
  const rec2 = S.peekOf(m2, { id: `meeting:${MEETING}` })?.record;
  assert.equal(factOf(rec2, 'date'), '2026-11-10');
  assert.equal(factOf(rec2, 'time'), '7 pm');
  // Whoever the note already names writes back the way it wrote them (a list stays a list).
  const listed = S.noteFactWrite(rec, 'attendees', { attendees: ['Alex Chen'] }, 'Alex Chen, Priya Nair');
  assert.deepEqual(listed, { key: 'attendees', value: ['Alex Chen', 'Priya Nair'] });
  // Clearing takes the property off.
  assert.deepEqual(S.noteFactWrite(rec, 'time', props, '  '), { key: 'time', value: null });
});

test('a person changes role, organisation and contact facts in their own note', () => {
  const m = stdModel();
  const rec = [...m.records.values()].find((r) => r.type === 'person' && r.page);
  assert.ok(rec);
  const props = { type: 'person', role: 'Stall coordinator', org: 'Harbourview Primary', email: 'alex@example.com', phone: '0400 000 000' };
  for (const fact of ['role', 'org', 'email', 'phone']) assert.equal(S.canEditNoteFact(rec, fact), true, fact);
  let text = propWritten(PERSON_NOTE, rec, 'role', 'Music coordinator', props);
  assert.match(text, /role: Music coordinator/);
  text = propWritten(text, rec, 'org', 'Harbourview School', props);
  assert.match(text, /org: Harbourview School/);
  // The note's own spelling wins (company stays company, mobile stays mobile).
  const w = S.noteFactWrite(rec, 'org', { company: 'Acme' }, 'Acme Ltd');
  assert.equal(w?.key, 'company');
  const ph = S.noteFactWrite(rec, 'phone', { mobile: '0400' }, '0401');
  assert.equal(ph?.key, 'mobile');
  // Someone only named in a project has no note facts to write.
  const sam = [...m.records.values()].find((r) => r.type === 'person' && r.title === 'Sam Lee' && !r.page);
  assert.equal(S.canEditNoteFact(sam, 'role'), false);
});

test('a note changes its own facts, keeping numbers, yes/no and links as they were', () => {
  const m = stdModel();
  const rec = S.peekOf(m, { id: `note:${PLAIN}` })?.record;
  assert.ok(rec);
  assert.equal(factOf(rec, 'status'), 'draft');
  assert.equal(S.canEditNoteFact(rec, 'status'), true);
  assert.equal(S.canEditNoteFact(rec, 'nested.deep'), false);
  const text = propWritten(PLAIN_NOTE, rec, 'status', 'with Sam', { status: 'draft', priority: 'high' });
  assert.match(text, /status: with Sam/);
  assert.match(text, /priority: high/);
  // A yes/no stays a yes/no, a number stays a number, a link stays a link.
  assert.deepEqual(S.noteFactWrite(rec, 'autopay', { autopay: true }, 'No'), { key: 'autopay', value: false });
  assert.deepEqual(S.noteFactWrite(rec, 'amount', { amount: 65 }, '$70.00'), { key: 'amount', value: 70 });
  assert.deepEqual(S.noteFactWrite(rec, 'venue', { venue: '[[Hall]]' }, 'Oval'), { key: 'venue', value: '[[Oval]]' });
  assert.deepEqual(S.noteFactWrite(rec, 'tags', { tags: ['a'] }, 'a, b'), { key: 'tags', value: ['a', 'b'] });
});
