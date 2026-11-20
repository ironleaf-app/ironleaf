// node --test tests/quiet-folders-break.test.mjs — t20 break job on "keep a folder out of view"
// (8 Nov 2026). The quiet-folders job proved the main road; this one drives the edges with made-up
// folders shaped like real ones: prefix siblings ("Plans" and "Plans and reports"), nested folders,
// renames, case and slash variants, and non-English names. For each probe the test says what a real
// person should see; where the code disagrees, the test fails first and the fix follows at the cause.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-quiet-break-'));
let F;
let PR;
let VS;
let LG;
let M;
let AG;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * as fewer from ${JSON.stringify(path.join(root, 'src/shared/fewer-folders.ts'))};`,
      `export * as prefsMod from ${JSON.stringify(path.join(root, 'src/shared/prefs.ts'))};`,
      `export * as vaultSettings from ${JSON.stringify(path.join(root, 'src/shared/vault-settings.ts'))};`,
      `export * as living from ${JSON.stringify(path.join(root, 'src/shared/living-graph.ts'))};`,
      '',
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  F = S.fewer;
  PR = S.prefsMod;
  VS = S.vaultSettings;
  LG = S.living;
  const mEntry = path.join(work, 'mentry.ts');
  writeFileSync(mEntry, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\nexport { TasksService } from ${JSON.stringify(path.join(root, 'src/main/tasks.ts'))};\n`);
  await build({ input: mEntry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  const aEntry = path.join(work, 'aentry.ts');
  writeFileSync(aEntry, `export * from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};\n`);
  await build({ input: aEntry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'a.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  AG = await import(pathToFileURL(path.join(work, 'a.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const T0 = new Date(2026, 10, 8, 9, 0).getTime();
const ctxWith = (quiet) => ({
  templatesFolder: 'Templates',
  assetsFolder: 'Assets',
  attachmentsFolder: 'Attachments',
  dailyFolder: 'Daily',
  docsFolder: 'Docs',
  areas: [],
  moduleFolders: [],
  quietFolders: quiet,
});
const indexed = (files, quiet = []) => {
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) index.set(rel, text, T0, text.length);
  index.setQuiet(quiet);
  return index;
};
/** The chat assistant's tools on made-up notes in memory, as tests/agent.test.mjs drives them. */
function agentOn(files, quiet = []) {
  const index = indexed(files, quiet);
  const folders = [...new Set(Object.keys(files).filter((r) => r.includes('/')).map((r) => r.slice(0, r.lastIndexOf('/'))))];
  const host = {
    index,
    listing: async () => ({ files: Object.keys(files).map((rel) => ({ rel, kind: 'note' })), folders }),
    exists: async (rel) => rel in files,
    read: async (rel) => {
      if (!(rel in files)) throw new Error('missing');
      return files[rel];
    },
    write: async () => {},
    makeFolder: async () => {},
    move: async (from, to) => ({ path: to, linksUpdated: 0 }),
    trash: async () => {},
    clean: (rel) => (typeof rel === 'string' && rel && !rel.split('/').includes('..') ? rel.replace(/^\/+/, '') : ''),
    today: () => 'Sunday 8 November 2026 (2026-11-08)',
  };
  const tools = new AG.AgentTools(host, [], () => {});
  const run = (name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });
  return { run };
}

test('prefix siblings: keeping Plans out leaves Plans and reports in view, and back', () => {
  const quietPlans = ctxWith(['Plans']);
  assert.equal(F.isQuietPath('Plans/Kick-off.md', quietPlans), true);
  assert.equal(F.isQuietPath('Plans and reports/Summary.md', quietPlans), false, 'a sibling whose name starts the same way is not inside it');
  assert.equal(F.isMachineryPath('Plans and reports/Summary.md', quietPlans), false);
  const quietReports = ctxWith(['Plans and reports']);
  assert.equal(F.isQuietPath('Plans and reports/Summary.md', quietReports), true);
  assert.equal(F.isQuietPath('Plans/Kick-off.md', quietReports), false);
  // The main side reads the same boundary: Related and the chat's scope leave the sibling alone.
  const wording = 'harbour store fit-out till roll supplier quote catering numbers';
  const index = indexed(
    {
      'Plans/Kick-off.md': `# Kick-off\n\n${wording}.\n`,
      'Plans and reports/Summary.md': `# Summary\n\n${wording} again.\n`,
      'Work/Notes/Unrelated.md': '# Unrelated\n\nWeekend decorating.\n',
    },
    ['Plans'],
  );
  assert.equal(index.isQuiet('Plans/Kick-off.md'), true);
  assert.equal(index.isQuiet('Plans and reports/Summary.md'), false, 'the index reads the same boundary as the lists');
  const rel = index.relatedNotes('Plans and reports/Summary.md').map((r) => r.path);
  assert.ok(!rel.includes('Plans/Kick-off.md'), 'the kept-out note is never suggested');
  const rel2 = index.relatedNotes('Work/Notes/Unrelated.md', 12);
  assert.ok(!rel2.some((r) => r.path === 'Plans/Kick-off.md'), 'kept out everywhere in Related, not only beside its sibling');
  const chunks = index.retrieve('harbour store fit-out', 8, 24000).map((c) => c.path);
  assert.ok(!chunks.includes('Plans/Kick-off.md'), 'the chat reads past it');
  assert.ok(chunks.includes('Plans and reports/Summary.md'), 'but still reads the sibling');
  const hits = index.search('harbour store fit-out').map((h) => h.path);
  assert.ok(hits.includes('Plans/Kick-off.md'), 'search still finds the kept-out note itself');
});

test('nested: a kept-out folder inside one in view hides only itself; the reverse hides all', () => {
  const inner = ctxWith(['Work/Archive']);
  assert.equal(F.isQuietPath('Work/Archive/Old plan.md', inner), true);
  assert.equal(F.isQuietPath('Work/Notes/Kick-off.md', inner), false, 'the folder in view still shows around it');
  assert.equal(F.isMachineryTop('Work', inner), false, 'its top still shows');
  assert.deepEqual(F.splitTopFolders(['Work', 'Archive'], inner).shown, ['Work', 'Archive']);
  // The reverse: keeping the parent out keeps everything under it, with no way to except a child.
  const outer = ctxWith(['Work']);
  assert.equal(F.isQuietPath('Work/Archive/Old plan.md', outer), true, 'a child of a kept-out folder is out of view too');
  assert.equal(F.isMachineryTop('Work', outer), true);
});

test('keeping a folder already covered adds nothing; bringing back is exact', () => {
  assert.deepEqual(F.addQuietFolder(['Archive'], 'Archive'), ['Archive'], 'keeping twice keeps once');
  assert.deepEqual(F.addQuietFolder(['Archive'], 'Archive/Old'), ['Archive'], 'a child of a kept-out folder is already out: nothing to add');
  assert.deepEqual(F.addQuietFolder(['Archive/Old'], 'Archive'), ['Archive'], 'keeping the parent drops the child it covers');
  assert.deepEqual(F.removeQuietFolder(['Archive', 'Plans'], 'archive'), ['Plans'], 'bringing back reads case as keeping does');
  assert.deepEqual(F.removeQuietFolder(['Archive'], 'Archive/Old'), ['Archive'], 'bringing back a child that was never kept changes nothing');
  assert.equal(typeof F.isQuietFolder, 'function', 'one exact reading for the folder menu, however the folder is written');
  assert.equal(F.isQuietFolder(['Archive'], 'Archive'), true);
  assert.equal(F.isQuietFolder(['Archive'], 'archive/'), true, 'trailing slashes read the same');
  assert.equal(F.isQuietFolder(['Archive'], 'Archive\\'), true, 'backslashes read the same');
  assert.equal(F.isQuietFolder(['Archive'], 'Archive/Old'), false, 'inside is not itself: the menu tells them apart');
  assert.equal(F.isQuietFolder([], 'Archive'), false);
});

test('a kept-out folder follows its rename or move', () => {
  assert.equal(typeof F.movedFolderList, 'function', 'one remapping every folder list follows a move through');
  assert.deepEqual(F.movedFolderList(['Archive', 'Archive/Old', 'Work'], 'Archive', 'Archive 2025'), ['Archive 2025', 'Archive 2025/Old', 'Work'], 'the folder and what it covers move together');
  assert.deepEqual(F.movedFolderList(['archive'], 'archive', 'Archive'), ['Archive'], 'a rename that only changes case follows too');
  assert.deepEqual(F.movedFolderList(['Plans', 'Work'], 'Archive', 'Archive 2025'), ['Plans', 'Work'], 'nothing under the old name: nothing changes');
  assert.deepEqual(F.movedFolderList(['Archive/Old'], 'Archive', 'Work/Archive'), ['Work/Archive/Old'], 'a move into another folder follows');
  const app = read('src/main/app.ts');
  assert.ok(app.includes('movedFolderList'), 'a move or rename carries the kept-out folders (and the search’s left-out folders) with it');
});

test('case, trailing slashes and backslashes read the same everywhere', () => {
  assert.equal(F.isQuietPath('ARCHIVE/Old plan.md', ctxWith(['archive/'])), true);
  assert.equal(F.isQuietPath('Work/Archive/Old plan.md', ctxWith(['Work\\Archive'])), true);
  assert.equal(F.isQuietPath('Work/Archive/Old plan.md', ctxWith(['//Work//Archive//'])), true);
  // What the vault keeps is already clean, so every side agrees on it.
  const merged = PR.mergePrefs(PR.DEFAULT_PREFS, { quietFolders: ['  ARCHIVE/ ', 'Work\\Archive', 'Plans'] });
  assert.deepEqual(merged.quietFolders, ['ARCHIVE', 'Work/Archive', 'Plans'], 'kept folders are cleaned on the way in');
  const index = indexed({ 'ARCHIVE/Old plan.md': '# Old plan\n\nWords.\n' }, merged.quietFolders);
  assert.equal(index.isQuiet('ARCHIVE/Old plan.md'), true, 'the main side agrees with the lists');
  assert.equal(index.isQuiet('archive/Old plan.md'), true, 'whatever case the folder is written in');
});

test('non-English names keep out and come back', () => {
  const quiet = ['Zürich 2026', '旅行/京都'];
  assert.equal(F.isQuietPath('Zürich 2026/Miete.md', ctxWith(quiet)), true);
  assert.equal(F.isQuietPath('旅行/京都/宿.md', ctxWith(quiet)), true);
  assert.equal(F.isQuietPath('Zürich 2025/Miete.md', ctxWith(quiet)), false);
  const index = indexed({ 'Zürich 2026/Miete.md': '# Miete\n\nWorte.\n' }, quiet);
  assert.equal(index.isQuiet('Zürich 2026/Miete.md'), true);
  assert.deepEqual(F.removeQuietFolder(quiet, 'ZÜRICH 2026'), ['旅行/京都'], 'bringing back reads case as keeping does, in any script');
  const merged = PR.mergePrefs(PR.DEFAULT_PREFS, { quietFolders: quiet });
  assert.deepEqual(merged.quietFolders, quiet, 'cleaning keeps the names whole');
});

test('a due task still answers in Tasks, whatever Today leaves out', () => {
  const index = indexed({
    'Archive/Website refresh.md': '# Website refresh\n\n- [ ] Approve the homepage words 📅 2026-11-08\n',
    'Work/Notes/Kick-off.md': '# Kick-off\n\n- [ ] Order the till roll 📅 2026-11-08\n',
  }, ['Archive']);
  const tasks = new M.TasksService({ index, templatesFolder: () => 'Templates', write: async () => {}, now: () => T0 });
  const paths = tasks.view().tasks.map((t) => t.path);
  assert.ok(paths.includes('Archive/Website refresh.md'), 'Tasks still rows the kept-out task: a due task is never lost, only out of Today');
  assert.ok(paths.includes('Work/Notes/Kick-off.md'), 'real work still rows');
});

test('the graph hides a kept-out note by default, shows it with Show everything, and never loses the open one', () => {
  const nodes = [
    { id: 'Archive/Old plan.md', title: 'Old plan', kind: 'note', quiet: true },
    { id: 'Work/Notes/Kick-off.md', title: 'Kick-off', kind: 'note' },
  ];
  const links = [{ source: 'Work/Notes/Kick-off.md', target: 'Archive/Old plan.md' }];
  const scoped = LG.livingScope(nodes, links, { store: {} });
  assert.ok(!scoped.nodes.some((n) => n.id === 'Archive/Old plan.md'), 'kept-out points leave the default view');
  assert.ok(scoped.nodes.some((n) => n.id === 'Work/Notes/Kick-off.md'), 'real work stays');
  assert.ok(!scoped.links.length, 'no thread to what is not drawn');
  const all = LG.livingScope(nodes, links, { store: {}, showRest: true });
  assert.ok(all.nodes.some((n) => n.id === 'Archive/Old plan.md'), 'Show everything brings it back');
  const centred = LG.livingScope(nodes, links, { store: {}, forceIds: ['Archive/Old plan.md'] });
  assert.ok(centred.nodes.some((n) => n.id === 'Archive/Old plan.md'), 'the open note still centres, noise never takes the middle');
  assert.equal(LG.isAlwaysHiddenGraphPath('Private notes/Quiet.md'), true, 'Private notes never draw, asked for or not');
});

test('the assistant reads a kept-out note by name, but never lists it among all notes', async () => {
  const files = {
    'Archive/Old plan.md': '# Old plan\n\nThe harbour store fit-out wording.\n',
    'Work/Notes/Kick-off.md': '# Kick-off\n\nReal work.\n',
  };
  const { run } = agentOn(files, ['Archive']);
  const list = (await run('list_notes', {})).text;
  assert.ok(!list.includes('Archive/Old plan.md'), 'all notes leaves kept-out notes out');
  assert.ok(list.includes('Work/Notes/Kick-off.md'), 'real work still lists');
  const recent = (await run('recent_notes', { days: 365 })).text;
  assert.ok(!recent.includes('Archive/Old plan.md'), 'recent notes leaves them out too');
  // Asked by name, it still reads: the folder name, the note's path, or search first.
  const scoped = (await run('list_notes', { folder: 'Archive' })).text;
  assert.ok(scoped.includes('Archive/Old plan.md'), 'the kept-out folder itself still lists when asked for by name');
  assert.match((await run('read_note', { path: 'Archive/Old plan.md' })).text, /harbour store/, 'reading by path still reads');
  assert.match((await run('search_notes', { query: 'harbour store fit-out' })).text, /Old plan\.md/, 'search still finds it for the assistant too');
});

test('two PCs: kept-out folders merge item by item, and an older vault opens with nothing kept out', () => {
  // Item 3 (8 Nov 2026) replaced whole-list last-writer-wins for this list with a union of additions,
  // removals honoured by the latest change per folder (tests/folder-followups-merge.test.mjs proves the removals).
  const a = VS.setValues(VS.emptyDoc('settings'), { quietFolders: ['Archive'] }, 100, 'pc-a').doc;
  const b = VS.setValues(VS.emptyDoc('settings'), { quietFolders: ['Plans'] }, 200, 'pc-b').doc;
  const merged = VS.mergeDocs(a, b);
  assert.deepEqual([...VS.docValues(merged).quietFolders].sort(), ['Archive', 'Plans'], 'two PCs keeping different folders out merge to both');
  assert.deepEqual(PR.loadPrefs({}).quietFolders, [], 'a vault from before the setting opens with nothing kept out');
  assert.deepEqual(VS.joinPrefs({}, {}, {}).quietFolders ?? [], [], 'and joining its settings reads nothing kept out');
  const parts = VS.splitPrefs({ quietFolders: ['Archive'] });
  assert.deepEqual(parts.vault.quietFolders, ['Archive'], 'the vault’s file still carries them');
});

test('Private notes never surface through Show everything', () => {
  const index = indexed({ 'Work/Notes/Kick-off.md': '# Kick-off\n\nReal work.\n' });
  index.set('Private notes/Quiet.md', '# Quiet\n\nSecret words.\n', T0, 10);
  assert.equal(index.get('Private notes/Quiet.md'), undefined, 'a private note is never indexed, whatever door tries');
  assert.ok(!index.search('Secret words').some((h) => h.path === 'Private notes/Quiet.md'), 'search never finds it');
  assert.ok(!index.graph('').nodes.some((n) => n.id === 'Private notes/Quiet.md'), 'the graph never holds it');
  const vault = read('src/main/vault.ts');
  assert.ok(vault.includes('isPrivateTop'), 'the vault’s own listing never lists the Private notes folder, so no tree can show it');
});

test('the folder menu reads kept-out exactly, however the folder is written', () => {
  const menus = read('src/renderer/src/state/menus.ts');
  assert.ok(menus.includes('isQuietFolder'), 'the menu reads kept-out through the one exact reading, not its own compare');
});
