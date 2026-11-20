// A recorded meeting played back inside its note (22 Oct 2026): the recording and its transcript as the recorder wrote
// them into the note's Transcript section (src/shared/meeting-notes.ts readTranscript), read back as a player — play,
// back and forward 15 seconds, the time to drag, the speed — and the transcript to search, each line with its time and
// who said it; a click on a line plays from there, and the line being heard is marked as it plays. A meeting recorded
// more than once has a tab for each part.
//
// The voices, named once each (6 Nov 2026, speakers): each voice found with a short clip of its sound, named in one
// step like the live card (components/SpeakerNames.tsx, the same control both doors); names live in the note's
// properties, so an older version shows "Speaker N" and never breaks. An earlier meeting whose voices were never told
// apart is re-run from its kept recording here, with Undo. Only names and voice labels are ever written: words and
// hand edits stay exactly as they were.

import { useContext, createContext, useEffect, useMemo, useRef, useState } from 'react';
import { fillVoiceOwners, mergeVoiceInPart, readTranscript, relabelTranscriptSpeakers, type TranscriptPartRead } from '../../../shared/meeting-notes';
import { clockWords, downsample, toPcm16 } from '../../../shared/recorder';
import {
  carrySpeakerNames,
  clearSpeakerName,
  clipRange,
  marksFromLines,
  mergeVoiceNames,
  mergeVoiceWords,
  readSpeakerNames,
  setSpeakerName,
  shownLines,
  speakerNameRefused,
  speakerPartKey,
  speakersFallbackWords,
  speakersSettledWords,
  tryWriteSpeakerNames,
  turnsFromLines,
  type SpeakerNames as SpeakerNameMap,
} from '../../../shared/meeting-speakers';
import { Icon } from '../components/Icon';
import { SpeakerNames, useSpeakerSuggestions } from '../components/SpeakerNames';
import { errorMessage } from '../lib/errors';
import { fileUrl, resolveFile } from '../lib/resolve';
import * as A from '../state/actions';
import { docs } from '../state/docs';
import { usePerson } from '../state/person';
import { registerPlayer } from '../state/playback';
import { useApp } from '../state/store';

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** The note's words, kept current as it changes. */
export function useNoteText(path: string): string {
  const [text, setText] = useState(() => docs.text(path) ?? '');
  useEffect(() => {
    let live = true;
    void docs.acquire(path).then((t) => live && setText(t), () => undefined);
    const off = docs.onText((p, t) => {
      if (p === path) setText(t);
    });
    return () => {
      live = false;
      off();
      docs.release(path);
    };
  }, [path]);
  return text;
}

/** The meeting's recordings and transcripts, read from the note (none: nothing shown). */
export function useMeetingParts(path: string): TranscriptPartRead[] {
  const text = useNoteText(path);
  return useMemo(() => (text.includes('Transcript') ? readTranscript(text) : []), [text]);
}

/** The transcript starts open (the Meetings page's meeting, round 3: the transcript is its own full-height region). */
export const TranscriptOpen = createContext(false);

export function MeetingPlayback({ path, parts, canEdit }: { path: string; parts: TranscriptPartRead[]; canEdit: boolean }) {
  const [which, setWhich] = useState(parts.length - 1);
  const part = parts[Math.min(which, parts.length - 1)];
  const text = useNoteText(path);
  useEffect(() => setWhich(parts.length - 1), [parts.length]);
  if (!part) return null;
  const index = Math.min(which, parts.length - 1);
  return (
    <section className="mp" aria-label="Meeting recording">
      {parts.length > 1 && (
        <div className="mp-parts" role="tablist" aria-label="Recordings of this meeting">
          {parts.map((p, i) => (
            <button key={i} role="tab" aria-selected={i === which} className={i === which ? 'is-on' : ''} onClick={() => setWhich(i)}>
              {p.heading ?? `Part ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <Part key={`${which}:${part.recording ?? ''}`} path={path} text={text} part={part} index={index} canEdit={canEdit} />
    </section>
  );
}

function Part({ path, text, part, index, canEdit }: { path: string; text: string; part: TranscriptPartRead; index: number; canEdit: boolean }) {
  // The recording among the notes (gone: the transcript alone, said so).
  const files = useApp((s) => s.files);
  const rel = useMemo(() => (part.recording ? resolveFile(part.recording, path) : null), [part.recording, path, files]);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const openFirst = useContext(TranscriptOpen);
  const [open, setOpen] = useState(openFirst);
  const list = useRef<HTMLOListElement>(null);
  const lines = part.lines;
  const key = speakerPartKey(index, part.heading);
  const savedNames: SpeakerNameMap = useMemo(() => readSpeakerNames(text, key), [text, key]);
  // Names the note could not take (its properties can't be read, break-it 6): kept for this meeting here, shown
  // on every line, and said so under the voices, never silently dropped.
  const [keptNames, setKeptNames] = useState<SpeakerNameMap | null>(null);
  const names: SpeakerNameMap = keptNames ?? savedNames;
  const marks = useMemo(() => marksFromLines(lines, 'mix'), [lines]);
  const me = usePerson();
  const shown = useMemo(() => shownLines(lines, names, me ?? undefined), [lines, names, me]);
  // Naming steps back: the note's words as they were (names and labels restore exactly, words untouched).
  const [past, setPast] = useState<string[]>([]);
  const [said, setSaid] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const clipTimer = useRef(0);
  const [rerun, setRerun] = useState<'idle' | 'working' | 'error'>('idle');
  const [rerunSaid, setRerunSaid] = useState('');
  const rerunUndo = useRef<string | null>(null);
  const suggestions = useSpeakerSuggestions(path, text);
  useEffect(() => () => window.clearTimeout(clipTimer.current), []);
  // Who said each line, when the transcript knows for some: a column of its own, so the words line up.
  const labelled = shown.some((l) => l.who);
  const total = length || (lines.length ? lines[lines.length - 1].at + 10 : 0);

  const playFrom = (seconds: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = Math.max(0, seconds);
    void a.play().catch(() => undefined);
  };
  useEffect(() => (rel ? registerPlayer(rel, (s) => {
    setOpen(true);
    playFrom(s);
  }) : undefined), [rel]);

  // A recording made by Chromium in WebM doesn't say how long it is until it has been read through once.
  const onMeta = () => {
    const a = audio.current;
    if (!a) return;
    if (Number.isFinite(a.duration)) return setLength(a.duration);
    const back = a.currentTime;
    const done = () => {
      if (Number.isFinite(a.duration)) {
        setLength(a.duration);
        a.currentTime = back;
        a.removeEventListener('durationchange', done);
      }
    };
    a.addEventListener('durationchange', done);
    a.currentTime = 1e9;
  };

  const now = shown.reduce((at, l, i) => (l.at <= time + 0.25 ? i : at), -1);
  const q = query.trim().toLowerCase();
  const listed = q ? shown.map((l, i) => ({ l, i })).filter(({ l }) => l.text.toLowerCase().includes(q) || (l.who ?? '').toLowerCase().includes(q)) : shown.map((l, i) => ({ l, i }));
  // The line being heard kept in sight while it plays (not while the person searches).
  useEffect(() => {
    if (!playing || q || !open) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-line="${now}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [now, playing, q, open]);

  const mark = (words: string) => {
    if (!q) return words;
    const out: (string | React.ReactElement)[] = [];
    let at = 0;
    const low = words.toLowerCase();
    for (let i = low.indexOf(q); i >= 0; i = low.indexOf(q, i + q.length)) {
      out.push(words.slice(at, i), <mark key={i}>{words.slice(i, i + q.length)}</mark>);
      at = i + q.length;
    }
    out.push(words.slice(at));
    return out;
  };

  const writeNames = (next: SpeakerNameMap, from?: string) => {
    const r = tryWriteSpeakerNames(from ?? docs.text(path) ?? text, key, next);
    // A name set here fills the owners that voice took on, in the same write (7 Nov 2026, j1).
    docs.update(path, fillVoiceOwners(r.text), 'speakers');
    setKeptNames(r.saved ? null : next);
    return r;
  };

  const playClip = (id: string) => {
    const m = marks.find((x) => x.id === id);
    const a = audio.current;
    if (!m || !a) return;
    window.clearTimeout(clipTimer.current);
    if (playingId === id && !a.paused) {
      a.pause();
      setPlayingId(null);
      return;
    }
    // A short clip of the voice (its first seconds), from the recording.
    const { at, len } = clipRange(m, total || 1e9);
    a.currentTime = at;
    void a.play().catch(() => undefined);
    setPlayingId(id);
    clipTimer.current = window.setTimeout(() => {
      audio.current?.pause();
      setPlayingId(null);
    }, len * 1000);
  };

  const remember = () => setPast((p) => [...p, docs.text(path) ?? text].slice(-20));

  const nameIt = (id: string, name: string): string => {
    const refused = speakerNameRefused(name);
    if (refused) return refused;
    const next = setSpeakerName(names, id, name);
    if (next === names) return '';
    remember();
    setSaid(writeNames(next).words);
    return '';
  };

  const clearIt = (id: string) => {
    const next = clearSpeakerName(names, id);
    if (next === names) return;
    remember();
    setSaid(writeNames(next).words);
  };

  const mergeIt = (from: string, to: string): string => {
    const cur = docs.text(path) ?? text;
    const moved = mergeVoiceInPart(cur, index, from, to);
    if (!moved.changed) return '';
    const next = mergeVoiceNames(names, from, to);
    remember();
    const r = writeNames(next, moved.text);
    const words = [mergeVoiceWords(from, to, next[to]), r.words].filter(Boolean).join(' ');
    setSaid(words);
    return words;
  };

  const undoIt = () => {
    const prev = past[past.length - 1];
    if (prev === undefined) return;
    setPast((p) => p.slice(0, -1));
    setKeptNames(null);
    docs.update(path, prev, 'speakers');
    setSaid('');
  };

  // An earlier meeting re-run from its kept recording (its words decoded here, heard in pieces): the lines take the
  // voices found, names already set carried on the right voices, anything uncertain left unnamed. With Undo.
  const rerunIt = async () => {
    if (!rel || rerun === 'working' || !canEdit) return;
    setRerun('working');
    setRerunSaid('');
    try {
      const res = await fetch(fileUrl(rel));
      if (!res.ok) throw new Error('The recording couldn’t be read.');
      const bytes = new Uint8Array(await res.arrayBuffer());
      const Ctx: typeof AudioContext | undefined = typeof AudioContext !== 'undefined' ? AudioContext : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) throw new Error('The recording couldn’t be read on this PC.');
      const ctx = new Ctx();
      let data: Float32Array;
      let rate = 16000;
      try {
        const buf = await ctx.decodeAudioData(bytes.buffer as ArrayBuffer);
        rate = buf.sampleRate;
        data = buf.getChannelData(0);
      } finally {
        void ctx.close().catch(() => undefined);
      }
      const job = `rerun-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 40);
      await window.nv.speakers.rerunBegin(job);
      try {
        // Five minutes at a time (a whole meeting never sits twice in memory).
        const step = 5 * 60 * rate;
        for (let at = 0; at < data.length; at += step) {
          const slice = downsample(data.subarray(at, Math.min(data.length, at + step)), rate, 16000);
          if (slice.length) await window.nv.speakers.rerunAppend(job, toPcm16(slice));
        }
        const r = await window.nv.speakers.rerunEnd(job);
        if ('error' in r) throw new Error(r.error);
        if (!r.turns.length) {
          setRerun('idle');
          setRerunSaid(speakersFallbackWords());
          return;
        }
        const cur = docs.text(path) ?? text;
        const live = turnsFromLines(readTranscript(cur)[index]?.lines ?? [], 'mix');
        const carried = carrySpeakerNames(live, r.turns, names);
        const relabelled = relabelTranscriptSpeakers(cur, index, r.turns);
        if (!relabelled.changed) {
          setRerun('idle');
          setRerunSaid('The voices came out the same as they are.');
          return;
        }
        rerunUndo.current = cur;
        const lost = carried.lost.length ? speakersSettledWords(carried.lost) : '';
        const r2 = writeNames(carried.names, relabelled.text);
        setRerun('idle');
        setRerunSaid([lost || 'The speakers are told apart. Set a name on each voice.', r2.words].filter(Boolean).join(' '));
      } catch (err) {
        await window.nv.speakers.rerunEnd(job).catch(() => undefined);
        throw err;
      }
    } catch (err) {
      setRerun('error');
      setRerunSaid(errorMessage(err));
    }
  };

  const rerunUndoIt = () => {
    if (rerunUndo.current === null) return;
    docs.update(path, rerunUndo.current, 'speakers');
    rerunUndo.current = null;
    setRerunSaid('');
  };

  return (
    <div className="mp-part">
      {rel && !failed ? (
        <div
          className="mp-player"
          onKeyDown={(e) => {
            // Space plays and pauses, the arrows go back and forward 5 seconds, from anywhere in the player but its list.
            if ((e.target as HTMLElement).tagName === 'SELECT') return;
            const a = audio.current;
            if (!a) return;
            if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON') {
              e.preventDefault();
              if (a.paused) void a.play().catch(() => undefined);
              else a.pause();
            } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (e.target as HTMLElement).tagName !== 'INPUT') {
              e.preventDefault();
              playFrom(a.currentTime + (e.key === 'ArrowLeft' ? -5 : 5));
            }
          }}
        >
          <audio
            ref={audio}
            src={fileUrl(rel)}
            preload="metadata"
            onLoadedMetadata={onMeta}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => {
              setPlaying(false);
              setPlayingId(null);
            }}
            onEnded={() => setPlaying(false)}
            onError={() => setFailed(true)}
          />
          <button className="mp-play" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => (playing ? audio.current?.pause() : void audio.current?.play().catch(() => undefined))}>
            <Icon name={playing ? 'pause' : 'play'} size={15} />
          </button>
          <button className="icon-button mp-skip" title="Back 15 seconds" aria-label="Back 15 seconds" onClick={() => playFrom(time - 15)}>
            <span aria-hidden="true">−15</span>
          </button>
          <button className="icon-button mp-skip" title="Forward 15 seconds" aria-label="Forward 15 seconds" onClick={() => playFrom(time + 15)}>
            <span aria-hidden="true">+15</span>
          </button>
          <span className="mp-time" aria-hidden="true">
            {clockWords(time * 1000)}
          </span>
          <input
            className="mp-seek"
            type="range"
            min={0}
            max={Math.max(1, total)}
            step={0.1}
            value={Math.min(time, total)}
            aria-label="Position in the recording"
            aria-valuetext={`${clockWords(time * 1000)} of ${clockWords(total * 1000)}`}
            style={{ '--mp-done': `${total ? (Math.min(time, total) / total) * 100 : 0}%` } as React.CSSProperties}
            onChange={(e) => {
              const a = audio.current;
              if (a) a.currentTime = Number(e.target.value);
              setTime(Number(e.target.value));
            }}
          />
          <span className="mp-time is-total" aria-hidden="true">
            {clockWords(total * 1000)}
          </span>
          <label className="mp-speed" title="Playback speed">
            <span className="mr-sr">Playback speed</span>
            <select
              value={speed}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSpeed(v);
                if (audio.current) audio.current.playbackRate = v;
              }}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
          <button className="icon-button" title="Open the recording in its own tab" aria-label="Open the recording" onClick={() => A.openPath(rel, { where: 'tab' })}>
            <Icon name="external" size={14} />
          </button>
        </div>
      ) : (
        <p className="mp-gone">
          <Icon name="audio" size={14} />
          {part.recording && rel && failed ? 'The recording couldn’t be played on this PC.' : part.recording ? 'The recording isn’t among your notes any more; the transcript is below.' : 'The recording wasn’t kept; the transcript is below.'}
        </p>
      )}
      <SpeakerNames
        marks={marks}
        names={names}
        suggestions={suggestions}
        canEdit={canEdit}
        playingId={playingId}
        onPlay={playClip}
        onName={nameIt}
        onClear={clearIt}
        onMerge={canEdit ? mergeIt : null}
        undoable={past.length > 0}
        onUndo={undoIt}
        notice={undefined}
        said={said}
      />
      {canEdit && rel && !failed && (
        <div className="mp-rerun">
          {rerun === 'working' ? (
            <p className="mp-words" role="status">
              Telling the speakers apart…
            </p>
          ) : (
            <span className="mp-rerun-acts">
              {/* A proper quiet button in the app's own style, inside the card's padding (6 Nov 2026, o3 item 2). */}
              <button type="button" className="button small quiet" onClick={() => void rerunIt()}>
                {marks.length ? 'Listen for the speakers again' : 'Tell the speakers apart'}
              </button>
              {rerunUndo.current !== null && (
                <button type="button" className="button small quiet" onClick={rerunUndoIt} title="Undo the re-run">
                  <Icon name="undo" size={12} />
                  Undo
                </button>
              )}
            </span>
          )}
          {rerunSaid && (
            <p className="mp-words" role="status">
              {rerunSaid}
            </p>
          )}
        </div>
      )}
      {lines.length > 0 && (
        <div className={`mp-transcript${open ? ' is-open' : ''}`}>
          <div className="mp-thead">
            <button className="mp-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <Icon name="chevron" size={12} className="mp-chev" />
              Transcript
              <span className="mp-count">
                {shown.length} {shown.length === 1 ? 'line' : 'lines'}
                {part.length ? ` · ${part.length}` : ''}
              </span>
            </button>
            {open && (
              <label className="mp-search">
                <Icon name="search" size={13} />
                <input type="search" placeholder="Search the transcript" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the transcript" />
                {q && <span className="mp-hits">{listed.length ? `${listed.length} found` : 'Not found'}</span>}
              </label>
            )}
          </div>
          {open && (
            <ol className="mp-lines" ref={list}>
              {listed.map(({ l, i }) => (
                <li key={i} data-line={i} className={i === now && (playing || time > 0) ? 'is-now' : ''}>
                  <button className="mp-line" disabled={!rel || failed} onClick={() => playFrom(l.at)} title={rel && !failed ? `Play from ${clockWords(l.at * 1000)}` : undefined}>
                    <span className="mp-at">{clockWords(l.at * 1000)}</span>
                    {l.who ? <span className={`mp-who is-${l.who === 'You' ? 'you' : l.who === 'Others' ? 'others' : 'speaker'}`}>{l.who}</span> : labelled && <span className="mp-who is-none" aria-hidden="true" />}
                    <span className="mp-words">{mark(l.text)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
