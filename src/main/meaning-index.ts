// The meaning index (2 Nov 2026, 10.0 "Endless Tech": find notes by what they mean, on this PC only): each note's
// ideas (src/shared/meaning.ts) hashed small, beside the file index, in memory like the notes index. Rebuilt by the
// indexer on open (set per note), updated on every change, never in the notes. Private notes and the left-out folders
// are never indexed (refused here and skipped where read, so a slip in one place still can't leak). Real embeddings
// (Wave 2, same day, still on this PC only) replace the hashed vectors behind this same seam: setVector installs the
// on-device model's vectors (a long note's extra pieces beside its first), searchVector searches a query vector,
// vectors carries them to Related. Until a note's embedding lands, its hashed vector answers, so search never has a
// gap on first open.

import { isPrivatePath } from '../shared/private';
import { cosine, EMBED_DIM, MEANING_COVER_MIN, MEANING_SEARCH_MIN, meaningWords, sharedConcepts, vectorFromMeaning, type MeaningBag } from '../shared/meaning';

export class MeaningIndex {
  private vecs = new Map<string, number[]>();
  /** Each note's ideas beside its vector (the coverage gate in search: cosine alone never admits a hit). */
  private bags = new Map<string, MeaningBag>();
  /** A long note's further pieces (its first piece is its vector above): search keeps the best piece. */
  private pieces = new Map<string, number[][]>();
  private excluded: string[] = [];

  private isExcluded(path: string): boolean {
    if (!this.excluded.length) return false;
    const p = path.toLowerCase();
    return this.excluded.some((e) => p === e || p.startsWith(`${e}/`));
  }

  setExcluded(list: string[]): void {
    this.excluded = list.map((p) => p.toLowerCase());
    for (const p of [...this.vecs.keys()]) if (this.isExcluded(p)) this.vecs.delete(p);
    for (const p of [...this.bags.keys()]) if (this.isExcluded(p)) this.bags.delete(p);
    for (const p of [...this.pieces.keys()]) if (this.isExcluded(p)) this.pieces.delete(p);
  }

  /** A note's meaning, kept current (its name counts twice, as Related notes weighs words). */
  set(path: string, title: string, content: string): void {
    if (isPrivatePath(path) || this.isExcluded(path)) {
      this.vecs.delete(path);
      this.bags.delete(path);
      this.pieces.delete(path);
      return;
    }
    const bag = meaningWords(`${title} ${title} ${content}`);
    if (!bag.concepts.size && !bag.words.size) {
      this.vecs.delete(path);
      this.bags.delete(path);
      this.pieces.delete(path);
      return;
    }
    this.vecs.set(path, vectorFromMeaning(bag));
    this.bags.set(path, bag);
    // An embedded note edited: its old pieces no longer read true until it is embedded again.
    this.pieces.delete(path);
  }

  /** A note's on-device vector (its first piece) with its further pieces; refused for private and left-out notes. */
  setVector(path: string, vec: readonly number[], pieces: readonly (readonly number[])[] = []): void {
    if (isPrivatePath(path) || this.isExcluded(path)) {
      this.vecs.delete(path);
      this.pieces.delete(path);
      return;
    }
    if (!vec.length) {
      this.vecs.delete(path);
      this.pieces.delete(path);
      return;
    }
    this.vecs.set(path, [...vec]);
    const rest = pieces.filter((p) => p.length === vec.length).map((p) => [...p]);
    if (rest.length) this.pieces.set(path, rest);
    else this.pieces.delete(path);
  }

  /** Whether a note's vector is an on-device embedding (rather than the hashed fallback). */
  isEmbedded(path: string): boolean {
    return (this.vecs.get(path)?.length ?? 0) === EMBED_DIM;
  }

  /** Whether any note still answers from hashed vectors (while the embeddings are being built). */
  hasTermVectors(): boolean {
    for (const vec of this.vecs.values()) if (vec.length !== EMBED_DIM) return true;
    return false;
  }

  delete(path: string): void {
    this.vecs.delete(path);
    this.bags.delete(path);
    this.pieces.delete(path);
  }

  clear(): void {
    this.vecs.clear();
    this.bags.clear();
    this.pieces.clear();
  }

  get size(): number {
    return this.vecs.size;
  }

  /** Every path with meaning kept (for the proof that private and left-out notes never enter). */
  paths(): string[] {
    return [...this.vecs.keys()].sort();
  }

  /** A note's meaning vector for the Related seam (src/shared/related.ts); null when none is kept. */
  vectors(path: string): readonly number[] | null {
    return this.vecs.get(path) ?? null;
  }

  /** A long note's further pieces beside its vector (for the cache that keeps them); empty when none. */
  piecesOf(path: string): readonly (readonly number[])[] {
    return this.pieces.get(path) ?? [];
  }

  /** The notes whose meaning is closest to the query's, closest first, above `min`, never the excluded ones.
   *  Past the cosine, a hit shares ideas with the query above the cover bar (10.0 third round F4): a tiny query
   *  vector normalises away its own weakness, so cosine alone let gibberish through and the empty state never
   *  showed. Only hashed vectors answer here (an embedding never meets a hashed query: the lengths differ). */
  search(query: string, opts: { limit?: number; exclude?: ReadonlySet<string>; min?: number } = {}): { path: string; score: number }[] {
    const bag = meaningWords(query);
    if (!bag.concepts.size && !bag.words.size) return [];
    const qv = vectorFromMeaning(bag);
    const min = opts.min ?? MEANING_SEARCH_MIN;
    const out: { path: string; score: number }[] = [];
    for (const [path, vec] of this.vecs) {
      if (opts.exclude?.has(path) || this.isExcluded(path) || isPrivatePath(path)) continue;
      const score = cosine(qv, vec);
      if (score < min) continue;
      const note = this.bags.get(path);
      if (!note || sharedConcepts(bag, note) < MEANING_COVER_MIN) continue;
      out.push({ path, score });
    }
    return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, opts.limit ?? 5);
  }

  /**
   * The notes closest to a query vector (the on-device model's embedding of the query), closest first. Only vectors
   * in the same space answer (a hashed vector never meets an embedding); a long note scores its best piece.
   */
  searchVector(qv: readonly number[], opts: { limit?: number; exclude?: ReadonlySet<string>; min?: number } = {}): { path: string; score: number }[] {
    if (!qv.length) return [];
    const min = opts.min ?? 0;
    const out: { path: string; score: number }[] = [];
    for (const [path, vec] of this.vecs) {
      if (vec.length !== qv.length || opts.exclude?.has(path) || this.isExcluded(path) || isPrivatePath(path)) continue;
      let score = cosine(qv, vec);
      for (const piece of this.pieces.get(path) ?? []) score = Math.max(score, cosine(qv, piece));
      if (score >= min) out.push({ path, score });
    }
    return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, opts.limit ?? 5);
  }
}
