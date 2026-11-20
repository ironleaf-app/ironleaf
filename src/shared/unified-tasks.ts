// One Task (t238 vault rebuild step 1, 12 Nov 2026 to the plan). Next step, action,
// to-do, follow-up, reminder-as-task, run-sheet box and Waiting are one kind: Task. Where it was written (a
// meeting, the inbox, the project, a note) is its source, a field shown as small words under the row — never a
// second copy. "Waiting on someone" is a state of a task (its owner is someone else, or it is marked waiting),
// not a list. Pure: the main side merges its rows through here (Tasks, Today), the window reads the labels,
// and the converter writes vaults that need no merging.

import { sameWhat } from './meetings';
import { isPerson } from './today-count';
import { isNearKey, isSameKey, lineKeyOf, splitLineIdentity, stepKeyOf, type LineKey, type MatchStep, type StepKey } from './one-task';

/** Where one task was written: the project file, a meeting note, the inbox, or another note. */
export type SourceKind = 'project' | 'meeting' | 'inbox' | 'note';

export interface TaskSource {
  kind: SourceKind;
  /** The note it lives in. */
  path: string;
  /** Small words under the row ("in Harbourline Cart Fix", "from Tuesday standup"). */
  label: string;
}

/** One home of a task: a project step (its What's next index) or a note line (its line from 0). */
export type TaskHome = { path: string; index: number } | { path: string; line: number };

/** One task, however many places it was written: the merged row every list shows. */
export interface UnifiedTask {
  words: string;
  owner: string;
  /** The earliest day any home promises (never hides lateness). */
  due: string | null;
  /** Done only when every home is done: open work stays visible through the changeover. */
  done: boolean;
  waiting: boolean;
  project: string | null;
  projectName: string | null;
  /** The home a tick writes first (the project's step when there is one, else the first line); the cascade
   *  (src/main/one-task.ts) writes the rest, so ticking anywhere ticks the one thing. */
  primary: TaskHome;
  sources: TaskSource[];
  homes: TaskHome[];
}

const bareTitle = (t: string) => String(t ?? '').replace(/^\d{4}-\d{2}-\d{2}\s*/, '').trim() || String(t ?? '').trim();

/** The small words under a row for one home: the meeting keeps its day (recurring meetings tell apart by it). */
export function sourceLabel(kind: SourceKind, title: string): string {
  const name = kind === 'meeting' ? String(title ?? '').trim() : bareTitle(title);
  if (kind === 'project') return `in ${name || 'the project'}`;
  if (kind === 'meeting') return `from ${name || 'a meeting'}`;
  if (kind === 'inbox') return 'in Inbox';
  return `in ${name || 'a note'}`;
}

export const sourceOf = (kind: SourceKind, path: string, title: string): TaskSource => ({ kind, path, label: sourceLabel(kind, title) });

/** Which kind of home a note is: the inbox (Inbox.md or under Inbox/), a meeting, the project file, or a note. */
export function sourceKindOf(path: string, project: string | null, type?: string): SourceKind {
  if (/(^|\/)inbox(\/|$)/i.test(path) || /(^|\/)inbox\.md$/i.test(path)) return 'inbox';
  if ((type ?? '').toLowerCase() === 'meeting') return 'meeting';
  if (project !== null && project !== undefined && path === project) return 'project';
  return 'note';
}

/** Whether a task waits on someone: marked waiting (a bare ⏳ — one with a day is another app's scheduled mark,
 *  src/shared/hub.ts QUIET_MARKS, never waiting), or owned by a known person who is not me. A stranger's name is
 *  a mention, never debt (src/shared/tasks.ts knownPeople: the one owner confidence) — it never waits. */
export function isWaiting(owner: string, text: string, me: string, known: readonly string[]): boolean {
  if (/⏳(?!\uFE0F?\s*\d{4}-\d{2}-\d{2})/u.test(String(text ?? ''))) return true;
  const who = String(owner ?? '').trim().replace(/^\[\[|\]\]$/g, '').split('|').pop()!.trim();
  if (!who || !me || !known) return false;
  const mine = String(me ?? '').trim();
  if (!mine) return false;
  if (isPerson(who, mine) && isPerson(mine, who)) return false;
  return known.some((k) => isPerson(who, k) && isPerson(k, who));
}

/** A row as the merge reads it: a project step or a note line, open or done. */
export interface MergeRow {
  words: string;
  /** The line as written (for the ⏳ mark); steps pass their What next line. */
  text: string;
  owner: string;
  due: string | null;
  done: boolean;
  /** A ⏰ line: said at its time, never merged (it rows as itself, as before). */
  reminder?: boolean;
  /** The caller's own number, kept through the merge so groups map back to rows. */
  n?: number;
  project: string | null;
  projectName: string | null;
  home: TaskHome;
  source: TaskSource;
}

/** A project step as a merge row (its What's next index is its home). `due` is the step's day as its reader
 *  reads it (the step's `when` is words, never a day). */
export function stepRow(step: MatchStep & { when?: string }, index: number, project: string, projectName: string, projectTitle: string, due: string | null = null): MergeRow {
  return {
    words: String(step.what ?? ''),
    text: String(step.what ?? ''),
    owner: String(step.who ?? '').trim(),
    due,
    done: false,
    project,
    projectName,
    home: { path: project, index },
    source: sourceOf('project', project, projectTitle),
  };
}

interface Keyed extends MergeRow {
  key: LineKey | null;
  stepKey: StepKey;
}

/** Rows grouped into one task each (the merge's grouping; done rows, reminders and rows with no title stay
 *  single). Two rows merge when the one's identity says so (src/shared/one-task.ts: the same words, or near words
 *  since t249 — one's words start with the other's, three words at least — the owner not differing, no guessing)
 *  and they belong to the same project; a row of no project merges against live projects' rows (a daily copy never
 *  rows beside its task). */
export function mergeGroups(rows: readonly MergeRow[], now: Date = new Date()): MergeRow[][] {
  const ref = now instanceof Date ? now : new Date(now);
  const keyed: Keyed[] = rows.map((r) => {
    // Titles compare, tails compare apart (a line's words carry its owner tail; the read strips it, as the
    // project's own steps arrive split).
    const split = splitLineIdentity(r.words, ref);
    const owner = r.owner || split.owner;
    return { ...r, owner, key: lineKeyOf(r.words, ref), stepKey: stepKeyOf({ what: split.title || r.words, ...(owner ? { who: owner } : {}) }) };
  });
  const used = new Array<boolean>(keyed.length).fill(false);
  const sameProject = (a: Keyed, b: Keyed) => {
    if (a.project && b.project) return a.project === b.project;
    if (!!a.project === !!b.project) return false;
    // A row of no project folds against the project's own rows only (the live-steps fold, as before); the tick
    // cascade only reaches the project's notes, so anything wider would tick half the row.
    const owned = a.project ? a : b;
    return owned.source.kind === 'project';
  };
  const mergeable = (a: Keyed, b: Keyed) => {
    if (!a.key || !b.key) return false;
    if (a.done || b.done) return false;
    if (a.reminder || b.reminder) return false;
    if (!sameProject(a, b)) return false;
    return isSameKey(a.stepKey, b.key) || isSameKey(b.stepKey, a.key) || isNearKey(a.stepKey, b.key) || isNearKey(b.stepKey, a.key);
  };
  const out: MergeRow[][] = [];
  for (let i = 0; i < keyed.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const group = [keyed[i]];
    for (let j = i + 1; j < keyed.length; j++) {
      if (used[j]) continue;
      if (group.some((g) => mergeable(g, keyed[j]))) {
        used[j] = true;
        group.push(keyed[j]);
      }
    }
    out.push(group.map(({ key, stepKey: _s, ...rest }) => rest));
  }
  return out;
}

/** Open rows merged into one task each; done rows, reminders and rows with no title row as themselves. */
export function mergeTasks(rows: readonly MergeRow[], me: string, known: readonly string[], now: Date = new Date()): UnifiedTask[] {
  return mergeGroups(rows, now).map((group) => toTask(group, me, known));
}

function toTask(group: MergeRow[], me: string, known: readonly string[]): UnifiedTask {
  // The project's step leads when one is in the group; else the first line written.
  const first = group.find((g) => 'index' in g.home) ?? group[0];
  const title = splitLineIdentity(first.words).title || first.words;
  const dues = group.map((g) => g.due).filter((d): d is string => !!d).sort();
  const owner = group.map((g) => g.owner).find((o) => o.trim()) ?? '';
  const text = group.map((g) => g.text).join('\n');
  const kinds = new Map<string, TaskSource>();
  for (const g of group) kinds.set(`${g.source.kind}\n${g.source.path}`, g.source);
  return {
    words: title.trim() || first.words,
    owner,
    due: dues[0] ?? null,
    done: group.every((g) => g.done),
    waiting: isWaiting(owner, text, me, known),
    project: first.project,
    projectName: first.projectName,
    primary: first.home,
    sources: [...kinds.values()],
    homes: group.map((g) => g.home),
  };
}

/** Whether two titles are the same task's words (the merge's reading, for callers that match one row). */
export const sameTaskWords = (a: string, b: string): boolean => !!a.trim() && sameWhat(a) === sameWhat(b);
