// Dictation (8.6 voice, second pass, 30 Oct 2026): a note, the side chat and quick capture heard by the former host
// app when inside it (the same hearing as its message box: the person's provider, then this PC, words while speaking
// where the provider hears live), Windows voice typing on their own. Text lands at the cursor as it does now: partial
// words stream into one tail and the final words replace them. The microphone is the one chosen for meetings, with
// the pre-roll and tail Talk hears with (shared/dictate.ts).

import { b64Of, boostSamples, cleanDictation, dictateInitial, dictateStep, ensureMacrons, pcm16Of, type DictateState } from '../../../shared/dictate';
import { downsample, encodeWav, micWords } from '../../../shared/recorder';
import { errorMessage } from './errors';
import { prefs, toast } from '../state/store';

export const canDictate = () => !!window.nv.dictation?.available && prefs().dictation;

export interface DictationHeard {
  hearing: 'service' | 'windows';
  ready: boolean;
  route: string;
  live: string;
  words?: string;
}

export interface DictateApi {
  start(): Promise<{ started: boolean; words?: string }>;
  status(): Promise<DictationHeard>;
  prepare(): Promise<unknown>;
  hear(audio: Uint8Array, mime: string): Promise<{ text: string } | { error: string }>;
  chunk(request: { op: 'begin' | 'chunk' | 'end'; id?: string; route?: string; hear?: string; accent?: string; words?: string[]; audio?: string; last?: boolean }): Promise<
    { partial?: string; final?: string; id?: string; rate?: number; provider?: string } | { error: string }
  >;
}

const mainApi = (): DictateApi => window.nv.dictation;
/** Quick capture's own window dictates through its own channels, heard the same way. */
export const captureApi = (): DictateApi => ({
  start: () => window.nv.capture.dictate(),
  status: () => window.nv.capture.dictateStatus(),
  prepare: () => window.nv.capture.dictatePrepare(),
  hear: (audio, mime) => window.nv.capture.dictateHear(audio, mime),
  chunk: (request) => window.nv.capture.dictateChunk(request),
});

/** Where the words land: one tail the partials stream into and the final replaces. */
export interface DictateTarget {
  focus(): void;
  show(text: string): void;
  land(text: string): void;
  drop(): void;
}

/** A note's editor: the tail is one range the partials replace (CodeMirror's own dispatch, so undo stays whole). */
export function editorTarget(getView: () => { dispatch(spec: unknown): void; state: { selection: { main: { head: number } }; doc: { toString(): string } } } | null, focus: () => void): DictateTarget {
  let tail: { from: number; len: number; prefix: string } | null = null;
  const view = () => getView();
  const start = (): boolean => {
    const v = view();
    if (!v) return false;
    focus();
    const head = v.state.selection.main.head;
    const before = v.state.doc.toString().slice(0, head);
    tail = { from: head, len: 0, prefix: before && !/\s$/.test(before) ? ' ' : '' };
    return true;
  };
  const put = (text: string, final: boolean): void => {
    if (!tail && !start()) return;
    const v = view();
    if (!v || !tail) return;
    const insert = tail.prefix + text;
    v.dispatch({ changes: { from: tail.from, to: tail.from + tail.len, insert }, selection: { anchor: tail.from + insert.length } });
    tail.len = insert.length;
    if (final) tail = null;
  };
  return {
    focus,
    show: (text) => put(text, false),
    land: (text) => put(text, true),
    drop: () => {
      const v = view();
      if (v && tail) v.dispatch({ changes: { from: tail.from, to: tail.from + tail.len, insert: '' }, selection: { anchor: tail.from } });
      tail = null;
    },
  };
}

/** A field (the chat box, quick capture): the tail is one range setRangeText replaces (undo stays whole). */
export function fieldTarget(el: HTMLTextAreaElement | HTMLInputElement, set: (value: string) => void): DictateTarget {
  let tail: { from: number; len: number; prefix: string } | null = null;
  const start = (): void => {
    el.focus();
    const at = el.selectionStart ?? el.value.length;
    tail = { from: at, len: 0, prefix: at > 0 && !/\s$/.test(el.value.slice(0, at)) ? ' ' : '' };
  };
  const put = (text: string, final: boolean): void => {
    if (!tail) start();
    if (!tail) return;
    const insert = tail.prefix + text;
    el.focus();
    el.setRangeText(insert, tail.from, tail.from + tail.len, 'end');
    set(el.value);
    tail.len = insert.length;
    if (final) tail = null;
  };
  return {
    focus: () => el.focus(),
    show: (text) => put(text, false),
    land: (text) => put(text, true),
    drop: () => {
      if (!tail) return;
      el.setRangeText('', tail.from, tail.from + tail.len, 'start');
      set(el.value);
      tail = null;
    },
  };
}

const WORDS: Record<DictateState['phase'], string> = { listening: 'Listening…', hearing: 'Hearing…', writing: 'Writing…', ended: '' };

let active: { stop: () => void } | null = null;

/**
 * Dictates into a target: pressing again stops. `onState` hears one clear state at a time (Listening, Hearing,
 * Writing, a note, or null when done); errors come through it too.
 */
export interface DictatePrefs {
  meetingMic: string;
  dictationClean: boolean;
}

/** What the helper said while dictating, tagged by kind (9.2 uplift F8): phases are phases whatever the
 *  person's own dictated sentences start with — "Listening to the client…" is content, never swallowed. */
export type DictateEventKind = 'phase' | 'note' | 'error' | 'info';
export interface DictateEvent {
  kind: DictateEventKind;
  words: string | null;
}

export async function dictate(
  target: DictateTarget,
  onState?: (words: string | null) => void,
  api?: DictateApi,
  opts?: { windowsOnly?: boolean; prefs?: DictatePrefs; notify?: (words: string) => void; onEvent?: (e: DictateEvent) => void },
): Promise<{ stop: () => void } | null> {
  if (active) {
    active.stop();
    return null;
  }
  // Errors in the person's own words (p16 loose ends: a raw err.message reached the toast through onEvent):
  // cleaned here, the one mouth every error event speaks through, so no caller can pass raw words again.
  const say = (kind: DictateEventKind, words: string | null) => {
    const said = kind === 'error' && words ? errorMessage(words) : words;
    opts?.onEvent?.({ kind, words: said });
    onState?.(said);
  };
  const talk = api ?? mainApi();
  const heardPrefs = opts?.prefs ?? { meetingMic: prefs().meetingMic, dictationClean: prefs().dictationClean };
  const notify = opts?.notify ?? toast;
  let status: DictationHeard | null = null;
  // A private note keeps Windows voice typing exactly as today: its words gain no new recipient.
  if (!opts?.windowsOnly) {
    try {
      status = await talk.status();
    } catch {
      status = null;
    }
  }
  // On its own (or nothing set up in the former host app yet): Windows voice typing, as before.
  if (!status || status.hearing !== 'service' || !status.ready) {
    try {
      target.focus();
      const result = await talk.start();
      if (!result.started) say('error', result.words ?? 'Windows voice typing did not open. Press Windows key + H to start it.');
      else say('phase', null);
    } catch (err) {
      say('error', errorMessage(err));
    }
    return null;
  }
  say('phase', 'Getting ready…');
  const session = await startHeard(target, say, talk, status, heardPrefs, notify).catch((err: unknown) => {
    say('error', errorMessage(err));
    return null;
  });
  if (!session) {
    setTimeout(() => say('phase', null), 6000);
    return null;
  }
  active = session;
  return {
    stop: () => {
      if (active === session) active = null;
      session.stop();
    },
  };
}

async function startHeard(
  target: DictateTarget,
  say: (kind: DictateEventKind, words: string | null) => void,
  api: DictateApi,
  status: DictationHeard,
  heardPrefs: DictatePrefs,
  notify: (words: string) => void,
): Promise<{ stop: () => void } | null> {
  let core: DictateState = dictateInitial();
  let ended = false;
  let stream: MediaStream | null = null;
  let audio: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let proc: ScriptProcessorNode | null = null;
  const pre: { at: number; data: Float32Array }[] = [];
  let segment: Float32Array[] | null = null;
  let live: { id: string; rate: number } | null = null;
  let chain: Promise<void> = Promise.resolve();
  let hearChain: Promise<void> = Promise.resolve();
  let liveAcc: number[] = [];

  const dispatch = (event: Parameters<typeof dictateStep>[1]): void => {
    if (ended) return;
    const before = core.phase;
    const step = dictateStep(core, event);
    core = step.state;
    for (const fx of step.effects) {
      if (fx.type === 'startSegment') {
        segment = pre.filter((c) => c.at >= fx.from - 500).map((c) => c.data);
      } else if (fx.type === 'discardSegment') {
        segment = null;
        target.drop();
      } else if (fx.type === 'endSegment') {
        const chunks = segment ?? [];
        segment = null;
        hearChain = hearChain.then(() => finishTurn(chunks), () => finishTurn(chunks));
      } else if (fx.type === 'show') target.show(fx.text);
      else if (fx.type === 'land') target.land(fx.text);
      else if (fx.type === 'note') say('note', fx.note);
      else if (fx.type === 'release') release();
    }
    if (core.phase !== before) say('phase', WORDS[core.phase] || null);
  };

  const finishTurn = async (chunks: Float32Array[]): Promise<void> => {
    if (ended) return;
    try {
      const clean = heardPrefs.dictationClean;
      if (live) {
        const { id } = live;
        const rest = liveAcc;
        liveAcc = [];
        const made = await api.chunk({ op: 'chunk', id, audio: rest.length ? b64Of(pcm16Of(Float32Array.from(rest))) : '', last: true });
        if (ended) return;
        if ('error' in made) throw new Error(made.error);
        dispatch({ type: 'heard', text: cleanDictation(ensureMacrons(made.final || made.partial || ''), { clean }) });
        return;
      }
      let length = 0;
      for (const c of chunks) length += c.length;
      const all = new Float32Array(length);
      let at = 0;
      for (const c of chunks) {
        all.set(c, at);
        at += c.length;
      }
      const samples = boostSamples(downsample(all, audio?.sampleRate || 48000, 16000));
      const made = await api.hear(encodeWav(samples, 16000), 'audio/wav');
      if (ended) return;
      if ('error' in made) throw new Error(made.error);
      dispatch({ type: 'heard', text: cleanDictation(made.text, { clean }) });
    } catch (err) {
      if (ended) return;
      say('error', errorMessage(err));
      dispatch({ type: 'failed' });
    }
  };

  const liveDied = (): void => {
    if (!live) return;
    const { id } = live;
    live = null;
    liveAcc = [];
    void api.chunk({ op: 'end', id }).catch(() => undefined);
    say('info', 'Live words stopped. Dictation carries on.');
  };

  const pushLive = (data: Float32Array): void => {
    if (!live) return;
    const rate = live.rate || 16000;
    const down = downsample(data, audio?.sampleRate || 48000, rate);
    const acc = new Float32Array(liveAcc.length + down.length);
    acc.set(liveAcc, 0);
    acc.set(down, liveAcc.length);
    liveAcc = [...acc];
    if (liveAcc.length < rate / 6) return;
    const sending = liveAcc;
    liveAcc = [];
    chain = chain
      .then(async () => {
        if (ended || !live) return;
        try {
          const made = await api.chunk({ op: 'chunk', id: live.id, audio: b64Of(pcm16Of(Float32Array.from(sending))) });
          if ('error' in made) liveDied();
          else if (typeof made.partial === 'string') dispatch({ type: 'partial', text: ensureMacrons(made.partial) });
        } catch {
          liveDied();
        }
      })
      .catch(() => undefined);
  };

  const release = (): void => {
    ended = true;
    const id = live?.id;
    live = null;
    if (id) void api.chunk({ op: 'end', id }).catch(() => undefined);
    try {
      if (proc) proc.onaudioprocess = null;
      proc?.disconnect();
      source?.disconnect();
    } catch {
      // Already gone.
    }
    try {
      stream?.getTracks().forEach((track) => track.stop());
    } catch {
      // Already gone.
    }
    try {
      void audio?.close();
    } catch {
      // Already gone.
    }
    stream = audio = source = proc = null;
    say('phase', null);
  };

  // The microphone chosen for meetings (or the default when it isn't plugged in, said once).
  const openMic = async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This window cannot use a microphone.');
    const id = heardPrefs.meetingMic || '';
    const plain: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: id ? { ...plain, deviceId: { exact: id } } : plain, video: false });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (id && (name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'NotReadableError')) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: plain, video: false }).catch(() => null);
        if (!stream) throw new Error(micWords(name));
        notify('The microphone chosen is not plugged in, so the default microphone is listening.');
      } else throw new Error(micWords(name));
    }
    if (!stream) throw new Error(micWords(''));
    if (ended) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
      return;
    }
    audio = new AudioContext();
    if (audio.state === 'suspended') await audio.resume().catch(() => undefined);
    source = audio.createMediaStreamSource(stream);
    proc = audio.createScriptProcessor(2048, 1, 1);
    proc.onaudioprocess = (e) => {
      if (ended) return;
      const data = new Float32Array(e.inputBuffer.getChannelData(0));
      const at = performance.now();
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      pre.push({ at, data });
      while (pre.length && at - pre[0].at > 800) pre.shift();
      if (segment) segment.push(data);
      // Live audio flows while the turn commits too, so words spoken then are in the next turn, never lost.
      if (live && (core.phase === 'hearing' || core.phase === 'writing')) pushLive(data);
      dispatch({ type: 'level', level: rms, at });
    };
    source.connect(proc);
    proc.connect(audio.destination);
  };

  try {
    await api.prepare();
    // Live transcription where the connected provider offers it for this hearing; anything else is heard whole,
    // with honest Hearing/Writing states.
    if (status.live && status.live === status.route) {
      try {
        const made = await api.chunk({ op: 'begin', route: status.route, hear: 'auto', accent: String(navigator.language || 'en-AU'), words: [] });
        if (!('error' in made) && made.id && made.rate) live = { id: made.id, rate: made.rate };
      } catch {
        live = null;
      }
    }
    await openMic();
  } catch (err) {
    release();
    throw err;
  }
  say('phase', 'Listening…');
  return {
    stop: () => {
      if (ended) return;
      target.drop();
      dispatch({ type: 'stop' });
      release();
    },
  };
}
