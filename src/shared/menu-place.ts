// Where a menu opens for its anchor in the window (pure: Menu.tsx and the test read it). Below its
// anchor when it fits there, else above it, else shifted up so the whole menu still shows; only a list
// longer than the window caps to the window and scrolls within (3 Nov 2026 sweep D: the More and Packs
// menus ran off the bottom, "Other kinds" and "Choose packs…" cut off). Always inside the window, and
// never up under the window buttons (8.6.1): minTop is their band, read by the caller.
export interface MenuAnchor {
  left: number;
  top: number;
  bottom: number;
}
export interface MenuSize {
  width: number;
  height: number;
}
export interface MenuViewport {
  width: number;
  height: number;
}
export function menuPlace(anchor: MenuAnchor, size: MenuSize, viewport: MenuViewport, minTop: number): { left: number; top: number; maxHeight?: number } {
  const left = Math.max(6, Math.min(anchor.left, viewport.width - size.width - 6));
  const below = anchor.bottom + 4;
  const roomBelow = viewport.height - 8 - below;
  const roomAbove = anchor.top - 4 - minTop;
  if (size.height <= roomBelow) return { left, top: below };
  if (size.height <= roomAbove) return { left, top: anchor.top - 4 - size.height };
  // Shorter than the window but longer than either side: the whole menu still shows, in the window.
  if (size.height <= viewport.height - 8 - minTop) return { left, top: viewport.height - 8 - size.height };
  // Longer than the window: the window's full height, scrolled within — never a short box that cuts rows.
  return { left, top: minTop, maxHeight: viewport.height - 8 - minTop };
}
