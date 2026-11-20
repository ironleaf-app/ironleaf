// node --test tests/notes-window.test.mjs — the Notes list draws a window, not every row (5 Nov 2026 speed
// audit item 6: 506 notes rendered 7,913 DOM nodes, snippets in 20-at-a-time rounds). Eighty rows at a time with
// the same rows and groups, Show more for the rest; snippets read in one round for the window. Same order, same
// filters, pinned still leading.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-notes-window-'));
let N;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/notes-list.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'n.mjs'), format: 'esm' }, logLevel: 'silent' });
  N = await import(pathToFileURL(path.join(work, 'n.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const now = new Date(2026, 10, 5, 12, 0);
const row = (i, mtime) => N.noteRow({ path: `n${i}.md`, title: `Note ${i}`, mtime });

test('a window keeps the order: pinned lead, then newest, regrouped with the same headers', () => {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(row(i, now.getTime() - i * 3600000));
  const pinned = ['n90.md'];
  const all = N.groupNoteRows(rows, now, { sort: 'changed', pinned }).flatMap((g) => g.rows);
  assert.equal(all[0].path, 'n90.md', 'the pinned old note heads the flat order');
  const page = all.slice(0, 80);
  assert.equal(page[0].path, 'n90.md', 'the slice keeps it');
  const groups = N.groupNoteRows(page, now, { sort: 'changed', pinned });
  assert.equal(groups[0].id, 'pinned', 'regrouped, Pinned still leads');
  assert.deepEqual(groups.flatMap((g) => g.rows).map((r) => r.path), page.map((r) => r.path), 'regrouping neither drops nor reorders');
  assert.ok(groups.some((g) => g.id === 'today'), 'time headers kept for the window');
});

test('the page draws eighty with Show more, and reads snippets in one round', () => {
  const src = readFileSync(path.join(root, 'src/renderer/src/views/NotesPage.tsx'), 'utf8');
  assert.match(src, /\[shownCount, setShownCount\] = useState\(80\)/, 'eighty rows at a time');
  assert.match(src, /flatAll\.slice\(0, shownCount\)/, 'the window slices the flat order');
  assert.match(src, /groupNoteRows\(flatShown, new Date\(\), \{ sort, pinned \}\)/, 'the window regroups for its headers');
  assert.match(src, /flatAll\.length > flat\.length/, 'Show more only past the window');
  assert.match(src, /Show more \(\{\s*flatAll\.length - flat\.length\s*\} left\)/, 'saying how many are left');
  assert.match(src, /setShownCount\(\(n\) => n \+ 80\)/, 'eighty more per press');
  assert.match(src, /setActive\(0\); setShownCount\(80\); \}, \[kind, folder, project, query, sort\]\)/, 'a new filter starts again');
  assert.match(src, /const missing = flat\.filter/, 'snippets for the drawn rows');
  assert.doesNotMatch(src, /missing\.slice\(0, 20\)/, 'no more 20-at-a-time rounds');
  assert.match(src, /Promise\.all\(fetch\.map\(/, 'one round for the window');
  assert.match(src, /s\.length === shown\.length \? \[\] : shown\.map/, 'tick-all still ticks the whole filtered set, not just the page');
  const css = readFileSync(path.join(root, 'src/renderer/src/styles/w2b.css'), 'utf8');
  assert.match(css, /\.w2b-more \{[^}]*justify-content: center/, 'Show more sits centred under its rows');
});
