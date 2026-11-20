// What a person's page remembers, per person, in this library's own state (t255, 13 Nov 2026: the
// person's long page became tabs under the shared bar, like the project's): the last tab opened.
// Kept like the project's memory, in Ironleaf's data folder, never among the notes.

import { useEffect, useState } from 'react';

/** One of the person page's own tabs (Overview first, then its sections in the page's own order). */
export const PERSON_TABS: { id: string; title: string }[] = [
  { id: 'overview', title: 'Overview' },
  { id: 'promises', title: 'Promises' },
  { id: 'projects', title: 'Projects' },
  { id: 'timeline', title: 'Timeline' },
];

export interface PersonMemory {
  /** The last tab opened. */
  section?: string;
}

let all: Record<string, PersonMemory> | null = null;
let loading: Promise<void> | null = null;
let timer = 0;
const listeners = new Set<() => void>();

function load(): Promise<void> {
  loading ??= window.nv.state
    .load<Record<string, PersonMemory>>('people')
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
    const entries = Object.entries(all).slice(-200);
    void window.nv.state.save('people', Object.fromEntries(entries)).catch(() => undefined);
  }, 400);
}

/** The page's memory for one person, and a way to change it. */
export function usePersonMemory(id: string): [PersonMemory, (change: (m: PersonMemory) => PersonMemory) => void] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    void load();
    return () => void listeners.delete(fn);
  }, []);
  const memory = all?.[id] ?? {};
  const change = (fn: (m: PersonMemory) => PersonMemory) => {
    all ??= {};
    const next = fn(all[id] ?? {});
    delete all[id];
    all[id] = next;
    listeners.forEach((l) => l());
    save();
  };
  return [memory, change];
}

/** True once the person's memory has loaded (the open tab settles only then). */
export function usePersonMemoryReady(): boolean {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    void load();
    return () => void listeners.delete(fn);
  }, []);
  return all !== null;
}
