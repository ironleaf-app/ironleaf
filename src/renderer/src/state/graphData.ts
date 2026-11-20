// The graph the window holds, moved in deltas (5 Nov 2026, v5-vault-speed): the first draw takes the whole
// graph; every change after takes only what moved and applies it onto what is held, so the cards already
// drawn stay drawn. An older host without deltas answers whole graphs as before. One hook for both doors
// (the Map tab and the card map), so every change works from every door to the graph.
//
// One held graph for every view (t102, 9 Nov 2026): each graph opened fetched the whole graph again — every
// note opened re-downloaded it for its Connections stack. The first view reads it; every view after reads
// what is held and only asks what moved since.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { applyGraphDelta } from '../../../shared/graph-delta';
import type { GraphData } from '../../../shared/types';

let held: { gen: number | null; data: GraphData } | null = null;
const listeners = new Set<() => void>();
function emit(): void {
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useGraphData(revision: number, enabled = true): { data: GraphData | null; failed: boolean; reload(): void } {
  // What is held, as this view sees it; another view's fetch lands here too.
  const snap = useSyncExternalStore(subscribe, () => held);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setFailed(false);
    const onto = held;
    const takeFull = (d: GraphData) => {
      if (!alive) return;
      held = { gen: d.generation ?? null, data: d };
      emit();
    };
    const takeWhole = () => {
      window.nv.index.graph().then(takeFull, () => alive && setFailed(true));
    };
    window.nv.index.graphSince(onto?.gen ?? -1).then(
      (s) => {
        if (!alive) return;
        if (s && 'delta' in s && s.delta && onto) {
          const next: GraphData = { ...applyGraphDelta(onto.data, s.delta), generation: s.generation };
          held = { gen: s.generation, data: next };
          emit();
        } else if (s && 'full' in s && s.full) {
          takeFull(s.full);
        } else {
          takeWhole();
        }
      },
      () => takeWhole(),
    );
    return () => {
      alive = false;
    };
  }, [revision, retry, enabled]);
  return { data: enabled ? (snap?.data ?? null) : null, failed, reload: () => setRetry((n) => n + 1) };
}
