// node --test tests/settings-tab-survives-import.test.mjs — on the first Windows build (20 Nov 2026),
// importing notes broke settings and kept closing the window. Reproduced on Plover under xvfb with a copy
// of a real Obsidian vault: Settings › General › Where your notes are kept › Details › Your vaults › Import… › A folder
// › Import. A few seconds in, as the first imported files were announced, the Settings page turned into an empty tab
// and the Import dialog inside it vanished mid-merge. Every "files changed" made the window drop tabs whose `path` was
// not a file it knew (W.removed), and Settings keeps its section ("general") in `path`. Only tabs that show a file go
// with their file now (src/renderer/src/state/workspace.ts).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-settings-tab-'));
let W;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/state/workspace.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'workspace.mjs'), format: 'esm' }, logLevel: 'silent' });
  W = await import(pathToFileURL(path.join(work, 'workspace.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const tabs = (ws) => W.groups(ws.root).flatMap((g) => g.tabs);
const known = new Set(['Home.md', '00 Inbox/Note 1.md', 'Board.canvas']);

test('the Settings page stays open when files arrive (an import, a sync)', () => {
  for (const section of ['general', 'backups', 'ai', 'keys']) {
    let ws = W.open(W.defaultWorkspace(), { type: 'settings', path: section }, 'tab');
    const before = tabs(ws).find((t) => t.type === 'settings');
    assert.ok(before, 'Settings is open');
    ws = W.removed(ws, (p) => known.has(p));
    const after = tabs(ws).find((t) => t.id === before.id);
    assert.equal(after.type, 'settings', `Settings › ${section} is still Settings`);
    assert.equal(after.path, section, 'on the same section');
  }
});

test('pages that keep their own meaning in path stay; tabs showing a gone file still go', () => {
  let ws = W.defaultWorkspace();
  ws = W.open(ws, { type: 'shared-space', path: 'Shared/Family' }, 'tab');
  ws = W.open(ws, { type: 'import' }, 'tab');
  ws = W.open(ws, { type: 'note', path: 'Gone.md' }, 'tab');
  ws = W.open(ws, { type: 'note', path: 'Home.md' }, 'tab');
  ws = W.open(ws, { type: 'canvas', path: 'Gone board.canvas' }, 'tab');
  ws = W.removed(ws, (p) => known.has(p));
  const all = tabs(ws);
  assert.ok(all.some((t) => t.type === 'shared-space' && t.path === 'Shared/Family'), 'a shared space (a folder) stays');
  assert.ok(all.some((t) => t.type === 'import'), 'the Import page stays');
  assert.ok(all.some((t) => t.type === 'note' && t.path === 'Home.md'), 'a note still there stays');
  assert.ok(!all.some((t) => t.path === 'Gone.md'), 'a note gone empties its tab');
  assert.ok(!all.some((t) => t.path === 'Gone board.canvas'), 'a board gone empties its tab');
});
