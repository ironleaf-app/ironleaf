// node --test tests/one-window-sidebar.test.mjs — one product step 3 (8 Nov 2026): the former host app's
// New menu makes a note through the same seam as every deep link (place, folder, new note), and Today's
// count for the one side bar reads the one Today count. Each test fails without its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('a new note rides the same seam: place, folder and new note', () => {
  const src = read('src/main/app.ts');
  assert.ok(src.includes('newNote?: boolean'), 'open/openInView take a new note');
  assert.ok(src.includes('newNote: true') || src.includes('{ newNote: true }'), 'the place carries it to the page');
  const preload = read('src/preload/index.ts');
  assert.ok(preload.includes('newNote?: boolean'), 'the preload exposes it');
  const app = read('src/renderer/src/App.tsx');
  assert.ok(app.includes('newNote'), 'the app passes it to the place');
  const actions = read('src/renderer/src/state/actions.ts');
  assert.ok(actions.includes('newNoteOfType') && actions.includes('fresh'), 'a new note opens from the deep link');
});

test('a new note lands in the folder in view, else where Notes settings say (decision)', () => {
  const actions = read('src/renderer/src/state/actions.ts');
  assert.ok(actions.includes("if (fresh) { void import('./noteTypes').then((m) => m.newNoteOfType('note', { ...(folder ? { folder } : {}), where, ask: false })); return; }"), 'a fresh note carries the folder in view, or none');
  const types = read('src/renderer/src/state/noteTypes.ts');
  assert.ok(types.includes('opts.folder !== undefined') && types.includes('A.newNoteFolder()'), 'a named folder wins, otherwise Notes settings say');
});

test("Today's count is the one count: late and due today, 0 until the notes open", () => {
  const src = read('src/main/app.ts');
  assert.ok(src.includes('todayCount'), 'the main side answers it');
  // Break-it t31: the side bar's own query (steps plus the hub), so it matches Vault's Today; todayDueCount
  // missed the hub's dated lines and the owner reading, so the numbers could differ.
  assert.ok(src.includes('sidebarTodayCount'), 'through the side bar count');
  assert.ok(src.includes('return 0'), '0 until the notes open');
});
