// Reading mode: the note as a page. Links open (Ctrl+click in a new tab), tags search, tick-boxes tick (written back to
// the note), table cells change where they are (double-click, or Tab to one and Enter: the kit's field, written back to
// the cell's source line, 4 Nov 2026; a cell holding a link changes from its pencil or the keyboard, its link still
// opening on a click), callouts fold, code copies, embedded notes and diagrams fill in, and hovering a link previews
// it. A single click still never edits.

import { usePrefs } from '../state/store';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { hydrate } from '../lib/hydrate';
import { renderMarkdown, wikilinkFromClick } from '../lib/markdownRender';
import { editTableCell, markEditableCells, pencilCells, resetTableCell } from '../lib/readingTables';
import { hoverLink } from './HoverPreview';
import { isEnterKey } from '../lib/enterKey';

interface ReadingViewProps {
  text: string;
  path: string;
  header?: ReactNode;
  /** After the note: its links and related notes (components/NoteFoot.tsx). */
  footer?: ReactNode;
  className?: string;
  interactive?: boolean;
  onOpenLink(target: string, newTab: boolean): void;
  onOpenTag(tag: string): void;
  onToggleTask?(line: number): void;
  /** A table cell's words as written (null when the cell has no source line to write). */
  onEditTableCell?(line: number, col: number): string | null;
  /** A table cell saved: resolves whether it was written. */
  onSaveTableCell?(line: number, col: number, value: string): boolean;
  scrollRef?: React.Ref<HTMLDivElement>;
}

export function ReadingView({ text, path, header, footer, className, interactive = true, onOpenLink, onOpenTag, onToggleTask, onEditTableCell, onSaveTableCell, scrollRef }: ReadingViewProps) {
  const { strictBreaks, propertiesShow } = usePrefs();
  const propertiesAsText = propertiesShow === 'source' && interactive;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- line breaks change how the same text renders
  const html = useMemo(() => renderMarkdown(text, { from: path, interactive, propertiesAsText }), [text, path, interactive, propertiesAsText, strictBreaks]);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (body.current) void hydrate(body.current);
  }, [html]);

  // Table cells that map to a source line offer the field (lib/readingTables.ts: a row is one source line).
  useEffect(() => {
    resetTableCell();
    if (!interactive || !onEditTableCell || !body.current) return;
    markEditableCells(body.current, onEditTableCell);
    pencilCells(body.current);
  }, [html, interactive, onEditTableCell]);

  /** The kit's field over one cell: Enter or clicking away saves, Esc puts it back. */
  const editCell = (td: HTMLTableCellElement) => {
    if (!onEditTableCell || !onSaveTableCell) return;
    void editTableCell(td, onEditTableCell, onSaveTableCell);
  };

  return (
    <div className={`reading ${className ?? ''}`} ref={scrollRef}>
      <div className="reading-page">
        {header}
        <div
          ref={body}
          className="markdown reading-body"
          onClick={(e) => {
            const el = e.target as HTMLElement;
            // A link cell's pencil: the link itself still opens on a click (below); the pencil changes the cell.
            const pencil = el.closest('.nv-cell-edit');
            if (pencil) {
              const td = pencil.closest('td[data-editable]') as HTMLTableCellElement | null;
              if (td && body.current?.contains(td)) {
                e.preventDefault();
                e.stopPropagation();
                editCell(td);
              }
              return;
            }
            const box = el.closest('input.task-checkbox') as HTMLInputElement | null;
            if (box) {
              const line = Number(box.dataset.line);
              if (onToggleTask && Number.isFinite(line) && line >= 0) onToggleTask(line);
              return;
            }
            const target = wikilinkFromClick(e);
            if (target !== null) {
              e.preventDefault();
              onOpenLink(target, e.ctrlKey || e.metaKey);
              return;
            }
            const tag = el.closest('a.tag') as HTMLElement | null;
            if (tag) {
              e.preventDefault();
              onOpenTag(tag.dataset.tag ?? '');
              return;
            }
            const fold = el.closest('.callout.is-foldable > .callout-title');
            if (fold) {
              fold.parentElement?.classList.toggle('is-collapsed');
              return;
            }
            const copy = el.closest('.code-copy') as HTMLElement | null;
            if (copy) {
              const code = copy.closest('.code-block')?.querySelector('code')?.textContent ?? '';
              void navigator.clipboard.writeText(code);
              copy.classList.add('is-done');
              setTimeout(() => copy.classList.remove('is-done'), 1200);
            }
          }}
          onDoubleClick={(e) => {
            // (A double-click selects a word: that isn't someone selecting text to copy. A cell holding a link still
            // opens it on the first click, as before: link cells change from their pencil or the keyboard.)
            const td = (e.target as HTMLElement).closest?.('td[data-editable]') as HTMLTableCellElement | null;
            if (!td || !body.current?.contains(td)) return;
            e.preventDefault();
            e.stopPropagation();
            window.getSelection()?.removeAllRanges();
            editCell(td);
          }}
          onKeyDown={(e) => {
            const td = (e.target as HTMLElement).closest?.('td[data-editable]') as HTMLTableCellElement | null;
            if (!td || e.target !== td || e.altKey || e.ctrlKey || e.metaKey) return;
            if (isEnterKey(e) || e.key === 'F2' || e.key === 'e' || e.key === 'E') {
              e.preventDefault();
              editCell(td);
            }
          }}
          onMouseOver={(e) => {
            const a = (e.target as HTMLElement).closest('a.internal-link') as HTMLElement | null;
            if (a) hoverLink(a.dataset.href ?? '', a, path, 350, e.ctrlKey || e.metaKey);
          }}
          // markdown-it runs with raw HTML switched off, so this holds no scripts or HTML from the note.
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {footer}
      </div>
    </div>
  );
}
