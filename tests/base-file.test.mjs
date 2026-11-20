// node --test tests/base-file.test.mjs — .base files as views (src/shared/base-file.ts; 21 Oct 2026): a hand-written
// file in the open .base YAML format read as an Ironleaf view (filters with and/or/not, comparisons, a folder and a
// tag, formulas, headings, summaries, a view's type, columns, order, grouping and limit), what isn't read named quietly,
// and a change written back into the same YAML with comments, other views and unknown keys kept.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-base-'));
let B, V, Y;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as B from ${JSON.stringify(path.join(root, 'src/shared/base-file.ts'))};\nexport * as V from ${JSON.stringify(path.join(root, 'src/shared/views.ts'))};\nexport * as Y from ${JSON.stringify(path.join(root, 'node_modules', 'yaml', 'dist', 'index.js'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'base.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ B, V, Y } = await import(pathToFileURL(path.join(work, 'base.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

// A made-up file, written the way the format's public description gives it.
const FILE = `# Orders for the bakery (kept by hand)
filters:
  and:
    - '!file.inFolder("Templates")'
formulas:
  total: price * quantity
  days_left: daysBetween(today(), due)
  odd: price.toWords()
properties:
  note.price:
    displayName: Price (A$)
  formula.total:
    displayName: Total
    width: 120
summaries:
  doubled: values.sum() * 2
views:
  - type: table
    name: Open orders
    filters:
      and:
        - file.inFolder("Orders")
        - status != "Done"
        - price > 5
        - or:
            - urgent
            - formula.days_left < 3
        - not:
            - file.hasTag("sample")
    order:
      - file.name
      - note.price
      - formula.total
      - due
      - file.size
    sort:
      - property: formula.total
        direction: DESC
      - property: due
        direction: ASC
    groupBy:
      property: status
      direction: ASC
    limit: 50
    summaries:
      formula.total: Sum
      due: Earliest
      note.price: Median
    rowHeight: tall
  - type: cards
    name: Gallery
    image: note.cover
    order:
      - file.name
      - status
  - type: map
    name: Where
`;

test('a .base file read as a view: its filters, formulas, headings, columns, order, groups, limit and summaries', () => {
  const v = B.readBase(FILE);
  assert.equal(v.problem, null);
  assert.deepEqual(v.views, ['Open orders', 'Gallery', 'Where']);
  assert.equal(v.index, 0);
  const d = v.def;
  assert.equal(d.layout, 'table');
  assert.deepEqual(d.source, { kind: 'folder', value: 'Orders' }, 'the one folder filter is what the view shows');
  assert.deepEqual(d.filters, [
    { prop: 'status', op: 'is-not', value: 'Done' },
    { prop: 'price', op: 'gt', value: '5' },
    { prop: '', op: 'matches', value: '(urgent) || (formula.days_left < 3)' },
    { prop: '', op: 'matches', value: '!(file.hasTag("sample"))' },
  ]);
  assert.deepEqual(v.where, ['!file.inFolder("Templates")'], 'the file’s filters for every view');
  assert.deepEqual(d.formulas, { total: 'price * quantity', days_left: 'daysBetween(today(), due)', odd: 'price.toWords()', doubled: 'values.sum() * 2' }, 'the file’s own summary formulas read as formulas too');
  assert.deepEqual(d.labels, { price: 'Price (A$)', 'formula.total': 'Total' });
  assert.deepEqual(d.columns, ['price', 'formula.total', 'due'], 'the name is always first; file.size can’t be shown');
  assert.deepEqual(d.sort, { prop: 'formula.total', dir: 'desc' });
  assert.deepEqual(d.sorts, [{ prop: 'formula.total', dir: 'desc' }, { prop: 'due', dir: 'asc' }], 'every order kept, the first one first');
  assert.deepEqual(d.sectionBy, { prop: 'status', dir: 'asc' });
  assert.equal(d.limit, 50);
  assert.deepEqual(d.summaries, { 'formula.total': 'sum', due: 'earliest' });
  assert.ok(v.notes.some((n) => /file\.size/.test(n)));
  assert.ok(!v.notes.some((n) => /first of the view’s orders/.test(n)), 'no order is cut any more');
  assert.ok(v.notes.some((n) => /“Median” summary/.test(n)));
  assert.ok(!v.notes.some((n) => /own summary formulas/.test(n)), 'the file’s own summary formulas are read now');
  assert.ok(v.notes.some((n) => /This view’s “rowHeight” isn’t used here/.test(n)), 'a key Ironleaf has no use for is named');
  assert.ok(v.notes.some((n) => /Column settings other than their names \(width\)/.test(n)));

  const cards = B.readBase(FILE, 'gallery');
  assert.equal(cards.index, 1, 'a view found by its name, in any case');
  assert.equal(cards.def.layout, 'cards');
  assert.equal(cards.def.cover, 'cover');
  assert.deepEqual(cards.def.columns, ['status']);
  const map = B.readBase(FILE, 2);
  assert.equal(map.def.layout, 'map', 'a map view is drawn as a map now');
  assert.ok(!map.notes.some((n) => /isn’t something Ironleaf draws/.test(n)));
  assert.equal(B.readBase(FILE, 'Nope').index, 0, 'a name not found: the first view');
});

const T = new Date(2026, 9, 19).getTime();
const note = (p, props = {}, tags = []) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), mtime: T, tags, props });

test('the view works on notes as the file means it, its formulas included', () => {
  const v = B.readBase(FILE);
  const notes = [
    note('Orders/Wedding cake.md', { price: 320, quantity: 1, status: 'Planned', due: '2026-10-22', urgent: false }),
    note('Orders/Croissants.md', { price: 4.5, quantity: 60, status: 'Planned', urgent: true }),
    note('Orders/Pies.md', { price: 6, quantity: 10, status: 'Planned', urgent: true }, ['sample']),
    note('Orders/Sourdough.md', { price: 9.5, quantity: 12, status: 'Done', urgent: true }),
    note('Orders/Bagels.md', { price: 7, quantity: 30, status: 'In progress', due: '2026-12-01', urgent: false }),
    note('Templates/Order.md', { price: 99, quantity: 1, status: 'Planned', urgent: true }),
  ];
  const rows = V.runView(v.def, notes, { where: v.where, now: new Date(2026, 9, 21) });
  assert.deepEqual(rows.map((r) => r.title), ['Wedding cake'], 'urgent or due within 3 days, not a sample, not done, over $5');
  assert.equal(V.valueOf(rows[0], 'formula.total'), 320);
  assert.match(V.valueOf(rows[0], 'formula.odd').reason, /doesn’t know the function “toWords”/, 'a function Ironleaf lacks shows why, the rest still works');
});

test('a change written back: only what changed, comments, other views and unknown keys kept; read again the same', () => {
  const v = B.readBase(FILE);
  const changed = { ...v.def, columns: ['formula.total', 'price', 'formula.margin'], formulas: { ...v.def.formulas, margin: 'total - price' }, labels: { ...v.def.labels, 'formula.margin': 'Margin' }, filters: v.def.filters.filter((f) => f.op !== 'gt'), limit: undefined };
  const text = B.writeBase(FILE, changed);
  assert.match(text, /^# Orders for the bakery \(kept by hand\)/, 'the comment at the top stays');
  assert.match(text, /rowHeight: tall/, 'a key Ironleaf doesn’t know stays');
  assert.match(text, /width: 120/);
  assert.match(text, /doubled: values\.sum\(\) \* 2/);
  assert.match(text, /name: Where/, 'the other views stay');
  const data = Y.parse(text);
  const view = data.views[0];
  assert.deepEqual(view.order, ['file.name', 'formula.total', 'note.price', 'formula.margin']);
  assert.equal(view.limit, undefined, 'a limit taken away');
  assert.deepEqual(view.filters, { and: ['file.inFolder("Orders")', 'status != "Done"', '(urgent) || (formula.days_left < 3)', '!(file.hasTag("sample"))'] });
  assert.equal(data.formulas.margin, 'total - price');
  assert.equal(data.formulas.total, 'price * quantity');
  assert.equal(data.properties['formula.margin'].displayName, 'Margin');
  assert.deepEqual(view.sort, [{ property: 'formula.total', direction: 'DESC' }, { property: 'due', direction: 'ASC' }], 'an order not changed is left exactly as it was (both of them)');
  assert.deepEqual(data.views[1], { type: 'cards', name: 'Gallery', image: 'note.cover', order: ['file.name', 'status'] });

  const back = B.readBase(text).def;
  assert.deepEqual(back.columns, changed.columns);
  assert.deepEqual(back.formulas, changed.formulas);
  assert.deepEqual(back.labels, changed.labels);
  assert.deepEqual(back.filters, changed.filters);
  assert.equal(back.limit, undefined);
  assert.equal(B.writeBase(FILE, v.def), Y.parseDocument(FILE).toString({ lineWidth: 0 }), 'nothing changed, nothing rewritten');
});

test('the second view changed alone; a board’s own settings kept where the format has no place for them', () => {
  const g = B.readBase(FILE, 'Gallery');
  const text = B.writeBase(FILE, { ...g.def, layout: 'board', groupBy: 'status', cardProps: ['price'], sectionBy: undefined, sort: { prop: 'price', dir: 'asc' }, summaries: { price: 'average' } }, 'Gallery');
  const data = Y.parse(text);
  assert.equal(data.views[0].name, 'Open orders');
  assert.equal(data.views[0].limit, 50, 'the first view untouched');
  assert.equal(data.views[1].type, 'board');
  assert.deepEqual(data.views[1].groupBy, { property: 'note.status', direction: 'ASC' });
  assert.deepEqual(data.views[1].neuralvault, { cardProps: ['price'] });
  assert.deepEqual(data.views[1].summaries, { 'note.price': 'Average' });
  const back = B.readBase(text, 'Gallery').def;
  assert.equal(back.layout, 'board');
  assert.equal(back.groupBy, 'status');
  assert.deepEqual(back.cardProps, ['price']);
  assert.deepEqual(back.summaries, { price: 'average' });
});

test('a view made from nothing, a folder and a tag written as filters; a broken file says so and is written afresh', () => {
  const def = { ...V.defaultView({ kind: 'tag', value: 'client' }), layout: 'list', columns: ['due date', 'file.modified'], filters: [{ prop: 'due date', op: 'empty' }, { prop: 'stage', op: 'is', value: 'Won' }, { prop: 'cost', op: 'lt', value: '100' }, { prop: 'name', op: 'contains', value: 'Ltd' }] };
  const text = B.writeBase('', def);
  const data = Y.parse(text);
  assert.equal(data.views[0].type, 'list');
  assert.deepEqual(data.views[0].order, ['file.name', 'note.due date', 'file.mtime']);
  assert.deepEqual(data.views[0].filters.and, ['file.hasTag("client")', 'note["due date"].isEmpty()', 'stage == "Won"', 'cost < 100', 'name.contains("Ltd")']);
  const back = B.readBase(text).def;
  assert.deepEqual(back.source, { kind: 'tag', value: 'client' });
  assert.deepEqual(back.filters, def.filters);
  assert.deepEqual(back.columns, def.columns);

  const broken = B.readBase('views: [unclosed');
  assert.match(broken.problem, /couldn’t be read/);
  assert.equal(broken.def.layout, 'table');
  assert.equal(Y.parse(B.writeBase('views: [unclosed', { ...V.defaultView(), layout: 'cards' })).views[0].type, 'cards');
  assert.ok(B.isBasePath('Views/Orders.BASE') && V.isViewPath('Orders.base'));
  assert.equal(V.viewName('Views/Orders.base'), 'Orders');
  assert.equal(B.readViewFile('a.view.json', V.writeView({ ...V.defaultView(), layout: 'list' })).def.layout, 'list');
});
