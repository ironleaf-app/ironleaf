// node --test tests/relation-links-88.test.mjs — relations between notes as links in properties
// (src/shared/relation-links.ts; 8.8 database depth): a property holding [[links]], paths or titles reads as the
// records it links to, resolved against the notes in memory; writing one side plans the matching writes on the
// other side, so both directions stay in sync. Made-up bakery notes.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-rellinks-'));
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as R from ${JSON.stringify(path.join(root, 'src/shared/relation-links.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'rellinks.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ R } = await import(pathToFileURL(path.join(work, 'rellinks.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const notes = [
  { path: 'Bakery/Sourdough starter.md', title: 'Sourdough starter' },
  { path: 'Bakery/Loyalty cards.md', title: 'Loyalty cards' },
  { path: 'Meetings/Supplier call.md', title: 'Supplier call' },
];

test('a relation reads as the records it links to: [[links]], paths and plain titles', () => {
  assert.deepEqual(R.relationTargets('[[Loyalty cards]]'), ['Loyalty cards']);
  assert.deepEqual(R.relationTargets(['[[Sourdough starter|the starter]]', '[[Supplier call#Notes]]']), ['Sourdough starter', 'Supplier call']);
  assert.deepEqual(R.relationTargets('Bakery/Loyalty cards.md'), ['Bakery/Loyalty cards.md']);
  assert.deepEqual(R.relationTargets('Loyalty cards'), ['Loyalty cards']);
  assert.deepEqual(R.relationTargets(''), []);
  assert.deepEqual(R.relationTargets([null, '  ', 12]), []);
  assert.deepEqual(R.relationTargets([['[[Loyalty cards]]']]), ['Loyalty cards'], 'a list inside a list still counts');
});

test('targets resolve to notes by path or title, in any case; unknown ones are left out', () => {
  assert.deepEqual(R.resolveRelation(['Loyalty cards'], notes), ['Bakery/Loyalty cards.md']);
  assert.deepEqual(R.resolveRelation(['loyalty CARDS'], notes), ['Bakery/Loyalty cards.md']);
  assert.deepEqual(R.resolveRelation(['Bakery/Loyalty cards.md'], notes), ['Bakery/Loyalty cards.md']);
  assert.deepEqual(R.resolveRelation(['Bakery/Loyalty cards'], notes), ['Bakery/Loyalty cards.md']);
  assert.deepEqual(R.resolveRelation(['Nobody wrote this'], notes), []);
  assert.deepEqual(R.resolveRelation(['Loyalty cards', 'Loyalty cards'], notes), ['Bakery/Loyalty cards.md'], 'each record once');
});

test('a column of links reads as a relation; plain words do not', () => {
  assert.equal(R.looksLikeRelation(['[[Loyalty cards]]', '[[Supplier call]]']), true);
  assert.equal(R.looksLikeRelation(['Loyalty cards', 'Supplier call'], notes), true, 'titles of notes count when the notes are given');
  assert.equal(R.looksLikeRelation(['Done', 'In progress'], notes), false);
  assert.equal(R.looksLikeRelation([], notes), false);
});

test('both directions stay in sync: linking adds the way back, unlinking takes it off', () => {
  const propsOf = (p) =>
    p === 'Bakery/Loyalty cards.md' ? { tasks: ['[[Sourdough starter]]'] } : {};
  // Linking the supplier call from the starter's "links" property writes the way back into the call.
  const add = R.planRelationSync({ source: notes[0], key: 'links', before: [], after: ['Meetings/Supplier call.md'], propsOf, notes });
  assert.equal(add.length, 1);
  assert.equal(add[0].path, 'Meetings/Supplier call.md');
  assert.equal(add[0].key, 'links');
  assert.deepEqual(add[0].value, ['[[Sourdough starter]]']);
  // The starter already links the loyalty card through its "tasks": the way back joins that property, not a new one.
  const join = R.planRelationSync({ source: notes[0], key: 'links', before: [], after: ['Bakery/Loyalty cards.md'], propsOf, notes });
  assert.equal(join.length, 0, 'the way back is already there');
  // Unlinking takes the way back off again.
  const drop = R.planRelationSync({ source: notes[0], key: 'tasks', before: ['Bakery/Loyalty cards.md'], after: [], propsOf, notes });
  assert.equal(drop.length, 1);
  assert.equal(drop[0].path, 'Bakery/Loyalty cards.md');
  assert.equal(drop[0].key, 'tasks');
  assert.equal(drop[0].value, null, 'nothing left, so the property goes');
});

test('linking and unlinking from a cell: added to the list, taken out, gone when nothing is left', () => {
  assert.deepEqual(R.addLink(undefined, '[[Loyalty cards]]'), ['[[Loyalty cards]]']);
  assert.deepEqual(R.addLink('[[Loyalty cards]]', '[[Supplier call]]'), ['[[Loyalty cards]]', '[[Supplier call]]']);
  assert.deepEqual(R.addLink(['[[Loyalty cards]]'], '[[loyalty CARDS]]'), ['[[Loyalty cards]]'], 'already there, left alone');
  assert.deepEqual(R.addLink('Loyalty cards', '[[Loyalty cards]]', notes), 'Loyalty cards', 'the same record under other words is already there');
  assert.deepEqual(R.removeLink(['[[Loyalty cards]]', '[[Supplier call]]'], 'Meetings/Supplier call.md', notes), ['[[Loyalty cards]]']);
  assert.deepEqual(R.removeLink(['[[Loyalty cards]]'], 'Bakery/Loyalty cards.md', notes), null);
  assert.deepEqual(R.removeLink('[[Loyalty cards]]', 'Bakery/Loyalty cards.md', notes), null);
  assert.deepEqual(R.removeLink('[[Loyalty cards]]', 'Meetings/Supplier call.md', notes), '[[Loyalty cards]]', 'another record, untouched');
  assert.deepEqual(R.removeLink('[[Loyalty cards]] [[Supplier call]]', 'Meetings/Supplier call.md', notes), '[[Loyalty cards]]', 'one link of two goes; the other stays');
  assert.deepEqual(R.removeLink(['[[Loyalty cards]] [[Supplier call]]'], 'Meetings/Supplier call.md', notes), ['[[Loyalty cards]]']);
});

test('the way back keeps what else is there, and a note never links to itself', () => {
  const propsOf = () => ({ links: ['[[Supplier call]]'] });
  const add = R.planRelationSync({ source: notes[0], key: 'links', before: [], after: ['Meetings/Supplier call.md'], propsOf, notes });
  assert.deepEqual(add[0].value, ['[[Supplier call]]', '[[Sourdough starter]]']);
  const self = R.planRelationSync({ source: notes[0], key: 'links', before: [], after: [notes[0].path], propsOf, notes });
  assert.deepEqual(self, [], 'a note never links to itself');
});

test('named kinds: one kind applies to every link, a list runs parallel; unknown words kept as written', () => {
  const pair = ['[[Sam]]', '[[Priya]]'];
  assert.deepEqual(R.readLinkKinds({ people: pair, 'people kind': 'works with' }, 'people', 2), ['works with', 'works with']);
  assert.deepEqual(R.readLinkKinds({ people: pair, 'people kind': ['part of'] }, 'people', 2), ['part of', 'part of'], 'one kind covers every link');
  assert.deepEqual(R.readLinkKinds({ people: pair, 'people kind': ['part of', 'about', 'follows up'] }, 'people', 2), ['part of', 'about'], 'extras ignored');
  assert.deepEqual(R.readLinkKinds({ people: pair, 'people kind': ['part of'] }, 'people', 1), ['part of']);
  assert.deepEqual(R.readLinkKinds({ people: pair }, 'people', 2), ['', ''], 'missing means unkinded');
  assert.deepEqual(R.readLinkKinds({ people: pair, 'People Kind': 'about' }, 'people', 2), ['about', 'about'], 'the sibling in any case');
  assert.deepEqual(R.readLinkKinds({ people: pair, 'people kind': 'reports to' }, 'people', 2), ['reports to', 'reports to'], 'words nobody offered are kept');
  assert.equal(R.kindKeyFor('people'), 'people kind');
  assert.equal(R.isKindKey('people kind'), true);
  assert.equal(R.isKindKey('kind'), false, 'a bare kind is not a sibling');
  assert.equal(R.isKindKey('people'), false);
  assert.equal(R.isStructuralProp('type'), true);
  assert.equal(R.isStructuralProp('Tags'), true);
  assert.equal(R.isStructuralProp('aliases'), true);
  assert.equal(R.isStructuralProp('project'), false);
});

test('kinds round-trip: nothing when unkinded, one kind when shared, the list otherwise', () => {
  assert.equal(R.writeLinkKinds([]), null);
  assert.equal(R.writeLinkKinds(['', '']), null);
  assert.equal(R.writeLinkKinds(['works with', 'works with']), 'works with');
  assert.equal(R.writeLinkKinds(['works with']), 'works with');
  assert.deepEqual(R.writeLinkKinds(['works with', '']), ['works with', '']);
  assert.deepEqual(R.writeLinkKinds([' part of ', 'about']), ['part of', 'about'], 'trimmed on the way in');
  const props = { people: ['[[Sam]]', '[[Priya]]'], 'people kind': 'works with' };
  assert.deepEqual(R.setLinkKind(props, 'people', 2, 1, 'about'), ['works with', 'about']);
  assert.deepEqual(R.setLinkKind(props, 'people', 2, 0, ''), ['', 'works with']);
  assert.deepEqual(R.setLinkKind(props, 'people', 2, 9, 'about'), 'works with', 'past the end, left alone');
  assert.equal(R.setLinkKind({ people: ['[[Sam]]'], 'people kind': 'works with' }, 'people', 1, 0, null), null, 'nothing kinded left, the sibling goes');
});

test('only changed relation keys sync; kind siblings and type, tags and aliases never do', () => {
  assert.deepEqual(R.diffRelationProps({ people: '[[Sam]]' }, { people: '[[Priya]]' }), [{ key: 'people', before: '[[Sam]]', after: '[[Priya]]' }]);
  assert.deepEqual(R.diffRelationProps({ people: '[[Sam]]' }, { people: '[[Sam]]', 'people kind': 'works with' }), [], 'a kind set syncs nothing');
  assert.deepEqual(R.diffRelationProps({ tags: ['x'] }, { tags: ['y'] }), [], 'tags are not relations');
  assert.deepEqual(R.diffRelationProps({ type: 'person' }, { type: 'meeting' }), []);
  assert.deepEqual(R.diffRelationProps({ aliases: ['Sam'] }, { aliases: ['Sam', 'S'] }), []);
  assert.deepEqual(R.diffRelationProps({ People: '[[Sam]]' }, { people: '[[Sam]]' }), [], 'a recased key alone changes nothing');
});

test('only an explicit [[link]] grows a back-link where none is; plain words follow what is there', () => {
  const bare = () => ({ project: 'Harbour' });
  const plan = (explicit) => R.planRelationSync({ source: notes[0], key: 'links', before: [], after: ['Bakery/Loyalty cards.md'], ...(explicit === undefined ? {} : { explicit }), propsOf: bare, notes });
  assert.deepEqual(plan([]), [], 'plain words never invent a property');
  assert.equal(plan(['Bakery/Loyalty cards.md']).length, 1, 'an explicit link grows one');
  assert.equal(plan(undefined).length, 1, 'direct callers keep the old behaviour');
  const homed = () => ({ links: ['[[Supplier call]]'] });
  const follow = R.planRelationSync({ source: notes[0], key: 'links', before: [], after: ['Bakery/Loyalty cards.md'], explicit: [], propsOf: homed, notes });
  assert.deepEqual(follow[0].value, ['[[Supplier call]]', '[[Sourdough starter]]'], 'plain words follow a property already there');
});

test('back-writes carry the kinds: a single kind expands around the new link, removals shrink', () => {
  const add = R.planRelationSync({ source: notes[0], key: 'links', before: [], after: ['Bakery/Loyalty cards.md'], propsOf: () => ({ links: ['[[Supplier call]]'], 'links kind': 'works with' }), notes });
  assert.equal(add[0].kindKey, 'links kind');
  assert.deepEqual(add[0].kindValue, ['works with', ''], 'the new back-link starts unkinded');
  const plain = R.planRelationSync({ source: notes[0], key: 'links', before: [], after: ['Bakery/Loyalty cards.md'], propsOf: () => ({ links: ['[[Supplier call]]'] }), notes });
  assert.equal(plain[0].kindKey, undefined, 'no sibling, no kind write');
  const drop = R.planRelationSync({ source: notes[2], key: 'links', before: ['Bakery/Sourdough starter.md'], after: [], propsOf: () => ({ links: ['[[Supplier call]]', '[[Loyalty cards]]'], 'links kind': ['works with', 'about'] }), notes });
  assert.deepEqual(drop[0].value, ['[[Loyalty cards]]']);
  assert.equal(drop[0].kindValue, 'about', 'one kind left, kept as one');
});

test('a link to another type of note than the field wants is named, never fixed', () => {
  const typeOf = (p) => (p === 'Bakery/Loyalty cards.md' ? 'person' : 'meeting');
  assert.deepEqual(R.mismatchedLinks(['Loyalty cards', 'Supplier call'], notes, typeOf, 'person'), [
    { target: 'Supplier call', path: 'Meetings/Supplier call.md', title: 'Supplier call', actual: 'meeting' },
  ]);
  assert.deepEqual(R.mismatchedLinks(['Loyalty cards'], notes, typeOf, 'person'), []);
  assert.deepEqual(R.mismatchedLinks(['Nobody here'], notes, typeOf, 'person'), [], 'unknown is a dead link, not a mismatch');
  assert.deepEqual(R.mismatchedLinks(['Supplier call'], notes, () => null, 'person'), [], 'no type to judge by, nothing said');
  assert.equal(R.mismatchSentence('Harbour review', 'Meeting', 'Person'), '“Harbour review” is a meeting, not a person.');
  assert.equal(R.mismatchSentence('Ava', 'Organisation', 'Person'), '“Ava” is an organisation, not a person.');
});

test('a rename rewrites property links: aliases and headings kept, plain titles and paths follow', () => {
  const rewrite = (t) => (t === 'Loyalty cards' ? 'Loyalty scheme' : null);
  assert.deepEqual(R.relinkPropValue('[[Loyalty cards|scheme]]', rewrite), { value: '[[Loyalty scheme|scheme]]', changed: true });
  assert.deepEqual(R.relinkPropValue('[[Loyalty cards#Notes]]', rewrite), { value: '[[Loyalty scheme#Notes]]', changed: true });
  assert.deepEqual(R.relinkPropValue('Loyalty cards', rewrite), { value: 'Loyalty scheme', changed: true });
  assert.deepEqual(R.relinkPropValue('Bakery/Loyalty cards.md', (t) => (t === 'Bakery/Loyalty cards.md' ? 'Bakery/Loyalty scheme.md' : null)), { value: 'Bakery/Loyalty scheme.md', changed: true });
  assert.deepEqual(R.relinkPropValue('[[Supplier call]]', rewrite), { value: '[[Supplier call]]', changed: false });
  assert.deepEqual(R.relinkPropValue('prose naming Loyalty cards inside', rewrite), { value: 'prose naming Loyalty cards inside', changed: false }, 'only the whole words follow, never prose');
  assert.deepEqual(R.relinkPropValue(['[[Loyalty cards]]', 'unrelated'], rewrite), { value: ['[[Loyalty scheme]]', 'unrelated'], changed: true });
  assert.deepEqual(R.relinkPropValue(42, rewrite), { value: 42, changed: false });
  const text = '---\npeople:\n  - "[[Loyalty cards]]"\npeople kind: works with\ntype: meeting\n---\n\nBody [[Loyalty cards]] stays.\n';
  const out = R.relinkPropsInText(text, rewrite);
  assert.match(out, /\[\[Loyalty scheme\]\]/);
  assert.match(out, /Body \[\[Loyalty cards\]\] stays\./, 'the body is another pass’s work');
  assert.match(out, /people kind: works with/, 'the kinds stay aligned, in place');
  assert.equal(R.relinkPropsInText('no frontmatter [[Loyalty cards]]', rewrite), 'no frontmatter [[Loyalty cards]]');
  const bad = '---\npeople: [unclosed\n---\nbody\n';
  assert.equal(R.relinkPropsInText(bad, rewrite), bad, 'unreadable properties are left alone');
});

test('trash takes a note out of other notes’ properties, kinds and all; tags stay untouched', () => {
  assert.deepEqual(
    R.unlinkPathFromProps({ people: ['[[Loyalty cards]]', '[[Supplier call]]'], 'people kind': ['works with', 'about'], tags: ['[[Loyalty cards]]'] }, 'Bakery/Loyalty cards.md', notes),
    [{ key: 'people', value: ['[[Supplier call]]'], kindKey: 'people kind', kindValue: 'about' }],
  );
  assert.deepEqual(R.unlinkPathFromProps({ people: '[[Loyalty cards]]' }, 'Bakery/Loyalty cards.md', notes), [{ key: 'people', value: null }]);
  assert.deepEqual(R.unlinkPathFromProps({ people: '[[Supplier call]]' }, 'Bakery/Loyalty cards.md', notes), [], 'unlinked already, nothing to do');
  assert.deepEqual(R.unlinkPathFromProps({ tags: ['[[Loyalty cards]]'] }, 'Bakery/Loyalty cards.md', notes), [], 'tags are not relations');
});
