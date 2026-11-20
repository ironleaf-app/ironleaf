// Ironleaf's entry in Windows' installed-apps list names Ironleaf and the version running (as the former host
// app's does in its src/installed-entry.cjs: the installer writes the plain name, and every start repairs the
// entry where a quick change left it behind). An entry for another folder is left alone. No Electron here, so
// the tests bundle this file as it stands.

import { execFile } from 'node:child_process';
import path from 'node:path';

// The installer's key for Ironleaf's app id (com.kaitiaki.neuralvault), the same on every PC: the guid in
// build-standalone/electron-builder.json.
export const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\64ba8a54-550e-4c87-9030-91574132cfd2';
export const NAME = 'Ironleaf';
/** The name the entry had before the rename (20 Nov 2026): an entry an earlier version wrote is still this copy's. */
export const LEGACY_NAME = 'NeuralVault';
/** The program's file before the rename; an update over an earlier install links it to Ironleaf.exe. */
export const EXE_NAME = 'Ironleaf.exe';
export const LEGACY_EXE_NAME = 'NeuralVault.exe';
/** The Start menu shortcut tools/install-win.ps1 made before the rename. */
export const LEGACY_START_MENU_LINK = 'NeuralVault.lnk';
const ours = (displayName: unknown) => [NAME, LEGACY_NAME].some((n) => String(displayName ?? '').startsWith(n));

/** Started as the old NeuralVault.exe with Ironleaf.exe beside it: the Ironleaf.exe to hand over to, else null. */
export function legacyExeTarget(execPath: string, exists: (file: string) => boolean): string | null {
  if (path.win32.basename(execPath).toLowerCase() !== LEGACY_EXE_NAME.toLowerCase()) return null;
  const next = path.win32.join(path.win32.dirname(execPath), EXE_NAME);
  return exists(next) ? next : null;
}
/** The values `reg query` printed for one key: {DisplayName: 'Ironleaf 1.0.0', …}. */
export function valuesOf(output: unknown): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const row = /^ {4}(\S(?:.*?\S)?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line);
    if (row) values[row[1]] = row[3] === undefined ? '' : row[3];
  }
  return values;
}

const folder = (value: unknown): string => path.win32.resolve(String(value ?? '').replace(/^"|"$/g, '')).replace(/\\+$/, '').toLowerCase();

// The folder of the uninstaller an entry names ("C:\\…\\Ironleaf\\Uninstall Ironleaf.exe").
const uninstallerFolder = (value: unknown): string => {
  const match = /^\s*"([^"]+\.exe)"|^\s*([^"]+?\.exe)(?:\s|$)/i.exec(String(value ?? ''));
  return match ? path.win32.dirname(match[1] || match[2]) : '';
};

/** What to change in the entry for the installation at `exe`, as `reg add` value pairs ([] when nothing). */
export function changesFor(values: Record<string, string>, o: { exe: string; version?: string }): [string, string][] {
  const where = values.InstallLocation || uninstallerFolder(values.UninstallString);
  if (!where || folder(where) !== folder(path.win32.dirname(o.exe))) return [];
  if (!ours(values.DisplayName)) return [];
  const changes: [string, string][] = [];
  if (values.DisplayName !== NAME) changes.push(['DisplayName', NAME]);
  if (!values.InstallLocation) changes.push(['InstallLocation', path.win32.dirname(o.exe)]);
  if (o.version && values.DisplayVersion !== o.version) changes.push(['DisplayVersion', o.version]);
  return changes;
}

/** Sets the entry for this installation; resolves to the values changed. Never throws. */
export async function repairInstalledEntry(o: { exe?: string; version?: string; run?: (file: string, args: string[]) => Promise<string> } = {}): Promise<string[]> {
  const run =
    o.run ??
    ((file, args) => new Promise<string>((resolve, reject) => execFile(file, args, { windowsHide: true, timeout: 15000 }, (error: Error | null, stdout: string) => (error ? reject(error) : resolve(stdout)))));
  try {
    const changes = changesFor(valuesOf(await run('reg', ['query', KEY])), { exe: o.exe ?? process.execPath, ...(o.version ? { version: o.version } : {}) });
    for (const [name, value] of changes) await run('reg', ['add', KEY, '/v', name, '/t', 'REG_SZ', '/d', value, '/f']);
    return changes.map(([name]) => name);
  } catch {
    return [];
  }
}
