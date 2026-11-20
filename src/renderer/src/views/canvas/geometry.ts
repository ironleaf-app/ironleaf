// Canvas geometry, kept pure (tests/canvas-geometry.test.mjs): where a line leaves a card, how it's drawn (curved,
// straight or elbowed), snapping to the grid and to other cards' edges and centres (with the guide lines to show),
// resizing from any handle (Shift keeps the proportions), resizing several cards at once, aligning and spacing them.

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export type LineStyle = 'curved' | 'straight' | 'elbow';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface Guide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const GRID = 20;
export const MIN_W = 80;
export const MIN_H = 40;
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const snapGrid = (v: number, on: boolean) => (on ? Math.round(v / GRID) * GRID : Math.round(v));

export function bounds(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y };
}

export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export function anchor(n: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: n.x + n.width / 2, y: n.y };
    case 'bottom':
      return { x: n.x + n.width / 2, y: n.y + n.height };
    case 'left':
      return { x: n.x, y: n.y + n.height / 2 };
    default:
      return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
}

/** The side of `n` that faces a point (for lines written without sides). */
export function facing(n: Rect, p: Point): Side {
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  const dx = (p.x - cx) / (n.width / 2 || 1);
  const dy = (p.y - cy) / (n.height / 2 || 1);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top';
}

const out = (s: Side, d: number): [number, number] => (s === 'top' ? [0, -d] : s === 'bottom' ? [0, d] : s === 'left' ? [-d, 0] : [d, 0]);

/** A line's path between two anchors, and the middle of it (where its label sits). */
export function edgePath(a: Point, as: Side, b: Point, bs: Side, style: LineStyle = 'curved'): { d: string; mid: Point } {
  if (style === 'straight') return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  if (style === 'elbow') {
    const [ax, ay] = out(as, 24);
    const [bx, by] = out(bs, 24);
    const a1 = { x: a.x + ax, y: a.y + ay };
    const b1 = { x: b.x + bx, y: b.y + by };
    const pts: Point[] = [a, a1];
    if (as === 'left' || as === 'right') {
      const mx = (a1.x + b1.x) / 2;
      pts.push({ x: mx, y: a1.y }, { x: mx, y: b1.y });
    } else {
      const my = (a1.y + b1.y) / 2;
      pts.push({ x: a1.x, y: my }, { x: b1.x, y: my });
    }
    pts.push(b1, b);
    return { d: `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')}`, mid: { x: (pts[2].x + pts[3].x) / 2, y: (pts[2].y + pts[3].y) / 2 } };
  }
  const dist = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 2.5);
  const [ax, ay] = out(as, dist);
  const [bx, by] = out(bs, dist);
  const c1 = { x: a.x + ax, y: a.y + ay };
  const c2 = { x: b.x + bx, y: b.y + by };
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`, mid: { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 } };
}

const lines = (r: Rect) => ({ x: [r.x, r.x + r.width / 2, r.x + r.width], y: [r.y, r.y + r.height / 2, r.y + r.height] });

/**
 * Moving `box` (cards being dragged, as one) by a raw delta: snapped to another card's edge or centre when one is
 * within `threshold`, else to the grid (when on). The guide lines show what it lined up with.
 */
export function snapMove(box: Rect, dx: number, dy: number, others: Rect[], threshold: number, grid: boolean): { dx: number; dy: number; guides: Guide[] } {
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  const m = lines(moved);
  let bestX: { d: number; at: number; o: Rect } | null = null;
  let bestY: { d: number; at: number; o: Rect } | null = null;
  for (const o of others) {
    const t = lines(o);
    for (const a of m.x)
      for (const b of t.x) {
        const d = b - a;
        if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: b, o };
      }
    for (const a of m.y)
      for (const b of t.y) {
        const d = b - a;
        if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: b, o };
      }
  }
  let ndx = bestX ? dx + bestX.d : grid ? snapGrid(box.x + dx, true) - box.x : Math.round(dx);
  let ndy = bestY ? dy + bestY.d : grid ? snapGrid(box.y + dy, true) - box.y : Math.round(dy);
  ndx = Math.round(ndx * 100) / 100;
  ndy = Math.round(ndy * 100) / 100;
  const final = { ...box, x: box.x + ndx, y: box.y + ndy };
  const guides: Guide[] = [];
  if (bestX) {
    const y1 = Math.min(final.y, bestX.o.y);
    const y2 = Math.max(final.y + final.height, bestX.o.y + bestX.o.height);
    guides.push({ x1: bestX.at, y1, x2: bestX.at, y2 });
  }
  if (bestY) {
    const x1 = Math.min(final.x, bestY.o.x);
    const x2 = Math.max(final.x + final.width, bestY.o.x + bestY.o.width);
    guides.push({ x1, y1: bestY.at, x2, y2: bestY.at });
  }
  return { dx: ndx, dy: ndy, guides };
}

/**
 * A rectangle resized from one of its handles by a pointer delta: the edges the handle holds move (to another card's
 * edge or centre when close, else the grid), the others stay; Shift keeps the proportions; never smaller than the minimum.
 */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, opts: { keepRatio?: boolean; grid?: boolean; others?: Rect[]; threshold?: number; minW?: number; minH?: number } = {}): { rect: Rect; guides: Guide[] } {
  const minW = opts.minW ?? MIN_W;
  const minH = opts.minH ?? MIN_H;
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left += dx;
  if (handle.includes('e')) right += dx;
  if (handle.includes('n')) top += dy;
  if (handle.includes('s')) bottom += dy;
  const guides: Guide[] = [];
  const snapEdge = (v: number, axis: 'x' | 'y'): number => {
    let best: { d: number; at: number; o: Rect } | null = null;
    for (const o of opts.others ?? []) for (const t of lines(o)[axis]) if (Math.abs(t - v) <= (opts.threshold ?? 0) && (!best || Math.abs(t - v) < Math.abs(best.d))) best = { d: t - v, at: t, o };
    if (best) {
      const o = best.o;
      guides.push(axis === 'x' ? { x1: best.at, y1: Math.min(top, o.y), x2: best.at, y2: Math.max(bottom, o.y + o.height) } : { x1: Math.min(left, o.x), y1: best.at, x2: Math.max(right, o.x + o.width), y2: best.at });
      return best.at;
    }
    return snapGrid(v, !!opts.grid);
  };
  if (!opts.keepRatio) {
    if (handle.includes('w')) left = Math.min(snapEdge(left, 'x'), right - minW);
    if (handle.includes('e')) right = Math.max(snapEdge(right, 'x'), left + minW);
    if (handle.includes('n')) top = Math.min(snapEdge(top, 'y'), bottom - minH);
    if (handle.includes('s')) bottom = Math.max(snapEdge(bottom, 'y'), top + minH);
    return { rect: { x: left, y: top, width: right - left, height: bottom - top }, guides };
  }
  // Proportions kept: the larger change leads.
  const ratio = start.width / (start.height || 1);
  let w = Math.max(minW, right - left);
  let h = Math.max(minH, bottom - top);
  const horizontal = handle === 'e' || handle === 'w';
  const vertical = handle === 'n' || handle === 's';
  if (horizontal || (!vertical && Math.abs(w - start.width) / start.width >= Math.abs(h - start.height) / (start.height || 1))) h = w / ratio;
  else w = h * ratio;
  if (w < minW) {
    w = minW;
    h = w / ratio;
  }
  if (h < minH) {
    h = minH;
    w = h * ratio;
  }
  const x = handle.includes('w') ? start.x + start.width - w : vertical ? start.x + (start.width - w) / 2 : start.x;
  const y = handle.includes('n') ? start.y + start.height - h : horizontal ? start.y + (start.height - h) / 2 : start.y;
  return { rect: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) }, guides };
}

/** Several cards resized as one: each keeps its place and size within the box. */
export function scaleInto<T extends Rect>(items: T[], from: Rect, to: Rect): T[] {
  const sx = to.width / (from.width || 1);
  const sy = to.height / (from.height || 1);
  return items.map((n) => ({ ...n, x: Math.round(to.x + (n.x - from.x) * sx), y: Math.round(to.y + (n.y - from.y) * sy), width: Math.max(MIN_W, Math.round(n.width * sx)), height: Math.max(MIN_H, Math.round(n.height * sy)) }));
}

export type Alignment = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

/** Cards lined up along one edge (or their centres) of the box they make. */
export function align<T extends Rect>(items: T[], how: Alignment): T[] {
  const b = bounds(items);
  return items.map((n) => {
    switch (how) {
      case 'left':
        return { ...n, x: b.x };
      case 'right':
        return { ...n, x: b.x + b.width - n.width };
      case 'centre':
        return { ...n, x: Math.round(b.x + (b.width - n.width) / 2) };
      case 'top':
        return { ...n, y: b.y };
      case 'bottom':
        return { ...n, y: b.y + b.height - n.height };
      case 'middle':
        return { ...n, y: Math.round(b.y + (b.height - n.height) / 2) };
    }
  });
}

/** Cards spaced evenly across (or down) the box they make, the first and last staying where they are. */
export function distribute<T extends Rect & { id: string }>(items: T[], axis: 'x' | 'y'): T[] {
  if (items.length < 3) return items;
  const size = axis === 'x' ? 'width' : 'height';
  const sorted = [...items].sort((a, b) => a[axis] - b[axis]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = last[axis] + last[size] - first[axis];
  const total = sorted.reduce((t, n) => t + n[size], 0);
  const gap = (span - total) / (sorted.length - 1);
  let at = first[axis];
  const placed = new Map<string, number>();
  for (const n of sorted) {
    placed.set(n.id, Math.round(at));
    at += n[size] + gap;
  }
  return items.map((n) => ({ ...n, [axis]: placed.get(n.id)! }));
}

/** The view (pan and zoom) that shows `r` in a surface of the given size, with room around it. */
export function viewFor(r: Rect, surface: { width: number; height: number }, maxZoom = 1.2, pad = 80): { x: number; y: number; k: number } {
  const k = Math.min(maxZoom, Math.max(0.08, Math.min((surface.width - pad * 2) / Math.max(r.width, 1), (surface.height - pad * 2) / Math.max(r.height, 1))));
  return { k, x: surface.width / 2 - (r.x + r.width / 2) * k, y: surface.height / 2 - (r.y + r.height / 2) * k };
}

/**
 * Whether the view has drifted away from every card: none of them shows on the surface, not even a corner (a little
 * margin in on each side, so a sliver at the very edge counts as gone). The canvas then offers Back to content. (19 Oct
 * 2026: 5.0.0 polish; a person who pans off into empty space shouldn't have to hunt for their board.)
 */
export function driftedAway(cards: Rect[], view: { x: number; y: number; k: number }, surface: { width: number; height: number }, margin = 24): boolean {
  if (!cards.length || surface.width <= margin * 2 || surface.height <= margin * 2) return false;
  const seen: Rect = { x: (margin - view.x) / view.k, y: (margin - view.y) / view.k, width: (surface.width - margin * 2) / view.k, height: (surface.height - margin * 2) / view.k };
  return !cards.some((c) => intersects(c, seen));
}

/** How a board opens: all of it in view when it fits at a size that can be read; when showing all of it would make its
 * words too small to read (a wide portfolio, a big project), it opens at the least readable size instead, its top-left
 * corner in view (the map and Show everything show the rest). */
export function openingView(r: Rect, surface: { width: number; height: number }, readable = 0.5, pad = 80, top = 96): { x: number; y: number; k: number } {
  const fit = viewFor(r, surface, 1.2, pad);
  if (fit.k >= readable) return fit;
  const k = readable;
  const x = r.width * k <= surface.width - pad * 2 ? surface.width / 2 - (r.x + r.width / 2) * k : pad - r.x * k;
  const y = r.height * k <= surface.height - top - pad ? top + (surface.height - top - pad - r.height * k) / 2 - r.y * k : top - r.y * k;
  return { k, x, y };
}

/** The nearest free place for a new card around where it was wanted (so it doesn't land on top of another card). */
export function freeNear(rects: Rect[], want: Rect, step = 40): Point {
  const hit = (r: Rect) => rects.some((o) => intersects({ x: r.x - 16, y: r.y - 16, width: r.width + 32, height: r.height + 32 }, o));
  if (!hit(want)) return { x: want.x, y: want.y };
  for (let ring = 1; ring <= 40; ring++) {
    const spots: [number, number][] = [];
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) spots.push([dx, dy]);
    spots.sort((a, b) => Math.hypot(a[0], a[1] * 1.6) - Math.hypot(b[0], b[1] * 1.6));
    for (const [dx, dy] of spots) {
      const r = { ...want, x: want.x + dx * step, y: want.y + dy * step };
      if (!hit(r)) return { x: r.x, y: r.y };
    }
  }
  return { x: want.x, y: want.y };
}
