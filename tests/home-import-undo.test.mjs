// node --test tests/home-import-undo.test.mjs — v4-no-clutter item 2: bringing a folder or vault in says what
// comes first (its plan) and takes it all back with one Undo. A real 14-note folder on invented vaults: added notes
// go to the Bin, a combined note is restored to its words before.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-home-undo-'));
let H;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const electron = { name: 'electron-stand-in', resolveId: (id) => (id === 'electron' ? '\0electron' : null), load: (id) => (id === '\0electron' ? 'export const shell = { trashItem: async () => {} }; export const app = { getPath: () => "" };' : null) };
  await build({ input: path.join(root, 'src/main/vault-home.ts'), platform: 'node', plugins: [electron], output: { file: path.join(work, 'home.mjs'), format: 'esm' }, logLevel: 'silent' });
  H = await import(pathToFileURL(path.join(work, 'home.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;
const fresh = (name) => {
  const v = path.join(work, `${name}-${++n}`);
  mkdirSync(v, { recursive: true });
  return v;
};
const put = (abs, data) => {
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
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
const testBin = (v) => async (rel) => {
  const from = path.join(v, ...rel.split('/'));
  if (!existsSync(from)) return;
  const to = path.join(v, 'Bin', ...rel.split('/'));
  mkdirSync(path.dirname(to), { recursive: true });
  renameSync(from, to);
};
const sourceWith = (dir, count) => {
  for (let k = 1; k <= count; k++) put(path.join(dir, `Note ${k}.md`), `# Note ${k}\n\nTwo cups of flour and a slow oven.\n`);
  return dir;
};

test('the plan says what comes; one Undo takes it all back', async () => {
  const v = fresh('vault');
  const from = sourceWith(fresh('source'), 14);
  const src = await H.readImport(from, v, { tempDir: path.join(work, 'temp') });
  assert.equal(src.plan.notes, 14, 'the plan says 14 notes first');
  assert.ok(src.plan.into.length > 0, 'and where they go');
  try {
    const done = await H.importInto(v, src, { targetIsNew: false });
    assert.equal(done.added, 14, '14 notes added');
    assert.ok(done.batchId, 'the run carries its take-back record');
    assert.deepEqual(done.undoable, { notes: 14, files: 0 }, 'one Undo takes all back');
    assert.deepEqual(notesIn(v, src.plan.into).length, 14, 'all there');
    const back = await H.undoHomeImport(v, done.batchId, { trash: testBin(v) });
    assert.equal(back.notes, 14, 'all 14 to the Bin');
    assert.deepEqual(notesIn(v, src.plan.into), [], 'the folder stands empty');
    assert.deepEqual(notesIn(v, `Bin/${src.plan.into}`).length, 14, 'recoverable from the Bin');
    assert.match(back.words, /14 notes.*Bin/i, 'said in words');
    const again = await H.undoHomeImport(v, done.batchId, { trash: testBin(v) });
    assert.equal(again.notes, 0, 'one Undo: a second takes back nothing');
  } finally {
    await src.done();
  }
});

test('the import dialogs offer Undo after bringing notes in', () => {
  const home = readFileSync(path.join(root, 'src/renderer/src/components/VaultHome.tsx'), 'utf8');
  assert.ok(home.includes('undoImport(step.summary.batchId!)'), 'the folder/vault dialog undoes its run');
  const weekly = readFileSync(path.join(root, 'src/renderer/src/views/modules/work/WeeklyPage.tsx'), 'utf8');
  assert.ok(weekly.includes('A.trashPaths(done.created)'), 'the weekly dialog takes its weeks back to the Bin');
  const pairs = readFileSync(path.join(root, 'src/renderer/src/components/PairedSources.tsx'), 'utf8');
  assert.ok(pairs.includes('undoPair(summary.pairId)') && pairs.includes('undoPair(p.id)'), 'paired imports undo from the dialog and the list');
});

test('five hundred notes import and undo whole, the take-back record staying small (b6 break job)', async () => {
  const v = fresh('vault');
  const from = sourceWith(fresh('source'), 500);
  const src = await H.readImport(from, v, { tempDir: path.join(work, 'temp') });
  try {
    assert.equal(src.plan.notes, 500, 'the plan says 500 notes first');
    const done = await H.importInto(v, src, { targetIsNew: false });
    assert.equal(done.added, 500, '500 notes added');
    const record = readFileSync(path.join(v, '.neuralvault', 'import-batches', `${done.batchId}.json`), 'utf8');
    assert.ok(record.length < 512 * 1024, `the take-back record holds paths, not copies (${record.length} bytes for 500 added notes)`);
    // The person edits one, then takes it all back: added notes go whole, edits and all.
    const one = path.join(v, src.plan.into, 'Note 1.md');
    writeFileSync(one, `${readFileSync(one, 'utf8')}\nTheir own line.\n`);
    const back = await H.undoHomeImport(v, done.batchId, { trash: testBin(v) });
    assert.equal(back.notes, 500, 'all 500 to the Bin');
    assert.ok(readFileSync(path.join(v, 'Bin', src.plan.into, 'Note 1.md'), 'utf8').includes('Their own line.'), 'their line rides along, recoverable');
    assert.deepEqual(notesIn(v, src.plan.into), [], 'the folder stands empty');
  } finally {
    await src.done();
  }
});

test('Undo after the person edited a combined note: their newer words stay, and are said (b6 break job)', async () => {
  const v = fresh('vault');
  const from = sourceWith(fresh('source'), 2);
  put(path.join(v, `${path.basename(from)}/Note 1.md`), '# Note 1\n\nMine, from before.\n');
  const src = await H.readImport(from, v, { tempDir: path.join(work, 'temp') });
  try {
    const done = await H.importInto(v, src, { targetIsNew: false });
    assert.deepEqual(done.merged.length, 1, 'the differing note is combined');
    const mine = path.join(v, `${path.basename(from)}/Note 1.md`);
    writeFileSync(mine, `${readFileSync(mine, 'utf8')}\nTheir newer line.\n`);
    const back = await H.undoHomeImport(v, done.batchId, { trash: testBin(v) });
    assert.equal(back.restored, 0, 'nothing restored over their newer words');
    assert.ok(readFileSync(mine, 'utf8').includes('Their newer line.'), 'their newer words stay');
    assert.match(back.words, /left|changed|theirs/i, 'and are said');
  } finally {
    await src.done();
  }
});

test('a combined note is restored to its words before', async () => {
  const v = fresh('vault');
  const from = sourceWith(fresh('source'), 2);
  put(path.join(v, `${path.basename(from)}/Note 1.md`), '# Note 1\n\nMine, from before.\n');
  const before = readFileSync(path.join(v, `${path.basename(from)}/Note 1.md`), 'utf8');
  const src = await H.readImport(from, v, { tempDir: path.join(work, 'temp') });
  try {
    const done = await H.importInto(v, src, { targetIsNew: false });
    assert.deepEqual(done.merged.length, 1, 'the differing note is combined');
    assert.ok(readFileSync(path.join(v, `${path.basename(from)}/Note 1.md`), 'utf8').includes('Merged from'), 'combined, every line kept');
    const back = await H.undoHomeImport(v, done.batchId, { trash: testBin(v) });
    assert.equal(back.restored, 1, 'restored');
    assert.equal(readFileSync(path.join(v, `${path.basename(from)}/Note 1.md`), 'utf8'), before, 'its words before');
  } finally {
    await src.done();
  }
});
