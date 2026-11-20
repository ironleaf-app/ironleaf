// One task, one home (p12-task-writes, 4 Nov 2026). Their walk: 199 open tick boxes, the same task in up to four
// places, "by Next week", "by Ongoing", "by Open" rot. So before a next step is added it is compared with the
// project's open tasks and its connected notes' open tasks — exact after normalising, then the on-device meaning model
// at a strict threshold — and a match updates that task instead of adding another. At write a relative day becomes a
// real date from today's date; an event condition stays as words, never a due date; Ongoing and Open read as a quiet
// state, never a date. Pure: the main side runs it (src/main/task-write.ts), the tests check it without a window.
// Nothing here is written from scratch where the vault already reads it: relative days through Quick capture's own
// parseDue (src/shared/capture.ts), absolute days through Today's readDay (src/shared/today.ts), normalising through
// the meetings' sameWhat (src/shared/meetings.ts), the cosine through the vectors (src/shared/vectors.ts).

import { parseDue } from './capture';
import { dayWords } from './days';
import { cosine } from './vectors';
import { sameWhat } from './meetings';
import { namesPerson } from './names';
// Re-exported for the check's other home (the former host app's vault-docs.mjs matches a hub task's owner tail to
// a person note with it, as Vault's routeNoteTask does).
export { namesPerson } from './names';
import { readDay as readAbsolute } from './today';

/** A short task matches by meaning at this cosine or above: strict, so a guess never merges (the tidy's note-scale bar
 *  is 0.8, where near-identical pairs score 0.85 and up and a genuinely different note on the same topic 0.45 —
 *  src/shared/weekly-tidy.ts: short lines take the near-identical bar). */
export const TASK_MEANING_MIN = 0.85;

/** Ongoing and Open are not dates: the quiet state a task reads as instead. */
export type TaskState = 'ongoing' | 'open';

export interface ResolvedWhen {
  /** The real date, as project lines keep it ("6 Nov"; a date already written stays as written). */
  when?: string;
  /** The same day as YYYY-MM-DD, for a note's canonical mark. */
  iso?: string;
  /** Ongoing or Open: kept as the word, read as a quiet state. */
  state?: TaskState;
  /** Not a day at all (an event condition, TBC): stays as words in the task. */
  words?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
// A project line writes "by" itself ("— Sam · by 6 Nov"), so a stored when never keeps a leading one.
const LEAD = /^(?:by|due(?:\s+(?:on|by))?|on|before|until)\s+/i;

/** Ongoing or Open as a task's state (null: anything else, however it is capitalised around other words). */
export function readTaskState(text: string | undefined): TaskState | null {
  const t = String(text ?? '').replace(LEAD, '').replace(/[.,;:!?)]+$/, '').trim().toLowerCase();
  if (t === 'ongoing') return 'ongoing';
  if (t === 'open') return 'open';
  return null;
}

/**
 * A "by when" at write, against today's date: a relative day ("next week", "Friday", "tomorrow") becomes a real date;
 * a real date stays as written (never rewritten into another shape); Ongoing and Open become their quiet state; an
 * event condition ("before the counter build") stays as words in the task, not as a due date. Reading old lines is
 * untouched (our readDay stays for reading): this only resolves what is written now.
 */
export function resolveWriteWhen(when: string | undefined, today: Date = new Date()): ResolvedWhen {
  const t = String(when ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return {};
  const absolute = readAbsolute(t, today);
  if (absolute && absolute.style !== 'word') {
    const kept = t.replace(LEAD, '').trim();
    return { when: kept.slice(0, 120), iso: `${absolute.year}-${pad(absolute.month + 1)}-${pad(absolute.day)}` };
  }
  const due = parseDue(t, today);
  if (due) {
    const [y, m, d] = due.iso.split('-').map(Number);
    return { when: dayWords(new Date(y, m - 1, d), today), iso: due.iso };
  }
  const state = readTaskState(t);
  if (state) return { state };
  return { words: t.slice(0, 200) };
}

/** A what to compare by: no case, marks or extra words ("Send the quote." = "send the quote"). */
export const normalizeTaskWhat = (s: string): string => sameWhat(s);

/** What the model is told on a match ("already there: <line>; updated"), the line clipped to a glance. */
export function alreadyThereWords(line: string): string {
  const clean = String(line ?? '').replace(/\s+/g, ' ').trim();
  return `already there: ${clean.length > 80 ? `${clean.slice(0, 79).trimEnd()}…` : clean}; updated`;
}

/** The first candidate at or above the strict bar (ties go to the first), or -1: below it is a new task. Skipped
 *  candidates never win (a line never matches itself). */
export function pickMeaningMatch(want: readonly number[], cands: readonly (readonly number[])[], skip?: (index: number) => boolean): number {
  let best = -1;
  let score = 0;
  for (let i = 0; i < cands.length; i++) {
    if (skip?.(i)) continue;
    const s = cosine(want, cands[i]);
    if (Number.isFinite(s) && s >= TASK_MEANING_MIN && (best < 0 || s > score)) {
      best = i;
      score = s;
    }
  }
  return best;
}

/** The plain pointer a person's page gets when their task lives on a project: a bullet, never a second tick box. */
export function taskPointerLine(what: string, projectName: string): string {
  const words = String(what ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const name = String(projectName ?? '').replace(/[[\]]/g, '').trim().slice(0, 120);
  return `- ${words} — see [[${name}]]`;
}

/** A project as fitting needs it: who owns it and who is on it. */
export interface FitProject {
  path: string;
  name: string;
  owner?: string;
  people: string[];
}

/** The one project a person owns or is on (by the hub's own name reading), or null: none fits, or two do and that
 *  is no fit — a task is never filed on a guess. */
export function fitProjectForPerson(projects: readonly FitProject[], person: string): FitProject | null {
  const p = String(person ?? '').trim();
  if (!p) return null;
  const fits = projects.filter((x) => (x.owner && namesPerson(x.owner, p)) || x.people.some((m) => namesPerson(m, p)));
  return fits.length === 1 ? fits[0] : null;
}
