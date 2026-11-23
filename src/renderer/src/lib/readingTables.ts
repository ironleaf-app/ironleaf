// Reading's tables as the person changes them (4 Nov 2026): the DOM half of the mechanism, shared
// by ReadingView and the headless proof. A Markdown table's row is one source line (the header, the
// rule, then a line per row; the renderer numbers every block in data-line), so a shown cell maps
// to its source line and column, and the source line maps back (src/shared/layouts.ts
// tableLineCell/setTableLineCell). The headings are structure, never edited; a single click never
// edits.
import { isEnterKey } from './enterKey';

/** The editable cells under `root`: their element with the source line and column each maps to. */
export function editableCells(root: ParentNode, readCell: (line: number, col: number) => string | null): { td: HTMLTableCellElement; line: number; col: number }[] {
  const out: { td: HTMLTableCellElement; line: number; col: number }[] = [];
  for (const table of root.querySelectorAll('table[data-line]')) {
    const start = Number((table as HTMLElement).dataset.line);
    if (!Number.isFinite(start)) continue;
    table.querySelectorAll('tbody tr').forEach((tr, ri) => {
      tr.querySelectorAll('td').forEach((td, ci) => {
        const line = start + 2 + ri;
        if (readCell(line, ci) === null) return;
        out.push({ td: td as HTMLTableCellElement, line, col: ci });
      });
    });
  }
  return out;
}

/** What a cell says it does: a cell holding a link opens it on a click, and changes from its pencil. */
const LINK_TITLE = 'Click the link to open it, the pencil to change the cell';
const CELL_TITLE = 'Double-click to change';
function cellTitle(td: HTMLTableCellElement): string {
  return td.querySelector('a') ? LINK_TITLE : CELL_TITLE;
}

/** Offer the field on every editable cell under `root` (tabindex, title and where it writes). */
export function markEditableCells(root: ParentNode, readCell: (line: number, col: number) => string | null): void {
  for (const { td, line, col } of editableCells(root, readCell)) {
    td.dataset.editable = '1';
    td.dataset.line = String(line);
    td.dataset.col = String(col);
    td.tabIndex = 0;
    td.title = cellTitle(td);
  }
}

/** Our own pencil drawing (components/Icon.tsx PATHS.pencil), for the cells React does not draw. */
const PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3"/></svg>';

/**
 * A pencil at the end of every editable cell holding a link (round 2: a single click still opens the link, and mouse
 * people need a way to change it too). Clicks are read where the page reads all clicks (ReadingView's handler, by the
 * button's class), so a pencil put back after a change needs no wiring of its own.
 */
export function pencilCells(root: ParentNode): void {
  for (const td of root.querySelectorAll('td[data-editable="1"]')) {
    if (!td.querySelector('a') || td.querySelector(':scope > .nv-cell-edit')) continue;
    const pencil = document.createElement('button');
    pencil.type = 'button';
    pencil.className = 'nv-cell-edit';
    pencil.tabIndex = -1;
    pencil.title = 'Change the cell';
    pencil.setAttribute('aria-label', 'Change the cell');
    pencil.innerHTML = PENCIL;
    td.appendChild(pencil);
  }
}

/**
 * The kit's field over one cell: Enter or clicking away saves (through `save`;
 * a refused save puts the cell back), Esc puts it back. Resolves when the
 * field closes. Only one field is ever open (a second call while one is open
 * resolves false at once).
 */
let open: { td: HTMLTableCellElement; close(save: boolean): void } | null = null;

export function editTableCell(
  td: HTMLTableCellElement,
  readCell: (line: number, col: number) => string | null,
  save: (line: number, col: number, value: string) => boolean,
): Promise<boolean> {
  const line = Number(td.dataset.line), col = Number(td.dataset.col);
  const words = open || !Number.isFinite(line) || !Number.isFinite(col) ? null : readCell(line, col);
  if (words === null || td.querySelector('input.nv-cell-input')) return Promise.resolve(false);
  return new Promise((resolve) => {
    const before = td.innerHTML;
    const hadLink = td.querySelector('a') !== null;
    td.removeAttribute('title');
    const input = document.createElement('input');
    input.className = 'input nv-cell-input';
    input.value = words;
    input.setAttribute('aria-label', 'Change the cell');
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const close = (keep: boolean) => {
      // Decided first: putting the cell back takes the focused field out of the page, whose blur lands back here.
      if (done) return;
      done = true;
      open = null;
      td.title = hadLink ? LINK_TITLE : CELL_TITLE;
      if (keep && input.value !== words) {
        if (save(line, col, input.value)) return resolve(true); // The note re-reads and draws the new cell.
        td.innerHTML = before;
        td.focus();
        return resolve(false);
      }
      td.innerHTML = before;
      resolve(true);
    };
    open = { td, close };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (isEnterKey(e)) {
        e.preventDefault();
        close(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      }
    });
    input.addEventListener('blur', () => close(true));
  });
}

/** The open field, if one is being changed (the headless proof reads it; the window never needs it). */
export function openTableCell(): { td: HTMLTableCellElement; close(save: boolean): void } | null {
  return open;
}

/** No field is open (the page drew again: a field from the last draw is gone with it). */
export function resetTableCell(): void {
  open = null;
}
