// SPDX-License-Identifier: AGPL-3.0-or-later
// New Word, Excel and PowerPoint files from what the chat's assistant writes (24 Nov 2026): the assistant could change
// an Office file in a project's folder (office-edit.ts) but couldn't make one. Here a file is made straight from
// structured words, fast, with no model call and nothing fetched:
//   Word: Markdown, read by markdown-it, as real Word styles (Heading 1 to 6, so the navigation pane and a table of
//     contents work), real lists (numbering definitions, nested by indentation), links, tables with a repeating header
//     row, quotes, code, tick boxes and page breaks.
//   Excel: rows of cells, with real formulas, real dates and numbers in their formats; the header row bold, filled,
//     frozen and filtered; columns as wide as what they hold; sheet names Excel accepts.
//   PowerPoint: a slide outline as a calm 16:9 deck on its own slide masters: a title slide, section dividers, bullet
//     and two-column slides with real paragraph levels, quotes, and speaker notes as real notes pages. Words that
//     wouldn't fit get smaller (as far as still reads) and then go on to a second slide; nothing is cut off.
// All three take the same small brand (fonts and two colours), written into the file's theme as well as its styles.
//
// The files are written by the libraries the Design studio already uses (docx, ExcelJS, pptxgenjs; see
// design-export/); every word handed in is the person's words, never markup: the libraries escape it, and characters
// XML can't carry are taken out first. Nothing here decides where a file goes: src/main/agent.ts does.

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
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
  type IParagraphOptions,
  type IParagraphStyleOptions,
  type ParagraphChild,
} from 'docx';
import ExcelJS from 'exceljs/dist/exceljs.min.js';
import type { Borders, Cell, Fill, Font } from 'exceljs';
import JSZip from 'jszip';
import createMarkdownIt, { type Token } from 'markdown-it';
import PptxGenJS from 'pptxgenjs';
import { firstFamily, fontTableXml } from './design-export/docx';
import { TOTAL_ROW, readValue, sheetName } from './design-export/xlsx';
import { frontMatterRange } from '../shared/frontmatter';
import { parseWikilink } from '../shared/markdown';

// ── The brand ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Fonts and colours for a made file. Colours are hex (#2f6690 or 2f6690); anything unreadable is left at the default. */
export interface Brand {
  /** The body font. */
  font?: string;
  /** The headings' font (the body font when not given). */
  headingFont?: string;
  /** The one strong colour: headings, rules, bullets, the header row's fill (lightened). */
  accent?: string;
  /** The dark colour: words, the title slide's ground. */
  dark?: string;
}

interface Look {
  body: string;
  head: string;
  mono: string;
  /** The accent as given. */
  accent: string;
  /** The accent dark enough for words on white. */
  strong: string;
  /** The accent light enough to show on the dark ground. */
  onDark: string;
  dark: string;
  muted: string;
  line: string;
  soft: string;
  tint: string;
}

const DEFAULT_ACCENT = '2F6690';
const DEFAULT_DARK = '1F2A37';
const DEFAULT_FONT = 'Calibri';

const HEX_DIGITS = '0123456789ABCDEF';
const hex2 = (n: number) => {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return HEX_DIGITS[v >> 4] + HEX_DIGITS[v & 15];
};
const rgbOf = (h: string): [number, number, number] => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const hexOfRgb = (c: number[]) => c.map(hex2).join('');

/** A colour as six capital hex digits, or the fallback. */
export function hexColour(v: unknown, fallback: string): string {
  let h = String(v ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/i.test(h) ? hexOfRgb(rgbOf(h)) : fallback;
}

/** `a` moved toward `b` by t (0 to 1). */
const mix = (a: string, b: string, t: number) => {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return hexOfRgb(x.map((v, i) => v + (y[i] - v) * t));
};
const luminance = (h: string) => {
  const [r, g, b] = rgbOf(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** `c` moved toward `to` until it stands out from `ground` by at least `ratio`. */
function readable(c: string, ground: string, ratio: number, to: string): string {
  for (let t = 0; t <= 1; t += 0.05) {
    const m = mix(c, to, t);
    if (contrast(m, ground) >= ratio) return m;
  }
  return to;
}

/** A font name a file can carry: the first family of whatever was given, letters, digits and spaces only. */
function fontName(v: unknown, fallback: string): string {
  const name = firstFamily(clean(String(v ?? '')));
  return name && /^[\p{L}\p{N} ._-]{1,60}$/u.test(name) ? name : fallback;
}

function lookOf(brand: Brand | undefined): Look {
  const accent = hexColour(brand?.accent, DEFAULT_ACCENT);
  const dark = readable(hexColour(brand?.dark, DEFAULT_DARK), 'FFFFFF', 10, '000000');
  const body = fontName(brand?.font, DEFAULT_FONT);
  return {
    body,
    head: fontName(brand?.headingFont, body),
    mono: 'Consolas',
    accent,
    strong: readable(accent, 'FFFFFF', 4.5, dark),
    onDark: readable(accent, dark, 3, 'FFFFFF'),
    dark,
    muted: mix(dark, 'FFFFFF', 0.38),
    line: mix(dark, 'FFFFFF', 0.82),
    soft: mix(dark, 'FFFFFF', 0.95),
    tint: mix(accent, 'FFFFFF', 0.86),
  };
}

/** The brand in a made file's theme too (Excel's and PowerPoint's libraries write Office's): its dark and accent
 *  colours, its link colour and its two fonts, so the program's own colour and font menus offer them. */
function themed(xml: string, look: Look): string {
  const colour = (name: string, hex: string) => {
    xml = xml.replace(new RegExp(`<a:${name}>[\\s\\S]*?</a:${name}>`), `<a:${name}><a:srgbClr val="${hex}"/></a:${name}>`);
  };
  colour('dk2', look.dark);
  colour('accent1', look.accent);
  colour('hlink', look.strong);
  const font = (which: string, name: string) => {
    xml = xml.replace(new RegExp(`(<a:${which}>\\s*<a:latin typeface=")[^"]*"`), `$1${attrText(name)}"`);
  };
  font('majorFont', look.head);
  font('minorFont', look.body);
  return xml;
}

/** The made file again with some of its XML parts changed (`change` gives null to leave a part as it is). */
async function changeParts(file: Buffer, change: (name: string, xml: string) => string | null): Promise<Buffer> {
  const zip = await JSZip.loadAsync(file);
  let changed = false;
  for (const name of Object.keys(zip.files).filter((n) => n.endsWith('.xml') && !zip.files[n].dir)) {
    const xml = await zip.file(name)!.async('string');
    const next = change(name, xml);
    if (next !== null && next !== xml) {
      zip.file(name, next);
      changed = true;
    }
  }
  return changed ? Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })) : file;
}

/** A paragraph's properties come once, first: pptxgenjs writes them again before every run of a paragraph with more
 *  than one (bold words in a point), which PowerPoint calls a damaged file. Bullets take the accent colour. */
export function tidySlideXml(xml: string, bulletColour: string): string {
  const pPr = /<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g;
  return xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (_, inner: string) => {
    const lead = /^\s*<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/.exec(inner)?.[0] ?? '';
    const head = lead.replace(/<a:buSzPct val="100000"\/><a:buChar /, `<a:buClr><a:srgbClr val="${bulletColour}"/></a:buClr><a:buSzPct val="100000"/><a:buChar `);
    return `<a:p>${head}${inner.slice(lead.length).replace(pPr, '')}</a:p>`;
  });
}

// ── Words ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Words a file can carry: characters XML 1.0 can't (control characters, lone surrogates, U+FFFE and U+FFFF) taken
 *  out; tabs and new lines kept. */
export function clean(s: unknown): string {
  return String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
}

const attrText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A link worth making a link: the web or an email address, nothing that runs or opens a file. */
const linkable = (href: string) => /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+@[^\s<>"]+)$/i.test(href);

const md = createMarkdownIt({ html: false, linkify: true, typographer: false });

/** [[Note]] and [[Note|shown words]] read as their words: the note they point at isn't in the file. */
const wikiWords = (s: string) =>
  s.replace(/\[\[([^\[\]\n]+)\]\]/g, (_, inner: string) => {
    const w = parseWikilink(inner);
    return w.alias ?? ([w.target, w.heading].filter(Boolean).join(' › ') || inner);
  });

interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
  /** A line break before these words. */
  br?: boolean;
}

/** Markdown's inline words (bold, italics, code, links, strikethrough) as spans. */
function spansOf(children: Token[] | null): Span[] {
  const out: Span[] = [];
  let bold = 0, italic = 0, strike = 0;
  let href: string | undefined;
  let br = false;
  const push = (text: string, more: Partial<Span> = {}) => {
    if (!text && !br) return;
    out.push({ text, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}), ...(strike ? { strike: true } : {}), ...(href ? { href } : {}), ...(br ? { br: true } : {}), ...more });
    br = false;
  };
  for (const c of children ?? []) {
    switch (c.type) {
      case 'text':
        push(wikiWords(c.content));
        break;
      case 'code_inline':
        push(c.content, { code: true });
        break;
      case 'strong_open':
        bold++;
        break;
      case 'strong_close':
        bold = Math.max(0, bold - 1);
        break;
      case 'em_open':
        italic++;
        break;
      case 'em_close':
        italic = Math.max(0, italic - 1);
        break;
      case 's_open':
        strike++;
        break;
      case 's_close':
        strike = Math.max(0, strike - 1);
        break;
      case 'link_open': {
        const h = String(c.attrGet('href') ?? '');
        href = linkable(h) ? h : undefined;
        break;
      }
      case 'link_close':
        href = undefined;
        break;
      case 'image':
        // A picture isn't fetched: its words stand in for it.
        push(c.content || c.children?.map((k) => k.content).join('') || '', { italic: true });
        break;
      case 'softbreak':
        push(' ');
        break;
      case 'hardbreak':
        br = true;
        break;
      default:
        if (c.content) push(c.content);
    }
  }
  return out;
}

const inlineSpans = (text: string): Span[] => spansOf(md.parseInline(clean(text), {})[0]?.children ?? null);
const plain = (spans: Span[]) => spans.map((s) => (s.br ? '\n' : '') + s.text).join('');

// ── Word ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const MM = 56.6929; // twips in a millimetre
const PAGE_W = 11906; // A4 portrait, in twips
const PAGE_H = 16838;
const MARGIN_X = Math.round(22 * MM);
const TEXT_W = PAGE_W - 2 * MARGIN_X;
const LIST_STEP = 360;
/** Tick boxes in a font that has them (Word falls back to one on its own; naming it keeps other readers off emoji). */
const SYMBOL_FONT = 'Segoe UI Symbol';
const pt = (n: number) => Math.round(n * 2); // half-points
const lines = (n: number) => Math.round(n * 240);
const none = { style: BorderStyle.NONE, size: 0, color: 'auto' } as const;
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

function wordStyles(l: Look): IParagraphStyleOptions[] {
  const head = (size: number, color: string, more: { italics?: boolean; bold?: boolean } = {}) => ({ font: l.head, size: pt(size), color, bold: more.bold ?? true, italics: more.italics });
  const heading = (n: number, size: number, color: string, before: number, after: number, more: { italics?: boolean; bold?: boolean } = {}): IParagraphStyleOptions => ({
    id: `Heading${n}`,
    name: `Heading ${n}`,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: head(size, color, more),
    paragraph: { spacing: { before, after, line: lines(1.1) }, keepNext: true, keepLines: true, outlineLevel: n - 1 },
  });
  return [
    { id: 'Normal', name: 'Normal', quickFormat: true, run: { font: l.body, size: pt(11), color: l.dark }, paragraph: { spacing: { before: 0, after: 160, line: lines(1.2), lineRule: LineRuleType.AUTO } } },
    {
      id: 'Title',
      name: 'Title',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: l.head, size: pt(28), bold: true, color: l.dark },
      paragraph: { spacing: { before: 0, after: 320, line: lines(1.05) }, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: l.accent, space: 10 } } },
    },
    heading(1, 20, l.dark, 440, 140),
    heading(2, 15, l.strong, 320, 100),
    heading(3, 12.5, l.dark, 260, 80),
    heading(4, 11, l.dark, 220, 60),
    heading(5, 11, l.muted, 200, 60),
    heading(6, 10.5, l.muted, 200, 60, { bold: false, italics: true }),
    {
      id: 'Quote',
      name: 'Quote',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { italics: true, color: l.muted },
      paragraph: { spacing: { before: 120, after: 120 }, contextualSpacing: true, indent: { left: 360, right: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: l.accent, space: 12 } } },
    },
    {
      id: 'CodeBlock',
      name: 'Code block',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: l.mono, size: pt(9.5), color: l.dark },
      paragraph: {
        spacing: { before: 0, after: 0, line: lines(1.1) },
        indent: { left: 160, right: 160 },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: l.soft },
        border: {
          top: { style: BorderStyle.SINGLE, size: 4, color: l.soft, space: 6 },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: l.soft, space: 6 },
          left: { style: BorderStyle.SINGLE, size: 4, color: l.soft, space: 8 },
          right: { style: BorderStyle.SINGLE, size: 4, color: l.soft, space: 8 },
        },
      },
    },
    { id: 'ListParagraph', name: 'List Paragraph', basedOn: 'Normal', quickFormat: true, run: {}, paragraph: { spacing: { after: 80 }, contextualSpacing: true } },
    { id: 'ListContinue', name: 'List Continue', basedOn: 'Normal', run: {}, paragraph: { spacing: { after: 80 } } },
    { id: 'TableText', name: 'Table text', basedOn: 'Normal', run: { size: pt(10) }, paragraph: { spacing: { before: 0, after: 0, line: lines(1.1) } } },
    { id: 'TableHeading', name: 'Table heading', basedOn: 'TableText', run: { font: l.head, bold: true, color: l.dark }, paragraph: { keepNext: true } },
    { id: 'Footer', name: 'footer', basedOn: 'Normal', run: { size: pt(8.5), color: l.muted }, paragraph: { spacing: { before: 0, after: 0 } } },
  ];
}

function wordNumbering(l: Look, starts: Map<number, string>) {
  const bullets = ['•', '–', '▪', '•', '–', '▪', '•', '–', '▪'];
  const formats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
  const indent = (level: number) => ({ left: LIST_STEP * (level + 1), hanging: 300 });
  const bulletLevels: ILevelsOptions[] = bullets.map((text, level) => ({ level, format: LevelFormat.BULLET, text, alignment: AlignmentType.LEFT, style: { paragraph: { indent: indent(level) }, run: { color: l.strong } } }));
  const numberLevels = (start: number): ILevelsOptions[] =>
    bullets.map((_, level) => ({ level, format: formats[level % 3], text: `%${level + 1}.`, start: level === 0 ? start : 1, alignment: AlignmentType.LEFT, style: { paragraph: { indent: indent(level) }, run: { color: l.strong } } }));
  return { config: [{ reference: 'make-bullet', levels: bulletLevels }, ...[...starts].map(([start, reference]) => ({ reference, levels: numberLevels(start) }))] };
}

interface ListFrame {
  ordered: boolean;
  reference: string;
  instance: number;
  /** Paragraphs so far in the open item: the first carries the bullet, the rest sit under it. */
  paras: number;
}

class WordWriter {
  readonly out: (Paragraph | Table)[] = [];
  /** Number lists by where they start ("3." starts at 3), each its own numbering definition. */
  readonly starts = new Map<number, string>([[1, 'make-number']]);
  private breakNext = false;
  private instance = 0;
  private lists: ListFrame[] = [];
  private quote = 0;

  constructor(private readonly l: Look) {}

  runs(spans: Span[], base: { bold?: boolean } = {}): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    let link: { href: string; runs: TextRun[] } | null = null;
    const flush = () => {
      if (link) out.push(new ExternalHyperlink({ link: link.href, children: link.runs }));
      link = null;
    };
    for (const s of spans) {
      const run = new TextRun({
        text: s.text,
        break: s.br ? 1 : undefined,
        bold: s.bold || base.bold || undefined,
        italics: s.italic || undefined,
        strike: s.strike || undefined,
        style: s.code ? 'InlineCode' : s.href ? 'Hyperlink' : undefined,
      });
      if (s.href) {
        if (link && link.href !== s.href) flush();
        link ??= { href: s.href, runs: [] };
        link.runs.push(run);
      } else {
        flush();
        out.push(run);
      }
    }
    flush();
    return out;
  }

  private add(o: IParagraphOptions) {
    // A page break (---) goes on the paragraph after it, so the new page starts with words, not an empty line.
    this.out.push(new Paragraph(this.breakNext ? { ...o, pageBreakBefore: true } : o));
    this.breakNext = false;
  }

  private breakBeforeTable() {
    if (!this.breakNext) return;
    this.out.push(new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, pageBreakBefore: true, children: [] }));
    this.breakNext = false;
  }

  title(text: string) {
    this.add({ style: 'Title', children: this.runs(inlineSpans(text)) });
  }

  write(tokens: Token[]) {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      switch (t.type) {
        case 'heading_open': {
          const level = Math.min(6, Math.max(1, Number(t.tag.slice(1)) || 1));
          this.add({ heading: HEADINGS[level - 1], children: this.runs(spansOf(tokens[i + 1]?.children ?? null)) });
          i += 2;
          break;
        }
        case 'paragraph_open':
          this.paragraph(tokens[i + 1]?.children ?? null);
          i += 2;
          break;
        case 'bullet_list_open':
        case 'ordered_list_open': {
          const ordered = t.type === 'ordered_list_open';
          const start = Math.max(0, Math.min(32767, Number(t.attrGet('start') ?? 1) || 1));
          if (ordered && !this.starts.has(start)) this.starts.set(start, `make-number-${start}`);
          this.lists.push({ ordered, reference: ordered ? this.starts.get(start)! : 'make-bullet', instance: ordered ? ++this.instance : 0, paras: 0 });
          break;
        }
        case 'bullet_list_close':
        case 'ordered_list_close':
          this.lists.pop();
          break;
        case 'list_item_open': {
          const top = this.lists[this.lists.length - 1];
          if (top) top.paras = 0;
          break;
        }
        case 'blockquote_open':
          this.quote++;
          break;
        case 'blockquote_close':
          this.quote = Math.max(0, this.quote - 1);
          break;
        case 'fence':
        case 'code_block':
          this.code(t.content);
          break;
        case 'hr':
          if (this.out.length) this.breakNext = true;
          break;
        case 'table_open': {
          let end = i + 1;
          while (end < tokens.length && tokens[end].type !== 'table_close') end++;
          this.table(tokens.slice(i + 1, end));
          i = end;
          break;
        }
        default:
          break;
      }
    }
  }

  private paragraph(children: Token[] | null) {
    let spans = spansOf(children);
    const level = Math.min(8, this.lists.length - 1);
    const top = this.lists[this.lists.length - 1];
    const style = this.quote ? 'Quote' : undefined;
    // A callout (> [!note] Title): its kind or title in bold, as its first words.
    if (this.quote && spans[0] && !spans[0].code) {
      const m = /^\[!([a-z][\w-]*)\][+-]?[ \t]*/i.exec(spans[0].text);
      if (m) {
        const rest = spans[0].text.slice(m[0].length);
        const titleEnd = rest.indexOf('\n');
        const own = (titleEnd < 0 ? rest : rest.slice(0, titleEnd)).trim();
        const label = own || CALLOUT_WORDS[m[1].toLowerCase()] || m[1];
        const after = spans.slice(1);
        // The line break after the title reads as a space in Markdown: here it is the new line.
        if (titleEnd < 0 && after[0]?.text === ' ') after.shift();
        const body = [{ ...spans[0], text: titleEnd < 0 ? '' : rest.slice(titleEnd + 1) }, ...after].filter((s) => s.text || s.br);
        spans = [{ text: label, bold: true }, ...(body.length ? [{ text: '', br: true }, ...body] : [])];
      }
    }
    if (!top) {
      if (!plain(spans).trim()) return;
      this.add({ style, children: this.runs(spans) });
      return;
    }
    const first = top.paras++ === 0;
    if (!first) {
      this.add({ style: style ?? 'ListContinue', indent: { left: LIST_STEP * (level + 1) }, children: this.runs(spans) });
      return;
    }
    // A task (- [ ] or - [x]): its tick box in the bullet's place.
    const box = spans[0] && !spans[0].code ? /^\[([ xX])\][ \t]+/.exec(spans[0].text) : null;
    if (box && !top.ordered) {
      const done = box[1] !== ' ';
      const rest = [{ ...spans[0], text: spans[0].text.slice(box[0].length) }, ...spans.slice(1)];
      this.add({
        style: style ?? 'ListParagraph',
        indent: { left: LIST_STEP * (level + 1), hanging: 300 },
        tabStops: [{ type: TabStopType.LEFT, position: LIST_STEP * (level + 1) }],
        children: [new TextRun({ text: done ? '☒' : '☐', font: SYMBOL_FONT, color: done ? this.l.strong : this.l.muted }), new TextRun({ text: '\t' }), ...this.runs(rest)],
      });
      return;
    }
    this.add({
      style: style ?? 'ListParagraph',
      numbering: top.ordered ? { reference: top.reference, level, instance: top.instance } : { reference: 'make-bullet', level },
      children: this.runs(spans),
    });
  }

  private code(text: string) {
    const rows = clean(text).replace(/\t/g, '    ').replace(/\n+$/, '').split('\n');
    this.add({ style: 'CodeBlock', children: rows.map((r, k) => new TextRun({ text: r, break: k ? 1 : undefined })) });
    // A little air after the shaded box, which carries no space of its own.
    this.out.push(new Paragraph({ spacing: { before: 0, after: 100, line: 120, lineRule: LineRuleType.EXACT }, children: [] }));
  }

  private table(tokens: Token[]) {
    interface TableCellIn {
      spans: Span[];
      align: 'left' | 'center' | 'right' | '';
    }
    const rows: { head: boolean; cells: TableCellIn[] }[] = [];
    let inHead = false;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'thead_open') inHead = true;
      else if (t.type === 'thead_close') inHead = false;
      else if (t.type === 'tr_open') rows.push({ head: inHead, cells: [] });
      else if (t.type === 'th_open' || t.type === 'td_open') {
        const align = /text-align:(left|center|right)/.exec(String(t.attrGet('style') ?? ''))?.[1] ?? '';
        const inline = tokens[i + 1]?.type === 'inline' ? tokens[i + 1] : null;
        rows[rows.length - 1]?.cells.push({ spans: spansOf(inline?.children ?? null), align: align as TableCellIn['align'] });
      }
    }
    const kept = rows.filter((r) => r.cells.length);
    if (!kept.length) return;
    const cols = Math.max(...kept.map((r) => r.cells.length));
    const body = kept.filter((r) => !r.head);
    const words = (c: TableCellIn | undefined) => (c ? plain(c.spans).replace(/\s+/g, ' ').trim() : '');
    const last = body[body.length - 1];
    const totalRow = body.length >= 2 && TOTAL_ROW.test(words(last.cells[0]));
    // Columns of numbers read right-aligned (the Markdown's own alignment wins).
    const numeric = Array.from({ length: cols }, (_, k) => {
      const filled = body.filter((r) => !(totalRow && r === last && k === 0)).map((r) => words(r.cells[k])).filter(Boolean);
      return filled.length > 0 && filled.every((w) => readValue(w) !== null);
    });
    // Widths from how much each column holds: numbers narrow, words wider.
    const weight = Array.from({ length: cols }, (_, k) => {
      const most = Math.max(0, ...kept.map((r) => Math.min(60, words(r.cells[k]).length)));
      return numeric[k] ? Math.max(6, Math.min(14, most)) + 3 : Math.max(8, Math.min(48, most)) + 4;
    });
    const sum = weight.reduce((a, b) => a + b, 0);
    const widths = weight.map((w) => Math.round((w / sum) * TEXT_W));
    widths[widths.length - 1] += TEXT_W - widths.reduce((a, b) => a + b, 0);
    const light = { style: BorderStyle.SINGLE, size: 4, color: this.l.line };
    const ruled = { style: BorderStyle.SINGLE, size: 8, color: this.l.accent };
    const tableRows = kept.map((r) => {
      const isTotal = totalRow && r === last;
      const cells = Array.from({ length: cols }, (_, k) => {
        const c = r.cells[k];
        const align = c?.align || (numeric[k] ? 'right' : '');
        return new TableCell({
          width: { size: widths[k], type: WidthType.DXA },
          verticalAlign: r.head ? VerticalAlignTable.BOTTOM : VerticalAlignTable.TOP,
          shading: r.head ? { type: ShadingType.CLEAR, color: 'auto', fill: this.l.tint } : undefined,
          margins: { top: 70, bottom: 70, left: 110, right: 110 },
          borders: {
            top: isTotal ? { style: BorderStyle.SINGLE, size: 8, color: this.l.dark } : r.head ? none : light,
            bottom: r.head ? ruled : light,
            left: none,
            right: none,
          },
          children: [
            new Paragraph({
              style: r.head ? 'TableHeading' : 'TableText',
              alignment: align === 'right' ? AlignmentType.RIGHT : align === 'center' ? AlignmentType.CENTER : undefined,
              children: this.runs(c?.spans ?? [], { bold: isTotal }),
            }),
          ],
        });
      });
      return new TableRow({ children: cells, tableHeader: r.head, cantSplit: true });
    });
    this.breakBeforeTable();
    this.out.push(
      new Table({
        rows: tableRows,
        width: { size: TEXT_W, type: WidthType.DXA },
        columnWidths: widths,
        layout: TableLayoutType.FIXED,
        borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
      }),
    );
    // Room under the table, and a paragraph between two tables so Word doesn't join them.
    this.out.push(new Paragraph({ spacing: { before: 0, after: 160, line: 120, lineRule: LineRuleType.EXACT }, children: [] }));
  }
}

const CALLOUT_WORDS: Record<string, string> = {
  note: 'Note',
  info: 'Info',
  tip: 'Tip',
  hint: 'Hint',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
  danger: 'Danger',
  example: 'Example',
  quote: 'Quote',
  summary: 'Summary',
  todo: 'To do',
  question: 'Question',
  success: 'Done',
  abstract: 'Summary',
};

/** A `---` line is a page break, even right under a paragraph (where Markdown would make the paragraph a heading). */
function breaksApart(text: string): string {
  const rows = text.split('\n');
  const out: string[] = [];
  let fence: string | null = null;
  for (const row of rows) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(row);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    }
    if (!fence && /^\s{0,3}(-\s*){3,}$/.test(row) && out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push(row);
  }
  return out.join('\n');
}

export interface DocxOptions {
  /** The document's title (its properties, the footer, and a Title line at the top when the words don't open with a
   *  # heading). Otherwise the front matter's title or the first heading. */
  title?: string;
  brand?: Brand;
}

/** A Word document from Markdown. */
export async function makeDocx(markdown: string, opts: DocxOptions = {}): Promise<Buffer> {
  const l = lookOf(opts.brand);
  let text = clean(markdown);
  let fmTitle = '';
  const fm = frontMatterRange(text);
  if (fm) {
    fmTitle = /^title:[ \t]*(.+)$/m.exec(fm.yaml)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2') ?? '';
    text = text.slice(fm.to);
  }
  const tokens = md.parse(breaksApart(text), {});
  const firstHeading = tokens.find((t) => t.type === 'heading_open');
  const firstWords = firstHeading ? plain(spansOf(tokens[tokens.indexOf(firstHeading) + 1]?.children ?? null)).trim() : '';
  const opensWithH1 = tokens[0]?.type === 'heading_open' && tokens[0].tag === 'h1';
  const given = clean(opts.title ?? '').replace(/\s+/g, ' ').trim();
  const title = given || fmTitle || firstWords || 'Document';

  const w = new WordWriter(l);
  if ((given || fmTitle) && !opensWithH1) w.title(given || fmTitle);
  w.write(tokens);
  if (!w.out.length) w.out.push(new Paragraph({ children: [] }));

  const footer = new Footer({
    children: [
      new Paragraph({
        style: 'Footer',
        tabStops: [{ type: TabStopType.RIGHT, position: TEXT_W }],
        children: [new TextRun(title), new TextRun('\t'), new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES] })],
      }),
    ],
  });
  const doc = new Document({
    title,
    creator: '',
    lastModifiedBy: '',
    theme: { name: 'Ironleaf', colors: { dark2: l.dark, accent1: l.accent, hyperlink: l.strong }, fonts: { headings: l.head, body: l.body } },
    styles: {
      default: { document: { run: { font: l.body, size: pt(11), color: l.dark }, paragraph: { spacing: { after: 160, line: lines(1.2) } } } },
      paragraphStyles: wordStyles(l),
      characterStyles: [
        { id: 'Hyperlink', name: 'Hyperlink', basedOn: 'DefaultParagraphFont', run: { color: l.strong, underline: { type: 'single', color: l.strong } } },
        { id: 'InlineCode', name: 'Inline code', basedOn: 'DefaultParagraphFont', run: { font: l.mono, size: pt(9.5), shading: { type: ShadingType.CLEAR, color: 'auto', fill: l.soft } } },
      ],
    },
    numbering: wordNumbering(l, w.starts),
    sections: [
      {
        properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: Math.round(22 * MM), bottom: Math.round(20 * MM), left: MARGIN_X, right: MARGIN_X, header: Math.round(10 * MM), footer: Math.round(10 * MM) } } },
        footers: { default: footer },
        children: w.out,
      },
    ],
  });
  return Packer.toBuffer(doc, false, [{ path: 'word/fontTable.xml', data: fontTableXml([l.head, l.body, l.mono, SYMBOL_FONT]) }]);
}

// ── Excel ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A number format by name, or Excel's own format code ("0.0%", "#,##0", "d mmm yyyy"). */
export type CellFormat = 'currency' | 'percent' | 'integer' | 'decimal' | 'date' | 'datetime' | 'text' | (string & {});

/**
 * One cell: words, a number, true or false, or empty (null). Words starting "=" are formulas; words that are an ISO
 * date (2026-11-24, or 2026-11-24T09:30) are dates; words that are clearly a number in a format ($1,250.00, 12.5%,
 * 1,284) are that number in that format. The object forms say exactly what is meant, with an optional format.
 */
export type CellIn = string | number | boolean | null | { formula: string; format?: CellFormat } | { date: string; format?: CellFormat } | { number: number; format?: CellFormat };

export interface SheetIn {
  name: string;
  rows: CellIn[][];
  /** The first row is the header (bold, filled, frozen, filtered). Default: when the first row is all words. */
  header?: boolean;
  /** Column widths in Excel's characters; from what the columns hold when not given. */
  widths?: number[];
}

export interface BookIn {
  sheets: SheetIn[];
  brand?: Brand;
}

const FORMATS: Record<string, string> = {
  currency: '"$"#,##0.00',
  percent: '0.0%',
  integer: '#,##0',
  decimal: '#,##0.00',
  date: 'd mmm yyyy',
  datetime: 'd mmm yyyy h:mm',
  text: '@',
};
const formatCode = (f: unknown): string | undefined => {
  if (typeof f !== 'string' || !f.trim()) return undefined;
  const named = FORMATS[f.trim().toLowerCase()];
  if (named) return named;
  const code = clean(f).replace(/\n/g, ' ').trim();
  return code.length <= 80 ? code : undefined;
};

const MAX_ROWS = 1_048_576;
const MAX_COLS = 16_384;
const MAX_CELL = 32_767;

/** Excel's day number (1900 date system) for an ISO date or date and time; null when it isn't one, or is before 1
 *  March 1900 (where Excel's count is off by a day). */
export function excelSerial(iso: string): { serial: number; time: boolean } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(iso ?? '').trim());
  if (!m) return null;
  const [y, mo, d, h = '0', mi = '0', s = '0'] = m.slice(1);
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== +y || back.getUTCMonth() !== +mo - 1 || back.getUTCDate() !== +d || +h > 23 || +mi > 59 || +s > 59) return null;
  const serial = ms / 86400000 + 25569;
  if (serial < 61 || +y > 9999) return null;
  return { serial, time: m[4] !== undefined };
}

/** Formulas that reach outside the workbook (another program, the web, a running service) are kept as words. */
function safeFormula(f: string): boolean {
  const bare = f.replace(/"(?:[^"]|"")*"/g, '""').replace(/'(?:[^']|'')*'/g, "''");
  return !/\|/.test(bare) && !/\b(WEBSERVICE|CALL|REGISTER(\.ID)?|EXEC|RTD|DDE|FILTERXML)\s*\(/i.test(bare);
}

interface Prepared {
  kind: 'empty' | 'text' | 'number' | 'bool' | 'formula' | 'date';
  value: string | number | boolean;
  fmt?: string;
  /** The format came from the input, not the column. */
  own?: boolean;
  /** Roughly how many characters wide it shows. */
  len: number;
}

function prepare(c: CellIn): Prepared {
  if (c === null || c === undefined) return { kind: 'empty', value: '', len: 0 };
  if (typeof c === 'boolean') return { kind: 'bool', value: c, len: 5 };
  if (typeof c === 'number') return Number.isFinite(c) ? { kind: 'number', value: c, len: numberLength(c) } : { kind: 'empty', value: '', len: 0 };
  if (typeof c === 'object') {
    const fmt = formatCode((c as { format?: unknown }).format);
    if ('formula' in c && typeof c.formula === 'string') return formulaCell(c.formula, fmt);
    if ('date' in c && typeof c.date === 'string') {
      const d = excelSerial(c.date);
      return d ? { kind: 'date', value: d.serial, fmt: fmt ?? (d.time ? FORMATS.datetime : FORMATS.date), own: true, len: d.time ? 17 : 11 } : textCell(c.date);
    }
    if ('number' in c && typeof c.number === 'number' && Number.isFinite(c.number)) return { kind: 'number', value: c.number, fmt, own: !!fmt, len: numberLength(c.number) + (fmt ? 2 : 0) };
    return { kind: 'empty', value: '', len: 0 };
  }
  const s = clean(c);
  if (!s.trim()) return { kind: 'empty', value: '', len: 0 };
  if (/^\s*=./.test(s)) return formulaCell(s, undefined);
  const d = excelSerial(s);
  if (d) return { kind: 'date', value: d.serial, fmt: d.time ? FORMATS.datetime : FORMATS.date, own: true, len: d.time ? 17 : 11 };
  const v = readValue(s);
  if (v && v.kind !== 'date' && typeof v.value === 'number') return { kind: 'number', value: v.value, fmt: v.fmt, own: true, len: s.trim().length };
  return textCell(s);
}

function formulaCell(f: string, fmt: string | undefined): Prepared {
  const body = clean(f).replace(/^\s*=/, '').replace(/\n/g, ' ').trim();
  if (!body || !safeFormula(body)) return textCell(f);
  return { kind: 'formula', value: body, fmt, own: !!fmt, len: 12 };
}

function textCell(s: string): Prepared {
  const text = clean(s).slice(0, MAX_CELL);
  return { kind: 'text', value: text, len: Math.max(0, ...text.split('\n').map((x) => x.length)) };
}

const numberLength = (n: number) => {
  const whole = Math.trunc(Math.abs(n)).toString().length;
  return whole + Math.floor((whole - 1) / 3) + (Number.isInteger(n) ? 0 : 3) + (n < 0 ? 1 : 0);
};

/** Sheet names Excel accepts: what it refuses taken out, at most 31 characters, never blank or "History", no two
 *  the same (whatever their capitals). */
export function sheetNames(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((raw, i) => {
    const base = sheetName(clean(raw), `Sheet ${i + 1}`);
    let n = base;
    for (let k = 2; taken.has(n.toLowerCase()); k++) {
      const tail = ` (${k})`;
      n = `${base.slice(0, 31 - tail.length).trim()}${tail}`;
    }
    taken.add(n.toLowerCase());
    return n;
  });
}

const colNumber = (letters: string): number => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) & 31), 0);
const colLetters = (n: number): string => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

/** A workbook from rows of cells. */
export async function makeXlsx(book: BookIn): Promise<Buffer> {
  const l = lookOf(book.brand);
  const argb = (hex: string) => `FF${hex}`;
  const solid = (hex: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
  const font = (more: Partial<Font> = {}): Partial<Font> => ({ name: l.body, size: 11, color: { argb: argb(l.dark) }, ...more });
  const sheets = book.sheets?.length ? book.sheets : [{ name: 'Sheet 1', rows: [] }];
  const names = sheetNames(sheets.map((s) => String(s?.name ?? '')));

  const wb = new ExcelJS.Workbook();
  wb.creator = '';
  wb.lastModifiedBy = '';
  wb.created = new Date();
  wb.modified = wb.created;
  // Formulas are written without results: Excel works every one out on opening.
  wb.calcProperties = { fullCalcOnLoad: true };

  sheets.forEach((sheet, si) => {
    const rows = Array.isArray(sheet?.rows) ? sheet.rows.map((r) => (Array.isArray(r) ? r : [r as CellIn])) : [];
    if (rows.length > MAX_ROWS) throw new Error(`The sheet “${names[si]}” has more rows than Excel holds (${MAX_ROWS.toLocaleString('en-AU')}).`);
    const cols = Math.max(0, ...rows.map((r) => r.length));
    if (cols > MAX_COLS) throw new Error(`The sheet “${names[si]}” has more columns than Excel holds (${MAX_COLS.toLocaleString('en-AU')}).`);
    const cells = rows.map((r) => r.map(prepare));
    const header = sheet.header ?? (rows.length > 1 && cols > 0 && rows[0].length === cols && rows[0].every((c) => typeof c === 'string' && c.trim() !== '' && !/^\s*=/.test(c)));
    const first = header ? 1 : 0;

    // A column's format, from the cells that said theirs: numbers and formulas without one take it.
    const columnFormat = Array.from({ length: cols }, (_, k) => {
      const count = new Map<string, number>();
      for (let r = first; r < cells.length; r++) {
        const p = cells[r][k];
        if (p && (p.kind === 'number' || p.kind === 'formula') && p.own && p.fmt) count.set(p.fmt, (count.get(p.fmt) ?? 0) + 1);
      }
      const best = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (best) return best;
      // Whole numbers of four figures or more read with thousands separators (not years).
      const nums = cells.slice(first).map((r) => r[k]).filter((p): p is Prepared => !!p && p.kind === 'number');
      if (nums.length && nums.every((p) => Number.isInteger(p.value)) && nums.some((p) => Math.abs(p.value as number) >= 10000)) return FORMATS.integer;
      return undefined;
    });

    // A formula with no format of its own shows like the column it reads (=D2-E2 as D does), unless it divides
    // (a ratio) or counts.
    const readsFormat = (f: string): string | undefined => {
      const bare = f.replace(/"(?:[^"]|"")*"/g, '""');
      if (/[/]|\bCOUNT/i.test(bare)) return undefined;
      const ref = /(?:^|[^A-Za-z0-9_.!'])\$?([A-Za-z]{1,3})\$?\d+/.exec(bare);
      const k = ref ? colNumber(ref[1]) - 1 : -1;
      return k >= 0 && k < cols ? columnFormat[k] : undefined;
    };
    // A column of formulas only (=D2-E2 all the way down) takes the format they read, so its total does too.
    for (let k = 0; k < cols; k++) {
      if (columnFormat[k]) continue;
      const read = cells.slice(first).map((r) => r[k]).filter((p) => p?.kind === 'formula' && !p.fmt).map((p) => readsFormat(String(p.value)));
      const found = read.find(Boolean);
      if (found && read.filter((f) => f === found).length * 2 > read.length) columnFormat[k] = found;
    }
    // Columns of numbers, dates and formulas: their header reads right-aligned, over the values.
    // Columns of true and false read centred.
    const boolCol = Array.from({ length: cols }, (_, k) => {
      const filled = cells.slice(first).map((r) => r[k]).filter((p) => p && p.kind !== 'empty');
      return filled.length > 0 && filled.every((p) => p.kind === 'bool');
    });
    const numericCol = Array.from({ length: cols }, (_, k) => {
      const filled = cells.slice(first).map((r) => r[k]).filter((p) => p && p.kind !== 'empty');
      return filled.length > 0 && filled.filter((p) => p.kind === 'number' || p.kind === 'formula' || p.kind === 'date').length * 2 > filled.length;
    });

    const ws = wb.addWorksheet(names[si], {
      views: header ? [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }] : [{ state: 'normal' }],
      pageSetup: { paperSize: 9, orientation: cols > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: header ? '1:1' : undefined },
    });
    const widths = Array.from({ length: cols }, () => 0);
    const wrapAt = 60;
    cells.forEach((row, r) => {
      const isHead = header && r === 0;
      const p0 = row[0];
      const isTotal = !isHead && r > first && p0?.kind === 'text' && TOTAL_ROW.test(String(p0.value).trim());
      row.forEach((p, k) => {
        widths[k] = Math.max(widths[k], p.len + (isHead ? 4 : 0));
        if (p.kind === 'empty' && !isHead && !isTotal) return;
        const cell: Cell = ws.getCell(r + 1, k + 1);
        if (p.kind === 'formula') cell.value = { formula: String(p.value) };
        else if (p.kind !== 'empty') cell.value = p.value;
        const fmt = p.fmt ?? (p.kind === 'number' || (p.kind === 'formula' && !/^\s*COUNT/i.test(String(p.value))) ? columnFormat[k] : undefined) ?? (p.kind === 'formula' ? readsFormat(String(p.value)) : undefined);
        if (fmt) cell.numFmt = fmt;
        cell.font = font(isHead || isTotal ? { bold: true } : {});
        if (isHead) {
          cell.fill = solid(l.tint);
          cell.border = { bottom: { style: 'thin', color: { argb: argb(l.accent) } } } as Partial<Borders>;
          cell.alignment = { vertical: 'middle', wrapText: p.len > wrapAt, horizontal: numericCol[k] ? 'right' : boolCol[k] ? 'center' : undefined };
        } else if (isTotal) cell.border = { top: { style: 'thin', color: { argb: argb(l.dark) } }, bottom: { style: 'double', color: { argb: argb(l.dark) } } } as Partial<Borders>;
        // Every value at the top of its row, so a row with a long note still reads across.
        if (!isHead) cell.alignment = { vertical: 'top', wrapText: p.kind === 'text' && (p.len > wrapAt || String(p.value).includes('\n')) ? true : undefined, horizontal: p.kind === 'bool' ? 'center' : undefined };
      });
    });
    if (header) ws.getRow(1).height = 22;

    for (let k = 0; k < cols; k++) {
      const given = Number(sheet.widths?.[k]);
      ws.getColumn(k + 1).width = Number.isFinite(given) && given > 0 ? Math.min(255, given) : Math.max(8, Math.min(wrapAt, Math.ceil(widths[k] * 1.1) + 3));
    }
    if (header && cols) ws.autoFilter = `A1:${colLetters(cols)}${Math.max(1, rows.length)}`;
  });

  const out = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return changeParts(out, (name, xml) => (name === 'xl/theme/theme1.xml' ? themed(xml, l) : null));
}

// ── PowerPoint ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type Bullet = string | { text: string; level?: number };

export interface SlideIn {
  title: string;
  /** Points, one level deep or more ({ text, level: 1 } sits under the one before). On a section or title slide the
   *  first is the line under the title; on a quote slide the first says who said it. */
  bullets?: Bullet[];
  /** The speaker's notes. */
  notes?: string;
  /** Default: two-column when `right` is given, bullets when there are bullets, else a section divider. A quote
   *  slide shows its title as the quote. */
  layout?: 'title' | 'section' | 'bullets' | 'two-column' | 'quote';
  /** The right-hand column of a two-column slide (`bullets` is the left). */
  right?: Bullet[];
}

export interface DeckIn {
  title: string;
  subtitle?: string;
  slides: SlideIn[];
  brand?: Brand;
}

// The slide, 16:9, in inches.
const SW = 13.333;
const SH = 7.5;
const MX = 0.75;
const CW = SW - 2 * MX;
const BODY_Y = 1.85;
const BODY_H = 4.85;
const GAP = 0.5;
const COL_W = (CW - GAP) / 2;
const FOOT_Y = 6.95;
const QUOTE_X = 1.6;
const QUOTE_W = SW - 2 * QUOTE_X;
const QUOTE_H = 5.9;

/** Body sizes by level, in points; the smallest the words may shrink to is MIN_SCALE of them. */
const LEVEL_PT = [22, 19, 17, 16, 15];
const MIN_SCALE = 0.72;
const SCALES = [1, 0.92, 0.85, 0.78, MIN_SCALE];
/** The most points on one slide, however short: more go on to the next. */
const MAX_POINTS = 8;

interface Para {
  text: string;
  level: number;
}

const bulletsOf = (list: Bullet[] | undefined): Para[] =>
  (Array.isArray(list) ? list : [])
    .map((b) => (typeof b === 'string' ? { text: b, level: 0 } : { text: String(b?.text ?? ''), level: Number(b?.level ?? 0) || 0 }))
    .map((b) => {
      // "- point" or "  • point" as written in a chat: the mark goes, its indent is the level.
      const lead = /^(\s*)(?:[-*•–]\s+)?/.exec(clean(b.text))!;
      const extra = b.level === 0 && lead[1].length >= 2 ? Math.floor(lead[1].length / 2) : 0;
      return { text: clean(b.text).slice(lead[0].length).replace(/\s+$/, ''), level: Math.max(0, Math.min(LEVEL_PT.length - 1, Math.floor(b.level) + extra)) };
    })
    .filter((b) => b.text.trim());

/** How tall words set at `size` points are in a box `w` inches wide (an average character is about half the size). */
function textHeight(paras: Para[], w: number, size: (level: number) => number, gap: number): number {
  let h = 0;
  paras.forEach((p, i) => {
    const s = size(p.level);
    const room = Math.max(1, w * 72 - 14 - (p.level + (p.level || paras.length > 1 ? 1 : 0)) * 0.32 * 72);
    const rows = p.text.split('\n').reduce((n, part) => n + Math.max(1, Math.ceil((plain(inlineSpans(part)).length * s * 0.5) / room)), 0);
    h += rows * s * 1.18 + (i ? gap * s : 0);
  });
  return h / 72 + 0.1;
}

/** The largest scale (of SCALES) at which the words fit the box, or 0 when they don't even at the smallest. */
function fitScale(paras: Para[], w: number, h: number, sizes: number[], gap = 0.45): number {
  for (const s of SCALES) if (textHeight(paras, w, (lvl) => sizes[Math.min(lvl, sizes.length - 1)] * s, gap) <= h) return s;
  return 0;
}

/** Points cut into slides' worth: each piece fits its box at a comfortable size. */
function piecesOf(paras: Para[], w: number, h: number): Para[][] {
  if (!paras.length || (paras.length <= MAX_POINTS && fitScale(paras, w, h, LEVEL_PT) > 0)) return [paras];
  const out: Para[][] = [];
  let cur: Para[] = [];
  // Even pieces: as many slides as it takes, the points shared out between them.
  const per = Math.ceil(paras.length / Math.ceil(paras.length / MAX_POINTS));
  for (const p of paras) {
    const next = [...cur, p];
    // A point under another stays with it where it can.
    const full = cur.length >= per && p.level === 0;
    if (cur.length && (full || cur.length >= MAX_POINTS || textHeight(next, w, (lvl) => LEVEL_PT[lvl] * 0.85, 0.45) > h)) {
      out.push(cur);
      cur = [p];
    } else cur = next;
  }
  if (cur.length) out.push(cur);
  return out;
}

type TextItem = PptxGenJS.TextProps;

/** Paragraphs as pptxgenjs runs: each paragraph's first run carries its level and bullet, its last ends the line. */
function runsOf(paras: Para[], o: { sizes: number[]; scale: number; look: Look; bullets: boolean; italic?: boolean; onDark?: boolean }): TextItem[] {
  const out: TextItem[] = [];
  paras.forEach((p, k) => {
    const size = Math.round(o.sizes[Math.min(p.level, o.sizes.length - 1)] * o.scale * 2) / 2;
    const spans = p.text.split('\n').flatMap((part, i) => {
      const s = inlineSpans(part);
      if (i && s.length) s[0] = { ...s[0], br: true };
      return s;
    });
    if (!spans.length) spans.push({ text: '' });
    spans.forEach((s, j) => {
      const opts: PptxGenJS.TextPropsOptions = {
        fontSize: size,
        bold: s.bold || undefined,
        italic: s.italic || o.italic || undefined,
        strike: s.strike ? 'sngStrike' : undefined,
        fontFace: s.code ? o.look.mono : undefined,
        // Links in the accent, or white on the dark and accent grounds (where the accent wouldn't show).
        color: s.href ? (o.onDark ? 'FFFFFF' : o.look.strong) : undefined,
        hyperlink: s.href ? { url: s.href } : undefined,
        softBreakBefore: s.br && j > 0 ? true : undefined,
        breakLine: j === spans.length - 1 && k < paras.length - 1 ? true : undefined,
      };
      if (j === 0) {
        Object.assign(opts, {
          bullet: o.bullets ? { indent: 18 + 2 * p.level, characterCode: p.level % 2 ? '2013' : '2022' } : false,
          indentLevel: p.level,
          paraSpaceBefore: k ? Math.round(size * 0.45) : 0,
        });
      }
      out.push({ text: s.text, options: opts });
    });
  });
  return out;
}

/** A deck from a slide outline. */
export async function makePptx(deck: DeckIn): Promise<Buffer> {
  const l = lookOf(deck.brand);
  const title = clean(deck.title).replace(/\s+/g, ' ').trim() || 'Presentation';
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = title;
  pptx.author = '';
  pptx.company = '';
  pptx.subject = '';
  pptx.theme = { headFontFace: l.head, bodyFontFace: l.body };

  const light = mix(l.dark, 'FFFFFF', 0.78);
  const footWords = title.length <= 70 ? title : '';
  const number = { x: SW - MX - 1, y: FOOT_Y, w: 1, h: 0.3, fontFace: l.body, fontSize: 10, color: l.muted, align: 'right' as const, valign: 'middle' as const, margin: 0 };
  const foot = { text: { text: footWords, options: { x: MX, y: FOOT_Y, w: CW - 1.2, h: 0.3, fontFace: l.body, fontSize: 10, color: l.muted, valign: 'middle' as const, margin: 0 } } };
  const titleBox = (o: Partial<PptxGenJS.PlaceholderProps> = {}) => ({ placeholder: { options: { name: 'title', type: 'title' as const, x: MX, y: 0.45, w: CW, h: 1.0, fontFace: l.head, fontSize: 30, bold: true, color: l.dark, valign: 'bottom' as const, align: 'left' as const, margin: 0, ...o } as PptxGenJS.PlaceholderProps, text: '' } });
  const bodyBox = (name: string, x: number, w: number, o: Partial<PptxGenJS.PlaceholderProps> = {}) => ({ placeholder: { options: { name, type: 'body' as const, x, y: BODY_Y, w, h: BODY_H, fontFace: l.body, fontSize: LEVEL_PT[0], color: l.dark, valign: 'top' as const, margin: 0, ...o } as PptxGenJS.PlaceholderProps, text: '' } });
  const rule = { rect: { x: MX, y: 1.58, w: 0.9, h: 0.06, fill: { color: l.accent }, line: { color: l.accent, width: 0 } } };

  pptx.defineSlideMaster({
    title: 'Ironleaf title',
    background: { color: l.dark },
    objects: [
      { rect: { x: MX, y: 4.3, w: 1.3, h: 0.08, fill: { color: l.onDark }, line: { color: l.onDark, width: 0 } } },
      titleBox({ y: 1.2, h: 2.9, fontSize: 44, color: 'FFFFFF' }),
      { placeholder: { options: { name: 'subtitle', type: 'body', x: MX, y: 4.65, w: CW, h: 1.6, fontFace: l.body, fontSize: 20, color: light, valign: 'top', margin: 0 }, text: '' } },
    ],
  });
  pptx.defineSlideMaster({
    title: 'Ironleaf section',
    background: { color: l.strong },
    objects: [
      { rect: { x: 0, y: 0, w: 0.22, h: SH, fill: { color: mix(l.strong, 'FFFFFF', 0.35) }, line: { color: mix(l.strong, 'FFFFFF', 0.35), width: 0 } } },
      titleBox({ y: 2.0, h: 2.2, fontSize: 40, color: 'FFFFFF' }),
      { placeholder: { options: { name: 'subtitle', type: 'body', x: MX, y: 4.4, w: CW, h: 1.4, fontFace: l.body, fontSize: 20, color: mix(l.strong, 'FFFFFF', 0.8), valign: 'top', margin: 0 }, text: '' } },
    ],
    slideNumber: { ...number, color: mix(l.strong, 'FFFFFF', 0.7) },
  });
  pptx.defineSlideMaster({ title: 'Ironleaf bullets', background: { color: 'FFFFFF' }, objects: [titleBox(), rule, bodyBox('body', MX, CW), foot], slideNumber: number });
  pptx.defineSlideMaster({ title: 'Ironleaf two columns', background: { color: 'FFFFFF' }, objects: [titleBox(), rule, bodyBox('left', MX, COL_W), bodyBox('right', MX + COL_W + GAP, COL_W), foot], slideNumber: number });
  pptx.defineSlideMaster({
    title: 'Ironleaf quote',
    background: { color: l.soft },
    objects: [
      { rect: { x: 0, y: 0, w: SW, h: 0.12, fill: { color: l.accent }, line: { color: l.accent, width: 0 } } },
      { placeholder: { options: { name: 'quote', type: 'body', x: QUOTE_X, y: 0.7, w: QUOTE_W, h: QUOTE_H, fontFace: l.head, fontSize: 30, color: l.dark, valign: 'middle', margin: 0 }, text: '' } },
      foot,
    ],
    slideNumber: number,
  });

  const fitTitle = (text: string, w: number, h: number, size: number) => {
    const paras = [{ text, level: 0 }];
    for (const s of [1, 0.9, 0.8, 0.7, 0.6]) if (textHeight(paras, w, () => size * s, 0) <= h) return Math.round(size * s);
    return Math.round(size * 0.6);
  };
  const addTitle = (slide: PptxGenJS.Slide, text: string, w: number, h: number, size: number, onDark = false) => {
    const fontSize = fitTitle(text, w, h, size);
    slide.addText(runsOf([{ text, level: 0 }], { sizes: [fontSize], scale: 1, look: l, bullets: false, onDark }), { placeholder: 'title', fontSize, fit: 'shrink' });
  };
  const addLine = (slide: PptxGenJS.Slide, place: string, text: string, w: number, h: number, size: number) => {
    if (!text.trim()) return;
    const scale = fitScale([{ text, level: 0 }], w, h, [size]) || MIN_SCALE;
    slide.addText(runsOf([{ text, level: 0 }], { sizes: [size], scale, look: l, bullets: false, onDark: true }), { placeholder: place, fit: 'shrink' });
  };
  const notesOf = (s: SlideIn) => clean(s.notes ?? '').trim();

  const slides = Array.isArray(deck.slides) ? deck.slides.filter((s) => s && typeof s === 'object') : [];
  const coverGiven = slides[0]?.layout === 'title';
  const cover: SlideIn = coverGiven ? slides[0] : { title, bullets: deck.subtitle ? [deck.subtitle] : [], layout: 'title' };

  for (const s of [cover, ...slides.slice(coverGiven ? 1 : 0)]) {
    const words = clean(s.title).replace(/\s+/g, ' ').trim();
    const left = bulletsOf(s.bullets);
    const right = bulletsOf(s.right);
    const layout = s.layout ?? (right.length ? 'two-column' : left.length ? 'bullets' : 'section');
    const notes = notesOf(s);
    if (layout === 'title' || layout === 'section') {
      const slide = pptx.addSlide({ masterName: layout === 'title' ? 'Ironleaf title' : 'Ironleaf section' });
      addTitle(slide, words, CW, layout === 'title' ? 2.9 : 2.2, layout === 'title' ? 44 : 40, true);
      addLine(slide, 'subtitle', [...left, ...right].map((p) => p.text).join('\n'), CW, layout === 'title' ? 1.6 : 1.4, 20);
      if (notes) slide.addNotes(notes);
      continue;
    }
    if (layout === 'quote') {
      // One box, centred on the slide: a large opening mark in the accent, the quote, then who said it.
      const slide = pptx.addSlide({ masterName: 'Ironleaf quote' });
      const quote = words.replace(/^["“”']+|["“”']+$/g, '');
      const who = left[0]?.text.replace(/^[-—–\s]+/, '') ?? '';
      const room = QUOTE_H - 1.25 - (who ? 0.75 : 0);
      const scale = fitScale([{ text: quote, level: 0 }], QUOTE_W, room, [30], 0) || 0.6;
      const runs: TextItem[] = [{ text: '“', options: { fontFace: 'Georgia', fontSize: 80, color: l.accent, bold: false, bullet: false, lineSpacingMultiple: 0.8, breakLine: true } }];
      runs.push(...runsOf([{ text: quote, level: 0 }], { sizes: [30], scale, look: l, bullets: false, italic: true }));
      if (who) {
        (runs[runs.length - 1].options as PptxGenJS.TextPropsOptions).breakLine = true;
        runs.push({ text: `— ${who}`, options: { fontFace: l.body, fontSize: 18, color: l.strong, bullet: false, paraSpaceBefore: 18 } });
      }
      slide.addText(runs, { placeholder: 'quote', fit: 'shrink' });
      if (notes) slide.addNotes(notes);
      continue;
    }
    // Bullets, or two columns: cut into as many slides as the points need, each titled the same ("continued").
    const two = layout === 'two-column';
    const leftPieces = piecesOf(left, two ? COL_W : CW, BODY_H);
    const rightPieces = two ? piecesOf(right, COL_W, BODY_H) : [];
    const count = Math.max(leftPieces.length, rightPieces.length, 1);
    for (let n = 0; n < count; n++) {
      const slide = pptx.addSlide({ masterName: two ? 'Ironleaf two columns' : 'Ironleaf bullets' });
      addTitle(slide, n ? `${words} (continued)` : words, CW, 1.0, 30);
      const lp = leftPieces[n] ?? [];
      const rp = rightPieces[n] ?? [];
      // Both columns at one size, the size the fuller one fits at.
      const scale = Math.min(fitScale(lp, two ? COL_W : CW, BODY_H, LEVEL_PT) || MIN_SCALE, two ? fitScale(rp, COL_W, BODY_H, LEVEL_PT) || MIN_SCALE : 1);
      if (lp.length) slide.addText(runsOf(lp, { sizes: LEVEL_PT, scale, look: l, bullets: true }), { placeholder: two ? 'left' : 'body', fit: 'shrink' });
      if (rp.length) slide.addText(runsOf(rp, { sizes: LEVEL_PT, scale, look: l, bullets: true }), { placeholder: 'right', fit: 'shrink' });
      if (notes && n === 0) slide.addNotes(notes);
    }
  }

  const out = Buffer.from((await pptx.write({ outputType: 'nodebuffer' })) as Buffer);
  return changeParts(out, (name, xml) => (name === 'ppt/theme/theme1.xml' ? themed(xml, l) : /^ppt\/(slides|slideLayouts|slideMasters|notesSlides|notesMasters)\/[^/]+\.xml$/.test(name) ? tidySlideXml(xml, l.accent) : null));
}
