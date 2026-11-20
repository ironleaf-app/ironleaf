// SPDX-License-Identifier: AGPL-3.0-or-later
// Where an Ironleaf account signs in and which cloud it talks to (the shared contract, Ironleaf Cloud's docs/CONTRACT.md,
// "Identity"). An account is optional: Ironleaf is complete without one, and signing in only unlocks the paid cloud
// products (Sync, Teams) and says thank you to a Supporter. Nothing here runs until the person asks to sign in, or has.
//
// Three places can set the cloud, the first that applies wins:
//   1. a development build only: NV_CLOUD_ORIGIN=http://127.0.0.1:<port> (the fake in tools/cloud-fake.mjs), as
//      NV_UPDATE_ORIGIN does for updates. An installed (packaged) copy never reads it, whatever the environment says.
//   2. managed policy: `cloud.origin` (an https:// site; the API is <origin>/api/v1) and `cloud.disabled` (no sign-in
//      at all on the organisation's machines), src/main/policy.ts.
//   3. Ironleaf's own: https://ironleaf.kaitiaki-it.com/api/v1, signing in with Kaitiaki ID.

import type { ManagedPolicy } from '../policy';

/** Kaitiaki ID (Zitadel). */
export const ISSUER = 'https://id.neuralspark.com.au';
export const CLOUD_ORIGIN = 'https://ironleaf.kaitiaki-it.com';
export const API_PATH = '/api/v1';
export const DEFAULT_API_BASE = CLOUD_ORIGIN + API_PATH;

// ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
// │ PLACEHOLDERS — REPLACE when the Zitadel app exists (see docs in the report: a Native app, PKCE, in the Ironleaf  │
// │ Cloud project). Until then sign-in says it is not set up in this build; the rest of Ironleaf is unaffected.     │
// └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
/** The Native (PKCE, no secret) app's Client ID in Zitadel. */
export const CLIENT_ID = '400405198184448002';
/** The Ironleaf Cloud project's Resource ID in Zitadel: the access token is minted for it (the API audience). */
export const API_PROJECT_ID = '400405198066941954';

export const isPlaceholder = (v: string) => !v || v.startsWith('REPLACE-');

/** Zitadel's way of asking for an access token whose audience is the cloud API's project. */
export const apiAudienceScope = (projectId: string) => `urn:zitadel:iam:org:project:id:${projectId}:aud`;

/** Zitadel's way of putting the person's organisation in the token (Teams SSO: Ironleaf Cloud maps it to a team). */
export const ORG_SCOPE = 'urn:zitadel:iam:user:resourceowner';

export function scopesFor(projectId: string): string {
  return ['openid', 'profile', 'email', 'offline_access', ORG_SCOPE, ...(isPlaceholder(projectId) ? [] : [apiAudienceScope(projectId)])].join(' ');
}

export interface CloudConfig {
  /** The OpenID issuer (discovery at <issuer>/.well-known/openid-configuration). */
  issuer: string;
  /** The cloud API's base URL, no trailing slash. */
  apiBase: string;
  clientId: string;
  scope: string;
  /** Sign-in can work in this build (a real client id, or the development fake). */
  configured: boolean;
  /** The organisation turned accounts off: nothing here contacts the cloud. */
  disabled: boolean;
  /** Where the setting came from, for the log and support. */
  source: 'dev' | 'policy' | 'default';
}

const DEV_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;

/** The development fake's origin, or undefined (always undefined in an installed copy). */
export function devCloudOrigin(o: { packaged: boolean; env: Record<string, string | undefined> }): string | undefined {
  const want = o.env.NV_CLOUD_ORIGIN ?? '';
  return !o.packaged && DEV_ORIGIN.test(want) ? want : undefined;
}

export function cloudConfig(o: { packaged: boolean; env: Record<string, string | undefined>; policy?: ManagedPolicy }): CloudConfig {
  const dev = devCloudOrigin(o);
  const scope = scopesFor(API_PROJECT_ID);
  if (dev) return { issuer: dev, apiBase: dev + API_PATH, clientId: isPlaceholder(CLIENT_ID) ? 'ironleaf-dev' : CLIENT_ID, scope, configured: true, disabled: false, source: 'dev' };
  const cloud = o.policy?.cloud;
  const configured = !isPlaceholder(CLIENT_ID);
  if (cloud?.disabled) return { issuer: ISSUER, apiBase: DEFAULT_API_BASE, clientId: CLIENT_ID, scope, configured, disabled: true, source: 'policy' };
  if (cloud?.origin) return { issuer: ISSUER, apiBase: cloud.origin + API_PATH, clientId: CLIENT_ID, scope, configured, disabled: false, source: 'policy' };
  return { issuer: ISSUER, apiBase: DEFAULT_API_BASE, clientId: CLIENT_ID, scope, configured, disabled: false, source: 'default' };
}

/** A URL the cloud hands back to open in the browser (Checkout, the billing portal): https only, or the dev fake. */
export function safeBrowserUrl(raw: unknown, config: Pick<CloudConfig, 'source' | 'issuer'>): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' && !u.username && !u.password) return u.toString();
    if (config.source === 'dev' && u.origin === config.issuer) return u.toString();
  } catch {}
  return null;
}
