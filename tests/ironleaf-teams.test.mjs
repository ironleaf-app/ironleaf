// node --test tests/ironleaf-teams.test.mjs — Ironleaf Teams in the app (src/main/teams/, src/main/sync/team-keys.ts):
// device keys and wraps (only the right device, vault and epoch open one), the key ring across rotations, and two
// simulated members sharing a team vault through a fake Ironleaf Cloud with the real one's rules: the admin makes the
// vault from her notes and her Ironleaf gives the member the key; both sync made-up notes; removing the member makes
// the admin's Ironleaf rotate the key, so the member's old key opens nothing new while a newer member reads it all;
// seat limits refuse an invite; the team's policy applies (machine policy still wins) and shows as "Managed by your
// team"; the opt-in audit upload sends what agents did only when the policy asks, and never a note's name.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-teams-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (f) => JSON.stringify(path.join(root, 'src', 'main', f));
  writeFileSync(
    entry,
    [
      ...['sync/crypto.ts', 'sync/protocol.ts', 'sync/local.ts', 'sync/engine.ts', 'sync/memory-api.ts', 'sync/team-keys.ts', 'teams/core.ts', 'teams/audit-upload.ts', 'teams/api.ts'].map((f) => `export * from ${src(f)};`),
      `export * as P from ${src('policy.ts')};`,
      `export * as E from ${src('enterprise.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'teams.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'teams.mjs')).href);
  S.P.setPolicyForTests({});
});
after(() => rmSync(work, { recursive: true, force: true }));

const write = (file, data) => (mkdirSync(path.dirname(file), { recursive: true }), writeFileSync(file, data));
const walk = (dir, rel = '') => readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(dir, rel ? `${rel}/${e.name}` : e.name) : [rel ? `${rel}/${e.name}` : e.name]));
const tree = (dir) => Object.fromEntries(walk(dir).sort().map((r) => [r, createHash('sha256').update(readFileSync(path.join(dir, r))).digest('hex')]));

/** A fake Ironleaf Cloud for Teams with the real one's rules (roles, seats, wraps per member device at the current
 *  epoch, removal drops wraps and marks rotation, rotation replaces every wrap), over a MemoryServer for the data. */
class FakeCloud {
  constructor(sync) {
    this.sync = sync;
    this.team = { id: randomUUID(), name: 'Acme', seats: 3, zitadelOrgId: 'org-acme' };
    this.members = new Map(); // account → role
    this.emails = new Map();
    this.devices = new Map(); // device → { account, publicKey }
    this.invites = [];
    this.vaults = new Map(); // id → { epoch, envelope, rotationNeeded, wraps: Map(device → { account, epoch, wrap }) }
    this.policy = {};
    this.audit = [];
  }
  addMember(account, role, email) {
    this.members.set(account, role);
    this.emails.set(account, email);
    const device = randomUUID();
    this.devices.set(device, { account, publicKey: null });
    return device;
  }
  err(status, code, message = code) {
    return Object.assign(new S.TeamsError(message, status, code));
  }
  role(account) {
    const r = this.members.get(account);
    if (!r) throw this.err(404, 'team_not_found');
    return r;
  }
  removeMember(account) {
    this.members.delete(account);
    for (const v of this.vaults.values()) {
      let had = false;
      for (const [dev, w] of v.wraps) if (w.account === account) (v.wraps.delete(dev), (had = true));
      if (had) v.rotationNeeded = true;
    }
  }
  memberDevice(device) {
    const d = this.devices.get(device);
    if (!d || !this.members.has(d.account)) throw this.err(404, 'device_not_found');
    return d;
  }
  /** One account's API. */
  api(account) {
    const c = this;
    const admin = () => ['owner', 'admin'].includes(c.role(account));
    const used = () => c.members.size + c.invites.length;
    const vault = (id) => {
      c.role(account);
      const v = c.vaults.get(id);
      if (!v) throw c.err(404, 'vault_not_found');
      return v;
    };
    const checkWraps = (wraps, asAdmin) => {
      for (const w of wraps) {
        const d = c.memberDevice(w.device);
        if (!asAdmin && d.account !== account) throw c.err(403, 'admin_only');
        if (d.publicKey !== w.publicKey) throw c.err(409, 'key_changed');
      }
    };
    return {
      teams: async () => (c.members.has(account) ? [{ id: c.team.id, name: c.team.name, seats: c.team.seats, role: c.role(account) }] : []),
      team: async () => ({ ...c.team, role: c.role(account), seatsUsed: used(), features: ['sync', 'teams'], members: [...c.members].map(([a, role]) => ({ accountId: a, email: c.emails.get(a), name: null, role })), ...(admin() ? { invites: c.invites } : {}) }),
      invite: async (_t, email, role) => {
        if (!admin()) throw c.err(403, 'admin_only');
        if (used() + 1 > c.team.seats) throw c.err(409, 'no_seats', 'All seats are taken (members and open invites). Add seats in Manage billing first.');
        const inv = { id: randomUUID(), email, role, expiresAt: new Date(Date.now() + 14 * 86400_000).toISOString() };
        c.invites.push(inv);
        return inv;
      },
      revokeInvite: async (_t, id) => void (c.invites = c.invites.filter((i) => i.id !== id)),
      setRole: async (_t, a, role) => {
        if (c.role(account) !== 'owner') throw c.err(403, 'owner_only');
        c.members.set(a, role);
      },
      removeMember: async (_t, a) => {
        if (!admin() && a !== account) throw c.err(403, 'not_allowed');
        c.removeMember(a);
      },
      policy: async () => ({ teamId: c.team.id, teamName: c.team.name, policy: c.policy, updatedAt: '2026-11-20T00:00:00Z' }),
      setDeviceKey: async (device, publicKey) => {
        const d = c.devices.get(device);
        if (!d || d.account !== account) throw c.err(404, 'device_not_found');
        if (d.publicKey !== publicKey) for (const v of c.vaults.values()) v.wraps.delete(device);
        d.publicKey = publicKey;
      },
      teamVaults: async (_t, device) => {
        c.role(account);
        return [...c.vaults].map(([id, v]) => {
          const w = device ? v.wraps.get(device) : null;
          return { id, created: 0, head: 0, envelope: v.envelope, epoch: v.epoch, rotationNeeded: v.rotationNeeded, wrap: w && w.epoch === v.epoch ? w.wrap : null };
        });
      },
      createTeamVault: async ({ id, envelope, wraps }) => {
        if (!admin()) throw c.err(403, 'admin_only');
        checkWraps(wraps, true);
        const v = { epoch: 1, envelope, rotationNeeded: false, wraps: new Map() };
        for (const w of wraps) v.wraps.set(w.device, { account: c.devices.get(w.device).account, epoch: 1, wrap: w.wrap });
        c.vaults.set(id, v);
        c.sync.vaults.set(id, { id, envelope, created: Date.now(), log: [], heads: new Map(), blobs: new Map(), devices: new Map() });
      },
      vaultMembers: async (id) => {
        const v = vault(id);
        return {
          epoch: v.epoch,
          rotationNeeded: v.rotationNeeded,
          members: [...c.members]
            .filter(([a]) => admin() || a === account)
            .map(([a, role]) => ({ account: a, email: c.emails.get(a), name: null, role, devices: [...c.devices].filter(([, d]) => d.account === a).map(([dev, d]) => ({ device: dev, name: 'PC', publicKey: d.publicKey, hasKey: v.wraps.get(dev)?.epoch === v.epoch })) })),
        };
      },
      addWraps: async (id, epoch, wraps) => {
        const v = vault(id);
        if (epoch !== v.epoch) throw c.err(409, 'stale_epoch');
        if (![...v.wraps.values()].some((w) => w.account === account && w.epoch === v.epoch)) throw c.err(403, 'no_key');
        checkWraps(wraps, admin());
        for (const w of wraps) v.wraps.set(w.device, { account: c.devices.get(w.device).account, epoch, wrap: w.wrap });
      },
      rotate: async (id, epoch, envelope, wraps) => {
        const v = vault(id);
        if (!admin()) throw c.err(403, 'admin_only');
        if (epoch !== v.epoch + 1) throw c.err(409, 'stale_epoch');
        checkWraps(wraps, true);
        v.wraps = new Map(wraps.map((w) => [w.device, { account: c.devices.get(w.device).account, epoch, wrap: w.wrap }]));
        Object.assign(v, { epoch, envelope, rotationNeeded: false });
      },
      uploadAudit: async (teamId, deviceId, events) => {
        c.role(account);
        c.audit.push(...events.map((e) => ({ ...e, teamId, deviceId })));
      },
    };
  }
}

/** One member's Ironleaf: the Teams core over the fake cloud, a key store the "OS" protects, and the open notes'
 *  sync (a binding that keeps the ring and runs a real SyncEngine over the shared MemoryServer). */
function member(cloud, server, account, device, name) {
  const dir = mkdtempSync(path.join(work, `${name}-`));
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
    api: cloud.api(account),
    account: { signedIn: async () => true, hasEntitlement: (k) => k === 'teams' || k === 'sync', deviceId: () => device, accountId: () => account },
    keys: { available: () => true, load: async () => kept, save: async (k) => void (kept = k) },
    sync,
    applyPolicy: (t) => S.P.setTeamPolicy(t),
    policyWords: (l) => S.P.policyView(l).locks.map((x) => x.words),
  });
  const engine = () =>
    new S.SyncEngine({
      api: server.api(),
      keys: new S.TeamKeyRing(rings.get(bound.vaultId), bound.vaultId),
      root: dir,
      device: { id: `sync-${name}`, name },
      writer: new S.FsWriter(dir, { deviceName: name, trash: async (abs) => rmSync(abs) }),
      store: new S.FileStateStore(path.join(work, `state-${name}.json`)),
      excluded: () => [],
      log: () => {},
    });
  return { core, dir, rings, bound, engine, file: (rel) => path.join(dir, ...rel.split('/')), keyPair: () => kept };
}

test('wraps: only this device, this vault and this epoch open one; the ring reads every epoch', () => {
  const me = { device: 'dev-1', keys: S.makeDeviceKeyPair() };
  const other = S.makeDeviceKeyPair();
  assert.ok(S.isPublicKey(me.keys.publicKey));
  const vk = Buffer.alloc(32, 7);
  const w = S.wrapVaultKey(vk, { device: 'dev-1', publicKey: me.keys.publicKey }, 'vault-a', 1);
  assert.ok(S.unwrapVaultKey(w, me, 'vault-a', 1).equals(vk));
  assert.throws(() => S.unwrapVaultKey(w, me, 'vault-b', 1), S.Tampered, 'another vault');
  assert.throws(() => S.unwrapVaultKey(w, me, 'vault-a', 2), S.Tampered, 'another epoch');
  assert.throws(() => S.unwrapVaultKey(w, { ...me, device: 'dev-2' }, 'vault-a', 1), S.Tampered, 'another device id');
  assert.throws(() => S.unwrapVaultKey(w, { device: 'dev-1', keys: other }, 'vault-a', 1), S.Tampered, 'another key pair');

  const { ring, envelope } = S.newTeamVault('vault-a', 'Plans');
  const r2 = S.rotateRing(ring);
  const env2 = S.teamEnvelope(r2, 'vault-a', 'Plans');
  assert.equal(env2.history.length, 1);
  // A newer member gets only the current key; the envelope gives them the earlier one.
  const opened = S.ringFrom(S.parseTeamEnvelope(JSON.stringify(env2)), 'vault-a', S.ringKey(r2));
  assert.deepEqual(opened, r2);
  assert.equal(S.openTeamName(env2, 'vault-a', r2), 'Plans');
  assert.equal(S.openTeamName(envelope, 'vault-a', ring), 'Plans');
  // Old items open with the ring; new ones never with the old key alone; slots stay the first key's.
  const k1 = new S.TeamKeyRing(ring, 'vault-a');
  const k2 = new S.TeamKeyRing(r2, 'vault-a');
  assert.equal(k1.slot('Plans.md'), k2.slot('Plans.md'));
  const oldMeta = k1.sealMeta(k1.slot('a.md'), { v: 1 });
  assert.deepEqual(k2.openMeta(k2.slot('a.md'), oldMeta), { v: 1 });
  const newMeta = k2.sealMeta(k2.slot('a.md'), { v: 2 });
  assert.throws(() => k1.openMeta(k1.slot('a.md'), newMeta), S.Tampered);
  const fk = k1.fileKey('f1');
  const chunk = k1.sealChunk(fk, 'f1', 0, Buffer.from('words'));
  assert.equal(k2.openChunk(k2.fileKey('f1'), 'f1', 0, chunk).toString(), 'words');
  assert.equal(k2.openDeviceName('d', k1.sealDeviceName('d', 'DESK')), 'DESK');
});

test('two members share a team vault; removal rotates the key; a newer member reads it all; seats; policy; audit', async () => {
  const server = new S.MemoryServer();
  const cloud = new FakeCloud(server);
  const anaDev = cloud.addMember('ana', 'owner', 'ana@example.test');
  const benDev = cloud.addMember('ben', 'member', 'ben@example.test');
  const ana = member(cloud, server, 'ana', anaDev, 'ANA');
  const ben = member(cloud, server, 'ben', benDev, 'BEN');

  // Each Ironleaf makes its key pair and registers the public half; the private half is kept by the OS store only.
  let vb = await ben.core.refresh();
  assert.equal(vb.status, 'ready', vb.error);
  assert.equal(vb.team.canAdmin, false);
  assert.equal(cloud.devices.get(benDev).publicKey, ben.keyPair().publicKey);
  await ana.core.refresh();

  // Ana shares her notes: the vault is made, and her Ironleaf gives Ben's PC the key at once.
  write(ana.file('Plans/Q1.md'), '# Q1\nHire two people.\n');
  write(ana.file('Clients/Harbour.md'), 'Call on Monday.\n');
  let va = await ana.core.createVault('Acme plans');
  assert.equal(va.vaults.length, 1);
  const vaultId = va.vaults[0].id;
  assert.deepEqual([va.vaults[0].name, va.vaults[0].hasKey, va.vaults[0].here], ['Acme plans', true, true]);
  assert.equal(cloud.vaults.get(vaultId).wraps.size, 2, 'Ana’s and Ben’s devices');
  for (const w of cloud.vaults.get(vaultId).wraps.values()) assert.ok(!w.wrap.includes('Acme'));
  assert.ok(!cloud.vaults.get(vaultId).envelope.includes('Acme plans'), 'the name is sealed');
  await ana.engine().sync();

  vb = await ben.core.refresh();
  assert.deepEqual([vb.vaults[0].name, vb.vaults[0].hasKey, vb.vaults[0].here], ['Acme plans', true, false]);
  vb = await ben.core.joinVault(vaultId);
  assert.equal(vb.vaults[0].here, true);
  await ben.engine().sync();
  assert.deepEqual(tree(ben.dir), tree(ana.dir));
  write(ben.file('Plans/Q2.md'), 'Ben’s ideas.\n');
  await ben.engine().sync();
  await ana.engine().sync();
  assert.deepEqual(tree(ana.dir), tree(ben.dir));
  const benOldRing = ben.rings.get(vaultId);

  // Seats: 3 seats, 2 members; one invite fills it, the next is refused in plain words.
  va = await ana.core.invite('cal@example.test', 'member');
  assert.equal(va.invites.length, 1);
  await assert.rejects(ana.core.invite('dee@example.test', 'member'), /All seats are taken/);
  await assert.rejects(ben.core.invite('dee@example.test', 'member'), /admin/i);

  // Ana removes Ben: the cloud drops their wraps and marks the vault; Ana's Ironleaf makes a new key straight
  // away.
  va = await ana.core.remove('ben');
  assert.equal(cloud.vaults.get(vaultId).epoch, 2);
  assert.equal(cloud.vaults.get(vaultId).rotationNeeded, false);
  assert.ok(va.notes.some((n) => /new key/.test(n)), va.notes.join(' | '));
  assert.ok(![...cloud.vaults.get(vaultId).wraps.values()].some((w) => w.account === 'ben'));
  assert.equal(ana.rings.get(vaultId).epoch, 2, 'Ana’s sync carries on with the new key');
  vb = await ben.core.refresh();
  assert.equal(vb.status, 'no-team');
  write(ana.file('Plans/After.md'), 'Decided after Ben left.\n');
  await ana.engine().sync();
  // Ben's old key opens what he already had, never what came after.
  const benKeys = new S.TeamKeyRing(benOldRing, vaultId);
  const log = server.vaults.get(vaultId).log;
  const last = log[log.length - 1];
  assert.throws(() => benKeys.openMeta(last.slot, last.meta), S.Tampered);
  assert.doesNotThrow(() => benKeys.openMeta(log[0].slot, log[0].meta));

  // Cal joins (the invite turns into a seat): her Ironleaf registers its key, Ana's gives it the epoch-2 key, and the
  // envelope gives her epoch 1's, so she reads everything, before and after the rotation.
  cloud.invites = [];
  const calDev = cloud.addMember('cal', 'member', 'cal@example.test');
  const cal = member(cloud, server, 'cal', calDev, 'CAL');
  let vc = await cal.core.refresh();
  assert.equal(vc.vaults[0].hasKey, false);
  await ana.core.refresh();
  vc = await cal.core.refresh();
  assert.equal(vc.vaults[0].hasKey, true);
  assert.equal(vc.vaults[0].name, 'Acme plans');
  await cal.core.joinVault(vaultId);
  assert.deepEqual(Object.keys(cal.rings.get(vaultId).keys).sort(), ['1', '2']);
  await cal.engine().sync();
  assert.deepEqual(tree(cal.dir), tree(ana.dir));
  assert.equal(readFileSync(cal.file('Plans/Q2.md'), 'utf8'), 'Ben’s ideas.\n');

  // The team's policy: applied, shown as the team's; the machine's own policy still wins where it speaks.
  cloud.policy = { mcp: { allowed: false }, askBeforeChanges: { forceOn: true }, audit: { uploadAgentAccess: true }, cloud: { disabled: true }, updates: { origin: 'https://updates.example.test' } };
  vc = await cal.core.refresh();
  assert.equal(vc.policy.applied, true);
  assert.ok(vc.policy.words.some((w) => /may not connect/.test(w)), vc.policy.words.join(' | '));
  const pv = S.P.policyView();
  assert.deepEqual([pv.team, pv.machine, pv.managed], ['Acme', false, true]);
  assert.equal(S.P.localMcpUnderPolicy({ on: true, level: 'edit' }).on, false);
  assert.equal(S.P.askBeforeChangesUnderPolicy(false), true);
  assert.equal(S.P.currentPolicy().policy.cloud, undefined, 'a team never moves or turns off the cloud');
  assert.equal(S.P.currentPolicy().policy.updates, undefined, 'nor where updates come from');
  S.P.setPolicyForTests({ mcp: { allowed: true } });
  assert.equal(S.P.localMcpUnderPolicy({ on: true, level: 'edit' }).on, true, 'the machine’s policy wins');
  assert.equal(S.P.policyView().machine, true);
  S.P.setPolicyForTests({});

  // The audit upload: on because the policy asks; what agents did goes up, never a note's name; other events never.
  const up = new S.AuditUploader({ target: () => cal.core.auditTarget(), upload: (t, d, e) => cloud.api('cal').uploadAudit(t, d, e) }, 10);
  const off = S.E.addAuditSink(up);
  S.E.audit({ kind: 'agent.access', actor: 'Claude', target: 'Clients/Harbour.md', outcome: 'done', detail: { agent: 'a1', tool: 'note_read' } });
  S.E.audit({ kind: 'policy.loaded', actor: 'system', detail: { sources: '/etc/ironleaf/policy.json' } });
  await up.flush();
  assert.equal(cloud.audit.length, 1);
  assert.deepEqual(cloud.audit[0].detail, { agent: 'a1', agentName: 'Claude', tool: 'note_read', outcome: 'done' });
  assert.equal(cloud.audit[0].teamId, cloud.team.id);
  assert.ok(!JSON.stringify(cloud.audit).includes('Harbour'));
  // The policy stops asking: nothing more is kept or sent, and the team's policy comes off when there is none.
  cloud.policy = {};
  vc = await cal.core.refresh();
  assert.equal(vc.audit.on, false);
  S.E.audit({ kind: 'agent.access', actor: 'Claude', outcome: 'done', detail: { agent: 'a1', tool: 'note_read' } });
  await up.flush();
  assert.equal(cloud.audit.length, 1);
  off();
  S.P.setTeamPolicy(null);
  assert.equal(S.P.policyView().managed, false);
});

test('a member gives their own new PC the key; only admins wrap for others; rotation needs an admin', async () => {
  const server = new S.MemoryServer();
  const cloud = new FakeCloud(server);
  const anaDev = cloud.addMember('ana', 'admin', 'ana@example.test');
  const benDev = cloud.addMember('ben', 'member', 'ben@example.test');
  const ana = member(cloud, server, 'ana', anaDev, 'ANA2');
  const ben = member(cloud, server, 'ben', benDev, 'BEN2');
  await ben.core.refresh();
  await ana.core.refresh();
  const vaultId = (await ana.core.createVault('Shared')).vaults[0].id;
  await ben.core.refresh();
  // Ben's second PC appears (its own key); Ben's first PC, holding the key, gives it.
  const benDev2 = randomUUID();
  cloud.devices.set(benDev2, { account: 'ben', publicKey: null });
  const ben2 = member(cloud, server, 'ben', benDev2, 'BEN2-LAPTOP');
  await ben2.core.refresh();
  const vb = await ben.core.refresh();
  assert.ok(vb.notes.some((n) => /Gave 1 PC/.test(n)), vb.notes.join(' | '));
  assert.equal((await ben2.core.refresh()).vaults[0].hasKey, true);
  await assert.rejects(ben.core.rotateNow(vaultId), /owners and admins/);
  // A refused wrap (Ben for someone else's device) is the cloud's rule too.
  await assert.rejects(cloud.api('ben').addWraps(vaultId, 1, [{ device: anaDev, publicKey: cloud.devices.get(anaDev).publicKey, wrap: 'x'.repeat(40) }]), /admin_only/);
  const va = await ana.core.rotateNow(vaultId);
  assert.equal(va.vaults[0].epoch, 2);
  assert.equal((await ben2.core.refresh()).vaults[0].hasKey, true, 'every member device got the new key');
});
