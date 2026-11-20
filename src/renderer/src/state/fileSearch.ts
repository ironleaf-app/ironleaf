// Searching inside project files, as the window uses it (src/main/file-index.ts): hits for words typed (the search
// panel, Open a note, commands, the navigator, a project's Files), the files index's progress, and the file shown from a
// hit (in the full viewer as a tab, views/FolderFileView.tsx — t239, 12 Nov 2026: a click opens the document itself).

import { useEffect, useState, useSyncExternalStore } from 'react';
import { parseProjectFileHref, type FileHit, type FileIndexStatus } from '../../../shared/file-index';
import { folderHandle, isRemoteProject } from '../../../shared/project-folder';
import { parseQuery, type QueryNode } from '../../../shared/query';
import * as A from './actions';
import { showError } from './store';

// ── The index's progress ──────────────────────────────────────────────────────────────────────────────────────────

let status: FileIndexStatus | null = null;
let asked = false;
const statusListeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;
const setStatus = (s: FileIndexStatus) => {
  status = s;
  statusListeners.forEach((fn) => fn());
};

function watchStatus(fn: () => void): () => void {
  statusListeners.add(fn);
  if (!unsubscribe) unsubscribe = window.nv.on.fileIndexStatus(setStatus);
  if (!asked) {
    asked = true;
    void window.nv.fileIndex.status().then(setStatus, () => (asked = false));
  }
  return () => statusListeners.delete(fn);
}

/** The files index now: on or off, reading or not, how much it holds. */
export function useFileIndexStatus(): FileIndexStatus | null {
  return useSyncExternalStore(watchStatus, () => status);
}

/** "Reading project files… 34 of 79 · Studio Upgrade", while it reads; '' when it doesn't. */
export function progressWords(s: FileIndexStatus | null): string {
  if (!s?.on || !s.busy || !s.todo) return '';
  return `Reading project files… ${Math.min(s.done, s.todo)} of ${s.todo}${s.current ? ` · ${s.current}` : ''}`;
}

// ── Hits for words typed ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Project files matching the words typed (at least `min` characters), asked a moment after typing stops, and again
 * when the index finishes reading (more may match). `project` keeps to one project.
 */
export function useFileHits(query: string, { project, enabled = true, min = 2, limit = 60 }: { project?: string; enabled?: boolean; min?: number; limit?: number } = {}): { hits: FileHit[]; busy: boolean } {
  const s = useFileIndexStatus();
  const [hits, setHits] = useState<FileHit[]>([]);
  const [busy, setBusy] = useState(false);
  const q = query.trim();
  const ready = enabled && q.length >= min && s?.on !== false;
  // Asked again when reading finishes, and every so often while it reads (files keep coming in).
  const round = s ? `${s.busy}:${s.busy ? Math.floor(s.done / 25) : s.files}:${s.withText}` : '';
  useEffect(() => {
    if (!ready) {
      setHits([]);
      setBusy(false);
      return;
    }
    let live = true;
    setBusy(true);
    const timer = setTimeout(() => {
      window.nv.fileIndex
        .search(q, { ...(project ? { project } : {}), limit })
        .then((r) => live && setHits(r), () => live && setHits([]))
        .finally(() => live && setBusy(false));
    }, 170);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, ready, project, limit, round]);
  return { hits: ready ? hits : [], busy: ready && busy };
}

// ── The file shown from a hit ─────────────────────────────────────────────────────────────────────────────────────

export interface ShownHit {
  hit: FileHit;
  /** The hits it came from (← → go through them) and the words searched for (marked in its words). */
  list: FileHit[];
  query: string;
}

let shown: ShownHit | null = null;
const shownListeners = new Set<() => void>();
const emitShown = () => shownListeners.forEach((fn) => fn());

/** The words a file was found by, for the viewer to mark (taken once, by the tab that opens for the hit). */
const fileQueries = new Map<string, string>();
export function stashFileQuery(project: string, rel: string, query: string): void {
  if (!query.trim()) return;
  if (fileQueries.size > 20) fileQueries.delete(fileQueries.keys().next().value!);
  fileQueries.set(`${project}\n${rel}`, query);
}
export function takeFileQuery(project: string, rel: string): string {
  const key = `${project}\n${rel}`;
  const q = fileQueries.get(key) ?? '';
  fileQueries.delete(key);
  return q;
}

/** Shows a project file found by a search: the file itself in the full viewer as a tab, its searched words marked
 *  where the viewer shows words (t239: a click opens the document, never a window over it). */
export function showFileHit(hit: FileHit, list: FileHit[] = [hit], query = '', where: 'current' | 'tab' = 'current'): void {
  void list;
  stashFileQuery(hit.project, hit.rel, query);
  A.openFolderFile(hit.project, hit.rel, where);
}

export function closeFileHit(): void {
  shown = null;
  emitShown();
}

export function stepFileHit(by: number): void {
  if (!shown || shown.list.length < 2) return;
  const at = shown.list.findIndex((h) => h.project === shown!.hit.project && h.rel === shown!.hit.rel);
  shown = { ...shown, hit: shown.list[(at + by + shown.list.length) % shown.list.length] };
  emitShown();
}

export function useShownFileHit(): ShownHit | null {
  return useSyncExternalStore(
    (fn) => {
      shownListeners.add(fn);
      return () => shownListeners.delete(fn);
    },
    () => shown,
  );
}

export const openHitInProgram = (hit: Pick<FileHit, 'project' | 'rel'>) => void window.nv.projects.openFile(hit.project, hit.rel).catch(showError);
export const showHitInFolder = (hit: Pick<FileHit, 'project' | 'rel'>) => void window.nv.projects.showFile(hit.project, hit.rel).catch(showError);

/** The plain words of a search, for marking them in a file's words: the same parse the search itself runs
 *  (9.2 uplift F81), so the marks match what was typed. Excluded words, patterns and filename-only scopes mark
 *  nothing; a "from:x" the parser reads as words marks as words. */
export function searchWords(query: string): string[] {
  const root = parseQuery(query);
  if (!root) return [];
  const out: string[] = [];
  const walk = (n: QueryNode, negated: boolean): void => {
    if (n.type === 'term') {
      if (!negated && n.text.trim()) out.push(n.text.trim());
    } else if (n.type === 'not') walk(n.item, true);
    else if (n.type === 'and' || n.type === 'or') n.items.forEach((i) => walk(i, negated));
    else if (n.type === 'op') {
      if (n.op === 'content') walk(n.item, negated);
    } else if (n.type === 'prop') {
      if (n.item) walk(n.item, true);
    }
  };
  walk(root, false);
  return [...new Set(out)];
};

/** Where `words` fall in a line, [start, end), joined where they overlap. */
export function markRanges(line: string, words: string[]): [number, number][] {
  const lower = line.toLowerCase();
  const out: [number, number][] = [];
  for (const w of words) {
    const needle = w.toLowerCase();
    for (let at = lower.indexOf(needle); at >= 0 && out.length < 40; at = lower.indexOf(needle, at + needle.length)) out.push([at, at + needle.length]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** A link to a project's file (nv-file:…, the assistant's answers): the file shown, as from a search. */
export async function openProjectFileLink(href: string): Promise<void> {
  const where = parseProjectFileHref(href);
  if (!where) return;
  try {
    const [view, files] = await Promise.all([window.nv.projects.view(where.project), window.nv.projects.files(where.project)]);
    const key = where.rel.replace(/\\/g, '/').toLowerCase();
    const remote = isRemoteProject(view.project);
    if (remote && files?.problem) throw new Error(files.problem.words);
    let f = files?.groups.flatMap((g) => g.files).find((x) => x.rel.toLowerCase() === key);
    // A remote file deeper than the listing goes: shown by its path (the viewer fetches it).
    if (!f && remote) {
      const name = where.rel.split('/').pop() ?? where.rel;
      f = { rel: where.rel.replace(/\\/g, '/'), name, ext: name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '', size: 0, modified: 0 };
    }
    const folder = folderHandle(view.project);
    if (!f || !folder) throw new Error(`${where.rel.split('/').pop()} isn’t in ${view.project.name}’s folder now: it may have moved or been renamed.`);
    showFileHit({ project: where.project, projectName: view.project.name, folder, ...(remote ? { remoteName: files?.remote?.name } : {}), rel: f.rel, name: f.name, ext: f.ext, size: f.size, modified: f.modified, created: f.created ?? f.modified, state: 'text', score: 0, matches: 0, snippets: [], byName: false });
  } catch (err) {
    showError(err);
  }
}
