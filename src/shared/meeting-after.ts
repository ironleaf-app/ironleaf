// The meeting after-flow (10.0 item 19: "a meeting note that finishes itself"). Two small joins the meeting doors
// (the note's panel and the Meetings place) share, so both behave the same: meeting actions filed one tap into Tasks
// (their line becomes a tick box in the meeting note, which Tasks and Due already read) and reminders (a ⏰ line in
// Reminders.md, the one home, written the assistant's own way), each once; and the nudge Today shows once after a
// meeting with what is left open. Pure: the doors apply these to the notes and write them.
//
// Why Reminders.md and not the meeting line: a ⏰ moment on the meeting line would be read back into the action's who
// (readAction keeps it as words), and decision 5 keeps everything new in Reminders. Re-offers are suppressed by
// reading the homes, never by a mark.

import { isIsoDay } from './hub';
import { spanWords } from './days';
import { FILED_MARK } from './meetings';
import { isPrivatePath } from './private';
import { DEFAULT_HOUR, REMINDER_HOMES, appendReminderLine, findSameReminder, meetingReminderLine, nearReminder } from './reminders';
import { meetingTaskLine, parseTaskLine } from './tasks';

/** Whether a meeting's actions may file reminders into Reminders.md: never from a private note (its words would leave
 *  the locked place). Filing into Tasks stays in the note itself, so it is always allowed. */
export const mayFileReminders = (meetingPath: string): boolean => !isPrivatePath(meetingPath);

/** Days after a meeting its after-flow still nudges (past a fortnight it is history, not after-flow). */
export const AFTERFLOW_DAYS = 14;
/** Every finished meeting with open actions nudges in the one folded row (9 Nov 2026, break job: the old cap
 *  of three hid meetings with no signal once the nudges folded into one row, so a fourth and fifth meeting
 *  never showed. Most recent first, no cap: the row opens Meetings where all list). */

export interface AfterflowMeeting<A extends { what: string; done: boolean } = { what: string; done: boolean }> {
  path: string;
  title: string;
  date: string;
  dated: boolean;
  actions: readonly A[];
}

export interface AfterflowNudge {
  path: string;
  title: string;
  date: string;
  /** Actions still open, and all of them. */
  open: number;
  total: number;
}

const isoDaysAgo = (today: string, n: number): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const d = new Date(`${today}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The meetings Today nudges about once: dated, past, within a fortnight, with actions still open. `done` counts a
 *  filed action ticked in its project as done too (the doors pass their own reading). Most recent first. */
export function meetingsNeedingAfterflow<A extends { what: string; done: boolean }>(
  meetings: readonly AfterflowMeeting<A>[],
  today: string,
  done: (a: A) => boolean = (a) => a.done,
): AfterflowNudge[] {
  const cutoff = isoDaysAgo(today, AFTERFLOW_DAYS);
  return meetings
    .filter((m) => m.dated && m.date && m.date < today && (cutoff === null || m.date >= cutoff))
    .map((m) => ({ path: m.path, title: m.title, date: m.date, open: m.actions.filter((a) => !done(a)).length, total: m.actions.length }))
    .filter((m) => m.open > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

const bareTitle = (t: string) => t.replace(/^\d{4}-\d{2}-\d{2}\s*/, '') || t;

/** When the meeting finished, in plain words ("yesterday", "3 days ago"). */
function finishedAgo(date: string, today: string): string {
  const yesterday = isoDaysAgo(today, 1);
  if (yesterday !== null && date === yesterday) return 'yesterday';
  const end = new Date(today + 'T12:00:00').getTime();
  const start = new Date(date + 'T12:00:00').getTime();
  if (Number.isFinite(end) && Number.isFinite(start) && end > start) return `${spanWords(Math.max(2, Math.round((end - start) / 86_400_000)))} ago`;
  return 'recently';
}

/** One nudge in plain words: "Harbour review finished yesterday. 2 actions still open." */
export function afterflowWords(n: AfterflowNudge, today: string): string {
  return `${bareTitle(n.title)} finished ${finishedAgo(n.date, today)}. ${n.open} ${n.open === 1 ? 'action' : 'actions'} still open.`;
}

/** The nudge's second line on Today (its title sits above it): "Finished yesterday. 2 actions still open." */
export function afterflowSub(n: AfterflowNudge, today: string): string {
  return `Finished ${finishedAgo(n.date, today)}. ${n.open} ${n.open === 1 ? 'action' : 'actions'} still open.`;
}

/** Today's one folded row for the finished meetings (8 Nov 2026, calm list): "3 meetings finished with
 *  actions still open", opening Meetings. None is no row (the caller renders nothing). */
export function afterflowFoldWords(count: number): string {
  return count === 1 ? '1 meeting finished with actions still open' : `${count} meetings finished with actions still open`;
}

// ── Into Tasks ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FilePick {
  /** Its line in the note, and the line as written (so a moved line is never misapplied). */
  line: number;
  raw: string;
  what: string;
  who?: string;
  /** Its day (YYYY-MM-DD), when one was read. */
  due?: string;
}

export interface FileResult {
  text: string;
  added: number;
  /** Already a tick box (filing twice files once). */
  already: number;
  /** Its line is gone from the note (moved on; said, never misapplied). */
  moved: number;
}

/** The line an action is on now: where it was, else the line still holding its words. */
function locate(lines: string[], line: number, raw: string): number {
  if (lines[line] === raw) return line;
  return lines.findIndex((l) => l === raw);
}

/** The picks filed into Tasks: each plain-line action converted to a tick box in place (a filed mark stays on the
 *  line, so it is still one action with its project). Lines already tick boxes are left alone and counted. */
export function fileActionsToTasks(text: string, picks: readonly FilePick[]): FileResult {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const used = new Set<number>();
  let added = 0;
  let already = 0;
  let moved = 0;
  for (const p of picks) {
    const at = locate(lines, p.line, p.raw);
    if (at < 0 || used.has(at)) {
      if (at < 0) moved++;
      else already++;
      continue;
    }
    used.add(at);
    if (parseTaskLine(lines[at])) {
      already++;
      continue;
    }
    const filed = FILED_MARK.exec(lines[at]);
    lines[at] = meetingTaskLine({ what: p.what, ...(p.who ? { who: p.who } : {}), ...(p.due ? { due: p.due } : {}) }) + (filed ? ` ${filed[0].trim()}` : '');
    added++;
  }
  return { text: lines.join(eol), added, already, moved };
}

// ── Remind me ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ReminderPick {
  what: string;
  who?: string;
  /** Its moment (ms): the action's day at 9:00 am, or the day the person gave. */
  at: number;
}

export interface ReminderHomes {
  reminders: string | null;
  inbox: string | null;
}

/** An action's day at 9:00 am, the time reminders use when no time was said (null: no day to set). */
export function actionReminderAt(dueIso: string | undefined, _now: Date = new Date()): number | null {
  if (!dueIso || !isIsoDay(dueIso)) return null;
  const [y, mo, d] = dueIso.split('-').map(Number);
  return new Date(y, mo - 1, d, DEFAULT_HOUR, 0).getTime();
}

/** What filing into Tasks did, in one line (both doors say it the same way). */
export function tasksFiledWords(r: Pick<FileResult, 'added' | 'already' | 'moved'>): string {
  const bits: string[] = [];
  if (r.added) bits.push(`Added ${r.added === 1 ? '1 action' : `${r.added} actions`} to Tasks`);
  if (r.already) bits.push(`${r.already === 1 ? '1 was' : `${r.already} were`} already in Tasks`);
  if (r.moved) bits.push(`${r.moved === 1 ? '1 line' : `${r.moved} lines`} moved on and ${r.moved === 1 ? 'was' : 'were'} left alone`);
  if (!bits.length) return 'Nothing to file.';
  return `${bits.join('. ')}.`;
}

/** What reminding did, in one line (both doors say it the same way). */
export function remindersSetWords(r: { set: number; already: number; past: number }): string {
  const bits: string[] = [];
  if (r.set) bits.push(`Set ${r.set === 1 ? '1 reminder' : `${r.set} reminders`}`);
  if (r.already) bits.push(`${r.already === 1 ? '1 was' : `${r.already} were`} already set`);
  if (r.past) bits.push(`${r.past === 1 ? '1 day has' : `${r.past} days have`} already passed, so no reminder was set for ${r.past === 1 ? 'it' : 'them'}`);
  if (!bits.length) return 'Nothing to remind.';
  return `${bits.join('. ')}.`;
}

/** The picks as reminder lines for Reminders.md: each once. The same reminder already set in any home, a near one at
 *  the same moment, and twins within the picks themselves are counted already, never written twice. */
export function reminderLinesForActions(picks: readonly ReminderPick[], homes: ReminderHomes): { lines: string[]; already: number } {
  const lines: string[] = [];
  let already = 0;
  let virtual: string | null = homes.reminders;
  for (const p of picks) {
    const full = p.who?.trim() ? `${p.what} — ${p.who.trim()}` : p.what;
    const notes = [
      ...(virtual !== null ? [{ path: REMINDER_HOMES[0], content: virtual }] : []),
      ...(homes.inbox !== null ? [{ path: REMINDER_HOMES[1], content: homes.inbox }] : []),
    ];
    if (findSameReminder(notes, full, p.at) || nearReminder(notes, full, p.at)) {
      already++;
      continue;
    }
    const line = meetingReminderLine(p.what, p.who, p.at);
    lines.push(line);
    virtual = appendReminderLine(virtual, line);
  }
  return { lines, already };
}
