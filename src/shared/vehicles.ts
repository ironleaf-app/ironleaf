// Vehicles (Wave 7 part a, 24 Oct 2026; module 13 of the catalogue: "Cars, rego, insurance, servicing, fuel · Rego and
// service reminders · Personal"). Each vehicle is a plain note the person owns, in the module's folder inside the Home
// area:
//
//   Home/Vehicles/Family wagon.md     type: vehicle — kind, make, model, year, rego, rego_due, insurer, insurance_due,
//                                     service_due, service_km, fuel, vin, status;
//                                     "## Fuel log" | Date | Odometer | Litres | Cost | Full | Station | Notes |
//                                     "## Service history" | Date | Odometer | What | Where | Cost | Notes |
//   Home/Vehicles/Files/Family wagon/ rego papers, the insurance certificate, photos
//
// Fuel use is worked out between full tanks (every litre put in since the last full tank, over the kilometres driven
// since), so a part fill never skews it; an electric vehicle's log is in kWh. Pure: no files, no Node, no DOM.

import { defaultRecordView, type RecordViewDef } from './record-views';
import type { WsRecord } from './workspace-records';
import type { WorkToolDef } from './work-module-tools';
import { FUEL_TYPES, VEHICLE_KINDS, VEHICLE_STATUSES } from './personal-modules';
import { addToDay, dayWords, daysFrom, emptyTable, findByName, isImage, isYes, join, knownWord, moneyWords, noteText, plural, readAmount, readDay, readNumber, readTable, refusedWords, str, todayOf, whenWords, type PropSpec, type TableSpec } from './personal-records';

// ── The note's tables ────────────────────────────────────────────────────────────────────────────────────────────────

export const FUEL_TABLE: TableSpec = {
  id: 'fuel',
  name: 'Fuel log',
  heading: /^(fuel(\s+log)?|fill-?ups?|refuel(l)?ing|charging(\s+log)?)$/i,
  one: 'fill',
  title: 'date',
  fields: [
    { key: 'date', label: 'Date', col: /^(date|day|when)$/i, kind: 'date' },
    { key: 'odometer', label: 'Odometer', col: /^(odometer|odo|km|kms|kilometres|mileage)$/i, kind: 'number' },
    { key: 'litres', label: 'Litres', col: /^(litres|liters|l|kwh|volume|amount)$/i, kind: 'number' },
    { key: 'cost', label: 'Cost', col: /^(cost|price|total|\$|paid)$/i, kind: 'money' },
    { key: 'full', label: 'Full', col: /^(full|full tank|filled)$/i, kind: 'yesno' },
    { key: 'station', label: 'Station', col: /^(station|where|servo|place)$/i, kind: 'text' },
    { key: 'notes', label: 'Notes', col: /^notes?$/i, kind: 'text' },
  ],
};

export const SERVICE_TABLE: TableSpec = {
  id: 'service',
  name: 'Service history',
  heading: /^(service(s|\s+history|\s+log|\s+record)?|servicing|maintenance)$/i,
  one: 'service',
  title: 'what',
  fields: [
    { key: 'date', label: 'Date', col: /^(date|day|when)$/i, kind: 'date' },
    { key: 'odometer', label: 'Odometer', col: /^(odometer|odo|km|kms|kilometres|mileage)$/i, kind: 'number' },
    { key: 'what', label: 'What', col: /^(what|work|service|done|description|job)$/i, kind: 'text' },
    { key: 'where', label: 'Where', col: /^(where|garage|mechanic|by|workshop)$/i, kind: 'text' },
    { key: 'cost', label: 'Cost', col: /^(cost|price|total|\$|paid)$/i, kind: 'money' },
    { key: 'notes', label: 'Notes', col: /^notes?$/i, kind: 'text' },
  ],
};

export const TRIP_TABLE: TableSpec = {
  id: 'trips',
  name: 'Distance log',
  heading: /^(distance(\s+log)?|trips?|travel(\s+log)?|logbook)$/i,
  one: 'trip',
  title: 'date',
  fields: [
    { key: 'date', label: 'Date', col: /^(date|day|when)$/i, kind: 'date' },
    { key: 'reason', label: 'Reason', col: /^(reason|why|purpose|what)$/i, kind: 'text' },
    { key: 'from', label: 'From', col: /^(from|start)$/i, kind: 'text' },
    { key: 'to', label: 'To', col: /^(to|end|destination)$/i, kind: 'text' },
    { key: 'km', label: 'Km', col: /^(km|kms|kilometres|distance)$/i, kind: 'number' },
    { key: 'notes', label: 'Notes', col: /^notes?$/i, kind: 'text' },
  ],
};

export const VEHICLE_TABLES = [FUEL_TABLE, SERVICE_TABLE, TRIP_TABLE];

/** A vehicle's fields as the pages show them → the property each is written as. */
export const VEHICLE_PROPS: PropSpec[] = [
  { field: 'vehicle_kind', key: 'kind', kind: 'choice', label: 'Kind', options: VEHICLE_KINDS },
  { field: 'make', key: 'make', kind: 'text', label: 'Make' },
  { field: 'model', key: 'model', kind: 'text', label: 'Model' },
  { field: 'year', key: 'year', kind: 'number', label: 'Year' },
  { field: 'rego', key: 'rego', kind: 'text', label: 'Rego' },
  { field: 'rego_due', key: 'rego_due', kind: 'date', label: 'Rego due' },
  { field: 'insurer', key: 'insurer', kind: 'text', label: 'Insurer' },
  { field: 'insurance_due', key: 'insurance_due', kind: 'date', label: 'Insurance due' },
  { field: 'service_due', key: 'service_due', kind: 'date', label: 'Next service' },
  { field: 'service_km', key: 'service_km', kind: 'number', label: 'Next service at (km)' },
  { field: 'fuel_type', key: 'fuel', kind: 'choice', label: 'Fuel', options: FUEL_TYPES },
  { field: 'vin', key: 'vin', kind: 'text', label: 'VIN' },
  { field: 'status', key: 'status', kind: 'choice', label: 'Status', options: VEHICLE_STATUSES },
];

// ── The model ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface VehicleNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  type: string;
  files?: string[];
}

export interface Fill {
  row: number;
  date: string | null;
  dateWords: string;
  odometer: number | null;
  litres: number | null;
  cost: number | null;
  full: boolean;
  station: string;
  notes: string;
  /** Price per litre (or kWh). */
  price: number | null;
  /** Litres (kWh) per 100 km over the kilometres since the last full tank, worked out at a full tank. */
  per100: number | null;
}

export interface Service {
  row: number;
  date: string | null;
  dateWords: string;
  odometer: number | null;
  what: string;
  where: string;
  cost: number | null;
  notes: string;
}

export interface Trip {
  row: number;
  date: string | null;
  dateWords: string;
  reason: string;
  from: string;
  to: string;
  km: number | null;
  notes: string;
}

/** Distance by Australian financial year (July to June), for tax time (30 Oct 2026). */
export function distanceByYear(trips: readonly Trip[]): { year: string; km: number; trips: number }[] {
  const by = new Map<string, { km: number; trips: number }>();
  for (const t of trips) {
    if (!t.date || t.km === null) continue;
    const y = Number(t.date.slice(0, 4));
    const start = Number(t.date.slice(5, 7)) >= 7 ? y : y - 1;
    const label = `${start}-${String(start + 1).slice(2)}`;
    const cur = by.get(label) ?? { km: 0, trips: 0 };
    cur.km = Math.round((cur.km + t.km) * 10) / 10;
    cur.trips++;
    by.set(label, cur);
  }
  return [...by.entries()].map(([year, v]) => ({ year, ...v })).sort((a, b) => b.year.localeCompare(a.year));
}

export type DueWhat = 'rego' | 'insurance' | 'service';

export interface Due {
  what: DueWhat;
  /** "Rego", "Insurance", "Service". */
  label: string;
  date: string | null;
  days: number | null;
  /** Kilometres to the next service (negative: past it), when the vehicle has a km for it and an odometer reading. */
  kmLeft: number | null;
  /** Past its day (or its km). */
  late: boolean;
  /** Within the module's days ahead (or 1,000 km). */
  soon: boolean;
  /** "Rego due in 12 days (Thu 5 Nov)", "Service overdue by 340 km". */
  words: string;
}

export type Trend = 'better' | 'worse' | 'steady' | null;

export interface Vehicle {
  path: string;
  name: string;
  kind: string;
  make: string;
  model: string;
  year: number | null;
  rego: string;
  regoDue: string | null;
  insurer: string;
  insuranceDue: string | null;
  serviceDue: string | null;
  serviceKm: number | null;
  fuel: string;
  vin: string;
  status: string;
  /** "L" or "kWh". */
  unit: string;
  /** The highest odometer written in its fuel log or service history. */
  odometer: number | null;
  fills: Fill[];
  services: Service[];
  trips: Trip[];
  dues: Due[];
  lastFill: Fill | null;
  /** Average L/100 km over its last five full-tank readings. */
  per100: number | null;
  trend: Trend;
  /** Fuel spend by month, the last twelve months (oldest first). */
  months: { month: string; cost: number; litres: number }[];
  /** Kilometres a month lately, from the dated odometer readings (30 Oct 2026, 8.3 wave 1). */
  kmPerMonth: number | null;
  /** The day the service distance will be reached at that pace, when it comes before the service day. */
  serviceEta: string | null;
  /** Fuel spend over the last twelve months. */
  spend12: number;
  /** Fuel cost per 100 km over the readings with both. */
  costPer100: number | null;
  photos: string[];
  files: string[];
}

export interface DueItem extends Due {
  vehicle: Vehicle;
}

export interface VehiclesModel {
  vehicles: Vehicle[];
  /** What is due within the days ahead (or past), soonest first. */
  due: DueItem[];
  today: string;
  remindDays: number;
}

const SOLD = /^sold$/i;
const round1 = (n: number) => Math.round(n * 10) / 10;
const LABEL: Record<DueWhat, string> = { rego: 'Rego', insurance: 'Insurance', service: 'Service' };

/** "Rego due in 12 days (Thu 5 Nov)", "Insurance ran out 3 days ago", "Service due in 640 km". */
export function dueWords(d: Pick<Due, 'what' | 'date' | 'days' | 'kmLeft'>, today: string): string {
  const L = LABEL[d.what];
  const byDay = d.date && d.days !== null ? (d.days < 0 ? `${L} ${d.what === 'service' ? 'was due' : 'ran out'} ${whenWords(d.days)}` : `${L} due ${whenWords(d.days)} (${dayWords(d.date, today)})`) : '';
  const byKm = d.kmLeft !== null ? (d.kmLeft < 0 ? `${L} overdue by ${Math.abs(d.kmLeft).toLocaleString('en-AU')} km` : `${L} due in ${d.kmLeft.toLocaleString('en-AU')} km`) : '';
  if (byDay && byKm) return (d.days ?? 0) < 0 || (d.kmLeft ?? 0) < 0 ? ((d.kmLeft ?? 0) < 0 ? byKm : byDay) : (d.days ?? 999) * 50 < (d.kmLeft ?? 0) ? byDay : byKm;
  return byDay || byKm || `${L}: no day set`;
}

function readFills(text: string): Fill[] {
  const t = readTable(text, FUEL_TABLE);
  const fills: Fill[] = t.rows.map(({ row, values: v }) => {
    const date = readDay(v.date);
    const litres = readNumber(v.litres);
    const cost = readAmount(v.cost);
    return { row, date, dateWords: date ? '' : v.date, odometer: readNumber(v.odometer), litres, cost, full: v.full === '' ? true : isYes(v.full), station: v.station, notes: v.notes, price: litres && cost !== null && litres > 0 ? Math.round((cost / litres) * 1000) / 1000 : null, per100: null };
  });
  // Fuel use at each full tank: everything put in since the last full tank, over the kilometres since.
  const order = fills.filter((f) => f.odometer !== null).sort((a, b) => a.odometer! - b.odometer! || (a.date ?? '').localeCompare(b.date ?? '') || a.row - b.row);
  let lastFull: Fill | null = null;
  let since = 0;
  for (const f of order) {
    if (lastFull) since += f.litres ?? 0;
    if (!f.full) continue;
    if (lastFull && f.odometer! > lastFull.odometer!) {
      const km = f.odometer! - lastFull.odometer!;
      if (km >= 20 && since > 0) f.per100 = round1((since / km) * 100);
    }
    lastFull = f;
    since = 0;
  }
  return fills;
}

function readTrips(text: string): Trip[] {
  return readTable(text, TRIP_TABLE).rows.map(({ row, values: v }) => {
    const date = readDay(v.date);
    return { row, date, dateWords: date ? '' : v.date, reason: v.reason, from: v.from, to: v.to, km: readNumber(v.km), notes: v.notes };
  });
}

function readServices(text: string): Service[] {
  return readTable(text, SERVICE_TABLE).rows.map(({ row, values: v }) => {
    const date = readDay(v.date);
    return { row, date, dateWords: date ? '' : v.date, odometer: readNumber(v.odometer), what: v.what, where: v.where, cost: readAmount(v.cost), notes: v.notes };
  });
}

/** A vehicle's name from what it is ("2019 Corolla", "Hilux ABC123"). */
export function vehicleName(v: { make?: unknown; model?: unknown; year?: unknown; rego?: unknown; kind?: unknown }): string {
  const mm = [str(v.make), str(v.model)].filter(Boolean).join(' ');
  if (mm) return [str(v.year), mm].filter(Boolean).join(' ');
  return [str(v.kind) || 'Vehicle', str(v.rego)].filter(Boolean).join(' ');
}

export function readVehicle(n: VehicleNote, today: string, remind: number): Vehicle {
  const p = n.props;
  const fuel = knownWord(FUEL_TYPES, p.fuel) || 'Petrol';
  const unit = /^electric$/i.test(fuel) ? 'kWh' : 'L';
  const fills = readFills(n.content);
  const services = readServices(n.content);
  const trips = readTrips(n.content);
  const odos = [...fills.map((f) => f.odometer), ...services.map((s) => s.odometer), readNumber(p.odometer)].filter((x): x is number => x !== null);
  const odometer = odos.length ? Math.max(...odos) : null;
  const status = knownWord(VEHICLE_STATUSES, p.status) || 'Active';
  const regoDue = readDay(p.rego_due ?? p.registration_due);
  const insuranceDue = readDay(p.insurance_due);
  const serviceDue = readDay(p.service_due);
  const serviceKm = readNumber(p.service_km);
  const dues: Due[] = [];
  const add = (what: DueWhat, date: string | null, kmLeft: number | null = null) => {
    if (!date && kmLeft === null) return;
    const days = date ? daysFrom(today, date) : null;
    const late = (days !== null && days < 0) || (kmLeft !== null && kmLeft < 0);
    const soon = !late && ((days !== null && days <= remind) || (kmLeft !== null && kmLeft <= 1000));
    dues.push({ what, label: LABEL[what], date, days, kmLeft, late, soon, words: dueWords({ what, date, days, kmLeft }, today) });
  };
  add('rego', regoDue);
  add('insurance', insuranceDue);
  add('service', serviceDue, serviceKm !== null && odometer !== null ? Math.round(serviceKm - odometer) : null);
  const byDate = [...fills].filter((f) => f.date).sort((a, b) => a.date!.localeCompare(b.date!) || (a.odometer ?? 0) - (b.odometer ?? 0));
  const lastFill = byDate[byDate.length - 1] ?? fills[fills.length - 1] ?? null;
  const readings = byDate.filter((f) => f.per100 !== null).map((f) => f.per100!);
  const recent = readings.slice(-5);
  const per100 = recent.length ? round1(recent.reduce((a, b) => a + b, 0) / recent.length) : null;
  let trend: Trend = null;
  if (readings.length >= 4) {
    const half = Math.min(3, Math.floor(readings.length / 2));
    const now = readings.slice(-half).reduce((a, b) => a + b, 0) / half;
    const before = readings.slice(-2 * half, -half).reduce((a, b) => a + b, 0) / half;
    trend = now > before * 1.05 ? 'worse' : now < before * 0.95 ? 'better' : 'steady';
  }
  const months: Vehicle['months'] = [];
  const t = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const these = fills.filter((f) => f.date?.startsWith(ym));
    months.push({ month: ym, cost: Math.round(these.reduce((a, f) => a + (f.cost ?? 0), 0) * 100) / 100, litres: round1(these.reduce((a, f) => a + (f.litres ?? 0), 0)) });
  }
  // Cost per 100 km: the money put in between the first and last odometer readings, over the distance.
  const withOdo = fills.filter((f) => f.odometer !== null).sort((a, b) => a.odometer! - b.odometer!);
  let costPer100: number | null = null;
  if (withOdo.length >= 2) {
    const km = withOdo[withOdo.length - 1].odometer! - withOdo[0].odometer!;
    const spent = withOdo.slice(1).reduce((a, f) => a + (f.cost ?? 0), 0);
    if (km >= 100 && spent > 0) costPer100 = Math.round((spent / km) * 10000) / 100;
  }
  // Driving pace and when the service distance will be reached at it (the dated readings, oldest to newest).
  const dated = [...fills, ...services].filter((x) => x.date && x.odometer !== null).sort((a, b) => a.date!.localeCompare(b.date!) || a.odometer! - b.odometer!);
  let kmPerMonth: number | null = null;
  let serviceEta: string | null = null;
  if (dated.length >= 2) {
    const first = dated[0];
    const last = dated[dated.length - 1];
    const days = (Date.parse(`${last.date}T12:00:00Z`) - Date.parse(`${first.date}T12:00:00Z`)) / 86_400_000;
    const km = last.odometer! - first.odometer!;
    if (days >= 30 && km > 0) kmPerMonth = Math.round((km / days) * 30.44);
  }
  if (kmPerMonth && serviceKm !== null && odometer !== null && serviceKm > odometer) {
    const daysLeft = ((serviceKm - odometer) / kmPerMonth) * 30.44;
    serviceEta = addToDay(today, { days: Math.round(daysLeft) });
  }
  const files = n.files ?? [];
  return {
    path: n.path,
    name: n.title,
    kind: knownWord(VEHICLE_KINDS, p.kind) || 'Car',
    make: str(p.make),
    model: str(p.model),
    year: readNumber(p.year),
    rego: str(p.rego ?? p.registration),
    regoDue,
    insurer: str(p.insurer),
    insuranceDue,
    serviceDue,
    serviceKm,
    fuel,
    vin: str(p.vin),
    status,
    unit,
    odometer,
    fills,
    services,
    trips,
    dues,
    lastFill,
    per100,
    trend,
    months,
    kmPerMonth,
    serviceEta,
    spend12: Math.round(months.reduce((a, m) => a + m.cost, 0) * 100) / 100,
    costPer100,
    photos: files.filter(isImage),
    files,
  };
}

/** Vehicles from their notes, as of `today`, what is due said `remindDays` ahead. */
export function vehiclesModel(notes: readonly VehicleNote[], today: Date | string = new Date(), remindDays = 30): VehiclesModel {
  const t = todayOf(today);
  const vehicles = notes
    .filter((n) => n.type === 'vehicle')
    .map((n) => readVehicle(n, t, remindDays))
    .sort((a, b) => Number(SOLD.test(a.status)) - Number(SOLD.test(b.status)) || a.name.localeCompare(b.name));
  const due: DueItem[] = [];
  for (const v of vehicles) {
    if (SOLD.test(v.status)) continue;
    for (const d of v.dues) if (d.late || d.soon) due.push({ ...d, vehicle: v });
  }
  // Soonest first, by day or by km (50 km taken as a day's driving), whichever comes first.
  const near = (d: Due) => Math.min(d.days ?? Infinity, d.kmLeft !== null ? d.kmLeft / 50 : Infinity);
  due.sort((a, b) => Number(b.late) - Number(a.late) || near(a) - near(b));
  return { vehicles, due, today: t, remindDays };
}

// ── New notes ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface VehicleInput {
  kind?: string;
  make?: string;
  model?: string;
  year?: string | number;
  rego?: string;
  rego_due?: string | null;
  insurer?: string;
  insurance_due?: string | null;
  service_due?: string | null;
  service_km?: string | number | null;
  fuel?: string;
  odometer?: string | number | null;
  note?: string;
}

export function newVehicleText(v: VehicleInput): string {
  return noteText(
    'vehicle',
    [
      ['kind', knownWord(VEHICLE_KINDS, v.kind) || 'Car'],
      ['make', str(v.make)],
      ['model', str(v.model)],
      ['year', readNumber(v.year)],
      ['rego', str(v.rego).toUpperCase()],
      ['rego_due', readDay(v.rego_due)],
      ['insurer', str(v.insurer)],
      ['insurance_due', readDay(v.insurance_due)],
      ['service_due', readDay(v.service_due)],
      ['service_km', readNumber(v.service_km)],
      ['fuel', knownWord(FUEL_TYPES, v.fuel) || 'Petrol'],
      ['vin', ''],
      ['status', 'Active'],
      ...(readNumber(v.odometer) !== null ? ([['odometer', readNumber(v.odometer)]] as [string, number | null][]) : []),
    ],
    `${emptyTable(FUEL_TABLE)}${emptyTable(SERVICE_TABLE)}${emptyTable(TRIP_TABLE)}## Notes\n\n${v.note ? `${v.note}\n` : ''}`,
  );
}

// ── Records for the views ────────────────────────────────────────────────────────────────────────────────────────────

export function vehicleRecords(m: VehiclesModel): WsRecord[] {
  const out: WsRecord[] = [];
  for (const v of m.vehicles) {
    const id = `${v.path}::vehicle`;
    out.push({
      id,
      kind: 'vehicle',
      title: v.name,
      path: v.path,
      fields: { vehicle_kind: v.kind, make: v.make || null, model: v.model || null, year: v.year, rego: v.rego || null, rego_due: v.regoDue, insurer: v.insurer || null, insurance_due: v.insuranceDue, service_due: v.serviceDue, service_km: v.serviceKm, odometer: v.odometer, fuel_type: v.fuel, vin: v.vin || null, status: v.status, per100: v.per100, fuel_12m: v.spend12 || null },
      links: [],
      ref: { at: 'note', path: v.path },
    });
    for (const f of v.fills)
      out.push({
        id: `${v.path}::fuel:${f.row}`,
        kind: 'fuel',
        title: f.date ? `${v.name} · ${f.date}` : `${v.name} · fill ${f.row + 1}`,
        path: v.path,
        fields: { vehicle: v.name, date: f.date ?? (f.dateWords || null), odometer: f.odometer, litres: f.litres, cost: f.cost, unit_price: f.price, full: f.full, station: f.station || null, per100: f.per100 },
        links: [id],
        ref: { at: 'table', heading: FUEL_TABLE.name, row: f.row, cols: {} },
      });
    for (const t of v.trips)
      out.push({
        id: `${v.path}::trip:${t.row}`,
        kind: 'trip',
        title: t.reason || `Trip ${t.row + 1}`,
        path: v.path,
        fields: { vehicle: v.name, date: t.date ?? (t.dateWords || null), reason: t.reason || null, from: t.from || null, to: t.to || null, km: t.km },
        links: [id],
        ref: { at: 'table', heading: TRIP_TABLE.name, row: t.row, cols: {} },
      });
    for (const s of v.services)
      out.push({
        id: `${v.path}::service:${s.row}`,
        kind: 'servicing',
        title: s.what || `Service ${s.row + 1}`,
        path: v.path,
        fields: { vehicle: v.name, date: s.date ?? (s.dateWords || null), odometer: s.odometer, garage: s.where || null, cost: s.cost },
        links: [id],
        ref: { at: 'table', heading: SERVICE_TABLE.name, row: s.row, cols: {} },
      });
    if (!SOLD.test(v.status))
      for (const d of v.dues)
        if (d.date)
          out.push({
            id: `${v.path}::due:${d.what}`,
            kind: 'due-date',
            title: `${d.label} · ${v.name}`,
            path: v.path,
            fields: { vehicle: v.name, due_what: d.label, date: d.date, status: d.late ? 'Overdue' : d.soon ? 'Due soon' : 'Later' },
            links: [id],
            ref: { at: 'note', path: v.path },
          });
  }
  return out;
}

/** The fields of each kind that can be changed where they show. */
export const VEHICLE_EDITABLE: Record<string, string[]> = {
  vehicle: VEHICLE_PROPS.map((p) => p.field),
  fuel: ['date', 'odometer', 'litres', 'cost', 'full', 'station'],
  servicing: ['title', 'date', 'odometer', 'garage', 'cost'],
  trip: ['date', 'reason', 'from', 'to', 'km'],
};

/** A table record's field → its column's key (the rest are the same). */
export const VEHICLE_CELL: Record<string, Record<string, string>> = { servicing: { title: 'what', garage: 'where' } };

/** Each page's views as first made. */
export function vehicleSectionViews(section: string): RecordViewDef[] {
  const v = (kinds: WsRecord['kind'][], layout: RecordViewDef['layout'], title: string, patch: Partial<RecordViewDef> = {}): RecordViewDef => ({ ...defaultRecordView(kinds, layout, title), scope: 'vault', showDone: true, ...patch });
  switch (section) {
    case 'vehicles':
      return [v(['vehicle'], 'table', 'Every vehicle', { fields: ['vehicle_kind', 'rego', 'rego_due', 'insurance_due', 'service_due', 'odometer', 'per100', 'status'], sort: { field: 'title', dir: 'asc' } })];
    case 'fuel':
      return [
        v(['fuel'], 'chart', 'Use per 100 km (litres or kWh), month by month', { chart: { type: 'line', by: 'date', measure: 'per100', agg: 'avg' }, filters: [{ field: 'per100', op: 'not-empty' }] }),
        v(['fuel'], 'chart', 'Fuel and charging spend by month', { chart: { type: 'bar', by: 'date', measure: 'cost', agg: 'sum' } }),
        v(['fuel'], 'table', 'Every fill-up', { fields: ['date', 'odometer', 'litres', 'cost', 'unit_price', 'full', 'per100', 'station'], groupBy: 'vehicle', sort: { field: 'date', dir: 'desc' } }),
      ];
    case 'service':
      return [v(['servicing'], 'table', 'Service history', { fields: ['date', 'odometer', 'garage', 'cost'], groupBy: 'vehicle', sort: { field: 'date', dir: 'desc' } })];
    case 'distance':
      return [v(['trip'], 'table', 'Distance log', { fields: ['date', 'reason', 'from', 'to', 'km'], groupBy: 'vehicle', sort: { field: 'date', dir: 'desc' } })];
    case 'reminders':
      return [v(['due-date'], 'calendar', 'Due dates on the calendar', { dateField: 'date', fields: ['vehicle'] }), v(['due-date'], 'table', 'Every due date', { fields: ['vehicle', 'due_what', 'date', 'status'], sort: { field: 'date', dir: 'asc' } })];
  }
  return [];
}

// ── The agent tools ──────────────────────────────────────────────────────────────────────────────────────────────────

export const VEHICLE_TOOLS: WorkToolDef[] = [
  {
    name: 'vehicle_list',
    module: 'vehicles',
    write: false,
    title: 'Cars',
    step: 'Looked through your vehicles',
    description: 'The person’s cars and other vehicles (Ironleaf): make, model, year, rego, its rego, insurance and service days (and the km the next service is due at), the odometer, the last fill-up and its fuel use (L/100 km, or kWh for an electric one). Use it for "when is the rego due on the car?", "what is the odometer at?".',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words in the vehicle’s name, make, model or rego.' } }, additionalProperties: false },
  },
  {
    name: 'vehicle_due',
    module: 'vehicles',
    write: false,
    title: 'Rego, insurance and service due',
    step: 'Checked what is due on your vehicles',
    description: 'What is due on the person’s vehicles soon (and anything overdue): rego, insurance and servicing, by day or by km. Use it for "is anything due on the cars?", "when is the next service?".',
    parameters: { type: 'object', properties: { days: { type: 'number', description: 'How many days ahead (the module’s own, 30 unless set).' } }, additionalProperties: false },
  },
  {
    name: 'vehicle_fuel_trend',
    module: 'vehicles',
    write: false,
    title: 'Fuel use and spend',
    step: 'Looked at a vehicle’s fuel use',
    description: 'One vehicle’s fuel log: its recent fill-ups with price per litre, fuel use between full tanks (L/100 km) and whether it is getting better or worse, spend by month and cost per 100 km. Use it for "how is the car going on fuel?", "how much did we spend on fuel last month?".',
    parameters: { type: 'object', properties: { vehicle: { type: 'string', description: 'The vehicle’s name, make, model or rego (the only one when left out).' }, months: { type: 'number', description: 'How many months back (12 unless said).' } }, additionalProperties: false },
  },
  {
    name: 'vehicle_distance',
    module: 'vehicles',
    write: false,
    title: 'Distance log',
    step: 'Looked at a vehicle’s distance log',
    description: 'One vehicle’s distance log: its trips (day, reason, from, to, kilometres) and the kilometres in each financial year (July to June), ready for tax time. Use it for "how far did I drive for work this year?", "what is in the logbook?".',
    parameters: { type: 'object', properties: { vehicle: { type: 'string', description: 'The vehicle’s name, make, model or rego (the only one when left out).' } }, additionalProperties: false },
  },
  {
    name: 'vehicle_trip_add',
    module: 'vehicles',
    write: true,
    title: 'Log a trip',
    step: 'Logged a trip in Cars',
    description: 'Log a trip in a vehicle’s distance log (for tax time) with what the person gave: the day, the reason, where from and to, and the kilometres. Never guess the kilometres or the day.',
    parameters: { type: 'object', properties: { vehicle: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD (today when left out).' }, reason: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, km: { type: 'number' } }, required: ['reason', 'km'], additionalProperties: false },
  },
  {
    name: 'vehicle_add',
    module: 'vehicles',
    write: true,
    title: 'Add a vehicle',
    step: 'Added a vehicle',
    description: 'Add a vehicle with what the person gave: its name or make and model, kind, year, rego and the day it runs to, insurer and its day, the next service day or km, fuel and odometer. Never guess a rego, a day or an odometer.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Its name ("Family wagon"); its make and model when left out.' },
        kind: { type: 'string' },
        make: { type: 'string' },
        model: { type: 'string' },
        year: { type: 'string' },
        rego: { type: 'string' },
        rego_due: { type: 'string', description: 'YYYY-MM-DD' },
        insurer: { type: 'string' },
        insurance_due: { type: 'string', description: 'YYYY-MM-DD' },
        service_due: { type: 'string', description: 'YYYY-MM-DD' },
        service_km: { type: 'number' },
        fuel: { type: 'string' },
        odometer: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vehicle_fuel_add',
    module: 'vehicles',
    write: true,
    title: 'Log a fill-up',
    step: 'Logged a fill-up in Cars',
    description: 'Log a fill-up (or a charge) in a vehicle’s fuel log with what the person gave: the odometer, litres (kWh), cost, whether it was a full tank, the station and the day. Never guess the odometer, litres or cost: ask, or leave one of litres and cost out (one of the two is needed).',
    parameters: {
      type: 'object',
      properties: {
        vehicle: { type: 'string', description: 'The vehicle’s name, make, model or rego (the only one when left out).' },
        date: { type: 'string', description: 'YYYY-MM-DD (today when left out).' },
        odometer: { type: 'number' },
        litres: { type: 'number', description: 'Litres, or kWh for an electric vehicle.' },
        cost: { type: 'number' },
        full: { type: 'boolean', description: 'A full tank (true unless the person said otherwise).' },
        station: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vehicle_service_add',
    module: 'vehicles',
    write: true,
    title: 'Record a service',
    step: 'Recorded a service in Cars',
    description: 'Record a service in a vehicle’s service history (what was done, where, the odometer, cost and day), and set when the next one is due (a day and/or km) when the person says. Never guess an odometer, a cost or a day.',
    parameters: {
      type: 'object',
      properties: {
        vehicle: { type: 'string' },
        what: { type: 'string', description: 'What was done ("Logbook service", "New tyres").' },
        date: { type: 'string', description: 'YYYY-MM-DD (today when left out).' },
        odometer: { type: 'number' },
        where: { type: 'string' },
        cost: { type: 'number' },
        next_due: { type: 'string', description: 'The next service’s day, YYYY-MM-DD.' },
        next_km: { type: 'number', description: 'The odometer the next service is due at.' },
      },
      required: ['what'],
      additionalProperties: false,
    },
  },
  {
    name: 'vehicle_renewed',
    module: 'vehicles',
    write: true,
    title: 'Rego or insurance renewed',
    step: 'Saved a renewal in Cars',
    description: 'Save that a vehicle’s rego or insurance was renewed, with the day it now runs to (the person’s day, never a guess), so the reminder moves on.',
    parameters: { type: 'object', properties: { vehicle: { type: 'string' }, what: { type: 'string', enum: ['rego', 'insurance'] }, until: { type: 'string', description: 'The day it now runs to, YYYY-MM-DD.' }, insurer: { type: 'string', description: 'The insurer, if it changed.' } }, required: ['what', 'until'], additionalProperties: false },
  },
];

export interface VehicleToolInput {
  model: VehiclesModel;
  on: boolean;
  refused?: number;
  agent?: string;
  currency?: string;
}

const OFF = 'The Cars module is off in Ironleaf (Settings › Packs). Say so; don’t guess at vehicles, rego or fuel.';

export function findVehicle(m: VehiclesModel, words: unknown): Vehicle | undefined {
  const live = m.vehicles.filter((v) => !SOLD.test(v.status));
  if (!str(words)) return live.length === 1 ? live[0] : m.vehicles.length === 1 ? m.vehicles[0] : undefined;
  return findByName(m.vehicles, words, (v) => [v.name, v.rego, `${v.make} ${v.model}`.trim(), v.model]);
}
const which = (m: VehiclesModel, words: unknown) => {
  const v = findVehicle(m, words);
  if (v) return v;
  throw new Error(str(words) ? `There is no vehicle called “${str(words)}”.${m.vehicles.length ? ` Cars: ${m.vehicles.map((x) => x.name).join(', ')}.` : ''}` : m.vehicles.length ? `Which vehicle? ${m.vehicles.map((x) => x.name).join(', ')}.` : 'There are no vehicles yet.');
};

const n1 = (n: number | null) => (n === null ? '' : n.toLocaleString('en-AU', { maximumFractionDigits: 1 }));
const vehicleLine = (v: Vehicle, today: string, cur: string) =>
  `- ${v.name}${v.rego ? ` (${v.rego})` : ''}: ${v.kind}, ${v.fuel}${v.status !== 'Active' ? `, ${v.status}` : ''}${v.odometer !== null ? `; odometer ${n1(v.odometer)} km` : ''}; ${v.dues.length ? v.dues.map((d) => d.words.charAt(0).toLowerCase() + d.words.slice(1)).join('; ') : 'no rego, insurance or service days written'}${v.serviceEta && (!v.serviceDue || v.serviceEta < v.serviceDue) ? `; service distance reached about ${dayWords(v.serviceEta, today)} at ${n1(v.kmPerMonth)} km a month` : ''}${v.lastFill?.date ? `; last fill ${dayWords(v.lastFill.date, today)}${v.lastFill.litres !== null ? ` ${n1(v.lastFill.litres)} ${v.unit}` : ''}${v.lastFill.cost !== null ? ` for ${moneyWords(v.lastFill.cost, cur)}` : ''}` : ''}${v.per100 !== null ? `; ${n1(v.per100)} ${v.unit}/100 km` : ''} [${v.path}]`;

/** The answer to one of the read tools (null: not one of them). */
export function answerVehicleTool(input: VehicleToolInput, name: string, args: Record<string, unknown> = {}): string | null {
  const tool = VEHICLE_TOOLS.find((t) => t.name === name);
  if (!tool || tool.write) return null;
  if (!input.on) return OFF;
  const m = input.model;
  const cur = input.currency ?? 'AUD';
  const refused = refusedWords(input.refused, 'vehicle note', input.agent);
  if (name === 'vehicle_list') {
    const q = str(args.query).toLowerCase();
    const list = m.vehicles.filter((v) => !q || `${v.name} ${v.make} ${v.model} ${v.rego}`.toLowerCase().includes(q));
    if (!list.length) return join([m.vehicles.length ? 'No vehicle matches that.' : 'No vehicles yet.', refused]);
    return join([`${plural(list.length, 'vehicle')}:`, ...list.map((v) => vehicleLine(v, m.today, cur)), refused]);
  }
  if (name === 'vehicle_due') {
    const days = typeof args.days === 'number' && args.days > 0 ? Math.min(3650, Math.round(args.days)) : m.remindDays;
    const items = m.vehicles.filter((v) => !SOLD.test(v.status)).flatMap((v) => v.dues.filter((d) => d.late || (d.days !== null && d.days <= days) || (d.kmLeft !== null && d.kmLeft <= 1000)).map((d) => ({ v, d })));
    if (!items.length) return join([m.vehicles.length ? `Nothing is due on ${m.vehicles.length === 1 ? m.vehicles[0].name : 'the vehicles'} in the next ${plural(days, 'day')}.` : 'No vehicles yet.', refused]);
    return join([`Due in the next ${plural(days, 'day')}:`, ...items.map(({ v, d }) => `- ${v.name}${v.rego ? ` (${v.rego})` : ''}: ${d.words}${d.what === 'insurance' && v.insurer ? ` with ${v.insurer}` : ''} [${v.path}]`), refused]);
  }
  if (name === 'vehicle_distance') {
    let v: Vehicle;
    try {
      v = which(m, args.vehicle);
    } catch (e) {
      return join([(e as Error).message, refused]);
    }
    if (!v.trips.length) return join([`${v.name} has no trips in its distance log yet.`, refused]);
    const years = distanceByYear(v.trips);
    const recent = [...v.trips].filter((t) => t.date).sort((a, b) => b.date!.localeCompare(a.date!)).slice(0, 8);
    return join([
      `${v.name}: ${plural(v.trips.length, 'trip')} in its distance log.`,
      ...years.map((y) => `- ${y.year}: ${n1(y.km)} km over ${plural(y.trips, 'trip')}`),
      'Recent trips:',
      ...recent.map((t) => `- ${dayWords(t.date!, m.today)}: ${t.reason || 'Trip'}${t.from || t.to ? `, ${[t.from, t.to].filter(Boolean).join(' to ')}` : ''}${t.km !== null ? `, ${n1(t.km)} km` : ''}`),
      refused,
    ]);
  }
  if (name === 'vehicle_fuel_trend') {
    let v: Vehicle;
    try {
      v = which(m, args.vehicle);
    } catch (e) {
      return join([(e as Error).message, refused]);
    }
    const months = typeof args.months === 'number' && args.months > 0 ? Math.min(12, Math.round(args.months)) : 12;
    if (!v.fills.length) return join([`${v.name} has no ${v.unit === 'kWh' ? 'charges' : 'fill-ups'} in its ${v.unit === 'kWh' ? 'energy' : 'fuel'} log yet.`, refused]);
    const recent = [...v.fills].filter((f) => f.date).sort((a, b) => b.date!.localeCompare(a.date!)).slice(0, 8);
    const spend = v.months.slice(-months).filter((x) => x.cost > 0);
    return join([
      `${v.name}${v.rego ? ` (${v.rego})` : ''}: ${v.per100 !== null ? `${n1(v.per100)} ${v.unit}/100 km over its last ${v.unit === 'kWh' ? 'full charges' : 'full tanks'}${v.trend ? ` (${v.trend === 'steady' ? 'steady' : v.trend === 'better' ? 'using less than before' : 'using more than before'})` : ''}` : `not enough ${v.unit === 'kWh' ? 'full charges' : 'full tanks'} with odometer readings to work out ${v.unit === 'kWh' ? 'energy use' : 'fuel use'} yet`}${v.costPer100 !== null ? `; ${moneyWords(v.costPer100, cur)} per 100 km` : ''}.`,
      'Recent fill-ups:',
      ...recent.map((f) => `- ${dayWords(f.date!, m.today)}: ${f.litres !== null ? `${n1(f.litres)} ${v.unit}` : '? ' + v.unit}${f.cost !== null ? ` for ${moneyWords(f.cost, cur)}` : ''}${f.price !== null ? ` (${moneyWords(f.price, cur)}/${v.unit})` : ''}${f.odometer !== null ? ` at ${n1(f.odometer)} km` : ''}${f.full ? '' : ', part fill'}${f.per100 !== null ? `; ${n1(f.per100)} ${v.unit}/100 km` : ''}${f.station ? `; ${f.station}` : ''}`),
      spend.length ? `Spend by month: ${spend.map((x) => `${x.month} ${moneyWords(x.cost, cur, false)}`).join(', ')}.` : '',
      refused,
    ]);
  }
  return null;
}

export interface PlannedRow {
  path: string;
  table: TableSpec;
  values: Record<string, string>;
  /** Properties changed with it (the next service's day and km). */
  props?: Record<string, string | number | null>;
  words: string;
}

/** vehicle_fuel_add's row from its arguments. Throws in plain words an agent can pass on. */
export function planFuelAdd(args: Record<string, unknown>, m: VehiclesModel, cur = 'AUD'): PlannedRow {
  const v = which(m, args.vehicle);
  const date = str(args.date) ? readDay(args.date) : m.today;
  if (!date) throw new Error('Give the day as YYYY-MM-DD.');
  const odometer = readNumber(args.odometer);
  const litres = readNumber(args.litres);
  const cost = readAmount(args.cost);
  if (litres === null && cost === null) throw new Error(`A fill-up needs the ${v.unit === 'kWh' ? 'kWh' : 'litres'} or the cost.`);
  if (odometer !== null && v.odometer !== null && odometer < v.odometer - 5000) throw new Error(`The odometer ${odometer} km is well below ${v.name}’s last reading (${v.odometer} km). Check it.`);
  if (odometer !== null && v.odometer !== null && odometer > v.odometer + 5000) throw new Error(`The odometer ${odometer} km is well above ${v.name}’s last reading (${v.odometer} km). Check it.`);
  const full = args.full === false ? 'No' : 'Yes';
  const values = { date, odometer: odometer !== null ? String(odometer) : '', litres: litres !== null ? String(litres) : '', cost: cost !== null ? String(cost) : '', full, station: str(args.station).slice(0, 80), notes: '' };
  return { path: v.path, table: FUEL_TABLE, values, words: `Logged a fill-up for ${v.name}: ${litres !== null ? `${litres} ${v.unit}` : ''}${cost !== null ? ` for ${moneyWords(cost, cur)}` : ''}${odometer !== null ? ` at ${odometer.toLocaleString('en-AU')} km` : ''}${full === 'No' ? ' (part fill)' : ''}.`.replace(':  for', ': for') };
}

/** vehicle_trip_add's row, for the distance log. */
export function planTripAdd(args: Record<string, unknown>, m: VehiclesModel): PlannedRow {
  const v = which(m, args.vehicle);
  const reason = str(args.reason).slice(0, 120);
  if (!reason) throw new Error('Say why the trip was made ("Client visit", "Delivery").');
  const date = str(args.date) ? readDay(args.date) : m.today;
  if (!date) throw new Error('Give the day as YYYY-MM-DD.');
  const km = readNumber(args.km);
  if (km === null || km <= 0) throw new Error('Give the kilometres driven.');
  const values = { date, reason, from: str(args.from).slice(0, 80), to: str(args.to).slice(0, 80), km: String(km), notes: '' };
  return { path: v.path, table: TRIP_TABLE, values, words: `Logged a trip for ${v.name}: ${reason}, ${km.toLocaleString('en-AU')} km.` };
}

/** vehicle_service_add's row (and the next service's day and km). */
export function planServiceAdd(args: Record<string, unknown>, m: VehiclesModel, cur = 'AUD'): PlannedRow {
  const v = which(m, args.vehicle);
  const what = str(args.what).slice(0, 120);
  if (!what) throw new Error('Say what was done ("Logbook service", "New tyres").');
  const date = str(args.date) ? readDay(args.date) : m.today;
  if (!date) throw new Error('Give the day as YYYY-MM-DD.');
  if (str(args.next_due) && !readDay(args.next_due)) throw new Error('Give the next service’s day as YYYY-MM-DD.');
  const odometer = readNumber(args.odometer);
  const cost = readAmount(args.cost);
  const props: Record<string, string | number | null> = {};
  if (str(args.next_due)) props.service_due = readDay(args.next_due);
  if (readNumber(args.next_km) !== null) props.service_km = readNumber(args.next_km);
  const values = { date, odometer: odometer !== null ? String(odometer) : '', what, where: str(args.where).slice(0, 80), cost: cost !== null ? String(cost) : '', notes: '' };
  const next = [props.service_due ? `next due ${dayWords(String(props.service_due), m.today)}` : '', props.service_km ? `or at ${Number(props.service_km).toLocaleString('en-AU')} km` : ''].filter(Boolean).join(' ');
  return { path: v.path, table: SERVICE_TABLE, values, props, words: `Recorded ${what} for ${v.name}${cost !== null ? ` (${moneyWords(cost, cur)})` : ''}${next ? `; ${next}` : ''}.` };
}

/** vehicle_renewed's properties. */
export function planRenewed(args: Record<string, unknown>, m: VehiclesModel): { path: string; props: Record<string, string | null>; words: string } {
  const v = which(m, args.vehicle);
  const what = str(args.what).toLowerCase() === 'insurance' ? 'insurance' : str(args.what).toLowerCase() === 'rego' ? 'rego' : '';
  if (!what) throw new Error('Say whether the rego or the insurance was renewed.');
  const until = readDay(args.until);
  if (!until) throw new Error('Give the day it now runs to as YYYY-MM-DD.');
  if (daysFrom(m.today, until) < 0) throw new Error(`${dayWords(until, m.today)} has already passed: give the day it now runs to.`);
  const props: Record<string, string | null> = { [what === 'rego' ? 'rego_due' : 'insurance_due']: until };
  if (what === 'insurance' && str(args.insurer)) props.insurer = str(args.insurer).slice(0, 80);
  return { path: v.path, props, words: `${v.name}’s ${what} now runs to ${dayWords(until, m.today)}.` };
}

/** vehicle_add's new note, from its arguments. Throws in plain words an agent can pass on. */
export function planVehicleAdd(args: Record<string, unknown>, ctx: { on: boolean; model: VehiclesModel }): { name: string; text: string; words: string } {
  if (!ctx.on) throw new Error(OFF);
  for (const k of ['rego_due', 'insurance_due', 'service_due'] as const) if (str(args[k]) && !readDay(args[k])) throw new Error('Give days as YYYY-MM-DD.');
  const clean: VehicleInput = { kind: str(args.kind).slice(0, 40) || 'Car', make: str(args.make).slice(0, 60), model: str(args.model).slice(0, 60), year: str(args.year).slice(0, 4), rego: str(args.rego).slice(0, 20), rego_due: readDay(args.rego_due), insurer: str(args.insurer).slice(0, 60), insurance_due: readDay(args.insurance_due), service_due: readDay(args.service_due), service_km: readNumber(args.service_km), fuel: str(args.fuel).slice(0, 30), odometer: readNumber(args.odometer) };
  const name = str(args.name).slice(0, 80) || vehicleName(clean);
  if (!str(args.name) && !clean.make && !clean.model && !clean.rego) throw new Error('Give the vehicle a name, or its make and model.');
  if (ctx.model.vehicles.some((v) => v.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a vehicle called ${name}.`);
  const plates = (r: string) => r.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const wantPlates = plates(clean.rego ?? '');
  const samePlates = wantPlates && ctx.model.vehicles.find((v) => v.rego && plates(v.rego) === wantPlates);
  if (samePlates) throw new Error(`That registration is on ${samePlates.name} already.`);
  return { name, text: newVehicleText(clean), words: `Added ${name}.` };
}

/** The next service's day and km from a service just done (the module's own interval: 12 months and 10,000 km unless set). */
export function nextService(done: { date: string; odometer: number | null }, every: { months: number; km: number }): { date: string; km: number | null } {
  return { date: addToDay(done.date, { months: every.months }), km: done.odometer !== null && every.km > 0 ? Math.round(done.odometer + every.km) : null };
}
