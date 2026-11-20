// node --test tests/vault-view.test.mjs — one product step 1 (8 Nov 2026): Vault's page inside the former host app's
// window as a second view. Vault's main side learns the view where it assumed a window: the same nv: channels trust
// and reach the view's page, the close handshake that never loses an edit flushes the view, prompts parent to the
// former host app's window, remembered bounds stay the window's own (the view never touches them), and zoom keys step
// the host's shared size. No channel is renamed. Each test fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-vault-view-'));
let V;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/vault-view.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'v.mjs'), format: 'esm' }, logLevel: 'silent' });
  V = await import(pathToFileURL(path.join(work, 'v.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the view contract: the same page, the same wait, the same channels', () => {
  assert.deepEqual(V.viewWebPreferences('/p/preload.js'), {
    preload: '/p/preload.js',
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
    spellcheck: true,
    plugins: true,
  });
  assert.equal(V.VIEW_FLUSH_MS, 6000, 'the same few seconds as the window’s close');
  assert.equal(V.CLOSE_REQUEST, 'app:close-request');
  assert.equal(V.CLOSE_READY, 'app:close-ready');
  // The window is built from the same contract, so neither side drifts.
  assert.ok(src.includes('webPreferences: viewWebPreferences(host.preload)'), 'the window’s page and the view’s page share their preferences');
  assert.ok(src.includes('VIEW_FLUSH_MS'), 'the window’s close and the view’s flush share the wait');
});

test('the view’s page is trusted and reached on the same channels', () => {
  const trusted = src.slice(src.indexOf('function isTrustedSender'), src.indexOf('function isTrustedSender') + 700);
  assert.match(trusted, /viewContents/, 'the view’s page passes the sender check');
  assert.match(trusted, /win\.webContents/, 'the window’s page still does');
  const send = src.slice(src.indexOf('const send = (channel'), src.indexOf('const send = (channel') + 500);
  assert.match(send, /win\.webContents\.send/, 'sends reach the window');
  assert.match(send, /viewContents\.send/, 'sends reach the view');
  const ready = src.slice(src.indexOf('handle(CLOSE_READY'), src.indexOf('handle(CLOSE_READY') + 300);
  assert.match(ready, /closeReady\?\.\(\)/, 'the window’s waiter resolves');
  assert.match(ready, /viewReady\?\.\(\)/, 'the view’s waiter resolves');
});

test('the view is guarded and keyed as the window’s page', () => {
  assert.ok(src.includes('function wirePage(contents: WebContents)'), 'one wiring for both pages');
  const wired = src.slice(src.indexOf('function wirePage'), src.indexOf('function wirePage') + 2600);
  assert.match(wired, /setWindowOpenHandler/, 'links open outside, never in the page');
  assert.match(wired, /will-navigate/, 'the page never navigates away');
  assert.match(wired, /will-attach-webview/, 'no webview tag');
  assert.match(wired, /edit:context/, 'right-click draws the window’s own menu');
  assert.ok(src.includes('wirePage(next.webContents)'), 'the window’s page is wired');
  assert.ok(src.includes('wirePage(contents)'), 'the view’s page is wired');
  assert.ok(src.includes('wireZoomKeys(next.webContents, false)'), 'the window steps its own size, as today');
  assert.ok(src.includes('wireZoomKeys(contents, true)'), 'the view steps through the host');
  const keys = src.slice(src.indexOf('function wireZoomKeys'), src.indexOf('function wireZoomKeys') + 900);
  assert.match(keys, /ownZoomKeys/, 'a canvas with the keys keeps them');
  assert.match(keys, /mainTakesZoomKey/, 'keys changed in Settings › Keys stay the person’s');
  assert.match(keys, /host\.viewZoomStep/, 'otherwise the shared size steps');
});

test('closing the host app’s window with unsaved view edits saves them, as the window’s close does', () => {
  assert.ok(src.includes('async function flushView('), 'the view flushes');
  const flush = src.slice(src.indexOf('async function flushView('), src.indexOf('async function flushView(') + 900);
  assert.match(flush, /isDestroyed\(\)\) return true/, 'nothing attached flushes as saved');
  assert.match(flush, /closeHandshake/, 'the same handshake as the window’s close');
  assert.match(flush, /VIEW_FLUSH_MS|ms/, 'a few seconds at most');
  assert.match(flush, /still waiting/, 'the log says when saves were still waiting');
  assert.ok(src.includes('flushView: (ms) => flushView(ms)'), 'the host can flush the view');
  assert.ok(src.includes('openInView: (target) => openInView(target)'), 'the host can show Vault’s side in the view');
  assert.ok(src.includes('attachView: (contents) => attachView(contents)'), 'the host attaches the view’s page');
});

test('prompts parent to the host app’s window in the view, Vault’s own otherwise', () => {
  assert.ok(src.includes('function promptOwner()'), 'one parent for every prompt');
  const owner = src.slice(src.indexOf('function promptOwner()'), src.indexOf('function promptOwner()') + 700);
  assert.match(owner, /host\.viewParent/, 'in the view, the host’s window');
  assert.match(owner, /return win/, 'otherwise Vault’s own window');
  assert.ok(!src.includes('showOpenDialog(win!'), 'no prompt assumes the window is there');
  assert.ok(!src.includes('showSaveDialog(win!'), 'no save prompt either');
  assert.ok(!src.includes('showSaveDialog(win,'), 'no unguarded save prompt either');
  assert.ok(!src.includes('win && !win.isDestroyed() ? await dialog'), 'every guarded prompt goes through the one parent');
});

test('remembered bounds stay the window’s own: the view never touches them', () => {
  for (const fn of ['function attachView(', 'async function openInView(', 'async function flushView(']) {
    const at = src.indexOf(fn);
    assert.ok(at > 0, `${fn} exists`);
    const body = src.slice(at, src.indexOf('\n  }\n', at));
    assert.ok(!body.includes('windowFile'), `${fn} never touches the remembered bounds`);
    assert.ok(!body.includes('savedWindow'), `${fn} never reads them`);
    assert.ok(!body.includes('rememberWindow'), `${fn} never writes them`);
    assert.ok(!body.includes('new BrowserWindow'), `${fn} never makes a window`);
  }
});

test('the host contract names the view’s two hooks', () => {
  assert.match(src, /viewParent\?\(\): BrowserWindow \| null;/, 'the window prompts parent to');
  assert.match(src, /viewZoomStep\?\(step: -1 \| 0 \| 1\): void;/, 'the shared size stepped by the view’s keys');
  assert.match(src, /attachView\(contents: WebContents\): void;/, 'the app attaches the view’s page');
  assert.match(src, /openInView\(target\?: \{ note\?: string; line\?: number \}\): Promise<void>;/, 'the app shows in the view');
  assert.match(src, /flushView\(ms\?: number\): Promise<boolean>;/, 'the app flushes the view');
});
