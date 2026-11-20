// A project's folder on this PC (src/shared/project-folder.ts placeOf; 22 Oct 2026, the two PCs sharing one vault through
// OneDrive). The note names the folder as it was written on the PC that made it; this PC reaches it as it is here: a
// folder chosen for it on this PC, the folder as written, or the same folder under this PC's user folder. Otherwise it is
// on another PC, and the project's page offers: choose its folder here, find it, use a new folder here, or work without a
// folder. What this PC chooses is kept in its own settings (settings.json in the app's data folder, never synced), by the
// folder the note names, so the other PC's path stays in the note as it was and each PC keeps its own.
//
// Everything that reads a project's folder in the main process (the project's page and files, Work on it, the files
// index, Today, the assistant and agents) asks through Projects (src/main/projects.ts), which hands out each project as
// this PC reaches it (onThisPC). The former host app resolves it the same way from the same settings
// (native-runtime/plugins/desktop/project-place.mjs).

import { statSync } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { safeName, type Project } from '../shared/project-file';
import { folderKey, forThisUser, isWholePath, lastPart, onThisPC, placeOf, recordedFolder, type FolderChoice, type FolderPlace } from '../shared/project-folder';

/** Where this PC keeps its choices (SettingsStore). */
export interface FolderChoices {
  folderChoice(key: string): FolderChoice | null;
  setFolderChoice(key: string, choice: FolderChoice | null): Promise<void>;
}

/** Folders never descended into: packages, builds, caches, version control, a browser's own profile. Compared
 *  lower-cased ("NODE_MODULES" counts). One list for finding folders, walking them and indexing them. */
const JUNK_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', '.next', 'target', 'bin', 'obj', '__pycache__', '.venv', 'venv', '.idea', '.vscode', '.cache', 'coverage', 'gpucache', 'code cache', 'dawngraphitecache', 'dawnwebgpucache', 'grshadercache', 'shadercache', 'service worker', 'blob_storage', 'indexeddb', 'local storage', 'session storage', 'leveldb', 'crashpad', 'cache', 'default', 'extension rules', 'extension scripts', 'extension state']);
/** System folders finding-a-folder also never descends into (its roots are drives and home folders, never project folders). */
const SYSTEM_DIRS = new Set(['appdata', 'application data', 'local settings', '$recycle.bin', 'system volume information', 'windows', 'program files', 'program files (x86)', 'programdata', 'library']);
/** Whether a folder is never descended into (finding also skips system folders). */
export const skipDir = (name: string, system = false) => {
  const n = String(name ?? '').toLowerCase();
  return JUNK_DIRS.has(n) || (system && SYSTEM_DIRS.has(n));
};
/** Files never listed: temporary files, links, and machine files a person never opens as project material. */
export const shouldSkipFile = (name: string) => {
  const n = String(name ?? '');
  return /\.(tmp|nvtmp|lnk|ini|db|log)$/i.test(n) || n === 'desktop.ini' || n === 'Thumbs.db';
};
/** Every local drive's Projects folder that exists ("H:\Projects"), for finding on Windows. */
export const driveProjects = (exists: (dir: string) => boolean): string[] => {
  const out: string[] = [];
  for (let c = 65; c <= 90; c++) {
    const d = `${String.fromCharCode(c)}:\\Projects`;
    if (exists(d)) out.push(d);
  }
  return out;
};

/** A folder holding a browser's or app's own data ("Local State" beside it): never project material. */
export async function isAppData(dir: string): Promise<boolean> {
  try {
    const names = await readdir(dir);
    return names.includes('Local State') || (names.includes('Preferences') && names.includes('Cookies'));
  } catch {
    return false;
  }
}

/** The folder a path is in ("C:\Users\pat\Downloads\projects" for "C:\Users\pat\Downloads\projects\01 Upgrade"). */
export const parentOf = (folder: string) => {
  const f = String(folder ?? '').replace(/[\\/]+$/, '');
  const at = Math.max(f.lastIndexOf('\\'), f.lastIndexOf('/'));
  return at > 0 ? f.slice(0, at) : '';
};

export class ProjectPlaces {
  private seen = new Map<string, { at: number; is: boolean }>();

  constructor(private readonly o: { choices: FolderChoices; home?: string; now?: () => number; isFolder?: (folder: string) => boolean }) {}

  get home(): string {
    return this.o.home ?? os.homedir();
  }

  private now() {
    return this.o.now?.() ?? Date.now();
  }

  /** Whether a folder is on this PC (asked often, by every list of projects: kept for a few seconds). */
  isFolder = (folder: string): boolean => {
    if (this.o.isFolder) return this.o.isFolder(folder);
    const key = folderKey(folder);
    const was = this.seen.get(key);
    if (was && this.now() - was.at < 4000) return was.is;
    let is = false;
    try {
      is = !!statSync(folder, { throwIfNoEntry: false })?.isDirectory();
    } catch {
      is = false;
    }
    if (this.seen.size > 500) this.seen.clear();
    this.seen.set(key, { at: this.now(), is });
    return is;
  };

  /** Where the project's folder is on this PC. */
  place(p: Pick<Project, 'folder' | 'key'>): FolderPlace {
    const recorded = recordedFolder(p);
    return placeOf(recorded, { choice: recorded ? this.o.choices.folderChoice(folderKey(recorded)) : null, home: this.home, isFolder: this.isFolder });
  }

  /** The project as this PC reaches it (its folder the one on this PC; none when it's on another PC). Never written back. */
  local<T extends Pick<Project, 'folder' | 'key'>>(p: T): T {
    return onThisPC(p, this.place(p));
  }

  private async keep(recorded: string, choice: FolderChoice | null) {
    const key = folderKey(recorded);
    if (!key) throw new Error('This project names no folder.');
    this.seen.clear();
    await this.o.choices.setFolderChoice(key, choice);
  }

  /** The folder chosen for the project on this PC (the note keeps the other PC's). */
  async choose(recorded: string, folder: string): Promise<string> {
    const f = String(folder ?? '').trim();
    if (!f || !path.isAbsolute(f)) throw new Error('Choose a folder on this PC.');
    const real = path.resolve(f);
    if (path.parse(real).root === real) throw new Error('Choose the project’s own folder, not a whole drive.');
    if (!(await stat(real).catch(() => null))?.isDirectory()) throw new Error(`The folder ${real} isn’t on this PC.`);
    // The folder the note names after all: nothing to remember.
    await this.keep(recorded, folderKey(real) === folderKey(recorded) ? null : { folder: real });
    return real;
  }

  /** Working on the project without a folder on this PC: its own Files folder in Ironleaf is used. */
  async without(recorded: string): Promise<void> {
    await this.keep(recorded, { none: true });
  }

  /** What this PC chose put away: the folder is looked for again as the note names it. */
  async forget(recorded: string): Promise<void> {
    await this.keep(recorded, null);
  }

  /**
   * Folders on this PC with the same name as the project's (case aside): under this PC's user folder where the note's is
   * (C:\Users\<this user>\Downloads\projects), where this PC keeps its other projects, Downloads, Documents, Desktop,
   * OneDrive and the usual project folders. Best first: the one whose path ends most like the note's.
   */
  async find(recorded: string, others: string[] = [], { budget = 6000, ms = 5000 } = {}): Promise<string[]> {
    const name = lastPart(recorded).toLowerCase();
    if (!name) return [];
    const home = this.home;
    const roots: { dir: string; depth: number }[] = [];
    const add = (dir: string | null | undefined, depth: number) => {
      if (dir && isWholePath(dir) && !roots.some((r) => folderKey(r.dir) === folderKey(dir))) roots.push({ dir, depth });
    };
    add(forThisUser(parentOf(recorded), home), 1);
    for (const o of others) add(parentOf(o), 1);
    for (const sub of ['Downloads', 'Documents', 'Desktop', 'Projects', 'projects', 'source/repos', 'repos', 'Work', 'dev', 'code']) add(path.join(home, ...sub.split('/')), 3);
    try {
      for (const e of await readdir(home, { withFileTypes: true }))
        if (e.isDirectory() && /^(OneDrive|Dropbox)/i.test(e.name)) {
          add(path.join(home, e.name), 2);
          for (const sub of ['Documents', 'Desktop', 'Projects']) add(path.join(home, e.name, sub), 3);
        }
    } catch {
      /* no home folder to read */
    }
    if (process.platform === 'win32') for (const d of driveProjects((p) => this.isFolder(p))) add(d, 2);
    add(home, 2);

    const found = new Map<string, string>();
    const started = this.now();
    let visited = 0;
    for (const root of roots) {
      if (!this.isFolder(root.dir)) continue;
      const queue: { dir: string; depth: number }[] = [{ dir: root.dir, depth: 0 }];
      while (queue.length && visited < budget && this.now() - started < ms) {
        const { dir, depth } = queue.shift()!;
        visited++;
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (!e.isDirectory() || e.isSymbolicLink() || e.name.startsWith('.') || e.name.startsWith('$')) continue;
          const abs = path.join(dir, e.name);
          if (e.name.toLowerCase() === name) found.set(folderKey(abs), abs);
          else if (depth + 1 < root.depth && !skipDir(e.name, true) && !(await isAppData(abs))) queue.push({ dir: abs, depth: depth + 1 });
        }
      }
      if (found.size >= 8) break;
    }
    const tail = (f: string) => {
      const a = folderKey(f).split('/').reverse();
      const b = folderKey(recorded).split('/').reverse();
      let n = 0;
      while (n < a.length && n < b.length && a[n] === b[n]) n++;
      return n;
    };
    return [...found.values()].sort((x, y) => tail(y) - tail(x) || x.length - y.length).slice(0, 8);
  }

  /**
   * Where a new folder for a project goes on this PC: where the note's folder is, under this PC's user folder, when that
   * is here; else where this PC keeps most of its other projects; else a Projects folder in the user's folder.
   */
  rootFor(recorded: string, others: string[] = []): string {
    const same = forThisUser(parentOf(recorded), this.home);
    if (same && this.isFolder(same)) return same;
    const count = new Map<string, { dir: string; n: number }>();
    for (const o of others) {
      const dir = parentOf(o);
      if (!dir || !this.isFolder(dir)) continue;
      const k = folderKey(dir);
      count.set(k, { dir, n: (count.get(k)?.n ?? 0) + 1 });
    }
    const most = [...count.values()].sort((a, b) => b.n - a.n)[0];
    return most?.dir ?? path.join(this.home, 'Projects');
  }

  /** A new folder for the project on this PC (named as the note's), made and chosen. One already there is used. */
  async makeHere(recorded: string, others: string[] = []): Promise<string> {
    const name = safeName(lastPart(recorded));
    const target = path.join(this.rootFor(recorded, others), name);
    await mkdir(target, { recursive: true });
    return this.choose(recorded, target);
  }
}

/**
 * Projects as this PC reaches them, for the main process's readers outside Projects (Today, the assistant): set once by
 * the app (src/main/app.ts); the project as written until then.
 */
let current: ProjectPlaces | null = null;
export const setProjectPlaces = (places: ProjectPlaces | null) => {
  current = places;
};
export function hereProject<T extends Pick<Project, 'folder' | 'key'>>(p: T): T {
  return current ? current.local(p) : p;
}
export const projectPlace = (p: Pick<Project, 'folder' | 'key'>): FolderPlace | null => current?.place(p) ?? null;
