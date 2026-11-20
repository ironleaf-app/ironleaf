// node --test tests/one-settings.test.mjs — one product step 4 (8 Nov 2026): one Settings, the former host
// app's. In the former host app's window every Settings door (the gear, Ctrl+, Settings links) opens the one
// Settings at its section; the window keeps its page exactly as today. Vault's settings read and write through
// the host the same way the window does, and the shared look (palette, accent, light or dark, interface size,
// density) travels both ways. NV_ONE_ROOT overrides the root (the fail-first proof runs against pristine HEAD
// copies).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = process.env.NV_ONE_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const app = read('src/main/app.ts');
const preload = read('src/preload/index.ts');
const actions = read('src/renderer/src/state/actions.ts');
const shell = read('src/renderer/src/App.tsx');

test('the view keeps an always-a-tab Settings door; the window keeps its page', () => {
  assert.ok(actions.includes('export function openSettingsTab('), 'the view keeps an always-a-tab door for whole sub-screens');
  assert.ok(!actions.match(/export function openSettingsTab\([^)]*\)[^{]*\{[^}]*inVaultView/), 'openSettingsTab never asks back (no loop)');
  assert.ok(shell.includes("A.openSettingsTab(t.section, 'current', t.row)"), 'the view\u2019s Settings ask opens Vault\u2019s own page as a tab');
  assert.ok(shell.includes('api.on.vaultOpenSettings'), 'the view hears vault:open-settings');
  assert.ok(shell.includes('offVaultSettings();'), 'the subscription is cleaned up');
});

test('the view shows a Settings section through the same seam, never the window', () => {
  // Step 3's new note and step 4's section share the one target (merged 8 Nov 2026).
  assert.ok(app.includes('openInView(target?: { note?: string; line?: number; place?: string; folder?: string; newNote?: boolean; settings?: string; row?: string })'), 'openInView takes a Settings section');
  assert.ok(app.includes("pendingSettings = { section: target.settings"), 'the section waits for the notes like a place');
  assert.ok(app.includes("sendToView('vault:open-settings', pendingSettings);"), 'the showing view gets the section, on its row');
  assert.ok(!app.includes("send('vault:open-settings'"), 'the window never hears it');
});

test('the host app\u2019s Settings reads and writes Vault\u2019s settings the same way the window does', () => {
  assert.ok(app.includes('vaultSettings: () => ({ ...settings.view(), host: host.kind, library: libraryPath(), packs:'), 'the host reads Vault\u2019s settings with its catalogues');
  assert.ok(app.includes('vaultModels: () => modelsView(),'), 'the host reads the models the same way the window does');
  assert.ok(app.includes('updateVaultSettings: async (patch) =>'), 'the host writes through the same update');
  assert.ok(app.includes("handle('settings:update', async (patch: SettingsPatch) => updateSettings(patch ?? {}));"), 'the window writes through the same update');
  for (const follows of ['index.setExcluded(settings.raw.prefs.excluded)', 'quickCapture.applyKey()', 'privateNotes.refreshRemembered()', 'lifeModules.switched()', 'publications.switched()', 'syncFileIndex()', "ocrQueue.scan(ocrFilesOf(vault, all.files))"]) assert.ok(app.includes(follows), 'the shared update keeps: ' + follows);
});

test('one shared row writes both stores: the look travels both ways', () => {
  assert.ok(app.includes('function sharedLook(): { palette: string; accent: string; theme: string; zoom: number; density: string }'), 'the shared look is five things');
  assert.ok(app.includes('host.appearance?.set(sharedLook())'), 'writes hand the shared look back');
  assert.ok(app.includes("if (look.theme && look.theme !== prefs.theme) patch.theme = look.theme;"), 'light or dark is taken');
  assert.ok(app.includes("if (typeof look.zoom === 'number' && look.zoom !== prefs.zoom) patch.zoom = look.zoom;"), 'the interface size is taken');
  assert.ok(app.includes("if (look.density && look.density !== prefs.density) patch.density = look.density;"), 'density is taken');
  assert.ok(app.includes('get(): { palette?: string; accent?: string; theme?: string; zoom?: number; density?: string } | null;'), 'the host\u2019s look carries all five');
});
