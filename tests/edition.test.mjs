// SPDX-License-Identifier: AGPL-3.0-or-later
// node --test tests/edition.test.mjs — licence verification (src/main/edition.ts) and the issuer (tools/licence-issue.mjs):
// a good licence, an expired one, a bad signature, the wrong audience, a placeholder build that reads none, and the
// enterprise module's extension point (src/main/enterprise.ts). A throwaway Ed25519 keypair is made in a temp folder;
// no real key is used or kept.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-edition-'));
let E, X, issue, keys, other;
const DAY = 86400_000;

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as E from ${JSON.stringify(path.join(root, 'src/main/edition.ts'))};\nexport * as X from ${JSON.stringify(path.join(root, 'src/main/enterprise.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['electron'], output: { file: path.join(work, 'e.mjs'), format: 'esm', inlineDynamicImports: true }, logLevel: 'silent' });
  ({ E, X } = await import(pathToFileURL(path.join(work, 'e.mjs')).href));
  const tool = await import(pathToFileURL(path.join(root, 'tools/licence-issue.mjs')).href);
  issue = tool.issueLicence;
  keys = tool.generateKeypair(path.join(work, 'k1'));
  other = tool.generateKeypair(path.join(work, 'k2'));
});
after(() => rmSync(work, { recursive: true, force: true }));

const priv = (k) => readFileSync(k.privateFile, 'utf8');

test('a good licence gives its edition, organisation, seats and features', async () => {
  const token = await issue({ privateKeyPem: priv(keys), org: 'Acme Pty Ltd', seats: 25, edition: 'enterprise', features: ['sso', 'audit-export'], days: 30 });
  const e = await E.verifyLicence(token, { publicKeyPem: keys.publicPem });
  assert.equal(e.id, 'enterprise');
  assert.equal(e.licence.org, 'Acme Pty Ltd');
  assert.equal(e.licence.seats, 25);
  assert.deepEqual(e.licence.features, ['sso', 'audit-export']);
  assert.match(e.words, /Enterprise edition for Acme Pty Ltd, 25 seats/);
});

test('an expired licence falls back to community with a plain reason', async () => {
  const token = await issue({ privateKeyPem: priv(keys), org: 'Acme', seats: 5, edition: 'teams', days: 10, now: Date.now() - 20 * DAY });
  const e = await E.verifyLicence(token, { publicKeyPem: keys.publicPem });
  assert.equal(e.id, 'community');
  assert.equal(e.licence, null);
  assert.match(e.words, /expired/);
  assert.match(e.words, /every feature/);
});

test('a licence signed by another key is refused', async () => {
  const token = await issue({ privateKeyPem: priv(other), org: 'Forged', seats: 999, edition: 'enterprise', days: 30 });
  const e = await E.verifyLicence(token, { publicKeyPem: keys.publicPem });
  assert.equal(e.id, 'community');
  assert.match(e.words, /signature/);
  // A token edited after signing (seats raised) is refused too.
  const good = await issue({ privateKeyPem: priv(keys), org: 'Acme', seats: 5, edition: 'teams', days: 30 });
  const [h, p, s] = good.split('.');
  const body = JSON.parse(Buffer.from(p, 'base64url').toString());
  body.seats = 5000;
  const tampered = [h, Buffer.from(JSON.stringify(body)).toString('base64url'), s].join('.');
  assert.equal((await E.verifyLicence(tampered, { publicKeyPem: keys.publicPem })).id, 'community');
});

test('a token for another audience or issuer is refused', async () => {
  const { SignJWT, importPKCS8 } = await import(pathToFileURL(path.join(root, 'node_modules', 'jose', 'dist', 'webapi', 'index.js')).href);
  const key = await importPKCS8(priv(keys), 'EdDSA');
  const make = (iss, aud) => new SignJWT({ org: 'Acme', seats: 5, edition: 'teams', features: [] }).setProtectedHeader({ alg: 'EdDSA' }).setIssuer(iss).setAudience(aud).setExpirationTime('30d').sign(key);
  const wrongAud = await E.verifyLicence(await make(E.LICENCE_ISSUER, 'some-other-product'), { publicKeyPem: keys.publicPem });
  assert.equal(wrongAud.id, 'community');
  assert.match(wrongAud.words, /not for this product/);
  assert.equal((await E.verifyLicence(await make('https://example.invalid', E.LICENCE_AUDIENCE), { publicKeyPem: keys.publicPem })).id, 'community');
});

test('garbage and a missing edition are community; nothing throws', async () => {
  assert.equal((await E.verifyLicence('not a token', { publicKeyPem: keys.publicPem })).id, 'community');
  assert.equal((await E.verifyLicence('', { publicKeyPem: keys.publicPem })).id, 'community');
  const { SignJWT, importPKCS8 } = await import(pathToFileURL(path.join(root, 'node_modules', 'jose', 'dist', 'webapi', 'index.js')).href);
  const key = await importPKCS8(priv(keys), 'EdDSA');
  const t = await new SignJWT({ org: 'Acme', seats: 5, edition: 'platinum' }).setProtectedHeader({ alg: 'EdDSA' }).setIssuer(E.LICENCE_ISSUER).setAudience(E.LICENCE_AUDIENCE).setExpirationTime('30d').sign(key);
  assert.equal((await E.verifyLicence(t, { publicKeyPem: keys.publicPem })).id, 'community');
});

test('the release licence key is embedded: a licence signed with another key reads as community', async () => {
  assert.match(E.LICENCE_PUBLIC_KEY_PEM, /^-----BEGIN PUBLIC KEY-----/);
  assert.ok(!/PRIVATE/.test(E.LICENCE_PUBLIC_KEY_PEM), 'only the public half is in the code');
  const token = await issue({ privateKeyPem: priv(keys), org: 'Acme', seats: 5, edition: 'teams', days: 30 });
  const e = await E.verifyLicence(token);
  assert.equal(e.id, 'community');
});

test('detectEdition reads the machine-wide file first, then userData; none is community, quietly', async () => {
  const token = await issue({ privateKeyPem: priv(keys), org: 'Machine Org', seats: 3, edition: 'teams', days: 30 });
  const userToken = await issue({ privateKeyPem: priv(keys), org: 'User Org', seats: 1, edition: 'teams', days: 30 });
  const files = { '/etc/ironleaf/licence.jwt': token, '/home/u/data/licence.jwt': userToken };
  const read = async (f) => files[f] ?? null;
  const both = await E.detectEdition({ userData: '/home/u/data', platform: 'linux', env: {}, read, publicKeyPem: keys.publicPem });
  assert.equal(both.licence.org, 'Machine Org');
  assert.equal(both.source, '/etc/ironleaf/licence.jwt');
  delete files['/etc/ironleaf/licence.jwt'];
  assert.equal((await E.detectEdition({ userData: '/home/u/data', platform: 'linux', env: {}, read, publicKeyPem: keys.publicPem })).licence.org, 'User Org');
  const none = await E.detectEdition({ userData: '/x', platform: 'linux', env: {}, read: async () => null, publicKeyPem: keys.publicPem });
  assert.equal(none, E.COMMUNITY);
  assert.deepEqual(E.licenceFiles({ platform: 'win32', env: { ProgramData: 'D:\\PD' }, userData: 'C:\\u' })[0], 'D:\\PD\\Ironleaf\\licence.jwt');
});

test('the issuer refuses bad input and the CLI never prints the private key', async () => {
  await assert.rejects(issue({ privateKeyPem: priv(keys), org: 'Acme', seats: 0, edition: 'teams' }), /seats/);
  await assert.rejects(issue({ privateKeyPem: priv(keys), org: 'Acme', seats: 2, edition: 'gold' }), /edition/);
  const out = execFileSync(process.execPath, [path.join(root, 'tools/licence-issue.mjs'), '--key', keys.privateFile, '--org', 'CLI Org', '--seats', '2', '--edition', 'teams', '--days', '5'], { encoding: 'utf8' });
  assert.ok(!out.includes('PRIVATE KEY'));
  const e = await E.verifyLicence(out.trim(), { publicKeyPem: keys.publicPem });
  assert.equal(e.licence.org, 'CLI Org');
});

test('the enterprise module: community no-op when absent, loaded when present, a broken one never stops the app', async () => {
  const logs = [];
  const ctx = { edition: E.COMMUNITY, policy: { policy: {}, sources: [], problems: [] }, dataDir: work, version: '2.0.0', log: (m) => logs.push(m) };
  const missing = await X.loadEnterpriseModule(ctx, { packaged: true, load: () => { const e = new Error('nope'); e.code = 'MODULE_NOT_FOUND'; throw e; } });
  assert.equal(missing, X.COMMUNITY_MODULE);
  assert.equal(logs.length, 0, 'an absent module is not an error');
  X.audit({ kind: 'x', actor: 'person' }); // dropped, no throw
  const events = [];
  const made = await X.loadEnterpriseModule(ctx, { packaged: true, load: () => ({ createEnterprise: () => ({ id: 'ent', version: '1', audit: { write: (ev) => events.push(ev) } }) }) });
  assert.equal(made.id, 'ent');
  X.audit({ kind: 'mcp.call', actor: 'Claude', target: 'Notes/a.md', outcome: 'done' });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'mcp.call');
  assert.ok(events[0].at);
  const broken = await X.loadEnterpriseModule(ctx, { packaged: true, load: () => ({ createEnterprise: () => { throw new Error('boom'); } }) });
  assert.equal(broken, X.COMMUNITY_MODULE);
  assert.match(logs.join('\n'), /boom/);
  // An installed copy ignores the development override.
  let asked = '';
  await X.loadEnterpriseModule(ctx, { packaged: true, env: { IRONLEAF_ENTERPRISE_MODULE: '/tmp/evil.js' }, load: (id) => { asked = id; throw Object.assign(new Error(), { code: 'MODULE_NOT_FOUND' }); } });
  assert.equal(asked, X.ENTERPRISE_PACKAGE);
  X.setEnterpriseForTests(null);
});

test('Supporter and personal Sync licences (Ironleaf Cloud, contract v1) give their edition and features, never Community', async () => {
  const sup = await issue({ privateKeyPem: priv(keys), org: 'Ana Whitlock', seats: 1, edition: 'supporter', features: ['supporter'], days: 35, sub: 'acct-1', did: 'dev-1' });
  const e = await E.verifyLicence(sup, { publicKeyPem: keys.publicPem });
  assert.equal(e.id, 'supporter');
  assert.deepEqual(e.licence.features, ['supporter']);
  assert.equal(e.licence.seats, 1);
  assert.equal(e.licence.sub, 'acct-1');
  assert.equal(e.licence.did, 'dev-1');
  assert.match(e.words, /Ironleaf Supporter for Ana Whitlock/);
  const sync = await issue({ privateKeyPem: priv(keys), org: 'ana@example.com', seats: 1, edition: 'personal-sync', features: ['sync', 'supporter', 'Not A Key'], days: 35 });
  const s = await E.verifyLicence(sync, { publicKeyPem: keys.publicPem });
  assert.equal(s.id, 'personal-sync');
  assert.deepEqual(s.licence.features, ['sync', 'supporter'], 'features come from the claim; malformed ones are dropped');
  // Teams and Enterprise still need their organisation and seats.
  const { SignJWT, importPKCS8 } = await import(pathToFileURL(path.join(root, 'node_modules', 'jose', 'dist', 'webapi', 'index.js')).href);
  const key = await importPKCS8(priv(keys), 'EdDSA');
  const noSeats = await new SignJWT({ org: 'Acme', edition: 'teams', features: [] }).setProtectedHeader({ alg: 'EdDSA' }).setIssuer(E.LICENCE_ISSUER).setAudience(E.LICENCE_AUDIENCE).setExpirationTime('30d').sign(key);
  assert.equal((await E.verifyLicence(noSeats, { publicKeyPem: keys.publicPem })).id, 'community');
  // v0's issuer and audience are not accepted (contract v1 uses the app's own).
  const v0 = await new SignJWT({ org: 'Ana', seats: 1, edition: 'supporter', features: ['supporter'] }).setProtectedHeader({ alg: 'EdDSA' }).setIssuer('kaitiaki-it').setAudience('ironleaf').setExpirationTime('30d').sign(key);
  assert.equal((await E.verifyLicence(v0, { publicKeyPem: keys.publicPem })).id, 'community');
});
