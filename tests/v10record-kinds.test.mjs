// node --test tests/v10record-kinds.test.mjs — one kind of record, named links (10.0 Endless Tech, v10records):
// every note has a kind, every workspace record carries its kind, a link field names the kind it wants, and the
// picker offers only that kind first, saying so in plain words; anything else picked is named, never blocked or
// fixed. Made-up bakery notes and people.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-v10kinds-'));
let R, T, W;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const make = async (name, file) => {
    await build({ input: path.join(root, file), platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  R = await make('rellinks', 'src/shared/relation-links.ts');
  T = await make('notetypes', 'src/shared/note-types.ts');
  W = await make('wsrecords', 'src/shared/workspace-records.ts');
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

test('every note has a kind: its type, else its folder, else a note; templates are no kind', () => {
  const ts = types();
  assert.equal(T.typeOfNote({ path: 'People/Ava Chen.md', props: {} }, ts, 'Templates'), 'person', 'recognised by its folder');
  assert.equal(T.typeOfNote({ path: 'Notes/Random.md', props: { type: 'meeting' } }, ts, 'Templates'), 'meeting', 'its type: wins');
  assert.equal(T.typeOfNote({ path: 'Notes/Random.md', props: {} }, ts, 'Templates'), 'note', 'a plain note by default');
  assert.equal(T.typeOfNote({ path: 'Templates/Recipe.md', props: {} }, ts, 'Templates'), null, 'a template is no type');
});

test('a link field names the kind it wants', () => {
  const ts = types();
  assert.equal(T.linkTargetType(ts, 'meeting', 'people'), 'person', "a meeting's people are people");
  assert.equal(T.linkTargetType(ts, 'meeting', 'project'), 'project');
  assert.equal(T.linkTargetType(ts, 'meeting', 'date'), undefined, 'a date wants no kind');
  assert.equal(T.linkTargetType(ts, 'note', 'people'), undefined, 'a plain note declares no field');
  assert.equal(T.linkTargetType(ts, null, 'people'), undefined, 'no source kind, no want');
});

test('the picker pool holds only the kind the field wants, in order', () => {
  assert.deepEqual(
    R.pickerPool(notes, typeOf, 'person').map((n) => n.title),
    ['Ava Chen', 'Sam Lee'],
  );
  assert.deepEqual(R.pickerPool(notes, typeOf, 'meeting').map((n) => n.title), ['Supplier call']);
  assert.deepEqual(R.pickerPool(notes, typeOf, 'project'), [], 'none of that kind, none offered');
  const kinded = [
    { path: 'x.md', title: 'X', kind: 'person' },
    { path: 'y.md', title: 'Y', kind: null },
  ];
  assert.deepEqual(R.pickerPool(kinded, () => 'meeting', 'person').map((n) => n.title), ['X'], 'a carried kind wins over the judge');
});

test('the picker says what it shows, and names a wrong pick without blocking it', () => {
  assert.equal(R.onlyKindShown('People'), 'Only people shown');
  assert.equal(R.onlyKindShown('Meeting series'), 'Only meeting series shown');
  assert.equal(R.onlyKindShown(''), 'Only notes shown');
  assert.equal(R.pickRefusal(notes[0], typeOf, 'person', nameOf), null, 'the right kind, nothing said');
  assert.equal(R.pickRefusal(notes[2], typeOf, 'person', nameOf), '“Supplier call” is a meeting, not a person.');
  assert.equal(R.pickRefusal({ path: 'Draft.md', title: 'Draft' }, () => null, 'person', nameOf), null, 'no kind to judge by, nothing said');
  assert.equal(R.pickRefusal({ path: 'x.md', title: 'X', kind: 'meeting' }, () => 'person', 'person', nameOf), '“X” is a meeting, not a person.', 'a carried kind judges');
});

test('mismatches are named in plain Australian English, never silently fixed', () => {
  const words = R.mismatchWords(['[[Supplier call]]'], 'person', notes, typeOf, nameOf);
  assert.equal(words, '“Supplier call” is a meeting, not a person.');
  assert.equal(R.mismatchWords(['[[Ava Chen]]'], 'person', notes, typeOf, nameOf), null, 'all agrees, nothing said');
  assert.equal(R.mismatchWords(['[[Supplier call]]'], undefined, notes, typeOf, nameOf), null, 'the field wants no kind, nothing said');
  assert.equal(R.mismatchWords(['Nobody here'], 'person', notes, typeOf, nameOf), null, 'unknown is a dead link, not a mismatch');
  const two = R.mismatchWords(['[[Supplier call]]', '[[Ava Chen]]', '[[Nobody here]]'], 'person', notes, typeOf, nameOf);
  assert.equal(two, '“Supplier call” is a meeting, not a person.', 'only the mismatch is named');
  for (const w of [words, two, R.onlyKindShown('People')]) {
    assert.ok(!/—|–/.test(w), 'no em dashes in product words');
    assert.ok(!/DSH|DeepSeek|pi-ai/i.test(w), 'no engine names in product words');
  }
});

test('workspace records carry their kind and its words', () => {
  assert.ok(W.RECORD_KINDS.includes('action') && W.RECORD_KINDS.includes('person') && W.RECORD_KINDS.includes('bill'));
  assert.equal(W.KIND_WORDS.action.one, 'Action');
  assert.equal(W.KIND_WORDS.person.many, 'People');
});
