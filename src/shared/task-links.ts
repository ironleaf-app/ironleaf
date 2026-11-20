// Typed links for tasks and questions (t238 vault rebuild step 1, 12 Nov 2026; critic 2 F03, F09: the links a
// project runs on were missing or free text). A task names its project through its note's
// `project` property and its person through [[links]] in its words (the owner's tail included); a question names
// its people through [[links]] in its asked-by and for tails, and its project through its note. Every one resolves
// through the relations' own reading (src/shared/relation-links.ts): by path first, so a rename never breaks them.
// New links are always [[links]]; plain names still resolve, by title, for old notes. Pure.

import { linkWords } from './markdown';
import { bracketTargets, resolveRelation, type LinkedNote } from './relation-links';

/** Whether a value carries a typed [[link]] (one a rename cannot break when it names a path). */
export const isTypedLink = (value: string): boolean => /\[\[[^[\]\n]+\]\]/.test(String(value ?? ''));

/** A name as people see it: a [[link]] reads as its name, plain words as written. */
export const displayName = (value: string): string => linkWords(String(value ?? '')).replace(/\s+/g, ' ').trim();

/** A person's note for a name: typed [[links]] first (by path, rename-proof), else the name read as a title for
 *  old notes. Null: nobody by that name. */
export function personPathOf(name: string, notes: readonly LinkedNote[]): string | null {
  const raw = String(name ?? '').trim();
  if (!raw) return null;
  const typed = bracketTargets(raw);
  if (typed.length) {
    const hit = resolveRelation(typed, notes)[0];
    if (hit) return hit;
  }
  return resolveRelation([raw], notes)[0] ?? null;
}

/** A question's people as typed links: asked-by and owned-by to their notes (null: not named, or nobody). */
export function questionPeople(q: { askedBy?: string; owner?: string }, notes: readonly LinkedNote[]): { askedBy: string | null; owner: string | null } {
  return { askedBy: q.askedBy?.trim() ? personPathOf(q.askedBy, notes) : null, owner: q.owner?.trim() ? personPathOf(q.owner, notes) : null };
}

/** A task owner's person note (its `— [[Name]]` tail, or its plain name for old notes). */
export const ownerPathOf = (owner: string, notes: readonly LinkedNote[]): string | null => (String(owner ?? '').trim() ? personPathOf(owner, notes) : null);
