// A project's plan on a timeline (23 Oct 2026, the redesign's workstream 1). So: one line per milestone and dated
// action, grouped by workstream (the Workstreams table's rows, else the run sheet's phases), milestones that belong to
// no workstream in their own group at the top, today marked, overdue in one colour, dependencies drawn where a line says
// what it comes after ("after: …"), and three zooms (week, month, quarter). Pure: the window draws what this returns and
// drags with rescheduleEdit (src/shared/project-hub.ts), which writes the date the way it was written.

import type { Project } from './project-file';
import { alike, connectedActionsOf, matchWorkstream, projectActions, projectMilestones, workstreams, type ConnectedAction, type HubAction, type ItemRef } from './project-hub';
import { ymd, dayFrom } from './timeline';

export type PlanZoom = 'week' | 'month' | 'quarter';
export const PLAN_ZOOMS: PlanZoom[] = ['week', 'month', 'quarter'];
export const PLAN_ZOOM_WORDS: Record<PlanZoom, string> = { week: 'Week', month: 'Month', quarter: 'Quarter' };
/** Pixels a day takes at each zoom. */
export const PLAN_PPD: Record<PlanZoom, number> = { week: 34, month: 9, quarter: 3 };

export interface PlanItem {
  id: string;
  kind: 'milestone' | 'action';
  what: string;
  who: string;
  when: string;
  day: number;
  done: boolean;
  overdue: boolean;
  status: string;
  ref: ItemRef;
  /** What it comes after, as written, and the item that is (when found). */
  after?: string;
  afterId?: string;
  phase?: string;
  /** Written in a meeting or note of the project (not its file): that note's name. */
  from?: string;
}

export interface PlanGroup {
  id: string;
  name: string;
  kind: 'milestones' | 'workstream' | 'phase' | 'other';
  owner?: string;
  status?: string;
  progress?: number;
  done?: boolean;
  ref?: ItemRef;
  items: PlanItem[];
  /** Its actions without a date (not on the timeline, counted). */
  undated: number;
  from?: number;
  to?: number;
}

export interface Plan {
  groups: PlanGroup[];
  deps: { from: string; to: string; /** The later one is planned before the one it comes after. */ clash: boolean }[];
  /** The days the items span (today included). */
  from: number;
  to: number;
  count: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/\[\[([^\]|]+)\|?[^\]]*\]\]/g, '$1').replace(/[^a-z0-9]+/g, ' ').trim();

export { matchWorkstream };

/** Finds the item a line comes after: whole words that begin it, run inside it, or contain it ("Stand" is not inside "Understand"). */
function findAfter(words: string, items: PlanItem[], self: string): string | undefined {
  const w = norm(words);
  if (!w) return undefined;
  const pool = items.filter((x) => x.id !== self);
  const ww = w.split(' ').filter(Boolean);
  const toks = (x: PlanItem) => norm(x.what).split(' ').filter(Boolean);
  const at = (t: string[], i: number, sub: string[]) => sub.every((wd, j) => t[i + j] === wd);
  const has = (t: string[], sub: string[]) => sub.length > 0 && sub.length <= t.length && t.some((_, i) => at(t, i, sub));
  const exact = pool.find((x) => norm(x.what) === w) ?? pool.find((x) => at(toks(x), 0, ww)) ?? pool.find((x) => has(toks(x), ww)) ?? pool.find((x) => has(ww, toks(x)) && norm(x.what).length >= 8);
  return exact?.id;
}

/** A project's plan: its dated milestones and actions, grouped, with dependencies. */
export function planOf(p: Project, today: number, me = '', connected: ConnectedAction[] = []): Plan {
  const streams = workstreams(p);
  const actions: HubAction[] = projectActions(p, me || p.owner || '', today);
  // Its actions written in meetings and notes too (the connected vault), as the Overview counts them.
  actions.push(...connectedActionsOf(actions, connected, me || p.owner || '', today));
  const items: PlanItem[] = [];
  for (const m of projectMilestones(p, today)) {
    if (m.day === undefined) continue;
    items.push({ id: m.id, kind: 'milestone', what: m.what, who: '', when: m.when, day: m.day, done: m.done, overdue: m.late, status: m.status, ref: m.ref, ...(m.after ? { after: m.after } : {}) });
  }
  for (const a of actions) {
    if (a.due === undefined) continue;
    // A run sheet's line that is a key date too (same day, same words) shows once, as the key date.
    if (items.some((m) => m.kind === 'milestone' && m.day === a.due && alike(m.what, a.what))) continue;
    items.push({ id: a.id, kind: 'action', what: a.what, who: a.who, when: a.when, day: a.due, done: a.done, overdue: a.overdue, status: a.done ? 'done' : '', ref: a.ref, ...(a.after ? { after: a.after } : {}), ...(a.phase ? { phase: a.phase } : {}), ...(a.from ? { from: a.from } : {}) });
  }
  for (const it of items) if (it.after) {
    const id = findAfter(it.after, items, it.id);
    if (id) it.afterId = id;
  }
  // Groups: the workstreams (programme), else the run sheet's phases, else milestones and actions.
  const groups: PlanGroup[] = [];
  const top: PlanGroup = { id: 'g:milestones', name: 'Key dates', kind: 'milestones', items: [], undated: 0 };
  const other: PlanGroup = { id: 'g:other', name: streams.length ? 'Other actions' : 'Actions', kind: 'other', items: [], undated: 0 };
  if (streams.length) {
    const ws = streams.map((w, i) => ({ id: `g:ws:${i}`, name: w.name, kind: 'workstream' as const, ...(w.owner ? { owner: w.owner } : {}), ...(w.status ? { status: w.status } : {}), ...(w.progress !== undefined ? { progress: w.progress } : {}), done: w.done, ref: w.ref, items: [] as PlanItem[], undated: 0 }));
    for (const it of items) {
      const i = matchWorkstream(`${it.what} ${it.kind === 'action' ? it.who : ''}`, streams, it.day >= today);
      (i >= 0 ? ws[i].items : it.kind === 'milestone' ? top.items : other.items).push(it);
    }
    for (const a of actions) if (a.due === undefined && !a.done) {
      const i = matchWorkstream(a.what, streams);
      if (i >= 0) ws[i].undated++;
      else other.undated++;
    }
    groups.push(top, ...ws, other);
  } else {
    const phases = new Map<string, PlanGroup>();
    for (const a of actions) if (a.phase && !phases.has(a.phase)) phases.set(a.phase, { id: `g:ph:${phases.size}`, name: a.phase, kind: 'phase', items: [], undated: 0 });
    for (const it of items) {
      if (it.kind === 'milestone') top.items.push(it);
      else (it.phase && phases.get(it.phase) ? phases.get(it.phase)! : other).items.push(it);
    }
    for (const a of actions) if (a.due === undefined && !a.done) (a.phase && phases.get(a.phase) ? phases.get(a.phase)! : other).undated++;
    groups.push(top, ...phases.values(), other);
  }
  for (const g of groups) {
    g.items.sort((a, b) => a.day - b.day || Number(b.kind === 'milestone') - Number(a.kind === 'milestone'));
    if (g.items.length) {
      g.from = g.items[0].day;
      g.to = g.items[g.items.length - 1].day;
    }
  }
  const kept = groups.filter((g) => g.items.length || g.kind === 'workstream' || (g.kind === 'phase' && g.undated));
  const byId = new Map(items.map((x) => [x.id, x]));
  const deps = items.filter((x) => x.afterId).map((x) => ({ from: x.afterId!, to: x.id, clash: byId.get(x.afterId!)!.day > x.day }));
  const days = items.map((x) => x.day);
  return { groups: kept, deps, from: Math.min(today, ...days), to: Math.max(today, ...days), count: items.length };
}

// ── The scale ────────────────────────────────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The days the timeline shows at a zoom: the plan's span with room either side, starting on a week, month or quarter. */
export function planRange(plan: Pick<Plan, 'from' | 'to'>, zoom: PlanZoom, today: number): { from: number; to: number } {
  const pad = zoom === 'week' ? 4 : zoom === 'month' ? 14 : 30;
  let from = Math.min(plan.from, today) - pad;
  let to = Math.max(plan.to, today) + pad;
  if (zoom === 'week') from -= (ymd(from).weekday + 6) % 7;
  else {
    const { y, m } = ymd(from);
    from = dayFrom(y, zoom === 'quarter' ? m - (m % 3) : m, 1);
  }
  // At least a screen's worth.
  const least = zoom === 'week' ? 35 : zoom === 'month' ? 120 : 365;
  if (to - from < least) to = from + least;
  return { from, to };
}

export interface PlanTick {
  day: number;
  label: string;
  major: boolean;
}

/** The scale's marks: days under weeks, weeks under months, months under quarters. */
export function planTicks(from: number, to: number, zoom: PlanZoom): { minor: PlanTick[]; major: PlanTick[] } {
  const minor: PlanTick[] = [];
  const major: PlanTick[] = [];
  for (let d = from; d <= to; d++) {
    const { y, m, d: dd, weekday } = ymd(d);
    if (zoom === 'week') {
      minor.push({ day: d, label: String(dd), major: weekday === 1 });
      if (weekday === 1) major.push({ day: d, label: `${dd} ${MONTHS[m]}${m === 0 && dd <= 7 ? ` ${y}` : ''}`, major: true });
    } else if (zoom === 'month') {
      if (weekday === 1) minor.push({ day: d, label: String(dd), major: false });
      if (dd === 1) major.push({ day: d, label: `${MONTHS[m]}${m === 0 ? ` ${y}` : ''}`, major: true });
    } else {
      if (dd === 1) minor.push({ day: d, label: MONTHS[m], major: m % 3 === 0 });
      if (dd === 1 && m % 3 === 0) major.push({ day: d, label: `Q${m / 3 + 1} ${y}`, major: true });
    }
  }
  return { minor, major };
}

