// node --test tests/kit-87.test.mjs — the one kit (8.7 wave 1, item 1): styles/kit.css carries every component from the
// mock-ups' shared.css (buttons, pills and the five status tints, cards, inputs, selects, toggles, tabs, segmented
// switches, menus, dialogs, toasts, tooltips, empty and loading states, rows, callouts), rebuilt on the app's theme
// tokens so palettes, the person's accent and dark mode keep working. Fails without each change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const kit = readFileSync(path.join(root, 'src/renderer/src/styles/kit.css'), 'utf8');

test('the kit defines every component family', () => {
  for (const sel of ['.btn', '.btn.pri', '.btn.quiet', '.iconbtn', '.pill', '.tag', '.minichip', '.cite', '.card', '.trow', '.check', '.input', '.select', '.searchbox', '.lbl', '.chips', '.chip', '.seg', '.kindtabs', '.tabs', '.tab', '.tbl', '.menu', '.dlg', '.dialog', '.toast', '.tip', '.smodal', '.picker', '.prow2', '.kbd', '.nv-empty', '.skel', '.switch', '.setrow', '.tog', '.callout', '.quote', '.props', '.prow', '.miniava', '.gtile', '.avatars', '.side', '.srow', '.slabel', '.rail', '.topbar', '.vpage', '.ask', '.boardwrap', '.bcard', '.cal', '.setwrap', '.packrow', '.frow', '.gantt', '.vtl', '.gal', '.stat'])
    assert.ok(kit.includes(sel), `kit defines ${sel}`);
});

test('the five status tints exist as pills, tags and inline callouts', () => {
  for (const tint of ['slate', 'green', 'amber', 'red', 'blue']) {
    assert.ok(kit.includes(`--${tint}-bg:`) && kit.includes(`--${tint}-tx:`), `tint tokens ${tint}`);
    assert.ok(kit.includes(`.${tint} {`), `tint class ${tint}`);
    assert.ok(kit.includes(`.callout.${tint}`), `callout tint ${tint}`);
  }
  // Dark keeps the tints as soft fills with readable words (the c-home-dark mock-up).
  assert.ok(kit.includes(":root[data-theme='dark']"), 'dark kit tokens');
});

test('kit surfaces use theme tokens, never fixed greys', () => {
  const rule = (sel) => kit.match(new RegExp(`\\${sel}[^{]*\\{([^}]*)\\}`, 's'))?.[1] ?? assert.fail(`no rule ${sel}`);
  assert.match(rule('.card'), /background: var\(--bg-raised\)/);
  assert.match(rule('.btn.pri'), /background: var\(--primary\)/);
  assert.match(rule('.srow.on'), /background: var\(--sel\)/);
  assert.match(rule('.toast'), /background: var\(--primary\)/);
  assert.match(rule('.side'), /background: var\(--bg\)/);
  assert.match(rule('.side'), /border-right: 1px solid var\(--border\)/);
  // Outside the token definitions, the only fixed colours are knockout white, the coral accent's fixed spots and
  // shadows: no fixed page, ink or line grey that would freeze a palette.
  const bodies = kit.replace(/:root[^{]*\{[^}]*\}/gs, '');
  for (const hex of bodies.match(/#[0-9a-f]{6}/gi) ?? []) {
    assert.ok(['#e85d3f', '#d93b2b', '#ffffff'].includes(hex.toLowerCase()), `kit body ${hex} is a fixed grey`);
  }
});

test('no cream, beige or warm off-white in the kit or the default palette', () => {
  // A light colour whose red is clearly above its blue, outside the five status tints (amber is a tint, not a surface).
  const warm = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return Math.min(r, g, b) >= 190 && r - b >= 8;
  };
  const kitSurfaces = kit.replace(/--(slate|green|amber|red|blue)-(bg|tx): #[0-9a-f]{6};?/gi, '');
  for (const hex of kitSurfaces.match(/#[0-9a-f]{6}/gi) ?? []) assert.ok(!warm(hex), `kit ${hex} is a warm off-white`);
  const palettes = readFileSync(path.join(root, 'src/renderer/src/styles/palettes.css'), 'utf8');
  for (const m of palettes.matchAll(/\[data-palette='honey'\][^{]*\{([^}]*)\}/gs))
    for (const hex of m[1].match(/#[0-9a-f]{6}/gi) ?? []) assert.ok(!warm(hex), `honey ${hex} is a warm off-white`);
});

test('the kit loads last, so its word holds on ties', () => {
  const main = readFileSync(path.join(root, 'src/renderer/src/main.tsx'), 'utf8');
  const at = main.indexOf("styles/kit.css");
  assert.ok(at > 0, 'main.tsx imports kit.css');
  // After it only the layout sheets that answer the gate and the width system: t300's grids and room-frames
  // (each room on --w-content / --w-wide, 20 Nov 2026), which set no control's look.
  // compose.css (layout round 2, 20 Nov 2026: composition, balanced columns, controls sized, inner padding) is a
  // layout sheet too, and so is panes.css (layout round 3: list and detail as full-window panes).
  assert.ok(!main.slice(at + 1).replace('styles/t300-no-holes.css', '').replace('styles/room-frames.css', '').replace('styles/compose.css', '').replace('styles/panes.css', '').includes("styles/"), 'kit.css is the last stylesheet (only the layout sheets after it)');
  for (const sheet of ['room-frames.css', 'compose.css'])
    assert.ok(!/\.(btn|button|chip|seg)\b[^{]*\{[^}]*(background|color|border-radius)/.test(readFileSync(path.join(root, 'src/renderer/src/styles', sheet), 'utf8')), `${sheet} never restyles a control`);
});

test('one primary button per screen on the wave-1 screens', () => {
  // A screen with two navy primaries fails the spec ("One primary button per screen"); the one start to the day
  // (10.0: Home and Today merged) keeps none in its header — the bar holds the one main action — and Change Home
  // keeps its own (never shown together).
  const start = readFileSync(path.join(root, 'src/renderer/src/views/TodayView.tsx'), 'utf8');
  const head = start.split('<ViewHeader')[1].split('</ViewHeader>')[0];
  assert.equal((head.match(/btn pri|button primary/g) ?? []).length, 0, 'the one page keeps no primary in its header: the bar holds it');
  const home = readFileSync(path.join(root, 'src/renderer/src/views/HomeView.tsx'), 'utf8');
  // The Change Home dialog only (to its closing brace): later screens in the file keep their own primaries.
  const dialog = home.match(/function ChangeHome[\s\S]*?\n}\n/)?.[0] ?? assert.fail('no ChangeHome dialog');
  assert.equal((dialog.match(/btn pri|button primary/g) ?? []).length, 1, 'Change Home keeps one primary');
  const places = readFileSync(path.join(root, 'src/renderer/src/panels/Places.tsx'), 'utf8');
  // (10.0 Endless Tech: the bar keeps exactly one primary, the space's main action under the brand row.)
  assert.equal((places.match(/btn pri|button primary/g) ?? []).length, 1, 'the bar keeps exactly one primary');
  assert.ok(places.includes('places-action'), 'the one primary is the main action');
});

test('a row’s trailing words keep one line, never squeezed (p14-words; p16: scoped to the project page)', () => {
  const shared = /^\.trow \.meta \{([^}]*)\}/m.exec(kit);
  assert.ok(shared, '.trow .meta stays the one shared rule');
  assert.doesNotMatch(shared[1], /white-space:\s*nowrap/, 'module and note rows keep their own wrapping');
  assert.doesNotMatch(shared[1], /flex:\s*none/, 'module and note rows keep their own shrink');
  const scoped = /\.pj-folio \.trow \.meta \{([^}]*)\}/.exec(kit);
  assert.ok(scoped, 'the folio keeps its own rule');
  assert.match(scoped[1], /white-space:\s*nowrap/, 'the folio meta never wraps');
  assert.match(scoped[1], /flex:\s*none/, 'the folio meta never shrinks');
  const folio = readFileSync(path.join(root, 'src/renderer/src/views/ProjectPage.tsx'), 'utf8');
  assert.ok(/<div className="[^"]*\bpj-folio\b[^"]*">/.test(folio), 'the folio wears the scope');
});
