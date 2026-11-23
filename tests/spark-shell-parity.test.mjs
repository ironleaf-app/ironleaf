// node --test tests/spark-shell-parity.test.mjs — Vault's shell is the former host app's shell (4 Nov
// 2026 polish: ). Every shared value is read from both sides' stylesheets and must match: tokens first,
// then the rail, lens switch, primary button, rail foot, header, search, menus, dialogs, toasts,
// tooltips, empty states, keyboard hints, focus rings, buttons, fields and page type. Where this combined
// workspace has the former host app checkout beside it (../../ns), the former host app's values are read
// live and the pinned copies below are checked against it, so the pins cannot go stale silently;
// standalone (no ns/) checks Vault against the pins. Each failure names the former host app source to
// read. Fails without each fix.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cssPxFor } from './css-px.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sparkRoot = path.join(root, '..', 'ns');
const sparkHere = existsSync(path.join(sparkRoot, 'native-runtime', 'plugins', 'desktop', 'theme.css'));
const read = (f) => cssPxFor(f, readFileSync(path.join(root, f), 'utf8'));
const readSpark = (f) => readFileSync(path.join(sparkRoot, f), 'utf8');
const vault = {
  base: read('src/renderer/src/styles.css'),
  palettes: read('src/renderer/src/styles/palettes.css'),
  kit: read('src/renderer/src/styles/kit.css'),
  feel: read('src/renderer/src/styles/feel.css'),
  menu: read('src/renderer/src/components/Menu.tsx'),
  bell: read('src/renderer/src/panels/NoticeBell.tsx'),
};
const spark = sparkHere
  ? {
      theme: readSpark('native-runtime/plugins/desktop/theme.css'),
      look: readSpark('native-runtime/plugins/desktop/look.css'),
      shell: readSpark('native-runtime/plugins/desktop/shell.css'),
      choices: readSpark('native-runtime/plugins/desktop/choices.css'),
      host: readSpark('native-runtime/plugins/desktop/host.mjs'),
    }
  : null;

// A token's value out of a stylesheet (first match of `--name: value;`).
const token = (css, name) => css.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim() ?? assert.fail(`no ${name}`);
const flat = (s) => s.replace(/\s+/g, ' ').trim();

test('shared tokens match the host app live, or the pinned host values', () => {
  // [label, vault file, vault token, spark file, spark token, pinned the former host app value +
  // source]
  const pairs = [
    ['rail width', 'base', '--rail-w', 'theme', '--ns-rail', '292px'],
    ['control radius', 'base', '--r-2', 'theme', '--ns-radius-control', '6px'],
    ['menu radius', 'base', '--r-3', 'theme', '--ns-radius-md', '8px'],
    ['dialog radius', 'base', '--r-4', 'theme', '--ns-radius-hero', '10px'],
    ['selected fill', 'kit', '--sel', 'theme', '--ns-selected', '#e3eaf3'],
    ['rail active', 'kit', '--sel', 'look', '--ns-forest-active', '#e3eaf3'],
    ['rail hover', 'base', '--bg-side', 'look', '--ns-forest-hover', '#f2f4f7'],
    ['coral accent', 'kit', '--coral', 'look', '--ns-coral', '#f2785a'],
    ['scroll thumb', 'base', '--scroll', 'look', '--ns-scroll', '#d3d9e2'],
    ['scroll hover', 'base', '--scroll-hover', 'look', '--ns-scroll-hover', '#b8c0cc'],
    ['rail ink', 'base', '--rail-ink', 'look', '--ns-forest-ink', '#1b2235'],
    ['rail muted', 'base', '--rail-muted', 'look', '--ns-forest-muted', '#4d5468'],
    ['rail faint', 'base', '--rail-faint', 'look', '--ns-forest-faint', '#5f6779'],
    ['caption text', 'base', '--text-caption', 'look', '--ns-caption', '#5f6779'],
    ['ink text', 'base', '--text-ink', 'theme', '--ns-ink', '#1b2235'],
    ['primary', 'base', '--primary', 'look', '--ns-primary', '#1b2235'],
  ];
  // The brand colours are Ironleaf's own since the rename (20 Nov 2026; ironleaf-brand (the brand kit, kept outside this
  // repository)/palette.md), not the former host app's.
  assert.equal(token(vault.base, '--focus'), '#2c6347', 'focus ring: leaf-700');
  for (const [label, vf, vt, sf, st, pinned] of pairs) {
    const v = token(vault[vf], vt);
    if (spark) assert.equal(v, token(spark[sf], st), `${label}: Vault ${vt}=${v}, the host app ${st} differs`);
    else assert.equal(v, pinned, `${label}: Vault ${vt}=${v}, pinned the host app ${pinned} differs`);
  }
  if (spark) {
    // The pins above stay honest: the former host app's own values still read as pinned.
    const pins = [
      ['theme', '--ns-rail', '292px'], ['theme', '--ns-selected', '#e3eaf3'],
      ['look', '--ns-coral', '#f2785a'], ['look', '--ns-scroll', '#d3d9e2'],
      ['look', '--ns-forest-ink', '#1b2235'], ['look', '--ns-caption', '#5f6779'],
    ];
    for (const [sf, st, pinned] of pins) assert.equal(token(spark[sf], st), pinned, `pinned the host app ${st} went stale`);
  }
});

test('shadows match the host app live, or the pinned host shapes', () => {
  const v2 = flat(token(vault.base, '--e-2'));
  const v3 = flat(token(vault.base, '--e-3'));
  assert.ok(v2.includes('0 8px 24px -12px') && v2.includes('16%'), `menu shadow is the host app's double lift, got ${v2}`);
  assert.ok(v3.includes('0 2px 6px') && v3.includes('0 20px 50px -12px'), `dialog shadow is the host app's double lift, got ${v3}`);
  if (spark) {
    const nospace = (s) => s.replace(/\s+/g, '');
    assert.equal(nospace(v2).replace(/var\(--text-strong\)/g, '#141a2e'), nospace(token(spark.theme, '--ns-shadow-2')).replace(/var\(--ns-ink-strong\)/g, '#141a2e'), 'menu shadow equals --ns-shadow-2');
    assert.equal(nospace(v3).replace(/var\(--text-strong\)/g, '#141a2e'), nospace(token(spark.theme, '--ns-shadow-3')).replace(/var\(--ns-ink-strong\)/g, '#141a2e'), 'dialog shadow equals --ns-shadow-3');
  }
});

test('header renders the host app\'s 57px conversation bar', () => {
  assert.equal(token(vault.base, '--header-h'), '56px', '56px + the 1px hairline = 57px');
  assert.ok(/\.topbar \{[^}]*min-height: var\(--header-h\)/s.test(vault.kit), 'the bar reads the token');
  assert.ok(/\.topbar \{[^}]*padding: 8px 20px/s.test(vault.kit), '20px sides, the bar\'s own inset');
  if (spark) {
    assert.ok(/\.wSkVaW_header\.wSkVaW_header:not\(\.wSkVaW_headerBlank\)\{min-height:44px;padding-top:6px;padding-bottom:6px;border-bottom:1px solid/.test(spark.look), 'the host app bar still 44+6+6+1');
  }
});

test('rail, lens, primary button and foot match the host app', () => {
  const kit = vault.kit;
  assert.ok(/\.side \{[^}]*padding: 10px 14px 6px/s.test(kit), 'rail inset 10/14/6');
  assert.ok(/\.srow \{[^}]*color: var\(--rail-ink\)/s.test(kit), 'row words rail ink');
  assert.ok(/\.srow:not\(\.on\):hover[^{]*\{ background: var\(--bg-side\)/.test(kit), 'row hover solid mist');
  assert.ok(/\.srow:focus-visible \{ outline-color: var\(--coral\) !important; \}/.test(kit), 'rail focus stays coral');
  assert.ok(/\.srow \.n \{[^}]*color: var\(--rail-muted\)/s.test(kit), 'counts rail muted');
  assert.ok(/\.slabel \{[^}]*color: var\(--rail-faint\)/s.test(kit), 'section heads rail faint');
  assert.ok(/\.lens-option \{[^}]*font-size: var\(--fs-caption\)/s.test(vault.base), 'lens words 12px');
  // 20 Nov 2026: the foot's Settings row went into the account menu (tests/account-menu.test.mjs).
  assert.ok(!/\.places-settings \{/.test(kit), 'no foot Settings row');
  assert.ok(/\.places-name \{[^}]*color: var\(--rail-ink\)/s.test(kit), 'foot name rail ink');
  assert.ok(/\.places-sub \{[^}]*color: var\(--rail-faint\)/s.test(kit), 'foot plan rail faint');
  assert.ok(/\.places-ava, \.acct-ava\.is-in \{\s*width: 30px; height: 30px; border-radius: 50%; background: var\(--coral\)/s.test(kit), 'the account avatar a 30px coral circle');
  assert.ok(/\.places-bell \{[^}]*border-radius: var\(--r-3\)/s.test(vault.base), 'bell radius 8');
  assert.ok(/\.places-bell-count \{[^}]*background: var\(--primary\)/s.test(vault.base), 'count badge navy');
  assert.ok(vault.bell.includes('<Icon name="bell" size={17}'), 'bell glyph 17px');
});

test('search, key cap and header buttons match the host app', () => {
  const kit = vault.kit;
  assert.ok(/\.top-search \{[^}]*width: 100%; max-width: 520px/s.test(kit), 'one 520px-max bar filling the grid middle (Round 5: the track sizes it, 360px to 520px)');
  assert.ok(/\.top-search \{[^}]*color: var\(--text-caption\)/s.test(kit), 'search words caption');
  assert.ok(/\.top-search kbd \{[^}]*font: 500 var\(--fs-xs\)\/16px var\(--font-ui\)/s.test(kit), 'key cap 500 11/16 sans');
  assert.ok(/\.top-search kbd \{[^}]*background: var\(--bg-raised\); border: 1px solid var\(--border-strong\); border-radius: var\(--r-1\)/s.test(kit), 'key cap white, strong edge, r4');
  assert.ok(/\.topbar \.navbtn \{[^}]*border-radius: var\(--r-3\)/s.test(kit), 'header buttons r8');
  if (spark) {
    assert.ok(/\.ns-room-search\{[^}]*max-width:520px[^}]*padding:var\(--ns-space-2,8px\) var\(--ns-space-3,12px\)[^}]*background:var\(--ns-mist\)/s.test(spark.look), 'the host app search still 520 mist');
    assert.ok(/\.ns-room-search-key\{[^}]*font:500 var\(--ns-text-xs\)\/16px[^}]*border-radius:var\(--ns-radius-sm\)[^}]*background:var\(--ns-surface\)/s.test(spark.look), 'the host app key still 500 11/16 white r4');
  }
});

test('menus match the host app’s measures and behaviour', () => {
  const kit = vault.kit;
  assert.ok(/\.menu \{[^}]*min-width: 218px/s.test(kit), 'menu min 218px');
  const rows = kit.match(/\.menu > button, \.menu \.menu-row \{([^}]*)\}/s)?.[1] ?? assert.fail('no menu rows');
  // Design language (23 Nov 2026): rows at a desktop menu's 32px with 4/8 insets on the scale (the 40px rows read
  // loose and pushed More past a 1000px window); a group's heading is a 600 label over its rows. Type and ink stay.
  for (const bit of ['min-height: 32px', 'font-size: var(--fs-md)', 'line-height: 22px', 'font-weight: 400', 'color: var(--text-ink)', 'padding: 4px 8px', 'gap: 8px', 'border-radius: var(--r-2)']) assert.ok(rows.includes(bit), `menu rows ${bit}`);
  const head = kit.match(/\.menu \.mlab, \.menu \.menu-heading \{([^}]*)\}/)?.[1] ?? assert.fail('no menu headings');
  for (const bit of ['font-weight: 600', 'color: var(--text-muted)', 'padding: 8px 8px 4px']) assert.ok(head.includes(bit), `menu headings ${bit}`);
  assert.ok(/\.menu \.msep, \.menu \.menu-separator \{[^}]*margin: 4px 2px/s.test(kit), 'separators 4/2');
  assert.ok(vault.menu.includes('size={16}'), 'menu glyphs 16px');
  assert.ok(vault.menu.includes("e.key === 'Home'") && vault.menu.includes("e.key === 'End'"), 'Home/End move');
  assert.ok(vault.menu.includes("e.key === 'Tab'"), 'Tab out shuts the menu');
  assert.ok(vault.menu.includes('closeMenu(true)'), 'Escape and Enter hand focus back');
  if (spark) {
    assert.ok(/button\[role=menuitem\]\[class\*=\"_item_\"\]/.test(spark.shell) && /min-height:40px/.test(spark.shell), 'the host app rows still 40px');
  }
});

test('buttons, fields, labels and page type match the host app', () => {
  const kit = vault.kit;
  assert.ok(/\.btn\.quiet, \.button\.quiet \{[^}]*font-weight: 500/s.test(kit), 'quiet buttons 500');
  const fields = kit.match(/\.input, \.select, \.text-input \{([^}]*)\}/s)?.[1] ?? assert.fail('no fields');
  for (const bit of ['height: 36px', 'border-radius: var(--r-1)', 'font-size: var(--fs-md)', 'color: var(--text-ink)']) assert.ok(fields.includes(bit), `fields ${bit}`);
  assert.ok(/select:not\(\[multiple\]\) \{\s*-webkit-appearance: none;\s*appearance: none;\s*min-height: 36px/s.test(vault.base), 'every select 36px');
  assert.ok(/\.lbl \{[^}]*font-weight: 500; color: var\(--text\)/s.test(kit), 'labels 500 ink-2');
  assert.ok(/h1\.vtitle \{[^}]*font-weight: 600; letter-spacing: -0\.025em; line-height: 44px/s.test(kit), 'page titles 600 38/44');
  assert.ok(/\.vsub \{[^}]*font-size: var\(--fs-reading\); line-height: 26px/s.test(kit), 'subtitles reading size');
  if (spark) {
    assert.ok(/min-height:36px/.test(spark.choices), 'the host app controls still 36px');
    assert.ok(/\.ns-net-fields input\{height:36px/.test(spark.shell), 'the host app text fields still 36px');
  }
});

test('dialogs match the host app\'s one confirm', () => {
  const kit = vault.kit;
  assert.ok(/\.dialog\.small \{ width: 440px; \}/.test(kit), 'the small dialog is the confirm width');
  const smallH2 = kit.match(/\.dialog\.small h2 \{([^}]*)\}/s)?.[1] ?? assert.fail('no small dialog title');
  // (suite-green, 4 Nov 2026: the title reads the scale's nearest step to the former host app's 16 — a
  // bare 16px sat off the scale, and every size rides the tokens (endless-shape); the parity is the 440
  // width, 24 line, 600 weight and actions 20 down, all still pinned here.)
  for (const bit of ['font-size: var(--fs-reading)', 'line-height: 24px', 'font-weight: 600', 'color: var(--text-strong)']) assert.ok(smallH2.includes(bit), `confirm titles ${bit}`);
  assert.ok(/\.dlg h2, \.dialog h2 \{ font-size: var\(--fs-section\)/.test(kit), 'big dialogs keep the 20px title');
  // Design language (23 Nov 2026): the actions sit one group step (24px) under the words, on the scale, and the dim
  // is the palette's own --overlay role (the host app's navy at .24 in light, a deeper dim in dark), never a literal.
  assert.ok(/\.dialog-actions \{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; justify-content: flex-end; \}/.test(kit), 'actions sit 24px under the words');
  assert.ok(/\.dlgback, \.overlay \{\s*position: fixed; inset: 0; background: var\(--overlay\);/.test(kit), 'one dim, the palette\'s overlay');
  if (spark) {
    assert.ok(/dialog\.ns-kit-confirm\{[^}]*width:min\(440px,calc\(100vw - 32px\)\)[^}]*padding:var\(--ns-space-6,24px\) var\(--ns-space-6,24px\) var\(--ns-space-5,20px\)/s.test(spark.look), 'the host app confirm still 440 with 24/24/20');
    assert.ok(/dialog\.ns-kit-confirm::backdrop\{background:rgba\(20,26,46,\.28\)\}/.test(spark.look), 'the host app dim still .28');
    assert.ok(/\.ns-kit-confirm-title\.ns-kit-confirm-title\{[^}]*font:600 var\(--ns-text-lg\)\/24px/s.test(spark.look), 'the host app confirm title still 600 16/24');
    assert.ok(/\.ns-kit-confirm-actions\{[^}]*margin-top:var\(--ns-space-5,20px\)/s.test(spark.look), 'the host app confirm actions still 20 down');
    assert.ok(/\.ns-kit-confirm-actions\{[^}]*flex-wrap:wrap/s.test(spark.look), 'the host app confirm actions wrap too (t207 parity)');
  }
});

test('toasts match the host app\'s 8px cards', () => {
  const kit = vault.kit;
  assert.ok(/\.toast \{[^}]*border-radius: var\(--r-3\)/s.test(kit), 'toasts round 8px');
  assert.ok(/\.toast \{[^}]*background: var\(--primary\); color: var\(--on-primary\)/s.test(kit), 'toasts stay navy with pale words');
  if (spark) {
    assert.ok(/\[class\*=\"_toast_\"\]\[role\]\{border-radius:var\(--ns-radius-md\)/.test(spark.shell), 'the host app toasts still 8px cards');
  }
});

test('tooltips match the host app\'s 8px bubble', () => {
  const kit = vault.kit;
  assert.ok(/\.tip \{[^}]*border-radius: var\(--r-3\)/s.test(kit), 'tips round 8px');
  assert.ok(/\.tip \{[^}]*background: var\(--primary\); color: var\(--on-primary\)/s.test(kit), 'tips stay navy with pale words');
  if (spark) {
    assert.ok(spark.shell.includes('Tooltips: 8px bubble'), 'the host app still calls its bubble 8px');
    assert.ok(/\[class\*=\"_bubble_\"\]\[class\*=\"_bubble_\"\]\[data-has-shortcut\]\{padding:3px 7px\}/.test(spark.shell), 'the host app bubble rule still there');
  }
});

test('empty states match the host app\'s empty place', () => {
  const kit = vault.kit;
  const feel = vault.feel;
  assert.ok(/\.nv-empty \{ text-align: center; padding: 36px 22px 32px; max-width: 340px; margin: 0 auto; \}/.test(kit), 'kit padding 36/22/32');
  assert.ok(/\.nv-empty \{[^}]*padding: 36px 22px 32px;/s.test(feel), 'feel agrees, so the two never drift');
  const title = kit.match(/\.nv-empty \.nv-empty-title \{([^}]*)\}/s)?.[1] ?? assert.fail('no kit empty title');
  for (const bit of ['font-size: var(--fs-md)', 'font-weight: 600', 'color: var(--text-ink)', 'margin: 0;']) assert.ok(title.includes(bit), `empty titles ${bit}`);
  assert.ok(/\.nv-empty \.nv-empty-title \{[^}]*font: 600 var\(--fs-md\)\/20px var\(--font-ui\)/s.test(feel), 'feel sets 600 14/20');
  assert.ok(/\.nv-empty \.nv-empty-line \{ font-size: var\(--fs-small\); color: var\(--text-muted\); margin: 0; \}/.test(kit), 'the line carries no bottom margin (the actions bring their own)');
  if (spark) {
    assert.ok(/\.ns-empty-state\{[^}]*padding:36px 22px var\(--ns-space-8,32px\);max-width:340px/s.test(spark.look), 'the host app empty still 36/22/32 over 340');
    assert.ok(/\.ns-empty-state-title\{[^}]*font:600 var\(--ns-text-md\)\/20px/s.test(spark.look), 'the host app empty title still 600 14/20');
    assert.ok(/\.ns-empty-state-line\{[^}]*font:400 var\(--ns-text-base\)\/19px/s.test(spark.look), 'the host app empty line still 400 13/19');
  }
});

test('keyboard hints match the host app\'s key caps', () => {
  const kit = vault.kit;
  const kbd = kit.match(/\.kbd, kbd \{([^}]*)\}/s)?.[1] ?? assert.fail('no kbd rule');
  for (const bit of ['font-size: var(--fs-xs)', 'border-radius: var(--r-1)', 'font-family: var(--font-mono)']) assert.ok(kbd.includes(bit), `key caps ${bit} (mono stays: the host app keys its approvals in mono too)`);
  assert.ok(/\.topbar \.top-search kbd \{[^}]*border-radius: var\(--r-1\)/s.test(kit), 'the search key agrees at 4px');
  if (spark) {
    assert.ok(/\.ns-cmdk kbd\{[^}]*border-radius:var\(--ns-radius-sm\)[^}]*font:500 var\(--ns-text-xs\)\/1/s.test(spark.look), 'the host app palette keys still 4px 500 11');
    assert.ok(/\.ns-ghost kbd\{[^}]*border-radius:var\(--ns-radius-sm\)[^}]*font:500 var\(--ns-text-xs\)\/16px/s.test(spark.look), 'the host app ghost keys still 4px 500 11/16');
  }
});

test('focus rings are a fixed Focus, never the accent (Ironleaf\'s leaf-700 and leaf-300 since the rename)', () => {
  const feel = vault.feel;
  assert.ok(/--focus-ring: var\(--focus\);/.test(feel), 'the ring alias points at Focus');
  assert.ok(!/--focus-ring: var\(--accent\)/.test(feel), 'the accent-pointed alias is gone');
  const kit = vault.kit;
  assert.ok(/:root \{[\s\S]*?--coral: #f2785a;[\s\S]*?--focus-ring: #2c6347;/s.test(kit), 'kit light ring is leaf-700 (7:1 on white)');
  assert.ok(/:root\[data-theme='dark'\] \{[\s\S]*?--focus-ring: #7cc197;/s.test(kit), 'kit dark ring is leaf-300');
});
