// A project's Timeline (23 Oct 2026, workstream 1 part C; replaces the strip of packed marks). One line for each
// milestone and dated action, grouped by workstream (or the run sheet's phases), the group's span drawn faintly on its
// heading; today marked; overdue in one colour; what a line comes after drawn to it; Week, Month and Quarter zooms. A
// mark drags to another day (or moves with the arrow keys) and the date is written the way it was, with Undo; a click
// opens the item. The plan itself is worked out by src/shared/project-plan.ts.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../../../../shared/project-file';
import { rescheduleEdit, type ItemRef } from '../../../../shared/project-hub';
import { PLAN_PPD, PLAN_ZOOM_WORDS, PLAN_ZOOMS, planOf, planRange, planTicks, type PlanGroup, type PlanItem, type PlanZoom } from '../../../../shared/project-plan';
import { longDay, shortDay, todayDay, ymd } from '../../../../shared/timeline';
import { Icon } from '../../components/Icon';
import { useEditor } from './Inline';
import { useProjectMemory } from './memory';
import { useConnected } from './hubOpen';

const LABEL = 320;
const ROW = 32;
const HEAD = 38;
const plain = (s: string) => s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1');

interface Drag {
  id: string;
  day: number;
  startX: number;
  moved: boolean;
  keys?: boolean;
}

export function PlanTimeline({ p, onOpen }: { p: Project; onOpen(ref: ItemRef, title: string, e?: React.MouseEvent): void }) {
  const { canEdit, edit, path } = useEditor();
  const [mem, remember] = useProjectMemory(path);
  const zoom: PlanZoom = mem.planZoom ?? 'month';
  const shut = new Set(mem.planShut ?? []);
  const today = todayDay();
  // Dated actions written in the project's meetings and notes show too (read-only here: they're changed where written).
  const connected = useConnected(path);
  const plan = useMemo(() => planOf(p, today, connected?.me ?? '', connected?.elsewhere ?? []), [p, today, connected]);
  const { from, to } = useMemo(() => planRange(plan, zoom, today), [plan, zoom, today]);
  const ppd = PLAN_PPD[zoom];
  const width = (to - from + 1) * ppd;
  const scale = useMemo(() => planTicks(from, to, zoom), [from, to, zoom]);
  const body = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const keyTimer = useRef(0);
  const x = (day: number) => (day - from) * ppd + ppd / 2;

  // Today a fifth of the way in, when the plan opens and when the zoom changes.
  const scrollToday = (smooth = false) => {
    const el = body.current;
    if (!el) return;
    const label = el.querySelector<HTMLElement>('.pt-corner')?.offsetWidth ?? LABEL;
    el.scrollTo({ left: Math.max(0, x(today) - (el.clientWidth - label) * 0.2), behavior: smooth ? 'smooth' : 'auto' });
  };
  useLayoutEffect(() => scrollToday(), [zoom, path]);

  // What part of the track shows (scrolled sideways): a line's day out of sight is pinned at that edge.
  const [view, setView] = useState({ left: 0, width: 0 });
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const label = el.querySelector<HTMLElement>('.pt-corner')?.offsetWidth ?? LABEL;
      setView((v) => (v.left === el.scrollLeft && v.width === el.clientWidth - label ? v : { left: el.scrollLeft, width: el.clientWidth - label }));
    };
    const soon = () => void (raf ||= requestAnimationFrame(read));
    // The window made narrower or wider: today stays where it was in what shows (a fifth of the way in).
    const resized = () => {
      scrollToday();
      soon();
    };
    read();
    el.addEventListener('scroll', soon, { passive: true });
    window.addEventListener('resize', resized);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', soon);
      window.removeEventListener('resize', resized);
    };
  }, [zoom, path, plan.count]);
  const bringIn = (day: number) => body.current?.scrollTo({ left: Math.max(0, x(day) - view.width * 0.2), behavior: 'smooth' });

  // Rows: each group's heading, then its items (a folded group shows its heading only).
  const rows = useMemo(() => {
    const out: ({ kind: 'group'; g: PlanGroup; y: number } | { kind: 'item'; it: PlanItem; g: PlanGroup; y: number })[] = [];
    let y = 0;
    for (const g of plan.groups) {
      out.push({ kind: 'group', g, y });
      y += HEAD;
      if (shut.has(g.id)) continue;
      for (const it of g.items) {
        out.push({ kind: 'item', it, g, y });
        y += ROW;
      }
    }
    return { list: out, height: y };
  }, [plan, mem.planShut]);
  const yOf = new Map(rows.list.filter((r) => r.kind === 'item').map((r) => [(r as { it: PlanItem }).it.id, r.y + ROW / 2]));
  const dayOf = (it: PlanItem) => (drag && drag.id === it.id ? drag.day : it.day);

  const commit = async (it: PlanItem, day: number) => {
    setDrag(null);
    if (day === it.day) return;
    const change = rescheduleEdit(p, it.ref, day, today);
    if (change) await edit(change);
  };
  const markHandlers = (it: PlanItem) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ id: it.id, day: it.day, startX: e.clientX, moved: false });
    },
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!drag || drag.id !== it.id || drag.keys || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - drag.startX;
      if (!drag.moved && Math.abs(dx) < 4) return;
      if (!canEdit || it.ref.kind === 'record') return;
      setDrag({ ...drag, moved: true, day: it.day + Math.round(dx / ppd) });
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!drag || drag.id !== it.id || drag.keys) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (drag.moved) void commit(it, drag.day);
      else {
        setDrag(null);
        onOpen(it.ref, it.what, e as unknown as React.MouseEvent);
      }
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (e.key === 'Enter' && !drag) return onOpen(it.ref, it.what);
      if (e.key === 'Escape' && drag) {
        clearTimeout(keyTimer.current);
        return setDrag(null);
      }
      if (!step || !canEdit || it.ref.kind === 'record') return;
      e.preventDefault();
      const day = (drag?.id === it.id ? drag.day : it.day) + step * (e.shiftKey ? 7 : 1);
      setDrag({ id: it.id, day, startX: 0, moved: true, keys: true });
      // Saved once the keys stop.
      clearTimeout(keyTimer.current);
      keyTimer.current = window.setTimeout(() => void commit(it, day), 900);
    },
  });
  useEffect(() => () => clearTimeout(keyTimer.current), []);

  const toggle = (id: string) => remember((m) => ({ ...m, planShut: shut.has(id) ? [...shut].filter((x) => x !== id) : [...shut, id] }));
  const legend = { overdue: plan.groups.some((g) => g.items.some((i) => i.overdue)) };

  if (!plan.count) {
    return (
      <div className="pt-plan pt-empty">
        <Icon name="timeline" size={18} />
        <div>
          <strong>No dates to show yet</strong>
          <p>Key dates, and actions written with a “by” date (“Ana · by 30 Nov”), show here grouped by workstream.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-plan">
      <header className="pt-bar">
        <div className="pt-legend">
          <span>
            <span className="pt-glyph milestone" /> Milestone
          </span>
          <span>
            <span className="pt-glyph action" /> Action
          </span>
          {legend.overdue && (
            <span>
              <span className="pt-glyph action is-overdue" /> Overdue
            </span>
          )}
          <span>
            <span className="pt-glyph action is-done" /> Done
          </span>
          {canEdit && <span className="pt-hint">Drag a mark to move its date</span>}
        </div>
        <div className="pt-tools">
          <button className="button" onClick={() => scrollToday(true)}>
            Today
          </button>
          <div className="pt-zoom" role="radiogroup" aria-label="Zoom">
            {PLAN_ZOOMS.map((z) => (
              <button key={z} role="radio" aria-checked={z === zoom} className={z === zoom ? 'is-on' : ''} onClick={() => remember((m) => ({ ...m, planZoom: z }))}>
                {PLAN_ZOOM_WORDS[z]}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="pt-body" ref={body}>
        <div className="pt-canvas" style={{ width: `calc(var(--pt-label) + ${width}px)` }}>
          <div className="pt-scale">
            <div className="pt-corner">{plan.groups.some((g) => g.kind === 'workstream') ? 'Workstream' : 'Phase'}</div>
            <div className="pt-scale-track" style={{ width }}>
              {scale.major.map((t) => (
                <span key={`M${t.day}`} className="pt-major" style={{ left: (t.day - from) * ppd }}>
                  {t.label}
                </span>
              ))}
              {scale.minor.filter((t) => Math.abs((t.day - from) * ppd + (zoom === 'week' ? ppd / 2 : 3) - x(today)) > 22).map((t) => (
                <span key={`m${t.day}`} className={`pt-minor${t.major ? ' is-major' : ''}`} style={{ left: (t.day - from) * ppd, width: zoom === 'week' ? ppd : undefined }}>
                  {t.label}
                </span>
              ))}
              <span className="pt-today-tag" style={{ left: x(today) }}>
                Today
              </span>
            </div>
          </div>
          <div className="pt-rows" style={{ height: rows.height }}>
            {/* The grid behind the rows: weekends at the week zoom, month and quarter lines, today. */}
            <div className="pt-under" style={{ left: 'var(--pt-label)', width }}>
              {zoom === 'week' &&
                Array.from({ length: to - from + 1 }, (_, i) => from + i)
                  .filter((d) => ymd(d).weekday === 0 || ymd(d).weekday === 6)
                  .map((d) => <span key={d} className="pt-weekend" style={{ left: (d - from) * ppd, width: ppd }} />)}
              {scale.major.map((t) => (
                <span key={t.day} className="pt-line" style={{ left: (t.day - from) * ppd }} />
              ))}
              <span className="pt-today" style={{ left: x(today) }} />
            </div>
            {rows.list.map((r) =>
              r.kind === 'group' ? (
                <GroupRow key={r.g.id} g={r.g} y={r.y} folded={shut.has(r.g.id)} onFold={() => toggle(r.g.id)} onOpen={onOpen} span={r.g.kind !== 'milestones' && r.g.from !== undefined && r.g.to !== undefined && x(r.g.to) - x(r.g.from) >= 12 ? { left: x(r.g.from), width: x(r.g.to) - x(r.g.from) } : undefined} today={today} />
              ) : (
                <div key={r.it.id} className={`pt-row${r.it.done ? ' is-done' : ''}${r.it.overdue ? ' is-overdue' : ''}`} style={{ top: r.y }}>
                  <button className="pt-label" onClick={(e) => onOpen(r.it.ref, r.it.what, e)} title={`${plain(r.it.what)}${r.it.who ? ` · ${plain(r.it.who)}` : ''}`}>
                    <span className={`pt-glyph ${r.it.kind}${r.it.done ? ' is-done' : r.it.overdue ? ' is-overdue' : ''}`} />
                    <span className="pt-label-words">{plain(r.it.what)}</span>
                    {r.it.who && <span className="pt-label-who">{plain(r.it.who).replace(/\s*\(.*$/, '').split(/\s+(?:with|and)\s+|[·;,/]/)[0].trim()}</span>}
                  </button>
                  <div className="pt-track" style={{ width }}>
                    {(() => {
                      const d = dayOf(r.it);
                      const moving = drag?.id === r.it.id && drag.moved;
                      const seen = view.width > 0;
                      const before = seen && !moving && x(d) < view.left + 4;
                      const after = seen && !moving && x(d) > view.left + view.width - 4;
                      const nearEnd = x(d) > (seen ? Math.min(width, view.left + view.width) : width) - 120;
                      return (
                        <>
                          {moving && d !== r.it.day && <span className="pt-ghost" style={{ left: x(r.it.day) }} />}
                          <button
                            className={`pt-mark ${r.it.kind}${r.it.done ? ' is-done' : r.it.overdue ? ' is-overdue' : ''}${moving ? ' is-moving' : ''}`}
                            style={{ left: x(d) }}
                            aria-label={`${plain(r.it.what)}, ${longDay(d)}${canEdit && r.it.ref.kind !== 'record' ? '. Arrow keys move it a day, Shift a week.' : ''}`}
                            title={r.it.ref.kind === 'record' ? `${longDay(d)} · written in ${r.it.from ?? 'a note'}: change its day there` : canEdit ? `${longDay(d)} · drag to move` : longDay(d)}
                            {...markHandlers(r.it)}
                          />
                          {before || after ? (
                            <button className={`pt-pin${after ? ' is-right' : ''}`} style={{ left: before ? view.left + 6 : view.left + view.width - 6 }} title={`${longDay(d)} · show it`} onClick={() => bringIn(d)}>
                              {before && <Icon name="back" size={10} />}
                              {shortDay(d, today)}
                              {after && <Icon name="forward" size={10} />}
                            </button>
                          ) : (
                            <span className={`pt-mark-date${nearEnd ? ' is-left' : ''}${moving ? ' is-moving' : ''}`} style={{ left: x(d) }}>
                              {moving ? `Move to ${longDay(d)}` : shortDay(d, today)}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              ),
            )}
            {plan.deps.length > 0 && (
              <svg className="pt-deps" style={{ left: 'var(--pt-label)', width, height: rows.height }} width={width} height={rows.height}>
                <defs>
                  <marker id="pt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L8,4 L0,8 z" />
                  </marker>
                </defs>
                {plan.deps.map((d) => {
                  const a = plan.groups.flatMap((g) => g.items).find((i) => i.id === d.from);
                  const b = plan.groups.flatMap((g) => g.items).find((i) => i.id === d.to);
                  const y1 = yOf.get(d.from), y2 = yOf.get(d.to);
                  if (!a || !b || y1 === undefined || y2 === undefined) return null;
                  const x1 = x(dayOf(a)) + 7, x2 = x(dayOf(b)) - 8;
                  const mid = Math.max(x1 + 8, Math.min(x2 - 8, (x1 + x2) / 2));
                  const clash = dayOf(a) > dayOf(b);
                  return <path key={`${d.from}>${d.to}`} className={`pt-dep${clash ? ' is-clash' : ''}`} d={clash ? `M${x1},${y1} C${x1 + 30},${y1} ${x2 - 30},${y2} ${x2},${y2}` : `M${x1},${y1} H${mid} V${y2} H${x2}`} markerEnd="url(#pt-arrow)" />;
                })}
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupRow({ g, y, folded, onFold, onOpen, span, today }: { g: PlanGroup; y: number; folded: boolean; onFold(): void; onOpen(ref: ItemRef, title: string, e?: React.MouseEvent): void; span?: { left: number; width: number }; today: number }) {
  const late = g.items.filter((i) => i.overdue).length;
  const tone = /\b(late|off track|blocked|overdue)\b/i.test(g.status ?? '') ? 'bad' : /\b(risk)\b/i.test(g.status ?? '') ? 'warn' : g.done ? 'ok' : 'none';
  const next = g.items.find((i) => !i.done && i.day >= today);
  return (
    <div className={`pt-group${folded ? ' is-folded' : ''}`} style={{ top: y }}>
      <div className="pt-group-label">
        <button className="pt-fold" aria-expanded={!folded} title={folded ? 'Show its lines' : 'Fold it away'} onClick={onFold}>
          <Icon name="chevronDown" size={12} />
        </button>
        <button className="pt-group-name" onClick={(e) => (g.ref ? onOpen(g.ref, g.name, e) : onFold())} title={g.name}>
          {g.name}
        </button>
        <span className="pt-group-meta">
          {g.status && <span className={`pt-status tone-${tone}`} title={g.status}>{g.status}</span>}
          {typeof g.progress === 'number' && <span className="pt-progress" title={`${g.progress}% done`}><span style={{ width: `${Math.min(100, g.progress)}%` }} /></span>}
          {!g.items.length && g.undated > 0 && <span className="pt-undated">{g.undated} without a date</span>}
          {!g.items.length && !g.undated && <span className="pt-undated">No dates</span>}
          {folded && g.items.length > 0 && <span className="pt-undated">{g.items.length} {g.items.length === 1 ? 'line' : 'lines'}{late ? ` · ${late} overdue` : ''}</span>}
          {!folded && g.items.length > 0 && g.undated > 0 && <span className="pt-undated">+{g.undated} undated</span>}
          {!folded && !next && g.items.length > 0 && g.items.every((i) => i.done) && <span className="pt-undated">All done</span>}
        </span>
      </div>
      {span && <span className={`pt-span tone-${late ? 'bad' : tone}`} style={{ left: `calc(var(--pt-label) + ${span.left}px)`, width: span.width }} />}
    </div>
  );
}
