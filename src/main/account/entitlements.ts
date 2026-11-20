// SPDX-License-Identifier: AGPL-3.0-or-later
// What the licence in force (src/main/edition.ts) entitles this copy to, for the paid cloud parts to ask: Sync's engine
// (src/main/sync, when it lands) asks syncAvailable(); the Supporter badge reads the same features through the account
// view. It works offline (the licence is verified here) and lapses with the licence. Community features never ask.
import { currentEdition, type Edition } from '../edition';

export function licensed(feature: string, o: { edition?: Edition; now?: number } = {}): boolean {
  const l = (o.edition ?? currentEdition()).licence;
  return !!l && l.exp * 1000 > (o.now ?? Date.now()) && l.features.includes(feature);
}

/** Sync (personal Sync, or Teams which includes it). */
export const syncAvailable = (o?: { edition?: Edition; now?: number }) => licensed('sync', o);
export const supporter = (o?: { edition?: Edition; now?: number }) => licensed('supporter', o);
