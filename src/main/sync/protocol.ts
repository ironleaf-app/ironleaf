// Ironleaf Sync's wire shapes and the server's API as the engine uses it (docs/SYNC.md § Objects and protocol). The
// engine talks to `SyncApi`; `HttpSyncApi` is the real one (fetch, bearer token from the account), tests use an
// in-memory server with the same behaviour. No Electron here.

export const CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

/** What one change carries, as the server stores it (all opaque but the numbers). */
export interface ChangeIn {
  slot: string;
  /** The slot's latest seq this PC knew (0: a new path). */
  base: number;
  meta: string;
  blobs: string[];
  size: number;
  deleted: boolean;
}

export interface ChangeOut extends ChangeIn {
  seq: number;
  device: string;
  at: number;
}

export type ChangeResult = { ok: true; seq: number } | { ok: false; conflict: true; head: number } | { ok: false; missing: string[] };

/** The metadata sealed in each change. */
export interface FileMeta {
  v: 1;
  id: string;
  path: string;
  deleted?: false;
  sha: string;
  size: number;
  mtime: number;
  chunks: { h: string; n: number }[];
  by: string;
}
export interface DeleteMeta {
  v: 1;
  id: string;
  path: string;
  deleted: true;
  /** Set when the delete is half of a rename. */
  to?: string;
  by: string;
}
export type Meta = FileMeta | DeleteMeta;

export interface VaultInfo {
  id: string;
  envelope: string;
  head: number;
  usage: { bytes: number; quota: number; devices: number; maxDevices: number };
}

export interface DeviceRow {
  device: string;
  name: string;
  cursor: number;
  lastSeen: number;
}

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? `Sync server said ${status} ${code}`);
  }
}

export interface SyncApi {
  listVaults(): Promise<{ id: string; created: number; head: number }[]>;
  createVault(envelope: string): Promise<{ id: string }>;
  vault(id: string): Promise<VaultInfo>;
  putEnvelope(id: string, envelope: string): Promise<void>;
  addDevice(id: string, device: string, name: string): Promise<void>;
  devices(id: string): Promise<DeviceRow[]>;
  removeDevice(id: string, device: string): Promise<void>;
  missing(id: string, hashes: string[]): Promise<string[]>;
  putBlob(id: string, hash: string, bytes: Uint8Array): Promise<void>;
  getBlob(id: string, hash: string): Promise<Uint8Array>;
  postChanges(id: string, device: string, changes: ChangeIn[]): Promise<ChangeResult[]>;
  changes(id: string, since: number, opts?: { limit?: number; wait?: number; device?: string; signal?: AbortSignal }): Promise<{ changes: ChangeOut[]; head: number }>;
}

/** The real server: `<base>/sync/...` with the account's bearer token. */
export class HttpSyncApi implements SyncApi {
  constructor(
    /** The API base, or a function giving it (the account's cloud can change while Ironleaf runs, by policy). */
    private readonly base: string | (() => string),
    private readonly token: () => Promise<string | null>,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async call(method: string, path: string, body?: unknown, opts: { raw?: boolean; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Response> {
    const token = await this.token();
    if (!token) throw new SyncHttpError(401, 'signed-out', 'Sign in to your Ironleaf account to sync.');
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    let payload: BodyInit | undefined;
    if (body instanceof Uint8Array) {
      headers['content-type'] = 'application/octet-stream';
      payload = body as unknown as BodyInit;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? 60_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const base = typeof this.base === 'function' ? this.base() : this.base;
    const res = await this.fetchFn(`${base.replace(/\/$/, '')}${path}`, { method, headers, ...(payload !== undefined ? { body: payload } : {}), signal });
    if (!res.ok) {
      let code = 'error';
      try {
        const j = (await res.json()) as { error?: string };
        if (typeof j?.error === 'string') code = j.error;
      } catch {
        // Not JSON.
      }
      throw new SyncHttpError(res.status, code);
    }
    return res;
  }

  private async json<T>(method: string, path: string, body?: unknown, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<T> {
    const res = await this.call(method, path, body, opts);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  async listVaults() {
    return (await this.json<{ vaults: { id: string; created: number; head: number }[] }>('GET', '/sync/vaults')).vaults;
  }
  createVault(envelope: string) {
    return this.json<{ id: string }>('POST', '/sync/vaults', { envelope });
  }
  vault(id: string) {
    return this.json<VaultInfo>('GET', `/sync/${enc(id)}`);
  }
  async putEnvelope(id: string, envelope: string) {
    await this.json('PUT', `/sync/${enc(id)}/envelope`, { envelope });
  }
  async addDevice(id: string, device: string, name: string) {
    await this.json('POST', `/sync/${enc(id)}/devices`, { device, name });
  }
  async devices(id: string) {
    return (await this.json<{ devices: DeviceRow[] }>('GET', `/sync/${enc(id)}/devices`)).devices;
  }
  async removeDevice(id: string, device: string) {
    await this.json('DELETE', `/sync/${enc(id)}/devices/${enc(device)}`);
  }
  async missing(id: string, hashes: string[]) {
    return (await this.json<{ missing: string[] }>('POST', `/sync/${enc(id)}/blobs/missing`, { hashes })).missing;
  }
  async putBlob(id: string, hash: string, bytes: Uint8Array) {
    await this.call('PUT', `/sync/${enc(id)}/blobs/${enc(hash)}`, bytes, { timeoutMs: 300_000 });
  }
  async getBlob(id: string, hash: string) {
    const res = await this.call('GET', `/sync/${enc(id)}/blobs/${enc(hash)}`, undefined, { timeoutMs: 300_000 });
    return new Uint8Array(await res.arrayBuffer());
  }
  async postChanges(id: string, device: string, changes: ChangeIn[]) {
    return (await this.json<{ results: ChangeResult[] }>('POST', `/sync/${enc(id)}/changes`, { device, changes })).results;
  }
  changes(id: string, since: number, opts: { limit?: number; wait?: number; device?: string; signal?: AbortSignal } = {}) {
    const q = new URLSearchParams({ since: String(since) });
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.wait) q.set('wait', String(opts.wait));
    if (opts.device) q.set('device', opts.device);
    return this.json<{ changes: ChangeOut[]; head: number }>('GET', `/sync/${enc(id)}/changes?${q}`, undefined, { ...(opts.signal ? { signal: opts.signal } : {}), timeoutMs: ((opts.wait ?? 0) + 30) * 1000 });
  }
}

const enc = encodeURIComponent;
