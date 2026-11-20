// Telling the speakers apart, on this PC (6 Nov 2026). The engine behind src/shared/meeting-speakers.ts: a
// segmentation model finds who speaks when in each 10-second window, an embedding model hears what each voice sounds
// like, and the shared clustering joins the likeness into voices. Free, on the person's own PC: both models run on
// WebAssembly through onnxruntime-web (the same runner find-by-meaning already ships, tools/ort-ship.mjs), in a
// worker of their own with one thread, so the recorder and the call are never disturbed. Nothing is metered or
// uploaded, and nothing about a voice is kept: embeddings live in the worker's memory while a meeting diarises and
// are dropped after.
//
// Their code, not ours (4 Nov 2026). The pipeline is a port of sherpa-onnx's speaker-diarization-onnx.py (Apache-2.0,
// k2-fsa/sherpa-onnx, Copyright Xiaomi Corporation): its windowing, its powerset mapping, its relabelling and its
// global-mean features. The filterbank is a port of kaldi-native-fbank's framing, Povey window and mel banks
// (Apache-2.0, csukuangfj/kaldi-native-fbank, after Kaldi). The models are sherpa-onnx's released exports: the
// pyannote segmentation 3.0 (MIT, CNRS) and the 3D-Speaker CAM++ English voice model (Apache-2.0, Alibaba DAMO).
// Licence texts ship beside the models (resources/models/speaker/) and ride the notices (tools/vault-notices.mjs).
// Where the port differs from upstream it says so (the single-voice fix below). The models reach a person inside the
// app (resources/models/speaker/, ~31 MB: the segmentation int8 at 1.5 MB and the voice model at 29.6 MB). When they
// are missing the engine says so and every transcript stays as it is today. No Electron import here (it is handed
// in), so the node tests run the pure parts as they are. The ORT module is loaded lazily through the factory seam (as
// src/main/meaning-embed.ts), never imported, so the embed's bundle check stays clean and a missing runner falls back
// quietly.

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { clusterVoices, type SpeakerSide, type SpeakerTurn } from '../shared/meeting-speakers';

// ── The filterbank (a port of kaldi-native-fbank: framing, Povey window, mel banks, log floor) ───────────────────
// sherpa-onnx's voice models hear 80 filterbank frames (25 ms every 10 ms), utterance mean taken away (their
// "global-mean"). Every number below is their default (FeatureExtractorConfig + FbankOptions + MelBanksOptions).

/** What the voice model hears at: 16 kHz, like the speech kept on disk. */
export const FBANK_RATE = 16000;
/** 25 ms frames every 10 ms, 80 mel bins from 20 Hz to 7600 Hz. */
export const FBANK_SHIFT = 160;
export const FBANK_LENGTH = 400;
export const FBANK_BINS = 80;
export const FBANK_LOW = 20;
export const FBANK_HIGH = 7600;
export const FBANK_NFFT = 512;
const FBANK_PREEMPH = 0.97;
const FBANK_EPS = 1.1920928955078125e-7; // FLT_EPSILON: Kaldi's hard floor before the log.

/** Mel scale (Kaldi/HTK): 1127 ln(1 + f/700). */
const melScale = (freq: number): number => 1127 * Math.log(1 + freq / 700);

/** The Povey window (Hanning to 0.85: like Hamming but reaching zero at the edges). */
function poveyWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  const a = (2 * Math.PI) / (n - 1);
  for (let i = 0; i < n; i++) w[i] = Math.pow(0.5 - 0.5 * Math.cos(a * i), 0.85);
  return w;
}

/** A radix-2 FFT, in place over interleaved real/imaginary pairs (standard, ours). */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + len / 2] * cwr - im[i + j + len / 2] * cwi;
        const vi = re[i + j + len / 2] * cwi + im[i + j + len / 2] * cwr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}

interface MelBank { offset: number; weights: number[] }

/** The triangular mel banks (Kaldi's construction: each bin's triangle over the FFT bins it touches). */
function melBanks(): MelBank[] {
  const numFftBins = FBANK_NFFT / 2;
  const binWidth = FBANK_RATE / FBANK_NFFT;
  const melLow = melScale(FBANK_LOW);
  const melHigh = melScale(FBANK_HIGH);
  const delta = (melHigh - melLow) / (FBANK_BINS + 1);
  const banks: MelBank[] = [];
  for (let bin = 0; bin < FBANK_BINS; bin++) {
    const left = melLow + bin * delta;
    const center = melLow + (bin + 1) * delta;
    const right = melLow + (bin + 2) * delta;
    let first = -1;
    const weights: number[] = [];
    for (let i = 0; i < numFftBins; i++) {
      const mel = melScale(binWidth * i);
      if (mel > left && mel < right) {
        weights.push(mel <= center ? (mel - left) / (center - left) : (right - mel) / (right - center));
        if (first < 0) first = i;
      } else if (first >= 0) break;
    }
    if (first < 0) throw new Error('The voice model’s filterbank came out empty.');
    banks.push({ offset: first, weights });
  }
  return banks;
}

let keptBanks: MelBank[] | null = null;
let keptWindow: Float64Array | null = null;

/** How many frames sound of `samples` gives (Kaldi without snipped edges: length over shift, rounded). */
export function fbankFrameCount(samples: number): number {
  return Math.floor((samples + FBANK_SHIFT / 2) / FBANK_SHIFT);
}

/**
 * Sound as the voice model hears it: 80 log filterbank frames every 10 ms (their framing with reflected edges,
 * DC taken away, pre-emphasis, Povey window, power spectrum, mel banks, log past a floor). Flat row by row.
 */
export function fbankFrames(samples: ArrayLike<number>): { frames: Float32Array; count: number } {
  const n = samples.length;
  const count = fbankFrameCount(n);
  const frames = new Float32Array(count * FBANK_BINS);
  if (!count) return { frames, count };
  keptWindow = keptWindow ?? poveyWindow(FBANK_LENGTH);
  keptBanks = keptBanks ?? melBanks();
  const banks = keptBanks;
  const window = keptWindow;
  const re = new Float64Array(FBANK_NFFT);
  const im = new Float64Array(FBANK_NFFT);
  const power = new Float64Array(FBANK_NFFT / 2);
  const frame = new Float64Array(FBANK_LENGTH);
  for (let f = 0; f < count; f++) {
    // Centred, Kaldi's way (first frame's middle half a shift in), edges reflected.
    const midpoint = FBANK_SHIFT * f + FBANK_SHIFT / 2;
    const beginning = midpoint - FBANK_LENGTH / 2;
    for (let s = 0; s < FBANK_LENGTH; s++) {
      let at = beginning + s;
      while (at < 0 || at >= n) at = at < 0 ? -at - 1 : 2 * n - 1 - at;
      frame[s] = samples[at];
    }
    let mean = 0;
    for (let s = 0; s < FBANK_LENGTH; s++) mean += frame[s];
    mean /= FBANK_LENGTH;
    for (let s = 0; s < FBANK_LENGTH; s++) frame[s] -= mean;
    for (let s = FBANK_LENGTH - 1; s > 0; s--) frame[s] -= FBANK_PREEMPH * frame[s - 1];
    frame[0] -= FBANK_PREEMPH * frame[0];
    for (let s = 0; s < FBANK_LENGTH; s++) frame[s] *= window[s];
    re.fill(0);
    im.fill(0);
    re.set(frame);
    fftInPlace(re, im);
    for (let k = 0; k < FBANK_NFFT / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
    for (let b = 0; b < FBANK_BINS; b++) {
      const bank = banks[b];
      let energy = 0;
      for (let k = 0; k < bank.weights.length; k++) energy += bank.weights[k] * power[bank.offset + k];
      frames[f * FBANK_BINS + b] = Math.log(Math.max(energy, FBANK_EPS));
    }
  }
  return { frames, count };
}

/** Their "global-mean": each bin's mean over the utterance taken away, in place. */
export function subtractGlobalMean(frames: Float32Array, count: number, bins = FBANK_BINS): void {
  if (!count) return;
  for (let b = 0; b < bins; b++) {
    let mean = 0;
    for (let f = 0; f < count; f++) mean += frames[f * bins + b];
    mean /= count;
    for (let f = 0; f < count; f++) frames[f * bins + b] -= mean;
  }
}

// ── The segmentation (a port of their speaker-diarization-onnx.py) ─────────────────────────────────────────────────
// Each 10-second window (every second) says, per frame, which of its 3 local voices speak (powerset classes).

/** The segmentation's window: 10 seconds every second, 589 frames of 7 classes over 3 local voices. */
export const SEG_WINDOW = 160000;
export const SEG_SHIFT = 16000;
export const SEG_FRAMES = 589;
export const SEG_CLASSES = 7;
export const SEG_LOCAL = 3;
/** Each frame's step (270 samples) and span (991) at 16 kHz. */
export const SEG_RF_SHIFT = 270;
export const SEG_RF_SIZE = 991;

/** Powerset classes back as local voices: silence, each alone, each pair (their get_powerset_mapping). */
export function powersetMapping(): number[][] {
  const map: number[][] = [[0, 0, 0]];
  for (let j = 0; j < SEG_LOCAL; j++) {
    const row = [0, 0, 0];
    row[j] = 1;
    map.push(row);
  }
  for (let j = 0; j < SEG_LOCAL; j++) for (let m = j + 1; m < SEG_LOCAL; m++) {
    const row = [0, 0, 0];
    row[j] = 1;
    row[m] = 1;
    map.push(row);
  }
  return map;
}

/** A window's class scores as local-voice activity: argmax over classes, then the mapping. */
export function windowLabels(scores: ArrayLike<number>, mapping: readonly (readonly number[])[] = powersetMapping()): Uint8Array {
  const out = new Uint8Array(SEG_FRAMES * SEG_LOCAL);
  for (let f = 0; f < SEG_FRAMES; f++) {
    let best = 0;
    for (let c = 1; c < SEG_CLASSES; c++) if (scores[f * SEG_CLASSES + c] > scores[f * SEG_CLASSES + best]) best = c;
    for (let v = 0; v < SEG_LOCAL; v++) out[f * SEG_LOCAL + v] = mapping[best][v];
  }
  return out;
}

/** Where the windows start over sound of `samples` (every `shift`, plus the padded tail when needed). */
export function windowStarts(samples: number, shift = SEG_SHIFT): { starts: number[]; tail: boolean } {
  const step = Math.max(1600, Math.min(SEG_WINDOW, Math.floor(shift)));
  const starts: number[] = [];
  if (samples >= SEG_WINDOW) {
    const num = Math.floor((samples - SEG_WINDOW) / step) + 1;
    for (let i = 0; i < num; i++) starts.push(i * step);
  }
  const tail = samples < SEG_WINDOW || (samples - SEG_WINDOW) % step > 0;
  if (tail) starts.push(starts.length * step);
  return { starts, tail };
}

/** How many voices speak in each stitched frame (their speaker_count: overlapping windows averaged, then rounded). */
export function stitchSpeakerCount(labels: readonly Uint8Array[], starts: readonly number[]): Uint8Array {
  const span = starts.length ? starts[starts.length - 1] + SEG_WINDOW : SEG_WINDOW;
  const total = Math.floor(span / SEG_RF_SHIFT) + 1;
  const sum = new Float64Array(total);
  const count = new Float64Array(total);
  labels.forEach((lab, i) => {
    const at = Math.floor(starts[i] / SEG_RF_SHIFT + 0.5); // int(x + 0.5), theirs
    for (let f = 0; f < SEG_FRAMES; f++) {
      const g = at + f;
      if (g >= total) break;
      sum[g] += lab[f * SEG_LOCAL] + lab[f * SEG_LOCAL + 1] + lab[f * SEG_LOCAL + 2];
      count[g]++;
    }
  });
  const out = new Uint8Array(total);
  for (let g = 0; g < total; g++) out[g] = Math.round(sum[g] / Math.max(count[g], 1e-12));
  return out;
}

/** One local voice's sound in a window, as sample spans (their embedding spans; under 10 frames is skipped). */
export function embeddingSpans(label: Uint8Array, start: number): { voice: number; from: number; to: number }[][] {
  const out: { voice: number; from: number; to: number }[][] = [[], [], []];
  for (let v = 0; v < SEG_LOCAL; v++) {
    let active = 0;
    for (let f = 0; f < SEG_FRAMES; f++) active += label[f * SEG_LOCAL + v];
    if (active < 10) continue;
    let open = -1;
    for (let f = 0; f < SEG_FRAMES; f++) {
      const on = label[f * SEG_LOCAL + v] !== 0;
      if (on && open < 0) open = f;
      if (!on && open >= 0) {
        out[v].push({ voice: v, from: start + Math.floor((open / SEG_FRAMES) * SEG_WINDOW), to: start + Math.floor((f / SEG_FRAMES) * SEG_WINDOW) });
        open = -1;
      }
    }
    if (open >= 0) out[v].push({ voice: v, from: start + Math.floor((open / SEG_FRAMES) * SEG_WINDOW), to: start + Math.floor(((SEG_FRAMES - 1) / SEG_FRAMES) * SEG_WINDOW) });
  }
  return out;
}

/** The stitched votes relabelled by cluster, then each frame's voices (their relabel + vote). */
export function relabelFrames(
  labels: readonly Uint8Array[],
  starts: readonly number[],
  clusters: ReadonlyMap<string, number>,
  perFrame: Uint8Array,
  clustersOf: number,
  samples: number,
  tail: boolean,
): Uint8Array[] {
  const span = starts.length ? starts[starts.length - 1] + SEG_WINDOW : SEG_WINDOW;
  const total = Math.floor(span / SEG_RF_SHIFT) + 1;
  const votes: Float64Array[] = [];
  for (let i = 0; i < starts.length; i++) {
    const rel = new Float64Array(SEG_FRAMES * clustersOf);
    for (let f = 0; f < SEG_FRAMES; f++) for (let v = 0; v < SEG_LOCAL; v++) {
      if (!labels[i][f * SEG_LOCAL + v]) continue;
      const c = clusters.get(`${i}:${v}`);
      if (c === undefined) continue;
      rel[f * clustersOf + c] = 1;
    }
    votes.push(rel);
  }
  const count = new Float64Array(total * clustersOf);
  votes.forEach((rel, i) => {
    const at = Math.floor(starts[i] / SEG_RF_SHIFT + 0.5);
    for (let f = 0; f < SEG_FRAMES; f++) {
      const g = at + f;
      if (g >= total) break;
      for (let c = 0; c < clustersOf; c++) count[g * clustersOf + c] += rel[f * clustersOf + c];
    }
  });
  let frames = total;
  if (tail) frames = Math.min(frames, Math.floor(samples / SEG_RF_SHIFT));
  const out: Uint8Array[] = [];
  for (let c = 0; c < clustersOf; c++) out.push(new Uint8Array(frames));
  const order = new Array<number>(clustersOf);
  for (let g = 0; g < frames; g++) {
    for (let c = 0; c < clustersOf; c++) order[c] = c;
    order.sort((a, b) => count[g * clustersOf + b] - count[g * clustersOf + a]);
    const voices = Math.min(perFrame[g] ?? 0, clustersOf);
    for (let k = 0; k < voices; k++) out[order[k]][g] = 1;
  }
  return out;
}

/** Frames as timed stretches: on at half, off below half, near ones joined, short ones dropped. Upstream only writes
 *  a voice with more than one stretch (its print sits inside `len > 1`); a meeting with one voice the whole time
 *  would lose its only voice, so the port always writes (the single-voice fix). */
export function framesToTurns(frames: Uint8Array, minOn = 0.3, minOff = 0.5): { start: number; end: number }[] {
  const scale = SEG_RF_SHIFT / FBANK_RATE;
  const bias = (SEG_RF_SIZE / FBANK_RATE) * 0.5;
  const segs: { start: number; end: number }[] = [];
  let open = frames[0] > 0.5 ? 0 : -1;
  for (let g = 1; g < frames.length; g++) {
    if (open >= 0 && frames[g] < 0.5) {
      segs.push({ start: open * scale + bias, end: g * scale + bias });
      open = -1;
    } else if (open < 0 && frames[g] > 0.5) open = g;
  }
  if (open >= 0) segs.push({ start: open * scale + bias, end: (frames.length - 1) * scale + bias });
  const joined: { start: number; end: number }[] = [];
  for (const s of segs) {
    const last = joined[joined.length - 1];
    if (last && s.start - last.end <= minOff) last.end = s.end;
    else joined.push({ ...s });
  }
  return joined.filter((s) => s.end - s.start >= minOn).map((s) => ({ start: Math.max(0, Math.round(s.start * 100) / 100), end: Math.round(s.end * 100) / 100 }));
}

// ── The models on disk ─────────────────────────────────────────────────────────────────────────────────────────────

/** The speaker models inside a model folder (their released exports, renamed plainly). */
export const SEG_MODEL_FILE = 'segmentation-3-0-int8.onnx';
export const EMBED_MODEL_FILE = 'campplus-zh-en-advanced.onnx';

/** Where the speaker folder is looked for: beside the bundle, then with the app's own resources. */
export function speakerModelDirs(mainDir: string): string[] {
  return [path.join(mainDir, 'speaker', 'models'), path.join(path.resolve(mainDir, '..', '..'), 'resources', 'models', 'speaker')];
}

/** The first folder holding both models, else null (the engine stays quiet: transcripts stay as today). */
export function findSpeakerModelDir(dirs: string[]): string | null {
  for (const dir of dirs) {
    if (existsSync(path.join(dir, SEG_MODEL_FILE)) && existsSync(path.join(dir, EMBED_MODEL_FILE))) return dir;
  }
  return null;
}

// ── The runner (onnxruntime-web, lazily, one thread) ───────────────────────────────────────────────────────────────
// As src/main/meaning-embed.ts: the module is never imported (the embed's bundle check stays clean), the factory
// seam lets the tests run the real runner, and a missing runner falls back quietly.

/** The little of onnxruntime-web the speaker engine touches. */
export interface SpeakerOrtModule {
  env: { wasm: { numThreads: number; simd: boolean; wasmPaths: string; proxy?: boolean } };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  InferenceSession: { create(modelPath: string, opts: { executionProviders: string[] }): Promise<SpeakerOrtSession> };
}

export interface SpeakerOrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>>;
  release(): Promise<unknown>;
}

export type SpeakerSessionFactory = (modelPath: string, threads: number) => Promise<SpeakerOrtSession>;

/** A factory over a loaded onnxruntime-web whose files sit in `wasmDir` (nothing is fetched from anywhere else). */
export function ortSpeakerFactory(ort: SpeakerOrtModule, wasmDir: string): SpeakerSessionFactory {
  return async (modelPath: string, threads: number): Promise<SpeakerOrtSession> => {
    // A file URL, on every platform (6 Nov 2026, speakers-apart: the runner imports its WASM glue, and on Windows
    // a bare path fails — "Received protocol 'c:'" — so no session ever started there).
    ort.env.wasm.wasmPaths = pathToFileURL(`${wasmDir}${path.sep}`).href;
    ort.env.wasm.simd = true;
    ort.env.wasm.numThreads = Math.max(1, threads);
    if ('proxy' in ort.env.wasm) ort.env.wasm.proxy = false;
    return ort.InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
  };
}

const speakerRequire: NodeRequire | null = typeof require === 'function' ? require : null;

/**
 * The runner, loaded lazily (never bundled: the shipped files sit beside the bundle instead, and the standalone app
 * resolves its installed copy). Null when it is nowhere: the caller falls back, quietly. A throw from the copy beside
 * the bundle is said aloud through `report` (6 Nov 2026, speakers-apart: that throw hid there, and every transcript
 * stayed You and Others) before the installed copy below may still answer.
 */
export function loadSpeakerOrt(mainDir: string, report?: (error: unknown) => void): { ort: SpeakerOrtModule; wasmDir: string } | null {
  const req = speakerRequire ?? createRequire(path.join(mainDir, 'meeting-speaker-engine.cjs'));
  // The name tools/ort-ship.mjs lays beside the bundle (kept beside ORT_NODE_FILE in meaning-embed.ts): CommonJS
  // under any scope — the installed app reads as a module, and require() of the .js threw there.
  const alongside = path.join(mainDir, 'meaning', 'ort', 'ort.node.min.cjs');
  if (existsSync(alongside)) {
    try {
      return { ort: req(alongside) as SpeakerOrtModule, wasmDir: path.dirname(alongside) };
    } catch (err) {
      report?.(err);
    }
  }
  try {
    const ort = req('onnxruntime-web') as SpeakerOrtModule;
    const entry = req.resolve('onnxruntime-web');
    return { ort, wasmDir: path.dirname(entry) };
  } catch {
    return null;
  }
}

/** One thread unless asked: the engine never disturbs the recorder or the call. */
export const SPEAKER_THREADS = 1;
/** Windows run in batches of this many (fewer round trips; memory stays flat at ~10 MB a batch). */
export const SEG_BATCH = 16;

export type SpeakerTensor = new (type: string, data: Float32Array, dims: number[]) => unknown;

/** The two models started: windows in, labels out; voices in, voiceprints out. */
export class SpeakerEngine {
  private seg: SpeakerOrtSession | null = null;
  private emb: SpeakerOrtSession | null = null;
  /** The voiceprint's width, learned from the first voice heard (the model says it in its own metadata). */
  private dim = 0;

  constructor(
    private readonly modelDir: string,
    private readonly factory: SpeakerSessionFactory,
    private readonly Tensor: SpeakerTensor,
    private readonly threads: number = SPEAKER_THREADS,
  ) {}

  get ready(): boolean {
    return !!this.seg && !!this.emb;
  }

  /** Both models started (false: the transcripts stay as they are today). */
  async start(): Promise<boolean> {
    try {
      this.seg = await this.factory(path.join(this.modelDir, SEG_MODEL_FILE), this.threads);
      this.emb = await this.factory(path.join(this.modelDir, EMBED_MODEL_FILE), this.threads);
      return true;
    } catch {
      await this.close().catch(() => undefined);
      return false;
    }
  }

  async close(): Promise<void> {
    const [seg, emb] = [this.seg, this.emb];
    this.seg = null;
    this.emb = null;
    await seg?.release().catch(() => undefined);
    await emb?.release().catch(() => undefined);
  }

  /** Windows of sound as local-voice labels, in batches (`onBatch` yields between them). */
  async segment(samples: Float32Array, starts: readonly number[], onBatch?: () => Promise<void>): Promise<Uint8Array[]> {
    const seg = this.seg;
    if (!seg) throw new Error('The speaker models aren’t started.');
    const mapping = powersetMapping();
    const out: Uint8Array[] = [];
    for (let b = 0; b < starts.length; b += SEG_BATCH) {
      const batch = starts.slice(b, b + SEG_BATCH);
      const input = new Float32Array(batch.length * SEG_WINDOW);
      batch.forEach((start, i) => {
        const slice = samples.subarray(start, start + SEG_WINDOW);
        input.set(slice, i * SEG_WINDOW);
      });
      const y = await seg.run({ x: new this.Tensor('float32', input, [batch.length, 1, SEG_WINDOW]) });
      const data = Float32Array.from(y[Object.keys(y)[0]].data as ArrayLike<number>);
      for (let i = 0; i < batch.length; i++) out.push(windowLabels(data.subarray(i * SEG_FRAMES * SEG_CLASSES, (i + 1) * SEG_FRAMES * SEG_CLASSES), mapping));
      if (onBatch) await onBatch();
    }
    return out;
  }

    /** What a voice sounds like: its voiceprint (kept in memory only, never stored). */
  async embed(samples: Float32Array): Promise<Float32Array> {
    const emb = this.emb;
    if (!emb) throw new Error('The speaker models aren’t started.');
    const { frames, count } = fbankFrames(samples);
    if (!count) {
      if (!this.dim) throw new Error('There was no sound to hear.');
      return new Float32Array(this.dim);
    }
    subtractGlobalMean(frames, count);
    const y = await emb.run({ x: new this.Tensor('float32', frames, [1, count, FBANK_BINS]) });
    const out = Float32Array.from(y[Object.keys(y)[0]].data as ArrayLike<number>);
    this.dim = out.length;
    return out;
  }
}

/** Below this loudness a window holds no voice worth segmenting (skipped: zeros vote like silence). */
export const SEG_QUIET_RMS = 0.002;

/** Whether a window is worth segmenting (its RMS past the quiet floor). */
export function windowVoiced(samples: Float32Array, start: number): boolean {
  const end = Math.min(samples.length, start + SEG_WINDOW);
  if (end - start < SEG_WINDOW / 4) return true;
  let sum = 0;
  let n = 0;
  for (let i = start; i < end; i += 7) {
    sum += samples[i] * samples[i];
    n++;
  }
  return Math.sqrt(sum / Math.max(1, n)) >= SEG_QUIET_RMS;
}

/** The longest stretch live hearing listens to as one voice: past this it cuts at the quietest moment, so a long
 *  stretch with no pause in it still gives fresh prints (and a change of speaker with no pause some chance). */
export const LIVE_SPAN_MAX = 6;
/** The shortest stretch live hearing takes a voiceprint from: shorter prints are mostly the room, not the voice. */
export const LIVE_SPAN_MIN = 0.5;
/** Pauses up to this inside a stretch are a breath, not a change of speaker. */
export const LIVE_SPAN_JOIN = 0.35;

/**
 * The voiced stretches in sound live hearing takes one voiceprint each from, as sample spans: loud 20 ms frames
 * run together across breaths (LIVE_SPAN_JOIN), cut at real pauses, cut again at their quietest moment past
 * LIVE_SPAN_MAX, and too-short blips left out. The level is the sound's own (a share of its loud frames, never
 * under SEG_QUIET_RMS), so a quiet room and a loud one cut the same way. Live used to hear a whole twenty-second
 * piece as one print (6 Nov 2026, e1-speaker-turns: on the ff7b take every such print, two people averaged into
 * nobody, sounded 0.65–0.94 like the first, so live never saw the second voice; the same prints cut at the
 * pauses told the two apart 31 times in 31).
 */
export function voicedSpans(samples: Float32Array, rate = FBANK_RATE): { from: number; to: number }[] {
  const frame = Math.max(1, Math.floor(rate * 0.02));
  const frames = Math.floor(samples.length / frame);
  if (!frames) return [];
  const rms = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += samples[i] * samples[i];
    rms[f] = Math.sqrt(sum / frame);
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const loud = sorted[Math.min(frames - 1, Math.floor(frames * 0.9))] ?? 0;
  if (loud < SEG_QUIET_RMS) return [];
  const level = Math.max(SEG_QUIET_RMS, loud * 0.18);
  const join = Math.round((LIVE_SPAN_JOIN * rate) / frame);
  const runs: { from: number; to: number }[] = [];
  let open = -1;
  let quiet = 0;
  for (let f = 0; f < frames; f++) {
    if (rms[f] >= level) {
      if (open < 0) open = f;
      quiet = 0;
    } else if (open >= 0 && ++quiet > join) {
      runs.push({ from: open, to: f - quiet + 1 });
      open = -1;
      quiet = 0;
    }
  }
  if (open >= 0) runs.push({ from: open, to: frames - quiet });
  const maxFrames = Math.round((LIVE_SPAN_MAX * rate) / frame);
  const minFrames = Math.round((LIVE_SPAN_MIN * rate) / frame);
  const out: { from: number; to: number }[] = [];
  for (const run of runs) {
    let from = run.from;
    while (run.to - from > maxFrames) {
      let cut = from + maxFrames;
      let best = Infinity;
      for (let f = from + Math.floor(maxFrames / 2); f <= from + maxFrames; f++) {
        if (rms[f] < best) {
          best = rms[f];
          cut = f;
        }
      }
      out.push({ from: from * frame, to: cut * frame });
      from = cut;
    }
    if (run.to - from >= minFrames) out.push({ from: from * frame, to: Math.min(samples.length, run.to * frame) });
    else if (out.length && run.from * frame === out[out.length - 1].to) out[out.length - 1].to = Math.min(samples.length, run.to * frame);
  }
  return out.filter((s) => s.to - s.from >= minFrames * frame);
}

/** A voice is heard from at most this much of its spans (prints stop improving past it; longer spans cost time). */
export const EMBED_MAX_SECONDS = 5;

export interface DiarizeOptions {
  side: SpeakerSide;
  /** Window step in samples (default every second, their stride; wider steps trade boundary precision for speed). */
  shift?: number;
  /** Pairs of embedding indices the clustering must never merge (the final pass's named pairs). */
  forbid?: readonly (readonly [number, number])[];
  /** The live pass's turns and the names set on them: embeddings heard under different names never merge. */
  live?: { turns: readonly SpeakerTurn[]; names: Readonly<Record<string, string>> };
  /** How alike two voices must sound to count as one (meetings: fewer, surer voices). */
  threshold?: number;
  /** The most voices kept. */
  cap?: number;
  /** Called between batches so the worker yields. */
  onBatch?: () => Promise<void>;
}

export interface Diarized {
  turns: SpeakerTurn[];
  /** Voices found, in the order first heard. */
  voices: number;
}

/**
 * One side (or one mixed stream) diarised: voiced windows segmented, each local voice heard, the likeness joined
 * into voices, the frames relabelled and stitched into turns. Empty when nothing voiced (silence stays silent:
 * the transcript stays as today).
 */
export async function diarizeSide(engine: SpeakerEngine, samples: Float32Array, opts: DiarizeOptions): Promise<Diarized> {
  const { starts, tail } = windowStarts(samples.length, opts.shift ?? SEG_SHIFT);
  if (!starts.length) return { turns: [], voices: 0 };
  const voiced = starts.map((s) => windowVoiced(samples, s));
  const runAt = starts.filter((_, i) => voiced[i]);
  const ran = runAt.length ? await engine.segment(samples, runAt, opts.onBatch) : [];
  const labels: Uint8Array[] = [];
  let r = 0;
  for (let i = 0; i < starts.length; i++) labels.push(voiced[i] ? ran[r++] : new Uint8Array(SEG_FRAMES * SEG_LOCAL));
  const perFrame = stitchSpeakerCount(labels, starts);
  let peak = 0;
  for (let g = 0; g < perFrame.length; g++) peak = Math.max(peak, perFrame[g]);
  if (!peak) return { turns: [], voices: 0 };
  // Each local voice heard, across its window's spans joined.
  const pairs: { chunk: number; voice: number; spans: { from: number; to: number }[] }[] = [];
  labels.forEach((lab, i) => {
    for (const spans of embeddingSpans(lab, starts[i])) {
      if (spans.length) pairs.push({ chunk: i, voice: spans[0].voice, spans });
    }
  });
  const prints: Float32Array[] = [];
  const maxSamples = EMBED_MAX_SECONDS * FBANK_RATE;
  for (const p of pairs) {
    const len = p.spans.reduce((s, x) => s + Math.max(0, Math.min(x.to, samples.length) - x.from), 0);
    const joined = new Float32Array(Math.min(len, maxSamples));
    let at = 0;
    for (const x of p.spans) {
      const from = Math.max(0, x.from);
      const to = Math.min(samples.length, x.to);
      if (to > from && at < joined.length) {
        const take = Math.min(to - from, joined.length - at);
        joined.set(samples.subarray(from, from + take), at);
        at += take;
      }
    }
    prints.push(await engine.embed(joined.subarray(0, at)));
    if (opts.onBatch) await opts.onBatch();
  }
  if (!prints.length) return { turns: [], voices: 0 };
  const sides = prints.map(() => opts.side);
  // A name set during the meeting is never merged away: each embedding's span takes the live voice holding most of
  // it, and spans under different names forbid their pair.
  const forbid: [number, number][] = [...(opts.forbid ?? [])] as [number, number][];
  const spanCover = pairs.map((p) => p.spans.reduce((s, x) => s + (x.to - x.from), 0) / FBANK_RATE);
  if (opts.live && Object.keys(opts.live.names).length) {
    const spans = pairs.map((p) => ({ from: Math.min(...p.spans.map((x) => x.from)) / FBANK_RATE, to: Math.max(...p.spans.map((x) => x.to)) / FBANK_RATE }));
    forbid.push(...forbidFromLive(spans, opts.live.turns, opts.live.names));
  }
  let clusterOf = clusterVoices(prints, { ...(opts.threshold !== undefined ? { threshold: opts.threshold } : {}), ...(opts.cap !== undefined ? { cap: opts.cap } : {}), sides, ...(forbid.length ? { forbid } : {}) });
  clusterOf = mergeTinyVoices(prints, clusterOf, spanCover, { sides, forbid: new Set(forbid.map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`)) });
  const clusters = new Map<string, number>();
  pairs.forEach((p, i) => clusters.set(`${p.chunk}:${p.voice}`, clusterOf[i]));
  const voices = Math.max(...clusterOf) + 1;
  const frames = relabelFrames(labels, starts, clusters, perFrame, voices, samples.length, tail);
  const turns: SpeakerTurn[] = [];
  frames.forEach((fr, c) => {
    for (const s of framesToTurns(fr)) turns.push({ id: `spk${c + 1}`, start: s.start, end: s.end, side: opts.side });
  });
  turns.sort((a, b) => a.start - b.start);
  return { turns, voices };
}

/** A voice heard for less than this joins its likest neighbour (tuned for meetings: a rare wrong line annoys less
 *  than a crowd of one-word voices). */
export const MIN_VOICE_SECONDS = 2;

/**
 * Tiny voices (under MIN_VOICE_SECONDS of span cover) joined onto their likest neighbour by centroid likeness,
 * smallest first; the largest survives when all are tiny, so voices are never lost altogether. The certain facts
 * hold here too: sides never join, nor pairs forbidden (the final pass's named pairs) — a tiny voice with no
 * neighbour it may join stays a voice of its own. Deterministic.
 */
export function mergeTinyVoices(
  prints: readonly Float32Array[],
  clusterOf: readonly number[],
  cover: readonly number[],
  opts: { sides?: readonly SpeakerSide[]; forbid?: ReadonlySet<string> } = {},
): number[] {
  const members = new Map<number, number[]>();
  clusterOf.forEach((c, i) => {
    const list = members.get(c) ?? [];
    list.push(i);
    members.set(c, list);
  });
  if (members.size < 2) return [...clusterOf];
  const centroid = (idx: number[]): Float64Array => {
    const dim = prints[idx[0]].length;
    const out = new Float64Array(dim);
    for (const i of idx) for (let d = 0; d < dim; d++) out[d] += prints[i][d];
    return out;
  };
  const like = (a: Float64Array, b: Float64Array): number => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let d = 0; d < a.length; d++) {
      dot += a[d] * b[d];
      na += a[d] * a[d];
      nb += b[d] * b[d];
    }
    return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
  };
  const total = (idx: number[]): number => idx.reduce((s, i) => s + (cover[i] ?? 0), 0);
  const tiny = [...members.keys()].filter((c) => total(members.get(c)!) < MIN_VOICE_SECONDS).sort((a, b) => total(members.get(a)!) - total(members.get(b)!));
  if (!tiny.length) return [...clusterOf];
  const keep = [...members.keys()].filter((c) => !tiny.includes(c)).sort((a, b) => total(members.get(b)!) - total(members.get(a)!));
  // All tiny: the largest survives, the rest join it.
  const survivors = keep.length ? keep : [[...members.keys()].sort((a, b) => total(members.get(b)!) - total(members.get(a)!))[0]];
  const orphans = tiny.filter((c) => !survivors.includes(c));
  const mayJoin = (c: number, s: number): boolean => {
    if (opts.sides) {
      const a = new Set(members.get(c)!.map((i) => opts.sides![i]));
      const b = new Set(members.get(s)!.map((i) => opts.sides![i]));
      if ((a.has('mic') && b.has('pc')) || (a.has('pc') && b.has('mic'))) return false;
    }
    if (opts.forbid?.size) {
      for (const i of members.get(c)!) for (const j of members.get(s)!) {
        if (opts.forbid.has(`${Math.min(i, j)}:${Math.max(i, j)}`)) return false;
      }
    }
    return true;
  };
  const remap = new Map<number, number>();
  for (const c of orphans) {
    const mine = centroid(members.get(c)!);
    let best = -1;
    let bestLike = -2;
    for (const s of survivors) {
      if (!mayJoin(c, s)) continue;
      const l = like(mine, centroid(members.get(s)!));
      if (l > bestLike + 1e-9) {
        bestLike = l;
        best = s;
      }
    }
    if (best < 0) continue;
    remap.set(c, best);
    members.get(best)!.push(...members.get(c)!);
  }
  // Voices renumbered in the order first heard.
  const firstHeard = new Map<number, number>();
  clusterOf.forEach((c, i) => {
    const r = remap.get(c) ?? c;
    if (!firstHeard.has(r) || i < firstHeard.get(r)!) firstHeard.set(r, i);
  });
  const ranked = [...firstHeard.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
  return clusterOf.map((c) => ranked.indexOf(remap.get(c) ?? c));
}

/** How much two stretches share, in seconds. */
const spanOverlap = (a: number, b: number, c: number, d: number): number => Math.max(0, Math.min(b, d) - Math.max(a, c));

/**
 * The final pass's named pairs, by time: two embeddings the live pass heard under different names must never merge.
 * Each embedding span takes the live voice holding most of it; spans under different names forbid their pair.
 */
export function forbidFromLive(
  spans: readonly { from: number; to: number }[],
  live: readonly SpeakerTurn[],
  names: Readonly<Record<string, string>>,
): [number, number][] {
  const under = spans.map((s) => {
    const held = new Map<string, number>();
    for (const l of live) {
      if (!names[l.id]) continue;
      const o = spanOverlap(s.from, s.to, l.start, l.end);
      if (o > 0) held.set(names[l.id].toLowerCase(), (held.get(names[l.id].toLowerCase()) ?? 0) + o);
    }
    return held.size ? [...held].sort((a, b) => b[1] - a[1])[0][0] : '';
  });
  const out: [number, number][] = [];
  for (let i = 0; i < under.length; i++) for (let j = i + 1; j < under.length; j++) {
    if (under[i] && under[j] && under[i] !== under[j]) out.push([i, j]);
  }
  return out;
}

// ── The worker (its own thread, one runner thread, yields between batches) ──────────────────────────────────────────
// The engine runs beside the app, never in it: live embeddings and the final pass post across, and only turns come
// back (voiceprints never leave the worker's memory). When no worker stands (its file missing, or threads refused),
// the same engine runs in-process with yields: the same answers, still one runner thread.

export type SpeakerWork =
  | { type: 'embed'; samples: Float32Array }
  | { type: 'diarize'; samples: Float32Array; opts: DiarizeOptions };

export interface SpeakerRunner {
  embed(samples: Float32Array): Promise<Float32Array>;
  diarize(samples: Float32Array, opts: DiarizeOptions): Promise<Diarized>;
  close(): Promise<void>;
}

/** The engine in-process (the fallback; the worker holds the same engine across the thread). */
export class LocalSpeakerRunner implements SpeakerRunner {
  private engine: SpeakerEngine | null = null;
  constructor(
    private readonly modelDir: string,
    private readonly factory: SpeakerSessionFactory,
    private readonly Tensor: SpeakerTensor,
    private readonly threads = SPEAKER_THREADS,
  ) {}

  private async ready(): Promise<SpeakerEngine> {
    if (!this.engine) {
      const e = new SpeakerEngine(this.modelDir, this.factory, this.Tensor, this.threads);
      if (!(await e.start())) throw new Error('The speaker models couldn’t start.');
      this.engine = e;
    }
    return this.engine;
  }

  async embed(samples: Float32Array): Promise<Float32Array> {
    return (await this.ready()).embed(samples);
  }

  async diarize(samples: Float32Array, opts: DiarizeOptions): Promise<Diarized> {
    return diarizeSide(await this.ready(), samples, { ...opts, onBatch: () => new Promise((ok) => setImmediate(ok)) });
  }

  async close(): Promise<void> {
    await this.engine?.close().catch(() => undefined);
    this.engine = null;
  }
}

export interface SpeakerWorkerHost {
  post(message: unknown): void;
  onMessage(fn: (message: { id: number; ok: boolean; value?: unknown; error?: string }) => void): void;
  end(): Promise<void>;
}

/** The engine across the thread (the worker file built by tools/build-speaker-worker.mjs). */
export class WorkerSpeakerRunner implements SpeakerRunner {
  private next = 1;
  private readonly waiting = new Map<number, { ok: (v: never) => void; fail: (e: Error) => void }>();
  private started: Promise<void> | null = null;

  constructor(
    private readonly host: SpeakerWorkerHost,
    private readonly modelDir: string,
    private readonly threads = SPEAKER_THREADS,
  ) {
    host.onMessage((m) => {
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      if (m.ok) w.ok(m.value as never);
      else w.fail(new Error(typeof m.error === 'string' && m.error ? m.error : 'The speakers couldn’t be told apart.'));
    });
  }

  private begin(): Promise<void> {
    if (!this.started) {
      const id = this.next++;
      this.started = new Promise<void>((ok, fail) => {
        this.waiting.set(id, { ok: ok as (v: never) => void, fail });
        this.host.post({ id, type: 'start', modelDir: this.modelDir, threads: this.threads });
      });
    }
    return this.started;
  }

  private ask<T>(type: string, extra: Record<string, unknown>): Promise<T> {
    return this.begin().then(
      () =>
        new Promise<T>((ok, fail) => {
          const id = this.next++;
          this.waiting.set(id, { ok: ok as (v: never) => void, fail });
          this.host.post({ id, type, ...extra });
        }),
    );
  }

  async embed(samples: Float32Array): Promise<Float32Array> {
    const v = await this.ask<number[]>('embed', { samples });
    return Float32Array.from(v);
  }

  async diarize(samples: Float32Array, opts: DiarizeOptions): Promise<Diarized> {
    const { onBatch: _drop, ...plain } = opts;
    void _drop;
    return this.ask<Diarized>('diarize', { samples, opts: plain });
  }

  async close(): Promise<void> {
    for (const [, w] of this.waiting) w.fail(new Error('The speaker worker closed.'));
    this.waiting.clear();
    await this.host.end().catch(() => undefined);
  }
}

