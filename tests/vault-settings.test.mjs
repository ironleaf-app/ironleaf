// node --test tests/vault-settings.test.mjs — The vault looks the same on every PC (24 Oct 2026, WS1 step 0;
// src/shared/vault-settings.ts, src/main/vault-settings.ts, settings.ts, library-state.ts, src/shared/vault-sync.ts,
// src/main/vault-sync.ts). Made-up PCs in temporary folders, never anyone's real vault: every setting has a home; this
// PC's settings move to their homes the first time (a backup kept, nothing lost); two PCs changing the vault's settings at
// once merge key by key (newer wins), OneDrive's conflict copies of the file merged in; files only in the cloud, OneDrive
// paused or stopped, and conflict copies of notes found (Windows' answers simulated), merged or kept.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-shared-'));
let VS, KF, ST, LS, SY, MS, P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const electron = { name: 'electron-stand-in', resolveId: (id) => (id === 'electron' ? '\0electron' : null), load: (id) => (id === '\0electron' ? 'export const shell = { trashItem: async () => {} }; export const app = { getPath: () => "", isPackaged: false };' : null) };
  const one = async (input, file) => {
    await build({ input: path.join(root, input), platform: 'node', plugins: [electron], output: { file: path.join(work, file), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, file)).href);
  };
  VS = await one('src/shared/vault-settings.ts', 'vs.mjs');
  KF = await one('src/main/vault-settings.ts', 'kf.mjs');
  ST = await one('src/main/settings.ts', 'settings.mjs');
  LS = await one('src/main/library-state.ts', 'ls.mjs');
  SY = await one('src/shared/vault-sync.ts', 'sync.mjs');
  MS = await one('src/main/vault-sync.ts', 'msync.mjs');
  P = await one('src/shared/prefs.ts', 'prefs.mjs');
});
after(() => rmSync(work, { recursive: true, force: true }));

const put = (abs, text) => {
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
};
const json = (abs) => JSON.parse(readFileSync(abs, 'utf8'));
let n = 0;
const dir = (name) => {
  const d = path.join(work, `${name}-${++n}`);
  mkdirSync(d, { recursive: true });
  return d;
};

// ── Every setting has a home ─────────────────────────────────────────────────────────────────────────────────────────

test('every preference has one home, and the obvious ones are where a person expects', () => {
  const keys = Object.keys(P.DEFAULT_PREFS);
  for (const k of keys) assert.ok(VS.PREF_HOME[k], `${k} has a home`);
  assert.equal(Object.keys(VS.PREF_HOME).length, keys.length, 'nothing classified that isn’t a preference');
  for (const k of ['attachmentsFolder', 'templatesFolder', 'newNoteFolder', 'excluded', 'linkFormat', 'wikilinks', 'snippets', 'captureFlows']) assert.equal(VS.PREF_HOME[k], 'vault', `${k}: the vault's`);
  for (const k of ['theme', 'palette', 'accent', 'fontSize', 'textFont', 'hotkeys', 'captureKey', 'spellcheck', 'tabSize']) assert.equal(VS.PREF_HOME[k], 'personal', `${k}: the person's`);
  for (const k of ['zoom', 'recoveryMinutes', 'meetingMic', 'fileSearch']) assert.equal(VS.PREF_HOME[k], 'pc', `${k}: this PC's`);
  for (const k of ['dailyFolder', 'dailyFormat', 'dailyTemplate']) assert.equal(VS.SETTING_HOME[k], 'vault');
  for (const k of ['model', 'library', 'lastVault', 'projectFolders', 'current']) assert.equal(VS.SETTING_HOME[k], 'pc');
  // What Ironleaf remembers about a vault.
  assert.equal(VS.STATE_PLAN.workspace.home, 'pc', 'open tabs: this PC');
  assert.equal(VS.STATE_PLAN.bookmarks.home, 'vault');
  assert.deepEqual([...VS.STATE_PLAN.explorer.vault], ['mode', 'sort', 'sections', 'order', 'showAttachments'], 'the side bar’s order is the vault’s, open folders this PC’s');
  assert.equal(VS.STATE_PLAN.backup.home, 'pc');
});

test('hidden items split: Today’s sections and a project page’s are the vault’s, the side bar’s buttons the person’s', () => {
  const parts = VS.splitPrefs({ hidden: ['today:brief', 'ribbon:graph', 'project:canvas', 'status:words', 'home:ask'], fontSize: 18, attachmentsFolder: 'Files', zoom: 1.25 });
  assert.deepEqual(parts.vault, { hidden: ['today:brief', 'project:canvas', 'home:ask'], attachmentsFolder: 'Files' });
  assert.deepEqual(parts.personal, { hidden: ['ribbon:graph', 'status:words'], fontSize: 18 });
  assert.deepEqual(parts.pc, { zoom: 1.25 });
  const back = VS.joinPrefs({ zoom: 1.25, fontSize: 12, attachmentsFolder: 'Old' }, parts.personal, parts.vault);
  assert.equal(back.fontSize, 18, 'the person’s over this PC’s copy');
  assert.equal(back.attachmentsFolder, 'Files', 'the vault’s over this PC’s copy');
  assert.equal(back.zoom, 1.25);
  assert.deepEqual([...back.hidden].sort(), ['home:ask', 'project:canvas', 'ribbon:graph', 'status:words', 'today:brief']);
  // A personal value written into the vault's file (by hand, or an older copy) is never taken from there.
  assert.equal(VS.joinPrefs({ fontSize: 12 }, {}, { fontSize: 30 }).fontSize, 12);
});

test('memories split and join: the side bar’s order travels, its open folders don’t; a project’s list or grid travels', () => {
  const ex = { mode: 'sections', order: { places: ['b', 'a'] }, expanded: ['Projects'], open: ['x'] };
  assert.deepEqual(VS.splitState('explorer', ex).vault, { mode: 'sections', order: { places: ['b', 'a'] } });
  assert.deepEqual(VS.joinState('explorer', { expanded: ['Here'], mode: 'folders' }, { mode: 'sections', order: { places: ['b', 'a'] } }), { expanded: ['Here'], mode: 'sections', order: { places: ['b', 'a'] } });
  const pj = { 'Projects/A.md': { view: 'grid', open: ['Docs'], tab: 'timeline', planZoom: 'week' } };
  assert.deepEqual(VS.splitState('projects', pj).vault, { 'Projects/A.md': { view: 'grid', planZoom: 'week' } });
  assert.deepEqual(VS.joinState('projects', { 'Projects/A.md': { open: ['Here'], view: 'list' } }, { 'Projects/A.md': { view: 'grid' }, 'Projects/B.md': { sort: 'name' } }), { 'Projects/A.md': { open: ['Here'], view: 'grid' }, 'Projects/B.md': { sort: 'name' } });
  assert.deepEqual(VS.splitState('bookmarks', [{ id: '1' }]).vault, { _: [{ id: '1' }] });
  assert.deepEqual(VS.joinState('bookmarks', [], { _: [{ id: '1' }] }), [{ id: '1' }]);
  assert.equal(VS.splitState('workspace', { root: {} }).vault, null, 'open tabs never travel');
  assert.equal(VS.splitState('something-new', { a: 1 }).vault, null, 'a memory not planned stays on this PC');
});

// ── Keyed documents ──────────────────────────────────────────────────────────────────────────────────────────────────

test('keyed documents merge key by key, newer wins, the same either way round; a deliberate change beats one brought in', () => {
  const a = { neuralvault: 'settings', format: 1, keys: { x: { value: 1, at: 10, by: 'A' }, y: { value: 'a', at: 30, by: 'A' } } };
  const b = { neuralvault: 'settings', format: 1, keys: { x: { value: 2, at: 20, by: 'B' }, y: { value: 'b', at: 25, by: 'B' }, z: { value: true, at: 5, by: 'B' } } };
  const ab = VS.mergeDocs(a, b);
  assert.deepEqual(VS.docValues(ab), { x: 2, y: 'a', z: true });
  assert.equal(VS.docText(ab), VS.docText(VS.mergeDocs(b, a)), 'A into B is B into A');
  const moved = { neuralvault: 'settings', format: 1, keys: { x: { value: 'brought', at: 99, by: 'B', moved: true } } };
  assert.equal(VS.docValues(VS.mergeDocs(a, moved)).x, 1, 'a deliberate change (older) beats one brought in (newer)');
  const { doc, changed } = VS.setValues(ab, { x: 2, y: 'c' }, 50, 'A');
  assert.deepEqual(changed, ['y'], 'only what differs is stamped');
  assert.equal(doc.keys.x.at, 20);
  assert.equal(VS.readDoc('{"format":1,"keys":{"ok":{"value":1,"at":1,"by":"A"},"bad":{"at":"x"}}}', 's').keys.bad, undefined, 'a bad entry is left out');
  assert.equal(VS.readDoc('{"format":1,"keys":{"x":', 's'), null, 'half written: unreadable');
  // Moving a PC's settings in: only values it changed from the default.
  const m = VS.moveIn(null, 'settings', { attachmentsFolder: 'Files', templatesFolder: 'Templates' }, { attachmentsFolder: 'Attachments', templatesFolder: 'Templates' }, 7, 'A');
  assert.deepEqual(m.taken, ['attachmentsFolder']);
});

test('conflict copies of a keyed document are found by OneDrive’s and Dropbox’s names', () => {
  assert.deepEqual(VS.docConflictCopies('settings.json', ['settings.json', 'settings-OFFICE-PC.json', 'settings-DESKTOP-4KQ2J7M-2.json', 'settings (Mia’s conflicted copy 2026-10-23).json', "settings (Mia's conflicted copy 2026-10-23).json", 'types.json', 'settings.json.123.nvtmp']), ['settings-OFFICE-PC.json', 'settings-DESKTOP-4KQ2J7M-2.json', 'settings (Mia’s conflicted copy 2026-10-23).json', "settings (Mia's conflicted copy 2026-10-23).json"]);
});

// ── Two PCs, one vault: the file on disk ─────────────────────────────────────────────────────────────────────────────

test('two PCs change the vault’s settings at once: both changes kept, the newer of the same one wins, nothing half written', async () => {
  const vault = dir('vault');
  const file = path.join(vault, '.neuralvault', 'settings.json');
  let clock = 1000;
  const pc = (id) => new KF.KeyedFile({ file, mirror: path.join(work, `mirror-${id}-${n}.json`), kind: 'settings', device: () => id, now: () => clock });
  const office = pc('office');
  const laptop = pc('laptop');
  await office.load();
  await laptop.load();
  // Both write at the same moment, different keys (each read the file before the other wrote).
  clock = 2000;
  await Promise.all([office.set({ attachmentsFolder: 'Files' }), laptop.set({ templatesFolder: 'My templates' })]);
  await office.load();
  assert.deepEqual(VS.docValues(VS.readDoc(readFileSync(file, 'utf8'), 'settings')), { attachmentsFolder: 'Files', templatesFolder: 'My templates' }, 'both changes are in the file');
  // The same key: the later change wins on both.
  clock = 3000;
  await office.set({ linkFormat: 'relative' });
  clock = 4000;
  await laptop.set({ linkFormat: 'absolute' });
  await office.refresh();
  assert.equal(office.values().linkFormat, 'absolute');
  assert.ok(!readdirSync(path.dirname(file)).some((f) => f.endsWith('.nvtmp')), 'no temporary files left');
});

test('two writers starting together both land with no recovery load (every interleaving, 2 Nov 2026 lnvset)', async () => {
  // No shared lock: both read empty and the last rename wins, so the file holds one key until the loser loads again.
  for (let round = 0; round < 20; round++) {
    const vault = dir('race');
    const file = path.join(vault, '.neuralvault', 'settings.json');
    let clock = 2000;
    const pc = (id) => new KF.KeyedFile({ file, mirror: path.join(work, `racem-${id}-${n}.json`), kind: 'settings', device: () => id, now: () => clock });
    await Promise.all([pc(`office-${round}`).set({ attachmentsFolder: 'Files' }), pc(`laptop-${round}`).set({ templatesFolder: 'My templates' })]);
    assert.deepEqual(VS.docValues(VS.readDoc(readFileSync(file, 'utf8'), 'settings')), { attachmentsFolder: 'Files', templatesFolder: 'My templates' }, `round ${round}: both changes are in the file straight away`);
  }
});

test('sets, loads and refreshes overlapping never lose a key and both PCs agree', async () => {
  const vault = dir('vault');
  const file = path.join(vault, '.neuralvault', 'settings.json');
  const pc = (id) => new KF.KeyedFile({ file, mirror: path.join(work, `mix-${id}-${n}.json`), kind: 'settings', device: () => id, now: () => 2000 });
  const a = pc('a-mix');
  const b = pc('b-mix');
  await Promise.all([a.set({ attachmentsFolder: 'Files' }), b.set({ templatesFolder: 'T' }), a.refresh(), b.load(), a.set({ linkFormat: 'relative' }), b.set({ newNoteFolder: 'Notes' })]);
  assert.deepEqual(VS.docValues(VS.readDoc(readFileSync(file, 'utf8'), 'settings')), { attachmentsFolder: 'Files', templatesFolder: 'T', linkFormat: 'relative', newNoteFolder: 'Notes' }, 'all four keys land');
  await a.load();
  await b.load();
  assert.deepEqual(a.values(), b.values(), 'both PCs agree after catching up');
  assert.ok(!readdirSync(path.dirname(file)).some((f) => f.endsWith('.nvtmp')), 'no temporary files left');
});

test('a change the vault refused goes in on the next refresh, not the next edit', async () => {
  const vault = dir('vault');
  const file = path.join(vault, '.neuralvault', 'settings.json');
  const mirror = path.join(work, `pending-${n}.json`);
  let may = false;
  const f = new KF.KeyedFile({ file, mirror, kind: 'settings', device: () => 'pc', mayWrite: async () => may });
  await f.load();
  await f.set({ attachmentsFolder: 'Files' });
  assert.ok(!existsSync(file), 'nothing written into the vault yet');
  may = true;
  await f.refresh();
  assert.equal(VS.docValues(VS.readDoc(readFileSync(file, 'utf8'), 'settings')).attachmentsFolder, 'Files', 'the 20-second check flushes what waited');
  assert.ok(!(await f.refresh()), 'nothing new: nothing changes');
});

test('a safety copy that cannot be kept says so', async () => {
  const vault = dir('vault');
  const file = path.join(vault, '.neuralvault', 'settings.json');
  const blocker = path.join(work, `blocker-${n}.json`);
  writeFileSync(blocker, 'x');
  const logs = [];
  const f = new KF.KeyedFile({ file, mirror: path.join(blocker, 'mirror.json'), kind: 'settings', device: () => 'pc', log: (m) => logs.push(m) });
  await f.load();
  await f.set({ attachmentsFolder: 'Files' });
  assert.equal(VS.docValues(VS.readDoc(readFileSync(file, 'utf8'), 'settings')).attachmentsFolder, 'Files', 'the vault still gets it');
  assert.ok(logs.some((m) => /own copy/.test(m)), `the kept copy failing is said, got: ${logs.join(' | ')}`);
});

test('settings write through the one safe path with one lock per file', () => {
  const src = readFileSync(path.join(root, 'src/main/vault-settings.ts'), 'utf8');
  assert.ok(src.includes('writeFileAtomic'), 'temp, fsync, rename with a retry for brief locks, as notes do');
  assert.ok(src.includes('KeyedQueue'), 'one lock per file shared across writers');
  assert.ok(!src.includes('Math.random'), 'no own temp-name lottery left');
});

test('OneDrive’s conflict copy of the settings file is merged in and removed', async () => {
  const vault = dir('vault');
  const nv = path.join(vault, '.neuralvault');
  put(path.join(nv, 'settings.json'), VS.docText({ neuralvault: 'settings', format: 1, keys: { attachmentsFolder: { value: 'Files', at: 100, by: 'office' }, linkFormat: { value: 'relative', at: 100, by: 'office' } } }));
  put(path.join(nv, 'settings-TRAVEL-LAPTOP.json'), VS.docText({ neuralvault: 'settings', format: 1, keys: { linkFormat: { value: 'absolute', at: 200, by: 'laptop' }, templatesFolder: { value: 'T', at: 150, by: 'laptop' } } }));
  const f = new KF.KeyedFile({ file: path.join(nv, 'settings.json'), kind: 'settings', device: () => 'office' });
  await f.load();
  assert.deepEqual(f.values(), { attachmentsFolder: 'Files', linkFormat: 'absolute', templatesFolder: 'T' });
  assert.ok(!existsSync(path.join(nv, 'settings-TRAVEL-LAPTOP.json')), 'the copy is gone once merged');
  assert.deepEqual(VS.docValues(VS.readDoc(readFileSync(path.join(nv, 'settings.json'), 'utf8'))), f.values(), 'and the file holds it all');
  assert.equal(f.mergedCopies, 1);
});

test('a vault that can’t be written yet keeps changes on this PC and writes them later; a newer Ironleaf’s file is never written over; an unreadable one is put aside', async () => {
  const vault = dir('vault');
  const file = path.join(vault, '.neuralvault', 'settings.json');
  const mirror = path.join(work, `mirror-ro-${n}.json`);
  let may = false;
  const f = new KF.KeyedFile({ file, mirror, kind: 'settings', device: () => 'pc', mayWrite: async () => may });
  await f.load();
  await f.set({ attachmentsFolder: 'Files' });
  assert.ok(!existsSync(file), 'nothing written into the vault');
  assert.equal(VS.docValues(VS.readDoc(readFileSync(mirror, 'utf8'))).attachmentsFolder, 'Files', 'kept on this PC');
  may = true;
  const g = new KF.KeyedFile({ file, mirror, kind: 'settings', device: () => 'pc', mayWrite: async () => may });
  await g.load();
  assert.equal(VS.docValues(VS.readDoc(readFileSync(file, 'utf8'))).attachmentsFolder, 'Files', 'written once it may be');
  // A newer format.
  const newer = '{"neuralvault":"settings","format":2,"entries":[]}';
  writeFileSync(file, newer);
  const h = new KF.KeyedFile({ file, mirror, kind: 'settings', device: () => 'pc' });
  await h.load();
  await h.set({ linkFormat: 'relative' });
  assert.equal(readFileSync(file, 'utf8'), newer, 'a newer Ironleaf’s file is left as it is');
  // Half written.
  writeFileSync(file, '{"neuralvault":"settings","format":1,"keys":{"x":');
  const i = new KF.KeyedFile({ file, mirror, kind: 'settings', device: () => 'pc' });
  await i.load();
  assert.ok(readdirSync(path.dirname(file)).some((x) => /^settings\.unreadable-\d+\.json$/.test(x)), 'the unreadable file is kept aside');
  assert.equal(VS.docValues(VS.readDoc(readFileSync(file, 'utf8'))).attachmentsFolder, 'Files', 'and this PC’s copy written in its place');
});

// ── This PC's settings move to their homes the first time ────────────────────────────────────────────────────────────

const oldSettings = (prefs, extra = {}) => JSON.stringify({ lastVault: '', recentVaults: [], model: { provider: 'anthropic', model: 'claude-haiku' }, dailyFolder: 'Journal', dailyFormat: 'YYYY-MM-DD', dailyTemplate: '', prefs, ...extra }, null, 2);

test('the first start moves this PC’s settings to their homes: nothing lost, a backup kept, the window sees the same', async () => {
  const data = dir('userdata');
  const vault = dir('vault');
  put(path.join(data, 'settings.json'), oldSettings({ fontSize: 19, palette: 'mint', attachmentsFolder: 'Files', hidden: ['today:brief', 'ribbon:graph'], zoom: 1.25, meetingMic: 'mic-1' }));
  const s = new ST.SettingsStore(data);
  s.device = () => 'office-id';
  await s.load();
  const before = JSON.stringify(s.raw.prefs);
  assert.ok(existsSync(path.join(data, 'settings.before-shared.json')), 'the settings as they were, kept');
  const personal = VS.docValues(VS.readDoc(readFileSync(path.join(data, 'personal.json'), 'utf8')));
  assert.equal(personal.fontSize, 19);
  assert.equal(personal.palette, 'mint');
  assert.deepEqual(personal.hidden, ['ribbon:graph']);
  assert.equal(personal.zoom, undefined, 'the window’s size stays this PC’s');
  assert.equal(personal.attachmentsFolder, undefined);
  await s.useVault(vault);
  const vs = VS.docValues(VS.readDoc(readFileSync(path.join(vault, '.neuralvault', 'settings.json'), 'utf8')));
  assert.deepEqual(vs, { attachmentsFolder: 'Files', dailyFolder: 'Journal', hidden: ['today:brief'] }, 'only the vault’s settings, only those changed from the default');
  assert.equal(JSON.stringify(s.raw.prefs), before, 'the settings in use are the same as before');
  assert.equal(s.raw.dailyFolder, 'Journal');
  assert.equal(json(path.join(data, 'settings.json')).prefs.meetingMic, 'mic-1', 'settings.json still has this PC’s copy of everything');
  assert.ok(json(path.join(data, 'settings.json')).moved.vaults, 'and remembers the move');
});

test('a second PC opens the same vault: the vault’s settings show there; its own look stays its own; a change goes to the right home', async () => {
  const vault = dir('vault');
  // Office-PC first.
  const officeData = dir('office');
  put(path.join(officeData, 'settings.json'), oldSettings({ fontSize: 19, attachmentsFolder: 'Files', templatesFolder: 'Office templates', hidden: ['today:brief'] }));
  const office = new ST.SettingsStore(officeData);
  office.device = () => 'office-id';
  await office.load();
  await office.useVault(vault);
  // The laptop had its own folders set before this version (an older choice, brought in later: the vault's stay).
  const lapData = dir('laptop');
  put(path.join(lapData, 'settings.json'), oldSettings({ fontSize: 14, attachmentsFolder: 'Laptop files', linkFormat: 'relative' }));
  utimesSync(path.join(lapData, 'settings.json'), new Date(Date.now() - 86400e3), new Date(Date.now() - 86400e3));
  const lap = new ST.SettingsStore(lapData);
  lap.device = () => 'laptop-id';
  await lap.load();
  const changed = await lap.useVault(vault);
  assert.ok(changed, 'the settings in use changed to the vault’s');
  assert.equal(lap.raw.prefs.templatesFolder, 'Office templates', 'the vault’s templates folder');
  assert.equal(lap.raw.prefs.attachmentsFolder, 'Files', 'the vault’s attachments folder, over an older one brought in');
  assert.equal(lap.raw.prefs.linkFormat, 'relative', 'one the vault didn’t have is brought in from the laptop');
  assert.ok(lap.raw.prefs.hidden.includes('today:brief'), 'Today’s sections the same');
  assert.equal(lap.raw.prefs.fontSize, 14, 'the laptop’s own text size stays (it follows the person only through a synced copy)');
  assert.equal(lap.raw.dailyFolder, 'Journal');
  // A change on the laptop: the vault's to the vault, the person's to personal.json, this PC's to settings.json.
  await lap.update({ prefs: { attachmentsFolder: 'Shared files', fontSize: 16, zoom: 1.1, hidden: ['today:brief', 'today:week', 'ribbon:assets'] } });
  const vs = VS.docValues(VS.readDoc(readFileSync(path.join(vault, '.neuralvault', 'settings.json'), 'utf8')));
  assert.equal(vs.attachmentsFolder, 'Shared files');
  assert.deepEqual(vs.hidden, ['today:brief', 'today:week']);
  assert.equal(vs.fontSize, undefined);
  const lp = VS.docValues(VS.readDoc(readFileSync(path.join(lapData, 'personal.json'), 'utf8')));
  assert.equal(lp.fontSize, 16);
  assert.deepEqual(lp.hidden, ['ribbon:assets']);
  assert.equal(json(path.join(lapData, 'settings.json')).prefs.zoom, 1.1);
  // Office-PC hears it (its 20-second look).
  assert.ok(await office.refresh(), 'Office-PC’s settings changed');
  assert.equal(office.raw.prefs.attachmentsFolder, 'Shared files');
  assert.ok(office.raw.prefs.hidden.includes('today:week'));
  assert.equal(office.raw.prefs.fontSize, 19, 'Office-PC’s text size its own');
  assert.ok(!(await office.refresh()), 'nothing new: nothing changes');
  // The former host app brings the person's text size from the laptop into Office-PC's
  // personal.json.
  const pf = path.join(officeData, 'personal.json');
  const doc = VS.readDoc(readFileSync(pf, 'utf8'));
  doc.keys.fontSize = { value: 16, at: Date.now() + 1000, by: 'neuralbot' };
  writeFileSync(pf, VS.docText(doc));
  utimesSync(pf, new Date(), new Date(Date.now() + 5000));
  assert.ok(await office.refresh());
  assert.equal(office.raw.prefs.fontSize, 16, 'the person’s text size, brought by sync');
});

test('what Ironleaf remembers: the side bar’s order goes in the vault, open folders stay; another PC reads the order with its own open folders', async () => {
  const vault = dir('vault');
  const officeData = dir('office');
  // Before this version: the office PC's memory only in its own data.
  const office = new LS.LibraryState(officeData);
  put(path.join(officeData, 'libraries', LS.libraryKey(vault), 'explorer.json'), JSON.stringify({ mode: 'sections', order: { places: ['Projects', 'Notes'] }, expanded: ['Projects'] }));
  put(path.join(officeData, 'libraries', LS.libraryKey(vault), 'bookmarks.json'), JSON.stringify([{ id: 'b1', type: 'file', path: 'Plan.md' }]));
  office.device = () => 'office-id';
  office.useVault(vault);
  assert.deepEqual(await office.load(vault, 'explorer'), { mode: 'sections', order: { places: ['Projects', 'Notes'] }, expanded: ['Projects'] }, 'read as before');
  assert.deepEqual(await office.load(vault, 'bookmarks'), [{ id: 'b1', type: 'file', path: 'Plan.md' }]);
  assert.ok(existsSync(path.join(vault, '.neuralvault', 'state', 'explorer.json')), 'moved into the vault');
  const lapData = dir('laptop');
  const lap = new LS.LibraryState(lapData);
  lap.device = () => 'laptop-id';
  lap.useVault(vault);
  put(path.join(lapData, 'libraries', LS.libraryKey(vault), 'explorer.json'), JSON.stringify({ expanded: ['Areas'] }));
  assert.deepEqual(await lap.load(vault, 'explorer'), { expanded: ['Areas'], mode: 'sections', order: { places: ['Projects', 'Notes'] } }, 'the vault’s order, the laptop’s open folders');
  assert.deepEqual(await lap.load(vault, 'bookmarks'), [{ id: 'b1', type: 'file', path: 'Plan.md' }], 'the same bookmarks');
  await lap.save(vault, 'explorer', { expanded: ['Areas', 'Inbox'], mode: 'sections', order: { places: ['Notes', 'Projects'] } });
  assert.deepEqual(await office.refresh(), ['explorer'], 'Office-PC hears the change');
  assert.deepEqual(await office.load(vault, 'explorer'), { mode: 'sections', order: { places: ['Notes', 'Projects'] }, expanded: ['Projects'] }, 'the new order, its own open folders');
  await lap.save(vault, 'workspace', { tabs: ['secret'] });
  assert.ok(!existsSync(path.join(vault, '.neuralvault', 'state', 'workspace.json')), 'open tabs never go in the vault');
});

// ── This PC's sync state ─────────────────────────────────────────────────────────────────────────────────────────────

test('conflict copies are found by their names, only beside their original', () => {
  const files = ['Plan.md', 'Plan-OFFICE-PC.md', 'Plan-OFFICE-PC-2.md', 'Plans.md', 'Plans (conflict, 21 Oct 2026 3.42 pm, from LAPTOP).md', 'Notes/Call.md', 'Notes/Call-DESKTOP-4KQ2J7M.md', 'Budget.xlsx', "Budget (Mia's conflicted copy 2026-10-23).xlsx", 'Report-v2.md', 'Report.md', 'Lonely-OFFICE-PC.md', '.neuralvault/settings-OFFICE-PC.json', '.neuralvault/settings.json', 'Plan (OFFICE-PC’s copy).md'];
  const found = SY.findConflictCopies(files, ['Office-PC']);
  assert.deepEqual(
    found.map((c) => [c.copy, c.original, c.pc, c.service, c.note]),
    [
      ["Budget (Mia's conflicted copy 2026-10-23).xlsx", 'Budget.xlsx', 'Mia', 'dropbox', false],
      ['Notes/Call-DESKTOP-4KQ2J7M.md', 'Notes/Call.md', 'DESKTOP-4KQ2J7M', 'onedrive', true],
      ['Plan-OFFICE-PC-2.md', 'Plan.md', 'Office-PC', 'onedrive', true],
      ['Plan-OFFICE-PC.md', 'Plan.md', 'Office-PC', 'onedrive', true],
      ['Plans (conflict, 21 Oct 2026 3.42 pm, from LAPTOP).md', 'Plans.md', 'LAPTOP', 'sync', true],
    ],
  );
  assert.equal(SY.keptName(found[3], (r) => r === 'Plan (Office-PC’s copy).md'), 'Plan (Office-PC’s copy 2).md', 'keep both: a name that says whose it is');
});

test('the sync line says this PC’s state plainly, the most pressing first', () => {
  const now = Date.parse('2026-10-24T10:00:00Z');
  const base = { place: { kind: 'onedrive', name: 'OneDrive' }, windows: true, oneDrive: { running: true, pendingMinutes: null, error: false }, cloudOnly: { count: 0, notes: 0, sample: [] }, conflicts: [], others: [{ name: 'Office-PC', at: now - 4 * 60e3, online: true, sameVault: true }], now };
  let v = SY.syncView(base);
  assert.equal(v.main.title, 'Up to date with Office-PC');
  assert.match(v.main.words, /Office-PC has this vault open now, through OneDrive/);
  v = SY.syncView({ ...base, others: [{ name: 'Office-PC', at: now - 3 * 3600e3, online: false, sameVault: true }] });
  assert.match(v.main.words, /last had this vault open 3 hours ago/);
  v = SY.syncView({ ...base, oneDrive: { running: true, pendingMinutes: 12, error: false } });
  assert.equal(v.main.title, 'OneDrive paused');
  assert.match(v.main.words, /12 minutes ago hasn’t gone up yet/);
  assert.equal(v.main.fix.id, 'show-onedrive');
  assert.ok(!v.more.some((i) => i.id === 'up-to-date'), '“Up to date” isn’t said beside it');
  v = SY.syncView({ ...base, oneDrive: { running: false, pendingMinutes: null, error: false } });
  assert.equal(v.main.title, 'OneDrive isn’t running');
  assert.equal(v.main.fix.label, 'Start OneDrive');
  v = SY.syncView({ ...base, cloudOnly: { count: 3, notes: 1, sample: [] } });
  assert.equal(v.main.title, 'Up to date with Office-PC', 'files only in the cloud aren’t a problem: said under the line');
  assert.equal(v.more[0].title, '3 files only in the cloud');
  assert.equal(v.more[0].fix.label, 'Keep on this PC');
  v = SY.syncView({ ...base, conflicts: SY.findConflictCopies(['Plan.md', 'Plan-OFFICE-PC.md', 'A.md', 'A-OFFICE-PC.md'], ['Office-PC']) });
  assert.equal(v.main.title, '2 conflict copies');
  assert.match(v.main.words, /OneDrive kept two versions of 2 notes changed on two PCs at once/);
  assert.ok(!v.more.some((i) => i.id === 'up-to-date'), '“Up to date” isn’t said beside conflict copies');
  v = SY.syncView({ ...base, conflicts: SY.findConflictCopies(['Plans.md', 'Plans (conflict, 21 Oct 2026 3.42 pm, from LAPTOP).md'], ['Office-PC']) });
  assert.equal(v.main.title, '1 conflict copy');
  assert.match(v.main.words, /Syncing with the other PC kept two versions of a note/);
  v = SY.syncView({ ...base, others: [{ name: 'Office-PC', at: now - 2 * 3600e3, online: true, sameVault: true }] });
  assert.equal(v.main.title, 'Waiting for Office-PC’s changes');
  v = SY.syncView({ ...base, others: [] });
  assert.equal(v.main.title, 'Synced with OneDrive');
  v = SY.syncView({ ...base, place: { kind: 'local', name: 'this PC' }, oneDrive: null, others: [] });
  assert.equal(v.main.title, 'Only on this PC');
});

test('the sync service: this PC says it has the vault open, reads the others, sees Windows’ facts (simulated), merges and keeps conflict copies', async () => {
  const vault = dir('vault');
  put(path.join(vault, 'Plan.md'), '# Plan\n\n- Order tiles\n');
  put(path.join(vault, 'Plan-OFFICE-PC.md'), '# Plan\n\n- Order tiles\n- Ring Darcy about the bench\n');
  put(path.join(vault, 'Budget.xlsx'), 'one');
  put(path.join(vault, 'Budget-OFFICE-PC.xlsx'), 'two');
  const now = Date.now();
  put(path.join(vault, '.neuralvault', 'pcs', '11111111-2222-4333-8444-555555555555.json'), JSON.stringify({ id: '11111111-2222-4333-8444-555555555555', name: 'Office-PC', at: new Date(now - 3 * 60e3).toISOString() }));
  const stub = path.join(work, `stub-${n}.json`);
  const log = path.join(work, `stub-log-${n}.txt`);
  writeFileSync(stub, JSON.stringify({ windows: true, running: true, offline: ['Archive/Old.md', 'Archive/Scan.pdf'], state: 2, log }));
  const written = {};
  const trashed = [];
  const fsNode = await import('node:fs/promises');
  const sync = MS.createVaultSync({
    root: () => vault,
    device: { id: '99999999-2222-4333-8444-555555555555', name: 'TRAVEL-LAPTOP' },
    version: '6.3.0',
    identityId: async () => 'vault-id',
    place: async () => ({ kind: 'onedrive', name: 'OneDrive' }),
    pcs: async () => [{ id: 'o', name: 'Office-PC', me: false, online: true, lastSeen: now, vault: { id: 'vault-id', name: 'Ironleaf', place: 'onedrive', placeName: 'OneDrive' } }],
    mayWrite: async () => true,
    readNote: async (rel) => readFileSync(path.join(vault, rel), 'utf8'),
    writeNote: async (rel, text) => {
      written[rel] = text;
      writeFileSync(path.join(vault, rel), text);
    },
    trash: async (rel) => {
      trashed.push(rel);
      rmSync(path.join(vault, rel));
    },
    move: async (from, to) => fsNode.rename(path.join(vault, from), path.join(vault, to)),
    rescan: async () => undefined,
    stub,
  });
  await sync.beat();
  const mine = json(path.join(vault, '.neuralvault', 'pcs', '99999999-2222-4333-8444-555555555555.json'));
  assert.equal(mine.name, 'TRAVEL-LAPTOP');
  let v = await sync.status(true);
  assert.equal(v.main.title, '2 conflict copies');
  assert.ok(v.more.some((i) => i.title === '2 files only in the cloud'));
  assert.ok(!v.more.some((i) => i.id === 'up-to-date'), '9.2 reverses the old pin: “Up to date” is not said beside conflict copies');
  // Merge the note: every line kept, the copy to Recently deleted.
  const done = await sync.fix('merge', 'Plan-OFFICE-PC.md');
  assert.match(done.words, /merged into Plan\.md, every line kept/);
  assert.match(readFileSync(path.join(vault, 'Plan.md'), 'utf8'), /Ring Darcy about the bench/);
  assert.ok(readFileSync(path.join(vault, 'Plan.md'), 'utf8').startsWith('# Plan\n\n- Order tiles\n'), 'the note keeps its own words at the top');
  assert.deepEqual(trashed, ['Plan-OFFICE-PC.md']);
  // Keep both for the workbook.
  const kept = await sync.fix('keep-both', 'Budget-OFFICE-PC.xlsx');
  assert.match(kept.words, /Office-PC’s version is now “Budget \(Office-PC’s copy\)\.xlsx”/);
  assert.equal(readFileSync(path.join(vault, 'Budget (Office-PC’s copy).xlsx'), 'utf8'), 'two');
  v = await sync.status(true);
  assert.equal(v.main.title, 'Up to date with Office-PC', 'no conflict copies left');
  // OneDrive paused: this PC's own file waiting to go up.
  writeFileSync(stub, JSON.stringify({ windows: true, running: true, offline: [], state: 4, minutes: 9, log }));
  v = await sync.status(true);
  assert.equal(v.main.title, 'OneDrive paused');
  writeFileSync(stub, JSON.stringify({ windows: true, running: false, offline: [], log }));
  v = await sync.status(true);
  assert.equal(v.main.title, 'OneDrive isn’t running');
  assert.match((await sync.fix('start-onedrive')).words, /OneDrive is starting/);
  assert.match((await sync.fix('keep-here')).words, /stays on this PC/);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['start-onedrive', `keep-here ${vault}`], 'the fixes ran (simulated)');
  sync.stop();
});
