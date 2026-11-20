// Goals and Habits (Wave 7 part b, 24 Oct 2026; module 19 of the catalogue: "Goals, habits, streaks, reviews · Weekly
// review, streak calendar · Health"). Health and Fitness already keeps yes/no habits in its encrypted store; this module
// goes beyond it: goals with milestones and progress, habits of any kind tied to a goal, a streak calendar that shows
// Health's own habits beside these, and a weekly review that starts itself from both. Each record is a plain note:
//
//   Me/Goals and Habits/Goals/Run 100 km.md     type: goal — category, status, started, by, unit, start_value,
//                                               target_value, current; "## Why"; "## Milestones" | Milestone | Due | Done |
//   Me/Goals and Habits/Habits/Morning run.md   type: habit — goal "[[Run 100 km]]", days_a_week, status, started;
//                                               "## Log" a line per day done ("- 2026-10-24")
//   Me/Goals and Habits/Reviews/Goals review 2026-10-19.md
//                                               type: goal-review — week (its Monday), mood; "## Wins",
//                                               "## What got in the way", "## Focus next week", and how each goal and
//                                               habit went that week, written when it was saved
//
// A table or log written by hand is read by its words (a Done cell may be a day or "yes"; a log line may say the day in
// any usual way). Pure: no files, no Node, no DOM.

import { GOAL_CATEGORIES, GOAL_STATUSES, HABIT_STATUSES, REVIEW_MOODS } from './life-records';
import { defaultRecordView, type RecordViewDef } from './record-views';
import type { WsRecord } from './workspace-records';
import type { WorkToolDef } from './work-module-tools';
import { addToDay, cleanCell, dayWords, daysFrom, findByName, isYes, join, knownWord, linkName, plural, readDay, readNumber, readTable, refusedWords, sectionAt, sectionWords, str, todayOf, whenWords, type TableSpec } from './personal-records';

export const MILESTONES: TableSpec = {
  id: 'milestones',
  name: 'Milestones',
  heading: /^(milestones?|steps|stages|checkpoints)$/i,
  fields: [
    { key: 'title', label: 'Milestone', col: /^(milestone|step|what|name|stage|checkpoint)$/i, kind: 'text' },
    { key: 'due', label: 'Due', col: /^(due|by|when|date|target)$/i, kind: 'date' },
    { key: 'done', label: 'Done', col: /^(done|reached|completed?|finished)$/i, kind: 'text' },
  ],
  title: 'title',
  one: 'milestone',
};

export const LOG_HEADING = /^(log|done|days done|ticks|history)$/i;
export const WHY_HEADING = /^(why|why it matters|reason)$/i;
export const REVIEW_SECTIONS = [
  { key: 'wins', name: 'Wins', heading: /^(wins?|what went well|good things)$/i },
  { key: 'blockers', name: 'What got in the way', heading: /^(what got in the way|blockers?|hard things|what didn.t go well|challenges)$/i },
  { key: 'focus', name: 'Focus next week', heading: /^(focus next week|next week|focus|plan)$/i },
] as const;
export type ReviewKey = (typeof REVIEW_SECTIONS)[number]['key'];

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Days and weeks ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The Monday of a day's week. */
export function weekOf(iso: string): string {
  const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return addToDay(iso, { days: -((d.getDay() + 6) % 7) });
}
const weekdayOf = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay();
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addToDay(monday, { days: i }));

// ── The model ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GoalNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  type: string;
}

export interface Milestone {
  row: number;
  title: string;
  due: string | null;
  /** The day it was reached (when written as a day). */
  doneOn: string | null;
  done: boolean;
  /** Days to its due day (negative: passed). */
  days: number | null;
  goal: string;
  goalName: string;
}

export interface Goal {
  path: string;
  name: string;
  category: string;
  status: string;
  started: string | null;
  by: string | null;
  daysLeft: number | null;
  unit: string;
  startValue: number | null;
  targetValue: number | null;
  current: number | null;
  /** 0 to 1: from its numbers when it has a target, else from its milestones; null when neither says. */
  progress: number | null;
  progressFrom: 'value' | 'milestones' | 'habits' | null;
  /** Ahead of, on or behind where it would be by now going steadily from its start to its day. */
  pace: 'Ahead' | 'On pace' | 'Behind' | null;
  milestones: Milestone[];
  next: Milestone | null;
  /** Its habits (their names). */
  habits: string[];
  why: string;
  /** Achieved or dropped. */
  closed: boolean;
}

export interface Habit {
  path: string;
  name: string;
  goal: string;
  goalPath: string | null;
  /** How many days a week (7: every day). */
  perWeek: number;
  status: string;
  started: string | null;
  /** Every day it was done, oldest first. */
  days: string[];
  today: boolean;
  /** Its run: days in a row for a daily habit, weeks in a row meeting its days a week otherwise. */
  streak: number;
  unit: 'day' | 'week';
  best: number;
  /** Days done this week. */
  thisWeek: number;
  total: number;
  /** Health and Fitness's own habit (read here, kept and ticked there). */
  source: 'note' | 'health';
}

export interface Review {
  path: string;
  week: string;
  mood: string;
  wins: string;
  blockers: string;
  focus: string;
}

export interface WeekSummary {
  start: string;
  end: string;
  goals: { name: string; path: string; status: string; progress: number | null; reached: string[]; dueNext: string[] }[];
  habits: { name: string; path: string; done: number; target: number; streak: number; unit: 'day' | 'week'; source: 'note' | 'health' }[];
}

export interface GoalsModel {
  goals: Goal[];
  habits: Habit[];
  /** Health and Fitness's yes/no habits, when it is on (read-only here). */
  healthHabits: Habit[];
  reviews: Review[];
  /** Milestones not reached that are due within the module's days (and those passed), soonest first. */
  milestonesDue: Milestone[];
  week: WeekSummary;
  thisReview: Review | null;
  /** The weekly review's day (Sunday unless set), and whether this week's is due and not written. */
  reviewDay: string;
  reviewDue: boolean;
  today: string;
  remindDays: number;
}

const CLOSED = /^(achieved|dropped|done|complete|completed)$/i;

function readMilestones(n: GoalNote, today: string): Milestone[] {
  return readTable(n.content, MILESTONES).rows.map(({ row, values: v }) => {
    const due = readDay(v.due);
    const doneOn = readDay(v.done);
    const done = !!doneOn || isYes(v.done) || /^(✓|✔|☑|reached)$/i.test(v.done);
    return { row, title: v.title, due, doneOn, done, days: due ? daysFrom(today, due) : null, goal: n.path, goalName: n.title };
  });
}

export function readGoal(n: GoalNote, today: string): Goal {
  const p = n.props;
  const milestones = readMilestones(n, today);
  const startValue = readNumber(p.start_value);
  const targetValue = readNumber(p.target_value);
  const current = readNumber(p.current);
  let progress: number | null = null;
  let progressFrom: Goal['progressFrom'] = null;
  if (targetValue !== null && targetValue !== (startValue ?? 0)) {
    const from = startValue ?? 0;
    progress = Math.max(0, Math.min(1, ((current ?? from) - from) / (targetValue - from)));
    progressFrom = 'value';
  } else if (milestones.length) {
    progress = milestones.filter((m) => m.done).length / milestones.length;
    progressFrom = 'milestones';
  }
  const status = knownWord(GOAL_STATUSES, p.status) || 'Not started';
  const started = readDay(p.started);
  const by = readDay(p.by);
  let pace: Goal['pace'] = null;
  if (progress !== null && started && by && by > started && today >= started && !CLOSED.test(status)) {
    const expected = Math.min(1, daysFrom(started, today) / Math.max(1, daysFrom(started, by)));
    pace = progress >= expected + 0.08 ? 'Ahead' : progress >= expected - 0.08 ? 'On pace' : 'Behind';
  }
  const next = milestones.filter((m) => !m.done).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.row - b.row)[0] ?? null;
  return {
    path: n.path,
    name: n.title,
    category: knownWord(GOAL_CATEGORIES, p.category) || '',
    status,
    started,
    by,
    daysLeft: by ? daysFrom(today, by) : null,
    unit: str(p.unit),
    startValue,
    targetValue,
    current,
    progress,
    progressFrom,
    pace,
    milestones,
    next,
    habits: [],
    why: sectionWords(n.content, WHY_HEADING),
    closed: CLOSED.test(status),
  };
}

/** The days a habit's log says it was done (any usual way of writing a day, one per line). */
export function logDays(content: string): string[] {
  const src = String(content ?? '');
  const at = sectionAt(src, LOG_HEADING);
  if (!at) return [];
  const out = new Set<string>();
  for (const line of src.slice(at.start, at.end).split(/\r?\n/)) {
    const m = /^\s*(?:[-*+]\s+)?(?:\[[xX ]\]\s+)?(.+?)\s*(?:[—–-]\s.*)?$/.exec(line);
    if (!m || /^\[ \]/.test(line.trim().replace(/^[-*+]\s+/, ''))) continue;
    const d = readDay(m[1].split(/\s+[—–-]\s+|,\s*/)[0]);
    if (d) out.add(d);
  }
  return [...out].sort();
}

/** A habit's streaks from the days it was done. */
export function streaksOf(days: readonly string[], perWeek: number, today: string): { streak: number; unit: 'day' | 'week'; best: number; thisWeek: number; today: boolean } {
  const set = new Set(days);
  const monday = weekOf(today);
  const thisWeek = weekDays(monday).filter((d) => set.has(d) && d <= today).length;
  const doneToday = set.has(today);
  if (perWeek >= 7) {
    let streak = 0;
    let d = doneToday ? today : addToDay(today, { days: -1 });
    while (set.has(d)) {
      streak++;
      d = addToDay(d, { days: -1 });
    }
    let best = 0;
    let run = 0;
    let prev = '';
    for (const day of [...set].sort()) {
      run = prev && daysFrom(prev, day) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = day;
    }
    return { streak, unit: 'day', best: Math.max(best, streak), thisWeek, today: doneToday };
  }
  const need = Math.max(1, perWeek);
  const countIn = (mon: string) => weekDays(mon).filter((d) => set.has(d)).length;
  let streak = thisWeek >= need ? 1 : 0;
  let w = addToDay(monday, { days: -7 });
  while (countIn(w) >= need) {
    streak++;
    w = addToDay(w, { days: -7 });
  }
  // Best: every week from the first day done to now.
  let best = 0;
  let run = 0;
  if (days.length) {
    for (let mon = weekOf([...set].sort()[0]); mon <= monday; mon = addToDay(mon, { days: 7 })) {
      const ok = countIn(mon) >= need;
      if (ok) run++;
      else if (mon !== monday) run = 0;
      best = Math.max(best, run);
    }
  }
  return { streak, unit: 'week', best: Math.max(best, streak), thisWeek, today: doneToday };
}

export function readHabit(n: GoalNote, today: string, goals: readonly Goal[] = []): Habit {
  const p = n.props;
  const days = logDays(n.content).filter((d) => d <= today);
  const perWeek = Math.max(1, Math.min(7, Math.round(readNumber(p.days_a_week) ?? 7)));
  const goal = linkName(p.goal);
  const g = goal ? goals.find((x) => x.name.toLowerCase() === goal.toLowerCase()) : undefined;
  const s = streaksOf(days, perWeek, today);
  return { path: n.path, name: n.title, goal: g?.name ?? goal, goalPath: g?.path ?? null, perWeek, status: knownWord(HABIT_STATUSES, p.status) || 'Active', started: readDay(p.started), days, today: s.today, streak: s.streak, unit: s.unit, best: s.best, thisWeek: s.thisWeek, total: days.length, source: 'note' };
}

/** A Health and Fitness habit as this module shows it (days it was answered yes). */
export function healthHabit(h: { id: string; name: string; days: string[] }, today: string): Habit {
  const days = [...new Set(h.days)].filter((d) => d <= today).sort();
  const s = streaksOf(days, 7, today);
  return { path: `health:${h.id}`, name: h.name, goal: '', goalPath: null, perWeek: 7, status: 'Active', started: null, days, today: s.today, streak: s.streak, unit: 'day', best: s.best, thisWeek: s.thisWeek, total: days.length, source: 'health' };
}

export function readReview(n: GoalNote): Review {
  const sec = (key: ReviewKey) => sectionWords(n.content, REVIEW_SECTIONS.find((s) => s.key === key)!.heading);
  const week = readDay(n.props.week);
  return { path: n.path, week: week ? weekOf(week) : '', mood: knownWord(REVIEW_MOODS, n.props.mood), wins: sec('wins'), blockers: sec('blockers'), focus: sec('focus') };
}

/** The week's summary: how each goal and habit went from its Monday to its Sunday. */
export function weekSummary(goals: readonly Goal[], habits: readonly Habit[], monday: string): WeekSummary {
  const end = addToDay(monday, { days: 6 });
  const nextEnd = addToDay(monday, { days: 13 });
  return {
    start: monday,
    end,
    goals: goals
      .filter((g) => !g.closed || g.milestones.some((m) => m.doneOn && m.doneOn >= monday && m.doneOn <= end))
      .map((g) => ({ name: g.name, path: g.path, status: g.status, progress: g.progress, reached: g.milestones.filter((m) => m.doneOn && m.doneOn >= monday && m.doneOn <= end).map((m) => m.title), dueNext: g.milestones.filter((m) => !m.done && m.due && m.due > end && m.due <= nextEnd).map((m) => m.title) })),
    habits: habits
      .filter((h) => h.status === 'Active')
      .map((h) => {
        const s = streaksOf(h.days.filter((d) => d <= end), h.perWeek, end);
        return { name: h.name, path: h.path, done: weekDays(monday).filter((d) => h.days.includes(d)).length, target: h.perWeek, streak: s.streak, unit: s.unit, source: h.source };
      }),
  };
}

export function goalsModel(notes: readonly GoalNote[], today: Date | string = new Date(), opts: { remindDays?: number; reviewDay?: string; health?: { id: string; name: string; days: string[] }[] } = {}): GoalsModel {
  const t = todayOf(today);
  const remind = opts.remindDays ?? 7;
  const goals = notes.filter((n) => n.type === 'goal').map((n) => readGoal(n, t));
  const habits = notes
    .filter((n) => n.type === 'habit')
    .map((n) => readHabit(n, t, goals))
    .sort((a, b) => Number(a.status !== 'Active') - Number(b.status !== 'Active') || a.name.localeCompare(b.name));
  for (const g of goals) g.habits = habits.filter((h) => h.goalPath === g.path).map((h) => h.name);
  // A linked habit's ticks feed a goal with no target or milestones (packs uplift item 13): this week's ticks done
  // as a share of the week's targets, each habit capped at its days a week. A target or milestones still win, and a
  // closed goal keeps whatever it had.
  for (const g of goals) {
    if (g.progress !== null || g.closed) continue;
    const fed = habits.filter((h) => h.goalPath === g.path && h.status === 'Active');
    const target = fed.reduce((n, h) => n + h.perWeek, 0);
    if (!target) continue;
    g.progress = Math.max(0, Math.min(1, fed.reduce((n, h) => n + Math.min(h.thisWeek, h.perWeek), 0) / target));
    g.progressFrom = 'habits';
  }
  goals.sort((a, b) => Number(a.closed) - Number(b.closed) || (a.by ?? '9999').localeCompare(b.by ?? '9999') || a.name.localeCompare(b.name));
  const healthHabits = (opts.health ?? []).map((h) => healthHabit(h, t));
  const reviews = notes
    .filter((n) => n.type === 'goal-review')
    .map(readReview)
    .filter((r) => r.week)
    .sort((a, b) => b.week.localeCompare(a.week));
  const monday = weekOf(t);
  const thisReview = reviews.find((r) => r.week === monday) ?? null;
  const reviewDay = DAYS_OF_WEEK.find((d) => d.toLowerCase() === str(opts.reviewDay).toLowerCase()) ?? 'Sunday';
  const dueIndex = (DAYS_OF_WEEK.indexOf(reviewDay) + 6) % 7;
  const todayIndex = (weekdayOf(t) + 6) % 7;
  const milestonesDue = goals
    .filter((g) => !g.closed)
    .flatMap((g) => g.milestones.filter((m) => !m.done && m.days !== null && m.days <= remind))
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));
  return { goals, habits, healthHabits, reviews, milestonesDue, week: weekSummary(goals, [...habits, ...healthHabits], monday), thisReview, reviewDay, reviewDue: !thisReview && todayIndex >= dueIndex && (goals.length > 0 || habits.length > 0), today: t, remindDays: remind };
}

// ── Changes to a note's words ────────────────────────────────────────────────────────────────────────────────────────

/** A habit's note with a day ticked (a log line added in order) or unticked (its line taken out); the Log section made
 *  when missing. Every other line is kept. */
export function withLogDay(text: string, iso: string, done: boolean): string {
  const src = String(text ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const at = sectionAt(src, LOG_HEADING);
  if (!at) {
    if (!done) return src;
    const notes = sectionAt(src, /^notes$/i);
    const block = `## Log${eol}${eol}- ${iso}${eol}${eol}`;
    if (notes) {
      const headStart = src.lastIndexOf('##', notes.start - 1);
      return src.slice(0, headStart) + block + src.slice(headStart);
    }
    return `${src.replace(/\s*$/, '')}${eol}${eol}${block}`;
  }
  const lines = src.slice(at.start, at.end).split(/\r?\n/);
  const dayOf = (l: string) => logDays(`## Log\n${l}`)[0] ?? null;
  const has = lines.findIndex((l) => dayOf(l) === iso);
  if (!done) {
    if (has < 0) return src;
    lines.splice(has, 1);
  } else {
    if (has >= 0) return src;
    // In order: before the first later day, else after the last day, else under the heading's blank line.
    let pos = lines.findIndex((l) => (dayOf(l) ?? '') > iso);
    if (pos < 0) {
      let last = -1;
      lines.forEach((l, i) => void (dayOf(l) && (last = i)));
      pos = last >= 0 ? last + 1 : lines[0] === '' ? 1 : 0;
    }
    lines.splice(pos, 0, `- ${iso}`);
  }
  return src.slice(0, at.start) + lines.join(eol) + src.slice(at.end);
}

/** A section's words replaced (the section made before Notes, or at the end, when missing). */
export function withSectionText(text: string, heading: RegExp, name: string, words: string): string {
  const src = String(text ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const body = words.trim() ? `${eol}${words.trim().replace(/\r?\n/g, eol)}${eol}${eol}` : `${eol}${eol}`;
  const at = sectionAt(src, heading);
  if (at) return src.slice(0, at.start) + body + src.slice(at.end).replace(/^(?:\r?\n)+/, '');
  if (!words.trim()) return src;
  const notes = sectionAt(src, /^notes$/i);
  const block = `## ${name}${body}`;
  if (notes) {
    const headStart = src.lastIndexOf('##', notes.start - 1);
    return src.slice(0, headStart) + block + src.slice(headStart);
  }
  return `${src.replace(/\s*$/, '')}${eol}${eol}${block}`;
}

const yq = (s: string) => JSON.stringify(s);

export interface GoalInput {
  name: string;
  category?: string;
  status?: string;
  started?: string | null;
  by?: string | null;
  unit?: string;
  start_value?: number | null;
  target_value?: number | null;
  current?: number | null;
  why?: string;
  milestones?: { title: string; due?: string | null }[];
}

export function newGoalText(g: GoalInput): string {
  const num = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '' : ` ${v}`);
  const front = [
    'type: goal',
    `category:${g.category ? ` ${knownWord(GOAL_CATEGORIES, g.category)}` : ''}`,
    `status: ${knownWord(GOAL_STATUSES, g.status) || 'Not started'}`,
    `started:${g.started ? ` ${g.started}` : ''}`,
    `by:${g.by ? ` ${g.by}` : ''}`,
    `unit:${g.unit ? ` ${yq(g.unit)}` : ''}`,
    `start_value:${num(g.start_value)}`,
    `target_value:${num(g.target_value)}`,
    `current:${num(g.current ?? g.start_value)}`,
  ];
  const rows = (g.milestones ?? []).filter((m) => str(m.title)).map((m) => `| ${str(m.title).replace(/\|/g, '\\|')} | ${m.due ?? ' '} |   |`);
  return `---\n${front.join('\n')}\n---\n## Why\n\n${g.why ? `${g.why.trim()}\n\n` : '\n'}## Milestones\n\n| Milestone | Due | Done |\n| --- | --- | --- |\n${rows.map((r) => `${r}\n`).join('')}\n## Notes\n\n`;
}

export function newHabitText(h: { goal?: string; days_a_week?: number; started?: string; note?: string }): string {
  return `---\ntype: habit\ngoal:${h.goal ? ` ${yq(`[[${linkName(h.goal)}]]`)}` : ''}\ndays_a_week: ${Math.max(1, Math.min(7, Math.round(h.days_a_week ?? 7)))}\nstatus: Active\nstarted:${h.started ? ` ${h.started}` : ''}\n---\n## Log\n\n\n## Notes\n\n${h.note ? `${h.note}\n` : ''}`;
}

/** A weekly review's words: the person's reflections, and how each goal and habit went that week (kept as it was). */
export function newReviewText(s: WeekSummary, r: { mood?: string; wins?: string; blockers?: string; focus?: string }): string {
  const sec = (name: string, words?: string) => `## ${name}\n\n${words?.trim() ? `${words.trim()}\n` : ''}\n`;
  const pct = (p: number | null) => (p === null ? '' : ` (${Math.round(p * 100)}%)`);
  const goals = s.goals.map((g) => `- [[${g.name}]]: ${g.status}${pct(g.progress)}${g.reached.length ? `; reached ${g.reached.join(', ')}` : ''}${g.dueNext.length ? `; next week: ${g.dueNext.join(', ')}` : ''}`);
  const habits = s.habits.map((h) => `- ${h.source === 'note' ? `[[${h.name}]]` : h.name}: ${h.done} of ${h.target} days${h.streak ? `; ${plural(h.streak, h.unit)} in a row` : ''}`);
  return `---\ntype: goal-review\nweek: ${s.start}\nmood:${r.mood ? ` ${knownWord(REVIEW_MOODS, r.mood)}` : ''}\n---\n${sec('Wins', r.wins)}${sec('What got in the way', r.blockers)}${sec('Focus next week', r.focus)}## Goals this week\n\n${goals.length ? `${goals.join('\n')}\n` : 'No goals yet.\n'}\n## Habits this week\n\n${habits.length ? `${habits.join('\n')}\n` : 'No habits yet.\n'}`;
}

// ── Records for the views ────────────────────────────────────────────────────────────────────────────────────────────

export function goalRecords(m: GoalsModel): WsRecord[] {
  const out: WsRecord[] = [];
  for (const g of m.goals) {
    out.push({ id: `${g.path}::goal`, kind: 'goal', title: g.name, path: g.path, fields: { category: g.category || null, status: g.status, started: g.started, by_day: g.by, progress: g.progress === null ? null : Math.round(g.progress * 100), current: g.current, target_value: g.targetValue, unit: g.unit || null, pace: g.pace, next: g.next?.title ?? null, milestones: g.milestones.length }, links: [], ref: { at: 'note', path: g.path } });
    for (const ms of g.milestones) out.push({ id: `${g.path}::milestone:${ms.row}`, kind: 'milestone', title: ms.title || `Milestone ${ms.row + 1}`, path: g.path, fields: { goal: g.name, due: ms.due, done: ms.done, reached: ms.doneOn }, links: [`${g.path}::goal`], ref: { at: 'table', heading: 'Milestones', row: ms.row, cols: {} } });
  }
  for (const h of m.habits) out.push({ id: `${h.path}::habit`, kind: 'habit', title: h.name, path: h.path, fields: { goal: h.goal || null, days_a_week: h.perWeek, status: h.status, streak: h.streak, best: h.best, this_week: h.thisWeek, total: h.total }, links: h.goalPath ? [`${h.goalPath}::goal`] : [], ref: { at: 'note', path: h.path } });
  for (const r of m.reviews) out.push({ id: `${r.path}::greview`, kind: 'greview', title: `Week of ${r.week}`, path: r.path, fields: { week: r.week, mood: r.mood || null }, links: [], ref: { at: 'note', path: r.path } });
  return out;
}

export const GOAL_EDITABLE: Record<string, string[]> = {
  goal: ['category', 'status', 'started', 'by_day', 'current', 'target_value', 'unit'],
  milestone: ['title', 'due', 'done'],
  habit: ['goal', 'days_a_week', 'status'],
  greview: ['mood'],
};

export function goalSectionViews(section: string): RecordViewDef[] {
  const v = (kinds: WsRecord['kind'][], layout: RecordViewDef['layout'], title: string, patch: Partial<RecordViewDef> = {}): RecordViewDef => ({ ...defaultRecordView(kinds, layout, title), scope: 'vault', showDone: true, ...patch });
  if (section === 'goals')
    return [
      v(['goal'], 'board', 'Goals by status', { groupBy: 'status', fields: ['category', 'by_day', 'progress', 'next'], groupOrder: [...GOAL_STATUSES] }),
      v(['milestone'], 'timeline', 'Milestones', { dateField: 'due', fields: ['goal'], filters: [{ field: 'due', op: 'not-empty' }] }),
    ];
  return [];
}

// ── The agent tools ──────────────────────────────────────────────────────────────────────────────────────────────────

export const GOAL_TOOLS: WorkToolDef[] = [
  {
    name: 'goal_list',
    module: 'goals',
    write: false,
    title: 'Goals',
    step: 'Looked through your goals',
    description: 'The person’s goals (Ironleaf): each with its status, progress, whether it is on pace for its day, its next milestone and the habits that feed it. Use it for "how are my goals going?", "what’s my next milestone?".',
    parameters: { type: 'object', properties: { include_closed: { type: 'boolean', description: 'Achieved and dropped goals too.' } }, additionalProperties: false },
  },
  {
    name: 'goal_add',
    module: 'goals',
    write: true,
    title: 'Add a goal',
    step: 'Added a goal',
    description: 'Add a goal with what the person said: its name, category, the day it is for, why it matters, a number to reach (unit, start and target) and its milestones. Never guess a day or a number they didn’t give.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        category: { type: 'string', enum: [...GOAL_CATEGORIES] },
        by: { type: 'string', description: 'YYYY-MM-DD' },
        why: { type: 'string' },
        unit: { type: 'string', description: 'What the number counts (kg, km, $, books).' },
        start_value: { type: 'number' },
        target_value: { type: 'number' },
        milestones: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['title'], additionalProperties: false } },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'goal_milestone_done',
    module: 'goals',
    write: true,
    title: 'Mark a milestone reached',
    step: 'Marked a milestone reached',
    description: 'Mark one of a goal’s milestones reached (today, or the day the person said).',
    parameters: { type: 'object', properties: { goal: { type: 'string' }, milestone: { type: 'string' }, day: { type: 'string', description: 'YYYY-MM-DD; today when left out.' } }, required: ['goal', 'milestone'], additionalProperties: false },
  },
  {
    name: 'habit_log',
    module: 'goals',
    write: true,
    title: 'Tick a habit',
    step: 'Ticked a habit',
    description: 'Tick one of the person’s habits as done for a day (today unless they said another), or untick it with done false. Health’s own habits are ticked with its own tools.',
    parameters: { type: 'object', properties: { habit: { type: 'string' }, day: { type: 'string', description: 'YYYY-MM-DD' }, done: { type: 'boolean' } }, required: ['habit'], additionalProperties: false },
  },
  {
    name: 'habit_streaks',
    module: 'goals',
    write: false,
    title: 'Habits and streaks',
    step: 'Checked your habits and streaks',
    description: 'Each habit with whether it is done today, how many days this week against its days a week, its current streak and its best. Use it for "how’s my streak?", "what habits are left today?".',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'goal_review_week',
    module: 'goals',
    write: false,
    title: 'The week’s review',
    step: 'Looked at this week’s review',
    description: 'How the week went for each goal and habit (milestones reached, days done, streaks), and what the person wrote in their weekly review if they have. Use it for "how did my week go?", "help me write my weekly review".',
    parameters: { type: 'object', properties: { week: { type: 'string', description: 'Any day of the week, YYYY-MM-DD; this week when left out.' } }, additionalProperties: false },
  },
];

const OFF = 'The Goals module is off in Ironleaf (Settings › Packs). Say so; don’t guess at the person’s goals or habits.';

export interface GoalToolInput {
  model: GoalsModel;
  on: boolean;
  refused?: number;
  agent?: string;
}

/** A goal's number in its unit ("$900", "12 km", "3 books"). */
export function amountIn(n: number | null, unit: string): string {
  if (n === null) return '';
  const u = unit.trim();
  const num = n.toLocaleString('en-AU', { maximumFractionDigits: 2 });
  if (/^(\$|a\$|nz\$|us\$|€|£|¥)$/i.test(u)) return `${u}${num}`;
  return u ? `${num} ${u}` : num;
}
/** "12 of 21 km", "$900 of $3,000". */
export const ofTarget = (g: Pick<Goal, 'current' | 'startValue' | 'targetValue' | 'unit'>) => (g.targetValue === null ? '' : /^(\$|a\$|nz\$|us\$|€|£|¥)$/i.test(g.unit.trim()) ? `${amountIn(g.current ?? g.startValue ?? 0, g.unit)} of ${amountIn(g.targetValue, g.unit)}` : `${amountIn(g.current ?? g.startValue ?? 0, '')} of ${amountIn(g.targetValue, g.unit)}`);

const pctWords = (p: number | null) => (p === null ? '' : `${Math.round(p * 100)}%`);
export const habitTarget = (h: Pick<Habit, 'perWeek'>) => (h.perWeek >= 7 ? 'every day' : `${h.perWeek} ${h.perWeek === 1 ? 'day' : 'days'} a week`);

function goalLine(g: Goal, today: string): string {
  const num = ofTarget(g);
  return `- ${g.name}${g.category ? ` (${g.category})` : ''}: ${g.status}${g.progress !== null ? `, ${pctWords(g.progress)}${num ? ` (${num})` : ''}` : ''}${g.pace ? `, ${g.pace.toLowerCase()}` : ''}${g.by ? `; by ${dayWords(g.by, today)} (${whenWords(g.daysLeft ?? 0)})` : ''}${g.next ? `; next milestone ${g.next.title}${g.next.due ? ` due ${dayWords(g.next.due, today)}` : ''}` : ''}${g.habits.length ? `; habits: ${g.habits.join(', ')}` : ''} [${g.path}]`;
}

export function answerGoalTool(input: GoalToolInput, name: string, args: Record<string, unknown> = {}): string | null {
  const tool = GOAL_TOOLS.find((t) => t.name === name);
  if (!tool || tool.write) return null;
  if (!input.on) return OFF;
  const m = input.model;
  const refused = refusedWords(input.refused, 'goal or habit note', input.agent);
  if (name === 'goal_list') {
    const list = m.goals.filter((g) => args.include_closed === true || !g.closed);
    if (!list.length) return join([m.goals.length ? 'Every goal is achieved or dropped.' : 'No goals yet.', refused]);
    return join([`${plural(list.length, 'goal')}:`, ...list.map((g) => goalLine(g, m.today)), ...list.map((g) => smallerNextStep(g)).filter(Boolean), refused]);
  }
  if (name === 'habit_streaks') {
    const all = [...m.habits.filter((h) => h.status === 'Active'), ...m.healthHabits];
    if (!all.length) return join(['No habits yet.', refused]);
    return join([
      `${plural(all.length, 'habit')}:`,
      ...all.map((h) => `- ${h.name}${h.source === 'health' ? ' (kept in Health)' : ''}: ${h.today ? 'done today' : 'not done today'}; ${h.thisWeek} of ${Math.min(7, h.perWeek)} this week (${habitTarget(h)}); streak ${plural(h.streak, h.unit)}, best ${plural(h.best, h.unit)}${h.source === 'note' ? ` [${h.path}]` : ''}`),
      refused,
    ]);
  }
  if (name === 'goal_review_week') {
    const day = readDay(args.week) ?? m.today;
    const monday = weekOf(day);
    const s = monday === m.week.start ? m.week : weekSummary(m.goals, [...m.habits, ...m.healthHabits], monday);
    const r = m.reviews.find((x) => x.week === monday);
    return join([
      `Week of ${dayWords(s.start, m.today)} to ${dayWords(s.end, m.today)}.`,
      s.goals.length ? 'Goals:' : 'No goals yet.',
      ...s.goals.map((g) => `- ${g.name}: ${g.status}${g.progress !== null ? `, ${pctWords(g.progress)}` : ''}${g.reached.length ? `; reached ${g.reached.join(', ')}` : ''}${g.dueNext.length ? `; due next week: ${g.dueNext.join(', ')}` : ''}`),
      s.habits.length ? 'Habits:' : '',
      ...s.habits.map((h) => `- ${h.name}: ${h.done} of ${Math.min(7, h.target)} days${h.streak ? `; ${plural(h.streak, h.unit)} in a row` : ''}`),
      r ? `The person’s review [${r.path}]:${r.mood ? ` mood ${r.mood}.` : ''}${r.wins ? `\nWins: ${r.wins}` : ''}${r.blockers ? `\nWhat got in the way: ${r.blockers}` : ''}${r.focus ? `\nFocus next week: ${r.focus}` : ''}` : 'No review written for that week yet.',
      refused,
    ]);
  }
  return null;
}

/** A smaller next step for a goal behind pace (8.3 wave 1, 30 Oct 2026): half the next milestone, or one small step
 *  toward the number. Nothing when it is not behind, so a good week is not nagged. */
export function smallerNextStep(g: Goal): string {
  if (g.pace !== 'Behind' || g.closed) return '';
  if (g.next) return `A smaller step for this week: take half of “${g.next.title}” and do that first.`;
  if (g.targetValue !== null && g.current !== null) return `A smaller step for this week: move ${g.name} a little toward ${amountIn(g.targetValue, g.unit)}; even one small step counts.`;
  return `A smaller step for this week: pick the smallest part of ${g.name} and do that first.`;
}

export const findGoal = (m: GoalsModel, words: unknown) => findByName(m.goals, words, (g) => [g.name]);
export const findHabit = (m: GoalsModel, words: unknown) => findByName(m.habits, words, (h) => [h.name]);

export interface PlannedGoal {
  name: string;
  text: string;
  words: string;
}

/** goal_add's note from its arguments. Throws in plain words. */
export function planGoalAdd(args: Record<string, unknown>, ctx: { on: boolean; model: GoalsModel }): PlannedGoal {
  if (!ctx.on) throw new Error(OFF);
  const name = str(args.name).slice(0, 100);
  if (!name) throw new Error('A goal needs a name.');
  if (findGoal(ctx.model, name)?.name.toLowerCase() === name.toLowerCase()) throw new Error(`There’s already a goal called ${name}.`);
  if (str(args.by) && !readDay(args.by)) throw new Error('Give the day as YYYY-MM-DD.');
  const milestones = Array.isArray(args.milestones) ? (args.milestones as Record<string, unknown>[]).slice(0, 30).map((m) => ({ title: str(m?.title).slice(0, 120), due: m?.due ? readDay(m.due) : null })).filter((m) => m.title) : [];
  for (const m of Array.isArray(args.milestones) ? (args.milestones as Record<string, unknown>[]) : []) if (str(m?.due) && !readDay(m.due)) throw new Error(`Give ${str(m.title) || 'each milestone'}’s day as YYYY-MM-DD.`);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const g: GoalInput = { name, category: str(args.category), status: 'Not started', started: ctx.model.today, by: readDay(args.by), unit: str(args.unit).slice(0, 20), start_value: num(args.start_value), target_value: num(args.target_value), why: str(args.why).slice(0, 2000), milestones };
  return { name, text: newGoalText(g), words: `Added the goal ${name}${g.by ? `, by ${dayWords(g.by, ctx.model.today)}` : ''}${milestones.length ? `, with ${plural(milestones.length, 'milestone')}` : ''}.` };
}

/** The cell a milestone's Done gets: the day it was reached. */
export function cleanDoneCell(raw: unknown, today: string): string {
  if (raw === true) return today;
  if (raw === false || raw === null || raw === undefined || str(raw) === '') return '';
  const d = readDay(raw);
  if (d) return d;
  if (isYes(raw)) return today;
  return cleanCell(MILESTONES.fields[2], raw);
}

export { REVIEW_MOODS };
