#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Ironleaf Teams end to end against a real Ironleaf Cloud (its docs/TEAMS.md): three people in one team, made-up
// notes in temp folders, the app's own Teams core and sync engine over HTTP. Never point it at real notes or a real
// team.
//   node tools/teams-e2e.mjs <api base>   with IRONLEAF_TEAMS_E2E_OWNER, _MEMBER and _THIRD (bearer tokens; the owner
//   owns a team with Teams and at least 3 seats, the other two are not in it yet and have the invited email)
// It invites the two, makes a shared vault from the notes, has the member join and both sync, removes the member (the
// Ironleaf rotates the key, the member is refused), lets the third join and read everything, and applies a team
// policy. Prints counts, never file contents.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [base] = process.argv.slice(2);
const tokens = { owner: process.env.IRONLEAF_TEAMS_E2E_OWNER, member: process.env.IRONLEAF_TEAMS_E2E_MEMBER, third: process.env.IRONLEAF_TEAMS_E2E_THIRD };
if (!base || !tokens.owner || !tokens.member || !tokens.third) {
  console.error('usage: IRONLEAF_TEAMS_E2E_OWNER=… IRONLEAF_TEAMS_E2E_MEMBER=… IRONLEAF_TEAMS_E2E_THIRD=… node tools/teams-e2e.mjs <api base>');
  process.exit(2);
}
const work = mkdtempSync(path.join(tmpdir(), 'ironleaf-teams-e2e-'));
const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
const entry = path.join(work, 'entry.ts');
const src = (f) => JSON.stringify(path.join(root, 'src', 'main', f));
writeFileSync(entry, [...['sync/crypto.ts', 'sync/protocol.ts', 'sync/local.ts', 'sync/engine.ts', 'sync/team-keys.ts', 'teams/core.ts', 'teams/api.ts'].map((f) => `export * from ${src(f)};`), `export * as P from ${src('policy.ts')};`].join('\n'));
await build({ input: entry, platform: 'node', output: { file: path.join(work, 'teams.mjs'), format: 'esm' }, logLevel: 'silent' });
const S = await import(pathToFileURL(path.join(work, 'teams.mjs')).href);
S.P.setPolicyForTests({});

const step = (m) => console.log(`ok - ${m}`);
const write = (file, data) => (mkdirSync(path.dirname(file), { recursive: true }), writeFileSync(file, data));
const walk = (dir, rel = '') => readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(dir, rel ? `${rel}/${e.name}` : e.name) : [rel ? `${rel}/${e.name}` : e.name]));
const tree = (dir) => Object.fromEntries(walk(dir).sort().map((r) => [r, createHash('sha256').update(readFileSync(path.join(dir, r))).digest('hex')]));
const call = async (token, method, route, body) => {
  const res = await fetch(base + route, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

async function person(name, token) {
  const me = (await call(token, 'GET', '/me')).body;
  const dev = await call(token, 'POST', '/devices', { name: `${name}-e2e`, platform: 'linux' });
  assert.equal(dev.status, 201, JSON.stringify(dev.body));
  const dir = path.join(work, name);
  mkdirSync(dir);
  let kept = null;
  const rings = new Map();
  const bound = { vaultId: null, teamId: null, on: false };
  const sync = {
    current: () => ({ root: dir, ...bound }),
    begin: async (vaultId, teamId, ring) => (rings.set(vaultId, ring), Object.assign(bound, { vaultId, teamId, on: true })),
    rekey: async (vaultId, ring) => void (rings.has(vaultId) && rings.set(vaultId, ring)),
    ring: async (vaultId) => rings.get(vaultId) ?? null,
    changed: () => {},
  };
  const core = new S.TeamsCore({
    api: new S.HttpTeamsApi(() => base, async () => token),
    account: { signedIn: async () => true, hasEntitlement: () => true, deviceId: () => dev.body.id, accountId: () => me.account.id },
    keys: { available: () => true, load: async () => kept, save: async (k) => void (kept = k) },
    sync,
    applyPolicy: (t) => S.P.setTeamPolicy(t),
    policyWords: (l) => S.P.policyView(l).locks.map((x) => x.words),
  });
  const api = new S.HttpSyncApi(base, async () => token);
  const engine = () =>
    new S.SyncEngine({ api, keys: new S.TeamKeyRing(rings.get(bound.vaultId), bound.vaultId), root: dir, device: { id: randomUUID(), name }, writer: new S.FsWriter(dir, { deviceName: name, trash: async (abs) => rmSync(abs) }), store: new S.FileStateStore(path.join(work, `state-${name}.json`)), excluded: () => [] });
  return { name, token, me, deviceId: dev.body.id, core, dir, api, bound, rings, engine, file: (rel) => path.join(dir, ...rel.split('/')) };
}

try {
  const owner = await person('owner', tokens.owner);
  const teamId = (await call(tokens.owner, 'GET', '/teams')).body.teams[0]?.id;
  assert.ok(teamId, 'the owner has a team');
  const member = await person('member', tokens.member);
  const third = await person('third', tokens.third);
  for (const p of [member]) {
    const inv = await call(tokens.owner, 'POST', `/teams/${teamId}/invites`, { email: p.me.account.email, role: 'member' });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    assert.equal((await call(p.token, 'POST', '/invites/accept', { token: inv.body.url.split('#')[1] })).status, 200);
  }
  step('member invited and joined');

  await member.core.refresh();
  await owner.core.refresh();
  write(owner.file('Plans/Q1.md'), '# Q1\nMade-up plan.\n');
  write(owner.file('Clients/Harbour.md'), 'Made-up client.\n');
  let v = await owner.core.createVault('E2E shared');
  assert.ok(!v.error, v.error);
  const vaultId = v.vaults[0].id;
  await owner.engine().sync();
  v = await member.core.refresh();
  assert.equal(v.vaults[0].hasKey, true, 'the owner’s Ironleaf gave the member the key');
  await member.core.joinVault(vaultId);
  await member.engine().sync();
  write(member.file('Plans/Q2.md'), 'Member’s made-up idea.\n');
  await member.engine().sync();
  await owner.engine().sync();
  assert.deepEqual(tree(owner.dir), tree(member.dir));
  step(`two members share a team vault (${Object.keys(tree(owner.dir)).length} files each)`);

  v = await owner.core.remove(member.me.account.id);
  const key = await call(tokens.owner, 'GET', `/sync/${vaultId}/key?device=${owner.deviceId}`);
  assert.deepEqual([key.body.epoch, key.body.rotationNeeded], [2, false]);
  await assert.rejects(member.api.changes(vaultId, 0), (e) => e.status === 404 || e.status === 403);
  write(owner.file('Plans/After.md'), 'Made-up note after the removal.\n');
  await owner.engine().sync();
  step('member removed: key rotated to epoch 2, the member is refused');

  const inv3 = await call(tokens.owner, 'POST', `/teams/${teamId}/invites`, { email: third.me.account.email, role: 'member' });
  assert.equal((await call(tokens.third, 'POST', '/invites/accept', { token: inv3.body.url.split('#')[1] })).status, 200);
  await third.core.refresh();
  await owner.core.refresh();
  v = await third.core.refresh();
  assert.equal(v.vaults[0].hasKey, true);
  await third.core.joinVault(vaultId);
  await third.engine().sync();
  assert.deepEqual(tree(third.dir), tree(owner.dir));
  step('a newer member reads everything, before and after the rotation');

  assert.equal((await call(tokens.owner, 'PUT', `/teams/${teamId}/policy`, { mcp: { allowed: false }, audit: { uploadAgentAccess: true } })).status, 200);
  v = await third.core.refresh();
  assert.equal(v.policy.applied, true);
  assert.equal(v.audit.on, true);
  assert.equal(S.P.localMcpUnderPolicy({ on: true, level: 'edit' }).on, false);
  step(`team policy applied (${v.policy.words.length} rules), audit upload asked for`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
