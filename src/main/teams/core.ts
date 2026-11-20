// SPDX-License-Identifier: AGPL-3.0-or-later
// Ironleaf Teams in the app (Ironleaf Cloud's docs/TEAMS.md, docs/SYNC.md § Teams): the team, its members, roles and
// invites, its shared vaults and their keys, and its policy. No Electron here: service.ts hands in the protected store
// and the IPC, and the checks hand in a fake cloud.
//
// Keys: each PC has an X25519 key pair (team-keys.ts); the private half is sealed by the operating system and never
// leaves the PC, the public half is registered with this PC's account device. A team vault's key reaches a PC as a
// wrap to that public key. This PC, once it holds a vault's key, quietly does two jobs on each refresh:
//   - shares the key with member devices that have none yet (an admin: anyone's; a member: their own other PCs);
//   - an admin's PC makes a new key after someone left (the server marks the vault), wrapping it to every remaining
//     device, with the earlier keys sealed under it so newer members can still read what came before.
// The server only ever sees public keys, wraps and sealed envelopes.

import { randomUUID } from 'node:crypto';
import type { LoadedPolicy } from '../policy';
import type { TeamSyncBinding } from '../sync/service';
import { makeDeviceKeyPair, newTeamVault, openTeamName, parseTeamEnvelope, ringFrom, rotateRing, teamEnvelope, unwrapVaultKey, wrapVaultKey, type DeviceKeyPair, type Ring } from '../sync/team-keys';
import { TeamsError, type TeamDetail, type TeamsApi, type TeamVaultRow, type WrapOut } from './api';
import { EMPTY_TEAMS_VIEW, type Role, type TeamsView } from './view';

export interface TeamsAccount {
  /** Signed in (a token can be had). */
  signedIn(): Promise<boolean>;
  hasEntitlement(key: string): boolean;
  /** This PC's id at the cloud (account device registration), once registered. */
  deviceId(): string | undefined;
  /** The account's id at the cloud, once /me has answered. */
  accountId(): string | undefined;
}

export interface DeviceKeyStore {
  /** Whether the OS can protect the private key here. */
  available(): boolean;
  load(): Promise<DeviceKeyPair | null>;
  save(k: DeviceKeyPair): Promise<void>;
}

export interface TeamsDeps {
  api: TeamsApi;
  account: TeamsAccount;
  keys: DeviceKeyStore;
  /** The open notes' sync (src/main/sync/service.ts); null when sync isn't there (checks). */
  sync: TeamSyncBinding | null;
  /** Applies the team's policy (policy.ts › setTeamPolicy) and returns the policy in force. */
  applyPolicy(t: { name: string; policy: unknown } | null): LoadedPolicy;
  /** The words of each policy lock, for the page. */
  policyWords(l: LoadedPolicy): string[];
  audit?: { waiting: number; sent: number; flush(): Promise<void> };
  log?(m: string): void;
}

const emailOk = (e: string) => /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(e) && e.length <= 320;

export class TeamsCore {
  private v: TeamsView = EMPTY_TEAMS_VIEW;
  private selected: string | null = null;
  private detail: TeamDetail | null = null;
  private rows: TeamVaultRow[] = [];
  private rings = new Map<string, Ring>();
  private names = new Map<string, string>();
  private device: DeviceKeyPair | null = null;
  private registered: string | null = null;
  private policyApplied: { teamId: string; updatedAt: number | null; words: string[]; audit: boolean } | null = null;
  private notes: string[] = [];
  private refreshing: Promise<TeamsView> | null = null;

  constructor(private readonly d: TeamsDeps) {}

  view(): TeamsView {
    return this.v;
  }

  /** The team whose policy asks for the audit upload (audit-upload.ts), or null: nothing is kept or sent. */
  auditTarget(): { teamId: string; deviceId: string | null } | null {
    return this.policyApplied?.audit ? { teamId: this.policyApplied.teamId, deviceId: this.d.account.deviceId() ?? null } : null;
  }

  private log(m: string): void {
    this.d.log?.(`Teams: ${m}`);
  }

  /** Reads everything again (and does the key jobs). Never throws; a problem is in view.error. */
  refresh(o: { team?: string } = {}): Promise<TeamsView> {
    if (o.team) this.selected = o.team;
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async doRefresh(): Promise<TeamsView> {
    this.notes = [];
    try {
      if (!(await this.d.account.signedIn())) return this.reset('signed-out');
      if (!this.d.account.hasEntitlement('teams')) return this.reset('no-teams');
      const teams = await this.d.api.teams();
      if (!teams.length) return this.reset('no-team');
      const pick = teams.find((t) => t.id === this.selected) ?? teams[0]!;
      this.selected = pick.id;
      this.detail = await this.d.api.team(pick.id);
      await this.applyPolicy(pick.id);
      await this.ensureDeviceKey();
      await this.loadVaults();
      await this.keyJobs();
      return this.build(teams.map((t) => ({ id: t.id, name: t.name })));
    } catch (err) {
      this.log(`refresh: ${(err as Error).message}`);
      this.v = { ...this.v, error: (err as Error).message, notes: this.notes };
      return this.v;
    }
  }

  private reset(status: TeamsView['status']): TeamsView {
    this.detail = null;
    this.rows = [];
    if (this.policyApplied) this.d.applyPolicy(null);
    this.policyApplied = null;
    this.v = { ...EMPTY_TEAMS_VIEW, status, keyProtected: this.d.keys.available() };
    return this.v;
  }

  private async applyPolicy(teamId: string): Promise<void> {
    try {
      const p = await this.d.api.policy(teamId);
      if (!p.teamId || p.policy === null || p.policy === undefined) {
        if (this.policyApplied) this.d.applyPolicy(null);
        this.policyApplied = null;
        return;
      }
      const l = this.d.applyPolicy({ name: p.teamName ?? 'your team', policy: p.policy });
      this.policyApplied = { teamId: p.teamId, updatedAt: p.updatedAt ? Date.parse(p.updatedAt) || null : null, words: this.d.policyWords(l), audit: l.policy.audit?.uploadAgentAccess === true };
    } catch (err) {
      // Offline: the policy applied this run stays as it is.
      if (!(err instanceof TeamsError && err.status === 0)) throw err;
      this.notes.push('Offline: the team’s policy stays as it was.');
    }
  }

  /** This PC's key pair (made once, kept by the OS) and its public half on this PC's account device. */
  private async ensureDeviceKey(): Promise<DeviceKeyPair | null> {
    if (!this.d.keys.available()) return null;
    this.device ??= await this.d.keys.load();
    if (!this.device) {
      this.device = makeDeviceKeyPair();
      await this.d.keys.save(this.device);
      this.log('made this PC’s team key');
    }
    const id = this.d.account.deviceId();
    if (id && this.registered !== `${id}:${this.device.publicKey}`) {
      await this.d.api.setDeviceKey(id, this.device.publicKey);
      this.registered = `${id}:${this.device.publicKey}`;
    }
    return this.device;
  }

  private me(): { device: string; keys: DeviceKeyPair } | null {
    const id = this.d.account.deviceId();
    return id && this.device ? { device: id, keys: this.device } : null;
  }

  /** The team's vaults, and the key ring of each this PC can open. */
  private async loadVaults(): Promise<void> {
    const me = this.me();
    this.rows = await this.d.api.teamVaults(this.selected!, me?.device ?? null);
    for (const row of this.rows) {
      try {
        const env = parseTeamEnvelope(row.envelope);
        let ring = this.rings.get(row.id) ?? (await this.d.sync?.ring(row.id)) ?? null;
        if ((!ring || ring.epoch < row.epoch) && row.wrap && me) {
          const vk = unwrapVaultKey(row.wrap, me, row.id, row.epoch);
          const fresh = ringFrom(env, row.id, vk);
          // Keep any older key this PC had that the envelope doesn't list.
          ring = { ...fresh, keys: { ...(ring?.keys ?? {}), ...fresh.keys } };
          await this.d.sync?.rekey(row.id, ring);
        }
        if (ring && ring.epoch === row.epoch) {
          this.rings.set(row.id, ring);
          this.names.set(row.id, openTeamName(env, row.id, ring));
        } else if (ring) this.rings.set(row.id, ring);
      } catch (err) {
        this.notes.push(`A team vault’s key couldn’t be opened on this PC (${(err as Error).message}).`);
      }
    }
  }

  private holdsCurrent(row: TeamVaultRow): Ring | null {
    const r = this.rings.get(row.id);
    return r && r.epoch === row.epoch ? r : null;
  }

  private role(): Role {
    return (this.detail?.role ?? 'member') as Role;
  }
  private isAdmin(): boolean {
    return this.role() === 'owner' || this.role() === 'admin';
  }

  /** Rotation after someone left (admins), then the key shared with devices that have none. */
  private async keyJobs(): Promise<void> {
    const me = this.me();
    if (!me) return;
    for (const row of this.rows) {
      const ring = this.holdsCurrent(row);
      if (!ring) continue;
      try {
        if (row.rotationNeeded && this.isAdmin()) {
          await this.rotate(row, ring);
          this.notes.push(`Made a new key for ${this.names.get(row.id) ?? 'a team vault'} after someone left.`);
          continue;
        }
        const n = await this.share(row.id, ring);
        if (n) this.notes.push(`Gave ${n} PC${n === 1 ? '' : 's'} the key to ${this.names.get(row.id) ?? 'a team vault'}.`);
      } catch (err) {
        this.notes.push(`${this.names.get(row.id) ?? 'A team vault'}: ${(err as Error).message}`);
      }
    }
  }

  /** Wraps the current key for member devices that have a public key and no wrap (members: their own only). */
  private async share(vaultId: string, ring: Ring): Promise<number> {
    const m = await this.d.api.vaultMembers(vaultId);
    if (m.epoch !== ring.epoch) return 0;
    const vk = Buffer.from(ring.keys[String(ring.epoch)]!, 'base64');
    const mine = this.d.account.accountId();
    const wraps: WrapOut[] = [];
    for (const member of m.members) {
      if (!this.isAdmin() && member.account !== mine) continue;
      for (const dev of member.devices) if (!dev.hasKey && dev.publicKey) wraps.push({ device: dev.device, publicKey: dev.publicKey, wrap: wrapVaultKey(vk, { device: dev.device, publicKey: dev.publicKey }, vaultId, ring.epoch) });
    }
    if (wraps.length) await this.d.api.addWraps(vaultId, ring.epoch, wraps);
    return wraps.length;
  }

  /** A new key at the next epoch, wrapped to every remaining member device with a public key. */
  private async rotate(row: TeamVaultRow, ring: Ring): Promise<Ring> {
    const next = rotateRing(ring);
    const name = this.names.get(row.id) ?? 'Team vault';
    const vk = Buffer.from(next.keys[String(next.epoch)]!, 'base64');
    const m = await this.d.api.vaultMembers(row.id);
    const wraps: WrapOut[] = [];
    for (const member of m.members) for (const dev of member.devices) if (dev.publicKey) wraps.push({ device: dev.device, publicKey: dev.publicKey, wrap: wrapVaultKey(vk, { device: dev.device, publicKey: dev.publicKey }, row.id, next.epoch) });
    await this.d.api.rotate(row.id, next.epoch, JSON.stringify(teamEnvelope(next, row.id, name)), wraps);
    this.rings.set(row.id, next);
    row.epoch = next.epoch;
    row.rotationNeeded = false;
    await this.d.sync?.rekey(row.id, next);
    this.log(`rotated a team vault's key (epoch ${next.epoch}, ${wraps.length} devices)`);
    return next;
  }

  private build(teams: { id: string; name: string }[]): TeamsView {
    const t = this.detail!;
    const mine = this.d.account.accountId();
    const here = this.d.sync?.current() ?? null;
    this.v = {
      status: 'ready',
      notes: this.notes,
      teams,
      team: { id: t.id, name: t.name, role: t.role, seats: t.seats, seatsUsed: t.seatsUsed, sso: !!t.zitadelOrgId, canAdmin: this.isAdmin(), isOwner: t.role === 'owner' },
      members: t.members.map((m) => ({ accountId: m.accountId, name: m.name ?? '', email: m.email ?? '', role: m.role, me: m.accountId === mine })),
      invites: (t.invites ?? []).map((i) => ({ id: i.id, email: i.email, role: i.role, expires: Date.parse(i.expiresAt) || 0 })),
      vaults: this.rows.map((r) => ({ id: r.id, name: this.holdsCurrent(r) ? (this.names.get(r.id) ?? null) : null, epoch: r.epoch, rotationNeeded: r.rotationNeeded, hasKey: !!this.holdsCurrent(r), here: !!here && here.on && here.vaultId === r.id })),
      here: { notesOpen: !!here, syncOn: !!here?.on, teamVault: here?.on && here.teamId ? here.vaultId : null },
      policy: { applied: !!this.policyApplied, words: this.policyApplied?.words ?? [], updatedAt: this.policyApplied?.updatedAt ?? null },
      audit: { on: !!this.policyApplied?.audit, waiting: this.d.audit?.waiting ?? 0, sent: this.d.audit?.sent ?? 0 },
      keyProtected: this.d.keys.available(),
    };
    return this.v;
  }

  // ── Admin console basics ──────────────────────────────────────────────────────────────────────────────────────────

  private async act(fn: (teamId: string) => Promise<unknown>): Promise<TeamsView> {
    if (!this.selected || !this.detail) throw new Error('Open Settings › Teams once you’re in a team.');
    await fn(this.selected);
    return this.refresh();
  }

  invite(email: unknown, role: unknown): Promise<TeamsView> {
    const e = String(email ?? '').trim().toLowerCase();
    if (!emailOk(e)) throw new Error('Type the person’s email address.');
    return this.act((t) => this.d.api.invite(t, e, role === 'admin' ? 'admin' : 'member'));
  }

  revokeInvite(id: unknown): Promise<TeamsView> {
    return this.act((t) => this.d.api.revokeInvite(t, String(id ?? '')));
  }

  setRole(accountId: unknown, role: unknown): Promise<TeamsView> {
    if (role !== 'admin' && role !== 'member' && role !== 'owner') throw new Error('Choose a role.');
    return this.act((t) => this.d.api.setRole(t, String(accountId ?? ''), role));
  }

  remove(accountId: unknown): Promise<TeamsView> {
    return this.act((t) => this.d.api.removeMember(t, String(accountId ?? '')));
  }

  // ── Shared vaults ─────────────────────────────────────────────────────────────────────────────────────────────────

  private needKeys(): { device: string; keys: DeviceKeyPair } {
    if (!this.d.keys.available()) throw new Error('This PC can’t protect a team key (no system keyring), so team vaults can’t be used here.');
    const me = this.me();
    if (!me) throw new Error('This PC isn’t registered with your account yet. Open Settings › Account and plan, then try again.');
    return me;
  }

  /** Makes a team vault from the open notes (admins), wraps its key for every member device, and starts syncing. */
  async createVault(name: unknown): Promise<TeamsView> {
    const n = String(name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100);
    if (!n) throw new Error('Give the shared vault a name.');
    if (!this.isAdmin()) throw new Error('Only the team’s owners and admins make shared vaults.');
    const here = this.d.sync?.current();
    if (this.d.sync && !here) throw new Error('Open the notes folder to share first.');
    if (here?.on) throw new Error('These notes already sync. Turn sync off in Settings › Backups and sync first, or open another notes folder.');
    const me = this.needKeys();
    const id = randomUUID();
    const { ring, envelope } = newTeamVault(id, n);
    const vk = Buffer.from(ring.keys['1']!, 'base64');
    await this.d.api.createTeamVault({ id, teamId: this.selected!, envelope: JSON.stringify(envelope), wraps: [{ device: me.device, publicKey: me.keys.publicKey, wrap: wrapVaultKey(vk, { device: me.device, publicKey: me.keys.publicKey }, id, 1) }] });
    this.rings.set(id, ring);
    this.names.set(id, n);
    await this.share(id, ring).catch((err) => this.notes.push(`Shared with the team at the next refresh (${(err as Error).message}).`));
    await this.d.sync?.begin(id, this.selected!, ring);
    this.log('made a team vault');
    return this.refresh();
  }

  /** Syncs the open notes with a team vault this PC holds the key to. */
  async joinVault(id: unknown): Promise<TeamsView> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error('That shared vault isn’t in your team.');
    const ring = this.holdsCurrent(row);
    if (!ring) throw new Error('This PC doesn’t have this vault’s key yet. It arrives when a team admin’s Ironleaf (or your other PC) is next online.');
    if (this.d.sync && !this.d.sync.current()) throw new Error('Open an empty notes folder (or the one to fill) first.');
    await this.d.sync?.begin(row.id, this.selected!, ring);
    return this.refresh();
  }

  /** An admin's new key for a vault, now (also done by itself after someone leaves). */
  async rotateNow(id: unknown): Promise<TeamsView> {
    if (!this.isAdmin()) throw new Error('Only the team’s owners and admins change a vault’s key.');
    const row = this.rows.find((r) => r.id === id);
    const ring = row && this.holdsCurrent(row);
    if (!row || !ring) throw new Error('This PC doesn’t hold that vault’s key.');
    await this.rotate(row, ring);
    return this.refresh();
  }

  /** The ring this core holds for a vault (checks, and the engine that runs outside the app's sync). */
  ringOf(id: string): Ring | null {
    return this.rings.get(id) ?? null;
  }
}
