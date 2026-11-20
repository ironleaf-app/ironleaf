// Meeting recorder (21 Oct 2026, gap G18; rebuilt 22 Oct 2026): the rules a recording follows, kept apart from the
// microphone so they can be tested on their own. A meeting is recorded inside its Meeting note (views/MeetingRecorder.tsx,
// state/recorder.ts): the microphone, and on Windows the PC's own sound too (the other people on a Teams, Zoom or browser
// call), with a red dot, the time, Pause and Stop always in sight, and a small pill wherever the person goes.
//
// Two halves. The LIVE recorder (one at a time: idle → starting → recording ⇄ paused) and the JOBS that follow each
// Stop (the recording saved into the note, the last pieces written down, the notes made). A job belongs to its meeting
// note and lives on disk as it goes (src/main/meeting-recorder.ts keeps the audio, the speech and the job's record in
// Ironleaf's own data), so a crash or a restart mid-meeting loses nothing: the next start offers to finish it.
//
// While it records, the sound is cut into short pieces (about twenty seconds, cut where it is quietest so a word is never
// split, and early when the other side starts talking) and each piece is written down as soon as it is ready, through The
// former host app (the host's transcribeAudio, with the person's own speech service). So a long meeting never waits on
// one huge file, the transcript grows while the meeting goes on, and Stop only waits for the last piece. A piece of
// silence is never sent. With the PC's sound recorded too, each piece knows who was talking: you (the microphone) or the
// others (the PC's sound).
//
// Pure: no DOM, no Electron, so the node tests run every rule here.

// ── The live recorder ────────────────────────────────────────────────────────────────────────────────────────────────

/** idle → starting (asking for the microphone) → recording ⇄ paused → idle again at Stop (the job carries on). */
export type RecPhase = 'idle' | 'starting' | 'recording' | 'paused';

export interface RecState {
  phase: RecPhase;
  /** The recording's job (its folder on disk), from start until Stop. */
  id: string | null;
  /** The meeting note being recorded (its path), from start until Stop. */
  note: string | null;
  /** When the recording began (ms), once the microphone was given. */
  startedAt: number | null;
  /** When the pause going on now began (ms). */
  pausedAt: number | null;
  /** Time spent paused before the pause going on now (ms). */
  pausedMs: number;
}

export type RecEvent =
  | { type: 'start'; id: string; note: string }
  | { type: 'started' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'moved'; from: string; to: string }
  | { type: 'stop' }
  | { type: 'fail' };

export const IDLE: RecState = { phase: 'idle', id: null, note: null, startedAt: null, pausedAt: null, pausedMs: 0 };

/** The microphone is open (recording or paused). */
export const isLive = (s: RecState) => s.phase === 'recording' || s.phase === 'paused';
/** A recording is under way (or starting): a new one must wait for it. */
export const isBusy = (s: RecState) => s.phase !== 'idle';

/** A path after a note (or a folder holding it) moved from `from` to `to`; the same path when it wasn't touched. */
export function movedPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
}
/** Whether removing `removed` (a note, or a folder) took `path` with it. */
export const goneWith = (path: string, removed: string) => path === removed || path.startsWith(`${removed}/`);

/**
 * The next state for an event at `now`. An event that makes no sense in the state it arrives in (Pause while paused, a
 * second Stop, Resume after Stop) changes nothing, so a double click or a late message can never confuse a recording.
 */
export function recStep(s: RecState, e: RecEvent, now: number): RecState {
  switch (e.type) {
    case 'start':
      return isBusy(s) ? s : { ...IDLE, phase: 'starting', id: e.id, note: e.note };
    case 'started':
      return s.phase === 'starting' ? { ...s, phase: 'recording', startedAt: now } : s;
    case 'pause':
      return s.phase === 'recording' ? { ...s, phase: 'paused', pausedAt: now } : s;
    case 'resume':
      return s.phase === 'paused' ? { ...s, phase: 'recording', pausedAt: null, pausedMs: s.pausedMs + Math.max(0, now - (s.pausedAt ?? now)) } : s;
    case 'moved':
      return s.note ? { ...s, note: movedPath(s.note, e.from, e.to) } : s;
    case 'stop':
    case 'fail':
      return isBusy(s) ? IDLE : s;
  }
}

/** How long has been recorded (ms): from the start to now (or the pause going on), less the pauses. */
export function recElapsed(s: Pick<RecState, 'startedAt' | 'pausedAt' | 'pausedMs'>, now: number): number {
  if (s.startedAt === null) return 0;
  const end = s.pausedAt ?? now;
  return Math.max(0, end - s.startedAt - s.pausedMs);
}

/** A time as the recorder shows it: "0:07", "12:03", "1:02:03". */
export function clockWords(ms: number): string {
  const all = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(all / 3600);
  const m = Math.floor((all % 3600) / 60);
  const sec = String(all % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** "12:03" or "1:02:03" read back as seconds (null: not a time). */
export function clockSeconds(words: string): number | null {
  const m = /^\s*(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)(?:\.\d+)?\s*$/.exec(String(words ?? ''));
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
}

/** A length in words: "under a minute", "1 minute", "42 minutes", "1 hour 5 minutes". */
export function lengthWords(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const mins = (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;
  return h ? `${h} ${h === 1 ? 'hour' : 'hours'}${m ? ` ${mins(m)}` : ''}` : mins(m);
}

// ── Cutting the sound into pieces ────────────────────────────────────────────────────────────────────────────────────

/** The rate pieces are written down at: speech needs no more, and the speech kept on disk is 115 MB an hour. */
export const PIECE_RATE = 16_000;
/** About how long a piece is: short enough that the transcript grows while the meeting goes on and each line has its
 *  own time to play from; long enough that the speech service hears whole sentences. */
export const PIECE_SECONDS = 20;
/** How far back from a piece's end the quietest moment is looked for. */
export const LOOK_BACK_SECONDS = 4;
/** A piece is never cut shorter than this when the other side starts talking. */
export const TURN_MIN_SECONDS = 4;
/** A piece shorter than this at the end (a click of Stop) is not sent. */
export const SHORTEST_SECONDS = 0.6;
/** Below this loudness (RMS, full scale 1) a piece is silence: never sent. */
export const SILENT = 0.003;

export interface Piece {
  /** 0 for the first piece, then 1, 2… in order. */
  index: number;
  /** Where it starts in the recording (seconds, pauses left out). */
  start: number;
  /** The sound, at the chunker's rate, -1 … 1. */
  samples: Float32Array;
}

/** Sound at one rate made into another (each new sample the average of the old ones it covers; speech loses nothing). */
export function downsample(input: Float32Array, from: number, to = PIECE_RATE): Float32Array {
  if (from === to || !input.length) return input.slice();
  if (from < to) {
    // Rarely asked (a low-rate microphone): the nearest sample.
    const out = new Float32Array(Math.floor((input.length * to) / from));
    for (let i = 0; i < out.length; i++) out[i] = input[Math.min(input.length - 1, Math.floor((i * from) / to))];
    return out;
  }
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += input[j];
    out[i] = b > a ? sum / (b - a) : input[a] ?? 0;
  }
  return out;
}

/** How loud sound is (root mean square, 0 … 1). */
export function loudness(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Whether a piece is only silence (not worth sending). */
export const isQuiet = (p: Pick<Piece, 'samples'>) => loudness(p.samples) < SILENT;

/**
 * Collects the sound as it comes and hands back pieces of about `seconds`, each cut at the quietest moment of its last
 * few seconds (a pause between words), so no word is cut in two; takeTurn() cuts early when someone else starts talking;
 * flush() gives what is left after Stop.
 */
export class Chunker {
  private buffer: Float32Array;
  private length = 0;
  private next = 0;
  private emitted = 0;
  readonly rate: number;
  readonly seconds: number;
  private readonly lookBack: number;

  constructor(opts: { rate?: number; seconds?: number; lookBack?: number; startIndex?: number; startAt?: number } = {}) {
    this.rate = opts.rate ?? PIECE_RATE;
    this.seconds = opts.seconds ?? PIECE_SECONDS;
    this.lookBack = Math.min(opts.lookBack ?? LOOK_BACK_SECONDS, this.seconds / 2);
    this.buffer = new Float32Array(Math.ceil(this.rate * this.seconds * 1.25));
    this.next = opts.startIndex ?? 0;
    this.emitted = Math.round((opts.startAt ?? 0) * this.rate);
  }

  /** Sound held, not yet in a piece (seconds). */
  get held(): number {
    return this.length / this.rate;
  }

  /** Where the sound held starts in the recording (seconds). */
  get heldFrom(): number {
    return this.emitted / this.rate;
  }

  push(samples: Float32Array): Piece[] {
    const out: Piece[] = [];
    let at = 0;
    while (at < samples.length) {
      const room = this.buffer.length - this.length;
      const take = Math.min(room, samples.length - at);
      this.buffer.set(samples.subarray(at, at + take), this.length);
      this.length += take;
      at += take;
      while (this.length >= this.rate * this.seconds) out.push(this.cut(this.quietest(Math.floor(this.rate * this.seconds), this.lookBack)));
    }
    return out;
  }

  /** Someone else started talking `since` seconds ago: the piece so far, cut at the quietest moment around the change
   *  (null while the piece is still shorter than TURN_MIN_SECONDS). */
  takeTurn(since = 0.8): Piece | null {
    const keep = Math.floor(this.rate * (since + 0.4));
    if (this.length < this.rate * TURN_MIN_SECONDS || this.length <= keep) return null;
    return this.cut(this.quietest(this.length, since + 0.4));
  }

  /** What is left after Stop, as the last piece (null: nothing worth sending). */
  flush(): Piece | null {
    if (this.length < this.rate * SHORTEST_SECONDS) {
      this.emitted += this.length;
      this.length = 0;
      return null;
    }
    return this.cut(this.length);
  }

  /** The sample to cut at: the middle of the quietest 20 ms in the `lookBack` seconds before `target`. */
  private quietest(target: number, lookBack: number): number {
    const frame = Math.max(1, Math.floor(this.rate * 0.02));
    const from = Math.max(frame, target - Math.floor(this.rate * lookBack));
    let best = target;
    let bestEnergy = Infinity;
    for (let end = target; end - frame >= from; end -= Math.max(1, Math.floor(frame / 2))) {
      let e = 0;
      for (let i = end - frame; i < end; i++) e += this.buffer[i] * this.buffer[i];
      // The latest of equally quiet moments, so pieces stay near their length.
      if (e < bestEnergy - 1e-9) {
        bestEnergy = e;
        best = end - Math.floor(frame / 2);
      }
    }
    return best;
  }

  private cut(at: number): Piece {
    const samples = this.buffer.slice(0, at);
    this.buffer.copyWithin(0, at, this.length);
    this.length -= at;
    const piece = { index: this.next++, start: this.emitted / this.rate, samples };
    this.emitted += at;
    return piece;
  }
}

/** A piece as a WAV file (16-bit, one channel): what the former host app's transcription takes. */
export function encodeWav(samples: Float32Array, rate = PIECE_RATE): Uint8Array {
  return wavOfPcm(toPcm16(samples), rate);
}

/** Sound as 16-bit samples (little-endian bytes), as the speech kept on disk is written. */
export function toPcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const v = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** 16-bit samples (little-endian bytes) as a WAV file. */
export function wavOfPcm(pcm: Uint8Array, rate = PIECE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length);
  const v = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, pcm.length, true);
  bytes.set(pcm, 44);
  return bytes;
}

/** 16-bit samples (little-endian bytes) back as sound, -1 … 1. */
export function fromPcm16(pcm: Uint8Array): Float32Array {
  const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const out = new Float32Array(Math.floor(pcm.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = v.getInt16(i * 2, true) / 0x8000;
  return out;
}

/** The microphone and PC sound interleaved (left and right) as 16-bit samples: how the speech on disk is kept for a
 *  recording with both (r2, Nov 2026), so each side reads back apart. The shorter side is padded with silence. */
export function toPcm16Stereo(mic: Float32Array, pc: Float32Array): Uint8Array {
  const len = Math.max(mic.length, pc.length);
  const bytes = new Uint8Array(len * 4);
  const v = new DataView(bytes.buffer);
  for (let i = 0; i < len; i++) {
    const m = Math.max(-1, Math.min(1, mic[i] ?? 0));
    const c = Math.max(-1, Math.min(1, pc[i] ?? 0));
    v.setInt16(i * 4, m < 0 ? m * 0x8000 : m * 0x7fff, true);
    v.setInt16(i * 4 + 2, c < 0 ? c * 0x8000 : c * 0x7fff, true);
  }
  return bytes;
}

/** Interleaved speech back as its two sides. */
export function fromPcm16Stereo(pcm: Uint8Array): { mic: Float32Array; pc: Float32Array } {
  const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const len = Math.floor(pcm.byteLength / 4);
  const mic = new Float32Array(len);
  const pc = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    mic[i] = v.getInt16(i * 4, true) / 0x8000;
    pc[i] = v.getInt16(i * 4 + 2, true) / 0x8000;
  }
  return { mic, pc };
}

/** Interleaved speech as one mixed stream (their average, never clipping): what a piece without a side reads back as
 *  (a crash tail, or a job from before the sides were kept). */
export function mixStereoToMono(pcm: Uint8Array): Float32Array {
  const { mic, pc } = fromPcm16Stereo(pcm);
  const out = new Float32Array(mic.length);
  for (let i = 0; i < out.length; i++) out[i] = (mic[i] + pc[i]) / 2;
  return out;
}

// ── Who is talking: you (the microphone) or the others (the PC's sound) ──────────────────────────────────────────────
// The two sources stay separate from the tap to the service (r2, Nov 2026): each piece is cut on the mix but
// transcribed per side, so labels follow the side that talked and overlap keeps both lines. Judging "who talked" from
// mixed energy (the old Levels vote) and turning the microphone down in the mix (micDuck) went with the mix. The loss
// of far-side words is not fixed here (reviewer, 5 Nov 2026: the far side is louder than they are, yet a second
// transcriber recovered the missing words from the same mix): its cause is still open.

export type Who = 'You' | 'Others';
/** Quieter than this (RMS) a source isn't talking. */
export const TALKING = 0.008;
/** One source talks over the other when it is this much louder. */
const OVER = 1.6;

/** Which source is talking in a moment, from their loudness: the microphone, the PC's sound, or neither. */
export function talker(mic: number, pc: number): 'mic' | 'pc' | null {
  if (mic >= TALKING && mic > pc * OVER) return 'mic';
  if (pc >= TALKING && pc > mic * OVER) return 'pc';
  return null;
}

/** The highest the learnt quiet ever rises (r3, 5 Nov 2026): sustained speech must never become its own quiet (as
 *  found, the floor followed a long far-side stretch up and muted it after about a minute, whole minutes lost with
 *  no error). The cap still learns a loud room (a fan below it becomes the quiet) while speech above it always counts. */
export const VOICE_FLOOR_CAP = 0.014;

/**
 * Whether one source holds a voice, judged against its own quiet: the microphone (levelled up, hissing) and the PC's
 * sound (raw loopback) can never share one fixed level. The floor follows silence down fast and a new quiet up
 * slowly, so a steady hiss becomes the quiet while a voice above it still counts; speech itself barely moves it, and
 * never past the cap, so a long stretch never mutes itself. feed() each block's loudness; voice() judges a moment's.
 * Never below 0.005 (r2 second round, 5 Nov 2026).
 */
export class VoiceGate {
  /** The source's quiet (RMS), learnt as it goes. */
  floor = 0.001;
  constructor(
    private readonly ratio = 3.5,
    private readonly absMin = 0.005,
  ) {}

  feed(rms: number): boolean {
    if (rms < this.floor) this.floor += (rms - this.floor) * 0.2;
    else if (this.floor < VOICE_FLOOR_CAP) this.floor = Math.min(VOICE_FLOOR_CAP, this.floor + (rms - this.floor) * (this.voice(rms) ? 0.0002 : 0.002));
    return this.voice(rms);
  }

  voice(rms: number): boolean {
    return rms > Math.max(this.absMin, this.floor * this.ratio);
  }
}

/**
 * Notices the other side starting to talk (the microphone to the PC's sound, or back) and holding it for `hold` seconds:
 * the moment to cut a piece, so each piece is one side talking. feed() each block's loudness and length; it answers
 * true once, when a turn is taken.
 */
export class TurnTracker {
  private current: 'mic' | 'pc' | null = null;
  private other = 0;
  constructor(private readonly hold = 0.7) {}

  feed(mic: number, pc: number, seconds: number): boolean {
    const now = talker(mic, pc);
    if (!now) return false;
    if (!this.current) {
      this.current = now;
      return false;
    }
    if (now === this.current) {
      this.other = 0;
      return false;
    }
    this.other += seconds;
    if (this.other < this.hold) return false;
    this.current = now;
    this.other = 0;
    return true;
  }

  /** A new piece begins with whoever is talking now. */
  reset(): void {
    this.other = 0;
  }
}

/** One piece cut with each side's own sound in it (null PC sound: the microphone alone is recorded). */
export interface CapturedPiece {
  /** 0 for the first piece, then 1, 2… in order. */
  index: number;
  /** Where it starts in the recording (seconds, pauses left out). */
  start: number;
  seconds: number;
  /** The sides holding speech in this piece ('mic' is you, 'pc' the others); empty when neither talked. */
  sides: ('mic' | 'pc')[];
  /** This piece's microphone sound, at the chunker's rate. */
  mic: Float32Array;
  /** This piece's PC sound, or null when the PC's sound isn't recorded. */
  pc: Float32Array | null;
}

/** Each source's sound held beside the chunker, in lockstep with it, so a cut piece's sides slice out exactly. */
export class Sideband {
  private micBuf: Float32Array;
  private pcBuf: Float32Array;
  private length = 0;
  private emitted = 0;
  private readonly rate: number;

  constructor(opts: { rate?: number; seconds?: number } = {}) {
    this.rate = opts.rate ?? PIECE_RATE;
    const room = Math.ceil(this.rate * (opts.seconds ?? PIECE_SECONDS) * 1.25) + 16384;
    this.micBuf = new Float32Array(room);
    this.pcBuf = new Float32Array(room);
  }

  /** The microphone and PC blocks of one tap block (the PC's null when it isn't recorded: zeros are kept). */
  push(mic: Float32Array, pc: Float32Array | null): void {
    const len = mic.length;
    if (this.length + len > this.micBuf.length) {
      const room = Math.max(this.micBuf.length * 2, this.length + len);
      const micNext = new Float32Array(room);
      const pcNext = new Float32Array(room);
      micNext.set(this.micBuf.subarray(0, this.length));
      pcNext.set(this.pcBuf.subarray(0, this.length));
      this.micBuf = micNext;
      this.pcBuf = pcNext;
    }
    this.micBuf.set(mic, this.length);
    if (pc && pc.length === len) this.pcBuf.set(pc, this.length);
    else if (pc) this.pcBuf.set(pc.subarray(0, Math.min(len, pc.length)), this.length);
    this.length += len;
  }

  /** A cut piece's own sound, by its start and length. */
  slice(start: number, len: number): { mic: Float32Array; pc: Float32Array } {
    const from = Math.round(start * this.rate) - this.emitted;
    const a = Math.max(0, Math.min(this.length, from));
    const b = Math.max(0, Math.min(this.length, from + len));
    return { mic: this.micBuf.slice(a, b), pc: this.pcBuf.slice(a, b) };
  }

  /** Sound before `before` seconds forgotten (its pieces are captured). */
  drop(before: number): void {
    const n = Math.max(0, Math.min(this.length, Math.round(before * this.rate) - this.emitted));
    if (!n) return;
    this.micBuf.copyWithin(0, n, this.length);
    this.pcBuf.copyWithin(0, n, this.length);
    this.length -= n;
    this.emitted += n;
  }
}

/**
 * Whether the microphone's level follows the PC's closely (r2 second round, 5 Nov 2026; lag-tolerant 6 Nov 2026,
 * m8-echo-doubles: a real speakers call doubled because the room delays the echo 5 to 60 ms, more on Bluetooth,
 * and the sample-aligned check read the shifted echo as "not an echo"): with speakers and no headset the
 * microphone hears the call, so its envelope tracks the PC's pauses. The 50 ms window levels correlate above 0.85
 * for an echo at some lag up to 300 ms; independent voices, or flat envelopes with nothing to follow, do not.
 */
export function envelopeFollows(mic: Float32Array, pc: Float32Array, rate = PIECE_RATE): boolean {
  const win = Math.max(1, Math.floor(rate * 0.05));
  const n = Math.floor(Math.min(mic.length, pc.length) / win);
  if (n < 4) return false;
  const mRms = new Float64Array(n);
  const pRms = new Float64Array(n);
  for (let w = 0; w < n; w++) {
    let m = 0;
    let p = 0;
    for (let i = w * win; i < (w + 1) * win; i++) {
      m += mic[i] * mic[i];
      p += pc[i] * pc[i];
    }
    mRms[w] = Math.sqrt(m / win);
    pRms[w] = Math.sqrt(p / win);
  }
  const corr = (lag: number): number => {
    const len = n - lag;
    if (len < 4) return -2;
    let mm = 0;
    let pm = 0;
    for (let i = 0; i < len; i++) {
      mm += mRms[lag + i];
      pm += pRms[i];
    }
    mm /= len;
    pm /= len;
    let cov = 0;
    let mv = 0;
    let pv = 0;
    for (let i = 0; i < len; i++) {
      const a = mRms[lag + i] - mm;
      const b = pRms[i] - pm;
      cov += a * b;
      mv += a * a;
      pv += b * b;
    }
    return mv <= 0 || pv <= 0 ? -2 : cov / Math.sqrt(mv * pv);
  };
  // The room's delay, in window steps (the microphone always lags the loopback, never leads it).
  const lags = Math.min(6, n - 4);
  for (let lag = 0; lag <= lags; lag++) if (corr(lag) > 0.85) return true;
  return false;
}

/** Below this loudness (RMS) a side is never sent (r3, 5 Nov 2026): the host drops anything quieter unheard
 *  (ns voice-talk.mjs QUIET_RMS, kept in step), so sending it would lose the words anyway. */
export const SEND_FLOOR = 0.002;
/** How long the PC must have been quiet before a microphone-only moment teaches their normal speech (m8-echo-doubles, 6
 *  Nov 2026): the room's echo tail outlives every pause by its delay (up to 300 ms on Bluetooth) and more. */
export const TAIL_SECONDS = 0.4;
/** The quietest a microphone-only moment may be and still teach their normal speech (m8-echo-doubles, 6 Nov 2026):
 *  louder than any spent tail, quieter than their voice even softly spoken. */
export const SPEECH_MIN = 0.02;

/**
 * A meeting's sound captured with its sides apart (r2, Nov 2026): the tap's microphone and PC blocks go in, pieces
 * with each side's own sound come out. Pieces are cut on the mix at the quietest moment (a word is never split) and
 * early when the other side starts talking; each side of a piece is judged on its loudest moments (r3: a piece's
 * average diluted a short answer, or an answer inside the other side's stretch, into silence), so labels follow the
 * side that talked. The window sends each voiced side to be written down.
 */
export class MeetingCapture {
  private readonly chunker: Chunker;
  private readonly sides: Sideband;
  private readonly micGate = new VoiceGate();
  private readonly pcGate = new VoiceGate();
  private readonly turns = new TurnTracker();
  private readonly rate: number;
  private hadPc = false;
  /** The microphone's normal speech (RMS), learnt from microphone-only moments: what their voice reaches. */
  private micSpeech = 0;
  /** How long the PC has been quiet (seconds): an echo tail must be spent before a moment may teach. */
  private pcSilentFor = 0;
  /** Samples taken in so far (both gates' history is counted in these). */
  private taken = 0;
  /** Each block's voice, in order: [first sample, past-the-end sample, mic voiced, pc voiced]. */
  private readonly heard: [number, number, boolean, boolean][] = [];
  /** The last block's voice, for the meters' watch (a microphone that never voices while the call talks). */
  lastVoiced = { mic: false, pc: false };

  constructor(opts: { rate?: number; seconds?: number; lookBack?: number } = {}) {
    this.rate = opts.rate ?? PIECE_RATE;
    this.chunker = new Chunker(opts);
    this.sides = new Sideband(opts);
  }

  /**
   * Whether the microphone in a moment is the room's echo of the call (r2 second round, 5 Nov 2026: without a
   * headset the microphone hears the speakers, which would double the words and the bill). While the PC holds
   * speech and the microphone is well below its normal speech (under half: echo at a quarter is caught, real
   * overlap at normal level is kept), or its level follows the PC's, the moment is Others only.
   */
  private isEcho(micRms: number, mic: Float32Array, pc: Float32Array): boolean {
    if (this.micSpeech > 0 && micRms < this.micSpeech * 0.5) return true;
    return envelopeFollows(mic, pc, this.rate);
  }

  /** Whether the block's microphone is echo (its voice belongs to the call, not to them). */
  private echoBlock(micActive: boolean, pcActive: boolean, micRms: number): boolean {
    return micActive && pcActive && this.micSpeech > 0 && micRms < this.micSpeech * 0.5;
  }

  /** Which sides hold speech in the samples [from, to): any block voiced (an echoing microphone excepted). */
  private spanVoiced(from: number, to: number): { mic: boolean; pc: boolean } {
    let mic = false;
    let pc = false;
    for (const [a, b, m, c] of this.heard) {
      if (b <= from || a >= to) continue;
      mic = mic || m;
      pc = pc || c;
      if (mic && pc) break;
    }
    return { mic, pc };
  }

  /** A cut piece's sides: its span's voice, the echo guard where both hold speech, nothing under the send floor. */
  private pieceSides(p: Piece): CapturedPiece {
    const seconds = p.samples.length / this.rate;
    const { mic: m, pc: c } = this.sides.slice(p.start, p.samples.length);
    const from = Math.round(p.start * this.rate);
    const span = this.spanVoiced(from, from + p.samples.length);
    let micVoiced = span.mic;
    // Heard only as echo until they speak alone (their normal speech unknown): the piece decides, as
    // before.
    const pcVoiced = this.hadPc && span.pc;
    if (micVoiced && pcVoiced && this.micSpeech <= 0 && this.isEcho(loudness(m), m, c)) micVoiced = false;
    const voiced: ('mic' | 'pc')[] = [];
    if (micVoiced && loudness(m) >= SEND_FLOOR) voiced.push('mic');
    if (pcVoiced && loudness(c) >= SEND_FLOOR) voiced.push('pc');
    this.sides.drop(p.start + seconds);
    while (this.heard.length && this.heard[0][1] <= from + p.samples.length) this.heard.shift();
    return { index: p.index, start: Math.round(p.start * 1000) / 1000, seconds: Math.round(seconds * 1000) / 1000, sides: voiced, mic: m, pc: this.hadPc ? c : null };
  }

  /** One tap block at the chunker's rate (the PC's null when it isn't recorded): the pieces cut so far. */
  block(mic: Float32Array, pc: Float32Array | null): CapturedPiece[] {
    const len = mic.length;
    const side = pc && pc.length === len ? pc : pc ? Float32Array.from({ length: len }, (_, i) => pc[i] ?? 0) : null;
    if (side) this.hadPc = true;
    const micRms = loudness(mic);
    const pcRms = side ? loudness(side) : 0;
    const micActive = this.micGate.feed(micRms);
    const pcActive = side ? this.pcGate.feed(pcRms) : false;
    this.pcSilentFor = pcActive ? 0 : this.pcSilentFor + len / this.rate;
    // Their normal speech, learnt only from a microphone-only moment well after the call paused
    // (m8-echo-doubles, 6 Nov 2026: the room answers every pause with the echo's tail — delayed, up to 300 ms
    // on Bluetooth — and learning their level from a tail sets it to the echo's, switching the level guard off
    // for the whole meeting while looking learnt). A tail is spent within 0.4 s and never reaches speech level;
    // their voice does both.
    if (micActive && this.pcSilentFor >= TAIL_SECONDS && micRms > SPEECH_MIN) this.micSpeech = Math.max(this.micSpeech, micRms);
    this.lastVoiced = { mic: micActive, pc: pcActive };
    this.heard.push([this.taken, this.taken + len, micActive && !this.echoBlock(micActive, pcActive, micRms), pcActive]);
    this.taken += len;
    const mixed = new Float32Array(len);
    for (let i = 0; i < len; i++) mixed[i] = Math.max(-1, Math.min(1, mic[i] + (side ? side[i] : 0)));
    const cut = this.chunker.push(mixed);
    // An echoing microphone does not hold the turn: the PC alone is talking (its echo would read as both).
    const micTurn = this.echoBlock(micActive, pcActive, micRms) ? false : micActive;
    if (this.hadPc && this.turns.feed(micTurn ? 0.1 : 0, pcActive ? 0.1 : 0, len / this.rate)) {
      const t = this.chunker.takeTurn();
      if (t) cut.push(t);
    }
    this.sides.push(mic, side);
    return cut.map((p) => this.pieceSides(p));
  }

  /** What is left after Stop, as the last piece (null: nothing worth keeping). */
  flush(): CapturedPiece | null {
    const p = this.chunker.flush();
    if (!p) return null;
    return this.pieceSides(p);
  }
}

/** The microphone hasn't heard a thing (a muted or dead microphone gives silence, a live one at least a faint hiss). */
export const MIC_DEAD = 0.0006;
/** How long the microphone may be silent before the recorder says so (seconds). */
export const MIC_SILENT_SECONDS = 6;
/** How long the call may talk without a voice from the microphone before the recorder says so (seconds). */
export const MIC_NOVOICE_SECONDS = 120;
/** The call must have talked this long in that time for it to mean anything (an empty room is not a dead microphone). */
export const MIC_NOVOICE_PC_SECONDS = 10;

/**
 * A microphone that hears but never voices (r3, 5 Nov 2026): a dead microphone whose levelled-up hiss reads above
 * MIC_DEAD never warned and never voiced, so the meeting stayed quietly empty. While the call talks, two minutes
 * with no voice from the microphone warns; their first words clear it. feed() each block's voice and length;
 * warned tells whether the warning stands.
 */
export class MicWatch {
  warned = false;
  private quietFor = 0;
  private pcTalk = 0;

  feed(micVoiced: boolean, pcVoiced: boolean, seconds: number): boolean {
    if (micVoiced) {
      this.quietFor = 0;
      this.pcTalk = 0;
      this.warned = false;
      return false;
    }
    this.quietFor += seconds;
    if (pcVoiced) this.pcTalk += seconds;
    if (!this.warned && this.quietFor >= MIC_NOVOICE_SECONDS && this.pcTalk >= MIC_NOVOICE_PC_SECONDS) this.warned = true;
    return this.warned;
  }
}
/** How long the PC's sound may be silent before its meter says so (seconds). Windows hands over only what its default
 *  speakers play: muted speakers, or a call on a headset that isn't the default, record nothing (found on Windows,
 *  25 Oct 2026). Only the meter says it — unless the speakers say a call is playing elsewhere (unheardCall), when the
 *  notice says it too: a meeting in a room has no PC sound, and that is fine. */
export const PC_SILENT_SECONDS = 30;

/**
 * A call playing where the recorder cannot hear (6 Nov 2026: a user lost the other people's words in a real
 * meeting) . Calls play through Windows' communications speakers; Chromium's loopback hears only the default
 * speakers. Chromium lists both as audiooutput entries with the device ids 'default' and 'communications', each
 * labelled "<role> - <speakers>". When the speakers behind the two names differ, a call there is lost: which are
 * recorded (`heard`) and which are missed (`missed`). Null when they match, when either is missing, or when the
 * labels are still hidden (until the microphone is given): never an alarm on what cannot be told — a meeting in a
 * room, with nothing amiss, stays quiet.
 */
export function unheardCall(outputs: readonly { deviceId: string; label: string }[]): { heard: string; missed: string } | null {
  const name = (id: string) => {
    const label = (outputs.find((d) => d.deviceId === id)?.label ?? '').trim();
    const dash = label.indexOf(' - ');
    return (dash >= 0 ? label.slice(dash + 3) : label).trim();
  };
  const heard = name('default');
  const missed = name('communications');
  if (!heard || !missed || heard.toLowerCase() === missed.toLowerCase()) return null;
  return { heard, missed };
}

/** The unheard call in one plain sentence with the way to fix it (the meter's fix, in the meter's words). */
export function unheardCallWords(heard: string, missed: string): string {
  return `Calls on this PC play on “${missed}” but only “${heard}” is recorded. If this meeting is a call on a headset, make it Windows’ default speaker (Settings › System › Sound) so the other side is recorded too.`;
}

// ── Hearing a call on any output, not just the Windows default ─────────────────────────────────────────────────────
// (6 Nov 2026, m6-any-speaker-capture: a user lost the other people's words in a real meeting. Chromium's loopback
// hears only the default speakers; m1 says so, this hears it.) While a meeting records, a contained native process
// captures the missed output's loopback too (WASAPI) and its sound is mixed into the far side here — the same pieces,
// the same echo and voice gate, the same billing. Pure, so the node tests run every rule with fake devices and fake
// samples; the native binary itself only loads on Windows.

/** One output endpoint as the native capture lists it (its id, its friendly name, whether it is the default). */
export interface NativeOutputDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

/** Device names as they compare: cased and spaced alike, inside and out. */
export function normalizeDeviceName(name: string): string {
  return String(name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The native endpoint behind the missed speakers' name: the exact one, else the one unmistakable substring match
 *  (Chromium and Windows do not always spell an endpoint the same). Nothing when it is ambiguous. */
export function matchNativeDevice(missed: string, natives: readonly NativeOutputDevice[]): NativeOutputDevice | null {
  const want = normalizeDeviceName(missed);
  if (!want) return null;
  const exact = natives.filter((n) => normalizeDeviceName(n.name) === want);
  if (exact.length > 1) return null;
  if (exact.length === 1) return exact[0];
  const sub = natives.filter((n) => {
    const name = normalizeDeviceName(n.name);
    return !!name && (name.includes(want) || want.includes(name));
  });
  return sub.length === 1 ? sub[0] : null;
}

/** Which endpoint the extra capture takes: the missed speakers when they name a native endpoint other than the
 *  default (the default is heard already — capturing it twice would double the words). Null when the default is
 *  right, when nothing is known, or when the name maps nowhere (the manager then probes for real sound). */
export function pickExtraDevice(
  outputs: readonly { deviceId: string; label: string }[],
  natives: readonly NativeOutputDevice[],
): NativeOutputDevice | null {
  const route = unheardCall(outputs);
  if (!route) return null;
  return matchNativeDevice(route.missed, natives.filter((n) => !n.isDefault));
}

/** Real sound, for the probe and the hearing watch: above digital silence, below any voice. */
export const EXTRA_HEARD_RMS = 0.003;

/** The probed endpoint with real sound: the loudest above the floor, else none. */
export function pickLoudest(levels: readonly { id: string; rms: number }[], floor = EXTRA_HEARD_RMS): string | null {
  let best: string | null = null;
  let bestRms = floor;
  for (const l of levels) {
    if (l && typeof l.rms === 'number' && Number.isFinite(l.rms) && l.rms > bestRms) {
      bestRms = l.rms;
      best = l.id;
    }
  }
  return best;
}

/** The extra sound mixed into the far side, in place: added and kept from clipping, over their shared length. */
export function mixExtraInto(pc: Float32Array, extra: Float32Array): void {
  const len = Math.min(pc.length, extra.length);
  for (let i = 0; i < len; i++) pc[i] = Math.max(-1, Math.min(1, pc[i] + extra[i]));
}

/** How far apart in time the two routes may run and still read as one call (each way). */
const SAME_LAG_SECONDS = 0.3;
/** The least sound each route holds to read as one call (their loudness each). */
const SAME_LOUD = 0.008;

/** Whether two stretches are one call heard twice: both loud, and alike through a lag either way (the two routes run
 *  on their own clocks). Silence, short stretches and two voices never are. */
export function sameSound(a: Float32Array, b: Float32Array, rate = PIECE_RATE): boolean {
  if (a.length < rate / 4 || b.length < rate / 4) return false;
  if (loudness(a) < SAME_LOUD || loudness(b) < SAME_LOUD) return false;
  const step = Math.floor(rate * 0.05);
  const maxLag = Math.floor(rate * SAME_LAG_SECONDS);
  const need = Math.floor(rate * 0.1);
  for (let lag = -maxLag; lag <= maxLag; lag += step) {
    const a0 = Math.max(0, lag);
    const b0 = Math.max(0, -lag);
    const len = Math.min(a.length - a0, b.length - b0);
    if (len < need) continue;
    let dot = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < len; i++) {
      const x = a[a0 + i];
      const y = b[b0 + i];
      dot += x * y;
      aa += x * x;
      bb += y * y;
    }
    if (aa <= 0 || bb <= 0) continue;
    if (dot / Math.sqrt(aa * bb) > 0.92) return true;
  }
  return false;
}

/** Takes of real sound in a row before the far side counts as heard (the notice then stays silent). */
const HEARD_TAKES = 3;
/** Takes of silence in a row before heard is taken back (a pause never is). */
const UNHEARD_TAKES = 12;
/** Takes reading as one call on both routes in a row before the extra drops itself (about two seconds). */
const SAME_TAKES = 20;

/** The extra capture's sound held for the far side: 16 kHz mono, as the child sends it, taken in blocks. Sound not
 *  yet arrived reads as silence (a quiet route never stalls the far side); more than held falls away from the front
 *  (the two routes run on their own clocks, and stale sound must never play). */
export class ExtraFeed {
  private chunks: Float32Array<ArrayBufferLike>[] = [];
  private length = 0;
  private readonly cap: number;
  private dxPast: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private refPast: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private voiced = 0;
  private unvoiced = 0;
  private same = 0;
  /** Real sound sustained lately (the m1 sentence then stays silent). */
  hearing = false;

  constructor(opts: { capSeconds?: number } = {}) {
    this.cap = Math.max(PIECE_RATE, Math.ceil(PIECE_RATE * (opts.capSeconds ?? 2)));
  }

  /** A chunk as the child sends it: 16-bit mono samples at the piece rate. */
  push(pcm: Uint8Array): void {
    const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const len = Math.floor(pcm.byteLength / 2);
    const f = new Float32Array(len);
    for (let i = 0; i < len; i++) f[i] = v.getInt16(i * 2, true) / 0x8000;
    this.chunks.push(f);
    this.length += len;
    while (this.length > this.cap && this.chunks.length) this.length -= this.chunks.shift()!.length;
  }

  /** A block of the extra sound, with whether the far side is heard and whether both routes hear one call (then the
   *  window stops the extra: words never double). `ref` is the Chromium far side taken at the same moment. */
  take(n: number, ref?: Float32Array | null): { samples: Float32Array; hearing: boolean; drop: boolean } {
    const out = new Float32Array(Math.max(0, Math.floor(n)));
    let at = 0;
    while (at < out.length && this.chunks.length) {
      const first = this.chunks[0];
      const takeN = Math.min(out.length - at, first.length);
      out.set(first.subarray(0, takeN), at);
      at += takeN;
      this.length -= takeN;
      this.chunks[0] = first.subarray(takeN);
      if (!this.chunks[0].length) this.chunks.shift();
    }
    if (loudness(out) > EXTRA_HEARD_RMS) {
      this.voiced++;
      this.unvoiced = 0;
    } else {
      this.unvoiced++;
      this.voiced = 0;
    }
    if (!this.hearing && this.voiced >= HEARD_TAKES) this.hearing = true;
    if (this.hearing && this.unvoiced >= UNHEARD_TAKES) this.hearing = false;
    let drop = false;
    if (ref && ref.length) {
      this.dxPast = ExtraFeed.remember(this.dxPast, out);
      this.refPast = ExtraFeed.remember(this.refPast, ref);
      if (this.dxPast.length >= PIECE_RATE && this.refPast.length >= PIECE_RATE) {
        if (sameSound(this.dxPast.subarray(this.dxPast.length - PIECE_RATE), this.refPast.subarray(this.refPast.length - PIECE_RATE))) this.same++;
        else this.same = 0;
        drop = this.same >= SAME_TAKES;
      }
    }
    return { samples: out, hearing: this.hearing, drop };
  }

  /** The sound forgotten (a pause ends: stale sound must never play into the meeting). */
  clear(): void {
    this.chunks = [];
    this.length = 0;
    this.dxPast = new Float32Array(0);
    this.refPast = new Float32Array(0);
    this.voiced = 0;
    this.unvoiced = 0;
    this.same = 0;
    this.hearing = false;
  }

  /** The last two seconds of a route, for the one-call judgement. */
  private static remember(past: Float32Array<ArrayBufferLike>, block: Float32Array<ArrayBufferLike>): Float32Array<ArrayBufferLike> {
    const keep = past.length + block.length > PIECE_RATE * 2 ? past.subarray(past.length + block.length - PIECE_RATE * 2) : past;
    const next = new Float32Array(keep.length + block.length);
    next.set(keep);
    next.set(block, keep.length);
    return next;
  }
}

// ── The job after Stop ───────────────────────────────────────────────────────────────────────────────────────────────

/** A piece of a recording as its job keeps it: where it is, who talked, and what became of it. */
export interface RecPiece {
  index: number;
  /** Seconds into the recording. */
  start: number;
  seconds: number;
  /** Which side this entry transcribes ('mic' is you, 'pc' the others); unset for one mixed entry (no PC sound, a
   *  crash tail, or a job from before the sides were kept). Both sides talking in one piece keeps two entries. */
  side?: 'mic' | 'pc';
  /** Who talked: You, Others, or a numbered voice ("Speaker 1") once the speakers are told apart (6 Nov 2026,
   *  src/shared/meeting-speakers.ts, an extra layer over these pieces). */
  who?: Who | `Speaker ${number}`;
  status: 'pending' | 'done' | 'failed' | 'quiet';
  text?: string;
  /** Words with their times in the piece, when the speech service gave them. */
  segments?: { start: number; text: string; speaker?: string }[];
  error?: string;
}

/** saving: the recording into the note; transcribing: the last pieces written down; notes: the summary, decisions and
 *  actions being made; done; error (the notes couldn't be made: the transcript and recording are kept). */
export type JobPhase = 'recording' | 'stopped' | 'saving' | 'transcribing' | 'settling' | 'notes' | 'done' | 'error';

/** A recording's job, as Ironleaf keeps it on disk until it is finished (src/main/meeting-recorder.ts). */
export interface RecJob {
  id: string;
  /** The notes folder it was recorded in (a PC may open more than one): offered again only there. */
  vault?: string;
  note: string;
  title: string;
  date: string;
  /** When it began (ISO). */
  began: string;
  mime: string;
  ext: string;
  sources: 'mic' | 'mic+pc';
  /** How long was recorded (ms), kept current while it records. */
  elapsedMs: number;
  phase: JobPhase;
  pieces: RecPiece[];
  /** The recording among the notes once saved (null: none, or sent to the Bin). */
  attachment?: string | null;
  /** The recording was sent to the Bin once the notes were made. */
  trashed?: boolean;
  /** The closing words (done) or what went wrong (error). */
  words?: string;
  /** Its speech on disk is interleaved stereo (the microphone and the PC's sound apart); unset: mono, as before. */
  stereo?: boolean;
  /** Speech kept on disk for it (seconds; filled in by the main side). */
  speechSeconds?: number;
  /** Bytes of the recording on disk (filled in by the main side). */
  audioBytes?: number;
  /** The names set on the meeting's voices so far ("spk1" → "Sam Okafor", 6 Nov 2026, speakers): kept current while
   *  it records, so a crash never loses a name already set. Voices themselves rebuild from the speech on disk. */
  speakers?: { names?: Record<string, string> };
  updated?: string;
}

export const JOB_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;

/** A job's record from disk (or the window) checked: null when it isn't one. */
export function cleanJob(raw: unknown): RecJob | null {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.id !== 'string' || !JOB_ID.test(r.id) || typeof r.note !== 'string' || !r.note || r.note.length > 1000) return null;
  const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
  const phases: JobPhase[] = ['recording', 'stopped', 'saving', 'transcribing', 'settling', 'notes', 'done', 'error'];
  const pieces: RecPiece[] = [];
  if (Array.isArray(r.pieces))
    for (const p of r.pieces.slice(0, 20_000)) {
      const x = p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
      if (!x || typeof x.index !== 'number' || typeof x.start !== 'number' || typeof x.seconds !== 'number') continue;
      const status = (['pending', 'done', 'failed', 'quiet'] as const).find((s) => s === x.status) ?? 'pending';
      const segments = Array.isArray(x.segments)
        ? x.segments
            .map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>) : null))
            .filter((s): s is Record<string, unknown> => !!s && typeof s.start === 'number' && typeof s.text === 'string')
            .slice(0, 400)
            .map((s) => ({ start: num(s.start), text: str(s.text, 4000), ...(typeof s.speaker === 'string' && s.speaker ? { speaker: s.speaker.slice(0, 40) } : {}) }))
        : undefined;
      // A numbered voice ("Speaker 1") survives like You and Others (6 Nov 2026, speakers); anything else is not a label.
      const who = x.who === 'You' || x.who === 'Others' || (typeof x.who === 'string' && /^Speaker [1-9]\d*$/.test(x.who)) ? (x.who as Who | `Speaker ${number}`) : undefined;
      pieces.push({
        index: Math.floor(num(x.index)),
        start: num(x.start),
        seconds: num(x.seconds),
        ...(x.side === 'mic' || x.side === 'pc' ? { side: x.side } : {}),
        ...(who ? { who } : {}),
        status,
        ...(typeof x.text === 'string' ? { text: x.text.slice(0, 50_000) } : {}),
        ...(segments?.length ? { segments } : {}),
        ...(typeof x.error === 'string' ? { error: x.error.slice(0, 400) } : {}),
      });
    }
  const keptSpeakers = cleanSpeakerNames(r.speakers);
  return {
    id: r.id,
    ...(typeof r.vault === 'string' && r.vault ? { vault: r.vault.slice(0, 1000) } : {}),
    note: r.note,
    title: str(r.title, 200, 'Meeting'),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) ? String(r.date) : '',
    began: str(r.began, 40, new Date(0).toISOString()),
    mime: str(r.mime, 80),
    ext: /^[a-z0-9]{2,5}$/.test(String(r.ext)) ? String(r.ext) : 'weba',
    sources: r.sources === 'mic+pc' ? 'mic+pc' : 'mic',
    elapsedMs: num(r.elapsedMs),
    phase: phases.find((p) => p === r.phase) ?? 'stopped',
    pieces,
    ...(typeof r.attachment === 'string' || r.attachment === null ? { attachment: r.attachment as string | null } : {}),
    ...(r.trashed === true ? { trashed: true } : {}),
    ...(r.stereo === true ? { stereo: true } : {}),
    ...(typeof r.words === 'string' ? { words: r.words.slice(0, 2000) } : {}),
    ...(typeof r.speechSeconds === 'number' ? { speechSeconds: num(r.speechSeconds) } : {}),
    ...(typeof r.audioBytes === 'number' ? { audioBytes: num(r.audioBytes) } : {}),
    ...(keptSpeakers ? { speakers: keptSpeakers } : {}),
    ...(typeof r.updated === 'string' ? { updated: r.updated.slice(0, 40) } : {}),
  };
}

/** A job's speaker names checked: voice ids to plain names (junk reads as none, never an error). */
function cleanSpeakerNames(raw: unknown): { names?: Record<string, string> } | null {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const names = r?.names && typeof r.names === 'object' && !Array.isArray(r.names) ? (r.names as Record<string, unknown>) : null;
  if (!names) return null;
  const out: Record<string, string> = {};
  for (const [id, name] of Object.entries(names)) {
    const t = typeof name === 'string' ? name.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    if (/^spk[1-9]\d*$/.test(id) && t) out[id] = t;
  }
  return Object.keys(out).length ? { names: out } : null;
}

/** Where the pieces end: the speech after this hasn't been cut into a piece yet (a recording that stopped mid-piece). */
export const piecesEnd = (pieces: readonly RecPiece[]) => pieces.reduce((end, p) => Math.max(end, p.start + p.seconds), 0);

/**
 * The speech after the last piece (what a crash left uncut) as new pieces of about PIECE_SECONDS, given how much speech
 * there is on disk. Nothing shorter than SHORTEST_SECONDS.
 */
export function tailPieces(pieces: readonly RecPiece[], speechSeconds: number, seconds = PIECE_SECONDS): RecPiece[] {
  const out: RecPiece[] = [];
  let at = piecesEnd(pieces);
  let index = pieces.reduce((n, p) => Math.max(n, p.index + 1), 0);
  while (speechSeconds - at >= SHORTEST_SECONDS) {
    const len = Math.min(seconds, speechSeconds - at);
    out.push({ index: index++, start: Math.round(at * 1000) / 1000, seconds: Math.round(len * 1000) / 1000, status: 'pending' });
    at += len;
  }
  return out;
}

/** Pieces still to be written down: those never sent, and (asked again) those that failed. */
export const piecesToDo = (pieces: readonly RecPiece[], retryFailed: boolean) => pieces.filter((p) => p.status === 'pending' || (retryFailed && p.status === 'failed'));

/** How much of the recording couldn't be written down (seconds): each moment once, however many sides it has entries for. */
export const missedSeconds = (pieces: readonly RecPiece[]) => [...new Map(pieces.filter((p) => p.status === 'failed').map((p) => [p.index, p.seconds])).values()].reduce((s, n) => s + n, 0);

/** "About 2 hours", "About 2 minutes", "About 40 seconds": how much couldn't be written down. */
export function missedWords(seconds: number): string {
  if (seconds < 1) return '';
  if (seconds < 90) return `About ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  if (seconds < 3000) {
    const m = Math.round(seconds / 60);
    return `About ${m} ${m === 1 ? 'minute' : 'minutes'}`;
  }
  const h = Math.max(1, Math.round(seconds / 3600));
  return `About ${h} ${h === 1 ? 'hour' : 'hours'}`;
}

// ── Which recording belongs to which note ────────────────────────────────────────────────────────────────────────────

type Owned = { id: string; note: string; began: string };

/** The recording a meeting note's panel shows: the one recording now, else its latest one still on screen. Only ever a
 *  recording made for this note (a deleted note's are forgotten; see jobsAfterRemove), so a new meeting made under a
 *  deleted one's name starts fresh. */
export function jobForNote<T extends Owned>(jobs: readonly T[], liveId: string | null, note: string): T | null {
  const mine = jobsForNote(jobs, note);
  return (liveId ? mine.find((j) => j.id === liveId) : undefined) ?? mine.at(-1) ?? null;
}

/** Every recording made for this note, oldest first (after two crashes both are offered, never only the latest). */
export function jobsForNote<T extends Owned>(jobs: readonly T[], note: string): T[] {
  return jobs.filter((j) => j.note === note).sort((a, b) => a.began.localeCompare(b.began));
}

/** A note (or a folder of notes) deleted: the recordings that went with it, and those kept. */
export function jobsAfterRemove<T extends { note: string }>(jobs: readonly T[], removed: string): { kept: T[]; gone: T[] } {
  return { kept: jobs.filter((j) => !goneWith(j.note, removed)), gone: jobs.filter((j) => goneWith(j.note, removed)) };
}

/** A note (or a folder of notes) renamed or moved: its recordings go with it. */
export function jobsAfterMove<T extends { note: string }>(jobs: readonly T[], from: string, to: string): T[] {
  return jobs.map((j) => (movedPath(j.note, from, to) === j.note ? j : { ...j, note: movedPath(j.note, from, to) }));
}

// ── The transcript ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface TranscriptLine {
  /** Seconds into the recording. */
  at: number;
  text: string;
  /** Who said it, when known: You, Others, or a speaker the service named. */
  who?: string;
}

/** A speaker named by the speech service ("speaker_0", "A", "Speaker 2") in the transcript's words: "Speaker 1". */
function speakerWords(s: string): string {
  const n = /(\d+)\s*$/.exec(s);
  if (n) return `Speaker ${Number(n[1]) + (/_\d+$/.test(s) ? 1 : 0)}`;
  const l = /^([A-Z])$/i.exec(s.trim());
  return l ? `Speaker ${l[1].toUpperCase().charCodeAt(0) - 64}` : s.trim().slice(0, 30);
}

/**
 * Whether two answers say the same words nearly exactly (m8-echo-doubles, 6 Nov 2026): cased and punctuated alike,
 * near the same length, eight in ten characters the same. A misheard word or two aside (the echo's clip is the
 * rougher sound, so its answer drifts), anything said longer or said different is not the same. Compared over the
 * same seconds only — never a gate on what may be said.
 */
/** Every number a line states, in order, the same in digits and in words ("4,200" and "four thousand two
 *  hundred" are one figure, "twenty-third" and "23rd" are one date). A stated figure is never a mishearing
 *  to forgive (break-it finding 8, 6 Nov 2026: a corrected $4,300 was dropped as an echo of $4,200). */
function statedNumbers(s: string): number[] {
  const small: Record<string, number> = { zero: 0, one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10, eleven: 11, eleventh: 11, twelve: 12, twelfth: 12, thirteen: 13, thirteenth: 13, fourteen: 14, fourteenth: 14, fifteen: 15, fifteenth: 15, sixteen: 16, sixteenth: 16, seventeen: 17, seventeenth: 17, eighteen: 18, eighteenth: 18, nineteen: 19, nineteenth: 19, twenty: 20, twentieth: 20, thirty: 30, thirtieth: 30, forty: 40, fortieth: 40, fifty: 50, fiftieth: 50, sixty: 60, sixtieth: 60, seventy: 70, seventieth: 70, eighty: 80, eightieth: 80, ninety: 90, ninetieth: 90 };
  const scale: Record<string, number> = { thousand: 1e3, thousandth: 1e3, million: 1e6, millionth: 1e6, billion: 1e9, billionth: 1e9 };
  const tokens = String(s ?? '').toLowerCase().replace(/-/g, ' ').match(/\d[\d,]*(?:\.\d+)?|[a-z]+/g) ?? [];
  const out: number[] = [];
  let group = -1; // the words of one figure gather here (-1: no figure under way)
  let whole = 0;
  let frac = '';
  let dec = false;
  const flush = () => { if (group >= 0) out.push(Number(`${whole + group}${dec ? `.${frac}` : ''}`)); group = -1; whole = 0; frac = ''; dec = false; };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^\d/.test(t)) { const [w, f] = t.replace(/,/g, '').split('.'); if (dec) { frac += w; group = Math.max(group, 0); } else if (group >= 0 || whole > 0) { group = Math.max(group, 0) + Number(w); if (f !== undefined) { dec = true; frac = f; } } else { group = Number(w); if (f !== undefined) { dec = true; frac = f; } } continue; }
    if (t === 'point' && group >= 0) { dec = true; continue; }
    if (t === 'hundred' || t === 'hundredth') { group = (group > 0 ? group : 1) * 100; continue; }
    if (t in scale) { whole += (group > 0 ? group : 1) * scale[t]; group = 0; continue; }
    if (t in small) { if (dec) frac += String(small[t]); else group = Math.max(group, 0) + small[t]; continue; }
    if ((t === 'a' || t === 'an') && (tokens[i + 1] === 'hundred' || tokens[i + 1] in scale)) { group = 1; continue; }
    if (t === 'and' && group >= 0 && (tokens[i + 1] in small || tokens[i + 1] === 'hundred')) continue;
    flush();
  }
  flush();
  return out;
}

export function sameWords(a: string, b: string): boolean {
  // A differing figure is a differing statement, in digits or in words, however near the rest reads.
  const na = statedNumbers(a);
  const nb = statedNumbers(b);
  if (na.length !== nb.length || na.some((n, i) => n !== nb[i])) return false;
  const clean = (s: string) => String(s ?? '').toLowerCase().replace(/-/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const x = clean(a);
  const y = clean(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) / Math.max(x.length, y.length) < 0.8) return false;
  // How many characters differ (one row held; answers are short).
  const [s, t] = x.length <= y.length ? [x, y] : [y, x];
  const row: number[] = s.split('').map((_, i) => i + 1);
  for (let j = 0; j < t.length; j++) {
    let diag = j;
    let left = j + 1;
    for (let i = 0; i < s.length; i++) {
      const above = row[i];
      const cell = Math.min(above + 1, left + 1, diag + (s[i] === t[j] ? 0 : 1));
      diag = above;
      left = cell;
      row[i] = cell;
    }
  }
  return 1 - (row.length ? row[row.length - 1] : t.length) / t.length >= 0.8;
}

/** A You side whose words are the Others side's same-moment words nearly exactly is the gate's mistake, not their
 *  words (m8-echo-doubles, 6 Nov 2026): its lines are dropped and the Others lines stand, so a doubled send never
 *  shows as doubled lines. Real overlap says different words and stands. */
function doubledYou(parts: readonly RecPiece[]): Set<RecPiece> {
  const isMic = (p: RecPiece) => p.side === 'mic' || (!p.side && p.who === 'You');
  const isPc = (p: RecPiece) => p.side === 'pc' || (!p.side && p.who === 'Others');
  const wordsOf = (p: RecPiece) => {
    const segs = (p.segments ?? []).filter((s) => s.text.trim());
    return segs.length ? segs.map((s) => s.text).join(' ') : (p.text ?? '');
  };
  // When both sides carry their word times, an echo starts at nearly the same moment. Further apart, each side
  // really said it, short acknowledgements above all ("Yeah sounds good" on both sides, finding 8), so both lines
  // stand. The allowance is seconds, not the room's own 0.3 s lag: these times come from two separate
  // transcriptions of the same piece, and each finds its first word in its own rough way, so a tight limit would
  // let true echoes through and double the call on laptop speakers. No times on a side: the words alone decide.
  const ECHO_START_SECONDS = 2;
  const saidAt = (p: RecPiece) => {
    const segs = (p.segments ?? []).filter((s) => s.text.trim());
    return segs.length ? p.start + Math.max(0, segs[0].start) : null;
  };
  const out = new Set<RecPiece>();
  for (const m of parts) {
    if (m.status !== 'done' || !isMic(m)) continue;
    const o = parts.find((p) => p !== m && p.status === 'done' && p.index === m.index && isPc(p));
    if (!o || !sameWords(wordsOf(m), wordsOf(o))) continue;
    const mAt = saidAt(m);
    const oAt = saidAt(o);
    if (mAt !== null && oAt !== null && Math.abs(mAt - oAt) > ECHO_START_SECONDS) continue;
    out.add(m);
  }
  return out;
}

/** The pieces put back in order as timed lines (a piece's own times when given, else one line at its start), each with
 *  who talked when it is known. Lines one after another from the same person within a piece are kept apart (each has its
 *  own time to play from). Lines read in time order across both sides (18 Nov 2026, t301: one piece's microphone
 *  lines all read before its PC lines however the turns timed them, so an answer read before its question); lines
 *  at the same moment keep side order (you, then the others). */
export function mergeTranscript(parts: readonly RecPiece[]): TranscriptLine[] {
  const sideOrder = (p: RecPiece) => (p.side === 'mic' ? 0 : p.side === 'pc' ? 1 : 2);
  const dropped = doubledYou(parts);
  const out: TranscriptLine[] = [];
  for (const p of [...parts].sort((a, b) => a.index - b.index || sideOrder(a) - sideOrder(b))) {
    if (p.status !== 'done' || dropped.has(p)) continue;
    const segs = (p.segments ?? []).filter((s) => s.text.trim());
    if (segs.length)
      for (const s of segs) {
        const who = s.speaker ? speakerWords(s.speaker) : p.who;
        out.push({ at: Math.round((p.start + Math.max(0, s.start)) * 10) / 10, text: s.text.replace(/\s+/g, ' ').trim(), ...(who ? { who } : {}) });
      }
    else if (p.text?.trim()) out.push({ at: Math.round(p.start * 10) / 10, text: p.text.replace(/\s+/g, ' ').trim(), ...(p.who ? { who: p.who } : {}) });
  }
  // Time order across the sides (a stable sort: the same moment keeps the side order above).
  out.sort((a, b) => a.at - b.at);
  return out;
}

/** "12:03" for a line's time. */
export const stamp = (seconds: number) => clockWords(seconds * 1000);

/** The transcript as the assistant reads it: one timed line each, with who said it. */
export function transcriptText(lines: readonly TranscriptLine[]): string {
  return lines.map((l) => `[${stamp(l.at)}]${l.who ? ` ${l.who}:` : ''} ${l.text}`).join('\n');
}

/** The most transcript sent in one ask (a small model's context fits it with room for the ask and answer). */
export const TRANSCRIPT_CHUNK_CHARS = 60_000;

/** A transcript in asks that fit: whole lines, none lost, none twice. One piece when it already fits. */
export function chunkTranscript(transcript: string, max = TRANSCRIPT_CHUNK_CHARS): string[] {
  if (transcript.length <= max) return [transcript];
  const out: string[] = [];
  let cur = '';
  for (const line of transcript.split('\n')) {
    if (cur && cur.length + 1 + line.length > max) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

// ── The recording file ───────────────────────────────────────────────────────────────────────────────────────────────

/** The first kind of recording this PC's Chromium can make, as [type, the file's ending]: AAC in .m4a where it can (any
 *  player on any PC or phone opens it; Windows always can), else Opus in WebM (.weba). Never "audio/mp4" without a codec
 *  named: Chromium fills that with Opus, which most players can't open from an .m4a. */
export function pickRecordingType(isTypeSupported: (type: string) => boolean): { mime: string; ext: string } {
  const choices: [string, string][] = [
    ['audio/mp4;codecs=mp4a.40.2', 'm4a'],
    ['audio/webm;codecs=opus', 'weba'],
    ['audio/webm', 'weba'],
  ];
  for (const [mime, ext] of choices) {
    try {
      if (isTypeSupported(mime)) return { mime, ext };
    } catch {
      // Not this one.
    }
  }
  return { mime: '', ext: 'weba' };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The recording's file name: "Recording – Supplier call 2026-10-21 14.05.m4a" (nothing a file name can't hold, and
 *  no trailing dot or space: a title ending in a full stop keeps its recording playable on Windows, r2 Nov 2026). */
export function recordingName(title: string, at: Date, ext: string): string {
  const clean = title.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 60) || 'Meeting';
  return `Recording – ${clean} ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}.${ext}`;
}

/** Filler dropped from a title's hints (articles and the like); names and content words stay. */
const HINT_FILLER = new Set(['a', 'an', 'the', 'of', 'to', 'for', 'on', 'at', 'in', 'and', 'or', 'vs', 'with', 'from', 'by']);

/**
 * The meeting's own names as hints for the hearing service (r2, Nov 2026: "breakout" for "blackout", "ADM" for the
 * product's name): the attendees first, then the project, then the title's own words — each once however cased, a
 * title word left out when an attendee or the project already says it, capped for the prompt.
 */
export function transcribeHints(opts: { title?: string; people?: readonly string[]; project?: string }): string[] {
  const clean = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const out: string[] = [];
  const seen = new Set<string>();
  const keep = (v: string) => {
    const low = v.toLowerCase();
    if (!v || seen.has(low)) return;
    seen.add(low);
    out.push(v);
  };
  for (const p of opts.people ?? []) keep(clean(p));
  keep(clean(opts.project));
  const covered = (w: string) => [...seen].some((s) => s === w || (s.includes(' ') && s.split(' ').includes(w)));
  for (const w of clean(opts.title).split(/[\s,;:!?()[\]{}"“”‘’]+/).filter(Boolean)) {
    const low = w.toLowerCase();
    if (low.length < 3 && !/\d/.test(low)) continue;
    if (HINT_FILLER.has(low)) continue;
    if (covered(low)) continue;
    keep(w);
  }
  return out.slice(0, 40);
}

/**
 * A transcribed piece in English only (18 Nov 2026, t301: the product transcribes English, yet a Teams call kept
 * a Mandarin fragment in the transcript). Runs in another script (Han, Hiragana, Arabic, Cyrillic and the rest)
 * are dropped; Latin, figures and punctuation stay, and a hint word stays whole however written (a person's name
 * is known truth, never scrubbed). Empty when nothing English was said — the caller writes that as [inaudible].
 * Every piece's text and segments go through this, live and final alike.
 */
export function englishOnly(text: string, hints: readonly string[] = []): string {
  const heard = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!heard) return heard;
  const keep = new Set((hints ?? []).flatMap((h) => String(h ?? '').toLowerCase().split(/\s+/)).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean));
  const out = heard
    .split(/(\s+)/)
    .map((tok) => {
      if (!tok || /^\s+$/.test(tok)) return tok;
      if (keep.size && keep.has(tok.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))) return tok;
      return tok.replace(/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]+/gu, '');
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  // No Latin letter or figure left: the line was all another script (its stray punctuation aside) — unless
  // a hint word survived it (kept whole above, known truth however written).
  const keptWord = (t: string) => keep.size > 0 && keep.has(t.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
  return /[\p{Script=Latin}0-9]/u.test(out) || out.split(/\s+/).some(keptWord) ? out : '';
}

/**
 * The meeting hint's echo cut out of a transcribed piece (12 Nov 2026, the live 1-2-1: the hint read back as
 * speech on quiet audio, and "Names and words to know: 2026-11-12, meeting, Jesse, …" sat in the transcript as
 * their own line). The same two shapes as the former host app's own scrub (which cuts what its services return;
 * this cuts what the meeting keeps, so a misbehaving transcriber can never put the hint in the transcript
 * either): the hint's old lead sentence with its list, and three or more of the hint's names in the hint's
 * order. One or two names said for real are always kept. Every piece's text and segments go through this, live
 * and final alike.
 */
export function scrubHintEcho(text: string, hints: readonly string[]): string {
  const heard = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!heard) return heard;
  const names = [...new Set((hints ?? []).map((h) => String(h ?? '').trim()).filter(Boolean))].slice(0, 40);
  if (!names.length) return heard;
  const fold = (w: string) => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = heard.split(/\s+/);
  const folded = words.map((w) => fold(w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')));
  const drop = new Array(words.length).fill(false);
  const vocab = new Set(names.flatMap((n) => fold(n).split(/[^\p{L}\p{N}']+/u).filter(Boolean)));
  // Whether a heard word is all hint words ('2026-11-12' is three of them; a plain word is one).
  const wordHinted = (w: string): boolean => {
    const parts = fold(w).split(/[^\p{L}\p{N}']+/u).filter(Boolean);
    return parts.length > 0 && parts.every((p) => vocab.has(p));
  };
  // The old lead sentence, with the run of hint words after it (nobody says it for real; the run ends with its
  // sentence, or at the first word that isn't ours).
  const LEAD = ['names', 'and', 'words', 'to', 'know'];
  const at = folded.findIndex((_, i) => LEAD.every((w, k) => folded[i + k] === w));
  if (at >= 0) {
    for (let i = at; i < at + LEAD.length; i++) drop[i] = true;
    for (let i = at + LEAD.length; i < words.length && wordHinted(words[i]); i++) {
      drop[i] = true;
      if (/[.?!:]$/.test(words[i])) break;
    }
  }
  // Three or more hint names in hint order (each matched whole; "and"/"&" between names skipped). A sentence
  // rarely lists three hint names in hint order; an echo always does.
  const hinted = names.map((n) => fold(n).split(/[^\p{L}\p{N}']+/u).filter(Boolean)).filter((n) => n.length);
  // Heard words as matchable tokens (a dashed word as its parts: '2026-11-12' is three), each knowing its word,
  // so a matched span drops whole words.
  const toks: { w: number; t: string }[] = [];
  words.forEach((w, i) => {
    for (const t of fold(w).split(/[^\p{L}\p{N}']+/u).filter(Boolean)) toks.push({ w: i, t });
  });
  const skip = new Set(['and', '&']);
  const matchAt = (from: number, parts: string[]): number => {
    let p = from;
    for (const x of parts) {
      if (!toks[p] || toks[p].t !== x) return -1;
      p++;
    }
    return p;
  };
  for (let i = 0; i < toks.length; i++) {
    if (drop[toks[i].w]) continue;
    for (let h = 0; h < hinted.length; h++) {
      let p = matchAt(i, hinted[h]);
      if (p < 0) continue;
      let count = 1;
      let end = p;
      for (let k = h + 1; k < hinted.length; k++) {
        while (p < toks.length && (skip.has(toks[p].t) || drop[toks[p].w])) p++;
        const next = matchAt(p, hinted[k]);
        if (next < 0) break;
        count++;
        end = next;
        p = next;
      }
      if (count >= 3) for (let k = toks[i].w; k <= toks[end - 1].w; k++) drop[k] = true;
      break;
    }
  }
  if (!drop.some(Boolean)) return heard;
  return words
    .filter((_, i) => !drop[i])
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:–—-]+/, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

/** Settings › Meeting recordings: what happens to the recording once the notes are made. */
export type AfterNotes = 'delete' | 'keep';

/**
 * What happens to the recording: kept when the person keeps recordings, and always when the notes weren't made or part
 * of it couldn't be written down (the sound is all there is then). Otherwise it goes to the Bin.
 */
export function recordingFate(setting: AfterNotes, notesMade: boolean, missed = 0): 'keep' | 'trash' {
  return setting === 'keep' || !notesMade || missed > 0 ? 'keep' : 'trash';
}

/** Why the microphone couldn't be had, in words a person can act on (a DOMException's name). */
export function micWords(name: string, message = ''): string {
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Ironleaf wasn’t allowed to use the microphone. In Windows, open Settings › Privacy & security › Microphone, turn on “Let desktop apps access your microphone”, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Plug one in (or a headset), or choose another in the list, then try again.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The microphone is busy in another app, or Windows couldn’t start it. Close the other app (or choose another microphone), then try again.';
  return `The recording couldn’t start${message ? `: ${message}` : '.'}`;
}

/** Why the PC's sound couldn't be had, in words (a DOMException's name). The microphone records on either way. */
export function pcSoundWords(name: string): string {
  if (name === 'NotAllowedError') return 'Windows didn’t let Ironleaf hear the PC’s sound, so only your microphone is being recorded.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The PC’s sound couldn’t be opened (Windows has no speakers or headphones turned on), so only your microphone is being recorded.';
  return 'The PC’s sound couldn’t be recorded, so only your microphone is.';
}

// ── Sending pieces together (6 Nov 2026, m5-live-words-lag) ────────────────────────────────────────────────────────────
// A real run on the test laptop (first words 33–58 s after Record, speech only to ~0:33 written at 204 s, ~4.5 min
// after Stop): every piece queued one at a time while a meeting with both sides sends two clips a piece at ~15.7 s
// each, so the line falls behind from the first piece and Stop waits for the backlog unseen. Pieces now go together,
// up to SEND_SLOTS at once: both sides of one piece never queue behind each other, and one slow answer never stalls
// the line. The same work asked twice while it flies goes once (a piece is never sent twice).
//
// Pure: no DOM, no Electron, so the node tests run every rule here.

/** How many pieces are written down at once: both sides of one piece, with room for the next, so one slow answer
 *  never stalls the line. Three slots at ~15.7 s a clip keep up with two clips cut every 20 s. */
export const SEND_SLOTS = 3;

/**
 * Sends work together, up to `slots` at once, first asked first. send() for a key already flying shares its one
 * request (never sent twice); drain() settles when nothing flies or waits (asked while it waits joins the wait); a
 * failure settles like any answer, freeing its slot for the next. Each job keeps its own gate.
 */
export class SendGate {
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly flying = new Map<string, Promise<unknown>>();

  constructor(private readonly slots = SEND_SLOTS) {}

  /** How many pieces are going or waiting now. */
  get inFlight(): number {
    return this.flying.size;
  }

  send<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const dup = this.flying.get(key);
    if (dup) return dup as Promise<T>;
    const p = (async (): Promise<T> => {
      if (this.running >= this.slots) await new Promise<void>((ok) => this.waiting.push(ok));
      this.running++;
      try {
        return await fn();
      } finally {
        this.running--;
        this.flying.delete(key);
        this.waiting.shift()?.();
      }
    })();
    this.flying.set(key, p);
    // The gate's own hold on it never reads as unhandled; the caller still sees the failure.
    p.catch(() => undefined);
    return p;
  }

  /** Settles when nothing flies or waits. */
  async drain(): Promise<void> {
    while (this.flying.size) await Promise.allSettled([...this.flying.values()]);
  }
}

/** How many pieces may wait unwritten before the recorder says writing down is behind (about a minute of meeting). */
export const BEHIND_PIECES = 4;
/** How long one piece may wait unwritten before the recorder says so (seconds). */
export const BEHIND_SECONDS = 45;

/** Whether writing down runs behind: pieces piling up, or one piece waiting long. Said once, kept until caught up. */
export function isBehind(pending: number, oldestWaitSec: number): boolean {
  return pending >= BEHIND_PIECES || oldestWaitSec >= BEHIND_SECONDS;
}

/** One calm line when writing down runs behind: it catches up after Stop, and the recording is safe. */
export function behindWords(): string {
  return 'Writing down is running behind the meeting. It will catch up after you stop. The recording is safe.';
}

// ── Surviving anything (5 Nov 2026, s2-recorder-survives) ─────────────────────────────────────────────────────────────

/** What kind of failure writing a piece down met: offline (try again when the network returns), a refused key or an
 *  empty account (the person checks it, then Try again), or anything else. */
export type TranscribeErrorKind = 'offline' | 'auth' | 'other';

/** A failure told apart by its code or its words (a code wins; the words catch what arrives without one). */
export function transcribeErrorKind(message: string, code: string): TranscribeErrorKind {
  if (/^(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|ENOTFOUND|EPIPE|ENETUNREACH|EHOSTUNREACH)$/.test(code)) return 'offline';
  const words = `${message} ${code}`.toLowerCase();
  if (/fetch failed|network|econnrefused|enotfound|econnreset|etimedout|eai_again|enotconnected|offline|timed? ?out|502|503|504/.test(words) && !/key|quota|credit|billing|401|403|429|unauthor|forbidden/.test(words)) return 'offline';
  if (/401|403|429|unauthor|forbidden|api[_-]?key|incorrect.*key|invalid.*key|did not accept the key|quota|credit|billing|plan|payment|insufficient|expired|revoked|rate[- ]limit/.test(words)) return 'auth';
  if (/couldn’t be reached|took too long to answer/.test(message)) return 'offline';
  return 'other';
}

/** A provider's refusal in plain words with what to do (its key fragments never reach the screen). */
export function transcribeAuthWords(): string {
  return 'The speech service didn’t accept the key or has no credit left. Check it in Settings › AI, then press Try again. The recording carries on.';
}

/** Key fragments scrubbed from a provider's words (a refusal must never put a secret on screen). */
export function scrubTranscribeError(words: string): string {
  return words
    .replace(/\bsk-[A-Za-z0-9_-]+/g, 'the key')
    .replace(/\b(api[_-]?key\s*[:=]\s*)[^\s.,;]+/gi, '$1[hidden]')
    .replace(/\bearer\s+[A-Za-z0-9._-]+/gi, 'bearer [hidden]');
}

/** Whether a disk write failed because the PC is out of space (by code or by message, read lower-cased as one). */
export function isDiskFull(err: unknown): boolean {
  const code = typeof (err as { code?: unknown })?.code === 'string' ? String((err as { code: string }).code) : '';
  const words = `${err instanceof Error ? err.message : String(err ?? '')} ${code}`.toLowerCase();
  return /enospc|no space left|no space on|disk full|not enough space/.test(words);
}

/** A full disk in plain words: what to do, and that the recording carries on in memory meanwhile. */
export function diskFullWords(): string {
  return 'This PC is running out of space. Free some space, then press Try again. The recording carries on in memory meanwhile: keep Ironleaf open until you stop.';
}

/** Whether an answer is very short for its length (a twenty-second piece with two words is short; one word for two
 *  seconds is fine). Short answers are always kept in the transcript (5 Nov 2026, s2-recorder-survives second round:
 *  "Okay" in an 18-second far-side piece is true and complete): never failed, never paused, never retried. Counted
 *  quietly at the end only (hasManyShortOthers). */
export function isThin(text: string, seconds: number): boolean {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return words < Math.max(1, Math.ceil(Math.max(0, seconds) / 5));
}

/** Whether a good share of the other side's pieces came back very short: at least eight done far-side pieces, three
 *  quarters or more very short without timings (a real meeting has dozens of short answers, so most must be short
 *  before the card says words may be missing; never mid-meeting, never resent). Numbered voices on the PC side count
 *  as the other side (6 Nov 2026, speakers); a room's voices (no side) are nobody's "other side". */
export function hasManyShortOthers(pieces: readonly RecPiece[]): boolean {
  const others = pieces.filter((p) => p.status === 'done' && (p.who === 'Others' || (p.side === 'pc' && !!p.who && /^Speaker [1-9]\d*$/.test(p.who))));
  if (others.length < 8) return false;
  const short = others.filter((p) => !p.segments?.length && isThin(p.text ?? '', p.seconds)).length;
  return short * 4 >= others.length * 3;
}

/** One calm line when many of the other side's pieces came back very short: some words may be missing, kept anyway. */
export function otherSideShortWords(): string {
  return 'Some of the other side’s words may be missing. The recording is kept in the note.';
}

/** Stretches that couldn't be written down as lines for the transcript, each with its moment to play from (neighbouring
 *  failures join into one stretch; each span counts once however many sides it has entries for, and says whose words
 *  are missing when the other side came through). The note says that part needs another pass; the saved recording is
 *  enough to do it. */
export function gapLines(pieces: readonly RecPiece[]): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  const byIndex = new Map<number, RecPiece[]>();
  for (const p of pieces) {
    const list = byIndex.get(p.index) ?? [];
    list.push(p);
    byIndex.set(p.index, list);
  }
  /** Which side a span still misses: both (or unknown), theirs, or the other side's. */
  const missingOf = (span: RecPiece[]): 'both' | 'mic' | 'pc' => {
    const failed = span.filter((p) => p.status === 'failed');
    if (!failed.length) return 'both';
    const sideOf = (p: RecPiece): 'mic' | 'pc' | null => (p.side === 'mic' || p.side === 'pc' ? p.side : p.who === 'You' ? 'mic' : p.who === 'Others' ? 'pc' : null);
    const sides = new Set(failed.map(sideOf));
    if (sides.size !== 1) return 'both';
    const side = [...sides][0];
    // Named only when the other side came through (its words, or quiet because nothing was said there).
    if (side && span.some((p) => (p.status === 'done' || p.status === 'quiet') && sideOf(p) !== side)) return side;
    return 'both';
  };
  const ordered = [...byIndex.entries()].sort((a, b) => a[0] - b[0]);
  let at = 0;
  let seconds = 0;
  let missing: 'both' | 'mic' | 'pc' = 'both';
  const flush = () => {
    if (!seconds) return;
    const whose = missing === 'mic' ? ' of your words' : missing === 'pc' ? ' of the other side’s words' : '';
    out.push({ at: Math.round(at * 10) / 10, text: `${missedWords(seconds)}${whose} couldn’t be written down yet. Press Try again in the card above.` });
    seconds = 0;
  };
  for (const [, span] of ordered) {
    const failed = span.filter((p) => p.status === 'failed');
    const miss = failed.length ? missingOf(span) : 'both';
    if (!failed.length || (seconds && miss !== missing)) flush();
    if (!failed.length) continue;
    if (!seconds) {
      at = Math.min(...span.map((p) => p.start));
      missing = miss;
    }
    seconds += Math.max(...span.map((p) => p.seconds));
  }
  flush();
  return out;
}
