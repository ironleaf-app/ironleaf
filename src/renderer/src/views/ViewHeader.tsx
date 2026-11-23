// The slim top bar over every tab's page (8.7 wave 1, item 4; the mock-ups' top bar, on the kit; 10.0 Endless Tech: the
// place, the centred search, then the page's own actions and its ⋯ menu; 20 Nov 2026, the avatar left for the side bar's
// foot, the one account door, since one in every pane's header opened Settings and named no account; 3 Nov 2026 polish:
// the bell left the header for the foot, beside the person, as in the former host app; 5 Nov 2026, one search door: the
// Ask button left too — the centred bar's panel asks (Ctrl+J still asks from anywhere)): back and forward through the
// tab's own history, a plus for a new note, the breadcrumb (a file's folders, then its name, bold, clipped to one line
// and never centred). With tabs off (Settings › Appearance › Interface) the bar is the top band of the window: it drags
// the window, leaves room for the window's buttons, and brings back a hidden side.

import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { openMenu, type MenuItem } from '../components/Menu';
import { clearHeaderOverflow, layoutHeaderOverflow } from '../lib/headerOverflow';
import { formatHotkey } from '../lib/hotkeys';
import { inVaultView } from '../lib/inWindow';
import { moduleInfo } from '../../../shared/life-modules';
import { pathParts } from '../../../shared/paths';
import { splitRowPath } from '../../../shared/system-tables';
import { splitBillRow } from '../../../shared/bills-table';
import { isPrivatePath } from '../../../shared/private';
import { openPrivate, revealInExplorer, titleOf } from '../state/actions';
import { rightShown, showSide, toggleSide, useFit } from '../state/fit';
import { placeName } from '../state/tabSync';
import { setWorkspace, useWorkspace } from '../state/layout';
import { openModal } from '../state/modals';
import { openModule } from '../state/modules';
import { moduleOfTab } from '../state/module-tabs';
import { openNewDoor } from '../state/noteTypes';
import * as W from '../state/workspace';

/** The edges of the window a pane's header touches, when the header is the window's top band (tabs off). */
export interface BandEdges {
  top: boolean;
  left: boolean;
  right: boolean;
}
export const PageBand = createContext<BandEdges | null>(null);

interface Props {
  tab: W.TabState;
  title?: string;
  children?: ReactNode;
  menu?: () => MenuItem[];
  /** A crumb the page draws itself (8.7 w4a round 2: Settings, Recently deleted, Earlier versions, Secrets, Private
   *  notes and Import name where they sit — “Settings / Recently deleted” — rather than a file's folders). */
  crumb?: ReactNode;
  /** The page shows its own title below (a note's inline title): the bar keeps the folders only, never the
   *  name twice (t7-note-window, 8 Nov 2026). */
  hideName?: boolean;
}

/** One step of a crumb's trail: a folder or a place, usually a button back to it ('…' stands for folders left out). */
export interface CrumbStep {
  key: string;
  label: ReactNode;
  onClick?: () => void;
  title?: string;
}

/**
 * The crumb's words (23 Nov 2026, nothing cut off): the trail of folders, then the place, bold. When the bar is short of
 * room the farthest folders drop out whole, one by one (fitCrumb, measured with the header's own layout), and only then
 * may the place itself wrap to a second line; never a folder or a name cut through. The whole path stays on the crumb's
 * hover.
 */
/** `here` is the place itself, in a <b> (the bar's one bold word). */
export function Crumbs({ trail, here }: { trail: CrumbStep[]; here?: ReactNode }) {
  return (
    <>
      {trail.length > 0 && (
        <span className="crumb-trail">
          {trail.map((s) => (
            <span key={s.key} className="crumb-step">
              {s.onClick ? (
                <button type="button" className="crumb-folder" onClick={s.onClick} title={s.title}>
                  {s.label}
                </button>
              ) : (
                <span className="crumb-folder" aria-hidden={s.label === '…' ? true : undefined}>{s.label}</span>
              )}
              <span className="crumb-sep" aria-hidden="true">/</span>
            </span>
          ))}
        </span>
      )}
      {here}
    </>
  );
}

/** Fits the crumb to its room: every step back, then the farthest dropped one at a time while the words still run past
 *  the crumb's edge; with every step gone and the place still too long, the place wraps (.is-tight). */
export function fitCrumb(bar: HTMLElement): void {
  const crumb = bar.querySelector<HTMLElement>('.crumb');
  if (!crumb) return;
  const steps = [...crumb.querySelectorAll<HTMLElement>('.crumb-step')];
  crumb.classList.remove('is-tight');
  for (const s of steps) s.classList.remove('is-dropped');
  // A hidden crumb (a narrow bar) measures nothing: it is fitted again when it shows.
  if (!crumb.getClientRects().length) return;
  const over = () => crumb.scrollWidth > crumb.clientWidth + 1;
  for (const s of steps) {
    if (!over()) return;
    s.classList.add('is-dropped');
  }
  if (over()) crumb.classList.add('is-tight');
}

export function ViewHeader({ tab, title, children, menu, crumb, hideName }: Props) {
  const band = useContext(PageBand);
  const fit = useFit();
  const ws = useWorkspace();
  // The header contract (Round 6, 4 Nov 2026, the reviewer: the grid's always-equal sides centre the bar,
  // so nothing can overlap it by construction): lay out after every render (widths move with state: a Due pill,
  // a section switch) and on every resize, so a crowded side yields its buttons into the ⋯ menu (the crumb
  // shortens with … by itself, full text in its title) while the bar keeps its exact centre.
  const barRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (barRef.current) {
      fitCrumb(barRef.current);
      layoutHeaderOverflow(barRef.current, tab.id);
    }
  });
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    let raf = 0;
    // The observer's first fire is the bar as laid out, not a change (t146): forcing on it re-measured
    // every switch after paint and dropped the kept layouts. A resize event carries no entries; the
    // observer's entries array tells its fires apart, so only a later box change forces.
    let roFired = false;
    const relayout = (...from: unknown[]) => {
      if (Array.isArray(from[0])) {
        if (!roFired) {
          roFired = true;
          return;
        }
      }
      cancelAnimationFrame(raf);
      // Forced (t102, 9 Nov 2026): the widths moved but the words did not, so the settled check would skip it.
      raf = requestAnimationFrame(() => {
        fitCrumb(bar);
        layoutHeaderOverflow(bar, tab.id, true);
      });
    };
    window.addEventListener('resize', relayout);
    const ro = 'ResizeObserver' in window ? new ResizeObserver(relayout) : null;
    ro?.observe(bar);
    // ... and fonts already loaded force nothing either (t146): the bar above measured them as they are.
    if (document.fonts?.status === 'loading')
      void document.fonts.ready.then(() => {
        fitCrumb(bar);
        layoutHeaderOverflow(bar, tab.id, true);
      });
    return () => {
      window.removeEventListener('resize', relayout);
      ro?.disconnect();
      cancelAnimationFrame(raf);
      clearHeaderOverflow(tab.id);
    };
  }, [tab.id]);
  const parts = tab.path ? tab.path.split('/') : [];
  let folders = parts.slice(0, -1);
  // A folder's own note (a project's file, Projects/Harbour/Harbour.md) shows its folder once.
  if (folders.length && folders[folders.length - 1] === parts[parts.length - 1].replace(/\.md$/i, '')) folders = folders.slice(0, -1);
  // Polish round 4: at most the last two parts, each whole, with the ellipsis only at the start.
  const shownParts = pathParts(folders);
  const firstShown = folders.length - (shownParts[0] === '…' ? shownParts.length - 1 : shownParts.length);
  const top = !!band?.top;
  // Polish round 1 (ITEMS 7): the bar never repeats the page's title. Pages with their own PageHead (Inbox, People,
  // modules and the rest) draw that title below; this bar keeps only a file's folders, quietly.
  const repeatsTitle = !tab.path || /^(type:|module:|people:|person:|area:|records:|notebook:)/.test(tab.path) || ['today', 'home', 'projects', 'templates', 'bin', 'private', 'assets', 'review', 'timeline', 'tasks', 'type', 'inbox', 'people', 'module', 'meetings', 'empty'].includes(tab.type);
  const name = title ?? (tab.path ? titleOf(tab.path) : '');
  // A pack's pages (8.7 round 2, the mock-ups' top bar): Packs / <pack> on an overview, Packs / <pack> / <record> on a
  // record's own page (its own back link above the title is gone).
  const mod = tab.type === 'module' ? moduleOfTab(tab) : null;
  const info = mod ? moduleInfo(mod) : null;
  const part = tab.path && tab.path.includes('#') ? tab.path.slice(tab.path.indexOf('#') + 1) : '';
  const packDetail = (() => {
    if (!info) return null;
    if (!part || part === 'overview' || part === 'classic' || part.startsWith('classic:')) return null;
    if (part === 'checkin') return "Today's check-in";
    if (part === 'draft') return 'Draft from projects';
    if (part === 'review') return 'Weekly look-back';
    const m = /^([a-z]+):(.+)$/.exec(part);
    if (!m) return null;
    try {
      // A label after the key names the record (a Systems list row's path is not its name).
      const at = m[2].indexOf(':');
      if (at >= 0) {
        const label = decodeURIComponent(m[2].slice(at + 1));
        if (label) return label;
      }
      const key = at < 0 ? m[2] : m[2].slice(0, at);
      const row = splitRowPath(decodeURIComponent(key));
      if (row) return row.slug.split('-').join(' ');
      const bill = splitBillRow(decodeURIComponent(key));
      if (bill) return bill.slug.split('-').join(' ');
      return titleOf(decodeURIComponent(key)) || null;
    } catch {
      return null;
    }
  })();
  const crumbNode = crumb ?? (info ? (
    <Crumbs
      trail={[
        { key: 'packs', label: 'Packs', onClick: () => openModal({ kind: 'settings', section: 'modules' }) },
        ...(packDetail ? [{ key: 'pack', label: info.name, onClick: () => openModule(mod!) }] : []),
      ]}
      here={<b>{packDetail ?? info.name}</b>}
    />
  ) : (
    <Crumbs
      trail={shownParts.map((f, i) =>
        f === '…'
          ? { key: 'ellipsis', label: '…' }
          : {
              key: `${firstShown}-${i}`,
              label: f,
              onClick: () => (isPrivatePath(folders[0]) ? openPrivate() : revealInExplorer(folders.slice(0, firstShown + (shownParts[0] === '…' ? i : i + 1)).join('/'))),
            },
      )}
      here={!repeatsTitle && !hideName && <b>{name}</b>}
    />
  ));
  // In the former host app's window (one window, 9 Nov 2026: two searches and two account
  // circles on screen): Vault's header goes — back, forward, +, the centred search, the panel toggle and
  // the avatar live with the one strip, the one Search and the side bar foot. The page's own row (its
  // folders, actions, menu) stays, so nothing the page does is lost; a page with no row of its own draws
  // nothing at all.
  if (inVaultView()) {
    const childList = Array.isArray(children) ? children : [children];
    const hasChildren = childList.some((c) => c !== undefined && c !== null && c !== false);
    const hasPageRow = hasChildren || menu != null || crumb != null || (!repeatsTitle && (shownParts.length > 0 || (!hideName && name !== '')));
    if (!hasPageRow) return null;
    // A page's own row names the page (one window, 9 Nov 2026: Today's row held only Start from a template,
    // alone at the right — and Projects', Tasks' and the Inbox's rows stood as bare). A file keeps its crumb;
    // a place with no crumb of its own reads its name, like the other pages' rows do.
    const crumbless = crumb == null && !info && shownParts.length === 0 && (repeatsTitle || hideName || name === '');
    const pageName = crumbless ? (title || placeName(tab.type)) : undefined;
    return (
      <div ref={barRef} className="topbar topbar-page">
        <div className="topbar-left">
          <div className="crumb" title={tab.path}>
            {pageName ? <b>{pageName}</b> : crumbNode}
          </div>
        </div>
        <div className="right">
          {children}
          {menu && (
            <button className="navbtn" title="More" aria-label="More" onClick={(e) => openMenu(e.currentTarget, menu())}>
              <Icon name="more" size={16} />
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div ref={barRef} className={`topbar${top ? ' drag is-band' : ''}${top && band?.right ? ' controls-gap' : ''}${top && band?.left ? ' controls-gap-left' : ''}`}>
      {/* The grid's left cell (Round 6: the way back and the crumb, one cell of two always-equal sides, so the middle stays exactly centred; the crumb shortens with … by itself, full text in its title). */}
      <div className="topbar-left">
      <div className="view-nav">
        {top && band?.left && fit.left !== 'docked' && (
          <button className="navbtn" title="Show the left side" aria-label="Show the left side" onClick={() => toggleSide('left')}>
            <Icon name="sidebarLeft" size={16} />
          </button>
        )}
        <button className="navbtn" title="Back" aria-label="Back" disabled={!tab.back.length} onClick={() => setWorkspace((w) => W.navigate(w, tab.id, -1))}>
          ←
        </button>
        <button className="navbtn" title="Forward" aria-label="Forward" disabled={!tab.forward.length} onClick={() => setWorkspace((w) => W.navigate(w, tab.id, 1))}>
          →
        </button>
        <button className="navbtn" title="New" aria-label="New" onClick={(e) => openNewDoor(e.currentTarget)}>
          +
        </button>
      </div>
      <div className="crumb" title={tab.path}>
        {crumbNode}
      </div>
      </div>
      {/* One writing for the keys (3 Nov 2026, fourth-round G4): the chip and its tooltip both read the shared formatter, like the Keys catalogue, so the button never contradicts its own tooltip. Both keys open this panel (5 Nov 2026, one search door). */}
      <button className="top-search" title={`Commands, pages and search (${formatHotkey('Mod+K')} or ${formatHotkey('Mod+O')})`} aria-label="Commands, pages and search" onClick={() => openModal({ kind: 'palette' })}>
        <Icon name="search" size={16} />
        <span className="clip">Ask or find anything</span>
        <kbd>{formatHotkey('Mod+K')}</kbd>
      </button>
      <div className="right">
        {children}
        {menu && (
          <button className="navbtn" title="More" aria-label="More" onClick={(e) => openMenu(e.currentTarget, menu())}>
            <Icon name="more" size={16} />
          </button>
        )}
        {top && band?.right && rightShown(ws) === 'hidden' && (
          <button className="navbtn" title="Show the right side" aria-label="Show the right side" onClick={() => showSide('right')}>
            <Icon name="sidebarRight" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
