// node --test tests/today-day-shape.test.mjs — Vault Today is the day's shape (5 Nov 2026). Today:
// the date, one sentence that says what the day is, Next for you (5), today's meetings, one fold
// line for everything else (the day's note, waiting on others, the week). No side column. Home
// folds into Today: its cards become Today's folded sections, old links to Home open Today, the
// Home rail row goes. One counting query for late, today and this week, shared by Today, Tasks and
// the rail (the audit found 13 versus 33 for the same thing). Fails without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-dayshape-'));
let T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/today.ts'))};\nexport { parseProject } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  T = await import(pathToFileURL(path.join(work, 't.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = new Date(2026, 10, 5, 9, 0); // Thursday 5 November 2026

// ── One sentence that says what the day is ─────────────────────────────────────

test('one sentence says what the day is: date plus a single warm line, never five numbers', () => {
  assert.equal(typeof T.daySentence, 'function', 'shared/today.ts exports daySentence');
  // A busy day names its shape in one sentence.
  const busy = T.daySentence({ late: 3, today: 2, meetings: 1, waiting: 4 });
  assert.ok(typeof busy === 'string' && busy.length > 0, 'a line for a busy day');
  assert.ok(!/\n/.test(busy), 'one line, never several');
  // One sentence: a single full stop at the end (no run of figures).
  assert.ok((busy.match(/\./g) ?? []).length <= 1, `one sentence, not several: ${busy}`);
  assert.ok(/3/.test(busy) && /2/.test(busy), `late and today in it: ${busy}`);
  // A clear day says so warmly.
  const clear = T.daySentence({ late: 0, today: 0, meetings: 0, waiting: 0 });
  assert.ok(/clear|quiet|nothing/i.test(clear), `a clear day says so: ${clear}`);
  // Plain Australian English, no jargon.
  for (const s of [busy, clear]) {
    assert.ok(!/DSH|DeepSeek|pi-ai/i.test(s), 'no engine names');
  }
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('daySentence'), 'Today renders the one sentence');
});

test('Today shows Late, Next (5), Waiting on an answer, meetings, then one Also section', () => {
  // Step 2 (12 Nov 2026): Today answers three questions in order, then Meetings, then one Also fold that
  // looks like a section.
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('td-h-late') && src.includes('>Next</h2>') && src.includes('Waiting on an answer'), 'Late, Next, Waiting on an answer');
  assert.ok(/NEXT_SHOWN\s*=\s*5/.test(src), 'Next at most five');
  // Today's meetings as their own section after the three questions.
  assert.ok(src.includes('<DayAgenda') || src.includes('Meetings'), 'meetings on Today');
  // One Also section past Meetings; the day's note, waiting on others and the week fold inside with the rows.
  assert.ok(src.includes('data-section="also"'), 'one Also section');
  assert.ok(!src.includes('things need a look'), 'never the whisper line any more');
  assert.ok(!src.includes('Show everything else'), 'never the old naming any more');
  assert.ok(src.includes('<DayNote'), 'the day’s note folds inside');
  assert.ok(src.includes('Waiting on others'), 'waiting folds inside');
  assert.ok(src.includes('<WeekStrip'), 'the week folds inside');
  // No side column: a single column only.
  assert.ok(!src.includes('td-col side'), 'no side column in Today');
  assert.ok(!src.includes('className="td-col side"'), 'no side column class');
});

test('no set-up nudges, weekly-review or tidy cards unless due: then one quiet line', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  // The loud cards are gone: no big weekly-review card, no tidy project cards on Today.
  assert.ok(!src.includes('td-review-actions'), 'no big weekly-review card with actions');
  assert.ok(!src.includes('could be tidied'), 'no tidy project cards');
  // What is due shows as a quiet line (a single line, not a card).
  assert.ok(/quiet-line|td-quiet/i.test(src), 'a quiet line for what is due');
});

// ── Home folds into Today ──────────────────────────────────────────────────────

test('Home folds into Today: a turned-on card is a row in the list, not a block', () => {
  const today = read('src/renderer/src/views/TodayView.tsx');
  // 8 Nov 2026, calm Today: "Your cards" and "Change cards" are gone; a card turned on is a row in the
  // list (inbox, recent, and the pack cards), opening to its card as the old fold did.
  for (const card of ['InboxCard', 'RecentCard', 'BillsCard', 'HabitsCard', 'WeeklyCard', 'FamilyCard']) {
    assert.ok(today.includes(card), `${card} renders on Today`);
  }
  assert.ok(!today.includes('Your cards'), 'no Your-cards block');
  assert.ok(!today.includes('Change cards') && !today.includes('<ChangeHome'), 'no changer on Today');
  assert.ok(!today.includes('TodayHomeCards'), 'no folded-sections block');
  // The arrangement is still the person's own (home-cards prefs), read for the rows' order.
  assert.ok(today.includes('useHomeLayout') && today.includes('extrasOf('), 'the rows follow the person’s arrangement');
  assert.ok(today.includes('LookCards'), 'through the list’s card rows');
});

test('old links to Home open Today; the Home rail row goes', () => {
  const actions = read('src/renderer/src/state/actions.ts');
  // openHome opens Today now (one morning place).
  const openHome = actions.split('export function openHome')[1]?.split('export function')[0] ?? '';
  assert.ok(/openToday|openSingle\('today'|type.*today/i.test(openHome), `openHome opens Today: ${openHome.slice(0, 200)}`);
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(!places.includes("label: 'Home'") && !places.includes('label: "Home"'), 'no Home row on the rail');
  const ws = read('src/renderer/src/views/Workspace.tsx');
  // A home tab draws Today (old links keep working).
  const homeCase = ws.split(") : tab.type === 'home'")[1]?.split(') : tab.type')[0] ?? '';
  assert.ok(/TodayView/.test(homeCase), 'a home tab draws Today');
  const empty = read('src/renderer/src/views/EmptyView.tsx');
  assert.ok(empty.includes('TodayView') || empty.includes('openToday'), 'an empty tab opens Today, not Home');
});

// ── One counting query ─────────────────────────────────────────────────────────

test('one rule counts late, today and this week, shared by Today, Tasks and the rail', () => {
  assert.equal(typeof T.countLateTodayWeek, 'function', 'shared/today.ts exports countLateTodayWeek');
  // Same input, same answer: own open tasks by day, unowned is theirs, done never counts.
  const tasks = [
    { words: 'Late job — Mia', due: '2026-11-03', done: false },
    { words: 'Older late job', due: '2026-11-01', done: false },
    { words: 'Today job — Mia', due: '2026-11-05', done: false },
    { words: 'Week job', due: '2026-11-08', done: false },
    { words: 'Later job', due: '2026-11-20', done: false },
    { words: 'Theirs — Priya', due: '2026-11-03', done: false },
    { words: 'Done late job', due: '2026-11-02', done: true },
    { words: 'No date yet', due: null, done: false },
  ];
  const c = T.countLateTodayWeek(tasks, 'Mia Tran', TODAY);
  assert.deepEqual(c, { late: 2, today: 1, week: 1 }, `late, today, week: ${JSON.stringify(c)}`);
  // Every surface counts the filtered lists it shows, through the one rule (t76: re-deriving ownership
  // from words disagreed with the lists whenever me was null — the sentence said "Nothing needs you
  // today" above late rows).
  const today = read('src/renderer/src/views/TodayView.tsx');
  const tasksView = read('src/renderer/src/views/TasksView.tsx');
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(today.includes('dayShapeCounts(projectSteps'), 'Today reads the one rule over the list it shows');
  assert.ok(tasksView.includes('dayShapeCounts('), 'Tasks reads the one rule');
  // t31 (8 Nov 2026): the rail reads sidebarTodayCount, the one count shared with the former host app's
  // one side bar.
  const shared = read('src/shared/today.ts');
  const badge = shared.split('export function sidebarTodayCount')[1]?.split('export function ')[0] ?? '';
  assert.ok(places.includes('sidebarTodayCount(') && badge.includes('dayShapeCounts('), 'the rail reads the one rule');
  // No second week count beside it on Today (the 13 versus 33 gap).
  assert.ok(!today.includes('dueHead.week'), 'no separate week figure beside the one query');
});

// ── The sentence reads the same counts the list shows (t76) ────────────────────
// Today said "Nothing needs you today" above four late rows: two projects with two owners,
// so me is null, and the sentence re-derived ownership from words (every named step read as
// someone else's) while the list read buildToday's project-owner fallback. The sentence counts
// the lists the page shows — own project steps plus own hub lines — through one rule, and the
// rail badge and Tasks pills read that same rule, so every mouth says one number. Stale counts
// apart, never leading (u3, pinned): the rule skips it, as the one number always has.
const t76iso = (days) => { const d = new Date(2026, 10, 5 + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('no single owner: named late steps still shape the sentence', () => {
  assert.equal(typeof T.dayShapeCounts, 'function', 'shared/today.ts exports dayShapeCounts');
  const files = {
    'Projects/Cart Fix/Cart Fix.md': `---\ntype: project\nstatus: active\nhealth: on track\nowner: Alex Chen\n---\n# Cart Fix\n\n## What’s next\n\n- [ ] Chase the failed carts — Alex Chen · by ${t76iso(-4)}\n- [ ] Send the receipt — Alex Chen · by ${t76iso(-5)}\n- [ ] Tidy the spares shelf — Alex Chen · by ${t76iso(-40)}\n`,
    'Projects/Roster/Roster.md': `---\ntype: project\nstatus: active\nhealth: on track\nowner: Priya Nair\n---\n# Roster\n\n## What’s next\n\n- [ ] Publish the roster — Priya Nair · by ${t76iso(-12)}\n`,
  };
  const at = (n) => new Date(2026, 10, 5 + n, 10).getTime();
  const input = Object.entries(files).map(([p, text], i) => ({ path: p, version: `v${i}`, modified: at(-10 + i), project: T.parseProject(text, p) }));
  const d = T.buildToday({ projects: input, notes: [] }, TODAY);
  assert.equal(d.me, null, 'two owners and no given name: no single me');
  // The list the page shows: its steps, as TodayView's projectSteps reads them (stale rides along).
  const steps = [...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later, ...d.due.stale].filter((x) => x.kind === 'step');
  assert.equal(steps.length, 4, 'the list holds four late steps');
  const c = T.dayShapeCounts(steps, [t76iso(0), t76iso(3), t76iso(-40)], TODAY);
  assert.deepEqual(c, { late: 3, today: 1, week: 1 }, `late, today, week: ${JSON.stringify(c)}`);
  assert.equal(T.daySentence({ late: c.late, today: c.today, meetings: 0 }), 'You have 3 late and 1 due today.');
  assert.equal(T.daySentence({ late: 0, today: 0, meetings: 0 }), 'Nothing needs you today.', 'that line only when nothing is late or due');
  // Stale apart: a stale step and a stale note day shape nothing on their own.
  const staleOnly = T.dayShapeCounts([{ offset: -40 }], [t76iso(-40)], TODAY);
  assert.deepEqual(staleOnly, { late: 0, today: 0, week: 0 }, 'stale counts apart, never leading');
});

