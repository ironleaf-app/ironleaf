// A connection's key typed into Ironleaf: kept per connection id, encrypted by the operating system (Electron
// safeStorage), never in plain text and never shown again.

import { app, safeStorage } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { KeyedQueue, writeFileAtomic } from '../save-guard';

const MAX_KEY = 65536;

export class KeyStore {
  private keys: Record<string, string> = {};

  private get file(): string {
    return path.join(app.getPath('userData'), 'provider-keys.bin');
  }

  async load(): Promise<void> {
    try {
      const bytes = await fsp.readFile(this.file);
      const value = safeStorage.isEncryptionAvailable() ? JSON.parse(safeStorage.decryptString(bytes)) : null;
      this.keys = value && typeof value.keys === 'object' && value.keys ? value.keys : {};
    } catch {
      this.keys = {};
    }
  }

  has(connectionId: string): boolean {
    return Object.hasOwn(this.keys, connectionId);
  }

  get(connectionId: string): string | undefined {
    return Object.hasOwn(this.keys, connectionId) ? this.keys[connectionId] : undefined;
  }

  async set(connectionId: string, key: string): Promise<void> {
    const value = String(key ?? '').trim();
    if (!value || value.length > MAX_KEY || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('That does not look like a key. Paste the whole key, with nothing around it.');
    this.keys = { ...this.keys, [connectionId]: value };
    await this.save();
  }

  async remove(connectionId: string): Promise<void> {
    if (!this.has(connectionId)) return;
    const { [connectionId]: _gone, ...rest } = this.keys;
    this.keys = rest;
    await this.save();
  }

  private writes = new KeyedQueue();
  /** provider-keys.bin written whole, one save at a time, each through its own temp (two keys saved at once shared
   *  one <file>.<pid>.tmp: the second rename failed and the file could be half of each). Each save writes what is
   *  current when its turn comes. */
  private save(): Promise<void> {
    return this.writes.run(this.file, async () => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('This PC can’t protect saved keys, so the key was not saved.');
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      await writeFileAtomic(this.file, safeStorage.encryptString(JSON.stringify({ keys: this.keys })));
    });
  }
}
