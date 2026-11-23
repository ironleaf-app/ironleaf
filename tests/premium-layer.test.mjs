// node --test tests/premium-layer.test.mjs — the premium finish reaches every vault surface
// (29 Oct 2026, the plan): one card finish, avatars at 28/36/48, 40 px empty tiles,
// one button set, card section headers, and the accent focus ring. Without these checks a
// page could grow its own shadow, radius or button variant again and look newly designed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const premium = read('src/renderer/src/styles/premium-layer.css');

test('premium-layer.css is loaded last from main.tsx', () => {
  const main = read('src/renderer/src/main.tsx');
  const at = main.indexOf("import './styles/premium-layer.css'");
  assert.ok(at > main.indexOf("import './styles/polish-round3.css'"), 'the premium finish settles every sheet before it');
  assert.ok(at > main.indexOf("import './styles/feel.css'"));
});

test('every named surface is in the premium card, row or focus lists', () => {
  const surfaces = {
    'note property block': '.properties',
    'note context rail': '.nv-rail-section',
    'meeting top': '.mt-top',
    'meeting actions': '.mt-panel',
    'people cards': '.pc-card-main',
    'person page': '.pm-card',
    'inbox rows': '.ib-item',
    'search rows': '.fh-row',
    'search results': '.result-title',
    'publications editions': '.pb-card',
    'publications panels': '.pb-panel',
    'automations rows': '.au-row',
    'automations panel': '.au-panel',
    // Design language (23 Nov 2026): a weekly review project is the one card; its changed / slipped / to chase
    // columns sit inside it as columns, no longer three more cards inside the card.
    'weekly review': '.wr-project',
    'weekly rows': '.wr-item',
    'settings rows': '.setting-row',
    'settings cards': '.nt-item',
    // 8 Nov 2026, the living graph: the card map's columns and cards went (the dark canvas and its legend
    // are not premium light surfaces), so they leave the list with their rules.
    'module cards': '.hl-card',
    'module rows': '.lr-item',
  };
  for (const [name, cls] of Object.entries(surfaces)) assert.ok(premium.includes(cls), `${name} (${cls}) has the premium finish`);
});

test('avatars are 28, 36 or 48 px with a 1px inner ring, from the person hue', () => {
  assert.match(premium, /inset 0 0 0 1px/, 'a 1px inner ring');
  assert.match(premium, /\.pm-avatar, \.pc-avatar, \.ag-avatar, \.cv-avatar\) \{ width: 36px; height: 36px; \}/, '36 px is the standard face');
  assert.match(premium, /width: 28px; height: 28px/, '28 px inside rows');
  assert.match(premium, /width: 48px; height: 48px/, '48 px where a person leads a page');
  assert.match(premium, /\.nv-page-icon :is\(\.pm-avatar/, 'the person page leads at 48 px');
});

test('empty places have one 44 px mist tile, and buttons are one set', () => {
  const feel = read('src/renderer/src/styles/feel.css');
  assert.match(feel, /\.nv-empty \.nv-empty-tile \{[^}]*width: 44px;\s*height: 44px;/, 'the empty tile is 44 px');
  assert.doesNotMatch(feel, /width: 46px/, 'no second empty tile size');
  assert.match(premium, /\.nv-empty \.nv-empty-tile \{[^}]*width: 44px/, 'the premium tile agrees');
  assert.match(premium, /:is\(\.button, \.button\.small, \.button\.large\) \{\s*height: 32px;[^}]*border-radius: var\(--r-2\);[^}]*font-size: var\(--fs-small\);[^}]*font-weight: 600;/, 'one button: 32 px, radius 6, 13 px semibold');
  assert.match(premium, /\.button\.primary \{/, 'one primary');
  assert.match(premium, /:is\(\.text-button, \.button\.quiet/, 'one quiet');
});

test('card section headers and the keyboard focus ring are the premium ones', () => {
  assert.match(premium, /font-size: var\(--fs-small\);\s*font-weight: 600;/, 'section headers are 13 px semibold');
  assert.match(premium, /outline: 2px solid var\(--focus\);\s*outline-offset: 2px;/, 'the focus ring sits 2 px outside the edge');
  assert.doesNotMatch(premium, /0 0 0 3px color-mix\(in srgb, var\(--accent\)/, 'no accent glow ring');
});

test('page sheets no longer fight the finish on the surfaces it now owns', () => {
  assert.doesNotMatch(read('src/renderer/src/styles/family.css'), /\.fy-member \{[^}]*border:/, 'Family members take the premium border');
  assert.doesNotMatch(read('src/renderer/src/styles/health.css'), /\.hl-card \{[^}]*border:/, 'Health cards take the premium border');
  assert.doesNotMatch(read('src/renderer/src/styles/publications.css'), /\.pb-panel \{[^}]*box-shadow:/, 'Publications panels take the premium shadow');
  assert.doesNotMatch(read('src/renderer/src/styles/graph.css'), /\.gm-/, 'no card-map selector survives in the living graph sheet');
  assert.doesNotMatch(read('src/renderer/src/styles/note-context.css'), /\.nv-rail-section \{[^}]*border-top:/, 'Rail sections are cards, not divided strips');
});

test('the premium layer uses theme tokens only', () => {
  assert.doesNotMatch(premium, /#[0-9a-fA-F]{3,8}\b/, 'no hard-coded colours');
  assert.doesNotMatch(premium, /DeepSeek|DSH|pi-ai/i, 'no engine names in words a person could see');
  assert.match(premium, /data-theme='dark'/, 'the dark theme has its own depth');
});

test('row highlights are the cool selection tint, never a warm accent mix', () => {
  // 8.9 round 2: the hover tint behind settings rows read peach, as did the glow on a
  // setting found by search. Both are the kit's --sel now, in every rule that uses them.
  const hovers = [...premium.matchAll(/--pl-row-hover: ([^;]+);/g)].map((m) => m[1].trim());
  assert.equal(hovers.length, 2, 'light and dark both set the row hover');
  for (const value of hovers) assert.equal(value, 'var(--sel)', `row hover is the kit tint (got ${value})`);
  const feel = read('src/renderer/src/styles/feel.css');
  const found = feel.match(/@keyframes nv-found \{[\s\S]*?\n\}/)?.[0] ?? assert.fail('no nv-found keyframes');
  assert.ok(found.includes('background: var(--sel)'), 'the found row glows the kit tint');
  assert.ok(!found.includes('--accent'), 'the found glow holds no warm accent mix');
  assert.doesNotMatch(feel, /\.setting-found \{[^}]*--accent/, 'the found rule holds no warm accent mix either');
});
