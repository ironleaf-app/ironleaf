// File recovery: copies of notes as they change (at most every few minutes each, kept for some days), so an earlier
// version can be brought back even after the note was overwritten or deleted. Kept in Ironleaf's data folder, one folder
// per library and per note. Each copy says who made the change (19 Oct 2026, 5.0.0: the person, the assistant, The former
// host app, a sync…; src/shared/versions.ts): when someone else changes a note straight after, the last words are kept
// first under their own author, so the history never credits one person's typing to another.

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { libraryKey } from './library-state';
import type { Snapshot, SnapshotFile } from '../shared/types';
import { cleanAuthor, type VersionAuthor } from '../shared/versions';

interface Meta {
  path: string;
  /** Who made each copy, by its id. */
  by?: Record<string, string>;
}

const noteKey = (rel: string) => createHash('sha1').update(rel.toLowerCase()).digest('hex').slice(0, 24);

export class Recovery {
  private root = '';
  private dir = '';
  private lastTime = new Map<string, number>();
  private lastText = new Map<string, string>();
  /** The last write heard for each note, kept as a copy or not: its words and who made them. */
  private lastWrite = new Map<string, { text: string; by?: VersionAuthor }>();
  /** Copies are kept one at a time (a note written twice quickly never has its copies crossed). */
  private queue: Promise<void> = Promise.resolve();
  private lastStamp = 0;

  constructor(
    private readonly dataDir: string,
    private readonly prefs: () => { minutes: number; days: number },
  ) {}

  /** Follows the library that is open. */
  use(libraryRoot: string): void {
    this.root = libraryRoot;
    this.dir = path.join(this.dataDir, 'recovery', libraryKey(libraryRoot));
    this.lastTime.clear();
    this.lastText.clear();
    this.lastWrite.clear();
    void this.prune();
  }

  private noteDir(rel: string): string {
    if (!this.dir) throw new Error('No notes are open.');
    return path.join(this.dir, noteKey(rel));
  }

  /**
   * Keeps a copy of this note's text when the last copy is old enough and the text has changed; `by` is who changed it
   * (left out: whoever wrote it last). A change by someone else is always kept, whatever the time since the last copy.
   */
  keep(rel: string, text: string, opts: boolean | { force?: boolean; by?: VersionAuthor } = {}): Promise<void> {
    const o = typeof opts === 'boolean' ? { force: opts } : opts;
    const run = this.queue.then(() => this.keepNow(rel, text, o.force === true, o.by));
    this.queue = run.catch(() => {});
    return run;
  }

  private async keepNow(rel: string, text: string, force: boolean, by: VersionAuthor | undefined): Promise<void> {
    const { minutes } = this.prefs();
    if (!this.dir || !text.trim()) return;
    const key = rel.toLowerCase();
    const prev = this.lastWrite.get(key);
    // The same words again (the folder watcher hearing Ironleaf's own write): nothing new, and nobody new to credit.
    if (!force && prev && prev.text === text) return;
    const author = by ?? prev?.by;
    this.lastWrite.set(key, { text, ...(author ? { by: author } : {}) });
    if (!force && minutes <= 0) return;
    const now = Date.now();
    const handover = !!prev && !!author && prev.by !== author;
    try {
      // The last words before someone else's change, when no copy has them yet: kept under their own author first.
      if (handover && prev.text.trim() && this.lastText.get(key) !== prev.text) await this.write(rel, prev.text, prev.by);
      if (!force && !handover && now - (this.lastTime.get(key) ?? 0) < minutes * 60_000) return;
      if (this.lastText.get(key) === text) return;
      // The newest copy on disk may be the same text (from before Ironleaf started).
      const versions = await this.versions(rel);
      if (versions[0] && !force) {
        const newest = await fsp.readFile(path.join(this.noteDir(rel), `${versions[0].id}.md`), 'utf8').catch(() => '');
        if (newest === text) {
          this.lastTime.set(key, now);
          this.lastText.set(key, text);
          return;
        }
      }
      await this.write(rel, text, author);
    } catch {
      // Recovery is a safety net: a copy that can't be written never stops the note being saved.
    }
  }

  /** One copy written, with who made it, under a time of its own (two in the same moment never share a name). */
  private async write(rel: string, text: string, by: VersionAuthor | undefined): Promise<void> {
    const dir = this.noteDir(rel);
    const key = rel.toLowerCase();
    const stamp = Math.max(Date.now(), this.lastStamp + 1);
    this.lastStamp = stamp;
    await fsp.mkdir(dir, { recursive: true });
    const meta = await this.meta(dir);
    const authors = { ...(meta?.by ?? {}), ...(by ? { [String(stamp)]: by } : {}) };
    await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ path: rel, ...(Object.keys(authors).length ? { by: authors } : {}) } satisfies Meta), 'utf8');
    await fsp.writeFile(path.join(dir, `${stamp}.md`), text, 'utf8');
    this.lastTime.set(key, stamp);
    this.lastText.set(key, text);
  }

  private async meta(dir: string): Promise<Meta | null> {
    try {
      const v = JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8')) as Meta;
      return v && typeof v.path === 'string' ? v : null;
    } catch {
      return null;
    }
  }

  /** The notes that have copies, newest first. */
  async list(): Promise<SnapshotFile[]> {
    if (!this.dir) return [];
    const out: SnapshotFile[] = [];
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(this.dir);
    } catch {
      return [];
    }
    for (const entry of entries) {
      try {
        const meta = JSON.parse(await fsp.readFile(path.join(this.dir, entry, 'meta.json'), 'utf8')) as Meta;
        const times = (await fsp.readdir(path.join(this.dir, entry))).filter((f) => /^\d+\.md$/.test(f)).map((f) => Number(f.slice(0, -3)));
        if (times.length) out.push({ path: meta.path, count: times.length, latest: Math.max(...times) });
      } catch {
        // A folder without its record is skipped.
      }
    }
    return out.sort((a, b) => b.latest - a.latest);
  }

  async versions(rel: string): Promise<Snapshot[]> {
    const dir = this.noteDir(rel);
    let files: string[] = [];
    try {
      files = (await fsp.readdir(dir)).filter((f) => /^\d+\.md$/.test(f));
    } catch {
      return [];
    }
    const authors = (await this.meta(dir))?.by ?? {};
    const out = await Promise.all(
      files.map(async (f): Promise<Snapshot> => {
        const stat = await fsp.stat(path.join(dir, f)).catch(() => null);
        const id = f.slice(0, -3);
        const by = cleanAuthor(authors[id]);
        return { id, time: Number(id), size: stat?.size ?? 0, ...(by ? { by } : {}) };
      }),
    );
    return out.sort((a, b) => b.time - a.time);
  }

  async read(rel: string, id: string): Promise<string> {
    if (!/^\d{10,16}$/.test(id)) throw new Error('Unknown copy.');
    return fsp.readFile(path.join(this.noteDir(rel), `${id}.md`), 'utf8');
  }

  /** A renamed or moved note keeps its copies. */
  async renamed(from: string, to: string): Promise<void> {
    if (!this.dir || from.toLowerCase() === to.toLowerCase()) return;
    const src = this.noteDir(from);
    const dest = this.noteDir(to);
    try {
      await fsp.access(src);
    } catch {
      return;
    }
    try {
      const by = { ...((await this.meta(dest))?.by ?? {}), ...((await this.meta(src))?.by ?? {}) };
      await fsp.mkdir(dest, { recursive: true });
      for (const f of await fsp.readdir(src)) if (/^\d+\.md$/.test(f)) await fsp.rename(path.join(src, f), path.join(dest, f)).catch(() => {});
      await fsp.writeFile(path.join(dest, 'meta.json'), JSON.stringify({ path: to, ...(Object.keys(by).length ? { by } : {}) } satisfies Meta), 'utf8');
      const was = this.lastWrite.get(from.toLowerCase());
      if (was) this.lastWrite.set(to.toLowerCase(), was);
      await fsp.rm(src, { recursive: true, force: true });
    } catch {
      // The copies stay under the old name.
    }
  }

  /** Copies older than the days set in Settings go (Ironleaf's own copies, never a note). */
  async prune(): Promise<void> {
    const dir = this.dir;
    if (!dir) return;
    const cutoff = Date.now() - this.prefs().days * 86_400_000;
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const folder = path.join(dir, entry);
      try {
        const files = (await fsp.readdir(folder)).filter((f) => /^\d+\.md$/.test(f));
        const old = files.filter((f) => Number(f.slice(0, -3)) < cutoff);
        for (const f of old) await fsp.rm(path.join(folder, f), { force: true });
        if (old.length === files.length) await fsp.rm(folder, { recursive: true, force: true });
      } catch {
        // Skipped this time.
      }
    }
  }

  get library(): string {
    return this.root;
  }
}
