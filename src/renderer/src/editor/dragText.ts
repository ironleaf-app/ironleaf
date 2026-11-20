// Dragging selected words to move them (t136, 9 Nov 2026: pressing the mouse on a selection and moving it did
// nothing — the press put the cursor down at once, so no drag ever started). Pressing inside the selection holds it:
// moving past a few pixels drags (the caret follows the drop), letting go without moving puts the cursor there as a
// plain click would. One undo step moves the words back.
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** Presses that are something else's: other buttons, modified presses (Shift extends, Alt selects a block), repeats. */
function isOurs(event: MouseEvent): boolean {
  return event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.detail < 2;
}

/** Plain words, not a control (a tick-box, a link, a table, an embed, a picture): those answer the press themselves. */
function onWords(event: MouseEvent): boolean {
  const target = event.target as HTMLElement;
  return !!target.closest?.('.cm-content') && !target.closest?.('a,button,input,select,textarea,img,.cm-nv-table,.cm-nv-embed');
}

/**
 * A press inside the selected words: hold the selection for a drag. True when held (the caller claims the press).
 * Settles on release: a drag moves the words (or keeps them selected when dropped where they were), a plain click
 * puts the cursor where it landed. Escape, or the window losing the press, keeps the words selected.
 */
export function holdSelectionForDrag(event: MouseEvent, view: EditorView): boolean {
  if (!isOurs(event) || !onWords(event) || view.state.readOnly) return false;
  const sel = view.state.selection.main;
  if (sel.empty) return false;
  const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (at === null || at < sel.from || at > sel.to) return false;
  const from = sel.from;
  const to = sel.to;
  const text = view.state.sliceDoc(from, to);
  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;
  const done = () => {
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('mouseup', up, true);
    window.removeEventListener('keydown', cancel, true);
    window.removeEventListener('blur', cancel);
    view.dom.style.cursor = '';
  };
  const move = (e: MouseEvent) => {
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
      dragging = true;
      view.dom.style.cursor = 'grabbing';
    }
    e.preventDefault();
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos !== null) view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
  };
  const up = (e: MouseEvent) => {
    done();
    view.focus();
    if (!dragging) {
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      view.dispatch({ selection: EditorSelection.cursor(pos ?? to) });
      return;
    }
    const drop = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (drop === null || (drop >= from && drop <= to)) {
      view.dispatch({ selection: EditorSelection.range(from, to) });
      return;
    }
    // Both edits read the same document, earliest first: the words leave, and land at the drop.
    const land = drop > to ? drop - (to - from) : drop;
    view.dispatch({
      changes: drop < from ? [{ from: drop, insert: text }, { from, to }] : [{ from, to }, { from: drop, insert: text }],
      selection: EditorSelection.range(land, land + text.length),
      scrollIntoView: true,
      userEvent: 'input.move',
    });
  };
  const cancel = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
    done();
    view.dispatch({ selection: EditorSelection.range(from, to) });
  };
  window.addEventListener('mousemove', move, true);
  window.addEventListener('mouseup', up, true);
  window.addEventListener('keydown', cancel, true);
  window.addEventListener('blur', cancel);
  return true;
}
