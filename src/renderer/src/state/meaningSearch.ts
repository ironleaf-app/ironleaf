// Finding notes by what they mean, as the window uses it (src/main/meaning-build.ts): the quiet progress line
// while the embeddings build, and the one plain line when meaning search is off on this PC.
import { useSyncExternalStore } from 'react';
import type { MeaningStatus } from '../../../shared/meaning';

let status: MeaningStatus | null = null;
let asked = false;
const statusListeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;
const setStatus = (s: MeaningStatus) => {
  status = s;
  statusListeners.forEach((fn) => fn());
};

function watchStatus(fn: () => void): () => void {
  statusListeners.add(fn);
  if (!unsubscribe) unsubscribe = window.nv.on.meaningStatus(setStatus);
  if (!asked) {
    asked = true;
    void window.nv.meaning.status().then(setStatus, () => (asked = false));
  }
  return () => statusListeners.delete(fn);
}

/** Meaning search now: building, ready, or off (with the plain words when off). */
export function useMeaningStatus(): MeaningStatus | null {
  return useSyncExternalStore(watchStatus, () => status);
}

/** The quiet line ('Getting meaning search ready… 3 of 20', or the off words); '' when there is nothing to say. */
export function meaningProgressWords(s: MeaningStatus | null): string {
  return s?.words ?? '';
}
