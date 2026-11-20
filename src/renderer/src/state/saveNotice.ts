// "Saved", briefly, after Ctrl+S (Ironleaf Calm, 20 Oct 2026): the status line that always said it is off by default
// now, and notes save themselves as you type, so the word comes only when asked for (and "Not saved" whenever a save
// fails: App's SaveCorner reads the save state itself). Shown in the corner a moment, then gone.

import { useSyncExternalStore } from 'react';

let shownAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((fn) => fn());

/** Says "Saved" in the corner for a moment. */
export function flashSaved(): void {
  shownAt = Date.now();
  clearTimeout(timer);
  timer = setTimeout(() => {
    shownAt = 0;
    tell();
  }, 1600);
  tell();
}

/** Whether "Saved" is showing now. */
export function useSavedFlash(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => shownAt > 0,
  );
}
