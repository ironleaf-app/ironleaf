// node --test tests/module-writes.test.mjs — undo for module records (25 Oct 2026, plan Phase 2 item 2.3;
// src/main/module-writes.ts): while the former host app runs a module tool, each note's text before its first write in
// that call is kept and listed with the answer, so the former host app's Rewind and the reply's card can put it back. A
// note that existed but whose text is not known is never listed as new (putting it "back" would remove it).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-module-writes-'));
const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
await build({ input: path.join(root, 'src', 'main', 'module-writes.ts'), platform: 'node', external: [/^node:/], output: { file: path.join(work, 'mw.mjs'), format: 'esm' }, logLevel: 'silent' });
const { noteBefore, recordingWrites } = await import(pathToFileURL(path.join(work, 'mw.mjs')).href);

test('a call lists each note it changed with its text before, first write only', async () => {
  const notes = new Map([['Me/Finance/Bills/Internet.md', 'amount: 85\n']]);
  const writeNote = async (rel, text) => { noteBefore(rel, notes.has(rel), notes.get(rel)); await new Promise((r) => setTimeout(r, 1)); notes.set(rel, text); };
  const { out, changed } = await recordingWrites(async () => {
    await writeNote('Me/Finance/Bills/Internet.md', 'amount: 95\n');
    await writeNote('Me/Finance/Bills/Internet.md', 'amount: 95\npaid: 2026-10-25\n');
    await writeNote('Me/Finance/Bills/Water.md', 'amount: 140\n');
    return { text: 'Marked paid.' };
  });
  assert.deepEqual(out, { text: 'Marked paid.' });
  assert.deepEqual(changed, [{ path: 'Me/Finance/Bills/Internet.md', before: 'amount: 85\n' }, { path: 'Me/Finance/Bills/Water.md', before: null }]);
});

test('outside a call nothing is kept; a note that existed with unknown text is left out', async () => {
  noteBefore('Me/Notes/x.md', true, 'text');
  const { changed } = await recordingWrites(async () => { noteBefore('Home/Appliances/Fridge.md', true, undefined); noteBefore('Home/New.md', false, undefined); });
  assert.deepEqual(changed, [{ path: 'Home/New.md', before: null }]);
});

test('two calls at once keep their own lists', async () => {
  const one = recordingWrites(async () => { await new Promise((r) => setTimeout(r, 5)); noteBefore('A.md', true, 'a'); });
  const two = recordingWrites(async () => { noteBefore('B.md', true, 'b'); await new Promise((r) => setTimeout(r, 10)); });
  assert.deepEqual([(await one).changed, (await two).changed], [[{ path: 'A.md', before: 'a' }], [{ path: 'B.md', before: 'b' }]]);
});

test('the app reports before each write and lists them for the host app', () => {
  const app = readFileSync(path.join(root, 'src', 'main', 'app.ts'), 'utf8');
  assert.match(app, /const isNew = !\(await v\.any\(rel\)\);\n\s*\/\/[^\n]*\n\s*noteBefore\(rel, !isNew, isNew \? undefined : index\.content\(rel\)\);/);
  assert.match(app, /const \{ out, changed \} = await recordingWrites\(\(\) => writer\.run\([^\n]*lifeModules\.call\([^\n]*\n\s*const said = switched \? \{ \.\.\.out, text: switched \+ out\.text \} : out;\n\s*return changed\.length \? \{ \.\.\.said, changed \} : said;/);
  rmSync(work, { recursive: true, force: true });
});
