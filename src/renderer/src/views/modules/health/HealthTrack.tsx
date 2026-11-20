// Health and Fitness › Sleep, Body, Habits and Trends (Wave 5, 24 Oct 2026). Each is made of the same few parts — a
// figure logged for a day, a chart over a span, a summary — over the measures the person keeps. Body's estimates each say
// their method and inputs and are labelled estimates; nothing here is medical advice.

import { useMemo, useState } from 'react';
import {
  addDays,
  bodyEstimates,
  dayWords,
  entryOn,
  ESTIMATE_WORDS,
  measureStreak,
  seriesOf,
  summarise,
  todayIso,
  valueWords,
  type HealthDb,
  type Measure,
  type MeasureGroup,
  type MeasureKind,
} from '../../../../../shared/health';
import { plural } from '../../../../../shared/words';
import { Icon } from '../../../components/Icon';
import { openMenu } from '../../../components/Menu';
import { Answer, Bars, Card, changeWords, DayNav, LineChart, StreakGrid, Tile } from './bits';
import { H } from './useHealth';

type Act = (p: Promise<HealthDb>, said?: string) => Promise<boolean>;

// ── Sleep ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function HealthSleep({ db, act }: { db: HealthDb; act: Act }) {
  const today = todayIso();
  const [day, setDay] = useState(today);
  const sleepMs = db.measures.filter((m) => m.group === 'sleep' && !m.archived);
  const hours = sleepMs.find((m) => m.id === 'sleep') ?? sleepMs.find((m) => m.kind === 'number');
  const days = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
  const pts = hours ? seriesOf(db, hours.id, days[0], today) : [];
  const sm = summarise(pts, 'up');
  return (
    <div className="hl-stack">
      <Card title="Last night" icon="clock" aside={<DayNav day={day} onDay={setDay} />}>
        {sleepMs.length ? (
          <ul className="hl-log-rows">
            {sleepMs.map((m) => (
              <li key={m.id}>
                <span className="hl-q">{m.name}</span>
                <Answer m={m} entry={entryOn(db, m.id, day)} onSave={(v) => void act(H().entry(m.id, day, v))} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="hl-empty-words">No sleep measures are kept. Add one in Settings below the page.</p>
        )}
      </Card>
      {hours && (
        <Card title="The last 30 days" icon="chart" aside={<span className="hl-faint">{sm.count ? `average ${sm.average} h · ${sm.count} nights logged` : 'nothing logged yet'}</span>}>
          <Bars days={days.map((d) => ({ day: d, n: entryOn(db, hours.id, d)?.n ?? null }))} target={db.targets.sleep} unit="h" label="Hours slept, the last 30 days" />
          <div className="hl-bars-foot">
            <span>{dayWords(days[0])}</span>
            <span>{db.targets.sleep ? `Target ${db.targets.sleep} h` : ''}</span>
            <span>Today</span>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Body ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function HealthBody({ db, act }: { db: HealthDb; act: Act }) {
  const today = todayIso();
  const [day, setDay] = useState(today);
  const body = db.measures.filter((m) => m.group === 'body' && !m.archived);
  const [chart, setChart] = useState<string>(body.find((m) => seriesOf(db, m.id).length)?.id ?? body[0]?.id ?? '');
  const shown = body.find((m) => m.id === chart);
  const pts = shown ? seriesOf(db, shown.id, addDays(today, -180), today) : [];
  const sm = summarise(pts, shown?.better);
  const est = bodyEstimates(db);
  const [height, setHeight] = useState(db.profile.height ? String(db.profile.height) : '');
  return (
    <div className="hl-stack">
      <Card title="Measurements" icon="flag" aside={<DayNav day={day} onDay={setDay} />}>
        <ul className="hl-log-rows is-grid">
          {body.map((m) => {
            const last = seriesOf(db, m.id).at(-1);
            return (
              <li key={m.id}>
                <span className="hl-q">
                  {m.name}
                  {last && last.day !== day && <em>last {valueWords(m, { n: last.n })} · {dayWords(last.day)}</em>}
                </span>
                <Answer m={m} entry={entryOn(db, m.id, day)} onSave={(v) => void act(H().entry(m.id, day, v))} />
              </li>
            );
          })}
        </ul>
      </Card>
      {shown && (
        <Card
          title="Trend"
          icon="chart"
          wide
          aside={
            <div className="hl-chips">
              {body.map((m) => (
                <button key={m.id} type="button" className={`hl-chip${m.id === chart ? ' is-on' : ''}`} onClick={() => setChart(m.id)}>
                  {m.name}
                </button>
              ))}
            </div>
          }
        >
          <LineChart points={pts} target={shown.target} unit={shown.unit} label={`${shown.name}, the last six months`} />
          {sm.count > 0 && (
            <div className="hl-summary">
              <Tile label="Latest" value={valueWords(shown, { n: sm.latest!.n })} sub={dayWords(sm.latest!.day)} />
              <Tile label="Change" value={changeWords(sm.change, shown.unit)} sub={`since ${dayWords(sm.first!.day)}`} />
              <Tile label="7-day average" value={valueWords(shown, { n: sm.recent! })} />
              {sm.perWeek !== undefined && <Tile label="A week, about" value={changeWords(sm.perWeek, shown.unit)} sub="from the line through them" />}
              <GoalTile m={shown} act={act} />
            </div>
          )}
        </Card>
      )}
      <Card title="Estimates" icon="info" wide aside={<span className="hl-badge">Estimates, not measurements</span>}>
        <div className="hl-profile">
          <label className="hl-field">
            <span>Height</span>
            <span className="hl-number is-compact">
              <input className="hl-input" inputMode="decimal" value={height} aria-label="Height in cm" onChange={(e) => setHeight(e.target.value)} onBlur={() => Number(height) !== db.profile.height && Number(height) > 0 && void act(H().settings({ profile: { height: Number(height) } }))} />
              <span className="hl-unit">cm</span>
            </span>
          </label>
          <label className="hl-field">
            <span>Body fat formula</span>
            <select className="hl-input is-select" value={db.profile.sex ?? ''} onChange={(e) => void act(H().settings({ profile: { sex: (e.target.value || undefined) as 'female' | 'male' | undefined } }))}>
              <option value="">Choose…</option>
              <option value="female">Female (waist, hips, neck)</option>
              <option value="male">Male (waist, neck)</option>
            </select>
          </label>
        </div>
        {est.estimates.length ? (
          <ul className="hl-estimates">
            {est.estimates.map((e) => (
              <li key={e.id}>
                <div className="hl-est-top">
                  <span className="hl-est-label">{e.label}</span>
                  <span className="hl-badge is-soft">Estimate</span>
                </div>
                <span className="hl-est-value">
                  {e.value}
                  {e.unit && <small>{e.unit === '%' ? '%' : ` ${e.unit}`}</small>}
                </span>
                <span className="hl-est-method">{e.method}</span>
                <span className="hl-est-inputs">From: {e.inputs.join(' · ')}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {est.missing.length > 0 && <p className="hl-faint">To work out more, Ironleaf needs {est.missing.join(', and ')}.</p>}
        <p className="hl-advice is-inline">{ESTIMATE_WORDS}</p>
      </Card>
    </div>
  );
}

/** A name that changes where it is shown: a click (or Enter) makes it a box; Enter or leaving saves, Esc leaves it. */
export function NameEdit({ name, onSave }: { name: string; onSave(n: string): void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  if (!editing)
    return (
      <button type="button" className="hl-name-edit" title="Click to rename" onClick={() => (setDraft(name), setEditing(true))}>
        {name}
        <Icon name="pencil" size={11} />
      </button>
    );
  const done = (save: boolean) => {
    setEditing(false);
    const n = draft.trim();
    if (save && n && n !== name) onSave(n);
  };
  return <input className="hl-input is-title" autoFocus value={draft} aria-label="Name" onChange={(e) => setDraft(e.target.value)} onBlur={() => done(true)} onKeyDown={(e) => (e.key === 'Enter' ? done(true) : e.key === 'Escape' ? done(false) : undefined)} />;
}

function GoalTile({ m, act }: { m: Measure; act: Act }) {
  const [draft, setDraft] = useState(m.target !== undefined ? String(m.target) : '');
  return (
    <div className="hl-tile">
      <span className="hl-tile-label">Goal</span>
      <span className="hl-number is-compact">
        <input className="hl-input" inputMode="decimal" value={draft} placeholder="none" aria-label={`${m.name} goal`} onChange={(e) => setDraft(e.target.value)} onBlur={() => {
          const n = draft.trim() === '' ? undefined : Number(draft);
          if (n !== m.target && (n === undefined || Number.isFinite(n))) void act(H().put('measures', { ...m, target: n ?? null }));
        }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        {m.unit && <span className="hl-unit">{m.unit}</span>}
      </span>
    </div>
  );
}

// ── Habits ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function HealthHabits({ db, act }: { db: HealthDb; act: Act }) {
  const today = todayIso();
  const habits = db.measures.filter((m) => m.kind === 'yesno' && !m.archived);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const add = async () => {
    const n = name.trim();
    if (!n) return;
    // Found first (W5-33): a habit already there (even put away) comes back, never a second one.
    const same = db.measures.find((x) => x.name.trim().toLowerCase() === n.toLowerCase());
    if (same) {
      if (await act(H().put('measures', { ...same, archived: false }), same.archived ? `Brought back the habit “${same.name}”.` : `“${same.name}” is already a habit.`)) { setName(''); setAdding(false); }
      return;
    }
    if (await act(H().put('measures', { name: n, kind: 'yesno', group: 'habit', better: 'up' }), `Added the habit “${n}”.`)) {
      setName('');
      setAdding(false);
    }
  };
  return (
    <div className="hl-stack">
      <div className="hl-toolbar">
        <p className="hl-hint">Any yes or no you want to keep each day. A day not answered yet doesn’t break a run until it has passed.</p>
        <span className="hl-grow" />
        <button type="button" className="button primary small" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Add a habit
        </button>
      </div>
      {adding && (
        <Card className="hl-form-card">
          <form className="hl-inline-form" onSubmit={(e) => (e.preventDefault(), void add())}>
            <input className="hl-input is-text" autoFocus value={name} placeholder="What you do (or don’t) each day, e.g. Stretch" aria-label="The habit" onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="button primary small" disabled={!name.trim()}>
              Add
            </button>
            <button type="button" className="button small" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        </Card>
      )}
      {!habits.length && !adding && <p className="hl-empty-words">No habits yet. Add one to see its streak here and on Today.</p>}
      <div className="hl-habits">
        {habits.map((m) => {
          const s = measureStreak(db, m.id, today);
          return (
            <Card
              key={m.id}
              className="hl-habit"
              title={<NameEdit name={m.name} onSave={(n) => void act(H().put('measures', { ...m, name: n }))} />}
              aside={
                <button type="button" className="icon-button" aria-label={`More for ${m.name}`} onClick={(e) => openMenu(e.currentTarget, [
                  { label: m.checkin ? 'Leave out of the check-in' : 'Ask in the check-in', icon: 'check', run: () => void act(H().settings({ checkin: { ...db.checkin, measures: m.checkin || db.checkin.measures.includes(m.id) ? db.checkin.measures.filter((x) => x !== m.id) : [...db.checkin.measures, m.id] } })) },
                  { separator: true },
                  { label: 'Put away (keeps its days)', icon: 'trash', run: () => void act(H().put('measures', { ...m, archived: true }), `Put away “${m.name}”. Its days are kept.`) },
                ])}>
                  <Icon name="more" size={14} />
                </button>
              }
            >
              <div className="hl-habit-body">
                <div className="hl-run">
                  <strong>{s.current}</strong>
                  <span>day{s.current === 1 ? '' : 's'} in a row</span>
                  <em>best {s.best}{s.next ? ` · ${s.next.left} more to reach ${s.next.at}` : ''}</em>
                </div>
                <div className="hl-habit-side">
                  <span className="hl-faint">Today</span>
                  <Answer m={m} entry={entryOn(db, m.id, today)} onSave={(v) => void act(H().entry(m.id, today, v))} />
                </div>
              </div>
              <StreakGrid streak={s} label={m.name} onDay={(d, next) => void act(H().entry(m.id, d, next))} />
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── Trends ────────────────────────────────────────────────────────────────────────────────────────────────────────

const SPANS = [7, 30, 90, 365];
export function HealthTrends({ db, act }: { db: HealthDb; act: Act }) {
  const today = todayIso();
  const numeric = db.measures.filter((m) => !m.archived && (m.kind === 'number' || m.kind === 'scale'));
  const [pick, setPick] = useState(numeric.find((m) => seriesOf(db, m.id).length)?.id ?? numeric[0]?.id ?? '');
  const [span, setSpan] = useState(30);
  const m = numeric.find((x) => x.id === pick);
  const from = addDays(today, -(span - 1));
  const pts = useMemo(() => (m ? seriesOf(db, m.id, from, today) : []), [db, m, from, today]);
  const sm = summarise(pts, m?.better);
  const rows = m ? db.entries.filter((e) => e.measure === m.id && e.day >= from).sort((a, b) => b.day.localeCompare(a.day)) : [];
  if (!numeric.length) return <p className="hl-empty-words">Nothing with figures is kept yet.</p>;
  return (
    <div className="hl-stack">
      <div className="hl-toolbar is-wrap">
        <div className="hl-chips">
          {numeric.map((x) => (
            <button key={x.id} type="button" className={`hl-chip${x.id === pick ? ' is-on' : ''}`} onClick={() => setPick(x.id)}>
              {x.name}
              <em>{db.entries.filter((e) => e.measure === x.id).length || ''}</em>
            </button>
          ))}
        </div>
        <span className="hl-grow" />
        <div className="segmented hl-spans" role="tablist" aria-label="Over how long">
          {SPANS.map((d) => (
            <button key={d} role="tab" aria-selected={span === d} className={span === d ? 'active' : ''} onClick={() => setSpan(d)}>
              {d === 365 ? 'Year' : `${d} days`}
            </button>
          ))}
        </div>
      </div>
      {m && (
        <Card title={m.name} icon="chart" wide aside={<span className="hl-faint">{sm.count ? `${plural(sm.count, 'entry', 'entries')}` : ''}</span>}>
          <LineChart points={pts} target={m.target} unit={m.kind === 'scale' ? `of ${m.max ?? 10}` : m.unit} from={from} to={today} height={220} label={`${m.name}, ${span} days`} />
          {sm.count > 0 && (
            <div className="hl-summary">
              <Tile label="Latest" value={valueWords(m, { n: sm.latest!.n })} sub={dayWords(sm.latest!.day)} />
              <Tile label="Average" value={valueWords(m, { n: sm.average! })} />
              <Tile label="Lowest · highest" value={`${sm.min} · ${sm.max}`} />
              <Tile label="Change" value={changeWords(sm.change, m.kind === 'scale' ? '' : m.unit)} tone={sm.good === undefined ? 'none' : sm.good ? 'ok' : 'warn'} />
            </div>
          )}
          {rows.length > 0 && (
            <table className="hl-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>{m.name}</th>
                  <th>Written</th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 60).map((e) => (
                  <tr key={e.id}>
                    <td>{dayWords(e.day)}</td>
                    <td className="hl-cell">
                      <Answer m={m} entry={e} compact onSave={(v) => void act(H().entry(m.id, e.day, v))} />
                    </td>
                    <td className="hl-faint">{e.text && e.text !== String(e.n) ? `“${e.text}”` : e.by === 'imported' ? 'from a log note' : e.by && e.by !== 'you' ? e.by : ''}</td>
                    <td>
                      <button type="button" className="icon-button" aria-label={`Remove ${dayWords(e.day)}`} onClick={() => void act(H().entry(m.id, e.day, null), `Removed ${m.name} for ${dayWords(e.day)}.`)}>
                        <Icon name="trash" size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}

// ── Measures (Settings) ───────────────────────────────────────────────────────────────────────────────────────────

const GROUP_WORDS: Record<MeasureGroup, string> = { checkin: 'Check-in', body: 'Body', sleep: 'Sleep', food: 'Food and water', habit: 'Habit', other: 'Other' };
const KIND_WORDS: Record<MeasureKind, string> = { number: 'A number', scale: 'A score', yesno: 'Yes or no', text: 'Words' };

export function MeasuresEditor({ db, act }: { db: HealthDb; act: Act }) {
  const [draft, setDraft] = useState<{ name: string; kind: MeasureKind; unit: string; group: MeasureGroup }>({ name: '', kind: 'number', unit: '', group: 'other' });
  const live = db.measures.filter((m) => !m.archived);
  const away = db.measures.filter((m) => m.archived);
  const add = async () => {
    if (!draft.name.trim()) return;
    const same = db.measures.find((x) => x.name.trim().toLowerCase() === draft.name.trim().toLowerCase());
    if (same) {
      if (await act(H().put('measures', { ...same, archived: false }), same.archived ? `Brought back “${same.name}”.` : `“${same.name}” is already there.`)) setDraft({ name: '', kind: 'number', unit: '', group: 'other' });
      return;
    }
    if (await act(H().put('measures', { name: draft.name.trim(), kind: draft.kind, unit: draft.unit.trim() || undefined, group: draft.kind === 'yesno' ? 'habit' : draft.group, ...(draft.kind === 'scale' ? { min: 1, max: 10 } : {}) }), `Added “${draft.name.trim()}”.`)) setDraft({ name: '', kind: 'number', unit: '', group: 'other' });
  };
  return (
    <div className="hl-measures">
      <table className="hl-table">
        <thead>
          <tr>
            <th>Measure</th>
            <th>Kind</th>
            <th>Unit</th>
            <th>Part</th>
            <th>Check-in</th>
            <th aria-label="Put away" />
          </tr>
        </thead>
        <tbody>
          {live.map((m) => (
            <tr key={m.id}>
              <td>
                <input className="hl-input is-cell" defaultValue={m.name} aria-label="Name" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== m.name && void act(H().put('measures', { ...m, name: e.target.value.trim() }))} />
              </td>
              <td className="hl-faint">{KIND_WORDS[m.kind]}{m.kind === 'scale' ? ` (${m.min ?? 1}–${m.max ?? 10})` : ''}</td>
              <td>
                {m.kind === 'number' ? <input className="hl-input is-cell is-short" defaultValue={m.unit ?? ''} aria-label="Unit" onBlur={(e) => e.target.value.trim() !== (m.unit ?? '') && void act(H().put('measures', { ...m, unit: e.target.value.trim() || null }))} /> : null}
              </td>
              <td>
                <select className="hl-input is-cell is-select" value={m.group} aria-label="Part" onChange={(e) => void act(H().put('measures', { ...m, group: e.target.value }))}>
                  {(Object.keys(GROUP_WORDS) as MeasureGroup[]).map((g) => (
                    <option key={g} value={g}>
                      {GROUP_WORDS[g]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input type="checkbox" className="switch small" aria-label={`Ask ${m.name} in the check-in`} checked={db.checkin.measures.includes(m.id)} onChange={(e) => void act(H().settings({ checkin: { ...db.checkin, measures: e.target.checked ? [...db.checkin.measures, m.id] : db.checkin.measures.filter((x) => x !== m.id) } }))} />
              </td>
              <td>
                <button type="button" className="icon-button" title="Put away (its entries are kept)" aria-label={`Put away ${m.name}`} onClick={() => void act(H().put('measures', { ...m, archived: true }), `Put away “${m.name}”. Its entries are kept.`)}>
                  <Icon name="trash" size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="hl-inline-form" onSubmit={(e) => (e.preventDefault(), void add())}>
        <input className="hl-input is-text" value={draft.name} placeholder="A new measure, e.g. Resting heart rate" aria-label="New measure" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <select className="hl-input is-select" value={draft.kind} aria-label="Kind" onChange={(e) => setDraft({ ...draft, kind: e.target.value as MeasureKind })}>
          {(Object.keys(KIND_WORDS) as MeasureKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_WORDS[k]}
            </option>
          ))}
        </select>
        {draft.kind === 'number' && <input className="hl-input is-short" value={draft.unit} placeholder="unit" aria-label="Unit" onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />}
        <button type="submit" className="button primary small" disabled={!draft.name.trim()}>
          Add
        </button>
      </form>
      {away.length > 0 && (
        <p className="hl-faint">
          Put away: {away.map((m, i) => (
            <span key={m.id}>
              {i ? ', ' : ''}
              <button type="button" className="link-button" onClick={() => void act(H().put('measures', { ...m, archived: false }), `Brought back “${m.name}”.`)}>
                {m.name}
              </button>
            </span>
          ))} (click to bring one back)
        </p>
      )}
    </div>
  );
}
