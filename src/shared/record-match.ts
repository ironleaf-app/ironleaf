// Finding the record a person means (9.2 intelligence uplift, 1 Nov 2026). Every tool that takes a name
// resolves it here first: the reference tidied ([[links]], paths, ".md" and case folded away), then the one record
// that matches. Two matches is never silently the first: the error names the candidates so the person picks. Pure:
// no files, no Node, no DOM.

/** A reference as written, tidied for matching: "[[Me/Finance/Bills/Credit Card.md]]" and "[Me/Finance/Bills/CARD
 *  Visa.md]" (as tool answers give it) → "credit card". */
export function normalizeRef(ref: unknown): string {
  const s = String(ref ?? '').trim();
  const link = /\[\[([^\]]+)\]\]/.exec(s);
  const md = !link ? /\[([^\]]+)\]\([^)]+\)/.exec(s) : null;
  const inner = link ? (link[1].split('|').pop() ?? '') : md ? (md[1] ?? '') : s.replace(/^\[|\]$/g, '');
  const base = (inner.split('/').pop() ?? '').replace(/\.md$/i, '');
  return base.replace(/\s+/g, ' ').trim().toLowerCase();
}

const isWordChar = (c: string) => /[a-z0-9]/i.test(c);

/** Whether `want` starts at a word's start inside `hay`: "harbour" matches "Harbour Fit-out" but "5 km" never
 *  matches "Run 15 km race" (the 5 sits inside 15). */
function startsAtWord(hay: string, want: string): boolean {
  if (!want || !hay.includes(want)) return false;
  let at = hay.indexOf(want);
  while (at >= 0) {
    if (at === 0 || !isWordChar(hay[at - 1])) return true;
    at = hay.indexOf(want, at + 1);
  }
  return false;
}

export interface MatchCandidate {
  name: string;
  path?: string;
  /** Other names it is known by (short names, past names). */
  aliases?: readonly string[];
  /** Same, as finance records name it (`names`). */
  names?: readonly string[];
}

export interface ResolveOpts {
  /** The record's word ("bill", "document"): the errors read "no bill called …", "more than one bill matches …". */
  noun: string;
  /** Where it lives, in words ("in Money", "in Papers"), for the no-match error. */
  where?: string;
  /** What there is, named when nothing matches ("Bills: A, B."). */
  candidates?: readonly string[];
}

/** The one record `want` names: an exact path or name first, then its aliases, then the only word-start match.
 *  Throws in plain words when nothing matches, or names every candidate when more than one does. The caller says
 *  when nothing was given at all (its own "say which … was paid" reads better than this file's). */
const FILLERS = new Set(['my', 'the', 'a', 'an', 'our', 'your', 'this', 'that', 'please']);
const wordsOf = (s: string) => normalizeRef(s).split(/[^a-z0-9]+/).filter((w) => w && !FILLERS.has(w));
/** Query words (fillers stripped) all appear in the name's words, or the reverse (“credit card” in “Harbour Credit
 *  Card”; “power bill” needs the bill's own alias words, which callers pass as aliases). */
const tokenMatch = (name: string, w: string): boolean => {
  const q = wordsOf(w);
  const n = wordsOf(name);
  if (!q.length || !n.length) return false;
  return q.every((x) => n.includes(x)) || n.every((x) => q.includes(x));
};

export function resolveOne<T extends MatchCandidate>(items: readonly T[], want: unknown, opts: ResolveOpts): T {
  const w = normalizeRef(want);
  const said = String(want ?? '').trim();
  const others = (i: T) => [...(i.aliases ?? []), ...(i.names ?? [])];
  const exacts = items.filter((i) => normalizeRef(i.path ?? '') === w || normalizeRef(i.name) === w);
  const aliasExacts = !exacts.length ? items.filter((i) => others(i).some((a) => normalizeRef(a) === w)) : [];
  const allExacts = [...exacts, ...aliasExacts];
  if (allExacts.length === 1) return allExacts[0];
  if (allExacts.length > 1) throw new Error(`More than one ${opts.noun} matches “${said}”: ${allExacts.map((h) => h.name).join(', ')}. Say which one.`);
  const hits = w ? items.filter((i) => startsAtWord(normalizeRef(i.name), w) || tokenMatch(i.name, w) || others(i).some((a) => startsAtWord(normalizeRef(a), w) || tokenMatch(a, w))) : [];
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(`More than one ${opts.noun} matches “${said}”: ${hits.map((h) => h.name).join(', ')}. Say which one.`);
  const names = (opts.candidates ?? []).filter(Boolean);
  const plural = `${opts.noun.charAt(0).toUpperCase()}${opts.noun.slice(1)}s`;
  throw new Error(`There is no ${opts.noun} called “${said}”${opts.where ? ` ${opts.where}` : ''}.${names.length ? ` ${plural}: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ', …' : ''}.` : ''}`);
}

/** Whether two record names are the same record ("Credit Card", "credit  card" → same): for find-before-create. */
export function sameRecordName(a: string, b: string): boolean {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return !!clean(a) && clean(a) === clean(b);
}
