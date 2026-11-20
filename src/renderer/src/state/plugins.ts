// Plugins in the window (src/main/plugins.ts): Settings › Plugins lists them, the palette runs their commands, Home
// draws their cards, and their toasts (a write's with Undo) show in the corner. Read from the main side and read again
// whenever it says something changed.

import { useSyncExternalStore } from 'react';
import type { PluginCardView, PluginCommandView, PluginView } from '../../../shared/plugins';
import { showError, toast } from './store';

let plugins: PluginView[] | null = null;
let cards: PluginCardView[] | null = null;
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export async function refreshPlugins(): Promise<void> {
  try {
    plugins = await window.nv.plugins.list();
    emit();
  } catch {
    // The notes aren't open yet: read again on the next change.
  }
}

/** Settings › Plugins opened (8.9 round 3): the example present the first time in any vault. */
export async function ensurePlugins(): Promise<void> {
  try {
    plugins = await window.nv.plugins.ensure();
    emit();
  } catch {
    // The notes aren't open yet: read again on the next change.
  }
}

export async function refreshPluginCards(): Promise<void> {
  try {
    cards = await window.nv.plugins.cards();
    emit();
  } catch {
    // Home stays without them until the next change.
  }
}

function start(): void {
  if (started) return;
  started = true;
  window.nv.on.pluginsChanged(() => {
    cards = null;
    void refreshPlugins();
    void refreshPluginCards();
  });
  window.nv.on.pluginsToast((t) => {
    if (t.undo) toast(t.words, { label: 'Undo', run: () => void window.nv.plugins.undo(t.undo!).then((said) => toast(said)).catch(showError) });
    else toast(t.words);
  });
  void refreshPlugins();
  void refreshPluginCards();
}

/** The plugins as last read (Settings › Plugins). */
export function usePlugins(): PluginView[] | null {
  start();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => plugins,
  );
}

/** The switched-on plugins' Home cards as last drawn. */
export function usePluginCards(): PluginCardView[] | null {
  start();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => cards,
  );
}

/** The switched-on plugins' palette commands, read fresh (the palette opens rarely enough to ask each time). */
export function pluginCommands(): Promise<PluginCommandView[]> {
  start();
  return window.nv.plugins.commands().catch(() => []);
}
