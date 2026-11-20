// Where a page opens (v9, 6 Nov 2026). One rule for every page in the Vault, kept here and applied by the
// tab body (views/Workspace.tsx PageTop): a fresh open starts at the top with the title in view, every time;
// Back and returning to an open tab restore where the person was; a link to a named section goes there (the
// views' own reveals, after this). Positions are this session's only: a page kept is a page returned to, and
// a restart opens at the top.

/** A tab's place, as one key (the tab's id keeps two tabs on the same page apart; the page's own
 *  tab keeps each tab's scroll apart, t255, 13 Nov 2026: each tab keeps its own scroll). */
export const placeKey = (tabId: string, type: string, path?: string, section?: string) => `${tabId}\n${type}\n${path ?? ''}\n${section ?? ''}`;

const tops = new Map<string, number>();
const armed = new Set<string>();

/** Remember where a place is (called as the person scrolls, so Back and tab switches find it). */
export function noteScroll(key: string, top: number): void {
  if (!Number.isFinite(top) || top < 0) return;
  // Only the most recent places are kept (a long session stays small).
  if (!tops.has(key) && tops.size > 400) tops.delete(tops.keys().next().value!);
  tops.set(key, Math.round(top));
}

/** Where a place was, if it was left scrolled. */
export function readScroll(key: string): number | undefined {
  return tops.get(key);
}

/** A place lands fresh in its tab (t239): its kept position from an older visit is forgotten, so Back
 *  returns to this visit, never a stale scroll from the last time the tab showed it. */
export function forgetScroll(key: string): void {
  tops.delete(key);
}

/** The next mount in this tab restores (Back, Forward, a tab brought forward). */
export function armRestore(tabId: string): void {
  armed.add(tabId);
}

/** A fresh place lands in this tab: the next mount starts at the top. */
export function disarmRestore(tabId: string): void {
  armed.delete(tabId);
}

/** True once when this tab should restore (Back, Forward, a tab brought forward). */
export function takeRestore(tabId: string): boolean {
  const v = armed.has(tabId);
  armed.delete(tabId);
  return v;
}
