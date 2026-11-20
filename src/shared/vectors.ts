// Two vectors' likeness (moved verbatim from src/shared/meaning.ts, p12-task-writes round 2, 4 Nov 2026: the write
// check in src/shared/task-write.ts is built into the former host app's plugins by tools/build-embedded.mjs, and
// importing it from meaning dragged that module's word tables into the small bundle — one small module, meaning
// re-exports it so its readers move nowhere).

/** Two vectors' likeness, 0 to 1 (0 when they cannot be compared). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? Math.max(0, dot / Math.sqrt(na * nb)) : 0;
}
