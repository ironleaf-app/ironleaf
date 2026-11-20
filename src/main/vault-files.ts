// Files done properly, the main side (Wave 4 part c, 24 Oct 2026; the rules are in src/shared/file-records.ts). Every
// way a file comes into the vault ends here: dropped or pasted into a note, added to a project, meeting or person, a
// recording, an agent's delivery, a fetch from the web, a big import that carries on after a break, or a file on this PC
// linked where it is. Each lands beside its record with its small record written (what it is for, what it says, where it
// came from, its version), a new version keeps the one before (links always reach the latest), and the move of today's
// flat Attachments folder into place runs here with a safety copy first and a check that every file and link survived.
//
// The app hands over its own ways in (src/main/app.ts): the app's move (every link brought up to date), the index's links,
// the words reader (src/main/doc-text.ts), the sensitivity rules (a file's level is read, never copied) and the assistant
// for an optional summary. The tests give simple stand-ins (tests/vault-files.test.mjs).

import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants, createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  BIG_FILE,
  MAX_IMPORT_BYTES,
  PIECE_BYTES,
  SIDECAR,
  VERSIONS_FOLDER,
  emptySidecar,
  entryKey,
  entryOf,
  filesFolderFor,
  filesFolderOf,
  isPurpose,
  kindWords,
  namedFamilies,
  parseSidecar,
  planFileMigration,
  purposeOf,
  recordCandidates,
  sizeWords,
  sourceWords,
  splitName,
  summaryFromText,
  titleFromName,
  titleFromText,
  versionFileName,
  versionPath,
  versionRows,
  whatWords,
  withFileChoices,
  withNewVersion,
  withRestored,
  writeSidecar,
  fileMigrationWords,
  mdFileTargets,
  rewriteMdFileLinks,
  type FileEntry,
  type FileMovePlan,
  type FileSource,
  type FilesSidecar,
  type MoveNote,
  type Purpose,
  type SourceHow,
  type VersionRow,
} from '../shared/file-records';
import { changeRows, type ChangeRow } from '../shared/note-diff';
import { win32Abs } from '../shared/paths';
import { checkVault, type CheckResult } from './vault-check';
import { decodeXml, zipEntries, zipRead } from './doc-text';
import { decodeUtf16be } from './utf16';
import { KeyedQueue, writeFileAtomic } from './save-guard';

/** A file as the Files views and the peek show it. */
export interface CatalogueItem {
  path: string;
  name: string;
  folder: string;
  ext: string;
  size: number;
  mtime: number;
  kind: string;
  purpose: Purpose;
  purposeChosen: boolean;
  version: number;
  older: number;
  supersededBy?: string;
  title: string;
  summary?: string;
  summaryBy?: FileEntry['summaryBy'];
  what: string;
  source?: FileSource;
  sourceWords: string;
  added?: string;
  /** The note it belongs to. */
  record?: string;
  /** Its area of life's id, when the vault is organised by area. */
  area?: string;
  level: string;
  /** A file on this PC linked where it is (not in the vault): its whole path, and whether it is still there. */
  ref?: { path: string; missing: boolean };
  /** It sits in a record's Files folder (else it is loose: the attachments folder, the top, any other folder). */
  withRecord: boolean;
}

export interface FileInfo extends CatalogueItem {
  versions: VersionRow[];
  /** The assistant may read it (for "Summarise with the assistant"), else why not. */
  assistant: { ok: true } | { ok: false; why: string };
  pages?: number;
  pagesWord?: string;
}

export interface CompareResult {
  a: { n: number; name: string; size: number; summary?: string; pages?: number };
  b: { n: number; name: string; size: number; summary?: string; pages?: number };
  /** What changed in the words (documents that can be read), else why it can't be shown. */
  rows?: ChangeRow[];
  added?: number;
  removed?: number;
  same?: boolean;
  /** Pictures: their whole paths, to show side by side. */
  pictures?: { a: string; b: string };
  note?: string;
}

export interface ImportState {
  id: string;
  name: string;
  size: number;
  received: number;
  record?: string;
  /** From a file on this PC (carries on by itself), or sent in pieces by the window (needs the file chosen again). */
  from: 'path' | 'window';
  src?: string;
  state: 'running' | 'paused' | 'failed' | 'done';
  problem?: string;
  started: number;
  rel?: string;
}

export interface MigrationResult {
  words: string;
  moved: { from: string; to: string; record?: string }[];
  stayed: { path: string; why: string }[];
  linksUpdated: number;
  problems: string[];
  safety: string | null;
  journal: string | null;
  check: { files: number; filesOk: number; links: number; linksOk: number; broken: string[] };
}

export interface VaultFilesHost {
  root(): string | null;
  /** Every file in the vault, as the vault lists them (dot folders left out). */
  listAll(): Promise<{ rel: string; mtime: number; size: number }[]>;
  /** The notes' links and properties, as the index has them. */
  notes(): { path: string; props?: Record<string, unknown>; links: { target: string }[] }[];
  resolve(target: string, from: string): string | null;
  /** A note's words. */
  readNote(rel: string): Promise<string>;
  /** A note written (and indexed), as the app writes one. */
  writeNote?(rel: string, text: string): Promise<void>;
  /** The app's own move (links that reach it rewritten). */
  movePath(from: string, to: string, updateLinks: boolean): Promise<{ path: string; linksUpdated: number }>;
  /** Files written: indexed and shown. */
  added(rels: string[]): Promise<void>;
  /** Ironleaf's own data (unfinished imports live here). */
  dataDir: string;
  /** A file's words (src/main/doc-text.ts readFileText). */
  readText?(abs: string, ext: string, size: number): Promise<{ state: string; text?: string }>;
  /** A path's sensitivity level, and whether the side chat may read it. */
  level?(rel: string): string;
  assistantMay?(rel: string): { ok: true } | { ok: false; why: string };
  askJson?(system: string, user: string, timeoutMs: number, maxTokens: number): Promise<unknown>;
  /** Files' levels follow a move (the vault's sensitivity file). */
  levelsMoved?(pairs: [string, string][]): Promise<void>;
  /** Settings › Files and links. */
  prefs(): { attachmentsFolder: string; templatesFolder?: string; dailyFolder?: string; filesWithRecord?: boolean };
  setFilesWithRecord?(on: boolean): Promise<void>;
  /** An area's id for a path (null: the vault isn't organised by area). */
  areaOf?(rel: string): string | undefined;
  /** Each area's own Files folder ("Family/Files"), when the vault is organised by area. */
  areaFilesFolders?(): string[];
  /** A big import's progress, for the window. */
  progress?(state: ImportState): void;
  writeZip?(dest: string, sources: { name: string; abs: string; mtime?: number }[]): Promise<unknown>;
  /** The open vault's identity, for this PC's own record of its linked files ('' or absent: its folder is used). */
  vaultKey?(): Promise<string>;
  now?(): Date;
  log?(m: string): void;
}

// ── Files linked where they are: this PC's own record ──────────────────────────────────────────────────────────────
// (security review, 20 Nov 2026) A linked file's whole path used to live in the vault's .files.json, which anyone who
// shares or syncs the vault can write: a path naming \\host\share made the very stat send this PC's sign-in (an NTLM
// hash) to that host, and Open handed whatever file it named to the shell, a program included. Now the path is kept in
// Ironleaf's own data on this PC (linked-files.json, per vault), the vault's file keeps only the link's id, and a path
// that arrives in the vault's file is never followed. Links this PC made before are taken over once, the first time the
// vault is read here with this version.

/** A path that reaches another computer or a device (\\host\share, //host/share, \\?\…, \\.\…): never touched. */
export const isNetworkPath = (p: string): boolean => /^[\\/]{2}/.test(p);

/** A path this PC's links may hold: whole, on this PC (a drive letter on Windows), never a share or a device. */
export function linkablePath(p: unknown, platform: NodeJS.Platform = process.platform): p is string {
  if (typeof p !== 'string' || !p || p.length > 1000 || p.includes('\0') || isNetworkPath(p)) return false;
  return platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(p) : p.startsWith('/');
}

/** Kinds of file that run something when opened: a linked one is shown in its folder, never opened by the shell. */
const RUNS_WHEN_OPENED = /\.(exe|msi|msix|msixbundle|msp|mst|appx|appxbundle|scr|com|bat|cmd|lnk|url|pif|hta|vbs|vbe|js|jse|mjs|cjs|wsf|wsh|ws|wsc|reg|dll|cpl|inf|ins|isp|scf|msc|jar|ps1|psm1|psd1|ps1xml|psc1|application|appref-ms|gadget|settingcontent-ms|library-ms|search-ms|searchconnector-ms|xbap|chm|sh|bash|zsh|ksh|csh|fish|command|tool|desktop|appimage|run|bin|py|pyw|pyz|pl|rb|php|app|deb|rpm|pkg|dmg|apk|elf|out|terminal|workflow)$/i;

/** True when opening the file would run something: its kind, or (Linux, macOS) a file marked as a program. */
export function runsWhenOpened(p: string, mode = 0, platform: NodeJS.Platform = process.platform): boolean {
  if (RUNS_WHEN_OPENED.test(p)) return true;
  return platform !== 'win32' && (mode & 0o111) !== 0;
}

export const RUNS_WORDS = 'That file runs a program when it is opened, so Ironleaf doesn’t open it. Use Show in folder to see it where it is.';

interface LinkedRec {
  path: string;
  size: number;
  mtime: number;
}
interface LinkedVault {
  /** Links this PC made before the record moved here were taken over (once). */
  migrated?: boolean;
  links: Record<string, LinkedRec>;
  /** Paths of links written by an earlier version, taken over from this PC's own vault files when first read here. */
  legacy: string[];
}

/** linked-files.json in Ironleaf's own data: each vault's links (by id) to files where they are on this PC. */
export class LinkedRefs {
  private data: { version: 1; vaults: Record<string, LinkedVault> } | null = null;
  private loading: Promise<void> | null = null;
  private writes = new KeyedQueue();

  constructor(readonly file: string) {}

  private load(): Promise<void> {
    this.loading ??= (async () => {
      const out: { version: 1; vaults: Record<string, LinkedVault> } = { version: 1, vaults: {} };
      try {
        const raw = JSON.parse(await fsp.readFile(this.file, 'utf8')) as { vaults?: Record<string, Partial<LinkedVault>> };
        for (const [key, v] of Object.entries(raw?.vaults ?? {})) {
          if (!v || typeof v !== 'object') continue;
          const links: Record<string, LinkedRec> = {};
          for (const [id, r] of Object.entries(v.links ?? {})) if (r && linkablePath(r.path)) links[id] = { path: r.path, size: Number(r.size) || 0, mtime: Number(r.mtime) || 0 };
          out.vaults[key] = { ...(v.migrated ? { migrated: true } : {}), links, legacy: Array.isArray(v.legacy) ? v.legacy.filter((p): p is string => linkablePath(p)) : [] };
        }
      } catch {
        // None yet, or not readable: nothing linked on this PC.
      }
      this.data = out;
    })();
    return this.loading;
  }

  async vault(key: string): Promise<LinkedVault> {
    await this.load();
    return (this.data!.vaults[key] ??= { links: {}, legacy: [] });
  }

  async put(key: string, id: string, rec: LinkedRec): Promise<void> {
    const v = await this.vault(key);
    const was = v.links[id];
    if (was && was.path === rec.path && was.size === rec.size && was.mtime === rec.mtime) return;
    v.links[id] = { path: rec.path, size: rec.size, mtime: rec.mtime };
    await this.save();
  }

  async drop(key: string, id: string): Promise<void> {
    const v = await this.vault(key);
    if (!v.links[id]) return;
    delete v.links[id];
    await this.save();
  }

  async markMigrated(key: string, legacy: string[]): Promise<void> {
    const v = await this.vault(key);
    v.migrated = true;
    v.legacy = [...new Set([...v.legacy, ...legacy.filter((p) => linkablePath(p))])];
    await this.save();
  }

  private save(): Promise<void> {
    return this.writes.run(this.file, async () => {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      await writeFileAtomic(this.file, JSON.stringify(this.data, null, 2));
    });
  }
}

const MIGRATIONS = '.neuralvault/migrations';
const SAFETY = '.neuralvault/safety';
const pad = (n: number) => String(n).padStart(2, '0');
const stampOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.split('/').pop() ?? p;
const extOf = (name: string) => (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] ?? '').toLowerCase();
const isNotePath = (p: string) => /\.(md|canvas)$/i.test(p);

/** The whole paths an earlier version wrote into a vault file for its linked files (ref.path), by entry. Read only
 *  to take over this PC's own links once (VaultFiles.ensureMigrated); never followed as they are. */
function legacyRefPathsByName(text: string | null): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const raw = JSON.parse(text ?? '') as { files?: Record<string, { name?: unknown; ref?: { path?: unknown; id?: unknown } }> };
    for (const [k, e] of Object.entries(raw?.files ?? {})) {
      const p = e?.ref?.path;
      if (typeof p === 'string' && p && e?.ref?.id === undefined) out.set(entryKey(typeof e.name === 'string' ? e.name : k), p);
    }
  } catch {}
  return out;
}
const legacyRefPaths = (text: string | null): string[] => [...legacyRefPathsByName(text).values()];
const NEVER = /\.(exe|msi|msix|appx|scr|com|bat|cmd|lnk|url|pif|hta|vbs|vbe|jse?|wsf|wsh|reg|dll|cpl|inf|scf|msc|jar|ps1|psm1)$/i;

/** SHA-256 of a file, streamed. */
export function sha256Of(abs: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(abs)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

async function writeAtomic(abs: string, data: string | Uint8Array): Promise<void> {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const temp = `${abs}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  await fsp.writeFile(temp, data);
  await fsp.rename(temp, abs);
}

/** A name nothing in the folder has: "Survey.xlsx" → "Survey (2).xlsx". */
function freeIn(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  const { stem, ext } = splitName(name);
  const bare = stem.replace(/ \((\d+)\)$/, '');
  for (let n = 2; n < 10000; n++) {
    const next = `${bare} (${n})${ext}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  throw new Error('Too many files of that name are there already. Choose another name.');
}

/** A name Windows takes for a file (its last part, nothing it refuses), with its kind kept. */
export function cleanName(raw: unknown, fallback = 'File'): string {
  const name = String(raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  const out = name.slice(0, 180) || fallback;
  if (NEVER.test(out)) throw new Error(`A .${extOf(out)} file runs when it is opened, so it isn’t kept in the vault. Zip it first if you need to keep it.`);
  return out;
}

export class VaultFiles {
  private queues = new Map<string, Promise<unknown>>();
  private imports = new Map<string, ImportState & { meta: ImportMeta }>();
  private importsLoaded = false;
  private describing = new Set<string>();
  /** Files whose "what is this" was read this session (a file another app put beside its note is read when first shown). */
  private describedOnce = new Set<string>();

  /** Where this PC's linked files are (linked-files.json in Ironleaf's own data). */
  readonly links: LinkedRefs;
  private migrations = new Map<string, Promise<void>>();

  constructor(private host: VaultFilesHost) {
    this.links = new LinkedRefs(path.join(host.dataDir, 'linked-files.json'));
  }

  /** The open vault's key in this PC's record of linked files: its identity, else its folder. */
  private keyFor: { root: string; key: Promise<string> } | null = null;
  private vaultKey(): Promise<string> {
    const root = this.requireRoot();
    if (this.keyFor?.root !== root) {
      const key = (async () => {
        const given = await this.host.vaultKey?.().catch(() => '');
        if (given) return given;
        const real = await fsp.realpath(root).catch(() => root);
        return `path:${process.platform === 'win32' || process.platform === 'darwin' ? real.toLowerCase() : real}`;
      })();
      this.keyFor = { root, key };
    }
    return this.keyFor.key;
  }

  /** The first read of this vault's linked files on this PC with this version: the links written into the vault's files
   *  before (a whole path on this PC, never a share) are taken over as this PC's own; after that a path in a vault file
   *  is never followed. */
  private ensureMigrated(key: string): Promise<void> {
    let run = this.migrations.get(key);
    if (!run) {
      run = (async () => {
        const v = await this.links.vault(key);
        if (v.migrated) return;
        const legacy: string[] = [];
        for (const folder of await this.sidecarFolders().catch(() => [] as string[])) {
          const text = await fsp.readFile(this.abs(folder ? `${folder}/${SIDECAR}` : SIDECAR), 'utf8').catch(() => null);
          // Only whole paths on this PC (a share is never taken over); one that has moved since is still this PC's
          // link, so the check can find it again.
          for (const p of legacyRefPaths(text)) if (linkablePath(p)) legacy.push(p);
        }
        await this.links.markMigrated(key, legacy);
      })();
      this.migrations.set(key, run);
      run.catch(() => this.migrations.delete(key));
    }
    return run;
  }

  /** A linked file's details on this PC, or null (not linked here, gone, or a path that would reach a share). */
  private async refStat(p: string): Promise<import('node:fs').Stats | null> {
    if (!linkablePath(p)) return null;
    return fsp.stat(p).then((s) => (s.isFile() ? s : null), () => null);
  }

  private now(): Date {
    return this.host.now?.() ?? new Date();
  }

  private requireRoot(): string {
    const r = this.host.root();
    if (!r) throw new Error('Ironleaf’s notes are not open yet.');
    return r;
  }

  /** A vault path as a whole path (its own dot names allowed: the record and older versions), never outside the vault. */
  abs(rel: string): string {
    const root = this.requireRoot();
    const clean = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    const segs = clean.split('/');
    if (!clean || segs.some((s) => !s || s === '.' || s === '..' || (s.startsWith('.') && s !== SIDECAR && s !== VERSIONS_FOLDER && s !== '.neuralvault'))) throw new Error('That isn’t a file in this vault.');
    if (segs[0].toLowerCase() === '.neuralvault' && !/^\.neuralvault\/(migrations|safety)\//i.test(clean)) throw new Error('That isn’t a file in this vault.');
    const abs = path.resolve(root, ...segs);
    const inside = path.relative(root, abs);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('That isn’t a file in this vault.');
    return win32Abs(abs, process.platform);
  }

  /** A path the window or an agent sent, as a vault path of a file (not a note, nothing hidden). */
  fileRel(raw: unknown): string {
    if (typeof raw !== 'string') throw new Error('Which file?');
    const rel = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!rel || rel.split('/').some((s) => !s || s === '..' || s.startsWith('.'))) throw new Error('That isn’t a file in this vault.');
    return rel;
  }

  /** One writer at a time per Files folder. */
  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.queues.set(
      key,
      run.catch(() => {}),
    );
    return run;
  }

  // ── The record beside the files ──

  async readSidecar(folder: string): Promise<FilesSidecar> {
    const text = await fsp.readFile(this.abs(folder ? `${folder}/${SIDECAR}` : SIDECAR), 'utf8').catch(() => null);
    const s = parseSidecar(text);
    // The first read of the vault on this PC takes over its earlier links, whatever folder that read is for (so a link
    // written into a vault file later is never mistaken for one of them).
    const key = await this.vaultKey();
    await this.ensureMigrated(key).catch(() => {});
    const linked = Object.values(s.files).filter((e) => e.ref);
    if (!linked.length) return s;
    // A linked file's path comes from this PC's own record, never from the vault's file (parseSidecar leaves it out).
    const v = await this.links.vault(key);
    const legacy = linked.some((e) => !e.ref!.id) ? legacyRefPathsByName(text) : null;
    for (const e of linked) {
      const ref = e.ref!;
      if (ref.id) {
        const rec = v.links[ref.id];
        if (rec) e.ref = { ...ref, path: rec.path };
        continue;
      }
      // Written by an earlier version: followed only when this PC took that very path over as its own.
      const p = legacy?.get(entryKey(e.name));
      if (p && v.legacy.includes(p)) e.ref = { ...ref, path: p };
    }
    return s;
  }

  /** Each linked file this PC knows the place of is kept in its own record by id (an id given to a new link); the
   *  vault's file is then written with the id only (writeSidecar). */
  private async keepLinks(s: FilesSidecar): Promise<void> {
    let key: string | null = null;
    for (const e of Object.values(s.files)) {
      if (!e.ref?.path) continue;
      if (!linkablePath(e.ref.path)) {
        e.ref = { ...e.ref, path: '' };
        continue;
      }
      e.ref.id ??= `l${randomBytes(9).toString('base64url')}`;
      key ??= await this.vaultKey();
      await this.links.put(key, e.ref.id, { path: e.ref.path, size: e.ref.size, mtime: e.ref.mtime });
    }
  }

  /** Changes one folder's record (read, change, write: one writer at a time). */
  async changeSidecar(folder: string, fn: (s: FilesSidecar) => void | Promise<void>): Promise<FilesSidecar> {
    return this.serial(folder.toLowerCase(), async () => {
      const s = await this.readSidecar(folder);
      const before = writeSidecar(s);
      await fn(s);
      await this.keepLinks(s);
      const after = writeSidecar(s);
      const file = this.abs(folder ? `${folder}/${SIDECAR}` : SIDECAR);
      if (!Object.keys(s.files).length) await fsp.rm(file, { force: true });
      else if (after !== before) await writeAtomic(file, after);
      return s;
    });
  }

  async entry(rel: string): Promise<FileEntry | undefined> {
    return entryOf(await this.readSidecar(folderOf(rel)), baseOf(rel));
  }

  /** Where a note's files go now: beside it (Settings › Files and links says "beside the note"), else the one folder. */
  folderFor(noteRel: string): string {
    const p = this.host.prefs();
    if (p.filesWithRecord !== false && noteRel && isNotePath(noteRel)) return filesFolderFor(noteRel);
    const setting = (p.attachmentsFolder ?? '').replace(/^\/+|\/+$/g, '');
    if (setting.startsWith('./')) return [folderOf(noteRel), setting.slice(2)].filter(Boolean).join('/');
    return setting;
  }

  /** The note a file belongs to: its record's own word, else the note beside its Files folder. */
  private async recordOf(rel: string, entry?: FileEntry): Promise<string | undefined> {
    if (entry?.record) return entry.record;
    for (const c of recordCandidates(rel)) {
      if (await fsp.stat(this.abs(c)).then((s) => s.isFile(), () => false)) return c;
    }
    return undefined;
  }

  // ── What a file is ──

  /** Type, pages, title and one line on what it says, read here from the file (nothing sent anywhere). */
  async whatIsThis(abs: string, name: string, size: number): Promise<Pick<FileEntry, 'kind' | 'pages' | 'pagesWord' | 'title' | 'summary' | 'summaryBy'>> {
    const ext = extOf(name);
    const out: Pick<FileEntry, 'kind' | 'pages' | 'pagesWord' | 'title' | 'summary' | 'summaryBy'> = { kind: kindWords(name) };
    let text = '';
    try {
      if (this.host.readText && size <= 120 * 1024 * 1024) {
        const r = await this.host.readText(abs, ext, size);
        if (r.text) text = r.text;
      }
    } catch {
      // Unreadable: the name says what it is.
    }
    // Pages, slides and sheets.
    if (ext === 'pdf') {
      const pages = await pdfPageCount(abs, size).catch(() => null);
      const marks = (text.match(/\fpage \d+/g) ?? []).length;
      const n = pages ?? (marks || null);
      if (n) {
        out.pages = n;
        out.pagesWord = 'pages';
      }
      const t = await pdfTitle(abs, size).catch(() => null);
      if (t) out.title = t;
    } else if (/^(pptx?|pptm|potx|ppsx|odp)$/.test(ext)) {
      const n = (text.match(/\fslide \d+/g) ?? []).length;
      if (n) {
        out.pages = n;
        out.pagesWord = 'slides';
      }
    } else if (/^(xlsx?|xlsm|xltx|ods)$/.test(ext)) {
      const n = (text.match(/\f[^\n]+/g) ?? []).length;
      if (n) {
        out.pages = n;
        out.pagesWord = 'sheets';
      }
    }
    if (/^(docx|docm|dotx|xlsx|xlsm|xltx|pptx|pptm|potx|ppsx)$/.test(ext) && size <= 80 * 1024 * 1024) {
      const props = await officeProps(abs).catch(() => null);
      if (props?.title) out.title = props.title;
      if (props?.pages && /^doc/.test(ext)) {
        out.pages = props.pages;
        out.pagesWord = 'pages';
      }
    }
    if (!out.title && text && !/^(xlsx?|xlsm|xltx|ods|csv|tsv)$/.test(ext)) {
      const t = titleFromText(text);
      if (t) out.title = t;
    }
    const s = text ? summaryFromText(text, name) : undefined;
    if (s && s !== out.title) {
      out.summary = s;
      out.summaryBy = 'file';
    }
    return out;
  }

  /** A file's record written (or brought up to date) after it lands: what it is, where from, its record. */
  async recordAdded(rel: string, o: { source: FileSource; record?: string; purpose?: Purpose; what?: string; describe?: 'now' | 'later' } = { source: { by: 'you', how: 'added', at: new Date().toISOString() } }): Promise<FileEntry> {
    const abs = this.abs(rel);
    const st = await fsp.stat(abs);
    const name = baseOf(rel);
    const folder = folderOf(rel);
    const record = o.record && isNotePath(o.record) ? o.record : await this.recordOf(rel);
    const s = await this.changeSidecar(folder, (s) => {
      const had = entryOf(s, name);
      const e: FileEntry = had ? { ...had } : { name, version: 1, versions: [] };
      e.name = name;
      e.size = st.size;
      e.added = o.source.at;
      e.source = o.source;
      if (record) e.record = record;
      if (o.purpose) e.purpose = o.purpose;
      if (o.what) {
        e.summary = o.what;
        e.summaryBy = o.source.how === 'agent' || o.source.how === 'url' || o.source.how === 'upload' ? 'agent' : 'you';
      }
      e.kind = kindWords(name);
      s.files[entryKey(name)] = e;
    });
    const e = entryOf(s, name)!;
    if (o.describe === 'later') void this.describe(rel).catch(() => {});
    else await this.describe(rel);
    return (await this.entry(rel)) ?? e;
  }

  /** Reads what a file is and keeps it in its record (a summary the person or an agent wrote is kept). */
  async describe(rel: string): Promise<void> {
    if (this.describing.has(rel)) return;
    this.describing.add(rel);
    try {
      const abs = this.abs(rel);
      const st = await fsp.stat(abs);
      const meta = await this.whatIsThis(abs, baseOf(rel), st.size);
      const sha = st.size <= 1024 * 1024 * 1024 ? await sha256Of(abs).catch(() => undefined) : undefined;
      await this.changeSidecar(folderOf(rel), (s) => {
        const e = entryOf(s, baseOf(rel)) ?? { name: baseOf(rel), version: 1, versions: [] };
        const keepSummary = e.summary && e.summaryBy && e.summaryBy !== 'file';
        Object.assign(e, { kind: meta.kind, size: st.size, ...(sha ? { sha256: sha } : {}) });
        if (meta.pages) {
          e.pages = meta.pages;
          e.pagesWord = meta.pagesWord;
        }
        if (meta.title) e.title = meta.title;
        if (!keepSummary) {
          if (meta.summary) {
            e.summary = meta.summary;
            e.summaryBy = 'file';
          } else {
            delete e.summary;
            delete e.summaryBy;
          }
        }
        s.files[entryKey(e.name)] = e;
      });
    } finally {
      this.describing.delete(rel);
    }
  }

  // ── Adding files ──

  /**
   * A file put beside its record: copied (or moved) from a whole path, its record written. A file of that name already
   * there becomes a new version when `same` is 'version' (the one before kept), else this one gets a free name.
   */
  async place(o: { record?: string; folder?: string; src: string; name?: string; move?: boolean; source: FileSource; same?: 'version' | 'both'; purpose?: Purpose; what?: string; describe?: 'now' | 'later' }): Promise<{ rel: string; version: number; renamed: boolean }> {
    const folder = o.folder !== undefined ? o.folder.replace(/^\/+|\/+$/g, '') : this.folderFor(o.record ?? '');
    const name = cleanName(o.name ?? path.basename(o.src));
    const dirAbs = folder ? this.abs(folder) : this.requireRoot();
    await fsp.mkdir(dirAbs, { recursive: true });
    const st = await fsp.stat(o.src);
    if (!st.isFile()) throw new Error('That isn’t a file.');
    if (st.size > MAX_IMPORT_BYTES) throw new Error(`That file is ${sizeWords(st.size)}; at most ${sizeWords(MAX_IMPORT_BYTES)} go into the vault.`);
    const taken = new Set((await fsp.readdir(dirAbs).catch(() => [] as string[])).map((n) => n.toLowerCase()));
    if (o.same === 'version' && taken.has(name.toLowerCase())) {
      const rel = folder ? `${folder}/${name}` : name;
      const v = await this.addVersion(rel, o.src, { source: { ...o.source, how: o.source.how === 'added' ? 'version' : o.source.how }, move: o.move });
      return { rel, version: v.version, renamed: false };
    }
    const chosen = freeIn(name, taken);
    const rel = folder ? `${folder}/${chosen}` : chosen;
    const dest = this.abs(rel);
    await putFile(o.src, dest, !!o.move);
    await this.host.added([rel]);
    const e = await this.recordAdded(rel, { source: o.source, ...(o.record ? { record: o.record } : {}), ...(o.purpose ? { purpose: o.purpose } : {}), ...(o.what ? { what: o.what } : {}), describe: o.describe ?? (st.size > 40 * 1024 * 1024 ? 'later' : 'now') });
    return { rel, version: e.version, renamed: chosen !== name };
  }

  /** Bytes from the window (a pasted picture, a dropped file with no place on the PC) put beside their record. */
  async placeBytes(o: { record?: string; folder?: string; name: string; bytes: Uint8Array; source: FileSource; same?: 'version' | 'both'; purpose?: Purpose }): Promise<{ rel: string; version: number; renamed: boolean }> {
    const temp = path.join(this.host.dataDir, 'file-imports', `bytes-${randomBytes(9).toString('base64url')}.part`);
    await fsp.mkdir(path.dirname(temp), { recursive: true });
    await fsp.writeFile(temp, o.bytes);
    try {
      return await this.place({ ...o, src: temp, move: true });
    } finally {
      await fsp.rm(temp, { force: true }).catch(() => {});
    }
  }

  /** A file on this PC linked where it is: nothing copied, its record beside the note says where it is. */
  async reference(o: { record: string; path: string; by?: string; what?: string; purpose?: Purpose }): Promise<{ name: string; folder: string }> {
    if (!path.isAbsolute(o.path)) throw new Error('Give the file’s whole path on this PC, such as C:\\Users\\…\\Survey.xlsx.');
    // A share (\\host\…) is never even looked at: reaching it sends this PC's sign-in to that host.
    if (!linkablePath(o.path)) throw new Error('Only a file on this PC can be linked where it is. Copy a file from a shared folder into the note instead.');
    const real = await fsp.realpath(o.path).catch(() => null);
    if (!real) throw new Error(`There is no file at ${o.path}.`);
    if (!linkablePath(real)) throw new Error('Only a file on this PC can be linked where it is. Copy a file from a shared folder into the note instead.');
    const st = await fsp.stat(real);
    if (!st.isFile()) throw new Error(`${o.path} isn’t a file.`);
    const root = this.requireRoot();
    const inside = path.relative(root, real);
    if (inside && !inside.startsWith('..') && !path.isAbsolute(inside)) throw new Error('That file is in the vault already; link to it from the note instead.');
    if (!isNotePath(o.record)) throw new Error('Which note is it for?');
    const folder = filesFolderFor(o.record);
    const at = this.now().toISOString();
    let name = cleanName(path.basename(real));
    await this.changeSidecar(folder, async (s) => {
      // The same file linked again: its record brought up to date. Another file of that name: "(linked)" after it.
      const had = entryOf(s, name);
      if (had && !(had.ref && had.ref.path === real)) {
        const taken = new Set([...Object.values(s.files).map((e) => e.name.toLowerCase()), ...(await fsp.readdir(this.abs(folder)).catch(() => [] as string[])).map((n) => n.toLowerCase())]);
        name = freeIn(name, taken);
      }
      const e: FileEntry = { ...(entryOf(s, name) ?? { name, version: 1, versions: [] }), name, record: o.record, kind: kindWords(name), size: st.size, added: at, source: { by: o.by ?? 'you', how: 'reference', from: real, at }, ref: { path: real, size: st.size, mtime: st.mtimeMs } };
      if (o.what) {
        e.summary = o.what;
        e.summaryBy = o.by && o.by !== 'you' ? 'agent' : 'you';
      }
      if (o.purpose) e.purpose = o.purpose;
      s.files[entryKey(name)] = e;
    });
    // What it is, read where it is (the file stays on the PC).
    void this.whatIsThis(real, name, st.size).then(
      (meta) =>
        this.changeSidecar(folder, (s) => {
          const e = entryOf(s, name);
          if (!e) return;
          if (meta.title) e.title = meta.title;
          if (meta.pages) Object.assign(e, { pages: meta.pages, pagesWord: meta.pagesWord });
          if (meta.summary && !(e.summaryBy && e.summaryBy !== 'file')) Object.assign(e, { summary: meta.summary, summaryBy: 'file' });
        }),
      () => undefined,
    );
    await this.host.added([]);
    return { name, folder };
  }

  /** The whole path of a file linked where it is on this PC (to open it). */
  async referencePath(folder: string, name: string): Promise<string> {
    const e = entryOf(await this.readSidecar(folder), name);
    if (!e?.ref) throw new Error('That link to a file on this PC isn’t there any more.');
    if (!e.ref.path) throw new Error('That file was linked on another PC; it isn’t linked on this one.');
    const ok = await this.refStat(e.ref.path);
    if (!ok) throw new Error(`${e.ref.path} isn’t on this PC any more (moved, renamed or deleted).`);
    return e.ref.path;
  }

  /** The linked file to open, or an error when opening it would run something (Show in folder is offered instead). */
  async referenceToOpen(folder: string, name: string): Promise<string> {
    const p = await this.referencePath(folder, name);
    const st = await this.refStat(p);
    if (!st || runsWhenOpened(p, st.mode)) throw new Error(RUNS_WORDS);
    return p;
  }

  async forgetReference(folder: string, name: string): Promise<void> {
    let id: string | undefined;
    await this.changeSidecar(folder, (s) => {
      const e = entryOf(s, name);
      if (e?.ref) {
        id = e.ref.id;
        delete s.files[entryKey(name)];
      }
    });
    if (id) await this.links.drop(await this.vaultKey(), id);
    await this.host.added([]);
  }

  // ── Versions ──

  /** A newer version of a file: the one there now kept in `.versions` (v1, v2…), the new one where links reach. */
  async addVersion(rel: string, src: string, o: { source: FileSource; move?: boolean }): Promise<FileEntry> {
    const abs = this.abs(rel);
    const cur = await fsp.stat(abs).catch(() => null);
    if (!cur?.isFile()) throw new Error('That file isn’t there any more.');
    const folder = folderOf(rel);
    let out: FileEntry | undefined;
    await this.changeSidecar(folder, async (s) => {
      const had = entryOf(s, baseOf(rel)) ?? { name: baseOf(rel), version: 1, versions: [], size: cur.size };
      const sha = had.sha256 ?? (cur.size <= 1024 * 1024 * 1024 ? await sha256Of(abs).catch(() => undefined) : undefined);
      const keptAt = this.abs(versionPath(rel, had.version));
      await fsp.mkdir(path.dirname(keptAt), { recursive: true });
      if (await fsp.stat(keptAt).catch(() => null)) throw new Error('An older version with that number is there already; nothing was changed.');
      await fsp.rename(abs, keptAt);
      try {
        await putFile(src, abs, !!o.move);
      } catch (err) {
        await fsp.rename(keptAt, abs).catch(() => {});
        throw err;
      }
      const st = await fsp.stat(abs);
      const next = withNewVersion(had, { size: cur.size, ...(sha ? { sha256: sha } : {}) }, { size: st.size, source: o.source });
      s.files[entryKey(next.name)] = next;
      out = next;
    });
    await this.host.added([rel]);
    await this.describe(rel).catch(() => {});
    return (await this.entry(rel)) ?? out!;
  }

  /** An older version brought back as the latest; the one it replaces kept, so nothing is lost. */
  async restore(rel: string, n: number): Promise<FileEntry> {
    const abs = this.abs(rel);
    const folder = folderOf(rel);
    const cur = await fsp.stat(abs).catch(() => null);
    if (!cur?.isFile()) throw new Error('That file isn’t there any more.');
    let out: FileEntry | undefined;
    await this.changeSidecar(folder, async (s) => {
      const e = entryOf(s, baseOf(rel));
      if (!e) throw new Error('That file has no older versions kept.');
      const at = this.now().toISOString();
      const sha = e.sha256 ?? (await sha256Of(abs).catch(() => undefined));
      const r = withRestored(e, n, at, { size: cur.size, ...(sha ? { sha256: sha } : {}) });
      if (!r) throw new Error(`Version ${n} isn’t kept any more.`);
      const fromAbs = this.abs(versionPath(rel, r.from.n));
      if (!(await fsp.stat(fromAbs).catch(() => null))) throw new Error(`Version ${n}’s file isn’t in .versions any more.`);
      const keepAbs = this.abs(versionPath(rel, r.keepAs.n));
      if (await fsp.stat(keepAbs).catch(() => null)) throw new Error('An older version with that number is there already; nothing was changed.');
      await fsp.rename(abs, keepAbs);
      try {
        await fsp.copyFile(fromAbs, abs, fsConstants.COPYFILE_EXCL);
      } catch (err) {
        await fsp.rename(keepAbs, abs).catch(() => {});
        throw err;
      }
      s.files[entryKey(r.entry.name)] = r.entry;
      out = r.entry;
    });
    await this.host.added([rel]);
    await this.describe(rel).catch(() => {});
    return (await this.entry(rel)) ?? out!;
  }

  /** Two versions side by side: what changed in their words, or the two pictures. */
  async compare(rel: string, a: number, b: number): Promise<CompareResult> {
    const rows = await this.versions(rel);
    const ra = rows.find((r) => r.n === a);
    const rb = rows.find((r) => r.n === b);
    if (!ra || !rb) throw new Error('Choose two versions that are kept.');
    const absA = this.abs(ra.path);
    const absB = this.abs(rb.path);
    const [sa, sb] = await Promise.all([fsp.stat(absA), fsp.stat(absB)]);
    const [ma, mb] = await Promise.all([this.whatIsThis(absA, ra.name, sa.size), this.whatIsThis(absB, rb.name, sb.size)]);
    const out: CompareResult = {
      a: { n: a, name: ra.name, size: sa.size, ...(ma.summary ? { summary: ma.summary } : {}), ...(ma.pages ? { pages: ma.pages } : {}) },
      b: { n: b, name: rb.name, size: sb.size, ...(mb.summary ? { summary: mb.summary } : {}), ...(mb.pages ? { pages: mb.pages } : {}) },
    };
    if (/^(png|jpe?g|gif|webp|bmp|avif|svg)$/.test(extOf(ra.name))) {
      out.pictures = { a: absA, b: absB };
      return out;
    }
    const read = async (abs: string, name: string, size: number) => (this.host.readText ? (await this.host.readText(abs, extOf(name), size).catch(() => ({ state: 'failed' }) as { state: string; text?: string })).text : undefined);
    const [ta, tb] = await Promise.all([read(absA, ra.name, sa.size), read(absB, rb.name, sb.size)]);
    if (ta === undefined || tb === undefined) {
      out.note = `${kindWords(ra.name)}s can’t be compared word by word here. Open each version to look at them.`;
      return out;
    }
    const norm = (t: string) => t.replace(/\f(page|slide) (\d+)/g, '— $1 $2 —').replace(/\f([^\n]+)/g, '— Sheet: $1 —').replace(/\r/g, '');
    const A = norm(ta);
    const B = norm(tb);
    out.same = A === B;
    out.rows = changeRows(A.slice(0, 400_000), B.slice(0, 400_000), 2).slice(0, 600);
    let added = 0;
    let removed = 0;
    for (const r of out.rows) {
      if (r.kind === 'add') added++;
      else if (r.kind === 'del') removed++;
    }
    out.added = added;
    out.removed = removed;
    return out;
  }

  async versions(rel: string): Promise<VersionRow[]> {
    const s = await this.readSidecar(folderOf(rel));
    return versionRows(rel, entryOf(s, baseOf(rel)), Object.values(s.files));
  }

  // ── What the window shows ──

  /** Changes the person makes in a file's details: what it is for, its title, its line, its record. */
  async set(rel: string, patch: { purpose?: string | null; title?: string | null; summary?: string | null; record?: string | null }): Promise<FileInfo> {
    const abs = this.abs(rel);
    if (!(await fsp.stat(abs).catch(() => null))) throw new Error('That file isn’t there any more.');
    await this.changeSidecar(folderOf(rel), (s) => {
      const e = entryOf(s, baseOf(rel)) ?? { name: baseOf(rel), version: 1, versions: [] };
      if (patch.purpose !== undefined) {
        if (patch.purpose === null) delete e.purpose;
        else if (isPurpose(patch.purpose)) e.purpose = patch.purpose;
        else throw new Error('That isn’t one of the purposes.');
      }
      if (patch.title !== undefined) {
        const t = (patch.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (t) e.title = t;
        else delete e.title;
      }
      if (patch.summary !== undefined) {
        const t = (patch.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
        if (t) {
          e.summary = t;
          e.summaryBy = 'you';
        } else {
          delete e.summary;
          delete e.summaryBy;
        }
      }
      if (patch.record !== undefined) {
        if (patch.record && isNotePath(patch.record)) e.record = patch.record;
        else delete e.record;
      }
      s.files[entryKey(e.name)] = e;
    });
    return this.info(rel);
  }

  /** "Summarise with the assistant": only for a file the side chat may read (its level), never otherwise. */
  async summarise(rel: string): Promise<FileInfo> {
    const may = this.host.assistantMay?.(rel) ?? { ok: false as const, why: 'The assistant isn’t available here.' };
    if (!may.ok) throw new Error(may.why);
    if (!this.host.askJson || !this.host.readText) throw new Error('The assistant isn’t available here. Set up a model in Settings › AI.');
    const abs = this.abs(rel);
    const st = await fsp.stat(abs);
    const r = await this.host.readText(abs, extOf(rel), st.size).catch(() => ({ state: 'failed' }) as { state: string; text?: string });
    if (!r.text?.trim()) throw new Error('There are no words in it to summarise (a picture or a scan has none here).');
    const words = r.text.replace(/\f(page|slide) (\d+)/g, '\n[$1 $2]\n').slice(0, 14_000);
    const answer = (await this.host.askJson(
      'You write one plain sentence (at most 30 words) saying what a file is and what it says, for a list of files. Australian English, no marketing words, no "This document". Answer as JSON: {"summary": "…"}.',
      `File name: ${baseOf(rel)}\n\nIts words:\n${words}`,
      45_000,
      200,
    )) as { summary?: unknown } | null;
    const summary = typeof answer?.summary === 'string' ? answer.summary.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    if (!summary) throw new Error('The assistant didn’t give a summary. Try again in a moment.');
    await this.changeSidecar(folderOf(rel), (s) => {
      const e = entryOf(s, baseOf(rel)) ?? { name: baseOf(rel), version: 1, versions: [] };
      e.summary = summary;
      e.summaryBy = 'assistant';
      s.files[entryKey(e.name)] = e;
    });
    return this.info(rel);
  }

  private item(rel: string, st: { size: number; mtime: number }, e: FileEntry | undefined, record?: string): CatalogueItem {
    const name = baseOf(rel);
    const level = this.host.level?.(rel) ?? 'open';
    const area = this.host.areaOf?.(rel);
    return {
      path: rel,
      name,
      folder: folderOf(rel),
      ext: extOf(name),
      size: e?.ref ? (e.ref.size ?? 0) : st.size,
      mtime: st.mtime,
      kind: e?.kind ?? kindWords(name),
      purpose: purposeOf(name, e),
      purposeChosen: !!e?.purpose,
      version: e?.version ?? 1,
      older: e?.versions.length ?? 0,
      ...(e?.supersededBy ? { supersededBy: e.supersededBy } : {}),
      title: e?.title ?? titleFromName(name),
      ...(e?.summary ? { summary: e.summary, summaryBy: e.summaryBy } : {}),
      what: whatWords({ name, kind: e?.kind, pages: e?.pages, pagesWord: e?.pagesWord, size: e?.ref ? e.ref.size : st.size }),
      ...(e?.source ? { source: e.source } : {}),
      sourceWords: sourceWords(e?.source),
      ...(e?.added ? { added: e.added } : {}),
      ...(record ? { record } : e?.record ? { record: e.record } : {}),
      ...(area ? { area } : {}),
      level,
      withRecord: !!filesFolderOf(rel),
    };
  }

  /** Every file in the vault with its record (and files linked where they are on this PC), for the Files views. */
  async catalogue(under = ''): Promise<CatalogueItem[]> {
    const top = under.replace(/^\/+|\/+$/g, '');
    const inside = (p: string) => !top || p === top || p.startsWith(`${top}/`);
    const all = (await this.host.listAll()).filter((f) => inside(f.rel) && !isNotePath(f.rel) && !/\.(view\.json|base|nvdraw)$/i.test(f.rel) && baseOf(f.rel) !== 'assets.json');
    const byFolder = new Map<string, typeof all>();
    for (const f of all) {
      const d = folderOf(f.rel);
      const list = byFolder.get(d) ?? [];
      list.push(f);
      byFolder.set(d, list);
    }
    // Records exist in Files folders (and any folder something was recorded in): read the ones that are there.
    const folders = new Set([...byFolder.keys()].filter((d) => !!filesFolderOf(`${d}/x`) || d.split('/').some((s) => s.toLowerCase() === 'files')));
    const known = await this.sidecarFolders(top);
    for (const k of known) folders.add(k);
    const out: CatalogueItem[] = [];
    const sidecars = new Map<string, FilesSidecar>();
    await Promise.all([...folders].map(async (d) => sidecars.set(d, await this.readSidecar(d))));
    const recordCache = new Map<string, string | undefined>();
    const recordFor = async (rel: string, e?: FileEntry) => {
      if (e?.record) return e.record;
      const files = filesFolderOf(rel);
      if (!files) return undefined;
      const key = `${files}\n${rel.slice(files.length + 1).split('/')[0]}`;
      if (!recordCache.has(key)) recordCache.set(key, await this.recordOf(rel));
      return recordCache.get(key);
    };
    for (const f of all) {
      const e = sidecars.get(folderOf(f.rel)) ? entryOf(sidecars.get(folderOf(f.rel))!, baseOf(f.rel)) : undefined;
      out.push(this.item(f.rel, f, e, await recordFor(f.rel, e)));
    }
    // Files linked where they are on this PC.
    for (const [d, s] of sidecars) {
      for (const e of Object.values(s.files)) {
        if (!e.ref) continue;
        const rel = d ? `${d}/${e.name}` : e.name;
        const missing = !(await this.refStat(e.ref.path));
        out.push({ ...this.item(rel, { size: e.ref.size, mtime: e.ref.mtime }, e, e.record), ref: { path: e.ref.path, missing } });
      }
    }
    return out;
  }

  /** Folders holding a record (found once per listing, cheaply: Files folders and the attachments folder). */
  private async sidecarFolders(under = ''): Promise<string[]> {
    const root = this.requireRoot();
    if (under) {
      const out0: string[] = [];
      const start = this.abs(under);
      const walk0 = async (dir: string, rel: string, depth: number): Promise<void> => {
        if (depth > 8) return;
        const list = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
        if (list.some((x) => x.isFile() && x.name === SIDECAR)) out0.push(rel);
        for (const x of list) if (x.isDirectory() && !x.name.startsWith('.')) await walk0(path.join(dir, x.name), `${rel}/${x.name}`, depth + 1);
      };
      await walk0(start, under, 0);
      return out0;
    }
    const out: string[] = [];
    const walk = async (dir: string, rel: string, depth: number) => {
      if (depth > 8) return;
      const list = await fsp.readdir(win32Abs(dir, process.platform), { withFileTypes: true }).catch(() => []);
      if (list.some((x) => x.isFile() && x.name === SIDECAR)) out.push(rel);
      for (const x of list) if (x.isDirectory() && !x.name.startsWith('.') && x.name !== 'node_modules') await walk(path.join(dir, x.name), rel ? `${rel}/${x.name}` : x.name, depth + 1);
    };
    await walk(root, '', 0);
    return out;
  }

  /** The whole vault checked, and what can only be put right one way put right (src/main/vault-check.ts). Name
   *  repairs go through the app's own move (links, canvases, views, file records and the index follow it), which
   *  reaches a dotted source through the vault's own paths — a \\?\ path on Windows — so trailing dots move as named.
   *  An approved plan repairs only its own pairs (`plan`); each landing is receipted (`receipt`) so a crash resumes. */
  async check(o: { repair: boolean; templatesFolder?: string; plan?: readonly (readonly [string, string])[]; receipt?: boolean; names?: boolean } = { repair: true }): Promise<CheckResult> {
    const root = this.requireRoot();
    const templatesFolder = o.templatesFolder;
    return checkVault(
      {
        root: () => root,
        listAll: () => this.host.listAll(),
        notes: () => this.host.notes(),
        resolve: (t, from) => this.host.resolve(t, from),
        readNote: (rel) => this.host.readNote(rel),
        writeNote: async (rel, text) => {
          if (!this.host.writeNote) throw new Error('Notes can’t be written here.');
          await this.host.writeNote(rel, text);
        },
        sidecarFolders: () => this.sidecarFolders(),
        readSidecar: (f) => this.readSidecar(f),
        changeSidecar: (f, fn) => this.changeSidecar(f, fn),
        movePath: (f, t, u) => this.host.movePath(f, t, u),
      },
      { repair: o.repair, ...(templatesFolder ? { templatesFolder } : {}), ...(o.plan ? { plan: o.plan } : {}), ...(o.receipt ? { receipt: o.receipt } : {}), ...(o.names !== undefined ? { names: o.names } : {}) },
    );
  }

  /** One file's details for the peek: what it is, where from, its versions, who may summarise it. */
  async info(raw: string): Promise<FileInfo> {
    let rel = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    let folder = folderOf(rel);
    let s = await this.readSidecar(folder);
    let e = entryOf(s, baseOf(rel));
    let st: { size: number; mtime: number };
    let ref: CatalogueItem['ref'];
    if (e?.ref) {
      const real = await this.refStat(e.ref.path);
      st = { size: real?.size ?? e.ref.size, mtime: real?.mtimeMs ?? e.ref.mtime };
      ref = { path: e.ref.path, missing: !real };
    } else {
      let real = await fsp.stat(this.abs(rel)).catch(() => null);
      if (!real?.isFile()) {
        // A file moved within the vault by something else (a sync, Explorer, a rename the app did not
        // make) is still the person's file under the same name (the brief: the Files card's "missing
        // file" error must not happen for a file that exists or was moved). One match is the file;
        // none, or several with that name, keeps the plain error rather than guessing.
        const name = baseOf(rel).toLowerCase();
        const moved = (await this.host.listAll().catch(() => [])).filter((f) => !isNotePath(f.rel) && baseOf(f.rel).toLowerCase() === name);
        const only = moved.length === 1 ? moved[0] : undefined;
        const found = only ? await fsp.stat(this.abs(only.rel)).catch(() => null) : null;
        if (!only || !found?.isFile()) throw new Error('That file isn’t there any more.');
        rel = only.rel;
        folder = folderOf(rel);
        s = await this.readSidecar(folder);
        e = entryOf(s, baseOf(rel));
        real = found;
      }
      st = { size: real.size, mtime: real.mtimeMs };
    }
    const record = await this.recordOf(rel, e);
    // A file put here by another app (the former host app, a sync) with no "what is this" yet: read once,
    // then shown.
    if (!e?.ref && !(e?.kind && (e.title || e.summary || e.pages)) && !this.describedOnce.has(rel)) {
      this.describedOnce.add(rel);
      void this.describe(rel).then(() => this.host.added([]), () => undefined);
    }
    const assistant = this.host.assistantMay?.(rel) ?? { ok: false as const, why: 'The assistant isn’t available here.' };
    return {
      ...this.item(rel, st, e, record),
      ...(ref ? { ref } : {}),
      versions: versionRows(rel, e, Object.values(s.files)),
      assistant,
      ...(e?.pages ? { pages: e.pages, pagesWord: e.pagesWord } : {}),
    };
  }

  // ── Following moves ──

  /** Files moved by the app (one by one, or inside a folder): their records and older versions go with them.
   *  A renamed note (or a folder it is in) is followed too: file records pointing at it keep pointing at it. */
  async renamed(pairs: [string, string][]): Promise<void> {
    if (!this.host.root()) return;
    const notes = pairs.filter(([a]) => isNotePath(a));
    if (notes.length) {
      for (const folder of await this.sidecarFolders().catch(() => [] as string[])) {
        await this.changeSidecar(folder, (s) => {
          for (const e of Object.values(s.files ?? {})) {
            if (typeof e.record !== 'string') continue;
            for (const [from, to] of notes) {
              if (e.record === from || e.record.startsWith(`${from}/`)) e.record = to + e.record.slice(from.length);
            }
          }
        });
      }
    }
    const files = pairs.filter(([a]) => !isNotePath(a));
    for (const [from, to] of files) {
      const fromDir = folderOf(from);
      const toDir = folderOf(to);
      if (fromDir.toLowerCase() === toDir.toLowerCase() && baseOf(from) === baseOf(to)) continue;
      // A folder moved whole carries its record already (it now reads under the new folder).
      const fromSide = await this.readSidecar(fromDir).catch(() => emptySidecar());
      const e = entryOf(fromSide, baseOf(from));
      if (!e) continue;
      const next: FileEntry = { ...e, name: baseOf(to) };
      // Its older versions move with it.
      for (const v of e.versions) {
        const a = this.abs(versionPath(from, v.n));
        const b = this.abs(versionPath(to, v.n));
        if (a === b || !(await fsp.stat(a).catch(() => null))) continue;
        await fsp.mkdir(path.dirname(b), { recursive: true });
        if (!(await fsp.stat(b).catch(() => null))) await fsp.rename(a, b).catch(() => {});
      }
      next.versions = e.versions.map((v) => ({ ...v, file: versionFileName(next.name, v.n) }));
      await this.changeSidecar(toDir, (s) => {
        s.files[entryKey(next.name)] = next;
      });
      await this.changeSidecar(fromDir, (s) => {
        delete s.files[entryKey(e.name)];
        // Another file's family pointer follows the name.
        for (const o of Object.values(s.files)) if (o.supersededBy && entryKey(o.supersededBy) === entryKey(e.name)) delete o.supersededBy;
      });
      await fsp.rmdir(this.abs(fromDir ? `${fromDir}/${VERSIONS_FOLDER}` : VERSIONS_FOLDER)).catch(() => {});
    }
    if (pairs.length) await this.host.levelsMoved?.(pairs);
  }

  // ── Big imports that carry on after a break ──

  private importsDir(): string {
    return path.join(this.host.dataDir, 'file-imports');
  }

  private async loadImports(): Promise<void> {
    if (this.importsLoaded) return;
    this.importsLoaded = true;
    const dir = this.importsDir();
    for (const f of await fsp.readdir(dir).catch(() => [] as string[])) {
      if (!/^imp_[A-Za-z0-9_-]+\.json$/.test(f)) continue;
      try {
        const meta = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8')) as ImportMeta;
        if (meta.root !== this.host.root()) continue;
        const received = (await fsp.stat(path.join(dir, `${meta.id}.part`)).catch(() => null))?.size ?? 0;
        this.imports.set(meta.id, { id: meta.id, name: meta.name, size: meta.size, received: Math.min(received, meta.size), ...(meta.record ? { record: meta.record } : {}), from: meta.src ? 'path' : 'window', ...(meta.src ? { src: meta.src } : {}), state: 'paused', started: meta.started, ...(meta.folder !== undefined ? { rel: meta.folder ? `${meta.folder}/${meta.name}` : meta.name } : {}), meta });
      } catch {
        // A broken record: left for the tidy.
      }
    }
  }

  private async saveImport(meta: ImportMeta): Promise<void> {
    await writeAtomic(path.join(this.importsDir(), `${meta.id}.json`), JSON.stringify(meta));
  }

  /** Imports not finished (paused by a break or a restart), for the window. */
  async importList(): Promise<ImportState[]> {
    await this.loadImports();
    return [...this.imports.values()].filter((i) => i.state !== 'done').map(({ meta: _m, ...s }) => s);
  }

  /** A big file from this PC copied in pieces (8 MB each, kept as they arrive), so a break or a restart carries on. */
  async importPath(o: { record?: string; folder?: string; src: string; name?: string; same?: 'version' | 'both'; by?: string; how?: SourceHow }): Promise<ImportState> {
    await this.loadImports();
    const st = await fsp.stat(o.src);
    if (!st.isFile()) throw new Error('That isn’t a file.');
    if (st.size > MAX_IMPORT_BYTES) throw new Error(`That file is ${sizeWords(st.size)}; at most ${sizeWords(MAX_IMPORT_BYTES)} go into the vault.`);
    // Its place is chosen now (so a link to it can be written while it comes in): beside its record, a free name.
    const folder = o.folder !== undefined ? o.folder.replace(/^\/+|\/+$/g, '') : this.folderFor(o.record ?? '');
    let name = cleanName(o.name ?? path.basename(o.src));
    if (o.same !== 'version') {
      const here = await fsp.readdir(folder ? this.abs(folder) : this.requireRoot()).catch(() => [] as string[]);
      const coming = [...this.imports.values()].filter((i) => (i.meta.folder ?? '') === folder && i.state !== 'done').map((i) => i.name);
      name = freeIn(name, new Set([...here, ...coming].map((n) => n.toLowerCase())));
    }
    const id = `imp_${randomBytes(9).toString('base64url')}`;
    const meta: ImportMeta = { id, root: this.requireRoot(), name, size: st.size, src: o.src, srcMtime: st.mtimeMs, ...(o.record ? { record: o.record } : {}), folder, ...(o.same ? { same: o.same } : {}), by: o.by ?? 'you', how: o.how ?? 'added', started: Date.now() };
    await fsp.mkdir(this.importsDir(), { recursive: true });
    await fsp.writeFile(path.join(this.importsDir(), `${id}.part`), Buffer.alloc(0));
    await this.saveImport(meta);
    const state: ImportState & { meta: ImportMeta } = { id, name, size: st.size, received: 0, ...(o.record ? { record: o.record } : {}), from: 'path', src: o.src, state: 'running', started: meta.started, rel: folder ? `${folder}/${name}` : name, meta };
    this.imports.set(id, state);
    this.host.progress?.(this.publicState(state));
    void this.runImport(id);
    return this.publicState(state);
  }

  /** A big file the window sends in pieces (no place on the PC it can be read from): begin, then each piece at its offset. */
  async importBegin(o: { record?: string; folder?: string; name: string; size: number; same?: 'version' | 'both' }): Promise<ImportState> {
    await this.loadImports();
    if (!Number.isSafeInteger(o.size) || o.size < 1) throw new Error('That file is empty.');
    if (o.size > MAX_IMPORT_BYTES) throw new Error(`That file is ${sizeWords(o.size)}; at most ${sizeWords(MAX_IMPORT_BYTES)} go into the vault.`);
    const name = cleanName(o.name);
    const id = `imp_${randomBytes(9).toString('base64url')}`;
    const meta: ImportMeta = { id, root: this.requireRoot(), name, size: o.size, ...(o.record ? { record: o.record } : {}), ...(o.folder !== undefined ? { folder: o.folder } : {}), ...(o.same ? { same: o.same } : {}), by: 'you', how: 'added', started: Date.now() };
    await fsp.mkdir(this.importsDir(), { recursive: true });
    await fsp.writeFile(path.join(this.importsDir(), `${id}.part`), Buffer.alloc(0));
    await this.saveImport(meta);
    const state: ImportState & { meta: ImportMeta } = { id, name, size: o.size, received: 0, ...(o.record ? { record: o.record } : {}), from: 'window', state: 'running', started: meta.started, meta };
    this.imports.set(id, state);
    return this.publicState(state);
  }

  private publicState(s: ImportState & { meta: ImportMeta }): ImportState {
    const { meta: _m, ...rest } = s;
    return rest;
  }

  /** One piece from the window, at the offset the import has reached (a piece sent again is fine). */
  async importPiece(id: string, offset: number, bytes: Uint8Array): Promise<ImportState> {
    await this.loadImports();
    const s = this.imports.get(id);
    if (!s || s.from !== 'window') throw new Error('That import isn’t going any more. Add the file again.');
    if (bytes.length > PIECE_BYTES + 1024) throw new Error('Send at most 8 MB at a time.');
    const part = path.join(this.importsDir(), `${id}.part`);
    const have = (await fsp.stat(part).catch(() => null))?.size ?? 0;
    if (offset + bytes.length <= have) return this.publicState({ ...s, received: have });
    if (offset !== have) throw Object.assign(new Error(`The next piece starts at byte ${have}.`), { received: have });
    if (have + bytes.length > s.size) throw new Error('That goes past the file’s size.');
    await fsp.appendFile(part, bytes);
    s.received = have + bytes.length;
    s.state = 'running';
    this.host.progress?.(this.publicState(s));
    if (s.received === s.size) await this.finishImport(s);
    return this.publicState(s);
  }

  /** Carries on with an import paused by a break or a restart (one from this PC by itself; the window sends the rest). */
  async importResume(id: string): Promise<ImportState> {
    await this.loadImports();
    const s = this.imports.get(id);
    if (!s) throw new Error('That import isn’t there any more.');
    if (s.from === 'path' && s.state !== 'running') {
      s.state = 'running';
      delete s.problem;
      void this.runImport(id);
    }
    return this.publicState(s);
  }

  /** Stops an import part-way (kept, to carry on later) or cancels it (its pieces removed). */
  async importStop(id: string, cancel: boolean): Promise<void> {
    await this.loadImports();
    const s = this.imports.get(id);
    if (!s) return;
    s.meta.stop = true;
    if (cancel) {
      this.imports.delete(id);
      await fsp.rm(path.join(this.importsDir(), `${id}.part`), { force: true }).catch(() => {});
      await fsp.rm(path.join(this.importsDir(), `${id}.json`), { force: true }).catch(() => {});
    } else s.state = 'paused';
    this.host.progress?.({ ...this.publicState(s), ...(cancel ? { state: 'failed', problem: 'Cancelled' } : {}) });
  }

  /** Imports from this PC that a restart paused carry on by themselves when the vault opens (their file unchanged). */
  async resumeAll(): Promise<void> {
    await this.loadImports();
    for (const s of this.imports.values()) if (s.from === 'path' && s.state === 'paused') void this.importResume(s.id);
  }

  private async runImport(id: string): Promise<void> {
    const s = this.imports.get(id);
    if (!s || !s.meta.src) return;
    s.meta.stop = false;
    const part = path.join(this.importsDir(), `${id}.part`);
    try {
      const st = await fsp.stat(s.meta.src).catch(() => null);
      if (!st?.isFile()) throw new Error(`${s.meta.src} isn’t on this PC any more, so the import stopped. Add the file again.`);
      if (st.size !== s.size || (s.meta.srcMtime && Math.abs(st.mtimeMs - s.meta.srcMtime) > 2000)) throw new Error(`${s.name} changed on the PC since the import began, so it starts again from the top when you add it again.`);
      let have = (await fsp.stat(part).catch(() => null))?.size ?? 0;
      // A piece half written when the break came is taken back to the last whole piece.
      const whole = Math.floor(have / PIECE_BYTES) * PIECE_BYTES;
      if (whole !== have && have !== s.size) {
        await fsp.truncate(part, whole);
        have = whole;
      }
      const src = await fsp.open(s.meta.src, 'r');
      const out = await fsp.open(part, 'a');
      try {
        const buf = Buffer.alloc(PIECE_BYTES);
        while (have < s.size) {
          if (s.meta.stop) {
            s.state = 'paused';
            this.host.progress?.(this.publicState(s));
            return;
          }
          const len = Math.min(PIECE_BYTES, s.size - have);
          const { bytesRead } = await src.read(buf, 0, len, have);
          if (bytesRead !== len) throw new Error(`${s.name} couldn’t be read to the end on this PC.`);
          await out.write(buf, 0, len);
          await out.sync().catch(() => {});
          have += len;
          s.received = have;
          s.state = 'running';
          this.host.progress?.(this.publicState(s));
          // Let the window breathe between pieces.
          await new Promise((r) => setImmediate(r));
        }
      } finally {
        await src.close();
        await out.close();
      }
      await this.finishImport(s);
    } catch (err) {
      s.state = 'failed';
      s.problem = err instanceof Error ? err.message : String(err);
      this.host.progress?.(this.publicState(s));
    }
  }

  private async finishImport(s: ImportState & { meta: ImportMeta }): Promise<void> {
    const part = path.join(this.importsDir(), `${s.id}.part`);
    const st = await fsp.stat(part);
    if (st.size !== s.size) throw new Error(`Only ${sizeWords(st.size)} of ${sizeWords(s.size)} arrived.`);
    // Checked against the file it came from, when it came from this PC.
    if (s.meta.src) {
      const [a, b] = await Promise.all([sha256Of(part), sha256Of(s.meta.src)]);
      if (a !== b) {
        await fsp.truncate(part, 0);
        throw new Error(`${s.name} that arrived doesn’t match the file on the PC, so it wasn’t kept. Add it again.`);
      }
    }
    const at = new Date().toISOString();
    const placed = await this.place({ ...(s.meta.record ? { record: s.meta.record } : {}), ...(s.meta.folder !== undefined ? { folder: s.meta.folder } : {}), src: part, name: s.name, move: true, source: { by: s.meta.by, how: s.meta.how, ...(s.meta.src ? { from: s.meta.src } : {}), at }, ...(s.meta.same ? { same: s.meta.same } : {}), describe: 'later' });
    s.state = 'done';
    s.received = s.size;
    s.rel = placed.rel;
    this.imports.delete(s.id);
    await fsp.rm(path.join(this.importsDir(), `${s.id}.json`), { force: true }).catch(() => {});
    await fsp.rm(part, { force: true }).catch(() => {});
    this.host.progress?.(this.publicState(s));
  }

  // ── The move of today's flat Attachments folder into place ──

  private async migrationInput(): Promise<{ plan: FileMovePlan[]; existing: string[] }> {
    const p = this.host.prefs();
    const listed = await this.host.listAll();
    const notes = this.host.notes();
    const there = new Set(listed.map((f) => f.rel));
    const moveNotes: MoveNote[] = [];
    for (const n of notes) {
      let text: string | undefined;
      try {
        text = await this.host.readNote(n.path);
      } catch {
        text = undefined;
      }
      // Markdown links to files count as links too (the index follows links to notes only).
      const md = text ? mdFileTargets(text, n.path, (p) => there.has(p)).map((m) => ({ target: m.target, reached: m.path })) : [];
      moveNotes.push({ path: n.path, props: n.props, links: [...n.links.map((l) => ({ target: l.target, reached: this.host.resolve(l.target, n.path) })), ...md], ...(text !== undefined ? { text } : {}) });
    }
    const projects = notes.filter((n) => String(n.props?.type ?? '').toLowerCase() === 'project').map((n) => n.path);
    const attachments = p.attachmentsFolder?.startsWith('./') ? '' : (p.attachmentsFolder || 'Attachments');
    const plan = planFileMigration({ notes: moveNotes, files: listed.filter((f) => !isNotePath(f.rel)).map((f) => ({ path: f.rel, size: f.size })), attachmentsFolder: attachments, ...(p.templatesFolder ? { templatesFolder: p.templatesFolder } : {}), ...(p.dailyFolder ? { dailyFolder: p.dailyFolder } : {}), projects, alsoFrom: this.host.areaFilesFolders?.() ?? [] });
    return { plan, existing: [...listed.map((f) => f.rel), ...notes.map((n) => n.path)] };
  }

  /** What the move would do: each file in the attachments folder, where it goes and why (nothing moved yet). */
  async migrationPlan(): Promise<{ plan: FileMovePlan[]; words: string; folder: string }> {
    const { plan } = await this.migrationInput();
    const p = this.host.prefs();
    return { plan, words: fileMigrationWords(plan), folder: p.attachmentsFolder || 'Attachments' };
  }

  /**
   * The move: a safety copy of everything it touches first, each file moved with the app's own move (every link that
   * reached it rewritten), its record written, files named by version joined up, and then a check: every file that moved
   * is there with the same bytes, and every link that reached one reaches it still. The journal keeps the moves for Undo.
   */
  async migrationApply(choices: Record<string, string> = {}): Promise<MigrationResult> {
    const root = this.requireRoot();
    const { plan: raw, existing } = await this.migrationInput();
    const plan = withFileChoices(raw, choices, existing);
    const moving = plan.filter((x) => x.to && x.to !== x.from);
    const at = this.now();
    const result: MigrationResult = { words: '', moved: [], stayed: plan.filter((x) => !x.to).map((x) => ({ path: x.from, why: x.why })), linksUpdated: 0, problems: [], safety: null, journal: null, check: { files: 0, filesOk: 0, links: 0, linksOk: 0, broken: [] } };
    if (!moving.length) {
      result.words = plan.length ? 'Nothing needed moving.' : 'There is nothing in the attachments folder to move.';
      return result;
    }
    // 1. What each moving file is now (its bytes), and every link that reaches one.
    const before = new Map<string, { sha: string; size: number }>();
    for (const m of moving) {
      const abs = this.abs(m.from);
      const st = await fsp.stat(abs);
      before.set(m.from, { sha: await sha256Of(abs), size: st.size });
    }
    const reaching: { note: string; target: string; file: string; md?: boolean }[] = [];
    const existed = new Set((await this.host.listAll()).map((f) => f.rel));
    for (const n of this.host.notes()) {
      for (const l of n.links) {
        const r = this.host.resolve(l.target, n.path);
        if (r && before.has(r)) reaching.push({ note: n.path, target: l.target, file: r });
      }
      const text = await this.host.readNote(n.path).catch(() => '');
      for (const m of mdFileTargets(text, n.path, (p) => existed.has(p))) if (before.has(m.path)) reaching.push({ note: n.path, target: m.target, file: m.path, md: true });
    }
    // 2. The safety copy: the files, the notes whose links change, and Ironleaf's own files that name paths.
    if (this.host.writeZip) {
      const safety = `${SAFETY}/Before files move ${stampOf(at)}.zip`;
      const names = new Set<string>([...moving.map((m) => m.from), ...reaching.map((r) => r.note)]);
      const sources: { name: string; abs: string; mtime?: number }[] = [];
      for (const n of names) {
        try {
          const abs = this.abs(n);
          const st = await fsp.stat(abs);
          sources.push({ name: n, abs, mtime: st.mtimeMs });
        } catch {
          // Gone already.
        }
      }
      for (const extra of ['.neuralvault/sensitivity.json']) {
        const abs = path.join(root, ...extra.split('/'));
        const st = await fsp.stat(abs).catch(() => null);
        if (st) sources.push({ name: extra, abs, mtime: st.mtimeMs });
      }
      await fsp.mkdir(path.join(root, ...SAFETY.split('/')), { recursive: true });
      await this.host.writeZip(path.join(root, ...safety.split('/')), sources);
      result.safety = safety;
    }
    // 3. The moves, each with the app's own move.
    const done: { from: string; to: string; record?: string }[] = [];
    for (const m of moving) {
      try {
        if (await fsp.stat(this.abs(m.to!)).catch(() => null)) {
          result.problems.push(`${m.to} was there already, so ${m.from} stayed where it was.`);
          continue;
        }
        const r = await this.host.movePath(m.from, m.to!, true);
        result.linksUpdated += r.linksUpdated;
        done.push({ from: m.from, to: r.path, ...(m.record ? { record: m.record } : {}) });
      } catch (err) {
        result.problems.push(`${m.from}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // 3b. Markdown links to the moved files, which the app's move doesn't follow, brought up to date here.
    const movedMap = new Map(done.map((d) => [d.from, d.to]));
    for (const note of new Set(reaching.filter((r) => r.md).map((r) => r.note))) {
      try {
        const text = await this.host.readNote(note);
        const r = rewriteMdFileLinks(text, note, movedMap, (p) => existed.has(p));
        if (r.count && this.host.writeNote) {
          await this.host.writeNote(note, r.text);
          result.linksUpdated += r.count;
        }
      } catch (err) {
        result.problems.push(`${note}: its links to files couldn’t be brought up to date (${err instanceof Error ? err.message : String(err)}).`);
      }
    }
    // 4. Each file's record: moved here from the attachments folder, its note, what it is.
    const atIso = at.toISOString();
    for (const d of done) {
      try {
        const st = await fsp.stat(this.abs(d.to));
        await this.changeSidecar(folderOf(d.to), (s) => {
          const e = entryOf(s, baseOf(d.to)) ?? { name: baseOf(d.to), version: 1, versions: [] };
          e.record = d.record ?? e.record;
          e.added = e.added ?? new Date(st.mtimeMs).toISOString();
          e.source = e.source && e.source.how !== 'migrated' ? e.source : { by: 'you', how: 'migrated', from: d.from, at: atIso };
          e.size = st.size;
          e.sha256 = before.get(d.from)?.sha;
          s.files[entryKey(e.name)] = e;
        });
        await this.describe(d.to).catch(() => {});
      } catch (err) {
        result.problems.push(`${d.to}: its record couldn’t be written (${err instanceof Error ? err.message : String(err)}).`);
      }
    }
    // 5. Files named by version beside each other ("… v2", "… v3"): the older ones superseded by the newest.
    for (const folder of new Set(done.map((d) => folderOf(d.to)))) {
      const names = (await fsp.readdir(this.abs(folder)).catch(() => [] as string[])).filter((n) => !n.startsWith('.'));
      const fam = namedFamilies(names);
      if (!fam.size) continue;
      await this.changeSidecar(folder, (s) => {
        for (const [older, newer] of fam) {
          const e = entryOf(s, older) ?? { name: older, version: 1, versions: [] };
          e.supersededBy = newer;
          s.files[entryKey(older)] = e;
        }
      });
    }
    // 6. The check: every moved file there with the same bytes; every link that reached one reaches it still.
    const movedTo = new Map(done.map((d) => [d.from, d.to]));
    result.check.files = before.size;
    for (const [from, b] of before) {
      const to = movedTo.get(from) ?? from;
      const abs = this.abs(to);
      const ok = await sha256Of(abs).then((h) => h === b.sha, () => false);
      if (ok) result.check.filesOk++;
      else result.check.broken.push(`${from} isn’t at ${to} with the same contents.`);
    }
    const notesNow = new Map(this.host.notes().map((n) => [n.path, n]));
    const thereNow = new Set((await this.host.listAll()).map((f) => f.rel));
    for (const r of reaching) {
      result.check.links++;
      const want = movedTo.get(r.file) ?? r.file;
      const note = notesNow.get(r.note);
      let ok = !!note && note.links.some((l) => this.host.resolve(l.target, r.note) === want);
      if (!ok && r.md) ok = mdFileTargets(await this.host.readNote(r.note).catch(() => ''), r.note, (p) => thereNow.has(p)).some((m) => m.path === want);
      if (ok) result.check.linksOk++;
      else result.check.broken.push(`${r.note} no longer reaches ${baseOf(want)}.`);
    }
    // 7. The journal (for Undo), the empty attachments folder put away, and new files from now on go beside their notes.
    const journal = `${MIGRATIONS}/Files move ${stampOf(at)}.json`;
    await writeAtomic(path.join(root, ...journal.split('/')), JSON.stringify({ kind: 'files', at: atIso, moves: done.map((d) => [d.from, d.to]), safety: result.safety, check: result.check }, null, 2));
    result.journal = journal;
    const attach = this.host.prefs().attachmentsFolder;
    if (attach && !attach.startsWith('./')) {
      const left = (await fsp.readdir(this.abs(attach)).catch(() => null)) ?? null;
      if (left && !left.length) await fsp.rmdir(this.abs(attach)).catch(() => {});
    }
    await this.host.setFilesWithRecord?.(true);
    result.moved = done;
    const stayed = result.stayed.length;
    result.words = `${done.length.toLocaleString('en-AU')} ${done.length === 1 ? 'file is' : 'files are'} beside ${done.length === 1 ? 'its note' : 'their notes'} now, ${result.linksUpdated.toLocaleString('en-AU')} ${result.linksUpdated === 1 ? 'link' : 'links'} brought up to date${stayed ? `; ${stayed} ${stayed === 1 ? 'stays' : 'stay'} where ${stayed === 1 ? 'it is' : 'they are'} (no note names ${stayed === 1 ? 'it' : 'them'})` : ''}. ${result.check.broken.length ? `${result.check.broken.length} ${result.check.broken.length === 1 ? 'thing needs' : 'things need'} a look.` : 'Every file and link checked.'}`;
    await this.host.added(done.map((d) => d.to));
    return result;
  }

  /** The last move undone: each file moved back with the app's own move (links follow again). */
  async migrationUndo(): Promise<{ words: string; back: number; problems: string[] }> {
    const root = this.requireRoot();
    const dir = path.join(root, ...MIGRATIONS.split('/'));
    const last = (await fsp.readdir(dir).catch(() => [] as string[])).filter((f) => /^Files move .+\.json$/.test(f)).sort().pop();
    if (!last) throw new Error('There is no move of files to undo.');
    const j = JSON.parse(await fsp.readFile(path.join(dir, last), 'utf8')) as { moves: [string, string][]; undone?: boolean };
    if (j.undone) throw new Error('That move was undone already.');
    const problems: string[] = [];
    let back = 0;
    for (const [from, to] of [...j.moves].reverse()) {
      try {
        if (!(await fsp.stat(this.abs(to)).catch(() => null))) {
          problems.push(`${to} isn’t there any more.`);
          continue;
        }
        await this.host.movePath(to, from, true);
        back++;
      } catch (err) {
        problems.push(`${to}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await writeAtomic(path.join(dir, last), JSON.stringify({ ...j, undone: true }, null, 2));
    return { words: `${back} ${back === 1 ? 'file is' : 'files are'} back where ${back === 1 ? 'it was' : 'they were'}.`, back, problems };
  }
}

interface ImportMeta {
  id: string;
  root: string;
  name: string;
  size: number;
  src?: string;
  srcMtime?: number;
  record?: string;
  folder?: string;
  same?: 'version' | 'both';
  by: string;
  how: SourceHow;
  started: number;
  stop?: boolean;
}

/** Copies (or moves) a file to a place nothing is at. */
async function putFile(src: string, dest: string, move: boolean): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if (move) {
    if (await fsp.stat(dest).catch(() => null)) throw Object.assign(new Error('Something of that name is there already.'), { code: 'EEXIST' });
    try {
      await fsp.rename(src, dest);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    }
  }
  await fsp.copyFile(src, dest, fsConstants.COPYFILE_EXCL);
  if (move) await fsp.rm(src, { force: true });
}

/** A PDF's page count from its page tree (the largest /Count of a /Pages object), read from the file's text. */
async function pdfPageCount(abs: string, size: number): Promise<number | null> {
  if (size > 150 * 1024 * 1024) return null;
  const buf = await fsp.readFile(abs);
  const s = buf.toString('latin1');
  let best = 0;
  for (const m of s.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)) best = Math.max(best, Number(m[1] ?? m[2]));
  return best || null;
}

/** A PDF's own title (its Info dictionary), when it has a plain one. */
async function pdfTitle(abs: string, size: number): Promise<string | null> {
  if (size > 150 * 1024 * 1024) return null;
  const fh = await fsp.open(abs, 'r');
  try {
    const len = Math.min(size, 256 * 1024);
    const head = Buffer.alloc(len);
    await fh.read(head, 0, len, 0);
    const tail = Buffer.alloc(Math.min(size, 256 * 1024));
    await fh.read(tail, 0, tail.length, Math.max(0, size - tail.length));
    const s = `${head.toString('latin1')}\n${tail.toString('latin1')}`;
    const m = /\/Title\s*\(((?:\\.|[^\\)])*)\)/.exec(s);
    if (!m) return null;
    let t = m[1].replace(/\\([nrtbf()\\])/g, (_x, c) => ({ n: ' ', r: ' ', t: ' ', b: '', f: '', '(': '(', ')': ')', '\\': '\\' })[c as 'n'] ?? c);
    if (t.startsWith('þÿ')) t = decodeUtf16be(Buffer.from(t.slice(2), 'latin1'));
    t = t.replace(/\s+/g, ' ').trim();
    if (!t || t.length > 120 || /^(untitled|microsoft word|document\d*|\S+\.(docx?|pdf|pptx?))/i.test(t)) return null;
    return t;
  } finally {
    await fh.close();
  }
}

/** An Office file's title and page count from its properties (docProps/core.xml and app.xml). */
async function officeProps(abs: string): Promise<{ title?: string; pages?: number } | null> {
  const buf = await fsp.readFile(abs);
  const entries = zipEntries(buf);
  const read = async (name: string) => {
    const e = entries.find((x) => x.name === name);
    return e ? (await zipRead(buf, e, 2 * 1024 * 1024)).toString('utf8') : '';
  };
  const core = await read('docProps/core.xml');
  const app = await read('docProps/app.xml');
  const title = decodeXml(/<dc:title>([\s\S]*?)<\/dc:title>/.exec(core)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const pages = Number(/<Pages>(\d+)<\/Pages>/.exec(app)?.[1] ?? NaN);
  return { ...(title && title.length <= 120 && !/^(untitled|document\d*|presentation\d*|book\d*)$/i.test(title) ? { title } : {}), ...(Number.isFinite(pages) && pages > 0 ? { pages } : {}) };
}

export { BIG_FILE, PIECE_BYTES, MAX_IMPORT_BYTES };

// ── The window's ways in ────────────────────────────────────────────────────────────────────────────────────────────

export interface VaultFilesIpc {
  handle(channel: string, fn: (...args: any[]) => unknown): void;
  requireCreate(): Promise<void>;
  /** Files chosen on this PC (null: cancelled). */
  chooseFiles(o: { title: string; multiple: boolean }): Promise<string[] | null>;
  openPath(abs: string): Promise<void>;
  showInFolder(abs: string): void;
}

const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.slice(0, max) : '');
const noteRel = (v: unknown) => {
  const s = str(v).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s) return '';
  if (s.split('/').some((x) => !x || x === '..' || x.startsWith('.')) || !isNotePath(s)) throw new Error('Which note is it for?');
  return s;
};
const sameOf = (v: unknown): 'version' | 'both' | undefined => (v === 'version' || v === 'both' ? v : undefined);

/** The IPC handlers for the Files views, a file's details, adding files to a record and the move into place. */
export function registerVaultFiles(svc: VaultFiles, ipc: VaultFilesIpc): void {
  const { handle } = ipc;
  handle('vfiles:catalogue', (under: unknown) => svc.catalogue(typeof under === 'string' ? under.replace(/\\/g, '/').split('/').filter((x) => x && x !== '..' && !x.startsWith('.')).join('/') : ''));
  handle('vfiles:info', (rel: unknown) => svc.info(str(rel)));
  handle('vfiles:folder-for', (note: unknown) => svc.folderFor(noteRel(note)));
  handle('vfiles:set', async (rel: unknown, patch: unknown) => {
    await ipc.requireCreate();
    const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
    const pick = (k: string) => (k in p ? (p[k] === null ? null : str(p[k], 600)) : undefined);
    return svc.set(svc.fileRel(rel), { purpose: pick('purpose'), title: pick('title'), summary: pick('summary'), record: pick('record') });
  });
  handle('vfiles:summarise', async (rel: unknown) => {
    await ipc.requireCreate();
    return svc.summarise(svc.fileRel(rel));
  });
  handle('vfiles:compare', (rel: unknown, a: unknown, b: unknown) => {
    if (typeof a !== 'number' || typeof b !== 'number') throw new Error('Choose two versions.');
    return svc.compare(svc.fileRel(rel), a, b);
  });
  handle('vfiles:restore', async (rel: unknown, n: unknown) => {
    await ipc.requireCreate();
    if (typeof n !== 'number') throw new Error('Which version?');
    await svc.restore(svc.fileRel(rel), n);
    return svc.info(svc.fileRel(rel));
  });
  handle('vfiles:add-version', async (rel: unknown, from: unknown) => {
    await ipc.requireCreate();
    const file = svc.fileRel(rel);
    const chosen = typeof from === 'string' && path.isAbsolute(from) ? [from] : await ipc.chooseFiles({ title: `A newer version of ${baseOf(file)}`, multiple: false });
    if (!chosen?.length) return null;
    const st = await fsp.stat(chosen[0]);
    if (st.size > BIG_FILE) {
      const s = await svc.importPath({ folder: folderOf(file), src: chosen[0], name: baseOf(file), same: 'version', how: 'version' });
      return { importing: s };
    }
    await svc.addVersion(file, chosen[0], { source: { by: 'you', how: 'version', from: chosen[0], at: new Date().toISOString() } });
    return { info: await svc.info(file) };
  });
  // Files added to a record from this PC: chosen in a dialog (no paths), or dropped (paths). Big ones carry on after a break.
  handle('vfiles:add', async (record: unknown, paths: unknown, same: unknown, how: unknown) => {
    await ipc.requireCreate();
    const rec = noteRel(record);
    const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string' && path.isAbsolute(p)).slice(0, 200) : await ipc.chooseFiles({ title: 'Add files', multiple: true });
    if (!list?.length) return { placed: [], importing: [], problems: [] };
    const placed: string[] = [];
    const importing: ImportState[] = [];
    const problems: string[] = [];
    const via: SourceHow = how === 'dropped' ? 'dropped' : 'added';
    for (const p of list) {
      try {
        const st = await fsp.stat(p);
        if (!st.isFile()) continue;
        if (st.size > BIG_FILE) importing.push(await svc.importPath({ record: rec, src: p, same: sameOf(same), how: via }));
        else placed.push((await svc.place({ record: rec, src: p, same: sameOf(same), source: { by: 'you', how: via, from: p, at: new Date().toISOString() } })).rel);
      } catch (err) {
        problems.push(`${path.basename(p)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { placed, importing, problems };
  });
  handle('vfiles:add-bytes', async (record: unknown, name: unknown, bytes: unknown, same: unknown) => {
    await ipc.requireCreate();
    if (!(bytes instanceof Uint8Array)) throw new Error('That file could not be read.');
    return svc.placeBytes({ record: noteRel(record), name: cleanName(name, 'Picture.png'), bytes, same: sameOf(same), source: { by: 'you', how: 'dropped', at: new Date().toISOString() } });
  });
  /** Which of these names a record's Files folder has already (to ask "a new version, or keep both?"). */
  handle('vfiles:taken', async (record: unknown, names: unknown) => {
    const folder = svc.folderFor(noteRel(record));
    const have = new Set((await fsp.readdir(svc.abs(folder)).catch(() => [] as string[])).map((n) => n.toLowerCase()));
    return (Array.isArray(names) ? names : []).filter((n): n is string => typeof n === 'string' && have.has(cleanName(n).toLowerCase()));
  });
  handle('vfiles:reference', async (record: unknown, from: unknown) => {
    await ipc.requireCreate();
    const chosen = typeof from === 'string' && path.isAbsolute(from) ? [from] : await ipc.chooseFiles({ title: 'Link a file where it is on this PC (nothing is copied)', multiple: false });
    if (!chosen?.length) return null;
    return svc.reference({ record: noteRel(record), path: chosen[0] });
  });
  // A linked file that would run something is never handed to the shell (its card's Show in folder still works).
  handle('vfiles:open-ref', async (folder: unknown, name: unknown) => ipc.openPath(await svc.referenceToOpen(str(folder), str(name, 200))));
  handle('vfiles:show-ref', async (folder: unknown, name: unknown) => ipc.showInFolder(await svc.referencePath(str(folder), str(name, 200))));
  handle('vfiles:forget-ref', async (folder: unknown, name: unknown) => {
    await ipc.requireCreate();
    await svc.forgetReference(str(folder), str(name, 200));
  });
  handle('vfiles:open-version', async (rel: unknown, n: unknown) => {
    const file = svc.fileRel(rel);
    const row = (await svc.versions(file)).find((r) => r.n === n);
    if (!row) throw new Error('That version isn’t kept any more.');
    await ipc.openPath(svc.abs(row.path));
  });
  handle('vfiles:imports', () => svc.importList());
  handle('vfiles:import-resume', (id: unknown) => svc.importResume(str(id, 60)));
  handle('vfiles:import-stop', (id: unknown, cancel: unknown) => svc.importStop(str(id, 60), cancel === true));
  handle('vfiles:import-begin', async (o: unknown) => {
    await ipc.requireCreate();
    const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
    return svc.importBegin({ record: noteRel(x.record), name: str(x.name, 200), size: typeof x.size === 'number' ? x.size : 0, same: sameOf(x.same) });
  });
  handle('vfiles:import-piece', (id: unknown, offset: unknown, bytes: unknown) => {
    if (typeof offset !== 'number' || !(bytes instanceof Uint8Array)) throw new Error('That piece couldn’t be read.');
    return svc.importPiece(str(id, 60), offset, bytes);
  });
  handle('vfiles:migration-plan', () => svc.migrationPlan());
  handle('vfiles:migration-apply', async (choices: unknown) => {
    await ipc.requireCreate();
    const c: Record<string, string> = {};
    if (choices && typeof choices === 'object') for (const [k, v] of Object.entries(choices as Record<string, unknown>)) if (typeof v === 'string') c[k] = v;
    return svc.migrationApply(c);
  });
  handle('vfiles:migration-undo', async () => {
    await ipc.requireCreate();
    return svc.migrationUndo();
  });
}
