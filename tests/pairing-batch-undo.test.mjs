// node --test tests/pairing-batch-undo.test.mjs — v4-no-clutter item 2: anything about to make more than a
// handful of notes says so first ("this will add 14 notes, from the check just now") and takes them all back with
// one Undo. Real batches on invented vaults: a big batch holds for confirmation, a small one goes straight in, and
// one Undo takes every added note to the Bin and restores every updated one.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-batch-undo-'));
let E;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [`export * as E from ${JSON.stringify(path.join(root, 'src/main/pairing/engine.ts'))};`].join('\n'));
  await build({ input: entry, platform: 'node', external: [/^node:/], output: { file: path.join(work, 'engine.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ E } = await import(pathToFileURL(path.join(work, 'engine.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;
const freshVault = () => {
  const v = path.join(work, `vault-${++n}`);
  mkdirSync(v, { recursive: true });
  return v;
};
const NOW = new Date(2026, 9, 28, 10, 0);
const items = (count, body = (i) => `## Recipe ${i}\n\nTwo cups of flour and a slow oven.\n`) =>
  Array.from({ length: count }, (_, k) => ({ id: `r${k + 1}`, title: `Recipe ${k + 1}`, folder: '', props: {}, body: body(k + 1), files: [] }));
const srcOf = async (v, list, name = 'Recipes') => {
  const read = { kind: 'evernote', name, items: list, views: [], skipped: [] };
  return { plan: await E.planOf(v, read, { sourceFile: `${name}.enex` }), read, done: async () => {} };
};
const notesIn = (v, dir) => {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(v, ...rel.split('/')), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (r.endsWith('.md')) out.push(r);
    }
  };
  if (existsSync(path.join(v, ...dir.split('/')))) walk(dir);
  return out.sort();
};
/** The test Bin: moved aside under Bin/, like Recently deleted. */
const testBin = (v) => async (rel) => {
  const from = path.join(v, ...rel.split('/'));
  if (!existsSync(from)) return;
  const to = path.join(v, 'Bin', ...rel.split('/'));
  mkdirSync(path.dirname(to), { recursive: true });
  renameSync(from, to);
};

test('a big batch says so first, from the check just now', async () => {
  const v = freshVault();
  const src = await srcOf(v, items(14));
  const held = await E.importSource(v, src, { now: NOW });
  assert.equal(held.held, true, 'held: nothing written yet');
  assert.equal(held.fresh, 14, 'the count comes from the check just now');
  assert.match(held.words, /this will add 14 notes, from the check just now/i, 'said first, in words');
  assert.deepEqual(notesIn(v, 'From Evernote'), [], 'nothing written while held');
  assert.ok(held.check && held.pairId, 'the check carries its signature and pair');
});

test('confirmed, it comes in; one Undo takes it all back', async () => {
  const v = freshVault();
  const src = await srcOf(v, items(14));
  const held = await E.importSource(v, src, { now: NOW });
  const done = await E.importSource(v, src, { now: NOW, confirmed: held.check });
  assert.equal(done.held, undefined, 'brought in');
  assert.equal(done.added, 14, '14 notes added');
  assert.deepEqual(notesIn(v, 'From Evernote/Recipes').length, 14, 'all there');
  assert.deepEqual(done.undoable, { notes: 14, files: 0 }, 'one Undo takes all back');
  const back = await E.undoImport(v, done.pairId, { trash: testBin(v) });
  assert.equal(back.notes, 14, 'all 14 to the Bin');
  assert.deepEqual(notesIn(v, 'From Evernote/Recipes'), [], 'the folder stands empty');
  assert.deepEqual(notesIn(v, 'Bin/From Evernote/Recipes').length, 14, 'recoverable from the Bin');
  assert.match(back.words, /14 notes.*Bin/i, 'said in words');
  const again = await E.undoImport(v, done.pairId, { trash: testBin(v) });
  assert.equal(again.notes, 0, 'one Undo: a second takes back nothing');
});

test('five hundred notes hold, come in on the check, and undo whole (b6 break job)', async () => {
  const v = freshVault();
  const src = await srcOf(v, items(500));
  const held = await E.importSource(v, src, { now: NOW });
  assert.equal(held.held, true, 'held: nothing written yet');
  assert.equal(held.fresh, 500, 'the count comes from the check just now');
  const done = await E.importSource(v, src, { now: NOW, confirmed: held.check });
  assert.equal(done.held, undefined, 'brought in on the check just shown');
  assert.equal(done.added, 500, '500 notes added');
  const record = readFileSync(path.join(v, '.neuralvault', 'pairs', `${done.pairId}.json`), 'utf8');
  assert.ok(record.length < 1024 * 1024, `the pair record stays small (${record.length} bytes for 500 added notes and their fingerprints)`);
  const back = await E.undoImport(v, done.pairId, { trash: testBin(v) });
  assert.equal(back.notes, 500, 'one Undo takes all 500 back');
  assert.deepEqual(notesIn(v, 'From Evernote/Recipes'), [], 'the folder stands empty');
  assert.deepEqual(notesIn(v, 'Bin/From Evernote/Recipes').length, 500, 'recoverable from the Bin');
});

test('a small batch goes straight in, and still undoes whole', async () => {
  const v = freshVault();
  const done = await E.importSource(v, await srcOf(v, items(3)), { now: NOW });
  assert.equal(done.held, undefined, 'three notes go straight in');
  assert.equal(done.added, 3);
  const back = await E.undoImport(v, done.pairId, { trash: testBin(v) });
  assert.equal(back.notes, 3, 'one Undo takes the three back');
});

test('updated notes are restored; the person’s newer words stay', async () => {
  const v = freshVault();
  const first = await E.importSource(v, await srcOf(v, items(2)), { now: NOW });
  assert.equal(first.added, 2);
  const rel = 'From Evernote/Recipes/Recipe 1.md';
  const before = readFileSync(path.join(v, ...rel.split('/')), 'utf8');
  const changed = items(2, (i) => (i === 1 ? '## Recipe 1\n\nThree cups now, and a hotter oven.\n' : `## Recipe ${i}\n\nTwo cups of flour and a slow oven.\n`));
  const second = await E.importSource(v, await srcOf(v, changed), { now: NOW });
  assert.equal(second.updated, 1, 'the source’s change came in');
  // The person edits the second note after it came in, then the source changes it too: both changed.
  const rel2 = 'From Evernote/Recipes/Recipe 2.md';
  writeFileSync(path.join(v, ...rel2.split('/')), readFileSync(path.join(v, ...rel2.split('/')), 'utf8').replace('slow oven', 'slow oven. Mine now.'));
  const changed2 = items(2, (i) => (i === 2 ? '## Recipe 2\n\nFour cups, says the source.\n' : `## Recipe ${i}\n\nTwo cups of flour and a slow oven.\n`));
  const third = await E.importSource(v, await srcOf(v, changed2), { now: NOW });
  assert.equal(third.conflicts.length, 1, 'both changed: the source’s words go beside');
  const back = await E.undoImport(v, second.pairId, { trash: testBin(v) });
  assert.equal(back.notes, 1, 'the last run’s copy goes to the Bin');
  assert.ok(readFileSync(path.join(v, ...rel2.split('/')), 'utf8').includes('Mine now.'), 'the person’s newer words stay');
  const earlier = await E.undoImport(v, second.pairId, { trash: testBin(v) });
  assert.equal(earlier.restored, 1, 'the run before is taken back next');
  assert.equal(readFileSync(path.join(v, ...rel.split('/')), 'utf8'), before, 'the plain update is restored to its words before');
});

test('no empty frames: pages with nothing in them are left out and said (v4-no-clutter item 3)', async () => {
  const v = freshVault();
  const list = [
    ...items(2),
    { id: 'blank1', title: '', folder: '', props: {}, body: '', files: [] },
    { id: 'blank2', title: '   ', folder: '', props: {}, body: '\n\n', files: [] },
    { id: 'stub', title: 'A stub with a name', folder: '', props: {}, body: '', files: [] },
  ];
  const src = await srcOf(v, list);
  assert.equal(src.plan.notes, 3, 'the plan counts only pages with something in them');
  assert.ok(src.plan.skipped.some((s) => /empty/i.test(s.why)), 'the blanks are said in the plan');
  const done = await E.importSource(v, src, { now: NOW });
  assert.equal(done.added, 3, 'two real pages and the named stub come in');
  assert.ok(done.skipped.some((s) => /empty/i.test(s.why)), 'the summary says the blanks stayed out');
  assert.equal(done.written.length, 3, 'no note for a blank page');
});

test('a changed check says so again instead of bringing in stale words', async () => {
  const v = freshVault();
  const src = await srcOf(v, items(14));
  const held = await E.importSource(v, src, { now: NOW });
  const moved = await srcOf(v, items(15));
  const again = await E.importSource(v, moved, { now: NOW, confirmed: held.check });
  assert.equal(again.held, true, 'the source changed since the check: held again');
  assert.equal(again.fresh, 15, 'with the fresh count');
});
