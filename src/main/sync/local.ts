// The vault as Ironleaf Sync sees it (docs/SYNC.md § The client engine): what is listed and fingerprinted, and how a
// remote change is put on disk. Listing skips and counts what it can't read, as vault.ts does (a OneDrive file only in
// the cloud, a file another program holds), so one bad file never stops a sync. Writes go through a `LocalWriter`:
// `FsWriter` here (atomic temp-and-rename, after checking the file is still what sync last saw), and in the app a
// writer over the open Vault (service.ts) so notes land through the same guarded saves, Bin and moves as everything
// else. No Electron here.

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import { renameWithRetry } from '../save-guard';
import { conflictName as conflictNameOf } from '../sync-folder';
import { MAX_FILE_BYTES } from './protocol';

export interface LocalFile {
  rel: string;
  abs: string;
  size: number;
  mtime: number;
}

/** Dot folders at the top that travel with the notes (the vault's settings and state). */
const TRAVELLING_DOT_DIRS = new Set(['.neuralvault', '.ironleaf']);
/** Files inside them that belong to this PC only. */
const LOCAL_ONLY = new Set(['.neuralvault/writer.json']);
const SKIP_FILE = /(\.nvtmp|\.tmp|\.nvsyncpart)$|^~\$|^(thumbs\.db|desktop\.ini|\.ds_store)$/i;

/** A vault-relative path safe to write: no climbing out, no empty or dot segments, no drive letters or control characters. */
export const safeRel = (rel: unknown): rel is string =>
  typeof rel === 'string' &&
  rel.length > 0 &&
  rel.length < 1024 &&
  !rel.startsWith('/') &&
  !rel.includes('\\') &&
  !rel.split('/').some((s) => s === '..' || s === '' || s === '.') &&
  !/[\u0000-\u001f]/.test(rel) &&
  !/^[A-Za-z]:/.test(rel);

/** Whether a path sits in one of the excluded folders (selective sync), compared without case. */
export function isExcluded(rel: string, excluded: readonly string[]): boolean {
  const r = rel.toLowerCase();
  return excluded.some((f) => {
    const e = f.replace(/^\/+|\/+$/g, '').toLowerCase();
    return !!e && (r === e || r.startsWith(`${e}/`));
  });
}

/** Whether sync carries a path at all (the listing's rules, for paths that arrive from the server too). */
export function carried(rel: string): boolean {
  if (!safeRel(rel) || LOCAL_ONLY.has(rel)) return false;
  const segs = rel.split('/');
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (s === 'node_modules') return false;
    if (s.startsWith('.') && !(i === 0 && TRAVELLING_DOT_DIRS.has(s) && segs.length > 1)) return false;
  }
  return !SKIP_FILE.test(segs[segs.length - 1]!);
}

/** Every file sync carries, with how many entries couldn't be read (left out and counted, never failing the list). */
export async function listLocal(root: string, excluded: readonly string[] = []): Promise<{ files: Map<string, LocalFile>; skipped: number; tooBig: number }> {
  const files = new Map<string, LocalFile>();
  let skipped = 0;
  let tooBig = 0;
  async function walk(dir: string, rel: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (!rel) throw err;
      skipped++;
      return;
    }
    // A folder that is a vault of its own (it holds .neuralvault/vault.json) is left out, as the app does.
    if (rel && entries.some((e) => e.name === '.neuralvault' && e.isDirectory()) && (await fsp.stat(path.join(dir, '.neuralvault', 'vault.json')).then(() => true, () => false))) return;
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || (e.name.startsWith('.') && !(rel === '' && TRAVELLING_DOT_DIRS.has(e.name)))) continue;
        if (isExcluded(r, excluded)) continue;
        await walk(abs, r);
      } else if (e.isFile()) {
        const nfc = r.normalize('NFC');
        if (!carried(nfc) || isExcluded(nfc, excluded)) continue;
        try {
          const st = await fsp.stat(abs);
          if (st.size > MAX_FILE_BYTES) {
            tooBig++;
            continue;
          }
          files.set(nfc, { rel: nfc, abs, size: st.size, mtime: Math.round(st.mtimeMs) });
        } catch {
          skipped++;
        }
      }
    }
  }
  await walk(root, '');
  return { files, skipped, tooBig };
}

/** A file's SHA-256 (hex), streamed; null when it can't be read now. */
export function hashFile(abs: string): Promise<string | null> {
  return new Promise((resolve) => {
    const h = createHash('sha256');
    const s = createReadStream(abs);
    s.on('data', (c) => h.update(c));
    s.on('error', () => resolve(null));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

export const absOf = (root: string, rel: string) => path.join(root, ...rel.split('/'));

/** A temp file beside where `rel` will go (its name ends .nvtmp, so the app's listing and watcher leave it alone). */
export async function tempBeside(root: string, rel: string): Promise<string> {
  const abs = absOf(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  return `${abs}.${randomBytes(6).toString('hex')}.nvtmp`;
}

export type PlaceResult = 'ok' | 'changed';

/** How sync puts things on disk. Each call checks the file is still what sync expects (`expect`: its SHA-256, null
 *  for nothing there) and answers 'changed' instead of touching it when it isn't. */
export interface LocalWriter {
  /** Puts the finished temp file (from tempBeside) at `rel`. The temp is gone afterwards either way. */
  place(rel: string, temp: string, expect: string | null): Promise<PlaceResult>;
  /** The file to the Bin. */
  remove(rel: string, expect: string): Promise<PlaceResult>;
  /** A move (a rename on another PC), never over something there. */
  move(from: string, to: string, expect: string): Promise<PlaceResult>;
  /** A free conflict-copy name beside `rel` for this PC's version. */
  conflictName(rel: string): Promise<string>;
}

const exists = (abs: string) => fsp.access(abs).then(() => true, () => false);

/** Plain files: atomic rename after the check; deletes to `trash` (the app's Bin) or, in tests, a folder of removed files. */
export class FsWriter implements LocalWriter {
  constructor(
    private readonly root: string,
    private readonly o: { deviceName: string; trash?(abs: string, rel: string): Promise<void>; now?(): number },
  ) {}

  protected async check(rel: string, expect: string | null): Promise<boolean> {
    const abs = absOf(this.root, rel);
    if (expect === null) return !(await exists(abs));
    return (await hashFile(abs)) === expect;
  }

  async place(rel: string, temp: string, expect: string | null): Promise<PlaceResult> {
    try {
      if (!(await this.check(rel, expect))) return 'changed';
      const abs = absOf(this.root, rel);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await renameWithRetry(temp, abs, fsp.rename, 'synced');
      return 'ok';
    } finally {
      await fsp.rm(temp, { force: true }).catch(() => {});
    }
  }

  async remove(rel: string, expect: string): Promise<PlaceResult> {
    if (!(await this.check(rel, expect))) return 'changed';
    const abs = absOf(this.root, rel);
    if (this.o.trash) await this.o.trash(abs, rel);
    else await fsp.rm(abs, { force: true });
    return 'ok';
  }

  async move(from: string, to: string, expect: string): Promise<PlaceResult> {
    if (!(await this.check(from, expect)) || (await exists(absOf(this.root, to)))) return 'changed';
    const dest = absOf(this.root, to);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await renameWithRetry(absOf(this.root, from), dest, fsp.rename, 'moved');
    return 'ok';
  }

  async conflictName(rel: string): Promise<string> {
    return freeConflictName(rel, this.o.deviceName, this.o.now?.() ?? Date.now(), (r) => exists(absOf(this.root, r)));
  }
}

/** "Plans (conflict, 20 Nov 2026 3.42 pm, from LAPTOP).md", the name the app's own conflict copies use, never one taken. */
export async function freeConflictName(rel: string, device: string, at: number, taken: (rel: string) => Promise<boolean>): Promise<string> {
  const view = /\.view\.json$/i.test(rel);
  const via = view ? rel.replace(/\.view\.json$/i, '.viewjson') : rel;
  const fix = (c: string) => (view ? c.replace(/\.viewjson$/, '.view.json') : c);
  for (let i = 0; i < 100; i++) {
    const name = fix(conflictNameOf(via, at, i === 0 ? device : `${device} ${i + 1}`));
    if (!(await taken(name))) return name;
  }
  return fix(conflictNameOf(via, at, `${device} ${randomBytes(3).toString('hex')}`));
}
