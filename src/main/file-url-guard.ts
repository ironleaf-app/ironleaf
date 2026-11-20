// SPDX-License-Identifier: AGPL-3.0-or-later
// The window's file: requests, checked in the main process (security review, 20 Nov 2026). The window is shown from
// file:// and its pictures come from the notes folder, so a note naming a file on another computer (file://host/…,
// a UNC path, //host/… read against the page's own file: address) would make Windows open an SMB connection to that
// host and send the person's sign-in (an NTLM hash). Every file: request is cancelled when it names a host, is a UNC
// or device path, or (after its links are followed) lies outside the open vault, Ironleaf's own folders and the
// other places Ironleaf itself shows files from (project folders on this PC, files linked where they are). The window
// also draws such a picture as a "blocked remote file" placeholder (src/shared/remote-file.ts); this is the layer
// that holds whatever else asks.

import path from 'node:path';

export interface FileGuardOptions {
  /** The folders whose files the window may load (a file inside one, at any depth). */
  roots: readonly string[];
  /** Single files the window may load wherever they are (a file linked where it is). */
  files?: readonly string[];
  platform: NodeJS.Platform;
  /** The path with its links followed (fs.promises.realpath); a path that is not there comes back as it is. */
  realpath?(p: string): Promise<string>;
}

type Platform = NodeJS.Platform;
const win = (platform: Platform) => platform === 'win32';

/** A UNC, device or extended path (\\host\share, \\?\…, \\.\…), written with either slash. */
export const isUncPath = (p: string): boolean => /^[\\/]{2}/.test(p);

/** The local path a file: URL names, or null when it names a host, a UNC or device path, or is not a plain path. */
export function fileUrlPath(url: string, platform: Platform): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'file:') return null;
  if (u.hostname && u.hostname.toLowerCase() !== 'localhost') return null;
  let p: string;
  try {
    p = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  if (p.includes('\0')) return null;
  if (win(platform)) {
    p = p.replace(/\//g, '\\');
    if (/^\\[A-Za-z]:(\\|$)/.test(p)) p = p.slice(1);
    if (!/^[A-Za-z]:\\/.test(p)) return null; // \\host\share, \\?\…, or a path with no drive
    return path.win32.normalize(p);
  }
  if (isUncPath(p)) return null;
  return path.posix.normalize(p);
}

/** The same path for comparing: Windows paths without case and with one kind of slash. */
function key(p: string, platform: Platform): string {
  const n = win(platform) ? path.win32.normalize(p.replace(/\//g, '\\')).replace(/\\+$/, '').toLowerCase() : path.posix.normalize(p).replace(/\/+$/, '');
  return n || (win(platform) ? '\\' : '/');
}

function inside(file: string, root: string, platform: Platform): boolean {
  const f = key(file, platform);
  const r = key(root, platform);
  const sep = win(platform) ? '\\' : '/';
  return f === r || f.startsWith(r.endsWith(sep) ? r : r + sep);
}

/** The path a file is reached by, kept only when it is local or inside an allowed folder that is itself on the network
 *  (a vault on a share is the person's own choice; that server is already reached for every note). */
function placeAllowed(p: string, o: { roots: readonly string[]; files: readonly string[]; platform: Platform }): boolean {
  if (o.files.some((f) => key(f, o.platform) === key(p, o.platform))) return true;
  return o.roots.some((root) => root && inside(p, root, o.platform));
}

/** Whether the window may load this file: URL. Anything that is not file: is not this guard's business (true). */
export async function fileRequestAllowed(url: string, o: FileGuardOptions): Promise<boolean> {
  if (!/^file:/i.test(url)) return true;
  // A UNC address inside a vault or project that is itself on a share is let through by its own check below.
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.hostname && u.hostname.toLowerCase() !== 'localhost') return false;
  let p = fileUrlPath(url, o.platform);
  const files = o.files ?? [];
  if (p === null) {
    // \\host\share\… named as file:////host/share/…: only inside an allowed folder that is on that share.
    let raw: string;
    try {
      raw = decodeURIComponent(u.pathname);
    } catch {
      return false;
    }
    if (!win(o.platform) || !/^[\\/]{2}[^\\/?.]/.test(raw)) return false;
    p = path.win32.normalize(raw.replace(/\//g, '\\'));
    if (!o.roots.some((root) => isUncPath(root) && inside(p!, root, o.platform))) return false;
  }
  if (!placeAllowed(p, { roots: o.roots, files, platform: o.platform })) return false;
  // Links followed: a link inside the vault that leads to a share, or out of the allowed folders, is refused too.
  if (o.realpath) {
    let real = p;
    try {
      real = await o.realpath(p);
    } catch {
      return true; // not there: nothing to reach, the window shows it as missing
    }
    if (key(real, o.platform) === key(p, o.platform)) return true;
    const realRoots = await Promise.all(o.roots.map((r) => o.realpath!(r).catch(() => r)));
    const realFiles = await Promise.all(files.map((f) => o.realpath!(f).catch(() => f)));
    if (isUncPath(real) && !realRoots.some((root) => isUncPath(root) && inside(real, root, o.platform))) return false;
    return placeAllowed(real, { roots: [...o.roots, ...realRoots], files: [...files, ...realFiles], platform: o.platform });
  }
  return true;
}

type WebRequestLike = { onBeforeRequest(listener: (details: { url: string }, callback: (response: { cancel?: boolean }) => void) => void): void };

/** Puts the check on a session's file: requests. `places` is asked on every request (it is cheap to answer). */
export function installFileGuard(webRequest: WebRequestLike, places: () => { roots: string[]; files?: string[] }, o: { platform: Platform; realpath?(p: string): Promise<string>; log?(words: string): void }): void {
  webRequest.onBeforeRequest((details, callback) => {
    if (!/^file:/i.test(details.url)) return callback({});
    let given: { roots: string[]; files?: string[] };
    try {
      given = places();
    } catch {
      given = { roots: [] };
    }
    void fileRequestAllowed(details.url, { ...given, platform: o.platform, ...(o.realpath ? { realpath: o.realpath } : {}) }).then(
      (ok) => {
        if (!ok) o.log?.(`Blocked a file the window asked for outside Ironleaf's places: ${details.url.slice(0, 200)}`);
        callback(ok ? {} : { cancel: true });
      },
      () => callback({ cancel: true }),
    );
  });
}
