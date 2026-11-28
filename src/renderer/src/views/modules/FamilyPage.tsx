// Family (Wave 5, 24 Oct 2026; module 10 of the catalogue: "Family members, school, activities, events, milestones,
// rewards — Family calendar, who's where, reward tracker", Family-private). The module's page: who's where this week,
// the family's cards, milestones, reward trackers, each person's documents and the photo albums. Everything shown is
// plain Markdown in the vault's Family area (src/shared/family.ts), read from the main side (src/main/modules.ts
// family:state) and changed where it is shown: a calendar row, a card's details, a tracker's day.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MEMBER_COLOURS, daysFrom, forPerson, ageOn, nextBirthday, readDays, type Activity, type CalendarSection, type FamilyEvent, type Happening, type Member, type Milestone, type Reward } from '../../../../shared/family';
import { MEMORY_EDITABLE, memoryRecords, memorySectionViews } from '../../../../shared/memories';
import { addDays, dayWords, timeWords, todayIso, weekStart, whenWords } from '../../../../shared/health';
import { changeProps } from '../../../../shared/frontmatter';
import type { FamilyState } from '../../../../main/modules';
import { EmptyState } from '../../components/EmptyState';
import { Icon, type IconName } from '../../components/Icon';
import { openMenu } from '../../components/Menu';
import { errorMessage } from '../../lib/errors';
import * as A from '../../state/actions';
import { docs } from '../../state/docs';
import { openModal } from '../../state/modals';
import { moduleChanged, openModule, partOfTab, useModuleTick, usePartOn } from '../../state/modules';
import { showError, toast, useApp } from '../../state/store';
import { useWork } from '../../state/workModules';
import type * as W from '../../state/workspace';
import { PageHead } from '../../components/PageHead';
import { familyNeeds, memoriesNeeds } from '../../../../shared/module-purpose';
import { NeedsYou } from './NeedsYou';
import { moduleInfo } from '../../../../shared/life-modules';
import { ModuleTour } from './ModuleTour';
import { AlbumCard, PersonCard, newAlbum, newCreative, openAlbum, openCreative, type MemoriesView } from './life/MemoriesPage';
import { WithRecords, WorkViews, useWorkCtx } from './work/WorkShell';
import { AlbumDetail } from './w3b/Memories87';
import { CreativeDetail, FamilyOverview, MemberDetail, PersonDetail, familyDetailOf, familyPlace, memberPathOf } from './w3b/Family87';

// Since the packs uplift item 5 merged Memories into Family, the previous layout holds the albums' tabs too:
// every album, by person, and the creative projects.
type Part = 'calendar' | 'members' | 'milestones' | 'rewards' | 'documents' | 'albums' | 'people' | 'creative';
const PARTS: { id: Part; label: string; icon: IconName }[] = [
  { id: 'calendar', label: 'Who’s where', icon: 'calendar' },
  { id: 'members', label: 'Family', icon: 'people' },
  { id: 'milestones', label: 'Milestones', icon: 'flag' },
  { id: 'rewards', label: 'Rewards', icon: 'star' },
  { id: 'documents', label: 'Documents', icon: 'file' },
  { id: 'albums', label: 'Albums', icon: 'image' },
  { id: 'people', label: 'By person', icon: 'people' },
  { id: 'creative', label: 'Making now', icon: 'canvas' },
];
// The member parts' switch is the module's own (members are always shown while Family is on).
const SWITCH: Record<Part, string | null> = { calendar: 'calendar', members: null, milestones: 'milestones', rewards: 'rewards', documents: 'documents', albums: 'albums', people: 'people', creative: 'creative' };
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_INDEX = [1, 2, 3, 4, 5, 6, 0];

// ── Reading the family's records ─────────────────────────────────────────────────────────────────────────────────────

export function useFamily(): { state: FamilyState | null; failed: string | null; reload(): void } {
  const tick = useModuleTick();
  const revision = useApp((s) => s.revision);
  const [state, setState] = useState<FamilyState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        void window.nv.modules.family.state().then(
          (s) => {
            if (!live) return;
            setState(s);
            setFailed(null);
          },
          (err) => live && setFailed(errorMessage(err)),
        ),
      state ? 200 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, revision, again]);
  useEffect(() => window.nv.modules.onChanged((m) => m === 'family' && setAgain((x) => x + 1)), []);
  return { state, failed, reload: useCallback(() => setAgain((x) => x + 1), []) };
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** A happening's colour: the first family member it names (else a quiet stone for everyone). */
export function colourOf(who: string[], members: Member[]): string {
  for (const w of who) {
    const m = members.find((x) => x.name.toLowerCase() === w.toLowerCase());
    if (m) return m.colour;
  }
  return 'stone';
}

/** A change made, said, and the page read again. */
async function act<T>(run: () => Promise<T>, said?: string | ((v: T) => string)): Promise<T | undefined> {
  try {
    const v = await run();
    moduleChanged();
    if (said) toast(typeof said === 'function' ? said(v) : said);
    return v;
  } catch (err) {
    showError(err);
    return undefined;
  }
}

// ── Small parts ──────────────────────────────────────────────────────────────────────────────────────────────────────

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`fy-field${wide ? ' is-wide' : ''}`}>
      <span className="fy-field-label">{label}</span>
      {children}
    </label>
  );
}

function WhoPicker({ members, value, onChange }: { members: Member[]; value: string; onChange(v: string): void }) {
  const picked = value
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const has = (n: string) => picked.some((p) => p.toLowerCase() === n.toLowerCase());
  const toggle = (n: string) => onChange((has(n) ? picked.filter((p) => p.toLowerCase() !== n.toLowerCase()) : [...picked, n]).join(', '));
  const others = picked.filter((p) => !members.some((m) => m.name.toLowerCase() === p.toLowerCase()));
  return (
    <div className="fy-who">
      {members.map((m) => (
        <button key={m.path} type="button" className={`fy-who-chip nt-${m.colour}${has(m.name) ? ' is-on' : ''}`} aria-pressed={has(m.name)} onClick={() => toggle(m.name)}>
          <span className="fy-dot" aria-hidden="true" />
          {m.name}
        </button>
      ))}
      <input
        className="fy-input fy-who-more"
        placeholder={members.length ? 'Or someone else' : 'Who (blank is everyone)'}
        value={others.join(', ')}
        onChange={(e) => {
          const mine = picked.filter((p) => members.some((m) => m.name.toLowerCase() === p.toLowerCase()));
          onChange([...mine, ...e.target.value.split(',').map((x) => x.trim()).filter(Boolean)].join(', '));
        }}
      />
    </div>
  );
}

function DayChips({ value, onChange }: { value: string; onChange(v: string): void }) {
  const on = new Set(readDays(value));
  const toggle = (d: number) => {
    const next = new Set(on);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    onChange(WEEKDAY_INDEX.filter((i) => next.has(i)).map((i) => WEEKDAY_SHORT[WEEKDAY_INDEX.indexOf(i)]).join(', '));
  };
  return (
    <div className="fy-days" role="group" aria-label="Which days">
      {WEEKDAY_INDEX.map((d, k) => (
        <button key={d} type="button" className={on.has(d) ? 'is-on' : ''} aria-pressed={on.has(d)} onClick={() => toggle(d)}>
          {WEEKDAY_SHORT[k]}
        </button>
      ))}
    </div>
  );
}

function FormFoot({ busy, words, onCancel, onDelete, disabled }: { busy: boolean; words: string; onCancel(): void; onDelete?: () => void; disabled?: boolean }) {
  return (
    <div className="fy-form-foot">
      {onDelete && (
        <button type="button" className="button fy-danger" onClick={onDelete} disabled={busy}>
          <Icon name="trash" size={13} /> Delete
        </button>
      )}
      <span className="fy-grow" />
      <button type="button" className="button" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
      <button type="submit" className="button primary" disabled={busy || disabled}>
        {words}
      </button>
    </div>
  );
}

// ── Who's where ──────────────────────────────────────────────────────────────────────────────────────────────────────

type Editing = { kind: 'new-event'; date?: string } | { kind: 'new-activity' } | { kind: 'event'; e: FamilyEvent } | { kind: 'activity'; a: Activity } | null;

export function EventForm({ members, initial, date, onDone }: { members: Member[]; initial?: FamilyEvent; date?: string; onDone(): void }) {
  const [v, setV] = useState({ Date: initial?.date ?? date ?? todayIso(), Time: initial?.time ?? '', Who: initial?.who.join(', ') ?? '', What: initial?.what ?? '', Where: initial?.where ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (x: string) => setV((o) => ({ ...o, [k]: x }));
  const submit = async () => {
    setBusy(true);
    const ok = await act(() => (initial ? window.nv.modules.family.set('Events', initial.row, v) : window.nv.modules.family.add('Events', v)), initial ? 'Event changed.' : `Added “${v.What}” to the family calendar.`);
    setBusy(false);
    if (ok !== undefined) onDone();
  };
  const remove = async () => {
    if (!initial) return;
    setBusy(true);
    const ok = await act(() => window.nv.modules.family.remove('Events', initial.row), 'Event deleted.');
    setBusy(false);
    if (ok !== undefined) onDone();
  };
  return (
    <form
      className="fy-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>{initial ? 'Change the event' : 'A one-day event'}</h3>
      <div className="fy-grid">
        <Field label="What" wide>
          <input className="fy-input" autoFocus value={v.What} onChange={(e) => set('What')(e.target.value)} placeholder="School concert, a birthday party, a game" />
        </Field>
        <Field label="Day">
          <input className="fy-input" type="date" value={v.Date} onChange={(e) => set('Date')(e.target.value)} />
        </Field>
        <Field label="Time">
          <input className="fy-input" type="time" value={v.Time} onChange={(e) => set('Time')(e.target.value)} />
        </Field>
        <Field label="Where" wide>
          <input className="fy-input" value={v.Where} onChange={(e) => set('Where')(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Who" wide>
          <WhoPicker members={members} value={v.Who} onChange={set('Who')} />
        </Field>
      </div>
      <FormFoot busy={busy} words={initial ? 'Save' : 'Add event'} onCancel={onDone} onDelete={initial ? () => void remove() : undefined} disabled={!v.What.trim() || !v.Date} />
    </form>
  );
}

export function ActivityForm({ members, initial, onDone }: { members: Member[]; initial?: Activity; onDone(): void }) {
  const [v, setV] = useState({ Who: initial?.who.join(', ') ?? '', What: initial?.what ?? '', Day: initial?.dayWords ?? '', Time: initial?.time ?? '', Where: initial?.where ?? '', Until: initial?.until ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (x: string) => setV((o) => ({ ...o, [k]: x }));
  const submit = async () => {
    setBusy(true);
    const ok = await act(() => (initial ? window.nv.modules.family.set('Activities', initial.row, v) : window.nv.modules.family.add('Activities', v)), initial ? 'Activity changed.' : `Added “${v.What}” each ${v.Day}.`);
    setBusy(false);
    if (ok !== undefined) onDone();
  };
  const remove = async () => {
    if (!initial) return;
    setBusy(true);
    const ok = await act(() => window.nv.modules.family.remove('Activities', initial.row), 'Activity deleted.');
    setBusy(false);
    if (ok !== undefined) onDone();
  };
  return (
    <form
      className="fy-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>{initial ? 'Change the weekly activity' : 'Something each week'}</h3>
      <div className="fy-grid">
        <Field label="What" wide>
          <input className="fy-input" autoFocus value={v.What} onChange={(e) => set('What')(e.target.value)} placeholder="Swimming, piano, school pickup" />
        </Field>
        <Field label="Days" wide>
          <DayChips value={v.Day} onChange={set('Day')} />
        </Field>
        <Field label="Time">
          <input className="fy-input" type="time" value={v.Time} onChange={(e) => set('Time')(e.target.value)} />
        </Field>
        <Field label="Until">
          <input className="fy-input" type="date" value={v.Until} onChange={(e) => set('Until')(e.target.value)} />
        </Field>
        <Field label="Where" wide>
          <input className="fy-input" value={v.Where} onChange={(e) => set('Where')(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Who" wide>
          <WhoPicker members={members} value={v.Who} onChange={set('Who')} />
        </Field>
      </div>
      <FormFoot busy={busy} words={initial ? 'Save' : 'Add activity'} onCancel={onDone} onDelete={initial ? () => void remove() : undefined} disabled={!v.What.trim() || !readDays(v.Day).length} />
    </form>
  );
}

function ItemChip({ h, members, onOpen }: { h: Happening; members: Member[]; onOpen(): void }) {
  const colour = colourOf(h.who, members);
  const label = `${h.time ? `${timeWords(h.time)} ` : ''}${h.what}${h.who.length ? `, ${h.who.join(', ')}` : ''}${h.where ? `, at ${h.where}` : ''}`;
  return (
    <button type="button" className={`fy-item nt-${colour} is-${h.kind}`} onClick={onOpen} title={h.kind === 'birthday' ? label : `${label}\nClick to change it`} aria-label={label}>
      <span className="fy-item-top">
        {h.time && <span className="fy-item-time">{timeWords(h.time)}</span>}
        {h.kind === 'activity' && <Icon name="history" size={10} className="fy-item-repeat" />}
        {h.kind === 'birthday' && <Icon name="star" size={10} />}
      </span>
      <span className="fy-item-what">{h.what}</span>
      {(h.who.length > 0 || h.where) && <span className="fy-item-meta">{[h.who.join(', '), h.where].filter(Boolean).join(' · ')}</span>}
    </button>
  );
}

function CalendarPart({ state, canEdit }: { state: FamilyState; canEdit: boolean }) {
  const today = todayIso();
  const [from, setFrom] = useState(() => weekStart(today));
  const [who, setWho] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const days = useMemo(() => daysFrom(state.calendar, state.members, from, 7).map((d) => ({ ...d, items: who ? forPerson(d.items, who) : d.items })), [state, from, who]);
  const thisWeek = from === weekStart(today);
  const open = (h: Happening) => {
    if (!canEdit || h.row === undefined) return;
    if (h.kind === 'event') {
      const e = state.calendar.events.find((x) => x.row === h.row);
      if (e) setEditing({ kind: 'event', e });
    } else if (h.kind === 'activity') {
      const a = state.calendar.activities.find((x) => x.row === h.row);
      if (a) setEditing({ kind: 'activity', a });
    }
  };
  const count = days.reduce((n, d) => n + d.items.length, 0);
  const done = () => setEditing(null);
  return (
    <div className="fy-part">
      <NeedsYou cards={familyNeeds(state.calendar.events.map((e) => ({ what: e.what, who: e.who.join(', '), date: e.date })), state.members.flatMap((mb) => { const b = nextBirthday(mb.born, today); return b ? [{ name: mb.name, day: b.day }] : []; }), today)} today={today} canEdit={canEdit} onAction={() => void A.openPath(state.calendarPath)} />
      <div className="fy-toolbar">
        <div className="fy-weeknav">
          <button type="button" className="icon-button" aria-label="The week before" title="The week before" onClick={() => setFrom(addDays(from, -7))}>
            <Icon name="back" size={15} />
          </button>
          <strong>{thisWeek ? 'This week' : from === addDays(weekStart(today), 7) ? 'Next week' : from === addDays(weekStart(today), -7) ? 'Last week' : `Week of ${dayWords(from, today)}`}</strong>
          <span className="fy-faint">
            {dayWords(from, today)} – {dayWords(addDays(from, 6), today)}
          </span>
          <button type="button" className="icon-button" aria-label="The week after" title="The week after" onClick={() => setFrom(addDays(from, 7))}>
            <Icon name="forward" size={15} />
          </button>
          {!thisWeek && (
            <button type="button" className="button small" onClick={() => setFrom(weekStart(today))}>
              Today
            </button>
          )}
        </div>
        <span className="fy-grow" />
        {canEdit && (
          <button
            type="button"
            className="button primary small"
            onClick={(e) =>
              openMenu(e.currentTarget, [
                { label: 'A one-day event…', icon: 'calendar', run: () => setEditing({ kind: 'new-event' }) },
                { label: 'Something each week…', icon: 'history', run: () => setEditing({ kind: 'new-activity' }) },
              ])
            }
          >
            <Icon name="plus" size={13} /> Add
          </button>
        )}
      </div>
      {state.members.length > 0 && (
        <div className="fy-filter" role="group" aria-label="Show one person">
          <button type="button" className={who === null ? 'is-on' : ''} aria-pressed={who === null} onClick={() => setWho(null)}>
            Everyone
          </button>
          {state.members.map((m) => (
            <button key={m.path} type="button" className={`nt-${m.colour}${who === m.name ? ' is-on' : ''}`} aria-pressed={who === m.name} onClick={() => setWho(who === m.name ? null : m.name)}>
              <span className="fy-dot" aria-hidden="true" />
              {m.name}
            </button>
          ))}
        </div>
      )}
      {editing && (
        <div className="fy-editor">
          {editing.kind === 'new-event' || editing.kind === 'event' ? <EventForm key={editing.kind === 'event' ? `e${editing.e.row}` : `new${editing.date ?? ''}`} members={state.members} initial={editing.kind === 'event' ? editing.e : undefined} date={editing.kind === 'new-event' ? editing.date : undefined} onDone={done} /> : <ActivityForm key={editing.kind === 'activity' ? `a${editing.a.row}` : 'new'} members={state.members} initial={editing.kind === 'activity' ? editing.a : undefined} onDone={done} />}
        </div>
      )}
      <div className="fy-week" role="list" aria-label="The week, day by day">
        {days.map((d) => {
          const isToday = d.day === today;
          return (
            <section key={d.day} className={`fy-day${isToday ? ' is-today' : ''}${d.day < today ? ' is-past' : ''}`} role="listitem" aria-label={dayWords(d.day, today)}>
              <header className="fy-day-head">
                <span className="fy-day-name">{dayWords(d.day, today).split(' ')[0]}</span>
                <span className="fy-day-num">{Number(d.day.slice(8))}</span>
                {isToday && <span className="fy-today-pill">Today</span>}
              </header>
              <div className="fy-day-items">
                {d.items.map((h, i) => (
                  <ItemChip key={`${h.kind}-${h.row ?? i}-${i}`} h={h} members={state.members} onOpen={() => open(h)} />
                ))}
                {!d.items.length && <span className="fy-day-free">Free</span>}
                {canEdit && (
                  <button type="button" className="fy-day-add" aria-label={`Add an event on ${dayWords(d.day, today)}`} title="Add an event on this day" onClick={() => setEditing({ kind: 'new-event', date: d.day })}>
                    <Icon name="plus" size={11} />
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {count === 0 && !editing && (
        <p className="fy-hint">
          {state.calendar.activities.length + state.calendar.events.length === 0 ? 'Add what happens each week (sport, lessons, pickups) and the days that are different, and everyone’s week shows here.' : who ? `Nothing on for ${who} this week.` : 'Nothing on this week.'}
        </p>
      )}
      <p className="fy-source">
        Kept in{' '}
        <button type="button" className="link-button" onClick={() => A.openPath(state.calendarPath)}>
          {state.calendarPath}
        </button>{' '}
        as three plain tables: change it there or here.
      </p>
    </div>
  );
}

// ── Members ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function ColourSwatches({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <div className="fy-swatches" role="radiogroup" aria-label="Their colour">
      {MEMBER_COLOURS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} title={c} className={`fy-swatch nt-${c}${value === c ? ' is-on' : ''}`} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}

export function MemberForm({ initial, used, onDone }: { initial?: Member; used: string[]; onDone(): void }) {
  const firstFree = MEMBER_COLOURS.find((c) => !used.includes(c)) ?? MEMBER_COLOURS[0];
  const [v, setV] = useState({ name: initial?.name ?? '', relation: initial?.relation ?? '', born: initial?.born ?? '', school: initial?.school ?? '', colour: initial?.colour ?? firstFree });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (x: string) => setV((o) => ({ ...o, [k]: x }));
  const submit = async () => {
    setBusy(true);
    let ok: unknown;
    if (initial) {
      ok = await act(async () => {
        const text = await docs.readThrough(initial.path);
        const next = changeProps(text, (doc) => {
          doc.set('family', v.relation.trim() || true);
          for (const [k, val] of [
            ['born', v.born],
            ['school', v.school.trim()],
            ['colour', v.colour],
          ] as const)
            if (val) doc.set(k, val);
            else doc.delete(k);
          if (!doc.get('sensitivity')) doc.set('sensitivity', 'family');
        });
        if (next !== text) await docs.writeThrough(initial.path, next, 'family');
        return true;
      }, `${initial.name}’s card changed.`);
    } else ok = await act(() => window.nv.modules.family.addMember(v), `Made ${v.name.trim()}’s card (Family-private).`);
    setBusy(false);
    if (ok !== undefined) onDone();
  };
  return (
    <form
      className="fy-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>{initial ? `${initial.name}’s details` : 'Someone in the family'}</h3>
      <div className="fy-grid">
        {!initial && (
          <Field label="Name" wide>
            <input className="fy-input" autoFocus value={v.name} onChange={(e) => set('name')(e.target.value)} placeholder="Their name" />
          </Field>
        )}
        <Field label="Relation">
          <input className="fy-input" autoFocus={!!initial} value={v.relation} onChange={(e) => set('relation')(e.target.value)} placeholder="Partner, daughter, son…" />
        </Field>
        <Field label="Born">
          <input className="fy-input" type="date" value={v.born} onChange={(e) => set('born')(e.target.value)} />
        </Field>
        <Field label="School or work" wide>
          <input className="fy-input" value={v.school} onChange={(e) => set('school')(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Colour on the calendar" wide>
          <ColourSwatches value={v.colour} onChange={set('colour')} />
        </Field>
      </div>
      <FormFoot busy={busy} words={initial ? 'Save' : 'Add to the family'} onCancel={onDone} disabled={!initial && !v.name.trim()} />
    </form>
  );
}

function DocList({ docs }: { docs: { path: string; name: string; expires?: string }[] }) {
  if (!docs.length) return null;
  const today = todayIso();
  return (
    <ul className="fy-docs">
      {docs.map((d) => (
        <li key={d.path}>
          <button type="button" className="fy-doc" onClick={() => A.openPath(d.path)} title={d.path}>
            <Icon name={/\.md$/i.test(d.path) ? 'notes' : 'file'} size={13} />
            <span>{d.name}</span>
            {d.expires && <span className="fy-doc-expiry">{d.expires < today ? `ran out ${dayWords(d.expires, today)}` : `runs to ${dayWords(d.expires, today)}`}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function MemberCard({ m, state, canEdit, onEdit, showDocs }: { m: Member; state: FamilyState; canEdit: boolean; onEdit(): void; showDocs: boolean }) {
  const today = todayIso();
  const age = ageOn(m.born, today);
  const bday = nextBirthday(m.born, today);
  const docs = state.documents[m.path] ?? [];
  return (
    <li className={`fy-member nt-${m.colour}`}>
      <div className="fy-member-top">
        <button type="button" className="fy-avatar" onClick={() => A.openPath(m.path)} title={`Open ${m.name}’s card`} aria-label={`Open ${m.name}’s card`}>
          {initialsOf(m.name)}
        </button>
        <div className="fy-member-words">
          <button type="button" className="fy-member-name" onClick={() => A.openPath(m.path)}>
            {m.name}
            <span className="fy-lock" title="Family-private: agents read it only if you allow Family-private for them">
              <Icon name="lock" size={10} /> Family-private
            </span>
          </button>
          <span className="fy-member-sub">{[m.relation, age !== null ? `${age}` : '', m.school].filter(Boolean).join(' · ') || (canEdit ? 'Add their details' : '')}</span>
          {bday && <span className="fy-member-bday">{bday.in === 0 ? `Birthday today (${bday.age})` : `Turns ${bday.age} ${bday.in === 1 ? 'tomorrow' : `in ${bday.in} days`} · ${dayWords(bday.day, today)}`}</span>}
        </div>
        {canEdit && (
          <button type="button" className="icon-button fy-edit" title="Change their details" aria-label={`Change ${m.name}’s details`} onClick={onEdit}>
            <Icon name="pencil" size={13} />
          </button>
        )}
      </div>
      {showDocs && (
        <div className="fy-member-docs">
          <span className="fy-mini-head">Documents</span>
          {docs.length ? <DocList docs={docs} /> : <span className="fy-faint">None yet: files in {state.folder}/Files/{m.name}/ and links on their card show here.</span>}
        </div>
      )}
    </li>
  );
}

function MembersPart({ state, canEdit, adding, setAdding }: { state: FamilyState; canEdit: boolean; adding: boolean; setAdding(v: boolean): void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const docsOn = usePartOn('family', 'documents');
  const used = state.members.map((m) => m.colour);
  return (
    <div className="fy-part">
      <div className="fy-toolbar">
        <span className="fy-faint">{state.members.length === 1 ? '1 person' : `${state.members.length} people`} · each card is a note in {state.folder}/People</span>
        <span className="fy-grow" />
        {canEdit && !adding && (
          <button type="button" className="button primary small" onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} /> Add someone
          </button>
        )}
      </div>
      {adding && (
        <div className="fy-editor">
          <MemberForm used={used} onDone={() => setAdding(false)} />
        </div>
      )}
      <ul className="fy-members">
        {state.members.map((m) =>
          editing === m.path ? (
            <li key={m.path} className="fy-member is-editing">
              <MemberForm initial={m} used={used} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <MemberCard key={m.path} m={m} state={state} canEdit={canEdit} showDocs={docsOn} onEdit={() => setEditing(m.path)} />
          ),
        )}
      </ul>
    </div>
  );
}

// ── Milestones ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function MilestoneForm({ members, initial, onDone }: { members: Member[]; initial?: Milestone; onDone(): void }) {
  const [v, setV] = useState({ Date: initial?.date ?? todayIso(), Who: initial?.who.join(', ') ?? '', Milestone: initial?.what ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (x: string) => setV((o) => ({ ...o, [k]: x }));
  const submit = async () => {
    setBusy(true);
    const ok = await act(() => (initial ? window.nv.modules.family.set('Milestones', initial.row, v) : window.nv.modules.family.add('Milestones', v)), initial ? 'Milestone changed.' : 'Milestone kept.');
    setBusy(false);
    if (ok !== undefined) onDone();
  };
  const remove = async () => {
    if (!initial) return;
    setBusy(true);
    const ok = await act(() => window.nv.modules.family.remove('Milestones', initial.row), 'Milestone deleted.');
    setBusy(false);
    if (ok !== undefined) onDone();
  };
  return (
    <form
      className="fy-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>{initial ? 'Change the milestone' : 'A moment worth keeping'}</h3>
      <div className="fy-grid">
        <Field label="The milestone" wide>
          <input className="fy-input" autoFocus value={v.Milestone} onChange={(e) => set('Milestone')(e.target.value)} placeholder="First day of school, swam a length, an award" />
        </Field>
        <Field label="Day">
          <input className="fy-input" type="date" value={v.Date} onChange={(e) => set('Date')(e.target.value)} />
        </Field>
        <Field label="Who" wide>
          <WhoPicker members={members} value={v.Who} onChange={set('Who')} />
        </Field>
      </div>
      <FormFoot busy={busy} words={initial ? 'Save' : 'Keep it'} onCancel={onDone} onDelete={initial ? () => void remove() : undefined} disabled={!v.Milestone.trim() || !v.Date} />
    </form>
  );
}

function MilestonesPart({ state, canEdit }: { state: FamilyState; canEdit: boolean }) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const today = todayIso();
  const list = [...state.calendar.milestones].filter((m) => !who || m.who.some((w) => w.toLowerCase() === who.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date));
  const years = [...new Set(list.map((m) => m.date.slice(0, 4)))];
  return (
    <div className="fy-part">
      <div className="fy-toolbar">
        {state.members.length > 0 && (
          <div className="fy-filter is-inline" role="group" aria-label="Show one person">
            <button type="button" className={who === null ? 'is-on' : ''} onClick={() => setWho(null)}>
              Everyone
            </button>
            {state.members.map((m) => (
              <button key={m.path} type="button" className={`nt-${m.colour}${who === m.name ? ' is-on' : ''}`} onClick={() => setWho(who === m.name ? null : m.name)}>
                <span className="fy-dot" aria-hidden="true" />
                {m.name}
              </button>
            ))}
          </div>
        )}
        <span className="fy-grow" />
        {canEdit && editing !== 'new' && (
          <button type="button" className="button primary small" onClick={() => setEditing('new')}>
            <Icon name="plus" size={13} /> Keep a milestone
          </button>
        )}
      </div>
      {editing === 'new' && (
        <div className="fy-editor">
          <MilestoneForm members={state.members} onDone={() => setEditing(null)} />
        </div>
      )}
      {!list.length && editing !== 'new' && <EmptyState size="panel" icon="flag" title={who ? `No milestones for ${who} yet` : 'No milestones yet'} line="Firsts, awards and big moments, by person and day." action={canEdit ? { label: 'Keep a milestone', icon: 'plus', run: () => setEditing('new') } : undefined} />}
      {years.map((y) => (
        <section key={y} className="fy-year">
          <h3 className="fy-year-head">{y}</h3>
          <ol className="fy-milestones">
            {list
              .filter((m) => m.date.startsWith(y))
              .map((m) =>
                editing === m.row ? (
                  <li key={m.row} className="fy-milestone is-editing">
                    <MilestoneForm members={state.members} initial={m} onDone={() => setEditing(null)} />
                  </li>
                ) : (
                  <li key={m.row} className={`fy-milestone nt-${colourOf(m.who, state.members)}`}>
                    <span className="fy-milestone-dot" aria-hidden="true" />
                    <button type="button" className="fy-milestone-main" disabled={!canEdit} onClick={() => setEditing(m.row)} title={canEdit ? 'Click to change it' : undefined}>
                      <span className="fy-milestone-what">{m.what}</span>
                      <span className="fy-milestone-meta">
                        {dayWords(m.date, today)}
                        {m.who.length > 0 && ` · ${m.who.join(', ')}`}
                      </span>
                    </button>
                  </li>
                ),
              )}
          </ol>
        </section>
      ))}
    </div>
  );
}

// ── Reward trackers ──────────────────────────────────────────────────────────────────────────────────────────────────

export function RewardForm({ members, initial, onDone }: { members: Member[]; initial?: Reward; onDone(): void }) {
  const [who, setWho] = useState(initial?.who ?? members[0]?.name ?? '');
  const [habit, setHabit] = useState(initial?.habit ?? '');
  const [rows, setRows] = useState<{ at: string; reward: string }[]>(initial ? initial.rewards.map((r) => ({ at: String(r.at), reward: r.reward })) : [{ at: '7', reward: '' }, { at: '14', reward: '' }, { at: '30', reward: '' }]);
  const [busy, setBusy] = useState(false);
  const clean = rows.map((r) => ({ at: Math.round(Number(r.at)), reward: r.reward.trim() })).filter((r) => Number.isInteger(r.at) && r.at > 0);
  const submit = async () => {
    setBusy(true);
    let ok: unknown;
    if (initial) {
      ok = await act(async () => {
        const text = await docs.readThrough(initial.path);
        const next = changeProps(text, (doc) => {
          const sorted = [...clean].sort((a, b) => a.at - b.at);
          doc.set('milestones', doc.createNode(sorted.map((r) => r.at), { flow: true }));
          doc.set('rewards', doc.createNode(Object.fromEntries(sorted.map((r) => [String(r.at), r.reward || `Day ${r.at}`])), { flow: true }));
        });
        if (next !== text) await docs.writeThrough(initial.path, next, 'family');
        return true;
      }, 'Rewards changed.');
    } else ok = await act(() => window.nv.modules.family.addReward({ who, habit, rewards: clean }), `Started ${who}’s ${habit} tracker.`);
    setBusy(false);
    if (ok !== undefined) onDone();
  };
  return (
    <form
      className="fy-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>{initial ? `${initial.who}’s rewards` : 'A new reward tracker'}</h3>
      <div className="fy-grid">
        {!initial && (
          <>
            <Field label="Who it’s for">
              {members.length ? (
                <select className="fy-input" value={who} onChange={(e) => setWho(e.target.value)}>
                  {members.map((m) => (
                    <option key={m.path} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="fy-input" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Their name" />
              )}
            </Field>
            <Field label="What they do each day">
              <input className="fy-input" autoFocus value={habit} onChange={(e) => setHabit(e.target.value)} placeholder="Reading, teeth brushed, bed made" />
            </Field>
          </>
        )}
        <Field label="Rewards along the way" wide>
          <div className="fy-ladder-edit">
            {rows.map((r, i) => (
              <div key={i} className="fy-ladder-row">
                <span className="fy-faint">Day</span>
                <input className="fy-input fy-num" type="number" min={1} value={r.at} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, at: e.target.value } : x)))} aria-label="After how many days" />
                <input className="fy-input" value={r.reward} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, reward: e.target.value } : x)))} placeholder="The reward (a movie night, a day out)" aria-label="The reward" />
                <button type="button" className="icon-button" aria-label="Take this reward out" onClick={() => setRows(rows.filter((_, k) => k !== i))}>
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
            <button type="button" className="link-button" onClick={() => setRows([...rows, { at: String((clean[clean.length - 1]?.at ?? 0) + 7), reward: '' }])}>
              <Icon name="plus" size={11} /> Another reward
            </button>
          </div>
        </Field>
      </div>
      <FormFoot busy={busy} words={initial ? 'Save' : 'Start tracking'} onCancel={onDone} disabled={!initial && (!who.trim() || !habit.trim())} />
    </form>
  );
}

export function RewardCard({ r, members, canEdit, onEdit }: { r: Reward; members: Member[]; canEdit: boolean; onEdit(): void }) {
  const today = todayIso();
  const colour = colourOf([r.who], members);
  const s = r.streak;
  const mark = (day: string, yes: boolean | null) => void act(() => window.nv.modules.family.mark(r.path, day, yes));
  const cycle = (day: string, now: boolean | null) => mark(day, now === true ? false : now === false ? null : true);
  return (
    <li className={`fy-reward nt-${colour}${r.earned ? ' has-earned' : ''}`}>
      <header className="fy-reward-head">
        <span className="fy-avatar is-small" aria-hidden="true">
          {initialsOf(r.who || r.title)}
        </span>
        <div className="fy-reward-words">
          <button type="button" className="fy-reward-title" onClick={() => A.openPath(r.path)} title="Open the tracker’s note">
            {r.who ? `${r.who}: ${r.habit}` : r.title}
          </button>
          <span className="fy-faint">Best run {s.best === 1 ? '1 day' : `${s.best} days`}</span>
        </div>
        {canEdit && (
          <button type="button" className="icon-button" title="Change the rewards" aria-label="Change the rewards" onClick={onEdit}>
            <Icon name="pencil" size={13} />
          </button>
        )}
      </header>
      <div className="fy-reward-body">
        <div className="fy-streak">
          <span className="fy-streak-num">{s.current}</span>
          <span className="fy-streak-words">{s.current === 1 ? 'day in a row' : 'days in a row'}</span>
          {s.next && <span className="fy-streak-next">{s.next.left === 1 ? '1 day' : `${s.next.left} days`} to the day-{s.next.at} reward</span>}
        </div>
        <div className="fy-today">
          <span className="fy-mini-head">Today</span>
          <div className="fy-yesno" role="group" aria-label={`${r.habit} today`}>
            <button type="button" className={s.today === true ? 'is-yes' : ''} aria-pressed={s.today === true} disabled={!canEdit} onClick={() => mark(today, s.today === true ? null : true)}>
              <Icon name="check" size={13} /> Yes
            </button>
            <button type="button" className={s.today === false ? 'is-no' : ''} aria-pressed={s.today === false} disabled={!canEdit} onClick={() => mark(today, s.today === false ? null : false)}>
              <Icon name="close" size={13} /> No
            </button>
          </div>
        </div>
      </div>
      <div className="fy-grid14" role="group" aria-label="The last 14 days (click a day: yes, no, not logged)">
        {s.days.map((d) => (
          <button
            key={d.day}
            type="button"
            className={`fy-cell${d.yes === true ? ' is-yes' : d.yes === false ? ' is-no' : ''}${d.day === today ? ' is-today' : ''}`}
            disabled={!canEdit}
            title={`${dayWords(d.day, today)}: ${d.yes === true ? 'yes' : d.yes === false ? 'no' : 'not logged'}${canEdit ? ' (click to change)' : ''}`}
            aria-label={`${dayWords(d.day, today)}: ${d.yes === true ? 'yes' : d.yes === false ? 'no' : 'not logged'}`}
            onClick={() => cycle(d.day, d.yes)}
          >
            <span>{dayWords(d.day, today).slice(0, 1)}</span>
          </button>
        ))}
      </div>
      {r.rewards.length > 0 && (
        <ol className="fy-ladder">
          {r.rewards.map((x) => {
            const reached = s.current >= x.at;
            const state = x.claimed ? 'claimed' : reached ? 'earned' : s.next?.at === x.at ? 'next' : 'ahead';
            return (
              <li key={x.at} className={`fy-rung is-${state}`}>
                <span className="fy-rung-day">Day {x.at}</span>
                <span className="fy-rung-reward">{x.reward}</span>
                {state === 'claimed' && (
                  <span className="fy-rung-state">
                    <Icon name="check" size={11} /> Given
                  </span>
                )}
                {state === 'earned' &&
                  (canEdit ? (
                    <button type="button" className="button small primary" onClick={() => void act(() => window.nv.modules.family.claim(r.path, x.at), `Marked “${x.reward}” as given.`)}>
                      Give reward
                    </button>
                  ) : (
                    <span className="fy-rung-state">Earned</span>
                  ))}
                {state === 'next' && <span className="fy-rung-state">Next</span>}
              </li>
            );
          })}
        </ol>
      )}
    </li>
  );
}

function RewardsPart({ state, canEdit }: { state: FamilyState; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <div className="fy-part">
      <div className="fy-toolbar">
        <span className="fy-faint">A yes or no each day; rewards at the days you choose. Each tracker is a log note in {state.folder}/Rewards.</span>
        <span className="fy-grow" />
        {canEdit && editing !== 'new' && (
          <button type="button" className="button primary small" onClick={() => setEditing('new')}>
            <Icon name="plus" size={13} /> New reward tracker
          </button>
        )}
      </div>
      {editing === 'new' && (
        <div className="fy-editor">
          <RewardForm members={state.members} onDone={() => setEditing(null)} />
        </div>
      )}
      {!state.rewards.length && editing !== 'new' && <EmptyState size="panel" icon="star" title="No reward trackers yet" line="Pick something done each day (reading, a tidy room) and the rewards at 7, 14 and 30 days in a row." action={canEdit ? { label: 'New reward tracker', icon: 'plus', run: () => setEditing('new') } : undefined} />}
      <ul className="fy-rewards">
        {state.rewards.map((r) =>
          editing === r.path ? (
            <li key={r.path} className="fy-reward is-editing">
              <RewardForm members={state.members} initial={r} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <RewardCard key={r.path} r={r} members={state.members} canEdit={canEdit} onEdit={() => setEditing(r.path)} />
          ),
        )}
      </ul>
    </div>
  );
}

// ── Documents ────────────────────────────────────────────────────────────────────────────────────────────────────────

function DocumentsPart({ state }: { state: FamilyState }) {
  const total = state.members.reduce((n, m) => n + (state.documents[m.path]?.length ?? 0), 0);
  return (
    <div className="fy-part">
      <p className="fy-hint is-top">
        Each person’s documents: files in {state.folder}/Files/&lt;their name&gt;/, links on their card, and Papers records that name them.
        <button type="button" className="link-button" onClick={() => A.revealInExplorer(`${state.folder}/Files`)}>
          Show the folder
        </button>
      </p>
      {!state.members.length && <EmptyState size="panel" icon="file" title="No one in the family yet" line="Add the people first: their documents gather on their cards." />}
      {total === 0 && state.members.length > 0 && <p className="fy-faint">No documents yet.</p>}
      <div className="fy-doc-groups">
        {state.members.map((m) => (
          <section key={m.path} className={`fy-doc-group nt-${m.colour}`}>
            <h3>
              <span className="fy-dot" aria-hidden="true" />
              {m.name}
              <span className="fy-count">{state.documents[m.path]?.length ?? 0}</span>
            </h3>
            {state.documents[m.path]?.length ? <DocList docs={state.documents[m.path]} /> : <span className="fy-faint">Drop files into {state.folder}/Files/{m.name}/ or link them on {m.name}’s card.</span>}
          </section>
        ))}
      </div>
    </div>
  );
}

// ── Albums ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function AlbumsPart({ state, canEdit }: { state: FamilyState; canEdit: boolean }) {
  // Every album now, not only the family's (packs uplift item 5): Memories' albums live here, with the old
  // folders' move kept beside them.
  const { data: m } = useWork<MemoriesView>('memories');
  const [kind, setKind] = useState('all');
  const albums = useMemo(() => (m?.albums ?? []).filter((a) => kind === 'all' || a.kind === kind), [m, kind]);
  const kinds = useMemo(() => [...new Set((m?.albums ?? []).map((a) => a.kind).filter(Boolean))], [m]);
  const records = useMemo(() => (m ? memoryRecords(m) : []), [m]);
  const views = useMemo(() => memorySectionViews('albums'), []);
  const ctx = useWorkCtx('memories', records, { editable: (r) => MEMORY_EDITABLE[r.kind] ?? [], open: (r) => { if (r.path) openAlbum(r.path); } });
  return (
    <div className="fy-part">
      <div className="fy-protected">
        <Icon name="lock" size={14} />
        <span>{state.photos === 'never' ? 'Family-private: family photos are never given to any agent (Settings › Privacy and secrets).' : 'Family-private: agents never see these unless you allow each use.'}</span>
        <button type="button" className="link-button" onClick={() => openModal({ kind: 'settings', section: 'privacy' })}>
          Privacy and secrets
        </button>
      </div>
      <div className="fy-toolbar">
        <span className="fy-faint">{!m ? 'Reading your albums…' : albums.length === 1 ? '1 album' : `${albums.length} albums`}</span>
        <span className="fy-grow" />
        {canEdit && (
          <button type="button" className="button primary small" onClick={() => newAlbum(m ?? null)}>
            <Icon name="plus" size={13} /> New album
          </button>
        )}
      </div>
      {state.legacy.length > 0 && (
        <div className="fy-protected">
          <Icon name="image" size={14} />
          <span>{state.legacy.length === 1 ? '1 album is' : `${state.legacy.length} albums are`} still only in Family’s old album folders. Move them into Family’s albums and they show here too. The old folders stay where they are, so nothing is lost.</span>
          {canEdit && (
            <button type="button" className="button small" onClick={() => void act(() => window.nv.modules.family.migrateAlbums())}>
              Move into Family’s albums
            </button>
          )}
        </div>
      )}
      {kinds.length > 1 && (
        <div className="chips" role="group" aria-label="Only this kind">
          {['all', ...kinds].map((k) => (
            <button key={k} type="button" className={`chip${kind === k ? ' on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === 'all' ? 'Every kind' : k}
            </button>
          ))}
        </div>
      )}
      {m && !m.albums.length ? (
        <EmptyState size="panel" icon="image" title="No albums yet" line="Albums live in Family, kept Family-private." action={canEdit ? { label: 'New album', icon: 'plus', run: () => newAlbum(m) } : undefined} />
      ) : (
        <>
          <div className="lr-albums">
            {albums.map((a) => (
              <AlbumCard key={a.path} a={a} />
            ))}
          </div>
          {albums.some((a) => a.date) && (
            <WithRecords ctx={ctx}>
              <WorkViews module="memories" section="albums" made={views} records={records} />
            </WithRecords>
          )}
        </>
      )}
    </div>
  );
}

function PeoplePart() {
  const { data: m } = useWork<MemoriesView>('memories');
  if (!m) return <p className="fy-faint">Reading your albums…</p>;
  if (!m.people.length) return <EmptyState size="panel" icon="people" title="No one is named yet" line="Name the people in a photo and they gather here, with every photo of them." />;
  return (
    <div className="lr-persons">
      {m.people.map((p) => (
        <PersonCard key={p.name} name={p.name} photos={p.photos} albums={new Set(p.photos.map((x) => x.album)).size} />
      ))}
    </div>
  );
}

function CreativePart({ canEdit }: { canEdit: boolean }) {
  const { data: m } = useWork<MemoriesView>('memories');
  const records = useMemo(() => (m ? memoryRecords(m) : []), [m]);
  const views = useMemo(() => memorySectionViews('creative'), []);
  const ctx = useWorkCtx('memories', records, { editable: (r) => MEMORY_EDITABLE[r.kind] ?? [], open: (r) => { if (r.path) openCreative(r.path); } });
  if (!m) return <p className="fy-faint">Reading your albums…</p>;
  return (
    <>
      {m.creative.length > 0 && <NeedsYou cards={memoriesNeeds(m.creative, m.today)} today={m.today} canEdit={canEdit} onAction={(c) => c.ref && openCreative(c.ref)} />}
      {m.creative.length > 0 && (
        <WithRecords ctx={ctx}>
          <WorkViews module="memories" section="creative" made={views} records={records} />
        </WithRecords>
      )}
      {!m.creative.length && (
        <EmptyState
          size="panel" icon="canvas" title="Nothing being made" line="A poster, a card or a video for an occasion: its brief says what it is for, and every version is kept."
          action={canEdit ? { label: 'Start a project', icon: 'plus', run: () => newCreative(m) } : undefined}
        />
      )}
    </>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function FamilyClassic({ tab }: { tab: W.TabState }) {
  const { state, failed } = useFamily();
  const canEdit = useApp((s) => s.canEdit);
  const switches = {
    calendar: usePartOn('family', 'calendar'),
    milestones: usePartOn('family', 'milestones'),
    rewards: usePartOn('family', 'rewards'),
    documents: usePartOn('family', 'documents'),
    albums: usePartOn('family', 'albums'),
    people: usePartOn('family', 'people'),
    creative: usePartOn('family', 'creative'),
  };
  const shown = PARTS.filter((p) => SWITCH[p.id] === null || switches[SWITCH[p.id] as keyof typeof switches]);
  const asked = partOfTab(tab) as Part | undefined;
  const part: Part = shown.some((p) => p.id === asked) ? asked! : (shown[0]?.id ?? 'members');
  const [adding, setAdding] = useState(false);
  const go = (p: Part) => openModule('family', p);
  return (
    <div className="fy-shell">
      <div className="pv-page list fy-page">
        <div className="pv-inner fy-inner">
          {/* One page header for every module page (8.0 section D): PageHead, no icon-tile header. */}
          <PageHead
            icon="people"
            title="Family"
            lead={<>Family-private · kept as notes in {state?.folder ?? 'Family'} · agents read it only if you allow{moduleInfo('family') && <ModuleTour module={moduleInfo('family')!} />}</>}
            actions={
              <button
                type="button"
                className="icon-button"
                title="More"
                aria-label="More for Family"
                onClick={(e) =>
                  openMenu(e.currentTarget, [
                    { label: 'Open the family calendar note', icon: 'calendar', disabled: !state, run: () => state && A.openPath(state.calendarPath) },
                    { label: 'Who reads Family-private…', icon: 'lock', run: () => openModal({ kind: 'settings', section: 'privacy' }) },
                    { label: 'Family’s parts (Settings › Packs)…', icon: 'settings', run: () => A.openSettings('packs', 'current', 'Family') },
                  ])
                }
              >
                <Icon name="more" size={16} />
              </button>
            }
          />
          <div className="segmented sx-parts fy-parts" role="tablist" aria-label="Family’s parts">
            {shown.map((p) => (
              <button key={p.id} role="tab" aria-selected={part === p.id} className={part === p.id ? 'active' : ''} onClick={() => go(p.id)}>
                {p.label}
                {p.id === 'members' && state ? <em>{state.members.length}</em> : null}
                {p.id === 'rewards' && state?.rewards.some((r) => r.earned) ? <em className="fy-earned-dot" aria-label="a reward is earned">•</em> : null}
              </button>
            ))}
          </div>
          {failed && !state && <EmptyState size="panel" icon="warning" title="Family couldn’t be read" line={failed} />}
          {!state && !failed && <p className="fy-faint fy-loading">Reading your family’s notes…</p>}
          {state && !state.members.length && part !== 'members' && !adding && (
            <div className="fy-welcome">
              <span className="fy-mark is-big" aria-hidden="true">
                <Icon name="people" size={22} />
              </span>
              <div>
                <h2>Start with the people</h2>
                <p>Add each person once: their card holds their details and documents, and their colour marks them on the calendar, milestones and rewards. Cards are Family-private notes in {state.folder}/People.</p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    go('members');
                    setAdding(true);
                  }}
                >
                  <Icon name="plus" size={14} /> Add someone
                </button>
              )}
            </div>
          )}
          {state && part === 'members' && !state.members.length && !adding && (
            <EmptyState icon="people" title="Start with the people" line={`Each person’s card is a Family-private note in ${state.folder}/People, with their details, colour and documents.`} action={canEdit ? { label: 'Add someone', icon: 'plus', run: () => setAdding(true) } : undefined} />
          )}
          {state && part === 'calendar' && <CalendarPart state={state} canEdit={canEdit} />}
          {state && part === 'members' && (state.members.length > 0 || adding) && <MembersPart state={state} canEdit={canEdit} adding={adding} setAdding={setAdding} />}
          {state && part === 'milestones' && <MilestonesPart state={state} canEdit={canEdit} />}
          {state && part === 'rewards' && <RewardsPart state={state} canEdit={canEdit} />}
          {state && part === 'documents' && <DocumentsPart state={state} />}
          {state && part === 'albums' && <AlbumsPart state={state} canEdit={canEdit} />}
          {state && part === 'people' && <PeoplePart />}
          {state && part === 'creative' && <CreativePart canEdit={canEdit} />}
        </div>
      </div>
    </div>
  );
}

/** Words for Today's rows, shared with FamilyToday. */
export const happeningLine = (h: Happening) => `${h.time ? `${timeWords(h.time)} · ` : ''}${h.what}${h.who.length ? ` · ${h.who.join(', ')}` : ''}${h.where ? ` · ${h.where}` : ''}`;
export { whenWords };
export type { CalendarSection };

// ── The 8.7 page (30 Oct 2026): the new overview, a person's page, or the previous layout ───────────────────────────

export function FamilyPage({ tab }: { tab: W.TabState }) {
  const place = familyPlace(tab);
  if (place === 'member') { const path = memberPathOf(tab); if (path) return <MemberDetail path={path} />; }
  if (place === 'album') { const d = familyDetailOf(tab); if (d) return <AlbumDetail path={d.key} />; }
  if (place === 'person') { const d = familyDetailOf(tab); if (d) return <PersonDetail name={d.key} />; }
  if (place === 'creative') { const d = familyDetailOf(tab); if (d) return <CreativeDetail path={d.key} />; }
  if (place === 'rest') return <FamilyClassic tab={tab} />;
  if (place === 'classic') return <FamilyClassic tab={{ ...tab, path: `module:family#${(partOfTab(tab) ?? '').startsWith('classic:') ? (partOfTab(tab) ?? '').slice(8) : 'calendar'}` }} />;
  return <FamilyOverview tab={tab} />;
}
