// SPDX-License-Identifier: AGPL-3.0-or-later
// The PDF reader's pages are drawn one at a time (21 Nov 2026, 2.0.9). PDF.js draws a page on the window's own thread,
// and on a wide screen a page at Fit width is ten million pixels or more: three drawn at once (the page in view and
// its neighbours) held the window long enough for scrolling and zooming to stutter. Now each page asks for its turn,
// the page in view goes first, and a request that is no longer wanted (the zoom moved on, the page scrolled away)
// is dropped before it starts or cancelled while it runs.

export interface DrawTicket {
  /** Not wanted any more: dropped if still waiting, cancelled if drawing. */
  cancel(): void;
}

interface Job {
  priority: number;
  order: number;
  run(): Promise<void>;
  stop?: () => void;
  gone: boolean;
}

const waiting: Job[] = [];
let busy = false;
let order = 0;

/** Asks for a turn to draw. `priority` 0 is a page in view, 1 a page beside it; earlier asks go first within each.
 *  `run` does the drawing and resolves when it is done; `stop` cancels a drawing under way. */
export function askToDraw(priority: number, run: () => Promise<void>, stop?: () => void): DrawTicket {
  const job: Job = { priority, order: order++, run, stop, gone: false };
  waiting.push(job);
  void next();
  return {
    cancel() {
      if (job.gone) return;
      job.gone = true;
      const i = waiting.indexOf(job);
      if (i >= 0) waiting.splice(i, 1);
      else job.stop?.();
    },
  };
}

async function next(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    while (waiting.length) {
      waiting.sort((a, b) => a.priority - b.priority || a.order - b.order);
      const job = waiting.shift()!;
      if (job.gone) continue;
      try {
        await job.run();
      } catch {
        // A cancelled or failed drawing: the page shows what it had, and asks again when it is wanted.
      }
      job.gone = true;
      // A breath between pages, so a scroll or a key press in between is answered at once.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    busy = false;
  }
}
