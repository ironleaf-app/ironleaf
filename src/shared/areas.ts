// Areas of life (Wave 4, 24 Oct 2026). 22 Oct, and the plan's target: every note, project, file and asset belongs to
// exactly one area — Work, Business, Home, Family, Health, Me, Publications, Library — and inside each the same five
// kinds: Projects, Notes, People, Files, Assets. "One rule: everything about a thing lives with that thing." An area is a
// folder at the top of the vault (its default home) and a name; a note can also say its area with an
// `area:` property, which wins over its folder (a daily note about the house: `area: Home`). Areas are the person's:
// renamed, added, put in order, hidden or kept quiet (Library is quiet: its templates, brand kits and references stay out
// of Today and search unless asked for). They live in the vault's own .neuralvault/areas.json, so every PC shows the same
// areas. With no areas file the vault isn't organised by area yet (the side bar offers the move, area-migration.ts).
// Pure: no files, no Node, no DOM. The window (state/areas.ts), the main side (src/main/life.ts) and the migration
// assistant share it.

import type { TodayData } from './today';
import { cleanFileName, inFolder as inDir } from './paths';
import { isProjectProps } from './project-file';

export const AREAS_FILE = '.neuralvault/areas.json';

export const AREA_ICONS = ['briefcase', 'chart', 'home', 'people', 'heart', 'person', 'book', 'bookmark', 'globe', 'star', 'flag', 'bolt', 'sun', 'bulb', 'layers', 'server', 'pin', 'calendar'] as const;
export type AreaIcon = (typeof AREA_ICONS)[number];
/** The muted colours (the note types' own: styles/types.css nt-<colour>). */
export const AREA_COLORS = ['stone', 'clay', 'slate', 'sky', 'ochre', 'sage', 'plum', 'rose', 'teal'] as const;
export type AreaColor = (typeof AREA_COLORS)[number];

export interface Area {
  id: string;
  name: string;
  /** Its folder at the top of the vault (its default home): usually its name. */
  folder: string;
  icon: AreaIcon;
  color: AreaColor;
  /** What it holds, in a few words (shown under its name; the migration assistant reads it as a hint). */
  about: string;
  /** Kept out of Today and search unless asked for (Library). */
  quiet?: boolean;
  /** Not shown in the side bar (its things stay where they are). */
  hidden?: boolean;
}

export interface AreasConfig {
  version: 1;
  areas: Area[];
  /** Where new things go when nothing else says (an area's id). */
  home?: string;
}

/** The five kinds inside every area. */
export const AREA_KINDS = ['projects', 'notes', 'people', 'files', 'assets'] as const;
export type AreaKind = (typeof AREA_KINDS)[number];
export const KIND_WORDS: Record<AreaKind, string> = { projects: 'Projects', notes: 'Notes', people: 'People', files: 'Files', assets: 'Assets' };
/** The folder each kind's new things go in, inside an area (the note types' own home folders). */
export const KIND_FOLDERS: Record<AreaKind, string> = { projects: 'Projects', notes: 'Notes', people: 'People', files: 'Files', assets: 'Assets' };

/** The usual areas, from the plan (22 Oct 2026). Every word of them is the person's to change. */
export const DEFAULT_AREAS: Area[] = [
  { id: 'work', name: 'Work', folder: 'Work', icon: 'briefcase', color: 'slate', about: 'Your job: projects, meetings, colleagues, sites and suppliers' },
  { id: 'business', name: 'Business', folder: 'Business', icon: 'chart', color: 'clay', about: 'A business of your own: product, marketing, customers and its money' },
  { id: 'home', name: 'Home', folder: 'Home', icon: 'home', color: 'ochre', about: 'The house, bills, cars, devices and the home lab' },
  { id: 'family', name: 'Family', folder: 'Family', icon: 'people', color: 'rose', about: 'Partner and kids: school, activities, events, photos and documents' },
  { id: 'health', name: 'Health', folder: 'Health', icon: 'heart', color: 'sage', about: 'Fitness, food, sleep, GP visits and results' },
  { id: 'me', name: 'Me', folder: 'Me', icon: 'person', color: 'sky', about: 'Your CV and career, learning, ID and personal finances' },
  { id: 'publications', name: 'Publications', folder: 'Publications', icon: 'book', color: 'plum', about: 'What you publish: newsletters, papers, editions and their pieces' },
  { id: 'library', name: 'Library', folder: 'Library', icon: 'bookmark', color: 'stone', about: 'Templates, brand kits, references and research', quiet: true },
];

/** Words that say an area in a tag or a property ("#work", "personal"): the area's name, and the usual words for it. */
const AREA_SAYS: Record<string, string[]> = {
  work: ['work', 'job', 'office'],
  business: ['business', 'startup', 'venture', 'company'],
  home: ['home', 'house', 'household'],
  family: ['family', 'kids', 'children'],
  health: ['health', 'fitness', 'wellbeing', 'medical'],
  me: ['me', 'personal', 'career', 'myself'],
  publications: ['publication', 'publications', 'newsletter', 'newspaper'],
  library: ['library', 'template', 'templates', 'reference', 'references'],
};

const cleanDir = (d: string) => d.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
const str = (v: unknown, max = 80): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : undefined);

/** An area's id from its name: lower case, words joined by a dash ("Home lab" → home-lab). */
export function areaId(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'area'
  );
}

/** A folder name Windows takes for an area (one level, no climbing out, nothing hidden). */
export function areaFolderName(name: string): string {
  return cleanFileName(name, 'Area', 60).replace(/^[. ]+/, '') || 'Area';
}

function cleanArea(raw: unknown, seen: Set<string>): Area | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name, 40);
  if (!name) return null;
  let id = str(r.id, 40)?.toLowerCase();
  if (!id || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) id = areaId(name);
  if (seen.has(id)) return null;
  const folder = areaFolderName(str(r.folder, 60) ?? name);
  const known = DEFAULT_AREAS.find((a) => a.id === id);
  const area: Area = {
    id,
    name,
    folder,
    icon: AREA_ICONS.includes(r.icon as AreaIcon) ? (r.icon as AreaIcon) : (known?.icon ?? 'layers'),
    color: AREA_COLORS.includes(r.color as AreaColor) ? (r.color as AreaColor) : (known?.color ?? 'teal'),
    about: str(r.about, 160) ?? known?.about ?? '',
  };
  if (r.quiet === true) area.quiet = true;
  if (r.hidden === true) area.hidden = true;
  return area;
}

/** The areas file as the person (or another app) left it: anything not understood is left out. Null: no areas yet. */
export function readAreas(text: string | null | undefined): { config: AreasConfig | null; problem: string | null } {
  if (text === null || text === undefined || !String(text).trim()) return { config: null, problem: null };
  let raw: unknown;
  try {
    raw = JSON.parse(String(text).replace(/^﻿/, ''));
  } catch {
    return { config: null, problem: 'Your areas file (.neuralvault/areas.json) couldn’t be read, so areas aren’t shown. Setting up areas again writes it afresh; your notes are where they were.' };
  }
  const list = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).areas : undefined;
  const areas: Area[] = [];
  const seen = new Set<string>();
  const folders = new Set<string>();
  if (Array.isArray(list)) {
    for (const item of list.slice(0, 40)) {
      const a = cleanArea(item, seen);
      if (!a || folders.has(a.folder.toLowerCase())) continue;
      seen.add(a.id);
      folders.add(a.folder.toLowerCase());
      areas.push(a);
    }
  }
  const home = str((raw as Record<string, unknown>)?.home, 40);
  return { config: { version: 1, areas, ...(home && seen.has(home) ? { home } : {}) }, problem: null };
}

/** The areas file's words, tab-indented. */
export function writeAreas(config: AreasConfig): string {
  const areas = config.areas.map((a) => {
    const out: Record<string, unknown> = { id: a.id, name: a.name, folder: a.folder, icon: a.icon, color: a.color, about: a.about };
    if (a.quiet) out.quiet = true;
    if (a.hidden) out.hidden = true;
    return out;
  });
  return `${JSON.stringify({ version: 1, ...(config.home ? { home: config.home } : {}), areas }, null, '\t')}\n`;
}

export const defaultConfig = (): AreasConfig => ({ version: 1, areas: DEFAULT_AREAS.map((a) => ({ ...a })), home: 'work' });

// ── Changing the areas ──────────────────────────────────────────────────────────────────────────────────────────────

function nameTaken(config: AreasConfig, name: string, except?: string): boolean {
  const n = name.trim().toLowerCase();
  return config.areas.some((a) => a.id !== except && (a.name.toLowerCase() === n || a.folder.toLowerCase() === areaFolderName(name).toLowerCase()));
}

/** A new area of the person's own (its folder is its name). Throws in plain words when the name is used already. */
export function addArea(config: AreasConfig, input: { name: string; icon?: AreaIcon; color?: AreaColor; about?: string; quiet?: boolean }): { config: AreasConfig; id: string } {
  const name = str(input.name, 40);
  if (!name) throw new Error('Give the area a name.');
  if (nameTaken(config, name)) throw new Error(`There is an area called ${name} already.`);
  let id = areaId(name);
  for (let n = 2; config.areas.some((a) => a.id === id); n++) id = `${areaId(name)}-${n}`;
  const area: Area = { id, name, folder: areaFolderName(name), icon: input.icon ?? 'layers', color: input.color ?? 'teal', about: str(input.about, 160) ?? '' };
  if (input.quiet) area.quiet = true;
  return { config: { ...config, areas: [...config.areas, area] }, id };
}

/** An area renamed. Its folder keeps its old name unless `folder` is given (the window moves the folder first). */
export function changeArea(config: AreasConfig, id: string, patch: Partial<Omit<Area, 'id'>>): AreasConfig {
  const at = config.areas.findIndex((a) => a.id === id);
  if (at < 0) return config;
  const was = config.areas[at];
  const name = patch.name !== undefined ? str(patch.name, 40) : was.name;
  if (!name) throw new Error('Give the area a name.');
  if (patch.name !== undefined && nameTaken(config, name, id)) throw new Error(`There is an area called ${name} already.`);
  const next: Area = {
    ...was,
    ...patch,
    name,
    folder: patch.folder !== undefined ? areaFolderName(patch.folder) : was.folder,
    about: patch.about !== undefined ? (str(patch.about, 160) ?? '') : was.about,
  };
  if (!next.quiet) delete next.quiet;
  if (!next.hidden) delete next.hidden;
  const areas = [...config.areas];
  areas[at] = next;
  return { ...config, areas };
}

export function moveArea(config: AreasConfig, id: string, by: number): AreasConfig {
  const from = config.areas.findIndex((a) => a.id === id);
  const to = Math.max(0, Math.min(config.areas.length - 1, from + by));
  if (from < 0 || from === to) return config;
  const areas = [...config.areas];
  areas.splice(to, 0, ...areas.splice(from, 1));
  return { ...config, areas };
}

/** An area taken off the list (its folder and everything in it stay where they are). */
export function removeArea(config: AreasConfig, id: string): AreasConfig {
  const areas = config.areas.filter((a) => a.id !== id);
  return { ...config, areas, ...(config.home === id ? { home: areas.find((a) => !a.quiet)?.id } : {}) };
}

// ── Which area a thing is in ───────────────────────────────────────────────────────────────────────────────────────

export interface AreaPlaces {
  /** The templates folder and the asset store: Library's (the quiet area's) wherever they are. */
  templatesFolder?: string;
  assetsFolder?: string;
}

/** The area an `area:` value names (its id, its name or a usual word for it), or undefined. */
export function areaNamed(value: unknown, areas: readonly Area[]): Area | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const v = raw.replace(/^\[\[|\]\]$/g, '').trim().toLowerCase();
  return areas.find((a) => a.id === v || a.name.toLowerCase() === v || a.folder.toLowerCase() === v) ?? areas.find((a) => AREA_SAYS[a.id]?.includes(v));
}

const topOf = (path: string) => (path.includes('/') ? path.slice(0, path.indexOf('/')) : '');
const inFolder = (path: string, folder: string | undefined) => inDir(path, folder ?? '');

/** The area whose folder a path is in (the first folder of the path), or undefined. */
export function areaOfFolder(path: string, areas: readonly Area[]): Area | undefined {
  const top = topOf(cleanDir(path)).toLowerCase();
  if (!top) return undefined;
  return areas.find((a) => a.folder.toLowerCase() === top);
}

/**
 * The area a note or file is in: its `area:` property, else its folder, else the quiet area when it is a template or in
 * the asset store; undefined when it is in none yet.
 */
export function areaOf(item: { path: string; props?: Record<string, unknown> }, areas: readonly Area[], places: AreaPlaces = {}): Area | undefined {
  const named = item.props?.area !== undefined ? areaNamed(item.props.area, areas) : undefined;
  if (named) return named;
  const byFolder = areaOfFolder(item.path, areas);
  if (byFolder) return byFolder;
  if (inFolder(item.path, places.templatesFolder) || inFolder(item.path, places.assetsFolder)) return areas.find((a) => a.quiet);
  return undefined;
}

/** Kept out of Today and search unless asked for: a template, or anything in a quiet area. */
export function isQuiet(item: { path: string; props?: Record<string, unknown> }, areas: readonly Area[], places: AreaPlaces = {}): boolean {
  if (inFolder(item.path, places.templatesFolder)) return true;
  return !!areaOf(item, areas, places)?.quiet;
}

const PICTURE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|ico|tiff?)$/i;
const MEDIA = /\.(mp4|mov|mkv|webm|m4v|mp3|wav|m4a|ogg|oga|opus|flac|aac|weba|m4b)$/i;
const FONT = /\.(ttf|otf|woff2?)$/i;
const ORG_TYPE = /^(org|organisation|organization|company|supplier|vendor|business|client|customer)$/i;

/** Whether a note is a person's or an organisation's card (typed so, or kept in People or Contacts). */
export function isPeopleNote(path: string, props: Record<string, unknown> | undefined): boolean {
  const type = typeof props?.type === 'string' ? props.type.trim().toLowerCase() : '';
  if (type === 'person' || type === 'people' || type === 'contact' || ORG_TYPE.test(type)) return true;
  if (type) return false;
  return /(^|\/)(people|contacts)\//i.test(path);
}

/**
 * Which of the five kinds a thing is: a project's file → Projects; a person's or organisation's card → People; any other
 * note, canvas or view → Notes; a picture, film, sound or font, or anything in an Assets folder → Assets; every other file
 * → Files. Notes and files inside a project's folder belong to that project (`inProject`): they are counted with it.
 */
export function kindOf(item: { path: string; props?: Record<string, unknown> }): AreaKind {
  const p = item.path;
  if (/\.md$/i.test(p)) {
    if (isProjectProps(item.props)) return 'projects';
    if (isPeopleNote(p, item.props)) return 'people';
    return 'notes';
  }
  if (/\.(canvas|base|view\.json|excalidraw)$/i.test(p)) return 'notes';
  if (/(^|\/)assets\//i.test(p) || PICTURE.test(p) || MEDIA.test(p) || FONT.test(p)) return 'assets';
  return 'files';
}

export type AreaCounts = Record<AreaKind, number> & { total: number };
const zero = (): AreaCounts => ({ projects: 0, notes: 0, people: 0, files: 0, assets: 0, total: 0 });

export interface AreaItem {
  path: string;
  props?: Record<string, unknown>;
  /** The project folder it is inside (its project file's folder), when it is one of a project's own notes or files. */
  project?: string;
}

/** The folders of the vault's projects (each project file's folder), deepest first, so a project's own notes and files
 *  can be told from the area's. */
export function projectFolders(notes: readonly { path: string; props?: Record<string, unknown> }[]): string[] {
  return notes
    .filter((n) => isProjectProps(n.props) && n.path.includes('/'))
    .map((n) => n.path.slice(0, n.path.lastIndexOf('/')))
    .sort((a, b) => b.length - a.length);
}

/** The project folder a path is inside (not the project file itself), or undefined. */
export function projectFolderOf(path: string, folders: readonly string[], isProjectFile = false): string | undefined {
  if (isProjectFile) return undefined;
  const lower = path.toLowerCase();
  return folders.find((f) => lower.startsWith(`${f.toLowerCase()}/`));
}

/** How many of each kind every area holds ('' for the things in no area yet). A project's own notes and files are
 *  counted with the project, not again. */
export function countAreas(items: readonly AreaItem[], areas: readonly Area[], places: AreaPlaces = {}): Map<string, AreaCounts> {
  const out = new Map<string, AreaCounts>([['', zero()], ...areas.map((a): [string, AreaCounts] => [a.id, zero()])]);
  for (const it of items) {
    if (it.project) continue;
    const a = areaOf(it, areas, places);
    const c = out.get(a?.id ?? '')!;
    c[kindOf(it)]++;
    c.total++;
  }
  return out;
}

/** The areas Today offers as chips, in the person's order: shown in the side bar and holding something (8 Nov 2026,
 *  calm Today: an area with no folder and nothing in it is no choice). Quiet is no bar: a quiet area with notes
 *  still chips, and choosing it shows its things as before. Counts from countChipAreas. */
export function todayChips(areas: readonly Area[], counts: Map<string, AreaCounts>): Area[] {
  return areas.filter((a) => !a.hidden && (counts.get(a.id)?.total ?? 0) > 0);
}

/** How many of each kind every area holds for Today's chips: countAreas, but the templates folder and the asset
 *  store never make an area chip (they are the app's scaffolding, landing in the quiet area by the fallback —
 *  never notes in an area). */
export function countChipAreas(items: readonly AreaItem[], areas: readonly Area[], places: AreaPlaces = {}): Map<string, AreaCounts> {
  return countAreas(
    items.filter((it) => !inDir(it.path, places.templatesFolder ?? '') && !inDir(it.path, places.assetsFolder ?? '')),
    areas,
    places,
  );
}

/** The things of one area (or of none: id ''), each with its kind, a project's own left out. */
export function itemsOf<T extends AreaItem>(items: readonly T[], areaIdOrNone: string, areas: readonly Area[], places: AreaPlaces = {}, kind?: AreaKind): T[] {
  return items.filter((it) => !it.project && (areaOf(it, areas, places)?.id ?? '') === areaIdOrNone && (!kind || kindOf(it) === kind));
}

/** The folder a new thing of a kind goes in, inside an area ("Work/People"); a note of a type: its type's home folder
 *  inside the area ("Work/Meetings"). */
export function homeIn(area: Pick<Area, 'folder'>, kindOrTypeFolder: AreaKind | string): string {
  const sub = (AREA_KINDS as readonly string[]).includes(kindOrTypeFolder) ? KIND_FOLDERS[kindOrTypeFolder as AreaKind] : cleanDir(kindOrTypeFolder) || 'Notes';
  return `${area.folder}/${sub}`;
}

/** The area new things go in when nothing else says: the one set as home, else the first that isn't quiet or hidden. */
export function homeArea(config: AreasConfig | null): Area | undefined {
  if (!config) return undefined;
  return config.areas.find((a) => a.id === config.home && !a.hidden) ?? config.areas.find((a) => !a.quiet && !a.hidden);
}

/** The words an area is known by in tags and properties (its name, its folder and the usual words): for the migration
 *  assistant's hints. */
export function areaWords(area: Area): string[] {
  return [...new Set([area.name.toLowerCase(), area.folder.toLowerCase(), area.id, ...(AREA_SAYS[area.id] ?? [])])];
}

// ── Today and search by area ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Today's lines for some areas only: each line kept when `keep` says its project or note is wanted (the quiet area and
 * the areas not chosen left out), and the counts made again from what is left. Today's meetings and anything due
 * today (overdue too) keep through `keepToday` instead: from a kept-out folder they still reach (8 Nov 2026,
 * item 2: a missed meeting or due task hurts more than any noise). The rest stays out.
 */
export function todayFor(data: TodayData, keep: (path: string) => boolean, keepToday: (path: string) => boolean = keep): TodayData {
  const due = { overdue: data.due.overdue.filter((x) => keepToday(x.project)), today: data.due.today.filter((x) => keepToday(x.project)), soon: data.due.soon.filter((x) => keep(x.project)), later: (data.due.later ?? []).filter((x) => keep(x.project)), passed: (data.due.passed ?? []).filter((x) => keep(x.project)), stale: (data.due.stale ?? []).filter((x) => keep(x.project)) };
  const atRisk = data.atRisk.filter((x) => keep(x.project));
  const waiting = data.waiting.filter((x) => keep(x.project));
  const unscheduled = (data.unscheduled ?? []).filter((x) => keep(x.project));
  const changed = data.changed.filter((x) => keep(x.project));
  const meetings = data.meetings.filter((m) => keepToday(m.path));
  const docs = data.docs.filter((d) => keep(d.path));
  const quiet = data.quiet?.filter((x) => keep(x.project));
  const automations = data.automations ? data.automations.filter((a) => !a.project || keep(a.project)) : null;
  const projects = new Set([...due.overdue, ...due.today, ...due.soon, ...atRisk, ...waiting, ...unscheduled, ...changed].map((x) => x.project));
  const counts = {
    ...data.counts,
    overdue: due.overdue.length,
    today: due.today.length,
    soon: due.soon.length,
    stale: due.stale.length,
    atRisk: atRisk.length,
    waiting: waiting.length,
    unscheduled: unscheduled.length,
    // Changed counts what buildToday counts (its lines and its changed files), never its groups.
    changed: changed.reduce((n, g) => n + g.lines.filter((l) => l.kind !== 'file').length + g.files, 0),
    meetings: meetings.length,
    automations: automations?.length ?? 0,
  };
  return {
    ...data,
    due,
    atRisk,
    waiting,
    unscheduled,
    changed,
    meetings,
    docs,
    ...(quiet ? { quiet } : {}),
    automations,
    projects: Math.min(data.projects, projects.size || data.projects),
    counts,
    // Clear reads as buildToday reads it: this week's work still to come doesn't unsettle it. Stale does
    // (5 Nov 2026, u3 moving-in): old work is still work — quiet, but never hidden behind All clear.
    clear: !due.overdue.length && !due.today.length && !due.stale.length && !atRisk.length && !waiting.length,
    nothingOnYou: !due.overdue.length && !due.today.length && !due.soon.length && !due.later.length && !due.stale.length && !waiting.length && !unscheduled.length,
  };
}

/** Whether a path is wanted with these areas chosen ('all': every area but the quiet ones; a list of ids, with '' for
 *  the things in no area). Quiet things only when `withQuiet`. */
export function wanted(item: { path: string; props?: Record<string, unknown> }, chosen: 'all' | readonly string[], areas: readonly Area[], places: AreaPlaces = {}, withQuiet = false): boolean {
  const a = areaOf(item, areas, places);
  const quiet = inFolder(item.path, places.templatesFolder) || !!a?.quiet;
  if (quiet && !withQuiet && !(chosen !== 'all' && a && chosen.includes(a.id))) return false;
  if (chosen === 'all') return true;
  return chosen.includes(a?.id ?? '');
}

/** Notes past a glance that Ironleaf hasn't organised yet: below a screenful, Home itself is already readable. */
export const MOVING_IN_MIN_NOTES = 10;

/** Whether Home says what was found instead of the organise-by-area nudge (5 Nov 2026, u3 moving-in): notes past a
 *  glance, nothing organised yet (no areas file, or an empty one), no projects, and the card not hidden. */
export function shouldShowMovingIn(noteCount: number, areas: AreasConfig | null, projectCount: number | null, seen: boolean | null): boolean {
  return noteCount >= MOVING_IN_MIN_NOTES && (areas === null || areas.areas.length === 0) && projectCount === 0 && seen === false;
}
