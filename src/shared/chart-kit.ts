// One chart kit (8.0 Phase 5, 28 Oct 2026; the Uplift plan: "one chart kit: /chart, make_chart, dashboards"). A chart is
// a small block in a note that says what to chart, never the figures themselves, so it stays true as the notes change:
//
//   ```chart
//   title: October by category
//   type: pie                      bar, line or pie
//   source:                        which notes: folder, tag, type, where (property filters) or words in their names
//     folder: Me/Finance/Spending
//   table: Spending                optional: the rows of the table under this heading in each note are what is counted
//   by: Category                   the property (or column) whose values are the bars, slices or points
//   bucket: month                  optional, when `by` is a day: by month, week or year
//   measure: Amount                count (the default), or a number property or column to add up
//   agg: sum                       sum (the default) or avg
//   ```
//
// or, for figures a person or a module gave (a chart of a list, a module's answer), the figures with where they came from:
//   points: [{label: Groceries, value: 412.5}]   from: Finance › Spending, October 2026
//
// Ironleaf draws the block live (lib/charts.ts, in Reading and Live Preview) as a Mermaid chart in the person's own
// colours; /chart writes one (editor/slash.ts); the former host app's make_chart tool and its dashboards write the same
// block and work out the same figures with this file (built into the former host app as vault-kit.mjs). Pure: no files,
// no Node, no DOM.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { knownProps, readView, valueText, type ViewDef, type ViewNote } from './views';
import { readTable } from './layouts';
import { plural } from './words';

export const CHART_KINDS = ['bar', 'line', 'pie'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];
export const CHART_KIND_WORDS: Record<ChartKind, string> = { bar: 'bars', line: 'a line', pie: 'a pie' };
export const CHART_LANG = 'chart';

export interface ChartSource {
  folder?: string;
  tag?: string;
  type?: string;
  where?: { prop: string; op: string; value?: string }[];
  words?: string;
}
export interface ChartPointIn {
  label: string;
  value: number;
}
export interface ChartBlock {
  title?: string;
  type: ChartKind;
  source?: ChartSource;
  table?: string;
  by?: string;
  bucket?: 'month' | 'week' | 'year';
  measure?: string;
  agg?: 'sum' | 'avg';
  top?: number;
  points?: ChartPointIn[];
  from?: string;
  y_label?: string;
}
export interface ChartRow {
  title: string;
  path: string;
  props: Record<string, unknown>;
}
export interface ChartPoint {
  key: string;
  label: string;
  value: number;
}
/** A note as the kit reads it: what views read, and its words when a chart counts the rows of its tables. */
export interface ChartNote extends ViewNote {
  text?: string;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) || undefined : undefined);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A chart block from anything (its words, a tool's arguments): only what it understands kept; `problem` says why not. */
export function cleanChart(raw: unknown): { chart: ChartBlock; problem: string | null } {
  const r = obj(raw);
  const t = String(r.type ?? 'bar').toLowerCase();
  const type: ChartKind = t === 'ring' || t === 'donut' ? 'pie' : (CHART_KINDS as readonly string[]).includes(t) ? (t as ChartKind) : 'bar';
  const chart: ChartBlock = { type };
  const title = str(r.title, 80);
  if (title) chart.title = title;
  const points = Array.isArray(r.points)
    ? (r.points as unknown[])
        .map(obj)
        .map((p) => ({ label: str(p.label ?? p.name, 60) ?? '', value: readNumber(p.value) }))
        .filter((p): p is ChartPointIn => !!p.label && p.value !== null)
        .slice(0, 40)
    : [];
  if (points.length) {
    chart.points = points;
    const from = str(r.from, 160);
    if (from) chart.from = from;
    if (!from) return { chart, problem: 'Say where the figures came from (from:). Figures are never made up.' };
    return { chart, problem: null };
  }
  const s = obj(r.source);
  const source: ChartSource = {};
  for (const k of ['folder', 'tag', 'type', 'words'] as const) {
    const v = str(s[k] ?? (k === 'folder' || k === 'tag' ? r[k] : undefined), 300);
    if (v) source[k] = k === 'folder' ? v.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : k === 'tag' ? v.replace(/^#/, '') : v;
  }
  if (Array.isArray(s.where))
    source.where = (s.where as unknown[])
      .map(obj)
      .filter((w) => str(w.prop ?? w.key))
      .slice(0, 10)
      .map((w) => ({ prop: str(w.prop ?? w.key)!, op: str(w.op) ?? 'is', ...(w.value !== undefined ? { value: String(w.value) } : {}) }));
  if (Object.keys(source).length) chart.source = source;
  const table = str(r.table, 80);
  if (table) chart.table = table;
  const by = str(r.by, 80);
  if (by) chart.by = by;
  const bucket = String(r.bucket ?? '').toLowerCase();
  if (bucket === 'month' || bucket === 'week' || bucket === 'year') chart.bucket = bucket;
  const measure = str(r.measure, 80);
  if (measure && measure.toLowerCase() !== 'count') chart.measure = measure;
  if (r.agg === 'avg' || r.agg === 'average') chart.agg = 'avg';
  if (typeof r.top === 'number' && r.top >= 2) chart.top = Math.min(24, Math.floor(r.top));
  const y = str(r.y_label, 40);
  if (y) chart.y_label = y;
  if (!chart.source) return { chart, problem: 'Say which notes to chart (source: a folder, a tag or a type), or give the figures (points) and where they came from.' };
  if (!chart.by) return { chart, problem: 'Say what the bars, slices or points are (by: a property, or a table column, such as category).' };
  return { chart, problem: null };
}

/** A chart block's words read (YAML, or JSON). */
export function readChartBlock(text: string): { chart: ChartBlock; problem: string | null } {
  let raw: unknown;
  try {
    raw = parseYaml(String(text ?? ''), { prettyErrors: false, logLevel: 'error' });
  } catch {
    return { chart: { type: 'bar' }, problem: 'This chart’s settings can’t be read. Open it in Source mode to put them right.' };
  }
  return cleanChart(raw);
}

/** The block as a note keeps it: ```chart, its settings as YAML, ```. */
export function writeChartBlock(chart: ChartBlock): string {
  const { chart: c } = cleanChart(chart);
  const ordered: Record<string, unknown> = {};
  for (const k of ['title', 'type', 'source', 'table', 'by', 'bucket', 'measure', 'agg', 'top', 'y_label', 'points', 'from'] as const) if (c[k] !== undefined) ordered[k] = c[k];
  return `\`\`\`${CHART_LANG}\n${stringifyYaml(ordered, { lineWidth: 0 }).trimEnd()}\n\`\`\``;
}

/** The view that picks a chart's notes (Ironleaf's own view rules): a folder or tag, a type, filters, words. */
export function chartSelection(source: ChartSource | undefined): ViewDef {
  const s = source ?? {};
  const filters: { prop: string; op: string; value?: string }[] = [...(s.where ?? [])];
  if (s.type) filters.push({ prop: 'type', op: 'is', value: s.type });
  if (s.words) filters.push({ prop: 'file.title', op: 'contains', value: s.words });
  const view = readView(JSON.stringify({ version: 1, source: s.folder ? { kind: 'folder', value: s.folder } : s.tag ? { kind: 'tag', value: s.tag } : { kind: 'all' }, layout: 'table', filters })).def;
  if (s.folder && s.tag) view.filters.push({ prop: 'file.tags', op: 'contains', value: s.tag });
  return view;
}

/** A section of a note by its heading (any level), up to the next heading of that level or above; null when not there. */
export function sectionBody(text: string, heading: string): string | null {
  const lines = String(text ?? '').split(/\r?\n/);
  const want = String(heading).trim().toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (!m) continue;
    if (start < 0) {
      if (m[2].toLowerCase() === want) {
        start = i + 1;
        level = m[1].length;
      }
    } else if (m[1].length <= level) return lines.slice(start, i).join('\n');
  }
  return start < 0 ? null : lines.slice(start).join('\n');
}

/** What a chart counts: each note picked, or each row of the named table in each note picked. */
export function chartRows(notes: readonly ChartNote[], chart: Pick<ChartBlock, 'table'>): ChartRow[] {
  if (!chart.table) return notes.map((n) => ({ title: n.title, path: n.path, props: { ...n.props, 'file.title': n.title, 'file.folder': n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '' } }));
  const out: ChartRow[] = [];
  for (const n of notes) {
    const body = sectionBody(n.text ?? '', chart.table);
    if (body === null) continue;
    const t = readTable(body);
    if (!t || !t.head.length) continue;
    for (const row of t.rows) {
      const props: Record<string, unknown> = {};
      t.head.forEach((h, i) => (props[h] = row[i] ?? ''));
      out.push({ title: n.title, path: n.path, props });
    }
  }
  return out;
}

/** A number as people write it ("$1,200.50", "(80)" for a refund, 3). */
export function readNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '')
    .replace(/[,\s$€£¥]|AUD|NZD|USD/gi, '')
    .replace(/^\((.*)\)$/, '-$1');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}
function dayOf(v: unknown): Date | null {
  const s = String(v ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const a = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return a ? new Date(Number(a[3]), Number(a[2]) - 1, Number(a[1])) : null;
}
function bucketOf(v: unknown, bucket: 'month' | 'week' | 'year'): { key: string; label: string } | null {
  const d = dayOf(v);
  if (!d) return null;
  if (bucket === 'year') return { key: String(d.getFullYear()), label: String(d.getFullYear()) };
  if (bucket === 'week') {
    const m = new Date(d);
    m.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return { key: isoDay(m), label: `${m.getDate()} ${MONTHS[m.getMonth()]}` };
  }
  return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` };
}
const fieldOf = (props: Record<string, unknown>, key: string): unknown => {
  if (Object.hasOwn(props, key)) return props[key];
  const k = Object.keys(props).find((x) => x.toLowerCase() === key.toLowerCase());
  return k === undefined ? undefined : props[k];
};

/** The chart's points: a label and a value for each group, in order; past `top`, the smallest groups as "Other". */
export function chartPoints(rows: readonly ChartRow[], chart: Pick<ChartBlock, 'by' | 'bucket' | 'measure' | 'agg' | 'top'>): { points: ChartPoint[]; counted: number; unreadable: number } {
  const by = String(chart.by ?? '');
  const measure = chart.measure && chart.measure.toLowerCase() !== 'count' ? chart.measure : '';
  const avg = chart.agg === 'avg';
  const groups = new Map<string, { label: string; sum: number; n: number }>();
  let counted = 0;
  let unreadable = 0;
  for (const r of rows) {
    const raw = fieldOf(r.props, by);
    let g: { key: string; label: string } | null;
    if (chart.bucket) g = bucketOf(raw, chart.bucket);
    else {
      const s = Array.isArray(raw) ? raw.map((x) => valueText(x)).join(', ') : valueText(raw);
      g = s ? { key: s.toLowerCase(), label: s.replace(/^\[\[|\]\]$/g, '') } : { key: '', label: '(none)' };
    }
    if (!g) {
      unreadable++;
      continue;
    }
    let v = 1;
    if (measure) {
      const n = readNumber(fieldOf(r.props, measure));
      if (n === null) {
        unreadable++;
        continue;
      }
      v = n;
    }
    const x = groups.get(g.key) ?? { label: g.label, sum: 0, n: 0 };
    x.sum += v;
    x.n++;
    groups.set(g.key, x);
    counted++;
  }
  let points = [...groups].map(([key, x]) => ({ key, label: x.label, value: Math.round((avg ? x.sum / x.n : x.sum) * 100) / 100 }));
  if (chart.bucket) points.sort((a, b) => a.key.localeCompare(b.key));
  else points.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const top = Math.max(2, Math.min(24, chart.top ?? (chart.bucket ? 24 : 10)));
  if (!chart.bucket && points.length > top) {
    const rest = points.slice(top - 1);
    points = [...points.slice(0, top - 1), { key: 'other', label: 'Other', value: Math.round(rest.reduce((s, p) => s + p.value, 0) * 100) / 100 }];
  }
  if (chart.bucket && points.length > top) points = points.slice(-top);
  return { points, counted, unreadable };
}

const mq = (s: string) => String(s).replace(/"/g, '”').replace(/[\r\n]+/g, ' ').slice(0, 60);
/** The chart as Mermaid, which Ironleaf draws in the person's colours. */
export function mermaidOf(type: ChartKind | 'ring', title: string, points: readonly { label: string; value: number }[], { yLabel = '' }: { yLabel?: string } = {}): string {
  if (type === 'pie' || type === 'ring') return ['pie showData', `    title ${mq(title)}`, ...points.filter((p) => p.value > 0).map((p) => `    "${mq(p.label)}" : ${p.value}`)].join('\n');
  const max = Math.max(0, ...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  return ['xychart-beta', `    title "${mq(title)}"`, `    x-axis [${points.map((p) => `"${mq(p.label)}"`).join(', ')}]`, `    y-axis "${mq(yLabel)}" ${Math.floor(min)} --> ${Math.ceil(max * 1.1) || 1}`, `    ${type === 'line' ? 'line' : 'bar'} [${points.map((p) => p.value).join(', ')}]`].join('\n');
}

// One plural rule everywhere (3 Nov 2026, fourth-round G5-G7): imported from ./words above.

/** What a chart was worked out from, in a line under it. */
export function chartCaption(chart: ChartBlock, r: { counted: number; unreadable: number }): string {
  if (chart.points) return `Figures from ${chart.from ?? 'the person'}.`;
  const s = chart.source ?? {};
  const where = s.folder ? `in ${s.folder}` : s.tag ? `tagged #${s.tag}` : s.type ? `of type ${s.type}` : 'picked';
  const what = chart.table ? `${plural(r.counted, 'row')} of the ${chart.table} tables of the notes ${where}` : `${plural(r.counted, 'note')} ${where}`;
  const how = chart.measure ? `${chart.agg === 'avg' ? 'the average' : 'the total'} of ${chart.measure}` : 'counted';
  return `From ${what}, ${how} by ${chart.by}${chart.bucket ? ` (by ${chart.bucket})` : ''}${r.unreadable ? `; ${plural(r.unreadable, 'row')} without a readable ${chart.measure ?? chart.by} left out` : ''}.`;
}

/** Everything a chart block shows: its points, its Mermaid source and its caption, from the notes given (already only
 *  those the reader may see). */
export function workChart(chart: ChartBlock, notes: readonly ChartNote[]): { points: ChartPoint[]; mermaid: string; caption: string; counted: number } {
  if (chart.points) {
    const points = chart.points.map((p) => ({ key: p.label.toLowerCase(), label: p.label, value: p.value }));
    return { points, mermaid: mermaidOf(chart.type, chart.title ?? '', points, { yLabel: chart.y_label }), caption: chartCaption(chart, { counted: points.length, unreadable: 0 }), counted: points.length };
  }
  const r = chartPoints(chartRows(notes, chart), chart);
  return { points: r.points, mermaid: mermaidOf(chart.type, chart.title ?? '', r.points, { yLabel: chart.y_label ?? chart.measure ?? '' }), caption: chartCaption(chart, r), counted: r.counted };
}

/** A first chart for some notes (/chart): a property with a handful of values to group by and a number to add up when
 *  there is one; for notes whose words are a table (a month of spending), the table's columns the same way. */
export function suggestChart(notes: readonly ChartNote[], source: ChartSource): ChartBlock | null {
  const rows = notes.map((n) => ({ path: n.path, title: n.title, folder: '', mtime: n.mtime, tags: n.tags, props: n.props }));
  const props = knownProps(rows).filter((p) => p.key.toLowerCase() !== 'type');
  // A value each note has its own of (a month's note's month) names the note; it isn't a group.
  const groupable = props.find((p) => !p.list && p.kind !== 'date' && p.kind !== 'datetime' && p.distinct > 0 && p.distinct <= 12 && p.distinct < rows.length);
  const number = props.find((p) => p.kind === 'number');
  const name = source.folder?.split('/').pop() ?? source.tag ?? 'Notes';
  if (groupable) return { title: `${name} by ${groupable.key}`, type: groupable.distinct <= 6 ? 'pie' : 'bar', source, by: groupable.key, ...(number ? { measure: number.key } : {}) };
  // A table in the notes: its rows across every note under the same heading; a column whose words repeat (a category) to
  // group by, its first column of numbers to add up, or its days by month.
  for (const n of notes) {
    const m = /^(#{1,6})\s+(.+)$/m.exec(n.text ?? '');
    if (!m) continue;
    const table = m[2].trim();
    const rowsOf = chartRows(notes, { table });
    if (!rowsOf.length) continue;
    const head = Object.keys(rowsOf[0].props);
    const col = (test: (vals: string[]) => boolean) => head.find((h) => test(rowsOf.map((r) => String(r.props[h] ?? ''))));
    const measure = col((v) => v.every((x) => !x || readNumber(x) !== null) && v.some((x) => readNumber(x) !== null));
    const by = col((v) => {
      const filled = v.filter(Boolean);
      return filled.length > 1 && new Set(filled).size < filled.length && new Set(filled).size <= 12 && filled.every((x) => readNumber(x) === null && !/^\d{4}-\d{2}-\d{2}$/.test(x));
    });
    const day = col((v) => v.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)));
    if (by) return { title: `${name} by ${by}`, type: 'pie', source, table, by, ...(measure ? { measure } : {}) };
    if (day && measure) return { title: `${name} by month`, type: 'bar', source, table, by: day, bucket: 'month', measure };
  }
  return groupable === undefined && props.find((p) => p.kind === 'date') ? { title: `${name} by month`, type: 'bar', source, by: props.find((p) => p.kind === 'date')!.key, bucket: 'month' } : null;
}
