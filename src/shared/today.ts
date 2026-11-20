// Today (17 Oct 2026): Ironleaf's home for a working day, built from what the project files and notes already say — never
// invented. What is due or overdue (next steps, key dates and projects' own due dates, across every project, with who),
// the projects at risk, what is waiting on other people, what changed since yesterday, today's note and meetings, and the
// automations that run today.
//
// Pure: the main side reads the notes and calls buildToday (src/main/today.ts); the window adds the files changed in each
// project's folder (read from the PC after the first paint) and the former host app's automations with the helpers below.

import { timeMinutes } from './clock';
import { formatDue } from './due-words';
import { openSteps, type Project } from './project-file';
import { FINISHED_WORDS, isFinished } from './finished';
import { healthTone } from './project-standing';
// The one count's reading (round 2): readDay, shelved, live, person and owner live in today-count.ts so the former
// host app reads the same source built; re-exported here so every importer keeps working.
import { DAY, MONTH_NAMES, isLive, isOwnText, isPerson, isShelved, isStaleOffset, ownerOf, pad, readDay, utcDay, whoIsMe, type ReadDay } from './today-count';
import type { DueEntry } from './hub';
import type { TaskSource } from './unified-tasks';
export { STALE_AFTER_DAYS, isDormantProjectText, isKnownOwner, isLive, isOwnText, isPerson, isShelved, isStaleOffset, ownerOf, projectHead, readDay, shelvedProjectText, whoIsMe, type DateStyle, type ReadDay } from './today-count';

/** A day written in the style another date was (a snoozed date keeps the file's own way of writing dates). */
export function writeDay(year: number, month: number, day: number, like: ReadDay | null, today: Date): string {
  const style = like?.style ?? 'dmy';
  const name = like?.longMonth ? MONTH_NAMES[month] : MONTH_NAMES[month].slice(0, 3);
  const showYear = like?.withYear || year !== today.getFullYear();
  if (style === 'iso') return `${year}-${pad(month + 1)}-${pad(day)}`;
  if (style === 'slash') return `${day}${like?.sep ?? '/'}${month + 1}${like?.sep ?? '/'}${like?.shortYear ? pad(year % 100) : year}`;
  if (style === 'mdy') return `${name} ${day}${showYear ? `, ${year}` : ''}`;
  return `${day} ${name}${showYear ? ` ${year}` : ''}`;
}

/**
 * A due date moved on by some days (snoozed): from the day it was due, or from today when that has passed (an overdue
 * step snoozed a day is due tomorrow, not still overdue). Written the way the file wrote it; null when it can't be read.
 */
export function snoozeDate(when: string | undefined, days: number, today: Date): string | null {
  const r = readDay(when, today);
  if (!r) return null;
  const from = r.offset < 0 ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : new Date(r.year, r.month, r.day);
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return writeDay(d.getFullYear(), d.getMonth(), d.getDate(), r, today);
}

/** "Today", "Tomorrow", "Yesterday", "3 days late", "Mon 20 Oct" (5 Nov 2026, the plan:
 *  the one reader, short form for messages — one word for late, never "overdue", no countdown). */
export function dayWords(offset: number, today: Date): string {
  const target = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return formatDue(offset, target, start, { countdown: false }).words;
}

// ── People and health ───────────────────────────────────────────────────────────────────────────────────────────────

export type Tone = 'ok' | 'warn' | 'bad' | 'none';
/** Health as a tone: the one standing's reading, the same as the Projects home's, neutral when it says nothing. */
export function toneOf(health?: string): Tone {
  return healthTone(health);
}
export const isDone = (status?: string) => isFinished(status);
// A key date over and done with (Nov 2026 audit: "Finished", "Shipped" and "Resolved" still showed as upcoming): the one
// finished list plus the date words (met, held, passed), so this can never drift from isFinished again.
const FINISHED_DATE = new RegExp(`\\b(${[...FINISHED_WORDS, 'met', 'passed', 'missed', 'held', 'happened'].join('|')})\\b`, 'i');
export const finishedDate = (status?: string) => FINISHED_DATE.test(status ?? '');

// ── What Today shows ────────────────────────────────────────────────────────────────────────────────────────────────

export interface TodayProjectInput {
  /** The project file in the notes. */
  path: string;
  /** Its text's fingerprint (an edit made from Today is refused when the file changed since). */
  version: string;
  /** When the file last changed (ms). */
  modified: number;
  project: Project;
}

export interface TodayNoteInput {
  path: string;
  title: string;
  mtime: number;
  props?: Record<string, unknown>;
}

export interface TodayFileInput {
  /** The project it belongs to (its file in the notes). */
  project: string;
  rel: string;
  name: string;
  ext: string;
  modified: number;
  /** The project's name and file version (for a project with nothing else changed). */
  projectName?: string;
  version?: string;
}

export interface TodayAutomationInput {
  id: string;
  title: string;
  status: string;
  next: number | null;
  project?: { name: string; note: string } | null;
  scheduleWords?: string;
}

export interface TodayInput {
  projects: TodayProjectInput[];
  notes: TodayNoteInput[];
  /** Today's note, by Settings › Daily notes. */
  daily?: { path: string; exists: boolean };
  /** The person's own name (else worked out from the projects' owners). */
  me?: string;
  files?: TodayFileInput[];
  automations?: TodayAutomationInput[] | null;
  /** Docs (src/shared/doc-file.ts) with when they last changed and the newest line in their Changes. */
  docs?: TodayDocInput[];
}

export interface TodayDocInput {
  path: string;
  name: string;
  mtime: number;
  about?: string;
  /** The newest line in its Changes ("18 Oct 2026 — Added the Access section"). */
  change?: string;
}

/** Where a line lives in its project file, so it can be changed from Today (src/shared/project-file.ts ProjectEdit). */
export interface TodayRef {
  project: string;
  projectName: string;
  version: string;
}

export interface DueItem extends TodayRef {
  id: string;
  /** A next step (tick it done), a key date, or the project's own due date. */
  kind: 'step' | 'date' | 'project';
  what: string;
  who?: string;
  /** Owned by someone else (it shows in Waiting on others too). */
  others: boolean;
  /** The date as the file writes it. */
  when: string;
  offset: number;
  /** Its line in the project's list (steps: What's next; dates: Key dates). */
  index?: number;
  status?: string;
  tone: Tone;
  /** Everywhere it was written, the project's own first (t249: a meeting line folded into the step reads under
   *  the row — one job, one row, its sources under it). Set by the main side; steps only. */
  sources?: TaskSource[];
}

export interface WaitingItem extends TodayRef {
  id: string;
  what: string;
  who: string;
  when?: string;
  /** Days from today when its date can be read. */
  offset: number | null;
  index: number;
  /** When the project file last changed (what "oldest" falls back on). */
  since: number;
  /** Everywhere it was written, the project's own first (t249, as DueItem.sources). Set by the main side. */
  sources?: TaskSource[];
}

/** An own step with no day (Nov 2026 audit: it vanished from Today entirely): waiting to be scheduled, never overdue. */
export interface UnscheduledItem extends TodayRef {
  id: string;
  what: string;
  who?: string;
  /** Its line in What's next. */
  index: number;
  /** Everywhere it was written, the project's own first (t249, as DueItem.sources). Set by the main side. */
  sources?: TaskSource[];
}

export interface RiskLine {
  what: string;
  level: string;
  index: number;
}

export interface AtRiskItem extends TodayRef {
  id: string;
  health?: string;
  tone: Tone;
  progress?: number;
  due?: string;
  dueOffset: number | null;
  /** Its open high (and critical) risks, highest first. */
  risks: RiskLine[];
  /** What's next there, when it has something open. */
  next?: string;
}

/** A project gone quiet (21 Oct 2026, for the morning brief): steps still open, but nothing written in it or its folder
 *  for QUIET_DAYS or more. Not at risk by its own words, so it isn't in At risk; the brief mentions it gently. */
export interface QuietItem extends TodayRef {
  id: string;
  /** Whole days since anything changed in the project or its folder's notes. */
  days: number;
  /** Its open steps, and the first of them. */
  open: number;
  next: string;
}

export type ChangeKind = 'update' | 'activity' | 'note' | 'file';
export interface ChangeLine {
  id: string;
  kind: ChangeKind;
  what: string;
  /** When (ms; an update written by day is the middle of that day). */
  at: number;
  /** An update's source document. */
  from?: string;
  /** A note to open (activity, a note in the project's folder). */
  path?: string;
  /** A file in the project's folder (from it). */
  rel?: string;
  ext?: string;
  status?: string;
  /** An update's place in the project's Updates (to open the page at it). */
  index?: number;
}
export interface ChangeGroup extends TodayRef {
  id: string;
  latest: number;
  lines: ChangeLine[];
  /** Files changed beyond the ones listed. */
  moreFiles: number;
  /** How many files changed in its folder. */
  files: number;
}

export interface MeetingItem {
  path: string;
  title: string;
  time?: string;
  attendees: string[];
}

export interface AutomationToday {
  id: string;
  title: string;
  at: number;
  project?: string;
  projectName?: string;
  words?: string;
}

export interface TodayCounts {
  overdue: number;
  today: number;
  soon: number;
  later: number;
  /** Dated more than STALE_AFTER_DAYS past: the quiet "from a while back" group, counted apart. */
  stale: number;
  atRisk: number;
  waiting: number;
  unscheduled: number;
  changed: number;
  meetings: number;
  automations: number;
}

export interface TodayData {
  /** Today, as YYYY-MM-DD. */
  date: string;
  /** Since when "changed" counts (the start of yesterday, ms). */
  since: number;
  me: string | null;
  projects: number;
  /** later: the person's own deadlines after this week, up to AHEAD_DAYS; passed: key dates whose day has gone by without
   *  being marked done (a meeting held, a quote that lapsed): to confirm, never overdue work. stale: more than
   *  STALE_AFTER_DAYS past — the quiet "from a while back" group, rendered last, never leading. */
  due: { overdue: DueItem[]; today: DueItem[]; soon: DueItem[]; later: DueItem[]; passed: DueItem[]; stale: DueItem[] };
  atRisk: AtRiskItem[];
  /** Projects gone quiet with steps open (the morning brief's; Today's own sections don't show them). */
  quiet?: QuietItem[];
  /** Dormant (finished or shelved) projects that still hold open work (dormantOpenProjects above): Today's one
   *  quiet line names them. Informs only — never counted, never ranked. */
  dormantOpen?: DormantOpen[];
  waiting: WaitingItem[];
  /** The person's own steps with no day yet (shown by the Today screen's Unscheduled list). */
  unscheduled: UnscheduledItem[];
  changed: ChangeGroup[];
  daily: { path: string; exists: boolean } | null;
  meetings: MeetingItem[];
  /** Docs changed since yesterday, newest first. */
  docs: TodayDocInput[];
  /** null: The former host app's automations can't be read (the section isn't shown). */
  automations: AutomationToday[] | null;
  counts: TodayCounts;
  /** Nothing due, overdue, at risk or waiting. */
  clear: boolean;
  /** Nothing on the person yet: no late, today, this week, coming up, waiting or unscheduled items (an empty vault's
   *  first look, 29 Oct 2026: the main column showed nothing beside the side cards). Passed dates and projects at
   *  risk are separate lists: they do not stop this being true. */
  nothingOnYou: boolean;
}

/** How far ahead "due" looks: the rest of this week and the start of the next. */
export const SOON_DAYS = 7;
/** How far ahead the person's own dated deadlines show, as Coming up (29 Oct 2026: a plan due in 15 days never showed). */
export const AHEAD_DAYS = 30;
/** Days without a change before a project with open steps counts as gone quiet. */
export const QUIET_DAYS = 14;
/** Files listed for each project's folder (the rest counted). */
export const FILES_SHOWN = 4;

/** Whole calendar days from `now` to `ms` (negative: before today), by local calendar day, never by 24 hours:
 *  across daylight saving a fixed 86,400,000 ms is a day short or long (fnv3 F15). The one day maths both
 *  landing pages label "Yesterday" with. */
export function calendarDayDiff(ms: number, now: Date): number {
  const a = new Date(ms);
  return utcDay(a.getFullYear(), a.getMonth(), a.getDate()) - utcDay(now.getFullYear(), now.getMonth(), now.getDate());
}

const folderOfNote = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
// A day moved by calendar days (Nov 2026 audit): +-24h lands an hour off across daylight saving.
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const midday = (r: ReadDay) => new Date(r.year, r.month, r.day, 12).getTime();
const RISK_ORDER = ['critical', 'high'];
const prop = (props: Record<string, unknown> | undefined, ...keys: string[]) => {
  for (const k of keys) {
    const v = props?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).replace(/^\[\[|\]\]$/g, '').trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

/** Whether a note is a meeting held today: in a Meetings folder ("Meeting Notes" too; Nov 2026 audit), or typed a meeting, dated today by its properties or name. */
export function meetingToday(note: TodayNoteInput, today: Date): boolean {
  const inMeetings = /(^|\/)(\d+[\s._-]*)?meetings?(?=[\/\s._-]|$)/i.test(folderOfNote(note.path)) || /^meeting/i.test(String(note.props?.type ?? ''));
  if (!inMeetings) return false;
  const dated = prop(note.props, 'date', 'when', 'day', 'held');
  // An unreadable property ("date: Friday") is no property: the name still names the day (fnv3 F10).
  if (dated) { const r = readDay(dated, today); if (r) return r.offset === 0; }
  const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const name = note.path.split('/').pop() ?? '';
  if (name.includes(iso)) return true;
  // A name that starts with a date ("17 Oct 2026 — Supplier call").
  return readDay(name.replace(/\.md$/i, ''), today)?.offset === 0;
}

/** The files changed in projects' folders since yesterday, as Today's "changed" lines (adds to what buildToday made). */
export function withChangedFiles(data: TodayData, files: TodayFileInput[]): TodayData {
  const fresh = files.filter((f) => f.modified >= data.since);
  if (!fresh.length) return data;
  const groups = new Map(data.changed.map((g) => [g.project, { ...g, lines: g.lines.filter((l) => l.kind !== 'file') }]));
  const byProject = new Map<string, TodayFileInput[]>();
  for (const f of fresh) byProject.set(f.project, [...(byProject.get(f.project) ?? []), f]);
  for (const [project, list] of byProject) {
    const known = groups.get(project);
    const name = known?.projectName ?? list[0].projectName;
    if (!name) continue;
    const g: ChangeGroup = known ?? { id: `chg:${project}`, project, projectName: name, version: list[0].version ?? '', latest: 0, lines: [], moreFiles: 0, files: 0 };
    const sorted = [...list].sort((a, b) => b.modified - a.modified);
    g.files = sorted.length;
    g.moreFiles = Math.max(0, sorted.length - FILES_SHOWN);
    g.lines = [...g.lines, ...sorted.slice(0, FILES_SHOWN).map((f): ChangeLine => ({ id: `file:${project}:${f.rel}`, kind: 'file', what: f.name, at: f.modified, rel: f.rel, ext: f.ext }))].sort((a, b) => b.at - a.at);
    g.latest = Math.max(g.latest, sorted[0].modified);
    groups.set(project, g);
  }
  const changed = [...groups.values()].sort((a, b) => b.latest - a.latest || a.projectName.localeCompare(b.projectName));
  return { ...data, changed, counts: { ...data.counts, changed: changed.reduce((n, g) => n + g.lines.filter((l) => l.kind !== 'file').length + g.files, 0) } };
}

/** The former host app's automations that run today (switched on, their next time before midnight), soonest
first. */
export function automationsToday(list: TodayAutomationInput[] | null | undefined, now: Date): AutomationToday[] | null {
  if (!list) return null;
  const end = startOfDay(addDays(now, 1));
  return list
    .filter((a) => (a.status === 'on' || a.status === 'reminder') && typeof a.next === 'number' && a.next >= now.getTime() - 60_000 && a.next < end)
    .sort((a, b) => a.next! - b.next!)
    .map((a) => ({ id: a.id, title: a.title, at: a.next!, ...(a.project ? { project: a.project.note, projectName: a.project.name } : {}), ...(a.scheduleWords ? { words: a.scheduleWords } : {}) }));
}

/** A dormant (finished or shelved) project that still holds open work the person may need. */
export interface DormantOpen {
  project: string;
  projectName: string;
  /** Finished (its page's "loose ends") rather than shelved (parked "open tasks"). */
  finished: boolean;
  /** How many open steps need the person (below). */
  open: number;
}

/** Dormant projects that still hold open work (Nov 2026, b6 break job: finished and on-hold projects count
 *  nowhere, but "a task they needed" must still reach the person — Today carries one quiet line naming these).
 *  A finished project names every open step (finished should hold none: any is an answer waiting); a shelved
 *  one names only open steps falling due within the week, fresh-late ones included (parked dateless and stale
 *  work stays quiet — parked on purpose — and timed reminders fire on their own). Days read as the day lists
 *  read them (ownerOf, readDay); ownership lives on the project page, as its "loose ends" line counts them. */
export function dormantOpenProjects(projects: Pick<TodayProjectInput, 'path' | 'project'>[], now: Date = new Date()): DormantOpen[] {
  const out: DormantOpen[] = [];
  for (const x of projects ?? []) {
    const status = x?.project?.status;
    if (!status || isLive(status)) continue;
    const finished = isFinished(status);
    let open = 0;
    for (const n of x.project.next ?? []) {
      if (n?.done) continue;
      if (finished) {
        open++;
        continue;
      }
      if (!isShelved(status)) continue;
      const { when } = ownerOf(n.who, n.when, now);
      const r = readDay(when, now);
      if (r && !isStaleOffset(r.offset) && r.offset <= SOON_DAYS) open++;
    }
    if (open) out.push({ project: x.path, projectName: x.project.name, finished, open });
  }
  return out;
}

/** One dormant project's open count in words ("3 loose ends", "1 open task"): the project page's own, shared
 *  by the quiet line and its menu. */
export function dormantOpenCountWords(d: Pick<DormantOpen, 'finished' | 'open'>): string {
  return `${d.open} ${d.finished ? `loose end${d.open === 1 ? '' : 's'}` : `open task${d.open === 1 ? '' : 's'}`}`;
}

/** The quiet line's words, in the project page's own ("N loose ends" finished, "N open tasks" shelved):
 *  "Harbour Kiosk still has 3 loose ends · Night Market still has 1 open task". Past three, the rest fold
 *  into "and N more" (the line still opens the whole list). */
export function dormantOpenWords(list: readonly DormantOpen[]): string {
  const items = (list ?? []).filter((d) => d && d.open > 0);
  if (!items.length) return '';
  const one = (d: DormantOpen): string => `${d.projectName} still has ${dormantOpenCountWords(d)}`;
  if (items.length <= 3) return items.map(one).join(' · ');
  return `${items.slice(0, 3).map(one).join(' · ')} and ${items.length - 3} more`;
}

/** Everything Today shows, from the projects and notes (and, when given, the folders' files and the automations). */
export function buildToday(input: TodayInput, now: Date = new Date()): TodayData {
  const since = startOfDay(addDays(now, -1));
  const live = input.projects.filter((x) => isLive(x.project.status));
  const me = whoIsMe(input.projects.map((x) => x.project), input.me);
  const overdue: DueItem[] = [];
  const dueToday: DueItem[] = [];
  const soon: DueItem[] = [];
  const waiting: WaitingItem[] = [];
  const unscheduled: UnscheduledItem[] = [];
  const atRisk: AtRiskItem[] = [];
  const changed: ChangeGroup[] = [];
  // The notes changed since yesterday, by the project folder they are in (one pass, however many projects).
  const dirs = new Set(live.map((x) => folderOfNote(x.path)).filter(Boolean));
  const notesIn = new Map<string, TodayNoteInput[]>();
  for (const n of input.notes) {
    if (n.mtime < since) continue;
    for (let d = folderOfNote(n.path); d; d = folderOfNote(d))
      if (dirs.has(d)) {
        notesIn.set(d, [...(notesIn.get(d) ?? []), n]);
        break;
      }
  }
  const later: DueItem[] = [];
  const passed: DueItem[] = [];
  const stale: DueItem[] = [];
  const place = (item: DueItem) => (isStaleOffset(item.offset) ? stale : item.offset < 0 ? overdue : item.offset === 0 ? dueToday : item.offset <= SOON_DAYS ? soon : later).push(item);
  // The newest change among each project folder's notes, for projects gone quiet.
  const quiet: QuietItem[] = [];
  const latestIn = new Map<string, number>();
  for (const n of input.notes)
    for (let d = folderOfNote(n.path); d; d = folderOfNote(d))
      if (dirs.has(d)) {
        latestIn.set(d, Math.max(latestIn.get(d) ?? 0, n.mtime));
        break;
      }

  for (const x of live) {
    const p = x.project;
    const ref: TodayRef = { project: x.path, projectName: p.name, version: x.version };
    // The days this project's own steps fall on: a key date on the same day is the same thing, shown once.
    const stepDays = new Set<number>();
    const tone = toneOf(p.health);
    // Steps open, with a day: due; with someone else's name: waiting on them.
    p.next.forEach((n, index) => {
      if (n.done) return;
      const { who, when } = ownerOf(n.who, n.when, now);
      const r = readDay(when, now);
      const others = !!who && (me ? !isPerson(who, me) : !isPerson(who, p.owner));
      // Someone else's step is waiting on them, never the person's own overdue or due work (29 Oct 2026, the vault:
      // the coach's and Claude's steps sat in their overdue list).
      if (others) {
        waiting.push({ ...ref, id: `wait:${x.path}:${index}`, what: n.what, who: who!, ...(when ? { when } : {}), offset: r?.offset ?? null, index, since: x.modified });
        return;
      }
      if (r && r.offset <= AHEAD_DAYS) {
        stepDays.add(r.offset);
        place({ ...ref, id: `step:${x.path}:${index}`, kind: 'step', what: n.what, ...(who ? { who } : {}), others, when: when!, offset: r.offset, index, tone });
      } else if (!r) {
        unscheduled.push({ ...ref, id: `unsched:${x.path}:${index}`, what: n.what, ...(who ? { who } : {}), index });
      }
    });
    // Key dates still to come, or passed while unfinished: passed ones are asked about once under the day's
    // lists (with a status or without — the project page asks about both in toConfirm, so Today does too).
    p.dates.forEach((d, index) => {
      if (finishedDate(d.status)) return;
      const r = readDay(d.when, now);
      if (!r || r.offset > SOON_DAYS || stepDays.has(r.offset)) return;
      const item: DueItem = { ...ref, id: `date:${x.path}:${index}`, kind: 'date', what: d.what, others: false, when: d.when, offset: r.offset, index, ...(d.status ? { status: d.status } : {}), tone };
      // A key date that has gone by is something that happened (or lapsed), not work that is late: it is asked about
      // once, under the day's lists, never counted as overdue (29 Oct 2026: 42 "overdue", most of them meetings held).
      if (r.offset < 0) passed.push(item);
      else place(item);
    });
    // The project's own due date (unless a key date on the same day already says so).
    const due = readDay(p.due, now);
    if (due && due.offset <= (isPerson(p.owner ?? '', me ?? p.owner) ? AHEAD_DAYS : SOON_DAYS) && !p.dates.some((d) => !finishedDate(d.status) && readDay(d.when, now)?.offset === due.offset)) place({ ...ref, id: `due:${x.path}`, kind: 'project', what: `${p.name} is due`, others: false, when: p.due!, offset: due.offset, tone });

    // At risk: off track or at risk, or holding an open high risk.
    const risks = p.risks
      .map((r, index) => ({ what: r.what, level: (r.level ?? '').toLowerCase(), index, closed: r.closed }))
      .filter((r) => !r.closed && RISK_ORDER.includes(r.level))
      .sort((a, b) => RISK_ORDER.indexOf(a.level) - RISK_ORDER.indexOf(b.level) || a.index - b.index)
      .map(({ what, level, index }) => ({ what, level, index }));
    if (tone === 'bad' || tone === 'warn' || risks.length) {
      const open = openSteps(p)[0];
      atRisk.push({ ...ref, id: `risk:${x.path}`, ...(p.health ? { health: p.health } : {}), tone, ...(typeof p.progress === 'number' ? { progress: p.progress } : {}), ...(p.due ? { due: p.due } : {}), dueOffset: due?.offset ?? null, risks, ...(open ? { next: open } : {}) });
    } else {
      // Gone quiet: steps open, nothing changed in the project or its folder's notes for a fortnight or more.
      const steps = p.next.filter((n) => !n.done);
      const last = Math.max(x.modified, latestIn.get(folderOfNote(x.path)) ?? 0);
      const days = Math.round((startOfDay(now) - startOfDay(new Date(last))) / DAY);
      if (steps.length && last > 0 && days >= QUIET_DAYS) quiet.push({ ...ref, id: `quiet:${x.path}`, days, open: steps.length, next: steps[0].what });
    }

    // Changed since yesterday: updates dated yesterday or today, the former host app's task notes and the project's
    // other notes.
    const lines: ChangeLine[] = [];
    p.updates.forEach((u, i) => {
      const r = readDay(u.date, now);
      if (r && r.offset >= -1 && r.offset <= 0) lines.push({ id: `upd:${x.path}:${i}`, kind: 'update', what: u.what, at: midday(r), index: i, ...(u.from ? { from: u.from } : {}) });
    });
    const dir = folderOfNote(x.path);
    if (dir)
      for (const n of notesIn.get(dir) ?? []) {
        if (n.path === x.path) continue;
        const activity = /\/(Activity|Tasks)\//i.test(n.path.slice(dir.length));
        const status = activity ? prop(n.props, 'status') : undefined;
        lines.push({ id: `note:${n.path}`, kind: activity ? 'activity' : 'note', what: n.title, at: n.mtime, path: n.path, ...(status ? { status } : {}) });
      }
    if (lines.length) changed.push({ ...ref, id: `chg:${x.path}`, latest: Math.max(...lines.map((l) => l.at)), lines: lines.sort((a, b) => b.at - a.at), moreFiles: 0, files: 0 });
  }

  const byDay = (a: DueItem, b: DueItem) => a.offset - b.offset || (a.kind === 'step' ? 0 : 1) - (b.kind === 'step' ? 0 : 1) || a.projectName.localeCompare(b.projectName) || (a.index ?? 0) - (b.index ?? 0);
  overdue.sort(byDay);
  dueToday.sort(byDay);
  soon.sort(byDay);
  later.sort(byDay);
  stale.sort(byDay);
  passed.sort((a, b) => b.offset - a.offset || a.projectName.localeCompare(b.projectName));
  // Waiting: the longest-waiting first — the earliest date, then (no date) the project untouched longest.
  waiting.sort((a, b) => (a.offset ?? Infinity) - (b.offset ?? Infinity) || a.since - b.since || a.projectName.localeCompare(b.projectName) || a.index - b.index);
  unscheduled.sort((a, b) => a.projectName.localeCompare(b.projectName) || a.index - b.index);
  const rank = { bad: 0, warn: 1, none: 2, ok: 3 };
  atRisk.sort((a, b) => rank[a.tone] - rank[b.tone] || b.risks.length - a.risks.length || (a.dueOffset ?? Infinity) - (b.dueOffset ?? Infinity) || a.projectName.localeCompare(b.projectName));
  changed.sort((a, b) => b.latest - a.latest || a.projectName.localeCompare(b.projectName));

  const meetings = input.notes
    .filter((n) => meetingToday(n, now))
    .map((n) => {
      const time = prop(n.props, 'time', 'start', 'starts');
      return { path: n.path, title: n.title, ...(time ? { time } : {}), attendees: list(n.props?.attendees ?? n.props?.people) };
    })
    .sort((a, b) => (timeMinutes(a.time) ?? 9999) - (timeMinutes(b.time) ?? 9999) || a.title.localeCompare(b.title));

  let data: TodayData = {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    since,
    me,
    projects: live.length,
    due: { overdue, today: dueToday, soon, later, passed, stale },
    atRisk,
    quiet: quiet.sort((a, b) => b.days - a.days || a.projectName.localeCompare(b.projectName)),
    dormantOpen: dormantOpenProjects(input.projects, now),
    waiting,
    unscheduled,
    changed,
    daily: input.daily ?? null,
    meetings,
    docs: (input.docs ?? []).filter((d) => d.mtime >= since).sort((a, b) => b.mtime - a.mtime),
    automations: automationsToday(input.automations, now),
    counts: { overdue: overdue.length, today: dueToday.length, soon: soon.length, later: later.length, stale: stale.length, atRisk: atRisk.length, waiting: waiting.length, unscheduled: unscheduled.length, changed: changed.reduce((n, g) => n + g.lines.length, 0), meetings: meetings.length, automations: 0 },
    clear: false,
    nothingOnYou: !overdue.length && !dueToday.length && !soon.length && !later.length && !stale.length && !waiting.length && !unscheduled.length,
  };
  if (input.files?.length) data = withChangedFiles(data, input.files);
  data.counts.automations = data.automations?.length ?? 0;
  // One due total (fnv3 F1): Coming up counts too, so "All clear" never sits above work on the page. Stale counts
  // too (5 Nov 2026, u3 moving-in): old work is still work — quiet, but never hidden behind All clear.
  data.clear = !overdue.length && !dueToday.length && !later.length && !stale.length && !atRisk.length && !waiting.length;
  return data;
}

const QUICK = /(?:\((\d{1,3})\s*mins?\)|\[(\d{1,3})\s*mins?\]|\b(\d{1,3})\s*-mins?\b)/i;
/** A quick chore ("(5 min)", "[5 min]", "5-min"; Nov 2026 audit) never outranks a deadline (29 Oct 2026, SPEC section A). */
const quick = (x: DueItem) => { const m = QUICK.exec(x.what); const n = m?.[1] ?? m?.[2] ?? m?.[3]; return !!n && Number(n) <= 15; };
const kindRank = (x: DueItem) => (x.kind === 'step' ? 1 : 0);

/**
 * "Next for you" in the order that matters (29 Oct 2026, SPEC section A): first what is due today or overdue
 * in a project at risk, then today's meetings' prep, then the rest by due day and a quick chore last on its
 * day. The most-days-late item does not win on lateness alone. Stale (5 Nov 2026, u3 moving-in) ranks after
 * everything fresh and, among itself, least-stale first — old lines never lead the day. It is always an action
 * that is the person's own (Polish round 4): a key date is something to know, not to do, and a project's own
 * due day is not a step, so neither is ever picked here; they stay in the day lists where they were put.
 */
export function rankNextForYou(items: DueItem[], prep: DueItem[] = []): DueItem[] {
  const tier = (x: DueItem) => (isStaleOffset(x.offset) ? 4 : x.offset <= 0 && (x.tone === 'bad' || x.tone === 'warn') ? 0 : x.offset <= 0 ? 2 : 3);
  const byDue = (a: DueItem, b: DueItem) => (isStaleOffset(a.offset) && isStaleOffset(b.offset) ? b.offset - a.offset : a.offset - b.offset);
  const byRank = (a: DueItem, b: DueItem) => tier(a) - tier(b) || kindRank(a) - kindRank(b) || byDue(a, b) || Number(quick(a)) - Number(quick(b)) || a.projectName.localeCompare(b.projectName) || (a.index ?? 0) - (b.index ?? 0);
  const main = items.filter((x) => x.kind === 'step').sort(byRank);
  if (!prep.length) return main;
  const out: DueItem[] = [];
  let put = false;
  for (const x of main) {
    if (!put && tier(x) > 0) { out.push(...[...prep].sort(byRank)); put = true; }
    out.push(x);
  }
  if (!put) out.push(...[...prep].sort(byRank));
  return out;
}

/** The one next thing: rankNextForYou over every due list (stale ranked last, never leading), with today's meeting
 *  prep when the caller has it. */
export function pickNextForYou(due: { overdue: DueItem[]; today: DueItem[]; soon: DueItem[]; later: DueItem[]; stale?: DueItem[] }, prep: DueItem[] = []): DueItem | null {
  return rankNextForYou([...due.overdue, ...due.today, ...due.soon, ...due.later, ...(due.stale ?? [])], prep)[0] ?? null;
}

/**
 * The few next things (4 Nov 2026, p12-today-focus: "Next for you" is at most five): rankNextForYou over every due
 * list, the first few. Own steps only, late and today first, by the existing rank; stale last.
 */
export function pickNextFew(due: { overdue: DueItem[]; today: DueItem[]; soon: DueItem[]; later: DueItem[]; stale?: DueItem[] }, n = 5, prep: DueItem[] = []): DueItem[] {
  return rankNextForYou([...due.overdue, ...due.today, ...due.soon, ...due.later, ...(due.stale ?? [])], prep).slice(0, Math.max(0, n));
}

/**
 * A due list's steps alone, counted (4 Nov 2026, p12-today-focus round 3: a key date and a project's own due day are
 * dates, not tasks — they show in the date list but count nowhere, in every place, so the rail and Needs you agree).
 */
export function countDueSteps(items: DueItem[] | undefined): number {
  return (items ?? []).filter((x) => x.kind === 'step').length;
}

/**
 * The one Today count (4 Nov 2026, p12-today-focus): the person's own steps late or due today. The rail, Today's
 * heading, the former host app's Needs you Vault tab and Telegram all read this, so the number is one
 * everywhere. Accepts the whole day or its due groups alone; key dates, project dues, soon, later, stale
 * (counted apart, never leading), waiting and unscheduled never count.
 */
export function todayDueCount(day: Pick<TodayData, 'due'> | { overdue: DueItem[]; today: DueItem[] }): number {
  const due = (day as TodayData).due ?? (day as { overdue: DueItem[]; today: DueItem[] });
  return countDueSteps(due.overdue) + countDueSteps(due.today);
}

/**
 * The side bar's Today count (break-it t31, 8 Nov 2026): late plus today through the one rule on the day's own
 * lists — the day's rows (steps, key dates and project dues, as Late draws them) plus the hub's dated lines —
 * read against the people the vault knows. Vault's own bar and the former host app's one bar both read this, so
 * the number is one everywhere; waiting, unscheduled and passed dates never count. Dates count since t249 (a
 * late project due reads in Late, so the badge counts it — never 8 on the bar above a Late 9).
 */
export function sidebarTodayCount(
  day: Pick<TodayData, 'due' | 'me'>,
  hub: { overdue: DueEntry[]; today: DueEntry[]; week: DueEntry[]; later: DueEntry[]; stale?: DueEntry[]; known?: readonly string[] | null } | null,
  now: Date,
): number {
  // The day's rows straight from the day's lists (their ownership was decided when built, never re-derived
  // from words here); the hub's lines through the known-people reading, as Today's own list reads them.
  const steps = [...day.due.overdue, ...day.due.today, ...day.due.soon, ...day.due.later, ...day.due.stale];
  const notes = hub
    ? [...hub.overdue, ...hub.today, ...hub.week, ...hub.later, ...(hub.stale ?? [])]
        .filter((e) => isOwnText(e.kind === 'reminder' ? e.item.text : e.item.words, day.me ?? null, now, hub.known))
        .map((e) => e.day)
    : [];
  const counted = dayShapeCounts(steps, notes, now);
  return counted.late + counted.today;
}

/** The compact line at the top: "3 due today · 1 overdue · 2 at risk · 4 waiting · 12 from a while back" (only what
 *  there is; stale last and quiet). */
export function headline(c: TodayCounts): { key: 'today' | 'overdue' | 'atRisk' | 'waiting' | 'soon' | 'stale'; words: string }[] {
  const out: { key: 'today' | 'overdue' | 'atRisk' | 'waiting' | 'soon' | 'stale'; words: string }[] = [];
  if (c.today) out.push({ key: 'today', words: `${c.today} due today` });
  if (c.overdue) out.push({ key: 'overdue', words: `${c.overdue} overdue` });
  if (c.atRisk) out.push({ key: 'atRisk', words: `${c.atRisk} at risk` });
  if (c.waiting) out.push({ key: 'waiting', words: `${c.waiting} waiting` });
  if (!c.today && !c.overdue && c.soon) out.push({ key: 'soon', words: `${c.soon} due this week` });
  if (c.stale) out.push({ key: 'stale', words: `${c.stale} from a while back` });
  return out;
}

// ── The day's shape (5 Nov 2026, "Today is the day's shape"): one sentence, one count ──

// A task as the one count reads it: its words (with its owner tail, "— Name"), its day
// (YYYY-MM-DD or however the file writes it), and whether its box is ticked. People
// links never count as owners: linking to a person ("Call [[Priya]]") is still my job
// to call them, not theirs. Bills, key dates and project dues are not tasks here.
export interface CountTask {
  words: string;
  due: string | null;
  done: boolean;
}

/**
 * One counting query for late, today and this week (5 Nov 2026: the audit found 13
 * versus 33 for the same thing, the most trust-breaking fault it found). Own open tasks
 * only (isOwnText: no owner is theirs, a day is not a person; with `known`, a stranger's
 * mention is never debt, 5 Nov 2026 u3 moving-in), grouped by the one day
 * reading (readDay): late is before today, today is today, week is the next 7 days.
 * Done boxes and dateless lines never count. Today, Tasks and the rail all read this,
 * so the number is one everywhere.
 */
export function countLateTodayWeek(tasks: readonly CountTask[], me: string | null, now: Date, known?: readonly string[] | null): { late: number; today: number; week: number } {
  let late = 0;
  let today = 0;
  let week = 0;
  for (const t of tasks) {
    if (t.done) continue;
    if (!isOwnText(t.words, me, now, known)) continue;
    const offset = t.due ? readDay(t.due, now)?.offset ?? null : null;
    if (offset === null) continue;
    if (offset < 0) late++;
    else if (offset === 0) today++;
    else if (offset <= 7) week++;
  }
  return { late, today, week };
}

/**
 * The day's shape from the lists already shown (t76, 9 Nov 2026: Today said "Nothing needs you
 * today" above four late rows — the sentence re-derived ownership from words while the list read
 * buildToday's project-owner fallback, so with no single owner every named step counted as someone
 * else's). Own project steps (ownership decided when built) plus own hub days counted by the one day
 * reading. Stale counts apart, never leading (u3): skipped here, as the one number always has. Today,
 * the rail badge and the Tasks pills read this one rule, so every mouth says one number.
 */
export function dayShapeCounts(
  steps: readonly { offset: number }[],
  noteDays: readonly (string | null)[],
  now: Date,
): { late: number; today: number; week: number } {
  let late = 0;
  let today = 0;
  let week = 0;
  for (const s of steps) {
    if (!Number.isFinite(s.offset) || isStaleOffset(s.offset)) continue;
    if (s.offset < 0) late++;
    else if (s.offset === 0) today++;
    else if (s.offset <= 7) week++;
  }
  for (const day of noteDays) {
    const r = day ? readDay(day, now) : null;
    if (!r || isStaleOffset(r.offset)) continue;
    if (r.offset < 0) late++;
    else if (r.offset === 0) today++;
    else if (r.offset <= 7) week++;
  }
  return { late, today, week };
}

/**
 * One sentence that says what the day is (5 Nov 2026: Today reports five numbers before
 * any work; now it says one line). Warm and direct, a single full stop. Waiting is
 * others' work, so it never shapes this line: it folds below with its chase.
 */
export function daySentence(c: { late: number; today: number; meetings: number; waiting?: number }): string {
  const parts: string[] = [];
  if (c.late > 0) parts.push(`${c.late} late`);
  if (c.today > 0) parts.push(`${c.today} due today`);
  if (c.meetings > 0) parts.push(`${c.meetings} ${c.meetings === 1 ? 'meeting' : 'meetings'}`);
  if (!parts.length) return 'Nothing needs you today.';
  const joined = parts.length === 1 ? parts[0] : parts.length === 2 ? `${parts[0]} and ${parts[1]}` : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `You have ${joined}.`;
}
