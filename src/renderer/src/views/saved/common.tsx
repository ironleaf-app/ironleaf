// What the layouts of a view share (src/shared/views.ts): a value shown the way its kind reads best, a note's
// card (board and calendar), opening a note, and the drag that carries a note from one column or day to another.

import type { ReactNode } from 'react';
import { propKind, type PropKind, type PropValue } from '../../../../shared/frontmatter';
import { dayLabel } from '../../../../shared/days';
import { isFault } from '../../../../shared/formula';
import { FIELD_FOLDER, FIELD_MODIFIED, isEmpty, propWords, readDate, valueOf, valueText, type KnownProp, type ViewLayout, type ViewRow } from '../../../../shared/views';
import type { IconName } from '../../components/Icon';
import * as A from '../../state/actions';
import { openMenu } from '../../components/Menu';
import { fileMenu } from '../../state/menus';

/** A note dragged inside a view: its path and the column (or day) it came from. */
export const DRAG_MIME = 'application/x-nv-view-note';
export interface Dragged {
  path: string;
  from: string;
}
export function readDragged(e: React.DragEvent): Dragged | null {
  try {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    return raw ? (JSON.parse(raw) as Dragged) : null;
  } catch {
    return null;
  }
}
export const isNoteDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_MIME);

export type WriteProp = (path: string, key: string, value: PropValue | null) => void;

/** A note opened from a view: in this tab (Back returns to the view), or a new tab with Ctrl or the middle button. */
export function openNote(path: string, e?: { ctrlKey: boolean; metaKey: boolean; button?: number }): void {
  A.openPath(path, { where: e && (e.ctrlKey || e.metaKey || e.button === 1) ? 'tab' : 'current' });
}

/** The kind of value a property holds, as the notes mostly write it (else by this value). */
export function kindFor(key: string, known: Map<string, KnownProp>, value?: unknown): PropKind {
  if (key === FIELD_MODIFIED) return 'datetime';
  return known.get(key.toLowerCase())?.kind ?? propKind(key, value);
}

/** "[[Saltwater Bakehouse|the bakery]]" reads "the bakery"; plain words stay as they are. */
const unlink = (s: string) => s.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target);

const yearNow = new Date().getFullYear();
function dayText(v: unknown): string | null {
  const d = readDate(v);
  if (!d) return null;
  const [y, m, day] = d.iso.split('-').map(Number);
  const date = new Date(y, m - 1, day);
  const words = dayLabel(date);
  const time = /(\d{2}):(\d{2})/.exec(d.time);
  return `${words}${y !== yearNow && !words.includes(String(y)) ? ` ${y}` : ''}${time ? ` · ${time[1]}:${time[2]}` : ''}`;
}

/** A value shown the way its kind reads best: lists as small pills, ticks as ticks, days as days, numbers aligned. */
export function ValueView({ value, kind, field }: { value: unknown; kind: PropKind; field?: string }): ReactNode {
  // A formula that couldn't be worked out: a quiet dash, the reason on hover (21 Oct 2026), never a broken view.
  if (isFault(value)) return <span className="sv-value sv-fault" title={value.reason} aria-label={`Can’t be worked out: ${value.reason}`}>!</span>;
  if (field === FIELD_MODIFIED && typeof value === 'number') {
    const d = new Date(value);
    return <span className="sv-value sv-faint">{`${dayLabel(d)}${d.getFullYear() !== yearNow ? ` ${d.getFullYear()}` : ''}`}</span>;
  }
  if (field === FIELD_FOLDER) return <span className="sv-value sv-faint">{String(value || 'Top of the library')}</span>;
  if (isEmpty(value)) return <span className="sv-value sv-blank" aria-label="Empty" />;
  if (Array.isArray(value) || kind === 'tags' || kind === 'list' || kind === 'aliases') {
    const list = (Array.isArray(value) ? value : [value]).filter((x) => !isEmpty(x));
    const words = list.map((x) => (kind === 'tags' ? `#${valueText(x).replace(/^#/, '')}` : unlink(valueText(x))));
    return (
      // Capped at two rows in a table (8.6); the full list stays on hover.
      <span className="sv-value sv-pills" title={words.join(', ')}>
        {words.map((w, i) => (
          <span key={i} className="sv-pill">
            {w}
          </span>
        ))}
      </span>
    );
  }
  if (typeof value === 'boolean') return <span className={`sv-value sv-tick${value ? ' on' : ''}`}>{value ? 'Yes' : 'No'}</span>;
  if (kind === 'date' || kind === 'datetime') {
    const words = dayText(value);
    if (words) return <span className="sv-value sv-date">{words}</span>;
  }
  if (typeof value === 'number' || kind === 'number') return <span className="sv-value sv-number">{valueText(value)}</span>;
  // A path to a file in the library (a canvas, a note, a PDF) reads as its name, "Docs/Siteplan.canvas" → "Siteplan"
  // (21 Oct 2026, the Docs table showed the raw path); the full path stays in the tooltip.
  const text = unlink(valueText(value));
  const file = /^[^\s\\/][^\n]*\/[^/\n]+\.(canvas|md|pdf|base|view\.json)$/i.exec(text);
  if (file) return <span className="sv-value sv-file" title={text}>{text.split('/').pop()!.replace(/\.(canvas|md|pdf|base|view\.json)$/i, '')}</span>;
  // Clipped at two lines in a table (8.6); the full words stay on hover.
  return <span className="sv-value" title={text}>{text}</span>;
}

/** A note's card on a board or a calendar: its name, and one or two of its properties under it. */
export function NoteCard({
  row,
  cardProps,
  known,
  compact,
  draggable,
  from,
  onKeyDown,
  menu,
}: {
  row: ViewRow;
  cardProps: string[];
  known: Map<string, KnownProp>;
  compact?: boolean;
  draggable: boolean;
  from: string;
  onKeyDown?(e: React.KeyboardEvent<HTMLButtonElement>): void;
  menu?(e: React.MouseEvent): void;
}) {
  const shown = cardProps.map((k) => ({ k, v: valueOf(row, k) })).filter((x) => !isEmpty(x.v));
  return (
    <button
      type="button"
      className={`sv-card${compact ? ' compact' : ''}`}
      draggable={draggable}
      data-path={row.path}
      title={draggable ? `${row.title} · drag to move it, or Alt and an arrow key` : row.title}
      onClick={(e) => openNote(row.path, e)}
      onAuxClick={(e) => e.button === 1 && openNote(row.path, e)}
      onKeyDown={(e) => {
        // Delete sends the note to Recently deleted, with Undo on the message (5.2.0).
        if (draggable && (e.key === 'Delete' || (e.key === 'Backspace' && (e.ctrlKey || e.metaKey)))) {
          e.preventDefault();
          void A.trashPath(row.path);
          return;
        }
        onKeyDown?.(e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        // The layout's own choices first (Move to…), then everything a note has, Delete last.
        if (menu) menu(e);
        else openMenu({ clientX: e.clientX, clientY: e.clientY }, fileMenu(row.path));
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ path: row.path, from } satisfies Dragged));
        e.dataTransfer.setData('text/plain', row.title);
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.classList.add('is-lifted');
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove('is-lifted')}
    >
      <span className="sv-card-title">{row.title}</span>
      {shown.length > 0 && (
        <span className="sv-card-props">
          {shown.map(({ k, v }) => (
            <span key={k} className="sv-card-prop" title={propWords(k)}>
              <ValueView value={v} kind={kindFor(k, known, v)} />
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

/** How many to draw at first in a long list (a column, a table, a gallery): more come with "Show more". */
export const FIRST = { table: 200, column: 60, day: 3, cards: 60, gallery: 60, timeline: 200 };

/** Each layout's icon (the Display button, the layout picker, empty pages). */
export const LAYOUT_ICON: Record<ViewLayout, IconName> = { table: 'views', board: 'board', calendar: 'calendar', cards: 'grid', list: 'list', gallery: 'image', timeline: 'timeline', chart: 'chart', map: 'pin' };
