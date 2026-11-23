// Light additions under a note's fields, by its type (wave D of Ironleaf Calm, 20 Oct 2026, approved the plan: "A
// person's page lists their meetings and projects"). A person's page: "Meetings with <name>" (newest first) and
// "Projects", from the notes that link to them or name them among a meeting's people. A meeting's page: its people as
// chips — those it links to that its attendees field doesn't already show, as "Also mentioned" (20 Oct 2026: a second
// row also called People read as the same field twice). Read from the vault's index in the window
// (src/shared/note-page.ts); nothing is written. Kept short: a few rows, then "Show all".

import { useMemo, useState } from 'react';
import { isMeetingNote, meetingPeople, mentionedPeople, personPages, readType, type PageRef } from '../../../shared/note-page';
import { isPrivatePath } from '../../../shared/private';
import { readDate, shortDate } from '../lib/projectLook';
import { resolveNote } from '../lib/resolve';
import { useApp } from '../state/store';
import { Icon } from './Icon';
import { LinkChip } from './NoteFields';

const SHOWN = 5;

function RefList({ title, refs, onOpen, dated }: { title: string; refs: PageRef[]; onOpen(path: string, newTab: boolean): void; dated?: boolean }) {
  const [all, setAll] = useState(false);
  if (!refs.length) return null;
  const shown = all ? refs : refs.slice(0, SHOWN);
  return (
    <section className="page-links">
      <h3 className="page-links-head">
        <span>{title}</span>
        <span className="page-links-count">{refs.length}</span>
      </h3>
      <ul className="page-links-list">
        {shown.map((r) => {
          const when = dated && r.date ? readDate(r.date) : null;
          return (
            <li key={r.path}>
              <button className="page-links-row" title="Open (Ctrl+click: in a new tab)" onClick={(e) => onOpen(r.path, e.ctrlKey || e.metaKey)}>
                <Icon name={dated ? 'calendar' : 'layers'} size={13} />
                <span className="page-links-name">{r.title}</span>
                {when !== null && <span className="page-links-when">{shortDate(when)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {refs.length > SHOWN && (
        <button className="page-links-more" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${refs.length}`}
        </button>
      )}
    </section>
  );
}

export function PageConnections({ path, onOpen, onOpenLink }: { path: string; onOpen(path: string, newTab: boolean): void; onOpenLink(target: string, newTab: boolean): void }) {
  const notes = useApp((s) => s.notes);
  const me = useApp((s) => s.byPath.get(path));
  const type = readType(me?.props);
  const isPerson = type === 'person';
  const isMeeting = !!me && isMeetingNote(me);

  const person = useMemo(() => {
    if (!isPerson) return null;
    const open = notes.filter((n) => !isPrivatePath(n.path));
    return personPages(path, open, (target, from) => resolveNote(target, from));
  }, [isPerson, notes, path]);

  // A meeting's people it links to in its words, who are people (by type) and not already shown in a field row:
  // neither its attendees field nor its "also" field, which is this same list written down (item 5).
  const extraPeople = useMemo(() => {
    if (!isMeeting || !me) return [];
    const listed = new Set([...meetingPeople(me.props), ...mentionedPeople(me.props)].map((p) => resolveNote(p.target, path) ?? p.target.toLowerCase()));
    const out: string[] = [];
    for (const l of me.links) {
      const p = resolveNote(l.target, path);
      if (!p || listed.has(p) || out.includes(p)) continue;
      if (readType(notes.find((n) => n.path === p)?.props) === 'person') out.push(p);
    }
    return out;
  }, [isMeeting, me, notes, path]);

  if (isPrivatePath(path)) return null;
  if (person && (person.meetings.length || person.projects.length)) {
    const name = me?.title ?? path.split('/').pop()!.replace(/\.md$/i, '');
    return (
      <div className="page-connections">
        <RefList title={`Meetings with ${name}`} refs={person.meetings} onOpen={onOpen} dated />
        <RefList title="Projects" refs={person.projects} onOpen={onOpen} />
      </div>
    );
  }
  if (extraPeople.length)
    return (
      <div className="page-connections">
        <div className="page-people">
          <span className="page-people-label" title="People this meeting names in its words but not in its People field">Also mentioned</span>
          <div className="page-people-chips">
            {extraPeople.map((p) => (
              <LinkChip key={p} link={{ target: p.replace(/\.md$/i, '') }} from={path} onOpen={onOpenLink} />
            ))}
          </div>
        </div>
      </div>
    );
  return null;
}
