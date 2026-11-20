// node --test tests/view-file-holes.test.mjs — the four view-file holes closed (src/shared/views.ts and
// src/shared/base-file.ts, 10.0 papercuts): every order kept and used, the file's own summary formulas read and
// written back where they were, a new view writable as either kind of file, and a map layout grouping notes by place.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-view-holes-'));
let B, V, Y;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as B from ${JSON.stringify(path.join(root, 'src/shared/base-file.ts'))};\nexport * as V from ${JSON.stringify(path.join(root, 'src/shared/views.ts'))};\nexport * as Y from ${JSON.stringify(path.join(root, 'node_modules', 'yaml', 'dist', 'index.js'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'h.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ B, V, Y } = await import(pathToFileURL(path.join(work, 'h.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const T = new Date(2026, 9, 19).getTime();
const note = (p, props = {}) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), mtime: T, tags: [], props });

test('every order is used: the first, then the next, then the name', () => {
  const def = { ...V.defaultView(), sorts: [{ prop: 'status', dir: 'asc' }, { prop: 'price', dir: 'desc' }], sort: { prop: 'status', dir: 'asc' } };
  const rows = V.runView(def, [note('a.md', { status: 'b', price: 1 }), note('b.md', { status: 'a', price: 1 }), note('c.md', { status: 'a', price: 9 })], {});
  assert.deepEqual(rows.map((r) => r.title), ['c', 'b', 'a']);
  assert.deepEqual(V.sortsOf({ sort: { prop: 'a', dir: 'asc' } }), [{ prop: 'a', dir: 'asc' }]);
  assert.deepEqual(V.sortsOf({}), []);
});

test("changing the first order keeps the further ones, minus the same property's", () => {
  const def = { sort: { prop: 'status', dir: 'asc' }, sorts: [{ prop: 'status', dir: 'asc' }, { prop: 'price', dir: 'desc' }] };
  assert.deepEqual(V.primarySortPatch(def, { prop: 'due', dir: 'asc' }), { sort: { prop: 'due', dir: 'asc' }, sorts: [{ prop: 'due', dir: 'asc' }, { prop: 'price', dir: 'desc' }] });
  assert.deepEqual(V.primarySortPatch(def, undefined), { sort: undefined, sorts: undefined });
  const one = V.primarySortPatch({ sort: { prop: 'a', dir: 'asc' } }, { prop: 'b', dir: 'desc' });
  assert.deepEqual(one, { sort: { prop: 'b', dir: 'desc' }, sorts: undefined });
});

test("a .base file's own summary formulas are read, and written back where they were", () => {
  const text = 'summaries:\n  doubled: price * 2\nviews:\n  - type: table\n    name: All\n';
  const v = B.readBase(text);
  assert.equal(v.def.formulas.doubled, 'price * 2');
  assert.ok(!v.notes.some((n) => /doesn’t read/.test(n)));
  const out = B.writeBase(text, { ...v.def, formulas: { ...v.def.formulas, doubled: 'price * 3', fresh: 'price + 1' } });
  const data = Y.parse(out);
  assert.equal(data.summaries.doubled, 'price * 3', 'an edited one stays under summaries');
  assert.equal(data.formulas.fresh, 'price + 1', 'a new one goes under formulas');
  const clash = B.readBase('formulas:\n  x: 1\nsummaries:\n  x: 2\nviews:\n  - type: table\n    name: All\n');
  assert.equal(clash.def.formulas.x, '1');
  assert.ok(clash.notes.some((n) => /same name as a formula/.test(n)));
});

test('a new view is writable as either kind of file, and reads back the same', () => {
  const def = { ...V.defaultView({ kind: 'folder', value: 'Orders' }, 'map'), placeProp: 'place', sorts: [{ prop: 'place', dir: 'asc' }, { prop: 'file.title', dir: 'asc' }], sort: { prop: 'place', dir: 'asc' } };
  for (const name of ['List.view.json', 'List.base']) {
    const text = B.writeViewFile(name, '', def);
    const back = B.readViewFile(name, text).def;
    assert.equal(back.layout, 'map');
    assert.equal(back.placeProp, 'place');
    assert.deepEqual(V.sortsOf(back), def.sorts);
  }
  assert.match(B.writeViewFile('List.base', '', def), /type: map/);
});

test('a map groups notes by the place they name, most notes first', () => {
  const rows = [
    { path: 'a.md', title: 'a', folder: '', mtime: T, tags: [], props: { place: 'Harbour Point' } },
    { path: 'b.md', title: 'b', folder: '', mtime: T, tags: [], props: { place: 'harbour point' } },
    { path: 'c.md', title: 'c', folder: '', mtime: T, tags: [], props: { place: 'Depot' } },
    { path: 'd.md', title: 'd', folder: '', mtime: T, tags: [], props: {} },
  ];
  const { groups, unplaced } = V.groupByPlace(rows, 'place');
  assert.deepEqual(groups.map((g) => g.place), ['Harbour Point', 'Depot']);
  assert.deepEqual(groups[0].rows.map((r) => r.path), ['a.md', 'b.md']);
  assert.deepEqual(unplaced.map((r) => r.path), ['d.md']);
  assert.deepEqual(V.groupByPlace(rows, undefined).groups, []);
  assert.equal(V.groupByPlace(rows, undefined).unplaced.length, 4);
});
