// One read of a note's links: the backlinks, the unlinked mentions and the related notes arrive together and both
// readers (the foot's Linked list, the context rail's people and meetings) share the one answer (5 Nov 2026, the
// audit: a note's links lived in three places, each fetching on its own; t27-unused-panels: the side panels are gone).
import { useEffect, useState } from 'react';
import type { RelatedItem } from '../../../shared/related';
import type { LineContext } from '../../../shared/types';

export interface NoteLinks {
  backlinks: LineContext[];
  unlinked: LineContext[];
  related: RelatedItem[];
}

// Each open note and revision reads once: concurrent mounts share the in-flight promise, later mounts the answer.
// Thirty entries cover a working set; older revisions fall away as notes change.
const cache = new Map<string, Promise<NoteLinks>>();

export function fetchNoteLinks(path: string, revision: number): Promise<NoteLinks> {
  const key = `${revision} ${path}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w = window.nv;
  const promise = (async (): Promise<NoteLinks> => {
    // Each read settles on its own: one engine down never blanks the others (the rail's links still show when
    // related fails). Only nothing-at-all fails, so a surface keeps its last list and offers its retry.
    const [b, u, r] = await Promise.allSettled([w.index.backlinks(path), w.index.unlinked(path), w.index.relatedNotes(path)]);
    if (b.status === 'rejected' && u.status === 'rejected' && r.status === 'rejected') throw b.reason;
    return {
      backlinks: b.status === 'fulfilled' ? b.value : [],
      unlinked: u.status === 'fulfilled' ? u.value : [],
      related: r.status === 'fulfilled' ? r.value : [],
    };
  })();
  // A failed read evicts itself, so the next surface retries rather than sharing the failure.
  promise.catch(() => { if (cache.get(key) === promise) cache.delete(key); });
  cache.set(key, promise);
  if (cache.size > 30) cache.delete(cache.keys().next().value as string);
  return promise;
}

/** After the paint, bounded (t146): the links read on every note open, and their commit landed inside the
 *  switch's own frames; a breath later they are their own task, as their pop-in always was. */
function afterPaint(fn: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn(), { timeout: 100 });
  else setTimeout(fn, 0);
}

export function useNoteLinks(path: string, revision: number): { links: NoteLinks | null; failed: boolean; retry: () => void; refresh: () => void } {
  const [tick, setTick] = useState(0);
  // The last good list stays up while the next reads (as the foot and panels always did), never a blank.
  const [state, setState] = useState<{ links: NoteLinks | null; failed: boolean }>({ links: null, failed: false });
  useEffect(() => {
    let live = true;
    setState((s) => ({ links: s.links, failed: false }));
    fetchNoteLinks(path, revision).then(
      (links) => { if (live) afterPaint(() => { if (live) setState({ links, failed: false }); }); },
      () => { if (live) setState((s) => ({ links: s.links, failed: true })); },
    );
    return () => { live = false; };
  }, [path, revision, tick]);
  return {
    links: state.links,
    failed: state.failed,
    retry: () => setTick((t) => t + 1),
    // A fresh read under the same revision (after linking a mention): shared like any other read.
    refresh: () => { cache.delete(`${revision} ${path}`); setTick((t) => t + 1); },
  };
}
