// node --test tests/notebook-door.test.mjs — the notebook's project door, explained (src/shared/notebook.ts,
// 10.0 papercuts): one line in plain words naming the project and where its notebook went.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-nb-door-'));
let B;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/notebook.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'b.mjs'), format: 'esm' }, logLevel: 'silent' });
  B = await import(pathToFileURL(path.join(work, 'b.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the door names the project and where its notebook went', () => {
  const words = B.projectNotebookWords('Harbour fit-out');
  assert.ok(words.includes('Harbour fit-out'), words);
  assert.ok(words.includes('Ask and Studio'), words);
  assert.ok(!words.includes('  '), words);
  assert.ok(!/workspace section|ProjectWorkspace|notebook tab/i.test(words), words);
});

test('a project with no name still reads plainly', () => {
  assert.equal(B.projectNotebookWords('  '), 'This project keeps its notebook in its workspace: the sources, questions and Studio are in Ask and Studio below.');
});
