// The top of a meeting note (Job B, 29 Oct 2026, SPEC B): when it is, who is in it, its project, then prep before it or
// its actions after it. The recorder below stays the way to record. Every fact changes where it shows (p17-editable, Nov
// 2026), through the note's own properties with Undo — the same facts the Meetings pack edits, the same gesture.
import { useEffect, useMemo, useState } from 'react';
import { displayTitle } from '../../../../shared/markdown';
import { isMeetingNote } from '../../../../shared/meetings';
import { meetingDayLabel, meetingActionCounts, meetingPhase, readMeeting, type PrepPack } from '../../../../shared/work-meetings';
import { Icon } from '../../components/Icon';
import { initials, personHue } from '../../lib/projectLook';
import { saveNoteFact } from '../../lib/noteFacts';
import { docs } from '../../state/docs';
import { useApp } from '../../state/store';
import { openModule } from '../../state/modules';
import { useWork } from '../../state/workModules';
import { EditorContext, Inline, InlineDate } from '../project/Inline';
import '../../styles/people-meetings.css';

function useNoteText(path: string): string {
  const [text, setText] = useState(() => docs.text(path) ?? '');
  useEffect(() => {
    let live = true;
    void docs.acquire(path).then((t) => live && setText(t), () => undefined);
    const off = docs.onText((p, t) => { if (p === path) setText(t); });
    return () => { live = false; off(); docs.release(path); };
  }, [path]);
  return text;
}

export function MeetingTop({ path, canEdit }: { path: string; canEdit: boolean; onChangeText?: (next: string) => void }) {
  const props = useApp((s) => s.byPath.get(path)?.props);
  const text = useNoteText(path);
  const isMeeting = isMeetingNote(path, props ?? {});
  const meeting = useMemo(() => (isMeeting && text ? readMeeting({ path, title: displayTitle(path, props), props: props ?? {}, content: text }) : null), [isMeeting, text, path, props]);
  const today = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, []);
  const phase = meeting ? meetingPhase(meeting, today) : 'after';
  const { data: prep } = useWork<PrepPack>('meetings', 'prep', [path], isMeeting && phase === 'before');
  // The kit's fields on the facts (each saves through the note's own properties, never this).
  const editor = useMemo(() => ({ path, canEdit, known: { people: [], tags: [] as string[] }, edit: async () => false }), [path, canEdit]);
  if (!isMeeting || !meeting) return null;
  const counts = meetingActionCounts(meeting);
  const openActions = meeting.actions.filter((a) => !a.done);
  const save = (fact: string, words: string, emptyWords: string) => (v: string) => saveNoteFact(path, { type: 'meeting', page: true }, fact, v, v.trim() ? words : emptyWords);
  const rawProject = Array.isArray(props?.project) ? props.project.map(String).join(', ') : String(props?.project ?? '');
  return (
    <section className="mt-top" aria-label="About this meeting">
      <div className="mt-top-row">
        <EditorContext.Provider value={editor}>
          <span className="mt-top-when">
            <InlineDate value={meeting.dated ? meeting.date : ''} iso label="Day" placeholder="Add a day" onSave={save('date', 'Moved the meeting.', 'Took the day off.')}>
              {meeting.dated ? meetingDayLabel(meeting.date, today) : undefined}
            </InlineDate>
            {(meeting.time || canEdit) && (
              <>
                {' · '}
                <Inline value={meeting.time} label="Time" placeholder="Add a time" compact onSave={save('time', 'Changed the time.', 'Took the time off.')} />
              </>
            )}
          </span>
          {(meeting.where || canEdit) && (
            <span className="pm-sub">
              <Inline value={meeting.where} label="Where" placeholder="Add a place" compact onSave={save('where', 'Changed where it is.', 'Took the place off.')} />
            </span>
          )}
          {(meeting.project || rawProject || canEdit) && (
            <span className="pm-chip">
              <Icon name="layers" size={12} />{' '}
              {Array.isArray(props?.project) ? (
                meeting.project
              ) : (
                <Inline value={meeting.project || rawProject} label="Project" placeholder="Link a project" compact onSave={save('project', 'Linked the project.', 'Unlinked the project.')}>
                  {meeting.project || undefined}
                </Inline>
              )}
            </span>
          )}
          {meeting.people.length ? (<span className="pm-avatars" aria-label={`Who is in it: ${meeting.people.join(', ')}`}>{meeting.people.slice(0, 6).map((p) => (<span key={p} className="pm-avatar" style={{ ['--hue' as string]: personHue(p) }} aria-hidden="true">{initials(p)}</span>))}</span>) : null}
          {(meeting.people.length || canEdit) && (
            <span className="pm-sub">
              <Inline value={meeting.people.join(', ')} label="Who is in it" placeholder="Who is coming" compact onSave={save('attendees', 'Changed who is coming.', 'Took everyone off.')} />
            </span>
          )}
          <button type="button" className="text-button" onClick={() => openModule('meetings', 'meeting:' + encodeURIComponent(path), 'tab')}>Open meeting workspace</button>
        </EditorContext.Provider>
      </div>
      {phase === 'before' ? (
        <div>
          <strong>Prep</strong>{' '}
          <span className="pm-sub">{prep ? (prep.count ? `${prep.count} open ${prep.count === 1 ? 'item' : 'items'} with the people coming${prep.last ? `, including ${prep.last.open.length} from last time` : ''}.` : 'Nothing open with the people coming. A clear run.') : 'Reading what is open with the people coming.'}</span>
          {prep && prep.count > 0 ? (<ul className="pm-actions-list">{[...prep.people.flatMap((p) => p.theirs), ...(prep.last?.open ?? [])].slice(0, 4).map((x, i) => (<li key={`${x.what}-${i}`} className="pm-action"><span className="pm-action-words">{x.what}{x.who ? <span className="pm-action-sub"> · {x.who}</span> : null}</span></li>))}</ul>) : null}
        </div>
      ) : (
        <div className="mt-top-row">
          <span><strong>Tasks</strong> <span className="pm-sub">{counts.total ? `${counts.total} in this meeting, ${counts.open} still open${meeting.project ? `, all ${meeting.project}’s tasks` : ''}.` : 'No tasks yet. Add them in the Tasks panel below.'}</span></span>
          {openActions.length ? <span className="pm-sub">{openActions.slice(0, 3).map((a) => a.what).join(' · ')}{openActions.length > 3 ? ` and ${openActions.length - 3} more` : ''}</span> : null}
        </div>
      )}
    </section>
  );
}
