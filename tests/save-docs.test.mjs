// node --test tests/save-docs.test.mjs — the window's open documents (Nov 2026, nv-save): every save carries what it
// was read from, a save that would clobber another change comes back unlanded with both copies kept and a banner, a
// gone file is never recreated, and a failed save keeps the words here and tries again. The main side is a scripted
// stand-in; each test fails without its fix.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let M, work;

// ── The main side, scripted ──────────────────────────────────────────────────────────────────────────────────────
const disk = new Map();
let vseq = 1;
const writes = [];
const trashed = [];
let failNext = null;
let conflictNext = null;
let missingNext = false;
const noteWriteOpts = [];
const version = () => `v${vseq++}`;
const seed = (p, text) => disk.set(p, { text, version: version() });
const api = (p, t, base) => {
  writes.push({ path: p, text: t, base });
  if (failNext) {
    const e = failNext;
    failNext = null;
    throw e;
  }
  if (missingNext) {
    missingNext = false;
    return { ok: false, missing: true };
  }
  if (conflictNext) {
    const c = conflictNext;
    conflictNext = null;
    return { ok: false, conflict: c };
  }
  disk.set(p, { text: t, version: version() });
  return { ok: true };
};

before(async () => {
  work = mkdtempSync(path.join(tmpdir(), 'nv-savedocs-'));
  globalThis.window = {
    nv: {
      notes: {
        open: async (p) => {
          const d = disk.get(p);
          if (!d) throw new Error(`missing: ${p}`);
          return { text: d.text, version: d.version };
        },
        read: async (p) => {
          const d = disk.get(p);
          if (!d) throw new Error(`missing: ${p}`);
          return d.text;
        },
        write: async (p, t, _by, base, opts) => (noteWriteOpts.push({ path: p, opts }), api(p, t, base)),
      },
      files: {
        openText: async (p) => {
          const d = disk.get(p);
          if (!d) throw new Error(`missing: ${p}`);
          return { text: d.text, version: d.version };
        },
        readText: async (p) => {
          const d = disk.get(p);
          if (!d) throw new Error(`missing: ${p}`);
          return d.text;
        },
        writeText: async (p, t, base) => api(p, t, base),
        trash: async (p) => {
          trashed.push(p);
        },
      },
      private: {
        read: async (p) => `locked:${p}`,
        write: async (p, t) => {
          writes.push({ path: p, text: t, base: null });
          return p;
        },
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, hidden: false };
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const from = (f) => JSON.stringify(path.join(root, f));
  writeFileSync(entry, [`export { docs } from ${from('src/renderer/src/state/docs.ts')};`].join('\n'));
  // The toast actions' dynamic import (state/actions.ts) is stood in for: opening tabs is not under test, and the
  // real module pulls the window's asset imports with it. The empty-note cleanup (state/writeFirst.ts, called from
  // docs release()) reaches actions the same dynamic way, so it is stood in at the same seam (5 Nov 2026, vault
  // suite: the cleanup moved to the leaf module so docs.ts no longer imports noteTypes, which statically imports
  // the window; trashing is not under test either).
  const actionsStub = path.join(work, 'actions-stub.ts');
  writeFileSync(actionsStub, 'export const openPath = () => {};\nexport const trashPath = async () => false;\n');
  const stubActions = { name: 'stub-actions', resolveId: (id, importer) => (id === './actions' && (importer?.endsWith('state/docs.ts') || importer?.endsWith('state/writeFirst.ts')) ? actionsStub : null) };
  // React is only the hooks' subscription here (not under test); a stand-in keeps the bundle small and honest.
  await build({ input: entry, platform: 'node', external: ['react'], plugins: [stubActions], output: { file: path.join(work, 'm.mjs'), format: 'esm', inlineDynamicImports: true }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules', 'react'), { recursive: true });
  writeFileSync(path.join(work, 'node_modules', 'react', 'package.json'), '{"name":"react","type":"module","main":"index.js"}');
  writeFileSync(path.join(work, 'node_modules', 'react', 'index.js'), 'export const useSyncExternalStore = (_sub, get) => get();');
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => {
  delete globalThis.window;
  delete globalThis.document;
  rmSync(work, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a save carries what it was read from, and lands', async () => {
  seed('A.md', 'one\n');
  const read = disk.get('A.md').version;
  const docs = M.docs;
  assert.equal(await docs.acquire('A.md'), 'one\n');
  docs.update('A.md', 'one\ntwo\n', 'test');
  assert.equal(docs.saveState('A.md'), 'saving');
  await docs.flush('A.md');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'A.md');
  assert.equal(writes[0].text, 'one\ntwo\n');
  assert.equal(writes[0].base, read);
  assert.equal(docs.saveState('A.md'), 'saved');
  assert.equal(docs.notice('A.md'), null);
  docs.release('A.md');
  writes.length = 0;
});

test('nothing to save writes nothing', async () => {
  seed('B.md', 'still\n');
  const docs = M.docs;
  await docs.acquire('B.md');
  await docs.flush('B.md');
  assert.equal(writes.length, 0);
  docs.release('B.md');
});

test('a conflict keeps both and waits for the person: no second write until they choose', async () => {
  seed('C.md', 'milk\n');
  const docs = M.docs;
  await docs.acquire('C.md');
  docs.update('C.md', 'milk\nbread\n', 'test');
  const copy = 'C (conflict, 2 Nov 2026 10.30 am, from TEST).md';
  conflictNext = copy;
  await docs.flush('C.md');
  assert.equal(writes.length, 1);
  assert.deepEqual(docs.notice('C.md'), { kind: 'conflict', copy });
  assert.equal(docs.saveState('C.md'), 'conflict');
  assert.equal(docs.text('C.md'), 'milk\nbread\n', 'these words stay in the editor');
  docs.update('C.md', 'milk\nbread\nbutter\n', 'test');
  await docs.flush('C.md');
  assert.equal(writes.length, 1, 'blocked until the choice — never a second copy behind their back');
  assert.equal(docs.saveState('C.md'), 'conflict');
  docs.forget('C.md');
  writes.length = 0;
});

test('“use theirs” takes the disk and keeps the copy; “keep mine” saves over and bins the copy', async () => {
  seed('D.md', 'theirs\n');
  const docs = M.docs;
  await docs.acquire('D.md');
  docs.update('D.md', 'mine\n', 'test');
  conflictNext = 'D (conflict, 2 Nov 2026 10.30 am, from TEST).md';
  await docs.flush('D.md');
  await docs.resolveConflict('D.md', 'theirs');
  assert.equal(docs.text('D.md'), 'theirs\n');
  assert.equal(docs.notice('D.md'), null);
  assert.equal(trashed.length, 0, 'the copy stays beside the note');
  // And the other way: mine land over theirs, the copy to the bin.
  docs.update('D.md', 'mine again\n', 'test');
  conflictNext = 'D (conflict, 2 Nov 2026 10.31 am, from TEST).md';
  await docs.flush('D.md');
  await docs.resolveConflict('D.md', 'mine');
  assert.equal(disk.get('D.md').text, 'mine again\n');
  assert.deepEqual(trashed, ['D (conflict, 2 Nov 2026 10.31 am, from TEST).md']);
  assert.equal(docs.saveState('D.md'), 'saved');
  docs.forget('D.md');
  writes.length = 0;
  trashed.length = 0;
});

test('a gone file is never recreated behind the person; “bring back” recreates explicitly', async () => {
  seed('E.md', 'words\n');
  const docs = M.docs;
  await docs.acquire('E.md');
  docs.update('E.md', 'words\nmore\n', 'test');
  missingNext = true;
  await docs.flush('E.md');
  assert.deepEqual(docs.notice('E.md'), { kind: 'missing' });
  assert.equal(docs.saveState('E.md'), 'error');
  assert.equal(writes.length, 1);
  await docs.flush('E.md');
  assert.equal(writes.length, 1, 'blocked — nothing recreated');
  disk.delete('E.md');
  await docs.bringBack('E.md');
  assert.equal(writes.length, 2);
  assert.equal(writes[1].base, null, 'an explicit blind recreate');
  assert.equal(docs.notice('E.md'), null);
  docs.forget('E.md');
  writes.length = 0;
});

test('a failed save keeps the words and tries again until they land', async () => {
  seed('F.md', 'keep me\n');
  const docs = M.docs;
  await docs.acquire('F.md');
  docs.update('F.md', 'keep me\nand more\n', 'test');
  failNext = new Error('ENOSPC: no space left on device, write');
  await docs.flush('F.md');
  assert.equal(docs.saveState('F.md'), 'error');
  assert.equal(docs.text('F.md'), 'keep me\nand more\n');
  await sleep(2600);
  assert.ok(writes.length >= 2, 'tried again on its own');
  assert.equal(docs.saveState('F.md'), 'saved');
  docs.forget('F.md');
  writes.length = 0;
});

test('outside changes land in clean tabs and never touch dirty ones', async () => {
  seed('G.md', 'v1\n');
  seed('H.md', 'v1\n');
  const docs = M.docs;
  await docs.acquire('G.md');
  await docs.acquire('H.md');
  docs.update('H.md', 'v1\nmine\n', 'test');
  disk.get('G.md').text = 'v1\ntheirs\n';
  disk.get('H.md').text = 'v1\ntheirs\n';
  await docs.changedOnDisk(['G.md', 'H.md']);
  assert.equal(docs.text('G.md'), 'v1\ntheirs\n');
  assert.equal(docs.text('H.md'), 'v1\nmine\n', 'dirty tabs are left alone; the guarded save settles it');
  docs.forget('G.md');
  docs.forget('H.md');
});

test('background reads and writes go through the open tab when open, else to disk', async () => {
  seed('I.md', 'open\n');
  seed('J.md', 'closed\n');
  const docs = M.docs;
  await docs.acquire('I.md');
  docs.update('I.md', 'open\nunsaved\n', 'test');
  assert.equal(await docs.readThrough('I.md'), 'open\nunsaved\n', 'nothing unsaved missed');
  assert.equal(await docs.readThrough('J.md'), 'closed\n');
  await docs.writeThrough('I.md', 'open\nunsaved\nticked\n', 'test');
  assert.equal(docs.text('I.md'), 'open\nunsaved\nticked\n', 'the tab shows it straight away');
  await docs.writeThrough('J.md', 'closed\nticked\n', 'test');
  assert.equal(disk.get('J.md').text, 'closed\nticked\n');
  docs.forget('I.md');
  writes.length = 0;
});

test('a file gone from the list with words only here is stranded, bannered, and kept', async () => {
  seed('K.md', 'words\n');
  const docs = M.docs;
  await docs.acquire('K.md');
  docs.update('K.md', 'words\nunsaved\n', 'test');
  assert.deepEqual(docs.stranded(new Set(['Other.md'])), ['K.md']);
  assert.deepEqual(docs.stranded(new Set(['K.md', 'Other.md'])), []);
  assert.equal(docs.hasUnsaved('K.md'), true);
  docs.markMissing('K.md');
  assert.deepEqual(docs.notice('K.md'), { kind: 'missing' });
  await docs.flush('K.md');
  assert.equal(writes.length, 0, 'never silently recreated');
  assert.equal(docs.text('K.md'), 'words\nunsaved\n');
  docs.forget('K.md');
});

// ── 20 Nov 2026 audit: a rename while typing, and deletes ────────────────────────────────────────────────────────

test('typing during a rename is saved at the new path without another keystroke', async () => {
  seed('R/Old.md', 'first\n');
  const docs = M.docs;
  await docs.acquire('R/Old.md');
  writes.length = 0;
  // A keystroke: its save is due in a moment, at the path it was typed at.
  docs.update('R/Old.md', 'first\nsecond\n', 'test');
  // The move lands before that save is due (the main side moved the file).
  disk.set('R/New.md', disk.get('R/Old.md'));
  disk.delete('R/Old.md');
  await docs.renamed('R/Old.md', 'R/New.md');
  await sleep(700);
  assert.deepEqual(writes.map((w) => [w.path, w.text]), [['R/New.md', 'first\nsecond\n']], 'saved at the new path, with no further typing');
  assert.equal(disk.get('R/New.md').text, 'first\nsecond\n');
  assert.equal(docs.saveState('R/New.md'), 'saved');
  docs.forget('R/New.md');
  writes.length = 0;
});

test('a save that found the file mid-move is not left stranded: it lands at the new path', async () => {
  seed('S/Old.md', 'one\n');
  const docs = M.docs;
  await docs.acquire('S/Old.md');
  writes.length = 0;
  docs.update('S/Old.md', 'one\ntwo\n', 'test');
  // The save ran while the move was under way: the old path was already empty.
  missingNext = true;
  await docs.flush('S/Old.md');
  assert.deepEqual(docs.notice('S/Old.md'), { kind: 'missing' });
  disk.set('S/New.md', disk.get('S/Old.md'));
  disk.delete('S/Old.md');
  await docs.renamed('S/Old.md', 'S/New.md');
  await sleep(500);
  assert.equal(docs.notice('S/New.md'), null);
  assert.equal(disk.get('S/New.md').text, 'one\ntwo\n', 'the words typed are saved where the note now is');
  docs.forget('S/New.md');
  writes.length = 0;
});

test('before a delete everything open under it is saved; after it, let go; a failed delete keeps saving', async () => {
  seed('Del/A.md', 'a\n');
  seed('Del/Sub/B.md', 'b\n');
  seed('Delta.md', 'not inside\n');
  const docs = M.docs;
  await docs.acquire('Del/A.md');
  await docs.acquire('Del/Sub/B.md');
  await docs.acquire('Delta.md');
  writes.length = 0;
  docs.update('Del/A.md', 'a\ntyped\n', 'test');
  docs.update('Del/Sub/B.md', 'b\ntyped\n', 'test');
  docs.update('Delta.md', 'not inside\ntyped\n', 'test');
  await docs.flushUnder('Del');
  assert.deepEqual(writes.map((w) => w.path).sort(), ['Del/A.md', 'Del/Sub/B.md'], 'a folder’s open notes saved, nothing beside it');
  // The delete failed: nothing was let go, so the next typing still saves.
  docs.update('Del/A.md', 'a\ntyped\nmore\n', 'test');
  await sleep(700);
  assert.equal(disk.get('Del/A.md').text, 'a\ntyped\nmore\n', 'still saving after a failed delete');
  // The delete landed: everything inside is let go, a note merely starting with the name stays.
  docs.forgetUnder('Del');
  assert.equal(docs.text('Del/A.md'), undefined);
  assert.equal(docs.text('Del/Sub/B.md'), undefined);
  assert.equal(docs.text('Delta.md'), 'not inside\ntyped\n');
  docs.forget('Delta.md');
  writes.length = 0;
});

test('the delete in the window saves first and lets go only after the Bin took it (state/actions.ts)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(path.join(root, 'src/renderer/src/state/actions.ts'), 'utf8');
  const one = src.slice(src.indexOf('export async function trashPath'), src.indexOf('export async function trashPaths'));
  const flushAt = one.indexOf('await docs.flushUnder(path)');
  const trashAt = one.indexOf('await api().files.trash(path)');
  const forgetAt = one.indexOf('docs.forgetUnder(path)');
  assert.ok(flushAt > 0 && trashAt > flushAt && forgetAt > trashAt, 'flushUnder, then trash, then forgetUnder');
  const many = src.slice(src.indexOf('export async function trashPaths'), src.indexOf('async function bringBack('));
  assert.ok(many.indexOf('await docs.flush(p)') < many.indexOf('await api().files.trash(p)') && many.indexOf('await api().files.trash(p)') < many.indexOf('docs.forget(p)'));
});

test('an import’s write says so, open tab or not, so no back-links are written for it (20 Nov 2026)', async () => {
  seed('Imp/Closed.md', 'a\n');
  seed('Imp/Open.md', 'b\n');
  const docs = M.docs;
  noteWriteOpts.length = 0;
  await docs.writeThrough('Imp/Closed.md', 'a\nproject: "[[Bakery]]"\n', 'import');
  await docs.acquire('Imp/Open.md');
  await docs.writeThrough('Imp/Open.md', 'b\nmerged\n', 'import');
  // The person's own next save is a normal one again.
  docs.update('Imp/Open.md', 'b\nmerged\nmine\n', 'test');
  await docs.flush('Imp/Open.md');
  await docs.writeThrough('Imp/Closed.md', 'a\nedited\n', 'test');
  assert.deepEqual(noteWriteOpts.map((w) => [w.path, w.opts?.imported === true]), [
    ['Imp/Closed.md', true],
    ['Imp/Open.md', true],
    ['Imp/Open.md', false],
    ['Imp/Closed.md', false],
  ]);
  docs.forget('Imp/Open.md');
  writes.length = 0;
});
