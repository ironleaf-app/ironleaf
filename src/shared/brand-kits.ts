// Which brand kit a note takes (the right brand on the right document): its project's kit, otherwise its area's,
// otherwise the default; an area set to no brand takes none, and the clean neutral document prints. Every door that
// prints or heads a copy — the branded document, the share header, the weekly update, the former host app bridge —
// reads through kitForNote, so the same note never takes two kits; every door names it through kitWords, so every
// message says the same thing. Pure: no files, no DOM.

import { areaOf, type Area, type AreaPlaces } from './areas';
import { isEmptyKit, kitId, type BrandKit, type NamedBrandKit } from './assets';
import { isProjectProps, projectOwnsFolder } from './project-file';

/** A note as the resolution reads it: its vault path and its properties. */
export interface KitNote {
  path: string;
  props?: Record<string, unknown>;
}

/** What the resolution reads besides the note: the vault's areas and its projects. */
export interface KitContext {
  areas: readonly Area[];
  projects: readonly { path: string; name: string }[];
  /** The templates folder and the asset store (the Library's, wherever they are). */
  places?: AreaPlaces;
}

/** The brand side of an index or a listing: all kitForNote reads (the window passes its listing through). */
export interface KitIndex {
  brand: BrandKit;
  brands?: NamedBrandKit[];
  brandDefault?: string;
  brandAreas?: Record<string, string | null>;
  brandProjects?: Record<string, string>;
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\/+/, '');
const samePath = (a: string, b: string) => norm(a).toLowerCase() === norm(b).toLowerCase();
const stemOf = (p: string) => (norm(p).split('/').pop() ?? '').replace(/\.md$/i, '');

/** Every kit the vault holds (an older file's single brand reads as its one kit). */
export function kitsOf(index: KitIndex): NamedBrandKit[] {
  if (index.brands?.length) return index.brands;
  return isEmptyKit(index.brand) ? [] : [{ ...index.brand, id: kitId(index.brand.name) }];
}

/** The kit covering what nothing else chooses: the default, else the first kit, else none. */
export function defaultKitOf(index: KitIndex): NamedBrandKit | null {
  const kits = kitsOf(index);
  return kits.find((k) => k.id === index.brandDefault) ?? kits[0] ?? null;
}

/** One kit by its id, else null. */
export function kitById(index: KitIndex, id: string): NamedBrandKit | null {
  return kitsOf(index).find((k) => k.id === id) ?? null;
}

/** A link or path as the project it names: the alias dropped, the name without folders or .md. */
function projectTarget(raw: unknown): string {
  const t = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim().replace(/^\[\[|\]\]$/g, '');
  return t.split('|')[0].split('#')[0].replace(/\\/g, '/').split('/').pop()!.replace(/\.md$/i, '').replace(/_/g, ' ').trim();
}

/** Every project a `project:` property names, in order (one name or a list of them). */
function projectTargets(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const item of list) {
    const t = String(item ?? '').trim().replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].replace(/\\/g, '/').split('/').pop()!.replace(/\.md$/i, '').replace(/_/g, ' ').trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

const projectNamed = (projects: readonly { path: string; name: string }[], target: string): string | null => {
  const hit = projects.find((p) => samePath(p.path, target) || samePath(p.path, `${target}.md`)) ?? projects.find((p) => stemOf(p.path).toLowerCase() === target.toLowerCase()) ?? projects.find((p) => p.name.toLowerCase() === target.toLowerCase());
  return hit ? norm(hit.path) : null;
};

/**
 * The projects a note belongs to (their project files' paths, as the vault lists them), in precedence order: the
 * note itself when it is a project, else the projects whose folders hold it (deepest first), then the ones its
 * `project:` property names, in order. A note in two projects names both, so the first with a kit wins.
 */
export function projectsForNote(note: KitNote, projects: readonly { path: string; name: string }[]): string[] {
  const path = norm(note.path);
  if (projects.some((p) => samePath(p.path, path)) || isProjectProps(note.props)) return [path];
  const out: string[] = [];
  const owned = projects
    .filter((p) => projectOwnsFolder(p.path) && path.toLowerCase().startsWith(`${norm(p.path).slice(0, norm(p.path).lastIndexOf('/')).toLowerCase()}/`))
    .sort((a, b) => b.path.length - a.path.length);
  for (const o of owned) out.push(norm(o.path));
  for (const t of projectTargets(note.props?.project ?? note.props?.projects)) {
    const hit = projectNamed(projects, t);
    if (hit && !out.some((o) => samePath(o, hit))) out.push(hit);
  }
  return out;
}

/**
 * The project a note belongs to (its project file's path, as the vault lists it): the note itself when it is a
 * project, else the project whose folder holds it (the deepest owned folder wins), else the one its `project:`
 * property names. Null when it belongs to none.
 */
export function projectForNote(note: KitNote, projects: readonly { path: string; name: string }[]): string | null {
  const path = norm(note.path);
  if (projects.some((p) => samePath(p.path, path)) || isProjectProps(note.props)) return path;
  const owned = projects
    .filter((p) => projectOwnsFolder(p.path) && path.toLowerCase().startsWith(`${norm(p.path).slice(0, norm(p.path).lastIndexOf('/')).toLowerCase()}/`))
    .sort((a, b) => b.path.length - a.path.length);
  if (owned[0]) return norm(owned[0].path);
  const target = projectTarget(note.props?.project ?? note.props?.projects);
  if (!target) return null;
  return projectNamed(projects, target);
}

/** Which areas and projects chose one kit (their ids and project paths, as the index keeps them). */
export function usesOfKit(index: KitIndex, id: string): { areas: string[]; projects: string[] } {
  return {
    areas: Object.entries(index.brandAreas ?? {}).filter(([, v]) => v === id).map(([a]) => a),
    projects: Object.entries(index.brandProjects ?? {}).filter(([, v]) => v === id).map(([p]) => p),
  };
}

/**
 * Which kit a note takes: its project's, otherwise its area's (null when the area takes no brand), otherwise the
 * default. A choice naming a kit that is gone is passed over, never fatal.
 */
export function kitForNote(index: KitIndex, note: KitNote, ctx: KitContext): NamedBrandKit | null {
  const kits = kitsOf(index);
  if (!kits.length) return null;
  // Each project the note belongs to, in precedence order: the first with a kit wins, so a note in two
  // projects never falls to its area while one of them chose a brand.
  for (const project of projectsForNote(note, ctx.projects)) {
    const entry = Object.entries(index.brandProjects ?? {}).find(([p]) => samePath(p, project));
    const kit = entry ? kits.find((k) => k.id === entry[1]) : undefined;
    if (kit) return kit;
  }
  const area = areaOf({ path: note.path, props: note.props }, ctx.areas, ctx.places)?.id;
  if (area && area in (index.brandAreas ?? {})) {
    const choice = (index.brandAreas ?? {})[area];
    if (choice === null) return null;
    const kit = kits.find((k) => k.id === choice);
    if (kit) return kit;
  }
  return kits.find((k) => k.id === index.brandDefault) ?? kits[0] ?? null;
}

/** The kit in the export's saved words: "in the Redline Co kit", or "with no brand". */
export function kitWords(kit: Pick<BrandKit, 'name'> | null | undefined): string {
  if (!kit) return 'with no brand';
  const name = kit.name?.trim();
  return name ? `in the ${name} kit` : 'in the brand kit';
}
