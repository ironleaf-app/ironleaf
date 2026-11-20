// node --test tests/change-sets.test.mjs — several proposed edits waiting as ONE change set, reviewed once, even after a
// restart (10.0 Endless Tech, v2changes; src/main/change-sets.ts, src/shared/change-sets.ts). Offered by the side chat,
// the former host app or the bot, kept on disk per library: each file with its words before and after, Accept all, Accept
// this, Reject. Accepting writes through the injected guarded write (the app gives it writeNote, so the relations seam
// runs as for any save: proved here with the seam's own functions); a file changed since is left as it is, never
// misapplied; Private notes never enter.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-changesets-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { ChangeSetStore, askerWords } from ${JSON.stringify(path.join(root, 'src/main/change-sets.ts'))};`,
      `export { changeSetSummary, isSettled, setAskWords } from ${JSON.stringify(path.join(root, 'src/shared/change-sets.ts'))};`,
      `export { planSyncAfterWrite, applyRelationWrites } from ${JSON.stringify(path.join(root, 'src/main/relation-sync.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'changesets.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'changesets.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const A = 'Projects/Harbour Cafe.md';
const B = 'Projects/Ferry Timetable.md';
const noteA = '---\ntype: project\nstatus: planning\n---\n# Harbour Cafe\n\nLease till June.\n';
const noteB = '---\ntype: project\nstatus: planning\n---\n# Ferry Timetable\n\nSummer timetable.\n';

/** A store on a fresh data dir with notes in memory as the guarded host. */
async function setUp(notes = { [A]: noteA, [B]: noteB }) {
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  const files = new Map(Object.entries(notes));
  const writes = [];
  const told = [];
  const host = {
    read: async (p) => (files.has(p) ? files.get(p) : null),
    write: async (p, text, by) => {
      writes.push({ path: p, text, by });
      files.set(p, text);
    },
  };
  const store = new M.ChangeSetStore(dataDir, host, () => told.push(store.waitingCount()));
  await store.use(path.join(work, 'vault'));
  return { dataDir, files, writes, told, host, store };
}

const offerTwo = (store, by = 'assistant') =>
  store.offer('The side chat', 'Catch up both projects', [
    { id: 'p1', path: A, name: 'Harbour Cafe', base: noteA, after: noteA.replace('planning', 'active'), changes: ['Status planning → active'] },
    { id: 'p2', path: B, name: 'Ferry Timetable', base: noteB, after: noteB.replace('Summer', 'Winter'), changes: ['Summary rewritten'] },
  ], by);

test('several edits wait as one set: each file with before and after, one count in Needs you', async () => {
  const { store, told } = await setUp();
  const { set, skipped } = await offerTwo(store);
  assert.deepEqual(skipped, []);
  assert.equal(set.entries.length, 2);
  assert.equal(set.entries[0].base, noteA);
  assert.equal(set.entries[1].after, noteB.replace('Summer', 'Winter'));
  assert.equal(store.waitingCount(), 2);
  assert.deepEqual(told, [2]);
  // The list reads without the bodies; the review reads one set in full.
  const summary = M.changeSetSummary(store.get(set.id));
  assert.equal(summary.files.length, 2);
  assert.equal('base' in summary.files[0], false);
  assert.equal(M.setAskWords(summary), 'Catch up both projects');
  assert.equal(M.isSettled(store.get(set.id)), false);
});

test('a set survives a restart: a new cafe on the same folder reads it back in full', async () => {
  const { dataDir, host, store } = await setUp();
  const { set } = await offerTwo(store);
  const again = new M.ChangeSetStore(dataDir, host, () => {});
  await again.use(path.join(work, 'vault'));
  const back = again.get(set.id);
  assert.ok(back);
  assert.equal(back.askWords, 'Catch up both projects');
  assert.equal(back.entries[0].after, noteA.replace('planning', 'active'));
  assert.equal(again.waitingCount(), 2);
  // Another library reads none of it.
  const other = new M.ChangeSetStore(dataDir, host, () => {});
  await other.use(path.join(work, 'other-vault'));
  assert.deepEqual(other.list(), []);
});

test('partial accept: one file written through the guarded write, the rest untouched and waiting', async () => {
  const { files, writes, store } = await setUp();
  const { set } = await offerTwo(store, 'neuralspark');
  const r = await store.accept(set.id, 'p1');
  assert.match(r.words, /Harbour Cafe/);
  assert.deepEqual(writes, [{ path: A, text: noteA.replace('planning', 'active'), by: 'neuralspark' }]);
  assert.equal(files.get(A), noteA.replace('planning', 'active'));
  assert.equal(files.get(B), noteB, 'the other file is untouched');
  const back = store.get(set.id);
  assert.equal(back.entries.find((e) => e.id === 'p1').state, 'accepted');
  assert.equal(back.entries.find((e) => e.id === 'p2').state, 'waiting');
  assert.equal(store.waitingCount(), 1);
  assert.deepEqual(r.changes, [{ path: A, before: noteA, after: noteA.replace('planning', 'active') }]);
});

test('accept all writes every waiting file; reject leaves every file untouched', async () => {
  const { files, writes, store } = await setUp();
  const { set } = await offerTwo(store);
  const r = await store.accept(set.id);
  assert.equal(r.accepted.length, 2);
  assert.equal(files.get(A), noteA.replace('planning', 'active'));
  assert.equal(files.get(B), noteB.replace('Summer', 'Winter'));
  assert.equal(M.isSettled(store.get(set.id)), true);

  const second = await setUp();
  const o2 = await offerTwo(second.store);
  // The person typed in one file since: it goes stale, named, its file untouched; the other lands.
  second.files.set(B, `${noteB}Typed since.\n`);
  const r2 = await second.store.accept(o2.set.id);
  assert.equal(r2.accepted.length, 1);
  assert.deepEqual(r2.stale, ['Ferry Timetable']);
  assert.match(r2.words, /Ferry Timetable.*changed since/);
  assert.equal(second.files.get(B), `${noteB}Typed since.\n`);
  assert.equal(second.store.get(o2.set.id).entries.find((e) => e.id === 'p2').state, 'stale');
  // Rejecting the stale file clears it without writing.
  const rej = await second.store.reject(o2.set.id, 'p2');
  assert.match(rej.words, /Nothing was changed/);
  assert.deepEqual(second.writes.map((w) => w.path), [A]);

  const third = await setUp();
  const o3 = await offerTwo(third.store);
  await third.store.reject(o3.set.id);
  assert.equal(third.files.get(A), noteA);
  assert.equal(third.files.get(B), noteB);
  assert.deepEqual(third.writes, []);
});

test('a file changed underneath is never misapplied: stale on accept, still stale on retry', async () => {
  const { files, writes, store } = await setUp();
  const { set } = await offerTwo(store);
  files.set(A, 'Something else entirely.\n');
  const r = await store.accept(set.id, 'p1');
  assert.deepEqual(r.accepted, []);
  assert.deepEqual(r.stale, ['Harbour Cafe']);
  assert.deepEqual(writes, []);
  const r2 = await store.accept(set.id, 'p1');
  assert.deepEqual(r2.accepted, []);
  assert.equal(files.get(A), 'Something else entirely.\n');
});

test('a proposed new file lands only while nothing stands there', async () => {
  const { files, store } = await setUp({ [A]: noteA });
  const { set } = await store.offer('the host app', 'Add the timetable', [{ path: B, base: null, after: noteB, changes: ['a new project'] }], 'neuralspark');
  const r = await store.accept(set.id);
  assert.equal(r.accepted.length, 1);
  assert.equal(files.get(B), noteB);

  const second = await setUp({ [A]: noteA });
  const o2 = await second.store.offer('the host app', 'Add the timetable', [{ path: B, base: null, after: noteB }], 'neuralspark');
  second.files.set(B, 'Someone made it first.\n');
  const r2 = await second.store.accept(o2.set.id);
  assert.deepEqual(r2.accepted, []);
  assert.deepEqual(r2.stale, ['Ferry Timetable']);
  assert.equal(second.files.get(B), 'Someone made it first.\n');
});

test('Private notes never enter a set: skipped and named, or the offer refused', async () => {
  const { dataDir, store } = await setUp();
  const { set, skipped } = await store.offer('The side chat', 'Two notes', [
    { path: A, base: noteA, after: `${noteA}More.\n` },
    { path: 'Private notes/Secrets.md', base: 'x\n', after: 'y\n' },
  ]);
  assert.deepEqual(skipped, ['Secrets']);
  assert.equal(set.entries.length, 1);
  await assert.rejects(() => store.offer('The side chat', 'Only secrets', [{ path: 'Private notes/Secrets.md', base: 'x\n', after: 'y\n' }]), /Private notes/);
  const kept = readFileSync(path.join(dataDir, 'change-sets', readdirSync(path.join(dataDir, 'change-sets'))[0]), 'utf8');
  assert.equal(kept.includes('Private notes'), false);
});

test('waiting edits follow a renamed note; an oversized ask is refused in words', async () => {
  const { store } = await setUp();
  const { set } = await offerTwo(store);
  await store.renamed('Projects', 'Work');
  assert.equal(store.get(set.id).entries[0].path, 'Work/Harbour Cafe.md');
  const many = Array.from({ length: 31 }, (_, i) => ({ path: `Notes/N${i}.md`, base: 'a\n', after: 'b\n' }));
  await assert.rejects(() => store.offer('The side chat', 'Too many', many), /31 files at once/);
});

test('who may ask through the bridge: the host app, the bot and agents in words, strangers refused', () => {
  assert.equal(M.askerWords('neuralspark'), 'Another app');
  assert.equal(M.askerWords('neuralbot'), 'Chat bot');
  assert.equal(M.askerWords('bot:front-desk'), 'Chat bot (front-desk)');
  assert.equal(M.askerWords('agent:research'), 'Agent (research)');
  assert.equal(M.askerWords('someone'), null);
  assert.equal(M.askerWords(''), null);
});

test('an accepted write runs the relations seam: the other side follows, credited to the asker', async () => {
  // The app's guarded write runs this seam after every save (src/main/app.ts relationSyncForWrite); the store's accept
  // writes through that same write, so an accepted link change lands on both sides.
  const linked = 'People/Priya Shah.md';
  const before = '---\ntype: project\nowner: Mia Tran\n---\n# Harbour Cafe\n';
  const after = '---\ntype: project\nowner: "[[Priya Shah]]"\n---\n# Harbour Cafe\n';
  const notes = [
    { path: A, title: 'Harbour Cafe' },
    { path: linked, title: 'Priya Shah' },
  ];
  const props = { [A]: { type: 'project', owner: '[[Priya Shah]]' }, [linked]: { type: 'person' } };
  const writes = M.planSyncAfterWrite({ path: A, title: 'Harbour Cafe' }, before, after, { notes, propsOf: (p) => props[p] ?? {} });
  assert.ok(writes.length > 0, 'the owner change plans a back-write');
  const files = new Map([[linked, '---\ntype: person\n---\n# Priya Shah\n']]);
  const synced = await M.applyRelationWrites(writes, {
    read: async (p) => (files.has(p) ? files.get(p) : null),
    write: async (p, text) => {
      files.set(p, text);
      return true;
    },
  });
  assert.equal(synced.missed, 0);
  assert.match(files.get(linked), /Harbour Cafe/);
});
