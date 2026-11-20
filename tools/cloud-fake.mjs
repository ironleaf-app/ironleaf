#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// A tiny fake of Ironleaf Cloud and Kaitiaki ID, in one process on 127.0.0.1, for development and the checks
// (tests/account.test.mjs, the screenshot tour). Never shipped, never a real server: it signs everyone in at once as
// one made-up person, keeps everything in memory, and signs licences with a throwaway key made at start.
//
//   node tools/cloud-fake.mjs [--port 0] [--entitlements supporter,sync]
//     prints the environment for a development Ironleaf:
//       NV_CLOUD_ORIGIN=http://127.0.0.1:<port>  NV_TEST_LICENCE_PUBLIC_KEY=<file>  NV_TEST_BROWSER=fetch
//
// What it answers (the shapes the app reads; Ironleaf Cloud's docs/CONTRACT.md):
//   OIDC   /.well-known/openid-configuration  /authorize (302 straight back with a code)  /token  /jwks  /revoke
//   API    GET /api/v1/me   POST /api/v1/licence   POST|DELETE /api/v1/devices[/:id]   POST /api/v1/portal|checkout
//          (contract v1's shapes and error codes; PATCH /devices/:id only with { renameDevices: true }: not in v1 yet)
//          GET /fake-checkout?product=…  (as if paid: the entitlement is added)   GET /fake-portal

import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rnd = (n = 24) => randomBytes(n).toString('base64url');
const PRODUCT_ENTITLEMENTS = { supporter: ['supporter'], sync: ['sync'], teams: ['sync', 'teams', 'sso', 'admin', 'audit'] };

export async function startCloudFake(o = {}) {
  const jose = await import(pathToFileURL(path.join(root, 'node_modules', 'jose', 'dist', 'webapi', 'index.js')).href);
  const idKeys = await jose.generateKeyPair('ES256', { extractable: true });
  const jwk = { ...(await jose.exportJWK(idKeys.publicKey)), kid: 'fake-1', alg: 'ES256', use: 'sig' };
  const lic = generateKeyPairSync('ed25519');
  const licencePublicPem = lic.publicKey.export({ type: 'spki', format: 'pem' });
  const licenceKey = await jose.importPKCS8(lic.privateKey.export({ type: 'pkcs8', format: 'pem' }), 'EdDSA');

  const state = {
    person: { sub: o.sub ?? 'acct_fake_0001', name: o.name ?? 'Ana Whitlock', email: o.email ?? 'ana@example.com' },
    entitlements: new Set(o.entitlements ?? []),
    devices: new Map(Object.entries(o.devices ?? {}).map(([id, d]) => [id, { id, lastSeenAt: new Date().toISOString(), ...d }])),
    codes: new Map(),
    access: new Map(),
    refresh: new Map(),
    revoked: [],
    calls: [],
    issued: [],
    checkouts: [],
    deviceLimit: o.deviceLimit ?? 10,
    accessLife: o.accessLife ?? 3600,
    licenceDays: o.licenceDays ?? 35,
    /** Set by a check: the licence endpoint fails this way (a status), or the whole API is "down" (no answer). */
    licenceStatus: 0,
    down: false,
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin());
    const body = await new Promise((r) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => r(b));
    });
    state.calls.push(`${req.method} ${url.pathname}`);
    const send = (status, v, type = 'application/json') => res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }).end(type === 'application/json' ? JSON.stringify(v) : v);
    const form = () => Object.fromEntries(new URLSearchParams(body));
    const jsonBody = () => {
      try {
        return body ? JSON.parse(body) : {};
      } catch {
        return {};
      }
    };
    try {
      // ── Kaitiaki ID ──
      if (url.pathname === '/.well-known/openid-configuration')
        return send(200, { issuer: origin(), authorization_endpoint: `${origin()}/authorize`, token_endpoint: `${origin()}/token`, jwks_uri: `${origin()}/jwks`, revocation_endpoint: `${origin()}/revoke`, code_challenge_methods_supported: ['S256'] });
      if (url.pathname === '/jwks') return send(200, { keys: [jwk] });
      if (url.pathname === '/authorize') {
        const q = url.searchParams;
        const redirect = q.get('redirect_uri') ?? '';
        if (!/^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(redirect)) return send(400, 'bad redirect_uri', 'text/plain');
        if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('state') || !q.get('nonce')) return send(400, 'bad request', 'text/plain');
        const code = rnd();
        state.codes.set(code, { clientId: q.get('client_id'), redirect, challenge: q.get('code_challenge'), nonce: q.get('nonce'), scope: q.get('scope') });
        const back = new URL(redirect);
        back.searchParams.set('code', code);
        back.searchParams.set('state', o.wrongState ? 'not-the-state' : q.get('state'));
        res.writeHead(302, { location: back.toString() }).end();
        return;
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        const f = form();
        const tokens = async (nonce, clientId) => {
          const access = 'at_' + rnd();
          const refresh = 'rt_' + rnd();
          state.access.set(access, Date.now() + state.accessLife * 1000);
          state.refresh.set(refresh, { clientId, nonce });
          const id = await new jose.SignJWT({ ...state.person, nonce: o.wrongNonce ? 'another-nonce' : nonce }).setProtectedHeader({ alg: 'ES256', kid: 'fake-1' }).setIssuer(origin()).setAudience(clientId).setSubject(state.person.sub).setIssuedAt().setExpirationTime('1h').sign(idKeys.privateKey);
          return { access_token: access, refresh_token: refresh, id_token: id, token_type: 'Bearer', expires_in: state.accessLife };
        };
        if (f.grant_type === 'authorization_code') {
          const c = state.codes.get(f.code);
          state.codes.delete(f.code);
          if (!c || c.redirect !== f.redirect_uri || c.clientId !== f.client_id) return send(400, { error: 'invalid_grant' });
          const challenge = createHash('sha256').update(f.code_verifier ?? '').digest('base64url');
          if (challenge !== c.challenge) return send(400, { error: 'invalid_grant', error_description: 'PKCE' });
          return send(200, await tokens(c.nonce, c.clientId));
        }
        if (f.grant_type === 'refresh_token') {
          const r = state.refresh.get(f.refresh_token);
          if (!r) return send(400, { error: 'invalid_grant' });
          state.refresh.delete(f.refresh_token);
          return send(200, await tokens(r.nonce, r.clientId));
        }
        return send(400, { error: 'unsupported_grant_type' });
      }
      if (url.pathname === '/revoke' && req.method === 'POST') {
        const f = form();
        state.revoked.push(f.token);
        state.access.delete(f.token);
        state.refresh.delete(f.token);
        return send(200, {});
      }
      if (url.pathname === '/fake-checkout') {
        for (const e of PRODUCT_ENTITLEMENTS[url.searchParams.get('product')] ?? []) state.entitlements.add(e);
        return send(200, '<h1>Paid (fake)</h1>', 'text/html');
      }
      if (url.pathname === '/fake-portal') return send(200, '<h1>Billing portal (fake)</h1>', 'text/html');

      // ── Ironleaf Cloud API ──
      if (!url.pathname.startsWith('/api/v1/')) return send(404, { error: 'not found' });
      if (state.down) return req.socket.destroy();
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const until = bearer && state.access.get(bearer);
      if (!until || until < Date.now()) return send(401, { error: 'unauthorised' });
      const route = url.pathname.slice('/api/v1'.length);
      const fail = (status, error, message = error) => send(status, { error, message });
      const ents = [...state.entitlements].sort();
      const edition = ents.includes('enterprise') ? 'enterprise' : ents.includes('teams') ? 'teams' : ents.includes('sync') ? 'personal-sync' : ents.includes('supporter') ? 'supporter' : null;
      const deviceOut = (d) => ({ id: d.id, name: d.name, platform: d.platform, appVersion: d.appVersion ?? null, publicKey: null, createdAt: d.createdAt ?? d.lastSeenAt, lastSeenAt: d.lastSeenAt });
      if (route === '/me' && req.method === 'GET')
        return send(200, {
          account: { id: state.person.sub, email: state.person.email, name: state.person.name, createdAt: '2026-11-01T00:00:00.000Z' },
          plan: edition ?? 'community',
          entitlements: {
            features: ents,
            quota: { devices: state.deviceLimit, bytes: 10 * 1024 ** 3 },
            grants: ents.includes('sync') ? [{ id: 'g1', product: 'sync', status: 'active', teamId: null, currentPeriodEnd: new Date(Date.now() + 300 * 86400_000).toISOString(), graceUntil: null }] : [],
          },
          teams: [],
          devices: { limit: state.deviceLimit, items: [...state.devices.values()].map(deviceOut) },
        });
      if (route === '/devices' && req.method === 'POST') {
        const b = jsonBody();
        const keys = Object.keys(b);
        if (!b.name || !['windows', 'macos', 'linux', 'android', 'ios', 'web', 'other'].includes(b.platform) || keys.some((k) => !['name', 'platform', 'appVersion', 'publicKey'].includes(k))) return fail(400, 'invalid_request', 'name and a platform from the list');
        if (state.devices.size >= state.deviceLimit) return fail(409, 'device_limit', `This account can have ${state.deviceLimit} devices. Remove one first.`);
        const id = randomUUID();
        const d = { id, name: String(b.name).slice(0, 100), platform: b.platform, appVersion: b.appVersion, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() };
        state.devices.set(id, d);
        return send(201, deviceOut(d));
      }
      const dm = /^\/devices\/([^/]+)$/.exec(route);
      // Renaming is not in contract v1's API table; the fake answers it only when asked to (renameDevices).
      if (dm && req.method === 'PATCH' && o.renameDevices) {
        const d = state.devices.get(decodeURIComponent(dm[1]));
        if (!d) return fail(404, 'device_not_found');
        d.name = String(jsonBody().name ?? d.name);
        return send(200, deviceOut(d));
      }
      if (dm && req.method === 'DELETE') return state.devices.delete(decodeURIComponent(dm[1])) ? send(204, '', 'text/plain') : fail(404, 'device_not_found');
      if (route === '/licence' && req.method === 'POST') {
        const b = jsonBody();
        if (typeof b.deviceId !== 'string' || Object.keys(b).some((k) => k !== 'deviceId' && k !== 'teamId')) return fail(400, 'invalid_request');
        const device = state.devices.get(b.deviceId);
        if (!device) return fail(404, 'device_not_found', 'Register this device first (POST /devices).');
        device.lastSeenAt = new Date().toISOString();
        if (state.licenceStatus) return fail(state.licenceStatus, 'licences_unavailable');
        if (!edition) return fail(403, 'no_paid_plan', 'This account has no paid plan, so it needs no licence: the community edition is complete.');
        const iat = Math.floor(Date.now() / 1000);
        const exp = iat + Math.round(state.licenceDays * 86400);
        const org = state.person.name || state.person.email;
        // As Ironleaf Cloud's src/licence.ts signs them (contract v1): the app's own issuer and audience, and the device.
        const licence = await new jose.SignJWT({ org, edition, features: ents, seats: 1, did: device.id })
          .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
          .setIssuer('https://kaitiaki-it.com/ironleaf')
          .setAudience('ironleaf-desktop')
          .setSubject(state.person.sub)
          .setIssuedAt(iat)
          .setNotBefore(iat - 60)
          .setExpirationTime(exp)
          .setJti(randomUUID())
          .sign(licenceKey);
        state.issued.push({ did: device.id, edition });
        return send(200, { licence, edition, features: ents, seats: 1, org, expiresAt: new Date(exp * 1000).toISOString() });
      }
      if (route === '/portal' && req.method === 'POST') {
        if (!state.entitlements.size) return fail(404, 'no_billing', 'There is nothing to manage yet.');
        return send(200, { url: `${origin()}/fake-portal` });
      }
      if (route === '/checkout' && req.method === 'POST') {
        const b = jsonBody();
        const keys = Object.keys(b).sort().join(',');
        const ok =
          (b.product === 'supporter' && keys === 'product') ||
          (b.product === 'sync' && (keys === 'product' || keys === 'interval,product') && (b.interval === undefined || b.interval === 'month' || b.interval === 'year')) ||
          (b.product === 'teams' && keys === 'product,seats,teamName' && Number.isInteger(b.seats) && b.seats >= 3 && typeof b.teamName === 'string' && b.teamName.trim());
        state.checkouts.push(b);
        if (!ok) return fail(400, 'invalid_request', 'not a product body from contract v1');
        if (b.product === 'supporter' && state.entitlements.has('supporter')) return fail(409, 'already_owned');
        return send(200, { id: 'cs_test_' + rnd(6), url: `${origin()}/fake-checkout?product=${b.product}` });
      }
      return send(404, { error: 'not found' });
    } catch (err) {
      return send(500, { error: String(err?.message ?? err) });
    }
  });
  await new Promise((r) => server.listen(o.port ?? 0, '127.0.0.1', r));
  function origin() {
    return `http://127.0.0.1:${server.address().port}`;
  }
  return { origin: origin(), licencePublicPem, state, close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(() => r()))) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const fake = await startCloudFake({ port: Number(arg('port') ?? 0), entitlements: (arg('entitlements') ?? '').split(',').filter(Boolean) });
  const keyFile = path.join(mkdtempSync(path.join(tmpdir(), 'ironleaf-cloud-fake-')), 'licence-public.pem');
  writeFileSync(keyFile, fake.licencePublicPem);
  console.log(`NV_CLOUD_ORIGIN=${fake.origin}\nNV_TEST_LICENCE_PUBLIC_KEY=${keyFile}\nNV_TEST_BROWSER=fetch`);
}
