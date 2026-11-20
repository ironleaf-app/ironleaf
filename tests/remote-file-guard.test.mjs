// SPDX-License-Identifier: AGPL-3.0-or-later
// node --test tests/remote-file-guard.test.mjs — a picture on another computer is never fetched (security review,
// 20 Nov 2026). The window is shown from file://, so ![](//host/x.png), ![](\\host\share\x.png) or file://host/… in a
// note would make Windows open an SMB connection to that host and send this PC's sign-in (an NTLM hash). The window
// draws a "blocked remote file" placeholder (src/shared/remote-file.ts, lib/markdownRender.ts, editor/live-preview.ts)
// and the main side cancels any file: request that names a host, is UNC, or lies outside the vault and Ironleaf's own
// places (src/main/file-url-guard.ts, put on the window's session in src/main/app.ts). Made-up hosts and paths only.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-remote-file-'));
let G;
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const bundle = async (name, source, plugins = []) => {
    const entry = path.join(work, `${name}.ts`);
    writeFileSync(entry, source);
    await build({ input: entry, platform: 'node', plugins, external: ['electron'], output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  G = await bundle('guard', `export * from ${JSON.stringify(path.join(root, 'src/shared/remote-file.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/file-url-guard.ts'))};\n`);
  // The page renderer with the window's lookups stood in for: nothing resolves in the vault, so an address is kept as written.
  const stub = path.join(work, 'resolve-stub.ts');
  writeFileSync(stub, 'export const fileUrl = (p: string) => `file:///V/${p}`;\nexport const isAudio = () => false;\nexport const isImage = () => false;\nexport const isPdf = () => false;\nexport const isVideo = () => false;\nexport const resolveAny = () => null;\nexport const resolveFile = (p: string) => (p === "pics/cat.png" ? p : null);\n');
  const stubResolve = { name: 'stub-resolve', resolveId: (id, importer) => (id === './resolve' && importer?.endsWith('markdownRender.ts') ? stub : null) };
  R = await bundle('render', `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/markdownRender.ts'))};\n`, [stubResolve]);
});
after(() => rmSync(work, { recursive: true, force: true }));

const REMOTE = ['//evil.example/x.png', '\\\\evil.example\\share\\x.png', '/\\evil.example/x.png', '%5C%5Cevil.example%5Cx.png', 'file://evil.example/share/x.png', 'FILE://evil.example/x.png', 'file:////evil.example/share/x.png', 'file://///evil.example/x.png', ' //evil.example/x.png'];
const LOCAL = ['pics/cat.png', './cat.png', '/home/o/cat.png', 'file:///C:/Users/o/cat.png', 'file:///home/o/cat.png', 'file://localhost/C:/x.png', 'https://example.com/cat.png', 'data:image/png;base64,AAAA', 'C:\\Users\\o\\cat.png'];

test('a picture address that reaches another computer is told apart from a local one', () => {
  for (const src of REMOTE) assert.equal(G.isRemoteFileSource(src), true, src);
  for (const src of LOCAL) assert.equal(G.isRemoteFileSource(src), false, src);
});

test('the page shows a placeholder for a remote picture, never an <img> that would fetch it', () => {
  for (const src of ['//evil.example/x.png', '\\\\\\\\evil.example\\\\share\\\\x.png']) {
    const html = R.renderMarkdown(`Before ![the chart](${src}) after`);
    assert.equal(/<img/.test(html), false, `${src}: ${html}`);
    assert.match(html, /class="nv-blocked-file"[^>]*>Blocked remote file: the chart</);
  }
  // A picture in the vault is drawn as before.
  assert.match(R.renderMarkdown('![cat](pics/cat.png)'), /<img src="file:\/\/\/V\/pics\/cat.png"/);
});

test('Live Preview draws the placeholder too, before any address is made from the source', () => {
  const src = readFileSync(path.join(root, 'src/renderer/src/editor/live-preview.ts'), 'utf8');
  const image = src.slice(src.indexOf("case 'Image': {"), src.indexOf("case 'Wikilink': {"));
  assert.ok(image.indexOf('isRemoteFileSource(src)') > 0, 'checked');
  assert.ok(image.indexOf('isRemoteFileSource(src)') < image.indexOf('new ImageWidget('), 'before the picture widget');
  assert.match(image, /new TextWidget\(`\$\{BLOCKED_REMOTE_FILE\}/);
});

const winOpts = { roots: ['C:\\Users\\o\\Notes', 'C:\\Program Files\\Ironleaf\\resources', 'D:\\Projects\\Bridge'], platform: 'win32' };
const nixOpts = { roots: ['/home/o/Notes', '/opt/Ironleaf/resources'], platform: 'linux' };

test('main side (Windows): a host, a UNC or device path, or a file outside the allowed places is refused', async () => {
  const ok = (url, o = winOpts) => G.fileRequestAllowed(url, o);
  assert.equal(await ok('file:///C:/Users/o/Notes/pics/cat.png'), true, 'in the vault');
  assert.equal(await ok('file:///c:/users/O/notes/Pics/cat.png'), true, 'Windows paths without case');
  assert.equal(await ok('file:///C:/Program%20Files/Ironleaf/resources/app.asar/out/renderer/index.html'), true, 'the app itself');
  assert.equal(await ok('file:///D:/Projects/Bridge/plan.png'), true, 'a project folder on this PC');
  assert.equal(await ok('file://localhost/C:/Users/o/Notes/x.png'), true);
  for (const url of ['file://evil.example/share/x.png', 'file:////evil.example/share/x.png', 'file://///evil.example/share/x.png', 'file:///%5C%5Cevil.example%5Cshare%5Cx.png', 'file:////%3F/UNC/evil.example/share/x.png', 'file:////./pipe/x', 'file:///C:/Users/o/secret.png', 'file:///C:/Users/o/Notes/../secret.png', 'file:///C:/Users/o/NotesEvil/x.png', 'file:///x.png']) {
    assert.equal(await ok(url), false, url);
  }
  // A link inside the vault that leads to a share is refused once its links are followed.
  const realpath = async (p) => (p.toLowerCase().includes('linked') ? '\\\\evil.example\\share\\x.png' : p);
  assert.equal(await ok('file:///C:/Users/o/Notes/linked.png', { ...winOpts, realpath }), false);
  assert.equal(await ok('file:///C:/Users/o/Notes/plain.png', { ...winOpts, realpath }), true);
  // A vault that is itself on a share is the person's choice: its own files show.
  const shareVault = { roots: ['\\\\nas\\team\\Notes'], platform: 'win32' };
  assert.equal(await ok('file:////nas/team/Notes/cat.png', shareVault), true);
  assert.equal(await ok('file:////evil.example/team/Notes/cat.png', shareVault), false, 'another host');
  assert.equal(await ok('https://example.com/x.png'), true, 'not a file: request (other rules hold those)');
});

test('main side (Linux): the same rules', async () => {
  assert.equal(await G.fileRequestAllowed('file:///home/o/Notes/cat.png', nixOpts), true);
  for (const url of ['file://evil.example/x.png', 'file:////evil.example/x.png', 'file:///home/o/.ssh/id_ed25519', 'file:///home/o/Notes/../.bashrc']) assert.equal(await G.fileRequestAllowed(url, nixOpts), false, url);
});

test('the guard is on the window’s session: cancelled requests never leave, others pass untouched', async () => {
  let listener;
  const logged = [];
  G.installFileGuard({ onBeforeRequest: (fn) => (listener = fn) }, () => ({ roots: ['/home/o/Notes'] }), { platform: 'linux', log: (m) => logged.push(m) });
  const ask = (url) => new Promise((resolve) => listener({ url }, resolve));
  assert.deepEqual(await ask('file:///home/o/Notes/cat.png'), {});
  assert.deepEqual(await ask('file://evil.example/x.png'), { cancel: true });
  assert.deepEqual(await ask('https://example.com/'), {});
  assert.equal(logged.length, 1);
  const app = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  assert.match(app, /installFileGuard\(session\.defaultSession\.webRequest, fileRoots,/);
  assert.match(app, /roots: \[\.\.\.\(vault\?\.root \? \[vault\.root\] : \[\]\)/);
  // The print window's own session refuses a file: address naming another computer too.
  assert.match(readFileSync(path.join(root, 'src/main/brand-print.ts'), 'utf8'), /u\.startsWith\('file:'\) && fileUrlPath\(u, process\.platform\) !== null/);
});
