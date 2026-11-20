// node --test tests/task-links.test.mjs — Typed links everywhere a project runs on (t238 vault rebuild step 1,
// 12 Nov 2026; critic 2 F03, F09). A task names its project through its note's `project` property and its person
// through [[links]] in its words (the owner's tail included); a question names its people through [[links]] in its
// asked-by and for tails. Every one resolves through the relations' own reading: by path first, so a rename never
// breaks them. Made-up people and notes only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-task-links-'));
let L, T, O;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * as links from ${JSON.stringify(path.join(root, 'src/shared/task-links.ts'))};\n` +
      `export * as tasks from ${JSON.stringify(path.join(root, 'src/shared/tasks.ts'))};\n` +
      `export * as one from ${JSON.stringify(path.join(root, 'src/shared/one-task.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  const all = await import(pathToFileURL(path.join(work, 'l.mjs')).href);
  L = all.links;
  T = all.tasks;
  O = all.one;
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOTES = [
  { path: 'People/Alex Chen.md', title: 'Alex Chen' },
  { path: 'People/Priya Nair.md', title: 'Priya Nair' },
  { path: 'Projects/Harbourline Cart Fix.md', title: 'Harbourline Cart Fix' },
];

test('a [[link]] names its person, typed', () => {
  assert.equal(L.isTypedLink('[[Alex Chen]]'), true);
  assert.equal(L.isTypedLink('Alex Chen'), false);
  assert.equal(L.personPathOf('[[Alex Chen]]', NOTES), 'People/Alex Chen.md');
  assert.equal(L.displayName('[[Alex Chen]]'), 'Alex Chen');
  assert.equal(L.displayName('Alex Chen'), 'Alex Chen');
});

test('a plain name still resolves, by title, for old notes', () => {
  assert.equal(L.personPathOf('Priya Nair', NOTES), 'People/Priya Nair.md');
  assert.equal(L.personPathOf('Nobody Here', NOTES), null);
  assert.equal(L.personPathOf('', NOTES), null);
});

test('a rename never breaks a typed link', () => {
  const renamed = [
    { path: 'People/Alex Chen.md', title: 'Alex Rivera' },
    { path: 'People/Priya Nair.md', title: 'Priya Nair' },
  ];
  assert.equal(L.personPathOf('[[People/Alex Chen]]', renamed), 'People/Alex Chen.md', 'a path link follows the note, not its name');
  assert.equal(L.personPathOf('Alex Chen', renamed), null, 'a plain name cannot follow a rename: new links are always [[links]]');
});

test('a question’s asked-by and for resolve to their notes', () => {
  assert.deepEqual(L.questionPeople({ askedBy: '[[Priya Nair]]', owner: 'Alex Chen' }, NOTES), { askedBy: 'People/Priya Nair.md', owner: 'People/Alex Chen.md' });
  assert.deepEqual(L.questionPeople({}, NOTES), { askedBy: null, owner: null });
  assert.equal(L.ownerPathOf('[[Alex Chen]]', NOTES), 'People/Alex Chen.md');
});

test('a task’s owner tail [[link]] lands in its people', () => {
  const notes = [
    { path: 'Notes/Scratch.md', title: 'Scratch', content: '- [ ] Ring ShadeCo — [[Alex Chen]]\n', mtime: 1, tags: [], props: {} },
    { path: 'People/Alex Chen.md', title: 'Alex Chen', content: '', mtime: 1, tags: [], props: { type: 'person' } },
  ];
  const gathered = T.gatherTasks(notes, {
    resolve: (target) => (target.toLowerCase().includes('alex') ? 'People/Alex Chen.md' : null),
    projectOf: () => null,
    projectName: () => null,
    isPerson: (p) => p === 'People/Alex Chen.md',
    ref: new Date('2026-11-12T09:00:00'),
  });
  assert.deepEqual(gathered[0].people, ['People/Alex Chen.md'], 'the tail’s link is a typed person link');
});

test('a task’s project comes through its note’s typed [[link]]', () => {
  const ownerOfNote = O.makeProjectOwner([{ path: 'Projects/Harbourline Cart Fix.md', names: ['Harbourline Cart Fix', 'Harbourline Cart Fix.md'] }]);
  assert.equal(ownerOfNote('Meetings/Standup.md', '[[Harbourline Cart Fix]]'), 'Projects/Harbourline Cart Fix.md');
  assert.equal(ownerOfNote('Meetings/Standup.md', '[[Projects/Harbourline Cart Fix]]'), 'Projects/Harbourline Cart Fix.md', 'a path link, rename-proof');
  assert.equal(O.projectPropOf('---\nproject: "[[Harbourline Cart Fix]]"\n---\n'), '[[Harbourline Cart Fix]]');
});
