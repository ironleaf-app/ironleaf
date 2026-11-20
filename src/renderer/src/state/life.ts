// The life-OS windows (Wave 4, 24 Oct 2026): the move into areas, the areas editor, the tag manager, making people's
// cards and putting two names together. Their own small store, so they open over any page (components/LifeHost.tsx).
// Also the pages' openers: the Inbox, People and Organisations.

import { useSyncExternalStore } from 'react';
import { moduleOn } from '../../../shared/life-modules';
import { getWorkspace, setWorkspace } from './layout';
import { offerPack } from './modules';
import { getState, loadNotes, showError, toast } from './store';
import * as W from './workspace';

export type LifeModal =
  | { kind: 'migration' }
  | { kind: 'areas' }
  | { kind: 'tags'; tag?: string }
  | { kind: 'make-cards'; area?: string }
  | { kind: 'same-people' }
  | null;

let modal: LifeModal = null;
const listeners = new Set<() => void>();
export function openLife(next: LifeModal): void {
  modal = next;
  listeners.forEach((fn) => fn());
}
export const closeLife = () => openLife(null);
export function useLifeModal(): LifeModal {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => modal,
  );
}

/** A page there is one of (the Inbox, People): brought forward when open, else opened where asked.
 *  Meetings respects its pack switch (3 Nov 2026, audit f F2): off offers to switch on (5 Nov 2026, h3 dead
 *  buttons: the palette's "Open Meetings" did nothing with the pack off), through the one offer, never silent. */
function openOne(type: 'inbox' | 'people' | 'meetings', where: W.Where = 'current'): void {
  if (type === 'meetings' && !moduleOn(getState().settings?.prefs.modules, 'meetings')) return offerPack('meetings', () => openOne('meetings', where));
  // The list tab only, never a detail tab wearing the same type (9 Nov 2026, t152 every control: a person page is
  // a 'people' tab too, so the People row re-activated it and nobody got back to the list; a meetings part tab
  // would likewise come forward instead of the page).
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === type && (t.path ?? '') === `${type}:`);
  if (existing && where === 'current') return setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id));
  setWorkspace((ws) => W.open(ws, { type, path: `${type}:` }, where));
}
export const openInbox = (where?: W.Where) => openOne('inbox', where);
export const openPeople = (where?: W.Where) => openOne('people', where);
/** The Meetings page (Polish round 1, ITEMS 3): its own page, not the meeting notes' table. */
export const openMeetings = (where?: W.Where) => openOne('meetings', where);

/** Something changed in the life-OS data the pages show (cards made, an item filed): they read again. */
let tick = 0;
const tickListeners = new Set<() => void>();
export function lifeChanged(): void {
  tick++;
  tickListeners.forEach((fn) => fn());
}
export function useLifeTick(): number {
  return useSyncExternalStore(
    (fn) => {
      tickListeners.add(fn);
      return () => tickListeners.delete(fn);
    },
    () => tick,
  );
}

/** Two names put together from any door (the People page's pairs, the Review dialog): merged, then said with Undo. */
export async function mergePair(keep: string, other: string): Promise<void> {
  try {
    const r = await window.nv.life.people.merge(keep, other);
    await loadNotes();
    lifeChanged();
    toast(r.words, {
      label: 'Undo',
      run: () => {
        void window.nv.life.people
          .mergeUndo()
          .then(async (u) => {
            await loadNotes();
            lifeChanged();
            toast(u.words);
          })
          .catch(showError);
      },
    });
  } catch (err) {
    showError(err);
  }
}
