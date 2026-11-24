// SPDX-License-Identifier: AGPL-3.0-or-later
// The app's own protected store (src/main/os-protect.ts), on Electron's safeStorage. Apart, so the rest can be checked
// without Electron.

import { safeStorage } from 'electron';
import { OsProtect } from './os-protect';

export const osProtect = new OsProtect(() => safeStorage);
