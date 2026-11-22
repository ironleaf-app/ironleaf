// The menus for a file or folder (in the file list, on tabs, in a note's ⋯ menu): the same choices everywhere.

import { isDocPath } from '../lib/docPath';
import { addQuietFolder, isQuietFolder, isQuietPath, removeQuietFolder } from '../../../shared/fewer-folders';
import { INBOX_FOLDER } from '../../../shared/inbox';
import { noteKindOf } from '../../../shared/notes-list';
import { DOC_STATUSES, readDocFacts, STATUS_WORDS, type DocStatus } from '../../../shared/doc-versions';
import { isoDay } from '../../../shared/days';
import { setNoteProp } from '../../../shared/views';
import { typeOfNote } from '../../../shared/note-types';
import { isPrivatePath } from '../../../shared/private';
import { isProjectProps } from '../../../shared/project-file';
import { notebookOfFile } from '../../../shared/notebook';
import type { MenuItem } from '../components/Menu';
import * as A from './actions';
import { isBookmarked, toggleBookmark } from './bookmarks';
import { docs } from './docs';
import { exportPdf } from './commands';
import { setWorkspace } from './layout';
import { rightShown } from './fit';
import { openModal } from './modals';
import { getNoteTypes } from './noteTypes';
import { getState, prefs, savePrefs, showError, toast } from './store';
import * as W from './workspace';
import { newNoteFromTemplate, saveAsTemplate } from './templates';

import { levelMenuEntry } from '../components/LevelPicker';

/** "Open in…" choices for a file. */
export function openItems(path: string): MenuItem[] {
  return [
    { label: 'Open in a new tab', icon: 'newTab', run: () => A.openPath(path, { where: 'tab' }) },
    { label: 'Open to the right', icon: 'splitRight', run: () => A.openPath(path, { where: 'right' }) },
    { label: 'Open below', icon: 'splitDown', run: () => A.openPath(path, { where: 'down' }) },
  ];
}

export function sendItems(_path: string): MenuItem[] {
  return [];
}

/** Whether a folder is the Inbox itself, however written (8 Nov 2026, item 1: it stays in view). */
const isInboxFolder = (folder: string): boolean => String(folder ?? '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase() === INBOX_FOLDER.toLowerCase();

/** A folder kept out of view, or brought back (8 Nov 2026): hidden from Notes, Today, the graph, Related and the
 *  chat, still found by search. Kept in the vault's own settings, so every PC follows. The folder never
 *  moves. The Inbox stays in view (item 1). */
export function toggleQuietFolder(folder: string): void {
  if (isInboxFolder(folder)) {
    toast('The Inbox stays in view.');
    return;
  }
  const quiet = prefs().quietFolders ?? [];
  const name = folder.includes('/') ? folder.slice(folder.lastIndexOf('/') + 1) : folder;
  // Inside a kept-out folder but not itself kept: already out of view, so there is nothing to keep.
  if (!isQuietFolder(quiet, folder) && isQuietPath(folder, { quietFolders: quiet })) {
    toast(`${name} is already out of view with its folder.`);
    return;
  }
  const out = isQuietFolder(quiet, folder);
  const next = out ? removeQuietFolder(quiet, folder) : addQuietFolder(quiet, folder);
  const stillOut = out && isQuietPath(folder, { quietFolders: next });
  void savePrefs({ quietFolders: next }).then(
    () => toast(stillOut ? `${name} is still out of view with its folder.` : out ? `${name} is back in view.` : `${name} is out of view. It shows under Show everything.`),
    (err) => showError(err),
  );
}

/** Everything that can be done with a file (or folder) from the file list. */
export function fileMenu(path: string, options: { isFolder?: boolean; onRename?(): void; onNewNote?(): void; onNewFolder?(): void; onNewCanvas?(): void } = {}): MenuItem[] {
  const canEdit = getState().canEdit;
  const marked = isBookmarked(path);
  if (options.isFolder) {
    const quiet = isQuietFolder(prefs().quietFolders ?? [], path);
    const inbox = isInboxFolder(path);
    return [
      { label: 'New note', icon: 'filePlus', disabled: !canEdit, run: options.onNewNote },
      { label: 'New note from a template…', icon: 'template', disabled: !canEdit, run: () => void newNoteFromTemplate({ folder: path }) },
      { label: 'New folder', icon: 'folderPlus', disabled: !canEdit, run: options.onNewFolder },
      { label: 'New canvas', icon: 'canvas', disabled: !canEdit, run: options.onNewCanvas },
      { label: 'New view of this folder', icon: 'views', disabled: !canEdit, run: () => void import('./savedViews').then((v) => v.newView({ source: { kind: 'folder', value: path } })) },
      // Its notes and PDFs as a notebook: ask them, with cited answers, and make study material (views/NotebookView.tsx).
      { label: 'Open as a notebook', icon: 'book', run: () => void import('./notebook').then((n) => n.openNotebook(path)) },
      { separator: true },
      { label: 'Rename', icon: 'edit', disabled: !canEdit, run: options.onRename ?? (() => void A.askRename(path)) },
      { label: 'Move to…', icon: 'folder', disabled: !canEdit, run: () => void A.askMove(path) },
      { label: 'Move into another area…', icon: 'folder', disabled: !canEdit, run: () => void import('./areaFold').then((m) => m.foldArea(path)) },
      { label: 'Make a copy', icon: 'copy', disabled: !canEdit, run: () => void A.duplicatePath(path) },
      { label: marked ? 'Remove the bookmark' : 'Bookmark', icon: 'bookmark', run: () => toggleBookmark(path, 'folder') },
      // The Inbox stays in view (8 Nov 2026, item 1): no door on its menu.
      ...(inbox ? [] : [{ label: quiet ? 'Bring back into view' : 'Keep out of view', icon: 'eye', run: () => toggleQuietFolder(path) } as const]),
      ...(canEdit && !isPrivatePath(path) ? [levelMenuEntry(path, true)] : []),
      { separator: true },
      { label: 'Search in this folder', icon: 'search', run: () => void import('./modals').then((m) => m.requestSearch(`path:"${path}/" `)) },
      { label: 'Copy its path', icon: 'copy', run: () => void A.copyPath(path) },
      { label: 'Show in File Explorer', icon: 'reveal', run: () => void A.revealInSystem(path) },
      { separator: true },
      { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(path) },
    ];
  }
  const isNote = /\.md$/i.test(path);
  return [
    ...openItems(path),
    { separator: true },
    ...sendItems(path),
    ...(sendItems(path).length ? [{ separator: true } as MenuItem] : []),
    { label: 'Rename', icon: 'edit', disabled: !canEdit, run: options.onRename ?? (() => void A.askRename(path)) },
    { label: 'Move to…', icon: 'folder', disabled: !canEdit, run: () => void A.askMove(path) },
    { label: 'Make a copy', icon: 'copy', disabled: !canEdit, run: () => void A.duplicatePath(path) },
    { label: marked ? 'Remove the bookmark' : 'Bookmark', icon: 'bookmark', run: () => toast(toggleBookmark(path) ? 'Bookmarked.' : 'Bookmark removed.') },
    ...(canEdit && !isPrivatePath(path) ? [levelMenuEntry(path)] : []),
    ...(isNote ? [{ label: 'Export to PDF', icon: 'download', run: () => void exportPdf(path) } as MenuItem] : []),
    ...(isNote && !isPrivatePath(path) ? [{ label: 'Design with AI…', icon: 'palette', run: () => openModal({ kind: 'design', path }) } as MenuItem] : []),
    { separator: true },
    { label: 'Copy its path', icon: 'copy', run: () => void A.copyPath(path) },
    { label: 'Show in File Explorer', icon: 'reveal', run: () => void A.revealInSystem(path) },
    { label: 'Open in its default app', icon: 'external', run: () => void A.openInDefaultApp(path) },
    { separator: true },
    { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(path) },
  ];
}

/** A note's ⋯ menu in its tab. */
/** A private note's ⋯ menu: nothing that copies it out of the encrypted store (no sending, versions, copies, bookmarks). */
function privateNoteMenu(tab: W.TabState): MenuItem[] {
  const path = tab.path!;
  const mode = tab.mode ?? prefs().defaultMode;
  const canEdit = getState().canEdit;
  const setMode = (m: W.TabState['mode']) => setWorkspace((ws) => W.updateTab(ws, tab.id, { mode: m }));
  const canDictate = !!window.nv.dictation?.available && prefs().dictation;
  return [
    { label: 'Reading', icon: 'book', checked: mode === 'reading', run: () => setMode('reading') },
    { label: 'Live Preview', icon: 'pencil', checked: mode === 'live', run: () => setMode('live') },
    { label: 'Source', icon: 'code', checked: mode === 'source', run: () => setMode('source') },
    { separator: true },
    // Dictate left the header for the menu (5 Nov 2026, the clean header); a private note keeps Windows
    // voice typing exactly as the header did (the dictate command reads the same path).
    ...(canDictate ? [{ label: 'Dictate', icon: 'mic' as const, disabled: !canEdit || mode === 'reading', run: () => void import('./commands').then((c) => c.runCommand('dictate')) } as MenuItem] : []),
    { label: 'Add a property', icon: 'properties', disabled: !canEdit, run: () => window.dispatchEvent(new CustomEvent('nv-add-property', { detail: tab.id })) },
    { label: 'Rename', icon: 'edit', disabled: !canEdit, run: () => void A.askRename(path) },
    { separator: true },
    { label: 'Split right', icon: 'splitRight', run: () => setWorkspace((ws) => W.split(ws, ws.activeGroup, 'row')) },
    { label: 'Split down', icon: 'splitDown', run: () => setWorkspace((ws) => W.split(ws, ws.activeGroup, 'column')) },
    { separator: true },
    { label: 'Locked', icon: 'lock', run: () => A.openLocked('notes') },
    { label: 'Lock now', icon: 'lock', run: () => void import('./private').then((m) => m.lockPrivate()) },
    { separator: true },
    { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(path) },
  ];
}

export function noteMenu(tab: W.TabState): MenuItem[] {
  const path = tab.path!;
  if (isPrivatePath(path)) return privateNoteMenu(tab);
  const mode = tab.mode ?? prefs().defaultMode;
  const canEdit = getState().canEdit;
  const setMode = (m: W.TabState['mode']) => setWorkspace((ws) => W.updateTab(ws, tab.id, { mode: m }));
  // What the header held (5 Nov 2026, the clean header: Share, Read and … only): a daily note walks its days,
  // a project's note walks back to its page, and dictation starts here (its stop stays in the header while
  // recording). Same conditions the header read, so nothing appears where it never did.
  const entry = getState().byPath.get(path);
  const typeId = entry ? typeOfNote({ path, props: entry.props }, getNoteTypes(), prefs().templatesFolder) : null;
  const isDaily = noteKindOf({ path, title: entry?.title ?? A.titleOf(path), typeId, props: entry?.props }) === 'daily';
  const isProject = getState().byPath.get(path)?.props?.type === 'project';
  const canDictate = !!window.nv.dictation?.available && prefs().dictation;
  const ctxOpen = (() => {
    try {
      const v = localStorage.getItem('nv.noteRail.open');
      return v === null ? false : v !== '0';
    } catch {
      return false;
    }
  })();
  // Grouped, 4 Nov 2026 (the ⋯ menu ran to 35 flat rows): the view switch and the sends stay one
  // click at the top, the rest sit in four named groups, and Export to PDF is gone here (the
  // header's Share already saves a PDF; the file list keeps Export).
  const isDoc = isDocPath(path);
  // The context panel stands beside the note only while the right side is shut (t22-note-once, 8 Nov 2026), so
  // its row shows only then: offered while docked, it would flip a panel nobody can see.
  const ctxShown = rightShown() !== 'docked';
  const viewSub: MenuItem[] = [
    ...(ctxShown ? [{ label: ctxOpen ? 'Hide the context panel' : 'Show the context panel', icon: 'sidebarRight', run: () => window.dispatchEvent(new CustomEvent('nv-context-toggle')) }] as MenuItem[] : []),
    { label: 'Present as slides', icon: 'present', run: () => openModal({ kind: 'slides', path }) },
    ...(isDoc
      ? ([
          { label: 'Show as canvas', icon: 'canvas', run: () => void import('./docKind').then((d) => d.showDocCanvas(path)) },
          { label: 'Update canvas from doc', icon: 'refresh', disabled: !canEdit, run: () => void import('./docKind').then((d) => d.updateDocCanvas(path)) },
        ] as MenuItem[])
      : []),
    ...notebookFlat(path),
  ];
  // A plain note becomes a document here (t239): the status lands in its front matter, and the page's facts
  // line carries it from then on.
  const docFacts = readDocFacts(entry?.props as Record<string, unknown> | undefined);
  const setDocStatus = (next: DocStatus | null) => {
    const current = docs.text(path);
    if (current === undefined) return;
    let nextText = setNoteProp(current, 'doc_status', next);
    if (next === 'signed' && !docFacts.signedOn) nextText = setNoteProp(nextText, 'signed_on', isoDay(new Date()));
    if (nextText !== current) docs.update(path, nextText, 'menu');
  };
  const noteSub: MenuItem[] = [
    { label: 'Add a property', icon: 'properties', disabled: !canEdit, run: () => window.dispatchEvent(new CustomEvent('nv-add-property', { detail: tab.id })) },
    ...(canEdit ? [levelMenuEntry(path)] : []),
    {
      label: 'Document status',
      icon: 'doc',
      hint: docFacts.status ? STATUS_WORDS[docFacts.status] : undefined,
      disabled: !canEdit || isProject,
      submenu: [...DOC_STATUSES.map((s): MenuItem => ({ label: STATUS_WORDS[s], checked: docFacts.status === s, run: () => setDocStatus(s) })), { label: 'None', checked: !docFacts.status, run: () => setDocStatus(null) }],
    },
    { label: 'Earlier versions', icon: 'history', run: () => openModal({ kind: 'recovery', path }) },
    { label: isBookmarked(path) ? 'Remove the bookmark' : 'Bookmark', icon: 'bookmark', run: () => toast(toggleBookmark(path) ? 'Bookmarked.' : 'Bookmark removed.') },
  ];
  const fileSub: MenuItem[] = [
    { label: 'Rename', icon: 'edit', disabled: !canEdit, run: () => void A.askRename(path) },
    { label: 'Move to…', icon: 'folder', disabled: !canEdit, run: () => void A.askMove(path) },
    { label: 'Merge into another note…', icon: 'merge', disabled: !canEdit, run: () => void import('./commands').then((c) => c.runCommand('merge')) },
    { label: 'Make a copy', icon: 'copy', disabled: !canEdit, run: () => void A.duplicatePath(path) },
    { label: 'Save as template…', icon: 'template', disabled: !canEdit, run: () => void saveAsTemplate(path) },
    ...(isProjectProps(getState().byPath.get(path)?.props)
      ? [{ label: 'Turn into a doc…', icon: 'doc', disabled: !canEdit, run: () => void import('./docKind').then((d) => d.turnIntoDoc(path)) } as MenuItem]
      : []),
    ...(isDoc ? [{ label: 'Turn into a project…', icon: 'layers', disabled: !canEdit, run: () => void import('./docKind').then((d) => d.turnIntoProject(path)) } as MenuItem] : []),
    { label: 'Show in the file list', icon: 'files', run: () => A.revealInExplorer(path) },
    { label: 'Show in File Explorer', icon: 'reveal', run: () => void A.revealInSystem(path) },
    { label: 'Copy its path', icon: 'copy', run: () => void A.copyPath(path) },
  ];
  return [
    { label: 'Reading', icon: 'book', checked: mode === 'reading', run: () => setMode('reading') },
    { label: 'Live Preview', icon: 'pencil', checked: mode === 'live', run: () => setMode('live') },
    { label: 'Source', icon: 'code', checked: mode === 'source', run: () => setMode('source') },
    { separator: true },
    ...sendItems(path),
    { label: 'Publish as a website…', icon: 'globe', run: () => openModal({ kind: 'publish', source: { kind: 'page', path } }) },
    ...(isDaily ? [{ label: 'Yesterday', icon: 'back' as const, run: () => void A.openDailyOffset(-1) } as MenuItem, { label: 'Tomorrow', icon: 'forward' as const, run: () => void A.openDailyOffset(1) } as MenuItem] : []),
    ...(isProject ? [{ label: 'Project page', icon: 'layers' as const, run: () => setWorkspace((ws) => W.updateTab(ws, tab.id, { mode: 'page' })) } as MenuItem] : []),
    ...(canDictate ? [{ label: 'Dictate', icon: 'mic' as const, disabled: !canEdit || mode === 'reading', run: () => void import('./commands').then((c) => c.runCommand('dictate')) } as MenuItem] : []),
    { label: 'View', icon: 'eye', submenu: viewSub },
    { label: 'Note', icon: 'notes', submenu: noteSub },
    { label: 'File', icon: 'file', submenu: fileSub },
    {
      label: 'Tab',
      icon: 'newTab',
      submenu: [
        { label: 'Split right', icon: 'splitRight', run: () => setWorkspace((ws) => W.split(ws, ws.activeGroup, 'row')) },
        { label: 'Split down', icon: 'splitDown', run: () => setWorkspace((ws) => W.split(ws, ws.activeGroup, 'column')) },
        { label: tab.pinned ? 'Unpin the tab' : 'Pin the tab', icon: 'pin', run: () => setWorkspace((ws) => W.updateTab(ws, tab.id, { pinned: !tab.pinned })) },
      ],
    },
    { separator: true },
    { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(path) },
  ];
}

/** A notebook's own notes (notebook mode, 21 Oct 2026): flashcards to review and a script to read aloud. */
function notebookFlat(path: string): MenuItem[] {
  const kind = getState().byPath.get(path)?.props?.['notebook-kind'];
  const folder = notebookOfFile(path);
  const items: MenuItem[] = [];
  if (kind === 'flashcards') items.push({ label: 'Review flashcards', icon: 'layers', run: () => openModal({ kind: 'review-cards', path }) });
  if (kind === 'audio') items.push({ label: 'Read aloud (or stop)', icon: 'play', run: () => void import('./notebook').then((n) => n.readAloud(path)) });
  if (folder !== null && kind) items.push({ label: 'Open its notebook', icon: 'book', run: () => void import('./notebook').then((n) => n.openNotebook(folder, 'tab')) });
  return items;
}

/** A tab's right-click menu. */
export function tabMenu(tab: W.TabState): MenuItem[] {
  return [
    { label: 'Close', icon: 'close', run: () => setWorkspace((ws) => W.closeTab(ws, tab.id)) },
    { label: 'Close the others', run: () => setWorkspace((ws) => W.closeOthers(ws, tab.id)) },
    { separator: true },
    { label: tab.pinned ? 'Unpin' : 'Pin', icon: 'pin', run: () => setWorkspace((ws) => W.updateTab(ws, tab.id, { pinned: !tab.pinned })) },
    { label: 'Split right', icon: 'splitRight', run: () => setWorkspace((ws) => W.split(ws, ws.activeGroup, 'row')) },
    { label: 'Split down', icon: 'splitDown', run: () => setWorkspace((ws) => W.split(ws, ws.activeGroup, 'column')) },
    ...(tab.path
      ? [
          { separator: true } as MenuItem,
          { label: 'Show in the file list', icon: 'files', run: () => A.revealInExplorer(tab.path!) } as MenuItem,
          { label: 'Copy its path', icon: 'copy', run: () => void A.copyPath(tab.path!) } as MenuItem,
        ]
      : []),
  ];
}
