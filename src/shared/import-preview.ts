// Import preview counts (10.0 item 16, 2 Nov 2026): before anything is written, how many
// are new, how many would update, how many are already here. CSV and Markdown both
// ask update-vs-both after comparing, never blind, and identical notes are left in
// both choices. Pure: the window reads the colliding notes, this counts them.

import { sameText } from './vault-merge';

export interface PreviewCounts {
  /** No note of that name here. */
  newCount: number;
  /** A note of that name here with other words. */
  updateCount: number;
  /** A note of that name here with the same words. */
  identicalCount: number;
}

/**
 * Each incoming note against the notes here (keyed by lower-cased name, null when
 * a note here could not be read and so counts as to update, never as identical).
 */
export function previewByName(
  existing: Map<string, string | null>,
  incoming: { name: string; text: string }[],
): PreviewCounts {
  let newCount = 0;
  let updateCount = 0;
  let identicalCount = 0;
  for (const n of incoming) {
    const at = existing.get(n.name.toLowerCase());
    if (at === undefined) {
      newCount++;
      continue;
    }
    if (at !== null && sameText(at, n.text)) identicalCount++;
    else updateCount++;
  }
  return { newCount, updateCount, identicalCount };
}

/** Whether there is a choice to put to the person (something would change). */
export function needsChoice(c: PreviewCounts): boolean {
  return c.updateCount > 0;
}

/**
 * The counts in plain words for the dialog (12 new, 3 to update, 40 already here).
 * Zeros are left out, except all zero reads none. No em dashes, never a bare number.
 */
export function previewWords(c: PreviewCounts): string {
  const parts: string[] = [];
  if (c.newCount) parts.push(`${c.newCount.toLocaleString('en-AU')} new`);
  if (c.updateCount) parts.push(`${c.updateCount.toLocaleString('en-AU')} to update`);
  if (c.identicalCount) parts.push(`${c.identicalCount.toLocaleString('en-AU')} already here`);
  return parts.length ? parts.join(', ') : 'nothing new';
}
