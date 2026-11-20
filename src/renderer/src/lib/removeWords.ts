/** One remove-words helper (9.2 uplift F21): the verb names the destination, so the same removal reads the
 *  same on every page. A row comes off its list, a section comes out of its week, a record goes to the Bin. */

/** The Bin's short name in menus, buttons and readers. */
export const BIN_SHORT = 'the Bin';

/** A record to the Bin: "Delete the trip to the Bin". */
export function deleteToBin(what: string): string {
  return `Delete ${what} to ${BIN_SHORT}`;
}

/** A row off a list: the button. */
export const TAKE_OFF_BUTTON = 'Take off';

/** "Take the filling off". */
export function takeOffAria(what: string): string {
  return `Take ${what} off`;
}

/** "Took the filling off." */
export function takeOffSaid(what: string): string {
  return `Took ${what} off.`;
}

/** A section out of its week: the button. */
export const TAKE_OUT_BUTTON = 'Take out';

/** "Take Marketing out of this week". */
export function takeOutAria(what: string, where: string): string {
  return `Take ${what} out of ${where}`;
}
