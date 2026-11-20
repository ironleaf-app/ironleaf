// About Ironleaf's main side (20 Nov 2026): what the About and updates page needs beyond the update check itself
// (src/main/update-check.ts). Three calls on the update check's own prefix, so nothing else in the app changes:
//   nvupdate:about          the installed version, whether this is an installed copy, the website's history page
//   nvupdate:versions       versions.json from Ironleaf's website (the site latest.json is read from), or null
//   nvupdate:take-open      a request to show the page that came from the tray or the menu before the page was there
// and openAbout(), which the tray's "Check for updates" and the Help menu call: the window comes forward on the page
// (with the check running when asked). One call from src/main/index.ts starts it.
import { cleanVersion, parseVersionsJson, type ReleaseEntry } from '../shared/version-history';
import { UPDATE_ORIGINS, updateOrigin } from './update-check';

export const ABOUT_CHANNELS = {
  about: 'nvupdate:about',
  versions: 'nvupdate:versions',
  takeOpen: 'nvupdate:take-open',
  open: 'nvupdate:open-about',
} as const;

/** What the page is asked to show: the update card with a check started, or the notes of this version. */
export type AboutRequest = { check: boolean; focus: 'status' | 'whats-new' };

export const HISTORY_PAGE = 'https://ironleaf.kaitiaki-it.com/download/#history';
const VERSIONS_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;

type Fetch = (url: string, init: { signal: AbortSignal; redirect: 'error'; cache: 'no-store'; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Reads versions.json from the first site that answers with a list (the same order as latest.json). Never throws. */
export async function fetchVersions(fetch: Fetch, origins: readonly string[], timeoutMs = TIMEOUT_MS): Promise<ReleaseEntry[] | null> {
  for (const origin of origins) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${origin}/download/versions.json`, { signal: controller.signal, redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' } });
      if (!res.ok) continue;
      const list = parseVersionsJson(await res.text());
      if (list.length) return list;
    } catch {
      // The next site, or nothing: the bundled history still shows.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

let pending: AboutRequest | null = null;
let send: ((req: AboutRequest) => boolean) | null = null;

/** The tray and the menu: bring the window forward on About and updates. When no page is listening yet (the window
 *  is still being made), the request waits for the page to take it. */
export function openAbout(req: Partial<AboutRequest> = {}): void {
  const full: AboutRequest = { check: !!req.check, focus: req.focus ?? 'status' };
  pending = full;
  try {
    if (send?.(full)) return;
  } catch {
    // Taken when the page starts.
  }
}

/** The one call src/main/index.ts makes. Never throws. */
export function startUpdateAbout(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron');
    const { app, ipcMain, net, BrowserWindow } = electron;
    void app.whenReady().then(() => {
      const dev = updateOrigin({ packaged: app.isPackaged, argv: process.argv, env: process.env });
      const origins = dev ? [dev] : [...UPDATE_ORIGINS];
      let cache: { at: number; list: ReleaseEntry[] | null } | null = null;
      send = (req) => {
        const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
        if (!wins.length) return false;
        for (const w of wins) w.webContents.send(ABOUT_CHANNELS.open, req);
        return true;
      };
      ipcMain.handle(ABOUT_CHANNELS.about, () => ({ version: cleanVersion(app.getVersion()) ?? app.getVersion(), packaged: app.isPackaged, platform: process.platform, historyPage: HISTORY_PAGE }));
      ipcMain.handle(ABOUT_CHANNELS.versions, async (_e, fresh: unknown) => {
        if (!fresh && cache && Date.now() - cache.at < VERSIONS_TTL_MS) return cache.list;
        const list = await fetchVersions((url, init) => net.fetch(url, { ...init, credentials: 'omit' } as RequestInit) as unknown as ReturnType<Fetch>, origins);
        cache = { at: Date.now(), list };
        return list;
      });
      ipcMain.handle(ABOUT_CHANNELS.takeOpen, () => {
        const req = pending;
        pending = null;
        return req;
      });
    });
  } catch (err) {
    console.error('About Ironleaf:', err instanceof Error ? err.message : err);
  }
}
