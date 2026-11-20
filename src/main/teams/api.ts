// SPDX-License-Identifier: AGPL-3.0-or-later
// Ironleaf Teams' cloud calls (Ironleaf Cloud's docs/CONTRACT.md "Teams" and docs/TEAMS.md), as the app makes them:
//   GET  /teams, /teams/:id                    the team, its members, seats (admins: open invites)
//   POST /teams/:id/invites  DELETE …/:invite   invite by email (the server mails the link), withdraw
//   PATCH/DELETE /teams/:id/members/:account    change a role (owner), remove (admins: members; owner: admins)
//   GET  /policy?team=                           the team's policy (src/main/policy.ts schema)
//   PUT  /devices/:id/key                        this PC's X25519 public key for team vault wraps
//   GET  /sync/teams/:team/vaults?device=        the team's vaults, with this PC's wrap of each
//   POST /sync/team-vaults                       a new team vault with its first wraps
//   GET  /sync/:vault/members                    member devices and whether each holds the key
//   PUT  /sync/:vault/wraps  POST …/rotate       share the key with more devices; a new key after someone left
//   POST /audit                                  the opt-in audit upload
// Every call carries the account's bearer token. Answers are read leniently; nothing here logs a body.

export class TeamsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = '',
  ) {
    super(message);
  }
}

export type TeamRole = 'owner' | 'admin' | 'member';

export interface TeamSummary {
  id: string;
  name: string;
  seats: number;
  role: TeamRole;
}

export interface TeamDetail extends TeamSummary {
  seatsUsed: number;
  features: string[];
  zitadelOrgId: string | null;
  members: { accountId: string; email: string | null; name: string | null; role: TeamRole; joinedAt?: string }[];
  invites?: { id: string; email: string; role: 'admin' | 'member'; expiresAt: string }[];
}

export interface TeamVaultRow {
  id: string;
  created: number;
  head: number;
  envelope: string;
  epoch: number;
  rotationNeeded: boolean;
  /** This PC's wrap of the current key, or null until someone holding the key gives it. */
  wrap: string | null;
}

export interface VaultMembers {
  epoch: number;
  rotationNeeded: boolean;
  members: { account: string; email: string | null; name: string | null; role: TeamRole; devices: { device: string; name: string; publicKey: string | null; hasKey: boolean }[] }[];
}

export interface WrapOut {
  device: string;
  publicKey: string;
  wrap: string;
}

export interface AuditOut {
  kind: string;
  at: string;
  detail?: Record<string, string | number | boolean | null>;
}

export interface TeamsApi {
  teams(): Promise<TeamSummary[]>;
  team(id: string): Promise<TeamDetail>;
  invite(teamId: string, email: string, role: 'admin' | 'member'): Promise<{ id: string; expiresAt: string }>;
  revokeInvite(teamId: string, inviteId: string): Promise<void>;
  setRole(teamId: string, accountId: string, role: TeamRole): Promise<void>;
  removeMember(teamId: string, accountId: string): Promise<void>;
  policy(teamId: string): Promise<{ teamId: string | null; teamName: string | null; policy: unknown; updatedAt: string | null }>;
  setDeviceKey(deviceId: string, publicKey: string): Promise<void>;
  teamVaults(teamId: string, deviceId: string | null): Promise<TeamVaultRow[]>;
  createTeamVault(body: { id: string; teamId: string; envelope: string; wraps: WrapOut[] }): Promise<void>;
  vaultMembers(vaultId: string): Promise<VaultMembers>;
  addWraps(vaultId: string, epoch: number, wraps: WrapOut[]): Promise<void>;
  rotate(vaultId: string, epoch: number, envelope: string, wraps: WrapOut[]): Promise<void>;
  uploadAudit(teamId: string, deviceId: string | null, events: AuditOut[]): Promise<void>;
}

const WORDS: Record<string, string> = {
  no_seats: 'All seats are taken (members and open invites). Add seats in Manage billing first.',
  invite_exists: 'That person already has an invite.',
  already_member: 'That person is already in the team.',
  owner_only: 'Only the team’s owner can do that.',
  admin_only: 'Only the team’s owners and admins can do that.',
  not_allowed: 'Admins remove members; only the owner removes admins.',
  owner_cannot_leave: 'Hand the team to someone else before the owner leaves.',
  seats_exceeded: 'The team has more members than paid seats, so team vaults are read-only until an admin adds seats.',
  entitlement_required: 'This needs Ironleaf Teams.',
  stale_epoch: 'The team vault’s key changed meanwhile. Try again.',
  key_changed: 'A member’s PC changed its key meanwhile. Try again.',
  no_key: 'This PC doesn’t hold the team vault’s key yet.',
};

const enc = encodeURIComponent;

export class HttpTeamsApi implements TeamsApi {
  constructor(
    private readonly base: () => string,
    private readonly token: () => Promise<string | null>,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, route: string, body?: unknown): Promise<T> {
    const token = await this.token();
    if (!token) throw new TeamsError('Sign in to your Ironleaf account first.', 401, 'signed_out');
    let res: Response;
    try {
      res = await this.fetchFn(this.base().replace(/\/$/, '') + route, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new TeamsError('Ironleaf Cloud could not be reached.', 0, 'offline');
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) {
      const e = (parsed && typeof parsed === 'object' ? parsed : {}) as { error?: unknown; message?: unknown };
      const code = typeof e.error === 'string' ? e.error.slice(0, 60) : '';
      throw new TeamsError(WORDS[code] ?? (typeof e.message === 'string' && e.message ? e.message.slice(0, 200) : `Ironleaf Cloud answered ${res.status}.`), res.status, code);
    }
    return parsed as T;
  }

  async teams() {
    return (await this.call<{ teams: TeamSummary[] }>('GET', '/teams')).teams ?? [];
  }
  team(id: string) {
    return this.call<TeamDetail>('GET', `/teams/${enc(id)}`);
  }
  invite(teamId: string, email: string, role: 'admin' | 'member') {
    return this.call<{ id: string; expiresAt: string }>('POST', `/teams/${enc(teamId)}/invites`, { email, role });
  }
  async revokeInvite(teamId: string, inviteId: string) {
    await this.call('DELETE', `/teams/${enc(teamId)}/invites/${enc(inviteId)}`);
  }
  async setRole(teamId: string, accountId: string, role: TeamRole) {
    await this.call('PATCH', `/teams/${enc(teamId)}/members/${enc(accountId)}`, { role });
  }
  async removeMember(teamId: string, accountId: string) {
    await this.call('DELETE', `/teams/${enc(teamId)}/members/${enc(accountId)}`);
  }
  policy(teamId: string) {
    return this.call<{ teamId: string | null; teamName: string | null; policy: unknown; updatedAt: string | null }>('GET', `/policy?team=${enc(teamId)}`);
  }
  async setDeviceKey(deviceId: string, publicKey: string) {
    await this.call('PUT', `/devices/${enc(deviceId)}/key`, { publicKey });
  }
  async teamVaults(teamId: string, deviceId: string | null) {
    return (await this.call<{ vaults: TeamVaultRow[] }>('GET', `/sync/teams/${enc(teamId)}/vaults${deviceId ? `?device=${enc(deviceId)}` : ''}`)).vaults ?? [];
  }
  async createTeamVault(body: { id: string; teamId: string; envelope: string; wraps: WrapOut[] }) {
    await this.call('POST', '/sync/team-vaults', body);
  }
  vaultMembers(vaultId: string) {
    return this.call<VaultMembers>('GET', `/sync/${enc(vaultId)}/members`);
  }
  async addWraps(vaultId: string, epoch: number, wraps: WrapOut[]) {
    await this.call('PUT', `/sync/${enc(vaultId)}/wraps`, { epoch, wraps });
  }
  async rotate(vaultId: string, epoch: number, envelope: string, wraps: WrapOut[]) {
    await this.call('POST', `/sync/${enc(vaultId)}/rotate`, { epoch, envelope, wraps });
  }
  async uploadAudit(teamId: string, deviceId: string | null, events: AuditOut[]) {
    await this.call('POST', '/audit', { teamId, ...(deviceId ? { deviceId } : {}), events });
  }
}
