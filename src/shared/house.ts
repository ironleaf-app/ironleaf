// Home (Wave 7 part a, 24 Oct 2026; module 12 of the catalogue: "House, rooms, appliances, warranties, maintenance,
// utilities, printer and network · Maintenance schedule, warranty expiry, manuals · Personal"). Each record is a plain
// note the person owns, in the module's folder inside the Home area:
//
//   Home/House/Our place.md                 type: house — address, ownership, moved_in, contact;
//                                           "## Rooms" | Room | Floor | Notes |
//                                           "## Utilities" | Utility | Provider | Plan | Account | Phone | Notes |
//                                           "## Network and printers" | Thing | Details | Notes |
//   Home/House/Appliances/Dishwasher.md     type: appliance — kind, room, make, model, serial, purchased, price, supplier,
//                                           warranty, status; "## Service history" | Date | What | By | Cost | Notes |
//   Home/House/Maintenance/Gutters.md       type: upkeep — every, last_done, next_due, appliance, room, who, cost, status;
//                                           "## Done" | Date | By | Cost | Notes |
//   …/Files/<record>/                       manuals, receipts and photos kept beside the record
//
// A job's next day comes from its last one and how often it comes round when no day is written. Passwords never belong
// in a note: an answer for an assistant leaves out anything that reads like one. Pure: no files, no Node, no DOM.

import { defaultRecordView, type RecordViewDef } from './record-views';
import type { WsRecord } from './workspace-records';
import type { WorkToolDef } from './work-module-tools';
import { APPLIANCE_KINDS, APPLIANCE_STATUSES, OWNERSHIP, UPKEEP_EVERY, UPKEEP_STATUSES } from './personal-modules';
import { addToDay, dayWords, daysFrom, emptyTable, findByName, isImage, join, knownWord, linkName, moneyWords, noteText, plural, readAmount, readDay, readTable, refusedWords, sectionWords, str, todayOf, whenWords, type PropSpec, type TableSpec } from './personal-records';

// ── The notes' tables ────────────────────────────────────────────────────────────────────────────────────────────────

export const ROOMS_TABLE: TableSpec = {
  id: 'rooms',
  name: 'Rooms',
  heading: /^rooms?(\s+and\s+spaces)?$|^spaces$/i,
  one: 'room',
  title: 'room',
  fields: [
    { key: 'room', label: 'Room', col: /^(room|name|space|area)$/i, kind: 'text' },
    { key: 'floor', label: 'Floor', col: /^(floor|level|storey)$/i, kind: 'text' },
    { key: 'notes', label: 'Notes', col: /^(notes?|what|purpose)$/i, kind: 'text' },
  ],
};

export const UTILITIES_TABLE: TableSpec = {
  id: 'utilities',
  name: 'Utilities',
  heading: /^(utilities|services|providers|accounts)$/i,
  one: 'utility',
  title: 'utility',
  fields: [
    { key: 'utility', label: 'Utility', col: /^(utility|service|what|kind)$/i, kind: 'text' },
    { key: 'provider', label: 'Provider', col: /^(provider|company|supplier|retailer)$/i, kind: 'text' },
    { key: 'plan', label: 'Plan', col: /^(plan|tariff|product)$/i, kind: 'text' },
    { key: 'account', label: 'Account', col: /^(account|account (no|number|ref)|customer (no|number)|ref(erence)?)$/i, kind: 'text' },
    { key: 'phone', label: 'Phone', col: /^(phone|contact|number to call|support)$/i, kind: 'text' },
    { key: 'notes', label: 'Notes', col: /^notes?$/i, kind: 'text' },
  ],
};

export const NETWORK_TABLE: TableSpec = {
  id: 'network',
  name: 'Network and printers',
  heading: /^(network(\s+and\s+printers?)?|printers?(\s+and\s+network)?|wi-?fi(\s+and\s+printers?)?|tech|it)$/i,
  one: 'line',
  title: 'thing',
  fields: [
    { key: 'thing', label: 'Thing', col: /^(thing|what|device|item|name)$/i, kind: 'text' },
    { key: 'details', label: 'Details', col: /^(details?|setting|value|info)$/i, kind: 'text' },
    { key: 'notes', label: 'Notes', col: /^notes?$/i, kind: 'text' },
  ],
};

export const HISTORY_TABLE: TableSpec = {
  id: 'history',
  name: 'Service history',
  heading: /^(service(s|\s+history|\s+log)?|repairs?|history)$/i,
  one: 'service',
  title: 'what',
  fields: [
    { key: 'date', label: 'Date', col: /^(date|day|when)$/i, kind: 'date' },
    { key: 'what', label: 'What', col: /^(what|work|job|done|description)$/i, kind: 'text' },
    { key: 'by', label: 'By', col: /^(by|who|tradie|technician|company)$/i, kind: 'text' },
    { key: 'cost', label: 'Cost', col: /^(cost|price|paid|\$)$/i, kind: 'money' },
    { key: 'notes', label: 'Notes', col: /^notes?$/i, kind: 'text' },
  ],
};

export const DONE_TABLE: TableSpec = {
  id: 'done',
  name: 'Done',
  heading: /^(done|history|log|completed)$/i,
  one: 'time it was done',
  title: 'date',
  fields: [
    { key: 'date', label: 'Date', col: /^(date|day|when)$/i, kind: 'date' },
    { key: 'by', label: 'By', col: /^(by|who)$/i, kind: 'text' },
    { key: 'cost', label: 'Cost', col: /^(cost|price|paid|\$)$/i, kind: 'money' },
    { key: 'notes', label: 'Notes', col: /^notes?$/i, kind: 'text' },
  ],
};

export const HOUSE_TABLES = [ROOMS_TABLE, UTILITIES_TABLE, NETWORK_TABLE, HISTORY_TABLE, DONE_TABLE];

export const HOME_PROPS: PropSpec[] = [
  { field: 'address', key: 'address', kind: 'text', label: 'Address' },
  { field: 'ownership', key: 'ownership', kind: 'choice', label: 'Owned or renting', options: OWNERSHIP },
  { field: 'moved_in', key: 'moved_in', kind: 'date', label: 'Moved in' },
  { field: 'contact', key: 'contact', kind: 'link', label: 'Landlord or agent' },
];
export const APPLIANCE_PROPS: PropSpec[] = [
  { field: 'appliance_kind', key: 'kind', kind: 'choice', label: 'Kind', options: APPLIANCE_KINDS },
  { field: 'room', key: 'room', kind: 'text', label: 'Room' },
  { field: 'make', key: 'make', kind: 'text', label: 'Make' },
  { field: 'model', key: 'model', kind: 'text', label: 'Model' },
  { field: 'serial', key: 'serial', kind: 'text', label: 'Serial' },
  { field: 'purchased', key: 'purchased', kind: 'date', label: 'Purchased' },
  { field: 'price', key: 'price', kind: 'money', label: 'Price' },
  { field: 'supplier', key: 'supplier', kind: 'text', label: 'Bought from' },
  { field: 'warranty', key: 'warranty', kind: 'date', label: 'Warranty ends' },
  { field: 'status', key: 'status', kind: 'choice', label: 'Status', options: APPLIANCE_STATUSES },
];
export const UPKEEP_PROPS: PropSpec[] = [
  { field: 'every', key: 'every', kind: 'choice', label: 'How often', options: UPKEEP_EVERY },
  { field: 'last_done', key: 'last_done', kind: 'date', label: 'Last done' },
  { field: 'next_due', key: 'next_due', kind: 'date', label: 'Next due' },
  { field: 'appliance', key: 'appliance', kind: 'link', label: 'Appliance' },
  { field: 'room', key: 'room', kind: 'text', label: 'Room' },
  { field: 'who', key: 'who', kind: 'text', label: 'Who does it' },
  { field: 'cost', key: 'cost', kind: 'money', label: 'Usual cost' },
  { field: 'status', key: 'status', kind: 'choice', label: 'Status', options: UPKEEP_STATUSES },
];

// ── The model ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface HouseNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  type: string;
  files?: string[];
}

export interface Row<T extends string> {
  row: number;
  values: Record<T, string>;
}

export interface Home {
  path: string;
  name: string;
  address: string;
  ownership: string;
  movedIn: string | null;
  contact: string;
  rooms: Row<'room' | 'floor' | 'notes'>[];
  utilities: Row<'utility' | 'provider' | 'plan' | 'account' | 'phone' | 'notes'>[];
  network: Row<'thing' | 'details' | 'notes'>[];
  notes: string;
  photos: string[];
  files: string[];
}

export type WarrantyState = 'Out of warranty' | 'Warranty ends soon' | 'Under warranty' | null;

export interface ServiceRow {
  row: number;
  date: string | null;
  dateWords: string;
  what: string;
  by: string;
  cost: number | null;
  notes: string;
}

export interface Appliance {
  path: string;
  name: string;
  kind: string;
  room: string;
  make: string;
  model: string;
  serial: string;
  purchased: string | null;
  price: number | null;
  supplier: string;
  warranty: string | null;
  warrantyDays: number | null;
  warrantyState: WarrantyState;
  status: string;
  history: ServiceRow[];
  /** Manuals and other documents kept beside it (PDFs, Word files, text). */
  manuals: string[];
  photos: string[];
  files: string[];
  /** Its maintenance jobs (paths). */
  jobs: string[];
}

export type JobState = 'Overdue' | 'Due soon' | 'Later' | 'No date' | 'Paused' | 'Done';

export interface DoneRow {
  row: number;
  date: string | null;
  by: string;
  cost: number | null;
  notes: string;
}

export interface Job {
  path: string;
  name: string;
  every: string;
  lastDone: string | null;
  /** As written, or worked out from the last time and how often. */
  nextDue: string | null;
  /** The next day was worked out (not written). */
  worked: boolean;
  days: number | null;
  state: JobState;
  appliance: string;
  appliancePath: string | null;
  room: string;
  who: string;
  cost: number | null;
  status: string;
  done: DoneRow[];
}

export interface FinanceBillLite {
  name: string;
  due: string | null;
  amount: number | null;
}

/** A utility row and its Finance bill are the one bill written once (30 Oct 2026): matched by the provider's name, or by what the utility is (power and electricity are the same bill). */
export function utilityBillMatch(u: { utility: string; provider: string }, bills: readonly FinanceBillLite[]): FinanceBillLite | null {
  const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const syn: Record<string, string[]> = { power: ['power', 'electricity', 'electric', 'energy'], electricity: ['power', 'electricity', 'electric', 'energy'], energy: ['power', 'electricity', 'energy'], gas: ['gas'], water: ['water'], internet: ['internet', 'nbn', 'broadband', 'wifi'], broadband: ['internet', 'nbn', 'broadband'], phone: ['phone', 'mobile', 'telstra', 'telecom'], mobile: ['phone', 'mobile'] };
  const prov = u.provider.trim().toLowerCase();
  for (const b of bills) {
    const bw = words(`${b.name}`);
    if (prov && bw.join(' ').includes(prov)) return b;
    const kinds = syn[words(u.utility)[0] ?? ''] ?? words(u.utility);
    if (kinds.some((k) => bw.includes(k))) return b;
  }
  return null;
}

export interface HouseModel {
  homes: Home[];
  appliances: Appliance[];
  jobs: Job[];
  /** Finance's bills, when Finance is on, so a utility row can point at its one bill (filled on the main side). */
  bills: FinanceBillLite[];
  /** Jobs overdue or due within the job days, soonest first. */
  due: Job[];
  /** Warranties ending within the days ahead (or ended in the last 30 days), soonest first. */
  warranties: Appliance[];
  today: string;
  remindDays: number;
  jobDays: number;
}

const GONE = /^(replaced|sold)$/i;
const DOC = /\.(pdf|docx?|txt|md|rtf|odt|pages|html?)$/i;

/** The interval a job comes round at, or null (Once). */
export function interval(every: string): { days?: number; months?: number; years?: number } | null {
  switch (knownWord(UPKEEP_EVERY, every)) {
    case 'Weekly':
      return { days: 7 };
    case 'Monthly':
      return { months: 1 };
    case 'Quarterly':
      return { months: 3 };
    case 'Half-yearly':
      return { months: 6 };
    case 'Yearly':
      return { years: 1 };
    case 'Every 2 years':
      return { years: 2 };
    case 'Every 5 years':
      return { years: 5 };
    default:
      return null;
  }
}

/** The day a job is next due after it was done on `date` (null: it doesn't come round). */
export function nextAfter(every: string, date: string): string | null {
  const i = interval(every);
  return i ? addToDay(date, i) : null;
}

const rowsOf = <T extends string>(text: string, spec: TableSpec) => readTable(text, spec).rows as Row<T>[];

export function readHome(n: HouseNote): Home {
  const p = n.props;
  const files = n.files ?? [];
  return {
    path: n.path,
    name: n.title,
    address: str(p.address),
    ownership: knownWord(OWNERSHIP, p.ownership) || '',
    movedIn: readDay(p.moved_in),
    contact: linkName(p.contact),
    rooms: rowsOf(n.content, ROOMS_TABLE),
    utilities: rowsOf(n.content, UTILITIES_TABLE),
    network: rowsOf(n.content, NETWORK_TABLE),
    notes: sectionWords(n.content, /^notes$/i),
    photos: files.filter(isImage),
    files,
  };
}

export function readAppliance(n: HouseNote, today: string, remind: number): Appliance {
  const p = n.props;
  const warranty = readDay(p.warranty);
  const warrantyDays = warranty ? daysFrom(today, warranty) : null;
  const status = knownWord(APPLIANCE_STATUSES, p.status) || 'In use';
  const files = n.files ?? [];
  return {
    path: n.path,
    name: n.title,
    kind: knownWord(APPLIANCE_KINDS, p.kind) || 'Other',
    room: str(p.room),
    make: str(p.make),
    model: str(p.model),
    serial: str(p.serial),
    purchased: readDay(p.purchased),
    price: readAmount(p.price),
    supplier: str(p.supplier),
    warranty,
    warrantyDays,
    warrantyState: warrantyDays === null ? null : warrantyDays < 0 ? 'Out of warranty' : warrantyDays <= remind ? 'Warranty ends soon' : 'Under warranty',
    status,
    history: readTable(n.content, HISTORY_TABLE).rows.map(({ row, values: v }) => {
      const date = readDay(v.date);
      return { row, date, dateWords: date ? '' : v.date, what: v.what, by: v.by, cost: readAmount(v.cost), notes: v.notes };
    }),
    manuals: files.filter((f) => DOC.test(f)),
    photos: files.filter(isImage),
    files,
    jobs: [],
  };
}

export function readJob(n: HouseNote, today: string, soon: number, appliances: { name: string; path: string }[] = []): Job {
  const p = n.props;
  const every = knownWord(UPKEEP_EVERY, p.every) || 'Yearly';
  const lastDone = readDay(p.last_done);
  const written = readDay(p.next_due);
  const nextDue = written ?? (lastDone ? nextAfter(every, lastDone) : null);
  const status = knownWord(UPKEEP_STATUSES, p.status) || 'Active';
  const days = nextDue ? daysFrom(today, nextDue) : null;
  const state: JobState = /^paused$/i.test(status) ? 'Paused' : /^done$/i.test(status) ? 'Done' : days === null ? 'No date' : days < 0 ? 'Overdue' : days <= soon ? 'Due soon' : 'Later';
  const app = linkName(p.appliance);
  const a = app ? appliances.find((x) => x.name.toLowerCase() === app.toLowerCase()) : undefined;
  return {
    path: n.path,
    name: n.title,
    every,
    lastDone,
    nextDue,
    worked: !written && !!nextDue,
    days,
    state,
    appliance: a?.name ?? app,
    appliancePath: a?.path ?? null,
    room: str(p.room),
    who: linkName(p.who),
    cost: readAmount(p.cost),
    status,
    done: readTable(n.content, DONE_TABLE).rows.map(({ row, values: v }) => ({ row, date: readDay(v.date), by: v.by, cost: readAmount(v.cost), notes: v.notes })),
  };
}

/** Homes, appliances and jobs from their notes, as of `today`; warranties said `remindDays` ahead and jobs `jobDays`. */
export function houseModel(notes: readonly HouseNote[], today: Date | string = new Date(), remindDays = 60, jobDays = 14): HouseModel {
  const t = todayOf(today);
  const homes = notes.filter((n) => n.type === 'house').map(readHome).sort((a, b) => a.name.localeCompare(b.name));
  const appliances = notes
    .filter((n) => n.type === 'appliance')
    .map((n) => readAppliance(n, t, remindDays))
    .sort((a, b) => Number(GONE.test(a.status)) - Number(GONE.test(b.status)) || a.room.localeCompare(b.room) || a.name.localeCompare(b.name));
  const jobs = notes
    .filter((n) => n.type === 'upkeep')
    .map((n) => readJob(n, t, jobDays, appliances))
    .sort((a, b) => (a.nextDue === null ? 1 : 0) - (b.nextDue === null ? 1 : 0) || (a.nextDue ?? '').localeCompare(b.nextDue ?? '') || a.name.localeCompare(b.name));
  for (const j of jobs) if (j.appliancePath) appliances.find((a) => a.path === j.appliancePath)?.jobs.push(j.path);
  const due = jobs.filter((j) => j.state === 'Overdue' || j.state === 'Due soon');
  const warranties = appliances.filter((a) => !GONE.test(a.status) && a.warrantyDays !== null && a.warrantyDays <= remindDays && a.warrantyDays >= -30).sort((a, b) => a.warranty!.localeCompare(b.warranty!));
  return { homes, appliances, jobs, due, warranties, today: t, remindDays, jobDays, bills: [] };
}

/** "Due in 5 days (Thu 29 Oct)", "Overdue by 3 days", "Paused". */
export function jobWords(j: Pick<Job, 'state' | 'days' | 'nextDue'>, today: string): string {
  if (j.state === 'Paused') return 'Paused';
  if (j.state === 'Done') return 'Done';
  if (j.days === null || !j.nextDue) return 'No day yet';
  if (j.days < 0) return `Overdue by ${plural(-j.days, 'day')}`;
  return `Due ${whenWords(j.days)}${j.days > 1 ? ` (${dayWords(j.nextDue, today)})` : ''}`;
}

/** "Warranty ends in 40 days (Wed 2 Dec)", "Warranty ended 3 days ago". */
export function warrantyWords(a: Pick<Appliance, 'warranty' | 'warrantyDays'>, today: string): string {
  if (!a.warranty || a.warrantyDays === null) return '';
  return a.warrantyDays < 0 ? `Warranty ended ${whenWords(a.warrantyDays)}` : `Warranty ends ${whenWords(a.warrantyDays)} (${dayWords(a.warranty, today)})`;
}

/** An appliance's name from what it is ("Brightline dishwasher", "Fridge"). */
export function applianceName(a: { kind?: unknown; make?: unknown; model?: unknown }): string {
  const kind = str(a.kind);
  const make = str(a.make);
  if (make && kind && kind !== 'Other') return `${make} ${kind.toLowerCase()}`;
  return [make, str(a.model)].filter(Boolean).join(' ') || kind || 'Appliance';
}

// ── New notes ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface HomeInput {
  address?: string;
  ownership?: string;
  moved_in?: string | null;
}
export function newHomeText(h: HomeInput): string {
  return noteText(
    'house',
    [
      ['address', str(h.address)],
      ['ownership', knownWord(OWNERSHIP, h.ownership) || 'Owned'],
      ['moved_in', readDay(h.moved_in)],
      ['contact', ''],
    ],
    `${emptyTable(ROOMS_TABLE)}${emptyTable(UTILITIES_TABLE)}${emptyTable(NETWORK_TABLE)}## Notes\n\nPasswords for the Wi-Fi, router and accounts are kept in Secrets, not here.\n`,
  );
}

export interface ApplianceInput {
  kind?: string;
  room?: string;
  make?: string;
  model?: string;
  serial?: string;
  purchased?: string | null;
  price?: string | number | null;
  supplier?: string;
  warranty?: string | null;
  note?: string;
}
export function newApplianceText(a: ApplianceInput): string {
  const price = readAmount(a.price);
  return noteText(
    'appliance',
    [
      ['kind', knownWord(APPLIANCE_KINDS, a.kind) || 'Other'],
      ['room', str(a.room)],
      ['make', str(a.make)],
      ['model', str(a.model)],
      ['serial', str(a.serial)],
      ['purchased', readDay(a.purchased)],
      ['price', price],
      ['supplier', str(a.supplier)],
      ['warranty', readDay(a.warranty)],
      ['status', 'In use'],
    ],
    `${emptyTable(HISTORY_TABLE)}## Notes\n\n${a.note ? `${a.note}\n` : ''}`,
  );
}

export interface JobInput {
  every?: string;
  last_done?: string | null;
  next_due?: string | null;
  appliance?: string;
  room?: string;
  who?: string;
  cost?: string | number | null;
  note?: string;
}
export function newJobText(j: JobInput): string {
  const every = knownWord(UPKEEP_EVERY, j.every) || 'Yearly';
  const last = readDay(j.last_done);
  const next = readDay(j.next_due) ?? (last ? nextAfter(every, last) : null);
  return noteText(
    'upkeep',
    [
      ['every', every],
      ['last_done', last],
      ['next_due', next],
      ['appliance', linkName(j.appliance) ? `[[${linkName(j.appliance)}]]` : ''],
      ['room', str(j.room)],
      ['who', str(j.who)],
      ['cost', readAmount(j.cost)],
      ['status', 'Active'],
    ],
    `${emptyTable(DONE_TABLE, last ? [{ date: last }] : [])}## Notes\n\n${j.note ? `${j.note}\n` : ''}`,
  );
}

/** Seasonal starter packs (30 Oct 2026): the jobs that come round each season, in one tap, dated from the season's start. */
export const SEASONAL_PACKS: { id: string; name: string; month: number; jobs: { what: string; every: string; afterDays: number }[] }[] = [
  { id: 'before-winter', name: 'Before winter', month: 5, jobs: [{ what: 'Clean the gutters', every: 'Yearly', afterDays: 0 }, { what: 'Heater service', every: 'Yearly', afterDays: 14 }, { what: 'Check the smoke alarms', every: 'Half-yearly', afterDays: 7 }, { what: 'Check window and door seals', every: 'Yearly', afterDays: 21 }] },
  { id: 'before-summer', name: 'Before summer', month: 11, jobs: [{ what: 'Air conditioner service', every: 'Yearly', afterDays: 0 }, { what: 'Check the smoke alarms', every: 'Half-yearly', afterDays: 7 }, { what: 'Clean the outdoor area', every: 'Yearly', afterDays: 14 }] },
  { id: 'spring', name: 'Spring', month: 9, jobs: [{ what: 'Clean the gutters', every: 'Yearly', afterDays: 0 }, { what: 'Garden tidy', every: 'Yearly', afterDays: 7 }, { what: 'Check the smoke alarms', every: 'Half-yearly', afterDays: 14 }] },
  { id: 'autumn', name: 'Autumn', month: 3, jobs: [{ what: 'Clean the gutters', every: 'Yearly', afterDays: 0 }, { what: 'Heater service', every: 'Yearly', afterDays: 14 }, { what: 'Check roof for leaks', every: 'Yearly', afterDays: 21 }] },
];

/** The season's pack now (packs uplift item 8): the pack whose month last came round, not the next calendar
 *  start (which offered Autumn in November). */
export function currentSeasonalPack(today: string): { id: string; name: string; month: number; jobs: { what: string; every: string; afterDays: number }[] } {
  const month = Number(today.slice(5, 7));
  const past = SEASONAL_PACKS.filter((p) => p.month <= month).sort((a, b) => b.month - a.month);
  if (past.length) return past[0];
  return [...SEASONAL_PACKS].sort((a, b) => b.month - a.month)[0];
}

/** A pack's jobs as new jobs, dated sensibly from its next season start, leaving out any already there by name. */
export function planSeasonalPack(packId: string, today: string, existing: readonly string[]): { pack: string; jobs: (JobInput & { name: string })[]; skipped: string[] } {
  const pack = SEASONAL_PACKS.find((p) => p.id === packId) ?? SEASONAL_PACKS[0];
  const have = new Set(existing.map((x) => x.toLowerCase()));
  const year = Number(today.slice(0, 4));
  let start = `${year}-${String(pack.month).padStart(2, '0')}-01`;
  if (start < today) start = `${year + 1}-${String(pack.month).padStart(2, '0')}-01`;
  const jobs: (JobInput & { name: string })[] = [];
  const skipped: string[] = [];
  for (const j of pack.jobs) {
    if (have.has(j.what.toLowerCase())) { skipped.push(j.what); continue; }
    jobs.push({ name: j.what, every: j.every, next_due: addToDay(start, { days: j.afterDays }), note: `From the ${pack.name} starter pack.` });
  }
  return { pack: pack.name, jobs, skipped };
}

/** The claim or extend checklist when a warranty is nearing its end (30 Oct 2026): plain steps, in order, using what is kept with the appliance. */
export function warrantyChecklist(a: Pick<Appliance, 'name' | 'warranty' | 'warrantyDays' | 'manuals' | 'supplier'>, today: string): string[] {
  if (!a.warranty || a.warrantyDays === null) return [];
  const steps = [`Use it this week and write down anything that is not working properly, before ${dayWords(a.warranty, today)}.`];
  steps.push(a.manuals.length ? `Keep its receipt and manual handy: ${plural(a.manuals.length, 'file is', 'files are')} kept with the ${a.name}.` : `Find its receipt: it proves the day you bought it. Add a photo of it to the ${a.name} so it is kept with it.`);
  if (a.supplier) steps.push(`Ring ${a.supplier} before the warranty ends and ask what a fault visit costs under warranty, and what extending it would cost.`);
  else steps.push('Ring where you bought it before the warranty ends and ask what a fault visit costs under warranty, and what extending it would cost.');
  steps.push(a.warrantyDays < 0 ? 'The warranty has ended: ask anyway, in writing, and keep the answer with it.' : 'Decide before it ends: claim, extend, or let it go. Nothing is booked or paid without your say.');
  return steps;
}

/** What marking a job done writes: its last and next days (or Done, for a job that doesn't come round) and a Done row. */
export function doneChange(j: Pick<Job, 'every'>, input: { date: string; by?: string; cost?: number | null; notes?: string }): { props: Record<string, string | null>; row: Record<string, string> } {
  const next = nextAfter(j.every, input.date);
  return {
    props: { last_done: input.date, next_due: next, ...(next ? {} : { status: 'Done' }) },
    row: { date: input.date, by: str(input.by).slice(0, 80), cost: input.cost !== null && input.cost !== undefined ? String(input.cost) : '', notes: str(input.notes).slice(0, 200) },
  };
}

// ── Records for the views ────────────────────────────────────────────────────────────────────────────────────────────

export function houseRecords(m: HouseModel): WsRecord[] {
  const out: WsRecord[] = [];
  for (const h of m.homes) {
    for (const r of h.rooms) out.push({ id: `${h.path}::room:${r.row}`, kind: 'room', title: r.values.room || `Room ${r.row + 1}`, path: h.path, fields: { home: h.name, floor: r.values.floor || null, notes: r.values.notes || null, appliances: m.appliances.filter((a) => r.values.room && a.room.toLowerCase() === r.values.room.toLowerCase()).length }, links: [], ref: { at: 'table', heading: ROOMS_TABLE.name, row: r.row, cols: {} } });
    for (const u of h.utilities) out.push({ id: `${h.path}::utility:${u.row}`, kind: 'utility', title: u.values.utility || `Utility ${u.row + 1}`, path: h.path, fields: { home: h.name, provider: u.values.provider || null, plan: u.values.plan || null, account: u.values.account || null, phone: u.values.phone || null }, links: [], ref: { at: 'table', heading: UTILITIES_TABLE.name, row: u.row, cols: {} } });
  }
  for (const a of m.appliances)
    out.push({
      id: `${a.path}::appliance`,
      kind: 'appliance',
      title: a.name,
      path: a.path,
      fields: { appliance_kind: a.kind, room: a.room || null, make: a.make || null, model: a.model || null, serial: a.serial || null, purchased: a.purchased, price: a.price, supplier: a.supplier || null, warranty: a.warranty, warranty_status: a.warrantyState, status: a.status, manuals: a.manuals.length || null },
      links: [],
      ref: { at: 'note', path: a.path },
    });
  for (const j of m.jobs)
    out.push({
      id: `${j.path}::upkeep`,
      kind: 'upkeep',
      title: j.name,
      path: j.path,
      fields: { every: j.every, last_done: j.lastDone, next_due: j.nextDue, appliance: j.appliance || null, room: j.room || null, who: j.who || null, cost: j.cost, status: j.state },
      links: j.appliancePath ? [`${j.appliancePath}::appliance`] : [],
      ref: { at: 'note', path: j.path },
    });
  return out;
}

export const HOUSE_EDITABLE: Record<string, string[]> = {
  appliance: APPLIANCE_PROPS.map((p) => p.field),
  upkeep: ['every', 'last_done', 'next_due', 'appliance', 'room', 'who', 'cost'],
  room: ['title', 'floor', 'notes'],
  utility: ['title', 'provider', 'plan', 'account', 'phone'],
};
/** A table record's field → its column's key. */
export const HOUSE_CELL: Record<string, Record<string, string>> = { room: { title: 'room' }, utility: { title: 'utility' } };

export function houseSectionViews(section: string): RecordViewDef[] {
  const v = (kinds: WsRecord['kind'][], layout: RecordViewDef['layout'], title: string, patch: Partial<RecordViewDef> = {}): RecordViewDef => ({ ...defaultRecordView(kinds, layout, title), scope: 'vault', showDone: true, ...patch });
  switch (section) {
    case 'appliances':
      return [v(['appliance'], 'table', 'Every appliance', { fields: ['appliance_kind', 'make', 'model', 'serial', 'warranty', 'warranty_status', 'manuals', 'status'], groupBy: 'room', sort: { field: 'title', dir: 'asc' } })];
    case 'maintenance':
      return [v(['upkeep'], 'table', 'Every job', { fields: ['every', 'last_done', 'next_due', 'status', 'appliance', 'who', 'cost'], sort: { field: 'next_due', dir: 'asc' } }), v(['upkeep'], 'calendar', 'When each job is next due', { dateField: 'next_due', fields: ['room'] })];
    case 'warranties':
      return [v(['appliance'], 'timeline', 'When each warranty ends', { dateField: 'warranty', fields: ['room'], filters: [{ field: 'warranty', op: 'not-empty' }, { field: 'status', op: 'is-not', value: 'Sold' }] }), v(['appliance'], 'table', 'Warranties', { fields: ['room', 'purchased', 'supplier', 'warranty', 'warranty_status'], filters: [{ field: 'warranty', op: 'not-empty' }], sort: { field: 'warranty', dir: 'asc' } })];
  }
  return [];
}

// ── The agent tools ──────────────────────────────────────────────────────────────────────────────────────────────────

export const HOUSE_TOOLS: WorkToolDef[] = [
  {
    name: 'home_info',
    module: 'house',
    write: false,
    title: 'Your home',
    step: 'Read your home’s details',
    description: 'The person’s home from their House module (Ironleaf): its address, rooms, utilities (provider, plan, account reference, phone) and the printer and network notes (router, Wi-Fi name, printer model, ink). Passwords are never in it (they live in Secrets). Use it for "who is our electricity with?", "what printer do we have?".',
    parameters: { type: 'object', properties: { topic: { type: 'string', description: 'Words to narrow it: "utilities", "network", "printer", a room or a provider.' } }, additionalProperties: false },
  },
  {
    name: 'home_appliance_find',
    module: 'house',
    write: false,
    title: 'Find an appliance',
    step: 'Looked through your appliances',
    description: 'Find appliances in House by words (name, make, model, serial), kind or room: each with room, model and serial, when it was bought and where, its warranty, its manuals kept, its service history and maintenance jobs. Use it for "is the dishwasher still under warranty?", "what model is the fridge?".',
    parameters: { type: 'object', properties: { query: { type: 'string' }, kind: { type: 'string', enum: [...APPLIANCE_KINDS] }, room: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'home_maintenance_due',
    module: 'house',
    write: false,
    title: 'Maintenance due',
    step: 'Checked the maintenance due at home',
    description: 'House maintenance jobs that are overdue or due soon (and when each was last done), plus warranties ending. Use it for "what needs doing around the house?", "when were the gutters last cleaned?".',
    parameters: { type: 'object', properties: { days: { type: 'number', description: 'How many days ahead (14 unless said).' } }, additionalProperties: false },
  },
  {
    name: 'home_appliance_add',
    module: 'house',
    write: true,
    title: 'Add an appliance',
    step: 'Added an appliance to House',
    description: 'Add an appliance to House with what the person gave: its kind, make, model, serial, room, when and where it was bought, the price and the day its warranty ends. Never guess a serial, a price or a day.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...APPLIANCE_KINDS] },
        make: { type: 'string' },
        model: { type: 'string' },
        serial: { type: 'string' },
        room: { type: 'string' },
        purchased: { type: 'string', description: 'YYYY-MM-DD' },
        price: { type: 'number' },
        supplier: { type: 'string', description: 'Where it was bought.' },
        warranty: { type: 'string', description: 'The day the warranty ends, YYYY-MM-DD.' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'home_maintenance_add',
    module: 'house',
    write: true,
    title: 'Add a maintenance job',
    step: 'Added a maintenance job to House',
    description: 'Add a job that comes round to House’s maintenance schedule: what it is, how often (Weekly, Monthly, Quarterly, Half-yearly, Yearly, Every 2 years, Every 5 years or Once), when it was last done or is next due, and the appliance or room. Only days the person gave.',
    parameters: {
      type: 'object',
      properties: {
        what: { type: 'string', description: 'The job ("Clean the gutters").' },
        every: { type: 'string', enum: [...UPKEEP_EVERY] },
        last_done: { type: 'string', description: 'YYYY-MM-DD' },
        next_due: { type: 'string', description: 'YYYY-MM-DD' },
        appliance: { type: 'string', description: 'An appliance already in House.' },
        room: { type: 'string' },
        who: { type: 'string', description: 'Who does it (a tradie, a company, a person).' },
      },
      required: ['what', 'every'],
      additionalProperties: false,
    },
  },
  {
    name: 'home_seasonal_pack',
    module: 'house',
    write: true,
    title: 'Add a seasonal starter pack',
    step: 'Added a seasonal starter pack to House',
    description: 'Add a seasonal starter pack of jobs that come round to House in one go (Before winter, Before summer, Spring or Autumn), dated from the season’s start, leaving out any job already there. Use it for "get the house ready for winter".',
    parameters: { type: 'object', properties: { pack: { type: 'string', enum: ['before-winter', 'before-summer', 'spring', 'autumn'] } }, required: ['pack'], additionalProperties: false },
  },
  {
    name: 'home_maintenance_done',
    module: 'house',
    write: true,
    title: 'Mark a job done',
    step: 'Marked a maintenance job done',
    description: 'Mark a House maintenance job done (today unless the person gave a day), with who did it and what it cost when said; its next day moves on by how often it comes round.',
    parameters: { type: 'object', properties: { job: { type: 'string', description: 'The job’s name.' }, date: { type: 'string', description: 'YYYY-MM-DD' }, by: { type: 'string' }, cost: { type: 'number' }, note: { type: 'string' } }, required: ['job'], additionalProperties: false },
  },
];

export interface HouseToolInput {
  model: HouseModel;
  on: boolean;
  refused?: number;
  agent?: string;
  currency?: string;
}

const OFF = 'The House module is off in Ironleaf (Settings › Packs). Say so; don’t guess at the house, appliances or maintenance.';
/** Words that read like a secret, kept out of what an assistant is given. Fail closed (30 Oct 2026): a line that names a password, code, key, login or token in any spelling (password, pass word, wireless key, log-in, credentials and the rest) loses everything after the name, and a line that is only a name and a value loses the lot; an unrecognised shape is left out, never passed through. */
const SECRET_KEY = /\b(pass\s?word|pass\s?code|passphrase|pwd|pin|psk|wpa\d?\s*key|wireless key|network key|wi-?fi key|log[\s-]?in|user\s?name|credential|api key|access key|secret|token|auth code)s?\b/i;
/** A bare "code" or "key" reads like a secret only when its value is shaped like one ("Garage code: 1234" is; "dress
 *  code: smart casual" and "Key dates: 12 Nov" are not, 9.2). */
const BARE_CODE_KEY = /\b(code|key)\b\s*[:=–-]\s*(\S+)/i;
const SECRET_SHAPED = (v: string) => v.length >= 4 && !/\s/.test(v) && (/\d/.test(v) || /[^A-Za-z0-9]/.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v)));
export const withoutSecrets = (s: string): string => {
  const m = SECRET_KEY.exec(s);
  const left = '[left out: it reads like a password; keep it in Secrets]';
  if (!m) {
    const bare = BARE_CODE_KEY.exec(s);
    if (!bare || !SECRET_SHAPED(bare[2])) return s;
    return `${s.slice(0, bare.index).trim()} ${bare[1]}: ${left}`.trim();
  }
  const label = s.slice(0, m.index + m[0].length).replace(/[\s:=–-]+$/, '');
  return label && label.length < s.length && /[:=–-]\s*$/.test(s.slice(m.index + m[0].length, m.index + m[0].length + 3)) ? `${label}: ${left}` : s.slice(0, m.index).trim() ? `${s.slice(0, m.index).trim()} ${left}` : left;
};

export function findJob(m: HouseModel, words: unknown): Job | undefined {
  return findByName(m.jobs, words, (j) => [j.name]);
}
export function findAppliance(m: HouseModel, words: unknown): Appliance | undefined {
  return findByName(m.appliances, words, (a) => [a.name, `${a.make} ${a.model}`.trim(), a.model, a.serial]);
}

const applianceLine = (a: Appliance, m: HouseModel, cur: string) =>
  `- ${a.name}: ${a.kind}${a.room ? ` in the ${a.room.toLowerCase()}` : ''}${a.make || a.model ? `; ${[a.make, a.model].filter(Boolean).join(' ')}` : ''}${a.serial ? `; serial ${a.serial}` : ''}${a.status !== 'In use' ? `; ${a.status}` : ''}${a.purchased ? `; bought ${dayWords(a.purchased, m.today)}${a.supplier ? ` from ${a.supplier}` : ''}${a.price !== null ? ` for ${moneyWords(a.price, cur)}` : ''}` : ''}${a.warranty ? `; ${warrantyWords(a, m.today).charAt(0).toLowerCase()}${warrantyWords(a, m.today).slice(1)}` : '; no warranty day written'}${a.manuals.length ? `; ${plural(a.manuals.length, 'manual or document')} kept` : ''}${a.history.length ? `; last serviced ${a.history.filter((h) => h.date).map((h) => h.date!).sort().pop() ? dayWords(a.history.filter((h) => h.date).map((h) => h.date!).sort().pop()!, m.today) : '(no day)'}` : ''} [${a.path}]`;

/** The answer to one of the read tools (null: not one of them). */
export function answerHouseTool(input: HouseToolInput, name: string, args: Record<string, unknown> = {}): string | null {
  const tool = HOUSE_TOOLS.find((t) => t.name === name);
  if (!tool || tool.write) return null;
  if (!input.on) return OFF;
  const m = input.model;
  const cur = input.currency ?? 'AUD';
  const refused = refusedWords(input.refused, 'home note', input.agent);
  if (name === 'home_info') {
    if (!m.homes.length) return join(['No home is written in the House module yet.', refused]);
    const q = str(args.topic).toLowerCase();
    const want = (part: string) => !q || q.includes(part) || (part === 'network' && /wi-?fi|router|printer|internet|nbn/.test(q)) || (part === 'utilities' && /power|electric|gas|water|internet|phone|provider|bill/.test(q));
    const out: string[] = [];
    for (const h of m.homes) {
      out.push(`${h.name}${h.address ? `, ${h.address}` : ''}${h.ownership ? ` (${h.ownership.toLowerCase()})` : ''}${h.movedIn ? `; moved in ${dayWords(h.movedIn, m.today)}` : ''}${h.contact ? `; landlord or agent ${h.contact}` : ''}. [${h.path}]`);
      if (want('rooms') && h.rooms.length) out.push(`Rooms: ${h.rooms.map((r) => r.values.room + (r.values.floor ? ` (${r.values.floor})` : '')).join(', ')}.`);
      const utils = h.utilities.filter((u) => !q || want('utilities') || `${u.values.utility} ${u.values.provider}`.toLowerCase().includes(q));
      if (utils.length) out.push('Utilities:', ...utils.map((u) => withoutSecrets(`- ${u.values.utility}: ${[u.values.provider, u.values.plan, u.values.account && `account ${u.values.account}`, u.values.phone && `phone ${u.values.phone}`, u.values.notes].filter(Boolean).join('; ') || 'nothing written'}`)));
      const net = h.network.filter((r) => !q || want('network') || `${r.values.thing} ${r.values.details}`.toLowerCase().includes(q));
      if (net.length) out.push('Network and printers:', ...net.map((r) => withoutSecrets(`- ${r.values.thing}: ${[r.values.details, r.values.notes].filter(Boolean).join('; ') || 'nothing written'}`)));
    }
    out.push('Passwords are kept in Secrets and are never in this answer.');
    return join([...out, refused]);
  }
  if (name === 'home_appliance_find') {
    const q = str(args.query).toLowerCase();
    const kind = str(args.kind).toLowerCase();
    const room = str(args.room).toLowerCase();
    const list = m.appliances.filter((a) => (!q || `${a.name} ${a.make} ${a.model} ${a.serial} ${a.kind}`.toLowerCase().includes(q)) && (!kind || a.kind.toLowerCase() === kind) && (!room || a.room.toLowerCase().includes(room)));
    if (!list.length) return join([m.appliances.length ? 'No appliance matches that.' : 'No appliances yet.', refused]);
    return join([`${plural(list.length, 'appliance')}:`, ...list.slice(0, 60).map((a) => applianceLine(a, m, cur)), refused]);
  }
  if (name === 'home_maintenance_due') {
    const days = typeof args.days === 'number' && args.days > 0 ? Math.min(3650, Math.round(args.days)) : m.jobDays;
    const jobs = m.jobs.filter((j) => j.state !== 'Paused' && j.state !== 'Done' && j.days !== null && j.days <= days);
    const undated = m.jobs.filter((j) => j.state === 'No date');
    return join([
      jobs.length ? `Maintenance due in the next ${plural(days, 'day')}:` : m.jobs.length ? `No maintenance is due in the next ${plural(days, 'day')}.` : 'No maintenance jobs yet.',
      ...jobs.map((j) => `- ${j.name}: ${jobWords(j, m.today)}${j.lastDone ? `; last done ${dayWords(j.lastDone, m.today)}` : '; never marked done'}; ${j.every.toLowerCase()}${j.who ? `; ${j.who} does it` : ''}${j.appliance ? `; for the ${j.appliance}` : ''} [${j.path}]`),
      undated.length ? `With no day yet: ${undated.map((j) => j.name).join(', ')}.` : '',
      m.warranties.length ? 'Warranties ending:' : '',
      ...m.warranties.flatMap((a) => [`- ${a.name}: ${warrantyWords(a, m.today)} [${a.path}]`, ...warrantyChecklist(a, m.today).map((s) => `  - ${s}`)]),
      refused,
    ]);
  }
  return null;
}

/** home_appliance_add's note. */
export function planApplianceAdd(args: Record<string, unknown>, m: HouseModel): { name: string; text: string; words: string } {
  const kind = knownWord(APPLIANCE_KINDS, args.kind);
  if (!kind) throw new Error('An appliance needs its kind (Fridge, Dishwasher, Printer…).');
  for (const k of ['purchased', 'warranty'] as const) if (str(args[k]) && !readDay(args[k])) throw new Error(`Give the ${k === 'warranty' ? 'warranty’s end' : 'purchase day'} as YYYY-MM-DD.`);
  const serial = str(args.serial).slice(0, 80);
  if (serial && m.appliances.some((a) => a.serial && a.serial.toLowerCase() === serial.toLowerCase())) throw new Error(`An appliance with serial ${serial} is already in House.`);
  const input: ApplianceInput = { kind, make: str(args.make).slice(0, 80), model: str(args.model).slice(0, 80), serial, room: str(args.room).slice(0, 80), purchased: readDay(args.purchased), price: readAmount(args.price), supplier: str(args.supplier).slice(0, 80), warranty: readDay(args.warranty), note: 'Added by an assistant.' };
  const name = applianceName(input);
  return { name, text: newApplianceText(input), words: `Added ${name} to House${input.room ? ` (${input.room})` : ''}${input.warranty ? `, warranty to ${dayWords(input.warranty, m.today)}` : ''}.` };
}

/** home_maintenance_add's note. */
export function planJobAdd(args: Record<string, unknown>, m: HouseModel): { name: string; text: string; words: string } {
  const what = str(args.what).slice(0, 100);
  if (!what) throw new Error('Say what the job is ("Clean the gutters").');
  if (m.jobs.some((j) => j.name.toLowerCase() === what.toLowerCase())) throw new Error(`There’s already a job called ${what}.`);
  const every = knownWord(UPKEEP_EVERY, args.every);
  if (!UPKEEP_EVERY.includes(every as (typeof UPKEEP_EVERY)[number])) throw new Error('Say how often it comes round (Monthly, Yearly…).');
  for (const k of ['last_done', 'next_due'] as const) if (str(args[k]) && !readDay(args[k])) throw new Error('Give days as YYYY-MM-DD.');
  let appliance = '';
  if (str(args.appliance)) {
    const a = findAppliance(m, args.appliance);
    if (!a) throw new Error(`There is no appliance called “${str(args.appliance)}” in House. Add it first, or leave it out.`);
    appliance = a.name;
  }
  const input: JobInput = { every, last_done: readDay(args.last_done), next_due: readDay(args.next_due), appliance, room: str(args.room).slice(0, 80), who: str(args.who).slice(0, 80), note: 'Added by an assistant.' };
  const next = readDay(args.next_due) ?? (input.last_done ? nextAfter(every, input.last_done) : null);
  return { name: what, text: newJobText(input), words: `Added “${what}” to House’s maintenance, ${every.toLowerCase()}${next ? `, next due ${dayWords(next, m.today)}` : ''}.` };
}
