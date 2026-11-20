// Record meeting, inside a Meeting note (21 Oct 2026, gap G18; rebuilt 22 Oct 2026; the recording itself is
// state/recorder.ts). Under the note's fields:
//
//   - before: "Record meeting", the microphone to record with, "PC sound too" on Windows (the other side of a call), and
//     where it will be written down (or what to set up first, said before the meeting rather than after it).
//   - while recording: the red dot, the time, Pause and Stop; a meter for each source, so a silent microphone shows at
//     once (and is said after a few seconds, with the list to choose another); the reminder to tell people; the
//     transcript's latest lines as it grows.
//   - after Stop: what is happening (saved, the last parts written down with how far along, the notes being made), then
//     what was made, with Try again when some of it couldn't be done; after a crash, Finish or Discard.
//   - the meeting's recording and transcript (views/MeetingPlayback.tsx), whenever the note has them.
//
// The recorder belongs to this note: another meeting being recorded is said here with the way to it, and this one can
// still be recorded once that one stops (a meeting being written up never holds up the next).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RecorderStatus } from '../../../main/meeting-recorder';
import { isMeetingNote } from '../../../shared/meetings';
import { isPrivatePath } from '../../../shared/private';
import { clockWords, isBusy, jobsForNote, lengthWords, mergeTranscript } from '../../../shared/recorder';
import { shownWho, speakerNum } from '../../../shared/meeting-speakers';
import { Icon } from '../components/Icon';
import { SpeakerNames, useSpeakerSuggestions } from '../components/SpeakerNames';
import * as A from '../state/actions';
import { clearJobSpeakerName, discardJob, dismissJob, finishJob, jobFor, jobSpeakerUndoable, levelsNow, liveClip, mergeJobVoices, panelShown, pauseRecording, resumeRecording, retryJob, setJobSpeakerName, startRecording, stopRecording, switchMic, undoJobSpeakers, useElapsed, useMics, useRecorder, type JobView, type LiveView } from '../state/recorder';
import { docs } from '../state/docs';
import { usePerson } from '../state/person';
import { savePrefs, showError, useApp, usePrefs } from '../state/store';
import { MeetingPlayback, useMeetingParts } from './MeetingPlayback';

/** The microphones to record with (the PC's default first). */
export function MicPicker({ compact = false, always = false }: { compact?: boolean; always?: boolean }) {
  const prefs = usePrefs();
  const mics = useMics();
  const chosen = mics.some((m) => m.id === prefs.meetingMic) ? prefs.meetingMic : '';
  if (!always && mics.length < 2 && !prefs.meetingMic) return null;
  return (
    <label className={`mr-mic${compact ? ' is-compact' : ''}`} title="The microphone to record with">
      <Icon name="mic" size={13} />
      <span className="mr-sr">Microphone</span>
      <select value={chosen} onChange={(e) => void switchMic(e.target.value).catch(showError)}>
        {!mics.some((m) => m.id === '') && <option value="">Windows default</option>}
        {mics.map((m) => (
          <option key={m.id || 'default'} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A source's loudness as it comes, drawn every frame without redrawing the page. */
function Meter({ source, label }: { source: 'mic' | 'pc'; label: string }) {
  const bar = useRef<HTMLSpanElement>(null);
  const [silent, setSilent] = useState(false);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const l = levelsNow();
      const v = source === 'mic' ? l.mic : l.pc ?? 0;
      // Loudness felt, not measured: quiet speech still moves the bar.
      const shown = v <= 0 ? 0 : Math.min(1, Math.max(0, (20 * Math.log10(v) + 54) / 48));
      if (bar.current) bar.current.style.setProperty('--mr-level', String(shown));
      if (source === 'pc') setSilent(l.pcSilent);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [source]);
  return (
    <span
      className={`mr-meter${silent ? ' is-silent' : ''}`}
      title={silent ? 'Nothing is playing on this PC’s speakers. If the call is on a headset, make it Windows’ default speaker (Settings › System › Sound) so its sound is recorded too.' : `${label}: how loud it is coming in`}
    >
      <span className="mr-meter-label">{silent ? `${label} · silent` : label}</span>
      <span className="mr-meter-track" aria-hidden="true">
        <span className="mr-meter-fill" ref={bar} />
      </span>
    </span>
  );
}

let statusKept: { at: number; value: Promise<RecorderStatus> } | null = null;
/** What this PC can do and where recordings are written down (asked again after a minute: keys get added). */
const recorderStatus = () => {
  if (!statusKept || Date.now() - statusKept.at > 60_000) statusKept = { at: Date.now(), value: window.nv.recorder.status().catch((err) => ((statusKept = null), Promise.reject(err))) };
  return statusKept.value;
};

export function MeetingRecorder({ path, canEdit }: { path: string; canEdit: boolean }) {
  // Ordinary notes skip the subscription below (t102, 9 Nov 2026): it re-read the note's text on every
  // keystroke, then returned null here.
  const props = useApp((s) => s.byPath.get(path)?.props);
  if (isPrivatePath(path) || !isMeetingNote(path, props ?? {})) return null;
  return <MeetingRecorderInner path={path} canEdit={canEdit} />;
}

function MeetingRecorderInner({ path, canEdit }: { path: string; canEdit: boolean }) {
  const v = useRecorder();
  const parts = useMeetingParts(path);
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  useEffect(() => {
    let live = true;
    recorderStatus().then((s) => live && setStatus(s), () => undefined);
    panelShown(path, true);
    return () => {
      live = false;
      panelShown(path, false);
    };
  }, [path]);
  const job = jobFor(v, path);
  const isLiveHere = v.live.note === path && isBusy(v.live);
  // Every unfinished recording for this note keeps its own card (5 Nov 2026, s2-recorder-survives): after two crashes
  // both are finished from here, never only the latest.
  const unfinished = jobsForNote(v.jobs, path).filter((j) => j.interrupted || j.working);
  const cards = [];
  if (isLiveHere) cards.push(<LiveCard key="live" v={v.live} job={job} canEdit={canEdit} />);
  else if (unfinished.length) for (const u of unfinished) cards.push(<JobCard key={u.id} job={u} canEdit={canEdit} />);
  else if (job) cards.push(<JobCard key={job.id} job={job} canEdit={canEdit} />);
  const working = unfinished.length > 0 || !!job?.working || !!job?.interrupted;
  if (!isLiveHere && parts.length) cards.push(<MeetingPlayback key="play" path={path} parts={parts} canEdit={canEdit} />);
  if (!isLiveHere && canEdit && !working) cards.push(<IdleCard key="idle" path={path} v={v.live} status={status} again={parts.length > 0} />);
  return <div className="mr-stack">{cards}</div>;
}

function IdleCard({ path, v, status, again }: { path: string; v: LiveView; status: RecorderStatus | null; again: boolean }) {
  const prefs = usePrefs();
  const [showSetup, setShowSetup] = useState(false);
  const other = isBusy(v) && v.note !== path;
  const t = status?.transcriber;
  // One compact line (29 Oct 2026, SPEC B): its set-up note shows only when Record is pressed and nothing is set up yet.
  // Nothing chosen to write recordings down yet: the card offers "Add a transcription connection" (Settings › AI),
  // and recording still works without it.
  const hint = other ? null : showSetup && t && !t.ready ? (
    <span className="mr-hint is-warn">
      <Icon name="warning" size={13} />
      <span>
        {t.words ?? 'Nothing is set up to write recordings down yet.'} You can still record: the recording is kept in the note.
      </span>
      <button type="button" className="button small" onClick={() => A.openSettings('models')}>Add a transcription connection</button>
      <button type="button" className="button small" onClick={() => void startRecording(path)}>Record anyway</button>
    </span>
  ) : (
    <span className="mr-hint">Written down as it goes{t?.where === 'pc' ? ' on this PC, so nothing is sent anywhere' : t?.where === 'service' ? ' by the speech service you connected' : ''}.</span>
  );
  return (
    <section className={`mr is-idle${again ? ' is-again' : ''}`} aria-label="Record this meeting">
      <button className="mr-record" disabled={other} onClick={() => (t && !t.ready && !showSetup ? setShowSetup(true) : void startRecording(path))} title={other ? 'Another meeting is being recorded' : 'Record this meeting'}>
        <span className="mr-rec" aria-hidden="true" />
        {again ? 'Record again' : 'Record meeting'}
      </button>
      <div className="mr-idle-body">
        {other ? (
          <span className="mr-hint">
            Recording{' '}
            <button className="text-button" onClick={() => v.note && A.openPath(v.note, { where: 'current' })}>
              {A.displayName(v.note ?? '')}
            </button>{' '}
            now: stop it there first.
          </span>
        ) : (
          hint
        )}
        {!other && (
          <span className="mr-opts">
            <MicPicker compact />
            {status?.systemAudio && (
              <label className="mr-pc" title="The other people on a call (Teams, Zoom, a browser), as your speakers or headset play them">
                <input type="checkbox" checked={prefs.meetingSystemAudio} onChange={(e) => void savePrefs({ meetingSystemAudio: e.target.checked }).catch(showError)} />
                PC sound too
              </label>
            )}
          </span>
        )}
      </div>
    </section>
  );
}

function LiveCard({ v, job, canEdit }: { v: LiveView; job: JobView | null; canEdit: boolean }) {
  const elapsed = useElapsed(v);
  const paused = v.phase === 'paused';
  const starting = v.phase === 'starting';
  const lines = job ? mergeTranscript(job.pieces) : [];
  const heard = job ? job.pieces.filter((p) => p.status === 'done' || p.status === 'quiet').reduce((s, p) => s + p.seconds, 0) : 0;
  const tail = lines.slice(-3);
  const names = job?.speakerView?.names ?? {};
  const marks = job?.speakerView?.marks ?? [];
  const suggestions = useSpeakerSuggestions(job?.note ?? null, job ? (docs.text(job.note) ?? '') : '');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const clipAudio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => clipAudio.current?.pause(), []);
  const playClip = (id: string) => {
    if (!job) return;
    clipAudio.current?.pause();
    if (playingId === id) {
      setPlayingId(null);
      return;
    }
    const n = speakerNum(id);
    const clip = n === null ? null : liveClip(job.id, n - 1);
    if (!clip) return;
    const url = URL.createObjectURL(new Blob([clip.slice().buffer as ArrayBuffer], { type: 'audio/wav' }));
    const a = new Audio(url);
    clipAudio.current = a;
    setPlayingId(id);
    a.onended = () => {
      setPlayingId(null);
      URL.revokeObjectURL(url);
    };
    a.currentTime = 0;
    void a.play().catch(() => setPlayingId(null));
    // A short clip only (its first seconds).
    window.setTimeout(() => {
      if (clipAudio.current === a) {
        a.pause();
        setPlayingId(null);
      }
    }, 6000);
  };
  const me = usePerson();
  const shownTail = useMemo(() => tail.map((l) => ({ ...l, who: shownWho(l.who, names, me ?? undefined) })), [tail, names, me]);
  return (
    <section className={`mr is-live${paused ? ' is-paused' : ''}${starting ? ' is-starting' : ''}`} aria-label="Meeting recording">
      <div className="mr-bar">
        <span className="mr-rec" aria-hidden="true" />
        <b className="mr-state" aria-live="polite">
          {starting ? 'Starting…' : paused ? 'Paused' : 'Recording'}
        </b>
        <span className="mr-time" aria-label={`${lengthWords(elapsed)} recorded`}>
          {clockWords(elapsed)}
        </span>
        <span className="mr-acts">
          <button className="button mr-pause" disabled={starting} onClick={paused ? resumeRecording : pauseRecording}>
            <Icon name={paused ? 'play' : 'pause'} size={13} />
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="button mr-stop" disabled={starting} onClick={() => void stopRecording().catch(showError)}>
            <Icon name="stop" size={13} />
            Stop
          </button>
        </span>
      </div>
      {!starting && (
        <div className="mr-sources">
          {v.sources !== 'pc' && <Meter source="mic" label="You" />}
          {v.sources !== 'mic' && <Meter source="pc" label="PC sound" />}
          <MicPicker compact />
        </div>
      )}
      {v.warning && (
        <p className="mr-warn" role="alert">
          <Icon name="warning" size={13} />
          {v.warning === 'mic-gone' ? 'Your microphone was unplugged. Plug it back in, or choose another above.' : `${v.micName ? `“${v.micName.replace(/^Default - /, '')}”` : 'Your microphone'} isn’t picking anything up. Check it isn’t muted (on the headset or in Windows), or choose another above.`}
        </p>
      )}
      {v.notice && (
        <p className="mr-line mr-notice">
          <Icon name="info" size={13} />
          <span>{v.notice}</span>
        </p>
      )}
      <p className="mr-consent">
        <Icon name="info" size={13} /> Let people know you’re recording.
      </p>
      {v.canTranscribe && !starting && (
        <div className="mr-live-transcript" aria-live="polite">
          {shownTail.length ? (
            <ol>
              {shownTail.map((l, i) => (
                <li key={`${l.at}-${i}`}>
                  <span className="mp-at">{clockWords(l.at * 1000)}</span>
                  {l.who && <span className={`mp-who is-${l.who === 'You' ? 'you' : l.who === 'Others' ? 'others' : 'speaker'}`}>{l.who}</span>}
                  <span className="mp-words">{l.text}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mr-line">The transcript appears here as the meeting goes on.</p>
          )}
          {heard > 0 && <p className="mr-line">{lengthWords(heard * 1000).replace(/^./, (c) => c.toUpperCase())} written down so far.</p>}
        </div>
      )}
      {job && !starting && (
        <SpeakerNames
          marks={marks}
          names={names}
          suggestions={suggestions}
          canEdit={canEdit}
          playingId={playingId}
          onPlay={playClip}
          onName={(voice, name) => {
            const refused = setJobSpeakerName(job.id, voice, name);
            setSaid(refused);
            return refused;
          }}
          onClear={(voice) => {
            clearJobSpeakerName(job.id, voice);
            setSaid('');
          }}
          onMerge={(from, to) => {
            const words = mergeJobVoices(job.id, from, to);
            setSaid(words);
            return words;
          }}
          undoable={jobSpeakerUndoable(job.id)}
          onUndo={() => {
            undoJobSpeakers(job.id);
            setSaid('');
          }}
          notice={job.speakerView?.notice}
          said={said}
        />
      )}
    </section>
  );
}

function JobCard({ job, canEdit }: { job: JobView; canEdit: boolean }) {
  if (job.interrupted) {
    const mid = job.phase === 'recording';
    return (
      <section className="mr is-error is-interrupted" aria-label="Meeting recording">
        <Icon name="warning" size={15} className="mr-done-icon" />
        <p>
          {mid ? (
            <>
              This meeting’s recording stopped when Ironleaf closed, after <b>{clockWords(job.elapsedMs)}</b>. What was recorded is safe.
            </>
          ) : (
            'Ironleaf closed while this meeting was being written up. The recording is safe.'
          )}
        </p>
        <span className="mr-acts">
          {canEdit && (
            <button className="button primary" onClick={() => void finishJob(job.id).catch(showError)}>
              {mid ? 'Finish the recording' : 'Finish writing it up'}
            </button>
          )}
          <button className="button" onClick={() => void discardJob(job.id).catch(showError)} title="The recording goes to Recently deleted">
            Discard
          </button>
        </span>
      </section>
    );
  }
  if (job.working || job.phase === 'stopped') {
    const words =
      job.phase === 'saving' || job.phase === 'stopped'
        ? 'Saving the recording into the note…'
        : job.phase === 'transcribing'
          ? `Writing down the rest of the meeting${job.progress ? ` (${Math.min(job.progress.done + 1, job.progress.total)} of ${job.progress.total})` : ''}…`
          : job.phase === 'settling'
            ? 'Telling the speakers apart…'
            : 'Making the notes: a summary, the decisions and the actions…';
    const pct = job.phase === 'transcribing' && job.progress?.total ? job.progress.done / job.progress.total : null;
    return (
      <section className="mr is-working" aria-label="Meeting recording" aria-busy="true">
        <span className="mr-spin" aria-hidden="true" />
        <p aria-live="polite">{words}</p>
        {pct !== null && (
          <span className="mr-progress" aria-hidden="true">
            <span style={{ width: `${Math.round(pct * 100)}%` }} />
          </span>
        )}
      </section>
    );
  }
  if (job.phase !== 'done' && job.phase !== 'error') return null;
  const failedPieces = job.pieces.some((p) => p.status === 'failed');
  return (
    <section className={`mr is-${job.phase}`} aria-label="Meeting recording">
      <Icon name={job.phase === 'done' && !failedPieces ? 'check' : 'warning'} size={15} className="mr-done-icon" />
      <p aria-live="polite">{job.words}</p>
      <span className="mr-acts">
        {job.canSetup && (
          <button className="button primary" onClick={() => A.openSettings('models')}>
            Add a transcription connection
          </button>
        )}
        {job.canRetry && canEdit && (
          <button className="button" onClick={() => void retryJob(job.id).catch(showError)}>
            <Icon name="refresh" size={13} />
            {failedPieces ? 'Try again' : 'Make notes again'}
          </button>
        )}
        <button className="icon-button mr-close" title={job.canRetry ? 'Leave it as it is' : 'Close'} aria-label="Close" onClick={() => dismissJob(job.id)}>
          <Icon name="close" size={13} />
        </button>
      </span>
    </section>
  );
}
