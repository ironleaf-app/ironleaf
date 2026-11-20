// Today's calendar on Ironleaf's Today (21 Oct 2026, part of gap G5). The former host app reads the person's Google
// Calendar (Settings › Connections › Google there) and answers Ironleaf through its host with the day's events; Ironleaf
// only shows them, and never writes an event into a note by itself — "Make a meeting note" is the person's own click.
//
// The former host app's answer (GET /native-desktop/google/calendar/today, through the host's calendarToday()):
//   { connected: false, reason: 'not-set-up' | 'not-offered' | 'signed-out' | 'needs-sign-in' | 'calendar-off' }
//   { connected: true, date, timeZone, updated, events: [{ id, calendar, title, start, end, allDay, location, meetingLink,
//     link, tentative?, free? }], error? }
// Everything is checked here before the window sees it; anything else reads as not connected, so Today shows nothing.
import { cleanFileName } from './paths';

export type CalendarReason = 'not-set-up' | 'not-offered' | 'signed-out' | 'needs-sign-in' | 'calendar-off' | 'unavailable';

export interface CalendarEvent {
  id: string;
  calendar: string;
  title: string;
  /** A time with its offset (2026-10-21T09:00:00+11:00), or a day (2026-10-21) for an all-day event. */
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  meetingLink: string;
  link: string;
  tentative?: boolean;
  free?: boolean;
  /** Which calendar it is on (8.9 two-way sync): the id the former host app lists, so a meeting goes back to the right one. */
  calendarId?: string;
  /** When the event last changed (8.9): a time with its offset, for last change wins. Missing means unknown. */
  updated?: string;
}

export type CalendarToday = { connected: false; reason: CalendarReason } | { connected: true; date: string; timeZone: string; updated: string; events: CalendarEvent[]; total: number; error?: string };

/** A calendar the person keeps in the former host app (8.9): a calendar in the former host app, through its own
connections. */
export interface ExternalCalendar {
  id: string;
  name: string;
  provider: 'google' | 'outlook' | 'other';
  primary?: boolean;
}

export type CalendarList = { connected: false; reason: CalendarReason } | { connected: true; calendars: ExternalCalendar[] };

/** Events across days (8.9 week and month): the days asked for, and what is on them. */
export type CalendarRange = { connected: false; reason: CalendarReason } | { connected: true; from: string; to: string; events: CalendarEvent[]; total: number; error?: string };

/** What a create, change or removal says: done (a new id for a create), or plain words when not. */
export type CalendarWrite = { ok: true; id?: string } | { ok: false; words: string };

const REASONS: CalendarReason[] = ['not-set-up', 'not-offered', 'signed-out', 'needs-sign-in', 'calendar-off'];
/** How many events and calendars an answer may bring (Nov 2026 audit: the caps were bare numbers, the dropped silent). */
export const MAX_TODAY_EVENTS = 100;
export const MAX_RANGE_EVENTS = 500;
export const MAX_CALENDARS = 50;
const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
/** Only web links (https, or http) are kept, so nothing else ever opens from an event. */
const webLink = (v: unknown) => {
  const s = text(v, 2000);
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
};
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isMoment = (s: string) => isDay(s) || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !Number.isNaN(Date.parse(s)));

/** The former host app's answer checked and tidied (at most `limit` events, each field its kind); anything else
 *  "unavailable". The events sort first, so beyond the cap the earliest survive; `total` keeps how many the answer
 *  held. */
export function cleanCalendar(raw: unknown, limit = MAX_TODAY_EVENTS): CalendarToday {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r) return { connected: false, reason: 'unavailable' };
  if (r.connected !== true) {
    const reason = REASONS.find((x) => x === r.reason) ?? 'unavailable';
    return { connected: false, reason };
  }
  const date = text(r.date, 10);
  if (!isDay(date)) return { connected: false, reason: 'unavailable' };
  const events: CalendarEvent[] = [];
  for (const e of Array.isArray(r.events) ? r.events : []) {
    if (!e || typeof e !== 'object') continue;
    const x = e as Record<string, unknown>;
    const start = text(x.start, 40);
    const end = text(x.end, 40);
    if (!isMoment(start)) continue;
    const updated = text(x.updated, 40);
    events.push({
      id: text(x.id, 200) || `${start}-${text(x.title, 40)}`,
      calendar: text(x.calendar, 120),
      title: text(x.title, 300) || '(No title)',
      start,
      end: isMoment(end) ? end : start,
      allDay: x.allDay === true || (isDay(start) && x.allDay !== false),
      location: text(x.location, 300),
      meetingLink: webLink(x.meetingLink),
      link: webLink(x.link),
      ...(x.tentative === true ? { tentative: true } : {}),
      ...(x.free === true ? { free: true } : {}),
      ...(text(x.calendarId, 200) ? { calendarId: text(x.calendarId, 200) } : {}),
      ...(isMoment(updated) ? { updated } : {}),
    });
  }
  return { connected: true, date, timeZone: text(r.timeZone, 80), updated: text(r.updated, 40), events: sortEvents(events).slice(0, limit), total: events.length, ...(text(r.error) ? { error: text(r.error) } : {}) };
}

/** When an event starts, in ms (an all-day event at the start of its day on this PC). */
export function startMs(e: Pick<CalendarEvent, 'start' | 'allDay'>): number {
  if (isDay(e.start)) {
    const [y, m, d] = e.start.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return Date.parse(e.start);
}

/** All-day events first, then by start, then by title. */
export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => Number(b.allDay) - Number(a.allDay) || startMs(a) - startMs(b) || a.title.localeCompare(b.title));
}

/** What Today shows for an answer: the events (even none, said calmly), the connect door for a calendar switched
 *  off, never set up, or unreachable because the former host app is missing or silent (16 Nov 2026 audit finding
 *  3: Today said nothing with no button), else nothing at all (no nagging to set anything up). */
export function calendarBlock(state: CalendarToday | null): 'events' | 'connect' | 'hidden' {
  if (!state) return 'hidden';
  if (state.connected) return 'events';
  return state.reason === 'calendar-off' || state.reason === 'unavailable' || state.reason === 'not-set-up' ? 'connect' : 'hidden';
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?/i, ' $1m');

/** An event's time as Today shows it: "All day", "9:00 am – 9:30 am", "Until 10:30 am" (began before today), "From 4:00 pm"
 *  (goes on past today). `day` is the day shown (YYYY-MM-DD). */
export function eventTime(e: CalendarEvent, day: string): string {
  if (e.allDay) return 'All day';
  const [y, m, d] = day.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d).getTime();
  const dayEnd = new Date(y, m - 1, d + 1).getTime();
  const s = Date.parse(e.start);
  const f = Date.parse(e.end);
  if (s < dayStart && f > dayEnd) return 'All day';
  if (s < dayStart) return `Until ${clock(f)}`;
  if (f > dayEnd) return `From ${clock(s)}`;
  return f > s ? `${clock(s)} – ${clock(f)}` : clock(s);
}

/** Whether an event is on now, or over (for a quiet look on Today). */
export function eventNow(e: CalendarEvent, now: number): 'past' | 'now' | 'later' {
  if (e.allDay) return 'now';
  const s = Date.parse(e.start);
  const f = Date.parse(e.end);
  return f <= now ? 'past' : s <= now ? 'now' : 'later';
}

/** The meeting note an event becomes (the Meeting type's own fields): its title (the event and the day), its date and
 *  time, where it is, and the event it came from, so Today links the two. People are left for the person to add. The
 *  calendar it came from rides along when known (8.9), so the note stays in step with the right calendar. */
export function meetingNoteFor(e: CalendarEvent, day: string, calendarId?: string): { title: string; values: Record<string, string> } {
  const [y, m, d] = day.split('-').map(Number);
  const words = `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
  const title = `${cleanFileName(e.title, 'Meeting', 80)} ${words}`;
  const values: Record<string, string> = { date: day, 'calendar-event': e.id };
  const cal = (calendarId ?? e.calendarId ?? '').trim().slice(0, 200);
  if (cal) values['calendar-id'] = cal;
  if (!e.allDay && !isDay(e.start)) {
    const t = new Date(Date.parse(e.start));
    values.time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  }
  if (e.location) values.location = e.location;
  if (e.meetingLink) values['meeting-link'] = e.meetingLink;
  return { title, values };
}

/** The former host app's calendars checked (at most 50): anything else is "unavailable". */
export function cleanCalendarList(raw: unknown): CalendarList {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r) return { connected: false, reason: 'unavailable' };
  if (r.connected !== true) {
    const reason = REASONS.find((x) => x === r.reason) ?? 'unavailable';
    return { connected: false, reason };
  }
  const out: ExternalCalendar[] = [];
  for (const c of Array.isArray(r.calendars) ? r.calendars.slice(0, MAX_CALENDARS) : []) {
    if (!c || typeof c !== 'object') continue;
    const x = c as Record<string, unknown>;
    const id = text(x.id, 200);
    if (!id) continue;
    const provider = x.provider === 'google' || x.provider === 'outlook' ? x.provider : 'other';
    out.push({ id, name: text(x.name, 120) || id, provider, ...(x.primary === true ? { primary: true as const } : {}) });
  }
  return { connected: true, calendars: out };
}

/** The former host app's events across days checked (the days asked for, at most MAX_RANGE_EVENTS); anything else
"unavailable". */
export function cleanCalendarRange(raw: unknown): CalendarRange {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r) return { connected: false, reason: 'unavailable' };
  if (r.connected !== true) {
    const reason = REASONS.find((x) => x === r.reason) ?? 'unavailable';
    return { connected: false, reason };
  }
  const from = text(r.from, 10);
  const to = text(r.to, 10);
  if (!isDay(from) || !isDay(to) || to < from) return { connected: false, reason: 'unavailable' };
  const checked = cleanCalendar({ connected: true, date: from, events: Array.isArray(r.events) ? r.events : [] }, MAX_RANGE_EVENTS);
  if (!checked.connected) return { connected: false, reason: 'unavailable' };
  return { connected: true, from, to, events: checked.events, total: checked.total, ...(text(r.error) ? { error: text(r.error) } : {}) };
}

/** What a create, change or removal says, in plain words (never a thrown error to the window). */
export function cleanCalendarWrite(raw: unknown): CalendarWrite {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r) return { ok: false, words: 'Your calendar did not answer. Try again in a bit.' };
  if (r.ok === true) {
    const id = text(r.id, 200);
    return id ? { ok: true, id } : { ok: true };
  }
  const words = text(r.words ?? r.error, 300);
  return { ok: false, words: words || 'Your calendar could not be changed just now. Try again in a bit.' };
}
