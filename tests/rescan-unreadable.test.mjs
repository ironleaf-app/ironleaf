// SPDX-License-Identifier: AGPL-3.0-or-later
// node --test tests/rescan-unreadable.test.mjs — an entry the drive refuses for a moment is not a deleted one
// (security review, 20 Nov 2026; src/main/vault.ts › listAll, confirmedMissing; the rescan in src/main/app.ts). A
// folder OneDrive or another program refused, or a file held open elsewhere, used to drop out of the listing, so the
// rescan deleted its notes from the index and the window closed their tabs as gone. Now the listing keeps what it had
// under an unreadable entry, the rescan removes only notes confirmed missing, and an open tab (with typing not yet
// saved) stays. Made-up notes in a temp folder.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-rescan-unreadable-'));
let V;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const electron = { name: 'electron-stand-in', resolveId: (id) => (id === 'electron' ? '\0electron' : null), load: (id) => (id === '\0electron' ? 'export const shell = { trashItem: async () => {} }; export const app = { getPath: () => "" };' : null) };
  await build({ input: path.join(root, 'src/main/vault.ts'), platform: 'node', plugins: [electron], output: { file: path.join(work, 'v.mjs'), format: 'esm' }, logLevel: 'silent' });
  V = await import(pathToFileURL(path.join(work, 'v.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const refused = (code) => Object.assign(new Error(`${code}: refused`), { code });

test('a folder or file unreadable for a moment keeps its place in the listing; a deleted one does not', async () => {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const rel of ['OneDrive/Plan.md', 'OneDrive/Deep/Budget.md', 'Home/Held.md', 'Home/Gone.md', 'top.md', 'OneDrive/photo.png']) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), '# x\n');
  }
  const v = await V.Vault.open(dir);
  const first = await v.listAll();
  assert.ok(first.files.some((f) => f.rel === 'OneDrive/Plan.md'));
  const real = v.io;
  rmSync(path.join(dir, 'Home/Gone.md'));
  v.io = {
    readdir: async (d) => (path.basename(d) === 'OneDrive' ? Promise.reject(refused('EPERM')) : real.readdir(d)),
    stat: async (abs) => (path.basename(abs) === 'Held.md' ? Promise.reject(refused('EBUSY')) : real.stat(abs)),
  };
  const second = await v.listAll();
  const rels = second.files.map((f) => f.rel);
  for (const kept of ['OneDrive/Plan.md', 'OneDrive/Deep/Budget.md', 'OneDrive/photo.png', 'Home/Held.md']) assert.ok(rels.includes(kept), `${kept} keeps its place`);
  assert.ok(second.folders.includes('OneDrive/Deep'), 'its folders too');
  assert.equal(rels.includes('Home/Gone.md'), false, 'a deleted note is not kept');
  assert.equal(second.skipped, 2);
  // An open tab's note is still in the list the window checks its tabs against (App.tsx: kept when known or unsaved).
  const known = new Set(second.files.map((f) => f.rel));
  assert.ok(known.has('OneDrive/Plan.md'));
  // Readable again: the listing is the disk's own.
  v.io = real;
  rmSync(path.join(dir, 'OneDrive/Deep'), { recursive: true });
  const third = await v.listAll();
  assert.equal(third.files.some((f) => f.rel === 'OneDrive/Deep/Budget.md'), false, 'once readable, a deleted note goes');
  assert.ok(third.files.some((f) => f.rel === 'OneDrive/Plan.md'));
});

test('the rescan removes only notes confirmed missing', async () => {
  const unreadable = [{ rel: 'OneDrive', code: 'EPERM' }, { rel: 'Home/Held.md', code: 'EBUSY' }, { rel: 'Old', code: 'ENOENT' }];
  const onDisk = new Set(['Listed.md', 'Here but not listed.md']);
  const asked = [];
  const gone = async (rel) => {
    asked.push(rel);
    if (rel === 'Locked.md') throw refused('EACCES');
    return !onDisk.has(rel);
  };
  const indexed = ['Listed.md', 'OneDrive/Plan.md', 'Home/Held.md', 'Old/Note.md', 'Deleted.md', 'Here but not listed.md', 'Locked.md', 'OneDriveX/Other.md'];
  const out = await V.confirmedMissing(indexed, new Set(['Listed.md']), unreadable, gone);
  assert.deepEqual(out, ['Old/Note.md', 'Deleted.md', 'OneDriveX/Other.md']);
  assert.equal(asked.includes('OneDrive/Plan.md') || asked.includes('Home/Held.md'), false, 'what could not be read is not even asked about');
  // A real vault: isGone says gone only for a file that is not there.
  const dir = mkdtempSync(path.join(work, 'gone-'));
  writeFileSync(path.join(dir, 'here.md'), '# here\n');
  const v = await V.Vault.open(dir);
  assert.equal(await v.isGone('here.md'), false);
  assert.equal(await v.isGone('nowhere.md'), true);
  v.io = { ...v.io, stat: async () => Promise.reject(refused('EBUSY')) };
  assert.equal(await v.isGone('here.md'), false, 'held by another program is not gone');
});

test('the wiring: the rescan deletes through confirmedMissing; the window keeps a tab with unsaved typing', () => {
  const app = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  const rescan = app.slice(app.indexOf('async function rescan(v: Vault)'), app.indexOf('const info = (v: Vault)'));
  assert.match(rescan, /await confirmedMissing\(index\.allMeta\(\)\.map\(\(m\) => m\.path\), present, v\.lastSkipped, \(rel\) => v\.isGone\(rel\)\)/);
  assert.equal(/if \(!present\.has\(meta\.path\)\) \{\s*index\.delete/.test(rescan), false, 'no delete for merely unlisted notes');
  const win = readFileSync(path.join(root, 'src/renderer/src/App.tsx'), 'utf8');
  assert.match(win, /setWorkspace\(\(w\) => W\.removed\(w, \(p\) => known\.has\(p\) \|\| docs\.hasUnsaved\(p\)\)\)/, 'a tab with unsaved typing is never closed by a listing');
});
