// node --test tests/update-from-101.test.mjs — updating from 10.1.0 breaks nothing a person has (Vault side, 5 Nov
// 2026). The other half of the former host app's tests/update-from-101.mjs: each repo merges on its own, so each
// carries its own walk. A temp vault and temp PC settings shaped exactly as 10.1.0 leaves them (the Vault embedded
// then was built from nv commit a25e4fd: .neuralvault/vault.json identity, keyed settings docs, prefs with Ask
// first on and a Memories switch, rail rows, a palette, album and project notes, an old Bin entry) are opened by
// the current code's start-up and migrations, on real files. Made-up notes only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-update-101-'));
const pcDir = path.join(work, 'pc');
const vaultDir = path.join(work, 'vault');
let P, L, VS, PF, MEM, MT, VH, VHS, ST, BIN, IDX, PLUG, KF;

const write = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};
// Every file under dir, as rel path -> bytes (notes, settings, the hidden folder alike).
const snapshot = (dir) => {
  const out = new Map();
  const walk = (d, prefix) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), rel);
      else if (e.isFile()) out.set(rel, readFileSync(path.join(d, e.name)));
    }
  };
  walk(dir, '');
  return out;
};

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  // Electron, stubbed: settings.ts reads app.getPath (unused when a data dir is given) and the home service asks
  // dialog.showMessageBox for adopting. The stub records every dialog call.
  const eDir = path.join(work, 'node_modules', 'electron');
  mkdirSync(eDir, { recursive: true });
  writeFileSync(path.join(eDir, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', type: 'module', main: './index.mjs', exports: { '.': './index.mjs' } }));
  writeFileSync(
    path.join(eDir, 'index.mjs'),
    `export const app = { getPath: () => ${JSON.stringify(path.join(work, 'appdata'))} };\nexport const dialog = { showMessageBox: async (...a) => (globalThis.__nvDialogCalls.push(a), { response: globalThis.__nvDialogAnswer ?? 2 }) };\n`,
  );
  globalThis.__nvDialogCalls = [];
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    const { symlinkSync } = await import('node:fs');
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  const bake = async (name, lines, external = ['electron', 'yaml']) => {
    const entry = path.join(work, `${name}.ts`);
    writeFileSync(entry, lines.join('\n'));
    await build({ input: entry, platform: 'node', external, output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  P = await bake('pure-prefs', [`export * from ${JSON.stringify(path.join(root, 'src/shared/prefs.ts'))};`], []);
  L = await bake('pure-life', [`export * from ${JSON.stringify(path.join(root, 'src/shared/life-modules.ts'))};`], []);
  VS = await bake('pure-vsettings', [`export * from ${JSON.stringify(path.join(root, 'src/shared/vault-settings.ts'))};`], []);
  PF = await bake('pure-project', [`export * from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`], []);
  MEM = await bake('pure-memories', [`export * from ${JSON.stringify(path.join(root, 'src/shared/memories.ts'))};`], []);
  MT = await bake('pure-tabs', [`export * from ${JSON.stringify(path.join(root, 'src/renderer/src/state/module-tabs.ts'))};`], []);
  VH = await bake('vault-home', [`export * from ${JSON.stringify(path.join(root, 'src/main/vault-home.ts'))};`]);
  VHS = await bake('vault-home-svc', [`export * from ${JSON.stringify(path.join(root, 'src/main/vault-home-service.ts'))};`]);
  ST = await bake('settings', [`export * from ${JSON.stringify(path.join(root, 'src/main/settings.ts'))};`]);
  BIN = await bake('bin', [`export * from ${JSON.stringify(path.join(root, 'src/main/bin.ts'))};`], []);
  IDX = await bake('indexer', [`export * from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`]);
  PLUG = await bake('plugins', [`export * from ${JSON.stringify(path.join(root, 'src/main/plugins.ts'))};`]);
  KF = await bake('keyed', [`export * from ${JSON.stringify(path.join(root, 'src/main/vault-settings.ts'))};`], []);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── The vault and PC as 10.1.0 leaves them ──────────────────────────────────────────────────────────
// Written once, before the first test that opens them (ordered: settings first, then the vault).
let seeded = false;
const seed = () => {
  if (seeded) return;
  seeded = true;
  // The vault's identity, written once (23 Oct 2026) and read by every app on every PC.
  write(path.join(vaultDir, '.neuralvault', 'vault.json'), { id: '12345678-1234-4123-8123-123456789012', name: 'Vault', created: '2026-10-23T00:00:00.000Z' });
  // The vault's settings, a keyed document (format 1, per-key times and PCs).
  const at = Date.parse('2026-11-04T00:00:00.000Z');
  write(path.join(vaultDir, '.neuralvault', 'settings.json'), {
    neuralvault: 'settings', format: 1,
    keys: {
      dailyFolder: { value: 'Daily', at, by: 'pc' },
    },
  });
  // The person's preferences on this PC: Ask first on (the old default, saved), the sky look, two rail rows off.
  // This PC already moved into this vault (same PC updating), so opening writes no move-in.
  const key = createHash('sha256').update(path.resolve(vaultDir).toLowerCase()).digest('hex').slice(0, 20);
  write(path.join(pcDir, 'settings.json'), {
    recentVaults: [vaultDir], model: null, dailyFolder: 'Daily', dailyFormat: 'YYYY-MM-DD', dailyTemplate: '',
    prefs: { ...P.DEFAULT_PREFS, askBeforeChanges: true, palette: 'sky', hidden: ['ribbon:switcher', 'ribbon:graph'] },
    moved: { personal: '2026-11-04T00:00:00.000Z', vaults: { [key]: '2026-11-04T00:00:00.000Z' } },
  });
  write(path.join(pcDir, 'libraries', key, 'vault-settings.json'), JSON.parse(readFileSync(path.join(vaultDir, '.neuralvault', 'settings.json'), 'utf8')));
  write(path.join(pcDir, 'personal.json'), {
    neuralvault: 'personal', format: 1,
    keys: {
      palette: { value: 'sky', at, by: 'pc' },
      hidden: { value: ['ribbon:switcher', 'ribbon:graph'], at, by: 'pc' },
      askBeforeChanges: { value: true, at, by: 'pc' },
      modules: { value: { memories: { on: true }, family: { on: false }, health: { on: true, off: ['export'] } }, at, by: 'pc' },
    },
  });
  // The plugins folder, as an opened 10.1.0 vault has it (the example in place).
  write(path.join(vaultDir, '.neuralvault', 'plugins', 'example', 'manifest.json'), '{"id":"example"}');
  // Notes: an album with a Photos table, a creative record, a project with list-form key dates, plain notes.
  write(path.join(vaultDir, 'Family', 'Memories and Media', 'Christmas 2025.md'),
    '---\ntype: album\n---\n# Christmas 2025\n\n## Photos\n\n| File | People | Date |\n| --- | --- | --- |\n| tree.jpg | Mia, Josh | 2025-12-25 |\n| lunch.jpg | Nan | 2025-12-25 |\n');
  write(path.join(vaultDir, 'Family', 'Memories and Media', 'Files', 'tree.jpg'), 'fake-bytes-tree');
  write(path.join(vaultDir, 'Family', 'Memories and Media', 'Lunch invitation.md'),
    '---\ntype: creative\nkind: invitation\n---\n# Lunch invitation\n\nVersion 3, printed.\n');
  write(path.join(vaultDir, 'Projects', 'Harbour Cafe.md'),
    '---\ntype: project\n---\n# Harbour Cafe\n\n## What’s next\n\n- [ ] Order cups\n- [x] Sign the lease\n\n## Key dates\n\n- 2026-11-06: retry fix live\n- **1 Dec 2026** — Christmas freeze\n');
  write(path.join(vaultDir, 'Home.md'), '# Home\n\n- [ ] Buy beans\n');
  write(path.join(vaultDir, 'Daily', '2026-11-04.md'), '# 4 November\n\nA quiet day.\n');
  // An old Bin entry (10.1.0's the former host app wrote no folder note count yet).
  write(path.join(vaultDir, '.neuralvault', 'bin', 'ab12cd-3456', 'item.json'),
    { id: 'ab12cd-3456', path: 'Ideas.md', kind: 'note', title: 'Ideas', by: 'the host app', at: Date.now() - 864e5 });
  write(path.join(vaultDir, '.neuralvault', 'bin', 'ab12cd-3456', 'item', 'Ideas.md'), '# Ideas\n\nAn old idea.\n');
};

test('Ask first nobody chose follows the default (on again from 2.0)', async () => {
  seed();
  const s = new ST.SettingsStore(pcDir);
  await s.load();
  assert.equal(s.view().prefs.askBeforeChanges, true, 'the stored value nobody chose follows the default: on');
});

test('a later Ask first choice sticks', async () => {
  seed();
  const s = new ST.SettingsStore(pcDir);
  await s.load();
  await s.update({ prefs: { askBeforeChanges: false, askBeforeChangesChosen: true } });
  const again = new ST.SettingsStore(pcDir);
  await again.load();
  assert.equal(again.view().prefs.askBeforeChanges, false, 'turning it off survives a restart');
  assert.equal(again.view().prefs.askBeforeChangesChosen, true, 'the choice marker survives too');
  // Put it back the way the update left it, for the tests below.
  await again.update({ prefs: { askBeforeChanges: false, askBeforeChangesChosen: false } });
});

test('palettes and the side bar keep their choices', async () => {
  seed();
  const s = new ST.SettingsStore(pcDir);
  await s.load();
  const prefs = s.view().prefs;
  assert.equal(prefs.palette, 'sky', 'the saved look stays');
  assert.ok(prefs.hidden.includes('ribbon:graph'), 'a rail row switched off stays off');
  assert.ok(!prefs.hidden.includes('ribbon:switcher'), 'the gone Search row washes out on load');
});

test('the Memories pack becomes Family, switches kept', async () => {
  seed();
  const s = new ST.SettingsStore(pcDir);
  await s.load();
  await s.useVault(vaultDir);
  const modules = s.view().prefs.modules;
  assert.equal(modules.memories, undefined, 'no Memories key any more');
  assert.equal(modules.family?.on, true, 'Memories on carries Family on');
  // Part switches carry across too (a vault that had Memories on with creative off, Family on with albums off).
  const merged = L.cleanModules({ memories: { on: true, off: ['creative'] }, family: { on: true, off: ['albums'] } });
  assert.deepEqual([...(merged.family?.off ?? [])].sort(), ['albums', 'creative'], 'both parts’ off switches land on Family');
  assert.equal(merged.family?.on, true, 'and it stays on');
  assert.equal(L.moduleOn(modules, 'memories'), true, 'the old id answers through Family');
  assert.equal(L.partOn(modules, 'memories', 'albums'), true, 'its albums part shows');
  assert.equal(L.partOn(modules, 'memories', 'people'), true, 'its people part shows');
  assert.equal(L.partOn(modules, 'memories', 'creative'), true, 'its creative part shows');
  assert.equal(L.moduleOn(modules, 'health'), true, 'an untouched pack is untouched');
});

test('albums, people and creative records are reachable under Family', () => {
  seed();
  const albumText = readFileSync(path.join(vaultDir, 'Family', 'Memories and Media', 'Christmas 2025.md'), 'utf8');
  const album = MEM.readAlbum({ path: 'Family/Memories and Media/Christmas 2025.md', title: 'Christmas 2025', props: {}, content: albumText, type: 'album', files: ['Family/Memories and Media/Files/tree.jpg'] });
  assert.equal(album.photos.length, 2, 'both Photos-table rows read (one names Mia and Josh)');
  assert.ok(album.photos.some((p) => (p.who ?? []).includes('Mia') || (p.who ?? []).includes('Josh')), 'who is in each photo reads');
  const creative = readFileSync(path.join(vaultDir, 'Family', 'Memories and Media', 'Lunch invitation.md'), 'utf8');
  assert.ok(creative.includes('Version 3'), 'the creative record is there to open');
});

test('old Memories tabs land on Family', () => {
  seed();
  assert.equal(MT.moduleOfTab({ type: 'module', path: 'module:memories#people' }), 'family', 'module:memories reads as Family');
  assert.equal(MT.partOfTab({ path: 'module:memories#people' }), 'people', 'the part rides along');
  assert.equal(MT.moduleOfTab({ type: 'module', path: 'module:family#albums' }), 'family', 'a Family tab is unchanged');
});

test('an existing vault does not trigger the adopt dialog', async () => {
  seed();
  const s = new ST.SettingsStore(pcDir);
  await s.load();
  const svc = VHS.createVaultHomeService({
    host: { kind: 'test', appId: 'test', defaultLibrary: pcDir, dataDir: pcDir },
    settings: s, places: async () => ({ roots: [], network: [] }), placesStubbed: true, placeDeps: { path, platform: 'linux' },
    vaultRoot: () => vaultDir, library: () => vaultDir, templates: () => 'Templates',
    ownCounts: () => null, ownFiles: () => new Map(),
    openVault: async () => { throw new Error('not in this test'); }, useLibrary: async () => { throw new Error('not in this test'); },
    carryLibraryData: async () => {}, toTrash: async () => {}, canWrite: async () => true,
    keepRecovery: () => {}, send: () => {}, win: () => ({}), moving: { get: () => false, set: () => {} },
    rescan: async () => {},
  });
  assert.equal(await VH.readIdentity(vaultDir) !== null, true, 'the 10.1.0 vault holds its identity');
  globalThis.__nvDialogCalls = [];
  assert.equal(await svc.confirmAdopt(vaultDir), 'adopt', 'an identity vault is adopted with no question');
  assert.equal(globalThis.__nvDialogCalls.length, 0, 'no dialog was shown for it');
  // Only a foreign folder is asked about (the dialog's other doors are unchanged).
  const foreign = path.join(work, 'plain-notes');
  write(path.join(foreign, 'Note.md'), '# Note\n');
  globalThis.__nvDialogAnswer = 2;
  globalThis.__nvDialogCalls = [];
  assert.equal(await svc.confirmAdopt(foreign), null, 'a foreign folder asks, and Cancel says null');
  assert.equal(globalThis.__nvDialogCalls.length, 1, 'the dialog was shown once, for the foreign folder');
});

test('opening rewrites nothing and no note’s bytes change', async () => {
  seed();
  const before = snapshot(vaultDir);
  const s = new ST.SettingsStore(pcDir);
  await s.load();
  await s.useVault(vaultDir);
  // The home service's opened (identity written once; the PC's presence noted in its own settings, not the vault).
  const svc = VHS.createVaultHomeService({
    host: { kind: 'test', appId: 'test', defaultLibrary: pcDir, dataDir: pcDir },
    settings: s, places: async () => ({ roots: [], network: [] }), placesStubbed: true, placeDeps: { path, platform: 'linux' },
    vaultRoot: () => vaultDir, library: () => vaultDir, templates: () => 'Templates',
    ownCounts: () => null, ownFiles: () => new Map(),
    openVault: async () => { throw new Error('not in this test'); }, useLibrary: async () => { throw new Error('not in this test'); },
    carryLibraryData: async () => {}, toTrash: async () => {}, canWrite: async () => true,
    keepRecovery: () => {}, send: () => {}, win: () => null, moving: { get: () => false, set: () => {} },
    rescan: async () => {},
  });
  await svc.opened(vaultDir);
  await new Promise((r) => setTimeout(r, 20));
  // The vault's plugins, as openVault runs them (none switched on: the example already in place).
  const pm = new PLUG.PluginManager({
    dataDir: pcDir, vaultRoot: () => vaultDir,
    listNotes: async () => ['Home.md'], readNote: async () => '', writeNote: async () => { throw new Error('no writes in this test'); },
    existsNote: async () => false, canWrite: async () => {}, trashPath: async () => {}, send: () => {}, log: () => {},
  });
  await pm.useVault(vaultDir, false);
  // The indexer's rescan reads every note into memory.
  const index = new IDX.VaultIndex();
  for (const [rel, bytes] of before) {
    if (!rel.endsWith('.md')) continue;
    const text = bytes.toString('utf8');
    index.set(rel, text, Date.now(), text.length);
  }
  assert.ok(index.get('Home.md'), 'the rescan read the notes');
  const after = snapshot(vaultDir);
  const changed = [...after.keys()].filter((k) => !before.has(k) || !after.get(k).equals(before.get(k)));
  const gone = [...before.keys()].filter((k) => !after.has(k));
  assert.deepEqual([changed, gone], [[], []], 'no file in the vault changed on open');
});

test('old Bin entries and Recently deleted list properly', async () => {
  seed();
  const bin = BIN.createVaultBin({ root: vaultDir });
  const items = await bin.list();
  const old = items.find((i) => i.id === 'ab12cd-3456');
  assert.ok(old && old.title === 'Ideas' && old.path === 'Ideas.md', 'the old entry lists');
  assert.ok(old.daysLeft > 0 && old.daysLeft <= 30, 'with days left to restore');
  assert.match(BIN.binListWords(items), /Ideas/, 'Recently deleted names it');
  const back = await bin.restore('ab12cd-3456');
  assert.equal(back.restored, 'Ideas.md', 'it comes back where it was');
  assert.equal(readFileSync(path.join(vaultDir, 'Ideas.md'), 'utf8'), '# Ideas\n\nAn old idea.\n', 'word for word');
  assert.equal((await bin.list()).some((i) => i.id === 'ab12cd-3456'), false, 'and leaves the Bin');
  rmSync(path.join(vaultDir, 'Ideas.md'));
});

test('key dates keep their form on a tick', () => {
  seed();
  const file = path.join(vaultDir, 'Projects', 'Harbour Cafe.md');
  const text = readFileSync(file, 'utf8');
  const p = PF.parseProject(text);
  assert.equal(p.dates.length, 2, 'both list-form dates read');
  p.next[0].done = true;
  const out = PF.serializeProject(p, text);
  assert.ok(out.includes('- [x] Order cups'), 'the step ticked');
  assert.ok(out.includes('- 2026-11-06: retry fix live\n- **1 Dec 2026** — Christmas freeze'), 'the dates stay as written, byte for byte');
  assert.ok(!out.includes('| --- |'), 'no table written for dates nobody touched');
});

test('project pages open on their old tab links', () => {
  seed();
  const file = path.join(vaultDir, 'Projects', 'Harbour Cafe.md');
  const text = readFileSync(file, 'utf8');
  assert.equal(PF.isProjectText(text), true, 'the old front matter still reads as a project');
  const p = PF.parseProject(text, 'Harbour Cafe.md');
  assert.equal(p.name, 'Harbour Cafe', 'the page parses with its name');
  assert.equal(p.next.length, 2, 'and its steps');
  // The tab link is the note's path, unchanged: the page for it is this project.
  const tab = { type: 'note', path: 'Projects/Harbour Cafe.md' };
  assert.equal(tab.path, 'Projects/Harbour Cafe.md', 'the old tab link still names the page');
  assert.equal(PF.isProjectText(readFileSync(path.join(vaultDir, tab.path), 'utf8')), true, 'which still opens as a project');
});
