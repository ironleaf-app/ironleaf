// Vault's page in the former host app's window (one product step 1, 8 Nov 2026): the contract the window and the
// view share — the same page (web preferences), the same close handshake wait, the same channels. The window is
// built from it too, so neither side drifts. No Electron here, so tests drive it directly.
export function viewWebPreferences(preload: string): {
  preload: string;
  contextIsolation: boolean;
  nodeIntegration: false;
  sandbox: true;
  webviewTag: false;
  spellcheck: true;
  plugins: true;
} {
  return { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, spellcheck: true, plugins: true };
}

/** The close handshake's wait, the window's close and the view's flush alike: a few seconds at most. */
export const VIEW_FLUSH_MS = 6000;

/** The handshake's channels (never renamed: the page and both surfaces speak them). */
export const CLOSE_REQUEST = 'app:close-request';
export const CLOSE_READY = 'app:close-ready';

/** One window (step 6, 9 Nov 2026): while the former host app hosts Vault's page, no path makes Vault's window.
 *  The host says so (the former host app answers its flag); on its own, with the flag off, or when the host
 *  cannot say, the window opens exactly as today. */
export function vaultWindowSuppressed(host: { inWindow?: () => boolean }): boolean {
  try {
    return host.inWindow?.() === true;
  } catch {
    return false;
  }
}
