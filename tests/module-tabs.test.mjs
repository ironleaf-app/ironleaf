// node --test tests/module-tabs.test.mjs — opening a life module's page (src/renderer/src/state/module-tabs.ts
// withModuleOpen, used by state/modules.ts openModule): the module's own place on the left side, Today's "Open" links and a
// Windows notice name no page, and a tab of that module already open on another page (Finance on Bills) came back as it
// was; it now comes back to the module's first page, in that same tab, wherever it is, pinned or not.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-modtabs-'));
let W, M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'tabs.ts');
  writeFileSync(entry, [`export * as W from ${JSON.stringify(path.join(root, 'src/renderer/src/state/workspace.ts'))};`, `export * as M from ${JSON.stringify(path.join(root, 'src/renderer/src/state/module-tabs.ts'))};`].join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'tabs.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ W, M } = await import(pathToFileURL(path.join(work, 'tabs.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));
afterEach(() => W.showTabs(true));

const paths = (ws) => W.groups(ws.root).map((g) => g.tabs.map((t) => (t.type === 'empty' ? '(empty)' : t.path)));
const front = (ws) => {
  const g = W.groups(ws.root).find((x) => x.id === ws.activeGroup);
  return g.tabs.find((t) => t.id === g.active)?.path;
};
const today = () => W.open(W.defaultWorkspace(), { type: 'today', path: 'today' });

test('Finance left on Bills: opening Finance (no page named) brings it back to its first page, in the same tab', () => {
  let ws = M.withModuleOpen(today(), 'finance', 'bills', 'tab');
  assert.deepEqual(paths(ws), [['today', 'module:finance#bills']]);
  ws = W.activate(ws, ws.activeGroup, W.groups(ws.root)[0].tabs[0].id);
  assert.equal(front(ws), 'today', 'Today in front, Finance behind on Bills');
  ws = M.withModuleOpen(ws, 'finance');
  assert.deepEqual(paths(ws), [['today', 'module:finance']], 'no second Finance tab');
  assert.equal(front(ws), 'module:finance', 'Finance in front, on its first page');
  // The page it was on is kept for Back.
  const tab = W.groups(ws.root)[0].tabs[1];
  assert.deepEqual(tab.back.at(-1), { type: 'module', path: 'module:finance#bills' });
  // Asked again while already there: nothing changes.
  assert.equal(M.withModuleOpen(ws, 'finance'), ws);
});

test('a page named goes to that page; already there, it only comes forward', () => {
  let ws = M.withModuleOpen(today(), 'finance', undefined, 'tab');
  ws = M.withModuleOpen(ws, 'finance', 'budgets');
  assert.deepEqual(paths(ws), [['today', 'module:finance#budgets']]);
  const again = M.withModuleOpen(ws, 'finance', 'budgets');
  assert.deepEqual(paths(again), paths(ws));
  assert.equal(front(again), 'module:finance#budgets');
});

test('its tab in the other pane: that tab changes and its pane comes forward; this pane is left as it was', () => {
  let ws = today();
  const left = ws.activeGroup;
  ws = M.withModuleOpen(ws, 'documents', 'expiry', 'right');
  assert.deepEqual(paths(ws), [['today'], ['module:documents#expiry']]);
  ws = W.activate(ws, left);
  ws = M.withModuleOpen(ws, 'documents');
  assert.deepEqual(paths(ws), [['today'], ['module:documents']]);
  assert.notEqual(ws.activeGroup, left, 'the pane with Documents and ID comes forward');
});

test('a pinned tab of the module is changed in place, never a second tab beside it', () => {
  let ws = M.withModuleOpen(today(), 'finance', 'spending', 'tab');
  const id = W.groups(ws.root)[0].tabs[1].id;
  ws = W.updateTab(ws, id, { pinned: true });
  ws = M.withModuleOpen(ws, 'finance');
  assert.deepEqual(paths(ws), [['today', 'module:finance']]);
  assert.equal(W.groups(ws.root)[0].tabs[1].pinned, true, 'still pinned');
  assert.equal(front(ws), 'module:finance');
});

test('two tabs of one module: the one in front is used', () => {
  let ws = M.withModuleOpen(today(), 'finance', 'bills', 'tab');
  ws = M.withModuleOpen(ws, 'finance', 'budgets', 'tab');
  assert.deepEqual(paths(ws), [['today', 'module:finance#bills', 'module:finance#budgets']]);
  ws = M.withModuleOpen(ws, 'finance');
  assert.deepEqual(paths(ws), [['today', 'module:finance#bills', 'module:finance']], 'the front one, not the first one');
});

test('not open yet, or asked for in a new tab: opened where asked; one page at a time works the same', () => {
  let ws = M.withModuleOpen(today(), 'finance');
  assert.deepEqual(paths(ws), [['module:finance']], 'in the current tab');
  ws = M.withModuleOpen(ws, 'finance', 'bills', 'tab');
  assert.equal(paths(ws)[0].length, 2, 'asked for in a new tab, a new tab');
  W.showTabs(false);
  let one = M.withModuleOpen(today(), 'finance', 'bills');
  one = W.open(one, { type: 'today', path: 'today' });
  one = M.withModuleOpen(one, 'finance');
  assert.equal(front(one), 'module:finance', 'tabs off: the page shows Finance’s first page');
  assert.equal(M.moduleOfTab({ type: 'module', path: 'module:finance#bills' }), 'finance');
  assert.equal(M.partOfTab({ path: 'module:finance#bills' }), 'bills');
});
