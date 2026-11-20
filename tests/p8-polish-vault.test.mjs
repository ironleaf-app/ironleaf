// node --test tests/p8-polish-vault.test.mjs — wave 8 vault polish (4 Nov 2026): one name for one thing, one
// look for one control, plain words. Each check fails without its fix (see the polish list F1-F12).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('F1 the empty inbox joins the No family and captures in one word', () => {
  const src = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(src.includes('title="Nothing waiting"'), 'empty title is plain');
  assert.ok(!src.includes('Inbox zero'), 'no jargon title left');
  assert.ok(src.includes("action={{ label: 'Capture',"), 'empty action matches the header Capture');
  assert.ok(!src.includes('Capture something'), 'no second name for capturing');
});

test('F2 the inbox sort is light, labelled in full, with no Sort word', () => {
  const src = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(src.includes('className="chip"\n              aria-haspopup="menu"\n              aria-label="How the inbox is ordered"'), 'light chip carrying its purpose');
  assert.ok(!src.includes(".replace(' first', '')"), 'the full sort name shows');
  assert.ok(!src.includes('>Sort</span>'), 'no visible Sort label beside it');
});

test('F3 the notes lead counts in whole words and says nothing twice', () => {
  // 5 Nov 2026 (context calm): the lead said one number twice ("27 notes changed today. 27 notes, docs and
  // daily notes.") beside a title count and an All chip saying it again. One count now: the changed-today
  // line alone, and only when it is news, so the old total and empty-lead shapes below are gone on purpose.
  const src = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(src.includes("plural(todayCount, 'note changed today', 'notes changed today')"), 'the count has its noun');
  assert.ok(!src.includes('${todayCount} changed today.'), 'no bare count left');
  assert.ok(!src.includes(', ${orderWords}.'), 'the sort is not repeated in the lead');
  const lead = src.match(/lead=\{([\s\S]*?)\n\s*actions=/)?.[1] ?? assert.fail('no Notes lead');
  assert.ok(!lead.includes('note, doc or daily note'), 'the repeated total is gone: the title count says it');
  assert.ok(/lead=\{todayCount \?/.test(src), 'the line reads only when it is news (nothing on a fresh or unchanged vault)');
});

test('F4 both recent-first sorts share the one name', () => {
  const sorts = read('src/shared/notes-list.ts');
  assert.ok(sorts.includes("{ id: 'changed', label: 'Newest first' }"), 'notes sort reads Newest first');
  assert.ok(!sorts.includes('Changed lately'), 'no second name for the order');
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(!inbox.includes(".replace(' first', '')"), 'inbox shows its full Newest first too');
});

test('F5 every pictured list finds, never searches', () => {
  const notes = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(notes.includes('<ListFind'), 'notes finds through the one Find (t262)');
  assert.ok(!notes.includes('Search these notes'), 'no searching left on the page');
  assert.ok(read('src/renderer/src/components/PageTabs.tsx').includes('placeholder="Find in this list"'), 'the shared box finds');
  assert.ok(read('src/renderer/src/views/ProjectsHome.tsx').includes('placeholder="Find a project"'), 'projects still finds');
  const people = read('src/renderer/src/views/PeoplePage.tsx');
  assert.ok(people.includes('<ListFind'), 'people finds through the one Find (t262)');
  assert.ok(people.includes('placeholder="Find in this list"'), 'its grid reads the same words');
});

test('F6 meeting rows count agenda items in plain words', () => {
  const src = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(src.includes("'agenda item'"), 'one agenda item');
  assert.ok(src.includes("'agenda items'"), 'several agenda items');
  assert.ok(!src.includes('agenda: {'), 'no colon label left');
});

test('F7 the series stat answers to the Series name', () => {
  const src = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  // Round 3: the stat tiles became counts on the chips; the Series chip carries the series count.
  assert.ok(src.includes("{ id: 'series', label: 'Series', n: stats.series"), 'stat reads series');
  assert.ok(!src.includes(`label: 'Weekly series'`), 'its title reads Series');
  assert.ok(!src.includes('<span>weekly series</span>'), 'no second name on the stat');
  assert.ok(!src.includes('title="Weekly series"'), 'no second name in its title');
  // (p9 fresh-eyes, 4 Nov 2026: the count behind the name is every series, as the Series list shows —
  // a weekly-only count said "1 series" with a weekly and a monthly shown.)
  assert.ok(src.includes('n: stats.series'), 'the stat counts every series');
  assert.ok(!src.includes('stats.weeklySeries'), 'no weekly-only count behind the Series name');
  assert.ok(read('src/shared/work-meetings.ts').includes('series: series.length'), 'the home numbers count every series');
});

test('F8 the projects view switch is the segmented control', () => {
  const src = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(src.includes('<span className="seg" role="tablist" aria-label="How the projects are shown"'), 'one seg track');
  assert.ok(src.includes('role="tab" aria-selected={view === v.id}'), 'tabs, as Meetings and People');
  assert.ok(!src.includes('className={`chip${view'), 'no dark-chip switch left');
});

test('F9 every pictured count is plain words by the title', () => {
  assert.ok(read('src/renderer/src/views/ProjectsHome.tsx').includes('nv-page-count">{openCount} open</span>'), 'projects plain');
  assert.ok(read('src/renderer/src/views/InboxPage.tsx').includes('nv-page-count">{items.length} waiting</span>'), 'inbox plain');
  assert.ok(read('src/renderer/src/views/SharedSpacesHome.tsx').includes('nv-page-count">'), 'shared spaces plain');
  const meet = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  // (suite-green, 4 Nov 2026: the empty-vault job guards the slot past zero — no "0 this month" beside the
  // title, as every filter and tab (p18-empty-vault pins both the guard and the rendered page); the slot and
  // its plain words stay when there is a count. Packs uplift item 10: meetings moved into the pack shell, so the
  // count is a fact under the title, still plain words, still guarded past zero.)
  // Round 3: one summary line under the title instead of a facts block.
  assert.ok(meet.includes("stats && stats.thisMonth > 0 ? `${stats.thisMonth} this month`"), 'meetings keeps the This month fact past zero');
  assert.ok(meet.includes("`${view.meetings.length} ${view.meetings.length === 1 ? 'meeting' : 'meetings'} kept`"), 'meetings counts in plain words');
  assert.ok(!meet.includes('pill slate">{stats.thisMonth}'), 'no pill in the actions left');
});

// Ask/Find/Do live in the one search at the top since p7-vault-today (Home's own Ask box was the duplicate, removed).
test('F10 the ask modes are the segmented control, in the one search', () => {
  const pal = read('src/renderer/src/components/Modals.tsx');
  assert.ok(pal.includes('<div className="seg" role="tablist" aria-label="What to do with the words">'), 'one seg track');
  assert.ok(!pal.includes('className="modes"'), 'no second look for Ask/Find/Do left');
  assert.ok(!read('src/renderer/src/views/HomeView.tsx').includes('aria-label="What to do with the words"'), 'Home has no second ask box');
});

test('F12 home says what it is and plugs nothing else', () => {
  const src = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(src.includes('>Your areas and overview.</p>'), 'the one line');
  assert.ok(!src.includes('Today is what needs you now'), 'no cross-page plug left');
});
