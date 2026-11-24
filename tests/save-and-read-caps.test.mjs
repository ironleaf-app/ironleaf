// SPDX-License-Identifier: AGPL-3.0-or-later
// node --test tests/save-and-read-caps.test.mjs — the provider stores survive saves at the same moment, and the
// updater never reads an endless answer (20 Nov 2026, security review). provider-keys.bin (src/main/providers/keys.ts)
// and connections.json (src/main/providers/connections.ts) saved through one <file>.<pid>.tmp, so two saves at once
// failed with ENOENT and could leave half of each (the settings.json fix, commit 613ab31d): now they queue and each
// write has its own temp. latest.json, its .sig and the block map were read whole before their size was checked:
// now a declared length over the limit is refused unread and a body that runs past it is cancelled there
// (src/main/update-check.ts › readCapped). Real files in a temp folder; made-up keys and names only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-save-caps-'));
const appdata = path.join(work, 'appdata');
let M;

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const eDir = path.join(work, 'node_modules', 'electron');
  mkdirSync(eDir, { recursive: true });
  writeFileSync(path.join(eDir, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', type: 'module', main: './index.mjs', exports: { '.': './index.mjs' } }));
  // safeStorage stand-in: "encrypted" is the text reversed, enough to tell a whole file from a mixed one.
  writeFileSync(
    path.join(eDir, 'index.mjs'),
    `export const app = { getPath: () => ${JSON.stringify(appdata)} };\n` +
      `export const safeStorage = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async (s) => Buffer.from([...s].reverse().join('')), decryptStringAsync: async (b) => ({ result: [...b.toString()].reverse().join('') }) };\n`,
  );
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { KeyStore } from ${JSON.stringify(path.join(root, 'src/main/providers/keys.ts'))};`,
      `export { ConnectionStore } from ${JSON.stringify(path.join(root, 'src/main/providers/connections.ts'))};`,
      `export { readCapped } from ${JSON.stringify(path.join(root, 'src/main/update-check.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['electron'], output: { file: path.join(work, 'entry.mjs'), format: 'esm', inlineDynamicImports: true }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'entry.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('provider keys saved at once: no save fails, provider-keys.bin stays whole with every key, no temp left', async () => {
  const keys = new M.KeyStore();
  await keys.load();
  const all = [];
  for (let i = 0; i < 40; i++) all.push(keys.set(`conn-${i}`, `made-up-key-${i}-${'x'.repeat(i * 37)}`));
  const results = await Promise.allSettled(all);
  assert.deepEqual(results.filter((r) => r.status === 'rejected').map((r) => String(r.reason)), []);
  const again = new M.KeyStore();
  await again.load();
  for (let i = 0; i < 40; i++) assert.equal(again.get(`conn-${i}`), `made-up-key-${i}-${'x'.repeat(i * 37)}`);
  assert.deepEqual(readdirSync(appdata).filter((n) => n !== 'provider-keys.bin' && n !== 'connections.json'), [], 'no temp files left');
});

test('connections saved at once: no save fails, connections.json stays whole and current, no temp left', async () => {
  const dir = path.join(work, 'conns');
  const store = new M.ConnectionStore(dir);
  await store.load();
  const results = await Promise.allSettled(Array.from({ length: 30 }, (_v, i) => store.add({ kind: 'custom', name: `Made-up ${i}`, baseURL: `http://127.0.0.1:${9000 + i}/v1` })));
  assert.deepEqual(results.filter((r) => r.status === 'rejected').map((r) => String(r.reason)), []);
  const saved = JSON.parse(readFileSync(store.file, 'utf8'));
  assert.equal(saved.connections.length, 30, 'the last save wrote every connection');
  assert.deepEqual(readdirSync(dir), ['connections.json'], 'no temp files left');
});

test('readCapped: a declared length over the limit is refused unread; a body that runs on is cancelled at the limit', async () => {
  let pulled = 0;
  let cancelled = false;
  const endless = () =>
    new ReadableStream({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(16 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
  await assert.rejects(M.readCapped(new Response(endless()), 64 * 1024), /larger than 65536 bytes/);
  assert.ok(cancelled, 'the stream is cancelled');
  assert.ok(pulled <= 8, `stopped near the limit (pulled ${pulled} chunks)`);
  pulled = 0;
  cancelled = false;
  await assert.rejects(M.readCapped(new Response(endless(), { headers: { 'content-length': String(10 * 1024 * 1024) } }), 64 * 1024), /larger/);
  assert.ok(pulled <= 1, 'nothing read when the declared length is already too big');
  assert.equal((await M.readCapped(new Response('{"version":"2.0.0"}'), 64 * 1024)).toString('utf8'), '{"version":"2.0.0"}');
  assert.equal((await M.readCapped({ ok: true, status: 200, text: async () => 'stand-in' }, 64)).toString(), 'stand-in');
  // The updater reads latest.json, its signature, the block map and the ranges through it, never whole first.
  const src = readFileSync(path.join(root, 'src/main/update-check.ts'), 'utf8');
  assert.match(src, /const text = \(await readCapped\(res, MAX_LATEST_BYTES\)\)\.toString\('utf8'\);/);
  assert.match(src, /const sig = \(await readCapped\(sigRes, MAX_LATEST_BYTES \* 2\)\)\.toString\('utf8'\);/);
  assert.match(src, /const bytes = await readCapped\(res, Math\.min\(ref\.size, MAX_BLOCKMAP_BYTES\)\);/);
  assert.match(src, /const bytes = await readCapped\(res, end - start\);/);
  assert.equal(/await (res|sigRes)\.text\(\)/.test(src.slice(src.indexOf('export class UpdateChecker'))), false, 'no whole read of an answer left in the checker');
});
