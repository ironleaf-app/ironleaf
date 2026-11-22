// The workspace: tabs in groups, groups side by side or one above another (splits), and the two sidebars. Every change
// is a pure function from one layout to the next, so the layout can be saved per folder of notes and restored as it was.
// (The pageScroll arm/disarm calls are the one exception: a transient hint for this session only, never saved.)

import type { ViewMode } from '../../../shared/prefs';
import { isPrivatePath } from '../../../shared/private';
import { armRestore, disarmRestore } from './pageScroll';
import { tabTarget, tabTargetEqual } from './tabSync';

// 'type': a note type's page (state/noteTypes.ts), its path "type:<id>" (never a file).
// 'notebook': a folder as a notebook (views/NotebookView.tsx; 21 Oct 2026), its path "notebook:<folder>".
export type ViewType = 'note' | 'canvas' | 'view' | 'media' | 'graph' | 'today' | 'home' | 'projects' | 'templates' | 'bin' | 'private' | 'assets' | 'review' | 'timeline' | 'tasks' | 'type' | 'notebook' | 'records' | 'drawing' | 'loose' | 'area' | 'inbox' | 'people' | 'secrets' | 'locked' | 'module' | 'meetings' | 'bookmarks' | 'import' | 'settings' | 'versions' | 'abilities' | 'changes' | 'tidy' | 'shared-spaces' | 'shared-space' | 'project-file' | 'empty';
// 'area': an area of life's page (views/AreaPage.tsx; Wave 4), its path "area:<id>#<kind>"; 'inbox': the Inbox
// (views/InboxPage.tsx); 'people': People and Organisations (views/PeoplePage.tsx); 'module': a life module's page
// (Wave 5; views/modules/registry.ts), its path "module:<id>#<part>".
// 'records': a view over the whole vault's records (views/RecordsView.tsx; 24 Oct 2026), its path "records:<view file>".
// 'drawing': a .nvdraw file (src/shared/drawing.ts); 'loose': a Markdown file from outside the vault, its path the whole
// path on this PC (src/main/loose-files.ts). Both 21 Oct 2026 (gaps G23, G26).
// 'project-file': a file in a project's folder on this PC or a remote computer (views/FolderFileView.tsx; t239, 12 Nov
// 2026), its path "<project>\n<rel>" (a file name never holds a newline, as fileHitsSection's keys already rely on).
/** home: the calm left side (Today, Search, your notes by kind, More); files: the folder tree and the sections, as the
 *  Files panel; search as before. Bookmarks are a page (9.2 uplift F105), never a panel. */
export type LeftPanel = 'home' | 'files' | 'search';
export type RightPanel = 'backlinks' | 'outgoing' | 'outline' | 'tags' | 'local-graph' | 'related' | 'chat' | 'autolink';

export interface TabState {
  id: string;
  type: ViewType;
  path?: string;
  mode?: ViewMode;
  pinned?: boolean;
  /** The page's own tab (a project's Overview, Key dates…): in history, so Back returns to the tab it was on. */
  section?: string;
  /** Earlier and later places in this tab (for Back and Forward). */
  back: Place[];
  forward: Place[];
}

export interface Place {
  type: ViewType;
  path?: string;
  /** How it showed (a project's page, a note's Reading): Back returns to the same view, never its default. */
  mode?: ViewMode;
  /** The page's own tab showing then (t255, 13 Nov 2026: the tab is in the page's history). */
  section?: string;
}

export interface Group {
  kind: 'group';
  id: string;
  tabs: TabState[];
  active: string;
}

export interface Split {
  kind: 'split';
  id: string;
  /** row: side by side; column: one above another. */
  dir: 'row' | 'column';
  children: PaneNode[];
  /** Each child's share of the space (they add up to 1). */
  sizes: number[];
}

export type PaneNode = Group | Split;

export interface Workspace {
  root: PaneNode;
  activeGroup: string;
  /** rail: the left side is folded to its icon rail (8.7 wave 1); width is kept for unfolding. */
  left: { open: boolean; width: number; panel: LeftPanel; rail?: boolean };
  right: { open: boolean; width: number; panel: RightPanel };
  /** Tabs closed lately, newest first (Reopen closed tab). */
  closed: TabState[];
  /** Files opened lately, newest first (the quick switcher lists them first). */
  recent: string[];
  /** The calm shell's one-time change has been made to this layout (see CALM and restore). */
  calm?: number;
}

/**
 * Ironleaf Calm (20 Oct 2026): the first time this version opens a saved layout, the assistant's side starts closed and
 * the left side shows the calm list instead of the whole file tree. Stamped on the layout, so the person's own choices
 * after that (opening the chat, the Files panel) are kept from then on.
 */
export const CALM = 1;

export type Where = 'current' | 'tab' | 'right' | 'down';

let counter = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function emptyTab(): TabState {
  return { id: newId('t'), type: 'empty', back: [], forward: [] };
}

export function newGroup(tab: TabState = emptyTab()): Group {
  return { kind: 'group', id: newId('g'), tabs: [tab], active: tab.id };
}

export function defaultWorkspace(): Workspace {
  const group = newGroup();
  return {
    root: group,
    activeGroup: group.id,
    left: { open: true, width: 292, panel: 'home' },
    // The assistant's side starts closed (Ironleaf Calm): Ask on a page's header, or Ctrl+J, opens it.
    right: { open: false, width: 380, panel: 'chat' },
    closed: [],
    recent: [],
    calm: CALM,
  };
}

/**
 * Tabs shown or not (Settings › Appearance › Interface › Show tabs). Kept here rather than passed to every open() (a
 * dozen places open pages) because it changes how opening works, not what a layout is; App sets it from the setting.
 */
let tabsShown = true;
export function showTabs(on: boolean): void {
  tabsShown = on;
}
export function tabsAreShown(): boolean {
  return tabsShown;
}

export function typeOf(path: string): ViewType {
  if (/\.md$/i.test(path)) return 'note';
  if (/\.canvas$/i.test(path)) return 'canvas';
  if (/\.nvdraw$/i.test(path)) return 'drawing';
  if (/\.(?:view\.json|base)$/i.test(path)) return 'view';
  return 'media';
}

export function groups(node: PaneNode): Group[] {
  return node.kind === 'group' ? [node] : node.children.flatMap(groups);
}

export function findGroup(ws: Workspace, id: string): Group | undefined {
  return groups(ws.root).find((g) => g.id === id);
}

export function activeGroup(ws: Workspace): Group {
  return findGroup(ws, ws.activeGroup) ?? groups(ws.root)[0];
}

export function activeTab(ws: Workspace): TabState {
  const g = activeGroup(ws);
  return g.tabs.find((t) => t.id === g.active) ?? g.tabs[0];
}

export function findTab(ws: Workspace, tabId: string): { group: Group; tab: TabState } | undefined {
  for (const group of groups(ws.root)) {
    const tab = group.tabs.find((t) => t.id === tabId);
    if (tab) return { group, tab };
  }
  return undefined;
}

/** A copy of the tree with one group replaced (or removed, when `next` is null), splits tidied after. */
function replaceGroup(node: PaneNode, id: string, next: PaneNode | null): PaneNode | null {
  if (node.kind === 'group') return node.id === id ? next : node;
  const children: PaneNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const replaced = replaceGroup(child, id, next);
    if (replaced) {
      children.push(replaced);
      sizes.push(node.sizes[i] ?? 1 / node.children.length);
    }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return { ...node, children, sizes: sizes.map((s) => s / total) };
}

function setGroup(ws: Workspace, group: Group): Workspace {
  return { ...ws, root: replaceGroup(ws.root, group.id, group) ?? group };
}

function placeOf(tab: TabState): Place {
  return { type: tab.type, path: tab.path, ...(tab.mode ? { mode: tab.mode } : {}), ...(tab.section ? { section: tab.section } : {}) };
}

/** Shows a file (or the graph, or nothing) in a tab, keeping where it was for Back. */
function showIn(tab: TabState, place: Place, mode?: ViewMode): TabState {
  // The same page asked at another of its own tabs (a link naming a tab): that tab, kept for Back.
  if (tab.type === place.type && tab.path === place.path) {
    if (place.section !== undefined && place.section !== tab.section) return { ...tab, section: place.section, back: [...tab.back, placeOf(tab)].slice(-50), forward: [] };
    return mode ? { ...tab, mode } : tab;
  }
  const back = tab.type === 'empty' ? tab.back : [...tab.back, placeOf(tab)].slice(-50);
  return { ...tab, type: place.type, path: place.path, mode: mode ?? (place.type === tab.type ? tab.mode : undefined), section: place.section, back, forward: [] };
}

/** One of the page's own tabs opened (t255, 13 Nov 2026): in history when the person chose it, so Back
 *  returns to the tab they were on; a reveal landing with its open pushes nothing, so Back returns past it. */
export function setTabSection(ws: Workspace, tabId: string, section: string | undefined, push = true): Workspace {
  const found = findTab(ws, tabId);
  if (!found || found.tab.section === section) return ws;
  if (!push) return updateTab(ws, tabId, { section });
  return updateTab(ws, tabId, { section, back: [...found.tab.back, placeOf(found.tab)].slice(-50), forward: [] });
}

/**
 * Opens a file (or the graph) in the workspace: in the current tab (a pinned tab opens a new one), in a new tab, or in a
 * new group to the right or below.
 */
/** One pane (Polish round 2, 29 Oct 2026, ITEMS 2): every group merged into the active one, its page kept in
 *  front and the other panes' tabs kept behind it, so nothing that was open is lost. */
export function onePane(ws: Workspace): Workspace {
  const all = groups(ws.root);
  if (all.length <= 1) return ws;
  const kept = all.find((g) => g.id === ws.activeGroup) ?? all[0];
  const root: PaneNode = { ...kept, tabs: [...kept.tabs, ...all.filter((g) => g.id !== kept.id).flatMap((g) => g.tabs)] };
  return { ...ws, root, activeGroup: kept.id };
}

export function open(ws: Workspace, place: Place, where: Where = 'current', mode?: ViewMode): Workspace {
  // One page at a time (tabs off; Polish round 2, ITEMS 2): opening a note, a meeting or a project from a page
  // replaces the page on show in the one pane. An old split is closed first, and no opening here (current, a new
  // tab, or beside) makes a new split by itself: a split is only ever the person's own Split command.
  if (!tabsShown) {
    ws = onePane(ws);
    where = 'current';
  }
  const group = activeGroup(ws);
  const current = group.tabs.find((t) => t.id === group.active) ?? group.tabs[0];
  if (where === 'right' || where === 'down') {
    const tab: TabState = { ...emptyTab(), type: place.type, path: place.path, mode, ...(place.section ? { section: place.section } : {}) };
    return splitWith(ws, group.id, where === 'right' ? 'row' : 'column', tab);
  }
  // One tab per target (t73, 9 Nov 2026, the strip on the vault: three Tasks tabs, two Projects -
  // older sessions opened a place beside its own tab): opening a place, a folder or a note that already has
  // a tab selects that tab instead of opening another. The tab on show is replaced as before (a meeting part
  // moving within its tab); an explicit new tab or split still opens as asked. With tabs off only what is on
  // screen is brought forward, so the person is never taken away with no Back to it.
  if (where === 'current') {
    const want = tabTarget(place);
    if (want) {
      for (const g of groups(ws.root)) {
        for (const t of g.tabs) {
          if ((current && t.id === current.id) || !tabTargetEqual(want, tabTarget(t))) continue;
          if (!tabsShown && g.active !== t.id) continue;
          const switched = mode !== undefined && t.mode !== mode ? updateTab(ws, t.id, { mode }) : ws;
          const sectored = place.section !== undefined && t.section !== place.section ? setTabSection(switched, t.id, place.section) : switched;
          return activate(sectored, g.id, t.id);
        }
      }
    }
  }
  if (where === 'current' && current && !current.pinned) {
    const next = showIn(current, place, mode);
    // A fresh place lands here (state/pageScroll.ts): the page opens at the top, never where something else was.
    if (next !== current) disarmRestore(current.id);
    return setGroup(ws, { ...group, tabs: group.tabs.map((t) => (t.id === current.id ? next : t)) });
  }
  // No piles of "New tab" (20 Oct 2026, Ironleaf Calm): an empty tab already in this group is used rather than a new
  // one beside it, whether a note is asked for in a new tab or another empty tab is.
  const spare = group.tabs.find((t) => t.type === 'empty' && !t.pinned);
  if (spare) {
    const next = place.type === 'empty' ? spare : showIn(spare, place, mode);
    if (next !== spare) disarmRestore(spare.id);
    return { ...setGroup(ws, { ...group, tabs: group.tabs.map((t) => (t.id === spare.id ? next : t)), active: spare.id }), activeGroup: group.id };
  }
  // A new tab, after the active one.
  const tab: TabState = { ...emptyTab(), type: place.type, path: place.path, mode, ...(place.section ? { section: place.section } : {}) };
  const at = group.tabs.findIndex((t) => t.id === group.active);
  const tabs = [...group.tabs];
  tabs.splice(at + 1, 0, tab);
  return { ...setGroup(ws, { ...group, tabs, active: tab.id }), activeGroup: group.id };
}

/** Focuses a tab that already shows this file, anywhere; false when none does. */
export function revealExisting(ws: Workspace, path: string, type: ViewType = typeOf(path)): Workspace | null {
  // Tabs off: the tab comes into the one pane, never into a narrow split left beside it (ITEMS 2).
  if (!tabsShown) ws = onePane(ws);
  for (const group of groups(ws.root)) {
    // Only a tab that shows that file itself (8.0.1, 29 Oct 2026): the Graph centred on a project carries the project's
    // path too, and Open came back to the Graph instead of opening the project.
    // A file from outside the vault is its own type (22 Nov 2026: a .md outside read as a note here, never matched its
    // loose tab, and every open of it made another tab).
    const tab = group.tabs.find((t) => t.path === path && t.type === type);
    if (tab) {
      // Back to an open tab (state/pageScroll.ts): it restores where the person was.
      armRestore(tab.id);
      return { ...setGroup(ws, { ...group, active: tab.id }), activeGroup: group.id };
    }
  }
  return null;
}

/** A file opened: first in the recent list. Only a real path is kept (t191: "Make the doc" in a window whose
 *  docs:create answered undefined opened a tab for it, and the undefined sat in the list until Today read
 *  `.includes` on it — the readers' input is guarded where it is made, as `restore` already does on load). */
export function noteOpened(ws: Workspace, path: string): Workspace {
  if (typeof path !== 'string' || !path) return ws;
  if (ws.recent[0] === path) return ws;
  return { ...ws, recent: [path, ...ws.recent.filter((p) => p !== path)].slice(0, 40) };
}

/** A new group beside (row) or below (column) a group, holding `tab` (before it: left or above). */
export function splitWith(ws: Workspace, groupId: string, dir: 'row' | 'column', tab: TabState, before = false): Workspace {
  const target = findGroup(ws, groupId);
  if (!target) return ws;
  const fresh = newGroup(tab);
  const insert = (node: PaneNode): PaneNode => {
    if (node.kind === 'group') {
      if (node.id !== groupId) return node;
      return { kind: 'split', id: newId('s'), dir, children: before ? [fresh, node] : [node, fresh], sizes: [0.5, 0.5] };
    }
    // Inside a split of the same direction, the new group sits next to its neighbour and shares its space.
    const index = node.children.findIndex((c) => c.kind === 'group' && c.id === groupId);
    if (index >= 0 && node.dir === dir) {
      const children = [...node.children];
      const sizes = [...node.sizes];
      const half = sizes[index] / 2;
      children.splice(before ? index : index + 1, 0, fresh);
      sizes.splice(index, 1, half, half);
      return { ...node, children, sizes };
    }
    return { ...node, children: node.children.map(insert) };
  };
  return { ...ws, root: insert(ws.root), activeGroup: fresh.id };
}

/** Splits a group, the new group showing the same thing as the active tab (or nothing). */
export function split(ws: Workspace, groupId: string, dir: 'row' | 'column'): Workspace {
  const group = findGroup(ws, groupId);
  const tab = group?.tabs.find((t) => t.id === group.active);
  const copy: TabState = tab && tab.type !== 'empty' ? { ...emptyTab(), type: tab.type, path: tab.path, mode: tab.mode } : emptyTab();
  return splitWith(ws, groupId, dir, copy);
}

export function activate(ws: Workspace, groupId: string, tabId?: string): Workspace {
  const group = findGroup(ws, groupId);
  if (!group) return ws;
  // One pane with tabs off (Polish round 3, 29 Oct 2026, ITEMS 4): a page brought forward from another pane
  // (every nav opener goes through here with its tab) closes the split first, its page kept in front and the
  // other panes' pages kept behind it. Bringing a whole pane forward (no tab named, a click in it) is left
  // alone, so a split the person made themselves still works while they use it.
  if (!tabsShown && tabId && groups(ws.root).length > 1) {
    ws = onePane(ws);
    const merged = activeGroup(ws);
    if (!merged.tabs.some((t) => t.id === tabId)) return ws;
    return { ...setGroup(ws, { ...merged, active: tabId }), activeGroup: merged.id };
  }
  if (!tabId || group.active === tabId) return ws.activeGroup === groupId ? ws : { ...ws, activeGroup: groupId };
  // Another tab brought forward (state/pageScroll.ts): it restores where the person was.
  armRestore(tabId);
  return { ...setGroup(ws, { ...group, active: tabId }), activeGroup: groupId };
}

export function updateTab(ws: Workspace, tabId: string, patch: Partial<TabState>): Workspace {
  const found = findTab(ws, tabId);
  if (!found) return ws;
  return setGroup(ws, { ...found.group, tabs: found.group.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)) });
}

export function closeTab(ws: Workspace, tabId: string): Workspace {
  const found = findTab(ws, tabId);
  if (!found) return ws;
  const { group, tab } = found;
  const closed = tab.type === 'empty' ? ws.closed : [tab, ...ws.closed.filter((t) => t.path !== tab.path)].slice(0, 20);
  const tabs = group.tabs.filter((t) => t.id !== tabId);
  if (!tabs.length) {
    const all = groups(ws.root);
    if (all.length === 1) {
      const fresh = emptyTab();
      return { ...setGroup(ws, { ...group, tabs: [fresh], active: fresh.id }), closed };
    }
    const root = replaceGroup(ws.root, group.id, null) ?? newGroup();
    const next = groups(root);
    return { ...ws, root, closed, activeGroup: ws.activeGroup === group.id ? next[0].id : ws.activeGroup };
  }
  let active = group.active;
  if (active === tabId) {
    const at = group.tabs.findIndex((t) => t.id === tabId);
    active = (tabs[at] ?? tabs[at - 1] ?? tabs[0]).id;
    // The tab left showing (state/pageScroll.ts) restores where the person was.
    armRestore(active);
  }
  return { ...setGroup(ws, { ...group, tabs, active }), closed };
}

/** Closes every other tab in the group (pinned tabs stay). */
export function closeOthers(ws: Workspace, tabId: string): Workspace {
  const found = findTab(ws, tabId);
  if (!found) return ws;
  const gone = found.group.tabs.filter((t) => t.id !== tabId && !t.pinned);
  const closed = [...gone.filter((t) => t.type !== 'empty'), ...ws.closed].slice(0, 20);
  return { ...setGroup(ws, { ...found.group, tabs: found.group.tabs.filter((t) => t.id === tabId || t.pinned), active: tabId }), closed };
}

export function reopenClosed(ws: Workspace): Workspace {
  const [tab, ...rest] = ws.closed;
  if (!tab) return ws;
  const group = activeGroup(ws);
  const reopened = { ...tab, id: newId('t') };
  return { ...setGroup(ws, { ...group, tabs: [...group.tabs, reopened], active: reopened.id }), closed: rest };
}

/** Back (-1) or Forward (+1) in a tab. */
export function navigate(ws: Workspace, tabId: string, delta: -1 | 1): Workspace {
  const found = findTab(ws, tabId);
  if (!found) return ws;
  const { tab } = found;
  if (delta < 0) {
    const place = tab.back[tab.back.length - 1];
    if (!place) return ws;
    // Back and Forward (state/pageScroll.ts) restore where the person was.
    armRestore(tabId);
    return updateTab(ws, tabId, { type: place.type, path: place.path, mode: place.mode, section: place.section, back: tab.back.slice(0, -1), forward: [placeOf(tab), ...tab.forward].slice(0, 50) });
  }
  const place = tab.forward[0];
  if (!place) return ws;
  armRestore(tabId);
  return updateTab(ws, tabId, { type: place.type, path: place.path, mode: place.mode, section: place.section, forward: tab.forward.slice(1), back: [...tab.back, placeOf(tab)].slice(-50) });
}

/** Moves a tab within its group or into another group, before `index` (the end when undefined). */
export function moveTab(ws: Workspace, tabId: string, toGroupId: string, index?: number): Workspace {
  const found = findTab(ws, tabId);
  const target = findGroup(ws, toGroupId);
  if (!found || !target) return ws;
  if (found.group.id === toGroupId) {
    const tabs = found.group.tabs.filter((t) => t.id !== tabId);
    const from = found.group.tabs.findIndex((t) => t.id === tabId);
    let at = index ?? tabs.length;
    if (index !== undefined && from < index) at -= 1;
    tabs.splice(Math.max(0, Math.min(at, tabs.length)), 0, found.tab);
    if (tabId !== found.group.active) armRestore(tabId);
    return { ...setGroup(ws, { ...found.group, tabs, active: tabId }), activeGroup: toGroupId };
  }
  let next = closeTabQuietly(ws, found.group.id, tabId);
  const dest = findGroup(next, toGroupId);
  if (!dest) return ws;
  const tabs = dest.tabs.filter((t) => t.type !== 'empty' || dest.tabs.length > 1);
  tabs.splice(Math.max(0, Math.min(index ?? tabs.length, tabs.length)), 0, found.tab);
  next = setGroup(next, { ...dest, tabs, active: tabId });
  armRestore(tabId);
  return { ...next, activeGroup: toGroupId };
}

/** Takes a tab out of a group without remembering it as closed (it is moving elsewhere). */
function closeTabQuietly(ws: Workspace, groupId: string, tabId: string): Workspace {
  const group = findGroup(ws, groupId);
  if (!group) return ws;
  const tabs = group.tabs.filter((t) => t.id !== tabId);
  if (!tabs.length && groups(ws.root).length > 1) {
    const root = replaceGroup(ws.root, groupId, null) ?? newGroup();
    return { ...ws, root, activeGroup: groups(root)[0].id };
  }
  const left = tabs.length ? tabs : [emptyTab()];
  const active = left.some((t) => t.id === group.active) ? group.active : left[0].id;
  if (active !== group.active) armRestore(active);
  return setGroup(ws, { ...group, tabs: left, active });
}

/** A tab dragged to an edge of a group: it moves out of its own group into a new one on that side. */
export function moveTabToSide(ws: Workspace, tabId: string, groupId: string, side: 'left' | 'right' | 'top' | 'bottom'): Workspace {
  const found = findTab(ws, tabId);
  if (!found || !findGroup(ws, groupId)) return ws;
  // A tab alone in its group dragged to that same group's edge: nothing to split.
  if (found.group.id === groupId && found.group.tabs.length === 1) return ws;
  const without = closeTabQuietly(ws, found.group.id, tabId);
  if (!findGroup(without, groupId)) return ws;
  return splitWith(without, groupId, side === 'left' || side === 'right' ? 'row' : 'column', found.tab, side === 'left' || side === 'top');
}

export function resize(ws: Workspace, splitId: string, sizes: number[]): Workspace {
  const walk = (node: PaneNode): PaneNode => {
    if (node.kind === 'group') return node;
    if (node.id === splitId) return { ...node, sizes };
    return { ...node, children: node.children.map(walk) };
  };
  return { ...ws, root: walk(ws.root) };
}

/** A file or folder moved or was renamed: tabs (and their history) follow it. */
export function renamed(ws: Workspace, from: string, to: string): Workspace {
  const moveFile = (p: string) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
  // A notebook follows its folder ("notebook:<folder>"); a project's file follows its project ("<project>\n<rel>").
  const move = (p?: string) => {
    if (p === undefined) return p;
    if (p.startsWith('notebook:')) return `notebook:${moveFile(p.slice(9))}`;
    const nl = p.indexOf('\n');
    if (nl >= 0) return `${moveFile(p.slice(0, nl))}${p.slice(nl)}`;
    return moveFile(p);
  };
  const fixPlace = (pl: Place): Place => ({ ...pl, path: move(pl.path) });
  const walk = (node: PaneNode): PaneNode =>
    node.kind === 'group'
      ? { ...node, tabs: node.tabs.map((t) => ({ ...t, path: move(t.path), back: t.back.map(fixPlace), forward: t.forward.map(fixPlace) })) }
      : { ...node, children: node.children.map(walk) };
  return { ...ws, root: walk(ws.root), closed: ws.closed.map((t) => ({ ...t, path: move(t.path) })), recent: ws.recent.map((p) => move(p) ?? p) };
}

/** Files that are gone: tabs showing them show nothing (their history keeps the rest). */
/** The tabs whose `path` is a file in the vault (a note, a board, a view, a picture or PDF, a drawing, a private note,
 *  a note's earlier versions), and the Templates page opened from a project note. */
const FILE_TABS: ReadonlySet<ViewType> = new Set<ViewType>(['note', 'canvas', 'view', 'media', 'drawing', 'private', 'versions', 'templates']);

export function removed(ws: Workspace, exists: (path: string) => boolean): Workspace {
  let changed = false;
  const walk = (node: PaneNode): PaneNode => {
    if (node.kind === 'split') return { ...node, children: node.children.map(walk) };
    return {
      ...node,
      tabs: node.tabs.map((t) => {
        // A centred graph whose note is gone (or never was a note: old `person:person:…` centres, 9 Nov 2026)
        // opens as the whole vault rather than on nothing.
        if (t.type === 'graph' && t.path && !exists(t.path)) {
          changed = true;
          return { ...t, path: undefined };
        }
        // Only a tab that shows a file in the vault goes when the file does. Every other page keeps its own meaning in
        // `path` (Settings its section, a shared space its folder, a module its part): 20 Nov 2026, on the
        // first Windows build, — Settings' path ("general") is never a file, so any file arriving (an import, a sync)
        // turned the open Settings page into an empty tab, closing the Import dialog inside it halfway.
        if (!t.path || !FILE_TABS.has(t.type) || exists(t.path)) return t;
        changed = true;
        // The Templates page opened from a project that is gone: still the Templates page.
        if (t.type === 'templates') return { ...t, path: undefined };
        return { ...t, type: 'empty' as const, path: undefined };
      }),
    };
  };
  const root = walk(ws.root);
  return changed ? { ...ws, root } : ws;
}

/**
 * The layout without any private note (src/shared/private.ts): a tab showing one shows nothing, and none stays in a tab's
 * history, the closed tabs or the recent files. When private notes lock, and for every layout saved to disk (even a
 * private note's name never reaches a file).
 */
export function withoutPrivate(ws: Workspace): Workspace {
  const keep = (p?: string) => !p || !isPrivatePath(p);
  const clean = (t: TabState): TabState => ({ ...t, ...(keep(t.path) ? {} : { type: 'empty' as const, path: undefined, mode: undefined }), back: t.back.filter((pl) => keep(pl.path)), forward: t.forward.filter((pl) => keep(pl.path)) });
  const walk = (node: PaneNode): PaneNode => (node.kind === 'split' ? { ...node, children: node.children.map(walk) } : { ...node, tabs: node.tabs.map(clean) });
  return { ...ws, root: walk(ws.root), closed: ws.closed.filter((t) => keep(t.path)).map(clean), recent: ws.recent.filter((p) => keep(p)) };
}

/**
 * One tab per target, for a saved layout (t73, 9 Nov 2026, the same strip: repeats from older sessions fold
 * into one - the one that was showing, else the first - so the vault never reopens with three Tasks). Only
 * tabs with a target fold (a place, a folder, a note at any line); a pack's page, Settings or a new tab is
 * never a repeat. Splits keep their shape: a group left with nothing keeps a new empty tab.
 */
function foldDuplicateTabs(ws: Workspace): Workspace {
  const all = groups(ws.root);
  const keyOf = (t: TabState): string | null => {
    // A file from outside the vault shows once (22 Nov 2026: a loop opened one file in hundreds of tabs, and they all
    // came back on every start): its tabs fold to one, by its path in any case.
    if (t.type === 'loose' && typeof t.path === 'string' && t.path) return `loose\n${t.path.replace(/\\/g, '/').toLowerCase()}`;
    const tg = tabTarget(t);
    return tg ? `${tg.place ?? ''}\n${tg.folder ?? ''}\n${tg.note ?? ''}` : null;
  };
  const showing = all.find((g) => g.id === ws.activeGroup)?.active ?? all[0]?.active;
  const winner = new Map<string, string>();
  for (const g of all)
    for (const t of g.tabs) {
      const k = keyOf(t);
      if (!k) continue;
      if (t.id === showing || !winner.has(k)) winner.set(k, t.id);
    }
  const keep = new Set<string>();
  for (const g of all)
    for (const t of g.tabs) {
      const k = keyOf(t);
      if (!k || winner.get(k) === t.id) keep.add(t.id);
    }
  if (keep.size === all.reduce((n, g) => n + g.tabs.length, 0)) return ws;
  const walk = (node: PaneNode): PaneNode => {
    if (node.kind === 'split') return { ...node, children: node.children.map(walk) };
    const tabs = node.tabs.filter((t) => keep.has(t.id));
    if (tabs.length) return { ...node, tabs, active: tabs.some((t) => t.id === node.active) ? node.active : tabs[0].id };
    const fresh = emptyTab();
    return { ...node, tabs: [fresh], active: fresh.id };
  };
  return { ...ws, root: walk(ws.root) };
}

/** A saved layout, checked: anything unreadable gives the default layout. */
export function restore(raw: unknown): Workspace | null {
  if (!raw || typeof raw !== 'object') return null;
  const ws = raw as Workspace;
  const okTab = (t: unknown): t is TabState => !!t && typeof (t as TabState).id === 'string' && typeof (t as TabState).type === 'string';
  const okNode = (n: unknown): n is PaneNode => {
    if (!n || typeof n !== 'object') return false;
    const node = n as PaneNode;
    if (node.kind === 'group') return Array.isArray(node.tabs) && node.tabs.length > 0 && node.tabs.every(okTab);
    if (node.kind === 'split') return Array.isArray(node.children) && node.children.length > 1 && node.children.every(okNode) && Array.isArray(node.sizes) && node.sizes.length === node.children.length;
    return false;
  };
  if (!okNode(ws.root)) return null;
  const base = defaultWorkspace();
  const fixTabs = (node: PaneNode): PaneNode =>
    node.kind === 'group'
      ? { ...node, tabs: node.tabs.map((t) => ({ ...t, back: Array.isArray(t.back) ? t.back : [], forward: Array.isArray(t.forward) ? t.forward : [] })), active: node.tabs.some((t) => t.id === node.active) ? node.active : node.tabs[0].id }
      : { ...node, children: node.children.map(fixTabs) };
  const fixed = fixTabs(ws.root);
  // One pane on reopen with tabs off (Polish round 1, ITEMS 4; round 3, ITEMS 4: on every vault open, and only
  // with tabs off): a split left from an old session is merged back to one pane, the active group's page kept
  // in front and every other pane's tabs kept behind it in this one group. With tabs on, a split is the
  // person's own and reopens as it was. loadWorkspace runs this on every vault open (App's openLibrary).
  const unfolded: PaneNode = !tabsShown && groups(fixed).length > 1 ? onePane({ ...ws, root: fixed }).root : fixed;
  const root = foldDuplicateTabs({ ...ws, root: unfolded }).root;
  const all = groups(root);
  const left = { ...base.left, ...(ws.left ?? {}) };
  const right = { ...base.right, ...(ws.right ?? {}) };
  // First opened by the calm shell (see CALM): the assistant's side closed, and the file tree (the old usual left side)
  // becomes the calm list; the Files panel is one click away in More.
  if (ws.calm !== CALM) {
    right.open = false;
    if (left.panel === 'files') left.panel = 'home';
  }
  // 8.0 (29 Oct 2026): the vault always opens on its nav; the file tree, search or bookmarks a session ended on are never
  // what it opens with.
  left.panel = 'home';
  // 10.0 Endless Tech: the rail is 292 px now; a stored 248 (the old default, never a drag worth keeping) moves with it.
  if (left.width === 248) left.width = 292;
  return {
    root,
    activeGroup: all.some((g) => g.id === ws.activeGroup) ? ws.activeGroup : all[0].id,
    left,
    right,
    closed: Array.isArray(ws.closed) ? ws.closed.filter(okTab).slice(0, 20) : [],
    recent: Array.isArray(ws.recent) ? ws.recent.filter((p): p is string => typeof p === 'string').slice(0, 40) : [],
    calm: CALM,
  };
}
