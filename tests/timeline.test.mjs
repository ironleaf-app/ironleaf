// node --test tests/timeline.test.mjs — the timeline's pure parts (src/shared/timeline.ts): dates read as people write
// them, days to x positions and back, the scale, marks packed into lanes without overlapping, clashes and slips found in
// plain words, rows filtered and grouped, a moved date written the way it was, and the whole thing fast with 50
// projects of 30 dates each.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-timeline-'));
let T, P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as T from ${JSON.stringify(path.join(root, 'src/shared/timeline.ts'))};\nexport * as P from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'tl.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ T, P } = await import(pathToFileURL(path.join(work, 'tl.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const D = (y, m, d) => T.dayFrom(y, m - 1, d);
const TODAY = () => D(2026, 10, 17);
const project = (text, file = 'Projects/X/X.md') => T.projectTimeline(file, P.parseProject(text, file), TODAY());

const STUDIO = `---
type: project
status: active
health: at risk
owner: Sam Taylor
started: "2026-09-09"
due: "2026-10-31"
---
# Studio Upgrade

## What’s next

- [ ] Send the reconciliation to finance — Sam Taylor · by 15 Oct
- [ ] Book the speaker fitting — Priya Shah · by 7 Nov
- [ ] Chase the spare microphone stands — Studio hands · by end of month
- [x] Export the device inventory — Sam Taylor · by 1 Oct

## Key dates

| When | What | Status |
| --- | --- | --- |
| 9 Sep 2026 | Scope signed off | done |
| 30 Sep 2026 | First target | missed |
| 24 Oct 2026 | Mixing desk live | on track |
| 10 Oct 2026 | Finance check | — |

## People

- **Priya Shah** — Sound engineer
- **Finance team** — Sign-off

## Decisions

- **14 Oct 2026** — Retired devices are dropped. *Why:* stop chasing them.

## Updates

- **16 Oct 2026** — 8 of 12 soundproofing panels up.
`;
const HARBOUR = `---
type: project
status: planning
health: on track
owner: Priya Shah
started: 2026-10-01
due: 2026-12-12
---
# Harbour Fit-out

## Key dates

| When | What | Status |
| --- | --- | --- |
| 24 Oct 2026 | Lighting quote approved | planned |
| 12 Dec 2026 | Move in | planned |
`;
const BAKERY = `---
type: project
status: active
owner: Alex Lee
due: 2026-10-24
---
# Winter Menu

## Key dates

| When | What | Status |
| --- | --- | --- |
| 24 Oct 2026 | Menu printed | planned |
`;

test('attention reads whole words: "offer" is not off track', () => {
  const probs = { marks: new Map(), list: [], counts: { clash: 0, late: 0, overdue: 0 } };
  assert.equal(T.atRisk({ done: false, health: 'Offer extended', marks: [] }, probs), false);
  assert.equal(T.atRisk({ done: false, health: 'Off track', marks: [] }, probs), true);
  assert.equal(T.atRisk({ done: false, health: 'At risk', marks: [] }, probs), true);
});

test('dates are read as people write them, a date without its year the one nearest today', () => {
  const ref = TODAY();
  assert.equal(T.readDay('2026-10-31', ref), D(2026, 10, 31));
  assert.equal(T.readDay('31 Oct 2026', ref), D(2026, 10, 31));
  assert.equal(T.readDay('31 October 2026', ref), D(2026, 10, 31));
  assert.equal(T.readDay('Oct 31, 2026', ref), D(2026, 10, 31));
  assert.equal(T.readDay('31/10/2026', ref), D(2026, 10, 31), 'day first, as written in Australia');
  assert.equal(T.readDay('by 21 Oct', ref), D(2026, 10, 21));
  assert.equal(T.readDay('Fri 23 Oct', ref), D(2026, 10, 23));
  assert.equal(T.readDay('3 Jan', ref), D(2027, 1, 3), 'early January written in October is next January');
  assert.equal(T.readDay('2 Sept', ref), D(2026, 9, 2));
  for (const words of ['end of month', 'TBC', 'next week', '', undefined, '31 Feb 2026', '2026-13-01', '45/10/2026']) assert.equal(T.readDay(words, ref), null, String(words));
});

test('a moved date is written the way the one it replaces was', () => {
  const day = D(2026, 10, 23);
  assert.equal(T.writeDayLike(day, '2026-10-20'), '2026-10-23');
  assert.equal(T.writeDayLike(day, '20 Oct 2026'), '23 Oct 2026');
  assert.equal(T.writeDayLike(day, '20 Oct'), '23 Oct 2026', 'with its year, so it can never be read as another one');
  assert.equal(T.writeDayLike(day, '20/10/2026'), '23/10/2026');
  assert.equal(T.writeDayLike(day, 'Oct 20, 2026'), 'Oct 23, 2026');
  assert.equal(T.longDay(day), 'Fri 23 Oct 2026');
  assert.equal(T.shortDay(day, TODAY()), '23 Oct');
  assert.equal(T.shortDay(D(2027, 1, 3), TODAY()), '3 Jan 2027');
});

test('a project’s dates: start, due, key dates, next steps by when, decisions and updates; words that aren’t dates counted, never guessed', () => {
  const p = project(STUDIO);
  assert.equal(p.start, D(2026, 9, 9));
  assert.equal(p.due, D(2026, 10, 31));
  const kinds = p.marks.reduce((o, m) => ({ ...o, [m.kind]: (o[m.kind] ?? 0) + 1 }), {});
  assert.deepEqual(kinds, { start: 1, due: 1, date: 4, next: 3, decision: 1, update: 1 });
  assert.equal(p.unread, 1, '“by end of month” isn’t placed');
  assert.deepEqual(p.marks.map((m) => m.day), [...p.marks.map((m) => m.day)].sort((a, b) => a - b), 'in date order');
  const golive = p.marks.find((m) => m.words === 'Mixing desk live');
  assert.equal(golive.index, 2);
  assert.equal(golive.movable, true);
  assert.equal(p.marks.find((m) => m.kind === 'next').movable, false);
  assert.deepEqual(p.people.sort(), ['finance team', 'priya shah', 'sam taylor', 'studio hands']);
});

test('clashes: the person on every project is not a clash by being there; a pair of projects is listed once a day', () => {
  const mk = (name, due, people, dates = '') => project(`---\ntype: project\nstatus: active\nowner: Alex Morgan\ndue: "${due}"\n---\n# ${name}\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n${dates}\n## People\n\n${people.map((x) => `- **${x}** — Team`).join('\n')}\n`, `Projects/${name}/${name}.md`);
  const tessaly = mk('Tessaly', '2026-10-19', ['Sarah Tessaly']);
  const ssl = mk('SSL', '2026-10-19', ['Alejandro Sandi'], '| 19 Oct 2026 | Planned close-out | on track |\n');
  const fed = mk('Elm Square', '2027-01-08', ['Ana Lee', 'Tom Wu'], '| 8 Jan 2027 | Popup opens at Elmwood Square | on track |\n');
  const park = mk('Ashgrove Park', '2027-01-08', ['Ana Lee', 'Tom Wu'], '| 8 Jan 2027 | Popup opens at Ashgrove Park | on track |\n');
  const r = T.findProblems([tessaly, ssl, fed, park], TODAY());
  assert.ok(!tessaly.marks.some((m) => r.marks.get(m.id)?.some((x) => x.kind === 'clash')), 'only Jesse is on both: no clash');
  const clashes = r.list.filter((x) => x.problem.kind === 'clash');
  assert.equal(clashes.length, 1, 'the two popups (four dates on one day) are one line');
  assert.equal(r.counts.clash, 1);
  assert.match(clashes[0].problem.words, /Ana Lee and 1 more are on both/);
  assert.ok(park.marks.filter((m) => m.day === D(2027, 1, 8)).every((m) => r.marks.get(m.id)?.some((x) => x.kind === 'clash')), 'every mark still says what it clashes with');
});

test('clashes: two key dates on the same day in projects that share people, with a plain reason on both', () => {
  const studio = project(STUDIO, 'Projects/Studio/Studio.md');
  const harbour = project(HARBOUR, 'Projects/Harbour/Harbour.md');
  const bakery = project(BAKERY, 'Projects/Bakery/Bakery.md');
  const r = T.findProblems([studio, harbour, bakery], TODAY());
  const golive = studio.marks.find((m) => m.words === 'Mixing desk live');
  const quote = harbour.marks.find((m) => m.words === 'Lighting quote approved');
  assert.match(r.marks.get(golive.id).find((x) => x.kind === 'clash').words, /^Same day as “Lighting quote approved” \(Harbour Fit-out\): Priya Shah is on both\.$/);
  assert.match(r.marks.get(quote.id).find((x) => x.kind === 'clash').words, /Studio Upgrade.*Priya Shah/);
  assert.equal(r.counts.clash, 1, 'one clash, listed once');
  // The bakery's menu is on the same day but shares nobody: no clash.
  assert.ok(!bakery.marks.some((m) => r.marks.get(m.id)?.some((x) => x.kind === 'clash')));
});

test('slips: a next step due after its project, past dates not done; a missed date shows as missed; done things left alone', () => {
  const studio = project(STUDIO);
  const r = T.findProblems([studio], TODAY());
  const words = (w) => r.marks.get(studio.marks.find((m) => m.words === w).id) ?? [];
  assert.deepEqual(words('Book the speaker fitting').map((x) => x.words), ['Due 7 days after the project itself (31 Oct).']);
  assert.deepEqual(words('Send the reconciliation to finance').map((x) => x.words), ['2 days overdue and not ticked off.']);
  assert.deepEqual(words('Export the device inventory'), [], 'a ticked step is never overdue');
  assert.deepEqual(words('Scope signed off'), [], 'a date done is fine');
  assert.deepEqual(words('Finance check').map((x) => x.words), ['Passed 7 days ago and isn’t marked done.']);
  assert.deepEqual(words('First target').map((x) => x.kind), ['slipped']);
  assert.ok(!r.list.some((x) => x.problem.kind === 'slipped'), 'a date already marked missed isn’t listed again');
  assert.deepEqual(r.counts, { clash: 0, late: 1, overdue: 2 });
  // The project itself overdue.
  const late = project(BAKERY.replace('due: 2026-10-24', 'due: 2026-10-14'));
  assert.equal(T.findProblems([late], TODAY()).marks.get(late.marks.find((m) => m.kind === 'due').id)[0].words, 'The project was due 3 days ago.');
  // A done project: nothing.
  const done = project(STUDIO.replace('status: active', 'status: done'));
  assert.equal(T.findProblems([done], TODAY()).list.length, 0);
});

test('days to x and back, at every zoom', () => {
  const from = D(2026, 9, 1);
  for (const zoom of T.ZOOMS) {
    const ppd = T.PX_PER_DAY[zoom];
    for (const day of [from, from + 1, from + 45, from + 400]) {
      const x = T.xOf(day, from, ppd);
      assert.equal(T.dayAt(x, from, ppd), day, `${zoom}: the start of a day is that day`);
      assert.equal(T.dayAt(x + ppd * 0.99, from, ppd), day, `${zoom}: anywhere in a day is that day`);
    }
    assert.equal(T.xOf(from + 7, from, ppd) - T.xOf(from, from, ppd), 7 * ppd);
  }
  assert.ok(T.PX_PER_DAY.weeks > T.PX_PER_DAY.months && T.PX_PER_DAY.months > T.PX_PER_DAY.quarters);
});

test('the span covers every date and today with room, starting on a Monday, a month or a quarter', () => {
  const studio = project(STUDIO);
  const today = TODAY();
  for (const zoom of T.ZOOMS) {
    const { from, to } = T.span([studio], today, zoom);
    assert.ok(from < studio.marks[0].day && to > studio.marks.at(-1).day && from < today && to > today, zoom);
    const { d, weekday } = T.ymd(from);
    if (zoom === 'weeks') assert.equal(weekday, 1, 'weeks start on Monday');
    else assert.equal(d, 1);
    if (zoom === 'quarters') assert.equal(T.ymd(from).m % 3, 0);
  }
});

test('the scale: weeks under months, months under years, quarters under years', () => {
  const from = D(2026, 9, 28), to = D(2027, 1, 31);
  const w = T.ticks(from, to, 'weeks');
  assert.equal(w.minor[0].day, from);
  assert.ok(w.minor.every((t, i) => i === 0 || t.day - w.minor[i - 1].day === 7));
  assert.deepEqual(w.major.map((t) => t.label).slice(0, 3), ['September 2026', 'October 2026', 'November 2026']);
  assert.equal(w.major[0].day, from, 'the first label starts where the view does');
  const m = T.ticks(D(2026, 9, 1), to, 'months');
  assert.deepEqual(m.minor.map((t) => t.label), ['Sep', 'Oct', 'Nov', 'Dec', 'Jan']);
  assert.deepEqual(m.major.map((t) => t.label), ['2026', '2027']);
  const q = T.ticks(D(2026, 7, 1), D(2027, 6, 30), 'quarters');
  assert.deepEqual(q.minor.map((t) => t.label), ['Jul–Sep', 'Oct–Dec', 'Jan–Mar', 'Apr–Jun']);
  assert.deepEqual(T.quarterOf(TODAY()), { from: D(2026, 10, 1), to: D(2026, 12, 31), words: 'Oct–Dec 2026' });
});

test('marks are packed into lanes so none overlap; when the lanes are full they fold into the nearest, never lost', () => {
  const items = [0, 5, 10, 40, 41, 42, 43, 100].map((x, i) => ({ id: `m${i}`, x }));
  const r = T.packMarks(items, 15, 3);
  // In each lane, every pair at least 15 apart.
  const lanes = new Map();
  for (const id of r.shown) (lanes.get(r.lane.get(id)) ?? lanes.set(r.lane.get(id), []).get(r.lane.get(id))).push(items.find((i) => i.id === id).x);
  for (const xs of lanes.values()) xs.sort((a, b) => a - b).forEach((x, i) => i && assert.ok(x - xs[i - 1] >= 15));
  assert.equal(r.lanes, 3);
  const foldedIds = [...r.folded.values()].flat();
  assert.equal(r.shown.length + foldedIds.length, items.length, 'every mark is shown or folded into one shown');
  assert.deepEqual(foldedIds.sort(), ['m6'], 'the fourth at the same spot folds');
  assert.equal(T.packMarks([{ id: 'a', x: 0 }, { id: 'b', x: 100 }], 15).lanes, 1, 'marks far apart share the bar’s line');
  assert.equal(T.packMarks([], 15).lanes, 1);
  // A bar's due date keeps the bar's line; a key date the same day goes just above it instead of hiding under it.
  const due = T.packMarks([{ id: 'date', x: 50 }, { id: 'due', x: 50, fixed: true }, { id: 'next', x: 52 }], 15, 3);
  assert.deepEqual([due.lane.get('due'), due.lane.get('date'), due.lane.get('next')], [0, 1, 2]);
  assert.deepEqual(due.shown.sort(), ['date', 'due', 'next']);
});

test('a row: the bar from start to due, marks above it, history along its foot; taller only when it needs lanes', () => {
  const studio = project(STUDIO);
  const { from } = T.span([studio], TODAY(), 'months');
  const ppd = T.PX_PER_DAY.months;
  const row = T.layoutRow(studio, from, ppd);
  assert.equal(row.bar.open, 'none');
  assert.ok(Math.abs(row.bar.x1 - (T.xOf(studio.start, from, ppd) + ppd / 2)) < 1e-9);
  assert.ok(row.bar.x2 > row.bar.x1);
  assert.equal(row.history.shown.length + [...row.history.folded.values()].flat().length, 2);
  assert.equal(row.height, T.ROW.base + (row.points.lanes - 1) * T.ROW.lane);
  // Only a due date and earlier dates: the bar comes from the earliest, open at its start.
  const bakery = project(BAKERY.replace('24 Oct 2026 | Menu', '1 Oct 2026 | Menu'));
  assert.equal(T.layoutRow(bakery, from, ppd).bar.open, 'start');
  // No dates at all: no bar.
  assert.equal(T.layoutRow(project('---\ntype: project\n---\n# Empty\n'), from, ppd).bar, undefined);
});

test('filters: at risk, mine, this quarter', () => {
  const studio = project(STUDIO, 'a'), harbour = project(HARBOUR, 'b'), bakery = project(BAKERY, 'c');
  const old = project(`---\ntype: project\nstarted: 2025-01-01\ndue: 2025-03-01\n---\n# Old\n`, 'd');
  const all = [studio, harbour, bakery, old];
  const ctx = { problems: T.findProblems(all, TODAY()), today: TODAY(), me: 'Priya Shah' };
  assert.deepEqual(T.filterRows(all, { risk: true }, ctx).map((p) => p.name), ['Studio Upgrade', 'Harbour Fit-out', 'Old'], 'health at risk, a clash, an overdue due date');
  assert.deepEqual(T.filterRows(all, { mine: true }, ctx).map((p) => p.name), ['Studio Upgrade', 'Harbour Fit-out']);
  assert.deepEqual(T.filterRows(all, { mine: true }, { ...ctx, me: '' }).map((p) => p.name), [], 'mine without knowing who you are shows nothing (the page asks)');
  assert.deepEqual(T.filterRows(all, { quarter: true }, ctx).map((p) => p.name), ['Studio Upgrade', 'Harbour Fit-out', 'Winter Menu']);
  assert.deepEqual(T.filterRows(all, { risk: true, mine: true }, ctx).map((p) => p.name), ['Studio Upgrade', 'Harbour Fit-out'], 'filters together');
});

test('groups: by status, by when due, by owner, by health; each sorted', () => {
  const studio = project(STUDIO, 'a'), harbour = project(HARBOUR, 'b'), bakery = project(BAKERY, 'c');
  const none = project(`---\ntype: project\nstatus: done\n---\n# Finished\n`, 'd');
  const rows = [studio, harbour, bakery, none];
  const labels = (g) => g.map((x) => `${x.label}: ${x.rows.map((r) => r.name).join(', ')}`);
  assert.deepEqual(labels(T.groupRows(rows, 'status', 'due', TODAY())), ['Active: Winter Menu, Studio Upgrade', 'Planning: Harbour Fit-out', 'Done: Finished']);
  assert.deepEqual(labels(T.groupRows(rows, 'due', 'name', TODAY())), ['Due this quarter (Oct–Dec 2026): Harbour Fit-out, Studio Upgrade, Winter Menu', 'Done: Finished']);
  assert.deepEqual(labels(T.groupRows(rows, 'owner', 'name', TODAY())), ['Alex Lee: Winter Menu', 'Priya Shah: Harbour Fit-out', 'Sam Taylor: Studio Upgrade', 'No owner: Finished']);
  assert.deepEqual(labels(T.groupRows(rows, 'health', 'name', TODAY())), ['At risk: Studio Upgrade', 'No health set: Winter Menu', 'On track: Harbour Fit-out', 'Done: Finished']);
  assert.deepEqual(labels(T.groupRows(rows, 'none', 'start', TODAY())), ['All projects: Studio Upgrade, Harbour Fit-out, Finished, Winter Menu'], 'no start: by name, after those with one');
});

test('dragging a mark makes one change to its project file, through the page’s own edit, which writes it as it was written', () => {
  const studio = project(STUDIO);
  const golive = studio.marks.find((m) => m.words === 'Mixing desk live');
  const edit = T.moveEdit(golive, D(2026, 10, 27));
  assert.deepEqual(edit, { kind: 'change', list: 'dates', index: 2, item: { when: '27 Oct 2026' } });
  const p = P.parseProject(STUDIO);
  P.applyProjectEdit(p, edit);
  const text = P.serializeProject(p, STUDIO);
  assert.match(text, /\| 27 Oct 2026 \| Mixing desk live \| on track \|/);
  assert.equal(text.replace('27 Oct 2026', '24 Oct 2026').split('\n').filter((l) => l.startsWith('|')).length, STUDIO.split('\n').filter((l) => l.startsWith('|')).length, 'nothing else in the table changes');
  assert.deepEqual(T.moveEdit(studio.marks.find((m) => m.kind === 'due'), D(2026, 11, 7)), { kind: 'set', field: 'due', value: '2026-11-07' });
  assert.deepEqual(T.moveEdit(studio.marks.find((m) => m.kind === 'start'), D(2026, 9, 1)), { kind: 'set', field: 'started', value: '2026-09-01' });
  assert.equal(T.moveEdit(golive, golive.day), null, 'dropped where it was: nothing to write');
  assert.equal(T.moveEdit(studio.marks.find((m) => m.kind === 'next'), D(2026, 11, 1)), null);
  assert.equal(T.moveWords(golive, D(2026, 10, 27), 'Studio Upgrade'), 'Moved “Mixing desk live” to Tue 27 Oct 2026.');
  assert.equal(T.moveWords(studio.marks.find((m) => m.kind === 'due'), D(2026, 11, 7), 'Studio Upgrade'), 'Moved Studio Upgrade’s due date to Sat 7 Nov 2026.');
});

test('fast with 50 projects of 30 dates each', () => {
  const people = ['Sam Taylor', 'Priya Shah', 'Alex Lee', 'Jordan Wu', 'Morgan Ellis', 'Finance team'];
  const texts = Array.from({ length: 50 }, (_, i) => {
    const start = D(2026, 1, 1) + i * 5;
    const iso = (d) => T.isoDay(d);
    const dates = Array.from({ length: 12 }, (_, k) => `| ${T.writeDayLike(start + k * 19 + (i % 7), '1 Jan 2026')} | Milestone ${k + 1} | ${k % 3 ? 'planned' : 'done'} |`).join('\n');
    const next = Array.from({ length: 8 }, (_, k) => `- [${k % 4 ? ' ' : 'x'}] Step ${k + 1} — ${people[(i + k) % 6]} · by ${T.shortDay(start + 120 + k * 9, TODAY())}`).join('\n');
    const decisions = Array.from({ length: 5 }, (_, k) => `- **${T.writeDayLike(start + k * 30, '1 Jan 2026')}** — Decision ${k + 1}.`).join('\n');
    const updates = Array.from({ length: 3 }, (_, k) => `- **${T.writeDayLike(start + k * 41, '1 Jan 2026')}** — Update ${k + 1}`).join('\n');
    return `---\ntype: project\nstatus: active\nhealth: ${['on track', 'at risk', 'off track'][i % 3]}\nowner: ${people[i % 6]}\nstarted: ${iso(start)}\ndue: ${iso(start + 300)}\n---\n# Project ${i + 1}\n\n## What’s next\n\n${next}\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n${dates}\n\n## People\n\n- **${people[(i + 1) % 6]}** — Lead\n\n## Decisions\n\n${decisions}\n\n## Updates\n\n${updates}\n`;
  });
  const t0 = performance.now();
  const rows = texts.map((t, i) => T.projectTimeline(`Projects/P${i}/P${i}.md`, P.parseProject(t), TODAY()));
  assert.equal(rows.reduce((n, r) => n + r.marks.length, 0), 50 * 30);
  const problems = T.findProblems(rows, TODAY());
  for (const zoom of T.ZOOMS) {
    const { from, to } = T.span(rows, TODAY(), zoom);
    T.ticks(from, to, zoom);
    for (const g of T.groupRows(T.filterRows(rows, {}, { problems, today: TODAY() }), 'status', 'due', TODAY())) for (const r of g.rows) T.layoutRow(r, from, T.PX_PER_DAY[zoom]);
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 250, `read, checked and laid out at every zoom in ${ms.toFixed(1)} ms`);
  assert.ok(problems.counts.clash > 0, 'shared people on the same days clash');
});

test('each project as one bar (8.7 wave 2 round 2): its dates on it, its standing beside it, its tint', () => {
  assert.equal(T.monthName(D(2026, 10, 5)), 'October');
  assert.equal(T.barWords(D(2026, 10, 12), D(2026, 11, 20), TODAY()), '12 Oct – 20 Nov');
  assert.equal(T.barWords(D(2026, 10, 17), D(2026, 10, 24), TODAY()), '17 – 24 Oct');
  assert.equal(T.barWords(D(2026, 10, 29), D(2026, 10, 29), TODAY()), '29 Oct');
  assert.equal(T.barWords(D(2026, 12, 12), D(2027, 1, 5), TODAY()), '12 Dec 2026 – 5 Jan 2027');
  const sub = (text) => T.rowSub(project(text), TODAY());
  const tint = (text) => T.barTint(project(text), TODAY());
  assert.equal(sub(STUDIO), 'At risk · due 31 Oct');
  assert.equal(tint(STUDIO), 'amber');
  assert.equal(sub(`---\ntype: project\nstatus: active\nhealth: on track\ndue: "2026-11-06"\n---\n# Milk\n`), 'Doing · due 6 Nov');
  assert.equal(tint(`---\ntype: project\nstatus: active\nhealth: on track\ndue: "2026-11-06"\n---\n# Milk\n`), 'blue');
  assert.equal(sub(`---\ntype: project\nstatus: planning\ndue: "2026-12-18"\n---\n# Lease\n`), 'To do · due 18 Dec');
  assert.equal(tint(`---\ntype: project\nstatus: planning\ndue: "2026-12-18"\n---\n# Lease\n`), 'slate');
  assert.equal(sub(`---\ntype: project\nstatus: active\ndue: "2026-10-01"\n---\n# Late\n`), 'Late · was 1 Oct');
  assert.equal(tint(`---\ntype: project\nstatus: active\ndue: "2026-10-01"\n---\n# Late\n`), 'red');
  assert.equal(sub(`---\ntype: project\nstatus: active\nhealth: off track\ndue: "2026-11-20"\n---\n# Slipping\n`), 'Off track · due 20 Nov');
  assert.equal(tint(`---\ntype: project\nstatus: active\nhealth: off track\ndue: "2026-11-20"\n---\n# Slipping\n`), 'red');
  assert.equal(sub(`---\ntype: project\nstatus: done\ndue: "2026-10-29"\n---\n# Shipped\n`), 'Done · 29 Oct');
  assert.equal(tint(`---\ntype: project\nstatus: done\ndue: "2026-10-29"\n---\n# Shipped\n`), 'green');
  assert.equal(sub(`---\ntype: project\n---\n# Empty\n`), 'No dates yet');
});
