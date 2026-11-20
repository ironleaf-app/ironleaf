// Where More's second group folds to fit the window (pure: Places.tsx and the test read it). The eight stay on
// top; the second group's four groups (Pages, Make and open, Find, Packs and kinds) fold biggest-first into a
// submenu row each until the menu fits the room (9 Nov 2026 — the rows return, but the menu never scrolls at
// 709px high; 9 Nov 2026, the last row cut off at 1920x1117 — the pad missed the menu's 1px border top and
// bottom, so the estimate sat 2px short and the real menu is measured too). Past that, the bar's folded rows
// fold, then the pins — the person's own last (break 10.1.8: five pins and eight packs scrolled with two rows
// past the window). Heights match styles/kit.css (.menu's rows, headings, separators, padding and border); the
// caller passes the room (window height less the edge and the buttons band).
export const MORE_ROW_H = 40;
export const MORE_HEADING_H = 32;
export const MORE_SEP_H = 9;
export const MORE_PAD = 14;

export interface MoreGroup {
  id: string;
  /** Its visible rows (heads not counted: folding swaps a head plus rows for one submenu row). */
  rows: number;
}

export interface MoreMenu {
  pinned: number;
  folded: number;
  eight: number;
  groups: MoreGroup[];
}

/** The menu's height with the named groups folded into submenu rows ('bar' and 'pinned' fold
 *  their whole section — heading, rows and separator — behind one submenu row). */
export function moreHeight(o: MoreMenu & { foldedIds: readonly string[] }): number {
  let h = MORE_PAD;
  if (o.folded > 0) h += o.foldedIds.includes('bar') ? MORE_ROW_H : MORE_HEADING_H + o.folded * MORE_ROW_H + MORE_SEP_H;
  if (o.pinned > 0) h += o.foldedIds.includes('pinned') ? MORE_ROW_H : MORE_HEADING_H + o.pinned * MORE_ROW_H + MORE_SEP_H;
  h += o.eight * MORE_ROW_H;
  h += MORE_SEP_H;
  for (const g of o.groups) {
    if (o.foldedIds.includes(g.id)) h += MORE_ROW_H;
    else h += MORE_HEADING_H + g.rows * MORE_ROW_H;
  }
  return h;
}

/** The next group to fold, biggest savings first (the measured loop folds one at a time). */
export function nextMoreFold(groups: MoreGroup[], foldedIds: readonly string[]): string | null {
  const savings = (g: MoreGroup): number => MORE_HEADING_H + (g.rows - 1) * MORE_ROW_H;
  const rest = groups.filter((g) => !foldedIds.includes(g.id)).sort((a, b) => savings(b) - savings(a) || groups.indexOf(a) - groups.indexOf(b));
  return rest.length ? rest[0].id : null;
}

/**
 * The groups to fold, biggest savings first, until the menu fits the room (none when it already fits).
 * The four groups go first; past them the bar's folded rows fold, then the pins — the person's own
 * stay out while anything else can give the room.
 */
export function moreFoldToFit(o: MoreMenu & { available: number }): string[] {
  const folded: string[] = [];
  const fits = (): boolean => moreHeight({ ...o, foldedIds: folded }) <= o.available;
  for (;;) {
    if (fits()) return folded;
    const next = nextMoreFold(o.groups, folded);
    if (!next) break;
    folded.push(next);
  }
  if (!fits() && o.folded > 0) folded.push('bar');
  if (!fits() && o.pinned > 0) folded.push('pinned');
  // A last resort counts only when it makes the menu fit: at a window shorter than the eight,
  // burying rows behind submenus cannot stop the scroll, so the rows stay out instead.
  if (!fits()) return folded.filter((id) => id !== 'bar' && id !== 'pinned');
  return folded;
}
