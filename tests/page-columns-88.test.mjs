// node --test tests/page-columns-88.test.mjs — page columns (src/shared/page-columns.ts; 8.8 database
// depth): blocks laid side by side on a page, two to four columns. Stored as plain Markdown with HTML comments for
// markers, so other apps read the same words in a line and see nothing strange. Made-up bakery notes.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-columns-'));
let C;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as C from ${JSON.stringify(path.join(root, 'src/shared/page-columns.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'cols.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ C } = await import(pathToFileURL(path.join(work, 'cols.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

test('two to four columns build and parse back, whatever the spacing or case', () => {
  const text = C.buildColumns(['# Saturday\n\nBake at dawn.', 'Flour\n\nButter']);
  const blocks = C.parseColumns(`# Pie week\n\n${text}\n`);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].count, 2);
  assert.deepEqual(blocks[0].columns, ['# Saturday\n\nBake at dawn.', 'Flour\n\nButter']);
  const four = C.parseColumns(C.buildColumns(['a', 'b', 'c', 'd']));
  assert.equal(four[0].count, 4);
  assert.deepEqual(four[0].columns, ['a', 'b', 'c', 'd']);
  const loose = C.parseColumns('  <!-- COLUMNS:3 -->\na\n<!--column-->\nb\n<!-- column -->\nc\n<!--END COLUMNS-->');
  assert.equal(loose.length, 1);
  assert.equal(loose[0].count, 3);
});

test('other apps read the same words in a line: the markers lift out cleanly', () => {
  const text = C.buildColumns(['# Saturday\n\nBake at dawn.', 'Flour']);
  const plain = C.stripColumnMarkers(`# Pie week\n\n${text}\n`);
  assert.ok(!plain.includes('<!--'), 'no marker left');
  assert.ok(plain.includes('# Saturday') && plain.includes('Bake at dawn.') && plain.includes('Flour'));
  assert.ok(plain.indexOf('Bake at dawn.') < plain.indexOf('Flour'), 'in reading order');
});

test('an unfinished or impossible block is left alone, never half drawn', () => {
  assert.deepEqual(C.parseColumns('<!-- columns:2 -->\na\n'), [], 'no end, no columns');
  assert.deepEqual(C.parseColumns('<!-- columns:5 -->\na\n<!-- column -->\nb\n<!-- end columns -->'), [], 'five columns is none');
  assert.deepEqual(C.parseColumns('<!-- columns:2 -->\na\n<!-- end columns -->'), [], 'one column is none');
  const fenced = C.parseColumns('```\n<!-- columns:2 -->\n```\n\nreal words\n');
  assert.deepEqual(fenced, [], 'markers in code are only words');
});

test('the editor adds, removes and undoes columns, and labels each divider', () => {
  const two = C.buildColumns(['Bake at dawn.', 'Sell at the market.']);
  const added = C.addColumnText(`# Pie week\n\n${two}\n`, 2);
  assert.ok(added && added.includes('<!-- columns:3 -->'), 'grows to three');
  assert.equal(C.parseColumns(added)[0].count, 3);
  assert.equal(C.addColumnText(C.buildColumns(['a', 'b', 'c', 'd']), 0), null, 'four is the most');
  const back = C.removeColumnText(added, 2);
  assert.ok(back && back.includes('<!-- columns:2 -->'), 'shrinks to two');
  assert.equal(C.parseColumns(back)[0].count, 2);
  assert.equal(C.removeColumnText(two, 0), null, 'two stays two; undo instead');
  const flat = C.unlayColumnsText(`# Pie week\n\n${two}\n`, 2);
  assert.ok(flat && !flat.includes('<!--'), 'no marker left');
  assert.ok(flat.indexOf('Bake at dawn.') < flat.indexOf('Sell at the market.'), 'in reading order');
  assert.equal(C.columnDividerLabel(0, 2), 'Column 1 of 2');
  assert.equal(C.columnDividerLabel(1, 2), 'Column 2 of 2');
  assert.deepEqual(C.columnSeparators(two.split('\n'), C.parseColumns(two)[0]), [3]);
});
