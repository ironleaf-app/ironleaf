// node --test tests/polish-87.test.mjs — wave 1 polish (8.7, the plan): Home and the frame to the
// mock-ups. The folded rail (reachable Fold row, hover names, the waiting dot, kept across restarts), ink titles
// with ticked-only fading on every kit row, Home's due/recent/upcoming order with Recently viewed always drawn,
// the vault head's menu, a plain More row, the 640px grouped palette, and slate-or-amber brief tags. Each test
// fails without its change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const kit = () => read('src/renderer/src/styles/kit.css');
const places = () => read('src/renderer/src/panels/Places.tsx');
const home = () => read('src/renderer/src/views/HomeView.tsx');
const rule = (css, sel) => css.match(new RegExp(`\\${sel} \\{([^}]*)\\}`, 's'))?.[1] ?? assert.fail(`no rule ${sel}`);

test('item 1: a long menu keeps every row reachable, so Fold is always a click away', () => {
  const menu = rule(kit(), '.menu');
  assert.match(menu, /max-height: calc\(100vh - 12px\)/, 'the menu stops at the window edge');
  assert.match(menu, /overflow-y: auto/, 'and scrolls within');
});

test('item 1: the rail names its row on hover and dots the rows with waiting items', () => {
  const rail = places().split('export function Rail()')[1].split('export function PlacesFoot')[0];
  assert.ok(rail.includes('className="tip"'), 'a hover tip on each row');
  assert.ok(rail.includes('waiting'), 'the tip says what waits');
  assert.ok(rail.includes("row.id === 'inbox'") && rail.includes('className="dot"'), 'the coral dot on waiting rows');
  assert.match(rule(kit(), '.rail .rrow .tip'), /display: none/, 'tips hide until hovered');
});

test('item 2: kit rows read ink, and only ticked rows fade', () => {
  assert.match(rule(kit(), '.trow .t'), /color: var\(--text\)/, 'every row title is ink');
  assert.match(rule(kit(), '.trow .t.is-done'), /color: var\(--text-faint\)/, 'a ticked row fades');
  assert.match(rule(kit(), '.trow .t.is-done'), /text-decoration: line-through/, 'with a strike');
  // The old Home's stamp rules are gone: nothing re-fades the new rows from underneath.
  assert.ok(!read('src/renderer/src/styles.css').includes('.home-due {'), 'no stale .home-due rule');
  assert.ok(!read('src/renderer/src/styles.css').includes('.home-recent button {'), 'no stale .home-recent rule');
});

test('item 3: Recently viewed always shows, as its own cards, with an honest empty line', () => {
  const src = home();
  const card = src.split('function RecentCard')[1].split('/** Bills due')[0];
  assert.ok(!card.includes('return null'), 'never hidden, even with nothing viewed');
  assert.ok(card.includes('Nothing viewed yet'), 'the honest empty line');
  assert.ok(card.includes('className="card home-cell"'), 'each recent page its own card');
  assert.ok(card.includes('home-cell-t'), 'the two-line title');
  assert.ok(card.includes('{ recent }'), 'from the recent list it is given');
  assert.ok(read('src/renderer/src/components/Modals.tsx').includes('getWorkspace().recent'), 'the header panel gives the real recent list (4 Nov 2026: the scope moved there with the middle box)');
});

test('item 5: More is a plain row; Tasks is on the rail, its late count on its page', () => {
  // 5 Nov 2026, the quiet rail: Tasks left More for the bar, and counts sit on Today and Inbox only.
  const src = places();
  assert.ok(!src.includes('{late} late') && !src.includes('late</span>'), 'no badge on the row');
  assert.ok(!src.includes('tasksLate'), 'no late hint rides into More');
  assert.ok(src.includes('<Row row={f.tasks} />'), 'Tasks is a row of the bar');
  assert.ok(read('src/renderer/src/views/TasksView.tsx').includes('taskInfos'), 'the Tasks page reads its own late count');
});

test('item 7: the brief kind tag is one calm slate, never red or amber (10.0 rooms critique: urgency is in the line\'s words)', () => {
  const card = home().split('function BriefCardHome')[1].split('/** The Inbox')[0];
  assert.ok(!card.includes("'red'"), 'no red kind tag');
  assert.ok(!card.includes("warn' ? 'amber' : 'slate'"), 'no amber repaint of a kind');
});

test('new words are plain: no em dashes in the polish', () => {
  const recent = home().split('function RecentCard')[1].split('/** Bills due')[0];
  const brief = home().split('function BriefCardHome')[1].split('/** The Inbox')[0];
  const head = places().split('export function PlacesFoot')[1].split('return (')[0];
  for (const [name, src] of [['recent', recent], ['brief', brief], ['foot menu', head]]) assert.ok(!src.includes('—'), `${name} has no em dash`);
});

// The folded bar stays folded: the saved layout round-trips the rail (kept for unfolding, never dropped).
const work = mkdtempSync(path.join(tmpdir(), 'nv-polish-'));
let W;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/state/workspace.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'ws.mjs'), format: 'esm' }, logLevel: 'silent' });
  W = await import(pathToFileURL(path.join(work, 'ws.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('item 1: the fold survives a restart (save, strip, restore)', () => {
  const group = W.newGroup();
  const ws = { ...W.defaultWorkspace(), root: group, activeGroup: group.id, left: { open: true, width: 300, panel: 'home', rail: true } };
  const back = W.restore(JSON.parse(JSON.stringify(W.withoutPrivate(ws))));
  assert.ok(back && back.left.rail === true, 'rail comes back folded');
  assert.equal(back.left.width, 300, 'the open width is kept for unfolding');
  const open = W.restore(JSON.parse(JSON.stringify({ ...ws, left: { ...ws.left, rail: false } })));
  assert.ok(open && !open.left.rail, 'unfolded stays unfolded');
  const narrow = W.restore(JSON.parse(JSON.stringify({ ...ws, left: { ...ws.left, width: 248, rail: false } })));
  assert.equal(narrow.left.width, 292, 'a stored 248 (the old default rail) moves to the 292 rail');
});
