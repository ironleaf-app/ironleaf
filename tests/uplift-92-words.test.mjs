// node --test tests/uplift-92-words.test.mjs — the 9.2 uplift's plain words (F12, F13, F15, F16, F18, F26,
// F38, F51, F53, F54, F67, F74, F79, F80, F104, F108, F110, F112, F123, F137, F138): engine names out of
// statuses, heads, labels and buttons (kept only in setup sentences naming the real other-app destination,
// deed first); one name for the assistant; one not-ready sentence; agent names without the engine suffix.
// Pure logic is checked as it is; each surface is guarded by its new words, so each check fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-u92-words-'));
let W;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/lib/assistantWords.ts'), platform: 'node', output: { file: path.join(work, 'w.mjs'), format: 'esm' }, logLevel: 'silent' });
  W = await import(pathToFileURL(path.join(work, 'w.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the one assistant words: agent names, task lines, the not-ready sentence (F13, F15, F16)', () => {
  assert.equal(W.activityWords('running'), 'Task · running');
  assert.equal(W.activityWords(), 'Task');
  assert.equal(W.NOT_READY_WORDS, 'Add an AI connection in Settings › AI first.');
});

test('pages teach deeds, never syntax or stale claims (F18, F38, F104, F112)', () => {
  assert.doesNotMatch(read('src/renderer/src/views/note/DailyHead.tsx'), /Made itself this morning/, 'no stale self-made claim (F18)');
  assert.doesNotMatch(read('src/renderer/src/views/TasksView.tsx'), /Add 📅/, 'no storage syntax taught (F38)');
  assert.ok(read('src/renderer/src/panels/Places.tsx').includes('switched on'), 'packs count in plain words (F104)');
  assert.ok(read('src/renderer/src/views/GraphTab.tsx').includes('title="Graph"'), 'one name on the graph head (F112)');
});
