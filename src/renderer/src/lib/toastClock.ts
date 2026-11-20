// How long a message at the foot of the window (a toast) stays, kept apart from React so it can't be reset by a redraw
// and can be tested on its own (tests/toast-clock.test.mjs). A message goes by itself after its time (3–9 s, as the
// caller asks); while the pointer rests on it, it waits (never longer than 20 s from when it showed); leaving it gives
// it 2.5 s more. Its end is a time, not just a timer: a late timer (a busy or hidden window) or the next click or key
// after that time ends it all the same. A window hidden when its time ran out shows it for 3 s more when seen again.

export interface ToastClockDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  hidden(): boolean;
  onEnd(): void;
}

export const TOAST_SHORTEST = 3000;
export const TOAST_LONGEST = 9000;
export const TOAST_HELD_LONGEST = 20000;
export const TOAST_AFTER_HOVER = 2500;
export const TOAST_AFTER_AWAY = 3000;

export function toastClock(d: ToastClockDeps) {
  let active = false;
  let held = false;
  let missed = false;
  let shownAt = 0;
  let until = 0;
  let timer: unknown = null;
  const arm = (ms: number) => {
    if (timer !== null) d.clearTimer(timer);
    timer = d.setTimer(check, Math.max(0, ms));
  };
  const end = () => {
    if (timer !== null) d.clearTimer(timer);
    timer = null;
    if (!active) return;
    active = held = missed = false;
    d.onEnd();
  };
  function check() {
    timer = null;
    if (!active) return;
    const t = d.now();
    if (held) {
      if (t - shownAt >= TOAST_HELD_LONGEST) return end();
      return arm(shownAt + TOAST_HELD_LONGEST - t);
    }
    if (t < until) return arm(until - t);
    // Its time ran out while the window was out of sight: it waits to be seen.
    if (d.hidden()) {
      missed = true;
      return;
    }
    end();
  }
  return {
    /** A new message: its time starts now (an earlier one's is forgotten). */
    show(ms = 5000) {
      active = true;
      held = missed = false;
      shownAt = d.now();
      until = shownAt + Math.min(TOAST_LONGEST, Math.max(TOAST_SHORTEST, ms));
      arm(until - shownAt);
    },
    /** The pointer rests on it (true) or leaves it (false). */
    hold(on: boolean) {
      if (!active || held === on) return;
      held = on;
      const t = d.now();
      if (on) arm(shownAt + TOAST_HELD_LONGEST - t);
      else {
        until = Math.max(until, t + TOAST_AFTER_HOVER);
        arm(until - t);
      }
    },
    /** The window is seen again. */
    seen() {
      if (!active || !missed) return;
      missed = false;
      until = d.now() + TOAST_AFTER_AWAY;
      arm(TOAST_AFTER_AWAY);
    },
    /** A click or a key anywhere: a message past its time goes now (its timer may be running late). */
    poke() {
      if (active && !held && !missed && d.now() >= until + 250) end();
    },
    /** Closed by hand (its × or its action). */
    close: end,
    get active() {
      return active;
    },
  };
}
