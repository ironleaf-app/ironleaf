// Meetings (Wave 6 part b; the catalogue, row 3; 8.7 w2b, 30 Oct 2026): one Meetings place, no second path. The home is
// the mock-up's list (stats, Upcoming / Past / Series / Every action / Every decision, the week beside it on Calendar),
// and one meeting page in three states: before (agenda, prep, record set-up), during (the recorder and live words), after
// (summary, decisions, actions that tick into tasks). Wired to the app's real recorder and meeting notes throughout: the
// same Meeting note, the same prep pack, the same filing into the project's next steps. The record views (every meeting
// as a table, the month grid, every action and decision) stay where they were, under the chips and the Calendar, so
// nothing the person could do is lost.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { defaultRecordView } from '../../../../../shared/record-views';
import { meetingActionCounts, meetingDayLabel, meetingPhase, meetingStats, meetingTimeWords, prepAnswer } from '../../../../../shared/work-meetings';
import type { MeetingActionRec, MeetingRec, MeetingsModel, PrepItem, PrepPack, SeriesRec } from '../../../../../shared/work-meetings';
import { MEETINGS, SERIES_CADENCES, WEEKDAYS } from '../../../../../shared/work-modules';
import type { WsRecord } from '../../../../../shared/workspace-records';
import { afterflowFoldWords, meetingsNeedingAfterflow } from '../../../../../shared/meeting-after';
import { EmptyState } from '../../../components/EmptyState';
import { Icon, type IconName } from '../../../components/Icon';
import { openMenu, type MenuItem } from '../../../components/Menu';
import { ListFind, restoreFindFolds, useFindMemory } from '../../../components/PageTabs';
import { pickFile } from '../../../components/Pickers';
import { ShareButton } from '../../../components/ShareButton';
import { useEscape } from '../../../lib/useEscape';
import { initials } from '../../../lib/projectLook';
import * as A from '../../../state/actions';
import { deleteToBin } from '../../../lib/removeWords';
import { modulesOn, partOn } from '../../../../../shared/life-modules';
import { openTour } from '../../../state/moduleFills';
import { openModule, setModule, useModules } from '../../../state/modules';
import { peek } from '../../../state/peek';
import { clearJobSpeakerName, jobFor, jobSpeakerUndoable, liveClip, mergeJobVoices, pauseRecording, resumeRecording, setJobSpeakerName, startRecording, stopRecording, undoJobSpeakers, useElapsed, useMics, useRecorder } from '../../../state/recorder';
import { SpeakerNames, useSpeakerSuggestions } from '../../../components/SpeakerNames';
import { docs } from '../../../state/docs';
import { allSpeakerNames, relabelSpeakerMentions, shownWho, speakerNum, splitSentences } from '../../../../../shared/meeting-speakers';
import { countWords } from '../../../../../shared/vault-place';
import { showError, toast, useApp, usePrefs } from '../../../state/store';
import { plainWords, useWork, useWorkOptions, workCall, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { setTabSection } from '../../../state/workspace';
import { setWorkspace } from '../../../state/layout';
import { EditorContext, Inline } from '../../project/Inline';
import { openRecordForm, RecordFormHost, valueWords } from '../RecordForm';
import { addFromFiles } from '../recordActions';
import { moduleFolder } from '../../../../../shared/module-records';
import { getAreas } from '../../../state/areas';
import { PackSection, PackShell, packName, rowContext, rowMenu } from '../pack87';
import { dayText, inDays, openDetail, placeOf, todayIso, useWorkCtx, WithRecords, WorkViews } from './WorkShell';
import { visibleWho } from '../../../components/plan/plan';
import { WeekCalendar } from '../../meetings/WeekCalendar';
import { MeetingRecorder, MicPicker } from '../../MeetingRecorder';
import { MeetingMinutesHere } from '../../MeetingMinutes';
import { ContextPaneProvider, ListDetail, readingBody, RecordConnections, RecordDetail, useSettled, useWidth } from '../../../components/ListDetail';
import { ReadingView } from '../../../components/ReadingView';
import { requestSearch } from '../../../state/modals';
import { ViewHeader } from '../../ViewHeader';
import type { RecorderStatus } from '../../../../../main/meeting-recorder';
import { TranscriptOpen, useMeetingParts, useNoteText } from '../../MeetingPlayback';
import { clockWords, isBusy, mergeTranscript } from '../../../../../shared/recorder';
import '../../../styles/w2b.css';

// Who the person is (Today's own reading), so their own name never shows on their own actions here (8.0,
// 29 Oct 2026; sweep 032: it was a module-level value with no re-render when it landed, so the person's
// own "Jesse" chip stayed). Component state, the ProjectPage pattern: the page re-reads when it arrives.
function useMe(): string | null {
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void window.nv?.today?.data?.().then((d) => live && setMe(d.me ?? null), () => undefined);
    return () => void (live = false);
  }, []);
  return me;
}
const who = (name: string | undefined, me: string | null): string => visibleWho(name, me);

type Act = MeetingActionRec & { inProject: boolean; projectDone: boolean };
type Meet = Omit<MeetingRec, 'actions'> & { actions: Act[] };
export type MeetingsView = Omit<MeetingsModel, 'meetings' | 'upcoming' | 'recent'> & { meetings: Meet[]; upcoming: Meet[]; recent: Meet[]; people: string[]; projects: { path: string; name: string }[]; folder: string; seriesFolder: string; prepOn: boolean; seriesOn: boolean };

const call = <T,>(name: string, ...args: unknown[]) => workCall<T>('meetings', name, ...args);
const isDone = (a: Act) => a.done || a.projectDone;
const openMeeting = (path: string, where: W.Where = 'current') => (where === 'tab' ? openModule('meetings', `meeting:${encodeURIComponent(path)}`, 'tab') : openDetail('meetings', 'meeting', path));
const openSeries = (path: string) => openDetail('meetings', 'series', path);
const bareTitle = (t: string) => t.replace(/^\d{4}-\d{2}-\d{2}\s*/, '') || t;
/** What the home's Find reads on a meeting row: the words the row shows (title, day, people, project, place). */
const meetingHay = (m: Meet, today: string): string => `${bareTitle(m.title)} ${meetingDayLabel(m.date, today)} ${meetingTimeWords(m.time)} ${m.where ?? ''} ${m.people.join(' ')} ${m.project}`.toLowerCase();
/** What the home's Find reads on a record row: the title, project and every field it shows. */
const recordHay = (r: WsRecord): string => `${r.title} ${r.projectName ?? ''} ${Object.values(r.fields ?? {}).map((v) => String(v ?? '')).join(' ')}`.toLowerCase();

/** Meetings' own settings (Meetings settings): whether each person's open actions ride in the prep pack. Kept in
 *  the vault's module options. */
function useMeetingSettings(): { includeActions: boolean; save(p: { includeActions?: boolean }): void } {
  const { options, save } = useWorkOptions('meetings');
  const s = options?.['meetings']?.settings ?? {};
  return {
    includeActions: s.includeActions !== false,
    save: (p) => void save({ settings: { ...s, ...p } }),
  };
}

function Editable({ path, children }: { path: string; children: ReactNode }) {
  const canEdit = useApp((s) => s.canEdit);
  const value = useMemo(() => ({ path, canEdit, known: { people: [], tags: [] }, edit: async () => false }), [path, canEdit]);
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

function Person({ name, people, onRemove }: { name: string; people: string[]; onRemove?(): void }) {
  const known = people.find((p) => p.toLowerCase() === name.toLowerCase());
  return (
    <span className="pill outline w2b-person-pill">
      <button type="button" className="w2b-link w2b-person-main" onClick={() => (known ? peek({ type: 'person', name: known }, { title: known, type: 'person' }) : toast(`${name} has no People note yet. Typing @${name.split(' ')[0]} in a note makes one.`))} title={known ? `Everything about ${known}` : `${name} (no People note yet)`}>
        <span className="miniava slate" aria-hidden="true">{initials(name)}</span>
        <span>{name}</span>
      </button>
      {onRemove && (
        <button type="button" className="w2b-x" aria-label={`Take ${name} off`} title="Take them off this meeting" onClick={onRemove}>
          <Icon name="close" size={10} />
        </button>
      )}
    </span>
  );
}

// ── Forms ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function newMeeting(view: MeetingsView | null, prefill: { project?: string; series?: string } = {}) {
  openRecordForm({
    title: 'New meeting',
    icon: 'calendar',
    line: 'Who is coming and what it is for. What is agreed is its project’s tasks from the moment it is written.',
    ok: 'Add it',
    fields: [
      { key: 'name', label: 'What it is', kind: 'text', required: true, wide: true, placeholder: 'Fit-out progress meeting' },
      { key: 'date', label: 'Day', kind: 'date', required: true, value: todayIso() },
      { key: 'time', label: 'Time', kind: 'text', placeholder: '10:00 AM' },
      { key: 'attendees', label: 'Who is coming', kind: 'text', wide: true, placeholder: 'Names, with commas between', hint: view?.people.length ? `People you keep notes on: ${view.people.slice(0, 6).join(', ')}${view.people.length > 6 ? `, and ${view.people.length - 6} more` : ''}` : undefined },
      { key: 'project', label: 'Project', kind: 'choice', options: ['', ...(view?.projects.map((p) => p.name) ?? [])], value: prefill.project ?? '' },
      { key: 'where', label: 'Where', kind: 'text', placeholder: 'Teams, the site office…' },
      { key: 'agenda', label: 'Agenda', kind: 'text', wide: true, placeholder: 'Items, with semicolons between' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-meeting', { title: valueWords(v, 'name'), date: valueWords(v, 'date'), time: valueWords(v, 'time'), where: valueWords(v, 'where'), attendees: valueWords(v, 'attendees').split(/\s*[,;]\s*/).filter(Boolean), project: valueWords(v, 'project'), series: prefill.series ?? '', agenda: valueWords(v, 'agenda').split(/\s*;\s*/).filter(Boolean) });
      await workDid(Promise.resolve(rel), `Added ${valueWords(v, 'name')}.`);
      openMeeting(rel);
    },
  });
}

function newSeries(view: MeetingsView | null) {
  openRecordForm({
    title: 'New meeting series',
    icon: 'history',
    line: 'A meeting that comes round. Each one starts from the last: its people, project, standing agenda, and what was left open.',
    ok: 'Make it',
    fields: [
      { key: 'name', label: 'Its name', kind: 'text', required: true, wide: true, placeholder: 'Weekly site sync' },
      { key: 'cadence', label: 'How often', kind: 'segment', options: [...SERIES_CADENCES] },
      { key: 'day', label: 'Day', kind: 'choice', options: ['', ...WEEKDAYS] },
      { key: 'time', label: 'Time', kind: 'text', placeholder: '10:00 AM' },
      { key: 'attendees', label: 'Who comes', kind: 'text', wide: true, placeholder: 'Names, with commas between' },
      { key: 'project', label: 'Project', kind: 'choice', options: ['', ...(view?.projects.map((p) => p.name) ?? [])] },
      { key: 'standing', label: 'Standing agenda', kind: 'text', wide: true, placeholder: 'Items every time, with semicolons between' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-series', { name: valueWords(v, 'name'), cadence: valueWords(v, 'cadence'), day: valueWords(v, 'day'), time: valueWords(v, 'time'), attendees: valueWords(v, 'attendees').split(/\s*[,;]\s*/).filter(Boolean), project: valueWords(v, 'project'), standing: valueWords(v, 'standing').split(/\s*;\s*/).filter(Boolean) });
      await workDid(Promise.resolve(rel), `Made the series ${valueWords(v, 'name')}.`);
      openSeries(rel);
    },
  });
}

function makeSeriesFrom(m: Meet, view: MeetingsView) {
  const stem = bareTitle(m.title);
  const same = view.meetings.filter((x) => x.path !== m.path && !x.series && bareTitle(x.title).toLowerCase() === stem.toLowerCase()).length;
  openRecordForm({
    title: 'Make it a series',
    icon: 'history',
    line: `${m.title} carries its people, project, time and place to each next one.${same ? ` ${same} other ${same === 1 ? 'meeting' : 'meetings'} called “${stem}” join it too.` : ''}`,
    ok: 'Make the series',
    fields: [
      { key: 'name', label: 'Its name', kind: 'text', required: true, wide: true, value: stem },
      { key: 'cadence', label: 'How often', kind: 'segment', options: [...SERIES_CADENCES] },
    ],
    submit: async (v) => {
      await workDid(call<string>('make-series', m.path, { name: valueWords(v, 'name'), cadence: valueWords(v, 'cadence') }));
    },
  });
}

// ── Bringing in a transcript ─────────────────────────────────────────────────────────────────────────────────────────

let transcriptFor: Meet | null = null;
const tListeners = new Set<() => void>();
const openTranscript = (m: Meet) => {
  transcriptFor = m;
  tListeners.forEach((fn) => fn());
};
function TranscriptHost() {
  const [, setN] = useState(0);
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const fn = () => (setN((n) => n + 1), setText(''), setFrom(''));
    tListeners.add(fn);
    return () => void tListeners.delete(fn);
  }, []);
  const close = () => {
    transcriptFor = null;
    setN((n) => n + 1);
  };
  if (!transcriptFor) return null;
  return <TranscriptDialog m={transcriptFor} text={text} setText={setText} from={from} setFrom={setFrom} busy={busy} setBusy={setBusy} close={close} />;
}
/** Only an open dialog listens for Escape (a closed one must never take it from another). */
function TranscriptDialog({ m, text, setText, from, setFrom, busy, setBusy, close }: { m: Meet; text: string; setText(t: string): void; from: string; setFrom(f: string): void; busy: boolean; setBusy(b: boolean): void; close(): void }) {
  useEscape(() => !busy && close());
  const lines = text.split(/\n/).filter((l) => l.trim()).length;
  return createPortal(
    <div className="overlay rf-overlay" onMouseDown={() => !busy && close()}>
      <div className="dialog rf-dialog wmt-tdialog" role="dialog" aria-modal="true" aria-labelledby="wmt-t-title" onMouseDown={(e) => e.stopPropagation()}>
        <header className="rf-head">
          <span className="rf-mark" aria-hidden="true">
            <Icon name="quote" size={18} />
          </span>
          <div>
            <h2 id="wmt-t-title">Bring in a transcript</h2>
            <p className="rf-line">For {m.title}. Paste it or choose its file (Teams or Zoom VTT, SRT, a Word or text file). The assistant writes the summary, decisions and tasks; the transcript is folded at the end of the note.</p>
          </div>
        </header>
        <textarea className="wmt-tarea" value={text} placeholder={'Paste the transcript here.\n\nSam Lee: Morning all, let us start with the delivery.\nPriya Shah: The racks land on Thursday…'} onChange={(e) => (setText(e.target.value), setFrom(''))} disabled={busy} aria-label="The transcript" />
        <div className="wmt-trow">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={async () => {
              try {
                const f = await call<{ name: string; text: string } | null>('pick-transcript');
                if (f) {
                  setText(f.text);
                  setFrom(f.name);
                }
              } catch (err) {
                showError(new Error(plainWords(err)));
              }
            }}
          >
            <Icon name="upload" size={13} /> Choose a file…
          </button>
          <span className="wu-faint">{from ? `${from} · ` : ''}{lines ? `${lines} ${lines === 1 ? 'line' : 'lines'}` : ''}</span>
        </div>
        {busy && <p className="rf-hint wmt-busy">Writing it up… a long meeting can take a minute.</p>}
        <div className="dialog-actions rf-actions">
          <button type="button" className="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || !text.trim()}
            onClick={async () => {
              setBusy(true);
              const r = await workDid(call<{ words: string }>('transcript', m.path, text, from), (x) => x.words);
              setBusy(false);
              if (r) close();
            }}
          >
            {busy ? 'Writing it up…' : 'Bring it in'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── The tour, when asked (round 2: the red link under the title is gone; the tour stays under the page menu
// and in the palette. Round 4 join with main: one "Show me around" mechanism, the pack's mounted tour through
// openTour (the page's own asker and dialog are gone; this name stays as its opener)). ──────────────────────
export const askMeetingsTour = () => openTour('meetings');

// ── The prep pack ────────────────────────────────────────────────────────────────────────────────────────────────────

function PrepItemRow({ x, m }: { x: PrepItem; m: Meet }) {
  const canEdit = useApp((s) => s.canEdit);
  const me = useMe();
  const sub = [who(x.who, me), x.due ? `${x.overdue ? 'overdue, was due' : 'due'} ${dayText(x.due)}` : ''].filter(Boolean).join(' · ');
  return (
    <div className="srcrow w2b-src">
      <button type="button" className="w2b-link w2b-src-main" onClick={() => peek({ path: x.path }, { title: x.from, type: 'note' })} title={`From ${x.from}`}>
        <span className="gtile xs slate" aria-hidden="true"><Icon name="notes" size={12} /></span>
        <span className="clip">{x.what}</span>
        <span className="n clip">{[sub, x.from].filter(Boolean).join(' · ')}</span>
      </button>
      {canEdit && (
        <button type="button" className="btn quiet w2b-mini" title="Add to this meeting's agenda" onClick={() => void workDid(call('add-item', m.path, 'agenda', x.what), 'Added to the agenda.')}>
          <Icon name="plus" size={11} /> Agenda
        </button>
      )}
    </div>
  );
}

function PrepPackCard({ m }: { m: Meet }) {
  const { data, error } = useWork<PrepPack>('meetings', 'prep', [m.path]);
  const { includeActions } = useMeetingSettings();
  const [allOpen, setAllOpen] = useState(false);
  if (error) return <p className="w2b-failed">{error}</p>;
  if (!data) return <div className="view-loading" />;
  // Without open actions, each person's open actions stay out of the pack (Meetings settings): the card reads and
  // counts the pack without them, so the sentences, sources and groups all agree.
  const leftOut = includeActions ? 0 : data.people.reduce((s, x) => s + x.theirs.length, 0);
  const p: PrepPack = includeActions ? data : { ...data, people: data.people.map((x) => ({ ...x, theirs: [] })), count: data.count - leftOut };
  const groups: { head: ReactNode; items: PrepItem[] }[] = [];
  if (p.last && (p.last.open.length > 0 || p.last.notReached.length > 0)) {
    groups.push({
      head: <>Last time <button type="button" className="w2b-link" onClick={() => openMeeting(p.last!.path)}>{dayText(p.last.date)}</button></>,
      items: [...p.last.open, ...p.last.notReached.map((t): PrepItem => ({ what: t, path: p.last!.path, from: 'not reached last time' }))],
    });
  }
  for (const x of p.people.filter((x) => x.theirs.length)) groups.push({ head: <>{x.name}{x.lastMet && <span className="w2b-faint"> · last met {dayText(x.lastMet.date)}</span>}</>, items: x.theirs });
  if (p.project && p.project.items.length > 0) groups.push({ head: <>{p.project.name} needs attention</>, items: p.project.items });
  if (p.earlier.length > 0) groups.push({ head: <>From earlier meetings with the same people</>, items: p.earlier });
  if (p.linked.length > 0) groups.push({ head: <>Linked notes</>, items: p.linked });
  if (p.recent.length > 0) groups.push({ head: <>Recent on the project</>, items: p.recent });
  const ans = prepAnswer(p);
  return (
    <section aria-label="Prep, from your notes">
      <div className="glabel w2b-group">Prep, from your notes</div>
      <div className="aians w2b-prep">
        {!p.count ? (
          <p>Nothing open with the people coming, from the last meeting, on the project or in linked notes. A clear run.</p>
        ) : (
          <>
            {/* One short block a person: their name, then each thing on its own line with its source number
                (6 Nov 2026, o3-meeting-page item 3: one joined-up paragraph of bold was unreadable). */}
            <div className="w2b-prep-blocks">
              {ans.sentences.map((s, i) => (
                <div key={i} className="w2b-prep-person">
                  <div className="w2b-prep-lead">{s.lead}</div>
                  {s.whats.map((w, j) => (
                    <div key={`${w.what}-${j}`} className="w2b-prep-line">
                      <span>{w.what}</span> <i className="cite">{w.cite}</i>
                    </div>
                  ))}
                  {s.more ? <div className="w2b-prep-more">and {s.more} more</div> : null}
                </div>
              ))}
            </div>
            <div className="glabel" style={{ margin: '12px 0 4px' }}>Sources · {ans.sources.length}</div>
            {ans.sources.map((src) => (
              <div key={src.path} className="srcrow">
                <button type="button" className="w2b-link w2b-src-main" onClick={() => peek({ path: src.path }, { title: src.title, type: 'note' })} title={`From ${src.title}`}>
                  <span className="gtile xs slate" aria-hidden="true"><Icon name="notes" size={12} /></span>
                  <span className="clip">{src.title}</span>
                </button>
              </div>
            ))}
            <div className="w2b-prep-btns">
              <button type="button" className="button small" aria-expanded={allOpen} onClick={() => setAllOpen((v) => !v)}>
                <Icon name={allOpen ? 'chevronDown' : 'chevron'} size={11} /> {allOpen ? 'Hide' : 'Show'} all {p.count} open items
              </button>
            </div>
            {allOpen && groups.map((g, i) => (
              <div key={i} className="w2b-prep-group">
                <div className="glabel">{g.head}</div>
                {g.items.map((x) => (
                  <PrepItemRow key={x.what} x={x} m={m} />
                ))}
              </div>
            ))}
          </>
        )}
        {p.people.length > 0 && p.people.every((x) => !x.theirs.length) && p.count > 0 && <p className="vsub">Nothing is open with {p.people.map((x) => x.name.split(' ')[0]).join(', ')} themselves.</p>}
        <div className="w2b-prep-btns">
          <button type="button" className="button small" onClick={() => void workDid(call<string>('prep-sheet', m.path), 'Prep sheet saved in its note.')}>
            <Icon name="sparkle" size={11} /> Make prep sheet
          </button>
          <button
            type="button"
            className="button small"
            onClick={() =>
              void call<{ subject: string; text: string }>('follow-up', m.path).then(async (draft) => {
                if (!draft) return;
                // Copied said only when it copied (9.2 uplift F115): a failed write says that instead.
                const copied = (await navigator.clipboard?.writeText(`Subject: ${draft.subject}\n\n${draft.text}`).then(
                  () => true,
                  () => false,
                )) ?? false;
                toast(copied ? 'Follow-up draft copied. Nothing has been sent.' : 'The draft wouldn’t copy. Try again.');
              })
            }
          >
            <Icon name="chat" size={11} /> Draft follow-up
          </button>
        </div>
      </div>
    </section>
  );
}

// ── A meeting's agenda (its decisions live in the note beside its tasks, t248) ─────────────────────────────────────────

function ItemList({ m, kind, items, canEdit, title, empty, placeholder }: { m: Meet; kind: 'agenda'; items: { text: string; done: boolean; line: number; raw: string }[]; canEdit: boolean; title: string; empty: string; placeholder: string }) {
  const [adding, setAdding] = useState('');
  const add = async () => {
    const t = adding.trim();
    if (!t) return;
    setAdding('');
    await workDid(call('add-item', m.path, kind, t));
  };
  return (
    <section aria-label={title}>
      <div className="glabel w2b-group">{title} · {items.length}</div>
      {items.length ? (
        <ol className="w2b-agenda">
          {items.map((x) => (
            <li key={`${x.line}:${x.text}`} className={x.done ? 'is-done' : ''}>
              {/* Covered sits at the left, before the words, in line with the number, the same place as the
                  live notes card (6 Nov 2026, o3-meeting-page item 4). */}
              <button type="button" className={`check${x.done ? ' done' : ''}`} role="checkbox" aria-checked={x.done} disabled={!canEdit} title={x.done ? 'Covered' : 'Mark it covered'} onClick={() => void workDid(call('tick', m.path, x.line, x.raw, !x.done))}>
                {x.done ? '✓' : null}
              </button>
              <span className="w2b-agenda-text">{x.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="vsub">{empty}</p>
      )}
      {canEdit && (
        <div className="w2b-add">
          <Icon name="plus" size={12} />
          <input value={adding} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void add())} onBlur={() => void add()} />
        </div>
      )}
    </section>
  );
}


function Attendees({ m, view, canEdit }: { m: Meet; view: MeetingsView; canEdit: boolean }) {
  const [adding, setAdding] = useState('');
  const save = (list: string[]) => workDid(call('set-prop', m.path, 'people', list));
  const add = async () => {
    const t = adding.trim();
    if (!t) return;
    setAdding('');
    if (m.people.some((p) => p.toLowerCase() === t.toLowerCase())) return;
    await save([...m.people, t]);
  };
  // Round 2, one row of pills: no wrapper, so the people sit in the facts row itself with the day, place and project.
  return (
    <>
      {m.people.map((p) => (
        <Person key={p} name={p} people={view.people} onRemove={canEdit ? () => void save(m.people.filter((x) => x !== p)) : undefined} />
      ))}
      {canEdit && (
        <span className="w2b-addperson">
          <Icon name="plus" size={11} />
          <input list="wmt-people" value={adding} placeholder={m.people.length ? 'Add someone' : 'Who is coming'} aria-label="Add an attendee" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void add())} onBlur={() => void add()} />
          <datalist id="wmt-people">
            {view.people.filter((p) => !m.people.includes(p)).map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </span>
      )}
    </>
  );
}

// ── One meeting's page, in three states ──────────────────────────────────────────────────────────────────────────────

function LiveMeeting({ m, canEdit }: { m: Meet; canEdit: boolean }) {
  const v = useRecorder();
  const elapsed = useElapsed(v.live);
  const job = jobFor(v, m.path);
  const lines = job ? mergeTranscript(job.pieces) : [];
  // The voices named here too (6 Nov 2026: naming lived only in the note view, so during a recording on this
  // page there was no way to say who Speaker 1 and 2 are): the same card as the note's live card, the same job.
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
    if (playingId === id) return setPlayingId(null);
    const n = speakerNum(id);
    const clip = n === null ? null : liveClip(job.id, n - 1);
    if (!clip) return;
    const url = URL.createObjectURL(new Blob([clip.slice().buffer as ArrayBuffer], { type: 'audio/wav' }));
    const a = new Audio(url);
    clipAudio.current = a;
    setPlayingId(id);
    a.onended = () => { setPlayingId(null); URL.revokeObjectURL(url); };
    void a.play().catch(() => setPlayingId(null));
    window.setTimeout(() => { if (clipAudio.current === a) { a.pause(); setPlayingId(null); } }, 6000);
  };
  const me = useMe();
  const tail = lines.slice(-8).map((l) => ({ ...l, who: shownWho(l.who, names, me ?? undefined) }));
  const paused = v.live.phase === 'paused';
  const heard = job ? job.pieces.filter((p) => p.status === 'done' || p.status === 'quiet').reduce((s, p) => s + p.seconds, 0) : 0;
  return (
    <>
      <div className="recbanner" role="status">
        <span className="recdot" aria-hidden="true" />
        <span>{paused ? 'Paused' : 'Recording'}</span>
        <span className="time">{clockWords(elapsed)}</span>
        <span className="w2b-recsub">{[v.live.micName.replace(/^Default - /, ''), v.live.sources === 'mic' ? '' : 'PC sound on'].filter(Boolean).join(' · ')}</span>
        <span className="w2b-recbtns">
          <button type="button" className="rbtn" onClick={paused ? resumeRecording : pauseRecording}>{paused ? 'Resume' : 'Pause'}</button>
          <button type="button" className="rbtn w2b-stop" onClick={() => void stopRecording().catch(showError)}>Stop</button>
        </span>
      </div>
      {v.live.warning && (
        <p className="w2b-warn" role="alert">
          <Icon name="warning" size={13} />
          {v.live.warning === 'mic-gone' ? 'Your microphone was unplugged. Plug it back in, or choose another in the note.' : 'Your microphone is not picking anything up. Check it is not muted, or choose another in the note.'}
        </p>
      )}
      <div className="w2b-livecols">
        <div className="w2b-livecol">
          <div className="glabel w2b-group">Live transcript</div>
          <div className="tscript" aria-live="polite">
            {tail.length ? (
              tail.map((l, i) => (
                <div key={`${l.at}-${i}`} className={`tline${i === tail.length - 1 ? ' live' : ''}`}>
                  {l.who ? <span className="who">{l.who}</span> : null}
                  <span>{l.text}</span>
                  <span className="at">{i === tail.length - 1 ? 'live' : clockWords(l.at * 1000)}</span>
                </div>
              ))
            ) : (
              <div className="tline"><span>The transcript appears here as the meeting goes on.</span></div>
            )}
          </div>
          <p className="vsub w2b-keys">The transcript keeps itself. Stop the recording and it files with this note.{heard > 0 ? ` ${Math.round(heard / 60)} min written down so far.` : ''}</p>
          {job && (
            <SpeakerNames
              marks={marks}
              names={names}
              suggestions={suggestions}
              canEdit={canEdit}
              playingId={playingId}
              onPlay={playClip}
              onName={(voice, name) => { const refused = setJobSpeakerName(job.id, voice, name); setSaid(refused); return refused; }}
              onClear={(voice) => { clearJobSpeakerName(job.id, voice); setSaid(''); }}
              onMerge={(from, to) => { const words = mergeJobVoices(job.id, from, to); setSaid(words); return words; }}
              undoable={jobSpeakerUndoable(job.id)}
              onUndo={() => { undoJobSpeakers(job.id); setSaid(''); }}
              notice={job.speakerView?.notice}
              said={said}
            />
          )}
        </div>
        <div className="w2b-livecol">
          <div className="glabel w2b-group">Notes, take them as you go</div>
          <div className="card w2b-card">
            {m.agenda.length ? (
              m.agenda.map((x) => (
                <div key={`${x.line}:${x.text}`} className="trow">
                  <button type="button" className={`check${x.done ? ' done' : ''}`} role="checkbox" aria-checked={x.done} disabled={!canEdit} title={x.done ? 'Covered' : 'Mark it covered'} onClick={() => void workDid(call('tick', m.path, x.line, x.raw, !x.done))}>
                    {x.done ? '✓' : null}
                  </button>
                  <span className="t clip" title={x.text}>{x.text}</span>
                </div>
              ))
            ) : (
              <p className="vsub">No agenda. Add one below, or write in the note.</p>
            )}
            <div className="w2b-prep-btns">
              <button type="button" className="button small" onClick={() => A.openPath(m.path, { where: 'tab' })}>
                <Icon name="notes" size={12} /> Open the note to write
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* Minutes ready to send (views/MeetingMinutes.tsx): the one card, beneath the recording as in the note. */}
      <MeetingMinutesHere path={m.path} canEdit={canEdit} />
      <MeetingNoteCard m={m} />
    </>
  );
}

function BeforeRecordingCard({ m, canEdit }: { m: Meet; canEdit: boolean }) {
  // The record set-up as one row (round 2, the mock): dot, Record meeting, what it hears, the mic picker and
  // Record. Wired to the real recorder throughout; when nothing is set up to write it down yet, the card says so
  // first (as the note's own card does) and records anyway on the second press.
  const v = useRecorder();
  const mics = useMics();
  const prefs = usePrefs();
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  useEffect(() => {
    let live = true;
    window.nv.recorder.status().then((s) => live && setStatus(s), () => undefined);
    return () => {
      live = false;
    };
  }, []);
  const other = isBusy(v.live) && v.live.note !== m.path;
  const t = status?.transcriber;
  const chosen = mics.find((x) => x.id === prefs.meetingMic) ?? mics[0];
  const micLabel = (chosen?.label ?? '').replace(/^Default - /, '') || 'Windows default';
  const pcOn = prefs.meetingSystemAudio && status?.systemAudio;
  if (other) {
    return (
      <div className="card w2b-reccard">
        <span className="recdot" aria-hidden="true" />
        <div className="w2b-recmain">
          <div style={{ fontWeight: 600 }}>Record meeting</div>
          <div className="meta">
            Recording <button type="button" className="w2b-link" onClick={() => v.live.note && A.openPath(v.live.note, { where: 'current' })}>{A.displayName(v.live.note ?? '')}</button> now: stop it there first.
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="card w2b-reccard">
        <span className="recdot" aria-hidden="true" />
        <div className="w2b-recmain">
          <div style={{ fontWeight: 600 }}>Record meeting</div>
          <div className="meta">{pcOn ? `${micLabel} · PC sound on for calls` : micLabel}</div>
        </div>
        <span className="w2b-reccontrols">
          <MicPicker compact always />
          <button type="button" className="btn pri" disabled={!canEdit} onClick={() => (t && !t.ready && !showSetup ? setShowSetup(true) : void startRecording(m.path))} title="Record this meeting">
            Record
          </button>
        </span>
      </div>
      {showSetup && t && !t.ready && (
        <p className="vsub w2b-setup">
          {t.words ?? 'Nothing is set up to write recordings down yet.'} You can still record: the recording is kept in the note.{' '}
          <button type="button" className="button small" disabled={!canEdit} onClick={() => void startRecording(m.path)}>
            Record anyway
          </button>
        </p>
      )}
    </>
  );
}

function BeforeMeeting({ m, view, canEdit }: { m: Meet; view: MeetingsView; canEdit: boolean }) {
  // Before the meeting (round 2, the reviewer holding the mock beside the app): the agenda, the record set-up,
  // the minutes card, then the prep answer with its sources. Decisions and actions belong to during and after,
  // so they are not shown here; they are one click away in the note, and appear here once the meeting is on or
  // past. Prep reads last in the order (t300 round 2, 18 Nov 2026: "stack in this order: agenda,
  // Recording, minutes, then prep", and "it never pushes Record off the first screen"): below 1600px the page
  // stacks in this order, and at wide windows the grid lifts prep to the side while this order keeps Record
  // near the top of the main column.
  return (
    <>
      <ItemList m={m} kind="agenda" items={m.agenda} canEdit={canEdit} title="Agenda" empty="No agenda yet." placeholder="Add an agenda item" />
      <section aria-label="Recording">
        <div className="glabel w2b-group">Recording</div>
        <BeforeRecordingCard m={m} canEdit={canEdit} />
      </section>
      {/* Minutes ready to send (views/MeetingMinutes.tsx): the one card, beneath the recording as in the note. */}
      <MeetingMinutesHere path={m.path} canEdit={canEdit} />
      {view.prepOn && <PrepPackCard m={m} />}
    </>
  );
}

function AfterMeeting({ m, canEdit }: { m: Meet; canEdit: boolean }) {
  const v = useRecorder();
  const parts = useMeetingParts(m.path);
  // The summary in the voices' names, as every other door shows it (6 Nov 2026).
  const noteText = useNoteText(m.path);
  const summary = m.summary ? relabelSpeakerMentions(m.summary, allSpeakerNames(noteText)) : m.summary;
  const job = jobFor(v, m.path);
  const hasRec = parts.length > 0 || !!job || (v.live.note === m.path && isBusy(v.live));
  // The minutes card already reads the summary once minutes are made; the summary below is for a note whose
  // summary was written by hand (20 Nov 2026: the same paragraph twice, one under the other).
  const minutesMade = /(^|\n)##\s+(open|discussion)\b/i.test(noteText ?? '');
  // After the meeting at a wide window (20 Nov 2026, on a ~2000 px monitor a 470 px column hard left with 1,200 px
  // blank beside it, and Record again stretched across the page): the minutes and the summary read in the main
  // column, the recording, its transcript and the note's tasks in the side column beside them (styles/w2b.css
  // .w2b-after). Narrow, the side stacks under the main, in this order. Round 3 (20 Nov 2026, at 3440x1400: the
  // minutes card 1,500 px wide with a 400 px paragraph in it, the recording far right, a huge empty middle): the
  // meeting fills the window in regions that scroll inside themselves. The minutes at the left at a reading
  // measure, the recording and its transcript (open, full height) beside them, and from about a 2560 window a
  // far-right region for the words to check, the meeting note's counts and what the meeting connects to (people,
  // project, files). Narrow (below about 1600), one column that scrolls. The note's other sections (its agenda,
  // notes, key figures, questions, discussion) read under the minutes, so the minutes region holds the whole
  // record; what the minutes card and the transcript already show stays out.
  const rest = useMemo(() => restOfMeeting(noteText ?? '', minutesMade || !!summary), [noteText, minutesMade, summary]);
  const [measure, width] = useWidth();
  const wide = width >= 1180;
  const three = width >= 2100;
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div ref={measure} className={`w2b-after mt-regions${wide ? ' nv-panes-root' : ''}${three ? ' is-three' : ''}`} data-regions={!wide ? 1 : three ? 3 : 2}>
      <ContextPaneProvider value={three ? slot : null}>
        <div className="w2b-after-main mt-minutes">
          {/* Minutes ready to send (views/MeetingMinutes.tsx): the one card. */}
          <MeetingMinutesHere path={m.path} canEdit={canEdit} />
          {summary && !minutesMade && (
            <section aria-label="Summary" className="mt-summary">
              <div className="glabel w2b-group">Summary</div>
              {summaryParas(stripNoteLinks(summary)).map((para, i) => (
                <p key={i} className="w2b-summary">
                  {para}
                </p>
              ))}
            </section>
          )}
          {rest && (
            <section className="mt-rest" aria-label="The rest of the meeting note">
              <div className="glabel w2b-group">From the meeting note</div>
              <ReadingView className="mt-rest-read" text={rest} path={m.path} interactive={false} onOpenLink={(target, newTab) => void A.openLink(target, m.path, newTab ? 'tab' : 'current')} onOpenTag={(tag) => requestSearch(`tag:#${tag}`)} />
            </section>
          )}
          {!three && <MeetingNoteCard m={m} />}
          {!three && (
            <section className="mt-links" aria-label="What the meeting connects to">
              <RecordConnections refTo={{ path: m.path, type: 'meeting' }} />
            </section>
          )}
        </div>
      </ContextPaneProvider>
      <aside className="w2b-after-side mt-record" aria-label="Recording and the meeting note">
        <TranscriptOpen.Provider value={true}>
          {/* No recording: a section, not a div (t254, 13 Nov 2026), with its one way in. */}
          {hasRec ? (
            <MeetingRecorder path={m.path} canEdit={canEdit} />
          ) : (
            <section className="card w2b-card w2b-norec" aria-label="Recording">
              <span className="vsub">No recording for this meeting.</span>
              <button type="button" className="button small" disabled={!canEdit} onClick={() => openTranscript(m)}>
                <Icon name="quote" size={12} /> Bring in a transcript
              </button>
            </section>
          )}
        </TranscriptOpen.Provider>
      </aside>
      {three && (
        <aside className="mt-context" aria-label="Words to check, the meeting note and what it connects to">
          <div ref={setSlot} className="mt-words-slot" />
          <MeetingNoteCard m={m} />
          <section className="mt-links" aria-label="What the meeting connects to">
            <RecordConnections refTo={{ path: m.path, type: 'meeting' }} />
          </section>
        </aside>
      )}
    </div>
  );
}

/** A meeting note's sections other than the ones the page shows already (summary, decisions, actions, the
 *  transcript), for the minutes region. Empty when nothing else is written. */
function restOfMeeting(text: string, summaryShown: boolean): string {
  const body = readingBody(text, '');
  const shown = summaryShown ? /^(summary|decisions|actions|transcript)$/i : /^(decisions|actions|transcript)$/i;
  const out: string[] = [];
  let skip = false;
  for (const line of body.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) skip = shown.test(h[1].trim());
    else if (/^#\s/.test(line)) skip = false;
    if (!skip) out.push(line);
  }
  const words = out.join('\n').trim();
  return /[A-Za-z0-9]/.test(words.replace(/^#+.*$/gm, '')) ? words : '';
}

/** A note's links read as their words ("Harbour", never "[[Harbour Stores|Harbour]]"). */
const stripNoteLinks = (s: string): string => s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');

/** A long summary in short paragraphs (t273): the note's own breaks kept; a long unbroken stretch splits by
 *  sentence, two to a paragraph, through the speakers' shared splitter. */
const summaryParas = (s: string): string[] => {
  const out: string[] = [];
  for (const chunk of s.split(/\n\s*\n/)) {
    const t = chunk.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (t.length <= 320) {
      out.push(t);
      continue;
    }
    const sentences = splitSentences(t);
    if (sentences.length < 2) {
      out.push(t);
      continue;
    }
    for (let i = 0; i < sentences.length; i += 2) out.push(sentences.slice(i, i + 2).join(' '));
  }
  return out.length ? out : [s];
};

/** The meeting itself lives in its note (t248, 12 Nov 2026: the note page is the meeting; this room is
 *  the record around it, the recording, the transcript and the prep). Its tasks, decisions and questions
 *  are read and worked in the note, so this card counts them and opens it. Plain counts in the shared count
 *  words (t273: "11 tasks, 5 open · 9 decisions"), a quiet zero left out. */
function MeetingNoteCard({ m }: { m: Meet }) {
  const open = m.actions.filter((a) => !isDone(a)).length;
  const questionsOpen = m.questions.filter((q) => !q.answered).length;
  const bits: string[] = [];
  if (m.actions.length) bits.push(`${countWords(m.actions.length, 'task')}${open > 0 && open < m.actions.length ? `, ${open} open` : open === 0 ? ', all done' : ''}`);
  if (m.decisions.length) bits.push(countWords(m.decisions.length, 'decision'));
  if (m.questions.length) bits.push(`${countWords(m.questions.length, 'question')}${questionsOpen > 0 && questionsOpen < m.questions.length ? `, ${questionsOpen} still open` : questionsOpen === 0 ? ', all answered' : ''}`);
  return (
    <section aria-label="Tasks, decisions and questions">
      <div className="glabel w2b-group">In the meeting note</div>
      <div className="card w2b-card">
        <div className="trow">
          <span className="gtile xs slate" aria-hidden="true"><Icon name="notes" size={13} /></span>
          <span className="t" style={{ minWidth: 0 }}>{bits.join(' · ') || 'No tasks, decisions or questions yet'}</span>
          <button type="button" className="button primary" style={{ marginLeft: 'auto', flex: 'none' }} onClick={(e) => A.openPath(m.path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })} title="Open the meeting note (its tasks, decisions and questions)">
            Open the meeting note
          </button>
        </div>
        <p className="vsub">Ask, decide and tick in the note, with what was said.</p>
      </div>
    </section>
  );
}

function MeetingPage({ m, view, canEdit, onMore }: { m: Meet; view: MeetingsView; canEdit: boolean; onMore(el: HTMLElement): void }) {
  const modules = useModules();
  const v = useRecorder();
  const parts = useMeetingParts(m.path);
  const live = v.live.note === m.path && isBusy(v.live);
  const phase = meetingPhase(m, view.today);
  const series = view.series.find((s) => s.name.toLowerCase() === m.series.toLowerCase());
  const project = view.projects.find((p) => p.name.toLowerCase() === m.project.toLowerCase());
  const setProp = (key: string, value: string) => workDid(call('set-prop', m.path, key, value)).then((r) => r !== null);
  return (
    <Editable path={m.path}>
      <div className="w2b-meeting">
        <div className="w2b-title">
          <span className="gtile slate" aria-hidden="true"><Icon name="calendar" size={18} /></span>
          <h1 className="vtitle w2b-title-words">{bareTitle(m.title)}</h1>
          {live && <span className="pill coral">Recording</span>}
          <span className="w2b-titleacts">
            <ShareButton path={m.path} />
            <button type="button" className="iconbtn" aria-label="More for this meeting" title="More" onClick={(e) => onMore(e.currentTarget)}>
              <Icon name="more" size={15} />
            </button>
          </span>
        </div>
        <div className="metapills">
          {(m.dated || canEdit) && (
            <span className="pill outline" title="Day and time (click either to change)">
              <Inline value={m.date} label="Day" compact required onSave={(val) => setProp('date', val)}>{m.dated ? meetingDayLabel(m.date, view.today) : 'Add a day'}</Inline>
              {(m.time || canEdit) && (
                <>
                  <span aria-hidden="true"> · </span>
                  <Inline value={m.time} label="Time" compact placeholder="Add a time" onSave={(val) => setProp('time', val)}>{meetingTimeWords(m.time) || 'Add a time'}</Inline>
                </>
              )}
            </span>
          )}
          <Attendees m={m} view={view} canEdit={canEdit} />
          {m.where || canEdit ? (
            <span className="pill outline" title="Where (click to change)">
              <Inline value={m.where} label="Where" compact placeholder="Add a place" onSave={(val) => setProp('where', val)}>{m.where || 'Add a place'}</Inline>
            </span>
          ) : null}
          {project ? (
            <button type="button" className="pill outline" onClick={() => peek({ path: project.path }, { title: project.name, type: 'project' })} title={`Open ${project.name}`}>
              <Icon name="layers" size={12} /> {project.name}
            </button>
          ) : m.project ? (
            <span className="pill outline">{m.project} (not found)</span>
          ) : canEdit ? (
            <button type="button" className="pill outline w2b-quiet" aria-label="Link a project" title="Link a project" onClick={(e) => openMenu(e.currentTarget, view.projects.slice(0, 40).map((p) => ({ label: p.name, icon: 'layers' as IconName, run: () => void setProp('project', p.name) })))}>
              <Icon name="plus" size={12} /> Link a project
            </button>
          ) : null}
          {partOn(modules, 'meetings', 'series') && series && (
            <button type="button" className="pill outline" onClick={() => openSeries(series.path)} title="Open its series">
              <Icon name="history" size={12} /> {series.name}
            </button>
          )}
                    {parts.length > 0 && <span className="pill slate">recording filed</span>}
        </div>
        {live ? <LiveMeeting m={m} canEdit={canEdit} /> : phase === 'before' ? <BeforeMeeting m={m} view={view} canEdit={canEdit} /> : <AfterMeeting m={m} canEdit={canEdit} />}
      </div>
    </Editable>
  );
}

// ── A series' page ───────────────────────────────────────────────────────────────────────────────────────────────────

function SeriesPage({ s, view, canEdit, onMore }: { s: SeriesRec; view: MeetingsView; canEdit: boolean; onMore(el: HTMLElement): void }) {
  const meetings = view.meetings.filter((m) => s.meetings.includes(m.path)).sort((a, z) => z.date.localeCompare(a.date));
  const set = (key: string, value: string) => workDid(call('set-field', { kind: 'series', path: s.path, field: key, value })).then((r) => r !== null);
  const project = s.project ? view.projects.find((p) => p.name.toLowerCase() === s.project.toLowerCase()) : undefined;
  return (
    <Editable path={s.path}>
      <div className="w2b-meeting">
        <div className="w2b-title">
          <span className="gtile blue" aria-hidden="true"><Icon name="history" size={18} /></span>
          <h1 className="vtitle w2b-title-words">{s.name}</h1>
          <span className="w2b-titleacts">
            {canEdit && (
              <button type="button" className="button primary small" onClick={() => void workDid(call<string>('next-in-series', s.path), 'The next meeting is ready, with what was left open last time.').then((rel) => rel && openMeeting(rel))}>
                <Icon name="plus" size={12} /> Next meeting
              </button>
            )}
            <ShareButton path={s.path} />
            <button type="button" className="iconbtn" aria-label="More for this series" title="More" onClick={(e) => onMore(e.currentTarget)}>
              <Icon name="more" size={15} />
            </button>
          </span>
        </div>
        <div className="metapills">
          <button type="button" className="pill outline" disabled={!canEdit} onClick={(e) => openMenu(e.currentTarget, SERIES_CADENCES.map((c) => ({ label: c, icon: (c === s.cadence ? 'check' : 'history') as IconName, run: () => void set('cadence', c) })))}>
            {s.cadence} <Icon name="chevron" size={10} />
          </button>
          <button type="button" className="pill outline" disabled={!canEdit} onClick={(e) => openMenu(e.currentTarget, WEEKDAYS.map((d, i) => ({ label: d, icon: (i === s.day ? 'check' : 'calendar') as IconName, run: () => void set('weekday', d) })))}>
            {s.day >= 0 ? WEEKDAYS[s.day] : 'Any day'} <Icon name="chevron" size={10} />
          </button>
          <span className="pill outline" title="Time (click to change)">
            <Inline value={s.time} label="Time" compact placeholder="Add a time" onSave={(val) => set('time', val)}>{meetingTimeWords(s.time) || 'Add a time'}</Inline>
          </span>
          <span className="pill slate">Next {s.next ? `${dayText(s.next)} (${inDays(s.next, view.today)})` : 'when it is called'}</span>
          {project ? (
            <button type="button" className="pill outline" onClick={() => peek({ path: project.path }, { title: project.name, type: 'project' })} title={`Open ${project.name}`}>
              <Icon name="layers" size={12} /> {project.name}
            </button>
          ) : s.project ? (
            <span className="pill outline">{s.project} (not found)</span>
          ) : null}
          {s.attendees.map((p) => (
            <Person key={p} name={p} people={view.people} />
          ))}
        </div>
        <section aria-label="Standing agenda">
          <div className="glabel w2b-group">Standing agenda · {s.standing.length}</div>
          {s.standing.length ? (
            <div className="card w2b-card">
              {s.standing.map((t) => (
                <div key={t} className="trow">
                  <span className="gtile xs slate" aria-hidden="true"><Icon name="list" size={12} /></span>
                  <span className="t">{t}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="vsub">Items every meeting starts with go here. Change them in the note.</p>
          )}
        </section>
        <section aria-label="Its meetings">
          <div className="glabel w2b-group">Its meetings · {meetings.length}</div>
          {meetings.length ? (
            <div className="card w2b-card">
              {meetings.map((m) => (
                <MeetingRow key={m.path} m={m} today={view.today} upcoming={m.dated && m.date >= view.today} />
              ))}
            </div>
          ) : (
            <p className="vsub">No meetings in it yet.</p>
          )}
        </section>
      </div>
    </Editable>
  );
}

// ── The home: stats, chips, the list ─────────────────────────────────────────────────────────────────────────────────

type Chip = 'upcoming' | 'past' | 'series' | 'actions' | 'decisions' | 'questions' | 'all';
// The tab section carries chip ids now (t262 chip history), so every chip id reads back; anything else
// (overview, calendar, a detail) lands on Upcoming, as before.
const chipFor = (section: string): Chip => ((['upcoming', 'past', 'series', 'actions', 'decisions', 'questions', 'all'] as string[]).includes(section) ? (section as Chip) : 'upcoming');

function MeetingRow({ m, today, upcoming }: { m: Meet; today: string; upcoming: boolean }) {
  // One open per row (9.2 uplift F117): a click opens here, Ctrl-click in a tab. No double-click opener: two
  // handlers opened the meeting twice, here and in a tab.
  // Guests in words (3 Nov 2026, audit f F13: two names plus "..." cut the rest); status in neutral with coral
  // for attention (F18), never amber.
  const counts = meetingActionCounts(m, isDone);
  const guests = m.people.length <= 2 ? m.people.join(', ') : `${m.people.slice(0, 2).join(', ')} and ${m.people.length - 2} other${m.people.length - 2 === 1 ? '' : 's'}`;
  const meta = [m.dated ? meetingDayLabel(m.date, today) : 'No day set', meetingTimeWords(m.time), m.where, m.people.length ? `with ${guests}` : ''].filter(Boolean).join(' · ');
  return (
    <button type="button" className="trow w2b-row" data-pick={m.path} onClick={(e) => openMeeting(m.path, e.ctrlKey || e.metaKey ? 'tab' : 'current')} title={`${bareTitle(m.title)} (open the meeting)`}>
      <span className="gtile xs slate" aria-hidden="true"><Icon name="calendar" size={13} /></span>
      <span className="w2b-row-main">
        <span className="t w2b-row-words">{bareTitle(m.title)}</span>
        <span className="meta w2b-row-words">{meta}</span>
      </span>
      {upcoming
        ? m.agenda.length ? <span className="tag slate w2b-tag">{m.agenda.length} {m.agenda.length === 1 ? 'agenda item' : 'agenda items'}</span> : <span className="tag slate w2b-tag">No agenda yet</span>
        : counts.open > 0 ? <span className="tag slate w2b-tag"><span className="dot" aria-hidden="true" />{counts.open} still open</span> : <span className="tag slate w2b-tag">{counts.total ? `${counts.total} tasks` : 'No tasks'}</span>}
    </button>
  );
}

// ── The pack's own settings page and menu (round 4 join with main: main's list is the one Meetings place, so the
// round's second list is gone; its settings page, short name, ⋯ tour and series stay) ──────────────────────────

/** Meetings settings: the series, what the prep pack carries, and bringing in a transcript. */
function SettingsPage({ view, canEdit }: { view: MeetingsView; canEdit: boolean }) {
  const modules = useModules();
  const prepOn = partOn(modules, 'meetings', 'prep');
  const { includeActions, save } = useMeetingSettings();
  const last = view.recent[0] ?? view.upcoming[view.upcoming.length - 1] ?? null;
  return (
    <PackShell glyph="◑" tint="blue" title={`${packName('meetings', 'Meetings')} settings`} sub="How meetings start, what lands in the prep pack, and bringing in a transcript." menu={() => meetingsMenu(view, canEdit)}>
      {view.seriesOn && (
        <PackSection label="Series">
          {view.series.length ? (
            view.series.map((s) => (
              <div key={s.path} className="trow" {...rowContext(() => rowMenu(s.path, s.name, () => openSeries(s.path)))}>
                <button type="button" onClick={() => openSeries(s.path)} className="t" title={s.name} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
                  {s.name}
                </button>
                <span className="end">
                  <span className="meta">{[s.day >= 0 && s.day < 7 ? `${WEEKDAYS[s.day]}s` : s.cadence, s.time && meetingTimeWords(s.time), 'starts from the last one'].filter(Boolean).join(' · ')}</span>
                </span>
              </div>
            ))
          ) : (
            <p className="vsub">No series yet.</p>
          )}
        </PackSection>
      )}
      <PackSection label="Prep packs">
        <div className="packrow">
          <div>
            <div className="nm">Prep pack before each meeting</div>
            <div className="ds">What is open with the people coming.</div>
          </div>
          <button type="button" role="switch" aria-checked={prepOn} aria-label="Prep pack before each meeting" className={`switch${prepOn ? '' : ' off'}`} disabled={!canEdit} onClick={() => void setModule('meetings', !prepOn, 'prep')} />
        </div>
        <div className="packrow" style={{ borderBottom: 0 }}>
          <div>
            <div className="nm">Include open tasks</div>
            <div className="ds">Carries each person’s open tasks into the pack.</div>
          </div>
          <button type="button" role="switch" aria-checked={includeActions} aria-label="Include open tasks" className={`switch${includeActions ? '' : ' off'}`} disabled={!canEdit} onClick={() => save({ includeActions: !includeActions })} />
        </div>
      </PackSection>
      <PackSection label="Notes and actions">
        <div className="trow" style={{ borderBottom: 0 }}>
          {last ? (
            <button type="button" onClick={() => openMeeting(last.path)} className="t" title={`Open ${last.title.replace(/^\d{4}-\d{2}-\d{2}\s*/, '')} to bring in its transcript`} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
              Bring in a transcript
            </button>
          ) : (
            <span className="t">Bring in a transcript</span>
          )}
          <span className="end">
            <span className="meta">{last ? 'fills notes, decisions and actions' : 'no meetings yet'}</span>
          </span>
        </div>
      </PackSection>
    </PackShell>
  );
}

/** Every Meetings page and action in the one menu, so nothing is more than a tap away. */
function meetingsMenu(view: MeetingsView | null, canEdit: boolean): MenuItem[] {
  if (!view) return [];
  const name = packName('meetings', 'Meetings');
  return [
    { label: name, icon: 'calendar', run: () => openModule('meetings', 'overview') },
    { label: 'All meetings', icon: 'table', run: () => openModule('meetings', 'all') },
    { label: 'Calendar', icon: 'calendar', run: () => openModule('meetings', 'calendar') },
    { label: 'Actions', icon: 'task', run: () => openModule('meetings', 'actions') },
    { label: 'Decisions', icon: 'flag', run: () => openModule('meetings', 'decisions') },
    { label: 'Questions', icon: 'help', run: () => openModule('meetings', 'questions') },
    { label: 'Series', icon: 'history', run: () => openModule('meetings', 'series') },
    { label: `${name} settings`, icon: 'settings', run: () => openModule('meetings', 'settings') },
    { separator: true },
    { label: 'New meeting', icon: 'calendar', disabled: !canEdit, run: () => newMeeting(view) },
    { label: 'New series', icon: 'history', disabled: !canEdit, run: () => newSeries(view) },
    { separator: true },
    { label: 'Show the folder', icon: 'folder', run: () => A.revealInExplorer(view.folder) },
    { separator: true },
    { label: `Show me around ${name}`, icon: 'help', run: () => openTour('meetings') },
  ];
}

function SeriesCards({ view, canEdit, weeklyOnly }: { view: MeetingsView; canEdit: boolean; weeklyOnly?: boolean }) {
  const list = weeklyOnly ? view.series.filter((s) => s.cadence === 'Weekly') : view.series;
  if (!list.length) {
    if (weeklyOnly) return null;
    return <EmptyState icon="history" title="No series yet" line="A meeting that comes round (a weekly sync, a monthly review) as a series: each one starts from the last, with its people, project, standing agenda and what was left open." action={{ label: 'New series', icon: 'plus', run: () => newSeries(view), disabled: !canEdit }} />;
  }
  return (
    <div className="w2b-series">
      {list.map((s) => (
        <div key={s.path} className="card w2b-series-card">
          <button type="button" className="w2b-link w2b-series-main" onClick={() => openSeries(s.path)} title={`Open ${s.name}`}>
            <span className="t clip">{s.name}</span>
            <span className="meta">{[s.day >= 0 ? `${WEEKDAYS[s.day]}s` : '', meetingTimeWords(s.time), `${s.meetings.length} held`].filter(Boolean).join(' · ')}</span>
          </button>
          {canEdit && (
            <button type="button" className="btn quiet w2b-mini" onClick={() => void workDid(call<string>('next-in-series', s.path), 'The next meeting is ready, with what was left open last time.').then((rel) => rel && openMeeting(rel))}>
              <Icon name="plus" size={11} /> Next meeting
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Ask a question from Every question (t248, 12 Nov 2026): into a meeting picked here (the latest
 *  first), answered in its note like any asked there. */
function AskAnywhere({ view, canEdit }: { view: MeetingsView; canEdit: boolean }) {
  const ordered = useMemo(() => [...view.meetings].sort((a, z) => z.date.localeCompare(a.date)), [view.meetings]);
  const [at, setAt] = useState('');
  const [asking, setAsking] = useState('');
  if (!canEdit || !ordered.length) return null;
  const into = ordered.find((m) => m.path === at) ?? ordered[0];
  const ask = async () => {
    const t = asking.trim();
    if (!t) return;
    setAsking('');
    await workDid(call('add-item', into.path, 'question', t));
  };
  return (
    <div className="w2b-add" style={{ margin: '0 0 12px' }}>
      <Icon name="plus" size={12} />
      <input value={asking} placeholder="Ask a question (“Who signs off the oven logs?”)" aria-label="Ask a question" onChange={(e) => setAsking(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void ask())} />
      <button type="button" className="button small" style={{ flex: 'none', maxWidth: '45%', whiteSpace: 'normal', textAlign: 'left' }} title="Which meeting it is asked in" onClick={(e) => openMenu(e.currentTarget, [{ heading: 'Ask it in' }, ...ordered.slice(0, 20).map((m) => ({ label: bareTitle(m.title), checked: m.path === into.path, run: () => setAt(m.path) }))])}>
        in {bareTitle(into.title)} <Icon name="chevron" size={10} />
      </button>
    </div>
  );
}

/** Whether a meeting holds anything to read: minutes, a summary, tasks, decisions, questions or an agenda. */
const meetingHasContent = (m: Meet) => !!m.summary || m.actions.length > 0 || m.decisions.length > 0 || m.questions.length > 0 || m.agenda.length > 0;

/** A meeting with nothing in it yet (round 3 review): the ways to give it something, instead of two blank panes. */
function EmptyMeetingDetail({ m, view, canEdit }: { m: Meet; view: MeetingsView; canEdit: boolean }) {
  const setProp = (key: string, value: string) => void workDid(call('set-prop', m.path, key, value));
  return (
    <section className="mt-empty" aria-label="Nothing in this meeting yet">
      <p className="mt-empty-words">Nothing in this meeting yet: no agenda, minutes, tasks or decisions.</p>
      <div className="mt-empty-acts">
        <button type="button" className="button" disabled={!canEdit} onClick={() => openMeeting(m.path)}>
          <Icon name="list" size={14} /> Add an agenda
        </button>
        <button type="button" className="button" disabled={!canEdit} onClick={() => void startRecording(m.path)}>
          <Icon name="mic" size={14} /> Record it
        </button>
        <button type="button" className="button" disabled={!canEdit} onClick={() => openTranscript(m)}>
          <Icon name="quote" size={14} /> Bring in a transcript
        </button>
        {!m.project && view.projects.length > 0 && (
          <button type="button" className="button" disabled={!canEdit} onClick={(e) => openMenu(e.currentTarget, view.projects.slice(0, 40).map((p) => ({ label: p.name, icon: 'layers' as IconName, run: () => setProp('project', p.name) })))}>
            <Icon name="layers" size={14} /> Link a project
          </button>
        )}
      </div>
    </section>
  );
}

function ListHome({ view, canEdit, chip, setChip, records }: { view: MeetingsView; canEdit: boolean; chip: Chip; setChip(c: Chip): void; records: WsRecord[] }) {
  const stats = meetingStats(view.meetings, view.series, view.today, isDone);
  const [project, setProject] = useState('');
  // The home's Find (t262): one box above the chips' lists, its words standing across chips, its count
  // for the open chip. The lists filter in state; folds and windows open through the shared Find. The words
  // stand as left (t266: leaving the room or opening a row forgot them; Tasks remembers its filter).
  const [find, setFind] = useFindMemory('meetings');
  const listRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  // The meeting the pointer or the keys are on: its detail stands beside the list on a wide window.
  const [picked, setPicked] = useState<string | null>(null);
  const settled = useSettled(picked);
  const needle = find.trim().toLowerCase();
  const projects = useMemo(() => [...new Set(view.meetings.map((m) => m.project).filter(Boolean))].sort(), [view.meetings]);
  const inProject = (m: Meet) => !project || m.project === project;
  const upcoming = view.meetings.filter((m) => m.dated && m.date >= view.today && inProject(m)).sort((a, z) => a.date.localeCompare(z.date) || a.time.localeCompare(z.time));
  // Newest dated first, the undated after them (round 3 review: "No day set" notes topped the list and were picked).
  const past = view.meetings.filter((m) => !(m.dated && m.date >= view.today) && inProject(m)).sort((a, z) => Number(z.dated) - Number(a.dated) || z.date.localeCompare(a.date) || z.time.localeCompare(a.time));
  const foundUpcoming = needle ? upcoming.filter((m) => meetingHay(m, view.today).includes(needle)) : upcoming;
  const foundPast = needle ? past.filter((m) => meetingHay(m, view.today).includes(needle)) : past;
  const foundSeries = needle ? view.series.filter((s) => `${s.name} ${s.project ?? ''} ${s.cadence}`.toLowerCase().includes(needle)) : view.series;
  const foundRecords = useMemo(() => (needle ? records.filter((r) => recordHay(r).includes(needle)) : records), [records, needle]);
  const kindCount = (kind: string, rows: WsRecord[]) => rows.filter((r) => r.kind === kind).length;
  const match = !needle
    ? null
    : chip === 'upcoming'
      ? { n: foundUpcoming.length, m: upcoming.length }
      : chip === 'past'
        ? { n: foundPast.length, m: past.length }
        : chip === 'series'
          ? { n: foundSeries.length, m: view.series.length }
          : chip === 'actions'
            ? { n: kindCount('action', foundRecords), m: kindCount('action', records) }
            : chip === 'decisions'
              ? { n: kindCount('decision', foundRecords), m: kindCount('decision', records) }
              : chip === 'questions'
                ? { n: kindCount('question', foundRecords), m: kindCount('question', records) }
                : { n: kindCount('meeting', foundRecords), m: kindCount('meeting', records) };
  // A chip switch carries the words on; the folds the Find opened shut behind it first.
  const pick = (c: Chip) => {
    if (c !== chip && listRef.current) restoreFindFolds(listRef.current);
    setChip(c);
  };
  // The counts ride on the chips (layout round 3, 20 Nov 2026: a band of five big tiles above the chips said the
  // same five numbers again and pushed the panes down the window).
  const chips: { id: Chip; label: string; n?: number; title?: string }[] = [
    { id: 'upcoming', label: 'Upcoming', n: stats.comingUp || undefined, title: 'coming up' },
    { id: 'past', label: 'Past' },
    { id: 'series', label: 'Series', n: stats.series || undefined },
    { id: 'actions', label: 'Every action', n: stats.openActions || undefined, title: stats.openActions === 1 ? 'action still open' : 'actions still open' },
    { id: 'decisions', label: 'Every decision', n: stats.decisionsWeek || undefined, title: 'decisions this week' },
    { id: 'questions', label: 'Every question', n: stats.openQuestions || undefined, title: stats.openQuestions === 1 ? 'question still open' : 'questions still open' },
  ];
  // The meeting the detail shows: the one the pointer or keys are on, else the first with something in it (its
  // minutes, tasks or decisions) on the open list, so the panes never open on an empty note.
  const shownList = chip === 'past' || !foundUpcoming.length ? foundPast : foundUpcoming;
  const firstMeet = shownList.find((m) => m.dated && meetingHasContent(m)) ?? shownList.find(meetingHasContent) ?? shownList[0];
  const pickedPath = settled && view.meetings.some((m) => m.path === settled) ? settled : firstMeet?.path;
  const pickedMeet = pickedPath ? view.meetings.find((x) => x.path === pickedPath) : undefined;
  const pickedEmpty = !!pickedMeet && !meetingHasContent(pickedMeet) && !pickedMeet.project && !(pickedMeet.dated && pickedMeet.date >= view.today);
  // A coming meeting's detail carries its prep (round 3: the detail pane fills with what helps, not a blank).
  const pickedPrep = pickedMeet && view.prepOn && pickedMeet.dated && pickedMeet.date >= view.today ? <PrepPackCard key={pickedMeet.path} m={pickedMeet} /> : null;
  return (
    <div
      onKeyDown={(e) => {
        // The room's / key jumps to the Find (fnv3 F29: a key is the list's only outside a field).
        if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
        if (e.key === '/' && document.activeElement !== findRef.current) {
          e.preventDefault();
          findRef.current?.focus();
        }
      }}
    >
      <div className="chips w2b-chips" role="tablist" aria-label="Which meetings">
        {chips.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={chip === c.id} className={`chip${chip === c.id ? ' on' : ''}${c.n !== undefined ? ' has-n' : ''}`} data-n={c.n} title={c.title && c.n !== undefined ? `${c.n} ${c.title}` : undefined} onClick={() => pick(c.id)}>
            {c.label}
          </button>
        ))}
        {projects.length > 0 && (chip === 'upcoming' || chip === 'past') && (
          <select className="select w2b-project" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
      </div>
      <ListFind id={`meetings-${chip}`} open value={find} onChange={setFind} match={match} scope={listRef} expands inputRef={findRef} hint="Press / to jump to the find" />
      <ListDetail
        rows={chip === 'upcoming' ? foundUpcoming.length : chip === 'past' ? foundPast.length : undefined}
        label="The meeting chosen"
        list={
      <div
        ref={listRef}
        onMouseOver={(e) => {
          const at = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]')?.dataset.pick;
          if (at && at !== picked) setPicked(at);
        }}
        onFocus={(e) => {
          const at = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]')?.dataset.pick;
          if (at) setPicked(at);
        }}
      >
      {chip === 'upcoming' && (
        !view.meetings.length ? (
          <EmptyState icon="calendar" title="Your meetings, and what comes of them" line="Add a meeting to keep its agenda, who came, what was decided and who does what. What is agreed is its project’s tasks from the moment it is written." action={{ label: 'New meeting', icon: 'plus', run: () => newMeeting(view), disabled: !canEdit }} also={{ label: 'New series', icon: 'history', run: () => newSeries(view), disabled: !canEdit }} />
        ) : !upcoming.length ? (
          // Nothing coming up: one line, then the meetings already had, so the list pane holds rows to pick (round 3:
          // an empty state alone stood in a window-tall pane).
          <>
            <p className="w2b-none-line">
              {project ? 'No upcoming meeting is in that project.' : 'Nothing coming up.'}{' '}
              {canEdit && !project && (
                <button type="button" className="text-button" onClick={() => newMeeting(view)}>
                  New meeting
                </button>
              )}
            </p>
            {foundPast.length > 0 && (
              <>
                <div className="glabel w2b-group w2b-section">Past meetings</div>
                <div className="card w2b-card">
                  {foundPast.map((m) => (
                    <MeetingRow key={m.path} m={m} today={view.today} upcoming={false} />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="card w2b-card">
              {foundUpcoming.map((m) => (
                <MeetingRow key={m.path} m={m} today={view.today} upcoming />
              ))}
            </div>
            {view.series.some((s) => s.cadence === 'Weekly') && (
              <>
                <div className="glabel w2b-group w2b-section">Weekly series</div>
                <SeriesCards view={{ ...view, series: foundSeries }} canEdit={canEdit} weeklyOnly />
              </>
            )}
          </>
        )
      )}
      {chip === 'past' && (
        !past.length ? (
          <p className="vsub">Meetings you have had show here.</p>
        ) : (
          <div className="card w2b-card">
            {foundPast.map((m) => (
              <MeetingRow key={m.path} m={m} today={view.today} upcoming={false} />
            ))}
          </div>
        )
      )}
      {chip === 'series' && (
        <div className="w2b-stack">
          <SeriesCards view={{ ...view, series: foundSeries }} canEdit={canEdit} />
          {view.series.length > 0 && <WorkViews module="meetings" section="series" records={foundRecords} made={VIEWS.series} />}
        </div>
      )}
      {chip === 'actions' && <WorkViews module="meetings" section="actions" records={foundRecords} made={VIEWS.actions} />}
      {chip === 'decisions' && <WorkViews module="meetings" section="decisions" records={foundRecords} made={VIEWS.decisions} />}
      {chip === 'questions' && (
        <>
          <AskAnywhere view={view} canEdit={canEdit} />
          <WorkViews module="meetings" section="questions" records={foundRecords} made={VIEWS.questions} />
        </>
      )}
      {chip === 'all' && (
        <>
          <div className="glabel w2b-group">Every meeting as a table</div>
          <WorkViews module="meetings" section="all" records={foundRecords} made={VIEWS.all} />
        </>
      )}
      </div>
        }
        context={!pickedEmpty}
        detail={pickedPath ? <RecordDetail refTo={{ path: pickedPath, type: 'meeting' }} extra={pickedMeet && pickedEmpty ? <EmptyMeetingDetail m={pickedMeet} view={view} canEdit={canEdit} /> : pickedPrep} onOpen={(tab) => openMeeting(pickedPath, tab ? 'tab' : 'current')} /> : null}
      />
    </div>
  );
}

// ── Records for the views ────────────────────────────────────────────────────────────────────────────────────────────

function meetingRecords(view: MeetingsView): WsRecord[] {
  const out: WsRecord[] = [];
  for (const m of view.meetings) {
    const open = m.actions.filter((a) => !isDone(a)).length;
    out.push({ id: `${m.path}::meeting`, kind: 'meeting', title: bareTitle(m.title) || m.title, path: m.path, ...(m.project ? { projectName: m.project } : {}), fields: { date: m.date, time: m.time || null, people: m.people.join(', ') || null, series: m.series || null, decisions: m.decisions.length, open_actions: open, agenda: m.agenda.length, transcript: m.transcripts > 0 }, links: [] });
    for (const a of m.actions) out.push({ id: `${m.path}::action:${a.line}`, kind: 'action', title: a.what, path: m.path, line: a.line, ...(m.project || a.filedTo ? { projectName: a.filedTo ?? m.project } : {}), fields: { owner: a.who ?? null, due: a.due ?? null, done: isDone(a), meeting: bareTitle(m.title), date: m.date }, links: [] });
    for (const d of m.decisions) out.push({ id: `${m.path}::decision:${d.line}`, kind: 'decision', title: d.text, path: m.path, line: d.line, ...(m.project ? { projectName: m.project } : {}), fields: { date: m.date, meeting: bareTitle(m.title) }, links: [] });
    for (const q of m.questions) out.push({ id: `${m.path}::question:${q.line}`, kind: 'question', title: q.what, path: m.path, line: q.line, ...(m.project ? { projectName: m.project } : {}), fields: { answered: q.answered, asked_by: q.askedBy ?? null, owner: q.owner ?? null, answer: q.answer ?? null, date: m.date, meeting: bareTitle(m.title) }, links: [] });
  }
  for (const s of view.series) out.push({ id: `${s.path}::series`, kind: 'series', title: s.name, path: s.path, ...(s.project ? { projectName: s.project } : {}), fields: { cadence: s.cadence, weekday: s.day >= 0 ? WEEKDAYS[s.day] : null, time: s.time || null, next_date: s.next, meetings: s.meetings.length }, links: [] });
  return out;
}

const VIEWS: Record<string, ReturnType<typeof defaultRecordView>[]> = {
  all: [{ ...defaultRecordView(['meeting'], 'table', 'All meetings'), scope: 'vault', fields: ['date', 'time', 'people', 'project', 'series', 'decisions', 'open_actions', 'transcript'], sort: { field: 'date', dir: 'desc' }, showDone: true }],
  calendar: [{ ...defaultRecordView(['meeting'], 'calendar', 'Meetings'), scope: 'vault', dateField: 'date', fields: ['time'], showDone: true }],
  actions: [
    { ...defaultRecordView(['action'], 'board', 'Open actions by project'), scope: 'vault', groupBy: 'project', fields: ['owner', 'due', 'meeting'], sort: { field: 'due', dir: 'asc' }, showDone: false },
    { ...defaultRecordView(['action'], 'table', 'Every action'), scope: 'vault', fields: ['done', 'owner', 'due', 'meeting', 'project'], groupBy: 'project', sort: { field: 'due', dir: 'asc' }, showDone: true },
  ],
  decisions: [{ ...defaultRecordView(['decision'], 'list', 'Decisions'), scope: 'vault', fields: ['date', 'meeting', 'project'], sort: { field: 'date', dir: 'desc' }, showDone: true }],
  questions: [{ ...defaultRecordView(['question'], 'list', 'Questions'), scope: 'vault', fields: ['answered', 'owner', 'meeting', 'project'], sort: { field: 'date', dir: 'desc' }, showDone: true }],
  series: [{ ...defaultRecordView(['series'], 'table', 'Every series'), scope: 'vault', fields: ['cadence', 'weekday', 'time', 'next_date', 'meetings', 'project'], sort: { field: 'next_date', dir: 'asc' }, showDone: true }],
};

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function MeetingsPage({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const modules = useModules();
  const prefs = usePrefs();
  const { data: view, error } = useWork<MeetingsView>('meetings');
  const sections = MEETINGS.sections.filter((s) => s.id !== 'series' || partOn(modules, 'meetings', 'series'));
  // The pack's own settings page rides along here, never in the catalogue (round 4 join: placeOf only knows the
  // sections it is given, so without this the settings menu landed back on the list).
  const { section, detail } = placeOf(tab, MEETINGS, [...sections, { id: 'settings', label: `${packName('meetings', 'Meetings')} settings`, icon: 'settings', line: 'How meetings start, what lands in the prep pack, and where actions go.' }]);
  const records = useMemo(() => (view ? meetingRecords(view) : []), [view]);
  const ctx = useWorkCtx('meetings', records, {
    editable: (r) => (r.kind === 'meeting' ? ['date', 'time'] : r.kind === 'action' ? ['done'] : r.kind === 'series' ? ['cadence', 'weekday', 'time'] : []),
    open: (r, e) => {
      if (!r.path) return;
      if (e?.ctrlKey || e?.metaKey) return A.openPath(r.path, { where: 'tab' });
      if (r.kind === 'series') return openSeries(r.path);
      if (r.kind === 'meeting') return openMeeting(r.path);
      // A task, decision or question opens the meeting note itself, at its line (t248: the note is the meeting).
      A.openPath(r.path, { where: 'current', ...(r.line !== undefined ? { line: r.line, span: 0 } : {}) });
    },
    people: view?.people,
  });
  // The open chip stands in history (t262, through t255's tab section): a chip switch pushes, so Back
  // returns to the chip, with its scroll; module moves reset the section and the chip follows the place. A
  // fresh visit lands on the chip as left (t266: the room forgot it and always reopened Upcoming; the list
  // home arrives as the bare overview, which carries no chip choice, so memory answers for it).
  const chipHere = tab.section ?? section;
  const listed = !chipHere || chipHere === 'overview';
  const [chipWas, rememberChip] = useFindMemory('meetings-chip', 'upcoming');
  const [chip, setChip] = useState<Chip>(() => (listed ? chipFor(chipWas) : chipFor(chipHere)));
  useEffect(() => {
    if (!listed) setChip(chipFor(chipHere));
  }, [chipHere]);
  useEffect(() => {
    rememberChip(chip);
  }, [chip, rememberChip]);
  const pickChip = (c: Chip) => {
    // The first chip on a fresh visit lands without pushing (t255's settle rule, and the List switch below
    // already lands this way): Back returns past the list to where the person was. Moving between chips
    // pushes, so Back returns to the chip (t266 break job: the landing push stranded Back on the list).
    if (!chipHere || chipHere === 'overview') setWorkspace((ws) => setTabSection(ws, tab.id, c, false));
    else setWorkspace((ws) => setTabSection(ws, tab.id, c, true));
    setChip(c);
  };
  const m = detail?.kind === 'meeting' && view ? view.meetings.find((x) => x.path === detail.key) : undefined;
  const s = detail?.kind === 'series' && view ? view.series.find((x) => x.path === detail.key) : undefined;
  const name = packName('meetings', 'Meetings');
  const stats = view ? meetingStats(view.meetings, view.series, view.today, isDone) : null;
  const addFromFile = () => void addFromFiles('Meetings', moduleFolder('meetings', getAreas()?.areas ?? null), `add what they hold to Meetings as its own records (${MEETINGS.types.map((t) => t.plural.toLowerCase()).join(', ')}), each with the fields Meetings keeps, and keep each file with its record.`);
  const removeMeeting = () => {
    if (!m) return;
    void A.trashPath(m.path).then((gone) => gone && openModule('meetings', 'overview'));
  };
  const removeSeries = () => {
    if (!s) return;
    void A.trashPath(s.path).then((gone) => gone && openModule('meetings', 'overview'));
  };
  const listMore = (): MenuItem[] => [
    { label: 'New meeting', icon: 'calendar', disabled: !canEdit, run: () => newMeeting(view) },
    { label: 'New series', icon: 'history', disabled: !canEdit || !partOn(modules, 'meetings', 'series'), run: () => newSeries(view) },
    { separator: true },
    { label: 'Every meeting as a table', icon: 'table', run: () => { openModule('meetings', 'all'); setChip('all'); } },
    { label: 'Add from a file…', icon: 'files', disabled: !canEdit, run: addFromFile },
    { label: `${name} settings`, icon: 'settings', run: () => openModule('meetings', 'settings') },
    { separator: true },
    { label: 'Show me around Meetings', icon: 'info', run: () => openTour('meetings') },
    { label: 'Show the folder', icon: 'folder', disabled: !view, run: () => view && A.revealInExplorer(view.folder) },
  ];
  const changeProject = () => {
    if (!m || !view) return;
    void pickFile(m.project ? 'Change to which project?' : 'Link to which project?', view.projects.map((p) => p.path), (p) => view.projects.find((x) => x.path === p)?.name ?? p).then((chosen) => {
      if (!chosen) return;
      const project = view.projects.find((p) => p.path === chosen)?.name ?? '';
      if (project) void workDid(call('set-prop', m.path, 'project', project));
    });
  };
  const detailMore = (): MenuItem[] => [
    ...(m
      ? [
          { label: 'Open the note', icon: 'notes' as IconName, run: () => A.openPath(m.path, { where: 'current' }) },
          { label: 'Bring in a transcript…', icon: 'quote' as IconName, disabled: !canEdit, run: () => openTranscript(m) },
          ...(!m.series && partOn(modules, 'meetings', 'series') ? [{ label: 'Make it a series…', icon: 'history' as IconName, disabled: !canEdit, run: () => makeSeriesFrom(m, view!) }] : []),
          ...(canEdit ? [{ label: m.project ? 'Change the project…' : 'Link a project…', icon: 'layers' as IconName, run: changeProject }] : []),
          ...(canEdit && m.project ? [{ label: 'Unlink the project', icon: 'close' as IconName, run: () => void workDid(call('set-prop', m.path, 'project', '')) }] : []),
          { separator: true as const },
          { label: deleteToBin('the meeting'), icon: 'trash' as IconName, danger: true, disabled: !canEdit, run: removeMeeting },
        ]
      : []),
    ...(s ? [{ label: 'Open its note', icon: 'notes' as IconName, run: () => A.openPath(s.path, { where: 'tab' }) }, { label: deleteToBin('the series'), icon: 'trash' as IconName, danger: true, disabled: !canEdit, run: removeSeries }] : []),
  ];
  return (
    <WithRecords ctx={ctx}>
      <ViewHeader tab={tab} />
      {/* The page scrolls in the frame's scroller, as BinView's does (p25 one column: the column's gutters match
          the vscroll rooms' at every window, and a long list scrolls instead of running past the window's edge). */}
      <div className="nv-page-scroll">
      {/* One page box per branch (p25 one column): the hooks sit on a plain div and each branch brings its own box.
          The list's and the settings page's PackShells bring the pack page's; the rest stand in the frame here.
          Two nested .nv-page boxes sat the list off the rooms' column. */}
      <div className="w2b-meetings">
        {error ? (
          <div className="nv-page full w2b-list"><p className="w2b-failed">{error}</p></div>
        ) : !view ? (
          <div className="nv-page full w2b-list"><div className="view-loading" /></div>
        ) : detail ? (
          <div className="nv-page full w2b-list has-split">
          {m || s ? (
            // Round 2, the mock beside the app: nothing floats above the title. The way back is the top bar (Back,
            // the tab history); Open the note and Bring in a transcript live under the title row menu.
            m ? <MeetingPage key={m.path} m={m} view={view} canEdit={canEdit} onMore={(el) => openMenu(el, detailMore())} /> : <SeriesPage key={s!.path} s={s!} view={view} canEdit={canEdit} onMore={(el) => openMenu(el, detailMore())} />
          ) : (
            <EmptyState icon="calendar" title="That meeting is not here any more" line="It may have been moved or removed." action={{ label: name, icon: 'back', run: () => openModule('meetings', 'overview') }} />
          )}
          </div>
        ) : section === 'settings' ? (
          <SettingsPage view={view} canEdit={canEdit} />
        ) : (
          // In the pack shell like every other pack page (packs uplift item 10): the tile, the catalogue's lead
          // line, the counts as facts. The list/calendar switch, New meeting and the whole list below are untouched.
          <PackShell
            wide={section !== 'calendar'}
            glyph="◑"
            tint="blue"
            title={name}
            // One summary line under the title (round 3): what is kept and this month's count, never a facts block.
            sub={`${[`${view.meetings.length} ${view.meetings.length === 1 ? 'meeting' : 'meetings'} kept`, view.series.length ? `${view.series.length} series` : '', stats && stats.thisMonth > 0 ? `${stats.thisMonth} this month` : ''].filter(Boolean).join(' · ')}. Notes, decisions and actions for every meeting, with prep packs.`}
            actions={
              <>
                <div className="seg" role="tablist" aria-label="List or calendar">
                  <button type="button" role="tab" aria-selected={section !== 'calendar'} className={section !== 'calendar' ? 'on' : ''} onClick={() => { openModule('meetings', 'overview'); setWorkspace((ws) => setTabSection(ws, tab.id, chip, false)); }}>List</button>
                  <button type="button" role="tab" aria-selected={section === 'calendar'} className={section === 'calendar' ? 'on' : ''} onClick={() => openModule('meetings', 'calendar')}>Calendar</button>
                </div>
                <button type="button" className="btn pri" disabled={!canEdit} onClick={() => newMeeting(view)}>
                  + New meeting
                </button>
              </>
            }
            menu={listMore}
          >
            {section === 'calendar' ? (
              <WeekCalendar meetings={view.meetings} today={view.today} onOpen={(path) => openMeeting(path)} monthView={<WorkViews module="meetings" section="calendar" records={records} made={VIEWS.calendar} />} syncOn={prefs.calendarSync} />
            ) : (
              <ListHome view={view} canEdit={canEdit} chip={chip} setChip={pickChip} records={records} />
            )}
          </PackShell>
        )}
        <RecordFormHost />
        <TranscriptHost />
      </div>
      </div>
    </WithRecords>
  );
}

// ── On Today ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function TodayPrep({ m }: { m: Meet }) {
  const { data: p } = useWork<PrepPack>('meetings', 'prep', [m.path]);
  return (
    <li className="rm-today-row">
      <button type="button" className="rm-today-main" onClick={() => openMeeting(m.path)}>
        <span className="rm-today-name">{bareTitle(m.title)}</span>
        <span className="rm-today-sub">
          {[m.date === todayIso() ? 'Today' : 'Tomorrow', meetingTimeWords(m.time)].filter(Boolean).join(' ')}
          {p ? ` · ${p.count ? `${p.count} open ${p.count === 1 ? 'item' : 'items'} with the people coming` : 'nothing open with the people coming'}` : ''}
        </span>
      </button>
      <button type="button" className="button small" onClick={() => openMeeting(m.path)}>
        Prep
      </button>
    </li>
  );
}

export function MeetingsToday() {
  const modules = useModules();
  const { data: view } = useWork<MeetingsView>('meetings');
  if (!view) return null;
  const today = view.today;
  const tomorrow = addDays(today, 1);
  const soon = partOn(modules, 'meetings', 'prep') ? view.upcoming.filter((m) => m.date === today || m.date === tomorrow).slice(0, 4) : [];
  // The after-flow nudge (10.0 item 19): recent past meetings with actions still open fold into one row
  // opening Meetings (8 Nov 2026, calm list), clearing itself as their actions tick. Each meeting
  // still opens from Meetings.
  const after = meetingsNeedingAfterflow(view.meetings, today, isDone);
  if (!soon.length && !after.length) return null;
  return (
    <section className="td-section rm-today wmt-today" data-section="meetings" aria-labelledby="td-h-meetings">
      <header className="td-section-head">
        <h2 id="td-h-meetings">
          Meetings
          {soon.length > 0 && <span className="td-count">{soon.length}</span>}
        </h2>
        <button type="button" className="td-section-link" onClick={() => openModule('meetings')}>
          <Icon name="calendar" size={13} /> Meetings
        </button>
      </header>
      <ul className="rm-today-rows">
        {soon.map((m) => (
          <TodayPrep key={m.path} m={m} />
        ))}
        {after.length > 0 && (
          <li className="rm-today-row">
            <button type="button" className="rm-today-main" onClick={() => openModule('meetings')} title="Open Meetings">
              <span className="rm-today-name">{afterflowFoldWords(after.length)}</span>
              <span className="rm-today-sub">{after.map((n) => bareTitle(n.title)).join(' · ')}</span>
            </button>
            <button type="button" className="button small" onClick={() => openModule('meetings')}>
              Open
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

/** The after-flow line alone (layout round 2): Today's one Meetings card carries it under the day's timeline, so the
 *  pack's own Meetings block (which repeated the timeline's meetings) no longer stands on Today. */
export function MeetingsAfterLine() {
  const modules = useModules();
  const on = modulesOn(modules).some((m) => m.id === 'meetings');
  const { data: view } = useWork<MeetingsView>('meetings');
  if (!on || !view) return null;
  const after = meetingsNeedingAfterflow(view.meetings, view.today, isDone);
  if (!after.length) return null;
  return (
    <div className="rm-today-row wmt-after-line" data-look-row>
      <button type="button" className="rm-today-main" onClick={() => openModule('meetings')} title="Open Meetings">
        <span className="rm-today-name">{afterflowFoldWords(after.length)}</span>
        <span className="rm-today-sub">{after.map((n) => bareTitle(n.title)).join(' · ')}</span>
      </button>
      <button type="button" className="button small" onClick={() => openModule('meetings')}>
        Open
      </button>
    </div>
  );
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
