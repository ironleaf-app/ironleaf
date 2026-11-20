// The file list in sections (17 Oct 2026). Every note and file goes in exactly one place:
//  PROJECTS    each project with all its parts: the project file (its page), its notes (in its folder, or naming it in
//               a `project` property), Activity (the former host app's task notes), Reports, its canvas, and files kept
//               beside it
//   DOCS        how things are set up and run (src/shared/doc-file.ts): each doc, with its canvas and anything kept in
//               its own folder beside it (Docs/<Name>/)
//   NOTES       everything else the person wrote, by folder
//   DAILY       today's note first, then by month
//   CANVASES    canvases and boards that aren't a project's own
//   VIEWS       views over notes (src/shared/views.ts): tables, boards and calendars of notes by their properties
//   TEMPLATES   the templates folder
//   ASSETS      the asset store (counted by kind; the Assets page shows them)
//   ATTACHMENTS pasted and dropped files (hidden unless asked for)
//A pure function of the notes, the file list and a few settings, shared by the window and the tests; nothing here touches
// a file. The project's folder on the PC (its file store) is read live by the window, not here.

import { inferKind, ASSET_KINDS, type AssetKind } from './assets';
import { DOCS_FOLDER, docCanvasPath, isDocNote } from './doc-file';
import { isProjectProps } from './project-file';
import { isFinished } from './finished';
import { isMachineryPath, type MachineryCtx } from './fewer-folders';

export type SectionId = 'projects' | 'docs' | 'notes' | 'daily' | 'canvases' | 'views' | 'templates' | 'assets' | 'attachments';
export type PartId = 'overview' | 'notes' | 'activity' | 'reports' | 'canvas' | 'files' | 'automations';
export type NavKind = 'note' | 'canvas' | 'view' | 'image' | 'pdf' | 'audio' | 'video' | 'other';
export type NavSort = 'name' | 'name-desc' | 'modified' | 'modified-old';

export const SECTION_ORDER: SectionId[] = ['projects', 'docs', 'notes', 'daily', 'canvases', 'views', 'templates', 'assets', 'attachments'];
export const SECTION_WORDS: Record<SectionId, string> = {
  projects: 'Projects',
  docs: 'Docs',
  notes: 'Notes',
  daily: 'Daily',
  canvases: 'Canvases & boards',
  views: 'Views',
  templates: 'Templates',
  assets: 'Assets',
  attachments: 'Attachments',
};
/** Sections shut until the person opens them. */
export const SHUT_AT_FIRST: SectionId[] = ['templates', 'attachments'];

export interface NavNoteInput {
  path: string;
  title: string;
  /** The name a person sees (a project's file goes by its project's name). */
  label?: string;
  mtime: number;
  props?: Record<string, unknown>;
}

export interface NavFileInput {
  rel: string;
  mtime: number;
  kind: NavKind | string;
}

export interface NavConfig {
  templatesFolder: string;
  assetsFolder: string;
  /** A folder, '' for the top of the notes, or './name' for a folder beside each note. */
  attachmentsFolder: string;
  dailyFolder: string;
  /** Where docs are kept (a note directly in it is a doc unless it says it is something else); 'Docs' when not given. */
  docsFolder?: string;
  /** Today's daily note's name (its file name without .md, in the daily format). */
  todayName?: string;
  /** Pictures, PDFs and other files listed, not only notes and canvases. */
  showAllFiles: boolean;
  sort?: NavSort;
  /** Fewer folders on show (5 Nov 2026): what counts as machinery, and whether it shows in the Notes tree.
   *  When given with showMachinery false, machinery folders sit under Show everything (the tree holds only
   *  what is shown, hiddenNotes keeps the rest for search); true or absent shows everything, as before. */
  machinery?: MachineryCtx;
  showMachinery?: boolean;
}

export interface NavItem {
  path: string;
  /** The name shown: a note's title, a canvas's name, a file's name with its extension. */
  name: string;
  kind: NavKind;
  /** A file's extension (lower case), '' for notes and canvases. */
  ext: string;
  mtime: number;
  /** An activity note's status (done, failed…), when it has one. */
  status?: string;
}

export interface NavFolder {
  path: string;
  name: string;
  folders: NavFolder[];
  items: NavItem[];
  /** Everything inside it, however deep. */
  count: number;
}

export interface NavProject {
  /** The project file. */
  path: string;
  name: string;
  /** The project's own folder in the notes (Projects/<Name>), or null for a project file kept loose. */
  dir: string | null;
  health?: string;
  status?: string;
  progress?: number;
  done: boolean;
  /** Its folder on the PC (its file store), as the project file says. */
  pcFolder?: string;
  notes: NavItem[];
  activity: NavItem[];
  reports: NavItem[];
  canvases: NavItem[];
  /** Pictures, PDFs and other files kept beside it in the notes. */
  files: NavItem[];
}

export interface NavDoc {
  /** The doc's file. */
  path: string;
  name: string;
  /** Its one line on what it is. */
  about?: string;
  /** Its canvas, when it has one. */
  canvas: NavItem | null;
  /** Things kept in its own folder beside it (Docs/<Name>/…). */
  items: NavItem[];
  /** That folder. */
  dir: string;
  mtime: number;
}

export interface NavMonth {
  key: string;
  label: string;
  items: NavItem[];
}

export interface NavDaily {
  /** Today's note, when it's written. */
  today: NavItem | null;
  /** Where today's note goes (made when opened). */
  todayPath: string | null;
  months: NavMonth[];
  count: number;
}

export interface NavAssets {
  folder: string;
  total: number;
  kinds: { kind: AssetKind; label: string; count: number }[];
  items: NavItem[];
}

/** Where a note or file sits in the sections: its section and the rows above it. */
export interface NavPlace {
  section: SectionId;
  project?: string;
  part?: PartId;
  /** The doc it is, or belongs to. */
  doc?: string;
  /** Folders above it inside its section (or inside a project's part), outermost first. */
  folders?: string[];
  month?: string;
}

export interface NavSections {
  projects: NavProject[];
  docs: NavDoc[];
  notes: NavFolder;
  daily: NavDaily;
  canvases: NavItem[];
  /** Views over notes, wherever their files are kept. */
  views: NavItem[];
  templates: NavFolder;
  assets: NavAssets;
  attachments: NavFolder;
  counts: Record<SectionId, number>;
  place: Map<string, NavPlace>;
  /** Notes hidden from the Notes tree by fewer-folders (machinery under Show everything): search still finds them. */
  hiddenNotes?: NavItem[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.split('/').pop() ?? p;
const stem = (p: string) => baseOf(p).replace(/\.[^./]+$/, '');
const inside = (p: string, dir: string) => !!dir && p.startsWith(`${dir}/`);
const cleanDir = (d: string) => String(d ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
const lower = (s: string) => s.toLowerCase();

function kindOf(f: NavFileInput): NavKind {
  const k = f.kind;
  return k === 'note' || k === 'canvas' || k === 'view' || k === 'image' || k === 'pdf' || k === 'audio' || k === 'video' ? k : 'other';
}

function itemOf(path: string, kind: NavKind, mtime: number, title?: string): NavItem {
  const ext = kind === 'note' || kind === 'canvas' || kind === 'view' ? '' : (/\.([^./]+)$/.exec(path)?.[1] ?? '').toLowerCase();
  const name = kind === 'note' ? title || stem(path) : kind === 'canvas' ? stem(path) : kind === 'view' ? baseOf(path).replace(/\.(?:view\.json|base)$/i, '') : baseOf(path);
  return { path, name, kind, ext, mtime };
}

/** The names a `project` property may give for a project: its name, its file's name, its path. */
function projectKeys(p: { path: string; name: string }): string[] {
  const noExt = p.path.replace(/\.md$/i, '');
  return [...new Set([p.name, stem(p.path), p.path, noExt].map(lower))];
}

/** A `project` property's value as names ("[[Studio Upgrade|the upgrade]]" → "studio upgrade"). */
export function propertyProjects(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== 'string') continue;
    let s = v.trim();
    const wiki = /^\[\[([^\]]+)\]\]$/.exec(s);
    if (wiki) s = wiki[1];
    const md = /^\[[^\]]*\]\(([^)]+)\)$/.exec(s);
    if (md) s = decodeURI(md[1]);
    s = s.split('|')[0].split('#')[0].trim().replace(/^\.?\//, '');
    if (!s) continue;
    out.push(lower(s));
    if (/\.md$/i.test(s)) out.push(lower(s.replace(/\.md$/i, '')));
  }
  return out;
}

/** A daily note's date from its name (2026-10-16, 20261016), as YYYY-MM-DD, else from when it changed. */
export function dailyDate(name: string, mtime: number): string {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(name) ?? /(?:^|\D)(\d{4})(\d{2})(\d{2})(?:\D|$)/.exec(name);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(mtime || 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function compare(sort: NavSort) {
  return (a: { name: string; mtime: number }, b: { name: string; mtime: number }) => {
    switch (sort) {
      case 'name-desc':
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'modified':
        return b.mtime - a.mtime || a.name.localeCompare(b.name);
      case 'modified-old':
        return a.mtime - b.mtime || a.name.localeCompare(b.name);
      default:
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    }
  };
}

/** A folder holding a single note of its own name reads as that note (5 Nov 2026, fewer folders): the folder
 *  row goes, the note moves up to its parent, and its place reads the parent's folders. Empty folders and folders
 *  with two notes stay as they are. */
function collapseSameName(root: NavFolder, place: Map<string, NavPlace>, section: SectionId): void {
  const visit = (parent: NavFolder): void => {
    for (const sub of parent.folders) visit(sub);
    for (let i = parent.folders.length - 1; i >= 0; i--) {
      const f = parent.folders[i];
      if (f.folders.length || f.items.length !== 1) continue;
      if (stem(f.items[0].path).toLowerCase() !== f.name.toLowerCase()) continue;
      const [it] = f.items;
      parent.folders.splice(i, 1);
      parent.items.push(it);
      const had = place.get(it.path);
      if (had?.folders) {
        const next = had.folders.filter((d) => d !== f.path);
        place.set(it.path, next.length ? { section, folders: next } : { section });
      }
    }
  };
  visit(root);
}

/** A folder tree of items under `base` ('' for the top), empty folders given in `empty` included. */
function treeOf(base: string, entries: NavItem[], empty: string[], sort: NavSort, place: Map<string, NavPlace>, section: SectionId): NavFolder {
  const root: NavFolder = { path: base, name: baseOf(base), folders: [], items: [], count: 0 };
  const index = new Map<string, NavFolder>([[base, root]]);
  const ensure = (dir: string): NavFolder => {
    const found = index.get(dir);
    if (found) return found;
    const parent = ensure(dir.includes('/') && dir.lastIndexOf('/') >= base.length ? dir.slice(0, dir.lastIndexOf('/')) : base);
    const f: NavFolder = { path: dir, name: baseOf(dir), folders: [], items: [], count: 0 };
    parent.folders.push(f);
    index.set(dir, f);
    return f;
  };
  for (const d of empty) if (d !== base && (base === '' || inside(d, base))) ensure(d);
  for (const it of entries) {
    const dir = folderOf(it.path);
    ensure(dir).items.push(it);
    const folders: string[] = [];
    for (let d = dir; d && d !== base; d = folderOf(d)) folders.unshift(d);
    place.set(it.path, folders.length ? { section, folders } : { section });
  }
  collapseSameName(root, place, section);
  const cmp = compare(sort);
  const stamp = (f: NavFolder): { count: number; mtime: number } => {
    let count = f.items.length;
    let mtime = Math.max(0, ...f.items.map((i) => i.mtime));
    for (const sub of f.folders) {
      const s = stamp(sub);
      count += s.count;
      mtime = Math.max(mtime, s.mtime);
    }
    f.count = count;
    (f as NavFolder & { mtime?: number }).mtime = mtime;
    return { count, mtime };
  };
  stamp(root);
  const order = (f: NavFolder) => {
    f.folders.sort((a, b) => cmp({ name: a.name, mtime: (a as { mtime?: number }).mtime ?? 0 }, { name: b.name, mtime: (b as { mtime?: number }).mtime ?? 0 }));
    f.items.sort(cmp);
    f.folders.forEach(order);
  };
  order(root);
  return root;
}

const newestFirst = (a: NavItem, b: NavItem) => b.mtime - a.mtime || a.name.localeCompare(b.name);

/**
 * The notes and files in sections. Each note or file is in exactly one place, decided in this order: a project's own
 * file; a doc (and its canvas); the templates folder; a project's folder; a doc's own folder; the daily folder; a `project` property naming a project; the
 * attachments folder; the assets folder; else Notes (canvases: Canvases & boards).
 */
export function buildSections(notes: NavNoteInput[], files: NavFileInput[], folders: string[], config: NavConfig): NavSections {
  const sort = config.sort ?? 'name';
  const templates = cleanDir(config.templatesFolder);
  const assetsDir = cleanDir(config.assetsFolder);
  const daily = cleanDir(config.dailyFolder);
  const attach = String(config.attachmentsFolder ?? '').trim();
  const besideName = attach.startsWith('./') ? cleanDir(attach.slice(2)) : '';
  const attachDir = besideName ? '' : cleanDir(attach);
  const attachTop = !besideName && !attachDir;
  const place = new Map<string, NavPlace>();
  const metaOf = new Map(notes.map((n) => [n.path, n]));

  // Projects: every project file; one kept as Projects/<Name>/<Name>.md owns that folder.
  const projects: NavProject[] = [];
  for (const n of notes) {
    if (!n.props || !isProjectProps(n.props) || templates && inside(n.path, templates)) continue;
    const dir = folderOf(n.path);
    const owns = !!dir && lower(baseOf(dir)) === lower(stem(n.path));
    const status = typeof n.props.status === 'string' ? n.props.status : undefined;
    const progress = Number(n.props.progress);
    projects.push({
      path: n.path,
      name: n.label || n.title || stem(n.path),
      dir: owns ? dir : null,
      health: typeof n.props.health === 'string' ? n.props.health : undefined,
      status,
      progress: Number.isFinite(progress) ? progress : undefined,
      done: isFinished(status),
      pcFolder: typeof n.props.folder === 'string' && n.props.folder.trim() ? n.props.folder.trim() : undefined,
      notes: [],
      activity: [],
      reports: [],
      canvases: [],
      files: [],
    });
    place.set(n.path, { section: 'projects', project: n.path, part: 'overview' });
  }
  // The deepest folder wins (a project inside another's folder keeps its own things).
  const owners = projects.filter((p) => p.dir).sort((a, b) => b.dir!.length - a.dir!.length);
  const ownerOf = (path: string) => owners.find((p) => inside(path, p.dir!));
  const byKey = new Map<string, NavProject>();
  for (const p of projects) for (const k of projectKeys(p)) if (!byKey.has(k)) byKey.set(k, p);
  // A note naming one project belongs to it; one naming several (a weekly review, a portfolio update) is about all of
  // them, so it stays in Notes where it was put rather than going under whichever came first.
  const named = (props?: Record<string, unknown>): NavProject | undefined => {
    if (!props) return undefined;
    const found = new Set<NavProject>();
    for (const k of [...propertyProjects(props.project), ...propertyProjects(props.projects)]) {
      const p = byKey.get(k) ?? byKey.get(lower(baseOf(k)));
      if (p) found.add(p);
    }
    return found.size === 1 ? [...found][0] : undefined;
  };
  // Docs: notes whose type is doc, or that sit directly in the docs folder with no type of their own. A doc keeps its
  // canvas and the things in its own folder beside it.
  const docsFolder = cleanDir(config.docsFolder ?? DOCS_FOLDER);
  const docs: NavDoc[] = [];
  const presentFiles = new Set(files.map((f) => f.rel));
  for (const n of notes) {
    if (place.has(n.path) || (templates && inside(n.path, templates)) || !isDocNote(n.path, n.props, docsFolder)) continue;
    const dir = `${folderOf(n.path) ? `${folderOf(n.path)}/` : ''}${stem(n.path)}`;
    const named = typeof n.props?.canvas === 'string' ? n.props.canvas.replace(/^\[\[|\]\]$/g, '').trim() : '';
    const canvasPath = [named, docCanvasPath(n.path)].find((c) => c && presentFiles.has(c));
    const canvasFile = canvasPath ? files.find((f) => f.rel === canvasPath) : undefined;
    const about = typeof n.props?.about === 'string' && n.props.about.trim() ? n.props.about.trim() : undefined;
    docs.push({ path: n.path, name: n.label || n.title || stem(n.path), ...(about ? { about } : {}), canvas: canvasFile ? itemOf(canvasFile.rel, 'canvas', canvasFile.mtime) : null, items: [], dir, mtime: n.mtime });
    place.set(n.path, { section: 'docs', doc: n.path });
    if (canvasPath && !place.has(canvasPath)) place.set(canvasPath, { section: 'docs', doc: n.path, part: 'canvas' });
  }
  const docOwners = [...docs].sort((a, b) => b.dir.length - a.dir.length);
  const docOf = (path: string) => docOwners.find((d) => inside(path, d.dir));

  const isAttachment = (path: string, kind: NavKind) => {
    if (attachDir) return inside(path, attachDir);
    if (kind === 'note' || kind === 'canvas' || kind === 'view') return false;
    if (besideName) return path.split('/').slice(0, -1).includes(besideName);
    return attachTop && !path.includes('/');
  };

  const noteItems: NavItem[] = [];
  const templateItems: NavItem[] = [];
  const dailyItems: NavItem[] = [];
  const canvases: NavItem[] = [];
  const viewItems: NavItem[] = [];
  const attachmentItems: NavItem[] = [];
  const assetItems: NavItem[] = [];

  // Every file once (notes come with their details; a note missing from the list is still a note).
  const all: { path: string; kind: NavKind; mtime: number }[] = files.map((f) => ({ path: f.rel, kind: kindOf(f), mtime: f.mtime }));
  const listed = new Set(all.map((f) => f.path));
  for (const n of notes) if (!listed.has(n.path)) all.push({ path: n.path, kind: 'note', mtime: n.mtime });

  for (const f of all) {
    if (place.has(f.path)) continue; // a project's own file
    const meta = f.kind === 'note' ? metaOf.get(f.path) : undefined;
    const item = itemOf(f.path, f.kind, meta?.mtime ?? f.mtime, meta?.title);
    const plain = f.kind !== 'note' && f.kind !== 'canvas' && f.kind !== 'view';
    // A view is a way of looking across notes, not a part of any one folder's work: always under Views.
    if (f.kind === 'view') {
      viewItems.push(item);
      place.set(f.path, { section: 'views' });
      continue;
    }
    if (templates && inside(f.path, templates)) {
      if (plain && !config.showAllFiles) continue;
      templateItems.push(item);
      continue;
    }
    const owner = ownerOf(f.path);
    if (owner) {
      const sub = f.path.slice(owner.dir!.length + 1);
      const top = sub.includes('/') ? lower(sub.slice(0, sub.indexOf('/'))) : '';
      if (f.kind === 'canvas') {
        owner.canvases.push(item);
        place.set(f.path, { section: 'projects', project: owner.path, part: 'canvas' });
      } else if (plain) {
        owner.files.push(item);
        place.set(f.path, { section: 'projects', project: owner.path, part: 'files' });
      } else if (top === 'activity' || top === 'tasks') {
        const status = meta?.props?.status;
        owner.activity.push(typeof status === 'string' ? { ...item, status } : item);
        place.set(f.path, { section: 'projects', project: owner.path, part: 'activity' });
      } else if (top === 'reports') {
        owner.reports.push(item);
        place.set(f.path, { section: 'projects', project: owner.path, part: 'reports' });
      } else {
        owner.notes.push(item);
        place.set(f.path, { section: 'projects', project: owner.path, part: 'notes' });
      }
      continue;
    }
    const doc = docOf(f.path);
    if (doc) {
      if (plain && !config.showAllFiles) continue;
      doc.items.push(item);
      place.set(f.path, { section: 'docs', doc: doc.path, part: 'files' });
      continue;
    }
    if (daily && inside(f.path, daily) && f.kind === 'note') {
      dailyItems.push(item);
      continue;
    }
    if (f.kind === 'note') {
      const p = named(meta?.props);
      if (p) {
        p.notes.push(item);
        place.set(f.path, { section: 'projects', project: p.path, part: 'notes' });
        continue;
      }
    }
    if (isAttachment(f.path, f.kind)) {
      if (assetsDir && inside(f.path, assetsDir)) {
        // The assets folder kept inside the attachments folder: it's the asset store.
      } else {
        attachmentItems.push(item);
        continue;
      }
    }
    if (assetsDir && inside(f.path, assetsDir)) {
      if (f.kind === 'note' && baseOf(f.path) === 'assets.json') continue;
      assetItems.push(item);
      place.set(f.path, { section: 'assets' });
      continue;
    }
    if (f.kind === 'canvas') {
      canvases.push(item);
      place.set(f.path, { section: 'canvases' });
      continue;
    }
    if (plain && !config.showAllFiles) continue;
    noteItems.push(item);
  }

  // Projects: by name, done ones after; each part newest first (as the project page lists them).
  const cmpName = compare('name');
  projects.sort((a, b) => Number(a.done) - Number(b.done) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  for (const p of projects) {
    p.notes.sort(newestFirst);
    p.activity.sort(newestFirst);
    p.reports.sort(newestFirst);
    p.canvases.sort((a, b) => (a.path === p.path.replace(/\.md$/i, '.canvas') ? -1 : b.path === p.path.replace(/\.md$/i, '.canvas') ? 1 : newestFirst(a, b)));
    p.files.sort(newestFirst);
  }

  // Empty folders the person made show in Notes (never the system folders, never inside a project's folder).
  const system = [templates, daily, assetsDir, attachDir, ...docs.map((d) => d.dir)].filter(Boolean);
  const hasFiles = new Set<string>();
  for (const f of all) for (let d = folderOf(f.path); d; d = folderOf(d)) hasFiles.add(d);
  const isSystem = (d: string) => system.some((s) => d === s || inside(d, s)) || owners.some((p) => d === p.dir || inside(d, p.dir!)) || (!!docsFolder && d === docsFolder);
  // Fewer folders on show: machinery sits under Show everything in the Notes tree (counts count what is shown).
  // The hidden notes keep their place and stay in navEntries, so search still finds them and every page keeps working.
  const hideMachinery = !!config.machinery && config.showMachinery === false;
  const hiddenNotes: NavItem[] = [];
  let shownNotes = noteItems;
  let shownEmpty = folders.map(cleanDir).filter((d) => d && !hasFiles.has(d) && !isSystem(d) && !d.split('/').some((s) => s.startsWith('.')));
  if (hideMachinery) {
    const ctx = config.machinery!;
    shownNotes = [];
    for (const it of noteItems) (isMachineryPath(it.path, ctx) ? hiddenNotes : shownNotes).push(it);
    shownEmpty = shownEmpty.filter((d) => !isMachineryPath(d, ctx));
    for (const it of hiddenNotes) {
      const folders: string[] = [];
      for (let d = folderOf(it.path); d; d = folderOf(d)) folders.unshift(d);
      place.set(it.path, folders.length ? { section: 'notes', folders } : { section: 'notes' });
    }
  }
  const emptyFolders = shownEmpty;
  const notesTree = treeOf('', shownNotes, emptyFolders, sort, place, 'notes');
  const templateTree = treeOf(templates, templateItems, folders.map(cleanDir).filter((d) => templates && inside(d, templates) && !hasFiles.has(d)), sort, place, 'templates');
  const attachmentTree = treeOf(attachDir, attachmentItems, [], sort, place, 'attachments');

  // Daily: today first, then month by month, newest first.
  const todayPath = config.todayName ? `${daily ? `${daily}/` : ''}${config.todayName}.md` : null;
  let today: NavItem | null = null;
  const months = new Map<string, NavMonth>();
  const dated = dailyItems.map((it) => ({ it, date: dailyDate(stem(it.path), it.mtime) })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.it.mtime - a.it.mtime));
  for (const { it, date } of dated) {
    if (todayPath && it.path === todayPath) {
      today = it;
      place.set(it.path, { section: 'daily' });
      continue;
    }
    const key = date.slice(0, 7);
    if (!months.has(key)) months.set(key, { key, label: `${MONTHS[Number(key.slice(5, 7)) - 1] ?? ''} ${key.slice(0, 4)}`.trim(), items: [] });
    months.get(key)!.items.push(it);
    place.set(it.path, { section: 'daily', month: key });
  }

  // Assets: counted by kind (the Assets page shows them).
  const kinds = new Map<AssetKind, number>();
  for (const it of assetItems) kinds.set(inferKind(it.path), (kinds.get(inferKind(it.path)) ?? 0) + 1);
  assetItems.sort(newestFirst);
  canvases.sort((a, b) => cmpName(a, b));
  viewItems.sort((a, b) => cmpName(a, b));
  docs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  for (const d of docs) d.items.sort(newestFirst);

  const projectCount = projects.length;
  return {
    projects,
    docs,
    notes: notesTree,
    daily: { today, todayPath, months: [...months.values()], count: dailyItems.length },
    canvases,
    views: viewItems,
    templates: templateTree,
    assets: { folder: assetsDir, total: assetItems.length, kinds: ASSET_KINDS.map((k) => ({ kind: k.id, label: k.label, count: kinds.get(k.id) ?? 0 })).filter((k) => k.count), items: assetItems },
    attachments: attachmentTree,
    counts: { projects: projectCount, docs: docs.length, notes: notesTree.count, daily: dailyItems.length, canvases: canvases.length, views: viewItems.length, templates: templateTree.count, assets: assetItems.length, attachments: attachmentTree.count },
    place,
    ...(hiddenNotes.length ? { hiddenNotes } : {}),
  };
}

// ── Finding across every section ──────────────────────────────────────────────────────────────────────────────────────

export interface NavEntry {
  /** A note's or file's path, or a project's file. */
  path: string;
  name: string;
  kind: NavKind | 'project' | 'doc';
  section: SectionId;
  /** Where it is, in words ("Studio Upgrade · Activity", "Meetings"). */
  where: string;
  mtime: number;
  project?: string;
  health?: string;
}

const PART_WORDS: Record<PartId, string> = { overview: 'Overview', notes: 'Notes', activity: 'Activity', reports: 'Reports', canvas: 'Canvas', files: 'Files', automations: 'Automations' };
export const partWords = (part: PartId) => PART_WORDS[part];

/** Everything in the sections as one list, for the filter box. */
export function navEntries(s: NavSections, showAttachments = false): NavEntry[] {
  const out: NavEntry[] = [];
  for (const p of s.projects) {
    out.push({ path: p.path, name: p.name, kind: 'project', section: 'projects', where: p.done ? 'Finished' : p.status ? p.status.charAt(0).toUpperCase() + p.status.slice(1) : 'Project', mtime: 0, project: p.path, health: p.health });
    const add = (items: NavItem[], part: PartId) => {
      for (const it of items) out.push({ path: it.path, name: it.name, kind: it.kind, section: 'projects', where: `${p.name} · ${PART_WORDS[part]}`, mtime: it.mtime, project: p.path });
    };
    add(p.notes, 'notes');
    add(p.activity, 'activity');
    add(p.reports, 'reports');
    add(p.canvases, 'canvas');
    add(p.files, 'files');
  }
  for (const d of s.docs) {
    out.push({ path: d.path, name: d.name, kind: 'doc', section: 'docs', where: d.about ?? 'Doc', mtime: d.mtime });
    if (d.canvas) out.push({ path: d.canvas.path, name: d.canvas.name, kind: 'canvas', section: 'docs', where: `${d.name} · Canvas`, mtime: d.canvas.mtime });
    for (const it of d.items) out.push({ path: it.path, name: it.name, kind: it.kind, section: 'docs', where: d.name, mtime: it.mtime });
  }
  const walk = (f: NavFolder, section: SectionId) => {
    for (const it of f.items) out.push({ path: it.path, name: it.name, kind: it.kind, section, where: folderOf(it.path), mtime: it.mtime });
    for (const sub of f.folders) walk(sub, section);
  };
  walk(s.notes, 'notes');
  for (const it of s.hiddenNotes ?? []) out.push({ path: it.path, name: it.name, kind: it.kind, section: 'notes', where: folderOf(it.path), mtime: it.mtime });
  if (s.daily.today) out.push({ path: s.daily.today.path, name: s.daily.today.name, kind: 'note', section: 'daily', where: 'Today', mtime: s.daily.today.mtime });
  for (const m of s.daily.months) for (const it of m.items) out.push({ path: it.path, name: it.name, kind: 'note', section: 'daily', where: m.label, mtime: it.mtime });
  for (const it of s.canvases) out.push({ path: it.path, name: it.name, kind: 'canvas', section: 'canvases', where: folderOf(it.path), mtime: it.mtime });
  for (const it of s.views) out.push({ path: it.path, name: it.name, kind: 'view', section: 'views', where: folderOf(it.path), mtime: it.mtime });
  walk(s.templates, 'templates');
  for (const it of s.assets.items) out.push({ path: it.path, name: it.name, kind: it.kind, section: 'assets', where: folderOf(it.path), mtime: it.mtime });
  if (showAttachments) walk(s.attachments, 'attachments');
  return out;
}

/**
 * The entries with every word typed, best first (names that start with it, then names with it). A word may match where
 * something is ("till store" finds Till vendor call in Studio Upgrade), but at least one must be in its name, so typing a
 * project's name finds the project, not every note in it.
 */
export function findEntries(entries: NavEntry[], query: string, limit = 400): NavEntry[] {
  const words = lower(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: { e: NavEntry; score: number }[] = [];
  for (const e of entries) {
    const name = lower(e.name);
    const hay = `${name} ${lower(e.where)}`;
    if (!words.some((w) => name.includes(w)) || !words.every((w) => hay.includes(w))) continue;
    const first = words.find((w) => name.includes(w))!;
    const score = (name.startsWith(first) ? 0 : name.includes(` ${first}`) ? 1 : name.includes(first) ? 2 : 3) + (e.kind === 'project' || e.kind === 'doc' ? -1 : 0);
    scored.push({ e, score });
  }
  scored.sort((a, b) => a.score - b.score || b.e.mtime - a.e.mtime || a.e.name.localeCompare(b.e.name));
  return scored.slice(0, limit).map((x) => x.e);
}

// ── An order of the person's own (19 Oct 2026) ────────────────────────────────────────────────────────────────────────
// A list in the left side (the places, the sections, projects, docs, a folder's notes…) can be dragged into an order,
// kept per vault as the keys in that order. Anything not in it yet (a new project, a new note) follows, in its usual order.

/** `list` in the saved order; what the saved order doesn't name keeps its own order after those it does. */
export function inOrder<T>(list: T[], saved: string[] | undefined, key: (x: T) => string): T[] {
  if (!saved?.length) return list;
  const at = new Map(saved.map((k, i) => [k, i]));
  return list
    .map((x, i) => ({ x, i, o: at.get(key(x)) }))
    .sort((a, b) => (a.o === undefined ? (b.o === undefined ? a.i - b.i : 1) : b.o === undefined ? -1 : a.o - b.o))
    .map((v) => v.x);
}

/** The keys with `moving` put just before (or after) `target`; unchanged when either isn't there. */
export function moveKey(keys: string[], moving: string, target: string, after: boolean): string[] {
  if (moving === target || !keys.includes(moving) || !keys.includes(target)) return keys;
  const rest = keys.filter((k) => k !== moving);
  const i = rest.indexOf(target) + (after ? 1 : 0);
  return [...rest.slice(0, i), moving, ...rest.slice(i)];
}
