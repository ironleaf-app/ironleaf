// SPDX-License-Identifier: AGPL-3.0-or-later
// The window's side of an Ironleaf account (src/main/account): a few calls and one notice, on their own name
// (window.nvAccount) so nothing in Ironleaf's main bridge changes. Views only: no token ever crosses here.
import type { IpcRenderer, IpcRendererEvent } from 'electron';
import type { AccountView, CheckoutProduct } from '../shared/account';

export function accountApi(ipc: IpcRenderer) {
  return {
    view: () => ipc.invoke('nvaccount:view') as Promise<AccountView>,
    /** Opens Kaitiaki ID in the browser; resolves once signed in (or not: the view says why). */
    signIn: () => ipc.invoke('nvaccount:sign-in') as Promise<AccountView>,
    cancel: () => ipc.invoke('nvaccount:cancel') as Promise<AccountView>,
    signOut: () => ipc.invoke('nvaccount:sign-out') as Promise<AccountView>,
    /** The plan, devices and licence brought up to date now. */
    refresh: () => ipc.invoke('nvaccount:refresh') as Promise<AccountView>,
    renameDevice: (id: string, name: string) => ipc.invoke('nvaccount:rename-device', id, name) as Promise<AccountView>,
    removeDevice: (id: string) => ipc.invoke('nvaccount:remove-device', id) as Promise<AccountView>,
    /** Manage billing: the billing portal in the browser. */
    portal: () => ipc.invoke('nvaccount:portal') as Promise<AccountView>,
    /** Upgrade: Checkout in the browser. */
    checkout: (p: CheckoutProduct) => ipc.invoke('nvaccount:checkout', p) as Promise<AccountView>,
    onChange: (cb: (view: AccountView) => void) => {
      const listener = (_event: IpcRendererEvent, view: AccountView) => cb(view);
      ipc.on('nvaccount:changed', listener);
      return () => void ipc.removeListener('nvaccount:changed', listener);
    },
  };
}

export type AccountApi = ReturnType<typeof accountApi>;
