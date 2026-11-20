// Editing commands for notes: bold and the other marks, links, headings, lists and tick-boxes, tables, callouts, code
// and maths blocks, comments, extra cursors. Each works on every selection and returns whether it did something.

import { EditorSelection, type ChangeSpec, type SelectionRange } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { indentUnit, syntaxTree } from '@codemirror/language';
import { formatDate } from '../../../shared/dates';
import { frontMatterRange } from '../../../shared/frontmatter';
import { applyHighlight, type HighlightColour } from '../lib/highlights';

/** Wraps (or unwraps) each selection in `mark` (**, *, ~~, ==, `, %%). With nothing selected, the word at the cursor. */
export function toggleMark(view: EditorView, mark: string): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    let { from, to } = range;
    if (from === to) {
      const word = state.wordAt(from);
      if (word) ({ from, to } = word);
    }
    const before = state.sliceDoc(from - mark.length, from);
    const after = state.sliceDoc(to, to + mark.length);
    if (before === mark && after === mark) {
      return {
        changes: [
          { from: from - mark.length, to: from },
          { from: to, to: to + mark.length },
        ],
        range: EditorSelection.range(range.anchor - mark.length, range.head - mark.length),
      };
    }
    const inner = state.sliceDoc(from, to);
    if (inner.startsWith(mark) && inner.endsWith(mark) && inner.length >= mark.length * 2) {
      return { changes: { from, to, insert: inner.slice(mark.length, inner.length - mark.length) }, range: EditorSelection.range(from, to - mark.length * 2) };
    }
    if (from === to) return { changes: { from, insert: mark + mark }, range: EditorSelection.cursor(from + mark.length) };
    return {
      changes: [
        { from, insert: mark },
        { from: to, insert: mark },
      ],
      range: EditorSelection.range(from + mark.length, to + mark.length),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
  return true;
}

/**
 * Highlights the selection in a colour (lib/highlights.ts: yellow as ==words==, the others as <mark class="nv-…">), or
 * takes the highlight off (null). Choosing the colour it already has takes it off. With nothing selected, the highlight
 * around the cursor, else the word at the cursor.
 */
export function setHighlight(view: EditorView, colour: HighlightColour | null): boolean {
  const { state } = view;
  let { from, to } = state.selection.main;
  // Only the lines the selection is on are read (a long note is not copied for one word).
  const start = state.doc.lineAt(from).from;
  const text = state.sliceDoc(start, state.doc.lineAt(to).to);
  let edit = applyHighlight(text, from - start, to - start, colour);
  if (!edit && from === to && colour) {
    const word = state.wordAt(from);
    if (word) {
      ({ from, to } = word);
      edit = applyHighlight(text, from - start, to - start, colour);
    }
  }
  if (!edit) return false;
  view.dispatch({
    changes: edit.changes.map((c) => ({ from: c.from + start, to: c.to + start, insert: c.insert })),
    selection: EditorSelection.range(edit.selection.from + start, edit.selection.to + start),
    scrollIntoView: true,
    userEvent: 'input.format',
  });
  return true;
}

/** Mod+U (the command registry's binding): the selection becomes a link (a web address as [text](address), else a [[link]]). */
export function insertLink(view: EditorView, wikilinks: boolean): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    if (/^https?:\/\/\S+$/.test(text)) {
      const insert = `[](${text})`;
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + 1) };
    }
    if (!wikilinks) {
      const insert = `[${text}]()`;
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length - 1) };
    }
    const insert = `[[${text}]]`;
    return { changes: { from: range.from, to: range.to, insert }, range: text ? EditorSelection.range(range.from + 2, range.from + 2 + text.length) : EditorSelection.cursor(range.from + 2) };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }));
  return true;
}

function eachLine(view: EditorView, fn: (text: string) => string): boolean {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      // A selection ending at a line's start only touches that line (fnv3 F18), and a blank line stays blank.
      if (pos === range.to && range.to > range.from && pos === line.from) break;
      if (!seen.has(line.number)) {
        seen.add(line.number);
        if (line.text.trim()) { const next = fn(line.text); if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next }); }
      }
      pos = line.to + 1;
    }
  }
  if (!changes.length) return false;
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
  return true;
}

/** A heading of this level (0 makes the line plain text again). */
export function setHeading(view: EditorView, level: number): boolean {
  return eachLine(view, (text) => {
    const body = text.replace(/^\s{0,3}#{1,6}\s+/, '');
    const current = /^\s{0,3}(#{1,6})\s/.exec(text)?.[1].length ?? 0;
    if (level === 0 || current === level) return body;
    return `${'#'.repeat(level)} ${body}`;
  });
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(\[.\]\s+)?/;

export function toggleBullet(view: EditorView): boolean {
  return eachLine(view, (text) => {
    const m = LIST.exec(text);
    if (m && /[-*+]/.test(m[2]) && !m[3]) return m[1] + text.slice(m[0].length);
    // A task line keeps its tick (fnv3 F19): changing the marker never deletes done state.
    return (m ? m[1] : /^\s*/.exec(text)![0]) + '- ' + (m?.[3] ?? '') + (m ? text.slice(m[0].length) : text.trimStart());
  });
}

export function toggleNumbered(view: EditorView): boolean {
  let n = 0;
  return eachLine(view, (text) => {
    const m = LIST.exec(text);
    if (m && /\d/.test(m[2]) && !m[3]) return m[1] + text.slice(m[0].length);
    n++;
    return (m ? m[1] : /^\s*/.exec(text)![0]) + `${n}. ` + (m?.[3] ?? '') + (m ? text.slice(m[0].length) : text.trimStart());
  });
}

/** Mod+L (the command registry's binding): plain line → tick-box → ticked → tick-box. */
export function cycleTask(view: EditorView): boolean {
  return eachLine(view, (text) => {
    const m = LIST.exec(text);
    if (m?.[3]) {
      const done = !/\[ \]/.test(m[3]);
      return m[1] + m[2] + ' ' + (done ? '[ ] ' : '[x] ') + text.slice(m[0].length);
    }
    if (m) return m[1] + m[2] + ' [ ] ' + text.slice(m[0].length);
    const indent = /^\s*/.exec(text)![0];
    return `${indent}- [ ] ${text.slice(indent.length)}`;
  });
}

/**
 * Tab on a list line indents the item itself (Shift+Tab outdents it), wherever the cursor is on the line — as a
 * person expects from a notes app (t136, 9 Nov 2026: Tab at a list line's end appended a tab character after its
 * words instead). One step for the whole selection, so one Ctrl+Z undoes it. False when no list line is touched,
 * so the key falls through to a plain indent. Never inside fenced code or the properties (indent means something
 * else there, and a tab would break YAML).
 */
export function indentListItem(view: EditorView, back: boolean): boolean {
  const { state } = view;
  const unit = state.facet(indentUnit);
  const fm = frontMatterRange(state.sliceDoc(0, Math.min(state.doc.length, 50000)));
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  const inCode = (pos: number): boolean => {
    for (let n = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent!) if (n.name === 'FencedCode' || n.name === 'CodeBlock') return true;
    return false;
  };
  for (const range of state.selection.ranges) {
    for (let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      if (pos === range.to && range.to > range.from && pos === line.from) break;
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const m = LIST.exec(line.text);
        if (m && !(fm && line.from < fm.to) && !inCode(line.from + m[1].length)) {
          if (!back) {
            changes.push({ from: line.from, insert: unit });
          } else if (line.text.startsWith(unit)) {
            changes.push({ from: line.from, to: line.from + unit.length });
          } else {
            const leading = /^\s*/.exec(line.text)![0];
            if (leading) {
              let cols = 0;
              let chars = 0;
              for (const ch of leading) {
                cols += ch === '\t' ? state.tabSize - (cols % state.tabSize) : 1;
                chars++;
                if (cols >= state.tabSize) break;
              }
              changes.push({ from: line.from, to: line.from + chars });
            }
          }
        }
      }
      pos = line.to + 1;
    }
  }
  if (!changes.length) return false;
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.indent' });
  return true;
}

export function toggleQuote(view: EditorView): boolean {
  const { state } = view;
  const lines = state.selection.ranges.flatMap((r) => {
    const out: string[] = [];
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos);
      out.push(line.text);
      pos = line.to + 1;
    }
    return out;
  });
  const allQuoted = lines.every((l) => /^\s*>/.test(l) || !l.trim());
  return eachLine(view, (text) => (allQuoted ? text.replace(/^(\s*)>\s?/, '$1') : `> ${text}`));
}

/** Puts a block in on its own lines at the cursor, with the cursor where typing goes. With replaceSelection
 *  (code block, callout: the block already holds the selected words) the selection is replaced, never kept
 *  beside its copy (fnv3 F20). */
export function insertBlock(view: EditorView, text: string, cursorAt: number = text.length, replaceSelection = false): boolean {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const blankLine = !line.text.trim() && !(replaceSelection && range.to > range.from);
  const from = blankLine ? line.from : replaceSelection ? range.from : range.to;
  const to = blankLine ? line.to : range.to;
  const before = blankLine || from === 0 ? '' : '\n\n';
  const nextLine = to < state.doc.length ? state.doc.lineAt(to + 1) : null;
  const after = nextLine && nextLine.text.trim() ? '\n' : '';
  const insert = before + text + after;
  view.dispatch({ changes: { from, to, insert }, selection: EditorSelection.cursor(from + before.length + cursorAt), scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

export function insertTable(view: EditorView, cols = 3, rows = 2): boolean {
  const header = `| ${Array.from({ length: cols }, (_, i) => `Column ${i + 1}`).join(' | ')} |`;
  const rule = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`;
  const body = Array.from({ length: rows }, () => `| ${Array.from({ length: cols }, () => '   ').join(' | ')} |`).join('\n');
  return insertBlock(view, `${header}\n${rule}\n${body}`, 2);
}

export function insertCallout(view: EditorView, kind = 'note'): boolean {
  const text = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  const body = text ? text.split('\n').map((l) => `> ${l}`).join('\n') : '> ';
  return insertBlock(view, `> [!${kind}]\n${body}`, `> [!${kind}]\n`.length + (text ? body.length : 2), !!text);
}

export function insertCodeBlock(view: EditorView, lang = ''): boolean {
  const text = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  return insertBlock(view, `\`\`\`${lang}\n${text}\n\`\`\``, lang ? 4 + lang.length + text.length : 3, !!text);
}

export function insertMathBlock(view: EditorView): boolean {
  return insertBlock(view, '$$\n\n$$', 3);
}

/** A diagram (8.8): a Mermaid block with three boxes to start from, drawn in the reading view. */
export function insertMermaid(view: EditorView): boolean {
  return insertBlock(view, '```mermaid\ngraph LR\n  A[Idea] --> B[Draft]\n  B --> C[Done]\n```', 61);
}

export function insertRule(view: EditorView): boolean {
  return insertBlock(view, '---\n', 4);
}

/** A new footnote: the reference at the cursor and its definition at the end of the note. */
export function insertFootnote(view: EditorView): boolean {
  const { state } = view;
  const used = new Set([...state.doc.toString().matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1])));
  let n = 1;
  while (used.has(n)) n++;
  const at = state.selection.main.to;
  const end = state.doc.length;
  const tail = state.doc.toString().endsWith('\n') ? '' : '\n';
  const definition = `${tail}\n[^${n}]: `;
  view.dispatch({
    changes: [
      { from: at, insert: `[^${n}]` },
      { from: end, insert: definition },
    ],
    selection: EditorSelection.cursor(end + `[^${n}]`.length + definition.length),
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

export function insertText(view: EditorView, text: string): boolean {
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
  return true;
}

export function insertDate(view: EditorView, format: string): boolean {
  return insertText(view, formatDate(format));
}

/** Adds a cursor on the line above (-1) or below (+1) each cursor, in the same column. */
export function addCursor(view: EditorView, dir: -1 | 1): boolean {
  const { state } = view;
  const ranges: SelectionRange[] = [...state.selection.ranges];
  for (const r of state.selection.ranges) {
    const line = state.doc.lineAt(r.head);
    const target = line.number + dir;
    if (target < 1 || target > state.doc.lines) continue;
    const next = state.doc.line(target);
    ranges.push(EditorSelection.cursor(next.from + Math.min(r.head - line.from, next.length)));
  }
  view.dispatch({ selection: EditorSelection.create(ranges, ranges.length - 1), scrollIntoView: true });
  return true;
}

/** The table the cursor is in: its lines, cells and where the cursor is. */
function tableAt(view: EditorView): { start: number; end: number; rows: string[][]; row: number; col: number } | null {
  const { state } = view;
  const cursor = state.selection.main.head;
  const line = state.doc.lineAt(cursor);
  if (!/^\s*\|/.test(line.text)) return null;
  let start = line.number;
  let end = line.number;
  while (start > 1 && /^\s*\|/.test(state.doc.line(start - 1).text)) start--;
  while (end < state.doc.lines && /^\s*\|/.test(state.doc.line(end + 1).text)) end++;
  const split = (text: string) => {
    let t = text.trim();
    if (t.startsWith('|')) t = t.slice(1);
    if (t.endsWith('|')) t = t.slice(0, -1);
    return t.split(/(?<!\\)\|/).map((c) => c.trim());
  };
  const rows: string[][] = [];
  for (let n = start; n <= end; n++) rows.push(split(state.doc.line(n).text));
  const before = line.text.slice(0, cursor - line.from);
  const col = Math.max(0, (before.match(/(?<!\\)\|/g) ?? []).length - 1);
  return { start, end, rows, row: line.number - start, col };
}

function writeTable(view: EditorView, t: { start: number; end: number }, rows: string[][], focus: { row: number; col: number }): void {
  const cols = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...rows.map((r, i) => (i === 1 ? 3 : (r[c] ?? '').length))));
  const lines = rows.map((r, i) =>
    `| ${Array.from({ length: cols }, (_, c) => {
      if (i === 1) {
        const cell = r[c] ?? '---';
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        return `${left ? ':' : ''}${'-'.repeat(Math.max(3, widths[c] - (left ? 1 : 0) - (right ? 1 : 0)))}${right ? ':' : ''}`;
      }
      return (r[c] ?? '').padEnd(widths[c]);
    }).join(' | ')} |`,
  );
  const { state } = view;
  const from = state.doc.line(t.start).from;
  const to = state.doc.line(t.end).to;
  const text = lines.join('\n');
  const rowLine = lines.slice(0, focus.row).join('\n').length + (focus.row ? 1 : 0);
  let colAt = 2;
  for (let c = 0; c < focus.col; c++) colAt += widths[c] + 3;
  view.dispatch({ changes: { from, to, insert: text }, selection: EditorSelection.cursor(from + rowLine + colAt), scrollIntoView: true, userEvent: 'input' });
}

export type TableAction = 'row-below' | 'row-above' | 'col-right' | 'col-left' | 'delete-row' | 'delete-col' | 'align-left' | 'align-center' | 'align-right' | 'format';

export function tableCommand(view: EditorView, action: TableAction): boolean {
  const t = tableAt(view);
  if (!t) return false;
  const rows = t.rows.map((r) => [...r]);
  const cols = Math.max(...rows.map((r) => r.length));
  let { row, col } = t;
  switch (action) {
    case 'row-below':
    case 'row-above': {
      const at = action === 'row-below' ? Math.max(row, 1) + 1 : Math.max(row, 2);
      rows.splice(at, 0, Array.from({ length: cols }, () => ''));
      row = at;
      break;
    }
    case 'col-right':
    case 'col-left': {
      const at = action === 'col-right' ? col + 1 : col;
      rows.forEach((r, i) => r.splice(at, 0, i === 1 ? '---' : ''));
      col = at;
      break;
    }
    case 'delete-row':
      if (row < 2 || rows.length <= 3) return false;
      rows.splice(row, 1);
      row = Math.min(row, rows.length - 1);
      break;
    case 'delete-col':
      if (cols <= 1) return false;
      rows.forEach((r) => r.splice(col, 1));
      col = Math.max(0, col - 1);
      break;
    case 'align-left':
    case 'align-center':
    case 'align-right':
      rows[1][col] = action === 'align-left' ? ':---' : action === 'align-center' ? ':---:' : '---:';
      break;
    case 'format':
      break;
  }
  writeTable(view, t, rows, { row, col });
  return true;
}

/** The doc range a table cell's words cover (its pipes and padding outside it), in the text as written. */
function cellRange(view: EditorView, t: { start: number }, row: number, col: number): { from: number; to: number } {
  const line = view.state.doc.line(t.start + row);
  let seen = -1;
  for (let i = 0; i < line.text.length; i++) {
    if (line.text[i] === '|' && line.text[i - 1] !== '\\') {
      seen++;
      if (seen === col) {
        let from = i + 1;
        while (line.text[from] === ' ') from++;
        let end = from;
        while (end < line.text.length && (line.text[end] !== '|' || line.text[end - 1] === '\\')) end++;
        let to = end;
        while (to > from && line.text[to - 1] === ' ') to--;
        return { from: line.from + from, to: line.from + to };
      }
    }
  }
  return { from: line.from, to: line.from };
}

/** A table's rule row: every cell dashes, with an optional alignment colon. Without one the pipes are prose
 *  (a shell line, a first header), not a table. */
const isRuleRow = (cells: string[]): boolean => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

/** Tab in a table moves to the next cell (Shift+Tab, the one before) and selects its words, as a form does, so
 *  typing replaces them (t149, 9 Nov 2026: typing gave "FlourColumn 2"); after the last cell, a new row. Moving
 *  is selection only (fnv3 F21): the table as written is never reformatted, and no undo step or save is made,
 *  just to move. Shift+Tab in the first cell does nothing here, so the key falls through to unindent. */
export function tableTab(view: EditorView, back: boolean): boolean {
  const t = tableAt(view);
  if (!t) return false;
  // Only a ruled table moves (t158, 9 Nov 2026: Tab in `| only |` threw past the document, and in two rule-less
  // lines rewrote the second to dashes, typed words gone. Pipe prose keeps the plain Tab, as Shift+Tab in the
  // first cell already falls through).
  if (t.rows.length < 2 || !isRuleRow(t.rows[1])) return false;
  const cols = Math.max(...t.rows.map((r) => r.length));
  let { row, col } = t;
  if (back) {
    if (row === 0 && col === 0) return false;
    col--;
    if (col < 0) {
      row = row === 2 ? 0 : row - 1;
      col = cols - 1;
      if (row < 0) return false;
    }
  } else {
    col++;
    if (col >= cols) {
      col = 0;
      row = row === 0 ? 2 : row + 1;
      if (row >= t.rows.length) {
        const rows = t.rows.map((r) => [...r]);
        rows.push(Array.from({ length: cols }, () => ''));
        writeTable(view, t, rows, { row, col });
        return true;
      }
    }
  }
  const at = cellRange(view, t, row, col);
  view.dispatch({ selection: EditorSelection.range(at.from, at.to), scrollIntoView: true });
  return true;
}
