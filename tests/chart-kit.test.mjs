// node --test tests/chart-kit.test.mjs — the one chart kit (8.0 Phase 5; src/shared/chart-kit.ts), which draws a
// ```chart block in a note (lib/charts.ts), writes one from /chart (editor/insertChart.ts) and is built into the former
// host app
// for make_chart and its dashboards. A chart block says what to chart, never the figures, so it stays true: a month of
// spending by category from the rows of each Spending month's table, by month from their days, projects by status
// counted from their properties, figures someone gave only with where they came from. Also: every module in the
// catalogue has its Set up your life question, how it fills itself and its tour's example. Made-up notes only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-chart-kit-'));
let C, L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'kit.ts');
  writeFileSync(entry, [`export * as C from ${JSON.stringify(path.join(root, 'src/shared/chart-kit.ts'))};`, `export * as L from ${JSON.stringify(path.join(root, 'src/shared/life-modules.ts'))};`].join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'kit.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ C, L } = await import(pathToFileURL(path.join(work, 'kit.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const spend = (month, rows) => ({ path: `Me/Finance/Spending/${month}.md`, title: month, mtime: 1, tags: [], props: { type: 'spending-month', month }, text: `---\ntype: spending-month\n---\n## Spending\n\n| Date | What | Category | Amount | Account | Receipt |\n| --- | --- | --- | --- | --- | --- |\n${rows.map((r) => `| ${r.join(' | ')} |  |  |`).join('\n')}\n` });
const notes = [
  spend('2026-09', [['2026-09-03', 'Coles', 'Groceries', '120.40'], ['2026-09-11', 'BP', 'Fuel', '$80.00']]),
  spend('2026-10', [['2026-10-02', 'Aldi', 'Groceries', '60.00'], ['2026-10-09', 'Netflix', 'Subscriptions', '18.99'], ['2026-10-12', 'Refund', 'Groceries', '(10.00)']]),
  { path: 'Work/Projects/Shopfront/Shopfront.md', title: 'Shopfront', mtime: 1, tags: [], props: { type: 'project', status: 'Doing' } },
  { path: 'Work/Projects/Menu/Menu.md', title: 'Menu', mtime: 1, tags: [], props: { type: 'project', status: 'Done' } },
  { path: 'Work/Projects/Loyalty/Loyalty.md', title: 'Loyalty', mtime: 1, tags: [], props: { type: 'project', status: 'Doing' } },
];

test('a block is read and written as plain settings, and a ring is a pie', () => {
  const block = C.writeChartBlock({ title: 'October by category', type: 'ring', source: { folder: 'Me/Finance/Spending' }, table: 'Spending', by: 'Category', measure: 'Amount' });
  assert.match(block, /^```chart\ntitle: October by category\ntype: pie\nsource:\n {2}folder: Me\/Finance\/Spending\ntable: Spending\nby: Category\nmeasure: Amount\n```$/);
  const { chart, problem } = C.readChartBlock(block.replace(/^```chart\n|\n```$/g, ''));
  assert.equal(problem, null);
  assert.deepEqual(chart, { title: 'October by category', type: 'pie', source: { folder: 'Me/Finance/Spending' }, table: 'Spending', by: 'Category', measure: 'Amount' });
  assert.match(C.readChartBlock('type: bar').problem, /which notes/);
  assert.match(C.readChartBlock('type: bar\nsource:\n  folder: X').problem, /by:/);
  assert.match(C.readChartBlock('type: bar\npoints:\n  - {label: A, value: 3}').problem, /never made up/);
  assert.match(C.readChartBlock('{{{').problem, /can’t be read/);
});

test('spending by category from the rows of every month’s table, refunds taken off', () => {
  const picked = notes.filter((n) => n.path.startsWith('Me/Finance/Spending/'));
  const w = C.workChart({ title: 'By category', type: 'pie', source: { folder: 'Me/Finance/Spending' }, table: 'Spending', by: 'Category', measure: 'Amount' }, picked);
  assert.deepEqual(w.points.map((p) => [p.label, p.value]), [['Groceries', 170.4], ['Fuel', 80], ['Subscriptions', 18.99]]);
  assert.match(w.mermaid, /^pie showData\n {4}title By category\n {4}"Groceries" : 170\.4/);
  assert.equal(w.caption, 'From 5 rows of the Spending tables of the notes in Me/Finance/Spending, the total of Amount by Category.');
});

test('by month, in order, as bars', () => {
  const w = C.workChart({ title: 'Each month', type: 'bar', source: { folder: 'Me/Finance/Spending' }, table: 'Spending', by: 'Date', bucket: 'month', measure: 'Amount' }, notes.slice(0, 2));
  assert.deepEqual(w.points.map((p) => p.label), ['Sep 26', 'Oct 26']);
  assert.match(w.mermaid, /xychart-beta[\s\S]*x-axis \["Sep 26", "Oct 26"\][\s\S]*bar \[200\.4, 68\.99\]/);
});

test('notes counted by a property, picked as a view picks them', () => {
  const view = C.chartSelection({ folder: 'Work/Projects', type: 'project' });
  assert.deepEqual([view.source, view.filters], [{ kind: 'folder', value: 'Work/Projects' }, [{ prop: 'type', op: 'is', value: 'project' }]]);
  const w = C.workChart({ type: 'bar', source: { folder: 'Work/Projects' }, by: 'status' }, notes.slice(2));
  assert.deepEqual(w.points.map((p) => [p.label, p.value]), [['Doing', 2], ['Done', 1]]);
  assert.equal(w.caption, 'From 3 notes in Work/Projects, counted by status.');
});

test('figures someone gave are drawn as given, with where they came from', () => {
  const { chart } = C.cleanChart({ title: 'October', type: 'bar', points: [{ label: 'Groceries', value: '412.50' }], from: 'Finance › Spending, October 2026' });
  const w = C.workChart(chart, []);
  assert.deepEqual(w.points.map((p) => p.value), [412.5]);
  assert.equal(w.caption, 'Figures from Finance › Spending, October 2026.');
});

test('/chart suggests a chart from what the notes hold: a property, else their table', () => {
  assert.deepEqual(C.suggestChart(notes.slice(2), { folder: 'Work/Projects' }), { title: 'Projects by status', type: 'pie', source: { folder: 'Work/Projects' }, by: 'status' });
  const s = C.suggestChart(notes.slice(0, 2), { folder: 'Me/Finance/Spending' });
  assert.deepEqual([s.table, s.by, s.measure, s.type], ['Spending', 'Category', 'Amount', 'pie']);
});

test('every module has its Set up your life question, how it fills itself and its tour’s example', () => {
  for (const m of L.LIFE_MODULES) {
    assert.ok(/\?$/.test(m.ask), `${m.name} asks a question`);
    assert.ok(m.fills.length > 60, `${m.name} says how it fills itself`);
    assert.ok(m.example.title && m.example.lines.length >= 2, `${m.name} has an example for its tour`);
  }
  assert.equal(new Set(L.LIFE_MODULES.map((m) => m.ask)).size, L.LIFE_MODULES.length, 'no two questions alike');
});
