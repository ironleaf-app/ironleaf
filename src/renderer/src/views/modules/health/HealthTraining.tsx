// Health and Fitness › Training (Wave 5, 24 Oct 2026; the spec: routines and programmes, a logger with previous values
// and set types, personal bests, an exercise library with filters and low-impact options, a pain score before each
// session — "no programming through pain"). Plans (days by weekday or as a rotation, a length in weeks from a start), a
// session logged from a plan's day or from nothing, the week against its target, every session kept and changeable, the
// personal bests (with Epley's one-rep estimate, labelled), and the library to pick from and add to.

import { useMemo, useState } from 'react';
import {
  addDays,
  dayWords,
  lastTime,
  MUSCLES,
  newId,
  oneRepMax,
  personalBests,
  planDayFor,
  planWeek,
  SESSION_KINDS,
  sessionLine,
  sessionsInWeek,
  setWords,
  todayIso,
  volumeByMuscle,
  weekdayName,
  weekStart,
  whenWords,
  type Exercise,
  type HealthDb,
  type Plan,
  type PlanDay,
  type Session,
  type SessionExercise,
  type SessionKind,
  type SetKind,
  type WorkSet,
} from '../../../../../shared/health';
import { Icon } from '../../../components/Icon';
import { openMenu } from '../../../components/Menu';
import { Card, Tile } from './bits';
import { H } from './useHealth';

type Act = (p: Promise<HealthDb>, said?: string) => Promise<boolean>;
const SET_KINDS: { id: SetKind; label: string }[] = [
  { id: 'working', label: 'Working' },
  { id: 'warm-up', label: 'Warm-up' },
  { id: 'drop', label: 'Drop' },
  { id: 'failure', label: 'To failure' },
];
const numIn = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

export function HealthTraining({ db, act }: { db: HealthDb; act: Act }) {
  const today = todayIso();
  const [editing, setEditing] = useState<Session | null>(null);
  const [planEdit, setPlanEdit] = useState<Plan | null>(null);
  const [view, setView] = useState<'log' | 'plans' | 'bests' | 'library'>('log');
  const week = sessionsInWeek(db, today);
  const plans = db.plans.filter((p) => !p.archived);
  const recent = [...db.sessions].sort((a, b) => b.day.localeCompare(a.day) || b.at - a.at);
  const volume = volumeByMuscle(db, today);
  const start = (from?: { plan: Plan; day: PlanDay }) =>
    setEditing({
      id: '',
      day: today,
      title: from ? `${from.day.label}${from.day.title ? `: ${from.day.title}` : ''}` : '',
      kind: 'strength',
      exercises: from ? from.day.exercises.map((e) => ({ name: e.name, ...(e.exercise ? { exercise: e.exercise } : {}), sets: Array.from({ length: e.sets ?? 3 }, () => ({ reps: numIn(String(e.reps ?? '').split(/[-–]/)[0]) })) })) : [],
      ...(from ? { plan: from.plan.id, planDay: from.day.id } : {}),
      at: 0,
    });
  if (editing) return <SessionEditor db={db} act={act} session={editing} onDone={() => setEditing(null)} />;
  if (planEdit) return <PlanEditor db={db} act={act} plan={planEdit} onDone={() => setPlanEdit(null)} />;
  return (
    <div className="hl-stack">
      <div className="hl-toolbar is-wrap">
        <div className="segmented hl-spans" role="tablist" aria-label="Training">
          {(
            [
              ['log', 'Sessions'],
              ['plans', 'Plans'],
              ['bests', 'Personal bests'],
              ['library', 'Exercises'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="hl-grow" />
        <button type="button" className="button primary small" onClick={() => start()}>
          <Icon name="plus" size={13} /> Log a session
        </button>
      </div>

      {view === 'log' && (
        <>
          <div className="hl-tiles">
            <Tile label="This week" value={`${week.length}${db.targets.sessionsPerWeek ? ` of ${db.targets.sessionsPerWeek}` : ''}`} sub={`from ${dayWords(weekStart(today))}`} tone={db.targets.sessionsPerWeek && week.length >= db.targets.sessionsPerWeek ? 'ok' : 'none'} />
            <Tile label="Minutes this week" value={week.reduce((a, s) => a + (s.minutes ?? 0), 0) || ''} />
            <Tile label="Sets this week" value={week.reduce((a, s) => a + s.exercises.reduce((b, e) => b + e.sets.filter((x) => x.kind !== 'warm-up').length, 0), 0) || ''} sub={volume.length ? volume.slice(0, 3).map((v) => `${v.muscle} ${v.sets}`).join(' · ') : undefined} />
          </div>
          {plans.map((p) => {
            const d = planDayFor(db, p, today);
            const wk = planWeek(p, today);
            return d ? (
              <Card key={p.id} className="hl-next" title={`${p.name}${wk ? ` · week ${wk.week} of ${wk.of}` : ''}`} icon="calendar" aside={<button type="button" className="button primary small" onClick={() => start({ plan: p, day: d })}>Start {d.label}</button>}>
                <p className="hl-next-words">
                  <strong>{d.label}{d.title ? `: ${d.title}` : ''}</strong> · {d.exercises.map((e) => `${e.name}${e.sets ? ` ${e.sets}×${e.reps ?? ''}` : ''}`).join(', ') || 'no exercises yet'}
                </p>
              </Card>
            ) : null;
          })}
          {recent.length ? (
            <ul className="hl-sessions">
              {recent.slice(0, 40).map((s) => (
                <li key={s.id}>
                  <button type="button" className="hl-session" onClick={() => setEditing(s)}>
                    <span className="hl-session-day">
                      <strong>{new Date(`${s.day}T12:00:00`).getDate()}</strong>
                      <em>{dayWords(s.day).split(' ')[0]}</em>
                    </span>
                    <span className="hl-session-words">
                      <strong>{s.title}</strong>
                      <span>{[SESSION_KINDS.find((k) => k.id === s.kind)?.label, sessionLine(s), s.by && s.by !== 'you' ? `logged by ${s.by}` : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="hl-faint">{whenWords(s.day, today)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hl-empty-words">No sessions yet. Log one, or make a plan and start its first day.</p>
          )}
        </>
      )}

      {view === 'plans' && (
        <>
          <div className="hl-toolbar">
            <p className="hl-hint">A plan’s days fall on weekdays, or follow on from each other (A, B, C…) as you do them.</p>
            <span className="hl-grow" />
            <button type="button" className="button small" onClick={() => setPlanEdit({ id: '', name: '', days: [{ id: newId(), label: 'Day A', title: '', exercises: [] }], created: 0 })}>
              <Icon name="plus" size={13} /> New plan
            </button>
          </div>
          {plans.length ? (
            <div className="hl-plans">
              {plans.map((p) => {
                const wk = planWeek(p, today);
                return (
                  <Card key={p.id} title={p.name} icon="calendar" aside={<button type="button" className="icon-button" aria-label={`More for ${p.name}`} onClick={(e) => openMenu(e.currentTarget, [{ label: 'Change…', icon: 'pencil', run: () => setPlanEdit(p) }, { label: 'Put away', icon: 'trash', run: () => void act(H().put('plans', { ...p, archived: true }), `Put away “${p.name}”.`) }])}><Icon name="more" size={14} /></button>}>
                    <p className="hl-faint">{[wk ? `Week ${wk.week} of ${wk.of}` : p.weeks ? `${p.weeks} weeks` : 'Open-ended', p.start ? `from ${dayWords(p.start)}` : '', `${p.days.length} day${p.days.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</p>
                    <ul className="hl-plan-days">
                      {p.days.map((d) => (
                        <li key={d.id}>
                          <span>
                            <strong>{d.label}</strong>
                            {d.weekday !== undefined ? <em>{weekdayName(d.weekday)}</em> : null} {d.title}
                          </span>
                          <span className="hl-faint">{d.exercises.length} exercise{d.exercises.length === 1 ? '' : 's'}</span>
                          <button type="button" className="button small" onClick={() => start({ plan: p, day: d })}>
                            Start
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Card>
                );
              })}
            </div>
          ) : (
            <p className="hl-empty-words">No plans yet.</p>
          )}
        </>
      )}

      {view === 'bests' && <Bests db={db} />}
      {view === 'library' && <Library db={db} act={act} />}
    </div>
  );
}

function Bests({ db }: { db: HealthDb }) {
  const bests = personalBests(db);
  if (!bests.length) return <p className="hl-empty-words">Personal bests show once sessions with weights or reps are logged.</p>;
  return (
    <Card title="Personal bests" icon="star" wide aside={<span className="hl-badge is-soft">One-rep figures are estimates</span>}>
      <table className="hl-table">
        <thead>
          <tr>
            <th>Exercise</th>
            <th>Best set</th>
            <th>One-rep estimate</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {bests.map((b) => (
            <tr key={b.exercise}>
              <td>{b.exercise}</td>
              <td>{b.weight ? `${b.weight} kg × ${b.reps}` : `${b.bodyweightReps} reps`}</td>
              <td className="hl-faint">{b.estimate ? `about ${b.estimate} kg` : ''}</td>
              <td className="hl-faint">{dayWords(b.day)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hl-faint">One-rep estimates use Epley’s formula (weight × (1 + reps ÷ 30)): a guide, not something to test.</p>
    </Card>
  );
}

/** The exercise library: search, filter by muscle, equipment and low impact, and add your own. */
function Library({ db, act, onPick }: { db: HealthDb; act: Act; onPick?: (e: Exercise) => void }) {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('');
  const [low, setLow] = useState(false);
  const shown = db.exercises.filter((e) => (!q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase())) && (!muscle || e.muscles.includes(muscle)) && (!low || e.lowImpact));
  const add = async () => {
    const name = q.trim();
    if (!name) return;
    await act(H().put('exercises', { name, muscles: muscle ? [muscle] : [], custom: true, ...(low ? { lowImpact: true } : {}) }), `Added “${name}” to your exercises.`);
  };
  return (
    <div className="hl-library">
      <div className="hl-toolbar is-wrap">
        <input className="hl-input is-text" value={q} placeholder="Find an exercise" aria-label="Find an exercise" onChange={(e) => setQ(e.target.value)} />
        <select className="hl-input is-select" value={muscle} aria-label="Muscle" onChange={(e) => setMuscle(e.target.value)}>
          <option value="">Any muscle</option>
          {MUSCLES.map((m) => (
            <option key={m} value={m}>
              {m[0].toUpperCase() + m.slice(1)}
            </option>
          ))}
        </select>
        <label className="hl-check">
          <input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low impact
        </label>
      </div>
      <ul className="hl-exercises">
        {shown.map((e) => (
          <li key={e.id}>
            <button type="button" className="hl-exercise" disabled={!onPick} onClick={() => onPick?.(e)}>
              <strong>{e.name}</strong>
              <span>{[e.muscles.join(', '), e.equipment && e.equipment !== 'none' ? e.equipment : '', e.lowImpact ? 'low impact' : '', e.custom ? 'yours' : ''].filter(Boolean).join(' · ')}</span>
            </button>
          </li>
        ))}
      </ul>
      {q.trim() && !db.exercises.some((e) => e.name.toLowerCase() === q.trim().toLowerCase()) && (
        <button type="button" className="button small" onClick={() => void add().then(() => onPick?.({ id: '', name: q.trim(), muscles: muscle ? [muscle] : [] }))}>
          <Icon name="plus" size={13} /> Add “{q.trim()}”{onPick ? ' and use it' : ''}
        </button>
      )}
    </div>
  );
}

function SessionEditor({ db, act, session, onDone }: { db: HealthDb; act: Act; session: Session; onDone(): void }) {
  const [s, setS] = useState<Session>(session);
  const [picking, setPicking] = useState(false);
  const isNew = !session.id;
  const set = (patch: Partial<Session>) => setS((x) => ({ ...x, ...patch }));
  const setEx = (i: number, patch: Partial<SessionExercise>) => set({ exercises: s.exercises.map((e, k) => (k === i ? { ...e, ...patch } : e)) });
  const setSet = (i: number, j: number, patch: Partial<WorkSet>) => setEx(i, { sets: s.exercises[i].sets.map((x, k) => (k === j ? { ...x, ...patch } : x)) });
  const save = async () => {
    if (!s.title.trim()) return;
    const { at: _at, ...rest } = s;
    if (await act(H().put('sessions', { ...rest, id: s.id || undefined, title: s.title.trim() } as Record<string, unknown>), isNew ? `Logged “${s.title.trim()}”.` : 'Saved the session.')) onDone();
  };
  const pain = s.pain ?? null;
  return (
    <div className="hl-stack">
      <Card title={isNew ? 'Log a session' : 'The session'} icon="bolt" wide aside={<button type="button" className="button small" onClick={onDone}>Back</button>}>
        <div className="hl-form-grid">
          <label className="hl-field is-wide">
            <span>What it was</span>
            <input className="hl-input is-text" autoFocus={isNew} value={s.title} placeholder="Upper body, 5 km run, Yoga…" onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className="hl-field">
            <span>Day</span>
            <input className="hl-input" type="date" value={s.day} max={todayIso()} onChange={(e) => e.target.value && set({ day: e.target.value })} />
          </label>
          <label className="hl-field">
            <span>Kind</span>
            <select className="hl-input is-select" value={s.kind} onChange={(e) => set({ kind: e.target.value as SessionKind })}>
              {SESSION_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="hl-field">
            <span>Minutes</span>
            <input className="hl-input" inputMode="numeric" value={s.minutes ?? ''} onChange={(e) => set({ minutes: numIn(e.target.value) })} />
          </label>
          <label className="hl-field">
            <span>How hard (1–10)</span>
            <input className="hl-input" inputMode="numeric" value={s.effort ?? ''} onChange={(e) => set({ effort: numIn(e.target.value) })} />
          </label>
        </div>
        <div className="hl-pain">
          <span className="hl-q">
            Pain before starting
            <em>0 is none, 10 the worst</em>
          </span>
          <div className="hl-scale is-long" role="radiogroup" aria-label="Pain before starting">
            {Array.from({ length: 11 }, (_, i) => i).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={pain === v} className={`hl-step${pain === v ? ' is-on' : ''}${v >= 5 ? ' is-high' : ''}`} onClick={() => set({ pain: pain === v ? undefined : v })}>
                {v}
              </button>
            ))}
          </div>
          {pain !== null && pain >= 5 && <p className="hl-warn">That’s a lot of pain to train through. Consider the low-impact exercises today, or resting, and see your GP if it keeps up.</p>}
        </div>
      </Card>
      {s.exercises.map((e, i) => {
        const prev = lastTime(db, e.name, s.day);
        return (
          <Card
            key={i}
            className="hl-ex-card"
            title={e.name}
            aside={
              <button type="button" className="icon-button" aria-label={`More for ${e.name}`} onClick={(ev) => openMenu(ev.currentTarget, [
                { label: 'Move up', icon: 'back', disabled: i === 0, run: () => set({ exercises: s.exercises.map((x, k, all) => (k === i - 1 ? all[i] : k === i ? all[i - 1] : x)) }) },
                { label: 'Move down', icon: 'forward', disabled: i === s.exercises.length - 1, run: () => set({ exercises: s.exercises.map((x, k, all) => (k === i + 1 ? all[i] : k === i ? all[i + 1] : x)) }) },
                { separator: true },
                { label: 'Take it out', icon: 'trash', run: () => set({ exercises: s.exercises.filter((_, k) => k !== i) }) },
              ])}>
                <Icon name="more" size={14} />
              </button>
            }
          >
            {prev && <p className="hl-faint">Last time ({dayWords(prev.day)}): {prev.sets.filter((x) => x.kind !== 'warm-up').map(setWords).join(', ')}</p>}
            <table className="hl-sets">
              <thead>
                <tr>
                  <th>Set</th>
                  <th>kg</th>
                  <th>Reps</th>
                  <th>Seconds</th>
                  <th>In reserve</th>
                  <th>Kind</th>
                  <th>Done</th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {e.sets.map((x, j) => (
                  <tr key={j} className={x.done ? 'is-done' : ''}>
                    <td className="hl-faint">{j + 1}</td>
                    <td><input className="hl-input is-cell is-short" inputMode="decimal" value={x.weight ?? ''} placeholder={prev?.sets[j]?.weight !== undefined ? String(prev.sets[j].weight) : ''} aria-label={`Set ${j + 1} kg`} onChange={(ev) => setSet(i, j, { weight: numIn(ev.target.value) })} /></td>
                    <td><input className="hl-input is-cell is-short" inputMode="numeric" value={x.reps ?? ''} placeholder={prev?.sets[j]?.reps !== undefined ? String(prev.sets[j].reps) : ''} aria-label={`Set ${j + 1} reps`} onChange={(ev) => setSet(i, j, { reps: numIn(ev.target.value) })} /></td>
                    <td><input className="hl-input is-cell is-short" inputMode="numeric" value={x.seconds ?? ''} aria-label={`Set ${j + 1} seconds`} onChange={(ev) => setSet(i, j, { seconds: numIn(ev.target.value) })} /></td>
                    <td><input className="hl-input is-cell is-short" inputMode="numeric" value={x.rir ?? ''} aria-label={`Set ${j + 1} reps in reserve`} onChange={(ev) => setSet(i, j, { rir: numIn(ev.target.value) })} /></td>
                    <td>
                      <select className="hl-input is-cell is-select" value={x.kind ?? 'working'} aria-label={`Set ${j + 1} kind`} onChange={(ev) => setSet(i, j, { kind: ev.target.value as SetKind })}>
                        {SET_KINDS.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td><input type="checkbox" className="switch small" checked={!!x.done} aria-label={`Set ${j + 1} done`} onChange={(ev) => setSet(i, j, { done: ev.target.checked })} /></td>
                    <td>
                      <button type="button" className="icon-button" aria-label={`Remove set ${j + 1}`} onClick={() => setEx(i, { sets: e.sets.filter((_, k) => k !== j) })}>
                        <Icon name="close" size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hl-set-foot">
              <button type="button" className="link-button" onClick={() => setEx(i, { sets: [...e.sets, { ...(e.sets.at(-1) ?? {}), done: false }] })}>
                + Add a set
              </button>
              {e.sets.some((x) => x.weight && x.reps) && <span className="hl-faint">Best set’s one-rep estimate: about {Math.max(...e.sets.filter((x) => x.weight && x.reps).map((x) => oneRepMax(x.weight!, x.reps!)))} kg</span>}
            </div>
          </Card>
        );
      })}
      {picking ? (
        <Card title="Add an exercise" icon="plus" wide aside={<button type="button" className="button small" onClick={() => setPicking(false)}>Done</button>}>
          <Library db={db} act={act} onPick={(e) => set({ exercises: [...s.exercises, { name: e.name, ...(e.id ? { exercise: e.id } : {}), sets: [{}] }] })} />
        </Card>
      ) : (
        <button type="button" className="button hl-add-ex" onClick={() => setPicking(true)}>
          <Icon name="plus" size={13} /> Add an exercise
        </button>
      )}
      <Card>
        <label className="hl-field">
          <span>Notes</span>
          <textarea className="hl-input is-area" value={s.notes ?? ''} placeholder="How it went" onChange={(e) => set({ notes: e.target.value || undefined })} />
        </label>
        <div className="hl-form-foot">
          <button type="button" className="button primary" disabled={!s.title.trim()} onClick={() => void save()}>
            {isNew ? 'Save the session' : 'Save'}
          </button>
          <button type="button" className="button" onClick={onDone}>
            Cancel
          </button>
          <span className="hl-grow" />
          {!isNew && (
            <button type="button" className="button hl-danger" onClick={() => void act(H().remove('sessions', s.id), `Deleted “${s.title}”.`).then((ok) => ok && onDone())}>
              Delete
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}

function PlanEditor({ db, act, plan, onDone }: { db: HealthDb; act: Act; plan: Plan; onDone(): void }) {
  const [p, setP] = useState<Plan>(plan);
  const [picking, setPicking] = useState<number | null>(null);
  const set = (patch: Partial<Plan>) => setP((x) => ({ ...x, ...patch }));
  const setDay = (i: number, patch: Partial<PlanDay>) => set({ days: p.days.map((d, k) => (k === i ? { ...d, ...patch } : d)) });
  const letters = useMemo(() => 'ABCDEFGHIJKLMN', []);
  const save = async () => {
    if (!p.name.trim()) return;
    if (await act(H().put('plans', { ...p, id: p.id || undefined, name: p.name.trim() } as Record<string, unknown>), plan.id ? 'Saved the plan.' : `Made the plan “${p.name.trim()}”.`)) onDone();
  };
  return (
    <div className="hl-stack">
      <Card title={plan.id ? 'The plan' : 'A new plan'} icon="calendar" wide aside={<button type="button" className="button small" onClick={onDone}>Back</button>}>
        <div className="hl-form-grid">
          <label className="hl-field is-wide">
            <span>Name</span>
            <input className="hl-input is-text" autoFocus={!plan.id} value={p.name} placeholder="Strength, three days" onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="hl-field">
            <span>Weeks (blank: open-ended)</span>
            <input className="hl-input" inputMode="numeric" value={p.weeks ?? ''} onChange={(e) => set({ weeks: numIn(e.target.value) })} />
          </label>
          <label className="hl-field">
            <span>Starts</span>
            <input className="hl-input" type="date" value={p.start ?? ''} onChange={(e) => set({ start: e.target.value || undefined })} />
          </label>
        </div>
      </Card>
      {p.days.map((d, i) => (
        <Card key={d.id} className="hl-ex-card" title={<input className="hl-input is-title" value={d.label} aria-label="Day’s name" onChange={(e) => setDay(i, { label: e.target.value })} />} aside={<button type="button" className="icon-button" aria-label={`Take out ${d.label}`} onClick={() => set({ days: p.days.filter((_, k) => k !== i) })}><Icon name="trash" size={13} /></button>}>
          <div className="hl-form-grid">
            <label className="hl-field">
              <span>Focus</span>
              <input className="hl-input is-text" value={d.title} placeholder="Legs, Push, Easy run…" onChange={(e) => setDay(i, { title: e.target.value })} />
            </label>
            <label className="hl-field">
              <span>On</span>
              <select className="hl-input is-select" value={d.weekday ?? ''} onChange={(e) => setDay(i, { weekday: e.target.value === '' ? undefined : Number(e.target.value) })}>
                <option value="">In turn (after the day before)</option>
                {[1, 2, 3, 4, 5, 6, 0].map((w) => (
                  <option key={w} value={w}>
                    {weekdayName(w)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <table className="hl-sets">
            <thead>
              <tr>
                <th>Exercise</th>
                <th>Sets</th>
                <th>Reps</th>
                <th>Rest (s)</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {d.exercises.map((e, j) => (
                <tr key={j}>
                  <td>{e.name}</td>
                  <td><input className="hl-input is-cell is-short" inputMode="numeric" value={e.sets ?? ''} aria-label="Sets" onChange={(ev) => setDay(i, { exercises: d.exercises.map((x, k) => (k === j ? { ...x, sets: numIn(ev.target.value) } : x)) })} /></td>
                  <td><input className="hl-input is-cell is-short" value={e.reps ?? ''} placeholder="8-10" aria-label="Reps" onChange={(ev) => setDay(i, { exercises: d.exercises.map((x, k) => (k === j ? { ...x, reps: ev.target.value || undefined } : x)) })} /></td>
                  <td><input className="hl-input is-cell is-short" inputMode="numeric" value={e.rest ?? ''} aria-label="Rest in seconds" onChange={(ev) => setDay(i, { exercises: d.exercises.map((x, k) => (k === j ? { ...x, rest: numIn(ev.target.value) } : x)) })} /></td>
                  <td>
                    <button type="button" className="icon-button" aria-label={`Take out ${e.name}`} onClick={() => setDay(i, { exercises: d.exercises.filter((_, k) => k !== j) })}>
                      <Icon name="close" size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {picking === i ? (
            <Library db={db} act={act} onPick={(e) => setDay(i, { exercises: [...d.exercises, { name: e.name, ...(e.id ? { exercise: e.id } : {}), sets: 3, reps: '8-10' }] })} />
          ) : (
            <button type="button" className="link-button" onClick={() => setPicking(i)}>
              + Add an exercise
            </button>
          )}
        </Card>
      ))}
      <button type="button" className="button hl-add-ex" onClick={() => set({ days: [...p.days, { id: newId(), label: `Day ${letters[p.days.length] ?? p.days.length + 1}`, title: '', exercises: [] }] })}>
        <Icon name="plus" size={13} /> Add a day
      </button>
      <div className="hl-form-foot">
        <button type="button" className="button primary" disabled={!p.name.trim()} onClick={() => void save()}>
          {plan.id ? 'Save the plan' : 'Make the plan'}
        </button>
        <button type="button" className="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export { addDays };
