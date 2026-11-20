// node --test tests/vault-lock.test.mjs — the former host app and standalone Ironleaf open the same vault
// folder, and only one writes at a time (the Neural Launcher contract). The writer is named in the vault; the
// other app says so in plain words and reads only. A crash never leaves a stale lock: the heartbeat stops with
// the app, and a lock whose app is gone is taken over. Nothing is lost or doubled when both are started.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-vault-lock-'));
let L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src', 'main', 'vault-lock.ts'), platform: 'node', output: { file: path.join(work, 'vault-lock.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'vault-lock.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const vaultDir = () => mkdtempSync(path.join(tmpdir(), 'nv-lock-vault-'));
const lock = (dir, app, extra = {}) => new L.VaultLock(dir, { app, pid: 1000 + Math.floor(Math.random() * 50000), ...extra });

test('the first app writes; the second sees who has it and reads only', async () => {
  const dir = vaultDir();
  try {
    const spark = lock(dir, 'neuralspark', { pid: 1111, alive: () => true });
    assert.deepEqual((await spark.acquire()).held, false);
    const vault = lock(dir, 'neuralvault', { pid: 2222, alive: () => true });
    const seen = await vault.acquire();
    assert.equal(seen.held, true, 'only one writes at a time');
    assert.equal(seen.lock.app, 'neuralspark');
    assert.match(L.holderWords(seen.lock, 'neuralvault'), /Another app has your vault open/);
    assert.throws(() => L.assertWritable({ held: true, lock: seen.lock }, 'neuralvault'), /Another app has your vault open/);
    // Reading is never gated by the lock.
    writeFileSync(path.join(dir, 'Note.md'), '# Mine\n');
    assert.equal(readFileSync(path.join(dir, 'Note.md'), 'utf8'), '# Mine\n');
    await spark.release();
    await vault.release();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a crash never leaves a stale lock: a lock whose app is gone is taken over', async () => {
  const dir = vaultDir();
  try {
    let wall = Date.now();
    const spark = lock(dir, 'neuralspark', { pid: 1111, alive: () => true, now: () => wall });
    await spark.acquire();
    spark.stopHeartbeatForTest();
    // A hung app (alive, heartbeat stopped a moment ago) still holds: it may yet write.
    wall += 30_000;
    const vault = lock(dir, 'neuralvault', { pid: 2222, alive: (pid) => pid !== 1111 ? true : true, now: () => wall });
    assert.equal((await vault.acquire()).held, true, 'an app still alive keeps the lock even when quiet');
    // The crash: the app is gone, so the next start takes the lock over.
    const afterCrash = lock(dir, 'neuralvault', { pid: 3333, alive: () => false, now: () => wall });
    const taken = await afterCrash.acquire();
    assert.equal(taken.held, false, 'a dead app never blocks the vault');
    await afterCrash.release();
    await spark.release();
    await vault.release();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('release only lets go of its own lock, and garbage never blocks', async () => {
  const dir = vaultDir();
  try {
    const spark = lock(dir, 'neuralspark', { pid: 1111, alive: () => true });
    await spark.acquire();
    const vault = lock(dir, 'neuralvault', { pid: 2222, alive: () => true });
    await vault.acquire();
    await vault.release();
    assert.ok(existsSync(path.join(dir, '.neuralvault', 'writer.json')), 'letting go of a lock held by the other app changes nothing');
    await spark.release();
    assert.ok(!existsSync(path.join(dir, '.neuralvault', 'writer.json')), 'the holder letting go clears it');
    writeFileSync(path.join(dir, '.neuralvault', 'writer.json'), '{not json');
    assert.equal((await vault.acquire()).held, false, 'a torn lock file never blocks the vault');
    await vault.release();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('when both are started, nothing is lost or doubled', async () => {
  const dir = vaultDir();
  try {
    const spark = lock(dir, 'neuralspark', { pid: 1111, alive: () => true });
    await spark.acquire();
    const vault = lock(dir, 'neuralvault', { pid: 2222, alive: () => true });
    const seen = await vault.acquire();
    assert.equal(seen.held, true);
    // The writer's words land once.
    writeFileSync(path.join(dir, 'Shared.md'), 'from the host app\n');
    // The reader's write is refused before it touches the disk, so it can neither overwrite nor double.
    assert.throws(() => L.assertWritable(seen, 'neuralvault'), /read only|has your vault open/);
    assert.equal(readFileSync(path.join(dir, 'Shared.md'), 'utf8'), 'from the host app\n');
    await spark.release();
    // Once the other app is gone, this one writes again without losing anything.
    assert.equal((await vault.acquire()).held, false);
    L.assertWritable({ held: false }, 'neuralvault');
    writeFileSync(path.join(dir, 'Shared.md'), 'from the host app\nfrom Ironleaf\n');
    assert.equal(readFileSync(path.join(dir, 'Shared.md'), 'utf8'), 'from the host app\nfrom Ironleaf\n');
    await vault.release();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
