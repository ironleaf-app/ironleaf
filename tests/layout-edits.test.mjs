// node --test tests/layout-edits.test.mjs — editing a project's dashboard in place (22 Oct 2026, docs/LAYOUTS.md): one
// table cell, one tick box, one log field or note changed and every other character of the words kept; rows taken out,
// moved and put in order; a tick box's words, who and when; a run-sheet phase renamed; the blocks carrying the row each
// card or line came from; a risks table's owner and status edited, closed by its status and reopened; a list put in
// date order; and a section's change said in its own words. Neutral notes only: a bakery fit-out, a choir's concert, a
// canoe club's boats, a reading habit.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-layout-edits-'));
let L, P, F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  for (const [name, file] of [['l', 'src/shared/layouts.ts'], ['p', 'src/shared/project-file.ts'], ['f', 'src/shared/frontmatter.ts']])
    await build({ input: path.join(root, file), platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
  [L, P, F] = await Promise.all(['l', 'p', 'f'].map((n) => import(pathToFileURL(path.join(work, `${n}.mjs`)).href)));
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = new Date(2026, 9, 22); // Thu 22 Oct 2026
/** The lines two texts (of as many lines) differ on: [before, after]. */
function changed(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  assert.equal(y.length, x.length, 'as many lines as before');
  const out = [];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) out.push([x[i], y[i]]);
  return out;
}

const STREAMS = `Where each part of the fit-out stands.

| Workstream | Owner | Status | Progress | Next step |
| --- | --- | --- | --- | --- |
| Ovens | Priya Shah | on track | 60 | Gas fitter on Monday |
| Counter and display | | at risk | | Joinery quote |
|  |  |  |  |  |
| Signage | Tom Reid | done | 100% | |

A note under the table.`;

test('a table cell changed: only that cell, its padding kept; an empty cell filled and emptied as "| |"', () => {
  assert.deepEqual(L.tableRowLines(STREAMS), [4, 5, 7], 'rows as readTable counts them (a blank row is skipped)');
  const a = L.setTableCell(STREAMS, 1, 2, 'off track');
  assert.deepEqual(changed(STREAMS, a), [['| Counter and display | | at risk | | Joinery quote |', '| Counter and display | | off track | | Joinery quote |']]);
  const b = L.setTableCell(STREAMS, 1, 1, 'Sam Ng');
  assert.deepEqual(changed(STREAMS, b), [['| Counter and display | | at risk | | Joinery quote |', '| Counter and display | Sam Ng | at risk | | Joinery quote |']]);
  const c = L.setTableCell(STREAMS, 0, 4, '');
  assert.equal(c.split('\n')[4], '| Ovens | Priya Shah | on track | 60 | |');
  assert.equal(L.readTable(L.setTableCell(STREAMS, 2, 0, 'Signs | and boards')).rows[2][0], 'Signs | and boards', 'a pipe in the words is escaped and read back');
  assert.equal(L.setTableCell(STREAMS, 9, 0, 'x'), STREAMS, 'a row that isn’t there: the words as they were');
  // A short row gets the cells up to the one set.
  const short = '| Item | Stage | Owner |\n| --- | --- | --- |\n| Flyers | Draft |';
  assert.equal(L.setTableCell(short, 0, 2, 'Ana'), '| Item | Stage | Owner |\n| --- | --- | --- |\n| Flyers | Draft | Ana |');
  // Several cells of one row at once (marking a workstream done).
  const done = L.setTableCells(STREAMS, 0, { 2: 'done', 3: '100' });
  assert.deepEqual(changed(STREAMS, done), [['| Ovens | Priya Shah | on track | 60 | Gas fitter on Monday |', '| Ovens | Priya Shah | done | 100 | Gas fitter on Monday |']]);
});

test('rows taken out, moved and put in order; the lines around them stay put', () => {
  const gone = L.removeTableRow(STREAMS, 1);
  assert.equal(gone.split('\n').length, STREAMS.split('\n').length - 1);
  assert.ok(!gone.includes('Counter and display') && gone.includes('A note under the table.'));
  const moved = L.moveTableRow(STREAMS, 2, 0);
  assert.deepEqual(L.readTable(moved).rows.map((r) => r[0]), ['Signage', 'Ovens', 'Counter and display']);
  assert.equal(moved.split('\n')[6], '|  |  |  |  |  |', 'the blank row stays where it was');
  assert.equal(L.orderTableRows(STREAMS, [0, 1]), STREAMS, 'an order that isn’t every row changes nothing');
  assert.equal(L.moveTableRow(STREAMS, 0, 0), STREAMS);
});

test('a day in the style of the days around it', () => {
  assert.equal(L.dayInStyle('2026-11-30', ['2026-10-01', '2026-10-12']), '2026-11-30');
  assert.equal(L.dayInStyle('2026-11-30', ['1 Oct 2026', '']), '30 Nov 2026');
  assert.equal(L.dayInStyle('2026-11-30', []), '30 Nov 2026');
});

test('a tick box’s words, who and when: read, and each changed with the rest of its tail as written', () => {
  assert.deepEqual(L.itemParts('Book the hall — Ana Lopez · by 2026-11-30'), { what: 'Book the hall', who: 'Ana Lopez', when: '2026-11-30', by: true });
  assert.deepEqual(L.itemParts('Programmes printed — 9 Sep'), { what: 'Programmes printed', who: '', when: '9 Sep', by: false });
  assert.deepEqual(L.itemParts('Tune the piano — Unassigned (Ana to confirm)'), { what: 'Tune the piano', who: 'Unassigned (Ana to confirm)', when: '', by: false });
  assert.equal(L.withItemParts('Book the hall — Ana Lopez · by 2026-11-30', { what: 'Book the town hall' }), 'Book the town hall — Ana Lopez · by 2026-11-30');
  assert.equal(L.withItemParts('Book the hall — Ana Lopez · by 2026-11-30', { when: '2026-12-02' }), 'Book the hall — Ana Lopez · by 2026-12-02');
  assert.equal(L.withItemParts('Book the hall — Ana Lopez · by 2026-11-30', { who: 'Ben' }), 'Book the hall — Ben · by 2026-11-30');
  assert.equal(L.withItemParts('Book the hall — Ana Lopez · by 2026-11-30', { who: '' }), 'Book the hall — by 2026-11-30');
  assert.equal(L.withItemParts('Book the hall', { who: 'Ben', when: '2026-12-02' }), 'Book the hall — Ben · by 2026-12-02');
  assert.equal(L.withItemParts('Programmes printed — 9 Sep', { when: '10 Sep' }), 'Programmes printed — 10 Sep', 'a day written without "by" stays without it');
  assert.equal(L.withItemParts('Book the hall — Ana', { who: '', when: '' }), 'Book the hall');
});

const SHEET = `### Six weeks out

- [ ] Book the hall — Ana · by 2026-11-30
  - the one on Rose Street
- [x] Choose the songs
- [ ] Order programmes

### Concert night ###

- [ ] Doors at 7`;

test('run sheet: a box’s words changed, taken out with its lines, moved, and a phase renamed', () => {
  const a = L.setRunSheetItem(SHEET, 2, { what: 'Book the church hall' });
  assert.deepEqual(changed(SHEET, a), [['- [ ] Book the hall — Ana · by 2026-11-30', '- [ ] Book the church hall — Ana · by 2026-11-30']]);
  const b = L.setRunSheetItem(SHEET, 5, { who: 'Kim' });
  assert.equal(b.split('\n')[5], '- [ ] Order programmes — Kim');
  assert.equal(L.setRunSheetItem(SHEET, 0, { what: 'x' }), SHEET, 'a line that isn’t a box: unchanged');
  const gone = L.removeRunSheetItem(SHEET, 2);
  assert.ok(!gone.includes('Book the hall') && !gone.includes('Rose Street') && gone.includes('- [x] Choose the songs'));
  const moved = L.moveRunSheetItem(SHEET, 5, 2);
  assert.deepEqual(moved.body.split('\n').slice(2, 6), ['- [ ] Order programmes', '- [ ] Book the hall — Ana · by 2026-11-30', '  - the one on Rose Street', '- [x] Choose the songs']);
  assert.equal(moved.line, 2);
  const down = L.moveRunSheetItem(SHEET, 2, 4, true);
  assert.deepEqual(down.body.split('\n').slice(2, 6), ['- [x] Choose the songs', '- [ ] Book the hall — Ana · by 2026-11-30', '  - the one on Rose Street', '- [ ] Order programmes']);
  assert.equal(down.line, 3);
  assert.equal(L.runSheet(SHEET)[1].line, 7, 'a phase knows its heading’s line');
  const renamed = L.renameRunSheetPhase(SHEET, 1, 'On the night');
  assert.deepEqual(changed(SHEET, renamed), [['### Concert night ###', '### On the night ###']]);
  assert.deepEqual(changed(SHEET, L.renameRunSheetPhase(SHEET, 0, 'Five weeks out')), [['### Six weeks out', '### Five weeks out']]);
});

const LOG = `---
type: log
project: Reading habit
fields: [Pages]
units: {Pages: pages}
---
# Reading log

Format: \`- Read: Y\`, \`- Pages:\`, notes as bullets.

## Tue 20 Oct 2026
- Read: Y
- **Pages:** 30 pages
- On the train

## Wed 21 Oct 2026, Day 2
- Read: N (too tired)
- Bed early
`;

test('a log field set where it is (bold kept), added under the day’s fields, taken off; a new day made when needed', () => {
  const a = L.setLogValue(LOG, '2026-10-20', 'Pages', '42 pages', TODAY);
  assert.deepEqual(changed(LOG, a), [['- **Pages:** 30 pages', '- **Pages:** 42 pages']]);
  const b = L.setLogValue(LOG, '2026-10-21', 'read', 'Y', TODAY);
  assert.deepEqual(changed(LOG, b), [['- Read: N (too tired)', '- Read: Y']], 'the field matched whatever its case');
  const c = L.setLogValue(LOG, '2026-10-21', 'Pages', '12 pages', TODAY);
  assert.deepEqual(c.split('\n').slice(15, 19), ['## Wed 21 Oct 2026, Day 2', '- Read: N (too tired)', '- Pages: 12 pages', '- Bed early']);
  const d = L.setLogValue(LOG, '2026-10-20', 'Pages', null, TODAY);
  assert.ok(!d.includes('30 pages') && d.split('\n').length === LOG.split('\n').length - 1);
  const e = L.setLogValue(LOG, '2026-10-22', 'Read', 'Y', TODAY);
  assert.ok(/## Thu 22 Oct 2026\n\n- Read: Y\n$/.test(e), 'a day not written yet gets its entry, in date order');
  assert.equal(L.parseLog(e, TODAY).entries.at(-1).values.Read.yes, true);
  assert.equal(L.setLogValue(LOG, '2026-10-22', 'Read', null, TODAY), LOG, 'nothing to take off: unchanged');
});

test('a log note changed or taken off, counted as parseLog counts them', () => {
  const notes = L.parseLog(LOG, TODAY).entries[0].notes;
  assert.deepEqual(notes, ['On the train']);
  const a = L.setLogNote(LOG, '2026-10-20', 0, 'On the tram', TODAY);
  assert.deepEqual(changed(LOG, a), [['- On the train', '- On the tram']]);
  const b = L.setLogNote(LOG, '2026-10-21', 0, null, TODAY);
  assert.ok(!b.includes('Bed early'));
  assert.equal(L.setLogNote(LOG, '2026-10-21', 3, 'x', TODAY), LOG);
});

const PROJECT = `---
type: project
layout: programme
status: active
health: at risk
budget: A$40k
---
# Bakery fit-out

## Summary

A new bakery on Rose Street.

## Workstreams

${STREAMS}

## Key dates

| Date | Milestone | Status |
| --- | --- | --- |
| 2026-12-01 | Doors open | next |
| 2026-11-02 | Ovens in | |
| 2026-11-20 | Signage up | |

## Risks and issues

| Risk | Impact | Owner | Status |
| --- | --- | --- | --- |
| Gas connection late | High | | Open |
| Joinery over budget | Medium | Priya Shah | Watching |

## Notes
`;

test('the blocks carry where each card and line came from, so the page edits it where it is', () => {
  const project = P.parseProject(PROJECT, 'Projects/Bakery fit-out/Bakery fit-out.md');
  const props = F.readProps(PROJECT);
  const models = L.dashboard({ project, props, logs: [], today: TODAY });
  const streams = models.find((m) => m.type === 'progress');
  assert.deepEqual(streams.rows.map((r) => [r.name, r.row]), [['Ovens', 0], ['Counter and display', 1], ['Signage', 2]]);
  assert.deepEqual(streams.cols, { name: 0, owner: 1, status: 2, progress: 3, next: 4 });
  const timeline = models.find((m) => m.type === 'timeline');
  assert.deepEqual(timeline.items.map((x) => [x.what, x.index]), [['Ovens in', 1], ['Signage up', 2], ['Doors open', 0]], 'shown by date, each with its place in the file');
  const status = models.find((m) => m.type === 'status');
  assert.deepEqual(status.facts.find((f) => f.key === 'budget'), { key: 'budget', label: 'Budget', value: 'A$40k', raw: 'A$40k', kind: 'text' });
  // A board and a grid from a section's table, and contact cards.
  const board = L.blockModel({ type: 'board', arg: 'Workstreams' }, { project, props, logs: [], today: TODAY });
  assert.deepEqual(board.columns.map((c) => [c.stage, c.value, c.items.map((x) => x.row)]), [['On track', 'on track', [0]], ['At risk', 'at risk', [1]], ['Done', 'done', [2]]]);
  assert.equal(board.cols.stage, 2);
  const grid = L.blockModel({ type: 'grid', arg: 'Workstreams' }, { project, props, logs: [], today: TODAY });
  assert.equal(grid.source, 'section');
  assert.equal(L.blockModel({ type: 'grid', arg: 'Key dates' }, { project, props, logs: [], today: TODAY }).source, 'dates');
});

test('a risks table: owner and status edited where they are, a "Closed" status closes it, reopening says Open', () => {
  const p = P.parseProject(PROJECT);
  P.applyProjectEdit(p, { kind: 'change', list: 'risks', index: 0, item: { owner: 'Tom Reid' } }, '22 Oct 2026');
  let text = P.serializeProject(p, PROJECT);
  assert.deepEqual(changed(PROJECT, text), [['| Gas connection late | High | | Open |', '| Gas connection late | High | Tom Reid | Open |']]);
  const q = P.parseProject(text);
  P.applyProjectEdit(q, { kind: 'change', list: 'risks', index: 1, item: { status: 'Mitigating' } }, '22 Oct 2026');
  text = P.serializeProject(q, text);
  assert.ok(text.includes('| Joinery over budget | Medium | Priya Shah | Mitigating |'));
  const r = P.parseProject(text);
  assert.equal(P.applyProjectEdit(r, { kind: 'change', list: 'risks', index: 1, item: { status: 'Closed 22 Oct 2026' } }, '22 Oct 2026'), 'Changed a risk.');
  assert.equal(r.risks[1].closed, true);
  text = P.serializeProject(r, text);
  assert.ok(text.includes('| Joinery over budget | Medium | Priya Shah | Closed 22 Oct 2026 |'));
  const s = P.parseProject(text);
  P.applyProjectEdit(s, { kind: 'change', list: 'risks', index: 1, item: { closed: false } }, '22 Oct 2026');
  P.applyProjectEdit(s, { kind: 'change', list: 'risks', index: 0, item: { owner: '' } }, '22 Oct 2026');
  text = P.serializeProject(s, text);
  assert.ok(text.includes('| Joinery over budget | Medium | Priya Shah | Open |'), 'reopened');
  assert.ok(text.includes('| Gas connection late | High | | Open |'), 'an owner taken off empties the cell');
});

test('a list put in a new order, and a section’s change said in its own words', () => {
  const p = P.parseProject(PROJECT);
  assert.equal(P.applyProjectEdit(p, { kind: 'order', list: 'dates', order: [1, 2, 0] }), 'Put the key dates in date order.');
  const text = P.serializeProject(p, PROJECT);
  assert.ok(text.includes('| 2026-11-02 | Ovens in | |\n| 2026-11-20 | Signage up | |\n| 2026-12-01 | Doors open | next |'));
  assert.throws(() => P.applyProjectEdit(p, { kind: 'order', list: 'dates', order: [0, 0, 1] }));
  assert.equal(P.applyProjectEdit(p, { kind: 'order', list: 'dates', order: [0, 1, 2] }), 'Nothing moved.');
  const body = L.setTableCell(L.sectionText(p, 'Workstreams'), 0, 2, 'at risk');
  assert.equal(P.applyProjectEdit(p, { kind: 'section', heading: 'Workstreams', body, words: 'Set Ovens to At risk.' }), 'Set Ovens to At risk.');
  // The whole file written back: only the changed cell and line differ from what was there.
  const q = P.parseProject(PROJECT);
  P.applyProjectEdit(q, { kind: 'section', heading: 'Workstreams', body: L.setTableCell(L.sectionText(q, 'Workstreams'), 1, 3, '25') });
  assert.deepEqual(changed(PROJECT, P.serializeProject(q, PROJECT)), [['| Counter and display | | at risk | | Joinery quote |', '| Counter and display | | at risk | 25 | Joinery quote |']]);
});

test('a section replaced by a caller with a new object (heading and body only) keeps its place; a new one goes last', () => {
  const text = `---
type: project
---
# Tide clock

## Summary

A small clock that shows the tide.

## Documents

- \`src/tide.ts\` — The tide sums

## How it works

Node, with the sums in src/tide.ts.

## How to run it

npm test runs the tests.

## Notes

Mine.
`;
  const p = P.parseProject(text);
  // As the former host app's save does it: the changed section written back as a new object without
  // its place.
  const at = p.extra.findIndex((x) => x.heading === 'How it works');
  p.extra[at] = { heading: 'How it works', body: 'Node; moon phases in src/moon.ts too.' };
  const out = P.serializeProject(p, text);
  assert.deepEqual(P.parseProject(out).extra.map((x) => x.heading), ['How it works', 'How to run it'], 'the order stays');
  assert.equal(out, text.replace('Node, with the sums in src/tide.ts.', 'Node; moon phases in src/moon.ts too.'), 'and only its words change');
  // A section that wasn't there goes after the known ones, as before.
  const q = P.parseProject(out);
  q.extra.push({ heading: 'Parts list', body: 'A Pi Zero.' });
  assert.ok(/## Notes\n\nMine\.\n\n## Parts list\n\nA Pi Zero\.\n$/.test(P.serializeProject(q, out)));
  // A number of the person's own is written as a number.
  const r = P.parseProject(out);
  P.applyProjectEdit(r, { kind: 'prop', key: 'target_weight', value: '110' });
  assert.ok(P.serializeProject(r, out).includes('\ntarget_weight: 110\n'));
});

test('a row added with several empty cells writes each one alike', () => {
  const body = '| Item | Status | Qty | Where | Notes |\n| --- | --- | --- | --- | --- |\n| Kayak | Ready | 2 | Shed | |';
  assert.equal(L.addTableRow(body, [], { Item: 'Paddle', Status: 'Ready', Qty: '6' }).split('\n').at(-1), '| Paddle | Ready | 6 |  |  |');
});
