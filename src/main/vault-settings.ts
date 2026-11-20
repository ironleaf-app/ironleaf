// A keyed document on disk (src/shared/vault-settings.ts): the vault's settings in .neuralvault/settings.json, what
// Ironleaf remembers about the vault in .neuralvault/state/<name>.json, the person's preferences in personal.json.
//
// Two PCs can change the same file at once (each through its own OneDrive), so a write never puts this PC's copy over the
// file: it reads the file again, merges key by key (the newer change wins), and writes the result whole through a
// temporary file. OneDrive's and Dropbox's conflict copies of the file ("settings-OFFICE-PC.json") are merged in the same
// way and then removed. A mirror in Ironleaf's own data keeps this PC's copy too: a write the vault refused (no
// licence yet, the folder read-only, OneDrive holding the file) is kept there and goes in next time, and nothing is lost
// if the vault's copy goes missing.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { docConflictCopies, docText, docValues, emptyDoc, mergeDocs, MAX_DOC_BYTES, readDoc, sameDoc, setValues, type KeyedDoc } from '../shared/vault-settings';
import { KeyedQueue, writeFileAtomic } from './save-guard';

export type DiskState = 'unread' | 'ok' | 'missing' | 'unreadable';

export interface KeyedFileOptions {
  /** The file (in the vault, or in Ironleaf's data). */
  file: string;
  /** This PC's copy, in Ironleaf's own data (none for a file that is already there). */
  mirror?: string | null;
  kind: string;
  /** This PC's id (the `by` of each change). */
  device(): string;
  /** Whether the file may be written now (the vault's licence; a folder that can be written). */
  mayWrite?(): Promise<boolean>;
  now?(): number;
  log?(message: string): void;
}

async function readText(file: string): Promise<{ text: string | null; missing: boolean; mtime: number; size: number }> {
  try {
    const st = await fsp.stat(file);
    if (st.size > MAX_DOC_BYTES) return { text: null, missing: false, mtime: st.mtimeMs, size: st.size };
    return { text: await fsp.readFile(file, 'utf8'), missing: false, mtime: st.mtimeMs, size: st.size };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { text: null, missing: code === 'ENOENT' || code === 'ENOTDIR', mtime: 0, size: 0 };
  }
}

// One safe way to write, as notes do (save-guard.ts): temp, fsync, rename with a retry for brief Windows locks.
async function writeWhole(file: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, text);
}

// One lock per file across every KeyedFile in this process (2 Nov 2026, lnvset: two PCs saving the vault's settings
// at once never lose one): two writers for the same file never interleave a read-merge-write.
const fileLocks = new KeyedQueue();

/** Written by a newer Ironleaf (a later format): read-only here, never put aside or written over. */
function newerFormat(text: string): boolean {
  try {
    const v = JSON.parse(text.replace(/^\uFEFF/, '')) as { format?: unknown };
    return typeof v?.format === 'number' && v.format > 1;
  } catch {
    return false;
  }
}

export class KeyedFile {
  doc: KeyedDoc;
  disk: DiskState = 'unread';
  /** The file's time and size when last read or written here (another PC's change shows as a new time or size). */
  private mtime = 0;
  private size = 0;
  /** A change is kept (memory, mirror) but the file doesn't hold it yet: the next refresh flushes it. */
  private needsFlush = false;
  /** Conflict copies merged lately (Settings can say so). */
  mergedCopies = 0;
  /** The file was written by a newer Ironleaf: read-only here. */
  private newer = false;

  constructor(private readonly o: KeyedFileOptions) {
    this.doc = emptyDoc(o.kind);
  }

  get file(): string {
    return this.o.file;
  }

  values(): Record<string, unknown> {
    return docValues(this.doc);
  }

  /** One read or write at a time per file, across every KeyedFile for it (a write reads the file again first). */
  private inTurn<T>(fn: () => Promise<T>): Promise<T> {
    return fileLocks.run(this.o.file, fn);
  }

  /** Reads the file, its conflict copies and this PC's mirror, and puts them together; writes the result back when the
   *  file was missing, behind, or had copies beside it. Says whether the values changed. */
  load(): Promise<boolean> {
    return this.inTurn(() => this.loadNow());
  }

  private async loadNow(extra?: KeyedDoc): Promise<boolean> {
    const before = docText(this.doc);
    const disk = await readText(this.o.file);
    const fromDisk = readDoc(disk.text, this.o.kind);
    this.disk = fromDisk ? 'ok' : disk.missing ? 'missing' : 'unreadable';
    let merged = mergeDocs(this.doc, fromDisk, this.o.kind);
    // Conflict copies OneDrive or Dropbox left beside it.
    const dir = path.dirname(this.o.file);
    const copies = docConflictCopies(path.basename(this.o.file), await fsp.readdir(dir).catch(() => [] as string[]));
    const merging: string[] = [];
    for (const name of copies) {
      const c = readDoc((await readText(path.join(dir, name))).text, this.o.kind);
      if (!c) continue;
      merged = mergeDocs(merged, c, this.o.kind);
      merging.push(name);
    }
    let mirror: KeyedDoc | null = null;
    if (this.o.mirror) {
      mirror = readDoc((await readText(this.o.mirror)).text, this.o.kind);
      merged = mergeDocs(merged, mirror, this.o.kind);
    }
    if (extra) merged = mergeDocs(merged, extra, this.o.kind);
    this.doc = merged;
    this.mtime = disk.mtime;
    this.size = disk.size;
    // The file behind what this PC knows (a write that waited, copies merged, missing): written whole.
    const behind = !fromDisk || !sameDoc(fromDisk, merged) || merging.length > 0;
    this.newer = this.disk === 'unreadable' && disk.text !== null && newerFormat(disk.text);
    if (this.newer) {
      // Kept as it is; this PC's changes stay in its mirror.
    } else if (behind && Object.keys(merged.keys).length && this.disk !== 'unreadable') await this.writeDisk(merging);
    else if (this.disk === 'unreadable' && disk.text !== null) {
      // Half written, or not ours: kept aside (never lost), and this PC's copy written in its place.
      const aside = `${this.o.file.replace(/\.json$/i, '')}.unreadable-${Date.now()}.json`;
      await fsp.rename(this.o.file, aside).catch(() => undefined);
      this.o.log?.(`Ironleaf kept an unreadable ${path.basename(this.o.file)} aside as ${path.basename(aside)}.`);
      this.disk = 'missing';
      if (Object.keys(merged.keys).length) await this.writeDisk(merging);
    }
    if (this.o.mirror && (!mirror || !sameDoc(mirror, merged)))
      await writeWhole(this.o.mirror, docText(merged)).catch((err) => this.o.log?.(`Ironleaf could not keep its own copy of ${path.basename(this.o.file)}: ${err instanceof Error ? err.message : String(err)}`));
    return docText(this.doc) !== before;
  }

  private async writeDisk(merging: string[] = []): Promise<boolean> {
    if (this.newer) return false;
    if (this.o.mayWrite && !(await this.o.mayWrite().catch(() => false))) {
      this.needsFlush = true;
      return false;
    }
    // Another process may have written since the last read (the lock is this process's): its keys merge in first, so
    // they are never written over. Unreadable since then (a partial write elsewhere) is left for the next load, which
    // keeps it aside; a newer Ironleaf's file is never touched.
    const fresh = await readText(this.o.file);
    if (fresh.text !== null) {
      if (newerFormat(fresh.text)) {
        this.newer = true;
        this.disk = 'unreadable';
        return false;
      }
      const fromFresh = readDoc(fresh.text, this.o.kind);
      if (!fromFresh) {
        this.needsFlush = true;
        return false;
      }
      this.doc = mergeDocs(this.doc, fromFresh, this.o.kind);
    } else if (!fresh.missing) {
      this.needsFlush = true;
      return false;
    }
    try {
      await writeWhole(this.o.file, docText(this.doc));
      const st = await fsp.stat(this.o.file);
      this.mtime = st.mtimeMs;
      this.size = st.size;
      this.disk = 'ok';
      this.needsFlush = false;
      const dir = path.dirname(this.o.file);
      for (const name of merging) await fsp.rm(path.join(dir, name), { force: true }).catch(() => undefined);
      if (merging.length) {
        this.mergedCopies += merging.length;
        this.o.log?.(`Ironleaf merged ${merging.length} conflict ${merging.length === 1 ? 'copy' : 'copies'} of ${path.basename(this.o.file)}.`);
      }
      return true;
    } catch (err) {
      this.needsFlush = true;
      this.o.log?.(`Ironleaf could not write ${path.basename(this.o.file)} yet (kept on this PC): ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** Values changed here: the file read again, these put in with the time and this PC, written whole. Returns the keys
   *  that changed. */
  set(values: Record<string, unknown>): Promise<string[]> {
    return this.inTurn(async () => {
      // What another PC wrote since the last look comes in first, so only what changed here is stamped as new.
      await this.loadNow();
      const { doc, changed } = setValues(this.doc, values, this.o.now?.() ?? Date.now(), this.o.device());
      if (!changed.length) return changed;
      this.doc = doc;
      if (this.o.mirror)
        await writeWhole(this.o.mirror, docText(doc)).catch((err) => this.o.log?.(`Ironleaf could not keep its own copy of ${path.basename(this.o.file)}: ${err instanceof Error ? err.message : String(err)}`));
      await this.writeDisk();
      return changed;
    });
  }

  /** Brings another document in (a first move of this PC's settings; an import), merged key by key and written. */
  adopt(other: KeyedDoc): Promise<boolean> {
    return this.inTurn(() => this.loadNow(other));
  }

  /** Read again when the file changed since (another PC's change arrived, or the former host app brought the person's), or
   *  a change kept here still waits for the file. */
  refresh(): Promise<boolean> {
    return this.inTurn(async () => {
      const st = await fsp.stat(this.o.file).catch(() => null);
      const dir = path.dirname(this.o.file);
      const copies = docConflictCopies(path.basename(this.o.file), await fsp.readdir(dir).catch(() => [] as string[]));
      if (!this.needsFlush && st && st.mtimeMs === this.mtime && st.size === this.size && !copies.length && this.disk === 'ok') return false;
      if (!this.needsFlush && !st && this.disk === 'missing' && !copies.length) return false;
      return this.loadNow();
    });
  }
}
