// SPDX-License-Identifier: AGPL-3.0-or-later
// node --test tests/account.test.mjs — Ironleaf accounts (src/main/account, src/shared/account.ts) against the fake
// cloud (tools/cloud-fake.mjs): PKCE, state and nonce; the sign-in kept only sealed (never in plain text, never in the
// window's view); token renewal and the end of a sign-in; the licence fetched, kept offline, removed when the account
// has nothing, never written over a hand-placed one, and Community once it lapses; sign-out revoking; the development
// switch inert in an installed copy; and what the page shows for each state. No real network, no real key.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-account-'));
let M;
let startCloudFake;
const DAY = 86400_000;

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * as config from ${src('src/main/account/config.ts')};`,
      `export * as oidc from ${src('src/main/account/oidc.ts')};`,
      `export * as loopback from ${src('src/main/account/loopback.ts')};`,
      `export * as store from ${src('src/main/account/token-store.ts')};`,
      `export * as licence from ${src('src/main/account/licence.ts')};`,
      `export * as service from ${src('src/main/account/service.ts')};`,
      `export * as edition from ${src('src/main/edition.ts')};`,
      `export * as policy from ${src('src/main/policy.ts')};`,
      `export * as shared from ${src('src/shared/account.ts')};`,
      `export * as ent from ${src('src/main/account/entitlements.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['electron'], output: { file: path.join(work, 'a.mjs'), format: 'esm', inlineDynamicImports: true }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'a.mjs')).href);
  ({ startCloudFake } = await import(pathToFileURL(path.join(root, 'tools/cloud-fake.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const fetchLike = (url, init) => fetch(url, init);

/** A sealer like safeStorage: reversible, and visibly not plain text (each byte flipped). */
function sealer(available = true) {
  const sealed = [];
  return {
    sealed,
    available: () => available,
    seal: (plain) => {
      sealed.push(plain);
      return Buffer.from(Buffer.from('SEALED:' + plain).map((b) => b ^ 0x5a));
    },
    open: (buf) => {
      const t = Buffer.from(buf.map((b) => b ^ 0x5a)).toString();
      if (!t.startsWith('SEALED:')) throw new Error('not sealed here');
      return t.slice(7);
    },
  };
}

/** One app's account against one fake cloud, in its own data folder. */
async function rig(o = {}) {
  const fake = o.fake ?? (await startCloudFake(o.fakeOptions ?? {}));
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  let clock = o.now ?? Date.now();
  let edition = M.edition.COMMUNITY;
  const views = [];
  const seal = o.sealer ?? sealer();
  const store = new M.store.TokenStore(dataDir, seal);
  const keyOpt = { publicKeyPem: fake.licencePublicPem };
  const licence = new M.licence.LicenceKeeper({
    dataDir,
    verify: (t) => M.edition.verifyLicence(t, { ...keyOpt, now: new Date(clock) }),
    redetect: async () => (edition = await M.edition.detectEdition({ userData: dataDir, platform: 'linux', env: {}, read: async (f) => (f.startsWith(dataDir) ? readFileSync(f, 'utf8') : null), ...keyOpt, now: new Date(clock) }).catch(() => M.edition.COMMUNITY)),
  });
  const config = M.config.cloudConfig({ packaged: false, env: { NV_CLOUD_ORIGIN: fake.origin }, policy: {} });
  const opened = [];
  const svc = new M.service.AccountService({
    config,
    fetch: fetchLike,
    store,
    licence,
    openBrowser: async (url) => {
      opened.push(url);
      if (!o.noBrowser) await fetch(url).catch(() => {}); // the fake signs in at once and redirects to the loopback
    },
    device: () => ({ name: 'Test PC', platform: M.shared.cloudPlatform('linux'), appVersion: '0.0.0-test' }),
    changed: (v) => views.push(v),
    edition: () => edition,
    now: () => clock,
    signInTimeoutMs: o.timeout ?? 4000,
  });
  await svc.load();
  return { fake, dataDir, svc, store, seal, licence, views, opened, config, setNow: (t) => (clock = t), now: () => clock, edition: () => edition, close: () => (o.fake ? null : fake.close()) };
}

test('PKCE: an S256 challenge of a fresh 43-character verifier; new state and nonce each sign-in', () => {
  const { oidc } = M;
  const v = oidc.makeVerifier();
  assert.match(v, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(oidc.challengeOf(v), createHash('sha256').update(v).digest('base64url'));
  const discovery = { issuer: 'https://id.example', authorization_endpoint: 'https://id.example/authorize', token_endpoint: 'x', jwks_uri: 'y' };
  const a = oidc.beginSignIn({ discovery, clientId: 'cid', scope: 'openid profile', redirectUri: 'http://127.0.0.1:5000/callback' });
  const b = oidc.beginSignIn({ discovery, clientId: 'cid', scope: 'openid profile', redirectUri: 'http://127.0.0.1:5000/callback' });
  const q = new URL(a.url).searchParams;
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('code_challenge'), oidc.challengeOf(a.verifier));
  assert.equal(q.get('state'), a.state);
  assert.equal(q.get('nonce'), a.nonce);
  assert.equal(q.get('response_type'), 'code');
  assert.ok(!a.url.includes(a.verifier), 'the verifier never leaves the app before the token call');
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.nonce, b.nonce);
  assert.notEqual(a.verifier, b.verifier);
});

test('the browser’s answer is taken only with this sign-in’s state; an error is believed only then', () => {
  const { oidc } = M;
  const q = (o) => new URLSearchParams(o);
  assert.equal(oidc.readCallback(q({ code: 'c1', state: 's1' }), 's1'), 'c1');
  assert.throws(() => oidc.readCallback(q({ code: 'c1', state: 's2' }), 's1'), (e) => e.code === 'state');
  assert.throws(() => oidc.readCallback(q({ code: 'c1' }), 's1'), (e) => e.code === 'state');
  assert.throws(() => oidc.readCallback(q({ error: 'access_denied' }), 's1'), (e) => e.code === 'state', 'an error without our state is ignored');
  assert.throws(() => oidc.readCallback(q({ error: 'access_denied', state: 's1' }), 's1'), (e) => e.code === 'denied');
  assert.throws(() => oidc.readCallback(q({ state: 's1' }), 's1'), (e) => e.code === 'token');
  assert.deepEqual(M.config.scopesFor('123').split(' '), ['openid', 'profile', 'email', 'offline_access', 'urn:zitadel:iam:user:resourceowner', 'urn:zitadel:iam:org:project:id:123:aud']);
});

test('sign in against the fake: tokens sealed, this PC registered, the licence written and in force; the view has no token', async () => {
  const r = await rig({ fakeOptions: { entitlements: ['supporter'] } });
  try {
    const view = await r.svc.signIn();
    assert.equal(view.status, 'signed-in', view.error);
    assert.equal(view.profile.email, 'ana@example.com');
    assert.equal(r.opened.length, 1);
    assert.match(r.opened[0], /code_challenge_method=S256/);
    assert.ok(view.deviceId, 'this PC is registered');
    assert.ok(view.me.devices.some((d) => d.id === view.deviceId && d.name === 'Test PC'));
    assert.equal(r.edition().id, 'supporter');
    assert.ok(existsSync(path.join(r.dataDir, 'licence.jwt')));
    assert.ok(M.shared.isSupporter(r.svc.view()));
    // No token anywhere the window can see.
    const s = r.store.get();
    for (const v of [view, ...r.views]) {
      const text = JSON.stringify(v);
      for (const t of [s.tokens.accessToken, s.tokens.refreshToken, s.tokens.idToken]) assert.ok(!text.includes(t), 'a token reached the window');
      assert.ok(!/accessToken|refreshToken|idToken/.test(text));
    }
    // The loopback address is closed once signed in.
    const port = new URL(new URL(r.opened[0]).searchParams.get('redirect_uri')).port;
    await assert.rejects(fetch(`http://127.0.0.1:${port}/callback?state=x&code=y`));
  } finally {
    await r.close();
  }
});

test('tokens are never written in plain text, and not at all without a protected store', async () => {
  const r = await rig({ fakeOptions: { entitlements: [] } });
  try {
    await r.svc.signIn();
    const s = r.store.get();
    const files = readdirSync(r.dataDir);
    assert.ok(files.includes('account.sealed'));
    for (const f of files) {
      const text = readFileSync(path.join(r.dataDir, f), 'latin1');
      for (const secret of [s.tokens.accessToken, s.tokens.refreshToken, 'ana@example.com']) assert.ok(!text.includes(secret), `${f} holds ${secret.slice(0, 6)}… in plain text`);
    }
    // A second start on this PC reads the sealed sign-in back.
    const again = new M.store.TokenStore(r.dataDir, r.seal);
    assert.equal((await again.load()).tokens.refreshToken, s.tokens.refreshToken);
    // Sealed by another PC (or damaged): as if signed out, and the file goes.
    const other = new M.store.TokenStore(r.dataDir, { available: () => true, seal: () => Buffer.from(''), open: () => { throw new Error('no'); } });
    assert.equal(await other.load(), null);
    assert.ok(!existsSync(path.join(r.dataDir, 'account.sealed')));
  } finally {
    await r.close();
  }
  const bare = await rig({ sealer: sealer(false), fakeOptions: { entitlements: [] } });
  try {
    const view = await bare.svc.signIn();
    assert.equal(view.status, 'signed-in');
    assert.equal(view.persistent, false);
    assert.ok(!existsSync(path.join(bare.dataDir, 'account.sealed')), 'nothing written without a protected store');
    assert.equal(bare.seal.sealed.length, 0);
    assert.ok(M.shared.accountScreen(view).notes.some((n) => /sign in again after Ironleaf restarts/.test(n)));
  } finally {
    await bare.close();
  }
});

test('a wrong nonce or a wrong state is refused, and nothing is kept', async () => {
  const nonce = await rig({ fakeOptions: { wrongNonce: true } });
  try {
    const v = await nonce.svc.signIn();
    assert.equal(v.status, 'signed-out');
    assert.match(v.error, /another sign-in/);
    assert.equal(nonce.store.get(), null);
    assert.ok(!existsSync(path.join(nonce.dataDir, 'account.sealed')));
  } finally {
    await nonce.close();
  }
  const state = await rig({ fakeOptions: { wrongState: true }, timeout: 600 });
  try {
    const v = await state.svc.signIn();
    assert.equal(v.status, 'signed-out');
    assert.match(v.error, /too long/, 'the answer with another state was turned away, so the sign-in timed out');
    assert.equal(state.store.get(), null);
  } finally {
    await state.close();
  }
});

test('an access token near its end is renewed; a refused renewal ends the sign-in, keeping the licence to its end', async () => {
  const r = await rig({ fakeOptions: { entitlements: ['sync'], accessLife: 3600 } });
  try {
    await r.svc.signIn();
    const first = r.store.get().tokens;
    r.setNow(Date.now() + 2 * 3600_000); // the access token has lapsed on this clock
    await r.svc.sync({ force: true });
    const second = r.store.get().tokens;
    assert.notEqual(second.accessToken, first.accessToken);
    assert.notEqual(second.refreshToken, first.refreshToken, 'the fake rotates refresh tokens and the new one is kept');
    // The refresh token is revoked elsewhere: the next renewal is refused and this PC is signed out.
    r.fake.state.refresh.clear();
    r.setNow(Date.now() + 4 * 3600_000);
    await r.svc.sync({ force: true });
    const v = r.svc.view();
    assert.equal(v.status, 'signed-out');
    assert.match(v.error, /sign-in has ended/);
    assert.equal(r.edition().id, 'personal-sync', 'the licence stays in force until it expires');
  } finally {
    await r.close();
  }
});

test('the licence: kept offline, Community once it lapses, removed when the account has nothing, a hand-placed one never touched', async () => {
  const r = await rig({ fakeOptions: { entitlements: ['supporter'] } });
  try {
    await r.svc.signIn();
    const file = path.join(r.dataDir, 'licence.jwt');
    const written = readFileSync(file, 'utf8');
    // Offline: nothing changes.
    r.fake.state.down = true;
    r.setNow(Date.now() + 2 * DAY);
    assert.ok(r.svc.due());
    await r.svc.sync();
    assert.equal(readFileSync(file, 'utf8'), written);
    assert.equal(r.edition().id, 'supporter');
    assert.equal(r.svc.view().online, false);
    assert.ok(M.shared.accountScreen(r.svc.view()).notes.some((n) => /^Offline/.test(n)));
    // Still offline when it lapses (35 days): Community, quietly (no error), the file left for the next refresh.
    r.setNow(Date.now() + 36 * DAY);
    await r.svc.tick();
    assert.equal(r.edition().id, 'community');
    assert.equal(r.svc.view().error, undefined);
    assert.equal(M.shared.isSupporter(r.svc.view()), false);
    // Back online: a fresh licence.
    r.fake.state.down = false;
    r.setNow(Date.now());
    await r.svc.sync({ force: true });
    assert.equal(r.edition().id, 'supporter');
    assert.notEqual(readFileSync(file, 'utf8'), written);
    // The account no longer has anything paid: the licence this app wrote goes.
    r.fake.state.entitlements.clear();
    await r.svc.sync({ force: true });
    assert.ok(!existsSync(file));
    assert.equal(r.edition().id, 'community');
    // A licence the cloud sends that does not verify is never written.
    r.fake.state.entitlements.add('sync');
    const refused = await r.licence.refresh(async () => 'eyJhbGciOiJFZERTQSJ9.e30.bm9wZQ');
    assert.equal(refused.outcome, 'refused');
    assert.ok(!existsSync(file));
  } finally {
    await r.close();
  }
  // A licence put there by hand (an organisation's) is kept as it is.
  const h = await rig({ fakeOptions: { entitlements: ['supporter'] } });
  try {
    await h.svc.signIn();
    const file = path.join(h.dataDir, 'licence.jwt');
    const mine = readFileSync(file, 'utf8');
    rmSync(path.join(h.dataDir, 'account.json'));
    // Now nothing records that this app wrote it, so it reads as someone else's working licence.
    const out = await h.licence.refresh(async () => mine.trim());
    assert.equal(out.outcome, 'kept');
    h.fake.state.entitlements.clear();
    const gone = await h.licence.refresh(() => h.svc.api.licence(h.store.get().deviceId));
    assert.equal(gone.outcome, 'unchanged', 'the cloud says no paid plan (403), yet a licence this app did not write stays');
    assert.equal(readFileSync(file, 'utf8'), mine, 'never removed when this app did not write it');
  } finally {
    await h.close();
  }
});

test('the daily check: due when never done, after a day, or within a week of the licence ending', () => {
  const { LicenceKeeper } = M.licence;
  const now = Date.now();
  assert.equal(LicenceKeeper.due({ now }), true);
  assert.equal(LicenceKeeper.due({ now, refreshedAt: now - 3600_000 }), false);
  assert.equal(LicenceKeeper.due({ now, refreshedAt: now - DAY - 1 }), true);
  assert.equal(LicenceKeeper.due({ now, refreshedAt: now - 3600_000, licenceUntil: now + 3 * DAY }), true);
  assert.equal(LicenceKeeper.due({ now, refreshedAt: now + DAY }), true, 'a clock that went back');
});

test('sign out revokes at Kaitiaki ID, removes the sealed sign-in and the licence, and is Community again', async () => {
  const r = await rig({ fakeOptions: { entitlements: ['sync', 'supporter'] } });
  try {
    await r.svc.signIn();
    const t = r.store.get().tokens;
    const v = await r.svc.signOut();
    assert.equal(v.status, 'signed-out');
    assert.ok(r.fake.state.revoked.includes(t.refreshToken));
    assert.ok(r.fake.state.revoked.includes(t.accessToken));
    assert.ok(!existsSync(path.join(r.dataDir, 'account.sealed')));
    assert.ok(!existsSync(path.join(r.dataDir, 'licence.jwt')));
    assert.equal(r.edition().id, 'community');
  } finally {
    await r.close();
  }
});

test('devices, billing and Checkout: renamed and removed at the cloud; only safe addresses open', async () => {
  const r = await rig({ fakeOptions: { entitlements: ['sync'], renameDevices: true, devices: { dev_old: { name: 'Old laptop', platform: 'windows' } } } });
  try {
    let v = await r.svc.signIn();
    assert.equal(v.me.deviceLimit, 10);
    assert.equal(r.fake.state.devices.get(v.deviceId).platform, 'linux', 'the cloud’s platform names');
    v = await r.svc.renameDevice('dev_old', 'Study laptop');
    assert.ok(v.me.devices.some((d) => d.name === 'Study laptop'));
    v = await r.svc.removeDevice(v.deviceId);
    assert.match(v.error, /sign out/, 'this PC is taken off by signing out');
    v = await r.svc.removeDevice('dev_old');
    assert.ok(!v.me.devices.some((d) => d.id === 'dev_old'));
    r.opened.length = 0;
    await r.svc.portal();
    for (const p of [{ product: 'supporter', interval: 'year' }, { product: 'sync', interval: 'month' }, { product: 'teams', seats: 1, teamName: ' Acme ' }]) {
      v = await r.svc.checkout(p);
      assert.equal(v.error, undefined, JSON.stringify(p));
    }
    // Exactly contract v1's bodies: no stray fields, Teams at its minimum of 3 seats with a name.
    assert.deepEqual(r.fake.state.checkouts, [{ product: 'supporter' }, { product: 'sync', interval: 'month' }, { product: 'teams', seats: 3, teamName: 'Acme' }]);
    assert.deepEqual(r.opened.map((u) => new URL(u).pathname), ['/fake-portal', '/fake-checkout', '/fake-checkout', '/fake-checkout']);
    v = await r.svc.checkout({ product: 'gold' });
    assert.match(v.error, /not something Ironleaf sells/);
    v = await r.svc.checkout({ product: 'teams', teamName: '  ' });
    assert.match(v.error, /not something Ironleaf sells/, 'Teams needs a name');
    // Back from the browser: the plan is read again once.
    r.fake.state.entitlements.add('supporter');
    await r.svc.returned();
    assert.ok(r.svc.view().me.entitlements.includes('supporter'));
    // The cloud's own words for its error codes.
    v = await r.svc.checkout({ product: 'supporter' });
    assert.match(v.error, /already a Supporter/);
    const { safeBrowserUrl } = M.config;
    const real = { source: 'default', issuer: 'https://id.neuralspark.com.au' };
    assert.equal(safeBrowserUrl('https://billing.stripe.com/p/session/x', real), 'https://billing.stripe.com/p/session/x');
    assert.equal(safeBrowserUrl('http://billing.stripe.com/x', real), null);
    assert.equal(safeBrowserUrl('javascript:alert(1)', real), null);
    assert.equal(safeBrowserUrl('file:///etc/passwd', real), null);
    assert.equal(safeBrowserUrl(`${r.fake.origin}/fake-portal`, real), null, 'the fake is opened only in a development build');
  } finally {
    await r.close();
  }
});

test('the development switch: honoured only unpackaged and only for 127.0.0.1; policy can move the cloud or turn accounts off', () => {
  const { cloudConfig, devCloudOrigin, DEFAULT_API_BASE, isPlaceholder, CLIENT_ID } = M.config;
  const env = { NV_CLOUD_ORIGIN: 'http://127.0.0.1:4555' };
  assert.equal(devCloudOrigin({ packaged: false, env }), 'http://127.0.0.1:4555');
  assert.equal(devCloudOrigin({ packaged: true, env }), undefined);
  const packaged = cloudConfig({ packaged: true, env, policy: {} });
  assert.equal(packaged.source, 'default');
  assert.equal(packaged.apiBase, DEFAULT_API_BASE);
  assert.equal(packaged.issuer, 'https://id.neuralspark.com.au');
  assert.equal(packaged.configured, !isPlaceholder(CLIENT_ID), 'a placeholder client id cannot sign in');
  for (const bad of ['http://evil.example:4555', 'https://127.0.0.1:4555', 'http://127.0.0.1:4555/x', 'http://localhost:4555']) assert.equal(devCloudOrigin({ packaged: false, env: { NV_CLOUD_ORIGIN: bad } }), undefined, bad);
  const dev = cloudConfig({ packaged: false, env, policy: {} });
  assert.deepEqual([dev.source, dev.issuer, dev.apiBase, dev.configured], ['dev', 'http://127.0.0.1:4555', 'http://127.0.0.1:4555/api/v1', true]);
  // Managed policy (src/main/policy.ts): an https site with no path, or accounts off.
  const problems = [];
  const p = M.policy.parsePolicy({ cloud: { origin: 'https://cloud.acme.example', disabled: 'false' } }, problems);
  assert.deepEqual(p.cloud, { origin: 'https://cloud.acme.example', disabled: false });
  assert.equal(cloudConfig({ packaged: true, env: {}, policy: p }).apiBase, 'https://cloud.acme.example/api/v1');
  M.policy.parsePolicy({ cloud: { origin: 'http://cloud.acme.example/x' } }, problems);
  assert.ok(problems.some((x) => /cloud.origin/.test(x)));
  assert.equal(cloudConfig({ packaged: true, env: {}, policy: { cloud: { disabled: true } } }).disabled, true);
  assert.deepEqual(M.policy.mergePolicies({ cloud: { origin: 'https://a.example' } }, { cloud: { disabled: true } }).cloud, { origin: 'https://a.example', disabled: true });
  // The development-only switches stay out of an installed copy's code path.
  const index = readFileSync(path.join(root, 'src/main/account/index.ts'), 'utf8');
  assert.match(index, /devSwitch\('NV_TEST_BROWSER'\) === 'fetch' && config\.source === 'dev'/);
  assert.match(index, /devSwitch\('NV_TEST_LICENCE_PUBLIC_KEY'\)/);
});

test('turned off by policy or not set up: no sign-in, nothing contacted', async () => {
  let called = 0;
  const base = { fetch: async () => (called++, { ok: false, status: 500, text: async () => '' }), store: new M.store.TokenStore(work, sealer()), licence: { state: async () => ({}) }, openBrowser: async () => called++, device: () => ({}), changed: () => {} };
  const off = new M.service.AccountService({ ...base, config: M.config.cloudConfig({ packaged: true, env: {}, policy: { cloud: { disabled: true } } }), managedWords: 'Managed by your organisation.' });
  assert.equal((await off.signIn()).status, 'off');
  const unset = new M.service.AccountService({ ...base, config: { ...M.config.cloudConfig({ packaged: true, env: {}, policy: {} }), configured: false } });
  assert.equal((await unset.signIn()).status, 'unconfigured');
  assert.equal(called, 0);
});

test('cloud licences (Supporter) from the fake, signed as Ironleaf Cloud signs them (contract v1), read as their edition', async () => {
  const fake = await startCloudFake({ entitlements: ['supporter'] });
  try {
    const r = await rig({ fake });
    await r.svc.signIn();
    const e = r.edition();
    assert.equal(e.id, 'supporter');
    assert.equal(e.licence.seats, 1);
    assert.deepEqual(e.licence.features, ['supporter']);
    assert.match(e.words, /Ironleaf Supporter/);
  } finally {
    await fake.close();
  }
});

test('what the page shows for each state', () => {
  const { accountScreen, parseMe, deviceWords, entitlementsOf, NEVER_NEEDED } = M.shared;
  assert.equal(accountScreen(null).kind, 'signed-out');
  const out = accountScreen({ status: 'signed-out', persistent: true, licence: null });
  assert.equal(out.lead, NEVER_NEEDED);
  assert.deepEqual(out.offers, []);
  assert.match(accountScreen({ status: 'signing-in', persistent: true }).notes[0], /browser/);
  assert.match(accountScreen({ status: 'off', persistent: true, managed: 'Managed by your organisation. Off.' }).lead, /Managed/);
  assert.match(accountScreen({ status: 'unconfigured', persistent: true }).lead, /not set up/);
  const me = parseMe({ account: { id: 'a', name: 'Ana', email: 'a@x' }, plan: { id: 'sync', renewsAt: '2027-01-02T00:00:00Z' }, entitlements: ['sync', 'Bad Key!'], devices: [{ id: 'd1', name: 'PC', platform: 'win32', lastSeen: '2026-11-01T00:00:00Z' }, { name: 'no id' }] });
  assert.deepEqual(me.entitlements, ['sync']);
  assert.equal(me.plan.name, 'Sync');
  assert.equal(me.devices.length, 1);
  const s = accountScreen({ status: 'signed-in', persistent: true, profile: { name: 'Ana', email: 'a@x' }, me, deviceId: 'd1', licence: null });
  assert.equal(s.kind, 'signed-in');
  assert.equal(s.plan, 'Sync');
  assert.match(s.planWhen, /^Renews/);
  assert.equal(s.billing, true);
  assert.deepEqual(s.offers.map((x) => x.id), ['teams', 'supporter']);
  assert.ok(s.features[0].startsWith('Sync'));
  assert.equal(deviceWords(me.devices[0], 'd1'), 'Windows · this PC');
  assert.match(deviceWords(me.devices[0], 'other'), /^Windows · seen /);
  const free = accountScreen({ status: 'signed-in', persistent: true, profile: { name: '', email: 'a@x' }, me: parseMe({ plan: 'community', entitlements: [] }), licence: null });
  assert.equal(free.billing, false, 'nothing to manage before anything is bought');
  assert.equal(free.plan, 'Community');
  assert.equal(free.offers.length, 3);
  // Teams includes Sync: Sync is not offered on top.
  assert.ok(!accountScreen({ status: 'signed-in', persistent: true, me: parseMe({ entitlements: ['sync', 'teams'] }) }).offers.some((x) => x.id === 'sync'));
  // Offline and signed out, the licence in force still says Supporter (the badge works without the cloud).
  assert.deepEqual(entitlementsOf({ status: 'signed-out', persistent: true, licence: { edition: 'supporter', features: ['supporter'], until: 0, words: '', org: '' }, me: { entitlements: ['sync'] } }), ['supporter']);
});

test('contract v1: the licence carries this device’s id; a device the cloud dropped is registered again; no rename is said plainly', async () => {
  const r = await rig({ fakeOptions: { entitlements: ['sync'] } });
  try {
    let v = await r.svc.signIn();
    assert.equal(r.edition().licence.did, v.deviceId);
    assert.equal(r.edition().id, 'personal-sync');
    // The cloud forgot this PC (removed on another device): the next licence registers it again.
    r.fake.state.devices.delete(v.deviceId);
    const before = v.deviceId;
    const out = await r.licence.refresh(() => r.svc['licenceForThisDevice']());
    assert.equal(out.outcome, 'written');
    assert.notEqual(r.store.get().deviceId, before);
    assert.equal(r.edition().licence.did, r.store.get().deviceId);
    // Renaming is not in v1's API table: the person is told so, nothing breaks.
    v = await r.svc.renameDevice(r.store.get().deviceId, 'Desk');
    assert.match(v.error, /cannot rename devices yet/);
    // Nothing to manage before anything is bought.
    r.fake.state.entitlements.clear();
    v = await r.svc.portal();
    assert.match(v.error, /nothing to manage/);
    // The device limit, in plain words.
    r.fake.state.deviceLimit = 1;
    r.fake.state.devices.clear();
    r.fake.state.devices.set('other', { id: 'other', name: 'Other', platform: 'macos', lastSeenAt: new Date().toISOString() });
    await r.svc.sync({ force: true });
    assert.match(r.svc.view().error, /device limit/);
  } finally {
    await r.close();
  }
});

test('Sync availability and the Supporter mark follow the licence in force, offline too, and lapse with it', async () => {
  const fake = await startCloudFake({ entitlements: ['sync', 'supporter'] });
  try {
    const r = await rig({ fake });
    await r.svc.signIn();
    const edition = r.edition();
    assert.equal(M.ent.syncAvailable({ edition }), true);
    assert.equal(M.ent.supporter({ edition }), true);
    assert.equal(M.ent.syncAvailable({ edition, now: Date.now() + 40 * DAY }), false, 'lapsed: Community');
    assert.equal(M.ent.syncAvailable({ edition: M.edition.COMMUNITY }), false);
    fake.state.down = true;
    await r.svc.sync({ force: true });
    assert.ok(M.shared.isSupporter(r.svc.view()), 'offline, the licence still says Supporter');
  } finally {
    await fake.close();
  }
});

test('Sync’s seam: a token and Sync only once signed in with it; none after sign-out', async () => {
  const fake = await startCloudFake({ entitlements: ['sync'] });
  try {
    const r = await rig({ fake });
    assert.equal(await r.svc.getAccessToken(), null, 'signed out: no token');
    assert.equal(r.svc.hasEntitlement('sync'), false);
    await r.svc.signIn();
    assert.match(String(await r.svc.getAccessToken()), /.+/, 'signed in: a token for the sync calls');
    assert.equal(r.svc.hasEntitlement('sync'), true);
    assert.equal(r.svc.hasEntitlement('teams'), false);
    await r.svc.signOut();
    assert.equal(await r.svc.getAccessToken(), null);
    assert.equal(r.svc.hasEntitlement('sync'), false);
  } finally {
    await fake.close();
  }
});

test('GET /me in contract v1’s shape', () => {
  const me = M.shared.parseMe({
    account: { id: 'a1', email: 'ana@example.com', name: 'Ana', createdAt: '2026-11-01' },
    plan: 'personal-sync',
    entitlements: { features: ['sync', 'supporter'], quota: { devices: 10 }, grants: [{ id: 'g', product: 'sync', status: 'active', teamId: null, currentPeriodEnd: '2027-03-01T00:00:00Z', graceUntil: null }, { id: 'h', product: 'supporter', status: 'active', teamId: null, currentPeriodEnd: null }] },
    teams: [{ id: 't1', name: 'Acme', role: 'owner', seats: 3 }],
    devices: { limit: 10, items: [{ id: 'd1', name: 'Desk', platform: 'windows', appVersion: '2.0.2', lastSeenAt: '2026-11-19T00:00:00Z' }] },
  });
  assert.deepEqual(me.entitlements, ['sync', 'supporter']);
  assert.equal(me.plan.name, 'Sync');
  assert.equal(me.plan.renews, Date.parse('2027-03-01T00:00:00Z'));
  assert.equal(me.deviceLimit, 10);
  assert.equal(me.devices[0].lastSeen, Date.parse('2026-11-19T00:00:00Z'));
  assert.deepEqual(me.teams, [{ id: 't1', name: 'Acme', role: 'owner' }]);
  assert.match(M.shared.deviceWords(me.devices[0]), /^Windows · seen/);
  assert.equal(M.shared.parseMe({ plan: 'community', entitlements: { features: [] }, devices: { limit: 1, items: [] } }).plan.name, 'Community');
  assert.deepEqual(['win32', 'darwin', 'linux', 'freebsd'].map(M.shared.cloudPlatform), ['windows', 'macos', 'linux', 'other']);
  assert.deepEqual(M.service.cleanCheckout({ product: 'sync' }), { product: 'sync', interval: 'month' });
  assert.deepEqual(M.service.cleanCheckout({ product: 'teams', seats: 12, teamName: 'Acme', extra: 1 }), { product: 'teams', seats: 12, teamName: 'Acme' });
  assert.equal(M.service.cleanCheckout({ product: 'teams', seats: 5 }), null);
});
