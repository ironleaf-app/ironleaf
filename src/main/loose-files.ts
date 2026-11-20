// Markdown files from outside the vault (21 Oct 2026, gap G26): a .md file opened from File Explorer ("Open with ›
// Ironleaf"), dragged onto the window, or chosen with Open a file…, opens in a tab of its own and is saved where it is.
// It never joins the vault (no index, links or graph) unless the person copies it in. Only files opened one of those ways
// are read or written: the window asks by a number this keeps, never by a path. A file that is inside the vault opens as
// the note it is.

import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { conflictName } from './sync-folder';
import { KeyedQueue, MAX_EDIT_BYTES, tooBigToOpen, tooBigToSave, writeFileAtomic } from './save-guard';

/** What opens as a loose file: Markdown and plain text. */
export const LOOSE_EXT = /\.(md|markdown|mdown|mkd|txt)$/i;
/** Larger than this isn't a note (and would make the editor crawl). */
export const LOOSE_MAX_BYTES = MAX_EDIT_BYTES;

export interface LooseFile {
  id: string;
  /** The whole path on this PC. */
  path: string;
  name: string;
  folder: string;
}

export type LooseOpened = { kind: 'loose'; file: LooseFile } | { kind: 'vault'; rel: string };

/** A loose file's guarded save: landed (`mtime`), or the file moved on (`conflict`) or away (`missing`). */
export interface LooseWrite {
  mtime: number;
  conflict?: string;
  missing?: boolean;
}

export class LooseFiles {
  private byId = new Map<string, LooseFile>();
  private writes = new KeyedQueue();

  /** `vaultRoot` (when notes are open) tells a file inside the vault apart. */
  constructor(private readonly vaultRoot: () => string | null, private readonly pathApi: typeof path = path) {}

  /** A file the person opened: checked, and kept by a number for the window to read and save it by. */
  async open(raw: unknown): Promise<LooseOpened> {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('No file was given.');
    const p = this.pathApi;
    const given = raw.trim().replace(/^"|"$/g, '');
    if (!p.isAbsolute(given) || /[\u0000]/.test(given)) throw new Error('That isn’t a whole path to a file.');
    const abs = p.resolve(given);
    if (!LOOSE_EXT.test(abs)) throw new Error('Ironleaf opens Markdown (.md) and text files from outside your notes.');
    let real = abs;
    try {
      real = await fsp.realpath(abs);
    } catch {
      throw new Error(`${p.basename(abs)} isn’t there any more.`);
    }
    const st = await fsp.stat(real);
    if (!st.isFile()) throw new Error(`${p.basename(abs)} isn’t a file.`);
    if (st.size > LOOSE_MAX_BYTES) throw new Error(`${p.basename(abs)} is too big to open as a note.`);
    const root = this.vaultRoot();
    if (root) {
      let realRoot = root;
      try {
        realRoot = await fsp.realpath(root);
      } catch {
        // The vault's folder as given.
      }
      const rel = p.relative(realRoot, real);
      if (rel && !rel.startsWith('..') && !p.isAbsolute(rel) && /\.md$/i.test(rel)) return { kind: 'vault', rel: rel.split(p.sep).join('/') };
    }
    for (const f of this.byId.values()) if (same(f.path, real)) return { kind: 'loose', file: f };
    const file: LooseFile = { id: randomBytes(9).toString('base64url'), path: real, name: p.basename(real), folder: p.dirname(real) };
    this.byId.set(file.id, file);
    return { kind: 'loose', file };
  }

  get(id: unknown): LooseFile {
    const f = typeof id === 'string' ? this.byId.get(id) : undefined;
    if (!f) throw new Error('That file was closed. Open it again.');
    return f;
  }

  async read(id: unknown): Promise<{ text: string; mtime: number }> {
    const f = this.get(id);
    const [text, st] = await Promise.all([fsp.readFile(f.path, 'utf8'), fsp.stat(f.path)]);
    if (st.size > LOOSE_MAX_BYTES || Buffer.byteLength(text, 'utf8') > LOOSE_MAX_BYTES) throw new Error(tooBigToOpen('file'));
    return { text: text.replace(/^﻿/, ''), mtime: st.mtimeMs };
  }

  /**
   * Saved where it is, whole or not at all (a new copy beside it, then put in its place). `baseMtime` guards it like
   * a vault note's fingerprint (F6): when another program saved since, the file keeps their change and these words go
   * into a conflict copy beside it; when the file is gone, nothing is recreated. Null is an explicit blind save.
   */
  async write(id: unknown, text: unknown, baseMtime?: number | null): Promise<LooseWrite> {
    const f = this.get(id);
    if (typeof text !== 'string') throw new Error('The file’s words must be text.');
    if (Buffer.byteLength(text, 'utf8') > LOOSE_MAX_BYTES) throw new Error(tooBigToSave());
    return this.writes.run(f.id, async () => {
      const st = await fsp.stat(f.path).catch((err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      });
      if (!st) {
        if (baseMtime === null) {
          await writeFileAtomic(f.path, text);
          return { mtime: (await fsp.stat(f.path)).mtimeMs };
        }
        return { mtime: 0, missing: true };
      }
      if (baseMtime !== undefined && baseMtime !== null && st.mtimeMs !== baseMtime) {
        const copy = await this.conflictPath(f.path);
        await writeFileAtomic(copy, text);
        return { mtime: st.mtimeMs, conflict: copy };
      }
      await writeFileAtomic(f.path, text);
      return { mtime: (await fsp.stat(f.path)).mtimeMs };
    });
  }

  /** A conflict copy's free name beside its file (the vault's own "(conflict, …)" words). Never over one. */
  private async conflictPath(abs: string): Promise<string> {
    const now = Date.now();
    for (let i = 0; i < 100; i++) {
      const cand = path.join(path.dirname(abs), conflictName(path.basename(abs), now, i === 0 ? hostname() : `${hostname()} ${i + 1}`));
      if (!(await fsp.access(cand).then(() => true, () => false))) return cand;
    }
    return path.join(path.dirname(abs), conflictName(path.basename(abs), now, `${hostname()} ${Math.random().toString(36).slice(2, 8)}`));
  }

  close(id: unknown): void {
    if (typeof id === 'string') this.byId.delete(id);
  }

  list(): LooseFile[] {
    return [...this.byId.values()];
  }
}

const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
