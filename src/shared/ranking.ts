// Relevance ranking (21 Oct 2026, gap G25: "relevance-ranked search and related notes"). Search's "Best match first", the
// [[ and @ suggestions and the Related notes panel all rank notes by the same measures, so a note that comes first in one
// comes first in the others:
//
//   BM25F      the words searched for, weighed by where they are in a note — its name (and aliases) most, then its
//              headings, then its properties and tags, then its words — and by how rare each word is across the notes,
//              a long note not winning just for being long. A word typed part-way ("harb") matches the words it starts
//              ("harbour"), a little less.
//   recency    a note changed lately comes a little higher (a quarter more today, fading over a month and a half).
//   links      a note many others link to comes a little higher (it is one people come back to).
//
// Everything is worked out on this PC from the notes alone: no key, nothing sent anywhere. Pure (no Node, no DOM): the
// index uses it for search (src/main/indexer.ts), the editor for suggestions, the tests check it (tests/ranking.test.mjs).

import { foldDiacritics } from './markdown';

// ── Words ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Words too common to say anything about a note (search still finds them; they just don't rank). */
const STOP = new Set(
  'a an and are as at be but by for from has have i if in into is it its of on or our so than that the their them then there these they this to was we were what when where which who will with you your not no do does did can could should would just also about after before over more most some such only own same very s t'.split(
    ' ',
  ),
);

/** A text's words for ranking: lower case, letters and digits, two or more long, the commonest left out, marks
 *  folded ("café" ranks as "cafe", 9.2). */
export function rankWords(text: string): string[] {
  const words = foldDiacritics(text).toLowerCase().match(/[\p{L}\p{N}]+/gu);
  return words ? words.filter((w) => w.length >= 2 && !STOP.has(w)) : [];
}

const count = (words: string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
};

// ── A note's fields ──────────────────────────────────────────────────────────────────────────────────────────────────

export type Field = 'title' | 'headings' | 'props' | 'body';
export const FIELDS: Field[] = ['title', 'headings', 'props', 'body'];

/** How much a word counts in each place, and how much a field's length is allowed to matter (BM25F's w and b). */
export const FIELD_WEIGHT: Record<Field, number> = { title: 6, headings: 2.5, props: 1.8, body: 1 };
const FIELD_B: Record<Field, number> = { title: 0.3, headings: 0.5, props: 0.5, body: 0.75 };
const K1 = 1.2;
/** A word matched by its start only ("harb" in "harbour") counts this much of a whole one. */
export const PREFIX_SHARE = 0.6;
/** A pack record's share of a note's search score for the same words (5 Nov 2026, "your notes are yours"):
 *  what the person wrote ranks above records; an exact name still lands (the title bonus is not shared). */
export const RECORD_SHARE = 0.5;

export interface RankInput {
  path: string;
  title: string;
  aliases?: string[];
  headings?: string[];
  props?: Record<string, unknown>;
  tags?: string[];
  /** The note's words (its properties are read from `props`; front matter in here is skipped). */
  content: string;
  mtime: number;
}

export interface FieldCounts {
  tf: Record<Field, Map<string, number>>;
  len: Record<Field, number>;
}

const FRONT = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
/** Keys that say when rather than what (their values never rank a note). */
const LIFE_KEYS = new Set(['created', 'updated', 'modified', 'date', 'id', 'position', 'cssclasses', 'cssclass', 'publish']);

function propWords(props: Record<string, unknown> | undefined): string[] {
  const out: string[] = [];
  const add = (v: unknown, depth: number) => {
    if (depth > 2 || v === null || v === undefined) return;
    if (typeof v === 'string') out.push(...rankWords(v.replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, a: string, b?: string) => b ?? a)));
    else if (typeof v === 'number' || typeof v === 'boolean') return;
    else if (Array.isArray(v)) v.slice(0, 50).forEach((x) => add(x, depth + 1));
  };
  for (const [k, v] of Object.entries(props ?? {})) if (!LIFE_KEYS.has(k.toLowerCase()) && k !== 'tags' && k !== 'tag' && k !== 'aliases' && k !== 'alias') add(v, 0);
  return out;
}

/** A note's words by where they are. */
export function fieldCounts(doc: RankInput): FieldCounts {
  const title = rankWords([doc.title, ...(doc.aliases ?? [])].join(' '));
  const headings = rankWords((doc.headings ?? []).join(' '));
  const props = [...propWords(doc.props), ...rankWords((doc.tags ?? []).join(' ').replace(/[#/_-]/g, ' '))];
  const body = rankWords(String(doc.content ?? '').replace(FRONT, ''));
  const tf = { title: count(title), headings: count(headings), props: count(props), body: count(body) };
  return { tf, len: { title: title.length, headings: headings.length, props: props.length, body: body.length } };
}

// ── Across the notes ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface RankedHit {
  path: string;
  score: number;
}

/**
 * The notes' words kept for ranking: each note's words by field (worked out again only when its words change), how many
 * notes have each word, the fields' average lengths, and how many notes link to each. `sync` brings it up to date with
 * the notes; `score` ranks one note for the words searched.
 */
export class Ranker {
  private docs = new Map<string, { content: string; title: string; mtime: number; counts: FieldCounts }>();
  private df = new Map<string, number>();
  private avg: Record<Field, number> = { title: 1, headings: 1, props: 1, body: 1 };
  private inLinks = new Map<string, number>();
  private vocab: string[] = [];
  private stamp: unknown = Symbol('never');

  /** Brought up to date with the notes (only when `stamp` — the index's generation — changed since last time). */
  sync(stamp: unknown, notes: Iterable<RankInput>, linksOf: (path: string) => readonly string[]): void {
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    const seen = new Set<string>();
    for (const n of notes) {
      seen.add(n.path);
      const kept = this.docs.get(n.path);
      if (kept && kept.content === n.content && kept.title === n.title) {
        kept.mtime = n.mtime;
        continue;
      }
      this.docs.set(n.path, { content: n.content, title: n.title, mtime: n.mtime, counts: fieldCounts(n) });
    }
    for (const p of [...this.docs.keys()]) if (!seen.has(p)) this.docs.delete(p);
    this.df.clear();
    const total: Record<Field, number> = { title: 0, headings: 0, props: 0, body: 0 };
    for (const d of this.docs.values()) {
      const words = new Set<string>();
      for (const f of FIELDS) {
        total[f] += d.counts.len[f];
        for (const w of d.counts.tf[f].keys()) words.add(w);
      }
      for (const w of words) this.df.set(w, (this.df.get(w) ?? 0) + 1);
    }
    const n = Math.max(1, this.docs.size);
    for (const f of FIELDS) this.avg[f] = Math.max(1, total[f] / n);
    this.vocab = [...this.df.keys()].sort();
    this.inLinks.clear();
    for (const p of this.docs.keys()) for (const t of new Set(linksOf(p))) if (t !== p) this.inLinks.set(t, (this.inLinks.get(t) ?? 0) + 1);
  }

  get size(): number {
    return this.docs.size;
  }

  /** How many notes link to this one. */
  linksTo(path: string): number {
    return this.inLinks.get(path) ?? 0;
  }

  /** The words in the notes that start with `word` (itself first when a note has it), and the words `word` starts
   *  with ("bills" reaches "bill", 9.2); at most `max`, commonest first. */
  expand(word: string, max = 40): { word: string; share: number }[] {
    const out: { word: string; share: number }[] = [];
    if (this.df.has(word)) out.push({ word, share: 1 });
    if (word.length < 3) return out;
    // The words it extends ("bills" for a note with "bill"): its own starts, longest first.
    for (let i = word.length - 1; i >= 3; i--) {
      const stem = word.slice(0, i);
      if (this.df.has(stem)) out.push({ word: stem, share: PREFIX_SHARE });
    }
    // The vocabulary is sorted: the words starting with `word` sit together.
    let lo = 0;
    let hi = this.vocab.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.vocab[mid] < word) lo = mid + 1;
      else hi = mid;
    }
    const more: string[] = [];
    for (let i = lo; i < this.vocab.length && this.vocab[i].startsWith(word); i++) if (this.vocab[i] !== word) more.push(this.vocab[i]);
    more.sort((a, b) => (this.df.get(b) ?? 0) - (this.df.get(a) ?? 0));
    for (const w of more.slice(0, max)) out.push({ word: w, share: PREFIX_SHARE });
    return out;
  }

  /** BM25F for one note and the words searched (each word's best match among the words it starts). */
  bm25f(path: string, words: string[]): number {
    const d = this.docs.get(path);
    if (!d) return 0;
    const n = this.docs.size;
    let score = 0;
    for (const q of new Set(words)) {
      let best = 0;
      for (const { word, share } of this.expand(q)) {
        let tf = 0;
        for (const f of FIELDS) {
          const c = d.counts.tf[f].get(word);
          if (!c) continue;
          tf += (FIELD_WEIGHT[f] * c) / (1 - FIELD_B[f] + (FIELD_B[f] * d.counts.len[f]) / this.avg[f]);
        }
        if (!tf) continue;
        const df = this.df.get(word) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        best = Math.max(best, share * idf * ((tf * (K1 + 1)) / (tf + K1)));
      }
      score += best;
    }
    return score;
  }

  /** How well a note matches the words searched, with its recency and links (0 when none of the words is in it).
   *  `share` scales the match (a pack's record takes RECORD_SHARE); an exact title still lands whole. */
  score(path: string, words: string[], now: number, share = 1): number {
    const d = this.docs.get(path);
    if (!d) return 0;
    const base = this.bm25f(path, words);
    if (base <= 0) return 0;
    return base * recencyBoost(d.mtime, now) * linkBoost(this.linksTo(path)) * share + exactTitleBonus(d.title, words);
  }

  /** The notes the words match best, best first (for search with no other conditions, and the tests). */
  rank(words: string[], now: number, limit = 50): RankedHit[] {
    const out: RankedHit[] = [];
    for (const p of this.docs.keys()) {
      const s = this.score(p, words, now);
      if (s > 0) out.push({ path: p, score: s });
    }
    return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
  }

  /** A note's words by field (for Related notes' word likeness). */
  counts(path: string): FieldCounts | undefined {
    return this.docs.get(path)?.counts;
  }

  /** How many notes have a word, and how many notes there are (for Related notes' rarity weights). */
  rarity(word: string): number {
    const df = this.df.get(word) ?? 0;
    return Math.log(1 + (this.docs.size - df + 0.5) / (df + 0.5));
  }
}

// ── Boosts ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

/** Up to a quarter more for a note changed today, fading by half every month or so (never less than none). */
export function recencyBoost(mtime: number, now: number): number {
  if (!Number.isFinite(mtime) || mtime <= 0) return 1;
  const days = Math.max(0, (now - mtime) / DAY);
  return 1 + 0.25 * Math.exp(-days / 45);
}

/** A little more for a note others link to: about a tenth for one, a third for seven, at most half again. */
export function linkBoost(inLinks: number): number {
  return Math.min(1.5, 1 + 0.12 * Math.log2(1 + Math.max(0, inLinks)));
}

/** A note whose name holds exactly what was searched for, in any order ("visa bill" reaches "Bill Visa", 9.2),
 *  comes first. */
export function exactTitleBonus(title: string, words: string[]): number {
  const t = rankWords(title).sort().join(' ');
  return t && t === [...words].sort().join(' ') ? 25 : 0;
}

// ── Suggestions ([[ and @) ───────────────────────────────────────────────────────────────────────────────────────────

export interface SuggestInput {
  title: string;
  aliases?: string[];
  mtime: number;
  /** How many notes link to it. */
  inLinks: number;
  /** It shares a link or a tag with the note being written in, or that note links to it already. */
  near?: boolean;
}

/**
 * How well a note's name fits what is typed after [[ or @: its name (or an alias) exactly, then starting with it, then a
 * word in it starting with it, then containing it, then its letters in order ("hbr" in "Harbour"); 0 for no fit. Then the
 * same recency and link boosts search uses, and a little more for a note near the one being written. With nothing typed,
 * the notes changed lately and linked most come first.
 */
export function suggestionScore(typed: string, note: SuggestInput, now: number): { score: number; match: string | null } {
  const q = typed.trim().toLowerCase();
  const names = [note.title, ...(note.aliases ?? [])];
  let fit = 0;
  let match: string | null = null;
  if (!q) {
    fit = 1;
    match = note.title;
  } else
    for (const name of names) {
      const n = name.toLowerCase();
      let f = 0;
      if (n === q) f = 100;
      else if (n.startsWith(q)) f = 70 + Math.min(10, (q.length / n.length) * 10);
      else if (n.split(/[\s\-_/.,()]+/).some((w) => w.startsWith(q))) f = 50;
      else if (n.includes(q)) f = 30;
      else if (inOrder(q, n)) f = 8;
      // The name itself beats an alias that fits as well.
      if (name !== note.title) f *= 0.92;
      if (f > fit) {
        fit = f;
        match = name;
      }
    }
  if (!fit) return { score: 0, match: null };
  const boosted = fit * recencyBoost(note.mtime, now) * linkBoost(note.inLinks) * (note.near ? 1.15 : 1);
  return { score: boosted, match };
}

function inOrder(q: string, s: string): boolean {
  if (q.length < 2) return false;
  let i = 0;
  for (const ch of s) if (ch === q[i] && ++i === q.length) return true;
  return false;
}

/** How many notes link to each note, by its name (lower case), from the notes' links as written (the window's list). */
export function linkCountsByName(notes: readonly { links: readonly { target: string }[] }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of notes) {
    const seen = new Set<string>();
    for (const l of n.links) {
      const name = (l.target.split('#')[0].split('/').pop() ?? '').replace(/\.md$/i, '').trim().toLowerCase();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.set(name, (out.get(name) ?? 0) + 1);
    }
  }
  return out;
}
