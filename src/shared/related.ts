// Related notes (21 Oct 2026, gap G25): the notes most like the one open, for the foot's Linked list. Four
// kinds of likeness, each worked out on this PC from the notes alone (no key, nothing sent anywhere), each said in plain
// words so the person sees why:
//
//   links   one links to the other; other notes link to both ("Both linked from Weekly plan"); both link to the same
//           notes ("Both link to Harbour Fit-out"), a note many link to counting less than a rare one
//   tags    tags both have, a rare tag counting more than one on every note
//   words   the words they share, weighed by how rare each is (TF-IDF likeness, as search ranks words)
//   meaning similar meaning from this PC's meaning index ("Similar meaning"), even with no shared words
//
// Meaning-based likeness (2 Nov 2026, 10.0 "Endless Tech": chose on-PC only, no provider) comes from this PC's meaning
// index (src/main/meaning-index.ts): no key, nothing sent anywhere, private notes never indexed. `vectors` carries each
// note's meaning; without it the three above decide.
//
// Pure: the index gathers the notes and calls relatedTo (src/main/indexer.ts), the foot's Linked list draws
// each row's reasons through the shared merge (src/shared/linked-list.ts), the tests check it (tests/ranking.test.mjs).

export interface RelatedDoc {
  path: string;
  /** The name people see. */
  title: string;
  tags: string[];
  /** The notes it links to, resolved to their paths. */
  links: string[];
}

export type RelatedKind = 'linked' | 'cited' | 'coupled' | 'tags' | 'words' | 'meaning';

export interface RelatedItem {
  path: string;
  title: string;
  /** 0 to 1. */
  score: number;
  /** One line each, the strongest first: "Links here", "Both link to Harbour", "Both tagged #fit-out", "Shares: crane, lease". */
  reasons: string[];
  kinds: RelatedKind[];
  /** Each kind's own part of the score (0 to 1), for the panel's bar and the tests. */
  parts: { links: number; tags: number; words: number; meaning?: number };
}

export interface RelatedOptions {
  /** A note's words with how often each appears (its name's words counted twice), or undefined. */
  words(path: string): ReadonlyMap<string, number> | undefined;
  /** Whether a note is a pack's record: a record is related only when one links to the other (5 Nov 2026,
   *  "your notes are yours": lookalike records sharing template words never list). */
  isRecord?(path: string): boolean;
  /** How rare a word is across the notes (an inverse document frequency). */
  rarity(word: string): number;
  /** A note's meaning from this PC's meaning index; null when none is kept (private, left out, or no words). */
  vectors?: (path: string) => readonly number[] | null;
  limit?: number;
  /** Notes never suggested (private notes, templates, folders left out). */
  skip?(path: string): boolean;
}

/** How much each kind counts when meaning isn't there, and when it is. */
export const WEIGHTS = { links: 0.4, tags: 0.25, words: 0.35 } as const;
export const WEIGHTS_WITH_MEANING = { links: 0.35, tags: 0.15, words: 0.2, meaning: 0.3 } as const;
/** Each further kind of likeness two notes share lifts them this much more (alike in several ways beats one). */
export const BREADTH = 0.15;
/** A note below this is not shown as related. */
export const MIN_SCORE = 0.06;
/** The words of the open note compared (its most telling ones). */
const TOP_WORDS = 60;

const squash = (x: number, k = 1) => 1 - Math.exp(-x / k);
const nameOf = (docs: Map<string, RelatedDoc>, p: string) => docs.get(p)?.title ?? (p.split('/').pop() ?? p).replace(/\.md$/i, '');

function listWords(items: string[], max = 2): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length <= max) return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  const rest = items.length - max;
  return `${items.slice(0, max).join(', ')} and ${rest} more`;
}

/** A word list's TF-IDF weights, and its length for cosine likeness. */
function weigh(counts: ReadonlyMap<string, number>, rarity: (w: string) => number, top?: number): { w: Map<string, number>; norm: number } {
  let list = [...counts].map(([word, n]) => [word, (1 + Math.log(n)) * rarity(word)] as [string, number]).filter(([, x]) => x > 0);
  if (top) list = list.sort((a, b) => b[1] - a[1]).slice(0, top);
  const w = new Map(list);
  let sum = 0;
  for (const x of w.values()) sum += x * x;
  return { w, norm: Math.sqrt(sum) };
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? Math.max(0, dot / Math.sqrt(na * nb)) : 0;
}

/** The notes most like the one at `path`, most alike first, each with why. */
export function relatedTo(path: string, list: RelatedDoc[], opts: RelatedOptions): RelatedItem[] {
  const docs = new Map(list.map((d) => [d.path, d]));
  const self = docs.get(path);
  if (!self) return [];
  const n = Math.max(1, docs.size);
  // Who links to whom (once per pair).
  const inbound = new Map<string, Set<string>>();
  const outbound = new Map<string, Set<string>>();
  for (const d of list) {
    const out = new Set(d.links.filter((t) => t !== d.path && docs.has(t)));
    outbound.set(d.path, out);
    for (const t of out) {
      const s = inbound.get(t) ?? new Set<string>();
      s.add(d.path);
      inbound.set(t, s);
    }
  }
  const mineOut = outbound.get(path) ?? new Set<string>();
  const mineIn = inbound.get(path) ?? new Set<string>();
  // Tags: how many notes have each of this note's tags.
  const tagKey = (t: string) => t.replace(/^#/, '').toLowerCase();
  const myTags = new Map(self.tags.map((t) => [tagKey(t), t.replace(/^#/, '')]));
  const tagCount = new Map<string, number>();
  for (const d of list) for (const t of new Set(d.tags.map(tagKey))) if (myTags.has(t)) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  // Words: this note's most telling words.
  const myCounts = opts.words(path);
  const mine = myCounts ? weigh(myCounts, opts.rarity, TOP_WORDS) : { w: new Map<string, number>(), norm: 0 };
  const myVector = opts.vectors?.(path) ?? null;

  const out: RelatedItem[] = [];
  for (const d of list) {
    if (d.path === path || opts.skip?.(d.path)) continue;
    const reasons: { weight: number; words: string; kind: RelatedKind }[] = [];
    // Links.
    let links = 0;
    const theirOut = outbound.get(d.path) ?? new Set<string>();
    const toThem = mineOut.has(d.path);
    const toMe = theirOut.has(path);
    if (toThem || toMe) {
      // Already a click away (the link itself): it counts, but less than being alike in several ways.
      links += toThem && toMe ? 0.8 : 0.6;
      reasons.push({ weight: 3, kind: 'linked', words: toThem && toMe ? 'You link to each other' : toThem ? 'This note links to it' : 'Links to this note' });
    }
    const cited: string[] = [];
    for (const c of mineIn) {
      if (c === d.path || !(outbound.get(c) ?? new Set()).has(d.path)) continue;
      links += 0.6 / Math.log2(2 + (outbound.get(c)?.size ?? 0));
      cited.push(nameOf(docs, c));
    }
    if (cited.length) reasons.push({ weight: 2, kind: 'cited', words: `Both linked from ${listWords(cited)}` });
    const coupled: string[] = [];
    for (const t of mineOut) {
      if (t === d.path || !theirOut.has(t)) continue;
      links += 0.7 * (Math.log(1 + n / (1 + (inbound.get(t)?.size ?? 0))) / Math.log(1 + n));
      coupled.push(nameOf(docs, t));
    }
    if (coupled.length) reasons.push({ weight: 1.8, kind: 'coupled', words: `Both link to ${listWords(coupled)}` });
    // Either side a pack's record, only a real link keeps the pair: shared template words ("Credentials",
    // "Health log") and shared tags are likeness, not a relation.
    if (!toThem && !toMe && (opts.isRecord?.(path) || opts.isRecord?.(d.path))) continue;
    const linkPart = squash(links);
    // Tags.
    let tags = 0;
    const sharedTags: string[] = [];
    for (const t of new Set(d.tags.map(tagKey))) {
      if (!myTags.has(t)) continue;
      tags += Math.log(1 + n / Math.max(1, tagCount.get(t) ?? 1));
      sharedTags.push(`#${myTags.get(t)}`);
    }
    const tagPart = squash(tags, 3);
    if (sharedTags.length) reasons.push({ weight: 1.5, kind: 'tags', words: `Both tagged ${listWords(sharedTags, 3)}` });
    // Words.
    let wordPart = 0;
    if (mine.norm) {
      const theirs = opts.words(d.path);
      if (theirs) {
        const them = weigh(theirs, opts.rarity);
        let dot = 0;
        const shared: [string, number][] = [];
        for (const [word, x] of mine.w) {
          const y = them.w.get(word);
          if (!y) continue;
          dot += x * y;
          shared.push([word, x * y]);
        }
        wordPart = them.norm ? dot / (mine.norm * them.norm) : 0;
        if (wordPart >= 0.08 && shared.length) {
          const top = shared.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
          reasons.push({ weight: wordPart * 2, kind: 'words', words: `Shares words: ${top.join(', ')}` });
        }
      }
    }
    // Meaning (2 Nov 2026, 10.0): only when both notes have a vector in the SAME space. While the on-device
    // build runs, an embedded note (384-wide) never meets a hashed one (128-wide): links, tags and words decide
    // for that pair instead (10.0 reuse). Hashed idea vectors score lower than dense embeddings, so the label
    // sits at 0.3 (tuned on paraphrase fixtures with no shared words).
    const theirVector = myVector ? opts.vectors?.(d.path) ?? null : null;
    const meaning = myVector && theirVector && myVector.length === theirVector.length ? cosine(myVector, theirVector) : undefined;
    let score: number;
    if (meaning !== undefined) {
      score = WEIGHTS_WITH_MEANING.links * linkPart + WEIGHTS_WITH_MEANING.tags * tagPart + WEIGHTS_WITH_MEANING.words * wordPart + WEIGHTS_WITH_MEANING.meaning * meaning;
      if (meaning >= 0.3) reasons.push({ weight: meaning, kind: 'meaning', words: 'Similar meaning' });
    } else score = WEIGHTS.links * linkPart + WEIGHTS.tags * tagPart + WEIGHTS.words * wordPart;
    const kinds = [linkPart, tagPart, wordPart, meaning ?? 0].filter((x) => x >= 0.05).length;
    score *= 1 + BREADTH * Math.max(0, kinds - 1);
    if (score < MIN_SCORE) continue;
    reasons.sort((a, b) => b.weight - a.weight);
    out.push({
      path: d.path,
      title: d.title,
      score: Math.min(1, score),
      reasons: reasons.map((r) => r.words),
      kinds: reasons.map((r) => r.kind),
      parts: { links: linkPart, tags: tagPart, words: wordPart, ...(meaning !== undefined ? { meaning } : {}) },
    });
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, opts.limit ?? 12);
}
