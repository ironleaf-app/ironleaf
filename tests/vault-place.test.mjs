// node --test tests/vault-place.test.mjs — Where your vault is (src/main/vault-place.ts; 18 Oct 2026: the vault reached
// their second PC only because Windows had put Documents in OneDrive). Each service found from what it leaves on a
// Windows PC (made up here: environment, info files, the registry, the drives), nothing found, broken files; the move
// with real folders (every file copied and checked, the library switched, the old folder to the injected Recycle Bin; a
// failure half way leaves the old vault in use; refusals); a new PC finding a vault; settings.json naming the vault
// twice.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-place-'));
let P, S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/main/vault-place.ts'), platform: 'node', output: { file: path.join(work, 'place.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'place.mjs')).href);
  // The real settings file, with Electron's app stood in for (only its data folder is asked for, and it is given).
  const electron = { name: 'electron-stand-in', resolveId: (id) => (id === 'electron' ? '\0electron' : null), load: (id) => (id === '\0electron' ? 'export const app = { getPath: () => "" };' : null) };
  await build({ input: path.join(root, 'src/main/settings.ts'), platform: 'node', plugins: [electron], output: { file: path.join(work, 'settings.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'settings.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── A made-up Windows PC ──────────────────────────────────────────────────────────────────────────────────────────
function windowsPc({ env = {}, files = {}, dirs = [], reg = {}, drives = [], windowsFails = false } = {}) {
  const lower = (p) => path.win32.resolve(p).toLowerCase();
  const dirSet = new Set(dirs.map(lower));
  const fileMap = new Map(Object.entries(files).map(([k, v]) => [lower(k), v]));
  return {
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\mia', APPDATA: 'C:\\Users\\mia\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\mia\\AppData\\Local', ...env },
    home: 'C:\\Users\\mia',
    path: path.win32,
    readFile: async (p) => {
      if (!fileMap.has(lower(p))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return fileMap.get(lower(p));
    },
    isDir: async (p) => dirSet.has(lower(p)),
    listDir: async () => [],
    windows: async () => {
      if (windowsFails) throw new Error('PowerShell is not there');
      return { reg, drives };
    },
  };
}
const OD = 'HKEY_CURRENT_USER\\Software\\Microsoft\\OneDrive\\Accounts';

test('OneDrive, personal: from the environment; a vault in its Documents is synced', async () => {
  const pc = windowsPc({ env: { OneDrive: 'C:\\Users\\mia\\OneDrive', OneDriveConsumer: 'C:\\Users\\mia\\OneDrive' }, dirs: ['C:\\Users\\mia\\OneDrive', 'C:\\Users\\mia\\OneDrive\\Documents'] });
  const places = await P.detectPlaces(pc);
  assert.deepEqual(places.roots, [{ service: 'onedrive', path: 'C:\\Users\\mia\\OneDrive', work: false, name: 'OneDrive' }]);
  const place = P.placeOf('c:\\users\\mia\\onedrive\\Documents\\Ironleaf', places, pc);
  assert.equal(place.kind, 'onedrive');
  assert.equal(place.words, 'Synced with OneDrive. Your notes follow you to any PC signed in to the same OneDrive.');
  // Somewhere else on the PC: only here; a move offers OneDrive's Documents.
  const local = P.placeOf('C:\\Users\\mia\\Documents\\Ironleaf', places, pc);
  assert.equal(local.kind, 'local');
  assert.equal(local.words, 'Only on this PC. If this PC is lost, so are your notes, and another PC won’t see them.');
  assert.deepEqual(await P.moveTargets('C:\\Users\\mia\\Documents\\Ironleaf', places, pc), [{ id: 'onedrive:0', kind: 'onedrive', label: 'OneDrive › Documents', path: 'C:\\Users\\mia\\OneDrive\\Documents' }]);
  assert.deepEqual(await P.moveTargets('C:\\Users\\mia\\OneDrive\\Documents\\Ironleaf', places, pc), [], 'never offered the service it is in already');
});

test('OneDrive for work and personal: from the registry, the work one named by its organisation', async () => {
  const pc = windowsPc({
    env: { OneDrive: 'C:\\Users\\mia\\OneDrive - Contoso', OneDriveCommercial: 'C:\\Users\\mia\\OneDrive - Contoso' },
    dirs: ['C:\\Users\\mia\\OneDrive', 'C:\\Users\\mia\\OneDrive - Contoso'],
    reg: {
      [OD]: { LastUpdate: '1' },
      [`${OD}\\Personal`]: { UserFolder: 'C:\\Users\\mia\\OneDrive', cid: 'abc' },
      [`${OD}\\Business1`]: { UserFolder: 'C:\\Users\\mia\\OneDrive - Contoso', DisplayName: 'Contoso', Business: '1' },
      [`${OD}\\Business2`]: { UserFolder: 'D:\\Gone\\OneDrive - Old Job', DisplayName: 'Old Job' },
      [`${OD}\\Business1\\Tenants\\Contoso`]: { 'C:\\Users\\mia\\OneDrive - Contoso': '' },
    },
  });
  const { roots } = await P.detectPlaces(pc);
  assert.deepEqual(
    roots.map((r) => [r.name, r.path, r.work]),
    [
      ['OneDrive', 'C:\\Users\\mia\\OneDrive', false],
      ['OneDrive – Contoso', 'C:\\Users\\mia\\OneDrive - Contoso', true],
    ],
    'both accounts, the old one whose folder is gone left out, the environment adding nothing twice',
  );
  const place = P.placeOf('C:\\Users\\mia\\OneDrive - Contoso\\Notes\\Ironleaf', { roots, network: [] }, pc);
  assert.equal(place.words, 'Synced with OneDrive – Contoso. Your notes follow you to any PC signed in to the same work account.');
  // Only the environment: still named from its folder.
  const env = windowsPc({ env: { OneDriveCommercial: 'C:\\Users\\mia\\OneDrive - Fabrikam' }, dirs: ['C:\\Users\\mia\\OneDrive - Fabrikam'] });
  assert.equal((await P.detectPlaces(env)).roots[0].name, 'OneDrive – Fabrikam');
});

test('Dropbox: personal and business from its info.json (Roaming and Local); a broken one is no service', async () => {
  const info = JSON.stringify({ personal: { path: 'C:\\Users\\mia\\Dropbox', host: 1 }, business: { path: 'C:\\Users\\mia\\Dropbox (Contoso)', host: 2 } });
  const pc = windowsPc({ files: { 'C:\\Users\\mia\\AppData\\Local\\Dropbox\\info.json': '\uFEFF' + info }, dirs: ['C:\\Users\\mia\\Dropbox', 'C:\\Users\\mia\\Dropbox (Contoso)'] });
  const { roots } = await P.detectPlaces(pc);
  assert.deepEqual(roots.map((r) => [r.service, r.name, r.path]), [
    ['dropbox', 'Dropbox', 'C:\\Users\\mia\\Dropbox'],
    ['dropbox', 'Dropbox – Contoso', 'C:\\Users\\mia\\Dropbox (Contoso)'],
  ]);
  assert.equal(P.placeOf('C:\\Users\\mia\\Dropbox\\Ironleaf', { roots, network: [] }, pc).words, 'Synced with Dropbox. Your notes follow you to any PC signed in to the same Dropbox.');
  for (const broken of ['{ "personal": { "path": ', '', 'null', '[1,2]', '{"personal":{"path":42}}', '{"personal":{"path":"relative\\\\dropbox"}}']) {
    const bad = windowsPc({ files: { 'C:\\Users\\mia\\AppData\\Roaming\\Dropbox\\info.json': broken }, dirs: ['C:\\Users\\mia\\Dropbox'] });
    assert.deepEqual((await P.detectPlaces(bad)).roots, [], `broken info.json (${JSON.stringify(broken)}) is no service, and no error`);
  }
});

test('Google Drive for desktop: its drive (by the label or its settings), My Drive and shared drives, or mirrored files', async () => {
  const byLabel = windowsPc({ drives: [{ letter: 'C:', type: 3, label: 'Windows', remote: '' }, { letter: 'G:', type: 3, label: 'Google Drive', remote: '' }], dirs: ['G:\\', 'G:\\My Drive', 'G:\\Shared drives'] });
  const a = await P.detectPlaces(byLabel);
  assert.deepEqual(a.roots.map((r) => [r.path, r.name, !!r.shared]), [
    ['G:\\My Drive', 'Google Drive', false],
    ['G:\\Shared drives', 'Google shared drives', true],
  ]);
  assert.equal(P.placeOf('G:\\My Drive\\Ironleaf', a, byLabel).words, 'Synced with Google Drive. Your notes follow you to any PC signed in to the same Google account.');
  assert.match(P.placeOf('G:\\Shared drives\\Team\\Ironleaf', a, byLabel).words, /^In a Google shared drive\. /);
  assert.deepEqual((await P.moveTargets('C:\\Users\\mia\\Documents\\Ironleaf', a, byLabel)).map((t) => t.label), ['Google Drive › My Drive'], 'a shared drive is never offered to move into');
  // Its settings name the drive: a letter, or JSON per account.
  const byReg = windowsPc({ reg: { 'HKEY_CURRENT_USER\\Software\\Google\\DriveFS\\Share': { MountPoint: 'H', BasePath: 'C:\\x' } }, dirs: ['H:\\My Drive'] });
  assert.deepEqual((await P.detectPlaces(byReg)).roots.map((r) => r.path), ['H:\\My Drive']);
  const byJson = windowsPc({ reg: { 'HKEY_CURRENT_USER\\Software\\Google\\DriveFS': { PerAccountPreferences: '{"per_account_preferences":[{"key":"1","value":{"mount_point_path":"K"}}]}' } }, dirs: ['K:\\My Drive'] });
  assert.deepEqual((await P.detectPlaces(byJson)).roots.map((r) => r.path), ['K:\\My Drive']);
  // Mirrored: My Drive as a folder in the person's own folder, when Google Drive is on the PC.
  const mirror = windowsPc({ dirs: ['C:\\Users\\mia\\My Drive', 'C:\\Users\\mia\\AppData\\Local\\Google\\DriveFS'] });
  assert.deepEqual((await P.detectPlaces(mirror)).roots.map((r) => r.path), ['C:\\Users\\mia\\My Drive']);
  const notInstalled = windowsPc({ dirs: ['C:\\Users\\mia\\My Drive'] });
  assert.deepEqual((await P.detectPlaces(notInstalled)).roots, [], 'a folder called My Drive alone is not Google Drive');
});

test('iCloud Drive: in the person’s own folder', async () => {
  const pc = windowsPc({ dirs: ['C:\\Users\\mia\\iCloudDrive'] });
  const places = await P.detectPlaces(pc);
  assert.deepEqual(places.roots, [{ service: 'icloud', path: 'C:\\Users\\mia\\iCloudDrive', name: 'iCloud Drive' }]);
  assert.equal(P.placeOf('C:\\Users\\mia\\iCloudDrive\\Ironleaf', places, pc).words, 'Synced with iCloud Drive. Your notes follow you to any PC or Mac signed in to the same Apple Account.');
});

test('a network drive or NAS: a \\\\server\\share path, or a drive letter that is a network drive', async () => {
  const pc = windowsPc({ drives: [{ letter: 'Z:', type: 4, label: 'home', remote: '\\\\nas\\home' }, { letter: 'D:', type: 3, label: 'Data', remote: '' }] });
  const places = await P.detectPlaces(pc);
  assert.deepEqual(places.network, [{ path: 'Z:\\', remote: '\\\\nas\\home' }]);
  const unc = P.placeOf('\\\\nas\\notes\\Ironleaf', places, pc);
  assert.equal(unc.kind, 'network');
  assert.equal(unc.words, 'On a network drive (\\\\nas\\notes). Any PC that can reach it opens the same notes. They’re as safe as that drive’s own backups.');
  assert.equal(P.placeOf('\\\\?\\UNC\\nas\\notes\\Ironleaf', places, pc).kind, 'network');
  const mapped = P.placeOf('z:\\Ironleaf', places, pc);
  assert.equal(mapped.kind, 'network');
  assert.match(mapped.words, /\\\\nas\\home/);
  assert.equal(P.placeOf('D:\\Ironleaf', places, pc).kind, 'local', 'a second disk in the PC is still only this PC');
  assert.deepEqual((await P.moveTargets('C:\\Users\\mia\\Documents\\Ironleaf', places, pc)).map((t) => [t.label, t.path]), [['Z: on \\\\nas\\home', 'Z:\\']]);
});

test('nothing at all, or Windows not answering: only on this PC, and nothing thrown', async () => {
  const none = await P.detectPlaces(windowsPc());
  assert.deepEqual(none, { roots: [], network: [] });
  assert.equal(P.placeOf('C:\\Users\\mia\\Documents\\Ironleaf', none, windowsPc()).kind, 'local');
  const fails = windowsPc({ windowsFails: true, env: { OneDrive: 'C:\\Users\\mia\\OneDrive' }, dirs: ['C:\\Users\\mia\\OneDrive'] });
  assert.deepEqual((await P.detectPlaces(fails)).roots.map((r) => r.name), ['OneDrive'], 'the environment still finds OneDrive when PowerShell fails');
  const throwing = { ...windowsPc(), isDir: async () => { throw new Error('drive asleep'); }, readFile: async () => { throw new Error('no'); } };
  assert.deepEqual(await P.detectPlaces(throwing), { roots: [], network: [] });
  // A look that never answers gives up (the real one after 15 s; here the clock is the test's).
  assert.equal(await P.within(new Promise(() => {}), 20, 'gave up'), 'gave up');
});

test('PowerShell’s answer read as it comes (one drive as an object, rubbish as nothing); Linux network mounts', () => {
  assert.deepEqual(P.parseWindowsProbe('{"reg":{"HKEY_CURRENT_USER\\\\X":{"A":"1","B":null}},"drives":{"letter":"z:","type":4,"label":"","remote":"\\\\\\\\nas\\\\x"}}'), { reg: { 'HKEY_CURRENT_USER\\X': { A: '1' } }, drives: [{ letter: 'Z:', type: 4, label: '', remote: '\\\\nas\\x' }] });
  assert.deepEqual(P.parseWindowsProbe('not json'), { reg: {}, drives: [] });
  assert.deepEqual(P.parseWindowsProbe(''), { reg: {}, drives: [] });
  assert.deepEqual(P.networkMounts('/dev/sda1 / ext4 rw 0 0\n//nas/home /mnt/nas\\040home cifs rw 0 0\nnas:/x /mnt/x nfs4 rw 0 0\n'), [
    { path: '/mnt/nas home', remote: '//nas/home' },
    { path: '/mnt/x', remote: 'nas:/x' },
  ]);
  assert.equal(P.uncShare('\\\\nas\\home\\a\\b'), '\\\\nas\\home');
  assert.equal(P.uncShare('\\\\?\\C:\\x'), null);
  assert.equal(P.uncShare('C:\\x'), null);
});

test('a Mac: OneDrive, Dropbox and Google Drive in CloudStorage, iCloud Drive in Mobile Documents', async () => {
  const home = '/Users/mia';
  const dirs = new Set([`${home}/Library/CloudStorage/OneDrive-Personal`, `${home}/Library/CloudStorage/OneDrive-Contoso`, `${home}/Library/CloudStorage/Dropbox`, `${home}/Library/CloudStorage/GoogleDrive-mia@example.com/My Drive`, `${home}/Library/Mobile Documents/com~apple~CloudDocs`]);
  const mac = { platform: 'darwin', env: {}, home, path: path.posix, readFile: async () => { throw new Error('no'); }, isDir: async (p) => dirs.has(p), listDir: async () => ['OneDrive-Personal', 'OneDrive-Contoso', 'Dropbox', 'GoogleDrive-mia@example.com', '.DS_Store'] };
  const { roots } = await P.detectPlaces(mac);
  assert.deepEqual(roots.map((r) => r.name).sort(), ['Dropbox', 'Google Drive', 'OneDrive', 'OneDrive – Contoso', 'iCloud Drive']);
});

// ── Real folders ─────────────────────────────────────────────────────────────────────────────────────────────────
let n = 0;
const fresh = (name) => {
  const d = path.join(work, `${n++}-${name}`);
  mkdirSync(d, { recursive: true });
  return d;
};
const put = (dir, rel, content) => {
  const abs = path.join(dir, ...rel.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
};
/** A lived-in vault: notes, a project, a picture, Private notes, hidden folders, an empty folder. */
function livedIn(dir) {
  put(dir, 'Welcome to Ironleaf.md', '# Welcome');
  for (let i = 0; i < 6; i++) put(dir, `Notes/Note ${i}.md`, `# Note ${i}\n\nSome words ${'x'.repeat(i * 300)}`);
  put(dir, 'Projects/Studio Upgrade/Studio Upgrade.md', '---\ntype: project\n---\n# Studio Upgrade');
  put(dir, 'Projects/Studio Upgrade/Activity/Fix it.md', '# Fix it');
  put(dir, 'Templates/Projects/Blank.md', '---\ntype: project-template\n---');
  put(dir, 'Attachments/photo.png', Buffer.from(Array.from({ length: 300000 }, (_, i) => (i * 7) % 256)));
  put(dir, 'Private notes/keys.nvkey', '{"v":1}');
  put(dir, 'Private notes/a1b2.nvlock', '{"v":1,"c":"..."}');
  put(dir, '.hidden-app/state.json', '{"x":1}');
  put(dir, '.trash/old.md', 'old');
  mkdirSync(path.join(dir, 'Empty folder'), { recursive: true });
}
const tree = (dir) => {
  const out = {};
  const walk = (rel) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out[r + '/'] = 'dir';
        walk(r);
      } else out[r] = createHash('sha256').update(readFileSync(path.join(dir, r))).digest('hex');
    }
  };
  walk('');
  return out;
};

test('looking at a vault: notes and projects counted by name (nothing opened), Ironleaf’s own marks', async () => {
  const v = fresh('look');
  livedIn(v);
  assert.deepEqual(await P.lookAtVault(v), { exists: true, isVault: true, notes: 8, projects: 1, empty: false }, 'the 6 notes, the project and its task note; not the welcome note, the template, Private notes or hidden folders');
  const bare = fresh('bare');
  put(bare, 'Welcome to Ironleaf.md', '# Welcome');
  put(bare, 'Templates/Notes/Meeting notes.md', '# Meeting');
  assert.deepEqual(await P.lookAtVault(bare), { exists: true, isVault: true, notes: 0, projects: 0, empty: false });
  assert.deepEqual(await P.lookAtVault(path.join(work, 'nowhere')), { exists: false, isVault: false, notes: 0, projects: 0, empty: true });
  const own = new Map([['Welcome to Ironleaf.md', '# Welcome'], ['Templates/Notes/Meeting notes.md', '# Meeting']]);
  assert.equal(await P.holdsOnlyOwn(bare, own), true, 'only what Ironleaf wrote');
  put(bare, 'desktop.ini', '[.ShellClassInfo]');
  assert.equal(await P.holdsOnlyOwn(bare, own), true, 'Windows’ own desktop.ini doesn’t count');
  put(bare, 'Templates/Notes/Meeting notes.md', '# Meeting\n\nMy own agenda');
  assert.equal(await P.holdsOnlyOwn(bare, own), false, 'a template changed is the person’s');
  put(bare, 'Templates/Notes/Meeting notes.md', '# Meeting');
  put(bare, 'Shopping.md', 'milk');
  assert.equal(await P.holdsOnlyOwn(bare, own), false, 'a note of their own');
});

test('the move: everything copied (hidden too) and checked, the library switched, the old folder to the Recycle Bin', async () => {
  const home = fresh('pc');
  const vault = path.join(home, 'Documents', 'Ironleaf');
  livedIn(vault);
  const before = tree(vault);
  const oneDrive = path.join(home, 'OneDrive', 'Documents');
  mkdirSync(oneDrive, { recursive: true });
  const plan = await P.planMove(vault, oneDrive, 'OneDrive › Documents');
  assert.equal(plan.to, path.join(oneDrive, 'Ironleaf'));
  assert.equal(plan.files, 15);
  assert.ok(plan.bytes > 300000);
  const trash = path.join(home, 'Recycle Bin');
  const seen = [];
  const phases = new Set();
  const done = await P.moveVault(plan, {
    onProgress: (p) => phases.add(p.phase),
    switchTo: async (dest) => seen.push(['switch', dest]),
    switchBack: async (from) => seen.push(['back', from]),
    trash: async (abs) => {
      mkdirSync(trash, { recursive: true });
      renameSync(abs, path.join(trash, 'Ironleaf'));
      seen.push(['trash', abs]);
    },
  });
  assert.deepEqual(done, { path: plan.to, trashed: true, links: 0 });
  assert.deepEqual(seen, [['switch', plan.to], ['trash', vault]], 'switched first, the old folder put away only after');
  assert.deepEqual(tree(plan.to), before, 'every file and folder, hidden ones and the empty one too, byte for byte');
  assert.equal(existsSync(vault), false);
  assert.deepEqual(tree(path.join(trash, 'Ironleaf')), before, 'the old folder whole in the Recycle Bin');
  assert.ok(Math.abs(statSync(path.join(plan.to, 'Notes', 'Note 1.md')).mtimeMs - statSync(path.join(trash, 'Ironleaf', 'Notes', 'Note 1.md')).mtimeMs) < 1, 'files keep their times');
  assert.deepEqual([...phases], ['copying', 'checking', 'switching', 'tidying']);
  assert.deepEqual(readdirSync(oneDrive), ['Ironleaf'], 'nothing else left beside it');
});

test('a failure half way: the old vault stays in use, untouched, and no copy is left behind', async () => {
  for (const how of ['read', 'check', 'switch']) {
    const home = fresh(`fail-${how}`);
    const vault = path.join(home, 'Vault');
    livedIn(vault);
    const before = tree(vault);
    const target = path.join(home, 'Dropbox');
    mkdirSync(target);
    const plan = await P.planMove(vault, target, 'Dropbox');
    const seen = [];
    let copied = 0;
    const hooks =
      how === 'read'
        ? { beforeCopy: () => { if (++copied === 5) throw Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' }); } }
        : how === 'check'
          ? { afterCopy: (rel, copy) => { if (rel.endsWith('photo.png')) writeFileSync(copy, 'not the picture'); } }
          : {};
    await assert.rejects(
      () =>
        P.moveVault(plan, {
          hooks,
          switchTo: async (dest) => {
            seen.push(['switch', dest]);
            if (how === 'switch') throw new Error('the folder could not be watched');
          },
          switchBack: async (from) => seen.push(['back', from]),
          trash: async (abs) => seen.push(['trash', abs]),
        }),
      (err) => {
        assert.match(err.message, /^Nothing was moved: /);
        assert.ok(err.message.includes(vault), 'says where the vault still is');
        if (how === 'check') assert.match(err.message, /didn’t match its original \(Attachments\/photo\.png\)/);
        return true;
      },
    );
    assert.deepEqual(tree(vault), before, `${how}: the old vault as it was`);
    assert.deepEqual(readdirSync(target), [], `${how}: nothing of the copy left`);
    assert.deepEqual(seen, how === 'switch' ? [['switch', plan.to], ['back', vault]] : [], `${how}: never trashed`);
  }
});

test('the Recycle Bin refusing, or a network drive (no Recycle Bin): the old folder stays, and the move still counts', async () => {
  const home = fresh('keep');
  const vault = path.join(home, 'Vault');
  livedIn(vault);
  const target = path.join(home, 'NAS');
  mkdirSync(target);
  const plan = await P.planMove(vault, target, 'Z: on \\\\nas\\home');
  const refused = await P.moveVault(plan, { switchTo: async () => {}, switchBack: async () => {}, trash: async () => { throw new Error('no Recycle Bin'); } });
  assert.equal(refused.trashed, false);
  assert.ok(existsSync(vault) && existsSync(plan.to));
  rmSync(plan.to, { recursive: true });
  const kept = await P.moveVault(await P.planMove(vault, target, 'Z:'), { switchTo: async () => {}, switchBack: async () => {} });
  assert.equal(kept.trashed, false);
  assert.ok(existsSync(vault));
});

test('refused: inside the vault, where it already is, a vault already there (open it instead), no room; a busy name moves over', async () => {
  const home = fresh('refuse');
  const vault = path.join(home, 'Documents', 'Ironleaf');
  livedIn(vault);
  const inside = await P.planMove(vault, path.join(vault, 'Notes'), 'Notes');
  assert.deepEqual([inside.refused, inside.words], ['inside', 'That folder is inside your vault. Choose one outside it.']);
  assert.equal((await P.planMove(vault, vault, 'it')).refused, 'inside');
  const same = await P.planMove(vault, path.join(home, 'Documents'), 'Documents');
  assert.deepEqual([same.refused, same.words], ['same', 'Your vault is already there.']);
  const other = path.join(home, 'Dropbox');
  put(other, 'Ironleaf/Welcome to Ironleaf.md', '# Welcome');
  for (let i = 0; i < 3; i++) put(other, `Ironleaf/Their note ${i}.md`, 'theirs');
  put(other, 'Ironleaf/Projects/Fit-out/Fit-out.md', '---\ntype: project\n---');
  const there = await P.planMove(vault, other, 'Dropbox');
  assert.equal(there.refused, 'vault');
  assert.equal(there.words, 'There’s already a vault in Dropbox (4 notes, 1 project). Open that one instead, or choose another place.');
  assert.deepEqual([there.vault.path, there.vault.notes, there.vault.projects], [path.join(other, 'Ironleaf'), 4, 1]);
  const tight = await P.planMove(vault, path.join(home, 'Documents', '..'), 'Home', { freeBytes: async () => 1000 });
  assert.equal(tight.refused, 'space');
  assert.match(tight.words, /^There isn’t room there: your vault needs \d+(\.\d)? KB and Home has 1000 bytes free\.$/);
  // An Ironleaf folder holding something else: the vault goes in "Ironleaf 2"; an empty one is used.
  const busy = path.join(home, 'Busy');
  put(busy, 'Ironleaf/report.docx', 'not a vault');
  assert.equal((await P.planMove(vault, busy, 'Busy')).to, path.join(busy, 'Ironleaf 2'));
  const empty = path.join(home, 'EmptyOne');
  mkdirSync(path.join(empty, 'Ironleaf'), { recursive: true });
  const plan = await P.planMove(vault, empty, 'EmptyOne');
  assert.equal(plan.to, path.join(empty, 'Ironleaf'));
  await P.moveVault(plan, { switchTo: async () => {}, switchBack: async () => {}, trash: async () => {} });
  assert.ok(existsSync(path.join(empty, 'Ironleaf', 'Notes', 'Note 0.md')), 'the copy took the empty folder’s place');
  assert.equal((await P.planMove(path.join(home, 'gone'), empty, 'x')).refused, 'unreadable');
});

test('a new PC: an empty new vault and a vault in a synced folder gives the card; a vault with notes, or the card put away, doesn’t', async () => {
  const home = fresh('newpc');
  const dropbox = path.join(home, 'Dropbox');
  const oneDrive = path.join(home, 'OneDrive');
  livedIn(path.join(dropbox, 'Ironleaf'));
  put(oneDrive, 'Documents/Ironleaf/Welcome to Ironleaf.md', '# Welcome'); // another new one: nothing to find there
  put(oneDrive, 'Documents/Ironleaf/Templates/Notes/Meeting.md', '# t');
  const library = path.join(home, 'Documents', 'Ironleaf');
  put(library, 'Welcome to Ironleaf.md', '# Welcome');
  const places = { roots: [{ service: 'onedrive', path: oneDrive, name: 'OneDrive' }, { service: 'dropbox', path: dropbox, name: 'Dropbox' }], network: [] };
  const deps = { path, platform: process.platform };
  const found = await P.findVaults(places, { exclude: [library], deps });
  assert.deepEqual(found, [{ path: path.join(dropbox, 'Ironleaf'), kind: 'dropbox', name: 'Dropbox', notes: 8, projects: 1 }]);
  assert.equal(`Found your vault in ${found[0].name} — ${P.foundWords(found[0])}`, 'Found your vault in Dropbox — 8 notes, 1 project');
  const local = P.placeOf(library, places, deps);
  // "Not now" snoozes a week (8 Nov 2026, calm list: weekly, not never again).
  const NOW = new Date(2026, 10, 8, 19, 0);
  const DAY = 86_400_000;
  const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
  assert.equal(P.TIP_SNOOZE_DAYS, 7, 'the tip waits a week');
  const cards = (counts, { tipSnoozedAt = null, dismissed = new Set() } = {}) => P.vaultCards({ place: local, counts, found: found[0], tipSnoozedAt, now: NOW, foundDismissed: (p) => dismissed.has(p) });
  assert.deepEqual(cards({ notes: 0, projects: 0 }), { onlyHereCard: false, found: found[0] }, 'empty new vault + a synced vault: the card');
  assert.deepEqual(cards({ notes: 0, projects: 0 }, { dismissed: new Set([found[0].path]) }), { onlyHereCard: false, found: null }, 'put away: no card');
  assert.deepEqual(cards({ notes: 2, projects: 0 }), { onlyHereCard: false, found: null }, 'a vault in use: no card, and too few notes to warn about');
  assert.deepEqual(cards({ notes: 12, projects: 0 }), { onlyHereCard: true, found: null }, 'a vault in use, only here: the weekly card');
  assert.deepEqual(cards({ notes: 1, projects: 1 }), { onlyHereCard: true, found: null }, 'a project is enough');
  assert.deepEqual(cards({ notes: 12, projects: 0 }, { tipSnoozedAt: ago(DAY) }), { onlyHereCard: false, found: null }, '"Not now" yesterday: hidden');
  assert.deepEqual(cards({ notes: 12, projects: 0 }, { tipSnoozedAt: ago(7 * DAY - 60_000) }), { onlyHereCard: false, found: null }, '"Not now" nearly a week ago: still hidden, never less than a week');
  assert.deepEqual(cards({ notes: 12, projects: 0 }, { tipSnoozedAt: ago(7 * DAY + 60_000) }), { onlyHereCard: true, found: null }, 'a week later: shows again');
  assert.deepEqual(cards(null), { onlyHereCard: false, found: null }, 'another folder of notes open: neither');
  const synced = P.placeOf(path.join(dropbox, 'Ironleaf'), places, deps);
  assert.equal(P.vaultCards({ place: synced, counts: { notes: 50, projects: 3 }, found: null, tipSnoozedAt: null, now: NOW, foundDismissed: () => false }).onlyHereCard, false, 'synced: no warning');
  assert.deepEqual(await P.findVaults(places, { exclude: [library, path.join(dropbox, 'Ironleaf')], deps }), [], 'the vault open itself is never “found”');
});

test('settings.json names the vault twice (library and lastVault, the same) after a move and after Open it', async () => {
  const data = fresh('appdata');
  const store = new S.SettingsStore(data);
  await store.load();
  const first = fresh('first');
  await store.update({ library: first });
  await store.rememberVault(first);
  const json = () => JSON.parse(readFileSync(path.join(data, 'settings.json'), 'utf8'));
  // As Ironleaf opens a folder: by its real path, and remembered as the one opened last.
  const open = async (folder) => {
    const real = (await import('node:fs/promises')).realpath(folder);
    const p = await real;
    await store.rememberVault(p);
    return { path: p };
  };
  for (const label of ['after a move', 'after Open it']) {
    const next = fresh(label.replace(/\s/g, '-'));
    const through = path.join(next, '..', path.basename(next)); // given as the window gave it, not tidied
    await P.switchLibrary(store, open, through);
    const s = json();
    assert.equal(s.library, s.lastVault, `${label}: library and lastVault the same`);
    assert.equal(s.lastVault, next, `${label}: both the new folder`);
    assert.equal(s.recentVaults[0], next);
  }
});

test('a move of the folder open: the vault moves the library with it; another folder of notes moves only lastVault', async () => {
  const data = fresh('appdata-open');
  const store = new S.SettingsStore(data);
  await store.load();
  const library = fresh('the-library');
  const elsewhere = fresh('Client notes');
  await store.update({ library });
  await store.rememberVault(library);
  const json = () => JSON.parse(readFileSync(path.join(data, 'settings.json'), 'utf8'));
  const open = async (folder) => {
    const p = await (await import('node:fs/promises')).realpath(folder);
    await store.rememberVault(p);
    return { path: p };
  };
  // Open = another folder of notes: moving it reopens it at its new place; the library is left alone.
  await open(elsewhere);
  const target = fresh('OneDrive-docs');
  const plan = await P.planMove(elsewhere, target, 'OneDrive › Documents', { name: path.basename(elsewhere) });
  assert.equal(plan.to, path.join(target, path.basename(elsewhere)), 'another folder of notes keeps its own name');
  await P.moveVault(plan, { switchTo: (dest) => P.reopenMoved(store, open, dest, false), switchBack: (from) => P.reopenMoved(store, open, from, false), trash: async (abs) => rmSync(abs, { recursive: true }) });
  await store.forgetVault(elsewhere);
  let s = json();
  assert.equal(s.library, library, 'the library as it was');
  assert.equal(s.lastVault, plan.to, 'lastVault: the folder at its new place');
  assert.ok(!s.recentVaults.includes(elsewhere) && s.recentVaults[0] === plan.to, 'Recent follows it');
  // Open = the library: moving it moves the library too, named the same twice.
  await open(library);
  const plan2 = await P.planMove(library, target, 'OneDrive › Documents');
  assert.equal(plan2.to, path.join(target, 'Ironleaf'));
  await P.moveVault(plan2, { switchTo: (dest) => P.reopenMoved(store, open, dest, true), switchBack: (from) => P.reopenMoved(store, open, from, true) });
  s = json();
  assert.equal(s.library, plan2.to);
  assert.equal(s.lastVault, plan2.to);
});
