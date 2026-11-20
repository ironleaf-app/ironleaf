// Goals and Habits on the main side (Wave 7 part b; src/shared/goals.ts). Goals, habits and weekly reviews are notes:
// a value changed is one property, a milestone one row of its table, a habit ticked one line of its log, a review's
// reflections their sections. Health and Fitness's own habits are read from its store (never written here). The bell is
// told of a milestone due and of the weekly review's day, each once.

import { partOn } from '../../shared/life-modules';
import { GOAL_CATEGORIES, GOAL_STATUSES, HABIT_STATUSES, REVIEW_MOODS } from '../../shared/life-records';
import { cleanCell, dayWords, knownWord, readDay, readNumber, sectionWords, tableWithCell, tableWithRow, type PropSpec } from '../../shared/personal-records';
import { setNoteProp } from '../../shared/views';
import {
  answerGoalTool,
  cleanDoneCell,
  findGoal,
  findHabit,
  goalsModel,
  MILESTONES,
  newHabitText,
  newGoalText,
  newReviewText,
  planGoalAdd,
  REVIEW_SECTIONS,
  weekOf,
  weekSummary,
  withLogDay,
  withSectionText,
  WHY_HEADING,
  type GoalsModel,
  type ReviewKey,
} from '../../shared/goals';
import type { VaultIndex } from '../indexer';
import type { WorkModules, WorkNotice, WorkPart } from '../work-modules';
import { itemWords, namedIn, remindDaysOption, type PersonalPart } from '../personal/common';
import { agentChange, agentNote, dayOf, notesOf, O, refusedCount, removeRow, S, setCells, setProp, titleOf } from './common';

export type GoalsView = GoalsModel & { folder: string };

const TYPES = ['goal', 'habit', 'goal-review'];

const GOAL_PROPS: Record<string, PropSpec> = {
  category: { field: 'category', key: 'category', kind: 'choice', label: 'Category', options: GOAL_CATEGORIES },
  status: { field: 'status', key: 'status', kind: 'choice', label: 'Status', options: GOAL_STATUSES },
  started: { field: 'started', key: 'started', kind: 'date', label: 'Started' },
  by: { field: 'by', key: 'by', kind: 'date', label: 'Day it is for' },
  unit: { field: 'unit', key: 'unit', kind: 'text', label: 'Unit' },
  start_value: { field: 'start_value', key: 'start_value', kind: 'number', label: 'Starting number' },
  target_value: { field: 'target_value', key: 'target_value', kind: 'number', label: 'Target' },
  current: { field: 'current', key: 'current', kind: 'number', label: 'Where it is now' },
};
const HABIT_PROPS: Record<string, PropSpec> = {
  goal: { field: 'goal', key: 'goal', kind: 'link', label: 'Goal' },
  status: { field: 'status', key: 'status', kind: 'choice', label: 'Status', options: HABIT_STATUSES },
  started: { field: 'started', key: 'started', kind: 'date', label: 'Started' },
};

export function makeGoals(w: WorkModules): PersonalPart {
  const health = async () => (w.isOn('health') && partOn(w.d.prefs().modules, 'health', 'habits') ? ((await w.d.healthHabits?.().catch(() => [])) ?? []) : []);
  const model = async (index: VaultIndex = w.d.index, withHealth = true): Promise<GoalsModel> =>
    goalsModel(await notesOf(w, index, TYPES), w.today(), { remindDays: await w.remindDays('goals'), reviewDay: await w.setting('goals', 'reviewDay', 'Sunday'), health: withHealth ? await health() : [] });

  const addGoal = async (input: unknown): Promise<string> => {
    const o = O(input);
    const name = S(o.name, 100);
    if (!name) throw new Error('A goal needs a name.');
    const m = await model(w.d.index, false);
    if (m.goals.some((g) => g.name.toLowerCase() === name.toLowerCase())) throw new Error(`There’s already a goal called ${name}.`);
    const num = (k: string, label: string) => {
      const v = S(o[k], 30);
      if (!v) return null;
      const n = readNumber(v);
      if (n === null) throw new Error(`Give ${label} as a number.`);
      return n;
    };
    const milestones = Array.isArray(o.milestones) ? o.milestones.map((x) => O(x)).map((x) => ({ title: S(x.title, 120), due: x.due ? readDay(x.due) : null })).filter((x) => x.title) : [];
    const rel = await w.newNote(await w.folderOf('goal'), name, newGoalText({ name, category: S(o.category, 40), status: S(o.status, 40), started: dayOf(o.started, 'the day it started', '2026-12-20') ?? w.todayIso(), by: dayOf(o.by, 'the day it is for', '2026-12-20'), unit: S(o.unit, 20), start_value: num('start_value', 'the starting number'), target_value: num('target_value', 'the target'), why: S(o.why, 2000), milestones }));
    return rel;
  };

  const setGoal = async (rel: unknown, field: unknown, value: unknown): Promise<string | null> => {
    const r = S(rel, 1000);
    const f = S(field, 40);
    if (f === 'why') {
      await w.change(r, (text) => withSectionText(text, WHY_HEADING, 'Why', typeof value === 'string' ? value.slice(0, 4000) : ''));
      return null;
    }
    const p = GOAL_PROPS[f];
    if (!p) throw new Error('That can’t be changed here.');
    await setProp(w, r, p, value);
    if (f === 'status' && /^achieved$/i.test(S(value))) return `${titleOf(r)}: achieved. Well done.`;
    return null;
  };

  const setMilestone = async (rel: unknown, row: unknown, shown: unknown, values: unknown): Promise<string | null> => {
    const r = S(rel, 1000);
    if (typeof row !== 'number') throw new Error('That milestone isn’t there any more.');
    const v = O(values);
    const out: Record<string, string> = {};
    if (v.title !== undefined) {
      out.title = S(v.title, 200);
      if (!out.title) throw new Error('A milestone needs its words.');
    }
    if (v.due !== undefined) out.due = cleanCell(MILESTONES.fields[1], v.due);
    if (v.done !== undefined) out.done = cleanDoneCell(v.done, w.todayIso());
    if (!Object.keys(out).length) return null;
    await setCells(w, r, MILESTONES, row, typeof shown === 'string' ? shown : null, out);
    return out.done ? `${typeof shown === 'string' ? shown : 'Milestone'}: reached.` : null;
  };

  const addMilestone = async (rel: unknown, values: unknown): Promise<string> => {
    const r = S(rel, 1000);
    const v = O(values);
    const title = S(v.title, 200);
    if (!title) throw new Error('A milestone needs its words.');
    const due = cleanCell(MILESTONES.fields[1], v.due ?? '');
    await w.change(r, (text) => tableWithRow(text, MILESTONES, { title, due, done: '' }));
    return `Added the milestone ${title}.`;
  };

  const addHabit = async (input: unknown): Promise<string> => {
    const o = O(input);
    const name = S(o.name, 100);
    if (!name) throw new Error('A habit needs a name.');
    const m = await model(w.d.index, false);
    if (m.habits.some((h) => h.name.toLowerCase() === name.toLowerCase())) throw new Error(`There’s already a habit called ${name}.`);
    const n = readNumber(o.days_a_week);
    if (S(o.days_a_week) && (n === null || n < 1 || n > 7)) throw new Error('Give the days a week as a number from 1 to 7.');
    return w.newNote(await w.folderOf('habit'), name, newHabitText({ goal: S(o.goal, 100), days_a_week: n ?? 7, started: w.todayIso() }));
  };

  const tick = async (rel: unknown, day: unknown, done: unknown): Promise<string | null> => {
    const r = S(rel, 1000);
    if (S(day, 20) && !readDay(S(day, 20))) throw new Error('Give the day as YYYY-MM-DD.');
    const d = readDay(S(day, 20)) ?? w.todayIso();
    if (d > w.todayIso()) throw new Error('A day still to come can’t be ticked yet.');
    await w.change(r, (text) => withLogDay(text, d, done !== false));
    return null;
  };

  const setHabit = async (rel: unknown, field: unknown, value: unknown): Promise<null> => {
    const r = S(rel, 1000);
    const f = S(field, 40);
    if (f === 'days_a_week') {
      const n = readNumber(value);
      if (n === null || n < 1 || n > 7) throw new Error('Give the days a week as a number from 1 to 7.');
      await w.change(r, (text) => setNoteProp(text, 'days_a_week', Math.round(n)));
      return null;
    }
    const p = HABIT_PROPS[f];
    if (!p) throw new Error('That can’t be changed here.');
    await setProp(w, r, p, value);
    return null;
  };

  /** This week's review saved: its reflections written into its note (made the first time, with how the week went). */
  const saveReview = async (input: unknown): Promise<string> => {
    const o = O(input);
    const m = await model();
    if (S(o.week, 20) && !readDay(S(o.week, 20))) throw new Error('Give the week as a day, like 2026-10-19.');
    const monday = weekOf(readDay(S(o.week, 20)) ?? m.today);
    const there = m.reviews.find((r) => r.week === monday);
    const words: Partial<Record<ReviewKey, string>> = {};
    for (const s of REVIEW_SECTIONS) if (typeof o[s.key] === 'string') words[s.key] = (o[s.key] as string).slice(0, 4000);
    const mood = o.mood !== undefined ? knownWord(REVIEW_MOODS, o.mood) : undefined;
    if (there) {
      await w.change(there.path, (text) => {
        let t = text;
        for (const s of REVIEW_SECTIONS) if (words[s.key] !== undefined) t = withSectionText(t, s.heading, s.name, words[s.key]!);
        if (mood !== undefined) t = setNoteProp(t, 'mood', mood || null);
        return t;
      });
      return there.path;
    }
    const summary = monday === m.week.start ? m.week : weekSummary(m.goals, [...m.habits, ...m.healthHabits], monday);
    return w.newNote(await w.folderOf('goal-review'), `Goals review ${monday}`, newReviewText(summary, { ...words, mood }));
  };

  /** A review's "this week" lines written again from the goals and habits as they are now. */
  const refreshReview = async (rel: unknown): Promise<string> => {
    const r = S(rel, 1000);
    const m = await model();
    const rev = m.reviews.find((x) => x.path === r);
    if (!rev) throw new Error('That review isn’t there any more.');
    const fresh = newReviewText(weekSummary(m.goals, [...m.habits, ...m.healthHabits], rev.week), {});
    const sec = (name: string) => new RegExp(`## ${name}\\n\\n([\\s\\S]*?)(?=\\n## |$)`).exec(fresh)?.[1].trim() ?? '';
    const lines = { 'Goals this week': sec('Goals this week'), 'Habits this week': sec('Habits this week') };
    await w.change(r, (text) => withSectionText(withSectionText(text, /^goals this week$/i, 'Goals this week', lines['Goals this week'] ?? ''), /^habits this week$/i, 'Habits this week', lines['Habits this week'] ?? ''));
    return 'The week’s goals and habits are written again as they are now.';
  };

  const setField = async (input: unknown): Promise<string | null> => {
    const o = O(input);
    const kind = S(o.kind, 20);
    const rel = S(o.path, 1000);
    const field = S(o.field, 40);
    const value = o.value === null ? '' : o.value;
    if (kind === 'goal') return setGoal(rel, field === 'by_day' ? 'by' : field, value);
    if (kind === 'habit') return setHabit(rel, field, value);
    if (kind === 'greview' && field === 'mood') {
      await w.change(rel, (text) => setNoteProp(text, 'mood', knownWord(REVIEW_MOODS, value) || null));
      return null;
    }
    if (kind === 'milestone' && ['title', 'due', 'done'].includes(field)) {
      const ref = O(o.ref);
      return setMilestone(rel, typeof ref.row === 'number' ? ref.row : o.row, typeof o.title === 'string' ? o.title : null, { [field]: value });
    }
    throw new Error('That can’t be changed here.');
  };

  const ops: WorkPart['ops'] = {
    model: async (): Promise<GoalsView> => ({ ...(await model()), folder: await w.moduleFolder('goals') }),
    'add-goal': (input) => addGoal(input),
    'set-goal': (rel, field, value) => setGoal(rel, field, value),
    'add-milestone': (rel, values) => addMilestone(rel, values),
    'set-milestone': (rel, row, shown, values) => setMilestone(rel, row, shown, values),
    'remove-milestone': async (rel, row, shown) => `Took ${(await removeRow(w, S(rel, 1000), MILESTONES, typeof row === 'number' ? row : -1, typeof shown === 'string' ? shown : null)) || 'the milestone'} out. It is kept in the note’s history (File recovery).`,
    'add-habit': (input) => addHabit(input),
    tick: (rel, day, done) => tick(rel, day, done),
    'set-habit': (rel, field, value) => setHabit(rel, field, value),
    'save-review': (input) => saveReview(input),
    'refresh-review': (rel) => refreshReview(rel),
    'set-field': (input) => setField(input),
    options: async (patch) => {
      const o = O(patch);
      const remindDays = await remindDaysOption(w, 'goals', patch);
      if (typeof o.reviewDay === 'string') await w.setOptions('goals', { settings: { reviewDay: S(o.reviewDay, 12) } });
      return { remindDays, reviewDay: await w.setting('goals', 'reviewDay', 'Sunday') };
    },
  };

  return {
    id: 'goals',
    ops,
    async inbox(item) {
      if (item.kind !== 'line') return null;
      const m = await model(w.d.index, false);
      const h = namedIn(itemWords(item), m.habits.filter((x) => x.status === 'Active'), (x) => [x.name]);
      if (h) return { target: { kind: 'module', module: 'goals', type: 'habit', path: h.path, name: h.name, label: h.today ? `${h.name}: done today` : `Tick ${h.name} for today` }, why: `Names the habit ${h.name}` };
      const g = namedIn(itemWords(item), m.goals.filter((x) => !x.closed), (x) => [x.name]);
      if (g) return { target: { kind: 'module', module: 'goals', type: 'goal', path: g.path, name: g.name, label: `Add to ${g.name}’s notes` }, why: `Names the goal ${g.name}` };
      return null;
    },
    async fileInbox(item, target) {
      const m = await model(w.d.index, false);
      const h = m.habits.find((x) => x.path === target.path);
      if (h) {
        await w.change(h.path, (text) => withLogDay(text, m.today, true));
        return { words: `Ticked ${h.name} for today.`, paths: [h.path] };
      }
      const g = m.goals.find((x) => x.path === target.path);
      if (!g) throw new Error('That goal or habit isn’t there any more.');
      await w.change(g.path, (text) => withSectionText(text, /^notes$/i, 'Notes', [sectionWords(text, /^notes$/i), `- ${m.today}: ${item.words.trim()}`].filter(Boolean).join('\n')));
      return { words: `Added to ${g.name}’s notes.`, paths: [g.path] };
    },
    async check(): Promise<WorkNotice[]> {
      const m = await model(w.d.index, false);
      const out: WorkNotice[] = [];
      for (const ms of m.milestonesDue.filter((x) => x.days !== null && x.days <= 1))
        out.push({ key: `goal-ms:${ms.goal}:${ms.title}:${ms.due}`, kind: 'goals', title: ms.days! < 0 ? `${ms.title} was due ${dayWords(ms.due!, m.today)}` : `${ms.title} is due ${ms.days === 0 ? 'today' : 'tomorrow'}`, body: `A milestone of ${ms.goalName}`, path: ms.goal });
      if (m.reviewDue && w.part('goals', 'review')) out.push({ key: `goal-review:${m.week.start}`, kind: 'goals', title: 'Time for this week’s goals review', body: `${m.goals.filter((g) => !g.closed).length} goals and ${m.habits.filter((h) => h.status === 'Active').length} habits to look back on.`, path: '' });
      return out;
    },
    async tool(name, args, ctx) {
      const mine = await model(ctx.gated, false);
      const refused = await refusedCount(w, ctx, TYPES);
      const on = w.isOn('goals');
      const read = answerGoalTool({ model: mine, on, refused, agent: ctx.agent }, name, args);
      if (read !== null) return read;
      if (name === 'goal_add') {
        const plan = planGoalAdd(args, { on, model: mine });
        const rel = await agentNote(w, ctx, await w.folderOf('goal'), plan.name, plan.text);
        return `${plan.words} [${rel}]`;
      }
      if (name === 'goal_milestone_done') {
        const g = findGoal(mine, args.goal);
        if (!g) throw new Error(`There is no goal called “${S(args.goal)}”.${mine.goals.length ? ` Goals: ${mine.goals.map((x) => x.name).join(', ')}.` : ''}`);
        const ms = g.milestones.find((x) => x.title.toLowerCase() === S(args.milestone).toLowerCase()) ?? g.milestones.find((x) => x.title.toLowerCase().includes(S(args.milestone).toLowerCase()));
        if (!ms) throw new Error(`${g.name} has no milestone called “${S(args.milestone)}”.${g.milestones.length ? ` Its milestones: ${g.milestones.map((x) => x.title).join(', ')}.` : ''}`);
        if (S(args.day) && !readDay(args.day)) throw new Error('Give the day as YYYY-MM-DD.');
        const day = readDay(args.day) ?? mine.today;
        await agentChange(w, ctx, g.path, (text) => tableWithCell(text, MILESTONES, ms.row, ms.title, 'done', day));
        return `Marked ${ms.title} reached on ${dayWords(day, mine.today)} (${g.name}). [${g.path}]`;
      }
      if (name === 'habit_log') {
        const h = findHabit(mine, args.habit);
        if (!h) throw new Error(`There is no habit called “${S(args.habit)}” in Goals.${mine.habits.length ? ` Habits: ${mine.habits.map((x) => x.name).join(', ')}.` : ''} Health’s own habits are ticked with its tools.`);
        if (S(args.day) && !readDay(args.day)) throw new Error('Give the day as YYYY-MM-DD.');
        const day = readDay(args.day) ?? mine.today;
        if (day > mine.today) throw new Error('A day still to come can’t be ticked yet.');
        const done = args.done !== false;
        await agentChange(w, ctx, h.path, (text) => withLogDay(text, day, done));
        return `${done ? 'Ticked' : 'Unticked'} ${h.name} for ${day === mine.today ? 'today' : dayWords(day, mine.today)}. [${h.path}]`;
      }
      return `There is no tool called ${name}.`;
    },
    rules: () => 'Goals: use goal_list, habit_streaks and goal_review_week to answer about the person’s goals, habits, streaks and week; add a goal with goal_add, mark a milestone with goal_milestone_done and tick a habit with habit_log, only with what the person said (never guess a day or a number). Health’s own habits are ticked with its tools.',
  };
}

