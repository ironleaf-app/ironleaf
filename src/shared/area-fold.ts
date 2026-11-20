// Folding one area into another (9 Nov 2026; the list: "Health and Publications fold into Me once the app allows").
// Health becomes Me/Health: its folder moves under Me's, its links are brought up to date, and its area leaves the
// list (its notes are Me's now). Pure: no files, no Node. The main side (src/main/area-fold.ts) runs it.

import { removeArea, type Area, type AreasConfig } from './areas';

const cleanDir = (d: string) => d.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
const lower = (s: string) => s.toLowerCase();

/** Where a folded folder lands: under the area's folder ("Health" into "Me" → "Me/Health"). */
export function foldDest(from: string, toFolder: string): string {
  const base = cleanDir(from).split('/').pop() ?? '';
  return `${cleanDir(toFolder)}/${base}`;
}

/** A fold checked before anything moves: the folders as written, and the area leaving the list (if it is one). */
export function validateAreaFold(input: { from: string; toArea: string; areas: readonly Area[]; folders: readonly string[]; files?: readonly string[] }): { from: string; to: string; area?: Area } {
  const from = cleanDir(input.from);
  if (!from || from.startsWith('.') || from.split('/').some((s) => s === '..')) throw new Error('That folder can’t be moved.');
  const toArea = input.areas.find((a) => a.id === input.toArea);
  if (!toArea) throw new Error('Pick the area it moves into.');
  const toFolder = cleanDir(toArea.folder);
  if (!toFolder || toFolder.includes('/')) throw new Error('That area’s folder can’t take it.');
  if (lower(from) === lower(toFolder) || lower(from).startsWith(`${lower(toFolder)}/`)) throw new Error('It is already in that area.');
  if (lower(toFolder) === lower(from) || lower(toFolder).startsWith(`${lower(from)}/`)) throw new Error('An area can’t move into itself.');
  const to = foldDest(from, toFolder);
  const have = new Set(input.folders.map((f) => lower(cleanDir(f))));
  if (!have.has(lower(from))) throw new Error('That folder is no longer there.');
  if (!have.has(lower(toFolder))) throw new Error(`${toArea.name}’s folder is no longer there.`);
  if (input.files?.some((f) => lower(cleanDir(f)) === lower(to) || lower(cleanDir(f)).startsWith(`${lower(to)}/`))) throw new Error(`${to} is already there. Move it away first, then fold.`);
  if (have.has(lower(to))) throw new Error(`${to} is already there. Move it away first, then fold.`);
  const area = input.areas.find((a) => lower(cleanDir(a.folder)) === lower(from));
  return { from, to, ...(area ? { area } : {}) };
}

/** The areas with the folded one off the list (its folder and everything in it stay, under the other area). */
export function areasAfterFold(config: AreasConfig, areaId: string | undefined): AreasConfig {
  return areaId ? removeArea(config, areaId) : config;
}

export interface FoldCounts {
  fromName: string;
  toName: string;
  to: string;
  notes: number;
  files: number;
  links: number;
  linkNotes: number;
}

export interface FoldPlan {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  areaId?: string;
  notes: number;
  files: number;
  links: number;
  linkNotes: number;
  words: string[];
}

export interface FoldState {
  undoable: boolean;
  last: { fromName: string; toName: string; at: string; notes: number } | null;
  backupExists: boolean;
}

/** The one plain preview before anything moves: how many notes move, and how many links will be updated. */
export function foldPreviewWords(c: FoldCounts): string[] {
  const what = c.notes === 1 ? '1 note' : `${c.notes} notes`;
  const links = c.links === 0 ? 'No links point into it, so no notes change.' : c.links === 1 ? `1 link in ${c.linkNotes === 1 ? '1 note' : `${c.linkNotes} notes`} will be updated.` : `${c.links} links in ${c.linkNotes === 1 ? '1 note' : `${c.linkNotes} notes`} will be updated.`;
  return [
    `${c.fromName} moves into ${c.toName} (${c.to}). ${what} move${c.files > c.notes ? `, with ${c.files - c.notes === 1 ? '1 file' : `${c.files - c.notes} files`} beside them` : ''}.`,
    links,
    'Before anything changes, a backup of the whole vault is saved as a zip on this PC.',
    'One Undo puts every file and every link back exactly.',
  ];
}

/**
 * Paths written in Ironleaf's own files and in notes' properties, brought up to date for one folder move: any
 * string (or object key) that is the folder, under it, or one of those with "#…" after it, or "prefix:" and one of
 * those ("project:Health/Plan.md"). Bare folder names count ("Health" → "Me/Health"), so folder-keyed stores
 * (sensitivity, views, layouts) follow like path values do. A bare name only counts as written: the level "health"
 * is not the folder "Health" (folding Health must not rewrite privacy markings or name keys that merely read the
 * same); anything under the folder still matches however it is cased, like paths do.
 */
export function followFoldIn(value: unknown, from: string, to: string): { value: unknown; changed: number } {
  const exact = cleanDir(from);
  const src = lower(exact);
  const dest = cleanDir(to);
  if (!src || !dest) return { value, changed: 0 };
  let changed = 0;
  const one = (s: string): string => {
    const m = /^([a-z][a-z-]{0,30}:)?(.*)$/is.exec(s)!;
    const prefix = m[1] && !/^[a-z]:$/i.test(m[1]) ? m[1] : '';
    const body = prefix ? m[2] : s;
    const hash = body.indexOf('#');
    const p = hash > 0 ? body.slice(0, hash) : body;
    const tail = hash > 0 ? body.slice(hash) : '';
    const c = cleanDir(p);
    if (c === exact || lower(c).startsWith(`${src}/`)) {
      changed++;
      return `${prefix}${dest}${c.slice(exact.length)}${tail}`;
    }
    return s;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.length < 1000 ? one(v) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k.length < 1000 ? one(k) : k] = walk(x);
      return out;
    }
    return v;
  };
  return { value: walk(value), changed };
}
