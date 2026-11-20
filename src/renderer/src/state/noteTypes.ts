// Note types in the window (src/shared/note-types.ts; 20 Oct 2026, Ironleaf Calm wave B).
//
// For the left side and anything else that lists or makes notes, the whole API is:
//
//   useNoteTypes(): NoteTypeCount[]
//       The visible types in the person's order (Note first), each with `count`: how many notes are that type, counted
//       from the notes already in memory (never the disk). Each has id, name, plural, icon (an IconName), color (a
//       TypeColor: the class `nt-<color>` sets --type and its tint --type-soft, styles/types.css), hint, folder.
//       Re-renders as notes and types change.
//   openTypePage(typeId, where?)
//       Opens that type's page (every note of the type, as a table, a board or a calendar). Project opens the Projects page.
//   newNoteOfType(typeId?, options?)
//       The one way to make a new note. No type: "What is it?" asks (Enter makes a plain Note), unless the folder given is
//       a type's home (then that type). Options: folder, where, title, values, open (false makes it without opening it),
//       ask (false: a plain Note when nothing says the type).
//       Project opens the New project window, Doc the New doc steps. Returns the new note's path (null when cancelled).
//   openNewDoor(anchor) / newNoteDoor(options?)
//       The one New door (8 Nov 2026, the quiet More): the menu with New note…, New canvas and New view,
//       and the New note list with its kind or template chosen inline.
//
// Also here: typeChip(type) (its icon in its colour, for rows drawn outside a component), SECTION_TYPES (the side bar's
// Projects, Docs and Notes sections as types), chooseType (the "What is it?" list on its own), useAllNoteTypes (hidden
// ones too, for Settings), getNoteTypes, typeOfPath (the type of an open note, for its page header), loadNoteTypes (when a
// vault opens) and changeTypes (Settings and a type page's Display write the vault's .neuralvault/types.json through it).

import { createElement, useMemo, useSyncExternalStore } from 'react';
import type { CalendarEvent } from '../../../shared/calendar';
import { meetingNoteFor } from '../../../shared/calendar';
import type { PropValue } from '../../../shared/frontmatter';
import { DOCS_FOLDER } from '../../../shared/doc-file';
import { countTypes, emptyConfig, findType, newTypedNoteText, NOTE_TYPE, readTypes, resolveTypes, typeForFolder, typeNamed, typeOfNote, writeTypes, type NoteType, type TypeContext, type TypesConfig } from '../../../shared/note-types';
import { Icon, type IconName } from '../components/Icon';
import { pageType, type FieldKindHint, type PageType } from '../../../shared/note-page';
import { openMenu } from '../components/Menu';
import { pick } from '../components/Pickers';
import { fuzzyFilter } from '../lib/fuzzy';
import { fitTypedName } from '../../../shared/paths';
import * as A from './actions';
import { areaFolderFor, getAreas, useAreas } from './areas';
import { modulesOn } from '../../../shared/life-modules';
import { moduleTypeInputs } from '../../../shared/module-records';
import { getWorkspace, setWorkspace } from './layout';
import { getState, loadNotes, prefs, showError, toast, useApp, usePrefs } from './store';
import * as W from './workspace';

export type NoteTypeCount = NoteType & { count: number };

/** The side bar's sections that are types (src/shared/navigator.ts): Projects and Docs are those types; Notes is where
 *  plain notes are. Nothing on disk moves for this: a section and its type show the same notes. */
export const SECTION_TYPES: Partial<Record<'projects' | 'docs' | 'notes', string>> = { projects: 'project', docs: 'doc', notes: NOTE_TYPE };

// ── The vault's types ─────────────────────────────────────────────────────────────────────────────────────────────────

let config: TypesConfig = emptyConfig();
let problem: string | null = null;
/** The types file could not be read at all (W5-3): writes stay blocked until a clean read. */
let unreadable = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The vault's types file read (when a vault opens): the built-in types as they come when there is none. */
export async function loadNoteTypes(): Promise<void> {
  // Another vault's notes: no write-first mark carries over (Nov 2026 break).
  await import('./writeFirst').then((m) => m.clearAllWriteFirst());
  try {
    const read = readTypes(await window.nv.types.load());
    config = read.config;
    problem = read.problem;
    unreadable = false;
  } catch {
    config = emptyConfig();
    problem = 'Your note types could not be read just now, so changes to them are paused until they can be.';
    unreadable = true;
  }
  emit();
}

/** Why the types file couldn't be read, in words (null when it was, or there is none). */
export const typesProblem = () => problem;

// The modules' record types (src/shared/module-records.ts) are there while their module is switched on, each in its folder
// inside its area (Me/Finance/Bills).
const modulesCtx = () => moduleTypeInputs(modulesOn(prefs().modules).map((m) => m.id), getAreas()?.areas ?? null);
const contextOf = (folders: string[], templatesFolder: string): TypeContext => ({ topFolders: folders.filter((f) => !f.includes('/')), templatesFolder, docsFolder: DOCS_FOLDER, modules: modulesCtx() });

let cache: { config: TypesConfig; folders: string[]; templates: string; modules: string; types: NoteType[] } | null = null;
function resolved(folders: string[], templatesFolder: string): NoteType[] {
  const modules = JSON.stringify(modulesCtx());
  if (cache && cache.config === config && cache.folders === folders && cache.templates === templatesFolder && cache.modules === modules) return cache.types;
  cache = { config, folders, templates: templatesFolder, modules, types: resolveTypes(config, contextOf(folders, templatesFolder)) };
  return cache.types;
}

/** Every type (hidden ones too), in order, outside React. */
export function getNoteTypes(): NoteType[] {
  return resolved(getState().folders, prefs().templatesFolder);
}

/** The type of a note by its path (Note when it isn't known yet), null for a template. */
export function typeOfPath(path: string): NoteType | null {
  const types = getNoteTypes();
  const id = typeOfNote({ path, props: getState().byPath.get(path)?.props }, types, prefs().templatesFolder);
  return id ? (findType(types, id) ?? null) : null;
}

/** A link target's chip kind (9.2 uplift F28): person, project or meeting by the one shared type reading, so
 *  every renderer chips the same notes. The reading trims `type:` once and follows the type's own folder, so a
 *  trailing space or a note outside People/Contacts still chips; folder names are never matched here. */
export function mentionKindFor(path: string): 'person' | 'project' | 'meeting' | null {
  const id = typeOfNote({ path, props: getState().byPath.get(path)?.props }, getNoteTypes(), prefs().templatesFolder);
  if (id === 'person') return 'person';
  if (id === 'project') return 'project';
  if (id === 'meeting' || id === 'meeting-series') return 'meeting';
  return null;
}

/** Every type, hidden ones too (Settings › Note types). */
export function useAllNoteTypes(): NoteType[] {
  const current = useSyncExternalStore(subscribe, () => config);
  const folders = useApp((s) => s.folders);
  const { templatesFolder, modules } = usePrefs();
  const areas = useAreas();
  return useMemo(() => resolved(folders, templatesFolder), [current, folders, templatesFolder, modules, areas]);
}

/** The visible types with how many notes each has (see the top of this file). */
export function useNoteTypes(): NoteTypeCount[] {
  const all = useAllNoteTypes();
  const notes = useApp((s) => s.notes);
  const templatesFolder = usePrefs().templatesFolder;
  return useMemo(() => {
    const counts = countTypes(notes, all, templatesFolder);
    return all.filter((t) => !t.hidden).map((t) => ({ ...t, count: counts.get(t.id) ?? 0 }));
  }, [all, notes, templatesFolder]);
}

/**
 * The types changed (Settings, a type page's Display): shown at once and written to the vault's types file. Throws in
 * plain words when the change can't be made (a name already used); a write that fails puts the old types back.
 */
export async function changeTypes(change: (config: TypesConfig, ctx: TypeContext) => TypesConfig): Promise<void> {
  if (unreadable) throw new Error(problem ?? 'Your note types could not be read, so they were left as they are.');
  const before = config;
  const next = change(config, contextOf(getState().folders, prefs().templatesFolder));
  if (next === before) return;
  config = next;
  problem = null;
  emit();
  if (!getState().canEdit) return;
  try {
    await window.nv.types.save(writeTypes(next));
  } catch (err) {
    config = before;
    emit();
    throw err;
  }
}

// ── A type's page ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const TYPE_TAB_PREFIX = 'type:';
export const typeTabPath = (id: string) => `${TYPE_TAB_PREFIX}${id}`;
// A Notes tab filtered to a folder carries it after a ? (type:note?folder=Projects); the type stays note.
export const typeOfTab = (tab: W.TabState): string | undefined => {
  if (tab.type !== 'type' || !tab.path?.startsWith(TYPE_TAB_PREFIX)) return undefined;
  return tab.path.slice(TYPE_TAB_PREFIX.length).split('?')[0] || undefined;
};
/** The folder a Notes tab is filtered to, or '' for every note (one product step 2, 8 Nov 2026). */
export function folderOfTab(tab: W.TabState): string {
  if (tab.type !== 'type' || !tab.path?.startsWith(`${TYPE_TAB_PREFIX}note?`)) return '';
  const m = /[?&]folder=([^&]*)/.exec(tab.path);
  if (!m) return '';
  try { return decodeURIComponent(m[1]).slice(0, 200); } catch { return ''; }
}
/** Notes already filtered to a folder (its tab path); '' is every note. */
export const notesTabPath = (folder = ''): string => {
  const f = String(folder || '').trim().replace(/^\/+|\/+$/g, '').slice(0, 200);
  return f ? `${TYPE_TAB_PREFIX}note?folder=${encodeURIComponent(f)}` : `${TYPE_TAB_PREFIX}note`;
};
/** Notes in a folder, from a deep link or the file list (one product step 2): the same Notes page, already
 *  filtered. On Notes already the folder changes in place, so Back returns; otherwise beside, like any place. */
export function openNotesFolder(folder = '', where: W.Where = 'current'): void {
  const tabPath = notesTabPath(folder);
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'type' && t.path === tabPath);
  if (existing && where === 'current') { setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id)); return; }
  const active = W.activeTab(getWorkspace());
  if (where === 'current' && active.type === 'type' && typeOfTab(active) === 'note') {
    setWorkspace((ws) => W.open(ws, { type: 'type', path: tabPath }, 'current'));
    return;
  }
  const at: W.Where = where === 'current' && active.type !== 'empty' && active.type !== 'type' ? 'tab' : where;
  setWorkspace((ws) => W.open(ws, { type: 'type', path: tabPath }, at));
}

/** A type's page: the tab already showing it comes forward, else it opens (beside the page someone is on). Project has
 *  its own page already, the Projects page. Meetings and People have their own pages too (Polish round 1, 29 Oct 2026,
 *  ITEMS 3): opening the meeting type opens the Meetings page (Upcoming and Past, with attendees), never its table
 *  page, and opening the person type opens the People page; only an explicit table ask (asTable) shows the table. */
export function openTypePage(typeId: string, where: W.Where = 'current', opts?: { asTable?: boolean }): void {
  if (typeId === 'project') return A.openProjects(where);
  // Polish round 2 (29 Oct 2026, ITEMS 1): Docs and Daily under Your notes open the Notes page with that filter
  // (Job C's NotesPage, Workspace routes a doc or daily type tab there), never a table or the Files panel.
  if (!opts?.asTable && (typeId === 'doc' || typeId === 'daily')) {
    const path = typeTabPath(typeId);
    const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'type' && t.path === path);
    if (existing && where === 'current') { setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id)); return; }
    setWorkspace((ws) => W.open(ws, { type: 'type', path }, where));
    return;
  }
  if (!opts?.asTable && (typeId === 'meeting' || typeId === 'person')) {
    if (typeId === 'person') {
      const existingPeople = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'people' && !t.path?.startsWith('person:'));
      if (existingPeople && where === 'current') { setWorkspace((ws) => W.activate(ws, existingPeople.g.id, existingPeople.t.id)); return; }
      setWorkspace((ws) => W.open(ws, { type: 'people', path: 'people:' }, where));
      return;
    }
    const existingMeetings = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'meetings');
    if (existingMeetings && where === 'current') { setWorkspace((ws) => W.activate(ws, existingMeetings.g.id, existingMeetings.t.id)); return; }
    setWorkspace((ws) => W.open(ws, { type: 'meetings', path: 'meetings:' }, where));
    return;
  }
  const path = typeTabPath(typeId);
  const existing = W.groups(getWorkspace().root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'type' && t.path === path);
  if (existing && where === 'current') {
    setWorkspace((ws) => W.activate(ws, existing.g.id, existing.t.id));
    return;
  }
  const at: W.Where = where === 'current' && W.activeTab(getWorkspace()).type !== 'empty' && W.activeTab(getWorkspace()).type !== 'type' ? 'tab' : where;
  setWorkspace((ws) => W.open(ws, { type: 'type', path }, at));
}

// ── "What is it?" and a new note of a type ────────────────────────────────────────────────────────────────────────────

/** A type's icon in its colour, for lists drawn outside a component (the picker's rows). */
export const typeChip = (t: Pick<NoteType, 'icon' | 'color'>, size = 15) => createElement('span', { className: `nt-chip nt-${t.color}`, 'aria-hidden': true }, createElement(Icon, { name: t.icon as IconName, size }));

/** "What is it?": the visible types with a line on each; Enter on the first makes a plain Note. Null when closed. With
 *  `open`, the same list to open a type's page. */
export async function chooseType(opts: { folder?: string; open?: boolean; except?: string[] } = {}): Promise<string | null> {
  const folder = opts.folder;
  const types = getNoteTypes().filter((t) => !t.hidden && !opts.except?.includes(t.id));
  return pick({
    placeholder: opts.open ? 'Which type? People, meetings, ideas…' : 'What is it? Enter makes a plain note',
    items: (q) =>
      fuzzyFilter(types, q, (t) => `${t.name} ${t.plural} ${t.hint}`).map((t) => ({
        id: t.id,
        label: t.name,
        detail: folder !== undefined && t.id !== 'project' && t.id !== 'doc' ? (folder ? `in ${folder}` : '') : t.folder && t.id !== NOTE_TYPE ? `in ${t.folder}` : '',
        sub: t.hint,
        lead: typeChip(t),
      })),
    footer: opts.open ? '↑↓ to move · Enter to open · Esc to cancel' : '↑↓ to move · Enter to make it · Esc to cancel',
  });
}

export interface NewOfType {
  /** The folder it goes in (a folder's own New note; the top of the notes counts only for a plain Note); else the type's
   *  home folder (a Note: where new notes go). */
  folder?: string;
  where?: W.Where;
  /** Its name; else "Untitled" (or "Untitled meeting"…), selected to type over. */
  title?: string;
  /** Values it is made with (a board's column, a calendar's day). */
  values?: Record<string, PropValue>;
  /** False: made without being opened (an @ link made while writing); its path comes back. */
  open?: boolean;
  /** False: when nothing says what type it is, a plain Note without asking (a note named in Open a note). */
  ask?: boolean;
}

/**
 * The one way to make a new note (every New note button, key, menu and command, the @ link): of the type given, or asked
 * with "What is it?" (skipped when the folder given is a type's home). Made in its folder with its fields and first words
 * and `type:` set, opened with its name selected. Null when cancelled or it couldn't be made (the message says why).
 */
export async function newNoteOfType(typeId?: string, opts: NewOfType = {}): Promise<string | null> {
  try {
    const types = getNoteTypes();
    let id = typeId ?? (opts.folder ? typeForFolder(opts.folder, types)?.id : undefined);
    if (!id) id = opts.ask === false ? NOTE_TYPE : ((await chooseType({ folder: opts.folder })) ?? undefined);
    if (!id) return null;
    const type = findType(types, id) ?? findType(types, NOTE_TYPE)!;
    if (type.id === 'project') {
      // A project is its project file, made by the New project window (its shape, its folder on this PC).
      const { newProject } = await import('./templates');
      newProject();
      return null;
    }
    if (type.id === 'doc') {
      const { newDoc } = await import('./docKind');
      if (!opts.title) return await newDoc();
      const path = await window.nv.docs.create(opts.title);
      await loadNotes();
      if (opts.open !== false) A.openPath(path, { where: opts.where ?? 'current' });
      return path;
    }
    // The folder the person was in, except the top of the notes: a person made from there still goes in People.
    // With areas of life (Wave 4), nothing said: in the area the person is in (else where new things go), in the type's
    // own folder there ("Work/People").
    const folder = opts.folder !== undefined && (opts.folder !== '' || type.id === NOTE_TYPE) ? opts.folder : (areaFolderFor(type.folder) ?? (type.folder || A.newNoteFolder()));
    // A typed title past what a file keeps is fitted to leading words, said aloud (t207 pass 2: it cut silently).
    const fit = fitTypedName(opts.title?.trim() || (type.id === NOTE_TYPE ? 'Untitled' : `Untitled ${type.name.toLowerCase()}`));
    if (fit.cut) toast('That name was shortened to fit.');
    const title = fit.name;
    const p = prefs();
    const text = newTypedNoteText(type, { title, dateFormat: p.dateFormat, timeFormat: p.timeFormat, values: opts.values });
    if (opts.open === false) {
      const path = await window.nv.files.create(folder, title, '.md', text);
      await loadNotes();
      return path;
    }
    return await A.newNote(folder, opts.where ?? 'current', text, title);
  } catch (err) {
    showError(err);
    return null;
  }
}

/** The one New door (8 Nov 2026, the quiet More): the bar's New button and the header's plus open the
 *  same menu: a note (its kind or template chosen inline below), a canvas, a view. Ctrl+N still
 *  writes first, past the door. */
export function openNewDoor(anchor: HTMLElement): void {
  openMenu(anchor, [
    { label: 'New note…', icon: 'filePlus', run: () => void newNoteDoor() },
    { label: 'New canvas', icon: 'canvas', run: () => void A.newCanvas() },
    { label: 'New view', icon: 'views', run: () => void import('./savedViews').then((v) => v.newView()) },
  ]);
}

/** New note with its kind or template chosen inline (8 Nov 2026, the quiet More): the visible kinds, then
 *  the note templates, in the one list. A kind makes that kind (a project opens the New project window, a
 *  doc the New doc steps); a template starts from it. Null when cancelled. */
export async function newNoteDoor(opts: NewOfType = {}): Promise<string | null> {
  try {
    const types = getNoteTypes().filter((t) => !t.hidden);
    const { noteTemplates, openTemplates, startFromTemplate } = await import('./templates');
    const templates = await noteTemplates().catch(() => []);
    const picked = await pick({
      placeholder: 'What kind of note? A kind or a template',
      items: (q) => [
        ...fuzzyFilter(types, q, (t) => `${t.name} ${t.plural} ${t.hint}`).map((t) => ({ id: `type:${t.id}`, label: t.name, sub: t.hint, lead: typeChip(t), section: 'Kind' })),
        ...fuzzyFilter(templates, q, (t) => `${t.name} ${t.description}`).map((t) => ({ id: `template:${t.path}`, label: t.name, detail: t.description || undefined, icon: 'template' as const, section: 'From a template' })),
      ],
      extraRow: () => ({ label: 'See every template…', run: () => openTemplates() }),
      footer: '↑↓ to move · Enter to make it · Esc to cancel',
    });
    if (!picked) return null;
    if (picked.startsWith('type:')) return newNoteOfType(picked.slice('type:'.length), opts);
    const chosen = templates.find((t) => `template:${t.path}` === picked);
    if (chosen) return startFromTemplate(chosen, { folder: opts.folder });
    return null;
  } catch (err) {
    showError(err);
    return null;
  }
}

/** Write first (5 Nov 2026, one rule): New does not ask a kind or a folder first. A plain note
 *  opens straight away; once it has words the same filing proposes a home, offered once. The guided
 *  door (New › New note…) stays for those who want it. */
export async function newNoteWriteFirst(where: W.Where = 'current'): Promise<string | null> {
  const path = await newNoteOfType('note', { where, ask: false });
  if (!path) return null;
  await noteWriteFirst(path);
  return path;
}

/** A note that started by writing (every door: the New command, Home's first note, a plain Note from
 *  "What is it?"): offered a home once it has words, dropped when closed empty. */
export async function noteWriteFirst(path: string): Promise<void> {
  const { markWriteFirst } = await import('./writeFirst');
  markWriteFirst(path);
  void watchWriteFirst();
}

/** A person or organisation card, as the Inbox reads it (views/InboxPage.tsx): one test for both. */
const isPersonCardLocal = (type: unknown): boolean => /^(person|people|contact|organisation|organization|company|org)$/i.test(String(type ?? ''));

let watching = false;
/** Once a write-first note has words, the same filing proposes a home, offered once as a toast with
 *  File. Moves only (a project or an area folder): appending to a card stays a choice in the note. */
async function watchWriteFirst(): Promise<void> {
  if (watching) return;
  watching = true;
  const { docs } = await import('./docs');
  const { isEmptyNote } = await import('../../../shared/note-types');
  const { suggestInboxHome } = await import('../../../shared/inbox-suggest');
  const { isProjectProps } = await import('../../../shared/project-file');
  const { modulesOn } = await import('../../../shared/life-modules');
  const { resolveAny } = await import('../lib/resolve');
  docs.onText((path, text) => {
    void (async () => {
      const { isWriteFirst, takePropose, clearWriteFirst } = await import('./writeFirst');
      if (!isWriteFirst(path) || isEmptyNote(text)) return;
      if (!takePropose(path)) return;
      try {
        const notes = getState().notes;
        const areasNow = getAreas()?.areas.filter((a) => !a.hidden) ?? [];
        const { areaOfPath } = await import('./areas');
        const areaOf = (p: string) => areaOfPath(p)?.id;
        const projects = notes.filter((n) => isProjectProps(n.props)).map((n) => ({ path: n.path, name: n.label || n.title, people: [] as string[], tags: n.tags, modified: n.mtime, area: areaOf(n.path) }));
        const people = notes.filter((n) => isPersonCardLocal(n.props?.type)).map((n) => ({ name: n.title, path: n.path, names: n.aliases, area: areaOf(n.path) }));
        const words = String(text).replace(/^---[\s\S]*?\n---\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 500);
        const found = suggestInboxHome({ words, text: words, links: [], task: false }, { projects, people, notes: [], areas: areasNow.map((a) => ({ id: a.id, name: a.name })), modules: modulesOn(prefs().modules).map((m) => ({ id: m.id, name: m.name })), resolve: (t: string) => resolveAny(t, path) });
        const home = found.find((s) => s.target.kind === 'project' || s.target.kind === 'area');
        if (!home) return;
        const where = home.target.kind === 'project' ? home.target.name : home.target.name;
        toast(`File it in ${where}?`, {
          label: 'File',
          run: () => void fileWriteFirstNote(path, home.target.kind, home.target.path, home.target.area).then((done) => {
            if (done) clearWriteFirst(path);
          }),
        });
      } catch {
        // No home offered; the note stays where it is.
      }
    })();
  });
}

/** A write-first note filed where proposed: moved to the project's or area's folder (links kept). */
async function fileWriteFirstNote(path: string, kind: string, targetPath?: string, area?: string): Promise<boolean> {
  try {
    // The offer stands for the note it was offered for only (Nov 2026 break: a stale tap after the
    // note was filed, closed or replaced moves nothing the person placed on purpose).
    const { isWriteFirst } = await import('./writeFirst');
    if (!isWriteFirst(path)) return false;
    const { docs } = await import('./docs');
    await docs.flush(path);
    let folder = '';
    if (kind === 'project' && targetPath) folder = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : '';
    else if (kind === 'area' && area) folder = getAreas()?.areas.find((a) => a.id === area)?.folder ?? '';
    if (!folder) return false;
    const name = path.split('/').pop() ?? 'Untitled.md';
    const next = await A.movePath(path, `${folder}/${name}`);
    if (next) toast(`Filed in ${folder.split('/').pop() ?? folder}.`);
    return !!next;
  } catch (err) {
    showError(err);
    return false;
  }
}

/** A calendar event's meeting note, found or made (9.2 uplift F61): one note per event, never
 *  "Meeting note 1 Nov" and "Meeting note 1 Nov 1" — the note already made from the event opens instead. */
export async function openMeetingNoteFor(e: CalendarEvent, day: string): Promise<void> {
  const have = getState().notes.find((n) => n.props?.['calendar-event'] === e.id);
  if (have) {
    A.openPath(have.path, { where: 'current' });
    return;
  }
  const { title, values } = meetingNoteFor(e, day);
  await newNoteOfType('meeting', { where: 'tab', title, values });
}

/** A note made from an @ link while writing: said in a line, with where it went. */
export function madeWords(path: string, type: NoteType): void {
  toast(`Made “${A.titleOf(path)}” a ${type.name.toLowerCase()} in ${A.folderOf(path) || 'your notes'}.`, { label: 'Open', run: () => A.openPath(path, { where: 'tab' }) });
}

// ── For the note page (components/NotePageTop.tsx, NoteFields.tsx) ───────────────────────────────────────────────────

/** A note's type as the note page shows it (its chip, the fields it offers): the `type:` it names, else its folder, else a
 *  Note; a `type:` naming no type keeps its own words with a plain tag. */
export function pageTypeFor(path: string, props: Record<string, unknown> | undefined): PageType | null {
  const types = getNoteTypes();
  const named = props?.type;
  if (typeof named === 'string' && named.trim() && !typeNamed(named, types)) return pageType(named.trim().toLowerCase());
  const id = typeOfNote({ path, props }, types, prefs().templatesFolder);
  const t = id ? findType(types, id) : undefined;
  if (!t) return null;
  const hint = (k: string): FieldKindHint => (k === 'date' || k === 'datetime' ? 'date' : k === 'checkbox' ? 'checkbox' : k === 'number' ? 'number' : k === 'list' || k === 'links' || k === 'tags' ? 'list' : 'text');
  return { id: t.id, name: t.name, icon: t.icon as PageType['icon'], color: t.color, fields: t.fields.map((f) => ({ key: f.key, kind: hint(String(f.kind)) })) };
}

/** Every visible type for the page's "Change type" menu, in the person's order. */
export function pageTypeChoices(): PageType[] {
  return getNoteTypes().filter((t) => !t.hidden).map((t) => ({ id: t.id, name: t.name, icon: t.icon as PageType['icon'], fields: [] }));
}
