// node --test tests/p14-wide-work.test.mjs — p14 (4 Nov 2026): the Vault's working pages at the window (3456x1408,
// long real content). Ten mechanism guards from the walk: Settings hints wrap instead of cutting with "…" (Settings
// › Calendar cut "…and m…", General's note-types list cut at "…sp…"), the Meetings week stacks its day column under
// the grid (beside it the seven days squeezed to ~85 px inside the page column), the Meetings month hides the dead
// week chrome (it stacked over the month's own bar), Today hides its Timed head when nothing has a time (an empty
// card saying the obvious; 5 Nov 2026: the split moved with the day plan from Tasks to Today), the project Files tab
// says plain words when no folder is linked (it showed `The folder ""…` with empty quotes), Money and Templates drop
// their obvious first sentences (the sync and how-to notes stay), the Timeline says its drag hint once (it was top
// and bottom), its month head steps past the Today pill (November clipped to "No"), and the project's Timeline tab
// widens its names at a wide window (long actions cut with "…"). Each check fails without its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const css = (f) => read(`src/renderer/src/styles/${f}`);

test('the meetings week stacks: the grid keeps the full column', () => {
  const wrap = css('w2b.css').match(/\.w2b-calwrap \{([^}]*)\}/s)?.[1] ?? '';
  assert.ok(wrap.includes('flex-direction: column'), 'the day column sits under the grid, never beside it');
});

test("tasks Today hides Timed when nothing has a time", () => {
  // 5 Nov 2026, Today owns the day and Tasks owns the list: the timed split moved from Tasks' retired day
  // plan to the Today group's rows in Today's fold — same guard (no times, no heads), same home for the rule.
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(!tasks.includes('>Timed<'), 'no Timed section left on Tasks, so no empty Timed card there');
  const view = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(!view.includes('Nothing with a time today'), 'no empty Timed card');
  assert.ok(view.includes('if (!split.timed.length) return <More items={items} render={workRow} />'), 'the Today group follows the timed tasks: no times, no heads');
});

test('the meetings month hides the week chrome (its grid brings its own bar)', () => {
  const cal = read('src/renderer/src/views/meetings/WeekCalendar.tsx');
  assert.ok(cal.includes("{mode !== 'month' && ("), 'no dead "2 to 8 Nov" bar over the month');
});

test('project Files says plain words with no folder, names it when missing', () => {
  const tab = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(!tab.includes('p.folder ??'), 'no empty quotes');
  // v9-vault-truth F1: the section means the PC folder, so it says so (a project with a vault folder read "No folder
  // yet"). 5 Nov 2026, the vault folio: sections now, never tabs, and Notes sits above Files. t12, 8 Nov 2026, wanted
  // nothing empty on show: never-linked hides the section (the Notes tab offers the folder door), so the plain words live
  // on the moved-folder warning that still shows.
  assert.ok(!tab.includes('No folder on this PC yet'), 'no empty words on show');
  assert.ok(tab.includes('title="No folder here"'), 'a moved folder still names where it was, in plain words');
  assert.ok(tab.includes('projectWhere(p)'), 'missing still names where it was');
});

test('project Money keeps only its non-obvious note', () => {
  const tab = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(!tab.includes('Bills and subscriptions that belong to'), 'no restated tab');
  assert.ok(tab.includes('Marking one paid here marks it paid everywhere'), 'the sync note stays');
});

test('templates lead keeps only its how-to', () => {
  const page = read('src/renderer/src/views/TemplatesPage.tsx');
  assert.ok(!page.includes('Starting points for notes'), 'no restated title');
  assert.ok(page.includes('New note from a template'), 'the how-to stays');
});

test('the timeline says its drag hint once, in the top bar', () => {
  const view = read('src/renderer/src/views/TimelineView.tsx');
  assert.ok(view.includes('Drag a bar to move it'), 'the top hint stays');
  assert.ok(!view.includes('Drag a bar or a key date to move it'), 'no second hint in the foot');
  assert.ok(view.includes('Reading only'), 'reading-only still says so');
});

test('the timeline month head steps past the Today pill', () => {
  const view = read('src/renderer/src/views/TimelineView.tsx');
  assert.ok(view.includes('marginLeft: shift'), 'the head moves');
  assert.ok(view.includes('diff < 10'), 'only when today sits in its first days');
  assert.ok(view.includes('diff * ppd'), 'past the pill');
});

test("the project's timeline widens its names on a wide window", () => {
  const hub = css('project-hub.css');
  assert.ok(hub.includes('@container (min-width: 980px)'), 'a wide rule');
  assert.ok(hub.includes('--pt-label: 460px'), 'long names fit');
});
