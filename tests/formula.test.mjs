// node --test tests/formula.test.mjs — formulas in views (src/shared/formula.ts; 21 Oct 2026): a small language read by
// hand (never eval), numbers, words, ticks and days worked out as a person expects, functions by name or after a value,
// and anything that can't be worked out coming back as a reason in plain words rather than stopping the view. Then the
// view side (src/shared/views.ts): a formula as a column, an order, a filter and a group, and one formula using another.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-formula-'));
let X, V;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as X from ${JSON.stringify(path.join(root, 'src/shared/formula.ts'))};\nexport * as V from ${JSON.stringify(path.join(root, 'src/shared/views.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'formula.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ X, V } = await import(pathToFileURL(path.join(work, 'formula.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

// Tuesday 21 October 2026, 10:15 in the morning, local time.
const NOW = new Date(2026, 9, 21, 10, 15);
const scope = (props = {}, extra = {}) => ({
  prop: (n) => {
    const k = Object.keys(props).find((x) => x.toLowerCase() === n.toLowerCase());
    return k === undefined ? undefined : props[k];
  },
  file: (f) => ({ title: 'Loyalty cards', folder: 'Bakery/Marketing', modified: new Date(2026, 9, 20, 16, 5).getTime(), tags: ['bakery', 'work/clients'], path: 'Bakery/Marketing/Loyalty cards.md' })[f],
  now: NOW,
  ...extra,
});
const run = (src, props, extra) => X.runFormula(src, scope(props, extra));
const reason = (src, props) => {
  const v = run(src, props);
  assert.ok(X.isFault(v), `${src} should not work out, gave ${JSON.stringify(v)}`);
  return v.reason;
};

test('numbers, words and ticks: arithmetic, comparisons, and/or/not, brackets', () => {
  assert.equal(run('price * quantity', { price: 4.5, quantity: 12 }), 54);
  assert.equal(run('(2 + 3) * 4 - 10 / 4 % 2'), 19.5);
  assert.equal(run('-cost + 1', { cost: 3 }), -2);
  assert.equal(run('"Order " + number', { number: 42 }), 'Order 42');
  assert.equal(run('price + extra', { price: 10 }), 10, 'an empty property counts as nothing in a sum');
  assert.equal(run('a + b'), null, 'two empties stay empty');
  assert.equal(run('status == "done"', { Status: 'Done' }), true, 'words match in any case, a property in any case');
  assert.equal(run('status = "Done" and not paid', { status: 'Done', paid: false }), true, 'a single = and words for and/not');
  assert.equal(run('cost > 100 || urgent', { cost: 140, urgent: false }), true);
  assert.equal(run('cost >= 9.5 && cost < 10', { cost: '9.5' }), true, 'a number written as words compares as a number');
  assert.equal(run('!done', {}), true);
  assert.equal(run('[1, 2, 3][1]'), 2);
  assert.equal(run('note["due date"]', { 'due date': '2026-10-24' }), '2026-10-24');
  assert.equal(run('“curly” + ‘quotes’'), 'curlyquotes', 'quotes copied from a document still read');
});

test('the note’s own fields, by our names and the usual others', () => {
  assert.equal(run('file.title'), 'Loyalty cards');
  assert.equal(run('file.name + " in " + file.folder'), 'Loyalty cards in Bakery/Marketing');
  assert.equal(run('file.modified'), '2026-10-20T16:05', 'a day and time comes out as notes write it');
  assert.equal(run('file.mtime < today()'), true);
  assert.equal(run('file.hasTag("work")'), true, 'a tag counts with the tags under it');
  assert.equal(run('hasTag(file, "#bakery", "x")'), true);
  assert.equal(run('file.inFolder("Bakery")'), true);
  assert.equal(run('file.inFolder("Bake")'), false, 'a folder with a longer name is not inside it');
  assert.equal(run('length(file.tags)'), 2);
  assert.match(reason('file.size'), /Notes have no “file\.size”/);
});

test('functions: if, concat, lower and upper, length, round, min and max, contains, empty', () => {
  assert.equal(run('if(done, "Yes", "Not yet")', { done: true }), 'Yes');
  assert.equal(run('if(done, "Yes")', { done: false }), null);
  assert.equal(run('if(true, 1, 1 / 0)'), 1, 'only the side it needs is worked out');
  assert.equal(run('concat(owner, " · ", stage, 3)', { owner: 'Mia', stage: 'Draft' }), 'Mia · Draft3');
  assert.equal(run('upper(owner) + lower("ABC")', { owner: 'mia' }), 'MIAabc');
  assert.equal(run('owner.upper()', { owner: 'mia' }), 'MIA', 'a function after a value');
  assert.equal(run('length(people) + length("four") + length(none)', { people: ['Mia', 'Tama'] }), 6);
  assert.equal(run('round(2.345, 2)'), 2.35);
  assert.equal(run('round(cost)', { cost: 9.5 }), 10);
  assert.equal(run('min(3, [7, 1], "2")'), 1);
  assert.equal(run('max(due, start)', { due: '2026-10-24', start: '2026-11-02' }), '2026-11-02', 'the later of two days');
  assert.equal(run('contains(tags, "Shop")', { tags: ['bakery', 'shop'] }), true);
  assert.equal(run('contains(title, "CARD")', { title: 'Loyalty cards' }), true);
  assert.equal(run('tags.contains("pie")', { tags: ['bakery'] }), false);
  assert.equal(run('empty(owner) && !empty(stage)', { owner: '  ', stage: 'x' }), true);
  assert.equal(run('IF(1 > 0, "upper case names work", "")'), 'upper case names work');
});

test('days: today, now, days between, a day moved on, and days written as words', () => {
  assert.equal(run('today()'), '2026-10-21');
  assert.equal(run('now()'), '2026-10-21T10:15');
  assert.equal(run('daysBetween(today(), due)', { due: '2026-10-24' }), 3);
  assert.equal(run('daysBetween(due, "2026-10-01")', { due: '24 Oct 2026' }), -23, 'a day written as words');
  assert.equal(run('dateAdd(due, 2, "weeks")', { due: '2026-10-24' }), '2026-11-07');
  assert.equal(run('dateAdd(due, 1, "months")', { due: '2026-01-31' }), '2026-02-28', 'the 31st plus a month is the end of February');
  assert.equal(run('dateAdd(due, 3)', { due: '2026-10-30' }), '2026-11-02', 'days when no length is named');
  assert.equal(run('due + "1 week"', { due: '2026-10-24' }), '2026-10-31');
  assert.equal(run('now() - "3d"'), '2026-10-18T10:15');
  assert.equal(run('due - today()', { due: '2026-10-31' }), 10, 'two days apart, in days');
  assert.equal(run('due < today()', { due: '2026-10-02' }), true);
  assert.equal(run('daysBetween(start, due)', {}), null, 'no day, no answer (not a problem)');
});

test('what can’t be worked out says why, in plain words, and never throws', () => {
  assert.match(reason('price * "a lot"', { price: 3 }), /“a lot” isn’t a number/);
  assert.match(reason('1 / 0'), /divides by zero/);
  assert.match(reason('sparkle(3)'), /doesn’t know the function “sparkle”/);
  assert.match(reason('(1 + 2'), /“\)” is missing/);
  assert.match(reason('"open'), /never closed/);
  assert.match(reason('1 +'), /stops before it is finished/);
  assert.match(reason('2 # 3'), /“#” can’t be used/);
  assert.match(reason(''), /empty/);
  assert.match(reason('daysBetween(due, today())', { due: 'soon' }), /“soon” isn’t a day/);
  assert.match(reason('dateAdd(due, 1, "fortnights")', { due: '2026-10-01' }), /isn’t a length of time/);
  assert.match(reason('file'), /Name one of the note’s fields/);
  assert.match(reason('formula.nothing'), /no formula called “nothing”/);
  assert.match(reason('this.file'), /“this” isn’t something/);
  assert.match(reason('('.repeat(80) + '1' + ')'.repeat(80)), /too many brackets/);
  assert.equal(X.formulaProblem('price * 2'), null);
  assert.match(X.formulaProblem('price *'), /stops/);
  // Nothing in the language reaches outside the note: names are only ever properties.
  assert.equal(run('constructor'), null);
  assert.equal(run('process'), null);
  assert.match(reason('globalThis.process.exit(1)'), /has no|doesn’t know/);
});

const T = Date.parse('2026-10-19T09:00:00');
const note = (p, props = {}, tags = []) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), mtime: T, tags, props });
const orders = () => [
  note('Orders/Wedding cake.md', { price: 320, quantity: 1, due: '2026-10-24', status: 'Planned' }),
  note('Orders/Croissants.md', { price: 4.5, quantity: 60, due: '2026-10-22', status: 'In progress' }),
  note('Orders/Pie week.md', { price: 6, quantity: 'lots', status: 'Planned' }),
  note('Orders/Sourdough.md', { price: 9.5, quantity: 12, due: '2026-10-30', status: 'Done' }),
];

test('a formula in a view: a column, an order, a filter and a group; one formula using another; a loop caught', () => {
  const def = { ...V.defaultView({ kind: 'folder', value: 'Orders' }), formulas: { Total: 'price * quantity', Big: 'formula.Total >= 200', 'Days left': 'daysBetween(today(), due)' }, columns: ['formula.Total'] };
  const rows = V.runView({ ...def, sort: { prop: 'formula.Total', dir: 'desc' } }, orders(), { now: NOW });
  assert.deepEqual(rows.map((r) => r.title), ['Wedding cake', 'Croissants', 'Sourdough', 'Pie week'], 'a fault sorts last, like an empty value');
  assert.equal(V.valueOf(rows[0], 'formula.Total'), 320);
  assert.ok(X.isFault(V.valueOf(rows[3], 'formula.Total')));
  assert.match(V.valueOf(rows[3], 'formula.Total').reason, /“lots” isn’t a number/);
  assert.equal(V.valueOf(rows[1], 'formula.Days left'), 1);
  assert.equal(V.columnLabel(def, 'formula.Days left'), 'Days left');

  const big = V.runView({ ...def, filters: [{ prop: 'formula.Big', op: 'is', value: 'yes' }] }, orders(), { now: NOW });
  assert.deepEqual(big.map((r) => r.title), ['Croissants', 'Wedding cake']);
  const matches = V.runView({ ...def, filters: [{ prop: '', op: 'matches', value: 'Total < 100 && status != "done"' }] }, orders(), { now: NOW });
  assert.deepEqual(matches.map((r) => r.title), ['Pie week'], 'a bare name finds a formula; the fault hides nothing');
  const groups = V.groupBoard(rows, { ...def, groupBy: 'formula.Big' });
  assert.deepEqual(groups.map((g) => [g.label, g.rows.length]), [['Yes', 2], ['No', 1], ['No value', 1]]);

  const loop = V.computeFormulas(V.runView(V.defaultView(), orders())[0], { a: 'b + 1', b: 'formula.a * 2', c: '5' });
  assert.match(loop.a.reason, /uses itself/);
  assert.ok(X.isFault(loop.b));
  assert.equal(loop.c, 5, 'a formula outside the loop still works out');
});

test('filters: more than and less than for numbers and days', () => {
  const run = (...filters) => V.runView({ ...V.defaultView(), filters }, orders()).map((r) => r.title);
  assert.deepEqual(run({ prop: 'price', op: 'gt', value: '9' }), ['Sourdough', 'Wedding cake']);
  assert.deepEqual(run({ prop: 'due', op: 'lt', value: '2026-10-24' }), ['Croissants']);
  assert.deepEqual(run({ prop: 'due', op: 'gt', value: '' }).length, 4, 'not filled in yet: hides nothing');
  const { def } = V.readView(JSON.stringify({ filters: [{ op: 'matches', value: 'price > 5' }, { op: 'matches' }], formulas: { Total: 'price * quantity', '': 'x' } }));
  assert.deepEqual(def.filters, [{ prop: '', op: 'matches', value: 'price > 5' }], 'a formula filter with no formula is left out');
  assert.deepEqual(def.formulas, { Total: 'price * quantity' });
  assert.deepEqual(V.readView(V.writeView(def)).def, def);
});

test('a property or formula named like something every object has is only ever a property', () => {
  const rows = V.runView({ ...V.defaultView(), formulas: { check: 'constructor', proto: 'toString' } }, [note('a.md', { status: 'x' })]);
  assert.equal(V.valueOf(rows[0], 'formula.check'), null);
  assert.equal(V.valueOf(rows[0], 'constructor'), undefined);
  assert.equal(V.valueOf(rows[0], 'formula.constructor'), undefined);
});

test('a formula made, renamed (kept wherever it was used) and taken away', () => {
  let def = { ...V.defaultView(), columns: ['price'] };
  def = { ...def, ...V.withFormula(def, ' Total. cost ', 'price * quantity') };
  assert.deepEqual(def.formulas, { 'Total cost': 'price * quantity' }, 'no dots in a name');
  assert.deepEqual(def.columns, ['price', 'formula.Total cost'], 'a new formula shows as the last column');
  def = { ...def, sort: { prop: 'formula.Total cost', dir: 'desc' }, summaries: { 'formula.Total cost': 'sum' }, filters: [{ prop: 'formula.Total cost', op: 'gt', value: '10' }] };
  def = { ...def, ...V.withFormula(def, 'Total', 'round(price * quantity)', 'Total cost') };
  assert.deepEqual(def.formulas, { Total: 'round(price * quantity)' });
  assert.deepEqual(def.columns, ['price', 'formula.Total']);
  assert.equal(def.sort.prop, 'formula.Total');
  assert.deepEqual(def.summaries, { 'formula.Total': 'sum' });
  assert.equal(def.filters[0].prop, 'formula.Total');
  assert.throws(() => V.withFormula(def, 'total', 'price', undefined), /already a formula called “Total”/);
  assert.throws(() => V.withFormula(def, '  ', 'price'), /needs a name/);
  def = { ...def, ...V.withoutFormula(def, 'Total') };
  assert.deepEqual(def.formulas, {});
  assert.deepEqual(def.columns, ['price']);
  assert.equal(def.sort, undefined);
  assert.deepEqual(def.summaries, {});
  assert.deepEqual(def.filters, []);
  assert.equal(V.filterWords(def, { prop: '', op: 'matches', value: 'price > 10' }), 'Matches price > 10');
  assert.equal(V.filterWords({ ...def, labels: { price: 'Cost' } }, { prop: 'price', op: 'gt', value: '10' }), 'Cost is more than “10”');
});

test('an answer without binary noise: 3.2 × 48 is 153.6', () => {
  assert.equal(run('price * quantity', { price: 3.2, quantity: 48 }), 153.6);
  assert.equal(run('0.1 + 0.2'), 0.3);
  assert.equal(run('1 / 3'), 0.333333333);
  assert.equal(run('123456789012345678'), 123456789012345680, 'very large numbers are left as they are');
});
