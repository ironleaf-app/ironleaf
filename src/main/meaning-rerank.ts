// The on-device reranker (10.0 m10rerank, 2 Nov 2026: agreed, "the other 2 use"): the top results of a search (at
// most 30) re-scored by real relevance to the question. The question and one result go through the cross-encoder as
// one pair (ms-marco-MiniLM-L-6-v2, quantized ONNX, Apache-2.0, beside the meaning model), its logit read through a
// sigmoid, then mixed with the existing rank so exact title matches stay first. It runs on the same WASM runner the
// meaning model uses (src/main/meaning-embed.ts loads it; there is no second loader), starts lazily on the first
// search that can use it, and any failure reads as null: the caller keeps today's order, exactly. Private notes never
// reach it: Vault search only scores its own hits (which never hold private notes) and refuses the whole rerank if
// one ever appeared; the former host app seam scores caller-given texts, never vault paths.

import { cpus } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { foldDiacritics } from '../shared/markdown';
import { RERANK_MAX } from '../shared/meaning';
import { MODEL_FILE, type OrtModule, type OrtSession } from './meaning-embed';
import { encodePair, loadTokenizer, type MeaningTokenizer } from './meaning-tokenizer';

/** The rerank model folder in resources/models (tools/ort-ship.mjs RERANK_MODEL_DIR names the same folder). */
export const RERANK_FOLDER = 'ms-marco-MiniLM-L-6-v2';

/** Pairs through the model: each pair's logit (the cross-encoder's single output). One pair probes a new session;
 *  a search scores its pairs in one batched run (padded, masked), so 30 results stay well under 300 ms. The model
 *  is quantized, so a batch's own mix wiggles near-ties by ~0.1 logit (measured): only the order within one search
 *  is read, never absolute scores across searches. */
export interface RerankSession {
  run(ids: number[], typeIds: number[]): Promise<number>;
  runBatch(pairs: { ids: number[]; typeIds: number[] }[]): Promise<number[]>;
  close(): Promise<void>;
}

export type RerankSessionFactory = (modelPath: string, threads: number) => Promise<RerankSession>;

/**
 * A factory over the loaded onnxruntime-web (the same module the embedder uses, never a second copy of it). The
 * runner's thread pool is fixed process-wide by the first session in it (measured): the embedder and the reranker
 * share one default thread count, so whichever starts first, both agree.
 */
export function ortPairSessionFactory(ort: OrtModule, wasmDir: string): RerankSessionFactory {
  return async (modelPath: string, threads: number): Promise<RerankSession> => {
    // A file URL, on every platform (6 Nov 2026, speakers-apart: the runner imports its WASM glue, and on Windows
    // a bare path fails — "Received protocol 'c:'" — so no session ever started there).
    ort.env.wasm.wasmPaths = pathToFileURL(`${wasmDir}${path.sep}`).href;
    ort.env.wasm.simd = true;
    ort.env.wasm.numThreads = Math.max(1, threads);
    if ('proxy' in ort.env.wasm) ort.env.wasm.proxy = false;
    const session: OrtSession = await ort.InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
    const single = async (ids: number[], typeIds: number[]): Promise<number> => {
      if (ids.length !== typeIds.length || !ids.length) throw new Error('a rerank pair needs matching ids');
      const n = ids.length;
      const feeds: Record<string, unknown> = {
        input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, n]),
        attention_mask: new ort.Tensor('int64', BigInt64Array.from({ length: n }, () => 1n), [1, n]),
        token_type_ids: new ort.Tensor('int64', BigInt64Array.from(typeIds.map(BigInt)), [1, n]),
      };
      const out = await session.run(feeds);
      const first = out[Object.keys(out)[0]];
      if (!first || first.data.length !== 1) throw new Error('the rerank model did not answer with one score');
      return Number(first.data[0]);
    };
    return {
      run: single,
      runBatch: async (pairs: { ids: number[]; typeIds: number[] }[]) => {
        if (!pairs.length) return [];
        for (const p of pairs) if (p.ids.length !== p.typeIds.length || !p.ids.length) throw new Error('a rerank pair needs matching ids');
        const rows = pairs.length;
        const cols = Math.max(...pairs.map((p) => p.ids.length));
        const inputIds = new BigInt64Array(rows * cols);
        const mask = new BigInt64Array(rows * cols);
        const types = new BigInt64Array(rows * cols);
        pairs.forEach((p, r) => {
          for (let c = 0; c < p.ids.length; c++) {
            inputIds[r * cols + c] = BigInt(p.ids[c]);
            mask[r * cols + c] = 1n;
            types[r * cols + c] = BigInt(p.typeIds[c]);
          }
        });
        const out = await session.run({
          input_ids: new ort.Tensor('int64', inputIds, [rows, cols]),
          attention_mask: new ort.Tensor('int64', mask, [rows, cols]),
          token_type_ids: new ort.Tensor('int64', types, [rows, cols]),
        });
        const first = out[Object.keys(out)[0]];
        if (!first || first.data.length !== rows) throw new Error('the rerank model did not answer with one score per pair');
        return Array.from({ length: rows }, (_, r) => Number(first.data[r]));
      },
      close: async () => {
        await session.release();
      },
    };
  };
}

/** Where the rerank model folder is looked for: beside the embedded bundle, then with the app's own resources. */
export function defaultRerankModelDirs(mainDir: string): string[] {
  return [path.join(mainDir, 'meaning', 'rerank-model'), path.join(path.resolve(mainDir, '..', '..'), 'resources', 'models', RERANK_FOLDER)];
}

/** A logit as a 0..1 relevance score. */
export function sigmoid(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-x));
}

/** Titles and queries compared as a person reads them: accents off, case off, spacing as one. */
export function rerankNorm(text: string): string {
  return foldDiacritics(String(text ?? '')).toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** Whether a result's title is exactly what was asked (it stays first, whatever it scores). */
export function isExactTitle(query: string, title: string): boolean {
  const q = rerankNorm(query);
  return q.length > 0 && rerankNorm(title) === q;
}

/**
 * The scored order: the score mixed with the existing rank so exact title matches stay first — exact titles keep
 * their original order at the top, the rest go by score, ties keeping today's order. (A blended weight would bury
 * the score: paraphrase sigmoids sit near 0.003 against unrelated near 0, so any rank share dwarfs the gap that
 * lifts the best answer.) Unscored (null) results sink below the scored, keeping their own order. Pure: the same
 * behaviour from every door (Vault search and the former host app seam share it).
 */
export function applyRerank<T>(query: string, items: readonly T[], titleOf: (item: T) => string, scores: readonly (number | null)[]): T[] {
  const exact: { item: T; at: number }[] = [];
  const rest: { item: T; at: number; score: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (isExactTitle(query, titleOf(item))) {
      exact.push({ item, at: i });
      continue;
    }
    const s = scores[i];
    rest.push({ item, at: i, score: typeof s === 'number' && Number.isFinite(s) ? s : -1 });
  }
  exact.sort((a, b) => a.at - b.at);
  rest.sort((a, b) => b.score - a.score || a.at - b.at);
  return [...exact.map((e) => e.item), ...rest.map((e) => e.item)];
}

export interface RerankerOptions {
  modelDir: string;
  factory: RerankSessionFactory;
  /** Loaded from the model folder when absent. */
  tokenizer?: MeaningTokenizer;
  /** Exact threads (default: up to 4 when safe, else 1). */
  threads?: number;
}

/** What search scores against: the main-process reranker or its worker (9 Nov 2026, off the main thread with the
 *  embeddings, so indexing never holds a search). */
export interface MeaningRerankerLike {
  readonly ready: boolean;
  score(query: string, texts: readonly string[]): Promise<number[] | null>;
  close(): Promise<void>;
}

/** The on-device cross-encoder, started lazily: questions in with result texts, 0..1 relevance scores out. */
export class MeaningReranker implements MeaningRerankerLike {
  private session: RerankSession | null = null;
  private tok: MeaningTokenizer | null = null;
  private starting: Promise<boolean> | null = null;
  private scoring = false;
  private failed = false;
  private closed = false;
  /** Threads the running session uses (1 when threads proved unsafe). */
  threadsUsed = 1;

  constructor(private readonly o: RerankerOptions) {}

  get ready(): boolean {
    return this.session !== null && this.tok !== null;
  }

  /** Starts the model: threads are tried, then switched off when they fail; false when it cannot load. */
  async start(): Promise<boolean> {
    if (this.ready) return true;
    if (this.failed || this.closed) return false;
    if (!existsSync(path.join(this.o.modelDir, MODEL_FILE))) {
      this.failed = true;
      return false;
    }
    try {
      this.tok = this.o.tokenizer ?? loadTokenizer(this.o.modelDir);
    } catch {
      this.failed = true;
      return false;
    }
    let count = 1;
    try {
      count = Math.max(1, cpus().length || 1);
    } catch {
      count = 1;
    }
    const tries = this.o.threads ? [Math.max(1, this.o.threads)] : [...new Set([Math.min(4, count), 1])];
    const modelPath = path.join(this.o.modelDir, MODEL_FILE);
    for (const threads of tries) {
      try {
        const session = await this.o.factory(modelPath, threads);
        // A real pair before trusting it: threads that cannot start fail here, not on the first search.
        const probe = await session.run([101, 102, 102], [0, 0, 1]);
        if (!Number.isFinite(probe)) {
          await session.close().catch(() => {});
          this.failed = true;
          return false;
        }
        this.session = session;
        this.threadsUsed = threads;
        return true;
      } catch {
        // Threads unsafe (or the file unreadable): the next try runs single-threaded.
      }
    }
    this.failed = true;
    return false;
  }

  private ensure(): Promise<boolean> {
    if (this.ready) return Promise.resolve(true);
    if (this.failed || this.closed) return Promise.resolve(false);
    return (this.starting ??= this.start().finally(() => {
      this.starting = null;
    }));
  }

  /**
   * Each result's relevance to the question (sigmoid of its pair logit), at most RERANK_MAX, in the same order —
   * one batched run for the whole search. Null when the model is not for this search: still starting, already
   * scoring another search (an abandoned keystroke's search never queues behind it), or it could not load. The
   * caller then keeps today's order.
   */
  async score(query: string, texts: readonly string[]): Promise<number[] | null> {
    const capped = texts.slice(0, RERANK_MAX);
    if (!capped.length || !String(query ?? '').trim()) return [];
    if (this.scoring || this.failed || this.closed) return null;
    this.scoring = true;
    try {
      if (!(await this.ensure())) return null;
      const session = this.session;
      const tok = this.tok;
      if (!session || !tok) return null;
      const pairs = capped.map((text) => encodePair(tok, query, text));
      const logits = await session.runBatch(pairs);
      if (logits.length !== pairs.length) return null;
      return logits.map(sigmoid);
    } catch {
      return null;
    } finally {
      this.scoring = false;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const session = this.session;
    this.session = null;
    if (session) await session.close().catch(() => {});
  }
}
