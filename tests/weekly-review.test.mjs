// node --test tests/weekly-review.test.mjs — the weekly review's draft (src/shared/weekly-review.ts) from made-up
// projects and days: what changed (ticked steps, new steps, health, dated updates and decisions, risks, Activity and
// other notes, folder files), what slipped (overdue steps, moved days, due dates passed, key dates missed), what to chase
// (waiting on others), the changes proposed, how each becomes an edit to the project file, the review's note, and when
// the Friday notice is due.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-weekly-review-'));
let R, P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  for (const [name, file] of [['r', 'weekly-review'], ['p', 'project-file']]) await build({ input: path.join(root, `src/shared/${file}.ts`), platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// Friday 16 October 2026, 4 pm; the week is Sat 10 Oct to Fri 16 Oct.
const NOW = new Date(2026, 9, 16, 16, 0);
const at = (day, hour = 10) => new Date(2026, 9, day, hour).getTime();

const STUDIO_BEFORE = `---
type: project
status: active
health: on track
progress: 80
owner: Sam Taylor
due: 2026-10-30
---
# Studio Upgrade

## What’s next

- [ ] Send the reconciliation to finance — Sam · by 9 Oct
- [ ] Chase the spare microphone stands — Studio hands · by 14 Oct
- [ ] Export the device inventory — Sam
- [ ] Book the speaker fitting — Priya · by 20 Oct

## Risks and issues

- **Medium** — 5 speaker cables frayed
`;
const STUDIO_NOW = `---
type: project
status: active
health: on track
progress: 90
owner: Sam Taylor
due: 2026-10-30
---
# Studio Upgrade

## What’s next

- [ ] Send the reconciliation to finance — Sam · by 9 Oct
- [ ] Chase the spare microphone stands — Studio hands · by 21 Oct
- [x] Export the device inventory — Sam
- [ ] Book the speaker fitting — Priya · by 20 Oct
- [ ] Ask the vendor for spare microphone stands — Leilani

## Key dates

| When | What | Status |
| --- | --- | --- |
| 12 Oct 2026 | Booth finished | missed |
| 2 Oct 2026 | Old session | missed |

## Risks and issues

- **Medium** — 5 speaker cables frayed *Closed:* 14 Oct 2026
- **High** — 11 old microphone stands can’t be found

## Decisions

- **14 Oct 2026** — Retired devices are dropped from every list. *Why:* stop chasing them.
- **2 Oct 2026** — An older decision.

## Updates

- **15 Oct 2026** — 8 of 12 soundproofing panels up. *From:* Status.xlsx
- **1 Oct 2026** — An older update.
`;
const HARBOUR = `---
type: project
status: planning
health: at risk
owner: Priya Shah
due: 2026-10-05
---
# Harbour Fit-out

## What’s next

- [ ] Approve the lighting quote — Priya · by 2 Oct
- [ ] Sign the lease — Landlord · by 3 Oct
- [ ] Order the signs — Mere · by 6 Oct
`;
const QUIET = `---\ntype: project\nstatus: active\nhealth: on track\nowner: Alex Lee\n---\n# Winter Menu Launch\n\n## What’s next\n\n- [ ] Photograph the soups — Alex\n`;
const DONE = `---\ntype: project\nstatus: done\nhealth: on track\nprogress: 100\n---\n# Supplier Review\n`;

const sources = () => [
  {
    path: 'Projects/Studio Upgrade/Studio Upgrade.md',
    text: STUDIO_NOW,
    before: STUDIO_BEFORE,
    beforeTime: at(9),
    activity: [{ path: 'Projects/Studio Upgrade/Activity/Reconcile the gear list.md', title: 'Reconcile the gear list', modified: at(14), status: 'done' }, { path: 'Projects/Studio Upgrade/Activity/Old.md', title: 'Old', modified: at(2) }],
    notes: [{ path: 'Projects/Studio Upgrade/Desk meeting.md', title: 'Desk meeting', modified: at(13) }],
    files: [
      { rel: 'Current/Status.xlsx', name: 'Status.xlsx', modified: at(16, 9) },
      { rel: 'Current/Reconciliation v4.docx', name: 'Reconciliation v4.docx', modified: at(15) },
      { rel: 'Inputs/Devices.csv', name: 'Devices.csv', modified: at(14) },
      { rel: 'Photos/Bondi.png', name: 'Bondi.png', modified: at(11) },
      { rel: 'Old/Plan.pptx', name: 'Plan.pptx', modified: at(1) },
    ],
  },
  { path: 'Projects/Harbour Fit-out/Harbour Fit-out.md', text: HARBOUR, before: null, files: null },
  { path: 'Projects/Winter Menu Launch/Winter Menu Launch.md', text: QUIET, before: QUIET, beforeTime: at(8), files: [] },
  { path: 'Projects/Supplier Review/Supplier Review.md', text: DONE, before: DONE, beforeTime: at(8) },
];

test('the week, and the projects in the order that needs the person first', () => {
  const d = R.draftReview(sources(), { now: NOW });
  assert.equal(d.from, '2026-10-10');
  assert.equal(d.to, '2026-10-16');
  assert.equal(d.title, 'Week to 16 Oct');
  assert.deepEqual(d.projects.map((r) => [r.name, r.since, r.quiet]), [
    ['Harbour Fit-out', 'none', false],
    ['Studio Upgrade', 'week', false],
    ['Winter Menu Launch', 'week', true],
  ], 'slipped first, quiet last; a finished project that didn’t move is left out');
});

test('what changed: from the file as the week began, dated lines, notes and the folder', () => {
  const studio = R.draftReview(sources(), { now: NOW }).projects.find((r) => r.name === 'Studio Upgrade');
  assert.deepEqual(studio.changed.map((i) => i.words), [
    'Done: Export the device inventory',
    'New next step: Ask the vendor for spare microphone stands',
    'Progress: 80% → 90%',
    '8 of 12 soundproofing panels up.',
    'Decided: Retired devices are dropped from every list.',
    'Risk closed: 5 speaker cables frayed',
    'New risk: 11 old microphone stands can’t be found',
    'Task: Reconcile the gear list',
    'Note: Desk meeting',
    '4 files changed in the folder',
  ]);
  const files = studio.changed.at(-1);
  assert.equal(files.detail, 'Status.xlsx, Reconciliation v4.docx, Devices.csv and 1 more');
  assert.deepEqual(files.open, { file: 'Current/Status.xlsx' }, 'the newest file opens');
  assert.deepEqual(studio.changed.find((i) => i.words.startsWith('Task: ')).open, { note: 'Projects/Studio Upgrade/Activity/Reconcile the gear list.md' });
});

test('what slipped: overdue steps, moved days, missed key dates', () => {
  const studio = R.draftReview(sources(), { now: NOW }).projects.find((r) => r.name === 'Studio Upgrade');
  assert.deepEqual(studio.slipped.map((i) => [i.words, i.detail]), [
    ['Send the reconciliation to finance', 'Sam · was due 9 Oct (7 days ago)'],
    ['Chase the spare microphone stands', 'moved from 14 Oct to 21 Oct'],
    ['Key date passed: Booth finished', '12 Oct · missed'],
  ]);
  const harbour = R.draftReview(sources(), { now: NOW }).projects.find((r) => r.name === 'Harbour Fit-out');
  assert.deepEqual(harbour.slipped.map((i) => i.words), ['Approve the lighting quote', 'Sign the lease', 'Order the signs', 'The project was due 5 Oct']);
  assert.deepEqual(harbour.changed, [], 'with no earlier copy, nothing is claimed as changed');
});

test('what to chase: steps waiting on others, due within a week or undated', () => {
  const d = R.draftReview(sources(), { now: NOW });
  const studio = d.projects.find((r) => r.name === 'Studio Upgrade');
  assert.deepEqual(studio.chase.map((i) => [i.words, i.detail]), [
    ['Studio hands: Chase the spare microphone stands', 'due 21 Oct'],
    ['Priya: Book the speaker fitting', 'due 20 Oct'],
    ['Leilani: Ask the vendor for spare microphone stands', 'no day set'],
  ], 'Sam (the owner) isn’t chased; the overdue step is under slipped');
  assert.ok(R.waitsOnOthers({ who: 'Priya' }, 'Sam Taylor'));
  assert.ok(!R.waitsOnOthers({ who: 'Sam' }, 'Sam Taylor'));
  assert.ok(!R.waitsOnOthers({ who: 'me' }, 'Sam Taylor'));
  assert.ok(!R.waitsOnOthers({}, 'Sam Taylor'));
});

test('the changes proposed: health from what slipped, overdue steps to the coming Friday, the week’s update', () => {
  const d = R.draftReview(sources(), { now: NOW });
  const studio = d.projects.find((r) => r.name === 'Studio Upgrade');
  assert.deepEqual(studio.proposals.map((x) => [x.kind, x.words, x.value, x.accept]), [
    ['health', 'Health: On track → At risk', 'at risk', true],
    ['move', 'Move “Send the reconciliation to finance” to 23 Oct', '23 Oct', false],
    ['update', 'Add this week’s update', 'Week to 16 Oct: done: “Export the device inventory”; 1 new step; 1 task done for you; 4 files changed; 1 step overdue.', true],
  ]);
  assert.equal(studio.proposals[0].why, '“Send the reconciliation to finance” is overdue.');
  const harbour = d.projects.find((r) => r.name === 'Harbour Fit-out');
  // p12-close-and-noise B (4 Nov 2026): a count is not an update — overdue steps alone write no Updates line.
  assert.deepEqual(harbour.proposals.map((x) => [x.kind, x.value]), [['health', 'off track'], ['move', '23 Oct'], ['move', '23 Oct'], ['move', '23 Oct']]);
  assert.equal(harbour.proposals[0].why, 'It was due 5 Oct and isn’t done.');
  const quiet = d.projects.find((r) => r.name === 'Winter Menu Launch');
  assert.deepEqual(quiet.proposals, [], 'a quiet project gets no update line');
  // Back on track: something done, nothing overdue.
  const better = R.draftReview([{ path: 'x.md', text: '---\ntype: project\nhealth: at risk\n---\n# Bakery\n\n## What’s next\n\n- [x] Fix the oven\n', before: '---\ntype: project\nhealth: at risk\n---\n# Bakery\n\n## What’s next\n\n- [ ] Fix the oven\n', beforeTime: at(1) }], { now: NOW });
  assert.deepEqual(better.projects[0].proposals.map((x) => [x.kind, x.value]), [['health', 'on track'], ['update', 'Week to 16 Oct: done: “Fix the oven”.']]);
  assert.equal(R.nextFriday(NOW).getDate(), 23, 'on a Friday, the next Friday is a week away');
  assert.equal(R.nextFriday(new Date(2026, 9, 13)).getDate(), 16);
});

test('no update line when nothing really changed: overdue alone stays in the note, not Updates (p12 B)', () => {
  const d = R.draftReview([{ path: 'Projects/Harbour Fit-out/Harbour Fit-out.md', text: HARBOUR, before: null, files: null }], { now: NOW });
  const harbour = d.projects[0];
  assert.ok(harbour.slipped.length >= 3, 'the slipped steps are still there to decide on');
  assert.deepEqual(harbour.proposals.filter((x) => x.kind === 'update'), [], 'a count is not an update');
  const note = R.reviewNote(d, [{ path: harbour.path, name: harbour.name, applied: [], left: harbour.proposals.map((x) => x.words) }], NOW);
  assert.ok(note.includes('**What slipped**') && note.includes('Approve the lighting quote'), 'the review note itself stays');
});

test('proposals become edits to the project as it is when applied', () => {
  const p = P.parseProject(STUDIO_NOW);
  assert.deepEqual(R.proposalEdit(p, { kind: 'health', value: 'At risk' }), { kind: 'set', field: 'health', value: 'at risk' });
  assert.equal(R.proposalEdit(p, { kind: 'health', value: 'wobbly' }), null);
  assert.deepEqual(R.proposalEdit(p, { kind: 'update', value: 'Week to 16 Oct: good.' }), { kind: 'add', list: 'updates', item: { what: 'Week to 16 Oct: good.', from: 'Weekly review' } });
  assert.deepEqual(R.proposalEdit(p, { kind: 'move', value: '23 Oct', step: 'send the reconciliation to finance' }), { kind: 'change', list: 'next', index: 0, item: { when: '23 Oct' } }, 'found by its words');
  assert.equal(R.proposalEdit(p, { kind: 'move', value: '23 Oct', step: 'Export the device inventory' }), null, 'a done step isn’t moved');
  assert.equal(R.proposalEdit(p, { kind: 'next', value: 'Book the speaker fitting' }), null, 'a step already there isn’t added again');
  // Applied: the file says what was decided.
  const d = R.draftReview(sources(), { now: NOW });
  const studio = d.projects.find((r) => r.name === 'Studio Upgrade');
  for (const x of studio.proposals.filter((x) => x.kind !== 'move')) P.applyProjectEdit(p, R.proposalEdit(p, x), '16 Oct 2026');
  const text = P.serializeProject(p, STUDIO_NOW);
  assert.ok(text.includes('health: at risk'));
  assert.ok(text.includes('- **16 Oct 2026** — Week to 16 Oct: done: “Export the device inventory”; 1 new step; 1 task done for you; 4 files changed; 1 step overdue. *From:* Weekly review'));
});

test('the assistant’s suggestions are proposals, off until ticked, only for projects in the review', () => {
  const d = R.draftReview(sources(), { now: NOW });
  const next = R.readAssistantSuggestions({ suggestions: [
    { project: 'studio upgrade', kind: 'next', value: 'Ask finance when they need the reconciliation', why: 'It’s a week late.' },
    { project: 'Studio Upgrade', kind: 'health', value: 'off track' },
    { project: 'Winter Menu Launch', kind: 'health', value: 'on track' },
    { project: 'Nowhere', kind: 'next', value: 'x' },
    { project: 'Studio Upgrade', kind: 'delete', value: 'x' },
  ] }, d);
  const studio = next.projects.find((r) => r.name === 'Studio Upgrade');
  const ai = studio.proposals.filter((x) => x.by === 'assistant');
  assert.deepEqual(ai.map((x) => [x.kind, x.words, x.accept]), [['next', 'New next step: Ask finance when they need the reconciliation', false]], 'health is the review’s own already');
  assert.equal(next.projects.find((r) => r.name === 'Winter Menu Launch').proposals.length, 0, 'the health it has already');
  assert.equal(R.readAssistantSuggestions(null, d).projects.length, 3);
});

test('the review’s note keeps the week and what was decided', () => {
  const d = R.draftReview(sources(), { now: NOW });
  const note = R.reviewNote(d, [
    { path: 'Projects/Studio Upgrade/Studio Upgrade.md', name: 'Studio Upgrade', applied: ['Health: On track → At risk', 'Added this week’s update'], left: ['Move “Send the reconciliation to finance” to 23 Oct'] },
    { path: 'Projects/Harbour Fit-out/Harbour Fit-out.md', name: 'Harbour Fit-out', applied: [], left: [], failed: 'it changed while the review was open.' },
  ], NOW);
  assert.ok(note.startsWith('---\ntype: review\ndate: 2026-10-16\nweek: 2026-10-10 to 2026-10-16\nprojects: ["[[Harbour Fit-out]]", "[[Studio Upgrade]]"]\ntags: [review]\n---\nSaturday 10 Oct'), 'no heading: the note’s name (Weekly review — 16 Oct 2026) is its title');
  assert.ok(note.includes('Saturday 10 Oct to Friday 16 Oct. 2 changes made across 3 projects.'));
  assert.ok(note.includes('## [[Studio Upgrade]]\n\n**What changed**\n- Done: Export the device inventory — Sam\n'));
  assert.ok(note.includes('**Decided**\n- Health: On track → At risk\n- Added this week’s update\n\n**Left as it was**\n- Move “Send the reconciliation to finance” to 23 Oct'));
  assert.ok(note.includes('**Decided**\n- Not changed: it changed while the review was open.'));
  assert.ok(note.includes('## Quiet this week\n\n[[Winter Menu Launch]]'));
});

test('the Friday notice: on the chosen day and time, until it’s done or put off', () => {
  const prefs = { on: true, day: 5, time: '15:00' };
  assert.ok(R.reviewDue(NOW, prefs, null, null), 'Friday 4 pm, never reviewed');
  assert.ok(!R.reviewDue(new Date(2026, 9, 16, 14, 59), prefs, null, null), 'not before 3 pm');
  assert.ok(!R.reviewDue(NOW, prefs, at(16, 15), null), 'done today after 3 pm');
  assert.ok(R.reviewDue(NOW, prefs, at(16, 9), null), 'a review in the morning was before the moment');
  assert.ok(!R.reviewDue(NOW, prefs, null, at(16, 15)), 'put off ("Not this week")');
  assert.ok(R.reviewDue(new Date(2026, 9, 19, 9), prefs, null, null), 'still offered on Monday when last week’s wasn’t done');
  assert.ok(!R.reviewDue(new Date(2026, 9, 19, 9), prefs, at(16, 17), null));
  assert.ok(!R.reviewDue(NOW, { ...prefs, on: false }, null, null), 'switched off in Settings');
  assert.equal(R.reviewMoment(new Date(2026, 9, 15, 12), 5, '15:00').getDate(), 9, 'on a Thursday the moment is last Friday');
  assert.equal(R.reviewMoment(NOW, 1, '09:30').getDate(), 12);
});
