// What the whole window shares: the open folder of notes, settings, every note's details and the file list. A small
// store (no library): components read slices with useApp, and the loaders below keep it current.

import { useSyncExternalStore } from 'react';
import { DEFAULT_PREFS, type Prefs } from '../../../shared/prefs';
import type { AppSettings, ListedFile, NoteMeta, VaultInfo } from '../../../shared/types';
import { errorMessage } from '../lib/errors';
import { toastClock } from '../lib/toastClock';

export interface AppState {
  vault: VaultInfo | null;
  settings: AppSettings | null;
  notes: NoteMeta[];
  byPath: Map<string, NoteMeta>;
  files: ListedFile[];
  folders: string[];
  /** Bumped whenever any note's links, tags or text change (panels re-read then). */
  revision: number;
  filesRevision: number;
  /** Send to the former host app (inside the former host app only). */
  canSend: boolean;
  /** Whether notes can be changed (without a licence, Ironleaf reads and exports only). */
  canEdit: boolean;
  toast: { words: string; action?: { label: string; run(): void }; leaving?: boolean } | null;
}

let state: AppState = {
  vault: null,
  settings: null,
  notes: [],
  byPath: new Map(),
  files: [],
  folders: [],
  revision: 0,
  filesRevision: 0,
  canSend: false,
  canEdit: true,
  toast: null,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A slice of the shared state; the selector must return something already in the state (not a new object). */
export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

export function usePrefs(): Prefs {
  return useApp((s) => s.settings?.prefs ?? DEFAULT_PREFS);
}

export function prefs(): Prefs {
  return state.settings?.prefs ?? DEFAULT_PREFS;
}

const api = () => window.nv;

export async function loadNotes(): Promise<void> {
  const notes = await api().vault.list();
  setState((s) => ({ notes, byPath: new Map(notes.map((n) => [n.path, n])), revision: s.revision + 1 }));
}

/**
 * Opening the notes boots light (5 Nov 2026, v5-vault-speed): the light list names every note for the lists,
 * then the whole list lands behind it and the panels re-read once, on complete details. An older host without
 * the light list boots from the whole list as before.
 */
export async function loadNotesFast(): Promise<void> {
  const slim = await api().vault.listSlim().catch(() => null);
  if (!slim) return loadNotes();
  setState({ notes: slim, byPath: new Map(slim.map((n) => [n.path, n])) });
  await loadNotes();
}

export async function loadFiles(): Promise<void> {
  const { files, folders } = await api().files.list();
  setState((s) => ({ files, folders, filesRevision: s.filesRevision + 1 }));
}

export async function loadSettings(): Promise<void> {
  setState({ settings: await api().settings.get() });
}

export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  setState({ settings: await api().settings.update({ prefs: patch }) });
}

// A message at the foot of the window: how long it stays is lib/toastClock.ts (it goes by itself; waits while the
// pointer rests on it; a late timer or the next click or key after its time ends it all the same). Going is a fade,
// not a vanish (5 Nov 2026 feel-motion): the clock's end starts a leaving phase, and the message unmounts after its
// 120ms; a newer message in between cancels the old one's unmount.
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function endToast(): void {
  const t = state.toast;
  if (!t || t.leaving) return;
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setState({ toast: null });
    return;
  }
  setState({ toast: { ...t, leaving: true } });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastTimer = null;
    if (state.toast?.leaving) setState({ toast: null });
  }, 140);
}
const toastTime = toastClock({
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  hidden: () => typeof document !== 'undefined' && document.hidden,
  onEnd: endToast,
});
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => !document.hidden && toastTime.seen());
  window.addEventListener('pointerdown', () => toastTime.poke(), true);
  window.addEventListener('keydown', () => toastTime.poke(), true);
}
export function toast(words: string, action?: { label: string; run(): void }, ms = 5000): void {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  setState({ toast: { words, action } });
  toastTime.show(ms);
}
/** The pointer resting on the message (true) or leaving it (false). */
export const holdToast = (on: boolean) => toastTime.hold(on);
/** The message closed by hand (its × or its action): through the clock, so it fades like a timed end. */
export const closeToast = () => toastTime.close();

export function showError(err: unknown): void {
  // Every failure in the person's own words (lib/errors.ts, 9.2 uplift F22): never a path or a code.
  toast(errorMessage(err), undefined, 7000);
}
