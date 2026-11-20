// The speaker engine's own thread (6 Nov 2026): live embeddings and the final pass run here, beside the app, so the
// recorder and the call are never disturbed. Only turns come back across (voiceprints never leave this memory).
// Built by tools/build-speaker-worker.mjs into out/main/speaker-worker.cjs (standalone) and beside main.cjs in the
// embed; when its file is missing the same engine runs in-process with yields (src/main/meeting-speakers.ts).
//
// Protocol, each way with an id: { type: 'start', modelDir, threads } → true; { type: 'embed', samples } → the
// voiceprint as numbers; { type: 'diarize', samples, opts } → { turns, voices }. Answers { id, ok, value?,
// error? }. No Electron import here (only Node's own modules once bundled).

import { parentPort, workerData } from 'node:worker_threads';
import { diarizeSide, loadSpeakerOrt, ortSpeakerFactory, SpeakerEngine } from './meeting-speaker-engine';

if (!parentPort) throw new Error('The speaker worker runs on its own thread.');

const port = parentPort;
let engine: SpeakerEngine | null = null;

interface Asked {
  id: number;
  type: string;
  modelDir?: string;
  threads?: number;
  samples?: ArrayLike<number>;
  opts?: Record<string, unknown>;
}

port.on('message', (m: Asked) => {
  void (async () => {
    try {
      if (m.type === 'start') {
        const dir = typeof m.modelDir === 'string' ? m.modelDir : '';
        if (!dir) throw new Error('The speaker models weren’t named.');
        // The runner beside the bundle (or the installed copy), loaded lazily like the embedder's. The worker file
        // sits beside the bundle, so its own folder is the main folder (overridable through workerData in tests).
        const here = typeof (workerData as { mainDir?: unknown })?.mainDir === 'string' ? (workerData as { mainDir: string }).mainDir : __dirname;
        const loaded = loadSpeakerOrt(here);
        if (!loaded) throw new Error('The speaker runner isn’t on this PC.');
        const e = new SpeakerEngine(dir, ortSpeakerFactory(loaded.ort, loaded.wasmDir), loaded.ort.Tensor, typeof m.threads === 'number' ? m.threads : 1);
        if (!(await e.start())) throw new Error('The speaker models couldn’t start.');
        engine = e;
        port.postMessage({ id: m.id, ok: true, value: true });
      } else if (m.type === 'embed') {
        if (!engine) throw new Error('The speaker models aren’t started.');
        const v = await engine.embed(Float32Array.from(m.samples ?? []));
        port.postMessage({ id: m.id, ok: true, value: Array.from(v) });
      } else if (m.type === 'diarize') {
        if (!engine) throw new Error('The speaker models aren’t started.');
        const o = (m.opts ?? {}) as { side?: 'mic' | 'pc' | 'mix'; forbid?: [number, number][]; threshold?: number; cap?: number; shift?: number; live?: { turns: { id: string; start: number; end: number; side: 'mic' | 'pc' | 'mix' }[]; names: Record<string, string> } };
        const r = await diarizeSide(engine, Float32Array.from(m.samples ?? []), {
          side: o.side ?? 'mix',
          ...(o.forbid ? { forbid: o.forbid } : {}),
          ...(o.live ? { live: o.live } : {}),
          ...(o.threshold !== undefined ? { threshold: o.threshold } : {}),
          ...(o.cap !== undefined ? { cap: o.cap } : {}),
          ...(o.shift !== undefined ? { shift: o.shift } : {}),
          onBatch: () => new Promise<void>((ok) => setImmediate(ok)),
        });
        port.postMessage({ id: m.id, ok: true, value: r });
      } else {
        throw new Error('That isn’t speaker work.');
      }
    } catch (err) {
      port.postMessage({ id: (m as Asked)?.id ?? 0, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
});
