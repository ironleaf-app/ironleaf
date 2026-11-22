// node --test tests/loose-tab-loop.test.mjs — a Markdown file from outside the vault opened in hundreds of tabs and
// brought them all back on every start (22 Nov 2026, a CLAUDE.md in a project folder). The loop: the file's
// tab, opening the file again by its path, made the main side hand it back to the window as a new item; the window
// looked for its tab as a note (a .md path reads as one), never found the loose tab, and opened another, whose own
// open did the same. Now a re-open from the window is only an open, a loose tab is found as a loose tab, and the
// tabs a loop already made fold to one when the workspace is read.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-loose-loop-'));
let W;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'workspace.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/state/workspace.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'workspace.mjs'), format: 'esm' }, logLevel: 'silent' });
  W = await import(pathToFileURL(path.join(work, 'workspace.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const FILE = 'C:\\Users\\sam\\OneDrive\\Projects\\Plans\\CLAUDE.md';
const tabsOf = (ws) => W.groups(ws.root).flatMap((g) => g.tabs);

test('a loose tab is found as a loose tab, so opening the file again brings it forward', () => {
  W.showTabs(true);
  let ws = W.defaultWorkspace();
  ws = W.open(ws, { type: 'loose', path: FILE }, 'current');
  assert.ok(W.revealExisting(ws, FILE, 'loose'), 'found as a loose tab');
  assert.equal(W.revealExisting(ws, FILE), null, 'a note of that path is a different thing');
  const source = readFileSync(path.join(root, 'src/renderer/src/state/actions.ts'), 'utf8');
  assert.match(source, /W\.revealExisting\(getWorkspace\(\), opened\.file\.path, 'loose'\)/, 'openLoose looks for the loose tab');
});

test('the hundreds of tabs a loop made fold to one when the workspace is read', () => {
  W.showTabs(true);
  let ws = W.defaultWorkspace();
  for (let i = 0; i < 300; i++) ws = W.open(ws, { type: 'loose', path: i % 2 ? FILE : FILE.toLowerCase() }, 'tab');
  ws = W.open(ws, { type: 'note', path: 'Plans.md' }, 'tab');
  assert.ok(tabsOf(ws).length > 300);
  const restored = W.restore(JSON.parse(JSON.stringify(ws)));
  const tabs = tabsOf(restored);
  assert.equal(tabs.filter((t) => t.type === 'loose').length, 1, 'one tab for the file');
  assert.ok(tabs.some((t) => t.path === 'Plans.md'), 'other tabs stay');
});

test('a re-open asked for by the window never comes back to it as a new item', () => {
  const ext = readFileSync(path.join(root, 'src/main/external.ts'), 'utf8');
  assert.match(ext, /h\.handle\('loose:open', \(abs: unknown\) => this\.openFile\(abs, 'window'\)\)/);
  assert.match(ext, /out\.push\(await this\.openFile\(f, 'window'\)\)/, 'File › Open returns what it opened, once');
  assert.match(ext, /if \(from === 'window'\) return r;/, 'the window’s own opens push nothing');
});
