// What the file list remembers between visits, in Ironleaf's own data for this library (never among the notes): the
// way it's shown (sections or folders), the folder tree's sort and open folders, which sections and rows are open, and
// whether attachments show, and the orders dragged into place. One saved object; each part of the list changes only its own fields.

import { useEffect, useSyncExternalStore } from 'react';
import type { NavSort, SectionId } from '../../../shared/navigator';

export interface ExplorerMemory {
  mode?: 'sections' | 'folders';
  sort?: NavSort;
  /** The folder tree's open folders. */
  expanded?: string[];
  /** Sections the person opened or shut (others follow their default). */
  sections?: Partial<Record<SectionId, boolean>>;
  /** Rows opened in the sections (projects, their parts, folders), and rows open at first that the person shut. */
  open?: string[];
  shut?: string[];
  showAttachments?: boolean;
  /** Orders of the person's own, dragged into place (shared/navigator.ts inOrder): the places, the sections, projects, docs,
   *  canvases, and each folder's folders and notes, as their keys in order. */
  order?: Record<string, string[]>;
}

let memory: ExplorerMemory = {};
let loaded = false;
let loading: Promise<void> | null = null;
let timer = 0;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((fn) => fn());

function load(): Promise<void> {
  loading ??= window.nv.state
    .load<ExplorerMemory>('explorer')
    .catch(() => null)
    .then((saved) => {
      const was: ExplorerMemory = saved && typeof saved === 'object' ? saved : {};
      // Anything changed before the saved state arrived is added to it, never put in its place.
      const both = (x?: string[], y?: string[]) => (x || y ? [...new Set([...(x ?? []), ...(y ?? [])])] : undefined);
      memory = { ...was, ...memory, open: both(was.open, memory.open), shut: both(was.shut, memory.shut), sections: was.sections || memory.sections ? { ...was.sections, ...memory.sections } : undefined, order: was.order || memory.order ? { ...was.order, ...memory.order } : undefined };
      loaded = true;
      tell();
    });
  return loading;
}

export function explorerMemory(): ExplorerMemory {
  return memory;
}

/** Changes some of what's remembered, and saves it a moment later. */
export function rememberExplorer(change: Partial<ExplorerMemory> | ((m: ExplorerMemory) => Partial<ExplorerMemory>)): void {
  const patch = typeof change === 'function' ? change(memory) : change;
  memory = { ...memory, ...patch };
  // Long-lived libraries stay small: the most recent rows opened are kept.
  if (memory.open && memory.open.length > 600) memory.open = memory.open.slice(-600);
  if (memory.shut && memory.shut.length > 300) memory.shut = memory.shut.slice(-300);
  tell();
  if (!loaded) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => void window.nv.state.save('explorer', memory).catch(() => undefined), 400);
}

/** The remembered state (read again when it changes), and whether it has been read yet. */
export function useExplorerMemory(): [ExplorerMemory, boolean] {
  const m = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => memory,
  );
  useEffect(() => void load(), []);
  return [m, loaded];
}

// ── A section asked for (Ironleaf Calm, 20 Oct 2026) ──────────────────────────────────────────────────────────────
// The calm left side lists the kinds of thing in the vault; a kind with no page of its own yet (Docs, Notes, Daily…)
// opens the Files panel at its section. The list may not be on screen yet when asked, so the request waits here for it.

let wanted: SectionId | null = null;
const wantedListeners = new Set<() => void>();

/** Shows a section in the file list: in sections, that section open (and attachments shown, for Attachments). */
export function askForSection(section: SectionId): void {
  rememberExplorer((m) => ({ mode: 'sections', sections: { ...m.sections, [section]: true }, ...(section === 'attachments' ? { showAttachments: true } : {}) }));
  wanted = section;
  wantedListeners.forEach((fn) => fn());
}

/** The section asked for, once (the file list scrolls to it). */
export function takeAskedSection(): SectionId | null {
  const s = wanted;
  wanted = null;
  return s;
}

export function onAskedSection(fn: () => void): () => void {
  wantedListeners.add(fn);
  return () => void wantedListeners.delete(fn);
}
