// node --test tests/project-edit-history.test.mjs — a project's history of changes (src/main/projects.ts ProjectHistory):
// the person's and the assistant's changes undone and made again in order, following the project when it is renamed,
// forgotten when the file changed some other way, and kept to a sensible length.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-project-history-'));
let H;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/main/projects.ts'), platform: 'node', external: [/^node:/], output: { file: path.join(work, 'h.mjs'), format: 'esm' }, logLevel: 'silent' });
  H = await import(pathToFileURL(path.join(work, 'h.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const file = 'Projects/Winter Menu/Winter Menu.md';

test('changes undo newest first, redo in order, and a new change clears what was undone', () => {
  const h = new H.ProjectHistory();
  h.record(file, { before: 'a', after: 'b', words: 'Added a risk.', by: 'you' });
  h.record(file, { before: 'b', after: 'c', words: 'The assistant’s change to the project.', by: 'assistant' });
  assert.deepEqual(h.counts(file), { undo: 2, redo: 0 });
  assert.equal(h.peek(file).after, 'c', 'the assistant’s change is undone first: one history');
  assert.equal(h.shift(file, false).words, 'The assistant’s change to the project.');
  assert.equal(h.peek(file).after, 'b');
  assert.equal(h.peek(file, true).before, 'b', 'and can be made again');
  assert.deepEqual(h.counts(file), { undo: 1, redo: 1 });
  h.record(file, { before: 'b', after: 'd', words: 'Changed the summary.', by: 'you' });
  assert.deepEqual(h.counts(file), { undo: 2, redo: 0 }, 'a new change: nothing to redo');
  h.record(file, { before: 'd', after: 'd', words: 'Nothing.', by: 'you' });
  assert.equal(h.counts(file).undo, 2, 'a change that changed nothing isn’t kept');
});

test('the history follows a renamed project, and is forgotten when the file changed another way', () => {
  const h = new H.ProjectHistory();
  h.record(file, { before: 'a', after: 'b', words: 'Changed the owner.', by: 'you' });
  const moved = 'Projects/Winter Menu 2026/Winter Menu 2026.md';
  h.renamed(file, moved);
  assert.equal(h.peek(file), undefined);
  assert.equal(h.peek(moved).words, 'Changed the owner.');
  h.record(moved, { before: 'b', after: 'c', words: 'Renamed the project.', by: 'you', moves: [['Projects/Winter Menu', 'Projects/Winter Menu 2026']] });
  // Undoing the rename puts the history back under the old name.
  const step = h.shift(moved, false, file);
  assert.deepEqual(step.moves, [['Projects/Winter Menu', 'Projects/Winter Menu 2026']]);
  assert.equal(h.peek(file).words, 'Changed the owner.');
  assert.equal(h.peek(file, true).words, 'Renamed the project.');
  h.forget(file);
  assert.deepEqual(h.counts(file), { undo: 0, redo: 0 });
});

test('a long history keeps the newest changes', () => {
  const h = new H.ProjectHistory(5);
  for (let i = 0; i < 12; i++) h.record(file, { before: String(i), after: String(i + 1), words: `Change ${i}.`, by: 'you' });
  assert.equal(h.counts(file).undo, 5);
  assert.equal(h.peek(file).words, 'Change 11.');
});
