// node --test tests/brief.test.mjs — the morning brief on Today (src/shared/brief.ts, src/main/brief.ts; 21 Oct 2026, gap
// G20): every kind of line from made-up local data (the calendar's next events, late and today's reminders and tasks,
// project steps due, projects at risk, past due and gone quiet, flashcards due) and the former host app's overnight finds
// checked; the ranking (the most pressing first, at most eight, at most three of one kind); each line's action; "Not
// useful" hiding a line, ranking its kind lower and fading over a month, with Undo; the brief built offline (the former
// host app not there, failing or too slow) from the notes alone; and the memory kept per vault, checked when read.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-brief-'));
let B, M, T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/brief.ts'), platform: 'node', output: { file: path.join(work, 'b.mjs'), format: 'esm' }, logLevel: 'silent' });
  await build({ input: path.join(root, 'src/main/brief.ts'), platform: 'node', external: [/^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  const entry = path.join(work, 't.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/today.ts'))};\nexport { parseProject } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  B = await import(pathToFileURL(path.join(work, 'b.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  T = await import(pathToFileURL(path.join(work, 't.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// 8:30 am on Wednesday 21 October 2026, on this PC's clock.
const NOW = new Date(2026, 9, 21, 8, 30).getTime();
const at = (h, m = 0, d = 21) => new Date(2026, 9, d, h, m).toISOString();
const DAY = 86_400_000;

const CALENDAR = {
  connected: true,
  date: '2026-10-21',
  timeZone: 'Australia/Melbourne',
  updated: at(8),
  events: [
    { id: 'bday', calendar: 'Family', title: 'Mia’s birthday', start: '2026-10-21', end: '2026-10-22', allDay: true, location: '', meetingLink: '', link: '' },
    { id: 'bake', calendar: 'Work', title: 'Morning bake check', start: at(7), end: at(7, 30), allDay: false, location: 'Kitchen', meetingLink: '', link: '' },
    { id: 'mill', calendar: 'Work', title: 'Supplier call: Western Plains Mill', start: at(9, 30), end: at(10), allDay: false, location: '', meetingLink: 'https://meet.example.com/abc', link: '' },
    { id: 'market', calendar: 'Work', title: 'Market stall', start: at(16), end: at(18), allDay: false, location: 'Esplanade', meetingLink: '', link: '' },
    { id: 'lunch', calendar: 'Work', title: 'Lunch (free)', start: at(12), end: at(13), allDay: false, location: '', meetingLink: '', link: '', free: true },
  ],
};
const reminder = (key, text, due, title = 'Daily/2026-10-20.md') => ({ key, path: title, title: title.replace(/\.md$/, '').split('/').pop(), line: 3, text, due, timeGiven: true, repeat: null, done: false });
const task = (key, words, due, title = 'Kitchen jobs') => ({ key, path: `${title}.md`, title, line: 5, text: `${words}${due ? ` 📅 ${due}` : ''}`, words, due });
const DUE = {
  overdue: [
    { kind: 'reminder', key: 'r1', day: '2026-10-20', item: reminder('r1', 'Order 20 bags of flour', new Date(2026, 9, 20, 9).getTime()) },
    { kind: 'task', key: 't1', day: '2026-10-18', item: task('t1', 'Clean the proofing cabinet', '2026-10-18') },
  ],
  today: [
    { kind: 'reminder', key: 'r2', day: '2026-10-21', item: reminder('r2', 'Call the electrician', new Date(2026, 9, 21, 9, 15).getTime()) },
    { kind: 'task', key: 't2', day: '2026-10-21', item: task('t2', 'Write the winter menu', '2026-10-21') },
  ],
  week: [],
  undated: [],
  undatedCount: 0,
};
const ref = (name) => ({ project: `Projects/${name}/${name}.md`, projectName: name, version: 'v1' });
const PROJECTS = {
  overdue: [{ ...ref('Saltwater Bakehouse'), id: 'step:sb:0', kind: 'step', what: 'Sign the lease renewal', others: false, when: '19 Oct', offset: -2, index: 0, tone: 'warn' }],
  today: [{ ...ref('Winter pies'), id: 'date:wp:1', kind: 'date', what: 'Tasting day', others: false, when: '21 Oct', offset: 0, index: 1, tone: 'none' }],
  atRisk: [{ ...ref('Shopfront refit'), id: 'risk:sr', health: 'off track', tone: 'bad', dueOffset: -3, due: '18 Oct', risks: [{ what: 'Builder hasn’t confirmed', level: 'high', index: 0 }] }],
  quiet: [{ ...ref('Catering menu'), id: 'quiet:cm', days: 23, open: 3, next: 'Price the platters' }],
};
const DECKS = [
  { path: 'Projects/Saltwater Bakehouse/Notebook/Flashcards.md', title: 'Bakery flashcards', due: 6, total: 12 },
  { path: 'Study/Food safety cards.md', title: 'Food safety cards', due: 2, total: 9 },
];
const FOUND_RAW = {
  generatedAt: at(6),
  items: [
    { id: 'w1', kind: 'price', title: 'Flour price dropped 6% at Western Plains', detail: 'From $38 to $35.70 a bag', link: 'https://example.com/flour', action: { label: 'Draft a reply', ask: 'Draft an email to Western Plains about the new price' }, source: 'Price watch', priority: 0.8 },
    { kind: 'news', title: 'Council approved esplanade trading hours', detail: 'From 1 December', source: 'Local news', priority: 0.2 },
    { kind: 'watch', title: 'Note to self', link: 'Projects/Saltwater Bakehouse/Lease.md', source: 'Lease watch' },
    { kind: 'x', title: '', detail: 'no title: dropped' },
    { kind: 'bad link', title: 'Sneaky', link: 'file:///C:/Windows/system32', action: { label: 'Run', url: 'javascript:alert(1)' } },
    { kind: 'climb', title: 'Out of the vault', link: '../../secrets.md' },
  ],
};

const input = (over = {}) => ({ now: NOW, calendar: CALENDAR, meetingNotes: {}, due: DUE, projects: PROJECTS, decks: DECKS, found: B.cleanFound(FOUND_RAW), foundState: 'ok', prefs: B.NO_PREFS, ...over });

test('the host app’s overnight finds checked: titles needed, only web links and vault paths, actions only ask or open the web', () => {
  const f = B.cleanFound(FOUND_RAW);
  assert.equal(f.length, 5);
  assert.deepEqual(f[0], { id: 'found:w1', kind: 'price', title: 'Flour price dropped 6% at Western Plains', detail: 'From $38 to $35.70 a bag', source: 'Price watch', link: { url: 'https://example.com/flour' }, action: { label: 'Draft a reply', ask: 'Draft an email to Western Plains about the new price' }, priority: 0.8 });
  assert.equal(f[1].priority, 0.2);
  assert.match(f[1].id, /^found:[a-z0-9]+$/, 'an id made from it when none is given (the same each night)');
  assert.deepEqual(f[2].link, { path: 'Projects/Saltwater Bakehouse/Lease.md' });
  const intra = B.cleanFound({ generatedAt: at(6), items: [
    { kind: 'news', title: 'Roster', link: 'http://intranet/roster', source: 'Work' },
    { kind: 'news', title: 'Printer', link: 'http://localhost:631/printers', source: 'Work' },
    { kind: 'news', title: 'Old site', link: 'http://example.com/old', source: 'Work' },
  ] });
  assert.deepEqual(intra[0].link, { url: 'http://intranet/roster' }, 'an intranet address keeps its Open');
  assert.deepEqual(intra[1].link, { url: 'http://localhost:631/printers' }, 'loopback too');
  assert.equal(intra[2].link, undefined, 'the public web stays https');
  assert.equal(f[3].kind, 'bad-link');
  assert.equal(f[3].link, undefined, 'no file: link');
  assert.equal(f[3].action, undefined, 'no javascript: action');
  assert.equal(f[4].link, undefined, 'no climbing out of the vault');
  assert.deepEqual(B.cleanFound(null), []);
  assert.deepEqual(B.cleanFound('nonsense'), []);
  assert.equal(B.cleanFound([{ kind: 'a', title: 'array form' }]).length, 1);
});

test('the brief: the most pressing first, at most eight, at most three of a kind, each with its action', () => {
  const b = B.buildBrief(input());
  assert.equal(b.items.length, B.BRIEF_MAX);
  assert.ok(b.more > 0);
  const titles = b.items.map((i) => i.title);
  // Late reminder first; the call starting within the hour next; late project step; at risk / past due…
  assert.equal(titles[0], 'Order 20 bags of flour');
  assert.equal(titles[1], 'Supplier call: Western Plains Mill');
  assert.ok(titles.indexOf('Sign the lease renewal') < titles.indexOf('Tasting day'), 'late before today');
  assert.ok(titles.includes('Shopfront refit is past its due date'));
  // Ranked high to low.
  for (let i = 1; i < b.items.length; i++) assert.ok(b.items[i - 1].score >= b.items[i].score);
  // No kind more than three times.
  const kinds = {};
  for (const i of b.items) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;
  assert.ok(Object.values(kinds).every((n) => n <= B.PER_KIND));
  // The call: within three hours, Make a meeting note and Join.
  const call = b.items.find((i) => i.kind === 'event');
  assert.equal(call.tone, 'warn');
  assert.deepEqual(call.actions.map((a) => a.kind), ['meeting', 'url']);
  assert.equal(call.actions[0].event.id, 'mill');
  assert.equal(call.actions[1].url, 'https://meet.example.com/abc');
  // A reminder: Snooze first (its key), then Open at its line.
  const late = b.items[0];
  assert.equal(late.tone, 'bad');
  assert.deepEqual(late.actions[0], { kind: 'snooze', label: 'Snooze', key: 'r1' });
  assert.deepEqual(late.actions[1], { kind: 'open', label: 'Open', path: 'Daily/2026-10-20.md', line: 3 });
  // A project step opens the project at the step; Ask about this says what and where.
  const step = b.items.find((i) => i.kind === 'step' && i.title === 'Sign the lease renewal');
  assert.equal(step.detail, '2 days late · Saltwater Bakehouse');
  // Plain Open (10.0 rooms critique, 2 Nov 2026: the detail already names the project; "Open <project>" ragged the
  // action column against every other row's Open).
  assert.deepEqual(step.actions[0], { kind: 'open', label: 'Open', path: 'Projects/Saltwater Bakehouse/Saltwater Bakehouse.md', item: 'next:0' });
  assert.match(step.actions[1].words, /^About “Sign the lease renewal” in Saltwater Bakehouse, due 19 Oct: $/);
});

test('round 3: the Today card carries no task rows, however they arrive (a shared rule, not a label match)', () => {
  // A line that is a task drops from Vault's Today card, on its kind, never its shown label: a step, a task, a
  // reminder, or one of the former host app's finds shaped as a task (the Telegram brief's top five arrive that
  // way).
  for (const kind of ['step', 'task', 'reminder', 'found:task', 'found:todo', 'found:reminder', 'found:step']) {
    assert.equal(B.isBriefTask({ kind }), true, `${kind} is a task`);
  }
  for (const kind of ['event', 'project', 'person', 'cards', 'bill', 'spend', 'price', 'tight', 'problem', 'found:news', 'found:price', 'found:automation']) {
    assert.equal(B.isBriefTask({ kind }), false, `${kind} is not a task`);
  }
  // The full brief still ranks tasks (Home and the seam keep them); the Today card leaves them out, with its
  // meetings (the day below shows them), and counts every dropped line in "more" (the lists below hold them).
  const full = B.buildBrief(input());
  assert.ok(full.items.some((i) => B.isBriefTask(i)), 'the built brief still ranks task rows');
  const card = B.todayCardBrief(full);
  assert.ok(card.items.every((i) => !B.isBriefTask(i) && i.kind !== 'event'), 'no task row and no meeting row on the Today card');
  assert.ok(card.items.some((i) => i.kind === 'found:price' || i.kind === 'project' || i.kind === 'cards'), 'news, projects and cards stay');
  assert.equal(card.more, full.more + (full.items.length - card.items.length), 'the dropped rows count as more below');
  const tasksOnly = B.buildBrief(input({ calendar: null, projects: null, decks: [], found: [], foundState: 'none' }));
  assert.equal(B.todayCardBrief(tasksOnly).items.length, 0, 'nothing but tasks: the card has nothing to draw');
});

test('every kind of line reads plainly, with its own action', () => {
  const all = B.candidates(input());
  const by = (pred) => all.find(pred);
  // The next two events still to come (the past one and the free one left out; the all-day one only when nothing else is).
  assert.deepEqual(all.filter((i) => i.kind === 'event').map((i) => i.title), ['Supplier call: Western Plains Mill', 'Market stall']);
  assert.match(by((i) => i.title === 'Market stall').detail, /4:00 pm – 6:00 pm · Esplanade/);
  assert.equal(B.candidates(input({ calendar: { ...CALENDAR, events: [CALENDAR.events[0]] } })).filter((i) => i.kind === 'event')[0].title, 'Mia’s birthday');
  // An event with its meeting note already: Open meeting note.
  assert.deepEqual(B.candidates(input({ meetingNotes: { mill: 'Meetings/Supplier call.md' } })).find((i) => i.kind === 'event').actions[0], { kind: 'open', label: 'Open meeting note', path: 'Meetings/Supplier call.md' });
  // Reminders and tasks.
  assert.equal(by((i) => i.title === 'Call the electrician').detail, 'At 9:15 am · Daily note');
  assert.equal(by((i) => i.title === 'Clean the proofing cabinet').detail, '3 days late · Kitchen jobs');
  assert.equal(by((i) => i.title === 'Write the winter menu').detail, 'Due today · Kitchen jobs');
  // Projects: past due with its top risk; gone quiet with its next step.
  const risk = by((i) => i.title.startsWith('Shopfront refit'));
  assert.equal(risk.detail, 'High risk: Builder hasn’t confirmed');
  assert.equal(risk.tone, 'bad');
  assert.deepEqual(risk.actions[0], { kind: 'open', label: 'Open', path: 'Projects/Shopfront refit/Shopfront refit.md', item: 'risks' });
  const quiet = by((i) => i.title === 'Catering menu has gone quiet');
  assert.equal(quiet.detail, 'Nothing changed for 23 days · 3 steps open, next: Price the platters');
  // Flashcards: one line for every deck, Review cards opening the fullest.
  const cards = by((i) => i.kind === 'cards');
  assert.equal(cards.title, '8 flashcards to review');
  assert.equal(cards.detail, 'Bakery flashcards and 1 more deck');
  assert.deepEqual(cards.actions, [{ kind: 'review', label: 'Review cards', path: 'Projects/Saltwater Bakehouse/Notebook/Flashcards.md' }]);
  // The former host app's find: its own action (Draft a reply in the chat), its web link, its
  // source shown.
  const price = by((i) => i.id === 'found:w1');
  assert.equal(price.kind, 'found:price');
  assert.equal(price.source, 'neuralspark');
  assert.equal(price.detail, 'From $38 to $35.70 a bag · Price watch');
  assert.deepEqual(price.actions, [
    { kind: 'ask', label: 'Draft a reply', words: 'Draft an email to Western Plains about the new price' },
    { kind: 'url', label: 'Open', url: 'https://example.com/flour' },
  ]);
  // A find with no action of its own gets Ask about this.
  assert.match(by((i) => i.title === 'Council approved esplanade trading hours').actions[0].words, /^About “Council approved esplanade trading hours” \(From 1 December\), which Local news found: $/);
});

test('offline, or the host app not answering: the brief from the notes alone, the same lines', async () => {
  const local = B.buildBrief(input({ found: [], foundState: 'none', calendar: null }));
  assert.equal(local.found, 'none');
  assert.ok(local.items.length > 0);
  assert.ok(local.items.every((i) => i.source === 'notes'));
  // Nothing at all to say: an empty brief (Today says so calmly).
  const empty = B.buildBrief(input({ calendar: null, due: null, projects: null, decks: [], found: [], foundState: 'none' }));
  assert.deepEqual(empty.items, []);
  assert.equal(empty.more, 0);
  // The main side: The former host app failing, then too slow (8 s), still a brief.
  const failing = mainSide({ found: async () => Promise.reject(new Error('offline')) });
  const b1 = await failing.handlers['brief:get']();
  assert.equal(b1.found, 'failed');
  assert.ok(b1.items.length > 0);
  const missing = mainSide({});
  assert.equal((await missing.handlers['brief:get']()).found, 'none');
});

/** The main side with made-up sources and an in-memory store. */
function mainSide(over) {
  const handlers = {};
  let saved = over.saved ?? null;
  let now = over.now ?? NOW;
  const r = M.registerBrief({
    handle: (ch, fn) => (handlers[ch] = fn),
    due: over.due ?? (() => DUE),
    today: over.today ?? (() => ({ due: { overdue: PROJECTS.overdue, today: PROJECTS.today, soon: [] }, atRisk: PROJECTS.atRisk, quiet: PROJECTS.quiet })),
    calendar: over.calendar ?? (async () => CALENDAR),
    decks: over.decks ?? (() => DECKS),
    meetingNotes: () => ({}),
    ...(over.found ? { found: over.found } : {}),
    ...(over.log ? { log: over.log } : {}),
    load: async () => saved,
    save: async (v) => {
      saved = JSON.parse(JSON.stringify(v));
    },
    now: () => now,
  });
  return { r, handlers, stored: () => saved, later: (ms) => (now += ms) };
}

test('a source that fails gets its own line: a failure never renders as a calm brief', async () => {
  const m = mainSide({ due: () => { throw new Error('no notes open'); }, decks: () => { throw new Error('not read yet'); } });
  const brief = await m.handlers['brief:get']();
  const problems = brief.items.filter((i) => i.kind === 'problem');
  assert.equal(problems.length, 2);
  assert.ok(problems.some((i) => /Couldn’t read reminders and tasks/.test(i.title) && /may be missing/.test(i.detail) && i.tone === 'warn'), 'the dues failure is said');
  assert.ok(problems.some((i) => /Couldn’t read the flashcard decks/.test(i.title)), 'the decks failure is said');
  assert.ok(!brief.items.some((i) => i.kind === 'reminder' || i.kind === 'task' || i.kind === 'cards'), 'nothing invented for the failed sources');
  const shared = B.buildBrief(input({ problems: [{ source: 'x', words: 'y' }] }));
  assert.ok(shared.items.some((i) => i.kind === 'problem' && i.title === 'Couldn’t read x'), 'the shared side renders problem lines');
});

test('“Not useful”: the line hidden, its kind ranked lower next time, remembered per vault, with Undo', async () => {
  const m = mainSide({ found: async () => FOUND_RAW });
  const first = await m.handlers['brief:get']();
  const price = first.items.find((i) => i.id === 'found:w1');
  assert.ok(price, 'the find is in the brief');
  const before = price.score;
  const after = await m.handlers['brief:not-useful']('found:w1');
  assert.ok(!after.items.some((i) => i.id === 'found:w1'), 'hidden');
  const kept = m.stored();
  assert.ok(kept.hidden['found:w1']);
  assert.deepEqual(Object.keys(kept.notUseful), ['found:price|neuralspark|Price watch']);
  // The same kind of find tomorrow (a new id) ranks lower than this one did.
  const tomorrow = B.buildBrief(input({ prefs: B.cleanPrefs(kept, NOW), found: B.cleanFound([{ id: 'w2', kind: 'price', title: 'Butter price up 4%', source: 'Price watch', priority: 0.8 }]) }));
  const butter = B.candidates(input({ prefs: B.cleanPrefs(kept, NOW), found: B.cleanFound([{ id: 'w2', kind: 'price', title: 'Butter price up 4%', source: 'Price watch', priority: 0.8 }]) })).find((i) => i.id === 'found:w2');
  const shown = tomorrow.items.find((i) => i.id === 'found:w2');
  assert.ok(!shown || shown.score < before, 'ranked lower');
  assert.equal(butter.score, before, 'its own rank is the same; only the setting aside lowers it');
  // Another automation's find isn't set aside by it.
  const council = (prefs) => B.buildBrief(input({ prefs, calendar: null, due: null, projects: null, decks: [], found: B.cleanFound([FOUND_RAW.items[1]]) })).items[0];
  assert.equal(council(B.cleanPrefs(kept, NOW)).score, council(B.NO_PREFS).score);
  // Undo: shown again, the count taken back.
  const undone = await m.handlers['brief:useful-again']('found:w1');
  assert.ok(undone.items.some((i) => i.id === 'found:w1'));
  assert.deepEqual(m.stored().notUseful, {});
  assert.deepEqual(m.stored().hidden, {});
  // A line no longer there: said plainly.
  await assert.rejects(() => m.handlers['brief:not-useful']('nope'), /isn’t in the brief any more/);
});

test('“Not useful” twice on the same line: the second is quiet, never an error (9.5 fourth pass)', async () => {
  const m = mainSide({ found: async () => FOUND_RAW });
  await m.handlers['brief:get']();
  await m.handlers['brief:not-useful']('found:w1');
  const again = await m.handlers['brief:not-useful']('found:w1');
  assert.ok(again.items.every((i) => i.id !== 'found:w1'), 'still hidden, no error');
});

test('overnight finds failing is said once in the log, and when they come back (9.5 fourth pass)', async () => {
  const logged = [];
  let fail = true;
  const m = mainSide({ found: async () => { if (fail) throw new Error('offline'); return FOUND_RAW; }, log: (msg) => logged.push(msg) });
  const b1 = await m.handlers['brief:get']();
  assert.equal(b1.found, 'failed');
  assert.equal(logged.length, 1);
  m.later(61_000);
  const b2 = await m.handlers['brief:get']();
  assert.equal(b2.found, 'failed');
  assert.equal(logged.length, 1, 'still failing: not said again');
  fail = false;
  m.later(61_000);
  const b3 = await m.handlers['brief:get']();
  assert.equal(b3.found, 'ok');
  assert.equal(logged.length, 2, 'recovery is said');
});

test('the preference by numbers: each “Not useful” a third lower, fading by half a month, never to nothing', () => {
  const item = { id: 'cards:2026-10-21', kind: 'cards', source: 'notes' };
  let p = B.markNotUseful(B.NO_PREFS, item, NOW);
  assert.equal(B.setAside(p, 'cards|notes', NOW), 1);
  assert.equal(B.adjusted(60, 1), 39);
  p = B.markNotUseful(p, { ...item, id: 'cards:2026-10-22' }, NOW + DAY);
  assert.ok(Math.abs(B.setAside(p, 'cards|notes', NOW + DAY) - (1 + Math.pow(0.5, 1 / 30))) < 1e-9);
  // A month later each counts half.
  const later = B.setAside(p, 'cards|notes', NOW + 31 * DAY);
  assert.ok(Math.abs(later - B.setAside(p, 'cards|notes', NOW + DAY) / 2) < 1e-9);
  assert.equal(B.adjusted(60, 50), 6, 'never below a tenth');
  // Tomorrow's cards line (a new id) still shows, lower; today's hidden one doesn't.
  const prefs = B.cleanPrefs(p, NOW + DAY);
  const b = B.buildBrief(input({ now: NOW + DAY, prefs, decks: DECKS }));
  assert.ok(!b.items.some((i) => i.id === 'cards:2026-10-22'), 'hidden on the day it was set aside');
  const c = B.candidates(input({ now: NOW + 2 * DAY })).find((i) => i.kind === 'cards');
  const ranked = B.buildBrief(input({ now: NOW + 2 * DAY, prefs, calendar: null, due: null, projects: null, found: [] })).items.find((i) => i.kind === 'cards');
  assert.ok(ranked.score < c.score);
  // A hand-edited or old memory never breaks the brief; old hidden lines are forgotten.
  const messy = B.cleanPrefs({ hidden: { a: NOW, old: NOW - 90 * DAY, bad: 'x' }, notUseful: { k: { n: 2, at: NOW }, z: { n: -1, at: NOW }, w: 'x' } }, NOW);
  assert.deepEqual(messy, { hidden: { a: NOW }, notUseful: { k: { n: 2, at: NOW } } });
  assert.deepEqual(B.cleanPrefs(null), B.NO_PREFS);
});

test('Today’s reading finds projects gone quiet: steps open, nothing changed in a fortnight, not already at risk', () => {
  const now = new Date(2026, 9, 21, 9);
  const ago = (days) => now.getTime() - days * DAY;
  const text = (name, health, steps) => `---\ntype: project\nstatus: active\n${health ? `health: ${health}\n` : ''}---\n# ${name}\n\n## What’s next\n\n${steps.join('\n')}\n`;
  const P = (name, health, steps, modified) => ({ path: `Projects/${name}/${name}.md`, version: 'v', modified, project: T.parseProject(text(name, health, steps), `Projects/${name}/${name}.md`) });
  const d = T.buildToday(
    {
      projects: [
        P('Catering menu', 'on track', ['- [ ] Price the platters', '- [ ] Book a tasting'], ago(23)),
        // Quiet file, but a note in its folder changed last week: not quiet.
        P('Shop sign', '', ['- [ ] Choose the font'], ago(40)),
        // Quiet, but nothing open: nothing to nudge.
        P('Old fair', '', ['- [x] Pack the stall'], ago(60)),
        // Quiet and off track: already in At risk, not said twice.
        P('Van lease', 'off track', ['- [ ] Call the dealer'], ago(30)),
        // Changed ten days ago: not yet.
        P('Website', '', ['- [ ] Write the about page'], ago(10)),
      ],
      notes: [{ path: 'Projects/Shop sign/Font ideas.md', title: 'Font ideas', mtime: ago(6), props: {} }],
    },
    now,
  );
  assert.deepEqual(d.quiet.map((q) => [q.projectName, q.days, q.open, q.next]), [['Catering menu', 23, 2, 'Price the platters']]);
  assert.deepEqual(d.atRisk.map((x) => x.projectName), ['Van lease']);
  assert.equal(T.QUIET_DAYS, 14);
});
