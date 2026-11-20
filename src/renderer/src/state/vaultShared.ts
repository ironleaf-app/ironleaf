// What the window remembers that belongs to the vault, kept in the vault so every PC shows the same (24 Oct 2026, WS1 step
// 0; src/shared/vault-settings.ts STATE_PLAN): suggestions put away, and bookmarks and the graph's settings read again when
// another PC's change to them arrives (the main side looks every 20 seconds and says which changed).

import { useEffect, useState } from 'react';
import { loadBookmarks } from './bookmarks';
import { loadGraphSettings } from './graph';
import { useApp } from './store';

interface Dismissed {
  /** Projects whose layout suggestion was put away ("Not for this project"), by their path. */
  layouts?: string[];
}

/** Before 24 Oct 2026 put-away suggestions were kept in this window only: brought into the vault the first time. */
const OLD_LAYOUTS = 'nv.layoutSuggest.dismissed';

let memory: Dismissed | null = null;
let loadedFor = '';
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((fn) => fn());

function readOld(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(OLD_LAYOUTS) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function load(): Promise<void> {
  loading ??= window.nv.state
    .load<Dismissed>('dismissed')
    .catch(() => null)
    .then((saved) => {
      const was = saved && typeof saved === 'object' && Array.isArray(saved.layouts) ? saved.layouts.filter((x) => typeof x === 'string') : [];
      const old = readOld().filter((p) => !was.includes(p));
      memory = { layouts: [...was, ...old].slice(-500) };
      if (old.length) void window.nv.state.save('dismissed', memory).catch(() => undefined);
      tell();
    });
  return loading;
}

/** Whether a project's layout suggestion was put away (on any PC), and a way to put it away. */
export function useLayoutDismissed(path: string): [boolean, () => void] {
  const library = useApp((s) => s.vault?.path ?? '');
  const [, setTick] = useState(0);
  if (library !== loadedFor) {
    loadedFor = library;
    memory = null;
    loading = null;
  }
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    void load();
    return () => void listeners.delete(fn);
  }, [library]);
  const dismissed = !!memory?.layouts?.includes(path);
  const dismiss = () => {
    memory = { ...(memory ?? {}), layouts: [...(memory?.layouts ?? []).filter((p) => p !== path), path].slice(-500) };
    tell();
    void window.nv.state.save('dismissed', memory).catch(() => undefined);
  };
  return [dismissed, dismiss];
}

// Another PC's change arrived in the vault: what this window holds of it read again.
try {
  window.nv.on.stateChanged((names) => {
    if (names.includes('bookmarks')) void loadBookmarks();
    if (names.includes('graph')) void loadGraphSettings();
    if (names.includes('dismissed')) {
      loading = null;
      void load();
    }
  });
} catch {
  // A window without Ironleaf's bridge (a test page): nothing to hear.
}
