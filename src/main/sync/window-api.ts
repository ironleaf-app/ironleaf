// Ironleaf Sync's window API (the preload hands it to the window as `window.nv.cloudSync`). No Node here: only the IPC
// calls service.ts answers.
import type { SyncJoin, SyncView } from './view';

type Invoke = <T>(channel: string, ...args: unknown[]) => Promise<T>;
type Subscribe = <T>(channel: string, callback: (payload: T) => void) => () => void;

export function syncApi(invoke: Invoke, subscribe: Subscribe) {
  return {
    view: () => invoke<SyncView>('isync:view'),
    signIn: () => invoke<SyncView>('isync:sign-in'),
    upgrade: () => invoke<SyncView>('isync:upgrade'),
    create: (passphrase: string) => invoke<{ recovery: string; view: SyncView }>('isync:create', passphrase),
    join: (j: SyncJoin) => invoke<SyncView>('isync:join', j),
    pause: (paused: boolean) => invoke<SyncView>('isync:pause', paused),
    now: () => invoke<SyncView>('isync:now'),
    exclude: (folders: string[]) => invoke<SyncView>('isync:exclude', folders),
    removeDevice: (id: string) => invoke<SyncView>('isync:remove-device', id),
    off: () => invoke<SyncView>('isync:off'),
    onChange: (fn: (view: SyncView) => void) => subscribe<SyncView>('isync:changed', fn),
  };
}
