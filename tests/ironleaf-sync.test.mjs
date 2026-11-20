// node --test tests/ironleaf-sync.test.mjs — Ironleaf Sync's engine (docs/SYNC.md): keys and sealing (round trip,
// wrong passphrase, recovery key, tampering refused), and two PCs syncing made-up vaults through an in-memory server with
// the real one's rules: different and same files edited at once (converging, with a conflict copy), deletes and renames,
// a large file in chunks, an upload interrupted and resumed after a restart, selective sync, and a tampered blob refused.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-isync-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (f) => JSON.stringify(path.join(root, 'src', 'main', 'sync', f));
  writeFileSync(entry, ['crypto.ts', 'protocol.ts', 'local.ts', 'engine.ts', 'memory-api.ts'].map((f) => `export * from ${src(f)};`).join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'sync.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'sync.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const FAST = { N: 1 << 14, r: 8, p: 1 };
const write = (file, data) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
};
const walk = (dir, rel = '') =>
  readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, r) : [r];
  });
/** A vault's files and their fingerprints (what two PCs must agree on). */
const tree = (dir) => Object.fromEntries(walk(dir).sort().map((r) => [r, createHash('sha256').update(readFileSync(path.join(dir, r))).digest('hex')]));

let n = 0;
/** One PC: its vault folder, its engine over the shared server, what it put in the Bin and what it was told changed. */
function pc(server, keys, name, opts = {}) {
  const dir = opts.dir ?? mkdtempSync(path.join(work, `${name}-`));
  const binned = [];
  const told = { wrote: [], moves: [] };
  const stateFile = opts.stateFile ?? path.join(work, `state-${name}-${++n}.json`);
  const excluded = opts.excluded ?? [];
  const make = (api = server.api()) =>
    new S.SyncEngine({
      api,
      keys,
      root: dir,
      device: { id: `dev-${name}`, name },
      writer: new S.FsWriter(dir, { deviceName: name, trash: async (abs, rel) => (binned.push(rel), rmSync(abs)), now: () => Date.UTC(2026, 10, 20, 4, 42) }),
      store: new S.FileStateStore(stateFile),
      excluded: () => excluded,
      applied: (wrote, moves) => (told.wrote.push(...wrote), told.moves.push(...moves)),
      ...(opts.resolve ? { resolve: opts.resolve, keepAside: S.asideIn(path.join(work, `aside-${name}-${n}`)) } : {}),
      log: () => {},
    });
  return { dir, binned, told, excluded, stateFile, engine: make(), make, file: (rel) => path.join(dir, ...rel.split('/')) };
}

async function newVault(server) {
  const { vaultKey, envelope } = await S.createEnvelope('correct horse battery', FAST);
  const { id } = await server.api().createVault(JSON.stringify(envelope));
  return new S.VaultKeys(vaultKey, id);
}

test('keys: the envelope opens with the passphrase or the recovery key, never a wrong one; a new passphrase keeps the key', async () => {
  const { vaultKey, envelope, recovery } = await S.createEnvelope('correct horse battery', FAST);
  assert.match(recovery, /^([A-Z2-9]{4}-){12}[A-Z2-9]{4}$/);
  const e = S.parseEnvelope(JSON.stringify(envelope));
  assert.ok((await S.openWithPassphrase(e, 'correct horse battery')).equals(vaultKey));
  await assert.rejects(S.openWithPassphrase(e, 'correct horse battery!'), S.WrongKey);
  assert.ok(S.openWithRecovery(e, recovery.toLowerCase().replace(/-/g, ' ')).equals(vaultKey));
  assert.throws(() => S.openWithRecovery(e, recovery.replace(/^A|^./, (c) => (c === 'B' ? 'C' : 'B'))), S.WrongKey);
  const e2 = await S.rewrapEnvelope(e, vaultKey, 'a brand new passphrase', FAST);
  await assert.rejects(S.openWithPassphrase(e2, 'correct horse battery'), S.WrongKey);
  assert.ok((await S.openWithPassphrase(e2, 'a brand new passphrase')).equals(vaultKey));
  assert.ok(S.openWithRecovery(e2, recovery).equals(vaultKey));
  await assert.rejects(S.createEnvelope('short', FAST), /at least/);
  // Strong settings by default.
  assert.deepEqual(S.SCRYPT_STRONG, { N: 131072, r: 8, p: 1 });
});

test('sealing: round trip; a flipped byte, a swapped slot or a chunk out of place is refused', () => {
  const k = new S.VaultKeys(randomBytes(32), 'v1');
  const id = 'file-1';
  const fk = k.fileKey(id);
  const plain = Buffer.from('# Plans\nA made-up note.');
  const sealed = k.sealChunk(fk, id, 0, plain);
  assert.equal(sealed.length, plain.length + S.SEAL_OVERHEAD);
  assert.ok(k.openChunk(fk, id, 0, sealed).equals(plain));
  const flipped = Buffer.from(sealed);
  flipped[20] ^= 1;
  assert.throws(() => k.openChunk(fk, id, 0, flipped), S.Tampered);
  assert.throws(() => k.openChunk(fk, id, 1, sealed), S.Tampered);
  assert.throws(() => k.openChunk(k.fileKey('file-2'), 'file-2', 0, sealed), S.Tampered);
  const slot = k.slot('Plans.md');
  assert.equal(slot, k.slot('plans.md'));
  assert.notEqual(slot, new S.VaultKeys(randomBytes(32), 'v1').slot('Plans.md'));
  const meta = k.sealMeta(slot, { v: 1, path: 'Plans.md' });
  assert.deepEqual(k.openMeta(slot, meta), { v: 1, path: 'Plans.md' });
  assert.throws(() => k.openMeta(k.slot('Other.md'), meta), S.Tampered);
  assert.throws(() => new S.VaultKeys(randomBytes(32), 'v2').openMeta(slot, meta), S.Tampered);
  assert.equal(k.openDeviceName('d1', k.sealDeviceName('d1', 'LAPTOP')), 'LAPTOP');
  assert.equal(k.openDeviceName('d2', k.sealDeviceName('d1', 'LAPTOP')), 'Unknown PC');
});

test('two PCs: notes, attachments and config arrive; the server holds no names or words', async () => {
  const server = new S.MemoryServer();
  const keys = await newVault(server);
  const a = pc(server, keys, 'DESK');
  write(a.file('Projects/Trip to Hobart.md'), '# Trip to Hobart\nFerry at 9.\n');
  write(a.file('Daily/2026-11-20.md'), 'Walked the dog.\n');
  write(a.file('Assets/map.png'), randomBytes(5000));
  write(a.file('.neuralvault/settings.json'), '{"theme":"dark"}');
  write(a.file('.neuralvault/writer.json'), '{"pc":"DESK"}');
  write(a.file('.git/HEAD'), 'ref: refs/heads/main');
  write(a.file('Draft.md.abc123.nvtmp'), 'half');
  const r = await a.engine.sync();
  assert.equal(r.pushed, 4);
  const b = pc(server, keys, 'LAPTOP');
  await b.engine.sync();
  const carried = Object.fromEntries(Object.entries(tree(a.dir)).filter(([k]) => !/writer\.json|\.git\/|nvtmp/.test(k)));
  assert.equal(Object.keys(carried).length, 4);
  assert.deepEqual(tree(b.dir), carried);
  assert.ok(b.told.wrote.includes('Projects/Trip to Hobart.md'));
  const v = server.vaults.get(keys.vaultId);
  const everything = Buffer.concat([...v.blobs.values()].map((x) => Buffer.from(x)).concat(v.log.map((c) => Buffer.from(JSON.stringify(c)))));
  for (const secret of ['Hobart', 'Ferry', 'Daily', 'settings.json', 'map.png', 'theme', 'Walked']) assert.equal(everything.includes(secret), false, secret);
  // Nothing more to do on either side.
  assert.equal((await a.engine.sync()).pushed, 0);
  assert.equal((await b.engine.sync()).pushed, 0);
});

test('edits at once: different files merge; the same file converges with a conflict copy, nothing lost', async () => {
  const server = new S.MemoryServer();
  const keys = await newVault(server);
  const a = pc(server, keys, 'DESK');
  const b = pc(server, keys, 'LAPTOP');
  write(a.file('Shared.md'), 'v1\n');
  write(a.file('A only.md'), 'a1\n');
  write(a.file('B only.md'), 'b1\n');
  await a.engine.sync();
  await b.engine.sync();
  write(a.file('A only.md'), 'a2 from desk\n');
  write(b.file('B only.md'), 'b2 from laptop\n');
  write(a.file('Shared.md'), 'v2 from desk\n');
  write(b.file('Shared.md'), 'v2 from laptop\n');
  await a.engine.sync();
  const rb = await b.engine.sync();
  await a.engine.sync();
  assert.equal(rb.conflicts, 1);
  assert.deepEqual(tree(a.dir), tree(b.dir));
  const files = walk(a.dir).sort();
  const copy = files.find((f) => f.includes('(conflict'));
  assert.equal(copy, 'Shared (conflict, 20 Nov 2026 3.42 pm, from LAPTOP).md');
  assert.equal(readFileSync(a.file('Shared.md'), 'utf8'), 'v2 from desk\n');
  assert.equal(readFileSync(a.file(copy), 'utf8'), 'v2 from laptop\n');
  assert.equal(readFileSync(a.file('A only.md'), 'utf8'), 'a2 from desk\n');
  assert.equal(readFileSync(a.file('B only.md'), 'utf8'), 'b2 from laptop\n');
  // The same new file made on both before they first met: one wins the name, the other is a copy (same bytes: agreed).
  write(a.file('New.md'), 'same words\n');
  write(b.file('New.md'), 'same words\n');
  write(a.file('Clash.md'), 'desk words\n');
  write(b.file('Clash.md'), 'laptop words\n');
  await a.engine.sync();
  await b.engine.sync();
  await a.engine.sync();
  assert.deepEqual(tree(a.dir), tree(b.dir));
  assert.equal(walk(a.dir).filter((f) => f.startsWith('New')).length, 1);
  assert.equal(walk(a.dir).filter((f) => f.startsWith('Clash')).length, 2);
});

test('deletes go to the Bin on the other PC; renames move the file there; an edit beats a delete', async () => {
  const server = new S.MemoryServer();
  const keys = await newVault(server);
  const a = pc(server, keys, 'DESK');
  const b = pc(server, keys, 'LAPTOP');
  write(a.file('Old name.md'), 'keep me\n');
  write(a.file('Gone.md'), 'bye\n');
  write(a.file('Contested.md'), 'one\n');
  await a.engine.sync();
  await b.engine.sync();
  mkdirSync(a.file('Folder'));
  renameSync(a.file('Old name.md'), a.file('Folder/New name.md'));
  rmSync(a.file('Gone.md'));
  rmSync(a.file('Contested.md'));
  write(b.file('Contested.md'), 'two, edited on the laptop\n');
  await a.engine.sync();
  await b.engine.sync();
  await a.engine.sync();
  assert.deepEqual(b.told.moves, [['Old name.md', 'Folder/New name.md']]);
  assert.deepEqual(b.binned, ['Gone.md']);
  assert.equal(existsSync(b.file('Old name.md')), false);
  assert.equal(readFileSync(b.file('Folder/New name.md'), 'utf8'), 'keep me\n');
  // The laptop's edit survived the desk's delete and came back to the desk.
  assert.equal(readFileSync(a.file('Contested.md'), 'utf8'), 'two, edited on the laptop\n');
  assert.deepEqual(tree(a.dir), tree(b.dir));
  // The rename kept the file's id on the server (one add, one tombstone with the same id).
  const v = server.vaults.get(keys.vaultId);
  const metas = v.log.map((c) => keys.openMeta(c.slot, c.meta));
  const moved = metas.filter((m) => m.path === 'Folder/New name.md' || m.path === 'Old name.md');
  assert.equal(new Set(moved.map((m) => m.id)).size, 1);
  assert.ok(moved.some((m) => m.deleted && m.to === 'Folder/New name.md'));
});

test('a large file goes up in 4 MiB chunks, and an interrupted upload resumes after a restart without resending', async () => {
  const server = new S.MemoryServer();
  const keys = await newVault(server);
  const a = pc(server, keys, 'DESK');
  const big = randomBytes(9 * 1024 * 1024 + 123);
  write(a.file('Recordings/meeting.webm'), big);
  // The second chunk's upload fails (the connection drops); the first is on the server.
  let calls = 0;
  const flaky = server.api();
  const put = flaky.putBlob;
  flaky.putBlob = async (...args) => {
    if (++calls === 2) throw new S.SyncHttpError(503, 'unavailable');
    return put(...args);
  };
  const first = await a.make(flaky).sync();
  assert.equal(first.pushed, 0);
  assert.equal(first.waiting, 1);
  assert.equal(server.puts, 1);
  // Ironleaf restarts: a new engine from the saved state picks the upload up again.
  const again = await a.make().sync();
  assert.equal(again.pushed, 1);
  assert.equal(server.puts, 3, 'only the two chunks not on the server were sent');
  const v = server.vaults.get(keys.vaultId);
  assert.equal(v.blobs.size, 3);
  const meta = keys.openMeta(v.log[0].slot, v.log[0].meta);
  assert.deepEqual(meta.chunks.map((c) => c.n), [4194304, 4194304, 1048699]);
  const b = pc(server, keys, 'LAPTOP');
  await b.engine.sync();
  assert.ok(readFileSync(b.file('Recordings/meeting.webm')).equals(big));
});

test('selective sync: an excluded folder is neither fetched nor deleted anywhere, and arrives when included again', async () => {
  const server = new S.MemoryServer();
  const keys = await newVault(server);
  const a = pc(server, keys, 'DESK');
  write(a.file('Videos/a.mp4'), randomBytes(2000));
  write(a.file('Notes/n.md'), 'n\n');
  await a.engine.sync();
  const b = pc(server, keys, 'LAPTOP', { excluded: ['videos'] });
  write(b.file('Videos/local only.mp4'), randomBytes(100));
  await b.engine.sync();
  assert.equal(existsSync(b.file('Videos/a.mp4')), false);
  assert.ok(existsSync(b.file('Notes/n.md')));
  await a.engine.sync();
  assert.equal(existsSync(a.file('Videos/local only.mp4')), false, 'the laptop never sent its excluded folder');
  assert.ok(existsSync(a.file('Videos/a.mp4')), 'nor deleted the desk’s');
  b.excluded.length = 0;
  await b.engine.sync();
  assert.ok(existsSync(b.file('Videos/a.mp4')));
  await a.engine.sync();
  assert.ok(existsSync(a.file('Videos/local only.mp4')));
  assert.deepEqual(tree(a.dir), tree(b.dir));
});

test('a tampered blob is refused: nothing written, the change stays queued and lands once the server is right again', async () => {
  const server = new S.MemoryServer();
  const keys = await newVault(server);
  const a = pc(server, keys, 'DESK');
  write(a.file('Note.md'), 'the real words\n');
  await a.engine.sync();
  const v = server.vaults.get(keys.vaultId);
  const [hash] = [...v.blobs.keys()];
  const good = v.blobs.get(hash);
  const bad = Uint8Array.from(good);
  bad[bad.length - 1] ^= 1;
  v.blobs.set(hash, bad);
  const b = pc(server, keys, 'LAPTOP');
  await b.engine.sync();
  assert.equal(existsSync(b.file('Note.md')), false);
  assert.equal(b.engine.state.journal.remote.length, 1);
  v.blobs.set(hash, good);
  await b.engine.sync();
  assert.equal(readFileSync(b.file('Note.md'), 'utf8'), 'the real words\n');
  assert.equal(b.engine.state.journal.remote.length, 0);
  // A change whose metadata was swapped onto another slot is never applied.
  const forged = { ...v.log[0], seq: 99, slot: keys.slot('Elsewhere.md') };
  v.log.push(forged);
  await b.engine.sync();
  assert.equal(existsSync(b.file('Elsewhere.md')), false);
  assert.equal(b.engine.rejected, 1);
});

test('quota: a full store refuses the upload; the file stays waiting and goes up once there is room', async () => {
  const server = new S.MemoryServer();
  server.quota = 1000;
  const keys = await newVault(server);
  const a = pc(server, keys, 'DESK');
  write(a.file('small.md'), 'fits\n');
  write(a.file('big.bin'), randomBytes(5000));
  await assert.rejects(a.engine.sync(), (e) => e.code === 'quota');
  server.quota = 1e6;
  const r = await a.engine.sync();
  assert.equal(r.waiting, 0);
  assert.equal(server.vaults.get(keys.vaultId).log.length, 2);
});

test('the runner: a kick syncs after the debounce, the long poll brings the other PC’s change, pause holds it', async () => {
  const server = new S.MemoryServer();
  const keys = await newVault(server);
  const a = pc(server, keys, 'DESK');
  const b = pc(server, keys, 'LAPTOP');
  const runA = new S.SyncRunner({ engine: a.engine, api: server.api(), vaultId: keys.vaultId, deviceId: 'dev-DESK', wait: 5, debounceMs: 50 });
  const runB = new S.SyncRunner({ engine: b.engine, api: server.api(), vaultId: keys.vaultId, deviceId: 'dev-LAPTOP', wait: 5, debounceMs: 50 });
  runA.start();
  runB.start();
  const until = async (fn, ms = 4000) => {
    const end = Date.now() + ms;
    while (!fn()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  write(a.file('Live.md'), 'typed on the desk\n');
  runA.kick();
  await until(() => existsSync(b.file('Live.md')));
  runB.pause();
  write(a.file('Later.md'), 'while paused\n');
  runA.kick();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(existsSync(b.file('Later.md')), false);
  runB.resume();
  await until(() => existsSync(b.file('Later.md')));
  await runA.stop();
  await runB.stop();
});

test('config changed on both PCs: the app merges what it can (no copy), and takes the server’s identity with this PC’s to the Bin', async () => {
  const server = new S.MemoryServer();
  const keys = await newVault(server);
  // The app's rule (service.ts resolveConfig), with a stand-in merge: the union of two JSON objects' keys.
  const resolve = async (rel, mine, theirs) => {
    if (!rel.startsWith('.neuralvault/')) return null;
    if (rel.startsWith('.neuralvault/state/')) return { bytes: Buffer.from(JSON.stringify({ ...JSON.parse(theirs), ...JSON.parse(mine) })) };
    return 'theirs';
  };
  const a = pc(server, keys, 'DESK', { resolve });
  const b = pc(server, keys, 'LAPTOP', { resolve });
  // Two vaults made on their own before they were joined: each has its identity and state.
  write(a.file('.neuralvault/vault.json'), '{"id":"desk-vault"}');
  write(b.file('.neuralvault/vault.json'), '{"id":"laptop-vault"}');
  write(a.file('.neuralvault/state/templates.json'), '{"daily":1}');
  write(b.file('.neuralvault/state/templates.json'), '{"weekly":1}');
  await a.engine.sync();
  const rb = await b.engine.sync();
  await a.engine.sync();
  assert.equal(rb.conflicts, 0);
  assert.deepEqual(tree(a.dir), tree(b.dir));
  assert.equal(readFileSync(b.file('.neuralvault/vault.json'), 'utf8'), '{"id":"desk-vault"}');
  assert.deepEqual(JSON.parse(readFileSync(a.file('.neuralvault/state/templates.json'), 'utf8')), { daily: 1, weekly: 1 });
  assert.equal(walk(a.dir).filter((f) => f.includes('conflict')).length, 0);
  // The laptop's own identity was kept aside in Ironleaf's data, not in the vault and not lost.
  const aside = readdirSync(work).find((d) => d.startsWith('aside-LAPTOP-'));
  const kept = readdirSync(path.join(work, aside)).filter((f) => f.endsWith('.bin'));
  assert.equal(kept.length, 1);
  assert.equal(readFileSync(path.join(work, aside, kept[0]), 'utf8'), '{"id":"laptop-vault"}');
  assert.match(readFileSync(path.join(work, aside, 'index.txt'), 'utf8'), /\t\.neuralvault\/vault\.json\n$/);
});

test('a conflict whose server version can’t be fetched yet makes no copy; when it can, exactly one', async () => {
  const server = new S.MemoryServer();
  const keys = await newVault(server);
  const a = pc(server, keys, 'DESK');
  const b = pc(server, keys, 'LAPTOP');
  write(a.file('Plan.md'), 'v1\n');
  await a.engine.sync();
  await b.engine.sync();
  write(a.file('Plan.md'), 'desk v2\n');
  write(b.file('Plan.md'), 'laptop v2\n');
  await a.engine.sync();
  const v = server.vaults.get(keys.vaultId);
  const hash = keys.openMeta(v.log.at(-1).slot, v.log.at(-1).meta).chunks[0].h;
  const good = v.blobs.get(hash);
  v.blobs.delete(hash);
  for (let i = 0; i < 3; i++) await b.engine.sync().catch(() => {});
  assert.equal(walk(b.dir).filter((f) => f.includes('conflict')).length, 0);
  assert.equal(readFileSync(b.file('Plan.md'), 'utf8'), 'laptop v2\n');
  v.blobs.set(hash, good);
  await b.engine.sync();
  await b.engine.sync();
  await a.engine.sync();
  assert.equal(walk(b.dir).filter((f) => f.includes('conflict')).length, 1);
  assert.deepEqual(tree(a.dir), tree(b.dir));
});
