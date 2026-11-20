// The two sides of the window. Left: the calm list (Today, Search, your notes by kind, More; panels/Places.tsx), or one
// of its panels with Back to it: Files (the folder tree and the sections) and search. Bookmarks live on their own page.
// Right: on a note, chat first, then this note's outline, its connections and its links and dates, stacked in that
// order (t7-note-window, 8 Nov 2026), never tabbed; off a note, the chat alone, which works anywhere. The links and
// dates stack holds what goes out of the note and its tags and dates; what links here lives once, at the foot
// (t22-note-once, 8 Nov 2026). Each side resizes from its inner edge; its top band drags the window like the rest of
// the top.

import { useEffect, useRef } from 'react';
import { drawerWidth, maxDockedWidth, SIDE_LIMITS, type Side } from '../../../shared/layout-fit';
import { Icon, type IconName } from '../components/Icon';
import { LinksPanel } from '../components/LinksPanel';
import * as A from '../state/actions';
import { editorFor, setWorkspace, useWorkspace } from '../state/layout';
import { panelForRightTab, rightTabOf, type RightTab } from '../../../shared/layout-fit';
import { closeDrawer, fitInput, hideSide } from '../state/fit';
import { useApp } from '../state/store';
import { activeTab, type LeftPanel, type RightPanel } from '../state/workspace';
import { ChatPanel } from './ChatPanel';
import { FileExplorer } from './FileExplorer';
import { LocalGraphPanel, OutgoingPanel, OutlinePanel, TagsDates, useNoteHasGraphLinks, useNoteText } from './NotePanels';
import { SearchPanel } from './SearchPanel';
import { Places, PlacesFoot, Rail } from './Places';

// Bookmarks are a page, never a side panel (9.2 uplift F105: the panel file and its entries are gone).
const LEFT: { id: LeftPanel; icon: IconName; label: string }[] = [
  { id: 'home', icon: 'vault', label: 'Your notes' },
  { id: 'files', icon: 'files', label: 'Files' },
  { id: 'search', icon: 'search', label: 'Search' },
];



function Resizer({ side, start, drawer }: { side: Side; start: number; drawer: boolean }) {
  return (
    <div
      className={`side-resizer ${side}`}
      title="Drag to resize; double-click for the usual width"
      onPointerDown={(e) => {
        e.preventDefault();
        const handle = e.currentTarget;
        handle.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        // The middle keeps its readable width beside a docked side; a drawer never covers the whole window.
        const input = fitInput();
        const most = drawer ? drawerWidth(side, SIDE_LIMITS[side].max, input.width) : maxDockedWidth(side, input);
        const least = Math.min(SIDE_LIMITS[side].min, most);
        document.body.classList.add('is-resizing-x');
        const move = (ev: PointerEvent) => {
          const delta = ev.clientX - startX;
          const width = Math.round(Math.min(most, Math.max(least, side === 'left' ? start + delta : start - delta)));
          setWorkspace((ws) => (side === 'left' ? { ...ws, left: { ...ws.left, width } } : { ...ws, right: { ...ws.right, width } }));
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          document.body.classList.remove('is-resizing-x');
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
      }}
      onDoubleClick={() => setWorkspace((ws) => (side === 'left' ? { ...ws, left: { ...ws.left, width: SIDE_LIMITS.left.default } } : { ...ws, right: { ...ws.right, width: SIDE_LIMITS.right.default } }))}
    />
  );
}

/** A side shown over the middle closes with Escape (after any menu or window on top of it). */
function useDrawerEscape(drawer: boolean) {
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.overlay, .menu, .dialog, .picker')) return;
      closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);
}

export function LeftSidebar({ width, drawer = false }: { width: number; drawer?: boolean }) {
  const ws = useWorkspace();
  const vault = useApp((s) => s.vault);
  useDrawerEscape(drawer);
  const panel = ws.left.panel;
  const label = LEFT.find((t) => t.id === panel)?.label;
  // Folded to the icon rail (8.7 wave 1): the same places as icons, never resized.
  const rail = !!ws.left.rail && panel === 'home';
  // Another folder of notes open (not the vault): the way back to the vault stays in sight, whichever panel shows.
  const away = vault && vault.library === false && (
    <button className="side-title-action" title={vault.path} onClick={() => void window.nv.vault.library()}>
      {vault.name} · Back to your notes
    </button>
  );
  if (rail) {
    return (
      <aside className={`sidebar left rail${drawer ? ' is-drawer' : ''}`} style={{ width }} aria-label="Places">
        <Rail />
      </aside>
    );
  }
  // The switch sits under the name (3 Nov 2026, audit f F8 and SHARED-LAYOUT: the former host app draws
  // wordmark first, switch second; the Vault drew them the other way). On the home panel Places draws brand
  // then switch; other panels keep the switch on top, where there is no brand row.
  return (
    <aside className={`sidebar left${drawer ? ' is-drawer' : ''}${panel === 'home' ? ' side' : ' places-side'}`} style={{ width }} aria-label="Places and notes">
      {panel === 'home' ? (
        <>
          <Places drawer={drawer} />
          <PlacesFoot />
        </>
      ) : (
        <>
          <div className="side-title">
            <button className="side-title-back" onClick={() => setWorkspace((w) => ({ ...w, left: { ...w.left, panel: 'home' } }))} title="Back to Today, Inbox and Projects">
              <Icon name="back" size={13} />
              <span>{label}</span>
            </button>
            {away}
          </div>
          <div className="side-body">
            {panel === 'files' && <FileExplorer />}
            {panel === 'search' && <SearchPanel />}
          </div>
          <PlacesFoot />
        </>
      )}
      <Resizer side="left" start={width} drawer={drawer} />
    </aside>
  );
}

/** Which stack of the Note tab a saved panel opens on (every note panel command still lands on its stack). */
const stackOf = (panel: string): string => (panel === 'outline' ? 'outline' : panel === 'local-graph' ? 'graph' : 'links');

export function RightSidebar({ width, drawer = false }: { width: number; drawer?: boolean }) {
  const ws = useWorkspace();
  const settings = useApp((s) => s.settings);
  const revision = useApp((s) => s.revision);
  useDrawerEscape(drawer);
  const tab = activeTab(ws);
  const panel = ws.right.panel;
  const notePath = tab.type === 'note' ? tab.path : undefined;
  const shown = rightTabOf(panel, !!notePath);
  const hasGraph = useNoteHasGraphLinks(shown === 'note' ? notePath : undefined);
  const liveText = useNoteText(shown === 'note' && panel === 'autolink' ? notePath : undefined);
  const body = useRef<HTMLDivElement>(null);
  // The note panel last on show, so the Note tab comes back where it was left (the saved panel keeps the tab itself).
  const lastNotePanel = useRef<RightPanel>(panel === 'chat' ? 'outline' : panel);
  if (panel !== 'chat') lastNotePanel.current = panel;
  const showTab = (next: RightTab) => setWorkspace((w) => ({ ...w, right: { ...w.right, panel: panelForRightTab(next, lastNotePanel.current) as RightPanel } }));
  // Every note panel command lands on its stack (the saved panel is which stack comes into view).
  const prev = useRef(panel);
  useEffect(() => {
    if (prev.current === panel) return;
    prev.current = panel;
    if (panel !== 'chat') body.current?.querySelector(`[data-stack="${stackOf(panel)}"]`)?.scrollIntoView({ block: 'start' });
  }, [panel]);
  // A newly opened note starts at its outline, never halfway down the last note's links.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [notePath]);
  const label = notePath ? A.titleOf(notePath) : 'Chat';
  const tabs: { id: RightTab; label: string; title: string; disabled?: boolean }[] = [
    { id: 'chat', label: 'Chat', title: 'Chat with your notes' },
    { id: 'note', label: 'Note', title: notePath ? `Outline, connections and links for ${label}` : 'Open a note to see its outline and links', disabled: !notePath },
  ];
  return (
    <aside className={`sidebar right${drawer ? ' is-drawer' : ''}`} style={{ width }} aria-label={shown === 'chat' ? 'Chat with your notes' : `Outline and links for ${label}`}>
      <div className={`side-band drag${drawer ? '' : ' controls-gap'}`}>
        <button className="side-toggle" title={drawer ? 'Close (Esc)' : 'Hide the right side'} onClick={() => hideSide('right')}>
          <Icon name="sidebarRight" size={16} />
        </button>
        <div className="rside-tabs" role="tablist" aria-label="Right side">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={`side-tab-${t.id}`} aria-selected={shown === t.id} aria-controls={`side-tabpanel-${t.id}`} className={`rside-tab${shown === t.id ? ' is-on' : ''}`} title={t.title} disabled={t.disabled} onClick={() => showTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {/* Chat: the whole column, nothing about the note around it. It stays mounted behind the Note tab, so a
          half-typed question and the place in the conversation are there on the way back. */}
      <div className="side-body side-tabpanel-chat" data-stack="chat" role="tabpanel" id="side-tabpanel-chat" aria-labelledby="side-tab-chat" hidden={shown !== 'chat'}>
        <ChatPanel tab={tab} />
      </div>
      {shown === 'note' && notePath && (
        <div className="side-body is-stacks" role="tabpanel" id="side-tabpanel-note" aria-labelledby="side-tab-note" ref={body}>
          <section className="side-stack side-stack-outline" data-stack="outline" aria-label="Outline">
            <h2 className="side-stack-head">Outline</h2>
            <OutlinePanel tab={tab} />
          </section>
          {hasGraph && (
            <section className="side-stack" data-stack="graph" aria-label="Connections">
              <h2 className="side-stack-head">Connections</h2>
              <LocalGraphPanel tab={tab} />
            </section>
          )}
          <section className="side-stack" data-stack="links" aria-label="Links and dates">
            <h2 className="side-stack-head">Links and dates</h2>
            <OutgoingPanel tab={tab} />
            {panel === 'autolink' ? (
              <LinksPanel path={notePath} liveText={liveText} revision={revision} editor={() => editorFor(tab.id)} aiNote={settings && !settings.ai.ready ? (settings.ai.note ?? '') : null} onOpen={(p) => A.openPath(p)} />
            ) : (
              <button className="side-suggest" onClick={() => setWorkspace((w) => ({ ...w, right: { ...w.right, panel: 'autolink' } }))} title="Suggest links for this note">
                See suggested links
              </button>
            )}
            <TagsDates path={notePath} />
          </section>
        </div>
      )}
      <Resizer side="right" start={width} drawer={drawer} />
    </aside>
  );
}
