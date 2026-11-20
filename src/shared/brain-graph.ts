// The brain graph's pure layout (9 Nov 2026, on the living graph). A design-first prototype in its own files
// (living-engine.ts is another job's): areas sit as lobes of one brain silhouette, left and right halves with
// a fold between, never floating apart; bigger notes sit nearer the core; links are short soft curves,
// bundled through the fold where many run between the same two lobes. Deterministic and static: the same
// vault lays out the same way twice, and the canvas draws it once instead of settling a simulation every
// frame. Pure: no files, no Node, no DOM.

import {
  colourForLivingArea,
  isLivingRecent,
  livingAreaName,
  livingAreaOf,
  orderLivingAreas,
  radiusForLivingDegree,
} from './living-graph';

export type BrainDesign = 'halves' | 'rings' | 'folds';
export type BrainLens = 'all' | 'recent' | 'people' | 'projects';

/** The fold's half width in world units: no lobe and no point ever sits within it. */
export const BRAIN_FOLD_HALF = 52;
/** The silhouette all three designs share, roughly: one rounded brain, wider than tall. */
export const BRAIN_R = { x: 560, y: 400 };

export interface BrainNodeIn {
  id: string;
  title: string;
  /** Notes under People/, or typed person: the People lens. */
  person?: boolean;
  /** Project files and notes that belong to one: the Projects lens. */
  project?: boolean;
  mtime?: number;
}

export interface BrainLinkIn {
  source: string;
  target: string;
}

export interface BrainLobe {
  area: string;
  name: string;
  colour: string;
  count: number;
  /** The lobe's middle and its ellipse, in world units. */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Where the lobe's name sits, in world units: clearly in or at the edge of its own lobe. */
  lx: number;
  ly: number;
  /** Rings only: the wedge this lobe fills, in radians, so its name slides along its own edge clear of the graph's own boxes. */
  wedge?: { a0: number; a1: number };
}

export interface BrainPlaced {
  id: string;
  title: string;
  area: string;
  name: string;
  colour: string;
  x: number;
  y: number;
  r: number;
  degree: number;
  recent: boolean;
  person: boolean;
  project: boolean;
  /** No links at all: drawn faint at the brain's edge, as loose thoughts. */
  loose: boolean;
  /** The note's own graph only: 0 the middle, 1 its links, 2 the faint outer step. The whole brain leaves it empty. */
  hop?: 0 | 1 | 2;
}

export interface BrainCurve {
  source: string;
  target: string;
  /** Quadratic control: the curve bows through it. */
  cx: number;
  cy: number;
  /** Within one lobe, or across two (bundled through the fold trunk). */
  across: boolean;
  /** Routed through the pair's shared trunk waypoint (long cross-lobe threads only). */
  trunk: boolean;
  /** Both ends lately touched: the curve itself reads brighter. */
  recent: boolean;
}

export interface BrainLayout {
  design: BrainDesign;
  nodes: BrainPlaced[];
  curves: BrainCurve[];
  lobes: BrainLobe[];
  /** Unlinked notes, by title: the "loose thoughts" caption counts these. */
  loose: { id: string; title: string }[];
  /** Where the "loose thoughts" caption sits, in world units. */
  looseAt: { x: number; y: number };
  /** The whole brain's bounds, for the fitted view. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

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

/** Split ordered areas into left and right halves with roughly even counts. */
function splitHalves(ordered: readonly string[], counts: ReadonlyMap<string, number>): { left: string[]; right: string[] } {
  const left: string[] = [];
  const right: string[] = [];
  let nl = 0;
  let nr = 0;
  for (const a of ordered) {
    const n = counts.get(a) ?? 0;
    if (nl <= nr) {
      left.push(a);
      nl += n;
    } else {
      right.push(a);
      nr += n;
    }
  }
  // One area, or everything on one side: the brain still has two halves, so the emptier side keeps the
  // smallest lobe and the fold still reads.
  if (left.length && !right.length) right.push(left.pop()!);
  if (right.length && !left.length) left.push(right.pop()!);
  return { left, right };
}

interface LobePlan {
  area: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Rings only: the wedge this lobe fills, in radians. */
  wedge?: { a0: number; a1: number };
}

function planHalves(ordered: readonly string[], counts: ReadonlyMap<string, number>): LobePlan[] {
  const { left, right } = splitHalves(ordered, counts);
  const out: LobePlan[] = [];
  const column = (areas: string[], side: -1 | 1): void => {
    const hs = areas.map((a) => 64 + 14 * Math.sqrt(Math.max(1, counts.get(a) ?? 1)));
    const total = hs.reduce((t, h) => t + h, 0) + 12 * Math.max(0, areas.length - 1);
    let y = -total / 2;
    areas.forEach((a, i) => {
      const h = hs[i];
      const cy = y + h / 2;
      y += h + 12;
      const rx = Math.min(198, 104 + 13 * Math.sqrt(Math.max(1, counts.get(a) ?? 1)));
      // The ellipse's inner edge rests just clear of the fold, so no lobe crosses it.
      out.push({ area: a, cx: side * (BRAIN_FOLD_HALF + 8 + rx), cy, rx, ry: h / 2 });
    });
  };
  column(left, -1);
  column(right, 1);
  return out;
}

function planRings(ordered: readonly string[], counts: ReadonlyMap<string, number>): LobePlan[] {
  // Wedges grouped left and right, with the fold as an angular gap top and bottom middle: no wedge crosses
  // the fold, so the two halves read even in a disc.
  const { left, right } = splitHalves(ordered, counts);
  const out: LobePlan[] = [];
  const side = (areas: string[], a0: number, a1: number): void => {
    const weights = areas.map((a) => Math.sqrt(Math.max(1, counts.get(a) ?? 1)));
    const sum = weights.reduce((t, w) => t + w, 0) || 1;
    let a = a0;
    areas.forEach((area, i) => {
      const span = ((weights[i] / sum) * (a1 - a0));
      const mid = a + span / 2;
      const wedge = { a0: a + span * 0.06, a1: a + span * 0.94 };
      a += span;
      const rr = 205;
      const cx = Math.cos(mid) * rr;
      const cy = Math.sin(mid) * rr * 0.78;
      const rad = 74 + 15 * Math.sqrt(Math.max(1, counts.get(area) ?? 1));
      out.push({ area, cx, cy, rx: rad * 1.15, ry: rad * 0.95, wedge });
    });
  };
  // Right half: -64°..64°; left half: 116°..244°. The gaps at top and bottom middle are the fold.
  const d = Math.PI / 180;
  side(right, -64 * d, 64 * d);
  side(left, 116 * d, 244 * d);
  return out;
}

function planFolds(ordered: readonly string[], counts: ReadonlyMap<string, number>): LobePlan[] {
  // Horizontal folded bands, each split at the fold; bands alternate their reach so the silhouette's edge
  // waves like folds instead of a ladder. One plan row per area per side would double the legend's lobes, so
  // each area keeps one plan with the wider side's middle; its points split left and right at draw time.
  const hs = ordered.map((a) => 36 + 7 * Math.sqrt(Math.max(1, counts.get(a) ?? 1)));
  const total = hs.reduce((t, h) => t + h, 0) + 14 * Math.max(0, ordered.length - 1);
  let y = -total / 2;
  return ordered.map((area, i) => {
    const h = hs[i];
    const cy = y + h / 2;
    y += h + 14;
    const wave = 1 + 0.1 * Math.sin(i * 2.2);
    const rx = Math.min(250, (118 + 15 * Math.sqrt(Math.max(1, counts.get(area) ?? 1))) * wave);
    return { area, cx: 0, cy, rx, ry: h / 2 };
  });
}

/** Push a point clear of the fold, keeping its side (a middle point takes its hash's side). */
function clearFold(x: number, id: string): number {
  if (Math.abs(x) >= BRAIN_FOLD_HALF) return x;
  const s = x === 0 ? (hashOf(id) % 2 === 0 ? 1 : -1) : Math.sign(x);
  return s * BRAIN_FOLD_HALF;
}

/**
 * Lay the vault out as a brain: lobes of one silhouette in two halves with a fold between, hubs nearer
 * the core than leaves, unlinked notes faint at the edge. `now` anchors recency; pass the same vault twice
 * and every point lands on the same pixel.
 */
export function brainLayout(
  nodes: readonly BrainNodeIn[],
  links: readonly BrainLinkIn[],
  design: BrainDesign,
  now: number = Date.now(),
): BrainLayout {
  const ids = new Set(nodes.map((n) => n.id));
  const degree = new Map<string, number>();
  const kept: BrainLinkIn[] = [];
  for (const l of links) {
    if (l.source === l.target || !ids.has(l.source) || !ids.has(l.target)) continue;
    kept.push(l);
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const a = livingAreaOf(n.id);
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const ordered = orderLivingAreas(counts);
  const plans = design === 'halves' ? planHalves(ordered, counts)
    : design === 'rings' ? planRings(ordered, counts)
    : planFolds(ordered, counts);
  const planOf = new Map(plans.map((p) => [p.area, p]));
  // Each lobe's name sits clearly in its own lobe (10 Nov 2026, rings polish: "Work" sat among purple
  // points, its crown pushed north into the next wedge). Rings names sit out along the wedge's middle,
  // past the rim-most points, at the lobe's edge; halves keep their crowns; folds step aside by turns.
  // The wedge rides with its rings lobe (9 Nov 2026, "Hea": Health sat under the find box): the engine
  // slides a colliding name along its own edge to the nearest clear spot, never hiding it.
  const lobes: BrainLobe[] = plans.map((p, i) => {
    let lx = p.cx;
    let ly = p.cy - p.ry * 0.62;
    if (design === 'rings' && p.wedge) {
      const mid = (p.wedge.a0 + p.wedge.a1) / 2;
      lx = Math.cos(mid) * 430;
      ly = Math.sin(mid) * 430 * 0.78;
    } else if (design === 'folds') {
      lx = (i % 2 === 0 ? 1 : -1) * (BRAIN_FOLD_HALF + 66);
    }
    return {
      area: p.area,
      name: livingAreaName(p.area),
      colour: colourForLivingArea(p.area, ordered),
      count: counts.get(p.area) ?? 0,
      cx: p.cx,
      cy: p.cy,
      rx: p.rx,
      ry: p.ry,
      lx,
      ly,
      ...(design === 'rings' && p.wedge ? { wedge: { ...p.wedge } } : {}),
    };
  });

  // Bigger notes nearer the core: each lobe lays its linked notes biggest-first on a golden spiral, so rank
  // 0 sits nearest the lobe's middle and the rank grows outward.
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const placed: BrainPlaced[] = [];
  const pos = new Map<string, { x: number; y: number }>();
  const loose: { id: string; title: string }[] = [];
  const byArea = new Map<string, BrainNodeIn[]>();
  for (const n of nodes) {
    const a = livingAreaOf(n.id);
    const l = byArea.get(a) ?? [];
    l.push(n);
    byArea.set(a, l);
  }
  const recentOf = (n: BrainNodeIn): boolean => isLivingRecent(n.mtime, now);
  for (const [area, list] of byArea) {
    const p = planOf.get(area)!;
    const linked = list
      .filter((n) => (degree.get(n.id) ?? 0) > 0)
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.title.localeCompare(b.title));
    linked.forEach((n, i) => {
      const h = hashOf(n.id);
      const t = linked.length <= 1 ? 0 : Math.sqrt((i + 0.5) / linked.length);
      let x: number;
      let y: number;
      if (design === 'folds') {
        // Highest rank nearest the fold (the core-ward end), lowest toward the rim; rows alternate sides by
        // rank so the band fills both halves. Each band arcs gently, edges lower, like a fold of cortex.
        const side = i % 2 === 0 ? (h % 2 === 0 ? 1 : -1) : h % 2 === 0 ? -1 : 1;
        const reach = p.rx - BRAIN_FOLD_HALF - 14;
        x = side * (BRAIN_FOLD_HALF + 10 + t * Math.max(20, reach));
        const arc = Math.pow(Math.min(1, Math.abs(x) / 260), 2) * 30;
        y = p.cy + arc * 0.4 + jitter(h, 913) * p.ry * 0.62 * (0.35 + 0.65 * t);
      } else if (design === 'rings' && p.wedge) {
        // Along the wedge, hubs near the core and leaves toward the rim.
        const span = p.wedge.a1 - p.wedge.a0;
        const ang = p.wedge.a0 + span * (0.5 + jitter(h, 211) * 0.42);
        const rad = 66 + t * 300 * (1 + jitter(h, 213) * 0.1);
        x = Math.cos(ang) * rad;
        y = Math.sin(ang) * rad * 0.78;
      } else {
        const a = i * GOLDEN + jitter(h, 31) * 0.7;
        const spread = 0.16 + 0.84 * t;
        const jx = 1 + jitter(h, 77) * 0.12;
        const jz = 1 + jitter(h, 101) * 0.12;
        x = p.cx + Math.cos(a) * p.rx * spread * jx;
        y = p.cy + Math.sin(a) * p.ry * spread * jz;
      }
      x = clearFold(x, n.id);
      pos.set(n.id, { x, y });
      placed.push({
        id: n.id, title: n.title, area, name: livingAreaName(area),
        colour: colourForLivingArea(area, ordered), x, y,
        r: radiusForLivingDegree(degree.get(n.id) ?? 0), degree: degree.get(n.id) ?? 0,
        recent: recentOf(n), person: !!n.person, project: !!n.project, loose: false,
      });
    });
    for (const n of list) {
      if ((degree.get(n.id) ?? 0) > 0) continue;
      loose.push({ id: n.id, title: n.title });
    }
  }
  // Loose thoughts along the brain's lower rim, faint: spread by title so they rest the same way twice.
  loose.sort((a, b) => a.title.localeCompare(b.title));
  const rimY = BRAIN_R.y + 34;
  loose.forEach((l, i) => {
    const n = byId.get(l.id)!;
    const h = hashOf(l.id);
    const t = loose.length <= 1 ? 0.5 : (i + 0.5) / loose.length;
    const x = clearFold((t - 0.5) * 2 * (BRAIN_R.x - 60), l.id);
    const y = rimY + Math.abs(jitter(h, 555)) * 26 - Math.sin(t * Math.PI) * 18;
    pos.set(l.id, { x, y });
    placed.push({
      id: l.id, title: n.title, area: livingAreaOf(l.id), name: livingAreaName(livingAreaOf(l.id)),
      colour: colourForLivingArea(livingAreaOf(l.id), ordered), x, y, r: 3,
      degree: 0, recent: recentOf(n), person: !!n.person, project: !!n.project, loose: true,
    });
  });

  // Curves: within a lobe a short soft bow; across lobes a shared trunk waypoint per lobe pair, so many
  // threads between the same two lobes run as one nerve bundle instead of long straight lines across the
  // space. The waypoint sits off the pair's corridor (each pair bows its own way, always the same way), so
  // the bundle arcs softly; a waypoint on the corridor would draw the straight lines we are rid of.
  const trunkOf = new Map<string, { x: number; y: number }>();
  const trunk = (a: string, b: string): { x: number; y: number } => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const had = trunkOf.get(key);
    if (had) return had;
    const pa = planOf.get(a)!;
    const pb = planOf.get(b)!;
    const h = hashOf(key);
    const mx = (pa.cx + pb.cx) / 2;
    const my = (pa.cy + pb.cy) / 2;
    const dx = pb.cx - pa.cx;
    const dy = pb.cy - pa.cy;
    const len = Math.hypot(dx, dy) || 1;
    const off = (56 + (h % 40)) * (jitter(h, 41) >= 0 ? 1 : -1);
    const w = { x: mx + (-dy / len) * off + jitter(h, 43) * 12, y: my + (dx / len) * off + jitter(h, 47) * 12 };
    trunkOf.set(key, w);
    return w;
  };
  const curves: BrainCurve[] = kept.map((l) => {
    const a = pos.get(l.source)!;
    const b = pos.get(l.target)!;
    const an = livingAreaOf(l.source);
    const bn = livingAreaOf(l.target);
    const h = hashOf(`${l.source}|${l.target}`);
    const recent = recentOf(byId.get(l.source)!) && recentOf(byId.get(l.target)!);
    const straight = Math.hypot(a.x - b.x, a.y - b.y);
    // Neighbours lying close together keep a short bow even across a lobe boundary: routing them through
    // an off-corridor trunk would draw a long loop where a short thread belongs.
    if (an === bn || straight < 220) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const bow = len * 0.18 * (jitter(h, 7) >= 0 ? 1 : -1);
      return {
        source: l.source, target: l.target,
        cx: mx + (-dy / len) * bow, cy: my + (dx / len) * bow,
        across: an !== bn, trunk: false, recent,
      };
    }
    const w = trunk(an, bn);
    return {
      source: l.source, target: l.target,
      cx: w.x + jitter(h, 61) * 9, cy: w.y + jitter(h, 67) * 9,
      across: true, trunk: true, recent,
    };
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placed) {
    minX = Math.min(minX, p.x - p.r);
    minY = Math.min(minY, p.y - p.r);
    maxX = Math.max(maxX, p.x + p.r);
    maxY = Math.max(maxY, p.y + p.r);
  }
  if (!placed.length) {
    minX = -BRAIN_R.x;
    minY = -BRAIN_R.y;
    maxX = BRAIN_R.x;
    maxY = BRAIN_R.y;
  }
  return {
    design, nodes: placed, curves, lobes, loose,
    looseAt: { x: 0, y: rimY + 44 },
    bounds: { minX, minY, maxX, maxY },
  };
}

/**
 * The note's own small graph (t151, 9 Nov 2026): the note in the middle, its links and backlinks around it
 * (one step), with a second step faint outside. Coloured by area as the big graph is (the caller passes its
 * ordered areas, so the same area keeps its colour), the same soft short bows for threads, the same engine
 * draws it (no second renderer). Deterministic. A note with no links returns its middle alone, so the panel
 * shows nothing (no empty box).
 */
export function brainLocalLayout(
  centreId: string,
  nodes: readonly BrainNodeIn[],
  links: readonly BrainLinkIn[],
  now: number = Date.now(),
  colourOrder?: readonly string[],
): BrainLayout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const centre = byId.get(centreId);
  if (!centre) return { design: 'rings', nodes: [], curves: [], lobes: [], loose: [], looseAt: { x: 0, y: 0 }, bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 } };
  const ids = new Set(nodes.map((n) => n.id));
  const kept: BrainLinkIn[] = [];
  const adj = new Map<string, Set<string>>();
  const touch = (a: string, b: string): void => {
    if (!adj.get(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const l of links) {
    if (l.source === l.target || !ids.has(l.source) || !ids.has(l.target)) continue;
    kept.push(l);
    touch(l.source, l.target);
    touch(l.target, l.source);
  }
  const degree = new Map<string, number>();
  for (const l of kept) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  const hop = new Map<string, 0 | 1 | 2>([[centreId, 0]]);
  for (const id of adj.get(centreId) ?? []) hop.set(id, 1);
  for (const id of [...hop.keys()].filter((x) => hop.get(x) === 1)) {
    for (const o of adj.get(id) ?? []) if (!hop.has(o)) hop.set(o, 2);
  }
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const a = livingAreaOf(n.id);
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const ordered = colourOrder ?? orderLivingAreas(counts);
  const recentOf = (n: BrainNodeIn): boolean => isLivingRecent(n.mtime, now);
  const mk = (n: BrainNodeIn, x: number, y: number, h: 0 | 1 | 2): BrainPlaced => ({
    id: n.id, title: n.title, area: livingAreaOf(n.id), name: livingAreaName(livingAreaOf(n.id)),
    colour: colourForLivingArea(livingAreaOf(n.id), ordered), x, y,
    r: radiusForLivingDegree(degree.get(n.id) ?? 0), degree: degree.get(n.id) ?? 0,
    recent: recentOf(n), person: !!n.person, project: !!n.project, loose: false, hop: h,
  });
  const one = [...hop].filter(([, h]) => h === 1).map(([id]) => byId.get(id)!).sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.title.localeCompare(b.title));
  const two = [...hop].filter(([, h]) => h === 2).map(([id]) => byId.get(id)!).sort((a, b) => a.title.localeCompare(b.title));
  const placed: BrainPlaced[] = [mk(centre, 0, 0, 0)];
  const pos = new Map<string, { x: number; y: number }>([[centreId, { x: 0, y: 0 }]]);
  const angOf = new Map<string, number>();
  const r1 = 120 + 10 * Math.sqrt(Math.max(1, one.length));
  one.forEach((n, i) => {
    const h = hashOf(n.id);
    const a = (i / Math.max(1, one.length)) * Math.PI * 2 - Math.PI / 2 + jitter(h, 301) * 0.08;
    const r = r1 + jitter(h, 303) * 12;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    pos.set(n.id, { x, y });
    angOf.set(n.id, a);
    placed.push(mk(n, x, y, 1));
  });
  const r2 = r1 + 110 + 6 * Math.sqrt(Math.max(1, two.length));
  for (const n of two) {
    const h = hashOf(n.id);
    const parents = [...(adj.get(n.id) ?? [])].filter((p) => hop.get(p) === 1).sort();
    const pa = parents.length ? (angOf.get(parents[0]) ?? 0) : (h % 628) / 100;
    const a = pa + jitter(h, 305) * 0.35;
    const r = r2 + jitter(h, 307) * 20;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    pos.set(n.id, { x, y });
    placed.push(mk(n, x, y, 2));
  }
  const curves: BrainCurve[] = kept.filter((l) => hop.has(l.source) && hop.has(l.target)).map((l) => {
    const a = pos.get(l.source)!;
    const b = pos.get(l.target)!;
    const h = hashOf(`${l.source}|${l.target}`);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = len * 0.18 * (jitter(h, 7) >= 0 ? 1 : -1);
    return { source: l.source, target: l.target, cx: mx + (-dy / len) * bow, cy: my + (dx / len) * bow, across: livingAreaOf(l.source) !== livingAreaOf(l.target), trunk: false, recent: recentOf(byId.get(l.source)!) && recentOf(byId.get(l.target)!) };
  });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placed) {
    minX = Math.min(minX, p.x - p.r);
    minY = Math.min(minY, p.y - p.r);
    maxX = Math.max(maxX, p.x + p.r);
    maxY = Math.max(maxY, p.y + p.r);
  }
  return { design: 'rings', nodes: placed, curves, lobes: [], loose: [], looseAt: { x: 0, y: 0 }, bounds: { minX, minY, maxX, maxY } };
}

/** Whether a note reads lit under a lens (the lens re-lights; it never rebuilds). */
export function brainLensMatch(
  lens: BrainLens,
  node: { recent: boolean; person: boolean; project: boolean },
): boolean {
  switch (lens) {
    case 'all':
      return true;
    case 'recent':
      return node.recent;
    case 'people':
      return node.person;
    case 'projects':
      return node.project;
  }
}

export const BRAIN_LENSES: readonly { id: BrainLens; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'recent', label: 'Recent' },
  { id: 'people', label: 'People' },
  { id: 'projects', label: 'Projects' },
];

/** Which notes count for a lens, so the shell can say how many each choice holds. */
export function brainLensCount(lens: BrainLens, nodes: readonly { recent: boolean; person: boolean; project: boolean }[]): number {
  return nodes.filter((n) => brainLensMatch(lens, n)).length;
}

export interface BrainSummaryIn {
  /** Recent notes per area, busiest first. */
  recentByArea: readonly (readonly [string, number])[];
  recentTotal: number;
  looseCount: number;
}

/**
 * The short line under the title: what is busiest and what is unlinked. Plain Australian English, no
 * em dash in the words a person sees.
 */
export function brainSummary(s: BrainSummaryIn): string {
  const loose = s.looseCount === 0
    ? 'every note is linked'
    : s.looseCount === 1
      ? '1 loose thought not linked to anything'
      : `${s.looseCount} loose thoughts not linked to anything`;
  if (s.recentTotal === 0) return `Nothing touched this week \u00b7 ${loose}`;
  const top = s.recentByArea[0]?.[0] ?? '';
  const name = livingAreaName(top);
  return `${name} is busiest this week \u00b7 ${loose}`;
}

/** Search the brain by name: titles starting with the words first, then titles holding them, then paths. */
export function brainSearch(nodes: readonly { id: string; title: string }[], query: string, limit = 6): { id: string; title: string }[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const rankOf = (n: { id: string; title: string }): number | null => {
    const t = n.title.toLowerCase();
    if (t.startsWith(q)) return 0;
    if (t.includes(q)) return 1;
    if (n.id.toLowerCase().includes(q)) return 2;
    return null;
  };
  return nodes
    .map((n) => ({ n, r: rankOf(n) }))
    .filter((o): o is { n: { id: string; title: string }; r: number } => o.r !== null)
    .sort((a, b) => a.r - b.r || a.n.title.localeCompare(b.n.title))
    .slice(0, Math.max(0, limit))
    .map((o) => o.n);
}
