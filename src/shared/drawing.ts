// Drawings (21 Oct 2026, gap G23): freehand strokes with pen pressure, rectangles, ellipses, arrows, lines and text
// labels, kept in a .nvdraw file of their own — plain JSON in Ironleaf's own small open format (docs/DRAWING-FORMAT.md),
// written from scratch. A canvas shows a drawing as an ordinary JSON Canvas file node ({"type": "file", "file":
// "Sketch.nvdraw"}), so .canvas files stay valid for every other app that reads them.
//
// Pure functions shared by the window and the tests: reading and writing the file, the geometry the drawing surface
// needs (bounds, what the pointer is over, moving), a pressure-shaped outline for a stroke, the drawing as SVG (for its
// card on a canvas and for Export as SVG or PNG) and the undo history.

export const DRAWING_EXT = '.nvdraw';
export const DRAWING_TYPE = 'neuralvault-drawing';
export const DRAWING_VERSION = 1;
export const isDrawingPath = (p: string | undefined | null): boolean => !!p && /\.nvdraw$/i.test(p);

/** The named colours (each drawn in the light or dark look's own shade), or a #rrggbb of the person's own. */
export const DRAW_COLOURS = ['ink', 'red', 'orange', 'green', 'blue', 'violet'] as const;
export type NamedColour = (typeof DRAW_COLOURS)[number];
export type DrawColour = NamedColour | string;

export const COLOUR_WORDS: Record<NamedColour, string> = { ink: 'Ink', red: 'Red', orange: 'Orange', green: 'Green', blue: 'Blue', violet: 'Violet' };

/** Each named colour in the light and the dark look (the same families as Ironleaf's highlights, deep enough to read). */
export const DRAW_PALETTE: Record<'light' | 'dark', Record<NamedColour, string>> = {
  light: { ink: '#1f1e1d', red: '#b0422f', orange: '#b8692a', green: '#3f7a49', blue: '#33628f', violet: '#6b4ea0' },
  dark: { ink: '#ece9e1', red: '#e88573', orange: '#e8a46c', green: '#8fcb95', blue: '#8db8e6', violet: '#b9a0e6' },
};

export interface StrokeElement {
  id: string;
  kind: 'stroke';
  /** [x, y, pressure 0–1] for each point (a mouse gives 0.5). */
  points: [number, number, number][];
  colour: DrawColour;
  /** The pen's width at full pressure. */
  width: number;
}
export interface BoxElement {
  id: string;
  kind: 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  colour: DrawColour;
  width: number;
  /** Filled with a soft wash of its colour. */
  fill?: boolean;
}
export interface LineElement {
  id: string;
  kind: 'line' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  colour: DrawColour;
  width: number;
}
export interface TextElement {
  id: string;
  kind: 'text';
  /** The top-left corner of the first line. */
  x: number;
  y: number;
  text: string;
  /** The letters' size in drawing units. */
  size: number;
  colour: DrawColour;
}
export type DrawElement = StrokeElement | BoxElement | LineElement | TextElement;
export type DrawKind = DrawElement['kind'];

export interface Drawing {
  type: typeof DRAWING_TYPE;
  version: number;
  elements: DrawElement[];
  /** Keys this version doesn't use, kept as they were (a later version's, another app's). */
  extra?: Record<string, unknown>;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class DrawingProblem extends Error {}

export const emptyDrawing = (): Drawing => ({ type: DRAWING_TYPE, version: DRAWING_VERSION, elements: [] });

// ── Reading and writing ───────────────────────────────────────────────────────────────────────────────────────────

const MAX_ELEMENTS = 20_000;
const MAX_POINTS = 20_000;
const LIMIT = 1e7;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMIT ? v : null);
const pos = (v: unknown, fallback: number, max = 400): number => {
  const n = num(v);
  return n === null || n <= 0 ? fallback : Math.min(n, max);
};
const round = (n: number, places = 2): number => {
  const f = 10 ** places;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/** A colour as kept: a named one, or #rrggbb (#rgb widened); anything else is ink. */
export function cleanColour(v: unknown): DrawColour {
  if (typeof v !== 'string') return 'ink';
  const s = v.trim().toLowerCase();
  if ((DRAW_COLOURS as readonly string[]).includes(s)) return s;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : 'ink';
}

let counter = 0;
/** A short id, unique within a drawing. */
export function newId(taken?: Set<string>): string {
  for (;;) {
    const id = `${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    if (!taken?.has(id)) return id;
  }
}

/** One element as kept, or null when it can't be read (it is left out, never guessed). */
export function cleanElement(raw: unknown, taken: Set<string>): DrawElement | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  let id = typeof r.id === 'string' && /^[\w-]{1,64}$/.test(r.id) ? r.id : newId(taken);
  if (taken.has(id)) id = newId(taken);
  const colour = cleanColour(r.colour ?? r.color);
  let el: DrawElement | null = null;
  switch (r.kind) {
    case 'stroke': {
      if (!Array.isArray(r.points)) return null;
      const points: [number, number, number][] = [];
      for (const p of r.points.slice(0, MAX_POINTS)) {
        if (!Array.isArray(p)) continue;
        const x = num(p[0]);
        const y = num(p[1]);
        if (x === null || y === null) continue;
        const pr = num(p[2]);
        points.push([x, y, pr === null ? 0.5 : Math.min(1, Math.max(0, pr))]);
      }
      if (!points.length) return null;
      el = { id, kind: 'stroke', points, colour, width: pos(r.width, 3, 200) };
      break;
    }
    case 'rect':
    case 'ellipse': {
      const x = num(r.x);
      const y = num(r.y);
      const w = num(r.w);
      const h = num(r.h);
      if (x === null || y === null || w === null || h === null) return null;
      // A box drawn up or to the left is kept with its corner at the top left.
      el = { id, kind: r.kind, x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h), colour, width: pos(r.width, 2, 200), ...(r.fill === true ? { fill: true } : {}) };
      break;
    }
    case 'line':
    case 'arrow': {
      const x1 = num(r.x1);
      const y1 = num(r.y1);
      const x2 = num(r.x2);
      const y2 = num(r.y2);
      if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
      el = { id, kind: r.kind, x1, y1, x2, y2, colour, width: pos(r.width, 2, 200) };
      break;
    }
    case 'text': {
      const x = num(r.x);
      const y = num(r.y);
      if (x === null || y === null || typeof r.text !== 'string') return null;
      const text = r.text.replace(/\r\n?/g, '\n').slice(0, 10_000);
      if (!text.trim()) return null;
      el = { id, kind: 'text', x, y, text, size: pos(r.size, 20, 400), colour };
      break;
    }
    default:
      return null;
  }
  taken.add(id);
  return el;
}

/** A drawing file's words read. Blank words are an empty drawing; words that aren't a drawing throw (the file is never
 *  written over with a guess). Elements that can't be read are left out and counted in `skipped`. */
export function parseDrawing(text: string): Drawing & { skipped: number } {
  const trimmed = text.replace(/^﻿/, '').trim();
  if (!trimmed) return { ...emptyDrawing(), skipped: 0 };
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new DrawingProblem('This drawing’s file can’t be read: it isn’t JSON. Earlier versions of it may be in File recovery.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new DrawingProblem('This file isn’t a drawing.');
  const r = raw as Record<string, unknown>;
  if (r.type !== undefined && r.type !== DRAWING_TYPE) throw new DrawingProblem('This file isn’t an Ironleaf drawing.');
  const version = typeof r.version === 'number' && Number.isInteger(r.version) && r.version > 0 ? r.version : DRAWING_VERSION;
  const list = Array.isArray(r.elements) ? r.elements : [];
  const taken = new Set<string>();
  const elements: DrawElement[] = [];
  let skipped = 0;
  for (const item of list.slice(0, MAX_ELEMENTS)) {
    const el = cleanElement(item, taken);
    if (el) elements.push(el);
    else skipped++;
  }
  skipped += Math.max(0, list.length - MAX_ELEMENTS);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (k !== 'type' && k !== 'version' && k !== 'elements') extra[k] = v;
  return { type: DRAWING_TYPE, version, elements, ...(Object.keys(extra).length ? { extra } : {}), skipped };
}

function elementJson(el: DrawElement): Record<string, unknown> {
  switch (el.kind) {
    case 'stroke':
      return { id: el.id, kind: el.kind, colour: el.colour, width: round(el.width), points: el.points.map(([x, y, p]) => [round(x), round(y), round(p, 3)]) };
    case 'rect':
    case 'ellipse':
      return { id: el.id, kind: el.kind, x: round(el.x), y: round(el.y), w: round(el.w), h: round(el.h), colour: el.colour, width: round(el.width), ...(el.fill ? { fill: true } : {}) };
    case 'line':
    case 'arrow':
      return { id: el.id, kind: el.kind, x1: round(el.x1), y1: round(el.y1), x2: round(el.x2), y2: round(el.y2), colour: el.colour, width: round(el.width) };
    case 'text':
      return { id: el.id, kind: el.kind, x: round(el.x), y: round(el.y), size: round(el.size), colour: el.colour, text: el.text };
  }
}

/** The file's words: the drawing's keys first, then one element a line (a long stroke stays one line, so the file reads
 *  and compares well), numbers to two places. */
export function serializeDrawing(d: Pick<Drawing, 'elements' | 'extra' | 'version'>): string {
  const head: Record<string, unknown> = { type: DRAWING_TYPE, version: Math.max(DRAWING_VERSION, d.version ?? DRAWING_VERSION), ...(d.extra ?? {}) };
  const lines = Object.entries(head).map(([k, v]) => `\t${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const els = d.elements.map((el) => `\t\t${JSON.stringify(elementJson(el))}`);
  lines.push(els.length ? `\t"elements": [\n${els.join(',\n')}\n\t]` : '\t"elements": []');
  return `{\n${lines.join(',\n')}\n}\n`;
}

/** The words of a new, empty drawing. */
export const newDrawingText = (): string => serializeDrawing(emptyDrawing());

/** The element as it would be read back from the file (numbers rounded as written). */
export const settled = (el: DrawElement): DrawElement => cleanElement(elementJson(el), new Set())!;

// ── Geometry ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** How wide a text label's lines are, near enough, in drawing units (the app's sans at this size). */
export function textBox(el: Pick<TextElement, 'x' | 'y' | 'text' | 'size'>): Box {
  const lines = el.text.split('\n');
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return { x: el.x, y: el.y, w: longest * el.size * 0.56, h: lines.length * el.size * 1.3 };
}

export function elementBounds(el: DrawElement): Box {
  switch (el.kind) {
    case 'stroke': {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [x, y] of el.points) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      const r = el.width / 2;
      return { x: x0 - r, y: y0 - r, w: x1 - x0 + 2 * r, h: y1 - y0 + 2 * r };
    }
    case 'rect':
    case 'ellipse':
      return { x: el.x - el.width / 2, y: el.y - el.width / 2, w: el.w + el.width, h: el.h + el.width };
    case 'line':
    case 'arrow': {
      const pad = el.kind === 'arrow' ? headSize(el.width) : el.width / 2;
      return { x: Math.min(el.x1, el.x2) - pad, y: Math.min(el.y1, el.y2) - pad, w: Math.abs(el.x2 - el.x1) + 2 * pad, h: Math.abs(el.y2 - el.y1) + 2 * pad };
    }
    case 'text':
      return textBox(el);
  }
}

/** Every element's bounds together (null for an empty drawing). */
export function drawingBounds(elements: DrawElement[]): Box | null {
  if (!elements.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const el of elements) {
    const b = elementBounds(el);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether a point (drawing units) is on an element, within `tolerance`. A filled box counts inside; an empty one only
 *  near its line, so what is drawn inside it can still be picked. */
export function hitTest(el: DrawElement, x: number, y: number, tolerance = 4): boolean {
  switch (el.kind) {
    case 'stroke': {
      const r = el.width / 2 + tolerance;
      if (el.points.length === 1) return Math.hypot(x - el.points[0][0], y - el.points[0][1]) <= r;
      for (let i = 1; i < el.points.length; i++) if (segmentDistance(x, y, el.points[i - 1][0], el.points[i - 1][1], el.points[i][0], el.points[i][1]) <= r) return true;
      return false;
    }
    case 'rect': {
      const t = el.width / 2 + tolerance;
      const inside = x >= el.x && x <= el.x + el.w && y >= el.y && y <= el.y + el.h;
      if (el.fill && inside) return true;
      const outer = x >= el.x - t && x <= el.x + el.w + t && y >= el.y - t && y <= el.y + el.h + t;
      const inner = x > el.x + t && x < el.x + el.w - t && y > el.y + t && y < el.y + el.h - t;
      return outer && !inner;
    }
    case 'ellipse': {
      const rx = el.w / 2;
      const ry = el.h / 2;
      const cx = el.x + rx;
      const cy = el.y + ry;
      if (rx < 1 || ry < 1) return Math.hypot(x - cx, y - cy) <= Math.max(rx, ry) + tolerance;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (el.fill && d <= 1) return true;
      const band = (el.width / 2 + tolerance) / Math.min(rx, ry);
      return Math.abs(d - 1) <= band;
    }
    case 'line':
    case 'arrow':
      return segmentDistance(x, y, el.x1, el.y1, el.x2, el.y2) <= el.width / 2 + tolerance;
    case 'text': {
      const b = textBox(el);
      return x >= b.x - tolerance && x <= b.x + b.w + tolerance && y >= b.y - tolerance && y <= b.y + b.h + tolerance;
    }
  }
}

/** The top-most element under a point, or null. */
export function elementAt(elements: DrawElement[], x: number, y: number, tolerance = 4): DrawElement | null {
  for (let i = elements.length - 1; i >= 0; i--) if (hitTest(elements[i], x, y, tolerance)) return elements[i];
  return null;
}

/** The elements whose bounds sit wholly inside a box (a drag-to-select). */
export function elementsInBox(elements: DrawElement[], box: Box): DrawElement[] {
  const x0 = Math.min(box.x, box.x + box.w);
  const y0 = Math.min(box.y, box.y + box.h);
  const x1 = Math.max(box.x, box.x + box.w);
  const y1 = Math.max(box.y, box.y + box.h);
  return elements.filter((el) => {
    const b = elementBounds(el);
    return b.x >= x0 && b.y >= y0 && b.x + b.w <= x1 && b.y + b.h <= y1;
  });
}

export function moveElement<T extends DrawElement>(el: T, dx: number, dy: number): T {
  switch (el.kind) {
    case 'stroke':
      return { ...el, points: el.points.map(([x, y, p]) => [x + dx, y + dy, p] as [number, number, number]) };
    case 'line':
    case 'arrow':
      return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
    default:
      return { ...el, x: (el as BoxElement | TextElement).x + dx, y: (el as BoxElement | TextElement).y + dy };
  }
}

/** A box from where a drag started to where it is (Shift: a square, or a circle). */
export function boxFrom(x0: number, y0: number, x1: number, y1: number, square = false): Box {
  let w = x1 - x0;
  let h = y1 - y0;
  if (square) {
    const s = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * s;
    h = Math.sign(h || 1) * s;
  }
  return { x: Math.min(x0, x0 + w), y: Math.min(y0, y0 + h), w: Math.abs(w), h: Math.abs(h) };
}

/** A line's end held to the nearest 15° (Shift while drawing). */
export function snapAngle(x0: number, y0: number, x1: number, y1: number): [number, number] {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.PI / 12;
  const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / step) * step;
  return [round(x0 + Math.cos(a) * len, 3), round(y0 + Math.sin(a) * len, 3)];
}

/** Points too close to the last one kept add nothing but size: a new point is kept only when it has moved. */
export function addPoint(points: [number, number, number][], x: number, y: number, pressure: number, minGap = 0.75): [number, number, number][] {
  const p = Math.min(1, Math.max(0, Number.isFinite(pressure) ? pressure : 0.5));
  const last = points[points.length - 1];
  if (last && Math.hypot(x - last[0], y - last[1]) < minGap) return points;
  return [...points, [x, y, p]];
}

const headSize = (width: number) => Math.max(10, width * 4);

/** An arrow's head: the two ends of its barbs. */
export function arrowHead(el: Pick<LineElement, 'x1' | 'y1' | 'x2' | 'y2' | 'width'>): [[number, number], [number, number]] {
  const a = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
  const len = Math.min(headSize(el.width), Math.hypot(el.x2 - el.x1, el.y2 - el.y1) * 0.6 || headSize(el.width));
  const spread = Math.PI / 7;
  return [
    [el.x2 - len * Math.cos(a - spread), el.y2 - len * Math.sin(a - spread)],
    [el.x2 - len * Math.cos(a + spread), el.y2 - len * Math.sin(a + spread)],
  ];
}

const f = (n: number) => String(round(n));

/** A stroke as one filled outline: wider where the pen pressed harder, thinner where it lifted, with round ends. */
export function strokeOutline(points: [number, number, number][], width: number): string {
  const radius = (p: number) => Math.max(0.35, (width * (0.3 + 0.7 * p)) / 2);
  if (!points.length) return '';
  if (points.length === 1) {
    const [x, y, p] = points[0];
    const r = radius(p);
    return `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
  }
  // Pressure eased over neighbours, so a pen's jitter doesn't show as lumps.
  const pr = points.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(points.length - 1, i + 2); j++) {
      sum += points[j][2];
      n++;
    }
    return sum / n;
  });
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const r = radius(pr[i]);
    left.push([points[i][0] - dy * r, points[i][1] + dx * r]);
    right.push([points[i][0] + dy * r, points[i][1] - dx * r]);
  }
  // Smooth curves through the midpoints of each side, from its first point (where the path already is).
  const curve = (pts: [number, number][]): string => {
    let d = '';
    for (let i = 1; i < pts.length - 1; i++) d += `Q${f(pts[i][0])} ${f(pts[i][1])} ${f((pts[i][0] + pts[i + 1][0]) / 2)} ${f((pts[i][1] + pts[i + 1][1]) / 2)}`;
    const last = pts[pts.length - 1];
    return `${d}L${f(last[0])} ${f(last[1])}`;
  };
  const endR = radius(pr[pr.length - 1]);
  const startR = radius(pr[0]);
  const back = [...right].reverse();
  return `M${f(left[0][0])} ${f(left[0][1])}${curve(left)}A${f(endR)} ${f(endR)} 0 0 1 ${f(back[0][0])} ${f(back[0][1])}${curve(back)}A${f(startR)} ${f(startR)} 0 0 1 ${f(left[0][0])} ${f(left[0][1])}Z`;
}

// ── As SVG ────────────────────────────────────────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A colour for SVG: the look's shade of a named colour (or the CSS token that holds it), else the hex as kept. */
export function colourFor(c: DrawColour, look: 'light' | 'dark' | 'css'): string {
  if (!(DRAW_COLOURS as readonly string[]).includes(c)) return /^#[0-9a-f]{6}$/i.test(c) ? c : DRAW_PALETTE.light.ink;
  return look === 'css' ? `var(--draw-${c})` : DRAW_PALETTE[look][c as NamedColour];
}

/** One element as SVG markup. */
export function elementSvg(el: DrawElement, look: 'light' | 'dark' | 'css'): string {
  const c = colourFor(el.colour, look);
  switch (el.kind) {
    case 'stroke':
      return `<path d="${strokeOutline(el.points, el.width)}" fill="${c}"/>`;
    case 'rect':
      return `<rect x="${f(el.x)}" y="${f(el.y)}" width="${f(el.w)}" height="${f(el.h)}" rx="${f(Math.min(6, el.w / 4, el.h / 4))}" fill="${el.fill ? c : 'none'}" fill-opacity="${el.fill ? 0.14 : 1}" stroke="${c}" stroke-width="${f(el.width)}" stroke-linejoin="round"/>`;
    case 'ellipse':
      return `<ellipse cx="${f(el.x + el.w / 2)}" cy="${f(el.y + el.h / 2)}" rx="${f(el.w / 2)}" ry="${f(el.h / 2)}" fill="${el.fill ? c : 'none'}" fill-opacity="${el.fill ? 0.14 : 1}" stroke="${c}" stroke-width="${f(el.width)}"/>`;
    case 'line':
      return `<line x1="${f(el.x1)}" y1="${f(el.y1)}" x2="${f(el.x2)}" y2="${f(el.y2)}" stroke="${c}" stroke-width="${f(el.width)}" stroke-linecap="round"/>`;
    case 'arrow': {
      const [a, b] = arrowHead(el);
      return `<path d="M${f(el.x1)} ${f(el.y1)}L${f(el.x2)} ${f(el.y2)}M${f(a[0])} ${f(a[1])}L${f(el.x2)} ${f(el.y2)}L${f(b[0])} ${f(b[1])}" fill="none" stroke="${c}" stroke-width="${f(el.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    case 'text': {
      const lines = el.text.split('\n');
      const spans = lines.map((l, i) => `<tspan x="${f(el.x)}" dy="${i === 0 ? f(el.size) : f(el.size * 1.3)}">${esc(l) || ' '}</tspan>`).join('');
      return `<text x="${f(el.x)}" y="${f(el.y)}" font-size="${f(el.size)}" font-family="Inter, 'Segoe UI', system-ui, sans-serif" fill="${c}" xml:space="preserve">${spans}</text>`;
    }
  }
}

/** The whole drawing as a standalone SVG, fitted to what is drawn with a margin. `look: 'css'` draws named colours with
 *  Ironleaf's --draw-* tokens (for a card in the window, which follows light and dark); 'light' or 'dark' writes the
 *  shades out (an exported file). `background` fills behind it (an export for a document); none leaves it clear. */
export function drawingToSvg(elements: DrawElement[], opts: { look?: 'light' | 'dark' | 'css'; background?: string | null; margin?: number; title?: string } = {}): string {
  const look = opts.look ?? 'light';
  const margin = opts.margin ?? 24;
  const b = drawingBounds(elements) ?? { x: 0, y: 0, w: 320, h: 200 };
  const x = b.x - margin;
  const y = b.y - margin;
  const w = Math.max(1, b.w + 2 * margin);
  const h = Math.max(1, b.h + 2 * margin);
  const bg = opts.background ? `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${esc(opts.background)}"/>` : '';
  const title = opts.title ? `<title>${esc(opts.title)}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x)} ${f(y)} ${f(w)} ${f(h)}" width="${Math.ceil(w)}" height="${Math.ceil(h)}">${title}${bg}${elements.map((el) => elementSvg(el, look)).join('')}</svg>`;
}

// ── On a canvas ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A drawing on a canvas: an ordinary JSON Canvas file node (whole numbers, as the format asks), so other apps read the
 *  .canvas as they always have and simply show a file there. */
export function drawingCanvasNode(file: string, at: { x: number; y: number }, id: string, size = { width: 420, height: 300 }): { id: string; type: 'file'; file: string; x: number; y: number; width: number; height: number } {
  return { id, type: 'file', file, x: Math.round(at.x), y: Math.round(at.y), width: Math.round(size.width), height: Math.round(size.height) };
}

// ── Undo and redo ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The drawing's history: each change keeps the elements as they were before it (the elements are never changed in
 *  place, so a step costs only the list). */
export class DrawHistory {
  private undos: DrawElement[][] = [];
  private redos: DrawElement[][] = [];
  constructor(private readonly limit = 200) {}
  /** Before a change: what was there. */
  push(before: DrawElement[]): void {
    this.undos.push(before);
    if (this.undos.length > this.limit) this.undos.shift();
    this.redos = [];
  }
  undo(now: DrawElement[]): DrawElement[] | null {
    const prev = this.undos.pop();
    if (!prev) return null;
    this.redos.push(now);
    return prev;
  }
  redo(now: DrawElement[]): DrawElement[] | null {
    const next = this.redos.pop();
    if (!next) return null;
    this.undos.push(now);
    return next;
  }
  get canUndo(): boolean {
    return this.undos.length > 0;
  }
  get canRedo(): boolean {
    return this.redos.length > 0;
  }
  clear(): void {
    this.undos = [];
    this.redos = [];
  }
}
