// The living graph's pure engine (8 Nov 2026): which notes are points, their area colours, their sizes, which
// labels draw without ever overlapping, the note's own two-step neighbourhood, and what moves (nothing travels
// with reduce-motion on). The canvas and the forces live in src/renderer/src/components/GraphView.tsx; this
// file holds only the decisions, so tests/living-graph.test.mjs proves them without a window. Pure: no files,
// no Node, no DOM.

import { splitBillRow } from './bills-table';
import { isMachineryPath } from './fewer-folders';
import { topFolderOf } from './graph-scope';
import { personRecordIdOfTab } from './people';
import { isPrivatePath } from './private';
import { splitRowPath, tableKindOfPath } from './system-tables';

/** The store folders the machinery rule reads (fewer-folders.ts MachineryCtx, without areas: the graph hides the
 *  app's own folders wherever they sit, never a person's area). Docs are not named: docs are the person's own. */
export interface LivingStore {
  templatesFolder?: string;
  assetsFolder?: string;
  attachmentsFolder?: string;
  dailyFolder?: string;
}

/** A note counts as lately touched (its links may carry the faint rest pulse) while changed within this many days. */
export const LIVING_RECENT_DAYS = 7;
/** Legend rows before "+N more areas": the legend never scrolls (a nav panel never scrolls). */
export const LIVING_LEGEND_SHOW = 12;

/** Always hidden, even with Show everything: the Private notes folder (ITEMS: "the Private notes folder, always").
 *  The vault never lists it, so this is a guard, never the only wall. */
export function isAlwaysHiddenGraphPath(path: string): boolean {
  return isPrivatePath(path);
}

/**
 * Hidden unless the legend's Show everything is on (ITEMS: the app's own folders, machine lists, Private always).
 * No second list: the machinery rule (fewer-folders.ts) names the app's folders - templates, assets, attachments,
 * views, dashboards, reviews, daily notes - with docs exempt (docs are the person's own, as the Notes page holds),
 * the Systems tables hide by file name (Machines.md, Services.md, Runbooks.md, anywhere, by name only), and
 * anything flagged a template hides with the templates. Private hides here too, but Show everything never brings
 * it back (isAlwaysHiddenGraphPath).
 */
export function isDefaultHiddenGraphPath(path: string, store: LivingStore = {}, template = false): boolean {
  if (template) return true;
  if (isPrivatePath(path)) return true;
  if (tableKindOfPath(path)) return true;
  return isMachineryPath(path, { ...store, docsFolder: '', areas: null, moduleFolders: [] });
}

/** Whether a change this old still reads as lately touched. */
export function isLivingRecent(mtime: number | undefined | null, now: number = Date.now()): boolean {
  return typeof mtime === 'number' && Number.isFinite(mtime) && now - mtime < LIVING_RECENT_DAYS * 86400000;
}

export type LivingKind = 'note' | 'file' | 'missing' | 'tag';
export interface LivingNodeIn {
  id: string;
  title: string;
  kind: LivingKind;
  template?: boolean;
  /** In a folder the person kept out of view (fewer-folders.ts quietFolders): hidden like a template. */
  quiet?: boolean;
  /** A project's file (the index's relations.ts says so): the corner its notes gather toward. */
  project?: boolean;
  /** The project file that owns this note (relations.ts owner rule): its corner, when it has one. */
  owner?: string;
}
export interface LivingLinkIn {
  source: string;
  target: string;
  strength?: number;
}
export interface LivingScopeOpts {
  /** The legend's quiet switch: the rest shows (Private never does). */
  showRest?: boolean;
  /** Areas the legend hid. */
  hiddenAreas?: readonly string[];
  /** The vault's store folders, from Settings. */
  store?: LivingStore;
  /** Ids shown regardless (the centred note, the open note): noise never takes the middle. */
  forceIds?: readonly string[];
}

/** A point's area: its top folder ('' for the top of the vault). */
export const livingAreaOf = (id: string): string => topFolderOf(id);
/** An area's words in the legend and on its tag. */
export const livingAreaName = (area: string): string => area || 'Top level';

/** What can be a point: notes and files. A note not written yet is no place, and a tag is a label, not a place. */
const isPointKind = (kind: LivingKind): boolean => kind === 'note' || kind === 'file';

/** The points and threads that draw: scoped to what shows, links only between shown points, never a loop. */
export function livingScope(
  nodes: readonly LivingNodeIn[],
  links: readonly LivingLinkIn[],
  opts: LivingScopeOpts = {},
): { nodes: LivingNodeIn[]; links: LivingLinkIn[] } {
  const forced = new Set(opts.forceIds ?? []);
  const hiddenAreas = new Set(opts.hiddenAreas ?? []);
  const kept = new Map<string, LivingNodeIn>();
  for (const n of nodes) {
    if (!isPointKind(n.kind) || kept.has(n.id)) continue;
    if (isAlwaysHiddenGraphPath(n.id)) continue;
    if (!forced.has(n.id)) {
      if (!opts.showRest && isDefaultHiddenGraphPath(n.id, opts.store, !!n.template || !!n.quiet)) continue;
      if (hiddenAreas.has(livingAreaOf(n.id))) continue;
    }
    kept.set(n.id, n);
  }
  return { nodes: [...kept.values()], links: links.filter((l) => l.source !== l.target && kept.has(l.source) && kept.has(l.target)) };
}

/**
 * Bright, clear point colours that read on the dark canvas (ITEMS: colour by top folder or area - Work, Business,
 * Home, Me and so on). Coral first, the app's own accent; the rest cool and clear. Data points on dark, not UI:
 * no cream, beige, honey, pink or amber.
 */
export const LIVING_PALETTE: readonly string[] = [
  '#ff7a59', // coral, the app's own accent
  '#2dd4bf', // teal
  '#38bdf8', // sky
  '#a78bfa', // violet
  '#4ade80', // green
  '#facc15', // yellow
  '#fb923c', // orange
  '#a3e635', // lime
  '#818cf8', // indigo
];

/** Areas busiest first, then by name: the legend's order, and the palette's. */
export function orderLivingAreas(counts: ReadonlyMap<string, number> | readonly (readonly [string, number])[]): string[] {
  const rows: [string, number][] = [...counts].map(([a, n]) => [a, n]);
  const n = new Map(rows);
  return rows.map(([area]) => area).sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || livingAreaName(a).localeCompare(livingAreaName(b)));
}

/** An area's colour: its place in the ordered areas, round the palette (past nine areas colours repeat). */
export function colourForLivingArea(area: string, ordered: readonly string[]): string {
  const at = ordered.indexOf(area);
  return LIVING_PALETTE[(at < 0 ? ordered.length : at) % LIVING_PALETTE.length];
}

/** A point's radius in world units: grows with its links, fast at first then nearly flat, so one hub never eats
 *  the page (0 links: 3.2; 4: 6.6; 25: 11.7; past ~48 it holds at 15). */
export function radiusForLivingDegree(degree: number): number {
  const d = Math.max(0, Number.isFinite(degree) ? degree : 0);
  return Math.min(15, 3.2 + Math.sqrt(d) * 1.7);
}

export interface LivingLabel {
  id: string;
  /** Centre in world units, size in world units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bigger draws first and stays; the smaller hides on a collision. */
  rank: number;
}

/**
 * Which labels draw: biggest first, each kept only when its box clears every kept one (ITEMS: labels never pile
 * on top of each other - hide the smaller one when two collide). Cluster tags run through the same pass with
 * high ranks, so a label yields to a tag, never over it. The legend's box rides along as already kept (t73,
 * 9 Nov 2026, the shot: "Weekend heat then Monday southerly cold front" ran under the Areas legend
 * and read as "Veekend…"): a label collides with it the way it collides with any other, so the smaller one -
 * the label - hides. The caller offers only plausible labels (big points, hovered, zoomed); this pass only
 * enforces the no-overlap rule. Names stacked a line apart read as one smudge under the link lines (t76,
 * 9 Nov 2026: "Me note 10" over "Me note 11" passed at 26px), so the check asks daylight between names -
 * wider vertical clearance - not just clear boxes.
 */
export function resolveLivingLabels(cands: readonly LivingLabel[], legend?: { x: number; y: number; w: number; h: number }): Set<string> {
  const sorted = [...cands].sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
  const kept: LivingLabel[] = legend ? [{ id: '\0legend', x: legend.x, y: legend.y, w: legend.w, h: legend.h, rank: Number.POSITIVE_INFINITY }] : [];
  const out = new Set<string>();
  for (const c of sorted) {
    let hit = false;
    for (const k of kept) {
      if (Math.abs(c.x - k.x) * 2 < c.w + k.w + 6 && Math.abs(c.y - k.y) * 2 < c.h + k.h + 18) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      kept.push(c);
      out.add(c.id);
    }
  }
  return out;
}

export interface LivingTag {
  area: string;
  name: string;
  x: number;
  y: number;
  count: number;
  /** How far the cloud runs from its middle: the tag sits past this, at the cluster's edge. */
  edge: number;
}

/** Each area's floating tag: its name at its points' middle, with how many it names and how wide it runs.
 *  Two passes over the caller's array, nothing kept per point: it runs every frame on thousands of points. */
export function livingClusterTags(nodes: readonly { area: string; x: number; y: number }[]): LivingTag[] {
  const byArea = new Map<string, { x: number; y: number; count: number }>();
  for (const n of nodes) {
    const had = byArea.get(n.area) ?? { x: 0, y: 0, count: 0 };
    had.x += n.x;
    had.y += n.y;
    had.count++;
    byArea.set(n.area, had);
  }
  const spread = new Map<string, number>();
  for (const n of nodes) {
    const t = byArea.get(n.area)!;
    const dx = n.x - t.x / t.count;
    const dy = n.y - t.y / t.count;
    spread.set(n.area, (spread.get(n.area) ?? 0) + dx * dx + dy * dy);
  }
  return [...byArea].map(([area, t]) => ({
    area,
    name: livingAreaName(area),
    x: t.x / t.count,
    y: t.y / t.count,
    count: t.count,
    edge: Math.sqrt((spread.get(area) ?? 0) / t.count) * 1.4 + 30,
  }));
}

export interface LivingTagBox {
  area: string;
  /** The cluster's middle, and the pill's measured size in world units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The cloud's edge from livingClusterTags: the tag sits past it. */
  edge: number;
}

/**
 * Each tag to its cluster's edge, none on another (9 Nov 2026, clusters you can read: the middle pile of
 * tags was the tangled ball's middle showing through). Pushed out from the vault's middle past its cloud's
 * edge, then eased apart until no two pills touch. Deterministic: sorted areas, fixed passes.
 */
export function livingPlaceTags(tags: readonly LivingTagBox[], cx: number, cy: number): Map<string, { x: number; y: number }> {
  const sorted = [...tags].sort((a, b) => a.area.localeCompare(b.area));
  const pos = new Map<string, { x: number; y: number }>();
  sorted.forEach((t, i) => {
    let dx = t.x - cx;
    let dy = t.y - cy;
    if (Math.hypot(dx, dy) < 1) {
      const a = (i / Math.max(1, sorted.length)) * Math.PI * 2 - Math.PI / 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
    }
    const d = Math.hypot(dx, dy);
    const off = t.edge + 26;
    pos.set(t.area, { x: t.x + (dx / d) * off, y: t.y + (dy / d) * off });
  });
  const touching = (a: LivingTagBox, b: LivingTagBox, pa: { x: number; y: number }, pb: { x: number; y: number }): boolean =>
    Math.abs(pa.x - pb.x) * 2 < a.w + b.w + 12 && Math.abs(pa.y - pb.y) * 2 < a.h + b.h + 10;
  for (let pass = 0; pass < 120; pass++) {
    let moved = false;
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        const pa = pos.get(a.area)!;
        const pb = pos.get(b.area)!;
        if (!touching(a, b, pa, pb)) continue;
        moved = true;
        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        if (Math.hypot(dx, dy) < 1) {
          dx = j - i;
          dy = 0.5;
        }
        const d = Math.hypot(dx, dy);
        pa.x -= (dx / d) * 7;
        pa.y -= (dy / d) * 7;
        pb.x += (dx / d) * 7;
        pb.y += (dy / d) * 7;
      }
    }
    if (!moved) break;
  }
  return pos;
}

/** A point's project corner: its own file when it is a project, else the project the index says owns it. */
export function livingProjectOf(node: { id: string; project?: boolean; owner?: string | null }): string | null {
  if (node.project) return node.id;
  return node.owner ?? null;
}

export interface LivingAnchor {
  x: number;
  y: number;
}

/** The canvas-shape band the anchors follow: narrow, wide, or their hard ultrawide. One source: the engine's resize check
reads this too. */
export function livingAspectBand(aspect: number): 'narrow' | 'wide' | 'ultra' {
  return aspect < 1.45 ? 'narrow' : aspect < 2.0 ? 'wide' : 'ultra';
}

/**
 * Each area's own place (9 Nov 2026, clusters you can read: the ball untangled into a glowing cloud per
 * area): spread around the canvas on an ellipse shaped like it, so the fitted vault fills a narrow window
 * and their hard ultrawide alike - one fixed shape cannot fill both past 70%. `aspect` is the usable
 * canvas (beside the legend), in three bands; each area's arc is sized by its count (a cloud's width
 * grows with the square root of its points), busiest first like the legend. One area sits in the middle.
 */
export function livingAreaAnchors(
  counts: ReadonlyMap<string, number> | readonly (readonly [string, number])[],
  aspect = 1.7,
): Map<string, LivingAnchor> {
  const rows = new Map<string, number>([...counts].map(([a, n]) => [a, Math.max(0, n)]));
  const ordered = orderLivingAreas(rows);
  const out = new Map<string, LivingAnchor>();
  if (!ordered.length) return out;
  if (ordered.length === 1) {
    out.set(ordered[0], { x: 0, y: 0 });
    return out;
  }
  let total = 0;
  for (const n of rows.values()) total += n;
  const shape = { narrow: { fx: 1.5, fy: 0.9 }, wide: { fx: 1.6, fy: 0.78 }, ultra: { fx: 2.45, fy: 0.62 } }[livingAspectBand(aspect)];
  const base = 150 + 11 * Math.sqrt(Math.max(1, total));
  const rx = base * shape.fx;
  const ry = base * shape.fy;
  const weights = ordered.map((a) => Math.sqrt(Math.max(1, rows.get(a) ?? 1)));
  const sum = weights.reduce((t, w) => t + w, 0);
  let angle = -Math.PI / 2;
  ordered.forEach((a, i) => {
    const mid = angle + ((weights[i] / sum) * Math.PI * 2) / 2;
    out.set(a, { x: Math.cos(mid) * rx, y: Math.sin(mid) * ry });
    angle += (weights[i] / sum) * Math.PI * 2;
  });
  return out;
}

/**
 * A project's own corner inside its area's place: members gather a little tighter around it, loose notes
 * stay on the area's middle. One project keeps the middle (nothing to split from); the tighter project
 * links still pull its notes together.
 */
export function livingProjectAnchor(area: LivingAnchor, index: number, ofCount: number, members: number): LivingAnchor {
  if (ofCount < 2) return { x: area.x, y: area.y };
  const r = Math.min(80, 34 + 8 * Math.sqrt(Math.max(1, members)));
  const t = (index / ofCount) * Math.PI * 2 - Math.PI / 2;
  return { x: area.x + Math.cos(t) * r, y: area.y + Math.sin(t) * r };
}

/** How hard each point is pulled toward its area's (or project's) own place: firm enough to hold clouds apart. */
export const LIVING_AREA_PULL = 0.2;

/**
 * A thread's rest length and pull: within a project tightest, within an area close, across areas long and
 * loose - the long threads across the gaps, where the firing looks best.
 */
export function livingLinkTuning(sameArea: boolean, sameProject: boolean): { distance: number; strength: number } {
  if (sameProject) return { distance: 26, strength: 0.85 };
  if (sameArea) return { distance: 34, strength: 0.55 };
  return { distance: 220, strength: 0.05 };
}

/** Resting names per cluster: the biggest few carry the cluster's reading; the rest show on hover, on zoom, or as neighbours. */
export const LIVING_REST_LABELS = 3;
/** Past this zoom the tags rest and every plausible name may show (zoomed reading, not the resting view). */
export const LIVING_ZOOMED_K = 2.2;
/** How far in the camera goes: 4x (9 Nov 2026, graph feel: 8x lost the view inside two points after one flick). */
export const LIVING_ZOOM_MAX = 4;
/** One wheel notch's pixels on a normal mouse; each multiplies the zoom by LIVING_WHEEL_STEP. */
export const LIVING_WHEEL_NOTCH = 240;
export const LIVING_WHEEL_STEP = 1.1;

/**
 * A wheel event's zoom factor: about 1.1x per notch (five notches ≈ 1.6x), gentle for small trackpad and
 * pinch deltas - one formula, no per-device cases. The engine eases toward it and clamps it between the
 * fitted vault and LIVING_ZOOM_MAX.
 */
export function livingWheelFactor(deltaY: number): number {
  return Math.pow(LIVING_WHEEL_STEP, -deltaY / LIVING_WHEEL_NOTCH);
}

/**
 * Which names rest on the page: the lit ones always (hovered, selected, centred, neighbours), plus each
 * area's biggest few. Biggest by radius, ties by title, so a vault rests the same way twice.
 */
export function livingRestLabelIds(
  nodes: readonly { id: string; area: string; r: number; title: string }[],
  hot: ReadonlySet<string>,
  perArea = LIVING_REST_LABELS,
): Set<string> {
  const out = new Set<string>();
  const byArea = new Map<string, { id: string; r: number; title: string }[]>();
  for (const n of nodes) {
    if (hot.has(n.id)) out.add(n.id);
    else {
      const l = byArea.get(n.area) ?? [];
      l.push(n);
      byArea.set(n.area, l);
    }
  }
  for (const l of byArea.values()) {
    l.sort((a, b) => b.r - a.r || a.title.localeCompare(b.title));
    for (const n of l.slice(0, Math.max(0, perArea))) out.add(n.id);
  }
  return out;
}

/**
 * The note's own graph (ITEMS: the note and its neighbours two steps out): the centre plus everything within
 * `depth` links either way, the person's own card never a hub. Runs on already-scoped nodes, so noise stays out;
 * Private never draws even so (a link to a private note must never surface it, however reached).
 */
export function livingLocal<T extends LivingNodeIn>(
  nodes: readonly T[],
  links: readonly LivingLinkIn[],
  centreId: string,
  depth = 2,
  ownNames: readonly string[] = [],
): { nodes: T[]; links: LivingLinkIn[] } {
  if (isAlwaysHiddenGraphPath(centreId)) return { nodes: [], links: [] };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(centreId)) return { nodes: [], links: [] };
  const own = new Set(ownNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const seen = new Set([centreId]);
  let frontier = [centreId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const l of links) {
        const other = l.source === id ? l.target : l.target === id ? l.source : null;
        if (other && !seen.has(other) && byId.has(other)) {
          seen.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  const kept = nodes.filter((n) => seen.has(n.id) && !isAlwaysHiddenGraphPath(n.id) && (n.id === centreId || !own.has(n.title.trim().toLowerCase())));
  const ids = new Set(kept.map((n) => n.id));
  return { nodes: kept, links: links.filter((l) => ids.has(l.source) && ids.has(l.target)) };
}

/** What a note links to and what links to it, either way, each once, never itself (keyboard neighbours). */
export function livingNeighbours(id: string, links: readonly LivingLinkIn[]): string[] {
  const out = new Set<string>();
  for (const l of links) {
    if (l.source === id && l.target !== id) out.add(l.target);
    else if (l.target === id && l.source !== id) out.add(l.source);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** A vault-relative file path (a note, a canvas, a picture): no drive, no leading slash, no scheme, no tab marker. */
const looksLikeVaultFile = (p: string): boolean =>
  /^[^/\\:.][^\\:]*\.[A-Za-z0-9]{2,8}$/.test(p) && !p.includes('://');

export interface GraphCentreCtx {
  /** The project file a folder holds (its namesake, else its only project), or null. */
  projectInFolder(folder: string): string | null;
}

/**
 * What Ctrl+G centres the graph on from this tab (9 Nov 2026, graph feel: the opener passed the tab path
 * verbatim, so a person/meeting/row page centred the graph on `person:person:…` and the like - on nothing).
 * A note centres on itself; a person resolves through their card to their note ({ person } asks the caller
 * to look it up, doubling healed); a project workspace centres on its project file; a meeting or a linked
 * row unwraps to its note; anything placeless or outside the vault opens the whole vault instead of a
 * centre that matches no point. One door, every tab shape.
 */
export function graphCentreForTab(
  tab: { type: string; path?: string },
  ctx: GraphCentreCtx,
): string | { person: string } | null {
  if (tab.type === 'graph' || !tab.path) return null;
  const path = tab.path;
  if (tab.type === 'people' && path.startsWith('person:')) return { person: personRecordIdOfTab(path) };
  if (tab.type === 'notebook' && path.startsWith('notebook:')) return ctx.projectInFolder(path.slice(9));
  if (tab.type === 'meetings' || tab.type === 'module') {
    const part = path.split('#')[1] ?? '';
    const payload = part.includes(':') ? part.slice(part.indexOf(':') + 1) : '';
    let decoded = '';
    try {
      decoded = decodeURIComponent(payload);
    } catch {
      decoded = payload;
    }
    if (!decoded) return null;
    const row = splitRowPath(decoded) ?? splitBillRow(decoded);
    if (row) return row.table;
    return looksLikeVaultFile(decoded) ? decoded : null;
  }
  if (tab.type === 'note' || tab.type === 'canvas' || tab.type === 'view' || tab.type === 'media' || tab.type === 'drawing') {
    return looksLikeVaultFile(path) ? path : null;
  }
  return null;
}

/** What moves (ITEMS: with reduce-motion on there is no drift and no travelling pulses, only the highlight). */
export function livingMotion(reduced: boolean): { drift: boolean; pulses: boolean; ambient: boolean } {
  return reduced ? { drift: false, pulses: false, ambient: false } : { drift: true, pulses: true, ambient: true };
}

export interface LivingPoint {
  id: string;
  x: number;
  y: number;
  r: number;
}

/** The point under the pointer: nearest within its radius plus a little slack, else null. Click selects it. */
export function hitLivingNode(nodes: readonly LivingPoint[], px: number, py: number, slack = 6): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of nodes) {
    const dx = px - n.x;
    const dy = py - n.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= n.r + slack && d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

/**
 * Where the selection card sits (8 Nov 2026, the no-wait clicks: one click cards the point at
 * once; 9 Nov 2026, a laptop click: the card sat on the point's own name, "Backupbo"): beside its
 * point, clear of the point's body and its name, on the side with the most room, always whole on the
 * canvas and clear of the legend (`reserveLeft`: the legend's width in the full graph, none in the
 * note's small one; `label`: the point's drawn name from the engine snapshot, else none). Pure, so the
 * unit test proves the placing without a window.
 */
export function placeLivingCard(
  point: { x: number; y: number; r?: number },
  cardW: number,
  cardH: number,
  viewW: number,
  viewH: number,
  reserveLeft = 0,
  label: { x: number; y: number; w: number; h: number } | null = null,
): { left: number; top: number } {
  const gap = 16;
  const pad = 8;
  const labelGap = 8;
  const minLeft = reserveLeft + pad;
  const maxLeft = Math.max(minLeft, viewW - cardW - pad);
  const maxTop = Math.max(pad, viewH - cardH - pad);
  // Clear of the point itself, not just its middle: a hub's body would sit under the card else.
  const off = gap + Math.max(0, point.r ?? 0);
  const pr = Math.max(0, point.r ?? 0);
  const lr = label ? { l: label.x - label.w / 2, r: label.x + label.w / 2, t: label.y - label.h / 2, b: label.y + label.h / 2 } : null;
  const hits = (l: number, t: number): boolean => {
    const cx = Math.min(l + cardW, Math.max(l, point.x));
    const cy = Math.min(t + cardH, Math.max(t, point.y));
    // Touching at exactly the gap reads clear (10 Nov 2026, rings tall card: the mathematically exact gap
    // compared a hair under through floating point, so every side read as hitting the point).
    if (Math.hypot(point.x - cx, point.y - cy) < pr + gap - 1e-6) return true;
    return !!lr && l < lr.r + labelGap && l + cardW > lr.l - labelGap && t < lr.b + labelGap && t + cardH > lr.t - labelGap;
  };
  const clampL = (v: number): number => Math.min(maxLeft, Math.max(minLeft, v));
  const clampT = (v: number): number => Math.min(maxTop, Math.max(pad, v));
  // Each side's room past the point; most room first, ties right then left then below then above.
  const rooms = { R: viewW - pad - (point.x + off), L: point.x - off - minLeft, B: viewH - pad - (point.y + off), T: point.y - off - pad };
  const sides = (['R', 'L', 'B', 'T'] as const).map((s, i) => ({ s, i })).sort((a, b) => rooms[b.s] - rooms[a.s] || a.i - b.i).map((o) => o.s);
  // Beside first: on a side the centred card, else slipped below or above the name (the name sits over
  // the point, so the centred card on either side would take half of it); below and above centre whole.
  const cands: { l: number; t: number }[] = [];
  for (const s of sides) {
    if (s === 'R' || s === 'L') {
      const l = s === 'R' ? point.x + off : point.x - off - cardW;
      cands.push({ l, t: point.y - cardH / 2 });
      if (lr) {
        cands.push({ l, t: lr.b + labelGap });
        cands.push({ l, t: lr.t - labelGap - cardH });
      }
    } else if (s === 'B') cands.push({ l: point.x - cardW / 2, t: point.y + off });
    else cands.push({ l: point.x - cardW / 2, t: point.y - off - cardH });
  }
  for (const c of cands) {
    const l = clampL(c.l);
    const t = clampT(c.t);
    if (!hits(l, t)) return { left: Math.round(l), top: Math.round(t) };
  }
  // No clear seat (a tiny panel, a giant card): whole and clear of the legend on the roomiest side.
  return { left: Math.round(clampL(cands[0].l)), top: Math.round(clampT(cands[0].t)) };
}

/**
 * A centred view's zoom: the centre middle, zoomed out past the resting zoom when its neighbours would
 * strand off the canvas (8 Nov 2026: the note's small panel kept half its neighbours out of reach).
 * Fitted around the centre itself, never the bounds middle (the centre sits at its cloud's edge, so a
 * middle fit still spills half off); never past 0.3, where points read too small to tap anyway. The zoom-out
 * floor reads this too (break 10.1.8: the bounds floor sat above the frame, so the first notch in jumped
 * and the frame could never come back) — one fit, frame and floor alike.
 */
export function fitCentredK(
  centre: { x: number; y: number },
  nodes: readonly { x: number; y: number }[],
  w: number,
  h: number,
  compact: boolean,
  baseK: number,
): number {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  let k = clamp(baseK, 1.1, 1.6);
  if (nodes.length > 1) {
    const pad = compact ? 24 : 48;
    const hw = w / 2 - pad;
    const hh = h / 2 - pad;
    if (hw > 0 && hh > 0) {
      let dx = 0;
      let dy = 0;
      for (const n of nodes) {
        dx = Math.max(dx, Math.abs(n.x - centre.x));
        dy = Math.max(dy, Math.abs(n.y - centre.y));
      }
      k = Math.max(0.3, Math.min(k, dx > 0 ? hw / dx : k, dy > 0 ? hh / dy : k));
    }
  }
  return k;
}

/** The camera that fits the vault: the middle of the bounds, zoomed so it all shows with `pad` around it. */
export function fitLivingView(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  w: number,
  h: number,
  pad = 48,
): { cx: number; cy: number; k: number } {
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const k = Math.min(2.5, Math.max(0.05, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh)));
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, k };
}
