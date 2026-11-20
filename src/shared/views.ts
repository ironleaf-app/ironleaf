// Views over your notes (19 Oct 2026, release 5.0.0): a saved way of looking at notes by their properties — a table, a
// board, a month calendar, a grid of cards or a plain list (cards and list added 21 Oct 2026) — kept as a small file the person owns (Views/<name>.view.json), so it syncs, copies and
// opens like any other file. The view says which notes (a folder, a tag or every note), how to lay them out, and how to
// group, date, sort and filter them; the notes themselves are never copied into it.
//
// Everything here is pure: it reads the notes' details already held in memory (their properties come from the index,
// src/main/indexer.ts) and never touches a file, so a view over thousands of notes stays quick, and the tests run it
// directly. Writing a changed property back into a note is setNoteProp below, on top of src/shared/frontmatter.ts.

import { changeProps, isMachineProp, isMap, isSeq, propKind, type PropKind, type PropValue } from './frontmatter';
import { dayWords, isoDay, readDay } from './days';
import { formulaTruthy, FormulaFault, isFault, runFormula } from './formula';
import { relationTargets, resolveRelation } from './relation-links';

export const VIEW_EXT = '.view.json';
export const VIEWS_FOLDER = 'Views';

export type ViewLayout = 'table' | 'board' | 'calendar' | 'cards' | 'list' | 'gallery' | 'timeline' | 'chart' | 'map';
// Cards and List (21 Oct 2026) sit beside Table: the three that read the same chosen properties (`columns`), so moving
// between them keeps what shows. Board and Calendar, which move notes about, come after. Map (10.0 papercuts) groups notes by the place they name, for notes that hold a place.
// Gallery, Timeline and Chart (10.0 Endless Tech, v10records: one view engine) are the record views' layouts carried
// into this engine; the note rooms draw all nine (v10records2 and the papercuts' map), so the picker offers them all.
export const LAYOUTS: ViewLayout[] = ['table', 'cards', 'list', 'board', 'calendar', 'gallery', 'timeline', 'chart', 'map'];
/** Every layout the engine reads (the rooms draw LAYOUTS, which is all of them). */
export const ALL_LAYOUTS: ViewLayout[] = ['table', 'cards', 'list', 'board', 'calendar', 'gallery', 'timeline', 'chart', 'map'];
export const LAYOUT_WORDS: Record<ViewLayout, string> = { table: 'Table', board: 'Board', calendar: 'Calendar', cards: 'Cards', list: 'List', gallery: 'Gallery', timeline: 'Timeline', chart: 'Chart', map: 'Map' };
/** A layout as words in a sentence ("shows every note as cards"). */
export const LAYOUT_PHRASE: Record<ViewLayout, string> = { table: 'a table', board: 'a board', calendar: 'a calendar', cards: 'cards', list: 'a list', gallery: 'a gallery', timeline: 'a timeline', chart: 'a chart', map: 'a map' };
/** Layouts that show the chosen properties (`columns`) and can be split into groups (`sectionBy`). */
export const usesColumns = (layout: ViewLayout): boolean => layout === 'table' || layout === 'cards' || layout === 'list' || layout === 'gallery';

/** Which notes a view shows: every note, the notes in a folder (and the folders inside it), or the notes with a tag. */
export interface ViewSource {
  kind: 'all' | 'folder' | 'tag';
  value?: string;
}

// More than and less than (numbers as numbers, days as days) and "matches the formula" joined the filters on 21 Oct 2026,
// with formulas; a .base file's comparisons and and/or/not filters come in as these (src/shared/base-file.ts).
export type FilterOp = 'is' | 'is-not' | 'contains' | 'empty' | 'not-empty' | 'gt' | 'lt' | 'matches';
export const FILTER_WORDS: Record<FilterOp, string> = { is: 'is', 'is-not': 'is not', contains: 'contains', empty: 'is empty', 'not-empty': 'is not empty', gt: 'is more than', lt: 'is less than', matches: 'matches the formula' };
export const FILTER_OPS: FilterOp[] = ['is', 'is-not', 'contains', 'empty', 'not-empty', 'gt', 'lt', 'matches'];
/** Filters that need no value typed in. */
export const noValueOp = (op: FilterOp): boolean => op === 'empty' || op === 'not-empty';

export interface ViewFilter {
  /** The property (or field, or formula.<name>) it looks at; '' for "matches the formula", whose formula is `value`. */
  prop: string;
  op: FilterOp;
  value?: string;
}

export interface ViewSort {
  prop: string;
  dir: 'asc' | 'desc';
}

export interface ViewDef {
  version: 1;
  source: ViewSource;
  layout: ViewLayout;
  /** Table: the properties shown as columns, in order (the note's name always comes first). Cards and list show the same
   *  properties on each card or beside each name. */
  columns: string[];
  /** Board and calendar: one or two properties shown on each card under its name. */
  cardProps: string[];
  /** Board: the property whose values are the columns. */
  groupBy?: string;
  /** Calendar: the property holding each note's day. */
  dateProp?: string;
  /** Timeline: the property holding each note's last day (a range from `dateProp`); none when not set. */
  endProp?: string;
  /** Chart: what the bars, ring slices or line points are; none when the view is not a chart. */
  chart?: ChartSpec;
  /** Map: the property holding each note's place. */
  placeProp?: string;
  sort?: ViewSort;
  /** Every order, the first one first (a .base view's orders, all kept; none when one order or less). */
  sorts?: ViewSort[];
  filters: ViewFilter[];
  /** Board: columns the person hid, folded up, or put in an order of their own (by value, lower case). */
  hiddenGroups: string[];
  collapsedGroups: string[];
  groupOrder: string[];
  /** Cards: the property holding each card's cover (a picture in the vault, or one of the calm colours, as a note's
   *  own `cover:` is written). */
  cover?: string;
  /** Table, cards and list: rows split into groups by this property, a heading over each (none when not set). Kept apart
   *  from the board's `groupBy`, which every view is given for its board, so a table never splits unasked. */
  sectionBy?: ViewSort;
  /** Formula columns (21 Oct 2026): a name and how it is worked out (src/shared/formula.ts), shown as formula.<name>. */
  formulas: Record<string, string>;
  /** Rollup columns (8.8): across the records a relation links to, what one of their fields adds up to. */
  rollups: Record<string, RollupDef>;
  /** The view's form (8.8): what its person chose about it; none when they chose nothing. */
  form?: FormDef;
  /** Table: the summary under each column (by its key): a count, a sum, the earliest day… */
  summaries: Record<string, SummaryKind>;
  /** Headings the person gave columns, by key (a .base file's display names come in here too). */
  labels: Record<string, string>;
  /** At most this many notes show (a .base view's limit); none when not set. */
  limit?: number;
}

/** Fields every note has besides its properties. */
export const FIELD_TITLE = 'file.title';
export const FIELD_FOLDER = 'file.folder';
export const FIELD_MODIFIED = 'file.modified';
/** Every tag the note has (its tags property and #tags in its words), as the index gathers them. */
export const FIELD_TAGS = 'file.tags';
export const FIELDS = [FIELD_TITLE, FIELD_FOLDER, FIELD_MODIFIED, FIELD_TAGS];
const FIELD_WORDS: Record<string, string> = { [FIELD_TITLE]: 'Name', [FIELD_FOLDER]: 'Folder', [FIELD_MODIFIED]: 'Changed', [FIELD_TAGS]: 'Tags' };
/** A field, a formula or a rollup: shown, never typed into. */
export const isField = (key: string) => FIELDS.includes(key) || isFormulaKey(key) || isRollupKey(key);

/** A formula column's key: formula.<name>. */
export const FORMULA_PREFIX = 'formula.';
export const isFormulaKey = (key: string): boolean => key.startsWith(FORMULA_PREFIX);
export const formulaKey = (name: string): string => `${FORMULA_PREFIX}${name}`;
export const formulaName = (key: string): string => key.slice(FORMULA_PREFIX.length);
/** The view's formula columns' keys, in the order they were made. */
export const formulaKeys = (def: ViewDef): string[] => Object.keys(def.formulas ?? {}).map(formulaKey);

/** A rollup column's key: rollup.<name>. */
export const ROLLUP_PREFIX = 'rollup.';
export const isRollupKey = (key: string): boolean => key.startsWith(ROLLUP_PREFIX);
export const rollupKey = (name: string): string => `${ROLLUP_PREFIX}${name}`;
export const rollupName = (key: string): string => key.slice(ROLLUP_PREFIX.length);
/** The view's rollup columns' keys, in the order they were made. */
export const rollupKeys = (def: ViewDef): string[] => Object.keys(def.rollups ?? {}).map(rollupKey);

/** A view’s own key (a field, a formula or a rollup): a property with the same key would hide behind it (9.5 O3). */
export const isReservedViewKey = (key: string): boolean => isField(key);

/** A property’s key made safe for a view: one matching the view’s own keeps its words with a suffix, beside the
 *  built-in, instead of hiding behind it (9.5 O3). Anything else stays as it was. */
export const safeViewPropKey = (key: string): string => (isReservedViewKey(key) ? `${key} (property)` : key);

/** How a rollup adds its linked records up: their total, how many, their average, smallest, largest, or the list. */
export type RollupOp = 'sum' | 'count' | 'average' | 'min' | 'max' | 'list';
export const ROLLUP_OPS: RollupOp[] = ['sum', 'count', 'average', 'min', 'max', 'list'];
export const ROLLUP_OP_WORDS: Record<RollupOp, string> = { sum: 'Add up', count: 'Count', average: 'Average', min: 'Smallest', max: 'Largest', list: 'List' };

/** A rollup: across the records a relation property links to, what one of their fields adds up to. */
export interface RollupDef {
  /** The relation property on this note (its [[links]] name the linked records). */
  relation: string;
  /** The field read on each linked record (a property, or file.title to count them all). */
  field: string;
  op: RollupOp;
}

/** A view's form (8.8): what its person chose about it. The form itself is the view's fields (view-forms.ts). */
export interface FormDef {
  /** The form's heading (the view's name, when not set). */
  title?: string;
  /** A line under the heading, in the person's own words. */
  note?: string;
  /** Columns the form doesn't ask for. */
  hidden?: string[];
  /** Columns that must be filled in (the name always must be). */
  required?: string[];
}

// ── Charts (10.0 Endless Tech, v10records: one view engine) ─────────────────────────────────────────────────────────
// The record views' charts carried into this engine (bars, a line or a ring, from a count or a number field), drawn
// over view rows: the shape is shared (record-views.ts re-exports it), each row kind keeps its own bucketing.

export const CHART_TYPES = ['bar', 'line', 'donut'] as const;
export type ChartType = (typeof CHART_TYPES)[number];
export const CHART_WORDS: Record<ChartType, string> = { bar: 'Bars', line: 'Line', donut: 'Ring' };

export interface ChartSpec {
  type: ChartType;
  /** What the bars, ring slices or line points are: a field's values (status, owner…) or a date field (by week or month). */
  by: string;
  /** "count" counts rows; any number field adds them up (or averages them with `agg: 'avg'`). */
  measure: string;
  agg?: 'sum' | 'avg';
  /** Bars: a number field each bar is measured against (a budget beside what was spent), drawn as a mark on its bar. */
  target?: string;
}

export interface ChartPoint {
  label: string;
  value: number;
  /** The rows behind it (a bar or slice opens them): note paths. */
  ids: string[];
  /** The target field added up for it (ChartSpec.target), when the chart has one. */
  target?: number;
}
export interface ChartData {
  points: ChartPoint[];
  /** In words: "Notes by status", "Cost over time (average)". */
  caption: string;
  total: number;
  /** The measure's unit word ("notes", "Cost"…): rows counted, or the field's label. */
  unit: string;
}

/** A property's name as a column heading: "due_date" → "Due date". */
export function propWords(key: string): string {
  if (FIELD_WORDS[key]) return FIELD_WORDS[key];
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

/** A column's heading in a view (a property's name in words, or the field's own word). */
export function columnLabel(def: ViewDef, key: string): string {
  const own = def.labels?.[key];
  if (own) return own;
  // A formula's or rollup's name is the person's own words ("Total cost"), shown as they wrote it.
  return isFormulaKey(key) ? formulaName(key) : isRollupKey(key) ? rollupName(key) : propWords(key);
}

/** What a view needs from each note (the index's NoteMeta has all of it). */
export interface ViewNote {
  path: string;
  title: string;
  label?: string;
  mtime: number;
  tags: string[];
  props: Record<string, unknown>;
}

export interface ViewRow {
  path: string;
  /** The name a person sees. */
  title: string;
  folder: string;
  mtime: number;
  tags: string[];
  props: Record<string, unknown>;
  /** The view's formulas worked out for this note (by name): a value, or a FormulaFault saying why not. */
  computed?: Record<string, unknown>;
  /** The view's rollups worked out for this note (by name): a value, or nothing when there is nothing to add up. */
  rolled?: Record<string, unknown>;
}

// ── The view file ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function defaultView(source: ViewSource = { kind: 'all' }, layout: ViewLayout = 'table'): ViewDef {
  return { version: 1, source, layout, columns: [], cardProps: [], filters: [], hiddenGroups: [], collapsedGroups: [], groupOrder: [], formulas: {}, rollups: {}, summaries: {}, labels: {} };
}

const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const strs = (v: unknown, max = 60): string[] => (Array.isArray(v) ? [...new Set(v.map((x) => str(x)).filter((x): x is string => !!x))].slice(0, max) : []);

const MAX_FORMULA = 2000;

/** A small map of names to words (formulas, summaries, headings), anything else left out. */
function readMap(v: unknown, max: number, count: number): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, count)) {
    const key = k.trim().slice(0, 120);
    if (key && key !== '__proto__' && typeof x === 'string' && x.trim()) out[key] = x.trim().slice(0, max);
  }
  return out;
}

function readSort(v: unknown): ViewSort | undefined {
  const raw = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  return raw && str(raw.prop) ? { prop: str(raw.prop)!, dir: raw.dir === 'desc' ? 'desc' : 'asc' } : undefined;
}

/** A view file's order list (at most eight), in order. */
function readSorts(v: unknown): ViewSort[] {
  return Array.isArray(v) ? v.map(readSort).filter((s): s is ViewSort => !!s).slice(0, 8) : [];
}

/** Every order a view keeps, the first one first (its list, else its one order, else none). */
export function sortsOf(def: Pick<ViewDef, 'sort' | 'sorts'>): ViewSort[] {
  if (def.sorts?.length) return [...def.sorts];
  return def.sort ? [{ ...def.sort }] : [];
}

/** An order in words ("Name, A to Z"), for the note naming a view's further orders. */
export function sortWords(s: ViewSort, label: (key: string) => string = propWords): string {
  return `${label(s.prop)}, ${s.dir === 'desc' ? 'Z to A' : 'A to Z'}`;
}

/** A view with its first order changed: the further orders stay, minus any order on the same property. */
export function primarySortPatch(def: Pick<ViewDef, 'sort' | 'sorts'>, sort: ViewSort | undefined): Pick<ViewDef, 'sort' | 'sorts'> {
  const rest = sortsOf(def).slice(1).filter((s) => s.prop !== sort?.prop);
  const sorts = sort ? [sort, ...rest] : rest;
  return { sort, sorts: sorts.length > 1 ? sorts : undefined };
}

/** A view file's form choices: a heading, a line, columns hidden and columns required; null when it says nothing. */
function readForm(v: unknown): FormDef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const form: FormDef = {};
  const title = str(r.title);
  const note = str(r.note);
  if (title) form.title = title;
  if (note) form.note = note;
  const hidden = strs(r.hidden);
  const required = strs(r.required);
  if (hidden.length) form.hidden = hidden;
  if (required.length) form.required = required;
  return Object.keys(form).length ? form : null;
}

/** A view file's rollups: named, with a relation, a field and a way to add up; anything else left out. */
function readRollups(v: unknown): Record<string, RollupDef> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, RollupDef> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 30)) {
    const name = cleanRollupName(k);
    const r = (x && typeof x === 'object' && !Array.isArray(x) ? x : {}) as Record<string, unknown>;
    const relation = str(r.relation);
    const field = str(r.field);
    const op = ROLLUP_OPS.includes(r.op as RollupOp) ? (r.op as RollupOp) : undefined;
    if (name && relation && field && op && name !== '__proto__') out[name] = { relation, field, op };
  }
  return out;
}

/**
 * A view file read as the person (or another app) left it: anything missing or not understood falls back to a sensible
 * choice, so a hand-edited file still opens. `problem` says in plain words when the file couldn't be read at all.
 */
export function readView(text: string): { def: ViewDef; problem: string | null } {
  let raw: unknown;
  try {
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    return { def: defaultView(), problem: 'This view’s file couldn’t be read, so it shows every note as a table. Changing anything here writes the file afresh.' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { def: defaultView(), problem: null };
  const r = raw as Record<string, unknown>;
  const src = (r.source ?? {}) as Record<string, unknown>;
  const kind = src.kind === 'folder' || src.kind === 'tag' ? src.kind : 'all';
  const value = kind === 'folder' ? String(src.value ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : kind === 'tag' ? String(src.value ?? '').replace(/^#/, '').trim() : undefined;
  const source: ViewSource = kind === 'all' || (kind === 'tag' && !value) ? { kind: 'all' } : { kind, value };
  const layout = ALL_LAYOUTS.includes(r.layout as ViewLayout) ? (r.layout as ViewLayout) : 'table';
  const chartRaw = r.chart && typeof r.chart === 'object' && !Array.isArray(r.chart) ? (r.chart as Record<string, unknown>) : null;
  const chartBy = chartRaw ? str(chartRaw.by) : undefined;
  const chart: ChartSpec | undefined = chartBy
    ? { type: (CHART_TYPES as readonly string[]).includes(chartRaw!.type as string) ? (chartRaw!.type as ChartType) : 'bar', by: chartBy, measure: str(chartRaw!.measure) ?? 'count', ...(chartRaw!.agg === 'avg' ? { agg: 'avg' as const } : {}), ...(str(chartRaw!.target) ? { target: str(chartRaw!.target) } : {}) }
    : undefined;
  const sort = readSort(r.sort);
  const sorts = readSorts(r.sorts);
  const first = sorts[0] ?? sort;
  const sectionBy = readSort(r.sectionBy);
  const form = readForm(r.form);
  const filters: ViewFilter[] = Array.isArray(r.filters)
    ? (r.filters as unknown[])
        .map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>) : null))
        .filter((f): f is Record<string, unknown> => !!f && FILTER_OPS.includes(f.op as FilterOp) && (f.op === 'matches' ? !!str(f.value, MAX_FORMULA) : !!str(f.prop)))
        .slice(0, 20)
        .map((f) => ({ prop: f.op === 'matches' ? '' : str(f.prop)!, op: f.op as FilterOp, ...(typeof f.value === 'string' || typeof f.value === 'number' || typeof f.value === 'boolean' ? { value: String(f.value).slice(0, MAX_FORMULA) } : {}) }))
    : [];
  return {
    def: {
      version: 1,
      source,
      layout,
      columns: strs(r.columns),
      cardProps: strs(r.cardProps).slice(0, 2),
      groupBy: str(r.groupBy),
      dateProp: str(r.dateProp),
      ...(str(r.endProp) ? { endProp: str(r.endProp) } : {}),
      ...(chart ? { chart } : {}),
      placeProp: str(r.placeProp),
      sort: first,
      sorts: sorts.length > 1 ? sorts : undefined,
      filters,
      hiddenGroups: strs(r.hiddenGroups, 200).map((s) => s.toLowerCase()),
      collapsedGroups: strs(r.collapsedGroups, 200).map((s) => s.toLowerCase()),
      groupOrder: strs(r.groupOrder, 200),
      ...(str(r.cover) ? { cover: str(r.cover) } : {}),
      ...(sectionBy ? { sectionBy } : {}),
      formulas: readMap(r.formulas, MAX_FORMULA, 30),
      rollups: readRollups(r.rollups),
      ...(form ? { form } : {}),
      summaries: Object.fromEntries(Object.entries(readMap(r.summaries, 20, 100)).filter(([, v]) => SUMMARY_KINDS.includes(v as SummaryKind))) as Record<string, SummaryKind>,
      labels: readMap(r.labels, 120, 100),
      ...(typeof r.limit === 'number' && r.limit >= 1 ? { limit: Math.min(Math.floor(r.limit), 100000) } : {}),
    },
    problem: null,
  };
}

/** The view as its file keeps it: only what was chosen, tab-indented like canvases. */
export function writeView(def: ViewDef): string {
  const out: Record<string, unknown> = { version: 1, source: def.source.kind === 'all' ? { kind: 'all' } : def.source, layout: def.layout };
  if (def.columns.length) out.columns = def.columns;
  if (def.cardProps.length) out.cardProps = def.cardProps.slice(0, 2);
  if (def.groupBy) out.groupBy = def.groupBy;
  if (def.dateProp) out.dateProp = def.dateProp;
  if (def.endProp) out.endProp = def.endProp;
  if (def.chart) out.chart = def.chart;
  if (def.placeProp) out.placeProp = def.placeProp;
  if (def.sort) out.sort = def.sort;
  if (def.sorts?.length && def.sorts.length > 1) out.sorts = def.sorts;
  if (def.filters.length) out.filters = def.filters;
  if (def.hiddenGroups.length) out.hiddenGroups = def.hiddenGroups;
  if (def.collapsedGroups.length) out.collapsedGroups = def.collapsedGroups;
  if (def.groupOrder.length) out.groupOrder = def.groupOrder;
  if (def.cover) out.cover = def.cover;
  if (def.sectionBy) out.sectionBy = def.sectionBy;
  if (Object.keys(def.formulas ?? {}).length) out.formulas = def.formulas;
  if (Object.keys(def.rollups ?? {}).length) out.rollups = def.rollups;
  if (def.form && Object.keys(def.form).length) out.form = def.form;
  if (Object.keys(def.summaries ?? {}).length) out.summaries = def.summaries;
  if (Object.keys(def.labels ?? {}).length) out.labels = def.labels;
  if (def.limit) out.limit = def.limit;
  return `${JSON.stringify(out, null, '\t')}\n`;
}

/** A view's file: Ironleaf's own .view.json, or a .base file from another notes app (src/shared/base-file.ts). */
export const isViewPath = (path: string | undefined): boolean => !!path && (path.toLowerCase().endsWith(VIEW_EXT) || /\.base$/i.test(path));
/** "Views/Reading list.view.json" → "Reading list" (and "Projects.base" → "Projects"). */
export const viewName = (path: string): string => (path.split('/').pop() ?? path).replace(/\.(?:view\.json|base)$/i, '');

/**
 * A view whose folder was renamed or moved, showing the folder where it is now (null: it doesn't show that folder), so a
 * renamed folder never leaves a view empty.
 */
export function followFolder(def: ViewDef, from: string, to: string): ViewDef | null {
  const value = def.source.kind === 'folder' ? def.source.value : undefined;
  if (!value || !from || (value !== from && !value.startsWith(`${from}/`))) return null;
  return { ...def, source: { kind: 'folder', value: to + value.slice(from.length) } };
}

/** What the view shows, in words ("Notes in Meetings", "Notes tagged #client", "Every note"). */
export function sourceWords(source: ViewSource): string {
  if (source.kind === 'folder') return source.value ? `Notes in ${source.value}` : 'Every note';
  if (source.kind === 'tag') return `Notes tagged #${source.value}`;
  return 'Every note';
}

/** A filter in words, for its chip ("Status is “Done”", "Matches price > 10"). */
export function filterWords(def: ViewDef, f: ViewFilter): string {
  if (f.op === 'matches') return `Matches ${f.value ?? ''}`.trim();
  return `${columnLabel(def, f.prop)} ${FILTER_WORDS[f.op]}${!noValueOp(f.op) && f.value ? ` “${f.value}”` : ''}`;
}

// ── Values ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A property's value on a row (its name written in any case finds it: Status, status). */
export function valueOf(row: ViewRow, key: string): unknown {
  if (key === FIELD_TITLE) return row.title;
  if (key === FIELD_FOLDER) return row.folder;
  if (key === FIELD_MODIFIED) return row.mtime;
  if (key === FIELD_TAGS) return row.tags;
  if (isFormulaKey(key)) return row.computed && Object.hasOwn(row.computed, formulaName(key)) ? row.computed[formulaName(key)] : undefined;
  if (isRollupKey(key)) return row.rolled && Object.hasOwn(row.rolled, rollupName(key)) ? row.rolled[rollupName(key)] : undefined;
  if (Object.hasOwn(row.props, key)) return row.props[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(row.props)) if (k.toLowerCase() === lower) return row.props[k];
  return undefined;
}

/** Empty: nothing written (a formula that couldn't be worked out counts as empty too, so it sorts last and sums skip it). */
export function isEmpty(v: unknown): boolean {
  return isFault(v) || v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.every(isEmpty));
}

/** A value as words, for a cell, a card or a comparison. */
export function valueText(v: unknown): string {
  if (v === undefined || v === null || isFault(v)) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.map(valueText).filter(Boolean).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).trim();
}

/** A value's separate items (a list's entries; one item otherwise), lower-cased, for "is" and grouping. */
function items(v: unknown): string[] {
  if (isEmpty(v)) return [];
  if (Array.isArray(v)) return v.flatMap(items);
  if (typeof v === 'boolean') return [v ? 'true' : 'false'];
  return [valueText(v).toLowerCase()];
}

// ── Which notes, in what order ────────────────────────────────────────────────────────────────────────────────────────

const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

export function inSource(note: ViewNote, source: ViewSource): boolean {
  if (source.kind === 'folder' && source.value) return note.path.startsWith(`${source.value}/`);
  if (source.kind === 'tag' && source.value) {
    const want = source.value.toLowerCase();
    return note.tags.some((t) => {
      const tag = t.toLowerCase();
      return tag === want || tag.startsWith(`${want}/`);
    });
  }
  return true;
}

export function matchesFilter(row: ViewRow, f: ViewFilter, now: Date = new Date()): boolean {
  if (f.op === 'matches') {
    // A formula that can't be worked out hides nothing, as a filter not filled in yet hides nothing.
    if (!f.value?.trim()) return true;
    const v = runFormula(f.value, rowScope(row, undefined, now));
    return isFault(v) || formulaTruthy(v);
  }
  const v = valueOf(row, f.prop);
  const want = (f.value ?? '').trim().toLowerCase();
  switch (f.op) {
    case 'gt':
    case 'lt': {
      if (!want || isEmpty(v)) return !want;
      const c = compareAsKind(v, f.value!.trim());
      return c !== null && (f.op === 'gt' ? c > 0 : c < 0);
    }
    case 'empty':
      return isEmpty(v);
    case 'not-empty':
      return !isEmpty(v);
    case 'is': {
      if (!want) return true;
      const wanted = want === 'yes' ? ['yes', 'true'] : want === 'no' ? ['no', 'false'] : [want];
      return items(v).some((i) => wanted.includes(i));
    }
    case 'is-not': {
      if (!want) return true;
      const wanted = want === 'yes' ? ['yes', 'true'] : want === 'no' ? ['no', 'false'] : [want];
      return !items(v).some((i) => wanted.includes(i));
    }
    case 'contains':
      return !want || valueText(v).toLowerCase().includes(want);
  }
}

const NUMERIC = /^-?\d+(?:\.\d+)?$/;

/** A value against what a filter says (more than 10, less than 2026-11-01): numbers as numbers, days as days, else words. */
function compareAsKind(v: unknown, want: string): number | null {
  const first = Array.isArray(v) ? v.find((x) => !isEmpty(x)) : v;
  const n = typeof first === 'number' ? first : NUMERIC.test(valueText(first).replace(/,/g, '')) ? Number(valueText(first).replace(/,/g, '')) : null;
  const w = Number(want.replace(/,/g, ''));
  if (n !== null && NUMERIC.test(want.replace(/,/g, ''))) return n - w;
  const a = readDate(first);
  const b = readDate(want);
  if (a && b) return `${a.iso}${a.time}`.localeCompare(`${b.iso}${b.time}`);
  if (typeof first === 'number' && b) return first - new Date(Number(b.iso.slice(0, 4)), Number(b.iso.slice(5, 7)) - 1, Number(b.iso.slice(8, 10))).getTime();
  return collator.compare(valueText(first), want);
}
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Two values in order: empty ones always last; numbers as numbers, ticks before crosses, words as people read them. */
export function compareValues(a: unknown, b: unknown): number {
  const ea = isEmpty(a);
  const eb = isEmpty(b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? -1 : 1;
  const ta = valueText(a);
  const tb = valueText(b);
  if (NUMERIC.test(ta) && NUMERIC.test(tb)) return Number(ta) - Number(tb);
  return collator.compare(ta, tb);
}

export interface RunOptions {
  /** Folders whose notes never show (the templates folder): a template isn't a note in the list. */
  exclude?: string[];
  /** Formulas every note must meet besides the view's own filters (a .base file's filters for all its views). */
  where?: string[];
  /** "Now" for the formulas (tests pass one; else the moment the view is worked out). */
  now?: Date;
}

/** What a formula reads of one row: its properties (any case), its fields, and the view's other formulas. */
function rowScope(row: ViewRow, formula: ((name: string) => unknown) | undefined, now: Date) {
  return {
    prop: (name: string) => {
      if (Object.hasOwn(row.props, name)) return row.props[name];
      const lower = name.toLowerCase();
      for (const k of Object.keys(row.props)) if (k.toLowerCase() === lower) return row.props[k];
      return undefined;
    },
    file: (field: 'title' | 'folder' | 'modified' | 'tags' | 'path') => (field === 'title' ? row.title : field === 'folder' ? row.folder : field === 'modified' ? row.mtime : field === 'tags' ? row.tags : row.path),
    formula: formula ?? ((name: string) => (row.computed ? lookupComputed(row.computed, name) : undefined)),
    now,
  };
}

const lookupComputed = (computed: Record<string, unknown>, name: string): unknown => {
  const key = Object.hasOwn(computed, name) ? name : Object.keys(computed).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : computed[key];
};

/**
 * The view's formulas worked out for a row, each once (a formula may use another: formula.total, or its bare name); one
 * that uses itself, however roundabout, says so rather than going round for ever.
 */
export function computeFormulas(row: ViewRow, formulas: Record<string, string>, now: Date = new Date()): Record<string, unknown> {
  const names = Object.keys(formulas);
  const done: Record<string, unknown> = {};
  const working = new Set<string>();
  const get = (asked: string): unknown => {
    const name = names.find((n) => n === asked) ?? names.find((n) => n.toLowerCase() === asked.toLowerCase());
    if (name === undefined) return undefined;
    if (Object.hasOwn(done, name)) return done[name];
    if (working.has(name)) return new FormulaFault(`“${name}” uses itself.`);
    working.add(name);
    const v = runFormula(formulas[name], scope);
    working.delete(name);
    // A formula caught in a loop is a fault wherever the loop is entered from.
    done[name] = v;
    return v;
  };
  const scope = rowScope(row, get, now);
  for (const n of names) get(n);
  return done;
}

/** A property's value by its name (any case), or undefined when the note hasn't it. */
function propOf(row: ViewRow, name: string): unknown {
  if (Object.hasOwn(row.props, name)) return row.props[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(row.props)) if (k.toLowerCase() === lower) return row.props[k];
  return undefined;
}

/**
 * Values added up one way (10.0 Endless Tech, v10records: one view engine): the one aggregation behind rollups over
 * notes and over project records: count the filled ones, list them, add the numbers, or take the smallest or largest
 * (numbers as numbers, days as days, else words as people read them). Nothing to add up is nothing (undefined).
 */
export function aggregateRollup(values: readonly unknown[], op: RollupOp, field = ''): unknown {
  const filled = values.filter((x) => !isEmpty(x));
  // Count counts what is filled (file.title counts them all).
  if (op === 'count') return filled.length;
  if (!filled.length) return undefined;
  if (op === 'list') return filled.map(valueText).filter(Boolean);
  const nums = filled.map(numberOf).filter((n): n is number => n !== null);
  if (op === 'sum' || op === 'average') {
    if (!nums.length) return undefined;
    const sum = nums.reduce((a, b) => a + b, 0);
    return Math.round((op === 'sum' ? sum : sum / nums.length) * 100) / 100;
  }
  // Smallest and largest: numbers as numbers, days as days, else words as people read them.
  if (nums.length === filled.length) return op === 'min' ? Math.min(...nums) : Math.max(...nums);
  const days = filled.map((v) => dayStamp(v, field)).filter((d): d is string => !!d);
  if (days.length === filled.length) {
    days.sort();
    return op === 'min' ? days[0] : days[days.length - 1];
  }
  const words = filled.map(valueText).sort(collator.compare);
  return op === 'min' ? words[0] : words[words.length - 1];
}

/** One rollup worked out over the records a relation links to (a value, or nothing when there is nothing to add up). */
function rollupValue(linked: ViewRow[], r: RollupDef): unknown {
  const values = linked.flatMap((row) => {
    const v = valueOf(row, r.field);
    return (Array.isArray(v) ? v : [v]).filter((x) => !isEmpty(x));
  });
  return aggregateRollup(values, r.op, r.field);
}

/**
 * The view's rollups worked out for a row: each relation's links resolved against every note (not only the ones the
 * view shows, so a task outside the view still adds up), each field read on the records they name.
 */
export function computeRollups(row: ViewRow, rollups: Record<string, RollupDef>, all: readonly ViewRow[]): Record<string, unknown> {
  const notes = all.map((n) => ({ path: n.path, title: n.title }));
  const byPath = new Map(all.map((n) => [n.path, n]));
  const out: Record<string, unknown> = {};
  for (const [name, r] of Object.entries(rollups)) {
    const linked = resolveRelation(relationTargets(propOf(row, r.relation)), notes).map((p) => byPath.get(p)!).filter(Boolean);
    const v = rollupValue(linked, r);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

/** The notes a view shows, filtered and in order. Thousands of notes take a few milliseconds. */
export function runView(def: ViewDef, notes: readonly ViewNote[], options: RunOptions = {}): ViewRow[] {
  const exclude = (options.exclude ?? []).filter(Boolean).map((d) => `${d.replace(/^\/+|\/+$/g, '')}/`);
  const now = options.now ?? new Date();
  const formulas = def.formulas ?? {};
  const hasFormulas = Object.keys(formulas).length > 0;
  const rollups = def.rollups ?? {};
  const hasRollups = Object.keys(rollups).length > 0;
  const lookup = hasRollups ? notes.map((n): ViewRow => ({ path: n.path, title: n.label || n.title, folder: folderOf(n.path), mtime: n.mtime, tags: n.tags, props: n.props ?? {} })) : [];
  const where = (options.where ?? []).filter((w) => w.trim()).map((value): ViewFilter => ({ prop: '', op: 'matches', value }));
  const rows: ViewRow[] = [];
  for (const n of notes) {
    if (exclude.some((d) => n.path.startsWith(d))) continue;
    if (!inSource(n, def.source)) continue;
    const row: ViewRow = { path: n.path, title: n.label || n.title, folder: folderOf(n.path), mtime: n.mtime, tags: n.tags, props: n.props ?? {} };
    // Formulas and rollups first: a filter, the order and the groups can all use them.
    if (hasFormulas) row.computed = computeFormulas(row, formulas, now);
    if (hasRollups) row.rolled = computeRollups(row, rollups, lookup);
    if (where.every((f) => matchesFilter(row, f, now)) && def.filters.every((f) => matchesFilter(row, f, now))) rows.push(row);
  }
  const sorts = sortsOf(def).length ? sortsOf(def) : [{ prop: FIELD_TITLE, dir: 'asc' as const }];
  const keyed = rows.map((r) => ({ r, vs: sorts.map((s) => valueOf(r, s.prop)) }));
  keyed.sort((x, y) => {
    for (let i = 0; i < sorts.length; i++) {
      const dir = sorts[i].dir === 'desc' ? -1 : 1;
      const ex = isEmpty(x.vs[i]);
      const ey = isEmpty(y.vs[i]);
      // Empty values stay at the end whichever way the order runs.
      if (ex !== ey) return ex ? 1 : -1;
      const c = dir * compareValues(x.vs[i], y.vs[i]);
      if (c) return c;
    }
    return collator.compare(x.r.title, y.r.title);
  });
  const sorted = keyed.map((k) => k.r);
  return def.limit ? sorted.slice(0, def.limit) : sorted;
}

// ── The properties the notes have ─────────────────────────────────────────────────────────────────────────────────────

export interface KnownProp {
  key: string;
  /** How many of the notes have it. */
  count: number;
  /** What kind of value it mostly holds (for its editor and which menus offer it). */
  kind: PropKind;
  /** Some notes hold a list in it (tags, people): not offered for grouping a board. */
  list: boolean;
  /** How many different values it has (up to 51: "many"). */
  distinct: number;
}

/** Properties that are Ironleaf's or the editor's own bookkeeping, not something to look at in a view. */
const QUIET = new Set(['aliases', 'alias', 'cssclasses', 'cssclass', 'position', 'neuralspark-key']);

/** Every property the notes have, most used first. */
export function knownProps(rows: readonly ViewRow[]): KnownProp[] {
  const found = new Map<string, { key: string; count: number; kinds: Map<PropKind, number>; list: boolean; values: Set<string> }>();
  for (const r of rows) {
    for (const [key, value] of Object.entries(r.props)) {
      const lower = key.toLowerCase();
      // The app's own keeping is never a column, filter or group either (frontmatter.ts's one list, 6 Nov 2026).
      if (QUIET.has(lower) || isMachineProp(key)) continue;
      let p = found.get(lower);
      if (!p) found.set(lower, (p = { key, count: 0, kinds: new Map(), list: false, values: new Set() }));
      p.count++;
      if (isEmpty(value)) continue;
      const k = propKind(key, value);
      p.kinds.set(k, (p.kinds.get(k) ?? 0) + 1);
      if (Array.isArray(value)) p.list = true;
      if (p.values.size <= 50) for (const i of items(value)) p.values.add(i);
    }
  }
  return [...found.values()]
    .map((p) => ({ key: p.key, count: p.count, kind: [...p.kinds].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'text', list: p.list, distinct: Math.min(p.values.size, 51) }))
    .sort((a, b) => b.count - a.count || collator.compare(a.key, b.key));
}

const DATE_NAMES = ['due', 'date', 'deadline', 'when', 'scheduled', 'start', 'day', 'created'];
/** Names people give a picture property, for a new view's card covers. */
const COVER_NAMES = ['cover', 'image', 'picture', 'photo', 'banner', 'thumbnail'];

/** Names people give a place property, for a new view's map. */
const PLACE_NAMES = ['place', 'location', 'venue', 'site', 'suburb', 'address'];
/** Good first choices for a new view: a few columns, a property to group by, a property for the calendar, a cover. */
export function suggestDisplay(rows: readonly ViewRow[]): { columns: string[]; groupBy?: string; dateProp?: string; placeProp?: string; cardProps: string[]; cover?: string } {
  const props = knownProps(rows);
  const dates = props.filter((p) => p.kind === 'date' || p.kind === 'datetime');
  const named = (names: string[], from: KnownProp[]) => names.map((n) => from.find((p) => p.key.toLowerCase() === n)).find(Boolean);
  const dateProp = (named(DATE_NAMES, props.filter((p) => p.kind === 'date' || p.kind === 'datetime' || p.kind === 'text')) ?? dates[0])?.key;
  const groupable = props.filter((p) => !p.list && p.kind !== 'date' && p.kind !== 'datetime' && p.distinct > 0 && p.distinct <= 12);
  const groupBy = (named(['status', 'stage', 'state', 'phase', 'priority'], groupable) ?? groupable[0])?.key;
  const cover = named(COVER_NAMES, props.filter((p) => p.kind === 'text'))?.key;
  const placeProp = named(PLACE_NAMES, props.filter((p) => p.kind === 'text'))?.key;
  // The cover is drawn as the card's picture, so it isn't one of the columns too.
  const columns = props.filter((p) => p.key !== cover).slice(0, 5).map((p) => p.key);
  const cardProps = props.filter((p) => p.key !== groupBy && p.key !== dateProp && p.key !== cover).slice(0, 1).map((p) => p.key);
  return { columns, groupBy, dateProp, placeProp, cardProps, ...(cover ? { cover } : {}) };
}

// ── Board ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Words people use for where work is, in the order work moves (columns with these names line up this way). */
const FLOW = ['inbox', 'backlog', 'idea', 'ideas', 'someday', 'planned', 'planning', 'to do', 'todo', 'not started', 'next', 'ready', 'in progress', 'doing', 'active', 'started', 'waiting', 'blocked', 'on hold', 'paused', 'review', 'in review', 'testing', 'done', 'complete', 'completed', 'finished', 'shipped', 'closed', 'cancelled', 'canceled', 'archived'];
const PRIORITY = ['urgent', 'critical', 'highest', 'high', 'medium', 'normal', 'low', 'lowest'];

export const NO_VALUE = '';

export interface BoardGroup {
  /** The value in lower case ('' for notes without it). */
  key: string;
  /** The value as the notes write it most often ("In progress"), or "No value". */
  label: string;
  /** What is written into a note dropped here (null: the property is taken off). */
  value: PropValue | null;
  rows: ViewRow[];
  hidden: boolean;
  collapsed: boolean;
}

function rank(key: string): number {
  const f = FLOW.indexOf(key);
  if (f >= 0) return f;
  const p = PRIORITY.indexOf(key);
  return p >= 0 ? 100 + p : -1;
}

/**
 * The board's columns: one per value of the property (written in any case: "done" and "Done" are one column), in the
 * person's own order when they set one, else the order work moves (Planned, In progress, Done), else A to Z; notes
 * without the property last, under "No value". A note holding a list goes in the column of its first item.
 */
export function groupBoard(rows: readonly ViewRow[], def: ViewDef): BoardGroup[] {
  const prop = def.groupBy;
  const groups = new Map<string, { rows: ViewRow[]; spellings: Map<string, number>; raw: PropValue | null }>();
  const add = (key: string, spelling: string, raw: PropValue | null) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { rows: [], spellings: new Map(), raw }));
    if (spelling) g.spellings.set(spelling, (g.spellings.get(spelling) ?? 0) + 1);
    return g;
  };
  // Columns the person put in order stay on the board even when nothing is in them (a "Done" column waiting).
  for (const name of def.groupOrder) add(name.toLowerCase(), name, name);
  for (const r of rows) {
    const v = prop ? valueOf(r, prop) : undefined;
    const first = Array.isArray(v) ? v.find((x) => !isEmpty(x)) : v;
    if (isEmpty(first)) {
      add(NO_VALUE, '', null).rows.push(r);
      continue;
    }
    const raw = (typeof first === 'object' ? valueText(first) : first) as PropValue;
    const key = typeof first === 'boolean' ? (first ? 'true' : 'false') : valueText(first).toLowerCase();
    add(key, typeof first === 'boolean' ? (first ? 'Yes' : 'No') : valueText(first), raw).rows.push(r);
  }
  if (!groups.has(NO_VALUE)) add(NO_VALUE, '', null);
  const own = def.groupOrder.map((s) => s.toLowerCase());
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === NO_VALUE || b === NO_VALUE) return a === b ? 0 : a === NO_VALUE ? 1 : -1;
    const oa = own.indexOf(a);
    const ob = own.indexOf(b);
    if (oa >= 0 || ob >= 0) return oa < 0 ? 1 : ob < 0 ? -1 : oa - ob;
    const ra = rank(a);
    const rb = rank(b);
    if (ra >= 0 || rb >= 0) return ra < 0 ? 1 : rb < 0 ? -1 : ra - rb;
    if (a === 'true' || a === 'false') return a === 'true' ? -1 : 1;
    return collator.compare(a, b);
  });
  return keys.map((key) => {
    const g = groups.get(key)!;
    const label = key === NO_VALUE ? 'No value' : ([...g.spellings].sort((x, y) => y[1] - x[1])[0]?.[0] ?? key);
    return { key, label, value: key === NO_VALUE ? null : typeof g.raw === 'string' ? label : g.raw, rows: g.rows, hidden: def.hiddenGroups.includes(key), collapsed: def.collapsedGroups.includes(key) };
  });
}

export interface RowSection {
  key: string;
  label: string;
  rows: ViewRow[];
}

/**
 * A table, cards or list split into groups by `sectionBy` (21 Oct 2026): one group per value, in the board's order (the
 * person's way work moves, else A to Z), "No value" last; Z to A turns the groups round, "No value" still last. Empty
 * groups don't show. Null when the view isn't split.
 */
export function sectionRows(rows: readonly ViewRow[], def: ViewDef): RowSection[] | null {
  if (!def.sectionBy) return null;
  const groups = groupBoard(rows, { ...def, groupBy: def.sectionBy.prop, groupOrder: [], hiddenGroups: [], collapsedGroups: [] })
    .filter((g) => g.rows.length)
    .map(({ key, label, rows: inGroup }) => ({ key, label, rows: inGroup }));
  if (def.sectionBy.dir !== 'desc') return groups;
  return [...groups.filter((g) => g.key !== NO_VALUE).reverse(), ...groups.filter((g) => g.key === NO_VALUE)];
}

/**
 * What a note's property becomes when its card moves to another column: the new value; for a list, the item that put
 * it in its old column swapped for the new one (the rest of the list kept); null takes the property off.
 */
export function movedValue(old: unknown, fromKey: string, to: PropValue | null): PropValue | null {
  if (Array.isArray(old)) {
    const at = old.findIndex((x) => !isEmpty(x) && valueText(x).toLowerCase() === fromKey);
    const next = [...old] as PropValue[];
    if (at >= 0) {
      if (to === null) next.splice(at, 1);
      else next[at] = to;
    } else if (to !== null) next.unshift(to);
    const kept = next.filter((x, i) => !isEmpty(x) && next.findIndex((y) => valueText(y).toLowerCase() === valueText(x).toLowerCase()) === i);
    return kept.length ? kept : null;
  }
  return to;
}

// ── Calendar ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DateValue {
  /** The day, 2026-10-24. */
  iso: string;
  /** A time written with it ("T09:30", " 09:30"), kept when the day moves. */
  time: string;
  /** How it was written: 2026-10-24, or as words ("24 Oct", "24 Oct 2027"). */
  style: 'iso' | 'words';
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})((?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** A property's day as written (2026-10-24, 2026-10-24T09:30, "24 Oct 2026"); null when it isn't one. */
export function readDate(v: unknown, ref: Date = new Date()): DateValue | null {
  const first = Array.isArray(v) ? v[0] : v;
  if (first instanceof Date && !Number.isNaN(first.getTime())) return { iso: first.toISOString().slice(0, 10), time: '', style: 'iso' };
  if (typeof first !== 'string') return null;
  const t = first.trim();
  const m = ISO_DAY.exec(t);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getMonth() !== Number(m[2]) - 1) return null;
    return { iso: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ?? '', style: 'iso' };
  }
  // Written as words with a day number ("24 Oct", "October 24, 2026"): never a bare "Friday", whose day moves.
  if (!/\d/.test(t) || !/[a-z]/i.test(t) || t.length > 40) return null;
  const d = readDay(t, ref);
  return d ? { iso: isoDay(d), time: '', style: 'words' } : null;
}

/** The value written when a note moves to another day: in the way it was written, its time kept. */
export function movedDate(old: unknown, iso: string, ref: Date = new Date()): string {
  const was = readDate(old, ref);
  if (was?.style === 'words') {
    const [y, m, d] = iso.split('-').map(Number);
    return dayWords(new Date(y, m - 1, d), ref);
  }
  return `${iso}${was?.time ?? ''}`;
}

export interface CalendarDay {
  iso: string;
  date: number;
  inMonth: boolean;
  today: boolean;
  weekend: boolean;
}

/** A month as whole weeks, Monday first (as Australians read a calendar): five or six rows of seven days. */
export function monthGrid(year: number, month: number, todayIso: string): CalendarDay[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead);
  const weeks: CalendarDay[][] = [];
  const cur = new Date(start);
  do {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const iso = isoDay(cur);
      week.push({ iso, date: cur.getDate(), inMonth: cur.getMonth() === month, today: iso === todayIso, weekend: i >= 5 });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  } while (cur.getMonth() === month);
  return weeks;
}

/** The notes on each day by the date property, and those without one (the "No date" tray). */
export function placeOnDays(rows: readonly ViewRow[], dateProp: string | undefined, ref: Date = new Date()): { byDay: Map<string, ViewRow[]>; undated: ViewRow[] } {
  const byDay = new Map<string, ViewRow[]>();
  const undated: ViewRow[] = [];
  for (const r of rows) {
    const d = dateProp ? readDate(valueOf(r, dateProp), ref) : null;
    if (!d) {
      undated.push(r);
      continue;
    }
    const list = byDay.get(d.iso);
    if (list) list.push(r);
    else byDay.set(d.iso, [r]);
  }
  return { byDay, undated };
}

/** "October 2026". */
export function monthWords(year: number, month: number): string {
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month]} ${year}`;
}

export interface MapGroup {
  /** The place as the notes write it most often ("Harbour Point"). */
  place: string;
  rows: ViewRow[];
}

/** The notes at each place by the place property (most notes first), and those naming none. */
export function groupByPlace(rows: readonly ViewRow[], placeProp: string | undefined): { groups: MapGroup[]; unplaced: ViewRow[] } {
  const by = new Map<string, { spellings: Map<string, number>; rows: ViewRow[] }>();
  const unplaced: ViewRow[] = [];
  for (const r of rows) {
    const words = placeProp ? valueText(valueOf(r, placeProp)) : '';
    if (!words) {
      unplaced.push(r);
      continue;
    }
    const key = words.toLowerCase();
    const g = by.get(key) ?? { spellings: new Map<string, number>(), rows: [] };
    g.spellings.set(words, (g.spellings.get(words) ?? 0) + 1);
    g.rows.push(r);
    by.set(key, g);
  }
  const groups = [...by.values()]
    .map((g) => ({ place: [...g.spellings].sort((a, b) => b[1] - a[1])[0][0], rows: g.rows }))
    .sort((a, b) => b.rows.length - a.rows.length || a.place.localeCompare(b.place));
  return { groups, unplaced };
}

/** A day moved by some days (Alt and an arrow on a calendar card). */
export function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDay(new Date(y, m - 1, d + days));
}

// ── Timeline ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TimelineSpan {
  row: ViewRow;
  /** The first day (2026-10-24) and the last day; a day without an end ends when it starts. */
  start: string;
  end: string;
}

/** A row's span on a timeline (null when it has no start day); a backwards range shows as its start day. */
export function timelineSpan(row: ViewRow, dateProp: string | undefined, endProp?: string, ref: Date = new Date()): { start: string; end: string } | null {
  const start = dateProp ? readDate(valueOf(row, dateProp), ref)?.iso : undefined;
  if (!start) return null;
  const end = endProp ? readDate(valueOf(row, endProp), ref)?.iso : undefined;
  return { start, end: end && end >= start ? end : start };
}

/** Rows with a start day, earliest first, and those without one. */
export function placeOnTimeline(rows: readonly ViewRow[], dateProp: string | undefined, endProp?: string, ref: Date = new Date()): { spans: TimelineSpan[]; undated: ViewRow[] } {
  const spans: TimelineSpan[] = [];
  const undated: ViewRow[] = [];
  for (const row of rows) {
    const span = timelineSpan(row, dateProp, endProp, ref);
    if (span) spans.push({ row, ...span });
    else undated.push(row);
  }
  spans.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || collator.compare(a.row.title, b.row.title));
  return { spans, undated };
}

// ── Charts ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Whole-percent shares that add to 100 (sweep 3, 043: 66 + 22 + 13 read as 101). Largest remainder wins the spare points. */
export function sharePercents(values: readonly number[]): number[] {
  const total = values.reduce((n, v) => n + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (Math.max(0, v) / total) * 100);
  const out = raw.map((v) => Math.floor(v));
  let left = 100 - out.reduce((n, v) => n + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return out;
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A chart's points over view rows: a count (or sum, or average) per value of `by`; a date field reads by day or month. */
export function chartData(rows: readonly ViewRow[], spec: ChartSpec, def?: ViewDef, now: Date = new Date()): ChartData {
  const labelOf = (key: string): string => (def ? columnLabel(def, key) : propWords(key));
  const first = (v: unknown): unknown => (Array.isArray(v) ? v.find((x) => !isEmpty(x)) : v);
  const isoOf = (v: unknown): string | null => {
    const f = first(v);
    return f === undefined || isEmpty(f) ? null : (readDate(f, now)?.iso ?? null);
  };
  const monthOf = (v: unknown): string | null => {
    const f = first(v);
    return typeof f === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(f.trim()) ? f.trim() : null;
  };
  const byValues = rows.map((r) => valueOf(r, spec.by));
  const dated = byValues.some((v) => !isEmpty(first(v))) && byValues.every((v) => isEmpty(first(v)) || isoOf(v) !== null);
  const monthly = !dated && byValues.some((v) => !isEmpty(first(v))) && byValues.every((v) => isEmpty(first(v)) || monthOf(v) !== null);
  // Dates: by day when they span under ~2 months, else by month.
  let bucket = (iso: string) => iso;
  let bucketLabel = (k: string) => `${Number(k.slice(8, 10))} ${MONTH[Number(k.slice(5, 7)) - 1]}`;
  if (monthly) {
    bucketLabel = (k) => `${MONTH[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
  } else if (dated) {
    const days = byValues.map(isoOf).filter((d): d is string => !!d).sort();
    const spanDays = days.length ? (Date.parse(days[days.length - 1]) - Date.parse(days[0])) / 864e5 : 0;
    if (spanDays > 62) {
      bucket = (iso) => iso.slice(0, 7);
      bucketLabel = (k) => `${MONTH[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
    }
  }
  const by = new Map<string, { sum: number; n: number; ids: string[]; target: number; spellings: Map<string, number> }>();
  for (const r of rows) {
    const v = valueOf(r, spec.by);
    const f = first(v);
    if (dated && isEmpty(f)) continue;
    const k = dated ? (isEmpty(f) ? '' : bucket(isoOf(v)!)) : monthly ? (monthOf(v) ?? '') : f === undefined || isEmpty(f) ? '' : typeof f === 'boolean' ? (f ? 'Yes' : 'No') : valueText(f).toLowerCase();
    let amount = 1;
    if (spec.measure !== 'count') {
      const n = numberOf(first(valueOf(r, spec.measure)));
      if (n === null) continue;
      amount = n;
    }
    const g = by.get(k) ?? { sum: 0, n: 0, ids: [], target: 0, spellings: new Map<string, number>() };
    if (spec.target) {
      const tn = numberOf(first(valueOf(r, spec.target)));
      if (tn !== null) g.target += tn;
    }
    if (!dated && !monthly && k && typeof f !== 'boolean') g.spellings.set(valueText(f), (g.spellings.get(valueText(f)) ?? 0) + 1);
    g.sum += amount;
    g.n++;
    g.ids.push(r.path);
    by.set(k, g);
  }
  let keys = [...by.keys()];
  if (dated || monthly) keys.sort();
  else if (spec.type === 'line') keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  else keys.sort((a, b) => rank(a) - rank(b) || by.get(b)!.n - by.get(a)!.n || a.localeCompare(b));
  if (keys.includes('')) keys = [...keys.filter((k) => k !== ''), ''];
  const avg = spec.measure !== 'count' && spec.agg === 'avg';
  const points = keys.map((k) => {
    const g = by.get(k)!;
    const value = avg ? Math.round((g.sum / g.n) * 100) / 100 : Math.round(g.sum * 100) / 100;
    const label = k === '' ? `No ${labelOf(spec.by).toLowerCase()}` : dated || monthly ? bucketLabel(k) : [...g.spellings].sort((x, y) => y[1] - x[1])[0]?.[0] ?? k;
    return { label, value, ids: g.ids, ...(spec.target ? { target: Math.round(g.target * 100) / 100 } : {}) };
  });
  const measureWords = spec.measure === 'count' ? 'Notes' : `${labelOf(spec.measure)}${avg ? ' (average)' : ''}`;
  const caption = (dated || monthly) && spec.type === 'line' ? `${measureWords} over time` : `${measureWords} by ${labelOf(spec.by).toLowerCase()}`;
  return { points, caption, total: points.reduce((s, p) => s + p.value, 0), unit: spec.measure === 'count' ? 'notes' : labelOf(spec.measure) };
}

/** A sensible chart for some rows: counts by a status-like field, a number over time when days and numbers meet. */
export function suggestChart(rows: readonly ViewRow[]): ChartSpec {
  const props = knownProps(rows);
  const groupable = props.filter((p) => !p.list && p.distinct > 1 && p.distinct <= 12);
  const status = groupable.find((p) => ['status', 'stage', 'state', 'phase'].includes(p.key.toLowerCase())) ?? groupable.find((p) => p.distinct <= 6);
  if (status) return { type: status.distinct <= 6 ? 'donut' : 'bar', by: status.key, measure: 'count' };
  const date = props.find((p) => (p.kind === 'date' || p.kind === 'datetime') && p.distinct >= 2);
  const num = props.filter((p) => p.kind === 'number' && p.distinct >= 1).sort((a, b) => b.count - a.count)[0];
  if (date && num) return { type: 'line', by: date.key, measure: num.key, agg: 'avg' };
  return { type: 'bar', by: groupable[0]?.key ?? FIELD_FOLDER, measure: 'count' };
}

// ── Making and changing formulas ──────────────────────────────────────────────────────────────────────────────────────

/** A formula's name as a person may give it: no dots (it is written formula.<name>), not too long. */
export function cleanFormulaName(raw: string): string {
  return raw.replace(/[.[\]"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** Every place a view names a key, renamed (a formula renamed keeps its column, order, filter, group, chart and summary). */
function renameKey(def: ViewDef, from: string, to: string): Partial<ViewDef> {
  const swap = (k: string | undefined) => (k === from ? to : k);
  const rekey = <T,>(map: Record<string, T>) => Object.fromEntries(Object.entries(map ?? {}).map(([k, v]) => [swap(k)!, v])) as Record<string, T>;
  return {
    columns: def.columns.map((k) => swap(k)!),
    cardProps: def.cardProps.map((k) => swap(k)!),
    groupBy: swap(def.groupBy),
    dateProp: swap(def.dateProp),
    endProp: swap(def.endProp),
    chart: def.chart ? { ...def.chart, by: swap(def.chart.by)!, measure: swap(def.chart.measure)!, ...(def.chart.target ? { target: swap(def.chart.target)! } : {}) } : undefined,
    placeProp: swap(def.placeProp),
    cover: swap(def.cover),
    sort: def.sort && { ...def.sort, prop: swap(def.sort.prop)! },
    sorts: def.sorts?.map((s) => ({ ...s, prop: swap(s.prop)! })),
    sectionBy: def.sectionBy && { ...def.sectionBy, prop: swap(def.sectionBy.prop)! },
    filters: def.filters.map((f) => ({ ...f, prop: swap(f.prop)! })),
    summaries: rekey(def.summaries),
    labels: rekey(def.labels),
  };
}

/**
 * A formula made or changed: kept under its (clean) name, a new one shown as the last column, a renamed one kept
 * wherever the old name was used. Throws in plain words when the name is empty or taken by another formula.
 */
export function withFormula(def: ViewDef, name: string, expr: string, was?: string): Partial<ViewDef> {
  const clean = cleanFormulaName(name);
  if (!clean) throw new Error('A formula needs a name, such as Total or Days left.');
  const taken = Object.keys(def.formulas ?? {}).find((n) => n.toLowerCase() === clean.toLowerCase() && n !== was);
  if (taken) throw new Error(`There’s already a formula called “${taken}”.`);
  const formulas: Record<string, string> = {};
  let placed = false;
  // A renamed formula keeps its place among the others.
  for (const [n, e] of Object.entries(def.formulas ?? {})) {
    if (n === was) {
      formulas[clean] = expr.trim();
      placed = true;
    } else formulas[n] = e;
  }
  if (!placed) formulas[clean] = expr.trim();
  const renamed = was && was !== clean ? renameKey(def, formulaKey(was), formulaKey(clean)) : {};
  const columns = renamed.columns ?? def.columns;
  return { ...renamed, formulas, columns: was ? columns : [...columns, formulaKey(clean)] };
}

/** A rollup's name as a person may give it: no dots (it is written rollup.<name>), not too long. */
export function cleanRollupName(raw: string): string {
  return raw.replace(/[.[\]"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * A rollup made or changed: kept under its (clean) name, a new one shown as the last column, a renamed one kept
 * wherever the old name was used. Throws in plain words when the name is empty or taken by another rollup, or when
 * it has no relation, no field or no way to add up.
 */
export function withRollup(def: ViewDef, name: string, rollup: RollupDef, was?: string): Partial<ViewDef> {
  const clean = cleanRollupName(name);
  if (!clean) throw new Error('A rollup needs a name, such as Total hours or How many.');
  const taken = Object.keys(def.rollups ?? {}).find((n) => n.toLowerCase() === clean.toLowerCase() && n !== was);
  if (taken) throw new Error(`There’s already a rollup called “${taken}”.`);
  if (!rollup.relation.trim() || !rollup.field.trim() || !ROLLUP_OPS.includes(rollup.op)) throw new Error('A rollup needs the relation to follow, the field to read and a way to add it up.');
  const rollups: Record<string, RollupDef> = {};
  let placed = false;
  // A renamed rollup keeps its place among the others.
  for (const [n, r] of Object.entries(def.rollups ?? {})) {
    if (n === was) {
      rollups[clean] = rollup;
      placed = true;
    } else rollups[n] = r;
  }
  if (!placed) rollups[clean] = rollup;
  const renamed = was && was !== clean ? renameKey(def, rollupKey(was), rollupKey(clean)) : {};
  const columns = renamed.columns ?? def.columns;
  return { ...renamed, rollups, columns: was ? columns : [...columns, rollupKey(clean)] };
}

/** A chart without a key it used: charted by nothing, the chart goes; measuring nothing, it counts instead. */
function chartWithout(chart: ChartSpec | undefined, key: string): ChartSpec | undefined {
  if (!chart || (chart.by !== key && chart.measure !== key && chart.target !== key)) return chart;
  if (chart.by === key) return undefined;
  const next: ChartSpec = { ...chart, measure: chart.measure === key ? 'count' : chart.measure };
  if (chart.target === key) delete next.target;
  return next;
}

/** A view's orders without the orders on a key just taken away (the next order leads). */
function withoutSortKey(def: ViewDef, key: string): Pick<ViewDef, 'sort' | 'sorts'> {
  const kept = sortsOf(def).filter((s) => s.prop !== key);
  return { sort: kept[0], sorts: kept.length > 1 ? kept : undefined };
}

/** A rollup taken away, and everywhere the view used it. */
export function withoutRollup(def: ViewDef, name: string): Partial<ViewDef> {
  const key = rollupKey(name);
  const rollups = { ...def.rollups };
  delete rollups[name];
  const drop = <T,>(map: Record<string, T>) => Object.fromEntries(Object.entries(map ?? {}).filter(([k]) => k !== key)) as Record<string, T>;
  return {
    rollups,
    columns: def.columns.filter((k) => k !== key),
    cardProps: def.cardProps.filter((k) => k !== key),
    groupBy: def.groupBy === key ? undefined : def.groupBy,
    dateProp: def.dateProp === key ? undefined : def.dateProp,
    endProp: def.endProp === key ? undefined : def.endProp,
    chart: chartWithout(def.chart, key),
    placeProp: def.placeProp === key ? undefined : def.placeProp,
    ...withoutSortKey(def, key),
    sectionBy: def.sectionBy?.prop === key ? undefined : def.sectionBy,
    filters: def.filters.filter((f) => f.prop !== key),
    summaries: drop(def.summaries),
    labels: drop(def.labels),
  };
}

/** A formula taken away, and everywhere the view used it. */
export function withoutFormula(def: ViewDef, name: string): Partial<ViewDef> {
  const key = formulaKey(name);
  const formulas = { ...def.formulas };
  delete formulas[name];
  const drop = <T,>(map: Record<string, T>) => Object.fromEntries(Object.entries(map ?? {}).filter(([k]) => k !== key)) as Record<string, T>;
  return {
    formulas,
    columns: def.columns.filter((k) => k !== key),
    cardProps: def.cardProps.filter((k) => k !== key),
    groupBy: def.groupBy === key ? undefined : def.groupBy,
    dateProp: def.dateProp === key ? undefined : def.dateProp,
    endProp: def.endProp === key ? undefined : def.endProp,
    chart: chartWithout(def.chart, key),
    placeProp: def.placeProp === key ? undefined : def.placeProp,
    ...withoutSortKey(def, key),
    sectionBy: def.sectionBy?.prop === key ? undefined : def.sectionBy,
    filters: def.filters.filter((f) => f.prop !== key),
    summaries: drop(def.summaries),
    labels: drop(def.labels),
  };
}

// ── Summaries under a table's columns (21 Oct 2026) ───────────────────────────────────────────────────────────────────

export type SummaryKind = 'count' | 'filled' | 'empty' | 'unique' | 'sum' | 'average' | 'min' | 'max' | 'earliest' | 'latest';
export const SUMMARY_KINDS: SummaryKind[] = ['count', 'filled', 'empty', 'unique', 'sum', 'average', 'min', 'max', 'earliest', 'latest'];
export const SUMMARY_WORDS: Record<SummaryKind, string> = { count: 'Count', filled: 'Filled', empty: 'Empty', unique: 'Unique', sum: 'Sum', average: 'Average', min: 'Smallest', max: 'Largest', earliest: 'Earliest', latest: 'Latest' };

/** The summaries that make sense for a column of this kind: any column can be counted; numbers add up; days go first to last. */
export function summaryChoices(kind: PropKind): SummaryKind[] {
  const any: SummaryKind[] = ['count', 'filled', 'empty', 'unique'];
  if (kind === 'number') return [...any, 'sum', 'average', 'min', 'max'];
  if (kind === 'date' || kind === 'datetime') return [...any, 'earliest', 'latest'];
  return any;
}

/**
 * The kind of value a column holds, as most of its rows write it (a formula's kind comes from what it works out to;
 * the "Changed" field is a day and time).
 */
export function columnKind(rows: readonly ViewRow[], key: string): PropKind {
  if (key === FIELD_MODIFIED) return 'datetime';
  if (key === FIELD_TITLE || key === FIELD_FOLDER) return 'text';
  if (key === FIELD_TAGS) return 'tags';
  const kinds = new Map<PropKind, number>();
  for (const r of rows) {
    const v = valueOf(r, key);
    if (isEmpty(v)) continue;
    const k = propKind(isFormulaKey(key) ? 'value' : key, v);
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  return [...kinds].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'text';
}

export interface Summary {
  /** What it is, in a word ("Average"). */
  label: string;
  /** The answer: a number, a day (2026-10-24, or with its time), or null when there is nothing to sum up. */
  value: number | string | null;
  /** Shown as a day rather than a number. */
  day: boolean;
}

const numberOf = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = valueText(v).replace(/,/g, '');
  return NUMERIC.test(t) ? Number(t) : null;
};

/** "2026-10-24", or "2026-10-24T09:30" with a time: the "Changed" field (milliseconds) and dates alike. */
function dayStamp(v: unknown, key: string): string | null {
  if (key === FIELD_MODIFIED && typeof v === 'number') {
    const d = new Date(v);
    return `${isoDay(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const d = readDate(v);
  if (!d) return null;
  const time = /(\d{2}):(\d{2})/.exec(d.time);
  return time ? `${d.iso}T${time[1]}:${time[2]}` : d.iso;
}

/**
 * One column summed up over the rows the view shows: how many rows, how many have a value or none, how many different
 * values (a list's items each count), and for numbers the sum, average, smallest and largest, for days the earliest
 * and latest. Pure, so the table and the tests share it.
 */
export function summarize(rows: readonly ViewRow[], key: string, how: SummaryKind): Summary {
  const label = SUMMARY_WORDS[how];
  const values = rows.map((r) => valueOf(r, key));
  const filled = values.filter((v) => !isEmpty(v));
  switch (how) {
    case 'count':
      return { label, value: rows.length, day: false };
    case 'filled':
      return { label, value: filled.length, day: false };
    case 'empty':
      return { label, value: rows.length - filled.length, day: false };
    case 'unique':
      return { label, value: new Set(filled.flatMap((v) => (key === FIELD_MODIFIED ? [String(v)] : items(v)))).size, day: false };
    case 'sum':
    case 'average':
    case 'min':
    case 'max': {
      const nums = filled.map(numberOf).filter((n): n is number => n !== null);
      if (!nums.length) return { label, value: null, day: false };
      const sum = nums.reduce((a, b) => a + b, 0);
      // Rounded to cents' worth, so 0.1 + 0.2 reads 0.3.
      const value = how === 'sum' ? sum : how === 'average' ? sum / nums.length : how === 'min' ? Math.min(...nums) : Math.max(...nums);
      return { label, value: Math.round(value * 100) / 100, day: false };
    }
    case 'earliest':
    case 'latest': {
      const days = filled.map((v) => dayStamp(v, key)).filter((d): d is string => !!d).sort();
      return { label, value: days.length ? (how === 'earliest' ? days[0] : days[days.length - 1]) : null, day: true };
    }
  }
}

/** A summary's answer as words: "1,250.5", or the day as written. */
export function summaryText(s: Summary): string {
  if (s.value === null) return '';
  if (typeof s.value === 'number') return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 }).format(s.value);
  return s.value;
}

// ── Writing a property into a note ────────────────────────────────────────────────────────────────────────────────────

/**
 * What a typed cell becomes, by the kind of value the property holds: a number stays a number, a tick-box a tick, a
 * list (tags, people) a list; empty takes the property off (null).
 */
export function cellValue(input: string, kind: PropKind): PropValue | null {
  const t = input.trim();
  if (!t) return null;
  switch (kind) {
    case 'number': {
      const n = Number(t.replace(/,/g, ''));
      return Number.isFinite(n) ? n : t;
    }
    case 'checkbox':
      return /^(?:true|yes|y|1|✓|ticked|done)$/i.test(t);
    case 'list':
    case 'tags':
    case 'aliases': {
      const list = t.split(',').map((s) => (kind === 'tags' ? s.trim().replace(/^#/, '') : s.trim())).filter(Boolean);
      return list.length ? list : null;
    }
    default:
      return t;
  }
}

/**
 * The note with one property set (or taken off, for null), everything else as the person wrote it — order, comments,
 * quoting, and a list written [a, b] stays that way. The property's own spelling is kept (Status stays Status).
 * Throws in plain words when the note's properties can't be read.
 */
export function setNoteProp(content: string, key: string, value: PropValue | null | undefined): string {
  // An empty word or list never deletes (9.2): only an explicit null/undefined takes a property off.
  if ((typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length)) return content;
  return changeProps(content, (doc) => {
    const map = doc.contents;
    const pair = isMap(map) ? map.items.find((p) => String((p.key as { value?: unknown })?.value ?? p.key).toLowerCase() === key.toLowerCase()) : undefined;
    const name = pair ? String((pair.key as { value?: unknown })?.value ?? pair.key) : key;
    if (value === null || value === undefined) {
      if (pair) doc.delete(name);
      return;
    }
    const node = doc.createNode(value);
    const wasFlow = !!pair && (isSeq(pair.value) || isMap(pair.value)) && !!pair.value.flow;
    if (wasFlow && (isSeq(node) || isMap(node))) node.flow = true;
    if (pair) pair.value = node;
    else doc.set(name, node);
  });
}

/** A new note's text for a view: the tag it shows and the values it was made with, as properties. */
export function newNoteText(def: ViewDef, values: Record<string, PropValue>): string {
  let text = '';
  if (def.source.kind === 'tag' && def.source.value) text = setNoteProp(text, 'tags', [def.source.value]);
  for (const [k, v] of Object.entries(values)) if (!isField(k)) text = setNoteProp(text, k, v);
  return text;
}
