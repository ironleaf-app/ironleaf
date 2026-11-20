// The meaning worker's main side (9 Nov 2026, off the main thread: the window stuttered while the vault
// indexed, because every embedding batch blocked the thread that routes clicks and frames). One worker holds both
// models once (src/main/meaning-worker.ts); the main process only sends text and receives vectors. Indexing sends one
// piece at a time (src/main/meaning-build.ts); a search's texts and scores jump ahead in the worker, so nothing asked
// waits long. When the worker file is missing the same models run in-process as before (src/main/app.ts falls back);
// when a model is missing the worker says so with the same plain words, and the hashed fallback answers.
//
// No Electron import here (it is handed in), so the node tests run this file as it is.

import type { MeaningEmbedderLike } from './meaning-embed';
import type { MeaningRerankerLike } from './meaning-rerank';

export interface MeaningWorkerHost {
  post(message: unknown): void;
  onMessage(fn: (message: { id: number; ok: boolean; value?: unknown; error?: string }) => void): void;
  end(): Promise<void>;
}

export interface WorkerMeaningStart {
  embed: { ok: true } | { ok: false; words: string };
  rerank: boolean;
  threads: number;
}

/** Both models across the thread (the worker file built by tools/build-meaning-worker.mjs). */
export class WorkerMeaningRunner implements MeaningEmbedderLike, MeaningRerankerLike {
  private next = 1;
  private readonly waiting = new Map<number, { ok: (v: never) => void; fail: (e: Error) => void }>();
  private started: Promise<WorkerMeaningStart> | null = null;
  private embedReady = false;
  private rerankReady = false;
  private closed = false;
  /** Threads the worker's session uses (1 when threads proved unsafe). */
  threadsUsed = 1;

  constructor(
    private readonly host: MeaningWorkerHost,
    private readonly dirs: { embedDir: string | null; rerankDir: string | null; threads?: number },
  ) {
    host.onMessage((m) => {
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      if (m.ok) w.ok(m.value as never);
      else w.fail(new Error(typeof m.error === 'string' && m.error ? m.error : 'Meaning search stumbled just now.'));
    });
  }

  get ready(): boolean {
    return this.embedReady;
  }

  get rerankUp(): boolean {
    return this.rerankReady;
  }

  /** Both models started once in the worker (plain words when embedding cannot load; rerank false stays silent). */
  start(): Promise<WorkerMeaningStart> {
    if (!this.started) {
      const id = this.next++;
      this.started = new Promise<WorkerMeaningStart>((ok, fail) => {
        this.waiting.set(id, { ok: ok as (v: never) => void, fail });
        this.host.post({ id, type: 'start', embedDir: this.dirs.embedDir, rerankDir: this.dirs.rerankDir, ...(this.dirs.threads ? { threads: this.dirs.threads } : {}) });
      }).then((r) => {
        this.embedReady = r.embed.ok;
        this.rerankReady = r.rerank;
        this.threadsUsed = r.threads || 1;
        return r;
      });
    }
    return this.started;
  }

  private ask<T>(type: string, extra: Record<string, unknown>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('the meaning model is not started'));
    return this.start().then(
      () =>
        new Promise<T>((ok, fail) => {
          const id = this.next++;
          this.waiting.set(id, { ok: ok as (v: never) => void, fail });
          this.host.post({ id, type, ...extra });
        }),
    );
  }

  /** An indexing batch (low priority in the worker; one piece at a time from the builder). */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.embedReady && !(await this.start().catch(() => null))?.embed.ok) throw new Error('the meaning model is not started');
    return this.ask<number[][]>('embed', { texts });
  }

  /** A search's texts (high priority: answered between indexing's pieces). */
  async embedQuery(texts: string[]): Promise<number[][]> {
    if (!this.embedReady && !(await this.start().catch(() => null))?.embed.ok) throw new Error('the meaning model is not started');
    return this.ask<number[][]>('embedQuery', { texts });
  }

  /** A search's relevance scores (high priority; null when the model is not for this search, never a throw). */
  async score(query: string, texts: readonly string[]): Promise<number[] | null> {
    const up = await this.start().catch(() => null);
    if (!up?.rerank) return null;
    try {
      const r = await this.ask<number[] | null>('score', { query, texts: [...texts] });
      return Array.isArray(r) ? r : null;
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const [, w] of this.waiting) w.fail(new Error('The meaning worker closed.'));
    this.waiting.clear();
    await this.host.end().catch(() => undefined);
  }
}
