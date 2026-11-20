// node --test tests/quiet-folders.test.mjs — a folder can be kept out of view (8 Nov 2026). The Notes
// page opens on "This week": eight plans and reports in Business/Studio/Plans and reports, written by
// a contractor, sitting above the real work. They are kept, but not in view — and the same for any
// reference or archive folder. The machinery rule (src/shared/fewer-folders.ts) carries the person's
// folders too, so one list hides. Made-up vault, same shape: 8 dated papers above real work.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-quiet-'));
let F;
let L;
let A;
let T;
let P;
let G;
let GL;
let PR;
let VS;
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * as fewer from ${JSON.stringify(path.join(root, 'src/shared/fewer-folders.ts'))};`,
      `export * as notesList from ${JSON.stringify(path.join(root, 'src/shared/notes-list.ts'))};`,
      `export * as areas from ${JSON.stringify(path.join(root, 'src/shared/areas.ts'))};`,
      `export * as today from ${JSON.stringify(path.join(root, 'src/shared/today.ts'))};`,
      `export { parseProject } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`,
      `export * as graphScope from ${JSON.stringify(path.join(root, 'src/shared/graph-scope.ts'))};`,
      `export * as graphLayout from ${JSON.stringify(path.join(root, 'src/shared/graph-layout.ts'))};`,
      `export * as prefsMod from ${JSON.stringify(path.join(root, 'src/shared/prefs.ts'))};`,
      `export * as vaultSettings from ${JSON.stringify(path.join(root, 'src/shared/vault-settings.ts'))};`,
      '',
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  F = S.fewer;
  L = S.notesList;
  A = S.areas;
  T = S.today;
  P = S;
  G = S.graphScope;
  GL = S.graphLayout;
  PR = S.prefsMod;
  VS = S.vaultSettings;
  const mEntry = path.join(work, 'mentry.ts');
  writeFileSync(mEntry, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`);
  await build({ input: mEntry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const QUIET = 'Business/HostApp/Plans and reports';
const NOW = new Date(2026, 10, 8, 9, 0); // Sunday 8 November 2026
const T0 = NOW.getTime();
const areasWith = () => [
  { id: 'work', name: 'Work', folder: 'Work', icon: 'briefcase', color: 'slate', about: '' },
  { id: 'business', name: 'Business', folder: 'Business', icon: 'chart', color: 'clay', about: '' },
  { id: 'home', name: 'Home', folder: 'Home', icon: 'home', color: 'ochre', about: '' },
  { id: 'me', name: 'Me', folder: 'Me', icon: 'person', color: 'sky', about: '' },
  { id: 'library', name: 'Library', folder: 'Library', icon: 'bookmark', color: 'stone', about: '', quiet: true },
];
const ctxWith = (quiet = [QUIET]) => ({
  templatesFolder: 'Templates',
  assetsFolder: 'Assets',
  attachmentsFolder: 'Attachments',
  dailyFolder: 'Daily',
  docsFolder: 'Docs',
  areas: areasWith(),
  moduleFolders: ['Me/Finance'],
  quietFolders: quiet,
});
const note = (p, agoHrs = 24, props = {}) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), label: p.split('/').pop().replace(/\.md$/, ''), mtime: T0 - agoHrs * 3600000, props });

// The eight dated papers above their real work, plus the real work itself.
function papers() {
  return [
    'Vault week plan (9 Nov 2026).md',
    'Job kits plan (7 Nov 2026).md',
    'Connections audit, stage 1 (6 Nov 2026).md',
    'Premium feature videos plan (6 Nov 2026).md',
    'Branded PDFs plan (5 Nov 2026).md',
    'LF meeting recording audit (5 Nov 2026).md',
    'Vault tidy 4 Nov 2026.md',
    'Domain leads feedback (5 Nov 2026).md',
  ].map((n, i) => note(`${QUIET}/${n}`, 5 + i * 9));
}
function realWork() {
  return [note('Work/Notes/Kick-off.md', 6), note('Business/Plan.md', 30), note('Home/Notes/Paint colours.md', 50), note('Me/Notes/Weekend.md', 70)];
}

test('one list hides: the machinery rule carries the person’s folders too', () => {
  const ctx = ctxWith();
  assert.equal(typeof F.isQuietPath, 'function', 'one quiet reading beside the machinery reading');
  assert.equal(F.isQuietPath(`${QUIET}/Vault week plan (9 Nov 2026).md`, ctx), true, 'a note in the kept-out folder reads quiet');
  assert.equal(F.isQuietPath(QUIET, ctx), true, 'the folder itself reads quiet');
  assert.equal(F.isQuietPath('Business/Plan.md', ctx), false, 'the rest of the area is not quiet');
  assert.equal(F.isQuietPath('Work/Notes/Kick-off.md', ctx), false, 'real work is not quiet');
  // The machinery rule reuses it: hidden in Notes, the rail and the trees through the one path check.
  assert.equal(F.isMachineryPath(`${QUIET}/Vault week plan (9 Nov 2026).md`, ctx), true, 'kept-out notes sit under Show everything');
  assert.equal(F.isMachineryPath('Business/Plan.md', ctx), false, 'the area still shows around them');
  // A whole top folder kept out hides at the top too.
  assert.equal(F.isMachineryTop('Archive', ctxWith(['Archive'])), true, 'a kept-out top folder hides');
  assert.equal(F.isMachineryTop('Work', ctx), false, 'their area still shows');
  // Keeping and bringing back are exact, and keeping a parent drops its redundant children.
  assert.deepEqual(F.removeQuietFolder([QUIET, 'Archive'], QUIET), ['Archive'], 'bringing back drops that folder only');
  assert.deepEqual(F.addQuietFolder(['Archive/Old'], 'Archive'), ['Archive'], 'keeping a parent drops the child it already covers');
  assert.deepEqual(F.addQuietFolder([], QUIET), [QUIET], 'keeping adds the folder');
});

test('a kept-out folder leaves Notes and This week, and shows under Show everything marked quietly', () => {
  const rows = [...papers(), ...realWork()].map((n) => L.noteRow({ path: n.path, title: n.title, mtime: n.mtime, props: n.props }));
  const ctx = ctxWith();
  const shown = rows.filter((r) => !F.isMachineryPath(r.path, ctx));
  assert.ok(shown.every((r) => !r.path.startsWith(`${QUIET}/`)), 'no kept-out paper in the main list');
  assert.ok(shown.some((r) => r.path === 'Work/Notes/Kick-off.md'), 'real work stays');
  const groups = L.groupNoteRows(shown, NOW);
  const week = groups.find((g) => g.id === 'week')?.rows ?? [];
  assert.ok(week.every((r) => !r.path.startsWith(`${QUIET}/`)), 'This week reads real work, not the eight papers');
  // Show everything brings them back, and the page can mark what it kept out.
  const folders = L.folderChoices(shown);
  assert.ok(!folders.some((f) => f.prefix === 'Business' && f.subs.some((s) => s.prefix === `${QUIET}`)), 'the kept-out folder leaves the rail');
  const all = rows.filter((r) => !F.isMachineryPath(r.path, ctxWith([])));
  assert.equal(all.filter((r) => r.path.startsWith(`${QUIET}/`)).length, 8, 'Show everything holds all eight papers');
  assert.ok(all.filter((r) => F.isQuietPath(r.path, ctx)).every((r) => r.path.startsWith(`${QUIET}/`)), 'only the kept-out papers read quiet, so only they are marked');
  const page = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(page.includes('quietFolders'), 'Notes reads the person’s folders into its machinery');
  assert.ok(page.includes('isQuietPath') || page.includes('Out of view'), 'kept-out notes are marked quietly under Show everything');
});

test('a kept-out folder leaves Today', () => {
  const proj = (p, what) => ({ path: p, version: 'v', modified: T0 - 3600000, project: P.parseProject(`---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# ${p}\n\n## What’s next\n\n- [ ] ${what} — Mia · by 2026-11-09\n`, p) });
  const data = T.buildToday(
    {
      projects: [proj(`${QUIET}/Website refresh.md`, 'Approve the homepage words'), proj('Work/Projects/Studio Upgrade.md', 'Order the till roll')],
      notes: [
        { path: `${QUIET}/Vault week plan (9 Nov 2026).md`, title: 'Vault week plan', mtime: T0 - 3600000, props: {} },
        { path: 'Work/Notes/Kick-off.md', title: 'Kick-off', mtime: T0 - 3600000, props: {} },
      ],
    },
    NOW,
  );
  const dayLists = (d) => [...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later, ...d.due.stale];
  assert.ok(dayLists(data).some((d) => d.project.startsWith(QUIET)), 'the kept-out step is in the unfiltered day');
  // Today keeps what the areas want and nothing kept out, as the window’s keep does.
  const areas = areasWith();
  const keep = (path) => A.wanted({ path }, 'all', areas) && !F.isQuietPath(path, ctxWith());
  const shown = A.todayFor(data, keep);
  assert.ok(!dayLists(shown).some((d) => d.project.startsWith(QUIET)), 'kept-out steps leave the day lists');
  assert.ok(dayLists(shown).some((d) => d.project === 'Work/Projects/Studio Upgrade.md'), 'real work stays');
  assert.ok(!shown.changed.some((c) => c.project.startsWith(QUIET)), 'kept-out changes leave Changed');
  const hook = read('src/renderer/src/views/today/TodayAreas.tsx');
  assert.ok(hook.includes('quietFolders') || hook.includes('isQuietPath') || hook.includes('isMachineryPath'), 'Today’s keep leaves kept-out folders out');
  const hub = read('src/main/hub.ts');
  assert.ok(hub.includes('isQuiet') || hub.includes('quiet'), 'the hub’s lists leave kept-out folders out too');
});

test('a kept-out folder leaves the Graph’s default view', () => {
  const nodes = [
    { id: `${QUIET}/Vault week plan (9 Nov 2026).md`, title: 'Vault week plan', kind: 'note', tags: [], quiet: true },
    { id: 'Work/Notes/Kick-off.md', title: 'Kick-off', kind: 'note', tags: [] },
  ];
  assert.equal(G.isHiddenGraphNode(nodes[0]), true, 'a kept-out note hides from the graph');
  assert.equal(G.isHiddenGraphNode(nodes[1]), false, 'real work shows');
  const links = [{ source: 'Work/Notes/Kick-off.md', target: `${QUIET}/Vault week plan (9 Nov 2026).md` }];
  const groups = G.focusGroups([...nodes], links, 'Work/Notes/Kick-off.md');
  assert.ok(!groups.flatMap((g) => g.nodes).some((n) => n.id.startsWith(QUIET)), 'a kept-out neighbour leaves the focus view');
  const map = GL.buildMap(
    [
      { id: `${QUIET}/Website refresh.md`, title: 'Website refresh', kind: 'note', tags: [], project: true, status: 'active', quiet: true },
      { id: 'Work/Projects/Studio Upgrade.md', title: 'Studio Upgrade', kind: 'note', tags: [], project: true, status: 'active' },
    ],
    [],
  );
  assert.ok(!map.flatMap((c) => c.projects).some((p) => p.id.startsWith(QUIET)), 'a kept-out project holds no card on the map');
  assert.ok(map.flatMap((c) => c.projects).some((p) => p.id === 'Work/Projects/Studio Upgrade.md'), 'a real project still cards');
  // The main side marks what the person kept out, so the shared hiding reads it.
  const index = new M.VaultIndex();
  index.set(`${QUIET}/Vault week plan (9 Nov 2026).md`, '# Vault week plan\n\nThe developer wrote this plan.\n', T0, 10);
  index.set('Work/Notes/Kick-off.md', '# Kick-off\n\nReal work.\n', T0, 10);
  index.setQuiet([QUIET]);
  const graph = index.graph('');
  assert.equal(graph.nodes.find((n) => n.id.startsWith(QUIET))?.quiet, true, 'kept-out nodes are marked quiet');
  assert.equal(graph.nodes.find((n) => n.id === 'Work/Notes/Kick-off.md')?.quiet ?? false, false, 'real nodes are not');
});

test('a kept-out folder leaves Related and the chat’s all-notes scope, but search still finds it and links still open', () => {
  const index = new M.VaultIndex();
  const wording = 'till roll receipt wording harbour studio upgrade supplier quote catering numbers';
  index.set('Work/Notes/Kick-off.md', `# Kick-off\n\n${wording}. See [[Vault week plan (9 Nov 2026)]] for the background.\n\n#till #store\n`, T0, 10);
  index.set(`${QUIET}/Vault week plan (9 Nov 2026).md`, `# Vault week plan\n\n${wording} and more on the same fit-out.\n\n#till #store\n`, T0, 10);
  index.set('Home/Notes/Paint colours.md', '# Paint colours\n\nUnrelated weekend decorating.\n', T0, 10);
  const before = index.relatedNotes('Work/Notes/Kick-off.md').map((r) => r.path);
  assert.ok(before.includes(`${QUIET}/Vault week plan (9 Nov 2026).md`), 'alike enough to suggest before it is kept out');
  index.setQuiet([QUIET]);
  const after = index.relatedNotes('Work/Notes/Kick-off.md').map((r) => r.path);
  assert.ok(!after.includes(`${QUIET}/Vault week plan (9 Nov 2026).md`), 'kept-out notes are never suggested');
  const chunks = index.retrieve('till roll receipt wording', 8, 24000).map((c) => c.path);
  assert.ok(!chunks.includes(`${QUIET}/Vault week plan (9 Nov 2026).md`), 'the chat’s all-notes scope reads past kept-out notes');
  assert.ok(chunks.includes('Work/Notes/Kick-off.md'), 'real work still answers');
  const hits = index.search('till roll receipt wording').map((h) => h.path);
  assert.ok(hits.includes(`${QUIET}/Vault week plan (9 Nov 2026).md`), 'search still finds kept-out notes');
  assert.equal(index.resolve('Vault week plan (9 Nov 2026)', 'Work/Notes/Kick-off.md'), `${QUIET}/Vault week plan (9 Nov 2026).md`, 'a link still opens the kept-out note');
  // New writes into the folder stay out of view.
  index.set(`${QUIET}/Next report (10 Nov 2026).md`, `# Next report\n\n${wording} continued.\n\n#till #store\n`, T0, 10);
  assert.ok(!index.relatedNotes('Work/Notes/Kick-off.md').some((r) => r.path === `${QUIET}/Next report (10 Nov 2026).md`), 'the next report lands out of view too');
  assert.ok(index.search('Next report').some((h) => h.path === `${QUIET}/Next report (10 Nov 2026).md`), 'and search still finds it');
  // Bringing back restores it everywhere.
  index.setQuiet([]);
  assert.ok(index.relatedNotes('Work/Notes/Kick-off.md').some((r) => r.path.startsWith(QUIET)), 'bringing back restores Related');
  assert.equal(F.isMachineryPath(`${QUIET}/Vault week plan (9 Nov 2026).md`, ctxWith([])), false, 'and the lists');
});

test('the setting lives in the vault’s own settings, so it syncs with the vault', () => {
  assert.equal(VS.PREF_HOME.quietFolders, 'vault', 'kept-out folders are the vault’s, like its folders and links');
  assert.deepEqual(PR.DEFAULT_PREFS.quietFolders, [], 'nothing kept out at first');
  const merged = PR.mergePrefs(PR.DEFAULT_PREFS, { quietFolders: [QUIET, '  ', `${QUIET}/`] });
  assert.deepEqual(merged.quietFolders, [QUIET], 'kept folders are cleaned like the search’s left-out folders');
  const parts = VS.splitPrefs({ quietFolders: [QUIET] });
  assert.deepEqual(parts.vault.quietFolders, [QUIET], 'the vault’s file carries them');
  assert.equal('quietFolders' in parts.personal, false, 'the person’s file does not');
  assert.deepEqual(VS.joinPrefs({}, {}, { quietFolders: [QUIET] }).quietFolders, [QUIET], 'opening the vault reads them back');
});

test('the folder menu is the door, and Settings lists what is kept out with Bring back', () => {
  const menus = read('src/renderer/src/state/menus.ts');
  assert.ok(menus.includes('Keep out of view'), 'folders offer Keep out of view');
  assert.ok(menus.includes('Bring back into view'), 'kept-out folders offer Bring back into view');
  const folders = read('src/renderer/src/panels/FileExplorer.tsx');
  assert.ok(folders.includes('quietFolders'), 'the file tree hides what the person kept out');
  const nav = read('src/renderer/src/panels/Navigator.tsx');
  assert.ok(nav.includes('quietFolders'), 'the folder list hides it too');
  const rail = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(rail.includes('onContextMenu') && rail.includes('quietFolders'), 'the Notes rail’s folders menu too, not only the tree');
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.ok(settings.includes('kept out of view') || settings.includes('Kept out of view'), 'Settings lists the folders kept out of view');
  assert.ok(settings.includes('Bring back'), 'each with Bring back beside it');
  const searchIndex = read('src/renderer/src/lib/settingsSearch.ts');
  assert.ok(searchIndex.includes('kept out of view') || searchIndex.includes('Kept out of view'), 'the row is findable in Settings search');
  const app = read('src/main/app.ts');
  assert.ok(app.includes('setQuiet'), 'the main side follows the setting for Related, the chat and the graph');
});
