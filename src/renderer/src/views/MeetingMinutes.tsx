// Minutes ready to send (5 Nov 2026). After the notes are written, one clear action makes the minutes from the
// transcript on the person's connected model (src/shared/meeting-minutes.ts, through the recorder's minutes door).
// Then the words to check before it goes out (src/shared/meeting-words.ts: spelt two ways, close to a known word, or
// rare), each with context, spellings and a click to play that moment; one correction fixes every copy and is
// remembered. Thin stretches offer once to hear again from the saved recording. Then the branded PDF, kept with the
// note through Share. Nothing blocks, nothing to set up. The recorder, playback and actions below and above stay as
// they are.
import { aiReadyOrSay } from '../components/AiSetup';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MeetingContext } from '../../../main/reviews';
import { dueWords, readTranscript, type TranscriptPartRead } from '../../../shared/meeting-notes';
import { marksFromLines, readAllSpeakerNames, readSpeakerNames, speakerDisplay, speakerPartKey, staleSpeakerLabels } from '../../../shared/meeting-speakers';
import { applyMeetingMinutes, hasMinutesExisting, minutesFallbackWords, minutesWords, readMinutesExisting, tidiedWords } from '../../../shared/meeting-minutes';
import { CHECK_LIMIT, applyCorrection, findThinStretches, findUncertain, isPersonName, lengthMs, replaceTranscriptStretch, type ThinStretch, type UncertainWord } from '../../../shared/meeting-words';
import { clockWords, downsample, encodeWav, stamp, transcribeHints, transcriptText, type TranscriptLine } from '../../../shared/recorder';
import { isMeetingNote, notePeople } from '../../../shared/meetings';
import { isPrivatePath } from '../../../shared/private';
import { Icon } from '../components/Icon';
import { useContextPane } from '../components/ListDetail';
import { createPortal } from 'react-dom';
import { errorMessage } from '../lib/errors';
import { fileUrl, resolveFile } from '../lib/resolve';
import { writeLink } from '../lib/links';
import * as A from '../state/actions';
import { docs } from '../state/docs';
import { moduleChanged } from '../state/modules';
import { getPerson } from '../state/person';
import { playAt } from '../state/playback';
import { emailShare, saveSharePdf } from '../state/share';
import { getState, showError, toast, useApp } from '../state/store';
import { fixHintWords, fixesFor, forgetFix, gapsOffered, loadWordFixes, markGapsOffered, minutesCheckSkipped, rememberFix, skipMinutesCheck, transcriptFingerprint, unskipMinutesCheck } from '../state/wordFixes';

const MINUTES_MADE = /(^|\n)##\s+(open|discussion)\b/i;

/** A minutes run as every door to the note shows it, kept outside the component (5 Nov 2026: the Meetings page
 *  mounts one card per phase — live, before, after — so a phase change mid-run remounted the card and the error
 *  words never showed). Keyed by note: a remount shows the same run, in the same words. */
interface MinutesRun {
  phase: 'working' | 'error';
  startedAt: number;
  requestId: string;
  error?: string;
}
const minuteRuns = new Map<string, MinutesRun>();
const minuteListeners = new Set<() => void>();
const emitMinutes = () => {
  for (const fn of minuteListeners) fn();
};
function useMinutesRun(note: string): MinutesRun | null {
  return useSyncExternalStore(
    (fn) => {
      minuteListeners.add(fn);
      return () => minuteListeners.delete(fn);
    },
    () => minuteRuns.get(note) ?? null,
  );
}

interface Found extends UncertainWord {
  part: number;
}

export function MeetingMinutes(props: { path: string; text: string; canEdit: boolean; onChangeText(next: string): void }) {
  // Ordinary notes skip everything below (t102, 9 Nov 2026): the memos scanned the note's text on every
  // keystroke, then returned null here. Meeting-ness reads the path and the stored properties, never the text.
  const stored = useApp((s) => s.byPath.get(props.path)?.props);
  if (isPrivatePath(props.path) || !isMeetingNote(props.path, stored ?? {})) return null;
  return <MeetingMinutesInner {...props} />;
}

function MeetingMinutesInner({ path, text, canEdit, onChangeText }: { path: string; text: string; canEdit: boolean; onChangeText(next: string): void }) {
  const revision = useApp((s) => s.revision);
  const props = useApp((s) => s.byPath.get(path)?.props);
  const [ctx, setCtx] = useState<MeetingContext | null>(null);
  const run = useMinutesRun(path);
  const busy = run?.phase === 'working';
  const [, setTick] = useState(0);
  const [hearing, setHearing] = useState(false);
  const [fixesTick, setFixesTick] = useState(0);
  const box = useRef<HTMLElement>(null);
  const isMeeting = !isPrivatePath(path) && isMeetingNote(path, props ?? {});
  // The meeting page's far-right region at a very wide window (round 3): the words to check stand there, beside the
  // minutes and the transcript, instead of a narrow strip down the minutes.
  const wordsSlot = useContextPane();

  // The time so far, ticking while the minutes are made (shown after 15 seconds).
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
    // The run's start is the clock; the run object itself is remade on every emit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, run?.startedAt]);

  useEffect(() => {
    // Looked up only on a meeting (t146, 9 Nov 2026): every note asked the bridge for its meeting context on
    // every open and all but meetings threw the answer away at the render below.
    if (!isMeeting) {
      setCtx(null);
      return;
    }
    let alive = true;
    window.nv.meetings.context(path).then((c) => alive && setCtx(c), () => alive && setCtx(null));
    void loadWordFixes().then(() => alive && setFixesTick((t) => t + 1), () => undefined);
    return () => {
      alive = false;
    };
  }, [path, revision, isMeeting]);

  // Share's nudge ("Check the words" before a PDF or email): the list back, in sight.
  useEffect(() => {
    const onCheck = (e: Event) => {
      if ((e as CustomEvent).detail !== path) return;
      unskipMinutesCheck(path);
      setFixesTick((t) => t + 1);
      requestAnimationFrame(() => box.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    };
    window.addEventListener('nv-minutes-check', onCheck);
    return () => window.removeEventListener('nv-minutes-check', onCheck);
  }, [path]);

  const parts: TranscriptPartRead[] = useMemo(() => (text.includes('Transcript') ? readTranscript(text) : []), [text]);
  const lines = useMemo(() => parts.flatMap((p) => p.lines), [parts]);
  const made = MINUTES_MADE.test(text);
  // The minutes themselves for the card (t301, 18 Nov 2026): the summary, decisions and actions read here once
  // made — not only the check card and Save as PDF.
  const minutesHere = useMemo(() => (made ? readMinutesExisting(text) : null), [made, text]);
  // Named after the minutes were made (6 Nov 2026): the written words on disk still say "Speaker N" (every door
  // a person reads shows the names, but the words themselves, and the actions' owners, only change by making
  // them again). Said plainly, one click, never a silent rewrite of what stands.
  const stale = useMemo(() => (made ? staleSpeakerLabels(text) : []), [made, text]);
  const fingerprint = useMemo(() => transcriptFingerprint(parts), [parts]);
  const skipped = useMemo(() => minutesCheckSkipped(path, fingerprint), [path, fingerprint, fixesTick]);
  const projectKey = ctx?.projects[0]?.path ?? null;

  const known = useMemo(() => {
    const base = ctx?.known?.length ? ctx.known : (ctx?.people ?? []);
    // Voices named on the meeting's page read as known too (6 Nov 2026, speakers).
    const voiced = Object.values(readAllSpeakerNames(text)).flatMap((m) => Object.values(m));
    return [...base, ...voiced, ...Object.values(fixesFor(projectKey))];
    // fixesTick re-reads the remembered rights after a fix lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, projectKey, fixesTick, text]);

  const uncertain: Found[] = useMemo(() => {
    if (!made || skipped || !lines.length) return [];
    return parts.flatMap((p, i) => findUncertain(p.lines, known).map((u) => ({ ...u, part: i }))).slice(0, CHECK_LIMIT);
  }, [made, skipped, parts, lines.length, known]);

  const gaps = useMemo(() => {
    if (!made || !lines.length) return [];
    const offered = new Set(gapsOffered(path));
    const out: { part: number; rel: string; stretches: ThinStretch[] }[] = [];
    parts.forEach((p, i) => {
      const rel = p.recording ? resolveFile(p.recording, path) : null;
      const ms = lengthMs(p.length);
      if (!rel || ms === null) return;
      const fresh = findThinStretches(p.lines, ms).filter((s) => !offered.has(`${i}:${s.cover}`));
      if (fresh.length) out.push({ part: i, rel, stretches: fresh });
    });
    return out;
    // fixesTick unused: gaps depend on the transcript, offered marks, and the recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [made, parts, lines.length, path, fixesTick]);

  if (!isMeeting || !ctx?.meeting) return null;
  if (!lines.length) return null;

  const make = async () => {
    // The shared map, read synchronously (t171, 9 Nov 2026 break-it: busy is React state, so two
    // doors pressed before the re-render both ran the ask and applied two minutes).
    if (busy || minuteRuns.get(path)?.phase === 'working' || !canEdit) return;
    // No AI connection yet: one calm line with the way to add one, never a failed run.
    if (!aiReadyOrSay()) return;
    const requestId = crypto.randomUUID();
    minuteRuns.set(path, { phase: 'working', startedAt: Date.now(), requestId });
    emitMinutes();
    // Only this run's ending lands (a second Make from another door owns the card after it).
    const finish = (next: MinutesRun | null) => {
      if (minuteRuns.get(path)?.requestId === requestId) {
        if (next) minuteRuns.set(path, next);
        else minuteRuns.delete(path);
        emitMinutes();
      }
    };
    try {
      // Each recording's voices with the names set on them (6 Nov 2026, speakers): the minutes use the names, and an
      // unnamed voice stays "Speaker N" everywhere (never guessed, never an owner as if known).
      const before = docs.text(path) ?? text;
      const perPart = parts.map((p, i) => ({ heading: p.heading, marks: marksFromLines(p.lines, 'mix'), names: readSpeakerNames(before, speakerPartKey(i, p.heading)) }));
      // The transcript goes in its "Speaker N" labels, the names told beside it (6 Nov 2026, the first real
      // owners run: with each line already reading "Alex Rivera:", the model gave every "I'll…" in the long
      // mixed segments to Alex and Kate, six owners wrong of twelve; the same transcript in its labels, with
      // owners worked out from the words, is the run that holds at none wrong).
      const all = parts.length > 1 ? parts.map((p, i) => `— Part ${i + 1} —\n${transcriptText(p.lines)}`).join('\n\n') : transcriptText(parts[0]?.lines ?? []);
      const speakerParts = perPart.filter((p) => p.marks.length);
      // The meeting's own list (its people, not the vault's), and the recorder's name: this meeting's project
      // owner, else the app's account name, else the name the notes know (5 Nov 2026, p7-minutes-for-others).
      const attendees = notePeople(before, props ?? {});
      const me = ctx.me ?? getPerson() ?? undefined;
      // What the note already holds rides along (6 Nov 2026, restated decisions): the answer comes back as the
      // merged whole, each point and job once however worded, and replaces only the recorder's own lines.
      const held = readMinutesExisting(before);
      const r = await window.nv.recorder.minutes(path, { title: A.titleOf(path), date: ctx.date, transcript: all, people: ctx.people, ...(attendees.length ? { attendees } : {}), ...(me ? { me } : {}), ...(speakerParts.length ? { speakers: { parts: speakerParts } } : {}), ...(hasMinutesExisting(held) ? { existing: held } : {}) }, requestId);
      if (!r.minutes) {
        finish({ phase: 'error', startedAt: Date.now(), requestId, error: r.error ?? 'The minutes could not be made.' });
        return;
      }
      const current = docs.text(path) ?? text;
      const rel = parts[0].recording ? resolveFile(parts[0].recording, path) : null;
      // Notes' names an "Update <document>" action links against (this note and private notes never;
      // twins ride along, so a name two notes share links nowhere).
      const knownDocs = getState()
        .notes.filter((n) => n.path !== path && !isPrivatePath(n.path))
        .map((n) => (n.label || n.title).trim())
        .filter(Boolean);
      const applied = applyMeetingMinutes(current, r.minutes, { people: ctx.people, date: ctx.date, ...(attendees.length ? { attendees } : {}), ...(me ? { me } : {}), ...(knownDocs.length ? { docs: knownDocs } : {}), ...(hasMinutesExisting(held) ? { merged: true } : {}), ...(rel ? { timeLink: (t: number) => writeLink(rel, path, { heading: stamp(t), alias: stamp(t) }) } : {}) });
      const changed = applied.text !== current;
      if (changed) onChangeText(applied.text);
      // The run ends here, before the save settles (18 Nov 2026, t301: the bar always ends with the minutes shown
      // or a plain error — never stuck on a slow save).
      finish(null);
      if (changed) {
        // The meetings model reads the note again (t166, 9 Nov 2026: the page kept showing "No actions yet" after
        // the minutes landed, until the person left and came back — every module job refreshes through workDid,
        // but the minutes save directly). Saved first, so the re-read sees them. Best-effort: the minutes landed.
        try {
          await docs.flush(path).catch(() => null);
          moduleChanged();
        } catch {
          // The note holds the minutes; the refresh missed. Nothing to undo.
        }
      }
      // A merged run tidies lines, so it offers Undo (the untouched note is the judge of whether it may); when
      // it tidied restated lines the toast says how many (6 Nov 2026, m9: nothing a person wrote is ever lost).
      // A partial run landed the minutes from what was there instead of the full review: said plainly.
      const words = applied.tidied ? `${minutesWords(r.minutes, applied.added)} ${tidiedWords(applied.tidied)}` : minutesWords(r.minutes, applied.added);
      const said = r.partial ? minutesFallbackWords() : words;
      if (applied.text !== current) toast(said, hasMinutesExisting(held) ? { label: 'Undo', run: () => ((docs.text(path) ?? text) !== applied.text ? toast('The note changed since, so nothing was undone.') : (onChangeText(current), toast('Undone.'))) } : undefined);
      else toast(said);
    } catch (err) {
      finish({ phase: 'error', startedAt: Date.now(), requestId, error: errorMessage(err) });
    }
  };

  const stop = () => {
    const id = minuteRuns.get(path)?.requestId;
    if (id) void window.nv.recorder.cancel(id);
  };

  const elapsed = run?.phase === 'working' ? Date.now() - run.startedAt : 0;
  const workingLine = busy && elapsed >= 15_000 ? `${clockWords(elapsed)} so far.` : null;

  return (
    <section ref={box} className="mm" aria-label="Minutes ready to send" id="mm-check">
      {!made ? (
        <div className="mm-make">
          <button type="button" className="button primary" disabled={!canEdit || busy} onClick={() => void make()}>
            {busy ? 'Making the minutes…' : 'Make the minutes'}
          </button>
          {busy && (
            <button type="button" className="button" onClick={stop}>
              Stop
            </button>
          )}
          {workingLine ? (
            <p className="mm-words" role="status">
              {workingLine}
            </p>
          ) : (
            <p className="mm-words">From the transcript: who was there, a short summary, decisions, every action with its owner and due day, the questions asked, key dates and figures, and the discussion by topic.</p>
          )}
        </div>
      ) : (
        <div className="mm-done">
          <div className="mm-head">
            <span className="mm-title">
              <Icon name="check" size={14} />
              <strong>Minutes made.</strong>
            </span>
            {canEdit && (
              <span className="mm-acts">
                {busy && (
                  <button type="button" className="text-button" onClick={stop}>
                    Stop
                  </button>
                )}
                <button type="button" className="text-button" disabled={busy} onClick={() => void make()} title="Run the minutes again (never doubles)">
                  {busy ? 'Making…' : 'Make again'}
                </button>
              </span>
            )}
          </div>
          {workingLine && (
            <p className="mm-words" role="status">
              {workingLine}
            </p>
          )}
          {stale.length > 0 && (
            <p className="mm-words">
              The minutes were made before {stale.map(speakerDisplay).join(' and ')} {stale.length === 1 ? 'was' : 'were'} named, so the written words still say {stale.map(speakerDisplay).join(' and ')}.{' '}
              {canEdit && (
                <button type="button" className="text-button" disabled={busy} onClick={() => void make()}>
                  Make the minutes again to use the names
                </button>
              )}
            </p>
          )}
          {minutesHere && (minutesHere.summary || (minutesHere.decisions?.length ?? 0) > 0 || (minutesHere.actions?.length ?? 0) > 0) ? (
            <div className="mm-minutes">
              {minutesHere.summary ? <p>{stripLinks(minutesHere.summary)}</p> : null}
              {(minutesHere.decisions?.length ?? 0) > 0 ? (
                <div className="mm-min-block">
                  <span className="mm-faint">Decisions · {minutesHere.decisions!.length}</span>
                  <ul>
                    {minutesHere.decisions!.map((d, i) => (
                      <li key={i}>{stripLinks(d)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {(minutesHere.actions?.length ?? 0) > 0 ? (
                <div className="mm-min-block">
                  <span className="mm-faint">Actions · {minutesHere.actions!.length}</span>
                  <ul>
                    {minutesHere.actions!.map((a, i) => (
                      <li key={i}>{stripLinks(`${a.what}${a.who ? ` — ${a.who}` : ''}${a.due ? ` · by ${dueWords(a.due)}` : a.when ? ` · by ${a.when}` : ''}`)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          {uncertain.length > 0 &&
            (() => {
              const list = <CheckList path={path} found={uncertain} parts={parts} canEdit={canEdit} text={text} onChangeText={onChangeText} projectKey={projectKey} projectName={ctx.projects[0]?.name} onSkip={() => (skipMinutesCheck(path, fingerprint), setFixesTick((t) => t + 1))} />;
              return wordsSlot ? createPortal(<section className="mm mm-aside" aria-label="Words to check">{list}</section>, wordsSlot) : list;
            })()}
          {uncertain.length === 0 && !skipped && <p className="mm-words">The words all read right.</p>}
          {skipped && (
            <p className="mm-words">
              Words skipped.{' '}
              <button type="button" className="text-button" onClick={() => (unskipMinutesCheck(path), setFixesTick((t) => t + 1))}>
                Show again
              </button>
            </p>
          )}
          {gaps.length > 0 && canEdit && <Gaps path={path} gaps={gaps} title={A.titleOf(path)} people={ctx.people} project={typeof props?.project === 'string' ? props.project : ''} projectKey={projectKey} text={text} onChangeText={onChangeText} hearing={hearing} setHearing={setHearing} onDone={() => setFixesTick((t) => t + 1)} />}
          <div className="mm-finish">
            <button type="button" className="button primary" onClick={() => void saveSharePdf(path)}>
              Save as PDF
            </button>
            <button type="button" className="button" onClick={() => void emailShare(path)}>
              Email it
            </button>
            <span className="mm-words">The branded PDF, ready to send.</span>
          </div>
        </div>
      )}
      {run?.phase === 'error' && run.error && (
        <div className="mm-error">
          <p className="mm-said" role="alert">
            {run.error} What is already in the note stays as it is.
          </p>
          {canEdit && (
            <button type="button" className="button small" onClick={() => void make()}>
              Try again
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** The minutes card where a meeting opens outside its note (6 Nov 2026, the Meetings page's own page showed the
 *  recording with no way to make the minutes): the note's words read here and written through the shared writer,
 *  the one MeetingMinutes below, so the card, the word check and the gaps offer are the same component in both
 *  doors. Nothing renders until the note's words arrive, and MeetingMinutes itself stays null without them. */
export function MeetingMinutesHere({ path, canEdit }: { path: string; canEdit: boolean }) {
  const [text, setText] = useState<string | null>(null);
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
  const change = useCallback((next: string) => docs.update(path, next, 'minutes'), [path]);
  if (text === null) return null;
  return <MeetingMinutes path={path} text={text} canEdit={canEdit} onChangeText={change} />;
}

/** A note's links read as their words ("Harbour", never "[[Harbour Stores|Harbour]]"). */
const stripLinks = (s: string): string => s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');

function reasonWords(u: UncertainWord): string {
  if (u.reason === 'spelt-two-ways') return 'Spelt two ways';
  if (u.reason === 'close-to-known' && u.known) return `Close to ${u.known}`;
  // Counts past two reach here (an initialism said three or more times still gets one row).
  return u.count <= 1 ? 'Said once' : u.count === 2 ? 'Said twice' : `Said ${u.count} times`;
}

function CheckList({ path, found, parts, canEdit, text, onChangeText, projectKey, projectName, onSkip }: { path: string; found: Found[]; parts: TranscriptPartRead[]; canEdit: boolean; text: string; onChangeText(next: string): void; projectKey: string | null; projectName?: string; onSkip(): void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const play = (f: Found) => {
    const rec = parts[f.part]?.recording ? resolveFile(parts[f.part].recording!, path) : null;
    if (!rec) return;
    if (!playAt(rec, f.spots[0].at)) A.openPath(rec, { where: 'tab' });
  };
  const fix = async (f: Found) => {
    const key = `${f.part}:${f.display}`;
    const value = (values[key] ?? f.known ?? '').replace(/\s+/g, ' ').trim();
    if (!value || !canEdit) return;
    const current = docs.text(path) ?? text;
    const r = applyCorrection(current, f.spellings, value);
    if (!r.count) {
      toast('Nothing to fix.');
      return;
    }
    onChangeText(r.text);
    const person = isPersonName(value);
    await rememberFix(projectKey, f.spellings, value, person).catch(() => undefined);
    setValues((v) => ({ ...v, [key]: '' }));
    // A one-click fix across a note offers Undo for the copies and the remembered word (6 Nov 2026, the
    // Fitzroy run's "Fixed 9 copies" toast had none). The note's own words judge, as the minutes' Undo does.
    toast(`Fixed ${r.count} ${r.count === 1 ? 'copy' : 'copies'}${projectName ? ` and remembered for ${projectName}` : ''}${person ? ' and your people' : ''}.`, {
      label: 'Undo',
      run: () => {
        if ((docs.text(path) ?? text) !== r.text) {
          toast('The note changed since, so nothing was undone.');
          return;
        }
        onChangeText(current);
        void forgetFix(projectKey, f.spellings, value, person).catch(() => undefined);
        toast('Undone.');
      },
    });
  };
  return (
    <div className="mm-check">
      <p className="mm-words">
        <strong>{found.length === 1 ? '1 word to check' : `${found.length} words to check`} before it goes out.</strong>{' '}
        <button type="button" className="text-button" onClick={onSkip}>
          Skip for now
        </button>
      </p>
      <ul className="mm-list">
        {found.map((f) => {
          const key = `${f.part}:${f.display}`;
          const rec = parts[f.part]?.recording ? resolveFile(parts[f.part].recording!, path) : null;
          return (
            <li key={key} className="mm-row">
              <span className="mm-word">
                <strong>{f.display}</strong>
                <span className="mm-faint">{reasonWords(f)}</span>
              </span>
              <span className="mm-seen">Seen as: {f.spellings.join(', ')}</span>
              <span className="mm-context">
                <span className="mm-quote">{f.spots[0].context}</span>
                {rec ? (
                  <button type="button" className="text-button" onClick={() => play(f)} title={`Play that moment (${stamp(f.spots[0].at)})`}>
                    Play
                  </button>
                ) : (
                  <span className="mm-faint" title="The recording was not kept">
                    No recording
                  </span>
                )}
              </span>
              {canEdit && (
                <span className="mm-fix">
                  <input type="text" value={values[key] ?? f.known ?? ''} size={Math.min(48, Math.max(24, (values[key] ?? f.known ?? '').length + 2))} placeholder="Correct spelling" aria-label={`Correct spelling of ${f.display}`} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && void fix(f)} />
                  <button type="button" className="button small" onClick={() => void fix(f)}>
                    Fix every copy
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Gaps({ path, gaps, title, people, project, projectKey, text, onChangeText, hearing, setHearing, onDone }: { path: string; gaps: { part: number; rel: string; stretches: ThinStretch[] }[]; title: string; people: string[]; project: string; projectKey: string | null; text: string; onChangeText(next: string): void; hearing: boolean; setHearing(v: boolean): void; onDone(): void }) {
  const leave = () => {
    markGapsOffered(path, gaps.flatMap((g) => g.stretches.map((s) => `${g.part}:${s.cover}`)));
    onDone();
  };
  const hear = async () => {
    if (hearing) return;
    setHearing(true);
    try {
      const hints = transcribeHints({ title, people: [...people, ...fixHintWords(projectKey)], project });
      let heard = 0;
      for (const g of gaps) {
        for (const s of g.stretches) {
          const lines = await hearStretch(g.rel, s.start, s.end, hints);
          if (!lines.length) continue;
          const current = docs.text(path) ?? text;
          const r = replaceTranscriptStretch(current, s.start, s.end, lines, g.part);
          if (r.text !== current) onChangeText(r.text);
          heard++;
        }
        markGapsOffered(path, g.stretches.map((s) => `${g.part}:${s.cover}`));
      }
      toast(heard ? `Heard ${heard} ${heard === 1 ? 'stretch' : 'stretches'} again from the recording.` : 'Nothing new came back from the recording.');
      onDone();
    } catch (err) {
      showError(err);
    } finally {
      setHearing(false);
    }
  };
  const covers = gaps.flatMap((g) => g.stretches.map((s) => s.cover)).join('; ');
  return (
    <div className="mm-gaps">
      <p className="mm-words">Some stretches came back very short ({covers}). Hear them again from the recording? It may cost a little.</p>
      <span className="mm-acts">
        <button type="button" className="button" disabled={hearing} onClick={() => void hear()}>
          {hearing ? 'Hearing them again…' : 'Hear again'}
        </button>
        <button type="button" className="text-button" disabled={hearing} onClick={leave}>
          Leave it
        </button>
      </span>
    </div>
  );
}

/** A stretch heard again from the saved recording: sliced, written down through the person's speech route, timed. */
async function hearStretch(rel: string, start: number, end: number): Promise<TranscriptLine[]>;
async function hearStretch(rel: string, start: number, end: number, hints: string[]): Promise<TranscriptLine[]>;
async function hearStretch(rel: string, start: number, end: number, hints: string[] = []): Promise<TranscriptLine[]> {
  const res = await fetch(fileUrl(rel));
  if (!res.ok) throw new Error('The recording could not be read.');
  const bytes = new Uint8Array(await res.arrayBuffer());
  const Ctx: typeof AudioContext | undefined = typeof AudioContext !== 'undefined' ? AudioContext : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error('The recording could not be read on this PC.');
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(bytes.buffer as ArrayBuffer);
    const rate = buf.sampleRate;
    const data = buf.getChannelData(0);
    const out: TranscriptLine[] = [];
    // Slices the speech service takes (90 seconds keeps well under its 4 MB).
    for (let at = start; at < end; at += 90) {
      const to = Math.min(end, at + 90);
      const slice = data.subarray(Math.max(0, Math.floor(at * rate)), Math.min(data.length, Math.floor(to * rate)));
      if (!slice.length) continue;
      const wav = encodeWav(downsample(slice, rate, 16_000), 16_000);
      const r = await window.nv.recorder.transcribe(wav, 'audio/wav', hints);
      if ('error' in r) throw new Error(r.error);
      if (r.segments?.length) for (const s of r.segments) out.push({ at: Math.round((at + Math.max(0, s.start)) * 10) / 10, text: s.text });
      else if (r.text.trim()) out.push({ at: Math.round(at * 10) / 10, text: r.text.trim() });
    }
    return out.sort((a, b) => a.at - b.at);
  } finally {
    void ctx.close().catch(() => undefined);
  }
}
