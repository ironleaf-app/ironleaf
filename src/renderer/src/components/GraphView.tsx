// The living graph (8 Nov 2026): every note a soft glowing point on a dark canvas, sized by its links, coloured
// by its top folder or area, laid out by d3-force (links pull, everything repels, areas gather). Hover or select
// a note and bright pulses run out along its links, each neighbour lighting as one arrives while the rest dims;
// at rest it breathes. The legend names the areas with their colours and counts; clicking one hides or shows it,
// and one quiet switch shows the rest. The app around the canvas stays in the person's light theme. Replaces the
// card map (29 Oct 2026); the card maths stays in shared/graph-layout.ts for its tests. The engine itself is
// lib/living-engine.ts; this shell scopes the held graph (state/graphData.ts, moved in deltas), draws the legend
// and the selection card, and opens notes.

import { useEffect, useMemo, useRef, useState } from 'react';
import { LivingEngine } from '../lib/living-engine';
import { useGraphData } from '../state/graphData';
import { useApp } from '../state/store';
import {
  LIVING_LEGEND_SHOW,
  colourForLivingArea,
  isLivingRecent,
  livingAreaName,
  livingAreaOf,
  livingLocal,
  livingProjectOf,
  livingScope,
  orderLivingAreas,
  placeLivingCard,
} from '../../../shared/living-graph';
import { plural } from '../../../shared/words';
import { PageError } from './PageStates';

// Kept for the saved graph settings (state/graph.ts): the living graph keeps no panel state, so these stay only
// so an older saved settings file still loads whole. Nothing reads them for drawing now.
export type GraphPanel = 'filters' | 'groups' | 'display' | 'forces';
export interface GraphSettings { search: string; tags: boolean; files: boolean; missing: boolean; orphans: boolean; templates: boolean; fold: boolean; kinds: Record<string, boolean>; arrows: boolean; labels: number; nodeSize: number; linkWidth: number; center: number; repel: number; linkForce: number; distance: number; depth: number; groups: { query: string; color: string }[]; onlyFolders: string[]; onlyTags: string[]; panel: GraphPanel | null }
export const DEFAULT_GRAPH: GraphSettings = { search: '', tags: false, files: false, missing: false, orphans: true, templates: false, fold: true, kinds: {}, arrows: false, labels: 0.8, nodeSize: 1, linkWidth: 1, center: 0.5, repel: 0.5, linkForce: 0.5, distance: 0.5, depth: 2, groups: [], onlyFolders: [], onlyTags: [], panel: null };

interface GraphViewProps {
  current: string | null; revision: number; local: boolean; compact?: boolean;
  settings?: GraphSettings; onSettings?(next: GraphSettings): void; onOpen(path: string, newTab: boolean): void;
  ownNames?: readonly string[]; onCentre?(id: string): void;
}

/** The taken view per graph (break 10.1.8 F2: a tab switch remounts the engine, which reframed
 *  and reset the legend): the taken camera plus the legend switches, put back when the same view
 *  returns. Untaken views are never kept — they frame fresh. Capped; the oldest goes. */
interface KeptView { cam: { cx: number; cy: number; k: number }; showRest: boolean; hiddenAreas: readonly string[] }
const keptViews = new Map<string, KeptView>();
const viewKeyOf = (compact: boolean | undefined, local: boolean, current: string | null): string =>
  `${compact ? 'c' : 'v'}:${local ? 'l' : ''}:${current ?? ''}`;
function keepView(key: string, kept: KeptView): void {
  keptViews.delete(key);
  keptViews.set(key, kept);
  while (keptViews.size > 30) keptViews.delete(keptViews.keys().next().value!);
}

export function GraphView({ current, revision, local, compact, onOpen, ownNames, onCentre }: GraphViewProps) {
  // The held graph, moved in deltas (5 Nov 2026, v5-vault-speed). Unreadable is an error with a retry
  // (9.2 uplift F128), never "Loading…" forever.
  const { data, failed, reload } = useGraphData(revision);
  const settings = useApp((s) => s.settings);
  const notes = useApp((s) => s.notes);
  const files = useApp((s) => s.files);
  const viewKey = viewKeyOf(compact, local, current);
  const [showRest, setShowRest] = useState(() => keptViews.get(viewKey)?.showRest ?? false);
  const [hiddenAreas, setHiddenAreas] = useState<ReadonlySet<string>>(() => new Set(keptViews.get(viewKey)?.hiddenAreas ?? []));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The unmount cleanup reads these, so they trail the state (its closure would keep first values).
  const viewKeyRef = useRef(viewKey);
  viewKeyRef.current = viewKey;
  const showRestRef = useRef(showRest);
  showRestRef.current = showRest;
  const hiddenAreasRef = useRef(hiddenAreas);
  hiddenAreasRef.current = hiddenAreas;
  const restoredRef = useRef(false);
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<LivingEngine | null>(null);
  const openRef = useRef(onOpen);
  const centreRef = useRef(onCentre);
  openRef.current = onOpen;
  centreRef.current = onCentre;

  const model = useMemo(() => {
    if (!data) return null;
    const store = {
      templatesFolder: settings?.prefs.templatesFolder,
      assetsFolder: settings?.prefs.assetsFolder,
      attachmentsFolder: settings?.prefs.attachmentsFolder,
      dailyFolder: settings?.dailyFolder ?? 'Daily',
    };
    // The legend counts everything in scope before areas hide, so hiding never rewrites the counts.
    const scoped = livingScope(data.nodes, data.links, { showRest, store, forceIds: current ? [current] : [] });
    const sub = local && current ? livingLocal(scoped.nodes, scoped.links, current, 2, ownNames ?? []) : scoped;
    const counts = new Map<string, number>();
    for (const n of sub.nodes) counts.set(livingAreaOf(n.id), (counts.get(livingAreaOf(n.id)) ?? 0) + 1);
    const ordered = orderLivingAreas(counts);
    const colour = new Map(ordered.map((a) => [a, colourForLivingArea(a, ordered)]));
    const mtime = new Map<string, number>();
    for (const n of notes) mtime.set(n.path, n.mtime);
    for (const f of files) if (!mtime.has(f.rel)) mtime.set(f.rel, f.mtime);
    const now = Date.now();
    const shown = hiddenAreas.size ? sub.nodes.filter((n) => !hiddenAreas.has(livingAreaOf(n.id))) : sub.nodes;
    const ids = new Set(shown.map((n) => n.id));
    const links = sub.links.filter((l) => ids.has(l.source) && ids.has(l.target));
    const degree = new Map<string, number>();
    for (const l of links) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    }
    const recentOf = (id: string) => isLivingRecent(mtime.get(id), now);
    return {
      nodes: shown.map((n) => ({
        id: n.id, title: n.title, area: livingAreaOf(n.id), colour: colour.get(livingAreaOf(n.id)) ?? '#38bdf8',
        degree: degree.get(n.id) ?? 0, recent: recentOf(n.id), project: livingProjectOf(n),
      })),
      links: links.map((l) => ({ source: l.source, target: l.target, recent: recentOf(l.source) || recentOf(l.target) })),
      areas: ordered.map((area) => ({ area, name: livingAreaName(area), colour: colour.get(area)!, count: counts.get(area) ?? 0, hidden: hiddenAreas.has(area) })),
      centreIn: current ? ids.has(current) : false,
    };
  }, [data, settings, notes, files, showRest, hiddenAreas, local, current, ownNames]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new LivingEngine(canvas, liveRef.current, {
      compact: !!compact,
      onOpen: (id, newTab) => openRef.current(id, newTab),
      onCentre: (id) => centreRef.current?.(id),
      onSelect: (id) => setSelectedId(id),
    });
    engineRef.current = engine;
    // The test hook: where every point sits on screen, and what the engine costs (tests read it; nothing
    // a person sees uses it).
    (window as unknown as { __nvLivingGraph?: { snapshot(): unknown } }).__nvLivingGraph = { snapshot: () => engine.snapshot() };
    return () => {
      // Keep the taken view for the return (a tab switch remounts): the camera whole, with the legend
      // switches it framed. Untaken views frame fresh, so they keep nothing.
      const s = engine.snapshot();
      if (s.taken) keepView(viewKeyRef.current, { cam: { ...s.cam }, showRest: showRestRef.current, hiddenAreas: [...hiddenAreasRef.current] });
      engineRef.current = null;
      engine.destroy();
    };
  }, [compact]);

  useEffect(() => {
    if (model) engineRef.current?.setData(model.nodes, model.links, { centreId: current });
    // Once per mount, after the first data lands over the fresh frame: the kept camera back, whole.
    // Later data only moves in deltas, which never touch a taken camera.
    if (model && !restoredRef.current) {
      restoredRef.current = true;
      const kept = keptViews.get(viewKey);
      if (kept && engineRef.current) engineRef.current.restoreCamera(kept.cam);
    }
  }, [model, current]);

  // A new centre clears the card: the view reframed under it, so the card would sit on a stale point.
  // (The engine's own arrival selection stays silent for the same reason: the card is for picked points.)
  useEffect(() => {
    setSelectedId(null);
  }, [current]);

  // The card sits by its point and follows it as the camera moves, clear of the name (9 Nov 2026,
  // the laptop click: it sat on "Mediabox" itself). It holds still through the drift - a target nearer
  // than a breath never retargets - eases after a real move, and pins readable at the edge when the point
  // leaves the view. At rest the frame loop reads but writes nothing.
  useEffect(() => {
    if (!selectedId) {
      setCardPos(null);
      return;
    }
    let raf = 0;
    let cur: { left: number; top: number } | null = null;
    let aim: { left: number; top: number } | null = null;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const snap = engineRef.current?.snapshot();
      const p = snap?.nodes.find((n) => n.id === selectedId);
      if (!snap || !p) return;
      const lab = snap.labels.find((l) => l.id === selectedId) ?? null;
      const box = cardRef.current?.getBoundingClientRect();
      const next = placeLivingCard({ x: p.x, y: p.y, r: p.r }, box?.width ?? 220, box?.height ?? 118, snap.view.w, snap.view.h, compact ? 0 : 220, lab ? { x: lab.x, y: lab.y, w: lab.w, h: lab.h } : null);
      if (!cur || !aim) {
        cur = next;
        aim = next;
        setCardPos(next);
        return;
      }
      // The drift breathes some 4px; nearer than that the card holds where it is.
      if (Math.hypot(next.left - aim.left, next.top - aim.top) < 8) {
        if (cur.left === aim.left && cur.top === aim.top) return;
        const dx = aim.left - cur.left;
        const dy = aim.top - cur.top;
        cur = Math.hypot(dx, dy) < 1.5 ? aim : { left: Math.round(cur.left + dx * 0.35), top: Math.round(cur.top + dy * 0.35) };
        setCardPos(cur);
        return;
      }
      aim = next;
      const dx = aim.left - cur.left;
      const dy = aim.top - cur.top;
      cur = Math.hypot(dx, dy) < 1.5 ? aim : { left: Math.round(cur.left + dx * 0.35), top: Math.round(cur.top + dy * 0.35) };
      setCardPos(cur);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectedId, compact]);

  const toggleArea = (area: string) => {
    setHiddenAreas((s) => {
      const next = new Set(s);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  };
  const shownAreas = (model?.areas ?? []).slice(0, LIVING_LEGEND_SHOW);
  const tailAreas = (model?.areas ?? []).length - shownAreas.length;
  const cardNode = selectedId ? model?.nodes.find((n) => n.id === selectedId) : undefined;

  return (
    <div className={`lg${compact ? ' compact' : ''}`}>
      <canvas
        ref={canvasRef}
        className="lg-canvas"
        tabIndex={0}
        role="application"
        aria-label={model ? `Graph of ${plural(model.nodes.length, 'note')}. Arrow keys move between linked notes, Enter opens${onCentre ? ', Space centres' : ''}.` : 'Graph'}
      />
      <div ref={liveRef} className="lg-live" aria-live="polite" />
      {cardNode && (
        <div
          ref={cardRef}
          className="lg-card"
          role="group"
          aria-label={cardNode.title}
          style={cardPos ? { left: cardPos.left, top: cardPos.top } : { visibility: 'hidden' as const }}
        >
          <div className="lg-card-title">{cardNode.title}</div>
          <div className="lg-card-sub">{livingAreaName(cardNode.area)} · {plural(cardNode.degree, 'link')}</div>
          <div className="lg-card-actions">
            <button type="button" className="lg-card-open" onClick={(e) => openRef.current(cardNode.id, e.ctrlKey || e.metaKey)}>Open</button>
            {onCentre ? <button type="button" className="lg-card-centre" onClick={() => centreRef.current?.(cardNode.id)}>Centre here</button> : null}
          </div>
        </div>
      )}
      {!compact && model && model.areas.length > 0 && (
        <div className="lg-legend" role="group" aria-label="Areas">
          <div className="lg-head">Areas</div>
          {shownAreas.map((a) => (
            <button
              key={a.area}
              type="button"
              className={`lg-row${a.hidden ? ' is-off' : ''}`}
              aria-pressed={!a.hidden}
              title={a.hidden ? `Show ${a.name} again` : `Hide ${a.name}`}
              onClick={() => toggleArea(a.area)}
            >
              <span className="lg-dot" style={{ background: a.colour }} aria-hidden="true" />
              <span className="lg-name">{a.name}</span>
              <span className="lg-count">{a.count}</span>
            </button>
          ))}
          {tailAreas > 0 && <div className="lg-more">+{tailAreas} more areas</div>}
          <label className="lg-rest">
            <input type="checkbox" className="switch" checked={showRest} onChange={(e) => setShowRest(e.target.checked)} />
            <span>Show everything</span>
          </label>
        </div>
      )}
      {!data && (failed
        ? <div className="lg-note"><PageError title="Couldn't load the graph" explainer="The connections are still there. They just wouldn't load." retry={reload} /></div>
        : <p className="lg-empty">Loading the graph…</p>)}
      {data && model && model.nodes.length === 0 && (
        <p className="lg-empty">{local && current ? 'Nothing connected within two levels yet.' : 'Nothing to show yet. Notes with links will sit here.'}</p>
      )}
    </div>
  );
}
