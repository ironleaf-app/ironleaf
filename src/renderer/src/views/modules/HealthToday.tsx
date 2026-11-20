// Health and Fitness on Today (Wave 5, 24 Oct 2026; "Today pulls from every module… check-ins"): the check-in when it is
// due (or done, with its streak), appointments whose reminder has come, ones that passed without an answer, and today's
// session from a plan. Each row opens its part; nothing shows when there is nothing to say.

import { appointmentLine, checkinState, pastBooked, planDayFor, remindersDue, sessionsInWeek, todayIso, weekSessionSummary } from '../../../../shared/health';
import { partOn } from '../../../../shared/life-modules';
import { plural } from '../../../../shared/words';
import { Icon, type IconName } from '../../components/Icon';
import { openModule, useModules } from '../../state/modules';
import { useHealth } from './health/useHealth';

export function HealthToday() {
  const { db } = useHealth();
  const sw = useModules();
  if (!db) return null;
  const today = todayIso();
  const rows: { icon: IconName; words: string; sub?: string; part: string; tone?: 'due' | 'done' }[] = [];
  const ci = checkinState(db);
  if (partOn(sw, 'health', 'checkin') && ci.measures.length) {
    if (ci.due) rows.push({ icon: 'check', words: 'Daily check-in', sub: `${ci.measures.length} quick question${ci.measures.length === 1 ? '' : 's'}${ci.streak.current ? ` · ${ci.streak.current}-day streak` : ''}`, part: 'today', tone: 'due' });
    else if (ci.done) rows.push({ icon: 'check', words: 'Check-in done', sub: ci.streak.current > 1 ? `${ci.streak.current} days in a row` : undefined, part: 'today', tone: 'done' });
  }
  if (partOn(sw, 'health', 'appointments')) {
    for (const a of remindersDue(db, today)) rows.push({ icon: 'calendar', words: appointmentLine(a, today), part: 'appointments', tone: a.day === today ? 'due' : undefined });
    const past = pastBooked(db, today);
    if (past.length) rows.push({ icon: 'help', words: `${past.length} appointment${past.length === 1 ? '' : 's'} to mark done or not`, part: 'appointments' });
  }
  if (partOn(sw, 'health', 'training')) {
    // The week in numbers (8.5 uplift, 30 Oct 2026): sessions done against the aim, so progress shows without opening the page.
    const week = weekSessionSummary(db, today);
    // No training at all means nothing "to do" yet (packs uplift item 13, as the overview): the row shows once
    // training exists.
    if (week.done || (week.target && db.sessions.length)) rows.push({ icon: 'bolt', words: week.done ? `${week.done} of ${week.target ?? week.done} sessions this week` : `${plural(week.target ?? 0, 'session')} to do this week`, sub: week.target && week.done >= week.target ? 'Aim met' : undefined, part: 'training', tone: week.target && week.done >= week.target ? 'done' : undefined });
    const done = sessionsInWeek(db, today).some((s) => s.day === today);
    for (const p of db.plans.filter((x) => !x.archived)) {
      const d = planDayFor(db, p, today);
      if (d && !done && (d.weekday === undefined ? false : d.weekday === new Date().getDay())) rows.push({ icon: 'bolt', words: `${p.name}: ${d.label}${d.title ? ` · ${d.title}` : ''}`, sub: `${plural(d.exercises.length, 'exercise')}`, part: 'training' });
    }
  }
  if (!rows.length) return null;
  return (
    <section className="tm-card hl-today" data-section="health" aria-label="Health">
      <header className="tm-card-head">
        <span className="hl-mark is-small" aria-hidden="true">
          <Icon name="heart" size={12} />
        </span>
        <button type="button" className="tm-card-title" onClick={() => openModule('health')}>
          Health
        </button>
      </header>
      <ul className="tm-rows">
        {rows.map((r, i) => (
          <li key={i}>
            <button type="button" className={`tm-row${r.tone ? ` is-${r.tone}` : ''}`} onClick={() => openModule('health', r.part)}>
              <Icon name={r.icon} size={14} />
              <span className="tm-row-words">
                <strong>{r.words}</strong>
                {r.sub && <em>{r.sub}</em>}
              </span>
              <Icon name="forward" size={12} className="tm-go" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
