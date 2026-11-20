// The module a page belongs to, for what is drawn inside it (8.0 Phase 5): its empty places lead with how it fills itself
// (components/EmptyState.tsx), and its first-open tour (views/modules/ModuleTour.tsx) is remembered per module on this PC.

import { createContext } from 'react';

export interface ModuleFillsInfo {
  id: string;
  name: string;
  fills: string;
}
export const ModuleFills = createContext<ModuleFillsInfo | null>(null);

const TOUR = (id: string) => `nv.tour.${id}`;
/** Whether a module's tour has been seen on this PC. */
export function tourSeen(id: string): boolean {
  try {
    return localStorage.getItem(TOUR(id)) === '1';
  } catch {
    return true;
  }
}
export function setTourSeen(id: string, seen: boolean): void {
  try {
    if (seen) localStorage.setItem(TOUR(id), '1');
    else localStorage.removeItem(TOUR(id));
  } catch {}
}

/** Opening a pack's tour from its ⋯ menu, the command list or Settings (8.7 round 2, replacing the red link under the
 *  title): whoever asks dispatches, and the pack's mounted tour opens. `pendingTour` covers asking just before the
 *  pack's page mounts (from Settings): the tour opens on mount instead. A parked tour expires after half a minute
 *  (3 Nov 2026, audit f F3: a tour asked for while off fired uninvited the next time the pack opened). */
export const TOUR_OPEN = 'nv:tour-open';
let pendingTour: string | null = null;
let pendingAt = 0;
export function openTour(id: string): void {
  pendingTour = id;
  pendingAt = Date.now();
  window.dispatchEvent(new CustomEvent<string>(TOUR_OPEN, { detail: id }));
}
/** A dialog opened over a pack tour closes it (p14, 4 Nov 2026: a tour left open sat dimmed but visible behind a
 *  record form, its Close unreachable under the overlay). Whoever opens a dialog dispatches; every tour answers. */
export const TOUR_CLOSE = 'nv:tour-close';
export function closeTours(): void {
  window.dispatchEvent(new CustomEvent(TOUR_CLOSE));
}
export function takePendingTour(id: string): boolean {
  if (pendingTour !== id) return false;
  if (Date.now() - pendingAt > 30_000) {
    pendingTour = null;
    return false;
  }
  pendingTour = null;
  return true;
}
/** The work packs' names for the same tour opening (8.7 w3a): one mechanism, two callers' words. */
export const openPackTour = (id: string): void => openTour(id);
/** Listen for this pack's tour being opened from its menu or the palette. */
export function onPackTour(id: string, open: () => void): () => void {
  const on = (e: Event) => {
    if ((e as CustomEvent<string>).detail === id && takePendingTour(id)) open();
  };
  window.addEventListener(TOUR_OPEN, on);
  return () => window.removeEventListener(TOUR_OPEN, on);
}
