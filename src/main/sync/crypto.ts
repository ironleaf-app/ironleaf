// Ironleaf Sync's keys and sealing (docs/SYNC.md § Keys). Node's built-in crypto only: AES-256-GCM with a random 96-bit
// nonce per sealed item, HKDF-SHA256 for the subkeys, scrypt for the passphrase. No Electron here, so tests drive it.

import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
const VERSION = 0x01;
/** One sealed item's overhead: version byte, nonce, tag. */
export const SEAL_OVERHEAD = 1 + NONCE_BYTES + TAG_BYTES;
export const SCRYPT_STRONG = { N: 1 << 17, r: 8, p: 1 };
export const MIN_PASSPHRASE = 10;

export class SyncCryptoError extends Error {}
/** The passphrase (or recovery key) does not open the envelope. */
export class WrongKey extends SyncCryptoError {
  constructor() {
    super('That passphrase doesn’t open this sync vault.');
  }
}
/** A sealed item was changed, truncated or put in the wrong place. */
export class Tampered extends SyncCryptoError {
  constructor(what = 'item') {
    super(`A synced ${what} failed its integrity check.`);
  }
}

/** AES-256-GCM: `0x01 | nonce | ciphertext | tag`, `aad` bound in. `nonce` only to reseal identical bytes (resume). */
export function seal(key: Buffer, plain: Uint8Array, aad: string, nonce: Buffer = randomBytes(NONCE_BYTES)): Buffer {
  if (key.length !== KEY_BYTES || nonce.length !== NONCE_BYTES) throw new SyncCryptoError('Bad key or nonce length.');
  const c = createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from([VERSION]), nonce, body, c.getAuthTag()]);
}

export function open(key: Buffer, sealed: Uint8Array, aad: string, what = 'item'): Buffer {
  const b = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  if (b.length < SEAL_OVERHEAD || b[0] !== VERSION) throw new Tampered(what);
  try {
    const d = createDecipheriv('aes-256-gcm', key, b.subarray(1, 1 + NONCE_BYTES));
    d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(b.subarray(b.length - TAG_BYTES));
    return Buffer.concat([d.update(b.subarray(1 + NONCE_BYTES, b.length - TAG_BYTES)), d.final()]);
  } catch {
    throw new Tampered(what);
  }
}

export const sha256hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export const hkdf = (ikm: Buffer, salt: Buffer | string, info: string): Buffer => Buffer.from(hkdfSync('sha256', ikm, salt, info, KEY_BYTES));

/** The subkeys of a vault key. A team vault's keys rotate (team-keys.ts); its slots stay those of its first key
 *  (`slotRoot`), so the change log and the server's compare-and-swap carry on across a rotation. */
export class VaultKeys {
  readonly meta: Buffer;
  private readonly slotKey: Buffer;
  constructor(
    readonly vaultKey: Buffer,
    readonly vaultId: string,
    slotRoot: Buffer = vaultKey,
  ) {
    if (vaultKey.length !== KEY_BYTES || slotRoot.length !== KEY_BYTES) throw new SyncCryptoError('A vault key is 32 bytes.');
    this.meta = hkdf(vaultKey, '', 'ironleaf-sync/meta/v1');
    this.slotKey = hkdf(slotRoot, '', 'ironleaf-sync/slot/v1');
  }

  /** A path's server-visible id: a keyed hash of its lower-cased NFC form (one slot per name, whatever its case). */
  slot(rel: string): string {
    return createHmac('sha256', this.slotKey).update(rel.normalize('NFC').toLowerCase()).digest('hex');
  }

  fileKey(fileId: string): Buffer {
    return hkdf(this.vaultKey, Buffer.from(fileId, 'utf8'), 'ironleaf-sync/file/v1');
  }

  sealMeta(slot: string, meta: unknown): string {
    return seal(this.meta, Buffer.from(JSON.stringify(meta), 'utf8'), `ironleaf-sync/meta/v1|${this.vaultId}|${slot}`).toString('base64');
  }

  openMeta<T>(slot: string, sealed: string): T {
    return JSON.parse(open(this.meta, Buffer.from(sealed, 'base64'), `ironleaf-sync/meta/v1|${this.vaultId}|${slot}`, 'change').toString('utf8')) as T;
  }

  sealChunk(fileKey: Buffer, fileId: string, index: number, plain: Uint8Array, nonce?: Buffer): Buffer {
    return seal(fileKey, plain, `ironleaf-sync/chunk/v1|${fileId}|${index}`, nonce);
  }

  openChunk(fileKey: Buffer, fileId: string, index: number, sealed: Uint8Array): Buffer {
    return open(fileKey, sealed, `ironleaf-sync/chunk/v1|${fileId}|${index}`, 'file');
  }

  sealDeviceName(deviceId: string, name: string): string {
    return seal(this.meta, Buffer.from(name, 'utf8'), `ironleaf-sync/device/v1|${this.vaultId}|${deviceId}`).toString('base64');
  }

  openDeviceName(deviceId: string, sealed: string): string {
    try {
      return open(this.meta, Buffer.from(sealed, 'base64'), `ironleaf-sync/device/v1|${this.vaultId}|${deviceId}`, 'device name').toString('utf8');
    } catch {
      return 'Unknown PC';
    }
  }
}

// ---- The key envelope -------------------------------------------------------------------------------------------

export interface Envelope {
  v: 1;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string };
  pass: string;
  recovery: string;
}

const scrypt = (pass: string, salt: Buffer, o: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pass.normalize('NFC'), salt, KEY_BYTES, { ...o, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );

const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A recovery key's 32 bytes as 52 characters of an unambiguous alphabet (no 0/O, 1/I), in groups of four. */
export function recoveryWords(key: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of key) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

export function parseRecovery(words: string): Buffer {
  const clean = words.toUpperCase().replace(/[\s-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new WrongKey();
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length !== KEY_BYTES) throw new WrongKey();
  return Buffer.from(out);
}

const recoveryKek = (rk: Buffer) => hkdf(rk, '', 'ironleaf-sync/recovery/v1');

/** A new vault: its key, the envelope that keeps it, and the recovery key's words (shown once). */
export async function createEnvelope(passphrase: string, o = SCRYPT_STRONG): Promise<{ vaultKey: Buffer; envelope: Envelope; recovery: string }> {
  if (passphrase.normalize('NFC').length < MIN_PASSPHRASE) throw new SyncCryptoError(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  const vaultKey = randomBytes(KEY_BYTES);
  const rk = randomBytes(KEY_BYTES);
  const envelope = await wrapEnvelope(vaultKey, passphrase, rk, o);
  return { vaultKey, envelope, recovery: recoveryWords(rk) };
}

async function wrapEnvelope(vaultKey: Buffer, passphrase: string, rk: Buffer | null, o: { N: number; r: number; p: number }, keepRecovery?: string): Promise<Envelope> {
  const salt = randomBytes(16);
  const pk = await scrypt(passphrase, salt, o);
  return {
    v: 1,
    kdf: { name: 'scrypt', N: o.N, r: o.r, p: o.p, salt: salt.toString('base64') },
    pass: seal(pk, vaultKey, 'ironleaf-sync/vault-key/v1|passphrase').toString('base64'),
    recovery: rk ? seal(recoveryKek(rk), vaultKey, 'ironleaf-sync/vault-key/v1|recovery').toString('base64') : keepRecovery!,
  };
}

export function parseEnvelope(raw: string): Envelope {
  let e: Envelope;
  try {
    e = JSON.parse(raw) as Envelope;
  } catch {
    throw new SyncCryptoError('The sync vault’s key envelope is damaged.');
  }
  const k = e?.kdf;
  if (e?.v !== 1 || k?.name !== 'scrypt' || ![k.N, k.r, k.p].every(Number.isSafeInteger) || k.N > 1 << 20 || k.N < 1 << 14 || k.r > 32 || k.p > 16) {
    throw new SyncCryptoError('The sync vault was made by a newer Ironleaf. Update Ironleaf on this PC.');
  }
  return e;
}

export async function openWithPassphrase(e: Envelope, passphrase: string): Promise<Buffer> {
  const pk = await scrypt(passphrase, Buffer.from(e.kdf.salt, 'base64'), e.kdf);
  try {
    return open(pk, Buffer.from(e.pass, 'base64'), 'ironleaf-sync/vault-key/v1|passphrase');
  } catch {
    throw new WrongKey();
  }
}

export function openWithRecovery(e: Envelope, words: string): Buffer {
  try {
    return open(recoveryKek(parseRecovery(words)), Buffer.from(e.recovery, 'base64'), 'ironleaf-sync/vault-key/v1|recovery');
  } catch {
    throw new WrongKey();
  }
}

/** A new passphrase for the same vault key (the recovery wrap kept as it was). */
export function rewrapEnvelope(e: Envelope, vaultKey: Buffer, passphrase: string, o = SCRYPT_STRONG): Promise<Envelope> {
  if (passphrase.normalize('NFC').length < MIN_PASSPHRASE) throw new SyncCryptoError(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  return wrapEnvelope(vaultKey, passphrase, null, o, e.recovery);
}

export const sameBytes = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
