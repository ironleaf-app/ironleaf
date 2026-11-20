// The window's side of Ironleaf's updates (src/main/update-check.ts): a few calls and one notice, on their own
// name (window.nvUpdate) so nothing in Ironleaf's main bridge changes. The channel names are the main side's own.
import type { IpcRenderer, IpcRendererEvent } from 'electron';
import type { UpdateState } from '../main/update-check';
import type { AboutRequest } from '../main/update-about';
import type { ReleaseEntry } from '../shared/version-history';

export function updateCheckApi(ipc: IpcRenderer) {
  return {
    state: () => ipc.invoke('nvupdate:state') as Promise<UpdateState>,
    /** Check now (also when the daily check is switched off). */
    check: () => ipc.invoke('nvupdate:check') as Promise<UpdateState>,
    setEnabled: (on: boolean) => ipc.invoke('nvupdate:set-enabled', on) as Promise<UpdateState>,
    /** "Download updates automatically". */
    setAutoDownload: (on: boolean) => ipc.invoke('nvupdate:set-auto-download', on) as Promise<UpdateState>,
    /** "Later": this version's banner keeps quiet. */
    dismiss: () => ipc.invoke('nvupdate:dismiss') as Promise<UpdateState>,
    /** Closes "Updated to X" (or "could not be installed"). */
    dismissNotice: () => ipc.invoke('nvupdate:dismiss-notice') as Promise<UpdateState>,
    /** The Update button: downloads and checks the update here, or opens the download page where it cannot. */
    download: () => ipc.invoke('nvupdate:download') as Promise<UpdateState>,
    /** "Restart to update". */
    install: () => ipc.invoke('nvupdate:install') as Promise<UpdateState>,
    openPage: () => ipc.invoke('nvupdate:open-page') as Promise<void>,
    /** About and updates (src/main/update-about.ts): the installed version and kind of copy; the website's versions.json. */
    about: () => ipc.invoke('nvupdate:about') as Promise<{ version: string; packaged: boolean; platform: string; historyPage: string }>,
    versions: (fresh = false) => ipc.invoke('nvupdate:versions', fresh) as Promise<ReleaseEntry[] | null>,
    /** A request from the tray or the Help menu that came before the page was listening (taken once). */
    takeOpen: () => ipc.invoke('nvupdate:take-open') as Promise<AboutRequest | null>,
    onOpen: (cb: (req: AboutRequest) => void) => {
      const listener = (_event: IpcRendererEvent, req: AboutRequest) => cb(req);
      ipc.on('nvupdate:open-about', listener);
      return () => void ipc.removeListener('nvupdate:open-about', listener);
    },
    onChange: (cb: (state: UpdateState) => void) => {
      const listener = (_event: IpcRendererEvent, state: UpdateState) => cb(state);
      ipc.on('nvupdate:changed', listener);
      return () => void ipc.removeListener('nvupdate:changed', listener);
    },
  };
}

export type UpdateCheckApi = ReturnType<typeof updateCheckApi>;
