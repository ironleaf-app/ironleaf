// node --test tests/lnvimport2.test.mjs — 9.5 import leftovers O5 and O6 in the renderer
// (src/renderer/src/state/importCsv.ts, src/renderer/src/lib/fuzzy.ts): each check fails
// without its fix. Pure helpers are bundled and run; the import flow is guarded by the
// mechanism it calls, as the earlier uplift tests do for renderer state.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-lnvimport2-'));
let FZ;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  writeFileSync(path.join(work, 'entry.ts'), `export * as FZ from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/fuzzy.ts'))};\n`);
  await build({ input: path.join(work, 'entry.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ FZ } = await import(pathToFileURL(path.join(work, 'r.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

test('O5: a CSV serial day is rewritten to its day before planning', () => {
  const src = read('src/renderer/src/state/importCsv.ts');
  assert.ok(src.includes('withSerialDays') && src.includes('serialIso'), 'serial days rewritten (withSerialDays/serialIso)');
  assert.ok(src.includes('planImport(dated'), 'the plan runs on the rewritten table, so kinds, preview and notes agree');
});

test('O6: a capped list says how to narrow it down', () => {
  assert.equal(FZ.narrowWords(200, 60, 'columns'), '200 columns. Type a few letters to narrow them down.');
  assert.equal(FZ.narrowWords(60, 60, 'columns'), '');
  assert.equal(FZ.narrowWords(10, 60, 'columns'), '');
});

test('O6: the column picker names its cap in its footer', () => {
  const src = read('src/renderer/src/state/importCsv.ts');
  assert.ok(src.includes('narrowWords(headings.length'), 'footer uses the shared capped-list words with the column count');
});
