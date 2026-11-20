// node --test tests/note-page.test.mjs — the note page (src/shared/note-page.ts): the cover and icon read from the front
// matter (a colour by name or a vault picture; an emoji or one of our line icons), the type id, which fields show as
// rows (empty ones hide; the type's own show as "Add <field>" only while the fields are in use), links written in a
// field, and a person's meetings and projects, a meeting's people.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-note-page-'));
let P;
let F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as P from ${JSON.stringify(path.join(root, 'src/shared/note-page.ts'))};\nexport * as F from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ P, F } = await import(pathToFileURL(path.join(work, 'p.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a cover is a calm colour by name or a picture by its vault path; anything else draws nothing', () => {
  assert.deepEqual(P.readCover('sage'), { kind: 'colour', colour: 'sage' });
  assert.deepEqual(P.readCover(' Sky '), { kind: 'colour', colour: 'sky' });
  assert.deepEqual(P.readCover('Pictures/Harbour at dusk.jpg'), { kind: 'picture', path: 'Pictures/Harbour at dusk.jpg' });
  assert.deepEqual(P.readCover('![[Pictures/beach.webp]]'), { kind: 'picture', path: 'Pictures/beach.webp' });
  assert.deepEqual(P.readCover('[[beach.PNG|The beach]]'), { kind: 'picture', path: 'beach.PNG' });
  assert.deepEqual(P.readCover('./covers\\road.jpeg'), { kind: 'picture', path: 'covers/road.jpeg' });
  assert.deepEqual(P.readCover('![](Pictures/My%20cover.png)'), { kind: 'picture', path: 'Pictures/My cover.png' });
  assert.equal(P.readCover('hot pink'), null);
  assert.equal(P.readCover('notes.md'), null);
  assert.equal(P.readCover(''), null);
  assert.equal(P.readCover(null), null);
  assert.equal(P.readCover(['sage']), null);
  assert.equal(P.readCover(42), null);
});

test('an icon is one of our line icons by name, else the first emoji; plain words draw nothing', () => {
  assert.deepEqual(P.readIcon('spark'), { kind: 'line', name: 'spark' });
  assert.deepEqual(P.readIcon('Calendar'), { kind: 'line', name: 'calendar' });
  assert.deepEqual(P.readIcon('🌱'), { kind: 'emoji', text: '🌱' });
  assert.deepEqual(P.readIcon(' 📚 books'), null, 'words before or after are not an icon');
  assert.deepEqual(P.readIcon('👩🏽‍💻'), { kind: 'emoji', text: '👩🏽‍💻' }, 'a joined emoji is one');
  assert.deepEqual(P.readIcon('🇦🇺'), { kind: 'emoji', text: '🇦🇺' }, 'a flag is one');
  assert.deepEqual(P.readIcon('🌱🌊'), { kind: 'emoji', text: '🌱' }, 'two emoji: the first');
  assert.equal(P.readIcon('rocketship'), null);
  assert.equal(P.readIcon('A'), null);
  assert.equal(P.readIcon(''), null);
  assert.equal(P.readIcon(7), null);
});

test('every line icon is one the app draws', async () => {
  const { readFileSync } = await import('node:fs');
  const icons = readFileSync(path.join(root, 'src/renderer/src/components/Icon.tsx'), 'utf8');
  for (const name of P.LINE_ICONS) assert.match(icons, new RegExp(`^  ${name}:`, 'm'), name);
  for (const t of P.PAGE_TYPES) assert.match(icons, new RegExp(`^  ${t.icon}:`, 'm'), t.icon);
});

test('the type id is read however it is written; an unknown type still shows by its own name', () => {
  assert.equal(P.readType({ type: 'Person' }), 'person');
  assert.equal(P.readType({ type: '[[Meeting]]' }), 'meeting');
  assert.equal(P.readType({ type: '  ' }), null);
  assert.equal(P.readType({ type: 3 }), null);
  assert.equal(P.readType({}), null);
  assert.equal(P.readType(undefined), null);
  assert.equal(P.pageType('person').name, 'Person');
  assert.deepEqual(P.pageType('recipe'), { id: 'recipe', name: 'Recipe', icon: 'tag', fields: [] });
  assert.equal(P.pageType(null), null);
});

test('empty means nothing in it', () => {
  for (const v of [null, undefined, '', '   ', [], ['', ' '], {}]) assert.equal(P.isEmptyValue(v), true, JSON.stringify(v));
  for (const v of [0, false, 'x', ['a'], { a: 1 }]) assert.equal(P.isEmptyValue(v), false, JSON.stringify(v));
});

const person = () => P.PAGE_TYPES.find((t) => t.id === 'person').fields;

test('fields with a value show in the note’s order; empty ones hide; the top’s keys are never rows', () => {
  const props = { type: 'person', icon: '🌱', role: 'Site lead', email: '', cover: 'sage', tags: [], phone: '0400 000 000', notes: null };
  const rows = P.fieldRows(props, person());
  assert.deepEqual(rows.map((r) => [r.key, r.show]), [['role', 'value'], ['phone', 'value']]);
  assert.equal(rows[0].hint, 'text');
});

test('while the fields are in use the type’s empty and missing fields show as "Add <field>", in the type’s order', () => {
  const props = { role: 'Site lead', email: '', tags: [] };
  const rows = P.fieldRows(props, person(), { active: true });
  assert.deepEqual(rows.map((r) => [r.key, r.show]), [['role', 'value'], ['email', 'add'], ['organisation', 'add'], ['phone', 'add']]);
  assert.ok(!rows.some((r) => r.key === 'tags'), 'an empty field the type doesn’t define stays hidden');
});

test('while editing every empty field shows with its editor, and the type’s missing ones are offered', () => {
  const props = { role: 'Site lead', email: '', tags: [] };
  const rows = P.fieldRows(props, person(), { editing: true });
  assert.deepEqual(rows.map((r) => [r.key, r.show]), [['role', 'value'], ['email', 'value'], ['tags', 'value'], ['organisation', 'add'], ['phone', 'add']]);
});

test('a type field matches whatever case the note wrote it in, and no type means no offers', () => {
  const rows = P.fieldRows({ Email: '' }, person(), { active: true });
  assert.deepEqual(rows.map((r) => [r.key, r.show, r.hint]), [['Email', 'add', 'text'], ['role', 'add', 'text'], ['organisation', 'add', 'text'], ['phone', 'add', 'text']]);
  assert.deepEqual(P.fieldRows({ a: '', b: 'x' }, [], { active: true }).map((r) => r.key), ['b']);
});

test('a field just added stays in sight while empty, without bringing back the other empty ones', () => {
  const props = { role: 'Site lead', email: '', mobile: '' };
  assert.deepEqual(P.fieldRows(props, person(), { keep: 'Mobile' }).map((r) => [r.key, r.show]), [['role', 'value'], ['mobile', 'value']]);
});

test('links in a field: one link as the whole value, or a value made only of links', () => {
  assert.deepEqual(P.linkOf('[[Sam Lee]]'), { target: 'Sam Lee' });
  assert.deepEqual(P.linkOf(' [[People/Sam Lee|Sam]] '), { target: 'People/Sam Lee', alias: 'Sam' });
  assert.deepEqual(P.linkOf('[[Harbour#Dates]]'), { target: 'Harbour' });
  assert.equal(P.linkOf('see [[Sam]]'), null);
  assert.equal(P.linkOf('Sam'), null);
  assert.deepEqual(P.linksOnly('[[Sam]], [[Priya|P]] and [[Lee]]'), [{ target: 'Sam' }, { target: 'Priya', alias: 'P' }, { target: 'Lee' }]);
  assert.equal(P.linksOnly('[[Sam]] to send it'), null);
  assert.equal(P.linksOnly('no links'), null);
  assert.equal(P.linksOnly(''), null);
});

test('a meeting’s people come from attendees (or people), names or links, once each', () => {
  assert.deepEqual(P.meetingPeople({ attendees: ['[[Sam Lee]]', 'Priya', '@Darcy', '[[People/Ana|Ana M]]', 'priya'] }), [
    { name: 'Sam Lee', target: 'Sam Lee' },
    { name: 'Priya', target: 'Priya' },
    { name: 'Darcy', target: 'Darcy' },
    { name: 'Ana M', target: 'People/Ana' },
  ]);
  assert.deepEqual(P.meetingPeople({ people: 'Sam, Priya' }).map((p) => p.name), ['Sam', 'Priya']);
  assert.deepEqual(P.meetingPeople({ attendees: '[[Sam]], [[Priya]]' }).map((p) => p.target), ['Sam', 'Priya']);
  assert.deepEqual(P.meetingPeople({}), []);
});

test('mentioned people come from the also field, so "Also mentioned" never repeats them (o3 item 5)', () => {
  assert.deepEqual(P.mentionedPeople({ also: '[[David Kim]]' }).map((p) => p.target), ['David Kim']);
  assert.deepEqual(P.mentionedPeople({ Mentioned: ['[[People/David Kim]]', 'Ana'] }).map((p) => p.name), ['David Kim', 'Ana']);
  assert.deepEqual(P.mentionedPeople({ people: '[[Sam]]' }), []);
  assert.deepEqual(P.mentionedPeople(undefined), []);
});

test('a person’s page lists the meetings they were in (newest first) and their projects', () => {
  const notes = [
    { path: 'People/Sam Lee.md', title: 'Sam Lee', aliases: ['Sam'], links: [], props: { type: 'person' } },
    { path: 'Meetings/2026-10-01 Kick-off.md', title: '2026-10-01 Kick-off', links: [{ target: 'Sam Lee' }], props: { date: '2026-10-01' } },
    { path: 'Notes/Supplier call.md', title: 'Supplier call', links: [], props: { type: 'meeting', date: '2026-10-14', attendees: ['Sam', 'Priya'] } },
    { path: 'Notes/Old chat.md', title: 'Old chat', links: [], props: { type: 'Meeting', attendees: ['[[Sam Lee]]'] }, mtime: 5 },
    { path: 'Projects/Harbour.md', title: 'Harbour Fit-out', links: [{ target: 'Sam Lee' }], props: { type: 'project' } },
    { path: 'Projects/Other.md', title: 'Other', links: [{ target: 'Priya' }], props: { type: 'project' } },
    { path: 'Notes/Idea.md', title: 'Idea', links: [{ target: 'Sam Lee' }], props: {} },
  ];
  const resolve = (target) => notes.find((n) => n.title.toLowerCase() === target.toLowerCase() || n.aliases?.some((a) => a.toLowerCase() === target.toLowerCase()))?.path ?? null;
  const { meetings, projects } = P.personPages('People/Sam Lee.md', notes, resolve);
  assert.deepEqual(meetings, [
    { path: 'Notes/Supplier call.md', title: 'Supplier call', date: '2026-10-14' },
    { path: 'Meetings/2026-10-01 Kick-off.md', title: '2026-10-01 Kick-off', date: '2026-10-01' },
    { path: 'Notes/Old chat.md', title: 'Old chat' },
  ]);
  assert.deepEqual(projects, [{ path: 'Projects/Harbour.md', title: 'Harbour Fit-out' }]);
});

test('setting and removing cover, icon and type keeps the rest of the front matter as the safe writer always has (order, comments, quoting)', () => {
  const note = '---\n# kept for the client\ntitle: "Harbour"   # quoted on purpose\ntags: [a, b]\nDue: 2026-10-31\n---\n\nWords.\n';
  const withCover = F.changeProps(note, (doc) => doc.set('cover', 'sage'));
  assert.equal(withCover, '---\n# kept for the client\ntitle: "Harbour" # quoted on purpose\ntags: [a, b]\nDue: 2026-10-31\ncover: sage\n---\n\nWords.\n');
  const back = F.changeProps(withCover, (doc) => doc.delete('cover'));
  assert.equal(back, '---\n# kept for the client\ntitle: "Harbour" # quoted on purpose\ntags: [a, b]\nDue: 2026-10-31\n---\n\nWords.\n');
  const typed = F.changeProps('Just words.\n', (doc) => doc.set('type', 'person'));
  assert.equal(typed, '---\ntype: person\n---\n\nJust words.\n');
  assert.equal(P.readIcon(F.readProps(F.changeProps(typed, (doc) => doc.set('icon', '🌱'))).icon).text, '🌱');
});

test('project facts read as designed facts: status, progress, date, owner (p14)', () => {
  assert.equal(P.factKind('status', 'active', 'text'), 'status');
  assert.equal(P.factKind('Health', 'at risk', 'text'), 'status');
  assert.equal(P.factKind('progress', 40, 'number'), 'progress');
  assert.equal(P.factKind('Progress', '40', 'text'), 'progress');
  assert.equal(P.factKind('due', '2026-11-20', 'date'), 'date');
  assert.equal(P.factKind('Due', '2026-11-20T15:00', 'datetime'), 'date');
  assert.equal(P.factKind('owner', 'Alex Chen', 'text'), 'owner');
  assert.equal(P.factKind('owner', '[[Alex Chen]]', 'text'), null, 'a linked owner already shows as its chip');
  assert.equal(P.factKind('notes', 'hello', 'text'), null);
  assert.equal(P.factKind('progress', 'lots', 'text'), null, 'not a number, not a bar');
  assert.equal(P.factKind('progress', 140, 'number'), null, 'past a hundred, not a bar');
});

test('the app’s speaker-names map is never a field row; a person’s own speakers shows (break-it 1)', () => {
  const rows = P.fieldRows({ 'neuralvault-speaker-names': { '': { spk1: 'Sam' } }, speakers: 'Jo and Sam', role: 'Site lead' }, person());
  assert.deepEqual(rows.map((r) => r.key), ['speakers', 'role']);
});

test('a link kind’s sibling shows with its links, never as its own row; orphaned, it still shows (b1links)', () => {
  const rows = P.fieldRows({ people: ['[[Sam]]'], 'people kind': 'works with', role: 'Site lead' }, person());
  assert.deepEqual(rows.map((r) => r.key), ['people', 'role']);
  const orphan = P.fieldRows({ 'people kind': 'works with' }, person());
  assert.deepEqual(orphan.map((r) => r.key), ['people kind'], 'no links beside it, the words still show');
  const cased = P.fieldRows({ People: ['[[Sam]]'], 'People Kind': 'works with' }, person());
  assert.deepEqual(cased.map((r) => r.key), ['People']);
});
