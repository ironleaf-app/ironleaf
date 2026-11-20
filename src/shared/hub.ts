// Today as the hub (20 Oct 2026: one place to start the day). Today is the start page: a calm week strip that opens to a
// month, the day's note open for writing right under it (the inbox, where Quick capture lands), what is due across every
// note (reminders and open "- [ ]" lines, by Overdue / Today / Next 7 days / No date), the day's meetings, and what was
// made, changed and linked on that day. Choosing another day in the strip shows that day's hub (yesterday, last
// Tuesday…).
//
// Pure: the index keeps each note's open task lines and the days it mentions (src/main/indexer.ts), the main side builds
// a day and the dots from them (src/main/hub.ts), the window draws them (src/renderer/src/views/today/). Days are the
// PC's own local days, written YYYY-MM-DD between the sides; weeks start on Monday, as Australian calendars do.

import { timeMinutes } from './clock';
import { calendarDayOf, readDay as readWrittenDay } from './days';
import { formatDue } from './due-words';
import { isBoxDone } from './finished';
import { STALE_AFTER_DAYS, isStaleOffset } from './today-count';
import { TASK_LINE, trackFence, type Fence } from './markdown';
import { isMeetingNote } from './meetings';
import { isRecordProps } from './module-records';
import type { Hideable, Prefs } from './prefs';
import { parseReminderLine, type ReminderItem } from './reminders';
import { readDay } from './today';
import type { TaskSource } from './unified-tasks';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

// ── Days ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** 2026-10-20, the PC's own day. */
export const isoOf = (d: Date | number): string => {
  const t = new Date(d);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether a string is a real day written YYYY-MM-DD. */
export function isIsoDay(text: unknown): text is string {
  const m = typeof text === 'string' ? ISO.exec(text) : null;
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

/** The day's local midnight. */
export function dateOf(iso: string): Date {
  const m = ISO.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(NaN);
}

/** A day moved by `n` days (counted in days, so daylight saving never skips one). */
export function addDays(iso: string, n: number): string {
  const d = dateOf(iso);
  return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Whole days from a to b (b later: positive). */
export function daysApart(a: string, b: string): number {
  const x = dateOf(a);
  const y = dateOf(b);
  return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) - Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 86_400_000);
}

/** The week a day is in, Monday to Sunday. */
export function weekOf(iso: string): string[] {
  const d = dateOf(iso);
  const monday = addDays(iso, -((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The month a day is in as a calendar: six weeks from the Monday on or before the 1st (the same size every month, so
 *  the page never jumps). */
export function monthGrid(iso: string): string[] {
  const d = dateOf(iso);
  const first = isoOf(new Date(d.getFullYear(), d.getMonth(), 1));
  const start = weekOf(first)[0];
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** "Tuesday 20 October" (with its year when it isn't this year's). */
export function longDay(iso: string, todayIso: string): string {
  const d = dateOf(iso);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}${d.getFullYear() !== dateOf(todayIso).getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** "Tue 20 Oct": a day in a list. */
export function shortDay(iso: string, todayIso: string): string {
  const d = dateOf(iso);
  return `${DAY_NAMES[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}${d.getFullYear() !== dateOf(todayIso).getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** "October", "October 2027": the month above the calendar. */
export function monthWords(iso: string, todayIso: string): string {
  const d = dateOf(iso);
  return `${MONTH_NAMES[d.getMonth()]}${d.getFullYear() !== dateOf(todayIso).getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** How near a day is, as people say it: Today, Yesterday, Tomorrow, "Last Tuesday" (this past week), "Thursday" (the
 *  coming week); null further off (the long day says it). */
export function nearWords(iso: string, todayIso: string): string | null {
  const n = daysApart(todayIso, iso);
  if (n === 0) return 'Today';
  if (n === -1) return 'Yesterday';
  if (n === 1) return 'Tomorrow';
  const name = DAY_NAMES[dateOf(iso).getDay()];
  if (n < 0 && n >= -6) return `Last ${name}`;
  if (n > 0 && n <= 6) return name;
  return null;
}

/** A day in a due line (5 Nov 2026, the plan: the one reader, short form for messages — Today,
 *  Tomorrow, Yesterday, else "Mon 19 Oct" with no countdown). */
export function dueDayWords(iso: string, todayIso: string): string {
  const n = daysApart(todayIso, iso);
  return formatDue(n, dateOf(iso), dateOf(todayIso), { countdown: false }).words;
}

// ── Task lines ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** An open task line in a note ("- [ ] Call Priya — by 23 Oct 2026"), as the index keeps it. */
export interface FoundTask {
  /** Its line in the note, from 0. */
  line: number;
  /** The words after the box, as written (to find the line again). */
  text: string;
  /** The day it is for, when the line says one plainly (YYYY-MM-DD), else null. */
  due: string | null;
}

// A weekday said with its numbered day, whole ("Thursday the 19th of November"): the "the" and
// "of" belong to the phrase, so no part of it is left in the words (6 Nov 2026, HOLD 5).
const WEEKDAY = '(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+(?:the\\s+)?';
const WRITTEN_DAY = `(?:${WEEKDAY})?(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?[A-Za-z]{3,9}\\.?(?:,?\\s+\\d{4})?|[A-Za-z]{3,9}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}/\\d{1,2}/\\d{2,4})`;
/** A time after a task's day (21 Oct 2026, gap G24: a due time can become a reminder): "15:00", "3pm", "3:30 pm",
 *  "T15:00", optionally after "at". A number on its own ("📅 2026-10-24 9 bags") is not a time. */
const TIME_BODY = '(\\d{1,2}(?::\\d{2})?\\s?[ap]\\.?m\\.?|\\d{1,2}:\\d{2})';
const AFTER_TIME = `(?:(?:[ \\t]+(?:at[ \\t]+)?|T)${TIME_BODY}(?![\\w:]))?`;
/** The ways a task line says its day, each taken out of the words shown. Ironleaf writes "📅 2026-10-23" (and
 *  "📅 2026-10-23 15:00" with a time; docs/TASKS.md). It also reads "due:: 2026-10-23" and "[due:: …]", "due:2026-10-23",
 *  "@due(2026-10-23)", "— by 23 Oct 2026" (as Quick capture and project files write it), "(due Fri 23 Oct)", and a link
 *  to a day's note ("[[2026-10-23]]"). Words like "by Friday" are left alone: said on some earlier day, they no longer
 *  say which Friday. */
const DUE_MARKS: { re: RegExp; day(m: RegExpExecArray, ref: Date): string | null; keep?: boolean }[] = [
  { re: new RegExp(`\\s*(?:📅|🗓️?)\\s*(\\d{4}-\\d{2}-\\d{2})${AFTER_TIME}`, 'u'), day: (m) => (isIsoDay(m[1]) ? m[1] : null) },
  { re: new RegExp(`\\s*\\[?due::?\\s*(\\d{4}-\\d{2}-\\d{2})${AFTER_TIME}\\]?`, 'i'), day: (m) => (isIsoDay(m[1]) ? m[1] : null) },
  { re: new RegExp(`\\s*@due\\(\\s*(\\d{4}-\\d{2}-\\d{2})${AFTER_TIME}\\s*\\)`, 'i'), day: (m) => (isIsoDay(m[1]) ? m[1] : null) },
  { re: new RegExp(`\\s*(?:[—–-]\\s*|,\\s*|\\(\\s*|\\s)(?:by|due(?:\\s+(?:on|by))?)\\s+(${WRITTEN_DAY})(?:[ \\t]+at[ \\t]+${TIME_BODY})?\\)?(?=$|[\\s.,;·)])`, 'i'), day: (m, ref) => fromWritten(m[1], ref) },
  { re: /\[\[(\d{4}-\d{2}-\d{2})(?:[|#][^\]]*)?\]\]/, day: (m) => (isIsoDay(m[1]) ? m[1] : null), keep: true },
];

/** Other marks community task formats put on a line, read but not shown in the words (21 Oct 2026, gap G24): when it
 *  was done (✅), scheduled (⏳), starts (🛫), was made (➕) or cancelled (❌), its priority (🔺 ⏫ 🔼 🔽 ⏬) and a repeat
 *  (🔁 every week). */
const QUIET_MARKS = [/\s*[✅⏳🛫➕❌]\uFE0F?\s*\d{4}-\d{2}-\d{2}/gu, /\s*(?:🔺|⏫|🔼|🔽|⏬)\uFE0F?/gu, /\s*🔁\uFE0F?\s*every\b[^📅⏳🛫➕✅❌#^\[]*/gu];

function fromWritten(text: string, ref: Date): string | null {
  const r = readDay(text, ref);
  return r ? `${r.year}-${pad(r.month + 1)}-${pad(r.day)}` : null;
}

/** "3pm", "3:30 pm", "15:00" as 24-hour "HH:MM" (null: not a time of day). */
export function timeOfDay(text: string | undefined): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s?(?:([ap])\.?m\.?)?$/i.exec(String(text ?? '').trim());
  if (!m || (m[2] === undefined && !m[3])) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
  }
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : null;
}

/** The day a task's words say it is for, the time when one is written with it, and the words without them (a link to
 *  the day's note stays, as written; other formats' marks are left out of the words). */
export function readTaskDue(text: string, ref: Date = new Date()): { due: string | null; time: string | null; words: string } {
  let words = text;
  let due: string | null = null;
  let time: string | null = null;
  for (const mark of DUE_MARKS) {
    const m = mark.re.exec(words);
    if (!m) continue;
    const day = mark.day(m, ref);
    if (!day) continue;
    if (due === null) {
      due = day;
      time = timeOfDay(m[2]);
    }
    if (!mark.keep) words = words.slice(0, m.index) + words.slice(m.index + m[0].length);
  }
  for (const re of QUIET_MARKS) words = words.replace(re, '');
  // "— Sam · by 24 Oct" (as meetings and project files write who and when) leaves no "·" behind once the day is out.
  return { due, time, words: words.replace(/\s+[—–·-]\s*$/, '').replace(/\s{2,}/g, ' ').trim() };
}

/** The day a task's words say it is for, and the words without it (a link to the day's note stays, as written). */
export function taskDue(text: string, ref: Date = new Date()): { due: string | null; words: string } {
  const { due, words } = readTaskDue(text, ref);
  return { due, words };
}

/** A task line's due marks taken out with the words they leave (4 Nov 2026): the marks in the order written, to put back
 *  when the words change. A day's-note link stays in the words: it is the person's own link, not only a day. The one
 *  source is DUE_MARKS, as readTaskDue reads them. */
export function splitDueMarks(text: string, ref: Date = new Date()): { rest: string; marks: string[] } {
  const found: { at: number; words: string }[] = [];
  for (const mark of DUE_MARKS) {
    if (mark.keep) continue;
    const re = new RegExp(mark.re.source, mark.re.flags.includes('g') ? mark.re.flags : `${mark.re.flags}g`);
    for (const m of text.matchAll(re)) {
      if (!mark.day(m as RegExpExecArray, ref)) continue;
      if (found.some((f) => m.index! < f.at + f.words.length && f.at < m.index! + m[0].length)) continue;
      found.push({ at: m.index!, words: m[0] });
    }
  }
  found.sort((a, b) => a.at - b.at);
  let rest = text;
  for (let i = found.length - 1; i >= 0; i--) rest = rest.slice(0, found[i].at) + rest.slice(found[i].at + found[i].words.length);
  rest = rest.replace(/\s+[—–·-]\s*$/, '').replace(/\s{2,}/g, ' ');
  return { rest: rest.replace(/\s+$/, ''), marks: found.map((f) => f.words) };
}

/** Every due mark readTaskDue reads, taken out of a line before another due is written (the one source: DUE_MARKS), so
 *  an old day can never come back once a new one is set (Nov 2026 audit). A day's-note link goes too: it reads as a day. */
export function stripDueMarks(text: string): string {
  let out = text;
  for (const mark of DUE_MARKS) {
    const re = new RegExp(mark.re.source, mark.re.flags.includes('g') ? mark.re.flags : `${mark.re.flags}g`);
    out = out.replace(re, '');
  }
  return out.replace(/\s+[—–·-]\s*$/, '').replace(/\s{2,}/g, ' ');
}

/** Every open task line in a note with words in it (none inside fenced code or the properties). Reminders (⏰ lines) are
 *  left to the reminders (src/shared/reminders.ts), which say them at their time. */
export function findTasks(content: string, ref: Date = new Date()): FoundTask[] {
  if (!/\[[^\]]\]/.test(content)) return [];
  const out: FoundTask[] = [];
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
    const m = TASK_LINE.exec(l);
    if (!m || isBoxDone(m[2]) || !m[4].trim()) continue;
    if (l.includes('⏰') && parseReminderLine(l)) continue;
    out.push({ line: i, text: m[4], due: taskDue(m[4], ref).due });
  }
  return out;
}

/** The words after a task line's box (null: not a task line). */
export function taskText(line: string): string | null {
  const m = TASK_LINE.exec(line);
  return m ? m[4] : null;
}

/** The line holding a task: where it was, else the nearest line with the same words (lines above it changed). */
export function locateTask(lines: string[], line: number, text: string): number {
  const same = (i: number) => taskText(lines[i] ?? '') === text;
  if (same(line)) return line;
  for (let d = 1; d < lines.length; d++) {
    if (line - d >= 0 && same(line - d)) return line - d;
    if (line + d < lines.length && same(line + d)) return line + d;
  }
  return -1;
}

// ── What is due ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DueTask {
  /** Which task a tick means (taskKey): the note and the line's words, twins counted apart. */
  key: string;
  path: string;
  /** The note's name as people see it. */
  title: string;
  line: number;
  text: string;
  /** The words to show (the day taken out). */
  words: string;
  due: string | null;
  /** The note's type: property, when it has one (for its icon). */
  type?: string;
  /** Everywhere it was written (one task, one row): small words under the row, never a second copy. */
  sources?: TaskSource[];
}

export type DueEntry = { kind: 'reminder'; key: string; day: string; item: ReminderItem } | { kind: 'task'; key: string; day: string | null; item: DueTask };

/** Whether a due day is stale against today (both YYYY-MM-DD): the day-based side of the one stale rule
 *  (src/shared/today-count.ts STALE_AFTER_DAYS). */
export function isStaleDay(due: string, today: string): boolean {
  return daysApart(today, due) < -STALE_AFTER_DAYS;
}

export interface DueGroups {
  overdue: DueEntry[];
  today: DueEntry[];
  week: DueEntry[];
  /** Dated past the next 7 days (4 Nov 2026, p12-today-focus round 4: Today folds them under Later with the
   *  projects' Coming up, so nothing dated ever vanishes from the one list). */
  later: DueEntry[];
  /** Dated more than STALE_AFTER_DAYS past (5 Nov 2026, u3 moving-in): the quiet "from a while back" group,
   *  oldest first, rendered last and never leading the day. */
  stale: DueEntry[];
  /** Open tasks with no day, newest notes first (the first `undatedMax`), and how many there are in all. */
  undated: DueTask[];
  undatedCount: number;
}

/** Which task a tick means: its note and its line's words, kept across changes elsewhere in the note. A twin (the same
 *  words twice in one note) counts which (Nov 2026 audit: twins shared a key, so ticking one flipped the other). The
 *  one helper: tasks and the hub both key through here. */
export const taskKey = (path: string, text: string, occurrence = 0) => (occurrence > 0 ? `${path}\n${text}\n${occurrence + 1}` : `${path}\n${text}`);

/** Where an entry sorts in its group: its moment (a reminder) or the end of its day (a task, after the day's times). */
const sortAt = (e: DueEntry) => (e.kind === 'reminder' ? e.item.due : dateOf(e.day!).getTime() + 86_399_000);

/**
 * Reminders and dated tasks by Overdue (a reminder whose moment has passed, a task whose day has), Today, the Next 7
 * days, Later past them, and From a while back (stale: more than STALE_AFTER_DAYS past, oldest first, rendered last
 * and never leading), oldest first in each; open tasks with no day apart (collapsed on the page). Ticked reminders
 * are left out.
 */
export function groupDue(tasks: DueTask[], reminders: ReminderItem[], now: number, undatedMax = 200): DueGroups {
  const today = isoOf(now);
  const groups: DueGroups = { overdue: [], today: [], week: [], later: [], stale: [], undated: [], undatedCount: 0 };
  const put = (e: DueEntry, n: number, passed: boolean) => {
    if (passed && isStaleOffset(n)) groups.stale.push(e);
    else if (passed) groups.overdue.push(e);
    else if (n === 0) groups.today.push(e);
    else if (n > 0 && n <= 7) groups.week.push(e);
    else if (n > 7) groups.later.push(e);
  };
  for (const r of reminders) {
    if (r.done) continue;
    const day = isoOf(r.due);
    put({ kind: 'reminder', key: r.key, day, item: r }, daysApart(today, day), r.due <= now);
  }
  const undated: DueTask[] = [];
  for (const t of tasks) {
    if (!t.due) undated.push(t);
    else {
      const n = daysApart(today, t.due);
      put({ kind: 'task', key: t.key, day: t.due, item: t }, n, n < 0);
    }
  }
  const order = (a: DueEntry, b: DueEntry) => sortAt(a) - sortAt(b) || words(a).localeCompare(words(b));
  groups.overdue.sort(order);
  groups.today.sort(order);
  groups.week.sort(order);
  groups.later.sort(order);
  groups.stale.sort(order);
  groups.undatedCount = undated.length;
  groups.undated = undated.slice(0, undatedMax);
  return groups;
}

const words = (e: DueEntry) => (e.kind === 'reminder' ? e.item.text : e.item.words);

/** What is due on one day (another day chosen in the strip): its reminders, ticked or not, and its dated tasks. */
export function dueOn(tasks: DueTask[], reminders: ReminderItem[], iso: string): DueEntry[] {
  const out: DueEntry[] = [];
  for (const r of reminders) if (isoOf(r.due) === iso) out.push({ kind: 'reminder', key: r.key, day: iso, item: r });
  for (const t of tasks) if (t.due === iso) out.push({ kind: 'task', key: t.key, day: iso, item: t });
  return out.sort((a, b) => sortAt(a) - sortAt(b) || words(a).localeCompare(words(b)));
}

// ── The days a note mentions ─────────────────────────────────────────────────────────────────────────────────────────

/** Properties about the note's own life (made, saved, changed): a day there isn't the note being about that day. */
const LIFE_KEYS = /^\s*(created|updated|modified|changed|saved|captured|date[ _-]?created|date[ _-]?modified|last[ _-]?(?:edited|modified|updated))\s*:/i;
const ISO_IN_TEXT = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d])/g;

/** The days a note mentions, written YYYY-MM-DD: in its properties ("due: 2026-10-20", but not "created: …") and its
 *  words ("[[2026-10-20]]", "on 2026-10-20"). At most 200, each once. */
export function datesIn(content: string): string[] {
  if (!/\d{4}-\d{2}-\d{2}/.test(content)) return [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);
  let inFront = lines[0]?.trim() === '---';
  for (let i = 0; i < lines.length && seen.size < 200; i++) {
    const l = lines[i];
    if (inFront && i > 0 && /^(---|\.\.\.)\s*$/.test(l)) {
      inFront = false;
      continue;
    }
    if (inFront && LIFE_KEYS.test(l)) continue;
    if (!l.includes('-')) continue;
    ISO_IN_TEXT.lastIndex = 0;
    for (let m: RegExpExecArray | null; (m = ISO_IN_TEXT.exec(l)); ) if (isIsoDay(m[0])) seen.add(m[0]);
  }
  return [...seen];
}

// ── Notes on a day ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface HubNoteInput {
  path: string;
  /** The name people see. */
  title: string;
  mtime: number;
  /** When the file was made on this PC (ms), when known. */
  born?: number;
  props: Record<string, unknown>;
}

const propText = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : v instanceof Date ? calendarDayOf(v) : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined);

/** The day a note was made: its own words for it (created:, captured:, saved:), else when the file was made on this PC.
 *  A file copied or synced here keeps its older changed time, so the earlier of the two is taken. Null: not known. */
export function madeDay(note: Pick<HubNoteInput, 'props' | 'born' | 'mtime'>): string | null {
  for (const key of ['created', 'date created', 'captured', 'saved']) {
    const v = propText(note.props?.[key]);
    const m = v ? /^(\d{4}-\d{2}-\d{2})/.exec(v) : null;
    if (m && isIsoDay(m[1])) return m[1];
  }
  if (!note.born || !Number.isFinite(note.born) || note.born <= 0) return null;
  return isoOf(Math.min(note.born, note.mtime || note.born));
}

/** The day a meeting note is for: a meeting (src/shared/meetings.ts says which notes are) with its date in its
 *  properties (date:, when:, day:, held:) or its name. Null: not a meeting, or no day written. */
export function meetingDay(note: Pick<HubNoteInput, 'path' | 'props'>, ref: Date): string | null {
  if (!isMeetingNote(note.path, note.props ?? {})) return null;
  for (const key of ['date', 'when', 'day', 'held']) {
    const raw = note.props?.[key];
    if (raw instanceof Date) { const day = calendarDayOf(raw); if (day) return day; continue; }
    const v = propText(raw);
    if (!v) continue;
    const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v);
    if (iso && isIsoDay(iso[1])) return iso[1];
    const d = readWrittenDay(v.slice(0, 40), ref);
    if (d) return isoOf(d);
  }
  const name = note.path.split('/').pop() ?? '';
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(name);
  return iso && isIsoDay(iso[1]) ? iso[1] : null;
}

/** A meeting's time: its time: (or start:) property, else the time written with its date ("2026-10-20 14:00"). */
export function meetingTime(props: Record<string, unknown>): string | undefined {
  for (const key of ['time', 'start', 'starts']) {
    const v = propText(props?.[key]);
    if (v) return v.slice(0, 20);
  }
  const d = propText(props?.date ?? props?.when);
  const t = d ? /^\d{4}-\d{2}-\d{2}(?:T|\s+)(\d{1,2}:\d{2})/.exec(d) : null;
  return t ? t[1] : undefined;
}

export interface HubMeeting {
  path: string;
  title: string;
  time?: string;
  attendees: string[];
}

export interface HubNoteRef {
  path: string;
  title: string;
  /** Its type: property (for its icon), when it has one. */
  type?: string;
  /** When it last changed. */
  at: number;
}

export interface HubDay {
  date: string;
  /** That day's note (Settings › Daily notes): where it is, and whether it is written yet. */
  daily: { path: string; exists: boolean };
  meetings: HubMeeting[];
  /** Made on the day, changed on the day (and not made then), linked to the day (properties or words naming it, or a
   *  link to its note): each note in one list only, newest first, the first `max` of each. */
  made: HubNoteRef[];
  changed: HubNoteRef[];
  linked: HubNoteRef[];
  /** Pages and words saved that day (the "Saved pages" folder, or the older "Saved from the former host app"), shown with the
day's note. */
  saved: HubNoteRef[];
  counts: { made: number; changed: number; linked: number; saved: number };
}

export interface HubDayInput {
  iso: string;
  notes: HubNoteInput[];
  /** The days each note mentions (datesIn), by its path. */
  dates(path: string): readonly string[];
  daily: { path: string; exists: boolean };
  /** Notes that link to the day's note. */
  linkedToDaily: readonly string[];
  /** Left out: the templates folder, and notes left out of search (Settings › Files and links). */
  skip(path: string): boolean;
  /** Notes the person opened (their recent list): a pack's record lists only when opened (5 Nov 2026,
   *  "your notes are yours": machine-made and machine-touched records stay out of Made and Changed). */
  opened?: ReadonlySet<string> | readonly string[];
  now: Date;
  max?: number;
}

/** Where a saved page goes from now on (20 Nov 2026: a neutral name, Ironleaf stands on its own). */
export const SAVED_FOLDER = 'Saved pages';
/** Where saved pages were kept before (the former host app's vault-notes.mjs CLIP_FOLDER): still read, never
renamed. */
export const OLD_SAVED_FOLDER = 'Saved from NeuralSpark';
/** Every folder whose notes read as saved pages. */
export const SAVED_FOLDERS: readonly string[] = [SAVED_FOLDER, OLD_SAVED_FOLDER];
const inSavedFolder = (path: string): boolean => {
  const p = path.toLowerCase();
  return SAVED_FOLDERS.some((f) => p.startsWith(`${f.toLowerCase()}/`));
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).replace(/^\[\[|\]\]$/g, '').split('|').pop()!.trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
const typeOf = (props: Record<string, unknown>) => (typeof props?.type === 'string' && props.type.trim() ? props.type.trim().toLowerCase().slice(0, 40) : undefined);

/** One day's hub, from the notes as the index has them. */
export function buildDay(input: HubDayInput): HubDay {
  const { iso, max = 40 } = input;
  const meetings: HubMeeting[] = [];
  const made: HubNoteRef[] = [];
  const changed: HubNoteRef[] = [];
  const linked: HubNoteRef[] = [];
  const saved: HubNoteRef[] = [];
  const toDaily = new Set(input.linkedToDaily);
  const opened = input.opened instanceof Set ? input.opened : new Set(input.opened ?? []);
  for (const n of input.notes) {
    if (n.path === input.daily.path || input.skip(n.path)) continue;
    // A pack's record the person never opened is the machine's business, not the day's: it stays out of Made
    // and Changed (an opened one reads as theirs). Linked is link-based, so it keeps everything.
    const unopenedRecord = isRecordProps(n.props) && !opened.has(n.path);
    const ref: HubNoteRef = { path: n.path, title: n.title, at: n.mtime, ...(typeOf(n.props) ? { type: typeOf(n.props) } : {}) };
    if (meetingDay(n, input.now) === iso) {
      const time = meetingTime(n.props);
      meetings.push({ path: n.path, title: meetingTitle(n.title, iso), ...(time ? { time } : {}), attendees: list(n.props?.attendees ?? n.props?.people) });
      continue;
    }
    const madeOn = madeDay(n) === iso;
    if (madeOn && inSavedFolder(n.path)) saved.push(ref);
    else if (madeOn) {
      if (!unopenedRecord) made.push(ref);
    } else if (toDaily.has(n.path) || input.dates(n.path).includes(iso)) linked.push(ref);
    else if (isoOf(n.mtime) === iso && !unopenedRecord) changed.push(ref);
  }
  const newest = (a: HubNoteRef, b: HubNoteRef) => b.at - a.at || a.title.localeCompare(b.title);
  for (const l of [made, changed, linked, saved]) l.sort(newest);
  meetings.sort((a, b) => (timeMinutes(a.time) ?? 9999) - (timeMinutes(b.time) ?? 9999) || a.title.localeCompare(b.title));
  return {
    date: iso,
    daily: input.daily,
    meetings,
    made: made.slice(0, max),
    changed: changed.slice(0, max),
    linked: linked.slice(0, max),
    saved: saved.slice(0, max),
    counts: { made: made.length, changed: changed.length, linked: linked.length, saved: saved.length },
  };
}

// ── Dots in the strip ────────────────────────────────────────────────────────────────────────────────────────────────

export interface DayMark {
  /** The day's note is written. */
  note?: boolean;
  meetings?: number;
  /** Reminders and dated tasks on the day (still open). */
  due?: number;
}

/** The dots for each day shown: the day's note, its meetings, what is due on it. Days with nothing are left out. */
export function buildMarks(days: readonly string[], input: { hasNote(iso: string): boolean; meetingDays: readonly string[]; dueDays: readonly string[] }): Record<string, DayMark> {
  const shown = new Set(days);
  const out: Record<string, DayMark> = {};
  const mark = (iso: string) => (out[iso] ??= {});
  for (const iso of days) if (input.hasNote(iso)) mark(iso).note = true;
  for (const iso of input.meetingDays) if (shown.has(iso)) mark(iso).meetings = (out[iso]?.meetings ?? 0) + 1;
  for (const iso of input.dueDays) if (shown.has(iso)) mark(iso).due = (out[iso]?.due ?? 0) + 1;
  return out;
}

// ── The day's note, made on its first words ──────────────────────────────────────────────────────────────────────────

/**
 * The day's note on its first words: the daily template (already filled in), with what was typed under its Notes (or
 * Inbox) heading when it has one, else at the end; and where the cursor goes (the end of what was typed). The note is
 * made only once something is typed, so empty daily notes never pile up.
 */
export function firstWords(template: string, typed: string): { text: string; cursor: number } {
  // The template's own line ends stay (Nov 2026 audit: a Windows template came back LF); the heads match by word, so
  // "Notes for Tuesday" and "Notes:" count while "Noteworthy" never does.
  const eol = template.includes('\r\n') ? '\r\n' : '\n';
  const words = typed.replace(/\r\n/g, '\n');
  const t = template.replace(/\r\n/g, '\n');
  const done = (text: string, cursor: number) =>
    eol === '\n' ? { text, cursor } : { text: text.split('\n').join(eol), cursor: cursor + (text.slice(0, cursor).match(/\n/g) ?? []).length };
  if (!t.trim()) return done(words, words.length);
  const lines = t.split('\n');
  const at = lines.findIndex((l) => /^#{1,6}\s+(notes|inbox|captured|today)\b/i.test(l));
  if (at >= 0) {
    // Under the heading, before its blank lines run into the next one.
    let end = at + 1;
    while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end++;
    let last = end;
    while (last > at + 1 && !lines[last - 1].trim()) last--;
    const before = `${lines.slice(0, last).join('\n')}\n${words}`;
    const rest = lines.slice(last);
    while (rest.length && !rest[0].trim()) rest.shift();
    return done(rest.length ? `${before}\n\n${rest.join('\n')}` : `${before}\n`, before.length);
  }
  const base = t.replace(/\s*$/, '');
  const before = `${base}\n\n${words}`;
  return done(`${before}\n`, before.length);
}

// ── New meeting ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A new meeting note for a day: typed a meeting, dated, with the headings meeting actions read (src/shared/meetings.ts). */
export function meetingNoteText(iso: string, todayIso: string): string {
  return ['---', 'type: meeting', `date: ${iso}`, 'attendees: []', '---', `**When:** ${longDay(iso, todayIso)}`, '', '## Agenda', '- ', '', '## Notes', '', '', '## Actions', '- [ ] ', ''].join('\n');
}

/**
 * A meeting's name under its own day, without the date the day already shows (20 Oct 2026: "2026-10-20 Site walk with
 * Dave" sat under Tuesday 20 October): a leading or trailing date naming that day — 2026-10-20, 20 Oct 2026 — goes, with
 * the dash or comma beside it; a name that is only the date ("Meeting 20 Oct 2026") reads "Meeting".
 */
export function meetingTitle(title: string, iso: string): string {
  const d = dateOf(iso), month = MONTH_NAMES[d.getMonth()];
  const day = `(?:${iso}|${d.getDate()}(?:st|nd|rd|th)? (?:${month.slice(0, 3)}|${month})\\.?,? ${d.getFullYear()})`;
  const cut = title.replace(new RegExp(`^\\s*${day}\\s*[-–—:,]?\\s*`, 'i'), '').replace(new RegExp(`\\s*[-–—:,(]?\\s*${day}\\)?\\s*$`, 'i'), '').trim();
  return cut || title;
}

/** The new meeting's name: "Meeting 20 Oct 2026". */
export function meetingName(iso: string): string {
  const d = dateOf(iso);
  return `Meeting ${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

// ── What Today shows (Settings › Appearance › Interface) ─────────────────────────────────────────────────────────────

/**
 * What is hidden on Today. Home folded into Today (20 Oct 2026): someone who chose Home keeps what they chose there —
 * the quick actions, the projects that need them (Today's At risk) and the notes changed lately (the day's
 * activity) — and the project lists Home never showed them (due, waiting, changed since yesterday) start off; they can
 * switch them on in Settings. Someone who chose Today keeps their choices as they were. (The ask-box pair went on
 * 4 Nov 2026 with the middle box; anyone who had hidden it simply has no box now.)
 */
export function todayHidden(prefs: Pick<Prefs, 'hidden' | 'today'>): Hideable[] {
  if (prefs.today !== false) return prefs.hidden;
  const hidden = new Set<Hideable>(prefs.hidden.filter((h) => !h.startsWith('today:') && !h.startsWith('home:')));
  const from: [Hideable, Hideable][] = [
    ['home:actions', 'today:actions'],
    ['home:projects', 'today:risk'],
    ['home:recent', 'today:activity'],
  ];
  for (const [home, today] of from) if (prefs.hidden.includes(home)) hidden.add(today);
  for (const off of ['today:due', 'today:waiting', 'today:changed'] as const) hidden.add(off);
  return [...hidden];
}
