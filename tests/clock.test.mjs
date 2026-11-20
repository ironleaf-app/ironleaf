// node --test tests/clock.test.mjs — one meeting time blanked the whole Vault (8.7 urgent, 30 Oct 2026: a meeting
// today with `time: "3:00 PM"` made `new Date(`${date}T${time}`)` an Invalid Date, MONTH[NaN] threw in Home's Upcoming
// card, and with no boundary the window opened blank). The times people write ("15:00", "3:00 PM", "3pm", "3.00 pm",
// with or without seconds) read the one shared way (src/shared/clock.ts); what cannot be read shows as written, never
// a crash, never "Invalid Date", never NaN; every date-to-words helper guards an unreadable moment; and each Home card,
// each page's main area and the app itself sit in a guard that shows plain words with Try again. Fails without each
// change: the old Upcoming line, the unguarded helpers and the missing guards are asserted gone or present by their
// own words.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-clock-'));
let C, PL, F, WM, P, EB;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const one = async (name, file) => {
    await build({ input: path.join(root, file), platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  [C, PL, F, WM, P, EB] = await Promise.all([
    one('c', 'src/shared/clock.ts'),
    one('pl', 'src/renderer/src/lib/projectLook.ts'),
    one('f', 'src/shared/finance.ts'),
    one('wm', 'src/shared/work-meetings.ts'),
    one('p', 'src/shared/projects-87.ts'),
    one('eb', 'src/renderer/src/components/ErrorBoundary.tsx'),
  ]);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the one reader reads every way people write a time, with or without seconds', () => {
  assert.deepEqual(C.readClockTime('15:00'), { hours: 15, minutes: 0 });
  assert.deepEqual(C.readClockTime('3:00 PM'), { hours: 15, minutes: 0 });
  assert.deepEqual(C.readClockTime('3pm'), { hours: 15, minutes: 0 });
  assert.deepEqual(C.readClockTime('3.00 pm'), { hours: 15, minutes: 0 });
  assert.deepEqual(C.readClockTime('08:00'), { hours: 8, minutes: 0 });
  assert.deepEqual(C.readClockTime('15:00:00'), { hours: 15, minutes: 0 });
  assert.deepEqual(C.readClockTime('3:00:00 pm'), { hours: 15, minutes: 0 });
  assert.deepEqual(C.readClockTime('12:00 AM'), { hours: 0, minutes: 0 });
  assert.deepEqual(C.readClockTime('12pm'), { hours: 12, minutes: 0 });
  assert.deepEqual(C.readClockTime('9:05 a.m.'), { hours: 9, minutes: 5 });
});

test('the reader says plainly when it cannot: null, shown as written, never NaN', () => {
  for (const raw of ['', '  ', 'after lunch', '25:00', '13:00 PM', '3', '3:60', '15:00:61', null, undefined]) assert.equal(C.readClockTime(raw), null, JSON.stringify(raw));
  assert.equal(C.clockWords('3:00 PM'), '3:00 pm');
  assert.equal(C.clockWords('after lunch'), 'after lunch');
  assert.equal(C.clockWords(''), '');
  assert.equal(C.clockWords(null), '');
  assert.equal(C.dayTimeMs('2026-10-30', 'after lunch'), null);
  assert.equal(C.dayTimeMs('not-a-day', '15:00'), null);
});

test("the day's meetings with 3:00 PM make that day at 3 pm, not an Invalid Date", () => {
  const at = C.dayTimeMs('2026-10-30', '3:00 PM');
  assert.ok(Number.isFinite(at), 'a real moment');
  const d = new Date(at);
  assert.equal(d.getHours(), 15);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getDate(), 30);
  // (10.0 one start: meetings are the day's own agenda now, and it shows the time as written, parsing nothing.)
  const parts = read('src/renderer/src/views/today/DayParts.tsx');
  assert.ok(parts.includes("m.time ?? 'All day'"), 'the agenda shows the time as written');
  assert.ok(!parts.includes('T${m.time') && !parts.includes('MONTH['), 'no Invalid Date line, no month indexing');
  assert.ok(read('src/renderer/src/lib/projectLook.ts').includes('if (!Number.isFinite(ms)) return'), 'whenAgo guards an unreadable moment');
});

test('every date-to-words helper guards an unreadable date', () => {
  assert.equal(PL.whenAgo(NaN), '');
  assert.equal(PL.shortDate(NaN), '');
  assert.equal(PL.whenAgo(Date.now()), 'today');
  assert.equal(F.dueWords('someday', '2026-10-30'), 'someday');
  assert.equal(F.dueWords('2026-11-03', '2026-10-30'), 'Tue 3 Nov');
  assert.ok(read('src/renderer/src/views/TodayView.tsx').includes('Number.isFinite(ms)'), "Today's words are guarded");
  assert.ok(read('src/renderer/src/views/today/DayParts.tsx').includes('Number.isFinite(ms)'), "the day's words are guarded");
});

test('meeting and task times read the one shared way wherever they show', () => {
  assert.equal(WM.meetingTimeWords('3.00 pm'), '3:00 pm');
  assert.equal(WM.meetingTimeWords('15:00:00'), '3:00 pm');
  assert.equal(WM.meetingTimeWords('3:00 PM'), '3:00 pm');
  assert.equal(WM.meetingTimeWords('12:00 AM'), '');
  assert.equal(WM.meetingTimeWords('22:00'), '10:00 pm');
  assert.equal(WM.meetingTimeWords('after standup'), 'after standup');
  // 5 Nov 2026, status in plain words: the tag reads attention/muted, never an amber tint (w2a-tasks-inbox
  // asserts the same shape); the words — the shared reading this test guards — are unchanged.
  assert.deepEqual(P.taskDueTag('2026-10-30', '3pm', '2026-10-30'), { words: '3:00 pm', tone: 'muted' });
  assert.deepEqual(P.taskDueTag('2026-10-30', 'after lunch', '2026-10-30'), { words: 'after lunch', tone: 'muted' });
  assert.deepEqual(P.taskDueTag('2026-10-30', '15:00', '2026-10-30'), { words: '3:00 pm', tone: 'muted' });
  assert.ok(read('src/renderer/src/views/TasksView.tsx').includes('taskDueTag(t.due, t.time, today'), 'task rows read the shared tag');
  assert.ok(read('src/shared/projects-87.ts').includes('clockWords(time)'), 'the tag reads the shared clock words');
  assert.ok(read('src/shared/tasks.ts').includes('readClockTime'), 'a task made a reminder reads the shared way');
});

test('a card that fails shows plain words with Try again while its siblings stand', () => {
  assert.deepEqual(EB.ErrorBoundary.getDerivedStateFromError(new Error('boom')), { failed: true });
  const ok = new EB.ErrorBoundary({ children: 'standing', kind: 'card' });
  assert.equal(ok.render(), 'standing', 'a card that works shows');
  const failed = new EB.ErrorBoundary({ children: 'fallen', kind: 'card' });
  failed.state = { failed: true };
  const words = [];
  const buttons = [];
  const walk = (el) => {
    if (typeof el === 'string') words.push(el);
    else if (Array.isArray(el)) el.forEach(walk);
    else if (el && typeof el === 'object') {
      if (el.type === 'button') buttons.push(el);
      walk(el.props?.children);
    }
  };
  walk(failed.render());
  assert.ok(words.some((w) => w.includes("This card couldn't show.")), `the plain card shows (got ${JSON.stringify(words)})`);
  assert.ok(words.includes('Try again'), 'Try again is offered');
  // Two buttons since 8.7.1 (31 Oct 2026, never silent): Try again, and Copy details so the person can send what the
  // guard caught.
  assert.equal(buttons.length, 2, 'Try again and Copy details');
  assert.ok(words.includes('Copy details'), 'Copy details is offered');
  assert.equal(typeof buttons[0].props.onClick, 'function', 'Try again tries again');
  const start = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(/extras\.map\(\(\s*id\s*\)\s*=>\s*\(\s*<CardGuard/.test(start), 'each extra card sits in its own guard (3 Nov 2026: the extras live on Home)');
});

test('a guard logs the failure, and every page and the app itself sit in one', () => {
  const logged = [];
  const err = console.error;
  console.error = (...a) => void logged.push(a);
  try {
    new EB.ErrorBoundary({ children: 'x', kind: 'card', name: 'upcoming' }).componentDidCatch(new Error('boom'));
  } finally {
    console.error = err;
  }
  assert.equal(logged.length, 1, 'the error is logged once');
  assert.ok(String(logged[0][0]).includes('upcoming'), 'with which card failed');
  assert.ok(read('src/renderer/src/views/Workspace.tsx').includes('<PageGuard key={tab.id}'), "each page's main area sits in a guard");
  assert.ok(read('src/renderer/src/main.tsx').includes('<AppGuard>'), 'the app itself sits in a guard');
});

test('a time of day in minutes, however written (9.5 fourth pass)', () => {
  assert.equal(C.timeMinutes('9:30 am'), 570);
  assert.equal(C.timeMinutes('14:00'), 840);
  assert.equal(C.timeMinutes('2pm'), 840);
  assert.equal(C.timeMinutes(null), null);
  assert.equal(C.timeMinutes('sometime'), null);
});
