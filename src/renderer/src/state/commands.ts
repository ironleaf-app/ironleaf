// Every command Ironleaf has, with its default keys: the command list (Ctrl+K), the keys (changeable in Settings ›
// Keys), and the menus all run the same commands.

import { isDocPath } from '../lib/docPath';
import { resolveNote } from '../lib/resolve';
import { pdfChoices } from '../../../shared/pdf-highlights';
import { isProjectProps } from '../../../shared/project-file';
import { isPrivatePath } from '../../../shared/private';
import { fitTypedName } from '../../../shared/paths';
import { stepSize } from '../../../shared/interface-size';
import { writeLink } from '../lib/links';
import type { DictateEvent } from '../lib/dictation';
import { closeSearchPanel, openSearchPanel } from '@codemirror/search';
import { copyLineDown, copyLineUp, deleteLine, moveLineDown, moveLineUp, selectLine } from '@codemirror/commands';
import { foldAll, unfoldAll } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { prompt } from '../components/Dialogs';
import type { IconName } from '../components/Icon';
import { pick, pickFile } from '../components/Pickers';
import { goToNoteFoot } from '../components/NoteFoot';
import { addCursor, cycleTask, insertCallout, insertCodeBlock, insertDate, insertFootnote, insertLink, insertMathBlock, insertMermaid, insertRule, insertTable, setHeading, tableCommand, toggleBullet, toggleMark, toggleNumbered, toggleQuote } from '../editor/commands';
import { focusFormatBar } from '../editor/formatBar';
import { bodyOfTemplate, noteFromTemplate, splitFront } from '../../../shared/templates';
import { VIEWS_FOLDER } from '../../../shared/views';
import { takeCursor } from '../../../shared/template-fields';
import { moduleInfo } from '../../../shared/life-modules';
import { askTemplateAnswers } from './templateFields';
import { openAboutPage } from '../components/about/aboutState';
import { openAccountPage, signInFromAnywhere } from '../components/account/accountState';
import { CAPTURE_COMMANDS } from './captureFlows';
import { fuzzyFilter } from '../lib/fuzzy';
import { readRecent, survivorId, withRecentUsed } from '../lib/commandAliases';
import { currentProject, newNoteFromTemplate, newProject, noteTemplates, openTemplates, saveAsTemplate } from './templates';
import { chooseType, newNoteOfType, newNoteWriteFirst, openTypePage } from './noteTypes';
import { recorderView, startRecording } from './recorder';
import { isBusy } from '../../../shared/recorder';
import { isMeetingNote } from '../../../shared/meetings';
import { meetingName } from '../../../shared/hub';
import * as A from './actions';
import { addBookmark, isBookmarked, toggleBookmark } from './bookmarks';
import { docs } from './docs';
import { editorFor, getWorkspace, setWorkspace } from './layout';
import { openModal, requestSearch } from './modals';
import { openModule } from './modules';
import { getState, loadNotes, prefs, savePrefs, showError, toast } from './store';
import * as W from './workspace';
import { setRail, showSide, toggleChat, toggleSide } from './fit';
import { flashSaved } from './saveNotice';
import { discardSuggestion, keepSuggestion, moveSuggestion, suggestionsOf } from './suggestions';
import { openTour } from './moduleFills';
import { moduleOfTab } from './module-tabs';
import { inVaultView } from '../lib/inWindow';

export interface CommandContext {
  tab: W.TabState;
  path?: string;
  view?: EditorView | null;
}

export interface Command {
  id: string;
  name: string;
  /** An alias of another command (8 Nov 2026, the quiet More): it still runs by its id and its keys still fire,
   *  but the browsing lists (search, Settings › Keys, Settings search, Ctrl+K with nothing typed) show the
   *  named command once instead. Ctrl+K with words typed matches it by its own name (t21: search finding the
   *  door). The value names the survivor. */
  aliasOf?: string;
  hotkey?: string;
  /** Second default combos that also run it (the person's own choice replaces the first, never these;
   *  5 Nov 2026, one search door: the panel answers to Ctrl+K, Ctrl+O and Ctrl+P, so one string no longer holds them). */
  also?: string | string[];
  icon?: IconName;
  /** Needs a note open for editing (Live Preview or Source). */
  editor?: boolean;
  /** Needs a note in the active tab. */
  note?: boolean;
  /** Needs a file (note, canvas, picture…) in the active tab. */
  file?: boolean;
  /** Copies or sends the note out of where it is kept (a copy, an export, a link, the AI, the former host app): never for
   *  a private note (src/main/private-notes.ts). */
  outward?: boolean;
  /** Only when this is true. */
  when?(): boolean;
  run(ctx: CommandContext): unknown;
}

export function commandContext(): CommandContext {
  const ws = getWorkspace();
  const tab = W.activeTab(ws);
  const editor = editorFor(tab.id);
  const mode = tab.mode ?? prefs().defaultMode;
  return { tab, path: tab.path, view: tab.type === 'note' && mode !== 'reading' ? editor?.view() ?? null : null };
}

export function available(cmd: Command, ctx: CommandContext = commandContext()): boolean {
  if (cmd.editor && !ctx.view) return false;
  if (cmd.note && ctx.tab.type !== 'note') return false;
  if (cmd.file && !ctx.path) return false;
  if (cmd.outward && isPrivatePath(ctx.path)) return false;
  if (cmd.when && !cmd.when()) return false;
  return true;
}

/** The keys a command uses now (the person's choice, else its default). */
export function hotkeyOf(cmd: Command): string | undefined {
  const own = prefs().hotkeys[cmd.id];
  if (own !== undefined) return own || undefined;
  return cmd.hotkey;
}

/** Every extra default combo that also runs it (one string or a list, read the same way). */
export function alsoKeys(cmd: Command): string[] {
  if (!cmd.also) return [];
  return Array.isArray(cmd.also) ? cmd.also : [cmd.also];
}

/** The commands the browsing lists show (8 Nov 2026, the quiet More): every command except the aliases, which
 *  still run by id and by their keys. Search and Settings › Keys read this, never COMMANDS; Ctrl+K reads it
 *  with nothing typed, and every command once words are typed. */
export function listedCommands(): Command[] {
  return COMMANDS.filter((c) => !c.aliasOf);
}

const ed = (fn: (view: EditorView) => unknown) => (ctx: CommandContext) => {
  if (!ctx.view) return;
  fn(ctx.view);
  // A command that puts the focus somewhere of its own (Find opens its box) keeps it there (t136, 9 Nov 2026:
  // focusing back here left the Find box open but typing in the note). Everything else takes the keys back.
  const at = document.activeElement;
  if (at && at !== ctx.view.contentDOM && !ctx.view.contentDOM.contains(at) && ctx.view.dom.contains(at)) return;
  ctx.view.focus();
};

const setPanel = (side: 'left' | 'right', panel: string) => (side === 'left' ? showSide('left', panel as W.LeftPanel) : showSide('right', panel as W.RightPanel));

function setMode(tabId: string, mode: W.TabState['mode']): void {
  setWorkspace((ws) => W.updateTab(ws, tabId, { mode }));
}

/** The project a note belongs to (its path): the project file itself, or the project whose folder the note is
 *  in. Paths end to end (9.2 uplift F64): the name is read off the resolved file, never matched through. */
function projectOfNote(path: string): string | undefined {
  const notes = getState().notes.filter((n) => isProjectProps(n.props));
  const own = notes.find((n) => n.path === path);
  if (own) return own.path;
  return notes.filter((n) => A.folderOf(n.path) && path.startsWith(`${A.folderOf(n.path)}/`)).sort((a, b) => b.path.length - a.path.length)[0]?.path;
}

/** Inserts a note template (the Templates page lists them) at the cursor, its {{title}}, {{date}} and {{project}} filled:
 * into an empty note with its properties, into one with words already just its words. Report layouts and project shapes
 * aren't offered (they aren't a note's words); the person's own come first, the ones changed lately first. */
export async function insertTemplate(view: EditorView, path: string): Promise<void> {
  const templates = await noteTemplates().catch(() => []);
  if (!templates.length) {
    const folder = prefs().templatesFolder;
    toast(folder ? `No note templates yet: notes in the “${folder}” folder are your templates.` : 'No templates yet.', { label: 'Templates', run: () => openTemplates() });
    return;
  }
  const chosen = await pick({
    placeholder: 'Insert which template?',
    items: (q) => fuzzyFilter(templates, q, (t) => `${t.name} ${t.description}`).map((t) => ({ id: t.path, label: t.name, detail: t.description || A.folderOf(t.path), icon: 'template' as const })),
    footer: '↑↓ to move · Enter to insert · Esc to cancel',
  });
  if (!chosen) return;
  const text = docs.text(chosen) ?? (await window.nv.notes.read(chosen));
  const { dateFormat, timeFormat } = prefs();
  // Its prompts asked for and its AI fields written (state/templateFields.ts; 21 Oct 2026, gap G27), then the cursor
  // put where its {{cursor}} was.
  const project = projectOfNote(path);
  const answers = await askTemplateAnswers(text, { template: chosen, name: templates.find((t) => t.path === chosen)?.name ?? A.titleOf(chosen), title: A.titleOf(path), project, target: path });
  if (!answers) return view.focus();
  const vars = { title: A.titleOf(path), dateFormat, timeFormat, project: project ? getState().byPath.get(project)?.title : undefined, answers: { ...answers, cursor: true } };
  const empty = !view.state.doc.toString().trim();
  const made = takeCursor(empty ? noteFromTemplate(text, vars) : bodyOfTemplate(text, vars));
  const from = empty ? 0 : view.state.selection.main.from;
  view.dispatch(empty ? { changes: { from: 0, to: view.state.doc.length, insert: made.text } } : view.state.replaceSelection(made.text));
  if (made.cursor) view.dispatch({ selection: { anchor: from + made.cursor.offset }, scrollIntoView: true });
  view.focus();
}

/** Merges the open note into another: its text added at the end, links to it pointed there, then it goes to the bin. */
async function mergeInto(path: string): Promise<void> {
  const others = getState().notes.filter((n) => n.path !== path).map((n) => n.path);
  const target = await pickFile('Merge this note into which note?', others, A.titleOf);
  if (!target) return;
  try {
    await docs.settle();
    const [mine, theirs] = await Promise.all([window.nv.notes.read(path), docs.text(target) ?? window.nv.notes.read(target)]);
    // The merged note's properties come along (9.2 uplift F63): what the target lacks is added; where both say a
    // thing differently the target's stays and the clash is said.
    const mineFront = splitFront(mine);
    const theirsFront = splitFront(theirs);
    const have = new Map((theirsFront.lines ?? []).map((l) => [l.split(':')[0].trim().toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
    const carry: string[] = [];
    const clashes: string[] = [];
    for (const line of mineFront.lines ?? []) {
      const key = line.split(':')[0].trim();
      if (!key || key.startsWith('#') || /^\s/.test(line) || key.startsWith('-') || !line.includes(':')) continue;
      if (!have.has(key.toLowerCase())) {
        carry.push(line);
        have.set(key.toLowerCase(), line.slice(line.indexOf(':') + 1).trim());
      } else if (have.get(key.toLowerCase()) !== line.slice(line.indexOf(':') + 1).trim()) {
        clashes.push(key);
      }
    }
    const frontLines = theirsFront.lines ? [...theirsFront.lines, ...carry] : carry;
    const front = frontLines.length ? `---\n${frontLines.join('\n')}\n---\n` : '';
    const joined = `${front}${(theirsFront.lines ? theirsFront.body : theirs).replace(/\s*$/, '')}\n\n${mineFront.body.trim()}\n`;
    await window.nv.notes.write(target, joined);
    await docs.changedOnDisk([target]);
    if (clashes.length) toast(`Merged into “${A.titleOf(target)}”, but ${clashes.map((k) => `“${k}”`).join(', ')} differed; the target’s was kept.`, undefined, 7000);
    // Links to the merged note now reach the note it went into.
    const moved = await window.nv.files.move(path, `${A.folderOf(path) ? `${A.folderOf(path)}/` : ''}${A.titleOf(path)} (merged ${Date.now()}).md`, false);
    docs.forget(path);
    // Links to the merged note now reach the note it went into, matched by resolved path (same-titled strangers untouched).
    for (const n of getState().notes) {
      if (n.path === path || !n.links.some((l) => resolveNote(l.target, n.path) === path)) continue;
      const text = await window.nv.notes.read(n.path);
      const next = text.replace(/(!?)\[\[([^[\]|#\n]+)((?:#[^[\]|\n]*)?)((?:\|[^[\]\n]*)?)\]\]/g, (all, bang: string, name: string, heading: string, alias: string) => (resolveNote(name.trim(), n.path) === path ? `${bang}[[${A.titleOf(target)}${heading}${alias}]]` : all));
      if (next !== text) {
        await window.nv.notes.write(n.path, next);
        await docs.changedOnDisk([n.path]);
      }
    }
    await window.nv.files.trash(moved.path);
    setWorkspace((ws) => W.renamed(ws, path, target));
    await loadNotes();
    toast(`Merged into “${A.titleOf(target)}”. The old note is in Recently deleted.`);
  } catch (err) {
    showError(err);
  }
}

/** The selection becomes a note of its own, linked (or embedded) where it was. */
async function extractSelection(view: EditorView, path: string): Promise<void> {
  const sel = view.state.selection.main;
  if (sel.empty) {
    toast('Select the words to move into a new note first.');
    return;
  }
  const text = view.state.sliceDoc(sel.from, sel.to);
  const firstLine = text.split('\n')[0].replace(/^#+\s*/, '').replace(/[\\/:*?"<>|#^[\]]/g, '').trim().slice(0, 60);
  const name = await prompt('Move the selection to a new note', { value: firstLine || 'New note', ok: 'Make the note' });
  if (!name) return;
  // A typed name past what a file keeps is fitted to leading words, said aloud (t207 pass 2: it cut silently).
  const fit = fitTypedName(name);
  try {
    const created = await window.nv.files.create(A.folderOf(path), fit.name, '.md', text.replace(/^#+\s.*\n?/, (h) => (h.replace(/^#+\s*/, '').trim() === name ? '' : h)));
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: writeLink(created, path) } });
    await loadNotes();
    toast(`Moved to “${A.titleOf(created)}”.${fit.cut ? ' That name was shortened to fit.' : ''}`, { label: 'Open', run: () => A.openPath(created, { where: 'tab' }) });
  } catch (err) {
    showError(err);
  }
}

/** Whether the assistant's suggested changes wait in the note in the active tab. */
const waitingHere = () => !!suggestionsOf(W.activeTab(getWorkspace()).path);

/** The project shown in the active tab (its page or its note). */
function activeProjectPath(): string | null {
  const tab = W.activeTab(getWorkspace());
  return tab.type === 'note' && tab.path && isProjectProps(getState().byPath.get(tab.path)?.props) ? tab.path : null;
}

export const COMMANDS: Command[] = [
  // Finding and making notes
  // One search door (5 Nov 2026): the centred bar's panel answers to Ctrl+K, Ctrl+O and Ctrl+P alike; Open a note
  // keeps no default key and lives in the panel, where its aliases, files and make-a-note still run. A key the
  // person gave Open a note themselves stays theirs (hotkeyOf reads it first).
  { id: 'switcher', name: 'Open a note…', icon: 'search', run: () => openModal({ kind: 'switcher' }) },
  { id: 'palette', name: 'Ask or find anything', hotkey: 'Mod+K', also: ['Mod+O', 'Mod+P'], icon: 'command', run: () => openModal({ kind: 'palette' }) },
  // New note writes first (5 Nov 2026, one rule): no kind or folder asked; the same filing proposes
  // a home after. "What is it?" stays on the other New commands for those who want it.
  { id: 'new-note', name: 'New note', hotkey: 'Mod+N', icon: 'filePlus', run: () => void newNoteWriteFirst() },
  // New is one door (8 Nov 2026, the quiet More): the note's kind, tab and template are chosen inline,
  // so the one-off note commands below are aliases of New note. Each still runs by its id.
  { id: 'new-note-tab', name: 'New note in a new tab', aliasOf: 'new-note', hotkey: 'Mod+Shift+N', icon: 'filePlus', run: () => void newNoteWriteFirst('tab') },
  { id: 'new-plain-note', name: 'New blank note', aliasOf: 'new-note', icon: 'filePlus', run: () => void newNoteOfType('note') },
  { id: 'new-person', name: 'New person', aliasOf: 'new-note', icon: 'person', when: () => getState().canEdit, run: () => void newNoteOfType('person') },
  { id: 'new-meeting', name: 'New meeting', aliasOf: 'new-note', icon: 'calendar', when: () => getState().canEdit, run: () => void newNoteOfType('meeting') },
  // Record a meeting (21 Oct 2026, gap G18): the meeting note open now, else a new one for today, recording at once.
  { id: 'record-meeting', name: 'Record a meeting', icon: 'mic', when: () => getState().canEdit && !isBusy(recorderView()), run: () => void recordMeetingNow() },
  { id: 'new-resource', name: 'New resource (a link, book, PDF or article)', aliasOf: 'new-note', icon: 'book', when: () => getState().canEdit, run: () => void newNoteOfType('resource') },
  { id: 'new-idea', name: 'New idea', aliasOf: 'new-note', icon: 'bulb', when: () => getState().canEdit, run: () => void newNoteOfType('idea') },
  { id: 'open-note-type', name: 'Open a note type (people, meetings, ideas…)', icon: 'layers', run: () => void chooseType({ open: true }).then((id) => id && openTypePage(id)) },
  { id: 'new-note-from-template', name: 'New note from a template…', aliasOf: 'new-note', icon: 'template', when: () => getState().canEdit, run: () => void newNoteFromTemplate() },
  { id: 'templates', name: 'Open the Templates page', icon: 'template', run: () => openTemplates(currentProject()) },
  // Starter templates (8.8, src/shared/starter-templates.ts): ten one-click starts, each in a folder the person names.
  { id: 'starter-template', name: 'Start from a template…', icon: 'template', when: () => getState().canEdit, run: () => openModal({ kind: 'starter-picker' }) },
  // A project and a doc are kinds the New door offers (8 Nov 2026, the quiet More): the window and the
  // steps are the same ones, reached inline, so these are aliases of New note. Projects home and the Files
  // panel's Docs keep their own New buttons too.
  { id: 'new-project', name: 'New project…', aliasOf: 'new-note', icon: 'layers', when: () => getState().canEdit, run: () => newProject() },
  // Docs (src/shared/doc-file.ts): how something is set up and run.
  { id: 'new-doc', name: 'New doc…', aliasOf: 'new-note', icon: 'doc', when: () => getState().canEdit, run: () => void import('./docKind').then((d) => d.newDoc()) },
  { id: 'doc-canvas', name: 'Show this doc as a canvas', icon: 'canvas', when: () => isDocPath(W.activeTab(getWorkspace()).path), run: () => void import('./docKind').then((d) => d.showDocCanvas(W.activeTab(getWorkspace()).path!)) },
  { id: 'doc-canvas-update', name: 'Update canvas from doc', icon: 'refresh', when: () => getState().canEdit && isDocPath(W.activeTab(getWorkspace()).path), run: () => void import('./docKind').then((d) => d.updateDocCanvas(W.activeTab(getWorkspace()).path!)) },
  { id: 'project-to-doc', name: 'Turn this project into a doc…', icon: 'doc', when: () => getState().canEdit && !!activeProjectPath(), run: () => void import('./docKind').then((d) => d.turnIntoDoc(activeProjectPath()!)) },
  { id: 'doc-to-project', name: 'Turn this doc into a project…', icon: 'layers', when: () => getState().canEdit && isDocPath(W.activeTab(getWorkspace()).path), run: () => void import('./docKind').then((d) => d.turnIntoProject(W.activeTab(getWorkspace()).path!)) },
  { id: 'new-canvas', name: 'New canvas', icon: 'canvas', run: () => void A.newCanvas() },
  // Drawings (src/shared/drawing.ts; 21 Oct 2026, gap G23): freehand, shapes, arrows and labels.
  { id: 'new-drawing', name: 'New drawing', icon: 'pencil', when: () => getState().canEdit, run: () => void A.newDrawing() },
  // A Markdown file from anywhere on this PC, opened where it is (21 Oct 2026, gap G26).
  { id: 'open-file', name: 'Open a Markdown file from this PC…', hotkey: 'Mod+Shift+O', icon: 'file', run: () => void A.pickLooseFiles() },
  // A PDF among the notes, in the Vault's own reader (31 Oct 2026, 8.9 read and highlight PDFs in the Vault).
  { id: 'open-pdf', name: 'Open a PDF in the reader…', icon: 'pdf', run: () => void openPdf() },
  // Views over notes (src/shared/views.ts): a table, a board or a calendar of notes by their properties.
  { id: 'new-view', name: 'New view of notes (table, cards, list, board or calendar)…', icon: 'views', when: () => getState().canEdit, run: () => void import('./savedViews').then((v) => v.newView()) },
  // One view command (8 Nov 2026, the quiet More): a view's layout is switched where it is shown, so the
  // layout's own commands are aliases of New view. Each still makes its layout straight away by its id.
  { id: 'new-view-board', name: 'New board of notes…', aliasOf: 'new-view', icon: 'board', when: () => getState().canEdit, run: () => void import('./savedViews').then((v) => v.newView({ layout: 'board' })) },
  { id: 'new-view-calendar', name: 'New calendar of notes…', aliasOf: 'new-view', icon: 'calendar', when: () => getState().canEdit, run: () => void import('./savedViews').then((v) => v.newView({ layout: 'calendar' })) },
  { id: 'import-csv', name: 'Import CSV… (each row a note, with a table of them)', aliasOf: 'import', icon: 'table', when: () => getState().canEdit, run: () => void import('./importCsv').then((m) => m.importCsv()) },
  { id: 'new-view-cards', name: 'New cards of notes…', aliasOf: 'new-view', icon: 'grid', when: () => getState().canEdit, run: () => void import('./savedViews').then((v) => v.newView({ layout: 'cards' })) },
  // Saved views are files the person owns (8.8): this opens their folder in the file list.
  { id: 'open-views-folder', name: 'Open the Views folder', icon: 'folder', run: () => A.revealInExplorer(VIEWS_FOLDER) },
  // Made where folders are (8 Nov 2026, the quiet More): every folder menu and the Files panel keep their
  // own New folder, so this is an alias of Show your files.
  { id: 'new-folder', name: 'New folder', aliasOf: 'files', icon: 'folderPlus', run: async () => { const f = await A.newFolder(A.newNoteFolder()); if (f) A.revealInExplorer(f); } },
  { id: 'daily', name: 'Open the daily note', hotkey: 'Mod+Shift+D', icon: 'calendar', run: () => void A.openDaily() },
  // Quick capture (src/main/capture.ts): the box the Windows-wide key opens, from inside Ironleaf too.
  { id: 'quick-capture', name: 'Quick capture', icon: 'inbox', when: () => getState().canEdit, run: () => void window.nv.capture.show() },
  // "Capture to…" a project's log, the Inbox or a note, with the time (state/captureFlows.ts; 21 Oct 2026, gap G27).
  ...CAPTURE_COMMANDS,
  { id: 'random', name: 'Open a random note', icon: 'dice', run: () => A.openRandom() },
  { id: 'unique-note', name: 'New note named by the date and time', icon: 'filePlus', run: () => void A.uniqueNote() },
  { id: 'search', name: 'Search inside notes and project files', hotkey: 'Mod+Shift+F', icon: 'search', run: () => requestSearch('') },
  // Words in pictures and scans (9.0 w123ocr): Settings › General, where the switch, the language and Read again are.
  { id: 'ocr-settings', name: 'Read words in pictures and scans', icon: 'text', run: () => openModal({ kind: 'settings', section: 'general' }) },
  { id: 'graph', name: 'Open the graph', hotkey: 'Mod+G', icon: 'graph', run: () => A.openGraph() },
  // Home folded into Today (5 Nov 2026, one morning place): old links open Today, so this is an alias of it.
  { id: 'home', name: 'Open Home', aliasOf: 'today', icon: 'home', run: () => A.openHome() },
  { id: 'today', name: 'Open Today', icon: 'sun', run: () => A.openToday() },
  // Notes in one step (one product step 2, 8 Nov 2026: the bar is gone in the former host app's window, so the picker is
  // two steps too many).
  { id: 'notes', name: 'Open Notes', icon: 'notes', run: () => openTypePage('note') },
  // What the Vault can do (8.8, src/shared/abilities.ts): every ability in one place, each with its Show me.
  { id: 'abilities', name: 'See what Ironleaf can do', icon: 'sparkle', run: () => A.openAbilities() },
  { id: 'tour-pack', name: 'Show me around this pack', icon: 'sparkle', when: () => moduleInfo(moduleOfTab(W.activeTab(getWorkspace())) ?? '') != null, run: () => openTour(moduleOfTab(W.activeTab(getWorkspace())) ?? '') },
  { id: 'projects', name: 'Open the Projects home', icon: 'layers', run: () => A.openProjects() },
  { id: 'meetings', name: 'Open Meetings', icon: 'calendar', run: () => void import('./life').then((l) => l.openMeetings()) },
  // Each pack's tour, in the palette as well as its own ⋯ menu (8.7 round 2: the inline link under the title is gone).
  { id: 'tour-finance', name: `Show me around ${moduleInfo('finance')?.name ?? 'Money'}`, icon: 'help', run: () => { openModule('finance'); openTour('finance'); } },
  { id: 'tour-documents', name: `Show me around ${moduleInfo('documents')?.name ?? 'Papers'}`, icon: 'help', run: () => { openModule('documents'); openTour('documents'); } },
  { id: 'tour-business', name: `Show me around ${moduleInfo('business')?.name ?? 'Business'}`, icon: 'help', run: () => { openModule('business'); openTour('business'); } },
  { id: 'tour-vendors', name: `Show me around ${moduleInfo('vendors')?.name ?? 'Suppliers'}`, icon: 'help', run: () => { openModule('vendors'); openTour('vendors'); } },
  { id: 'tour-systems', name: `Show me around ${moduleInfo('systems')?.name ?? 'Systems'}`, icon: 'help', run: () => { openModule('systems'); openTour('systems'); } },
  { id: 'tour-sites', name: `Show me around ${moduleInfo('sites')?.name ?? 'Sites'}`, icon: 'help', run: () => { openModule('sites'); openTour('sites'); } },
  { id: 'tour-publications', name: `Show me around ${moduleInfo('publications')?.name ?? 'Publications'}`, icon: 'help', run: () => { openModule('publications'); openTour('publications'); } },
  { id: 'tour-career', name: `Show me around ${moduleInfo('career')?.name ?? 'Career'}`, icon: 'help', run: () => { openModule('career'); openTour('career'); } },
  { id: 'tour-meetings', name: `Show me around ${moduleInfo('meetings')?.name ?? 'Meetings'}`, icon: 'help', run: () => { openModule('meetings'); openTour('meetings'); } },
  // One Meetings tour in the palette (8.7 final polish, 30 Oct 2026, the reviewer: one Meetings place — the w2b
  // 'meetings-tour' said the same words as the packs' tour-meetings above, so it is gone; Settings › Keys and
  // Settings search read these same commands, so they lose the double too).
  { id: 'weekly-review', name: 'Start the weekly review', icon: 'review', run: () => A.openWeeklyReview() },
  { id: 'timeline', name: 'Open the Timeline', icon: 'timeline', run: () => A.openTimeline() },
  // Tasks (views/TasksView.tsx; 21 Oct 2026, gap G24): every tick-box in the notes.
  { id: 'tasks', name: 'Open Tasks (every tick-box in your notes)', icon: 'task', run: () => A.openTasks() },
  // The vault as a life OS (Wave 4): the Inbox, people's cards, tags and the areas of life.
  { id: 'inbox', name: 'Open the Inbox (captures waiting to be filed)', icon: 'inbox', run: () => void import('./life').then((l) => l.openInbox()) },
  { id: 'people', name: 'Open People and organisations', icon: 'people', run: () => void import('./life').then((l) => l.openPeople()) },
  { id: 'tags', name: 'Manage tags (rename, merge, take off)', icon: 'tag', run: () => void import('./life').then((l) => l.openLife({ kind: 'tags' })) },
  { id: 'areas', name: 'Areas of life: organise, rename, reorder', icon: 'layers', run: () => void import('./life').then(async (l) => l.openLife({ kind: (await import('./areas')).getAreas() ? 'areas' : 'migration' })) },
  // Left More for the palette (8 Nov 2026, the quiet More): shared spaces open from here, and packs are
  // chosen in Settings › Packs (each switched-on pack also answers to its own name below).
  { id: 'shared-spaces', name: 'Open Shared spaces', icon: 'people', run: () => A.openSharedSpaces() },
  { id: 'packs', name: 'Choose packs…', icon: 'layers', run: () => openModal({ kind: 'settings', section: 'packs' }) },
  { id: 'bin', name: 'Open the Bin', icon: 'trash', run: () => A.openBin() },
  { id: 'import', name: 'Import: emails, PDFs, CSV spreadsheets, notes and folders', icon: 'download', run: () => A.openImport() },
  // Export everything (31 Oct 2026: portable export to prove no lock-in): the palette opens the same Settings
  // place, so the private tick, warning, progress and Cancel are one implementation.
  { id: 'export-everything', name: 'Export everything as a zip (notes, files and tables)', icon: 'download', run: () => A.openSettings('backups') },
  // Publish as a website (9.0 w122publish): the open page when one is open, else a site of the person's choosing.
  { id: 'publish', outward: true, name: 'Publish as a website…', icon: 'globe', run: (c) => openModal({ kind: 'publish', ...(c.tab.type === 'note' && c.path ? { source: { kind: 'page', path: c.path } } : {}) }) },
  // Notebook mode (views/NotebookView.tsx): the folder of the page on show, asked with cited answers.
  { id: 'notebook', name: 'Open this folder as a notebook', icon: 'book', when: () => !!W.activeTab(getWorkspace()).path && !W.activeTab(getWorkspace()).path!.includes(':'), run: () => void import('./notebook').then((n) => n.openNotebook(A.folderOf(W.activeTab(getWorkspace()).path!), 'tab')) },
  // The project's workspace and views of records (24 Oct 2026, Workstream 1 part D: views/workspace/ProjectWorkspace.tsx).
  { id: 'project-workspace', name: 'Open this project’s workspace', icon: 'layers', when: () => !!activeProjectPath(), run: () => void import('./projectWorkspace').then((m) => m.openWorkspace(activeProjectPath()!, 'tab')) },
  { id: 'records-actions', name: 'All actions across projects', icon: 'views', run: () => void import('./recordsTab').then((m) => m.openRecordsView('all-actions.json')) },
  { id: 'records-meetings', name: 'All meetings', icon: 'views', run: () => void import('./recordsTab').then((m) => m.openRecordsView('all-meetings.json')) },
  { id: 'records-people', name: 'People across projects', icon: 'views', run: () => void import('./recordsTab').then((m) => m.openRecordsView('people.json')) },
  { id: 'records-files', name: 'All files: every file, by what it is for', icon: 'files', run: () => void import('./recordsTab').then((m) => m.openRecordsView('all-files.json')) },
  { id: 'files-move-attachments', name: 'Move the attachments folder into place (files beside their notes)…', icon: 'files', run: () => void import('../components/FilesMove').then((m) => m.openFilesMove()) },
  { id: 'records-new', name: 'New view of records across projects…', icon: 'views', run: () => void import('./recordsTab').then((m) => m.newRecordsView()) },
  { id: 'project-canvas', name: 'Open this project as a canvas', icon: 'canvas', when: () => !!activeProjectPath(), run: () => void import('../views/canvas/projectBoards').then((m) => m.openProjectCanvas(activeProjectPath()!)) },
  { id: 'portfolio-board', name: 'Open the portfolio board', icon: 'canvas', run: () => void import('../views/canvas/projectBoards').then((m) => m.openPortfolioBoard()) },
  { id: 'private', name: 'Open Locked', icon: 'lock', run: () => A.openLocked('notes') },
  { id: 'secrets', name: 'Open Locked secrets', icon: 'key', run: () => A.openLocked('secrets') },
  { id: 'secrets-scan', name: 'Find secrets in notes', icon: 'search', run: () => A.openLocked('scan') },
  { id: 'secrets-activity', name: 'Who read what: the audit trail', icon: 'history', run: () => A.openLocked('activity') },
  { id: 'privacy-settings', name: 'Who reads each level (Privacy and secrets)', icon: 'lock', run: () => openModal({ kind: 'settings', section: 'privacy' }) },
  { id: 'assets', name: 'Open your assets', icon: 'assets', run: () => A.openAssets() },
  { id: 'brand-kit', name: 'Open your brand kit', icon: 'palette', run: () => void import('../views/assets/insert').then((m) => m.openBrandKit()) },
  { id: 'insert-asset', name: 'Insert a picture or file from your assets', icon: 'assets', editor: true, run: (c) => c.view && c.path && void import('../views/assets/insert').then((m) => m.insertFromAssets(c.view!, c.path!)) },
  { id: 'dictate', name: 'Dictate', icon: 'mic', when: () => !!window.nv.dictation?.available, run: (c) => {
    const editor = editorFor(c.tab.id);
    if (!editor) return;
    // Said by kind, never by matching words (9.2 uplift F8): phases stay quiet while notes and errors speak.
    const onEvent = (e: DictateEvent) => {
      if (e.words && e.kind !== 'phase') toast(e.words);
    };
    void import('../lib/dictation').then((d) => d.dictate(d.editorTarget(() => editor.view(), () => editor.focus()), undefined, undefined, { ...(c.tab.path && isPrivatePath(c.tab.path) ? { windowsOnly: true } : {}), onEvent }));
  } },
  { id: 'private-lock', name: 'Lock private notes', icon: 'lock', run: () => void import('./private').then((m) => m.lockPrivate()) },
  { id: 'local-graph', name: 'Show how this note connects', icon: 'localGraph', run: () => setPanel('right', 'local-graph') },
  // Tabs and panes
  { id: 'new-tab', name: 'New tab', hotkey: 'Mod+T', icon: 'newTab', run: () => setWorkspace((ws) => W.open(ws, { type: 'empty' }, 'tab')) },
  { id: 'close-tab', name: 'Close tab', hotkey: 'Mod+W', icon: 'close', run: (c) => setWorkspace((ws) => W.closeTab(ws, c.tab.id)) },
  { id: 'reopen-tab', name: 'Reopen the tab closed last', hotkey: 'Mod+Shift+T', icon: 'undo', run: () => setWorkspace((ws) => W.reopenClosed(ws)) },
  { id: 'close-others', name: 'Close the other tabs', icon: 'close', run: (c) => setWorkspace((ws) => W.closeOthers(ws, c.tab.id)) },
  { id: 'next-tab', name: 'Next tab', hotkey: 'Ctrl+Tab', run: () => cycleTabs(1) },
  { id: 'prev-tab', name: 'Previous tab', hotkey: 'Ctrl+Shift+Tab', run: () => cycleTabs(-1) },
  { id: 'split-right', name: 'Split right', icon: 'splitRight', run: () => setWorkspace((ws) => W.split(ws, ws.activeGroup, 'row')) },
  { id: 'split-down', name: 'Split down', icon: 'splitDown', run: () => setWorkspace((ws) => W.split(ws, ws.activeGroup, 'column')) },
  { id: 'pin-tab', name: 'Pin or unpin this tab', icon: 'pin', run: (c) => setWorkspace((ws) => W.updateTab(ws, c.tab.id, { pinned: !c.tab.pinned })) },
  { id: 'back', name: 'Go back', hotkey: 'Mod+Alt+Left', also: ['Alt+Left'], icon: 'back', run: (c) => setWorkspace((ws) => W.navigate(ws, c.tab.id, -1)) },
  { id: 'forward', name: 'Go forward', hotkey: 'Mod+Alt+Right', also: ['Alt+Right'], icon: 'forward', run: (c) => setWorkspace((ws) => W.navigate(ws, c.tab.id, 1)) },
  // Panels
  { id: 'toggle-left', name: 'Show or hide the left side', icon: 'sidebarLeft', run: () => toggleSide('left') },
  // The folded icon rail (8.7 wave 1): one command each way, so the palette names what will happen.
  { id: 'rail-on', name: 'Fold the side bar to icons', icon: 'sidebarLeft', when: () => !getWorkspace().left.rail, run: () => setRail(true) },
  { id: 'rail-off', name: 'Unfold the side bar', icon: 'sidebarLeft', when: () => !!getWorkspace().left.rail, run: () => setRail(false) },
  { id: 'toggle-right', name: 'Show or hide the right side', icon: 'sidebarRight', run: () => toggleSide('right') },
  // In the former host app's window the bar is gone (one product step 2): Files opens Notes, whose rail
  // carries the folders.
  { id: 'files', name: 'Show your files', icon: 'files', run: () => (inVaultView() ? openTypePage('note') : setPanel('left', 'files')) },
  { id: 'bookmarks', name: 'Show bookmarks', icon: 'bookmark', run: () => A.openBookmarks() },
  { id: 'weekly-tidy', name: 'Open the weekly tidy', icon: 'sparkle', run: () => A.openTidy() },
  { id: 'backlinks', name: 'Show links to this note', hotkey: 'Mod+Shift+B', icon: 'backlinks', note: true, run: () => goToNoteFoot() },
  { id: 'outgoing', name: 'Show links from this note', icon: 'outgoing', run: () => setPanel('right', 'outgoing') },
  { id: 'outline', name: 'Show the outline', icon: 'outline', run: () => setPanel('right', 'outline') },
  // No second 'tags' entry (9.2 uplift F5): the shadowed twin, unreachable by id, is gone — the tags panel opens
  // from the side panel itself, and 'tags' always means Manage tags. (A replacement id would need a shared
  // abilities-registry entry, outside this uplift's slice.)
  { id: 'chat', name: 'Chat with your notes', hotkey: 'Mod+Shift+L', icon: 'chat', run: () => setPanel('right', 'chat') },
  // Ironleaf Calm (20 Oct 2026): the chat starts closed; Ask on a page's header and these keys open or close it.
  { id: 'ask', name: 'Ask', hotkey: 'Mod+J', icon: 'chat', run: () => toggleChat() },
  { id: 'toggle-tabs', name: 'Show or hide tabs', icon: 'newTab', run: () => void savePrefs({ showTabs: !prefs().showTabs, tabsChosen: true }) },
  { id: 'toggle-status-line', name: 'Show or hide the status line', icon: 'info', run: () => void savePrefs({ statusLine: !prefs().statusLine }) },
  { id: 'autolink', name: 'Suggest links for this note', hotkey: 'Mod+Shift+K', icon: 'sparkle', run: () => setPanel('right', 'autolink') },
  // Related notes (21 Oct 2026, gap G25; t22-note-once, 8 Nov 2026: they read in the foot's Linked list now,
  // so both doors land on the foot instead of the side).
  { id: 'related-notes', name: 'Show related notes', icon: 'link', note: true, run: () => goToNoteFoot() },
  // This note
  { id: 'toggle-mode', name: 'Switch between reading and editing', hotkey: 'Mod+E', icon: 'book', note: true, run: (c) => setMode(c.tab.id, (c.tab.mode ?? prefs().defaultMode) === 'reading' ? (prefs().defaultMode === 'reading' ? 'live' : prefs().defaultMode) : 'reading') },
  { id: 'toggle-source', name: 'Switch between Live Preview and Source', icon: 'code', note: true, run: (c) => setMode(c.tab.id, (c.tab.mode ?? prefs().defaultMode) === 'source' ? 'live' : 'source') },
  // Notes save themselves as you type; Ctrl+S saves straight away and says so (the status line is off by default).
  { id: 'save', name: 'Save now', hotkey: 'Mod+S', icon: 'check', run: (c) => void docs.flush(c.tab.path).then(() => { const s = c.tab.path ? docs.saveState(c.tab.path) : 'saved'; if (s === 'saved' || s === 'saving') flashSaved(); }) },
  { id: 'rename', name: 'Rename', hotkey: 'F2', icon: 'edit', file: true, run: (c) => c.path && void A.askRename(c.path) },
  { id: 'move', outward: true, name: 'Move to another folder…', icon: 'folder', file: true, run: (c) => c.path && void A.askMove(c.path) },
  { id: 'fold-area', outward: true, name: 'Move into another area…', icon: 'folder', run: (c) => void import('./areaFold').then((m) => m.foldFromCommand(c.path)) },
  { id: 'fold-area-undo', name: 'Undo the last area move', icon: 'history', run: () => void import('./areaFold').then((m) => m.undoFold()) },
  { id: 'duplicate', outward: true, name: 'Make a copy', icon: 'copy', file: true, run: (c) => c.path && void A.duplicatePath(c.path) },
  { id: 'delete', name: 'Delete', icon: 'trash', file: true, run: (c) => c.path && void A.trashPath(c.path) },
  { id: 'bookmark', outward: true, name: 'Bookmark or unbookmark', icon: 'bookmark', file: true, run: (c) => { if (!c.path) return; const on = toggleBookmark(c.path); toast(on ? 'Bookmarked.' : 'Bookmark removed.'); } },
  { id: 'reveal-explorer', outward: true, name: 'Show in the file list', icon: 'files', file: true, run: (c) => c.path && A.revealInExplorer(c.path) },
  { id: 'reveal-system', outward: true, name: 'Show in File Explorer', icon: 'reveal', file: true, run: (c) => c.path && void A.revealInSystem(c.path) },
  { id: 'open-default', outward: true, name: 'Open in its default app', icon: 'external', file: true, run: (c) => c.path && void A.openInDefaultApp(c.path) },
  { id: 'copy-path', outward: true, name: 'Copy its path', icon: 'copy', file: true, run: (c) => c.path && void A.copyPath(c.path) },
  { id: 'export-pdf', outward: true, name: 'Export to PDF', icon: 'download', note: true, run: (c) => c.path && void exportPdf(c.path) },
  // The Design studio (22 Nov 2026, components/DesignDialog.tsx): the note designed into a finished PDF by AI.
  { id: 'design-note', outward: true, name: 'Design with AI: a report, one-pager, slides or poster…', icon: 'palette', note: true, run: (c) => c.path && openModal({ kind: 'design', path: c.path }) },
  { id: 'present', outward: true, name: 'Present as slides', icon: 'present', note: true, run: (c) => c.path && openModal({ kind: 'slides', path: c.path }) },
  { id: 'merge', outward: true, name: 'Merge into another note…', icon: 'merge', note: true, run: (c) => c.path && void mergeInto(c.path) },
  { id: 'extract', outward: true, name: 'Move the selection to a new note', icon: 'scissors', editor: true, run: (c) => c.view && c.path && void extractSelection(c.view, c.path) },
  { id: 'add-property', name: 'Add a property', icon: 'properties', note: true, run: (c) => window.dispatchEvent(new CustomEvent('nv-add-property', { detail: c.tab.id })) },
  { id: 'history', outward: true, name: 'Earlier versions of this note', icon: 'history', note: true, run: (c) => openModal({ kind: 'recovery', path: c.path }) },
  { id: 'insert-template', name: 'Insert a template', icon: 'template', editor: true, run: (c) => c.view && c.path && void insertTemplate(c.view, c.path) },
  { id: 'synced-block', name: 'Insert a synced block', icon: 'copy', editor: true, run: (c) => c.view && void import('../editor/syncedBlocks').then((m) => m.insertSyncedBlock(c.view!)) },
  { id: 'make-synced-block', name: 'Make the selection a synced block', icon: 'copy', editor: true, run: (c) => c.view && void import('../editor/syncedBlocks').then((m) => m.makeSyncedBlock(c.view!)) },
  ...[2, 3, 4].map((n): Command => ({ id: `columns-${n}`, name: `Lay out in ${n} columns`, icon: 'splitRight', editor: true, run: (c) => c.view && void import('../editor/columns').then((m) => m.layOutInColumns(c.view!, n)) })),
  { id: 'save-as-template', outward: true, name: 'Save as template…', icon: 'template', note: true, when: () => getState().canEdit, run: (c) => c.path && void saveAsTemplate(c.path) },
  // Writing
  { id: 'bold', name: 'Bold', hotkey: 'Mod+B', icon: 'bold', editor: true, run: ed((v) => toggleMark(v, '**')) },
  { id: 'italic', name: 'Italic', hotkey: 'Mod+I', icon: 'italic', editor: true, run: ed((v) => toggleMark(v, '*')) },
  { id: 'strike', name: 'Strikethrough', icon: 'strike', editor: true, run: ed((v) => toggleMark(v, '~~')) },
  { id: 'highlight', name: 'Highlight', icon: 'highlight', editor: true, run: ed((v) => toggleMark(v, '==')) },
  { id: 'inline-code', name: 'Code', icon: 'code', editor: true, run: ed((v) => toggleMark(v, '`')) },
  { id: 'comment', name: 'Hide as a comment', hotkey: 'Mod+/', icon: 'eye', editor: true, run: ed((v) => toggleMark(v, '%%')) },
  { id: 'link', name: 'Make a link', hotkey: 'Mod+U', icon: 'link', editor: true, run: ed((v) => insertLink(v, prefs().wikilinks)) },
  { id: 'task', name: 'Tick-box: add, tick or untick', hotkey: 'Mod+L', icon: 'task', editor: true, run: ed(cycleTask) },
  // The formatting bar for the keys (19 Oct 2026, 5.0.0): Alt+F10, the usual key for "go to the toolbar", free here.
  { id: 'format-bar', name: 'Formatting bar', hotkey: 'Alt+F10', icon: 'bold', editor: true, run: (c) => c.view && focusFormatBar(c.view) },
  // The assistant's suggested changes waiting in the note (19 Oct 2026, 5.0.0). Ctrl+Enter and Ctrl+Backspace were the
  // first thought, but in the editor they are the person's own typing keys (a new line below; delete a word), so they
  // would throw away a suggestion mid-sentence: Alt+Enter and Alt+Backspace are free, beside Alt+] and Alt+[ to move.
  { id: 'suggestion-next', name: 'Suggested changes: next', hotkey: 'Alt+]', icon: 'forward', editor: true, when: waitingHere, run: (c) => c.path && moveSuggestion(c.path, 1) },
  { id: 'suggestion-prev', name: 'Suggested changes: previous', hotkey: 'Alt+[', icon: 'back', editor: true, when: waitingHere, run: (c) => c.path && moveSuggestion(c.path, -1) },
  { id: 'suggestion-keep', name: 'Suggested changes: keep this one', hotkey: 'Alt+Enter', icon: 'check', editor: true, when: waitingHere, run: (c) => c.path && keepSuggestion(c.path) },
  { id: 'suggestion-discard', name: 'Suggested changes: discard this one', hotkey: 'Alt+Backspace', icon: 'close', editor: true, when: waitingHere, run: (c) => c.path && discardSuggestion(c.path) },
  ...[1, 2, 3, 4, 5, 6].map((n): Command => ({ id: `heading-${n}`, name: `Heading ${n}`, icon: 'heading', editor: true, run: ed((v) => setHeading(v, n)) })),
  { id: 'paragraph', name: 'Plain text (no heading)', icon: 'text', editor: true, run: ed((v) => setHeading(v, 0)) },
  { id: 'bullets', name: 'Bulleted list', icon: 'list', editor: true, run: ed(toggleBullet) },
  { id: 'numbers', name: 'Numbered list', icon: 'numbered', editor: true, run: ed(toggleNumbered) },
  { id: 'quote', name: 'Quote', icon: 'quote', editor: true, run: ed(toggleQuote) },
  { id: 'callout', name: 'Callout', icon: 'callout', editor: true, run: ed((v) => insertCallout(v)) },
  { id: 'table', name: 'Table', icon: 'table', editor: true, run: ed((v) => insertTable(v)) },
  { id: 'code-block', name: 'Code block', icon: 'code', editor: true, run: ed((v) => insertCodeBlock(v)) },
  { id: 'math-block', name: 'Maths block', icon: 'math', editor: true, run: ed(insertMathBlock) },
  // Diagrams (8.8): a Mermaid block with three boxes to start from, drawn in the reading view.
  { id: 'insert-mermaid', name: 'Mermaid diagram', icon: 'flow', editor: true, run: ed((v) => insertMermaid(v)) },
  { id: 'divider', name: 'Divider', icon: 'divider', editor: true, run: ed(insertRule) },
  { id: 'footnote', name: 'Footnote', icon: 'text', editor: true, run: ed(insertFootnote) },
  { id: 'date', name: "Insert today's date", icon: 'calendar', editor: true, run: ed((v) => insertDate(v, prefs().dateFormat)) },
  { id: 'time', name: 'Insert the time', icon: 'calendar', editor: true, run: ed((v) => insertDate(v, prefs().timeFormat)) },
  { id: 'fold-all', name: 'Fold every heading', icon: 'collapse', editor: true, run: ed(foldAll) },
  { id: 'unfold-all', name: 'Unfold everything', icon: 'expand', editor: true, run: ed(unfoldAll) },
  { id: 'cursor-above', name: 'Add a cursor above', hotkey: 'Mod+Alt+Up', editor: true, run: ed((v) => addCursor(v, -1)) },
  { id: 'cursor-below', name: 'Add a cursor below', hotkey: 'Mod+Alt+Down', editor: true, run: ed((v) => addCursor(v, 1)) },
  // Lines, from the installed editor (5 Nov 2026, the audit: the stock keymap already answered these keys, but the
  // jobs were missing from the command list and unchangeable in Settings › Keys).
  { id: 'move-line-up', name: 'Move line up', hotkey: 'Alt+Up', icon: 'chevronUp', editor: true, run: ed(moveLineUp) },
  { id: 'move-line-down', name: 'Move line down', hotkey: 'Alt+Down', icon: 'chevronDown', editor: true, run: ed(moveLineDown) },
  { id: 'copy-line-up', name: 'Copy line up', hotkey: 'Alt+Shift+Up', icon: 'copy', editor: true, run: ed(copyLineUp) },
  { id: 'copy-line-down', name: 'Copy line down', hotkey: 'Alt+Shift+Down', icon: 'copy', editor: true, run: ed(copyLineDown) },
  { id: 'delete-line', name: 'Delete line', icon: 'trash', editor: true, run: ed(deleteLine) },
  { id: 'select-line', name: 'Select line', icon: 'text', editor: true, run: ed(selectLine) },
  { id: 'find', name: 'Find in this note', hotkey: 'Mod+F', icon: 'search', editor: true, run: ed(openSearchPanel) }, // 5 Nov 2026: the key it always answered (CodeMirror's own) is said in Settings › Keys now
  { id: 'replace', name: 'Find and replace', hotkey: 'Mod+H', icon: 'search', editor: true, run: ed((v) => { openSearchPanel(v); requestAnimationFrame(() => (v.dom.querySelector('.cm-search input[name=replace]') as HTMLInputElement | null)?.focus()); }) },
  { id: 'close-find', name: 'Close find', editor: true, run: ed(closeSearchPanel) },
  { id: 'table-row-below', name: 'Table: add a row below', icon: 'table', editor: true, run: ed((v) => tableCommand(v, 'row-below')) },
  { id: 'table-row-above', name: 'Table: add a row above', icon: 'table', editor: true, run: ed((v) => tableCommand(v, 'row-above')) },
  { id: 'table-col-right', name: 'Table: add a column to the right', icon: 'table', editor: true, run: ed((v) => tableCommand(v, 'col-right')) },
  { id: 'table-col-left', name: 'Table: add a column to the left', icon: 'table', editor: true, run: ed((v) => tableCommand(v, 'col-left')) },
  { id: 'table-delete-row', name: 'Table: delete this row', icon: 'table', editor: true, run: ed((v) => tableCommand(v, 'delete-row')) },
  { id: 'table-delete-col', name: 'Table: delete this column', icon: 'table', editor: true, run: ed((v) => tableCommand(v, 'delete-col')) },
  { id: 'table-align-left', name: 'Table: align the column left', icon: 'table', editor: true, run: ed((v) => tableCommand(v, 'align-left')) },
  { id: 'table-align-center', name: 'Table: centre the column', icon: 'table', editor: true, run: ed((v) => tableCommand(v, 'align-center')) },
  { id: 'table-align-right', name: 'Table: align the column right', icon: 'table', editor: true, run: ed((v) => tableCommand(v, 'align-right')) },
  { id: 'table-format', name: 'Table: line up the columns', icon: 'table', editor: true, run: ed((v) => tableCommand(v, 'format')) },
  // Ironleaf
  { id: 'settings', name: 'Open Settings', hotkey: 'Mod+,', icon: 'settings', run: () => openModal({ kind: 'settings' }) },
  { id: 'check-updates', name: 'Check for updates…', icon: 'download', run: () => openAboutPage({ check: true }) },
  { id: 'whats-new', name: 'What’s new in Ironleaf', icon: 'sparkle', run: () => openAboutPage({ focus: 'whats-new' }) },
  { id: 'about-ironleaf', name: 'About Ironleaf (version and updates)', icon: 'info', run: () => openAboutPage() },
  { id: 'account-sign-in', name: 'Sign in to Ironleaf', icon: 'person', run: () => signInFromAnywhere() },
  { id: 'account-plan', name: 'Manage plan', icon: 'wallet', run: () => openAccountPage() },
  { id: 'ai-agents', name: 'Connect an AI: other AI apps on this PC, and what agents did', icon: 'agent', run: () => openModal({ kind: 'settings', section: 'agents' }) },
  { id: 'hotkeys', name: 'Change keyboard shortcuts', icon: 'keyboard', run: () => openModal({ kind: 'settings', section: 'keys' }) },
  { id: 'recovery', name: 'Earlier versions of notes…', icon: 'history', run: () => openModal({ kind: 'recovery' }) },
  { id: 'theme', name: 'Switch between light and dark', icon: 'sun', run: () => void savePrefs({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }) },
  // The six interface sizes (src/shared/interface-size.ts). With their usual keys the main side steps the size before
  // the page sees the keys; these run from Commands, and from keys the person gave them in Settings › Keys.
  { id: 'zoom-in', name: 'Make everything bigger', hotkey: 'Mod+=', icon: 'zoomIn', run: () => void savePrefs({ zoom: stepSize(prefs().zoom, 1) }) },
  { id: 'zoom-out', name: 'Make everything smaller', hotkey: 'Mod+-', icon: 'zoomOut', run: () => void savePrefs({ zoom: stepSize(prefs().zoom, -1) }) },
  { id: 'zoom-reset', name: 'Everything at normal size', hotkey: 'Mod+0', icon: 'fit', run: () => void savePrefs({ zoom: 1 }) },
  { id: 'reveal-library', name: 'Show your notes folder in File Explorer', icon: 'reveal', run: () => void A.revealInSystem('') },
  { id: 'open-folder', name: 'Open another folder of notes…', icon: 'folderOpen', run: () => void openFolder() },
  { id: 'bookmark-search', name: 'Bookmark the current search', icon: 'bookmark', when: () => !!lastSearch, run: () => lastSearch && addBookmark({ type: 'search', query: lastSearch }) },
];

let lastSearch = '';
export function rememberSearch(query: string): void {
  lastSearch = query.trim();
}

function cycleTabs(delta: 1 | -1): void {
  setWorkspace((ws) => {
    const g = W.activeGroup(ws);
    const at = g.tabs.findIndex((t) => t.id === g.active);
    const next = g.tabs[(at + delta + g.tabs.length) % g.tabs.length];
    return W.activate(ws, g.id, next.id);
  });
}

async function openFolder(): Promise<void> {
  try {
    await docs.settle();
    await window.nv.vault.pick();
  } catch (err) {
    showError(err);
  }
}

/** A PDF among the notes, picked and opened in the Vault's own reader (views/pdf). */
export async function openPdf(): Promise<void> {
  const pdfs = pdfChoices(getState().files);
  if (!pdfs.length) {
    toast('No PDFs among your notes yet. Drop one into the file list to read it here.');
    return;
  }
  const picked = await pickFile('Open which PDF?', pdfs, (p) => A.titleOf(p));
  if (picked) A.openPath(picked);
}

/** Export to PDF: the note as its branded document (the same one Share prints), to a file the person names. */
export async function exportPdf(path: string): Promise<void> {
  const { brandHtmlAndKit, isKeepNote, keepWithNote } = await import('./share');
  const { kitWords } = await import('../../../shared/brand-kits');
  try {
    await docs.settle();
    const text = docs.text(path) ?? (await window.nv.notes.read(path));
    const { shareBody } = await import('../../../shared/share');
    if (!shareBody(text).trim()) {
      toast('There is nothing to print.');
      return;
    }
    const printed = await brandHtmlAndKit(path, A.titleOf(path), text);
    const file = await window.nv.exports.brandPdf(A.titleOf(path), printed.html);
    if (!file) return;
    const words = printed.multi ? `Saved ${file.split(/[\\/]/).pop()} ${kitWords(printed.kit)}.` : `Saved ${file.split(/[\\/]/).pop()}.`;
    if (isKeepNote(path, text)) toast(words, { label: 'Keep with this note', run: () => void keepWithNote(path, file) });
    else toast(words, { label: 'Show', run: () => void window.nv.exports.reveal(file) });
  } catch (err) {
    showError(err);
  }
}

/** Commands used lately, newest first (the command list shows them first). An alias's use counts as its
 *  survivor's (t28 follow-up, 8 Nov 2026, lib/commandAliases.ts): a person who uses the old name sees the
 *  survivor in recents, never a row the browsing lists hide. */
export function recentCommands(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem('nv-recent-commands') || '[]') as unknown;
    const ids = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
    return readRecent(ids, COMMANDS);
  } catch {
    return [];
  }
}

export function noteCommandUsed(id: string): void {
  try {
    localStorage.setItem('nv-recent-commands', JSON.stringify(withRecentUsed(recentCommands(), survivorId(id, COMMANDS))));
  } catch {
    // Remembering is a convenience; nothing breaks without it.
  }
}

/** Commands by id (9.2 uplift F5): one registry, so a remap or run by key can never open the wrong command.
 *  Ids are unique by the test in tests/uplift-92-commands.test.mjs. */
const commandById = new Map(COMMANDS.map((c) => [c.id, c]));

export function runCommand(id: string): void {
  const cmd = commandById.get(id);
  if (!cmd) return;
  const ctx = commandContext();
  if (!available(cmd, ctx)) return;
  void Promise.resolve(cmd.run(ctx)).catch(showError);
}

export { isBookmarked };

/** Record a meeting from the command list: the meeting note in front, else today's meeting note (found first,
 *  never a "… 2"), else a new one for today. */
async function recordMeetingNow(): Promise<void> {
  const tab = W.activeTab(getWorkspace());
  const path = tab?.path;
  if (path && !isPrivatePath(path) && isMeetingNote(path, getState().byPath.get(path)?.props ?? {})) return startRecording(path);
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const name = meetingName(iso);
  const todays = getState().notes.find((n) => isMeetingNote(n.path, n.props ?? {}) && n.title === name && !isPrivatePath(n.path));
  if (todays) return startRecording(todays.path);
  const made = await newNoteOfType('meeting', { where: 'tab', title: name, values: { date: iso } });
  if (made) await startRecording(made);
}
