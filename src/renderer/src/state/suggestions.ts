// The assistant's suggested changes waiting in notes (19 Oct 2026, 5.0.0). With Ask before the assistant changes a note
// on, its edit of a note arrives here instead of being written: each change shows in the note (editor/suggestions.ts) to
// keep or discard, with a bar at the top (views/SuggestionBar.tsx). Nothing reaches the disk until a change is kept, and
// a kept change is written as any typing is (so the note's Undo takes it back), credited to the assistant in the earlier
// versions. The changes follow the person's typing: one whose words they changed is out of date and can only be
// discarded. Kept per note while Ironleaf runs, across tab switches.

import { useSyncExternalStore } from 'react';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { applyHunks, mapHunks, minimalChange, placeHunks, rebaseHunks, type Hunk } from '../../../shared/note-diff';
import type { NoteSuggestionEvent } from '../../../shared/types';
import { docs } from './docs';
import { editorsOf, getWorkspace, setWorkspace } from './layout';
import { prefs, toast } from './store';
import * as W from './workspace';

export interface WaitingChanges {
  /** The note's words the changes are placed on (its text now, once it is open). */
  anchor: string;
  hunks: Hunk[];
  /** The change Next and Previous are on. */
  current: number;
}

const waiting = new Map<string, WaitingChanges>();
const listeners = new Set<() => void>();
let started = false;
let seq = 0;

function emit(): void {
  for (const fn of listeners) fn();
}

/** Every change still saying what it would replace in `text`; any other is out of date. */
function checked(list: Hunk[], text: string): Hunk[] {
  return list.map((h) => (h.stale || text.slice(h.from, h.to) === h.old ? h : { ...h, stale: true, to: h.from }));
}

function set(path: string, entry: WaitingChanges | null): void {
  if (!entry || !entry.hunks.length) waiting.delete(path);
  else waiting.set(path, { ...entry, current: Math.max(0, Math.min(entry.current, entry.hunks.length - 1)) });
  emit();
}

/** Changes from the main side placed on the note as it is here (with typing not saved yet). */
function receive(event: NoteSuggestionEvent): void {
  // Fresh changes rebase on a fresh base: any unknown state heals.
  unsettled.delete(event.path);
  if (event.after === null) return set(event.path, null);
  const text = docs.text(event.path) ?? event.base;
  const hunks = placeHunks(event.base, event.after, text).map((h) => ({ ...h, id: `s${++seq}` }));
  set(event.path, { anchor: text, hunks, current: waiting.get(event.path)?.current ?? 0 });
}

/** Notes whose waiting changes the main side may not know (9.2 uplift F143): a failed tell retries once, then
 *  says so and marks the note, so the next edit never builds on a stale base unheard. */
const unsettled = new Set<string>();

/** Whether a note's waiting changes are in an unknown state (the tell failed twice). */
export function useSuggestionsUnknown(path: string | undefined): boolean {
  return useSyncExternalStore(onSuggestions, () => (path ? unsettled.has(path) : false));
}

/** Listens for the assistant's changes and for the notes' text (once, when the notes open). */
export function startSuggestions(): void {
  if (started) return;
  started = true;
  window.nv.on.suggestions(receive);
  const readList = (retried: boolean): void => {
    void window.nv.suggestions.list().then(
      (list) => list.forEach(receive),
      () => {
        if (!retried) return readList(true);
        toast('The assistant’s waiting changes couldn’t be read just now.');
      },
    );
  };
  readList(false);
  docs.onText((path, text, how, prev) => {
    const entry = waiting.get(path);
    if (!entry || entry.anchor === text) return;
    // Typing moves the changes after it along; a change from disk (a sync) is placed by its lines.
    const moved = how === 'edit' && entry.anchor === prev ? mapHunks(entry.hunks, minimalChange(prev, text)) : rebaseHunks(entry.hunks, entry.anchor, text);
    set(path, { ...entry, anchor: text, hunks: checked(moved, text) });
  });
}

export function suggestionsOf(path: string | undefined): WaitingChanges | undefined {
  return path ? waiting.get(path) : undefined;
}

export function onSuggestions(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSuggestions(path: string | undefined): WaitingChanges | undefined {
  return useSyncExternalStore(onSuggestions, () => suggestionsOf(path));
}

/** The main side told what still waits in a note (the assistant's next edit builds on it). */
function settle(path: string, retried = false): void {
  const entry = waiting.get(path);
  const text = docs.text(path) ?? entry?.anchor;
  if (text === undefined) return;
  const live = entry?.hunks.filter((h) => !h.stale) ?? [];
  void window.nv.suggestions.settle(path, text, live.length ? applyHunks(text, live) : null).then(
    () => {
      if (unsettled.delete(path)) emit();
    },
    () => {
      if (!retried) return settle(path, true);
      unsettled.add(path);
      toast('The assistant couldn’t be told what still waits in this note. Its next change may repeat one already here.');
      emit();
    },
  );
}

/**
 * Changes put into the note: through its editor when one shows it (one step its Undo takes back), else into the open
 * document; saved straight away, credited to the assistant.
 */
function put(path: string, list: Hunk[]): boolean {
  const text = docs.text(path);
  if (text === undefined) return false;
  const fits = list.filter((h) => !h.stale && text.slice(h.from, h.to) === h.old).sort((a, b) => a.from - b.from);
  if (!fits.length) return false;
  const view = editorsOf(path)[0]?.view();
  if (view && view.state.doc.toString() === text) view.dispatch({ changes: fits.map((h) => ({ from: h.from, to: h.to, insert: h.insert })), userEvent: 'input.suggestion' });
  else docs.update(path, applyHunks(text, fits), 'suggestion');
  docs.credit(path, 'assistant');
  void docs.flush(path);
  return true;
}

/** The change a key acts on: the one the cursor is in, else the one Next and Previous are on. */
function currentOf(path: string): Hunk | undefined {
  const entry = waiting.get(path);
  if (!entry) return undefined;
  const view = editorsOf(path)[0]?.view();
  const head = view?.state.selection.main.head;
  return (head !== undefined ? entry.hunks.find((h) => head >= h.from && head <= h.to) : undefined) ?? entry.hunks[entry.current];
}

export function keepSuggestion(path: string, id?: string): void {
  const entry = waiting.get(path);
  const h = id ? entry?.hunks.find((x) => x.id === id) : currentOf(path);
  if (!entry || !h) return;
  const text = docs.text(path);
  if (h.stale || text === undefined || text.slice(h.from, h.to) !== h.old) {
    set(path, { ...entry, hunks: entry.hunks.map((x) => (x === h ? { ...x, stale: true, to: x.from } : x)) });
    toast('That part of the note has changed since, so this suggestion is out of date. Discard it, or ask the assistant again.');
    return;
  }
  const at = entry.hunks.indexOf(h);
  // Taken off first, so the change going in doesn't mark it out of date.
  set(path, { ...entry, hunks: entry.hunks.filter((x) => x !== h), current: at });
  put(path, [h]);
  settle(path);
  // From the keys: on to the next change (a click leaves the page where it is).
  if (!id) reveal(path, true);
}

export function discardSuggestion(path: string, id?: string): void {
  const entry = waiting.get(path);
  const h = id ? entry?.hunks.find((x) => x.id === id) : currentOf(path);
  if (!entry || !h) return;
  set(path, { ...entry, hunks: entry.hunks.filter((x) => x !== h), current: entry.hunks.indexOf(h) });
  settle(path);
  if (!id) reveal(path, true);
}

/** Every change still in date kept; any out of date stay to be discarded. */
export function keepAllSuggestions(path: string): void {
  const entry = waiting.get(path);
  if (!entry) return;
  const live = entry.hunks.filter((h) => !h.stale);
  set(path, { ...entry, hunks: entry.hunks.filter((h) => h.stale), current: 0 });
  if (put(path, live)) toast(live.length === 1 ? 'Kept the suggested change.' : `Kept ${live.length} suggested changes.`);
  settle(path);
}

/** Every change discarded: the note stays exactly as it is. */
export function discardAllSuggestions(path: string): void {
  if (!waiting.has(path)) return;
  set(path, null);
  settle(path);
}

/** Next (1) or previous (-1) change, shown in the note. */
export function moveSuggestion(path: string, step: 1 | -1): void {
  const entry = waiting.get(path);
  if (!entry) return;
  const head = editorsOf(path)[0]?.view()?.state.selection.main.head;
  const inside = head === undefined ? -1 : entry.hunks.findIndex((h) => head >= h.from && head <= h.to);
  const from = inside >= 0 ? inside : entry.current;
  set(path, { ...entry, current: (from + step + entry.hunks.length) % entry.hunks.length });
  reveal(path, true);
}

/** The current change scrolled into the middle, the cursor at its start (so a table or line drawn whole shows its words). */
function reveal(path: string, focus: boolean): void {
  const entry = waiting.get(path);
  const h = entry?.hunks[entry.current];
  const view = editorsOf(path)[0]?.view();
  if (!h || !view) return;
  const at = Math.min(h.from, view.state.doc.length);
  view.dispatch({ selection: EditorSelection.cursor(at), effects: EditorView.scrollIntoView(at, { y: 'center' }) });
  if (focus) view.focus();
}

/** Review from the chat: the note opened for editing (not Reading), at its first change. */
export async function reviewSuggestions(path: string): Promise<void> {
  const A = await import('./actions');
  A.openPath(path, { reuse: true });
  const tab = W.activeTab(getWorkspace());
  if (tab.path === path && (tab.mode ?? prefs().defaultMode) === 'reading') setWorkspace((ws) => W.updateTab(ws, tab.id, { mode: prefs().defaultMode === 'reading' ? 'live' : prefs().defaultMode }));
  const entry = waiting.get(path);
  if (entry) set(path, { ...entry, current: 0 });
  // The editor may only now be opening.
  for (let i = 0; i < 30 && !editorsOf(path)[0]?.view(); i++) await new Promise((r) => setTimeout(r, 50));
  reveal(path, true);
}
