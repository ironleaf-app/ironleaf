// node --test tests/shape-87.test.mjs — the one page shape (8.7 wave 1, item 4): the slim top bar over every tab's
// page, the title, key facts as label/value rows, one view bar, then content, all starting at one left edge; reading
// pages in the 920 px column, boards and calendars full width. Waves 2 to 4 move each page's own content onto it;
// this wave builds the shared shape and proves it on a person page. Fails without each change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { cssPxFor } from './css-px.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => cssPxFor(p, readFileSync(path.join(root, p), 'utf8'));

test('the top bar over every page: back, forward, New, the crumb, actions right', () => {
  const bar = read('src/renderer/src/views/ViewHeader.tsx');
  for (const bit of ['title="Back"', 'title="Forward"', 'title="New"', 'className="crumb"', 'className="right"', 'className={`topbar']) assert.ok(bar.includes(bit), `the bar ${bit}`);
  assert.ok(bar.includes('W.navigate(w, tab.id, -1)') && bar.includes('!tab.back.length'), 'Back walks the tab’s own history, quiet when there is none');
  assert.ok(bar.includes('!tab.forward.length'), 'Forward likewise');
  assert.ok(bar.includes('openNewDoor('), 'the plus opens the New door (8 Nov 2026, the quiet More)');
  // 5 Nov 2026, one search door: the Ask button left the bar for the centred bar's panel (Ctrl+J still asks).
  assert.ok(!bar.includes('toggleChat'), 'no Ask button on the bar');
  assert.ok(bar.includes('className="top-search"'), 'the centred bar stays');
  assert.ok(read('src/renderer/src/views/Workspace.tsx').includes('<ViewHeader'), 'every tab’s page keeps the bar');
});

test('key facts are one shared component, and a person page uses it', () => {
  const head = read('src/renderer/src/components/PageHead.tsx');
  assert.ok(head.includes('export function PageProps'), 'the shared facts rows');
  assert.ok(head.includes('className="props page-props"') && head.includes('className="prow"'), 'the kit’s label/value shape');
  assert.ok(read('src/renderer/src/views/ProjectPage.tsx').includes('PageProps'), 'a project page proves the shared rows');
  // A person page reads its facts as the mock-up's one pills row (8.7 w2b round 2, a user holding the mock beside
  // the app): mail, phone, last met and the next meeting, in the same .metapills row the meeting page wears.
  const person = read('src/renderer/src/views/PersonPage.tsx');
  for (const bit of ['metapills', 'pill outline', 'Copy their email', 'Copy their phone', 'Last met']) assert.ok(person.includes(bit), `a person’s facts ${bit}`);
  assert.ok(read('src/renderer/src/views/modules/work/MeetingsPage.tsx').includes('metapills'), 'the meeting page wears the same row');
});

test('reading pages read at 920, boards and calendars run full width, one left edge', () => {
  const frame = read('src/renderer/src/styles/page-frame.css');
  // 20 Nov 2026: the reading column is the named --w-reading (720 px of text) plus the frame's gutters.
  assert.ok(frame.includes('--w-reading: 720px') && frame.includes('--page-read: calc(var(--w-reading) + 2 * var(--page-pad-side))'), 'the reading column');
  assert.match(frame, /\.nv-page\.read \{\s*max-width: var\(--page-read\)/, 'reading pages take it');
  assert.match(frame, /\.nv-page\.full \{\s*max-width: none/, 'boards and calendars run full width');
  // p27 title air supersedes the 24 px pad (it sat Today's date 4 px under the header's line, cramped): 36 px
  // above the title, as the spec's --page-pad and the kit's .vpage already say, every title at 92.
  assert.ok(frame.includes('--page-pad-top: 36px') && read('src/renderer/src/styles.css').includes('--space-6: 36px'), '36 px above the title'); // the scale lives in styles.css
  assert.ok(read('src/renderer/src/views/PersonPage.tsx').includes('nv-page read'), 'a reading page in the column');
  // One left edge: the column's sides come from the one gutter on every page.
  assert.ok(frame.includes('padding-left: var(--page-pad-side)') && frame.includes('padding-right: var(--page-pad-side)'), 'the one gutter');
});
