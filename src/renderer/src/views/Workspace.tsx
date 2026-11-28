// The middle of the window: groups of tabs, side by side or stacked, with dividers to resize them. Tabs drag to reorder
// or into another group; files dragged from the file list open where they are dropped. With tabs off (Settings ›
// Appearance › Interface › Show tabs; Ironleaf Calm, 20 Oct 2026) a group shows one page at a time: no tab strip, and
// the page's own header is the top band, with Back and Forward (state/workspace.ts open() says where pages go then).

import { isPrivatePath } from '../../../shared/private';
import { looseName } from '../../../shared/loose-name';
import { areaIcon, areaTitle } from './areaTabs';
import { moduleIcon, moduleTitle } from './modules/tabHelpers';
import { VersionsPage } from '../components/Extras';
import { ModuleTour } from './modules/ModuleTour';
import { moduleInfo } from '../../../shared/life-modules';
import { projectInFolder } from '../state/projectWorkspace';
import { recordsTitle } from '../state/recordsTab';
import { folderOfNotebookTab } from '../../../shared/notebook';
import { getNoteTypes, typeOfTab } from '../state/noteTypes';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { PageGuard } from '../components/ErrorBoundary';
import { fileIcon, Icon, type IconName } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { CardsSkeleton, PageLoading } from '../components/PageStates';
import { dropEditorCache } from '../editor/tabCache';
import { dropDocHead } from '../editor/docHead';
import { dropNoteFoot } from '../editor/noteFoot';
import * as A from '../state/actions';
import { setWorkspace, useWorkspace } from '../state/layout';
import { inVaultView } from '../lib/inWindow';
import { forgetScroll, noteScroll, placeKey, readScroll, takeRestore } from '../state/pageScroll';
import { viewMove } from '../lib/viewMove';
import { toggleSide, useFit } from '../state/fit';
import { tabMenu } from '../state/menus';
import { placeName } from '../state/tabSync';
import * as W from '../state/workspace';
import { showSide } from '../state/fit';
import { useApp, usePrefs } from '../state/store';
import { PageBand, ViewHeader } from './ViewHeader';
// Every route's view loads with its route, not the boot (5 Nov 2026 speed audit item 7: ~6 MB eager). The tab
// strip's titles and icons stay static (areaTabs, tabHelpers, loose-name); VersionsPage stays with Extras, which
// the boot already carries. A tab that fails still shows plain words with Try again (PageGuard, inside Suspense).
const ProjectsHome = lazy(() => import('./ProjectsHome').then((m) => ({ default: m.ProjectsHome })));
const TodayView = lazy(() => import('./TodayView').then((m) => ({ default: m.TodayView })));
const TemplatesPage = lazy(() => import('./TemplatesPage').then((m) => ({ default: m.TemplatesPage })));
const BinView = lazy(() => import('./BinView').then((m) => ({ default: m.BinView })));
const WeeklyTidyView = lazy(() => import('./WeeklyTidyView').then((m) => ({ default: m.WeeklyTidyView })));
const AssetsPage = lazy(() => import('./AssetsPage').then((m) => ({ default: m.AssetsPage })));
const TimelineView = lazy(() => import('./TimelineView').then((m) => ({ default: m.TimelineView })));
const TasksView = lazy(() => import('./TasksView').then((m) => ({ default: m.TasksView })));
const SharedSpacesHome = lazy(() => import('./SharedSpacesHome').then((m) => ({ default: m.SharedSpacesHome })));
const SharedSpacePage = lazy(() => import('./SharedSpacePage').then((m) => ({ default: m.SharedSpacePage })));
const LockedView = lazy(() => import('./LockedView').then((m) => ({ default: m.LockedView })));
const ImportView = lazy(() => import('./ImportView').then((m) => ({ default: m.ImportView })));
const SettingsPage = lazy(() => import('../components/Settings').then((m) => ({ default: m.SettingsPage })));
const TypePage = lazy(() => import('./TypePage').then((m) => ({ default: m.TypePage })));
const NotebookView = lazy(() => import('./NotebookView').then((m) => ({ default: m.NotebookView })));
const RecordsView = lazy(() => import('./RecordsView').then((m) => ({ default: m.RecordsView })));
const AreaPage = lazy(() => import('./AreaPage').then((m) => ({ default: m.AreaPage })));
const InboxPage = lazy(() => import('./InboxPage').then((m) => ({ default: m.InboxPage })));
// Job C (Notes, Inbox, Search, Graph): the Notes and Docs places open the Notes page, not the table page.
const NotesPage = lazy(() => import('./NotesPage').then((m) => ({ default: m.NotesPage })));
const PeoplePage = lazy(() => import('./PeoplePage').then((m) => ({ default: m.PeoplePage })));
// Polish round 1 (ITEMS 3): the nav's Meetings opens the Meetings page, not the meeting table.
const MeetingsPage = lazy(() => import('./modules/work/MeetingsPage').then((m) => ({ default: m.MeetingsPage })));
// Job B: a person's page (People tab, person:...)
const PersonPage = lazy(() => import('./PersonPage').then((m) => ({ default: m.PersonPage })));
const ModulePage = lazy(() => import('./modules/registry').then((m) => ({ default: m.ModulePage })));
const CanvasView = lazy(() => import('./CanvasView').then((m) => ({ default: m.CanvasView })));
const DrawingView = lazy(() => import('./DrawingView').then((m) => ({ default: m.DrawingView })));
const LooseView = lazy(() => import('./LooseView').then((m) => ({ default: m.LooseView })));
const SavedView = lazy(() => import('./SavedView').then((m) => ({ default: m.SavedView })));
const BookmarksPage = lazy(() => import('./BookmarksPage').then((m) => ({ default: m.BookmarksPage })));
const EmptyView = lazy(() => import('./EmptyView').then((m) => ({ default: m.EmptyView })));
const GraphTab = lazy(() => import('./GraphTab').then((m) => ({ default: m.GraphTab })));
const MediaView = lazy(() => import('./MediaView').then((m) => ({ default: m.MediaView })));
const FolderFileView = lazy(() => import('./FolderFileView').then((m) => ({ default: m.FolderFileView })));
const NoteView = lazy(() => import('./NoteView').then((m) => ({ default: m.NoteView })));
const WeeklyReview = lazy(() => import('./WeeklyReview').then((m) => ({ default: m.WeeklyReview })));
const AbilitiesPage = lazy(() => import('./AbilitiesPage').then((m) => ({ default: m.AbilitiesPage })));
const ChangesView = lazy(() => import('./ChangesView').then((m) => ({ default: m.ChangesView })));

/** Pages that draw their own header (ViewHeader); the others get a plain one when tabs are off, for Back and Forward. */
// Pages that draw their own path bar (8.0.1, 29 Oct 2026: a project's Workspace and a notebook drew theirs under the
// frame's, which showed "notebook:Business / Projects /"). The map and a saved view draw no bar of their own (10.0
// second round N1: with tabs off they stood bare), so the frame's bar is theirs.
const OWN_HEADER = new Set<W.ViewType>(['note', 'canvas', 'media', 'notebook', 'project-file']);
// Settings and the private places (8.7 w4a round 2): pages with their own crumb ("Settings", "Settings / Recently
// deleted", "Notes / the note / Earlier versions") and their own actions in the bar, so the frame never draws above them.
// Pages without a path that draw their own bar too (8.7 wave 2a round 2: Projects, Tasks and the Inbox carry the
// mock-ups' primary action and ⋯ in the top bar, so they render ViewHeader themselves like a note does; 10.0: Today
// does too, with New note as its page action; 10.0 second round N1: the tidy draws its own bar so it is listed, and
// Abilities draws none so the frame's bar is its only one).
// An empty page showing Home is Home too (3 Nov 2026: the vault's first page drew two top bars, the frame's and
// Home's own), so it draws no frame bar either (the condition below).
const SELF_HEADER = new Set<W.ViewType>(['settings', 'versions', 'bin', 'secrets', 'private', 'locked', 'import', 'projects', 'tasks', 'inbox', 'tidy', 'today', 'home', 'shared-spaces', 'shared-space', 'meetings', 'module']);

interface Edges {
  top: boolean;
  left: boolean;
  right: boolean;
}

/** A tab's words for the tab strip and the window title (one product step 2: the window follows the page). */
export function tabTitle(tab: W.TabState): string {
  if (tab.type === 'graph') return tab.path ? `Connections: ${A.titleOf(tab.path)}` : 'Graph';
  // A place and nothing else reads its name (state/tabSync.ts placeName, shared with the frameless header row).
  const place = placeName(tab.type);
  if (place !== undefined && tab.type !== 'empty') return place;
  if (tab.type === 'shared-space') return tab.path ? `${tab.path.split('/').pop()} · Shared space` : 'Shared space';
  if (tab.type === 'loose' && tab.path) return looseName(tab.path);
  if (tab.type === 'type') return getNoteTypes().find((t) => t.id === typeOfTab(tab))?.plural ?? 'Notes';
  if (tab.type === 'notebook') {
    // A project's folder is its workspace (views/workspace/ProjectWorkspace.tsx).
    const folder = folderOfNotebookTab(tab.path) ?? '';
    return projectInFolder(folder) ? `${folder.split('/').pop()} · Workspace` : `${folder.split('/').pop() || 'Your notes'} · Notebook`;
  }
  if (tab.type === 'records') return recordsTitle(tab.path);
  if (tab.type === 'area') return areaTitle(tab);
  if (tab.type === 'module') return moduleTitle(tab);
  // A project's file ("<project>\n<rel>"): its name, never the encoded path.
  if (tab.type === 'project-file') return tab.path?.split('\n')[1]?.split('/').pop() || 'File';
  if (tab.type === 'empty' || !tab.path) return 'New tab';
  return tab.type === 'media' ? A.nameOf(tab.path) : A.titleOf(tab.path);
}

/** A tab's name: a note's displayed title (its `title:` when the file cannot hold it — a meeting's colon, a copy
 *  number on the file), anything else's as before. */
function TabName({ tab }: { tab: W.TabState }) {
  const shown = useApp((s) => (tab.path ? s.byPath.get(tab.path)?.title : undefined));
  const plain = tabTitle(tab);
  // Only a plain file-name tab is swapped (a graph, pack or media tab keeps its own words).
  if (tab.path && tab.type !== 'media' && shown && plain === A.titleOf(tab.path)) return <>{shown}</>;
  return <>{plain}</>;
}

const TAB_MIME = 'application/x-nv-tab';
const PATHS_MIME = 'application/x-nv-paths';

function TabStrip({ group, edges, active }: { group: W.Group; edges: Edges; active: boolean }) {
  const fitLeft = useFit().left;
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector('.tab-item.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [group.active, group.tabs.length]);
  // The tab on show stays wholly in sight when the strip narrows (a smaller window, a side opened).
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const tab = el.querySelector<HTMLElement>('.tab-item.active');
      if (!tab) return;
      const s = el.getBoundingClientRect(), r = tab.getBoundingClientRect();
      if (r.right > s.right) el.scrollLeft += r.right - s.right + 6;
      else if (r.left < s.left) el.scrollLeft -= s.left - r.left + 6;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dropIndex = (e: DragEvent) => {
    const tabs = [...(strip.current?.querySelectorAll<HTMLElement>('.tab-item') ?? [])];
    const at = tabs.findIndex((t) => {
      const r = t.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2;
    });
    return at < 0 ? tabs.length : at;
  };
  const showMarker = (e: DragEvent) => {
    const tabs = [...(strip.current?.querySelectorAll<HTMLElement>('.tab-item') ?? [])];
    tabs.forEach((t) => t.classList.remove('drop-before', 'drop-after'));
    const at = dropIndex(e);
    if (at < tabs.length) tabs[at].classList.add('drop-before');
    else tabs[tabs.length - 1]?.classList.add('drop-after');
  };
  const clearMarker = () => strip.current?.querySelectorAll('.tab-item').forEach((t) => t.classList.remove('drop-before', 'drop-after'));
  return (
    <div
      ref={strip}
      className={`tab-strip drag${edges.top && edges.right ? ' controls-gap' : ''}${edges.top && edges.left ? ' controls-gap-left' : ''}${active ? ' is-active' : ''}`}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('tab-strip-space')) setWorkspace((ws) => W.open(W.activate(ws, group.id), { type: 'empty' }, 'tab'));
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(TAB_MIME) || e.dataTransfer.types.includes(PATHS_MIME)) {
          e.preventDefault();
          showMarker(e);
        }
      }}
      onDragLeave={clearMarker}
      // More tabs than fit scroll sideways; the mouse wheel scrolls them too.
      onWheel={(e) => {
        const el = strip.current;
        if (el && el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
      }}
      onDrop={(e) => {
        clearMarker();
        const tabId = e.dataTransfer.getData(TAB_MIME);
        if (tabId) {
          e.preventDefault();
          // The reorder glides (5 Nov 2026 feel-motion: tabs popped side-to-side); each tab keeps its own name.
          viewMove(() => setWorkspace((ws) => W.moveTab(ws, tabId, group.id, dropIndex(e))));
          return;
        }
        const paths = e.dataTransfer.getData(PATHS_MIME).split('\n').filter(Boolean);
        if (paths.length) {
          e.preventDefault();
          setWorkspace((ws) => W.activate(ws, group.id));
          for (const p of paths) A.openPath(p, { where: 'tab' });
        }
      }}
    >
      {/* The left side hidden: it comes back from here (19 Oct 2026: the strip down the left edge that held it is gone). */}
      {edges.top && edges.left && fitLeft !== 'docked' && (
        <button className="tab-strip-show-left" title="Show the left side" aria-label="Show the left side" onClick={() => toggleSide('left')}>
          <Icon name="sidebarLeft" size={16} />
        </button>
      )}
      {group.tabs.map((tab) => {
        const isActive = tab.id === group.active;
        return (
          <div
            key={tab.id}
            className={`tab-item${isActive ? ' active' : ''}${tab.pinned ? ' pinned' : ''}`}
            style={{ viewTransitionName: `tab-${tab.id}` }}
            draggable
            title={tab.path ?? tabTitle(tab)}
            onDragStart={(e) => {
              e.dataTransfer.setData(TAB_MIME, tab.id);
              if (tab.path) e.dataTransfer.setData(PATHS_MIME, tab.path);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                dropEditorCache(tab.id);
                dropDocHead(tab.id);
                dropNoteFoot(tab.id);
                setWorkspace((ws) => W.closeTab(ws, tab.id));
              } else if (e.button === 0) setWorkspace((ws) => W.activate(ws, group.id, tab.id));
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              openMenu(e, tabMenu(tab));
            }}
          >
            <Icon name={tab.type === 'graph' ? 'graph' : tab.type === 'empty' ? 'newTab' : tab.type === 'today' ? 'sun' : tab.type === 'home' ? 'home' : tab.type === 'review' ? 'review' : tab.type === 'changes' ? 'review' : tab.type === 'tidy' ? 'sparkle' : tab.type === 'projects' ? 'layers' : tab.type === 'templates' ? 'template' : tab.type === 'assets' ? 'assets' : tab.type === 'bookmarks' ? 'bookmark' : tab.type === 'timeline' ? 'timeline' : tab.type === 'tasks' ? 'task' : tab.type === 'loose' ? 'file' : tab.type === 'notebook' ? (projectInFolder(folderOfNotebookTab(tab.path) ?? '') ? 'layers' : 'book') : tab.type === 'records' ? 'views' : tab.type === 'area' ? areaIcon(tab) : tab.type === 'inbox' ? 'inbox' : tab.type === 'people' ? 'people' : tab.type === 'abilities' ? 'sparkle' : tab.type === 'meetings' ? 'calendar' : tab.type === 'module' ? (moduleIcon(tab) as IconName) : tab.type === 'type' ? ((getNoteTypes().find((t) => t.id === typeOfTab(tab))?.icon ?? 'notes') as IconName) : tab.type === 'private' || tab.type === 'secrets' || tab.type === 'locked' || isPrivatePath(tab.path) ? 'lock' : tab.type === 'settings' ? 'settings' : tab.type === 'versions' ? 'history' : tab.type === 'bin' ? 'trash' : tab.type === 'shared-spaces' || tab.type === 'shared-space' ? 'people' : fileIcon(tab.path ?? '')} size={14} className="tab-icon" />
            <span className="tab-title">
              <TabName tab={tab} />
            </span>
            {tab.pinned ? (
              <button className="tab-pin" title="Unpin" onMouseDown={(e) => e.stopPropagation()} onClick={() => setWorkspace((ws) => W.updateTab(ws, tab.id, { pinned: false }))}>
                <Icon name="pin" size={12} />
              </button>
            ) : (
              <button
                className="tab-close"
                title="Close"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  dropEditorCache(tab.id);
                  dropDocHead(tab.id);
                  dropNoteFoot(tab.id);
                  setWorkspace((ws) => W.closeTab(ws, tab.id));
                }}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
        );
      })}
      <button className="tab-new" title="New tab (Ctrl+T)" onClick={() => setWorkspace((ws) => W.open(W.activate(ws, group.id), { type: 'empty' }, 'tab'))}>
        <Icon name="plus" size={15} />
      </button>
      <div className="tab-strip-space" />
      {edges.top && edges.right && (
        <button className="tab-side-toggle" title="Show the right side" onClick={() => showSide('right')}>
          <Icon name="sidebarRight" size={16} />
        </button>
      )}
    </div>
  );
}

type Zone = 'left' | 'right' | 'top' | 'bottom' | 'center';

/** The page's own scroller: the views' shared column first, else the first tall one (notes scroll their editor). */
function pageScroller(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  // A page in panes (layout round 3) scrolls its list pane, not the page: that is where the place is kept.
  const pane = root.querySelector<HTMLElement>('.nv-panes-root > .nv-split-main, .mt-regions.nv-panes-root > .mt-minutes');
  if (pane) return pane;
  const own = root.querySelector<HTMLElement>('.vscroll');
  if (own) return own;
  for (const el of root.querySelectorAll<HTMLElement>('div, main, section')) {
    if (el.scrollHeight - el.clientHeight > 32) return el;
  }
  return null;
}

/**
 * Where the tab's page sits (state/pageScroll.ts, v9, 6 Nov 2026): a fresh place opens at the top, every time;
 * Back, Forward and a tab brought forward restore where the person was. One wrapper around every page, so the
 * rule holds everywhere without each view knowing it. A link to a named section still goes there: the views'
 * own reveals run after their data lands, which is after this.
 */
function PageTop({ tab, children }: { tab: W.TabState; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = placeKey(tab.id, tab.type, tab.path, tab.section);
  const keyRef = useRef(key);
  keyRef.current = key;
  // The last position this wrapper set itself, and whether the person has scrolled since the place landed.
  const expectRef = useRef(-1);
  const userRef = useRef(false);
  // A restore still catching up (t239): while held, scrolls short of the target are the hold's (late content
  // clamped the first try), never the person's — they neither stop the hold nor overwrite the kept position.
  const holdRef = useRef(false);
  const prevKeyRef = useRef<string | null>(null);
  // The fresh visit's page and the tabs seen in it (t255): a tab's first sight lands at the top, never on a
  // stale scroll from an older visit; later sights restore the tab's own kept top.
  const freshRef = useRef<{ page: string; seen: Set<string> } | null>(null);
  // The position is remembered as the person scrolls, so leaving the page keeps it (Back, another tab).
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // The scroller is found fresh each time (a new place may draw a new one); inner lists scrolling keep the
    // page's own top, which is what Back and tab switches restore.
    const onScroll = () => {
      const s = pageScroller(root);
      if (!s) return;
      if (holdRef.current && s.scrollTop < expectRef.current - 4) return;
      noteScroll(keyRef.current, s.scrollTop);
      if (Math.abs(s.scrollTop - expectRef.current) > 4) userRef.current = true;
    };
    // Scroll events don't bubble: catch them on the way down, from whatever scrolls inside the page.
    root.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => root.removeEventListener('scroll', onScroll, { capture: true });
  }, []);
  useEffect(() => {
    // A new place in this tab (or the tab back on show): the top when fresh, the kept position when returning.
    userRef.current = false;
    const prev = prevKeyRef.current;
    prevKeyRef.current = key;
    // A fresh wrapper or a new kind of page mounts fresh DOM (t146, 9 Nov 2026): nothing reused to reset,
    // so the scan — every div's heights, a forced layout of the just-mounted page — is skipped, and the open
    // starts at the top as it draws. The same kind of page (note to note) can reuse its DOM, and Back and tab
    // switches restore, so those still find the scroller and go there.
    const restore = takeRestore(tab.id);
    // One of the page's own tabs opened (t255, 13 Nov 2026): the same page, another tab — its own kept top,
    // or the top when fresh. Back and tab switches keep working through the same hold below.
    const first3 = key.split('\n', 3).join('\n');
    const sectionHop = !restore && prev !== null && prev !== key && prev.split('\n', 3).join('\n') === first3;
    if (!restore && !sectionHop && (prev === null || prev.split('\n', 2).join('\n') !== key.split('\n', 2).join('\n'))) {
      expectRef.current = 0;
      forgetScroll(key);
      // Landing at the top is recorded (t255): sitting at 0 fires no scroll event, and without this a
      // stale scroll from an older visit survives to answer a later Back.
      noteScroll(key, 0);
      freshRef.current = { page: first3, seen: new Set([key]) };
      return;
    }
    const s = pageScroller(ref.current);
    if (!restore && !sectionHop) {
      expectRef.current = 0;
      forgetScroll(key);
      noteScroll(key, 0);
      freshRef.current = { page: first3, seen: new Set([key]) };
      s?.scrollTo({ top: 0 });
      return;
    }
    // A tab's first sight in a fresh visit lands at the top (v9's halfway-down-the-page, one tab at a time):
    // settling the remembered tab must never resurrect its scroll from an older visit.
    const fresh = freshRef.current;
    const firstSight = sectionHop && !!fresh && fresh.page === first3 && !fresh.seen.has(key);
    if (sectionHop && fresh && fresh.page === first3) fresh.seen.add(key);
    if (restore) freshRef.current = { page: first3, seen: new Set([key]) };
    const top = firstSight ? 0 : sectionHop ? (readScroll(key) ?? 0) : readScroll(key);
    if (top === undefined || top <= 0) {
      if (sectionHop) {
        expectRef.current = 0;
        noteScroll(key, 0);
        s?.scrollTo({ top: 0 });
      }
      return;
    }
    expectRef.current = top;
    holdRef.current = true;
    s?.scrollTo({ top });
    // Late content (still loading) clamps the first try, or the scroller isn't drawn yet at all: hold the
    // position while the page arrives and grows, until the person scrolls or the page settles (t239: Back
    // returns scrolled where the person was, even past a page that loads in stages).
    let lastH = s?.scrollHeight ?? 0;
    let tries = 0;
    const done = () => {
      holdRef.current = false;
      window.clearInterval(timer);
    };
    const timer = window.setInterval(() => {
      if (userRef.current || tries++ > 15) {
        done();
        return;
      }
      const cur = pageScroller(ref.current);
      if (!cur) return;
      if (cur.scrollHeight !== lastH) {
        lastH = cur.scrollHeight;
        expectRef.current = top;
        cur.scrollTo({ top });
      } else if (Math.abs(cur.scrollTop - top) <= 4) done();
    }, 200);
    return () => {
      holdRef.current = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div ref={ref} className="page-top" style={{ display: 'contents' }}>
      {children}
    </div>
  );
}

function GroupView({ group, edges, focused, alone }: { group: W.Group; edges: Edges; focused: boolean; alone: boolean }) {
  const tab = group.tabs.find((t) => t.id === group.active) ?? group.tabs[0];
  const activateGroup = useCallback(() => setWorkspace((ws) => (ws.activeGroup === group.id ? ws : W.activate(ws, group.id))), [group.id]);
  const body = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState<Zone | null>(null);
  // Dragging a tab (or a file from the file list) to an edge of the pane splits it there; a tab dropped in the middle
  // joins this pane (a file dropped in the middle of a note becomes a link in it, as the editor does).
  const zoneOf = (e: DragEvent): Zone => {
    const r = body.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (x < 0.22) return 'left';
    if (x > 0.78) return 'right';
    if (y < 0.22) return 'top';
    if (y > 0.78) return 'bottom';
    return 'center';
  };
  const dragKind = (e: DragEvent) => (e.dataTransfer.types.includes(TAB_MIME) ? 'tab' : e.dataTransfer.types.includes(PATHS_MIME) ? 'paths' : null);
  const prefs = usePrefs();
  // One strip (one product, 9 Nov 2026): in the view Vault's own strip hides and the one above holds the tabs.
  const tabs = prefs.showTabs && !inVaultView();
  return (
    <PageBand.Provider value={tabs ? null : edges}>
    <section className={`group${focused ? ' is-focused' : ''}${tabs ? '' : ' is-one-page'}`} data-top-edge={edges.top ? '1' : '0'} data-group={group.id} onMouseDownCapture={activateGroup} onFocusCapture={activateGroup}>
      {tabs ? <TabStrip group={group} edges={edges} active={focused && !alone} /> : !(OWN_HEADER.has(tab.type) && tab.path) && !SELF_HEADER.has(tab.type) && !(tab.type === 'empty' && prefs.home) && tab.type !== 'timeline' && <ViewHeader tab={tab} title={tab.type === 'empty' ? '' : tabTitle(tab)} />}
      <div
        className="group-body"
        ref={body}
        onDragOver={(e) => {
          const kind = dragKind(e);
          if (!kind) return;
          const z = zoneOf(e);
          // Over a note, a file in the middle is the editor's to take (a link at the drop point).
          if (kind === 'paths' && z === 'center' && tab.type === 'note') return setZone(null);
          e.preventDefault();
          setZone(z);
        }}
        onDragLeave={(e) => {
          if (!body.current?.contains(e.relatedTarget as Node)) setZone(null);
        }}
        onDrop={(e) => {
          setZone(null);
          if (e.defaultPrevented) return;
          const kind = dragKind(e);
          if (!kind) return;
          const z = zoneOf(e);
          if (kind === 'tab') {
            const tabId = e.dataTransfer.getData(TAB_MIME);
            if (!tabId) return;
            e.preventDefault();
            setWorkspace((ws) => (z === 'center' ? W.moveTab(ws, tabId, group.id) : W.moveTabToSide(ws, tabId, group.id, z)));
            return;
          }
          const paths = e.dataTransfer.getData(PATHS_MIME).split('\n').filter(Boolean);
          if (!paths.length || (z === 'center' && tab.type === 'note')) return;
          e.preventDefault();
          if (z === 'center') {
            setWorkspace((ws) => W.activate(ws, group.id));
            for (const p of paths) A.openPath(p, { where: 'tab' });
            return;
          }
          const fresh: W.TabState = { ...W.emptyTab(), type: W.typeOf(paths[0]), path: paths[0] };
          setWorkspace((ws) => W.noteOpened(W.splitWith(ws, group.id, z === 'left' || z === 'right' ? 'row' : 'column', fresh, z === 'left' || z === 'top'), paths[0]));
        }}
      >
        {zone && <div className={`drop-zone zone-${zone}`} aria-hidden="true" />}
        {/* A page that fails shows plain words with Try again, never a blank window (8.7 urgent, 30 Oct 2026); a new
            tab starts with a fresh guard. */}
        <PageTop tab={tab}>
        <PageGuard key={tab.id} name={tab.type}>
          <Suspense fallback={<PageLoading label="Opening…"><CardsSkeleton cards={3} /></PageLoading>}>
          {tab.type === 'note' && tab.path ? (
          <NoteView key={tab.id} tab={tab} focused={focused} />
        ) : tab.type === 'canvas' && tab.path ? (
          <CanvasView key={`${tab.id}:${tab.path}`} tab={tab} />
        ) : tab.type === 'drawing' && tab.path ? (
          <DrawingView key={`${tab.id}:${tab.path}`} tab={tab} />
        ) : tab.type === 'loose' && tab.path ? (
          <LooseView key={`${tab.id}:${tab.path}`} tab={tab} />
        ) : tab.type === 'view' && tab.path ? (
          <SavedView key={`${tab.id}:${tab.path}`} tab={tab} />
        ) : tab.type === 'media' && tab.path ? (
          <MediaView key={`${tab.id}:${tab.path}`} tab={tab} />
        ) : tab.type === 'project-file' && tab.path ? (
          <FolderFileView key={`${tab.id}:${tab.path}`} tab={tab} />
        ) : tab.type === 'graph' ? (
          <GraphTab key={tab.id} tab={tab} />
        ) : tab.type === 'today' ? (
          <TodayView key={tab.id} tab={tab} />
        ) : tab.type === 'home' ? (
          // Home folded into Today (5 Nov 2026, one morning place): old home tabs draw Today.
          <TodayView key={tab.id} tab={tab} />
        ) : tab.type === 'projects' ? (
          <ProjectsHome key={tab.id} tab={tab} />
        ) : tab.type === 'templates' ? (
          <TemplatesPage key={tab.id} tab={tab} />
        ) : tab.type === 'bin' ? (
          <BinView key={tab.id} tab={tab} />
        ) : tab.type === 'private' || tab.type === 'secrets' || tab.type === 'locked' ? (
          <LockedView key={tab.id} tab={tab} />
        ) : tab.type === 'import' ? (
          <ImportView key={tab.id} tab={tab} />
        ) : tab.type === 'settings' ? (
          <SettingsPage key={tab.id} tab={tab} />
        ) : tab.type === 'versions' ? (
          <VersionsPage key={tab.id} tab={tab} />
        ) : tab.type === 'bookmarks' ? (
          <BookmarksPage key={tab.id} />
        ) : tab.type === 'assets' ? (
          <AssetsPage key={tab.id} />
        ) : tab.type === 'review' ? (
          <WeeklyReview key={tab.id} />
        ) : tab.type === 'changes' ? (
          <ChangesView key={tab.id} tab={tab} />
        ) : tab.type === 'tidy' ? (
          <WeeklyTidyView key={tab.id} tab={tab} />
        ) : tab.type === 'timeline' ? (
          <TimelineView key={tab.id} tab={tab} />
        ) : tab.type === 'tasks' ? (
          <TasksView key={tab.id} tab={tab} />
        ) : tab.type === 'shared-spaces' ? (
          <SharedSpacesHome key={tab.id} tab={tab} />
        ) : tab.type === 'shared-space' && tab.path ? (
          <SharedSpacePage key={`${tab.id}:${tab.path}`} tab={tab} />
        ) : tab.type === 'notebook' && tab.path ? (
          <NotebookView key={`${tab.id}:${tab.path}`} tab={tab} />
        ) : tab.type === 'records' && tab.path ? (
          <RecordsView key={`${tab.id}:${tab.path}`} tab={tab} />
        ) : tab.type === 'area' ? (
          <AreaPage key={tab.id} tab={tab} />
        ) : tab.type === 'inbox' ? (
          <InboxPage key={tab.id} tab={tab} />
        ) : tab.type === 'people' && tab.path?.startsWith('person:') ? (
          <PersonPage key={tab.id} tab={tab} /> // Job B: a person's page
        ) : tab.type === 'meetings' ? (
          <MeetingsPage key={tab.id} tab={tab} /> // Polish round 1 (ITEMS 3): Upcoming and Past, with attendees
        ) : tab.type === 'people' ? (
          <PeoplePage key={tab.id} tab={tab} />
        ) : tab.type === 'module' ? (
          <ModulePage key={tab.id} tab={tab} />
        ) : tab.type === 'abilities' ? (
          <AbilitiesPage key={tab.id} />
        ) : tab.type === 'type' && (typeOfTab(tab) === 'note' || typeOfTab(tab) === 'doc' || typeOfTab(tab) === 'daily') ? (
          // Job C: Notes and Docs places show the Notes page (Docs is a filter there). Polish round 2 (ITEMS 1): Daily too.
          <NotesPage key={`${tab.id}:${tab.path}`} tab={tab} />
        ) : tab.type === 'type' && typeOfTab(tab) ? (
          <TypePage key={`${tab.id}:${tab.path}`} tab={tab} />
        ) : (
          <EmptyView tab={tab} closable={group.tabs.length > 1 || !alone} />
        )}
          </Suspense>
        </PageGuard>
        </PageTop>
      </div>
    </section>
    </PageBand.Provider>
  );
}

function Resizer({ split, index }: { split: W.Split; index: number }) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const container = handle.closest('.split') as HTMLElement;
    const rect = container.getBoundingClientRect();
    const total = split.dir === 'row' ? rect.width : rect.height;
    const start = split.dir === 'row' ? e.clientX : e.clientY;
    const sizes = [...split.sizes];
    const pair = sizes[index] + sizes[index + 1];
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add(split.dir === 'row' ? 'is-resizing-x' : 'is-resizing-y');
    const move = (ev: PointerEvent) => {
      const delta = ((split.dir === 'row' ? ev.clientX : ev.clientY) - start) / total;
      const a = Math.min(pair - 0.08, Math.max(0.08, sizes[index] + delta));
      const next = [...sizes];
      next[index] = a;
      next[index + 1] = pair - a;
      setWorkspace((ws) => W.resize(ws, split.id, next));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      document.body.classList.remove('is-resizing-x', 'is-resizing-y');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };
  return <div className={`split-handle ${split.dir}`} onPointerDown={onPointerDown} onDoubleClick={() => setWorkspace((ws) => W.resize(ws, split.id, split.sizes.map(() => 1 / split.sizes.length)))} />;
}

function PaneView({ node, edges, activeGroup, alone }: { node: W.PaneNode; edges: Edges; activeGroup: string; alone: boolean }) {
  if (node.kind === 'group') return <GroupView group={node} edges={edges} focused={node.id === activeGroup} alone={alone} />;
  return (
    <div className={`split ${node.dir}`}>
      {node.children.map((child, i) => {
        const last = i === node.children.length - 1;
        const childEdges: Edges = node.dir === 'row' ? { top: edges.top, left: edges.left && i === 0, right: edges.right && last } : { top: edges.top && i === 0, left: edges.left, right: edges.right };
        return (
          <div key={child.id} className="split-cell" style={{ flexBasis: `${(node.sizes[i] ?? 1 / node.children.length) * 100}%` }}>
            <PaneView node={child} edges={childEdges} activeGroup={activeGroup} alone={false} />
            {!last && <Resizer split={node} index={i} />}
          </div>
        );
      })}
    </div>
  );
}

export function Workspace({ rightOpen, leftOpen }: { rightOpen: boolean; leftOpen: boolean }) {
  const ws = useWorkspace();
  const meetings = moduleInfo('meetings');
  return (
    <div className="workspace-root">
      <PaneView node={ws.root} edges={{ top: true, left: !leftOpen, right: !rightOpen }} activeGroup={ws.activeGroup} alone={ws.root.kind === 'group'} />
      {/* Round 4 join with main: meetings tabs render the page directly, never through the registry, so the
          pack's tour host mounts here (no link: the ⋯ menu and the palette open it through openTour). */}
      {meetings && <ModuleTour module={meetings} link={false} />}
    </div>
  );
}
