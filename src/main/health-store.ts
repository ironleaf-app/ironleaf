// The health store (Wave 5, 24 Oct 2026; the spec: "Health data stays on this PC, encrypted, with the key protected by
// Windows… Health tables live in their own database file"). One file per vault on this PC, in Ironleaf's own data folder
// (never in the vault, so it never syncs anywhere): health.nvdb holds every table (src/shared/health.ts), sealed with
// AES-256-GCM under a random data key; health.nvkey holds that key protected by the operating system's protected store
// (Windows: DPAPI, through Electron's safeStorage), so only this Windows account on this PC opens it.
//
// Nothing is made until Health and Fitness is on and something is written: switched off, the store is closed (the key
// forgotten from memory) and its files stay as they are. Writes go one at a time, through a temporary file, so the file is
// never half written; a damaged file is put aside (never written over) and a new one started, with the reason said.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { cleanDb, emptyDb, type HealthDb } from '../shared/health';

/** The operating system's protected store (safeStorage in the app; a stand-in in tests). */
export interface KeyProtector {
  available(): boolean;
  protect(plain: Buffer): Buffer | Promise<Buffer>;
  unprotect(sealed: Buffer): Buffer | Promise<Buffer>;
}

const DB_FILE = 'health.nvdb';
const KEY_FILE = 'health.nvkey';
const AAD = 'neuralvault health store v1';

interface Sealed {
  version: 1;
  nonce: string;
  data: string;
}
interface KeyFile {
  version: 1;
  created: string;
  protected: string;
  /** A fingerprint of the key (to know the file and the key belong together), never the key. */
  check: string;
}

const checkOf = (key: Buffer) => createHash('sha256').update(key).update('health-check').digest('base64').slice(0, 22);

export function seal(key: Buffer, plain: string): Sealed {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(Buffer.from(AAD));
  const body = Buffer.concat([c.update(Buffer.from(plain, 'utf8')), c.final()]);
  return { version: 1, nonce: nonce.toString('base64'), data: Buffer.concat([body, c.getAuthTag()]).toString('base64') };
}

export function unseal(key: Buffer, s: Sealed): string {
  const all = Buffer.from(s.data, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(s.nonce, 'base64'));
  d.setAAD(Buffer.from(AAD));
  d.setAuthTag(all.subarray(all.length - 16));
  return Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]).toString('utf8');
}

export interface HealthStoreStatus {
  /** The store's files are on this PC for this vault. */
  exists: boolean;
  open: boolean;
  /** This PC can protect the key (else nothing is written, and the page says why). */
  protectable: boolean;
  /** Put aside because it couldn't be opened (when that happened), in words. */
  problem?: string;
}

export class HealthStore {
  private key: Buffer | null = null;
  private db: HealthDb | null = null;
  private dirOpen: string | null = null;
  private writing: Promise<void> = Promise.resolve();
  private problem: string | undefined;

  constructor(
    private opts: {
      /** This vault's folder for the store on this PC (null: no vault open). */
      dir: () => string | null;
      protector: KeyProtector;
      log?: (m: string) => void;
    },
  ) {}

  private dir(): string {
    const d = this.opts.dir();
    if (!d) throw new Error('Open your vault first.');
    // Another vault opened: the store open now was the other vault's.
    if (this.dirOpen && this.dirOpen !== d) this.close();
    return d;
  }

  async status(): Promise<HealthStoreStatus> {
    const d = this.opts.dir();
    let exists = false;
    if (d) exists = await fsp.access(path.join(d, KEY_FILE)).then(() => true, () => false);
    return { exists, open: !!this.db && this.dirOpen === d, protectable: this.opts.protector.available(), ...(this.problem ? { problem: this.problem } : {}) };
  }

  /** Forgets the key and the records (the module switched off, the vault closed, Ironleaf closing). */
  close(): void {
    this.key?.fill(0);
    this.key = null;
    this.db = null;
    this.dirOpen = null;
  }

  private async readKey(dir: string): Promise<Buffer | null> {
    let k: KeyFile;
    try {
      k = JSON.parse(await fsp.readFile(path.join(dir, KEY_FILE), 'utf8')) as KeyFile;
    } catch {
      return null;
    }
    if (k?.version !== 1 || typeof k.protected !== 'string') throw new Error('The health store’s key file can’t be read.');
    if (!this.opts.protector.available()) throw new Error('Windows can’t open protected data for Ironleaf right now, so your health records stay locked. Try again after signing in to Windows again.');
    let key: Buffer;
    try {
      key = Buffer.from((await this.opts.protector.unprotect(Buffer.from(k.protected, 'base64'))).toString('utf8'), 'base64');
    } catch {
      throw new Error('This Windows account can’t open the health store’s key. Health records are kept for the Windows account and PC that made them.');
    }
    if (key.length !== 32 || checkOf(key) !== k.check) throw new Error('The health store’s key doesn’t match its records.');
    return key;
  }

  private async writeAtomic(abs: string, text: string): Promise<void> {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${randomBytes(6).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, abs);
  }

  /** The records, opened from disk the first time (an empty store when there is none yet: nothing is written by reading). */
  async read(): Promise<HealthDb> {
    const dir = this.dir();
    if (this.db) return this.db;
    const key = await this.readKey(dir);
    if (!key) {
      // Nothing kept yet: an empty store in memory, written only with the first change.
      this.dirOpen = dir;
      this.db = emptyDb();
      return this.db;
    }
    let raw: string | null = null;
    try {
      raw = await fsp.readFile(path.join(dir, DB_FILE), 'utf8');
    } catch {
      raw = null;
    }
    let db: HealthDb;
    if (raw === null) db = emptyDb();
    else {
      try {
        db = cleanDb(JSON.parse(unseal(key, JSON.parse(raw) as Sealed)));
      } catch {
        // Damaged (or written by something else): put aside as it is, and a new store started, said once.
        const aside = path.join(dir, `health damaged ${new Date().toISOString().replace(/[:.]/g, '-')}.nvdb`);
        await fsp.rename(path.join(dir, DB_FILE), aside).catch(() => {});
        this.problem = 'Your health records couldn’t be opened, so they were put aside and a new store was started. Nothing was deleted.';
        this.opts.log?.(`Health store: ${DB_FILE} couldn't be opened; put aside as ${path.basename(aside)}`);
        db = emptyDb();
      }
    }
    this.key = key;
    this.db = db;
    this.dirOpen = dir;
    return db;
  }

  /** A change written: `fn` gets the records and returns them changed (one change at a time, never half written). */
  async change(fn: (db: HealthDb) => HealthDb | Promise<HealthDb>): Promise<HealthDb> {
    const run = this.writing.then(async () => {
      const dir = this.dir();
      const now = await this.read();
      const next = cleanDb(JSON.parse(JSON.stringify(await fn(now))));
      if (!this.key) {
        if (!this.opts.protector.available()) throw new Error('This PC can’t protect the health store’s key (Windows’ protected store isn’t available), so nothing was saved.');
        const key = randomBytes(32);
        const k: KeyFile = { version: 1, created: new Date().toISOString(), protected: (await this.opts.protector.protect(Buffer.from(key.toString('base64'), 'utf8'))).toString('base64'), check: checkOf(key) };
        await this.writeAtomic(path.join(dir, KEY_FILE), JSON.stringify(k, null, 1));
        this.key = key;
      }
      await this.writeAtomic(path.join(dir, DB_FILE), JSON.stringify(seal(this.key, JSON.stringify(next))));
      this.db = next;
      this.dirOpen = dir;
    });
    this.writing = run.catch(() => {});
    await run;
    return this.db!;
  }

  /** Waits for writes so far (tests). */
  async settled(): Promise<void> {
    await this.writing;
  }
}
