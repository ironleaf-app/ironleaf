// node --test tests/t191-recent.test.mjs — t191: the recent list keeps only real paths. "Make the doc" in a
// window whose docs:create answered undefined opened a tab for it, and the undefined sat in the list until Today
// read `.includes` on it; the readers' input is guarded where it is made (noteOpened), as `restore` already does
// on load.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-t191-recent-'));
let W;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/state/workspace.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'workspace.mjs'), format: 'esm' }, logLevel: 'silent' });
  W = await import(pathToFileURL(path.join(work, 'workspace.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('opening a file puts it first in the recent list', () => {
  const ws = W.noteOpened(W.defaultWorkspace(), 'Docs/harbour.md');
  assert.deepEqual(ws.recent, ['Docs/harbour.md']);
});

test('an answer that is not a path never lands in the recent list', () => {
  const ws = W.defaultWorkspace();
  assert.deepEqual(W.noteOpened(ws, undefined).recent, []);
  assert.deepEqual(W.noteOpened(ws, '').recent, []);
  const one = W.noteOpened(ws, 'Docs/harbour.md');
  assert.deepEqual(W.noteOpened(one, undefined).recent, ['Docs/harbour.md']);
  assert.deepEqual(W.noteOpened(one, null).recent, ['Docs/harbour.md']);
});

test('a saved layout with a broken recent list still loads with only real paths', () => {
  const back = W.restore({ ...W.defaultWorkspace(), recent: ['Docs/harbour.md', undefined, 3] });
  assert.deepEqual(back.recent, ['Docs/harbour.md']);
});
