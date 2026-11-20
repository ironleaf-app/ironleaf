// A shared space's home, read the same way on every door (10.0 item 26, 2 Nov 2026: a household or small team sharing
// one bot and one Vault space). The space is one folder of the vault; a bot that looks after it (the former host
// app's vault 'space') writes the marker below when it first writes, so old spaces gain one on their next write and
// nothing else must be migrated. Ironleaf's window, the former host app's Bot space and the /today answer on the
// phone all read through here (the former host app gets a built copy, see tools/build-embedded.mjs), so the three can
// never disagree.
//
//   Who owes what is the Tasks view's own convention (src/shared/tasks.ts): a task naming [[Sam]] is Sam's; a task
//   naming nobody is for everyone. Shared dates are the space's dated tasks and ⏰ reminders due by the end of the
//   week; a space bot's calendar stays conversational (it is not in the notes, so no door can read it the same way).
//
// Pure: the callers read the notes (Ironleaf's main side, the former host app's space tools) and pass their texts
// with the day in the bot's own zone; the tests fix the day (tests/shared-space.test.mjs).

import { dueGroup, findAllTasks } from './tasks';

export const SPACE_MARKER = '.shared-space.json';
export const SPACE_MARKER_VERSION = 1;

/** The marker a space bot leaves in its folder: which bot looks after it. Anything else in the file is ignored. */
export function parseSpaceMarker(text: string): { bot: string } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(String(text ?? ''));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const bot = (raw as { bot?: unknown }).bot;
  if (typeof bot !== 'string' || !bot.trim()) return null;
  return { bot: bot.trim().slice(0, 80) };
}

/** The space's name as people see it: the folder's last part (Home/Our planning reads Our planning). */
export function spaceName(folder: string): string {
  const last = String(folder ?? '').replace(/\\/g, '/').split('/').map((s) => s.trim()).filter(Boolean).pop() || '';
  return last.slice(0, 80);
}

/** A link's name as people see it: the last part, no .md (People/Sam.md reads Sam). */
export function linkName(link: string): string {
  const last = String(link ?? '').replace(/\\/g, '/').split('/').pop()?.trim() || '';
  return last.replace(/\.md$/i, '').slice(0, 80);
}

export interface SpaceNoteInput {
  /** The note's path in the vault (Home/Our planning/Shopping.md). */
  path: string;
  /** The note's name as people see it. */
  title: string;
  content: string;
}

export interface SpaceTask {
  path: string;
  title: string;
  /** The line from 0, for a tick written back. */
  line: number;
  /** The words after the box, as written (to find the line again). */
  text: string;
  /** The words to show. */
  words: string;
  done: boolean;
  due: string | null;
  time: string | null;
  /** A ⏰ reminder line. */
  reminder: boolean;
  /** The people it names ([[links]]), as written. */
  people: string[];
}

export interface SpaceOwes {
  who: string;
  tasks: SpaceTask[];
}

/** A shared space as the list shows it: its folder, its bot, and how much is open. */
export interface SharedSpaceListItem {
  folder: string;
  name: string;
  bot: string;
  open: number;
  dueToday: number;
  overdue: number;
}

export interface SpaceSummary {
  folder: string;
  name: string;
  notes: { path: string; title: string; open: number; done: number }[];
  /** Every open task and reminder, soonest due first. */
  open: SpaceTask[];
  /** The open ⏰ reminders, soonest first. */
  reminders: SpaceTask[];
  /** Open tasks by who they name, most owed first. */
  owes: SpaceOwes[];
  /** Open tasks naming nobody. */
  everyone: SpaceTask[];
  counts: { notes: number; open: number; overdue: number; dueToday: number; reminders: number };
}

const byDue = (a: SpaceTask, b: SpaceTask): number => {
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  return (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.title.localeCompare(b.title) || a.line - b.line;
};

/** Every task and reminder in the space's notes, gathered the one way, for the day given (YYYY-MM-DD). */
export function summariseSpace(folder: string, notes: SpaceNoteInput[], today: string): SpaceSummary {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : '';
  const ref = day ? new Date(`${day}T12:00:00`) : new Date();
  const open: SpaceTask[] = [];
  const noteRows: SpaceSummary['notes'] = [];
  for (const n of notes) {
    let o = 0;
    let d = 0;
    for (const t of findAllTasks(n.content, ref)) {
      const task: SpaceTask = { path: n.path, title: n.title, line: t.line, text: t.text, words: t.words || t.text.trim(), done: t.done, due: t.due, time: t.time, reminder: t.reminder, people: [...new Set(t.links.map(linkName).filter(Boolean))] };
      if (t.done) d++;
      else {
        o++;
        open.push(task);
      }
    }
    noteRows.push({ path: n.path, title: n.title, open: o, done: d });
  }
  open.sort(byDue);
  const reminders = open.filter((t) => t.reminder);
  const byWho = new Map<string, SpaceTask[]>();
  const everyone: SpaceTask[] = [];
  for (const t of open) {
    if (!t.people.length) everyone.push(t);
    else for (const who of t.people) {
      const list = byWho.get(who) ?? [];
      list.push(t);
      byWho.set(who, list);
    }
  }
  const owes: SpaceOwes[] = [...byWho.entries()].map(([who, tasks]) => ({ who, tasks: [...tasks].sort(byDue) })).sort((a, b) => b.tasks.length - a.tasks.length || a.who.localeCompare(b.who));
  const overdue = open.filter((t) => dueGroup(t, day) === 'overdue').length;
  const dueToday = open.filter((t) => dueGroup(t, day) === 'today').length;
  return { folder, name: spaceName(folder), notes: noteRows.sort((a, b) => a.title.localeCompare(b.title)), open, reminders, owes, everyone, counts: { notes: notes.length, open: open.length, overdue, dueToday, reminders: reminders.length } };
}

const MAX_DATES = 8;
const MAX_OPEN = 10;
const MAX_OWES = 4;
const MAX_WHO = 5;

// Whole words: space lines wrap where they show (t207 pass 2).
const oneLine = (text: string, _max: number): string => {
  const v = String(text ?? '').replace(/\s+/g, ' ').trim();
  return v;
};

const md = (text: string): string => String(text ?? '').replace(/[_*`[\]]/g, (m) => `\\${m}`);

/** Task words for reading aloud: [[Sam]] and [[People/Sam|Sam]] read as Sam, the rest as written. */
export function showWords(words: string): string {
  return String(words ?? '').replace(/\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (_m, target, label) => linkName(label || target || ''));
}

const whenWords = (t: SpaceTask, today: string): string => {
  if (!t.due) return t.title;
  const group = dueGroup(t, today);
  const [y, mo, d] = t.due.split('-').map(Number);
  const day = new Date(y, mo - 1, d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  if (group === 'overdue') return `overdue since ${day}${t.time ? ` ${t.time}` : ''} · ${t.title}`;
  if (group === 'today') return t.time ? `today ${t.time} · ${t.title}` : `today · ${t.title}`;
  return `${day}${t.time ? ` ${t.time}` : ''} · ${t.title}`;
};

/** The Shared Today words for the phone (and anywhere else words are wanted): shared dates, open tasks, who owes
 *  what. Every cut says how much more and where the rest lives (the space itself). Telegram markdown. */
export function sharedTodayWords(summary: SpaceSummary, today: string, dayWords: string): string {
  const lines = [`**Shared today** · ${md(summary.name)}`, md(dayWords)];
  const dated = summary.open.filter((t) => t.due && ['overdue', 'today'].includes(dueGroup(t, today)));
  if (dated.length) {
    lines.push('', '**Dates**');
    for (const t of dated.slice(0, MAX_DATES)) lines.push(`- ${md(oneLine(showWords(t.words), 120))} · ${md(whenWords(t, today))}`);
    if (dated.length > MAX_DATES) lines.push(`- Plus ${dated.length - MAX_DATES} more dates in the space.`);
  }
  lines.push('', summary.open.length ? `**Open (${summary.open.length})**` : '**Open**');
  if (!summary.open.length) lines.push('Nothing is open in the shared space.');
  for (const t of summary.open.slice(0, MAX_OPEN)) lines.push(`- ${md(oneLine(showWords(t.words), 120))}${t.due ? ` · ${md(whenWords(t, today))}` : ` · ${md(t.title)}`}`);
  if (summary.open.length > MAX_OPEN) lines.push(`- Plus ${summary.open.length - MAX_OPEN} more in the space.`);
  if (summary.owes.length || summary.everyone.length) {
    lines.push('', '**Who owes what**');
    for (const o of summary.owes.slice(0, MAX_WHO)) {
      lines.push(`${md(o.who)} owes:`);
      for (const t of o.tasks.slice(0, MAX_OWES)) lines.push(`- ${md(oneLine(showWords(t.words), 100))}${t.due ? ` · ${md(whenWords(t, today))}` : ''}`);
      if (o.tasks.length > MAX_OWES) lines.push(`- Plus ${o.tasks.length - MAX_OWES} more for ${md(o.who)} in the space.`);
    }
    if (summary.owes.length > MAX_WHO) lines.push(`Plus ${summary.owes.length - MAX_WHO} more people with tasks in the space.`);
    if (summary.everyone.length) {
      lines.push('For everyone:');
      for (const t of summary.everyone.slice(0, MAX_OWES)) lines.push(`- ${md(oneLine(showWords(t.words), 100))}${t.due ? ` · ${md(whenWords(t, today))}` : ''}`);
      if (summary.everyone.length > MAX_OWES) lines.push(`- Plus ${summary.everyone.length - MAX_OWES} more for everyone in the space.`);
    }
  }
  return lines.join('\n');
}
