// node --test tests/private-notes.test.mjs — Private notes (src/main/private-notes.ts; 16 Oct 2026): set up with a
// recovery password and Windows Hello on this PC, notes encrypted on disk under random names (no words and no names
// readable), opened with either, refused with a wrong password or on a PC not added, locked: every word gone from memory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-private-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/main/private-notes.ts'), platform: 'node', output: { file: path.join(work, 'private.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'private.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

/** Windows Hello as a stand-in: one secret per name and challenge, from this PC's own key. */
const hello = (pcKey, ok = true) => ({
  available: async () => ok,
  secret: async (name, challenge) => createHash('sha256').update(pcKey).update(name).update(challenge).digest(),
});

test('set up, write, lock, open again: encrypted on disk, names private, refused without the right key', async () => {
  const vault = path.join(work, 'vault');
  const trashed = [];
  let locked = 0;
  const make = (id, pcKey, ok = true) =>
    new M.PrivateNotes({ root: () => vault, hello: hello(pcKey, ok), device: { id, name: id }, lockAfter: () => 0, onLocked: () => locked++, trash: async (abs) => (trashed.push(abs), rmSync(abs)) });
  const pc = make('pc-1', 'this pc');
  assert.deepEqual(await pc.status(), { exists: false, unlocked: false, hello: true, thisPc: false, count: 0 });
  await assert.rejects(() => pc.setUp('short', true), /at least 10 characters/);
  const opened = await pc.setUp('correct horse battery', true);
  assert.deepEqual([opened.exists, opened.unlocked, opened.thisPc], [true, true, true], 'open at once, and this PC opens them with Windows Hello');
  await assert.rejects(() => pc.setUp('another password', false), /already set up/);

  assert.equal(await pc.write('Health/Blood tests', 'Iron is low. Ask Dr Patel.'), 'Private notes/Health/Blood tests.md');
  await pc.create('', 'Diary', 'Dear diary');
  assert.deepEqual(pc.list().map((n) => n.path), ['Private notes/Diary.md', 'Private notes/Health/Blood tests.md']);
  assert.equal(pc.read('Private notes/Health/Blood tests.md'), 'Iron is low. Ask Dr Patel.');
  assert.deepEqual(pc.search('patel').map((h) => h.path), ['Private notes/Health/Blood tests.md'], 'searched only while open, never indexed');

  // On disk: random names and sealed words; the key file holds no key in the clear.
  const dir = path.join(vault, 'Private notes');
  const names = readdirSync(dir).sort();
  assert.equal(names.filter((n) => n.endsWith('.nvlock')).length, 2);
  assert.ok(names.includes('keys.nvkey'));
  assert.ok(names.every((n) => !/diary|blood|health/i.test(n)), 'no note’s name in a file name');
  const everything = names.map((n) => readFileSync(path.join(dir, n), 'utf8')).join('\n');
  for (const word of ['Iron', 'Patel', 'Dear diary', 'Blood tests', 'Health', 'correct horse']) assert.ok(!everything.includes(word), `“${word}” is not readable on disk`);

  // Locked: nothing readable from memory, the window is told.
  pc.lock();
  assert.equal(locked, 1);
  assert.throws(() => pc.list(), /locked/);
  assert.throws(() => pc.read('Diary'), /locked/);
  assert.deepEqual((await pc.status()).unlocked, false);

  await assert.rejects(() => pc.unlockWithPassword('wrong password!'), /isn’t the recovery password/);
  await pc.unlockWithHello();
  assert.equal(pc.read('Diary'), 'Dear diary', 'Windows Hello on this PC opens them');
  pc.lock();

  // Another PC (the notes synced there): Windows Hello there hasn't been added; the recovery password opens them, then
  // that PC is added.
  const other = make('pc-2', 'other pc');
  assert.equal((await other.status()).thisPc, false);
  await assert.rejects(() => other.unlockWithHello(), /hasn’t been added yet/);
  await other.unlockWithPassword('correct horse battery');
  assert.equal(other.read('Health/Blood tests'), 'Iron is low. Ask Dr Patel.');
  await other.addThisPc();
  other.lock();
  await other.unlockWithHello();
  assert.equal(other.list().length, 2, 'that PC opens them with its own Windows Hello now');

  // A PC whose Windows Hello key changed can't open them with it any more, and is told to use the password.
  const changed = make('pc-1', 'a new key on this pc');
  await assert.rejects(() => changed.unlockWithHello(), /can’t open them any more/);

  // Renamed, deleted (to the Recycle Bin, still sealed), a new recovery password.
  assert.equal(await other.rename('Diary', 'Journal/2026'), 'Private notes/Journal/2026.md');
  await other.remove('Private notes/Journal/2026.md');
  assert.equal(trashed.length, 1);
  assert.ok(trashed[0].endsWith('.nvlock'));
  assert.deepEqual(other.list().map((n) => n.path), ['Private notes/Health/Blood tests.md']);
  await other.changePassword('a brand new passphrase');
  other.lock();
  await assert.rejects(() => other.unlockWithPassword('correct horse battery'), /isn’t the recovery password/, 'the old password stops working');
  await other.unlockWithPassword('a brand new passphrase');
  other.lock();

  // A damaged or half-synced file is left as it is; the rest open.
  writeFileSync(path.join(dir, 'broken.nvlock'), '{"v":1,"nonce":"AAAA","data":"AAAA"}');
  await other.unlockWithPassword('a brand new passphrase');
  assert.equal(other.list().length, 1);
  other.lock();

  // Names that climb out of the folder are refused.
  await other.unlockWithPassword('a brand new passphrase');
  for (const bad of ['../outside', 'a/../../b', 'x\u0000y', '']) await assert.rejects(() => other.write(bad, 'x'), /can’t be used/);
  other.lock();
});

test('making a note whose name is taken opens that note, never a numbered copy (9.5 fresh eyes)', async () => {
  const vault = path.join(work, 'vault-3');
  const pc = new M.PrivateNotes({ root: () => vault, hello: null, device: { id: 'pc', name: 'pc' }, lockAfter: () => 0, onLocked: () => {}, trash: async () => {} });
  await pc.setUp('just a password here', false);
  assert.equal(await pc.create('Health', 'Blood tests', 'Iron is low.'), 'Private notes/Health/Blood tests.md');
  assert.equal(await pc.create('Health', 'blood tests', 'A second copy'), 'Private notes/Health/Blood tests.md', 'same name, any capitals: the one note');
  assert.equal(pc.list().length, 1, 'still one note, no "Blood tests 1"');
  assert.equal(pc.read('Health/Blood tests'), 'Iron is low.', 'the first words kept, not overwritten');
  assert.equal(await pc.create('', 'Blood tests', 'Root one'), 'Private notes/Blood tests.md', 'a different folder is a different note');
  assert.equal(pc.list().length, 2);
});

test('without Windows Hello: the recovery password alone', async () => {
  const vault = path.join(work, 'vault-2');
  const pc = new M.PrivateNotes({ root: () => vault, hello: null, device: { id: 'pc', name: 'pc' }, lockAfter: () => 0, onLocked: () => {}, trash: async () => {} });
  const s = await pc.setUp('just a password here', true);
  assert.deepEqual([s.hello, s.thisPc, s.unlocked], [false, false, true], 'asked for Hello, set up without it');
  pc.lock();
  await assert.rejects(() => pc.unlockWithHello(), /hasn’t been added yet/);
  await pc.unlockWithPassword('just a password here');
  assert.deepEqual(pc.list(), []);
});
