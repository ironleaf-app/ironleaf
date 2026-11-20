// Dictation (16 Oct 2026). Inside the former host app (8.6 voice, second pass) dictation is heard by the former host
// app (the host's transcribeAudio for whole turns, its dictate live sessions for words while speaking: the person's
// provider, then this PC); on its own Ironleaf keeps Windows voice typing, the panel Windows key + H opens, which
// types where the cursor is. Nothing is recorded or sent by Ironleaf itself: audio goes only to the former host app,
// which hears it where the person connected.

import { execFile } from 'node:child_process';
import { cleanTranscribed } from './meeting-recorder';

const SCRIPT = [
  "Add-Type -Namespace NVDictation -Name Keys -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'",
  '[NVDictation.Keys]::keybd_event(0x5B,0,0,[UIntPtr]::Zero)',
  '[NVDictation.Keys]::keybd_event(0x48,0,0,[UIntPtr]::Zero)',
  '[NVDictation.Keys]::keybd_event(0x48,0,2,[UIntPtr]::Zero)',
  '[NVDictation.Keys]::keybd_event(0x5B,0,2,[UIntPtr]::Zero)',
].join('; ');

export interface DictationResult {
  started: boolean;
  words?: string;
}

let busy: Promise<DictationResult> | null = null;

export function startDictation(platform: NodeJS.Platform = process.platform): Promise<DictationResult> {
  if (platform !== 'win32') return Promise.resolve({ started: false, words: 'Dictation uses Windows voice typing, which is part of Windows.' });
  if (busy) return busy;
  busy = new Promise<DictationResult>((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000 }, (error) =>
      resolve(error ? { started: false, words: 'Windows voice typing did not open. Press Windows key + H to start it.' } : { started: true }),
    );
  }).finally(() => {
    busy = null;
  });
  return busy;
}

/** Where dictation would be heard now, asked before the microphone opens. */
export interface DictationStatus {
  /** Heard by the former host app (inside it), else Windows voice typing (on its own, or nothing set up there yet). */
  hearing: 'service' | 'windows';
  /** The former host app can hear now. */
  ready: boolean;
  /** Where: 'local' (this PC), 'openai', 'gemini', or '' (nowhere yet). */
  route: string;
  /** Who hears live words while speaking: 'openai', 'gemini', or '' (the honest Hearing/Writing states instead). */
  live: string;
  /** Why not, in the former host app's words (what to set up, and where). */
  words?: string;
}

/** The former host app's plan for hearing, checked (its transcribeStatus: {ready, route, provider?, live?,
error?}). */
export function cleanDictationStatus(raw: unknown): { ready: boolean; route: string; live: string; words?: string } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.ready !== 'boolean') return { ready: false, route: '', live: '' };
  const route = typeof r.route === 'string' && ['local', 'openai', 'gemini'].includes(r.route) ? r.route : '';
  const live = typeof r.live === 'string' && ['openai', 'gemini'].includes(r.live) ? r.live : '';
  return { ready: r.ready && !!route, route: r.ready ? route : '', live: r.ready ? live : '', ...(typeof r.error === 'string' && r.error ? { words: r.error.slice(0, 400) } : {}) };
}

export interface DictationDeps {
  /** Inside the former host app: a turn written down (the host's transcribeAudio). The wait's own signal rides too: a
   *  turn given up as late aborts the server call with it, so nothing keeps transcribing and billing after the
   *  Vault moved on (t260: the race never aborted, the same shape t259 fixed for meetings). */
  transcribe?(audio: Uint8Array, mime: string, opts?: { signal?: AbortSignal }): Promise<unknown>;
  /** Inside the former host app: where turns would be heard, asked before the microphone opens. */
  transcribeStatus?(): Promise<unknown>;
  /** Inside the former host app: a live session's pieces (the host's dictate): begin, chunk, end. */
  dictate?(request: Record<string, unknown>): Promise<unknown>;
  /** Changing notes needs the licence once it is enforced. */
  requireCreate(): Promise<void>;
  /** How long one turn may take to be written down (tests shorten it; the product leaves the 60 s rule). */
  hearTimeoutMs?: number;
}

/** The most one turn may be (the former host app's speech services take 4 MB: two minutes at 16 kHz). */
export const MAX_DICTATION_BYTES = 4 * 1024 * 1024;
/** How long one turn may take to be written down. */
const HEAR_TIMEOUT_MS = 60_000;

/** The handlers for dictation heard by the former host app: status (where), hear (one turn), chunk (one live
piece). */
export function dictationHandlers(d: DictationDeps) {
  async function status(): Promise<DictationStatus> {
    if (!d.transcribe) return { hearing: 'windows', ready: false, route: '', live: '' };
    if (!d.transcribeStatus) return { hearing: 'service', ready: true, route: '', live: '' };
    try {
      const t = cleanDictationStatus(await Promise.race([d.transcribeStatus(), new Promise((ok) => setTimeout(() => ok(null), 8000))]));
      // Nothing set up in the former host app yet: Windows voice typing hears instead (the last
      // resort).
      if (!t.ready) return { hearing: 'windows', ready: false, route: '', live: '', ...(t.words ? { words: t.words } : {}) };
      return { hearing: 'service', ready: true, route: t.route, live: t.live };
    } catch {
      return { hearing: 'service', ready: true, route: '', live: '' };
    }
  }

  async function hear(audio: unknown, mime: unknown): Promise<{ text: string } | { error: string }> {
    if (!(audio instanceof Uint8Array) || audio.byteLength < 44) return { error: 'What was said didn’t arrive whole.' };
    if (audio.byteLength > MAX_DICTATION_BYTES) return { error: 'That was too long to hear in one go. Say it in shorter parts.' };
    if (!d.transcribe) return { error: 'Add a transcription connection in Settings › AI to dictate this way. Nothing was lost: try again.' };
    await d.requireCreate();
    const type = typeof mime === 'string' && /^audio\/[a-z0-9.+-]+$/i.test(mime) ? mime : 'audio/wav';
    let timer: NodeJS.Timeout | undefined;
    // A turn given up as late aborts the server call with it (t260: the race moved on but the slow turn kept
    // transcribing and billing, the same shape t259 fixed for meetings). The retry is a new call, billed once.
    const stop = new AbortController();
    try {
      const late = new Promise<'late'>((resolve) => {
        timer = setTimeout(() => resolve('late'), d.hearTimeoutMs ?? HEAR_TIMEOUT_MS);
      });
      const raw = await Promise.race([d.transcribe(audio, type, { signal: stop.signal }), late]);
      if (raw === 'late') {
        stop.abort();
        return { error: 'The speech service took too long to answer. Check the internet connection, then try again.' };
      }
      if (raw && typeof raw === 'object' && typeof (raw as { error?: unknown }).error === 'string') return { error: String((raw as { error: string }).error).slice(0, 300) };
      const heard = cleanTranscribed(raw);
      if (!heard) return { error: 'The speech service’s answer couldn’t be read.' };
      return { text: heard.text };
    } catch (err) {
      const words = (err instanceof Error ? err.message : String(err)).replace(/^Error:\s*/, '').slice(0, 300);
      if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(words)) return { error: 'The speech service couldn’t be reached to hear it. Try again in a moment.' };
      return { error: words || 'The speech service couldn’t hear that.' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function chunk(request: unknown): Promise<{ partial?: string; final?: string } | { error: string }> {
    const r = request && typeof request === 'object' ? (request as Record<string, unknown>) : {};
    const op = r.op === 'begin' || r.op === 'chunk' || r.op === 'end' ? r.op : '';
    if (!op) return { error: 'That isn’t part of dictation.' };
    if (!d.dictate) return { error: 'Live words aren’t available here. Nothing was lost: try again.' };
    if (op !== 'end') await d.requireCreate();
    const clean: Record<string, unknown> = { op };
    if (typeof r.id === 'string') clean.id = r.id.slice(0, 80);
    if (op === 'begin') {
      if (typeof r.route === 'string') clean.route = r.route.slice(0, 20);
      if (typeof r.hear === 'string') clean.hear = r.hear.slice(0, 20);
      if (typeof r.accent === 'string') clean.accent = r.accent.slice(0, 20);
      if (Array.isArray(r.words)) clean.words = r.words.filter((w): w is string => typeof w === 'string').map((w) => w.slice(0, 60)).slice(0, 40);
    }
    if (op === 'chunk') {
      if (typeof r.audio !== 'string' || r.audio.length > 90_000) return { error: 'That piece of speech was too long.' };
      clean.audio = r.audio;
      clean.last = r.last === true;
    }
    try {
      const raw = await d.dictate(clean);
      const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
      if (!v) return { error: 'The speech service’s answer couldn’t be read.' };
      if (typeof v.error === 'string') return { error: v.error.slice(0, 300) };
      if (op === 'end') return {};
      const out: { partial?: string; final?: string; id?: string; rate?: number; provider?: string } = {};
      if (typeof v.partial === 'string') out.partial = v.partial.slice(0, 4000);
      if (typeof v.final === 'string') out.final = v.final.slice(0, 4000);
      if (typeof v.id === 'string') out.id = v.id.slice(0, 80);
      if (typeof v.rate === 'number' && Number.isFinite(v.rate)) out.rate = v.rate;
      if (typeof v.provider === 'string') out.provider = v.provider.slice(0, 60);
      return out;
    } catch (err) {
      const words = (err instanceof Error ? err.message : String(err)).replace(/^Error:\s*/, '').slice(0, 300);
      if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(words)) return { error: 'The speech service couldn’t be reached for live words. Dictation carries on.' };
      return { error: words || 'Live words stopped. Dictation carries on.' };
    }
  }

  return { status, hear, chunk };
}

// ── The microphone for dictation ─────────────────────────────────────────────────────────────────────────────────────
// The window allowed the microphone, only for Ironleaf's own windows and only once dictation starts (like the
// meeting recorder's prepare, but the microphone alone: never the PC's sound). Installing this replaces the recorder's
// permission rule until its next recording starts; open streams are unaffected either way, so dictating during a
// recording (or starting one while dictating) changes nothing already recording.

interface SessionLike {
  setPermissionRequestHandler(handler: ((wc: { id: number } | null, permission: string, callback: (granted: boolean) => void, details: { mediaTypes?: string[] }) => void) | null): void;
}

export interface DictationMicPage {
  id: number;
  session: SessionLike;
}

/** Whether a permission is dictation's: the microphone alone (never the camera), asked by one of our windows. */
export function dictateMayHave(permission: string, mediaTypes: readonly string[] | undefined, own: boolean): boolean {
  if (!own || permission !== 'media') return false;
  const types = mediaTypes ?? [];
  return types.length > 0 && types.every((t) => t === 'audio');
}

/** The windows allowed the microphone for dictation (installed when dictation starts). */
export function allowDictationMic(pages: DictationMicPage[], othersAllowed: boolean): void {
  const ids = new Set(pages.map((p) => p.id));
  const session = pages[0]?.session;
  if (!session) return;
  session.setPermissionRequestHandler((wc, permission, callback, details) => {
    const own = !!wc && ids.has(wc.id);
    if (dictateMayHave(permission, details?.mediaTypes, own)) return callback(true);
    callback(othersAllowed && !(permission === 'media' && own));
  });
}
