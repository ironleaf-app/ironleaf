// The Meetings week (8.7 w2b, 30 Oct 2026): the mock-up's week calendar. Seven day columns, Monday to Sunday, with full
// titles (8.9 round 2: the week always includes today), the day column under the grid (p14: beside it the days squeezed
// inside the page column), and Month / Week / Day in words. Choosing a block opens the meeting in a side peek; choosing a
// day opens its column here. The month grid stays the calendar the vault already had, passed in as monthView, so nothing
// about it is lost.
//
// 8.9 two-way sync: when Settings › Calendar is on, the person's calendar events (blue) and due tasks (red
// when late, amber for today, slate after) sit beside the meetings in the week, the day column and the month. An event
// becomes a meeting note with one click; a meeting already made from one opens instead, never a second note.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CalendarEvent } from '../../../../shared/calendar';
import { eventTime } from '../../../../shared/calendar';
import { monthGrid, monthWords } from '../../../../shared/hub';
import type { VaultTask } from '../../../../shared/tasks';
import type { MeetingRec } from '../../../../shared/work-meetings';
import { dayColumnHead, meetingsOn, meetingTimeWords, weekDayHead, weekOf, weekRangeWords } from '../../../../shared/work-meetings';
import { Icon } from '../../components/Icon';
import * as A from '../../state/actions';

/** The day an event falls on, as an ISO date ('' when it can't be read). */
function eventDay(e: Pick<CalendarEvent, 'start'>): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(e.start)) return e.start;
  const ms = Date.parse(e.start);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
import { openMeetingNoteFor } from '../../state/noteTypes';
import { peek } from '../../state/peek';

type Meet = Pick<MeetingRec, 'path' | 'title' | 'date' | 'dated' | 'time' | 'where' | 'people' | 'project'>;

const bareTitle = (t: string) => t.replace(/^\d{4}-\d{2}-\d{2}\s*/, '') || t;
const taskTint = (due: string, today: string) => (due < today ? 'red' : due === today ? 'amber' : 'slate');

/** An event made into a meeting note, or the note already made from it opened (never a second note for one event). */
function useMakeNote() {
  return (e: CalendarEvent, day: string) => void openMeetingNoteFor(e, day);
}

function DayColumn({ day, meetings, events, tasks, today, onOpen }: { day: string; meetings: readonly Meet[]; events: readonly CalendarEvent[]; tasks: readonly VaultTask[]; today: string; onOpen(path: string): void }) {
  const rows = useMemo(() => meetingsOn(meetings, day), [meetings, day]);
  const evs = useMemo(() => events.filter((e) => eventDay(e) === day), [events, day]);
  const due = useMemo(() => tasks.filter((t) => !t.done && t.due === day), [tasks, day]);
  const makeNote = useMakeNote();
  const empty = !rows.length && !evs.length && !due.length;
  return (
    <div className="w2b-daycol">
      <div className="glabel w2b-group">{dayColumnHead(day)}</div>
      <div className="card w2b-daycard">
        {empty ? (
          <p className="vsub">Nothing in the diary{day === today ? ' today' : ` on ${dayColumnHead(day)}`}.</p>
        ) : (
          <>
            {rows.map((m) => (
              <button key={m.path} type="button" className="w2b-dayrow" onClick={() => peek({ path: m.path }, { title: bareTitle(m.title), type: 'note' })} onDoubleClick={() => onOpen(m.path)} title={`${bareTitle(m.title)} (open the meeting)`}>
                <span className="w2b-daytime">{meetingTimeWords(m.time) || 'Any time'}</span>
                <span className="ev green w2b-dayev">{bareTitle(m.title)}</span>
              </button>
            ))}
            {evs.map((e) => (
              <div key={e.id} className="w2b-dayrow">
                <span className="w2b-daytime">{eventTime(e, day)}</span>
                <span className="ev blue w2b-dayev" title={e.calendar ? `${e.title} (${e.calendar})` : e.title}>{e.title}</span>
                <button type="button" className="button small" onClick={() => makeNote(e, day)} title="A Meeting note for this event, linked here">
                  Make a meeting note
                </button>
              </div>
            ))}
            {due.map((t) => (
              <button key={t.key} type="button" className="w2b-dayrow" onClick={() => void A.openPath(t.path, { where: 'current' })} title={`${t.words} (open its note)`}>
                <span className="w2b-daytime">{t.time || 'Due'}</span>
                <span className={`ev ${taskTint(t.due!, today)} w2b-dayev`}>{t.words}</span>
              </button>
            ))}
          </>
        )}
      </div>
      <p className="vsub w2b-keys">Choosing a block opens the meeting in a side peek. Choosing a day opens its column here.</p>
    </div>
  );
}

/** The month with meetings, events and due tasks together (8.9, when sync is on). Six weeks, Monday first, the
 *  mock-up's shapes: weekday heads, today a coral dot, each block one line. A meeting opens in a peek, an event makes
 *  its note, a task opens its note. */
function SyncMonth({ meetings, events, tasks, today, onOpen }: { meetings: readonly Meet[]; events: readonly CalendarEvent[]; tasks: readonly VaultTask[]; today: string; onOpen(path: string): void }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const days = useMemo(() => monthGrid(`${ym.y}-${String(ym.m + 1).padStart(2, '0')}-15`), [ym.y, ym.m]);
  const makeNote = useMakeNote();
  const step = (n: number) => setYm(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));
  const heads = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="w2b-monthsync">
      <div className="monthbar">
        <button type="button" className="navbtn" aria-label="The month before" onClick={() => step(-1)}><Icon name="back" size={15} /></button>
        <b>{monthWords(`${ym.y}-${String(ym.m + 1).padStart(2, '0')}-15`, today)}</b>
        <button type="button" className="navbtn" aria-label="The month after" onClick={() => step(1)}><Icon name="forward" size={15} /></button>
        <button type="button" className="btn quiet" onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>Today</button>
      </div>
      <table aria-label="This month's meetings, events and tasks">
        <thead>
          <tr>{heads.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4, 5].map((w) => (
            <tr key={w}>
              {days.slice(w * 7, w * 7 + 7).map((d) => {
                const inMonth = d.slice(0, 7) === `${ym.y}-${String(ym.m + 1).padStart(2, '0')}`;
                const ms = meetingsOn(meetings, d);
                const es = events.filter((e) => eventDay(e) === d);
                const ts = tasks.filter((t) => !t.done && t.due === d);
                return (
                  <td key={d} className={inMonth ? '' : 'outside'}>
                    <div className={`d${d === today ? ' today' : ''}`}><span>{Number(d.slice(8, 10))}</span></div>
                    {ms.slice(0, 3).map((m) => (
                      <button key={m.path} type="button" className="ev amber w2b-ev" onClick={() => peek({ path: m.path }, { title: bareTitle(m.title), type: 'note' })} onDoubleClick={() => onOpen(m.path)} title={`${bareTitle(m.title)} (open the meeting)`}>
                        {bareTitle(m.title)}
                      </button>
                    ))}
                    {es.slice(0, 3).map((e) => (
                      <button key={e.id} type="button" className="ev blue w2b-ev" onClick={() => makeNote(e, d)} title={`${e.title} (make a meeting note)`}>
                        {e.title}
                      </button>
                    ))}
                    {ts.slice(0, 2).map((t) => (
                      <button key={t.key} type="button" className={`ev ${taskTint(t.due!, today)} w2b-ev`} onClick={() => void A.openPath(t.path, { where: 'current' })} title={`${t.words} (open its note)`}>
                        {t.words}
                      </button>
                    ))}
                    {ms.length + es.length + ts.length > Math.min(ms.length, 3) + Math.min(es.length, 3) + Math.min(ts.length, 2) && <div className="w2b-evtime">{ms.length - Math.min(ms.length, 3) + (es.length - Math.min(es.length, 3)) + (ts.length - Math.min(ts.length, 2))} more</div>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WeekCalendar({ meetings, today, onOpen, monthView, syncOn }: { meetings: readonly Meet[]; today: string; onOpen(path: string): void; monthView: ReactNode; syncOn?: boolean }) {
  const [mode, setMode] = useState<'month' | 'week' | 'day'>('week');
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const week = useMemo(() => weekOf(anchor), [anchor]);
  // Calendar events came through the former host app; on its own the Vault shows its meetings and due
  // tasks alone.
  const events: CalendarEvent[] = [];
  const monthEvents: CalendarEvent[] = [];
  const [tasks, setTasks] = useState<VaultTask[]>([]);
  const makeNote = useMakeNote();
  // Due tasks once while sync is on (the Tasks view keeps them; this only shows those with a day).
  useEffect(() => {
    if (!syncOn) {
      setTasks([]);
      return;
    }
    let live = true;
    void window.nv.tasks.view().then(
      (v) => live && setTasks(v.tasks),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [syncOn]);
  const shift = (n: number) => {
    const d = new Date(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)) - 1, Number(anchor.slice(8, 10)));
    d.setDate(d.getDate() + n);
    setAnchor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  };
  // In Day the chevrons move the day itself; otherwise they move the week.
  const step = (n: number) => {
    if (mode !== 'day') return shift(n * 7);
    const next = prevDay(selected, n);
    setSelected(next);
    setAnchor(next);
  };
  return (
    <div className="w2b-calwrap">
      <div className="w2b-calmain">
        <div className="cal">
          {/* The week/day chrome hides in month mode (p14, 4 Nov 2026: it stacked a dead "2 to 8 Nov" bar over the
              month's own; the month brings its own bar either way). */}
          <div className="monthbar">
            {mode !== 'month' && (
              <>
                <button type="button" className="navbtn" aria-label={mode === 'day' ? 'Earlier day' : 'Earlier week'} onClick={() => step(-1)}><Icon name="back" size={15} /></button>
                <b>{mode === 'day' ? dayColumnHead(selected) : weekRangeWords(week)}</b>
                <button type="button" className="navbtn" aria-label={mode === 'day' ? 'Later day' : 'Later week'} onClick={() => step(1)}><Icon name="forward" size={15} /></button>
                <button type="button" className="btn quiet" onClick={() => { setAnchor(today); setSelected(today); }}>Today</button>
              </>
            )}
            <span className="seg w2b-modes" role="tablist" aria-label="Month, week or day">
              {(['month', 'week', 'day'] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m.charAt(0).toUpperCase()}{m.slice(1)}</button>
              ))}
            </span>
          </div>
          {mode === 'month' ? (
            syncOn ? (
              <div className="w2b-monthview"><SyncMonth meetings={meetings} events={monthEvents} tasks={tasks} today={today} onOpen={onOpen} /></div>
            ) : (
              <div className="w2b-monthview">{monthView}</div>
            )
          ) : mode === 'day' ? (
            <div className="w2b-dayonly">
              <DayColumn day={selected} meetings={meetings} events={syncOn ? events : []} tasks={syncOn ? tasks : []} today={today} onOpen={onOpen} />
            </div>
          ) : (
            <table aria-label="This week's meetings">
              <thead>
                <tr>{week.map((d) => <th key={d} aria-label={dayColumnHead(d)}>{weekDayHead(d)}</th>)}</tr>
              </thead>
              <tbody>
                <tr>
                  {week.map((d) => (
                    <td key={d} className={`w2b-weekcell${d === selected ? ' is-selected' : ''}`} onClick={() => setSelected(d)}>
                      {d === today && <div className="d today"><span>{Number(d.slice(8, 10))}</span></div>}
                      {meetingsOn(meetings, d).map((m) => (
                        <div key={m.path}>
                          <button type="button" className="ev amber w2b-ev" onClick={(e) => { e.stopPropagation(); peek({ path: m.path }, { title: bareTitle(m.title), type: 'note' }); }} onDoubleClick={(e) => { e.stopPropagation(); onOpen(m.path); }} title={`${bareTitle(m.title)}${m.time ? `, ${meetingTimeWords(m.time)}` : ''} (open the meeting)`}>
                            {bareTitle(m.title)}
                          </button>
                          {m.time ? <div className="w2b-evtime">{meetingTimeWords(m.time)}</div> : null}
                        </div>
                      ))}
                      {syncOn && events.filter((e) => eventDay(e) === d).map((e) => (
                        <div key={e.id}>
                          <button type="button" className="ev blue w2b-ev" onClick={(ev) => { ev.stopPropagation(); makeNote(e, d); }} title={`${e.title} (make a meeting note)`}>
                            {e.title}
                          </button>
                          <div className="w2b-evtime">{eventTime(e, d)}</div>
                        </div>
                      ))}
                      {syncOn && tasks.filter((t) => !t.done && t.due === d).slice(0, 4).map((t) => (
                        <div key={t.key}>
                          <button type="button" className={`ev ${taskTint(t.due!, today)} w2b-ev`} onClick={(ev) => { ev.stopPropagation(); void A.openPath(t.path, { where: 'current' }); }} title={`${t.words} (open its note)`}>
                            {t.words}
                          </button>
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
      {mode === 'week' && (
        <DayColumn day={selected} meetings={meetings} events={syncOn ? events : []} tasks={syncOn ? tasks : []} today={today} onOpen={onOpen} />
      )}
    </div>
  );
}

function prevDay(iso: string, n: number): string {
  const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
