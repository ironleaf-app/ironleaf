// A view as a month calendar (src/shared/views.ts monthGrid, placeOnDays): each note on the day its date property says,
// Monday first; the month before and after, and back to today. A note dragged to another day — or moved with Alt and an
// arrow key (a day, or a week up and down) — has its day written the way it was written, its time kept. Notes without a
// day wait in the "No date" tray beside the month; dropping one back on the tray takes its day off.

import { useMemo, useState } from 'react';
import type { PropValue } from '../../../../shared/frontmatter';
import { isoDay } from '../../../../shared/days';
import { isField, monthGrid, monthWords, movedDate, placeOnDays, propWords, shiftIso, valueOf, type KnownProp, type ViewDef, type ViewRow } from '../../../../shared/views';
import { Icon } from '../../components/Icon';
import { fileMenu } from '../../state/menus';
import { openMenu } from '../../components/Menu';
import { FIRST, isNoteDrag, NoteCard, readDragged, type WriteProp } from './common';

interface Props {
  def: ViewDef;
  rows: ViewRow[];
  known: Map<string, KnownProp>;
  canEdit: boolean;
  write: WriteProp;
  newNote(values: Record<string, PropValue>): void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NO_DATE = 'no-date';

export function CalendarLayout({ def, rows, known, canEdit: mayEdit, write, newNote }: Props) {
  const prop = def.dateProp!;
  // A day from a formula (21 Oct 2026) is worked out, not written: notes stay on their day.
  const canEdit = mayEdit && !isField(prop);
  const todayIso = isoDay(new Date());
  const [month, setMonth] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() }));
  const [over, setOver] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const weeks = useMemo(() => monthGrid(month.y, month.m, todayIso), [month.y, month.m, todayIso]);
  const { byDay, undated } = useMemo(() => placeOnDays(rows, prop), [rows, prop]);
  const inMonth = weeks.flat().reduce((n, d) => n + (d.inMonth ? (byDay.get(d.iso)?.length ?? 0) : 0), 0);
  const byPath = useMemo(() => new Map(rows.map((r) => [r.path, r])), [rows]);

  const step = (by: number) => setMonth(({ y, m }) => ({ y: m + by < 0 ? y - 1 : m + by > 11 ? y + 1 : y, m: (m + by + 12) % 12 }));
  /** A note put on a day (or back in the tray, which takes its day off). */
  const moveTo = (path: string, iso: string | null) => {
    const row = byPath.get(path);
    if (!row) return;
    write(path, prop, iso ? movedDate(valueOf(row, prop), iso) : null);
    if (iso) {
      const [y, m] = iso.split('-').map(Number);
      if (y !== month.y || m - 1 !== month.m) setMonth({ y, m: m - 1 });
    }
    requestAnimationFrame(() => (document.querySelector(`.sv-calendar [data-path="${CSS.escape(path)}"]`) as HTMLElement | null)?.focus());
  };
  const keys = (row: ViewRow, iso: string | null) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!e.altKey || !canEdit || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const by = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -7 : 7;
    moveTo(row.path, shiftIso(iso ?? todayIso, iso ? by : 0));
  };
  const drop = (target: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!canEdit || !isNoteDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== target) setOver(target);
    },
    onDragLeave: (e: React.DragEvent) => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node) && setOver((o) => (o === target ? null : o)),
    onDrop: (e: React.DragEvent) => {
      setOver(null);
      const d = readDragged(e);
      if (!d || !canEdit || d.from === target) return;
      e.preventDefault();
      moveTo(d.path, target === NO_DATE ? null : target);
    },
  });
  const cardMenu = (row: ViewRow, iso: string | null) => (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e, [
      { label: 'Move to today', icon: 'calendar', disabled: !canEdit || iso === todayIso, run: () => moveTo(row.path, todayIso) },
      { label: 'A day later', icon: 'forward', disabled: !canEdit || !iso, hint: 'Alt+→', run: () => iso && moveTo(row.path, shiftIso(iso, 1)) },
      { label: 'A week later', icon: 'forward', disabled: !canEdit || !iso, hint: 'Alt+↓', run: () => iso && moveTo(row.path, shiftIso(iso, 7)) },
      { separator: true },
      { label: `Take its ${propWords(prop).toLowerCase()} off`, icon: 'close', disabled: !canEdit || !iso, run: () => moveTo(row.path, null) },
      { separator: true },
      ...fileMenu(row.path),
    ]);
  };
  const dayName = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="sv-calendar">
      <div className="sv-month">
        <div className="sv-month-head">
          <h2 className="sv-month-name" aria-live="polite">
            {monthWords(month.y, month.m)}
          </h2>
          <span className="sv-faint">
            {inMonth} {inMonth === 1 ? 'note' : 'notes'} by {propWords(prop).toLowerCase()}
          </span>
          <span className="sv-grow" />
          <div className="sv-month-nav">
            <button type="button" className="icon-button" aria-label="The month before" title="The month before" onClick={() => step(-1)}>
              <Icon name="back" size={15} />
            </button>
            <button type="button" className="sv-tool" onClick={() => setMonth({ y: new Date().getFullYear(), m: new Date().getMonth() })}>
              Today
            </button>
            <button type="button" className="icon-button" aria-label="The month after" title="The month after" onClick={() => step(1)}>
              <Icon name="forward" size={15} />
            </button>
          </div>
        </div>
        <div className="sv-grid" role="grid" aria-label={monthWords(month.y, month.m)} style={{ ['--weeks' as string]: weeks.length }}>
          <div className="sv-weekdays" role="row">
            {WEEKDAYS.map((d) => (
              <span key={d} role="columnheader">
                {d}
              </span>
            ))}
          </div>
          {weeks.map((w) => (
            <div key={w[0].iso} className="sv-week" role="row">
              {w.map((d) => {
                const notes = byDay.get(d.iso) ?? [];
                const all = open === d.iso;
                const shown = all ? notes : notes.slice(0, FIRST.day);
                return (
                  <div
                    key={d.iso}
                    role="gridcell"
                    aria-label={`${dayName(d.iso)}${notes.length ? `, ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}` : ''}`}
                    className={`sv-day${d.inMonth ? '' : ' outside'}${d.weekend ? ' weekend' : ''}${d.today ? ' today' : ''}${over === d.iso ? ' is-over' : ''}${all ? ' is-open' : ''}`}
                    onDoubleClick={(e) => canEdit && e.target === e.currentTarget && newNote({ [prop]: d.iso })}
                    {...drop(d.iso)}
                  >
                    <div className="sv-day-head">
                      <span className="sv-day-number">{d.date}</span>
                      {canEdit && (
                        <button type="button" className="sv-day-add" aria-label={`New note on ${dayName(d.iso)}`} title="New note on this day" onClick={() => newNote({ [prop]: d.iso })}>
                          <Icon name="plus" size={12} />
                        </button>
                      )}
                    </div>
                    {shown.map((r) => (
                      <NoteCard key={r.path} row={r} cardProps={def.cardProps.slice(0, 1)} known={known} compact draggable={canEdit} from={d.iso} onKeyDown={keys(r, d.iso)} menu={cardMenu(r, d.iso)} />
                    ))}
                    {notes.length > FIRST.day && (
                      <button type="button" className="sv-day-more" aria-expanded={all} onClick={() => setOpen(all ? null : d.iso)}>
                        {all ? 'Show fewer' : `${notes.length - FIRST.day} more`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <aside className={`sv-tray${over === NO_DATE ? ' is-over' : ''}`} aria-label="Notes with no date" {...drop(NO_DATE)}>
        <div className="sv-tray-head">
          <span>No date</span>
          <span className="sv-count">{undated.length}</span>
        </div>
        <p className="sv-tray-hint">{undated.length ? (canEdit ? 'Drag a note onto a day to give it one.' : 'These notes have no day yet.') : `Every note has a ${propWords(prop).toLowerCase()}.`}</p>
        <div className="sv-tray-cards">
          {undated.slice(0, 200).map((r) => (
            <NoteCard key={r.path} row={r} cardProps={def.cardProps.slice(0, 1)} known={known} compact draggable={canEdit} from={NO_DATE} onKeyDown={keys(r, null)} menu={cardMenu(r, null)} />
          ))}
          {undated.length > 200 && <p className="sv-tray-hint">And {undated.length - 200} more.</p>}
        </div>
      </aside>
    </div>
  );
}
