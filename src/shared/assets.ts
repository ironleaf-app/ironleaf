// The asset store (17 Oct 2026): what kinds of asset there are, the small index kept beside them in the library (plain
// JSON, read by people and by other tools: docs/ASSETS-STORE.md), the brand kit in it, safe SVGs, a picture's colours,
// and where an asset is used. Shared by the main side, the window and the tests; nothing here touches a file.

import { isProjectProps, projectOwnsFolder } from './project-file';

export type AssetKind = 'logo' | 'image' | 'icon' | 'document' | 'media' | 'other';

export const ASSET_KINDS: { id: AssetKind; label: string; one: string; folder: string }[] = [
  { id: 'logo', label: 'Logos', one: 'Logo', folder: 'Logos' },
  { id: 'image', label: 'Images', one: 'Image', folder: 'Images' },
  { id: 'icon', label: 'Icons & SVGs', one: 'Icon or SVG', folder: 'Icons' },
  { id: 'document', label: 'Documents', one: 'Document', folder: 'Documents' },
  { id: 'media', label: 'Video & audio', one: 'Video or audio', folder: 'Video and audio' },
  { id: 'other', label: 'Other', one: 'Other file', folder: 'Other' },
];
const KIND_IDS = ASSET_KINDS.map((k) => k.id) as readonly string[];
export const kindInfo = (kind: AssetKind) => ASSET_KINDS.find((k) => k.id === kind) ?? ASSET_KINDS[ASSET_KINDS.length - 1];

/** A brand role: the logo used first, the one for dark backgrounds, the small square mark (app icon, favicon). */
export type BrandRole = 'primary' | 'onDark' | 'icon';
export const BRAND_ROLES: { id: BrandRole; label: string; hint: string }[] = [
  { id: 'primary', label: 'Primary logo', hint: 'Used first, on light backgrounds' },
  { id: 'onDark', label: 'Logo on dark', hint: 'For dark backgrounds and photos' },
  { id: 'icon', label: 'Icon', hint: 'The small square mark' },
];

const extOf = (name: string) => (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] ?? '').toLowerCase();
const baseOf = (name: string) => (name.split('/').pop() ?? name).replace(/\.[a-z0-9]{1,8}$/i, '');

export const IMAGE_EXT = /^(png|jpe?g|gif|webp|bmp|avif|tiff?|heic|heif)$/;
export const SVG_EXT = /^(svg|ico)$/;
const DOC_EXT = /^(pdf|docx?|docm|dotx|rtf|odt|pages|xlsx?|xlsm|xltx|csv|tsv|ods|numbers|pptx?|pptm|potx|ppsx|odp|key|txt)$/;
/** The one audio list (meeting recordings, the vault's file kinds, media): Opus (.opus, .weba) and audiobooks (.m4b) count. */
export const AUDIO_EXT = /^(mp3|wav|m4a|ogg|oga|opus|flac|aac|weba|m4b)$/;
const VIDEO_EXT = /^(mp4|mov|m4v|mkv|webm|ogv|avi|wmv)$/;
/** Names that say a picture is a logo. */
const LOGO_WORDS = /(^|[^a-z])(logo|logos|logotype|wordmark|brandmark|lockup|monogram)([^a-z]|$)/i;

/** What an asset is, by its name: overridable in the index. */
export function inferKind(name: string): AssetKind {
  const ext = extOf(name);
  const picture = IMAGE_EXT.test(ext) || SVG_EXT.test(ext);
  if (picture && LOGO_WORDS.test(baseOf(name))) return 'logo';
  if (SVG_EXT.test(ext)) return 'icon';
  if (IMAGE_EXT.test(ext)) return 'image';
  if (DOC_EXT.test(ext)) return 'document';
  if (VIDEO_EXT.test(ext) || AUDIO_EXT.test(ext)) return 'media';
  return 'other';
}

/** A picture the window can draw (and make a thumbnail of). */
export const isPicture = (name: string) => /^(png|jpe?g|gif|webp|bmp|avif|svg|ico)$/.test(extOf(name));
export const isSvg = (name: string) => extOf(name) === 'svg';

/** A document's family, for its designed tile: the colour and the short word on it. */
export function docType(name: string): { word: string; family: 'pdf' | 'word' | 'excel' | 'powerpoint' | 'text' | 'video' | 'audio' | 'file' } {
  const ext = extOf(name);
  if (ext === 'pdf') return { word: 'PDF', family: 'pdf' };
  if (/^(docx?|docm|dotx|rtf|odt|pages)$/.test(ext)) return { word: ext === 'pages' ? 'PAGES' : ext === 'odt' ? 'ODT' : ext === 'rtf' ? 'RTF' : 'DOC', family: 'word' };
  if (/^(xlsx?|xlsm|xltx|csv|tsv|ods|numbers)$/.test(ext)) return { word: ext === 'csv' || ext === 'tsv' ? ext.toUpperCase() : 'XLS', family: 'excel' };
  if (/^(pptx?|pptm|potx|ppsx|odp|key)$/.test(ext)) return { word: ext === 'key' ? 'KEY' : 'PPT', family: 'powerpoint' };
  if (ext === 'txt') return { word: 'TXT', family: 'text' };
  if (VIDEO_EXT.test(ext)) return { word: ext.toUpperCase(), family: 'video' };
  if (AUDIO_EXT.test(ext)) return { word: ext.toUpperCase(), family: 'audio' };
  return { word: (ext || 'FILE').toUpperCase().slice(0, 4), family: 'file' };
}

// ---------------------------------------------------------------------------------------------------------------------
// The index beside the assets: <Assets folder>/assets.json. Plain JSON people can read and other tools can use.

export const SIDECAR_NAME = 'assets.json';

export interface AssetMeta {
  /** The kind chosen by the person (else it is inferred from the name). */
  kind?: AssetKind;
  description?: string;
  /** Words that say what a picture shows, for people who can't see it (written into embeds). */
  alt?: string;
  tags?: string[];
  collections?: string[];
  /** When it was added to the store (YYYY-MM-DD). */
  added?: string;
}

export interface BrandColour {
  name: string;
  hex: string;
  /** What it is for: "Headings", "Buttons", "Backgrounds"… */
  use?: string;
}

export interface BrandFont {
  name: string;
  use?: string;
}

export interface BrandKit {
  /** The business's name as it is written. */
  name?: string;
  /** Library paths of the logos, by role. */
  logos: Partial<Record<BrandRole, string>>;
  colours: BrandColour[];
  fonts: BrandFont[];
  /** A line at the foot of branded documents (5 Nov 2026, brand documents: "Confidential, internal use" only when the
   *  person has said so or the kit's footer says so) — e.g. "Confidential, internal use". */
  footer?: string;
}

/** A brand kit with its own id: a vault may hold several (one per area and project, with a clear default), each
 *  named by the person and kept by its id, so renaming never loses where it is used. */
export interface NamedBrandKit extends BrandKit {
  id: string;
}

export interface AssetIndex {
  version: 1;
  /** Library path → what the person wrote about it. */
  assets: Record<string, AssetMeta>;
  /** Every collection, in the person's order (an empty one is kept). */
  collections: string[];
  /** The default kit's content: what older readers (and other tools) see. */
  brand: BrandKit;
  /** Every kit, in the person's order (one, migrated from `brand`, for an older file). */
  brands: NamedBrandKit[];
  /** The default kit's id ('' when no kits). */
  brandDefault: string;
  /** An area's kit by its id, or null for no brand (an area missing here takes the default). */
  brandAreas: Record<string, string | null>;
  /** A project's kit by its project file's library path (a project missing here takes its area's). */
  brandProjects: Record<string, string>;
}

export const emptyIndex = (): AssetIndex => ({ version: 1, assets: {}, collections: [], brand: { logos: {}, colours: [], fonts: [] }, brands: [], brandDefault: '', brandAreas: {}, brandProjects: {} });

/** Whether a kit holds nothing yet: no name, logos, colours, fonts or footer. */
export function isEmptyKit(kit: BrandKit | null | undefined): boolean {
  if (!kit) return true;
  return !kit.name?.trim() && !Object.values(kit.logos ?? {}).some(Boolean) && !(kit.colours ?? []).length && !(kit.fonts ?? []).length && !kit.footer?.trim();
}

/** A kit's id from its name: lower case, words joined by a dash ("Redline Co" → redline-co). */
export function kitId(name: string | undefined, taken: readonly string[] = []): string {
  const slug = (name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'kit';
  if (!taken.includes(slug)) return slug;
  for (let n = 2; n < 1000; n++) if (!taken.includes(`${slug}-${n}`)) return `${slug}-${n}`;
  return `${slug}-${Date.now().toString(36)}`;
}

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  return t ? t.slice(0, max) : undefined;
};
/** A tag or collection name: trimmed, no # in front, one space between words. */
export const cleanLabel = (v: unknown, max = 60): string | undefined => text(typeof v === 'string' ? v.replace(/^#+/, '').replace(/\s+/g, ' ') : v, max);
const labels = (v: unknown, max = 40): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v.slice(0, max)) {
    const l = cleanLabel(item);
    if (l && !out.some((o) => o.toLowerCase() === l.toLowerCase())) out.push(l);
  }
  return out;
};
/** A colour as #rrggbb (3-digit and missing # accepted), else undefined. */
export function cleanHex(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  let h = v.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/.test(h) ? `#${h}` : undefined;
}
/** A library path as the index keeps it: forward slashes, nothing that climbs out. */
export function cleanAssetPath(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 600) return undefined;
  const p = v.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!p || p.split('/').some((s) => s === '..' || s === '.' || !s)) return undefined;
  return p;
}

export function cleanMeta(raw: unknown): AssetMeta {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: AssetMeta = {};
  if (typeof m.kind === 'string' && KIND_IDS.includes(m.kind)) out.kind = m.kind as AssetKind;
  const description = text(m.description, 2000);
  if (description) out.description = description;
  const alt = text(m.alt, 400);
  if (alt) out.alt = alt.replace(/[\r\n|\]]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const tags = labels(m.tags);
  if (tags.length) out.tags = tags;
  const collections = labels(m.collections, 20);
  if (collections.length) out.collections = collections;
  if (typeof m.added === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.added)) out.added = m.added;
  return out;
}

const emptyMeta = (m: AssetMeta) => !m.kind && !m.description && !m.alt && !m.tags?.length && !m.collections?.length && !m.added;

export function cleanBrand(raw: unknown): BrandKit {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const logos: Partial<Record<BrandRole, string>> = {};
  const rawLogos = (b.logos && typeof b.logos === 'object' ? b.logos : {}) as Record<string, unknown>;
  for (const role of BRAND_ROLES) {
    const p = cleanAssetPath(rawLogos[role.id]);
    if (p) logos[role.id] = p;
  }
  const colours: BrandColour[] = [];
  for (const c of Array.isArray(b.colours) ? b.colours.slice(0, 24) : []) {
    const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    const hex = cleanHex(o.hex);
    if (!hex) continue;
    const use = text(o.use, 80);
    colours.push({ name: text(o.name, 60) ?? hex.toUpperCase(), hex, ...(use ? { use } : {}) });
  }
  const fonts: BrandFont[] = [];
  for (const f of Array.isArray(b.fonts) ? b.fonts.slice(0, 12) : []) {
    const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
    const name = text(o.name, 80);
    if (!name) continue;
    const use = text(o.use, 80);
    fonts.push({ name, ...(use ? { use } : {}) });
  }
  const name = text(b.name, 120);
  const footer = text(b.footer, 120);
  return { ...(name ? { name } : {}), logos, colours, fonts, ...(footer ? { footer } : {}) };
}

/** A kit's id as the index keeps it: lower case, words joined by a dash. */
export function cleanKitId(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const id = v.trim().toLowerCase().slice(0, 40);
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(id) ? id : undefined;
}

export function cleanNamedBrand(raw: unknown): NamedBrandKit | null {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = cleanKitId(b.id);
  if (!id) return null;
  return { id, ...cleanBrand(raw) };
}

/** Area choices as read: an area's id to its kit's id, or null for no brand. Anything naming no kit is left out. */
function cleanBrandAreas(raw: unknown, ids: ReadonlySet<string>): Record<string, string | null> {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(o).slice(0, 100)) {
    const area = cleanLabel(key, 40)?.toLowerCase();
    if (!area || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(area)) continue;
    if (value === null) out[area] = null;
    else if (typeof value === 'string' && ids.has(value)) out[area] = value;
  }
  return out;
}

/** Project choices as read: a project file's library path to its kit's id. Anything naming no kit is left out. */
function cleanBrandProjects(raw: unknown, ids: ReadonlySet<string>): Record<string, string> {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(o).slice(0, 2000)) {
    const p = cleanAssetPath(key);
    if (!p || typeof value !== 'string' || !ids.has(value)) continue;
    out[p] = value;
  }
  return out;
}

/** The index as read from its file: anything unreadable or out of shape is left out, never fatal. */
export function parseIndex(raw: string | null | undefined): AssetIndex {
  if (!raw) return emptyIndex();
  let v: unknown;
  try {
    v = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    return emptyIndex();
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return emptyIndex();
  const o = v as Record<string, unknown>;
  const assets: Record<string, AssetMeta> = {};
  const rawAssets = (o.assets && typeof o.assets === 'object' && !Array.isArray(o.assets) ? o.assets : {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(rawAssets).slice(0, 100_000)) {
    const p = cleanAssetPath(key);
    if (!p) continue;
    const meta = cleanMeta(value);
    if (!emptyMeta(meta)) assets[p] = meta;
  }
  const collections = labels(o.collections, 200);
  for (const m of Object.values(assets)) for (const c of m.collections ?? []) if (!collections.some((x) => x.toLowerCase() === c.toLowerCase())) collections.push(c);
  // Several kits (brands with ids, a default, per-area and per-project choices); an older file's single `brand`
  // migrates to one kit and stays the default for what it already covers.
  const brands: NamedBrandKit[] = [];
  const seen = new Set<string>();
  for (const raw of (Array.isArray(o.brands) ? o.brands : []).slice(0, 60)) {
    const kit = cleanNamedBrand(raw);
    if (!kit || seen.has(kit.id)) continue;
    seen.add(kit.id);
    brands.push(kit);
  }
  const legacy = cleanBrand(o.brand);
  if (!brands.length && !isEmptyKit(legacy)) brands.push({ ...legacy, id: kitId(legacy.name) });
  const ids = new Set(brands.map((k) => k.id));
  const brandDefault = typeof o.brandDefault === 'string' && ids.has(o.brandDefault) ? o.brandDefault : (brands[0]?.id ?? '');
  const held = brands.find((k) => k.id === brandDefault) ?? brands[0];
  const brand = held ? cleanBrand(held) : legacy;
  return {
    version: 1,
    assets,
    collections,
    brand,
    brands,
    brandDefault,
    brandAreas: cleanBrandAreas(o.brandAreas, ids),
    brandProjects: cleanBrandProjects(o.brandProjects, ids),
  };
}

const ABOUT_ONE = 'Ironleaf’s asset index: what each file in the asset store is, its tags, collections and alt text, and the brand kit (logos, colours, fonts). The files themselves are ordinary files beside it. Safe to edit by hand; see Ironleaf’s docs/ASSETS-STORE.md.';
const ABOUT_MANY = 'Ironleaf’s asset index: what each file in the asset store is, its tags, collections and alt text, and the brand kits (each area and project may choose its own; brandDefault covers the rest, and an area set to null takes no brand). The files themselves are ordinary files beside it. Safe to edit by hand; see Ironleaf’s docs/ASSETS-STORE.md.';

/** The index as written to its file: stable order, empty entries left out, a line saying what the file is. */
export function serializeIndex(index: AssetIndex): string {
  const assets: Record<string, AssetMeta> = {};
  for (const key of Object.keys(index.assets).sort((a, b) => a.localeCompare(b))) {
    const m = cleanMeta(index.assets[key]);
    if (!emptyMeta(m)) assets[key] = m;
  }
  const collections = labels(index.collections, 200);
  const brands = (index.brands ?? []).map(cleanNamedBrand).filter((k): k is NamedBrandKit => !!k);
  const ids = new Set(brands.map((k) => k.id));
  const brandAreas = cleanBrandAreas(index.brandAreas ?? {}, ids);
  const brandProjects = cleanBrandProjects(index.brandProjects ?? {}, ids);
  // One kit and no choices: the file reads as it always has, so nothing changes for someone with one kit.
  if (brands.length <= 1 && !Object.keys(brandAreas).length && !Object.keys(brandProjects).length) {
    return `${JSON.stringify({ about: ABOUT_ONE, version: 1, brand: cleanBrand(index.brand), collections, assets }, null, 2)}\n`;
  }
  const brandDefault = index.brandDefault && ids.has(index.brandDefault) ? index.brandDefault : (brands[0]?.id ?? '');
  const out: Record<string, unknown> = { about: ABOUT_MANY, version: 1, brands, brandDefault };
  if (Object.keys(brandAreas).length) out.brandAreas = brandAreas;
  if (Object.keys(brandProjects).length) out.brandProjects = brandProjects;
  out.collections = collections;
  out.assets = assets;
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** The brand role an asset has in the default kit, if any. */
export function roleOf(index: AssetIndex, rel: string): BrandRole | undefined {
  return BRAND_ROLES.find((r) => index.brand.logos[r.id] === rel)?.id;
}

/** Gives an asset a brand role in the default kit (taking it from whichever asset had it), or none. */
export function setRole(index: AssetIndex, rel: string, role: BrandRole | null): AssetIndex {
  const logos = { ...index.brand.logos };
  for (const r of BRAND_ROLES) if (logos[r.id] === rel) delete logos[r.id];
  if (role) logos[role] = rel;
  return withBrand(index, { ...index.brand, logos });
}

/** An index with its default kit's content replaced (in `brand` and in its `brands` entry, kept as one). */
export function withBrand(index: AssetIndex, brand: BrandKit): AssetIndex {
  const clean = cleanBrand(brand);
  let brands = index.brands.map((k) => (k.id === index.brandDefault ? { ...clean, id: k.id } : k));
  let brandDefault = index.brandDefault;
  if (!brands.some((k) => k.id === brandDefault) && !isEmptyKit(clean)) {
    brandDefault = brandDefault || kitId(clean.name, brands.map((k) => k.id));
    brands = [...brands, { ...clean, id: brandDefault }];
  }
  return { ...index, brand: clean, brands, brandDefault };
}

/** Files moved or renamed: their entries, every kit's logos and every project's choice follow them. */
export function renameInIndex(index: AssetIndex, pairs: [string, string][]): AssetIndex {
  if (!pairs.length) return index;
  const moved = new Map(pairs);
  const follow = (p: string) => moved.get(p) ?? p;
  const assets: Record<string, AssetMeta> = {};
  for (const [key, meta] of Object.entries(index.assets)) assets[follow(key)] = meta;
  const relogo = (logos: Partial<Record<BrandRole, string>>) => Object.fromEntries(Object.entries(logos).map(([role, p]) => [role, follow(p as string)])) as Partial<Record<BrandRole, string>>;
  const brand = { ...index.brand, logos: relogo(index.brand.logos) };
  const brands = index.brands.map((k) => (k.id === index.brandDefault ? { ...brand, id: k.id } : { ...k, logos: relogo(k.logos) }));
  const brandProjects = Object.fromEntries(Object.entries(index.brandProjects).map(([p, id]) => [follow(p), id]));
  return { ...index, assets, brand, brands, brandProjects };
}

/** Files gone (to the Bin): their entries, the roles they held in every kit, and a gone project's choice go too. */
export function removeFromIndex(index: AssetIndex, paths: string[]): AssetIndex {
  if (!paths.length) return index;
  const gone = new Set(paths);
  const assets = Object.fromEntries(Object.entries(index.assets).filter(([k]) => !gone.has(k)));
  const unlogo = (logos: Partial<Record<BrandRole, string>>) => Object.fromEntries(Object.entries(logos).filter(([, p]) => !gone.has(p as string))) as Partial<Record<BrandRole, string>>;
  const brand = { ...index.brand, logos: unlogo(index.brand.logos) };
  const brands = index.brands.map((k) => (k.id === index.brandDefault ? { ...brand, id: k.id } : { ...k, logos: unlogo(k.logos) }));
  const brandProjects = Object.fromEntries(Object.entries(index.brandProjects).filter(([p]) => !gone.has(p)));
  return { ...index, assets, brand, brands, brandProjects };
}

// ---------------------------------------------------------------------------------------------------------------------
// What the window and the assistant are given about each asset.

export interface AssetEntry {
  /** Library path. */
  path: string;
  name: string;
  size: number;
  mtime: number;
  kind: AssetKind;
  /** The kind its name gives (the person may have chosen another). */
  inferred: AssetKind;
  /** Kept in the attachments folder (pasted or dropped into notes), not the Assets folder. */
  attachment: boolean;
  description?: string;
  alt?: string;
  tags: string[];
  collections: string[];
  added?: string;
  role?: BrandRole;
  /** A cached thumbnail (an absolute path in Ironleaf's own data, never in the library). */
  thumb?: string;
  /** The thumbnail could not be made (a picture the window can't read): drawn as its type. */
  noThumb?: boolean;
  width?: number;
  height?: number;
  /** The picture's main colours (#rrggbb), most used first. */
  palette?: string[];
  /** How many notes, canvases and projects use it. */
  uses: number;
  /** Its area of life's id (the vault organised by area), and its sensitivity level's id. */
  area?: string;
  level?: string;
  /** A Family-private photo: agents allowed Family-private ask the person each time they use it (src/shared/sensitivity.ts). */
  protected?: boolean;
}

/** The brand kits as the window keeps them: every kit, the default, and each area's and project's choice. */
export interface BrandSection {
  /** The default kit's content. */
  brand: BrandKit;
  /** Every kit, in the person's order. */
  kits: NamedBrandKit[];
  /** The default kit's id ('' when no kits). */
  brandDefault: string;
  /** An area's kit by its id, or null for no brand. */
  brandAreas: Record<string, string | null>;
  /** A project's kit by its project file's library path. */
  brandProjects: Record<string, string>;
}

/** A change to the brand kits: one added, saved, removed or made the default; an area's or project's choice set or cleared. */
export type BrandAction =
  | { kind: 'add'; name: string }
  | { kind: 'save'; id: string; kit: BrandKit }
  | { kind: 'remove'; id: string }
  | { kind: 'default'; id: string }
  | { kind: 'area'; area: string; kit: string | null }
  | { kind: 'area-clear'; area: string }
  | { kind: 'project'; project: string; kit: string }
  | { kind: 'project-clear'; project: string };

export interface AssetListing extends BrandSection {
  /** The Assets folder in the library. */
  folder: string;
  /** Where pasted and dropped files go (Settings › Files and links). */
  attachments: string;
  index: string;
  assets: AssetEntry[];
  collections: string[];
  tags: { tag: string; count: number }[];
}

export interface AssetUse {
  path: string;
  title: string;
  kind: 'note' | 'canvas' | 'project';
}

export interface AssetDetails extends AssetEntry {
  usedIn: AssetUse[];
}

export type AssetPatch = {
  kind?: AssetKind | null;
  description?: string | null;
  alt?: string | null;
  tags?: string[];
  collections?: string[];
  role?: BrandRole | null;
};

/** One asset's entry changed by the person (null clears a field; a kind equal to the inferred one is not kept). */
export function applyPatch(index: AssetIndex, rel: string, patch: AssetPatch, inferred: AssetKind): AssetIndex {
  const meta: AssetMeta = { ...(index.assets[rel] ?? {}) };
  if ('kind' in patch) {
    if (patch.kind && KIND_IDS.includes(patch.kind) && patch.kind !== inferred) meta.kind = patch.kind;
    else delete meta.kind;
  }
  if ('description' in patch) meta.description = patch.description ?? undefined;
  if ('alt' in patch) meta.alt = patch.alt ?? undefined;
  if (patch.tags) meta.tags = patch.tags;
  if (patch.collections) meta.collections = patch.collections;
  const clean = cleanMeta(meta);
  const assets = { ...index.assets };
  if (emptyMeta(clean)) delete assets[rel];
  else assets[rel] = clean;
  let next: AssetIndex = { ...index, assets };
  for (const c of clean.collections ?? []) if (!next.collections.some((x) => x.toLowerCase() === c.toLowerCase())) next = { ...next, collections: [...next.collections, c] };
  if ('role' in patch) next = setRole(next, rel, patch.role ?? null);
  return next;
}

// ---------------------------------------------------------------------------------------------------------------------
// Search, filters and order.

export type AssetSort = 'recent' | 'name' | 'size' | 'kind';

export interface AssetFilter {
  query?: string;
  kind?: AssetKind | 'all';
  collection?: string;
  tag?: string;
  /** 'store': the Assets folder only; 'attachments': only files pasted into notes. */
  where?: 'all' | 'store' | 'attachments';
  /** One area of life's assets (its id); none: every area's. */
  area?: string;
}

/** The words an asset is found by: its name (split at - _ . and case changes), path, tags, collections, description, alt. */
function haystack(a: AssetEntry): string {
  const spaced = a.name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_.]+/g, ' ');
  return [a.name, spaced, a.path, kindInfo(a.kind).label, ...a.tags, ...a.tags.map((t) => `#${t}`), ...a.collections, a.description ?? '', a.alt ?? '', a.role ? BRAND_ROLES.find((r) => r.id === a.role)?.label ?? '' : ''].join(' \u0001 ').toLowerCase();
}

export function filterAssets(list: AssetEntry[], f: AssetFilter, sort: AssetSort = 'recent'): AssetEntry[] {
  const words = (f.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const out = list.filter((a) => {
    if (f.kind && f.kind !== 'all' && a.kind !== f.kind) return false;
    if (f.where === 'store' && a.attachment) return false;
    if (f.where === 'attachments' && !a.attachment) return false;
    if (f.area && a.area !== f.area) return false;
    if (f.collection && !a.collections.some((c) => c.toLowerCase() === f.collection!.toLowerCase())) return false;
    if (f.tag && !a.tags.some((t) => t.toLowerCase() === f.tag!.toLowerCase())) return false;
    if (!words.length) return true;
    const hay = haystack(a);
    return words.every((w) => hay.includes(w));
  });
  const byName = (a: AssetEntry, b: AssetEntry) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const order: Record<AssetSort, (a: AssetEntry, b: AssetEntry) => number> = {
    recent: (a, b) => b.mtime - a.mtime || byName(a, b),
    name: byName,
    size: (a, b) => b.size - a.size || byName(a, b),
    kind: (a, b) => KIND_IDS.indexOf(a.kind) - KIND_IDS.indexOf(b.kind) || byName(a, b),
  };
  return out.sort(order[sort]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Duplicates: the same bytes (by a content hash) already in the store.

export interface Incoming {
  source: string;
  name: string;
  size: number;
  hash: string;
}

/** For each incoming file, the asset with the same content, if any (size first, then hash: only same-size files are hashed). */
export function matchDuplicates(incoming: Incoming[], store: { path: string; size: number; hash?: string }[]): Map<string, string> {
  const bySize = new Map<number, { path: string; hash?: string }[]>();
  for (const s of store) {
    const list = bySize.get(s.size) ?? [];
    list.push(s);
    bySize.set(s.size, list);
  }
  const out = new Map<string, string>();
  for (const f of incoming) {
    const same = (bySize.get(f.size) ?? []).find((s) => s.hash && s.hash === f.hash);
    if (same) out.set(f.source, same.path);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// SVGs made safe: no scripts, no event handlers, nothing fetched from elsewhere. The window also only ever draws an SVG
// as a picture (an <img>), where scripts never run; this is the second wall.

const DANGEROUS_ELEMENTS = ['script', 'foreignObject', 'iframe', 'embed', 'object', 'audio', 'video', 'handler', 'listener'];

export function sanitiseSvg(input: string): string {
  let s = input.replace(/^﻿/, '');
  // No document type or entities (they can pull in other files or grow without end).
  s = s.replace(/<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?\s*>/gi, '').replace(/<!ENTITY[\s\S]*?>/gi, '');
  // Processing instructions other than the XML declaration (a stylesheet one fetches a file).
  s = s.replace(/<\?(?!xml\s)[\s\S]*?\?>/gi, '');
  for (const el of DANGEROUS_ELEMENTS) {
    const name = el.replace(/[A-Z]/g, (c) => `[${c}${c.toLowerCase()}]`);
    s = s.replace(new RegExp(`<(?:[\\w-]+:)?${name}\\b[\\s\\S]*?<\\/(?:[\\w-]+:)?${name}\\s*>`, 'gi'), '');
    s = s.replace(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>`, 'gi'), '');
  }
  // Animations that change a link or an event handler.
  s = s.replace(/<(?:[\w-]+:)?(?:set|animate)\b[^>]*attributeName\s*=\s*["']?\s*(?:[\w-]+:)?(?:href|on\w+)[^>]*>(?:[\s\S]*?<\/(?:[\w-]+:)?(?:set|animate)\s*>)?/gi, '');
  // Event handlers: on…="…" in any quoting.
  s = s.replace(/\s(?:[\w-]+:)?on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Links: only to something inside the SVG itself (#id) or a picture carried inside it (data:image/…, not SVG).
  s = s.replace(/\s((?:[\w-]+:)?href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (whole, attr: string, _q, d1?: string, d2?: string, d3?: string) => {
    const value = (d1 ?? d2 ?? d3 ?? '').trim().replace(/[\u0000- ]+/g, '');
    if (value.startsWith('#')) return whole;
    if (/^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i.test(value)) return whole;
    return ` ${attr}="#"`;
  });
  // Styles: nothing fetched (@import, url(http…)), no old script-in-CSS tricks.
  s = s.replace(/@import[^;>]*;?/gi, '');
  s = s.replace(/url\(\s*(['"]?)\s*(?!#|data:image\/(?:png|jpe?g|gif|webp))[^)]*\)/gi, 'none');
  s = s.replace(/expression\s*\(/gi, '(').replace(/javascript\s*:/gi, '').replace(/vbscript\s*:/gi, '');
  return s.trim();
}

/** An SVG's size: its width and height in pixels, else its viewBox. */
export function svgSize(svg: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!tag) return null;
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(px)?\\s*["']`, 'i').exec(tag);
  const w = attr('width');
  const h = attr('height');
  if (w && h) return { width: Math.round(parseFloat(w[1])), height: Math.round(parseFloat(h[1])) };
  const vb = /\sviewBox\s*=\s*["']\s*([-0-9.]+)[\s,]+([-0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i.exec(tag);
  if (vb) return { width: Math.round(parseFloat(vb[3])), height: Math.round(parseFloat(vb[4])) };
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// A picture's colours, worked out on this PC from its pixels (RGBA, as a canvas gives them).

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
export const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
export function fromHex(hex: string): [number, number, number] {
  const h = cleanHex(hex) ?? '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/**
 * The main colours of a picture, most used first: pixels grouped by colour (16 levels a channel), see-through ones left
 * out, near colours merged, then any colour under `minShare` of the picture dropped.
 */
export function palette(rgba: ArrayLike<number>, options: { max?: number; minShare?: number; merge?: number } = {}): string[] {
  const max = options.max ?? 6;
  const minShare = options.minShare ?? 0.03;
  const merge = options.merge ?? 34;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const k = buckets.get(key);
    if (k) {
      k.n++;
      k.r += r;
      k.g += g;
      k.b += b;
    } else buckets.set(key, { n: 1, r, g, b });
    total++;
  }
  if (!total) return [];
  const groups: { n: number; r: number; g: number; b: number }[] = [];
  for (const k of [...buckets.values()].sort((a, b) => b.n - a.n)) {
    const c = [k.r / k.n, k.g / k.n, k.b / k.n];
    const near = groups.find((g) => Math.hypot(g.r / g.n - c[0], g.g / g.n - c[1], g.b / g.n - c[2]) < merge);
    if (near) {
      near.n += k.n;
      near.r += k.r;
      near.g += k.g;
      near.b += k.b;
    } else groups.push({ ...k });
  }
  return groups
    .sort((a, b) => b.n - a.n)
    .filter((g) => g.n / total >= minShare)
    .slice(0, max)
    .map((g) => toHex(g.r / g.n, g.g / g.n, g.b / g.n));
}

/** Dark or light words on a colour, whichever reads. */
export function inkOn(hex: string): 'dark' | 'light' {
  const [r, g, b] = fromHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? 'dark' : 'light';
}

// ---------------------------------------------------------------------------------------------------------------------
// Where an asset is used: notes that link or embed it, canvases with it on them, and the projects those notes belong to.

export interface UseNote {
  path: string;
  title: string;
  links: { target: string }[];
  props?: Record<string, unknown>;
}

export interface UseCanvas {
  path: string;
  /** The files on the canvas (its file cards). */
  files: string[];
}

/** The files a canvas (JSON Canvas) shows on its cards. */
export function canvasFiles(json: string): string[] {
  try {
    const v = JSON.parse(json) as { nodes?: { type?: unknown; file?: unknown }[] };
    return (Array.isArray(v.nodes) ? v.nodes : []).filter((n) => n && n.type === 'file' && typeof n.file === 'string').map((n) => n.file as string);
  } catch {
    return [];
  }
}

/** The project a note belongs to: a project file itself, or a note in a project's folder (Projects/<Name>/…). */
export function projectOf(note: UseNote, projects: Map<string, string>): string | undefined {
  if (isProjectProps(note.props)) return note.path;
  const dir = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '';
  for (let d = dir; d; d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '') {
    const p = projects.get(d);
    if (p) return p;
  }
  return undefined;
}

/**
 * Every asset's uses in one pass: asset path → notes, canvases and projects. `resolve` finds what a link names (as the
 * index does); `projects` maps a project's folder to its project file.
 */
export function usesOf(assets: Set<string>, notes: UseNote[], canvases: UseCanvas[], resolve: (target: string, from: string) => string | null): Map<string, AssetUse[]> {
  const out = new Map<string, AssetUse[]>();
  const titles = new Map(notes.map((n) => [n.path, n.title]));
  const projects = new Map<string, string>();
  for (const n of notes) if (isProjectProps(n.props) && projectOwnsFolder(n.path)) projects.set(n.path.slice(0, n.path.lastIndexOf('/')), n.path);
  const add = (asset: string, use: AssetUse) => {
    const list = out.get(asset) ?? [];
    if (!list.some((u) => u.path === use.path && u.kind === use.kind)) list.push(use);
    out.set(asset, list);
  };
  for (const n of notes) {
    for (const link of n.links) {
      const hit = resolve(link.target, n.path);
      if (!hit || !assets.has(hit)) continue;
      const project = projectOf(n, projects);
      if (project !== n.path) add(hit, { path: n.path, title: n.title, kind: 'note' });
      if (project) add(hit, { path: project, title: titles.get(project) ?? project, kind: 'project' });
    }
  }
  for (const c of canvases) {
    for (const f of c.files) if (assets.has(f)) add(f, { path: c.path, title: (c.path.split('/').pop() ?? c.path).replace(/\.canvas$/i, ''), kind: 'canvas' });
  }
  return out;
}

/** Whether a library path is in the asset store: the Assets folder, an area of life's own Assets folder ("Family/Assets"),
 *  where pasted files go (Settings › Files and links), or a note's Files folder (files kept with their record). */
export function storeArea(rel: string, assetsFolder: string, attachments: string, areaAssets: readonly string[] = [], withRecord = false): 'store' | 'attachment' | null {
  if (/\.(md|canvas|nvtmp)$/i.test(rel)) return null;
  const folder = assetsFolder.replace(/^\/+|\/+$/g, '');
  if (folder && rel.startsWith(`${folder}/`)) return rel === `${folder}/${SIDECAR_NAME}` ? null : 'store';
  for (const a of areaAssets) if (a && rel.toLowerCase().startsWith(`${a.toLowerCase()}/`)) return 'store';
  if (withRecord && /(^|\/)Files\//.test(rel)) return 'attachment';
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  if (attachments.startsWith('./')) {
    // Beside each note: a folder of that name anywhere (./ alone: any folder, so every file that isn't a note).
    const sub = attachments.slice(2).replace(/\/+$/, '');
    if (!sub) return 'attachment';
    return dir === sub || dir.endsWith(`/${sub}`) ? 'attachment' : null;
  }
  const att = attachments.replace(/^\/+|\/+$/g, '');
  if (!att) return dir === '' ? 'attachment' : null;
  return rel.startsWith(`${att}/`) ? 'attachment' : null;
}

/** File sizes in words: 940 KB, 2.4 MB. */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
