// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings › Teams' IPC (`iteams:*`) and the parts handed to the core (core.ts): the account (sync/account.ts, the
// one seam to src/main/account), the cloud, this PC's team key sealed by the operating system, the open notes' sync,
// the team policy (policy.ts) and the opt-in audit upload (audit-upload.ts). Refreshed when Settings › Teams opens,
// when the account changes, and every 15 minutes while signed in with Teams.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { addAuditSink } from '../enterprise';
import { policyView, setTeamPolicy } from '../policy';
import { onSyncAccountChange, syncAccount } from '../sync/account';
import type { Protector, TeamSyncBinding } from '../sync/service';
import { DEFAULT_API } from '../sync/service';
import type { DeviceKeyPair } from '../sync/team-keys';
import { HttpTeamsApi, type TeamsApi } from './api';
import { AuditUploader } from './audit-upload';
import { TeamsCore, type DeviceKeyStore } from './core';
import type { TeamsView } from './view';

const EVERY_MS = 15 * 60_000;

export interface TeamsServiceDeps {
  handle(channel: string, fn: (...args: any[]) => unknown): void;
  send(channel: string, payload: unknown): void;
  dataDir: string;
  protect: Protector;
  sync: TeamSyncBinding | null;
  /** A development override of the cloud's API base (the account's own otherwise). */
  apiBase?: string;
  log?(message: string): void;
  api?: TeamsApi;
}

/** This PC's team key pair, sealed by the operating system in Ironleaf's data folder. */
export function sealedKeyStore(file: string, protect: Protector): DeviceKeyStore {
  return {
    available: () => protect.available(),
    async load() {
      try {
        const o = JSON.parse(protect.decrypt(await fsp.readFile(file))) as { publicKey: string; privateKey: string };
        return { publicKey: o.publicKey, privateKey: Buffer.from(o.privateKey, 'base64') } satisfies DeviceKeyPair;
      } catch {
        return null;
      }
    },
    async save(k) {
      if (!protect.available()) throw new Error('This PC can’t protect a team key.');
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, protect.encrypt(JSON.stringify({ publicKey: k.publicKey, privateKey: k.privateKey.toString('base64') })));
      await fsp.rename(tmp, file);
    },
  };
}

export function registerTeams(d: TeamsServiceDeps): { stop(): void; core: TeamsCore } {
  const acct = () => syncAccount();
  const api = d.api ?? new HttpTeamsApi(() => d.apiBase ?? acct().apiBase?.() ?? DEFAULT_API, () => acct().getAccessToken().catch(() => null));
  let core: TeamsCore;
  const uploader = new AuditUploader({ target: () => core.auditTarget(), upload: (t, dev, events) => api.uploadAudit(t, dev, events), ...(d.log ? { log: d.log } : {}) });
  core = new TeamsCore({
    api,
    account: {
      signedIn: async () => !!(await acct().getAccessToken().catch(() => null)),
      hasEntitlement: (k) => !!acct().hasEntitlement(k as 'sync'),
      deviceId: () => acct().deviceId?.(),
      accountId: () => acct().accountId?.(),
    },
    keys: sealedKeyStore(path.join(d.dataDir, 'teams-device-key.bin'), d.protect),
    sync: d.sync,
    applyPolicy: (t) => setTeamPolicy(t),
    policyWords: (l) => policyView(l).locks.map((x) => x.words),
    audit: uploader,
    ...(d.log ? { log: d.log } : {}),
  });
  const detachSink = addAuditSink(uploader);
  const push = (v: TeamsView) => (d.send('iteams:changed', v), d.sync?.changed(), v);
  const refresh = (team?: string) => core.refresh(team ? { team } : {}).then(push);

  d.handle('iteams:view', (team?: unknown) => refresh(typeof team === 'string' ? team : undefined));
  d.handle('iteams:invite', (email: unknown, role: unknown) => core.invite(email, role).then(push));
  d.handle('iteams:revoke-invite', (id: unknown) => core.revokeInvite(id).then(push));
  d.handle('iteams:set-role', (accountId: unknown, role: unknown) => core.setRole(accountId, role).then(push));
  d.handle('iteams:remove', (accountId: unknown) => core.remove(accountId).then(push));
  d.handle('iteams:create-vault', (name: unknown) => core.createVault(name).then(push));
  d.handle('iteams:join-vault', (id: unknown) => core.joinVault(id).then(push));
  d.handle('iteams:rotate', (id: unknown) => core.rotateNow(id).then(push));
  d.handle('iteams:upload-now', async () => (await uploader.flush(), push(core.view())));

  // The account changed (signed in or out, the plan read again): look again soon.
  let soon: NodeJS.Timeout | undefined;
  const offAccount = onSyncAccountChange(() => {
    clearTimeout(soon);
    soon = setTimeout(() => void refresh().catch(() => {}), 1500);
    soon.unref?.();
  });
  const timer = setInterval(() => void refresh().catch(() => {}), EVERY_MS);
  timer.unref?.();
  return {
    core,
    stop() {
      clearInterval(timer);
      clearTimeout(soon);
      offAccount();
      detachSink();
      uploader.stop();
      void uploader.flush().catch(() => {});
    },
  };
}
