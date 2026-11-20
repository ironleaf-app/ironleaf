// node --test tests/v10relation-writer.test.mjs — one shared writer (10.0 Endless Tech, v10records): a relation's
// kinds stay with it on every door (shown beside their links, renamed and removed with them, never orphaned), and a
// Properties edit plans the other side through the same seam every writer uses. Made-up bakery notes.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-v10writer-'));
let R, F, S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const make = async (name, file) => {
    await build({ input: path.join(root, file), platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  R = await make('rellinks', 'src/shared/relation-links.ts');
  F = await make('frontmatter', 'src/shared/frontmatter.ts');
  S = await make('seam', 'src/main/relation-sync.ts');
});
after(() => rmSync(work, { recursive: true, force: true }));

const notes = [
  { path: 'People/Ava Chen.md', title: 'Ava Chen' },
  { path: 'People/Sam Lee.md', title: 'Sam Lee' },
  { path: 'Meetings/Standup.md', title: 'Standup' },
];
const typeOf = (p) => (p.startsWith('People/') ? 'person' : 'meeting');
const nameOf = (id) => ({ person: 'Person', meeting: 'Meeting' })[id] ?? id;

test('kind siblings hide beside their relation and show orphaned', () => {
  assert.deepEqual(R.shownProps({ people: ['[[Ava Chen]]'], 'people kind': 'works with', status: 'Open' }), ['people', 'status']);
  assert.deepEqual(R.shownProps({ 'people kind': 'works with' }), ['people kind'], 'orphaned, it shows so it can go');
  assert.deepEqual(R.shownProps({ People: ['[[Ava Chen]]'], 'People Kind': 'about' }), ['People'], 'in any case');
  assert.deepEqual(R.shownProps({ kind: 'sweet' }), ['kind'], 'a bare kind is not a sibling');
  // The app's own speaker-names map is machinery, never a row; a person's own "speakers" is theirs and shows (break-it 1).
  assert.deepEqual(R.shownProps({ 'neuralvault-speaker-names': { '': { spk1: 'Sam' } }, speakers: 'Jo and Sam', status: 'Open' }), ['speakers', 'status']);
});

test('removing or renaming a relation takes its kinds with it, as written', () => {
  assert.deepEqual(R.cascadeKeysForRemove({ people: ['[[Ava]]'], 'people kind': 'works with' }, 'people'), ['people', 'people kind']);
  assert.deepEqual(R.cascadeKeysForRemove({ People: ['[[Ava]]'], 'People Kind': 'about' }, 'people'), ['People', 'People Kind'], 'as written, in any case');
  assert.deepEqual(R.cascadeKeysForRemove({ people: ['[[Ava]]'] }, 'people'), ['people'], 'no sibling, just itself');
  assert.deepEqual(R.cascadeKeysForRemove({}, 'people'), [], 'nothing there, nothing to do');
  assert.deepEqual(R.cascadeRenamesFor({ people: ['[[Ava]]'], 'people kind': 'works with' }, 'people', 'attendees'), [
    { from: 'people', to: 'attendees' },
    { from: 'people kind', to: 'attendees kind' },
  ]);
  // End to end on the text, as the Properties panel writes it.
  const text = '---\npeople:\n  - "[[Ava Chen]]"\npeople kind: works with\nstatus: Open\n---\n\nWords.\n';
  const removed = F.changeProps(text, (doc) => {
    for (const k of R.cascadeKeysForRemove(F.readProps(text), 'people')) doc.delete(k);
  });
  assert.deepEqual(Object.keys(F.readProps(removed)), ['status'], 'both gone, the rest untouched');
});

test('a Properties edit plans the other side through the one seam every writer uses', async () => {
  const disk = new Map([
    ['Meetings/Standup.md', '---\npeople:\n  - "[[Ava Chen]]"\npeople kind: works with\n---\n\nWords.\n'],
    ['People/Ava Chen.md', '---\nrole: Baker\n---\n\nAva.\n'],
    ['People/Sam Lee.md', '---\nrole: Driver\n---\n\nSam.\n'],
  ]);
  const by = { notes, propsOf: (p) => F.readProps(disk.get(p) ?? '') };
  const before = disk.get('Meetings/Standup.md');
  // The panel adds a link; its kinds stay as they were.
  const after = F.changeProps(before, (doc) => doc.set('people', ['[[Ava Chen]]', '[[Sam Lee]]']));
  const writes = S.planSyncAfterWrite({ path: 'Meetings/Standup.md', title: 'Standup' }, before, after, by);
  assert.equal(writes.length, 1, 'one back-write, as from a view cell or an agent');
  assert.equal(writes[0].path, 'People/Sam Lee.md');
  assert.equal(writes[0].key, 'people');
  assert.deepEqual(writes[0].value, ['[[Standup]]']);
  assert.equal(writes[0].kindKey, undefined, 'no sibling on the other side, no kind invented');
  const host = {
    read: async (p) => (disk.has(p) ? disk.get(p) : null),
    write: async (p, text) => {
      if (!disk.has(p)) return false;
      disk.set(p, text);
      return true;
    },
  };
  await S.applyRelationWrites(writes, host);
  disk.set('Meetings/Standup.md', after);
  // Setting only the kinds plans nothing: kinds ride with links, never alone.
  const kinded = F.changeProps(before, (doc) => doc.set('people kind', 'about'));
  assert.deepEqual(S.planSyncAfterWrite({ path: 'Meetings/Standup.md', title: 'Standup' }, before, kinded, by), []);
  // Taking the panel's relation off (both keys, as it now writes) unlinks cleanly.
  const cleared = F.changeProps(after, (doc) => {
    for (const k of R.cascadeKeysForRemove(F.readProps(after), 'people')) doc.delete(k);
  });
  const drop = S.planSyncAfterWrite({ path: 'Meetings/Standup.md', title: 'Standup' }, after, cleared, by);
  assert.ok(drop.length >= 1, 'the other sides lose the way back');
  assert.ok(drop.every((w) => w.value === null || (Array.isArray(w.value) && !JSON.stringify(w.value).includes('Standup'))), 'nothing left pointing back');
});

test('mismatch words name the wrong kind in plain words, capped', () => {
  assert.equal(R.mismatchWords(['[[Standup]]'], 'person', notes, typeOf, nameOf), '“Standup” is a meeting, not a person.');
  assert.equal(R.mismatchWords(['[[Ava Chen]]'], 'person', notes, typeOf, nameOf), null);
  assert.equal(R.mismatchWords(['[[Standup]]'], undefined, notes, typeOf, nameOf), null);
  const words = R.mismatchWords(['[[Standup]]', '[[Ava Chen]]'], 'person', notes, typeOf, nameOf);
  assert.equal(words, '“Standup” is a meeting, not a person.');
  assert.ok(!/—|–/.test(words), 'no em dashes in product words');
  assert.ok(!/DSH|DeepSeek|pi-ai/i.test(words), 'no engine names in product words');
});

test('wiring: the Properties panel and the view writer share the kind helpers, with no second sync', () => {
  const props = readFileSync(path.join(root, 'src/renderer/src/components/Properties.tsx'), 'utf8');
  for (const fn of ['shownProps(', 'cascadeKeysForRemove(', 'cascadeRenamesFor(', 'mismatchWords(']) assert.ok(props.includes(fn), `Properties.tsx shares ${fn}`);
  assert.ok(props.includes('field-note'), 'mismatches read under the field, in the shared words');
  assert.ok(props.includes('path?: string'), 'the panel takes the note path for its kind checks');
  const views = readFileSync(path.join(root, 'src/renderer/src/state/savedViews.ts'), 'utf8');
  assert.ok(views.includes('kindSiblingOf('), 'taking a relation off takes its kinds with it');
  assert.ok(!views.includes('planRelationSync'), 'still no second sync of its own: the main seam writes back');
});
