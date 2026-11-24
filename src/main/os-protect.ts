// SPDX-License-Identifier: AGPL-3.0-or-later
// The operating system's protected store, in one place (24 Nov 2026): the AI keys, the account's sign-in, backup secrets,
// the sync and team keys, the remembered unlock and the health store's key are all sealed through here. Electron 46
// takes the synchronous safeStorage methods away, so this uses the ones that answer later.
//
// They are not a straight swap. On a Linux PC with no keyring the old methods said "not available" and Ironleaf kept
// nothing; the new ones say "available" and seal with a key that is the same in every copy of Chromium (the "v10" mark),
// which anyone can open. That is no protection, so it counts as not available here, as it always has.

import { promises as fsp } from 'node:fs';

/** The part of Electron's safeStorage this uses (the checks pass their own). */
export interface SafeStorageLater {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plain: string): Promise<Buffer>;
  decryptStringAsync(sealed: Buffer): Promise<{ result: string }>;
}

/** Sealed on Linux with Chromium's fixed key, not the person's keyring. */
export const fixedKey = (sealed: Buffer, platform: NodeJS.Platform): boolean => platform === 'linux' && sealed.subarray(0, 3).toString('latin1') === 'v10';

export class OsProtect {
  private known = false;
  private asking: Promise<boolean> | null = null;
  private plain = false;

  constructor(
    private readonly store: () => SafeStorageLater,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  /** The end-to-end checks on Linux only (no keyring there): the fixed key is taken as protection. Never in the product. */
  allowFixedKey(): void {
    this.plain = true;
  }

  /** Asks the operating system (after the app is ready), and remembers a yes. Never throws. */
  ready(): Promise<boolean> {
    if (this.known) return Promise.resolve(true);
    this.asking ??= this.ask().finally(() => (this.asking = null));
    return this.asking;
  }

  private async ask(): Promise<boolean> {
    try {
      const s = this.store();
      if (!(await s.isAsyncEncryptionAvailable())) return false;
      if (this.platform === 'linux' && !this.plain && fixedKey(await s.encryptStringAsync('check'), this.platform)) return false;
      this.known = true;
      return true;
    } catch {
      return false;
    }
  }

  /** What ready() last found. A no is asked again behind, so a keyring unlocked later is noticed. */
  available(): boolean {
    if (!this.known) void this.ready();
    return this.known;
  }

  async seal(plain: string): Promise<Buffer> {
    if (!(await this.ready())) throw new Error('This PC’s protected store isn’t available.');
    const sealed = await this.store().encryptStringAsync(plain);
    // The keyring can go between asking and sealing: what it was sealed with is what counts.
    if (!this.plain && fixedKey(sealed, this.platform)) {
      this.known = false;
      throw new Error('This PC’s protected store isn’t available.');
    }
    return sealed;
  }

  async open(sealed: Buffer): Promise<string> {
    if (!(await this.ready())) throw new Error('This PC’s protected store isn’t available.');
    return (await this.store().decryptStringAsync(sealed)).result;
  }
}

/** A kept file that is there but can't be opened is copied beside itself before anything writes over it. */
export async function keepUnread(file: string): Promise<void> {
  await fsp.copyFile(file, `${file}.unread`).catch(() => {});
}
