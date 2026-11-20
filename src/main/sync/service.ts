// Ironleaf Sync in the app (docs/SYNC.md): Settings' IPC (`isync:*`), the vault key kept encrypted by the operating
// system, the engine and its runner for the vault that's open, and the writer that puts remote changes on disk
// through the open Vault (guarded saves for notes, the Bin for deletes, Vault.move for renames). It listens to the
// Vault's own watcher events (no second watcher). Off by default; it needs the account (account.ts) with Sync.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { textVersion } from '../../shared/project-file';
import { docText, mergeDocs, readDoc } from '../../shared/vault-settings';
import { libraryKey } from '../library-state';
import { kindOf, withoutBom, type Vault } from '../vault';
import { onSyncAccountChange, setSyncAccount, syncAccount, devAccount } from './account';
import { createEnvelope, openWithPassphrase, openWithRecovery, parseEnvelope, rewrapEnvelope, sha256hex, VaultKeys, WrongKey } from './crypto';
import { asideIn, FileStateStore, SyncEngine, SyncRunner, type RunnerState } from './engine';
import { FsWriter, hashFile, safeRel, type PlaceResult } from './local';
import { HttpSyncApi, SyncHttpError, type SyncApi } from './protocol';
import { parseRing, TeamKeyRing, type Ring } from './team-keys';
import type { SyncDeviceView, SyncJoin, SyncPhase, SyncView } from './view';

export const DEFAULT_API = 'https://ironleaf.kaitiaki-it.com/api/v1';

interface Prefs {
  on: boolean;
  vaultId: string | null;
  paused: boolean;
  excluded: string[];
  /** A team vault (Settings › Teams): the team it belongs to; its keys are a ring (team-keys.ts), not a passphrase. */
  teamId?: string | null;
}
const DEFAULT_PREFS: Prefs = { on: false, vaultId: null, paused: false, excluded: [], teamId: null };

function cleanPrefs(raw: unknown): Prefs {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<Prefs>;
  return {
    on: p.on === true,
    vaultId: typeof p.vaultId === 'string' && p.vaultId.length <= 64 ? p.vaultId : null,
    paused: p.paused === true,
    excluded: Array.isArray(p.excluded) ? cleanFolders(p.excluded) : [],
    teamId: typeof p.teamId === 'string' && p.teamId.length <= 64 ? p.teamId : null,
  };
}

const cleanFolders = (list: unknown[]): string[] =>
  [...new Set(list.filter((x): x is string => typeof x === 'string').map((x) => x.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter((x) => safeRel(x)))].slice(0, 200);

export interface Protector {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(bytes: Buffer): string;
}

export interface SyncServiceDeps {
  handle(channel: string, fn: (...args: any[]) => unknown): void;
  send(channel: string, payload: unknown): void;
  dataDir: string;
  device: { id: string; name: string };
  protect: Protector;
  /** Deletes when the Vault can't take them (config files): the operating system's bin. */
  osTrash(abs: string): Promise<void>;
  /** Files sync wrote, moved or removed: the index, links, recovery and the window catch up. */
  applied(rels: string[], moves: [string, string][]): void;
  /** Whether this PC may write the vault now (one vault, one writer). */
  mayWrite(): Promise<boolean>;
  apiBase?: string;
  /** A development build's fixed account token (IRONLEAF_SYNC_DEV_TOKEN; never in a packaged app). */
  devToken?: string;
  log?(message: string): void;
  api?(token: () => Promise<string | null>): SyncApi;
}

/** The vault keys, per sync vault, encrypted by the operating system in Ironleaf's data folder. */
class KeyStore {
  private cache: Record<string, string> | null = null;
  constructor(
    private readonly file: string,
    private readonly protect: Protector,
  ) {}
  private async all(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(this.protect.decrypt(await fsp.readFile(this.file))) as Record<string, string>;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }
  /** A vault key (base64) or a team vault's ring ("ring:" + JSON). */
  async getRaw(vaultId: string): Promise<string | null> {
    return (await this.all())[vaultId] ?? null;
  }
  async get(vaultId: string): Promise<Buffer | null> {
    const v = await this.getRaw(vaultId);
    return v && !v.startsWith('ring:') ? Buffer.from(v, 'base64') : null;
  }
  async set(vaultId: string, key: Buffer | null): Promise<void> {
    return this.setRaw(vaultId, key ? key.toString('base64') : null);
  }
  async setRaw(vaultId: string, value: string | null): Promise<void> {
    const all = { ...(await this.all()) };
    if (value) all[vaultId] = value;
    else delete all[vaultId];
    if (!this.protect.available()) throw new Error('This PC can’t protect the sync key, so sync can’t be set up here.');
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, this.protect.encrypt(JSON.stringify(all)));
    await fsp.rename(tmp, this.file);
    this.cache = all;
  }
}

const TEXT = (rel: string) => {
  const k = kindOf(rel);
  return k === 'note' || k === 'canvas' || k === 'view';
};
const dotPath = (rel: string) => rel.split('/').some((s) => s.startsWith('.'));

/** The vault's own config changed on two PCs: its keyed documents (settings, state) merge key by key as the app merges
 *  OneDrive's copies (src/shared/vault-settings.ts); anything else there (the vault's identity) takes the server's
 *  version, this PC's going to the Bin. Notes and files keep the usual conflict copy. */
export async function resolveConfig(rel: string, mine: Buffer, theirs: Buffer): Promise<{ bytes: Buffer } | 'theirs' | null> {
  if (!/^\.(neuralvault|ironleaf)\//.test(rel)) return null;
  if (/\.json$/i.test(rel)) {
    const a = readDoc(mine.toString('utf8'), 'settings');
    const b = readDoc(theirs.toString('utf8'), 'settings');
    if (a && b) return { bytes: Buffer.from(docText(mergeDocs(a, b)), 'utf8') };
  }
  return 'theirs';
}

/** Remote changes on disk through the open Vault: notes, canvases and views by its guarded save (so the index, links
 *  and recovery stay right and an edit made meanwhile is never overwritten), deletes to its Bin, renames by its move.
 *  Attachments and config go through FsWriter's atomic rename after the same check. */
class VaultWriter extends FsWriter {
  constructor(
    private readonly vault: Vault,
    deviceName: string,
    osTrash: (abs: string) => Promise<void>,
    aside: (rel: string, bytes: Buffer) => Promise<void>,
  ) {
    super(vault.root, {
      deviceName,
      trash: async (abs, rel) => {
        // The vault's own config (which its Bin doesn't take): kept aside in Ironleaf's data, then removed.
        if (dotPath(rel)) {
          await aside(rel, await fsp.readFile(abs));
          return fsp.rm(abs, { force: true });
        }
        await vault.trashPath(rel).catch(() => osTrash(abs));
      },
    });
  }

  override async place(rel: string, temp: string, expect: string | null): Promise<PlaceResult> {
    if (dotPath(rel) || !TEXT(rel)) return super.place(rel, temp, expect);
    try {
      const bytes = await fsp.readFile(temp);
      const text = bytes.toString('utf8');
      // Only words that come back byte for byte go through the editor's save (a BOM or odd bytes go as they are).
      if (!Buffer.from(text, 'utf8').equals(bytes) || withoutBom(text) !== text) return await super.place(rel, temp, expect);
      if (expect === null) {
        try {
          await this.vault.createText(rel, text);
          return 'ok';
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'EEXIST') return 'changed';
          throw err;
        }
      }
      const current = await fsp.readFile(this.vault.absolute(rel)).catch(() => null);
      if (!current || sha256hex(current) !== expect) return 'changed';
      const r = await this.vault.writeTextChecked(rel, text, textVersion(withoutBom(current.toString('utf8'))));
      // Edited meanwhile: the Vault kept the server's words as a conflict copy; the round tries again.
      return r.ok ? 'ok' : 'changed';
    } finally {
      await fsp.rm(temp, { force: true }).catch(() => {});
    }
  }

  override async move(from: string, to: string, expect: string): Promise<PlaceResult> {
    if (dotPath(from) || dotPath(to)) return super.move(from, to, expect);
    if ((await hashFile(this.vault.absolute(from))) !== expect || (await this.vault.any(to))) return 'changed';
    await this.vault.move(from, to);
    return 'ok';
  }
}

export interface SyncService {
  /** A vault opened (or none): its sync starts when it is on. */
  opened(vault: Vault | null): Promise<void>;
  stop(): Promise<void>;
  /** Settings › Teams (src/main/teams/): team vaults sync through this same engine and runner. */
  team: TeamSyncBinding;
}

export interface TeamSyncBinding {
  /** The open notes and what they sync with: null with no notes open. */
  current(): { root: string; vaultId: string | null; teamId: string | null; on: boolean } | null;
  /** Starts syncing the open notes with a team vault, with its key ring (kept by the OS like a vault key). */
  begin(vaultId: string, teamId: string, ring: Ring): Promise<void>;
  /** A rotated ring for a team vault this PC keeps: stored, and the runner restarted when it is the open one. */
  rekey(vaultId: string, ring: Ring): Promise<void>;
  /** The ring this PC keeps for a team vault, if any. */
  ring(vaultId: string): Promise<Ring | null>;
  /** Settings › Ironleaf Sync looks again. */
  changed(): void;
}

const words = (err: unknown): string => {
  if (err instanceof WrongKey) return 'That passphrase or recovery key doesn’t open your sync vault.';
  if (err instanceof SyncHttpError) {
    if (err.status === 401) return 'Sign in to your Ironleaf account again.';
    if (err.code === 'entitlement_required') return 'Your account doesn’t include Sync.';
    if (err.code === 'device_limit') return 'Sync is on as many PCs as your plan allows. Remove one first.';
    if (err.code === 'quota') return 'Sync storage is full. Remove large files or exclude a folder.';
    if (err.status >= 500) return 'The sync service isn’t answering. Ironleaf keeps trying.';
  }
  if (err instanceof Error && /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|aborted|timeout/i.test(err.message)) return 'Offline. Changes wait here and go up when you’re back online.';
  return err instanceof Error ? err.message : String(err);
};

export function registerSync(d: SyncServiceDeps): SyncService {
  if (d.devToken) setSyncAccount(devAccount(d.devToken));
  const keys = new KeyStore(path.join(d.dataDir, 'sync-keys.bin'), d.protect);
  const token = () => syncAccount().getAccessToken();
  // An explicit base (a development override) wins; otherwise the account's cloud, which follows the dev fake and policy.
  const apiBase = () => d.apiBase ?? syncAccount().apiBase?.() ?? DEFAULT_API;
  const api: SyncApi = d.api ? d.api(token) : new HttpSyncApi(apiBase, token);
  let vault: Vault | null = null;
  let prefs: Prefs = DEFAULT_PREFS;
  let engine: SyncEngine | null = null;
  let runner: SyncRunner | null = null;
  let phase: RunnerState | 'off' | 'read-only' = 'off';
  let error = '';
  let usage: SyncView['usage'] = null;
  let devices: SyncDeviceView[] = [];
  let existing = false;
  let pushTimer: NodeJS.Timeout | undefined;
  let detach: (() => void) | null = null;
  let devicesName: (id: string, sealed: string) => string = () => 'PC';

  const root = () => vault?.root ?? null;
  // This PC's sync settings and state for each vault, in Ironleaf's own data (never the notes: sync on or off and the
  // folders left out are this PC's choices).
  const stateFile = (r: string) => path.join(d.dataDir, 'sync', libraryKey(r), 'state.json');
  const prefsFile = (r: string) => path.join(d.dataDir, 'sync', libraryKey(r), 'prefs.json');
  const loadPrefs = async (r: string) => cleanPrefs(JSON.parse(await fsp.readFile(prefsFile(r), 'utf8')));

  async function view(): Promise<SyncView> {
    const acct = syncAccount();
    const signedIn = !!(await acct.getAccessToken().catch(() => null));
    const entitled = signedIn && !!(await Promise.resolve(acct.hasEntitlement('sync')).catch(() => false));
    const st = engine?.state;
    return {
      signedIn,
      entitled,
      canSignIn: !!acct.signIn,
      canUpgrade: signedIn && !entitled && !!acct.upgrade,
      noVault: !vault,
      on: prefs.on && !!prefs.vaultId,
      ...(prefs.teamId ? { team: true } : {}),
      existing,
      phase: (prefs.on ? (prefs.paused ? 'paused' : phase) : 'off') as SyncPhase,
      error,
      lastOk: st?.stats.lastOk ?? 0,
      waiting: (engine?.waiting ?? 0) + (st?.journal.remote.length ?? 0),
      conflicts: st?.stats.conflicts ?? 0,
      skipped: engine?.skipped ?? 0,
      excluded: prefs.excluded,
      usage,
      devices,
    };
  }

  const changed = () => {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void view().then((v) => d.send('isync:changed', v)).catch(() => {}), 100);
  };
  onSyncAccountChange(changed);

  async function refreshInfo(): Promise<void> {
    if (!prefs.vaultId || !engine) return;
    try {
      const info = await api.vault(prefs.vaultId);
      usage = info.usage;
      // Device names are opened here; the server has them sealed.
      devices = (await api.devices(prefs.vaultId)).map((x) => ({ id: x.device, name: devicesName(x.device, x.name), lastSeen: x.lastSeen, me: x.device === d.device.id }));
    } catch {
      // Shown next time; the status line says why when it matters.
    }
  }

  async function stopRunner(): Promise<void> {
    detach?.();
    detach = null;
    const r = runner;
    runner = null;
    engine = null;
    if (r) await r.stop();
  }

  async function startRunner(): Promise<void> {
    await stopRunner();
    const v = vault;
    if (!v || !prefs.on || !prefs.vaultId) {
      phase = 'off';
      return changed();
    }
    const raw = await keys.getRaw(prefs.vaultId);
    if (!raw) {
      phase = 'error';
      error = prefs.teamId ? 'This PC doesn’t have the team vault’s key yet. Open Settings › Teams.' : 'Type your sync passphrase on this PC to carry on syncing.';
      return changed();
    }
    const vkeys = raw.startsWith('ring:') ? new TeamKeyRing(parseRing(raw.slice(5)), prefs.vaultId) : new VaultKeys(Buffer.from(raw, 'base64'), prefs.vaultId);
    const aside = asideIn(path.join(path.dirname(stateFile(v.root)), 'replaced'));
    engine = new SyncEngine({
      api,
      keys: vkeys,
      root: v.root,
      device: d.device,
      writer: new VaultWriter(v, d.device.name, d.osTrash, aside),
      store: new FileStateStore(stateFile(v.root)),
      excluded: () => prefs.excluded,
      applied: (rels, moves) => d.applied(rels, moves),
      resolve: resolveConfig,
      keepAside: aside,
      log: d.log,
    });
    await engine.load();
    const eng = engine;
    devicesName = (id, sealed) => vkeys.openDeviceName(id, sealed);
    runner = new SyncRunner({
      engine: eng,
      api,
      vaultId: prefs.vaultId,
      deviceId: d.device.id,
      gate: async () => (await d.mayWrite()) && !!(await token()),
      onStatus: (s, detail) => {
        phase = detail.error === 'read-only' ? 'read-only' : s;
        error = s === 'error' || s === 'offline' ? words(detail.err ?? detail.error) : '';
        if (s === 'idle') void refreshInfo().then(changed);
        changed();
      },
    });
    // The Vault's own watcher (no second one): a change here starts a round after a short wait.
    const kick = () => runner?.kick();
    v.on('change', kick);
    v.on('rescan', kick);
    detach = () => {
      v.off('change', kick);
      v.off('rescan', kick);
    };
    if (prefs.paused) runner.pause();
    runner.start();
  }

  async function setPrefs(next: Prefs): Promise<void> {
    prefs = next;
    const r = root();
    if (!r) return;
    await fsp.mkdir(path.dirname(prefsFile(r)), { recursive: true });
    const tmp = `${prefsFile(r)}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(prefs));
    await fsp.rename(tmp, prefsFile(r));
  }

  async function requireAccount(): Promise<void> {
    if (!vault) throw new Error('Open your notes first.');
    // Checked first, so nothing is made on the server that this PC then couldn't keep the key for.
    if (!d.protect.available()) throw new Error('This PC can’t protect the sync key (no system keyring), so sync can’t be set up here.');
    if (!(await token())) throw new Error('Sign in to your Ironleaf account first.');
    if (!(await Promise.resolve(syncAccount().hasEntitlement('sync')))) throw new Error('Your account doesn’t include Sync. Add Sync to your plan first.');
  }

  async function begin(vaultId: string, vk: Buffer | Ring, teamId: string | null = null): Promise<void> {
    const ring = Buffer.isBuffer(vk) ? null : vk;
    await keys.setRaw(vaultId, ring ? `ring:${JSON.stringify(ring)}` : (vk as Buffer).toString('base64'));
    const vkeys = ring ? new TeamKeyRing(ring, vaultId) : new VaultKeys(vk as Buffer, vaultId);
    await api.addDevice(vaultId, d.device.id, vkeys.sealDeviceName(d.device.id, d.device.name));
    // A different vault than before: start from nothing agreed (files on both sides are compared by their bytes).
    if (prefs.vaultId !== vaultId && vault) await fsp.rm(stateFile(vault.root), { force: true });
    await setPrefs({ ...prefs, on: true, vaultId, paused: false, teamId });
    error = '';
    await startRunner();
  }

  d.handle('isync:view', async () => {
    if (prefs.on) await refreshInfo();
    else if (vault && (await token().catch(() => null))) existing = (await api.listVaults().catch(() => [])).length > 0;
    return view();
  });
  d.handle('isync:sign-in', async () => {
    await syncAccount().signIn?.();
    return view();
  });
  d.handle('isync:upgrade', async () => {
    await syncAccount().upgrade?.();
    return view();
  });
  d.handle('isync:create', async (passphrase: unknown) => {
    await requireAccount();
    if (typeof passphrase !== 'string') throw new Error('Type a passphrase.');
    const made = await createEnvelope(passphrase);
    const { id } = await api.createVault(JSON.stringify(made.envelope));
    await begin(id, made.vaultKey);
    // The recovery key is shown once and never kept here.
    return { recovery: made.recovery, view: await view() };
  });
  d.handle('isync:join', async (raw: unknown) => {
    await requireAccount();
    const j = (raw && typeof raw === 'object' ? raw : {}) as SyncJoin;
    const list = await api.listVaults();
    if (!list.length) throw new Error('Your account has no sync vault yet. Set one up instead.');
    const target = list[0]!;
    const info = await api.vault(target.id);
    const env = parseEnvelope(info.envelope);
    let vk: Buffer;
    if (typeof j.recovery === 'string' && j.recovery.trim()) {
      vk = openWithRecovery(env, j.recovery);
      if (typeof j.newPassphrase === 'string' && j.newPassphrase) await api.putEnvelope(target.id, JSON.stringify(await rewrapEnvelope(env, vk, j.newPassphrase)));
    } else if (typeof j.passphrase === 'string') vk = await openWithPassphrase(env, j.passphrase);
    else throw new Error('Type your sync passphrase.');
    await begin(target.id, vk);
    return view();
  });
  d.handle('isync:pause', async (paused: unknown) => {
    await setPrefs({ ...prefs, paused: paused === true });
    if (paused === true) runner?.pause();
    else runner?.resume();
    changed();
    return view();
  });
  d.handle('isync:now', async () => {
    runner?.kick(0);
    return view();
  });
  d.handle('isync:exclude', async (folders: unknown) => {
    if (!Array.isArray(folders)) throw new Error('Choose folders to leave out.');
    await setPrefs({ ...prefs, excluded: cleanFolders(folders) });
    runner?.kick(0);
    return view();
  });
  d.handle('isync:remove-device', async (id: unknown) => {
    if (!prefs.vaultId || typeof id !== 'string') throw new Error('That PC isn’t in this sync vault.');
    await api.removeDevice(prefs.vaultId, id);
    await refreshInfo();
    return view();
  });
  d.handle('isync:off', async () => {
    await stopRunner();
    if (prefs.vaultId) await keys.set(prefs.vaultId, null).catch(() => {});
    if (vault) await fsp.rm(stateFile(vault.root), { force: true });
    await setPrefs({ ...DEFAULT_PREFS, excluded: prefs.excluded });
    phase = 'off';
    usage = null;
    devices = [];
    return view();
  });

  return {
    async opened(next) {
      await stopRunner();
      vault = next;
      usage = null;
      devices = [];
      error = '';
      prefs = next ? await loadPrefs(next.root).catch(() => DEFAULT_PREFS) : DEFAULT_PREFS;
      if (next && prefs.on) await startRunner().catch((err) => ((error = words(err)), changed()));
      changed();
    },
    stop: stopRunner,
    team: {
      current: () => (vault ? { root: vault.root, vaultId: prefs.vaultId, teamId: prefs.teamId ?? null, on: prefs.on } : null),
      async begin(vaultId, teamId, ring) {
        if (!vault) throw new Error('Open your notes first.');
        if (!d.protect.available()) throw new Error('This PC can’t protect the team vault’s key (no system keyring), so it can’t be set up here.');
        if (prefs.on && prefs.vaultId && prefs.vaultId !== vaultId) throw new Error('These notes already sync. Turn sync off in Settings › Backups and sync first, or open another notes folder.');
        await begin(vaultId, ring, teamId);
        changed();
      },
      async rekey(vaultId, ring) {
        const had = await keys.getRaw(vaultId);
        if (!had?.startsWith('ring:')) return;
        await keys.setRaw(vaultId, `ring:${JSON.stringify(ring)}`);
        if (prefs.on && prefs.vaultId === vaultId) await startRunner();
      },
      async ring(vaultId) {
        const raw = await keys.getRaw(vaultId);
        return raw?.startsWith('ring:') ? parseRing(raw.slice(5)) : null;
      },
      changed,
    },
  };
}
