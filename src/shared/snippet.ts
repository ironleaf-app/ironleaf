// A line of a note (or a document) as a search result shows it: the Markdown that marks it up left out — a list, quote or
// heading's lead, bold and italic stars, highlights (coloured ones' tags too), strike-through, code ticks, link brackets and a table row's bars — so "**High** — 11
// *old* mic stands" reads "High — 11 old mic stands". Inline links and images keep their words and drop their targets
// (t200, 10 Nov 2026, judged on real long notes: "where the awning would hang](assets/awning-photo.png)" read raw),
// and footnote markers go whole. The words found stay marked: each range moves with the text.

/** Marks dropped wherever they are (doubled first, so "**" goes as one). */
const PAIRS = ['**', '__', '~~', '==', '[[', ']]'];
/** A coloured highlight's tags (src/renderer/src/lib/highlights.ts): <mark class="nv-green"> and </mark> go too. */
const MARK_TAG = /^(?:<mark(?: class="nv-[a-z]+")?>|<\/mark>)/;

export function plainLine(raw: string, rawRanges: [number, number][]): { text: string; ranges: [number, number][] } {
  const lead = /^(?:\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?|\s*>\s?|#{1,6}\s+)/.exec(raw)?.[0].length ?? 0;
  // where[i]: the place in the new text of the old text's character i (and of its end, at raw.length).
  const where = new Array<number>(raw.length + 1);
  let out = '';
  for (let i = 0; i < lead; i++) where[i] = 0;
  let i = lead;
  // A table row ("| 19 Oct | Tessaly pricing ends | planned |") reads as "19 Oct · Tessaly pricing ends · planned".
  const table = /^\s*\|.*\|\s*$/.test(raw);
  const firstBar = table ? raw.indexOf('|') : -1;
  const lastBar = table ? raw.lastIndexOf('|') : -1;
  while (i < raw.length) {
    const two = raw.slice(i, i + 2);
    const c = raw[i];
    if (table && (i <= firstBar || i >= lastBar || c === '|' || (c === ' ' && (raw[i - 1] === '|' || raw[i + 1] === '|')))) {
      // The row's outer bars and the spaces around them go; an inner bar becomes a dot between spaces.
      const inner = c === '|' && i > firstBar && i < lastBar;
      where[i] = out.length;
      if (inner) out += ' · ';
      i++;
      continue;
    }
    // An image's bang goes; its brackets read as a link's below.
    if (c === '!' && raw[i + 1] === '[') {
      where[i] = out.length;
      i++;
      continue;
    }
    // A footnote marker ([^1]) goes whole; its words live at the foot of the note, not on this line.
    if (c === '[' && raw[i + 1] === '^') {
      const shut = raw.indexOf(']', i + 2);
      const end = shut < 0 ? raw.length : shut + 1;
      for (let k = i; k < end; k++) where[k] = out.length;
      i = end;
      continue;
    }
    // A link's opening bracket goes when it opens one ([words](target) or [words][ref]); a stray bracket stays,
    // as before. The words between read on; the closing bracket and target go in the branch below.
    if (c === '[' && raw[i + 1] !== '[') {
      const shut = raw.indexOf(']', i + 1);
      if (shut > i + 1 && (raw[shut + 1] === '(' || raw[shut + 1] === '[')) {
        where[i] = out.length;
        i++;
        continue;
      }
    }
    // A link's closing bracket with its target: the depth counts, so a target holding brackets still shuts whole.
    if (c === ']' && two !== ']]' && (raw[i + 1] === '(' || raw[i + 1] === '[')) {
      let end: number;
      if (raw[i + 1] === '(') {
        let j = i + 2;
        let depth = 1;
        while (j < raw.length && depth > 0) {
          if (raw[j] === '(') depth++;
          else if (raw[j] === ')') depth--;
          j++;
        }
        end = j;
      } else {
        const shut = raw.indexOf(']', i + 2);
        end = shut < 0 ? raw.length : shut + 1;
      }
      for (let k = i; k < end; k++) where[k] = out.length;
      i = end;
      continue;
    }
    const before = raw[i - 1] ?? ' ';
    const after = raw[i + 1] ?? ' ';
    const tag = c === '<' ? MARK_TAG.exec(raw.slice(i, i + 32))?.[0].length ?? 0 : 0;
    const drop = tag ? tag : PAIRS.includes(two) ? 2 : c === '`' ? 1 : c === '*' && !(/\s/.test(before) && /\s/.test(after)) ? 1 : 0;
    if (drop) {
      for (let k = 0; k < drop; k++) where[i + k] = out.length;
      i += drop;
      continue;
    }
    where[i] = out.length;
    out += c;
    i++;
  }
  where[raw.length] = out.length;
  const ranges = rawRanges
    .map(([a, b]) => [where[Math.max(0, Math.min(raw.length, a))], where[Math.max(0, Math.min(raw.length, b))]] as [number, number])
    .filter(([a, b]) => b > a);
  return { text: out, ranges };
}

/**
 * A long plain line cut down around its first highlight for the narrow result rows (the search window shows about 85
 * characters, the panel fewer): the marked words stay visible instead of clipping past the row's edge. The window is
 * smaller than the row, so a cut line is never clipped again; the cut ends read … as the indexer's own trims do, and
 * each highlight moves to match. Lines short enough come back whole, and a line with no highlights shows its start.
 * The cuts land on word edges (t200, 10 Nov 2026, judged on real long notes: "and Shad…" and "due…" read broken);
 * only a cut that would swallow the highlight keeps its character edge. Applied after plainLine, whose full text
 * stays on the row for hovering.
 */
export function windowSnippet(text: string, ranges: [number, number][], show = 80, before = 32): { text: string; ranges: [number, number][] } {
  if (text.length <= show) return { text, ranges };
  const first = ranges.length ? Math.max(0, Math.min(text.length, ranges[0][0])) : 0;
  const hEnd = ranges.length ? Math.max(0, Math.min(text.length, ranges[0][1])) : 0;
  let start = Math.max(0, Math.min(first - before, text.length - show));
  // A start inside a word steps forward past its space, so no word opens cut; past the highlight it steps back
  // to its word's start instead, so the highlight stays inside.
  if (start > 0 && text[start] !== ' ' && text[start - 1] !== ' ') {
    const fwd = text.indexOf(' ', start);
    const at = fwd < 0 ? text.length : fwd + 1;
    if (at <= first) start = at;
    else {
      const back = text.lastIndexOf(' ', start);
      start = back < 0 ? start : back + 1;
    }
  }
  let end = Math.min(text.length, start + show);
  // An end inside a word steps back to its space, so no word shuts cut; into the highlight it stays put.
  if (end < text.length && text[end - 1] !== ' ' && text[end] !== ' ') {
    const back = text.lastIndexOf(' ', end);
    if (back > start && back >= hEnd) end = back;
  }
  const out = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  const shift = start - (start > 0 ? 1 : 0);
  const moved = ranges.map(([a, b]) => [a - shift, b - shift] as [number, number]).filter(([a, b]) => a >= 0 && b <= out.length && b > a);
  return { text: out, ranges: moved };
}
