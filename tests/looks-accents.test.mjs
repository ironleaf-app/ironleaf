// node --test tests/looks-accents.test.mjs — the looks and accents both apps offer (4 Nov 2026). One shared list,
// pinned here: fourteen looks and nineteen accents, same ids, names and order in Ironleaf and the former host
// app. Every look's words read on its page and side bar in light, dark reads whatever the look, every accent
// reads as words on every look (the sheet's own oklch clamp), a saved look or accent draws as itself with nothing
// remapped, and Settings shows the look picker directly above the accent picker with each choice a named swatch.
// Where this combined workspace has the former host app checkout beside it (../../ns), the former host app's
// lists are read live and must match; standalone checks the Vault against the pins. Fails without each change.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sparkRoot = path.join(root, '..', 'ns');
const sparkHere = existsSync(path.join(sparkRoot, 'src', 'appearance.cjs'));
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const readSpark = (f) => readFileSync(path.join(sparkRoot, f), 'utf8');

// The shared list, exactly as both apps offer it.
const LOOKS = [['honey', 'White'], ['bright', 'Bright'], ['sky', 'Sky'], ['mint', 'Mint'], ['lavender', 'Lavender'],
  ['blush', 'Blush'], ['sunny', 'Sunny'], ['paper', 'Paper'], ['ocean', 'Ocean'], ['lagoon', 'Lagoon'],
  ['forest', 'Forest'], ['rose', 'Rose'], ['cocoa', 'Cocoa'], ['dusk', 'Dusk']];
// 20 Nov 2026 (the rename to Ironleaf; approved the Ironleaf palette): Leaf first and the default; the shared
// nineteen follow unchanged (the former host app's own list is the former host app's to change).
const SHARED_ACCENTS = [['#f2785a', 'Coral'], ['#f08a1c', 'Tangerine'], ['#d9a400', 'Sunflower'],
  ['#22a35a', 'Green'], ['#0f9e94', 'Teal'], ['#2f6fed', 'Blue'], ['#5551e0', 'Indigo'], ['#8b4ee6', 'Violet'],
  ['#e0457f', 'Pink'], ['#b85a37', 'Clay'], ['#4f5b66', 'Slate'], ['#b02a37', 'Ruby'], ['#a34a24', 'Rust'],
  ['#a97e12', 'Gold'], ['#5f7f3d', 'Moss'], ['#1295b8', 'Aqua'], ['#2c4f8f', 'Navy'], ['#7d3f6e', 'Plum'],
  ['#3a4149', 'Charcoal']];
const ACCENTS = [['#357553', 'Leaf'], ...SHARED_ACCENTS];

const work = mkdtempSync(path.join(tmpdir(), 'nv-looks-accents-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'prefs.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/prefs.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'prefs.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'prefs.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the Vault offers the shared fourteen looks and nineteen accents, in order', () => {
  assert.deepEqual(P.PALETTES.map((p) => [p.id, p.name]), LOOKS);
  assert.deepEqual(P.PALETTE_IDS, LOOKS.map((l) => l[0]));
  assert.deepEqual(P.ACCENTS.map((a) => [a.value, a.name]), ACCENTS);
  assert.equal(P.DEFAULT_PREFS.palette, 'bright');
  assert.equal(P.DEFAULT_PREFS.accent, '#357553');
});

test('the host app offers exactly the same, read live where it sits beside this checkout', () => {
  if (!sparkHere) {
    assert.ok(true, 'no host checkout beside this one; the host app pins its own copy of the list');
    return;
  }
  const client = readSpark('native-runtime/plugins/desktop/client.js');
  const grab = (name) => new Function(`return (${client.split(`const ${name}=`)[1].split('];')[0]}]);`)();
  assert.deepEqual(grab('PALETTES').map((p) => [p[0], p[1]]), LOOKS, 'same fourteen looks, in order');
  assert.deepEqual(grab('ACCENTS'), SHARED_ACCENTS, 'same nineteen shared accents, in order');
  assert.ok(!/RETIRED_LOOK|KEPT_LOOK/.test(client), 'the host app remaps nothing');
});

test('a saved look or accent draws as itself; only unknown ids fall back', () => {
  for (const [id] of LOOKS) assert.equal(P.loadPrefs({ palette: id }).palette, id, `a PC that had ${id} opens ${id}`);
  assert.equal(P.loadPrefs({}).palette, 'bright');
  assert.equal(P.loadPrefs(undefined).palette, 'bright');
  assert.equal(P.mergePrefs(P.DEFAULT_PREFS, { palette: 'nope' }).palette, 'bright', 'an unknown look falls back to Bright');
  assert.equal(P.loadPrefs({ accent: '#e85d3f' }).accent, '#e85d3f', 'the older Coral stays as the person had it');
  assert.equal(P.loadPrefs({ accent: '#f2785a', accentLeaf: true }).accent, '#f2785a', 'the shared Coral, picked, stays too');
  assert.equal(P.loadPrefs({ accent: '#f2785a' }).accent, '#357553', 'the old default coral moves to the leaf once (the rename)');
  const prefs = read('src/shared/prefs.ts');
  assert.ok(!prefs.includes("palette === 'sunny'") && !prefs.includes("palette === 'paper'") && !prefs.includes("palette === 'blush'"), 'no look is migrated anywhere');
});

// Contrast: WCAG ratios on the sheet's own tokens.
const lin = (h) => [1, 3, 5].map((i) => {
  const v = parseInt(h.slice(i, i + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const lum = (h) => {
  const [r, g, b] = lin(h);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const token = (body, name) => body.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1] ?? assert.fail(`no ${name}`);
const palettes = read('src/renderer/src/styles/palettes.css');
const lightBlock = (id) => palettes.match(new RegExp(`\\[data-theme='light'\\]\\[data-palette='${id}'\\] \\{([^}]*)\\}`, 's'))?.[1] ?? assert.fail(`no ${id} block`);

test('every look paints its block, and its words read on its page and side bar', () => {
  for (const [id] of LOOKS) {
    const body = lightBlock(id);
    const page = token(body, '--bg'), side = token(body, '--bg-side');
    const text = token(body, '--text'), muted = token(body, '--text-muted'), faint = token(body, '--text-faint');
    for (const [fg, bg, need, words] of [[text, page, 7, 'words'], [muted, page, 4.5, 'muted words'], [text, side, 7, 'words on the side bar'], [muted, side, 4.5, 'muted words on the side bar'], [faint, page, 3, 'faint words']])
      assert.ok(ratio(fg, bg) >= need, `${id}: ${words} read (${ratio(fg, bg).toFixed(2)} on ${bg})`);
  }
});

test('each swatch draws its look’s true grounds', () => {
  for (const p of P.PALETTES) {
    const body = lightBlock(p.id);
    assert.deepEqual([p.page, p.side], [token(body, '--bg'), token(body, '--bg-side')], `${p.id} swatch draws its grounds`);
  }
});

test('dark reads whatever the look', () => {
  const base = read('src/renderer/src/styles.css');
  const dark = base.match(/:root\[data-theme='dark'\] \{([^}]*)\}/s)?.[1] ?? assert.fail('no dark :root');
  const page = token(dark, '--bg'), text = token(dark, '--text'), muted = token(dark, '--text-muted');
  assert.ok(ratio(text, page) >= 7, `dark words read (${ratio(text, page).toFixed(2)})`);
  assert.ok(ratio(muted, page) >= 4.5, `dark muted words read (${ratio(muted, page).toFixed(2)})`);
  const honeyDark = palettes.match(/\[data-theme='dark'\]\[data-palette='honey'\] \{([^}]*)\}/s)?.[1] ?? assert.fail('no honey dark');
  assert.ok(ratio(token(honeyDark, '--text'), token(honeyDark, '--bg')) >= 7, 'the dark look reads too');
});

// linear sRGB -> OKLab -> Oklch and back, gamut-clipped; browsers map the gamut instead, so this is
// approximate and the light bar sits at 3 (the worst pair computes at 3.3 with this sheet's clamp).
const toOklch = (h) => {
  const [r, g, b] = lin(h);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [L, Math.hypot(a, bb), Math.atan2(bb, a)];
};
const lumOklch = (L, C, h) => {
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const clip = (v) => Math.min(1, Math.max(0, v));
  return 0.2126 * clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
    + 0.7152 * clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
    + 0.0722 * clip(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
};

test('every accent reads as words on every look, light and dark', () => {
  assert.ok(palettes.includes('--accent-text: oklch(from var(--accent-base) min(l, 0.56) c h)'), 'light words in the accent clamp to a darkness that reads');
  assert.ok(palettes.includes('--accent-text: oklch(from var(--accent-dark, var(--accent-base)) max(l, 0.74) c h)'), 'dark words in the accent clamp to a lightness that reads');
  const grounds = [];
  for (const [id] of LOOKS) {
    const body = lightBlock(id);
    grounds.push([`${id} page`, token(body, '--bg')], [`${id} side`, token(body, '--bg-side')]);
  }
  let worst = 99, arg = '';
  for (const [hex] of ACCENTS) {
    const [L, C, h] = toOklch(hex), y = lumOklch(Math.min(L, 0.56), C, h);
    for (const [words, g] of grounds) {
      const r = (Math.max(y, lum(g)) + 0.05) / (Math.min(y, lum(g)) + 0.05);
      if (r < worst) { worst = r; arg = `${hex} on ${words}`; }
    }
  }
  assert.ok(worst >= 3, `every accent reads on every look (worst ${arg}: ${worst.toFixed(2)})`);
  const dark = read('src/renderer/src/styles.css').match(/:root\[data-theme='dark'\] \{([^}]*)\}/s)?.[1] ?? assert.fail('no dark :root');
  for (const ground of [token(dark, '--bg'), token(dark, '--bg-side'), token(dark, '--bg-raised')]) {
    for (const [hex] of ACCENTS) {
      const [L, C, h] = toOklch(hex), y = lumOklch(Math.max(L, 0.74), C, h);
      const r = (Math.max(y, lum(ground)) + 0.05) / (Math.min(y, lum(ground)) + 0.05);
      assert.ok(r >= 4.5, `${hex} reads on dark ${ground} (${r.toFixed(2)})`);
    }
  }
});

test('the look picker sits directly above the accent picker, each choice a named swatch', () => {
  const tsx = read('src/renderer/src/components/Settings.tsx');
  const lookAt = tsx.indexOf('function Look(');
  const coloursAt = tsx.indexOf('title="Colours"', lookAt), accentsAt = tsx.indexOf('title="Accent colour"', lookAt);
  assert.ok(coloursAt > 0 && accentsAt > coloursAt, 'Colours directly above Accent colour in Look');
  assert.ok(!tsx.slice(coloursAt, accentsAt).includes('<Row title='), 'nothing between the two pickers');
  assert.ok(/title="Colours"[^>]*stacked/.test(tsx) && /title="Accent colour"[^>]*stacked/.test(tsx), 'both pickers stack full-width, as in the host app');
  assert.ok(tsx.includes('className="palette-name"') && tsx.includes('className="accent-name"'), 'each look and each accent shows its name');
  assert.ok(tsx.includes('palette-swatch${prefs.palette === p.id') && tsx.includes('aria-checked={prefs.palette === p.id}'), 'the current look is marked');
  assert.ok(tsx.includes('accent-swatch${prefs.accent === a.value') && tsx.includes('aria-checked={prefs.accent === a.value}'), 'the current accent is marked');
  assert.ok(tsx.includes('onClick={() => set({ palette: p.id })}') && tsx.includes('onClick={() => set({ accent: a.value })}'), 'choosing previews at once');
});
