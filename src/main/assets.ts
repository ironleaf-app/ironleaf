// The asset store on the main side (src/shared/assets.ts has the shapes; docs/ASSETS-STORE.md the file): the files in the
// library's Assets folder and where pasted files go, the index beside them (assets.json), files copied in from the PC
// with duplicates found by their content, thumbnails and colours kept in Ironleaf's own data (never the library),
// and where each asset is used. No Electron here, so the tests run it on a folder on disk.

import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants, createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import { cleanFileName as sharedCleanFileName } from '../shared/paths';
import {
  applyPatch,
  canvasFiles,
  cleanAssetPath,
  cleanBrand,
  cleanKitId,
  cleanLabel,
  emptyIndex,
  inferKind,
  isPicture,
  isSvg,
  kindInfo,
  kitId,
  matchDuplicates,
  parseIndex,
  removeFromIndex,
  renameInIndex,
  roleOf,
  sanitiseSvg,
  serializeIndex,
  SIDECAR_NAME,
  storeArea,
  usesOf,
  withBrand,
  type AssetDetails,
  type AssetEntry,
  type AssetIndex,
  type AssetKind,
  type AssetListing,
  type AssetPatch,
  type AssetUse,
  type BrandKit,
  type BrandSection,
  type NamedBrandKit,
} from '../shared/assets';

export interface AssetsHost {
  /** The open library's folder (null when none is open). */
  root(): string | null;
  /** Every file in the library (notes too), as the vault lists them. */
  listAll(): Promise<{ files: { rel: string; mtime: number; size: number }[] }>;
  /** A library path as a full path, refusing anything outside the library or reserved. */
  absolute(rel: string): string;
  /** The notes' links, as the index has them, and what a link names. */
  notes(): { path: string; title: string; links: { target: string }[]; props?: Record<string, unknown> }[];
  resolve(target: string, from: string): string | null;
  /** Settings › Files and links. */
  folders(): { assets: string; attachments: string };
  /** Each area of life's own Assets folder ("Family/Assets"), and whether files are kept beside their notes (Wave 4 part c). */
  areaAssets?(): { folders: string[]; withRecord: boolean };
  /** A path's area of life (its id) and sensitivity level (its id). */
  areaOf?(rel: string): string | undefined;
  level?(rel: string): string;
  /** Where an area's assets go ("Family/Assets"), by its id. */
  areaFolder?(id: string): string | undefined;
  /** Ironleaf's own data folder for thumbnails and content hashes. */
  cacheDir: string;
  /** Files were added: the index and the window brought up to date. */
  added(rels: string[]): Promise<void>;
  today(): string;
}

/** What the window sends back after drawing a picture: its thumbnail and what it found. */
export interface ThumbInfo {
  width?: number;
  height?: number;
  palette?: string[];
  failed?: boolean;
}

interface CacheEntry extends ThumbInfo {
  mtime: number;
  size: number;
  thumb?: string;
}

interface HashEntry {
  mtime: number;
  size: number;
  hash: string;
}

const MAX_COPY = 500 * 1024 * 1024;
const MAX_THUMB_SOURCE = 64 * 1024 * 1024;
const MAX_THUMB = 3 * 1024 * 1024;

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

/** The kits as the window keeps them: every kit, the default, and each area's and project's choice. */
function brandSection(index: AssetIndex): BrandSection {
  return { brand: index.brand, kits: index.brands, brandDefault: index.brandDefault, brandAreas: index.brandAreas, brandProjects: index.brandProjects };
}

export async function hashFile(abs: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(abs)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return hash.digest('hex');
}

async function writeAtomic(abs: string, data: string | Uint8Array): Promise<void> {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${randomBytes(6).toString('hex')}.nvtmp`;
  try {
    await fsp.writeFile(tmp, data);
    for (let attempt = 0; ; attempt++) {
      try {
        await fsp.rename(tmp, abs);
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt >= 8 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw err;
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
      }
    }
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

const cleanFileName = (raw: string, fallback: string) => sharedCleanFileName(raw.split(/[\\/]/).pop()!, fallback, 180);
const splitName = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot).toLowerCase() } : { base: name, ext: '' };
};

export class AssetStore {
  private indexCache: { root: string; rel: string; mtime: number; index: AssetIndex } | null = null;
  private writing: Promise<unknown> = Promise.resolve();
  private cache: { root: string; thumbs: Record<string, CacheEntry>; hashes: Record<string, HashEntry> } | null = null;
  private cacheTimer: NodeJS.Timeout | undefined;
  private canvases = new Map<string, { mtime: number; files: string[] }>();

  constructor(private host: AssetsHost) {}

  // --- Where things are ---------------------------------------------------------------------------------------------

  private folders(): { assets: string; attachments: string } {
    const f = this.host.folders();
    return { assets: f.assets.replace(/^\/+|\/+$/g, '') || 'Assets', attachments: f.attachments };
  }

  indexPath(): string {
    return `${this.folders().assets}/${SIDECAR_NAME}`;
  }

  private area(rel: string): 'store' | 'attachment' | null {
    const f = this.folders();
    const extra = this.host.areaAssets?.() ?? { folders: [], withRecord: false };
    return storeArea(rel, f.assets, f.attachments, extra.folders, extra.withRecord);
  }

  private requireRoot(): string {
    const root = this.host.root();
    if (!root) throw new Error('Ironleaf’s notes are not open yet.');
    return root;
  }

  /** A path the renderer sent, checked to be an asset (in the store or the attachments). */
  private assetRel(raw: unknown): string {
    if (typeof raw !== 'string') throw new Error('That isn’t an asset.');
    const rel = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || rel.split('/').some((s) => s === '..' || s === '.' || !s) || !this.area(rel)) throw new Error('That isn’t in your assets.');
    return rel;
  }

  // --- The index file -----------------------------------------------------------------------------------------------

  async readIndex(): Promise<AssetIndex> {
    const root = this.requireRoot();
    const rel = this.indexPath();
    let abs: string;
    try {
      abs = this.host.absolute(rel);
    } catch {
      return emptyIndex();
    }
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat) return emptyIndex();
    const c = this.indexCache;
    if (c && c.root === root && c.rel === rel && c.mtime === stat.mtimeMs) return c.index;
    const index = parseIndex(await fsp.readFile(abs, 'utf8').catch(() => ''));
    this.indexCache = { root, rel, mtime: stat.mtimeMs, index };
    return index;
  }

  /** Changes the index one at a time (never two writers at once), and writes it. */
  private change(fn: (index: AssetIndex) => AssetIndex): Promise<AssetIndex> {
    const run = this.writing.then(async () => {
      const root = this.requireRoot();
      const rel = this.indexPath();
      const before = await this.readIndex();
      const next = fn(before);
      if (next === before) return before;
      const abs = this.host.absolute(rel);
      await writeAtomic(abs, serializeIndex(next));
      const stat = await fsp.stat(abs);
      this.indexCache = { root, rel, mtime: stat.mtimeMs, index: next };
      return next;
    });
    this.writing = run.catch(() => {});
    return run;
  }

  // --- Thumbnails and hashes, in Ironleaf's own data -------------------------------------------------------------

  private cacheFolder(root: string): string {
    return path.join(this.host.cacheDir, sha1(path.resolve(root).toLowerCase()).slice(0, 16));
  }

  private async loadCache(): Promise<{ root: string; thumbs: Record<string, CacheEntry>; hashes: Record<string, HashEntry> }> {
    const root = this.requireRoot();
    if (this.cache?.root === root) return this.cache;
    let thumbs: Record<string, CacheEntry> = {};
    let hashes: Record<string, HashEntry> = {};
    try {
      const v = JSON.parse(await fsp.readFile(path.join(this.cacheFolder(root), 'cache.json'), 'utf8')) as { thumbs?: unknown; hashes?: unknown };
      if (v.thumbs && typeof v.thumbs === 'object') thumbs = v.thumbs as Record<string, CacheEntry>;
      if (v.hashes && typeof v.hashes === 'object') hashes = v.hashes as Record<string, HashEntry>;
    } catch {
      // Not made yet: thumbnails are made as pictures are shown.
    }
    this.cache = { root, thumbs, hashes };
    return this.cache;
  }

  private saveCacheSoon(): void {
    clearTimeout(this.cacheTimer);
    this.cacheTimer = setTimeout(() => void this.flushCache(), 400);
  }

  async flushCache(): Promise<void> {
    clearTimeout(this.cacheTimer);
    const c = this.cache;
    if (!c) return;
    await writeAtomic(path.join(this.cacheFolder(c.root), 'cache.json'), JSON.stringify({ thumbs: c.thumbs, hashes: c.hashes })).catch(() => {});
  }

  /** A file's content hash (SHA-256), worked out once while the file stays the same. */
  private async hashOf(rel: string, mtime: number, size: number): Promise<string | undefined> {
    const c = await this.loadCache();
    const known = c.hashes[rel];
    if (known && known.mtime === mtime && known.size === size) return known.hash;
    try {
      const hash = await hashFile(this.host.absolute(rel));
      c.hashes[rel] = { mtime, size, hash };
      this.saveCacheSoon();
      return hash;
    } catch {
      return undefined;
    }
  }

  // --- The listing --------------------------------------------------------------------------------------------------

  private async canvasUses(files: { rel: string; mtime: number }[]): Promise<{ path: string; files: string[] }[]> {
    const out: { path: string; files: string[] }[] = [];
    const present = new Set<string>();
    for (const f of files) {
      if (!/\.canvas$/i.test(f.rel)) continue;
      present.add(f.rel);
      let known = this.canvases.get(f.rel);
      if (!known || known.mtime !== f.mtime) {
        const text = await fsp.readFile(this.host.absolute(f.rel), 'utf8').catch(() => '');
        known = { mtime: f.mtime, files: canvasFiles(text) };
        this.canvases.set(f.rel, known);
      }
      if (known.files.length) out.push({ path: f.rel, files: known.files });
    }
    for (const k of [...this.canvases.keys()]) if (!present.has(k)) this.canvases.delete(k);
    return out;
  }

  private entry(f: { rel: string; mtime: number; size: number }, index: AssetIndex, cache: Record<string, CacheEntry>, root: string, uses: number): AssetEntry {
    const name = f.rel.split('/').pop() ?? f.rel;
    const meta = index.assets[f.rel] ?? {};
    const inferred = inferKind(name);
    const t = cache[f.rel];
    const fresh = t && t.mtime === f.mtime && t.size === f.size;
    const role = roleOf(index, f.rel);
    return {
      path: f.rel,
      name,
      size: f.size,
      mtime: f.mtime,
      kind: meta.kind ?? inferred,
      inferred,
      attachment: this.area(f.rel) === 'attachment',
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.alt ? { alt: meta.alt } : {}),
      tags: meta.tags ?? [],
      collections: meta.collections ?? [],
      ...(meta.added ? { added: meta.added } : {}),
      ...(role ? { role } : {}),
      ...(fresh && t.thumb ? { thumb: path.join(this.cacheFolder(root), t.thumb) } : {}),
      ...(fresh && t.failed ? { noThumb: true } : {}),
      ...(fresh && t.width ? { width: t.width, height: t.height } : {}),
      ...(fresh && t.palette?.length ? { palette: t.palette } : {}),
      uses,
      ...this.lifeOf(f.rel, meta.kind ?? inferred),
    };
  }

  /** Its area of life and level; a Family-private photo is protected (asked for each use by an agent). */
  private lifeOf(rel: string, kind: AssetKind): { area?: string; level?: string; protected?: boolean } {
    const area = this.host.areaOf?.(rel);
    const level = this.host.level?.(rel);
    const picture = kind === 'image' || kind === 'logo' || kind === 'media' || /\.(png|jpe?g|gif|webp|heic|heif|avif|mp4|mov|m4v)$/i.test(rel);
    return { ...(area ? { area } : {}), ...(level ? { level } : {}), ...(level === 'family' && picture ? { protected: true } : {}) };
  }

  private async gather(): Promise<{ root: string; files: { rel: string; mtime: number; size: number }[]; all: { rel: string; mtime: number; size: number }[]; index: AssetIndex; uses: Map<string, AssetUse[]> }> {
    const root = this.requireRoot();
    const { files: all } = await this.host.listAll();
    const files = all.filter((f) => this.area(f.rel));
    const index = await this.readIndex();
    const set = new Set(files.map((f) => f.rel));
    const uses = usesOf(set, this.host.notes(), await this.canvasUses(all), (t, from) => this.host.resolve(t, from));
    return { root, files, all, index, uses };
  }

  async list(): Promise<AssetListing> {
    const { root, files, index, uses } = await this.gather();
    const cache = await this.loadCache();
    // One file, one card (sweep 3, 075: the same receipt showed twice): a file kept in the store and
    // pasted into a note is one asset; the store copy is the card, and the pasted copy still counts as a use.
    const byKey = new Map<string, (typeof files)[number]>();
    for (const f of files) {
      const key = `${(f.rel.split('/').pop() ?? f.rel).toLowerCase()}|${f.size}`;
      const had = byKey.get(key);
      if (!had || (this.area(had.rel) === 'attachment' && this.area(f.rel) !== 'attachment')) byKey.set(key, f);
    }
    const kept = files.filter((f) => byKey.get(`${(f.rel.split('/').pop() ?? f.rel).toLowerCase()}|${f.size}`) === f);
    const assets = kept.map((f) => this.entry(f, index, cache.thumbs, root, uses.get(f.rel)?.length ?? 0));
    const tagCounts = new Map<string, { tag: string; count: number }>();
    for (const a of assets) for (const t of a.tags) {
      const k = t.toLowerCase();
      const c = tagCounts.get(k) ?? { tag: t, count: 0 };
      c.count++;
      tagCounts.set(k, c);
    }
    const f = this.folders();
    return {
      folder: f.assets,
      attachments: f.attachments,
      index: this.indexPath(),
      assets,
      collections: index.collections,
      tags: [...tagCounts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
      ...brandSection(index),
    };
  }

  async details(raw: unknown): Promise<AssetDetails> {
    const rel = this.assetRel(raw);
    const { root, files, index, uses } = await this.gather();
    const f = files.find((x) => x.rel === rel);
    if (!f) throw new Error('That asset is no longer there.');
    const cache = await this.loadCache();
    const usedIn = uses.get(rel) ?? [];
    return { ...this.entry(f, index, cache.thumbs, root, usedIn.length), usedIn };
  }

  // --- Changes by the person ----------------------------------------------------------------------------------------

  async update(raw: unknown, patch: unknown): Promise<AssetDetails> {
    const rel = this.assetRel(raw);
    await fsp.access(this.host.absolute(rel));
    const p = (patch && typeof patch === 'object' ? patch : {}) as AssetPatch;
    const clean: AssetPatch = {};
    if ('kind' in p) clean.kind = p.kind ?? null;
    if ('description' in p) clean.description = typeof p.description === 'string' ? p.description : null;
    if ('alt' in p) clean.alt = typeof p.alt === 'string' ? p.alt : null;
    if (Array.isArray(p.tags)) clean.tags = p.tags.map((t) => cleanLabel(t)).filter((t): t is string => !!t);
    if (Array.isArray(p.collections)) clean.collections = p.collections.map((t) => cleanLabel(t)).filter((t): t is string => !!t);
    if ('role' in p) clean.role = p.role === 'primary' || p.role === 'onDark' || p.role === 'icon' ? p.role : null;
    await this.change((index) => applyPatch(index, rel, clean, inferKind(rel)));
    return this.details(rel);
  }

  /** The default brand kit (its name, colours, fonts, and logos that are in the store). */
  async setBrand(raw: unknown): Promise<BrandKit> {
    const index = await this.change((i) => withBrand(i, this.storeLogos(cleanBrand(raw))));
    return index.brand;
  }

  /**
   * The brand kits: one added, saved, removed, or made the default; an area given a kit or no brand; a project
   * given a kit or handed back to its area. Returns the kits as the window keeps them.
   */
  async brands(action: unknown): Promise<BrandSection & { kit?: NamedBrandKit }> {
    const a = (action && typeof action === 'object' ? action : {}) as { kind?: string; id?: unknown; name?: unknown; kit?: unknown; area?: unknown; project?: unknown };
    const id = typeof a.id === 'string' ? cleanKitId(a.id) : undefined;
    const kitIdNow = (i: AssetIndex, wanted: string | undefined) => {
      const kit = i.brands.find((k) => k.id === wanted);
      if (!kit) throw new Error('That kit is gone. Choose another.');
      return kit;
    };
    const index = await this.change((i) => {
      switch (a.kind) {
        case 'add': {
          const name = cleanLabel(a.name, 120);
          if (!name) throw new Error('Give the kit a name.');
          if (i.brands.some((k) => (k.name ?? '').toLowerCase() === name.toLowerCase())) throw new Error(`There is already a kit called ${name}.`);
          const kit: NamedBrandKit = { id: kitId(name, i.brands.map((k) => k.id)), name, logos: {}, colours: [], fonts: [] };
          const brands = [...i.brands, kit];
          const brandDefault = i.brandDefault || kit.id;
          return { ...i, brands, brandDefault, brand: cleanBrand(brands.find((k) => k.id === brandDefault) ?? kit) };
        }
        case 'save': {
          const kit = kitIdNow(i, id);
          const next: NamedBrandKit = { ...this.storeLogos(cleanBrand(a.kit)), id: kit.id };
          const brands = i.brands.map((k) => (k.id === kit.id ? next : k));
          return { ...i, brands, brand: kit.id === i.brandDefault ? cleanBrand(next) : i.brand };
        }
        case 'remove': {
          const kit = kitIdNow(i, id);
          const brands = i.brands.filter((k) => k.id !== kit.id);
          const brandDefault = kit.id === i.brandDefault ? (brands[0]?.id ?? '') : i.brandDefault;
          const brandAreas = Object.fromEntries(Object.entries(i.brandAreas).filter(([, v]) => v !== kit.id));
          const brandProjects = Object.fromEntries(Object.entries(i.brandProjects).filter(([, v]) => v !== kit.id));
          const held = brands.find((k) => k.id === brandDefault);
          return { ...i, brands, brandDefault, brandAreas, brandProjects, brand: held ? cleanBrand(held) : { logos: {}, colours: [], fonts: [] } };
        }
        case 'default': {
          const kit = kitIdNow(i, id);
          return { ...i, brandDefault: kit.id, brand: cleanBrand(kit) };
        }
        case 'area': {
          const area = typeof a.area === 'string' ? cleanKitId(a.area) : undefined;
          if (!area) throw new Error('That area is gone. Choose another.');
          const choice = a.kit === null ? null : kitIdNow(i, typeof a.kit === 'string' ? cleanKitId(a.kit) : undefined).id;
          return { ...i, brandAreas: { ...i.brandAreas, [area]: choice } };
        }
        case 'area-clear': {
          const area = typeof a.area === 'string' ? cleanKitId(a.area) : undefined;
          if (!area) throw new Error('That area is gone. Choose another.');
          const brandAreas = { ...i.brandAreas };
          delete brandAreas[area];
          return { ...i, brandAreas };
        }
        case 'project': {
          const project = typeof a.project === 'string' ? cleanAssetPath(a.project) : undefined;
          if (!project) throw new Error('That project is gone. Choose another.');
          const choice = kitIdNow(i, typeof a.kit === 'string' ? cleanKitId(a.kit) : undefined).id;
          return { ...i, brandProjects: { ...i.brandProjects, [project]: choice } };
        }
        case 'project-clear': {
          const project = typeof a.project === 'string' ? cleanAssetPath(a.project) : undefined;
          if (!project) throw new Error('That project is gone. Choose another.');
          const brandProjects = { ...i.brandProjects };
          delete brandProjects[project];
          return { ...i, brandProjects };
        }
        default:
          throw new Error('That change isn’t one the brand kits know.');
      }
    });
    const section = brandSection(index);
    const kit = id ? section.kits.find((k) => k.id === id) : a.kind === 'add' ? section.kits[section.kits.length - 1] : undefined;
    return kit ? { ...section, kit } : section;
  }

  /** A kit with only logos that are in the store kept (anything else is left out, never fatal). */
  private storeLogos(next: BrandKit): BrandKit {
    for (const [role, rel] of Object.entries(next.logos)) if (!this.area(rel as string)) delete next.logos[role as keyof BrandKit['logos']];
    return next;
  }

  /** Collections: one added, renamed (on every asset in it) or removed (the assets stay). */
  async collections(action: unknown): Promise<string[]> {
    const a = (action && typeof action === 'object' ? action : {}) as { kind?: string; name?: unknown; to?: unknown };
    const name = cleanLabel(a.name);
    if (!name) throw new Error('A collection needs a name.');
    const same = (x: string) => x.toLowerCase() === name.toLowerCase();
    const index = await this.change((i) => {
      if (a.kind === 'add') return i.collections.some(same) ? i : { ...i, collections: [...i.collections, name] };
      const to = a.kind === 'rename' ? cleanLabel(a.to) : undefined;
      if (a.kind === 'rename' && !to) throw new Error('Give the collection its new name.');
      if (a.kind !== 'rename' && a.kind !== 'remove') throw new Error('That isn’t something Ironleaf does with collections.');
      const swap = (list: string[]) => {
        const out: string[] = [];
        for (const c of list) {
          const v = same(c) ? to : c;
          if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
        }
        return out;
      };
      const assets = Object.fromEntries(Object.entries(i.assets).map(([k, m]) => [k, m.collections ? { ...m, collections: swap(m.collections) } : m]));
      return { ...i, assets, collections: swap(i.collections) };
    });
    return index.collections;
  }

  // --- Adding files from the PC -------------------------------------------------------------------------------------

  private async incoming(paths: unknown): Promise<{ source: string; name: string; size: number }[]> {
    if (!Array.isArray(paths)) throw new Error('Nothing to add.');
    const out: { source: string; name: string; size: number }[] = [];
    for (const raw of paths.slice(0, 500)) {
      if (typeof raw !== 'string' || !path.isAbsolute(raw)) continue;
      const stat = await fsp.stat(raw).catch(() => null);
      if (!stat?.isFile() || stat.size > MAX_COPY) continue;
      out.push({ source: raw, name: cleanFileName(path.basename(raw), 'File'), size: stat.size });
    }
    return out;
  }

  /** Before copying: each file, its kind, and the asset already holding the same content (by its hash), if any. */
  async check(paths: unknown): Promise<{ source: string; name: string; size: number; kind: AssetKind; duplicateOf?: string }[]> {
    const files = await this.incoming(paths);
    const { all } = await this.gather();
    const store = all.filter((f) => this.area(f.rel));
    const sizes = new Set(files.map((f) => f.size));
    // Only files of the same size are hashed (a store of thousands stays quick).
    const candidates = await Promise.all(store.filter((s) => sizes.has(s.size)).map(async (s) => ({ path: s.rel, size: s.size, hash: await this.hashOf(s.rel, s.mtime, s.size) })));
    const withHash = await Promise.all(files.map(async (f) => ({ ...f, hash: candidates.some((c) => c.size === f.size) ? await hashFile(f.source).catch(() => '') : '' })));
    const dupes = matchDuplicates(withHash.filter((f) => f.hash), candidates);
    return files.map((f) => ({ source: f.source, name: f.name, size: f.size, kind: inferKind(f.name), ...(dupes.get(f.source) ? { duplicateOf: dupes.get(f.source) } : {}) }));
  }

  /**
   * Copies files from the PC into the Assets folder (a folder per kind), never over a file that is there. A file whose
   * content is already in the store uses the one there when `duplicates` is 'existing'.
   */
  async add(paths: unknown, options: unknown): Promise<{ added: string[]; reused: string[] }> {
    const o = (options && typeof options === 'object' ? options : {}) as { duplicates?: string; collection?: unknown; kind?: unknown; area?: unknown };
    const checked = await this.check(paths);
    const collection = cleanLabel(o.collection);
    const chosenKind = typeof o.kind === 'string' && ['logo', 'image', 'icon', 'document', 'media', 'other'].includes(o.kind) ? (o.kind as AssetKind) : undefined;
    const added: string[] = [];
    const reused: string[] = [];
    // An area of life's asset library ("Family/Assets"), else the Assets folder.
    const folder = (typeof o.area === 'string' && o.area ? this.host.areaFolder?.(o.area) : undefined) ?? this.folders().assets;
    for (const f of checked) {
      if (f.duplicateOf && o.duplicates !== 'keep') {
        reused.push(f.duplicateOf);
        continue;
      }
      const kind = chosenKind ?? f.kind;
      const dir = `${folder}/${kindInfo(kind).folder}`;
      const { base, ext } = splitName(f.name);
      let rel = '';
      for (let i = 0; i < 10000 && !rel; i++) {
        const candidate = `${dir}/${i === 0 ? base : `${base} ${i}`}${ext}`;
        const exists = await fsp.access(this.host.absolute(candidate)).then(() => true, () => false);
        if (!exists) rel = candidate;
      }
      if (!rel) continue;
      const abs = this.host.absolute(rel);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.copyFile(f.source, abs, fsConstants.COPYFILE_EXCL);
      added.push(rel);
    }
    const today = this.host.today();
    if (added.length || (collection && reused.length)) {
      await this.change((index) => {
        let next = index;
        for (const rel of added) {
          const meta = { ...(next.assets[rel] ?? {}), added: today };
          next = { ...next, assets: { ...next.assets, [rel]: meta } };
          next = applyPatch(next, rel, { ...(chosenKind ? { kind: chosenKind } : {}), ...(collection ? { collections: [collection] } : {}) }, inferKind(rel));
        }
        if (collection) for (const rel of reused) {
          const have = next.assets[rel]?.collections ?? [];
          if (!have.some((c) => c.toLowerCase() === collection.toLowerCase())) next = applyPatch(next, rel, { collections: [...have, collection] }, inferKind(rel));
        }
        return next;
      });
    }
    if (added.length) await this.host.added(added);
    return { added, reused };
  }

  // --- Thumbnails ---------------------------------------------------------------------------------------------------

  /** A picture's bytes for the window to draw a thumbnail from (an SVG as its made-safe text). */
  async source(raw: unknown): Promise<{ svg: string } | { bytes: Uint8Array; type: string } | null> {
    const rel = this.assetRel(raw);
    if (!isPicture(rel)) return null;
    const abs = this.host.absolute(rel);
    const stat = await fsp.stat(abs);
    if (stat.size > MAX_THUMB_SOURCE) return null;
    if (isSvg(rel)) return { svg: sanitiseSvg(await fsp.readFile(abs, 'utf8')) };
    const ext = (/\.([a-z0-9]+)$/i.exec(rel)?.[1] ?? '').toLowerCase();
    const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'ico' ? 'image/x-icon' : `image/${ext}`;
    const buf = await fsp.readFile(abs);
    return { bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), type };
  }

  /** The window drew a picture: its thumbnail (WebP or PNG), size and colours are kept for next time. */
  async saveThumb(raw: unknown, data: unknown, info: unknown): Promise<string | null> {
    const rel = this.assetRel(raw);
    const root = this.requireRoot();
    const stat = await fsp.stat(this.host.absolute(rel));
    const i = (info && typeof info === 'object' ? info : {}) as ThumbInfo;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e6 ? Math.round(v) : undefined);
    const entry: CacheEntry = { mtime: stat.mtimeMs, size: stat.size };
    const width = n(i.width);
    const height = n(i.height);
    if (width && height) Object.assign(entry, { width, height });
    if (Array.isArray(i.palette)) entry.palette = i.palette.filter((h) => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h)).slice(0, 8);
    const c = await this.loadCache();
    if (data instanceof Uint8Array && data.byteLength > 0 && data.byteLength <= MAX_THUMB) {
      const webp = data.byteLength > 12 && String.fromCharCode(...data.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...data.subarray(8, 12)) === 'WEBP';
      const png = data.byteLength > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
      if (!webp && !png) throw new Error('That thumbnail isn’t a picture.');
      const file = `${sha1(rel)}.${webp ? 'webp' : 'png'}`;
      await writeAtomic(path.join(this.cacheFolder(root), file), data);
      entry.thumb = file;
    } else entry.failed = true;
    c.thumbs[rel] = entry;
    this.saveCacheSoon();
    return entry.thumb ? path.join(this.cacheFolder(root), entry.thumb) : null;
  }

  // --- Following moves and deletes made anywhere in Ironleaf -----------------------------------------------------

  /** Files moved or renamed (pairs of old and new paths): the index, thumbnails and hashes follow. */
  async renamed(pairs: [string, string][]): Promise<void> {
    if (!pairs.length || !this.host.root()) return;
    const index = await this.readIndex().catch(() => null);
    if (index && pairs.some(([from]) => index.assets[from] || from in index.brandProjects || index.brands.some((k) => Object.values(k.logos).includes(from)))) await this.change((i) => renameInIndex(i, pairs)).catch(() => {});
    const c = await this.loadCache().catch(() => null);
    if (!c) return;
    let changed = false;
    for (const [from, to] of pairs) {
      const t = c.thumbs[from];
      if (t) {
        delete c.thumbs[from];
        if (t.thumb) {
          const file = `${sha1(to)}${path.extname(t.thumb)}`;
          await fsp.rename(path.join(this.cacheFolder(c.root), t.thumb), path.join(this.cacheFolder(c.root), file)).catch(() => {});
          t.thumb = file;
        }
        c.thumbs[to] = t;
        changed = true;
      }
      const h = c.hashes[from];
      if (h) {
        delete c.hashes[from];
        c.hashes[to] = h;
        changed = true;
      }
    }
    if (changed) this.saveCacheSoon();
  }

  /** Files gone to Recently deleted: their entries, roles and thumbnails go. */
  async removed(paths: string[]): Promise<void> {
    if (!paths.length || !this.host.root()) return;
    const index = await this.readIndex().catch(() => null);
    if (index && paths.some((p) => index.assets[p] || p in index.brandProjects || index.brands.some((k) => Object.values(k.logos).includes(p)))) await this.change((i) => removeFromIndex(i, paths)).catch(() => {});
    const c = await this.loadCache().catch(() => null);
    if (!c) return;
    for (const p of paths) {
      const t = c.thumbs[p];
      if (t?.thumb) await fsp.rm(path.join(this.cacheFolder(c.root), t.thumb), { force: true }).catch(() => {});
      delete c.thumbs[p];
      delete c.hashes[p];
    }
    this.saveCacheSoon();
  }

  /** Another folder of notes opened: nothing kept from the last one but what is on disk. */
  reset(): void {
    void this.flushCache();
    this.cache = null;
    this.indexCache = null;
    this.canvases.clear();
  }
}
