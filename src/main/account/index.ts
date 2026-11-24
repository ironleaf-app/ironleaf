// SPDX-License-Identifier: AGPL-3.0-or-later
// The one call src/main/index.ts makes for accounts (any time; it waits for the app to be ready and never throws), and
// the window's calls on their own name (window.nvAccount, src/preload/account.ts) so Ironleaf's main bridge is unchanged.
// Electron's parts are handed in here: the browser (shell.openExternal), the protected store (safeStorage), and the
// network (net.fetch, which follows the system's proxy settings).
//
// Development builds only (an installed copy ignores all three, src/main/dev-switch.ts):
//   NV_CLOUD_ORIGIN=http://127.0.0.1:<port>   the fake cloud (tools/cloud-fake.mjs) for sign-in and the API
//   NV_TEST_BROWSER=fetch                      "open in the browser" fetches the address instead (the checks, the tour)
//   NV_TEST_LICENCE_PUBLIC_KEY=<PEM or file>   the fake's licence key, so its licences verify

import os from 'node:os';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cloudPlatform, type AccountView, type CheckoutProduct } from '../../shared/account';
import { devSwitch, isPackagedApp } from '../dev-switch';
import { detectEdition, setCurrentEdition, verifyLicence } from '../edition';
import { currentPolicy, MANAGED_WORDS } from '../policy';
import { cloudConfig } from './config';
import { LicenceKeeper } from './licence';
import type { Fetch } from './oidc';
import { AccountService } from './service';
import { setSyncAccount, syncAccountChanged } from '../sync/account';
import { TokenStore } from './token-store';

export const ACCOUNT_CHANNELS = {
  view: 'nvaccount:view',
  signIn: 'nvaccount:sign-in',
  cancel: 'nvaccount:cancel',
  signOut: 'nvaccount:sign-out',
  refresh: 'nvaccount:refresh',
  renameDevice: 'nvaccount:rename-device',
  removeDevice: 'nvaccount:remove-device',
  portal: 'nvaccount:portal',
  checkout: 'nvaccount:checkout',
  changed: 'nvaccount:changed',
} as const;

const HOUR = 60 * 60 * 1000;
const FIRST_SYNC_AFTER_MS = 8_000;

/** The development fake's licence key (a PEM, or a file holding one); undefined in an installed copy. */
function devLicenceKey(): string | undefined {
  const v = devSwitch('NV_TEST_LICENCE_PUBLIC_KEY');
  if (!v) return undefined;
  if (v.includes('BEGIN PUBLIC KEY')) return v;
  try {
    return readFileSync(path.resolve(v), 'utf8');
  } catch {
    return undefined;
  }
}

let service: AccountService | null = null;
/** The running account service (null before start, or when it could not start). */
export const accountService = (): AccountService | null => service;

export function startAccount(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app, ipcMain, net, shell, webContents, BrowserWindow } = require('electron') as typeof import('electron');
    const log = (m: string) => console.error(m);
    void app.whenReady().then(async () => {
      const dataDir = app.getPath('userData');
      const loaded = currentPolicy();
      const config = cloudConfig({ packaged: app.isPackaged || isPackagedApp(), env: process.env, policy: loaded.policy });
      if (config.source !== 'default') log(`Account: cloud from ${config.source} (${config.apiBase})${config.disabled ? ', turned off' : ''}`);
      const publicKeyPem = devLicenceKey();
      const keyOpt = publicKeyPem ? { publicKeyPem } : {};
      const fetch: Fetch = async (url, init) => {
        const res = await net.fetch(url, { method: init?.method ?? 'GET', headers: init?.headers, body: init?.body, redirect: init?.redirect ?? 'follow', cache: 'no-store' } as RequestInit);
        return { ok: res.ok, status: res.status, text: () => res.text() };
      };
      const browserFetch = devSwitch('NV_TEST_BROWSER') === 'fetch' && config.source === 'dev';
      const openBrowser = async (url: string) => {
        if (browserFetch) {
          // The checks and the tour: the fake answers the browser's part itself (it signs in at once and redirects).
          void fetch(url).catch(() => {});
          return;
        }
        await shell.openExternal(url);
      };
      const { osProtect } = await import('../os-protect-app');
      await osProtect.ready();
      const store = new TokenStore(dataDir, osProtect);
      const licence = new LicenceKeeper({
        dataDir,
        verify: (token) => verifyLicence(token, keyOpt),
        redetect: async () => {
          const e = await detectEdition({ userData: dataDir, ...keyOpt });
          setCurrentEdition(e);
          return e;
        },
      });
      const managedWords = config.source === 'policy' ? `${MANAGED_WORDS}. ${config.disabled ? 'Ironleaf accounts are turned off on this PC.' : `Accounts use ${config.apiBase}.`}` : undefined;
      const s = new AccountService({
        config,
        fetch,
        store,
        licence,
        openBrowser,
        device: () => ({ name: os.hostname().slice(0, 100) || 'This PC', platform: cloudPlatform(process.platform), appVersion: app.getVersion() }),
        changed: (view: AccountView) => {
          for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed()) wc.send(ACCOUNT_CHANNELS.changed, view);
          syncAccountChanged();
        },
        focusApp: () => {
          const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible()) ?? BrowserWindow.getAllWindows()[0];
          if (w && !w.isDestroyed()) (w.isMinimized() && w.restore(), w.focus());
        },
        log,
        ...(managedWords ? { managedWords } : {}),
      });
      await s.load();
      service = s;
      // Ironleaf Sync (src/main/sync/account.ts) asks this account for its token and whether it has Sync. A development
      // build run with IRONLEAF_SYNC_DEV_TOKEN keeps its fixed stand-in (src/main/sync/service.ts) instead.
      if (!(process.env.IRONLEAF_SYNC_DEV_TOKEN && !(app.isPackaged || isPackagedApp()))) {
        setSyncAccount({
          getAccessToken: () => s.getAccessToken(),
          hasEntitlement: (key) => s.hasEntitlement(key),
          apiBase: () => config.apiBase,
          deviceId: () => s.signedIn?.deviceId,
          accountId: () => s.accountId,
          ...(!config.disabled && config.configured
            ? {
                signIn: async () => void (await s.signIn()),
                upgrade: async () => {
                  const v = await s.checkout({ product: 'sync', interval: 'month' });
                  if (v.error) throw new Error(v.error);
                },
              }
            : {}),
        });
      }
      ipcMain.handle(ACCOUNT_CHANNELS.view, () => s.view());
      ipcMain.handle(ACCOUNT_CHANNELS.signIn, () => s.signIn());
      ipcMain.handle(ACCOUNT_CHANNELS.cancel, () => s.cancel());
      ipcMain.handle(ACCOUNT_CHANNELS.signOut, () => s.signOut());
      ipcMain.handle(ACCOUNT_CHANNELS.refresh, async () => (await s.sync({ force: true }), s.view()));
      ipcMain.handle(ACCOUNT_CHANNELS.renameDevice, (_e, id: unknown, name: unknown) => s.renameDevice(String(id ?? ''), String(name ?? '')));
      ipcMain.handle(ACCOUNT_CHANNELS.removeDevice, (_e, id: unknown) => s.removeDevice(String(id ?? '')));
      ipcMain.handle(ACCOUNT_CHANNELS.portal, () => s.portal());
      ipcMain.handle(ACCOUNT_CHANNELS.checkout, (_e, p: unknown) => s.checkout((p ?? {}) as CheckoutProduct));
      // At start (once the window has had its moment) and every hour after: the daily check when due, and a lapsed
      // licence read again. A copy never signed in makes no call at all.
      // Back from Checkout or the billing portal: the plan is read again so a purchase shows at once.
      app.on('browser-window-focus', () => void s.returned().catch(() => {}));
      if (!config.disabled && config.configured) {
        setTimeout(() => void s.tick().catch(() => {}), FIRST_SYNC_AFTER_MS).unref?.();
        setInterval(() => void s.tick().catch(() => {}), HOUR).unref?.();
      }
    });
  } catch (err) {
    console.error('Account start-up:', err instanceof Error ? err.message : err);
  }
}
