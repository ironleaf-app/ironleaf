// Page columns from the editor (8.8 database depth; src/shared/page-columns.ts): the selected blocks laid side by
// side in two to four columns, or empty columns to fill in. Chosen from the / menu, the Edit menu or the command list.
// Round 2: the markers hide behind dividers (editor/widgets.ts); each divider's handle adds, removes or undoes here.

import type { EditorView } from '@codemirror/view';
import { buildColumns, columnSeparators, MAX_COLUMNS, MIN_COLUMNS, parseColumns } from '../../../shared/page-columns';
import { insertBlock } from './commands';

/** The selection laid out in `n` columns (its paragraphs split across them), or empty columns to fill in. */
export function layOutInColumns(view: EditorView, n: number): void {
  const count = Math.min(Math.max(Math.round(n) || MIN_COLUMNS, MIN_COLUMNS), MAX_COLUMNS);
  const range = view.state.selection.main;
  const words = view.state.sliceDoc(range.from, range.to);
  // A selected slash query (the menu's own words, kept for its picker) is not words to lay out.
  if (!words.trim() || /^\/[\w ]*$/.test(words.trim())) {
    const text = buildColumns(Array.from({ length: count }, () => ''));
    insertBlock(view, text, '<!-- columns:2 -->'.length + 1, /^\/[\w ]*$/.test(words.trim()));
    return;
  }
  const paras = words.replace(/^\n+|\s+$/g, '').split(/\n[ \t]*\n/);
  const size = Math.ceil(paras.length / count);
  const columns: string[] = [];
  for (let i = 0; i < count; i++) columns.push(paras.slice(i * size, (i + 1) * size).join('\n\n'));
  const text = buildColumns(columns);
  // The cursor lands at the end of the last column's words (9.2 uplift F151): the shared block offsets find the
  // last column's content, and the cursor stops where it ends (an empty column: its empty line), never past the
  // closing marker where the next keystroke would break out of the columns.
  const block = parseColumns(text)[0];
  let anchor = range.from + text.length;
  if (block) {
    const lines = text.split('\n');
    const seps = columnSeparators(lines, block);
    const first = (seps.length ? seps[seps.length - 1] : block.start) + 1;
    let line = block.end - 1;
    while (line > first && !lines[line]?.trim()) line--;
    const atLine = lines[line]?.trim() ? line : first;
    const col = lines[line]?.trim() ? (lines[line]?.length ?? 0) : 0;
    anchor = range.from + lines.slice(0, atLine).join('\n').length + (atLine > 0 ? 1 : 0) + col;
  }
  view.dispatch({ changes: { from: range.from, to: range.to, insert: text }, selection: { anchor }, userEvent: 'input' });
  view.focus();
}

/** The block holding a document offset (a divider or a column's words), in the editor's 1-based lines. */
function blockAt(view: EditorView, at: number | null) {
  if (at === null) return null;
  const line0 = view.state.doc.lineAt(at).number - 1;
  const text = view.state.doc.toString();
  const found = parseColumns(text).find((b) => line0 >= b.start && line0 <= b.end);
  return found ? { block: found, lines: text.split('\n') } : null;
}

/** An empty column at the end of the divider's block (nothing at four). */
export function addColumnAt(view: EditorView, at: number | null): void {
  const found = blockAt(view, at);
  if (!found || found.block.count >= MAX_COLUMNS) return;
  const { block } = found;
  const open = view.state.doc.line(block.start + 1);
  const close = view.state.doc.line(block.end + 1);
  // The cursor lands on the new column's empty line (F151's same rule): at the closing line's head, never past
  // the marker where the next keystroke would break it.
  view.dispatch({
    changes: [
      { from: open.from, to: open.to, insert: `<!-- columns:${block.count + 1} -->` },
      { from: close.from, insert: '\n<!-- column -->\n\n' },
    ],
    selection: { anchor: close.from + '\n<!-- column -->\n'.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}

/** The last column taken away from the divider's block (nothing at two; undo instead). */
export function removeColumnAt(view: EditorView, at: number | null): void {
  const found = blockAt(view, at);
  if (!found || found.block.count <= MIN_COLUMNS) return;
  const { block, lines } = found;
  const seps = columnSeparators(lines, block);
  const last = seps[seps.length - 1];
  if (last === undefined) return;
  const open = view.state.doc.line(block.start + 1);
  const from = view.state.doc.line(last + 1).from;
  const to = view.state.doc.line(block.end + 1).from;
  view.dispatch({
    changes: [
      { from: open.from, to: open.to, insert: `<!-- columns:${block.count - 1} -->` },
      { from, to, insert: '' },
    ],
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}

/** The divider's block laid out as plain words again, in reading order. */
export function unlayColumnsAt(view: EditorView, at: number | null): void {
  const found = blockAt(view, at);
  if (!found) return;
  const { block } = found;
  const from = view.state.doc.line(block.start + 1).from;
  const to = view.state.doc.line(block.end + 1).to;
  const words = block.columns.filter((c) => c.trim()).join('\n\n');
  view.dispatch({ changes: { from, to, insert: words || '' }, selection: { anchor: from + (words ? words.length : 0) }, scrollIntoView: true, userEvent: 'input' });
  view.focus();
}
