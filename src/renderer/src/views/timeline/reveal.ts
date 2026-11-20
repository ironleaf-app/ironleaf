// A project opened at one of its things (from the timeline: a key date, a next step, a decision, an update, its start or
// due date): the page scrolls to it and marks it for a moment.

import type { Mark } from '../../../../shared/timeline';

const pending = new Map<string, string>();

/** Which line of the page a mark is ("dates:2", "next:0", "due"). */
export function itemOf(m: Pick<Mark, 'kind' | 'index'>): string {
  if (m.kind === 'start' || m.kind === 'due') return m.kind;
  const list = m.kind === 'date' ? 'dates' : m.kind === 'next' ? 'next' : m.kind === 'decision' ? 'decisions' : 'updates';
  return `${list}:${m.index ?? 0}`;
}

/** The project page, once it shows, goes to this line. */
export function revealItem(path: string, item: string): void {
  pending.set(path, item);
}

export function takeItem(path: string): string | undefined {
  const item = pending.get(path);
  pending.delete(path);
  return item;
}

/** Scrolls a project's page to a line and marks it; false when the line isn't on the page. The due and start
 *  dates live in the Facts panel (data-item marks, opened first by the page). A step of someone else's reads in
 *  Waiting on others (a data-action row), not Your next: the mark matches that row, so opening it lands on the
 *  row and never silently on its card (vault rebuild step 2). */
export function showItem(page: HTMLElement, item: string): boolean {
  // The row on show (t255, 13 Nov 2026: the Overview reads the same rows as their tabs, so the item
  // marks twice — the open tab's row is the one with a box on screen; a hidden twin never steals it).
  const pick = (sel: string): HTMLElement | null => {
    const cands = [...page.querySelectorAll<HTMLElement>(sel)];
    return cands.find((el) => el.getClientRects().length > 0) ?? cands[0] ?? null;
  };
  const target =
    item === 'due' || item === 'start'
      ? pick(`[data-item="${CSS.escape(item)}"]`)
      : (pick(`[data-item="${CSS.escape(item)}"]`) ?? pick(`[data-action="${CSS.escape(item)}"]`) ?? pick(`[data-item-card="${CSS.escape(item.split(':')[0])}"]`));
  if (!target) return false;
  // A ticked step is in the folded "Done" list: open it.
  const fold = target.closest('details');
  if (fold && !fold.open) fold.open = true;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.remove('tl-revealed');
  void target.offsetWidth;
  target.classList.add('tl-revealed');
  window.setTimeout(() => target.classList.remove('tl-revealed'), 2200);
  // The opened row is the current one (t248, item 9): marked for assistive tech, so opening it answers
  // even when it was already in view. One current row per page; opening another moves it.
  page.querySelectorAll('[data-revealed="true"]').forEach((el) => {
    if (el !== target) {
      el.removeAttribute('data-revealed');
      el.removeAttribute('aria-current');
    }
  });
  target.setAttribute('data-revealed', 'true');
  target.setAttribute('aria-current', 'true');
  return true;
}

/** showItem, waiting a few frames for the line to be drawn (the Facts panel was just opened for it). */
export function showItemSoon(page: HTMLElement, item: string, tries = 12): Promise<boolean> {
  return new Promise((resolve) => {
    const tick = (n: number) => {
      if (showItem(page, item)) return resolve(true);
      if (n <= 0) return resolve(false);
      requestAnimationFrame(() => tick(n - 1));
    };
    tick(tries);
  });
}
