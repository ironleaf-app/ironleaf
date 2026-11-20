// The window buttons' band (8.6.1, 31 Oct 2026): Windows draws minimise / maximise / close over the page's top right
// (the title bar overlay, src/main/app.ts), so the renderer keeps the band they take as CSS variables on the root:
// --wbtn-h (how tall) and --wbtn-w (how wide). Where Electron gives the overlay's own rect
// (navigator.windowControlsOverlay) it is read; otherwise the band is the page's own top band measured under the
// buttons, and the buttons about 138px at 100%, scaled by the interface size (a fixed width in screen pixels is fewer
// CSS pixels as the page zooms in). Every element at the top right reads the variables, so nothing ever sits under the
// buttons at any size; popups placed from code clamp to minPopupTop(). On a Mac the band is nothing (the traffic lights
// are at the left) and the variables are zero.

/** The buttons' width in CSS pixels at 100%: fixed on screen, so divided by the interface size. */
export const BUTTONS_W_100 = 138;

/** The buttons' width at an interface size (1.25 → 111, 0.8 → 173); 138 for anything unreadable. */
export function buttonsWidth(zoom: unknown): number {
  const z = typeof zoom === 'number' && Number.isFinite(zoom) && zoom >= 0.5 && zoom <= 3 ? zoom : 1;
  return Math.ceil(BUTTONS_W_100 / z);
}

interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The overlay's own rect where Electron gives it (the title bar area beside the buttons), else null. */
export function overlayRect(): OverlayRect | null {
  try {
    const overlay = (navigator as unknown as { windowControlsOverlay?: { getTitlebarAreaRect?: () => OverlayRect } }).windowControlsOverlay;
    const rect = overlay?.getTitlebarAreaRect?.();
    if (rect && rect.height > 0 && rect.width > 0) return rect;
  } catch {
    // No overlay API here: the fallback below measures the page instead.
  }
  return null;
}

/** The buttons' width from the overlay's rect, or the fallback where the rect lies (Round 4, 4 Nov 2026, the
 *  reviewer: the real window's search sat 240px wide left of centre while the stand-in was right — its rect had
 *  frozen at boot size ([0,960]) while the window moved on, so innerWidth minus the rect ballooned to 259px at
 *  1219 and 960px at 1920 for buttons that are physically about fallback wide, shoving the header's right side
 *  into the bar. A rect claiming far more than the physical truth is stale, so the fallback stands; anything at
 *  or under it stands as before (full screen still counts as nothing). Pure, so the test pins it. */
export function trustedButtonsWidth(rect: OverlayRect | null, innerWidth: number, zoom: unknown): number {
  const fallback = buttonsWidth(zoom);
  if (!rect) return fallback;
  const width = Math.max(0, Math.round(innerWidth - rect.x - rect.width));
  return width > fallback + 24 ? fallback : width;
}

/** How tall the band under the buttons is, measured from the page (the tint reads the same: one measurement). */
export function measureBandHeight(): number {
  const at = typeof document === 'undefined' ? null : document.elementFromPoint(window.innerWidth - 70, 12);
  for (let el = at; el; el = el.parentElement) {
    const box = el.getBoundingClientRect();
    if (box.top <= 1 && box.height >= 24 && box.height <= 80) return Math.round(box.height);
  }
  return 40;
}

/** The band as CSS variables on the root (zero on a Mac). Called when the look, size or layout lands. */
export function updateWindowButtons(options: { platform: string; zoom: number }): void {
  const root = document.documentElement;
  if (options.platform === 'darwin') {
    root.style.setProperty('--wbtn-h', '0px');
    root.style.setProperty('--wbtn-w', '0px');
    return;
  }
  const rect = overlayRect();
  // The rect is the bar beside the buttons: the buttons are what is left of the window's width (nothing, when the
  // overlay gives the whole width back, as in full screen — its word stands then), unless the rect lies.
  const height = rect ? Math.round(rect.height) : measureBandHeight();
  const width = trustedButtonsWidth(rect, window.innerWidth, options.zoom);
  root.style.setProperty('--wbtn-h', `${height}px`);
  root.style.setProperty('--wbtn-w', `${width}px`);
}

/** How tall the band is in CSS pixels now (the variable, else the platform's fallback). */
export function buttonsTop(): number {
  if (typeof document === 'undefined') return 40;
  const scope = document.querySelector('.app') ?? document.documentElement;
  const raw = getComputedStyle(scope).getPropertyValue('--wbtn-h');
  const parsed = Math.round(Number.parseFloat(raw));
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 160) return parsed;
  return (document.querySelector('.app') as HTMLElement | null)?.dataset.platform === 'darwin' ? 0 : 40;
}

/** The highest a popup opened near the top may start: below the band with a breath of room. */
export function minPopupTop(): number {
  return buttonsTop() + 6;
}

/** The overlay moved (maximised, snapped): the band is measured again. Answers its own stop. */
export function watchWindowButtons(again: () => void): () => void {
  try {
    const overlay = (navigator as unknown as { windowControlsOverlay?: { addEventListener?: (name: string, fn: () => void) => void; removeEventListener?: (name: string, fn: () => void) => void } }).windowControlsOverlay;
    if (overlay?.addEventListener) {
      overlay.addEventListener('geometrychange', again);
      return () => overlay.removeEventListener?.('geometrychange', again);
    }
  } catch {
    // No overlay API here: resize and layout already measure again.
  }
  return () => {};
}
