// Travel (Wave 7 part a, 24 Oct 2026; module 16 of the catalogue: "Trips, flights, hotels, itineraries, expenses, travel
// forecast · Trip timeline, documents per trip, spend vs budget · Work / Personal"). Each trip is a plain note the person
// owns, in the module's folder inside the Me area:
//
//   Me/Travel/Trips/Harbour city weekend.md   type: trip — destination, purpose (Personal, Work, Family), starts, ends,
//                                             status, budget, travellers, project;
//                                             "## Itinerary" | Date | Time | Kind | What | Until | Where | Booking |
//                                             Cost | Paid | Notes |   (flights, hotels, cars, plans, one row each)
//                                             "## Expenses" | Date | What | Category | Amount | Paid by | Notes |
//   Me/Travel/Trips/Files/Harbour city weekend/   boarding passes, bookings, tickets: the trip's documents
//
// What a trip costs is its bookings plus what was spent there: the forecast. Its budget is set against that, and every
// trip still to come adds its forecast to the month it starts in. Pure: no files, no Node, no DOM.

import { defaultRecordView, type RecordViewDef } from './record-views';
import type { WsRecord } from './workspace-records';
import type { WorkToolDef } from './work-module-tools';
import { BOOKING_KINDS, EXPENSE_CATEGORIES, TRIP_PURPOSES, TRIP_STATUSES } from './personal-modules';
import { addToDay, dayWords, daysFrom, emptyTable, findByName, isImage, isYes, join, knownWord, linkName, monthWords, moneyWords, namesOf, noteText, plural, readAmount, readDay, readTable, readTime, refusedWords, sectionWords, str, todayOf, whenWords, type PropSpec, type TableSpec } from './personal-records';

export const ITINERARY_TABLE: TableSpec = {
  id: 'itinerary',
  name: 'Itinerary',
  heading: /^(itinerary|bookings|plans?|schedule|flights and hotels)$/i,
  one: 'booking',
  title: 'what',
  fields: [
    { key: 'date', label: 'Date', col: /^(date|day|when|from)$/i, kind: 'date' },
    { key: 'time', label: 'Time', col: /^(time|at|departs?)$/i, kind: 'time' },
    { key: 'kind', label: 'Kind', col: /^(kind|type)$/i, kind: 'choice', options: BOOKING_KINDS },
    { key: 'what', label: 'What', col: /^(what|item|details?|flight|description)$/i, kind: 'text' },
    { key: 'until', label: 'Until', col: /^(until|to|ends?|arrives?|check-?out)$/i, kind: 'text' },
    { key: 'where', label: 'Where', col: /^(where|place|address|location)$/i, kind: 'text' },
    { key: 'booking', label: 'Booking', col: /^(booking|ref(erence)?|confirmation|pnr|booking ref)$/i, kind: 'text' },
    { key: 'cost', label: 'Cost', col: /^(cost|price|amount|\$)$/i, kind: 'money' },
    { key: 'paid', label: 'Paid', col: /^(paid|status)$/i, kind: 'yesno' },
    { key: 'notes', label: 'Notes', col: /^notes?$/i, kind: 'text' },
  ],
};

export const EXPENSES_TABLE: TableSpec = {
  id: 'expenses',
  name: 'Expenses',
  heading: /^(expenses|spending|spend|costs)$/i,
  one: 'expense',
  title: 'what',
  fields: [
    { key: 'date', label: 'Date', col: /^(date|day|when)$/i, kind: 'date' },
    { key: 'what', label: 'What', col: /^(what|item|description|for)$/i, kind: 'text' },
    { key: 'category', label: 'Category', col: /^(category|kind|type)$/i, kind: 'choice', options: EXPENSE_CATEGORIES },
    { key: 'amount', label: 'Amount', col: /^(amount|cost|price|\$)$/i, kind: 'money' },
    { key: 'paid_by', label: 'Paid by', col: /^(paid by|who|by|card)$/i, kind: 'text' },
    { key: 'notes', label: 'Notes', col: /^notes?$/i, kind: 'text' },
  ],
};
export const TRAVEL_TABLES = [ITINERARY_TABLE, EXPENSES_TABLE];

export const TRIP_PROPS: PropSpec[] = [
  { field: 'destination', key: 'destination', kind: 'text', label: 'Destination' },
  { field: 'purpose', key: 'purpose', kind: 'choice', label: 'Purpose', options: TRIP_PURPOSES },
  { field: 'starts', key: 'starts', kind: 'date', label: 'Leaving' },
  { field: 'ends', key: 'ends', kind: 'date', label: 'Back' },
  { field: 'status', key: 'status', kind: 'choice', label: 'Status', options: TRIP_STATUSES },
  { field: 'budget', key: 'budget', kind: 'money', label: 'Budget' },
  { field: 'travellers', key: 'travellers', kind: 'links', label: 'Travellers' },
  { field: 'project', key: 'project', kind: 'link', label: 'Project' },
];

/** Which expense category a booking's cost counts under. */
export const BOOKING_CATEGORY: Record<string, string> = { Flight: 'Flights', Hotel: 'Accommodation', 'Car hire': 'Transport', Train: 'Transport', Bus: 'Transport', Ferry: 'Transport', Transfer: 'Transport', Activity: 'Activities', Meal: 'Food', Meeting: 'Other', Other: 'Other' };

// ── The model ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TripNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  type: string;
  files?: string[];
}

export interface PassportInfo {
  name: string;
  path: string;
  holder: string;
  expires: string | null;
}

export interface Booking {
  row: number;
  date: string | null;
  dateWords: string;
  time: string;
  kind: string;
  what: string;
  until: string;
  where: string;
  booking: string;
  cost: number | null;
  paid: boolean;
  notes: string;
  days: number | null;
  trip: string;
  tripName: string;
}

export interface Expense {
  row: number;
  date: string | null;
  what: string;
  category: string;
  amount: number | null;
  paidBy: string;
  notes: string;
  trip: string;
  tripName: string;
}

export type Phase = 'Upcoming' | 'Away' | 'Back' | 'No dates yet' | 'Cancelled';

export interface PassportCheck {
  passport: string;
  path: string;
  holder: string;
  expires: string | null;
  ok: boolean;
  words: string;
}

export interface Trip {
  path: string;
  name: string;
  destination: string;
  purpose: string;
  starts: string | null;
  ends: string | null;
  status: string;
  phase: Phase;
  /** Days until it starts (negative once it has). */
  daysTo: number | null;
  nights: number | null;
  budget: number | null;
  travellers: string[];
  project: string;
  bookings: Booking[];
  expenses: Expense[];
  /** What its bookings cost. */
  booked: number;
  /** What was spent on it outside its bookings. */
  spent: number;
  /** Bookings paid plus what was spent. */
  paid: number;
  /** Bookings plus spending: what the trip costs. */
  forecast: number;
  /** Budget less the forecast (null without a budget). */
  left: number | null;
  /** The itinerary by day, in order (rows with no day last). */
  days: { date: string | null; items: Booking[] }[];
  passports: PassportCheck[];
  notes: string;
  photos: string[];
  files: string[];
}

export interface TravelModel {
  trips: Trip[];
  /** Trips away now. */
  away: Trip[];
  /** Trips still to come (not cancelled or done), soonest first. */
  upcoming: Trip[];
  /** Trips that have ended, newest first. */
  past: Trip[];
  /** Every booking of every trip, by day. */
  bookings: Booking[];
  /** The forecast for trips starting in each of the next twelve months (this month first). */
  months: { month: string; forecast: number; budget: number; trips: string[] }[];
  /** Spent this calendar year on trips that started in it. */
  thisYear: number;
  /** Every cost by category (bookings counted under their category). */
  categories: { category: string; amount: number }[];
  today: string;
  remindDays: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const CLOSED = /^(cancelled)$/i;

export function readTrip(n: TripNote, today: string, passports: readonly PassportInfo[] = []): Trip {
  const p = n.props;
  const starts = readDay(p.starts ?? p.start ?? p.from);
  // No return day written is an open-ended trip, never a day trip: ends stays empty, and a started trip with no
  // return day is still Away.
  const ends = readDay(p.ends ?? p.end ?? p.until);
  const status = knownWord(TRIP_STATUSES, p.status) || 'Planning';
  const phase: Phase = CLOSED.test(status) ? 'Cancelled' : !starts ? 'No dates yet' : daysFrom(today, starts) > 0 ? 'Upcoming' : !ends || daysFrom(today, ends) >= 0 ? 'Away' : 'Back';
  const bookings: Booking[] = readTable(n.content, ITINERARY_TABLE).rows.map(({ row, values: v }) => {
    const date = readDay(v.date);
    return { row, date, dateWords: date ? '' : v.date, time: readTime(v.time) || v.time, kind: knownWord(BOOKING_KINDS, v.kind) || 'Other', what: v.what, until: v.until, where: v.where, booking: v.booking, cost: readAmount(v.cost), paid: isYes(v.paid), notes: v.notes, days: date ? daysFrom(today, date) : null, trip: n.path, tripName: n.title };
  });
  const expenses: Expense[] = readTable(n.content, EXPENSES_TABLE).rows.map(({ row, values: v }) => ({ row, date: readDay(v.date), what: v.what, category: knownWord(EXPENSE_CATEGORIES, v.category) || 'Other', amount: readAmount(v.amount), paidBy: v.paid_by, notes: v.notes, trip: n.path, tripName: n.title }));
  const booked = round2(bookings.reduce((a, b) => a + (b.cost ?? 0), 0));
  const spent = round2(expenses.reduce((a, e) => a + (e.amount ?? 0), 0));
  const paid = round2(bookings.reduce((a, b) => a + (b.paid ? (b.cost ?? 0) : 0), 0) + spent);
  const budget = readAmount(p.budget);
  const forecast = round2(booked + spent);
  const order = [...bookings].sort((a, b) => (a.date === null ? 1 : 0) - (b.date === null ? 1 : 0) || (a.date ?? '').localeCompare(b.date ?? '') || (a.time || '99').localeCompare(b.time || '99') || a.row - b.row);
  const days: Trip['days'] = [];
  for (const b of order) {
    const last = days[days.length - 1];
    if (last && last.date === b.date) last.items.push(b);
    else days.push({ date: b.date, items: [b] });
  }
  const travellers = namesOf(p.travellers);
  const checks: PassportCheck[] = [];
  if (ends && phase !== 'Back' && phase !== 'Cancelled')
    for (const pp of passports) {
      if (travellers.length && pp.holder && !travellers.some((t) => t.toLowerCase().split(' ')[0] === pp.holder.toLowerCase().split(' ')[0])) continue;
      const six = addToDay(ends, { months: 6 });
      const ok = !!pp.expires && pp.expires >= six;
      checks.push({ passport: pp.name, path: pp.path, holder: pp.holder, expires: pp.expires, ok, words: !pp.expires ? `${pp.name}: no expiry written` : pp.expires < (starts ?? ends) ? `${pp.name} expires ${dayWords(pp.expires, today)}, before you leave` : ok ? `${pp.name} is valid to ${dayWords(pp.expires, today)}` : `${pp.name} expires ${dayWords(pp.expires, today)}, within six months of coming home (many countries ask for six months)` });
    }
  const files = n.files ?? [];
  return {
    path: n.path,
    name: n.title,
    destination: str(p.destination),
    purpose: knownWord(TRIP_PURPOSES, p.purpose) || 'Personal',
    starts,
    ends,
    status,
    phase,
    daysTo: starts ? daysFrom(today, starts) : null,
    nights: starts && ends ? Math.max(0, daysFrom(starts, ends)) : null,
    budget,
    travellers,
    project: linkName(p.project),
    bookings,
    expenses,
    booked,
    spent,
    paid,
    forecast,
    left: budget !== null ? round2(budget - forecast) : null,
    days,
    passports: checks,
    notes: sectionWords(n.content, /^notes$/i),
    photos: files.filter(isImage),
    files,
  };
}

/** Trips from their notes, as of `today`; `passports` are the passports kept in Documents and ID (checked against each
 *  trip still to come). */
export function travelModel(notes: readonly TripNote[], today: Date | string = new Date(), remindDays = 7, passports: readonly PassportInfo[] = []): TravelModel {
  const t = todayOf(today);
  const trips = notes
    .filter((n) => n.type === 'trip')
    .map((n) => readTrip(n, t, passports))
    .sort((a, b) => (a.starts === null ? 1 : 0) - (b.starts === null ? 1 : 0) || (b.starts ?? '').localeCompare(a.starts ?? '') || a.name.localeCompare(b.name));
  const live = trips.filter((x) => x.phase !== 'Cancelled');
  const away = live.filter((x) => x.phase === 'Away');
  const upcoming = live.filter((x) => x.phase === 'Upcoming' || x.phase === 'No dates yet').sort((a, b) => (a.starts === null ? 1 : 0) - (b.starts === null ? 1 : 0) || (a.starts ?? '').localeCompare(b.starts ?? ''));
  const past = live.filter((x) => x.phase === 'Back');
  const bookings = live.flatMap((x) => x.bookings).sort((a, b) => (a.date ?? '9').localeCompare(b.date ?? '9') || (a.time || '99').localeCompare(b.time || '99'));
  const months: TravelModel['months'] = [];
  const first = new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, 1);
  for (let i = 0; i < 12; i++) {
    const d = new Date(first.getFullYear(), first.getMonth() + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const these = live.filter((x) => x.starts?.startsWith(ym) && x.phase !== 'Back');
    months.push({ month: ym, forecast: round2(these.reduce((a, x) => a + x.forecast, 0)), budget: round2(these.reduce((a, x) => a + (x.budget ?? 0), 0)), trips: these.map((x) => x.name) });
  }
  const cat = new Map<string, number>();
  for (const x of live) {
    for (const b of x.bookings) if (b.cost) cat.set(BOOKING_CATEGORY[b.kind] ?? 'Other', (cat.get(BOOKING_CATEGORY[b.kind] ?? 'Other') ?? 0) + b.cost);
    for (const e of x.expenses) if (e.amount) cat.set(e.category, (cat.get(e.category) ?? 0) + e.amount);
  }
  return {
    trips,
    away,
    upcoming,
    past,
    bookings,
    months,
    thisYear: round2(live.filter((x) => x.starts?.startsWith(t.slice(0, 4)) && x.phase !== 'Upcoming').reduce((a, x) => a + x.paid, 0)),
    categories: [...cat.entries()].map(([category, amount]) => ({ category, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
    today: t,
    remindDays,
  };
}

/** "Leaving in 5 days (Thu 29 Oct)", "Away now · day 2 of 4", "Back 3 days ago". */
export function tripWhen(x: Pick<Trip, 'phase' | 'starts' | 'ends' | 'daysTo' | 'nights'>, today: string): string {
  if (x.phase === 'Cancelled') return 'Cancelled';
  if (!x.starts || x.daysTo === null) return 'No dates yet';
  if (x.phase === 'Upcoming') return `Leaving ${whenWords(x.daysTo)}${x.daysTo > 1 ? ` (${dayWords(x.starts, today)})` : ''}`;
  if (x.phase === 'Away') return x.ends ? `Away now · day ${1 - x.daysTo} of ${(x.nights ?? 0) + 1}` : `Away now · day ${1 - x.daysTo}`;
  return x.ends ? `Back ${whenWords(daysFrom(today, x.ends))}` : 'Back';
}

/** "Thu 29 Oct – Sun 1 Nov" (one day: "Thu 29 Oct"). */
export function tripDates(x: Pick<Trip, 'starts' | 'ends'>, today: string): string {
  if (!x.starts) return '';
  return x.ends && x.ends !== x.starts ? `${dayWords(x.starts, today)} – ${dayWords(x.ends, today)}` : dayWords(x.starts, today);
}

const SMON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sday = (iso: string) => ({ d: Number(iso.slice(8, 10)), m: SMON[Number(iso.slice(5, 7)) - 1] });
/** A trip's days short ("10–17 Jan", one day "10 Jan"): for lists and facts. The years stay on the trip's page. */
export function tripRangeShort(x: Pick<Trip, 'starts' | 'ends'>): string {
  if (!x.starts) return '';
  const a = sday(x.starts);
  if (!x.ends || x.ends === x.starts) return `${a.d} ${a.m}`;
  const b = sday(x.ends);
  return x.starts.slice(0, 7) === x.ends.slice(0, 7) ? `${a.d}–${b.d} ${b.m}` : `${a.d} ${a.m} – ${b.d} ${b.m}`;
}
/** A trip's days in words ("10 to 17 Jan"): for its title, so it never clips mid-word. */
export function tripRangeWords(x: Pick<Trip, 'starts' | 'ends'>): string {
  if (!x.starts) return '';
  const a = sday(x.starts);
  if (!x.ends || x.ends === x.starts) return `${a.d} ${a.m}`;
  const b = sday(x.ends);
  return x.starts.slice(0, 7) === x.ends.slice(0, 7) ? `${a.d} to ${b.d} ${b.m}` : `${a.d} ${a.m} to ${b.d} ${b.m}`;
}

/** A booking's "until" in words: a day written as a day reads as one ("Sun 1 Nov"), anything else as written ("08:35"). */
export function untilWords(until: string, today?: string): string {
  const d = today ? readDay(until) : null;
  return d && today ? dayWords(d, today) : until;
}

/** A booking in words ("Flight QF 412 at 07:05", "Hotel Harbour Lodge until Sun 1 Nov"). */
export function bookingWords(b: Pick<Booking, 'kind' | 'what' | 'time' | 'until' | 'where'>, today?: string): string {
  const what = b.what || b.kind;
  const lead = b.kind && b.kind !== 'Other' && !what.toLowerCase().startsWith(b.kind.toLowerCase()) ? `${b.kind}: ${what}` : what;
  return [lead, b.time && `at ${b.time}`, b.until && `until ${untilWords(b.until, today)}`].filter(Boolean).join(' ');
}

// ── New notes ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TripInput {
  destination?: string;
  purpose?: string;
  starts?: string | null;
  ends?: string | null;
  status?: string;
  budget?: string | number | null;
  travellers?: string[];
  project?: string;
  note?: string;
}
export function newTripText(x: TripInput): string {
  return noteText(
    'trip',
    [
      ['destination', str(x.destination)],
      ['purpose', knownWord(TRIP_PURPOSES, x.purpose) || 'Personal'],
      ['starts', readDay(x.starts)],
      ['ends', readDay(x.ends)],
      ['status', knownWord(TRIP_STATUSES, x.status) || 'Planning'],
      ['budget', readAmount(x.budget)],
      ['travellers', (x.travellers ?? []).map(linkName).filter(Boolean).map((n) => `[[${n}]]`)],
      ['project', linkName(x.project) ? `[[${linkName(x.project)}]]` : ''],
    ],
    `${emptyTable(ITINERARY_TABLE)}${emptyTable(EXPENSES_TABLE)}## Notes\n\n${x.note ? `${x.note}\n` : ''}`,
  );
}

/** A trip's name from where and when ("Harbour City, Nov 2026"). */
export function tripName(destination: string, starts: string | null): string {
  const d = str(destination) || 'Trip';
  return starts ? `${d} ${monthWords(starts.slice(0, 7))}` : d;
}

// ── Records for the views ────────────────────────────────────────────────────────────────────────────────────────────

export function travelRecords(m: TravelModel): WsRecord[] {
  const out: WsRecord[] = [];
  for (const x of m.trips) {
    const id = `${x.path}::trip`;
    out.push({
      id,
      kind: 'trip',
      title: x.name,
      path: x.path,
      ...(x.project ? { projectName: x.project } : {}),
      fields: { destination: x.destination || null, purpose: x.purpose, starts: x.starts, ends: x.ends, status: x.status, phase: x.phase, nights: x.nights, budget: x.budget, forecast: x.forecast || null, spent_total: x.paid || null, left: x.left, bookings: x.bookings.length },
      links: [],
      ref: { at: 'note', path: x.path },
    });
    for (const b of x.bookings)
      out.push({ id: `${x.path}::booking:${b.row}`, kind: 'booking', title: b.what || b.kind, path: x.path, fields: { trip: x.name, date: b.date ?? (b.dateWords || null), time: b.time || null, booking_kind: b.kind, until: b.until || null, place: b.where || null, reference: b.booking || null, cost: b.cost, is_paid: b.paid }, links: [id], ref: { at: 'table', heading: ITINERARY_TABLE.name, row: b.row, cols: {} } });
    for (const e of x.expenses) out.push({ id: `${x.path}::expense:${e.row}`, kind: 'expense', title: e.what || e.category, path: x.path, fields: { trip: x.name, date: e.date, category: e.category, amount: e.amount, paid_by: e.paidBy || null }, links: [id], ref: { at: 'table', heading: EXPENSES_TABLE.name, row: e.row, cols: {} } });
  }
  return out;
}

export const TRAVEL_EDITABLE: Record<string, string[]> = {
  trip: ['destination', 'purpose', 'starts', 'ends', 'status', 'budget'],
  booking: ['title', 'date', 'time', 'booking_kind', 'until', 'place', 'reference', 'cost', 'is_paid'],
  expense: ['title', 'date', 'category', 'amount', 'paid_by'],
};
export const TRAVEL_CELL: Record<string, Record<string, string>> = { booking: { title: 'what', booking_kind: 'kind', reference: 'booking', place: 'where', is_paid: 'paid' }, expense: { title: 'what' } };

export function travelSectionViews(section: string): RecordViewDef[] {
  const v = (kinds: WsRecord['kind'][], layout: RecordViewDef['layout'], title: string, patch: Partial<RecordViewDef> = {}): RecordViewDef => ({ ...defaultRecordView(kinds, layout, title), scope: 'vault', showDone: true, ...patch });
  switch (section) {
    case 'trips':
      return [v(['trip'], 'table', 'Every trip', { fields: ['destination', 'starts', 'ends', 'purpose', 'status', 'budget', 'forecast', 'left'], sort: { field: 'starts', dir: 'desc' } })];
    case 'timeline':
      return [v(['trip'], 'timeline', 'Trips on a timeline', { dateField: 'starts', endField: 'ends', fields: ['destination'], filters: [{ field: 'status', op: 'is-not', value: 'Cancelled' }] })];
    case 'itinerary':
      return [v(['booking'], 'calendar', 'Bookings and plans', { dateField: 'date', fields: ['time', 'trip'] }), v(['booking'], 'table', 'Every booking', { fields: ['date', 'time', 'booking_kind', 'place', 'reference', 'cost', 'is_paid'], groupBy: 'trip', sort: { field: 'date', dir: 'asc' } })];
    case 'expenses':
      return [v(['expense'], 'chart', 'Spending by category', { chart: { type: 'donut', by: 'category', measure: 'amount', agg: 'sum' } }), v(['expense'], 'table', 'Every expense', { fields: ['date', 'category', 'amount', 'paid_by'], groupBy: 'trip', sort: { field: 'date', dir: 'desc' } })];
    case 'forecast':
      return [v(['trip'], 'chart', 'Forecast against budget by month', { chart: { type: 'bar', by: 'starts', measure: 'forecast', agg: 'sum', target: 'budget' }, filters: [{ field: 'status', op: 'is-not', value: 'Cancelled' }] }), v(['trip'], 'table', 'Each trip’s forecast', { fields: ['starts', 'purpose', 'budget', 'forecast', 'spent_total', 'left'], filters: [{ field: 'status', op: 'is-not', value: 'Cancelled' }], sort: { field: 'starts', dir: 'asc' } })];
  }
  return [];
}

// ── The agent tools ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface CalendarBooking {
  date: string;
  time: string;
  kind: string;
  what: string;
  until: string;
  where: string;
  booking: string;
}

/** Bookings in a calendar file's words (iCalendar): each event's day, time, title, place and a booking code only when
 *  the words carry one ("Booking ref …", "Confirmation …"). Times are read as written; no code is ever invented. */
export function parseCalendarBookings(text: string): CalendarBooking[] {
  const unfolded = String(text ?? '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const out: CalendarBooking[] = [];
  for (const block of unfolded.split(/BEGIN:VEVENT/i).slice(1)) {
    const field = (name: string) => {
      const hit = new RegExp(`^${name}(?:;[^:\\r\\n]*)?:([^\\r\\n]*)`, 'im').exec(block);
      return hit ? hit[1].trim().replace(/\\,/g, ',') : '';
    };
    const start = field('DTSTART');
    const dm = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(start);
    if (!dm) continue;
    const end = field('DTEND');
    const em = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(end);
    const what = field('SUMMARY').slice(0, 160);
    if (!what) continue;
    const words = `${what} ${field('DESCRIPTION')}`;
    const kind = /flight|airport|\b[A-Z]{2}\s?\d{2,4}\b/i.test(words) ? 'Flight' : /hotel|check-?in|resort|motel|apartment/i.test(words) ? 'Hotel' : /train/i.test(words) ? 'Train' : /car|hire|rental/i.test(words) ? 'Car hire' : 'Other';
    out.push({ date: `${dm[1]}-${dm[2]}-${dm[3]}`, time: dm[4] ? `${dm[4]}:${dm[5]}` : '', kind, what, until: em ? (em[4] ? `${em[4]}:${em[5]}` : `${em[1]}-${em[2]}-${em[3]}`) : '', where: field('LOCATION').slice(0, 160), booking: (/(?:booking ref(?:erence)?|confirmation(?: code| number)?|pnr)\s*[:#]?\s*([A-Za-z0-9-]{3,20})/i.exec(field('DESCRIPTION'))?.[1] ?? '').slice(0, 40) });
  }
  return out;
}

/** travel_import_calendar's rows for one trip, from a calendar file the person gave. Throws in plain words. */
export function planCalendarImport(args: Record<string, unknown>, m: TravelModel): { trip: Trip; rows: CalendarBooking[]; words: string } {
  const trip = which(m, args.trip);
  const rows = parseCalendarBookings(str(args.calendar));
  if (!rows.length) throw new Error('No bookings could be read from that calendar file. It needs events with a day and a title.');
  return { trip, rows, words: `Brought ${plural(rows.length, 'booking')} from the calendar file into ${trip.name}.` };
}

/** A trip's leaving checklist, from what is written (30 Oct 2026, the uplift): passport worries first, then bookings not
 *  marked paid, bookings with no code written, and what is on in the first two days. Nothing is invented. */
export function leavingChecklist(x: Trip, today: string): string[] {
  const out: string[] = [];
  for (const p of x.passports) if (!p.ok) out.push(`Passport: ${p.words}.`);
  const unpaid = x.bookings.filter((b) => b.cost !== null && !b.paid);
  if (unpaid.length) out.push(`Not marked paid: ${unpaid.map((b) => b.what || b.kind).join(', ')}.`);
  const noCode = x.bookings.filter((b) => !b.booking && ['Flight', 'Hotel', 'Car hire', 'Train', 'Ferry'].includes(b.kind));
  if (noCode.length) out.push(`No booking code written: ${noCode.map((b) => b.what || b.kind).join(', ')}.`);
  if (!x.bookings.length) out.push('No bookings in the itinerary yet.');
  if (x.budget !== null && x.left !== null && x.left < 0) out.push(`Over budget by ${moneyWords(-x.left)} on what is written so far.`);
  const first = x.days.filter((d) => d.date && x.starts && d.date >= x.starts).slice(0, 2);
  for (const d of first) out.push(`${d.date ? dayWords(d.date, today) : ''}: ${d.items.map((b) => bookingWords(b, today)).join('; ')}.`);
  if (!out.length) out.push('Everything written for this trip looks in order.');
  return out;
}

export const TRAVEL_TOOLS: WorkToolDef[] = [
  {
    name: 'travel_trip_list',
    module: 'travel',
    write: false,
    title: 'Trips',
    step: 'Looked through your trips',
    description: 'The person’s trips (Ironleaf): each with destination, dates, purpose (Personal, Work, Family), status, how many bookings, its budget and forecast (bookings plus spending). Use it for "when is my next trip?", "what trips have I got coming up?".',
    parameters: { type: 'object', properties: { when: { type: 'string', enum: ['upcoming', 'past', 'all'], description: 'Upcoming (and away now) unless said.' } }, additionalProperties: false },
  },
  {
    name: 'travel_trip_get',
    module: 'travel',
    write: false,
    title: 'One trip',
    step: 'Read a trip’s itinerary',
    description: 'One trip in full: its itinerary day by day (flights, hotels, cars and plans with times, booking references and costs), its expenses, the budget against the forecast, the documents kept with it and a passport check against Papers. Use it for "what time is my flight?", "what’s the hotel booking reference?".',
    parameters: { type: 'object', properties: { trip: { type: 'string', description: 'The trip’s name or destination (the next one when left out).' } }, additionalProperties: false },
  },
  {
    name: 'travel_forecast',
    module: 'travel',
    write: false,
    title: 'Travel forecast',
    step: 'Worked out the travel forecast',
    description: 'What travel is forecast to cost: each trip still to come with its budget, bookings and spending, the total by month for the next twelve months, and what was spent on travel this year. Use it for "how much is travel going to cost this quarter?", "am I over budget for the trip?".',
    parameters: { type: 'object', properties: { months: { type: 'number', description: 'How many months ahead (12 unless said).' } }, additionalProperties: false },
  },
  {
    name: 'travel_checklist',
    module: 'travel',
    write: false,
    title: 'Leaving checklist',
    step: 'Checked a trip before leaving',
    description: 'A short leaving checklist for one trip from what is written: any passport that fails the six-month rule, bookings not marked paid, bookings with no code written, whether it is over budget, and the first two days’ bookings. Use a week or so before leaving.',
    parameters: { type: 'object', properties: { trip: { type: 'string', description: 'The trip’s name or destination (the next one when left out).' } }, additionalProperties: false },
  },
  {
    name: 'travel_import_calendar',
    module: 'travel',
    write: true,
    title: 'Bring bookings in from a calendar file',
    step: 'Brought bookings in from a calendar file',
    description: 'Bring bookings into a trip from a calendar file the person gave (its words pasted in): each event becomes an itinerary row with its day, time, place and a booking code only when the words carry one. Never invent a code, time or price.',
    parameters: { type: 'object', properties: { trip: { type: 'string' }, calendar: { type: 'string', description: 'The calendar file’s words.' } }, required: ['calendar'], additionalProperties: false },
  },
  {
    name: 'travel_trip_add',
    module: 'travel',
    write: true,
    title: 'Add a trip',
    step: 'Added a trip',
    description: 'Add a trip with the destination and the days the person gave (never guessed ones), its purpose and budget when said, and the project it is for (a work trip).',
    parameters: {
      type: 'object',
      properties: {
        destination: { type: 'string' },
        starts: { type: 'string', description: 'YYYY-MM-DD' },
        ends: { type: 'string', description: 'YYYY-MM-DD' },
        name: { type: 'string', description: 'A name for it, if the person gave one.' },
        purpose: { type: 'string', enum: [...TRIP_PURPOSES] },
        budget: { type: 'number' },
        project: { type: 'string' },
      },
      required: ['destination'],
      additionalProperties: false,
    },
  },
  {
    name: 'travel_itinerary_add',
    module: 'travel',
    write: true,
    title: 'Add a booking',
    step: 'Added a booking to a trip',
    description: 'Add a flight, hotel, car, train or plan to a trip’s itinerary with what the person gave (from a confirmation they pasted, say): the day and time, what it is (a flight number and route, a hotel’s name), until when, where, the booking reference and cost. Never invent a reference, a time or a price.',
    parameters: {
      type: 'object',
      properties: {
        trip: { type: 'string', description: 'The trip’s name or destination (the next one when left out).' },
        kind: { type: 'string', enum: [...BOOKING_KINDS] },
        what: { type: 'string', description: '"QF 412 Sydney to Melbourne", "Harbour Lodge".' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM' },
        until: { type: 'string', description: 'Arrival time, check-out day or when it ends, as given.' },
        where: { type: 'string' },
        booking: { type: 'string', description: 'The booking reference.' },
        cost: { type: 'number' },
        paid: { type: 'boolean' },
      },
      required: ['kind', 'what'],
      additionalProperties: false,
    },
  },
  {
    name: 'travel_expense_add',
    module: 'travel',
    write: true,
    title: 'Add a trip expense',
    step: 'Added an expense to a trip',
    description: 'Add something spent on a trip (a meal, a taxi, a ticket) with its amount and category, so the trip’s spending is set against its budget. Only the amount the person gave.',
    parameters: { type: 'object', properties: { trip: { type: 'string' }, what: { type: 'string' }, amount: { type: 'number' }, category: { type: 'string', enum: [...EXPENSE_CATEGORIES] }, date: { type: 'string', description: 'YYYY-MM-DD (today when left out).' }, paid_by: { type: 'string' } }, required: ['what', 'amount'], additionalProperties: false },
  },
];

export interface TravelToolInput {
  model: TravelModel;
  on: boolean;
  refused?: number;
  agent?: string;
  currency?: string;
}

const OFF = 'The Trips module is off in Ironleaf (Settings › Packs). Say so; don’t guess at trips, flights or bookings.';

export function findTrip(m: TravelModel, words: unknown): Trip | undefined {
  if (!str(words)) return m.away[0] ?? m.upcoming[0];
  return findByName(m.trips, words, (x) => [x.name, x.destination]);
}
const which = (m: TravelModel, words: unknown) => {
  const x = findTrip(m, words);
  if (x) return x;
  throw new Error(str(words) ? `There is no trip called “${str(words)}” in Trips.${m.trips.length ? ` Trips: ${m.trips.slice(0, 12).map((t) => t.name).join(', ')}.` : ''}` : 'There is no trip coming up in Trips. Say which trip.');
};

const money = (n: number | null, cur: string) => (n === null ? '' : moneyWords(n, cur));
const tripLine = (x: Trip, today: string, cur: string) => `- ${x.name}${x.destination && !x.name.toLowerCase().includes(x.destination.toLowerCase()) ? ` (${x.destination})` : ''}: ${tripDates(x, today) || 'no dates yet'}; ${tripWhen(x, today)}; ${x.purpose}, ${x.status}; ${plural(x.bookings.length, 'booking')}; forecast ${money(x.forecast, cur)}${x.budget !== null ? ` of a ${money(x.budget, cur)} budget${x.left !== null && x.left < 0 ? ` (${money(-x.left, cur)} over)` : ''}` : ''} [${x.path}]`;

export function answerTravelTool(input: TravelToolInput, name: string, args: Record<string, unknown> = {}): string | null {
  const tool = TRAVEL_TOOLS.find((t) => t.name === name);
  if (!tool || tool.write) return null;
  if (!input.on) return OFF;
  const m = input.model;
  const cur = input.currency ?? 'AUD';
  const refused = refusedWords(input.refused, 'trip note', input.agent);
  if (name === 'travel_trip_list') {
    const when = str(args.when).toLowerCase() || 'upcoming';
    const list = when === 'all' ? m.trips : when === 'past' ? m.past : [...m.away, ...m.upcoming];
    if (!list.length) return join([m.trips.length ? (when === 'past' ? 'No trips have ended yet.' : 'No trips coming up.') : 'No trips yet.', refused]);
    return join([`${plural(list.length, 'trip')}:`, ...list.map((x) => tripLine(x, m.today, cur)), refused]);
  }
  if (name === 'travel_trip_get') {
    let x: Trip;
    try {
      x = which(m, args.trip);
    } catch (e) {
      return join([(e as Error).message, refused]);
    }
    return join([
      `${x.name}${x.destination ? `, ${x.destination}` : ''}: ${tripDates(x, m.today) || 'no dates yet'}${x.nights ? ` (${plural(x.nights, 'night')})` : ''}; ${tripWhen(x, m.today)}; ${x.purpose}, ${x.status}${x.travellers.length ? `; travellers ${x.travellers.join(', ')}` : ''}${x.project ? `; for ${x.project}` : ''}. [${x.path}]`,
      x.days.length ? 'Itinerary:' : 'No bookings in the itinerary yet.',
      ...x.days.flatMap((d) => [`${d.date ? dayWords(d.date, m.today) : 'No day written'}:`, ...d.items.map((b) => `  - ${bookingWords(b, m.today)}${b.where ? `; ${b.where}` : ''}${b.booking ? `; booking ${b.booking}` : ''}${b.cost !== null ? `; ${money(b.cost, cur)}${b.paid ? ' paid' : ''}` : ''}${b.notes ? `; ${b.notes}` : ''}`)]),
      x.expenses.length ? `Expenses: ${x.expenses.map((e) => `${e.what || e.category} ${money(e.amount, cur)}`).join(', ')}.` : '',
      `Cost: bookings ${money(x.booked, cur)} + spending ${money(x.spent, cur)} = forecast ${money(x.forecast, cur)}${x.budget !== null ? `; budget ${money(x.budget, cur)}, ${x.left! >= 0 ? `${money(x.left, cur)} left` : `${money(-x.left!, cur)} over`}` : '; no budget set'}.`,
      x.files.length ? `${plural(x.files.length, 'document')} kept with it: ${x.files.map((f) => f.split('/').pop()).join(', ')}.` : '',
      ...x.passports.map((p) => `Passport check: ${p.words}.`),
      x.notes ? `Notes: ${x.notes.slice(0, 1200)}` : '',
      refused,
    ]);
  }
  if (name === 'travel_checklist') {
    let x: Trip;
    try {
      x = which(m, args.trip);
    } catch (e) {
      return join([(e as Error).message, refused]);
    }
    return join([`Leaving checklist for ${x.name} (${tripWhen(x, m.today)}):`, ...leavingChecklist(x, m.today).map((l) => `- ${l}`), refused]);
  }
  if (name === 'travel_forecast') {
    const n = typeof args.months === 'number' && args.months > 0 ? Math.min(12, Math.round(args.months)) : 12;
    const months = m.months.slice(0, n);
    const total = months.reduce((a, x) => a + x.forecast, 0);
    const budget = months.reduce((a, x) => a + x.budget, 0);
    const trips = [...m.away, ...m.upcoming].filter((x) => !x.starts || months.some((mo) => x.starts!.startsWith(mo.month)) || x.phase === 'Away');
    return join([
      `Travel forecast for the next ${plural(n, 'month')}: ${money(total, cur)}${budget ? ` against ${money(budget, cur)} budgeted` : ''}.`,
      ...months.filter((x) => x.forecast || x.trips.length).map((x) => `- ${monthWords(x.month)}: ${money(x.forecast, cur)}${x.budget ? ` (budget ${money(x.budget, cur)})` : ''} · ${x.trips.join(', ')}`),
      trips.length ? 'Trips:' : 'No trips coming up.',
      ...trips.map((x) => tripLine(x, m.today, cur)),
      `Spent on travel so far this year: ${money(m.thisYear, cur)}.`,
      refused,
    ]);
  }
  return null;
}

/** travel_trip_add's note. */
export function planTripAdd(args: Record<string, unknown>, m: TravelModel): { name: string; text: string; words: string } {
  const destination = str(args.destination).slice(0, 100);
  if (!destination) throw new Error('A trip needs its destination.');
  for (const k of ['starts', 'ends'] as const) if (str(args[k]) && !readDay(args[k])) throw new Error('Give days as YYYY-MM-DD.');
  const starts = readDay(args.starts);
  const ends = readDay(args.ends);
  if (starts && ends && ends < starts) throw new Error('The trip ends before it starts: check the days.');
  const name = str(args.name).slice(0, 100) || tripName(destination, starts);
  if (m.trips.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error(`There’s already a trip called ${name}.`);
  const input: TripInput = { destination, starts, ends, purpose: str(args.purpose), budget: readAmount(args.budget), project: str(args.project), note: 'Added by an assistant.' };
  return { name, text: newTripText(input), words: `Added the trip ${name}${starts ? ` (${tripDates({ starts, ends }, m.today)})` : ''}.` };
}

/** travel_itinerary_add's row. */
export function planBooking(args: Record<string, unknown>, m: TravelModel, cur = 'AUD'): { trip: Trip; values: Record<string, string>; words: string } {
  const x = which(m, args.trip);
  const what = str(args.what).slice(0, 160);
  if (!what) throw new Error('Say what the booking is (a flight number and route, a hotel’s name).');
  const date = str(args.date) ? readDay(args.date) : null;
  if (str(args.date) && !date) throw new Error('Give the day as YYYY-MM-DD.');
  const time = str(args.time) ? readTime(args.time) : '';
  if (str(args.time) && !time) throw new Error('Give the time as HH:MM.');
  const cost = readAmount(args.cost);
  const kind = knownWord(BOOKING_KINDS, args.kind);
  const values = { date: date ?? '', time, kind: (BOOKING_KINDS as readonly string[]).includes(kind) ? kind : 'Other', what, until: str(args.until).slice(0, 60), where: str(args.where).slice(0, 160), booking: str(args.booking).slice(0, 40), cost: cost !== null ? String(cost) : '', paid: args.paid === true ? 'Yes' : args.paid === false ? 'No' : '', notes: '' };
  return { trip: x, values, words: `Added ${bookingWords({ kind: values.kind, what, time, until: values.until, where: '' })}${date ? ` on ${dayWords(date, m.today)}` : ''} to ${x.name}${cost !== null ? ` (${moneyWords(cost, cur)})` : ''}.` };
}

/** travel_expense_add's row. */
export function planExpense(args: Record<string, unknown>, m: TravelModel, cur = 'AUD'): { trip: Trip; values: Record<string, string>; words: string } {
  const x = which(m, args.trip);
  const what = str(args.what).slice(0, 120);
  const amount = readAmount(args.amount);
  if (!what || amount === null) throw new Error('An expense needs what it was and its amount.');
  const date = str(args.date) ? readDay(args.date) : m.today;
  if (!date) throw new Error('Give the day as YYYY-MM-DD.');
  const category = knownWord(EXPENSE_CATEGORIES, args.category);
  const values = { date, what, category: (EXPENSE_CATEGORIES as readonly string[]).includes(category) ? category : 'Other', amount: String(amount), paid_by: str(args.paid_by).slice(0, 60), notes: '' };
  const left = x.budget !== null ? x.budget - x.forecast - amount : null;
  return { trip: x, values, words: `Added ${what} (${moneyWords(amount, cur)}) to ${x.name}${left !== null ? `; ${left >= 0 ? `${moneyWords(left, cur)} of its budget left` : `${moneyWords(-left, cur)} over its budget`}` : ''}.` };
}
