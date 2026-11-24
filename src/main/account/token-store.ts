// SPDX-License-Identifier: AGPL-3.0-or-later
// Where the sign-in is kept between starts: one file in Ironleaf's data folder (account.sealed), sealed by the operating
// system's protected store (Electron's safeStorage: DPAPI on Windows, the Keychain on macOS, the keyring on Linux).
// The tokens are never written in plain text: when this PC has no protected store, the sign-in lasts until Ironleaf
// quits and nothing is written at all. The tokens never go to the window either (src/main/account/service.ts sends
// it a view with no token in it).

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { KeyedQueue } from '../save-guard';
import type { Profile, Tokens } from './oidc';

export const SEALED_FILE = 'account.sealed';

/** What is kept for a signed-in person. */
export interface SignedIn {
  tokens: Tokens;
  profile: Profile;
  /** This PC's id at the cloud (POST /devices), once registered. */
  deviceId?: string;
}

/** Electron's safeStorage, as this file needs it (the checks pass their own). */
export interface Sealer {
  available(): boolean;
  seal(plain: string): Buffer | Promise<Buffer>;
  open(sealed: Buffer): string | Promise<string>;
}

const MAGIC = 'ironleaf-account-1\n';

export class TokenStore {
  private memory: SignedIn | null = null;
  private loaded = false;
  /** One write or removal at a time: signing out while a save is being sealed must end signed out. */
  private writes = new KeyedQueue();
  readonly file: string;

  constructor(
    dataDir: string,
    private sealer: Sealer,
    private fs: Pick<typeof fsp, 'readFile' | 'writeFile' | 'rm' | 'rename' | 'mkdir'> = fsp,
  ) {
    this.file = path.join(dataDir, SEALED_FILE);
  }

  /** Whether a sign-in can outlast this run (the OS store is there). */
  get persistent(): boolean {
    try {
      return this.sealer.available();
    } catch {
      return false;
    }
  }

  async load(): Promise<SignedIn | null> {
    if (this.loaded) return this.memory;
    this.loaded = true;
    if (!this.persistent) return this.memory;
    let buf: Buffer;
    try {
      buf = await this.fs.readFile(this.file);
    } catch {
      return null;
    }
    try {
      const text = await this.sealer.open(buf);
      if (!text.startsWith(MAGIC)) throw new Error('not ours');
      const v = JSON.parse(text.slice(MAGIC.length)) as SignedIn;
      if (!v?.tokens?.accessToken || !v.profile) throw new Error('incomplete');
      this.memory = v;
    } catch {
      // Sealed on another PC or by another user, or damaged: as if signed out; the file goes.
      await this.fs.rm(this.file, { force: true }).catch(() => {});
      this.memory = null;
    }
    return this.memory;
  }

  get(): SignedIn | null {
    return this.memory;
  }

  async save(v: SignedIn): Promise<void> {
    this.memory = v;
    this.loaded = true;
    if (!this.persistent) return; // No protected store: kept for this run only, never written in plain text.
    await this.writes.run(this.file, async () => {
      const sealed = await this.sealer.seal(MAGIC + JSON.stringify(v));
      if (this.memory !== v) return; // Signed out, or saved again, while it was sealed.
      await this.fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await this.fs.writeFile(tmp, sealed, { mode: 0o600 });
      await this.fs.rename(tmp, this.file);
    });
  }

  async clear(): Promise<void> {
    this.memory = null;
    this.loaded = true;
    await this.writes.run(this.file, () => this.fs.rm(this.file, { force: true }).catch(() => {}));
  }
}
