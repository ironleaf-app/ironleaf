// Where a project's files are (docs/PROJECTS-DESIGN.md "Files stay where they are"): a folder on this PC (its `folder`
// property), or a folder on a remote computer the former host app connects to (4.9.5). A project the former host app
// made from a remote workspace names its computer and folder in its key, written by the former host app's runtime:
//
//   neuralspark-project: remote:<computer id>:/home/fileserver-01/MarketingMachine
//
// and its name is the workspace's, "fileserver-01 · MarketingMachine". The main process, the window and the assistant
// all ask here, so a remote project is read through the former host app wherever a local one is read from the PC.

import type { Project } from './project-file';

export interface LocalWhere {
  kind: 'local';
  folder: string;
}
export interface RemoteWhere {
  kind: 'remote';
  /** The former host app's id for the computer. */
  computer: string;
  /** The folder there, as the former host app's file access names it (/home/pat/app, /C:/Users/pat/app, ~). */
  path: string;
  /** The computer's name as people say it ("fileserver-01"), until the former host app says it: from the project's name or
summary. */
  computerName: string;
  /** The folder's own name ("MarketingMachine"). */
  folderName: string;
}
export type ProjectWhere = LocalWhere | RemoteWhere;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The computer and folder a `remote:<id>:<folder>` key names, or null. */
export function parseRemoteKey(key: string | undefined): { computer: string; path: string } | null {
  const m = /^remote:([0-9a-f-]{36}):(.+)$/i.exec(String(key ?? '').trim());
  if (!m || !UUID.test(m[1])) return null;
  const path = m[2].trim().replace(/\\/g, '/');
  if (!(path === '~' || path.startsWith('~/') || path.startsWith('/') || /^[A-Za-z]:\//.test(path)) || /[\0\r\n]/.test(path)) return null;
  return { computer: m[1].toLowerCase(), path: /^[A-Za-z]:\//.test(path) ? `/${path}` : path };
}

/** The folder's last part ("MarketingMachine"; the home folder is "Home"). */
export function folderNameOf(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  const last = parts.at(-1) ?? '';
  return path === '~' || !last ? 'Home' : last === '~' ? 'Home' : last;
}

/** The computer's name, as the project says it: "fileserver-01 · MarketingMachine", or its summary's "On fileserver-01, in …". */
export function computerNameOf(p: Pick<Project, 'name' | 'summary'>): string {
  const byName = /^(.{1,80}?)\s+·\s+/.exec(p.name ?? '');
  if (byName) return byName[1].trim();
  // "On <name>, in <folder>" names the computer only when it isn't the project's own name (a workspace named after the
  // project reads "On Playground, in /home/jesse").
  const bySummary = /^On (.{1,80}?), in /.exec(p.summary ?? '');
  if (bySummary && bySummary[1].trim().toLowerCase() !== String(p.name ?? '').trim().toLowerCase()) return bySummary[1].trim();
  return 'the computer this project’s folder is on';
}

/** Where a project's files are, or null when it has no folder. A local folder wins when both are given. */
export function projectWhere(p: Pick<Project, 'folder' | 'key' | 'name' | 'summary'>): ProjectWhere | null {
  if (p.folder && p.folder.trim()) return { kind: 'local', folder: p.folder.trim() };
  const remote = parseRemoteKey(p.key);
  if (!remote) return null;
  return { kind: 'remote', computer: remote.computer, path: remote.path, computerName: computerNameOf(p), folderName: folderNameOf(remote.path) };
}

export const isRemoteProject = (p: Pick<Project, 'folder' | 'key' | 'name' | 'summary'>) => projectWhere(p)?.kind === 'remote';

/**
 * The project's folder as the window passes it around (to the viewer, a file's link): a path on this PC, or for a remote
 * project its key ("remote:<id>:<folder>"), which no file URL is made from.
 */
export function folderHandle(p: Pick<Project, 'folder' | 'key' | 'name' | 'summary'>): string {
  const w = projectWhere(p);
  return !w ? '' : w.kind === 'local' ? w.folder : `remote:${w.computer}:${w.path}`;
}
export const isRemoteHandle = (folder: string | undefined) => /^remote:[0-9a-f-]{36}:/i.test(String(folder ?? ''));

/** Why a remote folder couldn't be read, as the former host app says
(remote-servers/project-folder.js). */
export type RemoteProblemKind = 'offline' | 'not-connected' | 'sign-in' | 'gone' | 'missing' | 'outside' | 'denied' | 'too-big' | 'starting' | 'standalone' | 'invalid' | 'not-a-file' | 'failed';
export interface RemoteProblem {
  kind: RemoteProblemKind;
  /** One calm line for the person. */
  words: string;
  /** What they can do about it, when there's something. */
  hint?: string;
}

/** The words for a problem, with the computer's name (the former host app's own words for the rest). */
export function remoteProblem(kind: string | undefined, computer: string, words = ''): RemoteProblem {
  const k = (kind ?? 'failed') as RemoteProblemKind;
  // A sentence starts with a capital when it starts with the stand-in words ("The computer this project's folder is on
  // isn't…"); a computer's own name stays as it is written ("fileserver-01").
  const name = computer.startsWith('the computer ') ? 'T' + computer.slice(1) : computer;
  switch (k) {
    case 'offline':
      return { kind: k, words: `${name} isn’t connected right now.`, hint: 'It may be off, asleep or away from the network. Its files show here again once it can be reached.' };
    case 'not-connected':
      return { kind: k, words: `${name} isn’t a connected computer now.`, hint: 'Open the project’s folder on that computer to see its files.' };
    case 'sign-in':
      return { kind: k, words: `${computer} couldn’t be signed in to.`, hint: 'Open the project’s folder on that computer to see its files.' };
    case 'starting':
      return { kind: k, words: 'The remote computers are still opening.', hint: 'Try again in a moment.' };
    case 'standalone':
      // The split wording (16 Nov 2026 audit finding 5: it said to open Ironleaf from the former host app,
      // impossible now): the screen names the case on its button (Open when the former host app is there,
      // Get when it is not).
      return { kind: k, words: `This project’s files are on ${computer}, another computer.`, hint: 'Open the project’s folder on that computer to see its files.' };
    default:
      return { kind: k, words: words || `${name} couldn’t be read just now.` };
  }
}

// ---- A project's folder is per PC (22 Oct 2026: two PCs, the vault synced by OneDrive, a project's
// `folder: C:\Users\alex\Downloads\projects\01 Garden Shed Upgrade` there on a desktop and not on a travel
// laptop, where Work on it, the former host app and a chat bot said there was no folder). The note keeps the folder as it
// was written (the other PC's, never overwritten); each PC resolves it here: a folder chosen on this PC (kept in this
// PC's own settings, never in the synced note), the folder as written when it is here, the same folder under this PC's
// user folder (C:\Users\alex\X read as C:\Users\<this user>\X), else it is on another PC and the page offers the choices.
// The former host app resolves it the same way (native-runtime/plugins/desktop/project-place.mjs), from the same per-PC
// settings.

/** A folder as Windows compares them: slashes one way, case aside, no slash at the end (the per-PC map's keys). */
export function folderKey(folder: string | undefined): string {
  return String(folder ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/[\\/]+/g, '/')
    .replace(/(.)\/$/, '$1')
    .toLowerCase();
}

/** A whole path on a PC (C:\…, \\server\share\…, /home/…). */
export const isWholePath = (folder: string) => /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]|\/)/.test(String(folder ?? '').trim());

/** The folder a `local:<path>` key names (the former host app's key for a project in a folder on a PC), or
''. */
export function localKeyFolder(key: string | undefined): string {
  const m = /^local:(.+)$/i.exec(String(key ?? '').trim());
  if (!m || /[\0\r\n]/.test(m[1])) return '';
  const f = m[1].trim();
  return isWholePath(f) ? (/^[A-Za-z]:\//.test(f) ? f.replace(/\//g, '\\') : f) : '';
}

/** The folder the project's note names (its folder property, else the former host app's `local:` key), as
written. */
export function recordedFolder(p: Pick<Project, 'folder' | 'key'>): string {
  const own = String(p.folder ?? '').trim();
  return own || localKeyFolder(p.key);
}

/**
 * The same folder for this PC's user, when the folder is under a user's folder and this PC's user is another:
 * C:\Users\alex\Downloads\X with this PC's home C:\Users\jesse is C:\Users\jesse\Downloads\X; /home/pat/x → /home/sam/x.
 * null otherwise.
 */
export function forThisUser(folder: string, home: string | undefined): string | null {
  const f = String(folder ?? '').trim();
  const h = String(home ?? '').trim().replace(/[\\/]+$/, '');
  if (!f || !h) return null;
  const win = /^[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]([^\\/]+)((?:[\\/].*)?)$/i.exec(f);
  const nix = /^\/(?:home|Users)\/([^/]+)((?:\/.*)?)$/.exec(f);
  const m = win ?? nix;
  if (!m) return null;
  const homeUser = h.split(/[\\/]/).pop() ?? '';
  if (!homeUser || homeUser.toLowerCase() === m[1].toLowerCase()) return null;
  // Only from one Windows user folder to another, or one home folder to another (never C:\Users\… onto /home/…).
  if (!!win !== /^[A-Za-z]:[\\/]/.test(h)) return null;
  const sep = win ? '\\' : '/';
  const rest = m[2].replace(/[\\/]+/g, sep);
  return `${h}${rest}`;
}

/** What this PC remembers for one project's folder (its own settings): the folder here, or working without one here. */
export interface FolderChoice {
  folder?: string;
  none?: boolean;
  /** When it was chosen (ISO). */
  at?: string;
}

/** Where a project's folder is on this PC. */
export interface FolderPlace {
  /**
   * here: the folder as written is on this PC. moved: the same folder under this PC's user folder. chosen: the folder
   * chosen for it on this PC. without: working without a folder on this PC (its own Files folder in Ironleaf).
   * elsewhere: on another PC, not found here. none: the note names no folder.
   */
  state: 'here' | 'moved' | 'chosen' | 'without' | 'elsewhere' | 'none';
  /** The folder as the note names it (the other PC's, for elsewhere). */
  recorded: string;
  /** The folder on this PC (here, moved, chosen). */
  folder?: string;
  /** The folder chosen on this PC before, not there any more. */
  lost?: string;
}

/** Where a project's folder is on this PC: what this PC chose, the folder as written, the same under this user, else elsewhere. */
export function placeOf(recorded: string, o: { choice?: FolderChoice | null; home?: string; isFolder: (folder: string) => boolean }): FolderPlace {
  const r = String(recorded ?? '').trim();
  if (!r) return { state: 'none', recorded: '' };
  // A folder written as something other than a whole path is left as it was (read as written, as before).
  if (!isWholePath(r)) return { state: 'here', recorded: r, folder: r };
  const c = o.choice;
  if (c?.none) return { state: 'without', recorded: r };
  if (c?.folder && o.isFolder(c.folder)) return { state: 'chosen', recorded: r, folder: c.folder };
  if (o.isFolder(r)) return { state: 'here', recorded: r, folder: r };
  const mine = forThisUser(r, o.home);
  if (mine && o.isFolder(mine)) return { state: 'moved', recorded: r, folder: mine };
  return { state: 'elsewhere', recorded: r, ...(c?.folder ? { lost: c.folder } : {}) };
}

/**
 * The project as this PC reaches it: its folder is the one on this PC (none when it is on another PC or worked on
 * without one here). For reading and opening only: a project file is always written from its own text, so the note keeps
 * the folder as written.
 */
export function onThisPC<T extends { folder?: string }>(p: T, place: FolderPlace): T {
  if (place.state === 'none') return p;
  const folder = place.folder;
  if (folder === p.folder) return p;
  const out = { ...p };
  if (folder) out.folder = folder;
  else delete out.folder;
  return out;
}

/** The folder's last part, from a path written on Windows or elsewhere ("01 Garden Shed Upgrade"). */
export const lastPart = (folder: string) => String(folder ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
