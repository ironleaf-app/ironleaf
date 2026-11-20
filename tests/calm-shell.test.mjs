// node --test tests/calm-shell.test.mjs — the calm shell (Ironleaf Calm, 20 Oct 2026). The layout's one-time change
// (the chat closed, the calm list on the left) and the person's later choices kept; no piles of "New tab"; one page at
// a time with tabs off (Ctrl+ click opens beside the page, in the one pane there); the kinds of thing on the left side
// with their counts, in the order the person dragged their sections into; and the new settings' defaults.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-calm-'));
let W, K, N, P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const make = async (name, file) => {
    const entry = path.join(work, `${name}.ts`);
    writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, file))};\n`);
    await build({ input: entry, platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  W = await make('workspace', 'src/renderer/src/state/workspace.ts');
  K = await make('kinds', 'src/shared/shell-types.ts');
  N = await make('nav', 'src/shared/navigator.ts');
  P = await make('prefs', 'src/shared/prefs.ts');
});
after(() => rmSync(work, { recursive: true, force: true }));
afterEach(() => W.showTabs(true));

const note = (p) => ({ type: 'note', path: p });
const tabsOf = (ws) => W.groups(ws.root).map((g) => g.tabs.map((t) => (t.type === 'empty' ? '(empty)' : t.path)));

test('a new vault starts calm: the calm list on the left, the chat closed', () => {
  const ws = W.defaultWorkspace();
  assert.equal(ws.left.panel, 'home');
  assert.equal(ws.right.open, false);
  assert.equal(ws.calm, W.CALM);
});

test('a layout saved before the calm shell opens calm once; the person’s later choices are kept', () => {
  const old = { ...W.defaultWorkspace(), left: { open: true, width: 300, panel: 'files' }, right: { open: true, width: 400, panel: 'backlinks' } };
  delete old.calm;
  const first = W.restore(JSON.parse(JSON.stringify(old)));
  assert.equal(first.right.open, false, 'the chat side starts closed');
  assert.equal(first.left.panel, 'home', 'the file tree becomes the calm list');
  assert.equal(first.left.width, 300, 'its width is kept');
  assert.equal(first.right.panel, 'backlinks', 'and the right side’s panel');
  // Afterwards the person opens the chat and the Files panel: kept from then on.
  const chosen = { ...first, left: { ...first.left, panel: 'files' }, right: { ...first.right, open: true, panel: 'chat' } };
  const again = W.restore(JSON.parse(JSON.stringify(chosen)));
  assert.equal(again.right.open, true);
  // 8.0 (29 Oct 2026, owner: the left nav never cluttered): the vault always reopens on its nav, whatever a session ended on.
  assert.equal(again.left.panel, 'home', 'a Files panel left open is not what the vault reopens with');
  // Search or bookmarks open when it changed: left as they were.
  const searching = { ...old, left: { ...old.left, panel: 'search' } };
  assert.equal(W.restore(JSON.parse(JSON.stringify(searching))).left.panel, 'home');
  // Something unreadable in the panel: the calm list.
  assert.equal(W.restore(JSON.parse(JSON.stringify({ ...chosen, left: { ...chosen.left, panel: 'ribbon' } }))).left.panel, 'home');
});

test('no piles of New tab: an empty tab is used before another is made', () => {
  let ws = W.defaultWorkspace();
  ws = W.open(ws, note('A.md'));
  ws = W.open(ws, { type: 'empty' }, 'tab');
  ws = W.activate(ws, ws.activeGroup, W.activeGroup(ws).tabs[0].id); // the person leaves the empty tab
  assert.deepEqual(tabsOf(ws), [['A.md', '(empty)']]);
  // Another New tab: the empty one comes forward.
  ws = W.open(ws, { type: 'empty' }, 'tab');
  assert.deepEqual(tabsOf(ws), [['A.md', '(empty)']]);
  assert.equal(W.activeTab(ws).type, 'empty');
  // A note asked for in a new tab (Ctrl+click in the side bar) fills the empty tab.
  ws = W.activate(ws, ws.activeGroup, W.activeGroup(ws).tabs[0].id);
  ws = W.open(ws, note('B.md'), 'tab');
  assert.deepEqual(tabsOf(ws), [['A.md', 'B.md']]);
  assert.equal(W.activeTab(ws).path, 'B.md');
  // No empty tab left: a new one, after the active tab, as before.
  ws = W.open(ws, note('C.md'), 'tab');
  assert.deepEqual(tabsOf(ws), [['A.md', 'B.md', 'C.md']]);
  // A pinned tab opening a note in place uses an empty tab too.
  ws = W.updateTab(ws, W.activeTab(ws).id, { pinned: true });
  ws = W.open(ws, { type: 'empty' }, 'tab');
  ws = W.activate(ws, ws.activeGroup, W.activeGroup(ws).tabs[2].id);
  ws = W.open(ws, note('D.md'));
  assert.deepEqual(tabsOf(ws), [['A.md', 'B.md', 'C.md', 'D.md']]);
});

test('tabs off: one page at a time, and Ctrl+click replaces the page in the one pane (Polish round 2, ITEMS 2: nothing opens a split by itself)', () => {
  W.showTabs(false);
  assert.equal(W.tabsAreShown(), false);
  let ws = W.open(W.defaultWorkspace(), note('A.md'));
  ws = W.open(ws, note('B.md'));
  assert.deepEqual(tabsOf(ws), [['B.md']], 'opening replaces the page');
  assert.deepEqual(W.activeTab(ws).back.map((p) => p.path), ['A.md'], 'Back returns to it');
  // A new empty page is this page, not a hidden tab.
  ws = W.open(ws, { type: 'empty' }, 'tab');
  assert.deepEqual(tabsOf(ws), [['(empty)']]);
  ws = W.navigate(ws, W.activeTab(ws).id, -1);
  assert.equal(W.activeTab(ws).path, 'B.md');
  // Ctrl+click: in the one pane, replacing the page on show (no split beside it).
  ws = W.open(ws, note('C.md'), 'tab');
  assert.deepEqual(tabsOf(ws), [['C.md']]);
  ws = W.open(ws, note('D.md'), 'tab');
  assert.deepEqual(tabsOf(ws), [['D.md']]);
  assert.equal(W.activeTab(ws).path, 'D.md');
  assert.deepEqual(W.activeTab(ws).back.map((p) => p.path), ['A.md', 'B.md', 'C.md']);
});

// ── The kinds on the left side ──────────────────────────────────────────────────────────────────────────────────────

const T = Date.parse('2026-10-20T09:00:00');
const n = (p, props = {}) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), label: p.split('/').pop().replace(/\.md$/, ''), mtime: T, props });
const config = { templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments', dailyFolder: 'Daily', todayName: '2026-10-20', showAllFiles: true };
const sectionsOf = (notes, files = []) => N.buildSections(notes, [...notes.map((x) => ({ rel: x.path, mtime: T, kind: 'note' })), ...files], [], config);

test('a fresh vault lists Projects and Notes; a lived-in one each kind it has, with its count', () => {
  assert.deepEqual(K.sectionKinds(sectionsOf([])).map((k) => [k.id, k.plural, k.count]), [['projects', 'Projects', 0], ['notes', 'Notes', 0]]);
  const lived = sectionsOf(
    [n('Projects/Harbour/Harbour.md', { type: 'project', status: 'active' }), n('Projects/Harbour/Kick-off.md'), n('Docs/Backups.md'), n('Shopping.md'), n('Ideas/Bread.md'), n('Daily/2026-10-20.md'), n('Templates/Meeting.md')],
    [{ rel: 'Boards/Plan.canvas', mtime: T, kind: 'canvas' }, { rel: 'Attachments/photo.png', mtime: T, kind: 'image' }],
  );
  const kinds = K.sectionKinds(lived);
  assert.deepEqual(kinds.map((k) => k.id), ['projects', 'docs', 'notes', 'daily', 'canvases', 'templates']);
  assert.equal(kinds.find((k) => k.id === 'projects').count, 1);
  assert.equal(kinds.find((k) => k.id === 'notes').count, 2);
  // Attachments only when asked for; a kind switched off isn't listed.
  assert.ok(K.sectionKinds(lived, { showAttachments: true }).some((k) => k.id === 'attachments'));
  assert.ok(!K.sectionKinds(lived, { hidden: ['projects'] }).some((k) => k.id === 'projects'));
});

test('the order someone dragged their sections into is the kinds’ order, and a drag keeps every section placed', () => {
  const lived = sectionsOf([n('Projects/Harbour/Harbour.md', { type: 'project' }), n('Docs/Backups.md'), n('Shopping.md')]);
  // Saved before the calm shell, by dragging sections in the file list.
  const saved = ['notes', 'projects'];
  assert.deepEqual(K.sectionKinds(lived, { order: saved }).map((k) => k.id), ['notes', 'projects', 'docs']);
  const moved = K.movedKinds(saved, 'docs', 'notes', false);
  assert.deepEqual(K.sectionKinds(lived, { order: moved }).map((k) => k.id), ['docs', 'notes', 'projects']);
  assert.equal(moved.length, N.SECTION_ORDER.length, 'every section keeps a place, shown or not');
  // A kind that isn't shown can't be moved onto: nothing changes.
  assert.deepEqual(K.movedKinds(moved, 'docs', 'nonsense', true), K.movedKinds(moved, 'docs', 'docs', true));
});

test('tabs off and the status line off by default; each kept as chosen (29 Oct 2026, SPEC section A)', () => {
  assert.equal(P.DEFAULT_PREFS.showTabs, false);
  assert.equal(P.DEFAULT_PREFS.statusLine, false);
  // A settings file from before (no such keys): the defaults.
  const before = P.loadPrefs({ theme: 'light', hidden: [] });
  assert.equal(before.showTabs, false);
  assert.equal(before.statusLine, false);
  const chosen = P.mergePrefs(before, { showTabs: false, statusLine: true });
  assert.equal(chosen.showTabs, false);
  assert.equal(chosen.statusLine, true);
  assert.equal(P.mergePrefs(chosen, { showTabs: 'yes', statusLine: 1 }).showTabs, false, 'nonsense is ignored');
});
