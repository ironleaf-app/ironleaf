// The Needs-you lead's keys, so the list below it never repeats it (8.0 polish round 1, SPEC section D):
// an item shown in Needs you starts the module's Coming up (and any second list of the same things) after
// it, and that list hides when everything in it is already in the lead. Pure keys only: each page says how
// its own rows are known (a Needs card's id, its record's path, or its title), and this matches any of them.

import { selectNeeds, type NeedsCard } from '../../../../shared/module-purpose';

/** The cards a module's Needs-you lead shows, in its order (at most 4). */
export function leadCards(cards: readonly NeedsCard[], today: string): NeedsCard[] {
  return selectNeeds(cards, today, 4);
}

/** Every way a lead card is known: its id, the record it came from, and what it says. */
export function leadKeys(cards: readonly NeedsCard[], today: string): Set<string> {
  const keys = new Set<string>();
  for (const c of leadCards(cards, today)) {
    keys.add(c.id);
    if (c.ref) keys.add(c.ref);
    keys.add(c.title);
  }
  return keys;
}

/** The rows of a list below the lead that the lead has not already shown, in the order they were given. */
export function afterLead<T>(rows: readonly T[], keys: ReadonlySet<string>, knownAs: (row: T) => readonly (string | null | undefined)[]): T[] {
  return rows.filter((row) => !knownAs(row).some((k) => !!k && keys.has(k)));
}
