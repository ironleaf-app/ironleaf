// node --test tests/notes-sort-pin-bulk.test.mjs — the Notes list sort, pin and bulk (src/shared/notes-list.ts,
// 10.0 papercuts): newest or by name, pinned notes leading in their own group, one row's place found without a
// scan, ticked rows toggling, and one tag added to a note's tags.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-notes-sort-'));
let N, T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as N from ${JSON.stringify(path.join(root, 'src/shared/notes-list.ts'))};\nexport * as T from ${JSON.stringify(path.join(root, 'src/shared/tags.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'n.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ N, T } = await import(pathToFileURL(path.join(work, 'n.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const row = (p, title, mtime) => ({ path: p, title, mtime, kind: 'note', kindLabel: 'Note', snippet: '' });
const now = new Date(2026, 10, 2, 12);

test('newest first by default, by name when asked', () => {
  const rows = [row('b.md', 'Beta', 10), row('a.md', 'Alpha', 20)];
  assert.deepEqual(N.sortNoteRows(rows).map((r) => r.path), ['a.md', 'b.md']);
  assert.deepEqual(N.sortNoteRows(rows, 'name').map((r) => r.path), ['a.md', 'b.md']);
  assert.deepEqual(N.sortNoteRows([row('b.md', 'Beta', 30), row('a.md', 'Alpha', 10)], 'name').map((r) => r.path), ['a.md', 'b.md']);
});

test('pinned notes lead in their own group, the rest grouped as before', () => {
  const rows = [row('old.md', 'Old', new Date(2026, 9, 20).getTime()), row('today.md', 'Today', new Date(2026, 10, 2, 9).getTime())];
  const groups = N.groupNoteRows(rows, now, { pinned: ['old.md'] });
  assert.deepEqual(groups.map((g) => g.id), ['pinned', 'today']);
  assert.deepEqual(groups[0].rows.map((r) => r.path), ['old.md']);
  assert.deepEqual(N.groupNoteRows(rows, now).map((g) => g.id), ['today', 'earlier']);
});

test('pinning toggles once, in the order pinned', () => {
  assert.deepEqual(N.togglePinned([], 'a.md'), ['a.md']);
  assert.deepEqual(N.togglePinned(['a.md'], 'a.md'), []);
  assert.deepEqual(N.togglePinned(['a.md'], 'b.md'), ['a.md', 'b.md']);
  assert.equal(N.isPinned(['a.md'], 'a.md'), true);
  assert.equal(N.isPinned(['a.md'], 'b.md'), false);
});

test("each row's place is found without scanning the list", () => {
  const rows = [row('a.md', 'A', 3), row('b.md', 'B', 2), row('c.md', 'C', 1)];
  const at = N.rowPositions(rows);
  assert.equal(at.get('a.md'), 0);
  assert.equal(at.get('b.md'), 1);
  assert.equal(at.get('c.md'), 2);
  assert.equal(at.size, 3);
});

test('ticked rows toggle, and a tag joins the note tags once', () => {
  assert.deepEqual(N.toggleSelected([], 'a.md'), ['a.md']);
  assert.deepEqual(N.toggleSelected(['a.md', 'b.md'], 'a.md'), ['b.md']);
  const tagged = T.addTag('# Plain\n\nWords.\n', 'client');
  assert.match(tagged, /tags:\s*\n\s*-\s*client/);
  assert.match(tagged, /Words\./);
  assert.equal(T.addTag(tagged, 'Client'), tagged);
  assert.equal(T.addTag('# Plain\n', '   '), '# Plain\n');
});
