// node --test tests/relation-seam-wiring.test.mjs — the relations seam's wiring (10.0 Endless Tech, b1links): the app
// shell and the window have no executing harness (Electron), so this holds their contracts by reading the source the
// way the shell tests do — every writer passes the seam, renames and trash keep links, the window toasts back-writes
// once with Undo, kinds show where links show, and the pickers offer the field's type first.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const app = read('src/main/app.ts');

test('every note write passes the seam, and the window’s writes hear what it did', () => {
  assert.match(app, /const before = index\.content\(rel\);\s+await indexFile\(v, rel\);[\s\S]*?return relationSyncForWrite\(v, rel, before, text, author\);/, 'noteWritten diffs before/after and syncs');
  assert.equal(app.match(/return withSyncResult\(r, s\);/g)?.length, 2, 'note:write and file:write-text answer what synced');
  for (const door of ['note:create', 'file:create', 'import:csv-notes', 'path:duplicate', 'noteFromTemplate', 'openDailyNote']) assert.ok(app.includes(door), `${door} still exists`);
  // Every create door the person uses syncs the new notes' links back; an import's doors do not (20 Nov 2026: an
  // import never rewrites what it brought in, nor other notes for it — tests/import-no-backwrites.test.mjs).
  assert.ok((app.match(/await relationSyncForCreates\(v, /g) ?? []).length >= 5, 'every create door the person uses syncs the new notes’ links back');
});

test('renames rewrite property links and trash takes them out, through the shared seam', () => {
  assert.ok(app.includes('relinkPropsInText(updated, (target) => {'), 'a move rewrites property links beside body links');
  assert.ok(app.includes('for (const pl of meta.propLinks ?? []) {'), 'a move plans from property links too');
  assert.ok(app.includes('planUnlinkForTrash('), 'trash plans the unlink while the index still knows the notes');
  // The guarded write keeps the true author (you or the assistant), threaded from the removal, not a fixed 'you'.
  assert.ok(app.includes('await writeNote(path, text, by)'), 'unlinks land through the guarded write');
  assert.ok(read('src/main/life.ts').includes('relinkPropsInText('), 'a people merge repoints property links too');
  assert.ok(!read('src/main/pairing/service.ts').includes('relationsSynced'), 'brought-in notes are not synced back (an import writes nothing else)');
  assert.ok(!read('src/main/vault-home-service.ts').includes('relationsSynced'), 'imported notes are not synced back');
});

test('views write through the seam and say what it did; no second sync of their own', () => {
  const views = read('src/renderer/src/state/savedViews.ts');
  assert.ok(!views.includes('planRelationSync'), 'no own back-write loop anymore');
  assert.ok(views.includes('syncWords('), 'the toast names what the seam did');
  assert.ok(views.includes('mismatchNote('), 'a wrong-typed link is named, never blocked');
  const docs = read('src/renderer/src/state/docs.ts');
  assert.ok(docs.includes('toastSync('), 'open-note saves toast their back-links with Undo');
  assert.ok(docs.includes('quietSync'), 'writers that toast themselves keep one toast, not two');
});

test('kinds show where links show, and pickers offer the field’s type first', () => {
  const fields = read('src/renderer/src/components/NoteFields.tsx');
  assert.ok(fields.includes('LINK_KINDS') && fields.includes('field-kind'), 'note fields name and change each link’s kind');
  const table = read('src/renderer/src/views/saved/Table.tsx');
  assert.ok(table.includes('sv-kind') && table.includes('linkTargetType'), 'cells name kinds and filter to the field’s type');
  const form = read('src/renderer/src/views/saved/FormDialog.tsx');
  assert.ok(form.includes('linkTargetType'), 'the form picker filters to the field’s type');
  assert.ok(table.includes('Show every note') && form.includes('Show every note'), 'a filtered picker never strands: every note one press away');
  // t27-unused-panels: the side's Linked mentions are gone with their per-line property and kind (the foot lists
  // the notes without them; t22 left whether the foot should show them as a decision for a person). Kinds still
  // show where links show everywhere else, pinned above.
  assert.ok(read('src/renderer/src/styles/note-page.css').includes('.field-kind'), 'field kinds are styled');
  assert.ok(read('src/renderer/src/styles/dbdepth-88.css').includes('.sv-kind'), 'cell kinds are styled');
});
