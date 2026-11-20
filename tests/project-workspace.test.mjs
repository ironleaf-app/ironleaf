// node --test tests/project-workspace.test.mjs — the project workspace (24 Oct 2026, Workstream 1 part D;
// src/shared/workspace-records.ts, src/shared/record-views.ts, src/shared/project-workspace.ts): a project's records read
// from its Markdown (actions with owners and due days, a workstream joined by its words, run-sheet phases, milestones,
// risks from a table, files by purpose and version, people from a contacts table and their notes, meetings, log
// entries, a register's rows); views that filter, sort, group and chart them, kept as files that forgive hand edits;
// the sections made from what a project holds (no AI), the person's order, pins, hidden sections and views of their
// own; each change in a view as one edit of one line or cell; and what dragging a record somewhere means.
// A made-up community garden and a made-up bakery only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-workspace-'));
let R, V, W, P, L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const make = async (name, file) => {
    await build({ input: path.join(root, file), platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  R = await make('records', 'src/shared/workspace-records.ts');
  V = await make('views', 'src/shared/record-views.ts');
  W = await make('workspace', 'src/shared/project-workspace.ts');
  P = await make('project', 'src/shared/project-file.ts');
  L = await make('layouts', 'src/shared/layouts.ts');
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = new Date(2026, 9, 24);

const GARDEN = `---
type: project
layout: programme
status: active
health: at risk
owner: Ana Ruiz
---
# Hillside Community Garden

## Summary

Raised beds and a tool shed on the old bowling green.

## Workstreams

| Workstream | Owner | Status | Progress | Next step |
| --- | --- | --- | --- | --- |
| Raised beds | Ana Ruiz | in progress | 40 | Order timber |
| Tool shed | Ben Ito | at risk | | Get the council permit |
| Water tank | Cleo Park | done | 100 | Nothing |

## What’s next

- [ ] Order the timber for the raised beds — Ana Ruiz · by 2026-10-20
- [ ] Ask the council about the shed permit — Ben Ito · by 2026-10-30
- [x] Fit the water tank — Cleo Park
- [ ] Find volunteers for the planting day

## Key dates

| Date | Milestone | Status |
| --- | --- | --- |
| 2026-10-01 | Site cleared | done |
| 2026-11-14 | Planting day | next |
| 2026-12-05 | Opening picnic | |

## People

- **Ana Ruiz** — Garden coordinator
- **Ben Ito** — Builder

## Risks and issues

| Risk | Impact | Owner | Status |
| --- | --- | --- | --- |
| The council permit for the shed is slow | High | Ben Ito | Open |
| Timber prices rising | Medium | | Open |
| Water tank leak | Low | Cleo Park | Closed 10 Oct 2026 |

## Decisions

- **2026-10-05** — Beds will be cedar, not pine. *Why:* Lasts longer

## Updates

- **2026-10-21** — Water tank fitted and filled. *From:* site visit

## Documents

- \`Plans/Bed layout v2.pdf\` — The layout of the beds
- \`Quotes/Timber quote.xlsx\` — The timber quote from the yard
- \`Council permit application.docx\` — The shed permit form

## Suppliers and contacts

| Name | Role | Company | Contact |
| --- | --- | --- | --- |
| Dee Moss | Timber supplier | Moss Timber | dee@example.com |
| Ben Ito | Builder | Ito Builds | |

## Notes

- Ask about compost bins.
`;

const notes = [
  { path: 'Meetings/2026-10-12 Garden committee.md', title: '2026-10-12 Garden committee', mtime: Date.UTC(2026, 9, 12), props: { type: 'meeting', date: '2026-10-12', project: '[[Hillside Community Garden]]', people: ['[[Ana Ruiz]]', '[[Ben Ito]]'] }, links: ['Hillside Community Garden'] },
  { path: 'People/Ana Ruiz.md', title: 'Ana Ruiz', mtime: 1, props: { type: 'person', role: 'Garden coordinator', email: 'ana@example.com' }, links: ['Hillside Community Garden'] },
  { path: 'Projects/Hillside Community Garden/Soil test.md', title: 'Soil test', mtime: Date.UTC(2026, 9, 18), props: {} },
  { path: 'Notes/Unrelated.md', title: 'Unrelated', mtime: 1, props: {} },
];

const gardenInput = () => {
  const project = P.parseProject(GARDEN, 'Projects/Hillside Community Garden/Hillside Community Garden.md');
  const path = 'Projects/Hillside Community Garden/Hillside Community Garden.md';
  return { path, project, notes: R.notesOfProject(path, project.name, notes), today: TODAY };
};

test('a project’s records: actions, workstreams, milestones, risks, files, people, meetings and notes', () => {
  const recs = R.projectRecords(gardenInput());
  const of = (k) => recs.filter((r) => r.kind === k);
  assert.equal(of('workstream').length, 3);
  assert.equal(of('action').length, 4);
  const timber = of('action').find((a) => a.title.startsWith('Order the timber'));
  assert.equal(timber.fields.owner, 'Ana Ruiz');
  assert.equal(timber.fields.due, '2026-10-20');
  assert.equal(timber.fields.status, 'Overdue');
  assert.equal(timber.fields.workstream, 'Raised beds', 'joined to its workstream by its words');
  const shed = of('action').find((a) => a.title.includes('shed permit'));
  assert.equal(shed.fields.workstream, 'Tool shed');
  assert.equal(of('action').find((a) => a.title.startsWith('Fit')).fields.status, 'Done');
  assert.deepEqual(of('milestone').map((m) => m.fields.date), ['2026-10-01', '2026-11-14', '2026-12-05']);
  const risks = of('risk');
  assert.equal(risks.length, 3);
  assert.equal(risks[0].fields.impact, 'High');
  assert.equal(risks[2].fields.closed, true);
  const files = of('file');
  assert.equal(files.find((f) => f.title === 'Bed layout v2.pdf').fields.purpose, 'Designs and drawings');
  assert.equal(files.find((f) => f.title === 'Bed layout v2.pdf').fields.version, 'v2');
  assert.equal(files.find((f) => f.title === 'Timber quote.xlsx').fields.purpose, 'Quotes and pricing');
  // People: the People list, the contacts table and Ana's note, once each with what each knows.
  const people = of('person');
  assert.deepEqual(people.map((p) => p.title).sort(), ['Ana Ruiz', 'Ben Ito', 'Dee Moss']);
  assert.equal(people.find((p) => p.title === 'Ben Ito').fields.company, 'Ito Builds');
  assert.equal(people.find((p) => p.title === 'Dee Moss').fields.contact, 'dee@example.com');
  const meeting = of('meeting')[0];
  assert.equal(meeting.fields.date, '2026-10-12');
  assert.equal(meeting.fields.people, 'Ana Ruiz, Ben Ito');
  assert.ok(meeting.links.includes(people.find((p) => p.title === 'Ben Ito').id), 'a meeting joined to the people it names');
  assert.deepEqual(of('note').map((n) => n.title), ['Soil test']);
  // An action is joined to its owner, both ways.
  const ana = people.find((p) => p.title === 'Ana Ruiz');
  assert.ok(timber.links.includes(ana.id) && ana.links.includes(timber.id));
});

test('actions written in the project’s meetings count in its workspace, once, ticked where they are written (WS1 integration, 24 Oct 2026)', () => {
  const connected = [
    { id: 'action:Meetings/2026-10-22 Garden catch-up.md#water-the-new-raised-beds', path: 'Meetings/2026-10-22 Garden catch-up.md', line: 9, what: 'Water the new raised beds', who: 'Ana Ruiz', due: '2026-10-21', done: false, from: '2026-10-22 Garden catch-up', task: 'Water the new raised beds — Ana Ruiz · by 21 Oct' },
    { id: 'action:Meetings/2026-10-22 Garden catch-up.md#order-the-timber', path: 'Meetings/2026-10-22 Garden catch-up.md', line: 10, what: 'Order the timber for the raised beds', done: false, from: '2026-10-22 Garden catch-up' },
    { id: 'action:Meetings/2026-10-22 Garden catch-up.md#council-said-no', path: 'Meetings/2026-10-22 Garden catch-up.md', line: 11, what: 'Council: the bowling club wants a site map', done: false, from: '2026-10-22 Garden catch-up' },
  ];
  const recs = R.projectRecords({ ...gardenInput(), connected });
  const actions = recs.filter((r) => r.kind === 'action');
  const water = actions.find((a) => a.title === 'Water the new raised beds');
  assert.ok(water, 'a meeting’s action is one of the project’s actions');
  assert.deepEqual([water.fields.owner, water.fields.due, water.fields.status, water.fields.source, water.fields.workstream], ['Ana Ruiz', '2026-10-21', 'Overdue', '2026-10-22 Garden catch-up', 'Raised beds']);
  assert.equal(water.ref.at, 'elsewhere');
  assert.deepEqual(W.editableFields(water), ['done'], 'only its tick changes from here: its words are the meeting’s');
  assert.equal(W.recordEdit(gardenInput().project, water, 'title', 'Something else'), null);
  assert.equal(actions.filter((a) => /order the timber/i.test(a.title)).length, 1, 'filed into What’s next already: counted once');
  const said = actions.find((a) => a.title.startsWith('Council'));
  assert.deepEqual(W.editableFields(said), [], 'a plain line (no tick box): nothing to change from here');
});

test('two files sharing a name in two folders are two records (9.5 fourth pass)', () => {
  const p = P.parseProject('---\ntype: project\n---\n# Shop\n\n## Documents\n\n- `Plans/Status.pdf`\n- `Reports/Status.pdf`\n', 'Projects/Shop/Shop.md');
  const recs = R.projectRecords({ path: 'Projects/Shop/Shop.md', project: p, notes: [], today: TODAY });
  assert.equal(recs.filter((r) => r.kind === 'file').length, 2);
  const recs2 = R.projectRecords({ path: 'Projects/Shop/Shop.md', project: p, notes: [], today: TODAY, files: [{ rel: 'Plans/Status.pdf', name: 'Status.pdf', ext: 'pdf', size: 1, modified: 1 }, { rel: 'Reports/Status.pdf', name: 'Status.pdf', ext: 'pdf', size: 1, modified: 1 }] });
  assert.equal(recs2.filter((r) => r.kind === 'file').length, 2, 'folder files too');
  const one = P.parseProject('---\ntype: project\n---\n# Shop\n\n## Documents\n\n- `Plans/Status.pdf` — the plan status\n- `Plans/Status.pdf`\n', 'Projects/Shop/Shop.md');
  const recs3 = R.projectRecords({ path: 'Projects/Shop/Shop.md', project: one, notes: [], today: TODAY });
  assert.equal(recs3.filter((r) => r.kind === 'file').length, 1, 'the same path twice is one record');
});

test('an owner shared with the team reads as the person (9.5 fourth pass)', () => {
  const p = P.parseProject('---\ntype: project\n---\n# Shop\n\n## What’s next\n\n- [ ] Paint the door — Jay / team\n', 'Projects/Shop/Shop.md');
  const recs = R.projectRecords({ path: 'Projects/Shop/Shop.md', project: p, notes: [], today: TODAY });
  assert.equal(recs.find((r) => r.kind === 'action').fields.owner, 'Jay');
});

test('an action naming two workstreams joins the one still running (9.5 fourth pass)', () => {
  const p = P.parseProject('---\ntype: project\n---\n# Shop\n\n## Workstreams\n\n| Workstream | Owner | Status |\n| --- | --- | --- |\n| Paint doors | Ana | Done |\n| Paint windows | Ben | Started |\n\n## What’s next\n\n- [ ] Paint the trim — Ana\n', 'Projects/Shop/Shop.md');
  const recs = R.projectRecords({ path: 'Projects/Shop/Shop.md', project: p, notes: [], today: TODAY });
  assert.equal(recs.find((r) => r.kind === 'action').fields.workstream, 'Paint windows');
});

test('a person named by a link keeps somewhere to open (9.5 fourth pass)', () => {
  const p = P.parseProject('---\ntype: project\n---\n# Shop\n\n## People\n\n- [[Ana Ruiz]] — coordinator\n', 'Projects/Shop/Shop.md');
  const ana = R.projectRecords({ path: 'Projects/Shop/Shop.md', project: p, notes: [], today: TODAY }).find((r) => r.kind === 'person');
  assert.equal(ana.path, 'Ana Ruiz');
});

test('a run sheet’s phases are the workstreams, and its tick boxes the actions in them', () => {
  const text = `---\ntype: project\nlayout: site\n---\n# Bakery pop-up\n\n## Run sheet\n\n### Before\n\n- [x] Book the stall — Ana · by 2026-10-10\n- [ ] Order the signs — Ben · by 2026-11-02\n\n### On the day\n\n- [ ] Set up the tables\n`;
  const project = P.parseProject(text, 'Projects/Bakery pop-up/Bakery pop-up.md');
  const recs = R.projectRecords({ path: 'Projects/Bakery pop-up/Bakery pop-up.md', project, today: TODAY });
  const ws = recs.filter((r) => r.kind === 'workstream');
  assert.deepEqual(ws.map((w) => [w.title, w.fields.progress]), [['Before', 50], ['On the day', 0]]);
  const signs = recs.find((r) => r.title === 'Order the signs');
  assert.equal(signs.fields.workstream, 'Before');
  assert.equal(signs.fields.owner, 'Ben');
  assert.deepEqual(signs.ref, { at: 'runsheet', heading: 'Run sheet', line: 3 });
});

test('a register’s rows and a log’s entries are records with their own fields', () => {
  const text = `---\ntype: project\nlayout: register\n---\n# Spare laptops\n\n## Register\n\n| Device | Status | Qty | Last checked |\n| --- | --- | --- | --- |\n| ThinkPad T14 | In stock | 12 | 2026-10-01 |\n| MacBook Air | In repair | 2 | 2026-09-20 |\n`;
  const project = P.parseProject(text, 'P/Spare laptops.md');
  const log = L.parseLog('---\ntype: log\nproject: Spare laptops\n---\n## 2026-10-20\n- Weight: 101.5 kg\n- Done: Y\n\n## 2026-10-22\n- Weight: 100.9 kg\n- Done: N\n', TODAY);
  log.path = 'P/Spare laptops log.md';
  const recs = R.projectRecords({ path: 'P/Spare laptops.md', project, logs: [log], today: TODAY });
  const items = recs.filter((r) => r.kind === 'item');
  assert.equal(items.length, 2);
  assert.equal(items[0].fields.qty, 12);
  assert.equal(items[0].fields.status, 'In stock');
  assert.equal(items[0].fields.last_checked, '2026-10-01');
  const entries = recs.filter((r) => r.kind === 'entry');
  assert.deepEqual(entries.map((e) => e.fields.weight), [101.5, 100.9]);
  assert.equal(entries[1].fields.done, false);
});

test('a view filters, hides what’s done, sorts and groups; its file forgives hand edits', () => {
  const recs = R.projectRecords(gardenInput());
  const def = { ...V.defaultRecordView(['action'], 'list'), groupBy: 'owner', sort: { field: 'due', dir: 'asc' } };
  const run = V.runRecordView(recs, def, TODAY);
  assert.equal(run.rows.length, 3, 'the done action steps aside');
  assert.equal(run.hidden, 1);
  assert.deepEqual(run.groups.map((g) => g.label), ['Ana Ruiz', 'Ben Ito', 'No owner']);
  const overdue = V.runRecordView(recs, { ...def, groupBy: undefined, filters: [{ field: 'due', op: 'before', value: 'today' }] }, TODAY);
  assert.deepEqual(overdue.rows.map((r) => r.title), ['Order the timber for the raised beds']);
  const byWhen = V.runRecordView(recs, { ...def, groupBy: 'due_group' }, TODAY);
  assert.deepEqual(byWhen.groups.map((g) => g.label), ['Overdue', 'Next week', 'No date']);
  // A board by status keeps done things as their own column.
  const board = V.runRecordView(recs, { ...V.defaultRecordView(['workstream'], 'board'), groupBy: 'status' }, TODAY);
  assert.deepEqual(board.groups.map((g) => g.label), ['In progress', 'At risk', 'Done']);
  // The file: written readably, read back the same, a broken one says so plainly.
  const text = V.writeRecordView({ ...def, title: 'By owner' });
  assert.deepEqual(V.readRecordView(text).def, V.cleanRecordView({ ...def, title: 'By owner' }));
  assert.match(text, /"layout": "list"/);
  const loose = V.readRecordView('{"kinds":["risk","nonsense"],"layout":"spiral","filters":[{"field":"impact","op":"is","value":"High"},{"op":"zap"}]}').def;
  assert.deepEqual([loose.kinds, loose.layout, loose.filters.length], [['risk'], 'table', 1]);
  assert.match(V.readRecordView('{oops').problem, /couldn’t be read/);
  assert.equal(V.viewFileName('All open actions!'), 'all-open-actions.json');
});

test('charts count by a field, add up numbers, and draw a number over time', () => {
  const recs = R.projectRecords(gardenInput());
  const ring = V.chartData(recs, { ...V.defaultRecordView(['risk'], 'chart'), chart: { type: 'donut', by: 'impact', measure: 'count' } }, TODAY);
  assert.deepEqual(ring.points.map((p) => [p.label, p.value]), [['High', 1], ['Medium', 1], ['Low', 1]]);
  assert.equal(ring.caption, 'Risks by impact');
  const progress = V.chartData(recs, { ...V.defaultRecordView(['workstream'], 'chart'), chart: { type: 'bar', by: 'owner', measure: 'progress' } }, TODAY);
  assert.deepEqual(progress.points.map((p) => [p.label, p.value]), [['Ana Ruiz', 40], ['Cleo Park', 100]]);
  const log = L.parseLog('---\ntype: log\n---\n## 2026-10-20\n- Weight: 101.5\n\n## 2026-10-21\n- Weight: 101.1\n\n## 2026-10-22\n- Weight: 100.9\n', TODAY);
  log.path = 'L.md';
  const entries = R.projectRecords({ path: 'X.md', project: P.parseProject('---\ntype: project\n---\n# X\n'), logs: [log], today: TODAY });
  const spec = V.suggestChart(entries, ['entry']);
  assert.deepEqual(spec, { type: 'line', by: 'date', measure: 'weight', agg: 'avg' });
  const line = V.chartData(entries, { ...V.defaultRecordView(['entry'], 'chart'), chart: spec }, TODAY);
  assert.deepEqual(line.points.map((p) => [p.label, p.value]), [['20 Oct', 101.5], ['21 Oct', 101.1], ['22 Oct', 100.9]]);
  assert.equal(line.caption, 'Weight (average) over time');
});

test('sections are made from what the project holds, and the person’s choices win', () => {
  const input = gardenInput();
  const recs = R.projectRecords(input);
  // "Today" is the fixture's day, so the overdue count never moves with the calendar (31 Oct 2026: a due date of
  // 30 Oct turned overdue at midnight and the count went to 2).
  const sections = W.resolveWorkspace(recs, input.project, null, {}, TODAY);
  const ids = sections.filter((s) => !s.hidden).map((s) => s.id);
  assert.deepEqual(ids, ['overview', 'plan', 'actions', 'meetings', 'risks', 'people', 'files', 'updates', 'notes', 'ask']);
  const plan = sections.find((s) => s.id === 'plan');
  assert.deepEqual(plan.views.map((v) => [v.title, v.layout]), [['Workstreams', 'gallery'], ['Milestones', 'timeline']]);
  assert.equal(sections.find((s) => s.id === 'actions').alert, 1, 'one overdue action flagged in the outline');
  assert.equal(sections.find((s) => s.id === 'actions').count, 3);
  assert.equal(sections.find((s) => s.id === 'files').views[0].groupBy, 'purpose');
  // A plain project with only actions: meetings, people, risks wait hidden until wanted.
  const bare = P.parseProject('---\ntype: project\n---\n# Shed\n\n## What’s next\n\n- [ ] Paint it\n');
  const bareSections = W.resolveWorkspace(R.projectRecords({ path: 'Shed.md', project: bare, today: TODAY }), bare, null);
  assert.deepEqual(bareSections.filter((s) => !s.hidden).map((s) => s.id), ['overview', 'actions', 'files', 'notes', 'ask']);
  // A new project of a kind shows its kind's sections, empty ones saying what they are for.
  const fresh = W.resolveWorkspace([], bare, W.emptyWorkspace('Shed.md', 'site'));
  assert.deepEqual(fresh.filter((s) => !s.hidden).map((s) => s.id).slice(0, 4), ['overview', 'plan', 'actions', 'people']);
  assert.ok(fresh.find((s) => s.id === 'plan').empty);
  // The person's order, pin, hidden, rename and own section; written and read back.
  let file = W.emptyWorkspace(input.path);
  file = W.moveSection(file, sections, 'files', 'plan');
  file = W.pinSection(file, 'risks', true);
  file = W.hideSection(file, sections, 'updates', true);
  file = W.renameSection(file, 'actions', 'To do');
  const made = W.addCustomSection(file, 'Overdue by owner', { ...V.defaultRecordView(['action'], 'table'), filters: [{ field: 'due_group', op: 'is', value: 'Overdue' }] });
  file = made.file;
  const again = W.readWorkspace(W.writeWorkspace(file), input.path);
  assert.deepEqual(again, file);
  const mine = W.resolveWorkspace(recs, input.project, again).filter((s) => !s.hidden);
  assert.deepEqual(mine.map((s) => s.id).slice(0, 4), ['risks', 'overview', 'files', 'plan']);
  assert.equal(mine.find((s) => s.id === 'actions').title, 'To do');
  assert.ok(mine.some((s) => s.id === made.id && s.custom));
  assert.equal(W.workspaceFileOf('Projects/Hillside/Hillside.md'), '.neuralvault/workspaces/Projects » Hillside » Hillside.json');
  // A hand-broken file opens as a fresh workspace, not an error.
  assert.deepEqual(W.readWorkspace('{nope', 'X.md'), W.emptyWorkspace('X.md'));
});

test('a change in a view is one edit of one line or cell, and the file keeps every other character', () => {
  const input = gardenInput();
  const recs = R.projectRecords(input);
  const p = input.project;
  const apply = (edit) => {
    const copy = P.parseProject(GARDEN, input.path);
    P.applyProjectEdit(copy, edit, '24 Oct 2026');
    return P.serializeProject(copy, GARDEN);
  };
  const diff = (after) => {
    const a = GARDEN.split('\n');
    const b = after.split('\n');
    return b.filter((l, i) => l !== a[i]);
  };
  const timber = recs.find((r) => r.title.startsWith('Order the timber'));
  assert.deepEqual(diff(apply(W.recordEdit(p, timber, 'owner', 'Cleo Park'))), ['- [ ] Order the timber for the raised beds — Cleo Park · by 2026-10-20']);
  assert.deepEqual(diff(apply(W.recordEdit(p, timber, 'status', 'Done'))), ['- [x] Order the timber for the raised beds — Ana Ruiz · by 2026-10-20']);
  const shed = recs.find((r) => r.kind === 'workstream' && r.title === 'Tool shed');
  assert.deepEqual(diff(apply(W.recordEdit(p, shed, 'status', 'in progress'))), ['| Tool shed | Ben Ito | in progress | | Get the council permit |']);
  const planting = recs.find((r) => r.title === 'Planting day');
  assert.deepEqual(diff(apply(W.recordEdit(p, planting, 'date', '2026-11-21'))), ['| 2026-11-21 | Planting day | next |']);
  const permit = recs.find((r) => r.kind === 'risk' && r.title.startsWith('The council'));
  assert.deepEqual(diff(apply(W.recordEdit(p, permit, 'owner', 'Ana Ruiz'))), ['| The council permit for the shed is slow | High | Ana Ruiz | Open |']);
  assert.equal(W.recordEdit(p, recs.find((r) => r.kind === 'meeting'), 'title', 'x'), null, 'a meeting note isn’t changed from a project view');
});

test('dragging a record somewhere does what it means there, and nothing where it means nothing', () => {
  const input = gardenInput();
  const recs = R.projectRecords(input);
  const p = input.project;
  const volunteers = recs.find((r) => r.title.startsWith('Find volunteers'));
  const beds = recs.find((r) => r.kind === 'workstream' && r.title === 'Raised beds');
  const toBeds = W.dropPlan(p, volunteers, { record: beds }, TODAY);
  assert.equal(toBeds.words, 'Make it Raised beds’s next step');
  assert.equal(toBeds.edits[0].kind, 'section');
  assert.match(toBeds.edits[0].body, /\| Raised beds \| Ana Ruiz \| in progress \| 40 \| Find volunteers for the planting day \|/);
  const planting = recs.find((r) => r.title === 'Planting day');
  const due = W.dropPlan(p, volunteers, { record: planting }, TODAY);
  assert.deepEqual(due.edits, [{ kind: 'change', list: 'next', index: 3, item: { when: '2026-11-14' } }]);
  const dee = recs.find((r) => r.title === 'Dee Moss');
  assert.deepEqual(W.dropPlan(p, dee, { record: volunteers }, TODAY).edits, [{ kind: 'change', list: 'next', index: 3, item: { who: 'Dee Moss' } }]);
  assert.equal(W.dropPlan(p, volunteers, { section: 'risks' }, TODAY).words, 'Raise it as a risk');
  const permit = recs.find((r) => r.kind === 'risk' && r.title.startsWith('The council'));
  assert.deepEqual(W.dropPlan(p, permit, { section: 'actions' }, TODAY).edits, [{ kind: 'add', list: 'next', item: { what: 'Deal with: The council permit for the shed is slow', who: 'Ben Ito' } }]);
  assert.equal(W.dropPlan(p, recs.find((r) => r.kind === 'file'), { section: 'people' }, TODAY), null);
  // A run sheet's action dropped onto another phase moves there, every other line kept.
  const text = `---\ntype: project\nlayout: site\n---\n# Pop-up\n\n## Run sheet\n\n### Before\n\n- [ ] Order the signs\n- [ ] Book the van\n\n### On the day\n\n- [ ] Set up the tables\n`;
  const pop = P.parseProject(text, 'P.md');
  const popRecs = R.projectRecords({ path: 'P.md', project: pop, today: TODAY });
  const van = popRecs.find((r) => r.title === 'Book the van');
  const day = popRecs.find((r) => r.kind === 'workstream' && r.title === 'On the day');
  const moved = W.dropPlan(pop, van, { record: day }, TODAY);
  assert.equal(moved.words, 'Move to On the day');
  assert.equal(moved.edits[0].body, '### Before\n\n- [ ] Order the signs\n\n### On the day\n\n- [ ] Set up the tables\n- [ ] Book the van');
  const emptyText = `---\ntype: project\n---\n# Pop-up\n\n## Run sheet\n\n### Before\n\n- [ ] Order the signs\n- [ ] Book the van\n\n### On the day\n`;
  const empty = P.parseProject(emptyText, 'P.md');
  const emptyRecs = R.projectRecords({ path: 'P.md', project: empty, today: TODAY });
  const van2 = emptyRecs.find((r) => r.title === 'Book the van');
  const day2 = emptyRecs.find((r) => r.kind === 'workstream' && r.title === 'On the day');
  assert.equal(W.dropPlan(empty, van2, { record: day2 }, TODAY).edits[0].body, '### Before\n\n- [ ] Order the signs\n\n### On the day\n- [ ] Book the van', 'onto an empty phase: under its heading');
});

test('a new record from a section is one line added where that kind lives', () => {
  const input = gardenInput();
  assert.deepEqual(W.addRecordEdit(input.project, 'action', '  Buy seedlings '), { kind: 'add', list: 'next', item: { what: 'Buy seedlings' } });
  assert.deepEqual(W.addRecordEdit(input.project, 'milestone', 'Harvest', TODAY), { kind: 'add', list: 'dates', item: { what: 'Harvest', when: '2026-10-24' } });
  assert.deepEqual(W.addRecordEdit(input.project, 'risk', 'Frost', TODAY), { kind: 'add', list: 'risks', item: { what: 'Frost', status: 'Open' } });
  assert.equal(W.addRecordEdit(input.project, 'meeting', 'x'), null);
});

test('vault-wide records gather every project’s, and people once each across projects', () => {
  const a = gardenInput();
  const b = { path: 'Projects/Bakery/Bakery.md', project: P.parseProject('---\ntype: project\n---\n# Bakery\n\n## People\n\n- **Ana Ruiz** — Baker\n\n## What’s next\n\n- [ ] Order flour — Ana Ruiz\n'), notes: [], today: TODAY };
  const all = R.vaultRecords([a, b], notes, TODAY);
  const anas = all.filter((r) => r.kind === 'person' && r.title === 'Ana Ruiz');
  assert.equal(anas.length, 1);
  assert.equal(anas[0].path, 'People/Ana Ruiz.md');
  assert.match(anas[0].fields.projects, /Hillside Community Garden/);
  assert.match(anas[0].fields.projects, /Bakery/);
  assert.equal(all.filter((r) => r.kind === 'action').length, 5);
  assert.equal(all.filter((r) => r.kind === 'meeting').length, 1, 'a meeting in a project and in Meetings counted once');
});

test('a changed owner or day keeps the rest of what was written with it', () => {
  const text = `---\ntype: project\n---\n# Pop-up\n\n## What’s next\n\n- [ ] Join the call — Ana Ruiz · Fri 23 Oct, 11:00 AM\n- [ ] Book the van — Ana Ruiz with Ben Ito (driver) · by 2026-11-02\n\n## Run sheet\n\n### Before\n\n- [ ] Order the signs — Cleo Park with the printer · by 2026-11-01\n`;
  const p = P.parseProject(text, 'P.md');
  const recs = R.projectRecords({ path: 'P.md', project: p, today: TODAY });
  const call = recs.find((r) => r.title === 'Join the call');
  assert.equal(call.fields.owner, 'Ana Ruiz', 'a day written among the names isn’t part of the owner');
  assert.equal(call.fields.due, '2026-10-23');
  assert.deepEqual(W.recordEdit(p, call, 'owner', 'Ben Ito').item, { who: 'Ben Ito · Fri 23 Oct, 11:00 AM' });
  assert.deepEqual(W.recordEdit(p, call, 'due', '2026-10-30').item, { who: 'Ana Ruiz · 2026-10-30, 11:00 AM' }, 'the day in the style the list writes days, the time kept');
  const van = recs.find((r) => r.title === 'Book the van');
  assert.equal(van.fields.owner, 'Ana Ruiz');
  assert.deepEqual(W.recordEdit(p, van, 'owner', 'Dee Moss').item, { who: 'Dee Moss with Ben Ito (driver)' });
  const signs = recs.find((r) => r.title === 'Order the signs');
  assert.match(W.recordEdit(p, signs, 'owner', 'Ana Ruiz').body, /- \[ \] Order the signs — Ana Ruiz with the printer · by 2026-11-01/);
});

test('a table numbered in its first column is named by the next, and other tables’ rows aren’t “hidden”', () => {
  const text = `---\ntype: project\n---\n# Desk\n\n## Today\n\n| # | What | Why |\n| --- | --- | --- |\n| 1 | Call the bank | Card expired |\n| 2 | Pay the rent | Due today |\n\n## Register\n\n| Item | Status |\n| --- | --- |\n| Chair | ok |\n`;
  const p = P.parseProject(text, 'D.md');
  const recs = R.projectRecords({ path: 'D.md', project: p, today: TODAY });
  const today = recs.filter((r) => r.kind === 'item' && r.fields.table === 'Today');
  assert.deepEqual(today.map((r) => r.title), ['Call the bank', 'Pay the rent']);
  assert.equal(today[0].fields.why, 'Card expired');
  assert.equal(today[0].fields.what, undefined);
  assert.equal(W.recordEdit(p, today[0], 'title', 'Call the bank today').body.split('\n')[2], '| 1 | Call the bank today | Card expired |');
  const sections = W.resolveWorkspace(recs, p, null);
  const view = sections.find((s) => s.id === 'table:Today').views[0];
  const run = V.runRecordView(recs, view, TODAY);
  assert.deepEqual([run.rows.length, run.hidden], [2, 0]);
});

test('a tracker charts the measure it has a start or target for', () => {
  const log1 = L.parseLog('---\ntype: log\nfields: [Pain]\n---\n## 2026-10-20\n- Pain: 2\n\n## 2026-10-21\n- Pain: 3\n', TODAY);
  log1.path = 'a.md';
  const log2 = L.parseLog('---\ntype: log\nfields: [Weight]\n---\n## 2026-10-21\n- Weight: 101\n', TODAY);
  log2.path = 'b.md';
  const p = P.parseProject('---\ntype: project\nlayout: fitness\n---\n# Fit\n');
  const recs = R.projectRecords({ path: 'F.md', project: p, logs: [log1, log2], today: TODAY });
  const log = W.resolveWorkspace(recs, p, null, { start_weight: 104 }).find((s) => s.id === 'log');
  assert.equal(log.views[0].chart.measure, 'weight');
  assert.equal(W.resolveWorkspace(recs, p, null).find((s) => s.id === 'log').views[0].chart.measure, 'pain');
});
