// node --test tests/t7-properties-fold.test.mjs — t7 item 2 (8 Nov 2026): a note's properties
// fold into one quiet line ("12 properties") that opens in place. Open, they are editable right
// there, as today: the same rows, the same editors, the same safe writer. Fails first (every row
// always shows, pushing the words down a whole screen).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the fields fold to one quiet line and open to the same editable rows', () => {
  const src = read('src/renderer/src/components/NoteFields.tsx');
  // The fold: one line with the count, opening in place, remembered.
  assert.ok(src.includes('properties') && /aria-expanded/.test(src), 'one fold line with its count');
  assert.ok(src.includes('nv.noteFields.open') || src.includes('noteFields.open'), 'open or shut stays as left');
  // Open, the rows are today's: the same editors, the same writer, the same add.
  for (const keep of ['TextEditor', 'ListEditor', 'StatusPill', 'DatePill', 'OwnerChip', 'changeProps', 'Add a field', 'field-row']) {
    assert.ok(src.includes(keep), `open rows keep ${keep}`);
  }
  // Nothing a person wrote moves: the fold changes no writer.
  assert.ok(src.includes('setValue(doc, key'), 'values write through the same safe writer');
});

const { startHarness } = await import('./vault-controls-harness.mjs');

test('folded properties open in place and stay editable', { timeout: 420000 }, async () => {
  const H = await startHarness();
  try {
    const props = ['status: in progress', 'owner: Alex Chen', 'due: 2026-11-20', 'started: 2026-10-20',
      'area: Shop', 'priority: high', 'progress: 65', 'tags: [harbourline, launch]', 'reviewer: Priya Nair',
      'channel: saturday-trade', 'venue: Marina hall', 'cost: 1200'];
    writeFileSync(path.join(H.vaultDir, 'Notes-Fold.md'),
      `---\ntype: note\n${props.join('\n')}\n---\n\n# Fold Note\n\nWords below the fold.\n`);
    await H.services.rescanAll();
    const ev = H.browser.ev;
    const send = (m, p) => H.browser.send(m, p);
    for (let i = 0; i < 120; i++) { await sleep(500); try { if (await ev(`!!document.querySelector('.app')`)) break; } catch {} }
    await sleep(1500);
    const key = async (keyName, code, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers });
    };
    await key('o', 'KeyO', 2);
    await sleep(1200);
    await send('Input.insertText', { text: 'Notes-Fold' });
    await sleep(1500);
    await key('Enter', 'Enter', 0);
    await sleep(4000);
    assert.ok(await ev(`!!document.querySelector('.cm-editor')`), 'the note opens');
    // Folded: one quiet line, no rows.
    const folded = await ev(`document.querySelector('.note-fields-fold')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''`);
    assert.ok(folded.includes('12 properties'), `one line says what it holds (saw "${folded}")`);
    assert.equal(await ev(`document.querySelectorAll('.note-fields .field-row').length`), 0, 'no rows while folded');
    // Open in place: the rows, editable.
    await ev(`document.querySelector('.note-fields-fold')?.click()`);
    await sleep(1200);
    assert.equal(await ev(`document.querySelectorAll('.note-fields .field-row').length`), 12, 'twelve rows open in place');
    await ev(`(() => { const t = document.querySelector('[data-field="channel"] textarea'); if (t) { t.focus(); t.select(); } })()`);
    await sleep(400);
    await send('Input.insertText', { text: 'marina-hall' });
    await sleep(600);
    await key('Tab', 'Tab', 0);
    await sleep(3500);
    const onDisk = readFileSync(path.join(H.vaultDir, 'Notes-Fold.md'), 'utf8');
    assert.ok(onDisk.includes('channel: marina-hall'), 'the opened field edits, through to disk');
    // And folds away again.
    await ev(`document.querySelector('.note-fields-fold')?.click()`);
    await sleep(800);
    assert.equal(await ev(`document.querySelectorAll('.note-fields .field-row').length`), 0, 'folds away again');
  } finally {
    await H.close();
  }
});
