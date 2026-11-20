// node --test tests/calendar.test.mjs — today's calendar on Today (src/shared/calendar.ts, src/main/calendar.ts; 21 Oct
// 2026, part of gap G5): The former host app's route stubbed in each of its states (connected with events, with none,
// with a calendar that couldn't be read; not set up, not offered, signed out, needs sign-in, calendar off; not answering;
// answering nonsense), what Today shows for each (the events, the connect door for switched off, never set up or
// unreachable, else nothing), event times as people read them, and the meeting note an event becomes. Made-up events
// only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-calendar-'));
let C, M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/calendar.ts'), platform: 'node', output: { file: path.join(work, 'c.mjs'), format: 'esm' }, logLevel: 'silent' });
  await build({ input: path.join(root, 'src/main/calendar.ts'), platform: 'node', external: [/^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  C = await import(pathToFileURL(path.join(work, 'c.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// Times in this PC's own zone, as the former host app gives them (with their offset).
const at = (h, m = 0, day = 21) => new Date(2026, 9, day, h, m).toISOString();
const EVENTS = [
  { id: 'e2', calendar: 'Work', title: 'Supplier call: Western Plains', start: at(14), end: at(14, 30), allDay: false, location: '', meetingLink: 'https://meet.example.com/abc-defg', link: 'https://calendar.example.com/e2' },
  { id: 'e1', calendar: 'Work', title: 'Morning bake check', start: at(9), end: at(9, 30), allDay: false, location: 'Bakehouse kitchen', meetingLink: '', link: 'https://calendar.example.com/e1', tentative: true },
  { id: 'e0', calendar: 'Family', title: 'Mia’s birthday', start: '2026-10-21', end: '2026-10-22', allDay: true, location: '', meetingLink: '', link: '', free: true },
];
const CONNECTED = { connected: true, date: '2026-10-21', timeZone: 'Australia/Melbourne', updated: at(8), events: EVENTS };

test('the route stubbed in each state: what reaches the window, and what Today shows', async () => {
  const ask = (value) => ({ ask: async () => value });
  const shown = async (value) => C.calendarBlock(await M.calendarToday(ask(value)));

  const ok = await M.calendarToday(ask(CONNECTED));
  assert.equal(ok.connected, true);
  // All-day first, then by start.
  assert.deepEqual(ok.events.map((e) => e.id), ['e0', 'e1', 'e2']);
  assert.equal(ok.events[1].tentative, true);
  assert.equal(ok.events[0].free, true);
  assert.equal(C.calendarBlock(ok), 'events');
  // Connected with nothing on: still shown, calmly ("Nothing on your calendar today").
  assert.equal(await shown({ ...CONNECTED, events: [] }), 'events');
  // A calendar that couldn't be read: the rest shown, with the words.
  const part = await M.calendarToday(ask({ ...CONNECTED, error: '“Team” could not be read.' }));
  assert.equal(part.error, '“Team” could not be read.');
  assert.equal(C.calendarBlock(part), 'events');

  // Not connected: nothing at all, except the connect door for a calendar switched off, never set up, or
  // unreachable (16 Nov 2026 audit finding 3: Today said nothing with no button when the former host app was
  // missing or shut).
  for (const reason of ['not-offered', 'signed-out', 'needs-sign-in']) {
    assert.deepEqual(await M.calendarToday(ask({ connected: false, reason })), { connected: false, reason });
    assert.equal(await shown({ connected: false, reason }), 'hidden', reason);
  }
  assert.deepEqual(await M.calendarToday(ask({ connected: false, reason: 'not-set-up' })), { connected: false, reason: 'not-set-up' });
  assert.equal(await shown({ connected: false, reason: 'not-set-up' }), 'connect');
  assert.equal(await shown({ connected: false, reason: 'calendar-off' }), 'connect');
  assert.equal(await shown({ connected: false, reason: 'something new' }), 'connect');

  // The former host app failing, never answering, or answering nonsense: the connect door, never an
  // error.
  assert.deepEqual(await M.calendarToday({ ask: async () => { throw new Error('the host app is still starting.'); } }), { connected: false, reason: 'unavailable' });
  assert.deepEqual(await M.calendarToday({ ask: () => new Promise(() => {}), timeoutMs: 30 }), { connected: false, reason: 'unavailable' });
  for (const junk of [null, 'calendar', [], { connected: true }, { connected: true, date: 'today', events: [] }]) assert.equal(await shown(junk), 'connect');
  // No the former host app (Ironleaf on its own): the connect door, named Get the former host app
  // by the screen.
  assert.deepEqual(await M.calendarToday({}), { connected: false, reason: 'unavailable' });
  assert.equal(await shown({}), 'connect');
  assert.equal(C.calendarBlock(null), 'hidden');
});

test('a development build’s made-up day from a file stands in for the host app', async () => {
  const file = path.join(work, 'day.json');
  writeFileSync(file, JSON.stringify(CONNECTED));
  assert.equal((await M.calendarToday({ testFile: file })).events.length, 3);
  writeFileSync(file, '{ not json');
  assert.deepEqual(await M.calendarToday({ testFile: file }), { connected: false, reason: 'unavailable' });
});

test('events are checked: only web links kept, a missing title named, a bad start dropped', () => {
  const r = C.cleanCalendar({
    ...CONNECTED,
    events: [
      { id: 'x', title: '', start: at(10), end: at(11), allDay: false, meetingLink: 'javascript:alert(1)', link: 'file:///C:/x' },
      { id: 'y', title: 'Broken', start: 'soon', end: '' },
      { id: 'z', title: 'Late', start: at(18), end: 'later', allDay: false, meetingLink: 'https://zoom.example.com/j/1' },
    ],
  });
  assert.deepEqual(r.events.map((e) => [e.id, e.title, e.meetingLink, e.link]), [
    ['x', '(No title)', '', ''],
    ['z', 'Late', 'https://zoom.example.com/j/1', ''],
  ]);
  assert.equal(r.events[1].end, r.events[1].start);
});

test('event times as Today shows them', () => {
  const ev = (start, end, allDay = false) => ({ id: 'a', calendar: '', title: 't', start, end, allDay, location: '', meetingLink: '', link: '' });
  assert.equal(C.eventTime(ev(at(9), at(9, 30)), '2026-10-21'), '9:00 am – 9:30 am');
  assert.equal(C.eventTime(ev(at(14, 15), at(14, 15)), '2026-10-21'), '2:15 pm');
  assert.equal(C.eventTime(ev('2026-10-21', '2026-10-22', true), '2026-10-21'), 'All day');
  assert.equal(C.eventTime(ev(at(22, 0, 20), at(10, 30)), '2026-10-21'), 'Until 10:30 am');
  assert.equal(C.eventTime(ev(at(16), at(9, 0, 22)), '2026-10-21'), 'From 4:00 pm');
  assert.equal(C.eventTime(ev(at(9, 0, 20), at(9, 0, 23)), '2026-10-21'), 'All day');
  const noon = new Date(2026, 9, 21, 12).getTime();
  assert.equal(C.eventNow(ev(at(9), at(9, 30)), noon), 'past');
  assert.equal(C.eventNow(ev(at(11), at(13)), noon), 'now');
  assert.equal(C.eventNow(ev(at(14), at(15)), noon), 'later');
});

test('an event becomes a Meeting note titled with the event and the day, linked back by its id; people left to the person', () => {
  const ok = C.cleanCalendar(CONNECTED);
  const call = ok.events.find((e) => e.id === 'e2');
  assert.deepEqual(C.meetingNoteFor(call, '2026-10-21'), {
    title: 'Supplier call Western Plains 21 Oct 2026',
    values: { date: '2026-10-21', 'calendar-event': 'e2', time: '14:00', 'meeting-link': 'https://meet.example.com/abc-defg' },
  });
  const kitchen = C.meetingNoteFor(ok.events.find((e) => e.id === 'e1'), '2026-10-21');
  assert.equal(kitchen.values.location, 'Bakehouse kitchen');
  assert.equal(kitchen.values.time, '09:00');
  const allDay = C.meetingNoteFor(ok.events.find((e) => e.id === 'e0'), '2026-10-21');
  assert.equal(allDay.values.time, undefined);
  assert.ok(!('people' in allDay.values));
});

test('a calendar that cannot be reached is said in the log, with why (9.5 fourth pass)', async () => {
  const logged = [];
  const log = (m) => logged.push(m);
  assert.deepEqual(await M.calendarToday({ ask: async () => { throw new Error('refused'); }, log }), { connected: false, reason: 'unavailable' });
  assert.deepEqual(await M.calendarToday({ ask: () => new Promise(() => {}), timeoutMs: 30, log }), { connected: false, reason: 'unavailable' });
  assert.equal(logged.length, 2);
  assert.ok(/refused/.test(logged[0]), 'the refusal’s words kept');
  assert.ok(/did not answer/.test(logged[1]), 'a timeout says so');
});

test('an answer that cannot be checked is logged, never silently dropped (9.5 fourth pass)', async () => {
  const logged = [];
  assert.deepEqual(await M.calendarToday({ ask: async () => ({ connected: true }), log: (m) => logged.push(m) }), { connected: false, reason: 'unavailable' });
  assert.equal(logged.length, 1);
  const quiet = [];
  await M.calendarToday({ ask: async () => ({ connected: false, reason: 'signed-out' }), log: (m) => quiet.push(m) });
  assert.deepEqual(quiet, [], 'a plain not-connected answer stays quiet');
});

test('more events than fit: the earliest kept, the count kept (9.5 fourth pass)', () => {
  const events = Array.from({ length: 105 }, (_, i) => ({ id: `e${i}`, title: `Late ${i}`, start: at(20), end: at(21) }));
  events.push({ id: 'early', title: 'Early bird', start: at(6), end: at(7) });
  const day = C.cleanCalendar({ connected: true, date: '2026-10-21', timeZone: 'x', updated: at(8), events });
  assert.equal(day.events.length, C.MAX_TODAY_EVENTS);
  assert.equal(day.total, 106);
  assert.ok(day.events.some((e) => e.id === 'early'), 'sorted first, so the earliest survives the cap');
  const range = C.cleanCalendarRange({ connected: true, from: '2026-10-26', to: '2026-11-26', events });
  assert.equal(range.events.length, 106, 'a range fits more');
  assert.equal(range.total, 106);
});
