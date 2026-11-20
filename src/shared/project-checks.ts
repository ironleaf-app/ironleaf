// The project page keeps itself up to date (10.0 item 19). The page re-checks itself whenever its notes change:
// catch-up proposals from the notes changed since the project was last updated (open actions and tasks as next steps,
// new decisions as decisions), each once, waiting on the page and on Today; and three standing checks (a stale
// decision, a risk with no owner, a slipped date), each named with its source. Nothing here writes: accepting is the
// person's tap on the page, through the project's own edits with Undo. Pure: the main side gathers the notes
// (src/main/project-checks.ts), the page and Today show what comes back.

import { spanWords } from './days';
import { DECISION_HEADING, asNextStep, findActions, sameWhat } from './meetings';
import type { Project } from './project-file';
import type { ItemRef } from './project-hub';
import { findAllTasks } from './tasks';
import { dayWords, finishedDate, readDay } from './today';

/** A decision this far past is stale: worth a fresh look. */
export const STALE_DECISION_DAYS = 90;
/** With no updated marker, only notes changed this recently count (never the whole history). */
export const CATCHUP_FALLBACK_DAYS = 30;
/** Notes read for catch-up at once, newest first. */
export const MAX_CATCHUP_NOTES = 10;
/** Proposals shown at once (past that the page says how many more, counted exactly). */
export const MAX_PROPOSALS = 20;

export type CheckKind = 'stale-decision' | 'risk-owner' | 'slipped-date';

export interface StandingCheck {
  kind: CheckKind;
  /** Plain words: what, and why it needs a look. No em dash. */
  words: string;
  /** What to do about it, where it sits. */
  detail: string;
  /** What opening it lands on (the page's own opener). */
  ref: ItemRef;
}

/** The three standing checks: slipped dates first, then risks with no owner, then stale decisions. A decision without
 *  a date is never flagged (its age can't be judged); a closed risk and a finished date never are. */
export function standingChecks(project: Project, today: Date): StandingCheck[] {
  const out: StandingCheck[] = [];
  project.dates.forEach((d, index) => {
    const r = readDay(d.when, today);
    if (!r || r.offset >= 0 || finishedDate(d.status)) return;
    out.push({
      kind: 'slipped-date',
      words: `“${d.what}” was due ${spanWords(-r.offset)} ago and is still open.`,
      detail: `Due ${d.when}. Move its date or mark it done on the Timeline.`,
      ref: { kind: 'date', index },
    });
  });
  project.risks.forEach((risk, index) => {
    if (risk.closed || risk.owner?.trim()) return;
    out.push({
      kind: 'risk-owner',
      words: `“${risk.what}” has no owner yet.`,
      detail: 'Give it an owner on the project page.',
      ref: { kind: 'risk', index },
    });
  });
  project.decisions.forEach((dec, index) => {
    if (!dec.date) return;
    const r = readDay(dec.date, today);
    if (!r || r.offset >= -STALE_DECISION_DAYS) return;
    out.push({
      kind: 'stale-decision',
      words: `“${dec.what}” was decided ${spanWords(-r.offset)} ago.`,
      detail: 'Check it still holds on the Decisions tab.',
      ref: { kind: 'decision', index },
    });
  });
  return out;
}

// ── Since when ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CheckNoteMeta {
  path: string;
  title: string;
  modified: number;
  /** A note merely linked to the project (see-also): its boxes are not the project's tasks (8 Nov 2026, calm
   *  Today: "Desk Hub: 101 waiting" was every tick box in every linked note; waiting counts the project's own
   *  notes only, as the page counts members and never bare links). Absent means the project's own. */
  linked?: boolean;
}

/** The catch-up window starts here (ms): the start of the project's updated day, else thirty days back. */
function catchupSince(updated: string | undefined, now: Date): number {
  const r = updated ? readDay(updated, now) : null;
  if (r) return new Date(r.year, r.month, r.day).getTime();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - CATCHUP_FALLBACK_DAYS).getTime();
}

/** The project's own notes changed since it was last updated, newest first, capped. A linked (see-also) note is
 *  never "changed since updated" for catch-up: its boxes are not the project's tasks. */
export function notesForCatchup(notes: readonly CheckNoteMeta[], updated: string | undefined, now: Date): CheckNoteMeta[] {
  const since = catchupSince(updated, now);
  return notes
    .filter((n) => !n.linked && n.modified > since)
    .sort((a, b) => b.modified - a.modified)
    .slice(0, MAX_CATCHUP_NOTES);
}

// ── Proposals ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CheckNote extends CheckNoteMeta {
  content: string;
}

export type ProposalKind = 'next' | 'decision';

export interface CatchProposal {
  /** Steady across days: the same words from the same note key the same (dismissals outlive restarts). */
  key: string;
  kind: ProposalKind;
  what: string;
  who?: string;
  when?: string;
  /** The note it comes from (its title and path). */
  from: string;
  path: string;
}

/** A proposal's steady key. */
export function proposalKey(kind: ProposalKind, what: string, path: string): string {
  return `${kind}\n${sameWhat(what)}\n${path.toLowerCase()}`;
}

/** One live project's checks, as `projects:checks` serves them to its page and Today. */
export interface ProjectCheckState {
  path: string;
  name: string;
  updated?: string;
  checks: StandingCheck[];
  proposals: CatchProposal[];
}

const LIST_LINE = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([^\]])\]\s+)?(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** A note's Decisions section read as lines (the meeting writers' own heading, so a section they write to is one read
 *  here): each list line with its line number, tick boxes read as what they say. */
function decisionLines(content: string): { line: number; what: string }[] {
  const lines = String(content ?? '').split(/\r?\n/);
  const out: { line: number; what: string }[] = [];
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) start = end + 1;
  }
  let fence = false;
  let inDecisions = false;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const h = HEADING.exec(l);
    if (h) {
      inDecisions = DECISION_HEADING.test(h[2]);
      continue;
    }
    if (!inDecisions) continue;
    const m = LIST_LINE.exec(l);
    if (!m || m[1].replace(/\t/g, '  ').length >= 2) continue;
    const what = m[3].replace(/\s+/g, ' ').trim();
    if (what) out.push({ line: i, what });
  }
  return out;
}

/** The catch-up proposals from the project's own changed notes: open actions and tasks not among the project's next
 *  steps (who and by when kept), and new decisions not among its decisions. Filed lines (already in a project),
 *  ticked lines, reminder lines (already scheduled) and twins stay out, and a linked (see-also) note proposes
 *  nothing: its boxes are not the project's tasks. In the notes' order, all of them (the page caps what it shows). */
export function catchUpProposals(project: Project, notes: readonly CheckNote[], now: Date = new Date()): CatchProposal[] {
  const nextWords = new Set(project.next.map((n) => sameWhat(n.what)));
  const decWords = new Set(project.decisions.map((d) => sameWhat(d.what)));
  const seen = new Set<string>();
  const out: CatchProposal[] = [];
  for (const n of notes) {
    if (n.linked) continue;
    const ref = new Date(n.modified);
    const found = findActions(n.content, { date: ref });
    // Tick boxes the actions reading already covers keep its reading (with who): the tasks reading only adds the ones
    // it misses (a tick box under Decisions), so one line is never proposed twice in different words.
    const read = new Set(found.map((a) => a.line));
    const tasks = findAllTasks(n.content, ref).filter((t) => !t.done && !t.reminder && !read.has(t.line));
    const cands: { line: number; what: string; who?: string; due?: string; filed: boolean }[] = [
      ...found.map((a) => ({ line: a.line, what: a.what, ...(a.who ? { who: a.who } : {}), ...(a.due ? { due: a.due } : {}), filed: !!a.filedTo })),
      ...tasks.map((t) => ({ line: t.line, what: t.words, ...(t.due ? { due: t.due } : {}), filed: false })),
    ].sort((a, b) => a.line - b.line);
    for (const c of cands) {
      if (c.filed) continue;
      const k = sameWhat(c.what);
      if (!k || seen.has(k) || nextWords.has(k)) continue;
      seen.add(k);
      const step = asNextStep({ what: c.what, ...(c.who ? { who: c.who } : {}), ...(c.due ? { due: c.due } : {}) }, now);
      out.push({ key: proposalKey('next', step.what, n.path), kind: 'next', what: step.what, ...(step.who ? { who: step.who } : {}), ...(step.when ? { when: step.when } : {}), from: n.title, path: n.path });
    }
    for (const d of decisionLines(n.content)) {
      const k = sameWhat(d.what);
      if (!k || seen.has(k) || decWords.has(k)) continue;
      seen.add(k);
      out.push({ key: proposalKey('decision', d.what, n.path), kind: 'decision', what: d.what, from: n.title, path: n.path });
    }
  }
  return out;
}

/** What the page shows: the first `limit` proposals, and how many more wait past them. */
export function capProposals(proposals: readonly CatchProposal[], limit: number = MAX_PROPOSALS): { shown: CatchProposal[]; more: number } {
  return { shown: proposals.slice(0, Math.max(0, limit)), more: Math.max(0, proposals.length - Math.max(0, limit)) };
}

/** An ISO day as day words ("Mon 2 Nov"), through the day reading both doors share. Anything already worded
 *  passes through; an ISO day that cannot be read is left out rather than shown raw (10.0 second round N2). */
function sinceWords(updated: string | undefined, today: Date): string {
  if (!updated) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updated.trim())) return ` since ${updated}`;
  const r = readDay(updated, today);
  if (!r) return '';
  return ` since ${new Date(r.year, r.month, r.day).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '')}`;
}

/** The banner in plain words: "3 waiting from your notes. 2 need a look." Costs are never dollars here. */
export function catchupWords(s: { proposals: number; checks: number; updated?: string }, today: Date = new Date()): string {
  const bits: string[] = [];
  if (s.proposals) bits.push(`${s.proposals} waiting from your notes${sinceWords(s.updated, today)}`);
  if (s.checks) bits.push(`${s.checks} need${s.checks === 1 ? 's' : ''} a look`);
  if (!bits.length) return 'Caught up. Nothing in your notes waits on this project.';
  return `${bits.join('. ')}.`;
}

/** "and 4 more" past the cap (a cut that is counted, never silent). */
export function moreWords(shown: number, total: number): string {
  return total > shown ? `and ${total - shown} more` : '';
}

/** Today's one folded row for the projects waiting (8 Nov 2026, calm list): "12 projects have notes
 *  waiting", opening the list. None is no row (the caller renders nothing). */
export function projectsWaitingWords(count: number): string {
  return count === 1 ? '1 project has notes waiting' : `${count} projects have notes waiting`;
}

/** A key date's day in words ("3 days overdue", "Today"): the slipped line's own. Exported for the page. */
export const slippedDayWords = (offset: number, today: Date): string => dayWords(offset, today);
