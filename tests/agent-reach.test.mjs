// node --test tests/agent-reach.test.mjs — 9.2 intelligence uplift: the tools Ironleaf serves to outside agents
// (src/shared/agent-reach.ts). Results give the facts; the reply's words are the agent's own, never scripted.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-reach-'));
let A;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as A from ${JSON.stringify(path.join(root, 'src/shared/agent-reach.ts'))};`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'reach.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ A } = await import(pathToFileURL(path.join(work, 'reach.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

test('reminders served out: the day and time it is set for, no scripted sentence', () => {
  const d = A.REACH_TOOLS.find((t) => t.tool === 'reminder_set' || t.name === 'reminder_set').description;
  assert.match(d, /Returns the day and time it is set for/);
  assert.doesNotMatch(d, /to tell them/);
});
