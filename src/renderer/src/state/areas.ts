// Areas of life in the window (Wave 4, 24 Oct 2026; src/shared/areas.ts). The vault's areas (its .neuralvault/areas.json,
// so every PC shows the same), read when a vault opens (components/LifeHost.tsx) and changed here: renamed, added, put in
// order, kept quiet or hidden. Everything else asks this file which area a note or file is in, how many of each kind an
// area holds, and which areas Today and search are showing.
//
//   useAreas()            the areas (null: the vault isn't organised by area yet)
//   useAreaItems()        every note and file with its area and kind, a project's own things marked
//   areaOfPath(path)      the area a path is in (its `area:`, its folder, the Library's templates and assets)
//   openArea(id, kind?)   an area's page, at one of its five kinds
//   changeAreas(fn)       a change written to the vault (shown at once; put back if it can't be written)

import { useMemo, useSyncExternalStore } from 'react';
import { addArea, areaOf, AREA_KINDS, changeArea, countAreas, defaultConfig, homeArea, isQuiet, kindOf, projectFolderOf, projectFolders, readAreas, writeAreas, type Area, type AreaCounts, type AreaItem, type AreaKind, type AreasConfig } from '../../../shared/areas';
import { isPrivatePath } from '../../../shared/private';
import { isProjectProps } from '../../../shared/project-file';
import * as A from './actions';
import { getWorkspace, setWorkspace } from './layout';
import { getState, prefs, showError, useApp, usePrefs } from './store';
import * as W from './workspace';

let config: AreasConfig | null = null;
let problem: string | null = null;
/** The areas file could not be read at all (W5-3): writes stay blocked until a clean read. */
let unreadable = false;
let loadedFor: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The vault's areas read (when a vault opens, and when the window comes back: another PC may have changed them). */
export async function loadAreas(force = false): Promise<void> {
  const vault = getState().vault?.path ?? null;
  if (!vault) {
    config = null;
    loadedFor = null;
    emit();
    return;
  }
  if (!force && loadedFor === vault) return;
  try {
    const read = readAreas(await window.nv.life.areas.load());
    config = read.config;
    problem = read.problem;
    unreadable = false;
  } catch {
    config = null;
    problem = 'Your areas could not be read just now, so changes to them are paused until they can be.';
    unreadable = true;
  }
  loadedFor = vault;
  emit();
}

export const getAreas = (): AreasConfig | null => config;
export const areasProblem = () => problem;
export function useAreas(): AreasConfig | null {
  return useSyncExternalStore(subscribe, () => config);
}

/** The areas changed: shown at once and written to the vault; a write that fails puts the old ones back. */
export async function changeAreas(change: (c: AreasConfig) => AreasConfig): Promise<void> {
  if (unreadable) throw new Error(problem ?? 'Your areas could not be read, so they were left as they are.');
  const before = config;
  const next = change(config ?? defaultConfig());
  if (next === before) return;
  config = next;
  emit();
  if (!getState().canEdit) return;
  try {
    await window.nv.life.areas.save(writeAreas(next));
  } catch (err) {
    config = before;
    emit();
    throw err;
  }
}

/** An area renamed, its folder with it (everything inside keeps its links). */
export async function renameArea(id: string, name: string): Promise<void> {
  const area = config?.areas.find((a) => a.id === id);
  if (!area) return;
  const trimmed = name.trim();
  if (!trimmed || trimmed === area.name) return;
  const probe = changeArea(config!, id, { name: trimmed, folder: trimmed });
  const folder = probe.areas.find((a) => a.id === id)!.folder;
  if (folder.toLowerCase() !== area.folder.toLowerCase() && getState().folders.some((f) => f.toLowerCase() === area.folder.toLowerCase())) {
    await window.nv.life.areas.renameFolder(area.folder, folder);
  }
  await changeAreas((c) => changeArea(c, id, { name: trimmed, folder }));
}

/** A new area; its id. */
export async function newArea(name: string): Promise<string | null> {
  try {
    let id = '';
    await changeAreas((c) => {
      const r = addArea(c, { name });
      id = r.id;
      return r.config;
    });
    return id;
  } catch (err) {
    showError(err);
    return null;
  }
}

const placesOf = (p: ReturnType<typeof prefs>) => ({ templatesFolder: p.templatesFolder, assetsFolder: p.assetsFolder });
export const areaPlaces = () => placesOf(prefs());

/** The area a path is in (with its properties from the index), or undefined. */
export function areaOfPath(path: string): Area | undefined {
  if (!config) return undefined;
  return areaOf({ path, props: getState().byPath.get(path)?.props }, config.areas, areaPlaces());
}

/** Whether a path is kept out of Today and search unless asked for (a template, the quiet area's). */
export function quietPath(path: string): boolean {
  return isQuiet({ path, props: getState().byPath.get(path)?.props }, config?.areas ?? [], areaPlaces());
}

export interface ItemRow extends AreaItem {
  kind: AreaKind;
  area?: string;
  title: string;
  mtime: number;
  size?: number;
}

/** Every note and file, with its area and kind, a project's own things marked (they count with their project). */
export function useAreaItems(): ItemRow[] {
  const areas = useAreas();
  const notes = useApp((s) => s.notes);
  const files = useApp((s) => s.files);
  const p = usePrefs();
  return useMemo(() => {
    const dirs = projectFolders(notes);
    const pl = placesOf(p);
    const out: ItemRow[] = [];
    for (const n of notes) {
      // Private notes stay out by the privacy mechanism (9.2 uplift F146), never a name regex that a rename breaks.
      if (isPrivatePath(n.path)) continue;
      const it = { path: n.path, props: n.props, project: projectFolderOf(n.path, dirs, isProjectProps(n.props)) };
      out.push({ ...it, kind: kindOf(it), area: areas ? areaOf(it, areas.areas, pl)?.id : undefined, title: n.label || n.title, mtime: n.mtime, size: n.size });
    }
    for (const f of files) {
      if (f.kind === 'note' || isPrivatePath(f.rel) || /(^|\/)assets\.json$/i.test(f.rel)) continue;
      const it = { path: f.rel, project: projectFolderOf(f.rel, dirs) };
      out.push({ ...it, kind: kindOf(it), area: areas ? areaOf(it, areas.areas, pl)?.id : undefined, title: f.rel.split('/').pop() ?? f.rel, mtime: f.mtime, size: f.size });
    }
    return out;
  }, [areas, notes, files, p.templatesFolder, p.assetsFolder]);
}

/** How many of each kind every area holds ('' for none yet). */
export function useAreaCounts(): Map<string, AreaCounts> {
  const areas = useAreas();
  const items = useAreaItems();
  const p = usePrefs();
  return useMemo(() => countAreas(items, areas?.areas ?? [], placesOf(p)), [items, areas, p.templatesFolder, p.assetsFolder]);
}

// ── An area's page ─────────────────────────────────────────────────────────────────────────────────────────────────

export const AREA_TAB_PREFIX = 'area:';
/** An area's page's path: "area:<id>#<kind>". */
export const areaTabPath = (id: string, kind: AreaKind = 'projects') => `${AREA_TAB_PREFIX}${id}#${kind}`;
export const areaOfTab = (tab: W.TabState): string | undefined => (tab.type === 'area' && tab.path?.startsWith(AREA_TAB_PREFIX) ? tab.path.slice(AREA_TAB_PREFIX.length).split('#')[0] : undefined);
export const kindOfTab = (tab: W.TabState): AreaKind => {
  const k = tab.path?.split('#')[1] ?? '';
  return (AREA_KINDS as readonly string[]).includes(k) ? (k as AreaKind) : 'projects';
};

/** An area's page at one of its kinds: the tab already showing the area moves to that kind (Back goes to the last). */
export function openArea(id: string, kind: AreaKind = 'projects', where: W.Where = 'current'): void {
  const path = areaTabPath(id, kind);
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'area' && areaOfTab(t) === id);
  if (existing && where === 'current') {
    if (existing.t.path === path) return setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id));
    setWorkspace((ws) => W.open(W.activate(ws, existing.g.id, existing.t.id), { type: 'area', path }, 'current'));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type: 'area', path }, where));
}

/** The area the person is in now: an area's page, else the area of the note open, else none. */
export function currentArea(): Area | undefined {
  if (!config) return undefined;
  const tab = W.activeTab(getWorkspace());
  const id = areaOfTab(tab);
  if (id) return config.areas.find((a) => a.id === id);
  return tab.path ? areaOfPath(tab.path) : undefined;
}

/** Where a new thing of a type goes when the person didn't say: inside the area they are in (else the home area), in
 *  the type's own folder there ("Work/People"). Undefined without areas. */
export function areaFolderFor(typeFolder: string): string | undefined {
  if (!config) return undefined;
  const area = currentArea() ?? homeArea(config);
  if (!area || area.quiet) return undefined;
  return `${area.folder}/${typeFolder || 'Notes'}`;
}

// ── Which areas Today and search show (this PC's choice) ─────────────────────────────────────────────────────────────

const PICK_KEY = 'nv.areas.pick';
let picks: Record<string, string[] | 'all'> = (() => {
  try {
    return JSON.parse(localStorage.getItem(PICK_KEY) ?? '{}') as Record<string, string[] | 'all'>;
  } catch {
    return {};
  }
})();
const pickListeners = new Set<() => void>();
/** The areas chosen on a page ('today', 'search'): 'all' (every area but the quiet ones), or some areas' ids. */
export function usePick(page: 'today' | 'search'): string[] | 'all' {
  return useSyncExternalStore(
    (fn) => {
      pickListeners.add(fn);
      return () => pickListeners.delete(fn);
    },
    () => picks[page] ?? 'all',
  );
}
export function setPick(page: 'today' | 'search', value: string[] | 'all'): void {
  picks = { ...picks, [page]: value };
  try {
    localStorage.setItem(PICK_KEY, JSON.stringify(picks));
  } catch {
    // Kept while the window is open.
  }
  pickListeners.forEach((fn) => fn());
}

/** Opens the place a row of an area's page names: a note or file. */
export function openItem(path: string, e?: { ctrlKey?: boolean; metaKey?: boolean }): void {
  A.openPath(path, { where: e && (e.ctrlKey || e.metaKey) ? 'tab' : 'current' });
}
