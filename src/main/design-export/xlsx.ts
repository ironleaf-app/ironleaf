// SPDX-License-Identifier: AGPL-3.0-or-later
// The Design studio's Excel export (22 Nov 2026, phase 2): a note's tables and key figures as a working, branded
// workbook, not a paste. A Summary sheet first (the title in the brand, the logo, the key figures as real numbers, and
// a linked list of the sheets that follow), then one sheet per table in the note, named after the heading it sits
// under. Numbers become numbers with the format they were written in (a currency keeps its symbol, 12% reads 12.0%,
// $42k stays $42k on screen while the cell holds 42000), dates become dates when there is only one way to read them,
// and everything else stays text, exactly as written. A row the note calls a total becomes live SUM formulas over the
// rows above it, showing the typed total until the sheet recalculates; when the typed total and the rows disagree the
// formula stays and a cell note says what the note said. Nothing is invented: a table without a total row gets none.
//
// The words come from brandContent (src/shared/brand-document.ts), already cleaned of secrets and private paths, as
// HTML blocks read here without a browser (./html-tables.ts). No cell ever carries a tag.

// ExcelJS's own self-contained build: it writes workbooks with JSZip, so none of the Node build's zip and file
// packages (archiver, unzipper and theirs) are bundled into the app. Its types are the package's (exceljs-bundle.d.ts).
import ExcelJS from 'exceljs/dist/exceljs.min.js';
import type { Borders, Cell, Fill, Font, Worksheet } from 'exceljs';
import type { BrandContent } from '../../shared/brand-document';
import type { DesignExportInput } from '../../shared/design-export';
import { readTables, type HtmlCell, type HtmlTable } from './html-tables';

// ── Whether there is anything to put in a workbook ──────────────────────────────────────────────────────────────────

/** The cheap check the window uses to offer Excel: the note has a table or key figures. */
export function hasSheetContent(content: BrandContent): boolean {
  return (content.figures?.length ?? 0) > 0 || (content.blocks ?? []).some((b) => /<table\b/i.test(b));
}

// ── Words read as values ─────────────────────────────────────────────────────────────────────────────────────────────

export interface CellValue {
  kind: 'number' | 'money' | 'percent' | 'date';
  /** The number the cell holds (a percentage as its fraction), or the day (midnight UTC). */
  value: number | Date;
  /** The Excel number format that shows it as it was written. */
  fmt: string;
  /** Half the smallest step the written form can show (how far a typed total may be from the sum and still agree). */
  slack: number;
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_WORD = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\.?,?\\s+';
const MONTH_WORD = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';

const monthOf = (word: string): number => {
  const w = word.toLowerCase().replace(/\.$/, '');
  const i = MONTH_NAMES.indexOf(w.slice(0, 3));
  if (i < 0) return -1;
  // The month's own name or a known short form, never any word that starts the same ("market", "decide").
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][i];
  return full.startsWith(w) || (w === 'sept' && i === 8) ? i : -1;
};

const utcDay = (y: number, m: number, d: number): Date | null => {
  if (y < 1900 || y > 9999 || m < 0 || m > 11 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m && t.getUTCDate() === d ? t : null;
};

const DAY_FMT = 'd mmm yyyy';

/** A day written one way only: 2026-03-20, 20 Mar 2026, Fri 20 March 2026, March 20, 2026, Mar 2026, or 20/3/2026
 *  when the day is past 12. A day without its year ("Fri 6 Nov") or 3/4/2026 could be two days, so it stays words. */
function readDate(s: string): CellValue | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = utcDay(+m[1], +m[2] - 1, +m[3]);
    return d ? { kind: 'date', value: d, fmt: DAY_FMT, slack: 0 } : null;
  }
  m = new RegExp(`^(?:${DAY_WORD})?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_WORD},?\\s+(\\d{4})$`, 'i').exec(s);
  if (m) {
    const mo = monthOf(s.replace(new RegExp(`^(?:${DAY_WORD})?\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?`, 'i'), '').split(/[\s,]/)[0]);
    const d = mo >= 0 ? utcDay(+m[3], mo, +m[1]) : null;
    return d ? { kind: 'date', value: d, fmt: DAY_FMT, slack: 0 } : null;
  }
  m = new RegExp(`^(?:${DAY_WORD})?${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})$`, 'i').exec(s);
  if (m) {
    const mo = monthOf(s.replace(new RegExp(`^(?:${DAY_WORD})?`, 'i'), '').split(/\s/)[0]);
    const d = mo >= 0 ? utcDay(+m[3], mo, +m[2]) : null;
    return d ? { kind: 'date', value: d, fmt: DAY_FMT, slack: 0 } : null;
  }
  m = new RegExp(`^${MONTH_WORD}\\s+(\\d{4})$`, 'i').exec(s);
  if (m) {
    const mo = monthOf(s.split(/\s/)[0]);
    const d = mo >= 0 ? utcDay(+m[2], mo, 1) : null;
    return d ? { kind: 'date', value: d, fmt: 'mmm yyyy', slack: 0 } : null;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    if (a > 12 && b <= 12) {
      const d = utcDay(+m[3], b - 1, a);
      return d ? { kind: 'date', value: d, fmt: DAY_FMT, slack: 0 } : null;
    }
    if (b > 12 && a <= 12) {
      const d = utcDay(+m[3], a - 1, b);
      return d ? { kind: 'date', value: d, fmt: DAY_FMT, slack: 0 } : null;
    }
  }
  return null;
}

const SYMBOLS = ['A$', 'AU$', 'NZ$', 'US$', 'C$', 'CA$', 'S$', 'HK$', 'R$', '$', '£', '€', '¥', '₹', '₩', '₪', '₱', '฿', '₫'];
const CODES = ['AUD', 'NZD', 'USD', 'EUR', 'GBP', 'CAD', 'SGD', 'HKD', 'JPY', 'CHF', 'AED', 'INR', 'ZAR', 'CNY', 'SEK', 'NOK', 'DKK'];
/** Words after a number that are not its unit (a unit is two letters or more: "5 m" could be metres or minutes): they make the words a phrase ("3 to 5", "2 pm", "20 Mar"). */
const NOT_UNITS = /^(to|or|and|of|per|by|x|am|pm|st|nd|rd|th|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)$/i;

/** A format's literal words, quoted. */
const lit = (s: string) => (s ? `"${s.replace(/"/g, '')}"` : '');

/**
 * A cell's words as a value, or null when they are words: a currency ($1,250.50, -$300, ($300), A$42k, €1.2m, 1,200
 * AUD), a percentage (12%, +3.5%), a count or measure (1,284, 3.75, 40k, 22 months) or a day (see readDate). Leading
 * zeros (an id or a phone number), ranges, approximations and anything with more after it stay words.
 */
export function readValue(raw: string): CellValue | null {
  let s = String(raw ?? '').replace(/[   ]/g, ' ').replace(/−/g, '-').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 40) return null;
  const date = readDate(s);
  if (date) return date;
  let paren = false;
  if (/^\(.+\)$/.test(s)) {
    paren = true;
    s = s.slice(1, -1).trim();
  }
  let sign = '';
  const takeSign = () => {
    if (sign || !/^[-+]/.test(s)) return;
    sign = s[0];
    s = s.slice(1).trim();
  };
  takeSign();
  let pre = '';
  for (const sym of SYMBOLS) {
    if (s.toUpperCase().startsWith(sym)) {
      pre = s.slice(0, sym.length);
      s = s.slice(sym.length).trim();
      break;
    }
  }
  if (!pre) {
    const code = /^([A-Z]{3})\s?(?=[-+\d.])/.exec(s);
    if (code && CODES.includes(code[1])) {
      pre = `${code[1]} `;
      s = s.slice(code[0].length);
    }
  }
  takeSign();
  const num = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d+))?/.exec(s);
  if (!num || (!num[1] && !num[2])) return null;
  const whole = num[1] ?? '0';
  const frac = num[2] ?? '';
  // An id, a phone number or a postcode: a leading zero keeps its words.
  if (num[1] && /^0\d/.test(whole)) return null;
  if ((whole + frac).replace(/,/g, '').length > 15 || frac.length > 6) return null;
  let rest = s.slice(num[0].length).trim();
  let value = Number(`${whole.replace(/,/g, '')}.${frac || '0'}`);
  const decimals = frac.length;
  const money = !!pre;
  let scale = 1;
  let scaleWords = '';
  let scaleCommas = '';
  const mult = /^(k|thousand|m|mn|million|b|bn|billion)\b/i.exec(rest);
  if (mult) {
    const w = mult[1].toLowerCase();
    // "5m" alone could be metres or minutes; a million needs its currency (or the word).
    const ok = w === 'k' || w === 'thousand' || w === 'million' || w === 'billion' || money;
    if (ok) {
      scale = w === 'k' || w === 'thousand' ? 1e3 : w.startsWith('m') ? 1e6 : 1e9;
      scaleCommas = scale === 1e3 ? ',' : scale === 1e6 ? ',,' : ',,,';
      // The written word, with its space when it had one ("1.2 million").
      scaleWords = /^\s/.test(s.slice(num[0].length)) ? ` ${mult[1]}` : mult[1];
      rest = rest.slice(mult[1].length).trim();
    }
  }
  let percent = false;
  let post = '';
  if (rest === '%') {
    percent = true;
    rest = '';
  } else if (!money && rest) {
    const code = /^([A-Z]{3})$/.exec(rest);
    const sym = SYMBOLS.find((x) => x === rest && x !== '$');
    if (code && CODES.includes(code[1])) post = ` ${code[1]}`;
    else if (sym) post = ` ${sym}`;
    if (post) rest = '';
  }
  if (percent && (money || scale !== 1)) return null;
  // A unit after a count: "22 months", "3 sites", "120 kg" (one or two short words, no digits).
  let unit = '';
  if (rest && !money && !post && !percent) {
    // A unit reads in small letters ("kg", "months") or is a short code ("GB"); "12 Market" is a street, not a count.
    if (!/^(?:\p{Ll}[\p{L}.'/-]{1,13}(?: \p{Ll}[\p{L}.'/-]{0,13})?|\p{Lu}{2,4})$/u.test(rest) || rest.split(' ').some((w) => NOT_UNITS.test(w))) return null;
    unit = ` ${rest}`;
    rest = '';
  }
  if (rest) return null;
  if (sign === '-') value = -value;
  if (paren) value = -Math.abs(value);
  const digits = decimals ? `#,##0.${'0'.repeat(decimals)}` : '#,##0';
  if (percent) {
    const p = `0.${'0'.repeat(Math.max(1, decimals))}%`;
    const fmt = sign === '+' ? `+${p};-${p};${p}` : p;
    return { kind: 'percent', value: value / 100, fmt, slack: (0.5 * 10 ** -decimals) / 100 + 1e-12 };
  }
  value *= scale;
  const slack = 0.5 * 10 ** -decimals * scale + 1e-9;
  if (money || post) {
    const prefix = money ? lit(pre) : '';
    const body = `${prefix}${digits}${scaleCommas}${lit(scaleWords)}${lit(post)}`;
    const fmt = paren ? `${body};(${body})` : sign === '+' ? `+${body};-${body};${body}` : body;
    return { kind: 'money', value, fmt, slack };
  }
  // A year written as a number never takes a thousands separator.
  const yearLike = scale === 1 && !decimals && !whole.includes(',') && value >= 1900 && value <= 2100 && !unit;
  const body = yearLike ? '0' : `${digits}${scaleCommas}${lit(scaleWords)}${lit(unit)}`;
  const fmt = sign === '+' ? `+${body};-${body};${body}` : body;
  return { kind: 'number', value, fmt, slack };
}

// ── The brand, as Excel takes it ─────────────────────────────────────────────────────────────────────────────────────

const argb = (hex: string | undefined, fallback: string): string => {
  let h = String(hex ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, (c) => c + c);
  return `FF${(/^[0-9a-f]{6}$/i.test(h) ? h : fallback.replace(/^#/, '')).toUpperCase()}`;
};

/** The first family of a CSS font list; the app's own fallback (Inter, which most PCs lack) reads as Calibri. */
function familyOf(css: string): string {
  if (/^"Inter","Helvetica Neue"/.test(css)) return 'Calibri';
  const first = /^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/.exec(css ?? '');
  const name = (first?.[1] ?? first?.[2] ?? first?.[3] ?? '').trim();
  return name && name.length <= 31 ? name : 'Calibri';
}

interface Brand {
  accent: string;
  onAccent: string;
  strong: string;
  tint1: string;
  tint2: string;
  ink: string;
  muted: string;
  line: string;
  head: string;
  body: string;
}

function brandOf(input: DesignExportInput): Brand {
  const t = new Map(input.theme?.tokens ?? []);
  return {
    accent: argb(t.get('accent'), '#101820'),
    onAccent: argb(t.get('on-accent'), '#ffffff'),
    strong: argb(t.get('accent-strong'), '#101820'),
    tint1: argb(t.get('accent-1'), '#f4f5f6'),
    tint2: argb(t.get('accent-2'), '#e8eaec'),
    ink: argb(t.get('ink'), '#101820'),
    muted: argb(t.get('muted'), '#5a6067'),
    line: argb(t.get('line'), '#d6d9dc'),
    head: familyOf(input.theme?.head ?? ''),
    body: familyOf(input.theme?.body ?? ''),
  };
}

const solid = (color: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: color } });

// ── Sheet names ──────────────────────────────────────────────────────────────────────────────────────────────────────

const MAX_NAME = 31;

/** A heading as a sheet's name: the characters Excel refuses out, at most 31, never blank, never "History". */
export function sheetName(words: string, fallback: string): string {
  let n = String(words ?? '')
    .replace(/[\[\]:*?/\\\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '')
    .trim();
  if (n.length > MAX_NAME) n = n.slice(0, MAX_NAME).replace(/\s+\S*$/, '').trim() || n.slice(0, MAX_NAME).trim();
  n = n.replace(/'+$/, '').trim();
  if (!n) n = fallback;
  if (/^history$/i.test(n)) n = 'History table';
  return n;
}

function uniqueName(name: string, taken: Set<string>): string {
  let n = name;
  for (let k = 2; taken.has(n.toLowerCase()); k++) {
    const tail = ` (${k})`;
    n = `${name.slice(0, MAX_NAME - tail.length).trim()}${tail}`;
  }
  taken.add(n.toLowerCase());
  return n;
}

/** A sheet named in a formula: quoted, its apostrophes doubled. */
const sheetRef = (name: string) => `'${name.replace(/'/g, "''")}'`;
/** A link to a sheet's first cell, as a formula Excel and LibreOffice both follow. */
const linkTo = (name: string, words: string) => `HYPERLINK("#${sheetRef(name).replace(/"/g, '""')}!A1","${words.replace(/"/g, '""')}")`;

const colLetter = (n: number): string => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

/** Words for a page header or footer: its & codes made literal. */
const hf = (s: string) => String(s ?? '').replace(/&/g, '&&').replace(/[\r\n]+/g, ' ').slice(0, 80);

const MAX_CELL = 32_000;

// ── Totals ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A first cell that reads like a total: Total, Totals, Sum, Grand total, Subtotal (Total cost, Total: too). */
export const TOTAL_ROW = /^(?:grand\s+|sub-?\s?)?(?:totals?|sum)\b/i;

interface Planned {
  formula: string;
  /** What the rows add up to, for the note when the typed total differs. */
  sum: number;
  agrees: boolean;
}

/** The formula for one total cell: the rows since the last total, else the totals above, else both; the first whose
 *  sum agrees with the typed total wins. Percentages may also be an average. Null when it is no sum at all. */
function planTotal(o: { col: string; typed: CellValue; segment: number[]; totals: number[]; valueAt: (row: number) => number | null }): Planned | null {
  const sumOf = (rows: number[]) => rows.reduce((n, r) => n + (o.valueAt(r) ?? 0), 0);
  const numeric = (rows: number[]) => rows.some((r) => o.valueAt(r) !== null);
  const ranges = (rows: number[]): string[] => {
    // Rows as ranges of neighbours: B4:B9, B12.
    const out: string[] = [];
    for (let i = 0; i < rows.length; ) {
      let j = i;
      while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
      out.push(i === j ? `${o.col}${rows[i]}` : `${o.col}${rows[i]}:${o.col}${rows[j]}`);
      i = j + 1;
    }
    return out;
  };
  const typed = o.typed.value as number;
  const close = (n: number) => Math.abs(n - typed) <= Math.max(o.typed.slack, Math.abs(typed) * 1e-9);
  const tries: { rows: number[]; fn: 'SUM' | 'AVERAGE' }[] = [];
  if (o.segment.length) tries.push({ rows: o.segment, fn: 'SUM' });
  if (o.totals.length) tries.push({ rows: o.totals, fn: 'SUM' });
  if (o.totals.length && o.segment.length) tries.push({ rows: [...o.totals, ...o.segment].sort((a, b) => a - b), fn: 'SUM' });
  if (o.typed.kind === 'percent' && o.segment.length) tries.push({ rows: o.segment, fn: 'AVERAGE' });
  const usable = tries.filter((t) => numeric(t.rows));
  if (!usable.length) return null;
  for (const t of usable) {
    const counted = t.rows.filter((r) => o.valueAt(r) !== null);
    const n = t.fn === 'SUM' ? sumOf(t.rows) : sumOf(t.rows) / counted.length;
    if (close(n)) return { formula: `${t.fn}(${ranges(t.rows).join(',')})`, sum: n, agrees: true };
  }
  // A percentage that is neither a sum nor an average of its rows (a margin, a rate) is the note's own figure.
  if (o.typed.kind === 'percent') return null;
  const first = usable.find((t) => t.fn === 'SUM')!;
  return { formula: `SUM(${ranges(first.rows).join(',')})`, sum: sumOf(first.rows), agrees: false };
}

/** A value shown the way its column writes it, for the cell note ("$12,400", "1,284", "12.5%"). */
function shown(n: number, typed: CellValue, raw: string): string {
  const sym = /^[^\d\s(+-]+/.exec(raw.replace(/^[-+(]/, ''))?.[0] ?? '';
  if (typed.kind === 'percent') return `${(n * 100).toFixed(Math.max(1, (/\.(\d+)/.exec(raw)?.[1] ?? '').length))}%`;
  const decimals = (/\.(\d+)/.exec(raw)?.[1] ?? '').length;
  const words = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.min(decimals, 2), maximumFractionDigits: Math.max(2, decimals) });
  return `${n < 0 ? '-' : ''}${typed.kind === 'money' ? sym : ''}${words}`;
}

// ── The workbook ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Rows above a table's header on its sheet: the heading, the link back to the summary, a gap. */
const HEADER_ROW = 4;

interface SheetMade {
  name: string;
  rows: number;
  cols: number;
  totals: number;
}

/** A PNG's size from its header, or null when the bytes are no PNG. */
function pngSize(b: Buffer | null | undefined): { w: number; h: number } | null {
  if (!b || b.length < 24) return null;
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  return w > 0 && h > 0 && w < 20000 && h < 20000 ? { w, h } : null;
}

/** A column's width in Excel's characters from the longest of its words (a long one wraps instead). */
const widthFor = (len: number, min = 8, max = 48) => Math.max(min, Math.min(max, Math.ceil(len * 1.1) + 3));

function setCellValue(cell: Cell, c: HtmlCell, v: CellValue | null) {
  if (v) {
    cell.value = v.value;
    cell.numFmt = v.fmt;
    return;
  }
  const text = c.text.slice(0, MAX_CELL);
  if (!text) return;
  cell.value = c.link ? { text, hyperlink: c.link } : text;
}

function tableSheet(wb: ExcelJS.Workbook, table: HtmlTable, name: string, input: DesignExportInput, brand: Brand): SheetMade {
  const cols = Math.max(table.head?.length ?? 0, ...table.rows.map((r) => r.length), 1);
  const head = table.head ?? Array.from({ length: cols }, (_, k) => `Column ${k + 1}`);
  const values = table.rows.map((r) => Array.from({ length: cols }, (_, k) => {
    const c = r[k] ?? { text: '' };
    return c.text && !c.text.includes('\n') ? readValue(c.text) : null;
  }));
  const isTotal = table.rows.map((r) => TOTAL_ROW.test((r[0]?.text ?? '').trim()));
  // A column of numbers or days: most of its filled cells (totals aside) read as values. It aligns right, words and
  // all, so the column reads as one.
  const rightCol = Array.from({ length: cols }, (_, k) => {
    let filled = 0;
    let vals = 0;
    table.rows.forEach((r, i) => {
      if (isTotal[i] || !(r[k]?.text ?? '').trim()) return;
      filled++;
      if (values[i][k]) vals++;
    });
    return filled > 0 && vals * 2 >= filled;
  });
  const lastData = (() => {
    let n = table.rows.length;
    while (n > 0 && isTotal[n - 1]) n--;
    return n;
  })();
  const wide = cols >= 6;

  const ws = wb.addWorksheet(name, {
    properties: { tabColor: { argb: brand.accent } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: HEADER_ROW, showGridLines: false, activeCell: `A${HEADER_ROW + 1}` }],
    pageSetup: {
      paperSize: 9,
      orientation: wide ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
      horizontalCentered: false,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: `&L&8${hf(input.content.title)}&C&8${hf(input.content.foot)}&R&8Page &P of &N` },
  });

  const bodyFont: Partial<Font> = { name: brand.body, size: 10, color: { argb: brand.ink } };
  const title = ws.getCell(1, 1);
  title.value = name;
  title.font = { name: brand.head, size: 16, bold: true, color: { argb: brand.strong } };
  title.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 28;
  const back = ws.getCell(2, 1);
  back.value = { formula: linkTo('Summary', 'Back to summary'), result: 'Back to summary' };
  back.font = { name: brand.body, size: 9, color: { argb: brand.muted }, underline: true };
  if (input.content.title) {
    const from = ws.getCell(2, 2);
    from.value = input.content.title;
    from.font = { name: brand.body, size: 9, color: { argb: brand.muted } };
  }
  ws.getRow(3).height = 6;

  const hairline = { style: 'thin' as const, color: { argb: brand.line } };
  const headRow = ws.getRow(HEADER_ROW);
  headRow.height = 22;
  head.forEach((h, k) => {
    const cell = headRow.getCell(k + 1);
    cell.value = h;
    cell.font = { name: brand.head, size: 10, bold: true, color: { argb: brand.onAccent } };
    cell.fill = solid(brand.accent);
    cell.alignment = { vertical: 'middle', horizontal: rightCol[k] ? 'right' : 'left', wrapText: true, indent: 1 };
    cell.border = { bottom: { style: 'thin', color: { argb: brand.accent } } };
  });

  // Where each table row lands, and the totals' plans.
  const rowAt = (i: number) => HEADER_ROW + 1 + i;
  const valueAt = (k: number) => (row: number): number | null => {
    const v = values[row - HEADER_ROW - 1]?.[k];
    return v && v.kind !== 'date' ? (v.value as number) : null;
  };
  let totalsMade = 0;
  const earlierTotals: number[] = [];
  let segmentStart = 0;
  table.rows.forEach((r, i) => {
    const row = ws.getRow(rowAt(i));
    const total = isTotal[i] && i > 0;
    const banded = !total && i % 2 === 1;
    for (let k = 0; k < cols; k++) {
      const c = r[k] ?? { text: '' };
      const v = values[i][k];
      const cell = row.getCell(k + 1);
      setCellValue(cell, c, v);
      cell.font = { ...bodyFont, bold: total || undefined, ...(c.link && !v ? { color: { argb: brand.strong }, underline: true } : {}) };
      const isNum = !!v && v.kind !== 'date';
      cell.alignment = { vertical: 'middle', horizontal: rightCol[k] && !(total && k === 0) ? 'right' : 'left', wrapText: c.text.length > 48 || c.text.includes('\n'), indent: 1 };
      const border: Partial<Borders> = { bottom: hairline };
      if (total) {
        border.top = { style: 'thin', color: { argb: brand.strong } };
        border.bottom = { style: 'double', color: { argb: brand.strong } };
      }
      cell.border = border;
      if (total) cell.fill = solid(brand.tint2);
      else if (banded) cell.fill = solid(brand.tint1);
      if (total && k > 0 && isNum) {
        const segment: number[] = [];
        for (let j = segmentStart; j < i; j++) if (!isTotal[j]) segment.push(rowAt(j));
        const plan = planTotal({ col: colLetter(k + 1), typed: v!, segment, totals: earlierTotals, valueAt: valueAt(k) });
        if (plan) {
          cell.value = { formula: plan.formula, result: v!.value as number };
          cell.numFmt = v!.fmt;
          totalsMade++;
          if (!plan.agrees) cell.note = `The note said ${c.text}; the rows above add up to ${shown(plan.sum, v!, c.text)}.`;
        }
      }
    }
    // A little air in each row; a row with wrapped words is left for the app to size.
    if (!r.some((c) => c.text.length > 48 || c.text.includes('\n'))) row.height = 18;
    if (total) {
      earlierTotals.push(rowAt(i));
      segmentStart = i + 1;
    }
  });

  // Widths from the words, with the cells' indent on both sides.
  for (let k = 0; k < cols; k++) {
    // The header's bold words, and room for the filter's button beside them.
    let len = (head[k] ?? '').length * 1.1 + 2;
    table.rows.forEach((r, i) => {
      const t = r[k]?.text ?? '';
      const v = values[i][k];
      const l = v?.kind === 'date' ? 11 : Math.max(...t.split('\n').map((x) => x.length));
      len = Math.max(len, l);
    });
    ws.getColumn(k + 1).width = widthFor(len + 2, k === 0 ? 12 : 10);
  }
  if (lastData > 0) ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: rowAt(lastData - 1), column: cols } };
  return { name, rows: table.rows.length, cols, totals: totalsMade };
}

/** The Summary sheet, made first so it is the first tab; filled once the tables' sheets are made. */
function summarySheet(wb: ExcelJS.Workbook, content: BrandContent): Worksheet {
  return wb.addWorksheet('Summary', {
    views: [{ showGridLines: false, activeCell: 'B4' }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.7, header: 0.3, footer: 0.3 } },
    headerFooter: { oddFooter: `&L&8${hf(content.title)}&C&8${hf(content.foot)}&R&8Page &P of &N` },
  });
}

function fillSummary(wb: ExcelJS.Workbook, ws: Worksheet, input: DesignExportInput, brand: Brand, made: SheetMade[]) {
  const { content } = input;
  ws.properties.tabColor = { argb: brand.accent };
  // A gutter, the labels, the values, then room for the logo on the right.
  const widths = [2.5, 34, 22, 14, 20, 2.5];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const LAST = 5;
  const font = (o: Partial<Font>): Partial<Font> => ({ name: brand.body, size: 10, color: { argb: brand.ink }, ...o });
  const span = (row: number, from = 2, to = LAST) => ws.mergeCells(row, from, row, to);

  // The brand's band across the top.
  for (let c = 1; c <= LAST + 1; c++) ws.getCell(1, c).fill = solid(brand.accent);
  ws.getRow(1).height = 10;
  ws.getRow(2).height = 18;

  const logoSize = pngSize(input.logo ?? null);
  // The title's room: beside the logo when there is one, else the whole width (about 2.6 characters of 22pt type to
  // 7 of the columns' width).
  const titleTo = logoSize ? 3 : LAST;
  const titleChars = (widths.slice(1, titleTo).reduce((a, b) => a + b, 0) * 7) / 15;
  let r = 3;
  const label = ws.getCell(r, 2);
  label.value = [content.label, content.confidential ? 'Confidential' : ''].filter(Boolean).join(' · ');
  label.font = font({ size: 10, bold: true, color: { argb: brand.strong } });
  ws.getRow(r).height = 16;
  r++;
  const titleCell = ws.getCell(r, 2);
  titleCell.value = content.title || 'Untitled';
  titleCell.font = { name: brand.head, size: 22, bold: true, color: { argb: brand.ink } };
  titleCell.alignment = { vertical: 'top', wrapText: true };
  span(r, 2, titleTo);
  const titleLines = Math.max(1, Math.ceil((content.title || '').length / titleChars));
  ws.getRow(r).height = 30 * titleLines + 4;
  r++;
  for (const line of content.sub ?? []) {
    const c = ws.getCell(r, 2);
    c.value = line;
    c.font = font({ size: 10.5, color: { argb: brand.muted } });
    span(r, 2, titleTo);
    r++;
  }

  if (logoSize && input.logo) {
    const id = wb.addImage({ buffer: input.logo as unknown as ExcelJS.Buffer, extension: 'png' });
    // At most 56 pixels high and 200 wide, its shape kept, its right edge on the content's right edge, its top level
    // with the label. Placed by its native offsets (EMU), which Excel and LibreOffice both read exactly.
    let h = 56;
    let w = (logoSize.w / logoSize.h) * h;
    if (w > 200) {
      w = 200;
      h = (logoSize.h / logoSize.w) * w;
    }
    const px = (chars: number) => Math.round(chars * 7 + 5);
    const edges: number[] = [];
    widths.reduce((x, cw) => (edges.push(x), x + px(cw)), 0);
    const right = edges[LAST - 1] + px(widths[LAST - 1]);
    const left = Math.max(edges[2], right - w);
    let col = 0;
    while (col + 1 < edges.length && edges[col + 1] <= left) col++;
    const EMU = 9525;
    const tl = { nativeCol: col, nativeColOff: Math.round((left - edges[col]) * EMU), nativeRow: 2, nativeRowOff: 0 };
    ws.addImage(id, { tl: tl as unknown as { col: number; row: number }, ext: { width: w, height: h }, editAs: 'oneCell' });
  }

  const section = (words: string) => {
    r++;
    ws.getRow(r).height = 8;
    r++;
    const c = ws.getCell(r, 2);
    c.value = words;
    c.font = { name: brand.head, size: 12, bold: true, color: { argb: brand.strong } };
    for (let k = 2; k <= LAST; k++) ws.getCell(r, k).border = { bottom: { style: 'medium', color: { argb: brand.accent } } };
    ws.getRow(r).height = 22;
    c.alignment = { vertical: 'bottom' };
    r++;
  };
  const hair = { bottom: { style: 'thin' as const, color: { argb: brand.line } } };

  if (content.figures?.length) {
    // A ledger across the page: the label on the left, the figure at the right edge.
    section('Key figures');
    for (const f of content.figures) {
      const l = ws.getCell(r, 2);
      l.value = f.label;
      l.font = font({});
      l.alignment = { vertical: 'middle', wrapText: true };
      span(r, 2, LAST - 1);
      const v = ws.getCell(r, LAST);
      const parsed = readValue(f.value);
      if (parsed) {
        v.value = parsed.value;
        v.numFmt = parsed.fmt;
      } else v.value = f.value;
      v.font = font({ size: 12, bold: true });
      v.alignment = { vertical: 'middle', horizontal: 'right' };
      for (let k = 2; k <= LAST; k++) ws.getCell(r, k).border = hair;
      ws.getRow(r).height = 21;
      r++;
    }
  }

  if (content.people?.length) {
    section('People');
    for (const p of content.people) {
      const l = ws.getCell(r, 2);
      l.value = p.label;
      l.font = font({ color: { argb: brand.muted } });
      l.alignment = { vertical: 'top' };
      const v = ws.getCell(r, 3);
      v.value = p.names.join(', ');
      v.font = font({});
      v.alignment = { vertical: 'top', wrapText: true };
      span(r, 3, LAST);
      ws.getRow(r).height = 15 * Math.max(1, Math.ceil(v.value.length / 50));
      r++;
    }
  }

  if (made.length) {
    section('In this workbook');
    for (const m of made) {
      const l = ws.getCell(r, 2);
      l.value = { formula: linkTo(m.name, m.name), result: m.name };
      l.font = font({ color: { argb: brand.strong }, underline: true });
      const d = ws.getCell(r, 3);
      d.value = `${m.rows} ${m.rows === 1 ? 'row' : 'rows'}, ${m.cols} ${m.cols === 1 ? 'column' : 'columns'}${m.totals ? ', totals as formulas' : ''}`;
      d.font = font({ color: { argb: brand.muted } });
      span(r, 3, LAST);
      for (let k = 2; k <= LAST; k++) ws.getCell(r, k).border = hair;
      ws.getRow(r).height = 18;
      r++;
    }
  }

  const foot = [content.foot, input.brandName && !content.foot.includes(input.brandName) ? input.brandName : ''].filter(Boolean).join(' · ');
  if (foot) {
    r += 2;
    const c = ws.getCell(r, 2);
    c.value = foot;
    c.font = font({ size: 8, color: { argb: brand.muted } });
    span(r);
  }
}

/** The workbook, or null when the note has no tables and no key figures. */
export async function designXlsx(input: DesignExportInput): Promise<Buffer | null> {
  const content = input.content;
  if (!content || !hasSheetContent(content)) return null;
  const brand = brandOf(input);
  const wb = new ExcelJS.Workbook();
  wb.creator = input.brandName || '';
  wb.lastModifiedBy = input.brandName || '';
  wb.title = content.title || '';
  wb.subject = input.kindName || '';
  wb.category = content.label || '';
  wb.company = input.brandName || '';
  wb.created = new Date();
  wb.modified = wb.created;
  // Excel works every formula out again on opening: the cached results are the note's typed totals.
  wb.calcProperties = { fullCalcOnLoad: true };

  const tables = readTables(content.blocks ?? []).filter((t) => t.rows.length || t.head);
  const taken = new Set<string>(['summary']);
  const summary = summarySheet(wb, content);
  const made = tables.map((t, i) => tableSheet(wb, t, uniqueName(sheetName(t.heading, `Table ${i + 1}`), taken), input, brand));
  fillSummary(wb, summary, input, brand, made);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export type { DesignExportInput };
