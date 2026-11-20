// node --test tests/save-guard.test.mjs — Ironleaf never loses an edit (Nov 2026, nv-save): the one safe write
// (temp + fsync + rename, Windows-lock retries in plain words), guarded saves (a stale save becomes a conflict copy
// beside the note, never an overwrite; a gone file is never recreated), one write per file at a time, the editor's
// size guard, and the watcher hardened (per-folder fallback, re-watch after errors). Each test fails without its fix.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let M, work;
before(async () => {
  work = mkdtempSync(path.join(tmpdir(), 'nv-saveguard-'));
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const from = (f) => JSON.stringify(path.join(root, f));
  writeFileSync(
    entry,
    [
      `export { Vault } from ${from('src/main/vault.ts')};`,
      `export { LooseFiles, LOOSE_MAX_BYTES } from ${from('src/main/loose-files.ts')};`,
      `export { KeyedQueue, MAX_EDIT_BYTES, closeHandshake, renameWithRetry, tooBigToOpen, writeFileAtomic } from ${from('src/main/save-guard.ts')};`,
      `export { textVersion } from ${from('src/shared/project-file.ts')};`,
      `export { findConflictCopies } from ${from('src/shared/vault-sync.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  // The vault's Recycle Bin comes from Electron; saving and watching need none of it.
  mkdirSync(path.join(work, 'node_modules', 'electron'), { recursive: true });
  writeFileSync(path.join(work, 'node_modules', 'electron', 'package.json'), '{"name":"electron","type":"module","main":"index.js"}');
  writeFileSync(path.join(work, 'node_modules', 'electron', 'index.js'), 'export const shell = {}; export const app = {}; export default { shell, app };');
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const vaultAt = (name) => {
  const dir = path.join(work, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a save on what was read lands', async () => {
  const v = await M.Vault.open(vaultAt('ok'));
  await v.create('Plans.md', 'one\n');
  const { text, version } = await v.readForEdit('Plans.md');
  assert.equal(text, 'one\n');
  assert.equal(version, M.textVersion('one\n'));
  const r = await v.writeChecked('Plans.md', 'one\ntwo\n', version);
  assert.deepEqual(r, { ok: true });
  assert.equal(await v.read('Plans.md'), 'one\ntwo\n');
  v.close();
});

test('a save on stale words keeps both: the disk keeps theirs, the incoming words go in a conflict copy', async () => {
  const dir = vaultAt('conflict');
  const v = await M.Vault.open(dir);
  await v.create('Shopping.md', 'milk\n');
  const { version } = await v.readForEdit('Shopping.md');
  // Someone else (a sync, another editor, an agent) saves first.
  await v.write('Shopping.md', 'milk\neggs\n');
  const r = await v.writeChecked('Shopping.md', 'milk\nbread\n', version);
  assert.equal(r.ok, false);
  assert.ok(r.conflict, 'names the copy');
  assert.match(r.conflict, /Shopping \(conflict, .* from .*\)\.md$/);
  assert.equal(await v.read('Shopping.md'), 'milk\neggs\n');
  assert.equal(await v.read(r.conflict), 'milk\nbread\n');
  // The Backup and sync page reviews it like any conflict copy (same name, recognised, original beside it).
  const files = readdirSync(dir).map((f) => f);
  const found = M.findConflictCopies(files, ['LAPTOP']);
  assert.equal(found.length, 1);
  assert.equal(found[0].copy, r.conflict);
  assert.equal(found[0].original, 'Shopping.md');
  v.close();
});

test('a second conflict in the same minute takes another free name, never over the first copy', async () => {
  const v = await M.Vault.open(vaultAt('conflict2'));
  await v.create('Log.md', 'a\n');
  const { version } = await v.readForEdit('Log.md');
  await v.write('Log.md', 'a\nb\n');
  const first = await v.writeChecked('Log.md', 'a\nmine-1\n', version);
  const second = await v.writeChecked('Log.md', 'a\nmine-2\n', version);
  assert.ok(first.conflict && second.conflict && first.conflict !== second.conflict);
  assert.equal(await v.read(first.conflict), 'a\nmine-1\n');
  assert.equal(await v.read(second.conflict), 'a\nmine-2\n');
  assert.equal(await v.read('Log.md'), 'a\nb\n');
  v.close();
});

test('two saves racing on the same words: one lands, one conflicts — never a silent overwrite', async () => {
  const v = await M.Vault.open(vaultAt('race'));
  await v.create('Race.md', 'start\n');
  const { version } = await v.readForEdit('Race.md');
  const [a, b] = await Promise.all([v.writeChecked('Race.md', 'start\nA\n', version), v.writeChecked('Race.md', 'start\nB\n', version)]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1);
  const loser = a.ok ? b : a;
  assert.ok(loser.conflict, 'the loser is kept beside the note');
  assert.match(await v.read('Race.md'), /^start\n[AB]\n$/);
  v.close();
});

test('a file gone since it was read is never recreated; an explicit blind write still recreates', async () => {
  const dir = vaultAt('missing');
  const v = await M.Vault.open(dir);
  await v.create('Gone.md', 'words\n');
  const { version } = await v.readForEdit('Gone.md');
  rmSync(path.join(dir, 'Gone.md'));
  const r = await v.writeChecked('Gone.md', 'words\nmore\n', version);
  assert.deepEqual({ ok: r.ok, missing: r.missing }, { ok: false, missing: true });
  assert.ok(!existsSync(path.join(dir, 'Gone.md')), 'no ghost recreated');
  const back = await v.writeChecked('Gone.md', 'words\nmore\n', null);
  assert.equal(back.ok, true);
  assert.equal(await v.read('Gone.md'), 'words\nmore\n');
  v.close();
});

test('wiping a note reports it, so the earlier words are kept first', async () => {
  const v = await M.Vault.open(vaultAt('emptied'));
  await v.create('Wipe.md', 'everything\n');
  const { version } = await v.readForEdit('Wipe.md');
  const r = await v.writeChecked('Wipe.md', '\n', version);
  assert.equal(r.ok, true);
  assert.equal(r.emptied, true);
  const kept = await v.writeChecked('Wipe.md', 'something\n', M.textVersion('\n'));
  assert.equal(kept.emptied, undefined);
  v.close();
});

test('too big to edit is refused in plain words, before anything hangs', async () => {
  const dir = vaultAt('huge');
  const v = await M.Vault.open(dir);
  writeFileSync(path.join(dir, 'Huge.md'), Buffer.alloc(M.MAX_EDIT_BYTES + 1, 97));
  await assert.rejects(() => v.readForEdit('Huge.md'), /too big to open as a note/);
  await v.create('Small.md', 'x\n');
  const { version } = await v.readForEdit('Small.md');
  await assert.rejects(() => v.writeChecked('Small.md', 'y'.repeat(M.MAX_EDIT_BYTES + 1), version), /too much to save/);
  // The guard matches the loose files' own (one cap, one set of words).
  assert.equal(M.LOOSE_MAX_BYTES, M.MAX_EDIT_BYTES);
  v.close();
});

test('guarded canvas saves keep both too', async () => {
  const v = await M.Vault.open(vaultAt('canvas'));
  await v.createText('Board.canvas', '{"nodes":[]}');
  const { version } = await v.readTextForEdit('Board.canvas');
  await v.writeText('Board.canvas', '{"nodes":[1]}');
  const r = await v.writeTextChecked('Board.canvas', '{"nodes":[2]}', version);
  assert.equal(r.ok, false);
  assert.match(r.conflict, /Board \(conflict, .*\)\.canvas$/);
  assert.equal(await v.readText('Board.canvas'), '{"nodes":[1]}');
  v.close();
});

test('a brief Windows lock is ridden out; a stuck one fails in plain words, never a code or a path', async () => {
  let tries = 0;
  await M.renameWithRetry('a', 'b', async () => {
    if (++tries < 3) throw Object.assign(new Error('busy'), { code: 'EPERM' });
  });
  assert.equal(tries, 3);
  const err = await M.renameWithRetry('C:\\vault\\n.md', 'C:\\vault\\m.md', async () => {
    throw Object.assign(new Error('nope'), { code: 'EBUSY' });
  }).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof Error);
  assert.match(err.message, /locked or not writable/);
  assert.doesNotMatch(err.message, /EBUSY|C:\\/);
  const kept = await M.renameWithRetry('a', 'b', async () => {
    throw Object.assign(new Error('gone'), { code: 'ENOENT' });
  }).then(
    () => null,
    (e) => e,
  );
  assert.equal(kept.code, 'ENOENT', 'a real refusal keeps its code');
});

test('atomic writes land whole and leave no temps behind on failure', async () => {
  const dir = vaultAt('atomic');
  const abs = path.join(dir, 'note.md');
  await M.writeFileAtomic(abs, 'whole\n');
  assert.equal(readFileSync(abs, 'utf8'), 'whole\n');
  await M.writeFileAtomic(abs, Buffer.from([1, 2, 3]));
  assert.deepEqual([...readFileSync(abs)], [1, 2, 3]);
  await assert.rejects(() => M.writeFileAtomic(path.join(dir, 'no-such-dir', 'x.md'), 'x'));
  assert.ok(!readdirSync(dir).some((f) => f.endsWith('.nvtmp')), 'no temp litters');
});

test('a read-only folder fails in plain words, losing nothing and leaving no litter', async () => {
  const dir = vaultAt('readonly');
  const sub = path.join(dir, 'Locked');
  mkdirSync(sub, { recursive: true });
  const abs = path.join(sub, 'note.md');
  writeFileSync(abs, 'kept\n');
  chmodSync(sub, 0o555);
  try {
    const err = await M.writeFileAtomic(abs, 'new\n').then(
      () => null,
      (e) => e,
    );
    assert.ok(err instanceof Error, 'the save is refused');
    assert.match(err.message, /safe/i, 'the file is safe');
    assert.match(err.message, /folder cannot be written/i, 'the folder cannot be written');
    assert.match(err.message, /writable|try again/i, 'what to do');
    assert.doesNotMatch(err.message, /EACCES|EPERM|\.nvtmp|Locked/, 'never a code, a temp name or a path');
    assert.equal(readFileSync(abs, 'utf8'), 'kept\n', 'the file on disk is untouched');
    assert.ok(!readdirSync(sub).some((f) => f.endsWith('.nvtmp')), 'no temp litters');
  } finally {
    chmodSync(sub, 0o755);
  }
});

test('one file’s writes run one at a time', async () => {
  const q = new M.KeyedQueue();
  const order = [];
  await Promise.all([
    q.run('A.md', async () => {
      await sleep(30);
      order.push('first');
    }),
    q.run('a.md', async () => {
      order.push('second');
    }),
  ]);
  assert.deepEqual(order, ['first', 'second']);
});

test('the close handshake resolves on time, and gives up on the timeout', async () => {
  assert.equal(await M.closeHandshake((done) => setTimeout(done, 10), 500), true);
  assert.equal(await M.closeHandshake(() => {}, 30), false);
});

test('watched news is classified: texts reload, folders rescan, temps and private files ignored, null rescans', async () => {
  const v = await M.Vault.open(vaultAt('classify'));
  assert.equal(v.classify('Notes/Shop.md'), 'text');
  assert.equal(v.classify('Board.canvas'), 'text');
  assert.equal(v.classify('Draw.nvdraw'), 'text');
  assert.equal(v.classify('Views/Board.view.json'), 'text');
  assert.equal(v.classify('Views/Legacy.base'), 'text');
  assert.equal(v.classify('Photos/pic.png'), 'rescan');
  assert.equal(v.classify('Notes'), 'rescan');
  assert.equal(v.classify(null), 'rescan');
  assert.equal(v.classify('Notes/Shop.md.abc123.nvtmp'), 'ignore');
  assert.equal(v.classify('.neuralvault/settings.json'), 'ignore');
  v.close();
});

test('where one recursive watch won’t do, every folder is watched and a dead watcher is re-watched', async () => {
  const dir = vaultAt('watch');
  mkdirSync(path.join(dir, 'Sub', 'Deep'), { recursive: true });
  const v = await M.Vault.open(dir);
  const fakes = [];
  const watchFn = (folder, _opts, listener) => {
    const w = new EventEmitter();
    w.folder = folder;
    w.listener = listener;
    w.closed = false;
    w.close = () => {
      w.closed = true;
      w.removeAllListeners();
    };
    fakes.push(w);
    return w;
  };
  const changes = [];
  const rescans = [];
  v.on('change', (rel) => changes.push(rel));
  v.on('rescan', () => rescans.push(Date.now()));
  v.watch({ watchFn, forceFallback: true });
  const watched = fakes.map((f) => f.folder).sort();
  assert.ok(watched.includes(dir), 'the top is watched');
  assert.ok(watched.includes(path.join(dir, 'Sub')), 'a subfolder is watched');
  assert.ok(watched.includes(path.join(dir, 'Sub', 'Deep')), 'a deep folder is watched');
  fakes[0].listener('change', path.join('Sub', 'Note.md'));
  await sleep(300);
  assert.deepEqual(changes, ['Sub/Note.md']);
  // A folder's own watcher names only the file (20 Nov 2026: Linux read "Note.md" in Sub as a top-level note).
  changes.length = 0;
  fakes.find((f) => f.folder === path.join(dir, 'Sub')).listener('change', 'Note.md');
  fakes.find((f) => f.folder === path.join(dir, 'Sub', 'Deep')).listener('change', Buffer.from('Plan.md'));
  fakes.find((f) => f.folder === dir).listener('change', 'Top.md');
  await sleep(300);
  assert.deepEqual(changes.sort(), ['Sub/Deep/Plan.md', 'Sub/Note.md', 'Top.md']);
  fakes.find((f) => f.folder === path.join(dir, 'Sub')).listener('change', 'Shop.md.abc123.nvtmp');
  await sleep(300);
  assert.equal(changes.length, 3, 'a temp inside a subfolder is still ignored');
  fakes[0].listener('change', null);
  await sleep(600);
  assert.ok(rescans.length >= 1, 'a null name rescans');
  const before = fakes.length;
  fakes[0].emit('error', new Error('inotify exhausted'));
  await sleep(1600);
  assert.ok(fakes.length > before, 'watching starts again after an error');
  assert.ok(rescans.length >= 2, 'and rescans at once');
  v.close();
});

test('a loose file’s guarded save: a stale save becomes a copy beside it, a gone file nothing', async () => {
  const outside = vaultAt('loose');
  const abs = path.join(outside, 'Report.md');
  writeFileSync(abs, 'draft\n');
  const loose = new M.LooseFiles(() => null);
  const opened = await loose.open(abs);
  assert.equal(opened.kind, 'loose');
  const id = opened.file.id;
  const first = await loose.read(id);
  assert.equal(first.text, 'draft\n');
  // Another program saves (its time bumped so no filesystem reports the same instant twice).
  writeFileSync(abs, 'draft\nsigned\n');
  const bumped = new Date(first.mtime + 5000);
  utimesSync(abs, bumped, bumped);
  const r = await loose.write(id, 'draft\nmine\n', first.mtime);
  assert.ok(r.conflict, 'a copy beside the file');
  assert.equal(readFileSync(abs, 'utf8'), 'draft\nsigned\n');
  assert.equal(readFileSync(r.conflict, 'utf8'), 'draft\nmine\n');
  assert.match(path.basename(r.conflict), /Report \(conflict, .*\)\.md$/);
  // Gone since: nothing recreated, unless explicitly asked.
  rmSync(abs);
  const gone = await loose.write(id, 'draft\nmine\n', r.mtime);
  assert.equal(gone.missing, true);
  assert.ok(!existsSync(abs));
  const back = await loose.write(id, 'draft\nmine\n', null);
  assert.ok(!back.missing && back.mtime > 0);
  assert.equal(readFileSync(abs, 'utf8'), 'draft\nmine\n');
});

test('a loose file too big refuses to open for editing, in plain words', async () => {
  const outside = vaultAt('loose-huge');
  const abs = path.join(outside, 'Huge.md');
  writeFileSync(abs, Buffer.alloc(M.LOOSE_MAX_BYTES + 1, 97));
  const loose = new M.LooseFiles(() => null);
  await assert.rejects(() => loose.open(abs), /too big to open as a note/);
});

test('import creates land whole or not at all: createText and writeBinary are atomic, never over (O1)', async () => {
  const dir = vaultAt('o1-atomic');
  const v = await M.Vault.open(dir);
  await v.createText('Notes/Row.md', '---\nDue: 2025-01-01\n---\n');
  assert.equal(readFileSync(path.join(dir, 'Notes/Row.md'), 'utf8'), '---\nDue: 2025-01-01\n---\n');
  await v.writeBinary('Notes/pic.png', new Uint8Array([1, 2, 3]));
  assert.deepEqual([...readFileSync(path.join(dir, 'Notes/pic.png'))], [1, 2, 3]);
  // Never over a file that is there (EEXIST, the existing kept).
  assert.equal(await v.createText('Notes/Row.md', 'other').then(() => null, (e) => e.code), 'EEXIST');
  assert.equal(readFileSync(path.join(dir, 'Notes/Row.md'), 'utf8'), '---\nDue: 2025-01-01\n---\n');
  assert.equal(await v.writeBinary('Notes/pic.png', new Uint8Array([9])).then(() => null, (e) => e.code), 'EEXIST');
  assert.ok(!readdirSync(path.join(dir, 'Notes')).some((f) => f.endsWith('.nvtmp')), 'no temp litters');
  // The mechanism: temp-then-rename inside the file’s queue (fails without the fix).
  const src = readFileSync(path.join(root, 'src/main/vault.ts'), 'utf8');
  const createText = src.slice(src.indexOf('async createText'), src.indexOf('async createText') + 800);
  const writeBinary = src.slice(src.indexOf('async writeBinary'), src.indexOf('async writeBinary') + 1000);
  assert.ok(createText.includes('writeFileAtomic') && createText.includes('writes.run'), 'createText through the queued atomic write');
  assert.ok(writeBinary.includes('writeFileAtomic') && writeBinary.includes('writes.run'), 'writeBinary through the queued atomic write');
  v.close();
});

test('a case-only rename never replaces another file on a case-sensitive disk; on its own file it renames', async () => {
  const dir = vaultAt('case');
  writeFileSync(path.join(dir, 'Note.md'), 'mine\n');
  const v = await M.Vault.open(dir);
  // Probe the disk: on a case-insensitive one there can't be two spellings, so only the plain rename is checked.
  let sensitive = true;
  try {
    writeFileSync(path.join(dir, 'note.md'), 'theirs\n', { flag: 'wx' });
  } catch {
    sensitive = false;
  }
  if (sensitive) {
    await assert.rejects(() => v.rename('Note.md', 'note.md'), /already exists/);
    await assert.rejects(() => v.move('Note.md', 'note.md'), /already there/);
    assert.equal(readFileSync(path.join(dir, 'note.md'), 'utf8'), 'theirs\n', 'the other file is untouched');
    assert.equal(readFileSync(path.join(dir, 'Note.md'), 'utf8'), 'mine\n');
    rmSync(path.join(dir, 'note.md'));
  }
  await v.rename('Note.md', 'NOTE.md');
  assert.ok(readdirSync(dir).includes('NOTE.md'), 'a case-only rename of the file itself goes ahead');
  await v.move('NOTE.md', 'Note.md');
  assert.ok(readdirSync(dir).includes('Note.md'));
  v.close();
});
