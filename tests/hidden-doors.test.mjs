// node --test tests/hidden-doors.test.mjs — machinery sits under Show everything, but every note keeps its doors
// (b6 break job, Nov 2026: fewer folders hides the app's folders from three trees — the count beside the line must
// match what is hidden, the switch must be one switch, and search, filing and making notes must reach hidden folders
// untouched). Invented vault shaped like the fewer-folders one: own areas, machinery, a same-name folder-note pair.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-hidden-doors-'));
let F;
let N;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [`export * as fewer from ${JSON.stringify(path.join(root, 'src/shared/fewer-folders.ts'))};`, `export * as navigator from ${JSON.stringify(path.join(root, 'src/shared/navigator.ts'))};`, ''].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'f.mjs'), format: 'esm' }, logLevel: 'silent' });
  const M = await import(pathToFileURL(path.join(work, 'f.mjs')).href);
  F = M.fewer;
  N = M.navigator;
});
after(() => rmSync(work, { recursive: true, force: true }));

const T = Date.parse('2026-11-05T09:00:00');
const note = (p, props = {}, ago = 1) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), label: p.split('/').pop().replace(/\.md$/, ''), mtime: T - ago * 86400000, props });
const areasWith = () => [
  { id: 'work', name: 'Work', folder: 'Work', icon: 'briefcase', color: 'slate', about: '' },
  { id: 'me', name: 'Me', folder: 'Me', icon: 'person', color: 'sky', about: '' },
];
const ctxWith = () => ({ templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments', dailyFolder: 'Daily', docsFolder: 'Docs', areas: areasWith(), moduleFolders: ['Me/Finance'] });
const filesWith = () => [
  { rel: 'Work/Notes/Kick-off.md', mtime: T, kind: 'note' },
  { rel: 'Templates/Meeting.md', mtime: T, kind: 'note' },
  { rel: 'Daily/2026-11-05.md', mtime: T, kind: 'note' },
  { rel: 'Me/Finance/Bills/Internet.md', mtime: T, kind: 'note' },
  { rel: 'Assets/Logos/Bakehouse logo.svg', mtime: T, kind: 'image' },
  { rel: 'Views/Reading list.view.json', mtime: T, kind: 'view' },
];

test('the count beside Show everything counts hidden files, never folders', () => {
  assert.equal(typeof F.hiddenFileCount, 'function', 'one count helper beside the machinery reading');
  const ctx = ctxWith();
  // Notes, canvases and views: the tree's rows. Folders are structure, never counted.
  assert.equal(F.hiddenFileCount(filesWith(), ctx, false), 4, 'Templates, Daily, Finance and Views notes hide; the image is not a row');
  assert.equal(F.hiddenFileCount(filesWith(), ctx, true), 5, 'showing all files, the hidden image counts too');
  assert.equal(F.hiddenFileCount([], ctx, false), 0, 'nothing hidden, no count');
  const src = read('src/renderer/src/panels/FileExplorer.tsx');
  assert.ok(src.includes('hiddenFileCount('), 'the folder tree counts with the one helper');
});

test('the panel’s two modes share one Show everything switch, remembered on this PC', () => {
  const folders = read('src/renderer/src/panels/FileExplorer.tsx');
  const nav = read('src/renderer/src/panels/Navigator.tsx');
  assert.ok(folders.includes("localStorage.getItem('nv-folders-show-all')"), 'the folders mode reads the one key');
  assert.ok(nav.includes("localStorage.getItem('nv-folders-show-all')"), 'the sections mode reads the same key');
  assert.ok(nav.includes('nv-nav-show-all'), 'a sections memory from before still carries over');
  const notes = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(notes.includes("SHOW_ALL_MEMORY = 'nv-notes-show-all'"), 'the Notes page keeps its own switch: records and machinery, a wider show');
});

test('filing and making notes reach hidden folders untouched', () => {
  for (const [file, where] of [['src/renderer/src/panels/Navigator.tsx', 'sections'], ['src/renderer/src/panels/FileExplorer.tsx', 'folders']]) {
    const src = read(file);
    assert.ok(src.includes('pickFolder(getState().folders)'), `Move to… in ${where} offers every folder, hidden or not`);
  }
  const types = read('src/renderer/src/state/noteTypes.ts');
  assert.ok(types.includes('contextOf(getState().folders'), 'a new note still goes in any folder, hidden or not');
});

test('a folder collapsed into its same-name note keeps the note’s place', () => {
  const notes = [note('Work/Notes/Kick-off.md'), note('Home/Garden/Garden.md')];
  const files = notes.map((n) => ({ rel: n.path, mtime: n.mtime, kind: 'note' }));
  const s = N.buildSections(notes, files, ['Work', 'Work/Notes', 'Home', 'Home/Garden'], { templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments', dailyFolder: 'Daily', todayName: '2026-11-05', showAllFiles: true });
  const walk = (f) => [...f.items.map((i) => i.path), ...f.folders.flatMap(walk)];
  assert.ok(walk(s.notes).includes('Home/Garden/Garden.md'), 'the note still shows');
  assert.deepEqual(s.place.get('Home/Garden/Garden.md'), { section: 'notes', folders: ['Home'] }, 'its place reads the parent’s folders, the gone folder row aside');
});
