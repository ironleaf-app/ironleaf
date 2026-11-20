// node --test tests/ironleaf-rename.test.mjs — the rename from NeuralVault to Ironleaf (20 Nov 2026) keeps what earlier
// installs depend on: the update site falls back to the old one, neuralvault:// links still open, the installed
// entry and the old NeuralVault.exe are still this copy's, Documents\NeuralVault stays the default library where it is,
// and the installer config keeps its id and folder handling.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-rename-'));
let U, M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src', 'main', 'update-check.ts'), platform: 'node', external: [/^node:/, 'electron'], output: { file: path.join(work, 'update-check.mjs'), format: 'esm', inlineDynamicImports: true }, logLevel: 'silent' });
  const entry = path.join(work, 'rest.ts');
  writeFileSync(
    entry,
    ['src/main/installed-entry.ts', 'src/shared/uri.ts', 'src/shared/vault-home.ts', 'src/shared/vault-place.ts'].map((f) => `export * from ${JSON.stringify(path.join(root, f))};`).join('\n') + '\n',
  );
  await build({ input: entry, platform: 'node', external: [/^node:/, 'electron'], output: { file: path.join(work, 'rest.mjs'), format: 'esm' }, logLevel: 'silent' });
  U = await import(pathToFileURL(path.join(work, 'update-check.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'rest.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const LATEST = JSON.stringify({ version: '2.0.1', date: '2026-11-21', notes: 'Ironleaf.', windows: { file: 'Ironleaf-Setup.exe', size: 3, sha256: 'a'.repeat(64) } });
function checker(answer) {
  const fetched = [];
  const opened = [];
  const c = new U.UpdateChecker({
    current: '2.0.0',
    platform: 'win32',
    fetch: async (url) => {
      fetched.push(url);
      return answer(url);
    },
    readState: async () => null,
    writeState: async () => {},
    openExternal: async (url) => void opened.push(url),
  });
  return { c, fetched, opened };
}

test('updates: Ironleaf’s site first; a DNS failure or a 404 there falls back to the old site, which then serves the downloads', async () => {
  assert.equal(U.UPDATE_ORIGIN, 'https://ironleaf.kaitiaki-it.com');
  assert.equal(U.LEGACY_UPDATE_ORIGIN, 'https://neuralvault.kaitiaki-it.com');
  for (const fail of [() => Promise.reject(new Error('getaddrinfo ENOTFOUND')), () => ({ ok: false, status: 404, text: async () => '' })]) {
    const { c, fetched, opened } = checker((url) => (url.startsWith(U.UPDATE_ORIGIN) ? fail() : { ok: true, status: 200, text: async () => LATEST }));
    const state = await c.check();
    assert.deepEqual(fetched, ['https://ironleaf.kaitiaki-it.com/download/latest.json', 'https://neuralvault.kaitiaki-it.com/download/latest.json']);
    assert.equal(state.available.version, '2.0.1');
    await c.openDownloadPage();
    assert.deepEqual(opened, ['https://neuralvault.kaitiaki-it.com/download/'], 'the site that answered');
  }
  const { c, fetched } = checker(() => ({ ok: true, status: 200, text: async () => LATEST }));
  assert.equal((await c.check()).available.version, '2.0.1');
  assert.deepEqual(fetched, ['https://ironleaf.kaitiaki-it.com/download/latest.json'], 'the old site is not read when the new one answers');
  const none = checker(() => Promise.reject(new Error('offline')));
  assert.equal((await none.c.check()).available, null, 'both down: nothing, never a throw');
});

test('links: ironleaf:// and the old neuralvault:// open the same way', () => {
  assert.equal(M.URI_SCHEME, 'ironleaf');
  assert.deepEqual([...M.URI_SCHEMES], ['ironleaf', 'neuralvault']);
  for (const scheme of ['ironleaf', 'neuralvault', 'NEURALVAULT']) {
    assert.deepEqual(M.parseVaultUri(`${scheme}://search?query=flour`), { ok: true, action: { kind: 'search', query: 'flour' } });
    assert.deepEqual(M.launchTargets([`${scheme}://open`]).links, [`${scheme}://open`]);
  }
});

test('the installed entry and the old NeuralVault.exe are still this copy’s', () => {
  const exe = 'C:\\Users\\pat\\AppData\\Local\\Programs\\NeuralVault\\Ironleaf.exe';
  const values = { DisplayName: 'NeuralVault', InstallLocation: 'C:\\Users\\pat\\AppData\\Local\\Programs\\NeuralVault', DisplayVersion: '2.0.0' };
  assert.deepEqual(M.changesFor(values, { exe, version: '2.0.1' }), [['DisplayName', 'Ironleaf'], ['DisplayVersion', '2.0.1']]);
  assert.deepEqual(M.changesFor({ ...values, DisplayName: 'Something else' }, { exe }), [], 'another app’s entry is left alone');
  const has = (f) => f.endsWith('Ironleaf.exe');
  assert.equal(M.legacyExeTarget('C:\\P\\NeuralVault\\NeuralVault.exe', has), 'C:\\P\\NeuralVault\\Ironleaf.exe');
  assert.equal(M.legacyExeTarget('C:\\P\\NeuralVault\\neuralvault.EXE', has), 'C:\\P\\NeuralVault\\Ironleaf.exe');
  assert.equal(M.legacyExeTarget('C:\\P\\NeuralVault\\NeuralVault.exe', () => false), null, 'no Ironleaf.exe beside it: it runs as itself');
  assert.equal(M.legacyExeTarget('C:\\P\\Ironleaf\\Ironleaf.exe', has), null);
});

test('the notes folder: Documents\\Ironleaf when new, Documents\\NeuralVault where it is already there', () => {
  const p = path.win32;
  assert.equal(M.defaultLibraryIn('C:\\Users\\pat\\Documents', p, () => false), 'C:\\Users\\pat\\Documents\\Ironleaf');
  assert.equal(M.defaultLibraryIn('C:\\Users\\pat\\Documents', p, (f) => f.endsWith('NeuralVault')), 'C:\\Users\\pat\\Documents\\NeuralVault');
  assert.deepEqual([...M.HOME_FOLDERS], ['Ironleaf', 'NeuralVault']);
  assert.equal(M.isOwnNote('Welcome to NeuralVault.md', ''), false, 'an earlier first note is still the first note');
  assert.equal(M.isOwnNote('Welcome to Ironleaf.md', ''), false);
});

test('the installer keeps its id and the old folder, and both schemes and the old program name', () => {
  const config = JSON.parse(read('build-standalone/electron-builder.json'));
  assert.equal(config.productName, 'Ironleaf');
  assert.equal(config.appId, 'com.kaitiaki.neuralvault', 'Windows’ identity for the app is kept');
  assert.equal(config.nsis.guid, '64ba8a54-550e-4c87-9030-91574132cfd2', 'the installer finds and replaces the earlier install');
  assert.deepEqual(config.protocols[0].schemes, ['ironleaf', 'neuralvault']);
  assert.equal(config.nsis.artifactName, 'Ironleaf-Setup-${version}.exe');
  const nsh = read('build-standalone/build/update-progress.nsh');
  assert.match(nsh, /CreateHardLinkW\(w "\$INSTDIR\\NeuralVault\.exe"/, 'NeuralVault.exe kept as a link to Ironleaf.exe');
  assert.match(nsh, /\$INSTDIR == "\$2\\\$\{APP_FILENAME\}"/, 'no Ironleaf folder nested in the old one');
  assert.match(nsh, /Delete "\$oldStartMenuLink"/, 'the old shortcut goes');
  assert.match(read('tools/release.mjs'), /NV_DOWNLOAD_DIR \?\? ''\)\.split\(path\.delimiter\)/, 'published to every folder NV_DOWNLOAD_DIR names (both sites), none hard-coded');
});
