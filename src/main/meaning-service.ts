// One embedding service (10.0 reuse, 2 Nov 2026: agreed to the bundled meaning model). Short texts in, vectors out:
// search's queries, the weekly tidy's near-duplicates and the former host app's sender matching (through the asks
// seam,
// `embed`) all read the same model through here. Capped: at most 20 texts of 500 characters each, so a note body
// cannot pass and nothing private is ever embedded here; notes embed only through the per-note build
// (src/main/meaning-build.ts), which refuses private notes and left-out folders. Pure apart from the model call.

import { EMBED_DIM } from '../shared/meaning';

/** At most this many short texts in one call (a sender, a subject, a pick list of names). */
export const EMBED_MAX_TEXTS = 20;
/** Each text at most this long (names and senders fit; a note body never does). */
export const EMBED_MAX_CHARS = 500;

export type EmbedResult = { ok: true; vectors: number[][] } | { ok: false; words: string };

/** The texts as the model reads them, or plain words refusing them (never throws). */
export function cleanEmbedTexts(input: unknown): { texts: string[] } | { words: string } {
  if (!Array.isArray(input) || !input.length) return { words: 'Give one or more short texts to embed.' };
  if (input.length > EMBED_MAX_TEXTS) return { words: `Embed at most ${EMBED_MAX_TEXTS} short texts at once.` };
  const texts: string[] = [];
  for (const t of input) {
    if (typeof t !== 'string' || !t.trim()) return { words: 'Each text must hold some words.' };
    if (t.trim().length > EMBED_MAX_CHARS) return { words: `Each text must be short: at most ${EMBED_MAX_CHARS} characters.` };
    texts.push(t.trim());
  }
  return { texts };
}

/**
 * Short texts to the on-device model's vectors (384-wide unit vectors). `queries` is the builder's live
 * handle (null until the model runs); `offWords` says why in the fallback. Refusals and the fallback come
 * back as words, never thrown, so every door (search, tidy, the asks seam) reads the same shape.
 */
export async function embedShortTexts(
  queries: { embed(text: string): Promise<number[]> } | null,
  input: unknown,
  offWords = 'Meaning search is off on this PC.',
): Promise<EmbedResult> {
  const cleaned = cleanEmbedTexts(input);
  if (!('texts' in cleaned)) return { ok: false, words: cleaned.words };
  if (!queries) return { ok: false, words: offWords };
  try {
    const vectors: number[][] = [];
    for (const text of cleaned.texts) {
      const vec = await queries.embed(text);
      if (!Array.isArray(vec) || vec.length !== EMBED_DIM || !vec.every((x) => Number.isFinite(x))) {
        return { ok: false, words: 'Meaning search stumbled just now. Try again in a moment.' };
      }
      vectors.push([...vec]);
    }
    return { ok: true, vectors };
  } catch {
    return { ok: false, words: 'Meaning search stumbled just now. Try again in a moment.' };
  }
}
