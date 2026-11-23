// SPDX-License-Identifier: AGPL-3.0-or-later
// Enter that means "do it" (23 Nov 2026, Modern Web Guidance ime-safe-enter-submit). People typing Chinese,
// Japanese or Korean press Enter to confirm the characters they are composing; that Enter arrives as a keydown with
// isComposing set, and acting on it would submit, rename or close while they are still mid-word. So every custom
// Enter handler asks this instead of reading e.key alone. (keyCode 229 is the composing key some input methods
// report instead of isComposing.)

type KeyLike = { key: string; keyCode?: number; isComposing?: boolean; nativeEvent?: { isComposing?: boolean } };

export function isEnterKey(e: KeyLike): boolean {
  if (e.key !== 'Enter') return false;
  const composing = e.nativeEvent ? e.nativeEvent.isComposing : e.isComposing;
  return !composing && e.keyCode !== 229;
}
