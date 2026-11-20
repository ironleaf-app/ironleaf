// SPDX-License-Identifier: AGPL-3.0-or-later
// Managed policy: the settings an organisation sets for every Ironleaf on its machines (docs/EDITIONS.md).
//
// Policy is part of the open core on purpose. It is how IT departments deploy any desktop app (Group Policy, Intune,
// a file dropped by Ansible or a package), it costs nothing to honour, and keeping it here means an enterprise build is
// a module that adds features, never a fork that changes the decision points. Nothing in this file is paywalled and
// nothing in it phones home: it only reads files and registry values on this machine.
//
// Where policy is read (the first found of each kind; the registry wins over the file when both set a value):
//   Windows  HKLM\SOFTWARE\Policies\Ironleaf  (REG_SZ "Policy" holding JSON, and/or one value per dotted name,
//                                              e.g. REG_DWORD "mcp.allowed" = 0, REG_SZ "updates.channel" = "stable")
//            %ProgramData%\Ironleaf\policy.json
//   Linux    /etc/ironleaf/policy.json
//   macOS    /Library/Application Support/Ironleaf/policy.json
// Per-user locations are deliberately not read: a policy the user can edit is not a policy.
//
// Every value is optional. No file and no registry key: no policy, and Ironleaf behaves exactly as it always has.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type ManagedProviderKind = 'anthropic' | 'openai' | 'google' | 'ollama' | 'custom';
const PROVIDER_KINDS: readonly ManagedProviderKind[] = ['anthropic', 'openai', 'google', 'ollama', 'custom'];
const API_FORMATS = ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'] as const;
export type ManagedApiFormat = (typeof API_FORMATS)[number];

/** An AI connection the organisation provides: shown to everyone, not editable or removable by the person. */
export interface ManagedConnection {
  /** Stable id (letters, digits, - and _); Ironleaf shows it as `managed-<id>`. */
  id: string;
  name: string;
  kind: ManagedProviderKind;
  baseURL?: string;
  api?: ManagedApiFormat;
  models: string[];
  /** The endpoint needs no key (a company gateway that authenticates by network or by the enterprise module). */
  noAuth?: boolean;
  /** The name of an environment variable holding the key (set by the deployment). The key itself never goes in policy. */
  apiKeyEnv?: string;
}

export interface ManagedPolicy {
  ai?: {
    /** Only these kinds of connection may be added or used. Absent: all. */
    allowedProviders?: ManagedProviderKind[];
    /** Connections provided by the organisation. */
    managedConnections?: ManagedConnection[];
    /** false: the person may not add their own connections or keys; only managed connections are offered. */
    allowPersonalKeys?: boolean;
  };
  mcp?: {
    /** false: other AI apps may not connect (the local MCP server stays off, and agent keys cannot be made). */
    allowed?: boolean;
    /** The highest level the person may choose for other AI apps. */
    maxLevel?: 'read' | 'edit';
  };
  updates?: {
    /** true: Ironleaf never checks for updates (the organisation deploys them). */
    disabled?: boolean;
    /** A release channel to pin to ("stable" is the default site layout). */
    channel?: string;
    /** An internal update server (https://…) that mirrors the release site's layout. */
    origin?: string;
  };
  /** Ironleaf accounts (src/main/account): an organisation's own cloud (https://…, the API at <origin>/api/v1), or none. */
  cloud?: {
    /** true: no sign-in on these machines (nothing contacts the cloud). */
    disabled?: boolean;
    origin?: string;
  };
  /** Ironleaf collects no telemetry. The only accepted value is "none"; anything else is reported as a problem. */
  telemetry?: 'none';
  askBeforeChanges?: {
    /** true: the assistant always asks before it changes a note, whatever the person chose. */
    forceOn?: boolean;
  };
  /** Ironleaf Teams (src/main/teams): what goes to the team's audit trail. Nothing leaves the PC unless asked. */
  audit?: {
    /** true: what AI apps and agents did here (What agents did: which tool, which agent, the outcome; never a note's
     *  name or words) is uploaded to the team's audit trail. */
    uploadAgentAccess?: boolean;
  };
}

export interface LoadedPolicy {
  policy: ManagedPolicy;
  /** Where each part came from, for the About page and support ("registry", a file path, "team: <name>"). */
  sources: string[];
  /** Values that were present but not understood, in plain words. They are ignored, never guessed. */
  problems: string[];
  /** The Ironleaf Teams team whose policy is part of this one (GET /policy), when there is one. */
  team?: string;
}

export const MANAGED_WORDS = 'Managed by your organisation';

// ── Parsing ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const asBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : v === 1 || v === '1' || v === 'true' ? true : v === 0 || v === '0' || v === 'false' ? false : undefined);

function cleanConnection(v: unknown, problems: string[]): ManagedConnection | null {
  if (!isObj(v)) return problems.push('ai.managedConnections: an entry is not an object'), null;
  const id = typeof v.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v.id) ? v.id : '';
  const kind = PROVIDER_KINDS.find((k) => k === v.kind);
  const models = Array.isArray(v.models) ? v.models.filter((m): m is string => typeof m === 'string' && !!m.trim()).map((m) => m.trim().slice(0, 200)) : [];
  if (!id || !kind || !models.length) return problems.push(`ai.managedConnections: "${String(v.id ?? '?')}" needs an id, a kind and at least one model`), null;
  let baseURL: string | undefined;
  if (v.baseURL !== undefined) {
    try {
      const u = new URL(String(v.baseURL));
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
      baseURL = u.toString().replace(/\/$/, '');
    } catch {
      problems.push(`ai.managedConnections: "${id}" has a baseURL that is not an http(s) address`);
      return null;
    }
  }
  const api = API_FORMATS.find((a) => a === v.api);
  const apiKeyEnv = typeof v.apiKeyEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(v.apiKeyEnv) ? v.apiKeyEnv : undefined;
  return {
    id,
    name: typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 80) : id,
    kind,
    models,
    ...(baseURL ? { baseURL } : {}),
    ...(api ? { api } : {}),
    ...(asBool(v.noAuth) === true ? { noAuth: true } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
  };
}

/** Reads one policy document (JSON already parsed). Unknown keys are ignored; bad values are reported and dropped. */
export function parsePolicy(raw: unknown, problems: string[] = []): ManagedPolicy {
  const out: ManagedPolicy = {};
  if (!isObj(raw)) {
    if (raw !== undefined && raw !== null) problems.push('the policy is not a JSON object');
    return out;
  }
  if (isObj(raw.ai)) {
    const ai: NonNullable<ManagedPolicy['ai']> = {};
    if (raw.ai.allowedProviders !== undefined) {
      if (Array.isArray(raw.ai.allowedProviders)) {
        ai.allowedProviders = raw.ai.allowedProviders.filter((k): k is ManagedProviderKind => {
          const ok = PROVIDER_KINDS.includes(k as ManagedProviderKind);
          if (!ok) problems.push(`ai.allowedProviders: "${String(k)}" is not a provider kind`);
          return ok;
        });
      } else problems.push('ai.allowedProviders must be a list');
    }
    if (raw.ai.managedConnections !== undefined) {
      if (Array.isArray(raw.ai.managedConnections)) {
        const seen = new Set<string>();
        ai.managedConnections = raw.ai.managedConnections.map((c) => cleanConnection(c, problems)).filter((c): c is ManagedConnection => !!c && !seen.has(c.id) && !!seen.add(c.id));
      } else problems.push('ai.managedConnections must be a list');
    }
    const personal = asBool(raw.ai.allowPersonalKeys);
    if (personal !== undefined) ai.allowPersonalKeys = personal;
    else if (raw.ai.allowPersonalKeys !== undefined) problems.push('ai.allowPersonalKeys must be true or false');
    if (Object.keys(ai).length) out.ai = ai;
  }
  if (isObj(raw.mcp)) {
    const mcp: NonNullable<ManagedPolicy['mcp']> = {};
    const allowed = asBool(raw.mcp.allowed);
    if (allowed !== undefined) mcp.allowed = allowed;
    else if (raw.mcp.allowed !== undefined) problems.push('mcp.allowed must be true or false');
    if (raw.mcp.maxLevel === 'read' || raw.mcp.maxLevel === 'edit') mcp.maxLevel = raw.mcp.maxLevel;
    else if (raw.mcp.maxLevel !== undefined) problems.push('mcp.maxLevel must be "read" or "edit"');
    if (Object.keys(mcp).length) out.mcp = mcp;
  }
  if (isObj(raw.updates)) {
    const u: NonNullable<ManagedPolicy['updates']> = {};
    const disabled = asBool(raw.updates.disabled);
    if (disabled !== undefined) u.disabled = disabled;
    else if (raw.updates.disabled !== undefined) problems.push('updates.disabled must be true or false');
    if (typeof raw.updates.channel === 'string' && /^[a-z0-9-]{1,30}$/.test(raw.updates.channel)) u.channel = raw.updates.channel;
    else if (raw.updates.channel !== undefined) problems.push('updates.channel must be a short lower-case name');
    if (raw.updates.origin !== undefined) {
      try {
        const o = new URL(String(raw.updates.origin));
        if (o.protocol !== 'https:' || o.pathname !== '/' || o.search || o.hash) throw new Error();
        u.origin = o.origin;
      } catch {
        problems.push('updates.origin must be an https:// site with no path');
      }
    }
    if (Object.keys(u).length) out.updates = u;
  }
  if (isObj(raw.cloud)) {
    const c: NonNullable<ManagedPolicy['cloud']> = {};
    const disabled = asBool(raw.cloud.disabled);
    if (disabled !== undefined) c.disabled = disabled;
    else if (raw.cloud.disabled !== undefined) problems.push('cloud.disabled must be true or false');
    if (raw.cloud.origin !== undefined) {
      try {
        const o = new URL(String(raw.cloud.origin));
        if (o.protocol !== 'https:' || o.pathname !== '/' || o.search || o.hash) throw new Error();
        c.origin = o.origin;
      } catch {
        problems.push('cloud.origin must be an https:// site with no path');
      }
    }
    if (Object.keys(c).length) out.cloud = c;
  }
  if (raw.telemetry !== undefined) {
    if (raw.telemetry === 'none') out.telemetry = 'none';
    else problems.push('telemetry: Ironleaf collects none, so the only value is "none"');
  }
  if (isObj(raw.askBeforeChanges)) {
    const f = asBool(raw.askBeforeChanges.forceOn);
    if (f !== undefined) out.askBeforeChanges = { forceOn: f };
    else if (raw.askBeforeChanges.forceOn !== undefined) problems.push('askBeforeChanges.forceOn must be true or false');
  }
  if (isObj(raw.audit)) {
    const u = asBool(raw.audit.uploadAgentAccess);
    if (u !== undefined) out.audit = { uploadAgentAccess: u };
    else if (raw.audit.uploadAgentAccess !== undefined) problems.push('audit.uploadAgentAccess must be true or false');
  }
  return out;
}

/** Later sources win, key by key (the registry is passed last, so Group Policy wins over a file). */
export function mergePolicies(...list: ManagedPolicy[]): ManagedPolicy {
  const out: ManagedPolicy = {};
  for (const p of list) {
    for (const key of ['ai', 'mcp', 'updates', 'askBeforeChanges', 'cloud', 'audit'] as const) {
      if (p[key]) (out as Record<string, unknown>)[key] = { ...((out[key] as object) ?? {}), ...(p[key] as object) };
    }
    if (p.telemetry) out.telemetry = p.telemetry;
  }
  return out;
}

/** Turns `reg query <key>` output into a policy object: "Policy" (REG_SZ JSON) first, then dotted values over it. */
export function policyFromRegQuery(text: string): unknown {
  const flat: Record<string, unknown> = {};
  let whole: unknown;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s{2,}(\S+)\s+(REG_SZ|REG_EXPAND_SZ|REG_DWORD|REG_MULTI_SZ)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, name, type, rawValue] = m;
    const value = type === 'REG_DWORD' ? Number.parseInt(rawValue, 16) : type === 'REG_MULTI_SZ' ? rawValue.split('\\0').filter(Boolean) : rawValue.trim();
    if (name.toLowerCase() === 'policy' && typeof value === 'string') {
      try {
        whole = JSON.parse(value);
      } catch {
        whole = { __bad: true };
      }
      continue;
    }
    // A string that looks like JSON (a list, an object) is read as JSON; everything else as it is.
    let v: unknown = value;
    if (typeof value === 'string' && /^[[{]/.test(value)) {
      try {
        v = JSON.parse(value);
      } catch {}
    }
    flat[name] = v;
  }
  const nested: Record<string, unknown> = isObj(whole) ? structuredClone(whole) : {};
  for (const [name, v] of Object.entries(flat)) {
    const parts = name.split('.');
    let at = nested;
    for (const p of parts.slice(0, -1)) at = (isObj(at[p]) ? at[p] : (at[p] = {})) as Record<string, unknown>;
    at[parts[parts.length - 1]] = v;
  }
  return nested;
}

export interface PolicyIO {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** Returns the file's text, or null when there is none. */
  readFile(file: string): string | null;
  /** Windows only: `reg query` output for the key, or null when the key is absent. */
  readRegistry?(key: string): string | null;
}

export const REGISTRY_KEY = 'HKLM\\SOFTWARE\\Policies\\Ironleaf';

/** The machine-wide policy file for this platform. */
export function policyFile(platform: NodeJS.Platform, env: Record<string, string | undefined>): string {
  if (platform === 'win32') return path.win32.join(env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData', 'Ironleaf', 'policy.json');
  if (platform === 'darwin') return '/Library/Application Support/Ironleaf/policy.json';
  return '/etc/ironleaf/policy.json';
}

/** Reads every source for this machine. Never throws: an unreadable source is a problem, and no policy. */
export function loadPolicy(io: PolicyIO): LoadedPolicy {
  const problems: string[] = [];
  const sources: string[] = [];
  const parts: ManagedPolicy[] = [];
  const file = policyFile(io.platform, io.env);
  const text = io.readFile(file);
  if (text !== null) {
    try {
      const p: string[] = [];
      parts.push(parsePolicy(JSON.parse(text.replace(/^\uFEFF/, '')), p));
      problems.push(...p.map((x) => `${file}: ${x}`));
      sources.push(file);
    } catch {
      problems.push(`${file}: not valid JSON, so it is ignored`);
    }
  }
  if (io.platform === 'win32' && io.readRegistry) {
    const reg = io.readRegistry(REGISTRY_KEY);
    if (reg) {
      const raw = policyFromRegQuery(reg) as Record<string, unknown>;
      if (raw.__bad) problems.push(`${REGISTRY_KEY}\\Policy: not valid JSON, so it is ignored`);
      delete raw.__bad;
      const p: string[] = [];
      parts.push(parsePolicy(raw, p));
      problems.push(...p.map((x) => `${REGISTRY_KEY}: ${x}`));
      sources.push(REGISTRY_KEY);
    }
  }
  return { policy: mergePolicies(...parts), sources, problems };
}

export const systemPolicyIO = (): PolicyIO => ({
  platform: process.platform,
  env: process.env,
  readFile: (file) => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  },
  readRegistry: (key) => {
    try {
      const sys = process.env.SystemRoot || 'C:\\Windows';
      return execFileSync(path.win32.join(sys, 'System32', 'reg.exe'), ['query', key, '/s'], { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  },
});

// ── The policy in force ──────────────────────────────────────────────────────────────────────────────────────────────

let loaded: LoadedPolicy | null = null;
let machine: LoadedPolicy | null = null;
let teamPart: { name: string; policy: ManagedPolicy; problems: string[] } | null = null;

export const TEAM_SOURCE = 'team: ';
export const TEAM_WORDS = 'Managed by your team';

/** The policy in force: this machine's (read once, at first use; a change takes effect at the next start, like Group
 *  Policy), with the person's Ironleaf Teams team policy under it when they have one (setTeamPolicy). */
export function currentPolicy(): LoadedPolicy {
  loaded ??= withTeamPolicy((machine ??= loadPolicy(systemPolicyIO())), teamPart);
  return loaded;
}

/** The machine's policy with a team's under it: the machine's (IT's own) wins key by key. A team's policy never moves
 *  or turns off the cloud it came from, and never touches updates (where Ironleaf comes from is the machine's
 *  administrator's call, not a team admin's). */
export function withTeamPolicy(m: LoadedPolicy, team: { name: string; policy: ManagedPolicy; problems?: string[] } | null): LoadedPolicy {
  if (!team) return m;
  const { cloud: _cloud, updates: _updates, ...fromTeam } = team.policy;
  if (!Object.keys(fromTeam).length) return { ...m, team: team.name };
  return {
    policy: mergePolicies(fromTeam, m.policy),
    sources: [...m.sources, `${TEAM_SOURCE}${team.name}`],
    problems: [...m.problems, ...(team.problems ?? []).map((p) => `Team policy: ${p}`)],
    team: team.name,
  };
}

/** Ironleaf Teams (src/main/teams/service.ts): the team's policy from GET /policy, read as any policy is (bad values
 *  dropped and reported), applied from now on; null when the person has no team. Returns the policy in force. */
export function setTeamPolicy(t: { name: string; policy: unknown } | null): LoadedPolicy {
  if (t) {
    const problems: string[] = [];
    teamPart = { name: String(t.name || 'your team').slice(0, 100), policy: parsePolicy(t.policy ?? {}, problems), problems };
  } else teamPart = null;
  loaded = null;
  return currentPolicy();
}

/** Checks only: replaces the machine's policy (null reads the machine again at next use); a team's stays under it. */
export function setPolicyForTests(p: ManagedPolicy | LoadedPolicy | null): void {
  machine = p === null ? null : 'policy' in p && 'sources' in p ? (p as LoadedPolicy) : { policy: p as ManagedPolicy, sources: Object.keys(p).length ? ['test'] : [], problems: [] };
  loaded = null;
}

const pol = (p?: ManagedPolicy): ManagedPolicy => p ?? currentPolicy().policy;

// ── Enforcement hooks (each used at one decision point; see docs/EDITIONS.md "Policy") ─────────────────────────────

export class ManagedError extends Error {
  readonly managed = true;
  constructor(what: string) {
    super(`${what} ${MANAGED_WORDS.toLowerCase()}.`);
  }
}

export const MANAGED_PREFIX = 'managed-';
export const isManagedConnectionId = (id: string) => id.startsWith(MANAGED_PREFIX);

/** Whether a connection of this kind is allowed at all. */
export function providerAllowed(kind: string, p?: ManagedPolicy): boolean {
  const allowed = pol(p).ai?.allowedProviders;
  return !allowed || allowed.includes(kind as ManagedProviderKind);
}

/** Decision point: the person adds an AI connection (src/main/providers/connections.ts › add). Throws when not allowed. */
export function assertCanAddConnection(kind: string, p?: ManagedPolicy): void {
  if (pol(p).ai?.allowPersonalKeys === false) throw new ManagedError('Adding your own AI connections is');
  if (!providerAllowed(kind, p)) throw new ManagedError('This kind of AI connection is not allowed: that is');
}

/** Decision point: a connection is changed or removed. Managed ones are the organisation's. */
export function assertCanChangeConnection(id: string): void {
  if (isManagedConnectionId(id)) throw new ManagedError('This connection is');
}

/** The connections the person sees: the organisation's first, then their own where policy allows them. */
export function connectionsUnderPolicy<T extends { id: string; kind: string }>(own: T[], toRecord: (m: ManagedConnection) => T, p?: ManagedPolicy): T[] {
  const policy = pol(p);
  const managed = (policy.ai?.managedConnections ?? []).filter((m) => providerAllowed(m.kind, policy)).map(toRecord);
  const personal = policy.ai?.allowPersonalKeys === false ? [] : own.filter((r) => !isManagedConnectionId(r.id) && providerAllowed(r.kind, policy));
  return [...managed, ...personal];
}

/** The key store as the providers see it: a managed connection's key comes from the environment variable its policy
 *  names (never from policy itself), and setting a key is refused for managed connections or when personal keys are off. */
export interface KeysLike {
  has(id: string): boolean;
  get(id: string): string | undefined;
  set(id: string, key: string): Promise<void>;
  remove(id: string): Promise<void>;
}
export function keysUnderPolicy(keys: KeysLike, env: Record<string, string | undefined> = process.env, p?: () => ManagedPolicy): KeysLike {
  const managedKey = (id: string): string | undefined => {
    const m = (p?.() ?? pol()).ai?.managedConnections?.find((c) => MANAGED_PREFIX + c.id === id);
    return m?.apiKeyEnv ? env[m.apiKeyEnv] || undefined : undefined;
  };
  return {
    has: (id) => (isManagedConnectionId(id) ? !!managedKey(id) : keys.has(id)),
    get: (id) => (isManagedConnectionId(id) ? managedKey(id) : keys.get(id)),
    set: async (id, key) => {
      if (isManagedConnectionId(id)) throw new ManagedError('This connection’s key is');
      if ((p?.() ?? pol()).ai?.allowPersonalKeys === false) throw new ManagedError('Adding your own AI keys is');
      return keys.set(id, key);
    },
    remove: (id) => (isManagedConnectionId(id) ? Promise.resolve() : keys.remove(id)),
  };
}

/** Decision point: other AI apps over MCP (src/main/agent-access.ts › localMcpSettings). Off when not allowed;
 *  the level never above the organisation's highest. */
export function localMcpUnderPolicy<T extends { on: boolean; level: 'read' | 'edit' }>(s: T, p?: ManagedPolicy): T {
  const mcp = pol(p).mcp;
  if (!mcp) return s;
  return { ...s, on: mcp.allowed === false ? false : s.on, level: mcp.maxLevel === 'read' ? 'read' : s.level };
}

/** Decision point: an AI agent key is made (src/main/agent-access.ts › add). */
export function assertCanConnectAgents(p?: ManagedPolicy): void {
  if (pol(p).mcp?.allowed === false) throw new ManagedError('Connecting AI apps is');
}

/** Decision point: "Ask before the assistant changes a note" (src/main/app.ts, the assistant's suggest.on). */
export function askBeforeChangesUnderPolicy(personal: boolean, p?: ManagedPolicy): boolean {
  return pol(p).askBeforeChanges?.forceOn === true ? true : personal;
}

/** Decision point: the Teams audit upload (src/main/teams/audit-upload.ts) runs only when the team's policy asks. */
export function agentAccessUploadUnderPolicy(p?: ManagedPolicy): boolean {
  return pol(p).audit?.uploadAgentAccess === true;
}

/** Decision point: the update checker (src/main/update-check.ts › startUpdateCheck). */
export function updatesUnderPolicy(p?: ManagedPolicy): { disabled: boolean; origin?: string; channel?: string } {
  const u = pol(p).updates;
  if (!u) return { disabled: false };
  const channel = u.channel && u.channel !== 'stable' ? u.channel : undefined;
  return { disabled: u.disabled === true, ...(u.origin ? { origin: u.origin } : {}), ...(channel ? { channel } : {}) };
}

/** The latest.json a managed copy reads: the organisation's site (or Ironleaf's), on its channel when one is pinned. */
export const managedLatestUrl = (origin: string, channel?: string) => `${origin}/download/${channel ? channel + '/' : ''}latest.json`;

/** What the window shows: which areas are locked, in words, for the "Managed by your organisation" notes. */
export interface PolicyView {
  managed: boolean;
  sources: string[];
  problems: string[];
  locks: { area: 'ai' | 'mcp' | 'updates' | 'askBeforeChanges' | 'audit'; words: string }[];
  /** The team whose policy is part of this (Ironleaf Teams), and whether this machine has its own policy too. */
  team?: string;
  machine: boolean;
  /** What the window may offer, so a choice the policy refuses is never shown: the AI connection kinds the person
   *  may add (null: any), whether they may add their own at all, and how far other AI apps may go over MCP. */
  allows: { providers: ManagedProviderKind[] | null; personalKeys: boolean; mcp: boolean; mcpWrite: boolean };
}

export function policyView(l: LoadedPolicy = currentPolicy()): PolicyView {
  const p = l.policy;
  const locks: PolicyView['locks'] = [];
  if (p.ai?.allowPersonalKeys === false) locks.push({ area: 'ai', words: 'Only the AI connections your organisation provides can be used.' });
  else if (p.ai?.allowedProviders) locks.push({ area: 'ai', words: `AI connections are limited to: ${p.ai.allowedProviders.join(', ') || 'none'}.` });
  if (p.ai?.managedConnections?.length) locks.push({ area: 'ai', words: `${p.ai.managedConnections.length} AI connection${p.ai.managedConnections.length === 1 ? ' is' : 's are'} provided by your organisation.` });
  if (p.mcp?.allowed === false) locks.push({ area: 'mcp', words: 'Other AI apps may not connect to Ironleaf.' });
  else if (p.mcp?.maxLevel === 'read') locks.push({ area: 'mcp', words: 'Other AI apps may only read.' });
  if (p.updates?.disabled) locks.push({ area: 'updates', words: 'Updates are installed by your organisation.' });
  else if (p.updates?.origin || p.updates?.channel) locks.push({ area: 'updates', words: `Updates come from ${p.updates.origin ?? 'the release site'}${p.updates.channel ? ` (${p.updates.channel} channel)` : ''}.` });
  if (p.askBeforeChanges?.forceOn) locks.push({ area: 'askBeforeChanges', words: 'The assistant always asks before it changes a note.' });
  if (p.audit?.uploadAgentAccess) locks.push({ area: 'audit', words: 'What AI apps and agents do here goes to your team’s audit trail (the tool and the agent, never a note’s name or words).' });
  const machineSources = l.sources.filter((s) => !s.startsWith(TEAM_SOURCE));
  const allows: PolicyView['allows'] = {
    providers: p.ai?.allowedProviders ? [...p.ai.allowedProviders] : null,
    personalKeys: p.ai?.allowPersonalKeys !== false,
    mcp: p.mcp?.allowed !== false,
    mcpWrite: p.mcp?.allowed !== false && p.mcp?.maxLevel !== 'read',
  };
  return { managed: l.sources.length > 0, sources: l.sources, problems: l.problems, locks, machine: machineSources.length > 0, allows, ...(l.team ? { team: l.team } : {}) };
}
