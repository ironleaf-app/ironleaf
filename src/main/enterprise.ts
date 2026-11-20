// SPDX-License-Identifier: AGPL-3.0-or-later
// The extension point for the optional enterprise module (docs/EDITIONS.md). The open core defines the interfaces
// and a no-op community implementation; the commercial `@ironleaf/enterprise` package (a separate, private repository)
// implements them. Ironleaf loads it only if it is installed beside the app, and works fully without it.
//
// The core never asks the module for permission to run a community feature: the module adds things (sign-in, team
// vaults, an audit trail that leaves the machine), it does not unlock what is already here.

import { createRequire } from 'node:module';
import type { Edition } from './edition';
import type { LoadedPolicy } from './policy';

/** Who is signed in through the organisation's identity provider (OIDC or SAML, e.g. Zitadel, Entra ID, Okta). */
export interface EnterpriseIdentity {
  subject: string;
  name: string;
  email?: string;
  groups?: string[];
}

export interface SsoProvider {
  /** Starts sign-in (opens the system browser; the module owns the redirect/loopback). */
  signIn(): Promise<EnterpriseIdentity>;
  signOut(): Promise<void>;
  current(): EnterpriseIdentity | null;
}

/** A vault shared by a team and kept in step by a sync server (the server is a separate product). */
export interface TeamVaultInfo {
  id: string;
  name: string;
  /** The local folder it is kept in. */
  folder: string;
  role: 'reader' | 'editor' | 'owner';
}
export interface TeamVaultProvider {
  list(): Promise<TeamVaultInfo[]>;
  /** Makes sure the team vault is present locally and syncing; returns its folder. */
  open(id: string): Promise<string>;
  /** Told when the person changes a file in a team vault (relative path), so the module can push it. */
  changed?(id: string, rel: string): void;
}

/** One thing worth recording for an organisation's audit trail. Core emits these; the community sink drops them. */
export interface AuditEvent {
  at: string;
  /** e.g. "mcp.call", "ai.connection.blocked", "policy.loaded", "agent.added". */
  kind: string;
  /** Who acted: "person", an agent's name, an MCP client. */
  actor: string;
  /** What it touched (a note path, a connection id); never note contents or keys. */
  target?: string;
  outcome?: 'done' | 'denied' | 'failed';
  detail?: Record<string, string | number | boolean>;
}
export interface AuditSink {
  write(event: AuditEvent): void | Promise<void>;
  flush?(): Promise<void>;
}

export interface EnterpriseContext {
  edition: Edition;
  policy: LoadedPolicy;
  /** Ironleaf's data folder (userData). */
  dataDir: string;
  version: string;
  log(message: string): void;
}

/** What `@ironleaf/enterprise` exports as `createEnterprise(ctx)`. Every part is optional. */
export interface EnterpriseModule {
  id: string;
  version: string;
  sso?: SsoProvider;
  teamVaults?: TeamVaultProvider;
  audit?: AuditSink;
  stop?(): void | Promise<void>;
}

export const ENTERPRISE_PACKAGE = '@ironleaf/enterprise';

/** The community implementation: nothing to sign in to, no team vaults, audit events dropped. */
export const COMMUNITY_MODULE: EnterpriseModule = Object.freeze({ id: 'community', version: '0' });

let active: EnterpriseModule = COMMUNITY_MODULE;
export const enterprise = (): EnterpriseModule => active;

/** Loads the enterprise module when it is installed; the community module otherwise. Never throws. A development
 *  build may point at a module on disk with IRONLEAF_ENTERPRISE_MODULE (an installed copy ignores it). */
export async function loadEnterpriseModule(ctx: EnterpriseContext, o: { packaged: boolean; env?: Record<string, string | undefined>; requireFrom?: string; load?: (id: string) => unknown } = { packaged: true }): Promise<EnterpriseModule> {
  const env = o.env ?? process.env;
  const id = !o.packaged && env.IRONLEAF_ENTERPRISE_MODULE ? env.IRONLEAF_ENTERPRISE_MODULE : ENTERPRISE_PACKAGE;
  // The name is a variable so the bundler leaves it alone: the package is not a dependency of the open core.
  const load = o.load ?? ((name: string) => createRequire(o.requireFrom ?? __filename)(name));
  let mod: unknown;
  try {
    mod = load(id);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== 'MODULE_NOT_FOUND' && code !== 'ERR_MODULE_NOT_FOUND') ctx.log(`Enterprise module: ${err instanceof Error ? err.message : String(err)}`);
    active = COMMUNITY_MODULE;
    return active;
  }
  try {
    const create = (mod as { createEnterprise?: (c: EnterpriseContext) => EnterpriseModule | Promise<EnterpriseModule> })?.createEnterprise;
    if (typeof create !== 'function') throw new Error(`${id} has no createEnterprise()`);
    const made = await create(ctx);
    if (!made || typeof made.id !== 'string') throw new Error(`${id} returned no module`);
    active = made;
  } catch (err) {
    ctx.log(`Enterprise module not started: ${err instanceof Error ? err.message : String(err)}`);
    active = COMMUNITY_MODULE;
  }
  return active;
}

/** Sinks of the open core's own (Ironleaf Teams' opt-in upload, src/main/teams/audit-upload.ts), beside the module's. */
const coreSinks = new Set<AuditSink>();
export function addAuditSink(sink: AuditSink): () => void {
  coreSinks.add(sink);
  return () => void coreSinks.delete(sink);
}

/** Emits one audit event to the module's sink and the core's (none in the community edition unless Teams' policy
 *  asks). Never throws, never waits. */
export function audit(event: Omit<AuditEvent, 'at'> & { at?: string }): void {
  const sinks = [active.audit, ...coreSinks].filter((s): s is AuditSink => !!s);
  if (!sinks.length) return;
  const e = { at: event.at ?? new Date().toISOString(), ...event };
  for (const sink of sinks) {
    try {
      void Promise.resolve(sink.write(e)).catch(() => undefined);
    } catch {}
  }
}

/** Checks only. */
export const setEnterpriseForTests = (m: EnterpriseModule | null): void => void (active = m ?? COMMUNITY_MODULE);
