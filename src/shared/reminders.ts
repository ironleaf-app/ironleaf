// Reminders (19 Oct 2026, approved them for 5.0.0: "remember to order flour on Friday"). A reminder is a task line in a
// note, kept as plain Markdown the person owns, with an alarm clock and the moment it is for:
//
//   - [ ] Order 20 bags of flour from Laucke ⏰ 2026-10-23 09:00
//   - [ ] Put the bins out ⏰ 2026-10-26 18:30 every Monday
//
// Why this way: the ⏰ and an ISO date read plainly in any Markdown app, sort and search as text, and mean the same on
// every PC whatever its date format, so the note stays the person's own even without Ironleaf. The time is 24-hour
// (09:00, 18:30) so it is never ambiguous; a date on its own ("⏰ 2026-10-23") is 9:00 am, the time Ironleaf uses
// whenever no time was given, and says so. A repeat ("every Monday", "every 2 weeks", "every weekday") follows the time:
// when the reminder fires, or is ticked, its date moves on to the next one, so the line always shows when it comes next.
// Ticking the box ("- [x]") stops a one-off reminder. The ⏰ goes after the task's words (anything after the moment, a
// tag or a link, is kept as it is).
//
// Pure: the main side indexes and fires them (src/main/reminders.ts), the editor draws the ⏰ as a pill, Today lists
// them and the assistant writes them, all through these helpers. Times are the PC's own (the person's timezone).

import { isBoxDone } from './finished';
import { TASK_LINE, trackFence, type Fence } from './markdown';
import { STOP_WORDS } from './stop-words';

export const MARK = '⏰';
/** 9:00 am: the time a reminder given only a day is for (the person is told so, never left to guess). */
export const DEFAULT_HOUR = 9;

const DAY = 86_400_000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

// ── Repeats ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RepeatUnit = 'day' | 'weekday' | 'week' | 'month' | 'year';

/** How a reminder repeats: every `every` units; a weekly one on these days (0 Sunday … 6 Saturday) when given. */
export interface Repeat {
  unit: RepeatUnit;
  every: number;
  days?: number[];
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const WEEKDAY_WORD = '(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday|sday)?s?';
const weekdayOf = (word: string): number => {
  const w = word.toLowerCase().replace(/s$/, '');
  const i = WEEKDAYS.findIndex((d) => d === w || d.slice(0, 3) === w.slice(0, 3));
  return w.length >= 3 ? i : -1;
};
const numberOf = (word: string): number => (/^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word.toLowerCase()] ?? NaN);

/** A repeat as people write it: "every Monday", "every Monday and Thursday", "every other Friday", "every 2 weeks",
 *  "every weekday", "every day", "every fortnight", "every month", "daily", "weekly" (null: not one). */
export function parseRepeat(text: string): Repeat | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,]$/, '');
  const single: Record<string, Repeat> = {
    daily: { unit: 'day', every: 1 },
    weekly: { unit: 'week', every: 1 },
    fortnightly: { unit: 'week', every: 2 },
    monthly: { unit: 'month', every: 1 },
    yearly: { unit: 'year', every: 1 },
    annually: { unit: 'year', every: 1 },
  };
  if (single[t]) return { ...single[t] };
  const m = /^every (.+)$/.exec(t);
  if (!m) return null;
  const rest = m[1];
  if (rest === 'day') return { unit: 'day', every: 1 };
  if (rest === 'weekday' || rest === 'week day' || rest === 'working day' || rest === 'workday') return { unit: 'weekday', every: 1 };
  if (rest === 'week') return { unit: 'week', every: 1 };
  if (rest === 'fortnight') return { unit: 'week', every: 2 };
  if (rest === 'month') return { unit: 'month', every: 1 };
  if (rest === 'year') return { unit: 'year', every: 1 };
  const n = /^(\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (days|weeks|months|years)(?: on (.+))?$/.exec(rest);
  if (n) {
    const every = numberOf(n[1]);
    const unit = n[2].replace(/s$/, '') as RepeatUnit;
    if (!(every >= 1)) return null;
    if (n[3]) {
      if (unit !== 'week') return null;
      const days = dayList(n[3]);
      return days ? { unit, every, days } : null;
    }
    return { unit, every };
  }
  const other = /^other (.+)$/.exec(rest);
  if (other) {
    if (other[1] === 'day') return { unit: 'day', every: 2 };
    if (other[1] === 'week') return { unit: 'week', every: 2 };
    if (other[1] === 'month') return { unit: 'month', every: 2 };
    const days = dayList(other[1]);
    return days ? { unit: 'week', every: 2, days } : null;
  }
  const days = dayList(rest);
  return days ? { unit: 'week', every: 1, days } : null;
}

/** "Monday", "Mon and Thu", "Monday, Wednesday and Friday" → [1, 3, 5] (null: not a list of days). */
function dayList(text: string): number[] | null {
  const parts = text.split(/\s*(?:,\s*and|,|and|&)\s*/).filter(Boolean);
  if (!parts.length) return null;
  const days = parts.map(weekdayOf);
  if (days.some((d) => d < 0)) return null;
  return [...new Set(days)].sort((a, b) => a - b);
}

/** A repeat written back the one way Ironleaf writes it (parseRepeat reads it again). */
export function repeatText(r: Repeat): string {
  const names = (r.days ?? []).map((d) => DAY_NAMES[d]);
  const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  if (r.unit === 'weekday') return 'every weekday';
  if (r.unit === 'week' && names.length) return r.every === 1 ? `every ${list}` : r.every === 2 ? `every other ${list}` : `every ${r.every} weeks on ${list}`;
  if (r.every === 1) return `every ${r.unit}`;
  if (r.unit === 'week' && r.every === 2) return 'every fortnight';
  return `every ${r.every} ${r.unit}s`;
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
/** Months on from a date, the day kept (31 January a month on is the last day of February). */
function addMonths(d: Date, n: number, day = d.getDate()): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes());
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(day, last), d.getHours(), d.getMinutes());
}
/** The Monday that starts a date's week (for "every other Friday": which weeks count). */
const weekStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const weeksBetween = (a: Date, b: Date) => Math.round((weekStart(b).getTime() - weekStart(a).getTime()) / (7 * DAY));

/** Whether a day is one a repeat falls on, counted from the day it started. */
function fallsOn(r: Repeat, start: Date, d: Date): boolean {
  if (r.unit === 'weekday') return d.getDay() >= 1 && d.getDay() <= 5;
  if (r.unit === 'week' && r.days?.length) return r.days.includes(d.getDay()) && weeksBetween(start, d) % r.every === 0;
  return false;
}

/** The next time a repeat comes round strictly after `after`, at the time of day it started (`start`). */
export function nextOccurrence(r: Repeat, start: Date, after: number): Date {
  const every = Math.max(1, Math.floor(r.every) || 1);
  if (r.unit === 'weekday' || (r.unit === 'week' && r.days?.length)) {
    // Day by day from the later of the start and `after` (at most a year and a bit of days to look through).
    let d = start.getTime() > after ? start : new Date(new Date(after).getFullYear(), new Date(after).getMonth(), new Date(after).getDate(), start.getHours(), start.getMinutes());
    for (let i = 0; i < 400 * every; i++) {
      if (d.getTime() > after && fallsOn(r, start, d)) return d;
      d = addDays(d, 1);
    }
    return addDays(start, 7 * every);
  }
  if (r.unit === 'day' || r.unit === 'week') {
    const step = (r.unit === 'day' ? 1 : 7) * every;
    if (start.getTime() > after) return start;
    // Counted in days from the start (never by adding milliseconds, so a change to daylight saving keeps the time).
    const gone = Math.floor((after - start.getTime()) / (step * DAY));
    let k = Math.max(1, gone);
    let d = addDays(start, k * step);
    while (d.getTime() <= after) d = addDays(start, ++k * step);
    while (k > 1 && addDays(start, (k - 1) * step).getTime() > after) d = addDays(start, --k * step);
    return d;
  }
  const months = (r.unit === 'year' ? 12 : 1) * every;
  if (start.getTime() > after) return start;
  let k = 1;
  let d = addMonths(start, months, start.getDate());
  while (d.getTime() <= after && k < 10_000) d = addMonths(start, ++k * months, start.getDate());
  return d;
}

// ── A reminder in a note ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ReminderLine {
  /** The box is ticked. */
  done: boolean;
  /** The task's own words, without the box and the ⏰ part. */
  text: string;
  /** When it is for (the PC's time). */
  due: number;
  /** A time was written (else 9:00 am). */
  timeGiven: boolean;
  repeat: Repeat | null;
  /** Where "⏰ …" starts and ends in the line. */
  from: number;
  to: number;
}

// The date, then perhaps a time: "09:00", "18:30", or as people type it, "9am", "9:30 pm" (written back as 24-hour).
const MOMENT = /⏰\uFE0F?[ \t]*(\d{4})-(\d{1,2})-(\d{1,2})((?:[ \t]+|T)(\d{1,2})(?:[:.](\d{2}))?(?:[ \t]*([ap])\.?m\.?)?)?(?![\w:])/gi;
const REPEAT_AFTER = new RegExp(`^[ \\t]+((?:every[ \\t]+(?:other[ \\t]+)?(?:\\d{1,3}[ \\t]+(?:days|weeks|months|years)(?:[ \\t]+on[ \\t]+${WEEKDAY_WORD}(?:(?:,[ \\t]*|[ \\t]+and[ \\t]+|,[ \\t]*and[ \\t]+)${WEEKDAY_WORD})*)?|${WEEKDAY_WORD}(?:(?:,[ \\t]*|[ \\t]+and[ \\t]+|,[ \\t]*and[ \\t]+)${WEEKDAY_WORD})*|day|weekday|week|fortnight|month|year))|daily|weekly|fortnightly|monthly|yearly)(?![\\w])`, 'i');

const validDay = (y: number, m: number, d: number) => m >= 0 && m < 12 && d >= 1 && d <= new Date(y, m + 1, 0).getDate();

/** The reminder a line holds: a task line ("- [ ] …") with "⏰ YYYY-MM-DD" and perhaps a time and a repeat. */
export function parseReminderLine(line: string): ReminderLine | null {
  if (!line.includes('⏰')) return null;
  const task = TASK_LINE.exec(line);
  if (!task) return null;
  const head = task[1].length + 1 + task[3].length;
  let found: RegExpExecArray | null = null;
  MOMENT.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = MOMENT.exec(line)); ) if (m.index >= head) found = m;
  if (!found) return null;
  const y = Number(found[1]);
  const mo = Number(found[2]) - 1;
  const d = Number(found[3]);
  if (!validDay(y, mo, d)) return null;
  let hour = DEFAULT_HOUR;
  let minute = 0;
  let to = found.index + found[0].length;
  // A number after the date without minutes or am/pm ("⏰ 2026-10-23 9 bags") is not a time: the date alone.
  let timeGiven = found[4] !== undefined && (found[6] !== undefined || found[7] !== undefined);
  if (found[4] !== undefined && !timeGiven) to -= found[4].length;
  if (timeGiven) {
    hour = Number(found[5]);
    minute = found[6] ? Number(found[6]) : 0;
    const ap = found[7]?.toLowerCase();
    if (ap) {
      if (hour < 1 || hour > 12) timeGiven = false;
      else hour = (hour % 12) + (ap === 'p' ? 12 : 0);
    }
    if (hour > 23 || minute > 59) timeGiven = false;
    if (!timeGiven) {
      hour = DEFAULT_HOUR;
      minute = 0;
      to -= found[4].length;
    }
  }
  let repeat: Repeat | null = null;
  const after = REPEAT_AFTER.exec(line.slice(to));
  if (after) {
    repeat = parseRepeat(after[1]);
    if (repeat) to += after[0].length;
  }
  const from = found.index;
  const text = (line.slice(head, from) + line.slice(to)).replace(/\s+/g, ' ').trim();
  return { done: isBoxDone(task[2]), text, due: new Date(y, mo, d, hour, minute).getTime(), timeGiven, repeat, from, to };
}

/** "⏰ 2026-10-23 09:00" (and its repeat): how Ironleaf writes a reminder's moment. */
export function formatMark(due: Date | number, repeat?: Repeat | null): string {
  const d = new Date(due);
  return `${MARK} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}${repeat ? ` ${repeatText(repeat)}` : ''}`;
}

/** A reminder's line written as a task: "- [ ] Order flour ⏰ 2026-10-23 09:00". */
export function reminderLine(text: string, due: Date | number, repeat?: Repeat | null): string {
  return `- [ ] ${text.replace(/\s+/g, ' ').trim()} ${formatMark(due, repeat)}`;
}

/** A meeting action as a reminder line (10.0 item 19, one tap): "- [ ] Send the quote — Sam ⏰ 2026-11-06 09:00". */
export function meetingReminderLine(what: string, who: string | undefined, due: Date | number): string {
  const words = `${String(what ?? '').replace(/⏰\uFE0F?/g, '')}${who?.trim() ? ` — ${String(who).replace(/⏰\uFE0F?/g, '')}` : ''}`;
  return reminderLine(words, due);
}

/** A reminder line appended where the assistant puts it (10.0 item 19, the same behaviour from the meeting doors as
 *  the side chat's setReminder in src/main/agent.ts): under the tasks already there with no gap, else after a blank
 *  line; a home that isn't there yet starts headed ("# Reminders"). */
export function appendReminderLine(content: string | null | undefined, line: string): string {
  if (content === null || content === undefined) return `# Reminders\n\n${line}\n`;
  const body = content.replace(/\s*$/, '');
  const lastLine = body.slice(body.lastIndexOf('\n') + 1);
  return `${body}${/^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\]/.test(lastLine) ? '\n' : body ? '\n\n' : ''}${line}\n`;
}

/** The line with its moment moved (the repeat kept unless another is given). */
export function moveReminder(line: string, due: Date | number, repeat?: Repeat | null): string {
  const r = parseReminderLine(line);
  if (!r) return line;
  return line.slice(0, r.from) + formatMark(due, repeat === undefined ? r.repeat : repeat) + line.slice(r.to);
}

/** The line ticked (or not). */
export function setTicked(line: string, done: boolean): string {
  const m = TASK_LINE.exec(line);
  return m ? `${m[1]}${done ? 'x' : ' '}${m[3]}${m[4]}` : line;
}

/** A repeating reminder moved on to its next time, unticked: after `now` when it was due (fired or ticked late), else
 *  the one after the time shown (ticked early: that one is done). */
export function rollReminder(line: string, now: number): string | null {
  const r = parseReminderLine(line);
  if (!r?.repeat) return null;
  const next = nextOccurrence(r.repeat, new Date(r.due), Math.max(now, r.due));
  return setTicked(moveReminder(line, next), false);
}

const TASK_WITH_MARK = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\]\s+.*?)(⏰\uFE0F?)\s*([^⏰]+?)\s*$/;

/** The change that writes a task's "⏰ friday 3pm" (typed as people say it) the exact way: from where the ⏰ starts to
 *  the end of the line; null when it is exact already or isn't understood (then it is left as typed). */
export function exactMoment(text: string, now: Date): { from: number; to: number; insert: string } | null {
  if (parseReminderLine(text)) return null;
  const m = TASK_WITH_MARK.exec(text);
  if (!m) return null;
  const when = parseWhen(m[3], now);
  if (!when) return null;
  return { from: m[1].length, to: text.length, insert: formatMark(when.at, when.repeat) };
}

export interface FoundReminder extends ReminderLine {
  /** Its line in the note, from 0. */
  line: number;
}

/** Every reminder in a note (none inside fenced code or the properties). */
export function findReminders(content: string): FoundReminder[] {
  if (!content.includes('⏰')) return [];
  const out: FoundReminder[] = [];
  const lines = content.split(/\r?\n/);
  let fence: Fence | null = null;
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const l = lines[i];
    const st = trackFence(l, fence);
    fence = st.fence;
    if (st.skip) continue;
    const r = parseReminderLine(l);
    if (r) out.push({ ...r, line: i });
  }
  return out;
}

/** A reminder's words for matching: lower-case, punctuation and spacing blind (2 Nov 2026, 9.5 polished: "Call
 *  Mum" and "call mum!" are one reminder, like the calendars' title match). The note keeps the person's own words. */
export function normReminderText(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[’‘'′`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Whether a note already holds this reminder, still open: the same words, at the same moment, repeating the
 *  same way (9.2 fresh eyes: setting it twice reminded twice; 9.5: capitals or punctuation aside, still the same). */
export function sameReminder(content: string, what: string, due: Date | number, repeat?: Repeat | null): boolean {
  const text = normReminderText(what);
  const at = new Date(due).getTime();
  const rep = repeat ? repeatText(repeat) : '';
  return findReminders(content).some((r) => !r.done && normReminderText(r.text) === text && r.due === at && (r.repeat ? repeatText(r.repeat) : '') === rep);
}

/** The one home for new reminders (10.0): every door writes here, so a reminder has one place whatever made it. */
export const REMINDER_HOME = 'Reminders.md';

/** Every note the reminders can already be in (2 Nov 2026, seams O1: the same reminder set through two doors
 *  reminded twice). Reads and the same-or-near checks look in every home, so reminders already in the Inbox still
 *  count; writes go to the one home. */
export const REMINDER_HOMES = [REMINDER_HOME, 'Inbox.md'];

/** Where a new reminder goes: the named note when one is named, else the one home. */
export function resolveReminderHome(named?: string | null): string {
  const rel = (named ?? '').trim();
  return rel || REMINDER_HOME;
}

/** The note already holding this reminder, still open, across the notes given: its path, else null. The target note
 *  goes first, so "already set" names it when it holds it too. */
export function findSameReminder(notes: { path: string; content: string }[], what: string, due: Date | number, repeat?: Repeat | null): string | null {
  for (const n of notes) if (sameReminder(n.content, what, due, repeat)) return n.path;
  return null;
}

/** Within this of each other, two moments are the same occasion for the near-duplicate offer (O2, as /remind). */
export const NEAR_MINUTES = 5;

/** An open reminder near this one: within 5 minutes and sharing a word of substance (over two letters, never a small
 *  word — 5 Nov 2026, v8-vault-assistant: "the" matched two unrelated reminders at the same default 9:00 am), but never
 *  the same reminder itself (the same words at the same moment repeating the same way is "already set", never an
 *  offer). The first across the notes given (its note, line, words and moment), else null. */
export function nearReminder(notes: { path: string; content: string }[], what: string, due: Date | number, repeat?: Repeat | null): { path: string; line: number; text: string; due: number } | null {
  const at = new Date(due).getTime();
  const rep = repeat ? repeatText(repeat) : '';
  const substance = (s: string) => normReminderText(s).split(' ').filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const words = new Set(substance(what));
  if (!words.size) return null;
  for (const n of notes) {
    for (const r of findReminders(n.content)) {
      if (r.done || Math.abs(r.due - at) > NEAR_MINUTES * 60_000) continue;
      if (!substance(r.text).some((w) => words.has(w))) continue;
      if (normReminderText(r.text) === normReminderText(what) && r.due === at && (r.repeat ? repeatText(r.repeat) : '') === rep) continue;
      return { path: n.path, line: r.line, text: r.text, due: r.due };
    }
  }
  return null;
}

/** Which reminder a notice or Today line means, kept across changes elsewhere in the note (its words normalised, so
 *  duplicates share one fired key and fire once). */
export const reminderKey = (path: string, r: { text: string; due: number }) => `${path}\n${normReminderText(r.text)}\n${r.due}`;

/** The same reminder's key at another moment (a snoozed reminder's key, so an Undo can snooze it back; fnv3 F46). */
export const snoozedKey = (key: string, until: number): string => key.replace(/\n[^\n]*$/, `\n${until}`);

/** The line holding a reminder: where it was, else the nearest line with the same words (lines above it changed;
 *  capitals or punctuation aside, still the same). Twins (the same words twice) tell apart by their moment when given
 *  (Nov 2026 audit: two 'Bins' on different days ticked the wrong one); with no moment matching, the words still name it. */
export function locateReminder(lines: string[], line: number, text: string, due?: number): number {
  const want = normReminderText(text);
  const spiral = (withDue: boolean): number => {
    const same = (i: number) => {
      const r = parseReminderLine(lines[i] ?? '');
      return !!r && normReminderText(r.text) === want && (!withDue || due === undefined || r.due === due);
    };
    if (same(line)) return line;
    for (let d = 1; d < lines.length; d++) {
      if (line - d >= 0 && same(line - d)) return line - d;
      if (line + d < lines.length && same(line + d)) return line + d;
    }
    return -1;
  };
  const exact = spiral(true);
  return exact >= 0 || due === undefined ? exact : spiral(false);
}

// ── Words ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** "9:00 am", "12:30 pm". */
export function timeWords(d: Date | number): string {
  const t = new Date(d);
  const h = t.getHours();
  return `${h % 12 || 12}:${pad(t.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}

/** "Friday 23 October" (with its year when it isn't this year's). */
export function dayWordsLong(d: Date | number, now: Date | number = Date.now()): string {
  const t = new Date(d);
  return `${DAY_NAMES[t.getDay()]} ${t.getDate()} ${MONTH_NAMES[t.getMonth()]}${t.getFullYear() !== new Date(now).getFullYear() ? ` ${t.getFullYear()}` : ''}`;
}

/** "Friday 23 October at 9:00 am": a reminder's moment as the assistant and the notices say it. */
export function reminderWords(d: Date | number, now: Date | number = Date.now()): string {
  return `${dayWordsLong(d, now)} at ${timeWords(d)}`;
}

const startOf = (d: Date | number) => {
  const t = new Date(d);
  return new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
};
const daysFrom = (now: Date | number, d: Date | number) => Math.round((startOf(d) - startOf(now)) / DAY);

/** The pill in the editor: "Today, 3:00 pm", "Tomorrow, 9:00 am", "Fri 23 Oct, 9:00 am" (its year when not this one). */
export function pillWords(d: Date | number, now: Date | number = Date.now()): string {
  const t = new Date(d);
  const n = daysFrom(now, t);
  const day = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : `${DAY_NAMES[t.getDay()].slice(0, 3)} ${t.getDate()} ${MONTH_NAMES[t.getMonth()].slice(0, 3)}${t.getFullYear() !== new Date(now).getFullYear() ? ` ${t.getFullYear()}` : ''}`;
  return `${day}, ${timeWords(t)}`;
}

// ── When, from what people say ───────────────────────────────────────────────────────────────────────────────────────

export interface ParsedWhen {
  at: Date;
  /** A time was said (else 9:00 am, to be said so). */
  timeGiven: boolean;
  repeat: Repeat | null;
}

const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthIndex = (w: string) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(w.slice(0, 3).toLowerCase());
const FILLER = new Set(['on', 'at', 'the', 'by', 'this', 'coming', 'me', 'remind', 'to', 'of', 'and', 'from', 'now', 'starting', 'please', 'in']);

/**
 * When a reminder is for, from what the person or the assistant wrote, against `now`: "on Friday", "tomorrow at 3pm",
 * "next Monday", "in 2 hours", "23 Oct", "every Monday", "2026-10-23 09:00", "Friday 23 October at 9:30 am". A day
 * without a time is 9:00 am (timeGiven false, to be said). Every word must be understood: anything else ("end of the
 * month", "after lunch", "at 3" without am or pm) is null, so a time is never guessed.
 *
 * "Friday" is the next Friday (today, if today is Friday and the time is still ahead); "next Friday" is the next one
 * after today (never today). A date without its year is the next one to come.
 */
export function parseWhen(input: string, now: Date = new Date()): ParsedWhen | null {
  let t = ` ${input.toLowerCase().replace(/(\d{4}-\d{1,2}-\d{1,2})t(\d)/g, '$1 $2').replace(/[’']/g, '').replace(/⏰\uFE0F?/g, ' ').replace(/[!?]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '')} `;
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(t);
    if (m) t = `${t.slice(0, m.index)} ${t.slice(m.index + m[0].length)} `;
    return m;
  };

  // A repeat ("every Monday"), taken first so its day isn't read as the day.
  let repeat: Repeat | null = null;
  const rep = take(new RegExp(`\\s(every\\s+(?:other\\s+)?(?:(?:\\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\s+(?:days|weeks|months|years)(?:\\s+on\\s+${WEEKDAY_WORD}(?:(?:,\\s*|\\s+and\\s+|,\\s*and\\s+|\\s*&\\s*)${WEEKDAY_WORD})*)?|${WEEKDAY_WORD}(?:(?:,\\s*|\\s+and\\s+|,\\s*and\\s+|\\s*&\\s*)${WEEKDAY_WORD})*|day|week\\s?day|working day|workday|week|fortnight|month|year)|daily|weekly|fortnightly|monthly|yearly|annually)(?=\\s)`));
  if (rep) {
    repeat = parseRepeat(rep[1]);
    if (!repeat) return null;
  }

  // A time.
  let hour: number | null = null;
  let minute = 0;
  const ampm = take(/\s(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m\.?(?=\s)/);
  if (ampm) {
    const h = Number(ampm[1]);
    if (h < 1 || h > 12) return null;
    hour = (h % 12) + (ampm[3] === 'p' ? 12 : 0);
    minute = ampm[2] ? Number(ampm[2]) : 0;
  } else {
    const clock = take(/\s(?:at\s+)?(\d{1,2}):(\d{2})(?:\s*(?:hrs|h))?(?=\s)/) ?? take(/\s(?:at\s+)?(\d{2})(\d{2})\s*(?:hrs|h)(?=\s)/);
    if (clock) {
      hour = Number(clock[1]);
      minute = Number(clock[2]);
    } else if (take(/\s(?:at\s+)?(?:noon|midday|12\s*noon)(?=\s)/)) hour = 12;
    else if (take(/\s(?:at\s+)?midnight(?=\s)/)) hour = 0;
    // "Tomorrow morning" is the morning's 9:00 am, said as the time used when none was given.
    else take(/\s(?:in\s+the\s+)?morning(?=\s)/);
  }
  if (hour !== null && (hour > 23 || minute > 59)) return null;

  // In so long.
  const rel = take(/\sin\s+(an?|half an|\d{1,4}(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty five|forty-five)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|fortnight|months?)(?=\s)/);
  if (rel) {
    const words: Record<string, number> = { 'half an': 0.5, fifteen: 15, twenty: 20, thirty: 30, 'forty five': 45, 'forty-five': 45 };
    const amount = words[rel[1]] ?? (/^\d/.test(rel[1]) ? Number(rel[1]) : numberOf(rel[1]));
    if (!(amount > 0)) return null;
    const unit = rel[2];
    if (/^(minutes?|mins?|hours?|hrs?)$/.test(unit)) {
      if (hour !== null || repeat) return null;
      const ms = amount * (unit.startsWith('h') ? 3_600_000 : 60_000);
      const at = new Date(Math.round((now.getTime() + ms) / 60_000) * 60_000);
      if (leftover(t)) return null;
      return { at, timeGiven: true, repeat: null };
    }
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = unit.startsWith('month') ? addMonths(base, Math.round(amount)) : addDays(base, Math.round(amount * (unit.startsWith('week') ? 7 : unit === 'fortnight' ? 14 : 1)));
    return finish(day, hour, minute, repeat, t);
  }

  // A day.
  let day: Date | null = null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nextOf = (m: number, d: number): Date | null => {
    for (const y of [now.getFullYear(), now.getFullYear() + 1]) if (validDay(y, m, d) && new Date(y, m, d).getTime() >= today.getTime()) return new Date(y, m, d);
    return null;
  };
  // A weekday said with a numbered day must fall on that date, else the words are doubtful and
  // nothing is guessed (6 Nov 2026, HOLD 5: never the coming weekday for "Thursday the 19th").
  let stated = -1;
  const statedIn = (s: string): number => {
    const x = new RegExp(`^\\s*(${WEEKDAY_WORD}),?\\s`, 'i').exec(s);
    return x ? weekdayOf(x[1]) : -1;
  };
  let m: RegExpExecArray | null;
  if ((m = take(/\s(\d{4})-(\d{1,2})-(\d{1,2})(?=\s|t\d)/))) {
    if (!validDay(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) return null;
    day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else if ((m = take(new RegExp(`\\s(?:${WEEKDAY_WORD},?\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?,?(?:\\s+(\\d{4}))?(?=\\s)`)))) {
    stated = statedIn(m[0]);
    day = m[3] ? (validDay(Number(m[3]), monthIndex(m[2]), Number(m[1])) ? new Date(Number(m[3]), monthIndex(m[2]), Number(m[1])) : null) : nextOf(monthIndex(m[2]), Number(m[1]));
    if (!day) return null;
  } else if ((m = take(new RegExp(`\\s(?:${WEEKDAY_WORD},?\\s+)?${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?=\\s)`)))) {
    stated = statedIn(m[0]);
    day = m[3] ? (validDay(Number(m[3]), monthIndex(m[1]), Number(m[2])) ? new Date(Number(m[3]), monthIndex(m[1]), Number(m[2])) : null) : nextOf(monthIndex(m[1]), Number(m[2]));
    if (!day) return null;
  } else if ((m = take(new RegExp(`\\s(${WEEKDAY_WORD}),?\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)(?=\\s)`)))) {
    // "Thursday the 22nd", "Thu 22nd": the first date with that number from today, as below.
    stated = weekdayOf(m[1]);
    const d = Number(m[2]);
    for (let k = 0; k < 3 && !day; k++) {
      const c = new Date(now.getFullYear(), now.getMonth() + k, 1);
      if (validDay(c.getFullYear(), c.getMonth(), d) && new Date(c.getFullYear(), c.getMonth(), d).getTime() >= today.getTime()) day = new Date(c.getFullYear(), c.getMonth(), d);
    }
    if (!day) return null;
  } else if ((m = take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?=\s)/))) {
    // Day first, as in Australia.
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    day = y !== null ? (validDay(y, Number(m[2]) - 1, Number(m[1])) ? new Date(y, Number(m[2]) - 1, Number(m[1])) : null) : nextOf(Number(m[2]) - 1, Number(m[1]));
    if (!day) return null;
  } else if ((m = take(/\s(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)(?=\s)/))) {
    const d = Number(m[1]);
    for (let k = 0; k < 3 && !day; k++) {
      const c = new Date(now.getFullYear(), now.getMonth() + k, 1);
      if (validDay(c.getFullYear(), c.getMonth(), d) && new Date(c.getFullYear(), c.getMonth(), d).getTime() >= today.getTime()) day = new Date(c.getFullYear(), c.getMonth(), d);
    }
    if (!day) return null;
  } else if (take(/\s(?:the\s+)?day\s+after\s+tomorrow(?=\s)/)) day = addDays(today, 2);
  else if (take(/\stomorrow(?=\s)/)) day = addDays(today, 1);
  else if (take(/\stoday(?=\s)/)) day = today;
  else if (take(/\snext\s+week(?=\s)/)) day = addDays(today, ((8 - today.getDay()) % 7) || 7);
  else if ((m = take(new RegExp(`\\s(?:(next|this|on|coming)\\s+)?(${WEEKDAY_WORD})(?=\\s)`)))) {
    const want = weekdayOf(m[2]);
    if (want < 0) return null;
    let ahead = (want - today.getDay() + 7) % 7;
    const h = hour ?? DEFAULT_HOUR;
    if (ahead === 0 && (m[1] === 'next' || new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, minute).getTime() <= now.getTime())) ahead = 7;
    day = addDays(today, ahead);
  }
  // A weekday said beside a date ("Friday 23 October") is only the date's own name: taken, not read again.
  if (day) {
    const side = take(new RegExp(`\\s(?:on\\s+)?(${WEEKDAY_WORD}),?(?=\\s)`));
    if (side && stated < 0) stated = weekdayOf(side[1]);
  }
  if (day && stated >= 0 && day.getDay() !== stated) return null;

  if (!day) {
    if (repeat) {
      // "every Monday at 9am": the first one to come, today included while its time is ahead.
      const h = hour ?? DEFAULT_HOUR;
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, minute);
      const onDays = repeat.unit === 'weekday' || !!repeat.days?.length;
      const first = start.getTime() > now.getTime() && (!onDays || fallsOn(repeat, start, start)) ? start : nextOccurrence(repeat, start, now.getTime());
      if (leftover(t)) return null;
      return { at: first, timeGiven: hour !== null, repeat };
    }
    if (hour === null) return null;
    // A time alone: today's while it is ahead, else tomorrow's.
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute);
    if (leftover(t)) return null;
    return { at: at.getTime() > now.getTime() ? at : addDays(at, 1), timeGiven: true, repeat: null };
  }
  return finish(day, hour, minute, repeat, t);
}

/** Words left over that weren't understood (fillers aside): then nothing is guessed. */
function leftover(rest: string): boolean {
  return rest
    .split(/[\s,]+/)
    .filter(Boolean)
    .some((w) => !FILLER.has(w));
}

function finish(day: Date, hour: number | null, minute: number, repeat: Repeat | null, rest: string): ParsedWhen | null {
  if (leftover(rest)) return null;
  let at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour ?? DEFAULT_HOUR, hour === null ? 0 : minute);
  // "every Monday from 2 November": the first Monday from that day.
  if (repeat && (repeat.unit === 'weekday' || repeat.days?.length) && !fallsOn(repeat, at, at)) at = nextOccurrence(repeat, at, at.getTime());
  return { at, timeGiven: hour !== null, repeat };
}

// ── Today's card and firing ──────────────────────────────────────────────────────────────────────────────────────────

export interface ReminderItem {
  key: string;
  path: string;
  /** The note's name as people see it. */
  title: string;
  line: number;
  text: string;
  due: number;
  timeGiven: boolean;
  repeat: string | null;
  done: boolean;
}

export interface ReminderGroups {
  overdue: ReminderItem[];
  today: ReminderItem[];
  upcoming: ReminderItem[];
}

/** Today's card: what has passed and isn't ticked, the rest of today (with times), and the next seven days. */
export function groupReminders(items: ReminderItem[], now: number): ReminderGroups {
  const open = items.filter((i) => !i.done).sort((a, b) => a.due - b.due || a.text.localeCompare(b.text));
  const endToday = startOf(now) + DAY;
  const endWeek = startOf(now) + 8 * DAY;
  return {
    overdue: open.filter((i) => i.due <= now),
    today: open.filter((i) => i.due > now && i.due < endToday),
    upcoming: open.filter((i) => i.due >= endToday && i.due < endWeek),
  };
}

/** What Ironleaf remembers between checks (for each folder of notes): when it last looked, and what it has said. */
export interface FireState {
  lastCheck: number | null;
  /** Reminder keys said, and when. */
  fired: Record<string, number>;
}

/** Missed ones older than this (the PC off for a fortnight) are left for Today, never a burst of old notices. */
export const CATCH_UP = 7 * DAY;
/** Said this late, a reminder is said as missed, with the time it was for. */
export const LATE = 2 * 60_000;

/**
 * The reminders to say now: each one due since the last check (and not said already), said once. The first check ever
 * says none (old reminders in the notes wait on Today); after the PC was asleep or off, those due meanwhile come once,
 * marked missed, up to a week back. Each key once (duplicate lines share one key and fire as one).
 */
export function dueToFire(items: ReminderItem[], state: FireState, now: number): { fire: { item: ReminderItem; missed: boolean }[]; state: FireState } {
  const fired: Record<string, number> = {};
  for (const [k, at] of Object.entries(state.fired ?? {})) if (now - at < 30 * DAY) fired[k] = at;
  if (state.lastCheck === null || !Number.isFinite(state.lastCheck)) return { fire: [], state: { lastCheck: now, fired } };
  const since = Math.max(Math.min(state.lastCheck, now), now - CATCH_UP);
  const seen = new Set<string>();
  const fire = items
    .filter((i) => !i.done && i.due > since && i.due <= now && !fired[i.key])
    .sort((a, b) => a.due - b.due)
    .filter((i) => {
      if (seen.has(i.key)) return false;
      seen.add(i.key);
      return true;
    })
    .map((item) => ({ item, missed: now - item.due > LATE }));
  for (const f of fire) fired[f.item.key] = now;
  return { fire, state: { lastCheck: now, fired } };
}

/** Snooze's choices from a notice: ten minutes, an hour, tomorrow at 9:00 am. */
export function snoozeTimes(now: number): { label: string; short: string; at: number }[] {
  const n = new Date(now);
  const minute = (ms: number) => Math.ceil(ms / 60_000) * 60_000;
  return [
    { label: '10 minutes', short: '10 min', at: minute(now + 10 * 60_000) },
    { label: '1 hour', short: '1 hour', at: minute(now + 60 * 60_000) },
    { label: 'Tomorrow, 9:00 am', short: 'Tomorrow 9 am', at: new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, DEFAULT_HOUR, 0).getTime() },
  ];
}
