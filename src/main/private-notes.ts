// Private notes (16 Oct 2026): notes kept encrypted on disk in the notes' "Private notes" folder, opened with Windows
// Hello on this PC or with the person's recovery password (the notes may sync to other PCs, where this PC's Windows
// Hello can't open them). Nothing outside Ironleaf's window reads them: not search, the graph, the assistant, The
// former host app, OneDrive or another program. Each note is one file with a random name, so even the names stay
// private. They lock after a while unused, and when Ironleaf closes.
//
// Keys: one data key (AES-256-GCM) encrypts every note; it is kept wrapped in keys.nvkey, by a key from the recovery
// password (scrypt) and by each PC's Windows Hello secret (src: The former host app's windows-hello.cjs, through the
// host).

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { PRIVATE_DIR } from '../shared/private';
import { SECRETS_KEEP_UNLOCKED, type SecretsKeepUnlocked } from '../shared/prefs';
import type { PrivateEntry, PrivateStatus } from '../shared/types';
import { writeFileAtomic } from './save-guard';

/** Thrown when a sensitive action needs a fresh Windows Hello (or recovery password) check (8.2). */
export const STEP_UP_NEEDED = 'Step-up needed';
/** A step-up check is remembered this long (8.2: 5 minutes). */
export const STEP_UP_MS = 5 * 60 * 1000;

/** Windows protection for one small value on this PC (Electron safeStorage in the app; a stand-in in tests). */
export interface RememberedSeal {
  available(): boolean;
  protect(plain: Buffer): Buffer | Promise<Buffer>;
  unprotect(sealed: Buffer): Buffer | Promise<Buffer>;
}
/** Where the sealed remembered unlock is kept: on this PC, outside the vault, so it never syncs (8.2). */
export interface RememberedStore {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  clear(): Promise<void>;
}

export const PRIVATE_FOLDER = PRIVATE_DIR;
const KEY_FILE = 'keys.nvkey';
const EXT = '.nvlock';
const HELLO_NAME = 'Ironleaf private notes';
// scrypt for the recovery password: 2^17 rounds, 128 MB, about a second; guessing it is slow on any computer.
const SCRYPT = { N: 131072, r: 8, p: 1 };
const MIN_PASSWORD = 10;

export interface PrivateHello {
  available(): Promise<boolean>;
  secret(name: string, challenge: Buffer): Promise<Buffer>;
}

interface Wrapped {
  nonce: string;
  data: string;
}
interface KeyFile {
  version: 1;
  created: string;
  password: { salt: string; N: number; r: number; p: number; wrapped: Wrapped };
  devices: { id: string; name: string; challenge: string; wrapped: Wrapped; added: string }[];
  check: string;
}


const scrypt = (password: string, salt: Buffer, o: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password.normalize('NFKC'), salt, 32, { ...o, maxmem: 512 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))));

function seal(key: Buffer, plain: Buffer, aad: string): Wrapped {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return { nonce: nonce.toString('base64'), data: Buffer.concat([body, c.getAuthTag()]).toString('base64') };
}

function open(key: Buffer, w: Wrapped, aad: string): Buffer {
  const all = Buffer.from(w.data, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(w.nonce, 'base64'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(all.subarray(all.length - 16));
  return Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]);
}

const checkOf = (dataKey: Buffer) => createHmac('sha256', dataKey).update('neuralvault private notes').digest('base64');

/** A private note's place: folders and a name, "/" between, ending .md; nothing that climbs out. */
export function cleanPrivatePath(raw: string): string {
  let p = String(raw ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/').trim();
  if (p.startsWith(`${PRIVATE_FOLDER}/`)) p = p.slice(PRIVATE_FOLDER.length + 1);
  if (!p || p.length > 300 || /[<>:"|?*\u0000-\u001f]/.test(p) || p.split('/').some((s) => !s.trim() || s === '.' || s === '..' || /[. ]$/.test(s))) throw new Error('That name can’t be used for a private note.');
  return /\.md$/i.test(p) ? p : `${p}.md`;
}


export class PrivateNotes {
  private dataKey: Buffer | null = null;
  /** id → note, while unlocked. */
  private notes = new Map<string, { path: string; text: string; modified: number }>();
  private timer: NodeJS.Timeout | undefined;
  private stepUpAt = 0;
  private rememberedUntil: number | null = null;
  /** When this remembered period began (the fresh unlock, or the saved one's own start). */
  private rememberedAt = 0;

  constructor(
    private opts: {
      root: () => string | null;
      hello: PrivateHello | null;
      device: { id: string; name: string };
      /** Minutes unused before they lock (0: only when Ironleaf closes). */
      lockAfter: () => number;
      onLocked: () => void;
      trash: (abs: string) => Promise<void>;
      /** How long they stay open after one unlock (8.2); absent means the strict old minutes. */
      keepUnlocked?: () => SecretsKeepUnlocked;
      rememberedSeal?: RememberedSeal | null;
      rememberedStore?: RememberedStore | null;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }
  private keepMode(): SecretsKeepUnlocked {
    return this.opts.keepUnlocked?.() ?? 'strict';
  }
  private keepHours(): number {
    return SECRETS_KEEP_UNLOCKED.find((o) => o.id === this.keepMode())?.hours ?? 0;
  }

  private dir(): string {
    const root = this.opts.root();
    if (!root) throw new Error('Ironleaf’s notes are not open yet.');
    return path.join(root, PRIVATE_FOLDER);
  }

  private async keyFile(): Promise<KeyFile | null> {
    try {
      const k = JSON.parse(await fsp.readFile(path.join(this.dir(), KEY_FILE), 'utf8')) as KeyFile;
      return k && k.version === 1 && k.password?.wrapped && Array.isArray(k.devices) ? k : null;
    } catch {
      return null;
    }
  }

  private async writeAtomic(abs: string, text: string): Promise<void> {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    // The one safe write (Nov 2026, nv-save): fsynced and lock-retried like every other save.
    await writeFileAtomic(abs, text);
  }

  private async saveKeyFile(k: KeyFile): Promise<void> {
    await this.writeAtomic(path.join(this.dir(), KEY_FILE), JSON.stringify(k, null, 1));
  }

  /** Arms the next lock: in strict mode after the idle minutes; otherwise when the remembered period ends. */
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.dataKey) return;
    if (this.keepMode() === 'strict') {
      const minutes = this.opts.lockAfter();
      if (minutes > 0) {
        this.timer = setTimeout(() => this.lock(), minutes * 60000);
        this.timer.unref?.();
      }
    } else if (this.rememberedUntil !== null) {
      const ms = Math.max(0, this.rememberedUntil - this.now());
      this.timer = setTimeout(() => this.lock(), ms);
      this.timer.unref?.();
    }
  }

  /** The time unused starts again (each read and write; in strict mode this is the idle clock). */
  private touch(): void {
    this.schedule();
  }

  /** The window is being used (reading the list counts, 8.2): in strict mode the idle clock starts again. */
  noteUse(): void {
    if (this.dataKey) this.schedule();
  }

  /** When the remembered period ends (null: until sign-out, or not remembered). For the window's words. */
  get rememberedUntilAt(): number | null {
    return this.dataKey && this.keepMode() !== 'strict' ? this.rememberedUntil : null;
  }

  private vaultMark(): string {
    return createHash('sha256').update(this.opts.root() ?? '').digest('base64');
  }

  /** Seals the key with Windows protection on this PC, outside the vault, so a restart in the period reopens silently. */
  private async persistRemembered(): Promise<void> {
    const seal = this.opts.rememberedSeal;
    const store = this.opts.rememberedStore;
    if (!this.dataKey || !seal || !store || this.keepMode() === 'strict') return;
    try {
      if (!seal.available()) return;
      const key = this.dataKey;
      const sealed = (await seal.protect(key)).toString('base64');
      // Locked, or the strict choice made, while it was sealed: nothing is kept after that.
      if (this.dataKey !== key || this.keepMode() === 'strict') return;
      const rec = { v: 1, vault: this.vaultMark(), mode: this.keepMode(), at: this.now(), until: this.rememberedUntil, sealed };
      await store.write(JSON.stringify(rec));
    } catch {
      // No Windows protection here: the unlock is remembered only while Ironleaf runs.
    }
  }

  /** Reopens from the sealed remembered unlock, if still inside the person's chosen period. Never prompts. */
  async tryRememberedUnlock(): Promise<boolean> {
    if (this.dataKey) return true;
    const seal = this.opts.rememberedSeal;
    const store = this.opts.rememberedStore;
    if (!seal || !store || this.keepMode() === 'strict') return false;
    try {
      const raw = await store.read();
      if (!raw) return false;
      const rec = JSON.parse(raw) as { v?: number; vault?: string; at?: number; until?: number | null; sealed?: string };
      if (rec.v !== 1 || rec.vault !== this.vaultMark() || typeof rec.sealed !== 'string') {
        await store.clear().catch(() => {});
        return false;
      }
      // A shorter choice made since caps the saved period; a longer one never stretches it.
      let until = rec.until ?? null;
      const hours = this.keepHours();
      if (hours > 0 && typeof rec.at === 'number') until = Math.min(until ?? Number.POSITIVE_INFINITY, rec.at + hours * 3600_000);
      if (until !== null && !Number.isFinite(until)) until = null;
      if (until != null && until <= this.now()) {
        await store.clear().catch(() => {});
        return false;
      }
      const k = await this.keyFile();
      if (!k) return false;
      const dataKey = await seal.unprotect(Buffer.from(rec.sealed, 'base64'));
      // Opened another way, or other notes opened, or the strict choice made, while it was unsealed.
      if (this.dataKey || rec.vault !== this.vaultMark() || (this.keepMode() as string) === 'strict') {
        dataKey.fill(0);
        return !!this.dataKey;
      }
      const expected = Buffer.from(k.check, 'base64');
      const actual = Buffer.from(checkOf(dataKey), 'base64');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        dataKey.fill(0);
        await store.clear().catch(() => {});
        return false;
      }
      this.dataKey = dataKey;
      this.stepUpAt = 0; // A remembered reopen is not a step-up: the sensitive kinds still ask (8.2).
      this.rememberedAt = typeof rec.at === 'number' ? rec.at : this.now();
      this.rememberedUntil = until;
      await this.load();
      this.schedule();
      return true;
    } catch {
      return false;
    }
  }

  // ── Step-up (8.2): a fresh Hello, or the recovery password where Hello is not set up, for the sensitive kinds ──

  needsStepUp(): boolean {
    return !!this.dataKey && this.now() - this.stepUpAt > STEP_UP_MS;
  }

  assertStepUp(): void {
    if (!this.dataKey) throw new Error('This is locked. Unlock it first.');
    if (this.needsStepUp()) throw new Error(`${STEP_UP_NEEDED}: confirm it is you to do that.`);
  }

  async stepUpWithHello(): Promise<void> {
    if (!this.dataKey) throw new Error('This is locked. Unlock it first.');
    if (!(await this.helloReady())) throw new Error('Windows Hello (a PIN, face or fingerprint) isn’t set up for this Windows account. Use your recovery password.');
    await this.opts.hello!.secret(HELLO_NAME, randomBytes(32));
    this.stepUpAt = this.now();
  }

  async stepUpWithPassword(password: string): Promise<void> {
    if (!this.dataKey) throw new Error('This is locked. Unlock it first.');
    const k = await this.keyFile();
    if (!k) throw new Error('Locked notes aren’t set up on this PC yet.');
    let dataKey: Buffer;
    try {
      dataKey = open(await scrypt(String(password ?? ''), Buffer.from(k.password.salt, 'base64'), { N: k.password.N, r: k.password.r, p: k.password.p }), k.password.wrapped, 'password');
    } catch {
      throw new Error('That isn’t the recovery password.');
    }
    const ok = timingSafeEqual(Buffer.from(checkOf(dataKey), 'base64'), Buffer.from(k.check, 'base64'));
    dataKey.fill(0);
    if (!ok) throw new Error('That isn’t the recovery password.');
    this.stepUpAt = this.now();
  }

  async helloReady(): Promise<boolean> {
    try {
      return !!this.opts.hello && (await this.opts.hello.available());
    } catch {
      return false;
    }
  }

  async status(): Promise<PrivateStatus> {
    const k = await this.keyFile();
    return { exists: !!k, unlocked: !!this.dataKey, hello: await this.helloReady(), thisPc: !!k?.devices.some((d) => d.id === this.opts.device.id), count: this.dataKey ? this.notes.size : 0, ...(this.dataKey && this.keepMode() !== 'strict' ? { rememberedUntil: this.rememberedUntil } : {}) };
  }

  /** Sets them up: the recovery password, and Windows Hello on this PC when it is there. Opened straight away. */
  async setUp(password: string, withHello: boolean): Promise<PrivateStatus> {
    if (await this.keyFile()) throw new Error('Locked notes are already set up on this PC.');
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new Error(`The recovery password needs at least ${MIN_PASSWORD} characters.`);
    const dataKey = randomBytes(32);
    const salt = randomBytes(16);
    const k: KeyFile = {
      version: 1,
      created: new Date().toISOString(),
      password: { salt: salt.toString('base64'), ...SCRYPT, wrapped: seal(await scrypt(password, salt, SCRYPT), dataKey, 'password') },
      devices: [],
      check: checkOf(dataKey),
    };
    if (withHello && (await this.helloReady())) k.devices.push(await this.deviceEntry(dataKey));
    await fsp.mkdir(this.dir(), { recursive: true });
    await this.saveKeyFile(k);
    this.dataKey = dataKey;
    this.notes.clear();
    this.beginRemembered();
    return this.status();
  }

  /** A fresh unlock (password, Hello or setup): the remembered period starts, and the step-up clock with it. */
  private beginRemembered(): void {
    this.stepUpAt = this.now();
    this.rememberedAt = this.now();
    const hours = this.keepHours();
    this.rememberedUntil = this.keepMode() === 'strict' || this.keepMode() === 'until-sign-out' ? null : this.now() + hours * 3600_000;
    this.schedule();
    void this.persistRemembered();
  }

  /** The person's choice changed in Settings while open (8.5): the period is worked out again from when it began,
   *  so a shorter time can end it and a longer one never stretches a saved unlock past its own choice; choosing
   *  the strict minutes takes the remembered unlock away. */
  refreshRemembered(): void {
    if (!this.dataKey) return;
    if (this.keepMode() === 'strict') {
      this.rememberedUntil = null;
      void this.opts.rememberedStore?.clear().catch(() => {});
      this.schedule();
      return;
    }
    const hours = this.keepHours();
    this.rememberedUntil = hours > 0 ? this.rememberedAt + hours * 3600_000 : null;
    if (this.rememberedUntil !== null && this.rememberedUntil <= this.now()) {
      this.lock();
      return;
    }
    this.schedule();
    void this.persistRemembered();
  }

  private async deviceEntry(dataKey: Buffer): Promise<KeyFile['devices'][number]> {
    const challenge = randomBytes(32);
    const secret = await this.opts.hello!.secret(HELLO_NAME, challenge);
    return { id: this.opts.device.id, name: this.opts.device.name, challenge: challenge.toString('base64'), wrapped: seal(secret, dataKey, `device:${this.opts.device.id}`), added: new Date().toISOString() };
  }

  /** Opens them with Windows Hello (this PC must have been added). */
  async unlockWithHello(): Promise<PrivateStatus> {
    const k = await this.keyFile();
    if (!k) throw new Error('Locked notes aren’t set up on this PC yet.');
    const mine = k.devices.find((d) => d.id === this.opts.device.id);
    if (!mine) throw new Error('This PC hasn’t been added yet: open Locked with your recovery password, then add this PC.');
    if (!(await this.helloReady())) throw new Error('Windows Hello (a PIN, face or fingerprint) isn’t set up for this Windows account.');
    const secret = await this.opts.hello!.secret(HELLO_NAME, Buffer.from(mine.challenge, 'base64'));
    let dataKey: Buffer;
    try {
      dataKey = open(secret, mine.wrapped, `device:${mine.id}`);
    } catch {
      throw new Error('Windows Hello on this PC can’t open them any more. Open them with your recovery password, then add this PC again.');
    }
    return this.opened(k, dataKey);
  }

  /** Opens them with the recovery password (on any PC). */
  async unlockWithPassword(password: string): Promise<PrivateStatus> {
    const k = await this.keyFile();
    if (!k) throw new Error('Locked notes aren’t set up on this PC yet.');
    const salt = Buffer.from(k.password.salt, 'base64');
    let dataKey: Buffer;
    try {
      dataKey = open(await scrypt(String(password ?? ''), salt, { N: k.password.N, r: k.password.r, p: k.password.p }), k.password.wrapped, 'password');
    } catch {
      throw new Error('That isn’t the recovery password.');
    }
    return this.opened(k, dataKey);
  }

  private async opened(k: KeyFile, dataKey: Buffer): Promise<PrivateStatus> {
    const expected = Buffer.from(k.check, 'base64');
    const actual = Buffer.from(checkOf(dataKey), 'base64');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('The private notes’ key doesn’t match. Open them with the recovery password.');
    this.dataKey = dataKey;
    await this.load();
    this.beginRemembered();
    return this.status();
  }

  /** This PC opens them with Windows Hello from now on (they are open). */
  async addThisPc(): Promise<PrivateStatus> {
    if (!this.dataKey) throw new Error('Open Locked first.');
    this.assertStepUp();
    if (!(await this.helloReady())) throw new Error('Windows Hello (a PIN, face or fingerprint) isn’t set up for this Windows account.');
    const k = await this.keyFile();
    if (!k) throw new Error('Locked notes aren’t set up on this PC yet.');
    k.devices = [...k.devices.filter((d) => d.id !== this.opts.device.id), await this.deviceEntry(this.dataKey)];
    await this.saveKeyFile(k);
    this.touch();
    return this.status();
  }

  /** A new recovery password (they are open; the old one stops working). */
  async changePassword(password: string): Promise<void> {
    if (!this.dataKey) throw new Error('Open Locked first.');
    this.assertStepUp();
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new Error(`The recovery password needs at least ${MIN_PASSWORD} characters.`);
    const k = await this.keyFile();
    if (!k) throw new Error('Locked notes aren’t set up on this PC yet.');
    const salt = randomBytes(16);
    k.password = { salt: salt.toString('base64'), ...SCRYPT, wrapped: seal(await scrypt(password, salt, SCRYPT), this.dataKey, 'password') };
    await this.saveKeyFile(k);
    this.touch();
  }

  /** Locked for real (Lock now, signing out of Windows, Windows lock or sleep when the person turned that on, the
   *   period ending): the remembered unlock goes too. Opening a vault is not this (close below): the sealed unlock
   *   is checked straight after and kept only when it is this vault's and still in its period (8.5). */
  lock(): void {
    void this.opts.rememberedStore?.clear().catch(() => {});
    this.wipe();
  }

  /** Ironleaf itself is closing: the words leave memory, but a restart inside the remembered period reopens (8.2). */
  close(): void {
    this.wipe();
  }

  /** Closed again: the key and every note's words leave memory (and Secrets', src/main/secrets.ts). */
  private wipe(): void {
    const was = !!this.dataKey;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.dataKey?.fill(0);
    this.dataKey = null;
    this.stepUpAt = 0;
    this.rememberedUntil = null;
    this.rememberedAt = 0;
    this.notes.clear();
    if (was) {
      for (const fn of this.lockListeners) fn();
      this.opts.onLocked();
    }
  }

  private lockListeners = new Set<() => void>();
  /** Told when the store locks (Secrets forget their values). */
  onLock(fn: () => void): () => void {
    this.lockListeners.add(fn);
    return () => this.lockListeners.delete(fn);
  }

  get unlocked(): boolean {
    return !!this.dataKey;
  }

  /** The folder the store keeps its files in (Secrets keep theirs beside the notes'). */
  folder(): string {
    return this.dir();
  }

  /** Sealed with the store's key (Secrets: one file each, `aad` its id), for writing whole. */
  sealItem(aad: string, plain: string): string {
    return JSON.stringify({ v: 1, ...seal(this.key(), Buffer.from(plain, 'utf8'), aad) });
  }

  /** A sealed item opened with the store's key; throws when it isn't this store's (or was changed). */
  openItem(aad: string, sealed: string): string {
    const w = JSON.parse(sealed) as Wrapped;
    return open(this.key(), w, aad).toString('utf8');
  }

  /** Written whole through a temporary file (never half written), in the store's folder. */
  async writeItem(name: string, text: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{6,60}\.[a-z]{3,10}$/.test(name)) throw new Error('That isn’t a name the store uses.');
    await this.writeAtomic(path.join(this.dir(), name), text);
    this.touch();
  }

  private key(): Buffer {
    if (!this.dataKey) throw new Error('This is locked. Unlock it first.');
    this.touch();
    return this.dataKey;
  }

  /** Every note read again from disk (when unlocked, or when files changed under it: another PC synced). */
  async load(): Promise<void> {
    const key = this.key();
    const next = new Map<string, { path: string; text: string; modified: number }>();
    let names: string[] = [];
    try {
      names = (await fsp.readdir(this.dir())).filter((n) => n.endsWith(EXT));
    } catch {
      names = [];
    }
    for (const name of names) {
      const id = name.slice(0, -EXT.length);
      try {
        const w = JSON.parse(await fsp.readFile(path.join(this.dir(), name), 'utf8')) as Wrapped & { v: number };
        const note = JSON.parse(open(key, w, id).toString('utf8')) as { path: string; text: string; modified: number };
        if (typeof note?.path === 'string' && typeof note.text === 'string') next.set(id, { path: cleanPrivatePath(note.path), text: note.text, modified: Number(note.modified) || 0 });
      } catch {
        // A file this key can't open (damaged, or half-synced) is left on disk as it is.
      }
    }
    this.notes = next;
  }

  list(): PrivateEntry[] {
    this.key();
    return [...this.notes.values()].map((n) => ({ path: `${PRIVATE_FOLDER}/${n.path}`, modified: n.modified, size: n.text.length })).sort((a, b) => a.path.localeCompare(b.path));
  }

  private idOf(rel: string): string | undefined {
    const p = cleanPrivatePath(rel).toLowerCase();
    for (const [id, n] of this.notes) if (n.path.toLowerCase() === p) return id;
    return undefined;
  }

  has(rel: string): boolean {
    return !!this.dataKey && !!this.idOf(rel);
  }

  read(rel: string): string {
    this.key();
    const id = this.idOf(rel);
    if (!id) throw new Error('That private note isn’t there.');
    return this.notes.get(id)!.text;
  }

  private async put(id: string, note: { path: string; text: string; modified: number }): Promise<void> {
    const w = seal(this.key(), Buffer.from(JSON.stringify(note), 'utf8'), id);
    await this.writeAtomic(path.join(this.dir(), `${id}${EXT}`), JSON.stringify({ v: 1, ...w }));
    this.notes.set(id, note);
  }

  /** Writes a private note (made when new). Returns its path. */
  async write(rel: string, text: string): Promise<string> {
    const p = cleanPrivatePath(rel);
    const id = this.idOf(p) ?? randomUUID();
    await this.put(id, { path: p, text: String(text ?? ''), modified: Date.now() });
    return `${PRIVATE_FOLDER}/${p}`;
  }

  /** A new private note in a folder of the private notes. One that is already there under that name (any
   *  capitals) is the note: it is returned as it is, never a numbered copy beside it (2 Nov 2026, 9.5 fresh
   *  eyes: making "Blood tests" twice must open the one note, not mint "Blood tests 1"). */
  async create(folder: string, base: string, text = ''): Promise<string> {
    this.key();
    const dir = folder ? cleanPrivatePath(`${folder}/x`).replace(/\/x\.md$/i, '') : '';
    const name = String(base || 'Untitled').replace(/[\\/:*?"<>|#^[\]]+/g, ' ').trim() || 'Untitled';
    const candidate = `${dir ? `${dir}/` : ''}${name}.md`;
    const there = [...this.notes.values()].find((n) => n.path.toLowerCase() === candidate.toLowerCase());
    if (there) return `${PRIVATE_FOLDER}/${there.path}`;
    return this.write(candidate, text);
  }

  async rename(from: string, to: string): Promise<string> {
    const id = this.idOf(from);
    if (!id) throw new Error('That private note isn’t there.');
    const p = cleanPrivatePath(to);
    const other = this.idOf(p);
    if (other && other !== id) throw new Error('A private note with that name is already there.');
    await this.put(id, { ...this.notes.get(id)!, path: p, modified: Date.now() });
    return `${PRIVATE_FOLDER}/${p}`;
  }

  /** To the Bin (encrypted, as it is on disk). */
  async remove(rel: string): Promise<void> {
    const id = this.idOf(rel);
    if (!id) return;
    await this.opts.trash(path.join(this.dir(), `${id}${EXT}`));
    this.notes.delete(id);
    this.touch();
  }

  /** Private notes whose name or words have the words asked for (only while open; never indexed). */
  search(query: string): { path: string; line: string }[] {
    this.key();
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return [];
    const out: { path: string; line: string }[] = [];
    for (const n of this.notes.values()) {
      const line = n.text.split('\n').find((l) => l.toLowerCase().includes(q));
      if (n.path.toLowerCase().includes(q) || line !== undefined) out.push({ path: `${PRIVATE_FOLDER}/${n.path}`, line: (line ?? '').trim().slice(0, 160) });
    }
    return out.slice(0, 100);
  }
}
