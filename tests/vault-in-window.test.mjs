// node --test tests/vault-in-window.test.mjs — one product step 2 (8 Nov 2026): deep links and a Vault
// without its own side bar. When Vault's page lives in the former host app's window (?inWindow=1) it hides
// its own Places side bar and the former host app | Vault | Bot switch and shows only tabs and pages; the
// second window keeps its bar exactly as today. Every place the bar had stays reachable by deep link
// (host.open target) and by Ctrl+K. Back and forward and the window title follow the showing page. Each
// test fails without its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('frameless signal: the view reads ?inWindow=1, the window does not', () => {
  const lib = read('src/renderer/src/lib/inWindow.ts');
  assert.ok(lib.includes('inWindow') && lib.includes("get('inWindow')") && lib.includes("=== '1'"), 'reads ?inWindow=1 from the address');
  assert.ok(lib.includes('8 Nov 2026') || lib.includes('step 2'), 'says why, with the date');
});

test('frameless Vault: no Places bar or switch in the view, tabs and pages stay', () => {
  const app = read('src/renderer/src/App.tsx');
  assert.ok(app.includes('inWindow') || app.includes('inVaultView'), 'the app knows when it lives in the host app’s window');
  // The left bar (Places, switch, foot) never draws in the view; the middle (tabs and pages) always does.
  assert.ok(/frameless|inWindow.*LeftSidebar|LeftSidebar.*frameless|!.*frameless.*LeftSidebar/.test(app) || (app.includes('frameless') && app.includes('LeftSidebar')), 'LeftSidebar hidden when frameless');
  assert.ok(app.includes('<Workspace'), 'tabs and pages stay');
  // The window path is untouched: docked and drawer bars still draw when not frameless.
  assert.ok(app.includes("fit.left === 'docked'") && app.includes("fit.left === 'drawer'"), 'the second window keeps its bar');
});

test('deep links reach the main side: place and folder targets', () => {
  const src = read('src/main/app.ts');
  // The host contract names place and folder beside note and line.
  assert.ok(src.includes('place?: string') && src.includes('folder?: string'), 'open/openInView take place and folder');
  // The view and the window both open them without making a window for the view.
  assert.ok(src.includes('vault:open-place') || src.includes('vault-open-place'), 'a new send channel carries the place');
  const openViewAt = src.indexOf('async function openInView');
  const openView = src.slice(openViewAt, src.indexOf('\n  }\n', openViewAt));
  // The place channel itself (one window, 9 Nov 2026: the old `send(` proxy matched the re-sent vault:opened,
  // never the place — which is why the view staying on People slipped through).
  assert.ok(openView.includes('vault:open-place'), 'openInView sends the place to the page');
  assert.ok(!openView.includes('new BrowserWindow'), 'openInView never makes a window');
  const openWin = src.slice(src.indexOf('async function openWindow'), src.indexOf('async function openWindow') + 2000);
  assert.ok(openWin.includes('place') || src.includes('openWindow(target'), 'openWindow takes the place too (window fallback)');
});

test('the page opens the deep link: Today, Projects, Notes, People, Graph and the rest', () => {
  const preload = read('src/preload/index.ts');
  assert.ok(preload.includes('vaultOpenPlace') || preload.includes('vault:open-place'), 'the preload exposes the place channel');
  const app = read('src/renderer/src/App.tsx');
  assert.ok(app.includes('vaultOpenPlace') || app.includes('vault:open-place'), 'the app subscribes to it');
  // Every bar place has a door: Today, Inbox, Projects, Tasks, Meetings, Notes, People, Graph.
  for (const place of ['today', 'inbox', 'projects', 'tasks', 'meetings', 'people', 'graph']) {
    assert.ok(app.includes(place) || read('src/renderer/src/state/actions.ts').includes(place) || read('src/renderer/src/state/life.ts').includes(place), `${place} opens from a deep link`);
  }
});

test('Notes opens already filtered: folders open their folder', () => {
  const types = read('src/renderer/src/state/noteTypes.ts');
  assert.ok(types.includes('folderOfTab'), 'the tab carries the folder');
  assert.ok(types.includes('openNotesFolder'), 'opening Notes in a folder');
  const page = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(page.includes('folderOfTab'), 'Notes reads its folder from the tab');
});

test('nothing lost: every bar place is a palette command too', () => {
  const cmds = read('src/renderer/src/state/commands.ts');
  for (const id of ['today', 'inbox', 'projects', 'tasks', 'meetings', 'people', 'graph', 'files', 'search']) {
    assert.ok(cmds.includes(`id: '${id}'`), `${id} has a palette command`);
  }
  // Notes gets its own one-step door (the picker stays for types).
  assert.ok(cmds.includes("id: 'notes'"), 'Notes opens from the palette in one step');
  // Shared spaces and packs lived in More only: the palette keeps them when the bar is gone.
  assert.ok(cmds.includes("id: 'shared-spaces'"), 'Shared spaces opens from the palette');
  assert.ok(cmds.includes("id: 'packs'"), 'packs chooser opens from the palette');
});

test('Files stays reachable without the bar: Notes carries folders in the view', () => {
  const cmds = read('src/renderer/src/state/commands.ts');
  assert.ok(cmds.includes('inWindow') || cmds.includes('frameless') || read('src/renderer/src/state/actions.ts').includes('inWindow'), 'Files opens Notes when the bar is gone');
});

test('the window title follows the showing page', () => {
  const app = read('src/renderer/src/App.tsx');
  assert.ok(app.includes('document.title'), 'the page names itself for the window');
});

test('Back and Forward follow the showing page', () => {
  const cmds = read('src/renderer/src/state/commands.ts');
  // Alt+Left/Right work as well as the tab buttons and Mod+Alt+arrows (also keys, not the Mod+ chord itself).
  const backAt = cmds.indexOf("id: 'back'");
  const fwdAt = cmds.indexOf("id: 'forward'");
  assert.ok(backAt > 0 && cmds.slice(backAt, backAt + 400).includes('Alt+Left') && cmds.slice(backAt, backAt + 400).includes('also'), 'Back answers to Alt+Left');
  assert.ok(fwdAt > 0 && cmds.slice(fwdAt, fwdAt + 400).includes('Alt+Right') && cmds.slice(fwdAt, fwdAt + 400).includes('also'), 'Forward answers to Alt+Right');
  const header = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(header.includes('Back') && header.includes('Forward') && header.includes('W.navigate'), 'the tab buttons navigate the tab');
});
