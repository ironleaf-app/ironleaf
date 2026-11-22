// What the person does with notes and files, in one place for every button, menu, key and command: open, create,
// rename and move (links kept working), delete to Recently deleted, daily notes, and the rest.

import { resolveSection } from '../lib/settingsSearch';
import { isProjectProps } from '../../../shared/project-file';
import { requestSettingsDoor } from './modals';
import { noteMoved, noteRemoved } from './noteEvents';
import { momentOf, playAt } from './playback';
import { confirm, choose, prompt } from '../components/Dialogs';
import { formatDate } from '../../../shared/dates';
import { isoDay, offsetIsoDay } from '../../../shared/days';
import { sidecarPathFor } from '../../../shared/pdf-highlights';
import { isPrivatePath } from '../../../shared/private';
import { fitTypedName, stripTrailingDots } from '../../../shared/paths';
import { plural } from '../../../shared/words';
import { bookmarksRenamed } from './bookmarks';
import { docs } from './docs';
import { openModule } from './modules';
import { workCall } from './workModules';
import { editorFor, getWorkspace, revealLater, setWorkspace } from './layout';
import { inVaultView } from '../lib/inWindow';
import { splitRowPath } from '../../../shared/system-tables';
import { splitBillRow } from '../../../shared/bills-table';
import { graphCentreForTab } from '../../../shared/living-graph';
import { getState, loadFiles, loadNotes, prefs, showError, toast } from './store';
import * as W from './workspace';
import { showSide } from './fit';

const api = () => window.nv;

export const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
export const nameOf = (path: string) => path.split('/').pop() ?? path;
export const titleOf = (path: string) => nameOf(path).replace(/\.(md|canvas|nvdraw|view\.json|base)$/i, '');
/** The name a person sees for a note: its indexed title (the person's own, colon and all, never the file's copy
 *  number), else its file name. Every word a person reads about a note uses this; file names stay for files. */
export const displayName = (path: string): string => getState().byPath.get(path)?.title ?? titleOf(path);

/** The note or file shown in the active tab. */
export function activePath(): string | undefined {
  return W.activeTab(getWorkspace()).path;
}

export interface OpenOptions {
  where?: W.Where;
  line?: number;
  heading?: string;
  /** With `line`: that many lines after it lit for a moment (a cited passage, notebook mode). */
  span?: number;
  mode?: W.TabState['mode'];
  /** Focus a tab that already shows it instead of opening it again. */
  reuse?: boolean;
}

export function openPath(path: string, options: OpenOptions = {}): void {
  // A Systems list row opens its record page (records as data, 5 Nov 2026), from every door that opens a path.
  const row = splitRowPath(path);
  if (row) {
    openModule('systems', `${row.kind}:${encodeURIComponent(path)}`, options.where ?? 'current');
    return;
  }
  // A Bills list row opens its bill page (bills as one list, 8 Nov 2026), from every door that opens a path.
  if (splitBillRow(path)) {
    openModule('finance', `bill:${encodeURIComponent(path)}`, options.where ?? 'current');
    return;
  }
  if (options.line !== undefined || options.heading) revealLater(path, { line: options.line, heading: options.heading, span: options.span });
  if (options.reuse) {
    const existing = W.revealExisting(getWorkspace(), path);
    if (existing) {
      setWorkspace(W.noteOpened(existing, path));
      return;
    }
  }
  // A project opens as its page (docs/PROJECTS-DESIGN.md); "Edit as note" switches to the editor.
  const mode = options.mode ?? (isProjectProps(getState().byPath.get(path)?.props) ? 'page' : undefined);
  setWorkspace((ws) => W.noteOpened(W.open(ws, { type: W.typeOf(path), path }, options.where ?? 'current', mode), path));
}

/** Words filed as a task from an Ask box's Do mode (9.2 uplift F1): the one path every box uses. True when
 *  filed (the box clears); false when it failed (the words stay, the failure said). */
export async function fileTaskText(q: string): Promise<boolean> {
  try {
    const saved = await window.nv.capture.save({ kind: 'task', text: q, project: null, pictures: [], files: [], toAssets: false });
    toast(saved.words, saved.open ? { label: 'Open', run: () => openPath(saved.open!) } : undefined);
    return true;
  } catch (err) {
    showError(err);
    return false;
  }
}

/** A file in a project's folder, in the full viewer as a tab (t239, 12 Nov 2026): pictures, PDFs, video and
 *  recordings as they are; Markdown, text and tables read; Word, Excel and PowerPoint as their words; anything else
 *  by its card with Open in its program. One tab per file (the workspace keeps it so); Back returns. */
export function openFolderFile(project: string, rel: string, where: W.Where = 'current'): void {
  setWorkspace((ws) => W.open(ws, { type: 'project-file', path: `${project}\n${rel.replace(/\\/g, '/')}` }, where));
}

/** A note at a line (a reminder's notification, Today's reminders, the bell): the tab already showing it comes forward
 *  and goes to the line; else the note opens there. */
export function openAtLine(path: string, line: number): void {
  const existing = W.revealExisting(getWorkspace(), path);
  if (!existing) return openPath(path, { line });
  setWorkspace(W.noteOpened(existing, path));
  requestAnimationFrame(() => {
    const tab = W.activeTab(getWorkspace());
    if (tab.path === path) editorFor(tab.id)?.scrollToLine(line);
  });
}

/** Private notes: set up, unlock, or the list of them (src/main/private-notes.ts). */
/** A place (Projects, the graph, Private notes) opens in its own tab: the empty tab if one is showing, else a new one, so
 * the page someone was on stays open beside it. A note still opens where they are. */
/** A page already open in a tab is brought forward rather than opened again; with tabs off only one on screen is (a tab
 * out of sight would take the person away from their page with no Back to it). */
function shownNow(existing: { g: W.Group; t: W.TabState }): boolean {
  return W.tabsAreShown() || existing.g.active === existing.t.id;
}

function placeWhere(where: W.Where): W.Where {
  // A page from the side bar takes the tab you are in (26 Oct 2026 uplift; every click had opened another tab, nine after
  // a short walk): Back returns to what was there, Ctrl+click (or middle-click) asks for a new tab, and a pinned tab such
  // as Today is never replaced (W.open opens beside it).
  return where;
}

/** The one Locked place (10.0 v2locked): private notes, secrets, the scanner or the audit trail, in one tab. */
export function openLocked(section: 'notes' | 'secrets' | 'scan' | 'activity' = 'notes', where: W.Where = 'current'): void {
  void import('./privacy').then((p) => p.requestLockedSection(section));
  // One Locked tab: an older private or secrets tab left open is the same place now.
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'locked' || t.type === 'private' || t.type === 'secrets');
  if (existing && where === 'current' && shownNow(existing)) {
    setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type: 'locked' }, placeWhere(where)));
}

/** Secrets (Wave 4): the locked store, the scanner ('scan') or the audit trail ('activity'), in one tab. */
export function openSecrets(part: 'secrets' | 'scan' | 'activity' = 'secrets', where: W.Where = 'current'): void {
  openLocked(part, where);
}

export function openPrivate(where: W.Where = 'current'): void {
  openLocked('notes', where);
}

/** The Projects home: every project at a glance. */
/** Home folded into Today (5 Nov 2026, one morning place): old links to Home open Today. */
export function openHome(where: W.Where = 'current'): void {
  openToday(where);
}

/** Today (views/TodayView.tsx): the day's work across every project, in its own tab (the one already open, if any). */
export function openToday(where: W.Where = 'current'): void {
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'today');
  if (existing && where === 'current' && shownNow(existing)) {
    setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type: 'today' }, placeWhere(where)));
}

export function openProjects(where: W.Where = 'current'): void {
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'projects');
  if (existing && where === 'current' && shownNow(existing)) {
    setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type: 'projects' }, placeWhere(where)));
}

/** The weekly review (views/WeeklyReview.tsx): the week across every project, to approve and apply in one pass. */
export function openWeeklyReview(where: W.Where = 'current'): void {
  openSingle('review', where);
}

/** The timeline: every project's dates in one view (views/TimelineView.tsx). */
export function openTimeline(where: W.Where = 'current'): void {
  openSingle('timeline', where);
}

/** Tasks: every tick-box in the notes, filtered and ticked in place (views/TasksView.tsx; 21 Oct 2026, gap G24). */
export function openTasks(where: W.Where = 'current', ask?: { when?: 'none' }): void {
  // Today's "N tasks with no date · Review" (layout round 2) opens Tasks showing just those: the view reads the ask
  // once when it starts, or hears it when it is already open.
  if (ask?.when) {
    tasksAsk = ask;
    window.dispatchEvent(new CustomEvent('nv-tasks-ask'));
  }
  openSingle('tasks', where);
}
let tasksAsk: { when?: 'none' } | null = null;
/** The ask Today left for Tasks, taken once. */
export function takeTasksAsk(): { when?: 'none' } | null {
  const a = tasksAsk;
  tasksAsk = null;
  return a;
}

/** Changes waiting (10.0, v2changes): proposed change sets reviewed once as a set, with one set opened when given. */
export function openChanges(setId?: string, where: W.Where = 'current'): void {
  if (!setId) return openSingle('changes', where);
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'changes');
  if (existing && where === 'current' && shownNow(existing)) {
    setWorkspace((ws) => W.activate(W.updateTab(ws, existing.t.id, { path: setId }), existing.g.id, existing.t.id));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type: 'changes', path: setId }, placeWhere(where)));
}

/** The weekly tidy (2 Nov 2026, 10.0 plan item 21; views/WeeklyTidyView.tsx): this week's proposal to review. */
export function openTidy(where: W.Where = 'current'): void {
  openSingle('tidy', where);
}

/** Shared spaces (10.0 item 26; views/SharedSpacesHome.tsx): every space a bot looks after, one tab. */
export function openSharedSpaces(where: W.Where = 'current'): void {
  openSingle('shared-spaces', where);
}

/** One shared space's home (10.0 item 26; views/SharedSpacePage.tsx): the folder reads like a project page. */
export function openSharedSpace(folder: string, where: W.Where = 'current'): void {
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'shared-space' && t.path === folder);
  if (existing && where === 'current' && shownNow(existing)) {
    setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type: 'shared-space', path: folder }, placeWhere(where)));
}

/** What the Vault can do (8.8): the registry's page (src/shared/abilities.ts), one tab brought forward. */
export function openAbilities(where: W.Where = 'current'): void {
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'abilities');
  if (existing && where === 'current' && shownNow(existing)) {
    setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type: 'abilities' }, placeWhere(where)));
}

/** A tab there is only one of: brought forward when it is open already, else opened where asked. */
function openSingle(type: 'review' | 'timeline' | 'tasks' | 'home' | 'changes' | 'tidy' | 'shared-spaces', where: W.Where): void {
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === type);
  if (existing && where === 'current' && shownNow(existing)) {
    setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type }, placeWhere(where)));
}

/** Settings as a page in the frame (8.7 w4a round 2): the group is the tab's path, so every old section id and every
 *  caller that asked for a group lands on it; asking again switches the open page. With a row (4 Nov 2026, the 14
 *  doors), the page lands on that row the same way as a search hit; without one it lands on the top as before. */
export function openSettings(section?: string, where: W.Where = 'current', row?: string): void {
  openSettingsTab(section, where, row);
}
/** Vault's own Settings page, always as a tab even in the former host app's window (one product step 4): the one
 *  Settings' door back for a whole sub-screen (the keyboard editor, plugins, publish), which the view shows as a
 *  tab. */
export function openSettingsTab(section?: string, where: W.Where = 'current', row?: string): void {
  const target = resolveSection(section);
  if (row) requestSettingsDoor(row);
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'settings');
  if (existing && where === 'current') {
    setWorkspace((ws) => W.activate(W.updateTab(ws, existing.t.id, { path: target }), existing.g.id, existing.t.id));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type: 'settings', path: target }, placeWhere(where)));
}
/** Earlier versions as a page in the frame (8.7 w4a round 2, views/VersionsPage.tsx): for a note, or bare with a note
 *  picked at the top. Asking for a note switches the open page to it. */
export function openVersions(path?: string, where: W.Where = 'current'): void {
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'versions');
  if (existing && where === 'current') {
    setWorkspace((ws) => W.activate(path ? W.updateTab(ws, existing.t.id, { path }) : ws, existing.g.id, existing.t.id));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type: 'versions', path }, placeWhere(where)));
}
/** Recently deleted, the one bin both apps share (8.0 U13, views/BinView.tsx), in its own tab. */
export function openBin(): void {
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'bin');
  if (existing && shownNow(existing)) {
    setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type: 'bin' }, placeWhere('current')));
}
/** Import (8.7 w4a, views/ImportView.tsx): outside stuff in — spreadsheets, Markdown files, folders of notes — in its own tab. */
export function openImport(where: W.Where = 'current'): void {
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'import');
  if (existing && where === 'current' && shownNow(existing)) {
    setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type: 'import' }, placeWhere(where)));
}
/** Bookmarks as a page in the main area, like every other place (sweep 3, 076: it replaced the left nav). */
export function openBookmarks(where: W.Where = 'current'): void {
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'bookmarks');
  if (existing && where === 'current' && shownNow(existing)) {
    setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type: 'bookmarks' }, placeWhere(where)));
}

/** The asset store: logos, pictures, icons and documents, and the brand kit (views/AssetsPage.tsx). */
export function openAssets(where: W.Where = 'current'): void {
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'assets');
  if (existing && where === 'current' && shownNow(existing)) {
    setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type: 'assets' }, placeWhere(where)));
}

/** Ctrl+G's centre for the active tab: a clean note id, or undefined for the whole vault. A person resolves
 *  through their card to their note (anyone without a note opens whole); a project workspace resolves to its
 *  project file (projectWorkspace imports this file, so it comes dynamically, only for its own tabs). */
async function resolveGraphFocus(active: W.TabState): Promise<string | undefined> {
  // projectWorkspace imports this file, so it comes dynamically, only for its own tabs.
  const projectInFolder = active.type === 'notebook' ? (await import('./projectWorkspace')).projectInFolder : () => null;
  const ask = graphCentreForTab(active, { projectInFolder });
  if (typeof ask === 'string') return ask;
  if (ask) {
    const card = await api().life.people.card(ask.person).catch(() => null);
    return card && card.page ? card.path : undefined;
  }
  return undefined;
}

export async function openGraph(where: W.Where = 'current'): Promise<void> {
  // Opened from a page (Ctrl+G or the page's Graph, round 3): start centred on that page's note, not the whole
  // vault. Every tab shape resolves to a clean note id (9 Nov 2026: the tab path went verbatim, so a person
  // page centred on `person:person:…` - on nothing).
  const active = W.activeTab(getWorkspace());
  const focus = await resolveGraphFocus(active);
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'graph');
  if (existing && where === 'current' && shownNow(existing)) {
    setWorkspace((ws) => W.activate(focus ? W.updateTab(ws, existing.t.id, { path: focus }) : ws, existing.g.id, existing.t.id));
    return;
  }
  setWorkspace((ws) => W.open(ws, { type: 'graph', ...(focus ? { path: focus } : {}) }, placeWhere(where)));
}

/** A deep link's place (one product step 2, 8 Nov 2026): every bar place through one door, so the former host app's
 *  side bar and the window's own links open the same pages. A folder with Notes opens Notes already filtered. Step
 *  3 carries a new note through the same seam (the former host app's New menu). */
export function openPlace(place: string, folder = '', where: W.Where = 'current', fresh = false): void {
  const p = String(place || '').trim().toLowerCase();
  if (fresh) { void import('./noteTypes').then((m) => m.newNoteOfType('note', { ...(folder ? { folder } : {}), where, ask: false })); return; }
  if (p === 'today') return openToday(where);
  if (p === 'projects') return openProjects(where);
  if (p === 'tasks') return openTasks(where);
  if (p === 'graph') { void openGraph(where); return; }
  if (p === 'notes') { void import('./noteTypes').then((m) => m.openNotesFolder(folder, where)); return; }
  if (p === 'inbox') { void import('./life').then((m) => m.openInbox(where)); return; }
  if (p === 'people') { void import('./life').then((m) => m.openPeople(where)); return; }
  if (p === 'meetings') { void import('./life').then((m) => m.openMeetings(where)); return; }
}

/** Where a new note goes (Settings › Files and links): the top, the active note's folder, or a chosen folder. */
export function newNoteFolder(explicit?: string): string {
  if (explicit !== undefined) return explicit;
  const p = prefs();
  if (p.newNotePlace === 'folder') return p.newNoteFolder;
  if (p.newNotePlace === 'current') return folderOf(activePath() ?? '');
  return '';
}

/** Notes opened to have their title typed straight away. */
const titleFocus = new Set<string>();
export function takeTitleFocus(path: string): boolean {
  return titleFocus.delete(path);
}

export async function newNote(folder?: string, where: W.Where = 'current', content = '', base = 'Untitled'): Promise<string | null> {
  try {
    // A typed name past what a file keeps is fitted to leading words, said aloud (t207 pass 2: it cut silently).
    const fit = fitTypedName(base);
    const path = await api().files.create(newNoteFolder(folder), fit.name, '.md', content);
    if (fit.cut) toast('That name was shortened to fit.');
    titleFocus.add(path);
    openPath(path, { where: getWorkspace() && W.activeTab(getWorkspace()).type === 'empty' ? 'current' : where });
    void loadNotes();
    // A blank Untitled note starts by writing, from every door (5 Nov 2026, one rule): a home is
    // proposed once it has words, and closing it empty leaves nothing behind.
    if (!content && /^untitled/i.test(base)) void import('./noteTypes').then((m) => m.noteWriteFirst(path));
    return path;
  } catch (err) {
    showError(err);
    return null;
  }
}

export async function newCanvas(folder?: string, where: W.Where = 'tab'): Promise<string | null> {
  try {
    const path = await api().files.create(newNoteFolder(folder), 'Untitled canvas', '.canvas', '{"nodes":[],"edges":[]}');
    openPath(path, { where: W.activeTab(getWorkspace()).type === 'empty' ? 'current' : where });
    return path;
  } catch (err) {
    showError(err);
    return null;
  }
}

/** A new drawing (src/shared/drawing.ts; 21 Oct 2026, gap G23): freehand, shapes, arrows and labels, in a .nvdraw file. */
export async function newDrawing(folder?: string, where: W.Where = 'tab'): Promise<string | null> {
  try {
    const path = await api().files.create(newNoteFolder(folder), 'Untitled canvas', '.nvdraw');
    openPath(path, { where: W.activeTab(getWorkspace()).type === 'empty' ? 'current' : where });
    void loadFiles();
    return path;
  } catch (err) {
    showError(err);
    return null;
  }
}

/** A Markdown file from outside the vault in a tab of its own (src/main/loose-files.ts; 21 Oct 2026, gap G26): the tab
 *  showing it comes forward when there is one. A file that is in the vault opens as its note. */
export function openLoose(opened: { kind: 'loose'; file: { path: string } } | { kind: 'vault'; rel: string }, where: W.Where = 'tab'): void {
  if (opened.kind === 'vault') return openPath(opened.rel, { where, reuse: true });
  const existing = W.revealExisting(getWorkspace(), opened.file.path, 'loose');
  if (existing) return setWorkspace(existing);
  setWorkspace((ws) => W.open(ws, { type: 'loose', path: opened.file.path }, W.activeTab(ws).type === 'empty' ? 'current' : where));
}

/** Open a file…: Markdown files from anywhere on this PC. */
export async function pickLooseFiles(): Promise<void> {
  try {
    for (const opened of await api().loose.pick()) openLoose(opened);
  } catch (err) {
    showError(err);
  }
}

export async function newFolder(parent: string): Promise<string | null> {
  try {
    const path = await api().files.createFolder(parent, 'New folder');
    await loadFiles();
    return path;
  } catch (err) {
    showError(err);
    return null;
  }
}

/** Opens a [[link]]: the note or file it names; a near match by name when the case differs; or a new note when
 *  nothing matches (9.2 uplift F65: "harbour" opens "Harbour", never a silent second note). */
export async function openLink(target: string, from: string | undefined, where: W.Where = 'current'): Promise<void> {
  // A locked link to a secret (Wave 4): its card, never a note.
  if (/^secret:/i.test(target.trim())) {
    void import('../components/SecretLink').then((m) => m.showSecret(target.trim().slice(7)));
    return;
  }
  const hash = target.indexOf('#');
  const name = (hash >= 0 ? target.slice(0, hash) : target).trim();
  const heading = hash >= 0 ? target.slice(hash + 1).replace(/^\^/, '').trim() : undefined;
  try {
    if (!name) {
      if (heading && from) revealLater(from, { heading });
      if (from) openPath(from, { where });
      return;
    }
    let path = await api().files.resolve(name, from);
    // A moment of a meeting's recording (the recorder's "12:03" beside a decision): played from there.
    const moment = path && /\.(m4a|weba|webm|mp3|wav|ogg|oga|aac|flac)$/i.test(path) ? momentOf(heading) : null;
    if (path && moment !== null) {
      if (!playAt(path, moment)) openPath(path, { where });
      return;
    }
    if (!path) {
      if (/\.[a-z0-9]{2,5}$/i.test(name) && !/\.md$/i.test(name)) {
        toast(`“${name}” isn’t among your notes.`);
        return;
      }
      // A near match by name (the case differs, or the link shortened it): open it — or pick, when several.
      const near = getState().notes.filter((n) => n.title.toLowerCase() === name.toLowerCase());
      if (near.length === 1) {
        toast(`Opened “${near[0].title}”.`);
        openPath(near[0].path, { where, heading });
        return;
      }
      if (near.length > 1) {
        const { pickFile } = await import('../components/Pickers');
        const chose = await pickFile(`“${name}” names ${plural(near.length, 'note')}. Which one?`, near.map((n) => n.path), (p) => getState().byPath.get(p)?.title ?? titleOf(p));
        if (chose) openPath(chose, { where, heading });
        return;
      }
      // A Systems record folded into a list still opens from its link (before a new note is made for the name).
      const row = await workCall<string | null>('systems', 'resolve-row', name).catch(() => null);
      if (row) {
        openPath(row, { where });
        return;
      }
      const folder = name.includes('/') ? '' : newNoteFolder();
      path = await api().files.create(folder ? `${folder}/${folderOf(name)}`.replace(/\/$/, '') : folderOf(name), nameOf(name).replace(/\.md$/i, ''), '.md', '');
      void loadNotes();
    }
    // A link to a view's form (8.8, [[Views/Bakes.view.json#form]]): the view opens, with its form over it.
    if (heading?.toLowerCase() === 'form' && path) {
      const { isViewPath } = await import('../../../shared/views');
      if (isViewPath(path)) {
        openPath(path, { where });
        void import('../views/saved/FormDialog').then((m) => m.openFormDialog({ viewPath: path! }));
        return;
      }
    }
    openPath(path, { where, heading });
  } catch (err) {
    showError(err);
  }
}

/**
 * Renames or moves a note, file or folder. Links to it are brought up to date (asking first when Settings say so), and
 * open tabs, bookmarks and unsaved changes follow it.
 */
export async function movePath(from: string, to: string): Promise<string | null> {
  if (!to || to === from) return from;
  // A private note is renamed inside the encrypted store (its name is private too; nothing links to it).
  if (isPrivatePath(from)) {
    try {
      await docs.flush(from);
      const next = await api().private.rename(from, to);
      await docs.renamed(from, next);
      noteMoved(from, next);
      setWorkspace((ws) => W.renamed(ws, from, next));
      const { reloadPrivateList } = await import('./private');
      await reloadPrivateList();
      return next;
    } catch (err) {
      showError(err);
      return null;
    }
  }
  try {
    await docs.settle();
    let update = prefs().linkUpdate !== 'never';
    if (prefs().linkUpdate === 'ask') {
      const { links, notes } = await api().files.linksInto(from);
      if (links) {
        const answer = await choose(
          'Update links?',
          [
            { id: 'no', label: 'Don’t update' },
            { id: 'yes', label: `Update ${links === 1 ? 'the link' : `${links} links`}`, primary: true },
          ],
          `${links === 1 ? 'One link' : `${links} links`} in ${notes === 1 ? 'one note' : `${notes} notes`} point here.`,
        );
        if (answer === null) return null;
        update = answer === 'yes';
      }
    }
    const result = await api().files.move(from, to, update);
    await docs.renamed(from, result.path);
    noteMoved(from, result.path);
    setWorkspace((ws) => W.renamed(ws, from, result.path));
    bookmarksRenamed(from, result.path);
    // A PDF's highlights note goes with it, so its highlights stay its own (views/pdf; 19 Oct 2026, 5.0.0).
    const notePath = /\.pdf$/i.test(from) && /\.pdf$/i.test(result.path) ? sidecarPathFor(from) : null;
    if (notePath && getState().byPath.has(notePath)) {
      const moved = await api().files.move(notePath, sidecarPathFor(result.path), update).catch(() => null);
      if (moved) {
        await docs.renamed(notePath, moved.path);
        setWorkspace((ws) => W.renamed(ws, notePath, moved.path));
        bookmarksRenamed(notePath, moved.path);
      }
    }
    await Promise.all([loadNotes(), loadFiles()]);
    if (result.linksUpdated) toast(`Updated ${result.linksUpdated === 1 ? 'one link' : `${result.linksUpdated} links`} in ${result.notesUpdated === 1 ? 'one note' : `${result.notesUpdated} notes`}.`);
    return result.path;
  } catch (err) {
    showError(err);
    return null;
  }
}

/** Renames in place: the same folder, a new name (the extension kept unless typed). A name ending in a dot or a
 *  space loses it (Windows strips those, which broke a meeting's recording, r2 Nov 2026); nothing left means no rename. */
export async function renamePath(path: string, newName: string): Promise<string | null> {
  const clean = stripTrailingDots(newName.trim().replace(/[\\/]/g, '-'));
  if (!clean) return null;
  const isFolder = getState().folders.includes(path);
  const ext = isFolder ? '' : (/\.view\.json$/i.exec(nameOf(path))?.[0] ?? /\.[^./]+$/.exec(nameOf(path))?.[0] ?? '');
  const withExt = isFolder || /\.[a-z0-9]{1,8}$/i.test(clean) && clean.toLowerCase().endsWith(ext.toLowerCase()) ? clean : clean + ext;
  const dest = folderOf(path) ? `${folderOf(path)}/${withExt}` : withExt;
  return movePath(path, dest);
}

export async function askRename(path: string): Promise<void> {
  const isFolder = getState().folders.includes(path);
  const name = isFolder ? nameOf(path) : titleOf(path);
  const answer = await prompt(isFolder ? 'Rename folder' : 'Rename', { value: name, ok: 'Rename' });
  if (answer) await renamePath(path, answer);
}

export async function askMove(path: string): Promise<void> {
  const { folders } = getState();
  const { pickFolder } = await import('../components/Pickers');
  const folder = await pickFolder(folders, path);
  if (folder === null) return;
  await movePath(path, folder ? `${folder}/${nameOf(path)}` : nameOf(path));
}

export async function trashPath(path: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
  if (isPrivatePath(path)) {
    if (prefs().confirmDelete && !(await confirm(`Delete “${titleOf(path)}”?`, { message: 'It goes to the Bin still encrypted: only your private notes can open it.', ok: 'Delete', danger: true }))) return false;
    try {
      await api().private.remove(path);
      docs.forget(path);
      noteRemoved(path);
      setWorkspace((ws) => W.removed(ws, (p) => p !== path));
      const { reloadPrivateList } = await import('./private');
      await reloadPrivateList();
      return true;
    } catch (err) {
      showError(err);
      return false;
    }
  }
  const isFolder = getState().folders.includes(path);
  // Easy delete (5.2.0): a note, canvas or view goes at once with Undo on the message; a folder or another file still
  // asks first when Ask before deleting is on. Everything goes to Recently deleted (the vault's own Bin, 30 days), and
  // Undo restores it from there, its Files with it. The kept copy is what the person sees (W5-4): unsaved words in the
  // open note first, the disk second.
  const kept = !isFolder && /\.(md|canvas|json|txt|csv)$/i.test(path) ? (docs.text(path) ?? (await api().files.readText(path).catch(() => null))) : null;
  try {
    if (prefs().confirmDelete && (isFolder || kept === null || kept.length >= 5_000_000)) {
      const inside = isFolder ? getState().files.filter((f) => f.rel.startsWith(`${path}/`)).length : 0;
      const { links } = await api().files.linksInto(path).catch(() => ({ links: 0, notes: 0 }));
      const words = [
        isFolder ? (inside ? `The folder and the ${inside === 1 ? 'file' : `${inside} files`} in it go to Recently deleted, where they stay for 30 days.` : 'The folder goes to Recently deleted, where it stays for 30 days.') : 'It goes to Recently deleted, where it stays for 30 days.',
        links ? `${links === 1 ? 'One link points' : `${links} links point`} here and will stop working.` : '',
      ].filter(Boolean).join(' ');
      const ok = await confirm(`Delete “${isFolder ? nameOf(path) : titleOf(path)}”?`, { message: words, ok: 'Delete', danger: true });
      if (!ok) return false;
    }
    // Saved first, let go only once it is gone (20 Nov 2026 audit): forgetting before the delete meant a delete that
    // failed left the open tab saving nothing, and a folder's open notes were never saved or let go at all.
    await docs.flushUnder(path);
    const binId = await api().files.trash(path);
    docs.forgetUnder(path);
    noteRemoved(path);
    const gone = (p: string) => p === path || p.startsWith(`${path}/`);
    setWorkspace((ws) => W.removed(ws, (p) => !gone(p)));
    await Promise.all([loadNotes(), loadFiles()]);
    const title = isFolder ? nameOf(path) : titleOf(path);
    // Quiet (Nov 2026 break): an empty write-first note closed says nothing — there is nothing to undo.
    if (!opts.quiet) toast(isFolder ? `Deleted the folder “${title}”. It stays in Recently deleted for 30 days.` : `Deleted “${title}”. It stays in Recently deleted for 30 days.`, { label: 'Undo', run: () => void bringBack(path, kept, title, binId) }, 9000);
    return true;
  } catch (err) {
    showError(err);
    return false;
  }
}

/** Several notes at once (a module table's selected rows, 26 Oct 2026 uplift): each to Recently deleted, one message
 *  with one Undo that restores every one of them from there. Private notes and folders go one at a time through trashPath.
 *  One bulk-delete contract (9.2 uplift F66): failures are excluded from the count with their own words, tabs of
 *  failed paths stay open, and Undo says exactly what came back. */
export async function trashPaths(paths: string[]): Promise<number> {
  const plain = paths.filter((p) => !isPrivatePath(p) && !getState().folders.includes(p));
  const kept: [string, string | null, string][] = [];
  const trashed: string[] = [];
  const failed: string[] = [];
  for (const p of plain) {
    const text = /\.(md|canvas|json|txt|csv)$/i.test(p) ? (docs.text(p) ?? (await api().files.readText(p).catch(() => null))) : null;
    try {
      await docs.flush(p);
      const binId = await api().files.trash(p);
      docs.forget(p);
      noteRemoved(p);
      trashed.push(p);
      kept.push([p, text, binId]);
    } catch {
      failed.push(p);
    }
  }
  const gone = new Set(trashed);
  setWorkspace((ws) => W.removed(ws, (p) => !gone.has(p)));
  await Promise.all([loadNotes(), loadFiles()]);
  for (const p of paths.filter((x) => !plain.includes(x))) await trashPath(p);
  if (trashed.length || failed.length) {
    const said = trashed.length ? (trashed.length === 1 ? `Deleted “${titleOf(trashed[0])}”. It stays in Recently deleted for 30 days.` : `Deleted ${trashed.length} things. They stay in Recently deleted for 30 days.`) : '';
    const sorry = failed.length ? ` ${failed.length === 1 ? `“${titleOf(failed[0])}”` : `${failed.length} things`} couldn't be deleted.` : '';
    const undo = !kept.length
      ? undefined
      : {
          label: 'Undo',
          run: () => void bringBackMany(kept, trashed.length),
        };
    toast(`${said}${sorry}`, undo, 9000);
  }
  return trashed.length;
}

/** Undo on a delete's message: restored from Recently deleted (its Files with it); unsaved words the person saw kept over it. */
async function bringBack(path: string, kept: string | null, title: string, binId: string): Promise<void> {
  try {
    const at = await restoreFromBin(path, kept, binId);
    await Promise.all([loadNotes(), loadFiles()]);
    toast(`“${title}” is back.`, { label: 'Open', run: () => openPath(at) });
  } catch (err) {
    // Already back (restored from Recently deleted meanwhile): said, not an error. Otherwise the words still come back.
    const there = await api().files.readText(path).catch(() => null);
    if (there !== null) {
      await Promise.all([loadNotes(), loadFiles()]);
      toast(`“${title}” is already back.`, { label: 'Open', run: () => openPath(path) });
      return;
    }
    if (kept !== null) {
      try {
        await api().files.writeText(path, kept);
        await Promise.all([loadNotes(), loadFiles()]);
        toast(`“${title}” is back.`, { label: 'Open', run: () => openPath(path) });
        return;
      } catch {
        // The first error says it.
      }
    }
    showError(err);
  }
}

/** One thing back from Recently deleted by its Bin id (beside it when something took its place). Returns where it came back. */
export async function restoreBinItem(binId: string, path: string): Promise<string> {
  const r = (await api().bin.call({ action: 'restore', id: binId, type: 'vault' })) as { restored?: string } | null;
  return typeof r?.restored === 'string' && r.restored ? r.restored : path;
}

/** One deleted thing restored from Recently deleted by its Bin id (beside it when something took its place); unsaved
 *  words kept over the restored note. Returns where it came back. */
async function restoreFromBin(path: string, kept: string | null, binId: string): Promise<string> {
  const at = await restoreBinItem(binId, path);
  if (kept !== null) {
    const back = await api().files.readText(at).catch(() => null);
    if (back !== null && back !== kept) await api().files.writeText(at, kept);
  }
  return at;
}

/** Undo on a bulk delete's message: each restored from Recently deleted, saying exactly what came back. */
async function bringBackMany(kept: [string, string | null, string][], trashed: number): Promise<void> {
  let back = 0;
  for (const [p, text, binId] of kept) {
    try {
      await restoreFromBin(p, text, binId);
      back++;
    } catch {
      // Already back (restored from Recently deleted meanwhile): counted, as one delete's Undo says.
      const there = await api().files.readText(p).catch(() => null);
      if (there !== null) back++;
    }
  }
  await Promise.all([loadNotes(), loadFiles()]);
  toast(back === trashed ? `${back === 1 ? 'It is' : `All ${back} are`} back.` : `Brought back ${back} of ${trashed}; the rest are in Recently deleted.`);
}

export async function duplicatePath(path: string): Promise<void> {
  try {
    await docs.settle();
    const copy = await api().files.duplicate(path);
    await Promise.all([loadNotes(), loadFiles()]);
    if (!getState().folders.includes(copy)) openPath(copy);
  } catch (err) {
    showError(err);
  }
}

export async function openDaily(): Promise<void> {
  try {
    const path = await api().daily.open();
    await loadNotes();
    openPath(path, { reuse: true });
  } catch (err) {
    showError(err);
  }
}

/** Another day's note, days from today (Yesterday and Tomorrow on a daily note): made from the template when
 *  missing, as today's. */
export async function openDailyOffset(days: number): Promise<void> {
  try {
    const iso = offsetIsoDay(isoDay(new Date()), days);
    const path = await api().daily.open(iso);
    await loadNotes();
    openPath(path, { reuse: true });
  } catch (err) {
    showError(err);
  }
}

export function openRandom(): void {
  const notes = getState().notes;
  if (!notes.length) return;
  const current = activePath();
  const pool = notes.length > 1 ? notes.filter((n) => n.path !== current) : notes;
  openPath(pool[Math.floor(Math.random() * pool.length)].path);
}

/** A note named by the date and time (for quick capture), in the new-note folder. */
export async function uniqueNote(): Promise<void> {
  await newNote(undefined, 'current', '', formatDate('YYYYMMDDHHmmss'));
}

export async function revealInSystem(path: string): Promise<void> {
  try {
    await api().files.reveal(path);
  } catch (err) {
    showError(err);
  }
}

export async function openInDefaultApp(path: string): Promise<void> {
  try {
    await api().files.openDefault(path);
  } catch (err) {
    showError(err);
  }
}

export async function copyPath(path: string, absolute = false): Promise<void> {
  try {
    await navigator.clipboard.writeText(absolute ? await api().files.absolute(path) : path);
    toast('Copied.');
  } catch (err) {
    showError(err);
  }
}

/** Puts a file in the file list into view (its folders opened). */
let revealFileHandler: ((path: string) => void) | null = null;
export function onRevealInExplorer(fn: ((path: string) => void) | null): void {
  revealFileHandler = fn;
}
export function revealInExplorer(path: string): void {
  // In the former host app's window the file list is gone (one product step 2): the folder opens in
  // Notes instead.
  if (inVaultView()) { void import('./noteTypes').then((m) => m.openNotesFolder(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')); return; }
  showSide('left', 'files');
  setTimeout(() => revealFileHandler?.(path), 30);
}
