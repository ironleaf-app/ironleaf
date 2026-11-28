// Life modules in the window (Wave 5, 24 Oct 2026; src/shared/life-modules.ts): which are on, their pages' openers, and
// the switches. A module's page is one tab, "module:<id>#<part>"; switched off, its tabs close (it adds no screens while
// off) and everything it holds stays where it is.

import { useSyncExternalStore } from 'react';
import { moduleInfo, moduleOn, partOn, withSwitch, type ModuleSwitches } from '../../../shared/life-modules';
import { getWorkspace, setWorkspace } from './layout';
import { getState, savePrefs, showError, toast, usePrefs } from './store';
import * as W from './workspace';
import { moduleOfTab, withModuleOpen } from './module-tabs';
export { moduleOfTab, moduleTabPath, partOfTab } from './module-tabs';

export function useModules(): ModuleSwitches {
  return usePrefs().modules;
}
export const useModuleOn = (id: string) => moduleOn(useModules(), id);
export const usePartOn = (id: string, part: string) => partOn(useModules(), id, part);
export const modulesNow = (): ModuleSwitches => getState().settings?.prefs.modules ?? {};

/** A pack asked for while switched off (5 Nov 2026, h3 dead buttons: openModule and the Meetings opener said nothing —
 *  Project Money's "Open Finance" and the palette's "Open Meetings" did nothing with the pack off): said plainly, with
 *  the one step. Switching it on opens where asked; nothing is moved or made. Every opener to an off pack comes through
 *  here, so the words stay the same. */
export function offerPack(id: string, open: () => void): void {
  const info = moduleInfo(id);
  if (!info) return toast('That pack is switched off.');
  toast(`${info.name} is switched off.`, { label: `Switch on ${info.name}`, run: () => void setModule(id, true).then(open, showError) });
}

/** A module's page: brought forward when open (at the part asked for), else opened where asked.
 *  Off means fully gone (3 Nov 2026, audit f F2): Meetings opens on the nav's Meetings page, but only
 *  while its pack is on; switched off, it offers to switch on instead of opening nothing, like every other pack. */
export function openModule(id: string, part?: string, where: W.Where = 'current'): void {
  if (!moduleOn(modulesNow(), id)) return offerPack(id, () => openModule(id, part, where));
  if (id === 'meetings') {
    const path = part ? `meetings:#${part}` : 'meetings:';
    const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'meetings');
    if (existing && where === 'current') {
      if (existing.t.path === path) return setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id));
      if (existing.t.pinned) return setWorkspace((ws) => W.activate(W.updateTab(ws, existing.t.id, { path }), existing.g.id, existing.t.id));
      return setWorkspace((ws) => W.open(W.activate(ws, existing.g.id, existing.t.id), { type: 'meetings', path }, 'current'));
    }
    return setWorkspace((ws) => W.open(ws, { type: 'meetings', path }, where));
  }
  // Asked for the module itself: its first part, in the tab already open on another page (state/module-tabs.ts).
  setWorkspace((ws) => withModuleOpen(ws, id, part, where));
}

let switchSave = Promise.resolve();

/** Apply each switch to the latest settings, including when two are clicked before the first save returns. */
export function setModule(id: string, on: boolean, part?: string): Promise<void> {
  if (!moduleInfo(id)) return Promise.resolve();
  const next = switchSave.then(async () => {
    await savePrefs({ modules: withSwitch(modulesNow(), id, on, part) });
    if (!on && !part) {
      const tabs = W.groups(getWorkspace().root).flatMap((g) => g.tabs).filter((t) => moduleOfTab(t) === id);
      for (const t of tabs) setWorkspace((ws) => W.closeTab(ws, t.id));
    }
    moduleChanged();
  });
  switchSave = next.catch(() => {});
  return next;
}

/** Something a module holds changed (an entry logged, an event added): its parts read again. */
let tick = 0;
const listeners = new Set<() => void>();
export function moduleChanged(): void {
  tick++;
  listeners.forEach((fn) => fn());
}
export function useModuleTick(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => tick,
  );
}

// What a module holds changed on the main side (an assistant's or agent's call, a reminder said), or a Windows notice
// asked for a module's page: the window follows.
if (typeof window !== 'undefined' && window.nv?.modules) {
  window.nv.modules.onChanged(() => moduleChanged());
  window.nv.modules.onOpen((id) => openModule(id));
}
