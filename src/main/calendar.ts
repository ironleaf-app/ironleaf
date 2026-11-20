// Today's calendar from the former host app (21 Oct 2026, part of gap G5; what it shows is in src/shared/calendar.ts).
// Inside The former host app the host's calendarToday() asks the former host app's runtime for GET
// /native-desktop/google/calendar/today the way its other Ironleaf calls go (the former host app's main process, with the
// runtime's own origin and token); Ironleaf never holds a Google token or reaches Google itself. On its own there is no
// calendar (a development build can be given a made-up day in a file for the screen tests). Whatever goes wrong reads as
// "not connected", so Today simply shows none.
//
// 8.9 two-way sync (31 Oct 2026): the same way for the calendars list, events across days, and making, moving and
// removing events (the host's calendarList/calendarRange/calendarWrite, through the former host app's own calendar
// connections, never a second sign-in). A development build on its own stands in files for them (NV_TEST_CALENDAR_LIST,
// NV_TEST_CALENDAR_RANGE); writes there say plainly they need the former host app.

import { promises as fsp } from 'node:fs';
import { cleanCalendar, cleanCalendarList, cleanCalendarRange, cleanCalendarWrite, type CalendarList, type CalendarRange, type CalendarToday, type CalendarWrite } from '../shared/calendar';

export interface CalendarSource {
  /** Inside the former host app: the day's events (the host's calendarToday). */
  ask?: () => Promise<unknown>;
  /** A development build on its own: a JSON file standing in for the former host app's answer (NV_TEST_CALENDAR). */
  testFile?: string;
  /** How long the former host app gets to answer. */
  timeoutMs?: number;
  log?(message: string): void;
}

const UNAVAILABLE: CalendarToday = { connected: false, reason: 'unavailable' };
const LIST_DOWN: CalendarList = { connected: false, reason: 'unavailable' };
const RANGE_DOWN: CalendarRange = { connected: false, reason: 'unavailable' };

async function asked(ask: () => Promise<unknown>, timeoutMs: number): Promise<unknown | null> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([ask(), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A read of the former host app (or its stand-in file), checked, never an error: each failure said in the log with why,
 *  so a timeout, a refusal and an unreadable answer no longer read the same (Nov 2026 audit). */
async function readCalendar<T>(source: CalendarSource, what: string, clean: (raw: unknown) => T, down: T): Promise<T> {
  const log = source.log;
  const saidConnected = (raw: unknown) => !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).connected === true;
  const isDown = (v: T) => !!v && typeof v === 'object' && (v as Record<string, unknown>).connected === false && (v as Record<string, unknown>).reason === 'unavailable';
  try {
    if (source.ask) {
      const raw = await asked(source.ask, source.timeoutMs ?? 15_000);
      if (raw === null) {
        log?.(`${what} did not answer in time.`);
        return down;
      }
      const checked = clean(raw);
      if (isDown(checked) && saidConnected(raw)) log?.(`${what} answered what could not be checked.`);
      return checked;
    }
    if (source.testFile) {
      try {
        return clean(JSON.parse(await fsp.readFile(source.testFile, 'utf8')));
      } catch (err) {
        log?.(`The stand-in file for ${what.toLowerCase()} could not be read (${err instanceof Error ? err.message : String(err)}).`);
        return down;
      }
    }
  } catch (err) {
    // The former host app not answering, or not set up: no calendar, but the reason kept.
    log?.(`${what} could not be read (${err instanceof Error ? err.message : String(err)}).`);
  }
  return down;
}

/** Today's events as the window may show them (checked by cleanCalendar), never an error. */
export async function calendarToday(source: CalendarSource): Promise<CalendarToday> {
  return readCalendar(source, 'Today’s calendar', cleanCalendar, UNAVAILABLE);
}

/** The person's calendars (through the former host app), checked, never an error. */
export async function calendarList(source: CalendarSource): Promise<CalendarList> {
  return readCalendar(source, 'The calendars', cleanCalendarList, LIST_DOWN);
}

/** Events across days (from/to YYYY-MM-DD), checked, never an error. */
export async function calendarRange(source: CalendarSource): Promise<CalendarRange> {
  return readCalendar(source, 'The events across days', cleanCalendarRange, RANGE_DOWN);
}

/** A create, change or removal through the former host app, in plain words, never an error. */
export async function calendarWrite(ask: (() => Promise<unknown>) | undefined, timeoutMs = 15_000): Promise<CalendarWrite> {
  if (!ask) return { ok: false, words: 'No calendar is connected to Ironleaf.' };
  try {
    const raw = await asked(ask, timeoutMs);
    return raw === null ? { ok: false, words: 'Your calendar did not answer. Try again in a bit.' } : cleanCalendarWrite(raw);
  } catch {
    return { ok: false, words: 'Your calendar could not be changed just now. Try again in a bit.' };
  }
}
