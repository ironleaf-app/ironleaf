// node --test tests/standalone-package.test.mjs — the Windows package for Ironleaf on its own keeps the
// Neural Launcher contract: per-user install into %LOCALAPPDATA%\Programs\Ironleaf as Ironleaf.exe, an
// Installed apps entry with DisplayVersion and InstallLocation, the Ironleaf-Setup-<v>.exe name, and the
// same NSIS packaging the former host app uses (its progress include, per-user, no admin). The installer
// itself is built on the laptop; this pins every shape the laptop build must keep.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, before, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-standalone-package-'));
let E;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src', 'main', 'installed-entry.ts'), platform: 'node', output: { file: path.join(work, 'installed-entry.mjs'), format: 'esm' }, logLevel: 'silent' });
  E = await import(pathToFileURL(path.join(work, 'installed-entry.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const config = () => JSON.parse(readFileSync(path.join(root, 'build-standalone', 'electron-builder.json'), 'utf8'));

test('the builder config installs Ironleaf per user with its own entry', () => {
  const c = config();
  assert.deepEqual([c.productName, c.appId], ['Ironleaf', 'com.kaitiaki.neuralvault']);
  assert.equal(c.nsis.perMachine, false, 'per user: no administrator rights, no UAC prompt');
  assert.equal(c.nsis.oneClick, false);
  assert.match(c.nsis.artifactName, /^Ironleaf-Setup-.*\.exe$/, 'the contract’s installer file name');
  assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.nsis.guid), 'its own Installed apps key');
  assert.ok(String(c.nsis.include).endsWith('.nsh'), 'the same installer progress as the host app');
  assert.ok(existsSync(path.join(root, 'build-standalone', c.win.icon)), 'its own icon on the installer');
  assert.ok(existsSync(path.join(root, 'resources', 'icon.ico')), 'its own icon in the app');
  assert.ok(existsSync(path.join(root, 'tools', 'build-standalone-win.mjs')), 'the one-command laptop build');
});

test('every start keeps this installation’s Installed apps entry honest', () => {
  const c = config();
  assert.ok(E.KEY.includes(c.nsis.guid), 'the repair looks at the installer’s own key');
  assert.equal(E.NAME, 'Ironleaf');
  const exe = 'C:\\Users\\Someone\\AppData\\Local\\Programs\\Ironleaf\\Ironleaf.exe';
  const values = { DisplayName: 'Ironleaf 1.0.0', DisplayVersion: '1.0.0', InstallLocation: 'C:\\Users\\Someone\\AppData\\Local\\Programs\\Ironleaf', UninstallString: '"C:\\Users\\Someone\\AppData\\Local\\Programs\\Ironleaf\\Uninstall Ironleaf.exe"' };
  const changes = E.changesFor(values, { exe, version: '1.1.0' });
  assert.deepEqual(Object.fromEntries(changes), { DisplayName: 'Ironleaf', DisplayVersion: '1.1.0' });
  const elsewhere = { ...values, InstallLocation: 'D:\\Other\\Ironleaf', UninstallString: '"D:\\Other\\Ironleaf\\Uninstall Ironleaf.exe"' };
  assert.deepEqual(E.changesFor(elsewhere, { exe, version: '1.1.0' }), [], 'another folder’s entry is left alone');
});
