// One project's row on the Timeline tab (8.7 wave 2 round 2, the plan: the mock-up draws each project as
// one coloured bar with its dates on it, not dots and lines): the bar in the project's tint with its span written on
// it ("12 Oct – 20 Nov"), the name and standing ("At risk · due 20 Nov") down the left. The bar itself drags to move
// the project (its start and due date shift together), its ends stretch it, and every mark keeps what it does (a card
// on hover, a click to open, a drag to move a key date) on the line below the bar; when too many share a day they
// fold into the nearest, never lost.

import { memo, useEffect, useRef, useState } from 'react';
import { KIND_WORDS, barDays, barTint, barWords, longDay, rowSub, type Mark, type Packed, type Problems, type TimelineProject } from '../../../../shared/timeline';
import { markClass, useMarkDrag, type Drag, type HoverCard } from './RowMarks';

const LINE = 24;
const BELOW = 47;

interface BarRowProps {
  r: TimelineProject;
  pack: Packed | undefined;
  from: number;
  today: number;
  problems: Problems;
  drag: Drag | null;
  selected: string | null;
  canMove: boolean;
  handlers: ReturnType<typeof useMarkDrag>['handlers'];
  hover: HoverCard;
  dayAt(clientX: number, lane: Element): number;
  onOpen(path: string, e?: { ctrlKey: boolean; metaKey: boolean }): void;
  onMoveBar(path: string, deltaDays: number): Promise<unknown> | void;
}

export const BarRow = memo(function BarRow({ r, pack, from, today, problems, drag, selected, canMove, handlers, hover, dayAt, onOpen, onMoveBar }: BarRowProps) {
  const byId = new Map(r.marks.map((m) => [m.id, m]));
  const dayOf = (m: Mark) => (drag?.id === m.id ? drag.day : m.day);
  // The bar's span: start to due, or past the furthest mark when open at an end; with neither, the marks' own span.
  const real = barDays(r);
  const span = real ?? (r.marks.length ? { d1: Math.min(...r.marks.map((m) => m.day)), d2: Math.max(...r.marks.map((m) => m.day)), open: 'none' as const } : undefined);
  const movable = canMove && r.start !== undefined && r.due !== undefined;
  const [shift, setShift] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const live = useRef<{ x0: number; lane: Element; grab: number } | null>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (shift === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        live.current = null;
        setShift(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [shift]);
  const gd1 = span ? span.d1 + (shift ?? 0) : 0;
  const gd2 = span ? span.d2 + (shift ?? 0) : 0;
  const words = span ? barWords(gd1, gd2, today) : '';

  const start = r.marks.find((m) => m.kind === 'start');
  const due = r.marks.find((m) => m.kind === 'due');
  const markButton = (m: Mark, y: number, folded: string[] = []) => {
    const all = [m, ...folded.map((id) => byId.get(id)!).filter(Boolean)];
    const list = problems.marks.get(m.id);
    const dragging = drag?.id === m.id;
    return (
      <button
        key={m.id}
        type="button"
        data-mark={m.id}
        className={`${markClass(m, folded.length ? all.flatMap((x) => problems.marks.get(x.id) ?? []) : list, today)}${m.movable ? ' movable' : ''}${dragging ? ' is-dragging' : ''}${drag?.saving && dragging ? ' is-saving' : ''}${selected === m.id ? ' is-selected' : ''}`}
        style={{ ['--d' as string]: dayOf(m) - from, top: y }}
        tabIndex={-1}
        aria-label={`${KIND_WORDS[m.kind]}: ${m.kind === 'start' || m.kind === 'due' ? r.name : m.words}, ${longDay(m.day)}`}
        onPointerEnter={(e) => !drag && hover.show(all, e.currentTarget)}
        onPointerLeave={() => hover.hide()}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
        onPointerDown={(e) => {
          hover.set(null);
          handlers.onPointerDown(e, m);
        }}
      >
        <span className="tl-glyph" />
        {folded.length > 0 && <span className="tl-more">+{folded.length}</span>}
        {dragging && drag && <span className="tl-drag-day">{longDay(drag.day)}</span>}
      </button>
    );
  };

  return (
    <div className={`tl-row${selected !== null ? ' is-selected' : ''}${r.done ? ' is-done' : ''}`} data-path={r.path}>
      <div className="tl-name">
        <button className="tl-name-button" title={`Open ${r.name}`} onClick={(e) => onOpen(r.path, e)}>
          <span className="tl-name-words">{r.name}</span>
        </button>
        <span className="tl-name-sub">
          <span className="tl-faint">{rowSub(r, today)}</span>
        </span>
      </div>
      <div className="tl-blane" ref={laneRef}>
        {span && (
          <div
            className={`tl-bbar ${barTint(r, today)}${movable ? ' movable' : ''}${shift !== null ? ' is-dragging' : ''}${saving ? ' is-saving' : ''}`}
            style={{ ['--d1' as string]: gd1 - from, ['--d2' as string]: gd2 - from }}
            title={typeof r.progress === 'number' ? `${r.name}: ${words} · about ${r.progress}% done` : `${r.name}: ${words}`}
            onPointerDown={(e) => {
              if (e.button !== 0 || !laneRef.current) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              live.current = { x0: e.clientX, lane: laneRef.current, grab: dayAt(e.clientX, laneRef.current) };
            }}
            onPointerMove={(e) => {
              const d = live.current;
              if (!d) return;
              if (Math.abs(e.clientX - d.x0) < 4 || !movable) return;
              hover.set(null);
              setShift(dayAt(e.clientX, d.lane) - d.grab);
            }}
            onPointerUp={(e) => {
              const d = live.current;
              live.current = null;
              if (!d) return;
              const delta = dayAt(e.clientX, d.lane) - d.grab;
              const moved = shift !== null;
              setShift(null);
              if (!moved) {
                onOpen(r.path, e);
                return;
              }
              if (delta !== 0 && movable) {
                setSaving(true);
                void Promise.resolve(onMoveBar(r.path, delta)).finally(() => setSaving(false));
              }
            }}
            onPointerCancel={() => {
              live.current = null;
              setShift(null);
            }}
          >
            <span className="tl-bbar-words">{words}</span>
          </div>
        )}
        {start && markButton(start, LINE)}
        {due && markButton(due, LINE)}
        {(pack?.shown ?? []).map((id) => {
          const m = byId.get(id);
          return m ? markButton(m, BELOW, pack?.folded.get(id)) : null;
        })}
      </div>
    </div>
  );
});
