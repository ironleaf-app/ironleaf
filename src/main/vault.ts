// File access for one vault. Every path the renderer sends goes through
// resolve(), which refuses anything outside the vault folder.

import { EventEmitter } from 'node:events';
import { promises as fsp, readdirSync, watch, type FSWatcher } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { shell } from 'electron';
import { isPrivatePath } from '../shared/private';
import { win32Abs } from '../shared/paths';
import { AUDIO_EXT } from '../shared/assets';
import { textVersion } from '../shared/project-file';
import type { CheckedWrite } from '../shared/types';
import { conflictName } from './sync-folder';
import { KeyedQueue, MAX_EDIT_BYTES, renameWithRetry, tooBigToOpen, tooBigToSave, writeFileAtomic } from './save-guard';

/** The text without a leading byte-order mark (U+FEFF). */
export const withoutBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** A Windows \\?\ path back to its ordinary form, for comparing and showing; anything else unchanged. */
const unwin = (p: string): string => (p.startsWith('\\\\?\\') ? p.slice(4) : p);

/** A file error's code (EPERM, EIO, ENAMETOOLONG…), or UNKNOWN. */
/** Codes that say an entry is not there (as opposed to there but unreadable just now). */
const GONE_CODES = new Set(['ENOENT', 'ENOTDIR']);

/** Whether `rel` is an unreadable entry or lies inside an unreadable folder of the last listing. */
export function underUnreadable(rel: string, unreadable: readonly { rel: string; code: string }[]): boolean {
  return unreadable.some((s) => !GONE_CODES.has(s.code) && (rel === s.rel || rel.startsWith(`${s.rel}/`)));
}

/** The indexed notes a listing no longer has that are really gone: never one the listing could not read (or that sits
 *  in a folder it could not read), and only when the file itself is confirmed missing (security review, 20 Nov 2026:
 *  a folder OneDrive or another program refused for a moment emptied the index and blanked open tabs). */
export async function confirmedMissing(indexed: readonly string[], present: ReadonlySet<string>, unreadable: readonly { rel: string; code: string }[], gone: (rel: string) => Promise<boolean>): Promise<string[]> {
  const out: string[] = [];
  for (const rel of indexed) {
    if (present.has(rel) || underUnreadable(rel, unreadable)) continue;
    if (await gone(rel).catch(() => false)) out.push(rel);
  }
  return out;
}

const errCode = (err: unknown): string => (err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string' ? (err as { code: string }).code : 'UNKNOWN');

/** Folders that belong to apps or tools, not notes. Any folder starting with "." is skipped too. */
const IGNORED_DIRS = new Set(['node_modules']);
// Private notes' folder at the top (src/shared/private.ts) is the encrypted store's alone: never listed, watched, read or
// written here.
const isPrivateTop = (seg: string | undefined) => !!seg && isPrivatePath(seg);

export interface FileEntry {
  rel: string;
  mtime: number;
  size: number;
  /** When the file was made (ms), when the PC keeps it (stat()). */
  born?: number;
}

/** What a file is, by its name: notes, canvases and views are text Ironleaf edits; the rest are attachments it shows. */
export type FileKind = 'note' | 'canvas' | 'view' | 'image' | 'pdf' | 'audio' | 'video' | 'other';
const KINDS: [RegExp, FileKind][] = [
  [/\.md$/i, 'note'],
  [/\.canvas$/i, 'canvas'],
  // A drawing (src/shared/drawing.ts; 21 Oct 2026, gap G23): JSON Ironleaf edits, listed and kept with the canvases.
  [/\.nvdraw$/i, 'canvas'],
  // A view over notes (src/shared/views.ts): a small JSON file the person owns, opened as its own tab like a canvas; a
  // .base file from another notes app opens as a view too (src/shared/base-file.ts, 21 Oct 2026).
  [/\.view\.json$/i, 'view'],
  [/\.base$/i, 'view'],
  [/\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i, 'image'],
  [/\.pdf$/i, 'pdf'],
  // .weba: a meeting recording in Opus where Chromium can't make .m4a (src/shared/recorder.ts).
  [new RegExp(`\\.(${AUDIO_EXT.source.slice(1, -1)})$`, 'i'), 'audio'],
  [/\.(mp4|mov|mkv|webm|ogv|m4v)$/i, 'video'],
];
export const kindOf = (name: string): FileKind => KINDS.find(([re]) => re.test(name))?.[1] ?? 'other';

export interface ListedFile extends FileEntry {
  kind: FileKind;
}

/**
 * The one bin (8.0 U13, the former host app's native-runtime/plugins/desktop/bin.mjs): inside the former host app, a
 * note, file or folder the vault deletes goes to the former host app's Recently deleted for 30 days, listed beside what
 * the former host app deleted, with Restore; on its own, or when it can't be moved there (another drive refusing, a file
 * in use), Windows' Bin as before. Never a hard delete either way. Set once by the app (app.ts) from its host.
 */
export type VaultBin = (item: { abs: string; rel: string; folder: boolean; library: string }) => Promise<boolean>;
let vaultBin: VaultBin | null = null;
export function setVaultBin(bin: VaultBin | null): void {
  vaultBin = bin;
}
async function toBinOrTrash(abs: string, rel: string, library: string): Promise<void> {
  if (vaultBin) {
    let folder = false;
    try {
      folder = (await fsp.stat(abs)).isDirectory();
    } catch {
      /* gone already: the Bin says so in its own words */
    }
    if (await vaultBin({ abs, rel, folder, library }).catch(() => false)) return;
  }
  await shell.trashItem(abs);
}

/** What a watched file's news means: its open tab takes it (`text`), or the file list is read again (`rescan`). */
export type WatchedKind = 'text' | 'rescan' | 'ignore';

/** A text Ironleaf edits and keeps open (a `.base` view too: F5 left it rescanning, so it never reloaded). */
const TEXT_WATCHED = /\.(md|canvas|nvdraw|view\.json|base)$/i;

export class Vault extends EventEmitter {
  private watcher?: FSWatcher;
  private dirWatchers: FSWatcher[] = [];
  private watchedDirs = new Set<string>();
  private timers = new Map<string, NodeJS.Timeout>();
  private rescanTimer?: NodeJS.Timeout;
  private rewatchTimer?: NodeJS.Timeout;
  private rewalkTimer?: NodeJS.Timeout;
  private rewatchAttempts = 0;
  private writes = new KeyedQueue();
  private watchFn: typeof watch = watch;
  private forceFallback = false;

  private constructor(readonly root: string) {
    super();
  }

  static async open(folder: string): Promise<Vault> {
    const root = await fsp.realpath(folder);
    const stat = await fsp.stat(root);
    if (!stat.isDirectory()) throw new Error('A vault must be a folder.');
    return new Vault(root);
  }

  get name(): string {
    return path.basename(this.root);
  }

  /** Folders inside that are vaults of their own (they hold .neuralvault/vault.json: Documents\Ironleaf\Work inside the
   *  main vault, src/main/vault-home.ts), found by each listing: never this vault's notes. */
  private nested = new Set<string>();

  isIgnored(rel: string): boolean {
    const segs = rel.split('/');
    if (isPrivateTop(segs[0]) || segs.some((seg) => seg.startsWith('.') || IGNORED_DIRS.has(seg))) return true;
    if (this.nested.size) for (let i = 1; i < segs.length; i++) if (this.nested.has(segs.slice(0, i).join('/').toLowerCase())) return true;
    return false;
  }

  /** Whether a folder met while listing is a vault of its own (and so left out), noting it when it is. */
  private async isNested(abs: string, entries?: import('node:fs').Dirent[]): Promise<boolean> {
    const list = entries ?? (await this.io.readdir(win32Abs(abs, process.platform)).catch(() => []));
    if (!list.some((e) => e.name === '.neuralvault' && e.isDirectory())) return false;
    if (!(await fsp.stat(path.join(abs, '.neuralvault', 'vault.json')).then(() => true, () => false))) return false;
    this.nested.add(this.toRel(abs).toLowerCase());
    return true;
  }

  /** Turns a vault-relative path into an absolute one, refusing paths that escape the vault. On Windows a path with
   *  trailing dots or spaces comes back in the \\?\ form, which skips Windows' stripping so the file is reached as
   *  named (r2, Nov 2026); everywhere else, and when clean, it is the ordinary path. */
  resolve(rel: unknown): string {
    if (typeof rel !== 'string' || rel.length === 0 || rel.includes('\0')) throw new Error('Invalid path.');
    const abs = path.resolve(this.root, rel);
    const inside = path.relative(this.root, abs);
    if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('Path is outside the vault.');
    if (this.isIgnored(inside.split(path.sep).join('/'))) throw new Error('That folder is reserved.');
    return win32Abs(abs, process.platform);
  }

  private resolveNote(rel: unknown): string {
    const abs = this.resolve(rel);
    if (!abs.toLowerCase().endsWith('.md')) throw new Error('Only Markdown notes (.md) can be opened.');
    return abs;
  }

  /** A text file Ironleaf edits: a note, a canvas or a view. */
  private resolveText(rel: unknown): string {
    const abs = this.resolve(rel);
    const kind = kindOf(abs);
    if (kind !== 'note' && kind !== 'canvas' && kind !== 'view') throw new Error('Only notes (.md), canvases (.canvas), drawings (.nvdraw) and views (.view.json, .base) can be edited.');
    return abs;
  }

  /** Makes sure the real (symlink-resolved) parent folder is still inside the vault. */
  private async ensureParent(abs: string): Promise<void> {
    const dir = path.dirname(abs);
    await fsp.mkdir(dir, { recursive: true });
    const realDir = await fsp.realpath(dir);
    const inside = path.relative(this.root, unwin(realDir));
    if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('Path is outside the vault.');
  }

  /** Makes sure the real (symlink-resolved) path itself is still inside the vault (a move's source may sit behind
   *  a link the lexical path cannot see: without this an outside file could be pulled in, or a vault file pushed
   *  out, through a symlinked folder — or a junction on Windows). Gone since listed: the caller says so. */
  private async ensureInside(abs: string): Promise<void> {
    const real = await fsp.realpath(unwin(abs)).catch(() => null);
    if (!real) return;
    const inside = path.relative(this.root, unwin(real));
    if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('Path is outside the vault.');
  }

  toRel(abs: string): string {
    return path.relative(this.root, unwin(abs)).split(path.sep).join('/');
  }

  /** The file calls the listings make: fs by default, swapped in tests to stand in for a drive that refuses some entries. */
  io: { readdir: (dir: string) => Promise<import('node:fs').Dirent[]>; stat: (abs: string) => Promise<{ mtimeMs: number; size: number; birthtimeMs?: number }> } = {
    readdir: (dir) => fsp.readdir(dir, { withFileTypes: true }),
    stat: (abs) => fsp.stat(abs),
  };

  /** Entries the last listing couldn't read (a OneDrive file only in the cloud with OneDrive not running, a file
   *  another program holds, a folder Windows refuses, a path too long): skipped and counted, never failing the list. */
  lastSkipped: { rel: string; code: string }[] = [];

  /** What the last whole listing had, so an entry unreadable this time keeps its place (its files and folders as
   *  last seen) instead of reading as deleted: the index keeps it and open tabs stay. */
  private listedBefore: { files: Map<string, ListedFile>; folders: Set<string> } | null = null;

  /** True only when the file is confirmed not there (ENOENT/ENOTDIR); there, or unreadable, is not missing. */
  async isGone(rel: string): Promise<boolean> {
    try {
      await this.io.stat(win32Abs(this.resolve(rel), process.platform));
      return false;
    } catch (err) {
      return GONE_CODES.has(errCode(err));
    }
  }

  /** One folder's entries; a folder that can't be read is noted and treated as empty (the top folder still throws:
   *  then the notes folder itself is gone or refused, and the caller says so). */
  private async entriesOf(dir: string, skipped: { rel: string; code: string }[]): Promise<import('node:fs').Dirent[]> {
    try {
      return await this.io.readdir(win32Abs(dir, process.platform));
    } catch (err) {
      if (dir === this.root) throw err;
      skipped.push({ rel: this.toRel(dir), code: errCode(err) });
      return [];
    }
  }

  async listMarkdown(): Promise<FileEntry[]> {
    const out: FileEntry[] = [];
    const skipped: { rel: string; code: string }[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await this.entriesOf(dir, skipped);
      if (dir !== this.root && (await this.isNested(dir, entries))) return;
      await Promise.all(
        entries.map(async (entry) => {
          // Symlinks are skipped so a link can't pull files from outside the vault into it.
          if (entry.isSymbolicLink() || entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name) || (dir === this.root && isPrivateTop(entry.name))) return;
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) return walk(abs);
          if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
            try {
              const stat = await this.io.stat(win32Abs(abs, process.platform));
              out.push({ rel: this.toRel(abs), mtime: stat.mtimeMs, size: stat.size });
            } catch (err) {
              skipped.push({ rel: this.toRel(abs), code: errCode(err) });
            }
          }
        }),
      );
    };
    await walk(this.root);
    this.lastSkipped = skipped;
    return out.sort((a, b) => a.rel.localeCompare(b.rel));
  }

  /** Every file Ironleaf shows (notes, canvases, attachments) and every folder, empty ones too. An entry that can't be
   *  read is left out and counted (`skipped`), so one bad file never fails the whole list (20 Nov 2026). */
  async listAll(): Promise<{ files: ListedFile[]; folders: string[]; skipped: number }> {
    const files: ListedFile[] = [];
    const folders: string[] = [];
    const skipped: { rel: string; code: string }[] = [];
    this.nested.clear();
    const walk = async (dir: string): Promise<void> => {
      const entries = await this.entriesOf(dir, skipped);
      await Promise.all(
        entries.map(async (entry) => {
          if (entry.isSymbolicLink() || entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name) || entry.name.endsWith('.nvtmp') || (dir === this.root && isPrivateTop(entry.name))) return;
          const abs = path.join(dir, entry.name);
          try {
            if (entry.isDirectory()) {
              if (await this.isNested(abs)) return;
              folders.push(this.toRel(abs));
              return await walk(abs);
            }
            if (!entry.isFile()) return;
            const stat = await this.io.stat(win32Abs(abs, process.platform));
            files.push({ rel: this.toRel(abs), mtime: stat.mtimeMs, size: stat.size, kind: kindOf(entry.name) });
          } catch (err) {
            skipped.push({ rel: this.toRel(abs), code: errCode(err) });
          }
        }),
      );
    };
    await walk(this.root);
    this.lastSkipped = skipped;
    // Entries that could not be read keep what the last listing had under them (a refused folder is not an empty one,
    // a locked file is not a deleted one); an entry that is gone (ENOENT) is not kept.
    const before = this.listedBefore;
    if (before && skipped.some((s) => !GONE_CODES.has(s.code))) {
      const haveFiles = new Set(files.map((f) => f.rel));
      const haveFolders = new Set(folders);
      for (const [rel, f] of before.files) if (!haveFiles.has(rel) && underUnreadable(rel, skipped)) files.push(f);
      for (const rel of before.folders) if (!haveFolders.has(rel) && underUnreadable(rel, skipped)) folders.push(rel);
    }
    this.listedBefore = { files: new Map(files.map((f) => [f.rel, f])), folders: new Set(folders) };
    return { files: files.sort((a, b) => a.rel.localeCompare(b.rel)), folders: folders.sort((a, b) => a.localeCompare(b)), skipped: skipped.length };
  }

  /** Crash temps (*.nvtmp) older than an hour, swept: every atomic write leaves one beside its file until it lands, so
   *  a crash litters them forever unless opening the vault clears them. Fresh ones stay (another PC may be writing
   *  now). Returns how many went. Never touches a vault nested inside. */
  async sweepTemps(): Promise<number> {
    const cutoff = Date.now() - 3600_000;
    let swept = 0;
    const walk = async (dir: string): Promise<void> => {
      if (swept >= 500) return;
      const entries = await fsp.readdir(win32Abs(dir, process.platform), { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (swept >= 500 || entry.isSymbolicLink()) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name) || (await this.isNested(abs))) continue;
          await walk(abs);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith('.nvtmp')) continue;
        const stat = await fsp.stat(win32Abs(abs, process.platform)).catch(() => null);
        if (stat && stat.mtimeMs < cutoff) await fsp.unlink(win32Abs(abs, process.platform)).then(() => { swept++; }).catch(() => {});
      }
    };
    await walk(this.root);
    return swept;
  }

  // A note saved by some Windows programs (Windows PowerShell 5, older Notepad) starts with a byte-order mark; every
  // reader (front matter, projects, templates, the editor) expects the note's own first character, so it goes here.
  async readText(rel: unknown): Promise<string> {
    return withoutBom(await fsp.readFile(this.resolveText(rel), 'utf8'));
  }

  /**
   * A file opened in the editor: its words with the fingerprint a guarded save passes back (`writeTextChecked`).
   * Too big to edit is refused in plain words before the window hangs (F7); the file on disk is untouched, and the
   * index keeps reading it whole, so search, ticks, and links still see it.
   */
  async readTextForEdit(rel: unknown): Promise<{ text: string; version: string }> {
    const abs = this.resolveText(rel);
    const stat = await fsp.stat(abs);
    if (stat.size > MAX_EDIT_BYTES) throw new Error(tooBigToOpen(kindOf(abs) === 'note' ? 'note' : 'file'));
    const text = withoutBom(await fsp.readFile(abs, 'utf8'));
    if (Buffer.byteLength(text, 'utf8') > MAX_EDIT_BYTES) throw new Error(tooBigToOpen(kindOf(abs) === 'note' ? 'note' : 'file'));
    return { text, version: textVersion(text) };
  }

  async writeText(rel: unknown, content: unknown): Promise<void> {
    if (typeof content !== 'string') throw new Error('The file’s content must be text.');
    const abs = this.resolveText(rel);
    await this.writes.run(abs, async () => {
      await this.ensureParent(abs);
      await writeFileAtomic(abs, content);
    });
  }

  /**
   * A guarded save (Nov 2026, nv-save: Ironleaf never loses an edit). `base` is the fingerprint of the text the
   * saver read (`readForEdit`'s `version`); when the file on disk no longer matches it, the disk keeps the other
   * change and the incoming words go into a conflict copy beside it (the PC sync's own "(conflict, …)" name, so the
   * Backup and sync page reviews them the same way). A file gone since it was read is never recreated (`missing`).
   * `base` null is an explicit blind write (a maintenance write, an undo): it always lands. The check and the write
   * run inside the file's queue, so two saves can never interleave.
   */
  async writeTextChecked(rel: unknown, content: unknown, base: string | null): Promise<CheckedWrite> {
    if (typeof content !== 'string') throw new Error('The file’s content must be text.');
    const abs = this.resolveText(rel);
    return this.writes.run(abs, () => this.guarded(abs, this.toRel(abs), content, base, (r) => this.resolveText(r)));
  }

  private async guarded(abs: string, rel: string, content: string, base: string | null, resolve: (rel: string) => string): Promise<CheckedWrite> {
    if (Buffer.byteLength(content, 'utf8') > MAX_EDIT_BYTES) throw new Error(tooBigToSave());
    await this.ensureParent(abs);
    const current = await fsp.readFile(abs, 'utf8').then(
      (t) => withoutBom(t),
      (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      },
    );
    if (current === null) {
      // Gone since it was read (deleted or renamed elsewhere): never silently recreated (F3).
      if (base !== null) return { ok: false, missing: true };
      await writeFileAtomic(abs, content);
      return { ok: true };
    }
    if (base !== null && textVersion(current) !== base) {
      const copy = await this.conflictRel(rel);
      await writeFileAtomic(resolve(copy), content);
      return { ok: false, conflict: copy };
    }
    await writeFileAtomic(abs, content);
    return { ok: true, ...(current.trim() && !content.trim() ? { emptied: true } : {}) };
  }

  /** A conflict copy's free name beside its note (`Plans (conflict, 2 Nov 2026 10.30 am, from LAPTOP).md` and, when
   *  taken, `…from LAPTOP 2)`, still recognised by the Backup and sync page). Never taken twice, never over one. */
  private async conflictRel(rel: string): Promise<string> {
    const now = Date.now();
    // A view's two-part ending stays whole, so its copy still opens as a view.
    const view = /\.view\.json$/i.test(rel);
    const via = view ? rel.replace(/\.view\.json$/i, '.viewjson') : rel;
    const fix = (cand: string): string => (view ? cand.replace(/\.viewjson$/, '.view.json') : cand);
    for (let i = 0; i < 100; i++) {
      const fixed = fix(conflictName(via, now, i === 0 ? hostname() : `${hostname()} ${i + 1}`));
      if (!(await this.any(fixed))) return fixed;
    }
    return fix(conflictName(via, now, `${hostname()} ${Math.random().toString(36).slice(2, 8)}`));
  }

  // Whole or not at all (9.5 O1: a crash mid-import never leaves half a note): through the file's queue and the
  // atomic write every save uses, never over a file that is there (the wx rule, checked in the queue).
  async createText(rel: unknown, content = ''): Promise<void> {
    const abs = this.resolveText(rel);
    await this.writes.run(abs, async () => {
      await this.ensureParent(abs);
      if (await fsp.access(abs).then(() => true, () => false)) throw Object.assign(new Error(`EEXIST: file already exists, open '${abs}'`), { code: 'EEXIST' });
      await writeFileAtomic(abs, content);
    });
  }

  /** An attachment (a pasted or dropped picture, a PDF…): never over a file that is there. */
  async writeBinary(rel: unknown, data: Uint8Array): Promise<void> {
    const abs = this.resolve(rel);
    const kind = kindOf(abs);
    if (kind === 'note' || kind === 'canvas' || kind === 'view' || kind === 'other') throw new Error('Only pictures, PDFs, audio and video can be added as attachments.');
    if (!(data instanceof Uint8Array) || data.byteLength > 200 * 1024 * 1024) throw new Error('That file is too large to add.');
    // Whole or not at all (9.5 O1): as createText above.
    await this.writes.run(abs, async () => {
      await this.ensureParent(abs);
      if (await fsp.access(abs).then(() => true, () => false)) throw Object.assign(new Error(`EEXIST: file already exists, open '${abs}'`), { code: 'EEXIST' });
      await writeFileAtomic(abs, data);
    });
  }

  async makeFolder(rel: unknown): Promise<void> {
    const abs = this.resolve(rel);
    await this.ensureParent(path.join(abs, 'x'));
  }

  /** Whether any file or folder is at this path. */
  async any(rel: unknown): Promise<boolean> {
    try {
      await fsp.access(this.resolve(rel));
      return true;
    } catch {
      return false;
    }
  }

  async isFolder(rel: unknown): Promise<boolean> {
    try {
      return (await fsp.stat(this.resolve(rel))).isDirectory();
    } catch {
      return false;
    }
  }

  /** Something else is at `dest` already. A rename that only changes case ("note" → "Note") finds the same file there
   *  on Windows and macOS, where it is no clash; on a case-sensitive disk the other spelling can be another file, which
   *  the rename would replace (20 Nov 2026 audit): the two are told apart by the file itself, not by the name. */
  private async takenBy(src: string, dest: string): Promise<boolean> {
    const there = await fsp.lstat(dest).catch(() => null);
    if (!there) return false;
    if (src.toLowerCase() !== dest.toLowerCase()) return true;
    const self = await fsp.lstat(src).catch(() => null);
    return !self || self.ino !== there.ino || self.dev !== there.dev;
  }

  /** Moves or renames a file or folder, never over one that is there. */
  async move(from: unknown, to: unknown): Promise<void> {
    const src = this.resolve(from);
    const dest = this.resolve(to);
    await this.ensureInside(src);
    if (src.toLowerCase() === dest.toLowerCase() && src === dest) return;
    const inside = path.relative(src, dest);
    if (inside && !inside.startsWith('..') && !path.isAbsolute(inside)) throw new Error('A folder can’t be moved into itself.');
    if (await this.takenBy(src, dest)) throw new Error('Something with that name is already there.');
    await this.ensureParent(dest);
    // Queued with saves to it (a flush racing a rename lands before or after, never halfway).
    await this.writes.run(src, () => renameWithRetry(src, dest, fsp.rename, 'moved'));
  }

  /** A file or folder to Recently deleted inside the former host app, else the operating system's trash; never a hard delete. */
  async trashPath(rel: unknown): Promise<void> {
    const abs = this.resolve(rel);
    await toBinOrTrash(abs, this.toRel(abs), this.root);
  }

  absolute(rel: unknown): string {
    return this.resolve(rel);
  }

  async stat(rel: string): Promise<FileEntry> {
    const stat = await fsp.stat(this.resolveNote(rel));
    return { rel, mtime: stat.mtimeMs, size: stat.size, ...(stat.birthtimeMs > 0 ? { born: stat.birthtimeMs } : {}) };
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await fsp.access(this.resolveNote(rel));
      return true;
    } catch {
      return false;
    }
  }

  async read(rel: unknown): Promise<string> {
    return withoutBom(await fsp.readFile(this.resolveNote(rel), 'utf8'));
  }

  /** A note opened in the editor: its words with the fingerprint a guarded save passes back (`writeChecked`). */
  async readForEdit(rel: unknown): Promise<{ text: string; version: string }> {
    const abs = this.resolveNote(rel);
    const stat = await fsp.stat(abs);
    if (stat.size > MAX_EDIT_BYTES) throw new Error(tooBigToOpen('note'));
    const text = withoutBom(await fsp.readFile(abs, 'utf8'));
    if (Buffer.byteLength(text, 'utf8') > MAX_EDIT_BYTES) throw new Error(tooBigToOpen('note'));
    return { text, version: textVersion(text) };
  }

  /** Writes through a temporary file and a rename, so a crash never leaves half a note. */
  async write(rel: unknown, content: unknown): Promise<void> {
    if (typeof content !== 'string') throw new Error('Note content must be text.');
    const abs = this.resolveNote(rel);
    await this.writes.run(abs, async () => {
      await this.ensureParent(abs);
      await writeFileAtomic(abs, content);
    });
  }

  /** A note's guarded save: the check in `writeTextChecked`, for `.md` notes. */
  async writeChecked(rel: unknown, content: unknown, base: string | null): Promise<CheckedWrite> {
    if (typeof content !== 'string') throw new Error('Note content must be text.');
    const abs = this.resolveNote(rel);
    return this.writes.run(abs, () => this.guarded(abs, this.toRel(abs), content, base, (r) => this.resolveNote(r)));
  }

  async create(rel: unknown, content = ''): Promise<void> {
    const abs = this.resolveNote(rel);
    await this.ensureParent(abs);
    // "wx" fails if the file already exists, so nothing gets overwritten.
    await fsp.writeFile(abs, content, { encoding: 'utf8', flag: 'wx' });
  }

  async rename(from: unknown, to: unknown): Promise<void> {
    const src = this.resolveNote(from);
    const dest = this.resolveNote(to);
    await this.ensureInside(src);
    if (await this.takenBy(src, dest)) {
      throw new Error('A note with that name already exists.');
    }
    await this.ensureParent(dest);
    await this.writes.run(src, () => renameWithRetry(src, dest, fsp.rename, 'moved'));
  }

  /** Moves a note to Recently deleted inside the former host app, else the operating system's trash; never a hard delete. */
  async trash(rel: unknown): Promise<void> {
    const abs = this.resolveNote(rel);
    await toBinOrTrash(abs, this.toRel(abs), this.root);
  }

  /** What one watched file's news means (a null name still means something changed: rescan, never drop it). */
  classify(filename: unknown): WatchedKind {
    if (!filename) return 'rescan';
    const rel = filename.toString().split(path.sep).join('/');
    if (this.isIgnored(rel) || rel.endsWith('.nvtmp')) return 'ignore';
    return TEXT_WATCHED.test(rel) ? 'text' : 'rescan';
  }

  private onWatchEvent(filename: unknown): void {
    const kind = this.classify(filename);
    if (kind === 'ignore') return;
    this.rewatchAttempts = 0;
    if (kind === 'text') {
      const rel = (filename as NonNullable<unknown>).toString().split(path.sep).join('/');
      clearTimeout(this.timers.get(rel));
      this.timers.set(
        rel,
        setTimeout(() => {
          this.timers.delete(rel);
          this.emit('change', rel);
        }, 150),
      );
      return;
    }
    // A folder was added, renamed or removed: the per-file events aren't reliable, so rescan.
    clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => this.emit('rescan'), 400);
    // New folders need watching too (the per-folder fallback below).
    if (this.dirWatchers.length) {
      clearTimeout(this.rewalkTimer);
      this.rewalkTimer = setTimeout(() => this.watchNewDirs(), 1000);
    }
  }

  private attachWatcher(w: FSWatcher): void {
    w.on('error', () => {
      // A watcher that died (an exhausted notifier, a share dropped): rescan now and watch again, backing off.
      this.emit('rescan');
      this.scheduleRewatch();
    });
  }

  private scheduleRewatch(): void {
    if (this.rewatchTimer || !this.listenerCount('change') && !this.listenerCount('rescan')) return;
    const wait = [1000, 5000, 30000][Math.min(this.rewatchAttempts, 2)];
    this.rewatchAttempts++;
    this.rewatchTimer = setTimeout(() => {
      this.rewatchTimer = undefined;
      try {
        this.watch();
      } catch {
        this.scheduleRewatch();
      }
    }, wait);
  }

  /** Every folder under the vault, for watching one by one where one recursive watch won't do (F5). */
  private listDirs(): string[] {
    const out: string[] = [this.root];
    const walk = (dir: string): void => {
      let entries: import('node:fs').Dirent[] = [];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const abs = path.join(dir, entry.name);
        const rel = this.toRel(abs);
        if (this.isIgnored(rel)) continue;
        out.push(abs);
        walk(abs);
      }
    };
    walk(this.root);
    return out;
  }

  private watchWith(dirs: string[], watchFn: typeof watch): void {
    for (const dir of dirs) {
      if (this.watchedDirs.has(dir)) continue;
      try {
        // A folder's own watcher names the file inside that folder only ("Note.md", never "Sub/Note.md"): put the
        // folder in front, or a change in a subfolder reads as a note at the top (20 Nov 2026: Linux missed outside
        // edits in subfolders, and a top-level note of the same name was read again, or dropped when there was none).
        const prefix = path.relative(this.root, dir);
        const w = watchFn(dir, { recursive: false }, (_event, filename) => this.onWatchEvent(filename && prefix ? path.join(prefix, filename.toString()) : filename));
        this.attachWatcher(w);
        this.dirWatchers.push(w);
        this.watchedDirs.add(dir);
      } catch {
        // A folder that can't be watched (gone, a share refusing): the rescan still catches its files up.
      }
    }
  }

  private watchNewDirs(): void {
    this.rewalkTimer = undefined;
    if (!this.dirWatchers.length) return;
    this.watchWith(
      this.listDirs().filter((d) => !this.watchedDirs.has(d)),
      this.watchFn,
    );
  }

  private closeWatchers(): void {
    this.watcher?.close();
    this.watcher = undefined;
    for (const w of this.dirWatchers) w.close();
    this.dirWatchers = [];
    this.watchedDirs.clear();
    clearTimeout(this.rewatchTimer);
    this.rewatchTimer = undefined;
    clearTimeout(this.rewalkTimer);
    this.rewalkTimer = undefined;
  }

  /**
   * Keeps the window in step with the folder (OneDrive, another editor, the former host app writing in). One
   * recursive watch where the PC does it (Windows, macOS); every folder watched one by one elsewhere or when it
   * refuses (F5: Linux never recursed, so subfolder changes were missed outright). `watchFn`/`forceFallback` are the
   * tests' seam.
   */
  watch(opts?: { watchFn?: typeof watch; forceFallback?: boolean }): void {
    this.closeWatchers();
    if (opts?.watchFn) this.watchFn = opts.watchFn;
    if (opts?.forceFallback !== undefined) this.forceFallback = opts.forceFallback;
    const recursive = !this.forceFallback && (process.platform === 'win32' || process.platform === 'darwin');
    if (recursive) {
      try {
        this.watcher = this.watchFn(this.root, { recursive: true }, (_event, filename) => this.onWatchEvent(filename));
        this.attachWatcher(this.watcher);
        return;
      } catch {
        // A recursive watch refused (an exhausted notifier): fall through to every folder one by one.
      }
    }
    this.watchWith(this.listDirs(), this.watchFn);
  }

  close(): void {
    this.closeWatchers();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    clearTimeout(this.rescanTimer);
    this.removeAllListeners();
  }
}
