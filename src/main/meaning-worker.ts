// The meaning models' own thread (9 Nov 2026). Embedding and reranking ran on Electron's main thread (every mouse
// click, key and window frame waits there), so while Vault indexed the app stuttered. They run here now, beside the
// app like the speaker engine (src/main/meeting-speaker-worker.ts): the main process only sends text and receives
// vectors. The models load once here (the same files, the same runner, the same classes as the main process used, so
// the vectors are byte-identical); a person's search asked while indexing goes first (its texts jump the queue
// between indexing's single-piece batches). Protocol, each way with an id: { type: 'start', embedDir, rerankDir,
// threads } → { embed, rerank, threads }; { type: 'embed', texts } (indexing, low) and { type: 'embedQuery', texts }
// (a search, high) → number[][]; { type: 'score', query, texts } (high) → number[] | null. Answers { id, ok, value?,
// error? }. No Electron import here (only Node's own modules once bundled).

import { parentPort, workerData } from 'node:worker_threads';
import { loadOrtModule, MeaningEmbedder, ortSessionFactory } from './meaning-embed';
import { MeaningReranker, ortPairSessionFactory } from './meaning-rerank';

if (!parentPort) throw new Error('The meaning worker runs on its own thread.');

const port = parentPort;
let embedder: MeaningEmbedder | null = null;
let reranker: MeaningReranker | null = null;
let embedDone = false;
let started = false;

interface Asked {
  id: number;
  type: string;
  embedDir?: string | null;
  rerankDir?: string | null;
  threads?: number;
  texts?: string[];
  query?: string;
}

/** Waiting work, in arrival order: a search (embedQuery, score) jumps ahead of indexing (embed) below. */
const queue: Asked[] = [];
let pumping = false;

async function handleStart(m: Asked): Promise<{ embed: { ok: true } | { ok: false; words: string }; rerank: boolean; threads: number }> {
  const embedDir = typeof m.embedDir === 'string' && m.embedDir ? m.embedDir : null;
  const rerankDir = typeof m.rerankDir === 'string' && m.rerankDir ? m.rerankDir : null;
  const threads = typeof m.threads === 'number' && Number.isFinite(m.threads) ? Math.max(1, Math.floor(m.threads)) : undefined;
  // The runner beside the bundle (or the installed copy), loaded lazily like the embedder's. The worker file sits
  // beside the bundle, so its own folder is the main folder (overridable through workerData in tests).
  const here = typeof (workerData as { mainDir?: unknown })?.mainDir === 'string' ? (workerData as { mainDir: string }).mainDir : __dirname;
  const loaded = loadOrtModule(here);
  let embed: { ok: true } | { ok: false; words: string } = embedDir
    ? { ok: false, words: 'the meaning runner is missing from this install' }
    : { ok: false, words: 'the meaning model is missing from this install' };
  let rerank = false;
  let used = 1;
  if (loaded && embedDir) {
    const e = new MeaningEmbedder({ modelDir: embedDir, factory: ortSessionFactory(loaded.ort, loaded.wasmDir), ...(threads ? { threads } : {}) });
    const r = await e.start();
    if (r.ok) {
      embedder = e;
      used = e.threadsUsed;
      embed = { ok: true };
    } else {
      await e.close().catch(() => {});
      embed = r;
    }
  }
  if (loaded && rerankDir) {
    const q = new MeaningReranker({ modelDir: rerankDir, factory: ortPairSessionFactory(loaded.ort, loaded.wasmDir), ...(threads ? { threads } : {}) });
    if (await q.start()) {
      reranker = q;
      rerank = true;
      if (!embedder) used = q.threadsUsed;
    } else {
      await q.close().catch(() => {});
    }
  }
  embedDone = embed.ok;
  started = true;
  return { embed, rerank, threads: used };
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      // A search first: the first high-priority message, else the oldest indexing batch. Indexing sends one piece
      // at a time (src/main/meaning-build.ts), so a search waits at most one piece.
      const hi = queue.findIndex((m) => m.type !== 'embed');
      const m = (hi >= 0 ? queue.splice(hi, 1)[0] : queue.shift()) as Asked;
      try {
        if (m.type === 'embed' || m.type === 'embedQuery') {
          if (!embedder || !embedDone) throw new Error('the meaning model is not started');
          const texts = Array.isArray(m.texts) ? m.texts : [];
          port.postMessage({ id: m.id, ok: true, value: await embedder.embed(texts) });
        } else if (m.type === 'score') {
          // Like the main-process scorer: null when the model is not for this search, never a throw.
          const texts = Array.isArray(m.texts) ? m.texts : [];
          const query = typeof m.query === 'string' ? m.query : '';
          port.postMessage({ id: m.id, ok: true, value: reranker ? await reranker.score(query, texts) : null });
        } else {
          throw new Error('That isn’t meaning work.');
        }
      } catch (err) {
        port.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    pumping = false;
  }
}

port.on('message', (m: Asked) => {
  void (async () => {
    try {
      if (m.type === 'start') {
        port.postMessage({ id: m.id, ok: true, value: await handleStart(m) });
        void pump();
      } else {
        queue.push(m);
        if (started) void pump();
      }
    } catch (err) {
      port.postMessage({ id: (m as Asked)?.id ?? 0, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
});
