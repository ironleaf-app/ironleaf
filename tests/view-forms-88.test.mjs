// node --test tests/view-forms-88.test.mjs — view forms (src/shared/view-forms.ts; 8.8 database depth): a form
// made from a view's fields, one per database, opened from the view's ⋯ or a link inside the vault; each submission is
// a new record. Local only: no public web form. Made-up bakery notes.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-forms-'));
let V, F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as V from ${JSON.stringify(path.join(root, 'src/shared/views.ts'))};\nexport * as F from ${JSON.stringify(path.join(root, 'src/shared/view-forms.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'forms.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ V, F } = await import(pathToFileURL(path.join(work, 'forms.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const def = () => ({ ...V.defaultView({ kind: 'folder', value: 'Bakery' }), columns: ['status', 'hours', 'formula.Total', 'rollup.Howmany', 'file.modified'] });

test('a form asks for the view’s fields: its properties, not what is worked out or hidden', () => {
  assert.deepEqual(F.formKeys(def()), ['status', 'hours']);
  assert.deepEqual(F.formKeys({ ...def(), form: { hidden: ['hours'] } }), ['status']);
  const { def: back, problem } = V.readView(V.writeView({ ...def(), form: { title: 'New bake', note: 'One per bake.', hidden: ['hours'], required: ['status'] } }));
  assert.equal(problem, null);
  assert.deepEqual(back.form, { title: 'New bake', note: 'One per bake.', hidden: ['hours'], required: ['status'] });
  assert.ok(!('form' in JSON.parse(V.writeView(V.defaultView()))), 'no choices, nothing written');
});

test('a few short values become a choice; many or long ones stay typed', () => {
  assert.deepEqual(F.fieldOptions(['Planned', 'In progress', 'Done']), ['Planned', 'In progress', 'Done']);
  assert.equal(F.fieldOptions(Array.from({ length: 13 }, (_, i) => `Thing ${i}`)), undefined);
  assert.equal(F.fieldOptions(['A very long value that nobody would pick from a list twice over']), undefined);
});

test('each field is asked the right way: numbers, dates, yes or no, relations, choices, text', () => {
  assert.equal(F.fieldOptions(['6', '2', '1'], 'number'), undefined, 'hours stay a number box');
  assert.equal(F.fieldOptions(['2026-10-01', '2026-10-02'], 'date'), undefined, 'days stay a date picker');
  assert.deepEqual(F.fieldOptions(['Planned', 'Done'], 'text'), ['Planned', 'Done'], 'status stays a choice');
  assert.equal(F.fieldInput('number', false, true), 'number');
  assert.equal(F.fieldInput('date', false, true), 'date');
  assert.equal(F.fieldInput('datetime', false, true), 'date');
  assert.equal(F.fieldInput('checkbox', false, true), 'checkbox');
  assert.equal(F.fieldInput('text', true, true), 'relation');
  assert.equal(F.fieldInput('text', false, true), 'choice');
  assert.equal(F.fieldInput('text', false, false), 'text');
  assert.equal(F.fieldInput('tags', false, true), 'text', 'lists stay typed');
  const rel = [{ key: 'tasks', kind: 'list', required: true }];
  assert.deepEqual(F.formValues(rel, { tasks: ['[[Bake the pies]]', '[[Price the pies]]'] }), { tasks: ['[[Bake the pies]]', '[[Price the pies]]'] });
  assert.deepEqual(F.validateForm('Pie week', rel, { tasks: [] }), ['Say what Tasks is.']);
  assert.deepEqual(F.validateForm('Pie week', rel, { tasks: ['[[Bake the pies]]'] }), []);
});

test('answers become a record’s values, and what must be filled in is said', () => {
  const fields = [
    { key: 'status', kind: 'text', required: true },
    { key: 'hours', kind: 'number', required: false },
    { key: 'tags', kind: 'tags', required: false },
    { key: 'paid', kind: 'checkbox', required: false },
  ];
  const values = F.formValues(fields, { status: 'Planned', hours: '6', tags: 'bakery, market', paid: true });
  assert.deepEqual(values, { status: 'Planned', hours: 6, tags: ['bakery', 'market'], paid: true });
  assert.deepEqual(F.formValues(fields, { status: '', hours: '', tags: '', paid: false }), { paid: false }, 'empties left out, a deliberate No kept');
  assert.deepEqual(F.validateForm('Sourdough', fields, { status: 'Planned' }), []);
  assert.deepEqual(F.validateForm('', fields, { status: 'Planned' }), ['Give it a name.']);
  assert.deepEqual(F.validateForm('Sourdough', fields, { status: '' }), ['Say what Status is.']);
});

test('each submission is a new record, and a link opens its view’s form', () => {
  const values = F.formValues([{ key: 'status', kind: 'text', required: false }], { status: 'Planned' });
  const text = V.newNoteText({ ...V.defaultView({ kind: 'tag', value: 'bakery' }) }, values);
  assert.match(text, /status: Planned/);
  assert.match(text, /bakery/, 'the view’s tag comes with it');
  assert.equal(F.formRefFor('Views/Bakes.view.json'), '[[Views/Bakes.view.json#form]]');
  assert.equal(F.splitFormLink('Views/Bakes.view.json#form'), 'Views/Bakes.view.json');
  assert.equal(F.splitFormLink('views/bakes.view.json#Form'), 'views/bakes.view.json');
  assert.equal(F.splitFormLink('Views/Bakes.view.json'), null);
  assert.equal(F.splitFormLink('Bakes#form'), 'Bakes');
});
