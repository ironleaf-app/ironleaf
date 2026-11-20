// Where the vault is (18 Oct 2026: the whole vault appeared on their second PC only because Windows had moved Documents
// into OneDrive; someone without that has notes on one PC, not backed up, and no hint of it).
//
// - Where a folder lives: OneDrive (personal and work), Dropbox, Google Drive for desktop, iCloud Drive, a network drive,
//   else only on this PC. Found cheaply from what each service leaves on the PC (environment, its own info files, the
//   registry, the drives), never blocking and never throwing: a service that can't be read simply isn't offered.
//   Everything it reads comes through PlaceDeps, so the checks run on any PC with made-up ones (tests/vault-place.test.mjs).
// - Moving the vault: every file copied (hidden ones too) into a folder beside the new place, each one checked (size and
//   SHA-256), then that folder takes the vault's name, the library switches there and the vault opens there; only then
//   does the old folder go to the Bin (never deleted outright). Anything going wrong leaves the old one in use.
// - A new PC: a vault waiting in one of those places (an Ironleaf folder at the top, or in Documents), with its notes
//   and projects counted, to open instead of the new, empty one.

import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream, promises as fsp } from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FoundVault, MovePlan, MoveProgress, MoveRefusal, MoveTarget, PlaceKind, SyncService, VaultPlace } from '../shared/vault-place';
import { countWords, isWelcomeName, sizeWords } from '../shared/vault-place';
import { HOME_FOLDERS } from '../shared/vault-home';
export { WELCOME_NAME } from '../shared/vault-place';

type PathApi = typeof nodePath.win32;

/** A drive letter as Windows reports it (Win32_LogicalDisk): type 4 is a network drive, 3 a disk in the PC. */
export interface DriveInfo {
  letter: string;
  type: number;
  label: string;
  /** A network drive's share (\\nas\home). */
  remote: string;
}
/** Registry keys (full names, as Windows writes them) and their values as text. */
export type RegTree = Record<string, Record<string, string>>;

/** What the checks read, so they can be given made-up ones. */
export interface PlaceDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  path: PathApi;
  readFile(p: string): Promise<string>;
  isDir(p: string): Promise<boolean>;
  listDir(p: string): Promise<string[]>;
  /** Windows: the registry keys below and the drive letters, in one look. */
  windows?(): Promise<{ reg: RegTree; drives: DriveInfo[] }>;
  /** Linux: /proc/mounts. */
  mounts?(): Promise<string>;
}

export interface SyncRoot {
  service: SyncService;
  path: string;
  /** As people know it: "OneDrive", "OneDrive – Contoso", "Dropbox", "Google Drive", "iCloud Drive". */
  name: string;
  work?: boolean;
  /** Google shared drives: other people's too. */
  shared?: boolean;
}
export interface NetworkRoot {
  path: string;
  remote: string;
}
export interface Places {
  roots: SyncRoot[];
  network: NetworkRoot[];
}

const ONEDRIVE_KEY = 'HKEY_CURRENT_USER\\Software\\Microsoft\\OneDrive\\Accounts';
const DRIVEFS_KEYS = ['HKEY_CURRENT_USER\\Software\\Google\\DriveFS', 'HKEY_LOCAL_MACHINE\\Software\\Google\\DriveFS'];

const quiet = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

/** A promise that gives up after `ms` with the fallback (a drive that has gone to sleep never holds anything up). */
export function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

// ── Paths ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const same = (deps: Pick<PlaceDeps, 'path' | 'platform'>, a: string, b: string) => key(deps, a) === key(deps, b);
function key(deps: Pick<PlaceDeps, 'path' | 'platform'>, p: string): string {
  const resolved = deps.path.resolve(p);
  // A drive's top (C:\ or /) keeps its separator; any other folder is the same with or without one at the end.
  const r = /^[A-Za-z]:[\\/]?$/.test(resolved) || resolved === '/' ? resolved : resolved.replace(/[\\/]+$/, '');
  return deps.platform === 'win32' || deps.platform === 'darwin' ? r.toLowerCase() : r;
}
/** Whether `child` is `parent` or inside it. */
export function isInside(deps: Pick<PlaceDeps, 'path' | 'platform'>, child: string, parent: string): boolean {
  const c = key(deps, child);
  const p = key(deps, parent);
  if (c === p) return true;
  const rel = deps.path.relative(p, c);
  return !!rel && !rel.startsWith('..') && !deps.path.isAbsolute(rel);
}

// ── What each service leaves on the PC ──────────────────────────────────────────────────────────────────────────────

/** The JSON Ironleaf's Windows look prints (PowerShell's ConvertTo-Json: a one-item list may come as the item). */
export function parseWindowsProbe(text: string): { reg: RegTree; drives: DriveInfo[] } {
  const out: { reg: RegTree; drives: DriveInfo[] } = { reg: {}, drives: [] };
  let v: unknown;
  try {
    v = JSON.parse(text.replace(/^\uFEFF/, '').trim() || '{}');
  } catch {
    return out;
  }
  if (!v || typeof v !== 'object') return out;
  const o = v as { reg?: unknown; drives?: unknown };
  if (o.reg && typeof o.reg === 'object')
    for (const [k, vals] of Object.entries(o.reg as Record<string, unknown>)) {
      if (!vals || typeof vals !== 'object') continue;
      const row: Record<string, string> = {};
      for (const [n, d] of Object.entries(vals as Record<string, unknown>)) if (d !== null && d !== undefined) row[n] = String(d);
      out.reg[k] = row;
    }
  const drives = Array.isArray(o.drives) ? o.drives : o.drives && typeof o.drives === 'object' ? [o.drives] : [];
  for (const d of drives) {
    if (!d || typeof d !== 'object') continue;
    const x = d as Record<string, unknown>;
    const letter = String(x.letter ?? '').toUpperCase();
    if (!/^[A-Z]:$/.test(letter)) continue;
    out.drives.push({ letter, type: Number(x.type) || 0, label: String(x.label ?? ''), remote: String(x.remote ?? '') });
  }
  return out;
}

const regUnder = (reg: RegTree, base: string) => Object.entries(reg).filter(([k]) => k.toLowerCase().startsWith(base.toLowerCase()));

async function oneDriveRoots(deps: PlaceDeps, win: { reg: RegTree } | null): Promise<SyncRoot[]> {
  const found: SyncRoot[] = [];
  const add = (p: string | undefined, work: boolean, org?: string) => {
    if (!p || !deps.path.isAbsolute(p)) return;
    const was = found.find((r) => same(deps, r.path, p));
    if (was) {
      if (work && !was.work) Object.assign(was, { work, name: workName('OneDrive', org, p, deps) });
      return;
    }
    found.push({ service: 'onedrive', path: p, work, name: work ? workName('OneDrive', org, p, deps) : 'OneDrive' });
  };
  if (deps.platform === 'win32') {
    if (win)
      for (const [k, vals] of regUnder(win.reg, ONEDRIVE_KEY + '\\')) {
        const account = k.slice(ONEDRIVE_KEY.length + 1);
        if (!account || account.includes('\\')) continue;
        const work = /^business/i.test(account) || vals.Business === '1' || vals.Business === '0x1';
        add(vals.UserFolder, work, vals.DisplayName);
      }
    add(deps.env.OneDriveCommercial, true);
    add(deps.env.OneDriveConsumer, false);
    if (deps.env.OneDrive && !(deps.env.OneDriveCommercial && same(deps, deps.env.OneDrive, deps.env.OneDriveCommercial))) add(deps.env.OneDrive, false);
  } else if (deps.platform === 'darwin') {
    const cloud = deps.path.join(deps.home, 'Library', 'CloudStorage');
    for (const n of await quiet(() => deps.listDir(cloud), [] as string[])) {
      const m = /^OneDrive-(.+)$/.exec(n);
      if (m) add(deps.path.join(cloud, n), m[1] !== 'Personal', m[1] === 'Personal' ? undefined : m[1]);
    }
  }
  const real: SyncRoot[] = [];
  for (const r of found) if (await quiet(() => deps.isDir(r.path), false)) real.push(r);
  return real;
}

/** "OneDrive – Contoso", from the account's name or its folder ("OneDrive - Contoso"). */
function workName(service: string, org: string | undefined, p: string, deps: PlaceDeps): string {
  const named = org?.trim();
  if (named) return `${service} – ${named}`;
  const base = deps.path.basename(p);
  const m = /^(?:OneDrive|Dropbox)\s*[-–(]\s*(.+?)\)?$/i.exec(base);
  return m ? `${service} – ${m[1]}` : `${service} for work`;
}

async function dropboxRoots(deps: PlaceDeps): Promise<SyncRoot[]> {
  const files =
    deps.platform === 'win32'
      ? [deps.env.APPDATA && deps.path.join(deps.env.APPDATA, 'Dropbox', 'info.json'), deps.env.LOCALAPPDATA && deps.path.join(deps.env.LOCALAPPDATA, 'Dropbox', 'info.json')]
      : [deps.path.join(deps.home, '.dropbox', 'info.json')];
  const out: SyncRoot[] = [];
  for (const file of files) {
    if (!file) continue;
    const info = await quiet(async () => JSON.parse((await deps.readFile(file)).replace(/^\uFEFF/, '')) as Record<string, { path?: unknown } | undefined>, null);
    if (!info || typeof info !== 'object') continue;
    for (const kind of ['personal', 'business'] as const) {
      const p = info[kind]?.path;
      if (typeof p !== 'string' || !deps.path.isAbsolute(p) || out.some((r) => same(deps, r.path, p))) continue;
      if (!(await quiet(() => deps.isDir(p), false))) continue;
      out.push({ service: 'dropbox', path: p, work: kind === 'business', name: kind === 'business' ? workName('Dropbox', undefined, p, deps) : 'Dropbox' });
    }
  }
  if (deps.platform === 'darwin' && !out.length) {
    const cloud = deps.path.join(deps.home, 'Library', 'CloudStorage');
    for (const n of await quiet(() => deps.listDir(cloud), [] as string[])) if (/^Dropbox/.test(n)) out.push({ service: 'dropbox', path: deps.path.join(cloud, n), name: 'Dropbox' });
  }
  return out;
}

/** Google Drive's drive: a letter ("G"), "G:" or a folder, as DriveFS's settings write it. */
function mountOf(value: string): string | null {
  const v = value.trim().replace(/^"|"$/g, '');
  if (/^[A-Za-z]$/.test(v)) return `${v.toUpperCase()}:\\`;
  if (/^[A-Za-z]:\\?$/.test(v)) return `${v.slice(0, 1).toUpperCase()}:\\`;
  if (/^[A-Za-z]:\\./.test(v) || /^\\\\/.test(v)) return v;
  return null;
}

async function googleDriveRoots(deps: PlaceDeps, win: { reg: RegTree; drives: DriveInfo[] } | null): Promise<SyncRoot[]> {
  const mounts: string[] = [];
  const addMount = (m: string | null) => m && !mounts.some((x) => same(deps, x, m)) && mounts.push(m);
  const out: SyncRoot[] = [];
  if (deps.platform === 'win32') {
    let installed = false;
    if (win) {
      for (const base of DRIVEFS_KEYS)
        for (const [, vals] of regUnder(win.reg, base)) {
          installed = true;
          for (const [n, d] of Object.entries(vals)) {
            if (/mount.?point/i.test(n)) addMount(mountOf(d));
            // Per-account settings are kept as JSON with each account's mount_point_path.
            for (const m of d.matchAll(/"mount_point_path"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) addMount(mountOf(m[1].replace(/\\\\/g, '\\')));
          }
        }
      for (const d of win.drives) if (/^google drive$/i.test(d.label.trim())) addMount(`${d.letter}\\`);
    }
    if (!installed && deps.env.LOCALAPPDATA) installed = await quiet(() => deps.isDir(deps.path.join(deps.env.LOCALAPPDATA!, 'Google', 'DriveFS')), false);
    for (const m of mounts) {
      const mine = deps.path.join(m, 'My Drive');
      const shared = deps.path.join(m, 'Shared drives');
      const hasMine = await quiet(() => deps.isDir(mine), false);
      if (hasMine) out.push({ service: 'gdrive', path: mine, name: 'Google Drive' });
      if (await quiet(() => deps.isDir(shared), false)) out.push({ service: 'gdrive', path: shared, name: 'Google shared drives', shared: true });
      if (!hasMine && !out.some((r) => isInside(deps, r.path, m)) && (await quiet(() => deps.isDir(m), false))) out.push({ service: 'gdrive', path: m, name: 'Google Drive' });
    }
    // "Mirror files": My Drive kept as a real folder in the person's own folder.
    const profile = deps.env.USERPROFILE || deps.home;
    const mirror = profile && deps.path.join(profile, 'My Drive');
    if (installed && mirror && !out.some((r) => same(deps, r.path, mirror)) && (await quiet(() => deps.isDir(mirror), false))) out.push({ service: 'gdrive', path: mirror, name: 'Google Drive' });
  } else if (deps.platform === 'darwin') {
    const cloud = deps.path.join(deps.home, 'Library', 'CloudStorage');
    for (const n of await quiet(() => deps.listDir(cloud), [] as string[])) {
      if (!/^GoogleDrive/.test(n)) continue;
      const mine = deps.path.join(cloud, n, 'My Drive');
      if (await quiet(() => deps.isDir(mine), false)) out.push({ service: 'gdrive', path: mine, name: 'Google Drive' });
      const shared = deps.path.join(cloud, n, 'Shared drives');
      if (await quiet(() => deps.isDir(shared), false)) out.push({ service: 'gdrive', path: shared, name: 'Google shared drives', shared: true });
    }
  }
  return out;
}

async function iCloudRoots(deps: PlaceDeps): Promise<SyncRoot[]> {
  const profile = deps.platform === 'win32' ? deps.env.USERPROFILE || deps.home : deps.home;
  if (!profile) return [];
  // iCloud for Windows (from Apple or the Microsoft Store) keeps iCloud Drive in the person's own folder.
  const places =
    deps.platform === 'win32' ? [deps.path.join(profile, 'iCloudDrive'), deps.path.join(profile, 'iCloud Drive')] : deps.platform === 'darwin' ? [deps.path.join(profile, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')] : [];
  for (const p of places) if (await quiet(() => deps.isDir(p), false)) return [{ service: 'icloud', path: p, name: 'iCloud Drive' }];
  return [];
}

const NETWORK_FS = /^(cifs|smb3?|smbfs|nfs4?|fuse\.sshfs|sshfs|davfs|fuse\.davfs2|afpfs)$/i;
/** Network shares from /proc/mounts (its spaces are written \040). */
export function networkMounts(text: string): NetworkRoot[] {
  const out: NetworkRoot[] = [];
  for (const line of text.split('\n')) {
    const [src, at, type] = line.split(/\s+/);
    if (!src || !at || !type || !NETWORK_FS.test(type)) continue;
    out.push({ path: at.replace(/\\(\d{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8))), remote: src });
  }
  return out;
}

/** Every synced folder and network drive on this PC. Never throws; a service that can't be read is left out. */
export async function detectPlaces(deps: PlaceDeps): Promise<Places> {
  const win = deps.platform === 'win32' && deps.windows ? await within(deps.windows(), 15000, null) : null;
  const [od, db, gd, ic] = await Promise.all([
    quiet(() => oneDriveRoots(deps, win), []),
    quiet(() => dropboxRoots(deps), []),
    quiet(() => googleDriveRoots(deps, win), []),
    quiet(() => iCloudRoots(deps), []),
  ]);
  const roots: SyncRoot[] = [];
  for (const r of [...od, ...db, ...gd, ...ic]) if (!roots.some((x) => same(deps, x.path, r.path))) roots.push(r);
  let network: NetworkRoot[] = [];
  if (win) network = win.drives.filter((d) => d.type === 4).map((d) => ({ path: `${d.letter}\\`, remote: d.remote }));
  else if (deps.platform === 'linux' && deps.mounts) network = networkMounts(await quiet(() => deps.mounts!(), ''));
  return { roots, network };
}

// ── Where a folder is, in words ──────────────────────────────────────────────────────────────────────────────────────

/** \\server\share of a network path (\\server\share\…, or \\?\UNC\server\share\…), else null. */
export function uncShare(p: string): string | null {
  const m = /^(?:\\\\\?\\UNC\\|\\\\(?![?.]\\))([^\\/]+)[\\/]+([^\\/]+)/i.exec(p);
  return m ? `\\\\${m[1]}\\${m[2]}` : null;
}

export function placeOf(folder: string, places: Places, deps: Pick<PlaceDeps, 'path' | 'platform'>): VaultPlace {
  const root = places.roots.filter((r) => isInside(deps, folder, r.path)).sort((a, b) => b.path.length - a.path.length)[0];
  if (root) return { kind: root.service, name: root.name, words: syncWords(root), root: root.path };
  const share = deps.platform === 'win32' ? uncShare(folder) : null;
  const net = places.network.find((n) => isInside(deps, folder, n.path));
  if (share || net) {
    const where = share ?? (net!.remote || net!.path);
    return { kind: 'network', name: 'a network drive', words: `On a network drive (${where}). Any PC that can reach it opens the same notes. They’re as safe as that drive’s own backups.`, root: share ?? net!.path };
  }
  return { kind: 'local', name: 'this PC', words: 'Only on this PC. If this PC is lost, so are your notes, and another PC won’t see them.' };
}

function syncWords(r: SyncRoot): string {
  switch (r.service) {
    case 'onedrive':
      return r.work ? `Synced with ${r.name}. Your notes follow you to any PC signed in to the same work account.` : 'Synced with OneDrive. Your notes follow you to any PC signed in to the same OneDrive.';
    case 'dropbox':
      return `Synced with ${r.name}. Your notes follow you to any PC signed in to the same Dropbox.`;
    case 'gdrive':
      return r.shared ? 'In a Google shared drive. Your notes follow you, and everyone with access to that shared drive can open them.' : 'Synced with Google Drive. Your notes follow you to any PC signed in to the same Google account.';
    case 'icloud':
      return 'Synced with iCloud Drive. Your notes follow you to any PC or Mac signed in to the same Apple Account.';
  }
}

/** Where the vault can move to: each synced folder it isn't in already (OneDrive's Documents when it has one), and each
 *  network drive. */
export async function moveTargets(library: string, places: Places, deps: Pick<PlaceDeps, 'path' | 'platform' | 'isDir'>): Promise<MoveTarget[]> {
  const out: MoveTarget[] = [];
  for (const r of places.roots) {
    if (r.shared || isInside(deps, library, r.path)) continue;
    const docs = deps.path.join(r.path, 'Documents');
    const inDocs = r.service === 'onedrive' && (await quiet(() => deps.isDir(docs), false));
    const label = r.service === 'gdrive' && /my drive$/i.test(r.path) ? 'Google Drive › My Drive' : inDocs ? `${r.name} › Documents` : r.name;
    out.push({ id: `${r.service}:${out.length}`, kind: r.service, label, path: inDocs ? docs : r.path });
  }
  for (const n of places.network) {
    if (isInside(deps, library, n.path)) continue;
    const letter = /^[A-Z]:\\$/i.test(n.path) ? n.path.slice(0, 2) : deps.path.basename(n.path) || n.path;
    out.push({ id: `network:${out.length}`, kind: 'network', label: n.remote ? `${letter} on ${n.remote}` : `Network drive ${letter}`, path: n.path });
  }
  return out;
}

// ── A vault's folder, looked at ─────────────────────────────────────────────────────────────────────────────────────

const JUNK = /^(desktop\.ini|thumbs\.db|\.ds_store|icon\r)$/i;

export interface VaultLook {
  exists: boolean;
  /** Ironleaf's own things are there (its first note, its templates, Private notes' key), or notes. */
  isVault: boolean;
  /** Notes of the person's own: not the ready-made templates, not the first note. */
  notes: number;
  projects: number;
  /** Nothing in it at all. */
  empty: boolean;
}

/**
 * Looks at a folder as a vault, without opening a file (a synced folder's notes may be online only; reading them would
 * download every one): its notes counted by name, its projects by the Projects folder's shape (Projects/<Name>/<Name>.md
 * or Projects/<Name>.md), Ironleaf's own marks. Stops at `limit` entries.
 */
export async function lookAtVault(dir: string, opts: { templates?: string; limit?: number } = {}): Promise<VaultLook> {
  const templates = (opts.templates || 'Templates').toLowerCase();
  const limit = opts.limit ?? 40000;
  const look: VaultLook = { exists: false, isVault: false, notes: 0, projects: 0, empty: true };
  let top: import('node:fs').Dirent[];
  try {
    top = await fsp.readdir(dir, { withFileTypes: true });
    look.exists = true;
  } catch {
    return look;
  }
  look.empty = top.every((e) => JUNK.test(e.name));
  let seen = 0;
  const marks = new Set<string>();
  const walk = async (rel: string, entries: import('node:fs').Dirent[], depth: number) => {
    for (const e of entries) {
      if (++seen > limit) return;
      if (e.isSymbolicLink() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const lower = r.toLowerCase();
      if (e.isDirectory()) {
        if (!rel && lower === 'private notes') {
          if (await fsp.stat(nodePath.join(dir, e.name, 'keys.nvkey')).then(() => true, () => false)) marks.add('private');
          continue;
        }
        if (!rel && lower === templates) marks.add('templates');
        // A vault of its own inside (Documents\Ironleaf\Work, src/main/vault-home.ts) isn't this vault's.
        if (await fsp.stat(nodePath.join(dir, r, '.neuralvault', 'vault.json')).then(() => true, () => false)) continue;
        if (depth < 12) await walk(r, await fsp.readdir(nodePath.join(dir, r), { withFileTypes: true }).catch(() => []), depth + 1);
      } else if (e.isFile() && /\.md$/i.test(e.name)) {
        if (!rel && isWelcomeName(e.name)) {
          marks.add('welcome');
          continue;
        }
        if (lower.startsWith(`${templates}/`)) continue;
        look.notes++;
        const parts = r.split('/');
        if (/^(?:\d+[\s._-]*)?projects$/i.test(parts[0]) && ((parts.length === 2 && parts[1].length > 3) || (parts.length === 3 && parts[2].toLowerCase() === `${parts[1].toLowerCase()}.md`))) look.projects++;
      }
    }
  };
  await walk('', top, 0);
  look.isVault = marks.size > 0 || look.notes > 0;
  return look;
}

/**
 * Whether a vault holds nothing the person made: only files Ironleaf itself wrote, as it wrote them (its first note and
 * its ready-made templates, `pristine` by path), and nothing else (bar Windows' own desktop.ini and the like).
 */
export async function holdsOnlyOwn(dir: string, pristine: Map<string, string>): Promise<boolean> {
  const norm = (t: string) => t.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const own = new Map([...pristine].map(([k, v]) => [k.toLowerCase(), norm(v)]));
  let count = 0;
  const walk = async (rel: string): Promise<boolean> => {
    const entries = await fsp.readdir(nodePath.join(dir, rel), { withFileTypes: true });
    for (const e of entries) {
      if (++count > 400) return false;
      const r = rel ? `${rel}/${e.name}` : e.name;
      // Ironleaf's own hidden folder (the vault's identity, src/main/vault-home.ts) is Ironleaf's, not the person's.
      if (!rel && e.name === '.neuralvault' && e.isDirectory()) continue;
      if (e.isDirectory()) {
        if (!(await walk(r))) return false;
      } else if (JUNK.test(e.name)) {
        continue;
      } else {
        const text = own.get(r.toLowerCase());
        if (text === undefined || !e.isFile()) return false;
        if (norm(await fsp.readFile(nodePath.join(dir, r), 'utf8')) !== text) return false;
      }
    }
    return true;
  };
  return quiet(() => walk(''), false);
}

/** The vaults waiting in synced folders and network drives: an Ironleaf folder at the top of each, or in its Documents
 *  folder, with notes or projects in it. Most notes first. */
export async function findVaults(places: Places, opts: { exclude: string[]; templates?: string; deps: Pick<PlaceDeps, 'path' | 'platform'>; timeoutMs?: number }): Promise<FoundVault[]> {
  const { deps } = opts;
  const spots: { path: string; kind: PlaceKind; name: string }[] = [];
  const add = (p: string, kind: PlaceKind, name: string) => {
    if (opts.exclude.some((x) => same(deps, x, p)) || spots.some((s) => same(deps, s.path, p))) return;
    spots.push({ path: p, kind, name });
  };
  for (const r of places.roots) {
    if (r.shared) {
      for (const d of await quiet(() => fsp.readdir(r.path), [] as string[])) for (const folder of HOME_FOLDERS) add(deps.path.join(r.path, d, folder), r.service, `${r.name} › ${d}`);
      continue;
    }
    // Both names: vaults kept as NeuralVault before the rename to Ironleaf are still found.
    for (const folder of HOME_FOLDERS) {
      add(deps.path.join(r.path, folder), r.service, r.name);
      add(deps.path.join(r.path, 'Documents', folder), r.service, r.name);
    }
  }
  for (const n of places.network) {
    for (const folder of HOME_FOLDERS) {
      add(deps.path.join(n.path, folder), 'network', n.remote ? `a network drive (${n.remote})` : 'a network drive');
      add(deps.path.join(n.path, 'Documents', folder), 'network', n.remote ? `a network drive (${n.remote})` : 'a network drive');
    }
  }
  const looks = await Promise.all(spots.map((s) => within(lookAtVault(s.path, { templates: opts.templates }), opts.timeoutMs ?? 4000, null)));
  const out: FoundVault[] = [];
  spots.forEach((s, i) => {
    const l = looks[i];
    if (l?.isVault && (l.notes > 0 || l.projects > 0)) out.push({ path: s.path, kind: s.kind, name: s.name, notes: l.notes, projects: l.projects });
  });
  return out.sort((a, b) => b.notes - a.notes || b.projects - a.projects);
}

/** "Found your vault in Dropbox, 214 notes, 11 projects" (the page joins with a comma). */
export function foundWords(v: FoundVault): string {
  return `${countWords(v.notes, 'note')}${v.projects ? `, ${countWords(v.projects, 'project')}` : ''}`;
}

/** A vault nobody has used yet: nothing of the person's own in it (only Ironleaf's first note and its templates). */
export const isNewVault = (counts: { notes: number; projects: number } | null) => !!counts && counts.notes === 0 && counts.projects === 0;

/** Days a "Not now" on the only-here tip keeps it away (8 Nov 2026, calm list: not for today, so it
 *  shows once a week at most, never every day; Settings › Files and links keeps it in reach meanwhile). */
export const TIP_SNOOZE_DAYS = 7;

/**
 * Today's cards. On a new PC, the vault found elsewhere, while the vault open is new and that one wasn't put away;
 * otherwise, that the notes are only on this PC, when there are enough of them to care (a few notes, or a project)
 * and the tip wasn't put away within the week (`tipSnoozedAt`, through `now`; never put away is null, always shown).
 * `counts` is null when the folder open isn't the vault (another folder of notes): then neither.
 */
export function vaultCards(o: { place: VaultPlace; counts: { notes: number; projects: number } | null; found: FoundVault | null; tipSnoozedAt: string | null; now: Date; foundDismissed(folder: string): boolean }): { onlyHereCard: boolean; found: FoundVault | null } {
  if (!o.counts) return { onlyHereCard: false, found: null };
  const found = isNewVault(o.counts) && o.found && !o.foundDismissed(o.found.path) ? o.found : null;
  const snoozedAt = o.tipSnoozedAt ? new Date(o.tipSnoozedAt).getTime() : NaN;
  const snoozed = Number.isFinite(snoozedAt) && o.now.getTime() - snoozedAt < TIP_SNOOZE_DAYS * 86_400_000;
  const onlyHereCard = !found && o.place.kind === 'local' && (o.counts.notes >= 5 || o.counts.projects >= 1) && !snoozed;
  return { onlyHereCard, found };
}

/** The library switched to `folder` and the vault opened there; settings.json then names it twice, as `library` and as
 *  `lastVault` (the folder opened last), exactly the same: The former host app reads them to find the vault. */
export async function switchLibrary(settings: { update(p: { library: string }): Promise<unknown>; raw: { library?: string } }, open: (folder: string) => Promise<{ path: string }>, folder: string): Promise<{ path: string }> {
  await settings.update({ library: folder });
  const opened = await open(folder);
  if (settings.raw.library !== opened.path) await settings.update({ library: opened.path });
  return opened;
}

/** After a move, the folder opened at its new place. When it was the vault (the library), the library moves with it
 *  (switchLibrary); another folder of notes is only reopened there, which makes it `lastVault` (the folder opened last)
 *  and leaves the library as it was. */
export async function reopenMoved(settings: { update(p: { library: string }): Promise<unknown>; raw: { library?: string } }, open: (folder: string) => Promise<{ path: string }>, dest: string, wasLibrary: boolean): Promise<{ path: string }> {
  return wasLibrary ? switchLibrary(settings, open, dest) : open(dest);
}

// ── Moving the vault ─────────────────────────────────────────────────────────────────────────────────────────────────

interface TreeFile {
  rel: string;
  size: number;
  mtime: number;
}
interface Tree {
  dirs: string[];
  files: TreeFile[];
  /** Shortcut links, which are left where they are. */
  links: number;
  bytes: number;
}

/** Everything in a folder, hidden files and folders too (links are counted, not followed). */
async function listTree(root: string): Promise<Tree> {
  const tree: Tree = { dirs: [], files: [], links: 0, bytes: 0 };
  const walk = async (rel: string) => {
    for (const e of await fsp.readdir(nodePath.join(root, rel), { withFileTypes: true })) {
      const r = rel ? nodePath.join(rel, e.name) : e.name;
      if (e.isSymbolicLink()) tree.links++;
      else if (e.isDirectory()) {
        tree.dirs.push(r);
        await walk(r);
      } else if (e.isFile()) {
        const st = await fsp.stat(nodePath.join(root, r));
        tree.files.push({ rel: r, size: st.size, mtime: st.mtimeMs });
        tree.bytes += st.size;
      }
    }
  };
  await walk('');
  return tree;
}

const nativeDeps = (): Pick<PlaceDeps, 'path' | 'platform'> => ({ path: nodePath as PathApi, platform: process.platform });

/** Where the vault would go in `parent` (an Ironleaf folder, or the next free name; another folder of notes by its
 *  own name), or why it can't. */
export async function planMove(from: string, parent: string, label: string, opts: { templates?: string; freeBytes?: (dir: string) => Promise<number | null>; /** The folder's name there (the vault: Ironleaf; another folder of notes keeps its own). */ name?: string } = {}): Promise<MovePlan | MoveRefusal> {
  const deps = nativeDeps();
  let source: string;
  let target: string;
  try {
    source = await fsp.realpath(from);
    target = await fsp.realpath(parent);
    if (!(await fsp.stat(target)).isDirectory()) throw new Error('not a folder');
  } catch {
    return { refused: 'unreadable', words: 'That folder can’t be opened. Choose another one.' };
  }
  const name = (opts.name || 'Ironleaf').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'Ironleaf';
  const first = nodePath.join(target, name);
  if (same(deps, first, source)) return { refused: 'same', words: 'Your vault is already there.' };
  if (isInside(deps, target, source)) return { refused: 'inside', words: 'That folder is inside your vault. Choose one outside it.' };
  let dest: string | null = null;
  for (let n = 1; n < 100 && !dest; n++) {
    const p = n === 1 ? first : nodePath.join(target, `${name} ${n}`);
    if (same(deps, p, source)) continue;
    const st = await fsp.stat(p).catch(() => null);
    if (st && !st.isDirectory()) continue;
    const look = await lookAtVault(p, { templates: opts.templates });
    if (!look.exists || look.empty) dest = p;
    else if (n === 1 && look.isVault) {
      return {
        refused: 'vault',
        words: `There’s already a vault in ${label}${look.notes || look.projects ? ` (${countWords(look.notes, 'note')}${look.projects ? `, ${countWords(look.projects, 'project')}` : ''})` : ''}. Open that one instead, or choose another place.`,
        vault: { path: p, kind: 'local', name: label, notes: look.notes, projects: look.projects },
      };
    }
  }
  if (!dest) return { refused: 'unreadable', words: 'There’s no free name for your vault there. Choose another folder.' };
  let tree: Tree;
  try {
    tree = await listTree(source);
  } catch {
    return { refused: 'unreadable', words: 'Your vault’s folder can’t be read right now, so nothing was moved.' };
  }
  const free = await (opts.freeBytes ?? freeSpace)(target).catch(() => null);
  if (free !== null && free < tree.bytes + 20 * 1024 * 1024) return { refused: 'space', words: `There isn’t room there: your vault needs ${sizeWords(tree.bytes)} and ${label} has ${sizeWords(free)} free.` };
  return { from: source, to: dest, label, files: tree.files.length, bytes: tree.bytes };
}

async function freeSpace(dir: string): Promise<number | null> {
  const s = await fsp.statfs(dir);
  return Number(s.bavail) * Number(s.bsize);
}

export interface MoveHooks {
  /** For the checks: called before each file is copied (throw to stop there). */
  beforeCopy?(rel: string): void | Promise<void>;
  /** For the checks: called after each file is copied, with the copy. */
  afterCopy?(rel: string, copy: string): void | Promise<void>;
}

export interface MoveOptions {
  onProgress?(p: MoveProgress): void;
  /** The library switched to the new folder and the vault opened there. */
  switchTo(dest: string): Promise<void>;
  /** Back to the old folder (the switch failed half way). */
  switchBack(from: string): Promise<void>;
  /** The old folder to the Bin; left out: the old folder stays (a network drive has no Bin). */
  trash?(abs: string): Promise<void>;
  hooks?: MoveHooks;
}

async function hashOf(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

async function renameWithRetry(src: string, dest: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(src, dest);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 10 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw err;
      await new Promise((r) => setTimeout(r, 60 * (attempt + 1)));
    }
  }
}

/** Moves the vault as planned. Resolves when it is in use at its new place; rejects (the old one still in use, nothing of
 *  the copy left) with what happened, in words. */
export async function moveVault(plan: MovePlan, opts: MoveOptions): Promise<{ path: string; trashed: boolean; links: number }> {
  const parent = nodePath.dirname(plan.to);
  const temp = nodePath.join(parent, `.Ironleaf-moving-${randomBytes(4).toString('hex')}`);
  const hashes = new Map<string, { size: number; mtime: number; hash: string }>();
  let last = 0;
  const progress = (p: MoveProgress, force = false) => {
    const now = Date.now();
    if (!force && now - last < 80) return;
    last = now;
    opts.onProgress?.(p);
  };
  const fail = (why: string): never => {
    throw new Error(`Nothing was moved: ${why} Your vault is still at ${plan.from}.`);
  };
  let tree: Tree;
  try {
    tree = await listTree(plan.from);
  } catch {
    return fail('your vault’s folder can’t be read right now.');
  }
  const copyOne = async (f: TreeFile, totals: { done: number; total: number; files: number; totalFiles: number }) => {
    await opts.hooks?.beforeCopy?.(f.rel);
    const src = nodePath.join(plan.from, f.rel);
    const dst = nodePath.join(temp, f.rel);
    await fsp.mkdir(nodePath.dirname(dst), { recursive: true });
    const h = createHash('sha256');
    let size = 0;
    const count = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        h.update(chunk);
        size += chunk.length;
        totals.done += chunk.length;
        progress({ phase: 'copying', ...totals });
        cb(null, chunk);
      },
    });
    const st = await fsp.stat(src);
    await pipeline(createReadStream(src), count, createWriteStream(dst, { flags: 'wx' }));
    await fsp.utimes(dst, st.atime, st.mtime).catch(() => {});
    hashes.set(f.rel, { size, mtime: st.mtimeMs, hash: h.digest('hex') });
    totals.files++;
    await opts.hooks?.afterCopy?.(f.rel, dst);
  };
  try {
    await fsp.mkdir(temp);
    try {
      for (const d of tree.dirs) await fsp.mkdir(nodePath.join(temp, d), { recursive: true });
      const totals = { done: 0, total: tree.bytes, files: 0, totalFiles: tree.files.length };
      progress({ phase: 'copying', ...totals }, true);
      for (const f of tree.files) await copyOne(f, totals);
      // Anything changed while it was copied (a sync, the former host app saving a task note) is copied again, a few
      // times at most.
      for (let round = 0; ; round++) {
        const now = await listTree(plan.from);
        const changed = now.files.filter((f) => {
          const h = hashes.get(f.rel);
          return !h || h.size !== f.size || Math.abs(h.mtime - f.mtime) > 1;
        });
        const gone = [...hashes.keys()].filter((rel) => !now.files.some((f) => f.rel === rel));
        if (!changed.length && !gone.length) {
          tree = now;
          break;
        }
        if (round >= 3) fail('your notes kept changing while they were copied. Close whatever is saving into them and try again.');
        for (const rel of gone) {
          hashes.delete(rel);
          await fsp.rm(nodePath.join(temp, rel), { force: true });
        }
        for (const d of now.dirs) await fsp.mkdir(nodePath.join(temp, d), { recursive: true });
        const again = { done: 0, total: changed.reduce((s, f) => s + f.size, 0), files: 0, totalFiles: changed.length };
        for (const f of changed) {
          await fsp.rm(nodePath.join(temp, f.rel), { force: true });
          await copyOne(f, again);
        }
      }
      // Every file checked: there, the same size, the same SHA-256 as what was read.
      const check = { done: 0, total: tree.bytes, files: 0, totalFiles: tree.files.length };
      progress({ phase: 'checking', ...check }, true);
      for (const f of tree.files) {
        const want = hashes.get(f.rel)!;
        const copy = nodePath.join(temp, f.rel);
        const st = await fsp.stat(copy).catch(() => null);
        if (!st || st.size !== want.size || (await hashOf(copy)) !== want.hash) fail(`a copied file didn’t match its original (${f.rel.split(nodePath.sep).join('/')}).`);
        check.done += want.size;
        check.files++;
        progress({ phase: 'checking', ...check });
      }
      progress({ phase: 'switching', ...check }, true);
      // The copy takes the vault's name (an empty folder of that name gives way to it).
      const there = await fsp.readdir(plan.to).catch(() => null);
      if (there) {
        if (there.some((n) => !JUNK.test(n))) fail('something was saved where your vault was going.');
        await fsp.rm(plan.to, { recursive: true, force: true });
      }
      await renameWithRetry(temp, plan.to);
    } catch (err) {
      await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  } catch (err) {
    const words = err instanceof Error ? err.message : String(err);
    if (words.startsWith('Nothing was moved:')) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    return fail(code === 'ENOSPC' ? 'there wasn’t room for every file.' : code === 'EACCES' || code === 'EPERM' ? 'Ironleaf wasn’t allowed to write there.' : `${words.replace(/\.$/, '')}.`);
  }
  try {
    await opts.switchTo(plan.to);
  } catch (err) {
    await opts.switchBack(plan.from).catch(() => {});
    await fsp.rm(plan.to, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Nothing was moved: your vault couldn’t open at its new place (${err instanceof Error ? err.message : String(err)}). It is still at ${plan.from}.`);
  }
  let trashed = false;
  if (opts.trash) {
    progress({ phase: 'tidying', done: 1, total: 1, files: 0, totalFiles: 0 }, true);
    trashed = await opts.trash(plan.from).then(
      () => true,
      () => false,
    );
  }
  return { path: plan.to, trashed, links: tree.links };
}

// ── This PC, for real ────────────────────────────────────────────────────────────────────────────────────────────────

/** The registry keys and drive letters in one PowerShell look (UTF-8, so names in any language come through). */
const WINDOWS_LOOK = `$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$reg=@{}
foreach($root in 'HKCU:\\Software\\Microsoft\\OneDrive\\Accounts','HKCU:\\Software\\Google\\DriveFS','HKLM:\\Software\\Google\\DriveFS'){
  $keys=@(Get-Item -LiteralPath $root) + @(Get-ChildItem -LiteralPath $root -Recurse)
  foreach($k in $keys){ if(!$k){continue}; $vals=@{}; foreach($n in $k.GetValueNames()){ $vals[$n]=[string]$k.GetValue($n) }; $reg[$k.Name]=$vals }
}
$drives=@(Get-CimInstance Win32_LogicalDisk | ForEach-Object { @{letter=[string]$_.DeviceID; type=[int]$_.DriveType; label=[string]$_.VolumeName; remote=[string]$_.ProviderName} })
@{reg=$reg; drives=$drives} | ConvertTo-Json -Depth 6 -Compress`;

function windowsLook(): Promise<{ reg: RegTree; drives: DriveInfo[] }> {
  return new Promise((resolve) => {
    const encoded = Buffer.from(WINDOWS_LOOK, 'utf16le').toString('base64');
    const root = process.env.SystemRoot || 'C:\\Windows';
    execFile(nodePath.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err && !stdout ? { reg: {}, drives: [] } : parseWindowsProbe(String(stdout)));
    });
  });
}

/** This PC as it is. */
export function systemDeps(): PlaceDeps {
  return {
    platform: process.platform,
    env: process.env,
    home: os.homedir(),
    path: nodePath as PathApi,
    readFile: (p) => fsp.readFile(p, 'utf8'),
    isDir: async (p) => (await fsp.stat(p)).isDirectory(),
    listDir: (p) => fsp.readdir(p),
    ...(process.platform === 'win32' ? { windows: windowsLook } : {}),
    ...(process.platform === 'linux' ? { mounts: () => fsp.readFile('/proc/mounts', 'utf8') } : {}),
  };
}
