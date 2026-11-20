// Encrypted sync folder (21 Oct 2026, gap G28; Settings › Backup and sync). An end-to-end encrypted copy of the notes in
// any folder the person picks — a OneDrive or Dropbox folder, a NAS share, a USB drive — that another PC with the same
// passphrase syncs with, both ways. Everything is encrypted on this PC before it's written there:
//
//   <folder>/Ironleaf sync/key.nvsync        the salt and scrypt settings, and a check sealed with the key (no key)
//   <folder>/Ironleaf sync/manifest.nvsync   the list of files (names, sizes, fingerprints), sealed
//   <folder>/Ironleaf sync/files/ab/<id>.nvblob   each file's bytes, sealed; <id> is a keyed hash of its name and
//                                               fingerprint, so neither names nor contents can be read or matched
//
// Keys: scrypt(passphrase, salt) gives one secret; HKDF splits it into the sealing key (AES-256-GCM, a fresh 12-byte
// nonce per write, the file's id bound in as associated data so sealed files can't be swapped) and the naming key
// (HMAC-SHA-256). The passphrase is kept on this PC encrypted by Windows (src/main/backup.ts), never in the folder.
//
// Two-way merge against what both sides last agreed (kept in Ironleaf's own data, per vault): a side that changed
// wins over one that didn't; when both changed, this PC's version stays and the other one is kept beside it as
// "<name> (conflict, <when>, from <PC>)"; a file deleted on one side and changed on the other comes back. A file
// deleted elsewhere goes to this PC's Bin, never straight off the disk.

import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { runDue, whenWords, type SyncFolderPrefs } from '../shared/backup';

export const SYNC_DIR = 'Ironleaf sync';
const KEY_FILE = 'key.nvsync';
const MANIFEST = 'manifest.nvsync';
const LOCK = 'lock.nvsync';
const BLOBS = 'files';
const CHECK = 'neuralvault-sync-check-v1';
const MIN_PASSPHRASE = 10;
const MAX_FILE = 200 * 1024 * 1024;
/** Another PC's lock older than this is taken to be left behind (its sync stopped part-way). */
const LOCK_STALE_MS = 10 * 60_000;
/** Sealed files no list names any more are tidied away once they're this old (another PC may be writing a new one). */
const ORPHAN_MS = 30 * 60_000;
export const SCRYPT_DEFAULT = { N: 131072, r: 8, p: 1 };

export class SyncProblem extends Error {}
export class WrongPassphrase extends SyncProblem {
  constructor() {
    super('That passphrase doesn’t open this sync folder. Use the passphrase it was set up with on your other PC.');
  }
}

interface KeyFile {
  version: 1;
  kind: 'neuralvault-sync';
  vault: string;
  salt: string;
  N: number;
  r: number;
  p: number;
  check: string;
}

export interface ManifestEntry {
  /** SHA-256 of the file's bytes, hex. */
  sha: string;
  size: number;
  /** When the PC that sent it last changed it. */
  at: number;
  /** Which PC sent it (its name). */
  by: string;
}

export interface Manifest {
  version: 1;
  updated: number;
  by: string;
  files: Record<string, ManifestEntry>;
}

interface Base {
  vault: string;
  /** What both sides agreed at the last sync: path → fingerprint. */
  agreed: Record<string, string>;
  /** This PC's fingerprints by size and time changed, so unchanged files aren't read again. */
  seen: Record<string, { size: number; mtime: number; sha: string }>;
}

interface Keys {
  seal: Buffer;
  name: Buffer;
}

export interface SyncDeps {
  root(): string | null;
  prefs(): SyncFolderPrefs;
  passphrase(): Promise<string | null>;
  /** Ironleaf's own data for this vault (the last agreed state is kept there, never in the notes). */
  stateDir(): string | null;
  device: { id: string; name: string };
  /** A local file removed because it was deleted elsewhere: to the Bin. */
  trash(abs: string): Promise<void>;
  changed?(): void;
  /** Local files written by a sync (the vault reads them again). */
  wrote?(rels: string[]): void;
  now?(): number;
  scrypt?: { N: number; r: number; p: number };
}

export interface SyncResult {
  sent: number;
  received: number;
  removed: number;
  conflicts: string[];
}

const scrypt = (pass: string, salt: Buffer, o: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pass.normalize('NFC'), salt, 32, o, (err, key) => (err ? reject(err) : resolve(key))));

function deriveKeys(master: Buffer): Keys {
  return {
    seal: Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'neuralvault-sync seal', 32)),
    name: Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'neuralvault-sync names', 32)),
  };
}

/** AES-256-GCM: nonce (12) | tag (16) | sealed bytes, with `aad` bound in. */
export function seal(key: Buffer, plain: Buffer, aad: string): Buffer {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([nonce, c.getAuthTag(), body]);
}

export function open(key: Buffer, sealed: Buffer, aad: string): Buffer {
  if (sealed.length < 28) throw new SyncProblem('A file in the sync folder is damaged.');
  const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([d.update(sealed.subarray(28)), d.final()]);
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** A sealed file's id: a keyed hash of its path and fingerprint (nothing readable, nothing matchable). */
export const blobId = (k: Keys, rel: string, sha: string) => createHmac('sha256', k.name).update(rel.normalize('NFC')).update('\0').update(sha).digest('hex');

/** The paths a sync carries: every file in the notes but dot folders (.git, .trash…; .neuralvault travels), temporary
 *  files and the sync folder itself if someone put it inside the notes. */
export async function localFiles(root: string, skip: (abs: string) => boolean = () => false): Promise<Map<string, { abs: string; size: number; mtime: number }>> {
  const out = new Map<string, { abs: string; size: number; mtime: number }>();
  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink() || skip(abs)) continue;
      if (e.isDirectory()) {
        if ((e.name.startsWith('.') && e.name !== '.neuralvault') || e.name === 'node_modules' || e.name === SYNC_DIR) continue;
        await walk(abs, r);
      } else if (e.isFile()) {
        if (/\.(nvtmp|tmp)$/i.test(e.name) || e.name.startsWith('~$') || /^(thumbs\.db|desktop\.ini|\.ds_store)$/i.test(e.name)) continue;
        const info = await fsp.stat(abs).catch(() => null);
        if (info && info.size <= MAX_FILE) out.set(r.normalize('NFC'), { abs, size: info.size, mtime: Math.round(info.mtimeMs) });
      }
    }
  }
  await walk(root, '');
  return out;
}

/** "Plans (conflict, 21 Oct 2026 3.42 pm, from LAPTOP).md": beside the note, never over it. */
export function conflictName(rel: string, at: number, from: string): string {
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
  const file = rel.slice(dir.length);
  const dot = file.lastIndexOf('.');
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : '';
  const when = whenWords(at).replace(',', '').replace(/:/g, '.');
  const who = from.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').trim().slice(0, 40) || 'another PC';
  return `${dir}${stem} (conflict, ${when}, from ${who})${ext}`;
}

export class SyncFolder {
  lastOk = 0;
  lastRun = 0;
  words = '';
  error = '';
  busy = false;
  files = 0;
  conflicts = 0;
  private timer: NodeJS.Timeout | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private keyCache: { folder: string; pass: string; keys: Keys; vault: string } | null = null;

  constructor(private readonly d: SyncDeps) {}

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  reset(): void {
    this.lastOk = this.lastRun = this.files = this.conflicts = 0;
    this.words = this.error = '';
    this.keyCache = null;
  }

  async tick(): Promise<boolean> {
    const p = this.d.prefs();
    if (!this.d.root() || !p.folder || !runDue({ on: p.on, minutes: p.minutes, lastRun: this.lastRun, now: this.now(), busy: this.busy })) return false;
    await this.sync().catch(() => {});
    return true;
  }

  private dir(folder = this.d.prefs().folder): string {
    if (!folder || !path.isAbsolute(folder)) throw new SyncProblem('Choose a folder for the encrypted copy first.');
    return path.join(folder, SYNC_DIR);
  }

  /** Whether a folder already holds an Ironleaf sync copy. */
  async existing(folder: string): Promise<boolean> {
    if (!folder || !path.isAbsolute(folder)) return false;
    return !!(await fsp.stat(path.join(folder, SYNC_DIR, KEY_FILE)).catch(() => null));
  }

  /**
   * Sets the folder up with a passphrase (a new copy), or checks the passphrase opens the copy already there (another
   * PC's). Throws WrongPassphrase when it doesn't. Nothing is synced yet.
   */
  async prepare(folder: string, passphrase: string): Promise<{ joined: boolean }> {
    if (passphrase.normalize('NFC').length < MIN_PASSPHRASE) throw new SyncProblem(`Use a passphrase of at least ${MIN_PASSPHRASE} characters: a few words you’ll remember is best.`);
    const dir = this.dir(folder);
    const keyFile = path.join(dir, KEY_FILE);
    const there = await fsp.readFile(keyFile, 'utf8').catch(() => null);
    if (there) {
      await this.keysFor(folder, passphrase);
      return { joined: true };
    }
    const top = await fsp.stat(folder).catch(() => null);
    if (!top?.isDirectory()) throw new SyncProblem('That folder isn’t there. Choose a folder that exists (plug the drive in first).');
    const s = this.d.scrypt ?? SCRYPT_DEFAULT;
    const salt = randomBytes(16);
    const master = await scrypt(passphrase, salt, { ...s, maxmem: 256 * 1024 * 1024 });
    const keys = deriveKeys(master);
    const file: KeyFile = { version: 1, kind: 'neuralvault-sync', vault: randomBytes(12).toString('hex'), salt: salt.toString('base64'), N: s.N, r: s.r, p: s.p, check: seal(keys.seal, Buffer.from(CHECK), 'check').toString('base64') };
    await fsp.mkdir(path.join(dir, BLOBS), { recursive: true });
    await writeAtomic(keyFile, Buffer.from(JSON.stringify(file, null, 2)));
    await writeAtomic(path.join(dir, MANIFEST), seal(keys.seal, Buffer.from(JSON.stringify({ version: 1, updated: this.now(), by: this.d.device.name, files: {} } satisfies Manifest)), 'manifest'));
    this.keyCache = { folder, pass: passphrase, keys, vault: file.vault };
    return { joined: false };
  }

  private async keysFor(folder: string, pass: string): Promise<{ keys: Keys; vault: string }> {
    if (this.keyCache && this.keyCache.folder === folder && this.keyCache.pass === pass) return this.keyCache;
    const raw = await fsp.readFile(path.join(this.dir(folder), KEY_FILE), 'utf8').catch(() => null);
    if (raw === null) throw new SyncProblem('The sync folder isn’t there. If it’s on a drive, plug it in; if it moved, choose it again.');
    let file: KeyFile;
    try {
      file = JSON.parse(raw) as KeyFile;
    } catch {
      throw new SyncProblem('The sync folder’s key file is damaged.');
    }
    if (file.kind !== 'neuralvault-sync' || file.version !== 1 || ![file.N, file.r, file.p].every(Number.isSafeInteger) || file.N > 1 << 20) throw new SyncProblem('The sync folder was made by a newer Ironleaf. Update Ironleaf on this PC.');
    const master = await scrypt(pass, Buffer.from(file.salt, 'base64'), { N: file.N, r: file.r, p: file.p, maxmem: 256 * 1024 * 1024 });
    const keys = deriveKeys(master);
    try {
      if (open(keys.seal, Buffer.from(file.check, 'base64'), 'check').toString() !== CHECK) throw new Error('check');
    } catch {
      throw new WrongPassphrase();
    }
    this.keyCache = { folder, pass, keys, vault: file.vault };
    return this.keyCache;
  }

  private async readManifest(keys: Keys): Promise<Manifest> {
    const sealed = await fsp.readFile(path.join(this.dir(), MANIFEST)).catch(() => null);
    if (!sealed) return { version: 1, updated: 0, by: '', files: {} };
    let m: Manifest;
    try {
      m = JSON.parse(open(keys.seal, sealed, 'manifest').toString('utf8')) as Manifest;
    } catch {
      throw new SyncProblem('The sync folder’s list of files couldn’t be opened (it may still be arriving from another PC). Ironleaf tries again next time.');
    }
    if (!m || typeof m.files !== 'object') throw new SyncProblem('The sync folder’s list of files is damaged.');
    return m;
  }

  private async loadBase(vault: string): Promise<Base> {
    const dir = this.d.stateDir();
    if (!dir) return { vault, agreed: {}, seen: {} };
    try {
      const b = JSON.parse(await fsp.readFile(path.join(dir, 'sync-base.json'), 'utf8')) as Base;
      // Another sync folder (or the same one made again): nothing is taken as agreed.
      if (b.vault !== vault) return { vault, agreed: {}, seen: b.seen ?? {} };
      return { vault, agreed: b.agreed ?? {}, seen: b.seen ?? {} };
    } catch {
      return { vault, agreed: {}, seen: {} };
    }
  }

  private async saveBase(b: Base): Promise<void> {
    const dir = this.d.stateDir();
    if (!dir) return;
    await fsp.mkdir(dir, { recursive: true });
    await writeAtomic(path.join(dir, 'sync-base.json'), Buffer.from(JSON.stringify(b)));
  }

  private async lock(): Promise<void> {
    const file = path.join(this.dir(), LOCK);
    const held = await fsp.readFile(file, 'utf8').then((t) => JSON.parse(t) as { device: string; name: string; at: number }).catch(() => null);
    if (held && held.device !== this.d.device.id && this.now() - held.at < LOCK_STALE_MS) throw new SyncProblem(`${held.name || 'Another PC'} is syncing with this folder right now. Ironleaf tries again in a few minutes.`);
    await writeAtomic(file, Buffer.from(JSON.stringify({ device: this.d.device.id, name: this.d.device.name, at: this.now() })));
  }

  private async unlock(): Promise<void> {
    const file = path.join(this.dir(), LOCK);
    const held = await fsp.readFile(file, 'utf8').then((t) => JSON.parse(t) as { device: string }).catch(() => null);
    if (held?.device === this.d.device.id) await fsp.rm(file, { force: true });
  }

  private blobPath(id: string): string {
    return path.join(this.dir(), BLOBS, id.slice(0, 2), `${id}.nvblob`);
  }

  /** Syncs both ways now: "Sync now", and each scheduled run. */
  sync(): Promise<SyncResult> {
    const run = this.queue.then(() => this.syncNow());
    this.queue = run.catch(() => {});
    return run;
  }

  private async syncNow(): Promise<SyncResult> {
    this.busy = true;
    this.lastRun = this.now();
    this.d.changed?.();
    let locked = false;
    try {
      const root = this.d.root();
      if (!root) throw new SyncProblem('Open your notes first.');
      const folder = this.d.prefs().folder;
      const syncDir = this.dir(folder);
      if (isInside(root, syncDir) || isInside(syncDir, root)) throw new SyncProblem('Choose a folder outside your notes for the encrypted copy.');
      const pass = await this.d.passphrase();
      if (!pass) throw new SyncProblem('Type the passphrase for the sync folder on this PC first.');
      const { keys, vault } = await this.keysFor(folder, pass);
      await this.lock();
      locked = true;
      const result = await this.merge(root, keys, vault);
      const parts = [result.sent && `${result.sent} sent`, result.received && `${result.received} received`, result.removed && `${result.removed} moved to the Bin`, result.conflicts.length && `${result.conflicts.length} ${result.conflicts.length === 1 ? 'conflict copy' : 'conflict copies'} made`].filter(Boolean);
      this.words = parts.length ? `Synced: ${parts.join(', ')}.` : 'Everything was already the same.';
      this.conflicts = result.conflicts.length;
      this.error = '';
      this.lastOk = this.now();
      return result;
    } catch (err) {
      this.error = err instanceof SyncProblem ? err.message : `The sync didn’t finish: ${err instanceof Error ? err.message : String(err)}`;
      throw err instanceof SyncProblem ? err : new SyncProblem(this.error);
    } finally {
      if (locked) await this.unlock().catch(() => {});
      this.busy = false;
      this.d.changed?.();
    }
  }

  private async merge(root: string, keys: Keys, vault: string): Promise<SyncResult> {
    const base = await this.loadBase(vault);
    const remote = await this.readManifest(keys);
    const local = await localFiles(root);
    const now = this.now();
    // This PC's fingerprints: read again only when a file's size or time changed.
    const L = new Map<string, string>();
    const seen: Base['seen'] = {};
    for (const [rel, f] of local) {
      const s = base.seen[rel];
      const sha = s && s.size === f.size && s.mtime === f.mtime ? s.sha : sha256(await fsp.readFile(f.abs));
      L.set(rel, sha);
      seen[rel] = { size: f.size, mtime: f.mtime, sha };
    }
    const R = remote.files;
    const next: Manifest = { version: 1, updated: now, by: this.d.device.name, files: { ...R } };
    const agreed: Record<string, string> = {};
    const result: SyncResult = { sent: 0, received: 0, removed: 0, conflicts: [] };
    const wrote: string[] = [];

    const send = async (rel: string, sha: string) => {
      const f = local.get(rel)!;
      const bytes = await fsp.readFile(f.abs);
      // Changed since it was fingerprinted: sent next time.
      if (sha256(bytes) !== sha) return false;
      const id = blobId(keys, rel, sha);
      const target = this.blobPath(id);
      if (!(await fsp.stat(target).catch(() => null))) {
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await writeAtomic(target, seal(keys.seal, bytes, id));
      }
      next.files[rel] = { sha, size: bytes.length, at: f.mtime, by: this.d.device.name };
      result.sent++;
      return true;
    };
    const fetch = async (rel: string, entry: ManifestEntry): Promise<Buffer | null> => {
      const id = blobId(keys, rel, entry.sha);
      const sealed = await fsp.readFile(this.blobPath(id)).catch(() => null);
      // Not arrived yet (a cloud folder still downloading it): next time.
      if (!sealed) return null;
      const bytes = open(keys.seal, sealed, id);
      if (sha256(bytes) !== entry.sha) throw new SyncProblem('A file in the sync folder doesn’t match its list. Ironleaf tries again next time.');
      return bytes;
    };
    const receive = async (rel: string, entry: ManifestEntry, as = rel) => {
      const bytes = await fetch(rel, entry);
      if (!bytes) return false;
      const abs = path.join(root, ...as.split('/'));
      if (!isInside(root, abs)) return false;
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await writeAtomic(abs, bytes);
      const info = await fsp.stat(abs);
      seen[as] = { size: info.size, mtime: Math.round(info.mtimeMs), sha: entry.sha };
      wrote.push(as);
      result.received++;
      return true;
    };

    const paths = new Set([...L.keys(), ...Object.keys(R), ...Object.keys(base.agreed)]);
    for (const rel of [...paths].sort()) {
      if (!safeRel(rel)) continue;
      const l = L.get(rel);
      const r = R[rel]?.sha;
      const b = base.agreed[rel];
      if (l === r) {
        if (l) agreed[rel] = l;
      } else if (l === b) {
        // Only the other side changed it.
        if (r === undefined) {
          await this.d.trash(local.get(rel)!.abs);
          delete seen[rel];
          wrote.push(rel);
          result.removed++;
        } else if (await receive(rel, R[rel])) agreed[rel] = r;
        else if (b) agreed[rel] = b;
      } else if (r === b) {
        // Only this PC changed it.
        if (l === undefined) {
          delete next.files[rel];
          result.sent++;
        } else if (await send(rel, l)) agreed[rel] = l;
        else if (b) agreed[rel] = b;
      } else if (l === undefined) {
        // Deleted here, changed there: it comes back.
        if (await receive(rel, R[rel])) agreed[rel] = r!;
      } else if (r === undefined) {
        // Deleted there, changed here: it stays, and goes back.
        if (await send(rel, l)) agreed[rel] = l;
      } else {
        // Changed on both: this PC's stays, the other's is kept beside it.
        const copy = conflictName(rel, R[rel].at || now, R[rel].by || 'another PC');
        let kept = L.has(copy);
        if (!kept && (await receive(rel, R[rel], copy))) {
          kept = true;
          result.received--;
          result.conflicts.push(copy);
          local.set(copy, { abs: path.join(root, ...copy.split('/')), size: R[rel].size, mtime: seen[copy].mtime });
          L.set(copy, R[rel].sha);
          if (await send(copy, R[rel].sha)) {
            result.sent--;
            agreed[copy] = R[rel].sha;
          }
        }
        // The other PC's version not arrived yet: nothing changes until it has.
        if (kept && (await send(rel, l))) agreed[rel] = l;
      }
    }
    await writeAtomic(path.join(this.dir(), MANIFEST), seal(keys.seal, Buffer.from(JSON.stringify(next)), 'manifest'));
    await this.saveBase({ vault, agreed, seen });
    await this.tidy(keys, next);
    this.files = Object.keys(next.files).length;
    if (wrote.length) this.d.wrote?.(wrote);
    return result;
  }

  /** Sealed files no list names any more (old versions), once they're old enough that no other PC is still writing. */
  private async tidy(keys: Keys, m: Manifest): Promise<void> {
    const wanted = new Set(Object.entries(m.files).map(([rel, e]) => blobId(keys, rel, e.sha)));
    const top = path.join(this.dir(), BLOBS);
    for (const sub of await fsp.readdir(top).catch(() => [] as string[])) {
      for (const name of await fsp.readdir(path.join(top, sub)).catch(() => [] as string[])) {
        const id = name.replace(/\.nvblob$/, '');
        if (wanted.has(id)) continue;
        const abs = path.join(top, sub, name);
        const info = await fsp.stat(abs).catch(() => null);
        if (info && this.now() - info.mtimeMs > ORPHAN_MS) await fsp.rm(abs, { force: true });
      }
    }
  }
}

const safeRel = (rel: string) => !!rel && !rel.startsWith('/') && !rel.split('/').some((s) => s === '..' || s === '' || s === '.') && !/[\u0000-\u001f]/.test(rel) && !/^[A-Za-z]:/.test(rel);

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function writeAtomic(file: string, bytes: Buffer): Promise<void> {
  const temp = `${file}.${randomBytes(6).toString('hex')}.nvtmp`;
  await fsp.writeFile(temp, bytes);
  await fsp.rename(temp, file);
}
