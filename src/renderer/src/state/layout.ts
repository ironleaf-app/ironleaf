// The live workspace (tabs, splits, sidebars) and the open editors, remembered per folder of notes.

import { useSyncExternalStore } from 'react';
import type { EditorView } from '@codemirror/view';
import { prefs } from './store';
import { activeTab, defaultWorkspace, restore, showTabs, withoutPrivate, type Workspace } from './workspace';

let ws: Workspace = defaultWorkspace();
let loaded = false;
const listeners = new Set<() => void>();
const changeListeners = new Set<(prev: Workspace, next: Workspace) => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function getWorkspace(): Workspace {
  return ws;
}

export function useWorkspace(): Workspace {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => ws,
  );
}

export function setWorkspace(next: Workspace | ((w: Workspace) => Workspace)): void {
  const value = typeof next === 'function' ? next(ws) : next;
  if (value === ws) return;
  const prev = ws;
  ws = value;
  for (const fn of listeners) fn();
  for (const fn of changeListeners) fn(prev, value);
  if (!loaded) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void window.nv.state.save('workspace', withoutPrivate(ws)).catch(() => {}), 800);
}

/** Called on each change the person (or a command) makes, with the layout before and after; not on loading one. */
export function subscribeWorkspace(fn: (prev: Workspace, next: Workspace) => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/** The layout saved for this folder of notes, or a fresh one. */
export async function loadWorkspace(): Promise<void> {
  loaded = false;
  // Every vault open (Polish round 3, ITEMS 4): the tabs setting as it stands now decides whether a saved
  // split comes back as one pane (tabs off) or as it was (tabs on), so it is set before the layout is read.
  showTabs(prefs().showTabs);
  const saved = restore(await window.nv.state.load('workspace').catch(() => null));
  ws = saved ?? defaultWorkspace();
  loaded = true;
  for (const fn of listeners) fn();
}

export async function saveWorkspaceNow(): Promise<void> {
  clearTimeout(saveTimer);
  if (loaded) await window.nv.state.save('workspace', withoutPrivate(ws)).catch(() => {});
}

/** What a note tab offers to commands (formatting, templates, links) and to panels (outline, auto-link). */
export interface NoteEditor {
  path: string;
  view(): EditorView | null;
  getText(): string;
  /** Turns `phrase` into a link to `title`, trying `line` first. False when the phrase isn't there. */
  linkPhrase(phrase: string, title: string, line?: number): boolean;
  insertAtCursor(text: string): void;
  /** Goes to a line (from 0); with `span`, lights that many more lines after it for a moment (a cited passage). */
  scrollToLine(line: number, span?: number): void;
  focus(): void;
}

const editors = new Map<string, NoteEditor>();
const editorListeners = new Set<() => void>();
let editorsVersion = 0;

export function registerEditor(tabId: string, editor: NoteEditor | null): void {
  if (editor) editors.set(tabId, editor);
  else editors.delete(tabId);
  editorsVersion++;
  for (const fn of editorListeners) fn();
}

export function editorFor(tabId: string): NoteEditor | undefined {
  return editors.get(tabId);
}

/** The editors showing a note (in any tab), the active tab's first. */
export function editorsOf(path: string): NoteEditor[] {
  const active = editors.get(activeTab(getWorkspace()).id);
  const all = [...editors.values()].filter((e) => e.path === path);
  return active?.path === path ? [active, ...all.filter((e) => e !== active)] : all;
}

/** Bumps when an editor appears or goes, for panels that follow the active one. */
export function useEditorsVersion(): number {
  return useSyncExternalStore(
    (fn) => {
      editorListeners.add(fn);
      return () => editorListeners.delete(fn);
    },
    () => editorsVersion,
  );
}

/** Where to go once a note's editor is ready: a line or a heading (from search, backlinks, links to headings). */
const pendingReveal = new Map<string, { line?: number; heading?: string; span?: number }>();

const revealListeners = new Set<(path: string) => void>();

export function revealLater(path: string, where: { line?: number; heading?: string; span?: number }): void {
  pendingReveal.set(path, where);
  for (const fn of revealListeners) fn(path);
}

/** Told when a place is asked for in a file, for a tab already showing it (a PDF taking a [[file.pdf#page=4]] link). */
export function onReveal(fn: (path: string) => void): () => void {
  revealListeners.add(fn);
  return () => revealListeners.delete(fn);
}

export function takeReveal(path: string): { line?: number; heading?: string; span?: number } | undefined {
  const where = pendingReveal.get(path);
  pendingReveal.delete(path);
  return where;
}
