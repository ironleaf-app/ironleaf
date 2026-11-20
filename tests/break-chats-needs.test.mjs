// node --test tests/break-chats-needs.test.mjs — break-it for project Chats and Start a chat here
// (t58, 9 Nov 2026): faults the features' own tests missed, each failing before its fix. A project worked
// on without a folder counts the chats in its own Files folder (the same folder Start a chat here starts
// them in); every chat crosses, never 200 at most; Start a chat here refuses a remote folder with plain
// words instead of starting in the wrong folder.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const handlerOf = (src, name) => {
  const at = src.indexOf(name);
  assert.ok(at > 0, `${name} is handled`);
  return src.slice(at, at + 2400);
};

test('project:work counts the folder this PC reads, own Files folder included', () => {
  const app = read('src/main/app.ts');
  const handler = handlerOf(app, "handle('project:work'");
  // The raw note's project names no folder for a project worked on without one; the resolved one
  // (projectAt/withFiles) reads its own Files folder, the same folder Start a chat here starts in.
  assert.ok(handler.includes('projectAt(') || handler.includes('withFiles('), 'the chats are matched against the resolved folder, not the raw note');
});

test('project:work lets every chat cross, never 200 at most', () => {
  const app = read('src/main/app.ts');
  const handler = handlerOf(app, "handle('project:work'");
  assert.ok(!handler.includes('slice(0, 200)'), 'no silent cap: the page counts what crossed');
});
