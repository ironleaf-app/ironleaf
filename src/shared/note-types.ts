// Note types (20 Oct 2026; Ironleaf Calm, wave B): what a note is — a plain note, a project, a doc, a person, a meeting,
// a resource (a link, a book, a PDF, an article) or an idea, or a type of the person's own. A type gives a note its icon
// and colour, the fields it starts with, its first words, the folder it is kept in, and a page listing every note of that
// type (built on the saved views engine, src/shared/views.ts, without a view file).
//
// Which type a note is, in order:
//   1. its `type:` property, when it names a type (the id, or the type's name or plural in any case: Person, people,
//      contact). A `type:` that names no type (the former host app's decision and status-update notes, a word of the
//      person's own)
//      is kept exactly as written and the note shows as a Note: the file says what it is, and guessing from its folder
//      would contradict it. Nothing is ever rewritten to "fix" it.
//   2. else its folder: a note in a type's home folder or below (People/…, Meetings/2026/…). Two exceptions keep today's
//      meaning: a project is only ever `type: project` (the notes inside a project's folder are that project's notes, not
//      projects), and a doc is a note directly in the Docs folder (Docs/<Name>/ holds a doc's own files beside it), as
//      src/shared/doc-file.ts's isDocNote has it.
//   3. else a Note.
// Notes in the templates folder are templates, not notes of any type: they are left out of every count and page.
//
// The types live in the vault as a small file the person owns (.neuralvault/types.json, src/main/note-types.ts), so they
// travel with the notes: renamed, hidden and reordered built-ins (only what differs is written), the person's own types,
// and how each type's page is laid out. Nothing on disk moves when types change: a home folder is only where new notes of
// that type go and where notes without a `type:` are recognised.
//
// Pure: no Node, no DOM. The window, the main side (the vault assistant's words) and the tests use it as it is.

import { fillTemplate } from './dates';
import { setNoteProp, readView, writeView, defaultView, FIELD_FOLDER, FIELD_MODIFIED, FIELD_TITLE, LAYOUTS, type ViewDef, type ViewLayout } from './views';
import type { PropValue } from './frontmatter';
import { MODULE_TYPES, typeFolder as moduleTypeFolder } from './module-records';

export const TYPES_FILE = '.neuralvault/types.json';

/** The line icons a type can have (each is drawn in src/renderer/src/components/Icon.tsx; a test checks). */
export const TYPE_ICONS = ['notes', 'layers', 'doc', 'person', 'people', 'calendar', 'book', 'bulb', 'link', 'star', 'flag', 'globe', 'briefcase', 'tag', 'task', 'chat', 'mail', 'image', 'canvas', 'bolt', 'sun', 'pin', 'heart', 'home', 'wallet', 'receipt', 'bank', 'idcard', 'chart', 'table', 'car', 'plane'] as const;
export type TypeIcon = (typeof TYPE_ICONS)[number];

/** The muted colours a type can carry (tokens --type-<colour> in styles/types.css, light first, dark by tokens). */
export const TYPE_COLORS = ['stone', 'clay', 'slate', 'sky', 'ochre', 'sage', 'plum', 'rose', 'teal'] as const;
export type TypeColor = (typeof TYPE_COLORS)[number];
export const COLOR_WORDS: Record<TypeColor, string> = { stone: 'Stone', clay: 'Clay', slate: 'Slate', sky: 'Sky', ochre: 'Ochre', sage: 'Sage', plum: 'Plum', rose: 'Rose', teal: 'Teal' };

/** What kind of value a field holds: how a new note writes it, and how the page and the assistant read it. */
export type FieldKind = 'text' | 'date' | 'time' | 'link' | 'links' | 'list' | 'url' | 'email' | 'phone' | 'choice' | 'number';
export const FIELD_KINDS: FieldKind[] = ['text', 'date', 'time', 'link', 'links', 'list', 'url', 'email', 'phone', 'choice', 'number'];
export const FIELD_KIND_WORDS: Record<FieldKind, string> = { text: 'Words', date: 'Date', time: 'Time', link: 'A link to a note', links: 'Links to notes', list: 'A list', url: 'Web address', email: 'Email', phone: 'Phone', choice: 'One of a few', number: 'Number' };

export interface TypeField {
  /** The property's name in the note ("organisation"). */
  key: string;
  kind: FieldKind;
  /** For choice: the values offered (the first is a new note's, unless `initial` says otherwise). */
  options?: string[];
  /** For link and links: the type of note it points to (Meeting's people → person). */
  linkType?: string;
  /** What a new note starts with ({{date:YYYY-MM-DD}} and the other template words are filled in). */
  initial?: string;
}

/** A type as the window uses it: the built-in's defaults with the person's changes, or the person's own type. */
export interface NoteType {
  id: string;
  name: string;
  plural: string;
  icon: TypeIcon;
  color: TypeColor;
  /** One line under its name in "What is it?". */
  hint: string;
  fields: TypeField[];
  /** A new note's words after its properties (template words filled in). */
  template: string;
  /** Where new notes of this type go and where notes without a `type:` are recognised ('' for Note: where Settings ›
   *  Files and links puts new notes). */
  folder: string;
  /** below: the folder and every folder in it · direct: only notes directly in it (docs) · none: never by folder. */
  folderMatch: 'below' | 'direct' | 'none';
  /** How its page shows first, before the person changes it. */
  view: ViewDef;
  /** The person's own display for its page (from the types file), when they changed it. */
  display: ViewDef | null;
  /** Other words a `type:` may use for it (lower case). */
  aliases: string[];
  /** The page's empty state. */
  empty: { title: string; line: string };
  builtIn: boolean;
  hidden: boolean;
  /** A module's record type (src/shared/module-records.ts: a Bill is Finance's): hidden while its module is off. */
  module?: string;
}

/** One entry of the types file: for a built-in only what differs from its defaults; for the person's own, all of it. */
export interface TypeEntry {
  id: string;
  custom?: boolean;
  name?: string;
  plural?: string;
  icon?: string;
  color?: string;
  hint?: string;
  fields?: TypeField[];
  template?: string;
  folder?: string;
  layout?: ViewLayout;
  hidden?: boolean;
  /** The page's display, as a view file keeps it (src/shared/views.ts writeView), without its source. */
  display?: Record<string, unknown>;
}

export interface TypesConfig {
  version: 1;
  /** In the order the person put them; built-ins left out are added after, in their own order. */
  entries: TypeEntry[];
}

/** Where things are in this vault, for a type's home folder. */
export interface TypeContext {
  /** The folders at the top of the notes ("02 Projects", "People"). */
  topFolders: string[];
  /** The templates folder: its notes are templates, never notes of a type. */
  templatesFolder?: string;
  /** Where docs are kept ('Docs' when not given). */
  docsFolder?: string;
  /** The modules' record types in this vault (src/shared/module-records.ts moduleTypeInputs): each one's folder and whether its
   *  module is on. Left out, every module type is hidden (modules are off until turned on). */
  modules?: readonly { id: string; module: string; folder: string; on: boolean }[];
}

// ── The built-in types ────────────────────────────────────────────────────────────────────────────────────────────────

interface BuiltIn {
  id: string;
  name: string;
  plural: string;
  icon: TypeIcon;
  color: TypeColor;
  hint: string;
  fields: TypeField[];
  template: string;
  /** The home folder's usual names (the first is made when none is there); '' for Note, special for Project and Doc. */
  folders: string[];
  folderMatch: NoteType['folderMatch'];
  layout: ViewLayout;
  view: Partial<ViewDef>;
  aliases: string[];
  empty: { title: string; line: string };
  /** A module's type: hidden while the module is off; its folder is the module's (TypeContext.modules). */
  module?: string;
}

const BUILT_INS: BuiltIn[] = [
  {
    id: 'note',
    name: 'Note',
    plural: 'Notes',
    icon: 'notes',
    color: 'stone',
    hint: 'Anything you want to write down',
    fields: [],
    template: '',
    folders: [],
    folderMatch: 'none',
    layout: 'table',
    view: { columns: [FIELD_FOLDER, FIELD_MODIFIED], sort: { prop: FIELD_MODIFIED, dir: 'desc' } },
    aliases: ['notes', 'page', 'plain'],
    empty: { title: 'No notes yet.', line: 'Write something down and it shows here.' },
  },
  {
    id: 'project',
    name: 'Project',
    plural: 'Projects',
    icon: 'layers',
    color: 'clay',
    hint: 'Work with an outcome, people and dates',
    // A project's facts are its project file's (src/shared/project-file.ts): the Projects page and the project's own page
    // show them, and nothing here changes how a project file is written.
    fields: [],
    template: '',
    folders: ['Projects'],
    folderMatch: 'none',
    layout: 'table',
    view: { columns: ['status', 'health', 'due'], sort: { prop: FIELD_TITLE, dir: 'asc' } },
    aliases: ['projects'],
    empty: { title: 'No projects yet.', line: 'Add work you want to see through, with its people and dates.' },
  },
  {
    id: 'doc',
    name: 'Doc',
    plural: 'Docs',
    icon: 'doc',
    color: 'slate',
    hint: 'How something is set up or run, kept up to date',
    fields: [],
    template: '',
    folders: ['Docs'],
    folderMatch: 'direct',
    layout: 'table',
    view: { columns: ['about', 'updated'], sort: { prop: FIELD_TITLE, dir: 'asc' } },
    aliases: ['docs'],
    empty: { title: 'No docs yet.', line: 'Add how something is set up or run: a server, a routine, a process.' },
  },
  {
    id: 'person',
    name: 'Person',
    plural: 'People',
    icon: 'person',
    color: 'sky',
    hint: 'Someone you work with or know',
    fields: [
      { key: 'role', kind: 'text' },
      { key: 'organisation', kind: 'text' },
      { key: 'email', kind: 'email' },
      { key: 'phone', kind: 'phone' },
    ],
    template: '## About\n\n\n## Notes\n\n',
    folders: ['People', 'Contacts'],
    folderMatch: 'below',
    layout: 'table',
    view: { columns: ['role', 'organisation', 'email', 'phone'], cardProps: ['organisation'], sort: { prop: FIELD_TITLE, dir: 'asc' } },
    aliases: ['people', 'contact', 'contacts'],
    empty: { title: 'No people yet.', line: 'Add someone you work with.' },
  },
  {
    id: 'meeting',
    name: 'Meeting',
    plural: 'Meetings',
    icon: 'calendar',
    color: 'ochre',
    hint: 'Who was there, what was said, what happens next',
    fields: [
      { key: 'date', kind: 'date', initial: '{{date:YYYY-MM-DD}}' },
      { key: 'time', kind: 'time' },
      { key: 'people', kind: 'links', linkType: 'person' },
      { key: 'project', kind: 'link', linkType: 'project' },
    ],
    template: '## Agenda\n\n- \n\n## Notes\n\n\n## Actions\n\n- [ ] \n',
    folders: ['Meetings'],
    folderMatch: 'below',
    layout: 'table',
    view: { columns: ['date', 'time', 'people', 'project'], dateProp: 'date', cardProps: ['time'], sort: { prop: 'date', dir: 'desc' } },
    aliases: ['meetings', 'meeting-notes', 'meeting notes'],
    empty: { title: 'No meetings yet.', line: 'Add a meeting to keep who was there and what was agreed.' },
  },
  {
    id: 'resource',
    name: 'Resource',
    plural: 'Resources',
    icon: 'book',
    color: 'sage',
    hint: 'A link, book, PDF or article to keep',
    fields: [
      { key: 'kind', kind: 'choice', options: ['Link', 'Book', 'PDF', 'Article', 'Video', 'Podcast'], initial: '' },
      { key: 'url', kind: 'url' },
      { key: 'author', kind: 'text' },
      { key: 'status', kind: 'choice', options: ['To read', 'Reading', 'Done'], initial: 'To read' },
    ],
    template: '## Summary\n\n\n## Worth keeping\n\n',
    folders: ['Resources'],
    folderMatch: 'below',
    layout: 'table',
    view: { columns: ['kind', 'author', 'status', 'url'], groupBy: 'status', groupOrder: ['To read', 'Reading', 'Done'], sort: { prop: FIELD_MODIFIED, dir: 'desc' } },
    aliases: ['resources', 'link', 'book', 'article', 'reference'],
    empty: { title: 'No resources yet.', line: 'Add a link, a book or an article you want to keep.' },
  },
  {
    id: 'idea',
    name: 'Idea',
    plural: 'Ideas',
    icon: 'bulb',
    color: 'plum',
    hint: 'Something to think about or try later',
    fields: [
      { key: 'status', kind: 'choice', options: ['New', 'Exploring', 'Planned', 'Parked', 'Done'], initial: 'New' },
      { key: 'tags', kind: 'list' },
    ],
    template: '## The idea\n\n\n## Why it matters\n\n\n## A first step\n\n- [ ] \n',
    folders: ['Ideas'],
    folderMatch: 'below',
    layout: 'board',
    view: { groupBy: 'status', groupOrder: ['New', 'Exploring', 'Planned', 'Parked', 'Done'], cardProps: ['tags'], columns: ['status', 'tags'], sort: { prop: FIELD_MODIFIED, dir: 'desc' } },
    aliases: ['ideas'],
    empty: { title: 'No ideas yet.', line: 'Jot down something you want to try.' },
  },
];

// The modules' record types (src/shared/module-records.ts: Finance's Bill, Account, Budget and Spending month; Documents and ID's
// ID document) are built-ins too: renamed or hidden like any, never deleted, and there only while their module is on.
const MODULE_BUILT_INS: BuiltIn[] = MODULE_TYPES.map((t) => ({
  id: t.id,
  name: t.name,
  plural: t.plural,
  icon: t.icon as TypeIcon,
  color: t.color as TypeColor,
  hint: t.hint,
  fields: t.fields as TypeField[],
  template: t.template,
  folders: [],
  folderMatch: 'below',
  layout: 'table',
  view: { columns: t.columns, ...(t.dateProp ? { dateProp: t.dateProp } : {}), sort: { prop: t.dateProp ?? FIELD_TITLE, dir: 'asc' } },
  aliases: t.aliases,
  empty: t.empty,
  module: t.module,
}));
const ALL_BUILT_INS: BuiltIn[] = [...BUILT_INS, ...MODULE_BUILT_INS];

export const BUILT_IN_IDS = ALL_BUILT_INS.map((b) => b.id);
export const NOTE_TYPE = 'note';

// ── Reading and writing the types file ────────────────────────────────────────────────────────────────────────────────

const str = (v: unknown, max = 80): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : undefined);
/** Cleaned folders, kept (t102, 9 Nov 2026): the same folders clean thousands of times per list build. Pure. */
const cleanDirs = new Map<string, string>();
const cleanDir = (d: string): string => {
  const had = cleanDirs.get(d);
  if (had !== undefined) return had;
  const out = d.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  if (cleanDirs.size > 20000) cleanDirs.clear();
  cleanDirs.set(d, out);
  return out;
};

/** A folder inside the notes as the types file may give it ('' for none; never one that climbs out or is hidden). */
function cleanFolder(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 200) return undefined;
  const d = cleanDir(v.trim());
  if (/[<>:"|?*\u0000-\u001f]/.test(d) || d.split('/').some((p) => p === '..' || p === '.' || p.startsWith('.'))) return undefined;
  return d;
}

/** A type's id from its name: lower case, words joined by a dash ("Client site" → client-site). */
export function typeId(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KEY = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u;

function cleanFields(v: unknown): TypeField[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: TypeField[] = [];
  for (const raw of v.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const key = str(r.key, 40);
    if (!key || !KEY.test(key) || key.toLowerCase() === 'type' || out.some((f) => f.key.toLowerCase() === key.toLowerCase())) continue;
    const kind = FIELD_KINDS.includes(r.kind as FieldKind) ? (r.kind as FieldKind) : 'text';
    const options = Array.isArray(r.options) ? [...new Set(r.options.map((o) => str(o, 40)).filter((o): o is string => !!o))].slice(0, 20) : undefined;
    const linkType = str(r.linkType, 40);
    const initial = typeof r.initial === 'string' ? r.initial.slice(0, 200) : undefined;
    out.push({ key, kind, ...(kind === 'choice' && options?.length ? { options } : {}), ...((kind === 'link' || kind === 'links') && linkType && ID.test(linkType) ? { linkType } : {}), ...(initial !== undefined ? { initial } : {}) });
  }
  return out;
}

function cleanEntry(raw: unknown): TypeEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 40)?.toLowerCase();
  if (!id || !ID.test(id)) return null;
  const builtIn = BUILT_IN_IDS.includes(id);
  // A type of the person's own needs a name; a built-in's entry may say only that it is hidden or where it is.
  const name = str(r.name, 40);
  if (!builtIn && !name) return null;
  const e: TypeEntry = { id };
  if (!builtIn) e.custom = true;
  if (name) e.name = name;
  const plural = str(r.plural, 40);
  if (plural) e.plural = plural;
  if (TYPE_ICONS.includes(r.icon as TypeIcon)) e.icon = r.icon as string;
  if (TYPE_COLORS.includes(r.color as TypeColor)) e.color = r.color as string;
  const hint = str(r.hint, 120);
  if (hint) e.hint = hint;
  const fields = cleanFields(r.fields);
  if (fields) e.fields = fields;
  if (typeof r.template === 'string') e.template = r.template.slice(0, 20000);
  const folder = cleanFolder(r.folder);
  if (folder !== undefined && (folder || !builtIn || id === NOTE_TYPE)) e.folder = folder;
  if (LAYOUTS.includes(r.layout as ViewLayout)) e.layout = r.layout as ViewLayout;
  if (r.hidden === true && id !== NOTE_TYPE) e.hidden = true;
  if (r.display && typeof r.display === 'object' && !Array.isArray(r.display)) e.display = displayOf(readView(JSON.stringify(r.display)).def);
  return e;
}

/** The display as the types file keeps it: a view file's words without its source (a type's page shows the type). */
function displayOf(def: ViewDef): Record<string, unknown> {
  const out = JSON.parse(writeView(def)) as Record<string, unknown>;
  delete out.version;
  delete out.source;
  return out;
}

export function emptyConfig(): TypesConfig {
  return { version: 1, entries: [] };
}

/**
 * The types file as the person (or another app) left it: anything not understood is left out, so a hand-edited file
 * still opens. `problem` says in plain words when it couldn't be read at all (the built-in types are used meanwhile).
 */
export function readTypes(text: string): { config: TypesConfig; problem: string | null } {
  if (!text.trim()) return { config: emptyConfig(), problem: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { config: emptyConfig(), problem: 'Your note types file (.neuralvault/types.json) couldn’t be read, so the usual types are shown. Changing a type in Settings writes it afresh.' };
  }
  const list = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).types : undefined;
  const entries: TypeEntry[] = [];
  if (Array.isArray(list)) {
    for (const item of list.slice(0, 60)) {
      const e = cleanEntry(item);
      if (e && !entries.some((x) => x.id === e.id)) entries.push(e);
    }
  }
  return { config: { version: 1, entries }, problem: null };
}

/** The types file's words: every type in order (built-ins with only what the person changed), tab-indented. */
export function writeTypes(config: TypesConfig): string {
  const types = config.entries.map((e) => {
    const out: Record<string, unknown> = { id: e.id };
    for (const k of ['custom', 'name', 'plural', 'icon', 'color', 'hint', 'folder', 'layout', 'hidden', 'fields', 'template', 'display'] as const) {
      const v = e[k];
      if (v === undefined || v === false) continue;
      out[k] = v;
    }
    return out;
  });
  return `${JSON.stringify({ version: 1, types }, null, '\t')}\n`;
}

// ── The types as the window uses them ─────────────────────────────────────────────────────────────────────────────────

/** The vault's own folder for a type: one already at the top under a usual name ("02 People" counts), else the first. */
function homeFolder(names: string[], top: string[]): string {
  if (!names.length) return '';
  for (const name of names) {
    const re = new RegExp(`^(?:\\d+[\\s._-]*)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const found = top.filter((t) => re.test(t));
    const exact = found.find((t) => t === name);
    if (exact || found.length) return exact ?? found.sort()[0];
  }
  return names[0];
}

function viewFor(layout: ViewLayout, view: Partial<ViewDef>): ViewDef {
  return { ...defaultView({ kind: 'all' }, layout), ...view, source: { kind: 'all' }, layout };
}

function customType(e: TypeEntry): NoteType {
  const name = e.name ?? e.id;
  const plural = e.plural ?? `${name}s`;
  const fields = e.fields ?? [];
  const layout = e.layout ?? 'table';
  const choice = fields.find((f) => f.kind === 'choice');
  const date = fields.find((f) => f.kind === 'date');
  const view: Partial<ViewDef> = {
    columns: fields.slice(0, 5).map((f) => f.key),
    ...(choice ? { groupBy: choice.key, groupOrder: choice.options ?? [] } : {}),
    ...(date ? { dateProp: date.key } : {}),
    cardProps: fields.filter((f) => f !== choice && f !== date).slice(0, 1).map((f) => f.key),
    sort: { prop: FIELD_MODIFIED, dir: 'desc' },
  };
  return {
    id: e.id,
    name,
    plural,
    icon: (e.icon as TypeIcon) ?? 'tag',
    color: (e.color as TypeColor) ?? 'teal',
    hint: e.hint ?? `A ${name.toLowerCase()} of your own`,
    fields,
    template: e.template ?? '',
    folder: e.folder ?? plural,
    folderMatch: e.folder === '' ? 'none' : 'below',
    view: viewFor(layout, view),
    display: e.display ? { ...readView(JSON.stringify({ ...e.display, source: { kind: 'all' } })).def } : null,
    aliases: [name.toLowerCase(), plural.toLowerCase()],
    empty: { title: `No ${plural.toLowerCase()} yet.`, line: `Add your first ${name.toLowerCase()}.` },
    builtIn: false,
    hidden: !!e.hidden,
  };
}

function builtInType(b: BuiltIn, e: TypeEntry | undefined, ctx: TypeContext): NoteType {
  const top = ctx.topFolders.filter((f) => !f.includes('/'));
  // The vault's own projects and docs folders: what the Projects page and the Docs section already use.
  const mod = b.module ? ctx.modules?.find((m) => m.id === b.id) : undefined;
  const own = b.module ? cleanDir(mod?.folder ?? moduleTypeFolder(b.id, null)) : b.id === 'project' ? homeFolder(['Projects'], top) : b.id === 'doc' ? cleanDir(ctx.docsFolder ?? 'Docs') : homeFolder(b.folders, top);
  const name = e?.name ?? b.name;
  const plural = e?.plural ?? b.plural;
  const renamed = name !== b.name || plural !== b.plural;
  const layout = e?.layout ?? b.layout;
  return {
    id: b.id,
    name,
    plural,
    icon: (e?.icon as TypeIcon) ?? b.icon,
    color: (e?.color as TypeColor) ?? b.color,
    hint: e?.hint ?? b.hint,
    fields: e?.fields ?? b.fields,
    template: e?.template ?? b.template,
    folder: e?.folder !== undefined && b.id !== 'project' && b.id !== 'doc' ? e.folder : own,
    folderMatch: b.folderMatch,
    view: viewFor(layout, b.view),
    display: e?.display ? readView(JSON.stringify({ ...e.display, source: { kind: 'all' } })).def : null,
    aliases: [...new Set([b.id, b.name.toLowerCase(), b.plural.toLowerCase(), ...b.aliases, ...(renamed ? [name.toLowerCase(), plural.toLowerCase()] : [])])],
    empty: renamed ? { title: `No ${plural.toLowerCase()} yet.`, line: b.empty.line } : b.empty,
    builtIn: true,
    hidden: !!e?.hidden || (!!b.module && !mod?.on),
    ...(b.module ? { module: b.module } : {}),
  };
}

/** Every type in the person's order (hidden ones too, marked), with this vault's folders. */
export function resolveTypes(config: TypesConfig, ctx: TypeContext): NoteType[] {
  const byId = new Map(config.entries.map((e) => [e.id, e]));
  const out: NoteType[] = [];
  const seen = new Set<string>();
  for (const e of config.entries) {
    const b = ALL_BUILT_INS.find((x) => x.id === e.id);
    out.push(b ? builtInType(b, e, ctx) : customType(e));
    seen.add(e.id);
  }
  // Built-ins the file doesn't list (no file yet, or written before a type was added) go in their own place.
  ALL_BUILT_INS.forEach((b, i) => {
    if (seen.has(b.id)) return;
    const t = builtInType(b, byId.get(b.id), ctx);
    // After the built-in that comes before it in the usual order, so a new built-in lands where it belongs.
    const before = ALL_BUILT_INS.slice(0, i).map((x) => x.id);
    let at = 0;
    out.forEach((x, j) => before.includes(x.id) && (at = j + 1));
    out.splice(at, 0, t);
  });
  // Note always comes first: it is the plain choice, Enter in "What is it?".
  const note = out.findIndex((t) => t.id === NOTE_TYPE);
  if (note > 0) out.unshift(...out.splice(note, 1));
  return out;
}

export const findType = (types: readonly NoteType[], id: string | undefined): NoteType | undefined => (id ? types.find((t) => t.id === id) : undefined);

// ── Which type a note is ──────────────────────────────────────────────────────────────────────────────────────────────

const lowerDir = (d: string | undefined) => cleanDir(d ?? '').toLowerCase();

/** Whether a note is in the templates folder (a template, never a note of a type). */
export function isTemplatePath(path: string, templatesFolder: string | undefined): boolean {
  const t = lowerDir(templatesFolder);
  return !!t && path.toLowerCase().startsWith(`${t}/`);
}

/** The type a `type:` property names (by id, name, plural or another word for it), or undefined. */
export function typeNamed(value: unknown, types: readonly NoteType[]): NoteType | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const v = raw.trim().toLowerCase();
  return types.find((t) => t.id === v) ?? types.find((t) => t.aliases.includes(v));
}

/** The type whose home folder a folder is (or is inside), the deepest home first; undefined when none. */
export function typeForFolder(folder: string, types: readonly NoteType[]): NoteType | undefined {
  const f = lowerDir(folder);
  let best: NoteType | undefined;
  let depth = -1;
  for (const t of types) {
    if (t.folderMatch === 'none' || !t.folder) continue;
    const home = lowerDir(t.folder);
    const inside = t.folderMatch === 'direct' ? f === home : f === home || f.startsWith(`${home}/`);
    if (inside && home.length > depth) {
      best = t;
      depth = home.length;
    }
  }
  return best;
}

/**
 * The type of a note (see the top of this file): its `type:`, else its folder, else Note. Null for a template (a note in
 * the templates folder), which is no type's.
 */
export function typeOfNote(note: { path: string; props?: Record<string, unknown> }, types: readonly NoteType[], templatesFolder?: string): string | null {
  if (isTemplatePath(note.path, templatesFolder)) return null;
  const value = note.props?.type;
  if (value !== undefined && value !== null && String(value).trim() !== '') return typeNamed(value, types)?.id ?? NOTE_TYPE;
  if (!/\.md$/i.test(note.path)) return NOTE_TYPE;
  const folder = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '';
  return typeForFolder(folder, types)?.id ?? NOTE_TYPE;
}

/** The type of note a field points to (a meeting's people → person), when its type declares one for the field. */
export function linkTargetType(types: readonly NoteType[], sourceTypeId: string | null | undefined, key: string): string | undefined {
  const t = sourceTypeId ? types.find((x) => x.id === sourceTypeId) : undefined;
  const f = t?.fields.find((x) => x.key.toLowerCase() === key.toLowerCase());
  return f && (f.kind === 'link' || f.kind === 'links') ? f.linkType : undefined;
}

/** How many notes each type has, from the notes already in memory (the index), never the disk. */
export function countTypes(notes: readonly { path: string; props?: Record<string, unknown> }[], types: readonly NoteType[], templatesFolder?: string): Map<string, number> {
  const counts = new Map<string, number>(types.map((t) => [t.id, 0]));
  for (const n of notes) {
    const id = typeOfNote(n, types, templatesFolder);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** The notes of one type, from the notes in memory. */
export function notesOfType<N extends { path: string; props?: Record<string, unknown> }>(notes: readonly N[], typeId: string, types: readonly NoteType[], templatesFolder?: string): N[] {
  return notes.filter((n) => typeOfNote(n, types, templatesFolder) === typeId);
}

/** The view a type's page shows: the person's own display when they changed it, else the type's first one. */
export function typeView(type: NoteType): ViewDef {
  return { ...(type.display ?? type.view), source: { kind: 'all' } };
}

// ── A new note of a type ──────────────────────────────────────────────────────────────────────────────────────────────

const needsQuotes = (s: string) => s === '' || /^[\s\-?:,[\]{}#&*!|>'"%@`]|:\s|:$|\s#|\s$/.test(s) || /^(true|false|yes|no|null|on|off|~)$/i.test(s) || /^[\d.+-]+$/.test(s);
const yamlText = (s: string) => (needsQuotes(s) && !/^\d{4}-\d{2}-\d{2}$/.test(s) ? JSON.stringify(s) : s);

export interface NewNoteVars {
  /** The note's name ({{title}}). */
  title: string;
  dateFormat?: string;
  timeFormat?: string;
  now?: Date;
  /** Values it is made with (a board's column, a calendar's day), set after the type's own. */
  values?: Record<string, PropValue>;
}

/**
 * A new note's words for a type: `type:` (not for a plain Note, which stays as plain as it always was), the type's fields
 * ready to fill in (empty, or as the type starts them), any values given, then the type's first words.
 */
export function newTypedNoteText(type: NoteType, vars: NewNoteVars): string {
  const tv = { title: vars.title, dateFormat: vars.dateFormat ?? 'YYYY-MM-DD', timeFormat: vars.timeFormat ?? 'HH:mm', now: vars.now };
  const front: string[] = [];
  if (type.id !== NOTE_TYPE) front.push(`type: ${type.id}`);
  for (const f of type.fields) {
    const initial = f.initial !== undefined ? fillTemplate(f.initial, tv).trim() : f.kind === 'choice' ? (f.options?.[0] ?? '') : '';
    if (f.kind === 'links' || f.kind === 'list') front.push(`${f.key}: []`);
    else front.push(initial ? `${f.key}: ${yamlText(initial)}` : `${f.key}:`);
  }
  const body = fillTemplate(type.template, tv);
  let text = front.length ? `---\n${front.join('\n')}\n---\n${body}` : body;
  for (const [k, v] of Object.entries(vars.values ?? {})) if (k !== FIELD_TITLE && k !== FIELD_FOLDER && k !== FIELD_MODIFIED && k.toLowerCase() !== 'type') text = setNoteProp(text, k, v);
  return text;
}

// ── Changing the types (Settings › Note types, a page's Display) ──────────────────────────────────────────────────────

/** Every type's entry, in the order shown, so a change can be written without losing the order. */
function fullEntries(config: TypesConfig, ctx: TypeContext): TypeEntry[] {
  const byId = new Map(config.entries.map((e) => [e.id, e]));
  // A module's type the file doesn't list stays out of it while its module is off (it comes back in its place).
  return resolveTypes(config, ctx)
    .filter((t) => !t.module || byId.has(t.id) || ctx.modules?.some((m) => m.id === t.id && m.on))
    .map((t) => byId.get(t.id) ?? { id: t.id });
}

function withEntry(config: TypesConfig, ctx: TypeContext, id: string, change: (e: TypeEntry) => TypeEntry | null): TypesConfig {
  const entries = fullEntries(config, ctx)
    .map((e) => (e.id === id ? change({ ...e }) : e))
    .filter((e): e is TypeEntry => !!e);
  return { version: 1, entries };
}

/** A type renamed (its plural too); a built-in given back its own name when the name is its own again. */
export function renameType(config: TypesConfig, ctx: TypeContext, id: string, name: string, plural: string): TypesConfig {
  const b = ALL_BUILT_INS.find((x) => x.id === id);
  const n = str(name, 40);
  const p = str(plural, 40);
  if (!n) throw new Error('A type needs a name.');
  return withEntry(config, ctx, id, (e) => {
    if (b && n === b.name) delete e.name;
    else e.name = n;
    if (b && (p ?? b.plural) === b.plural) delete e.plural;
    else e.plural = p ?? `${n}s`;
    return e;
  });
}

/** A type hidden from the side, the picker and the pages (its notes keep their type), or shown again. Note can't hide. */
export function hideType(config: TypesConfig, ctx: TypeContext, id: string, hidden: boolean): TypesConfig {
  if (id === NOTE_TYPE) return config;
  return withEntry(config, ctx, id, (e) => {
    if (hidden) e.hidden = true;
    else delete e.hidden;
    return e;
  });
}

/** A type moved up (-1) or down (1). Note stays first. */
export function moveType(config: TypesConfig, ctx: TypeContext, id: string, by: number): TypesConfig {
  const entries = fullEntries(config, ctx);
  const at = entries.findIndex((e) => e.id === id);
  const to = at + by;
  if (at <= 0 || to <= 0 || to >= entries.length) return { version: 1, entries };
  const [moved] = entries.splice(at, 1);
  entries.splice(to, 0, moved);
  return { version: 1, entries };
}

/** What the person gives for a type of their own. */
export interface CustomTypeInput {
  name: string;
  plural?: string;
  icon?: TypeIcon;
  color?: TypeColor;
  hint?: string;
  fields?: TypeField[];
  template?: string;
  folder?: string;
  layout?: ViewLayout;
}

/** A type of the person's own, added at the end; its id from its name (made unique). Throws in plain words. */
export function addCustomType(config: TypesConfig, ctx: TypeContext, input: CustomTypeInput): { config: TypesConfig; id: string } {
  const name = str(input.name, 40);
  if (!name) throw new Error('A type needs a name.');
  const types = resolveTypes(config, ctx);
  if (types.some((t) => t.name.toLowerCase() === name.toLowerCase() || t.aliases.includes(name.toLowerCase()))) throw new Error(`There’s already a type called “${name}”.`);
  let id = typeId(name) || 'type';
  for (let i = 2; types.some((t) => t.id === id); i++) id = `${typeId(name) || 'type'}-${i}`;
  const entry = cleanEntry({ ...input, id, name, plural: str(input.plural, 40) ?? `${name}s`, folder: input.folder ?? str(input.plural, 40) ?? `${name}s` });
  if (!entry) throw new Error('That type can’t be made.');
  return { config: { version: 1, entries: [...fullEntries(config, ctx), entry] }, id };
}

/** A type of the person's own changed (a built-in only by renameType, hideType and setTypeDisplay). */
export function editCustomType(config: TypesConfig, ctx: TypeContext, id: string, input: CustomTypeInput): TypesConfig {
  if (BUILT_IN_IDS.includes(id)) throw new Error('A built-in type can be renamed or hidden, not changed.');
  return withEntry(config, ctx, id, (e) => {
    const next = cleanEntry({ ...e, ...input, id, custom: true });
    if (!next) throw new Error('A type needs a name.');
    if (e.display) next.display = e.display;
    if (e.hidden) next.hidden = true;
    return next;
  });
}

/** A type of the person's own taken away (its notes stay exactly as they are, and show as Notes). Built-ins can't go. */
export function deleteCustomType(config: TypesConfig, ctx: TypeContext, id: string): TypesConfig {
  if (BUILT_IN_IDS.includes(id)) throw new Error('A built-in type can be hidden, not deleted.');
  return withEntry(config, ctx, id, () => null);
}

/** How a type's page is laid out, remembered for that type (null puts it back as the type first showed it). */
export function setTypeDisplay(config: TypesConfig, ctx: TypeContext, id: string, def: ViewDef | null): TypesConfig {
  return withEntry(config, ctx, id, (e) => {
    if (def) e.display = displayOf(def);
    else delete e.display;
    return e;
  });
}

// ── Empty notes ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Whether a note has no words (5 Nov 2026, one rule: an empty new note leaves nothing behind when closed).
 *  Frontmatter and markdown marks don't count; one letter or number does. */
export function isEmptyNote(text: string): boolean {
  const body = String(text ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '');
  return !/[\p{L}\p{N}]/u.test(body);
}

// ── For the vault assistant ───────────────────────────────────────────────────────────────────────────────────────────

/** The types in a few lines for the assistant's instructions (src/main/agent.ts): each one's `type:`, folder and fields. */
export function typesForAssistant(types: readonly NoteType[]): string {
  const lines = types
    .filter((t) => !t.hidden && t.id !== NOTE_TYPE && t.id !== 'project' && t.id !== 'doc')
    .map((t) => `${t.name} (type: ${t.id}) in ${t.folder ? `${t.folder}/` : 'any folder'}${t.fields.length ? `; fields: ${t.fields.map((f) => `${f.key}${f.kind === 'links' || f.kind === 'list' ? ' (a list)' : f.kind === 'link' ? ' (a [[link]])' : f.kind === 'choice' && f.options?.length ? ` (${f.options.join(' / ')})` : ''}`).join(', ')}` : ''}`);
  return lines.join('\n');
}
