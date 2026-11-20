// Where the bell's panel opens for the bell's box in the window (pure: the renderer and the test read it).
// Under the bell, flipping above it when the room below is short and the room above is longer (3 Nov 2026: it
// always opened above the bell, from when the bell sat at the foot; in the header that put the whole panel off
// the top of the window). Always inside the window.
export function bellPanelPlace(bell: { left: number; top: number; bottom: number }, viewport: { width: number; height: number }): { left: number; top?: number; bottom?: number } {
  const left = Math.max(8, Math.min(bell.left, viewport.width - 368));
  const below = viewport.height - (bell.bottom + 8) - 8;
  if (below >= 200 || below >= bell.top - 8) return { left, top: bell.bottom + 8 };
  return { left, bottom: viewport.height - bell.top + 8 };
}
