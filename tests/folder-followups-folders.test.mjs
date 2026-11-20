// node --test tests/folder-followups-folders.test.mjs — item 5 (8 Nov 2026):
// Single-folder settings follow a move or rename (templatesFolder,
// attachmentsFolder, assetsFolder, dailyFolder, newNoteFolder), the same way
// the kept-out list now does.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-followups-folders-'));
let F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as fewer from ${JSON.stringify(path.join(root, 'src/shared/fewer-folders.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  F = (await import(pathToFileURL(path.join(work, 's.mjs')).href)).fewer;
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a single folder follows its move or rename', () => {
  assert.equal(typeof F.movedFolder, 'function', 'one remapping a single folder follows a move through');
  assert.equal(F.movedFolder('Archive', 'Archive', 'Archive 2025'), 'Archive 2025', 'the folder itself');
  assert.equal(F.movedFolder('Archive/Templates', 'Archive', 'Archive 2025'), 'Archive 2025/Templates', 'what it covers moves together');
  assert.equal(F.movedFolder('archive', 'archive', 'Archive'), 'Archive', 'a rename that only changes case follows too');
  assert.equal(F.movedFolder('Plans', 'Archive', 'Archive 2025'), 'Plans', 'nothing under the old name: unchanged');
  assert.equal(F.movedFolder('', 'Archive', 'Archive 2025'), '', 'the top stays the top');
  assert.equal(F.movedFolder('./Files', 'Archive', 'Archive 2025'), './Files', 'a beside-the-note folder is not a vault folder');
  assert.equal(F.movedFolder('Archive/Old', 'Archive', 'Work/Archive'), 'Work/Archive/Old', 'a move into another folder follows');
});

test('a move or rename carries the single-folder settings with it', () => {
  const app = read('src/main/app.ts');
  assert.ok(app.includes('movedFolderList'), 'the lists still follow');
  assert.ok(app.includes('movedFolder'), 'a single folder follows through the one remapping');
  for (const key of ['templatesFolder', 'attachmentsFolder', 'assetsFolder', 'dailyFolder', 'newNoteFolder']) {
    assert.ok(app.includes(key), `the move carries ${key}`);
  }
  // The carry sits with the lists' carry (one best-effort block, like the bell).
  const at = app.indexOf('movedFolderList(before.quietFolders');
  assert.ok(at > 0, 'the lists’ carry found');
  const block = app.slice(Math.max(0, at - 2000), at + 3000);
  assert.ok(block.includes('templatesFolder') && block.includes('dailyFolder'), 'the single folders move in the same block as the lists');
});
