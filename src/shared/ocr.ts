// Words in pictures and scans (9.0 w123ocr, 31 Oct 2026: rivals find the words in pictures and scans, so the Vault
// does too). A picture among the notes, or a PDF page with no text layer, is read by Windows' own built-in text
// recogniser (part of Windows 10 and 11: nothing to download, no account, no company's approval), and its words go
// into the search beside the notes, with where each line sits. The files themselves are never changed: what was read
// is kept in Ironleaf's own data on this PC. Shared by the main side (src/main/ocr.ts), the window and the tests. No
// imports.

/** A box as fractions of the picture or page (x, y, width, height, each 0 to 1, from the top left), so it fits at any
 *  size or zoom. */
export type OcrBox = [number, number, number, number];

/** One recognised word, and where it sits. */
export interface OcrWord {
  text: string;
  box: OcrBox;
}

/** One recognised line, where it sits, and its words (for marking the found words). */
export interface OcrLine {
  text: string;
  box: OcrBox;
  words: OcrWord[];
}

/** The pictures the recogniser is given: what Windows opens (heic when its codec is on the PC; a kind Windows can't
 *  open is left unread, never an error). SVG and icons are their own drawing, not words to read. */
export const OCR_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'bmp', 'gif', 'tif', 'tiff', 'avif']);

/** Whether files of this extension go to the recogniser (lower- or upper-case). */
export const isOcrImage = (ext: string): boolean => OCR_IMAGE_EXTS.has(ext.toLowerCase());

/** How much the words in pictures keep to (Settings says them in words). */
export const OCR_LIMITS = {
  /** Pictures bigger than this are found by name only (recognising them would take too long). */
  imageBytes: 30 * 1024 * 1024,
  /** PDFs bigger than this keep their words only (their scanned pages are not read). */
  pdfBytes: 60 * 1024 * 1024,
  /** A PDF's scanned pages read, at most. */
  pages: 200,
  /** One file's recognised words kept, at most. */
  fileChars: 200_000,
} as const;

/** How much of a file's pictures were read. */
export type OcrEntryState =
  /** Its recognised words are kept. */
  | 'words'
  /** Read, and it needs nothing (a PDF whose pages all have words). */
  | 'clear'
  /** Bigger than is read (found by its name). */
  | 'big'
  /** Could not be read (Windows couldn't open it, or the recogniser failed). */
  | 'failed';

export interface OcrEntry {
  /** The path among the notes, with forward slashes. */
  rel: string;
  mtime: number;
  size: number;
  state: OcrEntryState;
  /** When it was read. */
  at?: number;
  /** The recognised lines by page (a picture's under '1'). */
  pages?: Record<string, OcrLine[]>;
  /** A PDF's pages with no words of their own (counted from 1): the only ones ever read. */
  scanned?: number[];
}

export interface OcrLanguage {
  /** What Windows calls it ('en-AU'). */
  tag: string;
  /** Its name as Windows says it ('English (Australia)'). */
  name: string;
}

export interface OcrStatus {
  /** Settings › General › Read words in pictures and scans. */
  on: boolean;
  /** Windows' recogniser is on this PC and ready. */
  available: boolean;
  /** Why not, when it isn't: 'not-windows' (this PC isn't Windows), 'no-ocr' (this Windows has no recogniser),
   *  'no-languages' (no language for it is installed), 'off'. */
  reason: string;
  /** Reading now. */
  busy: boolean;
  /** While busy: pictures and scanned pages read so far of those to read, and the file being read. */
  done: number;
  todo: number;
  current?: string;
  /** Pictures and PDFs with scanned pages among the notes, and how many have their words. */
  files: number;
  withWords: number;
  /** The languages Windows has for it (null until asked: choosing one is in Settings). */
  languages: OcrLanguage[] | null;
  /** The language chosen in Settings ('' is automatic). */
  lang: string;
}

/** A picture or scan a search found: what matched, and where (a picture's line, a scan's page and line). */
export interface OcrHit {
  path: string;
  title: string;
  kind: 'image' | 'pdf';
  /** A scan's page the words are on, counted from 1 as people do. */
  page?: number;
  mtime: number;
  score: number;
  matches: number;
  snippets: { line: number; text: string; ranges: [number, number][]; page?: number }[];
}

/** 'Found in the picture' under a picture hit, 'Found on page 3 of the scan' under a scan's. */
export function mediaFoundWords(kind: 'image' | 'pdf', page?: number): string {
  if (kind === 'pdf' && page) return `Found on page ${page} of the scan`;
  if (kind === 'pdf') return 'Found in the scan';
  return 'Found in the picture';
}

/** '312 of 540 read': pictures and scanned pages with their words, of those among the notes. */
export function ocrProgressWords(done: number, todo: number): string {
  return `${done.toLocaleString('en-AU')} of ${todo.toLocaleString('en-AU')} read`;
}

/** Pixels of a picture `w` by `h` as fractions of it, kept inside it. */
export function normaliseBox(box: readonly [number, number, number, number], w: number, h: number): OcrBox {
  const [x, y, bw, bh] = box;
  const nx = w > 0 ? x / w : 0;
  const ny = h > 0 ? y / h : 0;
  const nw = w > 0 ? bw / w : 0;
  const nh = h > 0 ? bh / h : 0;
  const clamp = (n: number) => Math.min(1, Math.max(0, Math.round(n * 10000) / 10000));
  return [clamp(nx), clamp(ny), clamp(nw), clamp(nh)];
}

/** A file's recognised words as one string (the assistant's reading): a picture's lines, a scan's pages in order. */
export function ocrEntryText(entry: OcrEntry): string {
  if (entry.state !== 'words' || !entry.pages) return '';
  return Object.keys(entry.pages)
    .sort((a, b) => Number(a) - Number(b))
    .map((p) => {
      const lines = (entry.pages![p] ?? []).map((l) => l.text.trim()).filter(Boolean);
      if (!lines.length) return '';
      return Number(p) > 1 || Object.keys(entry.pages!).length > 1 ? `[page ${p}]\n${lines.join('\n')}` : lines.join('\n');
    })
    .filter(Boolean)
    .join('\n');
}
