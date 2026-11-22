// SPDX-License-Identifier: AGPL-3.0-or-later
// The note's tables read out of its finished HTML blocks, without a browser (22 Nov 2026, Design studio phase 2). The
// main side has no DOM, and the blocks are our own (brandContent in src/shared/brand-document.ts writes them: tables
// with a ruled header, paragraphs, headings, lists, quotes, pictures, all with their words escaped), so a small,
// careful tokenizer is enough: tags and their attributes, words with their entities decoded. What comes out is plain
// words only, never a tag: each table's header and rows, the heading it sits under, and a cell's web link when the
// cell is only that link.

export interface HtmlCell {
  text: string;
  /** A web or mail link when the cell holds only that link. */
  link?: string;
}

export interface HtmlTable {
  /** The nearest heading before the table (in its block or an earlier one), or ''. */
  heading: string;
  /** The header row's words, or null when the table has none. */
  head: string[] | null;
  rows: HtmlCell[][];
  /** Which of the note's blocks it came from. */
  block: number;
}

interface Tag {
  type: 'open' | 'close';
  name: string;
  attrs: Record<string, string>;
}
type Token = Tag | { type: 'text'; text: string };

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', times: '×', middot: '·', bull: '•', euro: '€', pound: '£', yen: '¥', cent: '¢', copy: '©', reg: '®', deg: '°', minus: '−' };

/** Entities as the characters they name (numeric ones too); an unknown one stays as written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});/gi, (all, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    return NAMED[body.toLowerCase()] ?? all;
  });
}

const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function tokenize(html: string): Token[] {
  const out: Token[] = [];
  let at = 0;
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(html); m; m = TAG_RE.exec(html)) {
    if (m.index > at) out.push({ type: 'text', text: decodeEntities(html.slice(at, m.index)) });
    at = m.index + m[0].length;
    if (!m[2]) continue; // a comment
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    for (let a = ATTR_RE.exec(m[3] ?? ''); a; a = ATTR_RE.exec(m[3] ?? '')) attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    out.push({ type: m[1] ? 'close' : 'open', name: m[2].toLowerCase(), attrs });
  }
  // A stray "<" that opens no tag is a word (the blocks escape theirs, so this is only ever text).
  if (at < html.length) out.push({ type: 'text', text: decodeEntities(html.slice(at)) });
  return out;
}

/** Tags whose ending starts a new line inside a cell or heading. */
const BREAKS = new Set(['p', 'div', 'li', 'tr', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'aside', 'figure', 'pre', 'blockquote']);
/** Tags whose words are never shown. */
const HIDDEN = new Set(['script', 'style', 'template', 'colgroup', 'head', 'title']);

/** Words collected as they read: spaces collapsed, line breaks kept, nothing at either end. */
class Words {
  private parts: string[] = [];
  add(t: string) {
    this.parts.push(t.replace(/\s+/g, ' '));
  }
  line() {
    this.parts.push('\n');
  }
  text(): string {
    return this.parts
      .join('')
      .split('\n')
      .map((l) => l.replace(/ {2,}/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  }
}

/** A block's (or any HTML's) words, tags out and entities decoded. */
export function htmlText(html: string): string {
  const w = new Words();
  let hidden = 0;
  for (const t of tokenize(html)) {
    if (t.type === 'text') {
      if (!hidden) w.add(t.text);
    } else if (HIDDEN.has(t.name)) hidden += t.type === 'open' ? 1 : hidden ? -1 : 0;
    else if (t.type === 'open' && t.name === 'img' && !hidden) w.add(t.attrs.alt ?? '');
    else if (BREAKS.has(t.name)) w.line();
  }
  return w.text();
}

const WEB_LINK = /^(https?:\/\/|mailto:)/i;

/** Every table in the blocks, in order, each with the heading it sits under. */
export function readTables(blocks: string[]): HtmlTable[] {
  const tables: HtmlTable[] = [];
  let heading = '';
  blocks.forEach((html, block) => {
    let hidden = 0;
    let headingWords: Words | null = null;
    let headingLevel = '';
    let table: HtmlTable | null = null;
    let inHead = false;
    let row: { cells: HtmlCell[]; allTh: boolean; inHead: boolean } | null = null;
    let cell: { words: Words; th: boolean; links: string[]; other: boolean; inLink: boolean } | null = null;
    let depth = 0; // tables inside a table cell read as the cell's words
    const endCell = () => {
      if (!cell || !row) return;
      const text = cell.words.text();
      const link = cell.links.length === 1 && !cell.other ? cell.links[0] : undefined;
      row.cells.push(link ? { text, link } : { text });
      if (!cell.th) row.allTh = false;
      cell = null;
    };
    const endRow = () => {
      endCell();
      if (!row || !table) return;
      if (row.cells.length) {
        if (!table.head && !table.rows.length && (row.inHead || row.allTh)) table.head = row.cells.map((c) => c.text);
        else table.rows.push(row.cells);
      }
      row = null;
    };
    for (const t of tokenize(html)) {
      if (t.type !== 'text' && HIDDEN.has(t.name)) {
        hidden += t.type === 'open' ? 1 : hidden ? -1 : 0;
        continue;
      }
      if (hidden) continue;
      if (t.type === 'text') {
        if (cell) {
          cell.words.add(t.text);
          if (t.text.trim() && !cell.inLink) cell.other = true;
        } else if (headingWords) headingWords.add(t.text);
        continue;
      }
      if (/^h[1-6]$/.test(t.name) && !table) {
        if (t.type === 'open') {
          headingWords = new Words();
          headingLevel = t.name;
        } else if (headingWords && t.name === headingLevel) {
          heading = headingWords.text().replace(/\n/g, ' ');
          headingWords = null;
        }
        continue;
      }
      if (t.name === 'table') {
        if (t.type === 'open') {
          if (table) depth++;
          else table = { heading, head: null, rows: [], block };
        } else if (depth) depth--;
        else if (table) {
          endRow();
          tables.push(table);
          table = null;
        }
        continue;
      }
      if (!table) continue;
      if (depth) {
        if (cell && t.type === 'close' && BREAKS.has(t.name)) cell.words.line();
        continue;
      }
      if (t.name === 'thead') inHead = t.type === 'open';
      else if (t.name === 'tr') {
        endRow();
        if (t.type === 'open') row = { cells: [], allTh: true, inHead };
      } else if (t.name === 'td' || t.name === 'th') {
        endCell();
        if (t.type === 'open') {
          if (!row) row = { cells: [], allTh: true, inHead };
          cell = { words: new Words(), th: t.name === 'th', links: [], other: false, inLink: false };
        }
      } else if (cell) {
        if (t.name === 'a') {
          cell.inLink = t.type === 'open';
          const href = (t.attrs.href ?? '').trim();
          if (t.type === 'open') {
            if (WEB_LINK.test(href)) cell.links.push(href);
            else cell.other = true;
          }
        } else if (t.type === 'open' && t.name === 'img') {
          cell.words.add(t.attrs.alt ?? '');
          cell.other = true;
        } else if (t.name === 'br' || (t.type === 'close' && BREAKS.has(t.name))) cell.words.line();
      }
    }
    // A table the block never closed still counts.
    if (table) {
      endRow();
      tables.push(table);
    }
  });
  return tables;
}
