// node --test tests/project-places.test.mjs — a project's folder is per PC (22 Oct 2026: two PCs sharing one vault
// through OneDrive; a project's `folder: C:\Users\jarlow\Downloads\projects\01 Garden Shed Upgrade` is on a desktop
// and not on a travel laptop, where working on it said there was no folder). The same PC reads the folder as
// written; another user folder on the same layout is followed at once; a folder that isn't here is "on another PC" with
// choices (choose, find, new, without) remembered for this PC only; the synced note is never changed.
// src/shared/project-folder.ts, src/main/project-places.ts, src/main/projects.ts.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-places-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * from ${JSON.stringify(path.join(root, 'src/shared/project-folder.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/main/project-places.ts'))};`,
      `export { Projects, walkFolder, insideFolder } from ${JSON.stringify(path.join(root, 'src/main/projects.ts'))};`,
      `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`,
      `export { parseProject } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => {
  M?.setProjectPlaces(null);
  rmSync(work, { recursive: true, force: true });
});

const DESKTOP = 'C:\\Users\\jarlow\\Downloads\\projects\\01 Garden Shed Upgrade';
/** A PC's own settings (SettingsStore's two methods), kept apart for each PC. */
const store = () => {
  const data = {};
  return { data, folderChoice: (k) => data[k] ?? null, setFolderChoice: async (k, c) => (c ? (data[k] = { ...c, at: 'now' }) : delete data[k]) };
};
const disk = (...folders) => {
  const set = new Set(folders.map((f) => M.folderKey(f)));
  return (f) => set.has(M.folderKey(f));
};

test('the folder as written, on the PC that wrote it', () => {
  const place = M.placeOf(DESKTOP, { home: 'C:\\Users\\jarlow', isFolder: disk(DESKTOP) });
  assert.deepEqual(place, { state: 'here', recorded: DESKTOP, folder: DESKTOP });
  const p = { name: 'Upgrade', folder: DESKTOP };
  assert.equal(M.onThisPC(p, place), p, 'nothing changes on the same PC');
});

test('another user folder with the same layout is followed at once', () => {
  const laptop = 'C:\\Users\\jesse\\Downloads\\projects\\01 Garden Shed Upgrade';
  assert.equal(M.forThisUser(DESKTOP, 'C:\\Users\\jesse'), laptop);
  assert.equal(M.forThisUser(DESKTOP, 'C:\\Users\\jarlow'), null, 'the same user: nothing to change');
  assert.equal(M.forThisUser('D:\\Work\\X', 'C:\\Users\\jesse'), null, 'not under a user folder');
  assert.equal(M.forThisUser('/home/pat/app', '/home/sam'), '/home/sam/app');
  assert.equal(M.forThisUser(DESKTOP, '/home/sam'), null, 'never a Windows path onto a home folder');
  const place = M.placeOf(DESKTOP, { home: 'C:\\Users\\jesse', isFolder: disk(laptop) });
  assert.deepEqual(place, { state: 'moved', recorded: DESKTOP, folder: laptop });
  assert.equal(M.onThisPC({ folder: DESKTOP }, place).folder, laptop);
});

test('a folder that is on another PC is said so, with nothing in its place', () => {
  const place = M.placeOf(DESKTOP, { home: 'C:\\Users\\jesse', isFolder: disk() });
  assert.deepEqual(place, { state: 'elsewhere', recorded: DESKTOP });
  assert.equal(M.onThisPC({ name: 'Upgrade', folder: DESKTOP }, place).folder, undefined);
  // No folder at all is not "another PC".
  assert.equal(M.placeOf('', { isFolder: disk() }).state, 'none');
});

test('the host app’s project link (local:) follows the same rule', () => {
  const key = 'local:c:/users/jarlow/downloads/projects/01 garden shed upgrade';
  assert.equal(M.localKeyFolder(key), 'c:\\users\\jarlow\\downloads\\projects\\01 garden shed upgrade');
  assert.equal(M.recordedFolder({ key }), M.localKeyFolder(key));
  assert.equal(M.recordedFolder({ folder: DESKTOP, key }), DESKTOP, 'the folder property first');
  assert.equal(M.localKeyFolder('remote:0d3c8e5e-1111-4111-8111-111111111111:/home/x'), '');
  const place = M.placeOf(M.recordedFolder({ key }), { home: 'C:\\Users\\jesse', isFolder: disk('C:\\Users\\jesse\\downloads\\projects\\01 garden shed upgrade') });
  assert.equal(place.state, 'moved');
  assert.equal(M.folderKey(DESKTOP), M.folderKey(M.localKeyFolder(key)), 'the folder and its key are the same place');
});

test('a choice is this PC’s alone: remembered here, never on the other PC', () => {
  const desktop = store();
  const laptop = store();
  const chosen = 'D:\\Work\\Win11';
  const onLaptop = M.placeOf(DESKTOP, { choice: { folder: chosen }, home: 'C:\\Users\\jesse', isFolder: disk(chosen) });
  assert.deepEqual(onLaptop, { state: 'chosen', recorded: DESKTOP, folder: chosen });
  // The desktop's settings have nothing: its folder is the note's.
  assert.equal(M.placeOf(DESKTOP, { choice: desktop.folderChoice(M.folderKey(DESKTOP)), home: 'C:\\Users\\jarlow', isFolder: disk(DESKTOP) }).state, 'here');
  // Work without a folder, and a chosen folder that went.
  assert.equal(M.placeOf(DESKTOP, { choice: { none: true }, isFolder: disk() }).state, 'without');
  assert.deepEqual(M.placeOf(DESKTOP, { choice: { folder: chosen }, home: 'C:\\Users\\jesse', isFolder: disk() }), { state: 'elsewhere', recorded: DESKTOP, lost: chosen });
  assert.deepEqual(laptop.data, {});
});

test('on this PC: choose, find, a new folder, without — kept in this PC’s settings by the note’s folder', async () => {
  const home = path.join(work, 'jesse');
  const recorded = '/home/jarlow/Downloads/projects/01 Garden Shed Upgrade';
  const choices = store();
  const places = new M.ProjectPlaces({ choices, home });
  mkdirSync(home, { recursive: true });
  assert.equal(places.place({ folder: recorded }).state, 'elsewhere');

  // Find it: the same name under Documents.
  const there = path.join(home, 'Documents', 'Clients', '01 Garden Shed Upgrade');
  mkdirSync(there, { recursive: true });
  mkdirSync(path.join(home, 'Documents', 'node_modules', '01 Garden Shed Upgrade'), { recursive: true });
  const found = await places.find(recorded, []);
  assert.deepEqual(found, [there], 'found where people keep things, never inside node_modules');
  await places.choose(recorded, found[0]);
  assert.deepEqual(places.place({ folder: recorded }), { state: 'chosen', recorded, folder: there });
  assert.equal(choices.data[M.folderKey(recorded)].folder, there);

  // The same folder under this PC's user folder is followed without asking.
  rmSync(path.join(home, 'Documents'), { recursive: true });
  await places.forget(recorded);
  const same = path.join(home, 'Downloads', 'projects', '01 Garden Shed Upgrade');
  mkdirSync(same, { recursive: true });
  assert.deepEqual(places.place({ folder: recorded }), { state: 'moved', recorded, folder: same });
  rmSync(path.join(home, 'Downloads'), { recursive: true });

  // A new folder here: under where this PC keeps its other projects, named as the note's.
  const elsewhereRoot = path.join(home, 'Work');
  mkdirSync(path.join(elsewhereRoot, 'Shop fit-out'), { recursive: true });
  const made = await places.makeHere(recorded, [path.join(elsewhereRoot, 'Shop fit-out')]);
  assert.equal(made, path.join(elsewhereRoot, '01 Garden Shed Upgrade'));
  assert.ok(statSync(made).isDirectory());
  assert.equal(places.place({ folder: recorded }).folder, made);
  // With nothing else to go by, a Projects folder in the user's folder.
  assert.equal(places.rootFor('/home/jarlow/Elsewhere/X', []), path.join(home, 'Projects'));

  // Without a folder; and refusals.
  await places.without(recorded);
  assert.equal(places.place({ folder: recorded }).state, 'without');
  await assert.rejects(places.choose(recorded, path.join(home, 'not-there')), /isn’t on this PC/);
  await assert.rejects(places.choose(recorded, 'relative/path'), /Choose a folder on this PC/);
  // Choosing the folder the note names forgets the choice (nothing to remember).
  const own = path.join(work, 'own');
  mkdirSync(own);
  await places.choose(own, own);
  assert.equal(choices.data[M.folderKey(own)], undefined);
});

test('one skip rule for folders and files: junk in any case, machine files never listed (9.5 fourth pass)', async () => {
  assert.equal(M.skipDir('NODE_MODULES'), true);
  assert.equal(M.skipDir('node_modules'), true);
  assert.equal(M.skipDir('.vscode'), true);
  assert.equal(M.skipDir('Shop'), false);
  assert.equal(M.shouldSkipFile('app.log'), true);
  assert.equal(M.shouldSkipFile('cache.db'), true);
  assert.equal(M.shouldSkipFile('setup.ini'), true);
  assert.equal(M.shouldSkipFile('notes.txt'), false);
  const dir = path.join(work, 'skip');
  mkdirSync(path.join(dir, 'NODE_MODULES', 'pkg'), { recursive: true });
  mkdirSync(path.join(dir, 'Shop'), { recursive: true });
  writeFileSync(path.join(dir, 'NODE_MODULES', 'pkg', 'lib.js'), 'x');
  writeFileSync(path.join(dir, 'app.log'), 'x');
  writeFileSync(path.join(dir, 'Shop', 'plan.md'), 'x');
  const all = await M.walkFolder(dir);
  assert.deepEqual(all.map((f) => f.rel), ['Shop/plan.md']);
});

test('activity is a folder or file named so in any case; past thirty the view says how many more (9.5 fourth pass)', () => {
  const dir = 'Projects/Shop';
  const rel = `${dir}/Shop.md`;
  const index = new M.VaultIndex();
  const note = (p) => index.set(p, `---\ntype: note\n---\n# ${p}\n`, 1, 10);
  index.set(rel, '---\ntype: project\n---\n# Shop\n', 1, 10);
  note(`${dir}/Activity.md`);
  note(`${dir}/activity/lower.md`);
  note(`${dir}/Activity/Kick.md`);
  note(`${dir}/Tasks/todo.md`);
  note(`${dir}/Notes/Plan.md`);
  for (let i = 0; i < 28; i++) note(`${dir}/Activity/Old ${i}.md`);
  const projects = new M.Projects(index);
  const view = projects.view(rel);
  assert.deepEqual(view.notes.map((n) => n.path), [`${dir}/Notes/Plan.md`]);
  assert.equal(view.activity.length, 30);
  assert.equal(view.activityTotal, 32);
  assert.equal(view.activityMore, 2);
  assert.ok(view.activity.some((n) => n.path === `${dir}/Activity.md`), 'a file named Activity counts');
  assert.ok(view.activity.some((n) => n.path === `${dir}/activity/lower.md`), 'lowercase counts');
});

test('a file named ..foo stays inside; .. as a segment never escapes (9.5 fourth pass)', () => {
  assert.equal(M.insideFolder('/a/b', '..foo/bar.md'), path.resolve('/a/b', '..foo/bar.md'));
  assert.throws(() => M.insideFolder('/a/b', '../x.md'));
  assert.throws(() => M.insideFolder('/a/b', '..'));
  assert.throws(() => M.insideFolder('/a/b', 'sub/../../x.md'));
});

test('finding looks on every drive and deep in Dropbox, not only D–G and OneDrive (9.5 fourth pass)', async () => {
  assert.deepEqual(M.driveProjects((d) => d === 'H:\\Projects'), ['H:\\Projects']);
  const home = path.join(work, 'find-home');
  const deep = path.join(home, 'Dropbox', 'Projects', 'Shop');
  mkdirSync(deep, { recursive: true });
  const places = new M.ProjectPlaces({ choices: store(), home });
  assert.deepEqual(await places.find('C:/Projects/Shop', []), [deep]);
});

test('a new folder for CON or a trailing dot is a name Windows can keep (9.5 fourth pass)', async () => {
  const home = path.join(work, 'makehere');
  const places = new M.ProjectPlaces({ choices: store(), home });
  assert.equal(await places.makeHere('/home/jarlow/Elsewhere/CON', []), path.join(home, 'Projects', 'CON project'));
  assert.equal(await places.makeHere('/home/jarlow/Elsewhere/Shop.', []), path.join(home, 'Projects', 'Shop'));
});

test('the project as this PC reaches it; the synced note never changes', () => {
  const home = path.join(work, 'laptop-user');
  mkdirSync(home, { recursive: true });
  const chosen = path.join(work, 'laptop-folder');
  mkdirSync(chosen, { recursive: true });
  const choices = store();
  const places = new M.ProjectPlaces({ choices, home });
  M.setProjectPlaces(places);
  const note = [
    '---',
    'type: project',
    'status: active',
    `folder: ${DESKTOP}`,
    'neuralspark-project: local:c:/users/jarlow/downloads/projects/01 garden shed upgrade',
    '---',
    '# 01 Garden Shed Upgrade',
    '',
    '## Summary',
    '',
    'Upgrade the fleet.',
    '',
  ].join('\n');
  const rel = 'Projects/01 Garden Shed Upgrade/01 Garden Shed Upgrade.md';
  const index = new M.VaultIndex();
  index.set(rel, note, 1, note.length);
  const projects = new M.Projects(index);

  // On another PC: no folder here, the page told where it is.
  let view = projects.view(rel);
  assert.equal(view.project.folder, undefined);
  assert.deepEqual(view.place, { state: 'elsewhere', recorded: DESKTOP });
  assert.equal(projects.list()[0].folder, undefined);

  // Chosen on this PC: every reader has it.
  choices.data[M.folderKey(DESKTOP)] = { folder: chosen };
  view = projects.view(rel);
  assert.equal(view.project.folder, chosen);
  assert.equal(view.place.state, 'chosen');
  assert.equal(projects.list()[0].folder, chosen);
  assert.equal(projects.all()[0].project.folder, chosen);
  assert.equal(M.hereProject(M.parseProject(note, rel)).folder, chosen);

  // A change made on the page is written from the note's own text: its folder and link stay the desktop's.
  const { after: written } = projects.changed(rel, (p) => {
    p.status = 'on hold';
  });
  assert.match(written, /^status: on hold$/m);
  assert.ok(written.includes(`folder: ${DESKTOP}`), 'the folder as written');
  assert.ok(written.includes('neuralspark-project: local:c:/users/jarlow/downloads/projects/01 garden shed upgrade'));
  assert.ok(!written.includes(chosen), 'this PC’s folder never reaches the note');
  assert.ok(existsSync(chosen));
  M.setProjectPlaces(null);
});
