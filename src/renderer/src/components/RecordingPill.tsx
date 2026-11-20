// The meeting being recorded, wherever the person is (21 Oct 2026, gap G18; 22 Oct 2026; state/recorder.ts): a small
// pill at the foot of the window with the red dot, the meeting's name (a click goes back to it), the time and a meter,
// Pause and Stop. While a meeting is written up it says so; after a crash it offers to finish the recording. Nothing
// shows once that note's own panel is on screen.

import { useEffect, useRef } from 'react';
import { clockWords, isBusy, isLive } from '../../../shared/recorder';
import * as A from '../state/actions';
import { finishJob, hasPanel, levelsNow, loadJobs, pauseRecording, resumeRecording, stopRecording, useElapsed, useRecorder } from '../state/recorder';
import { showError, useApp } from '../state/store';
import { Icon } from './Icon';

/** A dot that grows with the sound coming in (the microphone and the PC's sound together). */
function LiveDot({ paused }: { paused: boolean }) {
  const dot = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (paused) return;
    let raf = 0;
    const tick = () => {
      const l = levelsNow();
      const v = Math.max(l.mic, l.pc ?? 0);
      const shown = v <= 0 ? 0 : Math.min(1, Math.max(0, (20 * Math.log10(v) + 54) / 48));
      dot.current?.style.setProperty('--mr-level', String(shown));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused]);
  return <span className="mr-rec mr-rec-live" ref={dot} aria-hidden="true" />;
}

export function RecordingPill() {
  const v = useRecorder();
  const vault = useApp((s) => s.vault?.path);
  const elapsed = useElapsed(v.live);
  // Recordings left unfinished on this PC (a crash, a restart) are found once the notes folder is open.
  useEffect(() => {
    if (vault) void loadJobs();
  }, [vault]);
  const live = v.live;
  if (isBusy(live)) {
    if (live.phase === 'starting' || hasPanel(live.note)) return null;
    const title = A.displayName(live.note ?? '');
    const paused = live.phase === 'paused';
    return (
      <div className={`mr-pill${paused ? ' is-paused' : ''}`} role="status" aria-label={`${paused ? 'Paused' : 'Recording'}: ${title}`}>
        <LiveDot paused={paused} />
        <span className="mr-pill-state">{paused ? 'Paused' : 'Recording'}</span>
        <button className="mr-pill-name" onClick={() => live.note && A.openPath(live.note, { where: 'current' })} title="Back to the meeting note">
          {title}
        </button>
        <span className="mr-time">{clockWords(elapsed)}</span>
        {isLive(live) && (
          <>
            <button className="icon-button" title={paused ? 'Resume' : 'Pause'} aria-label={paused ? 'Resume recording' : 'Pause recording'} onClick={paused ? resumeRecording : pauseRecording}>
              <Icon name={paused ? 'play' : 'pause'} size={14} />
            </button>
            <button className="icon-button mr-stop" title="Stop and make the notes" aria-label="Stop recording" onClick={() => void stopRecording().catch(showError)}>
              <Icon name="stop" size={14} />
            </button>
          </>
        )}
      </div>
    );
  }
  // Every meeting unfinished out of sight (9.2 uplift F121): each keeps its pill, never only the first.
  const pending = v.jobs.filter((j) => (j.working || j.interrupted) && !hasPanel(j.note));
  if (!pending.length) return null;
  return (
    <div className="mr-pills" role="status" aria-label="Unfinished meetings">
      {pending.map((job) => {
        const writing = !!job.working;
        const title = A.displayName(job.note);
        return (
          <div key={job.id} className={`mr-pill${writing ? ' is-working' : ' is-interrupted'}`}>
            {writing ? <span className="mr-spin" aria-hidden="true" /> : <Icon name="warning" size={14} className="mr-pill-warn" />}
            <button className="mr-pill-name" onClick={() => A.openPath(job.note, { where: 'current' })} title="Open the meeting note">
              {writing ? `Writing up · ${title}` : `“${title}” stopped mid-way`}
            </button>
            {!writing && (
              <button className="button mr-pill-go" onClick={() => void finishJob(job.id).catch(showError)}>
                Finish it
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
