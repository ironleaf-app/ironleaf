// node --test tests/app-shell.test.mjs — Job A shell contracts (29 Oct 2026, SPEC section A; the bar itself rebuilt 8.7
// wave 1, item 2, per): the spec bar's fixed order, counts only where the mock-ups put them, Pinned and the kinds one
// click away in More, the packs as their own group only while switched on, one PageHead, the spec top bar, plain words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('the bar keeps the quiet order, with counts on Today and Inbox only', () => {
  // 5 Nov 2026, one search door and a quiet rail: Today, Inbox, Projects, Tasks, Meetings, Notes, People, More;
  // Search left for the centred bar, Home/Shared spaces/packs left for More. No Areas tree, no kinds tree.
  const places = read('src/renderer/src/panels/Places.tsx');
  for (const row of ["label: 'Today'", "label: 'Inbox'", "label: 'Projects'", "label: 'Tasks'", "label: 'Meetings'", "label: 'Notes'", "label: 'People'"]) assert.ok(places.includes(row), `the bar's ${row}`);
  const at = (words) => places.indexOf(words);
  assert.ok(at("<Row row={f.today} />") < at("<Row row={f.inbox} />") && at("<Row row={f.inbox} />") < at("<Row row={f.projects} />"), 'Today, Inbox, Projects');
  assert.ok(at("<Row row={f.projects} />") < at("<Row row={f.tasks} />") && at("<Row row={f.tasks} />") < at("<Row row={f.meetings} />"), 'Projects, Tasks, Meetings');
  assert.ok(at("<Row row={f.notes} />") < at("<Row row={f.people} />"), 'Notes before People');
  assert.ok(at('>More<') > at("<Row row={f.people} />"), 'More after the rows');
  assert.ok(!places.includes('<AreasPlaces'), 'no Areas tree on the bar');
  assert.ok(!places.includes('calm-kind'), 'no kinds tree on the bar');
  // Counts: Today and Inbox on their rows; the Tasks page reads its own late count; the rail dots a waiting Inbox.
  assert.ok(places.includes('count: counts.due') || places.includes('count: due'), 'the Today count');
  assert.ok(places.includes('useInboxCount()'), 'the Inbox count');
  assert.ok(!places.includes('projectsCount'), 'no Projects count');
  assert.ok(places.includes('className="dot"'), 'the rail dots a waiting Inbox');
  // Pinned keep one click in More (up to five); kinds, Shared spaces and the packs are back in More's
  // quiet second group (9 Nov 2026) and still answer in Ctrl+K by name.
  assert.ok(places.includes('pinItems') && places.includes('slice(0, 5)'), 'pinned in More, up to five');
  assert.ok(places.includes("label: 'Other kinds'"), 'kinds back in More as one submenu');
  assert.ok(read('src/renderer/src/components/Modals.tsx').includes('typePaletteRows('), 'kinds answer in Ctrl+K');
  // Home folded into Today: no Home row anywhere; old links to Home open Today.
  assert.ok(!places.includes("label: 'Home'"), 'no Home row anywhere');
  assert.ok(places.includes("label: 'Shared spaces'"), 'Shared spaces back in More');
  assert.ok(!places.includes("heading: 'Packs'"), 'no old packs section in More (Packs and kinds holds them now)');
  assert.ok(read('src/renderer/src/state/commands.ts').includes("id: 'shared-spaces'"), 'Ctrl+K opens Shared spaces');
});

test('one page header: TypePage is on PageHead, its props kept, a quiet path added', () => {
  const head = read('src/renderer/src/components/PageHead.tsx');
  for (const prop of ['icon?', 'title:', 'count?', 'lead?', 'actions?', 'className?']) assert.ok(head.includes(prop), `PageHead keeps ${prop}`);
  assert.ok(head.includes('path?'), 'PageHead gains an optional quiet path');
  assert.ok(head.includes('leadTone?'), 'the lead is coloured only when it needs attention');
  const type = read('src/renderer/src/views/TypePage.tsx');
  assert.ok(type.includes('<PageHead'), 'TypePage draws the one header');
  assert.ok(!type.includes('ViewHeader'), 'TypePage has no second header bar');
});

test('the slim top bar: back, forward, New, the crumb, actions right, never centred', () => {
  // 8.7 wave 1, item 4 replaces the quiet path band with the mock-ups' top bar (back/forward through the tab's own
  // history, a plus for the New door); the title still never centres.
  const bar = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(bar.includes('title="Back"') && bar.includes('W.navigate(w, tab.id, -1)'), 'Back through the tab’s history');
  assert.ok(bar.includes('title="Forward"') && bar.includes('W.navigate(w, tab.id, 1)'), 'Forward through the tab’s history');
  assert.ok(bar.includes('title="New"') && bar.includes('openNewDoor('), 'a plus for the New door (8 Nov 2026, the quiet More)');
  assert.ok(bar.includes('className="crumb"'), 'the breadcrumb, clipped to one line');
  assert.ok(bar.includes('className="right"'), 'the page’s actions on the right');
  assert.ok(!bar.includes('textAlign') && !bar.includes('justify-content: center') && !bar.includes('place-items: center'), 'nothing centred');
  const kit = read('src/renderer/src/styles/kit.css');
  // 57px is the minimum now, never wrapping (3 Nov 2026; the bar that wrapped to a second row put the bell, Ask
  // and the avatar under the search. Shell parity, 4 Nov 2026: the token is 56px + the hairline, the former
  // host app's 57px conversation bar).
  assert.match(kit, /\.topbar \{[^}]*min-height: var\(--header-h\)[^}]*display: grid/, '57px at rest, one row always (10.0 Endless Tech header; Round 5: the grid columns never wrap)');
});

test('tabs are off unless the person turns them on', () => {
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.ok(settings.includes('title="Open pages in tabs"'), 'the setting in plain words');
  assert.ok(!settings.includes('title="Show tabs"'), 'the old words are gone');
});

test('the polish system is one new file, theme tokens only', () => {
  const css = read('src/renderer/src/styles/app-shell.css');
  assert.ok(css.includes('prefers-reduced-motion'), 'motion respects the person’s setting');
  assert.ok(css.includes('tabular-nums'), 'numbers line up');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), 'no new colours, tokens only');
  assert.ok(read('src/renderer/src/App.tsx').includes("styles/app-shell.css"), 'the shell loads it');
});
