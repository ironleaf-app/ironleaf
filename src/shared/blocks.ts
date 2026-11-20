// Block references (V12, 28 Oct 2026): a paragraph, list item, heading, quote or table can carry an id, written as "
// ^id" at the end of its last line, or as "^id" alone on the line straight after a table, list or quote. A link
// [[Note#^id]] jumps to that block and ![[Note#^id]] draws it in another note. The format is the open Markdown-folder
// one people's notes already use (and what the Logseq and Roam importers write for their own block ids), read from the
// files alone. Pure: the editor, the reading view, the indexer and the former host app's importers share it.

/** An id: letters, digits and dashes (Logseq's and Roam's own ids fit). */
export const BLOCK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
/** " ^id" at the end of a line. */
const TRAILING = /(?:^|[ \t])\^([A-Za-z0-9][A-Za-z0-9-]{0,63})[ \t]*$/;
/** "^id" alone on a line. */
const ALONE = /^[ \t]*\^([A-Za-z0-9][A-Za-z0-9-]{0,63})[ \t]*$/;
const FENCE = /^[ \t]*(```|~~~)/;
const LIST = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+/;
const HEADING = /^#{1,6}[ \t]/;

/** Each line's place in or out of fenced code (an id inside code is only words). */
function codeLines(lines: string[]): boolean[] {
  const out: boolean[] = [];
  let fence: string | null = null;
  for (const l of lines) {
    const m = FENCE.exec(l);
    if (fence) {
      out.push(true);
      if (m && m[1] === fence) fence = null;
    } else if (m) {
      fence = m[1];
      out.push(true);
    } else out.push(false);
  }
  return out;
}

/** The block id a line carries (at its end or alone on it), if any. */
export function lineBlockId(line: string): string | null {
  const m = ALONE.exec(line) ?? TRAILING.exec(line);
  return m ? m[1] : null;
}

/** A line without its block id (the words before " ^id"; "" for an id alone on its line). */
export function withoutBlockId(line: string): string {
  if (ALONE.test(line)) return '';
  return line.replace(TRAILING, '').replace(/[ \t]+$/, '');
}

export interface BlockPlace {
  id: string;
  /** The block's first and last line (0-based), id line included when the id stands alone. */
  from: number;
  to: number;
}

const indentOf = (l: string) => /^[ \t]*/.exec(l)![0].replace(/\t/g, '    ').length;

/** Where a block starts and ends, given the line its id is on. */
function placeOf(lines: string[], code: boolean[], at: number, id: string): BlockPlace {
  const alone = ALONE.test(lines[at]);
  // An id alone on its line names the block just above it (a table, a list, a quote, a paragraph).
  let last = alone ? at - 1 : at;
  while (alone && last >= 0 && !lines[last].trim()) last--;
  if (last < 0) return { id, from: at, to: at };
  const blank = (i: number) => !lines[i].trim() || code[i];
  if (HEADING.test(lines[last])) return { id, from: last, to: at };
  const item = LIST.exec(lines[last]);
  if (item && !alone) {
    // A list item and the lines indented under it (its own children).
    const ind = indentOf(lines[last]);
    let end = last;
    while (end + 1 < lines.length && lines[end + 1].trim() && indentOf(lines[end + 1]) > ind && !code[end + 1]) end++;
    return { id, from: last, to: end };
  }
  // A paragraph (or a list, quote or table when the id stands alone): back to the blank line or heading before it.
  let first = last;
  while (first - 1 >= 0 && !blank(first - 1) && !HEADING.test(lines[first - 1])) {
    // Inside a list, a trailing id belongs to its own item: stop at the item's start.
    if (!alone && LIST.test(lines[first])) break;
    first--;
  }
  return { id, from: first, to: at };
}

/** Every block id in a note, with where its block is. */
export function blockPlaces(text: string): BlockPlace[] {
  const lines = text.split(/\r?\n/);
  const code = codeLines(lines);
  const out: BlockPlace[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (code[i]) continue;
    const id = lineBlockId(lines[i]);
    if (id) out.push(placeOf(lines, code, i, id));
  }
  return out;
}

/** The block ids a note carries. */
export const blockIds = (text: string): string[] => blockPlaces(text).map((b) => b.id);

/** The block an id names (its own lines, without the id), or null when the note has no such block. Case is ignored. */
export function blockOf(text: string, id: string): { text: string; line: number } | null {
  const want = id.replace(/^\^/, '').toLowerCase();
  const place = blockPlaces(text).find((b) => b.id.toLowerCase() === want);
  if (!place) return null;
  const lines = text.split(/\r?\n/).slice(place.from, place.to + 1).map(withoutBlockId);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return { text: lines.join('\n'), line: place.from };
}

/** A fresh id for a block (6 letters and digits), not one the note already has. */
export function newBlockId(text: string, random: () => number = Math.random): string {
  const have = new Set(blockIds(text).map((x) => x.toLowerCase()));
  for (;;) {
    const id = Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]).join('');
    if (!have.has(id) && /[a-z]/.test(id)) return id;
  }
}
