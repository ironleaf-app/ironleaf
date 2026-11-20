// The header contract (Round 6, 4 Nov 2026, the reviewer: with max-content sides the bar sat 97-233px left of
// centre, and off-centre was the complaint this morning — centring wins over keeping every page button
// visible, they have ⋯): the topbar is a 3-column grid with two always-equal sides (kit.css minmax(0,1fr)), so
// the middle is exactly centred over the whole header. A side whose content is wider than its own cell is
// crowded: on the right, page buttons yield into the ⋯ menu (the same menu, same words, same actions), one by
// one from the least used, the page's most used last (Share on notes and projects, New project on Projects);
// on the left the crumb clips without dots by itself (text-overflow: clip, full text in its title; t207 pass
// 2) and ← → + never hide. Only when a side still cannot fit with everything yielded and the crumb at its
// minimum does that side fall back to a max-content column (the least move, never an overlap); a window too
// narrow for even the bare sides squeezes the bar to its 40px search button. This module only ever hides
// buttons and marks the fallback columns now, never moves or sizes the bar. Measured in the real rectangles,
// on every render and resize (ViewHeader.tsx runs it). A button opts in with data-overflow="its-key" and
// data-overflow-order="1" (1 yields first: the least used); its menu row comes from the page's defs (null when
// the menu already reaches it in its own words, with the reason beside it).
import type { MenuItem } from '../components/Menu';

/** The breath the grid keeps between the search and either side (kit.css column-gap: nothing can come closer). */
export const HEADER_OVERFLOW_GAP = 12;

/** The bar's floor: the grid's middle track never goes under it (kit.css minmax) while buttons can yield. */
export const HEADER_SEARCH_FLOOR = 360;

/** Which overflow keys each tab's bar has hidden (split panes lay out independently). */
const hiddenByTab = new Map<string, string[]>();

/** A settled bar's fingerprint, so a render that moved nothing lays out nothing (t102, 9 Nov 2026):
 *  everything in it reads free (counts, classes, text) — never a width, rect or style, each of which forces
 *  a whole-page reflow when the page just changed (every keystroke). Width-only changes (window resize, fonts,
 *  the bar's own box) still relayout through ViewHeader's resize listener, ResizeObserver and fonts.ready. */
const settledBars = new WeakMap<HTMLElement, { fp: string; hidden: string[] }>();

/** A settled bar's laid-out state, kept by what the bar showed, which pane it sits in and how wide the
 *  window is (t146, 9 Nov 2026): every page switch measured its bar fresh (each page owns its bar, so the
 *  settled check above never spans a switch). The same bar returning in the same place — the same page opened
 *  again — lays out from the kept state with writes only, never a measure. The fingerprint covers what the bar
 *  shows; the pane and the window width (both read free, never a rect) cover the cells it shows it in, so a
 *  resize-then-open never wears another width's state and two panes never share one. Fonts still force a fresh
 *  layout, which clears this. Twelve bars at most. */
interface SettledPrint {
  hidden: string[];
  roomyL: boolean;
  roomyR: boolean;
  squeezed: boolean;
  fb: boolean;
  itemHidden: boolean[];
}
const settledPrints = new Map<string, SettledPrint>();

/** The one fingerprint: what the bar shows and carries, nothing that measures it. */
function barFingerprint(
  topbar: HTMLElement,
  leftCell: HTMLElement | null,
  rightCell: HTMLElement | null,
  items: HTMLElement[],
  fallbacks: HTMLElement[],
  hiddenJoin: string,
): string {
  // No tab: which tab a bar sits on never moves a button (t146) — the same bar in another tab lays out the
  // same, so kept layouts span tabs (each tab still records its own hidden keys above).
  return [
    leftCell?.children.length ?? -1, rightCell?.children.length ?? -1, items.length, fallbacks.length,
    leftCell?.textContent ?? '', rightCell?.textContent ?? '',
    topbar.className, leftCell?.className ?? '', rightCell?.className ?? '',
    items.map((el) => `${el.className}/${el.dataset.overflowOrder ?? ''}`).join(','),
    fallbacks.map((el) => (el.classList.contains('is-shown') ? '1' : '0')).join(''),
    hiddenJoin,
  ].join('\n');
}

/** Which of a tab's page buttons are hidden in its ⋯ menu right now (for the menu to carry). */
export function headerOverflowHidden(tabId: string): string[] {
  return hiddenByTab.get(tabId) ?? [];
}

/** Forget a tab's hidden keys (its bar unmounted). */
export function clearHeaderOverflow(tabId: string): void {
  hiddenByTab.delete(tabId);
}

/** A hidden key's menu row (null: the menu already reaches it — the reason sits beside the null). */
export type OverflowDefs = Record<string, (() => MenuItem | MenuItem[]) | null>;

/** The hidden keys' menu rows, in the buttons' own left-to-right order. */
export function overflowMenuItems(hidden: string[], defs: OverflowDefs): MenuItem[] {
  const rows: MenuItem[] = [];
  for (const key of hidden) {
    const make = defs[key];
    if (!make) continue;
    const row = make();
    if (Array.isArray(row)) rows.push(...row);
    else rows.push(row);
  }
  return rows;
}

/** A side is crowded when its content is wider than its own cell: any child's rectangle past the cell's
content box (the window-buttons gap is padding, inside the cell, so it only pushes the buttons left; a pixel
of breath for fractional edges). The right side's children never shrink (kit.css flex:none: nowrap buttons
and short spans), so they overflow honestly instead of crushing; the crumb shortens with … by itself. */
function cellCrowded(cell: HTMLElement | null, skip?: ReadonlySet<HTMLElement>): boolean {
  if (!cell) return false;
  const c = cell.getBoundingClientRect();
  const cs = getComputedStyle(cell);
  const contentL = c.left + (parseFloat(cs.paddingLeft) || 0);
  const contentR = c.right - (parseFloat(cs.paddingRight) || 0);
  for (const kid of cell.children) {
    if (!(kid instanceof HTMLElement)) continue;
    // Known-hidden buttons skip the style read (t102, 9 Nov 2026): the hide loop below used to ask every
    // button whether it shows on every round, each read with the writes still pending.
    if (skip?.has(kid) || getComputedStyle(kid).display === 'none') continue;
    const b = kid.getBoundingClientRect();
    if (b.width <= 0) continue;
    if (b.left < contentL - 1 || b.right > contentR + 1) return true;
  }
  return false;
}

/** Crowded means a side's content is wider than its own cell (measured on the grid, each side against its
cell). The bar itself is never the crowded one: the grid's equal sides centre it by construction. */
export function headerOverflowCrowded(topbar: HTMLElement): boolean {
  const left = topbar.querySelector('.topbar-left');
  const right = topbar.querySelector('.right');
  return cellCrowded(left instanceof HTMLElement ? left : null) || cellCrowded(right instanceof HTMLElement ? right : null);
}

/** Lay a top bar out: the right side yields least-used-first while crowded, then a still-crowded side falls
back to its max-content column, then a window too narrow for even the bare sides squeezes to the 40px button.
Returns the hidden keys, left to right; the tab's map and the bar's data-overflow carry them for menus. */
export function layoutHeaderOverflow(topbar: HTMLElement, tabId?: string, force = false): string[] {
  const left = topbar.querySelector('.topbar-left');
  const right = topbar.querySelector('.right');
  const leftCell = left instanceof HTMLElement ? left : null;
  const rightCell = right instanceof HTMLElement ? right : null;
  const fallbacks = [...topbar.querySelectorAll<HTMLElement>('[data-overflow-fallback]')];
  const items = right ? [...right.querySelectorAll<HTMLElement>('[data-overflow]')] : [];
  // A bar that settled and has not moved lays out nothing (t102, 9 Nov 2026): this runs after every render,
  // and the loop below used to unhide everything and re-hide it one by one, measuring between every two
  // writes. The same DOM with the same classes and words in the same widths is the same bar — the same menu
  // too. The widths are left out on purpose: reading one forces the whole page to lay out. Width-only changes
  // (window resize, the bar's own box, fonts) force a fresh layout through ViewHeader, skipping this check.
  const nowHidden = items.filter((el) => el.classList.contains('is-overflow-hidden')).map((el) => el.dataset.overflow ?? '');
  const fp = barFingerprint(topbar, leftCell, rightCell, items, fallbacks, nowHidden.join(' '));
  const last = settledBars.get(topbar);
  if (!force && last && last.fp === fp) return [...last.hidden];
  if (force) settledPrints.clear();
  // The pane and the window's width price the cells (t146): free to read, never a rect, so a kept state never
  // answers for another width even when a resize's forced relayout has not landed yet (resize, then open at
  // once), and two panes side by side never share one.
  const pane = topbar.closest('[data-group]')?.getAttribute('data-group') ?? '';
  const printKey = `${pane}\n${typeof window === 'undefined' ? 0 : window.innerWidth}\n${fp}`;
  if (!force) {
    // The same bar back again (t146): laid out from the kept state — writes only, never a measure.
    const kept = settledPrints.get(printKey);
    if (kept && kept.itemHidden.length === items.length) {
      items.forEach((el, i) => el.classList.toggle('is-overflow-hidden', kept.itemHidden[i]));
      for (const el of fallbacks) el.classList.toggle('is-shown', kept.fb);
      topbar.classList.toggle('is-left-roomy', kept.roomyL);
      topbar.classList.toggle('is-right-roomy', kept.roomyR);
      topbar.classList.toggle('is-squeezed', kept.squeezed);
      if (kept.hidden.length > 0) topbar.dataset.overflow = kept.hidden.join(' ');
      else delete topbar.dataset.overflow;
      if (tabId !== undefined) hiddenByTab.set(tabId, kept.hidden);
      settledBars.set(topbar, { fp: barFingerprint(topbar, leftCell, rightCell, items, fallbacks, kept.hidden.join(' ')), hidden: kept.hidden });
      return [...kept.hidden];
    }
  }
  const keepPrint = (print: SettledPrint) => {
    if (settledPrints.size > 12) settledPrints.clear();
    settledPrints.set(printKey, print);
  };
  // A roomy bar with nothing hidden stays as it is: measured once, never touched — the same bar, the same menu.
  const settled =
    !topbar.classList.contains('is-squeezed') &&
    !topbar.classList.contains('is-left-roomy') &&
    !topbar.classList.contains('is-right-roomy') &&
    !fallbacks.some((el) => el.classList.contains('is-shown')) &&
    nowHidden.length === 0;
  if (settled && !cellCrowded(rightCell) && !cellCrowded(leftCell) && !(topbar.scrollWidth > topbar.clientWidth + 1)) {
    if (tabId !== undefined && (hiddenByTab.get(tabId)?.length ?? 0) > 0) hiddenByTab.set(tabId, []);
    if (topbar.dataset.overflow !== undefined) delete topbar.dataset.overflow;
    settledBars.set(topbar, { fp, hidden: [] });
    keepPrint({ hidden: [], roomyL: false, roomyR: false, squeezed: false, fb: false, itemHidden: items.map(() => false) });
    return [];
  }
  for (const el of items) el.classList.remove('is-overflow-hidden');
  for (const el of fallbacks) el.classList.remove('is-shown');
  topbar.classList.remove('is-squeezed', 'is-left-roomy', 'is-right-roomy');
  const hidden: string[] = [];
  // Lowest order yields first (Array's sort is stable, so DOM order breaks ties).
  const order = [...items].sort((a, b) => (Number(a.dataset.overflowOrder ?? 0) || 0) - (Number(b.dataset.overflowOrder ?? 0) || 0));
  const visible = new Set(items);
  const gone = new Set<HTMLElement>();
  const yieldWhileCrowded = () => {
    for (;;) {
      if (!cellCrowded(rightCell, gone)) break;
      const next = order.find((el) => visible.has(el));
      if (!next) break;
      // The fallback ⋯ takes room itself, so it shows with the first hide, before measuring further.
      if (visible.size === items.length) for (const el of fallbacks) el.classList.add('is-shown');
      visible.delete(next);
      gone.add(next);
      next.classList.add('is-overflow-hidden');
    }
  };
  // The right side yields first (least used first, the most used last); only with everything yielded does
  // its column fall back to max-content (the least move: the grid shifts the middle by half the difference).
  yieldWhileCrowded();
  if (cellCrowded(rightCell)) topbar.classList.add('is-right-roomy');
  // The left side shortens its crumb by itself; only the way back not fitting falls back (← → + never hide).
  if (cellCrowded(leftCell)) {
    topbar.classList.add('is-left-roomy');
    // The left fallback shrank the right cell: yield what newly crowds it, then fall back if still crowded.
    yieldWhileCrowded();
    if (cellCrowded(rightCell)) topbar.classList.add('is-right-roomy');
  }
  // Nothing hid: the fallback carries nothing, so it never shows.
  if (visible.size === items.length) for (const el of fallbacks) el.classList.remove('is-shown');
  // A window too narrow for even the bare sides: the 40px search button (kit.css .is-squeezed), which sizes
  // every track itself, so the fallbacks go (squeezing only ever happens past both, everything yielded).
  if (topbar.scrollWidth > topbar.clientWidth + 1) {
    topbar.classList.remove('is-left-roomy', 'is-right-roomy');
    topbar.classList.add('is-squeezed');
  }
  for (const el of items) if (!visible.has(el) && el.dataset.overflow) hidden.push(el.dataset.overflow);
  if (hidden.length > 0) topbar.dataset.overflow = hidden.join(' ');
  else delete topbar.dataset.overflow;
  if (tabId !== undefined) hiddenByTab.set(tabId, hidden);
  // The fingerprint is re-read: the loop above hid buttons and set classes, which is the settled bar.
  settledBars.set(topbar, { fp: barFingerprint(topbar, leftCell, rightCell, items, fallbacks, hidden.join(' ')), hidden });
  keepPrint({
    hidden,
    roomyL: topbar.classList.contains('is-left-roomy'),
    roomyR: topbar.classList.contains('is-right-roomy'),
    squeezed: topbar.classList.contains('is-squeezed'),
    fb: fallbacks.some((el) => el.classList.contains('is-shown')),
    itemHidden: items.map((el) => el.classList.contains('is-overflow-hidden')),
  });
  return hidden;
}
