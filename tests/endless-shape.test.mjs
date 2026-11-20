// node --test tests/endless-shape.test.mjs — the whole app rides the scales (10.0 Endless Tech): one type scale,
// square-ish radii with no pills anywhere, cool shadows, no retired colour in any rule. Counts every radius and
// every type size across all 86 stylesheets plus the base, and fails on the first stranger. Fails without the move.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'src/renderer/src');
const files = ['styles.css', ...readdirSync(path.join(dir, 'styles')).filter((f) => f.endsWith('.css')).sort()];

/** Rules only: comments and :root token definitions hold the canonical values themselves (every :root block,
 *  however many theme or palette selectors it carries; 4 Nov 2026: the strip used to miss blocks with two selectors,
 *  so restored palette grounds tripped the rule checks (grounds policy lives in no-cream-base.test.mjs). */
function rulesOf(file) {
  let css = readFileSync(path.join(dir, file === 'styles.css' ? 'styles.css' : `styles/${file}`), 'utf8');
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  css = css.replace(/:root(\[[^\]]*\])*\s*\{[^{}]*\}/g, '');
  return css;
}

test('no pills anywhere: no 999px or 99px radius in any rule', () => {
  for (const file of files) {
    for (const m of rulesOf(file).matchAll(/border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*([^;]+);/g))
      assert.ok(!/99px/.test(m[1]), `${file}: a pill survives (${m[1].trim()})`);
  }
});

test('round is only for dots and avatars: corner-shape: round only with a 50% radius', () => {
  for (const file of files) {
    for (const m of rulesOf(file).matchAll(/([^{}]+)\{([^{}]*corner-shape\s*:\s*round\b[^{}]*)\}/g)) {
      const sel = m[1].trim().split(/\s+/).join(' ');
      assert.ok(/border-radius\s*:\s*50%/.test(m[2]), `${file}: ${sel} rounds a non-circle`);
    }
  }
});

test('radii are the scale, square, or round dots and avatars', () => {
  for (const file of files) {
    for (const m of rulesOf(file).matchAll(/border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*([^;]+);/g)) {
      // 4/6/8/10 through the tokens, 0 for square, 50% for dots and avatars, pt in print, inherit, !important.
      const rest = m[1]
        .replace(/var\(--r-[1-4]\)/g, '')
        .replace(/50%/g, '')
        .replace(/(?<![\d.])0(?![\d.])/g, '')
        .replace(/[\d.]+pt/g, '')
        .replace(/inherit|!important/g, '');
      assert.ok(!/\d/.test(rest), `${file}: radius off the scale (${m[1].trim()})`);
    }
  }
});

test('type sizes are the scale, through the tokens', () => {
  for (const file of files) {
    const css = rulesOf(file);
    for (const m of css.matchAll(/font-size\s*:\s*([^;]+);/g))
      assert.ok(!/\dpx/.test(m[1]), `${file}: a font-size off the scale (${m[1].trim()})`);
    for (const m of css.matchAll(/(?<![a-z-])font\s*:\s*([^;]+);/g)) {
      // The line-height after the slash is geometry, not a size; pt is print.
      const size = m[1].replace(/\/[\d.]+(px)?/g, '').replace(/[\d.]+pt/g, '');
      assert.ok(!/\dpx/.test(size), `${file}: a font size off the scale (${m[1].trim().slice(0, 80)})`);
    }
  }
});

test('shadows are cool: no warm brown-grey in any rule', () => {
  for (const file of files) assert.ok(!/31,\s*30,\s*29/.test(rulesOf(file)), `${file}: a warm shadow survives`);
});

test('the keyboard ring is 2px of Focus outside the edge, never an accent glow', () => {
  for (const file of files) {
    for (const m of rulesOf(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/:(focus|focus-visible|focus-within)\b/.test(m[1])) continue;
      assert.ok(!/box-shadow:[^;]*0 0 0 [234]px var\(--accent-(?:soft|softer|line)\)/.test(m[2]), `${file}: an accent glow ring survives`);
      assert.ok(!/outline:\s*2px solid var\(--accent\)/.test(m[2]), `${file}: an accent outline survives`);
    }
  }
});

test('where you are is a soft fill, never a coral edge: no accent on selected rows, cards or steps', () => {
  const spots = [
    ['styles.css', '.outline-row.current'],
    ['timeline.css', '.tl-row.is-selected'],
    ['layouts.css', '.ly-table tr.ly-new-row td'],
    ['flows.css', '.flow-card.selected'],
    ['site-publish.css', '.publish-step.is-on'],
    ['site-publish.css', '.publish-host.is-on'],
    ['styles.css', '.nv-embed-note'],
  ];
  for (const [file, sel] of spots) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = rulesOf(file).match(new RegExp(`${esc}\\s*\\{([^{}]*)\\}`, 's'))?.[1] ?? assert.fail(`no ${sel} in ${file}`);
    assert.ok(!/var\(--(accent|accent-line|accent-soft|accent-softer|coral)\)/.test(rule), `${file} ${sel} still wears coral`);
  }
});

test('no retired colour in any rule', () => {
  const retired = ['#b85a37', '#e4e8ee', '#dde6f0', '#5b6472', '#9aa3b2', '#e9edf3', '#d3deeb',
    '#faf9f5', '#f3f1ea', '#ebe8df', '#e4e0d5', '#f1eee6', '#e5e1d6', '#d6d1c4',
    '#fffefa', '#fdf5dc', '#f9ecc6', '#f4e2b2', '#fcf5e0', '#f1e5bf', '#e3d29f', '#fff7e2'];
  for (const file of files) {
    const css = rulesOf(file).toLowerCase();
    for (const hex of retired) assert.ok(!css.includes(hex), `${file}: retired ${hex} in a rule`);
  }
});
