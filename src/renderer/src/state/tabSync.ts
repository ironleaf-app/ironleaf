// One strip (one product, 9 Nov 2026): Vault's tabs for the one above. The view reports its tabs — opening,
// closing, titles and the active tab — and takes back an activate or a close by id. Pure, so the App reports
// only what changed and the window (never frameless) reports nothing.
import type * as W from './workspace';

/** What a tab is, in the seam's own words (the openInView target that would land on it): a place, a Notes
 *  folder, or a note's path. The one above matches what was opened against what is open, so one place opens
 *  one tab and the side bar's highlight follows the showing tab. */
export interface VaultTabTarget {
  place?: string;
  folder?: string;
  note?: string;
}

export interface VaultTabReport {
  tabs: { id: string; title: string; target?: VaultTabTarget }[];
  active: string | null;
}

/** A tab's name when it is a place and nothing else (the page's words, as tabTitle says them): for the
 *  frameless header row, which names the page beside its actions, and for nothing else. Path pages keep
 *  their crumb; undefined means this tab is named elsewhere or not at all. */
export function placeName(type: string): string | undefined {
  switch (type) {
    case 'today': return 'Today';
    case 'home': return 'Home';
    case 'projects': return 'Projects';
    case 'tasks': return 'Tasks';
    case 'inbox': return 'Inbox';
    case 'people': return 'People';
    case 'meetings': return 'Meetings';
    case 'graph': return 'Graph';
    case 'templates': return 'Templates';
    case 'bin': return 'Bin';
    case 'import': return 'Import';
    case 'settings': return 'Settings';
    case 'versions': return 'Earlier versions';
    case 'private':
    case 'secrets':
    case 'locked': return 'Locked';
    case 'assets': return 'Assets';
    case 'bookmarks': return 'Bookmarks';
    case 'review': return 'Weekly review';
    case 'changes': return 'Changes waiting';
    case 'tidy': return 'Weekly tidy';
    case 'timeline': return 'Timeline';
    case 'shared-spaces': return 'Shared spaces';
    case 'abilities': return 'What Ironleaf can do';
    case 'empty': return 'New tab';
    default: return undefined;
  }
}

// A Notes tab filtered to a folder carries it after a ? (type:note?folder=Projects); the type stays note.
// (The same reading as noteTypes.ts folderOfTab, without the import: this module stays pure and leaf.)
const TYPE_TAB_PREFIX = 'type:';
function folderOfTypeTab(tab: Pick<W.TabState, 'type' | 'path'>): string | null {
  if (tab.type !== 'type' || !tab.path?.startsWith(`${TYPE_TAB_PREFIX}note?`)) return null;
  const m = /[?&]folder=([^&]*)/.exec(tab.path);
  if (!m) return null;
  try { return decodeURIComponent(m[1]).slice(0, 200); } catch { return null; }
}
function isNotesTab(tab: Pick<W.TabState, 'type' | 'path'>): boolean {
  if (tab.type !== 'type' || !tab.path?.startsWith(TYPE_TAB_PREFIX)) return false;
  return tab.path.slice(TYPE_TAB_PREFIX.length).split('?')[0] === 'note';
}

/** What a tab is, in the seam's words: a place tab is its place, a Notes tab its folder (or every note),
 *  a file tab its note. Anything the seam cannot open (a pack's page, a view, the graph centred somewhere
 *  already answered by its place) keeps no target and never matches. */
export function tabTarget(tab: Pick<W.TabState, 'type' | 'path'>): VaultTabTarget | undefined {
  switch (tab.type) {
    case 'today':
    case 'projects':
    case 'tasks':
    case 'inbox':
    case 'meetings':
    case 'graph':
      return { place: tab.type };
    case 'people':
      // The People page is the place; a person's page is their file.
      if (!tab.path || tab.path === 'people:') return { place: 'people' };
      return undefined;
    case 'type': {
      if (!isNotesTab(tab)) return undefined;
      const folder = folderOfTypeTab(tab);
      return folder ? { place: 'notes', folder } : { place: 'notes' };
    }
    case 'notebook': {
      // A notebook tab's path names its folder (notebook:<folder>); it is Notes in that folder.
      const folder = (tab.path ?? '').startsWith('notebook:') ? (tab.path ?? '').slice('notebook:'.length) : '';
      return folder ? { place: 'notes', folder } : { place: 'notes' };
    }
    case 'note':
    case 'canvas':
    case 'drawing':
    case 'media':
    case 'view':
    case 'loose':
    case 'project-file':
      return tab.path ? { note: tab.path } : undefined;
    default:
      return undefined;
  }
}

/** Every group in the pane tree, in order. */
function groupsOf(node: W.PaneNode, out: W.Group[] = []): W.Group[] {
  if (node.kind === 'group') out.push(node);
  else for (const c of node.children) groupsOf(c, out);
  return out;
}

/** Whether two targets say the same tab. */
export function tabTargetEqual(a: VaultTabTarget | undefined, b: VaultTabTarget | undefined): boolean {
  if (!a || !b) return a === b;
  return (a.place ?? '') === (b.place ?? '') && (a.folder ?? '') === (b.folder ?? '') && (a.note ?? '') === (b.note ?? '');
}

/** The report for the one above: every tab everywhere, and the showing tab. Titles come from the caller (the
 *  displayed title for a note, else the tab's words), so this stays pure; targets ride from the tabs as they are. */
export function tabSyncReport(ws: W.Workspace, titleOf: (tab: W.TabState) => string): VaultTabReport {
  const groups = groupsOf(ws.root);
  const tabs = groups
    .flatMap((g) =>
      g.tabs.map((t) => {
        const target = tabTarget(t);
        return target ? { id: t.id, title: titleOf(t), target } : { id: t.id, title: titleOf(t) };
      }),
    )
    .filter((t) => t.id && t.title);
  const group = groups.find((g) => g.id === ws.activeGroup) ?? groups[0];
  const active = group?.tabs.find((t) => t.id === group.active)?.id ?? null;
  return { tabs: tabs.slice(0, 60), active: active && tabs.some((t) => t.id === active) ? active : null };
}

/** Whether two reports say the same (the view reports only what changed, so the strip never flickers). */
export function tabSyncEqual(a: VaultTabReport, b: VaultTabReport): boolean {
  if (a.active !== b.active || a.tabs.length !== b.tabs.length) return false;
  return a.tabs.every((t, i) => t.id === b.tabs[i].id && t.title === b.tabs[i].title && tabTargetEqual(t.target, b.tabs[i].target));
}

/** The group holding a tab, for an activate from the one above. */
export function tabSyncGroup(ws: W.Workspace, id: string): W.Group | null {
  for (const g of groupsOf(ws.root)) if (g.tabs.some((t) => t.id === id)) return g;
  return null;
}
