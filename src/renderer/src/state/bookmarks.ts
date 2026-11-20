// Bookmarks: notes, files, folders, headings and searches kept to hand, in groups if the person wants, per folder of notes.

import { useSyncExternalStore } from 'react';
import { newId } from './workspace';
import { toast } from './store';

export type Bookmark =
  | { id: string; type: 'file'; path: string; title?: string }
  | { id: string; type: 'folder'; path: string; title?: string }
  | { id: string; type: 'heading'; path: string; heading: string; title?: string }
  | { id: string; type: 'search'; query: string; title?: string }
  | { id: string; type: 'group'; title: string; items: Bookmark[] };

let items: Bookmark[] = [];
const listeners = new Set<() => void>();

function set(next: Bookmark[]): void {
  items = next;
  for (const fn of listeners) fn();
  void window.nv.state.save('bookmarks', items).catch(() => toast('Bookmarks could not be saved on this PC just now. They may not be there next time.'));
}

export function useBookmarks(): Bookmark[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => items,
  );
}

export async function loadBookmarks(): Promise<void> {
  const saved = await window.nv.state.load<Bookmark[]>('bookmarks').catch(() => null);
  items = Array.isArray(saved) ? saved.filter((b) => b && typeof b.id === 'string' && typeof b.type === 'string') : [];
  for (const fn of listeners) fn();
}

const flat = (list: Bookmark[]): Bookmark[] => list.flatMap((b) => (b.type === 'group' ? [b, ...flat(b.items)] : [b]));

export function isBookmarked(path: string): boolean {
  return flat(items).some((b) => (b.type === 'file' || b.type === 'folder') && b.path === path);
}

type NewBookmark = { type: 'file'; path: string; title?: string } | { type: 'folder'; path: string; title?: string } | { type: 'heading'; path: string; heading: string; title?: string } | { type: 'search'; query: string; title?: string } | { type: 'group'; title: string; items: Bookmark[] };

export function addBookmark(b: NewBookmark): void {
  // Found first (W5-21): the same page, heading or search is never stacked twice.
  const same = (x: Bookmark): boolean =>
    (b.type === 'file' && x.type === 'file' && x.path === b.path) ||
    (b.type === 'folder' && x.type === 'folder' && x.path === b.path) ||
    (b.type === 'heading' && x.type === 'heading' && x.path === b.path && x.heading === b.heading) ||
    (b.type === 'search' && x.type === 'search' && x.query === b.query);
  if (b.type !== 'group' && flat(items).some(same)) return;
  set([...items, { ...b, id: newId('b') } as Bookmark]);
}

export function toggleBookmark(path: string, type: 'file' | 'folder' = 'file'): boolean {
  if (isBookmarked(path)) {
    set(removeWhere(items, (b) => (b.type === 'file' || b.type === 'folder') && b.path === path));
    return false;
  }
  addBookmark({ type, path });
  return true;
}

function removeWhere(list: Bookmark[], test: (b: Bookmark) => boolean): Bookmark[] {
  return list.filter((b) => !test(b)).map((b) => (b.type === 'group' ? { ...b, items: removeWhere(b.items, test) } : b));
}

export function removeBookmark(id: string): void {
  set(removeWhere(items, (b) => b.id === id));
}

export function renameBookmark(id: string, title: string): void {
  const walk = (list: Bookmark[]): Bookmark[] => list.map((b) => (b.id === id ? { ...b, title } : b.type === 'group' ? { ...b, items: walk(b.items) } : b));
  set(walk(items));
}

/** Moves a bookmark before another (or to the end of a group). */
export function moveBookmark(id: string, beforeId: string | null, groupId: string | null = null): void {
  let moving: Bookmark | undefined;
  const take = (list: Bookmark[]): Bookmark[] =>
    list.filter((b) => {
      if (b.id === id) {
        moving = b;
        return false;
      }
      return true;
    }).map((b) => (b.type === 'group' ? { ...b, items: take(b.items) } : b));
  const without = take(items);
  if (!moving) return;
  const item = moving;
  const put = (list: Bookmark[], inGroup: boolean): Bookmark[] => {
    if ((groupId === null && !inGroup) || inGroup) {
      const at = beforeId ? list.findIndex((b) => b.id === beforeId) : -1;
      if (at >= 0) return [...list.slice(0, at), item, ...list.slice(at)];
    }
    return list.map((b) => (b.type === 'group' && b.id === groupId ? { ...b, items: beforeId ? put(b.items, true) : [...b.items, item] } : b.type === 'group' ? { ...b, items: put(b.items, true) } : b));
  };
  let next = put(without, false);
  if (!flat(next).some((b) => b.id === id)) next = [...next, item];
  set(next);
}

/** A file or folder moved: bookmarks follow it. */
export function bookmarksRenamed(from: string, to: string): void {
  const move = (p: string) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
  let changed = false;
  const walk = (list: Bookmark[]): Bookmark[] =>
    list.map((b) => {
      if (b.type === 'group') return { ...b, items: walk(b.items) };
      if ((b.type === 'file' || b.type === 'folder' || b.type === 'heading') && move(b.path) !== b.path) {
        changed = true;
        return { ...b, path: move(b.path) };
      }
      return b;
    });
  const next = walk(items);
  if (changed) set(next);
}
