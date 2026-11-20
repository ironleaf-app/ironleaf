// node --test tests/p15-person.test.mjs — A person, and People (p15-person, 4 Nov 2026): You owe and Owes you
// titles read on two lines in the row's full room instead of cut far too early, the person's page widens on a
// wide window while other reading pages keep the column, the halves' titles open on their line as the timeline
// does, a fresh read replaces local ticks, and a person tile says what its clicks do. Each test fails without
// its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const person = () => read('src/renderer/src/views/PersonPage.tsx');
const people = () => read('src/renderer/src/views/PeoplePage.tsx');
const css = () => read('src/renderer/src/styles/w2b.css');

test("the halves' titles read on two lines, in the row's full room", () => {
  // t255: the Overview wraps whole in its narrow columns; the tab keeps the two-line clamp.
  assert.ok(person().includes("`w2b-link t${wrap ? '' : ' clip-2'}"), 'halves titles take the kit two-line clamp, not the one-line clip');
  assert.ok(!person().includes('w2b-link t clip"'), 'no one-line halves title left');
  assert.ok(person().includes("wrap ? { whiteSpace: 'normal', overflowWrap: 'break-word' }"), 'the Overview wraps whole, never cut with dots');
  assert.match(css(), /\.w2b-half \.trow > \.t\s*\{[^}]*flex:\s*1/, 'the title takes the row free room, as the timeline does');
});

test('the person page widens on a wide window and keeps the column elsewhere', () => {
  assert.ok(person().includes('nv-page read'), 'still a reading page in the column');
  assert.ok(css().includes('.nv-page.read.w2b-person'), 'the widening names the person page only');
});

test('the halves titles open on their line, as the timeline does', () => {
  assert.match(person(), /A\.openPath\(x\.path, \{ where: 'current', \.\.\.\(x\.line !== undefined \? \{ line: x\.line \} : \{\}\) \}\)/, 'halves land on the action line');
});

test('a fresh read replaces local ticks', () => {
  assert.match(person(), /useEffect\(\(\) => \{ setDone\(new Set\(\)\); \}, \[items\]\);/, 'a tick put back in its note reads open again');
});

test('a person tile says what its clicks do', () => {
  assert.ok(people().includes('Open their page, with everything joined to'), 'a click opens their page');
  assert.ok(people().includes('(double-click: their note)'), 'a double-click opens their note');
  assert.ok(!people().includes('Open in the peek with everything joined to'), 'the old peek words are gone');
});
