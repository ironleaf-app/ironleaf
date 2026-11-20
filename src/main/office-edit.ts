// File work in a project's folder for the chat's assistant (18 Oct 2026, and the assistant answered that it couldn't
// "duplicate or edit an Excel file"). Copies, and changes to Office files done by editing the XML inside them, so
// everything the change doesn't touch stays exactly as it was: formatting, formulas, sheet names, column widths, merged
// cells, data validation, pictures, macros, comments.
//  Excel (.xlsx, .xlsm, .xltx, .xltm): the cells read with their addresses, formulas and the heading row; cells set or
//     cleared; "reset" clears the filled-in entries (status, owner, dates, notes, ticks, the "Venue: Wexley St" fields)
//     and keeps the template's own words (headings, task lists, titles) and every formula.
//   Word and PowerPoint (.docx, .docm, .dotx, .pptx, .pptm, .potx): words replaced, keeping the formatting of the run they
//     start in.
//   Text, Markdown and CSV: words replaced, or added at the end.
//The zip reading is doc-text.ts's; writing a zip copies every part that isn't changed byte for byte (still compressed),
// so an untouched part can't be spoilt. Nothing here decides what may be written where: src/main/agent.ts does (copies
// get new names; only files the assistant made are changed in place; never outside the project's folder).

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { decodeXml, zipRead } from './doc-text';
import { cleanFileName } from '../shared/paths';

// ── Zip: read with what's needed to write it again ─────────────────────────────────────────────────────────────────

export interface ZipPart {
  name: string;
  method: number;
  flags: number;
  time: number;
  date: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

/** The parts of a zip from its central directory. Throws when it isn't a zip (or is one this doesn't write again). */
export function zipParts(buf: Buffer): ZipPart[] {
  const min = Math.max(0, buf.length - 0xffff - 22);
  let end = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('This file is protected with a password, or isn’t a working Office file, so it can’t be changed here.');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff || at >= buf.length) throw new Error('This file is too big to change here.');
  const out: ZipPart[] = [];
  for (let n = 0; n < count && at + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(at + 8);
    const nameLength = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30);
    const comment = buf.readUInt16LE(at + 32);
    out.push({
      name: buf.toString(flags & 0x800 ? 'utf8' : 'latin1', at + 46, at + 46 + nameLength),
      flags,
      method: buf.readUInt16LE(at + 10),
      time: buf.readUInt16LE(at + 12),
      date: buf.readUInt16LE(at + 14),
      crc: buf.readUInt32LE(at + 16),
      compressed: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 24),
      offset: buf.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + extra + comment;
  }
  return out;
}

/** A part's packed bytes as they are in the zip (copied unchanged when the part isn't changed). */
function packedBytes(buf: Buffer, p: ZipPart): Buffer {
  const at = p.offset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) throw new Error('A damaged Office file.');
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  return buf.subarray(start, start + p.compressed);
}

function dosNow(): { time: number; date: number } {
  const d = new Date();
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** The zip again, with the parts in `changed` (by name, unpacked) packed anew and every other part copied as it was. */
export function rewriteZip(buf: Buffer, parts: ZipPart[], changed: Map<string, Buffer>, removed: Set<string> = new Set()): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const now = dosNow();
  for (const p of parts) {
    if (removed.has(p.name)) continue;
    const fresh = changed.get(p.name);
    const name = Buffer.from(p.name, 'utf8');
    const utf8 = /[^\x00-\x7f]/.test(p.name) ? 0x800 : 0;
    let method = p.method, crc = p.crc, size = p.size, data: Buffer, time = p.time, date = p.date;
    if (fresh) {
      data = deflateRawSync(fresh);
      method = 8;
      crc = crc32(fresh) >>> 0;
      size = fresh.length;
      time = now.time;
      date = now.date;
    } else data = packedBytes(buf, p);
    // Sizes go in the local header (no data descriptor after the data), so bit 3 is off; utf-8 names are marked.
    const flags = (p.flags & ~0x0808 & 0x0006) | utf8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(flags, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(time, 12);
    head.writeUInt16LE(date, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(size, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    chunks.push(local, name, data);
    central.push(head, name);
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const count = parts.filter((p) => !removed.has(p.name)).length;
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, end]);
}

async function partText(buf: Buffer, parts: ZipPart[], name: string): Promise<string | null> {
  const p = parts.find((x) => x.name === name);
  if (!p) return null;
  return (await zipRead(buf, p, 128 * 1024 * 1024)).toString('utf8');
}

// ── Cells and their addresses ─────────────────────────────────────────────────────────────────────────────────────

export function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function colLetters(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
const refOf = (col: number, row: number) => `${colLetters(col)}${row}`;
function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref.trim());
  return m ? { col: colNumber(m[1]), row: Number(m[2]) } : null;
}

/** A range as written by a person or a model: "B4", "B4:E80", "C:E" (whole columns), "5:9" (whole rows), each with an
 * optional sheet ("Tasks!B4:E80", "'Site list'!A:A"). */
export interface CellRange {
  sheet?: string;
  c1: number;
  r1: number;
  c2: number;
  r2: number;
}
export function parseRange(text: string): CellRange | null {
  let t = String(text ?? '').trim();
  let sheet: string | undefined;
  const bang = t.lastIndexOf('!');
  if (bang > 0) {
    sheet = t.slice(0, bang).replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
    t = t.slice(bang + 1);
  }
  t = t.replace(/\$/g, '').toUpperCase();
  const [a, b = a] = t.split(':');
  const BIG = 1048576;
  let m: RegExpExecArray | null;
  let out: Omit<CellRange, 'sheet'> | null = null;
  if (/^[A-Z]{1,3}\d+$/.test(a) && /^[A-Z]{1,3}\d+$/.test(b)) {
    const x = parseRef(a)!, y = parseRef(b)!;
    out = { c1: Math.min(x.col, y.col), r1: Math.min(x.row, y.row), c2: Math.max(x.col, y.col), r2: Math.max(x.row, y.row) };
  } else if ((m = /^([A-Z]{1,3})$/.exec(a)) && /^[A-Z]{1,3}$/.test(b)) {
    const x = colNumber(m[1]), y = colNumber(b);
    out = { c1: Math.min(x, y), r1: 1, c2: Math.max(x, y), r2: BIG };
  } else if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    out = { c1: 1, r1: Math.min(+a, +b), c2: 16384, r2: Math.max(+a, +b) };
  }
  return out ? { ...(sheet ? { sheet } : {}), ...out } : null;
}
const inRange = (r: CellRange, col: number, row: number) => col >= r.c1 && col <= r.c2 && row >= r.r1 && row <= r.r2;

// ── Excel workbooks ───────────────────────────────────────────────────────────────────────────────────────────────

export interface Cell {
  ref: string;
  col: number;
  row: number;
  /** The cell's style (formatting), kept whatever happens to its value. */
  style?: string;
  /** What it shows: a number, words, true/false, or '' when empty. */
  value: string | number | boolean;
  /** Words (not a number, a date or true/false). */
  text: boolean;
  /** A date (a number in a date format). */
  date: boolean;
  formula?: string;
  /** The formula is shared from another cell (Excel writes copies of one formula this way). */
  sharedFormula?: boolean;
  /** This cell holds a shared formula other cells use. */
  sharedMaster?: boolean;
}

export interface Sheet {
  name: string;
  /** Its part in the zip: xl/worksheets/sheet1.xml. */
  part: string;
  cells: Map<string, Cell>;
  maxRow: number;
  maxCol: number;
  hidden: boolean;
}

export interface Workbook {
  sheets: Sheet[];
  /** Sheets that are only a chart. */
  charts: string[];
  workbookPart: string;
}

const attr = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? decodeXml(m[2] ?? m[3] ?? '') : undefined;
};
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

/** The words inside every <t> of a piece of XML (rich text in runs, phonetic guides left out). */
function textsOf(xml: string): string {
  const clean = xml.replace(/<(\w+:)?rPh\b[\s\S]*?<\/\1?rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) out += decodeXml(m[1]);
  return out;
}

/** Excel's own number formats that are dates or times. */
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function isDateCode(code: string): boolean {
  const bare = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  return /[dmyhs]/i.test(bare) && !/^general$/i.test(bare.trim());
}

/** Which styles are dates, by their index (styles.xml cellXfs). */
function dateStyles(styles: string | null): Set<string> {
  const out = new Set<string>();
  if (!styles) return out;
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<(?:\w+:)?numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attr(m[1], 'numFmtId'));
    const code = attr(m[1], 'formatCode');
    if (Number.isFinite(id) && code !== undefined) custom.set(id, code);
  }
  const xfs = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(styles)?.[1] ?? '';
  let i = 0;
  for (const m of xfs.matchAll(/<(?:\w+:)?xf\b([^>]*?)(\/>|>[\s\S]*?<\/(?:\w+:)?xf>)/g)) {
    const id = Number(attr(m[1], 'numFmtId') ?? 0);
    if (DATE_IDS.has(id) || (custom.has(id) && isDateCode(custom.get(id)!))) out.add(String(i));
    i++;
  }
  return out;
}

/** Excel's day number as a date (1900 date system): 46313 → 2026-10-18. */
export function serialToIso(n: number): string {
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  const iso = d.toISOString();
  return n % 1 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}
export function isoToSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(iso.trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  return Number.isFinite(ms) ? ms / 86400000 + 25569 : null;
}

/** A sheet's XML: its rows and cells with where each sits in the text (to change one without touching the rest). */
interface RowSpan {
  row: number;
  start: number;
  end: number;
  open: string;
  selfClosing: boolean;
  cells: CellSpan[];
}
interface CellSpan {
  col: number;
  row: number;
  start: number;
  end: number;
  attrs: string;
  inner: string;
}
interface SheetXml {
  prefix: string;
  rows: RowSpan[];
  /** Where new rows go when no row comes after them: just before </sheetData>, or the empty <sheetData/>. */
  dataEnd: number;
  dataSelfClosing: { start: number; end: number } | null;
}

function scanSheet(xml: string): SheetXml {
  const prefix = /<(\w+:)?worksheet\b/.exec(xml)?.[1] ?? '';
  const P = prefix.replace(':', '\\:');
  const rows: RowSpan[] = [];
  const empty = new RegExp(`<${P}sheetData\\b[^>]*\\/>`).exec(xml);
  const dataOpen = new RegExp(`<${P}sheetData\\b[^>]*>`).exec(xml);
  const dataClose = xml.lastIndexOf(`</${prefix}sheetData>`);
  if (empty && (!dataOpen || empty.index <= dataOpen.index)) return { prefix, rows, dataEnd: empty.index, dataSelfClosing: { start: empty.index, end: empty.index + empty[0].length } };
  if (!dataOpen || dataClose < 0) throw new Error('A sheet this can’t read (no cells part).');
  const body = xml.slice(0, dataClose);
  const rowRe = new RegExp(`<${P}row\\b([^>]*?)(\\/>|>([\\s\\S]*?)<\\/${P}row>)`, 'g');
  const cellRe = new RegExp(`<${P}c\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${P}c>)`, 'g');
  rowRe.lastIndex = dataOpen.index + dataOpen[0].length;
  let lastRow = 0;
  for (let m = rowRe.exec(body); m; m = rowRe.exec(body)) {
    const r = Number(attr(m[1], 'r')) || lastRow + 1;
    lastRow = r;
    const span: RowSpan = { row: r, start: m.index, end: m.index + m[0].length, open: `<${prefix}row${m[1]}>`, selfClosing: m[2] === '/>', cells: [] };
    if (m[3] !== undefined) {
      const innerStart = m.index + m[0].indexOf('>') + 1;
      let lastCol = 0;
      for (const c of m[3].matchAll(cellRe)) {
        const at = parseRef(attr(c[1], 'r') ?? '');
        const col = at?.col ?? lastCol + 1;
        lastCol = col;
        span.cells.push({ col, row: r, start: innerStart + c.index!, end: innerStart + c.index! + c[0].length, attrs: c[1], inner: c[2] ?? '' });
      }
    }
    rows.push(span);
  }
  return { prefix, rows, dataEnd: dataClose, dataSelfClosing: null };
}

/** A workbook's sheets and cells. */
export async function readWorkbook(buf: Buffer): Promise<Workbook> {
  const parts = zipParts(buf);
  const rels = await partText(buf, parts, '_rels/.rels');
  const main = (rels && [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => m[1]).find((a) => /officeDocument"?$/.test(attr(a, 'Type') ?? '') || /\/officeDocument$/.test(attr(a, 'Type') ?? ''))) || '';
  const workbookPart = (attr(main, 'Target') ?? 'xl/workbook.xml').replace(/^\//, '');
  const wb = await partText(buf, parts, workbookPart);
  if (!wb || !/<(\w+:)?workbook\b/.test(wb)) throw new Error('This isn’t an Excel workbook this can change (.xlsx, .xlsm, .xltx).');
  const dir = workbookPart.includes('/') ? workbookPart.slice(0, workbookPart.lastIndexOf('/') + 1) : '';
  const wbRels = (await partText(buf, parts, `${dir}_rels/${workbookPart.slice(dir.length)}.rels`)) ?? '';
  const targets = new Map<string, { target: string; type: string }>();
  for (const m of wbRels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], 'Id');
    const target = attr(m[1], 'Target');
    if (id && target) targets.set(id, { target: target.startsWith('/') ? target.slice(1) : path.posix.normalize(dir + target), type: attr(m[1], 'Type') ?? '' });
  }
  const sharedPart = [...targets.values()].find((t) => /\/sharedStrings$/.test(t.type))?.target;
  const shared: string[] = [];
  const sst = sharedPart ? await partText(buf, parts, sharedPart) : null;
  if (sst) for (const m of sst.matchAll(/<(?:\w+:)?si\b[^>]*?\/>|<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)) shared.push(m[1] ? textsOf(m[1]) : '');
  const stylesPart = [...targets.values()].find((t) => /\/styles$/.test(t.type))?.target;
  const dates = dateStyles(stylesPart ? await partText(buf, parts, stylesPart) : null);
  const sheets: Sheet[] = [];
  const charts: string[] = [];
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
    const name = attr(m[1], 'name') ?? '';
    const id = /\s[\w]+:id\s*=\s*"([^"]*)"/.exec(m[1])?.[1];
    const t = id ? targets.get(id) : undefined;
    if (!t) continue;
    if (/\/chartsheet$/.test(t.type)) {
      charts.push(name);
      continue;
    }
    const xml = await partText(buf, parts, t.target);
    if (!xml) continue;
    const state = attr(m[1], 'state');
    sheets.push({ name, part: t.target, hidden: state === 'hidden' || state === 'veryHidden', ...cellsOf(xml, shared, dates) });
  }
  return { sheets, charts, workbookPart };
}

function cellsOf(xml: string, shared: string[], dates: Set<string>): { cells: Map<string, Cell>; maxRow: number; maxCol: number } {
  const scan = scanSheet(xml);
  const cells = new Map<string, Cell>();
  let maxRow = 0, maxCol = 0;
  for (const r of scan.rows)
    for (const c of r.cells) {
      const cell = readCell(c, shared, dates);
      if (cell.value === '' && cell.formula === undefined) continue;
      cells.set(cell.ref, cell);
      maxRow = Math.max(maxRow, c.row);
      maxCol = Math.max(maxCol, c.col);
    }
  return { cells, maxRow, maxCol };
}

function readCell(c: CellSpan, shared: string[], dates: Set<string>): Cell {
  const t = attr(c.attrs, 't') ?? 'n';
  const style = attr(c.attrs, 's');
  const fm = /<(?:\w+:)?f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?f>)/.exec(c.inner);
  const v = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(c.inner)?.[1];
  let value: Cell['value'] = '';
  let text = false, date = false;
  if (t === 's') {
    value = v !== undefined ? (shared[Number(v)] ?? '') : '';
    text = true;
  } else if (t === 'inlineStr') {
    value = textsOf(/<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/.exec(c.inner)?.[1] ?? '');
    text = true;
  } else if (t === 'str' || t === 'e') {
    value = v !== undefined ? decodeXml(v) : '';
    text = t === 'str';
  } else if (t === 'b') value = v === '1';
  else if (t === 'd') {
    value = v ?? '';
    date = true;
  } else if (v !== undefined && v.trim() !== '') {
    const n = Number(v);
    value = Number.isFinite(n) ? n : decodeXml(v);
    date = typeof value === 'number' && !!style && dates.has(style);
  }
  const cell: Cell = { ref: refOf(c.col, c.row), col: c.col, row: c.row, value, text, date, ...(style !== undefined ? { style } : {}) };
  if (fm) {
    const shared = attr(fm[1], 't') === 'shared';
    cell.formula = fm[2] !== undefined && fm[2] !== '' ? decodeXml(fm[2]) : '';
    if (shared && !cell.formula) cell.sharedFormula = true;
    if (shared && cell.formula) cell.sharedMaster = true;
  }
  return cell;
}

/** How a cell's value reads: dates as dates, words quoted only when they could be mistaken. */
export function shown(c: Pick<Cell, 'value' | 'date' | 'formula' | 'sharedFormula'>, max = 80): string {
  if (c.formula !== undefined) return c.sharedFormula ? '=(the formula of the column)' : `=${c.formula.length > max ? `${c.formula.slice(0, max - 1)}…` : c.formula}`;
  if (typeof c.value === 'boolean') return c.value ? 'TRUE' : 'FALSE';
  if (c.date && typeof c.value === 'number') return serialToIso(c.value);
  const s = String(c.value).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ── What "back to a blank template" clears ────────────────────────────────────────────────────────────────────────

/** Headings of columns people fill in as the work goes (cleared by a reset). */
const ENTRY_HEAD = /(^|[^a-z])(status|state|owners?|assignee|assigned(\s+to)?|responsible|resp|who|done\s+by|completed\s+by|actioned\s+by|due|due\s+date|date|dates|deadline|start(ed)?(\s+date)?|finish(ed)?(\s+date)?|end\s+date|completed?(\s+on|\s+date)?|done|actuals?|forecast|eta|notes?|comments?|remarks?|updates?|progress|percent|%(\s*(complete|done))?|rag|result|outcome|response|answer|sign[\s-]?off|signed(\s+off)?|initials|approved(\s+by)?|checked(\s+by)?|tick|yes\s*\/\s*no|y\s*\/\s*n|issues?|blockers?|cost|amount|spent|invoice|po\s*(no|number)?|qty|quantity|value|received)($|[^a-z])/i;
/** Headings of the template's own columns (kept). */
const STRUCTURE_HEAD = /(^|[^a-z])(tasks?|items?|activit(y|ies)|actions?|steps?|descriptions?|details?|requirements?|questions?|areas?|categor(y|ies)|phases?|stages?|sections?|workstreams?|streams?|groups?|ref|reference|no\.?|number|#|id|deliverables?|milestones?|what|checklist|check|lead\s+time|offset|duration|days?(\s+(before|after|prior|out))?|weeks?(\s+(before|after|prior|out))?|guidance|how|instructions?|standard|default|order|sequence|priority|dependenc(y|ies)|depends\s+on|department|team|function|role|type|kind|level|template)($|[^a-z])/i;
/** Values that are filled in rather than written into a template. */
const ENTRY_VALUE = /^(done|complete|completed|finished|in progress|wip|started|not started|open|closed|pending|blocked|on hold|waiting|yes|no|y|n|n\/a|na|tbc|tbd|ok|x|✓|✔|✗|☑|☒|green|amber|red|late|overdue|cancelled|canceled)$/i;
/** A label a filled-in field sits beside ("Venue:", "Opening date", "Prepared by"). */
const FIELD_LABEL = /(:\s*$)|^(store|site|shop|branch|location|address|project|client|customer|name|manager|cafe manager|site manager|project manager|owner|prepared by|completed by|author|date|start date|end date|opening( date)?|go[\s-]?live( date)?|launch( date)?|handover( date)?|phone|mobile|email|contact|version|reference|ref|po( number)?|budget|region|country|city)$/i;

export interface ResetColumn {
  sheet: string;
  col: string;
  heading: string;
  cleared: number;
}
export interface ResetPlan {
  /** Cells to clear, by sheet. */
  clear: Map<string, Set<string>>;
  /** Columns cleared under a heading, and fields cleared beside their labels. */
  columns: ResetColumn[];
  fields: { sheet: string; ref: string; label: string }[];
  /** Per sheet: the heading row found, and the columns kept as the template's own. */
  sheets: { sheet: string; headingRow?: number; kept: string[]; formulas: number }[];
}

/** The heading row of a sheet: the row near the top with the most short words in a row of cells, with entries under it. */
function headingRow(s: Sheet): number | undefined {
  let best: { row: number; n: number } | undefined;
  for (let r = 1; r <= Math.min(s.maxRow, 40); r++) {
    let n = 0, other = 0;
    for (let c = 1; c <= Math.min(s.maxCol, 60); c++) {
      const cell = s.cells.get(refOf(c, r));
      if (!cell) continue;
      if (cell.text && cell.formula === undefined && String(cell.value).trim().length <= 40) n++;
      else other++;
    }
    if (n < 2 || other > n) continue;
    // Something must be under it.
    let below = 0;
    for (let rr = r + 1; rr <= Math.min(s.maxRow, r + 30) && !below; rr++) for (let c = 1; c <= s.maxCol && !below; c++) if (s.cells.has(refOf(c, rr))) below++;
    if (!below) continue;
    if (!best || n > best.n) best = { row: r, n };
  }
  return best?.row;
}

/** What a reset would clear: filled-in entries under entry headings (and columns whose values are clearly entries),
 * fields beside labels above the headings; never a formula, a heading or the template's own words. `keep` and `only`
 * narrow it (ranges, each with its sheet or for every sheet). */
export function planReset(wb: Workbook, opts: { keep?: CellRange[]; sheets?: string[] } = {}): ResetPlan {
  const plan: ResetPlan = { clear: new Map(), columns: [], fields: [], sheets: [] };
  const kept = (sheet: string, col: number, row: number) => (opts.keep ?? []).some((k) => (!k.sheet || k.sheet.toLowerCase() === sheet.toLowerCase()) && inRange(k, col, row));
  for (const s of wb.sheets) {
    if (opts.sheets?.length && !opts.sheets.some((n) => n.toLowerCase() === s.name.toLowerCase())) continue;
    const clear = new Set<string>();
    const add = (cell: Cell) => {
      if (cell.formula !== undefined || kept(s.name, cell.col, cell.row)) return false;
      clear.add(cell.ref);
      return true;
    };
    const head = headingRow(s);
    const keptCols: string[] = [];
    let formulas = 0;
    for (const c of s.cells.values()) if (c.formula !== undefined) formulas++;
    if (head) {
      for (let col = 1; col <= s.maxCol; col++) {
        const h = s.cells.get(refOf(col, head));
        const heading = h ? String(h.value).replace(/\s+/g, ' ').trim() : '';
        const under: Cell[] = [];
        for (let r = head + 1; r <= s.maxRow; r++) {
          const c = s.cells.get(refOf(col, r));
          if (c) under.push(c);
        }
        const values = under.filter((c) => c.formula === undefined && String(c.value).trim() !== '');
        if (!values.length) {
          if (heading && under.some((c) => c.formula !== undefined)) keptCols.push(`${colLetters(col)} ${heading} (formulas)`);
          continue;
        }
        const entryish = values.filter((c) => c.date || typeof c.value === 'boolean' || ENTRY_VALUE.test(String(c.value).trim()) || /^\d{1,3}(\.\d+)?%$/.test(String(c.value).trim())).length / values.length;
        const isEntry = heading ? ENTRY_HEAD.test(heading) || (!STRUCTURE_HEAD.test(heading) && entryish >= 0.6) : entryish >= 0.8;
        if (!isEntry) {
          keptCols.push(heading ? `${colLetters(col)} ${heading}` : colLetters(col));
          continue;
        }
        let n = 0;
        for (const c of values) if (add(c)) n++;
        if (n) plan.columns.push({ sheet: s.name, col: colLetters(col), heading: heading || '(no heading)', cleared: n });
      }
    }
    // Fields beside their labels ("Venue:" Wexley St), above the headings (or anywhere on a sheet without them).
    const top = head ? head - 1 : s.maxRow;
    for (let r = 1; r <= top; r++) {
      for (let col = 2; col <= s.maxCol; col++) {
        const cell = s.cells.get(refOf(col, r));
        if (!cell || cell.formula !== undefined || String(cell.value).trim() === '') continue;
        if (cell.text && /:\s*$/.test(String(cell.value))) continue;
        let label: Cell | undefined;
        for (let lc = col - 1; lc >= Math.max(1, col - 2) && !label; lc--) label = s.cells.get(refOf(lc, r));
        if (!label || !label.text || label.formula !== undefined) continue;
        const words = String(label.value).replace(/\s+/g, ' ').trim();
        if (!FIELD_LABEL.test(words) || words.length > 40) continue;
        if (add(cell)) plan.fields.push({ sheet: s.name, ref: cell.ref, label: words.replace(/:\s*$/, '') });
      }
    }
    if (clear.size) plan.clear.set(s.name, clear);
    plan.sheets.push({ sheet: s.name, ...(head ? { headingRow: head } : {}), kept: keptCols, formulas });
  }
  return plan;
}

// ── Changing cells ────────────────────────────────────────────────────────────────────────────────────────────────

export type CellValue = string | number | boolean | null;
export interface CellEdit {
  sheet: string;
  ref: string;
  /** null clears it (its formatting stays). Words starting with = are a formula. */
  value: CellValue;
}

function cellXml(p: string, ref: string, style: string | undefined, value: CellValue, isDateStyle: boolean): string {
  const s = style !== undefined ? ` s="${escAttr(style)}"` : '';
  if (value === null || value === '') return `<${p}c r="${ref}"${s}/>`;
  if (typeof value === 'boolean') return `<${p}c r="${ref}"${s} t="b"><${p}v>${value ? 1 : 0}</${p}v></${p}c>`;
  if (typeof value === 'number' && Number.isFinite(value)) return `<${p}c r="${ref}"${s}><${p}v>${value}</${p}v></${p}c>`;
  const text = String(value);
  if (text.startsWith('=') && text.length > 1) return `<${p}c r="${ref}"${s}><${p}f>${escText(text.slice(1))}</${p}f></${p}c>`;
  // A date written as 2026-10-18 in a cell formatted as a date is stored as Excel's day number.
  const serial = isDateStyle ? isoToSerial(text) : null;
  if (serial !== null) return `<${p}c r="${ref}"${s}><${p}v>${serial}</${p}v></${p}c>`;
  if (/^-?\d+(\.\d+)?$/.test(text.trim()) && text.trim().length < 16) return `<${p}c r="${ref}"${s}><${p}v>${Number(text.trim())}</${p}v></${p}c>`;
  return `<${p}c r="${ref}"${s} t="inlineStr"><${p}is><${p}t xml:space="preserve">${escText(text)}</${p}t></${p}is></${p}c>`;
}

/** A sheet's XML with cells changed; every other byte as it was. */
function editSheetXml(xml: string, edits: CellEdit[], dates: Set<string>): string {
  const scan = scanSheet(xml);
  const p = scan.prefix;
  const byRow = new Map<number, Map<number, CellValue>>();
  for (const e of edits) {
    const at = parseRef(e.ref);
    if (!at) throw new Error(`${e.ref} isn’t a cell’s address (like B4).`);
    if (!byRow.has(at.row)) byRow.set(at.row, new Map());
    byRow.get(at.row)!.set(at.col, e.value);
  }
  const out: { start: number; end: number; text: string }[] = [];
  const rowAt = new Map(scan.rows.map((r) => [r.row, r]));
  const fresh: { row: number; text: string }[] = [];
  for (const [row, cols] of byRow) {
    const span = rowAt.get(row);
    const cellsNow = new Map((span?.cells ?? []).map((c) => [c.col, c]));
    const allCols = [...new Set([...cellsNow.keys(), ...cols.keys()])].sort((a, b) => a - b);
    let inner = '';
    let added = false;
    for (const col of allCols) {
      const now = cellsNow.get(col);
      if (!cols.has(col)) {
        inner += xml.slice(now!.start, now!.end);
        continue;
      }
      const style = now ? attr(now.attrs, 's') : undefined;
      const value = cols.get(col)!;
      if (!now && (value === null || value === '')) continue;
      if (!now) added = true;
      inner += cellXml(p, refOf(col, row), style, value, !!style && dates.has(style));
    }
    if (span) {
      // A row given new cells loses its "spans" hint (it's only a hint, and would be wrong now).
      const open = added ? span.open.replace(/\sspans\s*=\s*"[^"]*"/, '') : span.open;
      out.push({ start: span.start, end: span.end, text: inner ? `${open.replace(/\/>$/, '>')}${inner}</${p}row>` : open.replace(/>$/, '/>').replace(/\/\/>$/, '/>') });
    } else if (inner) fresh.push({ row, text: `<${p}row r="${row}">${inner}</${p}row>` });
  }
  // New rows go before the first row after them.
  fresh.sort((a, b) => a.row - b.row);
  if (scan.dataSelfClosing && fresh.length) {
    const open = xml.slice(scan.dataSelfClosing.start, scan.dataSelfClosing.end).replace(/\s*\/>$/, '>');
    out.push({ start: scan.dataSelfClosing.start, end: scan.dataSelfClosing.end, text: `${open}${fresh.map((f) => f.text).join('')}</${p}sheetData>` });
  } else {
    const groups = new Map<number, string>();
    for (const f of fresh) {
      const next = scan.rows.find((r) => r.row > f.row);
      const at = next ? next.start : scan.dataEnd;
      groups.set(at, (groups.get(at) ?? '') + f.text);
    }
    for (const [at, text] of groups) out.push({ start: at, end: at, text });
  }
  out.sort((a, b) => b.start - a.start || b.end - a.end);
  let result = xml;
  for (const o of out) result = result.slice(0, o.start) + o.text + result.slice(o.end);
  return result;
}

/** Formulas' kept answers taken out of a sheet (Excel works them out again when it opens; nothing shows a stale total). */
function dropKeptAnswers(xml: string): string {
  const prefix = /<(\w+:)?worksheet\b/.exec(xml)?.[1] ?? '';
  const P = prefix.replace(':', '\\:');
  // A self-closing cell (<c r="A1"/>) is never read as one that opens.
  const cellRe = new RegExp(`<${P}c\\b([^>]*?)(?<!\\/)>([\\s\\S]*?)<\\/${P}c>`, 'g');
  return xml.replace(cellRe, (whole, attrs: string, inner: string) => {
    if (!new RegExp(`<${P}f\\b`).test(inner)) return whole;
    const v = new RegExp(`<${P}v\\b[^>]*>[\\s\\S]*?<\\/${P}v>|<${P}v\\s*\\/>`, 'g');
    if (!v.test(inner)) return whole;
    return `<${prefix}c${attrs.replace(/\st\s*=\s*"[^"]*"/, '')}>${inner.replace(v, '')}</${prefix}c>`;
  });
}

/** Excel told to work every formula out again when the workbook opens. */
function calcOnLoad(wb: string): string {
  const calc = /<(\w+:)?calcPr\b([^>]*?)(\/?)>/.exec(wb);
  if (calc) {
    if (/fullCalcOnLoad\s*=/.test(calc[2])) return wb.replace(calc[0], calc[0].replace(/fullCalcOnLoad\s*=\s*"[^"]*"/, 'fullCalcOnLoad="1"'));
    return wb.replace(calc[0], `<${calc[1] ?? ''}calcPr${calc[2]} fullCalcOnLoad="1"${calc[3]}>`);
  }
  const prefix = /<(\w+:)?workbook\b/.exec(wb)?.[1] ?? '';
  for (const after of ['definedNames', 'externalReferences', 'functionGroups', 'sheets']) {
    const close = wb.indexOf(`</${prefix}${after}>`);
    if (close >= 0) {
      const at = close + `</${prefix}${after}>`.length;
      return `${wb.slice(0, at)}<${prefix}calcPr fullCalcOnLoad="1"/>${wb.slice(at)}`;
    }
  }
  return wb;
}

export interface WorkbookChange {
  edits?: CellEdit[];
  /** Ranges to clear (values only; formatting stays). Formula cells inside are left unless `formulas` is set. */
  clear?: CellRange[];
  /** Back to a blank template (planReset). */
  reset?: boolean | { keep?: CellRange[]; sheets?: string[] };
}
export interface WorkbookChanged {
  bytes: Buffer;
  /** Cells set, and cleared, per sheet. */
  set: number;
  cleared: number;
  plan?: ResetPlan;
  /** Formula cells a clear left alone. */
  formulasKept: number;
}

/** A workbook with cells set, ranges cleared, or the entries cleared back to a blank template. */
export async function changeWorkbook(buf: Buffer, change: WorkbookChange): Promise<WorkbookChanged> {
  const wb = await readWorkbook(buf);
  const parts = zipParts(buf);
  const sheetNamed = (name: string | undefined): Sheet => {
    if (!name) {
      if (wb.sheets.length === 1) return wb.sheets[0];
      throw new Error(`Say which sheet: ${wb.sheets.map((s) => `“${s.name}”`).join(', ')} (for example "${wb.sheets[0]?.name}!B4").`);
    }
    const s = wb.sheets.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? wb.sheets.find((x) => x.name.toLowerCase().replace(/\s+/g, '') === name.toLowerCase().replace(/\s+/g, ''));
    if (!s) throw new Error(`There is no sheet “${name}”. The sheets: ${wb.sheets.map((x) => `“${x.name}”`).join(', ')}.`);
    return s;
  };
  const edits = new Map<string, Map<string, CellValue>>();
  const put = (s: Sheet, ref: string, value: CellValue) => {
    if (!edits.has(s.name)) edits.set(s.name, new Map());
    edits.get(s.name)!.set(ref.toUpperCase().replace(/\$/g, ''), value);
  };
  let set = 0, cleared = 0, formulasKept = 0;
  const touchesFormulas = new Set<string>();
  let plan: ResetPlan | undefined;
  if (change.reset) {
    const o = typeof change.reset === 'object' ? change.reset : {};
    plan = planReset(wb, o);
    for (const [name, refs] of plan.clear) {
      const s = sheetNamed(name);
      for (const ref of refs) {
        put(s, ref, null);
        cleared++;
      }
    }
  }
  for (const r of change.clear ?? []) {
    const s = sheetNamed(r.sheet);
    for (const c of s.cells.values()) {
      if (!inRange(r, c.col, c.row)) continue;
      if (c.formula !== undefined) {
        formulasKept++;
        continue;
      }
      put(s, c.ref, null);
      cleared++;
    }
  }
  for (const e of change.edits ?? []) {
    const s = sheetNamed(e.sheet || undefined);
    const at = parseRef(e.ref);
    if (!at) throw new Error(`${e.ref} isn’t a cell’s address (like B4).`);
    const now = s.cells.get(refOf(at.col, at.row));
    if (now?.sharedMaster) throw new Error(`${s.name}!${now.ref} holds a formula other cells share: change one of the cells after it instead, or the whole column.`);
    if (now?.formula !== undefined) touchesFormulas.add(s.name);
    put(s, refOf(at.col, at.row), e.value);
    set++;
  }
  if (!edits.size) return { bytes: buf, set: 0, cleared: 0, formulasKept, ...(plan ? { plan } : {}) };
  const changed = new Map<string, Buffer>();
  const stylesTarget = parts.find((p) => /(^|\/)styles\.xml$/.test(p.name))?.name;
  const dates = dateStyles(stylesTarget ? await partText(buf, parts, stylesTarget) : null);
  for (const [name, cells] of edits) {
    const s = sheetNamed(name);
    let xml = (await partText(buf, parts, s.part))!;
    xml = editSheetXml(xml, [...cells].map(([ref, value]) => ({ sheet: name, ref, value })), dates);
    if ([...cells.values()].some((v) => v === null)) xml = dropKeptAnswers(xml);
    changed.set(s.part, Buffer.from(xml, 'utf8'));
  }
  changed.set(wb.workbookPart, Buffer.from(calcOnLoad((await partText(buf, parts, wb.workbookPart))!), 'utf8'));
  // A changed formula cell can leave Excel's list of formulas (calcChain) pointing at a cell without one, which Excel
  // reports as a problem: the list goes (Excel makes it again).
  const removed = new Set<string>();
  const chain = parts.find((p) => /(^|\/)calcChain\.xml$/.test(p.name));
  if (chain && touchesFormulas.size) {
    removed.add(chain.name);
    const relsName = `${wb.workbookPart.replace(/[^/]+$/, '')}_rels/${wb.workbookPart.split('/').pop()}.rels`;
    const rels = await partText(buf, parts, relsName);
    if (rels) changed.set(relsName, Buffer.from(rels.replace(/<Relationship\b[^>]*calcChain[^>]*\/>/g, ''), 'utf8'));
    const types = await partText(buf, parts, '[Content_Types].xml');
    if (types) changed.set('[Content_Types].xml', Buffer.from(types.replace(/<Override\b[^>]*calcChain[^>]*\/>/g, ''), 'utf8'));
  }
  return { bytes: rewriteZip(buf, parts, changed, removed), set, cleared, formulasKept, ...(plan ? { plan } : {}) };
}

/** A workbook as the assistant reads it: each sheet's heading row, what a reset would clear and keep, then its cells row
 * by row with their addresses (formulas start with =). `range` (with its sheet) looks at part of one sheet. */
export function workbookWords(wb: Workbook, opts: { sheet?: string; range?: CellRange; maxChars?: number } = {}): string {
  const max = opts.maxChars ?? 14_000;
  const plan = planReset(wb);
  const lines: string[] = [`${wb.sheets.length} ${wb.sheets.length === 1 ? 'sheet' : 'sheets'}: ${wb.sheets.map((s) => `“${s.name}”${s.maxRow ? ` (A1:${refOf(Math.max(1, s.maxCol), Math.max(1, s.maxRow))})` : ' (empty)'}${s.hidden ? ' hidden' : ''}`).join(', ')}${wb.charts.length ? `; chart sheets: ${wb.charts.join(', ')}` : ''}`];
  const wanted = opts.range?.sheet ?? opts.sheet;
  const sheets = wanted ? wb.sheets.filter((s) => s.name.toLowerCase() === wanted.toLowerCase()) : wb.sheets;
  if (wanted && !sheets.length) throw new Error(`There is no sheet “${wanted}”. The sheets: ${wb.sheets.map((s) => `“${s.name}”`).join(', ')}.`);
  let used = lines[0].length;
  let cut = '';
  for (const s of sheets) {
    const info = plan.sheets.find((x) => x.sheet === s.name);
    const block: string[] = ['', `Sheet “${s.name}”`];
    if (info?.headingRow) {
      const heads: string[] = [];
      for (let c = 1; c <= s.maxCol; c++) {
        const h = s.cells.get(refOf(c, info.headingRow));
        if (h && String(h.value).trim()) heads.push(`${colLetters(c)} ${String(h.value).replace(/\s+/g, ' ').trim()}`);
      }
      block.push(`Headings in row ${info.headingRow}: ${heads.join(' · ')}`);
    }
    const cols = plan.columns.filter((c) => c.sheet === s.name);
    const fields = plan.fields.filter((f) => f.sheet === s.name);
    if (cols.length || fields.length) block.push(`A reset clears (filled in): ${[...cols.map((c) => `${c.col} ${c.heading} (${c.cleared} ${c.cleared === 1 ? 'cell' : 'cells'})`), ...fields.map((f) => `${f.ref} beside “${f.label}”`)].join(' · ')}`);
    else block.push('A reset clears nothing here.');
    block.push(`A reset keeps: ${['the headings and titles', ...(info?.kept.length ? [info.kept.join(', ')] : []), ...(info?.formulas ? [`${info.formulas} formula ${info.formulas === 1 ? 'cell' : 'cells'}`] : []), 'all formatting'].join('; ')}`);
    block.push('Cells:');
    const r = opts.range;
    const rows = new Map<number, Cell[]>();
    for (const c of s.cells.values()) {
      if (r && !inRange(r, c.col, c.row)) continue;
      if (!rows.has(c.row)) rows.set(c.row, []);
      rows.get(c.row)!.push(c);
    }
    const blockText = block.join('\n');
    used += blockText.length;
    lines.push(blockText);
    for (const row of [...rows.keys()].sort((a, b) => a - b)) {
      const line = `${row}: ${rows.get(row)!.sort((a, b) => a.col - b.col).map((c) => `${c.ref} ${shown(c)}`).join(' | ')}`;
      if (used + line.length > max) {
        const last = Math.max(...rows.keys());
        cut = `… rows ${row} to ${last} of “${s.name}” aren’t shown: ask with range "${s.name}!A${row}:${colLetters(Math.max(1, s.maxCol))}${last}".`;
        break;
      }
      lines.push(line);
      used += line.length + 1;
    }
    if (!rows.size) lines.push('(no cells with anything in them)');
    if (cut) break;
  }
  if (cut) lines.push(cut);
  return lines.join('\n');
}

/**
 * The whole workbook in one look, short (18 Oct 2026: the checklist — many sheets — was paged through cell range by cell
 * range 32 times and nothing was made). Every sheet: its name and used range, its title rows and the fields beside
 * labels, its heading row, how many rows sit under it, which columns are filled-in entries (a reset clears them) and
 * which are the template's own, its formulas, and its first few rows. Enough to act on without reading cells; a range
 * still reads part of a sheet (workbookWords).
 */
export function workbookOverview(wb: Workbook, opts: { maxChars?: number; sampleRows?: number } = {}): string {
  const max = opts.maxChars ?? 9_000;
  const samples = opts.sampleRows ?? 3;
  const plan = planReset(wb);
  const cut = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);
  const out: string[] = [`${wb.sheets.length} ${wb.sheets.length === 1 ? 'sheet' : 'sheets'}${wb.charts.length ? ` (and chart sheets: ${wb.charts.join(', ')})` : ''}. This is the whole workbook in short:`];
  let used = out[0].length;
  const short: string[] = [];
  for (const s of wb.sheets) {
    const info = plan.sheets.find((x) => x.sheet === s.name);
    const head = info?.headingRow;
    let formulas = 0;
    for (const c of s.cells.values()) if (c.formula !== undefined) formulas++;
    const range = s.maxRow ? `A1:${refOf(Math.max(1, s.maxCol), s.maxRow)}` : 'empty';
    const lines = [`Sheet “${s.name}” (${range}${s.hidden ? ', hidden' : ''}${formulas ? `, ${formulas} ${formulas === 1 ? 'formula' : 'formulas'}` : ''})`];
    // Above the headings: titles, and fields beside their labels.
    const fields = plan.fields.filter((f) => f.sheet === s.name);
    const fieldRefs = new Set(fields.map((f) => f.ref));
    const titles: string[] = [];
    for (let r = 1; r <= (head ? head - 1 : Math.min(s.maxRow, 3)); r++)
      for (let c = 1; c <= Math.min(s.maxCol, 12); c++) {
        const cell = s.cells.get(refOf(c, r));
        if (!cell || fieldRefs.has(cell.ref) || String(cell.value).trim() === '') continue;
        if (titles.length < 6) titles.push(`${cell.ref} ${cut(shown(cell), 40)}`);
      }
    if (titles.length) lines.push(`  Above the headings: ${titles.join(' · ')}`);
    if (fields.length) lines.push(`  Filled-in fields: ${fields.map((f) => `${f.ref} beside “${f.label}” = ${cut(shown(s.cells.get(f.ref)!), 30)}`).join(' · ')}`);
    if (head) {
      const heads: string[] = [];
      for (let c = 1; c <= s.maxCol; c++) {
        const h = s.cells.get(refOf(c, head));
        if (h && String(h.value).trim()) heads.push(`${colLetters(c)} ${cut(String(h.value).replace(/\s+/g, ' ').trim(), 30)}`);
      }
      let rowsUnder = 0;
      for (let r = head + 1; r <= s.maxRow; r++) for (let c = 1; c <= s.maxCol; c++) if (s.cells.has(refOf(c, r))) { rowsUnder++; break; }
      lines.push(`  Headings in row ${head}: ${heads.join(' · ')}`);
      lines.push(`  ${rowsUnder} ${rowsUnder === 1 ? 'row' : 'rows'} under the headings (rows ${head + 1}–${s.maxRow})`);
    }
    const cols = plan.columns.filter((c) => c.sheet === s.name);
    lines.push(cols.length || fields.length ? `  A reset clears (filled in): ${[...cols.map((c) => `${c.col} ${c.heading} (${c.cleared} ${c.cleared === 1 ? 'cell' : 'cells'})`), ...fields.map((f) => `${f.ref} beside “${f.label}”`)].join(' · ')}` : '  A reset clears nothing here.');
    lines.push(`  A reset keeps: ${['the headings and titles', ...(info?.kept.length ? [info.kept.join(', ')] : []), ...(formulas ? [`${formulas} formula ${formulas === 1 ? 'cell' : 'cells'}`] : []), 'all formatting'].join('; ')}`);
    // A few rows under the headings (or the top of a sheet without them).
    const first = head ? head + 1 : 1;
    const rows: string[] = [];
    for (let r = first; r <= s.maxRow && rows.length < samples; r++) {
      const cells: string[] = [];
      for (let c = 1; c <= s.maxCol && cells.length < 8; c++) {
        const cell = s.cells.get(refOf(c, r));
        if (cell) cells.push(`${cell.ref} ${cut(shown(cell, 40), 40)}`);
      }
      if (cells.length) rows.push(`${r}: ${cells.join(' | ')}`);
    }
    if (rows.length) lines.push(`  First rows: ${rows.join(' ; ')}`);
    const block = lines.join('\n');
    // Once one doesn't fit, the rest are a line each too (in the workbook's order).
    if (short.length || used + block.length > max) {
      short.push(`“${s.name}” (${range}${head ? `, headings in row ${head}` : ''}${cols.length ? `, a reset clears ${cols.map((c) => c.col).join(' ')}` : ''})`);
      continue;
    }
    out.push(block);
    used += block.length + 1;
  }
  if (short.length) out.push(`More sheets, in a line each: ${short.join(' · ')}`);
  return out.join('\n');
}

/** Words in a name that say only which copy it is, not what it is: a master, a version, a date, a draft. */
const COPY_WORDS = /^(master|original|copy|final|draft|template|blank|working|wip|latest|updated|v\d+(\.\d+)*|rev(ision)?\d*|\d{4}-?\d{2}-?\d{2}|\d{1,2}-\d{1,2}-\d{2,4}|\d{6,8}|\(\d+\)|\d+)$/i;

/** A name's words, split at _ - . spaces and where a capital starts a word ("WexleySt" → Wexley, St). */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_\-–—.,()[\]]+/)
    .filter(Boolean);
}

/** A project's own words in a file name: the words of its name other than numbers and what is in brackets ("07 Wexley St
 *  Ashford (Launch)" → wexley, st, ashford). */
export function projectOwnWords(projectName: string): string[] {
  return nameWords(projectName.replace(/\([^)]*\)/g, ' '))
    .map((w) => w.toLowerCase())
    .filter((w) => !/^\d+$/.test(w));
}

/** Whether a file is a project's own working copy: its name holds the project's own words ("…_WexleySt.xlsx" in "07 Wexley St
 *  Ashford (Launch)"): one long word, or two. */
export function isOwnCopy(fileName: string, projectName: string): boolean {
  const own = new Set(projectOwnWords(projectName));
  const words = nameWords(fileName.replace(/\.[^.]+$/, '')).map((w) => w.toLowerCase());
  const hit = words.filter((w) => own.has(w));
  return hit.some((w) => w.length >= 4) || hit.length >= 2;
}

/** Whether a file's name says it is a master or a template ("…_MASTER.xlsx", "Blank template.docx"). */
export const isMasterCopy = (fileName: string) => nameWords(fileName.replace(/\.[^.]+$/, '')).some((w) => /^(master|template|blank|original)$/i.test(w));

/**
 * A file's name in plain words without the one job's details (a site or store, a person, a date, MASTER, a version):
 * "Cafe_Opening_Checklist_WexleySt.xlsx" in the Wexley St project → "Cafe Opening Checklist". The project's own words are left out.
 */
export function plainName(fileName: string, projectName = ''): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const own = new Set(projectOwnWords(projectName));
  const words = nameWords(base).filter((w) => !own.has(w.toLowerCase()) && !COPY_WORDS.test(w));
  return safeFileName(words.join(' ')) || safeFileName(base.replace(/[_]+/g, ' ')) || base;
}

/** A template's name: "Launch template – Cafe Opening Checklist.xlsx" (with what it is for), else "Cafe Opening Checklist – template.xlsx". */
export function templateName(fileName: string, projectName = '', purpose = ''): string {
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  const plain = plainName(fileName, projectName);
  const what = safeFileName(purpose.replace(/\btemplate\b/gi, '').trim());
  return `${what ? `${what} template – ${plain}` : `${plain} – template`}${ext}`;
}

// ── Word and PowerPoint: words replaced ───────────────────────────────────────────────────────────────────────────

const WORD_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const SLIDE_PARTS = /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/;

/** Words replaced in one part's XML, across the runs a paragraph's words are split into; the formatting of the run where
 * a match starts is kept. Returns the new XML and how many were replaced for each pair. */
export function replaceInXml(xml: string, pairs: { find: string; text: string }[], kind: 'word' | 'slides'): { xml: string; counts: number[] } {
  const t = kind === 'word' ? 'w:t' : 'a:t';
  const para = kind === 'word' ? '</w:p>' : '</a:p>';
  const token = new RegExp(`<${t}(\\s[^>]*)?>([\\s\\S]*?)</${t}>|<${t}(\\s[^>]*)?/>|${para.replace('/', '\\/')}`, 'g');
  const nodes: { start: number; end: number; attrs: string; text: string }[] = [];
  /** The words in order: a node's index, or -1 for the end of a paragraph (a match never crosses one). */
  const order: number[] = [];
  for (const m of xml.matchAll(token)) {
    if (m[0] === para) {
      order.push(-1);
      continue;
    }
    nodes.push({ start: m.index!, end: m.index! + m[0].length, attrs: m[1] ?? m[3] ?? '', text: m[2] !== undefined ? decodeXml(m[2]) : '' });
    order.push(nodes.length - 1);
  }
  const texts = nodes.map((n) => n.text);
  const counts = pairs.map(() => 0);
  // Each pair in turn, on the words as the pairs before it left them.
  pairs.forEach(({ find, text }, pi) => {
    if (!find || find.includes('\n')) return;
    let line = '';
    const own: number[] = [];
    const off: number[] = [];
    for (const n of order) {
      if (n < 0) {
        line += '\n';
        own.push(-1);
        off.push(0);
        continue;
      }
      for (let k = 0; k < texts[n].length; k++) {
        own.push(n);
        off.push(k);
      }
      line += texts[n];
    }
    const hits: number[] = [];
    for (let at = line.indexOf(find); at >= 0; at = line.indexOf(find, at + find.length)) hits.push(at);
    // From the end, so earlier offsets stay right.
    for (const at of hits.reverse()) {
      const a = own[at], b = own[at + find.length - 1];
      const aOff = off[at], bOff = off[at + find.length - 1];
      if (a === b) texts[a] = texts[a].slice(0, aOff) + text + texts[a].slice(bOff + 1);
      else {
        const tail = texts[b].slice(bOff + 1);
        texts[a] = texts[a].slice(0, aOff) + text;
        for (let k = a + 1; k < b; k++) texts[k] = '';
        texts[b] = tail;
      }
      counts[pi]++;
    }
  });
  let out = xml;
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (texts[i] === nodes[i].text) continue;
    const n = nodes[i];
    const attrs = /xml:space=/.test(n.attrs) ? n.attrs : `${n.attrs} xml:space="preserve"`;
    out = out.slice(0, n.start) + `<${t}${attrs}>${escText(texts[i])}</${t}>` + out.slice(n.end);
  }
  return { xml: out, counts };
}

/** A Word document or a PowerPoint with words replaced in its body, headers, footers, notes and slides. */
export async function replaceInOffice(buf: Buffer, ext: string, pairs: { find: string; text: string }[]): Promise<{ bytes: Buffer; counts: number[] }> {
  const parts = zipParts(buf);
  const kind = /^(docx|docm|dotx|dotm)$/i.test(ext) ? 'word' : 'slides';
  const which = kind === 'word' ? WORD_PARTS : SLIDE_PARTS;
  const changed = new Map<string, Buffer>();
  const counts = pairs.map(() => 0);
  const named = parts.filter((p) => which.test(p.name)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  if (!named.length) throw new Error(kind === 'word' ? 'This isn’t a Word document this can change.' : 'This isn’t a PowerPoint this can change.');
  for (const p of named) {
    const xml = (await zipRead(buf, p, 128 * 1024 * 1024)).toString('utf8');
    const r = replaceInXml(xml, pairs, kind);
    r.counts.forEach((n, i) => (counts[i] += n));
    if (r.xml !== xml) changed.set(p.name, Buffer.from(r.xml, 'utf8'));
  }
  return { bytes: changed.size ? rewriteZip(buf, parts, changed) : buf, counts };
}

// ── Kinds, names and writing ──────────────────────────────────────────────────────────────────────────────────────

export const WORKBOOK_EXTS = /^(xlsx|xlsm|xltx|xltm)$/i;
export const WORD_EXTS = /^(docx|docm|dotx|dotm)$/i;
export const SLIDES_EXTS = /^(pptx|pptm|potx|potm)$/i;
export const PLAIN_EXTS = /^(md|markdown|txt|text|csv|tsv|json|yaml|yml|xml|html?|ini|cfg|conf|log)$/i;

/** What can be changed in a file of this kind, in words (for a file that can only be copied). */
export function editableKind(ext: string): 'workbook' | 'word' | 'slides' | 'plain' | null {
  if (WORKBOOK_EXTS.test(ext)) return 'workbook';
  if (WORD_EXTS.test(ext)) return 'word';
  if (SLIDES_EXTS.test(ext)) return 'slides';
  if (PLAIN_EXTS.test(ext)) return 'plain';
  return null;
}

/** A file name Windows accepts: no \ / : * ? " < > |, no dots or spaces at the end. */
export function safeFileName(name: string): string {
  return cleanFileName(name, '', 180);
}

/** A name not taken in its folder: "Name.xlsx", else "Name (2).xlsx", "Name (3).xlsx"… */
export async function freeName(abs: string, exists: (p: string) => Promise<boolean> = async (p) => !!(await fsp.lstat(p).catch(() => null))): Promise<string> {
  if (!(await exists(abs))) return abs;
  const ext = path.extname(abs);
  const base = abs.slice(0, abs.length - ext.length).replace(/ \(\d+\)$/, '');
  for (let n = 2; n < 1000; n++) {
    const next = `${base} (${n})${ext}`;
    if (!(await exists(next))) return next;
  }
  throw new Error('Too many files with that name already.');
}

export const hashOf = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Writes a file: a new one (never over a file that is there), or a whole file replaced through a temporary file. */
export async function writeFileSafely(abs: string, data: Buffer, mode: 'new' | 'replace'): Promise<void> {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  if (mode === 'new') {
    await fsp.writeFile(abs, data, { flag: 'wx' });
    return;
  }
  const tmp = `${abs}.${process.pid}.${Date.now()}.nvtmp`;
  await fsp.writeFile(tmp, data, { flag: 'wx' });
  try {
    await fsp.rename(tmp, abs);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}
