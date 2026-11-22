// Ironleaf's window: the left side (the calm list, or files, search and bookmarks), the tabs and panes in the middle
// (or one page at a time, with tabs off), the right side (links, outline, tags, connections, chat, suggested links), the
// status line when it's switched on, and the windows that open over it. Keys run the commands in state/commands.ts; the look follows Settings › Appearance.

import { PeekHost } from './components/Peek';
import { ImportsStrip } from './components/ImportsStrip';
import { ReviewCards } from './components/ReviewCards';
import { StarterPicker } from './components/StarterPicker';
import { PublishDialog } from './components/PublishDialog';
import { DesignDialog } from './components/DesignDialog';
import { RecordingPill } from './components/RecordingPill';
import { LEAF_ACCENT, LEAF_ACCENT_DARK, shows } from '../../shared/prefs';
import { frontMatterRange } from '../../shared/frontmatter';
import { setLineBreaks } from './lib/markdownRender';
import { SETTINGS_REVEAL } from './lib/settingsSearch';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DialogHost } from './components/Dialogs';
import { FormulaEditorHost } from './views/saved/FormulaEditor';
import { RollupEditorHost } from './views/saved/RollupEditor';
import { RecordFormulaEditorHost } from './views/workspace/RecordFormulaEditor';
import { RecordRollupEditorHost } from './views/workspace/RecordRollupEditor';
import { FormDialogHost } from './views/saved/FormDialog';
import { AssetPickerHost } from './views/assets/AssetPicker';
import { EditMenuHost } from './components/EditMenu';
import { SlidesModal } from './components/Extras';
import { HoverHost, closeHover } from './components/HoverPreview';
import { Icon } from './components/Icon';
import { MenuHost } from './components/Menu';
import { CommandPalette, QuickSwitcher, Welcome } from './components/Modals';
import { LockNotice } from './views/LockNotice';
import type { VaultLockView } from '../../shared/types';
import { SearchModal } from './components/SearchModal';
import { PickerHost, cancelPick } from './components/Pickers';
import { loadNoteTypes } from './state/noteTypes';
import { closePeek, usePeek } from './state/peek';
import { measureBandHeight, updateWindowButtons, watchWindowButtons } from './lib/windowButtons';
import { FileHitViewerHost } from './components/FileHits';
import { errorMessage } from './lib/errors';
import { matchHotkey } from './lib/hotkeys';
import { LeftSidebar, RightSidebar } from './panels/Sidebars';
import * as A from './state/actions';
import { bookmarksRenamed, loadBookmarks } from './state/bookmarks';
import { noteMoved } from './state/noteEvents';
import { moveProjectMemory } from './views/project/memory';
import { alsoKeys, available, COMMANDS, commandContext, hotkeyOf } from './state/commands';
import { chatLibrary } from './state/chat';
import { setSplitFocus } from './state/splitFocus';
import { startSuggestions } from './state/suggestions';
import { docs, useSaveState } from './state/docs';
import { looseSaves } from './state/looseSaves';
import { useSavedFlash } from './state/saveNotice';
import { loadGraphSettings } from './state/graph';
import { closeDrawer, rightShown, useFit } from './state/fit';
import { goToNoteFoot } from './components/NoteFoot';
import { loadWorkspace, saveWorkspaceNow, setWorkspace, useWorkspace } from './state/layout';
import { closeModal, modalChangeCancelsPick, openModal, requestSearch, useModal, type Modal } from './state/modals';
import { useLeaving } from './lib/useLeaving';
import { LifeHost } from './components/LifeHost';
import { closeToast, getState, holdToast, loadFiles, loadNotes, loadNotesFast, loadSettings, setState, showError, toast, useApp, usePrefs } from './state/store';
import * as W from './state/workspace';
import { NewProjectDialog } from './components/NewProjectDialog';
import { MoveVaultDialog } from './components/VaultPlace';
import { NamesDialog } from './components/NamesDialog';
import { Workspace, tabTitle } from './views/Workspace';
import { inVaultView } from './lib/inWindow';
import { tabSyncEqual, tabSyncGroup, tabSyncReport } from './state/tabSync';
import './styles/app-shell.css';
import type { VaultInfo } from '../../shared/types';


const api = window.nv;

/** A colour as #rrggbb; a see-through one (a band with no colour of its own) is none. */
function hex(color: string): string | null {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(color);
  if (m) return m[4] !== undefined && Number(m[4]) < 0.5 ? null : '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
  return /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : null;
}

/** The colour a person sees at a point of the window: the first solid background from what is there outwards. */
function colourAt(x: number, y: number): string | null {
  for (let el = document.elementFromPoint(x, y) as HTMLElement | null; el; el = el.parentElement) {
    const colour = hex(getComputedStyle(el).backgroundColor);
    if (colour) return colour;
  }
  return null;
}

/**
 * The window buttons Windows draws at the top right take the colours of what is under them (the right side panel's band
 * or the tab strip). 16 Oct 2026: the band has no colour of its own, and its see-through colour was read as black.
 */
function tintWindowButtons(): void {
  const style = getComputedStyle(document.documentElement);
  const dark = document.documentElement.dataset.theme === 'dark';
  const background = colourAt(window.innerWidth - 70, 12) ?? hex(style.getPropertyValue('--bg-side')) ?? (dark ? '#0f1526' : '#f2f4f7');
  const symbols = hex(style.getPropertyValue('--text-muted')) ?? (dark ? '#a9aec2' : '#565e70');
  // As tall as the band under the buttons (26 Oct 2026): at another interface size the band is taller or shorter than
  // Windows' fixed one, which hung over the line below it. The same measurement the band variables keep (8.6.1), so
  // the buttons and the page agree on where the band ends.
  const height = measureBandHeight();
  void api.window.chrome({ background, symbols, height }).catch(() => {});
}

function StatusBar() {
  const ws = useWorkspace();
  const tab = W.activeTab(ws);
  const byPath = useApp((s) => s.byPath);
  const save = useSaveState(tab.type === 'note' || tab.type === 'canvas' || tab.type === 'view' ? tab.path : undefined);
  const prefsNow = usePrefs();
  const [counts, setCounts] = useState<{ words: number; chars: number } | null>(null);
  const [backlinks, setBacklinks] = useState<number | null>(null);
  const revision = useApp((s) => s.revision);
  useEffect(() => {
    if (tab.type !== 'note' || !tab.path) {
      setCounts(null);
      return;
    }
    const path = tab.path;
    setCounts(null);
    const measure = () => {
      const text = docs.text(path);
      if (text === undefined) return;
      const range = frontMatterRange(text);
      const body = range ? text.slice(range.to) : text;
      setCounts({ words: (body.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []).length, chars: body.replace(/\s/g, '').length });
    };
    // Counted only while shown (t102, 9 Nov 2026): the bar is off by default, and counting a long note's
    // words every frame cost each keystroke for numbers nobody saw. Coalesced while on: the count follows
    // within a frame instead of mid-stroke.
    const update = () => {
      if (!prefsNow.statusLine) {
        setCounts((c) => (c === null ? c : null));
        return;
      }
      measure();
    };
    update();
    let frame = 0;
    const off = docs.subscribe(path, () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    });
    const t = setInterval(update, 1500);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      off();
      clearInterval(t);
    };
  }, [tab.type, tab.path, prefsNow.statusLine]);
  useEffect(() => {
    if (tab.type !== 'note' || !tab.path) return setBacklinks(null);
    let alive = true;
    void api.index.backlinks(tab.path).then((b) => alive && setBacklinks(new Set(b.map((x) => x.source)).size));
    return () => {
      alive = false;
    };
  }, [tab.type, tab.path, revision]);
  const meta = tab.path ? byPath.get(tab.path) : undefined;
  // Off by default (Ironleaf Calm, 20 Oct 2026; Settings › Appearance › Interface › Status line).
  if (!prefsNow.statusLine) return null;
  return (
    <footer className="statusbar">
      <span className="statusbar-spacer" />
      {backlinks !== null && shows(prefsNow, 'status:backlinks') && (
        <button className="status-item status-backlinks" title="Links to this note" onClick={() => goToNoteFoot()}>
          {backlinks} {backlinks === 1 ? 'note links here' : 'notes link here'}
        </button>
      )}
      {meta && meta.tags.length > 0 && shows(prefsNow, 'status:tags') && <span className="status-item status-tags">{meta.tags.length} {meta.tags.length === 1 ? 'tag' : 'tags'}</span>}
      {counts && shows(prefsNow, 'status:words') && (
        <span className="status-item status-words" title={`${counts.words === 1 ? '1 word' : `${counts.words.toLocaleString('en-AU')} words`} · ${counts.chars === 1 ? '1 character' : `${counts.chars.toLocaleString('en-AU')} characters`}`}>
          {counts.words.toLocaleString('en-AU')} {counts.words === 1 ? 'word' : 'words'}
          <span className="status-chars"> · {counts.chars === 1 ? '1 character' : `${counts.chars.toLocaleString('en-AU')} characters`}</span>
        </span>
      )}
      {(tab.type === 'note' || tab.type === 'canvas' || tab.type === 'view') && shows(prefsNow, 'status:saved') && <span className={`status-item save-${save}`}>{save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : save === 'conflict' ? 'Two copies' : 'Not saved'}</span>}
    </footer>
  );
}

/**
 * Saving, quietly (Ironleaf Calm, 20 Oct 2026): with the status line off, "Not saved" stays in the bottom corner while
 * the open file's save is failing, and "Saved" shows a moment after Ctrl+S. Nothing shows while all is well.
 */
function SaveCorner() {
  const ws = useWorkspace();
  const prefsNow = usePrefs();
  const tab = W.activeTab(ws);
  const save = useSaveState(tab.type === 'note' || tab.type === 'canvas' || tab.type === 'view' ? tab.path : undefined);
  const flashed = useSavedFlash();
  if (prefsNow.statusLine && shows(prefsNow, 'status:saved')) return null;
  if (save === 'error') return <div className="save-corner is-error" role="alert">Not saved</div>;
  if (save === 'conflict') return <div className="save-corner is-error" role="alert">Two copies</div>;
  if (flashed) return <div className="save-corner" role="status">Saved</div>;
  return null;
}

/** The full-window modals with one shared exit (5 Nov 2026 feel-motion: a closing modal vanished in one frame while
 * every modal arrives softly): the closing one is held for its 120ms fade. Switching from one modal to another never
 * fades. The wrapper is an unstyled box (its children are fixed overlays); the exit runs on them (kit.css). */
function ModalLayer({ modal }: { modal: Modal }) {
  const held = useLeaving(modal);
  const m = held.value;
  if (!m) return null;
  return (
    <div className="nv-leave-wrap" data-nv-leaving={held.leaving ? 'true' : undefined} inert={held.leaving}>
      {m.kind === 'switcher' && <QuickSwitcher onClose={closeModal} />}
      {m.kind === 'palette' && <CommandPalette onClose={closeModal} />}
      {m.kind === 'search' && <SearchModal query={m.query ?? ''} />}
      {m.kind === 'slides' && <SlidesModal path={m.path} onClose={closeModal} />}
      {m.kind === 'new-project' && <NewProjectDialog template={m.template} onClose={closeModal} />}
      {m.kind === 'review-cards' && <ReviewCards path={m.path} onClose={closeModal} />}
      {m.kind === 'starter-picker' && <StarterPicker template={m.template} onClose={closeModal} />}
      {m.kind === 'publish' && <PublishDialog siteId={m.siteId} source={m.source} onClose={closeModal} />}
      {m.kind === 'move-vault' && <MoveVaultDialog onClose={() => (m.from === 'settings' ? openModal({ kind: 'settings', section: 'files' }) : closeModal())} />}
      {m.kind === 'names' && <NamesDialog onClose={closeModal} />}
      {m.kind === 'design' && <DesignDialog path={m.path} onClose={closeModal} />}
    </div>
  );
}

export function App() {
  const [booting, setBooting] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [lock, setLock] = useState<VaultLockView>({ mode: 'write', words: null, otherApp: null });
  const [lockQuiet, setLockQuiet] = useState(false);
  const vault = useApp((s) => s.vault);
  const settings = useApp((s) => s.settings);
  const toastState = useApp((s) => s.toast);
  const prefs = usePrefs();
  const fit = useFit();
  const modal = useModal();
  const wsNow = useWorkspace();
  const pageNow = W.activeTab(wsNow);
  // In the former host app's window (one product step 2): no Places bar or switch, only tabs and pages. The
  // address never changes after load, so this reads once.
  const frameless = useRef(inVaultView()).current;
  // The window title follows the showing page (one product step 2): in the former host app's window the
  // view names the former host app.
  useEffect(() => {
    try { document.title = `${tabTitle(pageNow)} · Ironleaf`; } catch { /* the window keeps its title */ }
  }, [pageNow.id, pageNow.type, pageNow.path, frameless]);
  // One strip (one product, 9 Nov 2026): the view reports its tabs for the one above — opening, closing, active.
  // The window reports nothing and keeps its own strip. Only what changed crosses, so the strip never flickers.
  const byPathNow = useApp((s) => s.byPath);
  const lastTabs = useRef<{ tabs: { id: string; title: string }[]; active: string | null } | null>(null);
  useEffect(() => {
    if (!frameless) return;
    const report = tabSyncReport(wsNow, (tab) => {
      const plain = tabTitle(tab);
      const shown = tab.path && tab.type !== 'media' ? byPathNow.get(tab.path)?.title : undefined;
      return tab.path && tab.type !== 'media' && shown && plain === A.titleOf(tab.path) ? shown : plain;
    });
    if (lastTabs.current && tabSyncEqual(lastTabs.current, report)) return;
    lastTabs.current = report;
    void api.tabs.report(report).catch(() => undefined);
  }, [wsNow, byPathNow, frameless]);
  // The right side as drawn (8.6): shut when its panel has nothing to show off a note; the saved choice stays, so it
  // comes back on a note.
  const right = rightShown(wsNow);
  // A picker belongs to the page that opened it (sweep 058 on): changing page cancels it instead of leaving it
  // floating over the next page. Its promise settles as a cancel, so the flow that opened it simply stops.
  // The peek belongs to its page the same way (p14-words, 4 Nov 2026): moving to another page closes it instead
  // of leaving the old page's item beside the new one. The chat panel's rule, applied to content that cannot
  // follow: the chat stays beside every page because its page-bound scope re-derives from the live tab
  // (ChatPanel's note), never showing a stale page; the peek's item has no such re-derivation, so it closes.
  useEffect(() => {
    cancelPick();
    closePeek();
    closeHover();
  }, [pageNow.id, pageNow.type, pageNow.path]);
  // Opening a window over the page cancels a pick too — but closing one never does (8.9 w114pdf round 2: the
  // palette closes before its command's picker opens, so cancelling on the close killed the picker's first show).
  const lastModalKind = useRef<string | null>(null);
  useEffect(() => {
    const kind = modal?.kind ?? null;
    const was = lastModalKind.current;
    lastModalKind.current = kind;
    if (modalChangeCancelsPick(was, kind)) cancelPick();
  }, [modal?.kind]);
  // Settings and Earlier versions are pages in the frame (8.7 w4a round 2): every caller that asks for them as a
  // window lands on the page instead, at the group or note asked for. In the former host app's window (one product
  // step 4) a Settings ask opens the one Settings (the former host app's) at the section instead — A.openSettings
  // already routes it there.
  useEffect(() => {
    if (modal?.kind === 'settings') {
      const { section, row } = modal;
      closeModal();
      A.openSettings(section, 'current', row);
    } else if (modal?.kind === 'recovery') {
      const path = modal.path;
      closeModal();
      A.openVersions(path);
    }
  }, [modal]);

  // Navigation arriving while the vault loads (one window, 9 Nov 2026: Today/Graph clicks stayed
  // on People): the reload from the saved layout lands after the place, so the place is lost. What arrives
  // mid-load waits and lands once the notes are there, in the order it came.
  const vaultLoading = useRef(0);
  const pendingNav = useRef<Array<() => void>>([]);
  // Opening the notes: the vault and its lock.
  const openLibraryRef = useRef<(info: VaultInfo | null) => Promise<void>>(async () => {});
  const bootVault = useCallback(async () => {
    const info = await api.vault.current();
    if (info) await openLibraryRef.current(info);
  }, []);
  const openLibrary = useCallback(async (info: VaultInfo | null) => {
    vaultLoading.current++;
    try {
      await docs.reset();
      setState({ vault: info });
      // The same notes again (the window opened again): their conversation stays; other notes start a new one.
      chatLibrary(info?.path ?? null);
      if (!info) return;
      await Promise.all([loadNotesFast(), loadFiles(), loadWorkspace(), loadBookmarks(), loadGraphSettings(), loadNoteTypes()]);
      // Who writes now (one vault, one writer): the notice shows while the other app holds it.
      setLockQuiet(false);
      void api.vaultLock
        .status()
        .then((view) => view && setLock(view))
        .catch(() => {});
      const known = new Set(getState().files.map((f) => f.rel));
      setWorkspace((w) => W.removed(w, (p) => known.has(p)));
    } finally {
      if (--vaultLoading.current <= 0) {
        vaultLoading.current = 0;
        const queue = pendingNav.current;
        pendingNav.current = [];
        for (const run of queue) {
          try {
            run();
          } catch {
            // A stale navigation lands nowhere.
          }
        }
      }
    }
  }, []);
  openLibraryRef.current = openLibrary;
  const deferNav = useCallback((run: () => void) => {
    if (vaultLoading.current > 0) pendingNav.current.push(run);
    else run();
  }, []);

  // Start: settings, then the notes.
  useEffect(() => {
    // The assistant's suggested changes waiting in notes follow from the start (state/suggestions.ts).
    startSuggestions();
    void (async () => {
      try {
        await loadSettings();
        await bootVault();
      } catch (err) {
        setFailed(errorMessage(err));
      } finally {
        setBooting(false);
      }
    })();
    let changed = new Set<string>();
    let changedTimer: ReturnType<typeof setTimeout> | undefined;
    const offOpened = api.on.vaultOpened((info) => void openLibrary(info));
    // The vault's writer changed (the other app opened or closed it): the notice follows.
    const offLock = api.on.vaultLockChanged((view) => {
      if (view) setLock(view);
      setLockQuiet(false);
    });
    const offChanged = api.on.vaultChanged(({ paths, moves }) => {
      for (const p of paths) changed.add(p);
      // Moves the window did not start (a repair, a tidy, an agent): open documents, tabs, bookmarks and the
      // recorder follow them at once, with unsaved words kept — before the file list re-reads and strands them.
      if (moves?.length) {
        void (async () => {
          for (const [from, to] of moves) {
            await docs.renamed(from, to);
            setWorkspace((w) => W.renamed(w, from, to));
            bookmarksRenamed(from, to);
            noteMoved(from, to);
            // A renamed project keeps its remembered tab (t266 break job: renaming from the Projects home
            // orphaned the memory under the old path, so reopening forgot the tab; the page's own renames
            // already move it through applyResult).
            moveProjectMemory(from, to);
          }
        })();
      }
      clearTimeout(changedTimer);
      changedTimer = setTimeout(() => {
        const batch = [...changed];
        changed = new Set();
        void loadNotes();
        void docs.changedOnDisk(batch);
      }, 120);
    });
    const offFiles = api.on.filesChanged(() => {
      void loadFiles().then(() => {
        const known = new Set(getState().files.map((f) => f.rel));
        // Tabs with words only the window holds stay open when their file goes missing elsewhere (F3): their banner
        // keeps the words with Bring back or Discard, instead of the tab silently emptying and recreating the file.
        for (const p of docs.stranded(known)) docs.markMissing(p);
        setWorkspace((w) => W.removed(w, (p) => known.has(p) || docs.hasUnsaved(p)));
      });
    });
    // The former host app's Open in Ironleaf: this note, in front.
    const offShow = api.on.noteShow((p) => deferNav(() => A.openPath(p, { reuse: true })));
    // A reminder's Windows notification: its note, at its line.
    const offReveal = api.on.noteReveal((w) => deferNav(() => A.openAtLine(w.path, w.line)));
    // A deep link from the former host app's side bar (one product step 2): the place, already filtered when it is
    // Notes in a folder. Step 3 carries a new note through the same seam.
    const offPlace = api.on.vaultOpenPlace((t) => deferNav(() => A.openPlace(t.place, t.folder || '', 'current', t.newNote === true)));
    // A Settings section from the one Settings (one product step 4): Vault's own page for a whole sub-screen, as a
    // tab in the view — openSettingsTab, never openSettings, which would ask for the former host app's Settings
    // back.
    const offVaultSettings = api.on.vaultOpenSettings((t) => deferNav(() => A.openSettingsTab(t.section, 'current', t.row)));
    // Whether the former host app's window split its main area and which side has focus (one product step 5
    // part 3): the chat panel re-scopes from it at once. The window never hears it, so it keeps the default
    // there.
    const offSplitFocus = api.on.splitFocus((t) => setSplitFocus(t));
    // One strip (one product, 9 Nov 2026): the one above shows or closes a Vault tab, by id. The window never
    // hears these (its own strip does it), so everything there reads as today.
    const offTabsActivate = api.on.vaultTabsActivate((t) => {
      const id = typeof t?.id === 'string' ? t.id : '';
      if (!id) return;
      setWorkspace((ws) => {
        const g = tabSyncGroup(ws, id);
        return g ? W.activate(ws, g.id, id) : ws;
      });
    });
    const offTabsClose = api.on.vaultTabsClose((t) => {
      const id = typeof t?.id === 'string' ? t.id : '';
      if (!id) return;
      setWorkspace((ws) => W.closeTab(ws, id));
    });
    const offModels = api.on.modelsChanged(() => void loadSettings());
    // Ctrl + plus or minus stepped the interface size (the main side took the keys): Settings shows the new size.
    const offSettings = api.on.settingsChanged((next) => setState({ settings: next }));
    // A Windows notice from an AI agent's request was clicked, or the former host app opened Settings › AI
    // agents.
    const offAgents = api.on.agentsShow((section, row) => {
      // A door from the former host app names its row from the id (4 Nov 2026, the 14 doors); an explicitly named
      // row wins.
      const door = section && !row ? SETTINGS_REVEAL[section] : undefined;
      openModal({ kind: 'settings', section: (section ?? 'agents') as never, row: row ?? door?.row });
    });
    // Closing waits for this (F2): everything saved — notes, loose files, layout, a meeting still recording — then the window may go.
    const offCloseRequest = api.app.onCloseRequest(() => {
      void (async () => {
        try {
          await docs.flush();
          await looseSaves.flushAll();
          await saveWorkspaceNow();
          // A meeting still recording (5 Nov 2026, s2-recorder-survives): its sound waiting in memory flushed first.
          await import('./state/recorder').then((m) => m.flushForClose()).catch(() => undefined);
        } finally {
          api.app.closeReady();
        }
      })();
    });
    const beforeUnload = () => {
      void docs.flush();
      void looseSaves.flushAll();
      void saveWorkspaceNow();
      void import('./state/recorder').then((m) => m.flushForClose()).catch(() => undefined);
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      offOpened();
      offLock();
      offChanged();
      offFiles();
      offShow();
      offReveal();
      offPlace();
      offVaultSettings();
      offSplitFocus();
      offTabsActivate();
      offTabsClose();
      offModels();
      offSettings();
      offAgents();
      offCloseRequest();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [openLibrary]);

  // The look: light or dark (or following Windows), the accent colour, the size of everything.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      // The light look's colours (5.2.0; styles/palettes.css): Bright unless another was chosen.
      document.documentElement.dataset.palette = prefs.palette;
      document.documentElement.style.setProperty('--accent-base', prefs.accent);
      // Ironleaf's leaf has its own dark twin (leaf-300, the brand palette); any other colour is lightened in Dark.
      const leaf = prefs.accent.toLowerCase() === LEAF_ACCENT;
      if (leaf) document.documentElement.style.setProperty('--accent-dark', LEAF_ACCENT_DARK);
      else document.documentElement.style.removeProperty('--accent-dark');
      if (leaf) document.documentElement.dataset.accent = 'leaf';
      else delete document.documentElement.dataset.accent;
      // Fonts by name (Settings › Appearance): a font that isn't on this PC falls back to Geist, the app's own.
      const fonts: [string, string, string][] = [
        ['--font-ui', prefs.uiFont, "'Geist', 'Segoe UI', system-ui, sans-serif"],
        ['--font-text', prefs.textFont, "'Geist', 'Segoe UI', system-ui, sans-serif"],
        ['--font-serif', prefs.textFont, "'Geist', 'Segoe UI', system-ui, sans-serif"],
        ['--font-mono', prefs.codeFont, "'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier New', monospace"],
      ];
      for (const [name, font, fallback] of fonts) {
        if (font) document.documentElement.style.setProperty(name, `"${font}", ${fallback}`);
        else document.documentElement.style.removeProperty(name);
      }
      setLineBreaks(!prefs.strictBreaks);
      void api.window.zoom(prefs.zoom).catch(() => {});
      // Density (Settings › Appearance; styles/feel.css): Compact draws the side bar, file list, tabs and lists closer.
      document.documentElement.dataset.density = prefs.density;
      requestAnimationFrame(tintWindowButtons);
    };
    apply();
    if (prefs.theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [prefs.theme, prefs.palette, prefs.accent, prefs.zoom, prefs.density, prefs.uiFont, prefs.textFont, prefs.codeFont, prefs.strictBreaks]);

  // Tabs on or off (Settings › Appearance › Interface): how opening a page works follows (state/workspace.ts open()).
  W.showTabs(prefs.showTabs);

  const peekOpen = usePeek().open;
  // The window buttons' band (8.6.1): its size into the variables, its tint from whatever is under it.
  const refreshChrome = useCallback(() => {
    updateWindowButtons({ platform: api.window.platform, zoom: prefs.zoom });
    tintWindowButtons();
  }, [prefs.zoom]);
  useEffect(() => {
    requestAnimationFrame(refreshChrome);
  }, [right, fit.left, vault, prefs.showTabs, modal?.kind, peekOpen, refreshChrome]);
  // A wider or narrower window can put something else under the buttons (the side panel shut, a split).
  useEffect(() => {
    let timer = 0;
    const later = () => {
      clearTimeout(timer);
      timer = window.setTimeout(refreshChrome, 150);
    };
    window.addEventListener('resize', later);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', later);
    };
  }, [refreshChrome]);
  // The overlay itself moved (maximised, snapped): the band is measured again.
  useEffect(() => watchWindowButtons(() => requestAnimationFrame(refreshChrome)), [refreshChrome]);

  // A canvas with the keys keeps Ctrl + plus, minus and 0 for its own zoom: the main side, which takes them for the size
  // of everything, is told when one has them (the same test as the keys below).
  useEffect(() => {
    let own = false;
    const onFocus = () => {
      const at = document.activeElement;
      const next = !!at?.closest?.('[data-own-zoom]') && !at.closest('.cm-editor, input, textarea, [contenteditable="true"]');
      if (next === own) return;
      own = next;
      void api.window.ownZoom(next).catch(() => {});
    };
    // Focus leaving for nowhere (a click on the canvas's empty surface) is known a frame later.
    const onOut = () => requestAnimationFrame(onFocus);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onOut);
    };
  }, []);

  // Keys: every command's keys (Settings › Keys), from anywhere in the window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!getState().vault || document.querySelector('.keys-recording')) return;
      if (document.querySelector('.overlay, .slides') && !((e.key.toLowerCase() === 'p' || e.key.toLowerCase() === 'k') && (e.ctrlKey || e.metaKey))) return;
      // A list that does its own plain keys (the file list's F2 and Delete) keeps them.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.target as Element | null)?.closest?.('[data-own-keys]')) return;
      const inEditor = !!(document.activeElement as HTMLElement | null)?.closest('.cm-editor');
      // A view with its own zoom (a canvas) keeps the zoom keys while it has the keys (not while typing in it).
      const target = e.target as Element | null;
      const ownZoom = !!target?.closest?.('[data-own-zoom]') && !target.closest('.cm-editor, input, textarea, [contenteditable="true"]');
      for (const cmd of COMMANDS) {
        const combo = hotkeyOf(cmd);
        const alsos = alsoKeys(cmd);
        const primaryHit = !!combo && matchHotkey(e, combo);
        const alsoHit = (a: string) => matchHotkey(e, a);
        if (!primaryHit && !alsos.some(alsoHit)) continue;
        // An also key yields to a person's own key for another command (fnv3 F48), never shadowing it silently.
        if (!primaryHit && alsos.some((a) => alsoHit(a) && COMMANDS.some((c) => c !== cmd && hotkeyOf(c) === a))) continue;
        if (ownZoom && cmd.id.startsWith('zoom-')) continue;
        if (cmd.editor && !inEditor) continue;
        const ctx = commandContext();
        if (!available(cmd, ctx)) continue;
        e.preventDefault();
        e.stopPropagation();
        void Promise.resolve(cmd.run(ctx)).catch(showError);
        return;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // From outside the window (src/main/external.ts; 21 Oct 2026, gap G26): what a ironleaf:// link, the neuralvault
  // command or "Open with" asked for (a search, a Markdown file from outside the vault, a few words to say), taken as
  // soon as the window is ready; File › Open file…; and Markdown files dragged onto the window from File Explorer.
  useEffect(() => {
    const take = () =>
      void api.external
        .take()
        .then((items) => {
          for (const item of items) {
            if (item.kind === 'search') {
              requestSearch(item.query);
            } else if (item.kind === 'loose') A.openLoose({ kind: 'loose', file: item.file });
            else toast(item.words);
          }
        })
        .catch(showError);
    take();
    const offItems = api.on.externalItems(take);
    const offPick = api.on.loosePick(() => void A.pickLooseFiles());
    const markdown = (f: File) => /\.(md|markdown|mdown|mkd)$/i.test(f.name);
    const onOver = (e: DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer?.types.includes('Files')) return;
      if ((e.target as Element | null)?.closest?.('.cm-editor, .canvas-surface, .canvas-view, .nvd-view')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer?.files.length) return;
      if ((e.target as Element | null)?.closest?.('.cm-editor, .canvas-surface, .canvas-view, .nvd-view')) return;
      const files = [...e.dataTransfer.files].filter(markdown);
      if (!files.length) return;
      e.preventDefault();
      for (const f of files) {
        const p = api.files.pathOf(f);
        if (p) void api.loose.open(p).then((opened) => A.openLoose(opened)).catch(showError);
      }
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      offItems();
      offPick();
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (booting)
    return (
      <div className="boot" role="status" aria-label="Opening your vault">
        <p>Opening your vault…</p>
      </div>
    );

  if (!vault) {
    return (
      <>
        <Welcome
          recent={settings?.recentVaults ?? []}
          onPick={() => void api.vault.pick().then((info) => info && openLibrary(info)).catch((err) => setFailed(errorMessage(err)))}
          onOpenRecent={(p) => void api.vault.open(p).then(openLibrary).catch((err) => setFailed(errorMessage(err)))}
          error={failed}
        />
        <DialogHost />
      </>
    );
  }

  // --left-dock (8.7 final polish, 30 Oct 2026, the reviewer: Search and the palette sit over the page area):
  // how wide the docked left side is, so the windows over the app centre past it; 0 folded away or adrift.
  // Frameless in the former host app's window (one product step 2): the left bar never draws, so the view is tabs
  // and pages only.
  const leftDocked = fit.left === 'docked' && !frameless;
  return (
    <div className="app" data-platform={api.window.platform} data-left={frameless ? 'hidden' : fit.left} data-right={right} data-frameless={frameless ? 'true' : undefined} style={{ '--left-dock': leftDocked ? `${fit.leftWidth}px` : '0px' } as React.CSSProperties}>
      {leftDocked && <LeftSidebar width={fit.leftWidth} />}
      <main className="main">
        {lock.mode === 'read-only' && !lockQuiet && lock.words && (
          <LockNotice
            words={lock.words}
            otherApp={lock.otherApp}
            onOpenOther={() => void api.vaultLock.openOther().catch(showError)}
            onReadOnly={() => {
              setLockQuiet(true);
              void api.vaultLock.readOnly().then((view) => view && setLock(view)).catch(() => {});
            }}
          />
        )}
        <Workspace leftOpen={leftDocked} rightOpen={right === 'docked'} />
        <StatusBar />
        <SaveCorner />
        {/* The weekly review is offered on Today and Projects, never as a corner pop-up (8.0, 29 Oct 2026: nothing pops up uninvited). */}
        {/* A meeting still being recorded while its note is out of sight (state/recorder.ts). */}
        <RecordingPill />
      </main>
      {right === 'docked' && <RightSidebar width={fit.rightWidth} />}
      {/* A side that can't dock at this window size opens over the middle; a click beside it closes it. */}
      {((fit.left === 'drawer' && !frameless) || right === 'drawer') && <div className={`side-scrim from-${fit.left === 'drawer' && !frameless ? 'left' : 'right'}`} onMouseDown={closeDrawer} aria-hidden="true" />}
      {fit.left === 'drawer' && !frameless && <LeftSidebar width={fit.leftWidth} drawer />}
      {right === 'drawer' && <RightSidebar width={fit.rightWidth} drawer />}

      <LifeHost />
      <ModalLayer modal={modal} />
      <AssetPickerHost />
      <MenuHost />
      <EditMenuHost />
      <DialogHost />
      <FormulaEditorHost />
      <RollupEditorHost />
      <RecordFormulaEditorHost />
      <RecordRollupEditorHost />
      <FormDialogHost />
      <PickerHost />
      <FileHitViewerHost />
      <ImportsStrip />
      <HoverHost onOpen={(target, from, newTab) => void A.openLink(target, from, newTab ? 'tab' : 'current')} />
      {/* A record opened with one click, with everything connected to it (components/Peek.tsx; WS1 part B). */}
      <PeekHost />
      {toastState && (
        <div className="toast" role="status" data-nv-leaving={toastState.leaving ? 'true' : undefined} onPointerEnter={() => holdToast(true)} onPointerLeave={() => holdToast(false)}>
          <span>{toastState.words}</span>
          {toastState.action && (
            <button
              className="toast-action"
              onClick={() => {
                toastState.action!.run();
                closeToast();
              }}
            >
              {toastState.action.label}
            </button>
          )}
          <button className="toast-close" title="Close" onClick={closeToast}>
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
