// node --test tests/folder-followups-merge.test.mjs — item 3 (8 Nov 2026):
// Two PCs editing the list of kept-out folders merge item by item (a union of
// additions, with removals honoured by the latest change per folder), not
// whole-list last-writer-wins. Other list preferences stay as they are.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-followups-merge-'));
let VS;
let PR;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * as vaultSettings from ${JSON.stringify(path.join(root, 'src/shared/vault-settings.ts'))};`,
      `export * as prefsMod from ${JSON.stringify(path.join(root, 'src/shared/prefs.ts'))};`,
      '',
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  VS = S.vaultSettings;
  PR = S.prefsMod;
});
after(() => rmSync(work, { recursive: true, force: true }));

const listOf = (doc) => VS.docValues(doc).quietFolders;

test('two PCs adding different folders merge to both, not the newer whole list', () => {
  const a = VS.setValues(VS.emptyDoc('settings'), { quietFolders: ['Archive'] }, 100, 'pc-a').doc;
  const b = VS.setValues(VS.emptyDoc('settings'), { quietFolders: ['Plans'] }, 200, 'pc-b').doc;
  const merged = VS.mergeDocs(a, b);
  assert.deepEqual([...listOf(merged)].sort(), ['Archive', 'Plans'], 'a union of additions');
  const other = VS.mergeDocs(b, a);
  assert.deepEqual([...listOf(other)].sort(), ['Archive', 'Plans'], 'whichever way round');
});

test('removals are honoured by the latest change per folder', () => {
  // Both start with Archive; A removes it at 200 while B adds Plans at 150: Plans survives.
  const base = VS.setValues(VS.emptyDoc('settings'), { quietFolders: ['Archive'] }, 50, 'pc-a').doc;
  const a = VS.setValues(base, { quietFolders: [] }, 200, 'pc-a').doc;
  const b = VS.setValues(base, { quietFolders: ['Archive', 'Plans'] }, 150, 'pc-b').doc;
  assert.deepEqual([...listOf(VS.mergeDocs(a, b))].sort(), ['Plans'], 'the removal wins for Archive, the addition for Plans');
  // The other way: B adds Plans later (250) without touching Archive; A’s removal at 200 still wins for Archive.
  const b2 = VS.setValues(base, { quietFolders: ['Archive', 'Plans'] }, 250, 'pc-b').doc;
  assert.deepEqual([...listOf(VS.mergeDocs(a, b2))].sort(), ['Plans'], 'a later whole-list write does not resurrect what was removed');
  // Re-adding wins when it is the latest change for that folder.
  const c = VS.setValues(a, { quietFolders: ['Archive'] }, 300, 'pc-a').doc;
  assert.deepEqual([...listOf(VS.mergeDocs(c, b2))].sort(), ['Archive', 'Plans'], 'the latest change per folder wins');
});

test('other list preferences stay whole-list last-writer-wins', () => {
  const a = VS.setValues(VS.emptyDoc('settings'), { excluded: ['A'] }, 100, 'pc-a').doc;
  const b = VS.setValues(VS.emptyDoc('settings'), { excluded: ['B'] }, 200, 'pc-b').doc;
  assert.deepEqual(VS.docValues(VS.mergeDocs(a, b)).excluded, ['B'], 'excluded still newer-whole-list-wins');
  const c = VS.setValues(VS.emptyDoc('settings'), { fileSearchOff: ['a.md'] }, 100, 'pc-a').doc;
  const d = VS.setValues(VS.emptyDoc('settings'), { fileSearchOff: ['b.md'] }, 200, 'pc-b').doc;
  assert.deepEqual(VS.docValues(VS.mergeDocs(c, d)).fileSearchOff, ['b.md'], 'fileSearchOff too');
});

test('an older vault still opens with nothing kept out', () => {
  assert.deepEqual(PR.loadPrefs({}).quietFolders, [], 'a vault from before the setting opens with nothing kept out');
  assert.deepEqual(VS.joinPrefs({}, {}, {}).quietFolders ?? [], [], 'and joining its settings reads nothing kept out');
});
