// The words to check before minutes go out (5 Nov 2026, on minutes made from a real meeting). Two transcriptions and
// a careful reader all got a person's name and two product words wrong, and no transcript can know those words.
// After the minutes are made, one short list shows the names and product words the transcript is unsure of: spelt
// more than one way in the transcript, close to a known person or project word, a clipped tail of a word said
// steadily, or an initialism said twice or more. Each has a few words of context, the spellings seen, and the moment
// to play. One correction fixes every copy (the note, the transcript and the next PDF) as whole words only, never
// inside another word. Remembered per project (and the people list where it is a person), so next time it is right
// and rides as a hint to the speech service. Nothing blocks. Pure. Noise is worse than a miss (6 Nov 2026, a real
// take raised 11 with 8 noise, and a person stops reading): barely-said words with nothing near stay quiet.
import { frontMatterRange } from './frontmatter';
import { linkWords } from './markdown';
import { LINE_RE, findSection } from './meeting-notes';
import { clockSeconds, stamp, type TranscriptLine } from './recorder';

/** Generic words never flagged (function words, days, months, time, transcript labels): the mechanism's own stoplist,
 *  never a person's product words. A name that is also one of these ("May", "Bill") still flags when spelt two ways
 *  or close to known; rarity alone never flags it. "Speaker N" labels (6 Nov 2026, speakers) are labels, not names.
 *  Common English carries no doubt however capitalised (18 Nov 2026, t301: "Good" line-initial paired with a
 *  misheard "Goed" as spelt two ways, and "Are" line-initial read as close to Azure — both ordinary words). */
const STOP = new Set(
  'a an the and or but if so as at on in of for with by from about after before during until into onto over under out off up down again once here there where when why how what which who whom whose that this these those i me my we us our you your he him his she her it its they them their them themselves himself herself itself ourselves yourselves everybody everyone somebody someone anybody anyone nobody nothing something everything all both each few more most other some such no nor not only own same than too very can will just should now today tomorrow yesterday tonight morning afternoon evening night monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec am pm speaker speakers said says say saying told tell told ask asked asks reply replied thanks thank hello hi hey yes no okay ok right sure well oh ah um uh let lets let us going go goes went come comes came get gets got make makes made take takes took put puts give gives gave use uses used look looks looked see sees saw know knows knew think thinks thought feel feels felt want wants wanted need needs needed like likes liked try tries tried start starts started stop stops stopped finish finished end ended keep keeps kept hold holds held bring brings brought send sends sent show shows showed tell tells told call calls called meet meets met talk talks talked discuss discussed agree agreed decide decided confirm confirmed check checks checked review reviewed update updated share shared email emailed ring rang book booked add added prepare prepared organise organize arrange thanks please kind kindly also just even still already yet ever never always often sometimes usually really very quite rather much many lot lots thing things stuff bit bits part parts time times day days week weeks month months year years one two three four five six seven ten hundred first second third next last this that per cent percent versus vs via etc aupd do does did done doing then there thus hence however anything somewhere everywhere whatever am is are was were be been being has have had having eight nine eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety good bad new old big small great little large long short high low early late young whole true false wrong real clear free full hard easy able likely less best worst half present sorry'.split(' '),
);

/** How alike two spellings must be to count as the same word said twice (by the longer's length). */
const nearThreshold = (a: string, b: string): number => {
  const m = Math.max(a.length, b.length);
  return m <= 4 ? 1 : m <= 7 ? 2 : 3;
};

/** The edits between two spellings (insert, drop, swap one letter): capped early, so long words stay cheap. */
export function editDistance(a: string, b: string, cap = 3): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return 0;
  // A plural is its own word ("Kylie" and "Kylies" correct apart).
  if (x === `${y}s` || y === `${x}s`) return cap + 1;
  const m = x.length;
  const n = y.length;
  if (Math.abs(m - n) > cap) return cap + 1;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let cur0 = i;
    let rowMin = cur0;
    for (let j = 1; j <= n; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur0 + 1, prev[j - 1] + cost);
      prev[j - 1] = cur0;
      cur0 = v;
      if (v < rowMin) rowMin = v;
    }
    prev[n] = cur0;
    if (rowMin > cap) return cap + 1;
  }
  return prev[n];
}

/** Whether two spellings read as the same word said twice (alike enough, and starting alike). A base with its own
 *  possessive ("Alex" with "Alex's") is two forms, not two spellings, so never grouped. */
const nearSpelling = (a: string, b: string): boolean => {
  if (!a || !b || a[0].toLowerCase() !== b[0].toLowerCase()) return false;
  if (a !== b && (a === b.replace(/['’]s$/, '') || b === a.replace(/['’]s$/, ''))) return false;
  return editDistance(a, b, nearThreshold(a, b)) <= nearThreshold(a, b);
};

/** A word that can stand in a written full name: capitalised, long enough, never a generic word ("The ADM panel"
 *  is ADM alone; "Did Priya chase" is Priya alone). */
const nameWord = (w: string): boolean => w.length >= 2 && /^[\p{Lu}]/u.test(w) && !STOP.has(w.toLowerCase());

/** A token's written phrase: itself with its capitalised neighbours ("Michael Roberts", "Sarah Mitchell", bare
 *  "Nayer" alone). Lowercased for comparing. */
const phraseOf = (t: Token): string[] => [t.prev, t.word, t.next].filter((w, i) => i === 1 || nameWord(w)).map((w) => w.toLowerCase());

/** Whether two written phrases read as the same name twice: a bare word agrees with anything (judged alone, as
 *  today), but two full names agree only when near as wholes — "Michael Roberts" is never "Sarah Mitchell"
 *  (t169, 9 Nov 2026, t166's mix-up: the check grouped them as one spelling and prefilled Mitchell for Michael,
 *  one "Fix every copy" from renaming a person everywhere — close names never swap without the person's say). */
const phrasesAgree = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length < 2 || b.length < 2) return true;
  const x = a.join(' ');
  const y = b.join(' ');
  return editDistance(x, y, nearThreshold(x, y)) <= nearThreshold(x, y);
};

/** Whether a token joins a group's spelling: alike enough, and two full names only when near as wholes
 *  (phrasesAgree) — while a bare word joins only within two letters, however long (three changed letters bare
 *  is a different word: "Mitchell" said once where "Michael" said steadily never joins it). The same name's
 *  slot (phraseMate) still joins however far apart, at the call site. */
const joinSpelling = (low: string, gp: readonly string[], t: Token, phrase: readonly string[]): boolean => {
  if (inflectionPair(low, t.lower)) return false;
  if (!nearSpelling(low, t.lower)) return false;
  if (gp.length > 1 && phrase.length > 1) return phrasesAgree(gp, phrase);
  return editDistance(low, t.lower, 2) <= 2;
};

interface Token {
  word: string;
  lower: string;
  at: number;
  context: string;
  /** The line's own first word (its capital is the sentence's, not the word's). */
  first: boolean;
  /** Its sentence's first word, wherever the sentence sits in its line (6 Nov 2026, e2: a segment holds many
   *  sentences, and "Noted." / "Leave it open?" mid-segment carry their sentence's capital, not a name's). */
  sentenceFirst: boolean;
  /** Its sentence's last word (the sentence ends with it, or its line does): with `sentenceFirst`, alone in
   *  its sentence ("Noted."). */
  sentenceLast: boolean;
  /** The word before it in its line, as written ('' at the line's start): a name's slot is read from it too. */
  prev: string;
  /** The word after it in its line, as written ('' at the line's end): a name's slot is read from it. */
  next: string;
}

/** A transcript's words with their moment and a few words of context each (three either side, from their own line). */
function tokensOf(lines: readonly TranscriptLine[]): Token[] {
  const out: Token[] = [];
  const wordRe = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
  for (const l of lines) {
    const words: { word: string; index: number }[] = [];
    for (const m of l.text.matchAll(wordRe)) words.push({ word: m[0], index: m.index! });
    words.forEach((w, i) => {
      const before = words.slice(Math.max(0, i - 3), i).map((x) => x.word);
      const after = words.slice(i + 1, i + 4).map((x) => x.word);
      const prev = words[i - 1];
      const sentenceFirst = i === 0 || /[.!?]/.test(l.text.slice(prev.index + prev.word.length, w.index));
      const following = words[i + 1];
      const sentenceLast = !following || /[.!?]/.test(l.text.slice(w.index + w.word.length, following.index));
      out.push({ word: w.word, lower: w.word.toLowerCase(), at: l.at, context: [...before, w.word, ...after].join(' '), first: i === 0, sentenceFirst, sentenceLast, prev: prev?.word ?? '', next: following?.word ?? '' });
    });
  }
  return out;
}

/** An initialism as the check reads one: all capitals and figures, at least two (as flagWorthy flags). */
const isInitialism = (w: string) => /^[A-Z0-9]{2,}$/.test(w);

/** A word worth flagging: a name or product word (capitalised, all caps, or holding a figure), long enough, and
 *  never a generic word. Lowercase prose ("send the quote") never flags. Plurals of generic words ("Fridays") count
 *  as their word. A figure-led token ("19th", "27th", "2026", "6AM") is a date, time or count, never a name (6 Nov
 *  2026, the Fitzroy run flagged 19th and 27th as noise); a letter-led token holding a figure ("TR4", "v2") may be. */
function flagWorthy(word: string): boolean {
  const lower = word.toLowerCase();
  if (STOP.has(lower) || STOP.has(lower.replace(/s$/, ''))) return false;
  if (/^\d/.test(word)) return false;
  if (/^[\p{Lu}]/u.test(word)) return word.length >= 3;
  if (/^[A-Z0-9]{2,}$/.test(word)) return true;
  return word.length >= 3 && /\d/.test(word);
}

/** Known words split for comparing: each name whole and in parts ("Sam Okafor" as "Sam Okafor", "Sam", "Okafor"). */
function knownParts(known: readonly string[]): { full: string; part: string; lower: string }[] {
  const out: { full: string; part: string; lower: string }[] = [];
  for (const k of known) {
    const clean = linkWords(k).replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const parts = clean.split(/\s+/).filter((p) => p.length >= 2);
    for (const p of [...new Set([clean, ...parts])]) out.push({ full: clean, part: p, lower: p.toLowerCase() });
  }
  return out;
}

export interface UncertainSpot {
  spelling: string;
  context: string;
  at: number;
}

export interface UncertainWord {
  /** The spelling shown (the commonest seen, else the first). */
  display: string;
  /** Every spelling seen in the transcript. */
  spellings: string[];
  /** Where it was said (up to three), each with context and its moment to play from. */
  spots: UncertainSpot[];
  /** How many times it was said in all. */
  count: number;
  reason: 'spelt-two-ways' | 'close-to-known' | 'rare';
  /** The known spelling it is close to, when it is close to one. */
  known?: string;
}

/** The most words the check list ever shows: the best 5, ordered by how likely each is wrong (6 Nov 2026, a
 *  real take raised 11 and the person stopped reading). */
export const CHECK_LIMIT = 5;

/** A word's stems: itself and each undoing of one inflection (s, es, ies, ed, ing, er, est), with a
 *  dropped e restored ("making" reads "make") and a doubled consonant undone ("running" reads "run"). Stems
 *  under three letters never count ("king" is not "kin" inflected). Lowercased pair; see inflectionPair. */
function wordStems(w: string): Set<string> {
  const out = new Set([w]);
  const keep = (s: string) => {
    if (s.length < 3 || s === w) return;
    out.add(s);
    // A doubled consonant undone ("runn" reads "run"); ss keeps ("pass" is no stem of "passes" alone).
    const dbl = /(.)\1$/.exec(s);
    if (dbl && dbl[1] !== 's' && dbl[1] !== 'l' && dbl[1] !== 'z') out.add(s.slice(0, -1));
    // A dropped e restored ("migrat" reads "migrate").
    if (/[bcdfgjklmnpqrstvwxz]/.test(s[s.length - 1] ?? '')) out.add(`${s}e`);
  };
  if (w.endsWith('ies') && w.length > 4 && !/[aeiou]/.test(w[w.length - 4] ?? '')) keep(`${w.slice(0, -3)}y`);
  else if (w.endsWith('es') && w.length > 4 && /(s|x|z|ch|sh)$/.test(w.slice(0, -2))) keep(w.slice(0, -2));
  // A bare s never strips off s, x, z, ch or sh (as pluralPair: "winchs" is no form of "winches", but a misspelling).
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3 && !/(s|x|z|ch|sh)$/.test(w.slice(0, -1))) keep(w.slice(0, -1));
  if (w.endsWith('ing') && w.length > 5) keep(w.slice(0, -3));
  else if (w.endsWith('ed') && w.length > 4) keep(w.slice(0, -2));
  if (w.endsWith('er') && w.length > 4) keep(w.slice(0, -2));
  else if (w.endsWith('est') && w.length > 4) keep(w.slice(0, -3));
  return out;
}

/** Whether two spellings are one word's inflections ("migrate"/"migrating", "quote"/"quoted", "run"/"running"):
 *  the same word said differently, never a mishear (18 Nov 2026, t301: "migrating" read as close to "migrate").
 *  A shared stem of three letters or more; anything else is judged on its letters as before. */
const inflectionPair = (a: string, b: string): boolean => {
  if (a === b) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y || Math.abs(x.length - y.length) > 4) return false;
  for (const s of wordStems(x)) if (s.length >= 3 && wordStems(y).has(s)) return true;
  return false;
};

/** Whether two spellings are one word's singular and plural ("store"/"stores", "delivery"/"deliveries",
 *  "pass"/"passes"): different words, never a mishear. A wrong plural ("winchs" for "winches") is no pair. */
const pluralPair = (a: string, b: string): boolean => {
  if (a === `${b}s` || b === `${a}s`) return true;
  const ies = (x: string, y: string) => y.endsWith('ies') && x === `${y.slice(0, -3)}y` && !/[aeiou]/.test(y[y.length - 4] ?? '');
  if (ies(a, b) || ies(b, a)) return true;
  const es = (x: string, y: string) => y.endsWith('es') && x === y.slice(0, -2) && /(s|x|z|ch|sh)$/.test(x);
  return es(a, b) || es(b, a);
};

/** Whether a once-said word is a clipped tail of a word said steadily or a known word ("Roy" in a meeting saying
 *  "Fitzroy" steadily): worth one row. A prefix never counts ("Fit" starting "Fitzroy" is its own word, and "Fit
 *  Out" is a misheard compound, not a clip), and hyphenated compounds never carry ("fit-out" is two words joined).
 *  Plain letters only, and the carrier two letters longer at least. */
const clippedTail = (l: string, steady: readonly { lower: string; count: number }[], knownLowers: ReadonlySet<string>): boolean => {
  if (l.length < 3 || !/^[a-z]+$/.test(l)) return false;
  const inside = (c: string) => c.length >= l.length + 2 && c.includes(l) && c[0] !== l[0] && /^[a-z]+$/.test(c);
  if (steady.some((s) => s.count >= 3 && inside(s.lower))) return true;
  for (const k of knownLowers) if (inside(k)) return true;
  return false;
};

/**
 * The names and product words the transcript is unsure of: spelt more than one way in it, close to a known person
 * or project word, a clipped tail of a word said steadily, or an all-capitals word said twice or more. Known
 * spellings read right are never flagged. Sorted with the likeliest mistakes first (two ways, then close, then
 * rare; fewer sayings first within each), at most CHECK_LIMIT. Quiet (empty) when nothing is unsure.
 */
export function findUncertain(lines: readonly TranscriptLine[], known: readonly string[]): UncertainWord[] {
  const tokens = tokensOf(lines.filter((l) => l.text && !/couldn[’']t be written down yet/.test(l.text)));
  const worthy = tokens.filter((t) => flagWorthy(t.word));
  const parts = knownParts(known);
  const knownLowers = new Set(parts.map((p) => p.lower));
  // Every spelling's sayings, however cased (a capitalised "Green" with a lowercase "green" elsewhere is the same
  // ordinary word twice, not a rare name once: 6 Nov 2026, the Fitzroy run flagged Green as noise).
  const saidLower = new Map<string, number>();
  for (const t of tokens) saidLower.set(t.lower, (saidLower.get(t.lower) ?? 0) + 1);
  // Words the meeting says steadily, however cased (said twice or more: once on each side is still twice heard).
  // A near-spelling of one of these, said once, is worth offering ask-first (6 Nov 2026, "Pittsroy" for a meeting
  // saying "Fitzroy" steadily, "tils" for "tills", both went unflagged).
  const frequent = new Map<string, { count: number; display: string }>();
  for (const t of tokens) {
    if (STOP.has(t.lower) || t.lower.length < 4 || !/[a-z]/.test(t.lower)) continue;
    const f = frequent.get(t.lower) ?? { count: 0, display: t.word };
    f.count++;
    if (f.count === 1 || tokens.filter((x) => x.lower === t.lower && x.word === t.word).length > tokens.filter((x) => x.lower === t.lower && x.word === f.display).length) f.display = t.word;
    frequent.set(t.lower, f);
  }
  const steady = [...frequent].filter(([, f]) => f.count >= 2).map(([lower, f]) => ({ lower, display: f.display, count: f.count }));
  // How alike a once-said spelling must be to a steady word to be offered: in a short word two changed letters
  // make a different word ("stock" is not "store", "starts" is not "stores": 6 Nov 2026, noise), so one letter
  // only there; longer words keep the check's own threshold.
  const steadyNear = (l: string, s: string): boolean => {
    const cap = Math.max(l.length, s.length) <= 6 ? 1 : nearThreshold(l, s);
    return editDistance(l, s, cap) <= cap;
  };
  // Two spellings in the one name's slot in this meeting (each just before the same capitalised word:
  // "Marix Creek" and "Merrick's Creek", 6 Nov 2026, e2) are the one name heard two ways, however far
  // apart the spellings sit: one row, one fix. Two spellings both already known ("Alex Smith" beside
  // "Adam Smith") are two names, never merged.
  const phraseMate = (group: readonly Token[], t: Token): boolean => {
    if (!t.next || t.next.length < 3 || !/^\p{Lu}/u.test(t.next) || STOP.has(t.next.toLowerCase())) return false;
    if (knownLowers.has(t.lower)) return false;
    return group.some((g) => g.lower !== t.lower && g.lower[0] === t.lower[0] && !knownLowers.has(g.lower) && g.next.toLowerCase() === t.next.toLowerCase() && /^\p{Lu}/u.test(g.next));
  };
  // Group spellings that read as the same word said twice (joinSpelling: two different full names stay apart,
  // a bare word joins only within two letters); the same name's slot (phraseMate) still joins, however far
  // apart the spellings sit.
  const groups: Token[][] = [];
  const lowers: string[] = [];
  const phrases: string[][] = [];
  for (const t of worthy) {
    let placed = false;
    const phrase = phraseOf(t);
    for (let g = 0; g < groups.length; g++) {
      if (joinSpelling(lowers[g], phrases[g], t, phrase) || phraseMate(groups[g], t)) {
        groups[g].push(t);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push([t]);
      lowers.push(t.lower);
      phrases.push(phrase);
    }
  }
  const out: UncertainWord[] = [];
  for (const g of groups) {
    const spellings = [...new Set(g.map((t) => t.word))];
    const lowSet = new Set(g.map((t) => t.lower));
    const exact = [...lowSet].some((l) => knownLowers.has(l));
    // The closest known spelling, when one is near. A heard full name is judged as its full name: one close word
    // inside two different names ("Michael" in "Michael Roberts" against "Mitchell" in "Sarah Mitchell") is never
    // a misspelling — the names must share another word. A bare word against a full known name must be a slip of
    // one or two letters; three changed letters in a name is a different name (t169, never swap without the say).
    let close: { full: string; part: string; d: number } | null = null;
    for (const t of g) {
      const l = t.lower;
      if (knownLowers.has(l)) continue;
      const phrase = phraseOf(t);
      const bare = phrase.length < 2;
      for (const p of parts) {
        if (p.lower[0] !== l[0] || STOP.has(p.lower)) continue;
        // A heard word close to the vault's real term offers it (18 Nov 2026, t301: a misheard MeshHub
        // offered nothing for MaxHub, three letters away): words of six or more allow three changed letters.
        // Shorter words keep the check's own threshold, and a bare word against a full known name still two.
        const cap = Math.max(l.length, p.lower.length) >= 6 ? 3 : nearThreshold(l, p.lower);
        const d = editDistance(l, p.lower, cap);
        if (d > cap || d <= 0) continue;
        const fullWords = p.full.toLowerCase().split(/\s+/);
        if (fullWords.length > 1) {
          if (bare) {
            if (d > 2) continue;
          } else if (!fullWords.some((w) => w !== p.lower && phrase.some((v) => v !== l && (v === w || editDistance(v, w, 1) <= 1)))) continue;
        }
        if (!close || d < close.d) close = { full: p.full, part: p.part, d };
      }
    }
    // The spelling shown (the commonest seen, else the first): an all-capitals row is read off it.
    const counts = new Map<string, number>();
    for (const t of g) counts.set(t.word, (counts.get(t.word) ?? 0) + 1);
    const display = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    // A word whose every saying opens its sentence where a doing word or an acknowledgement stands, never
    // where a name stands, carries its sentence's capital, not a name's (6 Nov 2026, e2: "Noted." alone
    // and "Leave it open?" were offered as close to "Notes" and "Lease"): nearness to a known word alone
    // is no doubt for it. A name's slot (a content word next: "Nayer chased…") still flags wherever it
    // stands; two spellings, or nearness to a word this meeting says steadily (below), always do; an
    // initialism's capitals are its own, never a sentence's.
    const afterVerb = new Set('it this that them him her us me the a an'.split(' '));
    const sentenceOnly = !isInitialism(display) && g.every((t) => t.sentenceFirst && (t.sentenceLast || afterVerb.has(t.next.toLowerCase())));
    let reason: UncertainWord['reason'] | null = null;
    // Readings both already known are two names, never one doubt (t169: "Michael" with "Mitchell" both known).
    if (lowSet.size > 1 && [...lowSet].every((l) => knownLowers.has(l))) continue;
    if (lowSet.size > 1) reason = 'spelt-two-ways';
    else if (exact) continue;
    // A possessive of a name already known ("Alex's" when Alex Rivera is known) reads right (6 Nov 2026, the
    // Fitzroy run flagged Alex's as noise); two spellings still flag above, however cased.
    else if (lowSet.size === 1 && knownLowers.has([...lowSet][0].replace(/['’]s$/, ''))) continue;
    else if (close && !sentenceOnly) reason = 'close-to-known';
    // A near-spelling of a word the meeting says steadily, said fewer times itself: offered with the steady
    // spelling to prefill, wherever it stands (a mistranscription need not start its word like the word it
    // misspeaks: "Pittsroy" for "Fitzroy"). Initialisms keep their own rule below.
    else if (lowSet.size === 1 && !isInitialism(display)) {
      const l = [...lowSet][0];
      const said = saidLower.get(l) ?? g.length;
      let heard: { display: string } | null = null;
      if (said < 3 && l.length >= 4 && g.length <= 2) {
        for (const s of steady) {
          if (s.lower === l || s.lower.length < 4 || pluralPair(l, s.lower) || s.count <= said) continue;
          // A capitalised word against a steady one is a name against a name: two letters at most (t169: a
          // "Mitchell" said once where "Michael" said steadily is a different person, never a misspelling).
          // An inflection of it ("Migrating" where "Migrate" said steadily) is the same word, never a doubt.
          if (steadyNear(l, s.lower) && editDistance(l, s.lower, 2) <= 2 && !inflectionPair(l, s.lower)) {
            heard = { display: s.display };
            break;
          }
        }
      }
      if (heard) {
        reason = 'close-to-known';
        close = { full: heard.display, part: heard.display, d: 1 };
      } else if (g.length <= 1) {
        // Rare counts only past the line's start (a transcript capitalises every line: "Did", "Then" and
        // "Anything" opening lines are sentences, not names), only when said once however cased (a steady word
        // said twice is consistent, not unsure), and only as a clipped tail of a word said steadily or a known
        // word (6 Nov 2026, a real take's said-once Green, David, Kim and Brunswick were all noise: said once
        // with nothing near is not unsure). Two spellings or a near miss flag wherever they stand, however often.
        if ((saidLower.get([...lowSet][0]) ?? g.length) > 1) continue;
        if (!g.some((t) => !t.first)) continue;
        if (!clippedTail([...lowSet][0], steady, knownLowers)) continue;
        reason = 'rare';
      } else if (isInitialism(display)) reason = 'rare';
      else continue;
    }
    // All-capitals words are the exception: an initialism heard wrong (PCI as PCR) reads steady however often,
    // so one said twice or more is worth one row. Said once, it needs a clipped tail like any other word.
    else if (g.length <= 1) {
      if ((saidLower.get([...lowSet][0]) ?? g.length) > 1) continue;
      if (!g.some((t) => !t.first)) continue;
      if (!clippedTail([...lowSet][0], steady, knownLowers)) continue;
      reason = 'rare';
    } else if (isInitialism(display)) reason = 'rare';
    else continue;
    const spots = g.slice(0, 3).map((t) => ({ spelling: t.word, context: t.context, at: t.at }));
    out.push({ display, spellings: spellings.sort(), spots, count: g.length, reason, ...(close ? { known: (close as { part: string }).part } : {}) });
  }
  // A wrong lowercase word that makes no sense in its sentence ("books counsel" for "books council", missed 6 Nov
  // 2026 when the Fitzroy run kept it; "tils" for "tills", missed the same day): each spelling said once or twice,
  //  near a word the transcript itself says steadily (three times or more, and more often than the spelling), gets
  //  its own row, ask-first as ever. Two ordinary words merely alike ("stock" and "store", "starts" and "stores")
  //  stay quiet: in a short word two changed letters make a different word, and a twice-said almost-word is not
  //  steady enough to correct by (6 Nov 2026, "stone" said twice offered itself for "stock"). One word inside the
  //  other is a form of it, not a mishear ("train" for "training"). Dates, generic words and short words never
  //  qualify; a spelling already known reads right.
  const lowTokens = tokens.filter((t) => !flagWorthy(t.word) && !STOP.has(t.lower) && t.lower.length >= 4 && /[a-z]/.test(t.lower) && !/^\d/.test(t.word));
  if (lowTokens.length) {
    const lowGroups: Token[][] = [];
    const lowLowers: string[] = [];
    for (const t of lowTokens) {
      let placed = false;
      for (let g = 0; g < lowGroups.length; g++) {
        if (nearSpelling(lowLowers[g], t.lower)) {
          lowGroups[g].push(t);
          placed = true;
          break;
        }
      }
      if (!placed) {
        lowGroups.push([t]);
        lowLowers.push(t.lower);
      }
    }
    for (const g of lowGroups) {
      const lowSet = new Set(g.map((t) => t.lower));
      for (const l of lowSet) {
        if (knownLowers.has(l)) continue;
        const said = saidLower.get(l) ?? 0;
        if (said === 0 || said >= 3) continue;
        let best: { display: string; d: number } | null = null;
        for (const s of steady) {
          if (s.count < 3 || s.lower === l || s.lower[0] !== l[0] || pluralPair(l, s.lower) || inflectionPair(l, s.lower) || s.count <= said) continue;
          if (s.lower.includes(l) || l.includes(s.lower)) continue;
          const d = editDistance(l, s.lower, nearThreshold(l, s.lower));
          if (d > 0 && d <= nearThreshold(l, s.lower) && steadyNear(l, s.lower) && (!best || d < best.d)) best = { display: s.display, d };
        }
        if (!best) continue;
        // This spelling only: one fix corrects every copy, and must never rewrite a word that was already right
        // ("till" beside a "tils" offered as "tills"; 6 Nov 2026, "stock" was offered as "stone" with "store"
        // along for the ride).
        const unsure = g.filter((t) => t.lower === l);
        const counts = new Map<string, number>();
        for (const t of unsure) counts.set(t.word, (counts.get(t.word) ?? 0) + 1);
        const display = [...counts].sort((a, b) => b[1] - a[1])[0][0];
        const spellings = [...new Set(unsure.map((t) => t.word))].sort();
        const spots = unsure.slice(0, 3).map((t) => ({ spelling: t.word, context: t.context, at: t.at }));
        out.push({ display, spellings, spots, count: unsure.length, reason: 'close-to-known', known: best.display });
      }
    }
  }
  const rank = { 'spelt-two-ways': 0, 'close-to-known': 1, rare: 2 } as const;
  return out.sort((a, b) => rank[a.reason] - rank[b.reason] || a.count - b.count || a.spots[0].at - b.spots[0].at).slice(0, CHECK_LIMIT);
}

/**
 * One correction over every copy: each spelling seen replaced as whole words only, never inside another word
 * ("Kylie" never touches "Kylies" or "well-Kylie-known"). Case is ignored so every copy is caught; the correction
 * is written exactly as given. Gives the text and how many copies changed.
 */
export function applyCorrection(text: string, from: readonly string[], to: string): { text: string; count: number } {
  const clean = to.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 80) return { text, count: 0 };
  const variants = [...new Set(from.map((s) => s.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!variants.length) return { text, count: 0 };
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Word edges: letters, figures and hyphen hold a word together (never inside "Kylies" or "well-Kylie"); an
  // apostrophe does not, so a possessive ("Kyliee's") is fixed with its word.
  const re = new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${variants.map(esc).join('|')})(?![\\p{L}\\p{N}_-])`, 'giu');
  let count = 0;
  const next = text.replace(re, () => {
    count++;
    return clean;
  });
  return { text: next, count };
}

/** Whether a corrected spelling reads as a person's name (two or three capitalised words): kept with the people
 *  list as well as the project. A supplier in the same shape ("Western Plains") rides along harmlessly: an extra
 *  hint never hurts. */
export function isPersonName(spelling: string): boolean {
  const parts = spelling.replace(/\s+/g, ' ').trim().split(' ');
  if (parts.length < 2 || parts.length > 3) return false;
  return parts.every((p) => /^[\p{Lu}][\p{L}'’-]{1,29}$/u.test(p) && !STOP.has(p.toLowerCase()));
}

/** Capitalised phrases and product words lifted from project notes and earlier meetings for the check (people first,
 *  each once however cased, capped). */
export function extractKnownWords(input: { people?: readonly string[]; projectText?: string; earlierTexts?: readonly string[] }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const keep = (s: string) => {
    const clean = linkWords(s).replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!clean || clean.length < 2 || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    out.push(clean);
  };
  for (const p of input.people ?? []) keep(p);
  const fromText = (t: string) => {
    // Line by line: a name never runs past its line ("Summary" above "Priya Nair" is not "Summary Priya Nair").
    // Heading lines are the note's own section names ("Notes", "Summary"), never a person's or product's name
    // to suggest (6 Nov 2026, e2: "Noted" was offered "Notes").
    for (const line of t.split('\n')) {
      if (/^\s*#{1,6}\s/.test(line)) continue;
      for (const m of line.matchAll(/\p{Lu}[\p{L}'’-]*((?: +)\p{Lu}[\p{L}'’-]*| +of +\p{Lu}[\p{L}'’-]*){0,3}|[A-Z0-9]{2,}(?:[-_][A-Z0-9]+)*|[\p{L}][\p{L}\p{N}'’-]*\d[\p{L}\p{N}'’-]*/gu)) {
        // Leading generic words are the sentence, not the name ("See Western Plains Mill" is the mill).
        const words = m[0].trim().split(/\s+/);
        while (words.length > 1 && STOP.has(words[0].toLowerCase())) words.shift();
        const w = words.join(' ');
        if (!w || words.every((x) => STOP.has(x.toLowerCase()))) continue;
        keep(w);
        if (out.length >= 500) return;
      }
      if (out.length >= 500) return;
    }
  };
  if (input.projectText) fromText(input.projectText);
  for (const t of input.earlierTexts ?? []) {
    fromText(t);
    if (out.length >= 500) break;
  }
  return out.slice(0, 500);
}

/**
 * A meeting note without its transcript (the section gone, the rest kept): earlier meetings lend the check their
 * corrected words (summaries, decisions, actions), never their raw transcript spellings — else one meeting's
 * misspelling would read as known in the next and never be caught.
 */
export function withoutTranscript(noteText: string): string {
  const range = frontMatterRange(noteText);
  const head = range ? noteText.slice(0, range.to) : '';
  const lines = (range ? noteText.slice(range.to) : noteText).split(/\r?\n/);
  const at = findSection(lines, 0, TRANSCRIPT);
  if (!at) return noteText;
  const next = [...lines.slice(0, at.start), ...lines.slice(at.end)];
  while (next.length && !next[next.length - 1].trim()) next.pop();
  return (head + next.join('\n')).replace(/\s*$/, '\n');
}

/** "42 minutes", "1 hour 5 minutes", "under a minute" as milliseconds (null: not a length). */
export function lengthMs(words: string | undefined): number | null {
  const t = String(words ?? '').trim().toLowerCase();
  if (!t) return null;
  if (/^under a minute$/.test(t)) return 30_000;
  const h = /(?:(\d+)\s*hours?)?\s*(?:(\d+)\s*minutes?)?/.exec(t);
  if (!h || (!h[1] && !h[2])) return null;
  return (h[1] ? Number(h[1]) * 3600 : 0) * 1000 + (h[2] ? Number(h[2]) * 60 : 0) * 1000;
}

export interface ThinStretch {
  /** Seconds into the recording, start and end. */
  start: number;
  end: number;
  /** Words the transcript has for it, and what its length should give (at unhurried speech). */
  words: number;
  expected: number;
  /** What it covers, in words ("12:00 to 12:30"). */
  cover: string;
}

/** Speech unhurried is about 100 words a minute; a stretch with under a tenth of that came back very short. */
const WPM = 100;
const BUCKET = 30;

/**
 * Stretches that came back very short for their length: the transcript against what its length should give. Only
 * when the whole transcript is under half of what it should give (a pause in a good transcript is silence, not a
 * gap); stretches are 30-second buckets with under five words, joined. Empty when there is nothing to re-hear.
 */
export function findThinStretches(lines: readonly TranscriptLine[], elapsedMs: number): ThinStretch[] {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 20_000) return [];
  const kept = lines.filter((l) => l.text && !/couldn[’']t be written down yet/.test(l.text));
  if (!kept.length) return [];
  const wordsOf = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
  const total = kept.reduce((s, l) => s + wordsOf(l.text), 0);
  const expectedWhole = Math.max(1, Math.round((elapsedMs / 60_000) * WPM));
  if (total >= expectedWhole * 0.5) return [];
  const buckets: number[] = new Array(Math.ceil(elapsedMs / 1000 / BUCKET)).fill(0);
  for (const l of kept) {
    const b = Math.floor(l.at / BUCKET);
    if (b >= 0 && b < buckets.length) buckets[b] += wordsOf(l.text);
  }
  const out: ThinStretch[] = [];
  let at = -1;
  const flush = (end: number) => {
    if (at < 0) return;
    const start = at * BUCKET;
    const finish = Math.min(Math.round(elapsedMs / 1000), end * BUCKET);
    const words = buckets.slice(at, end).reduce((s, n) => s + n, 0);
    out.push({ start, end: finish, words, expected: Math.max(1, Math.round(((finish - start) / 60) * WPM)), cover: `${stamp(start)} to ${stamp(finish)}` });
    at = -1;
  };
  buckets.forEach((n, i) => {
    if (n < 5 && at < 0) at = i;
    else if (n >= 5 && at >= 0) flush(i);
  });
  flush(buckets.length);
  return out.slice(0, 6);
}

const TRANSCRIPT = /^transcript$/i;

/**
 * A stretch re-heard: the transcript's lines from `start` to `end` seconds replaced with these, nothing else in
 * the note touched (the person's own words stay exactly where they are). `part` picks the recording when the
 * meeting was recorded more than once (0 is the first). Gives the text and how many lines were replaced.
 */
export function replaceTranscriptStretch(text: string, start: number, end: number, lines: readonly TranscriptLine[], part = 0): { text: string; replaced: number } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const range = frontMatterRange(text);
  const head = range ? text.slice(0, range.to) : '';
  const body = (range ? text.slice(range.to) : text).split(/\r?\n/);
  const at = findSection(body, 0, TRANSCRIPT);
  if (!at) return { text, replaced: 0 };
  // The part's own lines (the first runs from under the heading; each "###" starts the next).
  const starts = [at.start + 1];
  for (let i = at.start + 1; i < at.end; i++) if (/^###\s+/.test(body[i])) starts.push(i);
  const p = Math.min(Math.max(0, part), starts.length - 1);
  const from = starts[p];
  const to = p + 1 < starts.length ? starts[p + 1] : at.end;
  const hits: number[] = [];
  let insert = to;
  for (let i = from; i < to; i++) {
    const m = LINE_RE.exec(body[i]);
    if (!m) continue;
    const secs = clockSeconds(m[1]);
    if (secs === null) continue;
    if (secs >= start && secs <= end) hits.push(i);
    else if (secs > end && insert === to) insert = i;
  }
  if (insert === to) {
    // Past the last line of the part (or the part has no lines in range): before its end, after its lines.
    insert = to;
    while (insert > from && body[insert - 1].trim() === '') insert--;
  }
  const made = lines.map((l) => {
    const who = l.who ? `*${l.who.replace(/[*:\n]/g, '').trim()}:* ` : '';
    return `> **${stamp(l.at)}** ${who}${l.text.replace(/\n+/g, ' ')}`;
  });
  const drop = new Set(hits);
  const kept: string[] = [];
  for (let i = from; i < to; i++) {
    if (drop.has(i)) continue;
    // Blank quote runs collapse (removing lines leaves doubles); none directly under a callout header or part heading.
    if (/^>\s*$/.test(body[i])) {
      const prev = kept.length ? kept[kept.length - 1] : body[from - 1] ?? '';
      if (!kept.length || /^>\s*$/.test(prev) || /^\[!quote\]/.test(prev.replace(/^>\s?/, '')) || /^###\s+/.test(prev)) continue;
    }
    kept.push(body[i]);
  }
  // The new lines where the first removed line was (or the chronological spot when the stretch had no lines).
  let spot = insert - from - hits.filter((h) => h < insert).length;
  spot = Math.max(0, Math.min(kept.length, spot));
  // A blank quote between the new lines and a neighbouring transcript line, as the recorder writes them.
  const isLine = (s: string | undefined) => !!s && LINE_RE.test(s);
  const block: string[] = [];
  made.forEach((m, i) => {
    if (i) block.push('>');
    block.push(m);
  });
  if (block.length) {
    if (isLine(kept[spot - 1])) block.unshift('>');
    if (isLine(kept[spot])) block.push('>');
  }
  const next = [...body.slice(0, from), ...kept.slice(0, spot), ...block, ...kept.slice(spot), ...body.slice(to)];
  const out = (head + next.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n')).replace(/\r?\n/g, eol);
  return { text: out, replaced: hits.length };
}
