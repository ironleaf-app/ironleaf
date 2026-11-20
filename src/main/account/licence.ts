// SPDX-License-Identifier: AGPL-3.0-or-later
// The licence an account's purchases come as (Ironleaf Cloud's docs/CONTRACT.md "Licences"): after signing in, at
// start and once a day while online, POST /licence gives a fresh Ed25519-signed JWT (35 days). It is written where
// src/main/edition.ts reads it (licence.jwt in Ironleaf's data folder), then the edition is read again so the window
// shows it. The rules:
//   - offline (no answer at all): the licence in force stays until it expires; nothing is concluded from silence;
//   - the cloud says the account has no paid product: the licence this file wrote goes (a licence put there by hand,
//     e.g. tools/licence-issue.mjs for an organisation, is never touched);
//   - expired: edition.ts reads it as Community, quietly. Nothing is ever locked or taken away from the notes.
// Only a licence that verifies is written, so a bad answer can never replace a good licence.

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { LICENCE_FILE, type Edition } from '../edition';
import { CloudError } from './cloud-api';

export const REFRESH_EVERY_MS = 24 * 60 * 60 * 1000;
/** A licence this close to its end is renewed at the next chance, whatever the day's check said. */
export const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;
export const STATE_FILE = 'account.json';

/** What is kept in plain words beside the sealed sign-in: no token, no name, nothing personal. */
export interface LicenceState {
  /** sha256 of the licence this file wrote, so only that one is ever replaced or removed. */
  wroteHash?: string;
  refreshedAt?: number;
}

export interface LicenceDeps {
  dataDir: string;
  /** edition.ts's verifyLicence with this build's key. */
  verify(token: string): Promise<Edition>;
  /** edition.ts's detectEdition, then setCurrentEdition; returns the edition now in force. */
  redetect(): Promise<Edition>;
  fs?: Pick<typeof fsp, 'readFile' | 'writeFile' | 'rm' | 'rename' | 'mkdir'>;
}

const sha = (t: string) => createHash('sha256').update(t.trim()).digest('hex');

export class LicenceKeeper {
  private fs: NonNullable<LicenceDeps['fs']>;
  constructor(private d: LicenceDeps) {
    this.fs = d.fs ?? fsp;
  }

  get file(): string {
    return path.join(this.d.dataDir, LICENCE_FILE);
  }
  private get stateFile(): string {
    return path.join(this.d.dataDir, STATE_FILE);
  }

  async state(): Promise<LicenceState> {
    try {
      const v = JSON.parse(await this.fs.readFile(this.stateFile, 'utf8'));
      return v && typeof v === 'object' ? { ...(typeof v.wroteHash === 'string' ? { wroteHash: v.wroteHash } : {}), ...(typeof v.refreshedAt === 'number' ? { refreshedAt: v.refreshedAt } : {}) } : {};
    } catch {
      return {};
    }
  }
  private async saveState(s: LicenceState): Promise<void> {
    await this.fs.mkdir(this.d.dataDir, { recursive: true });
    await this.fs.writeFile(this.stateFile, JSON.stringify(s, null, 2));
  }

  /** Whether it is time to ask the cloud again. */
  static due(o: { now: number; refreshedAt?: number; licenceUntil?: number }): boolean {
    if (!o.refreshedAt || o.now - o.refreshedAt >= REFRESH_EVERY_MS || o.now < o.refreshedAt) return true;
    return !!o.licenceUntil && o.licenceUntil - o.now < RENEW_BEFORE_MS;
  }

  /** The licence file's text, or null. */
  private async current(): Promise<string | null> {
    try {
      const t = await this.fs.readFile(this.file, 'utf8');
      return t.trim() ? t : null;
    } catch {
      return null;
    }
  }

  /** Whether the licence file there now is one this keeper wrote (or there is none). */
  private async ours(state: LicenceState): Promise<boolean> {
    const now = await this.current();
    if (now === null) return true;
    if (state.wroteHash && sha(now) === state.wroteHash) return true;
    // A file nobody can use (expired, damaged, another product's) is not worth keeping either.
    return (await this.d.verify(now)).id === 'community';
  }

  /** Asks the cloud for a fresh licence and puts it in force. Never throws. */
  async refresh(fetchLicence: () => Promise<string | null>, now = Date.now()): Promise<{ outcome: 'written' | 'removed' | 'unchanged' | 'offline' | 'refused' | 'kept'; edition: Edition; error?: string }> {
    const state = await this.state();
    let token: string | null;
    try {
      token = await fetchLicence();
    } catch (err) {
      const offline = err instanceof CloudError ? err.offline : true;
      // Silence or a fault at the cloud says nothing about the account: what is in force stays (until it expires).
      return { outcome: offline ? 'offline' : 'kept', edition: await this.d.redetect(), ...(offline ? {} : { error: (err as Error).message }) };
    }
    if (token === null) {
      // No paid product on the account: the licence this file wrote goes; one put there by hand stays.
      let outcome: 'removed' | 'unchanged' = 'unchanged';
      if (state.wroteHash && (await this.ours(state)) && (await this.current()) !== null) {
        await this.fs.rm(this.file, { force: true });
        outcome = 'removed';
      }
      await this.saveState({ refreshedAt: now });
      return { outcome, edition: await this.d.redetect() };
    }
    const checked = await this.d.verify(token);
    if (checked.id === 'community') return { outcome: 'refused', edition: await this.d.redetect(), error: 'Ironleaf Cloud sent a licence this copy could not check, so the one in force was kept.' };
    if (!(await this.ours(state))) {
      // Someone put a working licence here by hand (an organisation's): it is theirs, and stays.
      await this.saveState({ ...state, refreshedAt: now });
      return { outcome: 'kept', edition: await this.d.redetect() };
    }
    await this.fs.mkdir(this.d.dataDir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await this.fs.writeFile(tmp, token.trim() + '\n');
    await this.fs.rename(tmp, this.file);
    await this.saveState({ wroteHash: sha(token), refreshedAt: now });
    return { outcome: 'written', edition: await this.d.redetect() };
  }

  /** Reads the licence files again (a licence that has just lapsed reads as Community, quietly). */
  reread(): Promise<Edition> {
    return this.d.redetect();
  }

  /** Signing out: the licence this keeper wrote goes (a hand-placed one stays); the edition is read again. */
  async forget(): Promise<Edition> {
    const state = await this.state();
    if (state.wroteHash) {
      const now = await this.current();
      if (now !== null && sha(now) === state.wroteHash) await this.fs.rm(this.file, { force: true });
    }
    await this.fs.rm(this.stateFile, { force: true }).catch(() => {});
    return this.d.redetect();
  }
}
