// Private notes in the window (src/main/private-notes.ts): whether they are set up and open, their list while open, and
// what locking does here: every private note's tab and words leave the window.

import { useEffect, useSyncExternalStore } from 'react';
import { isPrivatePath } from '../../../shared/private';
import type { PrivateEntry, PrivateStatus } from '../../../shared/types';
import { docs } from './docs';
import { getWorkspace, setWorkspace } from './layout';
import { showError } from './store';
import * as W from './workspace';

interface PrivateState {
  status: PrivateStatus | null;
  notes: PrivateEntry[];
}

let state: PrivateState = { status: null, notes: [] };
const listeners = new Set<() => void>();
let listening = false;

function set(next: Partial<PrivateState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

/** Every private note's tab shows nothing, and its words are forgotten here. */
function closeAll(): void {
  for (const g of W.groups(getWorkspace().root)) for (const t of g.tabs) if (t.path && isPrivatePath(t.path)) docs.forget(t.path);
  setWorkspace((ws) => W.withoutPrivate(ws));
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.nv.on.privateLocked(() => {
    closeAll();
    set({ notes: [], status: state.status ? { ...state.status, unlocked: false, count: 0 } : null });
  });
}

export async function refreshPrivate(): Promise<PrivateStatus | null> {
  listen();
  try {
    const status = await window.nv.private.status();
    set({ status, notes: status.unlocked ? await window.nv.private.list() : [] });
    return status;
  } catch (err) {
    showError(err);
    return null;
  }
}

export function usePrivate(): PrivateState {
  listen();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

/** Opened (or set up): the list read. */
export async function privateOpened(status: PrivateStatus): Promise<void> {
  set({ status, notes: status.unlocked ? await window.nv.private.list() : [] });
}

/** Locked by the person: what they typed is saved first. */
export async function lockPrivate(): Promise<void> {
  const open = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => t.path)).filter((p): p is string => !!p && isPrivatePath(p));
  await Promise.all(open.map((p) => docs.flush(p)));
  closeAll();
  set({ status: await window.nv.private.lock(), notes: [] });
}

/** While the person is reading Secrets or Private notes, the window says so (8.2), so the strict idle lock does not fall mid-read. */
export function usePrivateWindowUse(unlocked: boolean): void {
  useEffect(() => {
    if (!unlocked) return;
    const ping = () => void window.nv.private.used().catch(() => {});
    ping();
    const timer = window.setInterval(ping, 30_000);
    const onVisible = () => { if (!document.hidden) ping(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', ping);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', ping); };
  }, [unlocked]);
}

export async function reloadPrivateList(): Promise<void> {
  if (state.status?.unlocked) set({ notes: await window.nv.private.list() });
}
