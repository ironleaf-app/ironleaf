// node --test tests/t242-project-today.test.mjs — Vault rebuild step 2 (t242, 12 Nov 2026). The project page
// reads top to bottom (computed standing, Your next 3, Waiting on others, Open questions, Key dates with the
// went-by nudge, Notes and files, People, Decisions, Risks, Activity on true dates); Today answers Late,
// Next, then Waiting on an answer, then Meetings, then one Also fold; Tasks opens on what is real and an
// empty view says why. Fails without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const memory = () => read('src/renderer/src/views/project/memory.ts');
const page = () => read('src/renderer/src/views/ProjectPage.tsx');
const tabs = () => read('src/renderer/src/views/project/ProjectTabs87.tsx');
const todayView = () => read('src/renderer/src/views/TodayView.tsx');
const tasksView = () => read('src/renderer/src/views/TasksView.tsx');

const work = mkdtempSync(path.join(tmpdir(), 'nv-t242-'));
let S, H, B, F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const one = async (inFile, outFile) => {
    await build({ input: path.join(root, inFile), platform: 'node', output: { file: path.join(work, outFile), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, outFile)).href);
  };
  S = await one('src/shared/project-standing.ts', 's.mjs');
  H = await one('src/shared/project-hub.ts', 'h.mjs');
  B = await one('src/shared/brief-tasks.ts', 'b.mjs');
  F = await one('src/shared/project-file.ts', 'f.mjs');
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── The standing works itself out from the dates, with one "I say" override ──

test('an "I say" line parses to its claim and its reason, or nothing', () => {
  assert.deepEqual(S.parseSayOverride('I say: at risk, because ShadeCo may lapse'), { claim: 'at risk', reason: 'ShadeCo may lapse' });
  assert.deepEqual(S.parseSayOverride('i say: on track'), { claim: 'on track', reason: '' });
  assert.deepEqual(S.parseSayOverride('  I SAY:  Off track — the till died  '), { claim: 'Off track', reason: 'the till died' });
  assert.equal(S.parseSayOverride('on track'), null);
  assert.equal(S.parseSayOverride(''), null);
  assert.equal(S.parseSayOverride(undefined), null);
});

test('the one standing reads the override first: yours wins over the dates', () => {
  const s = (p) => S.projectStanding(p);
  // No override: late for you still corrects a stored "on track" (the old rule, kept).
  assert.deepEqual(s({ status: 'active', health: 'on track', lateMine: 2 }), { words: 'At risk', tone: 'warn', open: true });
  // The override wins even when the dates disagree: that is what disagreeing means.
  assert.deepEqual(s({ status: 'active', health: 'I say: on track, because the late rows are waiting on me to tick them', lateMine: 2 }), { words: 'On track', tone: 'ok', open: true });
  assert.deepEqual(s({ status: 'active', health: 'I say: at risk, because ShadeCo may lapse', overdue: false }), { words: 'At risk', tone: 'warn', open: true });
  assert.deepEqual(s({ status: 'active', health: 'I say: off track — the till died', overdue: true }), { words: 'Off track', tone: 'bad', open: true });
  // Finished and shelved still read finished and shelved first (an override never reopens them).
  assert.deepEqual(s({ status: 'done', health: 'I say: at risk, because hmm', lateMine: 1 }), { words: 'Finished', tone: 'none', open: false });
  assert.deepEqual(s({ status: 'on hold', health: 'I say: on track' }), { words: 'On hold', tone: 'none', open: false });
});

test('the standing line counts yours, others, and the next milestone from the hub', () => {
  const hub = (over) => ({ plan: { late: [], week: [], later: [], undated: [], ...(over?.plan ?? {}) }, waiting: over?.waiting ?? [], upcoming: over?.upcoming ?? [] });
  const step = (i) => ({ id: `next:${i}`, ref: { kind: 'next', index: i } });
  const line = S.standingLine(
    hub({ plan: { late: [step(0), step(1), step(2)], week: [step(3)], later: [], undated: [step(4)] }, waiting: [{ person: 'June Park', items: [{ id: 'a' }, { id: 'b', overdue: true }] }, { person: 'Alex Chen', items: [{ id: 'c' }] }], upcoming: [{ id: 'm1', day: 100 }] }),
  );
  assert.deepEqual(line, { mineOpen: 5, mineLate: 3, othersOpen: 3, othersLate: 1, nextDay: 100 });
  // Run-sheet boxes are their layout's door, never yours here; done rows never count (the hub holds open only).
  const line2 = S.standingLine(hub({ plan: { late: [{ id: 'run:x', ref: { kind: 'run', section: 'Run sheet', line: 3 } }], week: [], later: [], undated: [] }, waiting: [], upcoming: [] }));
  assert.deepEqual(line2, { mineOpen: 0, mineLate: 0, othersOpen: 0, othersLate: 0, nextDay: null });
});

// ── The project page, top to bottom ──

test('the folio walks the briefed order: yours, waiting, questions, dates, notes, people, decisions, risks', () => {
  const ids = [...memory().matchAll(/\{ id: '([a-z-]+)', title: (?:"(.+?)"|'(.+?)') \}/g)].map((m) => [m[1], m[2] ?? m[3]]);
  const order = ids.map(([id]) => id);
  const named = ['whats-next', 'waiting', 'questions', 'key-dates', 'notes', 'people', 'decisions', 'risks'];
  let last = -1;
  for (const id of named) {
    const at = order.indexOf(id);
    assert.ok(at > last, `${id} walks after the last named section (${order.join(',')})`);
    last = at;
  }
  assert.ok(order.indexOf('activity') > order.indexOf('risks'), 'Activity walks last of the named sections');
  const titles = Object.fromEntries(ids);
  assert.equal(titles['whats-next'], 'Your next');
  assert.equal(titles.waiting, 'Waiting on others');
  assert.equal(titles.questions, 'Open questions');
  for (const [id, title] of named.map((id) => [id, titles[id]])) {
    // t249 item 4 (approved plan): Your next's head names what it shows ("Your next 3", "Your next 5",
    // "Your next"), so that one section reads its title from `head`.
    const shown = id === 'whats-next' ? '\\{head\\}' : `"${title}"`;
    assert.ok(new RegExp(`<Section[^>]*id="${id}"[^>]*title=${shown}`, 's').test(tabs()), `${title} renders as its section`);
  }
  assert.ok(/const head = [^\n]*'Your next 3'[^\n]*'Your next'/.test(tabs()), 'the head reads Your next 3 folded and Your next when short');
});

test('one view per list: no Show-as switch and no per-section Find on the project page', () => {
  const t = tabs();
  assert.ok(!t.includes("['rows', 'board', 'calendar', 'timeline']"), 'the Show-as switch is gone (decision 2: one view per list)');
  assert.ok(!t.includes('<TasksTimelineView ctx={ctx} />'), 'no second date list beside the tasks');
  assert.ok(!t.includes('Find a task') && !t.includes('Search notes and files'), 'no per-section Find boxes');
  // t255: a tab earns its own Find only past one screen — one shared box, never a Find per section.
  const bar = read('src/renderer/src/components/PageTabs.tsx');
  assert.ok(bar.includes('export function TabFind'), 'the one shared Find lives with the tabs');
  assert.ok(bar.includes('el.scrollHeight > scroller.clientHeight'), 'only past one screen');
  assert.ok(!t.includes('<TabFind'), 'no section carries its own');
  assert.ok(!t.includes('className="w2a-sub"'), 'no explainer paragraphs');
});

test('Your next 3, then All N of yours — mine only, one flat list', () => {
  const t = tabs();
  const sec = t.slice(t.indexOf('export function WhatsNextSection'), t.indexOf('export function WhatsNextSection') + 6000);
  assert.ok(sec.includes('Your next 3') || t.includes('Your next 3'), 'the head reads Your next 3');
  assert.ok(t.includes('of yours'), 'then All N of yours');
  assert.ok(!sec.includes('From meetings and notes'), 'no second list beside mine (one flat list)');
});

test('the project chip reads the one standing with your late steps, as Projects home does', () => {
  const p = page();
  assert.ok(p.includes('lateMine') && p.includes('projectStanding({'), 'the chip weighs your late steps');
  assert.ok(p.includes('of yours open') && p.includes('with others'), 'the standing lines work themselves out from the dates');
  assert.ok(p.includes('Next milestone') && p.includes('You say'), 'the next milestone reads, and your override reads as yours');
});

test('the went-by nudge lives in Key dates, marked where each date sits', () => {
  const p = page();
  assert.ok(!p.includes('dates went by. Did they happen?') && !p.includes('1 date went by. Did it happen?'), 'no banner above the sections');
  const t = tabs();
  const sec = t.slice(t.indexOf('export function KeyDatesSection'));
  assert.ok(sec.includes('went by. Did it happen?') || sec.includes('went by. Did they happen?'), 'Key dates keeps the nudge');
});

test('a risk bullet reads without file syntax, and anything else stays whole', () => {
  assert.deepEqual(F.splitRiskTail('Repeat failures on old Safari (owner: Priya Nair, level: medium)'), { what: 'Repeat failures on old Safari', owner: 'Priya Nair', level: 'medium', tail: 'owner: Priya Nair, level: medium' });
  assert.deepEqual(F.splitRiskTail('The till dies (level: high)'), { what: 'The till dies', level: 'high', tail: 'level: high' });
  assert.deepEqual(F.splitRiskTail('The till dies (owner: Alex Chen)'), { what: 'The till dies', owner: 'Alex Chen', tail: 'owner: Alex Chen' });
  assert.deepEqual(F.splitRiskTail('A bracket that is not a tail (see the appendix)'), { what: 'A bracket that is not a tail (see the appendix)', tail: '' });
  assert.deepEqual(F.splitRiskTail('No bracket at all'), { what: 'No bracket at all', tail: '' });
});

test('opening a step lands on its row, in Your next or Waiting on others', () => {
  // Someone else's step reads as a data-action row in Waiting, never in Your next: the reveal matches it,
  // so opening it lands on the row and never silently on the card.
  const reveal = read('src/renderer/src/views/timeline/reveal.ts');
  assert.ok(reveal.includes('[data-action="'), 'the mark matches Waiting rows too');
  // t255: the tab is read from the hub, never guessed from what is drawn.
  const p = page();
  const keys = p.slice(p.indexOf('function tabForKey'), p.indexOf('function tabForKey') + 800);
  assert.ok(keys.includes("key.startsWith('next:')") && keys.includes("key.startsWith('run:')"), 'steps and run rows resolve by key');
  assert.ok(keys.includes("return 'waiting'") && keys.includes("return 'whats-next'"), 'Your next or Waiting with the row');
});

test('every badge counts what its list shows', () => {
  // t255: the tabs count through the one tabCounts, beside the sections.
  const t = tabs();
  const counts = t.slice(t.indexOf('export function tabCounts'), t.indexOf('export function tabCounts') + 1400);
  assert.ok(counts.includes('whats-next') && counts.includes('questions'), 'yours and open questions are counted');
  assert.ok(counts.includes('decisions') && counts.includes('decisionsFlowed'), 'decisions count what the list shows, flowed rows too');
});

// ── Today answers three questions, then Meetings, then Also ──

test('Today walks Late, Next, Waiting on an answer, Meetings, then Also', () => {
  const v = todayView();
  const order = ['data-section="late"', 'data-section="next"', '<Section id="questions"', 'data-section="meetings"', 'data-section="also"'];
  let last = -1;
  for (const id of order) {
    const at = v.indexOf(id);
    assert.ok(at > last, `${id} walks after the last (${order.join(',')})`);
    last = at;
  }
  assert.ok(v.includes('Waiting on an answer'), 'open questions wait on an answer, asked of others or of you');
  assert.ok(!v.includes('things need a look'), 'no whisper link: Also looks like a section');
});

test('Late, Next and the fold partition the one list: each job shows once', () => {
  const v = todayView();
  // Late is the list's late rows; Next is the first five of what is left; the fold holds the rest.
  assert.ok(v.includes('splitTodayTop(ranked,'), 'Late, Next and the rest split the one list once');
  const late = B.splitTodayTop(
    [
      { kind: 'step', step: { offset: -2 } },
      { kind: 'step', step: { offset: 0 } },
      { kind: 'note', entry: {}, offset: 3 },
    ],
    [{ offset: -1 }],
    5,
  );
  const ids = [...late.late, ...late.next, ...late.rest].map((w) => ('step' in w ? w.step.offset : w.offset));
  assert.deepEqual(ids.sort(), [-2, -1, 0, 3].sort(), 'late, next and rest hold every row exactly once');
});

test('a page that only shows yours shows no owner chips for you', () => {
  const v = todayView();
  assert.ok(v.includes('visibleWho('), 'own rows read through the one rule that hides your own name');
});

// ── Tasks opens on what is real ──

test('an empty Tasks view says why, in plain words, and offers the undated rows', () => {
  const v = tasksView();
  assert.ok(!v.includes('title="No tasks match"'), 'no confident wrong answer');
  assert.ok(v.includes('Nothing ${whose} is dated this week.') && v.includes('no date: show them') && v.includes("label: 'Show them'"), 'why, and the way to the undated rows');
});
