// node --test tests/home-87.test.mjs — Home (8.7 wave 1, item 3): where the vault opens. Since 3 Nov 2026 (audit f
// F4) Home and Today have different jobs: Today is what needs me now (the greeting, the brief, due, waiting, the day),
// Home is the areas and overview (areas, the Inbox, recently viewed, the pack cards). Since 4 Nov 2026 asking,
// finding and doing live in the header bar's panel, not a middle box. Change Home picks and orders the person's
// cards on Home, kept across restarts. Fails without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-home-'));
let H;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/home-cards.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'cards.mjs'), format: 'esm' }, logLevel: 'silent' });
  H = await import(pathToFileURL(path.join(work, 'cards.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the cards and their default order are the mock-ups’', () => {
  assert.deepEqual(H.DEFAULT_HOME_CARDS, ['due', 'recent', 'upcoming', 'brief']);
  const titles = Object.fromEntries(H.HOME_CARDS.map((c) => [c.id, c.title]));
  assert.equal(titles.due, 'Today’s due items');
  assert.equal(titles.brief, 'Morning brief');
  assert.equal(titles['day-note'], 'Day note');
  for (const [id, module] of [['bills', 'finance'], ['habits', 'health'], ['weekly', 'weekly'], ['family', 'family']])
    assert.equal(H.HOME_CARDS.find((c) => c.id === id).pack.module, module, `${id} needs its pack`);
});

test('the arrangement survives the strange: unknown cards dropped, repeats kept once, never bare', () => {
  assert.deepEqual(H.normalizeHomeLayout({ on: ['due', 'nope', 'due', 'recent'] }), { on: ['due', 'recent'] });
  assert.deepEqual(H.normalizeHomeLayout({ on: [] }), { on: ['due'] });
  assert.deepEqual(H.normalizeHomeLayout(null), { on: ['due'] });
  assert.deepEqual(H.moveHomeCard({ on: ['due', 'brief', 'recent'] }, 'recent', 0), { on: ['recent', 'due', 'brief'] });
  assert.deepEqual(H.setHomeCard({ on: ['due'] }, 'inbox', true), { on: ['due', 'inbox'] });
  assert.deepEqual(H.setHomeCard({ on: ['due'] }, 'due', false), { on: ['due'] });
  assert.ok(H.homeOffers(['due']).some((c) => c.id === 'bills' && c.pack.module === 'finance'), 'the offer carries each pack card’s pack');
});

test('Today greets by first name; asking, finding and doing live in the header bar', () => {
  const home = read('src/renderer/src/views/HomeView.tsx');
  const start = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(start.includes('view?.me') && start.includes('Good afternoon'), 'the greeting with the first name, on Today');
  assert.ok(!home.includes('<AskBox') && !start.includes('<AskBox'), 'no middle box on either (4 Nov 2026: one search, at the top)');
  const palette = read('src/renderer/src/components/Modals.tsx').split('export function CommandPalette')[1];
  assert.ok(palette.includes('sendChat(q, source'), 'Ask puts the words to the helper');
  assert.ok(palette.includes('requestSearch(words)'), 'Find searches the vault');
  assert.ok(palette.includes('A.fileTaskText('), 'Do files the words as a task (9.2 uplift F1: the one filing path)');
  assert.ok(read('src/renderer/src/state/actions.ts').includes("save({ kind: 'task'"), 'the one path files as a task');
  assert.ok(palette.includes("'All notes'"), 'the source picker reads all notes or a recent one');
  assert.ok(palette.includes('recentPaths.slice(0, 6)'), 'from the pages opened lately');
});

test('due items are Today’s own reading, ticked in the project file with Undo', () => {
  const start = read('src/renderer/src/views/TodayView.tsx');
  // t146 (9 Nov 2026) keeps the day's answer in lib/todayData.ts: one bridge read per revision, day and
  // settings, every opener reading the same kept answer. The intent stands: Today's own reading from the main side.
  assert.ok(start.includes("from '../lib/todayData'") && start.includes('todayData()'), 'the day’s work from the main side');
  assert.ok(read('src/renderer/src/lib/todayData.ts').includes('window.nv.today.data()'), 'the kept answer is still the main side’s reading');
  assert.ok(start.includes('splitTodayTop(ranked,') && start.includes('restGroups.today') && start.includes('restGroups.week') && start.includes('restGroups.later'), 'Late reads above; Today, This week, Later wait in the fold (step 2: each job shows once)');
  assert.ok(start.includes('projects.edit(') && start.includes('item: { done: true }'), 'a tick writes the project file');
  assert.ok(start.includes('projects.undo('), 'Undo on every tick');
});

test('recently viewed, the day, and the other cards read the real stores', () => {
  const home = read('src/renderer/src/views/HomeView.tsx');
  const start = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(home.includes('function RecentCard') && home.includes('<RecentCard'), 'recently viewed is the pages opened lately, on Home');
  assert.ok(start.includes('<DayAgenda'), 'the day holds today’s meetings and events');
  // 9 Nov 2026, t119 one-tap filing: the one count hook (Home, Today and the side bar read it), fed by the real store.
  assert.ok(home.includes('useInboxCount()') && home.includes('<InboxCard count={inboxCount}'), 'the Inbox card counts what waits');
  assert.ok(start.includes('<DayNote'), 'the day’s note opens for writing');
  assert.ok(start.includes('view.waiting') && start.includes('chaseWords'), 'waiting items with their chase');
  assert.ok(start.includes('brief.get()') && home.includes('runBriefAction'), 'the brief with its own actions');
  assert.ok(start.includes('view.changed'), 'changed since yesterday is what changed');
  assert.ok(home.includes('useFinance(') && home.includes('markPaid('), 'bills from the Finance pack, paid here');
  assert.ok(home.includes('useHealth()') && home.includes('H().entry('), 'habits ticked for today');
  assert.ok(home.includes("useWork<") && home.includes("'weekly'"), 'the weekly update’s own state');
  assert.ok(home.includes('useFamily()') && home.includes('dayOf('), 'family’s today and tomorrow');
});

test('Change Home picks and orders the cards, and the arrangement is kept across restarts', () => {
  const home = read('src/renderer/src/views/HomeView.tsx');
  // 5 Nov 2026, Home folded into Today: the dialog says Change cards (same words as its button on Today).
  assert.ok(home.includes('Change cards'), 'the quiet button says Change cards');
  assert.ok(home.includes('moveHomeCard(') && home.includes('setHomeCard('), 'order and pick through the shared reducers');
  assert.ok(home.includes("state.load('home-cards')") && home.includes("state.save('home-cards'"), 'kept per vault');
  assert.ok(read('src/main/library-state.ts').includes("'home-cards'"), 'the main side keeps the arrangement');
  assert.ok(read('src/preload/index.ts').includes("'home-cards'"), 'the window reaches it');
});

test('Home is where the vault opens', () => {
  // 5 Nov 2026, Home folded into Today (one morning place): Today is where the vault opens;
  // old links to Home open Today, the Home rail row goes, a home tab draws Today.
  assert.ok(read('src/renderer/src/state/workspace.ts').includes("'home'"), 'a home tab still exists for old links');
  const actions = read('src/renderer/src/state/actions.ts');
  assert.ok(actions.split('export function openHome')[1].split('export function')[0].includes('openToday'), 'openHome opens Today');
  assert.ok(read('src/renderer/src/state/commands.ts').includes("id: 'home'"), 'the palette keeps its Home entry (it opens Today)');
  const ws = read('src/renderer/src/views/Workspace.tsx');
  assert.ok(ws.split(") : tab.type === 'home'")[1].split(') : tab.type')[0].includes('TodayView'), 'a home tab draws Today');
  assert.ok(read('src/renderer/src/views/EmptyView.tsx').includes('<TodayView'), 'an empty tab shows Today');
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(!places.includes("label: 'Home'"), 'no Home row on the rail');
  assert.ok(places.includes("tab.type === 'home'"), 'a home tab still lights Today’s row');
});

test('every card keeps its slot: Today keeps the day, Home the person’s extras', () => {
  const home = read('src/renderer/src/views/HomeView.tsx');
  const start = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(start.includes('<BriefCardHome') && start.includes("on('today:brief')"), 'the brief → the brief card on top of Today');
  assert.ok(start.includes('id="waiting"') && start.includes('id="risk"'), 'waiting and at risk → What needs me, Projects needing a look');
  assert.ok(start.includes('<DayAgenda'), 'the day’s meetings → the day');
  assert.ok(start.includes('id="changed"'), 'the day’s changes stay visible');
  assert.ok(start.includes('<DayNote'), 'the day’s note → the day, open for writing');
  assert.ok(home.includes('extrasOf(') && home.includes('useHomeLayout'), 'inbox, recent, bills, habits, weekly, family → Home in the person’s order');
  assert.ok(home.includes('CORE_HOME_CARDS') && home.includes('EXTRA_HOME_CARDS'), 'the registry says which is which');
  // 5 Nov 2026, Home folded into Today: the extras render on Today as folded sections, in the same order.
  for (const card of ['InboxCard', 'RecentCard', 'BillsCard', 'HabitsCard', 'WeeklyCard', 'FamilyCard']) assert.ok(start.includes(card), `${card} → Today’s folded sections`);
  assert.ok(start.includes('useHomeLayout') && start.includes("home-cards"), 'the arrangement stays the person’s own');
});
