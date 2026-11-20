// node --test tests/notes-list.test.mjs — the Notes page's list (src/shared/notes-list.ts): plain snippets with no
// Markdown in them, kinds (Docs and Daily as filters), recent-first groups Today / This week / Earlier, the kind,
// project and words filters, and when-it-changed in a person's words. A new behaviour gets a check that would fail
// without it.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-notes-list-'));
let N;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/notes-list.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'n.mjs'), format: 'esm' }, logLevel: 'silent' });
  N = await import(pathToFileURL(path.join(work, 'n.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a snippet is one plain line: no Markdown marks, no front matter, no folder words', () => {
  const text = '---\ntype: note\n---\n\n# Plan\n\nNext: **Telstra invoice due Mon 26 Oct** and [[Harbour fit-out]]\n\nMore words.\n';
  assert.equal(N.plainSnippet(text), 'Next: Telstra invoice due Mon 26 Oct and Harbour fit-out');
});

test('a snippet skips pictures and tick boxes, and reads whole (t207 pass 2: rows wrap)', () => {
  assert.equal(N.plainSnippet('![[photo.png]]\n\n- [ ] \n\nRing the supplier about the keg steamer delivery\n'), 'Ring the supplier about the keg steamer delivery');
  const long = N.plainSnippet('word '.repeat(60));
  assert.ok(!long.includes('…') && long === 'word '.repeat(60).trim(), 'whole words, never dots');
});

test('kinds: a doc by type, a daily note by folder or date name, the rest plain notes', () => {
  assert.equal(N.noteKindOf({ path: 'Docs/Server.md', title: 'Server', typeId: 'doc' }), 'doc');
  assert.equal(N.noteKindOf({ path: 'Daily/2026-10-29.md', title: '2026-10-29', typeId: 'note' }), 'daily');
  assert.equal(N.noteKindOf({ path: 'Notes/Idea.md', title: 'Idea', typeId: 'note' }), 'note');
  assert.equal(N.noteKindOf({ path: 'Work/People/Priya.md', title: 'Priya', typeId: 'person' }), 'note');
});

test('groups: recent first in Today, This week, Earlier (Monday starts the week)', () => {
  const now = new Date(2026, 9, 29, 12, 0); // Thursday 29 Oct 2026
  const row = (title, mtime) => N.noteRow({ path: `${title}.md`, title, mtime });
  const groups = N.groupNoteRows([row('old', new Date(2026, 9, 20).getTime()), row('today', new Date(2026, 9, 29, 9).getTime()), row('monday', new Date(2026, 9, 26, 9).getTime()), row('sunday', new Date(2026, 9, 25, 9).getTime())], now);
  assert.deepEqual(groups.map((g) => [g.label, g.rows.map((r) => r.title)]), [['Today', ['today']], ['This week', ['monday']], ['Earlier', ['sunday', 'old']]]);
});

test('filters: by kind, by project and by words; Docs is a filter, not a place', () => {
  const rows = [
    { ...N.noteRow({ path: 'Docs/A.md', title: 'Alpha doc', typeId: 'doc', mtime: 3 }), project: { path: 'P/P.md', name: 'Harbour' }, snippet: 'How the server runs' },
    { ...N.noteRow({ path: 'Daily/2026-10-29.md', title: '2026-10-29', typeId: 'note', mtime: 2 }), snippet: 'Today words' },
    { ...N.noteRow({ path: 'Notes/B.md', title: 'Beta', typeId: 'note', mtime: 1 }), project: { path: 'P/P.md', name: 'Harbour' }, snippet: 'A plain note' },
  ];
  assert.deepEqual(N.filterNoteRows(rows, { kind: 'docs' }).map((r) => r.title), ['Alpha doc']);
  assert.deepEqual(N.filterNoteRows(rows, { kind: 'daily' }).map((r) => r.title), ['2026-10-29']);
  assert.deepEqual(N.filterNoteRows(rows, { kind: 'notes' }).map((r) => r.title), ['Beta']);
  assert.deepEqual(N.filterNoteRows(rows, { project: 'P/P.md' }).map((r) => r.title), ['Alpha doc', 'Beta']);
  assert.deepEqual(N.filterNoteRows(rows, { query: 'server' }).map((r) => r.title), ['Alpha doc']);
  assert.deepEqual(N.projectChoices(rows), [{ path: 'P/P.md', name: 'Harbour', count: 2 }]);
});

test('changed words and a heading snippet read as a person would say them', () => {
  const now = new Date(2026, 9, 29, 12, 0);
  assert.equal(N.changedWords(new Date(2026, 9, 29, 9, 41).getTime(), now), 'Today 9:41 am');
  assert.equal(N.changedWords(new Date(2026, 9, 28, 15, 5).getTime(), now), 'Yesterday 3:05 pm');
  assert.equal(N.snippetFor({ path: 'N.md', title: 'N', mtime: 1, headings: ['N', 'What was decided'] }), 'What was decided');
});

test('a snippet never shows a comment or a link mark (sweep 047/055, 076)', () => {
  assert.equal(N.plainSnippet('<!-- the host app keeps the part below up to date -->\n\nWrite your own notes above.\n'), 'Write your own notes above.');
  assert.equal(N.plainSnippet('Kept with [[Me/Finance/Spending/Files/receipt.pdf|the receipt]] from Monday.\n'), 'Kept with the receipt from Monday.');
  assert.equal(N.plainSnippet('See [[Juniper]] for the server.\n'), 'See Juniper for the server.');
});

test('a daily note shows its day in words, not its ISO name (sweep 049/057)', () => {
  assert.equal(N.dailyTitleWords('2026-10-28'), 'Wed 28 Oct 2026');
  assert.equal(N.dailyTitleWords('2026-02-30'), '');
  assert.equal(N.dailyTitleWords('Weekly review'), '');
  const row = N.noteRow({ path: 'Daily/2026-10-28.md', title: '2026-10-28', typeId: 'daily', mtime: 1 });
  assert.equal(row.displayTitle, 'Wed 28 Oct 2026');
  const plain = N.noteRow({ path: 'Notes/2026-10-28.md', title: '2026-10-28', typeId: 'note', mtime: 1 });
  assert.equal(plain.displayTitle, undefined);
});
