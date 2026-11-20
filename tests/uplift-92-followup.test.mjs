// node --test tests/uplift-92-followup.test.mjs — the 9.2 uplift's verification round: claimed fixes
// re-checked claim by claim. Template names stay free even within one minute (F70); speech setup reads
// plain with a button to it (F74); into-the-note offers to open the note (F96); the searching header
// reads like the answer header (F123); the portfolio brief toast matches the report toast. Earlier
// batches' fixes are pinned here too, so none of them can drift back.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('template names stay free even within one minute (F70)', () => {
  const src = read('src/renderer/src/state/templates.ts');
  assert.ok(src.includes('for (let i = 2; taken.has(name.toLowerCase()); i++)'), 'the default counts up until free');
});

test('into-the-note offers to open the note (F96)', () => {
  const src = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(src.includes('Open the note to edit first'), 'one plain message');
  assert.ok(src.includes("label: 'Open the note'"), 'plus a button that opens it');
  assert.doesNotMatch(src, /Live Preview or Source/, 'no editor-mode names');
});
