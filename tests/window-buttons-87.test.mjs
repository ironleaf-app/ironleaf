// node --test tests/window-buttons-87.test.mjs — the window-buttons band (8.6.1, 31 Oct 2026): Windows' minimise /
// maximise / close sit over the page's top right, so the renderer keeps their band as CSS variables on the root
// (--wbtn-h, --wbtn-w: the overlay's own rect where Electron gives it, else the measured band and 138px at 100%
// scaled by the interface size) and every element at the top right starts below the band or leaves its width clear.
// The band's tint is the colour under it at that moment. macOS keeps its traffic lights at the left: nothing changes
// there. Fails without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

const work = mkdtempSync(path.join(tmpdir(), 'nv-wbtn-'));
let W;
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/windowButtons.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'w.mjs'), format: 'esm' }, logLevel: 'silent' });
  W = await import(pathToFileURL(path.join(work, 'w.mjs')).href);
  const prefsEntry = path.join(work, 'prefs.ts');
  writeFileSync(prefsEntry, `export { PALETTE_IDS } from ${JSON.stringify(path.join(root, 'src/shared/prefs.ts'))};\n`);
  await build({ input: prefsEntry, platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the buttons width scales with the interface size (about 138px at 100%)', () => {
  assert.equal(W.buttonsWidth(1), 138);
  assert.equal(W.buttonsWidth(1.5), 92);
  assert.equal(W.buttonsWidth(1.25), 111);
  assert.equal(W.buttonsWidth(0.8), 173);
  assert.equal(W.buttonsWidth('big'), 138);
  assert.equal(W.buttonsWidth(NaN), 138);
});

test('the band is CSS variables on the root, zero on a Mac', () => {
  const css = read('src/renderer/src/styles.css');
  assert.ok(css.includes('--wbtn-h:') && css.includes('--wbtn-w:'), 'defaults on :root');
  assert.ok(/\.app\[data-platform='darwin'\][^{]*\{[^}]*--wbtn-h:\s*0px[^}]*--wbtn-w:\s*0px/s.test(css), 'zero on a Mac');
  const lib = read('src/renderer/src/lib/windowButtons.ts');
  assert.ok(lib.includes('windowControlsOverlay') && lib.includes('getTitlebarAreaRect'), "the overlay's own rect where given");
  assert.ok(lib.includes('geometrychange'), 'follows the overlay moving');
});

test('guard: every top-right element starts below the band or leaves its width clear', () => {
  // [what, file, proof that its top or right uses the band variables]
  const elements = [
    ['the peek', 'src/renderer/src/styles/peek.css', '.peek', 'var(--wbtn-h'],
    ['the right drawer', 'src/renderer/src/styles/responsive.css', '.sidebar.right.is-drawer', 'var(--wbtn-h'],
    ['the side peek', 'src/renderer/src/styles/kit.css', '.vpeek', 'var(--wbtn-h'],
    ['the bands under the buttons', 'src/renderer/src/styles.css', '.controls-gap', 'var(--wbtn-w'],
    ['the file viewer', 'src/renderer/src/styles/project-page.css', '.pf-overlay {\n  align-items', 'var(--wbtn-h'],
  ];
  for (const [what, file, selector, vars] of elements) {
    const src = read(file);
    const at = src.indexOf(selector);
    assert.ok(at >= 0, `${what} (${file} has ${selector})`);
    assert.ok(src.indexOf(vars, at) >= 0 && src.indexOf(vars, at) - at < 4000, `${what} uses ${vars}`);
  }
  // (4 Nov 2026, p9-one-ask: the Ask answer card is gone, so its band offset went with it.)
  assert.ok(read('src/renderer/src/views/Workspace.tsx').includes('data-top-edge'), 'the top edge stays marked');
  // A drawer below the band needs no gap for the buttons; the docked side keeps it.
  const side = read('src/renderer/src/panels/Sidebars.tsx');
  assert.ok(side.includes("drawer ? '' : ' controls-gap'") || side.includes('drawer ? "" : " controls-gap"'), 'drawers drop the gap');
});

test('guard: every popup opened near the top clamps to the band', () => {
  const popups = [
    'src/renderer/src/components/Menu.tsx',
    'src/renderer/src/components/HoverPreview.tsx',
    'src/renderer/src/editor/reminders.ts',
    'src/renderer/src/editor/taskChips.ts',
    'src/renderer/src/views/pdf/PdfParts.tsx',
    'src/renderer/src/views/timeline/RowMarks.tsx',
    'src/renderer/src/editor/formatBar.ts',
    'src/renderer/src/views/workspace/recordParts.tsx',
  ];
  for (const file of popups) assert.ok(read(file).includes('minPopupTop'), `${file} clamps to the band`);
});

test('the band tint is the colour under it, in every look', () => {
  const app = read('src/renderer/src/App.tsx');
  assert.ok(app.includes('tintWindowButtons'), 'tints the buttons');
  assert.ok(app.includes('colourAt(window.innerWidth - 70, 12)'), 'reads what is under the buttons');
  assert.ok(app.includes('--bg-side') && app.includes('--text-muted'), 'falls back to the theme tokens');
  assert.ok(app.includes('measureBandHeight'), 'one band measurement for the tint and the variables');
  // Anything newly under the buttons re-tints: the sides, the peek, and whatever window opened over the page.
  assert.ok(/requestAnimationFrame\(tintWindowButtons\)/.test(app), 'tints after the look lands');
  assert.ok(app.includes('modal?.kind') && app.includes('usePeek'), 'a window or the peek re-tints');
  // Every palette carries the side colour the band falls back to (light, dark and all fourteen).
  const palettes = read('src/renderer/src/styles/palettes.css');
  assert.ok(P.PALETTE_IDS.length === 14, 'fourteen palettes');
  for (const id of P.PALETTE_IDS) {
    assert.ok(palettes.includes(`[data-palette='${id}']`), `${id} is drawn`);
    const at = palettes.indexOf(`[data-palette='${id}']`);
    assert.ok(palettes.indexOf('--bg-side:', at) >= 0 && palettes.indexOf('--bg-side:', at) - at < 3000, `${id} carries its side colour`);
  }
});

test('nothing a person sees starts above the band', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(/\.toast\s*\{[^}]*bottom:/s.test(kit), 'the toast stays at the foot');
  // Dialogs open below the band on the overlay's offset alone (8.8 round 2: the dialog's own 110px stacked on the
  // overlay's 12vh, pushing the template window's Start below the window at 1440x900): no margin of their own.
  assert.ok(/\.overlay\s*\{[^}]*padding-top:\s*12vh/s.test(read('src/renderer/src/styles.css')), 'dialogs open below the band');
  assert.ok(/\.dlg,\s*\.dialog\s*\{[^}]*margin-top:\s*0/s.test(kit), 'with no margin stacked on it');
  assert.ok(/\.smodal,\s*\.picker\s*\{[^}]*margin:\s*48px/s.test(kit), 'pickers open below the band');
  // The notebook and Settings draw their own bar as the band, so their columns start beneath it.
  assert.ok(read('src/renderer/src/views/NotebookView.tsx').includes('<ViewHeader'), 'the notebook keeps its bar');
  assert.ok(read('src/renderer/src/components/Settings.tsx').includes('<ViewHeader'), 'Settings keeps its bar');
  assert.ok(read('src/renderer/src/views/ViewHeader.tsx').includes("band?.right ? ' controls-gap'"), 'a bar at the right leaves the buttons room');
});

test('a lying overlay rect never balloons the band (Round 4: frozen at boot size, the search crushed to 240px)', () => {
  // The real window's rect froze at [0,960] while the window moved on: innerWidth minus the rect said 259px
  // at 1219 and 960px at 1920 for buttons that are physically 138px. The band trusts the rect only while it
  // stays near the physical truth; full screen (the whole width back) still counts as nothing.
  assert.equal(W.trustedButtonsWidth(null, 1219, 1), 138, 'no rect: the measured band');
  assert.equal(W.trustedButtonsWidth({ x: 0, y: 0, width: 1081, height: 44 }, 1219, 1), 138, 'a live rect stands');
  assert.equal(W.trustedButtonsWidth({ x: 0, y: 0, width: 960, height: 44 }, 1219, 1), 138, 'frozen at 1219 falls back');
  assert.equal(W.trustedButtonsWidth({ x: 0, y: 0, width: 960, height: 44 }, 1920, 1), 138, 'frozen at 1920 falls back');
  assert.equal(W.trustedButtonsWidth({ x: 0, y: 0, width: 1219, height: 44 }, 1219, 1), 0, 'full screen still counts as nothing');
  assert.equal(W.trustedButtonsWidth({ x: 0, y: 0, width: 960, height: 44 }, 1920, 1.25), 111, 'the fallback scales with the size');
  assert.ok(read('src/renderer/src/lib/windowButtons.ts').includes('trustedButtonsWidth(rect,'), 'the band reads the trusted width');
});

test('macOS keeps its traffic lights at the left: nothing changes there', () => {
  const main = read('src/main/app.ts');
  assert.ok(main.includes('trafficLightPosition'), 'the lights stay where they were');
  const css = read('src/renderer/src/styles.css');
  assert.ok(css.includes('.controls-gap-left'), 'the left gap stays');
  assert.ok(!/\.app\[data-platform='darwin'\][^{]*controls-gap[^}]*padding-right/s.test(css), 'no right gap on a Mac');
});
