// Goals and Habits' page (Wave 7 part b; src/shared/goals.ts, src/main/life-records/goals.ts). The Overview: today's
// habits ticked on a week strip, each goal's progress and next milestone, and this week's review. Each goal has its own
// page ("goal:<path>"): its number and progress with its pace, its milestones ticked and changed in their table, why it
// matters, and the habits that feed it. Habits sit on a streak calendar you click to tick; Health and Fitness's own habits
// show beside them (kept there). The weekly review starts itself from the goals and habits; the person writes the rest.

import { useEffect, useMemo, useRef, useState } from 'react';
import { GOALS, GOAL_CATEGORIES, GOAL_STATUSES, HABIT_STATUSES, REVIEW_MOODS } from '../../../../../shared/life-records';
import { GOAL_EDITABLE, goalRecords, ofTarget, goalSectionViews, habitTarget, REVIEW_SECTIONS, smallerNextStep, weekDays, weekOf, weekSummary, type Goal, type GoalsModel, type Habit, type Milestone, type ReviewKey } from '../../../../../shared/goals';
import { partOn } from '../../../../../shared/life-modules';
import { addToDay } from '../../../../../shared/personal-records';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { openMenu, type MenuItem } from '../../../components/Menu';
import * as A from '../../../state/actions';
import { TAKE_OFF_BUTTON, takeOffAria } from '../../../lib/removeWords';
import { openModule, partOfTab, useModules } from '../../../state/modules';
import { GoalsOverview, GoalsReview, goalsPlace } from '../w3b/Goals87';
import { peek } from '../../../state/peek';
import { useApp } from '../../../state/store';
import { useWork, workCall, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { openRecordForm, valueWords } from '../RecordForm';
import { Card, dayText, inDays, openDetail, Pill, placeOf, Tile, useWorkCtx, WithRecords, WorkShell, WorkViews } from '../work/WorkShell';
import { goalsNeeds } from '../../../../../shared/module-purpose';
import { NeedsYou } from '../NeedsYou';
import { Fact, Inline, plural, Progress, QuickAdd, saved, StatusChip } from './parts';

export type GoalsView = GoalsModel & { folder: string };

const call = <T,>(name: string, ...args: unknown[]) => workCall<T>('goals', name, ...args);
export const openGoal = (rel: string) => openDetail('goals', 'goal', rel);
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pct = (p: number | null) => (p === null ? '' : `${Math.round(p * 100)}%`);
// Goal statuses are the fixed GOAL_STATUSES words: exact matches (9.2 uplift F161), never substrings.
export const statusTone = (s: string): 'ok' | 'warn' | 'bad' | undefined => (s === 'Achieved' || s === 'On track' ? 'ok' : s === 'At risk' ? 'warn' : undefined);
const paceTone = (p: Goal['pace']) => (p === 'Behind' ? 'warn' : p ? 'ok' : 'none');
export const nextGoalStatus = (s: string) => (s === 'Not started' ? 'On track' : s === 'On track' ? 'At risk' : s === 'At risk' ? 'On track' : undefined);

// ── Doing things ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const setGoal = (g: { path: string }, field: string, value: unknown) => saved(call<string | null>('set-goal', g.path, field, value));
const setHabit = (h: { path: string }, field: string, value: unknown) => saved(call<null>('set-habit', h.path, field, value));
export const setMilestone = (ms: Milestone, values: Record<string, unknown>) => saved(call<string | null>('set-milestone', ms.goal, ms.row, ms.title, values));
export const tick = (h: Habit, day: string, done: boolean) => (h.source === 'health' ? Promise.resolve(false) : saved(call<null>('tick', h.path, day, done)));

export function newGoal(): void {
  openRecordForm({
    title: 'New goal',
    icon: 'target',
    line: 'Something you are working towards. Give it a number to reach, or milestones, to see how far along it is.',
    ok: 'Set the goal',
    fields: [
      { key: 'name', label: 'Goal', kind: 'text', required: true, wide: true, placeholder: 'Run a half marathon' },
      { key: 'category', label: 'Kind of goal', kind: 'choice', options: ['', ...GOAL_CATEGORIES] },
      { key: 'by', label: 'By', kind: 'date', hint: 'The day you mean to get there.' },
      { key: 'unit', label: 'What you count', kind: 'text', placeholder: 'km, kg, $, books', hint: 'Leave empty to follow milestones only.' },
      { key: 'start_value', label: 'Starting at', kind: 'number' },
      { key: 'target_value', label: 'Target', kind: 'number' },
      { key: 'why', label: 'Why it matters', kind: 'text', wide: true },
      { key: 'milestones', label: 'Milestones (one per line, optional)', kind: 'text', wide: true, placeholder: 'First 5 km; 10 km; 21 km', hint: 'Separate them with ;. Add their days on the goal’s page.' },
    ],
    submit: async (v) => {
      const milestones = valueWords(v, 'milestones').split(/\s*[;\n]\s*/).filter(Boolean).map((title) => ({ title }));
      const rel = await call<string>('add-goal', { name: valueWords(v, 'name'), category: valueWords(v, 'category'), by: valueWords(v, 'by'), unit: valueWords(v, 'unit'), start_value: valueWords(v, 'start_value'), target_value: valueWords(v, 'target_value'), why: valueWords(v, 'why'), milestones });
      await workDid(Promise.resolve(rel), `Set the goal ${valueWords(v, 'name')}.`, { label: 'Open', run: () => openGoal(rel) });
    },
  });
}

export function newHabit(goals: Goal[], goal?: string): void {
  openRecordForm({
    title: 'New habit',
    icon: 'check',
    line: 'Something you do each day or a few times a week. Tick it off to keep the streak going.',
    ok: 'Add the habit',
    fields: [
      { key: 'name', label: 'Habit', kind: 'text', required: true, wide: true, placeholder: 'Read for 20 minutes' },
      { key: 'days_a_week', label: 'Days a week', kind: 'segment', options: ['7', '6', '5', '4', '3', '2', '1'], value: '7' },
      { key: 'goal', label: 'For the goal', kind: 'choice', options: ['', ...goals.filter((g) => !g.closed).map((g) => g.name)], value: goal ?? '' },
    ],
    submit: async (v) => {
      await call<string>('add-habit', { name: valueWords(v, 'name'), days_a_week: valueWords(v, 'days_a_week'), goal: valueWords(v, 'goal') });
      // After-add rule (9.2 uplift F43): it went to the list — its name, and a link that opens it. Never auto-open.
      await workDid(Promise.resolve(null), `Added the habit ${valueWords(v, 'name')}.`, { label: 'Open', run: () => openModule('goals', 'habits') });
    },
  });
}

export function goalsOptions(remind: number, reviewDay: string): void {
  openRecordForm({
    title: 'Goals options',
    icon: 'settings',
    ok: 'Save',
    fields: [
      { key: 'reviewDay', label: 'Weekly review on', kind: 'choice', options: ['Friday', 'Saturday', 'Sunday', 'Monday'], value: reviewDay, hint: 'Today and the bell remind you that day until it is written.' },
      { key: 'remind', label: 'Say a milestone is coming this many days ahead', kind: 'number', value: String(remind) },
    ],
    submit: async (v) => {
      const n = Math.max(0, Math.min(90, Math.round(Number(valueWords(v, 'remind')) || 0)));
      await workDid(call('options', { remindDays: n, reviewDay: valueWords(v, 'reviewDay') }), `Weekly review on ${valueWords(v, 'reviewDay')}; milestones come up ${plural(n, 'day')} ahead.`);
    },
  });
}

function goalMenu(g: Goal, canEdit: boolean, onPage: boolean, goals: Goal[]): MenuItem[] {
  return [
    ...(onPage ? [] : [{ label: 'Open the goal', icon: 'eye' as const, run: () => openGoal(g.path) }]),
    { label: 'Status', icon: 'flag', disabled: !canEdit, submenu: GOAL_STATUSES.map((s) => ({ label: s, checked: g.status === s, run: () => void setGoal(g, 'status', s) })) },
    { label: 'Add a habit for it…', icon: 'check', disabled: !canEdit, run: () => newHabit(goals, g.name) },
    ...(!g.closed ? [{ label: 'Put away as achieved', icon: 'check' as const, disabled: !canEdit, run: () => void setGoal(g, 'status', 'Achieved') }, { label: 'Put away as dropped', icon: 'flag' as const, disabled: !canEdit, run: () => void setGoal(g, 'status', 'Dropped') }] : []),
    { separator: true },
    { label: 'Open its note', icon: 'notes', run: () => A.openPath(g.path, { where: 'tab' }) },
  ];
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A habit's week, Monday to Sunday: each day a tick box (days to come shown, not tickable). */
function WeekStrip({ h, today, canEdit }: { h: Habit; today: string; canEdit: boolean }) {
  const days = weekDays(weekOf(today));
  const set = new Set(h.days);
  return (
    <span className="lr-week" role="group" aria-label={`${h.name} this week`}>
      {days.map((d, i) => {
        const done = set.has(d);
        const future = d > today;
        return (
          <button key={d} type="button" className={`lr-day${done ? ' is-done' : ''}${d === today ? ' is-today' : ''}${future ? ' is-future' : ''}`} disabled={!canEdit || future || h.source === 'health'} title={`${dayText(d)}${done ? ': done' : ''}${h.source === 'health' ? ' (kept in Health)' : ''}`} aria-label={`${dayText(d)}: ${done ? 'done' : 'not done'}`} aria-pressed={done} onClick={() => void tick(h, d, !done)}>
            {done ? <Icon name="check" size={11} /> : DAY_LETTERS[i]}
          </button>
        );
      })}
    </span>
  );
}

function StreakBadge({ h }: { h: Habit }) {
  if (!h.streak) return <span className="lr-streak is-none">No streak yet</span>;
  return (
    <span className="lr-streak" title={`Best: ${plural(h.best, h.unit)}`}>
      <Icon name="bolt" size={12} /> {plural(h.streak, h.unit)}
    </span>
  );
}

function HabitRow({ h, today, canEdit }: { h: Habit; today: string; canEdit: boolean }) {
  return (
    <li className={`lr-habit${h.today ? ' is-done' : ''}`}>
      <span className="lr-habit-words">
        <span className="lr-habit-name">
          {h.name}
          {h.source === 'health' && <span className="lr-tag">Health</span>}
        </span>
        <span className="lr-habit-sub">
          {[habitTarget(h), `${h.thisWeek} of ${h.perWeek} this week`, h.goal && `for ${h.goal}`].filter(Boolean).join(' · ')}
        </span>
      </span>
      <WeekStrip h={h} today={today} canEdit={canEdit} />
      <StreakBadge h={h} />
    </li>
  );
}

function GoalRow({ g, today, canEdit }: { g: Goal; today: string; canEdit: boolean }) {
  return (
    <li className="lr-goal">
      <div className="lr-goal-top">
        <button type="button" className="lr-goal-name" onClick={() => openGoal(g.path)}>
          {g.name}
        </button>
        <StatusChip status={g.status} next={nextGoalStatus(g.status)} canEdit={canEdit} onSet={(s) => void setGoal(g, 'status', s)} />
      </div>
      <Progress value={g.progress} tone={statusTone(g.status)} words={[pct(g.progress), g.targetValue !== null ? ofTarget(g) : g.milestones.length ? `${g.milestones.filter((m) => m.done).length} of ${plural(g.milestones.length, 'milestone')}` : ''].filter(Boolean).join(' · ') || 'No number or milestones yet'} />
      <div className="lr-goal-foot">
        {g.next ? (
          <span className="lr-goal-next">
            Next: <strong>{g.next.title}</strong>
            {g.next.due && <span className={g.next.days !== null && g.next.days < 0 ? 'is-late' : ''}> · {g.next.days !== null && g.next.days < 0 ? `was due ${dayText(g.next.due)}` : `${dayText(g.next.due)}, ${inDays(g.next.due, today)}`}</span>}
          </span>
        ) : (
          <span className="lr-goal-next">{g.by ? `By ${dayText(g.by)} (${inDays(g.by, today)})` : 'No day set'}</span>
        )}
        {g.pace && <Pill tone={paceTone(g.pace)}>{g.pace}</Pill>}
        {g.next && (
          <button type="button" className="button small" disabled={!canEdit} onClick={() => void setMilestone(g.next!, { done: true })} title={`Mark ${g.next.title} reached today`}>
            <Icon name="check" size={12} /> Reached: {g.next.title}
          </button>
        )}
      </div>
    </li>
  );
}

// ── A month of a habit ───────────────────────────────────────────────────────────────────────────────────────────────

function MonthCalendar({ h, today, canEdit }: { h: Habit; today: string; canEdit: boolean }) {
  const [shift, setShift] = useState(0);
  const base = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + shift, 1);
  const y = base.getFullYear();
  const mo = base.getMonth();
  const first = (base.getDay() + 6) % 7;
  const daysIn = new Date(y, mo + 1, 0).getDate();
  const iso = (d: number) => `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const set = new Set(h.days);
  const done = Array.from({ length: daysIn }, (_, i) => iso(i + 1)).filter((d) => set.has(d)).length;
  return (
    <div className="lr-month">
      <div className="lr-month-head">
        <button type="button" className="icon-button small" aria-label="The month before" onClick={() => setShift(shift - 1)}>
          <Icon name="back" size={12} />
        </button>
        <span className="lr-month-name">
          {MONTHS[mo]} {y !== Number(today.slice(0, 4)) ? y : ''}
          <span className="lr-month-n"> · {plural(done, 'day')}</span>
        </span>
        <button type="button" className="icon-button small" aria-label="The month after" disabled={shift >= 0} onClick={() => setShift(shift + 1)}>
          <Icon name="forward" size={12} />
        </button>
      </div>
      <div className="lr-month-grid" role="grid" aria-label={`${h.name}, ${MONTHS[mo]} ${y}`}>
        {DAY_LETTERS.map((l, i) => (
          <span key={`h${i}`} className="lr-month-dow" aria-hidden="true">
            {l}
          </span>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {Array.from({ length: daysIn }, (_, i) => {
          const d = iso(i + 1);
          const on = set.has(d);
          const future = d > today;
          return (
            <button key={d} type="button" className={`lr-cal-day${on ? ' is-done' : ''}${d === today ? ' is-today' : ''}${future ? ' is-future' : ''}`} disabled={!canEdit || future || h.source === 'health'} aria-pressed={on} aria-label={`${dayText(d)}: ${on ? 'done' : 'not done'}`} onClick={() => void tick(h, d, !on)}>
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HabitCard({ h, m, canEdit }: { h: Habit; m: GoalsView; canEdit: boolean }) {
  const menu = (): MenuItem[] => [
    { label: 'Days a week', icon: 'calendar', disabled: !canEdit, submenu: [7, 6, 5, 4, 3, 2, 1].map((n) => ({ label: n === 7 ? 'Every day' : `${n} ${n === 1 ? 'day' : 'days'} a week`, checked: h.perWeek === n, run: () => void setHabit(h, 'days_a_week', n) })) },
    { label: 'For the goal', icon: 'target', disabled: !canEdit, submenu: [{ label: 'No goal', checked: !h.goal, run: () => void setHabit(h, 'goal', '') }, ...m.goals.filter((g) => !g.closed).map((g) => ({ label: g.name, checked: h.goalPath === g.path, run: () => void setHabit(h, 'goal', g.name) }))] },
    { label: 'Status', icon: 'flag', disabled: !canEdit, submenu: HABIT_STATUSES.map((s) => ({ label: s, checked: h.status === s, run: () => void setHabit(h, 'status', s) })) },
    { separator: true },
    { label: 'Open its note', icon: 'notes', run: () => A.openPath(h.path, { where: 'tab' }) },
  ];
  return (
    <li className={`lr-habit-card${h.status !== 'Active' ? ' is-paused' : ''}`}>
      <header className="lr-habit-card-head">
        <span className="lr-habit-words">
          <span className="lr-habit-name">
            {h.name}
            {h.source === 'health' && <span className="lr-tag">Health</span>}
            {h.status !== 'Active' && <Pill>{h.status}</Pill>}
          </span>
          <span className="lr-habit-sub">{[habitTarget(h), h.goal && `for ${h.goal}`, h.source === 'health' && 'kept and ticked in Health'].filter(Boolean).join(' · ')}</span>
        </span>
        {h.source === 'note' ? (
          <button type="button" className="icon-button small" aria-label={`More for ${h.name}`} onClick={(e) => openMenu(e.currentTarget, menu())}>
            <Icon name="more" size={13} />
          </button>
        ) : (
          <button type="button" className="text-button" onClick={() => openModule('health')}>
            Health
          </button>
        )}
      </header>
      <div className="lr-habit-stats">
        <span>
          <strong>{h.streak}</strong> {h.unit === 'day' ? 'days' : 'weeks'} in a row
        </span>
        <span>
          <strong>{h.best}</strong> best
        </span>
        <span>
          <strong>{h.thisWeek}</strong> of {h.perWeek} this week
        </span>
        <span>
          <strong>{h.total}</strong> in all
        </span>
      </div>
      <MonthCalendar h={h} today={m.today} canEdit={canEdit} />
    </li>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function Overview({ m, canEdit }: { m: GoalsView; canEdit: boolean }) {
  const modules = useModules();
  const habitsOn = partOn(modules, 'goals', 'habits');
  const reviewOn = partOn(modules, 'goals', 'review');
  const active = m.goals.filter((g) => !g.closed);
  const habits = [...m.habits.filter((h) => h.status === 'Active'), ...m.healthHabits];
  const doneToday = habits.filter((h) => h.today).length;
  const best = [...habits].sort((a, b) => b.streak - a.streak)[0];
  // Exact status words only (W5-25): "Not on track" never counts as on track.
  const onTrack = active.filter((g) => g.status === 'On track' || g.status === 'Achieved' || g.pace === 'Ahead' || g.pace === 'On pace').length;
  return (
    <div className="rm-overview">
      <NeedsYou cards={goalsNeeds(m.milestonesDue, habitsOn ? habits.map((h) => ({ name: h.name, path: h.path, doneToday: h.today })) : [], active.filter((g) => g.pace === 'Behind' || g.status === 'At risk').map((g) => ({ name: g.name, path: g.path, status: g.status, nextDue: g.next?.due ?? null })), m.today)} today={m.today} canEdit={canEdit} onAction={(c) => { if (c.id.startsWith('habit:')) openModule('goals', 'habits'); else if (c.ref) openGoal(c.ref); }} />
      <div className="rm-tiles">
        <Tile icon="target" label="Goals" value={String(active.length)} sub={active.length ? `${onTrack} on track` : 'None yet'} onClick={() => openModule('goals', 'goals')} />
        {habitsOn && <Tile icon="check" label="Habits today" value={`${doneToday} of ${habits.length}`} sub={habits.length ? (doneToday === habits.length ? 'All done' : `${habits.length - doneToday} to go`) : 'None yet'} tone={habits.length && doneToday === habits.length ? 'ok' : undefined} onClick={() => openModule('goals', 'habits')} />}
        {habitsOn && <Tile icon="bolt" label="Longest streak" value={best?.streak ? plural(best.streak, best.unit) : ''} sub={best?.streak ? best.name : 'Tick a habit to start one'} />}
        {reviewOn && <Tile icon="review" label="Weekly review" value={m.thisReview ? 'Written' : m.reviewDue ? 'Due' : 'Not yet'} sub={m.thisReview ? `Week of ${dayText(m.week.start)}` : `On ${m.reviewDay}`} tone={m.reviewDue ? 'warn' : m.thisReview ? 'ok' : undefined} onClick={() => openModule('goals', 'review')} />}
      </div>
      <div className="rm-cols lr-goals-cols">
        <Card id="goals" title="Goals" count={active.length} link={{ label: 'All goals', run: () => openModule('goals', 'goals') }}>
          {active.length ? (
            <ul className="lr-goal-list">
              {active.map((g) => (
                <GoalRow key={g.path} g={g} today={m.today} canEdit={canEdit} />
              ))}
            </ul>
          ) : (
            <p className="rm-none">No goals yet. Set one with a number to reach or a few milestones.</p>
          )}
        </Card>
        {habitsOn && (
          <Card id="habits" title="Today’s habits" count={habits.length} link={{ label: 'Streak calendar', run: () => openModule('goals', 'habits') }} actions={canEdit ? <button type="button" className="text-button" onClick={() => newHabit(m.goals)}><Icon name="plus" size={12} /> Add</button> : undefined}>
            {habits.length ? (
              <ul className="lr-habit-list">
                {habits.map((h) => (
                  <HabitRow key={h.path} h={h} today={m.today} canEdit={canEdit} />
                ))}
              </ul>
            ) : (
              <p className="rm-none">No habits yet. Add one to tick it off each day.</p>
            )}
          </Card>
        )}
      </div>
      {m.milestonesDue.length > 0 && (
        <Card id="due" title="Milestones coming up" count={m.milestonesDue.length}>
          <ul className="rm-rows">
            {m.milestonesDue.map((ms) => (
              <li key={`${ms.goal}:${ms.row}`} className={`rm-row${ms.days !== null && ms.days < 0 ? ' is-late' : ''}`}>
                <button type="button" className="rm-row-main" onClick={() => openGoal(ms.goal)}>
                  <span className="rm-row-icon" aria-hidden="true">
                    <Icon name="flag" size={14} />
                  </span>
                  <span className="rm-row-words">
                    <span className="rm-row-name">{ms.title}</span>
                    <span className="rm-row-sub">{[ms.goalName, ms.due && (ms.days! < 0 ? `was due ${dayText(ms.due)}` : `${dayText(ms.due)}, ${inDays(ms.due, m.today)}`)].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
                <span className="rm-row-end">
                  <button type="button" className="button small" disabled={!canEdit} onClick={() => void setMilestone(ms, { done: true })}>
                    <Icon name="check" size={12} /> Reached: {ms.title}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── A goal's own page ────────────────────────────────────────────────────────────────────────────────────────────────

function MilestonesCard({ g, canEdit }: { g: Goal; canEdit: boolean }) {
  return (
    <Card id="milestones" title="Milestones" count={g.milestones.length}>
      {g.milestones.length ? (
        <ul className="lr-ms-list">
          {g.milestones.map((ms) => (
            <li key={ms.row} className={`lr-ms${ms.done ? ' is-done' : ''}${!ms.done && ms.days !== null && ms.days < 0 ? ' is-late' : ''}`}>
              <button type="button" className={`lr-check${ms.done ? ' is-on' : ''}`} role="checkbox" aria-checked={ms.done} aria-label={`${ms.title}: ${ms.done ? 'reached' : 'not reached'}`} disabled={!canEdit} onClick={() => void setMilestone(ms, { done: !ms.done })}>
                {ms.done && <Icon name="check" size={11} />}
              </button>
              <span className="lr-ms-title">
                <Inline value={ms.title} label="Milestone" canEdit={canEdit} onSave={(v) => setMilestone(ms, { title: v })} />
              </span>
              <span className="lr-ms-due">
                <Inline value={ms.due ?? ''} shown={ms.due ? (ms.done ? dayText(ms.due) : `${dayText(ms.due)} · ${inDays(ms.due)}`) : undefined} label="Due" kind="date" placeholder="Add a day" canEdit={canEdit} onSave={(v) => setMilestone(ms, { due: v })} />
              </span>
              <span className="lr-ms-done">{ms.doneOn ? `Reached ${dayText(ms.doneOn)}` : ''}</span>
              <button type="button" className="icon-button small" aria-label={takeOffAria(ms.title)} title={TAKE_OFF_BUTTON} disabled={!canEdit} onClick={() => void workDid(call<string>('remove-milestone', g.path, ms.row, ms.title))}>
                <Icon name="trash" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rm-none">No milestones yet. Break the goal into a few steps you can tick off.</p>
      )}
      <QuickAdd compact placeholder="Add a milestone and press Enter" canEdit={canEdit} onAdd={(w) => workDid(call<string>('add-milestone', g.path, { title: w })).then((r) => r !== null)} />
    </Card>
  );
}

function GoalPage({ g, m, canEdit }: { g: Goal; m: GoalsView; canEdit: boolean }) {
  const habits = m.habits.filter((h) => h.goalPath === g.path);
  const set = (field: string) => (v: string) => setGoal(g, field, v);
  return (
    <div className="lr-detail">
      <div className="lr-detail-main">
        <Card id="progress" title="Progress">
          <div className="lr-progress-big">
            <div className="lr-big-num">
              <span className="lr-big-value">{pct(g.progress) || ''}</span>
              <span className="lr-big-sub">{g.progressFrom === 'value' ? 'of the way from start to target' : g.progressFrom === 'milestones' ? 'of its milestones reached' : g.progressFrom === 'habits' ? 'of this week’s ticks done' : 'Give it a target or milestones'}</span>
            </div>
            {g.pace && <Pill tone={paceTone(g.pace)}>{g.pace === 'On pace' ? 'On pace for its day' : g.pace === 'Ahead' ? 'Ahead of pace' : 'Behind pace'}</Pill>}
          </div>
          {smallerNextStep(g) && <p className="lr-hint">{smallerNextStep(g)}</p>}
          <Progress value={g.progress} tone={statusTone(g.status)} />
          <div className="lr-facts lr-num-facts">
            <Fact label="Now">
              <Inline value={g.current !== null ? String(g.current) : ''} label="Where it is now" kind="number" placeholder="Add" canEdit={canEdit} onSave={set('current')} />
            </Fact>
            <Fact label="Target">
              <Inline value={g.targetValue !== null ? String(g.targetValue) : ''} label="Target" kind="number" placeholder="Add" canEdit={canEdit} onSave={set('target_value')} />
            </Fact>
            <Fact label="Started at">
              <Inline value={g.startValue !== null ? String(g.startValue) : ''} label="Starting number" kind="number" placeholder="Add" canEdit={canEdit} onSave={set('start_value')} />
            </Fact>
            <Fact label="Counted in">
              <Inline value={g.unit} label="Unit" placeholder="km, kg, $" canEdit={canEdit} onSave={set('unit')} />
            </Fact>
          </div>
        </Card>
        <MilestonesCard g={g} canEdit={canEdit} />
        <Card id="habits" title="Habits for it" count={habits.length} actions={canEdit ? <button type="button" className="text-button" onClick={() => newHabit(m.goals, g.name)}><Icon name="plus" size={12} /> Add a habit</button> : undefined}>
          {habits.length ? (
            <ul className="lr-habit-list">
              {habits.map((h) => (
                <HabitRow key={h.path} h={h} today={m.today} canEdit={canEdit} />
              ))}
            </ul>
          ) : (
            <p className="rm-none">No habits feed this goal yet. A small daily habit is the surest way there.</p>
          )}
        </Card>
      </div>
      <aside className="lr-detail-side">
        <Card id="details" title="Details">
          <div className="lr-facts">
            <Fact label="Status">
              <Inline value={g.status} shown={<Pill tone={statusTone(g.status)}>{g.status}</Pill>} label="Status" kind="choice" options={[...GOAL_STATUSES]} canEdit={canEdit} onSave={set('status')} />
            </Fact>
            <Fact label="Kind">
              <Inline value={g.category} label="Kind of goal" kind="choice" options={['', ...GOAL_CATEGORIES]} placeholder="Choose" canEdit={canEdit} onSave={set('category')} />
            </Fact>
            <Fact label="Started">
              <Inline value={g.started ?? ''} shown={g.started ? dayText(g.started) : undefined} label="Started" kind="date" placeholder="Add a day" canEdit={canEdit} onSave={set('started')} />
            </Fact>
            <Fact label="By">
              <Inline value={g.by ?? ''} shown={g.by ? `${dayText(g.by)} · ${inDays(g.by, m.today)}` : undefined} label="Day it is for" kind="date" placeholder="Add a day" canEdit={canEdit} onSave={set('by')} />
            </Fact>
          </div>
        </Card>
        <Card id="why" title="Why it matters">
          <Inline value={g.why} label="Why it matters" kind="long" placeholder="Write why this goal matters to you" canEdit={canEdit} onSave={set('why')} className="lr-why" />
        </Card>
      </aside>
    </div>
  );
}

// ── The weekly review ────────────────────────────────────────────────────────────────────────────────────────────────

function Reflection({ label, value, placeholder, canEdit, onSave }: { label: string; value: string; placeholder: string; canEdit: boolean; onSave(v: string): Promise<boolean> }) {
  return (
    <div className="lr-reflect">
      <h4>{label}</h4>
      <Inline value={value} label={label} kind="long" placeholder={placeholder} canEdit={canEdit} onSave={onSave} className="lr-reflect-words" />
    </div>
  );
}

function ReviewPage({ m, canEdit }: { m: GoalsView; canEdit: boolean }) {
  const [back, setBack] = useState(0);
  const refreshed = useRef('');
  const monday = addToDay(m.week.start, { days: -7 * back });
  // The numbers refresh on their own when the review is opened (8.3 wave 1), so what it says is as things stand.
  useEffect(() => {
    const r = m.reviews.find((x) => x.week === monday);
    if (!r || refreshed.current === r.path) return;
    refreshed.current = r.path;
    void workDid(call<string>('refresh-review', r.path));
  }, [m.reviews, monday]);
  const s = useMemo(() => (monday === m.week.start ? m.week : weekSummary(m.goals, [...m.habits, ...m.healthHabits], monday)), [m, monday]);
  const r = m.reviews.find((x) => x.week === monday) ?? null;
  const save = (key: ReviewKey | 'mood') => async (v: string) => {
    return saved(call<string>('save-review', { week: monday, [key]: v }), r ? '' : 'The week’s review is saved.');
  };
  const placeholders: Record<ReviewKey, string> = { wins: 'What went well this week?', blockers: 'What got in the way?', focus: 'What matters most next week?' };
  return (
    <div className="rm-overview">
      <div className="lr-review-bar">
        <button type="button" className="icon-button small" aria-label="The week before" onClick={() => setBack(back + 1)}>
          <Icon name="back" size={13} />
        </button>
        <span className="lr-review-week">
          {back === 0 ? 'This week' : back === 1 ? 'Last week' : `Week of ${dayText(monday)}`} · {dayText(s.start)} to {dayText(s.end)}
        </span>
        <button type="button" className="icon-button small" aria-label="The week after" disabled={back === 0} onClick={() => setBack(back - 1)}>
          <Icon name="forward" size={13} />
        </button>
        {r && (
          <span className="lr-review-tools">
            <button type="button" className="text-button" onClick={() => void workDid(call<string>('refresh-review', r.path))} title="Write how the goals and habits went this week again, as they are now">
              <Icon name="refresh" size={12} /> Update the numbers
            </button>
            <button type="button" className="text-button" onClick={() => peek({ type: 'note', path: r.path }, { title: A.titleOf(r.path), type: 'note' })}>
              <Icon name="notes" size={12} /> Its note
            </button>
          </span>
        )}
      </div>
      <p className="lr-hint">This review is about your goals and habits. It is not the Weekly you send out (Weekly Updates), or the Weekly Review over your projects.</p>
      <div className="rm-cols">
        <Card id="reflect" title={r ? 'Your review' : 'Write the review'}>
          <div className="lr-mood" role="group" aria-label="How the week felt">
            <span className="lr-mood-label">The week felt</span>
            {REVIEW_MOODS.map((mood) => (
              <button key={mood} type="button" className={`lr-filter${r?.mood === mood ? ' is-on' : ''}`} aria-pressed={r?.mood === mood} disabled={!canEdit} onClick={() => void save('mood')(r?.mood === mood ? '' : mood)}>
                {mood}
              </button>
            ))}
          </div>
          {REVIEW_SECTIONS.map((sec) => (
            <Reflection key={sec.key} label={sec.name} value={r?.[sec.key] ?? ''} placeholder={placeholders[sec.key]} canEdit={canEdit} onSave={save(sec.key)} />
          ))}
          {!r && <p className="lr-hint">Writing anything here saves the week’s review as a note, with how each goal and habit went.</p>}
        </Card>
        <Card id="week" title="How the week went">
          {s.goals.length ? (
            <ul className="lr-week-goals">
              {s.goals.map((g) => (
                <li key={g.path}>
                  <button type="button" className="lr-goal-name" onClick={() => openGoal(g.path)}>
                    {g.name}
                  </button>
                  <span className="lr-week-line">{[g.status, pct(g.progress), g.reached.length && `reached ${g.reached.join(', ')}`, g.dueNext.length && `next week: ${g.dueNext.join(', ')}`].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rm-none">No goals yet.</p>
          )}
          {s.habits.length > 0 && (
            <ul className="lr-week-habits">
              {s.habits.map((h) => (
                <li key={h.path}>
                  <span className="lr-week-habit">{h.name}</span>
                  <Progress value={Math.min(1, h.done / Math.max(1, h.target))} tone={h.done >= h.target ? 'ok' : undefined} words={`${h.done} of ${h.target}${h.streak ? ` · ${plural(h.streak, h.unit)} in a row` : ''}`} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {m.reviews.some((x) => x.week !== monday) && (
        <Card id="history" title="Other weeks’ reviews" count={m.reviews.filter((x) => x.week !== monday).length}>
          <ul className="rm-rows">
            {m.reviews.filter((x) => x.week !== monday).map((x) => (
              <li key={x.path} className="rm-row">
                <button type="button" className="rm-row-main" onClick={() => peek({ type: 'note', path: x.path }, { title: A.titleOf(x.path), type: 'note' })}>
                  <span className="rm-row-icon" aria-hidden="true">
                    <Icon name="review" size={14} />
                  </span>
                  <span className="rm-row-words">
                    <span className="rm-row-name">Week of {dayText(x.week)}</span>
                    <span className="rm-row-sub">{[x.mood, x.wins.split('\n')[0]].filter(Boolean).join(' · ') || 'Nothing written yet'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function GoalsClassic({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const modules = useModules();
  const sections = GOALS.sections.filter((s) => (s.id !== 'habits' || partOn(modules, 'goals', 'habits')) && (s.id !== 'review' || partOn(modules, 'goals', 'review')));
  const { section, detail } = placeOf(tab, GOALS, sections);
  const { data: m, error } = useWork<GoalsView>('goals');
  const records = useMemo(() => (m ? goalRecords(m) : []), [m]);
  const ctx = useWorkCtx('goals', records, { editable: (r) => GOAL_EDITABLE[r.kind] ?? [], open: (r) => (r.kind === 'goal' || r.kind === 'milestone') && r.path ? openGoal(r.path) : r.path && peek({ type: 'note', path: r.path }, { title: r.title, type: 'note' }) });
  const goal = detail?.kind === 'goal' && m ? m.goals.find((g) => g.path === detail.key) : undefined;
  const here = detail ? 'goals' : section;
  const more = (): MenuItem[] => [
    { label: 'New goal', icon: 'target', disabled: !canEdit, run: () => newGoal() },
    { label: 'New habit', icon: 'check', disabled: !canEdit, run: () => newHabit(m?.goals ?? [], goal?.name) },
    ...(goal ? [{ separator: true } as MenuItem, ...goalMenu(goal, canEdit, true, m?.goals ?? [])] : []),
    { separator: true },
    { label: 'Goals options…', icon: 'settings', disabled: !canEdit || !m, run: () => m && goalsOptions(m.remindDays, m.reviewDay) },
    { label: 'Show the folder', icon: 'folder', disabled: !m, run: () => m && A.revealInExplorer(m.folder) },
  ];
  const actions =
    here === 'habits' ? (
      <button type="button" className="sv-tool nt-new" disabled={!canEdit} onClick={() => newHabit(m?.goals ?? [])}>
        <Icon name="plus" size={14} /> New habit
      </button>
    ) : here === 'review' ? null : (
      <button type="button" className="sv-tool nt-new" disabled={!canEdit} onClick={() => newGoal()}>
        <Icon name="plus" size={14} /> New goal
      </button>
    );
  const shownDetail = goal ? { title: goal.name, line: [goal.category, goal.by && `by ${dayText(goal.by)}`, goal.habits.length && plural(goal.habits.length, 'habit')].filter(Boolean).join(' · '), back: { section: 'goals', label: 'Goals' }, badge: <Pill tone={statusTone(goal.status)}>{goal.status}</Pill> } : detail && m ? { title: 'Goal not found', back: { section: 'goals', label: 'Goals' } } : null;
  const empty = m && !m.goals.length && !m.habits.length && !m.healthHabits.length;
  return (
    <WithRecords ctx={ctx}>
      <WorkShell tab={tab} module={GOALS} sections={sections} here={here} actions={actions} more={more} detail={shownDetail} sharePath={goal?.path}>
        {error ? (
          <p className="rm-failed">{error}</p>
        ) : !m ? (
          <div className="view-loading" />
        ) : detail ? (
          goal ? <GoalPage g={goal} m={m} canEdit={canEdit} /> : <EmptyState icon="target" title="That goal isn’t here any more" line="It may have been renamed, moved or taken out." action={{ label: 'All goals', icon: 'target', run: () => openModule('goals', 'goals') }} />
        ) : empty && section !== 'review' ? (
          <EmptyState icon="target" title="Goals you can see moving, habits you can tick" line="Set a goal with a number to reach or a few milestones, and add the small habits that get you there. The weekly review then writes itself from both." action={{ label: 'Set your first goal', icon: 'plus', run: () => newGoal(), disabled: !canEdit }} also={{ label: 'Add a habit', icon: 'check', run: () => newHabit([]), disabled: !canEdit }} />
        ) : section === 'overview' ? (
          <Overview m={m} canEdit={canEdit} />
        ) : section === 'goals' ? (
          <div className="rm-overview">
            <Card id="all-goals" title="Every goal" count={m.goals.length}>
              <ul className="lr-goal-list is-grid">
                {m.goals.map((g) => (
                  <GoalRow key={g.path} g={g} today={m.today} canEdit={canEdit} />
                ))}
              </ul>
            </Card>
            <WorkViews module="goals" section="goals" made={goalSectionViews('goals')} records={records} />
          </div>
        ) : section === 'habits' ? (
          <div className="rm-overview">
            {m.habits.length || m.healthHabits.length ? (
              <ul className="lr-habit-cards">
                {[...m.habits, ...m.healthHabits].map((h) => (
                  <HabitCard key={h.path} h={h} m={m} canEdit={canEdit} />
                ))}
              </ul>
            ) : (
              <EmptyState size="panel" icon="check" title="No habits yet" line="Add something you do each day or a few times a week." action={{ label: 'New habit', icon: 'plus', run: () => newHabit(m.goals), disabled: !canEdit }} />
            )}
          </div>
        ) : (
          <ReviewPage m={m} canEdit={canEdit} />
        )}
      </WorkShell>
    </WithRecords>
  );
}

// ── The 8.7 page (30 Oct 2026): the new overview and look-back, the rest as before ────────────────────────────────────

export function GoalsPage({ tab }: { tab: W.TabState }) {
  const place = goalsPlace(tab);
  if (place === 'overview') return <GoalsOverview tab={tab} />;
  if (place === 'review') return <GoalsReview tab={tab} />;
  if (place === 'classic') { const suffix = (partOfTab(tab) ?? '').startsWith('classic:') ? (partOfTab(tab) ?? '').slice(8) : 'overview'; return <GoalsClassic tab={{ ...tab, path: `module:goals#${suffix}` }} />; }
  return <GoalsClassic tab={tab} />;
}

// ── Today ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function GoalsToday() {
  const modules = useModules();
  const canEdit = useApp((s) => s.canEdit);
  const habitsOn = partOn(modules, 'goals', 'habits');
  const reviewOn = partOn(modules, 'goals', 'review');
  const { data: m } = useWork<GoalsView>('goals');
  if (!m) return null;
  const habits = habitsOn ? m.habits.filter((h) => h.status === 'Active') : [];
  const due = m.milestonesDue.filter((ms) => ms.days !== null && ms.days <= 7);
  const review = reviewOn && m.reviewDue;
  if (!habits.length && !due.length && !review) return null;
  const left = habits.filter((h) => !h.today).length;
  return (
    <section className="td-section rm-today lr-goals-today" data-section="goals" aria-labelledby="td-h-goals">
      <header className="td-section-head">
        <h2 id="td-h-goals">
          Goals
          {left > 0 && <span className="td-count">{left}</span>}
        </h2>
        <button type="button" className="td-section-link" onClick={() => openModule('goals')}>
          <Icon name="target" size={13} /> Goals
        </button>
      </header>
      <ul className="rm-today-rows">
        {habits.map((h) => (
          <li key={h.path} className={`rm-today-row lr-today-habit${h.today ? ' is-done' : ''}`}>
            <button type="button" className={`lr-check${h.today ? ' is-on' : ''}`} role="checkbox" aria-checked={h.today} aria-label={`${h.name}: ${h.today ? 'done today' : 'not done today'}`} disabled={!canEdit} onClick={() => void tick(h, m.today, !h.today)}>
              {h.today && <Icon name="check" size={11} />}
            </button>
            <span className="rm-today-main">
              <span className="rm-today-name">{h.name}</span>
              <span className="rm-today-sub">{[h.streak ? `${plural(h.streak, h.unit)} in a row` : 'Start a streak today', habitTarget(h)].join(' · ')}</span>
            </span>
          </li>
        ))}
        {due.map((ms) => (
          <li key={`${ms.goal}:${ms.row}`} className={`rm-today-row${ms.days! < 0 ? ' is-late' : ''}`}>
            <button type="button" className="rm-today-main" onClick={() => openGoal(ms.goal)}>
              <span className="rm-today-name">{ms.title}</span>
              <span className="rm-today-sub">{[ms.goalName, ms.due && (ms.days! < 0 ? `was due ${dayText(ms.due)}` : ms.days === 0 ? 'due today' : `due ${dayText(ms.due)}`)].filter(Boolean).join(' · ')}</span>
            </button>
          </li>
        ))}
        {review && (
          <li className="rm-today-row is-change">
            <button type="button" className="rm-today-main" onClick={() => openModule('goals', 'review')}>
              <span className="rm-today-name">This week’s goals review</span>
              <span className="rm-today-sub">Look back on the week: it starts from your goals and habits.</span>
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}
