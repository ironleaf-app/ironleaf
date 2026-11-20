// Which full-window panel is open (the quick switcher, commands, Settings, file recovery, slides).

import { useSyncExternalStore } from 'react';
import type { SiteSource } from '../../../shared/site-publish';

export type Modal =
  | { kind: 'switcher' }
  | { kind: 'palette' }
  /** The search window (components/SearchModal.tsx; 8.7 w2c): one search, opened from anywhere by requestSearch. */
  | { kind: 'search'; query?: string }
  | { kind: 'settings'; section?: string; row?: string }
  | { kind: 'recovery'; path?: string }
  | { kind: 'slides'; path: string }
  | { kind: 'new-project'; template?: string }
  | { kind: 'move-vault'; from?: 'settings' }
  /** Reviewing a flashcards note's cards (components/ReviewCards.tsx; notebook mode). */
  | { kind: 'review-cards'; path: string }
  /** Starting from a template (8.8, components/StarterPicker.tsx): the ten starters, in a folder the person names. */
  | { kind: 'starter-picker'; template?: string }
  /** Publish as a website (9.0 w122publish, components/PublishDialog.tsx): a kept site, or a new one from a source. */
  | { kind: 'publish'; siteId?: string; source?: SiteSource }
  /** Names Windows cannot keep (components/NamesDialog.tsx): the plan, asked once, with one Undo. */
  | { kind: 'names' }
  | null;

let modal: Modal = null;
const listeners = new Set<() => void>();

export function openModal(next: Modal): void {
  modal = next;
  for (const fn of listeners) fn();
}

export function closeModal(): void {
  openModal(null);
}

/** Whether a change of window cancels a pending pick: opening one over the page does; closing one never does (8.9
 *  w114pdf round 2: the palette closes before its command's picker opens, so cancelling on the close killed "Open a
 *  PDF in the reader…"'s list before it showed — and every other palette command that picks). */
export function modalChangeCancelsPick(was: string | null, now: string | null): boolean {
  return now !== null && now !== was;
}

export function useModal(): Modal {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => modal,
  );
}

/** Search requests (8.7 w2c: a query to run, from a tag click, a bookmark, Home's Find): the search window opens with
 *  it, and the search in the left panel follows it too, so whichever the person sees shows the same words. */
let searchRequest: { query: string; at: number } | null = null;
const searchListeners = new Set<() => void>();

/** One search, one window (8.7 w2c round 3: it opened off to the left too, docked as the left panel beside the
 *  centred window): callers ask here and open nothing else; the palette is the shape (a centred window, no panel). */
export function requestSearch(query: string): void {
  searchRequest = { query, at: Date.now() };
  for (const fn of searchListeners) fn();
  openModal({ kind: 'search', query });
}

export function useSearchRequest(): { query: string; at: number } | null {
  return useSyncExternalStore(
    (fn) => {
      searchListeners.add(fn);
      return () => searchListeners.delete(fn);
    },
    () => searchRequest,
  );
}

/** A door into Settings naming its row (4 Nov 2026, the 14 doors): asked here, taken once by the Settings page,
 *  which lands on it the same way as a search hit. Never in a tab, so saved layouts stay bare sections. */
let settingsDoor: { row: string; at: number } | null = null;
const doorListeners = new Set<() => void>();

export function requestSettingsDoor(row: string): void {
  settingsDoor = { row, at: Date.now() };
  for (const fn of doorListeners) fn();
}

export function takeSettingsDoor(): { row: string; at: number } | null {
  const r = settingsDoor;
  if (r) {
    settingsDoor = null;
    for (const fn of doorListeners) fn();
  }
  return r;
}

export function useSettingsDoor(): { row: string; at: number } | null {
  return useSyncExternalStore(
    (fn) => {
      doorListeners.add(fn);
      return () => doorListeners.delete(fn);
    },
    () => settingsDoor,
  );
}
