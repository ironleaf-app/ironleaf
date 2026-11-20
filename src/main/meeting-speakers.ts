// The speakers' main side (6 Nov 2026): the engine behind the transcript's numbered voices, behind doors the window
// calls. Live, each voiced piece-side is heard (its voiceprint) and joins the meeting's voices so far — rough on
// purpose. At the end one final pass over the kept speech settles them, carrying names set during the meeting on the
// right voices (differently-named voices never merge). An earlier meeting is re-run from its kept recording in the
// same way. Everything fails soft: when the models or the runner are missing, or the worker runs out of memory, the
// doors answer plainly and every transcript stays as it is today (You, Others).
//
// Free, on the person's own PC: the models ship in the app and run on WebAssembly in a worker of their own (their
// file built by tools/build-speaker-worker.mjs; the same engine in-process with yields when it is missing). Nothing
// is metered or uploaded, and nothing about a voice is kept: voiceprints live in the worker's memory while a meeting
// diarises, turns are all that come back, and a re-run's sound is deleted after.
//
// No Electron import here (it is handed in), so the node tests run this file as it is.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fromPcm16, fromPcm16Stereo, JOB_ID, PIECE_RATE } from '../shared/recorder';
import { CLUSTER_THRESHOLD, expectedOthers, LiveVoices, MAX_SPEAKERS, type SpeakerNames, type SpeakerSide, type SpeakerTurn } from '../shared/meeting-speakers';
import {
  findSpeakerModelDir,
  loadSpeakerOrt,
  LocalSpeakerRunner,
  ortSpeakerFactory,
  speakerModelDirs,
  SPEAKER_THREADS,
  voicedSpans,
  WorkerSpeakerRunner,
  type Diarized,
  type SpeakerRunner,
  type SpeakerWorkerHost,
} from './meeting-speaker-engine';

export interface SpeakerDoorStatus {
  /** The engine can hear voices now (its models are on this PC). */
  ready: boolean;
  /** Why not, in plain words. */
  words?: string;
}

export interface SpeakerDeps {
  handle(channel: string, fn: (...args: any[]) => unknown): void;
  /** Where recordings are kept while they record (the speech the final pass reads). */
  dataDir: string;
  /** The main folder (the models and the worker file sit beside the bundle, or with the app's resources). */
  mainDir: string;
  /** A runner stood in by the tests (no models, no worker). */
  runner?: () => SpeakerRunner;
  /** Where a load failure is said aloud (the app's log): the doors still answer plainly. */
  log?: (message: string) => void;
}

/** A recording's speech on disk, and a re-run's. */
function speechFiles(dataDir: string, id: string) {
  return { speech: path.join(dataDir, 'recordings', id, 'speech.pcm'), dir: path.join(dataDir, 'recordings', id) };
}

const idOf = (id: unknown) => {
  if (typeof id !== 'string' || !JOB_ID.test(id)) throw new Error('That recording isn’t known.');
  return id;
};

/** 16-bit mono speech (little-endian bytes) as sound, -1 … 1. */
function pcm16ToSound(pcm: Uint8Array): Float32Array {
  return fromPcm16(pcm);
}

export function registerSpeakerEngine(d: SpeakerDeps) {
  const live = new Map<string, { voices: LiveVoices; turns: SpeakerTurn[] }>();
  let runner: SpeakerRunner | null = null;
  let runnerFailed = '';

  const models = () => findSpeakerModelDir(speakerModelDirs(d.mainDir));
  /** The runner's own throw, said aloud once where it happens (6 Nov 2026, speakers-apart: it hid, and every
   *  transcript stayed You and Others) — the doors below still answer plainly. */
  const sayLoad = (err: unknown) => d.log?.(`speaker runner beside the bundle failed to load: ${err instanceof Error ? err.message : String(err)}`);

  /** The runner, stood up once: the worker when its file stands, else the same engine in-process with yields. */
  async function ready(): Promise<SpeakerRunner> {
    if (runner) return runner;
    if (runnerFailed) throw new Error(runnerFailed);
    try {
      if (d.runner) {
        runner = d.runner();
        return runner;
      }
      const dir = models();
      if (!dir) throw new Error('The speaker models aren’t on this PC.');
      const workerFile = path.join(d.mainDir, 'speaker-worker.cjs');
      const hasWorker = await fsp.stat(workerFile).then((s) => s.isFile(), () => false);
      if (hasWorker) {
        const w = new Worker(workerFile);
        const host: SpeakerWorkerHost = {
          post: (message) => w.postMessage(message),
          onMessage: (fn) => {
            w.on('message', fn);
          },
          end: async () => {
            await w.terminate();
          },
        };
        w.on('error', () => undefined);
        runner = new WorkerSpeakerRunner(host, dir, SPEAKER_THREADS);
        // The worker proves itself before it is kept (its first answer starts the models).
        await (runner as WorkerSpeakerRunner).diarize(new Float32Array(0), { side: 'mix' }).catch((err: unknown) => d.log?.(`speaker worker not ready: ${err instanceof Error ? err.message : String(err)}`));
        return runner;
      }
      const loaded = loadSpeakerOrt(d.mainDir, sayLoad);
      if (!loaded) throw new Error('The speaker runner isn’t on this PC.');
      runner = new LocalSpeakerRunner(dir, ortSpeakerFactory(loaded.ort, loaded.wasmDir), loaded.ort.Tensor, SPEAKER_THREADS);
      return runner;
    } catch (err) {
      runnerFailed = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async function status(): Promise<SpeakerDoorStatus> {
    if (d.runner) return { ready: true };
    if (!models()) return { ready: false, words: 'The speaker models aren’t on this PC yet, so transcripts show You and Others as usual.' };
    if (!loadSpeakerOrt(d.mainDir, sayLoad)) return { ready: false, words: 'The speaker runner isn’t on this PC, so transcripts show You and Others as usual.' };
    return { ready: true };
  }

  /** One voiced piece-side heard, stretch by stretch between its pauses: the provisional voice of its longest
   *  stretch (0, 1, …) and every stretch's own voice and moment, or -1 when the engine can’t hear now. A whole
   *  piece heard as one print averages the people in it into nobody (6 Nov 2026, e1-speaker-turns), so a piece
   *  is never embedded whole. */
  async function hear(job: unknown, wav: unknown, side: unknown, start: unknown, seconds: unknown): Promise<{ voice: number; spans?: { voice: number; start: number; seconds: number }[] }> {
    const id = idOf(job);
    const bytes = wav instanceof Uint8Array && wav.byteLength > 44 ? wav.subarray(44) : null;
    const at = typeof start === 'number' && Number.isFinite(start) && start >= 0 ? start : 0;
    const len = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const which: SpeakerSide = side === 'mic' || side === 'pc' ? side : 'mix';
    if (!bytes || !len) return { voice: -1 };
    // Quiet pieces never start a voice (and never wake the worker): only heard sound joins the voices.
    let loud = 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength - (bytes.byteLength % 2));
    for (let i = 0; i < view.byteLength; i += 320) loud = Math.max(loud, Math.abs(view.getInt16(i, true)));
    if (loud < 300) return { voice: -1 };
    let entry = live.get(id);
    if (!entry) {
      entry = { voices: new LiveVoices(), turns: [] };
      live.set(id, entry);
    }
    try {
      const sound = pcm16ToSound(bytes);
      const stretches = voicedSpans(sound, PIECE_RATE);
      if (!stretches.length) return { voice: -1 };
      const r = await ready();
      const spans: { voice: number; start: number; seconds: number }[] = [];
      let voice = -1;
      let longest = 0;
      for (const s of stretches) {
        const v = entry.voices.note(await r.embed(sound.subarray(s.from, s.to)), which);
        const span = { voice: v, start: Math.round((at + s.from / PIECE_RATE) * 1000) / 1000, seconds: Math.round(((s.to - s.from) / PIECE_RATE) * 1000) / 1000 };
        spans.push(span);
        entry.turns.push({ id: `spk${v + 1}`, start: span.start, end: Math.round((span.start + span.seconds) * 1000) / 1000, side: which });
        if (span.seconds > longest) {
          longest = span.seconds;
          voice = v;
        }
      }
      return { voice, spans };
    } catch {
      return { voice: -1 };
    }
  }

  /** The live pass's turns (for the final pass to carry), and the live voices forgotten. */
  function endLive(job: unknown): { turns: SpeakerTurn[] } {
    const id = idOf(job);
    const entry = live.get(id);
    live.delete(id);
    return { turns: entry?.turns ?? [] };
  }

  /** One side's kept speech as sound (stereo's own channel, mono as it is). */
  async function sideSound(id: string, stereo: boolean, side: 'mic' | 'pc' | 'mix'): Promise<Float32Array> {
    const raw = new Uint8Array(await fsp.readFile(speechFiles(d.dataDir, id).speech).catch(() => new Uint8Array()));
    if (!raw.length) return new Float32Array(0);
    if (!stereo) return pcm16ToSound(raw.subarray(0, raw.length - (raw.length % 2)));
    const even = raw.subarray(0, raw.length - (raw.length % 4));
    const { mic, pc } = fromPcm16Stereo(even);
    if (side === 'mic') return mic;
    if (side === 'pc') return pc;
    const out = new Float32Array(mic.length);
    for (let i = 0; i < out.length; i++) out[i] = (mic[i] + pc[i]) / 2;
    return out;
  }

  /** The final pass over a recording's kept speech: the settled turns (each side needing voices, apart). */
  async function final(job: unknown, sources: unknown, stereo: unknown, liveTurns: unknown, names: unknown, meeting: unknown): Promise<{ turns: SpeakerTurn[] } | { error: string }> {
    const id = idOf(job);
    const src = sources === 'mic+pc' ? 'mic+pc' : 'mic';
    const isStereo = stereo === true;
    const turns = Array.isArray(liveTurns) ? (liveTurns as SpeakerTurn[]).filter((t) => t && typeof t === 'object') : [];
    const heard: SpeakerNames = {};
    if (names && typeof names === 'object' && !Array.isArray(names)) {
      for (const [k, v] of Object.entries(names as Record<string, unknown>)) {
        if (/^spk[1-9]\d*$/.test(k) && typeof v === 'string' && v.trim()) heard[k] = v.trim().slice(0, 80);
      }
    }
    // How many others the meeting expects on the call (the invite, else a 1-2-1 title): the far side's grouping
    // keeps that many voices at most, so one person is never split into Speaker 2, 3 and 4 (12 Nov 2026). Past the
    // count the likest groups join (the clustering's cap, likest first: the meeting's count says an extra group is
    // a split, not another person). A room keeps every voice it hears: the recorder is numbered with everyone else,
    // so the invite count doesn't bound them.
    const m = meeting && typeof meeting === 'object' ? (meeting as Record<string, unknown>) : null;
    const want = expectedOthers({
      title: typeof m?.title === 'string' ? m.title : '',
      attendees: Array.isArray(m?.attendees) ? (m.attendees as unknown[]).filter((a): a is string => typeof a === 'string') : [],
      me: typeof m?.me === 'string' ? m.me : '',
    });
    const cap = want === null ? MAX_SPEAKERS : Math.max(1, Math.min(MAX_SPEAKERS, want));
    try {
      const r = await ready();
      const out: SpeakerTurn[] = [];
      // A call's microphone stays "You": only the PC side is told apart. A room is one mixed stream. Windows every
      // 2 seconds (measured 6 Nov 2026: the same error rate as every second, twice as fast).
      const sides: ('pc' | 'mix')[] = src === 'mic+pc' ? ['pc'] : ['mix'];
      for (const side of sides) {
        const sound = isStereo && side === 'pc' ? await sideSound(id, true, 'pc') : isStereo ? await sideSound(id, true, 'mix') : await sideSound(id, false, 'mix');
        if (sound.length < PIECE_RATE) continue;
        const done: Diarized = await r.diarize(sound, { side: src === 'mic+pc' ? 'pc' : 'mix', shift: 32000, live: { turns, names: heard }, ...(side === 'pc' ? { cap } : {}) });
        out.push(...done.turns);
      }
      return { turns: out.sort((a, b) => a.start - b.start) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'The speakers couldn’t be told apart.' };
    }
  }

  /** A re-run's sound, in pieces (an earlier meeting's kept recording, decoded in the window). */
  async function rerunBegin(job: unknown): Promise<void> {
    const id = idOf(job);
    await fsp.mkdir(speechFiles(d.dataDir, `rerun-${id}`.slice(0, 64)).dir, { recursive: true });
  }

  async function rerunAppend(job: unknown, bytes: unknown): Promise<void> {
    const id = idOf(job);
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) return;
    await fsp.appendFile(speechFiles(d.dataDir, `rerun-${id}`.slice(0, 64)).speech, bytes);
  }

  /** A re-run diarised as one mixed stream; its sound deleted after (nothing about a voice is kept). */
  async function rerunEnd(job: unknown): Promise<{ turns: SpeakerTurn[] } | { error: string }> {
    const id = idOf(job);
    const key = `rerun-${id}`.slice(0, 64);
    try {
      const raw = new Uint8Array(await fsp.readFile(speechFiles(d.dataDir, key).speech).catch(() => new Uint8Array()));
      if (!raw.length) return { error: 'There was no sound to listen to.' };
      const sound = pcm16ToSound(raw.subarray(0, raw.length - (raw.length % 2)));
      const done = await (await ready()).diarize(sound, { side: 'mix', shift: 32000 });
      return { turns: done.turns };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'The speakers couldn’t be told apart.' };
    } finally {
      await fsp.rm(speechFiles(d.dataDir, key).dir, { recursive: true, force: true });
    }
  }

  d.handle('speakers:status', () => status());
  d.handle('speakers:live-begin', (job: unknown, expected: unknown) => {
    const id = idOf(job);
    // The meeting's expected others bound the live voices too (a 1-2-1 never shows Speaker 2, let alone 4).
    const cap = typeof expected === 'number' && Number.isFinite(expected) && expected >= 1 ? Math.min(MAX_SPEAKERS, Math.floor(expected)) : MAX_SPEAKERS;
    if (!live.has(id)) live.set(id, { voices: new LiveVoices(CLUSTER_THRESHOLD, cap), turns: [] });
  });
  d.handle('speakers:live', (job: unknown, wav: unknown, side: unknown, start: unknown, seconds: unknown) => hear(job, wav, side, start, seconds));
  d.handle('speakers:live-end', (job: unknown) => endLive(job));
  d.handle('speakers:final', (job: unknown, sources: unknown, stereo: unknown, liveTurns: unknown, names: unknown, meeting: unknown) => final(job, sources, stereo, liveTurns, names, meeting));
  d.handle('speakers:rerun-begin', (job: unknown) => rerunBegin(job));
  d.handle('speakers:rerun-append', (job: unknown, bytes: unknown) => rerunAppend(job, bytes));
  d.handle('speakers:rerun-end', (job: unknown) => rerunEnd(job));
  return { status, hear, endLive, final, rerunBegin, rerunAppend, rerunEnd };
}
