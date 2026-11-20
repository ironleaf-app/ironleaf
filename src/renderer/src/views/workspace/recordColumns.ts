// Computed columns over records (10.0 Endless Tech, v10records2): the table's
// formula, rollup and summary columns as pure helpers beside the room, so every
// layout names them the same way. Files stay as the engine keeps them
// (src/shared/record-views.ts); this only reads and patches RecordViewDef.

import type { PropKind } from '../../../../shared/frontmatter';
import { fieldLabel, type FieldInfo, type FieldType, type RecordViewDef } from '../../../../shared/record-views';
import { cleanFormulaName, cleanRollupName, formulaKey, formulaName, isFormulaKey, isRollupKey, rollupKey, rollupName, summaryChoices, type RollupDef, type SummaryKind } from '../../../../shared/views';

/** A record column's heading: a formula's or rollup's own name, else the field's label. */
export function recordColumnLabel(key: string): string {
  if (isFormulaKey(key)) return formulaName(key);
  if (isRollupKey(key)) return rollupName(key);
  return fieldLabel(key);
}

/** Whether a column is worked out (a formula or a rollup): shown, never typed into. */
export const isComputedKey = (key: string): boolean => isFormulaKey(key) || isRollupKey(key);

/** A field type as the summary chooser reads it: numbers add up, days go first to last, the rest count. */
export function summaryKindFor(type: FieldType): PropKind {
  if (type === 'number' || type === 'money') return 'number';
  if (type === 'date') return 'date';
  return 'text';
}

/** The summaries that make sense for a record column of this kind. */
export function recordSummaryChoices(type: FieldType): SummaryKind[] {
  return summaryChoices(summaryKindFor(type));
}

/** A computed column's kind from what it works out to (numbers, days, the rest): sampled, never guessed. */
export function computedKind(values: readonly unknown[]): FieldType {
  const some = values.filter((v) => v !== undefined && v !== null && v !== '' && typeof v !== 'object');
  if (!some.length) return 'text';
  if (some.every((v) => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v.trim())))) return 'number';
  if (some.every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim()))) return 'date';
  if (some.every((v) => typeof v === 'boolean')) return 'bool';
  return 'text';
}

/** Every place a record view names a field, renamed. */
function renameField(def: RecordViewDef, from: string, to: string): Partial<RecordViewDef> {
  const swap = (k: string | undefined) => (k === from ? to : k);
  const rekey = <T,>(map: Record<string, T> | undefined) => (map ? (Object.fromEntries(Object.entries(map).map(([k, v]) => [swap(k)!, v])) as Record<string, T>) : undefined);
  return {
    fields: def.fields.map((k) => swap(k)!),
    groupBy: swap(def.groupBy),
    sort: def.sort && { ...def.sort, field: swap(def.sort.field)! },
    filters: def.filters.map((f) => ({ ...f, field: swap(f.field)! })),
    dateField: swap(def.dateField),
    endField: swap(def.endField),
    chart: def.chart ? { ...def.chart, by: swap(def.chart.by)!, measure: swap(def.chart.measure)!, ...(def.chart.target ? { target: swap(def.chart.target)! } : {}) } : undefined,
    summaries: rekey(def.summaries),
  };
}

/**
 * A formula made or changed: kept under its (clean) name, a new one shown as the last column, a renamed one kept
 * wherever the old name was used. Throws in plain words when the name is empty or taken by another formula.
 */
export function withRecordFormula(def: RecordViewDef, name: string, expr: string, was?: string): Partial<RecordViewDef> {
  const clean = cleanFormulaName(name);
  if (!clean) throw new Error('A formula needs a name, such as Total or Days left.');
  const taken = Object.keys(def.formulas ?? {}).find((n) => n.toLowerCase() === clean.toLowerCase() && n !== was);
  if (taken) throw new Error(`There is already a formula called "${taken}".`);
  const formulas: Record<string, string> = {};
  let placed = false;
  for (const [n, e] of Object.entries(def.formulas ?? {})) {
    if (n === was) {
      formulas[clean] = expr.trim();
      placed = true;
    } else formulas[n] = e;
  }
  if (!placed) formulas[clean] = expr.trim();
  const renamed = was && was !== clean ? renameField(def, formulaKey(was), formulaKey(clean)) : {};
  const fields = renamed.fields ?? def.fields;
  return { ...renamed, formulas, fields: was ? fields : [...fields, formulaKey(clean)] };
}

/** A formula taken away, and everywhere the view used it. */
export function withoutRecordFormula(def: RecordViewDef, name: string): Partial<RecordViewDef> {
  const key = formulaKey(name);
  const formulas = { ...def.formulas };
  delete formulas[name];
  const drop = (map: Record<string, SummaryKind> | undefined) => (map ? (Object.fromEntries(Object.entries(map).filter(([k]) => k !== key)) as Record<string, SummaryKind>) : undefined);
  const summaries = drop(def.summaries);
  return {
    formulas: Object.keys(formulas).length ? formulas : undefined,
    fields: def.fields.filter((k) => k !== key),
    groupBy: def.groupBy === key ? undefined : def.groupBy,
    sort: def.sort?.field === key ? undefined : def.sort,
    filters: def.filters.filter((f) => f.field !== key),
    dateField: def.dateField === key ? undefined : def.dateField,
    endField: def.endField === key ? undefined : def.endField,
    chart: def.chart && (def.chart.by === key || def.chart.measure === key || def.chart.target === key) ? (def.chart.by === key ? undefined : { ...def.chart, measure: def.chart.measure === key ? 'count' : def.chart.measure, ...(def.chart.target === key ? {} : def.chart.target ? { target: def.chart.target } : {}) }) : def.chart,
    ...(summaries && Object.keys(summaries).length ? { summaries } : { summaries: undefined }),
  };
}

/**
 * A rollup made or changed: kept under its (clean) name, a new one shown as the last column, a renamed one kept
 * wherever the old name was used. Throws in plain words when the name is empty or taken, or when it has no
 * relation, no field or no way to add up.
 */
export function withRecordRollup(def: RecordViewDef, name: string, rollup: RollupDef, was?: string): Partial<RecordViewDef> {
  const clean = cleanRollupName(name);
  if (!clean) throw new Error('A rollup needs a name, such as Total hours or How many.');
  const taken = Object.keys(def.rollups ?? {}).find((n) => n.toLowerCase() === clean.toLowerCase() && n !== was);
  if (taken) throw new Error(`There is already a rollup called "${taken}".`);
  if (!rollup.relation.trim() || !rollup.field.trim()) throw new Error('A rollup needs the relation to follow and the field to read.');
  const rollups: Record<string, RollupDef> = {};
  let placed = false;
  for (const [n, r] of Object.entries(def.rollups ?? {})) {
    if (n === was) {
      rollups[clean] = rollup;
      placed = true;
    } else rollups[n] = r;
  }
  if (!placed) rollups[clean] = rollup;
  const renamed = was && was !== clean ? renameField(def, rollupKey(was), rollupKey(clean)) : {};
  const fields = renamed.fields ?? def.fields;
  return { ...renamed, rollups, fields: was ? fields : [...fields, rollupKey(clean)] };
}

/** A rollup taken away, and everywhere the view used it. */
export function withoutRecordRollup(def: RecordViewDef, name: string): Partial<RecordViewDef> {
  const key = rollupKey(name);
  const rollups = { ...def.rollups };
  delete rollups[name];
  const drop = (map: Record<string, SummaryKind> | undefined) => (map ? (Object.fromEntries(Object.entries(map).filter(([k]) => k !== key)) as Record<string, SummaryKind>) : undefined);
  const summaries = drop(def.summaries);
  return {
    rollups: Object.keys(rollups).length ? rollups : undefined,
    fields: def.fields.filter((k) => k !== key),
    groupBy: def.groupBy === key ? undefined : def.groupBy,
    sort: def.sort?.field === key ? undefined : def.sort,
    filters: def.filters.filter((f) => f.field !== key),
    dateField: def.dateField === key ? undefined : def.dateField,
    endField: def.endField === key ? undefined : def.endField,
    chart: def.chart && (def.chart.by === key || def.chart.measure === key || def.chart.target === key) ? (def.chart.by === key ? undefined : { ...def.chart, measure: def.chart.measure === key ? 'count' : def.chart.measure, ...(def.chart.target === key ? {} : def.chart.target ? { target: def.chart.target } : {}) }) : def.chart,
    ...(summaries && Object.keys(summaries).length ? { summaries } : { summaries: undefined }),
  };
}

/** A column's summary set (null clears it). */
export function withRecordSummary(def: RecordViewDef, key: string, how: SummaryKind | null): Partial<RecordViewDef> {
  const summaries = { ...def.summaries };
  if (how) summaries[key] = how;
  else delete summaries[key];
  return { summaries: Object.keys(summaries).length ? summaries : undefined };
}

/** Formula and rollup columns as field entries (for the Fields panel and menus), after the real fields. */
export function computedFieldEntries(def: RecordViewDef): FieldInfo[] {
  return [
    ...Object.keys(def.formulas ?? {}).map((n) => ({ key: formulaKey(n), label: n, type: 'text' as FieldType, values: [] })),
    ...Object.keys(def.rollups ?? {}).map((n) => ({ key: rollupKey(n), label: n, type: 'text' as FieldType, values: [] })),
  ];
}
