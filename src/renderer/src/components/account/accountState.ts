// SPDX-License-Identifier: AGPL-3.0-or-later
// The account as the window knows it (window.nvAccount, src/preload/account.ts): one shared view, read once and kept
// current by the main side's notices, for Settings › Account and plan, the Supporter badges and the palette's commands.
import { useSyncExternalStore } from 'react';
import type { AccountApi } from '../../../../preload/account';
import type { AccountView, CheckoutProduct } from '../../../../shared/account';
import { openModal } from '../../state/modals';

declare global {
  interface Window {
    nvAccount?: AccountApi;
  }
}

let view: AccountView | null = null;
let started = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (v: AccountView | null | undefined) => {
  if (v) (view = v), emit();
  return v ?? view;
};

function start(): void {
  if (started || !window.nvAccount) return;
  started = true;
  void window.nvAccount.view().then(set, () => {});
  window.nvAccount.onChange(set);
}

export function useAccount(): AccountView | null {
  start();
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => view,
  );
}

const call = <T extends unknown[]>(fn: (api: AccountApi, ...a: T) => Promise<AccountView>) => async (...a: T): Promise<AccountView | null> => {
  const api = window.nvAccount;
  if (!api) return view;
  return set(await fn(api, ...a).catch(() => null));
};

export const account = {
  signIn: call((api) => api.signIn()),
  cancel: call((api) => api.cancel()),
  signOut: call((api) => api.signOut()),
  refresh: call((api) => api.refresh()),
  renameDevice: call((api, id: string, name: string) => api.renameDevice(id, name)),
  removeDevice: call((api, id: string) => api.removeDevice(id)),
  portal: call((api) => api.portal()),
  checkout: call((api, p: CheckoutProduct) => api.checkout(p)),
};

/** Settings › Account and plan. */
export const openAccountPage = () => openModal({ kind: 'settings', section: 'account' });

/** The palette's "Sign in to Ironleaf": the page, and the browser when not signed in yet. */
export function signInFromAnywhere(): void {
  openAccountPage();
  start();
  const go = (v: AccountView | null) => v?.status === 'signed-out' && void account.signIn();
  if (view) go(view);
  else void window.nvAccount?.view().then((v) => go(set(v)), () => {});
}
