// The one seam between Ironleaf Sync and the Ironleaf account (sign-in, tokens, licence: src/main/account/, built
// separately). Sync asks two things: a fresh access token for the cloud API, and whether the account has Sync. Until
// the account is ready, nothing is signed in, so Sync says "Sign in first" and never calls the server. The account
// (src/main/account/index.ts) calls `setSyncAccount(...)` once it has started, and `syncAccountChanged()` on each change.

export interface SyncAccount {
  /** A current access token (refreshed as needed), or null when signed out. */
  getAccessToken(): Promise<string | null>;
  hasEntitlement(key: 'sync'): boolean | Promise<boolean>;
  /** Opens the account sign-in (optional: Settings shows a button when there is one). */
  signIn?(): Promise<void>;
  /** Opens Checkout for Sync in the browser, through the account (optional: Settings shows "Upgrade" when there is one). */
  upgrade?(): Promise<void>;
  /** The cloud API base the account talks to (dev fake, managed policy or Ironleaf's own), so Sync uses the same one. */
  apiBase?(): string;
  /** This PC's id at the cloud (its account device registration), for Teams' key wraps. */
  deviceId?(): string | undefined;
  /** The account's id at the cloud, once known. */
  accountId?(): string | undefined;
}

const SIGNED_OUT: SyncAccount = {
  getAccessToken: async () => null,
  hasEntitlement: () => false,
};

let current: SyncAccount = SIGNED_OUT;
const listeners = new Set<() => void>();

export function setSyncAccount(account: SyncAccount | null): void {
  current = account ?? SIGNED_OUT;
  for (const fn of listeners) fn();
}

/** The account changed (signed in or out, the plan read again): Settings › Ironleaf Sync looks again. */
export function syncAccountChanged(): void {
  for (const fn of listeners) fn();
}

export function syncAccount(): SyncAccount {
  return current;
}

export function onSyncAccountChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A development build's stand-in (never in a packaged app): a fixed token from IRONLEAF_SYNC_DEV_TOKEN, with Sync. */
export function devAccount(token: string | undefined): SyncAccount | null {
  if (!token) return null;
  return { getAccessToken: async () => token, hasEntitlement: () => true };
}
