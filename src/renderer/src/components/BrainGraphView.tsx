// The brain graph (9 Nov 2026; 10 Nov 2026, rings polished and the default, the living graph retired from
// the UI). One rounded brain with the fold down the middle: find a note by name, walk its neighbourhood by
// name with a breadcrumb back, focus a lobe, re-light with a lens, and read what the brain says. The layout
// is shared/brain-graph.ts (placed, deterministic, no simulation); the canvas is lib/brain-engine.ts (the
// still world drawn once, only pulses travelling). The app around the canvas stays in light theme.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BRAIN_LENSES,
  brainLayout,
  brainLensCount,
  brainLocalLayout,
  brainSearch,
  brainSummary,
  type BrainDesign,
  type BrainLens,
} from '../../../shared/brain-graph';
import {
  LIVING_LEGEND_SHOW,
  livingAreaName,
  livingAreaOf,
  livingLocal,
  livingProjectOf,
  livingScope,
  orderLivingAreas,
  placeLivingCard,
} from '../../../shared/living-graph';
import { plural } from '../../../shared/words';
import { BrainEngine } from '../lib/brain-engine';
import { useGraphData } from '../state/graphData';
import { useApp } from '../state/store';
import { PageError } from './PageStates';
import '../styles/brain-graph.css';

/** The taken view per graph (the living graph's t69 kept views, carried to rings): the taken camera plus
 *  the legend switches, put back when the same view returns. Untaken views are never kept. Capped. */
interface KeptBrainView { cam: { cx: number; cy: number; k: number }; showRest: boolean; lens: BrainLens; focus: string | null }
// A view's placed model, kept by what places it (t102, 9 Nov 2026): every tab switch re-scoped the whole
// vault and re-laid the neighbourhood, though the same centres return again and again. The same inputs
// place the same model, so a return costs nothing; a new centre, generation or day places again. Capped.
interface BrainModelInputs {
  data: import('../../../shared/types').GraphData;
  settings: { prefs: { templatesFolder?: string; assetsFolder?: string; attachmentsFolder?: string }; dailyFolder?: string } | null | undefined;
  notes: readonly { path: string; mtime: number }[];
  files: readonly { rel: string; mtime: number }[];
  design: BrainDesign;
  showRest: boolean;
  local: boolean | undefined;
  centre: string | null;
  ownNames: readonly string[] | undefined;
  day: number;
}
const keptBrainModels: { inputs: BrainModelInputs; model: ReturnType<typeof buildBrainModel> }[] = [];
function keptBrainModel(inputs: BrainModelInputs): ReturnType<typeof buildBrainModel> {
  const at = keptBrainModels.findIndex(
    (e) =>
      e.inputs.data === inputs.data &&
      e.inputs.settings === inputs.settings &&
      e.inputs.notes === inputs.notes &&
      e.inputs.files === inputs.files &&
      e.inputs.design === inputs.design &&
      e.inputs.showRest === inputs.showRest &&
      e.inputs.local === inputs.local &&
      e.inputs.centre === inputs.centre &&
      e.inputs.ownNames === inputs.ownNames &&
      e.inputs.day === inputs.day,
  );
  if (at >= 0) {
    const [hit] = keptBrainModels.splice(at, 1);
    keptBrainModels.unshift(hit);
    return hit.model;
  }
  const model = buildBrainModel(inputs);
  keptBrainModels.unshift({ inputs, model });
  while (keptBrainModels.length > 8) keptBrainModels.pop();
  return model;
}
/** Places a view's model from its inputs (pure but for the clock: recency reads the day). */
function buildBrainModel(inputs: BrainModelInputs): {
  layout: ReturnType<typeof brainLayout>;
  summary: string;
  recentTotal: number;
  lensCounts: Map<BrainLens, number>;
} {
  const { data, settings, notes, files, design, showRest, local, centre, ownNames } = inputs;
  const store = {
    templatesFolder: settings?.prefs.templatesFolder,
    assetsFolder: settings?.prefs.assetsFolder,
    attachmentsFolder: settings?.prefs.attachmentsFolder,
    dailyFolder: settings?.dailyFolder ?? 'Daily',
  };
  const scoped = livingScope(data.nodes, data.links, { showRest, store, forceIds: centre ? [centre] : [] });
  const sub = local && centre ? livingLocal(scoped.nodes, scoped.links, centre, 2, ownNames ?? []) : scoped;
  const mtime = new Map<string, number>();
  for (const n of notes) mtime.set(n.path, n.mtime);
  for (const f of files) if (!mtime.has(f.rel)) mtime.set(f.rel, f.mtime);
  const personIds = new Set(data.nodes.filter((n) => n.id.startsWith('People/') || !!n.role).map((n) => n.id));
  const projectIds = new Set(data.nodes.filter((n) => n.id.startsWith('Projects/') || !!n.project).map((n) => n.id));
  const now = Date.now();
  const ins = sub.nodes.map((n) => ({
    id: n.id,
    title: n.title,
    person: personIds.has(n.id),
    project: projectIds.has(n.id) || !!livingProjectOf(n),
    mtime: mtime.get(n.id),
  }));
  const inLinks = sub.links.map((l) => ({ source: l.source, target: l.target }));
  // The note's own small graph centres (t151): the middle with one step round it and a faint second step,
  // coloured as the big graph (its ordered areas pass through, so the same area keeps its colour).
  const layout = local && centre
    ? (() => {
        const counts = new Map<string, number>();
        for (const n of scoped.nodes) counts.set(livingAreaOf(n.id), (counts.get(livingAreaOf(n.id)) ?? 0) + 1);
        return brainLocalLayout(centre, ins, inLinks, now, orderLivingAreas(counts));
      })()
    : brainLayout(ins, inLinks, design, now);
  const recentByArea = new Map<string, number>();
  for (const n of layout.nodes) if (n.recent) recentByArea.set(n.area, (recentByArea.get(n.area) ?? 0) + 1);
  const ordered: [string, number][] = [...recentByArea].sort((a, b) => b[1] - a[1] || livingAreaName(a[0]).localeCompare(livingAreaName(b[0])));
  const recentTotal = ordered.reduce((t, [, c]) => t + c, 0);
  return {
    layout,
    summary: brainSummary({ recentByArea: ordered, recentTotal, looseCount: layout.loose.length }),
    recentTotal,
    lensCounts: new Map(BRAIN_LENSES.map((l) => [l.id, brainLensCount(l.id, layout.nodes)])),
  };
}
const keptBrainViews = new Map<string, KeptBrainView>();
const brainViewKeyOf = (compact: boolean | undefined, local: boolean | undefined, current: string | null): string =>
  `${compact ? 'c' : 'v'}:${local ? 'l' : ''}:${current ?? ''}`;
function keepBrainView(key: string, kept: KeptBrainView): void {
  keptBrainViews.delete(key);
  keptBrainViews.set(key, kept);
  while (keptBrainViews.size > 30) keptBrainViews.delete(keptBrainViews.keys().next().value!);
}

interface BrainGraphViewProps {
  revision: number;
  onOpen(path: string, newTab: boolean): void;
  designInit?: BrainDesign;
  /** Kept for the compare page's panels (both lock to their design); the default view is rings, no switcher. */
  lockDesign?: boolean;
  onSummary?(summary: string): void;
  /** Open centred on this note (Ctrl+G or Centre here), with its neighbourhood lit. */
  centre?: string | null;
  onCentre?(id: string): void;
  /** The note's own small graph: scoped to two steps out, no legend over it. */
  compact?: boolean;
  local?: boolean;
  ownNames?: readonly string[];
}

export function BrainGraphView({ revision, onOpen, designInit = 'rings', onSummary, centre = null, onCentre, compact, local, ownNames }: BrainGraphViewProps) {
  const { data, failed, reload } = useGraphData(revision);
  const settings = useApp((s) => s.settings);
  const notes = useApp((s) => s.notes);
  const files = useApp((s) => s.files);
  const design = designInit;
  const viewKey = brainViewKeyOf(compact, local, centre);
  const [lens, setLens] = useState<BrainLens>(() => keptBrainViews.get(viewKey)?.lens ?? 'all');
  const [focus, setFocus] = useState<string | null>(() => keptBrainViews.get(viewKey)?.focus ?? null);
  const [showRest, setShowRest] = useState(() => keptBrainViews.get(viewKey)?.showRest ?? false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<BrainEngine | null>(null);
  const openRef = useRef(onOpen);
  const centreRef = useRef(onCentre);
  const trailRef = useRef(trail);
  openRef.current = onOpen;
  centreRef.current = onCentre;
  trailRef.current = trail;
  const viewKeyRef = useRef(viewKey);
  viewKeyRef.current = viewKey;
  const showRestRef = useRef(showRest);
  showRestRef.current = showRest;
  const lensRef = useRef(lens);
  lensRef.current = lens;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const restoredRef = useRef(false);

  const model = useMemo(() => {
    if (!data) return null;
    return keptBrainModel({
      data,
      settings,
      notes,
      files,
      design,
      showRest,
      local,
      centre,
      ownNames,
      day: Math.floor(Date.now() / 86400000),
    });
  }, [data, settings, notes, files, design, showRest, local, centre, ownNames]);

  useEffect(() => {
    if (model && onSummary) onSummary(model.summary);
  }, [model, onSummary]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new BrainEngine(canvas, liveRef.current, {
      compact: !!compact,
      onOpen: (id, newTab) => openRef.current(id, newTab),
      onSelect: (id) => {
        setSelectedId(id);
        if (id) setTrail((t) => (t[t.length - 1] === id ? t : [...t, id]));
        if (!id) setTrail([]);
      },
      onCentre: centreRef.current ? (id) => centreRef.current?.(id) : undefined,
    });
    engineRef.current = engine;
    (window as unknown as { __nvBrainGraph?: { snapshot(): unknown } }).__nvBrainGraph = { snapshot: () => engine.snapshot() };
    return () => {
      const s = engine.snapshot() as unknown as { taken: boolean; cam: { cx: number; cy: number; k: number } };
      if (s.taken) keepBrainView(viewKeyRef.current, { cam: { ...s.cam }, showRest: showRestRef.current, lens: lensRef.current, focus: focusRef.current });
      engineRef.current = null;
      engine.destroy();
      if ((window as unknown as { __nvBrainGraph?: unknown }).__nvBrainGraph) delete (window as unknown as { __nvBrainGraph?: unknown }).__nvBrainGraph;
    };
  }, [compact]);

  useEffect(() => {
    if (model) {
      engineRef.current?.setLayout(model.layout.nodes, model.layout.curves, model.layout.lobes, model.layout.looseAt);
      engineRef.current?.setCentre(centre);
    }
    if (model && !restoredRef.current) {
      restoredRef.current = true;
      const kept = keptBrainViews.get(viewKey);
      if (kept && engineRef.current) engineRef.current.restoreCamera(kept.cam);
    }
  }, [model, centre]);
  useEffect(() => {
    engineRef.current?.setLens(lens);
  }, [lens, model]);
  useEffect(() => {
    engineRef.current?.setFocus(focus);
  }, [focus, model]);
  useEffect(() => {
    if (canvasRef.current) canvasRef.current.dataset.design = design;
  }, [design]);

  // A new centre clears the card: the view reframed under it, so the card would sit on a stale point.
  useEffect(() => {
    setSelectedId(null);
    setTrail([]);
  }, [centre]);

  // The card sits by its point and follows it as the camera moves; at rest the frame loop reads nothing.
  // The note's own small graph keeps no card (t151): one click opens, so nothing follows.
  useEffect(() => {
    if (!selectedId || compact) {
      setCardPos(null);
      return;
    }
    let raf = 0;
    let cur: { left: number; top: number } | null = null;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const snap = engineRef.current?.snapshot();
      const p = snap?.nodes.find((n) => n.id === selectedId);
      if (!snap || !p) return;
      const lab = snap.labels.find((l) => l.id === selectedId) ?? null;
      const box = cardRef.current?.getBoundingClientRect();
      const next = placeLivingCard({ x: p.x, y: p.y, r: p.r }, box?.width ?? 240, box?.height ?? 200, snap.view.w, snap.view.h, compact ? 0 : 220, lab ? { x: lab.x, y: lab.y, w: lab.w, h: lab.h } : null);
      if (!cur || cur.left !== next.left || cur.top !== next.top) {
        cur = next;
        setCardPos(next);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectedId, compact]);

  const titles = useMemo(() => (model?.layout.nodes ?? []).map((n) => ({ id: n.id, title: n.title })), [model]);
  const hits = useMemo(() => brainSearch(titles, query), [titles, query]);
  const byId = useMemo(() => new Map((model?.layout.nodes ?? []).map((n) => [n.id, n])), [model]);
  const cardNode = selectedId ? byId.get(selectedId) : undefined;
  const neighbours = useMemo(() => {
    if (!selectedId || !engineRef.current || !model) return [];
    return engineRef.current.neighbours(selectedId).map((id) => byId.get(id)).filter((n): n is NonNullable<typeof n> => !!n);
  }, [selectedId, model, byId]);
  const lobes = useMemo(() => [...(model?.layout.lobes ?? [])].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)), [model]);
  const shownLobes = lobes.slice(0, LIVING_LEGEND_SHOW);
  const tailLobes = lobes.length - shownLobes.length;
  const looseCount = model?.layout.loose.length ?? 0;

  const go = (id: string) => {
    setTrail((t) => (t[t.length - 1] === id ? t : [...t, id]));
    engineRef.current?.searchGo(id);
  };
  const walk = (id: string) => {
    setTrail((t) => (t[t.length - 1] === id ? t : [...t, id]));
    engineRef.current?.walkTo(id);
  };
  const back = () => {
    const t = trailRef.current;
    if (t.length <= 1) {
      engineRef.current?.select(null);
      return;
    }
    const next = t.slice(0, -1);
    setTrail(next);
    engineRef.current?.walkTo(next[next.length - 1]);
  };
  const toggleFocus = (area: string) => setFocus((f) => (f === area ? null : area));

  return (
    <div className={`bg${compact ? ' compact' : ''}`}>
      <canvas
        ref={canvasRef}
        className="bg-canvas"
        tabIndex={0}
        role="application"
        data-design={design}
        aria-label={model ? `Brain graph of ${plural(model.layout.nodes.length, 'note')}. Arrow keys walk between linked notes, Enter opens.` : 'Brain graph'}
      />
      <div ref={liveRef} className="bg-live" aria-live="polite" />
      {!compact && model && lobes.length > 0 && (
        <div className="bg-legend" role="group" aria-label="Lobes">
          <div className="bg-head">Lobes</div>
          {shownLobes.map((l) => (
            <button
              key={l.area}
              type="button"
              className={`bg-row${focus === l.area ? ' is-on' : ''}`}
              aria-pressed={focus === l.area}
              title={focus === l.area ? `Back to the whole brain` : `Zoom into ${l.name}`}
              onClick={() => toggleFocus(l.area)}
            >
              <span className="bg-dot" style={{ background: l.colour }} aria-hidden="true" />
              <span className="bg-name">{l.name}</span>
              <span className="bg-count">{l.count}</span>
            </button>
          ))}
          {tailLobes > 0 && <div className="bg-more">+{plural(tailLobes, 'more lobe', 'more lobes')}</div>}
          {looseCount > 0 && (
            <button
              type="button"
              className={`bg-row bg-loose${focus === 'loose' ? ' is-on' : ''}`}
              aria-pressed={focus === 'loose'}
              title="See the notes not linked to anything"
              onClick={() => toggleFocus('loose')}
            >
              <span className="bg-dot is-hollow" aria-hidden="true" />
              <span className="bg-name">Loose thoughts</span>
              <span className="bg-count">{looseCount}</span>
            </button>
          )}
          {focus && (
            <button type="button" className="bg-whole" onClick={() => setFocus(null)}>
              Whole brain
            </button>
          )}
          <label className="bg-rest">
            <input type="checkbox" className="switch" checked={showRest} onChange={(e) => setShowRest(e.target.checked)} />
            <span>Show everything</span>
          </label>
        </div>
      )}
      {!compact && model && (
        <div className="bg-find" role="search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits.length) {
                e.preventDefault();
                go(hits[0].id);
                setQuery('');
              } else if (e.key === 'Escape') {
                setQuery('');
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Find a note"
            aria-label="Find a note in the graph"
          />
          {query.trim().length >= 2 && (
            <div className="bg-hits" role="listbox" aria-label="Matching notes">
              {hits.length === 0 && <div className="bg-nohit">No note by that name. Try part of one.</div>}
              {hits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="bg-hit"
                  onClick={() => {
                    go(h.id);
                    setQuery('');
                  }}
                >
                  <span className="bg-hit-title">{h.title}</span>
                  <span className="bg-hit-area">{livingAreaName(livingAreaOf(h.id))}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {!compact && model && (
        <div className="bg-lenses seg" role="tablist" aria-label="Lenses">
          {BRAIN_LENSES.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={lens === l.id}
              className={lens === l.id ? 'on' : ''}
              title={l.id === 'recent' ? 'Touched this week' : l.label}
              onClick={() => setLens(l.id)}
            >
              {l.id === 'recent' ? 'Recent' : l.label}
            </button>
          ))}
        </div>
      )}
      {cardNode && !compact && (
        <div
          ref={cardRef}
          className="bg-card"
          role="group"
          aria-label={cardNode.title}
          style={cardPos ? { left: cardPos.left, top: cardPos.top } : { visibility: 'hidden' as const }}
        >
          <div className="bg-card-title">{cardNode.title}</div>
          <div className="bg-card-sub">{cardNode.name} · {plural(cardNode.degree, 'link')}</div>
          {trail.length > 1 && (
            <div className="bg-trail" aria-label="Walk">
              <button type="button" className="bg-back" onClick={back}>Back</button>
              <span className="bg-trail-words">{trail.slice(-3).map((id) => byId.get(id)?.title ?? id).join(' › ')}</span>
            </div>
          )}
          {neighbours.length > 0 && (
            <div className="bg-neighbours" aria-label="Linked notes">
              {neighbours.slice(0, 8).map((n) => (
                <button key={n.id} type="button" className="bg-neighbour" onClick={() => walk(n.id)} title={`Walk to ${n.title}`}>
                  <span className="bg-dot" style={{ background: n.colour }} aria-hidden="true" />
                  <span className="bg-name">{n.title}</span>
                </button>
              ))}
              {neighbours.length > 8 && <div className="bg-more">+{neighbours.length - 8} more linked</div>}
            </div>
          )}
          <div className="bg-card-actions">
            <button type="button" className="bg-card-open" onClick={(e) => openRef.current(cardNode.id, e.ctrlKey || e.metaKey)}>Open</button>
            {centreRef.current ? <button type="button" className="bg-card-centre" onClick={() => centreRef.current?.(cardNode.id)}>Centre here</button> : null}
          </div>
        </div>
      )}
      {!data && (failed
        ? <div className="bg-note"><PageError title="Couldn't load the graph" explainer="The connections are still there. They just wouldn't load." retry={reload} /></div>
        : <p className="bg-empty">Loading the graph…</p>)}
      {data && model && model.layout.nodes.length === 0 && (
        <p className="bg-empty">Nothing to show yet. Notes with links will sit here.</p>
      )}
    </div>
  );
}
