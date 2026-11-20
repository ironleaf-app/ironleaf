// SPDX-License-Identifier: AGPL-3.0-or-later
// The window's read-only view of the edition and managed policy (src/main/managed.ts), on its own name
// (window.nvManaged) so nothing in Ironleaf's main bridge changes.
import type { IpcRenderer } from 'electron';
import type { ManagedView } from '../main/managed';

export function managedApi(ipc: IpcRenderer) {
  return {
    view: () => ipc.invoke('ironleaf:managed') as Promise<ManagedView>,
  };
}

export type ManagedApi = ReturnType<typeof managedApi>;
