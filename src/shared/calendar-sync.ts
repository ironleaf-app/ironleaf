// The Vault's calendar kept in step both ways with the person's calendars (8.9, 31 Oct 2026: the Vault to match what
// the best notes apps can do). Inside the former host app the Vault uses the former host app's own calendar
// connections (Settings › Connections there); it never signs in a second time. On its own it says plainly it needs
// the former host app. Nothing syncs until the person turns it on in Settings › Calendar (off by default).
//
// A meeting the person adds to a calendar keeps three props in its note: calendar-event (the event's id),
// calendar-id (which calendar) and calendar-synced (when the two last agreed, ms). An event never becomes a note by
// itself; the person makes it one with a click. Moving either side moves the other on the next sync; when both moved
// the latest wins and the clash is said plainly. A meeting removed from the calendar goes to the Bin, never gone for
// good; a note put in the Bin takes its event off the calendar. Teams and Meet links are left to the calendar: the
// Vault never makes one, it only shows what the calendar gives. Pure: the main side reads and writes (calendar.ts).

import type { CalendarEvent } from './calendar';
import { readClockTime } from './clock';

export interface SyncLocal {
  path: string;
  title: string;
  /** Its day (YYYY-MM-DD). */
  date: string;
  /** Its time as written (10:00 AM, 14:30, '' for any time). */
  time: string;
  where: string;
  /** When the note last changed (ms). */
  updatedMs: number;
  /** In the Bin (put there by the person, or by an earlier sync). */
  inBin?: boolean;
  /** The linked event and calendar ('' when not added yet). */
  calendarEvent: string;
  calendarId: string;
  /** When the two last agreed (ms, 0 when never). */
  syncedAt: number;
}

export interface EventDraft {
  title: string;
  /** A time with the PC's offset (2026-10-30T15:00:00+11:00), or a day for an all-day event. */
  start: string;
  end: string;
  allDay: boolean;
  location: string;
}

export type SyncAction =
  | { kind: 'create-remote'; localPath: string; calendarId: string; event: EventDraft }
  | { kind: 'update-remote'; localPath: string; eventId: string; calendarId: string; event: EventDraft }
  | { kind: 'update-local'; localPath: string; eventId: string; date: string; time: string; where: string }
  | { kind: 'to-bin'; localPath: string; eventId: string; words: string }
  | { kind: 'delete-remote'; localPath: string; eventId: string; calendarId: string }
  | { kind: 'link'; localPath: string; eventId: string; calendarId: string };

export interface SyncConflict {
  localPath: string;
  eventId: string;
  /** Plain words for the person (no em dash): what clashed and which side won. */
  words: string;
  winner: 'local' | 'remote';
}

export interface SyncPlan {
  actions: SyncAction[];
  conflicts: SyncConflict[];
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const bareTitle = (t: string) => t.replace(/^\d{4}-\d{2}-\d{2}\s*/, '').trim() || t.trim() || 'Meeting';
const sameTitle = (a: string, b: string) => bareTitle(a).toLowerCase().replace(/\s+/g, ' ') === bareTitle(b).toLowerCase().replace(/\s+/g, ' ');
const pad = (n: number) => String(n).padStart(2, '0');

/** A meeting's time as HH:MM (24 hour), or '' when it has none or it cannot be read. */
export function meetingHM(time: string): string {
  const t = readClockTime((time ?? '').trim());
  return t ? `${pad(t.hours)}:${pad(t.minutes)}` : '';
}

/** An event's start as the PC's day and HH:MM (an all-day event: its day, no time). */
export function eventDayTime(e: Pick<CalendarEvent, 'start' | 'allDay'>): { date: string; time: string } {
  if (ISO_DAY.test(e.start)) return { date: e.start, time: '' };
  const ms = Date.parse(e.start);
  if (Number.isNaN(ms)) return { date: '', time: '' };
  const d = new Date(ms);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: e.allDay ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** When an event last changed (ms, 0 when unknown). */
export function eventMs(e: Pick<CalendarEvent, 'updated'>): number {
  if (!e.updated) return 0;
  const ms = Date.parse(e.updated);
  return Number.isNaN(ms) ? 0 : ms;
}

/** A local moment with the PC's offset (2026-10-30T15:00:00+11:00), as the calendar reads it. */
function withOffset(day: string, hm: string): string {
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), Number(hm.slice(0, 2)), Number(hm.slice(3, 5)));
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${day}T${hm}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function addDaysIso(day: string, n: number): string {
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A meeting as a new or changed event: its title without the day, its start (an hour long; all day when it has no
 *  time) and where it is. Never a meeting link: Teams and Meet links are the calendar's to make. */
export function meetingDraft(m: Pick<SyncLocal, 'title' | 'date' | 'time' | 'where'>): EventDraft {
  const title = bareTitle(m.title).slice(0, 300);
  const hm = meetingHM(m.time);
  const day = ISO_DAY.test(m.date) ? m.date : '';
  if (!day) return { title, start: '', end: '', allDay: true, location: m.where.trim().slice(0, 300) };
  if (!hm) return { title, start: day, end: addDaysIso(day, 1), allDay: true, location: m.where.trim().slice(0, 300) };
  const start = withOffset(day, hm);
  const endMs = Date.parse(start) + 60 * 60 * 1000;
  const e = new Date(endMs);
  const off = -e.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  const end = `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}T${pad(e.getHours())}:${pad(e.getMinutes())}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  return { title, start, end, allDay: false, location: m.where.trim().slice(0, 300) };
}

/** Whether a meeting and an event say the same when and where (its day, its time, its place). */
export function sameWhenWhere(m: Pick<SyncLocal, 'date' | 'time' | 'where'>, e: CalendarEvent): boolean {
  const at = eventDayTime(e);
  return m.date === at.date && meetingHM(m.time) === at.time && m.where.trim() === e.location.trim();
}

/** The day words a conflict uses (30 Oct, with the year when it is not this one). */
function dayWords(day: string, nowMs: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const year = new Date(nowMs).getFullYear();
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}${Number(m[1]) !== year ? ` ${m[1]}` : ''}`;
}

export interface PlanInput {
  /** Settings › Calendar's switch. Off means no actions at all. */
  on: boolean;
  /** The calendar meetings go to ('' when none chosen yet). */
  chosenId: string;
  locals: SyncLocal[];
  remotes: CalendarEvent[];
  /** The days the remotes cover (YYYY-MM-DD): a linked event missing inside them was removed. */
  from: string;
  to: string;
  nowMs: number;
}

/** What a sync does, each meeting once, never a duplicate: new meetings the person added go up; a move on one side
 *  moves the other; both moved means the latest wins with plain words; a removal on one side removes on the other
 *  (the note to the Bin, never gone). Events with no meeting are only shown, never made into notes here. */
export function planSync(input: PlanInput): SyncPlan {
  const actions: SyncAction[] = [];
  const conflicts: SyncConflict[] = [];
  if (!input.on) return { actions, conflicts };
  const chosen = input.chosenId.trim();
  const byId = new Map<string, CalendarEvent>();
  for (const e of input.remotes) if (e.id && !byId.has(e.id)) byId.set(e.id, e);
  const used = new Set<string>();
  const inRange = (day: string) => ISO_DAY.test(day) && day >= input.from && day <= input.to;

  for (const m of input.locals) {
    if (!m.path) continue;
    const linked = m.calendarEvent.trim();
    // Already added: the pair kept in step.
    if (linked) {
      if (used.has(linked)) continue; // two notes naming one event: the first keeps it, never twice.
      const e = byId.get(linked);
      if (!e) {
        // Gone from the calendar while its day is on show: its note to the Bin. Outside the days shown nothing can
        // be said (it may only be out of sight).
        if (!m.inBin && inRange(m.date)) {
          used.add(linked);
          actions.push({ kind: 'to-bin', localPath: m.path, eventId: linked, words: `${bareTitle(m.title)} was removed from your calendar, so its note is in the Bin. You can bring it back from there.` });
        }
        continue;
      }
      used.add(linked);
      const calId = (e.calendarId ?? m.calendarId).trim() || chosen;
      // In the Bin here: its event goes too.
      if (m.inBin) {
        actions.push({ kind: 'delete-remote', localPath: m.path, eventId: linked, calendarId: calId });
        continue;
      }
      const localChanged = m.updatedMs > m.syncedAt;
      const remoteChanged = eventMs(e) > m.syncedAt;
      if (sameWhenWhere(m, e)) continue; // agreed already.
      // Neither side moved yet they disagree (a change neither side recorded): the latest still wins, said plainly —
      // never stuck quiet. The words say which: moved in both places, or saying two things.
      if ((localChanged && remoteChanged) || (!localChanged && !remoteChanged)) {
        const at = eventDayTime(e);
        const how = localChanged ? 'was moved in both places' : 'says one thing in your notes and another on your calendar';
        const words = m.updatedMs >= eventMs(e)
          ? `${bareTitle(m.title)} ${how}. Kept the latest from your notes (${dayWords(m.date, input.nowMs)}${meetingHM(m.time) ? `, ${meetingHM(m.time)}` : ''}).`
          : `${bareTitle(m.title)} ${how}. Kept the latest from your calendar (${dayWords(at.date, input.nowMs)}${at.time ? `, ${at.time}` : ''}).`;
        if (m.updatedMs >= eventMs(e)) {
          conflicts.push({ localPath: m.path, eventId: linked, words, winner: 'local' });
          actions.push({ kind: 'update-remote', localPath: m.path, eventId: linked, calendarId: calId, event: meetingDraft(m) });
        } else {
          conflicts.push({ localPath: m.path, eventId: linked, words, winner: 'remote' });
          actions.push({ kind: 'update-local', localPath: m.path, eventId: linked, date: at.date, time: at.time, where: e.location });
        }
      } else if (localChanged) {
        actions.push({ kind: 'update-remote', localPath: m.path, eventId: linked, calendarId: calId, event: meetingDraft(m) });
      } else if (remoteChanged) {
        const at = eventDayTime(e);
        actions.push({ kind: 'update-local', localPath: m.path, eventId: linked, date: at.date, time: at.time, where: e.location });
      }
      continue;
    }
    // Not added: only a meeting the person put on a calendar goes up (its calendar-id prop). The rest stay notes.
    const target = m.calendarId.trim();
    if (m.inBin || !target) continue;
    // The same event already there under another id (added elsewhere, the link lost): joined to it, never a second.
    const at = { date: m.date, time: meetingHM(m.time) };
    const twin = input.remotes.find((e) => !used.has(e.id) && sameTitle(e.title, m.title) && (() => { const d = eventDayTime(e); return d.date === at.date && d.time === at.time; })());
    if (twin) {
      used.add(twin.id);
      actions.push({ kind: 'link', localPath: m.path, eventId: twin.id, calendarId: (twin.calendarId ?? target).trim() || target });
      continue;
    }
    used.add(`new:${m.path}`);
    actions.push({ kind: 'create-remote', localPath: m.path, calendarId: target, event: meetingDraft(m) });
  }
  return { actions, conflicts };
}

/** The words a sync ends with: what moved which way, in plain Australian English, or that all agrees. */
export function syncWords(plan: SyncPlan): string {
  const n = (k: SyncAction['kind']) => plan.actions.filter((a) => a.kind === k).length;
  const parts: string[] = [];
  if (n('create-remote')) parts.push(`${n('create-remote')} added to your calendar`);
  if (n('update-remote')) parts.push(`${n('update-remote')} moved on your calendar`);
  if (n('update-local')) parts.push(`${n('update-local')} moved in your notes`);
  if (n('to-bin')) parts.push(`${n('to-bin')} moved to the Bin`);
  if (n('delete-remote')) parts.push(`${n('delete-remote')} taken off your calendar`);
  if (n('link')) parts.push(`${n('link')} joined to its event`);
  if (!parts.length && !plan.conflicts.length) return 'All agrees. Nothing to move.';
  const head = parts.length ? `${parts.join(', ')}.` : '';
  const clash = plan.conflicts.length ? ` ${plan.conflicts.length} moved in both places; kept the latest each time.` : '';
  return `${head}${clash}`.trim();
}
