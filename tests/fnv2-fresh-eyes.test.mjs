// node --test tests/fnv2-fresh-eyes.test.mjs — 9.5 fresh eyes (2 Nov 2026): Private notes, Settings, Search and
// Import in plain words a person can act on, and a Private list that counts what it shows. Each check fails
// without its fix in the findings (items 2-6; item 1 is proven in tests/private-notes.test.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('Private notes: the subtitle is plain, with no em dash and no unnamed helper', () => {
  // 10.0 v2locked: the promise lives on the one Locked page now.
  const src = read('src/renderer/src/views/PrivateView.tsx') + read('src/renderer/src/views/LockedView.tsx');
  assert.ok(!src.includes('the helper only touches'), 'no unnamed helper');
  assert.ok(src.includes('Nothing else reads them: not search, the graph, or any other program'), 'what stays locked, in plain words');
});

test('Private notes: searching counts what is shown and keeps newest first', () => {
  const src = read('src/renderer/src/views/PrivateView.tsx');
  assert.ok(src.includes('shown.length} of ${notes.length}'), 'the count names the matches out of the whole');
  assert.ok(src.includes('.sort((a, b) => b.modified - a.modified) : notes)'), 'matches sorted newest first, like the full list');
  assert.ok(!src.includes('{notes.length} {notes.length === 1'), 'the bare total no longer stands in for the matches');
});

test('Settings, Plugins: no file names where a person decides', () => {
  const src = read('src/renderer/src/components/Settings.tsx');
  assert.ok(!src.includes('manifest (plugin.json)'), 'no manifest jargon');
  assert.ok(!src.includes('one script (plugin.js)'), 'no script jargon');
  assert.ok(src.includes('A plugin adds a command you can run and a card on Home.'), 'what a plugin does, in plain words');
});

test('Search: the pattern operator is taught by example, not by name', () => {
  const src = read('src/renderer/src/components/SearchView.tsx');
  assert.ok(!src.includes('regular expression'), 'no jargon in the operators list');
  assert.ok(src.includes('words matching a pattern, like a four-digit year'), 'the example teaches it');
});

test('Import: the words a person reads have no em dashes', () => {
  const src = read('src/renderer/src/views/ImportView.tsx');
  const seen = src.split('\n').filter((l) => /className="(vsub|im-drop-sub|ds)"/.test(l) || l.includes('Bring outside stuff in'));
  assert.ok(seen.length >= 3, 'the subtitle lines are there to check');
  for (const line of seen) assert.ok(!line.includes('—'), `no em dash: ${line.trim().slice(0, 60)}`);
  assert.ok(src.includes('You see where each bit goes first, and you can undo it.'), 'the promise kept, plainly');
});
