// Today's week strip (20 Oct 2026, "Ironleaf Calm"): Monday to Sunday with today marked and the chosen day lifted, a
// small dot under each day that has its note, a meeting or something due; opened, the month as a calendar (six weeks, so
// it never changes height). Choosing a day shows that day's hub. The arrows on either side move a week (a month when
// open); ← and → move a day and T comes back to today (TodayView), ↑ and ↓ move a week while the strip has the focus.

import { useRef } from 'react';
import { addDays, dateOf, isoOf, longDay, monthGrid, monthWords, nearWords, weekOf, type DayMark } from '../../../../shared/hub';
import { Icon } from '../../components/Icon';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The same day a month on (31 October back a month is 30 September). */
function monthOn(iso: string, n: number): string {
  const d = dateOf(iso);
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return isoOf(new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last)));
}

export interface WeekStripProps {
  selected: string;
  today: string;
  marks: Record<string, DayMark>;
  open: boolean;
  onOpen(open: boolean): void;
  onSelect(iso: string): void;
}

export function WeekStrip({ selected, today, marks, open, onOpen, onSelect }: WeekStripProps) {
  const grid = useRef<HTMLDivElement>(null);
  const days = open ? monthGrid(selected) : weekOf(selected);
  const month = dateOf(selected).getMonth();
  const step = (n: number) => onSelect(open ? monthOn(selected, n) : addDays(selected, 7 * n));
  // The chosen day keeps the focus as it moves (the keys), so the strip reads as one control.
  const focusSoon = (iso: string) => requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-day="${iso}"]`)?.focus());
  const move = (n: number) => {
    const next = addDays(selected, n);
    onSelect(next);
    focusSoon(next);
  };
  const weekWords = () => {
    const w = weekOf(selected);
    const a = dateOf(w[0]);
    const b = dateOf(w[6]);
    const name = (d: Date) => d.toLocaleString('en-AU', { month: 'short' });
    return a.getMonth() === b.getMonth() ? monthWords(selected, today) : `${a.getDate()} ${name(a)} – ${b.getDate()} ${name(b)}`;
  };

  return (
    <section className={`th-strip${open ? ' is-month' : ''}`} aria-label="Choose a day">
      <header className="th-strip-head">
        <button className="th-icon-btn" onClick={() => step(-1)} title={open ? 'The month before' : 'The week before'} aria-label={open ? 'The month before' : 'The week before'}>
          <Icon name="back" size={14} />
        </button>
        <h2 className="th-strip-title" aria-live="polite">
          {open ? monthWords(selected, today) : weekWords()}
        </h2>
        <button className="th-icon-btn" onClick={() => step(1)} title={open ? 'The month after' : 'The week after'} aria-label={open ? 'The month after' : 'The week after'}>
          <Icon name="forward" size={14} />
        </button>
        <span className="th-strip-space" />
        {selected !== today && (
          <button className="th-pill-btn" onClick={() => onSelect(today)} title="Back to today (T)">
            Today
          </button>
        )}
        <button className="th-pill-btn quiet" aria-expanded={open} onClick={() => onOpen(!open)} title={open ? 'Just this week' : 'The whole month'}>
          {open ? 'Week' : 'Month'}
          <Icon name={open ? 'collapse' : 'expand'} size={12} />
        </button>
      </header>
      {open && (
        <div className="th-dow-row" aria-hidden="true">
          {DOW.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
      )}
      <div
        className="th-days"
        ref={grid}
        role="group"
        onKeyDown={(e) => {
          if (e.altKey || e.ctrlKey || e.metaKey) return;
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            move(e.key === 'ArrowUp' ? -7 : 7);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            move(e.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
      >
        {days.map((iso) => {
          const d = dateOf(iso);
          const m = marks[iso];
          const isToday = iso === today;
          const isSelected = iso === selected;
          const outside = open && d.getMonth() !== month;
          const said = [nearWords(iso, today) === 'Today' ? 'today' : '', m?.note ? 'has its note' : '', m?.meetings ? `${m.meetings} ${m.meetings === 1 ? 'meeting' : 'meetings'}` : '', m?.due ? `${m.due} due` : ''].filter(Boolean).join(', ');
          return (
            <button
              key={iso}
              data-day={iso}
              className={`th-day${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${outside ? ' is-outside' : ''}${iso < today ? ' is-past' : ''}`}
              aria-pressed={isSelected}
              aria-current={isToday ? 'date' : undefined}
              aria-label={`${longDay(iso, today)}${said ? `, ${said}` : ''}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onSelect(iso)}
            >
              {!open && <span className="th-dow">{DOW[(d.getDay() + 6) % 7]}</span>}
              <span className="th-num">{d.getDate()}</span>
              <span className="th-dots" aria-hidden="true">
                {m?.note && <i className="th-dot note" />}
                {!!m?.meetings && <i className="th-dot meeting" />}
                {!!m?.due && <i className="th-dot due" />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
