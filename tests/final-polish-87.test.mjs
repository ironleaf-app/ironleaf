// node --test tests/final-polish-87.test.mjs — 8.7 final polish (the plan, from the real app inside The former
// host app, 30 Oct 2026; 4 Nov 2026, p9-one-ask: the floating Ask bar is gone, so item 1 pins its absence): one
// Meetings place (no pack row repeating the Projects group's row, one palette tour command); Search and the Ctrl+K
// palette centred over the page area, right of the side bar; every side-bar page walked in light and dark at 1440x900
// and 900px narrow. Each test fails without its change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

// ── Item 2: one Meetings place ──────────────────────────────────────────────────────────────────────────────────

test('item 2: the side bar lists Meetings once, never repeated in the palette’s packs', () => {
  // 5 Nov 2026, the quiet rail: the bar keeps its Meetings row with no group around it; 8 Nov 2026, the quiet
  // More: packs left More for Ctrl+K, each switched-on pack one row, Meetings still left out (it has its own row).
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(places.includes('<Row row={f.meetings} />'), 'the bar keeps its Meetings row');
  assert.ok(!places.includes("heading: 'Packs'"), 'no packs in More');
  const modals = read('src/renderer/src/components/Modals.tsx');
  assert.match(modals, /modulesOn\([^)]*\)\.filter\(\(m\) => m\.id !== 'meetings'\)/, 'the palette’s packs leave Meetings out');
});

test('item 2: the palette carries one Meetings tour, in the packs’ own family', () => {
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(!commands.includes("id: 'meetings-tour'"), 'no second tour command under its own id');
  assert.match(commands, /id: 'tour-meetings', name: `Show me around \$\{moduleInfo\('meetings'\)\?\.name/, 'the packs’ tour-meetings stays');
  assert.equal((commands.match(/openTour\('meetings'\)/g) || []).length, 1, 'one opener of the Meetings tour in the palette');
});

test('item 2: Settings lists the Meetings pack once, and its search finds one tour', () => {
  const catalogue = read('src/shared/life-modules.ts');
  assert.equal((catalogue.match(/id: 'meetings',/g) || []).length, 1, 'one meetings pack in the catalogue (Settings › Packs and its search list each pack once)');
  const search = read('src/renderer/src/lib/settingsSearch.ts');
  assert.match(search, /LIFE_MODULES\.map\(\(m\) => \(\{\s*section: 'packs'/, 'one Packs row per catalogue entry, none spread twice');
  // Settings › Keys and Settings search both read COMMANDS, so the palette’s one tour is their one tour too.
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.ok(settings.includes('commandEntries(COMMANDS)'), 'Settings search reads the same commands');
});

// ── Item 3: Search and the palette sit over the page area ───────────────────────────────────────────────────────

test('item 3: the window reports how wide its docked left side is', () => {
  // One product step 2 (t16, 8 Nov 2026): frameless in the former host app's window the left bar never draws,
  // so the docked flag reads `fit.left === 'docked' && !frameless` and the style carries the width through that
  // flag, else 0.
  const app = read('src/renderer/src/App.tsx');
  assert.ok(app.includes("const leftDocked = fit.left === 'docked' && !frameless;"), 'docked only with a frame to dock in');
  assert.match(app, /'--left-dock': leftDocked \? `\$\{fit\.leftWidth\}px` : '0px'/, 'the .app carries --left-dock: the docked width, else 0');
});

test('item 3: the search window and the pickers centre over the page area, right of the side bar', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  const rule = kit.match(/\.overlay\.picker-overlay, \.overlay:has\(> \.smodal\) \{([^}]*)\}/)?.[1] ?? assert.fail('no page-area overlay rule');
  assert.match(rule, /padding-left: var\(--left-dock, 0px\)/, 'centred past the docked side');
  assert.ok(!rule.includes('padding-right') && !rule.includes('margin'), 'the dim still covers the whole window; only the centring moves');
});

// ── Item 1: nothing floats over the rows (4 Nov 2026, p9-one-ask: the floating bar is gone) ──────────────────────

test('item 1: no floating bar, so no room rule and no height reporting', () => {
  const css = read('src/renderer/src/styles/search-ask-87.css');
  assert.ok(!css.includes('.sas-askbar'), 'no floating bar rule');
  assert.ok(!css.includes('--askbar-h'), 'no reported bar height');
  assert.ok(!css.includes('group-body:has(> .sas-askbar)'), 'no bottom room reserved for the bar');
  assert.ok(!css.includes('.sas-asksuggest'), 'no bar chips to show or hide');
  assert.throws(() => read('src/renderer/src/components/AskBar.tsx'), 'the bar file is deleted');
});
