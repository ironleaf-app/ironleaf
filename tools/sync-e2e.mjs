#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Ironleaf Sync end to end against a real sync server (docs/SYNC.md): two made-up vaults in temp folders, two PCs
// (two engines with their own state), over HTTP with an account's bearer token. Never point it at real notes.
//   node tools/sync-e2e.mjs <api base, e.g. http://127.0.0.1:8790/api/v1> <token>   (or IRONLEAF_SYNC_E2E_TOKEN)
// It makes a new sync vault on that account, checks the two vaults converge through edits on both, the same note
// edited at once (a conflict copy), a rename, a delete, a 9 MB file in chunks and the long poll, then removes its
// temp folders. Prints counts, never file contents.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [base, tokenArg] = process.argv.slice(2);
const token = tokenArg ?? process.env.IRONLEAF_SYNC_E2E_TOKEN;
if (!base || !token) {
  console.error('usage: node tools/sync-e2e.mjs <api base> <token>');
  process.exit(2);
}
const work = mkdtempSync(path.join(tmpdir(), 'ironleaf-sync-e2e-'));
const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
const entry = path.join(work, 'entry.ts');
writeFileSync(entry, ['crypto.ts', 'protocol.ts', 'local.ts', 'engine.ts'].map((f) => `export * from ${JSON.stringify(path.join(root, 'src', 'main', 'sync', f))};`).join('\n'));
await build({ input: entry, platform: 'node', output: { file: path.join(work, 'sync.mjs'), format: 'esm' }, logLevel: 'silent' });
const S = await import(pathToFileURL(path.join(work, 'sync.mjs')).href);

const write = (file, data) => (mkdirSync(path.dirname(file), { recursive: true }), writeFileSync(file, data));
const walk = (dir, rel = '') => readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(dir, rel ? `${rel}/${e.name}` : e.name) : [rel ? `${rel}/${e.name}` : e.name]));
const tree = (dir) => Object.fromEntries(walk(dir).sort().map((r) => [r, createHash('sha256').update(readFileSync(path.join(dir, r))).digest('hex')]));
const until = async (what, fn, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};
const step = (m) => console.log(`ok - ${m}`);

function pc(name, keys) {
  const dir = path.join(work, name);
  mkdirSync(dir);
  const api = new S.HttpSyncApi(base, async () => token);
  const device = { id: randomUUID(), name };
  const engine = new S.SyncEngine({
    api,
    keys,
    root: dir,
    device,
    writer: new S.FsWriter(dir, { deviceName: name, trash: async (abs) => rmSync(abs) }),
    store: new S.FileStateStore(path.join(work, `state-${name}.json`)),
    excluded: () => [],
  });
  const runner = new S.SyncRunner({ engine, api, vaultId: keys.vaultId, deviceId: device.id, wait: 10, debounceMs: 200 });
  return { dir, api, engine, runner, device, file: (rel) => path.join(dir, ...rel.split('/')) };
}

try {
  // PC one makes the sync vault; PC two joins with the passphrase from the envelope on the server.
  const api = new S.HttpSyncApi(base, async () => token);
  const made = await S.createEnvelope('made-up passphrase for e2e');
  const { id } = await api.createVault(JSON.stringify(made.envelope));
  const keysA = new S.VaultKeys(made.vaultKey, id);
  const info = await api.vault(id);
  const keysB = new S.VaultKeys(await S.openWithPassphrase(S.parseEnvelope(info.envelope), 'made-up passphrase for e2e'), id);
  step('vault made on one PC, joined on the other with the passphrase');
  const a = pc('DESK', keysA);
  const b = pc('LAPTOP', keysB);
  for (const p of [a, b]) await api.addDevice(id, p.device.id, keysA.sealDeviceName(p.device.id, p.device.name));

  write(a.file('Projects/Trip to Hobart.md'), '# Trip to Hobart\nFerry at 9.\n');
  write(a.file('Daily/2026-11-20.md'), 'Walked the dog.\n');
  write(a.file('.neuralvault/settings.json'), '{"theme":"dark"}');
  write(b.file('Ideas/Garden.md'), '# Garden\nTomatoes.\n');
  await a.engine.sync();
  await b.engine.sync();
  await a.engine.sync();
  assert.deepEqual(tree(a.dir), tree(b.dir));
  step(`first sync: both PCs hold the same ${walk(a.dir).length} files`);

  a.runner.start();
  b.runner.start();
  write(a.file('Shared.md'), 'from the desk\n');
  a.runner.kick();
  await until('the laptop gets the desk’s note through the long poll', () => existsSync(b.file('Shared.md')));
  step('a new note on one PC reached the other through the long poll');

  await a.runner.stop();
  await b.runner.stop();
  write(a.file('Shared.md'), 'desk edit\n');
  write(b.file('Shared.md'), 'laptop edit\n');
  mkdirSync(a.file('Archive'), { recursive: true });
  renameSync(a.file('Ideas/Garden.md'), a.file('Archive/Garden.md'));
  rmSync(b.file('Daily/2026-11-20.md'));
  const big = randomBytes(9 * 1024 * 1024 + 7);
  write(b.file('Recordings/meeting.webm'), big);
  await a.engine.sync();
  const rb = await b.engine.sync();
  await a.engine.sync();
  assert.deepEqual(tree(a.dir), tree(b.dir));
  assert.equal(rb.conflicts, 1);
  const copy = walk(a.dir).find((f) => f.includes('(conflict'));
  assert.ok(copy && readFileSync(a.file(copy), 'utf8') === 'laptop edit\n');
  assert.equal(readFileSync(b.file('Shared.md'), 'utf8'), 'desk edit\n');
  assert.ok(existsSync(b.file('Archive/Garden.md')) && !existsSync(b.file('Ideas/Garden.md')));
  assert.ok(!existsSync(a.file('Daily/2026-11-20.md')));
  assert.ok(readFileSync(a.file('Recordings/meeting.webm')).equals(big));
  step('edits on both PCs at once converged: conflict copy kept, rename moved, delete carried, 9 MB file in 3 chunks');

  const devices = await api.devices(id);
  assert.deepEqual(devices.map((d) => keysA.openDeviceName(d.device, d.name)).sort(), ['DESK', 'LAPTOP']);
  const usage = (await api.vault(id)).usage;
  console.log(`# server: ${usage.bytes} bytes stored, ${usage.devices} PCs, head ${(await api.vault(id)).head}`);
  step('devices listed with names only this PC can read');
} finally {
  rmSync(work, { recursive: true, force: true });
}
