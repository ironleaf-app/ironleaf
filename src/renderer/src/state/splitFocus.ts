// The split focus the former host app's window told the view (one product step 5 part 3): whether the main
// area is split and which side has focus. The chat panel re-scopes from it at once. The window never hears
// it, so it keeps the default there and everything reads as today.
import { useSyncExternalStore } from 'react';
import { coerceSplitFocus, sameSplitFocus, type SplitFocus } from '../../../shared/split-focus';

let told: SplitFocus = { split: false, focus: 'note' };
const listeners = new Set<() => void>();

/** The told focus, kept coerced: split or not, chat or note, and the chat side whole. */
export function setSplitFocus(input: unknown): void {
  const next = coerceSplitFocus(input);
  if (sameSplitFocus(next, told)) return;
  told = next;
  for (const fn of listeners) fn();
}

/** The told focus outside a component (the chat state reads the told chat when it asks). */
export function splitFocusNow(): SplitFocus {
  return told;
}

export function useSplitFocus(): SplitFocus {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => told,
  );
}
