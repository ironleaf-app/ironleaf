// Health and Fitness › Food and water, Appointments and results, and Settings (Wave 5, 24 Oct 2026). Food: a day's meals
// by kind with their figures (never guessed: a meal without one says so in the totals), water counted up, the day against
// its targets. Appointments: booked ones with their reminders, past ones asked whether they happened, done ones with
// their results as the sheet gives them (the range and flag the sheet prints; never worked out here). Settings: the
// check-in's questions and time, the measures, the targets, log notes taken in (copied or moved, and put back), export and
// bringing an export back, and where it is all kept.

import { useEffect, useState } from 'react';
import {
  appointmentLine,
  dayWords,
  entryOn,
  foodOn,
  MEAL_KINDS,
  pastBooked,
  timeWords,
  todayIso,
  upcoming,
  whenWords,
  type Appointment,
  type HealthDb,
  type HealthResult,
  type MealKind,
} from '../../../../../shared/health';
import type { LogNoteOffer } from '../../../../../main/modules';
import { levelLabel } from '../../../../../shared/sensitivity';
import { isoOf } from '../../../../../shared/finance';
import { Icon } from '../../../components/Icon';
import { errorMessage } from '../../../lib/errors';
import * as A from '../../../state/actions';
import { moduleChanged } from '../../../state/modules';
import { showError, toast } from '../../../state/store';
import { Answer, Card, DayNav, NOT_ADVICE, WhoReads } from './bits';
import { MeasuresEditor } from './HealthTrack';
import { H, type HealthStatus } from './useHealth';

type Act = (p: Promise<HealthDb>, said?: string) => Promise<boolean>;
const numIn = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

// ── Food and water ────────────────────────────────────────────────────────────────────────────────────────────────

export function HealthFood({ db, act }: { db: HealthDb; act: Act }) {
  const today = todayIso();
  const [day, setDay] = useState(today);
  const food = foodOn(db, day);
  const water = db.measures.find((m) => m.id === 'water' && !m.archived);
  const t = db.targets;
  const bar = (label: string, n: number, target?: number, unit = '') => (
    <div className="hl-macro">
      <span className="hl-macro-top">
        <strong>{label}</strong>
        <span>
          {n.toLocaleString('en-AU')}
          {unit}
          {target ? ` of ${target.toLocaleString('en-AU')}${unit}` : ''}
        </span>
      </span>
      {target ? (
        <span className="hl-meter">
          <i style={{ width: `${Math.min(100, (n / target) * 100)}%` }} className={n > target * 1.1 ? 'is-over' : ''} />
        </span>
      ) : null}
    </div>
  );
  return (
    <div className="hl-stack">
      <div className="hl-two">
        <Card title="The day" icon="sun" aside={<DayNav day={day} onDay={setDay} />}>
          {bar('Energy', food.kcal, t.kcal, ' kcal')}
          {bar('Protein', food.protein, t.protein, ' g')}
          <div className="hl-macros-small">
            <span>Carbs {food.carbs} g</span>
            <span>Fat {food.fat} g</span>
          </div>
          {food.unknown > 0 && <p className="hl-faint">{food.unknown} meal{food.unknown === 1 ? '' : 's'} without figures {food.unknown === 1 ? 'is' : 'are'} left out of the totals.</p>}
        </Card>
        {water && (
          <Card title="Water" icon="flag">
            <div className="hl-water-big">
              <Answer m={water} entry={entryOn(db, water.id, day)} onSave={(v) => void act(H().entry(water.id, day, v === 0 ? null : v))} />
              <span className="hl-faint">{water.daily ? `goal ${water.daily} ${water.unit ?? ''}` : ''}</span>
            </div>
            {water.daily ? (
              <div className="hl-glasses" aria-hidden="true">
                {Array.from({ length: water.daily }, (_, i) => (
                  <span key={i} className={i < (entryOn(db, water.id, day)?.n ?? 0) ? 'is-full' : ''} />
                ))}
              </div>
            ) : null}
          </Card>
        )}
      </div>
      {MEAL_KINDS.map((k) => (
        <MealGroup key={k.id} kind={k.id} label={k.label} day={day} db={db} act={act} />
      ))}
    </div>
  );
}

function MealGroup({ kind, label, day, db, act }: { kind: MealKind; label: string; day: string; db: HealthDb; act: Act }) {
  const meals = foodOn(db, day).meals.filter((m) => m.meal === kind);
  const [draft, setDraft] = useState({ what: '', kcal: '', protein: '', carbs: '', fat: '' });
  const add = async () => {
    if (!draft.what.trim()) return;
    if (await act(H().put('meals', { day, meal: kind, what: draft.what.trim(), kcal: numIn(draft.kcal), protein: numIn(draft.protein), carbs: numIn(draft.carbs), fat: numIn(draft.fat) }))) setDraft({ what: '', kcal: '', protein: '', carbs: '', fat: '' });
  };
  const kcal = meals.reduce((a, m) => a + (m.kcal ?? 0), 0);
  return (
    <Card title={label} aside={kcal ? <span className="hl-faint">{kcal.toLocaleString('en-AU')} kcal</span> : undefined}>
      <table className="hl-table is-meals">
        <thead>
          <tr>
            <th>What</th>
            <th>kcal</th>
            <th>Protein g</th>
            <th>Carbs g</th>
            <th>Fat g</th>
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {meals.map((m) => (
            <tr key={m.id}>
              <td><input className="hl-input is-cell" defaultValue={m.what} aria-label="What" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== m.what && void act(H().put('meals', { ...m, what: e.target.value.trim() }))} /></td>
              {(['kcal', 'protein', 'carbs', 'fat'] as const).map((f) => (
                <td key={f}><input className="hl-input is-cell is-short" inputMode="decimal" defaultValue={m[f] ?? ''} aria-label={f} onBlur={(e) => numIn(e.target.value) !== m[f] && void act(H().put('meals', { ...m, [f]: numIn(e.target.value) ?? null }))} /></td>
              ))}
              <td>
                <button type="button" className="icon-button" aria-label={`Remove ${m.what}`} onClick={() => void act(H().remove('meals', m.id), `Removed “${m.what}”.`)}>
                  <Icon name="trash" size={13} />
                </button>
              </td>
            </tr>
          ))}
          <tr className="hl-new-row">
            <td><input className="hl-input is-cell" value={draft.what} placeholder={`Add to ${label.toLowerCase()}…`} aria-label={`New ${label.toLowerCase()}`} onChange={(e) => setDraft({ ...draft, what: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void add()} /></td>
            {(['kcal', 'protein', 'carbs', 'fat'] as const).map((f) => (
              <td key={f}><input className="hl-input is-cell is-short" inputMode="decimal" value={draft[f]} aria-label={`New ${f}`} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void add()} /></td>
            ))}
            <td>
              <button type="button" className="icon-button" aria-label="Add" disabled={!draft.what.trim()} onClick={() => void add()}>
                <Icon name="plus" size={13} />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

// ── Appointments and results ──────────────────────────────────────────────────────────────────────────────────────

const blankAppt = (): Partial<Appointment> => ({ who: '', day: todayIso(), time: '', where: '', why: '', remind: 1 });

export function HealthAppointments({ db, act }: { db: HealthDb; act: Act }) {
  const today = todayIso();
  const [form, setForm] = useState<Partial<Appointment> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const soon = upcoming(db, today, 3650);
  const past = pastBooked(db, today);
  const done = db.appointments.filter((a) => a.status === 'done').sort((a, b) => b.day.localeCompare(a.day));
  const save = async () => {
    if (!form?.who?.trim() || !form.day) return;
    if (await act(H().put('appointments', { ...form, who: form.who.trim(), time: form.time || undefined, status: form.status ?? 'booked', results: form.results ?? [] } as Record<string, unknown>), form.id ? 'Saved the appointment.' : `Booked in: ${form.who.trim()}, ${dayWords(form.day)}.`)) setForm(null);
  };
  return (
    <div className="hl-stack">
      <div className="hl-toolbar">
        <p className="hl-hint">Ironleaf reminds you before each one (a Windows notice, and on Today).</p>
        <span className="hl-grow" />
        <button type="button" className="button primary small" onClick={() => setForm(blankAppt())}>
          <Icon name="plus" size={13} /> Add an appointment
        </button>
      </div>
      {form && (
        <Card title={form.id ? 'The appointment' : 'A new appointment'} icon="calendar" wide>
          <div className="hl-form-grid">
            <label className="hl-field">
              <span>With</span>
              <input className="hl-input is-text" autoFocus value={form.who ?? ''} placeholder="GP, Dentist, Physio…" onChange={(e) => setForm({ ...form, who: e.target.value })} />
            </label>
            <label className="hl-field">
              <span>For</span>
              <input className="hl-input is-text" value={form.why ?? ''} placeholder="Check-up, blood test results…" onChange={(e) => setForm({ ...form, why: e.target.value })} />
            </label>
            <label className="hl-field">
              <span>Day</span>
              <input className="hl-input" type="date" value={form.day ?? ''} onChange={(e) => setForm({ ...form, day: e.target.value })} />
            </label>
            <label className="hl-field">
              <span>Time</span>
              <input className="hl-input" type="time" value={form.time ?? ''} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </label>
            <label className="hl-field">
              <span>Where</span>
              <input className="hl-input is-text" value={form.where ?? ''} placeholder="The clinic’s name or address" onChange={(e) => setForm({ ...form, where: e.target.value })} />
            </label>
            <label className="hl-field">
              <span>Remind me</span>
              <select className="hl-input is-select" value={form.remind ?? 1} onChange={(e) => setForm({ ...form, remind: Number(e.target.value) })}>
                <option value={0}>On the day</option>
                <option value={1}>The day before</option>
                <option value={2}>Two days before</option>
                <option value={7}>A week before</option>
              </select>
            </label>
          </div>
          <div className="hl-form-foot">
            <button type="button" className="button primary" disabled={!form.who?.trim() || !form.day} onClick={() => void save()}>
              {form.id ? 'Save' : 'Book it in'}
            </button>
            <button type="button" className="button" onClick={() => setForm(null)}>
              Cancel
            </button>
            <span className="hl-grow" />
            {form.id && (
              <button type="button" className="button hl-danger" onClick={() => void act(H().remove('appointments', form.id!), 'Deleted the appointment.').then((ok) => ok && setForm(null))}>
                Delete
              </button>
            )}
          </div>
        </Card>
      )}
      {past.length > 0 && (
        <Card title="Did these happen?" icon="help" className="hl-ask">
          <ul className="hl-appts">
            {past.map((a) => (
              <li key={a.id}>
                <span className="hl-appt-words">
                  <strong>{a.who}{a.why ? ` · ${a.why}` : ''}</strong>
                  <span>{dayWords(a.day)}{a.time ? ` at ${timeWords(a.time)}` : ''}</span>
                </span>
                <button type="button" className="button small" onClick={() => void act(H().put('appointments', { ...a, status: 'done' }), 'Marked done. Add its results when you have them.').then(() => setOpen(a.id))}>
                  Yes, done
                </button>
                <button type="button" className="button small" onClick={() => void act(H().put('appointments', { ...a, status: 'cancelled' }), 'Marked as not happening.')}>
                  No
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Coming up" icon="calendar">
        {soon.length ? (
          <ul className="hl-appts">
            {soon.map((a) => (
              <li key={a.id}>
                <span className={`hl-appt-when${a.day === today ? ' is-today' : ''}`}>
                  <strong>{new Date(`${a.day}T12:00:00`).getDate()}</strong>
                  <em>{dayWords(a.day).split(' ').slice(0, 1).join('')}</em>
                </span>
                <span className="hl-appt-words">
                  <strong>{a.who}{a.why ? ` · ${a.why}` : ''}</strong>
                  <span>{appointmentLine(a, today).replace(`${a.who}${a.why ? ` · ${a.why}` : ''}, `, '')}{a.remind !== undefined ? ` · reminder ${a.remind === 0 ? 'on the day' : a.remind === 1 ? 'the day before' : `${a.remind} days before`}` : ''}</span>
                </span>
                <button type="button" className="icon-button" aria-label={`Change ${a.who}`} onClick={() => setForm(a)}>
                  <Icon name="pencil" size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hl-empty-words">Nothing booked.</p>
        )}
      </Card>
      <Card title="Visits and results" icon="file">
        {done.length ? (
          <ul className="hl-visits">
            {done.map((a) => (
              <li key={a.id} className={open === a.id ? 'is-open' : ''}>
                <button type="button" className="hl-visit" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>
                  <Icon name="chevron" size={10} className={open === a.id ? 'is-open' : ''} />
                  <strong>{a.who}{a.why ? ` · ${a.why}` : ''}</strong>
                  <span className="hl-faint">{dayWords(a.day)} · {a.results.length ? `${a.results.length} result${a.results.length === 1 ? '' : 's'}` : 'no results yet'}</span>
                </button>
                {open === a.id && <Results a={a} act={act} />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="hl-empty-words">Visits you mark done show here, with their results.</p>
        )}
        <p className="hl-advice is-inline">Results are kept as the sheet gives them. {NOT_ADVICE}</p>
      </Card>
    </div>
  );
}

function Results({ a, act }: { a: Appointment; act: Act }) {
  const [draft, setDraft] = useState<Partial<HealthResult>>({ name: '', value: '', unit: '', range: '', flag: '' });
  const put = (results: HealthResult[], said?: string) => act(H().put('appointments', { ...a, results }), said);
  const add = async () => {
    if (!draft.name?.trim() || !draft.value?.trim()) return;
    if (await put([...a.results, { id: Math.random().toString(36).slice(2, 11), name: draft.name.trim(), value: draft.value.trim(), unit: draft.unit?.trim() || undefined, range: draft.range?.trim() || undefined, flag: (draft.flag || undefined) as HealthResult['flag'] }])) setDraft({ name: '', value: '', unit: '', range: '', flag: '' });
  };
  return (
    <div className="hl-results">
      <label className="hl-field">
        <span>Notes from the visit</span>
        <textarea className="hl-input is-area" defaultValue={a.notes ?? ''} placeholder="What was said, what to do next" onBlur={(e) => e.target.value !== (a.notes ?? '') && void act(H().put('appointments', { ...a, notes: e.target.value || null }))} />
      </label>
      <table className="hl-table">
        <thead>
          <tr>
            <th>Result</th>
            <th>Value</th>
            <th>Unit</th>
            <th>Range on the sheet</th>
            <th>The sheet says</th>
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {a.results.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.value}</td>
              <td className="hl-faint">{r.unit ?? ''}</td>
              <td className="hl-faint">{r.range ?? ''}</td>
              <td>{r.flag ? <span className={`hl-flag is-${r.flag}`}>{r.flag === 'normal' ? 'In range' : r.flag === 'high' ? 'High' : 'Low'}</span> : ''}</td>
              <td>
                <button type="button" className="icon-button" aria-label={`Remove ${r.name}`} onClick={() => void put(a.results.filter((x) => x.id !== r.id), `Removed ${r.name}.`)}>
                  <Icon name="trash" size={13} />
                </button>
              </td>
            </tr>
          ))}
          <tr className="hl-new-row">
            <td><input className="hl-input is-cell" value={draft.name} placeholder="e.g. Vitamin D" aria-label="Result" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
            <td><input className="hl-input is-cell is-short" value={draft.value} aria-label="Value" onChange={(e) => setDraft({ ...draft, value: e.target.value })} /></td>
            <td><input className="hl-input is-cell is-short" value={draft.unit} aria-label="Unit" onChange={(e) => setDraft({ ...draft, unit: e.target.value })} /></td>
            <td><input className="hl-input is-cell" value={draft.range} aria-label="Range" onChange={(e) => setDraft({ ...draft, range: e.target.value })} /></td>
            <td>
              <select className="hl-input is-cell is-select" value={draft.flag ?? ''} aria-label="The sheet says" onChange={(e) => setDraft({ ...draft, flag: e.target.value as HealthResult['flag'] })}>
                <option value="">None</option>
                <option value="normal">In range</option>
                <option value="high">High</option>
                <option value="low">Low</option>
              </select>
            </td>
            <td>
              <button type="button" className="icon-button" aria-label="Add the result" disabled={!draft.name?.trim() || !draft.value?.trim()} onClick={() => void add()}>
                <Icon name="plus" size={13} />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function HealthSettings({ db, act, status }: { db: HealthDb; act: Act; status: HealthStatus | null }) {
  const [targets, setTargets] = useState({ kcal: String(db.targets.kcal ?? ''), protein: String(db.targets.protein ?? ''), sessionsPerWeek: String(db.targets.sessionsPerWeek ?? ''), sleep: String(db.targets.sleep ?? '') });
  const saveTarget = (k: keyof typeof targets) => {
    const n = numIn(targets[k]);
    if (n !== db.targets[k]) void act(H().settings({ targets: { [k]: n } as HealthDb['targets'] }));
  };
  return (
    <div className="hl-stack">
      <Card title="The daily check-in" icon="check" wide>
        <div className="hl-form-grid">
          <label className="hl-field">
            <span>Due from</span>
            <input className="hl-input" type="time" value={db.checkin.time} onChange={(e) => e.target.value && void act(H().settings({ checkin: { ...db.checkin, time: e.target.value } }))} />
          </label>
        </div>
        <p className="hl-faint">It asks the measures ticked under Check-in below, in this order: {db.checkin.measures.map((id) => db.measures.find((m) => m.id === id)?.name).filter(Boolean).join(', ') || 'nothing yet'}.</p>
      </Card>
      <Card title="What you keep" icon="list" wide>
        <MeasuresEditor db={db} act={act} />
      </Card>
      <Card title="Targets" icon="flag" wide>
        <div className="hl-form-grid is-four">
          {(
            [
              ['kcal', 'Energy a day', 'kcal'],
              ['protein', 'Protein a day', 'g'],
              ['sessionsPerWeek', 'Sessions a week', ''],
              ['sleep', 'Sleep a night', 'h'],
            ] as const
          ).map(([k, label, unit]) => (
            <label key={k} className="hl-field">
              <span>{label}</span>
              <span className="hl-number is-compact">
                <input className="hl-input" inputMode="decimal" value={targets[k]} onChange={(e) => setTargets({ ...targets, [k]: e.target.value })} onBlur={() => saveTarget(k)} />
                {unit && <span className="hl-unit">{unit}</span>}
              </span>
            </label>
          ))}
        </div>
      </Card>
      <LogNotes db={db} />
      <Card title="Where it is kept" icon="lock" wide>
        <p className="hl-kept">
          Your health records are kept on this PC only, in their own encrypted file, with the key protected by Windows for your Windows account. They are not in your vault, so they don’t sync to your other PCs, and they are never sent to an assistant unless you ask it something specific; then only the entries that answer it, with a line in Settings › Privacy and secrets › Activity.
        </p>
        <WhoReads level="health" />
        {status?.problem && <p className="hl-warn">{status.problem}</p>}
        {status && !status.protectable && <p className="hl-warn">This PC can’t protect the key right now (Windows’ protected store isn’t available), so nothing new can be saved.</p>}
        <div className="hl-form-foot">
          <button type="button" className="button small" onClick={() => void H().exportFile().then((f) => f && toast(`Exported to ${f}. That file isn’t encrypted: keep it somewhere safe.`), showError)}>
            <Icon name="download" size={13} /> Export a copy
          </button>
          <button type="button" className="button small" onClick={() => void H().exportCsv().then((f) => f && toast(`Exported to ${f}. That file isn’t encrypted: keep it somewhere safe.`), showError)}>
            <Icon name="table" size={13} /> Export my data (CSV)
          </button>
          <button type="button" className="button small" onClick={() => void H().importFile().then((w) => { if (w) { toast(w); moduleChanged(); } }, showError)}>
            <Icon name="history" size={13} /> Bring back an export
          </button>
          <span className="hl-faint">{status?.words}</span>
        </div>
      </Card>
    </div>
  );
}

function LogNotes({ db }: { db: HealthDb }) {
  const [offers, setOffers] = useState<LogNoteOffer[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void H().logNotes().then((o) => live && setOffers(o), (e) => live && setFailed(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [tick, db.imports.length]);
  const take = async (paths: string[], moved: boolean) => {
    setBusy(true);
    try {
      const r = await H().takeIn(paths, moved);
      toast(r.words);
      moduleChanged();
      setTick((t) => t + 1);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };
  const moved = db.imports.filter((r) => r.moved && !r.restored);
  return (
    <Card title="Log notes" icon="notes" wide>
      <p className="hl-hint">Log notes in your vault (a dated entry a day) can come into the health store. Copy keeps the note where it is; Move puts it in Recently deleted and keeps its words here exactly, so it can be put back. A project’s Tracker or Habit reads its log note, so it shows nothing once that note is moved.</p>
      {failed && <p className="hl-warn">{failed}</p>}
      {offers && !offers.length && <p className="hl-empty-words">No log notes with entries in your vault.</p>}
      {offers && offers.length > 0 && (
        <ul className="hl-offers">
          {offers.map((o) => (
            <li key={o.path}>
              <span className="hl-offer-words">
                <button type="button" className="link-button" onClick={() => A.openPath(o.path)}>
                  {o.title}
                </button>
                <span className="hl-faint">
                  {o.plan.days} day{o.plan.days === 1 ? '' : 's'}{o.plan.first ? ` from ${dayWords(o.plan.first)} to ${dayWords(o.plan.last!)}` : ''} · {o.plan.fields.map((f) => `${f.field}${f.make ? ' (new)' : ''}`).join(', ')}{o.level !== 'open' ? ` · ${levelLabel(o.level)}` : ''}
                </span>
                {o.taken && <span className="hl-badge is-soft">{o.taken.moved ? 'Moved in' : 'Copied'} {whenWords(isoOf(new Date(o.taken.at)))}</span>}
              </span>
              <button type="button" className="button small" disabled={busy} onClick={() => void take([o.path], false)}>
                Copy in
              </button>
              <button type="button" className="button small" disabled={busy} onClick={() => void take([o.path], true)}>
                Move in
              </button>
            </li>
          ))}
        </ul>
      )}
      {moved.length > 0 && (
        <>
          <h4 className="hl-sub-head">Moved in</h4>
          <ul className="hl-offers">
            {moved.map((r) => (
              <li key={r.id}>
                <span className="hl-offer-words">
                  <strong>{r.title}</strong>
                  <span className="hl-faint">{r.entries} entries · moved {whenWords(isoOf(new Date(r.at)))} · was {r.path}</span>
                </span>
                <button type="button" className="button small" onClick={() => void H().putBack(r.id).then((x) => { toast(x.words, { label: 'Open', run: () => A.openPath(x.path) }); moduleChanged(); }, showError)}>
                  Put back as a note
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
