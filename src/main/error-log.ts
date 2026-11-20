// The page guard's own log (8.7.1, 31 Oct 2026: pages that "couldn't show", "this keeps happening", and the error only
// went to the console, so nobody could read it afterwards). Every error the guard catches is one line in
// page-errors.log in Ironleaf's own data folder: the page kind, the error message and stack, the time, the version —
// no note content, no secrets. The file rolls over instead of growing forever. No Electron here: the app hands in its
// data folder and version, so the tests drive it as it is.

import { promises as fsp } from 'node:fs';
import path from 'node:path';

export const ERROR_LOG_FILE = 'page-errors.log';
/** Past this size the live file moves aside (one backup kept) and a new one starts. */
const MAX_BYTES = 512 * 1024;
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;
const MAX_COMPONENTS = 4000;

export interface GuardError {
  /** card, page or app. */
  kind: string;
  /** Which page or card (the tab's kind or the card's name), in the app's own words. */
  name: string;
  message: string;
  stack: string;
  /** React's component stack, when there is one. */
  components?: string;
}

const cut = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** One caught error appended to the log (never throws: a failing log must never break the window). */
export async function reportError(dir: string, version: string, e: GuardError): Promise<void> {
  try {
    await fsp.mkdir(dir, { recursive: true });
    const row = {
      at: new Date().toISOString(),
      version: String(version ?? ''),
      kind: String(e.kind ?? '').slice(0, 80),
      name: String(e.name ?? '').slice(0, 80),
      message: cut(String(e.message ?? ''), MAX_MESSAGE),
      stack: cut(String(e.stack ?? ''), MAX_STACK),
      ...(e.components ? { components: cut(String(e.components), MAX_COMPONENTS) } : {}),
    };
    const file = path.join(dir, ERROR_LOG_FILE);
    await fsp.appendFile(file, `${JSON.stringify(row)}\n`, 'utf8');
    const size = (await fsp.stat(file)).size;
    if (size > MAX_BYTES) {
      try {
        await fsp.rm(`${file}.1`, { force: true });
        await fsp.rename(file, `${file}.1`);
      } catch {
        /* the log stays long this time; it rolls on the next error */
      }
    }
  } catch {
    /* the log is best-effort only */
  }
}
