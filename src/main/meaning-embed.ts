// Real meaning vectors, worked out on this PC (10.0 Wave 2, 2 Nov 2026, still on this PC only). The quantized
// sentence model runs in the main process on WebAssembly: no native code, nothing downloaded at run time (the
// runner's files ship with the app, src/main/meaning-embed.ts finds them), nothing sent anywhere. Mean pooling, then
// L2 normalise, as the model was taught. When the model cannot load, starting fails with plain words and the caller
// keeps the term-expansion fallback (src/shared/meaning.ts) — the app never waits on it.

import { createRequire } from 'node:module';
import { cpus } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { EMBED_DIM } from '../shared/meaning';
import { encodeText, loadTokenizer, type MeaningTokenizer } from './meaning-tokenizer';

/** The model file inside a model folder, and the tokenizer beside it. */
export const MODEL_FILE = path.join('onnx', 'model_quantized.onnx');
export const TOKENIZER_FILE = 'tokenizer.json';
/** The runner file shipped beside the embedded app (tools/ort-ship.mjs names the whole set; CommonJS under any
 *  scope — 6 Nov 2026, speakers-apart: the installed app reads as a module, and require() of the .js threw there). */
export const ORT_NODE_FILE = 'ort.node.min.cjs';

/** The little of onnxruntime-web the embedder touches (its own module is loaded lazily, never bundled). */
export interface OrtModule {
  env: { wasm: { numThreads: number; simd: boolean; wasmPaths: string; proxy?: boolean } };
  Tensor: new (type: string, data: BigInt64Array, dims: number[]) => unknown;
  InferenceSession: { create(modelPath: string, opts: { executionProviders: string[] }): Promise<OrtSession> };
}

export interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number>; dims: readonly number[] }>>;
  release(): Promise<unknown> | unknown;
}

/** One model session: last_hidden_state ([seq, dim] flattened) for exact-length ids. */
export interface EmbedSession {
  run(ids: number[]): Promise<{ data: ArrayLike<number>; dim: number }>;
  close(): Promise<void>;
}

export type EmbedSessionFactory = (modelPath: string, threads: number) => Promise<EmbedSession>;

/** A factory over a loaded onnxruntime-web whose files sit in `wasmDir` (nothing is fetched from anywhere else). */
export function ortSessionFactory(ort: OrtModule, wasmDir: string): EmbedSessionFactory {
  return async (modelPath: string, threads: number): Promise<EmbedSession> => {
    // A file URL, on every platform (6 Nov 2026, speakers-apart: the runner imports its WASM glue, and on Windows
    // a bare path fails — "Received protocol 'c:'" — so no session ever started there).
    ort.env.wasm.wasmPaths = pathToFileURL(`${wasmDir}${path.sep}`).href;
    ort.env.wasm.simd = true;
    ort.env.wasm.numThreads = Math.max(1, threads);
    if ('proxy' in ort.env.wasm) ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
    return {
      run: async (ids: number[]) => {
        const n = ids.length;
        const feeds: Record<string, unknown> = {
          input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, n]),
          attention_mask: new ort.Tensor('int64', BigInt64Array.from({ length: n }, () => 1n), [1, n]),
          token_type_ids: new ort.Tensor('int64', BigInt64Array.from({ length: n }, () => 0n), [1, n]),
        };
        const out = await session.run(feeds);
        const first = out[Object.keys(out)[0]];
        const dims = first.dims;
        const dim = dims[dims.length - 1];
        return { data: first.data, dim };
      },
      close: async () => {
        await session.release();
      },
    };
  };
}

const nodeRequire: NodeRequire | null = typeof require === 'function' ? require : null;

/**
 * The runner, loaded lazily (never bundled: tools/build-embedded.mjs ships it beside the bundle instead, and the
 * standalone app resolves its installed copy). Null when it is nowhere: the caller falls back, quietly. A throw from
 * the copy beside the bundle is said aloud through `report` (6 Nov 2026, speakers-apart: that throw hid there, and
 * every transcript stayed You and Others) before the installed copy below may still answer.
 */
export function loadOrtModule(mainDir: string, report?: (error: unknown) => void): { ort: OrtModule; wasmDir: string } | null {
  const req = nodeRequire ?? createRequire(path.join(mainDir, 'meaning-embed.cjs'));
  const alongside = path.join(mainDir, 'meaning', 'ort', ORT_NODE_FILE);
  if (existsSync(alongside)) {
    try {
      return { ort: req(alongside) as OrtModule, wasmDir: path.dirname(alongside) };
    } catch (err) {
      report?.(err);
    }
  }
  try {
    const ort = req('onnxruntime-web') as OrtModule;
    const entry = req.resolve('onnxruntime-web');
    return { ort, wasmDir: path.dirname(entry) };
  } catch {
    return null;
  }
}

/** Where the model folder is looked for: beside the embedded bundle, then with the app's own resources. */
export function defaultModelDirs(mainDir: string): string[] {
  return [path.join(mainDir, 'meaning', 'model'), path.join(path.resolve(mainDir, '..', '..'), 'resources', 'models', 'all-MiniLM-L6-v2')];
}

/** The first folder holding a model file and its tokenizer, else null. */
export function findModelDir(dirs: string[]): string | null {
  for (const dir of dirs) {
    if (existsSync(path.join(dir, MODEL_FILE)) && existsSync(path.join(dir, TOKENIZER_FILE))) return dir;
  }
  return null;
}

export interface EmbedderOptions {
  modelDir: string;
  factory: EmbedSessionFactory;
  /** Loaded from the model folder when absent. */
  tokenizer?: MeaningTokenizer;
  /** Exact threads (default: up to 4 when safe, else 1). */
  threads?: number;
}

/** What the index builds against: the main-process model or its worker (9 Nov 2026, off the main thread, so the
 *  app never stutters while indexing; the worker answers embedQuery first, between indexing's single pieces). */
export interface MeaningEmbedderLike {
  readonly ready: boolean;
  threadsUsed: number;
  embed(texts: string[]): Promise<number[][]>;
  /** A search's texts (high priority in the worker; absent in-process, where embed answers). */
  embedQuery?(texts: string[]): Promise<number[][]>;
  close(): Promise<void>;
}

/** The on-device meaning model, started once: texts in, 384-wide unit vectors out. */
export class MeaningEmbedder implements MeaningEmbedderLike {
  private session: EmbedSession | null = null;
  private tok: MeaningTokenizer | null = null;
  /** Threads the running session uses (1 when threads proved unsafe). */
  threadsUsed = 1;

  constructor(private readonly o: EmbedderOptions) {}

  get ready(): boolean {
    return this.session !== null && this.tok !== null;
  }

  /** Starts the model: threads are tried, then switched off when they fail; plain words when it cannot load. */
  async start(): Promise<{ ok: true } | { ok: false; words: string }> {
    if (!existsSync(path.join(this.o.modelDir, MODEL_FILE))) return { ok: false, words: 'the meaning model file is missing' };
    try {
      this.tok = this.o.tokenizer ?? loadTokenizer(this.o.modelDir);
    } catch (err) {
      return { ok: false, words: err instanceof Error ? err.message : 'the meaning model’s words file is damaged' };
    }
    let count = 1;
    try {
      count = Math.max(1, cpus().length || 1);
    } catch {
      count = 1;
    }
    const tries = this.o.threads ? [Math.max(1, this.o.threads)] : [...new Set([Math.min(4, count), 1])];
    const modelPath = path.join(this.o.modelDir, MODEL_FILE);
    let dim = 0;
    for (const threads of tries) {
      try {
        const session = await this.o.factory(modelPath, threads);
        // A real run before trusting it: threads that cannot start fail here, not on the first note.
        const probe = await session.run([101, 102]);
        if (probe.dim !== EMBED_DIM) {
          await session.close().catch(() => {});
          return { ok: false, words: 'the meaning model is not the one expected' };
        }
        this.session = session;
        this.threadsUsed = threads;
        dim = probe.dim;
        break;
      } catch {
        // Threads unsafe (or the file unreadable): the next try runs single-threaded.
      }
    }
    if (!this.session || !dim) return { ok: false, words: 'the meaning model would not start on this PC' };
    return { ok: true };
  }

  /** Each text's meaning vector (mean pooling, L2 normalised): unit vectors, EMBED_DIM wide. */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.session || !this.tok) throw new Error('the meaning model is not started');
    const out: number[][] = [];
    for (const text of texts) {
      const ids = encodeText(this.tok, text);
      const { data, dim } = await this.session.run(ids);
      const seq = ids.length;
      const vec = new Array<number>(dim).fill(0);
      for (let i = 0; i < seq; i++) for (let j = 0; j < dim; j++) vec[j] += Number(data[i * dim + j]);
      for (let j = 0; j < dim; j++) vec[j] /= seq;
      let sum = 0;
      for (const x of vec) sum += x * x;
      const norm = Math.sqrt(sum) || 1;
      for (let j = 0; j < dim; j++) vec[j] /= norm;
      out.push(vec);
    }
    return out;
  }

  async close(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session) await session.close().catch(() => {});
  }
}
