// node --test tests/today-start.test.mjs — the one start to the day (10.0; Today and Home merged): one page
// from both routes, the morning brief on top with money and people lines, one Ask box, the day, what needs me,
// then projects needing a look. No group ever shows with nothing under it (the Late-1-that-is-Next case), and
// every count is what is listed. Fails without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-start-'));
let P, H;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/components/plan/plan.ts'), platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/home-cards.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'cards.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
  H = await import(pathToFileURL(path.join(work, 'cards.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const item = (what, offset, projectName = 'Alpha') => ({ id: what, project: 'p', projectName, version: 'v', kind: 'step', what, others: false, when: '', offset, tone: 'none' });

test('two places from the two routes: Today is what needs me now, Home the areas and overview (3 Nov 2026, audit f F4)', () => {
  // 5 Nov 2026, Home folded into Today (one morning place): both routes draw Today; the extras
  // render there as folded sections in the person's order; old home tabs keep working.
  const ws = read('src/renderer/src/views/Workspace.tsx');
  const todayBranch = ws.split(") : tab.type === 'today' ? (")[1].split(') : tab.type')[0];
  const homeBranch = ws.split(") : tab.type === 'home' ? (")[1].split(') : tab.type')[0];
  assert.ok(todayBranch.includes('<TodayView'), 'the today route stays');
  assert.ok(homeBranch.includes('<TodayView'), 'the home route draws Today too');
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(today.includes('data-section="brief"'), 'Today keeps the brief');
  assert.ok(today.includes('extrasOf(') && today.includes('useHomeLayout'), 'the extras live on Today in the person’s order');
  for (const card of ['InboxCard', 'RecentCard', 'BillsCard', 'HabitsCard', 'WeeklyCard', 'FamilyCard']) assert.ok(today.includes(card), `${card} folds in`);
  const actions = read('src/renderer/src/state/actions.ts');
  assert.ok(actions.split('export function openHome')[1].split('export function')[0].includes('openToday'), 'openHome opens Today');
  assert.ok(read('src/renderer/src/views/EmptyView.tsx').includes('<TodayView'), 'an empty tab starts on Today');
});

test('the one page runs Late, Next, questions, the day, then Also (step 2)', () => {
  // Step 2 (5 Nov 2026 shape kept, three questions first): Late, Next, Waiting on an answer, then meetings
  // as their own section, then one Also fold (waiting, the day's note and the week inside); the morning
  // brief sits below the work, task-free; risk follows waiting in source (both on the page).
  const src = read('src/renderer/src/views/TodayView.tsx');
  const at = (mark) => {
    const i = src.indexOf(mark);
    assert.ok(i >= 0, `${mark} is on the page`);
    return i;
  };
  assert.ok(!src.includes('<AskBox'), 'no ask box between (4 Nov 2026: one search, at the top)');
  assert.ok(at('data-section="late"') < at('data-section="next"'), 'Late first, then Next');
  assert.ok(at('data-section="next"') < at('data-section="meetings"'), 'Next, then meetings');
  assert.ok(at('data-section="meetings"') < at('data-section="also"'), 'meetings, then Also');
  // Layout round 2 (20 Nov 2026): waiting, the brief and the day's other sections are More for today's, placed in
  // the shorter column when it is open.
  const more = src.slice(at('const moreForToday'), at('const near = nearWords'));
  assert.ok(more.includes('id="waiting"') && more.includes('data-section="brief"'), 'waiting and the brief fold inside More for today');
  assert.ok(at('data-section="also"') < at('...(elseOpen ? moreForToday : [])'), 'the fold passes them to the columns');
});

test('listedDue: Next for you is taken out of its group, and counts are what is listed', () => {
  const due = { overdue: [item('late one', -2)], today: [item('today one', 0)], soon: [item('soon', 3)], later: [item('later', 20)] };
  // The reviewer’s case: the one late item is Next for you, so Late lists nothing and must not show.
  const next = P.nextForYou(due);
  assert.equal(next.what, 'late one');
  const listed = P.listedDue(due, next);
  assert.deepEqual(listed.overdue, [], 'Late lists nothing: no heading, count 0');
  assert.deepEqual(listed.today.map((x) => x.what), ['today one']);
  assert.equal(P.listedDueCount(listed), 3, 'the section counts listed rows, never the owned one twice');
  // Next from another group leaves the rest alone.
  const due2 = { overdue: [item('a', -5), item('b', -4)], today: [item('c', 0)], soon: [], later: [] };
  const listed2 = P.listedDue(due2, due2.today[0]);
  assert.deepEqual(listed2.overdue.map((x) => x.what), ['a', 'b']);
  assert.deepEqual(listed2.today, []);
  // Nothing owned: everything lists.
  const listed3 = P.listedDue(due, null);
  assert.equal(P.listedDueCount(listed3), 4);
  // Late still folds by project over what is listed, losing nothing.
  const many = { overdue: [item('a', -5), item('b', -4), item('c', -1)], today: [], soon: [], later: [] };
  const folds = P.foldByProject(P.listedDue(many, many.overdue[0]).overdue);
  assert.deepEqual(folds.map((f) => (f.kind === 'one' ? f.item.what : f.items.map((x) => x.what).join(','))), ['b', 'c'], 'two left list as rows, none lost');
});

test('the page lists the one list: a group with nothing under it never renders', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('rankAllFor('), 'the groups come from the one ranked list');
  for (const g of ['restGroups.today', 'restGroups.week', 'restGroups.later']) assert.ok(src.includes(`${g}.length`), `the ${g} group shows only with rows, headed by its listed count (step 2: Late reads above, never here)`);
  assert.ok(!src.includes('withoutNext(view.due'), 'no group counts raw and lists filtered any more');
});

test('the hero carries no controls: Start from a template is the page action in the header', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('<ViewHeader'), 'the page draws its own header');
  const head = src.split('<ViewHeader')[1].split('</ViewHeader>')[0];
  assert.ok(head.includes('Start from a template'), 'Start from a template is a page action');
  assert.ok(!head.includes('New note'), 'no fourth New note: the bar holds the one main action');
  const hero = src.split('td-head-top')[1].split('<h1')[0];
  assert.ok(!hero.includes('<button'), 'nothing clickable beside the date');
  assert.ok(read('src/renderer/src/views/Workspace.tsx').includes("'today'") && read('src/renderer/src/views/Workspace.tsx').split('SELF_HEADER')[1].split(')')[0].includes('today'), 'the frame never draws a second header above it');
});

test('the brief is back on top, from the seam, behind its switch again', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes("on('today:brief')"), 'today:brief gates the card again (the dead switch rewired)');
  assert.ok(src.includes('brief.get()'), 'the lines come from the brief seam');
  assert.ok(src.includes('<BriefCardHome'), 'through Home’s brief card');
  const card = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(card.includes('runBriefAction'), 'each line keeps its own action');
  assert.ok(card.includes('brief.notUseful('), 'and its Not useful');
});

test('no middle box: asking, finding and doing live in the header bar’s panel', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(!src.includes('<AskBox'), 'the middle box is gone (4 Nov 2026: one search, at the top)');
  assert.ok(!src.includes('home-ask td-ask'), 'the chat-only box stays gone');
  assert.ok(!src.includes("on('today:ask')"), 'its switch went with it');
  assert.ok(!src.includes('NoAskBar') && !src.includes('data-no-askbar'), 'and the floating bar is gone entirely (p9-one-ask)');
});

test('Home’s registry runs the extras below: inbox, recent, bills, habits, weekly, family', () => {
  assert.deepEqual(H.extrasOf(H.DEFAULT_HOME_CARDS), ['recent'], 'a default Home keeps Recently viewed below; due, brief and upcoming are the page itself now');
  assert.deepEqual(H.extrasOf(['due', 'inbox', 'brief', 'waiting', 'recent', 'upcoming', 'activity', 'day-note', 'bills', 'habits', 'weekly', 'family']), ['inbox', 'recent', 'bills', 'habits', 'weekly', 'family'], 'in the person’s order, core cards left out');
  assert.deepEqual(H.extrasOf(['due', 'brief']), [], 'core alone means no extras');
  const src = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(src.includes('extrasOf(') && src.includes('useHomeLayout'), 'the page reads the person’s arrangement');
  // 5 Nov 2026, Home folded into Today: the button reads Change cards now (the same ChangeHome dialog,
  // kept per vault, also sits beside the folded cards on Today); the registry and arrangement are unchanged.
  assert.ok(src.includes('Change cards'), 'and Change cards still arranges it');
});

test('the side bar lights Today and Home on their own rows', () => {
  // 5 Nov 2026, Home folded into Today: no Home row; a home tab lights Today’s row (one morning place).
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(!places.includes("label: 'Home'"), 'no Home row');
  assert.ok(places.includes("tab.type === 'home'") && places.includes('A.openToday()'), 'a home tab lights Today’s row, which opens Today');
});

test('Made, Changed and Linked stay inside their card', () => {
  const css = read('src/renderer/src/styles/today-hub.css');
  const tabs = css.split('.th-tabs')[1].split('}')[0];
  assert.ok(/flex-wrap:\s*wrap/.test(tabs), 'the tabs wrap instead of running past the edge');
  const tab = css.split('.th-tab {')[1].split('}')[0];
  assert.ok(/min-width:\s*0/.test(tab), 'a long count never pushes its tab out');
});
