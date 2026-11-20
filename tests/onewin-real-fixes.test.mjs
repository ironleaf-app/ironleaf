// node --test tests/onewin-real-fixes.test.mjs — one window, what the real app showed (9 Nov 2026,
// on a laptop at 02:15, NS_VAULT_IN_WINDOW=1, the real vault): every one-product test passed,
// yet clicking Today/Graph left Vault's view on People, Vault's own header still showed inside the
// view, and the Notes tree listed the app's own folders. Each test below fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const app = read('src/main/app.ts');
// One function body: from its header to its closing brace at two-space indent.
const bodyOf = (src, header) => {
  const at = src.indexOf(header);
  assert.ok(at >= 0, `${header} exists`);
  const end = src.indexOf('\n  }\n', at);
  return src.slice(at, end < 0 ? at + 3000 : end);
};

// ---- 1. CRITICAL: a place arriving with vault:opened is lost ----
// The view stayed on People because every navigation re-sent vault:opened (the vault was already open),
// and the page answers vault:opened with a full reload from the saved layout — landing after the place,
// so the saved page wins. vault:opened means the vault opened (a change); navigating never re-says it.
test('openInView never re-says vault:opened: the place rides alone', () => {
  const fn = bodyOf(app, 'async function openInView');
  assert.ok(fn.includes('vault:open-place'), 'the place still rides to the view');
  assert.ok(!fn.includes("send('vault:opened'"), 'no vault:opened beside it (the reload would land after the place)');
});

test('openWindow never re-says vault:opened either: same door, same rule', () => {
  const fn = bodyOf(app, 'async function openWindow');
  assert.ok(fn.includes('vault:open-place') || fn.includes('pendingPlace'), 'the place still rides to the window');
  assert.ok(!fn.includes("send('vault:opened'"), 'no vault:opened beside it');
});

test('a vault that actually opens still says so once', () => {
  assert.ok(app.includes("send('vault:opened', opened)"), 'openVault announces the opening');
});

test('the view still receives the place: sendToView reaches the view', () => {
  const send = app.slice(app.indexOf('const sendToView'), app.indexOf('const sendToView') + 300);
  assert.match(send, /viewContents/, 'sendToView sends to the view’s page');
  assert.match(send, /CHANNEL\(channel\)/, 'on the same nv: channel the preload subscribes');
  assert.ok(!/win\.webContents/.test(send), 'and never the window too');
});

test('every side-bar place is a place the main side keeps', () => {
  const fn = bodyOf(app, 'function validPlace');
  for (const place of ['today', 'inbox', 'projects', 'tasks', 'meetings', 'notes', 'people', 'graph'])
    assert.ok(fn.includes(`'${place}'`), `${place} kept`);
});

test('a place arriving while the vault loads waits for the notes, then lands', () => {
  const page = read('src/renderer/src/App.tsx');
  // Navigation during the vault:opened reload used to land first and be wiped by the saved layout.
  assert.ok(page.includes('vaultLoading') || page.includes('pendingNav') || page.includes('deferredPlace'), 'the page holds navigation while the vault loads');
  const open = page.slice(page.indexOf('const openLibrary'), page.indexOf('const openLibrary') + 1600);
  assert.ok(/pendingNav|deferredPlace|deferredNav/.test(open), 'openLibrary lands what waited once the notes are there');
  const sub = page.slice(page.indexOf('vaultOpenPlace'), page.indexOf('vaultOpenPlace') + 400);
  assert.ok(/defer|pending|vaultLoading/.test(sub), 'vault:open-place waits its turn');
});

// ---- 2. one search, one account: Vault's header goes in the frameless view ----
test('frameless Vault keeps its pages’ own actions, drops its chrome', () => {
  const header = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(header.includes('inVaultView'), 'the header knows when it lives in the host app’s window');
  // Back, forward, +, the centred search, the panel toggle and the avatar go; the page’s own row stays.
  assert.ok(/inVaultView\(\)[\s\S]{0,600}return null/.test(header), 'nothing to show draws nothing');
  assert.ok(header.includes('children') && header.includes('menu'), 'the page’s own actions and menu stay');
});

test('the window keeps its header exactly as today', () => {
  const header = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(header.includes('Ask or find anything'), 'the centred search stays for the window');
  // 20 Nov 2026: the header's avatar left for the side bar's account chip (tests/account-menu.test.mjs).
  assert.ok(!header.includes('HeaderAvatar'), 'the account lives at the side bar’s foot, not in every header');
  assert.ok(header.includes('Back') && header.includes('Forward'), 'back and forward stay for the window');
});

// ---- 4. the Notes tree uses the same machinery rule ----
test('the main side answers the side bar’s tree from fewer-folders', () => {
  assert.ok(app.includes('topFolders'), 'a topFolders door for the one side bar');
  const at = app.indexOf('topFolders: async');
  assert.ok(at >= 0, 'topFolders answered beside todayCount');
  const fn = app.slice(at, at + 2600);
  assert.ok(fn.includes('isMachineryTop') || fn.includes('splitTopFolders'), 'tops hide through fewer-folders, never a second list');
  assert.ok(fn.includes('quietFolders') || fn.includes('isQuiet'), 'kept-out folders hide too');
  assert.ok(fn.includes('areasNow') || fn.includes('areas'), 'areas read as Notes reads them');
  assert.ok(fn.includes('moduleFolder') || fn.includes('moduleFolders'), 'the packs’ own folders read too');
  assert.ok(fn.includes('templatesFolder'), 'the configured store read too');
});

// ---- 5. the last rough edges (one window, 9 Nov 2026): repeated coarse tabs that never converged, counts
// disagreeing between the bar and the page,
// a highlight that never followed, Today's lone row. Each test fails without its fix.
const work = mkdtempSync(path.join(tmpdir(), 'nv-onewin-'));
let TS;
let NL;
let NT;
let MR;
let WS;
let LG;
let LM;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * as tabSync from ${JSON.stringify(path.join(root, 'src/renderer/src/state/tabSync.ts'))};`,
      `export * as notesList from ${JSON.stringify(path.join(root, 'src/shared/notes-list.ts'))};`,
      `export * as noteTypes from ${JSON.stringify(path.join(root, 'src/shared/note-types.ts'))};`,
      `export * as moduleRecords from ${JSON.stringify(path.join(root, 'src/shared/module-records.ts'))};`,
      `export * as workspace from ${JSON.stringify(path.join(root, 'src/renderer/src/state/workspace.ts'))};`,
      `export * as livingGraph from ${JSON.stringify(path.join(root, 'src/shared/living-graph.ts'))};`,
      `export * as lifeModules from ${JSON.stringify(path.join(root, 'src/shared/life-modules.ts'))};`,
      '',
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'f.mjs'), format: 'esm' }, logLevel: 'silent' });
  const M = await import(pathToFileURL(path.join(work, 'f.mjs')).href);
  TS = M.tabSync;
  NL = M.notesList;
  NT = M.noteTypes;
  MR = M.moduleRecords;
  WS = M.workspace;
  LG = M.livingGraph;
  LM = M.lifeModules;
});
after(() => rmSync(work, { recursive: true, force: true }));

// One place opens one tab: going to a place already open selects its tab. Vault's doors already reuse (pinned
// below against regression); what was missing is each reported tab saying what it is, so the one above can
// match instead of minting another coarse tab beside it (navigating where the view already was sends no
// report back to converge them).
test('a place goes to the tab already open for it, never a second one', () => {
  const actions = read('src/renderer/src/state/actions.ts');
  for (const [fn, type] of [['openToday', "'today'"], ['openProjects', "'projects'"], ['openTasks', "'tasks'"], ['openGraph', "'graph'"]]) {
    const atSync = actions.indexOf(`export function ${fn}`);
    const atAsync = actions.indexOf(`export async function ${fn}`);
    const at = atAsync >= 0 ? atAsync : atSync;
    assert.ok(at >= 0 && actions.slice(at, at + 700).includes(type), `${fn} finds its own tab first`);
  }
  const folders = read('src/renderer/src/state/noteTypes.ts');
  const at = folders.indexOf('export function openNotesFolder');
  assert.ok(at >= 0 && folders.slice(at, at + 900).includes('W.activate'), 'a Notes folder already open comes forward');
});

test('every reported tab says what it is, in the seam’s words', () => {
  assert.deepEqual(TS.tabTarget({ id: 'a', type: 'today' }), { place: 'today' }, 'Today is its place');
  assert.deepEqual(TS.tabTarget({ id: 'a', type: 'projects' }), { place: 'projects' }, 'Projects too');
  assert.deepEqual(TS.tabTarget({ id: 'a', type: 'tasks' }), { place: 'tasks' }, 'Tasks too');
  assert.deepEqual(TS.tabTarget({ id: 'a', type: 'graph', path: 'Work/x.md' }), { place: 'graph' }, 'a centred graph is still the place');
  assert.deepEqual(TS.tabTarget({ id: 'a', type: 'people', path: 'people:' }), { place: 'people' }, 'the People page is the place');
  assert.equal(TS.tabTarget({ id: 'a', type: 'people', path: 'person:Ann' }), undefined, 'a person’s page is no place');
  assert.deepEqual(TS.tabTarget({ id: 'a', type: 'type', path: 'type:note' }), { place: 'notes' }, 'Notes is the place');
  assert.deepEqual(TS.tabTarget({ id: 'a', type: 'type', path: 'type:note?folder=Work' }), { place: 'notes', folder: 'Work' }, 'Notes in a folder carries it');
  assert.equal(TS.tabTarget({ id: 'a', type: 'type', path: 'type:doc' }), undefined, 'a Docs filter page matches nothing above');
  assert.deepEqual(TS.tabTarget({ id: 'a', type: 'notebook', path: 'notebook:Work' }), { place: 'notes', folder: 'Work' }, 'a notebook is Notes in its folder');
  assert.deepEqual(TS.tabTarget({ id: 'a', type: 'note', path: 'Work/Budget.md' }), { note: 'Work/Budget.md' }, 'a note is its file');
  assert.equal(TS.tabTarget({ id: 'a', type: 'module', path: 'module:finance' }), undefined, 'a pack’s page matches nothing above');
  assert.equal(TS.tabTarget({ id: 'a', type: 'settings' }), undefined, 'Settings matches nothing above');
});

test('the report carries what each tab is, and a changed target crosses', () => {
  const ws = (tabs, active) => ({ root: { kind: 'group', id: 'g', tabs, active }, activeGroup: 'g' });
  const titles = (t) => t.type;
  const before = TS.tabSyncReport(ws([{ id: 't1', type: 'type', path: 'type:note' }], 't1'), titles);
  assert.deepEqual(before.tabs, [{ id: 't1', title: 'type', target: { place: 'notes' } }], 'Notes reports its place');
  const after = TS.tabSyncReport(ws([{ id: 't1', type: 'type', path: 'type:note?folder=Work' }], 't1'), titles);
  assert.deepEqual(after.tabs[0].target, { place: 'notes', folder: 'Work' }, 'filtering to Work reports the folder');
  assert.equal(TS.tabSyncEqual(before, after), false, 'the folder change crosses even though the title did not');
  assert.equal(TS.tabSyncEqual(before, TS.tabSyncReport(ws([{ id: 't1', type: 'type', path: 'type:note' }], 't1'), titles)), true, 'the same tabs stay quiet');
});

test('what each tab is rides the preload and the main side whole', () => {
  const preload = read('src/preload/index.ts');
  assert.ok(preload.includes('target?: { place?: string; folder?: string; note?: string }'), 'the preload carries each tab’s target');
  assert.ok(app.includes('target?: { place?: string; folder?: string; note?: string }'), 'the host seam carries it too');
  const at = app.indexOf('function tabsReport');
  assert.ok(at >= 0, 'the view’s tabs are reported');
  const fn = app.slice(at, at + 2200);
  assert.ok(fn.includes('place') && fn.includes('folder') && fn.includes('note'), 'each tab’s target crosses, capped');
});

// Every count of the same folder says what clicking shows: the bar counts the index by Notes’ own rule.
const meta = (p, props = {}) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), props });
const countCtx = () => ({
  templatesFolder: 'Templates',
  assetsFolder: 'Assets',
  attachmentsFolder: 'Attachments',
  dailyFolder: 'Daily',
  areas: [],
  moduleFolders: [],
  quietFolders: ['Me/Quiet'],
});
const countTypes = () => NT.resolveTypes(NT.emptyConfig(), { topFolders: ['Work', 'Me'], templatesFolder: 'Templates', docsFolder: 'Docs', modules: MR.moduleTypeInputs(['finance'], null) });
// The walk in miniature: notes, a project and a meeting (their own pages), a doc, a bill (a record), a
// template, a daily note, machinery, and a folder kept out of view.
const countMetas = () => [
  meta('Work/Plan.md'),
  meta('Work/Budget.md'),
  meta('Work/Specs.md', { type: 'doc' }),
  meta('Work/Projects/Deep.md'),
  meta('Work/Launch.md', { type: 'project' }),
  meta('Work/Standup.md', { type: 'meeting' }),
  meta('Work/Bill.md', { type: 'bill' }),
  meta('Me/Note.md'),
  meta('Me/Quiet/Hidden.md'),
  meta('Templates/T.md'),
  meta('Daily/2026-11-05.md'),
];

test('the bar counts what the page lists, folder by folder', () => {
  const types = countTypes();
  const machinery = countCtx();
  // The bar's side: the index through the one rule.
  const bar = new Map();
  for (const m of countMetas()) {
    const top = m.path.includes('/') ? m.path.slice(0, m.path.indexOf('/')) : '';
    if (NL.countsOnNotes(m, types, 'Templates', machinery)) bar.set(top, (bar.get(top) ?? 0) + 1);
  }
  // The page's side: rows through the rail, as NotesPage builds them.
  const rows = [];
  for (const m of countMetas()) {
    const typeId = NT.typeOfNote(m, types, 'Templates');
    const kind = NL.noteKindOf({ path: m.path, title: m.title, typeId, props: m.props });
    if (!NL.notesPageKeepsType(typeId, kind)) continue;
    const record = !!types.find((t) => t.id === typeId)?.module;
    if (!NL.notesPageKeepsPath(m.path, kind, record, machinery)) continue;
    rows.push({ ...m, kind, record, kindLabel: kind, snippet: '' });
  }
  const rail = new Map(NL.folderChoices(rows).map((f) => [f.prefix, f.count]));
  assert.deepEqual(Object.fromEntries(bar), { Work: 4, Me: 1, Daily: 1 }, 'the bar counts notes, docs and dailies — never projects, meetings, records, templates or kept-out folders');
  assert.equal(rail.get('Work'), bar.get('Work'), 'Work agrees on both sides');
  assert.equal(rail.get('Me'), bar.get('Me'), 'Me agrees on both sides');
});

test('the main side counts the index by Notes’ rule, resolved as the page resolves it', () => {
  const at = app.indexOf('topFolders: async');
  assert.ok(at >= 0, 'the door still answers');
  const fn = app.slice(at, at + 2600);
  assert.ok(fn.includes('index.allMeta()'), 'it counts the index, not a walk of every Markdown file');
  assert.ok(fn.includes('countsOnNotes'), 'by Notes’ own rule');
  assert.ok(fn.includes('moduleTypeInputs'), 'with the packs’ record types resolved as the page resolves them');
  assert.ok(fn.includes('PRIVATE_DIR'), 'private notes never count');
});

test('the Notes head, chips and project filter follow the folder on show', () => {
  const page = read('src/renderer/src/views/NotesPage.tsx');
  // t271 (13 Nov 2026): the head counts the rows on show, within the folder on show and the chip picked, and
  // every reading carries Show everything, so number, chip and rows agree.
  assert.ok(page.includes('count={shown.length}'), 'the head counts the rows on show');
  assert.ok(/const shown = useMemo\(\(\) => filterNoteRows\(rows, \{[^}]*folder: folder \|\| null[^}]*includeRecords: showAll/.test(page), 'those rows are the folder on show, with Show everything');
  assert.ok(/kindCount = .*inFolder/.test(page), 'the chips count within it');
  assert.ok(page.includes('projectChoices(inFolder)'), 'the project filter counts within it too');
  assert.ok(page.includes('filterNoteRows(rows, { folder, includeRecords: showAll })'), 'the folder on show scopes them, with Show everything');
  assert.ok(page.includes('notesPageKeepsType') && page.includes('notesPageKeepsPath'), 'the page reads the one shared rule the bar counts by');
});

// Today's top row names its page like the other pages' rows do (a file keeps its crumb).
test('a place names its words once, for tabs and header rows alike', () => {
  assert.equal(TS.placeName('today'), 'Today', 'Today');
  assert.equal(TS.placeName('projects'), 'Projects', 'Projects');
  assert.equal(TS.placeName('tasks'), 'Tasks', 'Tasks');
  assert.equal(TS.placeName('inbox'), 'Inbox', 'Inbox');
  assert.equal(TS.placeName('meetings'), 'Meetings', 'Meetings');
  assert.equal(TS.placeName('people'), 'People', 'People');
  assert.equal(TS.placeName('graph'), 'Graph', 'Graph');
  assert.equal(TS.placeName('settings'), 'Settings', 'Settings');
  assert.equal(TS.placeName('private'), 'Locked', 'Locked');
  assert.equal(TS.placeName('empty'), 'New tab', 'New tab');
  assert.equal(TS.placeName('type'), undefined, 'a Notes tab is named where it is drawn');
  assert.equal(TS.placeName('note'), undefined, 'a file keeps its crumb');
  assert.equal(TS.placeName('module'), undefined, 'a pack keeps its own words');
});

test('a frameless page row with no crumb carries the page name; a file keeps its crumb', () => {
  const header = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(header.includes('placeName'), 'the frameless row names a crumbless page');
  const at = header.indexOf('if (inVaultView())');
  assert.ok(at >= 0, 'only in the host app’s window');
  const fn = header.slice(at, at + 1600);
  assert.ok(fn.includes('<b>{pageName}</b>'), 'the name reads where the crumb would');
  assert.ok(fn.includes('crumbNode'), 'a file still reads its crumb');
  const ws = read('src/renderer/src/views/Workspace.tsx');
  assert.ok(ws.includes('placeName(tab.type)'), 'tabs read the same name from the same place');
});

// ---- 6. one place, one tab, inside Vault too (t73, 9 Nov 2026, the strip on a copy of the
// vault: Tasks, Today, Projects, Systems note, Docs note, Tasks, Projects, Tasks, Graph, Area note): Vault's
// own saved layout held three Tasks tabs and two Projects tabs from older sessions, before opening a place
// reused its tab. Vault never holds two tabs for the same target now: opening one that is open selects it,
// and restoring a saved layout folds repeats into one. Each test fails without its fix.
const t73tab = (id, type, p) => ({ id, type, ...(p === undefined ? {} : { path: p }), back: [], forward: [] });

test('a saved layout with three Tasks, two Projects and a note twice restores to one each', () => {
  const tabs = () => [
    t73tab('a1', 'tasks'), t73tab('a2', 'tasks'), t73tab('a3', 'tasks'),
    t73tab('b1', 'projects'), t73tab('b2', 'projects'),
    t73tab('c1', 'note', 'Work/Plan.md'), t73tab('c2', 'note', 'Work/Plan.md'),
    t73tab('d1', 'graph'),
  ];
  const ws = WS.restore({ root: { kind: 'group', id: 'g', active: 'd1', tabs: tabs() }, activeGroup: 'g' });
  assert.ok(ws, 'the layout restores');
  assert.deepEqual(ws.root.tabs.map((t) => t.id), ['a1', 'b1', 'c1', 'd1'], 'one of each: the first, none showing');
  assert.equal(ws.root.active, 'd1', 'the showing tab stays showing');
  const shown = WS.restore({ root: { kind: 'group', id: 'g', active: 'a3', tabs: tabs() }, activeGroup: 'g' });
  assert.equal(shown.root.tabs.find((t) => t.type === 'tasks').id, 'a3', 'the showing repeat survives, not the first');
  assert.equal(shown.root.tabs.filter((t) => t.type === 'projects').length, 1, 'Projects still folds to one');
});

test('folding keeps every split with a tab, and never folds what has no target', () => {
  const split = WS.restore({
    root: {
      kind: 'split', id: 's', dir: 'row', children: [
        { kind: 'group', id: 'g1', active: 'a1', tabs: [t73tab('a1', 'tasks')] },
        { kind: 'group', id: 'g2', active: 'n1', tabs: [t73tab('a2', 'tasks'), t73tab('n1', 'note', 'Work/Plan.md')] },
      ], sizes: [0.5, 0.5],
    }, activeGroup: 'g1',
  });
  const [g1, g2] = split.root.children;
  assert.deepEqual(g1.tabs.map((t) => t.id), ['a1'], 'the showing Tasks survives in its pane');
  assert.deepEqual(g2.tabs.map((t) => t.id), ['n1'], 'the other pane keeps its note, the repeat gone');
  const emptied = WS.restore({
    root: {
      kind: 'split', id: 's', dir: 'row', children: [
        { kind: 'group', id: 'g1', active: 'a1', tabs: [t73tab('a1', 'tasks')] },
        { kind: 'group', id: 'g2', active: 'a2', tabs: [t73tab('a2', 'tasks')] },
      ], sizes: [0.5, 0.5],
    }, activeGroup: 'g2',
  });
  const [e1, e2] = emptied.root.children;
  assert.deepEqual(e2.tabs.map((t) => t.id), ['a2'], 'the showing pane keeps its tab');
  assert.equal(e1.tabs.length, 1, 'the emptied pane keeps a tab');
  assert.equal(e1.tabs[0].type, 'empty', 'a new empty tab, never a repeat');
  const pages = WS.restore({
    root: { kind: 'group', id: 'g', active: 's1', tabs: [t73tab('s1', 'settings'), t73tab('s2', 'settings'), t73tab('m1', 'module', 'module:systems'), t73tab('e1', 'empty')] },
    activeGroup: 'g',
  });
  assert.equal(pages.root.tabs.length, 4, 'tabs with no target never fold');
});

test('opening Tasks twice gives one tab: the second open selects the first', () => {
  let ws = WS.defaultWorkspace();
  ws = WS.open(ws, { type: 'tasks' }, 'current');
  const first = WS.activeTab(ws).id;
  ws = WS.open(ws, { type: 'empty' }, 'tab');
  ws = WS.open(ws, { type: 'tasks' }, 'current');
  const tabs = WS.groups(ws.root)[0].tabs;
  assert.equal(tabs.filter((t) => t.type === 'tasks').length, 1, 'no second Tasks tab');
  assert.equal(WS.activeTab(ws).id, first, 'the open Tasks tab is selected');
});

test('opening a note or a folder twice selects too; an asked-for tab still opens', () => {
  let ws = WS.defaultWorkspace();
  ws = WS.open(ws, { type: 'note', path: 'Work/Plan.md' }, 'current');
  const note = WS.activeTab(ws).id;
  ws = WS.open(ws, { type: 'empty' }, 'tab');
  ws = WS.open(ws, { type: 'note', path: 'Work/Plan.md' }, 'current');
  assert.equal(WS.groups(ws.root)[0].tabs.filter((t) => t.path === 'Work/Plan.md').length, 1, 'one tab for the note');
  assert.equal(WS.activeTab(ws).id, note, 'the open note is selected');
  ws = WS.open(ws, { type: 'empty' }, 'tab');
  ws = WS.open(ws, { type: 'note', path: 'Work/Plan.md' }, 'current', 'page');
  assert.equal(WS.activeTab(ws).id, note, 'the open note is selected again');
  assert.equal(WS.findTab(ws, note).tab.mode, 'page', 'an asked-for view still lands on the selected tab');
  ws = WS.open(ws, { type: 'type', path: 'type:note?folder=Work' }, 'tab');
  const folder = WS.activeTab(ws).id;
  ws = WS.open(ws, { type: 'empty' }, 'tab');
  ws = WS.open(ws, { type: 'type', path: 'type:note?folder=Work' }, 'current');
  assert.equal(WS.activeTab(ws).id, folder, 'the open folder tab is selected');
  ws = WS.open(ws, { type: 'tasks' }, 'tab');
  const tasks = WS.groups(ws.root)[0].tabs.filter((t) => t.type === 'tasks').length;
  ws = WS.open(ws, { type: 'tasks' }, 'tab');
  assert.equal(WS.groups(ws.root)[0].tabs.filter((t) => t.type === 'tasks').length, tasks + 1, 'an explicit new tab still opens beside');
});

test('with tabs off, opening replaces on screen instead (regression pin)', () => {
  let ws = WS.defaultWorkspace();
  ws = WS.open(ws, { type: 'tasks' }, 'current');
  ws = WS.open(ws, { type: 'note', path: 'Work/Plan.md' }, 'tab');
  WS.showTabs(false);
  try {
    ws = WS.open(ws, { type: 'tasks' }, 'current');
    const tabs = WS.groups(ws.root)[0].tabs;
    assert.equal(tabs.length, 2, 'the out-of-sight Tasks is not brought forward with no Back to here');
    assert.equal(WS.activeTab(ws).type, 'tasks', 'the page on screen becomes Tasks');
    assert.equal(WS.activeTab(ws).back.length, 1, 'Back returns to the note');
  } finally {
    WS.showTabs(true);
  }
});

// Systems, Docs and Area on the strip are pages, never notes: the Systems pack's page, the Docs
// type's page, and an area page whose area is gone. They carry no note target, so the one above reads them
// bare (ns/tests/onewin-real-fixes.mjs pins the words); a real note still reports its own name.
test('Systems, Docs and Area are pages with no note target; a real note reports its name', () => {
  assert.equal(LM.moduleInfo('systems')?.name, 'Systems', 'Systems is the Systems pack page');
  assert.equal(TS.tabTarget({ id: 'a', type: 'module', path: 'module:systems' }), undefined, 'a pack page carries no note target');
  assert.equal(countTypes().find((t) => t.id === 'doc')?.plural, 'Docs', 'Docs is the Docs type page');
  assert.ok(read('src/renderer/src/views/areaTabs.ts').includes("?? 'Area'"), 'Area is an area page whose area is gone');
  assert.equal(TS.tabTarget({ id: 'a', type: 'area', path: 'area:gone#projects' }), undefined, 'an area page carries no note target either');
  assert.ok(read('src/renderer/src/App.tsx').includes('byPathNow.get(tab.path)?.title'), 'the report names a real note by its own title');
});

// The graph's names never hide under the legend: a label collides with the legend's box the way it collides
// with any other label, so the smaller one - the label - hides.
test('a label under the legend hides like a label under another label', () => {
  const legend = { x: 110, y: 150, w: 196, h: 280 };
  const under = { id: 'n:Work/cold.md', x: 110, y: 150, w: 180, h: 17, rank: 500 };
  const clear = { id: 'n:Work/far.md', x: 500, y: 150, w: 180, h: 17, rank: 100 };
  assert.deepEqual([...LG.resolveLivingLabels([under, clear], legend)], ['n:Work/far.md'], 'the label under the legend hides, the clear one draws');
  assert.deepEqual([...LG.resolveLivingLabels([under, clear])].sort(), ['n:Work/cold.md', 'n:Work/far.md'], 'without a legend both draw');
  const big = { id: 'n:Work/big.md', x: 110, y: 150, w: 400, h: 30, rank: 99999 };
  assert.deepEqual([...LG.resolveLivingLabels([big, clear], legend)], ['n:Work/far.md'], 'size never saves a label under the legend');
});

test('the engine hands the legend’s measured box to the label pass', () => {
  // t86: the single legend box became uiBoxes (the find box, the legend, the view buttons), each fed
  // as an already-taken label so names never sit under any of them. The behaviour pin above still holds.
  const engine = read('src/renderer/src/lib/brain-engine.ts');
  assert.ok(engine.includes('this.uiBoxes()'), 'the label pass sees the measured boxes');
  assert.ok(engine.includes("'.bg-legend'"), 'the legend on screen is still measured');
  assert.ok(engine.includes('if (this.compact) return []'), 'the note’s own graph has no boxes over it');
  assert.ok(engine.includes('resolveLivingLabels([...uiTaken'), 'the boxes ride as already-taken labels');
  assert.ok(engine.includes('Number.POSITIVE_INFINITY'), 'the boxes win over every label');
  // The retired living graph keeps the same rule behind its dev-only door.
  const living = read('src/renderer/src/lib/living-engine.ts');
  assert.ok(living.includes('resolveLivingLabels(cands, this.legendBox()'), 'the retired engine keeps it too');
});

const liveSleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function liveWaitFor(h, js, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await liveSleep(250);
  }
}
async function liveOpenRoom(h, name) {
  const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], summary';
  const click = (words, scope) => h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 400));
    return 'CLICKED';
  })()`);
  if ((await click(name, '.sidebar.left, aside')) === 'CLICKED') return;
  assert.equal(await click('More', '.sidebar.left, aside'), 'CLICKED', `More opens for ${name}`);
  await liveSleep(500);
  assert.equal(await click(name, '.menu, [role="menu"]'), 'CLICKED', `${name} opens from More`);
}

test('live: a label panned under the legend hides, and draws again beside it', { timeout: 600000 }, async () => {
  const h = await startHarness();
  try {
    await h.services.invoke('settings:update', [{ prefs: { showTabs: true } }]);
    await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await liveSleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await liveSleep(2000);
    await liveOpenRoom(h, 'Graph');
    assert.ok(await liveWaitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().count > 0`), 'points draw');
    assert.ok(await liveWaitFor(h, `window.__nvBrainGraph.snapshot().framed`, 90000), 'the vault settles');
    const snap = () => h.browser.ev(`window.__nvBrainGraph.snapshot()`);
    const geom = () => h.browser.ev(`(() => {
      const c = document.querySelector('.nj-graph-body .bg-canvas').getBoundingClientRect();
      const l = document.querySelector('.nj-graph-body .bg-legend').getBoundingClientRect();
      return { cx: c.x, cy: c.y, w: c.width, h: c.height, lx: l.x - c.x, ly: l.y - c.y, lw: l.width, lh: l.height };
    })()`);
    const drag = async (from, dx, dy) => {
      const steps = 12;
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(from.x), y: Math.round(from.y), button: 'left', clickCount: 1 });
      for (let i = 1; i <= steps; i++)
        await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(from.x + (dx * i) / steps), y: Math.round(from.y + (dy * i) / steps), buttons: 1 });
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(from.x + dx), y: Math.round(from.y + dy), button: 'left', clickCount: 1 });
    };
    // An empty spot on the canvas to press for a drag: off every point and off the legend so it pans,
    // with the release on the canvas too so the whole drag lands.
    const emptySpot = (s, g, dx, dy) => {
      for (let px = g.w - 70; px > g.lx + g.lw + 15; px -= 80) {
        for (let py = 70; py < g.h - 40; py += 80) {
          if (px + dx < 5 || px + dx > g.w - 5 || py + dy < 5 || py + dy > g.h - 5) continue;
          if (s.nodes.every((n) => Math.hypot(n.x - px, n.y - py) > 45)) return { x: g.cx + px, y: g.cy + py };
        }
      }
      return null;
    };
    // A pan in short legs: each press and release stays on the canvas, whatever the distance.
    const panBy = async (dx, dy) => {
      for (let leg = 0; leg < 3; leg++) {
        const s = await snap();
        const p = emptySpot(s, g, dx / 3, dy / 3);
        assert.ok(p, `an empty spot to press (leg ${leg + 1})`);
        await drag(p, dx / 3, dy / 3);
        await liveSleep(900);
      }
    };
    const s0 = await snap();
    assert.ok(s0.labels.length > 0, `a label draws to move (${s0.labels.length} drawn)`);
    const g = await geom();
    assert.ok(g.lw > 100 && g.lh > 100, `the legend is on screen (${Math.round(g.lw)}x${Math.round(g.lh)})`);
    const target = [...s0.labels].sort((a, b) => b.x - a.x)[0];
    assert.ok(target.x - target.w / 2 > g.lx + g.lw + 20, `the label starts clear of the legend (${target.id})`);
    const node0 = s0.nodes.find((n) => n.id === target.id);
    const dx = g.lx + g.lw / 2 - target.x;
    const dy = g.ly + g.lh / 2 - target.y;
    await panBy(dx, dy);
    await liveSleep(400);
    const s1 = await snap();
    const node1 = s1.nodes.find((n) => n.id === target.id);
    assert.ok(Math.abs(node1.x - (node0.x + dx)) < 40 && Math.abs(node1.y - (node0.y + dy)) < 40, 'the pan carried the world with the pointer');
    const overlaps = (L) => L.x - L.w / 2 < g.lx + g.lw && L.x + L.w / 2 > g.lx && L.y - L.h / 2 < g.ly + g.lh && L.y + L.h / 2 > g.ly;
    assert.ok(!s1.labels.some((L) => L.id === target.id), 'the label under the legend hides');
    assert.ok(!s1.labels.some(overlaps), `no drawn label hides under the legend (${s1.labels.length} drawn)`);
    await panBy(-dx, -dy);
    await liveSleep(400);
    const s2 = await snap();
    assert.ok(s2.labels.some((L) => L.id === target.id), 'beside the legend again, the label draws');
  } finally {
    await h.close().catch(() => {});
  }
});
