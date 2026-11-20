// node --test tests/save-errors.test.mjs — failures in the person's own words (Nov 2026, nv-save F4): a full disk
// or a locked file says the save didn't land (never a code), and engine detail with a path never reaches a toast.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let M, work;
before(async () => {
  work = mkdtempSync(path.join(tmpdir(), 'nv-saveerrors-'));
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export { errorMessage } from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/errors.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a full disk says the save didn’t land, never ENOSPC', () => {
  assert.equal(M.errorMessage(new Error('ENOSPC: no space left on device, write')), 'The disk is full, so that couldn’t be saved.');
});

test('a locked file says so, never EBUSY', () => {
  assert.equal(M.errorMessage(new Error('EBUSY: resource busy or locked, rename')), 'Another program has that file open, so it couldn’t be saved just now.');
});

test('a quota failure or an unknown system error never reaches the person as a code (t18)', () => {
  assert.equal(M.errorMessage(new Error('EDQUOT: quota exceeded, write')), 'The disk is full, so that couldn’t be saved.');
  assert.equal(M.errorMessage(new Error('Unknown system error -122: Unknown system error -122, write')), 'Something didn’t work just then.');
});

test('a path or a code never reaches the person', () => {
  assert.equal(M.errorMessage(new Error('Error invoking remote method \'nv:note-write\': Error: EACCES denied')), 'It didn’t have permission to do that.');
  assert.equal(M.errorMessage(new Error('ENOENT: no such file or directory, open \'C:\\vault\\n.md\'')), 'A file it needed is missing.');
  assert.equal(M.errorMessage(new Error('That note is too big to open as a note.')), 'That note is too big to open as a note.');
});

test('a script failure never reaches the person as written (p14-words)', () => {
  for (const said of [
    'Cannot read properties of undefined (reading \'title\')',
    'Cannot set properties of null (setting \'done\')',
    'Failed to execute \'insertBefore\' on \'Node\'',
    'window.nv.oops is not a function',
    'oops is not defined',
    'Error invoking remote method \'nv:tasks-tick\': TypeError: Cannot read properties of undefined (reading \'x\')',
  ]) assert.equal(M.errorMessage(new Error(said)), 'Something didn’t work just then.', said);
  assert.equal(M.errorMessage('That task isn’t in its note any more.'), 'That task isn’t in its note any more.');
});

test('the template fields toast cleans the assistant’s failure first (p14-words)', () => {
  const state = readFileSync(path.join(root, 'src/renderer/src/state/templateFields.ts'), 'utf8');
  assert.match(state, /errorMessage\(r\.error\)/, 'r.error goes through the plain-error words');
});
