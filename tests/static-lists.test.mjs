// A page that just opened never shows an open dialog or menu (8.6: the checker found "a dialog or menu is still open"
// on the Notes, Docs and Assets pages). The cause was the role, not a stuck popup: those pages' main lists used
// role="listbox" (a select popup's role), so they read as a menu left open. A static list on a page is role="list"
// with role="listitem"; role="listbox"/"option" is only for popups (a picker's choices, suggestions while typing,
// settings found while searching).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'src');
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = path.join(d, n);
    if (statSync(p).isDirectory()) { if (n !== 'assets') walk(p); }
    else if (n.endsWith('.tsx')) files.push(p);
  }
};
walk(src);

// Popups whose choices are genuinely a listbox (each only renders while it is open).
const POPUPS = new Set([
  'views/project/Inline.tsx',
  'views/assets/AssetPicker.tsx',
  'components/LevelPicker.tsx',
  'capture/CaptureBox.tsx',
  'components/Settings.tsx',
  // Rings (t82): the graph's Find suggestions, only while two or more letters are typed.
  'components/BrainGraphView.tsx',
]);

test('role=listbox is only a popup', () => {
  const bad = [];
  for (const f of files) {
    if (POPUPS.has(path.relative(src, f))) continue;
    if (/role="listbox"/.test(readFileSync(f, 'utf8'))) bad.push(path.relative(src, f));
  }
  assert.deepEqual(bad, []);
});

test('role=option is only a popup choice', () => {
  const bad = [];
  for (const f of files) {
    if (POPUPS.has(path.relative(src, f))) continue;
    if (/role="option"/.test(readFileSync(f, 'utf8'))) bad.push(path.relative(src, f));
  }
  assert.deepEqual(bad, []);
});

test('the pages that read as an open menu are plain lists now', () => {
  const notes = readFileSync(path.join(src, 'views', 'NotesPage.tsx'), 'utf8');
  assert.match(notes, /nj-list"[^>]*role="list"/, 'the notes list is a list');
  assert.match(notes, /role="listitem"/, 'its rows are items');
  const grid = readFileSync(path.join(src, 'views', 'assets', 'AssetGrid.tsx'), 'utf8');
  assert.match(grid, /as-body[^>]*role="list"/, 'the assets grid is a list');
  const tags = readFileSync(path.join(src, 'components', 'LifeHost.tsx'), 'utf8');
  assert.match(tags, /tm-list"[^>]*role="list"/, 'the tags list is a list');
});
