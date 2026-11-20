// Records on a timeline and a month calendar (24 Oct 2026, Workstream 1 part D). Any records with a day (actions by when
// they're due, milestones, meetings, updates, a register's checks) laid out in time: the timeline groups them in lanes
// (by the view's group, else one lane), zooms week / month / quarter, marks today, and moves a record to another day by
// dragging its mark; the calendar shows a month, and a record dragged to another day moves there. A project's own Plan
// uses part C's plan timeline (views/project/PlanTimeline.tsx) for its workstreams and milestones.

import { useEffect, useMemo, useRef, useState } from 'react';
import { fieldLabel, type RecordRun, type RecordViewDef } from '../../../../shared/record-views';
import type { WsRecord } from '../../../../shared/workspace-records';
import { Icon } from '../../components/Icon';
import { dayWords, endDrag, isDoneRecord, startDrag, toneOf, useRecords, KIND_ICON } from './recordParts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 864e5;
const toDay = (iso: string) => Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY);
const isoOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
const todayDay = () => {
  const d = new Date();
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
};

type Zoom = 'week' | 'month' | 'quarter';
const PPD: Record<Zoom, number> = { week: 30, month: 8, quarter: 2.6 };
const ZOOM_WORDS: Record<Zoom, string> = { week: 'Weeks', month: 'Months', quarter: 'Quarters' };

interface Props {
  def: RecordViewDef;
  run: RecordRun;
  change(patch: Partial<RecordViewDef>): void;
}

function dated(run: RecordRun, field: string) {
  return run.rows.filter((r) => typeof r.fields[field] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(r.fields[field])));
}

// ── Timeline ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function TimelineLayout({ def, run }: Props) {
  const ctx = useRecords();
  const field = def.dateField ?? 'date';
  const [zoom, setZoom] = useState<Zoom>('month');
  const rows = dated(run, field);
  const today = todayDay();
  const days = rows.map((r) => toDay(String(r.fields[field])));
  const from = Math.min(today, ...days) - (zoom === 'week' ? 4 : zoom === 'month' ? 10 : 24);
  const to = Math.max(today, ...days) + (zoom === 'week' ? 6 : zoom === 'month' ? 18 : 40);
  // The scale fills the width (t272, 13 Nov 2026: a narrow span left the timeline's right side empty):
  // the zoom's pace is the minimum, and a span narrower than the scroller spreads to fill it. Days keep
  // honest gaps (the scale stays linear) and dragging still moves by days.
  const [fit, setFit] = useState(0);
  const span = Math.max(1, to - from);
  const ppd = fit > 0 ? Math.max(PPD[zoom], fit / span) : PPD[zoom];
  const width = Math.max(320, span * ppd);
  const lanes = useMemo(() => {
    const by = new Map<string, WsRecord[]>();
    const key = (r: WsRecord) => (def.groupBy ? String(r.fields[def.groupBy] ?? '') || `No ${fieldLabel(def.groupBy).toLowerCase()}` : '');
    for (const r of rows) {
      const k = key(r);
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(r);
    }
    return [...by.entries()].map(([k, list]) => ({ key: k, list: list.sort((a, b) => String(a.fields[field]).localeCompare(String(b.fields[field]))) }));
  }, [rows, def.groupBy, field]);
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
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setFit(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [moving, setMoving] = useState<{ id: string; dx: number } | null>(null);
  if (!rows.length)
    return (
      <div className="ws-hint-box">
        <Icon name="timeline" size={18} />
        <p>Nothing here has a {fieldLabel(field).toLowerCase()} yet, so there’s nothing to put on a timeline.</p>
      </div>
    );
  const drag = (r: WsRecord, e: React.PointerEvent) => {
    if (!ctx.canEdit || !ctx.editable(r).includes(field) || e.button !== 0) return;
    const startX = e.clientX;
    let moved = false;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      if (moved) setMoving({ id: r.id, dx });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      setMoving(null);
      if (!moved) return;
      const shift = Math.round((ev.clientX - startX) / ppd);
      if (shift) void ctx.setField(r, field, isoOf(toDay(String(r.fields[field])) + shift));
      // The click that follows a drag doesn't open the record.
      el.dataset.dragged = '1';
      window.setTimeout(() => delete el.dataset.dragged, 50);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <div className="ws-timeline">
      <div className="ws-tl-tools">
        <div className="ws-seg" role="radiogroup" aria-label="Zoom">
          {(['week', 'month', 'quarter'] as Zoom[]).map((z) => (
            <button key={z} type="button" role="radio" aria-checked={zoom === z} className={zoom === z ? 'is-on' : ''} onClick={() => setZoom(z)}>
              {ZOOM_WORDS[z]}
            </button>
          ))}
        </div>
        <button type="button" className="ws-quiet" onClick={() => scroller.current?.scrollTo({ left: Math.max(0, (today - from) * ppd - 160), behavior: 'smooth' })}>
          Today
        </button>
        {ctx.canEdit && <span className="ws-faint ws-tl-help">Drag a mark to move its day</span>}
      </div>
      <div
        className="ws-tl-scroll"
        ref={(el) => {
          scroller.current = el;
          if (el && !el.dataset.placed) {
            el.dataset.placed = '1';
            el.scrollLeft = Math.max(0, (today - from) * ppd - 160);
          }
        }}
      >
        <div className="ws-tl-canvas" style={{ width }}>
          <div className="ws-tl-ticks">
            {ticks.map((t) => (
              <span key={t.x} className={`ws-tl-tick${t.major ? ' is-major' : ''}`} style={{ left: t.x }}>
                {t.words}
              </span>
            ))}
          </div>
          <div className="ws-tl-today" style={{ left: (today - from) * ppd }}>
            <span>Today</span>
          </div>
          {lanes.map((lane) => (
            <div key={lane.key || 'all'} className="ws-tl-lane">
              {lane.key && <div className="ws-tl-lane-name">{lane.key}</div>}
              {lane.list.map((r) => {
                const d = toDay(String(r.fields[field]));
                const late = d < today && !isDoneRecord(r) && (r.kind === 'action' || r.kind === 'milestone');
                const tone = isDoneRecord(r) ? 'ok' : late ? 'bad' : toneOf(r.fields.status ?? null);
                const dx = moving?.id === r.id ? moving.dx : 0;
                return (
                  <div key={r.id} className="ws-tl-row">
                    <button
                      type="button"
                      className={`ws-tl-mark kind-${r.kind} tone-${tone}${dx ? ' is-moving' : ''}`}
                      style={{ left: (d - from) * ppd + dx }}
                      title={`${r.title} · ${dayWords(String(r.fields[field]))}`}
                      onPointerDown={(e) => drag(r, e)}
                      onClick={(e) => {
                        if ((e.currentTarget as HTMLElement).dataset.dragged) return;
                        ctx.open(r, e);
                      }}
                    >
                      <span className={`ws-tl-dot${r.kind === 'milestone' ? ' is-diamond' : ''}`} />
                      <span className="ws-tl-words">{r.title}</span>
                      <span className="ws-tl-day">{dx ? dayWords(isoOf(d + Math.round(dx / ppd))) : dayWords(String(r.fields[field]))}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Calendar ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function CalendarLayout({ def, run }: Props) {
  const ctx = useRecords();
  const field = def.dateField ?? 'date';
  const rows = dated(run, field);
  const now = new Date();
  // Opens on the month with the next thing in it (this month when it has something).
  const first = useMemo(() => {
    const t = isoOf(todayDay()).slice(0, 7);
    const months = rows.map((r) => String(r.fields[field]).slice(0, 7)).sort();
    return months.includes(t) || !months.length ? t : (months.find((m) => m >= t) ?? months[months.length - 1]);
  }, []);
  const [month, setMonth] = useState(first ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [over, setOver] = useState<string | null>(null);
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1;
  const start = new Date(Date.UTC(y, m, 1));
  const lead = (start.getUTCDay() + 6) % 7; // Monday first
  const startDay = Math.round(start.getTime() / DAY) - lead;
  const cells = Array.from({ length: 42 }, (_, i) => startDay + i);
  const byDay = new Map<string, WsRecord[]>();
  for (const r of rows) {
    const k = String(r.fields[field]);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const today = isoOf(todayDay());
  const weeks = cells[35] && isoOf(cells[35]).slice(0, 7) !== month ? 5 : 6;
  return (
    <div className="ws-calendar">
      <div className="ws-cal-head">
        <button type="button" className="icon-button" aria-label="Month before" onClick={() => shift(-1)}>
          <Icon name="back" size={14} />
        </button>
        <h4>
          {MONTHS[m]} {y}
        </h4>
        <button type="button" className="icon-button" aria-label="Month after" onClick={() => shift(1)}>
          <Icon name="forward" size={14} />
        </button>
        <button type="button" className="ws-quiet" onClick={() => setMonth(today.slice(0, 7))}>
          Today
        </button>
      </div>
      <div className="ws-cal-grid" style={{ gridTemplateRows: `auto repeat(${weeks}, minmax(86px, auto))` }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="ws-cal-dow">
            {d}
          </div>
        ))}
        {cells.slice(0, weeks * 7).map((d) => {
          const iso = isoOf(d);
          const list = byDay.get(iso) ?? [];
          return (
            <div
              key={iso}
              className={`ws-cal-day${iso.slice(0, 7) !== month ? ' is-other' : ''}${iso === today ? ' is-today' : ''}${over === iso ? ' is-over' : ''}`}
              onDragOver={(e) => {
                const id = e.dataTransfer.types.includes('application/x-nv-record');
                if (!id || !ctx.canEdit) return;
                e.preventDefault();
                setOver(iso);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                setOver(null);
                const id = e.dataTransfer.getData('application/x-nv-record');
                const r = ctx.byId.get(id);
                endDrag();
                if (r && ctx.editable(r).includes(field) && String(r.fields[field]) !== iso) {
                  e.preventDefault();
                  void ctx.setField(r, field, iso);
                }
              }}
            >
              <span className="ws-cal-n">{Number(iso.slice(8, 10))}</span>
              {list.slice(0, 4).map((r) => (
                <button key={r.id} type="button" className={`ws-cal-item kind-${r.kind} tone-${isDoneRecord(r) ? 'ok' : iso < today && (r.kind === 'action' || r.kind === 'milestone') ? 'bad' : 'none'}`} draggable={ctx.canEdit && ctx.editable(r).includes(field)} onDragStart={(e) => startDrag(e, r)} onDragEnd={endDrag} onClick={(e) => ctx.open(r, e)} title={r.title}>
                  <span className="ws-cal-icon">
                    <Icon name={KIND_ICON[r.kind]} size={10} />
                  </span>
                  <span className="ws-cal-words">{r.title}</span>
                </button>
              ))}
              {list.length > 4 && <span className="ws-cal-more">{list.length - 4} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
