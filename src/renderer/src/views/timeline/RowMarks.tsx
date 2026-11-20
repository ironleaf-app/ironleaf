// What the Timeline tab's marks do: a card with their words when the pointer rests on one, a click to open the
// project at it, and a drag (key dates, the start and the due date) to move it. The rows themselves are
// views/timeline/BarRow.tsx (one coloured bar each). Positions come from the CSS variable --ppd (pixels a day) on the
// board, so zooming is one variable changing smoothly, not every mark drawn again.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { KIND_WORDS, longDay, relativeDay, type Mark, type Problem, type Problems, type TimelineProject } from '../../../../shared/timeline';
import { Icon } from '../../components/Icon';
import { healthTone } from '../../lib/projectLook';
import { minPopupTop } from '../../lib/windowButtons';

const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const dateMet = (s?: string) => /\b(done|complete|completed|met|achieved|delivered|closed)\b/i.test(s ?? '');

/** The look of a mark: what it is, how it stands, and its worst problem. */
export function markClass(m: Mark, problems: Problem[] | undefined, today: number): string {
  const worst = problems?.find((p) => p.kind === 'clash') ?? problems?.find((p) => p.kind === 'overdue') ?? problems?.find((p) => p.kind === 'late') ?? problems?.find((p) => p.kind === 'slipped');
  const state = m.kind === 'next' ? (m.done ? 'done' : 'open') : m.kind === 'date' ? (dateMet(m.status) ? 'done' : m.day < today ? 'past' : 'open') : 'open';
  return `tl-mark k-${m.kind} s-${state}${worst ? ` p-${worst.kind}` : ''}`;
}

// ── The card shown over a mark ───────────────────────────────────────────────────────────────────────────────────────

export interface CardState {
  marks: Mark[];
  rect: DOMRect;
}

export function MarkCard({ hover, hidden, projects, problems, today, canMove }: { hover: HoverCard; hidden?: boolean; projects: Map<string, TimelineProject>; problems: Problems; today: number; canMove: boolean }) {
  const shown = useSyncExternalStore(hover.subscribe, hover.get);
  const card = hidden ? null : shown;
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const [moved, setMoved] = useState(0);
  useEffect(() => {
    if (!card || !el.current) return setPos(null);
    const w = el.current.offsetWidth, h = el.current.offsetHeight;
    // Over the mark where it is now (the board or the page may have scrolled since).
    const now = document.querySelector(`[data-mark="${CSS.escape(card.marks[0].id)}"]`);
    const r = moved && now ? now.getBoundingClientRect() : card.rect;
    // Never up under the window buttons (8.6.1): over the mark only when it clears their band, else below it.
    const clear = minPopupTop();
    const below = r.top - h - 10 < clear;
    setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)), top: below ? Math.max(clear, r.bottom + 10) : r.top - h - 10, below });
  }, [card, moved]);
  useEffect(() => {
    if (!card) return;
    const onScroll = () => setMoved((n) => n + 1);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [card]);
  if (!card) return null;
  const many = card.marks.length > 1;
  return createPortal(
    <div ref={el} className={`tl-card${pos ? ' is-shown' : ''}${pos?.below ? ' below' : ''}`} style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }} role="tooltip">
      {card.marks.slice(0, 6).map((m) => {
        const p = projects.get(m.path);
        const list = problems.marks.get(m.id) ?? [];
        return (
          <div key={m.id} className="tl-card-item">
            <div className="tl-card-top">
              <span className={`tl-card-kind k-${m.kind}`}>{KIND_WORDS[m.kind]}</span>
              <span className="tl-card-when">
                {longDay(m.day)} <span className="tl-faint">· {relativeDay(m.day, today)}</span>
              </span>
            </div>
            {m.kind !== 'start' && m.kind !== 'due' && <p className="tl-card-words">{m.words}</p>}
            <p className="tl-card-project">
              <span className={`tl-dot tone-${healthTone(p?.health)}`} />
              {p?.name}
              {m.who && <span className="tl-faint"> · {m.who}</span>}
              {m.status && <span className="tl-faint"> · {cap(m.status)}</span>}
              {m.kind === 'next' && m.done && <span className="tl-faint"> · Done</span>}
            </p>
            {list.map((x, i) => (
              <p key={i} className={`tl-card-problem p-${x.kind}`}>
                <Icon name={x.kind === 'clash' ? 'people' : 'warning'} size={12} />
                {x.words}
              </p>
            ))}
          </div>
        );
      })}
      {card.marks.length > 6 && <p className="tl-card-more">and {card.marks.length - 6} more here</p>}
      {!many && <p className="tl-card-hint">{card.marks[0].movable && canMove ? 'Click to open · drag to move' : 'Click to open'}</p>}
    </div>,
    document.body,
  );
}

/**
 * The card over a mark, kept apart from the board (a small store the card alone listens to), so resting on a mark redraws
 * the card and nothing else — with 50 projects of 30 dates, the board stays still. A moment's wait before it shows, so
 * sweeping across the board doesn't flash cards.
 */
export interface HoverCard {
  show(marks: Mark[], target: Element, wait?: number): void;
  hide(): void;
  set(card: CardState | null): void;
  get(): CardState | null;
  subscribe(fn: () => void): () => void;
}

function hoverStore(): HoverCard {
  let card: CardState | null = null;
  let timer = 0;
  const listeners = new Set<() => void>();
  const put = (next: CardState | null) => {
    card = next;
    listeners.forEach((l) => l());
  };
  return {
    show(marks, target, wait = 70) {
      clearTimeout(timer);
      timer = window.setTimeout(() => put({ marks, rect: target.getBoundingClientRect() }), wait);
    },
    hide() {
      clearTimeout(timer);
      timer = window.setTimeout(() => put(null), 60);
    },
    set(next) {
      clearTimeout(timer);
      put(next);
    },
    get: () => card,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

export function useHoverCard(): HoverCard {
  const store = useRef<HoverCard | null>(null);
  store.current ??= hoverStore();
  useEffect(() => () => store.current?.set(null), []);
  return store.current;
}

// ── Dragging a date ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface Drag {
  id: string;
  day: number;
  /** Written and waiting for the file: drawn where it was dropped meanwhile. */
  saving?: boolean;
}

/**
 * A mark moved with the pointer: past a few pixels it's a drag (else a click), snapped to days, drawn where it would go
 * with its new date beside it; Escape puts it back. `dayAt` turns a pointer's x into a day.
 */
export function useMarkDrag(options: { canMove: boolean; dayAt(clientX: number, lane: Element): number; onMove(m: Mark, day: number): Promise<unknown> | void; onClick(m: Mark, e: React.PointerEvent | React.MouseEvent): void }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const dragNow = useRef<Drag | null>(null);
  dragNow.current = drag;
  const live = useRef<{ m: Mark; x0: number; lane: Element; offset: number; moved: boolean; day: number } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && live.current) {
        live.current = null;
        setDrag(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  // The same handlers every time (they read the latest options), so rows that aren't changing aren't drawn again.
  const handlers = useMemo(
    () => ({
      onPointerDown(e: React.PointerEvent<HTMLElement>, m: Mark) {
        if (e.button !== 0) return;
        const lane = e.currentTarget.closest('.tl-lane, .tl-strip-lane, .tl-blane');
        if (!lane) return;
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        // Where in its day the mark was taken, so it doesn't jump under the pointer.
        live.current = { m, x0: e.clientX, lane, offset: latest.current.dayAt(e.clientX, lane) - m.day, moved: false, day: m.day };
      },
      onPointerMove(e: React.PointerEvent<HTMLElement>) {
        const d = live.current;
        if (!d) return;
        if (!d.moved && (Math.abs(e.clientX - d.x0) < 4 || !d.m.movable || !latest.current.canMove)) return;
        d.moved = true;
        const day = latest.current.dayAt(e.clientX, d.lane) - d.offset;
        if (day !== d.day || !dragNow.current) {
          d.day = day;
          setDrag({ id: d.m.id, day });
        }
      },
      onPointerUp(e: React.PointerEvent<HTMLElement>) {
        const d = live.current;
        live.current = null;
        if (!d) return;
        if (!d.moved) {
          setDrag(null);
          latest.current.onClick(d.m, e);
          return;
        }
        if (d.day === d.m.day) return setDrag(null);
        setDrag({ id: d.m.id, day: d.day, saving: true });
        void Promise.resolve(latest.current.onMove(d.m, d.day)).finally(() => setDrag((now) => (now?.id === d.m.id && now.saving ? null : now)));
      },
      onPointerCancel() {
        live.current = null;
        setDrag(null);
      },
    }),
    [],
  );
  return { drag, setDrag, handlers };
}
