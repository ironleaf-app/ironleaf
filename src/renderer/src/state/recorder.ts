// The meeting recorder in the window (21 Oct 2026, gap G18; rebuilt 22 Oct 2026 after on Windows). The rules are
// src/shared/recorder.ts and src/shared/meeting-notes.ts, the main side src/main/meeting-recorder.ts. One LIVE recording
// at a time, kept here rather than in a page, so it carries on while the person moves to another note or tab (a small
// pill says it is still going, components/RecordingPill.tsx). Each recording is a JOB that belongs to its meeting note by
// the job's own id, not only by the note's name: deleting the note stops its recording (the sound goes to Recently
// deleted) and forgets its job, renaming or moving it takes the job along, and a new meeting made under the same name
// starts with a fresh recorder. The sound: the microphone (the one chosen in the card, else the PC's default), and on
// Windows the PC's own sound too (the other side of a Teams, Zoom or browser call; Chromium's loopback,
// src/main/meeting-recorder.ts). Both are written to disk as they come (the recording as Chromium encodes it, AAC in .m4a
// on Windows, and 16 kHz speech), so a crash loses seconds at most and the next start offers to finish it. The speech is
// cut into pieces of about twenty seconds as it comes (an AudioWorklet hands its samples here, each source apart) and
// each piece is written down by the former host app as soon as it is ready, with who talked (you, or the others on the
// call). After Stop: the recording saved into the note first (nothing is lost whatever happens next), the rest written
// down, the notes made, the note written; whatever fails says so in plain words with a way to try again.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { notesOfType } from '../../../shared/note-types';
import { applyMeetingNotes, dropTranscriptPart, fillVoiceOwners, notesWords, readTranscript, type MeetingNotes } from '../../../shared/meeting-notes';
import { notePeople } from '../../../shared/meetings';
import {
  behindWords,
  cleanJob,
  diskFullWords,
  downsample,
  encodeWav,
  ExtraFeed,
  fromPcm16,
  gapLines,
  goneWith,
  hasManyShortOthers,
  IDLE,
  isBehind,
  isDiskFull,
  jobForNote,
  jobsAfterMove,
  jobsAfterRemove,
  isBusy,
  lengthWords,
  loudness,
  MeetingCapture,
  mergeTranscript,
  MIC_DEAD,
  MIC_SILENT_SECONDS,
  MicWatch,
  mixExtraInto,
  PC_SILENT_SECONDS,
  micWords,
  missedSeconds,
  missedWords,
  movedPath,
  otherSideShortWords,
  pcSoundWords,
  pickRecordingType,
  PIECE_RATE,
  piecesToDo,
  recElapsed,
  recordingFate,
  recordingName,
  recStep,
  SEND_FLOOR,
  SEND_SLOTS,
  SendGate,
  stamp,
  tailPieces,
  toPcm16,
  toPcm16Stereo,
  transcribeErrorKind,
  transcribeHints,
  transcriptText,
  unheardCall,
  unheardCallWords,
  type CapturedPiece,
  type RecEvent,
  type RecJob,
  type RecPiece,
  type RecState,
  type TranscriptLine,
} from '../../../shared/recorder';
import type { RecorderStatus, TranscribeFailure, Transcribed, Transcriber } from '../../../main/meeting-recorder';
import {
  autoVoiceNames,
  carrySpeakerNames,
  clearSpeakerName,
  expectedOthers,
  labelPieces,
  liveTurnsFromPieces,
  marksFromLines,
  mergeVoiceNames,
  mergeVoicePieces,
  mergeVoiceWords,
  pruneSpeakerNames,
  pushSpeakerPast,
  readSpeakerNames,
  setSpeakerName,
  speakerId,
  speakerNameRefused,
  speakerPartKey,
  speakersFallbackWords,
  speakersSettledWords,
  tryWriteSpeakerNames,
  undoSpeakerPast,
  type SpeakerMark,
  type SpeakerNames,
  type SpeakerPast,
  type SpeakerTurn,
} from '../../../shared/meeting-speakers';
import { errorMessage } from '../lib/errors';
import { writeLink } from '../lib/links';
import tapUrl from '../lib/tap-worklet.js?url&no-inline';
import * as A from './actions';
import { docs } from './docs';
import { getPerson } from './person';
import { getNoteTypes } from './noteTypes';
import { onNoteMoved, onNoteRemoved } from './noteEvents';
import { getState, loadFiles, loadNotes, prefs, savePrefs, toast } from './store';
import { fixHintWords, fixText, fixesFor, loadWordFixes } from './wordFixes';

// ── What the screens see ─────────────────────────────────────────────────────────────────────────────────────────────

export interface LiveView extends RecState {
  /** What is being recorded: the microphone, the microphone and the PC's sound, or (no microphone) the PC's sound. */
  sources: 'mic' | 'mic+pc' | 'pc';
  /** The microphone in use (its label). */
  micName: string;
  /** Said under the controls (the PC's sound couldn't be had; a call playing where it isn't recorded; no transcription here). */
  notice: string;
  /** A problem with the sound coming in now (the microphone silent or unplugged), with a way to fix it. */
  warning: '' | 'mic-silent' | 'mic-gone';
  /** Pieces can be written down (the former host app is there). */
  canTranscribe: boolean;
  transcriber?: Transcriber;
}

/** A recording's job as a page shows it. */
export interface JobView extends RecJob {
  /** Being worked on now (saved, written down, notes made). */
  working: boolean;
  /** Stopped mid-way when Ironleaf closed: Finish or Discard. */
  interrupted: boolean;
  /** Pieces written down / to write down, while the last ones are. */
  progress?: { done: number; total: number };
  /** "Try again" is offered: some of it couldn't be written down, or the notes couldn't be made. */
  canRetry: boolean;
  /** "Set up speech" is offered: nothing is set up to write recordings down (9.2 uplift F74). */
  canSetup?: boolean;
  /** Said once under the card (a piece that failed while recording). */
  notice?: string;
  /** The meeting's voices as told apart so far (6 Nov 2026, speakers): rough while it records, settled at the end. */
  speakerView?: { marks: SpeakerMark[]; names: SpeakerNames; notice?: string; settled: boolean };
}

export interface RecorderView {
  live: LiveView;
  jobs: JobView[];
}

const LIVE_EXTRA: Omit<LiveView, keyof RecState> = { sources: 'mic', micName: '', notice: '', warning: '', canTranscribe: false };

let live: RecState = IDLE;
let liveExtra = { ...LIVE_EXTRA };
const jobs = new Map<string, JobView>();
let view: RecorderView = { live: { ...live, ...liveExtra }, jobs: [] };
const listeners = new Set<() => void>();
/** Meeting notes whose panel is on screen (the pill isn't needed for those). */
const panels = new Map<string, number>();

function emit(): void {
  view = { live: { ...live, ...liveExtra }, jobs: [...jobs.values()].sort((a, b) => a.began.localeCompare(b.began)) };
  for (const fn of listeners) fn();
}
function step(e: RecEvent): void {
  live = recStep(live, e, Date.now());
  emit();
}
function setLive(patch: Partial<typeof liveExtra>): void {
  liveExtra = { ...liveExtra, ...patch };
  emit();
}
function setJob(id: string, patch: Partial<JobView>): JobView | null {
  const j = jobs.get(id);
  if (!j) return null;
  const next = { ...j, ...patch };
  jobs.set(id, next);
  emit();
  return next;
}

/** The recorder as it is now: the live recording (for the command list and Today's button). */
export function recorderView(): LiveView {
  return view.live;
}

/** The recorder as it is now, for a page (redrawn as it changes). */
export function useRecorder(): RecorderView {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => view,
  );
}

/** The job a meeting note's panel shows: its live recording, else its latest one not put away. */
export function jobFor(v: RecorderView, note: string): JobView | null {
  return jobForNote(v.jobs, v.live.id, note);
}

/** The time recorded, kept current while the microphone is open. */
export function useElapsed(v: LiveView): number {
  const [now, setNow] = useState(() => Date.now());
  const on = v.phase === 'recording';
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [on]);
  return recElapsed(v, on ? now : Date.now());
}

/** How loud each source is now (0 … 1, eased), for the meters: read on each animation frame while recording. */
export function levelsNow(): { mic: number; pc: number | null; pcSilent: boolean } {
  const s = session;
  if (!s) return { mic: 0, pc: null, pcSilent: false };
  return { mic: s.micLevel, pc: s.pc ? s.pcLevel : null, pcSilent: !!s.pc && s.pcQuiet >= PC_SILENT_SECONDS };
}

/** A meeting note's panel on screen (true) or gone (false): the pill shows only when none is. */
export function panelShown(note: string, shown: boolean): void {
  panels.set(note, Math.max(0, (panels.get(note) ?? 0) + (shown ? 1 : -1)));
  emit();
}
export const hasPanel = (note: string | null) => !!note && (panels.get(note) ?? 0) > 0;

// ── The microphones ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface Mic {
  id: string;
  label: string;
}

/** The PC's microphones (named once Ironleaf has used one; until then "Microphone 1", "Microphone 2"). */
export async function listMics(): Promise<Mic[]> {
  try {
    const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
    return all.map((d, i) => ({ id: d.deviceId === 'default' ? '' : d.deviceId, label: d.deviceId === 'default' ? `Windows default${d.label ? ` (${d.label.replace(/^Default - /, '')})` : ''}` : d.label || `Microphone ${i + 1}` }));
  } catch {
    return [];
  }
}

/** The PC's speakers as Chromium lists them (the 'default' and 'communications' entries say where calls play). */
async function listOutputs(): Promise<{ deviceId: string; label: string }[]> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput').map((d) => ({ deviceId: d.deviceId, label: d.label || '' }));
  } catch {
    return [];
  }
}

/** The microphones, kept current as they are plugged in and out. */
export function useMics(): Mic[] {
  const [mics, setMics] = useState<Mic[]>([]);
  useEffect(() => {
    let on = true;
    const load = () => void listMics().then((m) => on && setMics(m));
    load();
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => {
      on = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', load);
    };
  }, [liveExtra.micName]);
  return mics;
}

const micConstraints = (id: string): MediaTrackConstraints => ({ ...(id ? { deviceId: { exact: id } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 });

/** The microphone chosen (or the default when the chosen one isn't plugged in, said in `fellBack`). */
async function openMic(id: string): Promise<{ stream: MediaStream; fellBack: boolean }> {
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: micConstraints(id), video: false }), fellBack: false };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (id && (name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'NotReadableError')) return { stream: await navigator.mediaDevices.getUserMedia({ audio: micConstraints(''), video: false }), fellBack: true };
    throw err;
  }
}

// ── A recording ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  note: string;
  began: Date;
  /** null: no microphone (the PC's sound alone). */
  mic: MediaStream | null;
  micSource: MediaStreamAudioSourceNode | null;
  mix: GainNode;
  pc: MediaStream | null;
  ctx: AudioContext;
  node: AudioWorkletNode;
  media: MediaRecorder;
  capture: MeetingCapture;
  /** The PC's sound is recorded too: speech on disk is stereo (both sides apart). */
  stereo: boolean;
  /** Speech waiting to be written to disk (bytes). */
  speech: Uint8Array[];
  speechBytes: number;
  /** The disk writes, one after another. */
  writes: Promise<void>;
  canTranscribe: boolean;
  micLevel: number;
  pcLevel: number;
  /** Seconds the microphone has been silent. */
  micQuiet: number;
  /** A microphone that hears hiss but never a voice, while the call talks. */
  micWatch: MicWatch;
  /** Seconds the PC's sound has been silent. */
  pcQuiet: number;
  /** The unheard-call sentence standing while the call plays where the recorder cannot hear ('' when it is heard). */
  routeWords: string;
  /** The extra far-side capture (m6): the missed output's loopback too, mixed into the far side in hear(). */
  extra: { feed: ExtraFeed; unsubs: (() => void)[]; on: boolean } | null;
  savedAt: number;
  diskTrouble: boolean;
  /** Disk writes the disk refused (a full disk): kept in order and tried again, never dropped. */
  pendingWrites: (() => Promise<void>)[];
  /** Trying the held writes again soon. */
  retryTimer: number | null;
}

let session: Session | null = null;
/** Each job's pieces written down together, up to SEND_SLOTS at once (both sides never queue behind each other). */
const gates = new Map<string, SendGate>();
const gateFor = (id: string): SendGate => {
  let g = gates.get(id);
  if (!g) {
    g = new SendGate(SEND_SLOTS);
    gates.set(id, g);
  }
  return g;
};
/** Jobs being finished now. */
const working = new Set<string>();
/** Jobs whose note was deleted while they were being finished: they stop at the next step. */
const cancelled = new Set<string>();

// ── The meeting's voices (6 Nov 2026, speakers) ─────────────────────────────────────────────────────────────────────
// Each voiced piece-side is heard live (its provisional voice, rough on purpose); at the end one final pass over the
// kept speech settles them, carrying names set during the meeting on the right voices. Names live apart from the
// lines (here while it records, in the note's properties after), so naming never rewrites a line and undoes cleanly.

/** The live pass's turns per job (provisional voices with their moments; rebuilt from the pieces after a crash). */
const liveTurns = new Map<string, SpeakerTurn[]>();
/** The names set on each job's voices (kept current on disk with the job, so a crash never loses one). */
const liveNames = new Map<string, SpeakerNames>();
/** Naming steps back per job (naming, clearing, joining voices, each undone in turn). */
const namesPast = new Map<string, SpeakerPast[]>();
/** A first clip of each live voice's sound per job (its piece's first seconds, to tell them apart by ear). */
const liveClips = new Map<string, Map<number, Uint8Array>>();
/** Jobs whose live voices failed (the transcript stays as today, said once; the final pass still tries). */
const liveFailed = new Set<string>();
/** Whether this PC can tell voices apart (asked once; unasked until the first recording). */
let speakersReady: boolean | null = null;

/** The voices told apart so far as the card shows them (marks empty: the transcript stays as today). */
function speakerViewOf(id: string): NonNullable<JobView['speakerView']> {
  return jobs.get(id)?.speakerView ?? { marks: [], names: liveNames.get(id) ?? {}, settled: false };
}

/** Whether a piece-side may be given to a numbered voice (never the microphone on a call: that side stays "You"). */
function voiceable(sources: 'mic' | 'mic+pc' | undefined, side: RecPiece['side'], who: string | undefined): boolean {
  if (who && who !== 'You' && who !== 'Others' && !/^Speaker [1-9]\d*$/.test(who)) return false;
  if (sources === 'mic+pc') return side === 'pc';
  return true;
}

/** A piece's sound loud enough to join the voices (quiet pieces never start one). */
function wavHeard(wav: Uint8Array): boolean {
  if (wav.byteLength <= 44) return false;
  const view = new DataView(wav.buffer, wav.byteOffset + 44, wav.byteLength - 44 - ((wav.byteLength - 44) % 2));
  for (let i = 0; i < view.byteLength; i += 320) if (Math.abs(view.getInt16(i, true)) >= 300) return true;
  return false;
}

/** A failure in the person's own words (lib/errors.ts, 9.2 uplift F60). */
const plainError = (err: unknown): string => errorMessage(err);

/** The note's name and its day (its date property, else today), for the recording's name and the notes. */
function aboutNote(note: string): { title: string; date: string } {
  const props = getState().byPath.get(note)?.props ?? {};
  const d = typeof props.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(props.date) ? props.date.slice(0, 10) : '';
  const t = new Date();
  return { title: A.titleOf(note), date: d || `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` };
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).toLowerCase();

/** The PC's sound (the other side of a call): its stream, or why not. */
async function openPcSound(): Promise<{ stream: MediaStream | null; words: string }> {
  const ask = (audio: MediaTrackConstraints | boolean) => navigator.mediaDevices.getDisplayMedia({ video: true, audio, systemAudio: 'include' } as DisplayMediaStreamOptions);
  let shared: MediaStream;
  try {
    // The sound as the PC plays it, untouched (no echo cancelling or levelling, which can thin out the call).
    shared = await ask({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  } catch (first) {
    const name = first instanceof DOMException ? first.name : '';
    if (name !== 'NotReadableError' && name !== 'AbortError' && name !== 'OverconstrainedError') return { stream: null, words: pcSoundWords(name) };
    try {
      shared = await ask(true);
    } catch (err) {
      return { stream: null, words: pcSoundWords(err instanceof DOMException ? err.name : '') };
    }
  }
  // Only its sound is wanted: the picture (Ironleaf's own window) is stopped at once and never recorded.
  for (const t of shared.getVideoTracks()) t.stop();
  const sound = shared.getAudioTracks();
  return sound.length ? { stream: new MediaStream(sound), words: '' } : { stream: null, words: pcSoundWords('') };
}

/** Starts recording a meeting note. */
export async function startRecording(note: string): Promise<void> {
  if (isBusy(live)) {
    toast(live.note === note ? 'This meeting is already being recorded.' : `“${A.displayName(live.note ?? '')}” is being recorded. Stop it first.`, live.note && live.note !== note ? { label: 'Open', run: () => A.openPath(live.note!, { where: 'current' }) } : undefined);
    return;
  }
  const id = newId();
  liveExtra = { ...LIVE_EXTRA };
  void loadWordFixes().catch(() => undefined);
  step({ type: 'start', id, note });
  let mic: MediaStream | null = null;
  let pc: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let begun = false;
  try {
    const status = await window.nv.recorder.prepare();
    const wantPc = status.systemAudio && prefs().meetingSystemAudio;
    const notices: string[] = [];
    // No microphone at all, but the PC's sound wanted (a call listened to on this PC): the call is recorded on its own.
    let micError: unknown = null;
    try {
      const opened = await openMic(prefs().meetingMic);
      mic = opened.stream;
      if (opened.fellBack) notices.push('The microphone you chose isn’t plugged in, so the PC’s default is recording.');
    } catch (err) {
      if (!wantPc) throw err;
      micError = err;
    }
    if (wantPc) {
      const got = await openPcSound();
      pc = got.stream;
      if (got.words) notices.push(got.words);
    }
    if (!mic && !pc) throw micError ?? new DOMException('none', 'NotFoundError');
    if (!mic) notices.unshift(`${micWords(micError instanceof DOMException ? micError.name : '')} Only the PC’s sound is being recorded.`.replace(', then try again.', '.').replace(' then try again.', '.'));
    // A call playing where the recorder cannot hear (its communications speakers differ from the default ones the
    // loopback hears): said at once, with the way to fix it — a user lost a meeting's far side to this (5 Nov 2026).
    let routeWords = '';
    if (pc) {
      const route = unheardCall(await listOutputs());
      if (route) {
        routeWords = unheardCallWords(route.heard, route.missed);
        notices.push(routeWords);
      }
    }
    if (live.id !== id) throw new DOMException('stopped', 'AbortError');
    ctx = new AudioContext({ latencyHint: 'playback' });
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    // The recording: the microphone and the PC's sound mixed, kept from clipping, one channel.
    const mix = ctx.createGain();
    const micSource = mic ? ctx.createMediaStreamSource(mic) : null;
    micSource?.connect(mix);
    const pcSource = pc ? ctx.createMediaStreamSource(pc) : null;
    pcSource?.connect(mix);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 12;
    const dest = ctx.createMediaStreamDestination();
    dest.channelCount = 1;
    mix.connect(limiter).connect(dest);
    // The tap: each source apart, for the speech written down and who is talking.
    await ctx.audioWorklet.addModule(tapUrl);
    const node = new AudioWorkletNode(ctx, 'nv-tap', { numberOfInputs: 2, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    micSource?.connect(node, 0, 0);
    pcSource?.connect(node, 0, 1);
    // The tap must reach the speakers' end to be run, silently (never the meeting played back).
    const hush = ctx.createGain();
    hush.gain.value = 0;
    node.connect(hush).connect(ctx.destination);
    const { mime, ext } = pickRecordingType((t) => MediaRecorder.isTypeSupported(t));
    const media = new MediaRecorder(dest.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 64_000 });
    const about = aboutNote(note);
    const began = new Date();
    const job = await window.nv.recorder.begin({ id, vault: getState().vault?.path, note, title: about.title, date: about.date, began: began.toISOString(), mime: media.mimeType || mime, ext, sources: pc ? 'mic+pc' : 'mic', elapsedMs: 0, phase: 'recording', pieces: [], ...(pc ? { stereo: true } : {}) });
    begun = true;
    jobs.set(id, { ...job, working: false, interrupted: false, canRetry: false });
    // The voices start listening too (their failure never stops the recording: the transcript stays as today).
    liveTurns.set(id, []);
    liveNames.set(id, job.speakers?.names ?? {});
    namesPast.set(id, []);
    liveClips.set(id, new Map());
    void window.nv.speakers.liveBegin(id, expectedVoices(note, about.title) ?? undefined).catch(() => undefined);
    const s: Session = { id, note, began, mic, micSource, mix, pc, ctx, node, media, capture: new MeetingCapture({ seconds: status.pieceSeconds }), stereo: !!pc, speech: [], speechBytes: 0, writes: Promise.resolve(), canTranscribe: status.transcribe, micLevel: 0, pcLevel: 0, micQuiet: 0, micWatch: new MicWatch(), pcQuiet: 0, routeWords, extra: null, savedAt: Date.now(), diskTrouble: false, pendingWrites: [], retryTimer: null };
    media.ondataavailable = (e) => {
      if (!e.data.size) return;
      const blob = e.data;
      write(s, async () => window.nv.recorder.append(id, 'audio', new Uint8Array(await blob.arrayBuffer())));
    };
    const rate = ctx.sampleRate;
    node.port.onmessage = (e: MessageEvent<{ mic: Float32Array; pc: Float32Array | null }>) => {
      if (session !== s || live.phase !== 'recording') return;
      hear(s, e.data.mic, e.data.pc, rate);
    };
    // Unplugged is heard as the track ending or muting (5 Nov 2026, s2-recorder-survives): either takes the default over.
    for (const t of mic?.getAudioTracks() ?? []) {
      t.addEventListener('ended', () => void micLost(s));
      t.addEventListener('mute', () => void micLost(s));
    }
    for (const t of pc?.getAudioTracks() ?? []) t.addEventListener('ended', () => session === s && setLive({ notice: 'The PC’s sound stopped (its speakers or headset changed), so only your microphone is recording now.' }));
    // A headset change re-checks the microphone while it records (its track may mute without ending; one listener below).
    media.start(2000);
    session = s;
    const micName = mic?.getAudioTracks()[0]?.label ?? '';
    const transcriber = (await window.nv.recorder.status().catch(() => status)).transcriber;
    if (transcriber && !transcriber.ready) notices.push(`It isn’t being written down as it goes: ${transcriber.words ?? 'no speech service is set up yet (Settings › Capture › Voice and meetings).'} The recording is kept in the note.`);
    setLive({ sources: pc ? (mic ? 'mic+pc' : 'pc') : 'mic', micName, notice: notices.join(' '), canTranscribe: status.transcribe && transcriber?.ready !== false, transcriber });
    step({ type: 'started' });
    // The call playing where Chromium cannot hear: the extra capture tries too (never awaited — the meeting records
    // with Chromium's sound whatever the extra does, and the sentence above stands until the far side is really heard).
    if (s.pc && routeWords) void startExtra(s);
  } catch (err) {
    for (const t of [...(mic?.getTracks() ?? []), ...(pc?.getTracks() ?? [])]) t.stop();
    void ctx?.close().catch(() => undefined);
    session = null;
    if (begun) {
      jobs.delete(id);
      forgetSpeakers(id);
      void window.nv.speakers.liveEnd(id).catch(() => undefined);
      gates.delete(id);
      void window.nv.recorder.discard(id).catch(() => undefined);
    }
    const name = err instanceof DOMException ? err.name : '';
    const stopped = live.id !== id;
    step({ type: 'fail' });
    if (!stopped) toast(micWords(name, plainError(err)), undefined, 10_000);
  }
}

/** A disk write in turn; a full disk holds its writes in order and tries them again, said once in plain words. */
function write(s: Session, fn: () => Promise<void>): void {
  // While the disk refuses, later writes queue behind the held ones (order kept: speech and audio append in order).
  if (s.pendingWrites.length) {
    s.pendingWrites.push(fn);
    return;
  }
  s.writes = s.writes.then(fn).catch((err) => {
    if (isDiskFull(err)) {
      s.pendingWrites.push(fn);
      if (!s.diskTrouble) {
        s.diskTrouble = true;
        setLive({ notice: diskFullWords() });
      }
      retryWrites(s);
      return;
    }
    if (s.diskTrouble) return;
    s.diskTrouble = true;
    setLive({ notice: `The recording couldn’t be saved to disk as it goes (${plainError(err)}). Keep Ironleaf open until you stop.` });
  });
}

/** Held writes tried again in turn until the disk takes them (space freed); the notice clears when they land. */
function retryWrites(s: Session): void {
  if (s.retryTimer !== null || !s.pendingWrites.length) return;
  s.retryTimer = window.setTimeout(() => {
    s.retryTimer = null;
    if (session !== s || !s.pendingWrites.length) return;
    const held = s.pendingWrites.splice(0);
    s.writes = s.writes
      .then(async () => {
        for (const fn of held) await fn();
      })
      .then(() => {
        if (session === s && !s.pendingWrites.length && s.diskTrouble) {
          s.diskTrouble = false;
          // Only the disk's sentence goes (a standing one, like an unheard call, stays standing).
          if (live.id === s.id && liveExtra.notice.includes(diskFullWords())) setLive({ notice: dropNotice(liveExtra.notice, diskFullWords()) });
        }
      })
      .catch((err) => {
        // Still full: back at the front, in order, and tried again shortly.
        s.pendingWrites.unshift(...held);
        if (!isDiskFull(err) && session === s) setLive({ notice: `The recording couldn’t be saved to disk as it goes (${plainError(err)}). Keep Ironleaf open until you stop.` });
        retryWrites(s);
      });
  }, 5000);
}

function flushSpeech(s: Session): void {
  if (!s.speechBytes) return;
  const all = new Uint8Array(s.speechBytes);
  let at = 0;
  for (const b of s.speech) {
    all.set(b, at);
    at += b.length;
  }
  s.speech = [];
  s.speechBytes = 0;
  write(s, () => window.nv.recorder.append(s.id, 'speech', all));
}

/** A block of sound from each source: the meters, the speech kept and cut into pieces with its sides apart. */
function hear(s: Session, mic: Float32Array, pc: Float32Array | null, rate: number): void {
  const micR = loudness(mic);
  const pcR = pc ? loudness(pc) : 0;
  const ease = (was: number, now: number) => Math.max(Math.min(1, now * 4), was * 0.82);
  s.micLevel = ease(s.micLevel, micR);
  s.pcLevel = ease(s.pcLevel, pcR);
  // Each side apart at speech rate: cut into pieces together, kept and written down apart (r2, Nov 2026), so labels
  // follow the side that talked. The PC's sound gone mid-meeting: silence on its side.
  const dm = downsample(mic, rate, PIECE_RATE);
  const dp = pc ? downsample(pc, rate, PIECE_RATE) : null;
  // The extra capture's sound joins the far side here (m6): the same speech on disk, the same pieces, the same gates
  // and billing as Chromium's sound. Heard for real, the sentence stands down; heard twice, the extra stands down.
  if (dp && s.extra?.on) {
    const got = s.extra.feed.take(dm.length, dp);
    mixExtraInto(dp, got.samples);
    if (got.drop) void stopExtra(s);
    else if (got.hearing && s.routeWords) {
      const stood = s.routeWords;
      s.routeWords = '';
      if (live.id === s.id) setLive({ notice: dropNotice(liveExtra.notice, stood) });
    }
  }
  const seconds = dm.length / PIECE_RATE;
  const bytes = s.stereo ? toPcm16Stereo(dm, dp ?? new Float32Array(dm.length)) : toPcm16(dm);
  s.speech.push(bytes);
  s.speechBytes += bytes.length;
  if (s.speechBytes >= PIECE_RATE * 2 * (s.stereo ? 2 : 1)) flushSpeech(s);
  for (const p of s.capture.block(dm, dp)) addPiece(s, p);
  if (pc) s.pcQuiet = pcR < MIC_DEAD ? s.pcQuiet + seconds : 0;
  // The far side silent past thirty seconds on speakers the recorder cannot hear: the meter is not enough (found
  // out after a meeting) — the sentence stands in the notice a person will see. A room, with nothing amiss,
  // keeps the meter only.
  if (s.pc && s.routeWords && s.pcQuiet >= PC_SILENT_SECONDS && live.id === s.id && !liveExtra.notice.includes(s.routeWords)) setLive({ notice: joinNotice(liveExtra.notice, s.routeWords) });
  // A silent microphone (muted, or the wrong one) said after a few seconds; cleared once it hears again. A
  // microphone that hears hiss but never a voice, while the call talks, says the same after a couple of minutes
  // (r3: the silent rule never fired for it, so the meeting stayed quietly empty).
  if (!s.mic) {
    // No microphone: nothing to warn about (said once at the start).
  } else {
    const noVoice = s.micWatch.feed(s.capture.lastVoiced.mic, s.capture.lastVoiced.pc, seconds);
    if (micR < MIC_DEAD) {
      s.micQuiet += seconds;
      if (s.micQuiet >= MIC_SILENT_SECONDS && !liveExtra.warning) setLive({ warning: 'mic-silent' });
    } else {
      s.micQuiet = 0;
      if (noVoice) {
        if (!liveExtra.warning) setLive({ warning: 'mic-silent' });
      } else if (liveExtra.warning === 'mic-silent') setLive({ warning: '' });
    }
  }
  // How long it has gone, kept every few seconds (a crash then knows).
  if (Date.now() - s.savedAt > 5000) {
    s.savedAt = Date.now();
    const elapsedMs = recElapsed(live, Date.now());
    write(s, async () => void (await window.nv.recorder.update(s.id, { elapsedMs })));
  }
}

/** A piece cut: each side holding speech kept as its own entry with who it is, and written down from its own sound;
 *  silence on every side is kept as one quiet piece and never sent. */
function addPiece(s: Session, p: CapturedPiece): void {
  if (!p.sides.length) {
    putPiece(s.id, { index: p.index, start: p.start, seconds: p.seconds, status: 'quiet' });
    return;
  }
  for (const side of p.sides) {
    const audio = side === 'mic' ? p.mic : (p.pc ?? p.mic);
    const who = s.stereo ? (side === 'mic' ? 'You' : 'Others') : undefined;
    const piece: RecPiece = { index: p.index, start: p.start, seconds: p.seconds, ...(s.stereo ? { side } : {}), ...(who ? { who } : {}), status: 'pending' };
    putPiece(s.id, piece);
    const wav = encodeWav(audio);
    if (s.canTranscribe) send(s.id, piece, wav);
    // The voices hear it too, apart (their failure never stops the writing down).
    void hearLive(s.id, piece, wav).catch(() => undefined);
  }
}

/** One voiced piece-side heard live, stretch by stretch between its pauses: its provisional voices, and the
 *  pieces relabelled rough (never awaited). Each stretch keeps its own moment, so two people trading short
 *  lines inside one piece are two voices live, not one (6 Nov 2026, e1-speaker-turns). */
async function hearLive(id: string, piece: RecPiece, wav: Uint8Array): Promise<void> {
  const j = jobs.get(id);
  if (!j || liveFailed.has(id) || piece.status !== 'pending' && piece.status !== 'done') return;
  if (!voiceable(j.sources, piece.side, piece.who) || !wavHeard(wav)) return;
  if (speakersReady === null) speakersReady = await window.nv.speakers.status().then((s) => s.ready, () => false);
  if (!speakersReady) return;
  const side = j.sources === 'mic+pc' ? 'pc' : piece.side === 'mic' || piece.side === 'pc' ? piece.side : 'mix';
  let voice: number;
  let spans: { voice: number; start: number; seconds: number }[] = [];
  try {
    const heard = await window.nv.speakers.live(id, wav, side, piece.start, piece.seconds);
    voice = heard.voice;
    spans = heard.spans ?? [];
  } catch {
    voice = -1;
  }
  if (!jobs.has(id)) return;
  if (voice < 0) {
    // The engine couldn't hear: the transcript stays as today, said once (the final pass still tries).
    liveFailed.add(id);
    const v = speakerViewOf(id);
    if (!v.marks.length && !v.notice) setJob(id, { speakerView: { ...v, notice: speakersFallbackWords() } });
    return;
  }
  const turns = liveTurns.get(id) ?? [];
  if (spans.length) for (const s of spans) turns.push({ id: speakerId(s.voice + 1), start: s.start, end: Math.round((s.start + s.seconds) * 1000) / 1000, side });
  else turns.push({ id: speakerId(voice + 1), start: piece.start, end: Math.round((piece.start + piece.seconds) * 1000) / 1000, side });
  liveTurns.set(id, turns);
  // A first clip of a new voice's sound (its piece, to tell them apart by ear), kept while it records; the card
  // plays its first seconds only.
  const clips = liveClips.get(id) ?? new Map<number, Uint8Array>();
  if (!clips.has(voice) && wav.byteLength > 44) {
    clips.set(voice, wav.slice());
    liveClips.set(id, clips);
  }
  relabelLive(id);
}

/** The written-down pieces relabelled from the voices heard so far (a piece takes its voice as soon as it lands, and
 *  a new voice appears with its first piece — never a piece behind). A no-op when no label moves. */
function relabelLive(id: string): void {
  const j = jobs.get(id);
  if (!j) return;
  const labelled = labelPieces(j.pieces, liveTurns.get(id) ?? [], j.sources);
  if (!labelled) return;
  setJob(id, { pieces: labelled.pieces });
  const v = speakerViewOf(id);
  setJob(id, { speakerView: { ...v, marks: labelled.marks } });
  void window.nv.recorder.update(id, { pieces: labelled.pieces }).catch(() => undefined);
}

/** How many others the meeting expects on the call (the note's invite, else a 1-2-1 title): the voices'
 *  grouping keeps that many at most, so one person is never split into numbered voices (12 Nov 2026). */
function expectedVoices(note: string, title: string): number | null {
  return expectedOthers({ title, attendees: notePeople(docs.text(note) ?? '', getState().byPath.get(note)?.props ?? {}), me: getPerson() ?? undefined });
}

/** Voices named from what the meeting already knows (the invite, the title, what was said): applied live as soon as
 *  clear, and at the settle for any still unnamed. Never overwrites a name already set (by hand or earlier); the
 *  transcript re-labels in place, as it does for a hand-set name. */
function applyAutoNames(id: string): void {
  const j = jobs.get(id);
  if (!j) return;
  const have = liveNames.get(id) ?? {};
  const lines = mergeTranscript(j.pieces);
  if (!lines.length) return;
  const { names } = autoVoiceNames(lines, {
    attendees: notePeople(docs.text(j.note) ?? '', getState().byPath.get(j.note)?.props ?? {}),
    title: j.title,
    me: getPerson() ?? undefined,
    sources: j.sources,
  });
  for (const [voice, name] of Object.entries(names)) {
    if (!have[voice]) setJobSpeakerName(id, voice, name);
  }
}

/** A name set on a job's voice (every line takes it; '' set, else why not, in plain words). */
export function setJobSpeakerName(id: string, voice: string, name: string): string {
  const j = jobs.get(id);
  if (!j) return 'That meeting isn’t here any more.';
  const refused = speakerNameRefused(name);
  if (refused) return refused;
  const names = liveNames.get(id) ?? {};
  const next = setSpeakerName(names, voice, name);
  if (next === names) return '';
  namesPast.set(id, pushSpeakerPast(namesPast.get(id) ?? [], { names, marks: speakerViewOf(id).marks }));
  liveNames.set(id, next);
  const v = speakerViewOf(id);
  setJob(id, { speakers: { names: next }, speakerView: { ...v, names: next } });
  void window.nv.recorder.update(id, { speakers: { names: next } }).catch(() => undefined);
  return '';
}

/** A job's voice unnamed (its lines show "Speaker N" again). */
export function clearJobSpeakerName(id: string, voice: string): void {
  const j = jobs.get(id);
  if (!j) return;
  const names = liveNames.get(id) ?? {};
  const next = clearSpeakerName(names, voice);
  if (next === names) return;
  namesPast.set(id, pushSpeakerPast(namesPast.get(id) ?? [], { names, marks: speakerViewOf(id).marks }));
  liveNames.set(id, next);
  const v = speakerViewOf(id);
  setJob(id, { speakers: { names: next }, speakerView: { ...v, names: next } });
  void window.nv.recorder.update(id, { speakers: { names: next } }).catch(() => undefined);
}

/** Two of a job's voices joined by hand (every line moves; said in plain words). */
export function mergeJobVoices(id: string, from: string, to: string): string {
  const j = jobs.get(id);
  if (!j || from === to) return '';
  const v = speakerViewOf(id);
  if (!v.marks.some((m) => m.id === from) || !v.marks.some((m) => m.id === to)) return '';
  if (v.marks.find((m) => m.id === from)?.side !== v.marks.find((m) => m.id === to)?.side) return 'Those two are on different sides, so they can’t be one voice.';
  const names = liveNames.get(id) ?? {};
  namesPast.set(id, pushSpeakerPast(namesPast.get(id) ?? [], { names, marks: v.marks, turns: [...(liveTurns.get(id) ?? [])] }));
  const merged = mergeVoicePieces(j.pieces, from, to);
  liveTurns.set(id, (liveTurns.get(id) ?? []).map((t) => (t.id === from ? { ...t, id: to } : t)));
  const next = mergeVoiceNames(names, from, to);
  liveNames.set(id, next);
  const marks = v.marks.filter((m) => m.id !== from);
  setJob(id, { pieces: merged, speakers: { names: next }, speakerView: { ...v, marks, names: next } });
  void window.nv.recorder.update(id, { pieces: merged, speakers: { names: next } }).catch(() => undefined);
  return mergeVoiceWords(from, to, next[to]);
}

/** Whether a job's naming has a step back. */
export function jobSpeakerUndoable(id: string): boolean {
  return (namesPast.get(id)?.length ?? 0) > 0;
}

/** A job's naming one step back (false: nothing to undo). */
export function undoJobSpeakers(id: string): boolean {
  const j = jobs.get(id);
  const undone = undoSpeakerPast(namesPast.get(id) ?? []);
  if (!j || !undone) return false;
  namesPast.set(id, undone.past);
  liveNames.set(id, undone.step.names);
  // The lines follow the marks back (a joined voice splits again, from the turns as they were).
  if (undone.step.turns) liveTurns.set(id, undone.step.turns);
  const turns = liveTurns.get(id) ?? [];
  const relabelled = undone.step.marks.length && turns.length ? labelPieces(j.pieces, turns, j.sources) : null;
  const pieces = relabelled?.changed ? relabelled.pieces : j.pieces;
  setJob(id, { pieces, speakers: { names: undone.step.names }, speakerView: { ...speakerViewOf(id), marks: undone.step.marks, names: undone.step.names } });
  void window.nv.recorder.update(id, { pieces, speakers: { names: undone.step.names } }).catch(() => undefined);
  return true;
}

/** A live voice's first clip of sound (its piece, to tell it apart by ear; null when none). */
export function liveClip(id: string, voice: number): Uint8Array | null {
  return liveClips.get(id)?.get(voice) ?? null;
}

/** A job's voices forgotten (its recording finished and written up, or discarded). */
function forgetSpeakers(id: string): void {
  liveTurns.delete(id);
  liveNames.delete(id);
  namesPast.delete(id);
  liveClips.delete(id);
  liveFailed.delete(id);
}

/** A piece changed in its job (on screen and on disk): one entry per side of a piece. */
function putPiece(id: string, piece: RecPiece): void {
  const j = jobs.get(id);
  if (!j) return;
  const pieces = [...j.pieces.filter((x) => x.index !== piece.index || (x.side ?? '') !== (piece.side ?? '')), piece].sort((a, b) => a.index - b.index);
  setJob(id, { pieces });
  void window.nv.recorder.update(id, { pieces }).catch(() => undefined);
  // Written down at last: its voice goes on at once, from what the voices heard so far, and a voice whose name is
  // clear from what the meeting knows is named at once too (the transcript re-labels in place).
  if (piece.status === 'done') {
    relabelLive(id);
    applyAutoNames(id);
  }
  checkBehind(id);
}

/** One side of one piece, named for its job: the gate's key and the behind judge's. */
const pieceKey = (id: string, p: Pick<RecPiece, 'index' | 'side'>) => `${id} ${p.index}:${p.side ?? ''}`;

/** When each piece still to land was asked to be written down, for the behind judge. */
const askedAt = new Map<string, number>();

/** Writing down running behind said once while it records (its own line, kept until caught up, never over a more
 *  urgent line). Pieces land and queue through putPiece, so both directions are judged as they happen. */
function checkBehind(id: string): void {
  if (live.id !== id || !session || !session.canTranscribe) return;
  const ours = behindWords();
  const pending = (jobs.get(id)?.pieces ?? []).filter((p) => p.status === 'pending');
  const waits = pending.map((p) => askedAt.get(pieceKey(id, p))).filter((t): t is number => t !== undefined);
  const oldest = waits.length ? Math.max(0, (Date.now() - Math.min(...waits)) / 1000) : 0;
  if (isBehind(pending.length, oldest)) {
    if (!liveExtra.notice) setLive({ notice: ours });
  } else if (liveExtra.notice === ours) setLive({ notice: '' });
}

/** The meeting's project key for remembered word fixes (its project property, else none). */
function projectKeyOf(note: string): string | null {
  const props = getState().byPath.get(note)?.props ?? {};
  const p = props.project;
  return typeof p === 'string' && p.trim() ? p.trim() : null;
}

/** The meeting's own names as hints for the hearing service (r2): the note's people and project, with its title —
 *  and the word check's remembered corrections, so next time they hear right (5 Nov 2026, minutes). */
function hintsFor(j: RecJob): string[] {
  const props = getState().byPath.get(j.note)?.props ?? {};
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string').map((x) => x.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim()).filter(Boolean);
  return transcribeHints({ title: j.title, people: [...strs(props.people), ...strs(props.attendees), ...fixHintWords(projectKeyOf(j.note))], project: typeof props.project === 'string' ? props.project : '' });
}

/** Offline until (ms): while the network is known down, pieces fail fast instead of queueing behind long time-outs. */
let offlineUntil = 0;
let offlineWords = '';
/** Jobs whose failed pieces are being tried again in the background (the network returned mid-meeting). */
const retrying = new Set<string>();

/** One piece written down, a few at a time (one more try for a one-off failure; offline and refused keys fail fast). */
function send(id: string, piece: RecPiece, wav: Uint8Array): Promise<void> {
  // Known offline: fail fast with the same words (ten minutes offline must not queue thirty time-outs).
  if (Date.now() < offlineUntil && live.id === id) {
    putPiece(id, { ...piece, status: 'failed', error: offlineWords });
    return Promise.resolve();
  }
  const key = pieceKey(id, piece);
  askedAt.set(key, Date.now());
  const run = async () => {
    if (!jobs.has(id) || cancelled.has(id)) return;
    const hints = hintsFor(jobs.get(id) ?? { note: '', title: '' } as RecJob);
    const ask = () => window.nv.recorder.transcribe(wav, 'audio/wav', hints).catch((err): TranscribeFailure => ({ error: plainError(err), kind: transcribeErrorKind(plainError(err), typeof (err as { code?: unknown })?.code === 'string' ? String((err as { code: string }).code) : '') }));
    let r: Transcribed | TranscribeFailure = await ask();
    if ('error' in r && r.kind === 'other') {
      await new Promise((ok) => setTimeout(ok, 1500));
      if (!jobs.has(id) || cancelled.has(id)) return;
      r = await ask();
    }
    if (!jobs.has(id) || cancelled.has(id)) return;
    if ('error' in r) {
      // Offline or a refused key waits (for the network, for the person): the recording carries on, told once.
      if (r.kind === 'offline' && live.id === id) {
        offlineUntil = Date.now() + 30_000;
        offlineWords = r.error;
      }
      putPiece(id, { ...piece, status: 'failed', error: r.error });
      setJob(id, { notice: r.error });
      // Paused only when writing down has truly stopped: offline, a refused key (5 Nov 2026, s2-recorder-survives
      // second round). A one-off failure tells its card only; the next piece still tries.
      if (live.id === id && (r.kind === 'offline' || r.kind === 'auth')) setLive({ notice: `Writing down has paused: ${r.error.replace(/\s*$/, '')} The recording carries on, and what’s missed is written down when you stop.` });
      return;
    }
    // Words that came back are always kept (5 Nov 2026, s2-recorder-survives second round: "Okay" in an 18-second
    // far-side piece is true and complete, never failed, never paused, never retried). An empty answer stays quiet as
    // before: the loudness check cannot tell speech from a quiet room, so no line and no notice.
    if (!r.text.trim() && !r.segments?.length) {
      putPiece(id, { ...piece, status: 'quiet', error: undefined });
      const q = jobs.get(id)?.progress;
      if (q) setJob(id, { progress: { ...q, done: Math.min(q.total, q.done + 1) } });
      return;
    }
    putPiece(id, { ...piece, status: 'done', text: r.text, ...(r.segments ? { segments: r.segments } : {}), error: undefined });
    if (live.id === id && liveExtra.notice.startsWith('Writing down has paused')) {
      // The pause lifts: a standing sentence (an unheard call) stands again.
      setLive({ notice: session?.routeWords ?? '' });
      // The network returned mid-meeting: what was missed is written down now, not only at Stop.
      void retryFailedLive(id);
    }
    const j = jobs.get(id);
    if (j?.progress) setJob(id, { progress: { ...j.progress, done: Math.min(j.progress.total, j.progress.done + 1) } });
  };
  // Through the job's gate: a few at a time, first cut first, and the same piece asked twice while it flies
  // shares the one request (never sent twice). Each answer lands on its own piece whatever order they finish in.
  return gateFor(id).send(key, async () => {
    try {
      await run();
    } finally {
      askedAt.delete(key);
    }
  });
}

/** Failed pieces tried again while it still records (the network returned): from the speech on disk, together. */
async function retryFailedLive(id: string): Promise<void> {
  if (retrying.has(id) || live.id !== id || !jobs.has(id)) return;
  retrying.add(id);
  const flying: Promise<void>[] = [];
  try {
    await gateFor(id).drain();
    const failed = (jobs.get(id)?.pieces ?? []).filter((p) => p.status === 'failed');
    for (const p of failed) {
      if (live.id !== id || !jobs.has(id) || cancelled.has(id)) return;
      if (Date.now() < offlineUntil) return;
      let data: Uint8Array;
      try {
        // The piece's own side (r2 merge): a You or Others entry is retried from its own sound, not the mix.
        data = await window.nv.recorder.speech(id, p.start, p.seconds, p.side);
      } catch {
        return;
      }
      // The host's own floor (r3): what reads under it would be dropped unheard there, so it stays quiet
      // here too — the same fate as the live path gives it (MeetingCapture SEND_FLOOR).
      if (loudness(fromPcm16(data.subarray(44))) < SEND_FLOOR) {
        putPiece(id, { ...p, status: 'quiet', error: undefined });
        continue;
      }
      flying.push(send(id, p, data));
    }
  } finally {
    await Promise.all(flying);
    retrying.delete(id);
  }
}

/** The microphone unplugged mid-meeting: the PC's default takes over when there is one. */
async function micLost(s: Session): Promise<void> {
  if (session !== s) return;
  setLive({ warning: 'mic-gone' });
  try {
    await switchMic('', { quiet: true });
    if (session === s) setLive({ warning: '', notice: 'Your microphone was unplugged, so the PC’s default microphone is recording now.' });
  } catch {
    // The warning stays, with the list to choose another.
  }
}

/** Another microphone, chosen in the card (also mid-recording: the recording carries on without a gap). */
export async function switchMic(id: string, opts: { quiet?: boolean } = {}): Promise<void> {
  if (!opts.quiet) await savePrefs({ meetingMic: id });
  const s = session;
  if (!s) return;
  const { stream } = await openMic(id);
  if (session !== s) {
    for (const t of stream.getTracks()) t.stop();
    return;
  }
  const source = s.ctx.createMediaStreamSource(stream);
  source.connect(s.mix);
  source.connect(s.node, 0, 0);
  s.micSource?.disconnect();
  for (const t of s.mic?.getTracks() ?? []) t.stop();
  s.mic = stream;
  s.micSource = source;
  s.micQuiet = 0;
  s.micWatch = new MicWatch();
  for (const t of stream.getAudioTracks()) {
    t.addEventListener('ended', () => void micLost(s));
    t.addEventListener('mute', () => void micLost(s));
  }
  setLive({ micName: stream.getAudioTracks()[0]?.label ?? '', warning: '' });
}

/** Headsets plugged in or out mid-meeting: a muted or ended microphone is taken over at once. */
async function devicesChanged(s: Session): Promise<void> {
  if (session !== s || !s.mic) return;
  for (const t of s.mic.getAudioTracks()) {
    if (t.readyState === 'ended' || t.muted) return micLost(s);
  }
}

/** A sentence added to the notice (once: saying it again never doubles it). */
const joinNotice = (notice: string, words: string): string => (!words || notice.includes(words) ? notice : notice ? `${notice} ${words}` : words);
/** A sentence taken back out of the notice (said no more once sorted). */
const dropNotice = (notice: string, words: string): string => (!words ? notice : notice.replace(words, '').replace(/\s{2,}/g, ' ').trim());

/** The extra far-side capture started (m6): the missed output's loopback too. Never awaited by its callers: the
 *  meeting records with Chromium's sound whatever the extra does, and the sentence stands until the far side is heard. */
async function startExtra(s: Session): Promise<void> {
  if (session !== s || s.extra || !s.pc || !s.routeWords) return;
  const feed = new ExtraFeed();
  let unsubs: (() => void)[] = [];
  try {
    unsubs = [
      window.nv.recorder.onExtraAudio((a) => {
        if (session === s && s.extra && ArrayBuffer.isView(a?.pcm)) feed.push(new Uint8Array(a.pcm.buffer, a.pcm.byteOffset, a.pcm.byteLength));
      }),
      window.nv.recorder.onExtraState((st) => {
        if (st?.died) void extraDied(s);
      }),
    ];
  } catch {
    return;
  }
  const mine = { feed, unsubs, on: false };
  s.extra = mine;
  let started = false;
  try {
    started = (await window.nv.recorder.extraStart(await listOutputs())).started === true;
  } catch {
    started = false;
  }
  if (!started || session !== s || s.extra !== mine) {
    if (s.extra === mine) s.extra = null;
    for (const u of unsubs) {
      try {
        u();
      } catch {
        // Gone already.
      }
    }
    // Started but unusable (stopped or superseded while asking): never left capturing.
    if (started) void window.nv.recorder.extraStop().catch(() => undefined);
    return;
  }
  mine.on = true;
}

/** The extra capture stopped (its meeting ended, both routes hear one device, or the default was fixed). */
async function stopExtra(s: Session): Promise<void> {
  const x = s.extra;
  s.extra = null;
  if (!x) return;
  for (const u of x.unsubs) {
    try {
      u();
    } catch {
      // Gone already.
    }
  }
  try {
    await window.nv.recorder.extraStop();
  } catch {
    // Gone already.
  }
}

/** The extra capture died mid-meeting: the meeting carries on with Chromium's sound, and the sentence stands again
 *  while the call still plays where the recorder cannot hear. */
async function extraDied(s: Session): Promise<void> {
  if (session !== s || !s.extra) return;
  await stopExtra(s);
  if (session === s) await routeChanged(s);
}

/** The speakers changed mid-meeting (a headset plugged in, unplugged or switched): the call may have moved where the
 *  recorder cannot hear, or back where it can. Said when it changes; taken back once sorted. */
async function routeChanged(s: Session): Promise<void> {
  if (session !== s || !s.pc) return;
  const route = unheardCall(await listOutputs());
  // The default fixed while a live extra hears nothing: Chromium hears it now, the extra stands down. An extra
  // hearing real sound stays, as does one still starting: only the one-call judgement stands those down.
  if (!route && s.extra?.on && !s.extra.feed.hearing) await stopExtra(s);
  if (session !== s) return;
  const before = s.routeWords;
  // The extra hearing the far side: the sentence stays down whatever the speakers say.
  const words = s.extra?.on && s.extra.feed.hearing ? '' : route ? unheardCallWords(route.heard, route.missed) : '';
  if (words !== before) {
    s.routeWords = words;
    if (session !== s || live.id !== s.id) return;
    setLive({ notice: words ? joinNotice(dropNotice(liveExtra.notice, before), words) : dropNotice(liveExtra.notice, before) });
  }
  // A mismatch newly arrived mid-meeting (a headset plugged in): the extra tries before the sentence stands.
  if (route && words && !s.extra && session === s) void startExtra(s);
}

// The network back mid-meeting (or the browser saying it never left): known offline ends, missed pieces retried.
if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
  window.addEventListener('online', () => {
    offlineUntil = 0;
    if (live.id && (jobs.get(live.id)?.pieces.some((p) => p.status === 'failed') ?? false)) void retryFailedLive(live.id);
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    if (!session) return;
    void devicesChanged(session);
    void routeChanged(session);
  });
}

export function pauseRecording(): void {
  const s = session;
  if (!s || live.phase !== 'recording') return;
  if (s.media.state === 'recording') s.media.pause();
  void s.ctx.suspend();
  step({ type: 'pause' });
}

export function resumeRecording(): void {
  const s = session;
  if (!s || live.phase !== 'paused') return;
  if (s.media.state === 'paused') s.media.resume();
  void s.ctx.resume();
  // The extra sound held while paused is stale: forgotten, never played into the meeting.
  s.extra?.feed.clear();
  step({ type: 'resume' });
}

/** The microphone closed and everything recorded on disk; the job left to finish (or to be thrown away). */
async function endCapture(s: Session): Promise<number> {
  const elapsedMs = recElapsed(live, Date.now());
  session = null;
  void stopExtra(s);
  if (s.retryTimer !== null) {
    clearTimeout(s.retryTimer);
    s.retryTimer = null;
  }
  step({ type: 'stop' });
  if (s.media.state !== 'inactive')
    await new Promise<void>((done) => {
      s.media.onstop = () => done();
      try {
        s.media.stop();
      } catch {
        done();
      }
    });
  // The last pieces of sound (the recorder's final data arrives just before it stops).
  const last = s.capture.flush();
  if (last) addPiece(s, last);
  flushSpeech(s);
  for (const t of [...(s.mic?.getTracks() ?? []), ...(s.pc?.getTracks() ?? [])]) t.stop();
  void s.ctx.close().catch(() => undefined);
  // Held writes (a full disk) tried once more before the window lets go; what will not land stays queued in memory.
  if (s.pendingWrites.length) {
    const held = s.pendingWrites.splice(0);
    try {
      for (const fn of held) await fn();
    } catch {
      s.pendingWrites.unshift(...held);
    }
  }
  await s.writes;
  return elapsedMs;
}

/** The window closing mid-meeting: the sound waiting in memory flushed and the job kept current (a few seconds most). */
export async function flushForClose(): Promise<void> {
  const s = session;
  if (!s) return;
  void stopExtra(s);
  flushSpeech(s);
  const elapsedMs = recElapsed(live, Date.now());
  const pieces = jobs.get(s.id)?.pieces;
  await Promise.race([
    (async () => {
      await s.writes;
      await window.nv.recorder.update(s.id, { elapsedMs, ...(pieces ? { pieces } : {}) }).catch(() => undefined);
      await s.writes;
    })(),
    new Promise((ok) => setTimeout(ok, 4000)),
  ]);
}

/** Stop: the recording saved into the note, the rest written down, then the notes made. */
export async function stopRecording(): Promise<void> {
  const s = session;
  if (!s || (live.phase !== 'recording' && live.phase !== 'paused')) return;
  const elapsedMs = await endCapture(s);
  const job = setJob(s.id, { elapsedMs, phase: 'stopped' });
  if (!job) return;
  await window.nv.recorder.update(s.id, { elapsedMs, phase: 'stopped' }).catch(() => undefined);
  await finishJob(s.id);
}

// ── Finishing a recording ────────────────────────────────────────────────────────────────────────────────────────────

/** The People notes' names (for links in the notes). */
function peopleNames(): string[] {
  const p = prefs();
  return notesOfType(getState().notes, 'person', getNoteTypes(), p.templatesFolder).map((n) => A.titleOf(n.path));
}

/** The note's words changed in place, as another tab's change would be (open editors follow; saved at once). */
async function changeNote(note: string, change: (text: string) => string): Promise<void> {
  await docs.acquire(note);
  try {
    const now = docs.text(note);
    if (now === undefined) throw new Error('The meeting note couldn’t be opened.');
    docs.update(note, change(now), 'recorder');
    await docs.flush(note);
  } finally {
    docs.release(note);
  }
}

/** The meeting note there to write into (made again, as a plain meeting note, if it went while the meeting finished). */
async function ensureNote(job: RecJob): Promise<void> {
  if (getState().byPath.has(job.note)) return;
  const exists = await window.nv.files.readText(job.note).then(() => true, () => false);
  if (exists) return;
  await window.nv.files.writeText(job.note, `---\ntype: meeting\ndate: ${job.date}\n---\n# ${job.title}\n`);
  await loadNotes();
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
};

/** The voices settled at the end: one final pass over the kept speech, the names set during the meeting carried on
 *  the right voices (differently-named voices never merge). Whatever fails leaves the transcript as it is — the rough
 *  live labels when there are some, else You and Others — said once in plain words. */
async function settleSpeakers(id: string): Promise<void> {
  const j = jobs.get(id);
  if (!j || !((j.speechSeconds ?? 0) > 1)) return;
  if (speakersReady === null) speakersReady = await window.nv.speakers.status().then((s) => s.ready, () => false);
  if (!speakersReady) return;
  setJob(id, { phase: 'settling' });
  await window.nv.recorder.update(id, { phase: 'settling' }).catch(() => undefined);
  const side = j.sources === 'mic+pc' ? 'pc' : 'mix';
  let turns: SpeakerTurn[] = [];
  try {
    turns = (await window.nv.speakers.liveEnd(id).catch(() => ({ turns: [] as SpeakerTurn[] }))).turns ?? [];
  } catch {
    turns = [];
  }
  // After a crash the live voices are gone with the restart: the pieces' own labels rebuild their moments.
  if (!turns.length) turns = liveTurnsFromPieces(j.pieces, side === 'pc' ? 'pc' : 'mix');
  if (!turns.length) turns = liveTurnsFromPieces(jobs.get(id)?.pieces ?? [], side === 'pc' ? 'pc' : 'mix');
  const names = liveNames.get(id) ?? jobs.get(id)?.speakers?.names ?? {};
  const attendees = notePeople(docs.text(j.note) ?? '', getState().byPath.get(j.note)?.props ?? {});
  const me = getPerson() ?? undefined;
  let final: SpeakerTurn[] = [];
  try {
    const r = await window.nv.speakers.final(id, j.sources, j.sources === 'mic+pc', turns, names, { title: j.title, attendees, ...(me ? { me } : {}) });
    if ('turns' in r) final = r.turns;
  } catch {
    final = [];
  }
  const cur = jobs.get(id);
  if (!cur) return;
  const v = speakerViewOf(id);
  if (final.length) {
    const carried = carrySpeakerNames(turns, final, names);
    const labelled = labelPieces(cur.pieces, final, cur.sources);
    liveTurns.set(id, final);
    liveNames.set(id, carried.names);
    const lost = carried.lost.length ? speakersSettledWords(carried.lost) : '';
    setJob(id, {
      pieces: labelled?.changed ? labelled.pieces : cur.pieces,
      speakers: { names: carried.names },
      speakerView: { marks: labelled?.marks ?? v.marks, names: carried.names, settled: true, ...(lost ? { notice: lost } : v.notice ? { notice: v.notice } : {}) },
    });
    void window.nv.recorder.update(id, { pieces: labelled?.changed ? labelled.pieces : cur.pieces, speakers: { names: carried.names } }).catch(() => undefined);
    // Voices the settle left unnamed but the meeting makes clear (after a crash the live pass never named them).
    applyAutoNames(id);
  } else if (v.marks.length) {
    setJob(id, { speakerView: { ...v, settled: true, notice: 'The final listen couldn’t run, so the speakers below are the rough ones from during the meeting.' } });
  } else if (!v.notice) {
    setJob(id, { speakerView: { ...v, settled: true, notice: speakersFallbackWords() } });
  }
}

/** Finishes a recording from what is on disk: Stop, Finish after a crash, and Try again all come here. */
export async function finishJob(id: string): Promise<void> {
  if (working.has(id)) return;
  let j = jobs.get(id);
  if (!j || live.id === id) return;
  working.add(id);
  await loadWordFixes().catch(() => undefined);
  const stopHere = () => cancelled.has(id) || !jobs.has(id);
  try {
    // Fresh from disk: how much speech there is (a crash may have left more than the pieces say).
    const fresh = (await window.nv.recorder.jobs().catch(() => [] as RecJob[])).find((x) => x.id === id);
    if (fresh) j = setJob(id, { speechSeconds: fresh.speechSeconds, audioBytes: fresh.audioBytes, elapsedMs: Math.max(j.elapsedMs, Math.round((fresh.speechSeconds ?? 0) * 1000)) }) ?? j;
    setJob(id, { working: true, interrupted: false, notice: undefined, words: undefined, canRetry: false });
    // 1. The recording into the note, first: nothing is lost whatever happens next.
    if (j.attachment === undefined && (!fresh || (fresh.audioBytes ?? 0) > 0)) {
      setJob(id, { phase: 'saving' });
      await ensureNote(j);
      try {
        const rel = await window.nv.recorder.keep(id, recordingName(j.title, new Date(j.began), j.ext), j.note);
        j = setJob(id, { attachment: rel }) ?? j;
        await loadFiles();
      } catch (err) {
        const words = plainError(err);
        if (/Nothing was recorded/.test(words)) j = setJob(id, { attachment: null }) ?? j;
        else {
          setJob(id, { phase: 'error', words: `The recording couldn’t be put in the note (${words}). It’s kept safe on this PC: Try again.`, canRetry: true });
          await window.nv.recorder.update(id, { phase: 'error' }).catch(() => undefined);
          return;
        }
      }
    }
    if (stopHere()) return;
    // 2. Whatever isn't written down yet, from the speech on disk.
    const status = await window.nv.recorder.status().catch((): RecorderStatus => ({ transcribe: false, systemAudio: false, pieceSeconds: 20 }));
    let pieces = [...(jobs.get(id)?.pieces ?? [])];
    if (status.transcribe) {
      const tail = tailPieces(pieces, j.speechSeconds ?? 0, status.pieceSeconds);
      if (tail.length) {
        pieces = [...pieces, ...tail];
        setJob(id, { pieces });
        await window.nv.recorder.update(id, { pieces }).catch(() => undefined);
      }
      // The live pieces still going count in the progress from here, so Stop says what it is doing with how far
      // along from the first moment (before, a backlog drained unseen while the card still said Saving).
      const gate = gateFor(id);
      if (gate.inFlight) {
        setJob(id, { phase: 'transcribing', progress: { done: 0, total: gate.inFlight } });
        await window.nv.recorder.update(id, { phase: 'transcribing' }).catch(() => undefined);
        await gate.drain();
        pieces = jobs.get(id)?.pieces ?? pieces;
      }
      const todo = piecesToDo(pieces, true);
      if (todo.length) {
        const done = jobs.get(id)?.progress?.done ?? 0;
        setJob(id, { phase: 'transcribing', progress: { done, total: done + todo.length } });
        await window.nv.recorder.update(id, { phase: 'transcribing' }).catch(() => undefined);
        let stopped = false;
        const flying: Promise<void>[] = [];
        for (const p of todo) {
          if (stopHere()) {
            stopped = true;
            break;
          }
          let wav: Uint8Array;
          try {
            wav = await window.nv.recorder.speech(id, p.start, p.seconds, p.side);
          } catch {
            putPiece(id, { ...p, status: 'failed', error: 'That part of the speech couldn’t be read back from disk.' });
            continue;
          }
          if (loudness(fromPcm16(wav.subarray(44))) < SEND_FLOOR) {
            putPiece(id, { ...p, status: 'quiet' });
            const g = jobs.get(id)?.progress;
            if (g) setJob(id, { progress: { ...g, done: g.done + 1 } });
            continue;
          }
          flying.push(send(id, p, wav));
        }
        await Promise.all(flying);
        if (stopped || stopHere()) return;
      }
    }
    if (stopHere()) return;
    // 2b. The voices settled over the kept speech (their failure never stops the notes).
    await settleSpeakers(id).catch(() => undefined);
    if (stopHere()) return;
    // 3. The notes, and the note written.
    await writeUp(id, status.transcribe);
  } finally {
    working.delete(id);
    gates.delete(id);
    if (jobs.has(id)) setJob(id, { working: false, progress: undefined });
  }
}

/** A meeting note with nothing of the person's in it: its properties, its title and the template's empty headings,
 *  bullets and boxes only. */
function blankMeeting(text: string): boolean {
  return !String(text || '')
    .replace(/^---[\s\S]*?\n---\s*/, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^[-*+]\s*(\[\s?\])?\s*$/.test(l) && !/^>\s*\[!quote\]/i.test(l) && !/^!\[\[.*\]\]$/.test(l))
    .length;
}

/** The notes made from the transcript and written into the meeting note with the recording and its transcript. */
async function writeUp(id: string, canTranscribe: boolean): Promise<void> {
  let j = jobs.get(id);
  if (!j) return;
  // Remembered corrections applied as the transcript lands (5 Nov 2026, minutes): the person's own decision for
  // this project, so next time it is right even where the service takes no hints.
  const remembered = fixesFor(projectKeyOf(j.note));
  const lines = Object.keys(remembered).length ? mergeTranscript(j.pieces).map((l) => ({ ...l, text: fixText(l.text, remembered) })) : mergeTranscript(j.pieces);
  const people = peopleNames();
  const rel = j.attachment ?? null;
  // The note as it is, without this recording's part (written again, never twice), and the other recordings in it.
  await ensureNote(j);
  const current = docs.text(j.note) ?? (await window.nv.files.readText(j.note).catch(() => ''));
  const base = rel ? dropTranscriptPart(current, rel) : current;
  const others = readTranscript(base).filter((p) => !rel || !p.recording || !p.recording.endsWith(rel.split('/').pop() ?? rel));
  const part = others.length ? `Part ${others.length + 1} · ${hhmm(j.began)}` : undefined;
  const earlier: TranscriptLine[][] = others.map((p) => p.lines);
  // Who each voice is, per recording: earlier parts' names from the note, this part's from the settle. The note keeps
  // "Speaker N" labels (an older version shows them), and the write-up is asked with those same labels, the names
  // told beside them (6 Nov 2026, the first real owners run: lines already reading "Alex Rivera:" handed every
  // mixed segment's jobs to the two named voices, six owners wrong of twelve).
  const earlierNames = others.map((p, i) => readSpeakerNames(base, speakerPartKey(i, p.heading)));
  const myNames = liveNames.get(id) ?? jobs.get(id)?.speakers?.names ?? {};
  const myMarks = jobs.get(id)?.speakerView?.marks ?? marksFromLines(lines, j.sources === 'mic+pc' ? 'pc' : 'mix');
  const speakerParts = [
    ...others.map((p, i) => ({ ...(p.heading ? { heading: p.heading } : {}), marks: marksFromLines(p.lines, 'mix' as const), names: earlierNames[i] })),
    { ...(part ? { heading: part } : {}), marks: myMarks, names: myNames },
  ].filter((p) => p.marks.length);
  let notes: MeetingNotes | null = null;
  let why = '';
  let me: string | undefined;
  // Plain words plus the setup button on the card (9.2 uplift F74): no engine or key names.
  if (!canTranscribe) why = 'To write it down, add a transcription connection first.';
  else if (!lines.length) {
    const failed = j.pieces.filter((p) => p.status === 'failed');
    const reason = failed.at(-1)?.error?.replace(/\s*$/, '') ?? '';
    why = failed.length ? `None of the meeting could be written down${reason ? `: ${reason}` : '.'}` : 'Nothing was said that could be written down. Check the microphone’s meter moves next time.';
  }
  else {
    setJob(id, { phase: 'notes' });
    await window.nv.recorder.update(id, { phase: 'notes' }).catch(() => undefined);
    const all = [...earlier.map((ls, i) => `— Part ${i + 1} —\n${transcriptText(ls)}`), `${earlier.length ? `— Part ${earlier.length + 1} —\n` : ''}${transcriptText(lines)}`].join('\n\n');
    // The recorder's name, so the write-up names them and never "You": the app's account name, else the name
    // the notes know (5 Nov 2026, p7-minutes-for-others).
    me = getPerson() ?? undefined;
    try {
      // The meeting's own people ride along (6 Nov 2026, owners): only they can own a job.
      const attendees = notePeople(current, getState().byPath.get(j.note)?.props ?? {});
      const r = await window.nv.recorder.notes(j.note, { title: j.title, date: j.date, transcript: all, people, ...(attendees.length ? { attendees } : {}), ...(me ? { me } : {}), ...(speakerParts.length ? { speakers: { parts: speakerParts } } : {}) });
      notes = r.notes;
      if (!notes) why = r.error ?? 'The notes couldn’t be made.';
    } catch (err) {
      why = plainError(err);
    }
  }
  if (cancelled.has(id) || !jobs.has(id)) return;
  j = jobs.get(id)!;
  const missed = missedSeconds(j.pieces);
  // Many very short far-side answers kept in the transcript, but the card says words may be missing and the recording
  // stays (5 Nov 2026, s2-recorder-survives second round): never noticed mid-meeting, never resent.
  const shortOthers = hasManyShortOthers(j.pieces);
  const fate = rel ? (shortOthers ? 'keep' : recordingFate(prefs().meetingAudio, !!notes, missed)) : 'trash';
  const kept = rel && fate === 'keep' ? rel : null;
  const length = lengthWords(j.elapsedMs);
  const recordingLine = kept ? `Recording: ${writeLink(kept, j.note)} · ${length}` : undefined;
  const timeLink = kept ? (t: number) => writeLink(kept, j!.note, { heading: stamp(t), alias: stamp(t) }) : undefined;
  // Nothing said at all, into a note that is still only its blank meeting template: nothing is kept (26 Oct 2026, the
  // vault held two "Untitled meeting" notes from test recordings that caught nothing). The note and the recording go to
  // Recently deleted, and the corner says so.
  if (canTranscribe && !lines.length && !missed && !others.length && blankMeeting(base)) {
    for (const p of [j.note, rel]) if (p) await window.nv.files.trash(p).catch(() => undefined);
    await loadNotes();
    await loadFiles();
    await window.nv.recorder.discard(id).catch(() => undefined);
    jobs.delete(id);
    forgetSpeakers(id);
    gates.delete(id);
    emit();
    toast('Nothing was said, so no meeting note was kept. Check the microphone’s meter moves next time.', undefined, 7000);
    return;
  }
  let added = 0;
  let namesUnsaved = '';
  try {
    // Stretches that failed join the transcript as lines saying they need another pass (5 Nov 2026,
    // s2-recorder-survives; short answers kept, never gaps, second round): each with its moment to play from.
    const noteLines = [...lines, ...gapLines(j.pieces)].sort((a, b) => a.at - b.at);
    await changeNote(j.note, (text) => {
      const start = rel ? dropTranscriptPart(text, rel) : text;
      const empty = !canTranscribe ? 'Not written down: writing a recording down needs speech set up (Settings › Capture › Voice and meetings).' : missed ? 'Not written down yet: Try again in the meeting’s card above.' : undefined;
      const r = applyMeetingNotes(start, notes, { transcript: noteLines, length, people, date: j.date, recording: recordingLine, timeLink, ...(me ? { me } : {}), ...(part ? { part } : {}), ...(empty ? { empty } : {}) });
      added = r.added;
      // This recording's names into the note's properties (an older version ignores them; a re-recorded part's old
      // names go with it).
      const key = speakerPartKey(others.length, part);
      const pruned = pruneSpeakerNames(r.text, [...others.map((p, i) => speakerPartKey(i, p.heading)), key]);
      // Properties that can't be read must not silently eat the names (break-it 6): they stay with the meeting
      // (liveNames and the job), and the card's words say so below.
      const kept = tryWriteSpeakerNames(pruned, key, myNames);
      if (!kept.saved && Object.keys(myNames).length) namesUnsaved = kept.words;
      // Names set during the meeting fill the owners those voices took on (7 Nov 2026, j1).
      return fillVoiceOwners(kept.text);
    });
  } catch (err) {
    setJob(id, { phase: 'error', words: `The meeting note couldn’t be written (${plainError(err)}).${rel ? ` The recording is safe: ${A.nameOf(rel)}.` : ''}`, canRetry: true });
    await window.nv.recorder.update(id, { phase: 'error' }).catch(() => undefined);
    return;
  }
  // The recording to Recently deleted once the notes are in, when Settings say so.
  let trashed = false;
  if (rel && fate === 'trash' && notes) {
    try {
      await window.nv.files.trash(rel);
      trashed = true;
      await loadFiles();
    } catch {
      // It stays; the words say so.
    }
  }
  const reason = j.pieces.filter((p) => p.status === 'failed').at(-1)?.error?.replace(/[.\s]*$/, '') ?? '';
  const shortLine = shortOthers && kept ? otherSideShortWords() : '';
  const tail = [lines.length && missed ? `${missedWords(missed)} couldn’t be written down${reason ? ` (${reason})` : ''}: Try again once that’s sorted.` : !lines.length && missed ? 'The recording is safe in the note: Try again once that’s sorted.' : '', shortLine, namesUnsaved, trashed ? 'The recording went to Recently deleted (Settings › Capture › Voice and meetings).' : ''].filter(Boolean).join(' ');
  const failedNotes = !notes && lines.length > 0 && canTranscribe;
  const words = notes ? `${notesWords(notes, added)} ${tail}`.trim() : failedNotes ? `The transcript is in the note, but the notes couldn’t be made: ${why} ${tail}`.trim() : `${why}${kept && !missed ? ' The recording is in the note.' : ''} ${tail}`.trim();
  const phase = failedNotes ? 'error' : 'done';
  const canRetry = failedNotes || missed > 0;
  setJob(id, { phase, words, canRetry, canSetup: !canTranscribe, attachment: trashed ? null : rel, trashed });
  if (canRetry) await window.nv.recorder.update(id, { phase, words, attachment: trashed ? null : rel, trashed }).catch(() => undefined);
  // Written up in full: its folder on this PC isn't needed any more (the recording is among the notes).
  else await window.nv.recorder.discard(id).catch(() => undefined);
  // Its note out of sight (the person moved on): said in the corner too, with the way back.
  if (!hasPanel(j.note)) toast(words, { label: 'Open', run: () => A.openPath(j!.note, { where: 'current' }) }, 9000);
}

/** Try again: the parts not written down, then the notes (or only the notes, when it was they that failed). */
export function retryJob(id: string): Promise<void> {
  return finishJob(id);
}

/** A finished card put away; a job kept only for Try again is let go (its recording and transcript stay in the note). */
export function dismissJob(id: string): void {
  const j = jobs.get(id);
  if (!j || j.working || live.id === id) return;
  jobs.delete(id);
  forgetSpeakers(id);
  gates.delete(id);
  emit();
  if (!j.interrupted) void window.nv.recorder.discard(id).catch(() => undefined);
}

/** Discard after a crash: the recording thrown away (to Recently deleted when it was already among the notes). */
export async function discardJob(id: string): Promise<void> {
  const j = jobs.get(id);
  if (!j || j.working || live.id === id) return;
  jobs.delete(id);
  forgetSpeakers(id);
  void window.nv.speakers.liveEnd(id).catch(() => undefined);
  gates.delete(id);
  emit();
  if (j.attachment) await window.nv.files.trash(j.attachment).catch(() => undefined);
  await window.nv.recorder.discard(id).catch(() => undefined);
}

// ── After a crash or a restart ───────────────────────────────────────────────────────────────────────────────────────

let loaded = '';

/** The recordings left unfinished on this PC (Ironleaf closed mid-meeting, or mid-way through writing one up), in
 *  the notes folder open now. */
export async function loadJobs(): Promise<void> {
  const vault = getState().vault?.path;
  if (!vault || loaded === vault) return;
  loaded = vault;
  for (const j of [...jobs.values()]) if (j.vault && j.vault !== vault && !j.working && live.id !== j.id) jobs.delete(j.id);
  // A failed read is not "none found" (W5-18): leave loaded unset so it is tried again.
  const found = await window.nv.recorder.jobs().catch(() => null);
  if (!found) {
    loaded = '';
    return;
  }
  for (const raw of found) {
    const j = cleanJob(raw);
    if (!j || jobs.has(j.id) || live.id === j.id || (j.vault && j.vault !== vault)) continue;
    const unfinished = j.phase !== 'done' && j.phase !== 'error';
    // Nothing recorded at all (it crashed as it began): nothing to offer.
    if (unfinished && !(j.audioBytes || j.speechSeconds)) {
      void window.nv.recorder.discard(j.id).catch(() => undefined);
      continue;
    }
    jobs.set(j.id, { ...j, elapsedMs: Math.max(j.elapsedMs, Math.round((j.speechSeconds ?? 0) * 1000)), working: false, interrupted: unfinished, canRetry: !unfinished });
    // A name set before the crash is never lost: the pieces' own labels rebuild the voices' moments at the end.
    if (j.speakers?.names) liveNames.set(j.id, { ...j.speakers.names });
    const marks = marksFromLines(mergeTranscript(j.pieces), j.sources === 'mic+pc' ? 'pc' : 'mix');
    if (marks.length || j.speakers?.names) {
      const cur = jobs.get(j.id)!;
      jobs.set(j.id, { ...cur, speakerView: { marks, names: j.speakers?.names ?? {}, settled: false } });
    }
  }
  emit();
}

// ── Following the note ───────────────────────────────────────────────────────────────────────────────────────────────

onNoteMoved((from, to) => {
  let changed = false;
  if (live.note && movedPath(live.note, from, to) !== live.note) {
    step({ type: 'moved', from, to });
    if (session) session.note = live.note!;
  }
  const before = [...jobs.values()];
  jobsAfterMove(before, from, to).forEach((j, i) => {
    if (j === before[i]) return;
    jobs.set(j.id, j);
    void window.nv.recorder.update(j.id, { note: j.note }).catch(() => undefined);
    changed = true;
  });
  const moved = new Map<string, number>();
  for (const [p, n] of panels) moved.set(movedPath(p, from, to), (moved.get(movedPath(p, from, to)) ?? 0) + n);
  panels.clear();
  for (const [p, n] of moved) panels.set(p, n);
  if (changed) emit();
});

onNoteRemoved((path) => {
  // Its recording going on now stops; the sound goes to Recently deleted with the note (never lost, never in the way).
  const s = session;
  if (s && live.note && goneWith(live.note, path)) void stopForDeleted(s);
  for (const j of jobsAfterRemove([...jobs.values()], path).gone) {
    if (j.id === s?.id) continue;
    cancelled.add(j.id);
    jobs.delete(j.id);
    forgetSpeakers(j.id);
    gates.delete(j.id);
    if (j.attachment && !j.trashed) void window.nv.files.trash(j.attachment).then(loadFiles, () => undefined);
    void window.nv.recorder.discard(j.id).catch(() => undefined);
  }
  emit();
});

async function stopForDeleted(s: Session): Promise<void> {
  const title = A.titleOf(s.note);
  cancelled.add(s.id);
  await endCapture(s);
  const j = jobs.get(s.id);
  jobs.delete(s.id);
  gates.delete(s.id);
  emit();
  let binned = false;
  try {
    if (j && (await window.nv.recorder.jobs()).some((x) => x.id === s.id && (x.audioBytes ?? 0) > 0)) {
      const rel = await window.nv.recorder.keep(s.id, recordingName(j.title, new Date(j.began), j.ext), s.note);
      await window.nv.files.trash(rel);
      binned = true;
      await loadFiles();
    }
  } catch {
    // Nothing more to keep.
  }
  await window.nv.recorder.discard(s.id).catch(() => undefined);
  toast(`The recording of “${title}” stopped because the note was deleted.${binned ? ' Its sound is in Recently deleted.' : ''}`, undefined, 8000);
}
