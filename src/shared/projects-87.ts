// The Vault redesign's projects, tasks and inbox rules (8.7 wave 2a, 30 Oct 2026). Pure: the mock-ups' Status row (one
// Status for the project's status and health), the portfolio gantt's bars, the board columns, the day plan's split, the
// inbox sort and the files/notes kind filters. The screens (ProjectsHome, ProjectPage, TasksView, InboxPage) draw what
// comes back; tests/w2a-*.test.mjs check it. Nothing here reads the person's words for keywords: the model interprets
// or asks.

import { clockWords } from './clock';
import { formatDue } from './due-words';
import { isFinished, readHealthTone } from './finished';
import { STALE_AFTER_DAYS } from './today-count';
import { purposeOf } from './project-hub';
import { isShelved } from './today-count';

// ── The one Status (project-props mock-up) ──────────────────────────────────────────────────────────────────────────
// The mock-up shows one Status row with five choices — Active, At risk, Off track, On track, Finished — while the file
// keeps a status and a health apart. Finished is the status (the one isFinished rule); the track words are the health.
// On hold and Idea joined the row (Nov 2026, b6 break job): a shelved project read as Active while its tasks counted
// nowhere, and choosing Active never resumed it.

export type PropStatus = 'active' | 'at-risk' | 'off-track' | 'on-track' | 'on-hold' | 'idea' | 'finished';

const toneOf = (health?: string): 'ok' | 'warn' | 'bad' | 'none' => readHealthTone(health) ?? 'none';

/** The one Status a project reads as: finished first (whatever the health still says), else shelved (on hold
 *  or an idea — a paused project's old health is history, like a finished one's), else its health's tone, else
 *  active. Never Active for a project that isn't. */
export function propStatus(p: { status?: string; health?: string }): PropStatus {
  if (isFinished(p.status)) return 'finished';
  if (isShelved(p.status)) return /\bidea\b/i.test(p.status ?? '') ? 'idea' : 'on-hold';
  const tone = toneOf(p.health);
  if (tone === 'bad') return 'off-track';
  if (tone === 'warn') return 'at-risk';
  if (tone === 'ok') return 'on-track';
  return 'active';
}

export const PROP_STATUS_WORDS: Record<PropStatus, string> = { active: 'Active', 'at-risk': 'At risk', 'off-track': 'Off track', 'on-track': 'On track', 'on-hold': 'On hold', idea: 'Idea', finished: 'Finished' };
// Status tints read the one set (p13-vault-status, 4 Nov 2026): on track neutral, at risk and off track attention
// (off track stronger in weight at the call site, never a third hue). Words stay.
export const PROP_STATUS_TINT: Record<PropStatus, 'slate' | 'amber' | 'red' | 'green'> = { active: 'slate', 'at-risk': 'red', 'off-track': 'red', 'on-track': 'slate', 'on-hold': 'slate', idea: 'slate', finished: 'slate' };

/** What choosing a Status writes: Finished moves the status (the health stays as history), as do On hold and Idea;
 *  the track words move the health (a finished or shelved project comes back to Active); Active clears a health
 *  without touching a live status, and resumes a shelved one. */
export function propStatusEdits(value: PropStatus, current: { status?: string; health?: string }): { field: 'status' | 'health'; value: string | null }[] {
  if (value === 'finished') return [{ field: 'status', value: 'done' }];
  if (value === 'on-hold') return [{ field: 'status', value: 'on hold' }];
  if (value === 'idea') return [{ field: 'status', value: 'idea' }];
  const out: { field: 'status' | 'health'; value: string | null }[] = [];
  if (isFinished(current.status) || isShelved(current.status)) out.push({ field: 'status', value: 'active' });
  out.push({ field: 'health', value: value === 'active' ? null : value === 'at-risk' ? 'at risk' : value === 'off-track' ? 'off track' : 'on track' });
  return out;
}

// ── The portfolio gantt (projects-timeline mock-up) ───────────────────────────────────────────────────────────────
// Bars sit on timeline days (src/shared/timeline.ts); this only places them on the 0–100 track and names the months.

/** A bar's place on its track, in percent, kept inside 0–100 (a day without a date still shows, as a dot-wide bar). */
export function barPct(start: number | null, end: number | null, from: number, to: number): { left: number; width: number } {
  const days = Math.max(1, to - from + 1);
  const pct = (d: number) => Math.min(100, Math.max(0, ((d - from) / days) * 100));
  if (start === null && end === null) return { left: 50, width: 2 };
  const s = start ?? end ?? from;
  const e = end ?? start ?? to;
  const left = pct(Math.min(s, e));
  return { left, width: Math.max(2, pct(Math.max(s, e) + 1) - left) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The month labels across the gantt's head (timeline days count from 1 Jan 1970: src/shared/timeline.ts dayFrom). */
export function ganttMonths(from: number, to: number): string[] {
  return ganttSegments(from, to).map((s) => s.label);
}

// One month of the gantt's head as its share of the track, in percent (n3, 6 Nov 2026). The old head gave every
// month one flex share, so a part month read as wide as a whole one and the heads never lined up with the bars;
// the segments below are proportional to their days and join edge to edge, so the scale lines up and fills the
// width.
export interface GanttSegment {
  label: string;
  left: number;
  width: number;
}

export function ganttSegments(from: number, to: number): GanttSegment[] {
  const days = Math.max(1, to - from + 1);
  const base = Date.UTC(1970, 0, 1);
  const dayOf = (t: number) => Math.round((t - base) / 86400000);
  const first = new Date(base + from * 86400000);
  const last = new Date(base + to * 86400000);
  const years = new Set<number>();
  for (let t = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1); t <= last.getTime(); t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)) years.add(new Date(t).getUTCFullYear());
  const out: GanttSegment[] = [];
  for (let t = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1); t <= last.getTime() && out.length < 30; t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)) {
    const d = new Date(t);
    const start = Math.max(from, dayOf(t));
    const end = Math.min(to, dayOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) - 1);
    // A span crossing a year names every month with its short year, so no two heads ever read the same.
    const label = years.size > 1 ? `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` : MONTHS[d.getUTCMonth()];
    out.push({ label, left: ((start - from) / days) * 100, width: ((end - start + 1) / days) * 100 });
  }
  return out;
}

/** Which month heads read at this track width: greedy, earliest first, each kept only when its segment starts
 *  at least minPx past the last kept one — the strip's thinning by the same rule (date-strip.ts thinLabels keeps
 *  what fits with a gap; here every label is short, so one greedy pass over the proportional segments does it). */
export function thinGanttMonths(widths: readonly number[], trackPx: number, minPx = 64): boolean[] {
  const kept: boolean[] = new Array(widths.length).fill(false);
  let last = -Infinity;
  let left = 0;
  for (let i = 0; i < widths.length; i++) {
    const x = (left / 100) * Math.max(1, trackPx);
    if (x - last >= minPx) {
      kept[i] = true;
      last = x;
    }
    left += widths[i];
  }
  return kept;
}

export type GanttLabelSide = 'in' | 'right' | 'left';

/** Where a bar's label reads: inside when it fits, else beside the bar on the side with room. Widths are
 *  overestimated from the words (caption type, ~6.2px a character), the way the date strip estimates its own,
 *  so a label judged inside always fits for real. */
export function ganttLabelSide(barLeftPct: number, barWidthPct: number, trackPx: number, words: string): GanttLabelSide {
  const labelPx = words.length * 6.2 + 8;
  const leftPx = (barLeftPct / 100) * trackPx;
  const barPx = (barWidthPct / 100) * trackPx;
  if (barPx >= labelPx + 20) return 'in';
  if (leftPx + barPx + 8 + labelPx <= trackPx) return 'right';
  if (leftPx - 8 - labelPx >= 0) return 'left';
  return 'right';
}

// ── The boards ────────────────────────────────────────────────────────────────────────────────────────────────────
// The projects board groups by health (Off track, At risk, On track, Done) or by status; a project with no health
// yet sits with On track (nothing says otherwise) but keeps its "No health yet" tag on its card. The tasks board is
// gone (t249, the plan decision 2: one view, done well, no Board switch).

export type ProjectBoardColumn = 'off-track' | 'at-risk' | 'on-track' | 'done';
export const PROJECT_BOARD_COLUMNS: { id: ProjectBoardColumn; label: string; tint: 'red' | 'amber' | 'green' | 'slate' }[] = [
  { id: 'off-track', label: 'Off track', tint: 'red' },
  { id: 'at-risk', label: 'At risk', tint: 'red' },
  { id: 'on-track', label: 'On track', tint: 'slate' },
  { id: 'done', label: 'Done', tint: 'slate' },
];

/** Which health column a project sits in (the effective health: late for you weighs in, ProjectsHome's rule). */
export function projectBoardColumn(p: { status?: string; health?: string }): ProjectBoardColumn {
  if (isFinished(p.status)) return 'done';
  const tone = toneOf(p.health);
  if (tone === 'bad') return 'off-track';
  if (tone === 'warn') return 'at-risk';
  return 'on-track';
}

/** What dropping a project card in a column writes (Done finishes it; leaving Done brings it back to Active). */
export function projectBoardDrop(column: ProjectBoardColumn, current: { status?: string }): { field: 'status' | 'health'; value: string | null }[] {
  if (column === 'done') return [{ field: 'status', value: 'done' }];
  const out: { field: 'status' | 'health'; value: string | null }[] = [];
  if (isFinished(current.status)) out.push({ field: 'status', value: 'active' });
  out.push({ field: 'health', value: column === 'at-risk' ? 'at risk' : column === 'off-track' ? 'off track' : 'on track' });
  return out;
}


// ── The day plan (tasks-today mock-up) ──────────────────────────────────────────────────────────────────────────────
// ── The due tag (tasks-list mock-up) ────────────────────────────────────────────────────────────────────
// One reader (5 Nov 2026, the plan): late ("2 days late", "Yesterday"), today (or its time),
// tomorrow, weekday with date — plain words, attention for late, muted otherwise. No weekday alone.

const TAG_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A task's due words from its day and time against today (all YYYY-MM-DD / "15:00", as the file writes them). Null: no day. */
export function taskDueTag(due: string | null, time: string | null, todayIso: string, reminder = false): { words: string; tone: 'attention' | 'muted' } | null {
  if (!due) return null;
  const target = new Date(`${due}T00:00:00`);
  const today = new Date(`${todayIso}T00:00:00`);
  if (Number.isNaN(target.getTime()) || Number.isNaN(today.getTime())) return { words: due, tone: 'muted' };
  const offset = Math.round((target.getTime() - today.getTime()) / 86400000);
  // Stale (5 Nov 2026, u3 moving-in): more than a month late reads as its quiet date, never a red count.
  if (offset < -STALE_AFTER_DAYS) {
    const stale = `${target.getDate()} ${TAG_MONTHS[target.getMonth()]}${target.getFullYear() !== today.getFullYear() ? ` ${target.getFullYear()}` : ''}`;
    return { words: `${stale}${reminder ? ' ⏰' : ''}`, tone: 'muted' };
  }
  // The time reads the one shared way (8.7 urgent, 30 Oct 2026): "15:00" is "3:00 pm", and one that cannot be read
  // shows as written, never "NaN:NaN". The list has no leading time column, so today with a time reads its time;
  // the day plan's leading time already says it, so its rows pass no time and read "Today".
  if (offset === 0 && time?.trim()) return { words: `${clockWords(time)}${reminder ? ' ⏰' : ''}`, tone: 'muted' };
  const read = formatDue(offset, target, today);
  if (read.words === 'No date') return null;
  return { words: `${read.words}${reminder ? ' ⏰' : ''}`, tone: read.tone };
}

// Timed rows first, in time order (done sinking under open at the same time); then any-time rows, open before done.

export interface DayPlanTask {
  done: boolean;
  time: string | null;
}

/** Timed and any-time rows, each open before done (times as written, "15:00"). */
export function splitDayPlan<T extends DayPlanTask>(tasks: T[]): { timed: T[]; anytime: T[] } {
  const timed = tasks.filter((t) => t.time).sort((a, b) => Number(a.done) - Number(b.done) || (a.time ?? '').localeCompare(b.time ?? ''));
  const anytime = tasks.filter((t) => !t.time).sort((a, b) => Number(a.done) - Number(b.done));
  return { timed, anytime };
}

// ── The inbox sort (inbox mock-up) ──────────────────────────────────────────────────────────────────────────────────
// The list arrives in capture order, oldest first (captures append to the Inbox note's end); Newest turns it round.
// Suggested and photos-first keep that order inside each half, so the sort never scatters the day's captures.

export type InboxSort = 'newest' | 'oldest' | 'suggested' | 'photos';
export const INBOX_SORTS: { id: InboxSort; label: string }[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'suggested', label: 'Has a suggested place' },
  { id: 'photos', label: 'Photos and files first' },
];

const PICTURE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;

/** Whether an item carries a picture (shown or attached) or is a file beyond a plain line. */
export function inboxHasPhoto(item: { kind: string; path: string; embeds: string[] }): boolean {
  if (item.kind === 'file') return true;
  if (PICTURE.test(item.path)) return true;
  return item.embeds.some((e) => PICTURE.test(e));
}

export function sortInbox<T extends { id: string; kind: string; path: string; embeds: string[] }>(items: T[], mode: InboxSort, suggested: (id: string) => boolean): T[] {
  if (mode === 'oldest') return [...items];
  if (mode === 'newest') return [...items].reverse();
  if (mode === 'suggested') return [...items].sort((a, b) => Number(suggested(b.id)) - Number(suggested(a.id)));
  return [...items].sort((a, b) => Number(inboxHasPhoto(b)) - Number(inboxHasPhoto(a)));
}

// ── The files and notes kinds (project-files, project-notes mock-ups) ─────────────────────────────────────────────
// Photos by their extension; plans, contracts and quotes by purposeOf's own reading of the name (src/shared/project-hub).

export type FileKindFilter = 'all' | 'plans' | 'photos' | 'contracts' | 'quotes';

/** Which kind filter a file answers to (a file can be a plan and a photo; the photo wins, as the eye sees it). */
export function fileKindOf(name: string): Exclude<FileKindFilter, 'all'> | 'other' {
  if (PICTURE.test(name)) return 'photos';
  const p = purposeOf(name);
  if (p === 'quotes' || p === 'contracts' || p === 'plans') return p;
  return 'other';
}

export function fileKindMatches(name: string, filter: FileKindFilter): boolean {
  return filter === 'all' || fileKindOf(name) === filter;
}

export type NoteKindFilter = 'all' | 'site' | 'docs' | 'daily';

/** Which kind filter a note answers to: daily notes by their type or folder, docs by their type, the rest site notes. */
export function noteKindOf(path: string, type: string | undefined, dailyFolder: string): Exclude<NoteKindFilter, 'all'> {
  const t = String(type ?? '').toLowerCase();
  if (t === 'daily' || t === 'day' || (dailyFolder && path.toLowerCase().startsWith(`${dailyFolder.toLowerCase()}/`))) return 'daily';
  if (t === 'doc' || t === 'docs' || t === 'document') return 'docs';
  return 'site';
}

// ── The views, as the person left them ─────────────────────────────────────────────────────────────────────────────
// One switch over the same projects (List, Gallery, Board, Timeline), kept on this PC. Tasks and a project's tasks
// are one view each since the rebuild (the plan decision 2), so they keep no view.

export type ProjectsView = 'list' | 'gallery' | 'board' | 'timeline';

const VIEW_KEYS = { projects: 'nv-projects-view' } as const;

function readView<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return valid.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeView(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Remembering is a convenience.
  }
}

export const readProjectsView = (): ProjectsView => readView(VIEW_KEYS.projects, ['list', 'gallery', 'board', 'timeline'], 'list');
export const writeProjectsView = (v: ProjectsView): void => writeView(VIEW_KEYS.projects, v);
