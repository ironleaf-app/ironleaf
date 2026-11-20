// App settings in the user's app-data folder. Models are the former host app's connections (src/main/providers); a
// model chosen here overrides the former host app's default for Ironleaf only, and a key typed here is kept by
// KeyStore, encrypted by the operating system, never in this file.

import { app } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { DEFAULT_PREFS, loadPrefs, mergePrefs, type Prefs } from '../shared/prefs';
import type { AppSettings, ModelChoice, SettingsPatch, ThinkingLevel } from '../shared/types';
import type { FolderChoice } from '../shared/project-folder';
import { libraryKey } from './library-state';
import { KeyedFile } from './vault-settings';
import { KeyedQueue, writeFileAtomic } from './save-guard';
import { ID_DIR } from '../shared/vault-home';
import { joinPrefs, moveIn, sameValue, splitPrefs, VAULT_SETTING_KEYS } from '../shared/vault-settings';

export interface CurrentVault {
  path: string;
  id: string | null;
  name: string;
  /** onedrive, dropbox, gdrive, icloud, network or local (src/shared/vault-place.ts PlaceKind). */
  place?: string;
  /** "OneDrive", "Dropbox", "this PC"… */
  placeName?: string;
  at: string;
}

interface StoredSettings {
  lastVault?: string;
  /** Where Ironleaf keeps its notes, when the person chose a folder (else the host's default). */
  library?: string;
  recentVaults: string[];
  /** Where your vault is (src/main/vault-place.ts): Today's cards put away, by folder (lower case). */
  placeSeen?: { tip?: string[]; found?: string[] };
  /** The only-here tip put away ("Not now"), by folder (lower case) to when (ISO): it shows again a week
   *  later (8 Nov 2026, calm list). The old `placeSeen.tip` list, where present, reads as long ago. */
  placeTipSnooze?: Record<string, string>;
  /** The vault open now, as the former host app and a chat bot are told it (src/main/vault-home.ts, 23 Oct 2026): its folder,
   *  its identity (.neuralvault/vault.json) and where it is. The former host app reads this first (vault-reach.mjs
   *  libraryPath), and says it to the person's other PCs (bot-computers.mjs), so every app on a PC uses the one vault
   *  Ironleaf has open. */
  current?: CurrentVault;
  /** Folders a move into Documents\Ironleaf left behind, kept until the person says they can go. */
  homeOld?: { from: string; to: string; at: string }[];
  /** "Your PCs have different vaults open" put away, by the vault's id (or folder, lower case). */
  homeSeen?: string[];
  /** Each project's folder on this PC, by the folder its note names (src/shared/project-folder.ts folderKey): chosen
   *  here, never written into the synced note, so each PC keeps its own (src/main/project-places.ts). */
  projectFolders?: Record<string, FolderChoice>;
  model: ModelChoice | null;
  dailyFolder: string;
  dailyFormat: string;
  dailyTemplate: string;
  /** Every preference as it is now (this PC's, the person's and the vault's put together): this PC's copy of them, and what
   *  an older former host app reads. The vault's and the person's own are kept in their own files (src/shared/
   *  vault-settings.ts): the vault's in .neuralvault/settings.json, the person's in personal.json. */
  prefs: Prefs;
  /** When this PC's settings were first moved to their homes: the person's (personal.json), and each vault's (by
   *  library-state.ts libraryKey). settings.before-shared.json keeps the settings as they were before. */
  moved?: { personal?: string; vaults?: Record<string, string> };
}

const DEFAULTS: StoredSettings = {
  recentVaults: [],
  model: null,
  dailyFolder: 'Daily',
  dailyFormat: 'YYYY-MM-DD',
  dailyTemplate: '',
  prefs: DEFAULT_PREFS,
};

const LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** A model choice as saved: a connection id and model id, and a reasoning level when one was picked. */
function cleanChoice(value: unknown): ModelChoice | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.provider !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(v.provider)) return null;
  if (typeof v.model !== 'string' || !v.model || v.model.length > 200 || /[\u0000-\u001f]/.test(v.model)) return null;
  const reasoning = typeof v.reasoning === 'string' && (LEVELS as string[]).includes(v.reasoning) ? (v.reasoning as ThinkingLevel) : undefined;
  return { provider: v.provider, model: v.model, ...(reasoning ? { reasoning } : {}) };
}

export class SettingsStore {
  private data: StoredSettings = { ...DEFAULTS };
  /** The person's preferences (personal.json): The former host app carries them to their other PCs through a chat bot. */
  private personal: KeyedFile | null = null;
  /** The open vault's settings (.neuralvault/settings.json in it), and which vault. */
  private vaultFile: KeyedFile | null = null;
  private vaultRoot: string | null = null;
  /** This PC's own preferences, as settings.json keeps them (the base the person's and the vault's go over). */
  private pcPrefs: Partial<Prefs> = {};
  /** This PC's id (the `by` of each change), from Ironleaf's data (src/main/app.ts deviceOf). */
  device: () => string = () => 'this-pc';
  /** Whether the open vault may be written (its licence). */
  mayWriteVault: () => Promise<boolean> = async () => true;
  log: (message: string) => void = () => undefined;
  /** When this PC's settings were last changed before this start (a move into a vault is stamped with it: of two PCs'
   *  settings brought in, the more recently used one's win). */
  private lastChanged = Date.now();
  /** Works out whether the AI features can run, given the choice (src/main/index.ts wires it to ProviderService). */
  aiStatus: (choice: ModelChoice | null) => AppSettings['ai'] = () => ({ ready: false, note: null, modelName: null });

  constructor(private readonly dataDir?: string) {}

  private get dir(): string {
    return this.dataDir || app.getPath('userData');
  }

  private get file(): string {
    return path.join(this.dir, 'settings.json');
  }

  async load(): Promise<void> {
    let mtime = Date.now();
    try {
      const text = await fsp.readFile(this.file, 'utf8');
      mtime = (await fsp.stat(this.file)).mtimeMs;
      this.lastChanged = mtime;
      const parsed = JSON.parse(text.replace(/^\uFEFF/, '')) as Partial<StoredSettings> & { model?: unknown };
      // 0.1.0 saved a Claude model name here; a model now names one of the former host app's
      // connections.
      this.data = { ...DEFAULTS, ...parsed, model: cleanChoice(parsed.model), prefs: loadPrefs(parsed.prefs) };
      this.pcPrefs = this.data.prefs;
    } catch {
      this.data = { ...DEFAULTS };
      this.pcPrefs = {};
    }
    // The person's preferences: their own file, moved from this PC's settings the first time.
    this.personal = new KeyedFile({ file: path.join(this.dir, 'personal.json'), kind: 'personal', device: () => this.device(), log: (m) => this.log(m) });
    await this.personal.load().catch(() => false);
    if (!this.data.moved?.personal) {
      await this.keepBefore();
      const { doc } = moveIn(this.personal.doc, 'personal', splitPrefs(this.pcPrefs).personal, splitPrefs(DEFAULT_PREFS).personal, mtime, this.device());
      await this.personal.adopt(doc).catch(() => false);
      this.data.moved = { ...this.data.moved, personal: new Date().toISOString() };
      this.combine();
      await this.save().catch(() => undefined);
    }
    this.combine();
  }

  /** The settings as they were before any moved to the vault or the person's file: kept once, never written again. */
  private async keepBefore(): Promise<void> {
    const before = path.join(this.dir, 'settings.before-shared.json');
    if (await fsp.stat(before).then(() => true, () => false)) return;
    await fsp.copyFile(this.file, before).catch(() => undefined);
  }

  /** The preferences put together: this PC's, then the person's, then the open vault's; the daily notes' from the vault. */
  private combine(): void {
    const vault = this.vaultFile?.values() ?? {};
    this.data.prefs = loadPrefs(joinPrefs(this.pcPrefs, this.personal?.values() ?? {}, vault));
    for (const key of VAULT_SETTING_KEYS) if (typeof vault[key] === 'string' && (vault[key] || key !== 'dailyFormat')) this.data[key] = vault[key] as string;
    // The base from now on: what is in use (a value missing from a file falls back to it, as settings.json keeps it).
    this.pcPrefs = this.data.prefs;
  }

  /** The vault opened: its settings read from it (the first time on this PC, this PC's own moved in, kept where they were
   *  too); the settings in use change to the vault's. Says whether they changed. A foreign folder opened in place keeps
   *  its settings in this PC's mirror only (5 Nov 2026, u3 moving-in): nothing is written into the folder, and the
   *  move-in waits for a real adoption. */
  async useVault(root: string, o: { inPlace?: boolean } = {}): Promise<boolean> {
    const before = JSON.stringify([this.data.prefs, this.data.dailyFolder, this.data.dailyFormat, this.data.dailyTemplate]);
    const key = libraryKey(root);
    this.vaultRoot = root;
    this.vaultFile = new KeyedFile({
      file: o.inPlace ? path.join(this.dir, 'libraries', key, 'vault-settings.json') : path.join(root, ID_DIR, 'settings.json'),
      mirror: o.inPlace ? null : path.join(this.dir, 'libraries', key, 'vault-settings.json'),
      kind: 'settings',
      device: () => this.device(),
      mayWrite: () => (o.inPlace ? Promise.resolve(true) : this.mayWriteVault()),
      log: (m) => this.log(m),
    });
    await this.vaultFile.load().catch(() => false);
    if (!o.inPlace && !this.data.moved?.vaults?.[key]) {
      await this.keepBefore();
      const mine: Record<string, unknown> = { ...splitPrefs(this.pcPrefs).vault };
      const defaults: Record<string, unknown> = { ...splitPrefs(DEFAULT_PREFS).vault };
      for (const k of VAULT_SETTING_KEYS) {
        mine[k] = this.data[k];
        defaults[k] = DEFAULTS[k];
      }
      const { doc } = moveIn(this.vaultFile.doc, 'settings', mine, defaults, this.lastChanged, this.device());
      await this.vaultFile.adopt(doc).catch(() => false);
      this.data.moved = { ...this.data.moved, vaults: { ...(this.data.moved?.vaults ?? {}), [key]: new Date().toISOString() } };
    }
    this.combine();
    await this.save().catch(() => undefined);
    return JSON.stringify([this.data.prefs, this.data.dailyFolder, this.data.dailyFormat, this.data.dailyTemplate]) !== before;
  }

  /** Read again what may have changed elsewhere: the vault's settings (another PC, through OneDrive) and the person's (the
   *  former host app brought them from another PC). Says whether the settings in use changed. */
  async refresh(): Promise<boolean> {
    const before = JSON.stringify([this.data.prefs, this.data.dailyFolder, this.data.dailyFormat, this.data.dailyTemplate]);
    const a = await (this.personal?.refresh() ?? Promise.resolve(false)).catch(() => false);
    const b = await (this.vaultFile?.refresh() ?? Promise.resolve(false)).catch(() => false);
    if (!a && !b) return false;
    this.combine();
    const changed = JSON.stringify([this.data.prefs, this.data.dailyFolder, this.data.dailyFormat, this.data.dailyTemplate]) !== before;
    if (changed) await this.save().catch(() => undefined);
    return changed;
  }

  /** Where the open vault's settings are, and how they stand (Settings › Files and links). */
  sharedState(): { vault: string | null; vaultFile: string | null; vaultDisk: string; personalFile: string | null; copiesMerged: number } {
    return { vault: this.vaultRoot, vaultFile: this.vaultFile?.file ?? null, vaultDisk: this.vaultFile?.disk ?? 'unread', personalFile: this.personal?.file ?? null, copiesMerged: this.vaultFile?.mergedCopies ?? 0 };
  }

  private writes = new KeyedQueue();
  /** settings.json written whole, one save at a time (20 Nov 2026): opening a vault and an import save several times at
   *  once (rememberVault, useVault, setCurrent twice), and the saves shared one temp file, so one rename failed with
   *  ENOENT (opening the vault stopped halfway, and a failed open forgot the vault) and two writes into the same
   *  temp could leave settings.json half one and half the other, which the next start read as no settings at all.
   *  Now each save takes its turn, writes what is current then, and goes through its own temp with the retry for
   *  Windows' brief locks (save-guard.ts). */
  private save(): Promise<void> {
    return this.writes.run(this.file, async () => {
      await fsp.mkdir(this.dir, { recursive: true });
      await writeFileAtomic(this.file, JSON.stringify(this.data, null, 2));
    });
  }

  get raw(): Readonly<StoredSettings> {
    return this.data;
  }

  /** Who Ironleaf is running as (filled in by the app). */
  about: AppSettings['about'] = { version: '1.0.0', host: 'standalone' };

  view(): AppSettings {
    return {
      prefs: this.data.prefs,
      about: this.about,
      model: this.data.model,
      dailyFolder: this.data.dailyFolder,
      dailyFormat: this.data.dailyFormat,
      dailyTemplate: this.data.dailyTemplate,
      ai: this.aiStatus(this.data.model),
      recentVaults: this.data.recentVaults,
    };
  }

  async update(patch: SettingsPatch): Promise<AppSettings> {
    if (patch.model !== undefined) {
      const choice = patch.model === null ? null : cleanChoice(patch.model);
      if (patch.model !== null && !choice) throw new Error('That model can’t be chosen.');
      this.data.model = choice;
    }
    const vaultChanges: Record<string, unknown> = {};
    for (const key of ['dailyFolder', 'dailyFormat', 'dailyTemplate'] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.length > 500) throw new Error(`Invalid ${key}.`);
      this.data[key] = value.trim();
      if (key === 'dailyFormat' && !this.data.dailyFormat) this.data.dailyFormat = DEFAULTS.dailyFormat;
      vaultChanges[key] = this.data[key];
    }
    if (patch.library !== undefined) {
      if (typeof patch.library !== 'string' || !path.isAbsolute(patch.library) || patch.library.length > 1000) throw new Error('Choose a folder on this PC for your notes.');
      this.data.library = patch.library;
    }
    let personalChanges: Record<string, unknown> = {};
    if (patch.prefs !== undefined) {
      // Each changed preference goes to its home: the vault's into the vault, the person's into their file, this PC's here.
      const next = mergePrefs(this.data.prefs, patch.prefs);
      const changed: Partial<Prefs> = {};
      for (const k of Object.keys(next) as (keyof Prefs)[]) if (!sameValue(next[k], this.data.prefs[k])) (changed as Record<string, unknown>)[k] = next[k];
      const parts = splitPrefs(changed);
      // 'hidden' is in both parts; each file gets only its own half, and only when that half changed.
      if ('hidden' in changed) {
        const was = splitPrefs({ hidden: this.data.prefs.hidden });
        if (sameValue(was.vault.hidden, parts.vault.hidden)) delete parts.vault.hidden;
        if (sameValue(was.personal.hidden, parts.personal.hidden)) delete parts.personal.hidden;
      }
      Object.assign(vaultChanges, parts.vault);
      personalChanges = parts.personal;
      this.data.prefs = next;
      this.pcPrefs = next;
    }
    if (Object.keys(personalChanges).length && this.personal) await this.personal.set(personalChanges).catch((err) => this.log(`Ironleaf could not keep your preferences: ${err instanceof Error ? err.message : String(err)}`));
    if (Object.keys(vaultChanges).length && this.vaultFile) await this.vaultFile.set(vaultChanges).catch((err) => this.log(`Ironleaf could not keep the vault’s settings: ${err instanceof Error ? err.message : String(err)}`));
    // settings.json keeps this PC's copy of everything (the base when a file can't be read; what an older former host app
    // reads).
    await this.save();
    return this.view();
  }

  async rememberVault(vaultPath: string): Promise<void> {
    this.data.lastVault = vaultPath;
    this.data.recentVaults = [vaultPath, ...this.data.recentVaults.filter((v) => v !== vaultPath)].slice(0, 10);
    await this.save();
  }

  /** In Recent (second, after the vault open now), without opening it. */
  async addRecent(vaultPath: string): Promise<void> {
    if (this.data.recentVaults.includes(vaultPath)) return;
    this.data.recentVaults = [...this.data.recentVaults.slice(0, 1), vaultPath, ...this.data.recentVaults.slice(1)].slice(0, 10);
    await this.save();
  }

  /** One of Today's vault cards put away for this folder: the found vault never again; the only-here
   *  tip for a week (8 Nov 2026, calm list), then it shows again. */
  async dismissPlace(kind: 'tip' | 'found', folder: string): Promise<void> {
    const key = path.resolve(folder).toLowerCase();
    if (kind === 'tip') {
      const snooze = { ...(this.data.placeTipSnooze ?? {}) };
      snooze[key] = new Date().toISOString();
      const keys = Object.keys(snooze).sort().slice(-20);
      this.data.placeTipSnooze = Object.fromEntries(keys.map((k) => [k, snooze[k]]));
      await this.save();
      return;
    }
    const seen = { ...(this.data.placeSeen ?? {}) };
    seen[kind] = [key, ...(seen[kind] ?? []).filter((k) => k !== key)].slice(0, 20);
    this.data.placeSeen = seen;
    await this.save();
  }

  placeDismissed(kind: 'tip' | 'found', folder: string): boolean {
    return !!this.data.placeSeen?.[kind]?.includes(path.resolve(folder).toLowerCase());
  }

  /** When the only-here tip was put away for this folder (ISO), or null when never (8 Nov 2026, calm
   *  list: a week later it shows again; the old permanent list reads as long ago, so it shows now). */
  placeTipSnoozedAt(folder: string): string | null {
    const key = path.resolve(folder).toLowerCase();
    return this.data.placeTipSnooze?.[key] ?? null;
  }

  /** What this PC chose for a project's folder (by src/shared/project-folder.ts folderKey of the folder its note names). */
  folderChoice(key: string): FolderChoice | null {
    const c = this.data.projectFolders?.[key];
    return c && typeof c === 'object' && (c.none === true || (typeof c.folder === 'string' && path.isAbsolute(c.folder))) ? c : null;
  }

  /** A project's folder on this PC chosen (or working without one here), or forgotten (null). */
  async setFolderChoice(key: string, choice: FolderChoice | null): Promise<void> {
    if (!key) return;
    const all = { ...(this.data.projectFolders ?? {}) };
    if (choice) all[key] = { ...(choice.folder ? { folder: choice.folder } : {}), ...(choice.none ? { none: true } : {}), at: new Date().toISOString() };
    else delete all[key];
    this.data.projectFolders = all;
    await this.save();
  }

  /** The vault open now, for the former host app and a chat bot (written each time a vault opens, and when where it is is
known). */
  async setCurrent(current: Omit<CurrentVault, 'at'>): Promise<void> {
    const was = this.data.current;
    if (was && was.path === current.path && was.id === current.id && was.name === current.name && was.place === current.place && was.placeName === current.placeName) return;
    this.data.current = { ...current, at: new Date().toISOString() };
    await this.save();
  }

  /** A folder a move left behind (kept until the person says it can go), or one dealt with (forgotten). */
  async keepOldFolder(entry: { from: string; to: string } | null, forget?: string): Promise<void> {
    let list = (this.data.homeOld ?? []).filter((x) => !forget || path.resolve(x.from).toLowerCase() !== path.resolve(forget).toLowerCase());
    if (entry) list = [{ ...entry, at: new Date().toISOString() }, ...list.filter((x) => path.resolve(x.from).toLowerCase() !== path.resolve(entry.from).toLowerCase())].slice(0, 10);
    this.data.homeOld = list;
    await this.save();
  }

  async dismissHome(key: string): Promise<void> {
    const k = key.toLowerCase();
    this.data.homeSeen = [k, ...(this.data.homeSeen ?? []).filter((x) => x !== k)].slice(0, 20);
    await this.save();
  }

  homeDismissed(key: string): boolean {
    return !!this.data.homeSeen?.includes(key.toLowerCase());
  }

  async forgetVault(vaultPath: string): Promise<void> {
    this.data.recentVaults = this.data.recentVaults.filter((v) => v !== vaultPath);
    if (this.data.lastVault === vaultPath) delete this.data.lastVault;
    await this.save();
  }
}
