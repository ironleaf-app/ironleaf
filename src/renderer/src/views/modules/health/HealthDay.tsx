// Health and Fitness › Today (Wave 5, 24 Oct 2026): the daily check-in (the questions the person chose, each answered
// the way it is answered, saved as it is given), its streak, and the day at a glance — water, sleep, training this week,
// habits ticked, the next appointment — each opening its own part. Any day can be filled in afterwards (‹ ›).

import { useState } from 'react';
import {
  appointmentLine,
  checkinState,
  entryOn,
  foodOn,
  measureStreak,
  remindersDue,
  sessionsInWeek,
  todayIso,
  upcoming,
  valueWords,
  type HealthDb,
} from '../../../../../shared/health';
import { partOn } from '../../../../../shared/life-modules';
import { Icon } from '../../../components/Icon';
import { openModule, useModules } from '../../../state/modules';
import { Answer, Card, DayNav, NOT_ADVICE, StreakGrid, Tile } from './bits';
import { H } from './useHealth';

export function HealthDay({ db, act }: { db: HealthDb; act(p: Promise<HealthDb>, said?: string): Promise<boolean> }) {
  const today = todayIso();
  const [day, setDay] = useState(today);
  const sw = useModules();
  const on = (p: string) => partOn(sw, 'health', p);
  const ci = checkinState(db);
  const asked = db.checkin.measures.map((id) => db.measures.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m && !m.archived);
  const answered = asked.filter((m) => entryOn(db, m.id, day)).length;
  const water = db.measures.find((m) => m.id === 'water' && !m.archived);
  const sleep = db.measures.find((m) => m.id === 'sleep' && !m.archived);
  const habits = db.measures.filter((m) => m.kind === 'yesno' && !m.archived);
  const week = sessionsInWeek(db, today);
  const next = upcoming(db, today, 60)[0];
  const due = remindersDue(db, today);
  const food = foodOn(db, today);
  const save = (mid: string, v: string | number | boolean | null) => void act(H().entry(mid, day, v));
  return (
    <div className="hl-day">
      {on('checkin') && (
        <Card
          className="hl-checkin"
          title={day === today ? 'Today’s check-in' : 'Check-in'}
          icon="check"
          aside={<DayNav day={day} onDay={setDay} />}
        >
          {asked.length ? (
            <>
              <p className="hl-checkin-state">
                {answered === asked.length ? (
                  <span className="is-done">
                    <Icon name="check" size={13} /> Done{day === today && ci.streak.current > 1 ? ` · ${ci.streak.current} days in a row` : ''}
                  </span>
                ) : (
                  <span>
                    {answered} of {asked.length} answered{day === today && ci.streak.current > 0 ? ` · ${ci.streak.current}-day streak` : ''}
                  </span>
                )}
              </p>
              <ol className="hl-questions">
                {asked.map((m) => (
                  <li key={m.id} className={entryOn(db, m.id, day) ? 'is-answered' : ''}>
                    <span className="hl-q">
                      {m.name}
                      {m.kind === 'scale' && <em>{`${m.min ?? 1} to ${m.max ?? 10}`}</em>}
                      {m.daily !== undefined && <em>{`goal ${m.daily}`}</em>}
                    </span>
                    <Answer m={m} entry={entryOn(db, m.id, day)} onSave={(v) => save(m.id, v)} />
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="hl-empty-words">
              The check-in asks nothing yet.{' '}
              <button type="button" className="link-button" onClick={() => openModule('health', 'settings')}>
                Choose its questions
              </button>
            </p>
          )}
          {day === today && asked.length > 0 && (
            <div className="hl-checkin-streak">
              <StreakGrid streak={ci.streak} label="Check-ins" />
              <span className="hl-faint">Best run {ci.streak.best} days</span>
            </div>
          )}
        </Card>
      )}

      <div className="hl-tiles">
        {on('food') && water && (
          <Tile
            label="Water today"
            value={
              <span className="hl-water">
                <button type="button" className="hl-stepper" aria-label="One glass less" disabled={!entryOn(db, 'water', today)?.n} onClick={() => save2(act, 'water', today, Math.max(0, (entryOn(db, 'water', today)?.n ?? 0) - 1))}>
                  <Icon name="minus" size={13} />
                </button>
                <strong>{entryOn(db, 'water', today)?.n ?? 0}</strong>
                <button type="button" className="hl-stepper" aria-label="One more glass" onClick={() => save2(act, 'water', today, (entryOn(db, 'water', today)?.n ?? 0) + 1)}>
                  <Icon name="plus" size={13} />
                </button>
              </span>
            }
            sub={water.daily ? `of ${water.daily} ${water.unit ?? ''}` : water.unit}
            tone={(entryOn(db, 'water', today)?.n ?? 0) >= (water.daily ?? Infinity) ? 'ok' : 'none'}
          />
        )}
        {on('sleep') && sleep && <Tile label="Sleep last night" value={entryOn(db, 'sleep', today) ? valueWords(sleep, entryOn(db, 'sleep', today)!) : ''} sub={db.targets.sleep ? `target ${db.targets.sleep} h` : undefined} onClick={() => openModule('health', 'sleep')} />}
        {on('training') && <Tile label="Training this week" value={`${week.length}${db.targets.sessionsPerWeek ? ` of ${db.targets.sessionsPerWeek}` : ''}`} sub={week.length ? week[week.length - 1].title : 'No session yet'} tone={db.targets.sessionsPerWeek && week.length >= db.targets.sessionsPerWeek ? 'ok' : 'none'} onClick={() => openModule('health', 'training')} />}
        {on('food') && <Tile label="Food today" value={food.kcal ? `${food.kcal.toLocaleString('en-AU')} kcal` : `${food.meals.length} logged`} sub={db.targets.kcal ? `target ${db.targets.kcal.toLocaleString('en-AU')} kcal` : food.unknown ? `${food.unknown} without a figure` : undefined} onClick={() => openModule('health', 'food')} />}
        {on('appointments') && <Tile label="Next appointment" value={next ? next.who : 'None booked'} sub={next ? appointmentLine(next, today).replace(`${next.who}`, '').replace(/^[ ,·-]+/, '') : undefined} tone={due.length ? 'warn' : 'none'} onClick={() => openModule('health', 'appointments')} />}
      </div>

      {on('habits') && habits.length > 0 && (
        <Card title="Habits today" icon="flag" aside={<button type="button" className="link-button" onClick={() => openModule('health', 'habits')}>All habits</button>}>
          <ul className="hl-habit-rows">
            {habits.map((m) => {
              const s = measureStreak(db, m.id, today);
              return (
                <li key={m.id}>
                  <span className="hl-habit-name">
                    {m.name}
                    <em>{s.current ? `${s.current} day${s.current === 1 ? '' : 's'} in a row` : 'no run yet'}</em>
                  </span>
                  <Answer m={m} entry={entryOn(db, m.id, today)} onSave={(v) => void act(H().entry(m.id, today, v))} />
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <p className="hl-advice">
        <Icon name="info" size={12} /> {NOT_ADVICE}
      </p>
    </div>
  );
}

function save2(act: (p: Promise<HealthDb>) => Promise<boolean>, measure: string, day: string, n: number) {
  void act(H().entry(measure, day, n === 0 ? null : n));
}
