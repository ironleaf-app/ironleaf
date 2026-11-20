// The PDF reader's arithmetic, apart from the screen so the tests can check it (19 Oct 2026, 5.0.0 PDF reader):
// turning boxes on the screen into the PDF's own units and back (highlights are kept in the PDF's units, so they sit
// over the same words at any zoom and on any PC), tidying a selection's boxes into one per line, zoom sizes, and
// finding words in a document's text. No imports.

/** A page's place-to-screen sum, as PDF.js gives it (viewport.transform): screen = [a c e; b d f] · pdf. */
export type Matrix = [number, number, number, number, number, number];

/** A box on the screen, measured from the page's top left in CSS pixels. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 100% is a page at its printed size: PDF points are 1/72 inch, the screen's CSS pixels 1/96. */
export const CSS_PER_POINT = 96 / 72;

/**
 * The same sum PDF.js makes for a page shown at `scale` and turned by `rotation` (PageViewport): the tests check our
 * boxes against it, and the reader uses PDF.js's own copy so the words, the drawing and the highlights always agree.
 */
export function viewportMatrix(viewBox: [number, number, number, number], scale: number, rotation = 0, userUnit = 1): { matrix: Matrix; width: number; height: number } {
  const s = scale * userUnit;
  const cx = (viewBox[2] + viewBox[0]) / 2;
  const cy = (viewBox[3] + viewBox[1]) / 2;
  const r = ((rotation % 360) + 360) % 360;
  const [a, b, c, d] = r === 90 ? [0, 1, 1, 0] : r === 180 ? [-1, 0, 0, 1] : r === 270 ? [0, -1, -1, 0] : [1, 0, 0, -1];
  let ox: number, oy: number, width: number, height: number;
  if (a === 0) {
    ox = Math.abs(cy - viewBox[1]) * s;
    oy = Math.abs(cx - viewBox[0]) * s;
    width = (viewBox[3] - viewBox[1]) * s;
    height = (viewBox[2] - viewBox[0]) * s;
  } else {
    ox = Math.abs(cx - viewBox[0]) * s;
    oy = Math.abs(cy - viewBox[1]) * s;
    width = (viewBox[2] - viewBox[0]) * s;
    height = (viewBox[3] - viewBox[1]) * s;
  }
  return { matrix: [a * s, b * s, c * s, d * s, ox - a * s * cx - c * s * cy, oy - b * s * cx - d * s * cy], width, height };
}

/** A point in the PDF's units, on the screen. */
export function toScreen(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** A point on the screen, in the PDF's units. */
export function toPdf(m: Matrix, x: number, y: number): [number, number] {
  const det = m[0] * m[3] - m[1] * m[2] || 1;
  const dx = x - m[4];
  const dy = y - m[5];
  return [(m[3] * dx - m[2] * dy) / det, (m[0] * dy - m[1] * dx) / det];
}

/** A box on the screen as a box in the PDF's units (x1 < x2, y1 < y2). */
export function boxToPdf(m: Matrix, box: Box): [number, number, number, number] {
  const [x1, y1] = toPdf(m, box.left, box.top);
  const [x2, y2] = toPdf(m, box.right, box.bottom);
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

/** A box in the PDF's units as a box on the screen. */
export function pdfToBox(m: Matrix, r: readonly number[]): Box {
  const [x1, y1] = toScreen(m, r[0], r[1]);
  const [x2, y2] = toScreen(m, r[2], r[3]);
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
}

/**
 * A selection's boxes, one per stretch of a line: the browser gives one per run of text, often overlapping or with
 * hairline gaps, which would draw as patchy, darker stripes. Boxes on the same line (sharing most of their height) that
 * touch or nearly touch become one; empty ones go.
 */
export function mergeLineBoxes(boxes: Box[]): Box[] {
  const list = boxes.filter((b) => b.right - b.left > 0.5 && b.bottom - b.top > 0.5).sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: Box[][] = [];
  for (const b of list) {
    const h = b.bottom - b.top;
    const line = lines.find((l) => {
      const f = l[0];
      const overlap = Math.min(f.bottom, b.bottom) - Math.max(f.top, b.top);
      return overlap > 0.5 * Math.min(h, f.bottom - f.top);
    });
    if (line) line.push(b);
    else lines.push([b]);
  }
  const out: Box[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.left - b.left);
    let cur = { ...line[0] };
    for (const b of line.slice(1)) {
      const gap = b.left - cur.right;
      if (gap <= 0.6 * Math.min(b.bottom - b.top, cur.bottom - cur.top)) {
        cur = { left: Math.min(cur.left, b.left), top: Math.min(cur.top, b.top), right: Math.max(cur.right, b.right), bottom: Math.max(cur.bottom, b.bottom) };
      } else {
        out.push(cur);
        cur = { ...b };
      }
    }
    out.push(cur);
  }
  return out.sort((a, b) => a.top - b.top || a.left - b.left);
}

export type Zoom = 'width' | 'page' | number;

/**
 * The scale a page is drawn at: fit to the width of the reading area, the whole page in view, or a percentage of its
 * printed size. `w` and `h` are the page's size in points; `boxW` and `boxH` the room for it in CSS pixels.
 */
export function scaleFor(zoom: Zoom, w: number, h: number, boxW: number, boxH: number): number {
  const width = Math.max(1, boxW) / Math.max(1, w);
  if (zoom === 'width') return clampScale(width);
  if (zoom === 'page') return clampScale(Math.min(width, Math.max(1, boxH) / Math.max(1, h)));
  return clampScale((zoom / 100) * CSS_PER_POINT);
}

/** Never smaller than a quarter of printed size, nor bigger than five times. */
export const clampScale = (s: number) => Math.min(5 * CSS_PER_POINT, Math.max(0.25 * CSS_PER_POINT, s));

/** The steps Zoom in and Zoom out move between, as percentages. */
export const ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];

/** The next zoom step in or out from a scale (as a percentage). */
export function stepZoom(scale: number, dir: 1 | -1): number {
  const pct = (scale / CSS_PER_POINT) * 100;
  if (dir > 0) return ZOOM_STEPS.find((z) => z > pct + 0.5) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((z) => z < pct - 0.5) ?? ZOOM_STEPS[0];
}

/** A page's words as one string, and where each run of text starts in it (runs ending a line are followed by a space). */
export interface PageText {
  text: string;
  starts: number[];
  lengths: number[];
}

export function pageText(items: readonly { str?: string; hasEOL?: boolean }[]): PageText {
  let text = '';
  const starts: number[] = [];
  const lengths: number[] = [];
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    starts.push(text.length);
    lengths.push(item.str.length);
    text += item.str;
    if (item.hasEOL && !/\s$/.test(item.str)) text += ' ';
  }
  return { text, starts, lengths };
}

/**
 * Recognised lines as a page's words (the scanned-page layer): one run per line, in order, each ending its line, so
 * selecting, copying and finding work the same as on a page with words. The layer draws one span per line in the same
 * order, so find marks land on the right letters.
 */
export function ocrPageText(lines: readonly { text: string }[]): PageText {
  return pageText(lines.map((l) => ({ str: l.text, hasEOL: true })));
}

export interface Match {
  /** Counted from 0. */
  page: number;
  start: number;
  end: number;
}

/** Every place the words appear, page by page, ignoring capitals and how many spaces sit between words. */
export function findAll(pages: readonly string[], query: string, limit = 5000): Match[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(escaped.join('\\s+'), 'giu');
  const out: Match[] = [];
  pages.forEach((text, page) => {
    for (const m of text.matchAll(re)) {
      if (!m[0].length) continue;
      out.push({ page, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
      if (out.length >= limit) return;
    }
  });
  return out.slice(0, limit);
}

/**
 * Where a place in a page's string falls in its runs of text: the run and the letter in it. A place on a space added
 * between runs moves to the start of the next run (`edge` 'start') or the end of the run before (`edge` 'end').
 */
export function locate(t: PageText, offset: number, edge: 'start' | 'end'): { item: number; char: number } | null {
  if (!t.starts.length) return null;
  let lo = 0;
  let hi = t.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  const inside = offset - t.starts[lo];
  if (edge === 'end') {
    // The end of a match sits just past its last letter: in this run when that letter is.
    if (inside > 0 && inside <= t.lengths[lo]) return { item: lo, char: inside };
    if (inside === 0 && lo > 0) return { item: lo - 1, char: t.lengths[lo - 1] };
    return { item: lo, char: Math.min(inside, t.lengths[lo]) };
  }
  if (inside < t.lengths[lo]) return { item: lo, char: Math.max(0, inside) };
  return lo + 1 < t.starts.length ? { item: lo + 1, char: 0 } : { item: lo, char: t.lengths[lo] };
}
