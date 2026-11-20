// Page columns (31 Oct 2026, 8.8 database depth): blocks laid side by side on a page, two to four columns. Stored
// as plain Markdown with HTML comments for markers — <!-- columns:2 -->, <!-- column -->, <!-- end columns --> — so
// other apps read the same words in a line and see nothing strange. The reading view draws them side by side; the
// editor (8.8 round 2) hides the markers behind slim labelled dividers and keeps the words editable in place.
// Pure: building, parsing, stripping, adding, removing and undoing here.

/** Two to four columns on a page. */
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 4;

const OPEN = /^[ \t]*<!--[ \t]*columns(?::[ \t]*(\d+)[ \t]*)?[ \t]*-->[ \t]*$/i;
const SEP = /^[ \t]*<!--[ \t]*column[ \t]*-->[ \t]*$/i;
const CLOSE = /^[ \t]*<!--[ \t]*end[ \t]+columns[ \t]*-->[ \t]*$/i;
const FENCE = /^[ \t]*(```|~~~)/;

export interface ColumnBlock {
  /** First and last line (0-based), markers included. */
  start: number;
  end: number;
  count: number;
  /** Each column's Markdown, without the markers. */
  columns: string[];
}

/** <!-- columns:2 --> (or <!-- columns -->) as a count, or null when the line opens no columns. */
export function openColumns(line: string): number | null {
  const m = OPEN.exec(line);
  if (!m) return null;
  const n = m[1] === undefined ? 0 : Number(m[1]);
  return m[1] === undefined ? 0 : n >= MIN_COLUMNS && n <= MAX_COLUMNS ? n : -1;
}

/** Whether a line is any column marker (the editor draws these as dividers rather than hiding them as comments). */
export function isColumnMarker(line: string): boolean {
  return OPEN.test(line) || SEP.test(line) || CLOSE.test(line);
}

/** A divider's label in the editor: "Column 1 of 2" (index 0-based, round 2: the markers never show as text). */
export function columnDividerLabel(index: number, count: number): string {
  return `Column ${index + 1} of ${count}`;
}

/** The separator lines (0-based) inside a block, in order (markers outside code only). */
export function columnSeparators(lines: string[], block: ColumnBlock): number[] {
  const out: number[] = [];
  let fence: string | null = null;
  for (let i = block.start + 1; i < block.end; i++) {
    const f = FENCE.exec(lines[i]);
    if (fence) {
      if (f && f[1] === fence) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    if (SEP.test(lines[i])) out.push(i);
  }
  return out;
}

/** The block holding a line (a marker or a column's words), or null when the line is in no block. */
function blockHolding(text: string, line: number): { block: ColumnBlock; lines: string[] } | null {
  const lines = text.split('\n');
  for (const b of parseColumns(text)) {
    if (line >= b.start && line <= b.end) return { block: b, lines };
  }
  return null;
}

/** An empty column added to the block holding `line` (before its end), or null at four or in no block. */
export function addColumnText(text: string, line: number): string | null {
  const found = blockHolding(text, line);
  if (!found || found.block.count >= MAX_COLUMNS) return null;
  const { block, lines } = found;
  const next = [...lines];
  next[block.start] = `<!-- columns:${block.count + 1} -->`;
  next.splice(block.end, 0, '', '<!-- column -->', '', '');
  return next.join('\n');
}

/** The last column taken away from the block holding `line`, or null at two (undo instead) or in no block. */
export function removeColumnText(text: string, line: number): string | null {
  const found = blockHolding(text, line);
  if (!found || found.block.count <= MIN_COLUMNS) return null;
  const { block, lines } = found;
  const seps = columnSeparators(lines, block);
  const last = seps[seps.length - 1];
  if (last === undefined) return null;
  const next = [...lines];
  next[block.start] = `<!-- columns:${block.count - 1} -->`;
  next.splice(last, block.end - last);
  return next.join('\n');
}

/** The block holding `line` laid out as plain words again, in reading order, or null in no block. */
export function unlayColumnsText(text: string, line: number): string | null {
  const found = blockHolding(text, line);
  if (!found) return null;
  const { block, lines } = found;
  const words = block.columns.filter((c) => c.trim()).join('\n\n');
  const next = [...lines];
  next.splice(block.start, block.end - block.start + 1, ...(words ? words.split('\n') : ['']));
  return next.join('\n');
}

/** Columns built as Markdown: the markers with each column's words between them. */
export function buildColumns(columns: string[]): string {
  const body = columns.map((c) => c.replace(/^\n+|\s+$/g, ''));
  const n = Math.min(Math.max(body.length, MIN_COLUMNS), MAX_COLUMNS);
  while (body.length < n) body.push('');
  return `<!-- columns:${n} -->\n${body.slice(0, n).join('\n\n<!-- column -->\n\n')}\n<!-- end columns -->`;
}

/** The column block opening at `lines[at]` (markers outside code only), or null when none opens there. */
export function columnBlockAt(lines: string[], at: number): ColumnBlock | null {
  const declared = openColumns(lines[at] ?? '');
  if (declared === null || declared === -1) return null;
  const columns: string[][] = [[]];
  let fence: string | null = null;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1] === fence) fence = null;
      columns[columns.length - 1].push(line);
      continue;
    }
    if (f) {
      fence = f[1];
      columns[columns.length - 1].push(line);
      continue;
    }
    if (CLOSE.test(line)) {
      const words = columns.map((ls) => ls.join('\n').replace(/^\n+|\s+$/g, ''));
      const count = words.length;
      // What is actually there wins over what was declared, as long as it is two to four columns.
      if (count < MIN_COLUMNS || count > MAX_COLUMNS) return null;
      return { start: at, end: i, count, columns: words };
    }
    if (SEP.test(line)) {
      columns.push([]);
      continue;
    }
    columns[columns.length - 1].push(line);
  }
  return null;
}

/** Every column block in a note, in order. */
export function parseColumns(text: string): ColumnBlock[] {
  const lines = text.split('\n');
  const out: ColumnBlock[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const f = FENCE.exec(lines[i]);
    if (fence) {
      if (f && f[1] === fence) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    const block = columnBlockAt(lines, i);
    if (block) {
      out.push(block);
      i = block.end;
    }
  }
  return out;
}

/** The note as other apps read it: the markers lifted out, every word kept in reading order. */
export function stripColumnMarkers(text: string): string {
  const lines = text.split('\n');
  const skip = new Set<number>();
  for (const b of parseColumns(text)) {
    skip.add(b.start);
    skip.add(b.end);
    let fence: string | null = null;
    for (let i = b.start + 1; i < b.end; i++) {
      const f = FENCE.exec(lines[i]);
      if (fence) {
        if (f && f[1] === fence) fence = null;
        continue;
      }
      if (f) {
        fence = f[1];
        continue;
      }
      if (SEP.test(lines[i])) skip.add(i);
    }
  }
  return lines.filter((_, i) => !skip.has(i)).join('\n');
}
