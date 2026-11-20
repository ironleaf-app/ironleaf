/**
 * Scores how well `query` matches `text`: substring matches rank highest, then
 * in-order character matches with bonuses for runs. Returns null for no match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  return fuzzyScoreNorm(query.trim().toLowerCase(), text);
}

/** The score with both sides already lowered (fuzzyFilterLower): the same number, no lowering. */
function fuzzyScoreBoth(q: string, t: string): number | null {
  if (!q) return 0;
  const idx = t.indexOf(q);
  if (idx >= 0) return 1000 - idx * 2 - (t.length - q.length) * 0.5 + (idx === 0 ? 200 : 0);
  let pos = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, pos);
    if (found < 0) return null;
    streak = found === pos ? streak + 1 : 0;
    score += 10 + streak * 5 - Math.min(found - pos, 10);
    pos = found + 1;
  }
  return score - t.length * 0.1;
}

/** The score against words already normalised (fuzzyFilter reads the query once, not once per row). */
function fuzzyScoreNorm(q: string, text: string): number | null {
  const t = text.toLowerCase();
  if (!q) return 0;
  const idx = t.indexOf(q);
  if (idx >= 0) return 1000 - idx * 2 - (t.length - q.length) * 0.5 + (idx === 0 ? 200 : 0);
  let pos = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, pos);
    if (found < 0) return null;
    streak = found === pos ? streak + 1 : 0;
    score += 10 + streak * 5 - Math.min(found - pos, 10);
    pos = found + 1;
  }
  return score - t.length * 0.1;
}

/**
 * Word-wise matching (9.2 fresh-eyes W5-13): every word typed must appear in the
 * name's words, in any order ("upgrade store" finds "Studio Upgrade"), where the
 * substring finder above finds nothing. A typed word counts when it starts a
 * word of the name or sits inside one.
 */
export function wordsMatch(query: string, text: string): boolean {
  const asked = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!asked.length) return true;
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return asked.every((w) => words.some((x) => x.startsWith(w) || x.includes(w)));
}

/** Items whose name matches word-wise (order kept), for pickers that name things. */
export function wordFilter<T>(items: T[], query: string, key: (item: T) => string, limit = 50): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return items.filter((item) => wordsMatch(query, key(item))).slice(0, limit);
}

/** The k-th largest of numbers (0-based), by quickselect; the array is reordered. */
function kthLargest(scores: number[], k: number): number {
  let lo = 0;
  let hi = scores.length - 1;
  while (lo < hi) {
    // The middle of three (t102, 9 Nov 2026): a lone middle pick can still walk downhill on runs of ties.
    const mid = (lo + hi) >> 1;
    const a = scores[lo];
    const b = scores[mid];
    const c = scores[hi];
    const pivot = a < b ? (b < c ? b : a < c ? c : a) : b < c ? (a < c ? a : c) : b;
    let i = lo;
    let j = hi;
    do {
      while (scores[i] > pivot) i++;
      while (scores[j] < pivot) j--;
      if (i <= j) {
        const t = scores[i];
        scores[i] = scores[j];
        scores[j] = t;
        i++;
        j--;
      }
    } while (i <= j);
    if (j < k) lo = i;
    if (k < i) hi = j;
  }
  return scores[k];
}

export function fuzzyFilter<T>(items: T[], query: string, key: (item: T) => string, limit = 50): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);
  const scored = items
    .map((item) => ({ item, score: fuzzyScoreNorm(q, key(item)) }))
    .filter((x): x is { item: T; score: number } => x.score !== null);
  return topByScore(scored, limit);
}

/** The filter over words already lowered (the note pickers lower each row once, not once per keystroke). */
export function fuzzyFilterLower<T>(items: T[], query: string, keyLower: (item: T) => string, limit = 50): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);
  const scored = items
    .map((item) => ({ item, score: fuzzyScoreBoth(q, keyLower(item)) }))
    .filter((x): x is { item: T; score: number } => x.score !== null);
  return topByScore(scored, limit);
}

function topByScore<T>(scored: { item: T; score: number }[], limit: number): T[] {
  if (scored.length <= limit || limit <= 0) return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.item);
  // Only the shown rows are sorted (t102, 9 Nov 2026): a one-letter query matches over a thousand notes,
  // and sorting them all cost each keystroke. The threshold is the limit-th score; rows above it plus ties
  // in their original order, stably sorted, read exactly as the full sort's first rows.
  const threshold = kthLargest(scored.map((x) => x.score), limit - 1);
  const top = scored.filter((x) => x.score > threshold);
  for (const x of scored) {
    if (top.length >= limit) break;
    if (x.score === threshold) top.push(x);
  }
  return top.sort((a, b) => b.score - a.score).map((x) => x.item);
}

/**
 * Words for a capped list (9.5 O6): when more items exist than show, how to narrow them down; nothing when all show.
 */
export function narrowWords(total: number, shown: number, what = 'items'): string {
  if (total <= shown) return '';
  return `${total} ${what}. Type a few letters to narrow them down.`;
}
