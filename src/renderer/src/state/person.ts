// The person's own name, read once (10.0 Endless Tech, 2 Nov 2026, the chosen Direction B shell: the foot of the
// rail and every header show the person). The bar's own fetch feeds it (panels/Places.tsx reads today.data() already
// for its counts), so the foot and the headers add no IPC of their own. Null until that lands, or when the vault
// names no clear owner (shared/today.ts whoIsMe); callers show "You" then.
import { useSyncExternalStore } from 'react';

let person: string | null = null;
const listeners = new Set<() => void>();

/** The sidebar's reading, kept for the foot and the headers. */
export function setPerson(name: string | null): void {
  if (person === name) return;
  person = name;
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** The person's own name (null until the bar's fetch lands, or with no clear owner). */
export function usePerson(): string | null {
  return useSyncExternalStore(subscribe, () => person);
}

/** The person's own name outside React: the bar's last fetch (null until it lands). */
export function getPerson(): string | null {
  return person;
}
