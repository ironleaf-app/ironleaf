// Moving around a canvas and what it shows at each zoom (pure, so it can be tested without a window):
// - how a wheel event is meant: a trackpad's two-finger scroll pans, a pinch (Chromium sends it as Ctrl+wheel with small
//   steps) zooms smoothly, a mouse wheel's notch with Ctrl zooms a step;
// - an eased move from one view to another that keeps a point of the screen still (zooming around the pointer);
// - two fingers on a touch screen: zoom and move together around the point between them;
// - the levels of detail: the whole card from about a third of full size up, below that an overview (each card its title,
//   sized to fit, over quiet lines in its colour); one hands over to the other at a single zoom with a short fade (never
//   both at once, which reads as two layers of words);
// - where each group's name goes so names stay readable at every zoom and never sit on top of each other.

export type View = { x: number; y: number; k: number };
export type Box = { x: number; y: number; width: number; height: number };

export const ZOOM_MIN = 0.06;
export const ZOOM_MAX = 4;
export const clampZoom = (k: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

// ── Levels of detail ─────────────────────────────────────────────────────────────────────────────────────────────

/** Below this zoom a card shows its overview; at and above it, the whole card. */
export const OVERVIEW_BELOW = 0.35;
/** A group's name is never drawn smaller than this on screen (px). */
export const LABEL_MIN_PX = 12;
/** A group's name at full size (px, in the canvas's own units). */
export const LABEL_PX = 15;

export interface Levels {
  /** The whole card is drawn (else its overview). */
  detail: boolean;
  /** How much a group's name is enlarged so it stays readable (1 at and above 80%). It changes smoothly with the zoom. */
  labelScale: number;
}

/** The zoom as the styles see it (--k): exact far out, where cards are light; in steps of 5% nearer in, where each card
 * holds a lot and a new value restyles every one of them (the lines and the selection's ring only need it roughly). */
export function styleZoom(k: number): number {
  if (k < OVERVIEW_BELOW) return k;
  return k >= 1 ? 1 : Math.floor(k * 20) / 20;
}

export function levels(k: number): Levels {
  return { detail: k >= OVERVIEW_BELOW, labelScale: Math.max(1, LABEL_MIN_PX / (LABEL_PX * k)) };
}

// ── The wheel ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type WheelIntent = { kind: 'zoom'; factor: number; step: boolean } | { kind: 'pan'; dx: number; dy: number };

/** A mouse wheel's notch (as opposed to a pinch's fine steps): whole lines, or one big step (100 px at 100%, about 67
 * or 125 at other display scales). */
const isNotch = (e: WheelLike) => e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 40 && Math.abs(e.deltaX) < 1);

export function wheelIntent(e: WheelLike): WheelIntent {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  if (e.ctrlKey || e.metaKey) {
    // A notch zooms a fifth; a pinch follows the fingers (its steps are the change in scale, in hundredths).
    if (isNotch(e)) return { kind: 'zoom', factor: e.deltaY < 0 ? 1.2 : 1 / 1.2, step: true };
    const d = Math.max(-40, Math.min(40, e.deltaY * unit));
    return { kind: 'zoom', factor: Math.exp(-d * 0.01), step: false };
  }
  const dx = e.deltaX * unit;
  const dy = e.deltaY * unit;
  // Shift with a mouse wheel moves sideways.
  if (e.shiftKey && !dx) return { kind: 'pan', dx: dy, dy: 0 };
  return { kind: 'pan', dx, dy };
}

/** The view after zooming by `factor` around a point of the surface (px from its top-left). */
export function zoomAround(v: View, factor: number, at: { x: number; y: number }): View {
  const k = clampZoom(v.k * factor);
  const wx = (at.x - v.x) / v.k;
  const wy = (at.y - v.y) / v.k;
  return { k, x: at.x - wx * k, y: at.y - wy * k };
}

// ── Easing ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** Part way (`e`, 0 to 1) from one view to another. Zoom changes evenly (by ratio), and the point of the surface at
 * `anchor` moves in a straight line, so zooming around the pointer keeps the thing under it still. */
export function between(from: View, to: View, e: number, anchor: { x: number; y: number }): View {
  if (e >= 1) return to;
  const k = from.k * Math.pow(to.k / from.k, e);
  const w0 = { x: (anchor.x - from.x) / from.k, y: (anchor.y - from.y) / from.k };
  const w1 = { x: (anchor.x - to.x) / to.k, y: (anchor.y - to.y) / to.k };
  const wx = w0.x + (w1.x - w0.x) * e;
  const wy = w0.y + (w1.y - w0.y) * e;
  return { k, x: anchor.x - wx * k, y: anchor.y - wy * k };
}

// ── Two fingers ──────────────────────────────────────────────────────────────────────────────────────────────────

type Pt = { x: number; y: number };

/** The view while two fingers move: the canvas point that was between them at the start stays between them, and the
 * zoom follows how far apart they are. Points are px from the surface's top-left. */
export function pinchView(start: View, a0: Pt, b0: Pt, a1: Pt, b1: Pt): View {
  const d0 = Math.max(1, Math.hypot(b0.x - a0.x, b0.y - a0.y));
  const d1 = Math.max(1, Math.hypot(b1.x - a1.x, b1.y - a1.y));
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const k = clampZoom(start.k * (d1 / d0));
  const wx = (m0.x - start.x) / start.k;
  const wy = (m0.y - start.y) / start.k;
  return { k, x: m1.x - wx * k, y: m1.y - wy * k };
}

// ── Keys ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How far an arrow key moves the view (px): a short step, or with Shift most of a screen. */
export function arrowPan(key: string, shift: boolean, surface: { width: number; height: number }): { dx: number; dy: number } | null {
  const sx = shift ? Math.round(surface.width * 0.6) : 90;
  const sy = shift ? Math.round(surface.height * 0.6) : 90;
  // The view moves the way the arrow points (what's to the right comes into sight).
  if (key === 'ArrowLeft') return { dx: sx, dy: 0 };
  if (key === 'ArrowRight') return { dx: -sx, dy: 0 };
  if (key === 'ArrowUp') return { dx: 0, dy: sy };
  if (key === 'ArrowDown') return { dx: 0, dy: -sy };
  return null;
}

// ── Group names ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface LabelGroup extends Box {
  id: string;
  /** The name's natural width, in the name's own px (at LABEL_PX). */
  natural: number;
  /** The least of it worth showing (a few letters and its count); less than that and the name isn't shown. */
  least?: number;
}
export interface LabelFit {
  /** Above the group (the usual place), inside its top-left corner (no room above), or not shown (no room at all). */
  place: 'above' | 'inside' | 'none';
  /** The widest the name may be, in its own px; longer names end in an ellipsis. */
  max: number;
  /** How much the name is enlarged (levels().labelScale), so it reads at the same size on screen. */
  scale: number;
}

const hits = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const within = (n: Box, g: Box) => n.x >= g.x - 1 && n.y >= g.y - 1 && n.x + n.width <= g.x + g.width + 1 && n.y + n.height <= g.y + g.height + 1;

/** The name's height and gaps (its own px). */
const ROW = 26;
const GAP = 8;
const MIN_CHARS_W = 52;

/** Where each group's name goes at zoom `k`. A name sits above its group when there's room there (it may run to the
 * right until it meets another card); else inside the group's top-left corner; else (a tiny group far out) not at all.
 * Names never overlap: bigger groups are placed first. Every size is in canvas units. */
export function fitGroupLabels(groups: LabelGroup[], nodes: (Box & { id: string })[], k: number): Map<string, LabelFit> {
  const s = levels(k).labelScale;
  const row = ROW * s;
  const gap = GAP * s;
  const placed: Box[] = [];
  const out = new Map<string, LabelFit>();
  const order = [...groups].sort((a, b) => b.width * b.height - a.width * a.height);
  for (const g of order) {
    const want = g.natural * s;
    const least = Math.min(want, (g.least ?? MIN_CHARS_W) * s);
    // Above: the band just over the group, as far right as it's free.
    const band = { x: g.x, y: g.y - gap - row, width: want, height: row };
    // What's inside the group, and groups around it, don't block its name.
    const blockers = [...nodes.filter((n) => n.id !== g.id && !within(n, g) && !within(g, n)), ...placed];
    let room = want;
    let blocked = false;
    for (const o of blockers) {
      if (!(o.y < band.y + band.height && o.y + o.height > band.y)) continue;
      if (o.x + o.width <= g.x || o.x >= g.x + want) continue;
      if (o.x <= g.x + least) {
        blocked = true;
        break;
      }
      room = Math.min(room, o.x - g.x - gap);
    }
    if (!blocked && room >= least) {
      placed.push({ ...band, width: room });
      out.set(g.id, { place: 'above', max: Math.floor(room / s), scale: s });
      continue;
    }
    // Inside the top-left corner, over the group's own cards (it has its own backing there).
    const pad = 6 * s;
    const inner = { x: g.x + pad, y: g.y + pad, width: Math.min(want, g.width - 2 * pad), height: row };
    if (inner.width >= least && g.height >= row + 2 * pad && !placed.some((p) => hits(p, inner))) {
      placed.push(inner);
      out.set(g.id, { place: 'inside', max: Math.floor(inner.width / s), scale: s });
      continue;
    }
    out.set(g.id, { place: 'none', max: 0, scale: s });
  }
  return out;
}
