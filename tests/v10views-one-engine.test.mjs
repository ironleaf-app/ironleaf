// node --test tests/v10views-one-engine.test.mjs — one view engine (10.0 Endless Tech, v10records): the record
// views' charts and seven layouts carried into the views engine, with formulas, summaries and relations working the
// same way over notes and over project records; old files on both sides read as before. Made-up bakery notes and a
// made-up fit-out project.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-v10engine-'));
let V, RV;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const make = async (name, file) => {
    await build({ input: path.join(root, file), platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  V = await make('views', 'src/shared/views.ts');
  RV = await make('recordviews', 'src/shared/record-views.ts');
});
after(() => rmSync(work, { recursive: true, force: true }));

const T = Date.parse('2026-10-19T09:00:00');
const note = (p, props = {}, tags = []) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), mtime: T, tags, props });
const row = (p, props = {}) => ({ path: p, title: p, folder: '', mtime: T, tags: [], props });
const rec = (id, kind, title, fields = {}, links = []) => ({ id, kind, title, fields, links });

const TODAY = new Date(2026, 9, 24);
function actions() {
  return [
    rec('fit::action:1', 'action', 'Order flour', { owner: 'Mia', due: '2026-10-20', status: 'Open', cost: 12 }, ['fit::milestone:1']),
    rec('fit::action:2', 'action', 'Book the electrician', { owner: 'Tama', due: '2026-10-28', status: 'Open', cost: 140 }, []),
    rec('fit::milestone:1', 'milestone', 'Ovens live', { date: '2026-11-02', status: 'Planned', budget: 400 }, []),
  ];
}

test('view files carry the carried layouts, endProp and chart; old files read as before', () => {
  assert.deepEqual(V.ALL_LAYOUTS, ['table', 'cards', 'list', 'board', 'calendar', 'gallery', 'timeline', 'chart', 'map']);
  assert.deepEqual(V.LAYOUTS, ['table', 'cards', 'list', 'board', 'calendar', 'gallery', 'timeline', 'chart', 'map'], 'the rooms draw all nine (v10records2 and the map)');
  const chart = V.readView('{"layout": "chart", "chart": {"type": "donut", "by": "status", "measure": "cost", "agg": "avg", "target": "budget"}}').def;
  assert.equal(chart.layout, 'chart');
  assert.deepEqual(chart.chart, { type: 'donut', by: 'status', measure: 'cost', agg: 'avg', target: 'budget' });
  const timeline = V.readView('{"layout": "timeline", "dateProp": "due", "endProp": "done"}').def;
  assert.equal(timeline.layout, 'timeline');
  assert.equal(timeline.endProp, 'done');
  assert.equal(V.readView('{"layout": "gallery"}').def.layout, 'gallery');
  assert.equal(V.readView('{"chart": {"type": "bars"}}').def.chart, undefined, 'a chart by nothing is no chart');
  const old = V.readView('{"source": {"kind": "tag", "value": "x"}, "layout": "board", "groupBy": "status"}').def;
  assert.equal(old.layout, 'board');
  assert.equal(old.endProp, undefined, 'old files gain nothing');
  assert.equal(old.chart, undefined);
  assert.equal(V.readView('{"layout": "bogus"}').def.layout, 'table', 'unknown layouts still fall back to a table');
  const round = V.readView(V.writeView(chart)).def;
  assert.equal(round.layout, 'chart');
  assert.deepEqual(round.chart, chart.chart);
  assert.ok(!V.writeView(V.defaultView()).includes('endProp'), 'a plain view writes as small as before');
});

test('formulas, summaries and relations work under every carried layout', () => {
  const notes = [note('Bakery/A.md', { kind: 'sweet', cost: 10, links: '[[B]]' }), note('Bakery/B.md', { kind: 'savoury', cost: 4 })];
  for (const layout of V.ALL_LAYOUTS) {
    const def = { ...V.defaultView(), layout, formulas: { Double: 'cost * 2' }, rollups: { Total: { relation: 'links', field: 'cost', op: 'sum' } } };
    const file = V.readView(V.writeView(def)).def;
    assert.equal(file.layout, layout, `${layout} survives its file`);
    const rows = V.runView(file, notes);
    assert.equal(V.valueOf(rows[0], 'formula.Double'), 20, `${layout} works formulas out`);
    assert.equal(V.summarize(rows, 'cost', 'sum').value, 14, `${layout} sums up`);
  }
  const rolled = V.runView({ ...V.defaultView(), layout: 'chart', rollups: { Total: { relation: 'links', field: 'cost', op: 'sum' } } }, notes);
  assert.equal(V.valueOf(rolled[0], 'rollup.Total'), 4, 'a chart still adds up across the relation');
});

test('timelines span days, and charts count, add up and average over notes', () => {
  const rows = [row('A', { due: '2026-10-20', done: '2026-10-22' }), row('B', { due: '2026-10-21' }), row('C', {})];
  const time = V.placeOnTimeline(rows, 'due', 'done');
  assert.deepEqual(time.spans.map((s) => [s.row.title, s.start, s.end]), [['A', '2026-10-20', '2026-10-22'], ['B', '2026-10-21', '2026-10-21']]);
  assert.deepEqual(time.undated.map((r) => r.title), ['C']);
  assert.deepEqual(V.timelineSpan(row('X', { due: '2026-10-22', done: '2026-10-20' }), 'due', 'done'), { start: '2026-10-22', end: '2026-10-22' }, 'a backwards range shows as its start day');
  assert.equal(V.timelineSpan(row('Y', {}), 'due', 'done'), null);

  const sales = [row('A', { status: 'Done', cost: 10, budget: 12 }), row('B', { status: 'Done', cost: 4, budget: 4 }), row('C', { status: 'Planned', cost: 6 })];
  const counted = V.chartData(sales, { type: 'bar', by: 'status', measure: 'count' });
  assert.deepEqual(counted.points.map((p) => [p.label, p.value]), [['Planned', 1], ['Done', 2]], 'statuses in the order work moves, as boards order them');
  assert.equal(counted.caption, 'Notes by status');
  assert.equal(counted.unit, 'notes');
  const summed = V.chartData(sales, { type: 'bar', by: 'status', measure: 'cost', target: 'budget' });
  assert.deepEqual(summed.points.map((p) => [p.label, p.value, p.target]), [['Planned', 6, 0], ['Done', 14, 16]]);
  assert.equal(summed.caption, 'Cost by status');
  const avg = V.chartData(sales, { type: 'line', by: 'status', measure: 'cost', agg: 'avg' });
  assert.deepEqual(avg.points.map((p) => [p.label, p.value]), [['Done', 7], ['Planned', 6]], 'a line reads A to Z');
  const dated = V.chartData([row('A', { due: '2026-10-20' }), row('B', { due: '2026-10-21' })], { type: 'bar', by: 'due', measure: 'count' });
  assert.deepEqual(dated.points.map((p) => p.label), ['20 Oct', '21 Oct'], 'days read by day');
  assert.deepEqual(V.suggestChart(sales), { type: 'donut', by: 'status', measure: 'count' });
  assert.deepEqual(V.sharePercents([66, 22, 13]), RV.sharePercents([66, 22, 13]), 'one shares implementation on both doors');
  assert.equal(V.sharePercents([66, 22, 13]).reduce((a, b) => a + b, 0), 100, 'shares add to 100');
});

test('renaming or removing a formula keeps the chart and timeline keys right', () => {
  const def = { ...V.defaultView(), formulas: { Total: 'cost * 2' }, endProp: 'formula.Total', chart: { type: 'bar', by: 'status', measure: 'formula.Total', target: 'budget' } };
  const renamed = V.withFormula(def, 'Sum', 'cost * 2', 'Total');
  assert.equal(renamed.chart.by, 'status');
  assert.equal(renamed.chart.measure, 'formula.Sum', 'the chart follows the rename');
  assert.equal(renamed.endProp, 'formula.Sum');
  const dropped = V.withoutFormula({ ...def, formulas: { Total: 'cost * 2' } }, 'Total');
  assert.equal(dropped.chart.measure, 'count', 'measuring nothing, it counts instead');
  assert.equal(dropped.endProp, undefined);
  const byGone = V.withoutFormula({ ...def, formulas: { Total: 'cost' }, chart: { type: 'bar', by: 'formula.Total', measure: 'count' } }, 'Total');
  assert.equal(byGone.chart, undefined, 'charted by nothing, the chart goes');
});

test('record files carry formulas, summaries and rollups; old files read as before', () => {
  const old = RV.readRecordView('{"title": "Actions", "scope": "project", "kinds": ["action"], "layout": "board", "fields": ["owner"], "groupBy": "status"}').def;
  assert.equal(old.formulas, undefined, 'old files gain nothing');
  assert.equal(old.rollups, undefined);
  assert.equal(old.summaries, undefined);
  const file = RV.readRecordView('{"title": "Actions", "kinds": ["action"], "layout": "table", "fields": [], "formulas": {"Double": "cost * 2"}, "rollups": {"Total": {"relation": "links", "field": "cost", "op": "sum"}}, "summaries": {"cost": "sum", "owner": "bogus"}}').def;
  assert.deepEqual(file.formulas, { Double: 'cost * 2' });
  assert.deepEqual(file.rollups, { Total: { relation: 'links', field: 'cost', op: 'sum' } });
  assert.deepEqual(file.summaries, { cost: 'sum' }, 'what is not a summary is left out');
  const bad = RV.readRecordView('{"kinds": ["action"], "rollups": {"X": {"relation": "links", "field": "cost", "op": "sideways"}}}').def;
  assert.equal(bad.rollups, undefined, 'what is not a way to add up is left out');
  assert.deepEqual(RV.readRecordView(RV.writeRecordView(file)).def.formulas, { Double: 'cost * 2' }, 'round-trips');
  assert.ok(!RV.writeRecordView(RV.defaultRecordView(['action'])).includes('formulas'), 'a plain record view writes as small as before');
});

test('record formulas work out and read everywhere fields read', () => {
  const def = { ...RV.defaultRecordView(['action'], 'table'), formulas: { Double: 'cost * 2', Big: 'cost > 100' }, showDone: true };
  const run = RV.runRecordView(actions(), def, TODAY);
  assert.equal(run.computed['fit::action:1'].Double, 24);
  assert.equal(run.computed['fit::action:2'].Double, 280);
  assert.equal(run.computed['fit::action:2'].Big, true);
  const filtered = RV.runRecordView(actions(), { ...def, filters: [{ field: 'formula.Double', op: 'gt', value: '100' }] }, TODAY);
  assert.deepEqual(filtered.rows.map((r) => r.title), ['Book the electrician'], 'filters read formulas');
  const sorted = RV.runRecordView(actions(), { ...def, sort: { field: 'formula.Double', dir: 'desc' } }, TODAY);
  assert.deepEqual(sorted.rows.map((r) => r.title), ['Book the electrician', 'Order flour'], 'orders read formulas');
  const grouped = RV.runRecordView(actions(), { ...def, groupBy: 'formula.Big' }, TODAY);
  assert.deepEqual(grouped.groups.map((g) => [g.label, g.rows.length]), [['No', 1], ['Yes', 1]], 'groups read formulas');
  const charted = RV.chartData(actions(), { ...def, layout: 'chart', chart: { type: 'bar', by: 'status', measure: 'formula.Double' } }, TODAY);
  assert.deepEqual(charted.points.map((p) => [p.label, p.value]), [['Open', 304]], 'charts measure formulas');
  const plain = RV.runRecordView(actions(), RV.defaultRecordView(['action'], 'table'), TODAY);
  assert.equal(plain.computed, undefined, 'without formulas, the run reads as before');
});

test('record rollups add up across relations, through the one aggregation', () => {
  assert.equal(V.aggregateRollup([12, 140], 'sum'), 152);
  assert.equal(V.aggregateRollup([12, 140], 'average'), 76);
  assert.equal(V.aggregateRollup([12, 140], 'count'), 2);
  const def = { ...RV.defaultRecordView(['action', 'milestone'], 'table'), rollups: { MilestoneBudget: { relation: 'links', field: 'budget', op: 'sum' } }, showDone: true };
  const run = RV.runRecordView(actions(), def, TODAY);
  assert.equal(run.rolled['fit::action:1'].MilestoneBudget, 400, 'across the links to the milestone');
  assert.equal(run.rolled['fit::action:2'].MilestoneBudget, undefined, 'nothing linked, nothing added up');
  const byField = RV.runRecordView(
    [rec('s::action:1', 'action', 'Pay Acme', { supplier: 'Acme Mills', cost: 50 }, []), rec('s::vendor:1', 'vendor', 'Acme Mills', { rating: 4 }, [])],
    { ...RV.defaultRecordView(['action'], 'table'), rollups: { SupplierRating: { relation: 'supplier', field: 'rating', op: 'average' } }, showDone: true },
    TODAY,
  );
  assert.equal(byField.rolled['s::action:1'].SupplierRating, 4, 'a field naming a record by its title resolves it');
  assert.deepEqual(
    RV.linkedRecords(actions()[0], actions()).map((r) => r.title),
    ['Ovens live'],
    'the joins read as records',
  );
});

test('record summaries sum up through the shared machinery', () => {
  const def = { ...RV.defaultRecordView(['action'], 'table'), formulas: { Double: 'cost * 2' }, summaries: { cost: 'sum', 'formula.Double': 'sum', owner: 'unique' } };
  const sums = RV.recordSummaries(actions().filter((r) => r.kind === 'action'), def, TODAY);
  assert.equal(sums.cost.value, 152);
  assert.equal(sums.cost.label, 'Sum');
  assert.equal(sums['formula.Double'].value, 304, 'formulas sum up too');
  assert.equal(sums.owner.value, 2);
  assert.deepEqual(RV.recordSummaries(actions(), RV.defaultRecordView(['action'], 'table'), TODAY), {}, 'without summaries, nothing summed');
});

test('charts and the seven layouts keep working as before', () => {
  for (const layout of RV.RECORD_LAYOUTS) {
    const run = RV.runRecordView(actions(), { ...RV.defaultRecordView(['action', 'milestone'], layout), showDone: true }, TODAY);
    assert.ok(run.rows.length >= 2, `${layout} still runs`);
  }
  const data = RV.chartData(actions(), { ...RV.defaultRecordView(['action'], 'chart'), chart: { type: 'bar', by: 'status', measure: 'count' } }, TODAY);
  assert.deepEqual(data.points.map((p) => [p.label, p.value]), [['Open', 2]]);
  assert.equal(data.caption, 'Actions by status');
  assert.deepEqual(Object.keys(RV.cleanRecordView({ layout: 'nope', kinds: ['nope'] })), ['version', 'title', 'scope', 'kinds', 'layout', 'fields', 'filters'], 'a hand-edited file still opens onto sense');
});
