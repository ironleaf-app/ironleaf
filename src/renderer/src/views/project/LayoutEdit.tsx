// Editing a project's dashboard in place (22 Oct 2026, docs/LAYOUTS.md). Every value a block shows can be changed where
// it is: a click on its words (or Tab to it and Enter) opens it in place; a status opens its choices; a percentage is a
// slider; a card or row has a quiet ⋯ with the rest (edit every column, move, mark done, delete). Each change is one edit
// of the file, keeping every other character (src/shared/layouts.ts: one cell, one tick box, one log field), shown at
// once before the file is written (the page draws the edit straight away, then the file as written), with Undo in its
// message (and Ctrl+Z). Affordances stay calm: nothing shows at rest; over a block its values underline softly; over a
// value, a wash and a pencil.

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ProjectEdit } from '../../../../shared/project-file';
import type { ProjectView } from '../../../../shared/types';
import { Icon } from '../../components/Icon';
import { peekRow, RecordScope } from '../../components/RecordScope';
import { openMenu, type MenuItem } from '../../components/Menu';
import { Inline, InlineDate, niceDate, readable, useEditor, type Suggestion } from './Inline';
import { dueWords, shownWords, whoPerson } from '../../lib/projectLook';
import { viewMove } from '../../lib/viewMove';
import { Words } from './parts';

/** What the dashboard's blocks edit with. `view` is the project as shown (an edit shows before the file is written). */
export interface Dash {
  view: ProjectView;
  path: string;
  canEdit: boolean;
  people: Suggestion[];
  /** One project edit (with Undo in its message), shown at once. */
  edit(change: ProjectEdit): Promise<boolean>;
  /** A section of the person's own changed by `fn` (one cell, one line), with words for its message. */
  section(heading: string, fn: (body: string) => string, words?: string): Promise<boolean>;
  /** A log note changed by `fn` (one field, one note), with words for its message and Undo. */
  log(path: string, fn: (text: string) => string, words: string): Promise<boolean>;
}

export const DashContext = createContext<Dash | null>(null);
export function useDash(): Dash {
  const d = useContext(DashContext);
  if (!d) throw new Error('The dashboard’s editor is missing.');
  return d;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Choices for a status: the ones written in its column first (as written), then the usual ones, each once. */
export function choicesFrom(written: string[], usual: string[]): string[] {
  const out: string[] = [];
  for (const w of [...written, ...usual]) if (w.trim() && !out.some((x) => same(x, w))) out.push(w.trim());
  return out;
}

/**
 * A status (or any word from a short list) as a pill: a click opens its choices, "Something else…" types one, and it can
 * be cleared. Without edit rights: the pill.
 */
export function Choice({ value, options, onSave, label, tone = 'none', placeholder = '+ Status', className = '', dot = true }: { value: string; options: string[]; onSave(v: string): Promise<boolean> | void; label: string; tone?: string; placeholder?: string; className?: string; dot?: boolean }) {
  const { canEdit } = useEditor();
  const [typing, setTyping] = useState(false);
  if (!canEdit)
    return value ? (
      <span className={`pj-pill tone-${tone} ${className}`}>
        {dot && <span className="pj-dot" />}
        {cap(value)}
      </span>
    ) : null;
  if (typing) return <Inline value={value} autoEdit compact label={label} className={`ly-choice-typing ${className}`} onDone={() => setTyping(false)} onSave={(v) => onSave(v)} />;
  const menu = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    openMenu(e.currentTarget, [
      { heading: label },
      ...options.map((o) => ({ label: cap(o), checked: same(o, value), run: () => void (same(o, value) ? undefined : onSave(o)) })),
      { separator: true as const },
      { label: 'Something else…', icon: 'pencil' as const, run: () => setTyping(true) },
      { label: 'Clear', disabled: !value, run: () => void onSave('') },
    ]);
  };
  return value ? (
    <button type="button" className={`pj-pill tone-${tone} ly-choice ${className}`} onClick={menu} aria-haspopup="menu" title={`${label}: ${cap(value)}. Click to change`}>
      {dot && <span className="pj-dot" />}
      {cap(value)}
      <Icon name="chevronDown" size={10} />
    </button>
  ) : (
    <button type="button" className={`ly-choice ly-quiet-add ${className}`} onClick={menu} aria-haspopup="menu" aria-label={`${label}: not set`}>
      {placeholder}
    </button>
  );
}

/**
 * A percentage as a bar that is its own slider: drag along it or use the arrow keys (steps of 5; Home and End); saved
 * when let go. The figure beside it can be typed. No figure yet: "+ Progress" starts one.
 */
export function Pct({ value, onSave, label = 'Progress', tone = 'accent', start = '+ Progress' }: { value?: number; onSave(n: number | null): Promise<boolean> | void; label?: string; tone?: string; start?: string }) {
  const { canEdit } = useEditor();
  const [live, setLive] = useState<number | null>(null);
  const track = useRef<HTMLSpanElement>(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!canEdit)
    return value === undefined ? null : (
      <span className="ly-pct">
        <span className="ly-bar">
          <span style={{ width: `${Math.max(2, value)}%` }} />
        </span>
        <span className="ly-pct-figure">{value}%</span>
      </span>
    );
  if (value === undefined && live === null)
    return (
      <button type="button" className="ly-quiet-add ly-pct-start" aria-label={`Set ${label.charAt(0).toLowerCase()}${label.slice(1)}`} onClick={() => setLive(0)}>
        {start}
      </button>
    );
  const shown = live ?? value ?? 0;
  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 20) * 5;
  };
  const commit = (n: number) => {
    clearTimeout(timer.current);
    timer.current = 0;
    setLive(null);
    if (n !== value) void onSave(n);
  };
  return (
    <span className={`ly-pct is-edit${live !== null ? ' is-live' : ''} tone-${tone}`}>
      <span
        className="ly-pct-slider"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
        aria-valuetext={`${shown}%`}
        title="Drag, or use the arrow keys"
        ref={(el) => {
          if (el && value === undefined && live === 0 && document.activeElement !== el) el.focus();
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setLive(at(e.clientX));
        }}
        onPointerMove={(e) => {
          if (live !== null && e.currentTarget.hasPointerCapture(e.pointerId)) setLive(at(e.clientX));
        }}
        onPointerUp={(e) => {
          if (live === null) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          commit(at(e.clientX));
        }}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 5 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5 : 0;
          const jump = e.key === 'Home' ? 0 : e.key === 'End' ? 100 : null;
          if (e.key === 'Escape' && live !== null) {
            e.preventDefault();
            clearTimeout(timer.current);
            timer.current = 0;
            setLive(null);
            return;
          }
          if (!step && jump === null) return;
          e.preventDefault();
          e.stopPropagation();
          const n = jump ?? Math.max(0, Math.min(100, Math.round(shown / 5) * 5 + step));
          setLive(n);
          clearTimeout(timer.current);
          timer.current = window.setTimeout(() => commit(n), 650);
        }}
        onBlur={() => {
          if (live !== null && timer.current) commit(live);
          else if (live !== null && value === undefined) setLive(null);
        }}
      >
        <span className="ly-bar" ref={track}>
          <span style={{ width: `${Math.max(2, shown)}%` }} />
        </span>
        <span className="ly-pct-knob" style={{ left: `${shown}%` }} />
      </span>
      <Inline
        compact
        value={`${shown}`}
        label={`${label} (a number from 0 to 100)`}
        className="ly-pct-figure"
        onSave={(v) => {
          const n = Number(v.replace(/%$/, '').trim());
          if (!v.trim()) return onSave(null);
          if (!Number.isFinite(n)) return;
          return onSave(Math.max(0, Math.min(100, Math.round(n))));
        }}
      >
        {shown}%
      </Inline>
    </span>
  );
}

/** A card's or row's quiet ⋯: its menu (shown when the pointer is over the card, or it has the keys). */
export function More({ label, items, className = '' }: { label: string; items: () => MenuItem[]; className?: string }) {
  const { canEdit } = useEditor();
  if (!canEdit) return null;
  return (
    <button
      type="button"
      className={`ly-more ${className}`}
      title={label}
      aria-label={label}
      aria-haspopup="menu"
      onClick={(e) => {
        e.stopPropagation();
        openMenu(e.currentTarget, items());
      }}
    >
      <Icon name="more" size={14} />
    </button>
  );
}

/** A small panel under its button (the progress ring's slider): closes on Esc or a click elsewhere. */
export function Popover({ children, onClose, className = '' }: { children: ReactNode; onClose(): void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    el?.querySelector<HTMLElement>('[role="slider"], input, textarea, button')?.focus();
    const down = (e: PointerEvent) => {
      if (el && !el.contains(e.target as Node) && !(e.target as Element).closest?.('.menu')) onClose();
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, []);
  return (
    <div
      ref={ref}
      className={`ly-popover ${className}`}
      role="dialog"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

// ── Lists of tick boxes (a run sheet's phase, What's next, the next actions) ─────────────────────────────────────────

export interface CheckItem {
  key: string | number;
  done: boolean;
  what: string;
  who: string;
  when: string;
  /** The day was written "by …" (a run sheet's "— 9 Sep" says when it happened, not a deadline). */
  by?: boolean;
}

/**
 * Tick boxes edited where they are: a click opens the step in the peek (WS1 part B), its words, who and by when change
 * with a double-click, the pencil or E (quiet "+ Who", "+ By when" over the row), ticked,
 * taken off (Undo in its message), and dragged into order by the grip (or Alt+↑/↓).
 */
export function CheckList({ items, path, onTick, onSave, onRemove, onMove, emptyWords, label }: { items: CheckItem[]; path: string; onTick(i: number, done: boolean): void; onSave(i: number, change: { what?: string; who?: string; when?: string }): Promise<boolean> | void; onRemove(i: number): void; onMove?(from: number, to: number, after: boolean): void; emptyWords?: string; label: string }) {
  const { canEdit } = useEditor();
  const { people } = useDash();
  const [drag, setDrag] = useState<{ from: number; over?: number; after?: boolean } | null>(null);
  const [grabbed, setGrabbed] = useState<number | null>(null);
  return (
    <ul className="ly-checks" aria-label={label}>
      {items.map((it, i) => (
        <li
          key={`${it.key}:${it.what}`}
          className={`pj-row ly-check${it.done ? ' done' : ''}${drag?.over === i ? (drag.after ? ' drop-after' : ' drop-before') : ''}${drag?.from === i ? ' is-dragging' : ''}`}
          style={{ viewTransitionName: `ly-${String(it.key).replace(/[^a-zA-Z0-9_-]/g, '')}` }}
          {...peekRow({ type: 'action', path, title: it.what })}
          draggable={canEdit && !!onMove && grabbed === i}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', it.what);
            setDrag({ from: i });
          }}
          onDragOver={(e) => {
            if (!drag) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const after = e.clientY > r.top + r.height / 2;
            if (drag.over !== i || drag.after !== after) setDrag({ ...drag, over: i, after });
          }}
          onDrop={(e) => {
            e.preventDefault();
            // The reorder glides (5 Nov 2026 feel-motion: rows popped to their new places).
            if (drag && drag.over !== undefined && drag.from !== drag.over) {
              const from = drag.from, over = drag.over, after = !!drag.after;
              viewMove(() => onMove?.(from, over, after));
            }
            setDrag(null);
            setGrabbed(null);
          }}
          onDragEnd={() => {
            setDrag(null);
            setGrabbed(null);
          }}
          onKeyDown={(e) => {
            if (!canEdit || !onMove || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
            const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
            if (to < 0 || to >= items.length) return;
            e.preventDefault();
            onMove(i, to, e.key === 'ArrowDown');
          }}
        >
          {canEdit && onMove && (
            <span className="pj-grip" title="Drag to reorder (or Alt+↑/↓)" onPointerDown={() => setGrabbed(i)} onPointerUp={() => setGrabbed(null)}>
              <Icon name="grip" size={12} />
            </span>
          )}
          <input type="checkbox" checked={it.done} disabled={!canEdit} onChange={(e) => onTick(i, e.target.checked)} aria-label={`${it.done ? 'Not done' : 'Done'}: ${it.what}`} />
          <RecordScope at={{ type: 'action', path, title: it.what }}>
            <span className="ly-check-words">
              <Inline value={it.what} required label="Step" className="ly-check-what" onSave={(what) => onSave(i, { what })}>
                <Words text={it.what} from={path} />
              </Inline>
              <span className="ly-check-meta">
                <RecordScope at={it.who ? { type: 'person', name: whoPerson(it.who) } : null}>
                  <Inline value={it.who} quiet placeholder="+ Who" label="Who does it" suggest={people} compact className="pj-chip ly-who" onSave={(who) => onSave(i, { who })}>
                    {it.who ? shownWords(it.who) : undefined}
                  </Inline>
                </RecordScope>
                <InlineDate value={it.when} iso={!it.when || /^\d{4}-\d{2}-\d{2}$/.test(it.when.trim())} quiet placeholder="+ By when" label="By when" className={`pj-chip ly-when tone-${it.done ? 'none' : (dueWords(it.when)?.tone ?? 'none')}`} onSave={(when) => onSave(i, { when })}>
                  {it.when ? (readable(it.when) ? `${it.by === false ? '' : 'by '}${niceDate(it.when)}` : shownWords(it.when)) : undefined}
                </InlineDate>
              </span>
            </span>
          </RecordScope>
          {canEdit && (
            <span className="pj-row-actions">
              <button
                type="button"
                className="pj-row-action danger"
                title="Delete this step"
                aria-label={`Delete: ${it.what}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(i);
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </span>
          )}
        </li>
      ))}
      {!items.length && emptyWords && <li className="ly-faint ly-check-none">{emptyWords}</li>}
    </ul>
  );
}
