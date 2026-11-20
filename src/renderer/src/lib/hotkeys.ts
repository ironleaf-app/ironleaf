// Keys are written like "Mod+Shift+F": Mod is Ctrl on Windows and Linux and Cmd on a Mac; Ctrl always means Ctrl.

export const isMac = navigator.userAgent.includes('Mac');

const KEY_ALIASES: Record<string, string> = { left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown', esc: 'escape', space: ' ', del: 'delete' };
const CODES: Record<string, string> = { '/': 'Slash', ',': 'Comma', '.': 'Period', '-': 'Minus', '=': 'Equal', ';': 'Semicolon', "'": 'Quote', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '`': 'Backquote' };

export function matchHotkey(event: KeyboardEvent, combo: string | undefined): boolean {
  if (!combo) return false;
  const parts = combo.split('+');
  let key = parts.pop()!.toLowerCase();
  if (key === '' && combo.endsWith('++')) key = '+';
  const wantMod = parts.includes('Mod');
  const wantCtrl = parts.includes('Ctrl');
  const wantMeta = parts.includes('Meta');
  const needCtrl = isMac ? wantCtrl : wantMod || wantCtrl;
  const needMeta = isMac ? wantMod || wantMeta : wantMeta;
  if (event.ctrlKey !== needCtrl || event.metaKey !== needMeta || event.shiftKey !== parts.includes('Shift') || event.altKey !== parts.includes('Alt')) return false;
  const wanted = KEY_ALIASES[key] ?? key;
  const pressed = event.key.toLowerCase();
  if (pressed === wanted) return true;
  // event.code keeps keys working when Shift or Alt change the character they type.
  if (wanted.length === 1 && /[a-z]/.test(wanted)) return event.code === `Key${wanted.toUpperCase()}`;
  if (wanted.length === 1 && /\d/.test(wanted)) return event.code === `Digit${wanted}`;
  if (CODES[wanted]) return event.code === CODES[wanted];
  return false;
}

/** The keys as the person sees them (Ctrl+Shift+F on Windows, ⇧⌘F on a Mac). */
export function formatHotkey(combo: string): string {
  const names: Record<string, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Shift: '⇧', Alt: '⌥', Meta: '⌘', Left: '←', Right: '→', Up: '↑', Down: '↓', Enter: '↩', Tab: '⇥' }
    : { Mod: 'Ctrl', Meta: 'Win', Left: '←', Right: '→', Up: '↑', Down: '↓' };
  return combo
    .split('+')
    .map((p) => names[p] ?? (p.length === 1 ? p.toUpperCase() : p))
    .join(isMac ? '' : '+');
}

/** The keys pressed, written the same way (for choosing a shortcut in Settings). Null for a modifier on its own. */
export function comboFromEvent(event: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null;
  const parts: string[] = [];
  if (isMac ? event.metaKey : event.ctrlKey) parts.push('Mod');
  if (isMac && event.ctrlKey) parts.push('Ctrl');
  if (!isMac && event.metaKey) parts.push('Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  let key = event.key;
  if (event.code.startsWith('Key')) key = event.code.slice(3);
  else if (event.code.startsWith('Digit')) key = event.code.slice(5);
  else {
    const named: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space', Escape: 'Esc' };
    key = named[key] ?? (key.length === 1 ? key.toLowerCase() : key);
    const fromCode = Object.entries(CODES).find(([, code]) => code === event.code)?.[0];
    if (fromCode) key = fromCode;
  }
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join('+');
}
