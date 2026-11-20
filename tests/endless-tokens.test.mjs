// node --test tests/endless-tokens.test.mjs — every Endless Tech role is in Vault's tokens, light and dark
// (10.0, 2 Nov 2026, look B "Endless Tech"). The values are inputs/design-language-endless-tech.md's, the same
// the former host app draws: the base :root carries them so every window falls back to them, and the Honey
// Glow blocks in styles/palettes.css match token for token. Fails without each role.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const base = read('src/renderer/src/styles.css').match(/:root \{([^}]*)\}/s)?.[1] ?? assert.fail('no base :root');
const dark = read('src/renderer/src/styles.css').match(/:root\[data-theme='dark'\] \{([^}]*)\}/s)?.[1] ?? assert.fail('no dark :root');
const palettes = read('src/renderer/src/styles/palettes.css');

test('light carries every colour role at the spec value', () => {
  for (const token of [
    '--bg: #ffffff', '--bg-side: #f2f4f7', '--bg-soft: #f6f8fa', '--bg-raised: #ffffff',
    '--bg-hover: #e8edf2', '--bg-active: #e3eaf3', '--border: #e2e7ee', '--border-strong: #ccd4df',
    '--text: #3d4356', '--text-strong: #141a2e', '--text-muted: #565e70', '--text-faint: #7a8191',
    '--ink: #141a2e', '--primary: #1b2235', '--on-primary: #ffffff',
    '--danger: #b0422f', '--danger-soft: #eee9ec', '--warn: #9a6713', '--warn-soft: #eaeee6',
    '--ok: #3f7a49', '--ok-soft: #e4efe6', '--focus: #2c6347',
    '--hero-1: #ffffff', '--hero-2: #edf2f6', '--glass: rgba(255, 255, 255, 0.74)',
  ]) assert.ok(base.includes(token), `light ${token}`);
  assert.ok(base.includes('--accent-base: #357553'), 'the one accent: Ironleaf\'s leaf (20 Nov 2026, the rename), never the old clay');
});

test('dark carries every colour role at the spec value', () => {
  for (const token of [
    '--bg: #141a2e', '--bg-side: #0f1526', '--bg-soft: #171e33', '--bg-raised: #1b2235',
    '--bg-active: #2a3350', '--border: #2a3350', '--border-strong: #3d4356',
    '--text: #c6ccd8', '--text-strong: #ffffff', '--text-muted: #a9aec2', '--text-faint: #8b93a8',
    '--ink: #ffffff', '--primary: #eef1f6', '--on-primary: #141a2e',
    '--danger: #e88573', '--danger-soft: #3d2323', '--warn: #dcae55', '--warn-soft: #38301d',
    '--ok: #8fcb95', '--ok-soft: #1d3329', '--focus: #7cc197',
    '--hero-1: #1b2235', '--hero-2: #11182b', '--glass: rgba(27, 34, 53, 0.72)',
  ]) assert.ok(dark.includes(token), `dark ${token}`);
});

test('one type scale, one spacing scale, one radius set, one shadow set, one shell', () => {
  for (const token of [
    '--fs-display: 52px', '--fs-page: 38px', '--fs-section: 20px', '--fs-card: 17px',
    '--fs-reading: 16.5px', '--fs-body: 15px', '--fs-small: 13px', '--fs-caption: 12px',
    '--sp-1: 4px', '--sp-2: 8px', '--sp-3: 12px', '--sp-4: 16px',
    '--sp-5: 20px', '--sp-6: 24px', '--sp-7: 32px', '--sp-8: 44px',
    '--r-1: 4px', '--r-2: 6px', '--r-3: 8px', '--r-4: 10px',
    '--rail-w: 292px', '--header-h: 56px', '--page-pad: 36px', '--card-pad: 18px',
    '--reading: 920px', '--reading-wide: 1080px',
  ]) assert.ok(base.includes(token), `base ${token}`);
  assert.ok(base.includes('--e-1: 0 1px 2px rgba(20, 26, 46, 0.06)'), 'rest shadow is cool and quiet');
  assert.ok(base.includes('--e-2: 0 1px 2px color-mix(in srgb, var(--text-strong) 4%, transparent), 0 8px 24px -12px color-mix(in srgb, var(--text-strong) 16%, transparent)'), 'lifted shadow is the host app\'s --ns-shadow-2 (shell parity, 4 Nov 2026)');
  assert.ok(dark.includes('--e-1:') && dark.includes('--e-2:') && dark.includes('--e-3:'), 'dark has its own three shadows');
});

test('honey matches the base token for token, light and dark', () => {
  const light = palettes.match(/\[data-theme='light'\]\[data-palette='honey'\] \{([^}]*)\}/s)?.[1] ?? assert.fail('no light honey');
  for (const token of ['--bg: #ffffff', '--bg-side: #f2f4f7', '--bg-soft: #f6f8fa', '--bg-active: #e3eaf3', '--border: #e2e7ee', '--text: #3d4356', '--text-strong: #141a2e', '--text-muted: #565e70', '--text-faint: #7a8191', '--ink: #141a2e'])
    assert.ok(light.includes(token), `light honey ${token}`);
  const darkHoney = palettes.match(/\[data-theme='dark'\]\[data-palette='honey'\] \{([^}]*)\}/s)?.[1] ?? assert.fail('no dark honey');
  for (const token of ['--bg: #141a2e', '--bg-side: #0f1526', '--bg-soft: #171e33', '--bg-active: #2a3350', '--text: #c6ccd8', '--text-strong: #ffffff', '--text-faint: #8b93a8', '--ink: #ffffff'])
    assert.ok(darkHoney.includes(token), `dark honey ${token}`);
});
