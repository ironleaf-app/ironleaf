import { needsWindowsRepair } from '../shared/paths';
// One standard home for vaults, and the same vault on every PC (23 Oct 2026; src/shared/vault-home.ts has the words and
// the rules that need no disk). The desktop opened a second, local vault (C:\Users\<them>\Documents\Work, a plain
// folder, while Windows had moved Documents into OneDrive) while a laptop, the former host app and a chat bot used
// OneDrive\Documents\Ironleaf. Here:
//  - a vault's identity (.neuralvault/vault.json: id, name, created), written once and read by every app on every PC;
//  - the vaults on this PC: Documents\Ironleaf (Windows' own Documents, wherever it has been moved) and the folders
//    inside it that are vaults of their own, the synced places' Ironleaf folders (OneDrive personal and work, Google
//    Drive's My Drive and the Documents it backs up from other computers, Dropbox and its backups, iCloud Drive), the
//    library and the vaults opened lately — for a new PC to open the one it finds (never a new empty one beside it), and
//    for Settings › Files and links › Your vaults;
//  - Export vault (one zip: notes, files, the vault's settings and assets) and Import vault (a folder, a USB drive or a
//    zip; or notes from another app: Markdown folders, HTML and CSV exports), merged without losing anything.
// Everything it reads about this PC comes through its arguments, so it runs on any PC with made-up folders
// (tests/vault-home.test.mjs).

import { createHash, randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { docText, mergeDocs, readDoc, sameDoc } from '../shared/vault-settings';
import { isPrivatePath } from '../shared/private';
import { HOME_FOLDER, HOME_FOLDERS, ID_DIR, ID_FILE, importWords, type ExportDone, type HomeUndoBatch, type ImportPlan, type ImportProgress, type ImportSummary, type PcEntry, type PcVaultInfo, type VaultIdentity } from '../shared/vault-home';
import { csvToMarkdown, htmlToMarkdown, mergeNote, mhtToMarkdown, sameText } from '../shared/vault-merge';
import { docxToMarkdown } from './word-import';
import { LEGACY_WELCOME_NAME, WELCOME_NAME, type PlaceKind } from '../shared/vault-place';
import { isInside, lookAtVault, placeOf, within, type PlaceDeps, type Places } from './vault-place';
import { extractZip, writeZip, zipItems, type ZipSource } from './zip';

type Deps = Pick<PlaceDeps, 'path' | 'platform'>;
const quiet = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};
const exists = (p: string) => fsp.stat(p).then(
  () => true,
  () => false,
);
const isDir = (p: string) => fsp.stat(p).then(
  (s) => s.isDirectory(),
  () => false,
);
const lower = (p: string) => nodePath.resolve(p).replace(/[\\/]+$/, '').toLowerCase();

// ── Identity ────────────────────────────────────────────────────────────────────────────────────────────────────────

const idFile = (root: string) => nodePath.join(root, ID_DIR, ID_FILE);

export function cleanIdentity(v: unknown): VaultIdentity | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(o.id)) return null;
  const name = typeof o.name === 'string' ? o.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) : '';
  const created = typeof o.created === 'string' && !Number.isNaN(Date.parse(o.created)) ? o.created : '';
  return { id: o.id, name, created };
}

/** The vault's identity, or null when it has none (yet) or it can't be read. */
export async function readIdentity(root: string): Promise<VaultIdentity | null> {
  return quiet(async () => cleanIdentity(JSON.parse((await fsp.readFile(idFile(root), 'utf8')).replace(/^\uFEFF/, ''))), null);
}

/**
 * The vault's identity, written the first time (never over one already there: a second PC that opens the vault first
 * finds the one the first PC wrote, synced with the notes). Null when the folder can't be written.
 */
export async function ensureIdentity(root: string, name = nodePath.basename(root)): Promise<VaultIdentity | null> {
  const have = await readIdentity(root);
  if (have) return have;
  const id: VaultIdentity = { id: randomUUID(), name: name || 'Vault', created: new Date().toISOString() };
  try {
    await fsp.mkdir(nodePath.join(root, ID_DIR), { recursive: true });
    await fsp.writeFile(idFile(root), `${JSON.stringify(id, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return id;
  } catch (err) {
    // Another start (or another PC, through the sync) wrote it in between: that one is the vault's.
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return readIdentity(root);
    return null;
  }
}

/** Whether a folder is a vault of its own (it has an identity): inside another vault, it is kept out of that one. */
export const holdsIdentity = (dir: string) => exists(idFile(dir));

// ── The vaults on this PC ───────────────────────────────────────────────────────────────────────────────────────────

export interface Spot {
  path: string;
  kind: PlaceKind;
  /** The place by name ("OneDrive", "Google Drive › Other computers › Office-PC", "Documents"). */
  name: string;
}

export interface FoundHomeVault extends Spot {
  id: string | null;
  vaultName: string;
  notes: number;
  projects: number;
}

/**
 * Where vaults may be on this PC: Documents\Ironleaf, and in each synced place its Ironleaf folder, its Documents'
 * Ironleaf folder, Google Drive's backed-up computers' Documents, and Dropbox's backups of other PCs' Documents.
 */
export async function homeSpots(documents: string, places: Places, deps: Deps, first?: string): Promise<Spot[]> {
  const out: Spot[] = [];
  const add = (p: string, kind: PlaceKind, name: string) => {
    if (!out.some((s) => lower(s.path) === lower(p))) out.push({ path: p, kind, name });
  };
  // This PC's home first (the default library: Documents\Ironleaf, or Documents\NeuralVault from before the rename),
  // then both names everywhere else: vaults kept under the old name on other PCs and in synced places are still found.
  const home = first ?? deps.path.join(documents, HOME_FOLDER);
  add(home, placeOf(home, places, deps).kind, 'Documents');
  for (const folder of HOME_FOLDERS) add(deps.path.join(documents, folder), placeOf(deps.path.join(documents, folder), places, deps).kind, 'Documents');
  for (const r of places.roots) {
    if (r.shared) continue;
    for (const folder of HOME_FOLDERS) {
      add(deps.path.join(r.path, folder), r.service, r.name);
      add(deps.path.join(r.path, 'Documents', folder), r.service, r.name);
    }
    if (r.service === 'gdrive') {
      // My Drive's drive holds "Other computers": the folders Google Drive backs up from each of the person's PCs.
      const mount = /my drive$/i.test(r.path) ? deps.path.dirname(r.path) : r.path;
      for (const top of ['Other computers', 'Computers']) {
        const base = deps.path.join(mount, top);
        for (const pc of (await quiet(() => fsp.readdir(base), [] as string[])).slice(0, 24)) {
          for (const folder of HOME_FOLDERS) {
            add(deps.path.join(base, pc, 'Documents', folder), 'gdrive', `Google Drive › ${top} › ${pc}`);
            add(deps.path.join(base, pc, folder), 'gdrive', `Google Drive › ${top} › ${pc}`);
          }
        }
      }
    }
    if (r.service === 'dropbox') {
      // Dropbox Backup keeps each PC's Documents in a folder named after it ("My PC (OFFICE-PC)").
      for (const pc of (await quiet(() => fsp.readdir(r.path), [] as string[])).filter((n) => /^My (PC|Mac|Computer)\b|\([^)]+\)$/i.test(n)).slice(0, 24))
        for (const folder of HOME_FOLDERS) add(deps.path.join(r.path, pc, 'Documents', folder), 'dropbox', `${r.name} › ${pc}`);
    }
  }
  for (const n of places.network) {
    for (const folder of HOME_FOLDERS) {
      add(deps.path.join(n.path, folder), 'network', n.remote ? `a network drive (${n.remote})` : 'a network drive');
      add(deps.path.join(n.path, 'Documents', folder), 'network', n.remote ? `a network drive (${n.remote})` : 'a network drive');
    }
  }
  return out;
}

/** A vault found at a spot, with the vaults of their own inside it (Documents\Ironleaf\Work). */
async function vaultsAt(spot: Spot, templates: string | undefined, limit: number): Promise<FoundHomeVault[]> {
  const out: FoundHomeVault[] = [];
  if (!(await isDir(spot.path))) return out;
  const look = await lookAtVault(spot.path, { templates, limit });
  const id = await readIdentity(spot.path);
  const top = await quiet(() => fsp.readdir(spot.path, { withFileTypes: true }), []);
  // The folder is a vault itself when it says so (its identity), or has what a vault has at its top: notes, Ironleaf's
  // first note, its Templates, Projects or Daily folders, Private notes. A home holding only folders of notes is a home
  // of extra vaults (Documents\Ironleaf\Club, …\Family), each a vault.
  const marks = top.some((e) => (e.isFile() && /\.md$/i.test(e.name)) || (e.isDirectory() && /^(templates|projects|daily|private notes|attachments|assets)$/i.test(e.name)) || (templates && e.isDirectory() && e.name.toLowerCase() === templates.toLowerCase()));
  const innerVaults: FoundHomeVault[] = [];
  for (const e of top) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const inner = nodePath.join(spot.path, e.name);
    const innerId = await readIdentity(inner);
    if (!innerId && (id || marks)) continue;
    const l = await lookAtVault(inner, { templates, limit });
    if (innerId || (l.isVault && l.notes > 0)) innerVaults.push({ path: inner, kind: spot.kind, name: spot.name, id: innerId?.id ?? null, vaultName: innerId?.name || e.name, notes: l.notes, projects: l.projects });
  }
  const itself = !!id || (look.isVault && (look.notes > 0 || look.projects > 0) && (marks || !innerVaults.length));
  if (itself) {
    out.push({ ...spot, id: id?.id ?? null, vaultName: id?.name || nodePath.basename(spot.path), notes: look.notes, projects: look.projects });
    // Inside a vault, only folders that say they're vaults of their own are.
    out.push(...innerVaults.filter((v) => v.id));
  } else out.push(...innerVaults);
  return out;
}

/** Every vault at those spots, most notes first. Never throws; a slow drive is given `timeoutMs`. */
export async function findHomeVaults(spots: Spot[], o: { templates?: string; timeoutMs?: number; limit?: number } = {}): Promise<FoundHomeVault[]> {
  const all = await Promise.all(spots.map((s) => within(vaultsAt(s, o.templates, o.limit ?? 40000), o.timeoutMs ?? 5000, [] as FoundHomeVault[])));
  const out: FoundHomeVault[] = [];
  const seen = new Set<string>();
  for (const v of all.flat()) {
    const real = lower(await fsp.realpath(v.path).catch(() => v.path));
    if (seen.has(real)) continue;
    seen.add(real);
    out.push(v);
  }
  return out.sort((a, b) => b.notes - a.notes || b.projects - a.projects);
}

/**
 * The vault a new PC opens: the one found with the most notes (a vault in Documents\Ironleaf first when two are
 * level). Null: none found, so the new, empty vault is made.
 */
export function pickFirst(found: FoundHomeVault[], home: string): FoundHomeVault | null {
  if (!found.length) return null;
  return [...found].sort((a, b) => b.notes - a.notes || b.projects - a.projects || Number(isInside({ path: nodePath, platform: process.platform }, b.path, home)) - Number(isInside({ path: nodePath, platform: process.platform }, a.path, home)))[0];
}

// ── The person's other PCs (the former host app's computer list)
// ─ ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const KINDS: PlaceKind[] = ['onedrive', 'dropbox', 'gdrive', 'icloud', 'network', 'local'];
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '');

/** The former host app's answer (its computer list with each PC's vault), checked; null when it isn't a
list. */
export function cleanPcs(raw: unknown): PcEntry[] | null {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { computers?: unknown }).computers) ? (raw as { computers: unknown[] }).computers : null;
  if (!list) return null;
  const out: PcEntry[] = [];
  for (const c of list.slice(0, 32)) {
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const id = text(o.id, 80);
    const name = text(o.name, 60) || 'Another computer';
    if (!id) continue;
    let vault: PcVaultInfo | null = null;
    const v = o.vault as Record<string, unknown> | null | undefined;
    if (v && typeof v === 'object' && text(v.name, 120)) {
      const place = KINDS.includes(v.place as PlaceKind) ? (v.place as PlaceKind) : 'local';
      vault = { id: text(v.id, 64) || null, name: text(v.name, 120), ...(text(v.path, 1000) ? { path: text(v.path, 1000) } : {}), place, placeName: text(v.placeName, 80) || (place === 'local' ? 'this PC' : place) };
    }
    const lastSeen = Number(o.lastSeen);
    out.push({ id, name, me: o.me === true, online: o.online === true, lastSeen: Number.isFinite(lastSeen) && lastSeen > 0 ? lastSeen : null, vault });
  }
  return out;
}

// ── Export ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const EXPORT_DIR = `${ID_DIR}/export`;
const JUNK = /^(desktop\.ini|thumbs\.db|\.ds_store)$/i;
const SKIP_TOP = /^\.(Ironleaf|NeuralVault)-moving-/; // the old name: a move an earlier version left half-done
/** Never exported or brought into another vault: a Git backup's own folder (its history belongs to that vault). */
const NEVER = (rel: string) => /^\.git(\/|$)/.test(rel) || /(^|\/)\.git\//.test(rel);

interface TreeFile {
  rel: string;
  abs: string;
  size: number;
  mtime: number;
}

/** Every file of a vault for an export or an import: hidden ones too, never a link, a half-written file, a vault of its
 *  own inside it, a `.git` folder, or Windows' own desktop.ini and the like. Skipped vaults and `.git` folders are
 *  named, so the export can say what stayed behind. */
export async function vaultFiles(root: string, o: { skipNested?: boolean } = {}): Promise<{ files: TreeFile[]; nested: string[]; git: string[] }> {
  const files: TreeFile[] = [];
  const nested: string[] = [];
  const git: string[] = [];
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 40) return;
    const dir = rel ? nodePath.join(root, ...rel.split('/')) : root;
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink() || JUNK.test(e.name) || e.name.endsWith('.nvtmp') || e.name.endsWith('.part') || (!rel && SKIP_TOP.test(e.name))) continue;
      if (e.isDirectory()) {
        // A 2 GB history never rides along (5 Nov 2026, u3 moving-in: it did).
        if (NEVER(`${r}/`)) {
          git.push(r);
          continue;
        }
        if (o.skipNested !== false && (await holdsIdentity(nodePath.join(dir, e.name)))) {
          nested.push(r);
          continue;
        }
        await walk(r, depth + 1);
      } else if (e.isFile()) {
        const st = await fsp.stat(nodePath.join(dir, e.name));
        files.push({ rel: r, abs: nodePath.join(dir, e.name), size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  await walk('', 0);
  return { files: files.sort((a, b) => a.rel.localeCompare(b.rel)), nested, git };
}

/** What an export left behind, in the result's own words (5 Nov 2026, u3 moving-in: a nested vault silently didn't
 *  ride along). Empty when everything rode along. */
export function exportLeftBehind(git: string[], nested: string[]): string {
  const bits: string[] = [];
  if (git.length) bits.push(git.length === 1 ? 'its .git folder (history, not notes)' : `${git.length} .git folders (history, not notes)`);
  if (nested.length) {
    const names = nested.map((n) => `${n}/`).join(', ');
    bits.push(nested.length === 1 ? `a vault inside it (${names}). Export that one on its own` : `vaults inside it (${names}). Export those on their own`);
  }
  return bits.length ? ` Stayed behind: ${bits.join('; ')}.` : '';
}

export interface ExportExtras {
  /** Ironleaf's settings that belong with the vault (never keys, the model chosen, or this PC's folders). */
  settings: Record<string, unknown>;
  /** What Ironleaf remembers about this vault (its views, layouts, tabs, bookmarks…): name → JSON text. */
  library: Record<string, string>;
  identity: VaultIdentity | null;
  version: string;
}

/** Export vault: one zip of the whole vault, its settings and what Ironleaf remembers about it. */
export async function exportVault(root: string, dest: string, extras: ExportExtras, onProgress?: (p: ImportProgress) => void): Promise<ExportDone> {
  if (isInside({ path: nodePath, platform: process.platform }, dest, root)) throw new Error('Save the export outside the vault, so it doesn’t include itself.');
  const { files, nested, git } = await vaultFiles(root);
  const total = files.reduce((s, f) => s + f.size, 0);
  const manifest = { kind: 'neuralvault-export', format: 1, exportedAt: new Date().toISOString(), version: extras.version, identity: extras.identity, files: files.filter((f) => !f.rel.startsWith(`${EXPORT_DIR}/`)).length, bytes: total, from: os.hostname(), leftBehind: { git, nested } };
  async function* sources(): AsyncGenerator<ZipSource> {
    for (const f of files) if (!f.rel.startsWith(`${EXPORT_DIR}/`)) yield { name: f.rel, abs: f.abs, mtime: f.mtime };
    yield { name: `${EXPORT_DIR}/settings.json`, data: Buffer.from(JSON.stringify(extras.settings, null, 2), 'utf8') };
    for (const [name, json] of Object.entries(extras.library)) yield { name: `${EXPORT_DIR}/library/${name}`, data: Buffer.from(json, 'utf8') };
    yield { name: `${EXPORT_DIR}/export.json`, data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') };
  }
  onProgress?.({ phase: 'packing', done: 0, total });
  await writeZip(dest, sources(), (_n, bytes) => onProgress?.({ phase: 'packing', done: Math.min(bytes, total), total }));
  const size = (await fsp.stat(dest)).size;
  return { file: dest, files: manifest.files, bytes: size, words: `Your vault is saved in one file, ${nodePath.basename(dest)} (${manifest.files.toLocaleString('en-AU')} files). Copy it to another PC or a USB drive, and use Import vault there.${exportLeftBehind(git, nested)}` };
}

// ── Import ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One import's take-back records (v4-no-clutter item 2): .neuralvault/import-batches/<id>.json. */
export const BATCHES_DIR = '.neuralvault/import-batches';
/** A combined note's words before are kept for Undo up to this size (bigger: File recovery has them, and Undo says so). */
const UNDO_BEFORE_CAP = 262144;
/** A fingerprint of some words, for knowing Undo still sees what the import wrote. */
const fingerprint = (s: string): string => createHash('sha256').update(s.replace(/\r\n?/g, '\n'), 'utf8').digest('hex').slice(0, 24);

const NOTE = /\.(md|markdown)$/i;
const HTML = /\.html?$/i;
const CSV = /\.csv$/i;
/** A Word document (9.5 F9) or a OneNote web archive (F10): made into a note like HTML. Older .doc and OneNote's
 *  own .one binaries are kept as files and said (they need saving as .docx or web archive first). */
const WORD = /\.docx$/i;
const MHT = /\.mht(?:ml)?$/i;
const WORD_OLD = /\.doc$/i;
const ONENOTE = /\.one(?:pkg)?$/i;

function dayWords(d = new Date()): string {
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A name safe for a folder ("Evernote export"). */
export function folderName(name: string): string {
  return name.replace(/\.zip$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Imported';
}

/** Whether a folder is an Ironleaf vault (its identity, its export record, or its first note). */
async function isIronleaf(dir: string): Promise<boolean> {
  return (await exists(nodePath.join(dir, ID_DIR))) || (await exists(nodePath.join(dir, WELCOME_NAME))) || (await exists(nodePath.join(dir, LEGACY_WELCOME_NAME)));
}

/** The folder a zip unpacked into, looked at: a zip holding one folder (as Windows' "Send to › Compressed folder" makes
 *  it) is that folder. */
async function rootOfUnpacked(dir: string): Promise<string> {
  const top = (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => !JUNK.test(e.name) && e.name !== '__MACOSX');
  if (top.length === 1 && top[0].isDirectory() && !(await exists(nodePath.join(dir, ID_DIR)))) return nodePath.join(dir, top[0].name);
  return dir;
}

export interface ImportSource {
  plan: ImportPlan;
  /** The folder read (a zip's unpacked into a temporary folder, removed by `done()`). */
  folder: string;
  done(): Promise<void>;
}

/** What importing a folder or zip will bring, and where it goes. A zip is unpacked first (into `tempDir`). */
export async function readImport(source: string, vaultRoot: string, o: { tempDir: string; onProgress?(p: ImportProgress): void }): Promise<ImportSource> {
  const st = await fsp.stat(source).catch(() => null);
  if (!st) throw new Error('That file or folder can’t be opened.');
  const deps = { path: nodePath, platform: process.platform } as Deps;
  let folder = source;
  let cleanup = async () => {};
  const zip = st.isFile();
  if (zip) {
    await zipItems(source); // a plain refusal when it isn't a zip
    const temp = nodePath.join(o.tempDir, `import-${randomUUID().slice(0, 8)}`);
    await fsp.mkdir(temp, { recursive: true });
    cleanup = () => fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
    try {
      const free = await fsp.statfs(o.tempDir).then((s) => Number(s.bavail) * Number(s.bsize), () => undefined);
      await extractZip(source, temp, { maxBytes: free, onProgress: (done, total) => o.onProgress?.({ phase: 'unpacking', done, total }) });
      folder = await rootOfUnpacked(temp);
    } catch (err) {
      await cleanup();
      throw err;
    }
  } else if (isInside(deps, source, vaultRoot) || isInside(deps, vaultRoot, source)) {
    throw new Error('That folder is this vault, or holds it. Choose another vault’s folder or an export.');
  }
  const vault = await isIronleaf(folder);
  let sourceName = folderName(nodePath.basename(source));
  if (vault) {
    const manifest = await quiet(async () => JSON.parse(await fsp.readFile(nodePath.join(folder, EXPORT_DIR, 'export.json'), 'utf8')) as { identity?: unknown }, null);
    const id = cleanIdentity(manifest?.identity) ?? (await readIdentity(folder));
    if (id?.name) sourceName = folderName(id.name);
  }
  const { files } = await vaultFiles(folder, { skipNested: true });
  const counted = files.filter((f) => !f.rel.startsWith(`${ID_DIR}/`));
  const pages = (rel: string) => NOTE.test(rel) || HTML.test(rel) || CSV.test(rel) || WORD.test(rel) || MHT.test(rel);
  return {
    plan: { source, sourceName, kind: vault ? 'vault' : 'notes', into: vault ? '' : sourceName, files: counted.length, notes: counted.filter((f) => pages(f.rel)).length, bytes: counted.reduce((s, f) => s + f.size, 0), zip },
    folder,
    done: cleanup,
  };
}

export interface ImportOptions {
  /** The vault here holds nothing of the person's own yet: an export's identity and settings are taken as its own. */
  targetIsNew: boolean;
  /** A note here about to change (for file recovery), with its words before. */
  beforeChange?(rel: string, before: string): void | Promise<void>;
  /** Every note written (added, merged or kept apart), vault-relative: the relations seam syncs them after the rescan. */
  onWritten?(rel: string): void;
  /** An export's settings and what Ironleaf remembered about it, to use (only when the vault here was new). */
  applySettings?(settings: Record<string, unknown>, library: Record<string, string>): Promise<void>;
  onProgress?(p: ImportProgress): void;
  /** Stopping halfway (9.5 F3): checked between files; each file is atomic, so stopping leaves no half note. */
  signal?: { stopped: boolean };
  /** The day said in "Merged from … (day)". */
  day?: string;
}

async function writeAtomic(abs: string, data: string | Buffer): Promise<void> {
  await fsp.mkdir(nodePath.dirname(abs), { recursive: true });
  const tmp = `${abs}.${randomUUID().slice(0, 8)}.nvtmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, abs);
}

async function sameBytes(a: string, b: string, size: number): Promise<boolean> {
  const st = await fsp.stat(b).catch(() => null);
  if (!st || st.size !== size) return false;
  if (size > 256 * 1024 * 1024) {
    const { createHash } = await import('node:crypto');
    const h = async (p: string) => {
      const x = createHash('sha256');
      const { createReadStream } = await import('node:fs');
      for await (const c of createReadStream(p)) x.update(c as Buffer);
      return x.digest('hex');
    };
    return (await h(a)) === (await h(b));
  }
  const [x, y] = await Promise.all([fsp.readFile(a), fsp.readFile(b)]);
  return x.equals(y);
}

/**
 * Brings what `src` read into the vault at `root`, losing nothing: a file not here is written; one here and the same is
 * left; a note here that differs is combined (mergeNote: the note here unchanged at the top, every other line of the
 * import under "Merged from <source> (<day>)"); any other file that differs keeps the import's copy beside it, at the same
 * path inside a folder "Merged from <source>". Nothing is renamed. Pages from other apps become notes (HTML, CSV), their
 * originals kept beside them.
 */
export async function importInto(root: string, src: ImportSource, o: ImportOptions): Promise<ImportSummary> {
  const { plan, folder } = src;
  const day = o.day ?? dayWords();
  const apart = folderName(`Merged from ${plan.sourceName}`);
  const summary: Omit<ImportSummary, 'words'> = { sourceName: plan.sourceName, into: plan.into, added: 0, identical: 0, merged: [], keptApart: [], converted: 0, skipped: [], settings: null };
  /** This run's take-back record: everything made or combined, for one Undo. */
  const batch: HomeUndoBatch = { id: `home-${randomUUID().slice(0, 8)}`, at: new Date().toISOString(), sourceName: plan.sourceName, into: plan.into, added: [], apart: [], updated: [] };
  const keepBefore = (mine: string): { before: string | null; tooBig?: boolean } => (mine.length > UNDO_BEFORE_CAP ? { before: null, tooBig: true } : { before: mine });
  const saveBatch = async (stopped: boolean): Promise<void> => {
    // A run that changed nothing keeps no record: there is nothing to take back.
    if (!batch.added.length && !batch.apart.length && !batch.updated.length) return;
    if (stopped) batch.stopped = true;
    summary.batchId = batch.id;
    summary.undoable = { notes: batch.added.filter((r) => NOTE.test(r)).length + batch.updated.length, files: batch.added.filter((r) => !NOTE.test(r)).length + batch.apart.length };
    await writeAtomic(nodePath.join(root, BATCHES_DIR, `${batch.id}.json`), `${JSON.stringify(batch, null, 1)}\n`);
  };
  const { files, git } = await vaultFiles(folder, { skipNested: true });
  // A Git backup's own record stays behind, said once per folder (5 Nov 2026, u3 moving-in: every object file
  // used to be listed — 10,000 skipped lines for one history).
  for (const g of git) summary.skipped.push({ rel: g, why: 'It is a Git backup’s own record, which belongs to the vault it came from.' });
  const total = files.reduce((s, f) => s + f.size, 0);
  let done = 0;
  const targetPrivate = await exists(nodePath.join(root, 'Private notes'));
  const destRel = (rel: string) => (plan.into ? `${plan.into}/${rel}` : rel);
  const absOf = (rel: string) => nodePath.join(root, ...rel.split('/'));
  /** One file brought in at `rel` (bytes, text or unpacked media), as the rules above say. */
  const bring = async (rel: string, from: { abs?: string; text?: string; data?: Buffer; size: number }) => {
    const dest = absOf(rel);
    const here = await fsp.stat(dest).catch(() => null);
    if (here && !here.isFile()) {
      summary.skipped.push({ rel, why: 'A folder of that name is here.' });
      return;
    }
    const sameIncoming = async (abs: string): Promise<boolean> => {
      if (from.text !== undefined) return (await fsp.readFile(abs, 'utf8').catch(() => null)) === from.text;
      if (from.data !== undefined) return (await fsp.readFile(abs).catch(() => null))?.equals(from.data) ?? false;
      return sameBytes(from.abs!, abs, from.size);
    };
    const writeIncoming = async (abs: string): Promise<void> => {
      if (from.text !== undefined || from.data !== undefined) await writeAtomic(abs, (from.text ?? from.data) as string | Buffer);
      else {
        await fsp.mkdir(nodePath.dirname(abs), { recursive: true });
        await fsp.copyFile(from.abs!, abs);
        await quiet(async () => {
          const st = await fsp.stat(from.abs!);
          await fsp.utimes(abs, st.atime, st.mtime);
        }, undefined);
      }
    };
    if (!here) {
      await writeIncoming(dest);
      summary.added++;
      batch.added.push(rel);
      if (NOTE.test(rel)) o.onWritten?.(rel);
      return;
    }
    if (NOTE.test(rel)) {
      const mine = await fsp.readFile(dest, 'utf8');
      const theirs = from.text ?? (await fsp.readFile(from.abs!, 'utf8'));
      if (sameText(mine, theirs)) {
        summary.identical++;
        return;
      }
      const m = mergeNote(mine, theirs, plan.sourceName, day);
      if (!m.changed) {
        summary.identical++;
        return;
      }
      await o.beforeChange?.(rel, mine);
      await writeAtomic(dest, m.text);
      batch.updated.push({ rel, ...keepBefore(mine), after: fingerprint(m.text) });
      summary.merged.push(rel);
      o.onWritten?.(rel);
      return;
    }
    if (await sameIncoming(dest)) {
      summary.identical++;
      return;
    }
    // Can't be combined: the import's copy kept beside, at the same path in its own folder (again the same: left).
    const at = `${apart}/${rel}`;
    const there = absOf(at);
    if (await exists(there)) {
      if (await sameIncoming(there)) {
        summary.identical++;
        return;
      }
      summary.skipped.push({ rel, why: `It differs from the copy here and from the one kept in “${apart}” before.` });
      return;
    }
    await writeIncoming(there);
    batch.apart.push(at);
    summary.keptApart.push({ rel, at });
  };

  let exportSettings: Record<string, unknown> | null = null;
  const library: Record<string, string> = {};
  for (const f of files) {
    if (o.signal?.stopped) {
      summary.stopped = true;
      await saveBatch(true);
      return { ...summary, words: importWords(summary) };
    }
    o.onProgress?.({ phase: 'merging', done, total });
    done += f.size;
    // Ironleaf's own folder: an export's settings and what it remembered, and the vault's identity (taken only by a
    // new vault here; never over this vault's own).
    if (f.rel.startsWith(`${ID_DIR}/`)) {
      if (plan.kind !== 'vault') continue;
      if (f.rel === `${EXPORT_DIR}/settings.json`) exportSettings = await quiet(async () => JSON.parse(await fsp.readFile(f.abs, 'utf8')) as Record<string, unknown>, null);
      else if (f.rel.startsWith(`${EXPORT_DIR}/library/`) && /^[a-z]+\.json$/.test(f.rel.slice(`${EXPORT_DIR}/library/`.length))) library[f.rel.slice(`${EXPORT_DIR}/library/`.length)] = await fsp.readFile(f.abs, 'utf8');
      else if (f.rel === `${ID_DIR}/${ID_FILE}`) {
        if (o.targetIsNew) {
          const id = await readIdentity(folder);
          if (id) await writeAtomic(idFile(root), `${JSON.stringify(id, null, 2)}\n`);
        }
      } else if (f.rel.startsWith(`${ID_DIR}/pcs/`)) {
        // Which PCs had the other vault open: never this one's.
        continue;
      } else if (/^\.neuralvault\/(settings\.json|state\/[a-z]+\.json)$/.test(f.rel)) {
        // The vault's settings and memories (src/shared/vault-settings.ts): merged key by key, the newer of each kept.
        const theirs = readDoc(await fsp.readFile(f.abs, 'utf8').catch(() => null), 'settings');
        const dest = absOf(f.rel);
        const mineRaw = await fsp.readFile(dest, 'utf8').catch(() => null);
        const mine = readDoc(mineRaw, 'settings');
        if (!theirs) continue;
        const merged = mergeDocs(mine, theirs);
        if (mine && sameDoc(mine, merged)) summary.identical++;
        else {
          await writeAtomic(dest, docText(merged));
          if (mine) {
            batch.updated.push({ rel: f.rel, ...keepBefore(mineRaw ?? ''), after: fingerprint(docText(merged)) });
            summary.merged.push(f.rel);
          } else {
            batch.added.push(f.rel);
            summary.added++;
          }
        }
      } else if (!f.rel.startsWith(`${EXPORT_DIR}/`)) await bring(f.rel, { abs: f.abs, size: f.size });
      continue;
    }
    if (isPrivatePath(f.rel.split('/')[0]) && plan.kind === 'vault') {
      if (targetPrivate) {
        summary.skipped.push({ rel: f.rel, why: 'Private notes are locked with their own vault’s key and can’t be combined with this vault’s. Import into a new vault to keep them.' });
        continue;
      }
    }
    const rel = destRel(f.rel);
    if (plan.kind === 'notes' && (HTML.test(f.rel) || CSV.test(f.rel) || WORD.test(f.rel) || MHT.test(f.rel))) {
      // Another app's page: made into a note beside it (unless a note of that name came with it), the original kept.
      const noteRel = rel.replace(/\.(html?|csv|mht(?:ml)?|docx)$/i, '.md');
      const companion = files.some((x) => x.rel.toLowerCase() === f.rel.replace(/\.(html?|csv|mht(?:ml)?|docx)$/i, '.md').toLowerCase());
      if (!companion && f.size >= 8 * 1024 * 1024) summary.skipped.push({ rel: f.rel, why: 'It is over 8 MB, too big to make into a note. The original is kept.' });
      if (!companion && f.size < 8 * 1024 * 1024) {
        const stem = nodePath.basename(f.rel).replace(/\.(html?|csv|mht(?:ml)?|docx)$/i, '');
        const noteDir = noteRel.includes('/') ? noteRel.slice(0, noteRel.lastIndexOf('/')) : '';
        const filesDir = `${stem}_files`;
        const mediaRel = (name: string) => {
          if (needsWindowsRepair(name)) throw new Error('Invalid picture name.');
          return `${noteDir ? `${noteDir}/` : ''}${filesDir}/${name}`;
        };
        try {
          if (HTML.test(f.rel)) {
            const raw = await fsp.readFile(f.abs, 'utf8');
            const md = htmlToMarkdown(raw);
            for (const s of md.skipped) summary.skipped.push({ rel: f.rel, why: `${s.what}: ${s.why}.` });
            const before = summary.added + summary.merged.length;
            await bring(noteRel, { text: md.markdown, size: Buffer.byteLength(md.markdown) });
            if (summary.added + summary.merged.length > before) summary.converted++;
          } else if (CSV.test(f.rel)) {
            const raw = await fsp.readFile(f.abs, 'utf8');
            const text = csvToMarkdown(raw, stem);
            const before = summary.added + summary.merged.length;
            await bring(noteRel, { text, size: Buffer.byteLength(text) });
            if (summary.added + summary.merged.length > before) summary.converted++;
          } else if (WORD.test(f.rel)) {
            const buf = await fsp.readFile(f.abs);
            const { markdown, files: media, skipped } = await docxToMarkdown(buf, filesDir);
            for (const s of skipped) summary.skipped.push({ rel: f.rel, why: `${s.what}: ${s.why}.` });
            const text = markdown ? `# ${stem}\n\n${markdown}` : `# ${stem}\n`;
            const before = summary.added + summary.merged.length;
            await bring(noteRel, { text, size: Buffer.byteLength(text) });
            if (summary.added + summary.merged.length > before) summary.converted++;
            for (const m of media) await bring(mediaRel(m.name), { data: m.data, size: m.data.length }).catch(() => summary.skipped.push({ rel: f.rel, why: `A picture (${m.name}) couldn’t be written.` }));
          } else {
            const raw = await fsp.readFile(f.abs, 'utf8');
            const { markdown, files: media, skipped } = mhtToMarkdown(raw, stem, filesDir);
            for (const s of skipped) summary.skipped.push({ rel: f.rel, why: `${s.what}: ${s.why}.` });
            const before = summary.added + summary.merged.length;
            await bring(noteRel, { text: markdown, size: Buffer.byteLength(markdown) });
            if (summary.added + summary.merged.length > before) summary.converted++;
            for (const m of media) await bring(mediaRel(m.name), { data: Buffer.from(m.data), size: m.data.length }).catch(() => summary.skipped.push({ rel: f.rel, why: `A picture (${m.name}) couldn’t be written.` }));
          }
        } catch {
          summary.skipped.push({ rel: f.rel, why: 'It couldn’t be read, so no note was made from it. The original is kept.' });
        }
      }
    }
    if (plan.kind === 'notes' && WORD_OLD.test(f.rel)) summary.skipped.push({ rel: f.rel, why: 'An older Word file: save it as .docx and bring it again to make it a note. The original is kept.' });
    if (plan.kind === 'notes' && ONENOTE.test(f.rel)) summary.skipped.push({ rel: f.rel, why: 'A OneNote notebook file: export its pages as Web Archive (.mht) or Word and bring those to make notes. The original is kept.' });
    await bring(rel, { abs: f.abs, size: f.size });
  }
  if (plan.kind === 'vault' && (exportSettings || Object.keys(library).length)) {
    if (o.targetIsNew && o.applySettings) {
      await o.applySettings(exportSettings ?? {}, library);
      summary.settings = 'applied';
    } else summary.settings = 'kept';
  }
  o.onProgress?.({ phase: 'merging', done: total, total });
  await saveBatch(false);
  return { ...summary, words: importWords(summary) };
}

/** One Undo for a folder/vault import: everything it made goes to the Bin (through `trash`), every note it combined
 *  is restored when untouched since. A note the person changed since stays as they left it, and is said. */
export async function undoHomeImport(root: string, batchId: string, o: { trash(rel: string): Promise<unknown>; beforeChange?(rel: string, before: string): void | Promise<void> }): Promise<{ words: string; notes: number; files: number; restored: number; left: string[] }> {
  const clean = (r: string): string | null => {
    const rel = r.replace(/\\/g, '/').replace(/^\/+/, '');
    return !rel || nodePath.isAbsolute(rel) || rel.split('/').some((p) => !p || p === '.' || p === '..') ? null : rel;
  };
  const empty = (words: string) => ({ words, notes: 0, files: 0, restored: 0, left: [] as string[] });
  if (!/^home-[A-Za-z0-9]+$/.test(batchId)) return empty('Nothing to take back: that import is not there any more.');
  const file = nodePath.join(root, BATCHES_DIR, `${batchId}.json`);
  const batch = await fsp.readFile(file, 'utf8').then((t) => JSON.parse(t) as HomeUndoBatch, () => null);
  if (!batch || batch.undone) return empty('Nothing to take back: that import is already undone or gone.');
  if (!batch.added.length && !batch.apart.length && !batch.updated.length) {
    batch.undone = true;
    await writeAtomic(file, `${JSON.stringify(batch, null, 1)}\n`);
    return empty('Nothing to take back: that import made no notes.');
  }
  let notes = 0;
  let files = 0;
  let restored = 0;
  const left: string[] = [];
  let tooBig = 0;
  for (const rel of [...batch.added, ...batch.apart]) {
    const at = clean(rel);
    if (!at) continue;
    if (!(await exists(nodePath.join(root, ...at.split('/'))))) continue;
    await o.trash(at);
    if (NOTE.test(at)) notes++;
    else files++;
  }
  for (const u of [...batch.updated].reverse()) {
    const at = clean(u.rel);
    if (!at) continue;
    const abs = nodePath.join(root, ...at.split('/'));
    const current = await fsp.readFile(abs, 'utf8').catch(() => null);
    if (current === null) continue;
    if (u.before === null || fingerprint(current) !== u.after) {
      if (u.before === null) tooBig++;
      left.push(at);
      continue;
    }
    await o.beforeChange?.(at, current);
    await writeAtomic(abs, u.before);
    restored++;
  }
  batch.undone = true;
  await writeAtomic(file, `${JSON.stringify(batch, null, 1)}\n`);
  const bit = (count: number, one: string) => (count === 1 ? `1 ${one}` : `${count.toLocaleString('en-AU')} ${one}s`);
  const parts = [`${bit(notes, 'note')} to the Bin`];
  if (restored) parts.push(`${bit(restored, 'note')} restored`);
  if (files) parts.push(bit(files, 'file'));
  let words = `Took back ${parts.join(', ')}.`;
  if (left.length) words += ` ${bit(left.length, 'note')} changed since stayed as you left ${left.length === 1 ? 'it' : 'them'}.`;
  if (tooBig) words += ` ${bit(tooBig, 'note')} ${tooBig === 1 ? 'was' : 'were'} too big to keep: their words before are in File recovery.`;
  return { words, notes, files, restored, left };
}

/** Ironleaf's settings that travel with a vault in an export: how it looks and works, never keys, the model chosen,
 *  this PC's folders or cards put away. */
export function travellingSettings(raw: { prefs?: unknown; dailyFolder?: unknown; dailyFormat?: unknown; dailyTemplate?: unknown }): Record<string, unknown> {
  return { prefs: raw.prefs ?? {}, dailyFolder: raw.dailyFolder, dailyFormat: raw.dailyFormat, dailyTemplate: raw.dailyTemplate };
}

// ── Bring my vault from my other PC ─────────────────────────────────────────────────────────────────────────────────
// The seam (23 Oct 2026): a chat bot's sealed link between the person's PCs (the former host app
// native-runtime/plugins/work/ bot-computers.mjs, bot-seal.mjs) carries small sealed items — the bots' settings,
// routines, memory, the PIN — through the relay's 1 MB frames, newest change wins item by item; it has no way to send a
// folder of files, resume one cut off, or check one arrived whole. Until it does, a vault goes PC to PC as an export:
// Export vault on one PC (one zip), then Import vault on the other, which merges it as above. When the link can carry
// files, the PC that has the vault sends exportVault's zip in pieces after both PCs show the same six-digit code (as
// adding a PC to a chat bot does), and the PC receiving it calls readImport + importInto on the zip it put together:
// nothing here needs to change.
