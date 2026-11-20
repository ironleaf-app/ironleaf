// node --test tests/t207-name-fits.test.mjs — typed note and project names fit to leading words and say so
// (t207 pass 2, item 2: the renameConversation style wrapper for Vault). Static: every typed-name door fits
// through fitTypedName and says the one line; renames keep the whole name. The units live in paths.test.mjs
// (the fit) and project-edit.test.mjs (the project words). Each check fails without its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const LINE = 'That name was shortened to fit.';

test('every typed note name fits through the one helper and says the line', () => {
  const actions = read('src/renderer/src/state/actions.ts');
  assert.ok(actions.includes('fitTypedName(base)'), 'new notes fit the typed base');
  assert.ok(actions.includes(`toast('${LINE}')`), 'new notes say the line when shortened');
  const types = read('src/renderer/src/state/noteTypes.ts');
  assert.ok(types.includes('fitTypedName(opts.title'), 'typed titles fit before the file and the heading');
  assert.ok(types.includes(`toast('${LINE}')`), 'typed titles say the line when shortened');
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(commands.includes('fitTypedName(name)'), 'extracted selections fit the prompted name');
  assert.ok(commands.includes(LINE), 'the moved toast says the line when shortened');
  const form = read('src/renderer/src/views/saved/FormDialog.tsx');
  assert.ok(form.includes('fitTypedName(clean)'), 'form notes fit the typed name');
  assert.ok(form.includes(LINE), 'the added toast says the line when shortened');
});

test('project names fit to leading words at 120 and say the line', () => {
  const file = read('src/shared/project-file.ts');
  assert.ok(file.includes('fitTypedName(e.value, 120, false)'), 'the set-name edit fits the raw value as a bare title');
  assert.ok(file.includes(LINE), 'the rename words say the line when shortened');
  assert.ok(!/clean\(e\.value, field === 'name' \? 120/.test(file), 'no silent mid-word cut at 120 any more');
});

test('new projects fit the typed name and say the line (t212: the main side cut 120 mid-word, silently)', () => {
  const dialog = read('src/renderer/src/components/NewProjectDialog.tsx');
  assert.ok(dialog.includes('fitTypedName(name, 120, false)'), 'new projects fit the typed name to leading words at 120');
  assert.ok(dialog.includes(`toast('${LINE}')`), 'new projects say the line when shortened');
});

test('the default fit is what the main side keeps (t212: 179 fitted, 78 kept)', () => {
  const paths = read('src/shared/paths.ts');
  assert.ok(paths.includes('fitTypedName(raw: unknown, max = 80'), 'file-bound names fit 80, the file rule’s own cap');
});

test('renaming a note keeps the whole name (no cap to fit)', () => {
  const actions = read('src/renderer/src/state/actions.ts');
  const fn = actions.slice(actions.indexOf('export async function renamePath'), actions.indexOf('export async function askRename'));
  assert.ok(!/slice\(0|substring|\.max\b|max =/.test(fn), 'renamePath carries no length cut');
});
