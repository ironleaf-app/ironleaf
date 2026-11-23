// node --test tests/polish-vault-shell.test.mjs — second-wave polish (3 Nov 2026, the plan): the Vault
// matches the former host app's shell. Each check fails without its fix. Static where the behaviour is
// structural (CSS values, component order, words), numeric where ITEMS asks for numbers (rail rows vs the
// former host app's reference).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cssPxFor } from './css-px.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => cssPxFor(f, readFileSync(path.join(root, f), 'utf8'));

test('1: the header search is host-sized and shows down to the minimum', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  const base = read('src/renderer/src/styles.css');
  // The former host app's size: 520px max centred, 38px tall (8px padding + 20px line + 2px border),
  // 14px/20px words.
  assert.ok(/\.top-search\s*\{[^}]*max-width:\s*520px/s.test(kit), 'search max 520px, as the host app');
  assert.ok(/\.top-search\s*\{[^}]*font-size:\s*var\(--fs-md\)/s.test(kit) && /\.top-search\s*\{[^}]*line-height:\s*20px/s.test(kit), 'search 14px/20px, as the host app (was 15px)');
  assert.ok(/--fs-md:\s*14px/.test(base), '--fs-md carries the host app 14px');
  assert.ok(/\.top-search\s*\{[^}]*padding:\s*8px 12px/s.test(kit), 'search 8px padding for the 38px height');
  assert.ok(kit.includes('box-sizing: border-box'), 'search counts its border in the 38px');
  // The yield matches the former host app's 40px button: full bar at 1219x709 and down to the 1000px minimum
  // (main ~708px); only a window too narrow for the bare sides squeezes (Round 5: the measured .is-squeezed,
  // not width steps).
  assert.ok(kit.includes('.topbar.is-squeezed .top-search { width: 40px;'), 'the 40px button in a window too narrow, as the host app');
  assert.ok(kit.includes('.topbar.is-squeezed .top-search .clip, .topbar.is-squeezed .top-search kbd { display: none; }'), 'the key and the words go with it');
  assert.ok(!kit.includes('@container topbar (max-width: 860px)') && !kit.includes('@container topbar (max-width: 760px)'), 'the first wave 860px/760px that collapsed it at the owner size are gone');
  // Words clip without dots, never a sliver reading "A..." (t207 pass 2).
  assert.ok(/\.top-search \.clip\s*\{[^}]*text-overflow:\s*clip/s.test(kit), 'search words clip');
});

test('2: the bell badge is small at the corner; the header uses one icon size', () => {
  const css = read('src/renderer/src/styles.css');
  // The former host app's size: 32px button, the count 14px tall at top 2px right 1px, 11px words,
  // 4px radius.
  assert.ok(/\.places-bell\s*\{[^}]*width:\s*32px/s.test(css) && /\.places-bell\s*\{[^}]*height:\s*32px/s.test(css), 'bell 32px, as the host app (was 30)');
  const count = css.match(/\.places-bell-count\s*\{([^}]*)\}/s)?.[1] ?? assert.fail('no .places-bell-count');
  assert.ok(count.includes('min-width: 14px') && count.includes('height: 14px'), 'count 14px tall (was 15)');
  assert.ok(count.includes('font: 600 var(--fs-xs)/14px'), 'count 11px words (was 12px caption)');
  assert.ok(count.includes('border-radius: var(--r-1)'), 'count 4px radius (was the 8px pill)');
  assert.ok(count.includes('top: 2px') && count.includes('right: 1px'), 'count at the corner (was top 1px right 0)');
  assert.ok(count.includes('box-shadow: 0 0 0 1.5px var(--bg)'), 'count rung by the ground it sits on');
  assert.ok(count.includes('background: var(--primary)'), 'count navy, as the host app (shell parity, 4 Nov 2026), never the picked accent');
  // The header's right slot: 32px buttons, 8px gaps, every icon 16px.
  // 5 Nov 2026, one search door: the Ask button left the header for the centred bar's panel (Ctrl+J still asks).
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(/\.topbar \.navbtn\s*\{[^}]*width:\s*32px/s.test(kit), 'header buttons 32px, as the bell');
  assert.ok(/\.topbar \.right\s*\{[^}]*gap:\s*8px/s.test(kit), 'header right gap 8px (was 10)');
  const bar = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(!bar.includes('<NoticeBell />') && !bar.includes('NoticeBell'), 'the bell left the header for the foot, as in the host app');
  assert.ok(!bar.includes('<span>Ask</span>'), 'no Ask button in the header');
  assert.ok(bar.includes('<Icon name="search" size={16} />'), 'search icon 16px (was 17)');
  assert.ok(read('src/renderer/src/state/commands.ts').includes("id: 'ask'") && read('src/renderer/src/state/commands.ts').includes("hotkey: 'Mod+J'"), 'Ctrl+J still asks');
});

test('5: rail rows, headings and counts equal the host app, compared numerically', () => {
  // The former host app's reference values (SHELL-VALUES.md and look.css .hHd-Xa_panelRow, .bhn1Oq_sectionLabel): the
  // Vault copies them.
  const spark = { rowH: 32, font: 15, line: 22, icon: 16, gap: 10, radius: 6, countFont: 13, countLine: 20, headFont: 12, headLine: 18, headH: 30, active: '#e3eaf3' };
  const kit = read('src/renderer/src/styles/kit.css');
  const base = read('src/renderer/src/styles.css');
  const num = (rule, name) => {
    const m = rule.match(new RegExp(`(?:^|[;\\s])${name}:\\s*(\\d+)px`));
    return m ? Number(m[1]) : NaN;
  };
  // A token's pixel value from the root (font sizes ride tokens, never hard numbers).
  const tokenPx = (name) => {
    const m = base.match(new RegExp(`${name}:\\s*(\\d+)px`));
    return m ? Number(m[1]) : NaN;
  };
  const fontPx = (rule) => {
    const m = rule.match(/font-size:\s*var\((--fs-[a-z]+)\)/);
    return m ? tokenPx(m[1]) : num(rule, 'font-size');
  };
  const srow = kit.match(/^\.srow\s*\{([^}]*)\}/m)?.[1] ?? assert.fail('no .srow');
  assert.equal(num(srow, 'height'), spark.rowH, 'place rows 32px');
  assert.equal(num(srow, 'min-height'), spark.rowH, 'place rows 32px min');
  assert.equal(fontPx(srow), spark.font, 'row text 15px');
  assert.equal(num(srow, 'line-height'), spark.line, 'row line 22px');
  assert.equal(num(srow, 'gap'), spark.gap, 'row gap 10px');
  const iconRule = kit.match(/^\.srow svg\s*\{([^}]*)\}/m)?.[1] ?? assert.fail('no .srow svg size');
  assert.equal(num(iconRule, 'width'), spark.icon, 'row icon 16px');
  // Counts at the right in the former host app's style: 500 13px/20px tabular-nums (t218: one count
  // in both apps).
  const n = kit.match(/\.srow \.n\s*\{([^}]*)\}/s)?.[1] ?? assert.fail('no .srow .n');
  assert.equal(fontPx(n), spark.countFont, 'counts 13px (was 14)');
  assert.equal(num(n, 'line-height'), spark.countLine, 'counts 20px line');
  assert.ok(n.includes('font-variant-numeric: tabular-nums'), 'counts line up');
  // Headings: 600 12px/18px in a 30px block.
  const head = kit.match(/\.slabel\s*\{([^}]*)\}/s)?.[1] ?? assert.fail('no .slabel');
  assert.equal(fontPx(head), spark.headFont, 'headings 12px');
  assert.equal(num(head, 'line-height'), spark.headLine, 'headings 18px line');
  assert.equal(num(head, 'min-height'), spark.headH, 'headings 30px block');
  assert.ok(head.includes('font-weight: 600'), 'headings semibold');
  // The active fill is the former host app's token value.
  assert.ok(/\.srow\.on\s*\{[^}]*background:\s*var\(--sel\)/s.test(kit), 'active rows read --sel');
  const sel = kit.match(/--sel:\s*(#[0-9a-f]{6})/i)?.[1] ?? assert.fail('no --sel token');
  assert.equal(sel.toLowerCase(), spark.active, 'active fill #e3eaf3, as the host app');
  // Shorter windows set the rows closer, as the former host app's.
  assert.ok(kit.includes('@media (max-height: 820px)') && kit.includes('height: 30px'), '30px at 820px high and under');
  assert.ok(kit.includes('@media (max-height: 700px)') && kit.includes('height: 28px'), '28px at 700px and under');
  assert.ok(kit.includes('@media (max-height: 620px)') && kit.includes('height: 26px'), '26px at 620px and under');
  // The bar never scrolls.
  assert.ok(kit.includes('.side .places-list { flex: 1 1 0; min-height: 0; overflow: hidden; }'), 'the rail never scrolls');
});

test('6: Home spacing matches the rooms; Today has no hero and neutral chips', () => {
  // Home: the frame's pad over the title, as every room (p25 one column supersedes the 36px inline pad: it sat
  // Home's title lowest of every room while the frame's rooms stood 12px above it).
  const home = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(home.includes('<div className="vpage wide">') && !home.includes('36px 36px 48px'), 'Home stands in the frame, carrying no pad of its own');
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(/\.vpage\s*\{[^}]*padding:\s*36px 36px 48px/s.test(kit), 'pages 36px over the title (was 32)');
  // Today: no hero art, frame, line or dot.
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(!today.includes('<HeroArt'), 'no hero art on Today');
  assert.ok(today.includes('className="td-head nv-today-head"') && !today.includes('nv-today-head nv-hero'), 'no hero band on Today');
  // The area chips are neutral monochrome: every icon navy/slate, never its area colour.
  const life = read('src/renderer/src/styles/life.css');
  const svg = life.match(/\.td-areas > button svg\s*\{([^}]*)\}/s)?.[1] ?? assert.fail('no td-areas icon rule');
  assert.ok(!svg.includes('var(--type'), 'chip icons never read the area colour');
  assert.ok(svg.includes('color: var(--text-muted)'), 'chip icons slate');
  const on = life.match(/\.td-areas > button\.on\s*\{([^}]*)\}/s)?.[1] ?? assert.fail('no td-areas on rule');
  assert.ok(!on.includes('var(--type'), 'the picked chip never reads its colour fill');
  assert.ok(on.includes('background: var(--sel)'), 'the picked chip sits on the selected fill');
});
