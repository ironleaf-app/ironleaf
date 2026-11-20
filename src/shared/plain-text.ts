// One line of a note shown outside the note, as plain words (29 Oct 2026, SPEC section A: raw markdown in
// summaries and cards, "Next: **Telstra invoice due Mon 26 Oct**"). Every card, summary and row that shows a
// line of a note uses plainText here, never the raw line. Pure: no reading, no writing.
import { linkWords } from './markdown';
import { plainLine } from './snippet';

/** A line (or a few) of Markdown as one plain line: marks, links, images, tags and table bars gone, spaces tidied. */
export function plainText(text: string | null | undefined): string {
  if (!text) return '';
  let s = String(text).replace(/\r\n?/g, '\n');
  // HTML comments are never words for a person (round 2: a card showed "<!-- the former host app keeps the
  // part below up to date"); a comment left open takes the rest with it.
  s = s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<!--[\s\S]*$/, ' ');
  // Images and links keep their words, never their address; a link to a note keeps the note's name.
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  s = linkWords(s);
  // A raw link (bare, or in <…>) never shows: its address is not words.
  s = s.replace(/<(?:https?|mailto):[^>\s]+>/g, ' ');
  s = s.replace(/\b(?:https?|mailto):[^\s<>"')\]]+/g, ' ');
  s = s.replace(/<\/?[a-z][^>]*>/gi, ' ');
  // Each source line plain in its own right (snippet.plainLine takes the marks off), then one line.
  s = s.split('\n').map((line) => plainLine(line, []).text).join(' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Whether words carry any Markdown mark plainText would take off (a check, and the tests). */
export function hasMarks(text: string | null | undefined): boolean {
  return plainText(text) !== String(text ?? '').replace(/\s+/g, ' ').trim();
}
