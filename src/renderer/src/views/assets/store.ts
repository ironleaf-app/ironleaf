// The Assets page's shared state: the asset listing (read from the main side, again whenever files or notes change),
// which part of the store is shown, the search, the order, the view and the asset selected. Kept outside the page so the
// command list (Open your brand kit), the picker in notes and the page all see the same thing.

import { useSyncExternalStore } from 'react';
import type { AssetEntry, AssetKind, AssetListing, AssetSort } from '../../../../shared/assets';
import { errorMessage } from '../../lib/errors';

export type Section = { kind: 'all' } | { kind: 'brand' } | { kind: 'attachments' } | { kind: 'type'; type: AssetKind } | { kind: 'collection'; name: string } | { kind: 'tag'; tag: string } | { kind: 'area'; id: string; name: string };

export interface AssetsState {
  listing: AssetListing | null;
  error: string | null;
  section: Section;
  selected: string | null;
  query: string;
  sort: AssetSort;
  view: 'grid' | 'list';
}

function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A private window or blocked storage: the choice lasts this session only.
  }
}

let state: AssetsState = {
  listing: null,
  error: null,
  section: { kind: 'all' },
  selected: null,
  query: '',
  sort: remembered('nv-assets-sort', ['recent', 'name', 'size', 'kind'] as const, 'recent'),
  view: remembered('nv-assets-view', ['grid', 'list'] as const, 'list'),
};
const listeners = new Set<() => void>();

export function getAssets(): AssetsState {
  return state;
}

export function setAssets(patch: Partial<AssetsState>): void {
  state = { ...state, ...patch };
  if (patch.sort) remember('nv-assets-sort', patch.sort);
  if (patch.view) remember('nv-assets-view', patch.view);
  for (const fn of listeners) fn();
}

export function useAssets<T>(select: (s: AssetsState) => T): T {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => select(state),
  );
}

let loading: Promise<void> | null = null;
let again = false;
/** Reads the listing again (one read at a time; a request while reading reads once more after). */
export function reloadAssets(): Promise<void> {
  if (loading) {
    again = true;
    return loading;
  }
  loading = (async () => {
    try {
      do {
        again = false;
        const listing = await window.nv.assets.list();
        setAssets({ listing, error: null, ...(state.selected && !listing.assets.some((a) => a.path === state.selected) ? { selected: null } : {}) });
      } while (again);
    } catch (err) {
      setAssets({ error: errorMessage(err) });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** One asset changed here (its thumbnail made, a field edited): shown at once, before the next read. */
export function patchAsset(path: string, patch: Partial<AssetEntry>): void {
  const l = state.listing;
  if (!l) return;
  const i = l.assets.findIndex((a) => a.path === path);
  if (i < 0) return;
  const assets = [...l.assets];
  assets[i] = { ...assets[i], ...patch };
  setAssets({ listing: { ...l, assets } });
}
