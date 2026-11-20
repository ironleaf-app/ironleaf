// Readwise's CSV export (V9, 28 Oct 2026): one row per highlight — Highlight, Book Title, Book Author, Amazon Book ID,
// Note, Color, Tags, Location Type, Location, Highlighted at, Document tags. Each book or article becomes one note with
// its highlights in reading order under "## Highlights", the person's own note under each, its tags as tags.

import { parseCsv } from '../../shared/csv';
import type { PropValue } from '../../shared/frontmatter';
import { fileSafe, isoDay, tagSafe, textHash, type SourceItem, type SourceRead } from './source';

/** Whether a CSV's heading row is Readwise's. */
export function isReadwiseCsv(text: string): boolean {
  const head = (text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '').toLowerCase();
  return head.includes('highlight') && head.includes('book title');
}

export function readReadwise(text: string): SourceRead {
  const table = parseCsv(text.replace(/^\uFEFF/, ''));
  const head = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const c = { text: col('highlight'), title: col('book title'), author: col('book author'), note: col('note'), tags: col('tags'), locType: col('location type'), loc: col('location'), at: col('highlighted at'), docTags: col('document tags'), url: col('url') };
  const books = new Map<string, { title: string; author: string; tags: Set<string>; rows: string[][] }>();
  let empty = 0;
  for (const r of table.slice(1)) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    if (!cell(c.text)) {
      empty++;
      continue;
    }
    const title = cell(c.title) || 'Untitled';
    const author = cell(c.author);
    const key = `${title}|${author}`.toLowerCase();
    const book = books.get(key) ?? { title, author, tags: new Set<string>(), rows: [] };
    for (const t of cell(c.docTags).split(/[,;]/)) if (tagSafe(t)) book.tags.add(tagSafe(t));
    book.rows.push(r);
    books.set(key, book);
  }
  const items: SourceItem[] = [];
  for (const [key, b] of books) {
    const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const loc = (r: string[]) => Number(cell(r, c.loc)) || 0;
    const rows = [...b.rows].sort((x, y) => loc(x) - loc(y));
    const lines: string[] = ['## Highlights', ''];
    let last = '';
    for (const r of rows) {
      const where = cell(r, c.loc) ? ` (${cell(r, c.locType) || 'location'} ${cell(r, c.loc)})` : '';
      const tags = cell(r, c.tags).split(/[,;]/).map(tagSafe).filter(Boolean).map((t) => `#${t}`).join(' ');
      // Each highlight carries an id of its words, so a link to it holds when the book comes in again.
      lines.push(`- ${cell(r, c.text).replace(/\s*\n\s*/g, ' ')}${where}${tags ? ` ${tags}` : ''} ^rw-${textHash(cell(r, c.text)).slice(0, 8)}`);
      if (cell(r, c.note)) lines.push(`  - Note: ${cell(r, c.note).replace(/\s*\n\s*/g, ' ')}`);
      const at = Date.parse(cell(r, c.at));
      if (Number.isFinite(at) && (!last || isoDay(new Date(at)) > last)) last = isoDay(new Date(at));
    }
    const props: Record<string, PropValue> = {};
    if (b.author) props.author = b.author;
    if (b.tags.size) props.tags = [...b.tags];
    if (last) props['last-highlighted'] = last;
    props.highlights = rows.length;
    items.push({ id: `readwise/${key}`, title: fileSafe(b.title), folder: '', props, body: `${lines.join('\n')}\n`, files: [] });
  }
  return { kind: 'readwise', name: '', items, views: [], skipped: empty ? [{ what: `${empty} rows`, why: 'no highlight in them' }] : [] };
}
