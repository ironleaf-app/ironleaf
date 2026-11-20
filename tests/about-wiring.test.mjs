// node --test tests/about-wiring.test.mjs — About and updates is findable everywhere (20 Nov 2026): its own Settings
// section (Help), the palette's Check for updates… and What's new, the Help menu, the tray's Check for updates opening
// the page with a check running, the version in the side bar's foot, the banner's links, and General's one-line link
// in place of the old squeezed rows; the settings search finds its rows on the new page.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-about-wiring-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/settingsSearch.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('About and updates is its own section, first under Help, and old ids land on it', () => {
  assert.ok(S.SETTINGS_GROUPS.some((g) => g.id === 'about' && g.label === 'About and updates'));
  assert.deepEqual(S.SETTINGS_JOB_GROUPS.find((g) => g.id === 'help').sections, ['about', 'keys']);
  assert.equal(S.resolveSection('about'), 'about');
  assert.equal(S.resolveSection('updates'), 'about');
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.match(settings, /\{ id: 'about', label: 'About and updates', icon: 'info' \}/);
  assert.match(settings, /current === 'about' && <AboutPage \/>/);
});

test('General keeps one line to About and updates instead of the squeezed update rows', () => {
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.ok(!settings.includes('UpdateCheckSetting'), 'the old rows are gone');
  assert.match(settings, /<Row title="About and updates"[^>]*oneLine><button type="button" className="link-button" onClick=\{\(\) => openAboutPage\(\)\}>Open<\/button><\/Row>/);
  assert.ok(!read('src/renderer/src/components/UpdateBanner.tsx').includes('export function UpdateCheckSetting'));
});

test('the settings search finds the update settings on the new page', () => {
  const find = (q) => S.searchSettings(q, S.SETTINGS_INDEX, {}).map((h) => h.entry);
  const update = find('update');
  assert.ok(update.some((e) => e.section === 'about' && e.title === 'Check for updates automatically'));
  assert.ok(find('download updates').some((e) => e.section === 'about' && e.title === 'Download updates automatically'));
  assert.ok(find('changelog').some((e) => e.title === 'Version history'));
  assert.ok(find('whats new').some((e) => e.title === 'What’s new in this version'));
  assert.ok(find('version').some((e) => e.section === 'about'));
  // Each indexed About row is on the page by that title (a Row's title or a section's data-setting).
  const page = read('src/renderer/src/components/about/AboutPage.tsx');
  for (const e of S.SETTINGS_INDEX.filter((x) => x.section === 'about')) assert.ok(page.includes(`title="${e.title}"`) || page.includes(`data-setting="${e.title}"`), `${e.title} is on the page`);
});

test('the palette: Check for updates…, What’s new and About Ironleaf', () => {
  const c = read('src/renderer/src/state/commands.ts');
  assert.match(c, /id: 'check-updates', name: 'Check for updates…', icon: 'download', run: \(\) => openAboutPage\(\{ check: true \}\)/);
  assert.match(c, /id: 'whats-new', name: 'What’s new in Ironleaf', icon: 'sparkle', run: \(\) => openAboutPage\(\{ focus: 'whats-new' \}\)/);
  assert.match(c, /id: 'about-ironleaf'/);
});

test('the Help menu and the tray open the page (the tray with a check running)', () => {
  const app = read('src/main/app.ts');
  assert.match(app, /role: 'help', submenu: \[\{ label: 'About Ironleaf', click: \(\) => openAbout\(\) \}, \{ label: 'Check for updates…', click: \(\) => openAbout\(\{ check: true \}\) \}/);
  const tray = read('src/main/tray.ts');
  assert.match(tray, /id === 'check-updates' && opts\.openAbout\) \{\n\s+show\(\);\n\s+opts\.openAbout\(\);/);
  assert.match(read('src/main/index.ts'), /openAbout: \(\) => openAbout\(\{ check: true \}\)/);
  assert.match(read('src/main/index.ts'), /startUpdateAbout\(\);/);
  // A request that comes before the page listens waits for it; the banner (always mounted) hears it.
  const preload = read('src/preload/update-check.ts');
  for (const ch of ['nvupdate:about', 'nvupdate:versions', 'nvupdate:take-open', 'nvupdate:open-about']) assert.ok(preload.includes(`'${ch}'`), ch);
  assert.match(read('src/renderer/src/components/UpdateBanner.tsx'), /useAboutDoor\(\);/);
});

test('the side bar’s account menu shows the version, which opens About; the banner links to the notes and the history', () => {
  // 20 Nov 2026: the version line left the foot for the account menu (About and updates · 2.0.x), and its dot for the
  // avatar (tests/account-menu.test.mjs checks every state).
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.match(places, /<AccountChip variant="foot" \/>/);
  const model = read('src/renderer/src/components/account/accountMenuModel.ts');
  assert.match(model, /`About and updates · \$\{v\}`/);
  assert.match(model, /updateNudge\(update\)\.dot/);
  assert.match(read('src/renderer/src/components/account/AccountMenu.tsx'), /case 'about':\s*return openAboutPage\(\);/);
  const banner = read('src/renderer/src/components/UpdateBanner.tsx');
  assert.match(banner, /What’s new/);
  assert.match(banner, /See the full version history/);
});

test('the page says Ironleaf, never the host app; NeuralVault only to explain the rename', () => {
  for (const f of ['src/renderer/src/components/about/AboutPage.tsx', 'src/renderer/src/lib/aboutStatus.ts', 'src/renderer/src/components/account/AccountMenu.tsx', 'src/renderer/src/components/account/accountMenuModel.ts', 'CHANGELOG.md']) {
    const text = read(f);
    assert.ok(!/NeuralSpark/.test(text), `${f}: no old product name`);
  }
  assert.match(read('src/renderer/src/components/about/AboutPage.tsx'), /Formerly NeuralVault/);
});
