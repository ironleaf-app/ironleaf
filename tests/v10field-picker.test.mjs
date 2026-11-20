// node --test tests/v10field-picker.test.mjs — the live field editor filters by kind (10.0 Endless Tech, v10records2,
// plan item 17 screens 3): the fields a person uses on a note (and on a record that owns a note) link through the
// kind-filtered picker ("Only people shown", every note one press away) and name a wrong-kind link under the field,
// named, never blocked. Made-up people and meetings.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-v10picker-'));
let R, T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const make = async (name, file) => {
    await build({ input: path.join(root, file), platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  R = await make('rellinks', 'src/shared/relation-links.ts');
  T = await make('notetypes', 'src/shared/note-types.ts');
});
after(() => rmSync(work, { recursive: true, force: true }));

const types = () => T.resolveTypes(T.emptyConfig(), { topFolders: ['People', 'Meetings'], templatesFolder: 'Templates' });
const notes = [
  { path: 'People/Ava Chen.md', title: 'Ava Chen' },
  { path: 'People/Sam Lee.md', title: 'Sam Lee' },
  { path: 'Meetings/Supplier call.md', title: 'Supplier call' },
];
const typeOf = (p) => (p.startsWith('People/') ? 'person' : p.startsWith('Meetings/') ? 'meeting' : null);
const nameOf = (id) => ({ person: 'Person', meeting: 'Meeting' })[id] ?? id;

test('the live door is the fields on the note; the old panel renders nowhere', () => {
  const noteView = src('src/renderer/src/views/NoteView.tsx');
  assert.ok(noteView.includes('NoteFields'), 'the note shows its fields');
  const hits = [];
  for (const file of ['src/renderer/src/App.tsx', 'src/renderer/src/views/NoteView.tsx', 'src/renderer/src/views/modules/RecordModulePage.tsx']) {
    if (src(file).includes('<Properties')) hits.push(file);
  }
  assert.deepEqual(hits, [], 'no live room renders <Properties>');
});

test('the live fields link through the kind-filtered picker, every note one press away', () => {
  const fields = src('src/renderer/src/components/NoteFields.tsx');
  assert.ok(fields.includes('linkTargetType'), 'the field names the kind it wants');
  assert.ok(fields.includes('pickerPool'), 'the pool holds only that kind');
  assert.ok(fields.includes('onlyKindShown'), 'says what it shows');
  assert.ok(fields.includes('Show every note'), 'every note one press away');
  assert.ok(fields.includes('pickRefusal'), 'a wrong-kind pick named, never blocked');
  assert.ok(fields.includes('field-link-pick'), 'a quiet Link beside the value');
  assert.ok(!/DeepSeek|\bDSH\b|pi-ai/i.test(fields), 'no engine names');
});

test('a wrong-kind link is named under the field through the one seam', () => {
  const fields = src('src/renderer/src/components/NoteFields.tsx');
  assert.ok(fields.includes('mismatchWords'), 'the one mismatch seam');
  assert.ok(fields.includes('field-note'), 'named under the field');
  assert.ok(!fields.includes('mismatchedLinks'), 'no own mismatch loop beside the seam');
});

test('the picker words are plain Australian English', () => {
  const ts = types();
  assert.equal(T.linkTargetType(ts, 'meeting', 'people'), 'person');
  const pool = R.pickerPool(notes, typeOf, 'person');
  assert.deepEqual(pool.map((n) => n.title), ['Ava Chen', 'Sam Lee']);
  assert.equal(R.onlyKindShown('People'), 'Only people shown');
  assert.equal(R.pickRefusal(notes[2], typeOf, 'person', nameOf), '“Supplier call” is a meeting, not a person.');
  assert.equal(R.pickRefusal(notes[0], typeOf, 'person', nameOf), null, 'the right kind, nothing said');
  const words = R.mismatchWords(['[[Supplier call]]'], 'person', notes, typeOf, nameOf);
  assert.equal(words, '“Supplier call” is a meeting, not a person.');
  assert.equal(R.mismatchWords(['[[Ava Chen]]'], 'person', notes, typeOf, nameOf), null, 'all agrees, nothing said');
  for (const w of [R.onlyKindShown('People'), words]) {
    assert.ok(w && !/[—–]/.test(w), 'no em dashes in product words');
    assert.ok(!/\bDSH\b|DeepSeek|pi-ai/i.test(w), 'no engine names in product words');
  }
  const ui = src('src/renderer/src/components/NoteFields.tsx');
  for (const phrase of ['Link to which note?', 'Show every note', 'Link a note']) {
    assert.ok(ui.includes(phrase), `says "${phrase}"`);
    assert.ok(!/[—–]/.test(phrase));
  }
});
