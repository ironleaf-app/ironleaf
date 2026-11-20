// node --test tests/note-types.test.mjs — note types (src/shared/note-types.ts; Ironleaf Calm, 20 Oct 2026): the
// built-in types in their order, which type a note is (its `type:` first, then its home folder, else a Note; projects only
// by `type: project`, docs only directly in Docs, templates no type at all), an unknown `type:` kept as written and shown
// as a Note, counts from the notes in memory, the types file read however it was left and written back with only what
// changed, the person's own types, a new note's words, and the assistant's lines. Made-up bakery notes.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-types-'));
let T, F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as T from ${JSON.stringify(path.join(root, 'src/shared/note-types.ts'))};\nexport * as F from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'types.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ T, F } = await import(pathToFileURL(path.join(work, 'types.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const ctx = { topFolders: ['02 Projects', 'Docs', 'People', 'Meetings', 'Daily', 'Templates'], templatesFolder: 'Templates', docsFolder: 'Docs' };
// The modules' record types (Wave 5: a Bill, an ID document…) are built-ins hidden while their module is off; these tests
// are about the note types themselves (tests/record-modules.test.mjs covers the modules').
const types = (config = T.emptyConfig(), c = ctx) => T.resolveTypes(config, c).filter((t) => !t.module);
const of = (p, props, list = types()) => T.typeOfNote({ path: p, props }, list, 'Templates');

test('the built-in types, in their set order, with this vault’s own folders', () => {
  const all = T.resolveTypes(T.emptyConfig(), ctx);
  assert.ok(all.filter((t) => t.module).every((t) => t.hidden), 'a module’s types are hidden while it is off');
  const list = types();
  assert.deepEqual(list.map((t) => t.id), ['note', 'project', 'doc', 'person', 'meeting', 'resource', 'idea']);
  assert.deepEqual(list.map((t) => t.plural), ['Notes', 'Projects', 'Docs', 'People', 'Meetings', 'Resources', 'Ideas']);
  const folder = (id) => list.find((t) => t.id === id).folder;
  // The vault's numbered projects folder, and its Docs folder, are the ones used; others by their usual names.
  assert.equal(folder('project'), '02 Projects');
  assert.equal(folder('doc'), 'Docs');
  assert.equal(folder('person'), 'People');
  assert.equal(folder('resource'), 'Resources');
  assert.equal(folder('note'), '');
  // A folder numbered the way people number their areas is found too.
  assert.equal(types(T.emptyConfig(), { topFolders: ['03 People', '04 Ideas'] }).find((t) => t.id === 'idea').folder, '04 Ideas');
  // Each type's icon is drawn in Icon.tsx.
  const icons = readFileSync(path.join(root, 'src/renderer/src/components/Icon.tsx'), 'utf8');
  for (const name of T.TYPE_ICONS) assert.match(icons, new RegExp(`^  ${name}: '`, 'm'), `icon ${name} not drawn`);
});

test('a note’s type: its type property first, then its home folder, else a Note', () => {
  assert.equal(of('Somewhere/Sam Rivera.md', { type: 'person' }), 'person');
  assert.equal(of('Somewhere/Sam Rivera.md', { type: 'Person' }), 'person');
  // Other words for a type, and its plural, name it too.
  assert.equal(of('Sam.md', { type: 'contact' }), 'person');
  assert.equal(of('Ideas.md', { type: 'ideas' }), 'idea');
  // By folder, however deep.
  assert.equal(of('People/Sam Rivera.md', {}), 'person');
  assert.equal(of('Meetings/2026/Oct/Ovens catch-up.md', {}), 'meeting');
  assert.equal(of('meetings/Weekly.md', {}), 'meeting');
  assert.equal(of('Daily/2026-10-20.md', {}), 'note');
  assert.equal(of('Loose thought.md', {}), 'note');
  // The type property wins over the folder.
  assert.equal(of('People/Rhino Ovens order.md', { type: 'meeting' }), 'meeting');
});

test('projects and docs keep their meaning: a project only by type, a doc only directly in Docs', () => {
  assert.equal(of('02 Projects/Harbour Cafe/Harbour Cafe.md', { type: 'project', status: 'active' }), 'project');
  // A project's own notes are notes, not projects.
  assert.equal(of('02 Projects/Harbour Cafe/Supplier call.md', {}), 'note');
  assert.equal(of('Docs/Oven servicing.md', {}), 'doc');
  assert.equal(of('Elsewhere/Server.md', { type: 'doc' }), 'doc');
  // Files kept in a doc's own folder are not docs (as doc-file.ts's isDocNote has it).
  assert.equal(of('Docs/Oven servicing/Wiring.md', {}), 'note');
});

test('an unknown type property is kept as written and shows as a Note; templates are no type', () => {
  assert.equal(of('People/Decision on flour.md', { type: 'decision' }), 'note');
  assert.equal(of('Status update.md', { type: 'status-update' }), 'note');
  assert.equal(of('Templates/Projects/Fit-out.md', { type: 'project-template' }), null);
  assert.equal(of('Templates/Notes/Meeting.md', {}), null);
});

test('counts per type from the notes in memory', () => {
  const notes = [
    { path: 'People/Sam.md', props: {} },
    { path: 'People/Mia.md', props: { type: 'person' } },
    { path: 'Anywhere/Lee.md', props: { type: 'person' } },
    { path: 'Meetings/Weekly.md', props: {} },
    { path: '02 Projects/Harbour/Harbour.md', props: { type: 'project' } },
    { path: 'Docs/Oven.md', props: {} },
    { path: 'Loose.md', props: { type: 'recipe' } },
    { path: 'Templates/Notes/Meeting.md', props: {} },
  ];
  const c = T.countTypes(notes, types(), 'Templates');
  assert.equal(c.get('person'), 3);
  assert.equal(c.get('meeting'), 1);
  assert.equal(c.get('project'), 1);
  assert.equal(c.get('doc'), 1);
  assert.equal(c.get('note'), 1);
  assert.equal(c.get('idea'), 0);
  assert.deepEqual(T.notesOfType(notes, 'person', types(), 'Templates').map((n) => n.path), ['People/Sam.md', 'People/Mia.md', 'Anywhere/Lee.md']);
  // Thousands of notes stay quick.
  const many = Array.from({ length: 20000 }, (_, i) => ({ path: `${['People', 'Meetings', 'Notes', 'Ideas'][i % 4]}/N${i}.md`, props: i % 3 ? {} : { type: 'idea' } }));
  const t0 = performance.now();
  T.countTypes(many, types(), 'Templates');
  assert.ok(performance.now() - t0 < 200);
});

test('the types file: read however it was left, written with only what changed, in order', () => {
  assert.deepEqual(T.readTypes('').config.entries, []);
  const broken = T.readTypes('{ not json');
  assert.match(broken.problem, /couldn’t be read/);
  assert.deepEqual(broken.config.entries, []);
  const { config } = T.readTypes(JSON.stringify({ version: 1, types: [{ id: 'person', name: 'Contact', plural: 'Contacts', folder: '../Outside' }, { id: 'idea', hidden: true }, { id: 'Bad id!' }, { id: 'recipe', name: 'Recipe', icon: 'nope', color: 'teal', fields: [{ key: 'serves', kind: 'number' }, { key: 'type', kind: 'text' }] }] }));
  assert.deepEqual(config.entries.map((e) => e.id), ['person', 'idea', 'recipe']);
  assert.equal(config.entries[0].folder, undefined, 'a folder climbing out of the notes is left out');
  const list = types(config);
  const person = list.find((t) => t.id === 'person');
  assert.equal(person.name, 'Contact');
  assert.equal(person.plural, 'Contacts');
  assert.ok(person.aliases.includes('contacts') && person.aliases.includes('person'));
  assert.equal(list.find((t) => t.id === 'idea').hidden, true);
  const recipe = list.find((t) => t.id === 'recipe');
  assert.equal(recipe.icon, 'tag');
  assert.equal(recipe.color, 'teal');
  assert.deepEqual(recipe.fields.map((f) => f.key), ['serves']);
  assert.equal(recipe.folder, 'Recipes');
  // Note stays first; built-ins the file leaves out come in their own place.
  assert.equal(list[0].id, 'note');
  assert.deepEqual(list.map((t) => t.id).sort(), ['doc', 'idea', 'meeting', 'note', 'person', 'project', 'recipe', 'resource']);
  // Written back: every type in order, a built-in with only what differs.
  const renamed = T.renameType(T.emptyConfig(), ctx, 'person', 'Contact', 'Contacts');
  const text = T.writeTypes(renamed);
  const back = JSON.parse(text);
  assert.equal(back.types.length, 7);
  assert.deepEqual(back.types.find((t) => t.id === 'person'), { id: 'person', name: 'Contact', plural: 'Contacts' });
  assert.deepEqual(back.types.find((t) => t.id === 'meeting'), { id: 'meeting' });
  // The name given back: nothing is kept for it.
  const again = T.renameType(renamed, ctx, 'person', 'Person', 'People');
  assert.deepEqual(again.entries.find((e) => e.id === 'person'), { id: 'person' });
});

test('hide, reorder, the person’s own types, and a page’s display remembered', () => {
  let c = T.hideType(T.emptyConfig(), ctx, 'resource', true);
  assert.equal(types(c).find((t) => t.id === 'resource').hidden, true);
  assert.equal(T.hideType(c, ctx, 'note', true), c, 'Note can’t hide');
  c = T.moveType(c, ctx, 'idea', -1);
  assert.deepEqual(types(c).map((t) => t.id), ['note', 'project', 'doc', 'person', 'meeting', 'idea', 'resource']);
  assert.deepEqual(types(T.moveType(c, ctx, 'project', -1)).map((t) => t.id)[0], 'note', 'nothing goes above Note');
  const made = T.addCustomType(c, ctx, { name: 'Client site', icon: 'home', color: 'rose', fields: [{ key: 'address', kind: 'text' }, { key: 'stage', kind: 'choice', options: ['Lead', 'Quoted', 'Won'] }, { key: 'visit', kind: 'date' }] });
  assert.equal(made.id, 'client-site');
  const site = types(made.config).find((t) => t.id === 'client-site');
  assert.equal(site.plural, 'Client sites');
  assert.equal(site.folder, 'Client sites');
  assert.equal(site.view.groupBy, 'stage');
  assert.equal(site.view.dateProp, 'visit');
  assert.throws(() => T.addCustomType(made.config, ctx, { name: 'client site' }), /already a type/);
  assert.throws(() => T.addCustomType(made.config, ctx, { name: 'People' }), /already a type/);
  assert.throws(() => T.addCustomType(made.config, ctx, { name: '  ' }), /needs a name/);
  const edited = T.editCustomType(made.config, ctx, 'client-site', { name: 'Site', plural: 'Sites', folder: 'Clients/Sites' });
  assert.equal(types(edited).find((t) => t.id === 'client-site').folder, 'Clients/Sites');
  assert.throws(() => T.editCustomType(edited, ctx, 'person', { name: 'X' }), /built-in/);
  assert.throws(() => T.deleteCustomType(edited, ctx, 'meeting'), /hidden, not deleted/);
  const gone = T.deleteCustomType(edited, ctx, 'client-site');
  assert.equal(types(gone).some((t) => t.id === 'client-site'), false);
  // A page's display, kept per type and given back as a view.
  const person = types(gone).find((t) => t.id === 'person');
  const def = { ...T.typeView(person), layout: 'board', groupBy: 'organisation' };
  const shown = T.setTypeDisplay(gone, ctx, 'person', def);
  const view = T.typeView(types(shown).find((t) => t.id === 'person'));
  assert.equal(view.layout, 'board');
  assert.equal(view.groupBy, 'organisation');
  assert.deepEqual(view.source, { kind: 'all' });
  assert.equal(JSON.parse(T.writeTypes(shown)).types.find((t) => t.id === 'person').display.source, undefined);
  assert.equal(T.typeView(types(T.setTypeDisplay(shown, ctx, 'person', null)).find((t) => t.id === 'person')).layout, 'table');
});

test('a type’s home folder for a folder, deepest first', () => {
  const list = types();
  assert.equal(T.typeForFolder('People', list).id, 'person');
  assert.equal(T.typeForFolder('People/Suppliers', list).id, 'person');
  assert.equal(T.typeForFolder('Docs', list).id, 'doc');
  assert.equal(T.typeForFolder('Docs/Oven', list), undefined);
  assert.equal(T.typeForFolder('02 Projects/Harbour', list), undefined);
  assert.equal(T.typeForFolder('', list), undefined);
});

test('a new note’s words: its type, its fields ready to fill, values given, and its first words', () => {
  const list = types();
  const now = new Date(2026, 9, 20, 9, 30);
  const meeting = T.newTypedNoteText(list.find((t) => t.id === 'meeting'), { title: 'Ovens catch-up', now });
  const props = F.readProps(meeting);
  assert.equal(props.type, 'meeting');
  assert.equal(String(props.date), '2026-10-20');
  assert.deepEqual(props.people, []);
  assert.ok('time' in props && props.time === null);
  assert.match(meeting, /## Agenda/);
  const idea = T.newTypedNoteText(list.find((t) => t.id === 'idea'), { title: 'Rye loaf', values: { status: 'Exploring' } });
  assert.equal(F.readProps(idea).status, 'Exploring');
  const person = T.newTypedNoteText(list.find((t) => t.id === 'person'), { title: 'Sam', values: { organisation: 'Rhino Ovens', type: 'nope' } });
  assert.equal(F.readProps(person).organisation, 'Rhino Ovens');
  assert.equal(F.readProps(person).type, 'person');
  // A plain note stays plain: no properties at all.
  assert.equal(T.newTypedNoteText(list[0], { title: 'Untitled' }), '');
});

test('the assistant’s lines name each type’s type, folder and fields', () => {
  const words = T.typesForAssistant(types(T.hideType(T.emptyConfig(), ctx, 'idea', true)));
  assert.match(words, /^Person \(type: person\) in People\/; fields: role, organisation, email, phone$/m);
  assert.match(words, /Meeting \(type: meeting\) in Meetings\/; fields: date, time, people \(a list\), project \(a \[\[link\]\]\)/);
  assert.doesNotMatch(words, /Idea|type: note|type: project|type: doc/);
});

test('one broken properties line leaves the rest readable: the note keeps its type and tags', () => {
  const broken = '---\ntype: person\ntags: [friend]\ncontact: [unclosed\n---\n# Sam\n';
  assert.equal(F.propsReadable(broken), false, 'still shown as text to fix');
  assert.deepEqual(F.readProps(broken), { type: 'person', tags: ['friend'] }, 'the good lines still read');
});

test('a field that links says what it links to: a meeting’s people are people (b1links)', () => {
  const list = types();
  assert.equal(T.linkTargetType(list, 'meeting', 'people'), 'person');
  assert.equal(T.linkTargetType(list, 'meeting', 'People'), 'person', 'whatever case the note wrote it in');
  assert.equal(T.linkTargetType(list, 'meeting', 'project'), 'project');
  assert.equal(T.linkTargetType(list, 'meeting', 'date'), undefined, 'not a link field, nothing said');
  assert.equal(T.linkTargetType(list, 'person', 'people'), undefined, 'another type’s fields are its own');
  assert.equal(T.linkTargetType(list, null, 'people'), undefined);
  assert.equal(T.linkTargetType(list, 'meeting', 'nothing'), undefined);
});
