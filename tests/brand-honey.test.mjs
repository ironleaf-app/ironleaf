// node --test tests/brand-honey.test.mjs — Ironleaf wears Bright (8.1, 29 Oct 2026; 3 Nov 2026, DECISIONS 3: the
// default look is called Bright; 4 Nov 2026: the same fourteen looks and nineteen accents as the former host app):
// Bright the default (bright, not cream, 20 Oct 2026), the shared coral gem as the accent, the Vault icon and
// side-bar mark (the old N must not come back), and Geist bundled locally with page titles in Geist 600. Fails
// without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-brand-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'prefs.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/prefs.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'prefs.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'prefs.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('Bright is the default, White first, with Ironleaf\'s leaf as the accent (coral still offered)', () => {
  assert.equal(P.PALETTES[0].id, 'honey');
  assert.equal(P.PALETTES[0].name, 'White');
  assert.deepEqual([P.PALETTES[0].page, P.PALETTES[0].side], ['#ffffff', '#f2f4f7']);
  assert.equal(P.PALETTES[1].id, 'bright');
  assert.equal(P.PALETTES[1].name, 'Bright');
  assert.equal(P.DEFAULT_PREFS.palette, 'bright');
  // 20 Nov 2026 (the rename to Ironleaf; approved the Ironleaf palette): the leaf is the default, coral stays offered.
  assert.equal(P.DEFAULT_PREFS.accent, '#357553');
  assert.equal(P.ACCENTS[0].value, '#357553');
  assert.equal(P.ACCENTS[0].name, 'Leaf');
  assert.ok(P.ACCENTS.some((a) => a.name === 'Coral' && a.value === '#f2785a'), 'coral can still be picked');
  assert.ok(P.PALETTE_IDS.includes('sky') && P.PALETTE_IDS.includes('mint') && P.PALETTE_IDS.includes('lavender'), 'the other palettes stay');
  assert.ok(P.PALETTE_IDS.includes('sunny') && P.PALETTE_IDS.includes('paper') && P.PALETTE_IDS.includes('blush'), 'sunny, paper and blush are offered again, as themselves');
});

test('the old default coral moves to the leaf once; a coral picked after that, and any other colour, stays', () => {
  assert.equal(P.loadPrefs({ palette: 'bright', accent: '#f2785a' }).accent, '#357553', 'kept with the old default');
  assert.equal(P.loadPrefs({ palette: 'bright', accent: '#f2785a', accentLeaf: true }).accent, '#f2785a', 'coral chosen after the move');
  assert.equal(P.loadPrefs({ palette: 'bright', accent: '#2f6fed' }).accent, '#2f6fed', 'a picked blue');
  assert.equal(P.loadPrefs({ palette: 'bright', accent: '#f2785a' }).accentLeaf, true);
});

test('someone who never chose a look gets Bright; a chosen look is kept', () => {
  assert.equal(P.loadPrefs(undefined).palette, 'bright');
  assert.equal(P.loadPrefs({}).palette, 'bright');
  assert.equal(P.loadPrefs({ palette: 'sky' }).palette, 'sky');
  assert.equal(P.mergePrefs(P.DEFAULT_PREFS, { palette: 'nope' }).palette, 'bright');
  assert.equal(P.loadPrefs({ palette: 'sunny' }).palette, 'sunny', 'a stored sunny stays sunny');
  assert.equal(P.loadPrefs({ palette: 'paper' }).palette, 'paper', 'a stored paper stays paper');
  assert.equal(P.loadPrefs({ palette: 'blush' }).palette, 'blush', 'a stored blush stays blush');
});

test('the White tokens are bright in Light and on the brand navy in Dark', () => {
  const css = read('src/renderer/src/styles/palettes.css');
  const light = css.match(/\[data-palette='honey'\] \{([^}]*)\}/s)?.[1] ?? '';
  for (const token of ['--bg: #ffffff', '--bg-side: #f2f4f7', '--bg-soft: #f6f8fa', '--bg-raised: #ffffff', '--bg-hover: #e8edf2', '--bg-active: #e3eaf3', '--border: #e2e7ee', '--border-strong: #ccd4df', '--sel: #e3eaf3', '--text: #3d4356', '--text-strong: #141a2e', '--text-muted: #565e70', '--text-faint: #7a8191', '--ink: #141a2e', '--primary: #1b2235', '--on-primary: #ffffff'])
    assert.ok(light.includes(token), `light White ${token}`);
  assert.ok(!light.includes('#fff7e2'), 'never the dull cream page');
  // No warm off-white comes back in the default light palette (30 Oct 2026): a light colour whose red is
  // clearly above its blue fails here.
  for (const hex of light.match(/#[0-9a-f]{6}/gi) ?? []) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    assert.ok(!(Math.min(r, g, b) >= 190 && r - b >= 8), `light White ${hex} is a warm off-white`);
  }
  const dark = css.match(/\[data-theme='dark'\]\[data-palette='honey'\] \{([^}]*)\}/s)?.[1] ?? '';
  assert.ok(dark.includes('--bg: #141a2e'), 'dark White sits on the brand navy');
  assert.ok(dark.includes('--bg-raised: #1b2235') && dark.includes('--text: #c6ccd8') && dark.includes('--text-strong: #ffffff'), 'dark White is finished, not a stub');
});

test('the old marks are gone and the Ironleaf mark is in its place', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(path.join(root, 'src')).filter((f) => /\.(tsx?|css)$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes('M160 352V160') && !text.toLowerCase().includes('#c9a55f') && !text.includes('M20 45 V19'), `${path.relative(root, file)}: the old N is gone`);
  }
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(places.includes('#7CC197') && places.includes('#1C2026') && !places.includes('#F27A55') && !places.includes('#F7E8C3'), 'the side bar draws the Ironleaf leaf on the iron tile (20 Nov 2026), not the old book');
  assert.ok(read('src/renderer/src/assets/sub-vault-flat.svg').includes('#F27A55'), 'the flat Vault drawing is kept in source');
});

test('the app and window icons are the Ironleaf icon', () => {
  const png = readFileSync(path.join(root, 'resources/icon.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [512, 512], 'the window icon is the 512 Vault drawing');
  const ico = readFileSync(path.join(root, 'resources/icon.ico'));
  assert.equal(ico.readUInt16LE(2), 1, 'an ICO file');
  const sizes = [...Array(ico.readUInt16LE(4))].map((_, i) => ico[6 + i * 16] || 256);
  assert.ok(sizes.includes(16) && sizes.includes(32) && sizes.includes(256), `the ICO holds 16, 32 and 256 (got ${sizes})`);
});

test('Geist is bundled locally and page titles use it at 650, tight', () => {
  for (const f of ['src/renderer/src/assets/fonts/geist-latin.woff2', 'src/renderer/src/assets/fonts/geist-mono-latin.woff2', 'src/renderer/src/assets/fonts/Geist-OFL.txt'])
    assert.ok(statSync(path.join(root, f)).size > 1000, `${f}: bundled`);
  const css = read('src/renderer/src/styles.css');
  assert.ok(css.includes("font-family: 'Geist'") && css.includes('geist-latin.woff2'), 'Geist is the interface font');
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(css), 'never a web font');
  const title = read('src/renderer/src/styles/page-frame.css').match(/h1\.nv-page-title[^{]*\{([^}]*)\}/s)?.[1] ?? '';
  assert.ok(title.includes('650') && title.includes('var(--font-ui)') && title.includes('-0.02em'), 'page titles: Geist 650, tight');
  assert.ok(!title.includes('var(--font-display)'), 'page titles: not the serif');
  assert.ok(read('src/renderer/src/styles/today.css').includes('650 var(--fs-page)/1.15 var(--font-ui)'), "Today's title: Geist 650 too");
});
