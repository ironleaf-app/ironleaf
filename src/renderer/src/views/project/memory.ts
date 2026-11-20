// What a project's page remembers, per project, in this library's own state (src/main/library-state.ts 'projects'): which
// folders of files are open, list or grid, and the sort. Kept like the file explorer's open folders: in Ironleaf's data
// folder, never among the notes.

import { useEffect, useState } from 'react';
import type { FileSort } from './fileModel';

/** One project page's eight tabs (8.7 wave 2a, plus Money in 10.0). Kept for old links: the folio reads a
 *  remembered tab as its section (sectionForTab below), so every old link lands where it meant. */
export type ProjectTab = 'overview' | 'tasks' | 'notes' | 'files' | 'people' | 'money' | 'decisions' | 'timeline';

/** One folio section of a project's page (5 Nov 2026, the vault folio: the eight tabs became one scrolling page;
 *  step 2, 12 Nov 2026 — yours, waiting, questions, dates, notes, people, decisions, risks, then the rest). */
export type FolioSection = 'whats-next' | 'waiting' | 'questions' | 'key-dates' | 'people' | 'decisions' | 'notes' | 'files' | 'risks' | 'updates' | 'money' | 'activity';

/** The folio's sections in the page's order, with the words the sticky line and the heads share. */
export const FOLIO_SECTIONS: { id: FolioSection; title: string }[] = [
  { id: 'whats-next', title: 'Your next' },
  { id: 'waiting', title: 'Waiting on others' },
  { id: 'questions', title: 'Open questions' },
  { id: 'key-dates', title: 'Key dates' },
  // Notes, documents and files in one list (t239, their decision 4): the Files split is gone.
  { id: 'notes', title: 'Notes and files' },
  { id: 'people', title: 'People' },
  { id: 'decisions', title: 'Decisions' },
  { id: 'risks', title: 'Risks' },
  // Chats (one product, 9 Nov 2026, DESIGN A.5): its former host app conversations, after the work
  // reads.
  { id: 'updates', title: 'Updates' },
  { id: 'money', title: 'Money' },
  { id: 'activity', title: 'Activity' },
];

/** One of the project page's own tabs (t255, 13 Nov 2026: the section bar became real tabs, Overview
 *  first). 'files' stays out: it reads merged in Notes and files (t239), never as its own tab. */
export type ProjectTabId = FolioSection | 'overview';

/** The page's tabs in order: Overview first, then every section in the folio's own words and order. */
export const PROJECT_TABS: { id: ProjectTabId; title: string }[] = [
  { id: 'overview', title: 'Overview' },
  ...FOLIO_SECTIONS.filter((s) => s.id !== 'files').map((s) => ({ id: s.id as ProjectTabId, title: s.title })),
];

/** True for one of the page's own tab ids (history and memory are validated through it). */
export function isProjectTabId(id: string | undefined): id is ProjectTabId {
  return id === 'overview' || (FOLIO_SECTIONS.some((s) => s.id === id) && id !== 'files');
}

/** Where an old tab link lands on the folio (every remembered tab, every tab its buttons named; an old files tab
 *  lands on the merged list, t239). */
export function sectionForTab(tab: ProjectTab | 'details' | undefined): FolioSection | null {
  switch (tab) {
    case 'tasks':
      return 'whats-next';
    case 'notes':
      return 'notes';
    case 'files':
      return 'notes';
    case 'people':
      return 'people';
    case 'money':
      return 'money';
    case 'decisions':
      return 'decisions';
    case 'timeline':
      return 'key-dates';
    default:
      return null;
  }
}

/** The tab a folio section answers for, so the page still remembers where the person was. */
export function tabForSection(id: FolioSection): ProjectTab {
  switch (id) {
    case 'whats-next':
      return 'tasks';
    case 'waiting':
      return 'tasks';
    case 'questions':
      return 'tasks';
    case 'key-dates':
      return 'timeline';
    case 'notes':
      return 'notes';
    case 'files':
      return 'files';
    case 'people':
      return 'people';
    case 'money':
      return 'money';
    case 'decisions':
      return 'decisions';
    case 'risks':
    case 'updates':
    case 'activity':
      return 'overview';
    default:
      return 'overview';
  }
}

export interface ProjectMemory {
  /** Folders opened, and folders shut, by the person (others follow the page's default). */
  open?: string[];
  shut?: string[];
  view?: 'list' | 'grid';
  sort?: FileSort;
  /** The page's tab (8.7 wave 2a: Overview, Tasks, Notes, Files, People, Decisions, Timeline, plus Money in 10.0;
   *  'details' is the pre-8.7 tab, read as Overview). */
  tab?: ProjectTab | 'details';
  /** The page's own tab id (t255: the last tab opened, remembered per project; read before `tab`). */
  section?: string;
  /** The Timeline's zoom, and the groups folded away on it. */
  planZoom?: 'week' | 'month' | 'quarter';
  planShut?: string[];
}

let all: Record<string, ProjectMemory> | null = null;
let loading: Promise<void> | null = null;
let timer = 0;
const listeners = new Set<() => void>();

function load(): Promise<void> {
  loading ??= window.nv.state
    .load<Record<string, ProjectMemory>>('projects')
    .catch(() => null)
    .then((saved) => {
      all = saved && typeof saved === 'object' ? saved : {};
      listeners.forEach((fn) => fn());
    });
  return loading;
}

function save(): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (!all) return;
    // Only the most recent projects are kept (a library of hundreds stays small).
    const entries = Object.entries(all).slice(-200);
    void window.nv.state.save('projects', Object.fromEntries(entries)).catch(() => undefined);
  }, 400);
}

/** A project renamed or moved (its file, or a folder it is in): its memory goes with it, so the page stays on the tab it
 *  was on (renaming from the Details tab sent the page back to Overview). */
export function moveProjectMemory(from: string, to: string): void {
  if (!all || !from || from === to) return;
  let moved = false;
  for (const key of Object.keys(all)) {
    const next = key === from ? to : key.startsWith(`${from}/`) ? `${to}${key.slice(from.length)}` : null;
    if (next === null) continue;
    all[next] = { ...(all[next] ?? {}), ...all[key] };
    delete all[key];
    moved = true;
  }
  if (!moved) return;
  listeners.forEach((l) => l());
  save();
}

/** The page's memory for one project, and a way to change it. */
export function useProjectMemory(path: string): [ProjectMemory, (change: (m: ProjectMemory) => ProjectMemory) => void] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    void load();
    return () => void listeners.delete(fn);
  }, []);
  const memory = all?.[path] ?? {};
  const change = (fn: (m: ProjectMemory) => ProjectMemory) => {
    all ??= {};
    const next = fn(all[path] ?? {});
    // Most recently used last.
    delete all[path];
    all[path] = next;
    listeners.forEach((l) => l());
    save();
  };
  return [memory, change];
}

/** True once the project's memory has loaded (t255: the open tab settles only then, so a fresh open
 *  lands on the remembered tab without ever flashing the default). */
export function useProjectMemoryReady(): boolean {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    void load();
    return () => void listeners.delete(fn);
  }, []);
  return all !== null;
}
