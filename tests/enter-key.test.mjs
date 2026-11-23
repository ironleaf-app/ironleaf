// SPDX-License-Identifier: AGPL-3.0-or-later
// node --test tests/enter-key.test.mjs — Enter acts only when no characters are being composed (src/renderer/src/lib/enterKey.ts).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-enter-'));
let K;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src', 'renderer', 'src', 'lib', 'enterKey.ts'), platform: 'node', output: { file: path.join(work, 'k.mjs'), format: 'esm' }, logLevel: 'silent' });
  K = await import(pathToFileURL(path.join(work, 'k.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a plain Enter counts, from React or the DOM', () => {
  assert.equal(K.isEnterKey({ key: 'Enter', nativeEvent: { isComposing: false } }), true);
  assert.equal(K.isEnterKey({ key: 'Enter', isComposing: false, keyCode: 13 }), true);
});

test('Enter while composing Chinese, Japanese or Korean does not', () => {
  assert.equal(K.isEnterKey({ key: 'Enter', nativeEvent: { isComposing: true } }), false);
  assert.equal(K.isEnterKey({ key: 'Enter', isComposing: true }), false);
  assert.equal(K.isEnterKey({ key: 'Enter', keyCode: 229 }), false);
});

test('other keys do not', () => {
  assert.equal(K.isEnterKey({ key: 'a' }), false);
  assert.equal(K.isEnterKey({ key: 'Escape', nativeEvent: { isComposing: false } }), false);
});
