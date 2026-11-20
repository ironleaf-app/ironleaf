// Travel's page (Wave 7 part a; src/shared/travel.ts, src/main/personal/travel.ts). Made of the work modules' shared
// blocks: an Overview with the next trip (or the one you are on) day by day, what is coming up and each trip's spending
// against its budget; Trips, Timeline, Itinerary, Expenses and Forecast as record views anyone can change; and each
// trip's own page ("trip:<path>"): its itinerary day by day (or as a table changed cell by cell), its expenses, its budget
// against the forecast, its details, and its documents with a passport check. Everything shown changes where it is.

import { useMemo, useState } from 'react';
import { partOn } from '../../../../../shared/life-modules';
import { BOOKING_KINDS, EXPENSE_CATEGORIES, TRAVEL, TRIP_PURPOSES, TRIP_STATUSES } from '../../../../../shared/personal-modules';
import { monthWords } from '../../../../../shared/personal-records';
import { bookingWords, travelRecords, travelSectionViews, TRAVEL_EDITABLE, tripDates, tripWhen as tripWhenFull, untilWords, type Booking, type TravelModel, type Trip } from '../../../../../shared/travel';

/** "Leaving in 4 days" without the day again (the trip's dates are always shown beside it). */
const tripWhen = (x: Trip, today: string) => tripWhenFull(x, today).replace(/ \(.*\)$/, '');
import type { WsRecord } from '../../../../../shared/workspace-records';
import { EmptyState } from '../../../components/EmptyState';
import { Icon, type IconName } from '../../../components/Icon';
import { openMenu, type MenuItem } from '../../../components/Menu';
import { fileUrl } from '../../../lib/resolve';
import * as A from '../../../state/actions';
import { openModule, partOfTab, useModules } from '../../../state/modules';
import { TravelOverview, TripDetail, travelPlace, tripPathOf } from '../w3b/Travel87';
import { peek } from '../../../state/peek';
import { useApp } from '../../../state/store';
import { useWork, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { openRecordForm, valueWords } from '../RecordForm';
import { Card, dayText, openDetail, Pill, placeOf, Tile, useWorkCtx, WithRecords, WorkShell, WorkViews } from '../work/WorkShell';
import { travelNeeds } from '../../../../../shared/module-purpose';
import { NeedsYou } from '../NeedsYou';
import { caller, EditTable, Fact, FilesList, Inline, keepFiles, Meter, money, MonthBars, plural } from './PersonalParts';

export type TravelView = TravelModel & { folder: string; currency: string; people: string[]; projects: { path: string; name: string }[] };

const MOD = 'travel';
const call = caller(MOD);
export const openTrip = (rel: string) => openDetail(MOD, 'trip', rel);
const BOOKING_ICON: Record<string, IconName> = { Flight: 'plane', Hotel: 'home', 'Car hire': 'car', Train: 'forward', Bus: 'forward', Ferry: 'forward', Transfer: 'car', Activity: 'star', Meeting: 'people', Meal: 'sun', Other: 'pin' };
const phaseTone = (x: Trip) => (x.phase === 'Away' ? 'next' : x.phase === 'Upcoming' ? 'ok' : 'none');

// ── Doing things ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function save(kind: string, rel: string, field: string, value: string, row?: { row: number; title: string }): Promise<boolean> {
  return (await workDid(call<string | null>('set-field', { kind, path: rel, field, value, ...(row ? { ref: { row: row.row }, title: row.title } : {}) }).then((said) => ({ said })), (x) => x.said ?? '')) !== null;
}

export function newTrip(m: TravelView | null): void {
  openRecordForm({
    title: 'New trip',
    icon: 'plane',
    line: 'Its flights, hotels and plans, its documents and what it costs go with it.',
    ok: 'Add the trip',
    fields: [
      { key: 'destination', label: 'Destination', kind: 'text', required: true, wide: true, placeholder: 'Harbour City' },
      { key: 'starts', label: 'Leaving', kind: 'date' },
      { key: 'ends', label: 'Back', kind: 'date' },
      { key: 'purpose', label: 'Purpose', kind: 'segment', options: [...TRIP_PURPOSES], value: 'Personal' },
      { key: 'budget', label: 'Budget', kind: 'money' },
      { key: 'status', label: 'Status', kind: 'choice', options: [...TRIP_STATUSES], value: 'Planning' },
      { key: 'project', label: 'Project', kind: 'choice', options: ['', ...(m?.projects.map((p) => p.name) ?? [])], show: (v) => v.purpose === 'Work', hint: 'The work this trip is for.' },
      { key: 'name', label: 'Name (optional)', kind: 'text', hint: 'The destination and month when left empty.' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-trip', Object.fromEntries(['destination', 'starts', 'ends', 'purpose', 'budget', 'status', 'project', 'name'].map((k) => [k, valueWords(v, k)])));
      await workDid(Promise.resolve(rel), `Added ${A.titleOf(rel)}.`, { label: 'Open', run: () => openTrip(rel) });
    },
  });
}

export function newBooking(x: Trip, kind = 'Flight'): void {
  openRecordForm({
    title: `Add to ${x.name}`,
    icon: 'calendar',
    line: 'A flight, hotel, car or plan. Each shows on its day; a flight or check-in comes to Today on the day.',
    ok: 'Add it',
    fields: [
      { key: 'kind', label: 'Kind', kind: 'choice', options: [...BOOKING_KINDS], value: kind },
      { key: 'what', label: 'What', kind: 'text', required: true, wide: true, placeholder: 'QF 412 Harbour City to Bayport, or the hotel’s name' },
      { key: 'date', label: 'Day', kind: 'date', value: x.starts ?? '' },
      { key: 'time', label: 'Time', kind: 'text', placeholder: '07:05' },
      { key: 'until', label: 'Until', kind: 'text', placeholder: 'Arrives 08:35, or check-out Sun' },
      { key: 'where', label: 'Where', kind: 'text', placeholder: 'Terminal 3, or the address' },
      { key: 'booking', label: 'Booking reference', kind: 'text' },
      { key: 'cost', label: 'Cost', kind: 'money' },
      { key: 'paid', label: 'Paid', kind: 'segment', options: ['Yes', 'Not yet'], value: 'Yes' },
    ],
    submit: async (v) => {
      await workDid(call<string>('add-booking', x.path, { ...Object.fromEntries(['kind', 'what', 'date', 'time', 'until', 'where', 'booking', 'cost'].map((k) => [k, valueWords(v, k)])), paid: valueWords(v, 'paid') === 'Yes' }));
    },
  });
}

export function newExpense(x: Trip, today: string): void {
  openRecordForm({
    title: `Spent on ${x.name}`,
    icon: 'receipt',
    ok: 'Add it',
    fields: [
      { key: 'what', label: 'What', kind: 'text', required: true, wide: true, placeholder: 'Taxi to the hotel' },
      { key: 'amount', label: 'Amount', kind: 'money', required: true },
      { key: 'category', label: 'Category', kind: 'choice', options: [...EXPENSE_CATEGORIES], value: 'Food' },
      { key: 'date', label: 'Day', kind: 'date', value: x.phase === 'Away' ? today : (x.starts ?? today) },
      { key: 'paid_by', label: 'Paid by', kind: 'text', placeholder: 'Card, cash, a person' },
    ],
    submit: async (v) => {
      await workDid(call<string>('add-expense', x.path, Object.fromEntries(['what', 'amount', 'category', 'date', 'paid_by'].map((k) => [k, valueWords(v, k)]))));
    },
  });
}

export function travelOptions(m: TravelView): void {
  openRecordForm({
    title: 'Trips options',
    icon: 'settings',
    ok: 'Save',
    fields: [
      { key: 'remind', label: 'Say a trip is coming up this many days ahead', kind: 'number', value: String(m.remindDays), hint: 'On Today and the Overview. 7 unless you change it.' },
      { key: 'currency', label: 'Currency', kind: 'text', value: m.currency, hint: 'Three letters, like AUD. Money’s unless set here.' },
    ],
    submit: async (v) => {
      await workDid(call('options', { remindDays: Math.max(0, Math.min(365, Math.round(Number(valueWords(v, 'remind')) || 0))), currency: valueWords(v, 'currency').toUpperCase() }), 'Saved the Trips options.');
    },
  });
}

export function tripMenu(x: Trip, m: TravelView, canEdit: boolean): MenuItem[] {
  return [
    { label: 'Open', icon: 'eye', run: () => openTrip(x.path) },
    { separator: true },
    { label: 'Add a flight…', icon: 'plane', disabled: !canEdit, run: () => newBooking(x, 'Flight') },
    { label: 'Add a hotel…', icon: 'home', disabled: !canEdit, run: () => newBooking(x, 'Hotel') },
    { label: 'Add a plan…', icon: 'calendar', disabled: !canEdit, run: () => newBooking(x, 'Activity') },
    { label: 'Add an expense…', icon: 'receipt', disabled: !canEdit, run: () => newExpense(x, m.today) },
    { label: 'Keep a document with it…', icon: 'paperclip', disabled: !canEdit, run: () => void keepFiles(MOD, x.path, x.name, 'documents') },
    { separator: true },
    { label: x.status === 'Cancelled' ? 'Not cancelled after all' : 'Cancel the trip', icon: 'close', disabled: !canEdit, run: () => void save('trip', x.path, 'status', x.status === 'Cancelled' ? 'Planning' : 'Cancelled') },
    { label: 'Open its note', icon: 'notes', run: () => A.openPath(x.path, { where: 'tab' }) },
  ];
}

// ── Parts ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function BookingLine({ b, cur, today }: { b: Booking; cur: string; today: string }) {
  return (
    <li className="pm-booking">
      <span className="pm-booking-time">{b.time || ''}</span>
      <span className="pm-booking-icon" aria-hidden="true">
        <Icon name={BOOKING_ICON[b.kind] ?? 'pin'} size={13} />
      </span>
      <span className="pm-booking-words">
        <span className="pm-booking-what">{b.what || b.kind}</span>
        <span className="pm-faint">{[b.kind !== 'Other' && !(b.what || '').toLowerCase().startsWith(b.kind.toLowerCase()) ? b.kind : '', b.until && `until ${untilWords(b.until, today)}`, b.where, b.booking && `ref ${b.booking}`].filter(Boolean).join(' · ')}</span>
      </span>
      {b.cost !== null && (
        <span className="pm-booking-cost">
          {money(b.cost, cur)}
          {!b.paid && <span className="pm-faint"> not paid</span>}
        </span>
      )}
    </li>
  );
}

function DayByDay({ x, cur, today, limit }: { x: Trip; cur: string; today: string; limit?: number }) {
  const days = limit ? x.days.slice(0, limit) : x.days;
  if (!days.length) return <p className="rm-none">No flights, hotels or plans yet.</p>;
  return (
    <ol className="pm-days">
      {days.map((d) => (
        <li key={d.date ?? 'none'} className={`pm-day${d.date === today ? ' is-today' : d.date && d.date < today ? ' is-past' : ''}`}>
          <div className="pm-day-head">
            <span className="pm-day-name">{d.date ? dayText(d.date) : 'No day yet'}</span>
            {d.date && x.starts && <span className="pm-faint">Day {Math.round((new Date(`${d.date}T12:00:00`).getTime() - new Date(`${x.starts}T12:00:00`).getTime()) / 86_400_000) + 1}</span>}
            {d.date === today && <Pill tone="next">Today</Pill>}
          </div>
          <ul className="pm-bookings">
            {d.items.map((b) => (
              <BookingLine key={b.row} b={b} cur={cur} today={today} />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function Budget({ x, cur, canEdit, big }: { x: Trip; cur: string; canEdit: boolean; big?: boolean }) {
  return (
    <div className={`pm-budget${big ? ' is-big' : ''}`}>
      <div className="pm-budget-top">
        <span>
          <strong>{money(x.forecast, cur, false)}</strong> forecast
        </span>
        <span className="pm-budget-of">
          of{' '}
          <Inline value={x.budget !== null ? String(x.budget) : ''} shown={x.budget !== null ? money(x.budget, cur, false) : undefined} label="Budget" kind="number" placeholder="set a budget" canEdit={canEdit} onSave={(v) => save('trip', x.path, 'budget', v)} />
        </span>
      </div>
      <Meter value={x.forecast} of={x.budget} label={`${x.name}’s forecast against its budget`} />
      <div className="pm-budget-parts">
        <span>Bookings {money(x.booked, cur, false)}</span>
        <span>Spending {money(x.spent, cur, false)}</span>
        {x.left !== null && <span className={x.left < 0 ? 'is-over' : ''}>{x.left < 0 ? `${money(-x.left, cur, false)} over` : `${money(x.left, cur, false)} left`}</span>}
      </div>
    </div>
  );
}

function TripCard({ x, m }: { x: Trip; m: TravelView }) {
  const photo = x.photos[0];
  return (
    <li className={`pm-card${x.phase === 'Cancelled' ? ' is-gone' : ''}`}>
      <button type="button" className="pm-card-main" onClick={() => openTrip(x.path)}>
        <span className="pm-card-pic" aria-hidden="true">
          {photo ? <img src={fileUrl(photo)} alt="" loading="lazy" /> : <Icon name="plane" size={20} />}
        </span>
        <span className="pm-card-words">
          <span className="pm-card-name">{x.name}</span>
          <span className="pm-card-sub">{[tripDates(x, m.today) || 'No dates yet', x.nights ? plural(x.nights, 'night') : ''].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
      <div className="pm-card-stats">
        <Pill tone={phaseTone(x)}>{x.phase === 'Upcoming' ? tripWhen(x, m.today) : x.phase}</Pill>
        {x.purpose !== 'Personal' && <Pill tone="none">{x.purpose}</Pill>}
        <span className="pm-card-gap" />
        <span className={x.left !== null && x.left < 0 ? 'pm-over' : 'pm-faint'}>
          {money(x.forecast, m.currency, false)}
          {x.budget !== null ? ` of ${money(x.budget, m.currency, false)}` : ''}
        </span>
      </div>
      {x.budget !== null && (
        <div className="pm-card-meter">
          <Meter value={x.forecast} of={x.budget} label={`${x.name}’s budget`} />
        </div>
      )}
    </li>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function Overview({ m, canEdit }: { m: TravelView; canEdit: boolean }) {
  const modules = useModules();
  const forecastOn = partOn(modules, MOD, 'forecast');
  const hero = m.away[0] ?? m.upcoming.find((x) => x.starts) ?? m.upcoming[0];
  const others = [...m.away, ...m.upcoming].filter((x) => x !== hero);
  const q = m.months.slice(0, 3).reduce((a, x) => a + x.forecast, 0);
  return (
    <div className="rm-overview">
      <NeedsYou cards={travelNeeds([...m.away, ...m.upcoming], m.today)} today={m.today} canEdit={canEdit} onAction={(c) => { if (c.ref) openTrip(c.ref); }} />
      <div className="rm-tiles">
        <Tile icon="plane" label="Trips coming up" value={String(m.upcoming.length + m.away.length)} sub={m.away.length ? `Away now: ${m.away[0].name}` : m.upcoming[0]?.starts ? `Next ${dayText(m.upcoming[0].starts)}` : 'None planned'} onClick={() => openModule(MOD, 'trips')} />
        {hero?.daysTo !== null && hero?.phase === 'Upcoming' && <Tile icon="clock" label="Next trip" value={hero.daysTo === 0 ? 'Today' : hero.daysTo === 1 ? 'Tomorrow' : `${hero.daysTo} days`} sub={hero.name} tone={hero.daysTo! <= m.remindDays ? 'warn' : undefined} onClick={() => openTrip(hero.path)} />}
        {forecastOn && <Tile icon="chart" label="Next 3 months" value={money(q, m.currency, false)} sub="Forecast for trips starting then" onClick={() => openModule(MOD, 'forecast')} />}
        {forecastOn && <Tile icon="receipt" label="Spent this year" value={money(m.thisYear, m.currency, false)} sub={`On trips in ${m.today.slice(0, 4)}`} onClick={() => openModule(MOD, 'expenses')} />}
      </div>
      {hero ? (
        <Card
          id="hero"
          className="pm-hero"
          title={hero.phase === 'Away' ? `Away now: ${hero.name}` : `Next: ${hero.name}`}
          link={{ label: 'Open the trip', run: () => openTrip(hero.path) }}
          actions={
            <button type="button" className="icon-button small" aria-label={`More for ${hero.name}`} onClick={(e) => openMenu(e.currentTarget, tripMenu(hero, m, canEdit))}>
              <Icon name="more" size={13} />
            </button>
          }
        >
          <div className="pm-hero-body">
            <div className="pm-hero-days">
              <p className="pm-hero-when">
                {[tripDates(hero, m.today), tripWhen(hero, m.today), hero.purpose].filter(Boolean).join(' · ')}
              </p>
              <DayByDay x={hero} cur={m.currency} today={m.today} limit={3} />
              {hero.days.length > 3 && (
                <button type="button" className="text-button" onClick={() => openTrip(hero.path)}>
                  {plural(hero.days.length - 3, 'more day')} <Icon name="chevron" size={11} />
                </button>
              )}
            </div>
            <div className="pm-hero-side">
              <Budget x={hero} cur={m.currency} canEdit={canEdit} />
              {hero.passports.map((p) => (
                <p key={p.path} className={`pm-check${p.ok ? ' is-ok' : ' is-warn'}`}>
                  <Icon name={p.ok ? 'check' : 'warning'} size={12} /> {p.words}
                </p>
              ))}
              {hero.files.length > 0 && <p className="pm-faint">{plural(hero.files.length, 'document')} kept with it</p>}
            </div>
          </div>
        </Card>
      ) : (
        <EmptyState size="panel" icon="plane" title="No trips coming up" line="Add the next one to keep its flights, hotels and documents together." action={{ label: 'New trip', icon: 'plus', run: () => newTrip(m), disabled: !canEdit }} />
      )}
      <div className="rm-cols">
        <Card id="coming" title="Also coming up" count={others.length} link={{ label: 'Trips', run: () => openModule(MOD, 'trips') }}>
          {others.length ? (
            <ul className="pm-cards is-list">
              {others.map((x) => (
                <TripCard key={x.path} x={x} m={m} />
              ))}
            </ul>
          ) : (
            <p className="rm-none">Nothing else planned yet.</p>
          )}
        </Card>
        {forecastOn && (
          <Card id="forecast" title="Forecast by month" link={{ label: 'Forecast', run: () => openModule(MOD, 'forecast') }}>
            {m.months.some((x) => x.forecast) ? (
              <>
                <MonthBars months={m.months.map((x) => ({ month: x.month, value: x.forecast }))} cur={m.currency} label="Travel forecast, the next twelve months" />
                <ul className="pm-months">
                  {m.months
                    .filter((x) => x.forecast)
                    .slice(0, 4)
                    .map((x) => (
                      <li key={x.month}>
                        <span>{monthWords(x.month)}</span>
                        <span className="pm-faint">{x.trips.join(', ')}</span>
                        <strong>{money(x.forecast, m.currency, false)}</strong>
                      </li>
                    ))}
                </ul>
              </>
            ) : (
              <p className="rm-none">Give your trips bookings or a budget to see what travel will cost, month by month.</p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

// ── A trip's page ────────────────────────────────────────────────────────────────────────────────────────────────────

function TripPage({ x, m, canEdit }: { x: Trip; m: TravelView; canEdit: boolean }) {
  const [mode, setMode] = useState<'days' | 'table'>('days');
  const prop = (field: string) => (v: string) => save('trip', x.path, field, v);
  const expenses = [...x.expenses].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const bookings = [...x.bookings].sort((a, b) => (a.date ?? '9').localeCompare(b.date ?? '9') || (a.time || '99').localeCompare(b.time || '99'));
  return (
    <div className="pm-reg">
      <div className="pm-reg-main">
        <Card
          id="itinerary"
          title="Itinerary"
          count={x.bookings.length}
          actions={
            <>
              {x.bookings.length > 0 && (
                <span className="pm-seg" role="group" aria-label="Show the itinerary">
                  <button type="button" aria-pressed={mode === 'days'} className={mode === 'days' ? 'is-on' : ''} onClick={() => setMode('days')}>
                    Day by day
                  </button>
                  <button type="button" aria-pressed={mode === 'table'} className={mode === 'table' ? 'is-on' : ''} onClick={() => setMode('table')}>
                    Table
                  </button>
                </span>
              )}
              {canEdit && (
                <button type="button" className="text-button" onClick={(e) => openMenu(e.currentTarget, BOOKING_KINDS.slice(0, 8).map((k) => ({ label: k === 'Activity' ? 'A plan or activity' : k === 'Meeting' ? 'A meeting' : k === 'Meal' ? 'A meal' : `A ${k.toLowerCase()}`, icon: BOOKING_ICON[k] ?? 'pin', run: () => newBooking(x, k) })))}>
                  <Icon name="plus" size={12} /> Add <Icon name="chevronDown" size={10} />
                </button>
              )}
            </>
          }
        >
          {mode === 'days' || !x.bookings.length ? (
            <DayByDay x={x} cur={m.currency} today={m.today} />
          ) : (
            <EditTable
              label={`${x.name}’s itinerary`}
              rows={bookings.map((b) => ({ row: b.row, values: { date: b.date ?? b.dateWords, time: b.time, booking_kind: b.kind, title: b.what, until: b.until, place: b.where, reference: b.booking, cost: b.cost !== null ? String(b.cost) : '', is_paid: b.paid ? 'Yes' : 'No' } }))}
              cols={[
                { key: 'date', label: 'Day', kind: 'date' },
                { key: 'time', label: 'Time', kind: 'time' },
                { key: 'booking_kind', label: 'Kind', kind: 'choice', options: [...BOOKING_KINDS] },
                { key: 'title', label: 'What', kind: 'text', strong: true },
                { key: 'until', label: 'Until', kind: 'text' },
                { key: 'place', label: 'Where', kind: 'text' },
                { key: 'reference', label: 'Booking', kind: 'text' },
                { key: 'cost', label: 'Cost', kind: 'money', num: true, shown: (v) => (v ? money(Number(v), m.currency) : '') },
                { key: 'is_paid', label: 'Paid', kind: 'choice', options: ['Yes', 'No'] },
              ]}
              title="title"
              canEdit={canEdit}
              onSave={(row, title, field, value) => save('booking', x.path, field, value, { row, title })}
              onRemove={(row, title) => void workDid(call<string>('remove-row', x.path, 'itinerary', row, title))}
            />
          )}
        </Card>
        <Card
          id="expenses"
          title="Expenses"
          count={x.expenses.length}
          actions={
            canEdit ? (
              <button type="button" className="text-button" onClick={() => newExpense(x, m.today)}>
                <Icon name="plus" size={12} /> Add an expense
              </button>
            ) : undefined
          }
        >
          {expenses.length ? (
            <EditTable
              label={`${x.name}’s expenses`}
              rows={expenses.map((e) => ({ row: e.row, values: { date: e.date ?? '', title: e.what, category: e.category, amount: e.amount !== null ? String(e.amount) : '', paid_by: e.paidBy } }))}
              cols={[
                { key: 'date', label: 'Day', kind: 'date' },
                { key: 'title', label: 'What', kind: 'text', strong: true },
                { key: 'category', label: 'Category', kind: 'choice', options: [...EXPENSE_CATEGORIES] },
                { key: 'amount', label: 'Amount', kind: 'money', num: true, shown: (v) => (v ? money(Number(v), m.currency) : '') },
                { key: 'paid_by', label: 'Paid by', kind: 'text' },
              ]}
              title="title"
              canEdit={canEdit}
              onSave={(row, title, field, value) => save('expense', x.path, field, value, { row, title })}
              onRemove={(row, title) => void workDid(call<string>('remove-row', x.path, 'expenses', row, title))}
            />
          ) : (
            <p className="rm-none">What you spend there (meals, taxis, tickets) adds to the trip’s forecast against its budget.</p>
          )}
        </Card>
      </div>
      <aside className="pm-reg-side">
        <Card id="budget" title="Budget">
          <Budget x={x} cur={m.currency} canEdit={canEdit} big />
        </Card>
        <Card id="details" title="Details">
          <div className="pm-facts">
            <Fact label="Destination">
              <Inline value={x.destination} label="Destination" canEdit={canEdit} onSave={prop('destination')} />
            </Fact>
            <Fact label="Leaving">
              <Inline value={x.starts ?? ''} shown={x.starts ? dayText(x.starts) : undefined} label="Leaving" kind="date" canEdit={canEdit} onSave={prop('starts')} />
            </Fact>
            <Fact label="Back">
              <Inline value={x.ends ?? ''} shown={x.ends ? dayText(x.ends) : undefined} label="Back" kind="date" canEdit={canEdit} onSave={prop('ends')} />
            </Fact>
            <Fact label="Purpose">
              <Inline value={x.purpose} label="Purpose" kind="choice" options={[...TRIP_PURPOSES]} canEdit={canEdit} onSave={prop('purpose')} />
            </Fact>
            <Fact label="Status">
              <Inline value={x.status} label="Status" kind="choice" options={[...TRIP_STATUSES]} canEdit={canEdit} onSave={prop('status')} />
            </Fact>
            <Fact label="Travellers">
              <Inline value={x.travellers.join(', ')} label="Travellers" placeholder="Who is going" canEdit={canEdit} onSave={prop('travellers')} />
            </Fact>
            {(x.purpose === 'Work' || x.project) && (
              <Fact label="Project">
                <Inline value={x.project} label="Project" kind="choice" options={['', ...m.projects.map((p) => p.name)]} placeholder="Link a project" canEdit={canEdit} onSave={prop('project')} />
              </Fact>
            )}
          </div>
        </Card>
        <Card
          id="docs"
          title="Documents"
          count={x.files.length}
          actions={
            canEdit ? (
              <button type="button" className="text-button" onClick={() => void keepFiles(MOD, x.path, x.name, 'documents')}>
                <Icon name="plus" size={12} /> Add
              </button>
            ) : undefined
          }
        >
          <FilesList files={x.files} empty="Keep boarding passes, bookings and tickets with the trip." />
          {x.passports.length > 0 && (
            <div className="pm-checks">
              {x.passports.map((p) => (
                <button key={p.path} type="button" className={`pm-check${p.ok ? ' is-ok' : ' is-warn'}`} onClick={() => peek({ type: 'note', path: p.path }, { title: p.passport, type: 'note' })}>
                  <Icon name={p.ok ? 'check' : 'warning'} size={12} /> {p.words}
                </button>
              ))}
            </div>
          )}
        </Card>
      </aside>
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function TravelClassic({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const modules = useModules();
  const sections = TRAVEL.sections.filter((s) => s.id !== 'forecast' || partOn(modules, MOD, 'forecast'));
  const { section, detail } = placeOf(tab, TRAVEL, sections);
  const { data: m, error } = useWork<TravelView>(MOD);
  const records = useMemo(() => (m ? travelRecords(m) : []), [m]);
  const ctx = useWorkCtx(MOD, records, {
    editable: (r) => TRAVEL_EDITABLE[r.kind] ?? [],
    people: m?.people ?? [],
    open: (r: WsRecord, e) => {
      if (!r.path) return;
      if (e?.ctrlKey || e?.metaKey) return A.openPath(r.path, { where: 'tab' });
      openTrip(r.path);
    },
  });
  const x = detail?.kind === 'trip' && m ? m.trips.find((t) => t.path === detail.key) : undefined;
  const here = detail ? 'trips' : section;
  const more = (): MenuItem[] => [
    { label: 'New trip', icon: 'plane', disabled: !canEdit, run: () => newTrip(m) },
    ...(x && m ? ([{ separator: true }, ...tripMenu(x, m, canEdit).slice(2)] as MenuItem[]) : []),
    { separator: true },
    { label: 'Trips options…', icon: 'settings', disabled: !canEdit || !m, run: () => m && travelOptions(m) },
    { label: 'Show the folder', icon: 'folder', disabled: !m, run: () => m && A.revealInExplorer(m.folder) },
  ];
  const actions = x ? (
    <>
      <button type="button" className="sv-tool" disabled={!canEdit} onClick={() => m && newExpense(x, m.today)}>
        <Icon name="receipt" size={14} /> Add an expense
      </button>
      <button type="button" className="sv-tool nt-new" disabled={!canEdit} onClick={() => newBooking(x)}>
        <Icon name="plus" size={14} /> Add a booking
      </button>
    </>
  ) : (
    <button type="button" className="sv-tool nt-new" disabled={!canEdit} onClick={() => newTrip(m)}>
      <Icon name="plus" size={14} /> New trip
    </button>
  );
  const shownDetail = x && m ? { title: x.name, line: [tripDates(x, m.today), x.nights ? plural(x.nights, 'night') : '', tripWhen(x, m.today), x.purpose].filter(Boolean).join(' · '), back: { section: 'trips', label: 'Trips' }, badge: x.status !== 'Planning' ? <Pill tone={x.status === 'Booked' ? 'ok' : 'none'}>{x.status}</Pill> : undefined } : detail && m ? { title: 'Trip not found', back: { section: 'trips', label: 'Trips' } } : null;
  return (
    <WithRecords ctx={ctx}>
      <WorkShell tab={tab} module={TRAVEL} sections={sections} here={here} actions={actions} more={more} detail={shownDetail} sharePath={x?.path}>
        <div className="pm pm-travel">
          {error ? (
            <p className="rm-failed">{error}</p>
          ) : !m ? (
            <div className="view-loading" />
          ) : detail ? (
            x ? <TripPage x={x} m={m} canEdit={canEdit} /> : <EmptyState icon="plane" title="That trip isn’t here any more" line="It may have been renamed, moved or taken out." action={{ label: 'Trips', icon: 'plane', run: () => openModule(MOD, 'trips') }} />
          ) : !m.trips.length ? (
            <EmptyState icon="plane" title="Your trips, day by day" line="Add a trip to keep its flights, hotels and plans on their days, its documents with it, and what it costs against its budget." action={{ label: 'Plan your first trip', icon: 'plus', run: () => newTrip(m), disabled: !canEdit }} />
          ) : section === 'overview' ? (
            <Overview m={m} canEdit={canEdit} />
          ) : section === 'trips' ? (
            <div className="rm-overview">
              <ul className="pm-cards">
                {[...m.away, ...m.upcoming, ...m.past, ...m.trips.filter((t) => t.phase === 'Cancelled')].map((t) => (
                  <TripCard key={t.path} x={t} m={m} />
                ))}
              </ul>
              <WorkViews module={MOD} section="trips" made={travelSectionViews('trips')} records={records} />
            </div>
          ) : (
            <WorkViews module={MOD} section={section} made={travelSectionViews(section)} records={records} />
          )}
        </div>
      </WorkShell>
    </WithRecords>
  );
}

// ── Today ────────────────────────────────────────────────────────────────────────────────────────────────────────────

// ── The 8.7 page (30 Oct 2026): the new overview and trip page, the rest as before ─────────────────────────────

export function TravelPage({ tab }: { tab: W.TabState }) {
  const place = travelPlace(tab);
  if (place === 'overview') return <TravelOverview tab={tab} />;
  if (place === 'trip') { const path = tripPathOf(tab); if (path) return <TripDetail path={path} />; }
  if (place === 'classic') { const suffix = (partOfTab(tab) ?? '').startsWith('classic:') ? (partOfTab(tab) ?? '').slice(8) : 'overview'; return <TravelClassic tab={{ ...tab, path: `module:travel#${suffix}` }} />; }
  return <TravelClassic tab={tab} />;
}

export function TravelToday() {
  const modules = useModules();
  const on = partOn(modules, MOD, 'reminders');
  const { data: m } = useWork<TravelView>(MOD, 'model', [], on);
  if (!m || !on) return null;
  const away = m.away;
  const soon = m.upcoming.filter((x) => x.daysTo !== null && x.daysTo >= 0 && x.daysTo <= m.remindDays);
  const today = m.bookings.filter((b) => b.days === 0 || (b.days === 1 && /^(Flight|Train|Ferry)$/.test(b.kind)));
  if (!away.length && !soon.length && !today.length) return null;
  return (
    <section className="td-section rm-today pm-today" data-section="travel" aria-labelledby="td-h-travel">
      <header className="td-section-head">
        <h2 id="td-h-travel">
          Trips
          <span className="td-count">{away.length + soon.length + today.length}</span>
        </h2>
        <button type="button" className="td-section-link" onClick={() => openModule(MOD)}>
          <Icon name="plane" size={13} /> Trips
        </button>
      </header>
      <ul className="rm-today-rows">
        {today.map((b) => (
          <li key={`b:${b.trip}:${b.row}`} className="rm-today-row is-change">
            <button type="button" className="rm-today-main" onClick={() => openTrip(b.trip)}>
              <span className="rm-today-name">
                {bookingWords(b, m.today)} {b.days === 0 ? 'today' : 'tomorrow'}
              </span>
              <span className="rm-today-sub">{[b.tripName, b.where, b.booking && `ref ${b.booking}`].filter(Boolean).join(' · ')}</span>
            </button>
          </li>
        ))}
        {[...away, ...soon].map((x) => (
          <li key={x.path} className="rm-today-row">
            <button type="button" className="rm-today-main" onClick={() => openTrip(x.path)}>
              <span className="rm-today-name">
                {x.name}: {tripWhen(x, m.today).replace(/^\w/, (c) => c.toLowerCase())}
              </span>
              <span className="rm-today-sub">{[tripDates(x, m.today), plural(x.bookings.length, 'booking'), ...x.passports.filter((p) => !p.ok).map((p) => p.words)].filter(Boolean).join(' · ')}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
