// node --test tests/sweep-81.test.mjs — the 8.1 sweep fixes that live in the window (src/renderer/src): a
// picker cancelled when its page goes, record values in plain words, the person's own name kept off
// Meetings, one late count for the badge and the Tasks page, and honest project health. The pure readings
// behind them are checked in notes-list, plan and vault-files; these checks keep the wiring that uses them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('a pending pick is cancelled when the page changes (sweep 058 on)', () => {
  assert.match(read('src/renderer/src/components/Pickers.tsx'), /export function cancelPick/);
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /cancelPick\(\)/);
  assert.match(app, /pageNow\.path/);
});

test('record values are shown in plain words, never link marks (sweep 076/086)', () => {
  const parts = read('src/renderer/src/views/workspace/recordParts.tsx');
  assert.match(parts, /plainText\(String\(v\)\)/);
});

test('Meetings reads who the person is as state, through visibleWho (sweep 032)', () => {
  const page = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.match(page, /function useMe\(\)/);
  assert.match(page, /visibleWho/);
  assert.doesNotMatch(page, /let ME:/);
});

test('the Tasks page reads the one late count; the bar carries no badge (sweep 001/008)', () => {
  // 5 Nov 2026, the quiet rail: counts sit on Today and Inbox only, so the Tasks-late badge left the bar;
  // the Tasks page still reads the shared lateForYouCount, as it always did.
  assert.doesNotMatch(read('src/renderer/src/panels/Places.tsx'), /lateForYouCount/);
  assert.match(read('src/renderer/src/views/TasksView.tsx'), /taskInfos/);
  assert.match(read('src/renderer/src/components/plan/plan.ts'), /export function lateForYouCount/);
});

test('project health weighs late work, and finished cards ask for nothing (sweep 022-024)', () => {
  // 9.2 uplift F17: the reading moved to the shared lib/projectLook.ts so every card weighs the same; the home
  // and the area page both read it from there.
  const home = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.match(home, /effectiveHealth,[^}]*healthPill, healthTone/);
  assert.match(home, /finished \?/);
  assert.match(read('src/renderer/src/lib/projectLook.ts'), /export function effectiveHealth/);
  assert.match(read('src/renderer/src/views/AreaPage.tsx'), /effectiveHealth\(c\)/);
});

test('a Notes chip carries its full name and may take its room (sweep 042)', () => {
  assert.match(read('src/renderer/src/views/NotesPage.tsx'), /nj-chip" title=/);
  assert.match(read('src/renderer/src/styles/premium-layer.css'), /\.nj-chip \{\s*max-width: 280px/);
});

test('Due soon is still to come; overdue projects need attention (29 Oct sweep 022)', () => {
  const home = readFileSync(new URL('../src/renderer/src/views/ProjectsHome.tsx', import.meta.url), 'utf8')
  // 5 Nov 2026, status in plain words: display tones no longer separate soon from later (both read muted),
  // so Due soon reads the days through isDueSoon — still to come within a week, never overdue, never finished.
  assert.match(home, /if \(f === 'due'\) return isDueSoon\(c\.due, c\.status\)/)
  assert.match(home, /due: live\.filter\(\(c\) => isDueSoon\(c\.due, c\.status\)\)/)
  assert.match(home, /\['warn', 'bad'\]\.includes\(healthTone\(effectiveHealth\(c\)\)\)/, 'Needs attention keeps warn and bad (overdue reads bad)')
  // One standing, 8 Nov 2026: the overdue rule lives in src/shared/project-standing.ts now, read by every page.
  const standing = readFileSync(new URL('../src/shared/project-standing.ts', import.meta.url), 'utf8')
  assert.match(standing, /c\.overdue && healthTone\(c\.health\) !== 'bad'\) return 'Overdue'/)
  assert.match(standing, /blocked\|overdue/)
  const look = readFileSync(new URL('../src/renderer/src/lib/projectLook.ts', import.meta.url), 'utf8')
  assert.match(look, /effectiveHealthOf\(\{ health: c\.health, lateMine: c\.lateMine, overdue:/, 'projectLook weighs through the one standing')
})

test('sweep 3: summary leads join their parts with " · ", never bare spans', () => {
  for (const rel of ['src/renderer/src/views/TimelineView.tsx']) {
    const src = read(rel);
    assert.match(src, /aria-hidden="true"> · <\/span>/, rel);
  }
});

test('sweep 3: Bookmarks is a page, and the left nav never changes shape for it', () => {
  assert.match(read('src/renderer/src/state/actions.ts'), /export function openBookmarks/);
  assert.match(read('src/renderer/src/panels/Places.tsx'), /A\.openBookmarks\(\)/);
  assert.match(read('src/renderer/src/views/Workspace.tsx'), /tab\.type === 'bookmarks'/);
  assert.doesNotMatch(read('src/renderer/src/panels/Sidebars.tsx'), /panel === 'bookmarks' &&/);
});

test('sweep 3: Assets has one heading line and one card per file', () => {
  assert.doesNotMatch(read('src/renderer/src/views/AssetsPage.tsx'), /as-section-title/);
  assert.match(read('src/main/assets.ts'), /One file, one card/);
});

test('sweep 3: record cells cap people, read times one way, and keep the project to one line', () => {
  const parts = read('src/renderer/src/views/workspace/recordParts.tsx');
  assert.match(parts, /names\.slice\(0, 3\)/);
  assert.match(parts, /meetingTimeWords/);
  assert.match(parts, /className="ws-proj-ref" title=/);
  assert.match(parts, /visibleWho/);
});

test('sweep 3: one left edge (tabs, Assets, Today, Timeline)', () => {
  const css = read('src/renderer/src/styles/polish-shell.css');
  assert.match(css, /\.sv-page > \.rm-tabs/);
  assert.match(css, /\.as-main > \.nv-page-head/);
  assert.match(css, /\.tl-board\.tl-board/);
  assert.match(read('src/renderer/src/styles/module-purpose.css'), /white-space: nowrap/);
});

test('sweep 3: finished projects carry no health pill or counts; drafts are their own group', () => {
  const home = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.match(home, /finished \? null : health/);
});
