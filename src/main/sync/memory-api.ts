// An in-memory Ironleaf Sync server with the real one's rules (compare-and-swap per slot, blobs checked by hash and
// required before a change refers to them, quota, long poll), for the engine's checks. Never used by the app itself.

import { createHash } from 'node:crypto';
import { SyncHttpError, type ChangeIn, type ChangeOut, type ChangeResult, type DeviceRow, type SyncApi, type VaultInfo } from './protocol';

interface MemVault {
  id: string;
  envelope: string;
  created: number;
  log: ChangeOut[];
  heads: Map<string, number>;
  blobs: Map<string, Uint8Array>;
  devices: Map<string, DeviceRow>;
}

export class MemoryServer {
  vaults = new Map<string, MemVault>();
  quota = 10 * 1024 ** 3;
  maxDevices = 10;
  /** Fails the next N blob uploads (an interrupted upload). */
  failPuts = 0;
  puts = 0;
  private waiters = new Set<() => void>();
  private n = 0;

  bytes(v: MemVault): number {
    let b = 0;
    for (const x of v.blobs.values()) b += x.length;
    return b;
  }

  private get(id: string): MemVault {
    const v = this.vaults.get(id);
    if (!v) throw new SyncHttpError(404, 'not-found');
    return v;
  }

  /** One client's view (each device its own `SyncApi`). */
  api(): SyncApi {
    const s = this;
    return {
      async listVaults() {
        return [...s.vaults.values()].map((v) => ({ id: v.id, created: v.created, head: v.log.length }));
      },
      async createVault(envelope) {
        const id = `v${++s.n}`;
        s.vaults.set(id, { id, envelope, created: Date.now(), log: [], heads: new Map(), blobs: new Map(), devices: new Map() });
        return { id };
      },
      async vault(id): Promise<VaultInfo> {
        const v = s.get(id);
        return { id, envelope: v.envelope, head: v.log.length, usage: { bytes: s.bytes(v), quota: s.quota, devices: v.devices.size, maxDevices: s.maxDevices } };
      },
      async putEnvelope(id, envelope) {
        s.get(id).envelope = envelope;
      },
      async addDevice(id, device, name) {
        const v = s.get(id);
        if (!v.devices.has(device) && v.devices.size >= s.maxDevices) throw new SyncHttpError(403, 'device-limit');
        v.devices.set(device, { device, name, cursor: v.devices.get(device)?.cursor ?? 0, lastSeen: Date.now() });
      },
      async devices(id) {
        return [...s.get(id).devices.values()];
      },
      async removeDevice(id, device) {
        s.get(id).devices.delete(device);
      },
      async missing(id, hashes) {
        const v = s.get(id);
        return hashes.filter((h) => !v.blobs.has(h));
      },
      async putBlob(id, hash, bytes) {
        const v = s.get(id);
        if (s.failPuts > 0) {
          s.failPuts--;
          throw new SyncHttpError(503, 'unavailable');
        }
        if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new SyncHttpError(400, 'hash-mismatch');
        if (!v.blobs.has(hash) && s.bytes(v) + bytes.length > s.quota) throw new SyncHttpError(413, 'quota');
        s.puts++;
        v.blobs.set(hash, Uint8Array.from(bytes));
      },
      async getBlob(id, hash) {
        const b = s.get(id).blobs.get(hash);
        if (!b) throw new SyncHttpError(404, 'not-found');
        return Uint8Array.from(b);
      },
      async postChanges(id, device, changes: ChangeIn[]): Promise<ChangeResult[]> {
        const v = s.get(id);
        const out = changes.map((c): ChangeResult => {
          const head = v.heads.get(c.slot) ?? 0;
          if (c.base !== head) return { ok: false, conflict: true, head };
          const missing = c.blobs.filter((h) => !v.blobs.has(h));
          if (missing.length) return { ok: false, missing };
          const seq = v.log.length + 1;
          v.log.push({ ...c, seq, device, at: Date.now() });
          v.heads.set(c.slot, seq);
          return { ok: true, seq };
        });
        for (const w of [...s.waiters]) w();
        return out;
      },
      async changes(id, since, opts = {}) {
        const v = s.get(id);
        const dev = opts.device ? v.devices.get(opts.device) : undefined;
        if (dev) {
          dev.cursor = Math.max(dev.cursor, since);
          dev.lastSeen = Date.now();
        }
        const take = () => v.log.filter((c) => c.seq > since).slice(0, opts.limit ?? 500);
        let got = take();
        if (!got.length && opts.wait) {
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(t);
              s.waiters.delete(done);
              resolve();
            };
            const t = setTimeout(done, opts.wait! * 1000);
            s.waiters.add(done);
            opts.signal?.addEventListener('abort', done, { once: true });
          });
          got = take();
        }
        return { changes: got.map((c) => ({ ...c })), head: v.log.length };
      },
    };
  }
}
