// Searching inside project files (17 Oct 2026). Each project's folder on the PC (its project file's folder:) is gone
// through, and the words of its documents are kept in an index in Ironleaf's own data on this PC: never among the
// notes, never in the project's folder, and nothing in the folder is ever written. Kept current as files change: a
// change re-reads only the files that changed (by size and time). Limits on size, pages and the text kept
// (src/shared/file-index.ts FILE_INDEX_LIMITS); caches, build output and hidden files are left out
// (src/main/projects.ts walkFolder). Switched off per project or entirely in Settings › Search, which also forgets what
// was kept.

import { createHash } from 'node:crypto';
import { watch, promises as fsp, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { parseQuery, QueryMatcher } from '../shared/query';
import { FILE_INDEX_LIMITS, placeOf, type FileHit, type FileIndexStatus, type IndexedFile } from '../shared/file-index';
import { readFileText, type PdfReader } from './doc-text';
import { trimSnippet } from './indexer';
import { insideFolder, walkFolder } from './projects';
import { skipDir } from './project-places';
import type { ProjectFile } from '../shared/types';

export interface FileIndexProjectRef {
  /** The project's file in the notes. */
  path: string;
  name: string;
  folder?: string;
}

export interface FileIndexOptions {
  /** Where the index is kept: a folder in Ironleaf's own data. */
  dir: string;
  pdf: PdfReader | null;
  /** Inside the former host app: its reader for the documents Ironleaf can't read itself. */
  bridge?: (abs: string) => Promise<string | null>;
  projects(): FileIndexProjectRef[];
  /** Settings › Search: on, and the projects (their files' paths) switched off. */
  prefs(): { on: boolean; off: string[] };
  onStatus?(status: FileIndexStatus): void;
  /** Watch the folders for changes (off in tests that step it by hand). */
  watch?: boolean;
  /** How long after a change in a folder it is gone through (the change has settled). */
  settleMs?: number;
  limits?: Partial<typeof FILE_INDEX_LIMITS>;
  log?(message: string): void;
}

interface Folder {
  key: string;
  folder: string;
  files: Map<string, IndexedFile>;
  checked?: number;
  exists: boolean;
  /** Loaded from what was kept (or nothing was kept). */
  loaded: boolean;
  watcher?: FSWatcher;
  timer?: NodeJS.Timeout;
  saveTimer?: NodeJS.Timeout;
  /** Bumped when the folder is let go: work under an older one stops. */
  gen: number;
}

const STORE_VERSION = 1;
const normal = (folder: string) => {
  const p = path.resolve(folder);
  return process.platform === 'win32' ? p.toLowerCase() : p;
};
export const folderKey = (folder: string) => createHash('sha1').update(normal(folder)).digest('hex');
const relKey = (rel: string) => rel.replace(/\\/g, '/').toLowerCase();
const tick = () => new Promise<void>((r) => setImmediate(r));

/** A search's plain words (no operators), lower-cased: what a file's name and words are checked for first. */
function plainWords(query: string): string[] | null {
  if (/[:()"/[\]]|(^|\s)-\S|\sOR\s/.test(query)) return null;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? words : null;
}

export class FileIndex {
  private folders = new Map<string, Folder>();
  private queue: string[] = [];
  private running = false;
  private done = 0;
  private todo = 0;
  private current: string | undefined;
  private statusTimer: NodeJS.Timeout | undefined;
  private sweep: NodeJS.Timeout | undefined;
  private stopped = false;
  private readonly limits: typeof FILE_INDEX_LIMITS;
  /** Waiting for the queue to empty (tests, and a rebuild). */
  private idleWaiters: (() => void)[] = [];
  /** Bumped by every change to what is kept: searches remembered from before it are asked again. */
  private version = 0;
  /** The last searches (the search panel, the navigator and a project's Files often ask the same at once). */
  private recent = new Map<string, { version: number; hits: FileHit[] }>();

  constructor(private readonly o: FileIndexOptions) {
    this.limits = { ...FILE_INDEX_LIMITS, ...(o.limits ?? {}) };
    if (o.watch !== false) {
      // Every ten minutes the folders are checked again (a share that can't be watched, a change that was missed).
      this.sweep = setInterval(() => this.checkAll(), 10 * 60 * 1000);
      this.sweep.unref?.();
    }
  }

  // ── Which folders ───────────────────────────────────────────────────────────────────────────────────────────────

  /** The projects searched now: those with a folder, not switched off, while search inside files is on. */
  private wanted(): Map<string, { folder: string; projects: FileIndexProjectRef[] }> {
    const out = new Map<string, { folder: string; projects: FileIndexProjectRef[] }>();
    const prefs = this.o.prefs();
    if (!prefs.on) return out;
    const off = new Set(prefs.off.map((p) => p.toLowerCase()));
    for (const p of this.o.projects()) {
      if (!p.folder || off.has(p.path.toLowerCase()) || !path.isAbsolute(p.folder)) continue;
      const key = folderKey(p.folder);
      const entry = out.get(key) ?? { folder: p.folder, projects: [] };
      entry.projects.push(p);
      out.set(key, entry);
    }
    return out;
  }

  /**
   * Brings the index in line with the projects and Settings › Search: new folders are gone through, folders of projects
   * switched off are forgotten (what was kept is deleted), folders no longer among the projects are let go.
   */
  async sync(): Promise<void> {
    if (this.stopped) return;
    this.version++;
    const wanted = this.wanted();
    const prefs = this.o.prefs();
    const off = new Set(prefs.off.map((p) => p.toLowerCase()));
    const switchedOff = new Set<string>();
    for (const p of this.o.projects()) if (p.folder && (!prefs.on || off.has(p.path.toLowerCase()))) switchedOff.add(folderKey(p.folder));
    for (const [key, f] of this.folders) {
      if (wanted.has(key)) continue;
      this.release(f, !switchedOff.has(key));
      this.folders.delete(key);
      if (switchedOff.has(key)) await this.forgetStored(key);
    }
    // Switched off but never loaded (switched off before this run): what was kept goes too.
    for (const key of switchedOff) if (!wanted.has(key)) await this.forgetStored(key);
    const added: string[] = [];
    for (const [key, w] of wanted) {
      if (this.folders.has(key)) continue;
      const f: Folder = { key, folder: w.folder, files: new Map(), exists: true, loaded: false, gen: 0 };
      this.folders.set(key, f);
      await this.load(f);
      this.watchFolder(f);
      added.push(key);
    }
    this.version++;
    // All at once, so the progress line counts every file to read.
    for (const key of added) this.enqueue(key, false);
    if (added.length) void this.pump();
    this.emit();
  }

  /** Everything is read again from the start (Settings › Search › Read again). */
  async rebuild(): Promise<void> {
    this.version++;
    for (const f of this.folders.values()) {
      f.files.clear();
      f.checked = undefined;
      this.enqueue(f.key, false);
    }
    void this.pump();
    this.emit();
  }

  /** A project's folder was looked at (its page opened): gone through again when it wasn't lately. */
  touch(folder: string | undefined): void {
    if (!folder) return;
    const f = this.folders.get(folderKey(folder));
    if (f && (!f.checked || Date.now() - f.checked > 30_000)) this.enqueue(f.key);
  }

  /** Every folder gone through again (only changed files are read). */
  checkAll(): void {
    for (const f of this.folders.values()) this.enqueue(f.key, false);
    void this.pump();
  }

  /** A folder let go: its watcher closed, its work stopped; what's waiting to be kept is written (unless forgotten). */
  private release(f: Folder, keep = true): void {
    f.gen++;
    f.watcher?.close();
    f.watcher = undefined;
    clearTimeout(f.timer);
    if (f.saveTimer) {
      clearTimeout(f.saveTimer);
      f.saveTimer = undefined;
      if (keep) void this.save(f);
    }
    this.queue = this.queue.filter((k) => k !== f.key);
  }

  private watchFolder(f: Folder): void {
    if (this.o.watch === false) return;
    try {
      f.watcher = watch(f.folder, { recursive: true, persistent: false }, (_event, name) => {
        // A change among hidden files, Office's own "~$" files or junk folders isn't one.
        if (name) {
          const parts = String(name).split(/[\\/]/);
          if (parts.some((p) => p.startsWith('.') || p.startsWith('~$') || skipDir(p))) return;
        }
        clearTimeout(f.timer);
        f.timer = setTimeout(() => this.enqueue(f.key), this.o.settleMs ?? 1500);
      });
      f.watcher.on('error', () => {
        f.watcher?.close();
        f.watcher = undefined;
      });
    } catch {
      // A folder that can't be watched (not there, a share that doesn't allow it): checked when its page opens, and
      // every ten minutes.
    }
  }

  // ── Keeping it ──────────────────────────────────────────────────────────────────────────────────────────────────

  private file(key: string): string {
    return path.join(this.o.dir, `${key}.json`);
  }

  private async load(f: Folder): Promise<void> {
    try {
      const kept = JSON.parse(await fsp.readFile(this.file(f.key), 'utf8')) as { v?: number; folder?: string; checked?: number; files?: IndexedFile[] };
      if (kept.v === STORE_VERSION && Array.isArray(kept.files) && kept.folder && normal(kept.folder) === normal(f.folder)) {
        for (const x of kept.files) if (x && typeof x.rel === 'string') f.files.set(relKey(x.rel), x);
        f.checked = kept.checked;
      }
    } catch {
      // Nothing kept yet (or it couldn't be read): gone through from the start.
    }
    f.loaded = true;
  }

  private scheduleSave(f: Folder): void {
    if (f.saveTimer) return;
    f.saveTimer = setTimeout(() => {
      f.saveTimer = undefined;
      void this.save(f);
    }, 2000);
    f.saveTimer.unref?.();
  }

  private async save(f: Folder): Promise<void> {
    try {
      await fsp.mkdir(this.o.dir, { recursive: true });
      const target = this.file(f.key);
      await fsp.writeFile(`${target}.part`, JSON.stringify({ v: STORE_VERSION, folder: f.folder, checked: f.checked, files: [...f.files.values()] }));
      await fsp.rename(`${target}.part`, target);
    } catch (err) {
      this.o.log?.(`Ironleaf could not keep the files index: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async forgetStored(key: string): Promise<void> {
    await fsp.rm(this.file(key), { force: true }).catch(() => {});
  }

  /** Whatever is waiting is written now (Ironleaf closing). */
  async flush(): Promise<void> {
    await Promise.all(
      [...this.folders.values()].filter((f) => f.saveTimer).map((f) => {
        clearTimeout(f.saveTimer);
        f.saveTimer = undefined;
        return this.save(f);
      }),
    );
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.sweep);
    for (const f of this.folders.values()) this.release(f);
    this.o.pdf?.stop();
  }

  // ── Going through the folders ───────────────────────────────────────────────────────────────────────────────────

  private enqueue(key: string, start = true): void {
    if (this.stopped || !this.folders.has(key)) return;
    if (!this.queue.includes(key)) this.queue.push(key);
    if (start) void this.pump();
  }

  /** Resolves when nothing is waiting to be read. */
  idle(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.stopped) {
        // Every folder waiting is looked through first (names, sizes and times only), so the progress line counts all
        // the files to read; then they are read, folder by folder.
        const keys = this.queue.splice(0);
        const plans: { f: Folder; stale: ProjectFile[] }[] = [];
        for (const key of keys) {
          const f = this.folders.get(key);
          if (!f) continue;
          const stale = await this.plan(f).catch((err) => (this.o.log?.(`Ironleaf could not look through a project folder: ${err instanceof Error ? err.message : String(err)}`), null));
          if (stale) plans.push({ f, stale });
        }
        this.todo += plans.reduce((n, p) => n + p.stale.length, 0);
        const first = plans.find((p) => p.stale.length);
        if (first) this.current = this.projectNames(first.f.key) || path.basename(first.f.folder);
        if (this.todo) this.emit(this.done === 0);
        for (const { f, stale } of plans) await this.refresh(f, stale).catch((err) => this.o.log?.(`Ironleaf could not read a project folder: ${err instanceof Error ? err.message : String(err)}`));
      }
    } finally {
      this.running = false;
      this.done = 0;
      this.todo = 0;
      this.current = undefined;
      this.emit(true);
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  private totalChars(): number {
    let n = 0;
    for (const f of this.folders.values()) for (const x of f.files.values()) n += x.text?.length ?? 0;
    return n;
  }

  /** One folder looked through: files gone are dropped; what is new or changed (newest first) is to be read. Null: the folder isn't there now. */
  private async plan(f: Folder): Promise<ProjectFile[] | null> {
    const gen = f.gen;
    const listed = await walkFolder(f.folder);
    if (gen !== f.gen) return null;
    f.exists = !!listed;
    if (!listed) {
      // Not on this PC now (a share offline, a drive out): what was kept stays for when it's back.
      this.emit();
      return null;
    }
    const files = listed.slice(0, this.limits.files);
    const present = new Set(files.map((x) => relKey(x.rel)));
    let gone = false;
    for (const k of [...f.files.keys()]) {
      if (!present.has(k)) {
        f.files.delete(k);
        gone = true;
      }
    }
    if (gone) {
      this.version++;
      this.scheduleSave(f);
    }
    // Files found by name only because the index was full are read once there is room again.
    const roomy = this.limits.totalChars - this.totalChars() > 100_000;
    return files.filter((x) => {
      const known = f.files.get(relKey(x.rel));
      return !known || known.size !== x.size || Math.round(known.modified) !== Math.round(x.modified) || (known.state === 'full' && roomy);
    });
  }

  /** One folder's new and changed files read. */
  private async refresh(f: Folder, stale: ProjectFile[]): Promise<void> {
    const gen = f.gen;
    let changed = false;
    this.current = this.projectNames(f.key) || path.basename(f.folder);
    let total = this.totalChars();
    for (const x of stale) {
      if (gen !== f.gen || this.stopped) return;
      const before = f.files.get(relKey(x.rel));
      total -= before?.text?.length ?? 0;
      let abs: string;
      try {
        abs = insideFolder(f.folder, x.rel);
      } catch {
        continue;
      }
      const room = Math.max(0, this.limits.totalChars - total);
      const read: { state: IndexedFile['state']; text?: string; cut?: boolean; why?: string } = room < Math.min(1000, this.limits.totalChars / 20) ? { state: 'full' } : await readFileText(abs, x.ext, x.size, { pdf: this.o.pdf, bridge: this.o.bridge, maxChars: Math.min(this.limits.fileChars, room), limits: this.limits });
      if (gen !== f.gen) return;
      const entry: IndexedFile = { rel: x.rel, name: x.name, ext: x.ext, size: x.size, modified: x.modified, ...(x.created !== undefined ? { created: x.created } : {}), state: read.state, ...(read.why ? { why: read.why } : {}) };
      if (read.text !== undefined) {
        entry.text = read.text;
        if (read.cut) entry.cut = true;
        total += read.text.length;
      }
      f.files.set(relKey(x.rel), entry);
      changed = true;
      this.version++;
      this.done++;
      this.emit();
      await tick();
    }
    f.checked = Date.now();
    if (changed) this.scheduleSave(f);
  }

  // ── What the window and the assistant see ───────────────────────────────────────────────────────────────────────

  private projectNames(key: string): string {
    const w = this.wanted().get(key);
    return w ? w.projects.map((p) => p.name).join(', ') : '';
  }

  status(): FileIndexStatus {
    const prefs = this.o.prefs();
    const off = new Set(prefs.off.map((p) => p.toLowerCase()));
    let files = 0;
    let withText = 0;
    let chars = 0;
    const projects = this.o
      .projects()
      .filter((p) => p.folder)
      .map((p) => {
        const f = this.folders.get(folderKey(p.folder!));
        const list = f ? [...f.files.values()] : [];
        const text = list.filter((x) => x.state === 'text').length;
        return { path: p.path, name: p.name, folder: p.folder!, on: prefs.on && !off.has(p.path.toLowerCase()), exists: f ? f.exists : true, files: list.length, withText: text, ...(f?.checked ? { checked: f.checked } : {}) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const f of this.folders.values()) {
      for (const x of f.files.values()) {
        files++;
        if (x.state === 'text') withText++;
        chars += x.text?.length ?? 0;
      }
    }
    return { on: prefs.on, busy: this.running, done: this.done, todo: this.todo, ...(this.current ? { current: this.current } : {}), projects, files, withText, chars, maxChars: this.limits.totalChars, bridge: !!this.o.bridge };
  }

  private emit(now = false): void {
    if (!this.o.onStatus) return;
    if (now) {
      clearTimeout(this.statusTimer);
      this.statusTimer = undefined;
      this.o.onStatus(this.status());
      return;
    }
    if (this.statusTimer) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined;
      this.o.onStatus?.(this.status());
    }, 250);
    this.statusTimer.unref?.();
  }

  /**
   * Files in the projects' folders that match a search (the same words, "phrases", OR, -leave out and /patterns/ as the
   * notes' search): by their words, or by their name and folder. `project` keeps to one project (its file's path).
   */
  search(query: string, opts: { project?: string; limit?: number; snippets?: number } = {}): FileHit[] {
    const prefs = this.o.prefs();
    const key = JSON.stringify([query, opts.project ?? '', opts.limit ?? 50, opts.snippets ?? 3, prefs.on, prefs.off]);
    const known = this.recent.get(key);
    if (known && known.version === this.version) return known.hits;
    const hits = this.searchNow(query, opts);
    this.recent.delete(key);
    this.recent.set(key, { version: this.version, hits });
    if (this.recent.size > 24) this.recent.delete(this.recent.keys().next().value!);
    return hits;
  }

  private searchNow(query: string, opts: { project?: string; limit?: number; snippets?: number }): FileHit[] {
    const root = parseQuery(query.slice(0, 1000));
    if (!root) return [];
    const matcher = new QueryMatcher(root);
    const words = plainWords(query);
    const limit = opts.limit ?? 50;
    const per = opts.snippets ?? 3;
    const hits: FileHit[] = [];
    for (const [key, w] of this.wanted()) {
      const f = this.folders.get(key);
      if (!f) continue;
      const projects = opts.project ? w.projects.filter((p) => p.path.toLowerCase() === opts.project!.toLowerCase()) : w.projects.slice(0, 1);
      const project = projects[0];
      if (!project) continue;
      for (const x of f.files.values()) {
        const text = x.text ?? '';
        // Plain words: a quick look first (most files have none of them).
        if (words) {
          const lowerName = x.rel.toLowerCase();
          const lower = text.toLowerCase();
          if (!words.every((wd) => lowerName.includes(wd) || lower.includes(wd))) continue;
        }
        const doc = { path: x.rel, title: x.rel, content: text, tags: [], props: {} };
        if (!matcher.matches(doc)) continue;
        const snippets: FileHit['snippets'] = [];
        let matches = 0;
        if (text && matcher.positives.length) {
          // The lines with the most of the words searched for are shown (in the order they come); a page's, slide's
          // or sheet's name counts as a line.
          const lines = text.split('\n');
          const found: { at: number; line: string; ranges: [number, number][]; label: boolean; distinct: number }[] = [];
          for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            if (!raw) continue;
            const label = raw.startsWith('\f');
            const line = label ? raw.slice(1) : raw;
            const ranges = matcher.ranges(line);
            if (!ranges.length) continue;
            matches += ranges.length;
            if (found.length < 400) found.push({ at: i, line, ranges, label, distinct: new Set(ranges.map(([a, b]) => line.slice(a, b).toLowerCase())).size });
          }
          const best = [...found].sort((a, b) => b.distinct - a.distinct || Number(a.label) - Number(b.label) || a.at - b.at).slice(0, per).sort((a, b) => a.at - b.at);
          for (const f of best) {
            const s = trimSnippet(f.line, f.at, f.ranges);
            const where = f.label ? undefined : placeOf(lines, f.at);
            snippets.push({ text: s.text, ranges: s.ranges, ...(where ? { where } : {}) });
          }
        }
        const named = matcher.score({ path: x.rel, title: x.name, content: '', tags: [], props: {} });
        const score = matcher.score({ path: x.rel, title: x.name, content: text, tags: [], props: {} }) + (named > 1 ? 6 : 0);
        hits.push({ project: project.path, projectName: project.name, folder: f.folder, rel: x.rel, name: x.name, ext: x.ext, size: x.size, modified: x.modified, created: x.created, state: x.state, score, matches, snippets, byName: !matches });
      }
    }
    return hits.sort((a, b) => b.score - a.score || b.modified - a.modified).slice(0, limit);
  }

  /** How many files a project's folder has in the index, and how many with their words (the Files find box). */
  counts(project: string): { files: number; withText: number } | null {
    const p = this.o.projects().find((x) => x.path.toLowerCase() === project.toLowerCase());
    const f = p?.folder ? this.folders.get(folderKey(p.folder)) : undefined;
    if (!f) return null;
    let withText = 0;
    for (const x of f.files.values()) if (x.state === 'text') withText++;
    return { files: f.files.size, withText };
  }

  /**
   * A project file's words (the assistant's read_project_file): from the index when it is current, else read now. Only
   * inside the project's folder, never through a link that leads out of it.
   */
  async read(project: string, rel: string): Promise<{ file: IndexedFile; folder: string; projectName: string }> {
    const p = this.o.projects().find((x) => x.path.toLowerCase() === project.toLowerCase() || x.name.toLowerCase() === project.toLowerCase());
    if (!p) throw new Error(`There is no project ${project}.`);
    if (!p.folder) throw new Error(`${p.name} has no folder on this PC.`);
    const abs = insideFolder(p.folder, rel);
    const [realFolder, real] = await Promise.all([fsp.realpath(p.folder), fsp.realpath(abs).catch(() => null)]);
    if (!real) throw new Error(`There is no ${rel} in ${p.name}’s folder.`);
    const r = path.relative(normal(realFolder), normal(real));
    if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new Error('That file isn’t in the project’s folder.');
    const s = await fsp.stat(real);
    if (!s.isFile()) throw new Error(`${rel} is a folder.`);
    const cleanRel = path.relative(p.folder, abs).split(path.sep).join('/');
    const known = this.folders.get(folderKey(p.folder))?.files.get(relKey(cleanRel));
    if (known && known.size === s.size && Math.round(known.modified) === Math.round(s.mtimeMs) && known.state !== 'full') return { file: known, folder: p.folder, projectName: p.name };
    const name = path.basename(abs);
    const ext = path.extname(name).slice(1).toLowerCase();
    const read = await readFileText(real, ext, s.size, { pdf: this.o.pdf, bridge: this.o.bridge, maxChars: this.limits.fileChars, limits: this.limits });
    return { file: { rel: cleanRel, name, ext, size: s.size, modified: s.mtimeMs, created: s.birthtimeMs || s.ctimeMs, state: read.state, ...(read.text !== undefined ? { text: read.text } : {}), ...(read.cut ? { cut: true } : {}), ...(read.state === 'failed' && read.why ? { why: read.why } : {}) }, folder: p.folder, projectName: p.name };
  }
}
