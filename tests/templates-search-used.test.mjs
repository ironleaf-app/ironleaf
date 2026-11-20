// node --test tests/templates-search-used.test.mjs — Templates text search and last-used order
// (src/shared/templates.ts, 10.0 papercuts): the words typed find a template by its name, description, use or
// outline, and lately used templates come first.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-tpl-search-'));
let T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/templates.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  T = await import(pathToFileURL(path.join(work, 't.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const tpl = (p, name, description, usedFor, text) => ({ path: p, name, group: 'notes', kind: 'note', description, usedFor, modified: 1, text });
const all = [
  tpl('a.md', 'Meeting notes', 'What was said and decided', 'Use it for a new note', '## Agenda\n## Actions\n'),
  tpl('b.md', 'Reading list', 'Books to read this year', 'Use it for a new note', '## To read\n'),
  tpl('c.md', 'Weekly status', 'What shipped this week', 'Type / Template inside a note', '## Shipped\n## Next\n'),
];

test('every word typed must be somewhere on the template', () => {
  assert.deepEqual(T.filterTemplates(all, '').map((t) => t.path), ['a.md', 'b.md', 'c.md']);
  assert.deepEqual(T.filterTemplates(all, 'meeting').map((t) => t.path), ['a.md']);
  assert.deepEqual(T.filterTemplates(all, 'MEETING').map((t) => t.path), ['a.md']);
  assert.deepEqual(T.filterTemplates(all, 'shipped week').map((t) => t.path), ['c.md']);
  assert.deepEqual(T.filterTemplates(all, 'shipped meeting').map((t) => t.path), []);
  assert.deepEqual(T.filterTemplates(all, 'agenda').map((t) => t.path), ['a.md']);
});

test('lately used templates come first, most recent first', () => {
  assert.deepEqual(T.sortTemplatesByUsed(all, {}).map((t) => t.path), ['a.md', 'b.md', 'c.md']);
  assert.deepEqual(T.sortTemplatesByUsed(all, { 'c.md': 5 }).map((t) => t.path), ['c.md', 'a.md', 'b.md']);
  assert.deepEqual(T.sortTemplatesByUsed(all, { 'c.md': 5, 'a.md': 9 }).map((t) => t.path), ['a.md', 'c.md', 'b.md']);
  const used = T.recordTemplateUsed({ 'c.md': 5 }, 'b.md', 9);
  assert.deepEqual(used, { 'c.md': 5, 'b.md': 9 });
  assert.deepEqual(T.sortTemplatesByUsed(all, used).map((t) => t.path), ['b.md', 'c.md', 'a.md']);
});
