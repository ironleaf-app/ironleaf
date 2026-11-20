// Highlights in colour, kept as Markdown other apps read (19 Oct 2026, 5.0.0: six named colours). Yellow, the usual
// highlight, is written ==like this==. The other five are written as HTML's own highlight tag with a class,
// <mark class="nv-green">like this</mark>: any Markdown app that shows HTML draws it highlighted (in its own yellow if it
// does not know our colours), and one that does not still shows the words. Only these exact tags are read as colours,
// so nothing else written in angle brackets ever turns into a page element. No imports, so the editor, the page renderer
// and the tests share it.

export const HIGHLIGHT_COLOURS = [
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
  { id: 'pink', label: 'Pink' },
  { id: 'purple', label: 'Purple' },
  { id: 'orange', label: 'Orange' },
] as const;

export type HighlightColour = (typeof HIGHLIGHT_COLOURS)[number]['id'];

/** The opening tag of a coloured highlight (yellow is written ==…== instead, so it is not here). */
export const COLOUR_OPEN = /^<mark class="nv-(green|blue|pink|purple|orange|yellow)">/;
export const COLOUR_CLOSE = '</mark>';

export function isHighlightColour(value: string): value is HighlightColour {
  return HIGHLIGHT_COLOURS.some((c) => c.id === value);
}

export const openMark = (colour: HighlightColour) => (colour === 'yellow' ? '==' : `<mark class="nv-${colour}">`);
export const closeMark = (colour: HighlightColour) => (colour === 'yellow' ? '==' : COLOUR_CLOSE);

/** A highlight found in a line: where it starts and ends, where its words are, and its colour. */
export interface FoundHighlight {
  from: number;
  to: number;
  innerFrom: number;
  innerTo: number;
  colour: HighlightColour;
}

/** Every highlight on one line, either kind (offsets within the line). Code spans are skipped. */
export function highlightsInLine(line: string): FoundHighlight[] {
  const out: FoundHighlight[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      const run = /^`+/.exec(line.slice(i))![0];
      const close = line.indexOf(run, i + run.length);
      i = close < 0 ? i + run.length : close + run.length;
      continue;
    }
    if (line.startsWith('==', i) && line[i + 2] !== '=' && line[i + 2] && !/\s/.test(line[i + 2])) {
      const end = line.indexOf('==', i + 3);
      if (end > 0 && !/\s/.test(line[end - 1])) {
        out.push({ from: i, to: end + 2, innerFrom: i + 2, innerTo: end, colour: 'yellow' });
        i = end + 2;
        continue;
      }
    }
    const open = line[i] === '<' ? COLOUR_OPEN.exec(line.slice(i)) : null;
    if (open) {
      const end = line.indexOf(COLOUR_CLOSE, i + open[0].length);
      if (end > 0) {
        out.push({ from: i, to: end + COLOUR_CLOSE.length, innerFrom: i + open[0].length, innerTo: end, colour: open[1] as HighlightColour });
        i = end + COLOUR_CLOSE.length;
        continue;
      }
    }
    i++;
  }
  return out;
}

export interface HighlightEdit {
  changes: { from: number; to: number; insert: string }[];
  /** The words to leave selected afterwards (offsets in the text after the changes). */
  selection: { from: number; to: number };
}

/** A list, quote, tick-box or heading's lead at a line's start: kept outside a highlight. */
const LEAD = /^(?:\s*(?:>\s?)*(?:[-*+]\s+|\d+[.)]\s+)?(?:\[.\]\s+)?(?:#{1,6}\s+)?)/;

/**
 * Highlights the words from..to in `text` in a colour, or takes the highlight off (colour null). Choosing the colour a
 * highlight already has takes it off; choosing another changes it. A selection over several lines highlights each
 * line's words on their own (a highlight never runs across a line break, which Markdown would not read). With nothing
 * selected, the highlight around the cursor is changed (or null: the caller picks the word first).
 */
export function applyHighlight(text: string, from: number, to: number, colour: HighlightColour | null): HighlightEdit | null {
  const lineStart = (pos: number) => text.lastIndexOf('\n', pos - 1) + 1;
  const lineEnd = (pos: number) => {
    const n = text.indexOf('\n', pos);
    return n < 0 ? text.length : n;
  };
  // One line: an existing highlight around (or exactly on) the selection is changed or taken off.
  const a = lineStart(from);
  if (a === lineStart(to)) {
    const line = text.slice(a, lineEnd(from));
    const found = highlightsInLine(line).find((h) => (h.innerFrom + a <= from && to <= h.innerTo + a) || (h.from + a === from && h.to + a === to) || (from === to && h.from + a <= from && to <= h.to + a));
    if (found) {
      const inner = line.slice(found.innerFrom, found.innerTo);
      const off = !colour || colour === found.colour;
      const insert = off ? inner : openMark(colour!) + inner + closeMark(colour!);
      const start = a + found.from + (off ? 0 : openMark(colour!).length);
      return { changes: [{ from: a + found.from, to: a + found.to, insert }], selection: { from: start, to: start + inner.length } };
    }
    if (from === to || !colour) return null;
  }
  if (!colour) {
    // Taking highlights off across lines: every highlight the selection touches.
    const changes: HighlightEdit['changes'] = [];
    for (let s = a; s <= to; ) {
      const e = lineEnd(s);
      for (const h of highlightsInLine(text.slice(s, e))) {
        if (h.to + s >= from && h.from + s <= to) changes.push({ from: s + h.from, to: s + h.to, insert: text.slice(s + h.innerFrom, s + h.innerTo) });
      }
      s = e + 1;
    }
    if (!changes.length) return null;
    const removed = changes.reduce((n, c) => n + (c.to - c.from - c.insert.length), 0);
    return { changes, selection: { from, to: to - removed } };
  }
  const open = openMark(colour);
  const close = closeMark(colour);
  const changes: HighlightEdit['changes'] = [];
  for (let s = a; s <= to; ) {
    const e = lineEnd(s);
    const lead = LEAD.exec(text.slice(s, e))?.[0].length ?? 0;
    let f = Math.max(from, s + lead);
    let t = Math.min(to, e);
    // Spaces at either end stay outside (==words== must touch its words to be read as a highlight).
    while (f < t && /\s/.test(text[f])) f++;
    while (t > f && /\s/.test(text[t - 1])) t--;
    if (t > f) changes.push({ from: f, to: t, insert: open + text.slice(f, t) + close });
    s = e + 1;
  }
  if (!changes.length) return null;
  const first = changes[0];
  const last = changes[changes.length - 1];
  const added = (open.length + close.length) * (changes.length - 1);
  const selFrom = first.from + open.length;
  const selTo = last.to + added + open.length;
  return { changes: changes.map((c) => ({ from: c.from, to: c.to, insert: c.insert })), selection: { from: selFrom, to: selTo } };
}
