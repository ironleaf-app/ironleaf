// A PDF in the notes opened with PDF.js (bundled in assets/pdfjs, Apache-2.0; see ASSETS.md) for the reader and for
// link previews (19 Oct 2026, 5.0.0 PDF reader). Its bytes come from the main side (a file:// address can't be fetched
// by the window), so it opens offline and the same on every PC. An open document is shared while anything shows it, and
// let go a little after the last one closes.

import { pdfjs } from '../../lib/pdfThumb';
import type { Matrix } from './geometry';

export interface PdfViewport {
  width: number;
  height: number;
  scale: number;
  rotation: number;
  userUnit: number;
  transform: Matrix;
  rawDims: { pageWidth: number; pageHeight: number; pageX: number; pageY: number };
}

export interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
  /** Where the run starts: [a, b, c, d, x, y] in the PDF's units. */
  transform?: number[];
}
export interface PdfTextContent {
  items: PdfTextItem[];
  styles: Record<string, unknown>;
  lang?: string | null;
}

export interface PdfPage {
  /** The page's box in the PDF's units. */
  view: [number, number, number, number];
  rotate: number;
  userUnit: number;
  getViewport(o: { scale: number; rotation?: number }): PdfViewport;
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport; background?: string; transform?: number[] }): { promise: Promise<void>; cancel(): void };
  getTextContent(): Promise<PdfTextContent>;
  cleanup(): void;
}

export interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}

export interface PdfTextLayer {
  render(): Promise<void>;
  cancel(): void;
  readonly textDivs: HTMLElement[];
}

interface PdfJsFull {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean }): { promise: Promise<PdfDocument>; destroy(): Promise<void> };
  TextLayer: new (o: { textContentSource: PdfTextContent; container: HTMLElement; viewport: PdfViewport }) => PdfTextLayer;
}

export const pdfjsFull = () => pdfjs() as unknown as Promise<PdfJsFull>;

interface Held {
  doc: Promise<PdfDocument>;
  destroy(): void;
  refs: number;
  timer?: ReturnType<typeof setTimeout>;
  /** Each page's words, read once (find, and the words of a highlight). */
  text: Map<number, Promise<PdfTextContent>>;
}

const held = new Map<string, Held>();

/** Opens a PDF in the notes (shared while anything holds it); give it back with releasePdf. */
export function holdPdf(path: string): Promise<PdfDocument> {
  let h = held.get(path);
  if (!h) {
    let destroy = () => {};
    const doc = (async () => {
      const [m, bytes] = await Promise.all([pdfjsFull(), window.nv.pdf.bytes(path)]);
      const task = m.getDocument({ data: bytes, isEvalSupported: false });
      destroy = () => void task.destroy().catch(() => {});
      return task.promise;
    })();
    h = { doc, destroy: () => destroy(), refs: 0, text: new Map() };
    held.set(path, h);
    // One that can't be opened isn't kept, so trying again reads it again.
    doc.catch(() => {
      if (held.get(path) === h) held.delete(path);
    });
  }
  clearTimeout(h.timer);
  h.refs++;
  return h.doc;
}

export function releasePdf(path: string): void {
  const h = held.get(path);
  if (!h) return;
  h.refs = Math.max(0, h.refs - 1);
  if (h.refs) return;
  clearTimeout(h.timer);
  h.timer = setTimeout(() => {
    if (h.refs || held.get(path) !== h) return;
    held.delete(path);
    h.destroy();
  }, 20000);
}

/** A page's words (read once per open document). */
export function pageTextContent(path: string, doc: PdfDocument, n: number): Promise<PdfTextContent> {
  const h = held.get(path);
  const read = () => doc.getPage(n).then((p) => p.getTextContent());
  if (!h) return read();
  let t = h.text.get(n);
  if (!t) {
    t = read();
    h.text.set(n, t);
  }
  return t;
}

/** The file changed on disk: the next opening reads it again. */
export function forgetPdf(path: string): void {
  const h = held.get(path);
  if (!h) return;
  held.delete(path);
  if (!h.refs) h.destroy();
}

/** One page drawn as a picture `width` CSS pixels wide (link previews), or null when it can't be. */
export async function pagePicture(path: string, page: number, width: number): Promise<{ url: string; pages: number } | null> {
  try {
    const doc = await holdPdf(path);
    try {
      const n = Math.min(Math.max(1, page), doc.numPages);
      const p = await doc.getPage(n);
      const base = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: (width * Math.min(2, window.devicePixelRatio || 1)) / Math.max(1, base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await p.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
      return { url: canvas.toDataURL('image/webp', 0.86), pages: doc.numPages };
    } finally {
      releasePdf(path);
    }
  } catch {
    return null;
  }
}
