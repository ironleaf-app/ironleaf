// SPDX-License-Identifier: AGPL-3.0-or-later
// CSS as the measures the checks name: the spacing tokens (--space-0…7, src/renderer/src/styles.css) read as the
// pixels they stand for, so a check written as "padding: 12px 0" still holds once the rule says
// "padding: var(--space-3) 0" (23 Nov 2026, one spacing scale). Any other text is returned as it is.
const SPACE = { 0: '2px', 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '24px', 6: '36px', 7: '64px' };

export function cssPx(text) {
  return text.replace(/var\(--space-([0-7])\)/g, (_, n) => SPACE[n]);
}

/** cssPx for .css files only. */
export function cssPxFor(file, text) {
  return /\.css$/.test(file) ? cssPx(text) : text;
}
