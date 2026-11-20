// node --test tests/no-cream-base.test.mjs — no cream base anywhere (8.6.1, 31 Oct 2026; 4 Nov 2026: warm looks are
// back but only as looks someone picks): styles.css's base :root is Endless Tech itself (a white page, cool mist
// greys, one coral accent), so before the palette arrives, an unknown palette id, the capture window or any window
// that forgets it never falls back to cream. The default look and the cool looks hold no warm ground (Sunny, Paper,
// Blush, Rose and Cocoa are warm by design, as explicit choices), and the main process's own window defaults are
// the same cool white. Fails without each change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
// A light colour whose red is clearly above its blue (the same warm check as brand-honey and kit-87).
const warm = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.min(r, g, b) >= 190 && r - b >= 8;
};
/** The first :root block in a stylesheet: the light base, before any theme or palette applies. */
const baseOf = (css) => css.match(/:root \{([^}]*)\}/s)?.[1] ?? assert.fail('no base :root');
// Every token the honey block sets that the base also carries: the fallback must match Honey Glow token for token.
const HONEY = {
  '--bg': '#ffffff', '--bg-side': '#f2f4f7', '--bg-soft': '#f6f8fa', '--bg-raised': '#ffffff', '--bg-hover': '#e8edf2',
  '--bg-active': '#e3eaf3', '--bg-code': '#f2f4f7', '--border': '#e2e7ee', '--border-strong': '#ccd4df',
  '--text': '#3d4356', '--text-strong': '#141a2e', '--text-muted': '#565e70', '--text-faint': '#7a8191', '--ink': '#141a2e',
  '--on-ink': '#ffffff', '--primary': '#1b2235', '--on-primary': '#ffffff', '--graph-link': '#ccd4df',
  '--canvas-grid': '#e2e7ee', '--canvas-card-border': '#ccd4df', '--scroll': '#d3d9e2',
};

test('the base is Endless Tech: a white page, cool mist greys, one coral accent', () => {
  const base = baseOf(read('src/renderer/src/styles.css'));
  for (const [token, value] of Object.entries(HONEY))
    assert.ok(base.includes(`${token}: ${value}`), `base ${token} is Endless Tech's ${value}`);
  assert.ok(base.includes('--accent-base: #357553'), 'the base accent is Ironleaf\'s leaf (20 Nov 2026), never the old clay');
  assert.ok(base.includes('--overlay: rgba(27, 34, 53, 0.24)'), 'base overlay is the cool navy tint');
});

test('guard: no warm fallback colour in the base', () => {
  const base = baseOf(read('src/renderer/src/styles.css'));
  // The retired cream sets must not come back as the fallback (neither Paper's nor Sunny's).
  for (const hex of ['#faf9f5', '#f3f1ea', '#ebe8df', '#e4e0d5', '#f1eee6', '#e5e1d6', '#d6d1c4', '#d9d4c7', '#d4d0c4', '#fffefa', '#fdf5dc', '#f9ecc6', '#f4e2b2'])
    assert.ok(!base.toLowerCase().includes(hex), `base holds no ${hex}`);
  // And nothing else warm hides among the fallback surfaces either (highlights and accents are not surfaces).
  const surfaces = Object.keys(HONEY)
    .map((t) => base.match(new RegExp(`${t}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1])
    .filter(Boolean);
  assert.ok(surfaces.length === Object.keys(HONEY).length, 'every fallback surface is a fixed colour');
  for (const hex of surfaces) assert.ok(!warm(hex), `base surface ${hex} is a warm off-white`);
});

test('sunny, paper and blush are offered as themselves: a block, a choice, no migration', () => {
  const palettes = read('src/renderer/src/styles/palettes.css');
  assert.ok(palettes.includes("'sunny'") && palettes.includes("'paper'") && palettes.includes("'blush'"), 'sunny, paper and blush paint their own blocks');
  const prefs = read('src/shared/prefs.ts');
  assert.ok(prefs.includes("id: 'sunny'") && prefs.includes("id: 'paper'") && prefs.includes("id: 'blush'"), 'all three are offered in Settings');
  assert.ok(!prefs.includes("palette === 'sunny'") && !prefs.includes("palette === 'paper'") && !prefs.includes("palette === 'blush'"), 'none is migrated anywhere');
});

test('the default and cool looks paint cool grounds; warm looks are explicit choices only', () => {
  const ids = [...read('src/shared/prefs.ts').matchAll(/\{ id: '([a-z]+)', name: /g)].map((m) => m[1]);
  assert.ok(ids.length === 14 && ids[0] === 'honey' && ids[1] === 'bright', `${ids.length} offered palettes, White first, Bright second`);
  const palettes = read('src/renderer/src/styles/palettes.css');
  for (const id of ids) {
    const blocks = [...palettes.matchAll(new RegExp(`\\[data-palette='${id}'\\][^{]*\\{([^}]*)\\}`, 'gs'))];
    assert.ok(blocks.length >= 1, `no ${id} block`);
  }
  // Sunny, Paper, Blush, Rose and Cocoa are warm by design (their grounds trip the metric); every other look,
  // including the Bright default, holds no warm ground.
  for (const id of ids.filter((i) => !['sunny', 'paper', 'blush', 'rose', 'cocoa'].includes(i))) {
    const blocks = [...palettes.matchAll(new RegExp(`\\[data-palette='${id}'\\][^{]*\\{([^}]*)\\}`, 'gs'))];
    for (const block of blocks)
      for (const m of block[1].matchAll(/--bg(?:-side|-soft|-raised|-hover|-active|-code)?:\s*(#[0-9a-f]{6})/gi))
        assert.ok(!warm(m[1]), `${id} ground ${m[1]} is warm`);
  }
});

test('guard: the main process opens cool white, never cream', () => {
  const main = read('src/main/app.ts');
  assert.ok(main.includes("backgroundColor: '#ffffff'"), 'the window opens on a white page');
  assert.ok(main.includes("titleBarOverlay: { color: '#f2f4f7', symbolColor: '#1b2235'"), 'the buttons band opens cool');
  assert.ok(main.includes("? colors.background : '#f2f4f7'") && main.includes("? colors.symbols : '#1b2235'"), 'a tint that never lands still falls back cool');
  for (const hex of ['#faf9f5', '#f3f1ea', '#1f1e1d']) assert.ok(!main.includes(hex), `src/main/app.ts holds no ${hex}`);
  // Every window the main process opens: the capture box is see-through, the screenshot ground is black, the hidden
  // print windows take no colour at all — none opens cream.
  const capture = read('src/main/capture.ts');
  assert.ok(!['#faf9f5', '#f3f1ea', '#ebe8df', '#e5e1d6'].some((hex) => capture.includes(hex)), 'the capture window holds no cream');
});

test('the buttons tint falls back to the cool tokens, never cream', () => {
  const app = read('src/renderer/src/App.tsx');
  // fnv3: the fallback follows the theme (dark ones in dark), still cool, never cream.
  assert.ok(app.includes("'#f2f4f7')") && app.includes("'#565e70')") && app.includes("dark ? '#0f1526'"), 'cool fallbacks under the window buttons, light and dark');
  assert.ok(!app.includes('#f3f1ea') && !app.includes('#5c5a54'), 'no cream fallback in the tint');
});
