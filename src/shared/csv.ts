// Spreadsheets in and out of views (21 Oct 2026). Out: "Export as CSV…" writes what a view shows — its notes, filtered
// and in its order, its columns with formulas worked out — as plain words a spreadsheet opens straight away (UTF-8 with
// the byte-order mark Excel looks for, Windows line ends). In: "Import CSV…" turns each row of a spreadsheet into a
// note, one column naming it and the others becoming its properties, read as numbers, ticks and days where every row
// agrees. Pure: the files are read and written in the main side (src/main/app.ts); the tests run this directly.

import { changeProps } from './frontmatter';
import { isoDay } from './days';
import { cleanFileName } from './paths';
import { columnLabel, FIELD_MODIFIED, FIELD_TITLE, isEmpty, usesColumns, valueOf, valueText, type ViewDef, type ViewRow } from './views';
import type { PropValue } from './frontmatter';

// ── Out ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const BOM = '﻿';

/**
 * One cell as CSV writes it: in quotes when it holds a comma, a quote or a line break. Words that a spreadsheet would
 * take as a formula of its own (=, +, - or @ at the start, not a plain number) get a ' in front, so opening the file
 * never runs anything in it.
 */
export function csvCell(text: string): string {
  let t = text;
  if (/^[=+\-@\t\r]/.test(t) && !/^[+-]?\d+(?:[.,]\d+)?$/.test(t)) t = `'${t}`;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Rows of words as a CSV file's text: the byte-order mark first, each row on its own Windows line. */
export function toCsv(table: string[][]): string {
  return BOM + table.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** "[[Saltwater Bakehouse|the bakery]]" reads "the bakery", as the view shows it. */
const unlink = (s: string) => s.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target);

/** A value as plain words in a spreadsheet: ticks as Yes and No, lists as "a, b", "Changed" as a day and time. */
export function exportText(v: unknown, key: string): string {
  if (key === FIELD_MODIFIED && typeof v === 'number') {
    const d = new Date(v);
    return `${isoDay(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (isEmpty(v)) return '';
  return unlink(valueText(v));
}

/** The columns a view shows in its layout, the note's name first. */
export function shownColumns(def: ViewDef): string[] {
  const rest = usesColumns(def.layout) ? def.columns : [def.layout === 'board' ? def.groupBy : def.dateProp, ...def.cardProps];
  return [FIELD_TITLE, ...rest.filter((k): k is string => !!k && k !== FIELD_TITLE)].filter((k, i, all) => all.indexOf(k) === i);
}

/** What a view shows as rows of words: a heading row (the view's own headings), then a row per note. */
export function viewTable(def: ViewDef, rows: readonly ViewRow[]): string[][] {
  const keys = shownColumns(def);
  return [keys.map((k) => columnLabel(def, k)), ...rows.map((r) => keys.map((k) => exportText(valueOf(r, k), k)))];
}

/** A view as a CSV file's text. */
export const viewCsv = (def: ViewDef, rows: readonly ViewRow[]): string => toCsv(viewTable(def, rows));

// ── In ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A CSV file's rows: quoted cells (with "" inside them and line breaks), Windows or Unix line ends, the byte-order mark
 * dropped, and the separator found from the first line (a comma; a semicolon or a tab, as spreadsheets set to other
 * languages write them). Blank lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const sep = separatorOf(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && !cell) quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

function separatorOf(src: string): string {
  let line = '';
  let quoted = false;
  for (const c of src) {
    if (c === '"') quoted = !quoted;
    if (!quoted && (c === '\n' || c === '\r')) break;
    if (!quoted) line += c;
  }
  const counts = [',', ';', '\t'].map((s) => [s, line.split(s).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ',';
}

export type ImportKind = 'text' | 'number' | 'checkbox' | 'date' | 'list';

export interface ImportColumn {
  /** The property's name, as the heading writes it. */
  key: string;
  kind: ImportKind;
}

export interface ImportedNote {
  /** The note's name (its file name, cleaned of what file names can't hold). */
  name: string;
  props: Record<string, PropValue>;
}

export interface ImportPlan {
  /** The column naming the notes. */
  nameColumn: string;
  columns: ImportColumn[];
  notes: ImportedNote[];
  /** Rows left out, and why, in a few words ("3 rows had no name"). */
  skipped: number;
}

const YES = /^(?:yes|true|y|✓|x)$/i;
const NO = /^(?:no|false|n)$/i;
const NUMBER = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;
// Australian days first (24/10/2026); a day over 12 in the second place reads the American way round.
const SLASH_DAY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

function slashDay(t: string, monthFirst: boolean): string | null {
  const m = SLASH_DAY.exec(t);
  if (!m) return null;
  const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [d, mo] = monthFirst ? [b, a] : [a, b];
  const date = new Date(y, mo - 1, d);
  return date.getMonth() === mo - 1 && date.getDate() === d ? isoDay(date) : null;
}

const FLAG_HEAD = /^(done|paid|active|enabled|disabled|subscribed|opt-?in|confirmed|approved|completed|finished|ticked|checked|passed|failed|open|closed|archived|pinned|flagged|gst|registered|member|attending|rsvp|yes\/no)\??$/i;
const QUESTION_HEAD = /\?$/;
const START_HEAD = /^(has|have|is|are|can|could|should|did|does|do|was|were|will)[\s_]/i;

/** What a column holds, when every filled cell agrees: numbers, ticks, days, a list (a tags column), else words. */
function kindOf(key: string, cells: string[]): { kind: ImportKind; monthFirst: boolean } {
  const filled = cells.map((c) => c.trim()).filter(Boolean);
  const lower = key.toLowerCase();
  if (lower === 'tags' || lower === 'tag' || lower === 'aliases') return { kind: 'list', monthFirst: false };
  if (!filled.length) return { kind: 'text', monthFirst: false };
  if (filled.every((c) => NUMBER.test(c))) return { kind: 'number', monthFirst: false };
  if (filled.every((c) => YES.test(c) || NO.test(c))) {
    if (filled.some((c) => !/^[xyn]$/i.test(c))) return { kind: 'checkbox', monthFirst: false };
    // Bare Y/N alone: ticks only when the heading reads as a flag (F19: a GST column of Y/N is ticks; a Notes column of Y/N stays words).
    const head = key.trim();
    if (FLAG_HEAD.test(head) || QUESTION_HEAD.test(head) || START_HEAD.test(head)) return { kind: 'checkbox', monthFirst: false };
  }
  if (filled.every((c) => ISO_DAY.test(c))) return { kind: 'date', monthFirst: false };
  if (filled.every((c) => SLASH_DAY.test(c))) {
    const monthFirst = filled.some((c) => Number(SLASH_DAY.exec(c)![2]) > 12) && !filled.some((c) => Number(SLASH_DAY.exec(c)![1]) > 12);
    if (filled.every((c) => slashDay(c, monthFirst))) return { kind: 'date', monthFirst };
  }
  return { kind: 'text', monthFirst: false };
}

function cellAs(cell: string, kind: ImportKind, monthFirst: boolean): PropValue | null {
  const t = cell.trim();
  if (!t) return null;
  switch (kind) {
    case 'number':
      return Number(t.replace(/,/g, ''));
    case 'checkbox':
      return YES.test(t);
    case 'date':
      return slashDay(t, monthFirst) ?? t.replace(' ', 'T').slice(0, 16);
    case 'list': {
      const list = t.split(/[,;]/).map((s) => s.trim().replace(/^#/, '')).filter(Boolean);
      return list.length ? list : null;
    }
    default:
      return t;
  }
}

/** A name a file can hold: no \ / : * ? " < > |, no dot or space at the end, not too long. */
export function cleanNoteName(raw: string): string {
  return cleanFileName(raw, '', 150);
}

/** The heading row's names as properties (an empty heading is "Column 3"; one written twice gets a 2; a table with
 *  no headings gets "Column 1…" so its first row stays data — F20). */
export function csvHeadings(table: string[][]): string[] {
  if (!hasHeadings(table)) {
    const width = Math.max(0, ...table.map((r) => r.length));
    return Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  }
  const headings = (table[0] ?? []).map((h, i) => h.trim() || `Column ${i + 1}`);
  return headings.map((h, i) => (headings.indexOf(h) === i ? h : `${h} ${headings.slice(0, i).filter((x) => x === h).length + 1}`));
}

const cellMatches = (cell: string, kind: ImportKind): boolean => {
  const t = cell.trim();
  if (!t) return true;
  if (kind === 'number') return NUMBER.test(t);
  if (kind === 'checkbox') return YES.test(t) || NO.test(t);
  if (kind === 'date') return ISO_DAY.test(t) || SLASH_DAY.test(t);
  return true;
};

/**
 * Whether the first row names the columns (F20). It is data, not headings, when every typed column (numbers, ticks,
 * days, judged from the rows below) reads the same in the first row too — a headingless price list keeps its first
 * item instead of losing it as column names. All-words sheets still read the first row as headings.
 */
export function hasHeadings(table: string[][]): boolean {
  if (table.length < 2) return true;
  const [head, ...rest] = table;
  const width = Math.max(head.length, ...rest.map((r) => r.length));
  let typed = 0;
  for (let i = 0; i < width; i++) {
    const { kind } = kindOf(`Column ${i + 1}`, rest.map((r) => r[i] ?? ''));
    if (kind === 'text' || kind === 'list') continue;
    typed++;
    if (!cellMatches(head[i] ?? '', kind)) return true;
  }
  return typed === 0;
}

/**
 * A spreadsheet's rows as notes: the heading row names the properties (or "Column 1…" when it has none — F20); the
 * name column (the first, unless another is chosen) names each note, the other columns become its properties by what
 * they hold. Two rows with one name become "Name" and "Name 2"; a row with no name is left out (counted in `skipped`).
 */
export function planImport(table: string[][], nameColumn?: string): ImportPlan {
  const headed = hasHeadings(table);
  const body = headed ? table.slice(1) : table.slice(0);
  // Two columns with one heading: the second gets a number, so neither is lost.
  const keys = csvHeadings(table);
  const nameAt = Math.max(0, nameColumn ? keys.indexOf(nameColumn) : 0);
  const columns = keys
    .map((key, i) => ({ key, i, ...kindOf(key, body.map((r) => r[i] ?? '')) }))
    .filter((c) => c.i !== nameAt);
  const used = new Map<string, number>();
  const notes: ImportedNote[] = [];
  let skipped = 0;
  for (const r of body) {
    const base = cleanNoteName(r[nameAt] ?? '');
    if (!base) {
      skipped++;
      continue;
    }
    const n = (used.get(base.toLowerCase()) ?? 0) + 1;
    used.set(base.toLowerCase(), n);
    const props: Record<string, PropValue> = {};
    for (const c of columns) {
      const v = cellAs(r[c.i] ?? '', c.kind, c.monthFirst);
      if (v !== null) props[c.key] = v;
    }
    notes.push({ name: n === 1 ? base : `${base} ${n}`, props });
  }
  return { nameColumn: keys[nameAt] ?? '', columns: columns.map(({ key, kind }) => ({ key, kind })), notes, skipped };
}

/** An imported note's text: its properties at the top, in the spreadsheet's column order, nothing else. */
export function importedNoteText(note: ImportedNote): string {
  if (!Object.keys(note.props).length) return '';
  return changeProps('', (doc) => {
    for (const [k, v] of Object.entries(note.props)) doc.set(k, doc.createNode(v));
  });
}

/** The table view made over the imported notes: their folder, the spreadsheet's columns in its order. */
export function importedViewColumns(plan: ImportPlan): string[] {
  return plan.columns.map((c) => c.key);
}

const KIND_WORDS: Record<ImportKind, string> = { text: 'words', number: 'numbers', checkbox: 'ticks', date: 'days', list: 'lists' };

/** The preview of what each column becomes (F19: a wrong guess is visible before anything is written). */
export function columnKindWords(columns: ImportColumn[]): string {
  const kinds = columns.filter((c) => c.kind !== 'text');
  if (!kinds.length) return '';
  const byKind = new Map<ImportKind, string[]>();
  for (const c of kinds) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), `“${c.key}”`]);
  return [...byKind.entries()].map(([k, names]) => `${names.join(', ')} as ${KIND_WORDS[k]}`).join('; ');
}
