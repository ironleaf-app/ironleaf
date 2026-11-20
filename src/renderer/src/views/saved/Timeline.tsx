// A view as a timeline (10.0 Endless Tech, v10records2; src/shared/views.ts
// placeOnTimeline): each note as a mark on its day, or a bar from its first day
// to its last when the view names an end property. Lanes follow the view's
// grouping when it has one, else one lane. Zooms weeks, months, quarters, marks
// today, and moves a note to another day by dragging its mark (a range keeps its
// length). Notes without a day wait in the tray beside the line.

import { useMemo, useRef, useState } from 'react';
import { isoDay } from '../../../../shared/days';
import { movedDate, placeOnTimeline, propWords, valueOf, type KnownProp, type ViewDef, type ViewRow } from '../../../../shared/views';
import { Icon } from '../../components/Icon';
import { FIRST, openNote, type WriteProp } from './common';

interface Props {
  def: ViewDef;
  rows: ViewRow[];
  known: Map<string, KnownProp>;
  canEdit: boolean;
  write: WriteProp;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 864e5;
const toDay = (iso: string) => Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY);
// Day numbers count calendar days (toDay reads the date's own parts), so the day back out is read the same way.
const two = (n: number) => String(n).padStart(2, '0');
const isoOf = (day: number) => { const d = new Date(day * DAY); return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`; };
const todayDay = () => {
  const d = new Date();
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
};
const dayWords = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
};

type Zoom = 'week' | 'month' | 'quarter';
const PPD: Record<Zoom, number> = { week: 30, month: 8, quarter: 2.6 };
const ZOOM_WORDS: Record<Zoom, string> = { week: 'Weeks', month: 'Months', quarter: 'Quarters' };

export function TimelineLayout({ def, rows, canEdit: mayEdit, write }: Props) {
  const prop = def.dateProp!;
  const endProp = def.endProp;
  const canEdit = mayEdit;
  const [zoom, setZoom] = useState<Zoom>('month');
  const { spans, undated } = useMemo(() => placeOnTimeline(rows, prop, endProp), [rows, prop, endProp]);
  const today = todayDay();
  const days = spans.flatMap((s) => [toDay(s.start), toDay(s.end)]);
  const from = Math.min(today, ...days) - (zoom === 'week' ? 4 : zoom === 'month' ? 10 : 24);
  const to = Math.max(today, ...days) + (zoom === 'week' ? 6 : zoom === 'month' ? 18 : 40);
  const ppd = PPD[zoom];
  const width = Math.max(320, (to - from) * ppd);
  const laneBy = def.sectionBy?.prop ?? def.groupBy ?? '';
  const lanes = useMemo(() => {
    const by = new Map<string, typeof spans>();
    const key = (s: (typeof spans)[number]) => (laneBy ? String(valueOf(s.row, laneBy) ?? '') || `No ${propWords(laneBy).toLowerCase()}` : '');
    for (const s of spans) {
      const k = key(s);
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(s);
    }
    return [...by.entries()].map(([k, list]) => ({ key: k, list }));
  }, [spans, laneBy]);
  const ticks = useMemo(() => {
    const out: { x: number; words: string; major: boolean }[] = [];
    for (let d = from; d <= to; d++) {
      const iso = isoOf(d);
      const dt = new Date(d * DAY);
      if (zoom === 'week' && dt.getUTCDay() === 1) out.push({ x: (d - from) * ppd, words: `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`, major: dt.getUTCDate() <= 7 });
      if (zoom !== 'week' && iso.endsWith('-01') && (zoom === 'month' || dt.getUTCMonth() % 3 === 0)) out.push({ x: (d - from) * ppd, words: `${MONTHS[dt.getUTCMonth()]}${dt.getUTCMonth() === 0 || out.length === 0 ? ` ${dt.getUTCFullYear()}` : ''}`, major: true });
    }
    return out;
  }, [from, to, zoom, ppd]);
  const scroller = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState<{ path: string; dx: number } | null>(null);

  if (!spans.length)
    return (
      <div className="sv-timeline-empty">
        <Icon name="timeline" size={18} />
        <p>Nothing here has a {propWords(prop).toLowerCase()} yet, so there is nothing to put on a timeline.</p>
        {undated.length > 0 && <p className="sv-faint">{undated.length} {undated.length === 1 ? 'note waits' : 'notes wait'} below without one.</p>}
      </div>
    );

  const moveTo = (row: ViewRow, shift: number) => {
    if (!shift) return;
    const start = valueOf(row, prop);
    const startIso = typeof start === 'string' && /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : isoDay(new Date());
    write(row.path, prop, movedDate(start, isoOf(toDay(startIso) + shift)));
    if (endProp) {
      const end = valueOf(row, endProp);
      if (typeof end === 'string' && /^\d{4}-\d{2}-\d{2}/.test(end)) write(row.path, endProp, movedDate(end, isoOf(toDay(end.slice(0, 10)) + shift)));
    }
  };
  const drag = (row: ViewRow, e: React.PointerEvent) => {
    if (!canEdit || e.button !== 0) return;
    const startX = e.clientX;
    let moved = false;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      if (moved) setMoving({ path: row.path, dx });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      setMoving(null);
      if (!moved) return;
      moveTo(row, Math.round((ev.clientX - startX) / ppd));
      el.dataset.dragged = '1';
      window.setTimeout(() => delete el.dataset.dragged, 50);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <div className="sv-timeline">
      <div className="sv-tl-tools">
        <div className="sv-tl-seg" role="radiogroup" aria-label="Zoom">
          {(['week', 'month', 'quarter'] as Zoom[]).map((z) => (
            <button key={z} type="button" role="radio" aria-checked={zoom === z} className={zoom === z ? 'is-on' : ''} onClick={() => setZoom(z)}>
              {ZOOM_WORDS[z]}
            </button>
          ))}
        </div>
        <button type="button" className="sv-tool" onClick={() => scroller.current?.scrollTo({ left: Math.max(0, (today - from) * ppd - 160), behavior: 'smooth' })}>
          Today
        </button>
        {canEdit && <span className="sv-faint">Drag a mark to move its day</span>}
      </div>
      <div
        className="sv-tl-scroll"
        ref={(el) => {
          scroller.current = el;
          if (el && !el.dataset.placed) {
            el.dataset.placed = '1';
            el.scrollLeft = Math.max(0, (today - from) * ppd - 160);
          }
        }}
      >
        <div className="sv-tl-canvas" style={{ width }}>
          <div className="sv-tl-ticks">
            {ticks.map((t) => (
              <span key={t.x} className={`sv-tl-tick${t.major ? ' is-major' : ''}`} style={{ left: t.x }}>
                {t.words}
              </span>
            ))}
          </div>
          <div className="sv-tl-today" style={{ left: (today - from) * ppd }}>
            <span>Today</span>
          </div>
          {lanes.map((lane) => (
            <div key={lane.key || 'all'} className="sv-tl-lane">
              {lane.key && <div className="sv-tl-lane-name">{lane.key}</div>}
              {lane.list.map((s) => {
                const d = toDay(s.start);
                const e = toDay(s.end);
                const dx = moving?.path === s.row.path ? moving.dx : 0;
                const ranged = e > d;
                const w = ranged ? Math.max(24, (e - d + 1) * ppd) : undefined;
                return (
                  <div key={s.row.path} className="sv-tl-row">
                    <button
                      type="button"
                      className={`sv-tl-mark${ranged ? ' is-range' : ''}${dx ? ' is-moving' : ''}`}
                      style={{ left: (d - from) * ppd + dx, ...(w ? { width: w } : {}) }}
                      title={`${s.row.title} · ${dayWords(s.start)}${ranged ? ` to ${dayWords(s.end)}` : ''}`}
                      onPointerDown={(ev) => drag(s.row, ev)}
                      onClick={(ev) => {
                        if ((ev.currentTarget as HTMLElement).dataset.dragged) return;
                        openNote(s.row.path, ev);
                      }}
                      onAuxClick={(ev) => ev.button === 1 && openNote(s.row.path, ev)}
                    >
                      <span className="sv-tl-dot" />
                      <span className="sv-tl-words">{s.row.title}</span>
                      <span className="sv-tl-day">{dx ? dayWords(isoOf(d + Math.round(dx / ppd))) : dayWords(s.start)}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {undated.length > 0 && (
        <aside className="sv-tl-tray" aria-label="Notes with no date">
          <div className="sv-tray-head">
            <span>No date</span>
            <span className="sv-count">{undated.length}</span>
          </div>
          <p className="sv-tray-hint">These notes have no {propWords(prop).toLowerCase()} yet.</p>
          <div className="sv-tray-cards">
            {undated.slice(0, FIRST.timeline).map((r) => (
              <button key={r.path} type="button" className="sv-tl-undated" onClick={(e) => openNote(r.path, e)} title={`Open ${r.title}`}>
                {r.title}
              </button>
            ))}
            {undated.length > FIRST.timeline && <p className="sv-tray-hint">And {undated.length - FIRST.timeline} more.</p>}
          </div>
        </aside>
      )}
    </div>
  );
}
