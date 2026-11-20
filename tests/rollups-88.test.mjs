// node --test tests/rollups-88.test.mjs — rollups (src/shared/views.ts; 8.8 database depth): a view column that
// sums, counts, averages, min/max or lists a field across the records a relation links to — a project's total of its
// tasks' hours, a company's count of deals. Set up in the column menu in plain words; worked out live as notes change.
// Files stay plain Markdown: the relation is [[links]] in a property, the rollup lives in the view file. Made-up bakery notes.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-rollups-'));
let V;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as V from ${JSON.stringify(path.join(root, 'src/shared/views.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'views.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ V } = await import(pathToFileURL(path.join(work, 'views.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const T = Date.parse('2026-10-19T09:00:00');
const note = (p, props = {}) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), mtime: T, tags: [], props });
const bakery = () => [
  note('Bakery/Pie week.md', { tasks: ['[[Bake the pies]]', '[[Price the pies]]'] }),
  note('Bakery/Bake the pies.md', { hours: 6, cost: 40 }),
  note('Bakery/Price the pies.md', { hours: 2, cost: 12 }),
  note('Bakery/Quiet week.md', {}),
];
const rollupDef = (rollups) => ({ ...V.defaultView(), columns: ['tasks', ...Object.keys(rollups).map((n) => `rollup.${n}`)], rollups });
const cell = (rows, title, key) => V.valueOf(rows.find((r) => r.title === title), key);

test('a rollup file is read however it was left, and written back with only what was chosen', () => {
  const { def, problem } = V.readView(JSON.stringify({ source: { kind: 'all' }, layout: 'table', columns: ['tasks', 'rollup.Total hours'], rollups: { 'Total hours': { relation: 'tasks', field: 'hours', op: 'sum' }, Broken: { relation: '', field: 'hours', op: 'sum' }, Odd: { relation: 'tasks', field: 'hours', op: 'sideways' } } }));
  assert.equal(problem, null);
  assert.deepEqual(def.rollups, { 'Total hours': { relation: 'tasks', field: 'hours', op: 'sum' } }, 'a rollup without a relation or a way to add up is left out');
  assert.deepEqual(V.readView(V.writeView(def)).def.rollups, def.rollups);
  assert.ok(!('rollups' in JSON.parse(V.writeView(V.defaultView()))), 'nothing chosen, nothing written');
  assert.equal(V.columnLabel(def, 'rollup.Total hours'), 'Total hours');
});

test('a view column sums, counts, averages, min/max and lists across the linked records', () => {
  const def = rollupDef({ Total: { relation: 'tasks', field: 'hours', op: 'sum' }, Howmany: { relation: 'tasks', field: 'file.title', op: 'count' }, Avg: { relation: 'tasks', field: 'hours', op: 'average' }, Smallest: { relation: 'tasks', field: 'hours', op: 'min' }, Largest: { relation: 'tasks', field: 'hours', op: 'max' }, Costs: { relation: 'tasks', field: 'cost', op: 'list' } });
  const rows = V.runView(def, bakery());
  assert.equal(cell(rows, 'Pie week', 'rollup.Total'), 8);
  assert.equal(cell(rows, 'Pie week', 'rollup.Howmany'), 2);
  assert.equal(cell(rows, 'Pie week', 'rollup.Avg'), 4);
  assert.equal(cell(rows, 'Pie week', 'rollup.Smallest'), 2);
  assert.equal(cell(rows, 'Pie week', 'rollup.Largest'), 6);
  assert.deepEqual(cell(rows, 'Pie week', 'rollup.Costs'), ['40', '12']);
  assert.equal(cell(rows, 'Quiet week', 'rollup.Total'), undefined, 'nothing linked, nothing added up');
  assert.equal(cell(rows, 'Quiet week', 'rollup.Howmany'), 0);
});

test('rollups update live as notes change, and unknown links are left out', () => {
  const def = rollupDef({ Total: { relation: 'tasks', field: 'hours', op: 'sum' } });
  const first = bakery();
  assert.equal(cell(V.runView(def, first), 'Pie week', 'rollup.Total'), 8);
  const changed = bakery();
  changed[1].props.hours = 10;
  assert.equal(cell(V.runView(def, changed), 'Pie week', 'rollup.Total'), 12, 'an hour changed, the total follows');
  const grown = bakery();
  grown[0].props.tasks.push('[[Serve the pies]]');
  grown.push(note('Bakery/Serve the pies.md', { hours: 1 }));
  assert.equal(cell(V.runView(def, grown), 'Pie week', 'rollup.Total'), 9, 'a task joined, the total follows');
  const strange = bakery();
  strange[0].props.tasks.push('[[Nobody wrote this]]');
  assert.equal(cell(V.runView(def, strange), 'Pie week', 'rollup.Total'), 8, 'a link to nothing adds nothing');
});

test('a rollup is made and taken away like a formula column', () => {
  const def = V.defaultView();
  const made = V.withRollup(def, 'Total hours', { relation: 'tasks', field: 'hours', op: 'sum' });
  assert.deepEqual(made.rollups, { 'Total hours': { relation: 'tasks', field: 'hours', op: 'sum' } });
  assert.deepEqual(made.columns, ['rollup.Total hours'], 'a new rollup shows as the last column');
  assert.throws(() => V.withRollup({ ...def, ...made }, 'Total hours', { relation: 'tasks', field: 'cost', op: 'sum' }), /already a rollup/);
  const next = { ...def, ...made, summaries: { 'rollup.Total hours': 'sum' }, labels: { 'rollup.Total hours': 'Hours' } };
  const gone = V.withoutRollup(next, 'Total hours');
  assert.deepEqual(gone.rollups, {});
  assert.deepEqual(gone.columns, []);
  assert.deepEqual(gone.summaries, {}, 'its summary goes with it');
  assert.deepEqual(gone.labels, {}, 'and its heading');
  const renamed = V.withRollup({ ...def, ...made }, 'Hours altogether', { relation: 'tasks', field: 'hours', op: 'sum' }, 'Total hours');
  assert.deepEqual(renamed.columns, ['rollup.Hours altogether'], 'a renamed rollup keeps its column');
});
