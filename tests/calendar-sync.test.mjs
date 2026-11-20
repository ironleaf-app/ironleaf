// node --test tests/calendar-sync.test.mjs — the Vault's calendar kept in step both ways (8.9, src/shared/calendar-sync.ts,
// src/shared/calendar.ts list/range/write, src/shared/work-meetings.ts link props, src/shared/prefs.ts switch): off by
// default and nothing syncs until turned on; a meeting added goes up (an hour long, Teams and Meet links left to the
// calendar); a move on one side moves the other; both moved means the latest wins with plain words; a removal on one
// side removes on the other (the note to the Bin, never gone); never a duplicate (one event one note, twins joined,
// a second sync quiet). Made-up bakery meetings and a stub calendar only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-calsync-'));
let S, C, P, WM;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  for (const [name, file] of [['s', 'calendar-sync'], ['c', 'calendar'], ['p', 'prefs'], ['w', 'work-meetings']]) await build({ input: path.join(root, `src/shared/${file}.ts`), platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  C = await import(pathToFileURL(path.join(work, 'c.mjs')).href);
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
  WM = await import(pathToFileURL(path.join(work, 'w.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// Times on this PC, as the stub calendar gives them.
const at = (day, h, m = 0) => {
  const d = new Date(2026, 9, day, h, m);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `2026-10-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};
const ms = (day, h, m = 0) => new Date(2026, 9, day, h, m).getTime();
const CHOSEN = 'google:primary';
const RANGE = { from: '2026-10-01', to: '2026-10-31', nowMs: ms(30, 12) };

const local = (o) => ({ path: 'Meetings/x.md', title: 'Staff tasting', date: '2026-10-30', time: '15:00', where: '', updatedMs: ms(29, 9), calendarEvent: '', calendarId: '', syncedAt: 0, ...o });
const remote = (o) => ({ id: 'e1', calendar: 'Work', calendarId: CHOSEN, title: 'Staff tasting', start: at(30, 15), end: at(30, 16), allDay: false, location: '', meetingLink: '', link: '', updated: new Date(ms(29, 9)).toISOString(), ...o });

test('off by default: the switch starts off, and nothing syncs until it is on', () => {
  assert.equal(P.DEFAULT_PREFS.calendarSync, false);
  assert.equal(P.DEFAULT_PREFS.calendarChosen, '');
  assert.equal(P.mergePrefs(P.DEFAULT_PREFS, {}).calendarSync, false);
  assert.equal(P.mergePrefs(P.DEFAULT_PREFS, { calendarSync: true }).calendarSync, true);
  assert.equal(P.mergePrefs(P.DEFAULT_PREFS, { calendarSync: 'yes' }).calendarSync, false, 'only true turns it on');
  const plan = S.planSync({ on: false, chosenId: CHOSEN, locals: [local({ calendarId: CHOSEN })], remotes: [], ...RANGE });
  assert.deepEqual(plan, { actions: [], conflicts: [] });
});

test('a meeting added goes up: its title without the day, an hour long, where it is, never a meeting link', () => {
  const d = S.meetingDraft({ title: '2026-10-30 Staff tasting', date: '2026-10-30', time: '3:00 PM', where: 'Brunswick site' });
  assert.equal(d.title, 'Staff tasting');
  assert.equal(d.allDay, false);
  assert.equal(d.start, at(30, 15));
  assert.equal(Date.parse(d.end) - Date.parse(d.start), 60 * 60 * 1000);
  assert.equal(d.location, 'Brunswick site');
  assert.ok(!('meetingLink' in d), 'Teams and Meet links are the calendar\u2019s to make');
  const all = S.meetingDraft({ title: 'Milk tender due', date: '2026-10-06', time: '', where: '' });
  assert.deepEqual([all.allDay, all.start, all.end], [true, '2026-10-06', '2026-10-07']);
  const plan = S.planSync({ on: true, chosenId: CHOSEN, locals: [local({ path: 'Meetings/Staff tasting.md', calendarId: CHOSEN })], remotes: [], ...RANGE });
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].kind, 'create-remote');
  assert.equal(plan.actions[0].calendarId, CHOSEN);
  // A meeting never put on a calendar stays a note.
  const quiet = S.planSync({ on: true, chosenId: CHOSEN, locals: [local({})], remotes: [], ...RANGE });
  assert.deepEqual(quiet.actions, []);
});

test('a move on one side moves the other', () => {
  const synced = ms(29, 9);
  const e = remote({ updated: new Date(synced).toISOString() });
  // Moved in the notes (3 pm to 4:30 pm): the event moves.
  const up = S.planSync({ on: true, chosenId: CHOSEN, locals: [local({ calendarEvent: 'e1', calendarId: CHOSEN, syncedAt: synced, updatedMs: ms(30, 8), time: '16:30' })], remotes: [e], ...RANGE });
  assert.equal(up.actions.length, 1);
  assert.equal(up.actions[0].kind, 'update-remote');
  assert.equal(up.actions[0].event.start, at(30, 16, 30));
  assert.deepEqual(up.conflicts, []);
  // Moved on the calendar: the note moves.
  const down = S.planSync({ on: true, chosenId: CHOSEN, locals: [local({ calendarEvent: 'e1', calendarId: CHOSEN, syncedAt: synced, updatedMs: synced })], remotes: [remote({ start: at(30, 10), end: at(30, 11), updated: new Date(ms(30, 8)).toISOString() })], ...RANGE });
  assert.equal(down.actions.length, 1);
  assert.equal(down.actions[0].kind, 'update-local');
  assert.deepEqual([down.actions[0].date, down.actions[0].time], ['2026-10-30', '10:00']);
  // Agreed already: quiet, even twice.
  const calm = S.planSync({ on: true, chosenId: CHOSEN, locals: [local({ calendarEvent: 'e1', calendarId: CHOSEN, syncedAt: synced, updatedMs: synced })], remotes: [e], ...RANGE });
  assert.deepEqual([calm.actions, calm.conflicts], [[], []]);
});

test('both moved: the latest wins, and the clash is said plainly', () => {
  const synced = ms(29, 9);
  // The notes moved last: they win.
  const notesWin = S.planSync({ on: true, chosenId: CHOSEN, locals: [local({ title: '2026-10-30 Staff tasting', calendarEvent: 'e1', calendarId: CHOSEN, syncedAt: synced, updatedMs: ms(30, 9), time: '16:30' })], remotes: [remote({ start: at(30, 10), end: at(30, 11), updated: new Date(ms(30, 8)).toISOString() })], ...RANGE });
  assert.equal(notesWin.actions[0].kind, 'update-remote');
  assert.equal(notesWin.conflicts.length, 1);
  assert.equal(notesWin.conflicts[0].winner, 'local');
  assert.ok(notesWin.conflicts[0].words.includes('both places') && notesWin.conflicts[0].words.includes('latest from your notes'), notesWin.conflicts[0].words);
  assert.ok(!notesWin.conflicts[0].words.includes('—'), 'no em dashes in new UI words');
  // The calendar moved last: it wins.
  const calWin = S.planSync({ on: true, chosenId: CHOSEN, locals: [local({ calendarEvent: 'e1', calendarId: CHOSEN, syncedAt: synced, updatedMs: ms(30, 8), time: '16:30' })], remotes: [remote({ start: at(30, 10), end: at(30, 11), updated: new Date(ms(30, 9)).toISOString() })], ...RANGE });
  assert.equal(calWin.actions[0].kind, 'update-local');
  assert.equal(calWin.conflicts[0].winner, 'remote');
  assert.ok(calWin.conflicts[0].words.includes('latest from your calendar'), calWin.conflicts[0].words);
  assert.ok(S.syncWords(notesWin).includes('moved in both places'), S.syncWords(notesWin));
});

test('says two things with no move either side: the latest still wins, said plainly, never stuck quiet', () => {
  const synced = ms(29, 9);
  const e = remote({ start: at(30, 10), end: at(30, 11), updated: new Date(synced).toISOString() });
  const plan = S.planSync({ on: true, chosenId: CHOSEN, locals: [local({ calendarEvent: 'e1', calendarId: CHOSEN, syncedAt: synced, updatedMs: synced, time: '16:30' })], remotes: [e], ...RANGE });
  assert.equal(plan.conflicts.length, 1, 'a disagreement with no recorded move still says so');
  assert.equal(plan.actions.length, 1);
  assert.ok(plan.conflicts[0].words.includes('latest from your notes'), plan.conflicts[0].words);
});

test('a removal on one side removes on the other: the note to the Bin, never gone for good', () => {
  const synced = ms(29, 9);
  const linked = local({ path: 'Meetings/Staff tasting.md', calendarEvent: 'e1', calendarId: CHOSEN, syncedAt: synced, updatedMs: synced });
  // Gone from the calendar while its day is shown: its note to the Bin, with plain words.
  const gone = S.planSync({ on: true, chosenId: CHOSEN, locals: [linked], remotes: [], ...RANGE });
  assert.equal(gone.actions.length, 1);
  assert.equal(gone.actions[0].kind, 'to-bin');
  assert.ok(gone.actions[0].words.includes('Bin'), gone.actions[0].words);
  // Outside the days shown nothing can be said (it may only be out of sight).
  const far = S.planSync({ on: true, chosenId: CHOSEN, locals: [{ ...linked, date: '2026-11-20' }], remotes: [], ...RANGE });
  assert.deepEqual(far.actions, []);
  // Put in the Bin here: its event goes too.
  const binned = S.planSync({ on: true, chosenId: CHOSEN, locals: [{ ...linked, inBin: true }], remotes: [remote({})], ...RANGE });
  assert.equal(binned.actions.length, 1);
  assert.equal(binned.actions[0].kind, 'delete-remote');
});

test('never a duplicate: one event one note, twins joined, a second sync quiet', () => {
  const synced = ms(29, 9);
  // Two notes naming one event: the first keeps it.
  const two = S.planSync({ on: true, chosenId: CHOSEN, locals: [local({ path: 'Meetings/One.md', calendarEvent: 'e1', calendarId: CHOSEN, syncedAt: synced, updatedMs: ms(30, 8), time: '16:30' }), local({ path: 'Meetings/Two.md', calendarEvent: 'e1', calendarId: CHOSEN, syncedAt: synced, updatedMs: ms(30, 8), time: '16:30' })], remotes: [remote({})], ...RANGE });
  assert.equal(two.actions.filter((a) => a.kind === 'update-remote').length, 1);
  // The same event already there under another id: joined to it, never a second.
  const twin = S.planSync({ on: true, chosenId: CHOSEN, locals: [local({ path: 'Meetings/Staff tasting.md', calendarId: CHOSEN })], remotes: [remote({ id: 'other-id' })], ...RANGE });
  assert.deepEqual(twin.actions.map((a) => a.kind), ['link']);
  assert.equal(twin.actions[0].eventId, 'other-id');
  // Events with no meeting are only shown, never made into notes here.
  const only = S.planSync({ on: true, chosenId: CHOSEN, locals: [], remotes: [remote({})], ...RANGE });
  assert.deepEqual(only.actions, []);
  assert.equal(S.syncWords({ actions: [], conflicts: [] }), 'All agrees. Nothing to move.');
});

test('times read the one way: meeting times, event days, and the same when and where', () => {
  assert.equal(S.meetingHM('3:00 PM'), '15:00');
  assert.equal(S.meetingHM('15:00'), '15:00');
  assert.equal(S.meetingHM(''), '');
  assert.equal(S.meetingHM('half past'), '');
  assert.deepEqual(S.eventDayTime({ start: at(30, 15), allDay: false }), { date: '2026-10-30', time: '15:00' });
  assert.deepEqual(S.eventDayTime({ start: '2026-10-06', allDay: true }), { date: '2026-10-06', time: '' });
  assert.ok(S.sameWhenWhere({ date: '2026-10-30', time: '15:00', where: '' }, remote({})));
  assert.ok(!S.sameWhenWhere({ date: '2026-10-30', time: '16:30', where: '' }, remote({})));
  assert.ok(!S.sameWhenWhere({ date: '2026-10-30', time: '15:00', where: 'Brunswick' }, remote({})));
});

test('the bridge answers checked: calendars, days across, and writes in plain words', () => {
  const list = C.cleanCalendarList({ connected: true, calendars: [{ id: 'google:primary', name: 'Work', provider: 'google', primary: true }, { id: 'outlook:x', name: 'Family', provider: 'outlook' }, { name: 'no id' }, null] });
  assert.deepEqual(list, { connected: true, calendars: [{ id: 'google:primary', name: 'Work', provider: 'google', primary: true }, { id: 'outlook:x', name: 'Family', provider: 'outlook' }] });
  assert.deepEqual(C.cleanCalendarList({ connected: false, reason: 'needs-sign-in' }), { connected: false, reason: 'needs-sign-in' });
  assert.deepEqual(C.cleanCalendarList(null), { connected: false, reason: 'unavailable' });
  const range = C.cleanCalendarRange({ connected: true, from: '2026-10-26', to: '2026-10-30', events: [{ id: 'e1', title: 'Staff tasting', start: at(30, 15), end: at(30, 16), calendarId: CHOSEN, updated: new Date(ms(29, 9)).toISOString() }, { id: 'bad', title: 'Broken', start: 'soon' }] });
  assert.equal(range.connected, true);
  assert.equal(range.events.length, 1);
  assert.equal(range.events[0].calendarId, CHOSEN);
  assert.deepEqual(C.cleanCalendarRange({ connected: true, from: 'soon', to: '2026-10-30', events: [] }), { connected: false, reason: 'unavailable' });
  assert.deepEqual(C.cleanCalendarWrite({ ok: true, id: 'new-id' }), { ok: true, id: 'new-id' });
  assert.deepEqual(C.cleanCalendarWrite({ ok: true }), { ok: true });
  assert.equal(C.cleanCalendarWrite(null).ok, false);
  assert.ok(C.cleanCalendarWrite(null).words.length > 0);
});

test('an event becomes a meeting note with its calendar along; the link lives in the note', () => {
  const e = { id: 'e9', calendar: 'Work', calendarId: 'outlook:x', title: 'Supplier call', start: at(29, 14), end: at(29, 14, 30), allDay: false, location: 'Teams', meetingLink: '', link: '' };
  const note = C.meetingNoteFor(e, '2026-10-29');
  assert.equal(note.values['calendar-event'], 'e9');
  assert.equal(note.values['calendar-id'], 'outlook:x');
  assert.equal(note.values.date, '2026-10-29');
  // The meeting read back with its link (the note's own props).
  const m = WM.readMeeting({ path: 'Meetings/Supplier call.md', title: 'Supplier call', props: { type: 'meeting', date: '2026-10-29', 'calendar-event': 'e9', 'calendar-id': 'outlook:x', 'calendar-synced': new Date(ms(29, 15)).toISOString() }, content: '## Agenda\n\n- [ ] Talk flour\n', mtime: ms(29, 15) });
  assert.equal(m.calendarEvent, 'e9');
  assert.equal(m.calendarId, 'outlook:x');
  assert.equal(m.syncedAt, ms(29, 15));
  assert.equal(m.mtime, ms(29, 15));
  const plain = WM.readMeeting({ path: 'Meetings/Plain.md', title: 'Plain', props: { type: 'meeting', date: '2026-10-29' }, content: '' });
  assert.deepEqual([plain.calendarEvent, plain.calendarId, plain.syncedAt], ['', '', 0]);
});
