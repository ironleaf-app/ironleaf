// The words in a project folder's files, for searching inside them (src/main/file-index.ts): Markdown, text and CSV as
// they are; Word, Excel and PowerPoint (and their LibreOffice cousins) by reading the XML inside them with a small zip
// reader of our own and Node's zlib; PDFs with the PDF.js Ironleaf already ships (Apache-2.0, ASSETS.md), in a worker
// thread so a long PDF never holds up the window. Inside the former host app, the documents Ironleaf can't read itself
// (emails, older Office files, RTF) go to the former host app's document reader. Pictures have no words here (no OCR).
// Nothing is written anywhere: these only read.

import { promises as fsp } from 'node:fs';
import { inflateRaw } from 'node:zlib';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { FILE_INDEX_LIMITS } from '../shared/file-index';
import { decodeUtf16be, decodeUtf16le } from './utf16';

// ── The kinds of file ──────────────────────────────────────────────────────────────────────────────────────────────

/** Read as text as they are. */
export const TEXT_EXTS = new Set(['md', 'markdown', 'txt', 'text', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'log', 'ini', 'cfg', 'conf', 'ps1', 'psm1', 'psd1', 'sh', 'bat', 'cmd', 'sql', 'py', 'js', 'ts', 'css', 'vbs', 'reg']);
/** Read from the XML inside them. */
export const OFFICE_EXTS = new Set(['docx', 'docm', 'dotx', 'xlsx', 'xlsm', 'xltx', 'pptx', 'pptm', 'potx', 'ppsx', 'odt', 'ods', 'odp']);
/** Read by the former host app when Ironleaf runs inside it. */
export const BRIDGE_EXTS = new Set(['doc', 'xls', 'ppt', 'rtf', 'msg', 'eml']);

export type TextKind = 'text' | 'office' | 'pdf' | 'bridge' | 'none';
export function textKindOf(ext: string, bridge: boolean): TextKind {
  const e = ext.toLowerCase();
  if (TEXT_EXTS.has(e)) return 'text';
  if (OFFICE_EXTS.has(e)) return 'office';
  if (e === 'pdf') return 'pdf';
  if (bridge && BRIDGE_EXTS.has(e)) return 'bridge';
  return 'none';
}

// ── A small zip reader ────────────────────────────────────────────────────────────────────────────────────────────

export interface ZipEntry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

/** The files a zip holds, from its central directory (what Office files are made of). Throws when it isn't a zip. */
export function zipEntries(buf: Buffer): ZipEntry[] {
  // The end of the central directory: its signature within the last 64 KB (a comment may follow it).
  const min = Math.max(0, buf.length - 0xffff - 22);
  let end = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Not a zip file.');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  if (at === 0xffffffff || at >= buf.length) throw new Error('A zip this program does not read.');
  const out: ZipEntry[] = [];
  for (let n = 0; n < count && at + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30);
    const comment = buf.readUInt16LE(at + 32);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', at + 46, at + 46 + nameLength);
    out.push({ name, method, compressed, size, offset });
    at += 46 + nameLength + extra + comment;
  }
  return out;
}

/** One file inside a zip, unpacked (at most `max` bytes: a file that unpacks bigger is refused). */
export async function zipRead(buf: Buffer, entry: ZipEntry, max = 64 * 1024 * 1024): Promise<Buffer> {
  const at = entry.offset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) throw new Error('A damaged zip file.');
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const data = buf.subarray(start, start + entry.compressed);
  if (entry.method === 0) return data.length > max ? Promise.reject(new Error('Too big to read.')) : data;
  if (entry.method !== 8) throw new Error('A zip packed in a way this program does not read.');
  return new Promise((resolve, reject) => inflateRaw(data, { maxOutputLength: max }, (err, out) => (err ? reject(err) : resolve(out))));
}

/** The files in a zip by name, unpacked as text (UTF-8), those `want` picks. */
async function zipTexts(buf: Buffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let total = 0;
  for (const e of zipEntries(buf)) {
    if (!want(e.name)) continue;
    // A part that unpacks past 32 MB (or 96 MB in all) is more than search reads: the file is found by its name.
    const bytes = await zipRead(buf, e, 32 * 1024 * 1024);
    total += bytes.length;
    if (total > 96 * 1024 * 1024) throw new Error('Too big to read.');
    out.set(e.name, bytes.toString('utf8'));
  }
  return out;
}

// ── XML to words ──────────────────────────────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      } catch {
        return m;
      }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Lines tidied: spaces in a row made one, empty lines left out (search goes line by line). */
function tidy(text: string): string {
  return text
    .split('\n')
    .map((l) => (l.startsWith('\f') ? l.replace(/\s+$/, '') : l.replace(/[ \t\u00a0]+/g, ' ').trim()))
    .filter(Boolean)
    .join('\n');
}

/**
 * Words from Office XML: the text inside the tags named by `textTag` (w:t, a:t…), a new line at the end of each
 * paragraph, cells of a table row side by side. Deleted words (tracked changes) and field codes are left out.
 */
function wordsFromXml(xml: string, o: { text: RegExp; para: RegExp; cell?: RegExp; row?: RegExp; tab?: RegExp; br?: RegExp; skip?: RegExp }): string {
  let out = '';
  let inText = 0;
  let skipping = 0;
  let cellDepth = 0;
  const tag = /<(\/?)([A-Za-z_][\w.-]*:?[\w.-]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    if (m[5] !== undefined) {
      if (inText && !skipping) out += decodeXml(m[5]);
      continue;
    }
    const closing = m[1] === '/';
    const self = m[4] === '/';
    const name = m[2];
    if (o.skip?.test(name)) {
      if (!self) skipping += closing ? -1 : 1;
      if (skipping < 0) skipping = 0;
      continue;
    }
    if (o.text.test(name)) {
      if (!self) inText += closing ? -1 : 1;
      if (inText < 0) inText = 0;
      continue;
    }
    if (o.tab?.test(name) && !closing) out += '\t';
    else if (o.br?.test(name) && !closing) out += '\n';
    else if (o.cell?.test(name)) {
      if (!closing && !self) cellDepth++;
      else if (closing) {
        cellDepth = Math.max(0, cellDepth - 1);
        out = out.replace(/[ \n]+$/, '') + ' | ';
      }
    } else if (o.row?.test(name) && closing) out = out.replace(/ \| $/, '') + '\n';
    else if (o.para.test(name) && (closing || self)) out += cellDepth ? ' ' : '\n';
  }
  return out;
}

const DOCX = { text: /^w:t$/, para: /^w:p$/, cell: /^w:tc$/, row: /^w:tr$/, tab: /^w:tab$/, br: /^w:(br|cr)$/, skip: /^w:(delText|instrText)$/ };
const DRAWING = { text: /^a:t$/, para: /^a:p$/, cell: /^a:tc$/, row: /^a:tr$/, br: /^a:br$/ };
const ODF = { text: /^text:(p|h|span|a)$/, para: /^text:(p|h)$/, cell: /^table:table-cell$/, row: /^table:table-row$/, tab: /^text:tab$/, br: /^text:line-break$/ };

const byNumber = (re: RegExp) => (a: string, b: string) => Number(re.exec(a)?.[1] ?? 0) - Number(re.exec(b)?.[1] ?? 0);

/** A Word document's words: the body, then headers, footers, footnotes and comments. */
export async function docxText(buf: Buffer): Promise<string> {
  const parts = await zipTexts(buf, (n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(n));
  const body = parts.get('word/document.xml');
  if (body === undefined) throw new Error('Not a Word document.');
  const rest = [...parts.keys()].filter((k) => k !== 'word/document.xml').sort();
  return tidy([wordsFromXml(body, DOCX), ...rest.map((k) => wordsFromXml(parts.get(k)!, DOCX))].join('\n'));
}

/** A presentation's words, slide by slide ("\fslide 1"), each slide's notes after it. */
export async function pptxText(buf: Buffer): Promise<string> {
  const parts = await zipTexts(buf, (n) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n));
  const slides = [...parts.keys()].filter((k) => k.startsWith('ppt/slides/')).sort(byNumber(/slide(\d+)\.xml$/));
  if (!slides.length && !parts.size) throw new Error('Not a presentation.');
  const out: string[] = [];
  for (const s of slides) {
    const n = /slide(\d+)\.xml$/.exec(s)![1];
    out.push(`\fslide ${n}`, wordsFromXml(parts.get(s)!, DRAWING));
    const notes = parts.get(`ppt/notesSlides/notesSlide${n}.xml`);
    // A notes page repeats the slide's number in its own box; what's left is the speaker's notes.
    const said = notes ? tidy(wordsFromXml(notes, DRAWING)).replace(new RegExp(`(^|\\n)${n}(\\n|$)`), '$1$2').trim() : '';
    if (said) out.push(`Notes: ${said}`);
  }
  return tidy(out.join('\n'));
}

/** Excel's built-in date formats; and a custom format is a date when it has days, months or years (not in quotes). */
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** An Excel day number as the day it means (2025-01-01 for 45658): whole days, a time with it stays on its day; null
 *  when it isn't one (9.5 O5: the one serial rule the sheet doors share). */
export function excelSerialIso(serial: unknown): string | null {
  const n = typeof serial === 'number' ? serial : typeof serial === 'string' && serial.trim() ? Number(serial.trim()) : NaN;
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return null;
  const d = new Date(Math.floor(n - 25569) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** A spreadsheet's day number as people read it here ("13 Oct 2026"). */
export function excelDate(serial: number): string {
  const iso = excelSerialIso(serial);
  if (!iso) return String(serial);
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** A workbook's words, sheet by sheet ("\f<Sheet name>"), each row's cells side by side; dates as dates. */
export async function xlsxText(buf: Buffer, maxChars: number = FILE_INDEX_LIMITS.fileChars): Promise<string> {
  const parts = await zipTexts(buf, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || n === 'xl/styles.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const book = parts.get('xl/workbook.xml');
  if (book === undefined) throw new Error('Not a workbook.');
  // Shared words: each <si> one string (rich text in runs; phonetic guides left out).
  const shared: string[] = [];
  for (const si of (parts.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(decodeXml([...si[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  }
  // Which cell styles are dates.
  const styles = parts.get('xl/styles.xml') ?? '';
  const customDates = new Set<number>();
  for (const f of styles.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(f[0], 'numFmtId'));
    const code = decodeXml(attr(f[0], 'formatCode') ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    if (/[dmy]/i.test(code) && !/^[#0.,%\s]*$/.test(code)) customDates.add(id);
  }
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const dateStyle = [...xfs.matchAll(/<xf\b[^>]*>/g)].map((x) => {
    const id = Number(attr(x[0], 'numFmtId') ?? 0);
    return DATE_FORMATS.has(id) || customDates.has(id);
  });
  // The sheets in the book's order, with their names.
  const rels = new Map([...(parts.get('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)].map((r) => [attr(r[0], 'Id') ?? '', (attr(r[0], 'Target') ?? '').replace(/^\/?xl\//, '').replace(/^\//, '')]));
  const sheets = [...book.matchAll(/<sheet\b[^>]*>/g)].map((s) => ({ name: decodeXml(attr(s[0], 'name') ?? ''), file: `xl/${rels.get(attr(s[0], 'r:id') ?? '') ?? ''}` }));
  const listed = sheets.filter((s) => parts.has(s.file));
  const order = listed.length ? listed : [...parts.keys()].filter((k) => k.startsWith('xl/worksheets/')).sort(byNumber(/sheet(\d+)\.xml$/)).map((file, i) => ({ name: `Sheet ${i + 1}`, file }));
  const out: string[] = [];
  let chars = 0;
  for (const sheet of order) {
    out.push(`\f${sheet.name}`);
    for (const row of parts.get(sheet.file)!.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const head = c[1];
        const body = c[2] ?? '';
        const t = attr(head, 't');
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = '';
        if (t === 's') value = v !== undefined ? (shared[Number(v)] ?? '') : '';
        else if (t === 'inlineStr') value = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
        else if (t === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else if (v !== undefined) {
          const s = Number(attr(head, 's') ?? -1);
          const n = Number(v);
          value = t !== 'str' && t !== 'e' && dateStyle[s] && Number.isFinite(n) ? excelDate(n) : decodeXml(v);
        }
        if (value.trim()) cells.push(value.trim());
      }
      if (!cells.length) continue;
      const line = cells.join(' | ');
      out.push(line);
      chars += line.length + 1;
      if (chars > maxChars) return tidy(out.join('\n'));
    }
  }
  return tidy(out.join('\n'));
}

/** A LibreOffice (OpenDocument) file's words: its content.xml. */
export async function odfText(buf: Buffer): Promise<string> {
  const parts = await zipTexts(buf, (n) => n === 'content.xml');
  const content = parts.get('content.xml');
  if (content === undefined) throw new Error('Not an OpenDocument file.');
  // Spaces written as <text:s/> count as one.
  return tidy(wordsFromXml(content.replace(/<text:s\b[^>]*\/>/g, ' ').replace(/<draw:page\b[^>]*draw:name="([^"]*)"[^>]*>/g, (_m, n) => `<text:p>\f${n}</text:p>`), ODF));
}

export async function officeText(buf: Buffer, ext: string, maxChars?: number): Promise<string> {
  const e = ext.toLowerCase();
  if (e.startsWith('doc') || e === 'dotx') return docxText(buf);
  if (e.startsWith('xl')) return xlsxText(buf, maxChars);
  if (e.startsWith('pp') || e === 'potx') return pptxText(buf);
  return odfText(buf);
}

// ── Text files ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A text file's words (UTF-8, or UTF-16 as Windows tools often write); null when it is not text after all. */
export function plainText(buf: Buffer, ext: string): string | null {
  let text: string;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = decodeUtf16le(buf, 2);
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = decodeUtf16be(buf, 2);
  else {
    if (buf.subarray(0, Math.min(buf.length, 8000)).includes(0)) return null;
    text = buf.toString('utf8').replace(/^﻿/, '');
  }
  text = text.replace(/\r\n?/g, '\n');
  if (ext === 'html' || ext === 'htm' || ext === 'xml') {
    text = decodeXml(text.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|h\d|li|tr|br)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '));
  }
  // A line that starts with \f would read as a page's start.
  return text.replace(/\f/g, ' ');
}

// ── PDFs, in a worker thread ──────────────────────────────────────────────────────────────────────────────────────

/** Where PDF.js is (its main file and its worker), as file paths. */
export interface PdfJsFiles {
  lib: string;
  worker: string;
}

// The worker's code: PDF.js loaded once, each PDF's pages read into lines ("\fpage N" before each page).
const PDF_WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
for (const k of ['log', 'warn', 'info']) console[k] = () => {};
let lib = null;
const load = async () => {
  if (!lib) {
    lib = await import(workerData.lib);
    lib.GlobalWorkerOptions.workerSrc = workerData.worker;
  }
  return lib;
};
parentPort.on('message', async ({ id, data, maxPages, maxChars }) => {
  let task = null;
  try {
    const pdfjs = await load();
    task = pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false, verbosity: 0 });
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, maxPages);
    let out = '';
    for (let n = 1; n <= pages && out.length < maxChars; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let line = '';
      const lines = [];
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        line += item.str;
        if (item.hasEOL) { lines.push(line); line = ''; }
      }
      if (line) lines.push(line);
      out += '\\f' + 'page ' + n + '\\n' + lines.join('\\n') + '\\n';
      page.cleanup();
    }
    parentPort.postMessage({ id, text: out, pages: doc.numPages });
  } catch (err) {
    parentPort.postMessage({ id, error: (err && err.name === 'PasswordException') ? 'protected' : String((err && err.message) || err) });
  } finally {
    try { if (task) await task.destroy(); } catch {}
  }
});
`;

/** Reads PDFs' words one at a time in a worker thread; the worker goes after a while unused, or when a PDF takes too long. */
export class PdfReader {
  private worker: Worker | null = null;
  private idle: NodeJS.Timeout | undefined;
  private next = 1;
  private waiting = new Map<number, { resolve(v: string): void; reject(e: Error): void; timer: NodeJS.Timeout }>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly files: () => PdfJsFiles | null,
    private readonly timeoutMs = 45_000,
  ) {}

  private start(): Worker {
    if (this.worker) return this.worker;
    const files = this.files();
    if (!files) throw new Error('PDF reading isn’t available.');
    const w = new Worker(PDF_WORKER, { eval: true, workerData: { lib: pathToFileURL(files.lib).href, worker: pathToFileURL(files.worker).href }, resourceLimits: { maxOldGenerationSizeMb: 768 } });
    w.unref();
    w.on('message', (m: { id: number; text?: string; error?: string }) => {
      const job = this.waiting.get(m.id);
      if (!job) return;
      this.waiting.delete(m.id);
      clearTimeout(job.timer);
      if (m.error !== undefined) job.reject(new Error(m.error));
      else job.resolve(m.text ?? '');
    });
    const fail = (err: Error) => {
      if (this.worker === w) this.worker = null;
      for (const [id, job] of this.waiting) {
        clearTimeout(job.timer);
        job.reject(err);
        this.waiting.delete(id);
      }
    };
    w.on('error', fail);
    w.on('exit', () => fail(new Error('The PDF reader stopped.')));
    this.worker = w;
    return w;
  }

  /** A PDF's words, "\fpage N" before each page. */
  read(data: Uint8Array, maxPages: number = FILE_INDEX_LIMITS.pages, maxChars: number = FILE_INDEX_LIMITS.fileChars): Promise<string> {
    const run = () =>
      new Promise<string>((resolve, reject) => {
        clearTimeout(this.idle);
        let w: Worker;
        try {
          w = this.start();
        } catch (err) {
          return reject(err as Error);
        }
        const id = this.next++;
        const timer = setTimeout(() => {
          // Too long (a huge or strange PDF): the worker is stopped and the next PDF gets a new one.
          this.waiting.delete(id);
          reject(new Error('Took too long to read.'));
          if (this.worker === w) this.worker = null;
          void w.terminate();
        }, this.timeoutMs);
        this.waiting.set(id, { resolve, reject, timer });
        w.postMessage({ id, data, maxPages, maxChars }, [data.buffer as ArrayBuffer]);
      }).finally(() => {
        clearTimeout(this.idle);
        this.idle = setTimeout(() => this.stop(), 30_000);
        this.idle.unref?.();
      });
    const job = this.queue.then(run, run);
    this.queue = job.catch(() => {});
    return job;
  }

  stop(): void {
    clearTimeout(this.idle);
    const w = this.worker;
    this.worker = null;
    if (w) void w.terminate();
  }
}

// ── One file ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ReadOptions {
  pdf: PdfReader | null;
  /** Inside the former host app: its document reader. */
  bridge?: (abs: string) => Promise<string | null>;
  maxChars?: number;
  limits?: Pick<typeof FILE_INDEX_LIMITS, 'textBytes' | 'docBytes' | 'pages'>;
}

export type ReadResult = { state: 'text' | 'empty'; text: string; cut: boolean } | { state: 'name' | 'big'; text?: undefined; cut?: undefined } | { state: 'failed'; text?: undefined; cut?: undefined; /** Why it couldn't be read (a broken file says so, 9.2). */ why?: string };

/** A file's words as the index keeps them. */
export async function readFileText(abs: string, ext: string, size: number, o: ReadOptions): Promise<ReadResult> {
  const max = o.maxChars ?? FILE_INDEX_LIMITS.fileChars;
  const limits = o.limits ?? FILE_INDEX_LIMITS;
  const kind = textKindOf(ext, !!o.bridge);
  if (kind === 'none') return { state: 'name' };
  if (size > (kind === 'text' ? limits.textBytes : limits.docBytes)) return { state: 'big' };
  let text: string | null;
  try {
    if (kind === 'bridge') text = await withTimeout(o.bridge!(abs), 60_000);
    else {
      const buf = await fsp.readFile(abs);
      if (kind === 'text') text = plainText(buf, ext.toLowerCase());
      else if (kind === 'office') text = await officeText(buf, ext, max);
      else {
        if (!o.pdf) return { state: 'name' };
        text = await o.pdf.read(new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), limits.pages, max);
      }
    }
  } catch (err) {
    return { state: 'failed', why: (err instanceof Error ? err.message : String(err)).slice(0, 160) || 'It couldn’t be read.' };
  }
  if (text === null) return kind === 'bridge' ? { state: 'failed', why: 'Its reader gave nothing back.' } : { state: 'name' };
  const cut = text.length > max;
  if (cut) text = text.slice(0, max);
  return { state: text.replace(/^\f.*$/gm, '').trim() ? 'text' : 'empty', text, cut };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Took too long to read.')), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

// ── A file attached to the chat ───────────────────────────────────────────────────────────────────────────────────

/**
 * The words of a file attached to the assistant's chat, from its bytes (the chat window hands over the file, never a path
 * to open): text, Office and PDF read here; inside the former host app the older documents go to its reader through a
 * copy in
 * `tmpDir`, removed straight after. A file of another kind is read as text when it is text (a .toml, a .go…). A PDF with
 * no words (a scan) is said as `scanned`, for the chat to send its pages as pictures.
 */
export async function attachmentText(name: string, buf: Buffer, o: { pdf: PdfReader | null; bridge?: (abs: string) => Promise<string | null>; tmpDir: string; maxChars: number }): Promise<{ text: string; cut: boolean } | { error: string; scanned?: boolean }> {
  const ext = (/\.([^./\\]+)$/.exec(name)?.[1] ?? '').toLowerCase();
  const kind = textKindOf(ext, !!o.bridge);
  if (kind === 'none' && BRIDGE_EXTS.has(ext)) return { error: 'This older kind of document can’t be read here. Save it as a newer Word, Excel or PowerPoint file and attach that.' };
  let text: string | null = null;
  try {
    if (kind === 'text' || kind === 'none') text = plainText(buf, ext);
    else if (kind === 'office') text = await officeText(buf, ext, o.maxChars);
    else if (kind === 'pdf') {
      if (!o.pdf) return { error: 'PDFs can’t be read here.' };
      text = (await o.pdf.read(new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), FILE_INDEX_LIMITS.pages, o.maxChars)).replace(/^\fpage (\d+)$/gm, '[page $1]');
    } else {
      await fsp.mkdir(o.tmpDir, { recursive: true });
      const copy = `${o.tmpDir}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      try {
        await fsp.writeFile(copy, buf);
        text = await withTimeout(o.bridge!(copy), 60_000);
      } finally {
        await fsp.rm(copy, { force: true }).catch(() => {});
      }
    }
  } catch (err) {
    const m = err instanceof Error ? err.message : '';
    return { error: m === 'protected' ? 'It is protected with a password.' : m === 'Took too long to read.' ? 'It took too long to read.' : 'It couldn’t be read.' };
  }
  if (text === null) return { error: kind === 'none' ? 'Only pictures and documents (PDF, Word, Excel, PowerPoint, text) can be attached.' : 'It couldn’t be read.' };
  // A scan has no words of its own: the chat draws its pages as pictures instead (src/renderer/src/lib/attach.ts).
  if (!text.replace(/^\[page \d+\]$/gm, '').trim()) return kind === 'pdf' ? { error: 'It has no words of its own (a scan), and its pages couldn’t be drawn.', scanned: true } : { error: 'It has no words in it.' };
  const cut = text.length > o.maxChars;
  return { text: cut ? text.slice(0, o.maxChars) : text, cut };
}
