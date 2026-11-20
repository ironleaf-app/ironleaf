// node --test tests/v10record-computed.test.mjs — record rooms show worked-out columns (10.0 Endless Tech,
// v10records2, plan item 17 screens 2): the record table shows a formula's and a rollup's answers and sums its
// columns up underneath; a formula, a rollup across a link and a summary are made and changed from the column menu
// and the Fields panel, in plain words. Made-up tasks and hours.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-v10computed-'));
let RV;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/record-views.ts'), platform: 'node', output: { file: path.join(work, 'record-views.mjs'), format: 'esm' }, logLevel: 'silent' });
  RV = await import(pathToFileURL(path.join(work, 'record-views.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const rec = (id, title, fields) => ({ id, kind: 'action', title, fields });
const records = [rec('a', 'Soil the beds', { hours: 2, qty: 3 }), rec('b', 'Plant garlic', { hours: 4, qty: 5 }), rec('c', 'Mulch', {})];
const base = { kinds: ['action'], layout: 'table', fields: ['hours'], sort: undefined, filters: [], summaries: undefined, viewSlug: 'test' };

test('a formula is worked out per record and read as a column', () => {
  const run = RV.runRecordView(records, { ...base, fields: ['hours', 'formula.Double'], formulas: { Double: 'hours * 2' } });
  assert.equal(run.computed.a.Double, 4);
  assert.equal(run.computed.b.Double, 8);
  assert.equal(run.computed.c.Double, 0, 'no hours reads as 0');
  const sorted = RV.runRecordView(records, { ...base, fields: ['hours', 'formula.Double'], formulas: { Double: 'hours * 2' }, sort: { field: 'formula.Double', dir: 'desc' } });
  assert.deepEqual(sorted.rows.map((r) => r.id), ['b', 'a', 'c'], 'sorts by the formula');
});

test('the table sums its columns up in plain words', () => {
  const sums = RV.recordSummaries(records, { ...base, summaries: { hours: 'sum' } });
  assert.equal(sums.hours.value, 6);
  assert.ok(sums.hours.label && !/[—–]/.test(sums.hours.label));
  const count = RV.recordSummaries(records, { ...base, summaries: { title: 'count' } });
  assert.equal(count.title.value, 3);
});

test('the record table draws worked-out columns and the row that sums them up', () => {
  const layouts = src('src/renderer/src/views/workspace/RecordLayouts.tsx');
  assert.ok(layouts.includes('ComputedValue'), 'worked-out values shown');
  assert.ok(layouts.includes('FieldCell'), 'every layout shows them');
  assert.ok(layouts.includes('SummaryCell'), 'summary row under the table');
  assert.ok(layouts.includes('Sum up') || layouts.includes('Summary'), 'summary in plain words');
  assert.ok(layouts.includes('computedOf'), 'reads the run, not the file field');
  assert.ok(!/DeepSeek|\bDSH\b|pi-ai/i.test(layouts), 'no engine names');
});

test('the column menu changes a formula, a rollup and a summary in plain words', () => {
  const layouts = src('src/renderer/src/views/workspace/RecordLayouts.tsx');
  assert.ok(layouts.includes('Change the formula'), 'change the formula');
  assert.ok(layouts.includes('Remove the formula'), 'remove the formula');
  assert.ok(layouts.includes('Change the rollup'), 'change the rollup');
  assert.ok(layouts.includes('Remove the rollup'), 'remove the rollup');
  assert.ok(layouts.includes('New formula column'), 'new formula from the add menu');
  assert.ok(layouts.includes('New rollup column'), 'new rollup from the add menu');
  assert.ok(layouts.includes('Hide this column'), 'hide in plain words');
  for (const words of ['Change the formula', 'Remove the formula', 'Change the rollup', 'Remove the rollup', 'New formula column', 'New rollup column']) assert.ok(!/[—–]/.test(words));
});

test('the Fields panel offers worked-out columns and the editors open from the room', () => {
  const view = src('src/renderer/src/views/workspace/RecordView.tsx');
  assert.ok(view.includes('New formula column') && view.includes('New rollup column'), 'Fields panel offers both');
  assert.ok(view.includes('openRecordFormulaEditor') && view.includes('openRecordRollupEditor'));
  const app = src('src/renderer/src/App.tsx');
  assert.ok(app.includes('RecordFormulaEditorHost') && app.includes('RecordRollupEditorHost'), 'one editor for the window');
  assert.ok(src('src/renderer/src/views/workspace/recordColumns.ts').includes('withRecordFormula'));
  assert.ok(src('src/renderer/src/views/workspace/recordColumns.ts').includes('withRecordRollup'));
  assert.ok(src('src/renderer/src/views/workspace/recordColumns.ts').includes('withRecordSummary'));
});

test('worked-out column names are the person’s own, and summaries read numbers as numbers', () => {
  const helpers = src('src/renderer/src/views/workspace/recordColumns.ts');
  assert.ok(helpers.includes('recordColumnLabel'), 'headings strip formula./rollup.');
  assert.ok(helpers.includes('recordSummaryChoices'), 'summaries that make sense per kind');
  assert.ok(helpers.includes('computedKind'), 'computed kind sampled, never guessed');
});
