// node --test tests/import-preview.test.mjs — 10.0 item 16 preview before anything is written:
// how many are new, to update and already here, counted before the person chooses; identical
// notes are left in both choices, never duplicated. The pure counts run directly; the renderer
// wiring (CSV + Markdown dialogs show the counts, the two Import buttons pre-switch) is guarded
// by the mechanism it calls, as the earlier uplift tests do for renderer state.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-import-preview-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  writeFileSync(path.join(work, 'entry.ts'), `export * as P from ${JSON.stringify(path.join(root, 'src/shared/import-preview.ts'))};\n`);
  await build({ input: path.join(work, 'entry.ts'), platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ P } = await import(pathToFileURL(path.join(work, 'p.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

test('counts: new, to update and already here, case blind and line-end blind', () => {
  const existing = new Map([['harbour cafe', '---\nStage: Lead\n---\n'], ['coastline joinery', '---\nStage: Won\n---\n']]);
  const counts = P.previewByName(existing, [
    { name: 'Harbour Cafe', text: '---\nStage: Lead\n---\n' },
    { name: 'COASTLINE JOINERY', text: '---\nStage: Lost\n---\n' },
    { name: 'New supplier', text: '---\nStage: Lead\n---\n' },
  ]);
  assert.deepEqual(counts, { newCount: 1, updateCount: 1, identicalCount: 1 });
  // Line ends and trailing spaces do not count as different.
  const same = P.previewByName(new Map([['a', 'line one  \nline two\n']]), [{ name: 'A', text: 'line one\nline two\r\n' }]);
  assert.deepEqual(same, { newCount: 0, updateCount: 0, identicalCount: 1 });
});

test('unreadable counts as to update, never as identical', () => {
  const counts = P.previewByName(new Map([['a', null]]), [{ name: 'A', text: 'words' }]);
  assert.deepEqual(counts, { newCount: 0, updateCount: 1, identicalCount: 0 });
  assert.equal(P.needsChoice(counts), true);
});

test('a choice only when something would change', () => {
  assert.equal(P.needsChoice({ newCount: 2, updateCount: 0, identicalCount: 3 }), false, 'new plus identical: no choice, just new notes');
  assert.equal(P.needsChoice({ newCount: 0, updateCount: 0, identicalCount: 5 }), false, 'all identical: no choice, nothing written');
  assert.equal(P.needsChoice({ newCount: 0, updateCount: 1, identicalCount: 0 }), true);
});

test('words: plain counts, zeros left out, never a bare number or an em dash', () => {
  assert.equal(P.previewWords({ newCount: 12, updateCount: 3, identicalCount: 40 }), '12 new, 3 to update, 40 already here');
  assert.equal(P.previewWords({ newCount: 1, updateCount: 0, identicalCount: 0 }), '1 new');
  assert.equal(P.previewWords({ newCount: 0, updateCount: 2, identicalCount: 1 }), '2 to update, 1 already here');
  assert.equal(P.previewWords({ newCount: 0, updateCount: 0, identicalCount: 0 }), 'nothing new');
  assert.ok(!P.previewWords({ newCount: 1, updateCount: 1, identicalCount: 1 }).includes('—'), 'no em dashes');
});

test('CSV shows its preview before asking and leaves identical in both choices', () => {
  const src = read('src/renderer/src/state/importCsv.ts');
  assert.ok(src.includes('previewByName(existing'), 'compared before asking');
  assert.ok(src.includes('needsChoice(full)'), 'no choice when nothing would change');
  assert.ok(src.includes('previewWords(full)'), 'the counts in the dialog');
  assert.ok(src.includes('Notes already here are left as they are in both choices'), 'identical left in both choices, said');
  assert.ok(src.includes('sameSet'), 'identical skipped when keeping both, never numbered copies');
});

test('Markdown shows its preview before asking and leaves identical in both choices', () => {
  const src = read('src/renderer/src/state/imports.ts');
  assert.ok(src.includes('previewByName(existing'), 'compared before asking');
  assert.ok(src.includes('needsChoice(full)'), 'no choice when nothing would change');
  assert.ok(src.includes('previewWords(full)'), 'the counts in the dialog');
  assert.ok(src.includes('Notes already here are left as they are in both choices'), 'identical left in both choices, said');
  assert.ok(src.includes('sameSet'), 'identical skipped when keeping both, never numbered copies');
});

test('the two Import buttons open the dialog already on the right source', () => {
  const view = read('src/renderer/src/views/ImportView.tsx');
  assert.ok(view.includes(`setDialog('folder')`), 'Copy in opens on folder');
  assert.ok(view.includes(`setDialog('apps')`), 'Choose opens on apps');
  assert.ok(view.includes('initial={dialog}'), 'the section passed in');
  const home = read('src/renderer/src/components/VaultHome.tsx');
  assert.ok(home.includes(`initial?: 'folder' | 'apps' | 'all'`), 'the dialog takes its starting section');
  assert.ok(home.includes('See all ways to import'), 'the other door one press away');
});
