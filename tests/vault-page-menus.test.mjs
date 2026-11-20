// node --test tests/vault-page-menus.test.mjs — a project page's ⋯ menu ran to 35 flat rows (4 Nov
// 2026). The handful a person uses stays at the top; the rest sits in clearly named groups of the
// existing Menu component; Publish and Export no longer double the header's buttons; nothing a person
// can do is lost. Same treatment, same mechanism, for a note's ⋯ menu. Each check fails without its fix
// (the old flat rows, the removed duplicates).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const menus = read('src/renderer/src/state/menus.ts');
const page = read('src/renderer/src/views/ProjectPage.tsx');

test('a note’s ⋯ menu: the view switch and the sends stay flat, the rest sits in four named groups', () => {
  for (const g of ['View', 'Note', 'File', 'Tab']) assert.ok(menus.includes(`label: '${g}'`), `the ${g} group`);
  assert.ok(menus.includes("label: 'View', icon: 'eye', submenu: viewSub"), 'View opens its submenu');
  assert.ok(menus.includes("label: 'Note', icon: 'notes', submenu: noteSub"), 'Note opens its submenu');
  assert.ok(menus.includes("label: 'File', icon: 'file', submenu: fileSub"), 'File opens its submenu');
  assert.ok(menus.includes('label: \'Tab\''), 'Tab opens its submenu');
  // The handful at the top, in plain words, one click away.
  for (const row of ['Reading', 'Live Preview', 'Source']) assert.ok(menus.includes(`label: '${row}'`), `${row} stays flat`);
  assert.ok(menus.includes('...sendItems(path)'), 'the sends stay flat at the top');
  assert.ok(menus.includes("label: 'Delete'"), 'Delete stays flat at the bottom');
  // The groups hold what the flat menu held.
  const view = menus.slice(menus.indexOf('const viewSub'), menus.indexOf('const noteSub'));
  for (const row of ['context panel', 'Present as slides', 'Show as canvas', 'Update canvas from doc']) assert.ok(view.includes(row), `View holds ${row}`);
  assert.ok(view.includes('...notebookFlat(path)'), 'View holds the notebook rows');
  const flat = menus.slice(menus.indexOf('function notebookFlat'));
  for (const row of ['Review flashcards', 'Read aloud (or stop)', 'Open its notebook']) assert.ok(flat.includes(row), `View holds ${row}`);
  const note = menus.slice(menus.indexOf('const noteSub'), menus.indexOf('const fileSub'));
  for (const row of ['Add a property', 'Earlier versions', 'Bookmark']) assert.ok(note.includes(row), `Note holds ${row}`);
  assert.ok(note.includes('levelMenuEntry(path)'), 'Note holds Sensitivity');
  const file = menus.slice(menus.indexOf('const fileSub'), menus.indexOf('return [', menus.indexOf('const fileSub')));
  for (const row of ['Rename', 'Move to…', 'Merge into another note…', 'Make a copy', 'Save as template…', 'Turn into a doc…', 'Turn into a project…', 'Show in the file list', 'Show in File Explorer', 'Copy its path']) assert.ok(file.includes(row), `File holds ${row}`);
});

test('Publish is always in the header: Facts and the folio both show it (p16; the folio has no tabs to hide it)', () => {
  const sub = page.slice(page.indexOf('const projectSub'), page.indexOf('return [', page.indexOf('const projectSub')));
  assert.ok(!sub.includes('publishItem()'), 'Project never carries Publish: the header always does');
  assert.equal((page.match(/>Publish</g) || []).length, 2, 'two header Publish buttons: Facts and the folio');
});

test('the header’s overflow fold still feeds the same ⋯ menu (its contract lives in vault-header-overflow)', () => {
  // 5 Nov 2026, the vault folio: the fold maps exactly the header's buttons (each section carries its own
  // primary in its head, so no add-* key folds any more).
  for (const key of ['fields', 'share', 'publish', 'people']) {
    assert.ok(page.includes(`'${key}':`), `the fold still maps ${key}`);
    assert.ok(page.includes(`data-overflow="${key}"`), `the header still carries ${key}`);
  }
  for (const key of ['add-task', 'add-note', 'attach', 'add-person', 'add-decision', 'add-milestone']) {
    assert.ok(!page.includes(`'${key}':`), `no fold for ${key}: it lives in its section head`);
  }
  assert.ok(page.includes('overflowMenuItems(headerOverflowHidden('), 'the ⋯ menu still carries exactly the hidden buttons');
  // 5 Nov 2026, the clean header: a note's header holds Share, Read and the Private mark only; Publish,
  // Yesterday/Tomorrow, Project page and Dictate moved into the ⋯ menu itself (menus.ts), where the sends and
  // the canvas pair already were.
  const note = read('src/renderer/src/views/NoteView.tsx');
  for (const key of ['share', 'private', 'read']) {
    assert.ok(note.includes(`'${key}':`), `a note still maps ${key}`);
  }
  for (const key of ['publish', 'yesterday', 'tomorrow', 'send', 'canvas', 'update-canvas', 'project-page']) {
    assert.ok(!note.includes(`data-overflow="${key}"`), `no ${key} button left in the header`);
  }
  assert.ok(note.includes('overflowMenuItems(headerOverflowHidden('), 'a note’s ⋯ menu still carries exactly the hidden buttons');
  for (const row of ['Publish as a website…', 'Yesterday', 'Tomorrow', 'Project page', 'Dictate']) {
    assert.ok(menus.includes(row), `the ⋯ menu carries ${row}`);
  }
});
