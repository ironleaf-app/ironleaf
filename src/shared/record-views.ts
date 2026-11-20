// Views anyone can build over records (24 Oct 2026, Workstream 1 part D): a project's actions, milestones, files or
// people, or the whole vault's actions, meetings and people, laid out as a table, a board, a list, a gallery, a
// timeline, a month calendar or a chart (bars, a line or a ring, from a count or a number field); grouped, filtered,
// sorted, with the fields the person chooses. A view is a small readable JSON file (`writeRecordView`), so it syncs with
// the vault and a hand-edited one still opens (`readRecordView` forgives what it doesn't understand).
//
// Pure: it reads records already in memory (src/shared/workspace-records.ts) and never touches a file.
// One engine (10.0 Endless Tech, v10records): formulas, summaries, rollups and chart shares work through the views
// machinery (src/shared/views.ts) over a record-to-row adapter, so notes and records add up the same way; the seven
// layouts, charts and record files keep working exactly as before.

import { isoDay, startOfDay } from './days';
import { isFault } from './formula';
import { relationTargets } from './relation-links';
import { aggregateRollup, CHART_TYPES, computeFormulas, formulaName, isFormulaKey, ROLLUP_OPS, summarize, SUMMARY_KINDS, valueOf as rowValueOf, type ChartSpec, type ChartType, type RollupDef, type Summary, type SummaryKind, type ViewRow } from './views';
import { KIND_WORDS, RECORD_KINDS, type FieldValue, type RecordKind, type WsRecord } from './workspace-records';

export const RECORD_LAYOUTS = ['table', 'board', 'list', 'gallery', 'timeline', 'calendar', 'chart'] as const;
export type RecordLayout = (typeof RECORD_LAYOUTS)[number];
export const RECORD_LAYOUT_WORDS: Record<RecordLayout, string> = { table: 'Table', board: 'Board', list: 'List', gallery: 'Gallery', timeline: 'Timeline', calendar: 'Calendar', chart: 'Chart' };

// The chart shape and shares live in the one engine now; this module keeps their names so every importer keeps working.
export { CHART_TYPES, CHART_WORDS, sharePercents, type ChartSpec, type ChartType } from './views';

export type RecordFilterOp = 'is' | 'is-not' | 'contains' | 'empty' | 'not-empty' | 'gt' | 'lt' | 'before' | 'after';
export const RECORD_FILTER_WORDS: Record<RecordFilterOp, string> = { is: 'is', 'is-not': 'is not', contains: 'contains', empty: 'is empty', 'not-empty': 'is not empty', gt: 'is more than', lt: 'is less than', before: 'is before', after: 'is after' };
export const RECORD_FILTER_OPS = Object.keys(RECORD_FILTER_WORDS) as RecordFilterOp[];
export const noValue = (op: RecordFilterOp) => op === 'empty' || op === 'not-empty';

export interface RecordFilter {
  field: string;
  op: RecordFilterOp;
  value?: string;
}
export interface RecordSort {
  field: string;
  dir: 'asc' | 'desc';
}

export interface RecordViewDef {
  version: 1;
  title: string;
  /** Records of this project (the workspace's), or of the whole vault. */
  scope: 'project' | 'vault';
  kinds: RecordKind[];
  layout: RecordLayout;
  /** Fields shown, in order (the title always comes first). */
  fields: string[];
  groupBy?: string;
  sort?: RecordSort;
  filters: RecordFilter[];
  /** Timeline and calendar: the day each record sits on (and where a bar ends). */
  dateField?: string;
  endField?: string;
  chart?: ChartSpec;
  /** Board and grouped layouts: groups folded up, and an order of the person's own. */
  collapsed?: string[];
  groupOrder?: string[];
  /** Done things (a done action, a closed risk, a finished workstream) shown too. */
  showDone?: boolean;
  /** Formula columns (one engine): a name and how it is worked out, read as formula.<name> wherever fields read. */
  formulas?: Record<string, string>;
  /** Rollup columns (one engine): across the records a relation names, what one of their fields adds up to. */
  rollups?: Record<string, RollupDef>;
  /** Summaries under a table's columns (one engine): a count, a sum, the earliest day… */
  summaries?: Record<string, SummaryKind>;
}

// ── Fields ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** money: an amount in the vault's currency (Finance's amounts, budgets, balances), shown as "$89.00" and counted as a number. */
export type FieldType = 'text' | 'number' | 'money' | 'date' | 'status' | 'person' | 'bool' | 'long';
export interface FieldInfo {
  key: string;
  label: string;
  type: FieldType;
  /** Distinct values seen (status-like and person fields), most used first. */
  values: string[];
}

/** Fields worked out from others, available on every record. */
export const VIRTUAL = { kind: 'kind', project: 'project', when: 'due_group' } as const;

const LABELS: Record<string, string> = {
  title: 'Name',
  kind: 'Kind',
  project: 'Project',
  status: 'Status',
  owner: 'Owner',
  due: 'Due',
  when: 'When (as written)',
  done: 'Done',
  workstream: 'Workstream',
  source: 'From',
  date: 'Date',
  progress: 'Progress',
  next: 'Next step',
  role: 'Role',
  company: 'Company',
  contact: 'Contact',
  impact: 'Impact',
  closed: 'Closed',
  why: 'Why',
  from: 'From',
  words: 'Words',
  purpose: 'Purpose',
  type: 'Type',
  version: 'Version',
  what: 'What it is',
  where: 'Folder',
  // Files (Wave 4 part c, src/shared/file-views.ts).
  belongs: 'Belongs to',
  by: 'Sent by',
  added: 'Added',
  area: 'Area',
  level: 'Sensitivity',
  size: 'Size',
  modified: 'Changed',
  time: 'Time',
  people: 'People',
  about: 'About',
  table: 'Table',
  log: 'Log',
  projects: 'Projects',
  due_group: 'When due',
  // Finance and Documents and ID (Wave 5).
  amount: 'Amount',
  monthly: 'A month',
  cycle: 'How often',
  category: 'Category',
  autopay: 'Autopay',
  account: 'Account',
  paid: 'Last paid',
  bill_type: 'Bill or subscription',
  change: 'Price change',
  institution: 'Institution',
  account_type: 'Type',
  balance: 'Balance',
  as_of: 'As of',
  budget: 'Budget',
  spent: 'Spent',
  left: 'Left',
  receipt: 'Receipt',
  doc_type: 'Kind',
  holder: 'Whose',
  issuer: 'Issuer',
  issued: 'Issued',
  expires: 'Expires',
  number: 'Number',
  // Home, Vehicles, Career and Travel (Wave 7 part a).
  vehicle_kind: 'Kind',
  year: 'Year',
  rego: 'Rego',
  rego_due: 'Rego due',
  insurer: 'Insurer',
  insurance_due: 'Insurance due',
  service_due: 'Next service',
  service_km: 'Next service at (km)',
  odometer: 'Odometer (km)',
  fuel_type: 'Fuel',
  vin: 'VIN',
  per100: 'Fuel use (per 100 km)',
  fuel_12m: 'Fuel, last 12 months',
  vehicle: 'Vehicle',
  litres: 'Litres',
  cost: 'Cost',
  unit_price: 'Price per litre',
  full: 'Full tank',
  station: 'Station',
  garage: 'Where',
  due_what: 'What',
  home: 'Home',
  notes: 'Notes',
  appliances: 'Appliances',
  provider: 'Provider',
  plan: 'Plan',
  appliance_kind: 'Kind',
  price: 'Price',
  supplier: 'Bought from',
  manuals: 'Manuals',
  every: 'How often',
  last_done: 'Last done',
  next_due: 'Next due',
  appliance: 'Appliance',
  who: 'Who',
  stage: 'Stage',
  applied: 'Applied',
  location: 'Location',
  work_type: 'Work type',
  salary: 'Salary',
  next_step: 'Next step',
  interviews: 'Interviews',
  cv: 'CV sent',
  letter: 'Cover letter',
  waiting: 'Days waiting',
  application: 'Application',
  interview_kind: 'Kind',
  with: 'With',
  place: 'Where',
  outcome: 'Outcome',
  written: 'Written',
  words_count: 'Words',
  used: 'Sent with',
  files_count: 'Files',
  destination: 'Destination',
  phase: 'Now',
  nights: 'Nights',
  forecast: 'Forecast',
  spent_total: 'Spent so far',
  bookings: 'Bookings',
  trip: 'Trip',
  booking_kind: 'Kind',
  until: 'Until',
  is_paid: 'Paid',
  paid_by: 'Paid by',
  // Memories and Media, Business, Systems and Home Lab, Goals and Habits, Reading, Watching and Lists (Wave 7 part b).
  list_kind: 'Kind',
  list_for: 'Whose list',
  to_do: 'To do',
  finished: 'Finished',
  by_who: 'By',
  where_on: 'Where',
  qty: 'How many',
  for_who: 'For',
  rating: 'Rating',
  link: 'Link',
  note: 'Note',
  machine_kind: 'Kind',
  service_kind: 'Kind',
  os: 'System',
  logins: 'Logins',
  runs_on: 'Runs on',
  url: 'Address',
  depends_on: 'Depends on',
  for_what: 'For',
  last_run: 'Last run',
  steps: 'Steps',
  record_kind: 'Machine or service',
  checked: 'Last checked',
  album_kind: 'Kind',
  end: 'Last day',
  videos: 'Videos',
  creative_kind: 'Kind',
  occasion: 'Occasion',
  versions: 'Versions',
  product: 'Product',
  changes: 'Changes',
  pays: 'What they pay',
  since: 'Customer since',
  renews: 'Renews',
  open_support: 'Open support',
  channel: 'Channel',
  posts: 'Posts',
  result: 'Result',
  customer: 'Customer',
  priority: 'Priority',
  age: 'Days open',
  domain_renews: 'Domain renews',
  cert_expires: 'Certificate expires',
  goal: 'Goal',
  started: 'Started',
  by_day: 'By',
  current: 'Now',
  target_value: 'Target',
  pace: 'Pace',
  milestones: 'Milestones',
  days_a_week: 'Days a week',
  streak: 'Streak',
  best: 'Best',
  this_week: 'This week',
  total: 'In all',
  mood: 'Mood',
  // The work modules (Wave 6 part b: Meetings, Weekly Updates, Sites and Equipment, Vendors, Quotes and Contracts).
  site_kind: 'Kind',
  code: 'Code',
  address: 'Address',
  rooms: 'Rooms',
  devices: 'Devices',
  patch_points: 'Patch points',
  to_patch: 'To patch',
  photos: 'Photos',
  floor: 'Floor',
  device_kind: 'Kind',
  make: 'Make',
  model: 'Model',
  serial: 'Serial',
  asset_tag: 'Asset tag',
  assigned: 'Assigned to',
  purchased: 'Purchased',
  warranty: 'Warranty ends',
  eol: 'End of life',
  warranty_status: 'Warranty',
  site: 'Site',
  room: 'Room',
  switch: 'Switch',
  port: 'Port',
  vlan: 'VLAN',
  device: 'Device',
  vendor: 'Vendor',
  email: 'Email',
  phone: 'Phone',
  website: 'Website',
  quotes: 'Quotes',
  open_value: 'Open quotes',
  contracts: 'Contracts',
  received: 'Received',
  valid_until: 'Valid until',
  reference: 'Reference',
  days_left: 'Days left',
  raised: 'Raised',
  delivery: 'Delivery',
  starts: 'Starts',
  ends: 'Ends',
  notice_by: 'Notice by',
  renewal: 'Renewal',
  period: 'Period',
  po_number: 'PO number',
  series: 'Series',
  decisions: 'Decisions',
  open_actions: 'Open actions',
  agenda: 'Agenda items',
  transcript: 'Transcript',
  meeting: 'Meeting',
  filed: 'In its project',
  cadence: 'How often',
  weekday: 'Day',
  next_date: 'Next',
  meetings: 'Meetings',
  week: 'Week',
  audience: 'Audience',
  sent: 'Sent',
  sent_by: 'Sent by',
  workstreams: 'Workstreams',
  flag: 'Flag',
  status_line: 'Status',
  blockers: 'Blockers / risks',
  measure: 'Measure',
  value: 'Value',
  unit: 'Unit',
  items: 'Items',
  orders: 'Orders',
};
const TYPES: Record<string, FieldType> = {
  status: 'status',
  owner: 'person',
  due: 'date',
  date: 'date',
  modified: 'date',
  progress: 'number',
  done: 'bool',
  closed: 'bool',
  impact: 'status',
  workstream: 'status',
  purpose: 'status',
  type: 'status',
  source: 'status',
  kind: 'status',
  project: 'status',
  due_group: 'status',
  company: 'status',
  role: 'text',
  why: 'long',
  words: 'long',
  about: 'long',
  what: 'long',
  next: 'long',
  people: 'text',
  version: 'text',
  belongs: 'text',
  by: 'status',
  added: 'date',
  area: 'status',
  level: 'status',
  size: 'text',
  contact: 'text',
  when: 'text',
  from: 'text',
  where: 'text',
  amount: 'money',
  monthly: 'money',
  balance: 'money',
  budget: 'money',
  spent: 'money',
  left: 'money',
  cycle: 'status',
  category: 'status',
  autopay: 'bool',
  paid: 'date',
  bill_type: 'status',
  account_type: 'status',
  as_of: 'date',
  doc_type: 'status',
  holder: 'text',
  issuer: 'text',
  issued: 'date',
  expires: 'date',
  change: 'text',
  receipt: 'text',
  number: 'text',
  // Home, Vehicles, Career and Travel (Wave 7 part a).
  vehicle_kind: 'status',
  year: 'number',
  rego: 'text',
  rego_due: 'date',
  insurer: 'status',
  insurance_due: 'date',
  service_due: 'date',
  service_km: 'number',
  odometer: 'number',
  fuel_type: 'status',
  vin: 'text',
  per100: 'number',
  fuel_12m: 'money',
  vehicle: 'status',
  litres: 'number',
  cost: 'money',
  unit_price: 'money',
  full: 'bool',
  station: 'text',
  garage: 'text',
  due_what: 'status',
  home: 'status',
  notes: 'text',
  appliances: 'number',
  provider: 'status',
  plan: 'text',
  appliance_kind: 'status',
  price: 'money',
  supplier: 'text',
  manuals: 'number',
  every: 'status',
  last_done: 'date',
  next_due: 'date',
  appliance: 'status',
  who: 'text',
  stage: 'status',
  applied: 'date',
  location: 'text',
  work_type: 'status',
  salary: 'text',
  next_step: 'text',
  interviews: 'number',
  cv: 'text',
  letter: 'text',
  waiting: 'number',
  application: 'status',
  interview_kind: 'status',
  with: 'text',
  place: 'text',
  outcome: 'status',
  written: 'date',
  words_count: 'number',
  used: 'number',
  files_count: 'number',
  destination: 'text',
  phase: 'status',
  nights: 'number',
  forecast: 'money',
  spent_total: 'money',
  bookings: 'number',
  trip: 'status',
  booking_kind: 'status',
  until: 'text',
  is_paid: 'bool',
  paid_by: 'text',
  // Memories and Media, Business, Systems and Home Lab, Goals and Habits, Reading, Watching and Lists (Wave 7 part b).
  list_kind: 'status',
  to_do: 'number',
  finished: 'number',
  by_who: 'text',
  where_on: 'status',
  qty: 'text',
  for_who: 'status',
  rating: 'number',
  link: 'text',
  note: 'long',
  machine_kind: 'status',
  service_kind: 'status',
  os: 'text',
  logins: 'number',
  runs_on: 'status',
  url: 'text',
  depends_on: 'text',
  for_what: 'text',
  last_run: 'date',
  steps: 'number',
  record_kind: 'status',
  checked: 'date',
  album_kind: 'status',
  end: 'date',
  videos: 'number',
  creative_kind: 'status',
  occasion: 'text',
  versions: 'number',
  product: 'status',
  changes: 'number',
  pays: 'money',
  since: 'date',
  renews: 'date',
  open_support: 'number',
  channel: 'status',
  posts: 'number',
  result: 'text',
  customer: 'status',
  priority: 'status',
  age: 'number',
  domain_renews: 'date',
  cert_expires: 'date',
  goal: 'status',
  started: 'date',
  by_day: 'date',
  current: 'number',
  target_value: 'number',
  pace: 'status',
  milestones: 'number',
  days_a_week: 'number',
  streak: 'number',
  best: 'number',
  this_week: 'number',
  total: 'number',
  mood: 'status',
  // The work modules (Wave 6 part b).
  site_kind: 'status',
  code: 'text',
  address: 'text',
  rooms: 'number',
  devices: 'number',
  patch_points: 'number',
  to_patch: 'number',
  photos: 'number',
  floor: 'text',
  device_kind: 'status',
  make: 'status',
  model: 'text',
  serial: 'text',
  asset_tag: 'text',
  assigned: 'person',
  purchased: 'date',
  warranty: 'date',
  eol: 'date',
  warranty_status: 'status',
  site: 'status',
  room: 'text',
  switch: 'text',
  port: 'text',
  vlan: 'text',
  device: 'text',
  vendor: 'status',
  email: 'text',
  phone: 'text',
  website: 'text',
  quotes: 'number',
  open_value: 'money',
  contracts: 'number',
  received: 'date',
  valid_until: 'date',
  reference: 'text',
  days_left: 'number',
  raised: 'date',
  delivery: 'date',
  starts: 'date',
  ends: 'date',
  notice_by: 'date',
  renewal: 'status',
  period: 'status',
  po_number: 'text',
  series: 'status',
  decisions: 'number',
  open_actions: 'number',
  agenda: 'number',
  transcript: 'bool',
  meeting: 'text',
  filed: 'status',
  cadence: 'status',
  weekday: 'status',
  next_date: 'date',
  meetings: 'number',
  week: 'date',
  audience: 'text',
  sent: 'date',
  sent_by: 'text',
  workstreams: 'number',
  flag: 'status',
  status_line: 'long',
  blockers: 'long',
  measure: 'status',
  value: 'number',
  unit: 'text',
  items: 'number',
  orders: 'number',
};

export function fieldLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const s = key.replace(/[_-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
}

/** The order of the "when due" groups. */
export const DUE_GROUPS = ['Overdue', 'Today', 'This week', 'Next week', 'Later', 'No date', 'Done'];

/** A record's value for a field: its own, or a field worked out (kind, project, when due). */
export function valueOf(r: WsRecord, key: string, today: Date = new Date()): FieldValue {
  if (key === 'title') return r.title;
  if (key === VIRTUAL.kind) return KIND_WORDS[r.kind].one;
  if (key === VIRTUAL.project) return r.projectName ?? null;
  if (key === VIRTUAL.when) return dueGroup(r, today);
  const v = r.fields[key];
  return v === undefined ? null : v;
}

function dueGroup(r: WsRecord, today: Date): string {
  if (r.fields.done === true || r.fields.closed === true || /^(done|closed|complete)/i.test(String(r.fields.status ?? ''))) return 'Done';
  const due = typeof r.fields.due === 'string' ? r.fields.due : typeof r.fields.date === 'string' ? r.fields.date : '';
  if (!due) return 'No date';
  const t = isoDay(startOfDay(today));
  if (due < t) return 'Overdue';
  if (due === t) return 'Today';
  const d = new Date(`${t}T00:00:00`);
  const sunday = isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + ((7 - d.getDay()) % 7)));
  const nextSunday = isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + ((7 - d.getDay()) % 7) + 7));
  if (due <= sunday) return 'This week';
  if (due <= nextSunday) return 'Next week';
  return 'Later';
}

/** The fields the records have (and the worked-out ones), each with its kind and the values seen. */
export function fieldsOf(records: WsRecord[]): FieldInfo[] {
  const seen = new Map<string, Map<string, number>>();
  const types = new Map<string, Set<string>>();
  for (const r of records)
    for (const [k, v] of Object.entries(r.fields)) {
      if (!seen.has(k)) {
        seen.set(k, new Map());
        types.set(k, new Set());
      }
      if (v === null || v === undefined || v === '') continue;
      types.get(k)!.add(typeof v);
      const m = seen.get(k)!;
      const s = String(v);
      m.set(s, (m.get(s) ?? 0) + 1);
    }
  const out: FieldInfo[] = [];
  const kinds = new Set(records.map((r) => r.kind));
  const virtual = [VIRTUAL.when, ...(kinds.size > 1 ? [VIRTUAL.kind] : []), ...(new Set(records.map((r) => r.projectName)).size > 1 ? [VIRTUAL.project] : [])];
  for (const k of virtual) {
    const m = new Map<string, number>();
    for (const r of records) {
      const s = String(valueOf(r, k) ?? '');
      if (s) m.set(s, (m.get(s) ?? 0) + 1);
    }
    seen.set(k, m);
    types.set(k, new Set(['string']));
  }
  for (const [k, m] of seen) {
    if (k === 'words') continue;
    const t = types.get(k)!;
    const values = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
    let type: FieldType = TYPES[k] ?? (t.size === 1 && t.has('number') ? 'number' : t.size === 1 && t.has('boolean') ? 'bool' : 'text');
    // A "status" written as sentences, different on every row (a table of the person's own), is words, not a status.
    if (type === 'status' && values.length > Math.max(8, records.length / 2) && values.reduce((n, v) => n + v.length, 0) / Math.max(1, values.length) > 16) type = 'text';
    if (!TYPES[k] && type === 'text' && values.length && values.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) type = 'date';
    if (!TYPES[k] && type === 'text' && values.length > 1 && values.length <= Math.max(6, records.length / 3) && values.every((v) => v.length <= 28)) type = 'status';
    if (!TYPES[k] && type === 'text' && values.length && values.reduce((n, v) => n + v.length, 0) / values.length > 48) type = 'long';
    out.push({ key: k, label: fieldLabel(k), type, values: values.slice(0, 40) });
  }
  return out;
}

// ── One engine: records as rows ─────────────────────────────────────────────────────────────────────────────────────
// Formulas, summaries and rollups work through the views machinery over this adapter, so notes and records add up the
// same way. A record reads as a row: its fields as properties, with the worked-out kind, project and when-due beside
// them (winning over same-named fields, as valueOf reads them); its name stays its file title, as notes do.

/** A record as a view row: its fields as properties with the worked-out kind, project and when-due beside them. */
export function recordRow(r: WsRecord, today: Date = new Date()): ViewRow {
  return {
    path: r.path ?? r.id,
    title: r.title,
    folder: '',
    mtime: 0,
    tags: [],
    props: { ...r.fields, [VIRTUAL.kind]: KIND_WORDS[r.kind].one, [VIRTUAL.project]: r.projectName ?? null, [VIRTUAL.when]: dueGroup(r, today) },
  };
}

/** Records as view rows with the view's formulas worked out on each (without formulas, the rows as they read). */
export function recordsAsRows(records: WsRecord[], today: Date = new Date(), formulas: Record<string, string> = {}): ViewRow[] {
  return records.map((r) => {
    const row = recordRow(r, today);
    if (Object.keys(formulas).length) row.computed = computeFormulas(row, formulas, today);
    return row;
  });
}

/** A record's value for a key: a formula's worked-out value, else the field as valueOf reads it. */
function computedAware(r: WsRecord, key: string, today: Date, computed?: Record<string, Record<string, unknown>>): unknown {
  if (computed && isFormulaKey(key)) {
    const done = computed[r.id];
    if (!done) return undefined;
    if (Object.hasOwn(done, formulaName(key))) return done[formulaName(key)];
    const hit = Object.keys(done).find((k) => k.toLowerCase() === formulaName(key).toLowerCase());
    return hit === undefined ? undefined : done[hit];
  }
  return valueOf(r, key, today);
}

/** A value as a field value for ordering and grouping: a fault or nothing reads empty, the rest as written. */
function fieldish(v: unknown): FieldValue {
  if (v === undefined || v === null || isFault(v)) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    const f = v.find((x) => x !== null && x !== undefined && x !== '');
    return f === undefined || isFault(f) ? null : String(f);
  }
  return String(v);
}

/** Records joined to one record, in the order it joins them: its links resolved to records, each once. */
export function linkedRecords(record: WsRecord, all: readonly WsRecord[]): WsRecord[] {
  const byId = new Map(all.map((r) => [r.id, r]));
  const out: WsRecord[] = [];
  for (const id of record.links) {
    const hit = byId.get(id);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/** Records a relation names: the `links` joins, or a field's values matched by id, else by title in any case. */
function resolveRecordRelation(record: WsRecord, relation: string, all: readonly WsRecord[], today: Date, computed?: Record<string, Record<string, unknown>>): WsRecord[] {
  if (relation.toLowerCase() === 'links') return linkedRecords(record, all);
  const targets = relationTargets(computedAware(record, relation, today, computed));
  if (!targets.length) return [];
  const byId = new Map(all.map((r) => [r.id, r]));
  const byTitle = new Map<string, WsRecord[]>();
  for (const r of all) {
    const t = r.title.trim().toLowerCase();
    if (!t) continue;
    const list = byTitle.get(t) ?? [];
    list.push(r);
    byTitle.set(t, list);
  }
  const out: WsRecord[] = [];
  for (const t of targets) {
    const exact = byId.get(t);
    if (exact) {
      if (!out.includes(exact)) out.push(exact);
      continue;
    }
    for (const hit of byTitle.get(t.trim().toLowerCase()) ?? []) if (!out.includes(hit)) out.push(hit);
  }
  return out;
}

/** One record's rollups worked out: each relation resolved against every record, each field read on the records it names. */
function computeOneRecordRollups(record: WsRecord, rollups: Record<string, RollupDef>, all: readonly WsRecord[], rowsById: Map<string, ViewRow>, today: Date, computed?: Record<string, Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, r] of Object.entries(rollups)) {
    const values = resolveRecordRelation(record, r.relation, all, today, computed).flatMap((rec) => {
      const row = rowsById.get(rec.id);
      if (!row) return [];
      const v = rowValueOf(row, r.field);
      return Array.isArray(v) ? v : [v];
    });
    const v = aggregateRollup(values, r.op, r.field);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

/** Columns summed up over records: the view's summaries worked out through the shared machinery. */
export function recordSummaries(records: WsRecord[], def: RecordViewDef, today: Date = new Date()): Record<string, Summary> {
  const formulas = def.formulas ?? {};
  const rows = recordsAsRows(records, today, formulas);
  const byId = new Map(records.map((r, i) => [r.id, rows[i]] as const));
  const computed = Object.keys(formulas).length ? Object.fromEntries(records.map((r, i) => [r.id, rows[i].computed ?? {}])) : undefined;
  const rollups = def.rollups ?? {};
  if (Object.keys(rollups).length) records.forEach((r, i) => (rows[i].rolled = computeOneRecordRollups(r, rollups, records, byId, today, computed)));
  const out: Record<string, Summary> = {};
  for (const [key, how] of Object.entries(def.summaries ?? {})) out[key] = summarize(rows, key, how);
  return out;
}

// ── The view file ────────────────────────────────────────────────────────────────────────────────────────────────────

export function defaultRecordView(kinds: RecordKind[], layout: RecordLayout = 'table', title = ''): RecordViewDef {
  return { version: 1, title: title || kinds.map((k) => KIND_WORDS[k].many).join(' and ') || 'Records', scope: 'project', kinds, layout, fields: [], filters: [] };
}

const str = (v: unknown, max = 120): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const strs = (v: unknown, max = 40): string[] => (Array.isArray(v) ? [...new Set(v.map((x) => str(x)).filter((x): x is string => !!x))].slice(0, max) : []);

/** A small map of names to words (formulas, summaries), anything else left out. */
function readStringMap(v: unknown, max: number, count: number): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, count)) {
    const key = k.trim().slice(0, 120);
    if (key && key !== '__proto__' && typeof x === 'string' && x.trim()) out[key] = x.trim().slice(0, max);
  }
  return out;
}

const cleanRollupName = (raw: string): string => raw.replace(/[.[\]"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

/** A view file's rollups: named, with a relation, a field and a way to add up; anything else left out. */
function readRollups(v: unknown): Record<string, RollupDef> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, RollupDef> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 30)) {
    const name = cleanRollupName(k);
    const r = (x && typeof x === 'object' && !Array.isArray(x) ? x : {}) as Record<string, unknown>;
    const relation = str(r.relation);
    const field = str(r.field);
    const op = ROLLUP_OPS.includes(r.op as RollupDef['op']) ? (r.op as RollupDef['op']) : undefined;
    if (name && relation && field && op && name !== '__proto__') out[name] = { relation, field, op };
  }
  return out;
}

/** A view file's summaries: a column key to a way to sum it up; anything else left out. */
function readSummaries(v: unknown): Record<string, SummaryKind> {
  return Object.fromEntries(Object.entries(readStringMap(v, 20, 100)).filter(([, x]) => (SUMMARY_KINDS as readonly string[]).includes(x))) as Record<string, SummaryKind>;
}

/** A view file as the person (or another app) left it; anything not understood falls back to a sensible choice. */
export function readRecordView(text: string): { def: RecordViewDef; problem: string | null } {
  let raw: unknown;
  try {
    raw = String(text ?? '').trim() ? JSON.parse(text) : {};
  } catch {
    return { def: defaultRecordView(['action']), problem: 'This view’s file couldn’t be read, so it shows actions as a table. Changing anything here writes it afresh.' };
  }
  return { def: cleanRecordView(raw), problem: null };
}

/** A view from anything (a file, a message): only what it understands kept. */
export function cleanRecordView(raw: unknown): RecordViewDef {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const kinds = strs(r.kinds).filter((k): k is RecordKind => (RECORD_KINDS as readonly string[]).includes(k));
  const layout = (RECORD_LAYOUTS as readonly string[]).includes(r.layout as string) ? (r.layout as RecordLayout) : 'table';
  const sortRaw = r.sort && typeof r.sort === 'object' ? (r.sort as Record<string, unknown>) : null;
  const chartRaw = r.chart && typeof r.chart === 'object' ? (r.chart as Record<string, unknown>) : null;
  const filters: RecordFilter[] = Array.isArray(r.filters)
    ? (r.filters as unknown[])
        .map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>) : null))
        .filter((f): f is Record<string, unknown> => !!f && !!str(f.field) && RECORD_FILTER_OPS.includes(f.op as RecordFilterOp))
        .slice(0, 20)
        .map((f) => ({ field: str(f.field)!, op: f.op as RecordFilterOp, ...(f.value !== undefined && f.value !== null && String(f.value).trim() ? { value: String(f.value).slice(0, 200) } : {}) }))
    : [];
  const def: RecordViewDef = {
    version: 1,
    title: str(r.title, 80) ?? (kinds.length ? kinds.map((k) => KIND_WORDS[k].many).join(' and ') : 'Records'),
    scope: r.scope === 'vault' ? 'vault' : 'project',
    kinds: kinds.length ? kinds : ['action'],
    layout,
    fields: strs(r.fields),
    filters,
  };
  const groupBy = str(r.groupBy);
  if (groupBy) def.groupBy = groupBy;
  if (sortRaw && str(sortRaw.field)) def.sort = { field: str(sortRaw.field)!, dir: sortRaw.dir === 'desc' ? 'desc' : 'asc' };
  if (str(r.dateField)) def.dateField = str(r.dateField);
  if (str(r.endField)) def.endField = str(r.endField);
  if (chartRaw && str(chartRaw.by)) def.chart = { type: (CHART_TYPES as readonly string[]).includes(chartRaw.type as string) ? (chartRaw.type as ChartType) : 'bar', by: str(chartRaw.by)!, measure: str(chartRaw.measure) ?? 'count', ...(chartRaw.agg === 'avg' ? { agg: 'avg' as const } : {}), ...(str(chartRaw.target) ? { target: str(chartRaw.target) } : {}) };
  if (strs(r.collapsed).length) def.collapsed = strs(r.collapsed, 60);
  if (strs(r.groupOrder).length) def.groupOrder = strs(r.groupOrder, 60);
  if (r.showDone === true) def.showDone = true;
  const formulas = readStringMap(r.formulas, 2000, 30);
  if (Object.keys(formulas).length) def.formulas = formulas;
  const rollups = readRollups(r.rollups);
  if (Object.keys(rollups).length) def.rollups = rollups;
  const summaries = readSummaries(r.summaries);
  if (Object.keys(summaries).length) def.summaries = summaries;
  return def;
}

/** A view as its file: readable, keys in a steady order. */
export function writeRecordView(def: RecordViewDef): string {
  const d = cleanRecordView(def);
  const ordered: Record<string, unknown> = { version: 1, title: d.title, scope: d.scope, kinds: d.kinds, layout: d.layout, fields: d.fields };
  for (const k of ['groupBy', 'sort', 'filters', 'dateField', 'endField', 'chart', 'collapsed', 'groupOrder', 'showDone', 'formulas', 'rollups', 'summaries'] as const) {
    const v = d[k];
    if (v === undefined || (Array.isArray(v) && !v.length)) continue;
    ordered[k] = v;
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** A file name for a view's title ("All open actions" → "all-open-actions.json"). */
export function viewFileName(title: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'view';
  return `${base}.json`;
}

// ── Running a view ───────────────────────────────────────────────────────────────────────────────────────────────────

const isDone = (r: WsRecord) => r.fields.done === true || r.fields.closed === true || (r.kind === 'workstream' && /^(done|complete|closed)/i.test(String(r.fields.status ?? '')));

function compare(a: FieldValue, b: FieldValue): number {
  if (a === b) return 0;
  if (a === null || a === '') return 1;
  if (b === null || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a ? 1 : -1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Whether a record passes one filter (a formula's worked-out value when the field names one and it is given). */
export function passes(r: WsRecord, f: RecordFilter, today: Date = new Date(), computed?: Record<string, Record<string, unknown>>): boolean {
  const raw = computedAware(r, f.field, today, computed);
  const v = fieldish(raw);
  const s = v === null ? '' : String(v);
  const want = (f.value ?? '').trim();
  switch (f.op) {
    case 'empty':
      return s === '';
    case 'not-empty':
      return s !== '';
    case 'is':
      return s.toLowerCase() === want.toLowerCase() || (typeof v === 'boolean' && /^(yes|true|done)$/i.test(want) === v);
    case 'is-not':
      return s.toLowerCase() !== want.toLowerCase();
    case 'contains':
      return s.toLowerCase().includes(want.toLowerCase());
    case 'gt':
    case 'lt': {
      const a = typeof v === 'number' ? v : Number(s);
      const b = Number(want);
      if (!Number.isFinite(a) || !Number.isFinite(b) || s === '') return false;
      return f.op === 'gt' ? a > b : a < b;
    }
    case 'before':
    case 'after': {
      const t = want === 'today' ? isoDay(today) : want;
      if (!s || !t) return false;
      return f.op === 'before' ? s < t : s > t;
    }
  }
  return true;
}

export interface RecordGroup {
  key: string;
  label: string;
  rows: WsRecord[];
}
export interface RecordRun {
  rows: WsRecord[];
  /** Grouped layouts (board, or a group chosen): groups in order, empty ones the board needs kept. */
  groups: RecordGroup[];
  /** Records the filters (and done-hiding) left out. */
  hidden: number;
  /** Formulas worked out per row, by record id then name (only when the view has formulas). */
  computed?: Record<string, Record<string, unknown>>;
  /** Rollups worked out per row, by record id then name (only when the view has rollups). */
  rolled?: Record<string, Record<string, unknown>>;
}

/** The order of a group's values: statuses as people read them, the "when due" buckets, then the rest. */
const STATUS_ORDER = ['not started', 'idea', 'planning', 'planned', 'open', 'next', 'today', 'in progress', 'active', 'due today', 'on track', 'at risk', 'late', 'overdue', 'blocked', 'on hold', 'off track', 'passed', 'done', 'closed', 'complete'];
const IMPACT_ORDER = ['critical', 'high', 'medium', 'low'];
function groupRank(field: string, key: string): number {
  const k = key.toLowerCase();
  if (field === VIRTUAL.when) return DUE_GROUPS.indexOf(key);
  if (field === 'impact') {
    const i = IMPACT_ORDER.indexOf(k);
    return i < 0 ? 50 : i;
  }
  const i = STATUS_ORDER.findIndex((s) => k === s || k.startsWith(`${s}:`) || k.startsWith(`${s} `));
  return i < 0 ? 100 : i;
}

/** Records through a view: kinds, filters, done ones (unless shown), sort, groups, formulas and rollups worked out. */
export function runRecordView(records: WsRecord[], def: RecordViewDef, today: Date = new Date()): RecordRun {
  // Which table a row belongs to is what the view is of, not a filter: rows of other tables aren't "hidden".
  const ofKind = records.filter((r) => def.kinds.includes(r.kind) && def.filters.every((f) => f.field !== 'table' || passes(r, f, today)));
  const formulas = def.formulas ?? {};
  const rowsAsRows = Object.keys(formulas).length ? recordsAsRows(records, today, formulas) : null;
  const computed = rowsAsRows ? Object.fromEntries(records.map((r, i) => [r.id, rowsAsRows[i].computed ?? {}])) : undefined;
  let rows = ofKind.filter((r) => def.filters.every((f) => f.field === 'table' || passes(r, f, today, computed)));
  const filtered = rows.length;
  if (!def.showDone && def.layout !== 'chart' && !(def.groupBy && def.layout === 'board' && /status|due_group/.test(def.groupBy))) rows = rows.filter((r) => !isDone(r));
  const hidden = ofKind.length - filtered + (filtered - rows.length);
  if (def.sort) {
    const { field, dir } = def.sort;
    rows = [...rows].sort((a, b) => {
      const c = compare(fieldish(computedAware(a, field, today, computed)), fieldish(computedAware(b, field, today, computed)));
      return dir === 'desc' ? -c : c;
    });
  }
  const groups: RecordGroup[] = [];
  if (def.groupBy) {
    const by = new Map<string, WsRecord[]>();
    for (const r of rows) {
      const v = fieldish(computedAware(r, def.groupBy, today, computed));
      const k = v === null || v === '' ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(r);
    }
    // The person's order first; workstreams (or phases) in the order the project keeps them.
    const order = def.groupOrder?.length ? def.groupOrder : def.groupBy === 'workstream' ? records.filter((r) => r.kind === 'workstream').map((r) => r.title) : [];
    const keys = [...by.keys()].sort((a, b) => {
      if (a === '' || b === '') return a === '' ? 1 : -1;
      const ia = order.findIndex((o) => o.toLowerCase() === a.toLowerCase());
      const ib = order.findIndex((o) => o.toLowerCase() === b.toLowerCase());
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      return groupRank(def.groupBy!, a) - groupRank(def.groupBy!, b) || a.localeCompare(b, undefined, { numeric: true });
    });
    for (const k of keys) groups.push({ key: k, label: k || `No ${fieldLabel(def.groupBy).toLowerCase()}`, rows: by.get(k)! });
  }
  const rollups = def.rollups ?? {};
  let rolled: Record<string, Record<string, unknown>> | undefined;
  if (Object.keys(rollups).length) {
    const allRows = rowsAsRows ?? recordsAsRows(records, today, formulas);
    const byId = new Map(allRows.map((row, i) => [records[i].id, row] as const));
    rolled = Object.fromEntries(rows.map((r) => [r.id, computeOneRecordRollups(r, rollups, records, byId, today, computed)]));
  }
  return { rows, groups, hidden, ...(computed ? { computed } : {}), ...(rolled ? { rolled } : {}) };
}

// ── Charts ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ChartPoint {
  label: string;
  value: number;
  /** The records behind it (a bar or slice opens them). */
  ids: string[];
  /** The target field added up for it (ChartSpec.target), when the chart has one. */
  target?: number;
}
export interface ChartData {
  points: ChartPoint[];
  /** In words: "Actions by status", "Weight over time (average)". */
  caption: string;
  total: number;
  /** The measure's unit word ("actions", "kg"…): records counted, or the field's label. */
  unit: string;
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The chart's points: a count (or sum, or average) per value of `by`; a date `by` is read by day, week or month. */
export function chartData(records: WsRecord[], def: RecordViewDef, today: Date = new Date()): ChartData {
  const spec = def.chart ?? { type: 'bar', by: 'status', measure: 'count' };
  const run = runRecordView(records, { ...def, layout: 'chart', groupBy: undefined, sort: undefined }, today);
  const at = (r: WsRecord, key: string): FieldValue => fieldish(computedAware(r, key, today, run.computed));
  const dated = run.rows.every((r) => {
    const v = at(r, spec.by);
    return v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
  }) && run.rows.some((r) => at(r, spec.by) !== null);
  // Months written as YYYY-MM (a payment's month): in order, as "Oct 26".
  const monthly = !dated && run.rows.some((r) => at(r, spec.by) !== null) && run.rows.every((r) => {
    const v = at(r, spec.by);
    return v === null || (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v));
  });
  // Dates: by day when they span under ~2 months (a log), else by month.
  let bucket = (v: string) => v;
  let bucketLabel = (k: string) => k;
  if (monthly) bucketLabel = (k) => `${MONTH[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
  if (dated) {
    const days = run.rows.map((r) => String(at(r, spec.by) ?? '')).filter(Boolean).sort();
    const spanDays = days.length ? (Date.parse(days[days.length - 1]) - Date.parse(days[0])) / 864e5 : 0;
    if (spanDays > 62) {
      bucket = (v) => v.slice(0, 7);
      bucketLabel = (k) => `${MONTH[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
    } else bucketLabel = (k) => `${Number(k.slice(8, 10))} ${MONTH[Number(k.slice(5, 7)) - 1]}`;
  }
  const by = new Map<string, { sum: number; n: number; ids: string[]; target: number }>();
  for (const r of run.rows) {
    const raw = at(r, spec.by);
    if (raw === null || raw === '') {
      if (dated) continue;
    }
    const k = raw === null || raw === '' ? '' : typeof raw === 'boolean' ? (raw ? 'Yes' : 'No') : dated ? bucket(String(raw)) : String(raw);
    let amount = 1;
    if (spec.measure !== 'count') {
      const v = at(r, spec.measure);
      const n = typeof v === 'number' ? v : Number(v);
      if (v === null || v === '' || !Number.isFinite(n)) continue;
      amount = n;
    }
    const g = by.get(k) ?? { sum: 0, n: 0, ids: [], target: 0 };
    if (spec.target) {
      const tv = at(r, spec.target);
      const tn = typeof tv === 'number' ? tv : Number(tv);
      if (tv !== null && tv !== '' && Number.isFinite(tn)) g.target += tn;
    }
    g.sum += amount;
    g.n++;
    g.ids.push(r.id);
    by.set(k, g);
  }
  let keys = [...by.keys()];
  if (dated || monthly) keys.sort();
  else if (spec.type === 'line') keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  else keys.sort((a, b) => groupRank(spec.by, a) - groupRank(spec.by, b) || by.get(b)!.n - by.get(a)!.n || a.localeCompare(b));
  if (keys.includes('')) keys = [...keys.filter((k) => k !== ''), ''];
  const avg = spec.measure !== 'count' && spec.agg === 'avg';
  const points = keys.map((k) => {
    const g = by.get(k)!;
    const value = avg ? Math.round((g.sum / g.n) * 100) / 100 : Math.round(g.sum * 100) / 100;
    return { label: k === '' ? `No ${fieldLabel(spec.by).toLowerCase()}` : dated || monthly ? bucketLabel(k) : k, value, ids: g.ids, ...(spec.target ? { target: Math.round(g.target * 100) / 100 } : {}) };
  });
  const kindWords = def.kinds.length === 1 ? KIND_WORDS[def.kinds[0]].many : 'Records';
  const measureWords = spec.measure === 'count' ? kindWords : `${fieldLabel(spec.measure)}${avg ? ' (average)' : ''}`;
  const caption = (dated || monthly) && spec.type === 'line' ? `${measureWords} over time` : `${measureWords} by ${fieldLabel(spec.by).toLowerCase()}`;
  return { points, caption, total: points.reduce((s, p) => s + p.value, 0), unit: spec.measure === 'count' ? kindWords.toLowerCase() : fieldLabel(spec.measure) };
}

/** A sensible chart for some records: counts by status for things with a status, a number over time for log entries. */
export function suggestChart(records: WsRecord[], kinds: RecordKind[], prefer: string[] = []): ChartSpec {
  const mine = records.filter((r) => kinds.includes(r.kind));
  const fields = fieldsOf(mine);
  // The number most records have (and that changes most), the first the records list winning a tie.
  const filled = (key: string) => mine.filter((r) => typeof r.fields[key] === 'number').length;
  const spread = (key: string) => new Set(mine.map((r) => r.fields[key]).filter((v) => typeof v === 'number')).size;
  const nums = fields.filter((f) => (f.type === 'number' || f.type === 'money') && f.key !== 'progress');
  // A measure the project gives a start or a target for (start_weight, target_weight) comes first.
  const num = nums.find((f) => prefer.includes(f.key) && filled(f.key) > 0) ?? nums.reduce<FieldInfo | undefined>((best, f) => (!best || filled(f.key) * 10 + spread(f.key) > filled(best.key) * 10 + spread(best.key) ? f : best), undefined);
  const date = fields.find((f) => f.type === 'date');
  if (kinds.includes('entry') && num && date) return { type: 'line', by: date.key, measure: num.key, agg: 'avg' };
  const status = fields.find((f) => f.key === 'status' && f.values.length > 1) ?? fields.find((f) => f.type === 'status' && f.values.length > 1 && f.key !== 'source');
  return { type: status && status.values.length <= 6 ? 'donut' : 'bar', by: status?.key ?? VIRTUAL.when, measure: 'count' };
}

/** The fields a view shows by default for its kinds: the ones that say most about them. */
export function defaultFields(kinds: RecordKind[]): string[] {
  const k = kinds.length === 1 ? kinds[0] : null;
  switch (k) {
    case 'action':
      return ['owner', 'due', 'status', 'workstream'];
    case 'milestone':
      return ['date', 'status', 'workstream'];
    case 'workstream':
      return ['owner', 'status', 'progress', 'next'];
    case 'meeting':
      return ['date', 'people', 'about'];
    case 'file':
      return ['purpose', 'type', 'version', 'what'];
    case 'person':
      return ['role', 'company', 'contact'];
    case 'risk':
      return ['impact', 'owner', 'status'];
    case 'decision':
      return ['date', 'why'];
    case 'update':
      return ['date', 'from'];
    case 'note':
      return ['type', 'modified'];
    case 'bill':
      return ['amount', 'cycle', 'due', 'category', 'autopay'];
    case 'account':
      return ['institution', 'account_type', 'balance', 'as_of'];
    case 'budget':
      return ['budget', 'spent', 'left', 'progress'];
    case 'spend':
      return ['date', 'category', 'amount', 'account'];
    case 'document':
      return ['doc_type', 'holder', 'expires', 'status'];
    default:
      return kinds.includes('action') ? ['owner', 'due', 'status'] : [];
  }
}

/** The day field a timeline or calendar uses for some records. */
export function defaultDateField(records: WsRecord[], kinds: RecordKind[]): string | undefined {
  const f = fieldsOf(records.filter((r) => kinds.includes(r.kind))).filter((x) => x.type === 'date' && x.values.length);
  return (f.find((x) => x.key === 'due') ?? f.find((x) => x.key === 'date') ?? f[0])?.key;
}
