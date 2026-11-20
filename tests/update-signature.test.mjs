// SPDX-License-Identifier: AGPL-3.0-or-later
// node --test tests/update-signature.test.mjs — latest.json is trusted only with its signature (src/main/update-check.ts,
// tools/update-sign.mjs): a good signature reads the release; a changed latest.json, another key's signature or no
// signature reads nothing; a build whose key is the placeholder reads unsigned (development). Throwaway keys only.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-upsig-'));
let U, S;
const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
};
const K = pair();
const OTHER = pair();
const LATEST = JSON.stringify({ version: '9.0.0', date: '2026-11-20', notes: 'n', linux: { file: 'Ironleaf.AppImage', size: 1, sha256: 'a'.repeat(64) } }, null, 2) + '\n';

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/main/update-check.ts'), platform: 'node', external: ['electron'], output: { file: path.join(work, 'u.mjs'), format: 'esm', inlineDynamicImports: true }, logLevel: 'silent' });
  U = await import(pathToFileURL(path.join(work, 'u.mjs')).href);
  S = await import(pathToFileURL(path.join(root, 'tools/update-sign.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const checker = (files, key) => {
  const asked = [];
  const c = new U.UpdateChecker({
    current: '2.0.0', platform: 'linux', latestUrl: 'http://127.0.0.1:1/download/latest.json', origin: 'http://127.0.0.1:1',
    fetch: async (url) => (asked.push(url), files[url.split('/').pop()] !== undefined ? { ok: true, status: 200, text: async () => files[url.split('/').pop()] } : { ok: false, status: 404, text: async () => '' }),
    readState: async () => null, writeState: async () => {}, openExternal: () => {},
    ...(key !== undefined ? { updateKeyPem: key } : {}),
  });
  return { c, asked };
};

test('the release script\'s signature is the one the app checks', async () => {
  const sig = await S.signLatest(LATEST, K.priv);
  assert.equal(await S.verifyLatest(LATEST, sig, K.pub), true);
  assert.equal(await U.verifyLatestSignature(LATEST, sig, K.pub), true);
  assert.equal(await U.verifyLatestSignature(LATEST.replace('9.0.0', '9.0.1'), sig, K.pub), false, 'a changed latest.json');
  assert.equal(await U.verifyLatestSignature(LATEST, await S.signLatest(LATEST, OTHER.priv), K.pub), false, 'another key');
  assert.equal(await U.verifyLatestSignature(LATEST, 'garbage', K.pub), false);
});

test('with a key, a release is read only with a matching latest.json.sig', async () => {
  const sig = await S.signLatest(LATEST, K.priv);
  const good = checker({ 'latest.json': LATEST, 'latest.json.sig': sig }, K.pub);
  assert.equal((await good.c.check(true)).available?.version, '9.0.0');
  assert.ok(good.asked.some((u) => u.endsWith('latest.json.sig')));
  const tampered = checker({ 'latest.json': LATEST.replace('"a', '"b'), 'latest.json.sig': sig }, K.pub);
  assert.equal((await tampered.c.check(true)).available, null);
  const missing = checker({ 'latest.json': LATEST }, K.pub);
  assert.equal((await missing.c.check(true)).available, null);
  const forged = checker({ 'latest.json': LATEST, 'latest.json.sig': await S.signLatest(LATEST, OTHER.priv) }, K.pub);
  assert.equal((await forged.c.check(true)).available, null);
});

test('the release key is embedded: an unsigned latest.json is not read, and it matches the release tooling', async () => {
  assert.match(U.UPDATE_PUBLIC_KEY_PEM, /^-----BEGIN PUBLIC KEY-----/);
  assert.ok(!/PRIVATE/.test(U.UPDATE_PUBLIC_KEY_PEM), 'only the public half is in the code');
  assert.equal(S.embeddedUpdateKey().trim(), U.UPDATE_PUBLIC_KEY_PEM.trim());
  const unsigned = checker({ 'latest.json': LATEST }, U.UPDATE_PUBLIC_KEY_PEM);
  assert.equal((await unsigned.c.check(true)).available, null);
});
