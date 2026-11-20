// The [[ and @ suggestions ranked as search ranks notes (21 Oct 2026, gap G25; src/shared/ranking.ts suggestionScore):
// how well the name fits what is typed, then the notes changed lately, the notes others link to, and the notes near the
// one being written (it links to them, or they share a tag) a little higher.

import type { NoteMeta } from '../../../shared/types';
import { linkCountsByName, suggestionScore } from '../../../shared/ranking';

let kept: { notes: readonly NoteMeta[]; counts: Map<string, number> } | null = null;

/** How many notes link to each name, worked out once per list of notes. */
function counts(notes: readonly NoteMeta[]): Map<string, number> {
  if (kept?.notes !== notes) kept = { notes, counts: linkCountsByName(notes) };
  return kept.counts;
}

export interface RankedNote {
  note: NoteMeta;
  /** The name that fits (the title, or an alias). */
  match: string;
  score: number;
}

/** The notes whose names fit what is typed, best first (at most `max`), leaving out `skip`. */
export function rankNotes(typed: string, notes: readonly NoteMeta[], host: string | undefined, max: number, skip?: (n: NoteMeta) => boolean): RankedNote[] {
  const links = counts(notes);
  const me = host ? notes.find((n) => n.path === host) : undefined;
  const myLinks = new Set((me?.links ?? []).map((l) => (l.target.split('#')[0].split('/').pop() ?? '').replace(/\.md$/i, '').toLowerCase()));
  const myTags = new Set((me?.tags ?? []).map((t) => t.toLowerCase()));
  const now = Date.now();
  const out: RankedNote[] = [];
  for (const n of notes) {
    if (skip?.(n)) continue;
    const near = myLinks.has(n.title.toLowerCase()) || (myTags.size > 0 && n.tags.some((t) => myTags.has(t.toLowerCase())));
    const { score, match } = suggestionScore(typed, { title: n.title, aliases: n.aliases, mtime: n.mtime, inLinks: links.get(n.title.toLowerCase()) ?? 0, near }, now);
    if (score > 0 && match) out.push({ note: n, match, score });
  }
  return out.sort((a, b) => b.score - a.score || a.match.localeCompare(b.match)).slice(0, max);
}
