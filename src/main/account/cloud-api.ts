// SPDX-License-Identifier: AGPL-3.0-or-later
// Ironleaf Cloud's account endpoints (its docs/CONTRACT.md "Identity" and "Licences"), as the app calls them:
//   GET    /me              the account, its plan, entitlements and devices
//   POST   /licence         a fresh licence (Ed25519 JWT) for this account and device
//   POST   /devices         register this PC        PATCH /devices/:id  rename        DELETE /devices/:id  remove
//   POST   /portal          the billing portal's address (Stripe Customer Portal)
//   POST   /checkout        a Checkout address for one product
// Every call carries `Authorization: Bearer <Kaitiaki ID access token>`; a 401 renews the token once and tries again.
// Answers are read leniently (src/shared/account.ts parseMe): a field the cloud adds later is ignored, never fatal.

import { parseMe, type CloudMe, type CheckoutProduct } from '../../shared/account';
import type { Fetch } from './oidc';

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The cloud's error code (`{error: "<snake_case>", message}`), when it gave one. */
    readonly code = '',
  ) {
    super(message);
  }
  /** No answer at all: offline, or the cloud is down. Nothing about the account is concluded from it. */
  get offline(): boolean {
    return this.status === 0;
  }
}

export interface CloudApiDeps {
  apiBase: string;
  fetch: Fetch;
  /** A current access token (renewed when near its end). */
  token(): Promise<string>;
  /** Renews the access token after a 401; false when the sign-in has ended. */
  renew(): Promise<boolean>;
}

export interface DeviceInfo {
  name: string;
  /** windows | macos | linux | other (src/shared/account.ts cloudPlatform). */
  platform: string;
  appVersion: string;
}

/** The cloud's error codes worth plain words of our own (contract v1: `{error, message}`). */
const ERROR_WORDS: Record<string, string> = {
  device_limit: 'Your plan’s device limit is reached. Remove a device below, then try again.',
  no_billing: 'There is nothing to manage in billing yet.',
  already_owned: 'You are already a Supporter. Thank you!',
  already_subscribed: 'You already have Sync. Manage it with Manage billing.',
  billing_unavailable: 'Billing is not available right now. Try again later.',
  licences_unavailable: 'Ironleaf Cloud cannot issue licences right now; your plan stays as it is.',
};

export function cloudApi(d: CloudApiDeps) {
  const call = async (method: string, route: string, body?: unknown, retried = false): Promise<unknown> => {
    let res;
    try {
      res = await d.fetch(d.apiBase + route, {
        method,
        headers: { authorization: `Bearer ${await d.token()}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new CloudError('Ironleaf Cloud could not be reached.', 0);
    }
    if (res.status === 401 && !retried && (await d.renew())) return call(method, route, body, true);
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const e = parsed && typeof parsed === 'object' ? (parsed as { error?: unknown; message?: unknown }) : {};
      const code = typeof e.error === 'string' ? e.error.slice(0, 60) : '';
      const msg = ERROR_WORDS[code] ?? (typeof e.message === 'string' && e.message ? e.message.slice(0, 200) : `Ironleaf Cloud answered ${res.status}${code ? ` (${code})` : ''}.`);
      throw new CloudError(msg, res.status, code);
    }
    return parsed;
  };
  const urlOf = (v: unknown): string => {
    const url = v && typeof v === 'object' ? (v as { url?: unknown }).url : undefined;
    if (typeof url !== 'string') throw new CloudError('Ironleaf Cloud gave no address to open.', 502);
    return url;
  };
  return {
    me: async (): Promise<CloudMe> => parseMe(await call('GET', '/me')),
    /** The licence JWT for this registered device, or null when the account has no paid plan (403 no_paid_plan).
     *  A device the cloud no longer knows is a CloudError 404 `device_not_found` (the caller registers again). */
    licence: async (deviceId: string): Promise<string | null> => {
      try {
        const v = await call('POST', '/licence', { deviceId });
        if (typeof v === 'string' && v.split('.').length === 3) return v.trim();
        const t = v && typeof v === 'object' ? ((v as Record<string, unknown>).licence ?? (v as Record<string, unknown>).token ?? (v as Record<string, unknown>).jwt) : null;
        return typeof t === 'string' && t.split('.').length === 3 ? t.trim() : null;
      } catch (err) {
        if (err instanceof CloudError && (err.status === 402 || (err.status === 403 && (err.code === 'no_paid_plan' || !err.code)))) return null;
        throw err;
      }
    },
    registerDevice: async (info: DeviceInfo): Promise<string> => {
      const v = (await call('POST', '/devices', info)) as Record<string, unknown> | null;
      const id = v?.id ?? (v?.device as Record<string, unknown> | undefined)?.id;
      if (typeof id !== 'string' || !id) throw new CloudError('Ironleaf Cloud did not say this PC’s id.', 502);
      return id;
    },
    /** Not in contract v1's API table yet: a cloud without it answers 404/405, said in plain words. */
    renameDevice: async (id: string, name: string): Promise<void> => {
      try {
        await call('PATCH', `/devices/${encodeURIComponent(id)}`, { name });
      } catch (err) {
        if (err instanceof CloudError && (err.status === 405 || (err.status === 404 && err.code !== 'device_not_found'))) throw new CloudError('Ironleaf Cloud cannot rename devices yet.', err.status, 'rename_unavailable');
        throw err;
      }
    },
    removeDevice: async (id: string): Promise<void> => void (await call('DELETE', `/devices/${encodeURIComponent(id)}`)),
    portal: async (): Promise<string> => urlOf(await call('POST', '/portal', {})),
    checkout: async (product: CheckoutProduct): Promise<string> => urlOf(await call('POST', '/checkout', product)),
  };
}

export type CloudApi = ReturnType<typeof cloudApi>;
