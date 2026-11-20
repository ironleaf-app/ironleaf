// A reply streams in smoothly (5 Nov 2026 feel-motion: Vault's answer grew a line at a time on a bursty provider — the
// exact lurch the former host app fixed on 12 Oct). The mechanism mirrors the former host app's
// (recovery-build/smooth-stream.cjs): each frame shows about a tenth of what is still to come (at least two
// characters), so a burst eases in within a fraction of a second. Only while the reply streams: a finished reply shows
// whole at once; text that is not a continuation (a new reply) starts over. smoothStep is the pure step, tested on its
// own; useSmoothText is the hook.

import { useEffect, useReducer, useRef } from 'react';

/** How much of the goal shows after one frame, given how much shows now. */
export function smoothStep(shown: number, goal: number): number {
  const left = goal - shown;
  if (left <= 0) return shown;
  return shown + (left > 2400 ? left - 400 : Math.max(2, Math.ceil(left / 10)));
}

interface SmoothState {
  shown: string;
  frame: number;
  target: string;
  active: boolean;
}

export function useSmoothText(target: string, active: boolean): string {
  const kept = useRef<SmoothState | null>(null);
  if (kept.current === null) kept.current = { shown: target, frame: 0, target, active };
  const state = kept.current;
  state.target = target;
  state.active = active;
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const tick = () => {
      state.frame = 0;
      const goal = state.target;
      if (!state.active || !goal.startsWith(state.shown)) {
        if (state.shown !== goal) {
          state.shown = goal;
          redraw();
        }
        return;
      }
      if (state.shown.length >= goal.length) return;
      state.shown = goal.slice(0, smoothStep(state.shown.length, goal.length));
      redraw();
      if (state.shown.length < goal.length) state.frame = requestAnimationFrame(tick);
    };
    if (!state.frame && state.shown !== state.target) state.frame = requestAnimationFrame(tick);
  });
  useEffect(
    () => () => {
      if (state.frame) cancelAnimationFrame(state.frame);
    },
    [state],
  );
  return active ? state.shown : target;
}
