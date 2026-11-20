// One Linked list from a note's three answers: the notes that link here, the notes that name it as
// plain words, and the index's related notes (t7-note-window, 8 Nov 2026). A note in two answers is
// one row saying both, never two rows: links here first, then mentions, then related-only
// most-alike-first. The foot's Linked list is its one reader (t27-unused-panels: the side's links
// stack is gone). Pure: tested in tests/t7-linked-list.test.mjs.
import type { RelatedItem } from './related';
import type { LineContext } from './types';

/** How a row is linked, strongest first. */
export type LinkedReason = 'links' | 'mentions' | 'related';

export interface LinkedRow {
  path: string;
  title: string;
  folder: string;
  reasons: LinkedReason[];
  /** The lines that link here (open at the line). */
  linkedLines: LineContext[];
  /** The lines that name the note without linking it (each one click from Link it). */
  mentionLines: LineContext[];
  /** The index's related answer for the row, when it has one (most alike wins). */
  related: RelatedItem | null;
}

const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const titleOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '');

export function mergeLinked(backlinks: LineContext[], unlinked: LineContext[], related: RelatedItem[]): LinkedRow[] {
  const rows = new Map<string, LinkedRow>();
  const rowFor = (p: string, title: string): LinkedRow => {
    let r = rows.get(p);
    if (!r) {
      r = { path: p, title: title || titleOf(p), folder: folderOf(p), reasons: [], linkedLines: [], mentionLines: [], related: null };
      rows.set(p, r);
    }
    return r;
  };
  for (const b of backlinks) {
    const r = rowFor(b.source, b.sourceTitle);
    if (!r.linkedLines.some((l) => l.line === b.line)) r.linkedLines.push(b);
    if (!r.reasons.includes('links')) r.reasons.push('links');
  }
  for (const u of unlinked) {
    const r = rowFor(u.source, u.sourceTitle);
    if (!r.mentionLines.some((l) => l.line === u.line)) r.mentionLines.push(u);
    if (!r.reasons.includes('mentions')) r.reasons.push('mentions');
  }
  for (const item of related) {
    const r = rowFor(item.path, item.title);
    if (!r.related || item.score > r.related.score) r.related = item;
    if (!r.reasons.includes('related')) r.reasons.push('related');
  }
  // Reasons read strongest first even if the answers arrived in another order.
  const rank = (rs: LinkedReason[]) => (rs.includes('links') ? 0 : rs.includes('mentions') ? 1 : 2);
  const byReason = (a: LinkedReason, b: LinkedReason) => rank([a]) - rank([b]);
  const out = [...rows.values()];
  for (const r of out) r.reasons.sort(byReason);
  return out.sort((a, b) => {
    const d = rank(a.reasons) - rank(b.reasons);
    if (d) return d;
    if (rank(a.reasons) === 2) {
      const s = (b.related?.score ?? 0) - (a.related?.score ?? 0);
      if (s) return s;
    } else {
      const lines = (r: LinkedRow) => r.linkedLines.length + r.mentionLines.length;
      if (lines(b) !== lines(a)) return lines(b) - lines(a);
    }
    return a.title.localeCompare(b.title);
  });
}

/** How a row is linked, in plain words. */
export const reasonWords = (r: LinkedReason): string => (r === 'links' ? 'Links here' : r === 'mentions' ? 'Mentions' : 'Related');
