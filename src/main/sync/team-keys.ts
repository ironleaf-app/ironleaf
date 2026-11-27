// SPDX-License-Identifier: AGPL-3.0-or-later
// Ironleaf Teams' keys (docs/SYNC.md § Teams, docs/TEAMS.md): a team vault is an ordinary sync vault whose vault key
// (VK) is wrapped to each member device's X25519 public key instead of a passphrase. Node's built-in crypto only.
//
//   device key pair   X25519, made once per PC, the private half kept by the operating system (safeStorage)
//   wrap              ECDH(ephemeral, device public) → HKDF-SHA256(salt eph‖device, "ironleaf-sync/wrap/v1") → AES-GCM
//                     over VK, bound to `ironleaf-sync/vault-key/v1|member|<vault>|<epoch>|<device>`;
//                     bytes `0x01 | ephemeral public 32 | sealed VK`, base64
//   team envelope     `{v:1, kind:'team', epoch, name, history:[{epoch, key}]}`: the vault's name sealed with the
//                     current meta key, and every earlier VK sealed with the current one (a member who joins after a
//                     rotation can still open what was written before it)
//   rotation          a new VK at epoch+1 after a member leaves: new changes are sealed with it, older ones still open
//                     with the earlier keys (TeamKeyRing tries the current key first). Slots stay keyed by the first
//                     VK so the change log carries on; a former member could test whether a path they guess exists,
//                     never read what is new.

import { createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { hkdf, KEY_BYTES, open, seal, SyncCryptoError, Tampered, VaultKeys } from './crypto';

const X25519_SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const WRAP_VERSION = 0x01;

export interface DeviceKeyPair {
  verified?: string[];
  /** Raw 32-byte public key, base64 (what the cloud keeps beside the device). */
  publicKey: string;
  /** PKCS#8 DER of the private key (kept sealed by the operating system, never sent). */
  privateKey: Buffer;
}

export function makeDeviceKeyPair(): DeviceKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return { publicKey: rawPublic(publicKey).toString('base64'), privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer };
}

const rawPublic = (k: KeyObject): Buffer => (k.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32);
const publicFromRaw = (raw: Buffer): KeyObject => {
  if (raw.length !== 32) throw new SyncCryptoError('A device public key is 32 bytes.');
  return createPublicKey({ key: Buffer.concat([X25519_SPKI, raw]), format: 'der', type: 'spki' });
};
export const isPublicKey = (b64: unknown): b64 is string => typeof b64 === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(b64);

const wrapAad = (vaultId: string, epoch: number, deviceId: string) => `ironleaf-sync/vault-key/v1|member|${vaultId}|${epoch}|${deviceId}`;
const kekOf = (shared: Buffer, eph: Buffer, recipient: Buffer) => hkdf(shared, Buffer.concat([eph, recipient]), 'ironleaf-sync/wrap/v1');

/** VK wrapped to one member device's public key. */
export function wrapVaultKey(vk: Buffer, to: { device: string; publicKey: string }, vaultId: string, epoch: number): string {
  if (vk.length !== KEY_BYTES) throw new SyncCryptoError('A vault key is 32 bytes.');
  const recipient = Buffer.from(to.publicKey, 'base64');
  const eph = generateKeyPairSync('x25519');
  const ephRaw = rawPublic(eph.publicKey);
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: publicFromRaw(recipient) });
  const sealed = seal(kekOf(shared, ephRaw, recipient), vk, wrapAad(vaultId, epoch, to.device));
  return Buffer.concat([Buffer.from([WRAP_VERSION]), ephRaw, sealed]).toString('base64');
}

/** VK back from this device's wrap. Throws Tampered when it is not for this device, vault and epoch. */
export function unwrapVaultKey(wrap: string, me: { device: string; keys: DeviceKeyPair }, vaultId: string, epoch: number): Buffer {
  const b = Buffer.from(wrap, 'base64');
  if (b.length < 1 + 32 + 29 || b[0] !== WRAP_VERSION) throw new Tampered('key');
  const ephRaw = b.subarray(1, 33);
  const priv = createPrivateKey({ key: me.keys.privateKey, format: 'der', type: 'pkcs8' });
  const shared = diffieHellman({ privateKey: priv, publicKey: publicFromRaw(ephRaw) });
  const vk = open(kekOf(shared, ephRaw, Buffer.from(me.keys.publicKey, 'base64')), b.subarray(33), wrapAad(vaultId, epoch, me.device), 'key');
  if (vk.length !== KEY_BYTES) throw new Tampered('key');
  return vk;
}

// ---- The key ring and the team envelope ------------------------------------------------------------------------

/** What a PC keeps for a team vault (sealed by the OS): every epoch's key it knows. */
export interface Ring {
  v: 1;
  epoch: number;
  /** epoch → VK, base64. */
  keys: Record<string, string>;
}

export interface TeamEnvelope {
  v: 1;
  kind: 'team';
  epoch: number;
  /** The vault's name, sealed with the current epoch's meta key. */
  name: string;
  /** Every earlier epoch's VK, sealed with the current VK. */
  history: { epoch: number; key: string }[];
}

const nameAad = (vaultId: string, epoch: number) => `ironleaf-sync/vault-name/v1|${vaultId}|${epoch}`;
const historyAad = (vaultId: string, epoch: number) => `ironleaf-sync/vault-key/v1|history|${vaultId}|${epoch}`;

export function ringKey(ring: Ring, epoch = ring.epoch): Buffer {
  const k = ring.keys[String(epoch)];
  if (!k) throw new SyncCryptoError(`This PC doesn’t have the team vault’s key for epoch ${epoch}.`);
  return Buffer.from(k, 'base64');
}

/** A new team vault's first key, ring and envelope. */
export function newTeamVault(vaultId: string, name: string): { ring: Ring; envelope: TeamEnvelope } {
  const vk = randomBytes(KEY_BYTES);
  const ring: Ring = { v: 1, epoch: 1, keys: { '1': vk.toString('base64') } };
  return { ring, envelope: teamEnvelope(ring, vaultId, name) };
}

/** The envelope for the ring's current epoch: the name sealed with it, the earlier keys sealed under it. */
export function teamEnvelope(ring: Ring, vaultId: string, name: string): TeamEnvelope {
  const vk = ringKey(ring);
  const meta = new VaultKeys(vk, vaultId).meta;
  const history = Object.keys(ring.keys)
    .map(Number)
    .filter((e) => e < ring.epoch)
    .sort((a, b) => a - b)
    .map((e) => ({ epoch: e, key: seal(vk, ringKey(ring, e), historyAad(vaultId, e)).toString('base64') }));
  return { v: 1, kind: 'team', epoch: ring.epoch, name: seal(meta, Buffer.from(name.slice(0, 200), 'utf8'), nameAad(vaultId, ring.epoch)).toString('base64'), history };
}

export function parseTeamEnvelope(raw: string): TeamEnvelope {
  let e: TeamEnvelope;
  try {
    e = JSON.parse(raw) as TeamEnvelope;
  } catch {
    throw new SyncCryptoError('The team vault’s key envelope is damaged.');
  }
  if (e?.v !== 1 || e.kind !== 'team' || !Number.isSafeInteger(e.epoch) || e.epoch < 1 || typeof e.name !== 'string' || !Array.isArray(e.history)) {
    throw new SyncCryptoError('The team vault was made by a newer Ironleaf. Update Ironleaf on this PC.');
  }
  return e;
}

/** The ring from the current key (just unwrapped) and the envelope's history. */
export function ringFrom(env: TeamEnvelope, vaultId: string, current: Buffer): Ring {
  const keys: Record<string, string> = { [String(env.epoch)]: current.toString('base64') };
  for (const h of env.history) {
    if (!Number.isSafeInteger(h.epoch) || h.epoch >= env.epoch || h.epoch < 1) throw new Tampered('key');
    keys[String(h.epoch)] = open(current, Buffer.from(h.key, 'base64'), historyAad(vaultId, h.epoch), 'key').toString('base64');
  }
  return { v: 1, epoch: env.epoch, keys };
}

export function openTeamName(env: TeamEnvelope, vaultId: string, ring: Ring): string {
  try {
    return open(new VaultKeys(ringKey(ring, env.epoch), vaultId).meta, Buffer.from(env.name, 'base64'), nameAad(vaultId, env.epoch), 'name').toString('utf8');
  } catch {
    return 'Team vault';
  }
}

/** The next epoch's ring: a fresh key on top of every one kept. */
export function rotateRing(ring: Ring): Ring {
  const epoch = ring.epoch + 1;
  return { v: 1, epoch, keys: { ...ring.keys, [String(epoch)]: randomBytes(KEY_BYTES).toString('base64') } };
}

export function parseRing(raw: string): Ring {
  const r = JSON.parse(raw) as Ring;
  if (r?.v !== 1 || !Number.isSafeInteger(r.epoch) || !r.keys || !r.keys[String(r.epoch)] || !r.keys['1']) throw new SyncCryptoError('This PC’s team vault keys are damaged.');
  return r;
}

/** The engine's keys for a team vault: seals with the current epoch, opens with any epoch it knows (newest first),
 *  slots from the first key. */
export class TeamKeyRing extends VaultKeys {
  private readonly older: VaultKeys[];
  constructor(
    readonly ring: Ring,
    vaultId: string,
  ) {
    const first = ringKey(ring, 1);
    super(ringKey(ring), vaultId, first);
    this.older = Object.keys(ring.keys)
      .map(Number)
      .filter((e) => e < ring.epoch)
      .sort((a, b) => b - a)
      .map((e) => new VaultKeys(ringKey(ring, e), vaultId, first));
  }

  get epoch(): number {
    return this.ring.epoch;
  }

  override openMeta<T>(slot: string, sealed: string): T {
    try {
      return super.openMeta<T>(slot, sealed);
    } catch (err) {
      for (const k of this.older) {
        try {
          return k.openMeta<T>(slot, sealed);
        } catch {}
      }
      throw err;
    }
  }

  override openChunk(fileKey: Buffer, fileId: string, index: number, sealed: Uint8Array): Buffer {
    try {
      return super.openChunk(fileKey, fileId, index, sealed);
    } catch (err) {
      for (const k of this.older) {
        try {
          return k.openChunk(k.fileKey(fileId), fileId, index, sealed);
        } catch {}
      }
      throw err;
    }
  }

  override openDeviceName(deviceId: string, sealed: string): string {
    const name = super.openDeviceName(deviceId, sealed);
    if (name !== 'Unknown PC') return name;
    for (const k of this.older) {
      const n = k.openDeviceName(deviceId, sealed);
      if (n !== 'Unknown PC') return n;
    }
    return name;
  }
}
