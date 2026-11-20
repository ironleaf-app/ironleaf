// The words a person reads or hears, counted once (3 Nov 2026, fourth-round G5-G7: "Saved 1 lines", "Remove all 1",
// "1 captures ticked" — three bare plurals in three rooms). One helper for every count, so singular and plural can
// never drift apart again: "1 entry" / "2 entries", never "1 entries". Pure: the window and the shared words use it
// as it is. Plain Australian English, no em dashes.

/** A count with its noun: "1 item", "2 items", "1 entry", "2 entries". The one plural rule everywhere. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A filter or tab count shows only past zero (10.0 fifth round H1, 3 Nov 2026: Projects hid its zeros while People
 *  and the note foot showed theirs — one calmer rule everywhere now, like a badge). A tab with nothing to count
 *  (null) or a missing count stays off too. */
export const showCount = (n: number | null | undefined): boolean => typeof n === 'number' && n > 0;

/** Names joined as a person lists them (8 Nov 2026, calm list: folded rows name every target): "Fileshare",
 *  "Fileshare and Mediabox", "Fileshare, Mediabox, Plover and Juniper". Empty stays empty. */
export function joinNames(names: readonly string[]): string {
  const list = names.filter((n) => n && n.trim());
  if (list.length <= 1) return list.join('');
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
