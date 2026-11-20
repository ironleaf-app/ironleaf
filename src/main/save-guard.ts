// The one safe way to put words on disk (Nov 2026, nv-save: Ironleaf never loses an edit). Every save path —
// vault notes and canvases (src/main/vault.ts), loose files outside the vault (src/main/loose-files.ts), private
// notes (src/main/private-notes.ts) — writes through a temp file beside the target, fsyncs it, and renames it over,
// so a crash or power cut never leaves half a note. Windows' brief locks (antivirus, indexers, OneDrive) are ridden
// out with a retry; a lock that won't clear fails in plain words, never a code. Writes to one file run one at a time
// (KeyedQueue), so two saves, ticks, or link updates never interleave. No Electron here, so tests drive it directly.

import { promises as fsp } from 'node:fs';
import { randomBytes } from 'node:crypto';

/** Larger than this isn't opened in the editor (the same 8 MiB loose files already used): it would hang the window. */
export const MAX_EDIT_BYTES = 8 * 1024 * 1024;

/** A note too big to open, in the person's own words (shown as-is; never a size or a code). */
export const tooBigToOpen = (kind: 'note' | 'file'): string =>
  kind === 'note' ? 'That note is too big to open as a note.' : 'That file is too big to open.';

/** Words too big to save, matching the loose files' own words. */
export const tooBigToSave = (): string => 'That is too much to save in one note.';

/** A file operation retried while the file is briefly locked (EPERM/EACCES/EBUSY — antivirus, indexers,
 *  OneDrive): `tries` retries with short waits, then the last error as it came (the caller says it in plain
 *  words). Anything else throws straight through, never retried. */
export async function retryLocked<T>(fn: () => Promise<T>, tries = 8, waitMs: (attempt: number) => number = (n) => 40 * (n + 1)): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= tries || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw err;
      await new Promise((resolve) => setTimeout(resolve, waitMs(attempt)));
    }
  }
}

/**
 * On Windows, antivirus and indexers briefly lock files that were just written, which makes
 * rename fail with EPERM/EACCES/EBUSY. Retrying for up to ~2 seconds rides that out. A lock that
 * won't clear fails in plain words (a code or a path never reaches the person); `rename` is only
 * ever a test's stand-in.
 */
export async function renameWithRetry(src: string, dest: string, rename: (s: string, d: string) => Promise<void> = fsp.rename, action = 'saved'): Promise<void> {
  try {
    await retryLocked(() => rename(src, dest));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // A lock that rode out nothing, or a real refusal: plain words either way (F4).
    if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') throw new Error(`That file is locked or not writable, so it couldn't be ${action} just now.`);
    throw err;
  }
}

/** Whole or not at all (a new temp beside it, fsynced, then put in its place); the temp never litters on failure. */
export async function writeFileAtomic(abs: string, content: string | Uint8Array): Promise<void> {
  const tmp = `${abs}.${randomBytes(6).toString('hex')}.nvtmp`;
  try {
    const handle = await fsp.open(tmp, 'w');
    try {
      if (typeof content === 'string') await handle.writeFile(content, 'utf8');
      else await handle.writeFile(content);
      // Durable before the rename (F9): a power cut after this keeps the whole temp, never half the file.
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(tmp, abs);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    // A folder that cannot be written (read-only) refuses the temp with EACCES: plain words at the mechanism
    // (5 Nov 2026, p22 data safety: the raw "EACCES ... .nvtmp" reached the person). The file on disk is untouched,
    // no temp litters, as before. A lock's own plain words from the rename pass through (no code on them).
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') throw new Error("That file is safe. Its folder cannot be written to, so it couldn't be saved. Make the folder writable and try again.");
    throw err;
  }
}

/** Writes to one file run one at a time (a note saved twice quickly, a tick landing mid-save). */
export class KeyedQueue {
  private tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key.toLowerCase()) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prev.then(() => mine);
    this.tails.set(key.toLowerCase(), tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key.toLowerCase()) === tail) this.tails.delete(key.toLowerCase());
    }
  }
}

/**
 * The window-close handshake's wait (F2): `register` hears the renderer's "saved everything" (or anything else
 * awaited on the way out). True when it came in time, false on the timeout — the window then closes anyway, and the
 * log says saves were still waiting.
 */
export function closeHandshake(register: (done: () => void) => void, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    timer.unref?.();
    register(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
