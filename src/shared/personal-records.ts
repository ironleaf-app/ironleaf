// What the personal modules share (Wave 7 part a, 24 Oct 2026: Career, Travel, Home and Vehicles; the catalogue, 22 Oct,
// rows 12, 13, 15 and 16). Each of their records is a plain note the person owns: its properties are its fields, and its
// lists (a car's fuel log, a trip's itinerary, an application's interviews) are tables under their own headings, read by
// their column names in any order, so a change made on a page is one property or one cell and every other character
// stays as written. This file is the part they all use: a table described once (its heading, its columns and what each
// holds), read, a cell checked and written, a row added or taken out; a property's value checked; money and days read
// the way people write them; and a new note's words. Pure: no files, no Node, no DOM.

import { setTableCells, removeTableRow } from './layouts';
import { isoOf, knownWord, linkName, readDay, sectionAt, sectionTable, withColumn, withRow } from './work-sites';
// One plural rule everywhere (3 Nov 2026, fourth-round G5-G7): the shared words' count, kept exported for its importers.
import { plural } from './words';

export { isoOf, knownWord, linkName, plural, readDay, sectionAt };

export const str = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : v === null || v === undefined ? '' : String(v)).trim();
const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dateOf = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
export const daysFrom = (from: string, to: string) => Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / 86_400_000);
export const todayOf = (t: Date | string) => (typeof t === 'string' ? t.slice(0, 10) : isoOf(t));
/** "Mon 26 Oct", with the year when it isn't today's. */
export function dayWords(iso: string, today: string): string {
  const d = dateOf(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${iso.slice(0, 4) !== today.slice(0, 4) ? ` ${iso.slice(0, 4)}` : ''}`;
}
/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function whenWords(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
/** "Oct 2026" for a "2026-10" month. */
export const monthWords = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ''} ${ym.slice(0, 4)}`;
/** A day moved on by days, months or years (the 31st into a shorter month lands on its last day). */
export function addToDay(iso: string, n: { days?: number; months?: number; years?: number }): string {
  const d = dateOf(iso);
  if (n.days) d.setDate(d.getDate() + n.days);
  if (n.months || n.years) {
    const want = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + (n.months ?? 0) + (n.years ?? 0) * 12);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(want, last));
  }
  return isoOf(d);
}
/** A time as people write it ("7:05", "07:05", "7.05pm", "19:05") → "HH:MM", else ''. */
export function readTime(v: unknown): string {
  const s = str(v).toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/.exec(s);
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59 || (!m[2] && !m[3])) return '';
  return `${pad(h)}:${pad(min)}`;
}

/** An amount as people write it ("$1,234.50", "AUD 89", "$1.5k", "89.5", "-12") → a number, else null. */
export function readAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // A thousands/millions/billions suffix multiplies ("$1.5k" is 1500, never 1.5); a longer word ("1 March") is not one.
  const suf = /(\d(?:[\d,]*\d)?(?:\.\d+)?)\s*([kmb])\b/i.exec(str(v));
  const mult = !suf ? 1 : suf[2].toLowerCase() === 'k' ? 1000 : suf[2].toLowerCase() === 'm' ? 1_000_000 : 1_000_000_000;
  const s = str(v).replace(/[A-Za-z$€£¥\s,]/g, '');
  if (!s || !/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * mult * 100) / 100 : null;
}
/** A number as written ("10,234", "42.1 L") → a number, else null. */
export function readNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = /-?\d[\d,]*(?:\.\d+)?|-?\.\d+/.exec(str(v));
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
/** "$1,234.50" in a currency ("AUD" shows as $; others by their code). */
export function moneyWords(n: number | null | undefined, currency = 'AUD', cents = true): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const sym = /^(AUD|USD|NZD|CAD|SGD|HKD)$/.test(currency) ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'JPY' ? '¥' : '';
  const whole = !cents || Math.abs(n) >= 10000 || Number.isInteger(n);
  const body = Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  return `${n < 0 ? '−' : ''}${sym || `${currency} `}${body}`;
}
/** Yes for the ways people write yes. */
export const isYes = (v: unknown) => /^(y|yes|true|paid|done|full|✓|x)$/i.test(str(v));

// ── Tables under a heading ───────────────────────────────────────────────────────────────────────────────────────────

export type CellKind = 'text' | 'date' | 'time' | 'number' | 'money' | 'choice' | 'yesno';

export interface TableField {
  key: string;
  /** The column's name as a new table writes it. */
  label: string;
  /** The column names it is read from (any case). */
  col: RegExp;
  kind: CellKind;
  options?: readonly string[];
}

export interface TableSpec {
  id: string;
  /** The heading a new table is written under ("Fuel log"). */
  name: string;
  /** The headings it is read from ("Fuel log", "Fuel", "Fill-ups"…). */
  heading: RegExp;
  fields: TableField[];
  /** The field that names a row (checked before a change, so the row changed is the one shown). */
  title: string;
  /** What one row is called ("fill", "interview"), for the words said. */
  one: string;
}

export interface TableRow {
  /** Its place among the table's rows (blank rows left out, as layouts.ts counts them). */
  row: number;
  values: Record<string, string>;
}

export interface ReadTable {
  /** The heading as written, when the note has the section. */
  heading: string | null;
  rows: TableRow[];
  /** Field → column (-1 when the table has no such column). */
  cols: Record<string, number>;
}

const wantOf = (spec: TableSpec): Record<string, RegExp> => Object.fromEntries(spec.fields.map((f) => [f.key, f.col]));
const headOf = (spec: TableSpec) => spec.fields.map((f) => f.label);
const colsOf = (head: string[], spec: TableSpec): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const f of spec.fields) out[f.key] = head.findIndex((h) => f.col.test(h.trim()));
  return out;
};

/** A note's table as rows of field values (a missing column reads as empty; extra columns are kept, never read). */
export function readTable(text: string, spec: TableSpec): ReadTable {
  const src = String(text ?? '');
  const at = sectionAt(src, spec.heading);
  const t = at ? sectionTable(src.slice(at.start, at.end)) : null;
  const head = t?.head.length ? t.head : headOf(spec);
  const cols = colsOf(head, spec);
  const rows = (t?.rows ?? []).map((r, row) => ({ row, values: Object.fromEntries(spec.fields.map((f) => [f.key, cols[f.key] >= 0 ? (r[cols[f.key]] ?? '').trim() : ''])) }));
  return { heading: at?.heading ?? null, rows, cols };
}

/** One cell's words checked for its column: a day as YYYY-MM-DD, a time as HH:MM, an amount as a plain number, one of a
 *  choice's words. Throws in plain words a page or an assistant can pass on. */
export function cleanCell(f: TableField, raw: unknown): string {
  const v = str(raw).replace(/\r?\n/g, ' ').slice(0, 300);
  if (!v) return '';
  switch (f.kind) {
    case 'date': {
      const d = readDay(v);
      if (!d) throw new Error(`Give the ${f.label.toLowerCase()} as a day, like 2026-11-03.`);
      return d;
    }
    case 'time': {
      const t = readTime(v);
      if (!t) throw new Error(`Give the ${f.label.toLowerCase()} as a time, like 09:30.`);
      return t;
    }
    case 'money': {
      const n = readAmount(v);
      if (n === null) throw new Error(`Give the ${f.label.toLowerCase()} as an amount, like 84.50.`);
      return String(n);
    }
    case 'number': {
      const n = readNumber(v);
      if (n === null) throw new Error(`Give the ${f.label.toLowerCase()} as a number.`);
      return String(n);
    }
    case 'yesno':
      return isYes(v) ? 'Yes' : /^(n|no|false)$/i.test(v) ? 'No' : v;
    case 'choice':
      return knownWord(f.options ?? [], v);
    default:
      return v;
  }
}

/** Values for a new row, each checked (unknown fields left out). */
export function cleanRow(spec: TableSpec, values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of spec.fields) if (values[f.key] !== undefined && values[f.key] !== null) out[f.key] = cleanCell(f, values[f.key]);
  return out;
}

/** The note with a row added at the end of the table (the section and table made when missing, a column added for a
 *  field the table lacks). */
export function tableWithRow(text: string, spec: TableSpec, values: Record<string, string>): string {
  return withRow(text, spec.heading, spec.name, headOf(spec), wantOf(spec), values);
}

/** A section's words changed by `change` (null when the section isn't there). */
function inSection(text: string, spec: TableSpec, change: (body: string) => string): string {
  const at = sectionAt(text, spec.heading);
  if (!at) throw new Error(`That ${spec.one} isn’t in the note any more.`);
  const body = text.slice(at.start, at.end);
  const next = change(body);
  return next === body ? text : text.slice(0, at.start) + next + text.slice(at.end);
}

/** A table line given at least `n` cells (a row written short gets empty ones), so a cell past its end can be set. */
function widened(body: string, row: number, n: number): string {
  const lines = body.split(/\r?\n/);
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const TABLE = /^\s*\|.*\|\s*$/;
  let i = lines.findIndex((l) => TABLE.test(l));
  if (i < 0) return body;
  const block: number[] = [];
  for (; i < lines.length && TABLE.test(lines[i]); i++) block.push(i);
  const rule = (l: string) => /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*$/.test(l);
  const rows = block.slice(1).filter((k) => !rule(lines[k]) && lines[k].replace(/[|\s]/g, ''));
  const at = rows[row];
  if (at === undefined) return body;
  const have = lines[at].trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).length;
  if (have >= n) return body;
  lines[at] = `${lines[at].replace(/\s+$/, '')}${'  |'.repeat(n - have)}`;
  return lines.join(eol);
}

/** The note with one cell of a row changed, its column found by name (added when the table has none). The row must still
 *  be the one shown (its title unchanged), else nothing is written and the person is asked to look again. */
export function tableWithCell(text: string, spec: TableSpec, row: number, shownTitle: string | null, field: string, words: string): string {
  const f = spec.fields.find((x) => x.key === field);
  if (!f) throw new Error('That can’t be changed here.');
  return inSection(text, spec, (body) => {
    let table = sectionTable(body);
    if (!table || row < 0 || row >= table.rows.length) throw new Error(`That ${spec.one} isn’t in the table any more.`);
    let cols = colsOf(table.head, spec);
    const t = cols[spec.title];
    if (shownTitle !== null && t !== undefined && t >= 0 && (table.rows[row][t] ?? '').trim() !== shownTitle.trim()) throw new Error(`That ${spec.one} changed just now. The page shows it as it is now: make the change again.`);
    let b = body;
    if (cols[field] === undefined || cols[field] < 0) {
      b = withColumn(b, f.label);
      table = sectionTable(b)!;
      cols = colsOf(table.head, spec);
    }
    b = widened(b, row, cols[field] + 1);
    return setTableCells(b, row, { [cols[field]]: words });
  });
}

/** The note with one row taken out (it must still be the one shown). Gives the note and the row's title. */
export function tableWithoutRow(text: string, spec: TableSpec, row: number, shownTitle: string | null): { text: string; gone: string } {
  let gone = '';
  const next = inSection(text, spec, (body) => {
    const table = sectionTable(body);
    const r = table?.rows[row];
    if (!table || !r) throw new Error(`That ${spec.one} isn’t in the table any more.`);
    const t = colsOf(table.head, spec)[spec.title];
    gone = t !== undefined && t >= 0 ? (r[t] ?? '').trim() : '';
    if (shownTitle !== null && t !== undefined && t >= 0 && gone !== shownTitle.trim()) throw new Error(`That ${spec.one} changed just now. Look again, then take it out.`);
    return removeTableRow(body, row);
  });
  return { text: next, gone };
}

// ── Properties ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type PropKind = 'text' | 'date' | 'number' | 'money' | 'choice' | 'link' | 'links' | 'url' | 'email' | 'phone';

export interface PropSpec {
  /** The record's field shown on pages and in views. */
  field: string;
  /** The property it is written as. */
  key: string;
  kind: PropKind;
  label: string;
  options?: readonly string[];
}

/** A property's value checked for writing (null takes it off). Throws in plain words. */
export function propValue(p: PropSpec, raw: unknown): string | number | string[] | null {
  if (p.kind === 'links') {
    const list = (Array.isArray(raw) ? raw : str(raw).split(/\s*[,;]\s*/)).map((x) => linkName(x)).filter(Boolean);
    return list.length ? [...new Set(list)].slice(0, 30).map((x) => `[[${x}]]`) : null;
  }
  const v = str(raw).replace(/\r?\n/g, ' ').slice(0, 300);
  if (!v) return null;
  switch (p.kind) {
    case 'date': {
      const d = readDay(v);
      if (!d) throw new Error(`Give the ${p.label.toLowerCase()} as a day, like 2027-03-31.`);
      return d;
    }
    case 'number':
    case 'money': {
      const n = p.kind === 'money' ? readAmount(v) : readNumber(v);
      if (n === null) throw new Error(`Give the ${p.label.toLowerCase()} as ${p.kind === 'money' ? 'an amount, like 1200' : 'a number'}.`);
      return n;
    }
    case 'choice':
      return knownWord(p.options ?? [], v) || null;
    case 'link':
      return linkName(v) ? `[[${linkName(v)}]]` : null;
    case 'url':
      return /^[a-z]+:\/\//i.test(v) || !/\./.test(v) ? v : `https://${v}`;
    default:
      return v;
  }
}

/** A list property's names ("[[Sam]]", "Sam, Jo" or a YAML list) → names. */
export function namesOf(v: unknown): string[] {
  const list = Array.isArray(v) ? v : str(v) ? str(v).split(/\s*[,;]\s*/) : [];
  return [...new Set(list.map((x) => linkName(x)).filter(Boolean))];
}

// ── New notes ────────────────────────────────────────────────────────────────────────────────────────────────────────

const yamlWords = (s: string) => (s === '' || /^[\s\-?:,[\]{}#&*!|>'"%@`]|:\s|:$|\s#|\s$/.test(s) || /^(true|false|yes|no|null|on|off|~)$/i.test(s) || /^[\d.+-]+$/.test(s) ? JSON.stringify(s) : s);

/** A property line ("make: Tillcraft", "contacts: ["[[Sam]]"]"); empty values written as "key:" so the field is there to
 *  fill in. */
export function propLine(key: string, v: string | number | string[] | null | undefined): string {
  if (v === null || v === undefined || v === '') return `${key}:`;
  if (Array.isArray(v)) return v.length ? `${key}: [${v.map((x) => JSON.stringify(x)).join(', ')}]` : `${key}: []`;
  if (typeof v === 'number') return `${key}: ${v}`;
  if (/^\[\[.*\]\]$/.test(v)) return `${key}: ${JSON.stringify(v)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${key}: ${v}`;
  return `${key}: ${yamlWords(v)}`;
}

/** A new note: its type and properties (in the order given), then its body. */
export function noteText(type: string, props: [string, string | number | string[] | null | undefined][], body: string): string {
  return `---\ntype: ${type}\n${props.map(([k, v]) => propLine(k, v)).join('\n')}\n---\n${body}`;
}

/** An empty table under its heading, for a new note's body. */
export function emptyTable(spec: TableSpec, rows: Record<string, string>[] = []): string {
  const head = headOf(spec);
  const lines = [`## ${spec.name}`, '', `| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const r of rows) lines.push(`| ${spec.fields.map((f) => String(r[f.key] ?? '').replace(/\|/g, '\\|') || ' ').join(' | ')} |`);
  return `${lines.join('\n')}\n\n`;
}

/** Words added as a dated line under a heading (made when missing, before Notes): an application's timeline. */
export function withLogLine(text: string, heading: RegExp, name: string, line: string): string {
  const src = String(text ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const at = sectionAt(src, heading);
  if (!at) {
    const notes = sectionAt(src, /^notes$/i);
    const block = `## ${name}${eol}${eol}- ${line}${eol}${eol}`;
    if (notes) {
      const headStart = src.lastIndexOf('##', notes.start - 1);
      return src.slice(0, headStart) + block + src.slice(headStart);
    }
    return `${src.replace(/\s*$/, '')}${eol}${eol}${block}`;
  }
  const body = src.slice(at.start, at.end);
  const trimmed = body.replace(/\s*$/, '');
  const next = `${trimmed ? `${trimmed}${eol}` : eol}- ${line}${eol}${eol}`;
  return src.slice(0, at.start) + next + src.slice(at.end);
}

/** Words added under the note's Notes (made at the end when missing). */
export function withNoteWords(text: string, words: string): string {
  const src = String(text ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const at = sectionAt(src, /^notes$/i);
  if (!at) return `${src.replace(/\s*$/, '')}${eol}${eol}## Notes${eol}${eol}${words}${eol}`;
  const body = src.slice(at.start, at.end).replace(/\s*$/, '');
  return `${src.slice(0, at.start)}${body ? `${body}${eol}${eol}` : eol}${words}${eol}${src.slice(at.end).replace(/^\s*/, at.end < src.length ? eol : '')}`;
}

/** A section's plain words (no heading, no table), for an assistant's answer or a page's text. */
export function sectionWords(text: string, heading: RegExp): string {
  const src = String(text ?? '');
  const at = sectionAt(src, heading);
  return at ? src.slice(at.start, at.end).trim() : '';
}

/** Is it a picture (by its name)? */
export const isImage = (p: string) => /\.(png|jpe?g|gif|webp|avif|heic|bmp)$/i.test(p);

/** What a module tool answers when some of the module's notes are at a level the asker may not read. */
export function refusedWords(refused: number | undefined, what: string, agent = 'this agent'): string {
  return refused ? `${plural(refused, what)} ${refused === 1 ? 'is' : 'are'} at a level ${agent} isn’t allowed (the person sets this in Ironleaf › Settings › Privacy and secrets). Don’t guess at what ${refused === 1 ? 'it says' : 'they say'}.` : '';
}

export const join = (lines: (string | false | null | undefined)[]) => lines.filter(Boolean).join('\n');

/** The names that best match some words: whole name, then a name that contains them, then words that contain a name. */
export function findByName<T>(list: readonly T[], words: unknown, names: (x: T) => string[]): T | undefined {
  const w = str(words).toLowerCase().replace(/\.md$/, '');
  if (!w) return undefined;
  const all = (x: T) => names(x).map((n) => n.toLowerCase()).filter(Boolean);
  return list.find((x) => all(x).includes(w)) ?? list.find((x) => all(x).some((n) => n.includes(w))) ?? list.find((x) => all(x).some((n) => n.length > 2 && w.includes(n)));
}
