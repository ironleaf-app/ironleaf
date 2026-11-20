// The timeline (17 Oct 2026): every project's dates in one view — when each started and is due, its key dates, the "by"
// dates of its next steps, and its decisions and updates as small marks — so clashes and slips show. Pure functions only
// (dates → days → x positions, rows packed into lanes, clashes found, rows filtered and grouped), shared by the Timeline
// tab and the strip on each project page, and tested in tests/timeline.test.mjs. Read live from the project files
// (src/shared/project-file.ts): nothing is stored apart from them.

import type { Project } from './project-file';
import { isFinished, readHealthTone } from './finished';

// ── Days ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A day is a whole number (days since 1 Jan 1970 on the calendar, not in any time zone), so a date is the same day
// everywhere and daylight saving never moves it.

const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const dayFrom = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m, d) / DAY_MS);
export function ymd(day: number): { y: number; m: number; d: number; weekday: number } {
  const t = new Date(day * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), weekday: t.getUTCDay() };
}
/** Today on this PC's calendar. */
export const todayDay = (now: Date = new Date()) => dayFrom(now.getFullYear(), now.getMonth(), now.getDate());

const monthIndex = (word: string) => {
  const w = word.toLowerCase().replace(/\.$/, '');
  return w.length < 3 ? -1 : MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(w));
};
const real = (y: number, m: number, d: number) => m >= 0 && m < 12 && d >= 1 && d <= new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** The year that puts a day and month without one nearest the reference day (what "by 3 Jan" means in late October). */
function nearestYear(m: number, d: number, ref: number): number {
  const { y } = ymd(ref);
  return [y - 1, y, y + 1].filter((yy) => real(yy, m, d)).sort((a, b) => Math.abs(dayFrom(a, m, d) - ref) - Math.abs(dayFrom(b, m, d) - ref))[0] ?? y;
}

/**
 * A date as people write it in a project — 2026-10-31, 31 Oct 2026, 31 October, Oct 31 2026, 31/10/2026 (day first, as
 * written in Australia) — as a day; null when it isn't a date ("end of month", "TBC"). A date without its year is the
 * one nearest `ref`.
 */
export function readDay(text: string | undefined, ref: number = todayDay()): number | null {
  if (!text) return null;
  const t = String(text).trim().replace(/^(by|due|on)\s+/i, '').replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i, '');
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(t))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    return real(y, mo, d) ? dayFrom(y, mo, d) : null;
  }
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?(?:\s+(\d{4}))?\s*$/.exec(t))) {
    const mo = monthIndex(m[2]);
    const d = Number(m[1]);
    if (mo < 0) return null;
    const y = m[3] ? Number(m[3]) : nearestYear(mo, d, ref);
    return real(y, mo, d) ? dayFrom(y, mo, d) : null;
  }
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?\s*$/.exec(t))) {
    const mo = monthIndex(m[1]);
    const d = Number(m[2]);
    if (mo < 0) return null;
    const y = m[3] ? Number(m[3]) : nearestYear(mo, d, ref);
    return real(y, mo, d) ? dayFrom(y, mo, d) : null;
  }
  if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})\s*$/.exec(t))) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const [d, mo] = [Number(m[1]), Number(m[2]) - 1];
    return real(y, mo, d) ? dayFrom(y, mo, d) : null;
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (day: number) => {
  const { y, m, d } = ymd(day);
  return `${y}-${pad(m + 1)}-${pad(d)}`;
};
/** A moved date written the way the person wrote the one it replaces (ISO stays ISO; 31/10/2026 stays day first). */
export function writeDayLike(day: number, like = ''): string {
  const { y, m, d } = ymd(day);
  const t = like.trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(t) || !t) return isoDay(day);
  if (/^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$/.test(t)) return `${d}${t.includes('.') ? '.' : '/'}${m + 1}${t.includes('.') ? '.' : '/'}${y}`;
  if (/^[A-Za-z]/.test(t.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i, ''))) return `${MONTHS[m]} ${d}${t.includes(',') ? ',' : ''} ${y}`;
  return `${d} ${MONTHS[m]} ${y}`;
}
/** "17 Oct", or "17 Oct 2027" in another year than `ref`. */
export function shortDay(day: number, ref: number = todayDay()): string {
  const { y, m, d } = ymd(day);
  return `${d} ${MONTHS[m]}${y !== ymd(ref).y ? ` ${y}` : ''}`;
}
/** "Thu 23 Oct 2026". */
export function longDay(day: number): string {
  const { y, m, d, weekday } = ymd(day);
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m]} ${y}`;
}
/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function relativeDay(day: number, today: number): string {
  const n = day - today;
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** A month's full name ("October") for the scale's heads. */
export function monthName(day: number): string {
  return MONTH_NAMES[ymd(day).m];
}

/** A bar's dates as the mock-up writes them ("12 Oct – 20 Nov", "17 – 24 Oct", "29 Oct"). */
export function barWords(d1: number, d2: number, ref: number = todayDay()): string {
  const a = ymd(Math.min(d1, d2)), b = ymd(Math.max(d1, d2));
  const year = (y: number) => (y !== ymd(ref).y ? ` ${y}` : '');
  if (a.y === b.y && a.m === b.m && a.d === b.d) return `${a.d} ${MONTHS[a.m]}${year(a.y)}`;
  if (a.y === b.y && a.m === b.m) return `${a.d} – ${b.d} ${MONTHS[b.m]}${year(b.y)}`;
  if (a.y === b.y) return `${a.d} ${MONTHS[a.m]} – ${b.d} ${MONTHS[b.m]}${year(b.y)}`;
  return `${a.d} ${MONTHS[a.m]} ${a.y} – ${b.d} ${MONTHS[b.m]} ${b.y}`;
}

// ── What a project puts on the timeline ───────────────────────────────────────────────────────────────────────────────

export type MarkKind = 'start' | 'due' | 'date' | 'next' | 'decision' | 'update';

export interface Mark {
  /** `${path}#${kind}:${index}` — steady while the file's lines keep their order. */
  id: string;
  path: string;
  kind: MarkKind;
  day: number;
  words: string;
  /** Its line in its list (key dates, next steps, decisions, updates). */
  index?: number;
  status?: string;
  who?: string;
  done?: boolean;
  /** The date as it is written, so a moved one is written the same way. */
  written: string;
  /** Whether dragging it changes the file (key dates, the start and the due date). */
  movable: boolean;
}

export interface TimelineProject {
  path: string;
  name: string;
  status?: string;
  health?: string;
  progress?: number;
  owner?: string;
  /** Everyone on it (owner, people, who's doing the next steps), lower case, for clashes and "mine". */
  people: string[];
  /** The same, as written, by their lower-case names. */
  names: Record<string, string>;
  start?: number;
  due?: number;
  marks: Mark[];
  /** Dates written that aren't dates the timeline can place ("end of month"): counted, never guessed. */
  unread: number;
  done: boolean;
}

const personKey = (name: string) => name.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
export const isDoneStatus = (s?: string) => isFinished(s);
const dateMet = (s?: string) => /\b(done|complete|completed|met|achieved|delivered|closed)\b/i.test(s ?? '');
const dateMissed = (s?: string) => /\b(miss|missed|late|slipped|slip|overdue)\b/i.test(s ?? '');

/** A project's dates, placed. `ref` is today (for dates written without their year). */
export function projectTimeline(path: string, p: Project, ref: number = todayDay()): TimelineProject {
  const marks: Mark[] = [];
  let unread = 0;
  const add = (kind: MarkKind, written: string | undefined, words: string, extra: Partial<Mark> = {}) => {
    if (!written || !written.trim()) return;
    const day = readDay(written, ref);
    if (day === null) {
      unread++;
      return;
    }
    marks.push({ id: `${path}#${kind}:${extra.index ?? 0}`, path, kind, day, words, written, movable: kind === 'date' || kind === 'start' || kind === 'due', ...extra });
  };
  add('start', p.started, 'Started');
  add('due', p.due, 'Due');
  p.dates.forEach((d, index) => add('date', d.when, d.what, { index, ...(d.status ? { status: d.status } : {}) }));
  p.next.forEach((n, index) => add('next', n.when, n.what, { index, done: n.done, ...(n.who ? { who: n.who } : {}) }));
  p.decisions.forEach((d, index) => add('decision', d.date, d.what, { index }));
  p.updates.forEach((u, index) => add('update', u.date, u.what, { index }));
  const names: Record<string, string> = {};
  for (const n of [p.owner, ...p.people.map((x) => x.name), ...p.next.map((x) => x.who)]) {
    if (!n) continue;
    const k = personKey(n);
    if (k && !names[k]) names[k] = n.replace(/\(.*?\)/g, '').trim();
  }
  const start = marks.find((m) => m.kind === 'start')?.day;
  const due = marks.find((m) => m.kind === 'due')?.day;
  return {
    path,
    name: p.name,
    status: p.status,
    health: p.health,
    progress: p.progress,
    owner: p.owner,
    people: Object.keys(names),
    names,
    ...(start !== undefined ? { start } : {}),
    ...(due !== undefined ? { due } : {}),
    marks: marks.sort((a, b) => a.day - b.day),
    unread,
    done: isDoneStatus(p.status),
  };
}

// ── Clashes and slips ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface Problem {
  /** slipped: a key date marked missed — shown as it is, not listed again (the person has said so already). */
  kind: 'clash' | 'late' | 'overdue' | 'slipped';
  /** In plain words, for the mark's card and the list of things to look at. */
  words: string;
  /** The other mark, for a clash. */
  with?: string;
}

export interface Problems {
  /** By mark id. */
  marks: Map<string, Problem[]>;
  /** Every one, once (a clash once for both its marks), in date order: what the "needs a look" list shows. */
  list: { mark: Mark; problem: Problem }[];
  counts: { clash: number; late: number; overdue: number };
}

// Whole words: timeline rows wrap (t207 pass 2).
const quote = (s: string, _max = 44) => `“${s}”`;
const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);

/**
 * What needs a look, in plain words:
 * - two key dates (or due dates) of projects that share people, on the same day: "Same day as … — Priya Shah is on both";
 * - a next step due after its project's due date;
 * - a next step, key date or project past its date and not done.
 * Done projects, ticked steps and met dates are left alone.
 */
export function findProblems(projects: TimelineProject[], today: number): Problems {
  const marks = new Map<string, Problem[]>();
  const list: Problems['list'] = [];
  const counts = { clash: 0, late: 0, overdue: 0 };
  const put = (m: Mark, problem: Problem, listed = true) => {
    const all = marks.get(m.id) ?? [];
    all.push(problem);
    marks.set(m.id, all);
    if (listed) list.push({ mark: m, problem });
  };
  const live = projects.filter((p) => !p.done);
  const byPath = new Map(live.map((p) => [p.path, p]));
  // Same day, shared people.
  const byDay = new Map<number, Mark[]>();
  for (const p of live) for (const m of p.marks) if ((m.kind === 'date' && !dateMet(m.status)) || m.kind === 'due') (byDay.get(m.day) ?? byDay.set(m.day, []).get(m.day)!).push(m);
  // The owner of every project (the person whose portfolio it is, with three or more) is on both sides of every pair:
  // their being there says nothing, so only the other people shared make two dates a clash.
  const owners = new Set(live.map((p) => (p.owner ?? '').trim().toLowerCase()));
  const portfolioOwner = live.length >= 3 && owners.size === 1 ? [...owners][0] : '';
  const everywhere = new Set(portfolioOwner ? [portfolioOwner] : []);
  // One line per pair of projects on a day, however many of their dates fall on it (a due date and a key date for it).
  const listedPairs = new Set<string>();
  for (const group of byDay.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (a.path === b.path) continue;
        const pa = byPath.get(a.path)!, pb = byPath.get(b.path)!;
        const shared = pa.people.filter((x) => pb.people.includes(x) && !everywhere.has(x));
        if (!shared.length) continue;
        const pair = `${a.day}|${[a.path, b.path].sort().join('|')}`;
        const first = !listedPairs.has(pair);
        listedPairs.add(pair);
        const who = `${pa.names[shared[0]]}${shared.length > 1 ? ` and ${shared.length - 1} more` : ''}`;
        const both = shared.length > 1 ? 'are on both' : 'is on both';
        const name = (m: Mark, p: TimelineProject) => (m.kind === 'due' ? `${p.name}’s due date` : `${quote(m.words)} (${p.name})`);
        put(a, { kind: 'clash', words: `Same day as ${name(b, pb)}: ${who} ${both}.`, with: b.id }, first);
        put(b, { kind: 'clash', words: `Same day as ${name(a, pa)}: ${who} ${both}.`, with: a.id }, false);
        if (first) counts.clash++;
      }
  }
  for (const p of live) {
    for (const m of p.marks) {
      if (m.kind === 'next' && !m.done) {
        if (p.due !== undefined && m.day > p.due) {
          put(m, { kind: 'late', words: `Due ${days(m.day - p.due)} after the project itself (${shortDay(p.due, today)}).` });
          counts.late++;
        }
        if (m.day < today) {
          put(m, { kind: 'overdue', words: `${days(today - m.day)} overdue and not ticked off.` });
          counts.overdue++;
        }
      } else if (m.kind === 'date' && m.day < today && !dateMet(m.status)) {
        if (dateMissed(m.status)) put(m, { kind: 'slipped', words: `Marked missed (${days(today - m.day)} ago).` }, false);
        else {
          put(m, { kind: 'overdue', words: `Passed ${days(today - m.day)} ago and isn’t marked done.` });
          counts.overdue++;
        }
      } else if (m.kind === 'due' && m.day < today) {
        put(m, { kind: 'overdue', words: `The project was due ${days(today - m.day)} ago.` });
        counts.overdue++;
      }
    }
  }
  list.sort((a, b) => a.mark.day - b.mark.day || a.mark.id.localeCompare(b.mark.id));
  return { marks, list, counts };
}

/** Whether a project needs attention: its health says so (the one rule: "offer" is not off track), or one of its dates has a problem. */
export function atRisk(p: TimelineProject, problems: Problems): boolean {
  if (p.done) return false;
  const tone = readHealthTone(p.health);
  if (tone === 'bad' || tone === 'warn') return true;
  return p.marks.some((m) => problems.marks.get(m.id)?.some((x) => x.kind !== 'slipped'));
}

const STATUS_WORDS: Record<string, string> = { active: 'Doing', planning: 'To do', idea: 'Idea', 'on hold': 'On hold', done: 'Done' };

/** A row's standing line as the mock-up writes it ("At risk · due 20 Nov", "Late · was 24 Oct", "Done · 29 Oct"). */
export function rowSub(p: TimelineProject, today: number): string {
  if (p.done) return p.due !== undefined ? `Done · ${shortDay(p.due, today)}` : 'Done';
  if (p.due !== undefined && p.due < today) return `Late · was ${shortDay(p.due, today)}`;
  if (!p.marks.length) return 'No dates yet';
  const h = String(p.health ?? '').toLowerCase();
  const state = /off|red|critical|blocked/.test(h) ? 'Off track' : /risk|amber|warn|watch/.test(h) ? 'At risk' : (STATUS_WORDS[(p.status ?? '').toLowerCase().trim()] ?? (p.status ? p.status.charAt(0).toUpperCase() + p.status.slice(1) : 'To do'));
  return p.due !== undefined ? `${state} · due ${shortDay(p.due, today)}` : state;
}

/** A bar's tint: done green, late red, off track red, at risk amber, doing blue, otherwise slate. */
export function barTint(p: TimelineProject, today: number): 'slate' | 'green' | 'amber' | 'red' | 'blue' {
  if (p.done) return 'green';
  if (p.due !== undefined && p.due < today) return 'red';
  const h = String(p.health ?? '').toLowerCase();
  if (/off|red|critical|blocked/.test(h)) return 'red';
  if (/risk|amber|warn|watch/.test(h)) return 'amber';
  if ((p.status ?? '').toLowerCase().trim() === 'active') return 'blue';
  return 'slate';
}

// ── Scale ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Zoom = 'weeks' | 'months' | 'quarters';
export const ZOOMS: Zoom[] = ['weeks', 'months', 'quarters'];
/** Pixels a day takes at each zoom: a week ≈ 170 px, a month ≈ 190 px, a quarter ≈ 200 px. */
export const PX_PER_DAY: Record<Zoom, number> = { weeks: 24, months: 6.2, quarters: 2.2 };

export const xOf = (day: number, from: number, ppd: number) => (day - from) * ppd;
/** The day under a point (the middle of the day it falls in). */
export const dayAt = (x: number, from: number, ppd: number) => from + Math.floor(x / ppd);

const mondayOf = (day: number) => day - ((ymd(day).weekday + 6) % 7);
const monthStart = (day: number) => {
  const { y, m } = ymd(day);
  return dayFrom(y, m, 1);
};
const quarterStart = (day: number) => {
  const { y, m } = ymd(day);
  return dayFrom(y, m - (m % 3), 1);
};
const addMonths = (day: number, n: number) => {
  const { y, m } = ymd(day);
  return dayFrom(y, m + n, 1);
};
export function quarterOf(day: number): { from: number; to: number; words: string } {
  const from = quarterStart(day);
  const to = addMonths(from, 3) - 1;
  const { y, m } = ymd(from);
  return { from, to, words: `${MONTHS[m]}–${MONTHS[m + 2]} ${y}` };
}

/** The days the timeline spans: every date shown and today, with room either side, starting on a week, month or quarter. */
export function span(projects: TimelineProject[], today: number, zoom: Zoom): { from: number; to: number } {
  let lo = today, hi = today;
  for (const p of projects)
    for (const m of p.marks) {
      if (m.day < lo) lo = m.day;
      if (m.day > hi) hi = m.day;
    }
  // Never less than a working view around today, never padded by less than a step.
  lo = Math.min(lo, today - 30);
  hi = Math.max(hi, today + 90);
  if (zoom === 'weeks') return { from: mondayOf(lo - 7), to: mondayOf(hi + 14) + 6 };
  if (zoom === 'months') return { from: addMonths(monthStart(lo), -1), to: addMonths(monthStart(hi), 2) - 1 };
  return { from: addMonths(quarterStart(lo), -3), to: addMonths(quarterStart(hi), 6) - 1 };
}

export interface Tick {
  day: number;
  label: string;
}

/** The scale's two lines: the small steps (weeks, months or quarters) and the larger ones above them (months or years). */
export function ticks(from: number, to: number, zoom: Zoom): { minor: Tick[]; major: Tick[] } {
  const minor: Tick[] = [];
  const major: Tick[] = [];
  if (zoom === 'weeks') {
    for (let d = mondayOf(from); d <= to; d += 7) if (d >= from) minor.push({ day: d, label: String(ymd(d).d) });
    for (let d = monthStart(from); d <= to; d = addMonths(d, 1)) {
      const { y, m } = ymd(d);
      major.push({ day: Math.max(d, from), label: `${MONTH_NAMES[m]} ${y}` });
    }
  } else if (zoom === 'months') {
    for (let d = monthStart(from); d <= to; d = addMonths(d, 1)) if (d >= from) minor.push({ day: d, label: MONTHS[ymd(d).m] });
    for (let y = ymd(from).y; dayFrom(y, 0, 1) <= to; y++) major.push({ day: Math.max(dayFrom(y, 0, 1), from), label: String(y) });
  } else {
    for (let d = quarterStart(from); d <= to; d = addMonths(d, 3)) if (d >= from) minor.push({ day: d, label: `${MONTHS[ymd(d).m]}–${MONTHS[ymd(d).m + 2]}` });
    for (let y = ymd(from).y; dayFrom(y, 0, 1) <= to; y++) major.push({ day: Math.max(dayFrom(y, 0, 1), from), label: String(y) });
  }
  return { minor, major };
}

// ── Rows ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Packed {
  /** Each item's lane (0 is the bar's own line). */
  lane: Map<string, number>;
  lanes: number;
  /** Items that didn't fit any lane, folded into the one shown where they are (its id → theirs). */
  folded: Map<string, string[]>;
  /** The ids drawn (folded ones aren't). */
  shown: string[];
}

/**
 * Point marks placed in lanes so none sits closer than `gap` px to another in its lane: a fixed one (a bar's start or
 * due date) always on the bar's own line, the rest each in the first lane with room; when every lane is full there, a
 * mark folds into the nearest one drawn (shown as "+2", its words in the card) — never lost.
 */
export function packMarks(items: { id: string; x: number; fixed?: boolean }[], gap: number, maxLanes = 3): Packed {
  const lanes: { id: string; x: number }[][] = [[]];
  const lane = new Map<string, number>();
  const folded = new Map<string, string[]>();
  const shown: string[] = [];
  for (const it of items.filter((i) => i.fixed)) {
    lanes[0].push(it);
    lane.set(it.id, 0);
    shown.push(it.id);
  }
  const fits = (l: { x: number }[], x: number) => l.every((o) => Math.abs(o.x - x) >= gap);
  for (const it of items.filter((i) => !i.fixed).sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))) {
    let l = lanes.findIndex((list) => fits(list, it.x));
    if (l < 0 && lanes.length < maxLanes) l = lanes.push([]) - 1;
    if (l < 0) {
      // Full: into the nearest mark drawn.
      let host = lanes[0][0];
      let hostLane = 0;
      lanes.forEach((list, k) => list.forEach((o) => (Math.abs(o.x - it.x) < Math.abs(host.x - it.x) ? ((host = o), (hostLane = k)) : null)));
      (folded.get(host.id) ?? folded.set(host.id, []).get(host.id)!).push(it.id);
      lane.set(it.id, hostLane);
      continue;
    }
    lanes[l].push(it);
    lane.set(it.id, l);
    shown.push(it.id);
  }
  // Lanes in use (a first lane holding nothing still counts: it's the bar's line).
  return { lane, lanes: Math.max(1, lanes.filter((list, k) => k === 0 || list.length).length), folded, shown };
}

/**
 * Which key-date labels may show (sweep 3, 062: labels overlapped each other and were cut). A label is kept
 * greedily, earliest first, only when its span (from its mark, as wide as its words need, capped) clears
 * every kept label in its own lane or the lanes beside it (labels are one line tall and lanes sit a line
 * apart, so a label in the next lane still collides). The rest stay on hover. `room` caps a span at the
 * next mark in its lane, as before.
 */
export function labelIds(items: { id: string; x: number; lane: number; words: string; room: number }[]): Set<string> {
  const kept: { x: number; end: number; lane: number }[] = [];
  const out = new Set<string>();
  for (const it of [...items].sort((a, b) => a.x - b.x || a.lane - b.lane)) {
    const width = Math.min(180, Math.max(52, it.words.length * 6.5 + 22));
    const span = Math.min(width, it.room);
    if (span < 52) continue;
    const end = it.x + span;
    if (kept.some((k) => Math.abs(k.lane - it.lane) <= 1 && it.x < k.end + 4 && k.x < end + 4)) continue;
    kept.push({ x: it.x, end, lane: it.lane });
    out.add(it.id);
  }
  return out;
}

export interface RowLayout {
  /** The bar from start to due (days and x), when the project has both — or one, and dates past it (open at the other end). */
  bar?: { d1: number; d2: number; x1: number; x2: number; open: 'none' | 'start' | 'end' };
  /** Key dates and next steps on the bar's line and the lanes above it. */
  points: Packed;
  /** Decisions and updates along the foot of the row. */
  history: Packed;
  height: number;
}

export const ROW = { base: 46, lane: 15, gap: 15, historyGap: 9 };

/** The bar's days: start to due; with one of them, from it to the furthest of the project's other dates. */
export function barDays(p: TimelineProject): { d1: number; d2: number; open: 'none' | 'start' | 'end' } | undefined {
  if (p.start !== undefined && p.due !== undefined) return { d1: Math.min(p.start, p.due), d2: Math.max(p.start, p.due), open: 'none' };
  const others = p.marks.filter((m) => m.kind === 'date' || m.kind === 'next').map((m) => m.day);
  if (p.start !== undefined) {
    const end = Math.max(p.start, ...others);
    return end > p.start ? { d1: p.start, d2: end, open: 'end' } : undefined;
  }
  if (p.due !== undefined) {
    const begin = Math.min(p.due, ...others);
    return begin < p.due ? { d1: begin, d2: p.due, open: 'start' } : undefined;
  }
  return undefined;
}

/** Where everything in a project's row goes at a scale (x is the middle of each day). */
export function layoutRow(p: TimelineProject, from: number, ppd: number): RowLayout {
  const x = (d: number) => xOf(d, from, ppd) + ppd / 2;
  // The bar's ends hold the bar's own line, so a key date on the due date sits just above it, not hidden under it.
  const pts = p.marks.filter((m) => m.kind === 'date' || m.kind === 'next' || m.kind === 'start' || m.kind === 'due').map((m) => ({ id: m.id, x: x(m.day), fixed: m.kind === 'start' || m.kind === 'due' }));
  const hist = p.marks.filter((m) => m.kind === 'decision' || m.kind === 'update').map((m) => ({ id: m.id, x: x(m.day) }));
  const points = packMarks(pts, ROW.gap, 3);
  const history = packMarks(hist, ROW.historyGap, 1);
  const days = barDays(p);
  const bar = days ? { ...days, x1: x(days.d1), x2: x(days.d2) } : undefined;
  return { bar, points, history, height: ROW.base + (points.lanes - 1) * ROW.lane };
}

// ── Showing some, in groups ──────────────────────────────────────────────────────────────────────────────────────────

export interface Filters {
  risk?: boolean;
  mine?: boolean;
  quarter?: boolean;
}

/** Whether a person (as written) is on a project: its owner, one of its people, or doing one of its next steps. */
export const isOn = (p: TimelineProject, me: string) => !!me.trim() && p.people.includes(personKey(me));

export function filterRows(projects: TimelineProject[], f: Filters, ctx: { problems: Problems; today: number; me?: string }): TimelineProject[] {
  const q = quarterOf(ctx.today);
  return projects.filter((p) => {
    if (f.risk && !atRisk(p, ctx.problems)) return false;
    if (f.mine && !(ctx.me && isOn(p, ctx.me))) return false;
    if (f.quarter) {
      const lo = Math.min(p.start ?? Infinity, ...p.marks.map((m) => m.day));
      const hi = Math.max(p.due ?? -Infinity, ...p.marks.map((m) => m.day));
      if (!Number.isFinite(lo) || hi < q.from || lo > q.to) return false;
    }
    return true;
  });
}

export type GroupBy = 'status' | 'due' | 'owner' | 'health' | 'none';
export type SortBy = 'due' | 'start' | 'name' | 'health';
export interface RowGroup {
  key: string;
  label: string;
  rows: TimelineProject[];
}

const STATUS_ORDER = ['active', 'planning', 'idea', 'on hold', 'done'];
const healthRank = (h?: string) => (/off|red|critical|blocked/i.test(h ?? '') ? 0 : /risk|amber|warn|watch/i.test(h ?? '') ? 1 : /track|green|good|ok/i.test(h ?? '') ? 3 : 2);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function sortRows(rows: TimelineProject[], by: SortBy): TimelineProject[] {
  const name = (a: TimelineProject, b: TimelineProject) => a.name.localeCompare(b.name);
  const day = (v?: number) => v ?? Infinity;
  return [...rows].sort((a, b) =>
    by === 'name' ? name(a, b) : by === 'start' ? day(a.start) - day(b.start) || name(a, b) : by === 'health' ? healthRank(a.health) - healthRank(b.health) || day(a.due) - day(b.due) || name(a, b) : day(a.due) - day(b.due) || name(a, b),
  );
}

/** Rows in groups (by status, by when they're due, by owner, by health, or one group), each sorted. */
export function groupRows(rows: TimelineProject[], by: GroupBy, sort: SortBy, today: number): RowGroup[] {
  if (by === 'none') return [{ key: 'all', label: 'All projects', rows: sortRows(rows, sort) }];
  const groups = new Map<string, { label: string; order: number | string; rows: TimelineProject[] }>();
  const into = (key: string, label: string, order: number | string, p: TimelineProject) => (groups.get(key) ?? groups.set(key, { label, order, rows: [] }).get(key)!).rows.push(p);
  const q = quarterOf(today);
  const nextQ = quarterOf(q.to + 1);
  for (const p of rows) {
    if (by === 'status') {
      const s = (p.status ?? '').toLowerCase().trim();
      const i = STATUS_ORDER.indexOf(s);
      into(s || '~', s ? cap(s) : 'No status', i >= 0 ? i : s ? 50 : 99, p);
    } else if (by === 'health') {
      const r = p.done ? 4 : healthRank(p.health);
      into(String(r), p.done ? 'Done' : r === 2 ? 'No health set' : cap(String(p.health).toLowerCase()), r, p);
    } else if (by === 'owner') {
      const o = (p.owner ?? '').trim();
      into(o ? personKey(o) : '~', o || 'No owner', o ? o.toLowerCase() : '\uffff', p);
    } else {
      const d = p.due;
      if (p.done) into('done', 'Done', 9, p);
      else if (d === undefined) into('none', 'No due date', 8, p);
      else if (d < today) into('over', 'Overdue', 0, p);
      else if (d <= q.to) into('q', `Due this quarter (${q.words})`, 1, p);
      else if (d <= nextQ.to) into('nq', `Due next quarter (${nextQ.words})`, 2, p);
      else into('later', 'Due later', 3, p);
    }
  }
  return [...groups.entries()]
    .sort((a, b) => (typeof a[1].order === 'number' && typeof b[1].order === 'number' ? a[1].order - b[1].order : (String(a[1].order) < String(b[1].order) ? -1 : String(a[1].order) > String(b[1].order) ? 1 : 0)))
    .map(([key, g]) => ({ key, label: g.label, rows: sortRows(g.rows, sort) }));
}

// ── Moving a date ────────────────────────────────────────────────────────────────────────────────────────────────────

/** What dragging a mark to a day changes in its project file (one ProjectEdit), or null when it can't be moved. */
export function moveEdit(m: Mark, day: number): { kind: 'set'; field: 'started' | 'due'; value: string } | { kind: 'change'; list: 'dates'; index: number; item: { when: string } } | null {
  if (!m.movable || day === m.day) return null;
  if (m.kind === 'start' || m.kind === 'due') return { kind: 'set', field: m.kind === 'start' ? 'started' : 'due', value: isoDay(day) };
  if (m.kind === 'date' && typeof m.index === 'number') return { kind: 'change', list: 'dates', index: m.index, item: { when: writeDayLike(day, m.written) } };
  return null;
}

/** What a move says it did, with Undo beside it: "Moved “Go-live” to Thu 23 Oct 2026." */
export function moveWords(m: Mark, day: number, projectName: string): string {
  const what = m.kind === 'due' ? `${projectName}’s due date` : m.kind === 'start' ? `${projectName}’s start` : quote(m.words);
  return `Moved ${what} to ${longDay(day)}.`;
}

/** What each kind of mark is called. */
export const KIND_WORDS: Record<MarkKind, string> = { start: 'Start', due: 'Due date', date: 'Key date', next: 'Next step', decision: 'Decision', update: 'Update' };
