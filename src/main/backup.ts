// Settings › Backup and sync (21 Oct 2026, gap G28): the Git backup (src/main/git-backup.ts) and the encrypted sync
// folder (src/main/sync-folder.ts) for the vault that's open, their settings (Ironleaf's own data for that vault,
// never the notes), and the two secrets they need — a Git token and the sync passphrase — kept encrypted by Windows
// (Electron safeStorage) in Ironleaf's data folder, never shown again and never in a log.

import { dialog, safeStorage, type BrowserWindow } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { branchProblem, cleanBackupPrefs, DEFAULT_BACKUP, remoteKind, type BackupPrefs, type BackupView } from '../shared/backup';
import { isPrivatePath } from '../shared/private';
import { GitBackup, type GitVersion, type HostGit } from './git-backup';
import { libraryKey } from './library-state';
import { SyncFolder } from './sync-folder';

export interface BackupDeps {
  handle(channel: string, fn: (...args: any[]) => unknown): void;
  send(channel: string, payload: unknown): void;
  root(): string | null;
  dataDir: string;
  load(): Promise<unknown>;
  save(value: BackupPrefs): Promise<void>;
  hostGit?(): Promise<HostGit | null>;
  device: { id: string; name: string };
  trash(abs: string): Promise<void>;
  /** Files a sync wrote or removed: the vault reads them again. */
  changedOnDisk(rels: string[]): void;
  window(): BrowserWindow | null;
}

type Secrets = Record<string, { token?: string; passphrase?: string }>;

/** The token and passphrase, per vault, encrypted by the operating system. */
class BackupSecrets {
  private data: Secrets | null = null;
  constructor(private readonly file: string) {}

  private async all(): Promise<Secrets> {
    if (this.data) return this.data;
    try {
      const bytes = await fsp.readFile(this.file);
      this.data = safeStorage.isEncryptionAvailable() ? (JSON.parse(safeStorage.decryptString(bytes)) as Secrets) : {};
    } catch {
      this.data = {};
    }
    return this.data;
  }

  async get(vault: string, which: 'token' | 'passphrase'): Promise<string | null> {
    return (await this.all())[vault]?.[which] ?? null;
  }

  async set(vault: string, which: 'token' | 'passphrase', value: string | null): Promise<void> {
    const all = { ...(await this.all()) };
    const entry = { ...(all[vault] ?? {}) };
    if (value) entry[which] = value;
    else delete entry[which];
    all[vault] = entry;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This PC can’t protect saved secrets, so it wasn’t saved.');
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await fsp.writeFile(temp, safeStorage.encryptString(JSON.stringify(all)));
    await fsp.rename(temp, this.file);
    this.data = all;
  }
}

const words = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function registerBackup(d: BackupDeps): {
  opened(root: string | null): Promise<void>;
  versions(rel: string): Promise<GitVersion[]>;
  read(id: string): Promise<string>;
  stop(): void;
} {
  let prefs: BackupPrefs = DEFAULT_BACKUP;
  const secrets = new BackupSecrets(path.join(d.dataDir, 'backup-secrets.bin'));
  const vaultKey = () => {
    const root = d.root();
    return root ? libraryKey(root) : '';
  };
  let pushView: NodeJS.Timeout | undefined;
  const changed = () => {
    clearTimeout(pushView);
    pushView = setTimeout(() => void view().then((v) => d.send('backup:changed', v)).catch(() => {}), 80);
  };
  const git = new GitBackup({
    root: d.root,
    prefs: () => prefs.git,
    ...(d.hostGit ? { hostGit: d.hostGit } : {}),
    token: () => secrets.get(vaultKey(), 'token'),
    helperDir: path.join(d.dataDir, 'git'),
    isPrivate: isPrivatePath,
    changed,
  });
  const sync = new SyncFolder({
    root: d.root,
    prefs: () => prefs.sync,
    passphrase: () => secrets.get(vaultKey(), 'passphrase'),
    stateDir: () => (d.root() ? path.join(d.dataDir, 'libraries', vaultKey()) : null),
    device: d.device,
    trash: d.trash,
    changed,
    wrote: (rels) => d.changedOnDisk(rels),
  });

  async function view(): Promise<BackupView> {
    const key = vaultKey();
    const existing = prefs.sync.folder ? await sync.existing(prefs.sync.folder) : false;
    const source = git.source === 'unknown' ? await git.available() : git.source;
    const hostGit = d.hostGit ? !!(await d.hostGit().catch(() => null)) : false;
    return {
      git: {
        prefs: prefs.git,
        git: source,
        tokenSaved: key ? !!(await secrets.get(key, 'token')) : false,
        hostSignIn: hostGit,
        lastOk: git.lastOk,
        lastPush: git.lastPush,
        words: git.words,
        error: git.error,
        busy: git.busy,
        commits: git.commits,
      },
      sync: {
        prefs: prefs.sync,
        passphraseSaved: key ? !!(await secrets.get(key, 'passphrase')) : false,
        existing,
        lastOk: sync.lastOk,
        words: sync.words,
        error: sync.error,
        busy: sync.busy,
        files: sync.files,
        conflicts: sync.conflicts,
      },
    };
  }

  async function setPrefs(next: BackupPrefs): Promise<void> {
    prefs = cleanBackupPrefs(next);
    if (d.root()) await d.save(prefs);
  }

  const requireRoot = () => {
    if (!d.root()) throw new Error('Open your notes first.');
  };

  d.handle('backup:view', () => view());

  // The Git backup's settings: switched on (the first backup runs at once), how often, the remote and how it signs in.
  d.handle('backup:git', async (patch: unknown) => {
    requireRoot();
    const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
    const next = cleanBackupPrefs({ ...prefs, git: { ...prefs.git, ...p } });
    if (typeof p.branch === 'string' && p.branch.trim() && branchProblem(p.branch.trim())) throw new Error(branchProblem(p.branch.trim())!);
    if (typeof p.remote === 'string' && p.remote.trim()) {
      const kind = remoteKind(p.remote, path.isAbsolute);
      if ('problem' in kind) throw new Error(kind.problem);
    }
    const turnedOn = next.git.on && !prefs.git.on;
    await setPrefs(next);
    if (turnedOn) void git.backup().catch(() => {});
    return view();
  });
  d.handle('backup:git-token', async (token: unknown, user: unknown) => {
    requireRoot();
    const t = typeof token === 'string' ? token.trim() : '';
    if (t && (t.length > 4096 || /[\s\u0000-\u001f]/.test(t))) throw new Error('That doesn’t look like a token. Paste the whole token, with nothing around it.');
    await secrets.set(vaultKey(), 'token', t || null);
    if (typeof user === 'string') await setPrefs({ ...prefs, git: { ...prefs.git, user: user.trim().slice(0, 200) } });
    return view();
  });
  d.handle('backup:git-now', async () => {
    requireRoot();
    try {
      await git.backup();
    } catch (err) {
      // Said in the view (Settings shows it); the button needs no second message.
      void words(err);
    }
    return view();
  });

  // The encrypted sync folder: chosen, its passphrase (a new copy, or the one another PC made), switched on, synced now.
  d.handle('backup:sync-pick', async () => {
    const w = d.window();
    const options = { title: 'Choose a folder for the encrypted copy', buttonLabel: 'Use this folder', properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
    const pick = w && !w.isDestroyed() ? await dialog.showOpenDialog(w, options) : await dialog.showOpenDialog(options);
    const folder = pick.canceled ? '' : pick.filePaths[0] ?? '';
    if (!folder) return null;
    const root = d.root();
    const rel = root ? path.relative(root, folder) : '..';
    if (root && (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)))) throw new Error('Choose a folder outside your notes for the encrypted copy.');
    return { folder, existing: await sync.existing(folder) };
  });
  d.handle('backup:sync-setup', async (folder: unknown, passphrase: unknown) => {
    requireRoot();
    if (typeof folder !== 'string' || !path.isAbsolute(folder) || typeof passphrase !== 'string') throw new Error('Choose a folder and type a passphrase.');
    const { joined } = await sync.prepare(folder, passphrase);
    await secrets.set(vaultKey(), 'passphrase', passphrase);
    await setPrefs({ ...prefs, sync: { ...prefs.sync, folder, on: true } });
    void sync.sync().catch(() => {});
    return { joined, view: await view() };
  });
  d.handle('backup:sync', async (patch: unknown) => {
    requireRoot();
    const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
    await setPrefs(cleanBackupPrefs({ ...prefs, sync: { ...prefs.sync, ...(p.on !== undefined ? { on: p.on === true } : {}), ...(p.minutes !== undefined ? { minutes: p.minutes } : {}) } }));
    return view();
  });
  d.handle('backup:sync-forget', async () => {
    requireRoot();
    await secrets.set(vaultKey(), 'passphrase', null);
    await setPrefs({ ...prefs, sync: { ...prefs.sync, on: false, folder: '' } });
    sync.reset();
    return view();
  });
  d.handle('backup:sync-now', async () => {
    requireRoot();
    await sync.sync().catch(() => {});
    return view();
  });

  git.start();
  sync.start();

  return {
    /** Another folder of notes opened (or none): its own settings and times. */
    async opened(root) {
      git.reset();
      sync.reset();
      prefs = root ? cleanBackupPrefs(await d.load()) : DEFAULT_BACKUP;
      changed();
    },
    /** A note's versions in the Git backup, for Earlier versions (none when it's off or there's no history). */
    async versions(rel) {
      if (!d.root()) return [];
      return git.history(rel).catch(() => []);
    },
    read: (id) => git.readAt(id),
    stop() {
      git.stop();
      sync.stop();
    },
  };
}
