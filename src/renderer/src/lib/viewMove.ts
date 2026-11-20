// A reorder that glides instead of popping (5 Nov 2026 feel-motion: tab and list reorders landed in one frame): the
// update runs inside a same-document View Transition, so rows with a stable view-transition-name animate to their new
// places. Without the API, or without movement, the update lands at once as before.

import { flushSync } from 'react-dom';

export function viewMove(update: () => void): void {
  const start = (document as Document & { startViewTransition?: (cb: () => void) => void }).startViewTransition;
  if (!start || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    update();
    return;
  }
  start.call(document, () => flushSync(update));
}
