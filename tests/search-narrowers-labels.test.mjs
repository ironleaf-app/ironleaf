// node --test tests/search-narrowers-labels.test.mjs — search narrowers in plain words
// (src/shared/search-ask-87.ts, 10.0 papercuts): the narrowers in force read as plain words above the results, and
// each clears itself without touching the others.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-search-nar-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/search-ask-87.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a wide-open search narrows by nothing', () => {
  assert.deepEqual(S.searchNarrowers(S.NO_FILTERS, false), []);
});

test('every narrowing reads in plain words', () => {
  const out = S.searchNarrowers({ kind: 'notes', person: 'Thad Vance', project: 'Harbour fit-out', date: 'week', titlesOnly: true }, true);
  assert.deepEqual(out, [
    { id: 'titles', words: 'Titles only' },
    { id: 'person', words: 'About Thad Vance' },
    { id: 'project', words: 'In Harbour fit-out' },
    { id: 'date', words: 'Changed this week' },
    { id: 'kind', words: 'Notes only' },
    { id: 'capitals', words: 'Match capitals' },
  ]);
  assert.deepEqual(S.searchNarrowers({ ...S.NO_FILTERS, kind: 'files' }, false), [{ id: 'kind', words: 'Files only' }]);
  assert.deepEqual(S.searchNarrowers({ ...S.NO_FILTERS, date: 'today' }, false), [{ id: 'date', words: 'Changed today' }]);
  assert.deepEqual(S.searchNarrowers({ ...S.NO_FILTERS, date: 'month' }, false), [{ id: 'date', words: 'Changed this month' }]);
});

test('each narrowing clears itself, leaving the others', () => {
  const full = { kind: 'notes', person: 'Thad Vance', project: 'Harbour fit-out', date: 'week', titlesOnly: true };
  assert.deepEqual(S.clearNarrower(full, 'person'), { ...full, person: '' });
  assert.deepEqual(S.clearNarrower(full, 'date'), { ...full, date: 'any' });
  assert.deepEqual(S.clearNarrower(full, 'kind'), { ...full, kind: 'all' });
  assert.deepEqual(S.clearNarrower(full, 'titles'), { ...full, titlesOnly: false });
  assert.deepEqual(S.clearNarrower(full, 'project'), { ...full, project: '' });
});
