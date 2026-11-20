// node --test tests/plan.test.mjs — the plan lists' shared reading (src/renderer/src/components/plan/plan.ts;
// 29 Oct 2026, the redesign plan; one set, the plan): date and status pills in both readings (Today's
// offset and small, the project page's timeline days and Projects'), Today's subtitle figures and Next for
// you, late folded by project, waiting grouped by person, and Tasks' ownership and day groups.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-plan-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/components/plan/plan.ts'), platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 9, 17, 9, 30); // Saturday 17 October 2026
const item = (what, offset, projectName = 'Alpha', extra = {}) => ({ id: what, project: 'p', projectName, version: 'v', kind: 'step', what, others: false, when: '', offset, tone: 'none', ...extra });

test('a date pill: late, today, this week, later with its countdown, no date', () => {
  // 5 Nov 2026, the plan: the one reader — Yesterday for late by one, Today muted (never warn),
  // weekday with date from two days out.
  assert.deepEqual(P.datePill(null, NOW), { words: 'No date', tone: 'none' });
  assert.deepEqual(P.datePill(-1, NOW), { words: 'Yesterday', tone: 'bad' });
  assert.deepEqual(P.datePill(-4, NOW), { words: '4 days late', tone: 'bad' });
  assert.deepEqual(P.datePill(0, NOW), { words: 'Today', tone: 'none' });
  assert.deepEqual(P.datePill(1, NOW), { words: 'Tomorrow', tone: 'none' });
  assert.equal(P.datePill(3, NOW).words, 'Tue 20 Oct');
  assert.deepEqual(P.datePill(15, NOW), { words: 'Sun 1 Nov · in 15 days', tone: 'none' }, 'a due date ahead shows as a countdown');
});

test('a status pill: Off track, At risk, On track, Done, Waiting; nothing said, no pill', () => {
  assert.deepEqual(P.statusPill('at risk'), { words: 'At risk', tone: 'warn' });
  // 9.2 uplift F4: one reading on every screen, so the small pill says Off track where it said At risk.
  assert.deepEqual(P.statusPill('off track'), { words: 'Off track', tone: 'bad' });
  assert.deepEqual(P.statusPill('on track'), { words: 'On track', tone: 'ok' });
  assert.deepEqual(P.statusPill('done'), { words: 'Done', tone: 'ok' });
  assert.deepEqual(P.statusPill('in review'), { words: 'In review', tone: 'none' }, 'an unknown word reads as written, as on Projects');
  assert.equal(P.statusPill(''), null);
  assert.equal(P.statusPill(undefined), null);
});

test('one status reading on both pill sizes: whole words, never substrings (9.2 uplift F4)', () => {
  for (const [words, small, big] of [
    ['Coffee catch-up', { words: 'Coffee catch-up', tone: 'none' }, { label: 'Coffee catch-up', tone: 'none' }],
    ['Broken-Christmas', { words: 'Off track', tone: 'bad' }, { label: 'Off track', tone: 'bad' }],
    ['Offers out', { words: 'Offers out', tone: 'none' }, { label: 'Offers out', tone: 'none' }],
    ['Not at risk', { words: 'Not at risk', tone: 'none' }, { label: 'Not at risk', tone: 'none' }],
    ['Undone', { words: 'Undone', tone: 'none' }, { label: 'Undone', tone: 'none' }],
    ['Waiting on client', { words: 'Waiting', tone: 'none' }, { label: 'Waiting', tone: 'waiting' }],
    ['Not done', { words: 'Not done', tone: 'none' }, { label: 'Not done', tone: 'none' }],
    ['Held over', { words: 'Held over', tone: 'none' }, { label: 'Held over', tone: 'none' }],
  ]) {
    assert.deepEqual(P.statusPill(words), small, `small pill: ${words}`);
    assert.deepEqual(P.statusOf(words), big, `Projects pill: ${words}`);
  }
});

test('the subtitle figures and Next for you', () => {
  assert.deepEqual(P.subtitleFigures({ late: 2, today: 1, week: 3, waiting: 4 }), ['2 late for you', '1 due today', '3 this week', '4 waiting on others']);
  assert.deepEqual(P.subtitleFigures({ late: 0, today: 0, week: 0, waiting: 0 }), []);
  const due = { overdue: [item('late one', -2)], today: [item('today one', 0)], soon: [item('soon', 3)], later: [item('later', 20)] };
  assert.equal(P.nextForYou(due).what, 'late one');
  assert.equal(P.nextForYou({ ...due, overdue: [] }).what, 'today one');
  assert.equal(P.nextForYou({ overdue: [], today: [], soon: [], later: [] }), null);
});

test('Next for you: what matters today outranks the most-days-late quick chore (SPEC section A)', () => {
  const due = {
    overdue: [item('Post on Facebook (5 min)', -9)],
    today: [item('Send the signed form', 0, 'Alpha', { tone: 'warn' })],
    soon: [item('Alpha is due', 3, 'Alpha', { kind: 'project' })],
    later: [],
  };
  assert.equal(P.nextForYou(due).what, 'Send the signed form', 'due today in a project at risk beats a 9-days-late 5-minute chore');
  assert.equal(P.nextForYou({ ...due, today: [] }).what, 'Post on Facebook (5 min)', 'with nothing at risk or due today, the late item is next');
  const prep = item('Prep for the supplier call', 0, 'Alpha', { kind: 'date' });
  assert.equal(P.nextForYou({ overdue: due.overdue, today: [], soon: [], later: [] }, [prep]).what, 'Prep for the supplier call', 'today’s meeting prep comes before a plain late chore');
});

test('an owner chip name that is the person themselves (SPEC section A)', () => {
  assert.equal(P.isOwnName('Jesse Arlow', 'Jesse Arlow'), true);
  assert.equal(P.isOwnName('Jesse', 'Jesse Arlow'), true);
  assert.equal(P.isOwnName('me', 'Jesse Arlow'), true);
  assert.equal(P.isOwnName('Priya Shah', 'Jesse Arlow'), false);
  assert.equal(P.isOwnName('', 'Jesse Arlow'), false);
  assert.equal(P.isOwnName('Priya Shah', null), false);
});

test('late folds by project at three; waiting groups by person, oldest first', () => {
  const late = [item('a', -5), item('b', -4), item('c', -1), item('d', -9, 'Beta'), item('e', -2, 'Beta')];
  const folds = P.foldByProject(late);
  assert.equal(folds[0].kind, 'project');
  assert.equal(folds[0].items.length, 3);
  assert.deepEqual(folds.slice(1).map((f) => f.item.what), ['d', 'e'], 'two from one project stay as rows');
  const w = (who, offset, what = 'x') => ({ id: what, project: 'p', projectName: 'Alpha', version: 'v', what, who, offset, index: 0, since: 0 });
  const groups = P.groupWaiting([w('Sam', -1, 's1'), w('Sam', null, 's2'), w('Priya', -6, 'p1')]);
  assert.deepEqual(groups.map((g) => [g.who, g.items.length, g.oldest]), [['Priya', 1, -6], ['Sam', 2, -1]]);
  assert.match(P.chaseWords(groups[0]), /Priya/);
  assert.match(P.chaseWords(groups[0]), /6 days late/);
});

test('tasks: whose they are, and the same day groups as Today', () => {
  assert.equal(P.taskOwnership([], 'Mia Tran'), 'mine', 'nobody named: mine');
  assert.equal(P.taskOwnership(['Mia'], 'Mia Tran'), 'mine', 'my first name: mine');
  assert.equal(P.taskOwnership(['Sam Okafor'], 'Mia Tran'), 'others');
  assert.equal(P.taskOwnership(['Sam Okafor'], null), 'others', 'a name with no known me waits on them');
  const today = '2026-10-21';
  assert.equal(P.planGroup({ done: false, due: '2026-10-20' }, today), 'late');
  assert.equal(P.planGroup({ done: true, due: '2026-10-20' }, today), 'earlier');
  assert.equal(P.planGroup({ done: false, due: '2026-10-21' }, today), 'today');
  assert.equal(P.planGroup({ done: false, due: '2026-10-28' }, today), 'week', 'seven days on is this week, as on Today');
  assert.equal(P.planGroup({ done: false, due: '2026-10-29' }, today), 'later');
  assert.equal(P.planGroup({ done: false, due: null }, today), 'none');
});

test('a task title never carries its owner: ownerOf splits it, a day tail is not a person', () => {
  assert.deepEqual(P.splitTaskOwner('Post on Facebook (5 min) — Jesse Arlow', NOW), { title: 'Post on Facebook (5 min)', owner: 'Jesse Arlow' });
  assert.deepEqual(P.splitTaskOwner('Send the reconciliation — Mia · by 17 Oct', NOW), { title: 'Send the reconciliation', owner: 'Mia', when: '17 Oct' });
  const dayTail = P.splitTaskOwner('Join the alignment call — Fri 16 Oct, 11:00 AM AEDT', NOW);
  assert.equal(dayTail.title, 'Join the alignment call');
  assert.equal(dayTail.owner, undefined, 'a day written where the owner goes is the day, not a person');
  assert.ok(dayTail.when, 'the day is kept as when');
  assert.deepEqual(P.splitTaskOwner('Ask for the recording — from [[Review]] — Mia Tran', NOW), { title: 'Ask for the recording', owner: 'Mia Tran' });
  assert.deepEqual(P.splitTaskOwner('Ring the mill', NOW), { title: 'Ring the mill' });
});

test('tasks use Today\u2019s own reading: others late is not mine, a day tail groups by readDay', () => {
  const mine = P.taskInfo({ words: 'Book the venue — Mia Tran', due: null, done: false }, 'Mia Tran', NOW);
  assert.equal(mine.ownership, 'mine');
  const jesse = P.taskInfo({ words: 'Post on Facebook (5 min) — Jesse Arlow', due: '2026-10-10', done: false }, 'Mia Tran', NOW);
  assert.equal(jesse.title, 'Post on Facebook (5 min)');
  assert.equal(jesse.owner, 'Jesse Arlow');
  assert.equal(jesse.ownership, 'others', 'a late task naming someone else waits on them, never mine');
  assert.equal(jesse.group, 'late');
  const call = P.taskInfo({ words: 'Join the alignment call — Fri 16 Oct, 11:00 AM AEDT', due: null, done: false }, 'Mia Tran', NOW);
  assert.equal(call.group, 'late', 'its day comes from readDay on the tail, as Today reads it');
  assert.equal(call.offset, -1);
  // 5 Nov 2026, one counting query (linking to a person never made it theirs: "Send the quote
  // to Sam" is my job to send, not Sam's — the people-links-as-owners reading counted it others in
  // Tasks but mine on Today, part of the 13 versus 33 gap). People links stay for display.
  const linked = P.taskInfo({ words: 'Send the quote to [[Sam Okafor]]', due: '2026-10-17', done: false, people: ['Sam Okafor'] }, 'Mia Tran', NOW);
  assert.equal(linked.ownership, 'mine');
  assert.equal(linked.group, 'today');
  assert.equal(P.taskInfo({ words: 'Old thing', due: '2026-10-01', done: true }, 'Mia Tran', NOW).group, 'earlier', 'a done task that went by is not late');
});

test('the project page’s date reading: timeline days, its countdown only to 30 days (one set, ITEMS)', () => {
  const T = Math.round(Date.UTC(2026, 9, 17) / 86400000); // 17 Oct 2026 as a timeline day
  assert.equal(P.dateTone(undefined, T), 'none');
  assert.equal(P.dateTone(T - 1, T), 'late');
  assert.equal(P.dateTone(T, T), 'today');
  assert.equal(P.dateTone(T + 7, T), 'week');
  assert.equal(P.dateTone(T + 8, T), 'later');
  assert.equal(P.dateWords(undefined, T), 'No date');
  assert.equal(P.dateWords(T - 1, T), 'Yesterday');
  assert.equal(P.dateWords(T - 3, T), '3 days late');
  assert.equal(P.dateWords(T, T), 'Today');
  assert.equal(P.dateWords(T + 1, T), 'Tomorrow');
  // 9.2 uplift F57: one countdown rule (8 to 30 days) behind both date readers.
  // 5 Nov 2026, the plan: weekday with date from two days out, Yesterday for late by one.
  assert.equal(P.dateWords(T + 3, T), 'Tue 20 Oct', 'this week reads as the day, as Today’s offset pill reads it');
  assert.equal(P.dateWords(T + 15, T), 'Sun 1 Nov · in 15 days');
  assert.equal(P.dateWords(T + 40, T), 'Thu 26 Nov', 'past 30 days both readers drop the countdown');
  assert.equal(P.datePill(40, NOW).words, 'Thu 26 Nov', 'Today’s offset pill drops the countdown past 30 days too');
  assert.equal(P.countdownDay('1 Nov', 15), '1 Nov · in 15 days');
  assert.equal(P.countdownDay('26 Nov', 40), '26 Nov');
});

test('the Projects status reading: Off track, Done and Waiting tones, a plain word kept as written (one set, ITEMS)', () => {
  assert.deepEqual(P.statusOf('off track'), { label: 'Off track', tone: 'bad' }, '9.2 uplift F4: one reading, so Projects and Today’s pill say the same');
  assert.deepEqual(P.statusOf('on track'), { label: 'On track', tone: 'ok' });
  assert.deepEqual(P.statusOf('at risk'), { label: 'At risk', tone: 'warn' });
  assert.deepEqual(P.statusOf('done'), { label: 'Done', tone: 'done' });
  assert.deepEqual(P.statusOf('delivered'), { label: 'Done', tone: 'done' });
  assert.deepEqual(P.statusOf('waiting'), { label: 'Waiting', tone: 'waiting' });
  assert.deepEqual(P.statusOf('paused'), { label: 'Waiting', tone: 'waiting' });
  assert.deepEqual(P.statusOf('in review'), { label: 'In review', tone: 'none' }, 'an unknown word is kept, first letter up, not shouted');
  assert.equal(P.statusOf(''), null);
  assert.equal(P.statusOf(undefined), null);
});

test('an owner chip name: wrappers off, the first person named, nobody is empty (one set, ITEMS)', () => {
  assert.equal(P.ownerName('— Jesse Arlow'), 'Jesse Arlow');
  assert.equal(P.ownerName('Alex Morgan · Fri 23 Oct, 11:00 AM'), 'Alex Morgan');
  assert.equal(P.ownerName('Sam Okafor'), 'Sam Okafor');
  assert.equal(P.ownerName(''), '');
  assert.equal(P.ownerName(undefined), '');
});

test('no-date tasks group by project, most first', () => {
  const t = (projectName, title) => ({ projectName, title });
  const groups = P.groupNoDate([t('Alpha', 'n1'), t(null, 'Loose note'), t('Alpha', 'n2'), t('Beta', 'n3'), t('Alpha', 'n4')]);
  assert.deepEqual(groups.map((g) => [g.name, g.items.length]), [['Alpha', 3], ['Beta', 1], ['Loose note', 1]]);
});

test('visibleWho: your own name never shows on your own items (sweep 032)', () => {
  assert.equal(P.visibleWho('Jesse Arlow', 'Jesse Arlow'), '');
  assert.equal(P.visibleWho('Jesse', 'Jesse Arlow'), '');
  assert.equal(P.visibleWho('Mia Chen', 'Jesse Arlow'), 'Mia Chen');
  assert.equal(P.visibleWho('', 'Jesse Arlow'), '');
  assert.equal(P.visibleWho(undefined, 'Jesse Arlow'), '');
});

test('visibleWho: a job for two shows the other person, never you (t250, 12 Nov 2026)', () => {
  assert.equal(P.visibleWho('Sam Okafor and June Park', 'Sam Okafor'), 'June Park');
  assert.equal(P.visibleWho('Sam Okafor and June Park', 'June Park'), 'Sam Okafor');
  assert.equal(P.visibleWho('Sam Okafor and June Park', 'Alex Chen'), 'Sam Okafor and June Park');
  assert.equal(P.visibleWho('Sam, June and Alex', 'June Park'), 'Sam and Alex');
  assert.equal(P.visibleWho('Sam with June', 'Sam Okafor'), 'June');
  assert.equal(P.visibleWho('me and Sam Okafor', 'Priya Nair'), 'Sam Okafor');
  assert.equal(P.visibleWho('Sam Okafor and June Park', null), 'Sam Okafor and June Park');
});

test('lateForYouCount reads tasks the Tasks page way (sweep 001/008)', () => {
  const tasks = [
    { words: 'Book the room — Jesse Arlow', due: '2026-10-10', done: false, people: [] },
    { words: 'Send **the draft** #admin', due: '2026-10-09', done: false, people: [] },
    { words: 'Chase the quote — Mia Chen', due: '2026-10-08', done: false, people: [] },
    { words: 'Old and done', due: '2026-10-01', done: true, people: [] },
    { words: 'No day yet', due: null, done: false, people: [] },
  ];
  assert.equal(P.lateForYouCount(tasks, 'Jesse Arlow', '2026-10-17'), 2);
  assert.equal(P.cleanTaskWords('Send **the draft** #admin'), 'Send the draft');
});

test('stale: an old task groups apart, reads quietly, counts apart, never late (5 Nov 2026, u3 moving-in)', () => {
  assert.equal(P.planGroup({ done: false, due: '2024-02-01' }, '2026-10-21'), 'stale');
  assert.equal(P.planGroup({ done: false, due: '2026-10-20' }, '2026-10-21'), 'late', 'a lately-late task stays late');
  assert.equal(P.taskInfo({ words: 'Pay the power bill', due: '2024-02-01', done: false }, 'Mia Tran', NOW).group, 'stale');
  assert.deepEqual(P.datePill(-100, NOW), { words: '9 Jul', tone: 'none' }, 'an old pill reads as its quiet date');
  assert.deepEqual(P.datePill(-31, NOW), { words: '16 Sep', tone: 'none' });
  assert.deepEqual(P.datePill(-30, NOW), { words: '30 days late', tone: 'bad' }, '30 days late is still late');
  assert.equal(P.whenTone(-100), 'quiet', 'an old when never shouts');
  assert.equal(P.whenTone(-4), 'coral');
  assert.deepEqual(P.subtitleFigures({ late: 2, today: 1, week: 3, waiting: 1, stale: 579 }), ['2 late for you', '1 due today', '3 this week', '579 from a while back', '1 waiting on others']);
  const tasks = [
    { words: 'Ancient bill', due: '2024-02-01', done: false, people: [] },
    { words: 'Last week', due: '2026-10-10', done: false, people: [] },
  ];
  assert.equal(P.lateForYouCount(tasks, 'Mia Tran', '2026-10-17'), 1, 'late for you counts lately-late only');
});

test('owner confidence: a stranger’s tail is a mention, a known tail is debt (5 Nov 2026, u3 moving-in)', () => {
  const known = ['Mia Tran', 'Sam Okafor'];
  assert.equal(P.taskInfo({ words: 'Ring back — Stranger Name', due: null, done: false }, 'Mia Tran', NOW, known).ownership, 'mine', 'a stranger’s mention is mine, quiet');
  assert.equal(P.taskInfo({ words: 'Ring back — Sam Okafor', due: null, done: false }, 'Mia Tran', NOW, known).ownership, 'others', 'a known other waits');
  assert.equal(P.taskInfo({ words: 'Ring back — Sam Okafor', due: null, done: false }, 'Mia Tran', NOW).ownership, 'others', 'without known, every name reads as before');
  assert.equal(P.taskInfo({ words: 'Ring back — Stranger Name', due: null, done: false, people: ['Sam Okafor'] }, 'Mia Tran', NOW, known).ownership, 'others', 'a linked person stays linked');
  assert.equal(P.taskInfo({ words: 'Ring back — Mia Tran', due: null, done: false }, 'Mia Tran', NOW, known).ownership, 'mine');
  assert.equal(P.taskOwnership(['Stranger Name'], 'Mia Tran', known), 'mine');
  assert.equal(P.taskOwnership(['Sam Okafor'], 'Mia Tran', known), 'others');
  assert.equal(P.taskOwnership(['Sam Okafor'], 'Mia Tran'), 'others', 'without known, as before');
});
