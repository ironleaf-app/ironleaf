// node --test tests/relation-sync.test.mjs — the relations seam (src/main/relation-sync.ts; 10.0 Endless Tech, b1links):
// every note write plans the changed relation properties through the shared planner and writes the back-links back
// through the guarded write, whoever wrote — the editor, note fields, a view cell, an agent, the CLI, an import. Pure
// planning plus a host-injected applier, driven here on made-up bakery notes in memory.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-relation-sync-'));
let S;
let F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as S from ${JSON.stringify(path.join(root, 'src/main/relation-sync.ts'))};\nexport * as F from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ S, F } = await import(pathToFileURL(path.join(work, 's.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const note = (body, props = {}) => {
  const lines = Object.entries(props).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n${body}\n` : `${body}\n`;
};

/** The seam's world in memory: texts by path, read fresh and written guarded (a write fails when told to). */
function world(texts, { fail = new Set() } = {}) {
  const disk = new Map(Object.entries(texts));
  const by = () => {
    const notes = [...disk.keys()].map((p) => ({ path: p, title: p.split('/').pop().replace(/\.md$/i, '') }));
    return { notes, propsOf: (p) => F.readProps(disk.get(p) ?? '') };
  };
  const host = {
    reads: 0,
    written: [],
    read: async (p) => {
      host.reads++;
      return disk.has(p) ? disk.get(p) : null;
    },
    write: async (p, text) => {
      if (fail.has(p) || !disk.has(p)) return false;
      disk.set(p, text);
      host.written.push(p);
      return true;
    },
  };
  return { disk, by, host };
}

const A = 'Bakery/Sourdough starter.md';
const B = 'Bakery/Loyalty cards.md';

test('linking plans the way back, and the applier writes it: every writer lands through the same seam', async () => {
  for (const [name, before, after] of [
    ['the editor', note('Crusty.', { links: ['[[Supplier call]]'] }), note('Crusty and airy.', { links: ['[[Supplier call]]', '[[Loyalty cards]]'] })],
    ['note fields', note('', { project: 'Harbour', links: '[[Supplier call]]' }), note('', { project: 'Harbour', links: ['[[Supplier call]]', '[[Loyalty cards]]'] })],
    ['an agent', note('', { task: 'Order flour', links: [] }), note('', { task: 'Order flour', links: ['[[Loyalty cards]]'] })],
    ['an import', note('', {}), note('', { links: ['[[Loyalty cards]]'] })],
  ]) {
    const w = world({ [A]: note('The starter.'), [B]: note('The cards.'), 'Meetings/Supplier call.md': note('The call.') });
    const writes = S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, before, after, w.by());
    assert.equal(writes.length, 1, `${name}: one back-write planned`);
    assert.equal(writes[0].path, B);
    const r = await S.applyRelationWrites(writes, w.host);
    assert.deepEqual(r, { synced: [{ path: B, key: 'links' }], missed: 0 }, `${name}: written and reported`);
    assert.match(w.disk.get(B), /\[\[Sourdough starter\]\]/, `${name}: the way back is there`);
  }
});

test('unlinking takes the way back off; already right is left alone and never rewritten', async () => {
  const w = world({ [A]: note('A.'), [B]: note('B.', { links: ['[[Sourdough starter]]', '[[Supplier call]]'] }), 'Meetings/Supplier call.md': note('C.') });
  const writes = S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, note('A.', { links: ['[[Loyalty cards]]'] }), note('A.', { links: [] }), w.by());
  assert.equal(writes.length, 1);
  const r = await S.applyRelationWrites(writes, w.host);
  assert.deepEqual(r.synced, [{ path: B, key: 'links' }]);
  assert.doesNotMatch(w.disk.get(B), /Sourdough starter/, 'the way back is gone');
  assert.match(w.disk.get(B), /\[\[Supplier call\]\]/, 'what else was there stays');
  // Already right: nothing planned, nothing written.
  const w2 = world({ [A]: note('A.', { links: ['[[Loyalty cards]]'] }), [B]: note('B.', { links: ['[[Sourdough starter]]'] }) });
  assert.deepEqual(S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, note('A.', { links: [] }), note('A.', { links: ['[[Loyalty cards]]'] }), w2.by()), []);
});

test('a new note’s links link back to it; a note never links to itself', async () => {
  const w = world({ [A]: note('A.', { links: ['[[Loyalty cards]]'] }), [B]: note('B.') });
  const writes = S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, '', w.disk.get(A), w.by());
  assert.equal(writes.length, 1);
  await S.applyRelationWrites(writes, w.host);
  assert.match(w.disk.get(B), /\[\[Sourdough starter\]\]/);
  const self = S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, note('A.'), note('A.', { links: ['[[Sourdough starter]]'] }), w.by());
  assert.deepEqual(self, []);
});

test('kinds ride with the back-writes: expanded around an addition, shrunk with a removal', async () => {
  const w = world({ [A]: note('A.'), [B]: note('B.', { links: ['[[Supplier call]]'], 'links kind': 'works with' }), 'Meetings/Supplier call.md': note('C.') });
  const writes = S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, note('A.'), note('A.', { links: ['[[Loyalty cards]]'] }), w.by());
  assert.deepEqual(writes[0].kindValue, ['works with', '']);
  await S.applyRelationWrites(writes, w.host);
  assert.deepEqual(F.readProps(w.disk.get(B))['links kind'], ['works with', '']);
  const drop = S.planSyncAfterWrite({ path: 'Meetings/Supplier call.md', title: 'Supplier call' }, note('C.', { links: ['[[Loyalty cards]]'] }), note('C.'), w.by());
  await S.applyRelationWrites(drop, w.host);
  assert.equal(F.readProps(w.disk.get(B))['links kind'], undefined, 'nothing kinded left, the sibling goes');
});

test('tags, type and aliases never sync, from any writer', () => {
  const w = world({ [A]: note('A.'), [B]: note('B.') });
  assert.deepEqual(S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, note('A.'), note('A.', { tags: ['Loyalty cards'] }), w.by()), []);
  assert.deepEqual(S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, note('A.', { type: 'person' }), note('A.', { type: 'Loyalty cards' }), w.by()), []);
  assert.deepEqual(S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, note('A.'), note('A.', { aliases: ['Loyalty cards'] }), w.by()), []);
  assert.deepEqual(S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, note('A.', { links: ['[[Loyalty cards]]'] }), note('A.', { links: ['[[Loyalty cards]]'], 'links kind': 'works with' }), w.by()), [], 'a kind set syncs nothing');
});

test('plain words follow properties already there; only an explicit [[link]] grows one', () => {
  const bare = world({ [A]: note('A.'), [B]: note('B.') });
  assert.deepEqual(S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, note('A.'), note('A.', { links: 'Loyalty cards' }), bare.by()), [], 'plain words never invent');
  const homed = world({ [A]: note('A.'), [B]: note('B.', { links: ['[[Supplier call]]'] }), 'Meetings/Supplier call.md': note('C.') });
  assert.equal(S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, note('A.'), note('A.', { links: 'Loyalty cards' }), homed.by()).length, 1, 'plain words follow');
  assert.equal(S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, note('A.'), note('A.', { links: '[[Loyalty cards]]' }), bare.by()).length, 1, 'explicit links invent');
});

test('a write that cannot land is missed and said, never forced', async () => {
  const w = world({ [A]: note('A.'), [B]: note('B.') });
  const writes = S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, note('A.'), note('A.', { links: ['[[Loyalty cards]]'] }), w.by());
  assert.equal(writes.length, 1);
  w.disk.delete(B);
  assert.deepEqual(await S.applyRelationWrites(writes, w.host), { synced: [], missed: 1 }, 'gone: missed, never recreated');
  const w2 = world({ [A]: note('A.'), [B]: note('B.') }, { fail: new Set([B]) });
  const writes2 = S.planSyncAfterWrite({ path: A, title: 'Sourdough starter' }, note('A.'), note('A.', { links: ['[[Loyalty cards]]'] }), w2.by());
  assert.deepEqual(await S.applyRelationWrites(writes2, w2.host), { synced: [], missed: 1 }, 'refused: missed, the words say so');
  assert.equal(w2.disk.get(B), note('B.'), 'untouched');
});

test('trash plans every other note’s properties without the trashed one, kinds and all', async () => {
  const w = world({
    [A]: note('A.', { links: ['[[Loyalty cards]]', '[[Supplier call]]'], 'links kind': ['works with', 'about'] }),
    [B]: note('B.'),
    'Meetings/Supplier call.md': note('C.', { links: '[[Loyalty cards]]', other: 1 }),
  });
  const plans = S.planUnlinkForTrash([B], w.by().notes, w.by().propsOf);
  assert.equal(plans.length, 2);
  const writes = plans.flatMap((p) => p.writes.map((x) => ({ path: p.path, key: x.key, value: x.value, ...(x.kindKey !== undefined ? { kindKey: x.kindKey, kindValue: x.kindValue ?? null } : {}) })));
  const r = await S.applyRelationWrites(writes, w.host);
  assert.equal(r.missed, 0);
  assert.deepEqual(F.readProps(w.disk.get(A)).links, ['[[Supplier call]]']);
  assert.equal(F.readProps(w.disk.get(A))['links kind'], 'about');
  assert.equal(F.readProps(w.disk.get('Meetings/Supplier call.md')).links, undefined, 'nothing left, the property goes');
  assert.deepEqual(S.planUnlinkForTrash([B], [{ path: B, title: 'Loyalty cards' }], w.by().propsOf), [], 'the trashed note itself is never rewritten');
});

test('a back-write’s echo plans nothing: the planner is a fixpoint, so no guard skips a real save', () => {
  const w = world({ [A]: note('A.', { links: ['[[Loyalty cards]]'] }), [B]: note('B.', { links: ['[[Sourdough starter]]'] }) });
  // The echo of the back-write to B (B-old without the way back, B-new with it) plans nothing on A.
  assert.deepEqual(S.planSyncAfterWrite({ path: B, title: 'Loyalty cards' }, note('B.'), w.disk.get(B), w.by()), []);
  // And the echo of a removal likewise.
  const w2 = world({ [A]: note('A.'), [B]: note('B.') });
  assert.deepEqual(S.planSyncAfterWrite({ path: B, title: 'Loyalty cards' }, note('B.', { links: ['[[Sourdough starter]]'] }), note('B.'), w2.by()), []);
});
