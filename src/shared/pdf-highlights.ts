// Highlights and notes on a PDF, kept in a Markdown note beside it that the person owns (19 Oct 2026: 5.0.0, "a PDF
// reader with highlights and notes"). The PDF itself is never touched: everything lives in "<name> (highlights).md" in
// the same folder, which reads well on its own (each highlight a quote, its page a link back into the PDF at that spot,
// the person's own words under it) and is plain Markdown any app opens. Where each highlight sits on its page goes in one
// small fenced block at the end, so the readable part stays readable.
//
// Why "<name> (highlights).md" and not "<name>.pdf.md": a note's title is its file name without ".md", so "Report.pdf.md"
// would be titled "Report.pdf", and links resolve to a note before a file, so every [[Report.pdf]] would open the note
// instead of the PDF. "(highlights)" also says what the note is in the file list, where it sits right under the PDF.
//
// Links into a PDF use the PDF's own open-parameter form, [[Report.pdf#page=4]], which other PDF readers understand
// too; "&hl=<id>" names one highlight, which flashes when the link is opened. No imports, so the window, the main side and
// the tests share it.
//
// (31 Oct 2026, 8.9 read and highlight PDFs in the Vault): a highlight can also be a clip, a box drawn round a picture
// or a scanned part, kept as a picture beside the PDF and shown in the note where the quote would be. Clips sort, link
// and drag like highlights; the PDF itself is still never changed.

/** The four highlight colours on a PDF (the editor's own palette, lib/highlights.ts, in the same order). */
export const PDF_COLOURS = ['yellow', 'green', 'blue', 'pink'] as const;
export type PdfColour = (typeof PDF_COLOURS)[number];

export const isPdfColour = (value: unknown): value is PdfColour => typeof value === 'string' && (PDF_COLOURS as readonly string[]).includes(value);

/** A box on a page in the PDF's own units (points, measured up from the page's bottom left): x1, y1, x2, y2. */
export type PdfRect = [number, number, number, number];

export interface PdfHighlight {
  id: string;
  /** The page it is on, counted from 1 as people do. */
  page: number;
  colour: PdfColour;
  /** The boxes over the highlighted words, one per line of text (a clip's one drawn box). */
  rects: PdfRect[];
  /** The highlighted words as they read ('' for a clip: its picture says it). */
  text: string;
  /** What the person wrote about it (Markdown, any number of lines; '' for none). */
  note: string;
  /** The day it was made (YYYY-MM-DD). */
  at?: string;
  /** A clip's picture, kept beside the PDF (its path among the notes); unset for a words highlight. */
  image?: string;
}

/** A highlights note read back: what the person wrote before the highlights (kept as it is), and the highlights. */
export interface PdfSidecar {
  /** Everything above the first page heading or highlight, front matter included; null for a new note. */
  preamble: string | null;
  highlights: PdfHighlight[];
}

/** The fenced block at the end that says where each highlight sits. */
export const DATA_FENCE = 'nv-pdf-highlights';
const DATA_LEAD = '_Where each highlight sits in the PDF, kept for Ironleaf (leave this part as it is)._';
const DATA_LEAD_RE = /^_Where each highlight sits in the PDF\b.*_\s*$/;
const PAGE_HEADING_RE = /^##[ \t]+Page[ \t]+(\d+)[ \t]*$/;
const HL_RE = /[#&?]hl=([A-Za-z0-9_-]+)/;
const PAGE_RE = /[#&?]page=(\d+)/;
const COLOUR_WORD_RE = /·[ \t]*(Yellow|Green|Blue|Pink)\b/i;

const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p: string) => p.split('/').pop() ?? p;

/** Where a PDF's highlights note lives: beside it, "<name> (highlights).md". */
export function sidecarPathFor(pdfPath: string): string {
  const base = nameOf(pdfPath).replace(/\.pdf$/i, '');
  const folder = folderOf(pdfPath);
  return `${folder ? `${folder}/` : ''}${base} (highlights).md`;
}

/** Whether a note is a PDF's highlights note (by its name). */
export const isSidecarPath = (path: string) => / \(highlights\)\.md$/i.test(path);

/** Every PDF in a vault listing, by file name: notes folders, Assets, attachments beside notes, wherever the listing
 *  found them. "Open a PDF in the reader…" offers exactly this (8.9 w114pdf round 2); when it is empty the command
 *  says so instead of opening a picker. */
export function pdfChoices(files: { rel: string }[]): string[] {
  return files.filter((f) => /\.pdf$/i.test(f.rel)).map((f) => f.rel).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}

/** What follows the # in a link into a PDF: "page=4", "page=4&hl=h7k2m9" (a bare number is a page too), and
 *  "&find=<words>" (21 Oct 2026, notebook mode: a cited passage's first words, looked for and marked on that page). */
export function parsePdfAnchor(hash: string | undefined): { page?: number; hl?: string; find?: string } {
  const h = (hash ?? '').trim().replace(/^#/, '');
  if (!h) return {};
  if (/^\d+$/.test(h)) return { page: Math.max(1, Number(h)) };
  const out: { page?: number; hl?: string; find?: string } = {};
  for (const part of h.split('&')) {
    const [key, value = ''] = part.split('=');
    if (key === 'page' && /^\d+$/.test(value)) out.page = Math.max(1, Number(value));
    if (key === 'hl' && /^[A-Za-z0-9_-]+$/.test(value)) out.hl = value;
    if (key === 'find' && value) {
      try {
        const words = decodeURIComponent(value).replace(/\s+/g, ' ').trim().slice(0, 200);
        if (words) out.find = words;
      } catch {
        // Not words: the page alone.
      }
    }
  }
  return out;
}

/** The part after the # in a link to a page of a PDF, and to one highlight on it. */
export const pdfAnchor = (page: number, hl?: string, find?: string) => `page=${page}${hl ? `&hl=${hl}` : ''}${find ? `&find=${encodeURIComponent(find)}` : ''}`;

/** A short id no other highlight here has. */
export function newHighlightId(taken: Iterable<string> = [], random: () => number = Math.random): string {
  const used = new Set(taken);
  for (;;) {
    let id = 'h';
    for (let i = 0; i < 6; i++) id += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(random() * 36)];
    if (!used.has(id)) return id;
  }
}

const round = (n: number) => Math.round(n * 10) / 10;
const cap = (c: PdfColour) => c[0].toUpperCase() + c.slice(1);

/** Words for a quote line: on one line, and never read as a heading, list or quote of its own. */
function quoteWords(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return /^(#|>|[-+*][ \t]|\d+[.)][ \t])/.test(one) ? `\\${one}` : one;
}
const unquoteWords = (text: string) => text.replace(/^\\(?=#|>|[-+*][ \t]|\d+[.)][ \t])/, '');

/** A clip's picture is named for its PDF and its highlight, so it sits beside both in the file list. */
export function clipImageName(pdfPath: string, id: string): string {
  return `${nameOf(pdfPath).replace(/\.pdf$/i, '')} clip ${id}.png`;
}

/** The words under a clip's picture, in the note and wherever it is dropped. */
export const clipCaption = (page: number): string => `Clipped picture, page ${page}`;

/**
 * A highlight as a block for another note (dragged from the highlights list, or quoted there): its words as a quote,
 * or a clip's picture, with a link back to the PDF at that place. Links are always [[…]] (as in the highlights note),
 * whatever the setting for new links, so renames keep them pointing at the PDF and the picture.
 */
export function highlightShareBlock(h: PdfHighlight, pdfTarget: string, alias: string, colour?: PdfColour): string {
  const link = `[[${pdfTarget}#${pdfAnchor(h.page, h.id)}|${alias}]]${colour ? ` · ${cap(colour)}` : ''}`;
  if (h.image) return `![[${h.image}|${clipCaption(h.page)}]]\n— ${link}`;
  return `> ${quoteWords(h.text) || '…'}\n>\n> — ${link}`;
}

/** Whether a PDF's pages hold no words at all (a scan): every page blank. */
export function isScannedPdfText(pages: readonly string[]): boolean {
  return pages.length > 0 && pages.every((p) => !p.replace(/\s+/g, ''));
}

/** What the reader says about a scan whose words are still being read. */
export function scanReadingNotice(): { title: string; body: string } {
  return { title: 'This PDF is a scan.', body: 'Its words are being read and will be selectable and searchable soon.' };
}

/** What the reader says about a PDF without words: plain words, and the former host app's make-searchable path when inside
it. */
export function scannedPdfNotice(canMakeSearchable: boolean): { title: string; body: string; action: string | null } {
  return {
    title: 'This PDF has no words in it.',
    body: 'It shows as pictures, so words cannot be selected or searched. You can still clip parts of it as pictures.',
    action: canMakeSearchable ? 'Make searchable' : null,
  };
}

/** Highlights in reading order: by page, then down the page, then across. */
export function sortHighlights(list: PdfHighlight[]): PdfHighlight[] {
  const top = (h: PdfHighlight) => Math.max(...h.rects.map((r) => Math.max(r[1], r[3])), -Infinity);
  const left = (h: PdfHighlight) => Math.min(...h.rects.map((r) => Math.min(r[0], r[2])), Infinity);
  return [...list].sort((a, b) => a.page - b.page || top(b) - top(a) || left(a) - left(b));
}

/** The note's opening for a new highlights note: who it belongs to, and that the PDF is never changed. */
export function defaultPreamble(pdfPath: string, pdfTarget: string): string {
  const title = nameOf(pdfPath).replace(/\.pdf$/i, '');
  return [
    '---',
    `pdf: "[[${pdfTarget}]]"`,
    '---',
    '',
    `# ${title}: highlights`,
    '',
    `Highlights and notes from [[${pdfTarget}]]. Write under any highlight and it shows beside it in the PDF; the PDF itself is never changed.`,
  ].join('\n');
}

/**
 * The whole highlights note. `pdfTarget` is how links name the PDF (its name, or its path when another file shares the
 * name). Links are always written as [[…]], whatever the setting for new links, because those are the ones kept up to
 * date when the PDF is renamed or moved (Markdown links are only followed to notes).
 */
export function writeSidecar(doc: PdfSidecar, pdfPath: string, pdfTarget: string): string {
  const out: string[] = [(doc.preamble ?? defaultPreamble(pdfPath, pdfTarget)).replace(/\s+$/, '')];
  let page = 0;
  const sorted = sortHighlights(doc.highlights);
  for (const h of sorted) {
    if (h.page !== page) {
      page = h.page;
      out.push('', `## Page ${page}`);
    }
    // A clip shows its picture where the quote would be (a highlight with both keeps the picture; its words, if any,
    // live in its note).
    if (h.image) out.push('', highlightShareBlock(h, pdfTarget, `Page ${h.page}`, h.colour));
    else out.push('', `> ${quoteWords(h.text) || '…'}`, '>', `> — [[${pdfTarget}#${pdfAnchor(h.page, h.id)}|Page ${h.page}]] · ${cap(h.colour)}`);
    const note = h.note.replace(/^\s*\n/, '').replace(/\s+$/, '');
    if (note) out.push('', note);
  }
  if (sorted.length) {
    out.push('', DATA_LEAD, '', '```' + DATA_FENCE);
    for (const h of sorted) {
      out.push(JSON.stringify({ id: h.id, page: h.page, colour: h.colour, rects: h.rects.map((r) => r.map(round)), ...(h.at ? { at: h.at } : {}), ...(h.image ? { image: h.image } : {}) }));
    }
    out.push('```');
  }
  return out.join('\n') + '\n';
}

interface Found {
  id: string;
  page?: number;
  colour?: PdfColour;
  text: string;
  image?: string;
  note: string[];
}

/** A clip's picture line: the [[..]] embed the note is written with, or the ![](..) form written by hand. */
const CLIP_WIKI_RE = /^!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/;
const CLIP_MD_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;

/** The picture a clip line embeds (its path among the notes), or null when the line embeds nothing. */
function clipEmbedTarget(line: string): string | null {
  const t = line.trim();
  const wiki = CLIP_WIKI_RE.exec(t)?.[1]?.trim();
  if (wiki) return wiki;
  const src = CLIP_MD_RE.exec(t)?.[2]?.trim();
  if (!src) return null;
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}

/**
 * Reads a highlights note back. A highlight is a quote whose last line links into the PDF with "hl=<id>", or a clip:
 * a picture whose next line links into the PDF the same way. The person's words under it, up to the next highlight,
 * page heading or the positions block, are its note. Where it sits comes from the positions block. A highlight whose
 * quote (or whose clip's picture) the person deleted from the note is gone (the note is theirs); one whose position
 * is missing can't be drawn, so it's left out too. The colour word on the link line wins over the block, so changing
 * "· Yellow" to "· Green" in the note recolours it; the readable picture wins the same way, so a moved picture (renames
 * rewrite the readable line, never the positions block) is followed to its new place.
 */
export function parseSidecar(text: string): PdfSidecar {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const found: Found[] = [];
  const data = new Map<string, { page: number; colour: PdfColour; rects: PdfRect[]; at?: string; image?: string }>();
  let preambleEnd = -1;
  let current: Found | null = null;
  let i = 0;
  // Front matter is always part of the preamble (a "> " or "## Page" inside it is not a highlight).
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1);
    if (close > 0) i = close + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '```' + DATA_FENCE) {
      if (preambleEnd < 0) preambleEnd = i;
      for (i++; i < lines.length && lines[i].trim() !== '```'; i++) {
        try {
          const d = JSON.parse(lines[i]) as Record<string, unknown>;
          const rects = Array.isArray(d.rects) ? (d.rects as unknown[]).filter((r): r is PdfRect => Array.isArray(r) && r.length === 4 && r.every((n) => typeof n === 'number' && Number.isFinite(n))) : [];
          if (typeof d.id === 'string' && typeof d.page === 'number' && d.page >= 1 && rects.length) {
            data.set(d.id, { page: Math.floor(d.page), colour: isPdfColour(d.colour) ? d.colour : 'yellow', rects, ...(typeof d.at === 'string' ? { at: d.at } : {}), ...(typeof d.image === 'string' && d.image ? { image: d.image } : {}) });
          }
        } catch {
          // A line the person changed by hand: that highlight can't be placed, the rest still are.
        }
      }
      current = null;
      continue;
    }
    if (DATA_LEAD_RE.test(line) || PAGE_HEADING_RE.test(line)) {
      if (preambleEnd < 0) preambleEnd = i;
      current = null;
      continue;
    }
    if (/^>/.test(line)) {
      // A whole quote: a highlight when one of its lines links into the PDF with an id.
      let end = i;
      while (end + 1 < lines.length && /^>/.test(lines[end + 1])) end++;
      const block = lines.slice(i, end + 1).map((l) => l.replace(/^>[ \t]?/, ''));
      const linkAt = block.findIndex((l) => HL_RE.test(l) && /\[\[|\]\(/.test(l));
      if (linkAt >= 0) {
        if (preambleEnd < 0) preambleEnd = i;
        const link = block[linkAt];
        const page = PAGE_RE.exec(link)?.[1];
        const colour = COLOUR_WORD_RE.exec(link)?.[1]?.toLowerCase();
        current = {
          id: HL_RE.exec(link)![1],
          page: page ? Number(page) : undefined,
          colour: isPdfColour(colour) ? colour : undefined,
          text: unquoteWords(block.slice(0, linkAt).filter((l) => l.trim()).map((l) => l.trim()).join(' ')),
          note: [],
        };
        if (current.text === '…') current.text = '';
        found.push(current);
        i = end;
        continue;
      }
    }
    // A clip: a picture whose next line links into the PDF with an id (an ordinary picture in the person's words has
    // no such line after it, so it stays part of the note).
    const clipSrc = clipEmbedTarget(line);
    if (clipSrc !== null) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const attr = j < lines.length ? lines[j] : '';
      if (!/^>/.test(attr) && HL_RE.test(attr) && /\[\[|\]\(/.test(attr)) {
        if (preambleEnd < 0) preambleEnd = i;
        const page = PAGE_RE.exec(attr)?.[1];
        const colour = COLOUR_WORD_RE.exec(attr)?.[1]?.toLowerCase();
        current = {
          id: HL_RE.exec(attr)![1],
          page: page ? Number(page) : undefined,
          colour: isPdfColour(colour) ? colour : undefined,
          text: '',
          image: clipSrc,
          note: [],
        };
        found.push(current);
        i = j;
        continue;
      }
    }
    if (current) current.note.push(line);
  }
  const kept = preambleEnd < 0 ? text.replace(/\s+$/, '') : lines.slice(0, preambleEnd).join('\n').replace(/\s+$/, '');
  // An emptied note starts again with the usual opening.
  const preamble = kept.trim() ? kept : null;
  const highlights: PdfHighlight[] = [];
  const seen = new Set<string>();
  for (const f of found) {
    const d = data.get(f.id);
    if (!d || seen.has(f.id)) continue;
    seen.add(f.id);
    const note = f.note.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
    const image = f.image ?? d.image;
    highlights.push({ id: f.id, page: d.page, colour: f.colour ?? d.colour, rects: d.rects, text: f.text, note, ...(d.at ? { at: d.at } : {}), ...(image ? { image } : {}) });
  }
  return { preamble, highlights };
}
