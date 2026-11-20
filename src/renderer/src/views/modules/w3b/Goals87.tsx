// Goals' 8.7 pages (30 Oct 2026): the overview (goals.html: goals, habits with their week, the home card) and the
// weekly look-back (goals-review.html). Every ability the old overview had lives here: goals set, opened, their
// status changed and milestones reached; habits added and ticked day by day; the review's mood and words written
// where shown, its numbers updated, earlier weeks opened. The goal's own page and the streak calendar keep the
// previous layout (tabs below). One primary button per screen.

import { useEffect, useMemo, useRef, useState } from 'react';
import { REVIEW_MOODS } from '../../../../../shared/life-records';
import { REVIEW_SECTIONS, habitTarget, ofTarget, weekDays, weekOf, weekSummary, type Habit, type ReviewKey } from '../../../../../shared/goals';
import { addToDay } from '../../../../../shared/personal-records';
import { partOn } from '../../../../../shared/life-modules';
import { Icon } from '../../../components/Icon';
import { openMenu } from '../../../components/Menu';
import { writeLink } from '../../../lib/links';
import * as A from '../../../state/actions';
import { openTour } from '../../../state/moduleFills';
import { openModule, partOfTab, useModules } from '../../../state/modules';
import { peek } from '../../../state/peek';
import { toast } from '../../../state/store';
import { useWork, workCall, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { dayText, inDays } from '../work/WorkShell';
import { goalsOptions, newGoal, newHabit, nextGoalStatus, openGoal, setGoal, setMilestone, tick, type GoalsView } from '../life/GoalsPage';
import { Inline, plural, saved } from '../life/parts';
import { FillsLine, HomeCard, MoreButton, PackHead, PackPage, PageProps, Section, trashRecord, useCanEdit, FULL_DETAILS_LABEL } from './W3b';

const openReview = () => openModule('goals', 'review');
const pct = (p: number | null) => (p === null ? '' : `${Math.round(p * 100)}%`);
// Goal statuses are the fixed GOAL_STATUSES words: exact matches (9.2 uplift F161), never substrings.
const toneOf = (s: string): 'slate' | 'green' | 'amber' | 'red' | 'blue' => (s === 'Achieved' || s === 'On track' ? 'green' : s === 'At risk' ? 'amber' : 'slate');
/** A day without its weekday ("26 Oct"): for week titles. */
const nodow = (iso: string) => dayText(iso).replace(/^\S+ /, '');

/** A habit's week, Monday to Sunday: each day ticked where shown. */
function HabitWeek({ h, today, canEdit, compact }: { h: Habit; today: string; canEdit: boolean; compact?: boolean }) {
  const days = weekDays(weekOf(today));
  const set = new Set(h.days);
  const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <span className="lr-week" role="group" aria-label={`${h.name} this week`}>
      {days.map((d, i) => {
        const done = set.has(d);
        const future = d > today;
        return (
          <button key={d} type="button" className={`lr-day${done ? ' is-done' : ''}${d === today ? ' is-today' : ''}${future ? ' is-future' : ''}`} disabled={!canEdit || future || h.source === 'health'} title={`${dayText(d)}${done ? ': done' : ''}${h.source === 'health' ? ' (kept in Health)' : ''}`} aria-label={`${dayText(d)}: ${done ? 'done' : 'not done'}`} aria-pressed={done} onClick={() => void tick(h, d, !done)}>
            {done || compact ? <Icon name="check" size={11} /> : letters[i]}
          </button>
        );
      })}
    </span>
  );
}

export function GoalsOverview({ tab }: { tab: W.TabState }) {
  void tab;
  const canEdit = useCanEdit();
  const modules = useModules();
  const habitsOn = partOn(modules, 'goals', 'habits');
  const reviewOn = partOn(modules, 'goals', 'review');
  const { data: m, error } = useWork<GoalsView>('goals');
  const habits = useMemo(() => (m ? [...m.habits.filter((h) => h.status === 'Active'), ...m.healthHabits] : []), [m]);
  const doneToday = habits.filter((h) => h.today).length;
  const active = m?.goals.filter((g) => !g.closed) ?? [];
  const left = habits.filter((h) => !h.today);
  return (
    <PackPage label="Goals">
      <PackHead glyph="★" tint="amber" title="Goals" lead="Goals with steps, habits with streaks, and a weekly look-back."
        actions={<>{canEdit && <button type="button" className="btn pri" onClick={() => newGoal()}><Icon name="plus" size={14} /> New goal</button>}<MoreButton label="More for Goals" onOpen={(el) => openMenu(el, [
          { label: 'New habit…', icon: 'check', disabled: !canEdit || !m, run: () => newHabit(m?.goals ?? []) },
          { label: 'Weekly look-back', icon: 'review', disabled: !reviewOn, run: openReview },
          { label: 'Streak calendar', icon: 'calendar', disabled: !habitsOn, run: () => openModule('goals', 'habits') },
          { label: 'Goals options…', icon: 'settings', disabled: !canEdit || !m, run: () => m && goalsOptions(m.remindDays, m.reviewDay) },
          { label: 'Show me around Goals', icon: 'sparkle', run: () => openTour('goals') },
          { separator: true },
          { label: FULL_DETAILS_LABEL, icon: 'history', run: () => openModule('goals', 'classic') },
        ])} /></>} />
      {m && <PageProps facts={[{ k: 'Habits today', v: habits.length ? `${doneToday} of ${habits.length} done · review day ${m.reviewDay}` : `No habits yet · review day ${m.reviewDay}` }]} />}
      {m && !active.length && !habits.length && <FillsLine id="goals" />}
      {error && <p className="vsub">{error}</p>}
      {!m && !error && <p className="vsub">Reading your goals…</p>}
      {m && (
        <Section label="Goals" action={canEdit ? <button type="button" className="btn quiet" onClick={() => newGoal()}>New goal</button> : undefined}>
          {/* Bare when there is nothing but the line (t254, 13 Nov 2026: one short line in a box is the
              empty space); the rows keep their card. */}
          {!active.length ? (
            <p className="vsub" style={{ padding: '9px 0' }}>No goals yet. Set one with a number to reach or a few milestones.</p>
          ) : (
          <div className="card" style={{ padding: '6px 20px' }}>
            {active.map((g) => (
              <div key={g.path} className="trow">
                <button type="button" className="t clip" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontWeight: 500, fontSize: 15 }} onClick={() => openGoal(g.path)} title="Open the goal">{g.name}</button>
                <span className="meta clip" style={{ marginLeft: 'auto' }}>{[g.targetValue !== null ? ofTarget(g) : '', g.by ? `by ${dayText(g.by)}` : '', g.targetValue === null && g.milestones.length ? `${g.milestones.filter((x) => x.done).length} of ${plural(g.milestones.length, 'milestone')}` : ''].filter(Boolean).join(' · ') || pct(g.progress)}</span>
                <button type="button" className={`tag ${toneOf(g.status)}`} style={{ border: 0, cursor: canEdit && nextGoalStatus(g.status) ? 'pointer' : 'default' }} title={nextGoalStatus(g.status) ? 'Click to move it on' : g.status} onClick={() => { const n = nextGoalStatus(g.status); if (canEdit && n) void setGoal(g, 'status', n); }}>{g.status}</button>
                {g.next && canEdit && <button type="button" className="btn quiet" title={`Mark ${g.next.title} reached`} onClick={() => void setMilestone(g.next!, { done: true })}>Reached: {g.next.title}</button>}
                {canEdit && <button type="button" className="btn quiet" aria-label={`Delete ${g.name} to the Bin`} title="Delete to the Bin" onClick={() => void trashRecord(g.path)}>Delete</button>}
              </div>
            ))}
          </div>
          )}
        </Section>
      )}
      {m && habitsOn && (
        <Section label="Habits · this week" action={canEdit ? <button type="button" className="btn quiet" onClick={() => newHabit(m.goals)}>New habit</button> : undefined}>
          {/* Bare when there is nothing but the line (t254); the rows keep their card. */}
          {!habits.length ? (
            <p className="vsub" style={{ padding: '9px 0' }}>No habits yet. Add one to tick it off each day.</p>
          ) : (
          <div className="card" style={{ padding: '6px 20px' }}>
            {habits.map((h) => (
              <div key={h.path} className="trow">
                <span className="t clip">{h.name}{h.source === 'health' ? ' · Health' : ''}</span>
                <HabitWeek h={h} today={m.today} canEdit={canEdit} />
                <span className="meta" style={{ marginLeft: 'auto' }}>{habitTarget(h)}{h.streak ? ` · ${plural(h.streak, h.unit)} in a row` : ''}</span>
              </div>
            ))}
          </div>
          )}
        </Section>
      )}
      {m && !!m.milestonesDue.length && (
        <Section label="Coming up">
          <div className="card" style={{ padding: '6px 20px' }}>
            {m.milestonesDue.slice(0, 5).map((ms) => (
              <div key={`${ms.goal}:${ms.row}`} className="trow">
                <span className="t clip">{ms.title}</span>
                <span className="meta clip" style={{ marginLeft: 'auto' }}>{[ms.goalName, ms.due && (ms.days! < 0 ? `was due ${dayText(ms.due)}` : `${dayText(ms.due)}, ${inDays(ms.due, m.today)}`)].filter(Boolean).join(' · ')}</span>
                {canEdit && <button type="button" className="btn quiet" onClick={() => void setMilestone(ms, { done: true })}>Reached: {ms.title}</button>}
              </div>
            ))}
          </div>
        </Section>
      )}
      {/* The Home preview shows only once habits exist: with none it would claim all of nothing is done. */}
      {m && habitsOn && !!habits.length && <HomeCard pack="Habits to tick" glyph="★" tint="amber" title={left.length ? `${left.length} left today: ${left.slice(0, 3).map((h) => h.name.toLowerCase()).join(', ')}${left.length > 3 ? ` and ${left.length - 3} more` : ''}` : 'All habits done today'} meta="click to tick" />}
    </PackPage>
  );
}

// ── The weekly look-back ─────────────────────────────────────────────────────────────────────────────────────────

function ReflectionEdit({ label, value, placeholder, canEdit, onSave }: { label: string; value: string; placeholder: string; canEdit: boolean; onSave(v: string): Promise<boolean> }) {
  return (
    <div style={{ marginTop: 12 }}>
      <h4 style={{ fontSize: 14, fontWeight: 600 }}>{label}</h4>
      <Inline value={value} label={label} kind="long" placeholder={placeholder} canEdit={canEdit} onSave={onSave} className="lr-reflect-words" />
    </div>
  );
}

export function GoalsReview({ tab }: { tab: W.TabState }) {
  void tab;
  const canEdit = useCanEdit();
  const { data: m } = useWork<GoalsView>('goals');
  const [back, setBack] = useState(0);
  const refreshed = useRef('');
  const monday = m ? addToDay(m.week.start, { days: -7 * back }) : '';
  useEffect(() => {
    if (!m || back < 0) return;
    const r = m.reviews.find((x) => x.week === monday);
    if (!r || refreshed.current === r.path) return;
    refreshed.current = r.path;
    void workDid(workCall<string>('goals', 'refresh-review', r.path));
  }, [m, monday, back]);
  const s = useMemo(() => (m ? (monday === m.week.start ? m.week : weekSummary(m.goals, [...m.habits, ...m.healthHabits], monday)) : null), [m, monday]);
  const r = m?.reviews.find((x) => x.week === monday) ?? null;
  if (!m || !s) return <PackPage label="Goals"><p className="vsub">Reading your goals…</p></PackPage>;
  const ticks = s.habits.reduce((n, h) => n + h.done, 0);
  const target = s.habits.reduce((n, h) => n + h.target, 0);
  const save = (key: ReviewKey | 'mood') => async (v: string) => saved(workCall<string>('goals', 'save-review', { week: monday, [key]: v }), r ? '' : 'The week’s review is saved.');
  const slipped = s.goals.filter((g) => g.status === 'At risk').length;
  const weekName = `Week of ${nodow(monday)}`;
  const copyLink = () => { if (r) void navigator.clipboard.writeText(writeLink(r.path, undefined)).then(() => toast('A link to the review is on the clipboard.')); };
  return (
    <PackPage label="Goals review">
      <PackHead glyph="★" tint="amber" title={`${weekName}: review`} lead={s.goals.length ? `Started from your goals and habits. ${s.goals.length - slipped} on track, ${slipped} slipped.` : 'Started from your goals and habits.'}
        actions={<>{back !== -1 && canEdit && <button type="button" className="btn pri" onClick={() => setBack(-1)}>Start next week</button>}{r && <button type="button" className="btn" onClick={() => peek({ type: 'note', path: r.path }, { title: A.titleOf(r.path), type: 'note' })}>Its note</button>}<MoreButton label="More for the review" onOpen={(el) => openMenu(el, [
          { label: 'The week before', icon: 'back', run: () => setBack(back + 1) },
          { label: 'The week after', icon: 'forward', disabled: back === -1, run: () => setBack(back - 1) },
          ...(r ? [{ label: 'Copy link', icon: 'link' as const, run: copyLink }] : []),
          { separator: true },
          { label: 'Goals options…', icon: 'settings', disabled: !canEdit, run: () => goalsOptions(m.remindDays, m.reviewDay) },
        ])} /></>} />
      <PageProps facts={[{ k: 'Habits', v: target ? `${ticks} of ${target} ticks · ${Math.round((ticks / target) * 100)}%` : 'No habits with a target' }]} />
      <Section label="Look-back">
        <div className="card" style={{ padding: '6px 20px' }}>
          {!s.goals.length && !s.habits.length && <p className="vsub" style={{ padding: '9px 0' }}>Nothing to look back on yet. Set a goal or add a habit first.</p>}
          {s.goals.map((g) => {
            const slipped = g.status === 'At risk';
            return (
              <div key={g.path} className="trow">
                <span className={`tag ${slipped ? 'amber' : 'green'}`}>{slipped ? 'Slipped' : 'On track'}</span>
                <button type="button" className="t clip" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 15 }} onClick={() => openGoal(g.path)}>{g.name}</button>
                <span className="meta clip" style={{ marginLeft: 'auto' }}>{[pct(g.progress), g.reached.length ? `reached ${g.reached.join(', ')}` : '', g.dueNext.length ? `next: ${g.dueNext.join(', ')}` : ''].filter(Boolean).join(' · ')}</span>
              </div>
            );
          })}
          {s.habits.map((h) => (
            <div key={h.path} className="trow">
              <span className={`tag ${h.done >= h.target ? 'green' : 'slate'}`}>{h.done >= h.target ? 'On track' : `${h.done} of ${h.target}`}</span>
              <span className="t clip">{h.name}</span>
              <span className="meta" style={{ marginLeft: 'auto' }}>{h.streak ? `${plural(h.streak, h.unit)} in a row` : ''}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section label="Your review">
        <div className="card">
          <div className="chips" role="group" aria-label="How the week felt">
            <span className="vsub">The week felt</span>
            {REVIEW_MOODS.map((mood) => (
              <button key={mood} type="button" className={`chip${r?.mood === mood ? ' on' : ''}`} aria-pressed={r?.mood === mood} disabled={!canEdit} onClick={() => void save('mood')(r?.mood === mood ? '' : mood)}>{mood}</button>
            ))}
          </div>
          {REVIEW_SECTIONS.map((sec) => (
            <ReflectionEdit key={sec.key} label={sec.name} value={r?.[sec.key] ?? ''} placeholder={sec.key === 'wins' ? 'What went well this week?' : sec.key === 'blockers' ? 'What got in the way?' : 'What matters most next week?'} canEdit={canEdit} onSave={save(sec.key)} />
          ))}
          {!r && <p className="vsub" style={{ marginTop: 12 }}>Writing anything here saves the week’s review as a note, with how each goal and habit went.</p>}
        </div>
      </Section>
      {!!m.reviews.filter((x) => x.week !== monday).length && (
        <Section label="Earlier weeks">
          <div className="card" style={{ padding: '6px 20px' }}>
            {m.reviews.filter((x) => x.week !== monday).slice(0, 5).map((x) => (
              <div key={x.path} className="trow">
                <button type="button" className="t" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 15 }} onClick={() => peek({ type: 'note', path: x.path }, { title: A.titleOf(x.path), type: 'note' })}>Week of {nodow(x.week)}</button>
                <span className="meta clip" style={{ marginLeft: 'auto' }}>{[x.mood, x.wins.split('\n')[0]].filter(Boolean).join(' · ') || 'Nothing written yet'}</span>
                {canEdit && <button type="button" className="btn quiet" aria-label={`Delete the week of ${dayText(x.week)} review to the Bin`} onClick={() => void trashRecord(x.path)}>Delete</button>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </PackPage>
  );
}

/** Goals' page switch: the new overview, the new look-back, a goal's page, the rest as before. */
export function goalsPlace(tab: W.TabState): 'overview' | 'review' | 'classic' | 'rest' {
  const part = partOfTab(tab) ?? 'overview';
  if (part === 'classic' || part.startsWith('classic:')) return 'classic';
  if (part === 'overview' || part === '') return 'overview';
  if (part === 'review') return 'review';
  return 'rest';
}
