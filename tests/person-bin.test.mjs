// node --test tests/person-bin.test.mjs — one Bin: what a person deletes in the Vault goes where the page says it
// goes (5 Nov 2026). A person's Delete (path:trash) sent the file to the operating system's Recycle Bin while the
// Recently deleted page said what you delete stays here for 30 days — so the page was not telling the truth, and only
// what the assistant deleted reached the vault's Bin. Now every delete a person makes (note, file, folder, from any
// menu, key or multi-select) goes through the same Bin (.neuralvault/bin), listed on Recently deleted with Restore.
// Real files on temp vaults, never a real vault. The main-side routing (src/main/app.ts) is pinned by what it must
// contain, as its closure needs the app to run; the Bin's own behaviour runs for real.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-person-bin-'));
const read = (f) => readFileSync(path.join(root, f), 'utf8');
let B;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/main/bin.ts'), platform: 'node', output: { file: path.join(work, 'bin.mjs'), format: 'esm' }, logLevel: 'silent' });
  B = await import(pathToFileURL(path.join(work, 'bin.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const vault = () => mkdtempSync(path.join(tmpdir(), 'nv-person-vault-'));
const putFile = (dir, rel, text) => {
  const f = path.join(dir, ...rel.split('/'));
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text);
  return f;
};

// ── The Bin's own behaviour, on real files ──

test('delete for good removes one item from the Bin, and says nothing else went with it', async () => {
  const dir = vault();
  try {
    putFile(dir, 'Notes/Keep.md', '# Keep\n');
    putFile(dir, 'Notes/Gone.md', '# Gone\n');
    const bin = B.createVaultBin({ root: dir });
    const a = await bin.put('Notes/Keep.md', { by: 'You' });
    const b = await bin.put('Notes/Gone.md', { by: 'You' });
    assert.equal(typeof bin.forget, 'function', 'the Bin forgets one item for good (Recently deleted’s Delete now)');
    const r = await bin.forget(b.id);
    assert.equal(r.forgotten, true);
    assert.deepEqual((await bin.list()).map((x) => x.id), [a.id], 'only that item left the Bin');
    assert.ok(!existsSync(path.join(dir, '.neuralvault', 'bin', b.id)), 'its files are gone for good');
    assert.deepEqual(await bin.forget('no-such-id'), { forgotten: false }, 'forgetting what is not there says so');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a note written back word for word brings its Files home too, not just itself', async () => {
  const dir = vault();
  try {
    putFile(dir, 'Meetings/Kick-off.md', '# Kick-off\n');
    putFile(dir, 'Meetings/Files/Kick-off/plan.pdf', '%pdf');
    const bin = B.createVaultBin({ root: dir });
    const item = await bin.put('Meetings/Kick-off.md', { by: 'You' });
    assert.equal(item.files, 'Meetings/Files/Kick-off', 'its Files went with it');
    // Undo writes the note back where it was, word for word (the toast's Undo, a convert undone, the tidy undone).
    putFile(dir, 'Meetings/Kick-off.md', '# Kick-off\n');
    assert.deepEqual(await bin.list(), [], 'back word for word, it leaves the Bin');
    assert.ok(existsSync(path.join(dir, 'Meetings', 'Files', 'Kick-off', 'plan.pdf')), 'its Files came home with it, not deleted with the Bin copy');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The failure is made with a read-only folder: Windows ignores a folder's mode bits and root writes through them.
const NO_READONLY_DIR = process.platform === 'win32' ? 'Windows cannot make a folder read-only with chmod' : process.getuid?.() === 0 ? 'root writes into a read-only folder' : false;
test('a failed move to the Bin destroys nothing: the original stays and no half item is listed', { skip: NO_READONLY_DIR }, async () => {
  const dir = vault();
  try {
    putFile(dir, 'Notes/Stay.md', '# Stay\n');
    const binDir = path.join(dir, '.neuralvault', 'bin');
    mkdirSync(binDir, { recursive: true });
    chmodSync(binDir, 0o555);
    try {
      await assert.rejects(() => B.createVaultBin({ root: dir }).put('Notes/Stay.md', { by: 'You' }), 'the move fails');
    } finally {
      chmodSync(binDir, 0o755);
    }
    assert.equal(readFileSync(path.join(dir, 'Notes', 'Stay.md'), 'utf8'), '# Stay\n', 'the original is still where it was, word for word');
    assert.deepEqual(await B.createVaultBin({ root: dir }).list(), [], 'no half item is listed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── The person's path routes through that Bin (pinned: the closure needs the app) ──

/** A function body from app.ts, from its marker line to the next marker (both `  async function NAME(` or `  function NAME(`). */
function appFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `app.ts has ${name}`);
  const next = src.indexOf('\n  async function ', start + 10);
  const nextSync = src.indexOf('\n  function ', start + 10);
  const end = [next, nextSync].filter((x) => x > start).sort((a, b) => a - b)[0] ?? src.length;
  return src.slice(start, end);
}

test('a person’s Delete goes to the vault’s Bin, never the operating system’s trash', () => {
  const app = read('src/main/app.ts');
  const trashRel = appFn(app, 'trashRel');
  assert.ok(/binRel|createVaultBin/.test(trashRel), 'trashRel moves through the vault’s Bin (the same Bin the assistant uses)');
  assert.ok(!/toTrash|shell\.trashItem/.test(trashRel), 'trashRel never touches the operating system’s trash');
  // path:trash hands the Bin item back, so the toast’s Undo restores that item (with its Files).
  const at = app.indexOf("handle('path:trash'");
  assert.ok(at > 0, 'path:trash is handled');
  assert.ok(/return/.test(app.slice(at, at + 400)), 'path:trash returns the Bin item for Undo');
  assert.ok(read('src/preload/index.ts').includes("invoke<string>('path:trash'"), 'the window receives the Bin item id');
});

test('a failed move tells the person in plain words that it stayed where it was', () => {
  const app = read('src/main/app.ts');
  const binRel = appFn(app, 'binRel');
  assert.ok(/still where it was/i.test(binRel), 'the Bin move says the note stayed where it was when it could not move');
});

test('Recently deleted works on its own too: list, restore, delete for good, empty', () => {
  const app = read('src/main/app.ts');
  const at = app.indexOf("handle('bin:call'");
  assert.ok(at > 0, 'bin:call is handled');
  const body = app.slice(at, at + 3000);
  assert.ok(/binList|binRestore/.test(body), 'without the host app the page lists and restores from the vault’s own Bin');
  assert.ok(/forget/i.test(body), 'delete for good removes one item for good');
});

test('every word a person reads about a vault delete names Recently deleted or the Bin, never the Recycle Bin', () => {
  // The delete confirm, the toasts and the Undo.
  const actions = read('src/renderer/src/state/actions.ts');
  const trashPath = actions.slice(actions.indexOf('export async function trashPath'), actions.indexOf('export async function trashPaths'));
  assert.ok(trashPath.includes('Recently deleted'), 'the delete confirm says Recently deleted');
  assert.ok(trashPath.includes('still encrypted'), 'private notes still say sealed, in the Recycle Bin');
  const bulk = actions.slice(actions.indexOf('export async function trashPaths'), actions.indexOf('async function bringBack'));
  assert.ok(bulk.includes('Recently deleted'), 'the bulk delete says Recently deleted');
  const back = actions.slice(actions.indexOf('async function bringBack'), actions.indexOf('export async function duplicatePath'));
  assert.ok(/bin\.call|restore/.test(back), 'Undo restores from the Bin, with its Files');
  assert.ok(read('src/renderer/src/state/commands.ts').includes('is in Recently deleted'), 'the merged note says Recently deleted');
  assert.ok(read('src/renderer/src/views/NotesPage.tsx').includes('Moved to Recently deleted'), 'the notes page says Recently deleted');
  // Recently deleted says plainly when something really is gone.
  const binView = read('src/renderer/src/views/BinView.tsx');
  assert.ok(/toast\([^;]*gone for good/.test(binView), 'delete for good and emptying say so in a toast');
  // The same words everywhere else a vault delete is said.
  assert.ok(read('src/renderer/src/views/modules/work/VendorsPage.tsx').includes('Recently deleted'), 'the packs say Recently deleted');
  assert.ok(read('src/renderer/src/state/docKind.ts').includes('Recently deleted'), 'project/doc converts say Recently deleted');
  assert.ok(read('src/renderer/src/lib/settingsSearch.ts').includes('Recently deleted either way'), 'Settings says Recently deleted');
  assert.ok(read('src/main/docs.ts').includes('in Recently deleted'), 'the convert result says Recently deleted');
  assert.ok(read('src/main/modules.ts').includes('in Recently deleted'), 'taking log notes in says Recently deleted');
});
