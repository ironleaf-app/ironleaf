// SPDX-License-Identifier: AGPL-3.0-or-later
// A --test-identity build (tools/release.mjs; docs/RELEASING.md): the app as it ships, installed beside the real one to
// try an installer or an update. It keeps to itself: its own settings, keys and notes, its own identity in Windows, and
// none of Ironleaf's places there (src/main/windows-entry.ts).

/** Its package.json says so. Anything unreadable is not one: the installed app must never stop being itself. */
export function isTestBuild(readPackage: () => string): boolean {
  try {
    return JSON.parse(readPackage())?.testIdentity === true;
  } catch {
    return false;
  }
}

/** Where its data is, beside the real app's folder under the person's app data. */
export const TEST_DATA = ['@neuralspark', 'vault-update-test'] as const;
/** Its Windows identity: the installer's own (tools/release.mjs). */
export const TEST_APP_ID = 'com.kaitiaki.neuralvault.updatetest';
