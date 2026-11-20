// SPDX-License-Identifier: AGPL-3.0-or-later
// Test switches (NV_TEST_*): environment variables a development build's end-to-end checks use to stand in for a
// file dialog. An installed (packaged) Ironleaf never reads them, whatever the environment says.

/** Whether this is an installed copy (Electron's app.isPackaged); plain Node (the unit checks) counts as development. */
export function isPackagedApp(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { app?: { isPackaged?: boolean } } | string;
    return typeof electron === 'object' && electron?.app?.isPackaged === true;
  } catch {
    return false;
  }
}

/** A test switch's value in a development build; always undefined in an installed copy. */
export function devSwitch(name: `NV_TEST_${string}`): string | undefined {
  return isPackagedApp() ? undefined : process.env[name] || undefined;
}
