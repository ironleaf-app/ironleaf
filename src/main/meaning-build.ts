// The meaning model's notes, kept ready (10.0 Wave 2, 2 Nov 2026 to real find-by-meaning, worked out on this PC
// only). Each note's embedding is kept in Ironleaf's own data (one folder per library, never among the notes),
// keyed by what the note says: a note whose words haven't changed is never embedded twice. Built in the
// background when a library opens (the hashed fallback answers meanwhile, so search never has a gap), kept
// current as notes change, with a quiet progress line for the window. Private notes and folders left out of
// search are never embedded (refused here and in the index, so a slip still can't leak).

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { chunkNote, EMBED_DIM, type MeaningStatus } from '../shared/meaning';
import { isPrivatePath } from '../shared/private';
import type { MeaningEmbedderLike } from './meaning-embed';
import type { MeaningIndex } from './meaning-index';

export interface MeaningBuildOptions {
  /** Where this library's embeddings are kept: a folder in Ironleaf's own data. */
  dir: string;
  /** The on-device model (started: embeddings; not started: the hashed fallback answers). */
  embedder: MeaningEmbedderLike | null;
  /** Plain words when the model could not load (shown once, in the window's quiet line). */
  fallbackWords?: string;
  /** The index the vectors are installed into. */
  index: MeaningIndex;
  /** Every note's path (content is pulled per note, so a big library never sits in memory twice). */
  list(): string[];
  /** A note's title and content, or null when it isn't there. */
  read(path: string): { title: string; content: string } | null;
  /** Folders and files left out of search (Settings › Files and links). */
  isExcluded(path: string): boolean;
  onStatus?(status: MeaningStatus): void;
  log?(message: string): void;
}

const STORE_VERSION = 1;
const tick = () => new Promise<void>((r) => setImmediate(r));

/** What a note says, hashed: the cache key (its name counts, as its name counts in the vector). */
export function meaningHash(title: string, content: string): string {
  return createHash('sha1').update(`${title}\n${content}`, 'utf8').digest('hex');
}

interface StoredMap {
  v?: number;
  dim?: number;
  /** Paths in the order their vectors sit in the binary file. */
  order?: { path: string; hash: string; chunks: number }[];
}

export class MeaningBuilder {
  private queue: string[] = [];
  private queued = new Set<string>();
  private running = false;
  private stopped = false;
  /** The pump paused for the model to start (kick() restarts it; the queue and counts wait). */
  private waiting = false;
  private done = 0;
  private todo = 0;
  private embedded = 0;
  private embedder: MeaningEmbedderLike | null;
  private fallbackWords: string;
  private statusTimer: NodeJS.Timeout | undefined;
  private saveTimer: NodeJS.Timeout | undefined;
  private dirty = false;
  private idleWaiters: (() => void)[] = [];
  /** What the cache holds now (path to its hash and chunk count): written back on save. */
  private kept = new Map<string, { hash: string; chunks: number }>();

  constructor(private readonly o: MeaningBuildOptions) {
    this.embedder = o.embedder;
    this.fallbackWords = o.fallbackWords ?? '';
  }

  /** The model decided (started, or failed with plain words): the waiting pump restarts. */
  setEmbedder(embedder: MeaningEmbedderLike | null, fallbackWords = ''): void {
    this.embedder = embedder;
    if (!embedder) this.fallbackWords = fallbackWords;
    this.kick();
    this.emit(true);
  }

  /** Restarts the pump after the model started (or after notes changed while it waited). */
  kick(): void {
    if (this.running || this.stopped || !this.queue.length) return;
    this.todo = this.queue.length;
    this.done = 0;
    void this.pump();
  }

  private mapFile(): string {
    return path.join(this.o.dir, 'map.json');
  }

  private vecFile(): string {
    return path.join(this.o.dir, 'vecs.f32');
  }

  /**
   * The library opening: what was kept is installed, the rest is worked out in the background. Resolves once the
   * kept vectors are in; the rest lands behind `idle()` and the progress line.
   */
  async start(): Promise<void> {
    await this.load();
    const all = this.o.list();
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      // A big library lists thousands here (each read and hashed): yield as it goes, so opening never holds a frame
      // (9 Nov 2026, off the main thread: nothing waits long, even while 2,000 notes queue).
      if (i % 32 === 31) await tick();
      if (!this.wanted(p)) continue;
      // Already kept and unchanged: installed by the load above, never embedded twice.
      const text = this.o.read(p);
      if (text && this.kept.get(p)?.hash === meaningHash(text.title, text.content) && this.o.index.isEmbedded(p)) continue;
      this.enqueue(p, false);
    }
    this.todo = this.queue.length;
    if (this.todo) this.emit(true);
    void this.pump();
  }

  /** Notes changed (saved, or heard from outside): embedded again when their words moved. */
  notesChanged(paths: readonly string[]): void {
    if (this.stopped) return;
    let added = 0;
    for (const p of paths) {
      if (!this.wanted(p)) {
        this.o.index.delete(p);
        if (this.kept.delete(p)) this.scheduleSave();
        continue;
      }
      const text = this.o.read(p);
      if (!text) {
        this.o.index.delete(p);
        if (this.kept.delete(p)) this.scheduleSave();
        continue;
      }
      if (this.kept.get(p)?.hash === meaningHash(text.title, text.content) && this.o.index.isEmbedded(p)) continue;
      if (this.enqueue(p, false)) added++;
    }
    if (added) {
      this.todo += added;
      void this.pump();
    }
    this.emit();
  }

  /** Resolves when nothing is waiting to be embedded. */
  idle(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  status(): MeaningStatus {
    if (!this.embedder) {
      const words = this.fallbackWords ? `Meaning search is off on this PC: ${this.fallbackWords}.` : '';
      return { mode: 'fallback', busy: false, done: 0, todo: 0, embedded: this.embedded, words };
    }
    if (!this.embedder.ready || this.running || this.queue.length || this.todo) {
      const todo = this.todo || this.queue.length;
      const done = Math.min(this.done, todo);
      return { mode: 'starting', busy: true, done, todo, embedded: this.embedded, words: todo ? `Getting meaning search ready… ${done} of ${todo}` : 'Getting meaning search ready…' };
    }
    return { mode: 'ready', busy: false, done: 0, todo: 0, embedded: this.embedded, words: '' };
  }

  /** Whatever is waiting is written now (Ironleaf closing). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    if (this.dirty) await this.save();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.statusTimer);
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      if (this.dirty) void this.save();
    }
    this.queue = [];
    this.queued.clear();
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }

  /** The queries the index embeds (null until the model runs: the hashed fallback answers meanwhile). A search
   *  asked while indexing goes first: through embedQuery when the worker holds the model (9 Nov 2026, off the main
   *  thread, so indexing never holds a search). */
  queries(): { embed(text: string): Promise<number[]> } | null {
    const embedder = this.embedder;
    if (!embedder?.ready) return null;
    if (typeof embedder.embedQuery === 'function') return { embed: async (text: string) => (await embedder.embedQuery!([text]))[0] };
    return { embed: async (text: string) => (await embedder.embed([text]))[0] };
  }

  private wanted(p: string): boolean {
    return !isPrivatePath(p) && !this.o.isExcluded(p);
  }

  private enqueue(p: string, start = true): boolean {
    if (this.stopped || this.queued.has(p)) return false;
    this.queued.add(p);
    this.queue.push(p);
    if (start) void this.pump();
    return true;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.stopped) {
        const p = this.queue.shift()!;
        this.queued.delete(p);
        if (!this.wanted(p)) continue;
        const text = this.o.read(p);
        if (!text) {
          this.o.index.delete(p);
          if (this.kept.delete(p)) this.scheduleSave();
          continue;
        }
        const hash = meaningHash(text.title, text.content);
        const known = this.kept.get(p);
        if (known && known.hash === hash && this.o.index.isEmbedded(p)) continue;
        const embedder = this.embedder;
        // No model (it could not load): the queue drains, the hashed fallback answers.
        if (!embedder) continue;
        // The model still starting: the note waits its turn (kick() restarts the pump).
        if (!embedder.ready) {
          this.queue.unshift(p);
          this.queued.add(p);
          this.waiting = true;
          return;
        }
        try {
          // Its name counts twice in each piece, as Related notes weighs names. One piece per call (9 Nov 2026, off
          // the main thread): the same vectors as one batch (embedding loops the texts), but a search asked while
          // indexing waits at most one piece in the worker, never a whole note.
          const pieces = chunkNote(text.content).map((chunk) => `${text.title} ${text.title} ${chunk}`);
          const wanted = pieces.length ? pieces : [`${text.title} ${text.title}`];
          const vecs: number[][] = [];
          for (const piece of wanted) vecs.push(...(await embedder.embed([piece])));
          if (this.stopped) return;
          this.o.index.setVector(p, vecs[0], vecs.slice(1));
          this.kept.set(p, { hash, chunks: vecs.length });
          this.embedded = this.kept.size;
          this.dirty = true;
          this.scheduleSave();
        } catch (err) {
          this.o.log?.(`Ironleaf could not work out a note's meaning: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          this.done++;
          this.emit();
        }
        await tick();
      }
    } finally {
      this.running = false;
      // Paused for the model: the queue, the counts and the idle waiters all stand.
      if (this.waiting) {
        this.waiting = false;
        this.emit();
        return;
      }
      this.done = 0;
      this.todo = 0;
      this.emit(true);
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
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

  private scheduleSave(): void {
    if (this.saveTimer || this.stopped) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.save();
    }, 2000);
    this.saveTimer.unref?.();
  }

  private async save(): Promise<void> {
    this.dirty = false;
    try {
      await fsp.mkdir(this.o.dir, { recursive: true });
      // The vectors in path order, then the map that reads them (the map lands last, so a half-write reads as none).
      const order = [...this.kept].sort(([a], [b]) => (a < b ? -1 : 1));
      const rows: { path: string; hash: string; vecs: number[][] }[] = [];
      for (let i = 0; i < order.length; i++) {
        // Thousands of vectors copied and written: yield as it goes, so a save never holds a frame (9 Nov 2026).
        if (i % 100 === 99) await tick();
        const [p, k] = order[i];
        const vec = this.o.index.vectors(p);
        if (!vec || vec.length !== EMBED_DIM) continue;
        rows.push({ path: p, hash: k.hash, vecs: [[...vec], ...this.o.index.piecesOf(p).map((x) => [...x])] });
      }
      const total = rows.reduce((n, r) => n + r.vecs.length, 0);
      const buf = Buffer.alloc(total * EMBED_DIM * 4);
      let at = 0;
      for (let i = 0; i < rows.length; i++) {
        if (i % 100 === 99) await tick();
        for (const vec of rows[i].vecs) {
          for (const x of vec) {
            buf.writeFloatLE(x, at);
            at += 4;
          }
        }
      }
      const vecTarget = this.vecFile();
      await fsp.writeFile(`${vecTarget}.part`, buf.subarray(0, at));
      await fsp.rename(`${vecTarget}.part`, vecTarget);
      const kept = rows.map((r) => ({ path: r.path, hash: r.hash, chunks: r.vecs.length }));
      const mapTarget = this.mapFile();
      await fsp.writeFile(`${mapTarget}.part`, JSON.stringify({ v: STORE_VERSION, dim: EMBED_DIM, order: kept }));
      await fsp.rename(`${mapTarget}.part`, mapTarget);
      for (const r of rows) this.kept.set(r.path, { hash: r.hash, chunks: r.vecs.length });
    } catch (err) {
      this.o.log?.(`Ironleaf could not keep the meaning index: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async load(): Promise<void> {
    try {
      const map = JSON.parse(await fsp.readFile(this.mapFile(), 'utf8')) as StoredMap;
      if (map.v !== STORE_VERSION || map.dim !== EMBED_DIM || !Array.isArray(map.order)) return;
      const buf = await fsp.readFile(this.vecFile());
      const total = map.order.reduce((n, e) => n + (Number.isInteger(e?.chunks) && (e.chunks as number) > 0 ? (e.chunks as number) : 1), 0);
      if (buf.length !== total * EMBED_DIM * 4) return;
      const readVec = (): number[] => {
        const vec = new Array<number>(EMBED_DIM);
        for (let j = 0; j < EMBED_DIM; j++) {
          vec[j] = buf.readFloatLE(at);
          at += 4;
        }
        return vec;
      };
      let at = 0;
      for (let i = 0; i < map.order.length; i++) {
        if (i % 32 === 31) await tick();
        const entry = map.order[i];
        const chunks = Number.isInteger(entry?.chunks) && (entry.chunks as number) > 0 ? (entry.chunks as number) : 1;
        const vecs: number[][] = [];
        for (let c = 0; c < chunks; c++) vecs.push(readVec());
        if (!entry || typeof entry.path !== 'string' || typeof entry.hash !== 'string' || !this.wanted(entry.path)) continue;
        const text = this.o.read(entry.path);
        if (!text || meaningHash(text.title, text.content) !== entry.hash) continue;
        this.o.index.setVector(entry.path, vecs[0], vecs.slice(1));
        this.kept.set(entry.path, { hash: entry.hash, chunks: vecs.length });
      }
      this.embedded = this.kept.size;
    } catch {
      // Nothing kept yet (or it couldn't be read): worked out from the start.
    }
  }
}
