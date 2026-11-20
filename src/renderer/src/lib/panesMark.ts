// Marks every box above a panes root with data-has-panes (21 Nov 2026), so styles/panes.css can make the fill chain
// from the page's scroller down to the panes with plain selectors. It said `:has(.nv-panes-root)` before, ten rules
// of it, some as `:not(:has(...))` on any element: Chrome checked those again for the whole page each time anything
// was added to it. Measured at 3,530 px, adding 40 rows one at a time to a list: 0.7-2.8 s of style work with those
// rules, 8-30 ms with the mark. It says the same thing (an ancestor of a panes root), set once when the root mounts.

import { useLayoutEffect, type RefObject } from 'react';

/** How many panes roots each marked box sits above (two roots under one page: the mark stays until both go). */
const held = new WeakMap<Element, number>();

/** Mark the ancestors of `target` (an element, or a ref to one) as holding panes, while `on`. An attribute, not a
 *  class: React rewrites a class name it renders, never an attribute it does not know. */
export function usePanesMark(target: RefObject<HTMLElement | null> | HTMLElement | null, on = true): void {
  useLayoutEffect(() => {
    const root = target && 'current' in target ? target.current : target;
    if (!root || !on) return;
    const up: Element[] = [];
    for (let el = root.parentElement; el; el = el.parentElement) {
      held.set(el, (held.get(el) ?? 0) + 1);
      el.setAttribute('data-has-panes', '');
      up.push(el);
    }
    return () => {
      for (const el of up) {
        const n = (held.get(el) ?? 1) - 1;
        if (n > 0) held.set(el, n);
        else {
          held.delete(el);
          el.removeAttribute('data-has-panes');
        }
      }
    };
  }, [target, on]);
}
