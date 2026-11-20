// A day's smaller parts on Today (20 Oct 2026, "Ironleaf Calm"): the meetings that day as a small agenda at the top of
// the day, with New meeting; what was saved from the former host app that day, beside the day's note; and the day's
// activity — notes made, changed and linked to that day (a property or the words naming it, or a link to its note), each
// note once, with its type's icon when it has a type: property.

import { useState } from 'react';
import { meetingName, type HubDay, type HubNoteRef } from '../../../../shared/hub';
import { dailyTitleWords } from '../../../../shared/notes-list';
import { newNoteOfType } from '../../state/noteTypes';
import { Icon, type IconName } from '../../components/Icon';
import * as A from '../../state/actions';
import { startRecording, useRecorder } from '../../state/recorder';
import { isBusy } from '../../../../shared/recorder';

/** A note type's icon (type: in its properties); a plain note's when it has none or one Ironleaf doesn't draw. */
export function typeIcon(type?: string): IconName {
  switch (type) {
    case 'meeting':
    case 'meeting notes':
      return 'people';
    case 'person':
    case 'people':
    case 'contact':
      return 'person';
    case 'project':
      return 'layers';
    case 'doc':
    case 'docs':
      return 'doc';
    case 'idea':
      return 'sparkle';
    case 'decision':
      return 'check';
    case 'book':
      return 'book';
    case 'daily':
      return 'calendar';
    default:
      return 'file';
  }
}

/** Nothing for a moment that cannot be read (8.7 urgent, 30 Oct 2026): never "Invalid Date". */
const timeOf = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?/i, ' $1m') : '');
const open = (path: string, e: React.MouseEvent) => A.openPath(path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' });
/** Rows shown before Show all (4 Nov 2026, p17-today-note-cap: the side column stays short, about five). */
const SHOWN = 5;

/** The day's meetings, at the top of the day. */
/** New meeting and Record a meeting for the day (layout round 2: Today shows them small in its Meetings head). */
export function DayMeetingActions({ day, today, canEdit }: { day: HubDay; today: string; canEdit: boolean }) {
  // The Meeting type's own fields and words, dated this day (state/noteTypes.ts).
  const newMeeting = () => void newNoteOfType('meeting', { where: 'tab', title: meetingName(day.date), values: { date: day.date } });
  // Record a meeting (21 Oct 2026, gap G18): a new meeting note for the day, opened and recording at once.
  const recorder = useRecorder();
  const recordMeeting = async () => {
    const path = await newNoteOfType('meeting', { where: 'tab', title: meetingName(day.date), values: { date: day.date } });
    if (path) await startRecording(path);
  };
  return (
    <>
      {canEdit && (
        <button className="th-new-meeting" onClick={newMeeting} title="A meeting note for this day, in Meetings">
          <Icon name="plus" size={13} /> New meeting
        </button>
      )}
      {canEdit && day.date === today && (
        <button className="th-new-meeting th-record-meeting" onClick={() => void recordMeeting()} disabled={isBusy(recorder.live)} title={isBusy(recorder.live) ? 'A meeting is being recorded' : 'A meeting note for today, recording now: written down as it goes, notes made when you stop'}>
          <span className="mr-rec" aria-hidden="true" /> Record a meeting
        </button>
      )}
    </>
  );
}

export function DayAgenda({ day, today, canEdit, actions = true }: { day: HubDay; today: string; canEdit: boolean; actions?: boolean }) {
  const [all, setAll] = useState(false);
  return (
    <section className={`th-agenda${day.meetings.length ? '' : ' is-empty'}`} aria-label="Meetings">
      {(all ? day.meetings : day.meetings.slice(0, SHOWN)).map((m) => (
        <button key={m.path} className="th-meeting" onClick={(e) => open(m.path, e)} title={m.path}>
          <span className="th-meeting-time">{m.time ?? 'All day'}</span>
          <span className="th-meeting-words">
            <b>{m.title}</b>
            {m.attendees.length > 0 && (
              <small>
                {m.attendees.slice(0, 3).join(', ')}
                {m.attendees.length > 3 ? ` +${m.attendees.length - 3}` : ''}
              </small>
            )}
          </span>
        </button>
      ))}
      {day.meetings.length > SHOWN && (
        <button className="td-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${day.meetings.length}`}
          <Icon name={all ? 'chevronDown' : 'chevron'} size={12} />
        </button>
      )}
      {actions && <DayMeetingActions day={day} today={today} canEdit={canEdit} />}
    </section>
  );
}

function NoteLine({ n, when }: { n: HubNoteRef; when: string }) {
  return (
    <li>
      <button onClick={(e) => open(n.path, e)} title={n.path}>
        <Icon name={typeIcon(n.type)} size={14} />
        <span className="th-act-name">{dailyTitleWords(n.title) || n.title}</span>
        <span className="th-act-when">{when}</span>
      </button>
    </li>
  );
}

/** Pages and words saved from the former host app that day, under the day's note. */
export function DaySaved({ day }: { day: HubDay }) {
  const [all, setAll] = useState(false);
  if (!day.saved.length) return null;
  return (
    <div className="th-saved">
      <h3>
        <Icon name="download" size={12} /> Saved <span>{day.counts.saved}</span>
      </h3>
      <ul className="th-act-list">
        {(all ? day.saved : day.saved.slice(0, SHOWN)).map((n) => (
          <NoteLine key={n.path} n={n} when={timeOf(n.at)} />
        ))}
      </ul>
      {day.saved.length > SHOWN && (
        <button className="td-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${day.saved.length}`}
          <Icon name={all ? 'chevronDown' : 'chevron'} size={12} />
        </button>
      )}
    </div>
  );
}

/** Made, changed and linked on the day. `except`: paths another card on the same screen already names (Today
 *  passes what Changed since yesterday lists): Made and Changed skip those rows, so no note lists twice (4 Nov 2026,
 *  p15-today-rest). Linked is link-based, never a repeat, so it keeps everything. Five rows, then Show all (4 Nov 2026,
 *  p17-today-note-cap: it listed every changed file, 22 rows, and the side column ran on). */
export function DayActivity({ day, isToday, emptyVault, except }: { day: HubDay; isToday: boolean; emptyVault: boolean; except?: ReadonlySet<string> }) {
  const [tab, setTab] = useState<'made' | 'changed' | 'linked' | null>(null);
  const [all, setAll] = useState(false);
  const keep = (n: { path: string }) => !except || !except.has(n.path);
  const made = day.made.filter(keep);
  const changed = day.changed.filter(keep);
  const lists = [
    { id: 'made' as const, title: 'Made', items: made, count: made.length },
    { id: 'changed' as const, title: 'Changed', items: changed, count: changed.length },
    { id: 'linked' as const, title: 'Linked', items: day.linked, count: day.counts.linked },
  ];
  const total = lists.reduce((n, l) => n + l.count, 0);
  const skipped = day.made.length - made.length + (day.changed.length - changed.length);
  // The list with something in it first, unless one was chosen.
  const shown = lists.find((l) => l.id === tab) ?? lists.find((l) => l.count) ?? lists[0];
  return (
    <section className="td-section th-activity" data-section="activity" aria-labelledby="td-h-activity">
      <header className="td-section-head">
        <h2 id="td-h-activity">{isToday ? 'Today in your notes' : 'That day in your notes'}</h2>
      </header>
      {total === 0 ? (
        <p className="td-none">{emptyVault ? 'Notes you make, change or link to a day show here.' : skipped > 0 ? 'What changed is with its project, under Changed since yesterday.' : isToday ? 'Nothing made or changed yet today.' : 'Nothing was made, changed or linked to that day.'}</p>
      ) : (
        <>
          <div className="th-tabs" role="tablist">
            {lists.map((l) => (
              <button key={l.id} role="tab" aria-selected={shown.id === l.id} className={`th-tab${shown.id === l.id ? ' on' : ''}`} disabled={!l.count} onClick={() => { setTab(l.id); setAll(false); }} title={l.id === 'linked' ? 'Notes whose properties or words name this day, or that link to its note' : undefined}>
                {l.title}{l.count > 0 ? <> <span>{l.count}</span></> : null}
              </button>
            ))}
          </div>
          <ul className="th-act-list" role="tabpanel">
            {(all ? shown.items : shown.items.slice(0, SHOWN)).map((n) => (
              <NoteLine key={n.path} n={n} when={shown.id === 'changed' ? timeOf(n.at) : ''} />
            ))}
          </ul>
          {shown.items.length > SHOWN && (
            <button className="td-more" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${shown.items.length}`}
              <Icon name={all ? 'chevronDown' : 'chevron'} size={12} />
            </button>
          )}
          {shown.count > shown.items.length && <p className="td-none">And {shown.count - shown.items.length} more in your notes.</p>}
        </>
      )}
    </section>
  );
}
