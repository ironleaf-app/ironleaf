// The living graph's canvas engine (8 Nov 2026, clusters you can read 9 Nov): d3-force lays the points out
// (links pull together, everything repels, each area holds its own wide place so clouds form, projects gather
// a little tighter inside), canvas 2D draws them - glow pre-rendered as one sprite per colour, never shadowBlur
// per point. Hover, click or keyboard-select a note and bright pulses run out along its links (one click
// selects at once, double-click opens, Space centres: the no-wait clicks, 8 Nov 2026)
// along its links, each neighbour lighting as one arrives while the rest dims; at rest it breathes (a faint
// drift, now and then a quiet pulse on a lately-touched link). Calm, never busy. The React shell
// (components/GraphView.tsx) scopes the data and draws the legend; this file only runs the world in the box.

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import {
  LIVING_AREA_PULL,
  LIVING_ZOOMED_K,
  LIVING_ZOOM_MAX,
  fitCentredK,
  fitLivingView,
  hitLivingNode,
  livingAreaAnchors,
  livingAspectBand,
  livingClusterTags,
  livingLinkTuning,
  livingMotion,
  livingNeighbours,
  livingPlaceTags,
  livingProjectAnchor,
  livingRestLabelIds,
  livingWheelFactor,
  radiusForLivingDegree,
  resolveLivingLabels,
  type LivingLabel,
  type LivingPoint,
  type LivingTagBox,
} from '../../../shared/living-graph';
import { plural } from '../../../shared/words';

export interface LivingEngineNodeIn {
  id: string;
  title: string;
  area: string;
  colour: string;
  degree: number;
  recent: boolean;
  /** The project corner it gathers toward (its own file, or its owner's): null for loose notes. */
  project: string | null;
}

export interface LivingEngineLinkIn {
  source: string;
  target: string;
  recent: boolean;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  title: string;
  area: string;
  colour: string;
  core: string;
  r: number;
  recent: boolean;
  project: string | null;
  phase: number;
  flashUntil: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  recent: boolean;
  /** This thread's rest length and pull, from livingLinkTuning (project, area, or across the gaps). */
  dist: number;
  stiff: number;
}

interface Pulse {
  a: SimNode;
  b: SimNode;
  t0: number;
  dur: number;
  faint: boolean;
}

export interface LivingSnapshotNode {
  id: string;
  title: string;
  x: number;
  y: number;
  r: number;
}

export interface LivingSnapshotTag {
  area: string;
  name: string;
  /** Centre on screen, size on screen. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LivingSnapshotLabel {
  id: string;
  /** Centre on screen, size on screen. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LivingSnapshotDraw {
  /** The last draws' JS cost in ms (p50, p95, longest, over up to 120 draws): the smooth proof reads these. */
  p50: number;
  p95: number;
  max: number;
  n: number;
}

export interface LivingSnapshot {
  trace: string[];
  frames: number;
  draw: LivingSnapshotDraw;
  nodes: LivingSnapshotNode[];
  count: number;
  links: number;
  centre: string | null;
  selected: string | null;
  hovered: string | null;
  pulses: number;
  reduced: boolean;
  settled: boolean;
  cam: { cx: number; cy: number; k: number };
  /** The person has taken the camera (pan, zoom, drag, walk, select): nothing automatic moves it. */
  taken: boolean;
  framed: boolean;
  /** Mean frame cost in ms while settling, and at rest (the honest speed numbers). */
  settleMs: number;
  restMs: number;
  /** The tags and names drawn on the last frame, and the canvas they fill (the cluster proof reads these). */
  tags: LivingSnapshotTag[];
  labels: LivingSnapshotLabel[];
  view: { w: number; h: number };
}

const BG = '#0a0e17';
const LABEL_INK = 'rgba(236,241,251,0.94)';
const HALO = 'rgba(5,7,13,0.9)';
const LINK_INK = 'rgba(148,163,184,0.20)';
const LINK_RECENT = 'rgba(170,186,210,0.34)';
const LINK_HOT = 'rgba(240,245,255,0.55)';
const DIM_TO = 0.3;
const BIG_R = 7.4;
const PULSE_CAP = 28;
const LABEL_CAP = 380;
/** At rest the drift redraws this often (9 Nov 2026, laggy: every frame repainted 15M pixels
 *  60 times a second for a 4px breath). Near zero work, still visibly breathing. */
const REST_DRAW_MS = 500;

const hashOf = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
/** Deterministic jitter in [-1, 1] from two hashes, so a vault opens the same way twice. */
const jitter = (a: number, b: number): number => {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 2147483648 - 1;
};
/** A colour lifted toward white (bright cores inside coloured glows). */
const lift = (hex: string, t: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
};
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const asNode = (n: SimNode | string | number): SimNode => n as SimNode;

export class LivingEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private live: HTMLElement | null;
  private onOpen: (id: string, newTab: boolean) => void;
  private onCentre: (id: string) => void;
  private onSelect: (id: string | null) => void;
  private compact: boolean;
  private sim: Simulation<SimNode, SimLink>;
  private linkForce = forceLink<SimNode, SimLink>([])
    .distance((l) => l.dist)
    .strength((l) => l.stiff);
  private areaX = forceX<SimNode>(0).strength(LIVING_AREA_PULL);
  private areaY = forceY<SimNode>(0).strength(LIVING_AREA_PULL);
  private nodes: SimNode[] = [];
  private links: SimLink[] = [];
  private byId = new Map<string, SimNode>();
  private linkAdj = new Map<string, SimLink[]>();
  private centreId: string | null = null;
  private lastCentre = '\0none';
  private fittedKey = '';
  private lastSig = '';
  private camTouched = false;
  private cam = { cx: 0, cy: 0, k: 1 };
  /** The base zoom the last centred frame read: the floor re-reads the same fit from it. */
  private frameBaseK = 1.25;
  private camAnim: { fx: number; fy: number; fk: number; tx: number; ty: number; tk: number; t0: number } | null = null;
  /** A wheel zoom still gliding: each notch retargets it, the frame eases the camera after it. */
  private zoomGoal: { k: number; cx: number; cy: number } | null = null;
  private hovered: string | null = null;
  private selected: string | null = null;
  private selIndex = -1;
  private pulses: Pulse[] = [];
  private dim = 1;
  private sprites = new Map<string, HTMLCanvasElement>();
  /** The ground and its vignette pre-rendered once per size (9 Nov 2026): screen-space, so it never moves
   *  with the camera - each frame blits it instead of filling 15M pixels twice. Same pixels, one copy. */
  private bgLayer: HTMLCanvasElement | null = null;
  /** The legend's measured box, kept until the data or the size changes it (9 Nov 2026: it ran a
   *  querySelector plus two layout-forcing rects 60 times a second). undefined means unmeasured. */
  private legendCache: { x: number; y: number; w: number; h: number } | null | undefined = undefined;
  /** Title widths per font and title (9 Nov 2026: up to LABEL_CAP measureTexts every frame, about
   *  2 ms throttled). The layout itself still runs every draw: freezing it while the points drift moves
   *  names relative to their points and flips the card's seat (card-place, this job). */
  private textW = new Map<string, number>();
  /** Bumped whenever new data lands: the rest check redraws on it even with the camera still. */
  private dataGen = 0;
  /** What the last draw saw: the rest check skips only while all of it holds still. */
  private drawnCam = { cx: NaN, cy: NaN, k: NaN };
  private drawnWH = { w: -1, h: -1 };
  private drawnGen = -1;
  private lastRestDraw = 0;
  /** The mouse is over the graph: it stays awake for the click that comes next (see the loop). */
  private pointerIn = false;
  /** Keeps the graphics side awake while the graph rests (see the constructor). */
  private pilot: CanvasRenderingContext2D | null = null;
  private pilotTick = 0;
  private drawCosts: number[] = [];
  private w = 0;
  private h = 0;
  private dsf = 1;
  private raf = 0;
  private running = false;
  private reduced = false;
  private mql: MediaQueryList | null = null;
  private ambientAt = 0;
  private fontStack = 'system-ui, sans-serif';
  private settleMs = 0;
  private restMs = 0;
  private settleN = 0;
  private restN = 0;
  private ac = new AbortController();
  private ro: ResizeObserver | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchD = 0;
  private dragNode: SimNode | null = null;
  private trace: string[] = [];
  private frames = 0;
  /** Where the last frame drew each point (drift included): what the hook reports and what taps hit. */
  private lastP = new Map<string, { x: number; y: number }>();
  private hitPts: LivingPoint[] = [];
  private lastTags: LivingSnapshotTag[] = [];
  private lastLabels: LivingSnapshotLabel[] = [];
  private pull = new Map<string, { x: number; y: number }>();
  /** The canvas shape the clouds were homed for: a resize across bands re-homes them (t37). */
  private lastHomeAspect = 0;
  private downAt = 0;
  private downX = 0;
  private downY = 0;
  private moved = false;
  private panning = false;

  constructor(
    canvas: HTMLCanvasElement,
    live: HTMLElement | null,
    opts: { compact: boolean; onOpen(id: string, newTab: boolean): void; onCentre(id: string): void; onSelect(id: string | null): void },
  ) {
    this.canvas = canvas;
    this.live = live;
    this.compact = opts.compact;
    this.onOpen = opts.onOpen;
    this.onCentre = opts.onCentre;
    this.onSelect = opts.onSelect;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    try {
      this.fontStack = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || this.fontStack;
    } catch {
      // A window without the app's type still draws.
    }
    // Links pull together (tight inside a project, loose across areas, so the gaps keep their long threads),
    // everything gently repels, and each area holds its own wide place, so clouds form and stay apart.
    // Each point's home lives in the pull map (rehome), so a new window shape re-lays without rebuilding.
    this.areaX.x((d) => this.pull.get(d.id)?.x ?? 0);
    this.areaY.y((d) => this.pull.get(d.id)?.y ?? 0);
    this.sim = forceSimulation<SimNode, SimLink>([])
      .force('link', this.linkForce)
      .force('charge', forceManyBody<SimNode>().strength(-130).distanceMax(420).theta(0.85))
      .force('center', forceCenter<SimNode>(0, 0))
      .force('collide', forceCollide<SimNode>().radius((d) => d.r + 3).strength(0.8).iterations(1))
      .force('ax', this.areaX)
      .force('ay', this.areaY)
      .velocityDecay(0.32)
      .alphaDecay(0.045)
      .alphaMin(0.008)
      .stop();
    // The settle lands somewhere roomier than the starting guess: frame it until the person takes the
    // camera themself (a pan, zoom, drag or walk), then never move it under them again. Folded (no box) never frames:
    // a 1px frame would shrink the vault tiny when the panel unfolds (break job, 8 Nov 2026).
    this.sim.on('end', () => {
      this.mark(`end:touched=${this.camTouched}`);
      if (!this.camTouched && this.nodes.length > 0 && this.w >= 2 && this.h >= 2) this.reframe();
    });
    const sig = this.ac.signal;
    // The pilot: a 4px canvas beside the graph, redrawn every frame while the graph rests in a window in front
    // (9 Nov 2026, laptop: the stutter's cause was the graphics side idling at rest; this alone took 40 spaced
    // clicks from 4-8 stalls of 200-470 ms per 10 to none, at near zero cost).
    try {
      const pilot = document.createElement('canvas');
      pilot.width = 4;
      pilot.height = 4;
      pilot.setAttribute('aria-hidden', 'true');
      pilot.className = 'lg-pilot';
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
        // Reduce-motion on: travelling pulses stop dead, drift stops with them; the highlight stays.
        if (this.reduced) this.pulses = [];
      }, { signal: sig });
    }
    if (typeof ResizeObserver === 'function' && canvas.parentElement) {
      this.ro = new ResizeObserver(() => this.size());
      this.ro.observe(canvas.parentElement);
    }
    window.addEventListener('resize', () => this.size(), { signal: sig });
    this.watchDpr();
    this.size();
    this.loop();
  }

  /** A display-scale change sharpens the backing without moving anything (t37, 8 Nov 2026): the query keys
   *  off the live scale, so each change re-arms the next one. */
  private watchDpr(): void {
    try {
      if (typeof matchMedia !== 'function') return;
      matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => {
        this.size();
        this.watchDpr();
      }, { signal: this.ac.signal });
    } catch {
      // An old window without resolution queries still draws; its resizes still sharpen.
    }
  }

  destroy(): void {
    this.ac.abort();
    this.ro?.disconnect();
    cancelAnimationFrame(this.raf);
    this.running = false;
    this.sim.stop();
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

  /** New points and threads (already scoped by the shell): positions stay with their ids, newcomers settle in. */
  setData(nodes: readonly LivingEngineNodeIn[], links: readonly LivingEngineLinkIn[], opts: { centreId: string | null }): void {
    // Typing elsewhere rebuilds the same world: nothing changed, nothing reheats, the settled page holds still.
    const sig = `${opts.centreId ?? ''}\n${nodes.map((n) => `${n.id}\t${n.title}`).join('\n')}\n${links.map((l) => `${l.source}\t${l.target}`).join('\n')}`;
    if (sig === this.lastSig) {
      this.mark('setData:identical-skip');
      return;
    }
    this.lastSig = sig;
    this.mark(`setData:n${nodes.length} centre=${opts.centreId ?? 'null'}`);
    // New data re-measures the legend (its height follows its areas) and wakes the rest check.
    this.legendCache = undefined;
    this.dataGen++;
    this.centreId = opts.centreId;
    const prev = this.byId;
    const now = performance.now();
    const counts = new Map<string, number>();
    for (const n of nodes) counts.set(n.area, (counts.get(n.area) ?? 0) + 1);
    this.rehome(nodes);
    // Newcomers start beside a neighbour they link to, else with their area, else anywhere near the middle.
    const pos = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      const p = prev.get(n.id);
      if (p) pos.set(n.id, { x: p.x, y: p.y });
    }
    const ids = new Set(nodes.map((n) => n.id));
    const adj = new Map<string, string[]>();
    for (const l of links) {
      if (!ids.has(l.source) || !ids.has(l.target)) continue;
      adj.set(l.source, [...(adj.get(l.source) ?? []), l.target]);
      adj.set(l.target, [...(adj.get(l.target) ?? []), l.source]);
    }
    // A first load spreads by area (chaining off half-placed neighbours would clump the vault and mist the
    // first fit); later newcomers settle in beside a neighbour they link to.
    const chaining = prev.size > 0;
    for (const n of nodes) {
      if (pos.has(n.id)) continue;
      const near = chaining ? (adj.get(n.id) ?? []).map((id) => pos.get(id)).find((q) => q) : undefined;
      const home = near ?? this.pull.get(n.id) ?? { x: 0, y: 0 };
      const h = hashOf(n.id);
      const spread = 48 + 5 * Math.sqrt(counts.get(n.area) ?? 1);
      pos.set(n.id, { x: home.x + jitter(h, 11) * spread, y: home.y + jitter(h, 77) * spread });
    }
    this.nodes = nodes.map((n) => {
      const p = pos.get(n.id)!;
      const hot = prev.get(n.id);
      return {
        id: n.id, title: n.title, area: n.area, colour: n.colour, core: lift(n.colour, 0.45),
        r: radiusForLivingDegree(n.degree), recent: n.recent, project: n.project, phase: (hashOf(n.id) % 628) / 100,
        flashUntil: hot && hot.flashUntil > now ? hot.flashUntil : 0,
        x: p.x, y: p.y, vx: hot?.vx ?? 0, vy: hot?.vy ?? 0,
      };
    });
    this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    // New world, no drawn positions yet: hits and the hook read the raw points until the next frame draws.
    this.hitPts = [];
    this.lastP.clear();
    this.links = links
      .filter((l) => this.byId.has(l.source) && this.byId.has(l.target) && l.source !== l.target)
      .map((l) => {
        const a = this.byId.get(l.source)!;
        const b = this.byId.get(l.target)!;
        const t = livingLinkTuning(a.area === b.area, !!a.project && a.project === b.project);
        return { source: a, target: b, recent: l.recent, dist: t.distance, stiff: t.strength };
      });
    this.linkAdj = new Map();
    for (const l of this.links) {
      const a = asNode(l.source);
      const b = asNode(l.target);
      this.linkAdj.set(a.id, [...(this.linkAdj.get(a.id) ?? []), l]);
      this.linkAdj.set(b.id, [...(this.linkAdj.get(b.id) ?? []), l]);
    }
    this.linkForce.links(this.links);
    this.sim.nodes(this.nodes);
    // Typing elsewhere must not shake the settled page: the same points only breathe, newcomers settle in.
    const sameIds = prev.size === this.byId.size && [...this.byId.keys()].every((id) => prev.has(id));
    if (this.hovered && !this.byId.has(this.hovered)) this.hovered = null;
    if (this.selected && !this.byId.has(this.selected)) {
      this.selected = null;
      this.selIndex = -1;
      this.onSelect(null);
    }
    // First sight of a vault or a centre frames it; later deltas never move the camera under the person.
    const key = `${this.compact ? 'local' : 'vault'}\n${opts.centreId ?? ''}\n${nodes.length > 0}`;
    if (key !== this.fittedKey && nodes.length > 0) {
      this.fittedKey = key;
      // A new view frames itself until the person takes the camera.
      this.camTouched = false;
      this.frame(true);
    }
    // A new centre arrives selected: its neighbourhood lights as it lands, and the arrow keys walk from it.
    // Deltas never reselect: typing elsewhere must not steal the walk.
    if ((opts.centreId ?? '') !== this.lastCentre) {
      this.lastCentre = opts.centreId ?? '';
      if (opts.centreId && this.byId.has(opts.centreId)) {
        this.selected = opts.centreId;
        this.selIndex = -1;
        if (livingMotion(this.reduced).pulses) this.fire(opts.centreId, false);
      } else {
        this.selected = null;
        this.selIndex = -1;
      }
    }
    // First sight warms fully; a delta barely breathes, even with a newcomer (typing in another tab
    // must not shake the settled page: the newcomer starts beside its neighbour and settles in).
    this.sim.alpha(prev.size === 0 ? 0.55 : sameIds ? 0.12 : 0.2).restart();
  }

  /** The usable canvas's shape (beside the legend): the anchors follow it in three bands. */
  private aspectOf(): number {
    const reserve = this.compact ? 0 : 220;
    return ((this.w || 800) - reserve) / (this.h || 600);
  }

  /** Each point's home: its area's place on the canvas-shaped ellipse, or its project's corner inside it. */
  private rehome(nodes: readonly { id: string; area: string; project: string | null }[]): void {
    const counts = new Map<string, number>();
    for (const n of nodes) counts.set(n.area, (counts.get(n.area) ?? 0) + 1);
    const anchor = livingAreaAnchors(counts, this.aspectOf());
    this.lastHomeAspect = this.aspectOf();
    // Each shown project's corner inside its area (only corners with company: a lone file keeps the middle).
    const members = new Map<string, number>();
    for (const n of nodes) if (n.project) members.set(n.project, (members.get(n.project) ?? 0) + 1);
    const projsByArea = new Map<string, string[]>();
    for (const n of nodes) {
      if (!n.project || (members.get(n.project) ?? 0) < 2) continue;
      const l = projsByArea.get(n.area) ?? [];
      if (!l.includes(n.project)) l.push(n.project);
      projsByArea.set(n.area, l);
    }
    const corners = new Map<string, { x: number; y: number }>();
    for (const [area, keys] of projsByArea) {
      const home = anchor.get(area) ?? { x: 0, y: 0 };
      keys.sort();
      keys.forEach((k, i) => corners.set(k, livingProjectAnchor(home, i, keys.length, members.get(k) ?? 2)));
    }
    this.pull.clear();
    for (const n of nodes) this.pull.set(n.id, (n.project && corners.get(n.project)) || anchor.get(n.area) || { x: 0, y: 0 });
    // d3 caches each point's home when the accessor is set: re-set, so the new homes take.
    this.areaX.x((d) => this.pull.get(d.id)?.x ?? 0);
    this.areaY.y((d) => this.pull.get(d.id)?.y ?? 0);
  }

  /** The vault fitted, or the centre middle with its neighbours round it. */
  private frame(instant: boolean): void {
    const c = this.centreId ? this.byId.get(this.centreId) : undefined;
    if (c) {
      // Centred: the centre middle, zoomed out past the resting zoom when its neighbours would strand off
      // the canvas (8 Nov 2026: the note's small panel kept half its neighbours out of reach, untappable).
      // The base the frame read is kept: the zoom-out floor re-reads the same fit, so the frame it framed
      // is the frame zooming out comes back to (break 10.1.8: a bounds floor above it stranded the frame).
      this.frameBaseK = this.cam.k || 1.25;
      const k = fitCentredK(c, this.nodes, this.w || 800, this.h || 600, this.compact, this.frameBaseK);
      this.mark(`frame:centre instant=${instant} k=${k.toFixed(2)}`);
      this.flyTo(c.x, c.y, k, instant);
      return;
    }
    if (!this.nodes.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of this.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    // The legend floats over the left (196 wide at 12 in): fit beside it, not under it, so no tag or name
    // hides beneath it now the vault fills the canvas. The note's own graph has no legend over it.
    const reserve = this.compact ? 0 : 220;
    const f = fitLivingView(minX, minY, maxX, maxY, (this.w || 800) - reserve, this.h || 600, this.compact ? 24 : 48);
    this.mark(`frame:vault instant=${instant} w=${this.w} h=${this.h} bw=${Math.round(maxX - minX)} bh=${Math.round(maxY - minY)} k=${f.k.toFixed(3)}`);
    this.flyTo(f.cx - reserve / 2 / f.k, f.cy, f.k, instant);
  }

  private reframe(): void {
    this.frame(false);
  }

  private mark(ev: string): void {
    this.trace.push(`${Math.round(performance.now())}:${ev}`);
    if (this.trace.length > 60) this.trace.shift();
  }

  snapshot(): LivingSnapshot {
    const costs = [...this.drawCosts].sort((a, b) => a - b);
    const at = (p: number): number => (costs.length ? Math.round(costs[Math.min(costs.length - 1, Math.floor(p * costs.length))] * 100) / 100 : 0);
    return {
      trace: [...this.trace],
      frames: this.frames,
      draw: { p50: at(0.5), p95: at(0.95), max: costs.length ? Math.round(costs[costs.length - 1] * 100) / 100 : 0, n: costs.length },
      nodes: this.nodes.map((n) => {
        const p = this.lastP.get(n.id) ?? n;
        return { id: n.id, title: n.title, x: this.sx(p.x), y: this.sy(p.y), r: n.r * this.cam.k };
      }),
      count: this.nodes.length,
      links: this.links.length,
      centre: this.centreId,
      selected: this.selected,
      hovered: this.hovered,
      pulses: this.pulses.length,
      reduced: this.reduced,
      settled: this.sim.alpha() <= 0.012,
      cam: { ...this.cam },
      taken: this.camTouched,
      framed: this.camAnim === null && this.sim.alpha() <= 0.012,
      settleMs: this.settleN ? Math.round((this.settleMs / this.settleN) * 100) / 100 : 0,
      restMs: this.restN ? Math.round((this.restMs / this.restN) * 100) / 100 : 0,
      tags: [...this.lastTags],
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
    // What is drawn is what is hit: the drifted points, so a breathing point still lands under its tap.
    return hitLivingNode(this.hitPts.length === this.nodes.length && this.nodes.length > 0 ? this.hitPts : (this.nodes as LivingPoint[]), p.x, p.y);
  }

  private down(e: PointerEvent): void {
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture?.(e.pointerId);
    const r = this.canvas.getBoundingClientRect();
    this.pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchD = Math.hypot(a.x - b.x, a.y - b.y);
      this.dragNode = null;
      this.panning = false;
      this.zoomGoal = null;
      return;
    }
    const id = this.hit(e.clientX, e.clientY);
    this.downAt = performance.now();
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.moved = false;
    this.panning = !id;
    this.dragNode = id ? this.byId.get(id) ?? null : null;
  }

  private move(e: PointerEvent): void {
    this.pointerIn = true;
    const r = this.canvas.getBoundingClientRect();
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      // A pinch follows the fingers with no glide behind them (a wheel glides; fingers do not lag).
      if (this.pinchD > 0 && d > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinchD, true);
      this.pinchD = d;
      this.moved = true;
      return;
    }
    if (e.buttons === 0) {
      const id = this.hit(e.clientX, e.clientY);
      // A hover brightens (the draw lights it); only a click fires, so the firing stays the click's answer.
      if (id !== this.hovered) this.hovered = id;
      this.canvas.style.cursor = id ? 'pointer' : 'grab';
      return;
    }
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 4) this.moved = true;
    if (this.dragNode && this.moved) {
      // Dragging a point is taking the camera too (t37): a later resize keeps the arranged view.
      this.camTouched = true;
      const p = this.toWorld(e.clientX, e.clientY);
      this.dragNode.fx = p.x;
      this.dragNode.fy = p.y;
      this.sim.alphaTarget(0.2).restart();
      this.canvas.style.cursor = 'grabbing';
    } else if (this.panning && this.moved) {
      this.camTouched = true;
      this.cam.cx -= e.movementX / this.cam.k;
      this.cam.cy -= e.movementY / this.cam.k;
      this.camAnim = null;
      this.zoomGoal = null;
      this.canvas.style.cursor = 'grabbing';
    }
  }

  private up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchD = 0;
    if (this.dragNode) {
      // Let go: it settles back where the forces want it.
      this.dragNode.fx = null;
      this.dragNode.fy = null;
      this.dragNode = null;
      this.sim.alphaTarget(0);
    }
    this.panning = false;
    this.canvas.style.cursor = this.hovered ? 'pointer' : 'grab';
    const quick = performance.now() - this.downAt < 450;
    if (!this.moved && quick && this.pointers.size === 0) {
      const id = this.hit(e.clientX, e.clientY);
      if (id) {
        // One click selects at once (8 Nov 2026, the no-wait clicks: the 500 ms hold made every
        // click feel like lag). No waiting for a second tap: select and fire now, Ctrl opens beside now,
        // the double-click itself opens.
        this.mark(`up:select=${id}`);
        this.select(id, false);
        if (e.ctrlKey || e.metaKey) this.onOpen(id, true);
      } else if (this.selected) {
        this.selected = null;
        this.selIndex = -1;
        this.say('');
        this.onSelect(null);
        // Clearing by hand takes the camera too: the framing glide stops where the person clicked.
        this.camTouched = true;
        this.camAnim = null;
        this.zoomGoal = null;
      }
    }
    this.moved = false;
  }

  private leave(): void {
    this.pointerIn = false;
    this.hovered = null;
    this.canvas.style.cursor = 'grab';
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    // About 1.1x per notch toward the pointer (9 Nov 2026: one flick hit the 8x cap and lost the view);
    // trackpad and pinch deltas glide through the same factor, gently.
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    if (!dy || !Number.isFinite(dy)) return;
    const r = this.canvas.getBoundingClientRect();
    this.zoomAt(e.clientX - r.left, e.clientY - r.top, livingWheelFactor(dy));
  }

  private double(e: MouseEvent): void {
    // Double-click opens the point in this tab (8 Nov 2026, the no-wait clicks: centring moved to
    // the card and Space). The two taps already selected it, so this only opens, once. With Ctrl held the
    // taps already opened beside, so it opens nothing more. On empty space it does nothing.
    const id = this.hit(e.clientX, e.clientY);
    if (!id) return;
    if (e.ctrlKey || e.metaKey) return;
    if (this.selected !== id) this.select(id, false);
    this.mark(`double:open=${id}`);
    this.onOpen(id, false);
  }

  private linkPairs(): { source: string; target: string }[] {
    return this.links.map((l) => ({ source: asNode(l.source).id, target: asNode(l.target).id }));
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
      // Space centres on the selected point (8 Nov 2026, the no-wait clicks: centring left the
      // double-click for the card and the keyboard). The walk below stays as it is.
      const id = this.selected ?? this.hovered ?? this.centreId;
      if (id && this.byId.has(id)) {
        e.preventDefault();
        this.onCentre(id);
      }
      return;
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const from = this.selected ?? this.hovered ?? this.centreId;
    let ring: string[] = from ? livingNeighbours(from, this.linkPairs()) : [];
    if (!ring.length) {
      // Nowhere to walk from: start at the brightest point.
      const big = [...this.nodes].sort((a, b) => b.r - a.r || a.title.localeCompare(b.title))[0];
      if (!big) return;
      ring = [big.id];
    }
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    this.selIndex = ring.includes(this.selected ?? '') ? ring.indexOf(this.selected!) : fwd ? -1 : 0;
    this.selIndex = (this.selIndex + (fwd ? 1 : -1) + ring.length) % ring.length;
    this.select(ring[this.selIndex]);
  }

  private select(id: string, follow = true): void {
    this.selected = id;
    // Selecting takes the camera (click or keys): the framing glide stops under the tap, so the point holds
    // still for a second tap, and no later settle yanks it back.
    this.camTouched = true;
    this.camAnim = null;
    this.zoomGoal = null;
    const n = this.byId.get(id);
    if (!n) return;
    if (livingMotion(this.reduced).pulses) this.fire(id, false);
    this.say(`${n.title}, ${plural(livingNeighbours(id, this.linkPairs()).length, 'link')}`);
    this.onSelect(id);
    // Only the keyboard walk brings its point back: a clicked point is already under the cursor, and flying
    // it to the middle would slide it out from under a second tap (8 Nov 2026, the no-wait clicks broke this
    // way on near-edge points until the walk kept its follow to itself).
    if (!follow) return;
    const x = this.sx(n.x);
    const y = this.sy(n.y);
    const m = 80;
    if (x < m || x > this.w - m || y < m || y > this.h - m) this.flyTo(n.x, n.y, this.cam.k, false);
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

  /** The Areas legend's box in screen pixels (t73, 9 Nov 2026): labels collide with it, so none hides
   *  under it. Measured, never a constant - its height follows its areas - but kept until the data or the
   *  size changes it (this job: measuring ran every frame). None when compact (no legend). */
  private legendBox(): { x: number; y: number; w: number; h: number } | null {
    if (this.compact) return null;
    if (this.legendCache !== undefined) return this.legendCache;
    const el = this.canvas.parentElement?.querySelector('.lg-legend');
    if (!el) return (this.legendCache = null);
    const lr = el.getBoundingClientRect();
    if (lr.width < 2 || lr.height < 2) return (this.legendCache = null);
    const cr = this.canvas.getBoundingClientRect();
    return (this.legendCache = { x: lr.left - cr.left + lr.width / 2, y: lr.top - cr.top + lr.height / 2, w: lr.width, h: lr.height });
  }

  /** The zoom-out limit: the whole shown world fitted (never out past the fit into empty space).
   *  Centred, it is the centred frame itself, re-read with the base the frame read — a bounds floor sits
   *  above an edge centre's frame and strands it (break 10.1.8). */
  private minK(): number {
    if (!this.nodes.length) return 0.12;
    const c = this.centreId ? this.byId.get(this.centreId) : undefined;
    if (c) return fitCentredK(c, this.nodes, this.w || 800, this.h || 600, this.compact, this.frameBaseK);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of this.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    const reserve = this.compact ? 0 : 220;
    const f = fitLivingView(minX, minY, maxX, maxY, (this.w || 800) - reserve, this.h || 600, this.compact ? 24 : 48);
    // A tiny world fits past 1x; the limit still leaves room to zoom back out from its frame.
    return Math.min(f.k, 1);
  }

  private zoomAt(sx: number, sy: number, f: number, direct = false): void {
    this.camTouched = true;
    // Each notch retargets the glide from the last goal (a flick compounds smoothly); the frame eases after
    // it. A pinch and reduce-motion apply at once: fingers do not lag, and stillness means stillness.
    const base = this.zoomGoal ?? this.cam;
    const k = clamp(base.k * f, this.minK(), LIVING_ZOOM_MAX);
    const wx = (sx - this.w / 2) / base.k + base.cx;
    const wy = (sy - this.h / 2) / base.k + base.cy;
    const cx = wx - (sx - this.w / 2) / k;
    const cy = wy - (sy - this.h / 2) / k;
    this.camAnim = null;
    if (direct || this.reduced) {
      this.cam = { cx, cy, k };
      this.zoomGoal = null;
      return;
    }
    this.zoomGoal = { k, cx, cy };
  }

  private flyTo(cx: number, cy: number, k: number, instant: boolean): void {
    this.zoomGoal = null;
    if (instant || this.reduced) {
      this.cam = { cx, cy, k };
      this.camAnim = null;
      return;
    }
    this.camAnim = { fx: this.cam.cx, fy: this.cam.cy, fk: this.cam.k, tx: cx, ty: cy, tk: k, t0: performance.now() };
  }

  // ── firing ───────────────────────────────────────────────────────────────

  /** Bright pulses out along a note's links (hover or keyboard-select): neurons firing. */
  private fire(id: string, faint: boolean): void {
    const from = this.byId.get(id);
    if (!from) return;
    const outs = (this.linkAdj.get(id) ?? [])
      .map((l) => (asNode(l.source).id === id ? asNode(l.target) : asNode(l.source)))
      .filter((n) => n && n.id !== id)
      .sort((a, b) => b.r - a.r || a.title.localeCompare(b.title))
      .slice(0, PULSE_CAP);
    const now = performance.now();
    outs.forEach((n, i) => {
      const d = Math.hypot(n.x - from.x, n.y - from.y);
      this.pulses.push({ a: from, b: n, t0: now + i * 28, dur: 380 + d * 0.9, faint });
    });
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
    this.dsf = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dsf);
    this.canvas.height = Math.round(this.h * this.dsf);
    // A new size re-measures the legend with it and pre-renders the ground once.
    this.legendCache = undefined;
    this.buildBg();
    // A resize re-fits while the framing is still automatic (t37, 8 Nov 2026: opened small then made big
    // stayed a little cluster in a huge canvas); once the person has taken the camera it keeps their view.
    // Across aspect bands the clouds re-home too (one fixed shape cannot fill both past 70%), but a pixel
    // of chrome wobble near a band edge must never reheat the world. A scale change alone only sharpens.
    // A folded panel (a 1px box) never frames; unfolding grows the box and frames here (t36 with t37).
    if (!grew || this.camTouched || !this.nodes.length || this.w < 2 || this.h < 2) return;
    const nowAspect = this.aspectOf();
    if (this.lastHomeAspect > 0 && livingAspectBand(nowAspect) !== livingAspectBand(this.lastHomeAspect) && Math.abs(nowAspect - this.lastHomeAspect) > 0.04) {
      this.mark(`size:rehome band=${livingAspectBand(this.lastHomeAspect)}->${livingAspectBand(nowAspect)}`);
      this.rehome(this.nodes);
      this.sim.alpha(0.35).restart();
    }
    this.mark(`size:refit w=${this.w} h=${this.h}`);
    this.reframe();
  }

  /** The ground and its vignette, drawn once per size into the blit layer (the same stops the frame
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

  private seen(): void {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.running = false;
      this.sim.stop();
    } else if (!this.running) {
      this.loop();
      if (this.sim.alpha() > 0.012) this.sim.restart();
    }
  }

  private loop(): void {
    this.running = true;
    const step = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(step);
      // The scale can change without a resize or a media-query change reaching us (a dragged window,
      // headless emulation): a frame behind at most, the backing sharpens without moving anything.
      try {
        if (Math.min(2, window.devicePixelRatio || 1) !== this.dsf) this.size();
      } catch {
        // A window without a scale still draws.
      }
      if (this.w < 2 || this.h < 2 || document.hidden) return;
      const t0 = performance.now();
      const motion = livingMotion(this.reduced);
      const settled = this.sim.alpha() <= 0.012;
      // At full rest with reduce-motion on, the frame holds still until something changes it.
      if (!motion.drift) {
        if (!settled || this.pulses.length || this.hovered || this.selected || this.camAnim || this.zoomGoal) {
          this.draw(t0);
        } else if (this.dim !== 1) {
          this.dim = 1;
          this.draw(t0);
        }
      } else if (this.restQuiet(t0, settled) && !this.pointerIn) {
        // At rest only the drift moves. With the mouse over the graph the frame keeps drawing every frame: measured
        // on the laptop (9 Nov 2026), a graph that rested at a low rate let the graphics side idle, and the first
        // click or drag after a pause waited 200 to 470 ms for it to wake; drawing every frame (0.7 ms of work)
        // took 40 spaced clicks from 4-8 stalls per 10 to none. Every click starts with the mouse arriving over the
        // graph, so it is awake by then. With the mouse elsewhere it rests at a low rate, near zero work.
        if (t0 - this.lastRestDraw >= REST_DRAW_MS) {
          this.draw(t0);
          this.lastRestDraw = t0;
        } else if (this.pilot && document.hasFocus()) {
          this.pilot.fillStyle = (this.pilotTick++ & 1) ? '#0b0f17' : '#0c1018';
          this.pilot.fillRect(0, 0, 4, 4);
        }
      } else {
        this.draw(t0);
        this.lastRestDraw = t0;
      }
      const cost = performance.now() - t0;
      if (settled) {
        this.restMs += cost;
        this.restN++;
      } else {
        this.settleMs += cost;
        this.settleN++;
      }
      if (this.settleN + this.restN > 4000) {
        this.settleMs /= 2;
        this.restMs /= 2;
        this.settleN = Math.ceil(this.settleN / 2);
        this.restN = Math.ceil(this.restN / 2);
      }
    };
    this.raf = requestAnimationFrame(step);
  }

  /** True when a skip changes nothing but the drift's phase: settled, nothing travelling, nothing
   *  held, nothing easing, the camera/data/size exactly as drawn, and no ambient pulse due (a due pulse
   *  draws, so the firing stays alive at rest). */
  private restQuiet(now: number, settled: boolean): boolean {
    if (!settled || this.pulses.length || this.hovered || this.dragNode || this.camAnim || this.zoomGoal) return false;
    if (now >= this.ambientAt) return false;
    const focus = this.hovered ?? this.selected;
    const dimWant = focus && this.byId.has(focus) ? DIM_TO : 1;
    if (this.dim !== dimWant) return false;
    const dc = this.drawnCam;
    if (this.cam.cx !== dc.cx || this.cam.cy !== dc.cy || this.cam.k !== dc.k) return false;
    if (this.w !== this.drawnWH.w || this.h !== this.drawnWH.h) return false;
    return this.dataGen === this.drawnGen;
  }

  private sprite(colour: string): HTMLCanvasElement {
    const had = this.sprites.get(colour);
    if (had) return had;
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 96;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(48, 48, 2, 48, 48, 48);
    grad.addColorStop(0, colour);
    grad.addColorStop(0.25, `${colour}cc`);
    grad.addColorStop(0.55, `${colour}55`);
    grad.addColorStop(1, `${colour}00`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 96, 96);
    this.sprites.set(colour, g.canvas);
    return g.canvas;
  }

  private drift(n: SimNode, now: number, on: boolean): { x: number; y: number } {
    if (!on) return { x: n.x, y: n.y };
    // The network breathes: a slow drift of a few pixels on screen at any zoom (9 Nov 2026: a world-unit
    // drift shrank under the resting zoom past noticing, and the vault read as still and flat).
    const amp = 4 / this.cam.k;
    return {
      x: n.x + Math.sin(now * 0.00055 + n.phase) * amp,
      y: n.y + Math.cos(now * 0.0004 + n.phase * 1.7) * amp,
    };
  }

  private draw(now: number): void {
    this.frames++;
    const { ctx, w, h } = this;
    const motion = livingMotion(this.reduced);
    if (this.camAnim) {
      const a = this.camAnim;
      const t = clamp((now - a.t0) / 350, 0, 1);
      const e = t * t * (3 - 2 * t);
      this.cam = { cx: a.fx + (a.tx - a.fx) * e, cy: a.fy + (a.ty - a.fy) * e, k: a.fk + (a.tk - a.fk) * e };
      if (t >= 1) this.camAnim = null;
    }
    // A wheel glide chases its goal a quarter of the way each frame, landing whole when it is close.
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
    }
    const cam = this.cam;
    const focus = this.hovered ?? this.selected;
    const focusNode = focus ? this.byId.get(focus) : undefined;
    const near = new Set<string>();
    if (focusNode) {
      near.add(focusNode.id);
      for (const l of this.linkAdj.get(focusNode.id) ?? []) {
        near.add(asNode(l.source).id);
        near.add(asNode(l.target).id);
      }
    }
    const dimWant = focusNode ? DIM_TO : 1;
    this.dim += (dimWant - this.dim) * (this.reduced ? 1 : 0.18);
    if (Math.abs(this.dim - dimWant) < 0.01) this.dim = dimWant;
    // Now and then, a soft pulse along a lately-touched link: where the week went. Calm, never busy.
    // It resumes once a click's firing fades (a resting selection never stills it); only a hover holds it.
    if (motion.ambient && !this.hovered && !this.dragNode && !this.pulses.length && now >= this.ambientAt) {
      const recents = this.links.filter((l) => l.recent);
      if (recents.length) {
        const l = recents[Math.floor(Math.random() * recents.length)];
        const a = asNode(l.source);
        const b = asNode(l.target);
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.pulses.push({ a, b, t0: now, dur: 900 + d, faint: true });
      }
      this.ambientAt = now + 3800 + Math.random() * 3600;
    }
    // Arrived pulses light their neighbour, then fade.
    for (const p of this.pulses) {
      if (now >= p.t0 + p.dur) p.b.flashUntil = now + (p.faint ? 550 : 700);
    }
    this.pulses = this.pulses.filter((p) => now < p.t0 + p.dur + 30);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.bgLayer) ctx.drawImage(this.bgLayer, 0, 0);
    else {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    const k = cam.k;
    ctx.setTransform(this.dsf * k, 0, 0, this.dsf * k, this.dsf * (w / 2 - cam.cx * k), this.dsf * (h / 2 - cam.cy * k));
    ctx.lineCap = 'round';
    const P = new Map<string, { x: number; y: number }>();
    for (const n of this.nodes) P.set(n.id, this.drift(n, now, motion.drift));
    const at = (n: SimNode) => P.get(n.id)!;
    // What is drawn is what the hook reports and what taps hit.
    this.lastP = P;
    this.hitPts = this.nodes.map((n) => ({ id: n.id, x: P.get(n.id)!.x, y: P.get(n.id)!.y, r: n.r }));
    // Threads, faint at rest: one path for the quiet ones, one for lately-touched, one for the firing.
    const hotLinks = new Set<SimLink>();
    if (focusNode) for (const l of this.linkAdj.get(focusNode.id) ?? []) hotLinks.add(l);
    const pass = (test: (l: SimLink) => boolean, style: string, width: number) => {
      ctx.beginPath();
      for (const l of this.links) {
        if (!test(l)) continue;
        const a = at(asNode(l.source));
        const b = at(asNode(l.target));
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = width / k;
      ctx.stroke();
    };
    pass((l) => !l.recent && !hotLinks.has(l), LINK_INK, 1);
    pass((l) => l.recent && !hotLinks.has(l), LINK_RECENT, 1.1);
    if (hotLinks.size) pass((l) => hotLinks.has(l), LINK_HOT, 1.6);
    // Points: pre-rendered glow, then a bright core. The rest dims a little so the firing reads.
    for (const n of this.nodes) {
      const p = at(n);
      const a = near.size && !near.has(n.id) ? this.dim : 1;
      const s = n.r * 5;
      ctx.globalAlpha = a * 0.6;
      ctx.drawImage(this.sprite(n.colour), p.x - s / 2, p.y - s / 2, s, s);
      ctx.globalAlpha = a;
      ctx.fillStyle = n.core;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.2, n.r * 0.52), 0, Math.PI * 2);
      ctx.fill();
      // The firing's source burns white-hot while it fires; a hover only brightens, inviting the click.
      if (focusNode && n.id === focusNode.id) {
        const hoverOnly = n.id === this.hovered && n.id !== this.selected;
        ctx.globalAlpha = a * (hoverOnly ? 0.16 : 0.35);
        const hs = n.r * (hoverOnly ? 5 : 6);
        ctx.drawImage(this.sprite('#ffffff'), p.x - hs / 2, p.y - hs / 2, hs, hs);
        ctx.globalAlpha = a;
      }
      if (n.flashUntil > now) {
        const f = (n.flashUntil - now) / 700;
        ctx.globalAlpha = a * f;
        const fs = n.r * 7;
        ctx.drawImage(this.sprite('#ffffff'), p.x - fs / 2, p.y - fs / 2, fs, fs);
        ctx.globalAlpha = a;
      }
    }
    ctx.globalAlpha = 1;
    // The pulses themselves: bright beads running down the threads.
    for (const p of this.pulses) {
      const t = clamp((now - p.t0) / p.dur, 0, 1);
      if (t <= 0 || t >= 1) continue;
      const a = at(p.a);
      const b = at(p.b);
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const s = (p.faint ? 11 : 13) * (0.7 + 0.3 * Math.sin(t * Math.PI));
      ctx.globalAlpha = p.faint ? 0.65 : 0.95;
      ctx.drawImage(this.sprite(p.a.colour), x - s / 2, y - s / 2, s, s);
      ctx.globalAlpha = p.faint ? 0.75 : 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, (p.faint ? 1.7 : 2.1) / Math.sqrt(k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.drawMarks(at, focusNode);
    this.drawWords(at, near);
    this.drawnCam = { ...this.cam };
    this.drawnWH = { w, h };
    this.drawnGen = this.dataGen;
    this.drawCosts.push(performance.now() - now);
    if (this.drawCosts.length > 120) this.drawCosts.shift();
  }

  private drawMarks(at: (n: SimNode) => { x: number; y: number }, focusNode: SimNode | undefined): void {
    const { ctx } = this;
    const ring = (n: SimNode, style: string, pad: number, width: number) => {
      const p = at(n);
      ctx.strokeStyle = style;
      ctx.lineWidth = width / this.cam.k;
      ctx.beginPath();
      ctx.arc(p.x, p.y, n.r + pad, 0, Math.PI * 2);
      ctx.stroke();
    };
    const c = this.centreId ? this.byId.get(this.centreId) : undefined;
    if (c) {
      ring(c, 'rgba(255,255,255,0.85)', 5, 1.5);
      ring(c, 'rgba(255,255,255,0.22)', 10, 1);
    }
    if (this.selected && this.byId.get(this.selected)) ring(this.byId.get(this.selected)!, '#ff7a59', 3.5, 1.6);
    if (focusNode && focusNode.id !== this.selected) ring(focusNode, 'rgba(255,255,255,0.5)', 3.5, 1.2);
  }

  /** A title's width in a font, measured once and kept (this job: the same titles measured every
   *  frame). Capped: a vault of renames never grows it without bound. */
  private measure(font: string, title: string): number {
    const key = `${font}|${title}`;
    let w = this.textW.get(key);
    if (w === undefined) {
      this.ctx.font = font;
      w = this.ctx.measureText(title).width;
      if (this.textW.size > 4000) this.textW.clear();
      this.textW.set(key, w);
    }
    return w;
  }

  private drawWords(at: (n: SimNode) => { x: number; y: number }, near: Set<string>): void {
    const { ctx, cam, w, h } = this;
    // Words keep a fixed screen size at every zoom (9 Nov 2026: at 8x two names filled the canvas); only the
    // space between points grows. Candidates are measured and collided in screen pixels, then drawn under a
    // screen transform. Sizes match the old look at 1x.
    const fsFor = (r: number): number => 11 + r * 0.28;
    const zoomed = cam.k > LIVING_ZOOMED_K;
    // At rest each cluster's biggest few carry names; the lit ones (hovered, selected, centred, neighbours)
    // always do. Zoomed in, every plausible name may show. Rank first (free), measure only the plausible
    // (measuring thousands of titles every frame would cost the budget); widths come from the cache.
    const hot = new Set<string>(near);
    if (this.centreId) hot.add(this.centreId);
    const rest = zoomed ? null : livingRestLabelIds(this.nodes, hot);
    const ranked: { id: string; rank: number }[] = [];
    for (const n of this.nodes) {
      const lit = hot.has(n.id);
      const isCentre = n.id === this.centreId;
      const touch = n.id === this.hovered || n.id === this.selected;
      if (!lit) {
        if (zoomed) {
          const needK = clamp(3.4 - n.r * 0.34, 1.15, 3.4);
          if (n.r < BIG_R && cam.k < needK) continue;
        } else if (!rest!.has(n.id)) continue;
      }
      ranked.push({ id: n.id, rank: n.r * 100 + (touch ? 100000 : 0) + (isCentre ? 50000 : 0) + (lit && !touch && !isCentre ? 10000 : 0) });
    }
    ranked.sort((a, b) => b.rank - a.rank);
    const cands: LivingLabel[] = [];
    for (const { id, rank } of ranked.slice(0, LABEL_CAP)) {
      const n = this.byId.get(id)!;
      const fs = fsFor(n.r);
      const tw = this.measure(`${fs}px ${this.fontStack}`, n.title);
      const p = at(n);
      const sx = this.sx(p.x);
      const sy = this.sy(p.y);
      cands.push({ id: `n:${id}`, x: sx, y: sy - n.r * cam.k - fs * 0.7, w: tw + 10, h: fs + 6, rank });
    }
    // Each cluster a small pill in its colour at its edge, as in the reference picture; pills avoid each other,
    // and names yield to them. Zoomed in, the tags rest and the names take over.
    const tagFont = `600 11px ${this.fontStack}`;
    const tagById = new Map<string, { name: string; colour: string }>();
    if (!zoomed) {
      const colourOf = new Map<string, string>();
      for (const n of this.nodes) if (!colourOf.has(n.area)) colourOf.set(n.area, n.colour);
      const tags = livingClusterTags(this.nodes).filter((t) => t.count >= 3);
      // The placer separates in world units, so screen sizes scale down into it; clamping and drawing stay pixels.
      const boxes: (LivingTagBox & { name: string; colour: string; count: number; sw: number; sh: number })[] = tags.map((t) => {
        const sw = this.measure(tagFont, t.name) + 26;
        return {
          area: t.area, x: t.x, y: t.y, w: sw / cam.k, h: 26 / cam.k, edge: t.edge,
          name: t.name, colour: colourOf.get(t.area) ?? '#38bdf8', count: t.count, sw, sh: 26,
        };
      });
      let ox = 0;
      let oy = 0;
      for (const n of this.nodes) {
        ox += n.x;
        oy += n.y;
      }
      const placed = livingPlaceTags(boxes, ox / (this.nodes.length || 1), oy / (this.nodes.length || 1));
      for (const b of boxes) {
        const p = placed.get(b.area)!;
        // Keep the whole pill on the canvas and clear of the legend: an extreme cloud would push it past
        // the edge. The no-overlap pass below still guards what the clamp brings together.
        const mx = b.sw / 2 + 6;
        const my = b.sh / 2 + 6;
        const lx = this.compact ? mx : 214 + mx;
        const sx = clamp((p.x - cam.cx) * cam.k + w / 2, lx, Math.max(lx, w - mx));
        const sy = clamp((p.y - cam.cy) * cam.k + h / 2, my, Math.max(my, h - my));
        if (sx < -80 || sx > w + 80 || sy < -40 || sy > h + 40) continue;
        cands.push({ id: `t:${b.area}`, x: sx, y: sy, w: b.sw, h: b.sh, rank: 20000 + b.count });
        tagById.set(`t:${b.area}`, b);
      }
    }
    const shown = resolveLivingLabels(cands, this.legendBox() ?? undefined);
    this.lastTags = [];
    this.lastLabels = [];
    ctx.setTransform(this.dsf, 0, 0, this.dsf, 0, 0);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const c of cands) {
      if (!shown.has(c.id)) continue;
      const isTag = c.id.startsWith('t:');
      const dimmed = near.size > 0 && !isTag && !near.has(c.id.slice(2));
      ctx.globalAlpha = dimmed ? Math.max(0.25, this.dim) : 1;
      if (isTag) {
        const t = tagById.get(c.id)!;
        const pw = c.w - 6;
        const ph = 20;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(c.x - pw / 2, c.y - ph / 2, pw, ph, ph / 2);
        else ctx.rect(c.x - pw / 2, c.y - ph / 2, pw, ph);
        ctx.fillStyle = 'rgba(8,11,19,0.92)';
        ctx.fill();
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = t.colour;
        ctx.stroke();
        ctx.font = tagFont;
        ctx.fillStyle = '#edf1f9';
        ctx.fillText(t.name, c.x, c.y + 0.5);
        this.lastTags.push({ area: c.id.slice(2), name: t.name, x: c.x, y: c.y, w: c.w, h: c.h });
      } else {
        const n = this.byId.get(c.id.slice(2))!;
        const fs = fsFor(n.r);
        ctx.font = `${fs}px ${this.fontStack}`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = HALO;
        ctx.strokeText(n.title, c.x, c.y);
        ctx.fillStyle = LABEL_INK;
        ctx.fillText(n.title, c.x, c.y);
        this.lastLabels.push({ id: n.id, x: c.x, y: c.y, w: c.w, h: c.h });
      }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
  }
}
