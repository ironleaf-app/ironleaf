// Fewer folders on show (5 Nov 2026). The Notes folder tree and the file views show machinery next to a
// person's work; the main view shows only their own areas and real folders, the rest under one quiet Show
// everything. Nothing moves on disk and no link breaks. Machinery is what the app itself manages, never a list
// of one person's folder names:
//   - with areas (src/shared/areas.ts): only the person's own areas show (not quiet, not hidden); every other
//     top folder sits under Show everything, except the Inbox, where new things wait to be filed
//     (src/shared/area-migration.ts keeps it at the top for the same reason) — a top folder of the person's own
//     outside the areas sits there too until it is filed into one (Nov 2026, b6 break job: said plainly now)
//   - without areas: only the folders the app owns hide — the configured store (templates, assets, attachments,
//     daily, docs: src/shared/navigator.ts config), the views (src/shared/views.ts VIEWS_FOLDER), the weekly
//     reviews (src/main/reviews.ts REVIEWS_FOLDER), the encrypted store (src/shared/private.ts PRIVATE_DIR),
//     and the structural dashboards (src/shared/graph-scope.ts STRUCTURAL_FOLDERS) — plus the packs' own
//     folders (src/shared/module-records.ts moduleFolder), passed in so this file stays small. A folder the
//     person made themself under one of those names hides with it: by name only, nothing is ever told apart
//   - inside an area, a pack's own subfolders (Me/Finance, Home/Systems and Home Lab) hide the same way; the
//     person's own folders never do
//   - the person's own kept-out folders (8 Nov 2026): any folder kept out of view hides with the machinery,
//   through this one rule, never a second
//     list. The folder never moves on disk.
// What always holds: nothing moves on disk, search finds hidden notes, one click shows them, and filing or
//making a note reaches every folder, hidden or not (tests/hidden-doors.test.mjs). Pure: no files, no Node, no
//DOM.

import { DOCS_FOLDER } from './doc-file';
import { INBOX_FOLDER } from './inbox';
import { PRIVATE_DIR } from './private';
import { VIEWS_FOLDER } from './views';
import type { Area } from './areas';

/** Where the weekly reviews go (mirrors src/main/reviews.ts REVIEWS_FOLDER; main owns the folder, shared needs its name to recognise it). */
export const REVIEWS_FOLDER = 'Reviews';
/** The structural dashboards (src/shared/graph-scope.ts never clusters them; they are the app's kinds, not a person's area). */
export const DASHBOARDS_FOLDER = 'Dashboards';

export interface MachineryCtx {
  templatesFolder?: string;
  assetsFolder?: string;
  attachmentsFolder?: string;
  dailyFolder?: string;
  docsFolder?: string;
  /** The vault's areas (id and folder, with quiet/hidden); null or empty for a vault not organised by area yet. */
  areas?: readonly Pick<Area, 'id' | 'folder' | 'quiet' | 'hidden'>[] | null;
  /** The packs' own folders in this vault (moduleFolder() values: "Finance" without areas, "Me/Finance" with). */
  moduleFolders?: readonly string[];
  /** Folders the person kept out of view (the folder menu; the vault's own settings): hidden like machinery. */
  quietFolders?: readonly string[];
}

/** Cleaned paths, kept (t102, 9 Nov 2026): the same paths clean thousands of times per list build. Pure. */
const cleans = new Map<string, string>();
const clean = (d: string | undefined): string => {
  const s = String(d ?? '');
  const had = cleans.get(s);
  if (had !== undefined) return had;
  const out = s.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
  if (cleans.size > 20000) cleans.clear();
  cleans.set(s, out);
  return out;
};
const lower = (s: string) => s.toLowerCase();
const topOf = (p: string) => {
  const c = clean(p);
  return c.includes('/') ? c.slice(0, c.indexOf('/')) : c;
};

/** A vault's hiding rules read once, so each path below is a few set lookups (t146, 9 Nov 2026: every Notes
 *  mount asked every note against every pack folder with fresh lowers each time — a quarter of the switch.
 *  The same answers the loops below always gave, read from sets built once per vault shape. Pure. */
interface PreparedCtx {
  storeTops: Set<string>;
  moduleTops: Set<string>;
  moduleSubs: string[];
  quiet: string[];
  quietTops: Set<string>;
  areasByFolder: Map<string, { quiet: boolean; hidden: boolean }>;
  hasAreas: boolean;
}
const FIXED_TOPS = new Set([VIEWS_FOLDER, REVIEWS_FOLDER, PRIVATE_DIR, DASHBOARDS_FOLDER].map((f) => f.toLowerCase()));
const prepared = new Map<string, PreparedCtx>();
// The same vault object asked again (a list build asks thousands of paths): answered by identity, never
// rebuilt nor re-keyed. A new object for the same vault shape shares the value-kept reading below.
const preparedByCtx = new WeakMap<MachineryCtx, PreparedCtx>();
function prepare(ctx: MachineryCtx): PreparedCtx {
  const same = preparedByCtx.get(ctx);
  if (same) return same;
  const areas = ctx.areas ?? [];
  const key = [ctx.templatesFolder ?? 'Templates', ctx.assetsFolder ?? 'Assets', ctx.attachmentsFolder ?? 'Attachments', ctx.dailyFolder ?? 'Daily', ctx.docsFolder ?? DOCS_FOLDER, areas.map((a) => `${a.folder}	${a.quiet ? 1 : 0}${a.hidden ? 1 : 0}`).join(','), (ctx.moduleFolders ?? []).join(','), (ctx.quietFolders ?? []).join(',')].join('	');
  const had = prepared.get(key);
  if (had) {
    preparedByCtx.set(ctx, had);
    return had;
  }
  // A store folder only ever matches a top folder by its whole single name (the './…' and 'a/b' branches
  // below always answer false); the set holds exactly the names that can match, lowered once.
  const storeTops = new Set<string>();
  for (const f of [ctx.templatesFolder ?? 'Templates', ctx.assetsFolder ?? 'Assets', ctx.attachmentsFolder ?? 'Attachments', ctx.dailyFolder ?? 'Daily', ctx.docsFolder ?? DOCS_FOLDER]) {
    const c = clean(f);
    if (c && !c.startsWith('./') && !c.includes('/')) storeTops.add(lower(c));
  }
  const moduleTops = new Set<string>();
  const moduleSubs: string[] = [];
  for (const m of ctx.moduleFolders ?? []) {
    const c = clean(m);
    if (!c) continue;
    if (c.includes('/')) moduleSubs.push(lower(c));
    else moduleTops.add(lower(c));
  }
  const inbox = lower(INBOX_FOLDER);
  const quiet = (ctx.quietFolders ?? []).map((q) => lower(clean(q))).filter((q) => q && q !== inbox);
  const quietTops = new Set((ctx.quietFolders ?? []).map((q) => lower(clean(q))).filter(Boolean));
  const areasByFolder = new Map<string, { quiet: boolean; hidden: boolean }>();
  for (const a of areas) {
    const f = lower(a.folder);
    if (!areasByFolder.has(f)) areasByFolder.set(f, { quiet: !!a.quiet, hidden: !!a.hidden });
  }
  const out: PreparedCtx = { storeTops, moduleTops, moduleSubs, quiet, quietTops, areasByFolder, hasAreas: areas.length > 0 };
  if (prepared.size > 4) prepared.clear();
  prepared.set(key, out);
  preparedByCtx.set(ctx, out);
  return out;
}

/** Whether a top folder is the person's Inbox (its folder, where new things wait — never hidden). */
const isInboxTop = (top: string) => lower(top) === lower(INBOX_FOLDER);

/** Whether a top folder is one of the configured store folders (templates, assets, attachments, daily, docs). */
function isStoreTop(top: string, p: PreparedCtx): boolean {
  // A './name' attachments folder lives beside each note, not at the top: prepare() keeps single names only.
  return p.storeTops.has(lower(top));
}

/** Whether a top folder is one of the app's own fixed folders (views, reviews, private store, dashboards). */
function isFixedTop(top: string): boolean {
  return FIXED_TOPS.has(lower(top));
}

/** Whether a top folder is a pack's own folder at the top (a vault without areas: "Finance", "Systems and Home Lab"). */
function isModuleTop(top: string, p: PreparedCtx): boolean {
  return p.moduleTops.has(lower(top));
}

/** Whether a cleaned top folder sits under Show everything (isMachineryTop's answer past the cleaning). */
function machineryTopWith(p: PreparedCtx, t: string): boolean {
  if (p.quietTops.has(lower(t))) return true;
  if (p.hasAreas) {
    const area = p.areasByFolder.get(lower(t));
    if (area) return area.quiet || area.hidden;
    if (isInboxTop(t)) return false;
    return true;
  }
  if (isInboxTop(t)) return false;
  return isStoreTop(t, p) || isFixedTop(t) || isModuleTop(t, p);
}

/** Whether a path is one the person kept out of view: the folder itself or anything inside it.
 *  The Inbox never reads quiet: new captures wait there (8 Nov 2026, item 1), so a stored
 *  Inbox entry is ignored however it is written. */
export function isQuietPath(path: string, ctx: MachineryCtx): boolean {
  const c = clean(path);
  if (!c) return false;
  const low = lower(c);
  for (const ql of prepare(ctx).quiet) {
    if (low === ql || low.startsWith(`${ql}/`)) return true;
  }
  return false;
}

/** Whether the folder itself is kept out (not merely inside one kept out: the menu tells them apart),
 *  however the folder is written. The Inbox never is (8 Nov 2026, item 1). */
export function isQuietFolder(list: readonly string[], folder: string): boolean {
  const low = lower(clean(folder));
  if (!low || low === lower(INBOX_FOLDER)) return false;
  return (list ?? []).some((q) => lower(clean(q)) === low);
}

/** The kept-out folders with one more: cleaned, kept once, and anything it already covers dropped. Keeping
 *  a folder one there already covers adds nothing: a child of a kept-out folder is already out of view.
 *  The Inbox adds nothing: it stays in view (8 Nov 2026, item 1). */
export function addQuietFolder(list: readonly string[], folder: string): string[] {
  const was = list.map(clean).filter(Boolean);
  const c = clean(folder);
  if (!c || lower(c) === lower(INBOX_FOLDER)) return was;
  const low = lower(c);
  if (was.some((f) => lower(f) === low || low.startsWith(`${lower(f)}/`))) return was;
  const out = was.filter((f) => {
    const fl = lower(f);
    return fl !== low && !fl.startsWith(`${low}/`);
  });
  out.push(c);
  return out;
}

/** The kept-out folders with one brought back into view. */
export function removeQuietFolder(list: readonly string[], folder: string): string[] {
  const low = lower(clean(folder));
  return list.map(clean).filter(Boolean).filter((f) => lower(f) !== low);
}

/** A single folder after its folder moved or was renamed: the new name when it is the folder or under it
 *  (a rename that only changes case follows too); otherwise as it was. The top ('') and a beside-the-note
 *  folder ('./…') never move (8 Nov 2026, item 5: single-folder settings follow a move like the lists). */
export function movedFolder(value: string, from: string, to: string): string {
  const v = String(value ?? '');
  if (!v || v.startsWith('./') || v === '.') return v;
  const c = clean(v);
  if (!c || c.startsWith('./')) return v;
  const src = lower(clean(from));
  const dest = clean(to);
  if (!src || !dest) return v;
  const cl = lower(c);
  if (cl === src) return dest;
  if (cl.startsWith(`${src}/`)) return dest + c.slice(src.length);
  return v;
}

/** A folder list after its folder moved or was renamed: entries the old name covers move to the new one
 *  (a rename that only changes case follows too); nothing under the old name leaves the list as it was. */
export function movedFolderList(list: readonly string[], from: string, to: string): string[] {
  const src = lower(clean(from));
  const dest = clean(to);
  if (!src || !dest) return [...list];
  let moved = false;
  const out = list.map(clean).filter(Boolean).map((f) => {
    const fl = lower(f);
    if (fl === src) {
      moved = true;
      return dest;
    }
    if (fl.startsWith(`${src}/`)) {
      moved = true;
      return dest + f.slice(src.length);
    }
    return f;
  });
  return moved ? [...new Set(out)] : [...list];
}

/**
 * Whether a top folder sits under Show everything. With areas: everything but the person's own areas
 * (and the Inbox) hides, a top folder of their own outside the areas included. Without: only what the
 * app manages hides (a folder the person made under one of those names hides with it, by name).
 * A top folder the person kept out hides either way: their choice wins, except the Inbox, which never
 * hides (8 Nov 2026, item 1).
 */
export function isMachineryTop(top: string, ctx: MachineryCtx): boolean {
  const t = clean(top);
  if (!t || t.includes('/')) return false;
  if (isInboxTop(t)) return false;
  return machineryTopWith(prepare(ctx), t);
}

/**
 * Whether a path sits under Show everything: its top folder does, or (inside an area) it is in one of the
 * packs' own subfolders. A pack's folder passed as "Me/Finance" hides everything under it. Anything the
 * person kept out of view hides with them, through this one check.
 */
export function isMachineryPath(path: string, ctx: MachineryCtx): boolean {
  const c = clean(path);
  if (!c) return false;
  // One prepared reading for the whole path (the top and quiet checks share it, never re-read it).
  const p = prepare(ctx);
  const low = lower(c);
  for (const ql of p.quiet) {
    if (low === ql || low.startsWith(`${ql}/`)) return true;
  }
  const top = topOf(c);
  // The top is already cleaned and slash-free; the Inbox still never hides, however it is listed.
  if (!isInboxTop(top) && machineryTopWith(p, top)) return true;
  for (const mc of p.moduleSubs) {
    if (low === mc || low.startsWith(`${mc}/`)) return true;
  }
  return false;
}

/** Top folders split into the person's own (shown) and machinery (under Show everything), in the order given. */
export function splitTopFolders(tops: readonly string[], ctx: MachineryCtx): { shown: string[]; hidden: string[] } {
  const shown: string[] = [];
  const hidden: string[] = [];
  for (const t of tops) (isMachineryTop(t, ctx) ? hidden : shown).push(t);
  return { shown, hidden };
}

/** How many files sit under Show everything: hidden files of the kinds the tree draws (notes, canvases and views —
 *  every file when the tree shows all files, as the folder tree's own row filter reads them). Folders are never
 *  counted: they are the structure the count's files appear under, as the Notes rail counts notes, never folders. */
export function hiddenFileCount(files: readonly { rel: string; kind: string }[], ctx: MachineryCtx, showAllFiles: boolean): number {
  let n = 0;
  for (const f of files ?? []) {
    if (!showAllFiles && f.kind !== 'note' && f.kind !== 'canvas' && f.kind !== 'view') continue;
    if (isMachineryPath(f.rel, ctx)) n++;
  }
  return n;
}
