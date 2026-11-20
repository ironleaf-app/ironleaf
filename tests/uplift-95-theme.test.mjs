// node --test tests/uplift-95-theme.test.mjs — cool everywhere, both themes (9.5 polished, 1 Nov 2026, cool, never
// cream or warm tints). The dark ground is the cool set for every palette; selection fills read the kit's cool --sel,
// never the warm accent mix; faces and tiles tint from cool-only pools through one shared helper; each file kind has
// one colour with a dark variant; the timeline's today pill wears the chosen accent. Every check fails without its
// change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
// Warmth in the dark: red clearly above blue (the old charcoal #262624/#1f1e1d grounds, the #ece9e1 ink).
const darkWarm = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return r - b >= 3;
};

test('the dark ground is the cool set', () => {
  const css = read('src/renderer/src/styles.css');
  const dark = css.match(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/)?.[1] ?? assert.fail('no dark block');
  for (const m of dark.matchAll(/--(bg|bg-side|bg-raised|bg-hover|bg-active|bg-code|border|border-strong|text|text-muted|text-faint|ink|on-ink|primary|on-primary|graph-link|canvas-grid|canvas-card-border|scroll): (#[0-9a-f]{6})/g)) {
    assert.ok(!darkWarm(m[2]), `dark ${m[1]} is cool (got ${m[2]})`);
  }
  assert.ok(dark.includes('--bg: #141a2e'), 'the dark ground matches the cool set');
});

test('selection fills read the cool kit tint', () => {
  const css = read('src/renderer/src/styles.css');
  for (const sel of ['.tree-file.active', '.search-case.active', '.outline-row.current', '.cm-tooltip-autocomplete ul li[aria-selected]', ".nv-fb-btn[aria-pressed='true']", '.picker-row.selected', '.recovery-file.active', '.send-choice.active']) {
    const rule = css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{[^}]*\\}`, 's'))?.[0] ?? assert.fail(`no ${sel}`);
    assert.ok(rule.includes('var(--sel)'), `${sel} reads the cool selection tint`);
  }
});

test('faces tint from cool hues only', () => {
  const look = read('src/renderer/src/lib/projectLook.ts');
  assert.ok(look.includes('150 + (h % 100)') || look.includes('150 + (h % 101)'), 'personHue stays in the cool green-to-blue range');
  for (const f of ['src/renderer/src/styles.css', 'src/renderer/src/styles/project-workspace.css', 'src/renderer/src/styles/canvas-nav.css']) {
    assert.ok(!read(f).includes('var(--hue, 30)'), `${f}: no warm fallback hue`);
  }
  assert.ok(look.includes('export function hashTint'), 'one shared helper tints decorative tiles');
  const pool = look.match(/export function hashTint[\s\S]*?\n\}/)?.[0] ?? assert.fail('no hashTint body');
  assert.ok(!pool.includes('amber') && !pool.includes("'red'"), 'the shared pool holds no warm members');
});

test('each file kind has one colour, light and dark', () => {
  const css = read('src/renderer/src/styles.css');
  for (const kind of ['--kind-pdf', '--kind-sheet', '--kind-doc', '--kind-slides', '--kind-image', '--kind-mail', '--kind-text']) {
    assert.ok(new RegExp(`${kind}: #[0-9a-f]{6}`).test(css), `${kind} is single-sourced`);
  }
  const dark = css.match(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/)?.[1] ?? '';
  for (const kind of ['--kind-pdf', '--kind-sheet', '--kind-doc', '--kind-slides']) assert.ok(dark.includes(kind), `${kind} has a dark variant`);
  const hub = read('src/renderer/src/styles/project-hub.css');
  assert.ok(!hub.includes('#c4473a') && !hub.includes('#b03c30') && hub.includes('var(--kind-pdf)'), 'the hub reads the one pdf colour');
  const life = read('src/renderer/src/styles/life.css');
  assert.ok(!life.includes('#c62f2f') && life.includes('var(--kind-pdf)'), 'life reads the one pdf colour');
});

test('today wears the chosen accent, and the badge reads on it', () => {
  const tl = read('src/renderer/src/styles/timeline.css');
  assert.ok(tl.includes('.tl-today-pill') && /background: var\(--accent\)/.test(tl), 'the today pill wears the accent');
  const css = read('src/renderer/src/styles.css');
  assert.ok(css.includes('.places-bell-count') && !/\.places-bell-count \{[^}]*color: #fff/.test(css), 'the bell count reads the on-accent token');
});

test('page faces fit their tile, and marks show in the dark', () => {
  const premium = read('src/renderer/src/styles/premium-layer.css');
  assert.ok(premium.includes('.nv-page-icon:has('), 'the tile stands down where a face leads');
  const css = read('src/renderer/src/styles.css');
  assert.ok(/\[data-theme='dark'\] \.media-mark \{[^}]*screen/.test(css), 'media marks screen through in the dark');
});
