// SPDX-License-Identifier: AGPL-3.0-or-later
// The Design studio's Word export (22 Nov 2026, phase 2): a note as a finished, branded Word document that stays
// fully editable. Everything is a real Word style in the brand's fonts and colours (Title, the headings, lists,
// quotes, callouts, code, captions, a table style), so the person can keep writing in it and it stays on brand.
// Page one carries the cover: the logo, a small label, the title, what the note knows and its key figures; reports
// and proposals give the cover its own page. Every later page has a slim header and the footer words with a page
// number.
//
// The note's words arrive as brandContent's finished HTML blocks (src/shared/brand-document.ts). There is no browser
// on this side, so the blocks are read by a small, forgiving reader of our own; the words inside a paragraph (bold,
// italics, links, code, pictures) go through docx's own HTML reader. Anything the reader doesn't know still reads as
// its words: no word of the note is ever dropped. Pictures print only from data addresses (nothing is fetched); any
// other picture reads as its alt words. Links that lead nowhere read as plain words.

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  ImportedXmlComponent,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlignTable,
  WidthType,
  type ILevelsOptions,
  type IParagraphStyleOptions,
  type ParagraphChild,
} from 'docx';
import { htmlToRuns, type HtmlOptions } from 'docx/html';
import type { DesignTheme } from '../../shared/design-doc';
import type { DesignExportInput } from '../../shared/design-export';

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const MM = 56.6929; // twips in a millimetre
const PAGE_W = 11906; // A4 portrait, in twips
const PAGE_H = 16838;
const MARGIN_X = Math.round(22 * MM);
const MARGIN_TOP = Math.round(24 * MM);
const MARGIN_BOTTOM = Math.round(22 * MM);
const TEXT_W = PAGE_W - 2 * MARGIN_X;
/** The text column in pixels (96 to the inch), the widest a picture may be. */
const TEXT_PX = Math.floor((TEXT_W / 1440) * 96);
const LIST_STEP = 360;
/** Tick boxes in a font that has them (Word falls back to it on its own; naming it keeps other readers off emoji). */
const SYMBOL_FONT = 'Segoe UI Symbol';
const RIGHT_TAB = [{ type: TabStopType.RIGHT, position: TEXT_W }];

// ── The theme as Word reads it ───────────────────────────────────────────────────────────────────────────────────────

interface Palette {
  accent: string;
  onAccent: string;
  strong: string;
  tint1: string;
  tint2: string;
  tint3: string;
  ink: string;
  muted: string;
  line: string;
  soft: string;
}

interface Fonts {
  head: string;
  body: string;
  mono: string;
}

const hex = (v: string | undefined, fallback: string): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(v ?? '').trim());
  return (m ? m[1] : fallback).toUpperCase();
};

function paletteOf(theme: DesignTheme): Palette {
  const t = new Map(theme.tokens);
  return {
    accent: hex(t.get('accent'), '101820'),
    onAccent: hex(t.get('on-accent'), 'FFFFFF'),
    strong: hex(t.get('accent-strong'), '101820'),
    tint1: hex(t.get('accent-1'), 'F4F5F6'),
    tint2: hex(t.get('accent-2'), 'E8EAEC'),
    tint3: hex(t.get('accent-3'), 'C9CDD1'),
    ink: hex(t.get('ink'), '101820'),
    muted: hex(t.get('muted'), '5A6067'),
    line: hex(t.get('line'), 'D6D9DC'),
    soft: hex(t.get('soft'), 'F4F5F6'),
  };
}

/** The first family of a CSS font list, unquoted. */
export function firstFamily(stack: string): string {
  const m = /^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/.exec(String(stack ?? ''));
  return (m ? (m[1] ?? m[2] ?? m[3] ?? '') : '').trim();
}

const GENERIC_SANS = /^(inter|helvetica neue|helvetica|arial|liberation sans|system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif|sans-serif|segoe ui)$/i;
const GENERIC_SERIF = /^(source serif 4|georgia|times new roman|times|liberation serif|ui-serif|serif)$/i;
const GENERIC_MONO = /^(monospace|ui-monospace|courier|courier new)$/i;

/** A font Word can name: the kit's own, else a safe one every copy of Word has (LibreOffice reads Calibri and Cambria
 *  as their metric twins, Carlito and Caladea). */
export function wordFont(stack: string, role: 'sans' | 'serif' | 'mono' = 'sans'): string {
  const name = firstFamily(stack);
  if (!name || !/^[\p{L}\p{N} ._-]{1,80}$/u.test(name)) return role === 'mono' ? 'Consolas' : role === 'serif' ? 'Cambria' : 'Calibri';
  if (GENERIC_MONO.test(name)) return 'Consolas';
  if (GENERIC_SERIF.test(name)) return 'Cambria';
  if (GENERIC_SANS.test(name)) return 'Calibri';
  return name;
}

function fontsOf(theme: DesignTheme): Fonts {
  const t = new Map(theme.tokens);
  return { head: wordFont(theme.head || t.get('font-head') || ''), body: wordFont(theme.body || t.get('font-body') || ''), mono: 'Consolas' };
}

// ── The styles ───────────────────────────────────────────────────────────────────────────────────────────────────────

const pt = (n: number) => Math.round(n * 2); // half-points
const line = (n: number) => Math.round(n * 240); // line spacing, as a multiple of single
const none = { style: BorderStyle.NONE, size: 0, color: 'auto' } as const;

function paragraphStyles(p: Palette, f: Fonts): IParagraphStyleOptions[] {
  const body = { font: f.body, size: pt(10.5), color: p.ink };
  const head = { font: f.head, color: p.ink, bold: true };
  return [
    { id: 'Normal', name: 'Normal', quickFormat: true, run: body, paragraph: { spacing: { before: 0, after: 150, line: line(1.22), lineRule: LineRuleType.AUTO } } },
    { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { ...head, size: pt(32) }, paragraph: { spacing: { before: 0, after: 160, line: line(1.02) }, keepNext: true } },
    { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: f.body, size: pt(12.5), color: p.muted }, paragraph: { spacing: { before: 0, after: 40, line: line(1.2) } } },
    { id: 'Kicker', name: 'Kicker', basedOn: 'Normal', next: 'Title', quickFormat: true, run: { font: f.head, size: pt(8.5), bold: true, allCaps: true, characterSpacing: 36, color: p.strong }, paragraph: { spacing: { before: 0, after: 140 }, keepNext: true } },
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { ...head, size: pt(17), color: p.strong }, paragraph: { spacing: { before: 440, after: 140, line: line(1.08) }, keepNext: true, keepLines: true, outlineLevel: 0 } },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { ...head, size: pt(13) }, paragraph: { spacing: { before: 320, after: 100, line: line(1.1) }, keepNext: true, keepLines: true, outlineLevel: 1 } },
    { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { ...head, size: pt(11), color: p.strong }, paragraph: { spacing: { before: 240, after: 80, line: line(1.1) }, keepNext: true, keepLines: true, outlineLevel: 2 } },
    {
      id: 'Quote',
      name: 'Quote',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: f.body, size: pt(12), italics: true, color: p.ink },
      paragraph: { spacing: { before: 200, after: 200, line: line(1.3) }, indent: { left: 400, right: 400 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: p.accent, space: 14 } } },
    },
    {
      id: 'Callout',
      name: 'Callout',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: f.body, size: pt(10.5), color: p.ink },
      paragraph: {
        spacing: { before: 200, after: 200, line: line(1.25) },
        contextualSpacing: true,
        indent: { left: 260, right: 260 },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: p.tint1 },
        border: {
          left: { style: BorderStyle.SINGLE, size: 24, color: p.accent, space: 10 },
          top: { style: BorderStyle.SINGLE, size: 4, color: p.tint1, space: 8 },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: p.tint1, space: 8 },
          right: { style: BorderStyle.SINGLE, size: 4, color: p.tint1, space: 10 },
        },
      },
    },
    {
      id: 'CodeBlock',
      name: 'Code block',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: f.mono, size: pt(9), color: p.ink },
      paragraph: {
        spacing: { before: 0, after: 0, line: line(1.15) },
        indent: { left: 200, right: 200 },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: p.soft },
        border: {
          left: { style: BorderStyle.SINGLE, size: 4, color: p.soft, space: 8 },
          right: { style: BorderStyle.SINGLE, size: 4, color: p.soft, space: 8 },
          top: { style: BorderStyle.SINGLE, size: 4, color: p.soft, space: 6 },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: p.soft, space: 6 },
        },
      },
    },
    { id: 'Caption', name: 'Caption', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: f.body, size: pt(8.5), italics: true, color: p.muted }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 60, after: 220 } } },
    { id: 'Figure', name: 'Figure', basedOn: 'Normal', next: 'Caption', run: {}, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true } },
    { id: 'ListBullet', name: 'List Bullet', basedOn: 'Normal', quickFormat: true, run: {}, paragraph: { spacing: { after: 70 } } },
    { id: 'ListNumber', name: 'List Number', basedOn: 'Normal', quickFormat: true, run: {}, paragraph: { spacing: { after: 70 } } },
    { id: 'ListTask', name: 'List Task', basedOn: 'Normal', run: {}, paragraph: { spacing: { after: 70 } } },
    { id: 'ListContinue', name: 'List Continue', basedOn: 'Normal', run: {}, paragraph: { spacing: { after: 70 } } },
    { id: 'Rule', name: 'Rule', basedOn: 'Normal', next: 'Normal', run: { size: pt(4) }, paragraph: { spacing: { before: 120, after: 280, line: line(1) }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: p.line, space: 1 } } } },
    { id: 'TableText', name: 'Table text', basedOn: 'Normal', run: { size: pt(9.5) }, paragraph: { spacing: { before: 0, after: 0, line: line(1.12) } } },
    { id: 'TableHeading', name: 'Table heading', basedOn: 'TableText', run: { font: f.head, size: pt(8.5), bold: true, color: p.onAccent }, paragraph: { keepNext: true } },
    { id: 'TableTotal', name: 'Table total', basedOn: 'TableText', run: { bold: true }, paragraph: {} },
    { id: 'FigureValue', name: 'Figure value', basedOn: 'Normal', next: 'FigureLabel', run: { font: f.head, size: pt(24), bold: true, color: p.strong }, paragraph: { spacing: { before: 0, after: 20, line: line(1) }, keepNext: true } },
    { id: 'FigureLabel', name: 'Figure label', basedOn: 'Normal', run: { size: pt(8.5), color: p.muted }, paragraph: { spacing: { before: 0, after: 0, line: line(1.1) } } },
    { id: 'MetaRow', name: 'Meta row', basedOn: 'Normal', run: { size: pt(9.5) }, paragraph: { spacing: { before: 0, after: 50 }, indent: { left: 1500, hanging: 1500 } } },
    { id: 'Note', name: 'Cover note', basedOn: 'Normal', run: { size: pt(8.5), color: p.muted }, paragraph: { spacing: { before: 0, after: 0 } } },
    { id: 'Header', name: 'header', basedOn: 'Normal', run: { size: pt(8), color: p.muted }, paragraph: { spacing: { before: 0, after: 0 } } },
    { id: 'Footer', name: 'footer', basedOn: 'Normal', run: { size: pt(8), color: p.muted }, paragraph: { spacing: { before: 0, after: 0 } } },
  ];
}

/** The table style, written whole: docx has no table-style option of its own. Borders light, the header row in the
 *  accent, the total row ruled. Direct formatting on each table repeats it, so every reader draws it the same. */
function tableStyleXml(p: Palette, f: Fonts): string {
  const b = (side: string, sz: number, color: string) => `<w:${side} w:val="single" w:sz="${sz}" w:space="0" w:color="${color}"/>`;
  return (
    `<w:style w:type="table" w:customStyle="1" w:styleId="BrandTable"><w:name w:val="Brand table"/><w:uiPriority w:val="40"/>` +
    `<w:pPr><w:spacing w:before="0" w:after="0" w:line="${line(1.12)}" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="${f.body}" w:hAnsi="${f.body}" w:cs="${f.body}"/><w:sz w:val="${pt(9.5)}"/><w:color w:val="${p.ink}"/></w:rPr>` +
    `<w:tblPr><w:tblBorders>${b('bottom', 6, p.line)}${b('insideH', 4, p.line)}</w:tblBorders><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:color w:val="${p.onAccent}"/></w:rPr><w:tblPr/><w:trPr><w:tblHeader/></w:trPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="${p.accent}"/></w:tcPr></w:tblStylePr>` +
    `<w:tblStylePr w:type="lastRow"><w:rPr><w:b/></w:rPr><w:tblPr/><w:tcPr><w:tcBorders>${b('top', 8, p.ink)}</w:tcBorders></w:tcPr></w:tblStylePr>` +
    `</w:style>`
  );
}

function characterStyles(p: Palette, f: Fonts) {
  return [
    { id: 'Hyperlink', name: 'Hyperlink', basedOn: 'DefaultParagraphFont', run: { color: p.strong, underline: { type: 'single' as const, color: p.tint3 } } },
    { id: 'InlineCode', name: 'Inline code', basedOn: 'DefaultParagraphFont', run: { font: f.mono, size: pt(9.5), shading: { type: ShadingType.CLEAR, color: 'auto', fill: p.soft } } },
  ];
}

function numberingConfig(p: Palette) {
  const bullets = ['•', '–', '▪', '•', '–', '▪', '•', '–', '▪'];
  const formats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
  const indent = (l: number) => ({ left: LIST_STEP * (l + 1), hanging: 280 });
  const bulletLevels: ILevelsOptions[] = bullets.map((text, level) => ({ level, format: LevelFormat.BULLET, text, alignment: AlignmentType.LEFT, style: { paragraph: { indent: indent(level) }, run: { color: p.strong } } }));
  const numberLevels: ILevelsOptions[] = bullets.map((_, level) => ({ level, format: formats[level % 3], text: `%${level + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: indent(level) }, run: { color: p.strong, bold: true } } }));
  return { config: [{ reference: 'brand-bullet', levels: bulletLevels }, { reference: 'brand-number', levels: numberLevels }] };
}

// ── A small, forgiving HTML reader ───────────────────────────────────────────────────────────────────────────────────
// Enough for the blocks brandContent writes and for odd HTML around them: tags, attributes, comments, void tags, the
// end tags HTML lets you leave out (li, p, td, tr), and stray end tags ignored. Text keeps its entities, so the words
// handed on to docx's reader are exactly what was written.

interface El {
  tag: string;
  attrs: Record<string, string>;
  kids: Nd[];
}
type Nd = El | string;

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp']);
const DROP = new Set(['script', 'style', 'template', 'head', 'colgroup', 'col', 'meta', 'link']);
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'html', 'legend', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'ul', 'colgroup', 'col', 'script', 'style', 'template', 'head', 'meta', 'link', 'title',
]);

const OPEN_RE = /<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const CLOSE_RE = /<\/([a-zA-Z][\w:-]*)[^>]*>/y;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', times: '×', euro: '€', pound: '£', yen: '¥', cent: '¢', deg: '°' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[name.toLowerCase()] ?? all;
  });
}

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

export function parseHtml(html: string): El {
  const root: El = { tag: '#root', attrs: {}, kids: [] };
  const stack: El[] = [root];
  const top = () => stack[stack.length - 1];
  const text = (s: string) => {
    if (!s) return;
    const kids = top().kids;
    const last = kids[kids.length - 1];
    if (typeof last === 'string') kids[kids.length - 1] = last + s;
    else kids.push(s);
  };
  /** Close the nearest open `names` element, unless one of `stop` comes first. */
  const closeTo = (names: string[], stop: string[]) => {
    for (let k = stack.length - 1; k > 0; k--) {
      const t = stack[k].tag;
      if (names.includes(t)) {
        stack.length = k;
        return;
      }
      if (stop.includes(t)) return;
    }
  };
  const s = String(html ?? '');
  const n = s.length;
  let i = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      text(s.slice(i));
      break;
    }
    if (lt > i) text(s.slice(i, lt));
    i = lt;
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (s[i + 1] === '!' || s[i + 1] === '?') {
      const end = s.indexOf('>', i);
      i = end < 0 ? n : end + 1;
      continue;
    }
    CLOSE_RE.lastIndex = i;
    const close = CLOSE_RE.exec(s);
    if (close) {
      i = CLOSE_RE.lastIndex;
      const tag = close[1].toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === tag) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    OPEN_RE.lastIndex = i;
    const open = OPEN_RE.exec(s);
    if (!open) {
      text('&lt;');
      i++;
      continue;
    }
    i = OPEN_RE.lastIndex;
    const tag = open[1].toLowerCase();
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    for (let m = ATTR_RE.exec(open[2]); m; m = ATTR_RE.exec(open[2])) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
    // The end tags HTML lets you leave out.
    if (tag === 'li') closeTo(['li'], ['ul', 'ol', 'menu', 'table']);
    else if (tag === 'dt' || tag === 'dd') closeTo(['dt', 'dd'], ['dl']);
    else if (tag === 'td' || tag === 'th') closeTo(['td', 'th'], ['tr', 'table']);
    else if (tag === 'tr') closeTo(['tr'], ['table', 'thead', 'tbody', 'tfoot']);
    else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') closeTo(['thead', 'tbody', 'tfoot'], ['table']);
    if (BLOCK.has(tag)) {
      // A block starts: an open paragraph above it (with only inline tags between) ends.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === 'p') {
          stack.length = k;
          break;
        }
        if (BLOCK.has(stack[k].tag)) break;
      }
    }
    const el: El = { tag, attrs, kids: [] };
    top().kids.push(el);
    if (VOID.has(tag) || open[3] === '/') continue;
    if (RAW.has(tag)) {
      const end = s.toLowerCase().indexOf(`</${tag}`, i);
      const body = s.slice(i, end < 0 ? n : end);
      if (tag === 'textarea' || tag === 'xmp') el.kids.push(escText(body));
      else if (tag === 'title') el.kids.push(body);
      const gt = end < 0 ? -1 : s.indexOf('>', end);
      i = gt < 0 ? n : gt + 1;
      continue;
    }
    stack.push(el);
  }
  return root;
}

const isEl = (n: Nd): n is El => typeof n !== 'string';
const isBlock = (n: Nd) => isEl(n) && BLOCK.has(n.tag);

/** The words of a node, as a reader sees them. */
export function textOf(n: Nd): string {
  if (!isEl(n)) return decodeEntities(n);
  if (DROP.has(n.tag)) return '';
  if (n.tag === 'br') return '\n';
  if (n.tag === 'img') return n.attrs.alt ?? '';
  if (n.tag === 'input') return checkbox(n) ?? '';
  const inner = n.kids.map(textOf).join('');
  return BLOCK.has(n.tag) ? ` ${inner} ` : inner;
}

const checkbox = (n: El): string | null => (n.tag === 'input' && /^checkbox$/i.test(n.attrs.type ?? '') ? ('checked' in n.attrs ? '☑ ' : '☐ ') : null);

/** A picture Word can show and nothing has to fetch. */
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|bmp);base64,[a-z0-9+/=\s]+$/i;

/** A link worth keeping: the web or mail, and not a placeholder that leads nowhere. */
export function realLink(href: string): boolean {
  const h = String(href ?? '').trim();
  if (!/^(https?:\/\/[^\s/?#]+\.[^\s/?#]+|mailto:[^\s@]+@[^\s@]+)/i.test(h)) return false;
  return !/^https?:\/\/(www\.)?(url|link|example|your-?site|placeholder)(\.[a-z]+)?\/?$/i.test(h) || /^https?:\/\/(www\.)?example\.(com|org|net)\/\S+/i.test(h);
}

/** Inline nodes back to HTML for docx's own reader: links that lead nowhere and pictures it can't show as words. */
function inlineHtml(nodes: Nd[]): string {
  const out: string[] = [];
  const walk = (n: Nd) => {
    if (!isEl(n)) {
      out.push(n);
      return;
    }
    if (DROP.has(n.tag)) return;
    const kids = () => n.kids.forEach(walk);
    switch (n.tag) {
      case 'a':
        if (realLink(n.attrs.href ?? '')) {
          out.push(`<a href="${escAttr(n.attrs.href.trim())}">`);
          kids();
          out.push('</a>');
        } else kids();
        return;
      case 'img':
        if (DATA_IMAGE.test(n.attrs.src ?? '')) out.push(`<img src="${escAttr(n.attrs.src.replace(/\s+/g, ''))}" alt="${escAttr(n.attrs.alt ?? '')}">`);
        else if (n.attrs.alt) out.push(escText(n.attrs.alt));
        return;
      case 'input': {
        const box = checkbox(n);
        if (box) out.push(box);
        return;
      }
      case 'br':
        out.push('<br>');
        return;
      default:
        if (VOID.has(n.tag)) return;
        out.push(`<${n.tag}>`);
        kids();
        out.push(`</${n.tag}>`);
    }
  };
  nodes.forEach(walk);
  return out.join('');
}

/** Whether inline nodes hold anything to print (words, a picture or a tick box). */
const meaningful = (nodes: Nd[]): boolean =>
  nodes.some((n) => (isEl(n) ? n.tag === 'img' || n.tag === 'input' || n.tag === 'br' || meaningful(n.kids) : decodeEntities(n).trim() !== ''));

// ── Blocks into Word ─────────────────────────────────────────────────────────────────────────────────────────────────

type Out = (Paragraph | Table)[];
interface Ctx {
  style?: string;
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  /** Left indent for words inside a list item. */
  indent?: number;
  level: number;
}

const NUMERIC = /^[-+−(]?\s*[$€£¥₹]?\s*[-+−]?\d[\d,.\s'’]*(?:%|k|m|bn|x|pts?)?\)?$/i;
const TOTAL = /^(grand\s+)?(total|totals|sum|net|overall|subtotal)\b/i;

class Writer {
  private instance = 0;
  constructor(
    private readonly p: Palette,
    private readonly html: HtmlOptions,
  ) {}

  runs(nodes: Nd[]): ParagraphChild[] {
    const html = inlineHtml(nodes);
    try {
      return [...htmlToRuns(html, this.html)];
    } catch {
      return [new TextRun(decodeEntities(html.replace(/<[^>]*>/g, '')))];
    }
  }

  para(nodes: Nd[], ctx: Ctx, out: Out) {
    if (!meaningful(nodes)) return;
    out.push(new Paragraph({ style: ctx.style, alignment: ctx.align, indent: ctx.indent ? { left: ctx.indent } : undefined, children: this.runs(nodes) }));
  }

  /** A run of children: inline ones gathered into paragraphs, blocks each in their own way. */
  children(kids: Nd[], ctx: Ctx, out: Out) {
    let group: Nd[] = [];
    const flush = () => {
      this.para(group, ctx, out);
      group = [];
    };
    for (const k of kids) {
      if (isBlock(k)) {
        flush();
        this.block(k as El, ctx, out);
      } else group.push(k);
    }
    flush();
  }

  block(el: El, ctx: Ctx, out: Out) {
    if (DROP.has(el.tag)) return;
    switch (el.tag) {
      case 'h1':
      case 'h2':
        return this.para(el.kids, { ...ctx, style: 'Heading1', align: undefined }, out);
      case 'h3':
        return this.para(el.kids, { ...ctx, style: 'Heading2', align: undefined }, out);
      case 'h4':
      case 'h5':
      case 'h6':
        return this.para(el.kids, { ...ctx, style: 'Heading3', align: undefined }, out);
      case 'p':
        return this.children(el.kids, ctx, out);
      case 'ul':
      case 'ol':
      case 'menu':
      case 'dir':
        return this.list(el, ctx, out);
      case 'table':
        return this.table(el, ctx, out);
      case 'pre':
        return this.pre(el, out);
      case 'hr':
        out.push(new Paragraph({ style: 'Rule', children: [] }));
        return;
      case 'blockquote':
        return this.children(el.kids, { ...ctx, style: 'Quote' }, out);
      case 'aside':
        return this.children(el.kids, { ...ctx, style: this.isCallout(el) ? 'Callout' : 'Quote' }, out);
      case 'figure': {
        this.children(el.kids, { ...ctx, style: 'Figure', align: AlignmentType.CENTER }, out);
        // A drawn picture with no caption of its own: its alt words under it, so they still read.
        const img = el.kids.find((k): k is El => isEl(k) && k.tag === 'img');
        const alt = (img?.attrs.alt ?? '').trim();
        if (img && DATA_IMAGE.test(img.attrs.src ?? '') && alt && !/\.[a-z0-9]{2,5}$/i.test(alt) && !el.kids.some((k) => isEl(k) && k.tag === 'figcaption')) out.push(new Paragraph({ style: 'Caption', children: [new TextRun(alt)] }));
        return;
      }
      case 'figcaption':
      case 'caption':
        return this.para(el.kids, { ...ctx, style: 'Caption' }, out);
      case 'dt':
        return this.para([{ tag: 'b', attrs: {}, kids: el.kids }], ctx, out);
      case 'dd':
        return this.children(el.kids, { ...ctx, indent: (ctx.indent ?? 0) + LIST_STEP }, out);
      case 'li':
        return this.item(el, 'ul', ctx, out);
      default:
        // div, section, details and anything we don't know: their words, in order.
        return this.children(el.kids, ctx, out);
    }
  }

  /** A callout opens with its title in bold ("Keep it simple."); a quote is just words. */
  private isCallout(el: El): boolean {
    if (/\b(callout|tip|warning|info)\b/i.test(el.attrs.class ?? '')) return true;
    const first = el.kids.find((k) => (isEl(k) ? true : decodeEntities(k).trim() !== ''));
    if (!first || !isEl(first)) return false;
    const lead = first.tag === 'p' ? first.kids.find((k) => (isEl(k) ? true : decodeEntities(k).trim() !== '')) : first;
    return !!lead && isEl(lead) && (lead.tag === 'b' || lead.tag === 'strong');
  }

  list(el: El, ctx: Ctx, out: Out) {
    const kind = el.tag === 'ol' ? 'ol' : 'ul';
    const instance = kind === 'ol' ? ++this.instance : 0;
    const loose: Nd[] = [];
    const flushLoose = () => {
      if (loose.length) this.children(loose.splice(0), { ...ctx, style: 'ListContinue', indent: LIST_STEP * (ctx.level + 1) }, out);
    };
    for (const k of el.kids) {
      if (isEl(k) && k.tag === 'li') {
        flushLoose();
        this.item(k, kind, ctx, out, instance);
      } else if (isEl(k) && (k.tag === 'ul' || k.tag === 'ol')) {
        flushLoose();
        this.list(k, { ...ctx, level: ctx.level + 1 }, out);
      } else loose.push(k);
    }
    flushLoose();
  }

  item(li: El, kind: 'ul' | 'ol', ctx: Ctx, out: Out, instance = 0) {
    const level = Math.min(8, ctx.level);
    let first = true;
    let group: Nd[] = [];
    const flush = () => {
      if (!meaningful(group)) {
        group = [];
        return;
      }
      if (first) this.itemPara(group, kind, level, instance, ctx, out);
      else this.para(group, { ...ctx, style: 'ListContinue', indent: LIST_STEP * (level + 1), align: ctx.align }, out);
      first = false;
      group = [];
    };
    for (const k of li.kids) {
      if (!isBlock(k)) {
        group.push(k);
        continue;
      }
      const e = k as El;
      if (e.tag === 'p' && first && !meaningful(group)) {
        group = [...e.kids];
        flush();
        continue;
      }
      flush();
      if (e.tag === 'ul' || e.tag === 'ol') this.list(e, { ...ctx, level: level + 1 }, out);
      else if (e.tag === 'p') this.para(e.kids, { ...ctx, style: 'ListContinue', indent: LIST_STEP * (level + 1) }, out);
      else this.block(e, { ...ctx, indent: LIST_STEP * (level + 1) }, out);
    }
    flush();
  }

  private itemPara(nodes: Nd[], kind: 'ul' | 'ol', level: number, instance: number, ctx: Ctx, out: Out) {
    // A task: its tick box takes the bullet's place.
    const lead = nodes.findIndex((n) => (isEl(n) ? true : decodeEntities(n).trim() !== ''));
    const head = lead >= 0 ? nodes[lead] : null;
    const box = head && !isEl(head) ? /^\s*([☐☑☒])\s*/.exec(decodeEntities(head)) : head && isEl(head) ? (checkbox(head) ? [checkbox(head)!, checkbox(head)!.trim()] : null) : null;
    if (box) {
      const rest = [...nodes];
      if (isEl(head!)) rest.splice(lead, 1);
      else rest[lead] = (head as string).replace(/^\s*(?:[☐☑☒]|&#x?[0-9a-f]+;)\s*/i, '');
      out.push(
        new Paragraph({
          style: 'ListTask',
          alignment: ctx.align,
          indent: { left: LIST_STEP * (level + 1), hanging: 300 },
          tabStops: [{ type: TabStopType.LEFT, position: LIST_STEP * (level + 1) }],
          children: [new TextRun({ text: box[1], font: SYMBOL_FONT, color: box[1] === '☐' ? this.p.muted : this.p.strong }), new TextRun({ text: '\t' }), ...this.runs(rest)],
        }),
      );
      return;
    }
    out.push(
      new Paragraph({
        style: kind === 'ol' ? 'ListNumber' : 'ListBullet',
        alignment: ctx.align,
        numbering: kind === 'ol' ? { reference: 'brand-number', level, instance } : { reference: 'brand-bullet', level },
        children: this.runs(nodes),
      }),
    );
  }

  pre(el: El, out: Out) {
    const text = textOf(el).replace(/^\s/, '').replace(/\s$/, '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\n+$/, '');
    const lines = text.split('\n');
    out.push(new Paragraph({ style: 'CodeBlock', children: lines.map((l, k) => new TextRun({ text: l, break: k ? 1 : undefined })) }));
    // A little air after the shaded box, which carries no space of its own.
    out.push(new Paragraph({ style: 'Normal', spacing: { before: 0, after: 80, line: 120, lineRule: LineRuleType.EXACT }, children: [] }));
  }

  table(el: El, ctx: Ctx, out: Out) {
    interface Row {
      cells: El[];
      head: boolean;
    }
    const rows: Row[] = [];
    const captions: El[] = [];
    const take = (parent: El, section: string) => {
      for (const k of parent.kids) {
        if (!isEl(k)) continue;
        if (k.tag === 'tr') rows.push({ cells: k.kids.filter((c): c is El => isEl(c) && (c.tag === 'td' || c.tag === 'th')), head: section === 'thead' });
        else if (k.tag === 'thead' || k.tag === 'tbody' || k.tag === 'tfoot') take(k, k.tag);
        else if (k.tag === 'caption') captions.push(k);
        else if (k.tag === 'td' || k.tag === 'th') rows.push({ cells: [k], head: false });
      }
    };
    take(el, '');
    const kept = rows.filter((r) => r.cells.length);
    if (!kept.length) return this.children(el.kids.filter((k) => !(isEl(k) && k.tag === 'caption')), ctx, out);
    // With no thead, a first row of only th cells is the header.
    if (!kept.some((r) => r.head) && kept[0].cells.every((c) => c.tag === 'th')) kept[0].head = true;
    const span = (c: El) => Math.max(1, Math.min(20, parseInt(c.attrs.colspan ?? '1', 10) || 1));
    const cols = Math.max(...kept.map((r) => r.cells.reduce((a, c) => a + span(c), 0)));
    const body = kept.filter((r) => !r.head);
    const words = (c: El) => textOf(c).replace(/\s+/g, ' ').trim();
    // Which columns hold numbers (every filled body cell a number), for right alignment.
    const colCells = (k: number) =>
      body.map((r) => {
        let at = 0;
        for (const c of r.cells) {
          if (at === k && span(c) === 1) return c;
          at += span(c);
          if (at > k) return null;
        }
        return null;
      });
    const lastIdx = body.length - 1;
    const totalRow = lastIdx >= 1 && TOTAL.test(words(body[lastIdx].cells[0]));
    const numeric = Array.from({ length: cols }, (_, k) => {
      const filled = colCells(k).filter((c): c is El => !!c && words(c) !== '');
      const checked = totalRow ? filled.filter((c) => c !== body[lastIdx].cells[0]) : filled;
      return checked.length > 0 && checked.every((c) => NUMERIC.test(words(c)));
    });
    // Column widths from how much each holds: numbers narrow, words wider.
    const weight = Array.from({ length: cols }, (_, k) => {
      let most = 0;
      for (const r of kept) {
        let at = 0;
        for (const c of r.cells) {
          if (at === k && span(c) === 1) most = Math.max(most, Math.min(60, words(c).length));
          at += span(c);
        }
      }
      return numeric[k] ? Math.max(5, Math.min(14, most)) + 3 : Math.max(8, Math.min(48, most)) + 4;
    });
    const sum = weight.reduce((a, b) => a + b, 0);
    const widths = weight.map((w) => Math.round((w / sum) * TEXT_W));
    widths[widths.length - 1] += TEXT_W - widths.reduce((a, b) => a + b, 0);
    const light = { style: BorderStyle.SINGLE, size: 4, color: this.p.line };
    const tableRows = kept.map((r, ri) => {
      const isTotal = totalRow && r === body[lastIdx];
      const lastRow = ri === kept.length - 1;
      let at = 0;
      const cells = r.cells.map((c) => {
        const k = at;
        const n = Math.min(span(c), cols - k);
        at += n;
        const w = widths.slice(k, k + n).reduce((a, b) => a + b, 0);
        const style = r.head ? 'TableHeading' : isTotal ? 'TableTotal' : 'TableText';
        const align = numeric[k] && n === 1 ? AlignmentType.RIGHT : undefined;
        const content: Out = [];
        this.children(c.kids, { style, align, level: 0 }, content);
        if (!content.length) content.push(new Paragraph({ style, children: [] }));
        return new TableCell({
          children: content,
          columnSpan: n > 1 ? n : undefined,
          width: { size: w, type: WidthType.DXA },
          verticalAlign: r.head ? VerticalAlignTable.BOTTOM : VerticalAlignTable.TOP,
          shading: r.head ? { type: ShadingType.CLEAR, color: 'auto', fill: this.p.accent } : undefined,
          margins: { top: r.head ? 90 : 80, bottom: r.head ? 90 : 80, left: 120, right: 120 },
          borders: {
            top: isTotal ? { style: BorderStyle.SINGLE, size: 8, color: this.p.ink } : r.head ? none : light,
            bottom: lastRow ? { style: BorderStyle.SINGLE, size: isTotal ? 8 : 6, color: isTotal ? this.p.ink : this.p.line } : r.head ? none : light,
            left: none,
            right: none,
          },
        });
      });
      // A short row is filled out, so the grid stays whole.
      if (at < cols) cells.push(new TableCell({ children: [new Paragraph({ style: 'TableText', children: [] })], columnSpan: cols - at > 1 ? cols - at : undefined, width: { size: widths.slice(at).reduce((a, b) => a + b, 0), type: WidthType.DXA }, borders: { top: r.head ? none : light, bottom: lastRow ? light : r.head ? none : light, left: none, right: none }, shading: r.head ? { type: ShadingType.CLEAR, color: 'auto', fill: this.p.accent } : undefined }));
      return new TableRow({ children: cells, tableHeader: r.head, cantSplit: true });
    });
    out.push(
      new Table({
        style: 'BrandTable',
        rows: tableRows,
        width: { size: TEXT_W, type: WidthType.DXA },
        columnWidths: widths,
        layout: TableLayoutType.FIXED,
        tableLook: { firstRow: kept[0].head, lastRow: totalRow, firstColumn: false, lastColumn: false, noHBand: true, noVBand: true },
        borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
      }),
    );
    for (const cap of captions) this.para(cap.kids, { ...ctx, style: 'Caption' }, out);
    if (!captions.length) out.push(new Paragraph({ style: 'Normal', spacing: { before: 0, after: 120, line: 120, lineRule: LineRuleType.EXACT }, children: [] }));
  }
}

// ── Pictures ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A PNG's size in pixels, from its header; null when it isn't a PNG. */
export function pngSize(buf: Buffer | null | undefined): { w: number; h: number } | null {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return w > 0 && h > 0 && w < 100000 && h < 100000 ? { w, h } : null;
}

function logoRun(logo: Buffer, size: { w: number; h: number }, maxW: number, maxH: number, name: string): ImageRun {
  const scale = Math.min(maxW / size.w, maxH / size.h);
  return new ImageRun({ type: 'png', data: logo, transformation: { width: Math.max(1, Math.round(size.w * scale)), height: Math.max(1, Math.round(size.h * scale)) }, altText: { name: name || 'Logo', description: name ? `${name} logo` : 'Logo', title: name || 'Logo' } });
}

/** Fonts the kit names may not be on the reader's computer: the font table says what kind each is (and a safe
 *  alternative), so Word and LibreOffice put a like font in its place, never a serif for a sans. */
const SERIF_NAME = /serif|garamond|georgia|times|merriweather|playfair|lora|baskerville|caslon|bodoni|cambria|caladea|didot|minion|charter|slab|roman|book/i;
const MONO_NAME = /mono|code|consol|courier/i;
export function fontTableXml(names: string[]): string {
  const seen = new Set<string>();
  const fonts = names
    .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
    .map((n) => {
      const sans = !/sans/i.test(n) && SERIF_NAME.test(n) ? false : true;
      const mono = MONO_NAME.test(n);
      const family = mono ? 'modern' : sans ? 'swiss' : 'roman';
      const alt = mono ? 'Courier New' : sans ? 'Calibri' : 'Cambria';
      return `<w:font w:name="${escAttr(n)}">${alt.toLowerCase() === n.toLowerCase() ? '' : `<w:altName w:val="${alt}"/>`}<w:charset w:val="00"/><w:family w:val="${family}"/><w:pitch w:val="${mono ? 'fixed' : 'variable'}"/></w:font>`;
    });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${fonts.join('')}</w:fonts>`;
}

// ── The document ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The kinds that open on a cover page of their own; the rest start the words under the title on page one. */
const COVER_PAGE = /report|proposal/i;

export async function designDocx(input: DesignExportInput): Promise<Buffer> {
  const { content, theme } = input;
  const p = paletteOf(theme);
  const f = fontsOf(theme);
  const brandName = String(input.brandName ?? '').trim();
  const kindName = String(input.kindName ?? '').trim() || 'Document';
  const title = String(content.title ?? '').trim() || 'Untitled';
  const logoSize = pngSize(input.logo ?? null);
  const logo = logoSize ? input.logo! : null;
  const ownCover = COVER_PAGE.test(kindName);
  const html: HtmlOptions = { maxImageWidth: TEXT_PX, styleMap: { a: 'Hyperlink', code: 'InlineCode' }, stylesheet: `code{font-family:${f.mono}}mark{background-color:#${p.tint2}}` };
  const w = new Writer(p, html);

  // The footer's words: the kit's footer, else the brand and the title; confidential always said.
  let footWords = String(content.foot ?? '').trim() || [brandName, title].filter(Boolean).join(' · ');
  if (content.confidential && !/confidential/i.test(footWords)) footWords = footWords ? `Confidential · ${footWords}` : 'Confidential';
  const confidentialNote = /confidential/i.test(String(content.foot ?? '')) ? String(content.foot).trim() : 'Confidential, internal use';

  // ── The cover
  const cover: Out = [];
  if (logo) cover.push(new Paragraph({ spacing: { before: 0, after: ownCover ? 0 : 360 }, children: [logoRun(logo, logoSize!, 220, ownCover ? 70 : 52, brandName)] }));
  else if (brandName) cover.push(new Paragraph({ spacing: { before: 0, after: ownCover ? 0 : 360 }, children: [new TextRun({ text: brandName, font: f.head, bold: true, size: pt(ownCover ? 16 : 13), color: p.strong })] }));
  const kicker = String(content.label ?? '').trim() || kindName;
  // The title block sits low on a cover page: how far down depends on how much it holds, so it never spills over.
  const figures = (content.figures ?? []).filter((x) => String(x.value ?? '').trim() || String(x.label ?? '').trim()).slice(0, 6);
  const people = (content.people ?? []).filter((r) => r.names?.length);
  const titleLines = Math.max(1, Math.ceil(title.length / 22));
  const drop = 100 - (titleLines - 1) * 17 - (content.sub ?? []).length * 7 - (figures.length > 4 ? 26 : 0) - people.length * 7 - (people.length ? 8 : 0);
  // A short bar of the brand colour over the label: the one strong mark on the cover.
  cover.push(new Paragraph({ spacing: { before: ownCover ? Math.round(Math.max(24, drop) * MM) : 0, after: 200, line: 60, lineRule: LineRuleType.EXACT }, indent: { right: TEXT_W - Math.round(16 * MM) }, border: { top: { style: BorderStyle.SINGLE, size: 36, color: p.accent, space: 1 } }, children: [] }));
  cover.push(new Paragraph({ style: 'Kicker', children: [new TextRun(kicker)] }));
  cover.push(new Paragraph({ style: 'Title', children: [new TextRun({ text: title, size: pt(ownCover ? 40 : 30) })] }));
  for (const s of content.sub ?? []) if (String(s).trim()) cover.push(new Paragraph({ style: 'Subtitle', children: [new TextRun(String(s))] }));
  if (figures.length) {
    const per = figures.length <= 4 ? figures.length : 3;
    const colW = Math.floor(TEXT_W / per);
    // Big numbers, as big as the longest still fits its column on one line.
    const longest = Math.max(...figures.map((x) => String(x.value ?? '').length), 1);
    const valueSize = Math.max(14, Math.min(26, Math.floor((colW / MM - 8) / (longest * 0.62 * 0.3528))));
    const rows: TableRow[] = [];
    for (let k = 0; k < figures.length; k += per) {
      const row = figures.slice(k, k + per);
      const cells = row.map(
        (fig, i) =>
          new TableCell({
            width: { size: colW, type: WidthType.DXA },
            margins: { top: 140, bottom: 60, left: i === 0 ? 0 : 220, right: 180 },
            borders: { top: { style: BorderStyle.SINGLE, size: 6, color: p.line }, bottom: none, left: i === 0 ? none : { style: BorderStyle.SINGLE, size: 4, color: p.line }, right: none },
            children: [new Paragraph({ style: 'FigureValue', children: [new TextRun({ text: String(fig.value ?? ''), size: pt(valueSize) })] }), new Paragraph({ style: 'FigureLabel', children: [new TextRun(String(fig.label ?? ''))] })],
          }),
      );
      while (cells.length < per) cells.push(new TableCell({ width: { size: colW, type: WidthType.DXA }, borders: { top: { style: BorderStyle.SINGLE, size: 6, color: p.line }, bottom: none, left: none, right: none }, children: [new Paragraph({ children: [] })] }));
      rows.push(new TableRow({ children: cells, cantSplit: true }));
    }
    cover.push(new Paragraph({ spacing: { before: 0, after: ownCover ? 520 : 300, line: 60, lineRule: LineRuleType.EXACT }, children: [] }));
    cover.push(new Table({ rows, width: { size: colW * per, type: WidthType.DXA }, columnWidths: Array(per).fill(colW), layout: TableLayoutType.FIXED, borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none } }));
  }
  if (people.length) {
    cover.push(new Paragraph({ spacing: { before: 0, after: 260, line: 60, lineRule: LineRuleType.EXACT }, children: [] }));
    for (const r of people) cover.push(new Paragraph({ style: 'MetaRow', tabStops: [{ type: TabStopType.LEFT, position: 1500 }], children: [new TextRun({ text: r.label, bold: true, color: p.muted }), new TextRun('\t'), new TextRun(r.names.join(', '))] }));
  }
  if (content.confidential) cover.push(new Paragraph({ style: 'Note', spacing: { before: 280 }, children: [new TextRun({ text: confidentialNote, bold: true, color: p.strong })] }));
  if (!ownCover) cover.push(new Paragraph({ style: 'Rule', spacing: { before: 200, after: 120 }, children: [] }));

  // ── The words
  const body: Out = [];
  for (const block of content.blocks ?? []) {
    const mark = body.length;
    try {
      w.children(parseHtml(block).kids, { level: 0 }, body);
    } catch {
      // Whatever went wrong, the block's words still print.
      body.length = mark;
      const words = textOf(parseHtml(block)).replace(/\s+/g, ' ').trim();
      if (words) body.push(new Paragraph({ children: [new TextRun(words)] }));
    }
  }
  // An empty note still makes a whole document.
  if (!body.length) body.push(new Paragraph({ children: [] }));

  // ── Headers and footers
  const headLeft: ParagraphChild[] = logo ? [logoRun(logo, logoSize!, 120, 20, brandName)] : brandName ? [new TextRun({ text: brandName, bold: true, color: p.strong })] : [];
  const header = new Header({
    children: [new Paragraph({ style: 'Header', tabStops: RIGHT_TAB, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: p.line, space: 6 } }, children: headLeft.length ? [...headLeft, new TextRun('\t'), new TextRun(title)] : [new TextRun(title)] })],
  });
  const pageNo = [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES] })];
  const footer = new Footer({ children: [new Paragraph({ style: 'Footer', tabStops: RIGHT_TAB, children: [new TextRun(footWords), new TextRun('\t'), ...pageNo] })] });
  const empty = () => new Header({ children: [new Paragraph({ style: 'Header', children: [] })] });
  // The cover's foot: the brand on the left, what the document is on the right.
  const coverFooter = new Footer({ children: [new Paragraph({ style: 'Footer', tabStops: RIGHT_TAB, children: [new TextRun({ text: brandName, bold: true, color: p.strong }), new TextRun('\t'), new TextRun(kindName)] })] });

  const page = {
    size: { width: PAGE_W, height: PAGE_H },
    margin: { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_X, right: MARGIN_X, header: Math.round(11 * MM), footer: Math.round(10 * MM) },
  };
  const sections = ownCover
    ? [
        { properties: { page }, headers: { default: empty() }, footers: { default: coverFooter }, children: cover },
        { properties: { page }, headers: { default: header }, footers: { default: footer }, children: body },
      ]
    : [{ properties: { page, titlePage: true }, headers: { default: header, first: empty() }, footers: { default: footer, first: footer }, children: [...cover, ...body] }];

  const doc = new Document({
    title,
    subject: kindName,
    creator: brandName || 'Design studio',
    lastModifiedBy: brandName || 'Design studio',
    description: [kindName, brandName].filter(Boolean).join(' · '),
    theme: { name: brandName || 'Brand', colors: { accent1: p.accent, hyperlink: p.strong }, fonts: { headings: f.head, body: f.body } },
    styles: {
      default: { document: { run: { font: f.body, size: pt(10.5), color: p.ink }, paragraph: { spacing: { after: 150, line: line(1.22) } } } },
      paragraphStyles: paragraphStyles(p, f),
      characterStyles: characterStyles(p, f),
      importedStyles: [ImportedXmlComponent.fromXmlString(tableStyleXml(p, f))],
    },
    numbering: numberingConfig(p),
    sections,
  });
  return Packer.toBuffer(doc, false, [{ path: 'word/fontTable.xml', data: fontTableXml([f.head, f.body, f.mono, SYMBOL_FONT]) }]);
}
