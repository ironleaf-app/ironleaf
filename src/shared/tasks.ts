// Tasks across the notes (21 Oct 2026, gap G24: "a vault-wide task list with due dates and filters"). Every tick-box line
// in every note — open and done, a project's own next steps and reminders too — gathered into one list the Tasks view
// shows, filtered by open or done, when it is due (today, overdue, this week, no date), the project it belongs to, the
// people it names (links to People notes) and its tags, and sorted by when it is due.
//
// The one plain way Ironleaf writes a due day is "📅 2026-10-24", with a time when there is one: "📅 2026-10-24 15:00"
// (docs/TASKS.md). The other ways people and other apps write it are read too (src/shared/hub.ts readTaskDue): "due::",
// "[due:: …]", "due:2026-10-24", "@due(…)", "— by 24 Oct 2026", "(due Fri 24 Oct)", a link to the day's note, and a
// reminder's "⏰ 2026-10-24 09:00". A task with a day and a time can become a reminder (the ⏰ format of
// src/shared/reminders.ts), so it is said at its time.
//
// Pure: the main side reads the notes and gathers them (src/main/tasks.ts), the window filters and draws them
// (src/renderer/src/views/TasksView.tsx), and the tests check them (tests/tasks.test.mjs).

import { DAY_PHRASE, readDay } from './days';
import { isBoxDone } from './finished';
import { isIsoDay, isoOf, isStaleDay, readTaskDue, splitDueMarks, stripDueMarks, taskKey, weekOf } from './hub';
import { TASK_LINE, trackFence, type Fence } from './markdown';
import { isProjectProps, parseProject } from './project-file';
import { readClockTime } from './clock';
import { formatMark, parseReminderLine } from './reminders';
import { dueWords } from './meeting-notes';
import { AGENDA_HEADING, isMeetingNote, notePeople, sameWhat } from './meetings';
import { splitLineIdentity } from './one-task';
import type { TaskSource } from './unified-tasks';

// ── One line ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const TAG = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
const LINK = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]|\[[^\]\n]*\]\(([^)\s]+\.md)\)/g;

export type Priority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';
const PRIORITY_MARKS: [string, Priority][] = [
  ['🔺', 'highest'],
  ['⏫', 'high'],
  ['🔼', 'medium'],
  ['🔽', 'low'],
  ['⏬', 'lowest'],
];

export interface ParsedTask {
  /** The box says done: ticked ("[x]", "[X]") or cancelled ("[-]"). In-progress and every other mark stay open. */
  done: boolean;
  /** The box's own mark (" ", "x", "-", "/"…). */
  mark: string;
  /** The words after the box, as written (to find the line again). */
  text: string;
  /** The words to show: no due day, time or other formats' marks. */
  words: string;
  /** The day it is due (YYYY-MM-DD), or null. */
  due: string | null;
  /** The time it is due ("15:00"), when written with its day. */
  time: string | null;
  /** A reminder line (⏰): its day and time are the reminder's moment. */
  reminder: boolean;
  /** It repeats (a reminder's "every Monday"). */
  repeats: boolean;
  /** Its own #tags (without #). */
  tags: string[];
  /** The notes its words link to, as written ("Sam Okafor", "People/Sam.md"). */
  links: string[];
  priority?: Priority;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A task line's parts, or null when the line isn't a task ("- [ ] …", "* [x] …", "1. [ ] …"). */
export function parseTaskLine(line: string, ref: Date = new Date()): ParsedTask | null {
  const m = TASK_LINE.exec(line);
  if (!m || !m[4].trim()) return null;
  const text = m[4];
  const mark = m[2];
  let due: string | null;
  let time: string | null;
  let words: string;
  let repeats = false;
  const reminder = text.includes('⏰') ? parseReminderLine(line) : null;
  if (reminder) {
    const d = new Date(reminder.due);
    due = isoOf(d);
    time = reminder.timeGiven ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : null;
    words = readTaskDue(reminder.text, ref).words;
    repeats = !!reminder.repeat;
  } else {
    ({ due, time, words } = readTaskDue(text, ref));
  }
  // HTML comments are machine marks, never words for a person (plain-text.ts's rule; 7 Nov 2026, j1: a
  // meeting action's voice mark must not reach a task's title). The line's own text keeps them.
  words = (words || text.trim()).replace(/<!--[\s\S]*?-->/g, ' ').replace(/\s+/g, ' ').trim();
  const tags = [...new Set([...text.matchAll(TAG)].map((t) => t[2]))];
  const links = [...new Set([...text.matchAll(LINK)].map((l) => (l[1] ?? decodeLink(l[2])).trim()).filter((l) => l && !isIsoDay(l)))];
  const priority = PRIORITY_MARKS.find(([p]) => text.includes(p))?.[1];
  return { done: isBoxDone(mark), mark, text, words, due, time, reminder: !!reminder, repeats, tags, links, ...(priority ? { priority } : {}) };
}

function decodeLink(s: string | undefined): string {
  try {
    return decodeURIComponent(s ?? '');
  } catch {
    return s ?? '';
  }
}

/** Every task line in a note, open and done (none inside fenced code or the properties, and none under an
 *  agenda heading — 12 Nov 2026, t240: agenda text is not a task; ticking an agenda item marks it covered),
 *  with its line from 0. */
export function findAllTasks(content: string, ref: Date = new Date()): (ParsedTask & { line: number })[] {
  if (!/\[[^\]]\]/.test(content)) return [];
  const out: (ParsedTask & { line: number })[] = [];
  const lines = content.split(/\r?\n/);
  let fence: Fence | null = null;
  let inAgenda = false;
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
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) {
      inAgenda = AGENDA_HEADING.test(h[2]);
      continue;
    }
    if (inAgenda) continue;
    const t = parseTaskLine(l, ref);
    if (t) out.push({ ...t, line: i });
  }
  return out;
}

// ── Across the notes ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A task as the Tasks view lists it. */
export interface VaultTask extends ParsedTask {
  /** Which task a tick means (src/shared/hub.ts taskKey): the note and the line's words, twins counted apart. */
  key: string;
  path: string;
  /** The note's name as people see it. */
  title: string;
  line: number;
  /** The project it belongs to (its file), and its name. */
  project: string | null;
  projectName: string | null;
  /** The People notes it names (their paths). */
  people: string[];
  /** Its own tags and its note's. */
  allTags: string[];
  /** When its note last changed (ms). */
  mtime: number;
  /** Its note's type: property (for its icon). */
  type?: string;
  /** Everywhere it was written (one task, one row): small words under the row, never a second copy. */
  sources?: TaskSource[];
}

export interface TaskNoteInput {
  path: string;
  title: string;
  content: string;
  mtime: number;
  tags: string[];
  props: Record<string, unknown>;
}

export interface GatherOptions {
  /** A link's note (null: no note by that name). */
  resolve(target: string, from: string): string | null;
  /** The project a note belongs to (its file's path), when it does. */
  projectOf(path: string): string | null;
  /** A project's name (its file's path → the name people see). */
  projectName(path: string): string | null;
  /** Whether a note is a person's (a People note). */
  isPerson(path: string): boolean;
  ref?: Date;
}

/** Every task in the notes given, with its project, the people it names and its tags. */
export function gatherTasks(notes: TaskNoteInput[], opts: GatherOptions): VaultTask[] {
  const ref = opts.ref ?? new Date();
  const out: VaultTask[] = [];
  for (const n of notes) {
    const found = findAllTasks(n.content, ref);
    if (!found.length) continue;
    const isProject = isProjectProps(n.props);
    const project = isProject ? n.path : opts.projectOf(n.path);
    const projectName = project ? opts.projectName(project) : null;
    const type = typeof n.props?.type === 'string' ? n.props.type.toLowerCase().slice(0, 40) : undefined;
    const noteTags = n.tags.map((t) => t.replace(/^#/, ''));
    const seen = new Map<string, number>();
    for (const t of found) {
      const occurrence = seen.get(t.text) ?? 0;
      seen.set(t.text, occurrence + 1);
      const people = [...new Set(t.links.map((l) => opts.resolve(l, n.path)).filter((p): p is string => !!p && p !== n.path && opts.isPerson(p)))];
      out.push({ ...t, key: taskKey(n.path, t.text, occurrence), path: n.path, title: n.title, project, projectName, people, allTags: [...new Set([...t.tags, ...noteTags])], mtime: n.mtime, ...(type ? { type } : {}) });
    }
  }
  return out;
}

/** The words after a task line's box, whatever its mark (null: not a task line). */
export function anyTaskText(line: string): string | null {
  const m = TASK_LINE.exec(line);
  return m ? m[4] : null;
}

/** The line holding a task: where it was, else the nearest line with the same words (lines above it changed). */
export function locateAnyTask(lines: string[], line: number, text: string): number {
  const same = (i: number) => anyTaskText(lines[i] ?? '') === text;
  if (same(line)) return line;
  for (let d = 1; d < lines.length; d++) {
    if (line - d >= 0 && same(line - d)) return line - d;
    if (line + d < lines.length && same(line + d)) return line + d;
  }
  return -1;
}

/** Whether a note is a person's: typed so, or kept in People (or Contacts). */
export function isPersonNote(path: string, props: Record<string, unknown> | undefined): boolean {
  const type = typeof props?.type === 'string' ? props.type.toLowerCase() : '';
  if (type === 'person' || type === 'people' || type === 'contact') return true;
  return /(^|\/)(people|contacts)\//i.test(path);
}

const KNOWN_MAX = 500;

/** People the vault knows, from its note metas: People's own notes (their names), project owners, meeting
 *  attendees (properties, and — with `content` — the "Who came" line) and meeting tick-box assignees (with
 *  `content`: whoever a meeting's boxes name after their dash). The deliberate people: a bare "— Name" tail
 *  naming nobody here is a mention, never debt (5 Nov 2026, u3 moving-in: the one owner confidence, read with
 *  isKnownOwner in src/shared/today-count.ts). At most KNOWN_MAX names; cheapest first. */
export function knownPeople(
  metas: readonly { path: string; title?: string; label?: string; props?: Record<string, unknown> }[],
  content?: (path: string) => string | undefined,
): string[] {
  const out = new Set<string>();
  const add = (raw: unknown) => {
    const name = String(raw ?? '').replace(/^\[\[|\]\]$/g, '').split('|').pop()!.trim();
    if (name && name.length >= 2 && name.length <= 80 && !/^\d+$/.test(name)) out.add(name);
  };
  for (const m of metas) {
    if (out.size >= KNOWN_MAX) break;
    if (isPersonNote(m.path, m.props)) add(m.label || m.title || m.path.split('/').pop()!.replace(/\.md$/i, ''));
    if (isProjectProps(m.props)) {
      const owner = (m.props as Record<string, unknown> | undefined)?.owner;
      if (typeof owner === 'string') add(owner);
      else if (Array.isArray(owner)) for (const o of owner) add(o);
      // Its People table too (with content): a member named in a loose line is corroborated, never a stranger.
      if (content) {
        try {
          for (const x of parseProject(content(m.path) ?? '', m.path).people) add(x.name);
        } catch {
          // A file that won't read names nobody.
        }
      }
    }
    if (isMeetingNote(m.path, m.props ?? {})) {
      for (const key of ['attendees', 'people', 'who', 'participants', 'with']) {
        const v = m.props?.[key];
        if (typeof v === 'string') for (const x of v.split(/\s*[,;]\s*/)) add(x);
        else if (Array.isArray(v)) for (const x of v) add(x);
      }
      if (content) {
        try {
          const text = content(m.path) ?? '';
          for (const x of notePeople(text, m.props ?? {})) add(x);
          // Its tick-box assignees too (t172, 9 Nov 2026: a meeting action "– Sam Okafor · by …" named Sam, but
          // Sam was nobody known, so the mention leniency read it as the person's own and Today, the brief, the
          // phone and the bot counted another person's task as theirs): a meeting assigns its work deliberately,
          // so whoever its boxes name is known. Fenced lines never name anyone; bare attributions ("me", "team",
          // "tbc", "unassigned") are not people.
          let fence: Fence | null = null;
          for (const line of text.split(/\r?\n/)) {
            const st = trackFence(line, fence);
            fence = st.fence;
            if (st.skip) continue;
            const words = anyTaskText(line);
            if (!words) continue;
            const owner = splitLineIdentity(words).owner.trim();
            if (!owner || /^(me|i|myself|you|self|mine|team|the team|tbc|tbd|unassigned)$/i.test(owner)) continue;
            add(owner);
          }
        } catch {
          // A note that won't read names nobody.
        }
      }
    }
  }
  return [...out];
}

// ── Filters ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TaskStatus = 'open' | 'done' | 'all';
/** When it is due: any time, today, overdue (open and its day passed), this week (Monday to Sunday), or no date. */
export type TaskWhen = 'any' | 'today' | 'overdue' | 'week' | 'none';
export type TaskSort = 'due' | 'note' | 'changed';

export interface TaskFilter {
  status: TaskStatus;
  when: TaskWhen;
  /** A project's file; '' for tasks in no project; undefined for any. */
  project?: string;
  /** A People note's path. */
  person?: string;
  /** A tag (without #). */
  tag?: string;
  /** Words the task or its note must have. */
  text?: string;
  sort: TaskSort;
}

export const DEFAULT_FILTER: TaskFilter = { status: 'open', when: 'any', sort: 'due' };

/** Whether a task's day passed while it is still open. */
export const isOverdue = (t: Pick<VaultTask, 'done' | 'due'>, today: string) => !t.done && !!t.due && t.due < today;

/** Whether a task matches when it is due. */
export function dueMatches(t: Pick<VaultTask, 'done' | 'due'>, when: TaskWhen, today: string): boolean {
  if (when === 'any') return true;
  if (when === 'none') return !t.due;
  if (!t.due) return false;
  if (when === 'today') return t.due === today;
  if (when === 'overdue') return isOverdue(t, today);
  const week = weekOf(today);
  return t.due >= week[0] && t.due <= week[6];
}

const lower = (s: string) => s.toLowerCase();

/** The tasks a filter keeps, in its order. */
export function filterTasks(tasks: VaultTask[], f: TaskFilter, today: string): VaultTask[] {
  const words = f.text?.trim() ? lower(f.text.trim()).split(/\s+/) : [];
  const tag = f.tag ? lower(f.tag.replace(/^#/, '')) : '';
  const kept = tasks.filter((t) => {
    if (f.status === 'open' && t.done) return false;
    if (f.status === 'done' && !t.done) return false;
    if (!dueMatches(t, f.when, today)) return false;
    if (f.project !== undefined && (f.project === '' ? t.project !== null : t.project !== f.project)) return false;
    if (f.person && !t.people.includes(f.person)) return false;
    // A tag and the tags below it: #work keeps #work/clients.
    if (tag && !t.allTags.some((x) => lower(x) === tag || lower(x).startsWith(`${tag}/`))) return false;
    if (words.length) {
      const hay = lower(`${t.words} ${t.title} ${t.projectName ?? ''}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  return sortTasks(kept, f.sort);
}

/** By due day (soonest first, then by time; tasks with no day after), by note, or by the notes changed lately. */
export function sortTasks(tasks: VaultTask[], sort: TaskSort): VaultTask[] {
  const byPlace = (a: VaultTask, b: VaultTask) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path) || a.line - b.line;
  const list = [...tasks];
  if (sort === 'note') return list.sort(byPlace);
  if (sort === 'changed') return list.sort((a, b) => b.mtime - a.mtime || byPlace(a, b));
  return list.sort((a, b) => {
    if (a.due !== b.due) {
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : 1;
    }
    return (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || byPlace(a, b);
  });
}

export interface TaskFacets {
  projects: { path: string; name: string; count: number }[];
  /** Tasks in no project. */
  noProject: number;
  people: { path: string; name: string; count: number }[];
  tags: { tag: string; count: number }[];
  counts: { open: number; done: number; overdue: number; today: number; week: number; none: number; stale: number };
}

/** What the filters offer: the projects, people and tags the tasks have (most tasks first), and how many of each kind. */
export function taskFacets(tasks: VaultTask[], today: string, nameOf: (path: string) => string): TaskFacets {
  const projects = new Map<string, { path: string; name: string; count: number }>();
  const people = new Map<string, { path: string; name: string; count: number }>();
  const tags = new Map<string, { tag: string; count: number }>();
  const counts = { open: 0, done: 0, overdue: 0, today: 0, week: 0, none: 0, stale: 0 };
  let noProject = 0;
  for (const t of tasks) {
    if (t.done) counts.done++;
    else counts.open++;
    if (t.done) continue;
    // Stale folds out of overdue (5 Nov 2026, u3 moving-in): late counts what is lately late; old lines count apart.
    if (isOverdue(t, today)) {
      if (t.due && isStaleDay(t.due, today)) counts.stale++;
      else counts.overdue++;
    }
    if (dueMatches(t, 'today', today)) counts.today++;
    if (dueMatches(t, 'week', today)) counts.week++;
    if (!t.due) counts.none++;
    if (t.project) {
      const e = projects.get(t.project) ?? { path: t.project, name: t.projectName ?? nameOf(t.project), count: 0 };
      e.count++;
      projects.set(t.project, e);
    } else noProject++;
    for (const p of t.people) {
      const e = people.get(p) ?? { path: p, name: nameOf(p), count: 0 };
      e.count++;
      people.set(p, e);
    }
    for (const tag of t.allTags) {
      const k = lower(tag);
      const e = tags.get(k) ?? { tag, count: 0 };
      e.count++;
      tags.set(k, e);
    }
  }
  const order = <T extends { count: number }>(a: T & { name?: string; tag?: string }, b: T & { name?: string; tag?: string }) => b.count - a.count || (a.name ?? a.tag ?? '').localeCompare(b.name ?? b.tag ?? '');
  return { projects: [...projects.values()].sort(order), noProject, people: [...people.values()].sort(order), tags: [...tags.values()].sort(order), counts };
}

/** "Overdue", "Today", "This week", "Later", "From a while back", "No date": the heading a task sorts under by its
 *  day. This week is the same Monday-to-Sunday week the filter keeps (Nov 2026 audit: the heading ran today+6, so a
 *  task the filter dropped sat under a week heading). Stale (5 Nov 2026, u3 moving-in): an open task more than
 *  STALE_AFTER_DAYS past folds into its own quiet group, never leading. */
export function dueGroup(t: Pick<VaultTask, 'done' | 'due'>, today: string): 'overdue' | 'today' | 'week' | 'later' | 'earlier' | 'stale' | 'none' {
  if (!t.due) return 'none';
  if (t.due === today) return 'today';
  if (t.due < today) return t.done ? 'earlier' : isStaleDay(t.due, today) ? 'stale' : 'overdue';
  const week = weekOf(today);
  return t.due >= week[0] && t.due <= week[6] ? 'week' : 'later';
}

// ── Writing a line ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Where a line's own end is: before a block id ("^abc123") at its end, so that stays last. */
function endOf(line: string): number {
  const m = /\s\^[A-Za-z0-9-]+\s*$/.exec(line);
  return m ? m.index : line.replace(/\s+$/, '').length;
}

/** A plain-words day tail note-task reads ("by fri", "due tomorrow") but hub leaves alone ("by Friday" said some
 *  other day no longer says which Friday): taken out when a canonical date is set, so the day is said once (5 Nov
 *  2026, p22: "— Priya · by fri" kept its tail beside the new 📅). Only tails (followed by the end, tags, marks, or
 *  closing punctuation, never prose; nothing with another dash or dot after it, so "failed on Friday" in the words
 *  stays), validated as real days, the person's other words untouched. */
function stripPlainTail(text: string, ref: Date = new Date()): string {
  let out = text;
  const re = new RegExp(DAY_PHRASE.source, DAY_PHRASE.flags.includes('g') ? DAY_PHRASE.flags : `${DAY_PHRASE.flags}g`);
  const found: { at: number; len: number }[] = [];
  for (const m of out.matchAll(re)) {
    const phrase = (m[1] ?? m[2] ?? m[3] ?? '').trim().replace(/^\(/, '');
    if (!phrase || !readDay(phrase, ref)) continue;
    const after = out.slice(m.index! + m[0].length);
    if (/^\s*[A-Za-z0-9]/.test(after)) continue;
    if (/[—–·]/.test(after)) continue;
    found.push({ at: m.index!, len: m[0].length });
  }
  for (let i = found.length - 1; i >= 0; i--) out = out.slice(0, found[i].at) + out.slice(found[i].at + found[i].len);
  return out.replace(/\s+[—–·-]\s*$/, '').replace(/\s{2,}/g, ' ');
}

/** A task line with its due day set (or taken off, with null), written the one plain way: "📅 2026-10-24" and, with a
 *  time, "📅 2026-10-24 15:00". Every way a day is read goes first (src/shared/hub.ts stripDueMarks: the one source),
 *  and a plain-words tail note-task reads goes too when a date is set, so an old day never comes back. Anything else
 *  on the line stays as written. A reminder's line is left alone (its ⏰ is its day), and a bad day changes nothing
 *  (the caller says so). */
export function setTaskDue(line: string, iso: string | null, time?: string | null): string {
  const m = TASK_LINE.exec(line);
  if (!m || parseReminderLine(line)) return line;
  if (iso && !isIsoDay(iso)) return line;
  const rest = iso && isIsoDay(iso) ? stripPlainTail(stripDueMarks(m[4])) : stripDueMarks(m[4]);
  let head = `${m[1]}${m[2]}${m[3]}${rest}`;
  if (iso && isIsoDay(iso)) {
    const at = endOf(head);
    const mark = ` 📅 ${iso}${time && /^\d{2}:\d{2}$/.test(time) ? ` ${time}` : ''}`;
    head = head.slice(0, at).replace(/\s+$/, '') + mark + head.slice(at);
  }
  return head.replace(/\s+$/, '');
}

/** One task line ticked or unticked (Reading's boxes, 4 Nov 2026: the one flip, so the
 *  box is all that ever changes): only the mark between the brackets moves; the
 *  words, owner and date stay as written. Anything without a box is left alone. */
export function setTaskBox(line: string, done: boolean): string {
  const m = TASK_LINE.exec(line);
  if (!m) return line;
  return `${m[1]}${done ? 'x' : ' '}${m[3]}${m[4]}`;
}

/** ): the same tail as the Tasks page splits (components/plan/plan.ts splitTaskOwner), so the words a
 *  field shows and the owner a row shows can never be two readings. */
const TASK_TAIL = /\s+[—–]\s+(.+)$/;

/** A task line's title and owner tail split (the tail with its dash, '' when none). */
export function splitTaskRest(rest: string): { title: string; tail: string } {
  const tail = TASK_TAIL.exec(rest.trimEnd());
  if (!tail) return { title: rest.trim(), tail: '' };
  return { title: rest.slice(0, tail.index).trim(), tail: rest.slice(tail.index).replace(/\s+$/, '') };
}

/** A task's words as the Done toast says them (p14-words, 4 Nov 2026: the toast showed the raw line as
 *  `Done: "…"`, now the task's words only; p16 loose ends: the owner tail went too — "Reply … – Alex" says the
 *  reply, never Alex): the owner tail off through the one task identity (src/shared/one-task.ts splitLineIdentity,
 *  the reading every door folds by; a day tail is no owner, so it stays), links as their names, Markdown marks left
 *  out, cut short with … past 50. Every door that ticks (Today, Tasks) says the toast through this. */
export function doneWords(words: string): string {
  const raw = String(words ?? '');
  const { title, owner } = splitLineIdentity(raw);
  const plain = (owner ? title : raw)
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]|#]+)(?:#[^\]]*)?\]\]/g, (_m, t: string) => t.split('/').pop() ?? t)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|==|~~|`)(.+?)\1/g, '$2')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return plain;
}

/** A task line's words as a title field opens with (4 Nov 2026): the title, owner tail, tags and marks
 *  as written; the due marks and block id off (they go back on save). Null when the line isn't a
 *  task. A day's-note link stays: it is the person's own link. */
export function taskEditableRest(line: string, ref: Date = new Date()): string | null {
  const m = TASK_LINE.exec(line);
  if (!m) return null;
  const end = endOf(line) - (m[1].length + 1 + m[3].length);
  const text = end < m[4].length ? m[4].slice(0, Math.max(0, end)) : m[4];
  return splitDueMarks(text, ref).rest;
}

/** A "by …" day ("by 24 Oct", "due 24 Oct"): rejoined with its dash when the words
 *  changed around it. "due::" and "@due" forms keep their own shape instead. */
const BYISH = /^\s*(by\b|due\b(?!::?))/i;

/** A task line with its rest replaced (the title and owner tail as the field
 *  saved them): the box, due marks (in the order written) and block id stay as
 *  they were. A "by …" mark rejoins with its dash ("·" after a tail, "—" after
 *  bare words); a mark the rest already says is not written twice. Unchanged
 *  when the line isn't a task or the rest has no title. */
export function setTaskRest(line: string, rest: string, ref: Date = new Date()): string {
  const m = TASK_LINE.exec(line);
  if (!m) return line;
  const words = rest.trim();
  if (!splitTaskRest(words).title) return line;
  const end = endOf(line);
  const tail = line.slice(end);
  const text = line.slice(m[1].length + 1 + m[3].length, end);
  const { marks } = splitDueMarks(text, ref);
  let out = words;
  marks.forEach((mark, i) => {
    if (out.includes(mark.trim())) return;
    const iso = /\d{4}-\d{2}-\d{2}/.exec(mark)?.[0];
    if (iso && out.includes(iso)) return;
    if (i === 0 && BYISH.test(mark)) out += `${splitTaskRest(out).tail ? ' · ' : ' — '}${mark.trim()}`;
    else out += mark;
  });
  return `${m[1]}${m[2]}${m[3]}${out}${tail}`;
}

/** What an owner tail carries besides its owner: tags, priorities, reminders
 *  and other marks stay when the owner changes. */
const TAIL_KEEP = /#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*|🔺|⏫|🔼|🔽|⏬|⏰\s*\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?|[✅⏳🛫➕❌]\uFE0F?\s*\d{4}-\d{2}-\d{2}/gu;

/** A task line with its owner tail set (" — Name", the tail Tasks reads as its
 *  owner): '' takes it off (a "by …" tail, tags and marks stay). The title,
 *  day and the rest stay as written. Unchanged when the line isn't a task. */
export function setTaskWho(line: string, who: string, ref: Date = new Date()): string {
  const rest = taskEditableRest(line, ref);
  if (rest === null) return line;
  const { title, tail } = splitTaskRest(rest);
  const parts = tail
    .replace(/^\s+[—–]\s+/, '')
    .split(/\s+·\s+/)
    .map((s) => s.trim());
  const by = parts.find((s) => /^by\s+.+/i.test(s));
  const kept = parts
    .filter((s) => s !== by)
    .flatMap((s) => s.match(TAIL_KEEP) ?? []);
  TAIL_KEEP.lastIndex = 0;
  const name = String(who ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (name || by) {
    const segments = [[name, ...kept].filter(Boolean).join(' '), by].filter(Boolean).join(' · ');
    return setTaskRest(line, `${title} — ${segments}`, ref);
  }
  return setTaskRest(line, kept.length ? `${title} ${kept.join(' ')}` : title, ref);
}

/** A meeting action as a task line in its note (10.0 item 19: one tap into Tasks): "- [ ] Send the quote — Sam
 *  Taylor · by 6 Nov 2026". The joins are the meeting write-up's own (src/shared/meeting-notes.ts actionLine: "—"
 *  before who, "· by …" before the day), so the meeting panel reads the line back as the same action, and Today reads
 *  its day (src/shared/hub.ts "— by …"). A day that isn't real is left off rather than written wrong. */
export function meetingTaskLine(a: { what: string; who?: string; due?: string }): string {
  const what = String(a.what ?? '').replace(/\s+/g, ' ').trim();
  const who = String(a.who ?? '').replace(/\s+/g, ' ').trim();
  const due = a.due && isIsoDay(a.due) ? a.due : null;
  const words = who ? `${what} — ${who}` : what;
  if (!due) return `- [ ] ${words}`;
  return `- [ ] ${words}${who ? ' ·' : ' —'} by ${dueWords(due)}`;
}

/** Whether a note already holds this task (10.0 item 19: filing twice files once): an open or done tick box with the
 *  same words, capitals and punctuation aside (the meetings' own sameWhat). */
export function hasTaskLike(content: string, what: string, ref: Date = new Date()): boolean {
  const want = sameWhat(what);
  if (!want) return false;
  return findAllTasks(content, ref).some((t) => sameWhat(t.words) === want || sameWhat(t.text) === want);
}

/** A task with a day turned into a reminder at its time (9:00 am when none was written, said so by the reminders): the
 *  due mark becomes "⏰ 2026-10-24 15:00". Null when the line has no day or is a reminder already. The time reads the
 *  one shared way (8.7 urgent, 30 Oct 2026), so a moment is always built, never an Invalid Date. */
export function taskToReminder(line: string, ref: Date = new Date()): string | null {
  const t = parseTaskLine(line, ref);
  if (!t || t.reminder || !t.due) return null;
  const [y, mo, d] = t.due.split('-').map(Number);
  const { hours: h, minutes: mi } = readClockTime(t.time ?? '09:00') ?? { hours: 9, minutes: 0 };
  const plain = setTaskDue(line, null);
  const at = endOf(plain);
  return `${plain.slice(0, at).replace(/\s+$/, '')} ${formatMark(new Date(y, mo - 1, d, h, mi))}${plain.slice(at)}`.replace(/\s+$/, '');
}
