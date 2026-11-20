// What the assistant knows about the person (5 Nov 2026, v8-vault-assistant: the audit found it starts every chat a
// stranger). Stated facts and preferences persist across chats in Ironleaf's own data, never the notes, through the
// model's own remember/forget tools: the model interprets what is lasting, nothing here gates on the person's words.
// Pure: the app loads and saves the JSON file, the tools call these.

/** One thing they stated: its words, and the day they said it (YYYY-MM-DD). */
export interface AssistantFact {
  fact: string;
  updated: string;
}

export interface AssistantMemory {
  facts: AssistantFact[];
}

/** How many facts are kept: past this the model is asked what to forget, so nothing is ever dropped silently. */
export const MEMORY_CAP = 30;
/** A fact's longest line: longer is trimmed at a word, never refused. */
const FACT_CHARS = 200;

const norm = (s: string) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
const wordsOf = (s: string) => norm(s).split(' ').filter((w) => w.length > 2);

/** A fact's words as kept: one line, capped, ending with a stop. */
function tidyFact(fact: string): string {
  let f = String(fact ?? '').replace(/\s+/g, ' ').trim();
  if (f.length > FACT_CHARS) f = `${f.slice(0, FACT_CHARS).replace(/\s+\S*$/, '')}…`;
  if (f && !/[.!?…]$/.test(f)) f += '.';
  return f;
}

/**
 * Keeps a stated fact. Said again: kept once. Restated (the old line's words inside the new, or most of them):
 * the new line replaces it. Full: refused with the oldest named, so the person chooses what goes.
 */
export function rememberFact(mem: AssistantMemory, fact: string, today: string): { mem: AssistantMemory; kept: boolean; words: string } {
  const tidy = tidyFact(fact);
  if (!tidy) return { mem, kept: false, words: 'There was nothing to keep there.' };
  if (/\?\s*$/.test(String(fact ?? '').trim())) return { mem, kept: false, words: 'That is a question, not something to keep: answer it instead.' };
  const facts = mem.facts.filter((f) => f.fact.trim());
  const key = norm(tidy);
  if (facts.some((f) => norm(f.fact) === key)) return { mem: { facts }, kept: true, words: 'I already know that.' };
  // The same thing restated: the new words win (a correction replaces; the memory never contradicts itself).
  const mine = new Set(wordsOf(tidy));
  const restates = (old: string) => {
    const o = norm(old);
    if (!o || !key) return false;
    if (key.includes(o) || o.includes(key)) return true;
    const shared = wordsOf(old).filter((w) => mine.has(w)).length;
    return shared >= 2 && shared * 2 >= wordsOf(old).length;
  };
  const replaced = facts.filter((f) => restates(f.fact));
  if (replaced.length) {
    const rest = facts.filter((f) => !restates(f.fact));
    return { mem: { facts: [...rest, { fact: tidy, updated: today }] }, kept: true, words: `Updated what I knew: ${tidy}` };
  }
  if (facts.length >= MEMORY_CAP) return { mem: { facts }, kept: false, words: `I’m keeping ${MEMORY_CAP} things already. The oldest is “${facts[0].fact}”. Ask me to forget something first, then I’ll keep this.` };
  return { mem: { facts: [...facts, { fact: tidy, updated: today }] }, kept: true, words: `Kept: ${tidy}` };
}

/** Drops every fact the topic's words all appear in, and says what went. */
export function forgetFact(mem: AssistantMemory, topic: string): { mem: AssistantMemory; forgot: string[]; words: string } {
  const facts = mem.facts.filter((f) => f.fact.trim());
  const want = wordsOf(topic);
  if (!want.length) return { mem: { facts }, forgot: [], words: 'There’s nothing like that kept.' };
  const hit = (f: string) => {
    const has = new Set(wordsOf(f));
    return want.every((w) => has.has(w));
  };
  const forgot = facts.filter((f) => hit(f.fact)).map((f) => f.fact);
  if (!forgot.length) return { mem: { facts }, forgot: [], words: 'There’s nothing like that kept.' };
  return { mem: { facts: facts.filter((f) => !hit(f.fact)) }, forgot, words: `Forgot: ${forgot.join('; ')}` };
}

/** What it knows, as the instructions read it: used naturally in answers, never recited. '' when it knows nothing. */
export function memoryWords(mem: AssistantMemory): string {
  const facts = mem.facts.filter((f) => f.fact.trim());
  if (!facts.length) return '';
  return [`What you already know about them (they told you before, across chats; use it naturally where it helps, never read the list back):`, ...facts.map((f) => `- ${f.fact.trim()}`)].join('\n');
}
