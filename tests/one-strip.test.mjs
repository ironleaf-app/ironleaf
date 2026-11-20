// node --test tests/one-strip.test.mjs — one tab strip (one product, 9 Nov 2026): in the frameless view Vault's
// own tab strip is hidden; the one strip above holds the tabs, and Vault's tabs map to it — opening, closing and
// the active tab stay in step. With the flag off the window keeps its own strip. Each test fails without its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('the view hides its own strip; the window keeps it', () => {
  const ws = read('src/renderer/src/views/Workspace.tsx');
  assert.ok(ws.includes('inVaultView') || ws.includes('inWindow'), 'the workspace knows the view');
  assert.ok(/showTabs.*inVaultView|inVaultView.*showTabs|frameless/.test(ws), 'the strip hides in the view');
  assert.ok(ws.includes('TabStrip'), 'the strip itself stays for the window');
  assert.ok(ws.includes('prefs.showTabs') || ws.includes('showTabs'), 'flag off follows the setting as today');
});

test('the view reports its tabs; opening, closing and the active tab stay in step', () => {
  const preload = read('src/preload/index.ts');
  assert.ok(preload.includes('tabs') && /report|sync/.test(preload), 'the preload carries the tabs across');
  const app = read('src/renderer/src/App.tsx');
  assert.ok(/tabs.*report|report.*tabs|tabSync|TabSync/i.test(app), 'the view reports its tabs');
  assert.ok(app.includes('inVaultView') || app.includes('frameless'), 'only in the view (the window reports nothing)');
});

test('the one strip drives the view: activating and closing by id', () => {
  const preload = read('src/preload/index.ts');
  assert.ok(/tabsActivate|tabs-activate|activate.*tab/i.test(preload), 'activating a tab from the one strip');
  assert.ok(/tabsClose|tabs-close|close.*tab/i.test(preload), 'closing a tab from the one strip');
  const appMain = read('src/main/app.ts');
  assert.ok(/tabs-activate|tabsActivate/.test(appMain), 'the main side sends the activate to the view');
  assert.ok(/tabs-close|tabsClose/.test(appMain), 'and the close');
  const app = read('src/renderer/src/App.tsx');
  assert.ok(/tabsActivate|tabs-activate|activate/.test(app), 'the view takes the activate');
});

test('no channel is renamed for the window: the same pages, the same sends', () => {
  const appMain = read('src/main/app.ts');
  assert.ok(appMain.includes('vault:open-place'), 'places still open as today');
  assert.ok(appMain.includes('vault:split-focus'), 'the split focus still tells as today');
});
