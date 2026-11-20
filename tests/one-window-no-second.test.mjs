// node --test tests/one-window-no-second.test.mjs — one product steps 6 and 7 (9 Nov 2026): the switch
// and the second window go; the Start entry opens Notes. With the flag on (the host says so), no code
// path creates Vault's BrowserWindow: every internal caller — deep links, the command, loose files,
// reminders, health, agents, Settings doors — lands in the former host app's one window through the
// host instead. Private notes lock as the window's close left them, through closePrivate. Off, or on
// its own (no such hook), the window opens exactly as today. Each test fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-no-second-'));
let V;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/vault-view.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'v.mjs'), format: 'esm' }, logLevel: 'silent' });
  V = await import(pathToFileURL(path.join(work, 'v.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the host says whether the window is gone: strict, and safe when the host cannot', () => {
  assert.equal(typeof V.vaultWindowSuppressed, 'function', 'one decider, beside the view contract');
  assert.equal(V.vaultWindowSuppressed({}), false, 'no hook means the window, as on its own');
  assert.equal(V.vaultWindowSuppressed({ inWindow: () => false }), false, 'the flag off means the window');
  assert.equal(V.vaultWindowSuppressed({ inWindow: () => true }), true, 'the flag on means no window');
  assert.equal(V.vaultWindowSuppressed({ inWindow: () => '1' }), false, 'anything but true means the window');
  assert.equal(
    V.vaultWindowSuppressed({ inWindow: () => { throw new Error('gone'); } }),
    false,
    'a host that cannot say means the window, never a throw',
  );
});

test('opening Vault with the flag on never makes a window: the host shows the one window', () => {
  const at = src.indexOf('async function openWindow(');
  assert.ok(at > 0, 'openWindow exists');
  const body = src.slice(at, at + 3200);
  assert.match(body, /vaultWindowSuppressed\(host\)/, 'the gate is first');
  assert.match(body, /host\.showInWindow\?\.?\(target\)/, 'the target rides to the one window');
  assert.ok(body.indexOf('vaultWindowSuppressed(host)') < body.indexOf('pendingNote'), 'before a note is even kept');
  assert.ok(body.indexOf('vaultWindowSuppressed(host)') < body.indexOf('createWindow()'), 'and long before a window could be made');
  const gate = body.slice(body.indexOf('if (vaultWindowSuppressed(host))'), body.indexOf('if (target?.note) pendingNote'));
  assert.match(gate, /catch/, 'a host that fails says so in the log');
  assert.match(gate, /return;/, 'and still no window is made');
});

test('one window-maker in the whole main side, behind that gate', () => {
  const makers = src.match(/win = createWindow\(\);/g) || [];
  assert.equal(makers.length, 1, 'openWindow alone makes the window');
  const windows = src.match(/new BrowserWindow/g) || [];
  assert.equal(windows.length, 1, 'one BrowserWindow: the second window, and only it');
  assert.ok(src.includes('function createWindow(): BrowserWindow'), 'made by createWindow');
});

test('every way in lands through the gate: links, files, reminders, health, agents', () => {
  assert.ok(src.includes('openWindow: (target) => openWindow(target)'), 'deep links, the command and loose files');
  assert.ok(src.includes('const open = () => void openWindow({ note: note.path, line: note.line })'), 'a reminder’s notice');
  assert.ok(src.includes('openHealth: () => void openWindow()'), 'a health notice');
  assert.ok(src.includes('void openWindow().then(() => send('), 'an agent notice');
  assert.ok(src.includes("app.on('second-instance', (_event, argv) => void external.launch(argv))"), 'a second launch');
  const cli = readFileSync(path.join(root, 'src/main/external.ts'), 'utf8');
  assert.ok(cli.includes('open: (rel) => h.openWindow({ note: rel })'), 'the command opening a note');
});

test('Settings doors reach a window only through the gate (the host app sends them to the one Settings)', () => {
  const at = src.indexOf('openSettingsAt: async (section: string, row?: string) => {');
  assert.ok(at > 0, 'openSettingsAt exists');
  const body = src.slice(at, at + 900);
  assert.match(body, /await openWindow\(\);/, 'through the gated open, never a window of its own');
  assert.ok(!body.includes('createWindow(') && !body.includes('new BrowserWindow'), 'no window-maker here');
});

test('private notes lock as the window’s close leaves them', () => {
  assert.match(src, /closePrivate: \(\) => void;/, 'the app names the lock');
  const at = src.indexOf('closePrivate: () => {');
  assert.ok(at > 0, 'and keeps it');
  const body = src.slice(at, at + 400);
  assert.match(body, /secrets\.clearClipboardNow\(\)/, 'the clipboard goes, as the window’s close does');
  assert.match(body, /privateNotes\.close\(\)/, 'the words leave memory, the remembered period kept');
});

test('the host contract names the one-window hooks', () => {
  assert.match(src, /inWindow\?\(\): boolean;/, 'whether the window is gone');
  assert.match(src, /showInWindow\?\(target\?: \{[^}]*\}\): Promise<unknown>;/, 'showing the one window on a target');
});

test('remembered bounds stay the window’s own: untouched while the window never opens', () => {
  assert.equal((src.match(/savedWindow/g) || []).length, 2, 'read only to place the window');
  assert.equal((src.match(/rememberWindow/g) || []).length, 2, 'written only by the window’s own moves');
  assert.equal((src.match(/windowFile/g) || []).length, 3, 'the file touched only there');
  for (const fn of ['function attachView(', 'async function openInView(', 'async function flushView(']) {
    const at = src.indexOf(fn);
    assert.ok(at > 0, `${fn} exists`);
    const body = src.slice(at, src.indexOf('\n  }\n', at));
    assert.ok(!body.includes('new BrowserWindow'), `${fn} never makes a window`);
  }
});

test('flag off and on its own: the window opens exactly as today', () => {
  const at = src.indexOf('async function openWindow(');
  const body = src.slice(at, at + 3200);
  assert.ok(body.includes('win = createWindow();'), 'past the gate, the window is made');
  assert.ok(body.includes('win.show();'), 'and shown, as today');
  const standalone = readFileSync(path.join(root, 'src/main/index.ts'), 'utf8');
  assert.ok(!standalone.includes('inWindow'), 'on its own there is no such hook, so always the window');
});
