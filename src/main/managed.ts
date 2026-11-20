// SPDX-License-Identifier: AGPL-3.0-or-later
// Start-up for the edition, managed policy and the optional enterprise module (docs/EDITIONS.md), and the one
// read-only call the window makes for the "Managed by your organisation" notes (window.nvManaged, src/preload/managed.ts).
// The one call src/main/index.ts makes; never throws.

import { currentPolicy, managedLatestUrl, policyView, updatesUnderPolicy, MANAGED_WORDS, type PolicyView } from './policy';
import { UPDATE_ORIGIN, type ManagedUpdates } from './update-check';
import { currentEdition, detectEdition, setCurrentEdition, type Edition } from './edition';
import { audit, enterprise, loadEnterpriseModule } from './enterprise';

export const MANAGED_CHANNEL = 'ironleaf:managed';

export interface ManagedView {
  edition: Pick<Edition, 'id' | 'words'> & { org?: string; features?: string[] };
  policy: PolicyView;
  /** Which optional enterprise parts are present (all false in the community edition). */
  enterprise: { module: string; sso: boolean; teamVaults: boolean; audit: boolean };
}

export function managedView(): ManagedView {
  const e = currentEdition();
  const m = enterprise();
  return {
    edition: { id: e.id, words: e.words, ...(e.licence ? { org: e.licence.org, features: e.licence.features } : {}) },
    policy: policyView(),
    enterprise: { module: m.id, sso: !!m.sso, teamVaults: !!m.teamVaults, audit: !!m.audit },
  };
}

/** What the update checker is told (nothing when policy says nothing about updates). */
export function managedUpdates(): ManagedUpdates | undefined {
  try {
    const u = updatesUnderPolicy();
    if (!u.disabled && !u.origin && !u.channel) return undefined;
    const lock = policyView().locks.find((l) => l.area === 'updates');
    const words = `${MANAGED_WORDS}. ${lock?.words ?? ''}`.trim();
    return { disabled: u.disabled, words, ...(u.origin ? { origin: u.origin } : {}), latestUrl: managedLatestUrl(u.origin ?? UPDATE_ORIGIN, u.channel) };
  } catch {
    return undefined;
  }
}

export function startManaged(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app, ipcMain } = require('electron') as typeof import('electron');
    const log = (m: string) => console.error(m);
    const loaded = currentPolicy();
    for (const p of loaded.problems) log(`Managed policy: ${p}`);
    ipcMain.handle(MANAGED_CHANNEL, () => managedView());
    void app.whenReady().then(async () => {
      const dataDir = app.getPath('userData');
      const edition = await detectEdition({ userData: dataDir });
      setCurrentEdition(edition);
      if (edition.source) log(`Edition: ${edition.words}`);
      await loadEnterpriseModule({ edition, policy: loaded, dataDir, version: app.getVersion(), log }, { packaged: app.isPackaged });
      if (loaded.sources.length) audit({ kind: 'policy.loaded', actor: 'system', detail: { sources: loaded.sources.join('; '), problems: loaded.problems.length } });
    });
  } catch (err) {
    console.error('Managed start-up:', err instanceof Error ? err.message : err);
  }
}
