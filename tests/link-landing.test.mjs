// node --test tests/link-landing.test.mjs — doors land where they point (16 Nov 2026, apps-together part
// 3): ironleaf://open?place=…&folder=…&new=…&settings=… from the former host app lands on that exact
// page, not just the app. Each place, a folder, a fresh note and settings, plus the bare open and notes
// still.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-landing-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const stub = path.join(work, 'electron-stub.mjs');
  writeFileSync(stub, 'export const dialog = { showMessageBox: async () => ({ response: 1, checkboxChecked: false }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };\nexport const shell = {};\nexport const app = {};\n');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(entry, [`export * from ${src('src/shared/uri.ts')};`, `export { ExternalEntry } from ${src('src/main/external.ts')};`].join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml', /^node:/], plugins: [{ name: 'electron-stub', resolveId: (id) => (id === 'electron' ? stub : null) }], output: { file: path.join(work, 'landing.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'landing.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('each place parses to that page', () => {
  for (const place of ['today', 'inbox', 'projects', 'tasks', 'meetings', 'notes', 'people', 'graph']) {
    const r = M.parseVaultUri(`ironleaf://open?place=${place}`);
    assert.equal(r.ok, true, place);
    assert.deepEqual(r.action, { kind: 'open', note: '', place });
  }
});

test('folder, fresh notes and settings parse', () => {
  assert.deepEqual(M.parseVaultUri('ironleaf://open?folder=Projects%2FShop').action, { kind: 'open', note: '', folder: 'Projects/Shop' });
  assert.deepEqual(M.parseVaultUri('ironleaf://open?place=notes&folder=Inbox&new=1').action, { kind: 'open', note: '', place: 'notes', folder: 'Inbox', newNote: true });
  assert.deepEqual(M.parseVaultUri('ironleaf://open?settings=models').action, { kind: 'open', note: '', settings: 'models' });
  assert.deepEqual(M.parseVaultUri('ironleaf://open?settings=general&row=Licence').action, { kind: 'open', note: '', settings: 'general', row: 'Licence' });
  assert.deepEqual(M.parseVaultUri('ironleaf://open?row=Licence').action, { kind: 'open', note: '' }, 'a row without its section rides nowhere');
  // A note still wins over a place; the bare open still just opens.
  assert.deepEqual(M.parseVaultUri('ironleaf://open?note=Oven.md&place=today').action, { kind: 'open', note: 'Oven.md' });
  assert.deepEqual(M.parseVaultUri('ironleaf://open').action, { kind: 'open', note: '' });
  // Rubbish lands safely: unknown places and folders outside the vault are dropped, not fatal.
  assert.deepEqual(M.parseVaultUri('ironleaf://open?place=nowhere').action, { kind: 'open', note: '' });
  assert.deepEqual(M.parseVaultUri('ironleaf://open?folder=..%2F..%2FWindows').action, { kind: 'open', note: '' });
});

function entryWith(seen) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'nv-landing-data-'));
  const host = {
    dataDir,
    kind: 'standalone',
    version: 'test',
    icon: '',
    handle: () => {},
    send: () => {},
    window: () => null,
    openWindow: async (target) => void seen.targets.push(target ?? null),
    openSettingsAt: async (section, row) => void seen.settings.push([section, row ?? null]),
    ready: async () => {},
    vaultRoot: () => '/made-up/vault',
    agents: { asPerson: async () => ({ content: [{ type: 'text', text: '' }] }), personNote: (raw) => String(raw), localMcpTools: () => [], asLocalMcp: async () => ({ content: [{ type: 'text', text: '' }] }) },
    readNote: async () => '',
    writeNote: async () => {},
    canWrite: async () => {},
    dailyNote: async () => 'Daily.md',
    freeNote: async (folder, title) => `${folder}/${title}.md`,
    notes: () => [],
  };
  return new M.ExternalEntry(host);
}

test('each place lands in the window', async () => {
  for (const place of ['today', 'inbox', 'projects', 'tasks', 'meetings', 'notes', 'people', 'graph']) {
    const seen = { targets: [], settings: [] };
    const entry = entryWith(seen);
    const r = await entry.link(`ironleaf://open?place=${place}`);
    assert.equal(r.done, true, place);
    assert.deepEqual(seen.targets, [{ place }], place);
  }
});

test('folder, fresh notes and settings land', async () => {
  const folder = { targets: [], settings: [] };
  await entryWith(folder).link('ironleaf://open?folder=Projects%2FShop');
  assert.deepEqual(folder.targets, [{ folder: 'Projects/Shop' }]);
  const fresh = { targets: [], settings: [] };
  await entryWith(fresh).link('ironleaf://open?place=notes&new=1');
  assert.deepEqual(fresh.targets, [{ place: 'notes', newNote: true }]);
  const settings = { targets: [], settings: [] };
  await entryWith(settings).link('ironleaf://open?settings=models');
  assert.deepEqual(settings.settings, [['models', null]]);
  assert.deepEqual(settings.targets, []);
  const row = { targets: [], settings: [] };
  await entryWith(row).link('ironleaf://open?settings=general&row=Licence');
  assert.deepEqual(row.settings, [['general', 'Licence']], 'the row rides through to the window');
  assert.deepEqual(row.targets, []);
  const bare = { targets: [], settings: [] };
  await entryWith(bare).link('ironleaf://open');
  assert.deepEqual(bare.targets, [null]);
});
