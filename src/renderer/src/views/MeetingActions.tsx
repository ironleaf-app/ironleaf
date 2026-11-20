// The meeting note's Tasks (src/shared/work-meetings.ts readMeeting, the same reading the Meetings room
// uses, on the live text). A meeting's actions ARE its project's tasks since t238 — no filing, no copies —
// so these rows are Tasks and ticking one marks it done, in the note and in its project together (the
// meetings backend ticks with the one-task cascade, the way the room's tick does). A meeting with no
// project gets one plain line offering to pick one; that is the only prompt (t248, 12 Nov 2026).
// "Find more with AI" asks the chat's assistant for the actions the plain reading missed, shown the same
// way, never kept without a tick.

import { useEffect, useMemo, useState } from 'react';
import { dayLabel } from '../../../shared/days';
import { whenTone } from '../components/plan/plan';
import { WhenInner, WhoCell } from '../components/plan/TaskCells';
import type { MeetingAction } from '../../../shared/meetings';
import { isPrivatePath } from '../../../shared/private';
import { setTicked } from '../../../shared/reminders';
import { errorMessage } from '../lib/errors';
import { saveNoteFact } from '../lib/noteFacts';
import { Icon } from '../components/Icon';
import { pickFile } from '../components/Pickers';
import { docs } from '../state/docs';
import { peek } from '../state/peek';
import { workCall, workDid } from '../state/workModules';
import { useMeetingModel } from './meeting/useMeetingModel';

interface Row {
  key: string;
  line: number;
  raw: string;
  what: string;
  who: string;
  whenWords: string;
  due?: string;
  done: boolean;
  ai: boolean;
}

const SHOWN = 6;
/** Whole days from today to a day (late reads negative). */
const dayDiff = (d: Date) => {
  const a = new Date(d);
  a.setHours(0, 0, 0, 0);
  const b = new Date();
  b.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / 86400000);
};
const storeKey = (path: string) => `nv:meeting-panel:${path}`;
const remembered = (path: string): boolean | null => {
  try {
    const v = localStorage.getItem(storeKey(path));
    return v === null ? null : v === 'open';
  } catch {
    return null;
  }
};
const remember = (path: string, open: boolean) => {
  try {
    localStorage.setItem(storeKey(path), open ? 'open' : 'shut');
  } catch {
    // Remembering is a convenience only.
  }
};

export function MeetingActions({ path, text, canEdit }: { path: string; text: string; canEdit: boolean }) {
  const { ctx, model } = useMeetingModel(path, text);
  const [extra, setExtra] = useState<MeetingAction[]>([]);
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [open, setOpen] = useState<boolean | null>(() => remembered(path));
  const [all, setAll] = useState(false);
  useEffect(() => {
    setExtra([]);
    setAsked(null);
    setAdding('');
    setOpen(remembered(path));
  }, [path]);

  // The assistant's finds stay while their lines are still in the note as they were.
  const lines = useMemo(() => (model ? text.split(/\r?\n/) : []), [model, text]);
  const rows: Row[] = useMemo(() => {
    if (!model) return [];
    const out: Row[] = model.actions.map((a, i) => ({
      key: `n:${a.line}:${i}`,
      line: a.line,
      raw: a.raw,
      what: a.what,
      who: a.who ?? '',
      whenWords: a.whenWords ?? '',
      ...(a.due ? { due: a.due } : {}),
      done: a.done,
      ai: false,
    }));
    const have = new Set(model.actions.map((a) => a.line));
    for (const a of extra) {
      if (have.has(a.line) || (lines[a.line] !== a.raw && !lines.includes(a.raw))) continue;
      out.push({ key: `ai:${a.line}:${a.raw}`, line: a.line, raw: a.raw, what: a.what, who: a.who ?? '', whenWords: a.whenWords ?? '', ...(a.due ? { due: a.due } : {}), done: false, ai: true });
    }
    return out.sort((a, b) => a.line - b.line);
  }, [model, extra, lines]);
  if (!ctx) return null;
  if (!ctx.meeting) return null;
  if (!model) return null;
  // Its project as the note itself reads it (MeetingTop's own reading): the context's projects miss a
  // path-valued property, which read the stale "link a project" prompt under a linked chip (t248).
  const project = model.project || ctx.projects[0]?.name || '';
  // Its path, so the head's project opens what it names (p17-connected: a filed action's project opens).
  const projectPath = ctx.projects.find((p) => p.name === project)?.path ?? ctx.all.find((p) => p.name === project)?.path ?? '';
  const openCount = rows.filter((r) => !r.done).length;
  const expanded = open ?? rows.length > 0;
  const toggle = () => {
    setOpen(!expanded);
    remember(path, !expanded);
  };

  const tick = (r: Row) => {
    if (!canEdit) return;
    const done = !r.done;
    void workDid(workCall<string>('meetings', 'tick', path, r.line, r.raw, done), (said) => said || (done ? 'Done.' : 'Not done.'), {
      label: 'Undo',
      run: () => void workDid(workCall<string>('meetings', 'tick', path, r.line, setTicked(r.raw, done), !done)),
    });
  };
  const add = async () => {
    const t = adding.trim();
    if (!t) return;
    setAdding('');
    await workDid(workCall('meetings', 'add-item', path, 'action', t));
  };
  const pickProject = async () => {
    const options = ctx.all.length ? ctx.all : ctx.projects;
    if (!options.length) return;
    const chosen = await pickFile('Pick a project', options.map((p) => p.path), (p) => options.find((x) => x.path === p)?.name ?? p);
    if (!chosen) return;
    const name = options.find((p) => p.path === chosen)?.name ?? '';
    if (name) void saveNoteFact(path, { type: 'meeting', page: true }, 'project', name, 'Linked the project.');
  };
  const findMore = async () => {
    if (asking) return;
    setAsking(true);
    setAsked(null);
    try {
      const r = await window.nv.meetings.findMore(path, docs.text(path) ?? text);
      if (r.error) setAsked(r.error);
      else {
        setExtra((was) => [...was, ...r.actions.filter((a) => !was.some((w) => w.raw === a.raw))]);
        setAsked(r.actions.length ? `The assistant found ${r.actions.length === 1 ? 'one more' : `${r.actions.length} more`}: tick ${r.actions.length === 1 ? 'it' : 'them'} when done.` : 'The assistant found nothing more.');
        setOpen(true);
      }
    } catch (err) {
      setAsked(errorMessage(err));
    } finally {
      setAsking(false);
    }
  };

  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <section className={`mt-panel${expanded ? ' open' : ''}${rows.length ? '' : ' settled'}`} aria-label="Tasks in this note">
      <button className="mt-head" aria-expanded={expanded} onClick={toggle}>
        <span className="mt-head-icon">
          <Icon name={openCount ? 'task' : 'check'} size={14} />
        </span>
        <span className="mt-head-words">
          {rows.length ? (
            <>
              <strong>Tasks · {rows.length}{openCount > 0 && openCount < rows.length ? `, ${openCount} open` : openCount === 0 ? ', all done' : ''}</strong>
              {project && <span className="mt-faint"> · all {projectPath ? <button type="button" className="text-button" onClick={() => peek({ type: 'project', path: projectPath }, { title: project, type: 'project' })} title={`Open ${project}`}>{project}</button> : project}’s tasks</span>}
            </>
          ) : (
            <strong>Tasks</strong>
          )}
        </span>
        <Icon name="chevronDown" size={14} className="mt-chevron" />
      </button>
      {expanded && (
        <div className="mt-body">
          {!project && rows.length > 0 && (
            <p className="vsub">
              <button type="button" className="text-button" onClick={() => void pickProject()} title="Pick the project these become tasks of">Pick a project</button> to make these its tasks.
            </p>
          )}
          {rows.length > 0 ? (
            <ul className="mt-list tklist">
              {shown.map((r) => {
                const due = r.due ? new Date(`${r.due}T12:00:00`) : null;
                const whenWords = due ? `by ${dayLabel(due)}` : r.whenWords ? `by ${r.whenWords}` : null;
                return (
                  <li key={r.key} className={`mt-row tkrow${r.done ? ' is-done' : ''}${r.ai ? ' by-ai' : ''}`}>
                    <button type="button" className={`check${r.done ? ' done' : ''}`} role="checkbox" aria-checked={r.done} disabled={!canEdit} title={r.done ? 'Done (tick to put it back)' : 'Tick it done'} onClick={() => tick(r)}>
                      {r.done ? <Icon name="check" size={12} /> : null}
                    </button>
                    <span className={`tkrow-title${r.done ? ' is-done' : ''}`}>
                      <span className="mt-words" title={r.what}>
                        <span className="clip-2">{r.what}</span>
                        {r.ai && (
                          <span className="mt-ai" title="Found by the assistant: kept only if you tick it">
                            <Icon name="sparkle" size={11} /> Assistant
                          </span>
                        )}
                      </span>
                    </span>
                    {/* Who opens the person (p17-connected): the one who cell every read-only task grid uses. */}
                    <WhoCell name={r.who} />
                    <span className="tkrow-when">
                      <WhenInner words={whenWords} tone={due ? whenTone(dayDiff(due)) : whenWords ? 'quiet' : null} title={whenWords ?? undefined} />
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="vsub">No tasks yet. Add them here or write them in the note.</p>
          )}
          {rows.length > SHOWN && (
            <button className="text-button mt-more" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show ${rows.length - SHOWN} more`}
            </button>
          )}
          {asked && <p className="mt-said">{asked}</p>}
          <div className="mt-foot">
            {canEdit && (
              <div className="w2b-add" style={{ marginTop: 0, flex: '1 1 100%' }}>
                <Icon name="plus" size={12} />
                <input value={adding} placeholder="Add a task (“Sam to send the quote by Friday”)" aria-label="Add a task" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void add())} onBlur={() => void add()} />
              </div>
            )}
            {!isPrivatePath(path) && canEdit && (
              <button className="text-button mt-ask" disabled={asking} onClick={() => void findMore()} title="The chat’s assistant reads the note for tasks said in passing. Nothing is kept without your tick.">
                <Icon name="sparkle" size={13} /> {asking ? 'Reading the note…' : 'Find more with AI'}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
