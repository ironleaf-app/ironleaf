// node --test tests/os-protect.test.mjs — the operating system's protected store (src/main/os-protect.ts): the fixed
// Linux key is refused, a late yes is noticed, what is kept is never written over unread, and a lock or a sign-out that
// lands while something is being sealed wins. Made-up values only.
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-protect-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, ['os-protect', 'account/token-store', 'health-store'].map((f) => `export * from ${JSON.stringify(path.join(root, `src/main/${f}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm', inlineDynamicImports: true }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const fake = (mark, o = {}) => ({
  asked: 0,
  isAsyncEncryptionAvailable() { this.asked++; return Promise.resolve(o.can ? o.can() : true); },
  encryptStringAsync: async (t) => Buffer.concat([Buffer.from(o.mark ? o.mark() : mark), Buffer.from(t, 'utf8').map((b) => b ^ 0xff)]),
  decryptStringAsync: async (b) => ({ shouldReEncrypt: false, result: Buffer.from(b.subarray(3)).map((x) => x ^ 0xff).toString('utf8') }),
});

test('a Linux PC with no keyring keeps nothing: Chromium’s fixed key is not protection', async () => {
  const p = new P.OsProtect(() => fake('v10'), 'linux');
  assert.equal(await p.ready(), false);
  assert.equal(p.available(), false);
  await assert.rejects(p.seal('made-up'), /isn’t available/);
  const keyring = new P.OsProtect(() => fake('v11'), 'linux');
  assert.equal(await keyring.ready(), true);
  assert.equal(await keyring.open(await keyring.seal('made-up é')), 'made-up é');
  assert.equal(await new P.OsProtect(() => fake('v10'), 'win32').ready(), true, 'the same mark on Windows is the person’s own key');
  const checks = new P.OsProtect(() => fake('v10'), 'linux');
  checks.allowFixedKey();
  assert.equal(await checks.ready(), true, 'the end-to-end checks may');
});

test('the keyring going between asking and sealing is noticed, and a late yes too', async () => {
  let mark = 'v11';
  const p = new P.OsProtect(() => fake('', { mark: () => mark }), 'linux');
  assert.equal(await p.ready(), true);
  mark = 'v10';
  await assert.rejects(p.seal('made-up'), /isn’t available/);
  assert.equal(p.available(), false);
  let can = false;
  const s = fake('v10', { can: () => can });
  const late = new P.OsProtect(() => s, 'win32');
  assert.equal(await late.ready(), false);
  can = true;
  late.available();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(late.available(), true);
  const n = s.asked;
  await Promise.all([late.ready(), late.ready()]);
  assert.equal(s.asked, n, 'a yes is asked for once');
  const broken = new P.OsProtect(() => { throw new Error('no store'); }, 'win32');
  assert.equal(await broken.ready(), false, 'never throws');
});

const person = (t) => ({ tokens: { accessToken: t }, profile: { sub: 'made-up' } });
test('signing out while a save is being sealed ends signed out', async () => {
  const dir = mkdtempSync(path.join(work, 'out-'));
  let go;
  const gate = new Promise((r) => (go = r));
  const store = new P.TokenStore(dir, { available: () => true, seal: async (t) => (await gate, Buffer.from(t)), open: async (b) => b.toString() });
  const saving = store.save(person('a'));
  const out = store.clear();
  go();
  await Promise.all([saving, out]);
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(store.get(), null);
});

test('two saves at once keep the newer, and it opens again', async () => {
  const dir = mkdtempSync(path.join(work, 'two-'));
  let n = 0;
  const sealer = { available: () => true, seal: async (t) => (await new Promise((r) => setTimeout(r, n++ ? 0 : 30)), Buffer.from(t)), open: async (b) => b.toString() };
  const store = new P.TokenStore(dir, sealer);
  await Promise.all([store.save(person('older')), store.save(person('newer'))]);
  assert.equal((await new P.TokenStore(dir, sealer).load()).tokens.accessToken, 'newer');
});

test('the health store’s key is sealed and opened by a store that answers later', async () => {
  const dir = mkdtempSync(path.join(work, 'health-'));
  const os = new P.OsProtect(() => fake('v11'), 'linux');
  await os.ready();
  const protector = { available: () => os.available(), protect: (b) => os.seal(b.toString('utf8')), unprotect: async (b) => Buffer.from(await os.open(b), 'utf8') };
  const a = new P.HealthStore({ dir: () => dir, protector });
  await a.change((db) => db);
  const b = new P.HealthStore({ dir: () => dir, protector });
  await b.read();
  assert.equal((await b.status()).open, true);
  assert.ok(!(await b.status()).problem);
});

test('a kept file that can’t be opened is copied beside itself', async () => {
  const f = path.join(work, 'kept.bin');
  writeFileSync(f, 'unreadable');
  await P.keepUnread(f);
  assert.equal(readFileSync(`${f}.unread`, 'utf8'), 'unreadable');
  await P.keepUnread(path.join(work, 'none.bin'));
  assert.equal(existsSync(path.join(work, 'none.bin.unread')), false);
});

test('nothing in Ironleaf uses the methods Electron 46 takes away', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
  const used = walk(path.join(root, 'src')).filter((f) => /\bisEncryptionAvailable\(|\b(?:en|de)cryptString\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(used, []);
});
