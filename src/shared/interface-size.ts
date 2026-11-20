// The size of everything in Ironleaf's window (5.0.0, 19 Oct 2026; as the former host app's src/interface-size.cjs):
// Settings › Appearance › Interface size, and Ctrl + plus, Ctrl + minus and Ctrl + 0 anywhere in the window, as in a
// browser. Six sizes, never a slider's 1.05: a size people can name ("125%") and get back to. Kept in the preferences
// in Ironleaf's data on this PC (prefs.zoom), and put back by the main side as the window opens.
//
// The main side handles the keys before the page sees them (src/main/app.ts, before-input-event), so they work on the
// welcome page and over Settings too, but it steps aside where Ironleaf already gives those keys a meaning: a canvas
// that has the keys zooms itself (data-own-zoom), and keys the person changed in Settings › Keys are theirs (the
// renderer's commands run them then). Shared by both sides; nothing here touches Electron.

export const INTERFACE_SIZES = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;

/** The size nearest to a value (an older Ironleaf kept any value from 0.8 to 1.6); 100% for anything unreadable. */
export function nearestSize(value: unknown): number {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : 1;
  return INTERFACE_SIZES.reduce<number>((best, step) => (Math.abs(step - v) < Math.abs(best - v) ? step : best), 1);
}

/** One size larger (+1), smaller (-1), or back to 100% (0); it stops at either end. */
export function stepSize(current: number, direction: number): number {
  if (direction === 0) return 1;
  const at = INTERFACE_SIZES.indexOf(nearestSize(current) as (typeof INTERFACE_SIZES)[number]);
  return INTERFACE_SIZES[Math.max(0, Math.min(INTERFACE_SIZES.length - 1, at + Math.sign(direction)))];
}

/** The size as people read it: "125%". */
export const sizeWords = (factor: number): string => `${Math.round(nearestSize(factor) * 100)}%`;

/** What Electron's before-input-event gives (the parts used here). */
export interface KeyInput {
  type?: string;
  key?: string;
  code?: string;
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
}

/**
 * The step a key press asks for, or null: Ctrl (⌘ on a Mac) with plus or equals (with or without Shift, as "Ctrl +" is
 * typed on most keyboards), minus, or 0, and the number pad's own + − 0; never with Alt (AltGr on European keyboards).
 */
export function keyStep(input: KeyInput | null | undefined): -1 | 0 | 1 | null {
  if (!input || input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return null;
  const key = String(input.key ?? '');
  const code = String(input.code ?? '');
  if (key === '+' || key === '=' || code === 'NumpadAdd') return 1;
  if (key === '-' || key === '_' || code === 'NumpadSubtract') return -1;
  if ((key === '0' || code === 'Digit0' || code === 'Numpad0') && !input.shift) return 0;
  return null;
}

/** The commands (renderer state/commands.ts) behind the three steps, and the keys they have unless changed. */
export const ZOOM_COMMANDS = { 1: 'zoom-in', [-1]: 'zoom-out', 0: 'zoom-reset' } as const;
const DEFAULT_COMBOS: Record<-1 | 0 | 1, string[]> = {
  1: ['Mod+=', 'Mod+Shift+=', 'Mod++', 'Mod+Shift++'],
  [-1]: ['Mod+-', 'Mod+Shift+-', 'Mod+_', 'Mod+Shift+_'],
  0: ['Mod+0'],
};

/**
 * Whether the main side may take this step's keys, given the keys changed in Settings › Keys (command id → keys, '' for
 * none): not when the person changed that zoom command's keys (or took them away), nor when they gave its keys to
 * another command. Then the page decides, as it does for every other key.
 */
export function mainTakesZoomKey(step: -1 | 0 | 1, hotkeys: Record<string, string> | null | undefined): boolean {
  const own = hotkeys ?? {};
  if (own[ZOOM_COMMANDS[step]] !== undefined) return false;
  const combos = DEFAULT_COMBOS[step];
  return !Object.entries(own).some(([id, combo]) => id !== ZOOM_COMMANDS[step] && combos.includes(combo));
}
