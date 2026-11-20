// The graph's settings (filters, colour groups, looks, forces, and which of those panels is open), remembered per folder
// of notes and shared by every graph tab.

import { useSyncExternalStore } from 'react';
import { DEFAULT_GRAPH, type GraphSettings } from '../components/GraphView';

let settings: { global: GraphSettings; local: GraphSettings } = { global: DEFAULT_GRAPH, local: { ...DEFAULT_GRAPH, tags: false } };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function useGraphSettings(local: boolean): GraphSettings {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => (local ? settings.local : settings.global),
  );
}

export function setGraphSettings(local: boolean, next: GraphSettings): void {
  settings = local ? { ...settings, local: next } : { ...settings, global: next };
  for (const fn of listeners) fn();
  clearTimeout(timer);
  timer = setTimeout(() => void window.nv.state.save('graph', settings).catch(() => {}), 600);
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : []);
const PANELS = ['filters', 'groups', 'display', 'forces'];

/** Saved settings as written by an older Ironleaf (or edited by hand) made whole: the filters and open panel (19 Oct
 * 2026) are lists of words and one of the four panels, else left as they start. */
function whole(saved: Partial<GraphSettings> | undefined): GraphSettings {
  const next = { ...DEFAULT_GRAPH, ...(saved ?? {}) };
  return { ...next, onlyFolders: strings(next.onlyFolders), onlyTags: strings(next.onlyTags), panel: PANELS.includes(next.panel as string) ? next.panel : null };
}

export async function loadGraphSettings(): Promise<void> {
  const saved = await window.nv.state.load<{ global?: Partial<GraphSettings>; local?: Partial<GraphSettings> }>('graph').catch(() => null);
  settings = { global: whole(saved?.global), local: whole(saved?.local) };
  for (const fn of listeners) fn();
}
