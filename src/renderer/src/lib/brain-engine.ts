// The brain graph's canvas engine (9 Nov 2026, the brain prototype). New files only (living-engine.ts is
// another job's): the layout arrives placed from shared/brain-graph.ts, so there is no simulation to settle -
// the still world (washes, curves, points, names) draws once to an offscreen layer and only redraws when the
// camera, lens, focus or selection moves; each frame then only composes that layer with what travels (click
// pulses, one hop then two). At rest the loop draws nothing at all. With reduce-motion on it is a still
// picture that still selects, walks and opens.

import {
  BRAIN_FOLD_HALF,
  brainLensMatch,
  type BrainCurve,
  type BrainLens,
  type BrainLobe,
  type BrainPlaced,
} from '../../../shared/brain-graph';
import {
  LIVING_ZOOM_MAX,
  fitLivingView,
  hitLivingNode,
  livingMotion,
  livingNeighbours,
  livingWheelFactor,
  resolveLivingLabels,
  type LivingLabel,
} from '../../../shared/living-graph';
import { plural } from '../../../shared/words';

export interface BrainSnapshotNode {
  id: string;
  title: string;
  x: number;
  y: number;
  r: number;
  /** The note's own graph only: 0 the middle, 1 its links, 2 the faint outer step. */
  hop?: 0 | 1 | 2;
}

export interface BrainSnapshot {
  trace: string[];
  frames: number;
  /** Frames that actually composed (rest frames are skipped, not drawn). */
  composed: number;
  nodes: BrainSnapshotNode[];
  count: number;
  links: number;
  centre: string | null;
  selected: string | null;
  hovered: string | null;
  pulses: number;
  reduced: boolean;
  lens: BrainLens;
  focus: string | null;
  /** Lit and dimmed under the lens and focus (the lens proof reads these). */
  lit: number;
  dimmed: number;
  cam: { cx: number; cy: number; k: number };
  taken: boolean;
  framed: boolean;
  /** Compose cost in ms over the recent ring (the honest speed numbers). */
  frameMs: { p50: number; p95: number; max: number; n: number };
  lobes: { area: string; name: string; x: number; y: number; w: number; h: number }[];
  labels: { id: string; x: number; y: number; w: number; h: number }[];
  view: { w: number; h: number };
}

interface Pulse {
  ax: number;
  ay: number;
  cx: number;
  cy: number;
  bx: number;
  by: number;
  from: string;
  colour: string;
  to: string;
  t0: number;
  dur: number;
  hop: 1 | 2;
  faint: boolean;
  spawned: boolean;
}

const BG = '#0a0e17';
const LABEL_INK = 'rgba(236,241,251,0.94)';
const HALO = 'rgba(5,7,13,0.9)';
const LINK_INK = 'rgba(148,163,184,0.14)';
const LINK_RECENT = 'rgba(170,186,210,0.22)';
const LINK_HOT = 'rgba(240,245,255,0.6)';
const DIM_TO = 0.28;
const LENS_DIM = 0.13;
const PULSE_CAP = 48;
const LABEL_CAP = 380;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** A colour lifted toward white (bright cores inside coloured glows). */
const lift = (hex: string, t: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
};

export class BrainEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private live: HTMLElement | null;
  private onOpen: (id: string, newTab: boolean) => void;
  private onSelect: (id: string | null) => void;
  private onCentre: ((id: string) => void) | null;
  private compact: boolean;
  private centreId: string | null = null;
  private nodes: BrainPlaced[] = [];
  private curves: BrainCurve[] = [];
  private lobes: BrainLobe[] = [];
  private looseAt = { x: 0, y: 0 };
  private bounds = { minX: -560, minY: -400, maxX: 560, maxY: 400 };
  private byId = new Map<string, BrainPlaced>();
  private adj = new Map<string, BrainCurve[]>();
  private lens: BrainLens = 'all';
  private focus: string | null = null;
  private cam = { cx: 0, cy: 0, k: 1 };
  private camTouched = false;
  private camAnim: { fx: number; fy: number; fk: number; tx: number; ty: number; tk: number; t0: number } | null = null;
  private zoomGoal: { k: number; cx: number; cy: number } | null = null;
  private hovered: string | null = null;
  private selected: string | null = null;
  private selIndex = -1;
  private pulses: Pulse[] = [];
  private flashUntil = new Map<string, number>();
  private sprites = new Map<string, HTMLCanvasElement>();
  // Title widths per font and title (the living graph's textW, 9 Nov 2026: up to LABEL_CAP measureTexts
  // every frame otherwise; the pan budget needs them cached too).
  private textW = new Map<string, number>();
  // The background and its vignette, drawn once per size and blitted per frame (the living graph's
  // bgLayer: a full-screen gradient fill every frame otherwise).
  private bgLayer: HTMLCanvasElement | null = null;
  // Static world decor (silhouette, lobe tints, fold), pre-rendered per layout and blitted per frame:
  // nine gradients and two wide strokes every frame otherwise. World rect, 1px per world unit.
  private decorLayer: HTMLCanvasElement | null = null;
  private decorBounds = { x: 0, y: 0, w: 1, h: 1 };
  private still: HTMLCanvasElement | null = null;
  private stillDirty = true;
  // The find, legend and view boxes, measured once per size or layout change (the living graph's
  // legendCache: measuring ran every frame otherwise; the pan budget needs them kept too).
  private uiBoxesCache: { x: number; y: number; w: number; h: number }[] | undefined = undefined;
  private w = 0;
  private h = 0;
  private dsf = 1;
  private raf = 0;
  private running = false;
  private reduced = false;
  private mql: MediaQueryList | null = null;
  private ambientAt = 0;
  private fontStack = 'system-ui, sans-serif';
  private frames = 0;
  private composed = 0;
  private costs: number[] = [];
  private ac = new AbortController();
  private ro: ResizeObserver | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchD = 0;
  private trace: string[] = [];
  private lastLabels: BrainSnapshot['labels'] = [];
  private lastLobes: BrainSnapshot['lobes'] = [];
  private downAt = 0;
  private downX = 0;
  private downY = 0;
  private moved = false;
  private panning = false;
  private laid = false;
  /** Keeps the graphics side awake while the graph rests (see the constructor). */
  private pilot: CanvasRenderingContext2D | null = null;
  private pilotTick = 0;

  constructor(
    canvas: HTMLCanvasElement,
    live: HTMLElement | null,
    opts: { compact?: boolean; onOpen(id: string, newTab: boolean): void; onSelect(id: string | null): void; onCentre?(id: string): void },
  ) {
    this.canvas = canvas;
    this.live = live;
    this.compact = !!opts.compact;
    this.onOpen = opts.onOpen;
    this.onSelect = opts.onSelect;
    this.onCentre = opts.onCentre ?? null;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    try {
      this.fontStack = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || this.fontStack;
    } catch {
      // A window without the app's type still draws.
    }
    const sig = this.ac.signal;
    // The pilot: a 4px canvas beside the graph, redrawn every resting frame while the window is in front
    // (10 Nov 2026, rings keep-awake, the living fix: the graphics side idling at rest made the next click
    // wait 200 to 470 ms; the pilot alone took 50 spaced clicks to no stalls, at near zero cost).
    try {
      const pilot = document.createElement('canvas');
      pilot.width = 4;
      pilot.height = 4;
      pilot.setAttribute('aria-hidden', 'true');
      pilot.className = 'bg-pilot';
      pilot.style.cssText = 'position:absolute;right:0;bottom:0;width:4px;height:4px;opacity:0.01;pointer-events:none';
      canvas.parentElement?.appendChild(pilot);
      this.pilot = pilot.getContext('2d');
      sig.addEventListener('abort', () => pilot.remove());
    } catch {
      this.pilot = null;
    }
    canvas.addEventListener('pointerdown', (e) => this.down(e), { signal: sig });
    canvas.addEventListener('pointermove', (e) => this.move(e), { signal: sig });
    canvas.addEventListener('pointerup', (e) => this.up(e), { signal: sig });
    canvas.addEventListener('pointercancel', (e) => this.up(e), { signal: sig });
    canvas.addEventListener('pointerleave', () => this.leave(), { signal: sig });
    canvas.addEventListener('wheel', (e) => this.wheel(e), { signal: sig, passive: false });
    canvas.addEventListener('dblclick', (e) => this.double(e), { signal: sig });
    canvas.addEventListener('keydown', (e) => this.keys(e), { signal: sig });
    document.addEventListener('visibilitychange', () => this.seen(), { signal: sig });
    if (typeof matchMedia === 'function') {
      this.mql = matchMedia('(prefers-reduced-motion: reduce)');
      this.reduced = !!this.mql.matches;
      this.mql.addEventListener('change', () => {
        this.reduced = !!this.mql?.matches;
        if (this.reduced) {
          this.pulses = [];
          this.camAnim = null;
          this.zoomGoal = null;
        }
        this.stillDirty = true;
      }, { signal: sig });
    }
    if (typeof ResizeObserver === 'function' && canvas.parentElement) {
      this.ro = new ResizeObserver(() => this.size());
      this.ro.observe(canvas.parentElement);
    }
    window.addEventListener('resize', () => this.size(), { signal: sig });
    this.size();
    this.buildDecor();
    this.loop();
  }

  destroy(): void {
    this.ac.abort();
    this.ro?.disconnect();
    cancelAnimationFrame(this.raf);
    this.running = false;
  }

  /** A kept camera put back after a remount (the shell keeps the taken view per graph): the camera
   *  lands whole and taken, with no glide or reframe under it. Anything unreadable is refused. */
  restoreCamera(cam: { cx: number; cy: number; k: number }): void {
    if (!Number.isFinite(cam.cx) || !Number.isFinite(cam.cy) || !Number.isFinite(cam.k)) return;
    this.cam = { cx: cam.cx, cy: cam.cy, k: cam.k };
    this.camTouched = true;
    this.camAnim = null;
    this.zoomGoal = null;
  }

  /** Open centred on a note (Ctrl+G or Centre here): the brain turns to it with its neighbourhood lit,
   *  silently (the card is for picked points, as in the living graph). The note's own small graph keeps its
   *  fitted zoom (t151): forcing 1.5x would crop its outer step off the 260px panel. */
  setCentre(id: string | null): void {
    if (this.centreId === id) return;
    this.centreId = id;
    if (!id || !this.byId.has(id)) return;
    this.selected = id;
    this.selIndex = -1;
    this.stillDirty = true;
    if (livingMotion(this.reduced).pulses) this.fire(id);
    const n = this.byId.get(id)!;
    this.flyTo(n.x, n.y, this.compact ? this.cam.k : Math.max(this.cam.k, 1.5), false);
  }

  /** The placed world (already laid out by the shell): positions stay with their ids, the camera holds. */
  setLayout(nodes: readonly BrainPlaced[], curves: readonly BrainCurve[], lobes: readonly BrainLobe[], looseAt: { x: number; y: number }): void {
    this.nodes = [...nodes];
    this.curves = [...curves];
    this.lobes = [...lobes];
    this.looseAt = { ...looseAt };
    this.byId = new Map(nodes.map((n) => [n.id, n]));
    this.adj = new Map();
    // Pushed, not spread (t102, 9 Nov 2026): each thread copied its point's whole list, quadratic on a hub.
    for (const c of curves) {
      const a = this.adj.get(c.source);
      if (a) a.push(c);
      else this.adj.set(c.source, [c]);
      const t = this.adj.get(c.target);
      if (t) t.push(c);
      else this.adj.set(c.target, [c]);
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.r);
      minY = Math.min(minY, n.y - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      maxY = Math.max(maxY, n.y + n.r);
    }
    if (nodes.length) this.bounds = { minX, minY, maxX, maxY };
    if (this.centreId && !this.byId.has(this.centreId)) this.centreId = null;
    if (this.selected && !this.byId.has(this.selected)) {
      this.selected = null;
      this.selIndex = -1;
      this.onSelect(null);
    }
    if (this.hovered && !this.byId.has(this.hovered)) this.hovered = null;
    if (this.focus && this.focus !== 'loose' && !this.lobes.some((l) => l.area === this.focus)) this.focus = null;
    this.buildDecor();
    this.uiBoxesCache = undefined;
    this.stillDirty = true;
    // First sight frames the whole brain at once; later layouts never move the camera under the person.
    if (!this.laid && nodes.length > 0) {
      this.laid = true;
      this.frame(true);
    }
  }

  /** Re-light under a lens: alphas only, the layout never moves. */
  setLens(lens: BrainLens): void {
    if (this.lens === lens) return;
    this.lens = lens;
    this.stillDirty = true;
  }

  /** Zoom into a lobe (its area), the loose thoughts, or back to the whole brain. */
  setFocus(focus: string | null): void {
    if (this.focus === focus) return;
    this.focus = focus;
    this.uiBoxesCache = undefined;
    this.stillDirty = true;
    if (!focus) {
      this.frame(false);
      return;
    }
    if (focus === 'loose') {
      this.flyTo(this.looseAt.x, this.looseAt.y - 30, Math.max(this.cam.k, 1.5), false);
      return;
    }
    const lobe = this.lobes.find((l) => l.area === focus);
    if (!lobe) return;
    const pad = 90;
    const k = clamp(Math.min((this.w - pad * 2) / (lobe.rx * 2 + 60), (this.h - pad * 2) / (lobe.ry * 2 + 80)), this.minK(), LIVING_ZOOM_MAX);
    this.flyTo(lobe.cx === 0 ? 0 : lobe.cx, lobe.cy, k, false);
  }

  /** Pick a note: highlight, fire one hop then two, and say its links. */
  select(id: string | null, opts: { fire?: boolean; fly?: boolean } = {}): void {
    this.selected = id;
    this.stillDirty = true;
    if (!id || !this.byId.has(id)) {
      if (!id) {
        this.say('');
        this.onSelect(null);
      }
      return;
    }
    // Selecting takes the camera: a framing glide stops under the tap, so the point holds still.
    this.camTouched = true;
    this.camAnim = null;
    this.zoomGoal = null;
    if (opts.fire !== false && livingMotion(this.reduced).pulses) this.fire(id);
    const n = this.byId.get(id)!;
    this.say(`${n.title}, ${plural(livingNeighbours(id, this.curves).length, 'link')}`);
    this.onSelect(id);
    if (opts.fly) this.keepVisible(n);
  }

  /** The search's answer: turn the brain to the note and light its neighbourhood. */
  searchGo(id: string): void {
    const n = this.byId.get(id);
    if (!n) return;
    this.flyTo(n.x, n.y, Math.max(this.cam.k, 1.7), false);
    this.select(id, {});
  }

  /** Clicking a neighbour walks there: the selection moves and the view follows when it must. */
  walkTo(id: string): void {
    const n = this.byId.get(id);
    if (!n) return;
    this.select(id, {});
    this.keepVisible(n);
  }

  neighbours(id: string): string[] {
    return livingNeighbours(id, this.curves);
  }

  snapshot(): BrainSnapshot {
    const costs = [...this.costs].sort((a, b) => a - b);
    const q = (p: number): number => (costs.length ? Math.round(costs[Math.min(costs.length - 1, Math.floor(costs.length * p))] * 100) / 100 : 0);
    let lit = 0;
    for (const n of this.nodes) if (this.lit(n)) lit++;
    return {
      trace: [...this.trace],
      frames: this.frames,
      composed: this.composed,
      nodes: this.nodes.map((n) => ({ id: n.id, title: n.title, x: this.sx(n.x), y: this.sy(n.y), r: n.r * this.cam.k, ...(n.hop !== undefined ? { hop: n.hop } : {}) })),
      count: this.nodes.length,
      links: this.curves.length,
      centre: this.centreId,
      selected: this.selected,
      hovered: this.hovered,
      pulses: this.pulses.length,
      reduced: this.reduced,
      lens: this.lens,
      focus: this.focus,
      lit,
      dimmed: this.nodes.length - lit,
      cam: { ...this.cam },
      taken: this.camTouched,
      framed: this.laid && this.camAnim === null && this.zoomGoal === null,
      frameMs: { p50: q(0.5), p95: q(0.95), max: costs.length ? Math.round(costs[costs.length - 1] * 100) / 100 : 0, n: costs.length },
      lobes: [...this.lastLobes],
      labels: [...this.lastLabels],
      view: { w: this.w, h: this.h },
    };
  }

  // ── input ────────────────────────────────────────────────────────────────

  private toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.w / 2) / this.cam.k + this.cam.cx,
      y: (clientY - r.top - this.h / 2) / this.cam.k + this.cam.cy,
    };
  }

  private hit(clientX: number, clientY: number): string | null {
    const p = this.toWorld(clientX, clientY);
    return hitLivingNode(this.nodes, p.x, p.y);
  }

  private down(e: PointerEvent): void {
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture?.(e.pointerId);
    const r = this.canvas.getBoundingClientRect();
    this.pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchD = Math.hypot(a.x - b.x, a.y - b.y);
      this.panning = false;
      this.zoomGoal = null;
      return;
    }
    this.downAt = performance.now();
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.moved = false;
    this.panning = !this.hit(e.clientX, e.clientY);
  }

  private move(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchD > 0 && d > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinchD, true);
      this.pinchD = d;
      this.moved = true;
      return;
    }
    if (e.buttons === 0) {
      const id = this.hit(e.clientX, e.clientY);
      // A hover brightens; only a click fires, so the firing stays the click's answer.
      if (id !== this.hovered) {
        this.hovered = id;
        this.stillDirty = true;
      }
      this.canvas.style.cursor = id ? 'pointer' : 'grab';
      return;
    }
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 4) this.moved = true;
    if (this.panning && this.moved) {
      this.camTouched = true;
      this.cam.cx -= e.movementX / this.cam.k;
      this.cam.cy -= e.movementY / this.cam.k;
      this.camAnim = null;
      this.zoomGoal = null;
      this.stillDirty = true;
      this.canvas.style.cursor = 'grabbing';
    }
  }

  private up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchD = 0;
    this.panning = false;
    this.canvas.style.cursor = this.hovered ? 'pointer' : 'grab';
    const quick = performance.now() - this.downAt < 450;
    if (!this.moved && quick && this.pointers.size === 0) {
      const id = this.hit(e.clientX, e.clientY);
      if (id) {
        this.mark(`up:select=${id}`);
        this.select(id, {});
        // The note's own small graph opens on one click (t151): a neighbour is one tap from its note.
        if (this.compact && id !== this.centreId) this.onOpen(id, e.ctrlKey || e.metaKey);
        else if (e.ctrlKey || e.metaKey) this.onOpen(id, true);
      } else if (this.selected) {
        this.select(null);
        this.camTouched = true;
        this.camAnim = null;
        this.zoomGoal = null;
      }
    }
    this.moved = false;
  }

  private leave(): void {
    if (this.hovered) {
      this.hovered = null;
      this.stillDirty = true;
    }
    this.canvas.style.cursor = 'grab';
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    if (!dy || !Number.isFinite(dy)) return;
    const r = this.canvas.getBoundingClientRect();
    this.zoomAt(e.clientX - r.left, e.clientY - r.top, livingWheelFactor(dy));
  }

  private double(e: MouseEvent): void {
    const id = this.hit(e.clientX, e.clientY);
    if (!id) return;
    if (e.ctrlKey || e.metaKey) return;
    if (this.selected !== id) this.select(id, {});
    this.mark(`double:open=${id}`);
    this.onOpen(id, false);
  }

  private keys(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      const id = this.selected ?? this.hovered ?? this.centreId;
      if (id && this.byId.has(id)) {
        e.preventDefault();
        this.onOpen(id, e.ctrlKey || e.metaKey);
      }
      return;
    }
    if (e.key === ' ') {
      const id = this.selected ?? this.hovered ?? this.centreId;
      if (id && this.byId.has(id) && this.onCentre) {
        e.preventDefault();
        this.onCentre(id);
      }
      return;
    }
    if (e.key === 'Escape') {
      if (this.selected) {
        e.preventDefault();
        this.select(null);
      }
      return;
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const from = this.selected ?? this.hovered ?? this.centreId;
    let ring: string[] = from ? livingNeighbours(from, this.curves) : [];
    if (!ring.length) {
      const big = [...this.nodes].sort((a, b) => b.r - a.r || a.title.localeCompare(b.title))[0];
      if (!big) return;
      ring = [big.id];
    }
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    this.selIndex = ring.includes(this.selected ?? '') ? ring.indexOf(this.selected!) : fwd ? -1 : 0;
    this.selIndex = (this.selIndex + (fwd ? 1 : -1) + ring.length) % ring.length;
    this.walkTo(ring[this.selIndex]);
  }

  private say(words: string): void {
    if (this.live) this.live.textContent = words;
  }

  // ── camera ───────────────────────────────────────────────────────────────

  private sx(x: number): number {
    return (x - this.cam.cx) * this.cam.k + this.w / 2;
  }
  private sy(y: number): number {
    return (y - this.cam.cy) * this.cam.k + this.h / 2;
  }

  /** The graph's own boxes in screen pixels (9 Nov 2026, "Hea": Health sat under the find box):
   *  the find box, the legend and the view buttons. Names treat them as already taken, the way the living
   *  graph's names treat the legend. Measured, never constants (heights follow their rows), but kept until
   *  the size or the layout changes them; never every frame. None when compact (no boxes over it). */
  private uiBoxes(): { x: number; y: number; w: number; h: number }[] {
    if (this.compact) return [];
    if (this.uiBoxesCache !== undefined) return this.uiBoxesCache;
    const out: { x: number; y: number; w: number; h: number }[] = [];
    const host = this.canvas.parentElement;
    const cr = this.canvas.getBoundingClientRect();
    for (const sel of ['.bg-find input', '.bg-legend', '.bg-lenses']) {
      const el = host?.querySelector(sel);
      if (!el) continue;
      const lr = el.getBoundingClientRect();
      if (lr.width < 2 || lr.height < 2) continue;
      out.push({ x: lr.left - cr.left + lr.width / 2, y: lr.top - cr.top + lr.height / 2, w: lr.width, h: lr.height });
    }
    return (this.uiBoxesCache = out);
  }

  private minK(): number {
    if (!this.nodes.length) return 0.12;
    const reserve = this.compact ? 0 : 220;
    const f = fitLivingView(this.bounds.minX, this.bounds.minY, this.bounds.maxX, this.bounds.maxY, (this.w || 800) - reserve, this.h || 600, this.compact ? 24 : 48);
    return Math.min(f.k, 1);
  }

  private frame(instant: boolean): void {
    if (!this.nodes.length) return;
    const reserve = this.compact ? 0 : 220;
    const f = fitLivingView(this.bounds.minX, this.bounds.minY, this.bounds.maxX, this.bounds.maxY, (this.w || 800) - reserve, this.h || 600, this.compact ? 24 : 48);
    this.mark(`frame:brain instant=${instant} k=${f.k.toFixed(3)}`);
    this.flyTo(f.cx - reserve / 2 / f.k, f.cy, f.k, instant);
  }

  private zoomAt(sx: number, sy: number, f: number, direct = false): void {
    this.camTouched = true;
    const base = this.zoomGoal ?? this.cam;
    const floor = this.minK();
    const k = clamp(base.k * f, floor, LIVING_ZOOM_MAX);
    let cx: number;
    let cy: number;
    // Fully out always brings the whole brain back into view (10 Nov 2026: it could stay panned
    // off-screen): at the floor the camera glides home to the fitted middle, not the pointer's anchor.
    if (k <= floor + 1e-9 && this.nodes.length) {
      const reserve = this.compact ? 0 : 220;
      const fit = fitLivingView(this.bounds.minX, this.bounds.minY, this.bounds.maxX, this.bounds.maxY, (this.w || 800) - reserve, this.h || 600, this.compact ? 24 : 48);
      cx = fit.cx - reserve / 2 / fit.k;
      cy = fit.cy;
    } else {
      const wx = (sx - this.w / 2) / base.k + base.cx;
      const wy = (sy - this.h / 2) / base.k + base.cy;
      cx = wx - (sx - this.w / 2) / k;
      cy = wy - (sy - this.h / 2) / k;
    }
    this.camAnim = null;
    if (direct || this.reduced) {
      this.cam = { cx, cy, k };
      this.zoomGoal = null;
      this.stillDirty = true;
      return;
    }
    this.zoomGoal = { k, cx, cy };
  }

  private flyTo(cx: number, cy: number, k: number, instant: boolean): void {
    this.zoomGoal = null;
    if (instant || this.reduced) {
      this.cam = { cx, cy, k };
      this.camAnim = null;
      this.stillDirty = true;
      return;
    }
    this.camAnim = { fx: this.cam.cx, fy: this.cam.cy, fk: this.cam.k, tx: cx, ty: cy, tk: k, t0: performance.now() };
  }

  private keepVisible(n: BrainPlaced): void {
    const x = this.sx(n.x);
    const y = this.sy(n.y);
    const m = 80;
    if (x < m || x > this.w - m || y < m || y > this.h - m) this.flyTo(n.x, n.y, this.cam.k, false);
  }

  // ── firing ───────────────────────────────────────────────────────────────

  /** Bright pulses out along a note's links, one hop, then each arrival fires the second hop. */
  private fire(id: string): void {
    const from = this.byId.get(id);
    if (!from) return;
    const outs = (this.adj.get(id) ?? [])
      .map((c) => (c.source === id ? this.byId.get(c.target) : this.byId.get(c.source)))
      .filter((n): n is BrainPlaced => !!n && n.id !== id)
      .sort((a, b) => b.r - a.r || a.title.localeCompare(b.title))
      .slice(0, 18);
    const now = performance.now();
    outs.forEach((n, i) => {
      const c = (this.adj.get(id) ?? []).find((l) => (l.source === id && l.target === n.id) || (l.target === id && l.source === n.id))!;
      const d = Math.hypot(n.x - from.x, n.y - from.y);
      this.pulses.push({ ax: from.x, ay: from.y, cx: c.cx, cy: c.cy, bx: n.x, by: n.y, from: id, colour: from.colour, to: n.id, t0: now + i * 32, dur: 420 + d * 1.1, hop: 1, faint: false, spawned: false });
    });
    while (this.pulses.length > PULSE_CAP) this.pulses.shift();
  }

  private fireSecond(fromId: string, skip: string): void {
    const from = this.byId.get(fromId);
    if (!from) return;
    const outs = (this.adj.get(fromId) ?? [])
      .map((c) => (c.source === fromId ? this.byId.get(c.target) : this.byId.get(c.source)))
      .filter((n): n is BrainPlaced => !!n && n.id !== fromId && n.id !== skip)
      .sort((a, b) => b.r - a.r || a.title.localeCompare(b.title))
      .slice(0, 4);
    const now = performance.now();
    outs.forEach((n, i) => {
      const c = (this.adj.get(fromId) ?? []).find((l) => (l.source === fromId && l.target === n.id) || (l.target === fromId && l.source === n.id))!;
      const d = Math.hypot(n.x - from.x, n.y - from.y);
      this.pulses.push({ ax: from.x, ay: from.y, cx: c.cx, cy: c.cy, bx: n.x, by: n.y, from: fromId, colour: from.colour, to: n.id, t0: now + i * 40, dur: 460 + d * 1.1, hop: 2, faint: false, spawned: true });
    });
    while (this.pulses.length > PULSE_CAP) this.pulses.shift();
  }

  // ── frame ────────────────────────────────────────────────────────────────

  private size(): void {
    const host = this.canvas.parentElement;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const nw = Math.max(1, Math.round(r.width));
    const nh = Math.max(1, Math.round(r.height));
    const grew = nw !== this.w || nh !== this.h;
    this.w = nw;
    this.h = nh;
    // A huge canvas at full phone density would raster tens of millions of pixels a redraw; past 2500 wide
    // the backing holds at 1.5, still crisp, much cheaper.
    this.dsf = Math.min(nw > 2500 ? 1.5 : 2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dsf);
    this.canvas.height = Math.round(this.h * this.dsf);
    this.still = null;
    this.buildBg();
    this.uiBoxesCache = undefined;
    this.stillDirty = true;
    if (!grew || this.camTouched || !this.nodes.length || this.w < 2 || this.h < 2) return;
    this.mark(`size:refit w=${this.w} h=${this.h}`);
    this.frame(false);
  }

  /** The background and its vignette, drawn once per size into the blit layer (the same stops the frame
   *  used to fill every frame, in device pixels). */
  private buildBg(): void {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(this.w * this.dsf));
    c.height = Math.max(1, Math.round(this.h * this.dsf));
    const g = c.getContext('2d');
    if (!g) {
      this.bgLayer = null;
      return;
    }
    g.fillStyle = BG;
    g.fillRect(0, 0, c.width, c.height);
    const grad = g.createRadialGradient(
      c.width / 2, c.height / 2, Math.min(this.w, this.h) * 0.42 * this.dsf,
      c.width / 2, c.height / 2, Math.max(this.w, this.h) * 0.75 * this.dsf,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(2,4,10,0.5)');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    this.bgLayer = c;
  }

  /** Static world decor pre-rendered per layout (silhouette, lobe tints, fold): identical pixels to the
   *  per-frame drawing, blitted under the world transform per frame instead. Bounds cover the silhouette
   *  (±560, ±437), every lobe's tint and the fold, recomputed per layout since designs differ. The note's
   *  own small graph keeps none of it (t151): dark background only, its neighbourhood plain on it. */
  private buildDecor(): void {
    if (this.compact) {
      this.decorLayer = null;
      return;
    }
    let minX = -580;
    let minY = -457;
    let maxX = 580;
    let maxY = 457;
    for (const lobe of this.lobes) {
      const m = Math.max(lobe.rx, lobe.ry) * 1.5 + 20;
      minX = Math.min(minX, lobe.cx - m);
      minY = Math.min(minY, lobe.cy - m);
      maxX = Math.max(maxX, lobe.cx + m);
      maxY = Math.max(maxY, lobe.cy + m);
    }
    minX = Math.floor(Math.min(minX, -70));
    minY = Math.floor(Math.min(minY, -370));
    maxX = Math.ceil(Math.max(maxX, 70));
    maxY = Math.ceil(Math.max(maxY, 370));
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    let c = this.decorLayer;
    if (!c) {
      c = document.createElement('canvas');
      this.decorLayer = c;
    }
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) {
      this.decorLayer = null;
      return;
    }
    this.decorBounds = { x: minX, y: minY, w, h };
    g.setTransform(1, 0, 0, 1, -minX, -minY);
    g.lineCap = 'round';
    // One silhouette: the whole brain reads as one rounded, glowing shape with a soft outer edge, like
    // their reference (10 Nov 2026 polish: it read as two tinted blobs with a dark stripe between). An
    // elliptical glow scaled like the points, fading to nothing at its rim; the lobe tints sit inside it,
    // subtle.
    g.save();
    g.translate(0, 0);
    g.scale(1, 0.78);
    const sg = g.createRadialGradient(0, 0, 40, 0, 0, 560);
    sg.addColorStop(0, 'rgba(56,130,246,0.11)');
    sg.addColorStop(0.62, 'rgba(56,130,246,0.06)');
    sg.addColorStop(0.88, 'rgba(56,130,246,0.028)');
    sg.addColorStop(1, 'rgba(56,130,246,0)');
    g.fillStyle = sg;
    g.beginPath();
    g.arc(0, 0, 560, 0, Math.PI * 2);
    g.fill();
    g.restore();
    for (const lobe of this.lobes) {
      const lg = g.createRadialGradient(lobe.cx, lobe.cy, 8, lobe.cx, lobe.cy, Math.max(lobe.rx, lobe.ry) * 1.25);
      lg.addColorStop(0, `${lobe.colour}20`);
      lg.addColorStop(0.7, `${lobe.colour}0d`);
      lg.addColorStop(1, `${lobe.colour}00`);
      g.fillStyle = lg;
      g.beginPath();
      g.ellipse(lobe.cx, lobe.cy, lobe.rx * 1.32, lobe.ry * 1.4, 0, 0, Math.PI * 2);
      g.fill();
    }
    // The fold: a soft crease down the middle that follows a gentle S, never a rectangle (10 Nov 2026
    // polish: a hard-edged dark stripe with straight edges, running past the brain). Stroked soft in two
    // passes, ending where the points end so it never runs into the empty dark; the whole of it sits inside
    // the silhouette, so no clip. Points hold clear of it by layout (52 world), the widest pass plus its bow
    // stays inside that.
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const foldPath = () => {
      g.beginPath();
      const top = -320;
      const bottom = 320;
      for (let i = 0; i <= 24; i++) {
        const y = top + ((bottom - top) * i) / 24;
        const x = 20 * Math.sin(((y + 320) / 640) * Math.PI * 2);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    };
    foldPath();
    g.strokeStyle = 'rgba(0,0,0,0.08)';
    g.lineWidth = 60;
    g.stroke();
    foldPath();
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 24;
    g.stroke();
    g.restore();
  }

  private seen(): void {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.running = false;
    } else if (!this.running) {
      this.loop();
    }
  }

  private loop(): void {
    this.running = true;
    const step = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(step);
      try {
        const want = Math.min(this.w > 2500 ? 1.5 : 2, window.devicePixelRatio || 1);
        if (want !== this.dsf) this.size();
      } catch {
        // A window without a scale still draws.
      }
      if (this.w < 2 || this.h < 2 || document.hidden) return;
      this.frames++;
      const motion = livingMotion(this.reduced);
      // The camera glides on its own clock, even with nothing else moving.
      if (this.camAnim || this.zoomGoal) this.stepCamera(performance.now());
      // Now and then, a soft pulse along a lately-touched link: where the week went. Calm, never busy.
      // The note's own small graph never pulses on its own (t151): no animation while nothing changes.
      const now = performance.now();
      if (!this.compact && motion.ambient && !this.hovered && !this.pulses.length && now >= this.ambientAt) {
        const recents = this.curves.filter((c) => c.recent);
        if (recents.length) {
          const c = recents[Math.floor(Math.random() * recents.length)];
          const a = this.byId.get(c.source)!;
          const b = this.byId.get(c.target)!;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          this.pulses.push({ ax: a.x, ay: a.y, cx: c.cx, cy: c.cy, bx: b.x, by: b.y, from: a.id, colour: a.colour, to: b.id, t0: now, dur: 1000 + d, hop: 1, faint: true, spawned: true });
        }
        this.ambientAt = now + 4600 + Math.random() * 3600;
      }
      // At rest the still layer holds and the loop spends nothing but its pilot: a 4px canvas redrawn
      // every resting frame while the window has focus, so the graphics side never idles before the next
      // click (the living fix; 50 spaced clicks, no stalls). Arrival flashes count as work, or they would
      // freeze mid-fade.
      if (!this.stillDirty && !this.pulses.length && !this.camAnim && !this.zoomGoal && !this.flashUntil.size) {
        if (this.pilot && document.hasFocus()) {
          this.pilot.fillStyle = (this.pilotTick++ & 1) ? '#0b0f17' : '#0c1018';
          this.pilot.fillRect(0, 0, 4, 4);
        }
        return;
      }
      const t0 = performance.now();
      if (this.stillDirty) this.paintStill();
      this.compose(now);
      const cost = performance.now() - t0;
      this.costs.push(cost);
      if (this.costs.length > 240) this.costs.shift();
    };
    this.raf = requestAnimationFrame(step);
  }

  private stepCamera(now: number): void {
    if (this.camAnim) {
      const a = this.camAnim;
      const t = clamp((now - a.t0) / 350, 0, 1);
      const e = t * t * (3 - 2 * t);
      this.cam = { cx: a.fx + (a.tx - a.fx) * e, cy: a.fy + (a.ty - a.fy) * e, k: a.fk + (a.tk - a.fk) * e };
      if (t >= 1) this.camAnim = null;
      this.stillDirty = true;
    }
    if (this.zoomGoal) {
      const g = this.zoomGoal;
      const k = this.cam.k * Math.pow(g.k / this.cam.k, 0.25);
      const cx = this.cam.cx + (g.cx - this.cam.cx) * 0.25;
      const cy = this.cam.cy + (g.cy - this.cam.cy) * 0.25;
      if (Math.abs(Math.log(g.k / k)) < 0.004 && Math.hypot(g.cx - cx, g.cy - cy) * k < 0.5) {
        this.cam = { cx: g.cx, cy: g.cy, k: g.k };
        this.zoomGoal = null;
      } else {
        this.cam = { cx, cy, k };
      }
      this.stillDirty = true;
    }
  }

  private lit(n: BrainPlaced): boolean {
    if (!brainLensMatch(this.lens, n)) return false;
    if (this.focus === 'loose') return n.loose;
    if (this.focus) return n.area === this.focus;
    return true;
  }

  private sprite(colour: string): HTMLCanvasElement {
    const had = this.sprites.get(colour);
    if (had) return had;
    const c = document.createElement('canvas');
    // 64px: still 3x oversampled at the 20px draws, under half the 96px pixels to blit per point.
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 1, 32, 32, 32);
    grad.addColorStop(0, colour);
    grad.addColorStop(0.25, `${colour}cc`);
    grad.addColorStop(0.55, `${colour}55`);
    grad.addColorStop(1, `${colour}00`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.sprites.set(colour, g.canvas);
    return g.canvas;
  }

  /** A title's width in a font, measured once and kept (the living graph's measure: the same titles
   *  measured every frame otherwise). Capped: a vault of renames never grows it without bound. */
  private measure(g: CanvasRenderingContext2D, font: string, title: string): number {
    const key = `${font}|${title}`;
    let w = this.textW.get(key);
    if (w === undefined) {
      g.font = font;
      w = g.measureText(title).width;
      if (this.textW.size > 4000) this.textW.clear();
      this.textW.set(key, w);
    }
    return w;
  }

  /** The still world, drawn once per change: washes, curves, points, lobe names and labels. */
  private paintStill(): void {
    this.stillDirty = false;
    const { w, h, dsf } = this;
    if (!this.still) {
      this.still = document.createElement('canvas');
      this.still.width = Math.round(w * dsf);
      this.still.height = Math.round(h * dsf);
    }
    const g = this.still.getContext('2d')!;
    const cam = this.cam;
    const k = cam.k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.bgLayer) g.drawImage(this.bgLayer, 0, 0);
    else {
      g.fillStyle = BG;
      g.fillRect(0, 0, this.still.width, this.still.height);
      g.setTransform(dsf, 0, 0, dsf, 0, 0);
      const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(2,4,10,0.5)');
      g.fillStyle = vg;
      g.fillRect(0, 0, w, h);
    }
    g.setTransform(dsf * k, 0, 0, dsf * k, dsf * (w / 2 - cam.cx * k), dsf * (h / 2 - cam.cy * k));
    g.lineCap = 'round';
    const focus = this.hovered ?? this.selected;
    const near = new Set<string>();
    if (focus && this.byId.has(focus)) {
      near.add(focus);
      for (const c of this.adj.get(focus) ?? []) {
        near.add(c.source);
        near.add(c.target);
      }
    }
    const dimmed = (n: BrainPlaced): boolean => (near.size > 0 && !near.has(n.id)) || !this.lit(n);
    // Static decor (silhouette, lobe tints, fold) blitted from its pre-render under the world transform.
    if (this.decorLayer) g.drawImage(this.decorLayer, this.decorBounds.x, this.decorBounds.y, this.decorBounds.w, this.decorBounds.h);
    g.lineCap = 'round';
    const litEnd = (c: BrainCurve): boolean => {
      const a = this.byId.get(c.source);
      const b = this.byId.get(c.target);
      return !!a && !!b && this.lit(a) && this.lit(b);
    };
    const hotSet = new Set<BrainCurve>();
    if (focus) for (const c of this.adj.get(focus) ?? []) hotSet.add(c);
    const pass = (test: (c: BrainCurve) => boolean, style: string, width: number, alpha: number) => {
      g.beginPath();
      for (const c of this.curves) {
        if (!test(c)) continue;
        const a = this.byId.get(c.source)!;
        const b = this.byId.get(c.target)!;
        g.moveTo(a.x, a.y);
        g.quadraticCurveTo(c.cx, c.cy, b.x, b.y);
      }
      g.globalAlpha = alpha;
      g.strokeStyle = style;
      g.lineWidth = width / k;
      g.stroke();
      g.globalAlpha = 1;
    };
    // Calm at rest, lit only around what you touch (10 Nov 2026 polish): the quiet threads sit faint,
    // and while a neighbourhood is lit the rest fall back further still. The note's own second step sits
    // fainter still (t151): its threads and points at three-fifths, unless lit by a touch.
    const calm = near.size > 0 ? 0.35 : 1;
    const faintHop = (c: BrainCurve): boolean => (this.byId.get(c.source)?.hop === 2 || this.byId.get(c.target)?.hop === 2) && !hotSet.has(c);
    pass((c) => !c.recent && !hotSet.has(c) && litEnd(c) && !faintHop(c), LINK_INK, 1, calm);
    pass((c) => !c.recent && !hotSet.has(c) && litEnd(c) && faintHop(c), LINK_INK, 1, calm * 0.6);
    pass((c) => c.recent && !hotSet.has(c) && litEnd(c) && !faintHop(c), LINK_RECENT, 1.1, calm);
    pass((c) => c.recent && !hotSet.has(c) && litEnd(c) && faintHop(c), LINK_RECENT, 1.1, calm * 0.6);
    pass((c) => !litEnd(c), LINK_INK, 1, LENS_DIM + 0.06);
    if (hotSet.size) pass((c) => hotSet.has(c), LINK_HOT, 1.6, 1);
    // Points: pre-rendered glow, then a bright core. Recent notes glow brighter; stale ones dim; loose
    // thoughts sit faint. The rest dims a little so a neighbourhood reads.
    for (const n of this.nodes) {
      const lit = !dimmed(n);
      const hopFaint = n.hop === 2 && !near.has(n.id) ? 0.7 : 1;
      const a = (lit ? 1 : near.size > 0 && !near.has(n.id) ? DIM_TO : LENS_DIM + 0.1) * hopFaint;
      const glow = n.loose ? 0.3 : n.recent ? 0.75 : 0.5;
      const s = n.r * (n.recent && !n.loose ? 5.4 : 5);
      g.globalAlpha = a * glow;
      g.drawImage(this.sprite(n.colour), n.x - s / 2, n.y - s / 2, s, s);
      g.globalAlpha = a * (n.loose ? 0.5 : n.recent ? 1 : 0.85);
      g.fillStyle = n.recent && !n.loose ? lift(n.colour, 0.55) : lift(n.colour, 0.35);
      g.beginPath();
      g.arc(n.x, n.y, Math.max(1.2, n.r * 0.52), 0, Math.PI * 2);
      g.fill();
      if (focus && n.id === focus) {
        const hoverOnly = n.id === this.hovered && n.id !== this.selected;
        g.globalAlpha = a * (hoverOnly ? 0.16 : 0.35);
        const hs = n.r * (hoverOnly ? 5 : 6);
        g.drawImage(this.sprite('#ffffff'), n.x - hs / 2, n.y - hs / 2, hs, hs);
      }
    }
    g.globalAlpha = 1;
    this.drawMarks(g);
    this.paintWords(g, near);
  }

  private drawMarks(g: CanvasRenderingContext2D): void {
    const c = this.centreId ? this.byId.get(this.centreId) : undefined;
    if (c && c.id !== this.selected) {
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 1.5 / this.cam.k;
      g.beginPath();
      g.arc(c.x, c.y, c.r + 5, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.lineWidth = 1 / this.cam.k;
      g.beginPath();
      g.arc(c.x, c.y, c.r + 10, 0, Math.PI * 2);
      g.stroke();
    }
    if (this.selected && this.byId.has(this.selected)) {
      const n = this.byId.get(this.selected)!;
      g.strokeStyle = '#ff7a59';
      g.lineWidth = 1.6 / this.cam.k;
      g.beginPath();
      g.arc(n.x, n.y, n.r + 3.5, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = 'rgba(255,122,89,0.3)';
      g.lineWidth = 1 / this.cam.k;
      g.beginPath();
      g.arc(n.x, n.y, n.r + 8, 0, Math.PI * 2);
      g.stroke();
    } else if (this.hovered && this.byId.has(this.hovered)) {
      const n = this.byId.get(this.hovered)!;
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 1.2 / this.cam.k;
      g.beginPath();
      g.arc(n.x, n.y, n.r + 3.5, 0, Math.PI * 2);
      g.stroke();
    }
  }

  /** A lobe's name clear of what is already taken: along its own edge to the nearest clear spot, never
   *  hidden (9 Nov 2026, "Hea"). Rings slides on its label ring past the rim-most points; halves and folds
   *  slide round their lobe at the same inset, clear of the fold. The overlap asks the same daylight as the
   *  label pass, so a slid name still reads clear. */
  private slideLobeClear(lobe: BrainLobe, w: number, h: number, taken: readonly { x: number; y: number; w: number; h: number }[]): { x: number; y: number } {
    const hits = (x: number, y: number): boolean =>
      taken.some((t) => Math.abs(x - t.x) * 2 < w + t.w + 6 && Math.abs(y - t.y) * 2 < h + t.h + 18);
    const x0 = this.sx(lobe.lx);
    const y0 = this.sy(lobe.ly);
    if (!hits(x0, y0)) return { x: x0, y: y0 };
    if (lobe.wedge) {
      const r = Math.hypot(lobe.lx, lobe.ly / 0.78) || 430;
      const a0 = Math.atan2(lobe.ly / 0.78, lobe.lx);
      const step = (2 * Math.PI) / 180;
      for (let i = 1; i <= 90; i++) {
        for (const s of [1, -1]) {
          const a = a0 + s * i * step;
          const x = this.sx(Math.cos(a) * r);
          const y = this.sy(Math.sin(a) * r * 0.78);
          if (!hits(x, y)) return { x, y };
        }
      }
      return { x: x0, y: y0 };
    }
    const s = Math.hypot((lobe.lx - lobe.cx) / Math.max(1, lobe.rx), (lobe.ly - lobe.cy) / Math.max(1, lobe.ry)) || 0.62;
    const a0 = Math.atan2((lobe.ly - lobe.cy) / Math.max(1, lobe.ry), (lobe.lx - lobe.cx) / Math.max(1, lobe.rx));
    const step = (4 * Math.PI) / 180;
    for (let i = 1; i <= 45; i++) {
      for (const sg of [1, -1]) {
        const a = a0 + sg * i * step;
        const wx = lobe.cx + Math.cos(a) * lobe.rx * s;
        if (Math.abs(wx) < BRAIN_FOLD_HALF) continue;
        const wy = lobe.cy + Math.sin(a) * lobe.ry * s;
        const x = this.sx(wx);
        const y = this.sy(wy);
        if (!hits(x, y)) return { x, y };
      }
    }
    return { x: x0, y: y0 };
  }

  private paintWords(g: CanvasRenderingContext2D, near: Set<string>): void {
    const { cam } = this;
    const fsFor = (r: number): number => 11 + r * 0.28;
    const zoomed = cam.k > 2.2;
    const hot = new Set<string>(near);
    // At rest a few well-spaced names of the biggest notes only (10 Nov 2026 polish: three per lobe
    // crowded the rest view); the lit ones always show. A focused lobe names itself whole; zoomed in, more
    // appear as they earn room. Loose thoughts stay unnamed (their caption counts them).
    const perLobe = new Map<string, BrainPlaced[]>();
    for (const n of this.nodes) {
      if (n.loose || hot.has(n.id)) continue;
      // The note's own second step stays unnamed at rest (t151): its names would crowd the 260px panel
      // and clip at its edge. Lit ones (hovered, selected, neighbours) still show below.
      if (this.compact && n.hop === 2) continue;
      const l = perLobe.get(n.area) ?? [];
      l.push(n);
      perLobe.set(n.area, l);
    }
    const rest = new Set<string>();
    for (const [area, list] of perLobe) {
      list.sort((a, b) => b.r - a.r || a.title.localeCompare(b.title));
      const all = this.focus === area || (zoomed && this.lit(list[0]));
      for (const n of list.slice(0, all ? list.length : 2)) rest.add(n.id);
    }
    const ranked: { id: string; rank: number }[] = [];
    for (const n of this.nodes) {
      if (n.loose && !hot.has(n.id)) continue;
      const lit = hot.has(n.id);
      const touch = n.id === this.hovered || n.id === this.selected;
      if (!lit) {
        if (zoomed) {
          if (n.r < 7.4 && cam.k < clamp(3.4 - n.r * 0.34, 1.15, 3.4)) continue;
        } else if (!rest.has(n.id)) continue;
      }
      ranked.push({ id: n.id, rank: n.r * 100 + (touch ? 100000 : 0) + (lit && !touch ? 10000 : 0) });
    }
    ranked.sort((a, b) => b.rank - a.rank);
    const cands: LivingLabel[] = [];
    g.textBaseline = 'middle';
    for (const { id, rank } of ranked.slice(0, LABEL_CAP)) {
      const n = this.byId.get(id)!;
      const fs = fsFor(n.r);
      const tw = this.measure(g, `${fs}px ${this.fontStack}`, n.title);
      cands.push({ id: `n:${id}`, x: this.sx(n.x), y: this.sy(n.y) - n.r * cam.k - fs * 0.7, w: tw + 10, h: fs + 6, rank });
    }
    // Each lobe's name in its colour, where the layout put it: clearly in or at the edge of its own lobe,
    // never over points, never overlapping another name (10 Nov 2026 polish: crowns landed in the wrong lobe).
    // Lobe names yield to nothing; point labels yield to them. A name that would sit under the find box, the
    // legend or the views slides along its own edge to the nearest clear spot, never hidden: every area always
    // shows its name.
    const tagFont = `600 12px ${this.fontStack}`;
    const tagById = new Map<string, { name: string; colour: string }>();
    const ui = this.uiBoxes();
    const taken: { x: number; y: number; w: number; h: number }[] = [...ui];
    for (const lobe of [...this.lobes].sort((a, b) => b.count - a.count || a.area.localeCompare(b.area))) {
      const tw = this.measure(g, tagFont, lobe.name);
      const w = tw + 14;
      const h = 20;
      const p = this.slideLobeClear(lobe, w, h, taken);
      taken.push({ x: p.x, y: p.y, w, h });
      cands.push({ id: `t:${lobe.area}`, x: p.x, y: p.y, w, h, rank: 20000 + lobe.count });
      tagById.set(`t:${lobe.area}`, lobe);
    }
    // The loose thoughts' caption at their arc.
    if (this.nodes.some((n) => n.loose)) {
      const words = 'Loose thoughts';
      const tw = this.measure(g, tagFont, words);
      cands.push({ id: 't:\0loose', x: this.sx(this.looseAt.x), y: this.sy(this.looseAt.y), w: tw + 14, h: 20, rank: 19999 });
      tagById.set('t:\0loose', { name: words, colour: '#8b94a7' });
    }
    const uiTaken: LivingLabel[] = ui.map((b, i) => ({ id: `\0ui${i}`, x: b.x, y: b.y, w: b.w, h: b.h, rank: Number.POSITIVE_INFINITY }));
    const shown = resolveLivingLabels([...uiTaken, ...cands], undefined);
    this.lastLabels = [];
    this.lastLobes = [];
    g.setTransform(this.dsf, 0, 0, this.dsf, 0, 0);
    g.textAlign = 'center';
    for (const c of cands) {
      if (!shown.has(c.id)) continue;
      const isTag = c.id.startsWith('t:');
      const dimmed = near.size > 0 && !isTag && !near.has(c.id.slice(2));
      g.globalAlpha = dimmed ? Math.max(0.25, DIM_TO) : 1;
      if (isTag) {
        const t = tagById.get(c.id)!;
        g.font = tagFont;
        g.lineWidth = 3;
        g.strokeStyle = HALO;
        g.strokeText(t.name, c.x, c.y);
        g.fillStyle = t.colour;
        g.fillText(t.name, c.x, c.y);
        if (c.id !== 't:\0loose') this.lastLobes.push({ area: c.id.slice(2), name: t.name, x: c.x, y: c.y, w: c.w, h: c.h });
      } else {
        const n = this.byId.get(c.id.slice(2))!;
        const fs = fsFor(n.r);
        g.font = `${fs}px ${this.fontStack}`;
        g.lineWidth = 3;
        g.strokeStyle = HALO;
        g.strokeText(n.title, c.x, c.y);
        g.fillStyle = LABEL_INK;
        g.fillText(n.title, c.x, c.y);
        this.lastLabels.push({ id: n.id, x: c.x, y: c.y, w: c.w, h: c.h });
      }
    }
    g.globalAlpha = 1;
    g.textAlign = 'start';
  }

  /** One frame: the still layer, with the travelling pulses and arrival flashes over it. */
  private compose(now: number): void {
    this.composed++;
    const { ctx, w, h, dsf } = this;
    const cam = this.cam;
    const k = cam.k;
    // Arrived pulses light their neighbour, then fade; first-hop arrivals fire the second hop out.
    for (const p of this.pulses) {
      if (now >= p.t0 + p.dur) {
        this.flashUntil.set(p.to, now + (p.faint ? 550 : 700));
        if (p.hop === 1 && !p.spawned && !p.faint && livingMotion(this.reduced).pulses) {
          p.spawned = true;
          if (this.byId.has(p.to)) this.fireSecond(p.to, p.from);
        }
      }
    }
    this.pulses = this.pulses.filter((p) => now < p.t0 + p.dur + 30);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.still) ctx.drawImage(this.still, 0, 0);
    else {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (!this.pulses.length && !this.flashUntil.size) return;
    ctx.setTransform(dsf * k, 0, 0, dsf * k, dsf * (w / 2 - cam.cx * k), dsf * (h / 2 - cam.cy * k));
    for (const [id, until] of this.flashUntil) {
      if (until <= now) {
        this.flashUntil.delete(id);
        continue;
      }
      const n = this.byId.get(id);
      if (!n) continue;
      const f = (until - now) / 700;
      ctx.globalAlpha = f * 0.9;
      const fs = n.r * 7;
      ctx.drawImage(this.sprite('#ffffff'), n.x - fs / 2, n.y - fs / 2, fs, fs);
    }
    ctx.globalAlpha = 1;
    // The pulses themselves: bright beads running down the curves.
    for (const p of this.pulses) {
      const t = clamp((now - p.t0) / p.dur, 0, 1);
      if (t <= 0 || t >= 1) continue;
      const u = 1 - t;
      const x = u * u * p.ax + 2 * u * t * p.cx + t * t * p.bx;
      const y = u * u * p.ay + 2 * u * t * p.cy + t * t * p.by;
      const s = (p.faint ? 11 : 13) * (0.7 + 0.3 * Math.sin(t * Math.PI));
      ctx.globalAlpha = p.faint ? 0.65 : 0.95;
      ctx.drawImage(this.sprite(p.colour), x - s / 2, y - s / 2, s, s);
      ctx.globalAlpha = p.faint ? 0.75 : 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, (p.faint ? 1.7 : 2.1) / Math.sqrt(k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private mark(ev: string): void {
    this.trace.push(`${Math.round(performance.now())}:${ev}`);
    if (this.trace.length > 60) this.trace.shift();
  }
}
