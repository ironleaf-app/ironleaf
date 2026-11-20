// The meeting recorder's main side (21 Oct 2026, gap G18; rebuilt 22 Oct 2026. The recording's rules are
// src/shared/recorder.ts, the write-up's src/shared/meeting-notes.ts). Four jobs:
//
//   - each piece of a recording written down by the former host app (the host's transcribeAudio, which sends it to the
//   person's
//     own speech service: this PC's speech model, or their OpenAI or Gemini key; native-runtime/plugins/desktop/
//     audio-files.mjs). Ironleaf never holds a key or reaches a provider itself; on its own it has no transcription,
//     says so before the meeting starts, and keeps the sound.
//   - the recording kept on disk AS IT GOES, in Ironleaf's own data (recordings/<id>/: the recording as Chromium
//     encodes it, the speech at 16 kHz for writing down, and the job's record), so a crash, a closed window or a restart
//     mid-meeting loses at most a few seconds; the next start offers to finish it. The recording goes among the notes
//     (the meeting's attachment) at Stop; the folder is removed once the meeting is written up.
//   - the notes made from the transcript on Ironleaf's usual model (src/main/ai.ts askJson), checked before the window
//     writes them into the note.
//   - the window allowed the microphone, and on Windows the PC's own sound (the other side of a call, Chromium's loopback
//     capture through getDisplayMedia), only for Ironleaf's own window and only once a recording starts. Everything
//     else keeps the answer it had: inside the former host app every other permission stays refused, as the former host
//     app set it.
//
// Why the PC's sound never recorded before (found 22 Oct 2026 on Electron 44, a user's 6.2.2): getDisplayMedia's
// permission arrives as 'media' with NO device types (Electron names only cameras and microphones), never as
// 'display-capture'; the old rule allowed 'media' only when every type was audio, so it refused, getDisplayMedia failed
// with NotAllowedError, and the window said "The PC's sound couldn't be recorded". The handler also handed over a whole
// screen from desktopCapturer (none on a locked or remote session); it now hands over Ironleaf's own window, whose
// picture is stopped at once, with the PC's sound (proved on the build laptop's Windows, Electron 44.2.0).
//
// No Electron import here (it is handed in), so the node tests run this file as it is.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { isPrivatePath } from '../shared/private';
import { MEETING_NOTES_SYSTEM, meetingNotesPrompt, mergeMeetingNotes, readMeetingReply, transcriptLinesFromText, type MeetingNotes, type SpeakersForPrompt } from '../shared/meeting-notes';
import { MINUTES_SYSTEM, minutesFromExisting, minutesPrompt, mergeMeetingMinutes, readMinutesReply, type MeetingMinutes } from '../shared/meeting-minutes';
import type { SpeakerMark, SpeakerNames } from '../shared/meeting-speakers';
import { chunkTranscript, cleanJob, diskFullWords, englishOnly, fromPcm16Stereo, isDiskFull, JOB_ID, mixStereoToMono, PIECE_RATE, PIECE_SECONDS, scrubHintEcho, scrubTranscribeError, toPcm16, transcribeAuthWords, transcribeErrorKind, wavOfPcm, type RecJob, type TranscribeErrorKind } from '../shared/recorder';
import { createExtraLoopback, type ExtraChild, type ExtraStartResult, type ExtraStatus } from './extra-loopback';

export interface Transcribed {
  text: string;
  segments?: { start: number; text: string; speaker?: string }[];
}

/** Writing a piece down failed: plain words, and what kind (offline waits for the network, a refused key waits for the person). */
export interface TranscribeFailure {
  error: string;
  kind: TranscribeErrorKind;
}

/** How long one transcript ask may take: two minutes for a short meeting, longer with the transcript, never past
 *  nine minutes (under the route's ten). A 25-minute meeting has time to finish (5 Nov 2026, the minutes died at a
 *  flat four minutes over 1.8 KB). Each chunk of a long transcript gets its own time. */
export function transcriptAskTimeoutMs(transcript: string): number {
  return Math.min(540_000, 120_000 + Math.ceil(transcript.length / 1000) * 2000);
}

/** What the former host app says about writing recordings down, before a meeting starts. */
export interface Transcriber {
  /** Pieces can be written down now. */
  ready: boolean;
  /** Where the writing-down happens, said the one plain way for every provider (the note page once named
   *  the engine that did it, an engine's name to a person): on this PC, or by
   *  the speech service the person connected. Never a provider's or engine's name. */
  where?: 'pc' | 'service';
  /** Why not, in plain words (what to set up, and where). */
  words?: string;
  /** No transcription connection is chosen yet (Settings › AI): the card offers "Add a transcription connection". */
  needsSetup?: boolean;
}

/** The most one piece may be (the former host app's speech services take 4 MB: two minutes at 16 kHz). */
export const MAX_PIECE_BYTES = 4 * 1024 * 1024;
/** How long one piece may take to be written down. */
const PIECE_TIMEOUT_MS = 90_000;
/** The most of one recording kept on disk (a whole working day). */
const MAX_RECORDING_BYTES = 2 * 1024 * 1024 * 1024;

/** The former host app's answer for a piece checked: its words, and its timed segments when it gave
them. */
export function cleanTranscribed(raw: unknown): Transcribed | null {
  if (typeof raw === 'string') return { text: raw.replace(/\s+/g, ' ').trim().slice(0, 50_000) };
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.text !== 'string') return null;
  const segments: { start: number; text: string; speaker?: string }[] = [];
  if (Array.isArray(r.segments))
    for (const s of r.segments.slice(0, 2000)) {
      const x = s && typeof s === 'object' ? (s as Record<string, unknown>) : null;
      if (!x || typeof x.start !== 'number' || !Number.isFinite(x.start) || x.start < 0 || typeof x.text !== 'string' || !x.text.trim()) continue;
      const speaker = typeof x.speaker === 'string' && x.speaker.trim() ? x.speaker.trim().slice(0, 40) : '';
      segments.push({ start: x.start, text: x.text.replace(/\s+/g, ' ').trim().slice(0, 4000), ...(speaker ? { speaker } : {}) });
    }
  // A piece heard as one segment at its start says no more than its words.
  const useful = segments.length > 1 || segments.some((s) => s.speaker || s.start > 0.5);
  return { text: r.text.replace(/\s+/g, ' ').trim().slice(0, 50_000), ...(useful ? { segments } : {}) };
}

/** The plan for writing recordings down (the transcription connection's status), checked. The provider's own name never rides through:
 *  only where it happens, so no route can put an engine's name in front of a person (7 Nov 2026, j1). */
export function cleanTranscriber(raw: unknown): Transcriber | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.ready !== 'boolean') return null;
  const route = typeof r.route === 'string' ? r.route : '';
  const where = route === 'local' ? 'pc' : r.ready && (route || (typeof r.provider === 'string' && r.provider)) ? 'service' : undefined;
  return { ready: r.ready, ...(where ? { where } : {}), ...(typeof r.error === 'string' && r.error ? { words: r.error.slice(0, 400) } : {}), ...(!r.ready && r.setUp === false ? { needsSetup: true } : {}) };
}

export interface RecorderDeps {
  handle(channel: string, fn: (...args: any[]) => unknown): void;
  requireCreate(): Promise<void>;
  /** One question for a JSON answer on the chat's model (src/main/ai.ts). */
  askJson(system: string, user: string, timeoutMs?: number, maxTokens?: number, opts?: { signal?: AbortSignal }): Promise<{ reply: unknown; error?: string }>;
  /** Inside the former host app: a piece written down (the host's transcribeAudio). The meeting's own names ride as
   *  hints. The wait's own signal rides too: a piece given up as late aborts the server call with it, so nothing
   *  keeps transcribing and billing after the Vault moved on (13 Nov 2026, t259: the race never aborted). The
   *  language rides when given (meetings send 'en': the product transcribes English, 18 Nov 2026, t301). */
  transcribe?(audio: Uint8Array, mime: string, hints?: string[], opts?: { signal?: AbortSignal; language?: string }): Promise<unknown>;
  /** Inside the former host app: where pieces would be written down, asked before a meeting starts. */
  transcribeStatus?(): Promise<unknown>;
  /** A development build's screen tests: what each piece "says", in turn (NV_TEST_TRANSCRIPT; never in the product). */
  testLines?: () => Promise<unknown[]>;
  /** The window allowed to record, when a recording starts (app.ts; Electron handed in there). */
  prepare?(): void;
  platform: NodeJS.Platform;
  /** A development build's screen tests on Linux record the PC's sound too (NV_TEST_SYSTEM_AUDIO). */
  systemAudio?: boolean;
  /** A development build's screen tests may cut shorter pieces (NV_TEST_PIECE_SECONDS). */
  pieceSeconds?: number;
  /** How long one piece may take to be written down (tests shorten it; the product leaves the 90 s rule). */
  pieceTimeoutMs?: number;
  /** Where recordings are kept while they record and until they are written up (Ironleaf's own data). */
  dataDir: string;
  /** A file copied among the notes as a note's attachment (its unique name in the note's attachments folder). */
  saveFile(name: string, file: string, forNote: string): Promise<string>;
  /** The extra far-side capture (m6, any output): how to spawn its contained child, tell the window, and find its
   *  files. Absent: the part is simply not there (off Windows, or an install from before it). */
  extra?: {
    here: string;
    fork: (childPath: string, vendorPath: string) => ExtraChild;
    send: (channel: string, payload: unknown) => void;
  };
}

/** The extra far-side capture's sound, as the window receives it: 16 kHz mono samples with their order and loudness. */
export interface ExtraAudio {
  seq: number;
  pcm: Uint8Array;
  rms: number;
}

export interface RecorderStatus {
  /** Pieces can be written down (the former host app is there, or a test stands in). */
  transcribe: boolean;
  /** What the former host app says about it now (asked fresh each time). */
  transcriber?: Transcriber;
  /** The PC's own sound can be recorded too (Windows). */
  systemAudio: boolean;
  pieceSeconds: number;
  /** The extra far-side capture is here to run (Windows, its files beside the app). */
  extra?: boolean;
}

/** A recording's folder, and the files in it. */
function files(dataDir: string, id: string) {
  const dir = path.join(dataDir, 'recordings', id);
  return { dir, job: path.join(dir, 'job.json'), audio: path.join(dir, 'audio.bin'), speech: path.join(dir, 'speech.pcm') };
}

export function registerRecorder(d: RecorderDeps) {
  let testAt = 0;
  const systemAudio = d.platform === 'win32' || !!d.systemAudio;
  const pieceSeconds = d.pieceSeconds ?? PIECE_SECONDS;
  // The extra far-side capture (m6): its own manager, its own channels below; nothing else here knows it.
  const extra = d.extra ? createExtraLoopback({ platform: d.platform, here: d.extra.here, fork: d.extra.fork, send: d.extra.send }) : null;
  const status = (): RecorderStatus => ({
    transcribe: !!d.transcribe || !!d.testLines,
    systemAudio,
    pieceSeconds,
    ...(extra ? { extra: extra.status().available } : {}),
  });

  async function freshStatus(): Promise<RecorderStatus> {
    const s = status();
    if (d.testLines && !d.transcribe) return { ...s, transcriber: { ready: true, where: 'service' } };
    if (!d.transcribe) return { ...s, transcriber: { ready: false, words: 'No transcription connection is set up yet.', needsSetup: true } };
    if (!d.transcribeStatus) return s;
    try {
      const t = cleanTranscriber(await Promise.race([d.transcribeStatus(), new Promise((ok) => setTimeout(() => ok(null), 8000))]));
      return t ? { ...s, transcriber: t } : s;
    } catch {
      return s;
    }
  }

  async function transcribe(audio: unknown, mime: unknown, hints: unknown): Promise<Transcribed | TranscribeFailure> {
    if (!(audio instanceof Uint8Array) || audio.byteLength < 44) return { error: 'That part of the recording didn’t arrive whole.', kind: 'other' };
    if (audio.byteLength > MAX_PIECE_BYTES) return { error: 'That part of the recording was too long to write down in one go.', kind: 'other' };
    const type = typeof mime === 'string' && /^audio\/[a-z0-9.+-]+$/i.test(mime) ? mime : 'audio/wav';
    // A refusal in plain words with what to do (a raw provider refusal is never shown as is, and never a secret).
    const refused = (raw: string): TranscribeFailure => {
      const kind = transcribeErrorKind(raw, '');
      if (kind === 'auth') return { error: transcribeAuthWords(), kind };
      if (kind === 'offline') return { error: 'The speech service couldn’t be reached to write it down. The recording is kept; try again in a moment.', kind };
      return { error: scrubTranscribeError(raw).slice(0, 300) || 'The speech service couldn’t write that part down.', kind: 'other' };
    };
    // The meeting's own names ride as hints for the hearing service (r2: the note's people and project, with its title).
    const hintWords = Array.isArray(hints) ? [...new Set(hints.filter((h): h is string => typeof h === 'string' && !!h.trim()).map((h) => h.trim().slice(0, 60)))].slice(0, 40) : [];
    // Whatever comes back with the hint's echo in it has the echo taken out (12 Nov 2026: the hint read back as
    // speech on quiet audio) — every piece's text and segments, so the hint never reaches a transcript, live or final.
    // Whatever comes back in another script is English-only first (18 Nov 2026, t301): a stray fragment dropped, a
    // piece with nothing English in it [inaudible] (speech was heard; it carried meaning in no words kept here).
    const kept = (t: Transcribed): Transcribed => {
      const english = englishOnly(t.text, hintWords);
      const text = scrubHintEcho(english, hintWords);
      const segments = t.segments?.map((s) => ({ ...s, text: scrubHintEcho(englishOnly(s.text, hintWords), hintWords) })).filter((s) => s.text.trim());
      // Nothing English in it: speech was heard, so the line says so. Nothing but the hint's echo: quiet, as before.
      if (!text.trim() && t.text.trim()) return english.trim() ? { text: '', ...(segments?.length ? { segments } : {}) } : { text: '[inaudible]' };
      return { text, ...(segments?.length ? { segments } : {}) };
    };
    if (d.testLines) {
      const lines = await d.testLines();
      const next = lines[testAt++] ?? '';
      if (next && typeof next === 'object' && typeof (next as { error?: unknown }).error === 'string') return refused(String((next as { error: string }).error));
      if (next && typeof next === 'object' && typeof (next as { wait?: unknown }).wait === 'number') await new Promise((ok) => setTimeout(ok, Math.min(30_000, (next as { wait: number }).wait)));
      const stood = cleanTranscribed(next);
      return stood ? kept(stood) : { text: '' };
    }
    if (!d.transcribe) return { error: 'Add a transcription connection in Settings › AI to have recordings written down. The recording is kept in the note.', kind: 'other' };
    let timer: NodeJS.Timeout | undefined;
    // A piece given up as late aborts the server call with it (13 Nov 2026, t259: the race moved on but the slow
    // piece kept transcribing and billing). The retry is a new call, billed once.
    const stop = new AbortController();
    try {
      const late = new Promise<'late'>((resolve) => {
        timer = setTimeout(() => resolve('late'), d.pieceTimeoutMs ?? PIECE_TIMEOUT_MS);
      });
      // Meetings are transcribed in English (18 Nov 2026, t301: the product transcribes English only).
      const raw = await Promise.race([d.transcribe(audio, type, hintWords, { signal: stop.signal, language: 'en' }), late]);
      if (raw === 'late') {
        stop.abort();
        return { error: 'The speech service took too long to answer. Check the internet connection, then try again.', kind: 'offline' };
      }
      if (raw && typeof raw === 'object' && typeof (raw as { error?: unknown }).error === 'string') return refused(String((raw as { error: string }).error));
      const heard = cleanTranscribed(raw);
      return heard ? kept(heard) : { error: 'The speech service’s answer couldn’t be read.', kind: 'other' };
    } catch (err) {
      const words = scrubTranscribeError(err instanceof Error ? err.message : String(err)).replace(/^Error:\s*/, '').slice(0, 300);
      const code = typeof (err as { code?: unknown })?.code === 'string' ? String((err as { code: string }).code) : '';
      const kind = transcribeErrorKind(words, code);
      if (kind === 'offline') return { error: 'The speech service couldn’t be reached to write it down. The recording is kept; try again in a moment.', kind };
      if (kind === 'auth') return { error: transcribeAuthWords(), kind };
      return { error: words || 'The speech service couldn’t write that part down.', kind: 'other' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Asks in flight, by the window's id for them: stopping one aborts its wait. */
  const asks = new Map<string, AbortController>();
  const askId = (id: unknown) => (typeof id === 'string' && id.length >= 1 && id.length <= 128 ? id : '');

  /** The numbered voices checked (6 Nov 2026, speakers): each recording's marks with the names set on them
   *  (one recording's, or each under its heading; junk reads as none). */
  const cleanSpeakers = (raw: unknown): SpeakersForPrompt | null => {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    const cleanMarks = (list: unknown): SpeakerMark[] => (Array.isArray(list) ? (list as unknown[]).filter((m): m is SpeakerMark => !!m && typeof m === 'object' && /^spk[1-9]\d*$/.test((m as SpeakerMark).id ?? '')).slice(0, 8) : []).map((m) => ({ id: m.id, side: m.side === 'mic' || m.side === 'pc' ? m.side : 'mix', clipAt: typeof m.clipAt === 'number' ? m.clipAt : 0, clipLen: typeof m.clipLen === 'number' ? m.clipLen : 6 }));
    const cleanNames = (list: unknown): SpeakerNames => {
      const names: SpeakerNames = {};
      const rn = list && typeof list === 'object' && !Array.isArray(list) ? (list as Record<string, unknown>) : {};
      for (const [k, v] of Object.entries(rn)) {
        if (/^spk[1-9]\d*$/.test(k) && typeof v === 'string' && v.trim()) names[k] = v.trim().slice(0, 80);
      }
      return names;
    };
    if (Array.isArray(r?.parts)) {
      const parts = (r!.parts as unknown[]).map((p) => {
        const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
        return { ...(typeof o.heading === 'string' && o.heading ? { heading: o.heading.slice(0, 120) } : {}), marks: cleanMarks(o.marks), names: cleanNames(o.names) };
      }).filter((p) => p.marks.length).slice(0, 20);
      return parts.length ? { parts } : null;
    }
    const marks = cleanMarks(r?.marks);
    return marks.length ? { marks, names: cleanNames(r?.names) } : null;
  };

  /** The voices' names as one map for the readers (a voice two recordings name differently is left out). */
  const mergedSpeakerNames = (speakers: SpeakersForPrompt | null): SpeakerNames => {
    if (!speakers) return {};
    const maps = 'parts' in speakers ? speakers.parts.map((p) => p.names) : [speakers.names];
    const seen = new Map<string, string>();
    const clash = new Set<string>();
    for (const m of maps) for (const [id, name] of Object.entries(m)) {
      const had = seen.get(id);
      if (had && had.toLowerCase() !== name.toLowerCase()) clash.add(id);
      else seen.set(id, name);
    }
    const out: SpeakerNames = {};
    for (const [id, name] of seen) if (!clash.has(id)) out[id] = name;
    return out;
  };

  /** The voices found, as ids for the readers (a "Speaker N" owner is kept only for a voice that really spoke). */
  const mergedSpeakerIds = (speakers: SpeakersForPrompt | null): string[] => {
    if (!speakers) return [];
    return [...new Set(('parts' in speakers ? speakers.parts.flatMap((p) => p.marks) : speakers.marks).map((m) => m.id))];
  };

  async function notes(note: unknown, input: unknown, requestId?: unknown): Promise<{ notes: MeetingNotes | null; error?: string }> {
    const rel = typeof note === 'string' ? note : '';
    if (isPrivatePath(rel)) return { notes: null, error: 'Private notes aren’t sent to the AI.' };
    const i = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const transcript = typeof i.transcript === 'string' ? i.transcript : '';
    if (!transcript.trim()) return { notes: null, error: 'Nothing was written down from the recording, so there were no notes to make.' };
    const people = Array.isArray(i.people) ? i.people.filter((p): p is string => typeof p === 'string' && p.length <= 120).slice(0, 300) : [];
    const attendees = Array.isArray(i.attendees) ? i.attendees.filter((p): p is string => typeof p === 'string' && !!p.trim() && p.length <= 120).slice(0, 60) : [];
    const me = typeof i.me === 'string' && i.me.trim() ? i.me.trim().slice(0, 80) : '';
    const title = typeof i.title === 'string' ? i.title.slice(0, 200) : 'Meeting';
    const date = typeof i.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.date) ? i.date : '';
    const speakers = cleanSpeakers(i.speakers);
    const speakerNames = mergedSpeakerNames(speakers);
    const id = askId(requestId);
    const controller = new AbortController();
    if (id) asks.set(id, controller);
    try {
      // A long transcript goes in parts that fit, each with its own time, and comes back as one (5 Nov 2026:
      // the middle was cut out past three hours, whole lines lost). One part goes as it always did.
      const chunks = chunkTranscript(transcript);
      const said = transcriptLinesFromText(transcript);
      const parts: MeetingNotes[] = [];
      for (let n = 0; n < chunks.length; n++) {
        if (controller.signal.aborted) return { notes: null, error: 'Stopped.' };
        const user = meetingNotesPrompt({ title: chunks.length > 1 ? `${title} (part ${n + 1} of ${chunks.length})` : title, date, people, ...(attendees.length ? { attendees } : {}), ...(me ? { me } : {}), ...(speakers ? { speakers } : {}), transcript: chunks[n] });
        const { reply, error } = await d.askJson(MEETING_NOTES_SYSTEM, user, transcriptAskTimeoutMs(chunks[n]), 6000, { signal: controller.signal });
        if (error) return { notes: null, error };
        const read = readMeetingReply(reply, { ...(me ? { me } : {}), ...(said.length ? { transcript: said } : {}), ...(date ? { date } : {}), speakerNames, voices: mergedSpeakerIds(speakers), ...(attendees.length ? { attendees } : {}) });
        if (!read) return { notes: null, error: 'The assistant’s notes couldn’t be read. Try Make notes again.' };
        parts.push(read);
      }
      const merged = mergeMeetingNotes(parts);
      return merged ? { notes: merged } : { notes: null, error: 'The assistant’s notes couldn’t be read. Try Make notes again.' };
    } finally {
      if (id) asks.delete(id);
    }
  }

  async function minutes(note: unknown, input: unknown, requestId?: unknown): Promise<{ minutes: MeetingMinutes | null; error?: string; partial?: true }> {
    const rel = typeof note === 'string' ? note : '';
    if (isPrivatePath(rel)) return { minutes: null, error: 'Private notes aren’t sent to the AI.' };
    const i = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const transcript = typeof i.transcript === 'string' ? i.transcript : '';
    if (!transcript.trim()) return { minutes: null, error: 'Nothing was written down from the recording, so there were no minutes to make.' };
    const people = Array.isArray(i.people) ? i.people.filter((p): p is string => typeof p === 'string' && p.length <= 120).slice(0, 300) : [];
    const me = typeof i.me === 'string' && i.me.trim() ? i.me.trim().slice(0, 80) : '';
    const attendees = Array.isArray(i.attendees) ? i.attendees.filter((p): p is string => typeof p === 'string' && !!p.trim() && p.length <= 120).slice(0, 60) : [];
    const title = typeof i.title === 'string' ? i.title.slice(0, 200) : 'Meeting';
    const date = typeof i.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.date) ? i.date : '';
    const speakers = cleanSpeakers(i.speakers);
    // What the note already holds, when the card sends it: the answer comes back as the merged whole.
    const rawExisting = i.existing && typeof i.existing === 'object' ? (i.existing as Record<string, unknown>) : null;
    const cleanExistingAction = (a: unknown) => {
      const o = a && typeof a === 'object' ? (a as Record<string, unknown>) : null;
      const what = typeof o?.what === 'string' ? o.what.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
      if (!what) return null;
      const who = typeof o?.who === 'string' && o.who.trim() ? o.who.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
      const due = typeof o?.due === 'string' && o.due.trim() ? o.due.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
      return { what, ...(who ? { who } : {}), ...(due ? { due } : {}) };
    };
    const cleanExistingTopic = (t: unknown) => {
      const o = t && typeof t === 'object' ? (t as Record<string, unknown>) : null;
      const heading = typeof o?.heading === 'string' ? o.heading.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
      if (!heading) return null;
      const words = Array.isArray(o?.words) ? o.words.filter((w): w is string => typeof w === 'string' && !!w.trim()).map((w) => w.replace(/\s+/g, ' ').trim()).slice(0, 8) : [];
      return { heading, words };
    };
    const cleanExistingQuestion = (q: unknown) => {
      const o = q && typeof q === 'object' ? (q as Record<string, unknown>) : null;
      const what = typeof o?.what === 'string' ? o.what.replace(/\s+/g, ' ').trim().slice(0, 300) : typeof q === 'string' ? q.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
      if (!what) return null;
      const tail = (v: unknown) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, 200) : '');
      const askedBy = tail(o?.askedBy);
      const owner = tail(o?.owner);
      const answer = tail(o?.answer);
      return { what, ...(askedBy ? { askedBy } : {}), ...(owner ? { owner } : {}), ...(answer ? { answer } : {}) };
    };
    // An old card's `open` lines ride as the questions they were.
    const existingQuestions = [...(Array.isArray(rawExisting?.questions) ? rawExisting.questions : []), ...(Array.isArray(rawExisting?.open) ? rawExisting.open : [])].map(cleanExistingQuestion).filter((q): q is { what: string; askedBy?: string; owner?: string; answer?: string } => !!q);
    const seenQuestions = new Set<string>();
    const existing = rawExisting
      ? {
          ...(typeof rawExisting.summary === 'string' && rawExisting.summary.trim() ? { summary: rawExisting.summary.replace(/\s+/g, ' ').trim().slice(0, 2400) } : {}),
          ...(Array.isArray(rawExisting.decisions) ? { decisions: rawExisting.decisions.filter((d): d is string => typeof d === 'string' && !!d.trim()).map((d) => d.replace(/\s+/g, ' ').trim()).slice(0, 40) } : {}),
          ...(Array.isArray(rawExisting.actions) ? { actions: rawExisting.actions.map(cleanExistingAction).filter((a): a is { what: string; who?: string; due?: string } => !!a).slice(0, 60) } : {}),
          ...(existingQuestions.length ? { questions: existingQuestions.filter((q) => !seenQuestions.has(q.what.toLowerCase()) && !!seenQuestions.add(q.what.toLowerCase())).slice(0, 20) } : {}),
          ...(Array.isArray(rawExisting.topics) ? { topics: rawExisting.topics.map(cleanExistingTopic).filter((t): t is { heading: string; words: string[] } => !!t).slice(0, 12) } : {}),
        }
      : undefined;
    const id = askId(requestId);
    const controller = new AbortController();
    if (id) asks.set(id, controller);
    try {
      // A long transcript goes in parts that fit, each with its own time, and comes back as one (5 Nov 2026:
      // the middle was cut out past three hours, whole lines lost). One part goes as it always did.
      const chunks = chunkTranscript(transcript);
      const said = transcriptLinesFromText(transcript);
      const parts: MeetingMinutes[] = [];
      // A failed review still leaves minutes made from what is there (12 Nov 2026, t240): the parts that came
      // back, else what the note already held — never a step stuck for ever. Stopped stays stopped.
      const failed = (error: string): { minutes: MeetingMinutes | null; error: string; partial?: true } => {
        if (controller.signal.aborted) return { minutes: null, error: 'Stopped.' };
        const fallback = mergeMeetingMinutes(parts) ?? minutesFromExisting(existing, attendees);
        return fallback ? { minutes: fallback, error, partial: true } : { minutes: null, error };
      };
      for (let n = 0; n < chunks.length; n++) {
        if (controller.signal.aborted) return { minutes: null, error: 'Stopped.' };
        const user = minutesPrompt({ title: chunks.length > 1 ? `${title} (part ${n + 1} of ${chunks.length})` : title, date, people, ...(attendees.length ? { attendees } : {}), ...(me ? { me } : {}), ...(speakers ? { speakers } : {}), ...(existing ? { existing } : {}), transcript: chunks[n] });
        const { reply, error } = await d.askJson(MINUTES_SYSTEM, user, transcriptAskTimeoutMs(chunks[n]), 8000, { signal: controller.signal });
        if (error) return failed(error);
        const read = readMinutesReply(reply, { ...(me ? { me } : {}), ...(attendees.length ? { attendees } : {}), ...(said.length ? { transcript: said } : {}), ...(date ? { date } : {}), speakerNames: mergedSpeakerNames(speakers), voices: mergedSpeakerIds(speakers) });
        if (!read) return failed('The assistant’s minutes couldn’t be read. Try Make the minutes again.');
        parts.push(read);
      }
      const merged = mergeMeetingMinutes(parts);
      return merged ? { minutes: merged } : failed('The assistant’s minutes couldn’t be read. Try Make the minutes again.');
    } finally {
      if (id) asks.delete(id);
    }
  }

  // ── The recordings on disk ─────────────────────────────────────────────────────────────────────────────────────────

  const idOf = (id: unknown) => {
    if (typeof id !== 'string' || !JOB_ID.test(id)) throw new Error('That recording isn’t known.');
    return id;
  };
  /** One write at a time per recording, in order (the pieces of the sound arrive faster than a slow disk takes them). */
  const queues = new Map<string, Promise<unknown>>();
  const inTurn = <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const next = (queues.get(id) ?? Promise.resolve()).then(fn, fn);
    queues.set(id, next.catch(() => undefined));
    return next;
  };

  async function readJob(id: string): Promise<RecJob | null> {
    const f = files(d.dataDir, id);
    const raw = await fsp.readFile(f.job, 'utf8').catch(() => null);
    if (raw === null) return null;
    let job: RecJob | null = null;
    try {
      job = cleanJob(JSON.parse(raw));
    } catch {
      job = null;
    }
    if (!job || job.id !== id) return null;
    const [speech, audio] = await Promise.all([fsp.stat(f.speech).catch(() => null), fsp.stat(f.audio).catch(() => null)]);
    // Stereo speech is 4 bytes a sample, mono 2 (r3, 5 Nov 2026: stereo read double, doubling the card's time
    // after a crash and making phantom tail pieces past the real end).
    const width = job.stereo === true ? 4 : 2;
    return { ...job, speechSeconds: Math.round(((speech?.size ?? 0) / width / PIECE_RATE) * 1000) / 1000, audioBytes: audio?.size ?? 0 };
  }

  async function writeJob(job: RecJob): Promise<void> {
    const f = files(d.dataDir, job.id);
    try {
      await fsp.mkdir(f.dir, { recursive: true });
      const { speechSeconds: _s, audioBytes: _a, ...kept } = job;
      const tmp = `${f.job}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify({ ...kept, updated: new Date().toISOString() }));
      await fsp.rename(tmp, f.job);
    } catch (err) {
      if (isDiskFull(err)) throw new Error(diskFullWords());
      throw err;
    }
  }

  async function begin(raw: unknown): Promise<RecJob> {
    const job = cleanJob(raw);
    if (!job) throw new Error('The recording couldn’t be set up.');
    if (isPrivatePath(job.note)) throw new Error('Private notes can’t be recorded into.');
    // Two recordings started by accident (5 Nov 2026, s2-recorder-survives): the same note in the same folder already
    // recording waits for its finish first (another meeting may still record; a retry of the same id may re-begin).
    const same = (await list()).find((j) => j.phase === 'recording' && j.id !== job.id && (j.vault ?? '') === (job.vault ?? '') && j.note === job.note);
    if (same) throw new Error('This meeting is already being recorded. Finish it first.');
    await writeJob({ ...job, phase: 'recording', pieces: [] });
    return (await readJob(job.id)) ?? job;
  }

  async function append(id: string, kind: unknown, bytes: unknown): Promise<void> {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) return;
    const f = files(d.dataDir, id);
    const file = kind === 'speech' ? f.speech : kind === 'audio' ? f.audio : null;
    if (!file) throw new Error('That isn’t part of a recording.');
    await inTurn(id, async () => {
      try {
        const size = (await fsp.stat(file).catch(() => null))?.size ?? 0;
        if (size + bytes.byteLength > MAX_RECORDING_BYTES) throw new Error('The recording is too long to keep going. Stop it and start another.');
        if (!(await fsp.stat(f.job).catch(() => null))) throw new Error('That recording was discarded.');
        await fsp.appendFile(file, bytes);
      } catch (err) {
        // A full disk reads as one everywhere (5 Nov 2026, s2-recorder-survives): ENOSPC or no space left, never a code.
        if (isDiskFull(err)) throw new Error(diskFullWords());
        throw err;
      }
    });
  }

  async function update(id: string, patch: unknown): Promise<RecJob | null> {
    return inTurn(id, async () => {
      const job = await readJob(id);
      if (!job) return null;
      const p = patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {};
      const merged = cleanJob({ ...job, ...p, id: job.id });
      if (!merged) return job;
      await writeJob(merged);
      return readJob(id);
    });
  }

  async function list(): Promise<RecJob[]> {
    const dir = path.join(d.dataDir, 'recordings');
    const names = await fsp.readdir(dir).catch(() => [] as string[]);
    const out: RecJob[] = [];
    for (const n of names) if (JOB_ID.test(n)) {
      const job = await readJob(n);
      if (job) out.push(job);
    }
    return out.sort((a, b) => a.began.localeCompare(b.began));
  }

  /** The speech from `start` for `seconds`, as a WAV to write down: the side asked for from stereo speech (the
   *  microphone or the PC's sound alone), the mix when no side is asked (a crash tail), or the mono speech of a job
   *  from before the sides were kept. */
  async function speech(id: string, start: unknown, seconds: unknown, side: unknown): Promise<Uint8Array> {
    const s = typeof start === 'number' && Number.isFinite(start) && start >= 0 ? start : 0;
    const len = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 120) : 0;
    const which = side === 'mic' || side === 'pc' ? side : null;
    const stereo = (await readJob(id))?.stereo === true;
    const width = stereo ? 4 : 2;
    const from = Math.floor(s * PIECE_RATE) * width;
    const bytes = Math.floor(len * PIECE_RATE) * width;
    const h = await fsp.open(files(d.dataDir, id).speech, 'r');
    try {
      const buf = new Uint8Array(bytes);
      const { bytesRead } = await h.read(buf, 0, bytes, from);
      const pcm = buf.subarray(0, bytesRead - (bytesRead % width));
      if (!stereo) return wavOfPcm(pcm);
      if (!which) return wavOfPcm(toPcm16(mixStereoToMono(pcm)));
      const sides = fromPcm16Stereo(pcm);
      return wavOfPcm(toPcm16(which === 'mic' ? sides.mic : sides.pc));
    } finally {
      await h.close();
    }
  }

  /** The recording among the notes, as the meeting's attachment. */
  async function keep(id: string, name: unknown, note: unknown): Promise<string> {
    const job = await readJob(id);
    if (!job) throw new Error('That recording isn’t on this PC any more.');
    if (job.attachment) return job.attachment;
    if (!job.audioBytes) throw new Error('Nothing was recorded.');
    try {
      const rel = await inTurn(id, () => d.saveFile(typeof name === 'string' ? name : `Recording.${job.ext}`, files(d.dataDir, id).audio, typeof note === 'string' ? note : job.note));
      await update(id, { attachment: rel });
      return rel;
    } catch (err) {
      if (isDiskFull(err)) throw new Error(diskFullWords());
      throw err;
    }
  }

  async function discard(id: string): Promise<void> {
    await inTurn(id, () => fsp.rm(files(d.dataDir, id).dir, { recursive: true, force: true }));
    queues.delete(id);
  }

  d.handle('recorder:status', () => freshStatus());
  d.handle('recorder:prepare', () => {
    d.prepare?.();
    return status();
  });
  d.handle('recorder:transcribe', async (audio: unknown, mime: unknown, hints: unknown) => {
    await d.requireCreate();
    return transcribe(audio, mime, hints);
  });
  d.handle('recorder:notes', async (note: unknown, input: unknown, requestId: unknown) => {
    await d.requireCreate();
    return notes(note, input, requestId);
  });
  d.handle('recorder:minutes', async (note: unknown, input: unknown, requestId: unknown) => {
    await d.requireCreate();
    return minutes(note, input, requestId);
  });
  d.handle('recorder:cancel', (requestId: unknown) => {
    const id = askId(requestId);
    if (id) asks.get(id)?.abort();
  });
  d.handle('recorder:begin', async (job: unknown) => {
    await d.requireCreate();
    return begin(job);
  });
  d.handle('recorder:append', async (id: unknown, kind: unknown, bytes: unknown) => append(idOf(id), kind, bytes));
  d.handle('recorder:update', async (id: unknown, patch: unknown) => update(idOf(id), patch));
  d.handle('recorder:jobs', () => list());
  d.handle('recorder:speech', async (id: unknown, start: unknown, seconds: unknown, side: unknown) => speech(idOf(id), start, seconds, side));
  d.handle('recorder:keep', async (id: unknown, name: unknown, note: unknown) => {
    await d.requireCreate();
    return keep(idOf(id), name, note);
  });
  d.handle('recorder:discard', async (id: unknown) => discard(idOf(id)));
  // The extra far-side capture (m6): available while a meeting records on Windows; its sound and state reach the
  // window unasked (recorder:extra-audio, recorder:extra-state). Without the part, each answers cleanly.
  const noExtra: ExtraStatus = { available: false, capturing: false, device: '' };
  d.handle('recorder:extra-status', (): ExtraStatus => extra?.status() ?? noExtra);
  d.handle('recorder:extra-start', async (outputs: unknown): Promise<ExtraStartResult> => {
    await d.requireCreate();
    if (!extra) return { started: false, reason: 'missing' };
    const list = Array.isArray(outputs)
      ? outputs
          .map((o) => (o && typeof o === 'object' ? (o as Record<string, unknown>) : null))
          .filter((o): o is Record<string, unknown> => !!o && typeof o.deviceId === 'string' && typeof o.label === 'string')
          .map((o) => ({ deviceId: (o.deviceId as string).slice(0, 200), label: (o.label as string).slice(0, 500) }))
      : [];
    return extra.start(list);
  });
  d.handle('recorder:extra-stop', async (): Promise<void> => {
    await extra?.stop();
  });
  return { status, begin, append, update, list, speech, keep, discard, readJob };
}

/** Electron's parts the permissions need (handed in by app.ts). */
export interface RecordingPermissions {
  /** Ironleaf's own window's page. */
  contents: { id: number; session: SessionLike };
  /** The page a frame belongs to. */
  fromFrame(frame: unknown): { id: number } | undefined;
  /** The PC's screens: only when the window's own frame can't be handed over (its picture is never used). */
  screens(): Promise<unknown[]>;
  platform: NodeJS.Platform;
  /** The PC's sound may be recorded (Windows; a development build's tests elsewhere). */
  systemAudio?: boolean;
  /** Inside the former host app every other permission is refused (as the former host app set it); on its own, allowed as
Electron does. */
  othersAllowed: boolean;
}

interface SessionLike {
  setPermissionRequestHandler(handler: ((wc: { id: number } | null, permission: string, callback: (granted: boolean) => void, details: { mediaTypes?: string[] }) => void) | null): void;
  setDisplayMediaRequestHandler(handler: ((request: { frame: unknown; audioRequested: boolean; videoRequested?: boolean }, callback: (streams: unknown) => void) => void) | null): void;
}

/**
 * Whether a permission is the recorder's, asked by Ironleaf's own window: the microphone alone (never the camera), or
 * the PC's sound, which Chromium asks for as a screen capture: Electron passes that as 'media' with no device types
 * (mediaTypes names only cameras and microphones), or as 'display-capture'.
 */
export function recorderMayHave(permission: string, mediaTypes: readonly string[] | undefined, own: boolean, systemAudio: boolean): boolean {
  if (!own) return false;
  if (permission === 'media') {
    const types = mediaTypes ?? [];
    if (!types.length) return systemAudio;
    return types.every((t) => t === 'audio');
  }
  return permission === 'display-capture' && systemAudio;
}

/** The window allowed to record (installed when a recording starts, so nothing else set later can quietly take it away). */
export function allowRecording(p: RecordingPermissions): void {
  const systemAudio = p.systemAudio ?? p.platform === 'win32';
  const own = (wc: { id: number } | null | undefined) => !!wc && wc.id === p.contents.id;
  p.contents.session.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (recorderMayHave(permission, details?.mediaTypes, own(wc), systemAudio)) return callback(true);
    callback(p.othersAllowed && !(permission === 'media' && own(wc)));
  });
  p.contents.session.setDisplayMediaRequestHandler((request, callback) => {
    if (!systemAudio || !own(p.fromFrame(request.frame)) || !request.audioRequested) return callback(null);
    // The sound of the whole PC (loopback). Chromium wants a picture with it: Ironleaf's own window, which the
    // recorder stops at once (never the person's screen); a whole screen only when the frame is gone.
    if (request.frame) return callback({ video: request.frame, audio: 'loopback' });
    p.screens().then(
      (sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : null),
      () => callback(null),
    );
  });
}
