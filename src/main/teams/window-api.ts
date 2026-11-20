// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings › Teams' window API (the preload hands it to the window as `window.nv.teams`). No Node here: only the IPC
// calls service.ts answers.
import type { TeamsView } from './view';

type Invoke = <T>(channel: string, ...args: unknown[]) => Promise<T>;
type Subscribe = <T>(channel: string, callback: (payload: T) => void) => () => void;

export function teamsApi(invoke: Invoke, subscribe: Subscribe) {
  return {
    view: (team?: string) => invoke<TeamsView>('iteams:view', team),
    invite: (email: string, role: 'admin' | 'member') => invoke<TeamsView>('iteams:invite', email, role),
    revokeInvite: (id: string) => invoke<TeamsView>('iteams:revoke-invite', id),
    setRole: (accountId: string, role: 'owner' | 'admin' | 'member') => invoke<TeamsView>('iteams:set-role', accountId, role),
    remove: (accountId: string) => invoke<TeamsView>('iteams:remove', accountId),
    createVault: (name: string) => invoke<TeamsView>('iteams:create-vault', name),
    joinVault: (id: string) => invoke<TeamsView>('iteams:join-vault', id),
    rotate: (id: string) => invoke<TeamsView>('iteams:rotate', id),
    uploadNow: () => invoke<TeamsView>('iteams:upload-now'),
    onChange: (fn: (view: TeamsView) => void) => subscribe<TeamsView>('iteams:changed', fn),
  };
}
