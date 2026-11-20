// One standard home for vaults, in the running app (23 Oct 2026; the pieces are in src/main/vault-home.ts, the words and
// rules in src/shared/vault-home.ts). What src/main/app.ts hands it, and what it does:
//  - each vault opened: its identity written once, and settings.json's `current` (folder, identity, where it is) — what
//    the former host app and a chat bot read, so every app on this PC uses the one vault Ironleaf has open;
//  - a first start on a PC (nothing opened here yet): the vault found in Documents\Ironleaf or a synced place is opened
//    instead of making a new, empty one beside it;
//  - Settings › Files and links › Your vaults and Your PCs, the warning when this vault is only on this PC and the other
//    PCs use another, the checked move into Documents\Ironleaf (the old folder kept until the person says), a new
//    vault, Export vault and Import vault.

import { app, dialog, type BrowserWindow } from 'electron';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import type { SettingsStore } from './settings';
import { libraryKey } from './library-state';
import type { VaultInfo } from '../shared/types';
import { isoOf } from '../shared/finance';
import { homeWarning, insideOf, moveTargetIn, sameVault, type ExportDone, type HomeMovePlan, type HomeStatus, type HomeVault, type ImportPlan, type ImportProgress, type ImportSummary, type PcEntry } from '../shared/vault-home';
import { isRefusal, type MoveDone, type MoveProgress, type MoveRefusal } from '../shared/vault-place';
import { cleanPcs, ensureIdentity, exportVault, findHomeVaults, homeSpots, importInto, pickFirst, readIdentity, readImport, travellingSettings, undoHomeImport, type FoundHomeVault, type ImportSource } from './vault-home';
import { holdsOnlyOwn, isNewVault, lookAtVault, moveVault, placeOf, planMove, within, type PlaceDeps, type Places } from './vault-place';

export interface HomeServiceDeps {
  host: { kind: string; appId: string; defaultLibrary: string; dataDir: string; version?: string; pcVaults?(): Promise<unknown> };
  settings: SettingsStore;
  places(fresh?: boolean): Promise<Places>;
  /** Made-up synced folders are in use (a development build's checks): the finder may look in them. */
  placesStubbed: boolean;
  placeDeps: PlaceDeps;
  vaultRoot(): string | null;
  library(): string;
  templates(): string;
  ownCounts(): { notes: number; projects: number } | null;
  ownFiles(): Map<string, string>;
  openVault(folder: string): Promise<VaultInfo>;
  useLibrary(folder: string): Promise<VaultInfo>;
  carryLibraryData(from: string, to: string): Promise<void>;
  toTrash(abs: string): Promise<void>;
  /** A note to Recently deleted (an import's Undo: never a permanent delete). */
  trashRel(rel: string): Promise<unknown>;
  canWrite(): Promise<boolean>;
  keepRecovery(rel: string, text: string): Promise<void> | void;
  send(channel: string, payload: unknown): void;
  win(): BrowserWindow | null;
  moving: { get(): boolean; set(v: boolean): void };
  /** The notes were changed outside the editor: read again. */
  rescan(): Promise<void>;
  /** The watcher's file-by-file news held while `run` writes many files (an import); the caller rescans after. */
  holdWatch?<T>(run: () => Promise<T>): Promise<T>;
  log?(message: string): void;
}

const lower = (p: string) => nodePath.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
const same = (a: string, b: string) => lower(a) === lower(b);

export function createVaultHomeService(d: HomeServiceDeps) {
  const documents = () => nodePath.dirname(d.host.defaultLibrary);
  // The home is the default library itself: Documents\Ironleaf, or Documents\NeuralVault where an earlier version's
  // notes already were (src/main/index.ts, defaultLibraryIn).
  const home = () => d.host.defaultLibrary;
  /** "Documents\Ironleaf" as people read it. */
  const homeLabel = () => `Documents${nodePath.sep}${nodePath.basename(home())}`;
  // A development build (the former host app's dev copy, npm run dev) looks only in its own Documents (its profile),
  // never the person's real OneDrive or Dropbox — unless the checks give it made-up synced folders (19 Oct 2026: a dev
  // copy opened the real vault and wrote test notes into it).
  const dev = !app.isPackaged || d.host.appId.endsWith('.dev');
  const mayLookAround = () => !dev || d.placesStubbed;
  // A development build's checks answer Windows' Save and Open windows with these (tools/shots-vault-home.mjs).
  const stubExport = !app.isPackaged ? process.env.NV_EXPORT_PATH : undefined;
  const stubImport = !app.isPackaged ? process.env.NV_IMPORT_PATH : undefined;

  async function spots(fresh = false) {
    const p = await d.places(fresh);
    const all = await homeSpots(documents(), p, d.placeDeps, home());
    return mayLookAround() ? all : all.slice(0, 1);
  }

  let foundCache: { at: number; value: Promise<FoundHomeVault[]> } | null = null;
  function found(fresh = false): Promise<FoundHomeVault[]> {
    if (!fresh && foundCache && Date.now() - foundCache.at < 60000) return foundCache.value;
    foundCache = { at: Date.now(), value: spots(fresh).then((s) => findHomeVaults(s, { templates: d.templates(), timeoutMs: 5000 })).catch(() => []) };
    return foundCache.value;
  }

  // ── Each vault opened ──
  let opening = Promise.resolve();
  function opened(root: string, o: { inPlace?: boolean } = {}): Promise<void> {
    const run = opening.then(async () => {
      // Written once into the library, or a folder of notes of its own; never into a folder inside another vault (a
      // subfolder of the vault opened on its own would otherwise become a vault of its own, kept out of the vault).
      const inside = [d.library(), ...d.settings.raw.recentVaults].some((v) => !same(v, root) && insideOf(nodePath, root, v));
      // A folder opened in place (another app's notes; V12, 28 Oct 2026) is never made a vault of its own.
      const id = (await d.canWrite()) && !inside && !o.inPlace ? await ensureIdentity(root) : await readIdentity(root);
      const name = id?.name || nodePath.basename(root);
      await d.settings.setCurrent({ path: root, id: id?.id ?? null, name, ...(d.settings.raw.current?.path === root ? { place: d.settings.raw.current.place, placeName: d.settings.raw.current.placeName } : {}) });
      // Where it is, once the synced places are known (a moment after start): said too.
      void d.places().then(async (p) => {
        if (d.vaultRoot() !== root) return;
        const place = placeOf(root, p, d.placeDeps);
        await d.settings.setCurrent({ path: root, id: id?.id ?? null, name, place: place.kind, placeName: place.name });
      }, () => undefined);
      foundCache = null;
    });
    opening = run.catch(() => {});
    return run;
  }

  // ── A first start on this PC ──
  /** Nothing was opened on this PC yet, and the library is missing or holds only what Ironleaf itself writes: the vault
   *  found elsewhere is opened instead (true), never a new, empty one beside it. */
  async function firstStart(): Promise<boolean> {
    const s = d.settings.raw;
    if (s.library || s.lastVault || s.recentVaults.length) return false;
    const library = d.library();
    const libraryThere = await fsp.stat(library).then(() => true, () => false);
    const libraryUnused = !libraryThere || (await holdsOnlyOwn(library, d.ownFiles()));
    if (!libraryUnused) return false;
    const all = (await within(found(true), 15000, [] as FoundHomeVault[])).filter((v) => !same(v.path, library) || !libraryUnused);
    const pick = pickFirst(all.filter((v) => !same(v.path, library)), home());
    if (!pick) return false;
    // An Ironleaf vault is adopted as before; a foreign folder opens for a look, never adopted silently
    // (5 Nov 2026, u3 moving-in: first start promoted a stranger's notes to the library unasked).
    const adopted = !!(await readIdentity(pick.path));
    d.log?.(adopted ? `Ironleaf found your vault in ${pick.name} (${pick.path}) and opened it.` : `Ironleaf found notes in ${pick.name} (${pick.path}) and opened them for a look.`);
    if (adopted) await d.useLibrary(pick.path);
    else await d.openVault(pick.path);
    // The new, empty vault the former host app may have made first goes to the Recycle Bin (only when nothing of the
    // person's own is in it).
    if (adopted && libraryThere && !insideOf(nodePath, pick.path, library) && !insideOf(nodePath, library, pick.path) && (await holdsOnlyOwn(library, d.ownFiles()))) await d.toTrash(library).catch(() => {});
    return true;
  }

  // ── Settings › Files and links ──
  async function pcs(): Promise<PcEntry[] | null> {
    if (!d.host.pcVaults) return null;
    return within(
      d.host.pcVaults().then((raw) => cleanPcs(raw)),
      5000,
      null,
    );
  }

  async function status(fresh = false): Promise<HomeStatus> {
    const p = await d.places(fresh);
    const h = home();
    const cur = d.settings.raw.current && d.vaultRoot() && same(d.settings.raw.current.path, d.vaultRoot()!) ? d.settings.raw.current : null;
    const current = cur ? { path: cur.path, id: cur.id, name: cur.name } : d.vaultRoot() ? { path: d.vaultRoot()!, id: (await readIdentity(d.vaultRoot()!))?.id ?? null, name: nodePath.basename(d.vaultRoot()!) } : null;
    const [list, others] = await Promise.all([found(fresh), pcs()]);
    const vaults: HomeVault[] = [];
    const add = async (path: string, known?: FoundHomeVault) => {
      if (vaults.some((v) => same(v.path, path))) return;
      const real = await fsp.realpath(path).catch(() => null);
      if (!real) return;
      if (vaults.some((v) => same(v.path, real))) return;
      const id = known ? { id: known.id, name: known.vaultName } : await readIdentity(path).then((x) => ({ id: x?.id ?? null, name: x?.name || nodePath.basename(path) }));
      const counts = known ?? (await within(lookAtVault(path, { templates: d.templates() }), 4000, null));
      vaults.push({
        path,
        name: id.name || nodePath.basename(path),
        id: id.id,
        notes: counts?.notes ?? 0,
        projects: counts?.projects ?? 0,
        place: placeOf(path, p, d.placeDeps),
        open: !!d.vaultRoot() && same(d.vaultRoot()!, path),
        library: same(d.library(), path),
        inHome: insideOf(nodePath, path, h),
        pcs: (others ?? []).filter((pc) => !pc.me && pc.vault && sameVault(pc.vault, { id: id.id, path })).map((pc) => pc.name),
      });
    };
    if (d.vaultRoot()) await add(d.vaultRoot()!);
    await add(d.library()).catch(() => undefined);
    for (const v of list) await add(v.path, v);
    for (const r of d.settings.raw.recentVaults.slice(0, 6)) await add(r).catch(() => undefined);
    // Open first, then the library, then the home's, then most notes.
    vaults.sort((a, b) => Number(b.open) - Number(a.open) || Number(b.library) - Number(a.library) || Number(b.inHome) - Number(a.inHome) || b.notes - a.notes);
    const homeHoldsVault = list.some((v) => same(v.path, h)) || !!(await readIdentity(h));
    const moveTo = current ? moveTargetIn(h, current.path, homeHoldsVault && !same(current.path, h), nodePath) : null;
    const place = current ? placeOf(current.path, p, d.placeDeps) : { kind: 'local' as const, name: 'this PC', words: '' };
    const warn = homeWarning({ place, current, pcs: others, now: Date.now(), vaults: vaults.map((v) => ({ path: v.path, id: v.id, name: v.name })), moveTo, homeLabel: homeLabel() });
    const dismissed = !!current && d.settings.homeDismissed(current.id || current.path);
    return { home: h, homePlace: placeOf(h, p, d.placeDeps), current, vaults, pcs: others, warning: warn && !dismissed ? warn : null, oldFolders: d.settings.raw.homeOld ?? [], moveTo };
  }

  // ── Opening one of them ──
  /** Adopting a folder as the library: an Ironleaf vault is adopted straight away; a foreign folder is asked about
   *  first (5 Nov 2026, u3 moving-in: choosing it wrote settings, templates and repairs before a word was said) —
   *  adopt, browse it as it is, or cancel. One honest line, every adopting door (Your vaults, Files and links, the
   *  found card) reads it. */
  async function confirmAdopt(folder: string): Promise<'adopt' | 'browse' | null> {
    if (await readIdentity(folder)) return 'adopt';
    const w = d.win();
    if (!w) return 'browse';
    const r = await dialog.showMessageBox(w, {
      type: 'question',
      title: 'Make it your vault?',
      message: `Make “${nodePath.basename(folder)}” your vault?`,
      detail: 'Ironleaf will keep its settings, templates and recovering files in this folder. Your notes stay as they are. Nothing is renamed, moved or rewritten.',
      buttons: ['Make it my vault', 'Just browse', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    return r.response === 0 ? 'adopt' : r.response === 1 ? 'browse' : null;
  }

  async function openListed(folder: unknown): Promise<VaultInfo | null> {
    if (typeof folder !== 'string' || !nodePath.isAbsolute(folder)) throw new Error('Unknown folder.');
    if (d.moving.get()) throw new Error('Your vault is moving.');
    const st = await status();
    const v = st.vaults.find((x) => same(x.path, folder)) ?? (st.warning?.openHere && same(st.warning.openHere.path, folder) ? { path: folder } : null);
    if (!v) throw new Error('That vault isn’t on this PC any more.');
    const choice = await confirmAdopt(v.path);
    if (!choice) return null;
    const info = choice === 'adopt' ? await d.useLibrary(v.path) : await d.openVault(v.path);
    foundCache = null;
    return info;
  }

  // ── Moving the vault open now into Documents\Ironleaf (the old folder kept until confirmed) ──
  let pendingPlan: { from: string; to: string } | null = null;
  async function planHomeMove(): Promise<HomeMovePlan | MoveRefusal> {
    if (d.moving.get()) throw new Error('Your vault is already moving.');
    const st = await status(true);
    if (!st.current || !st.moveTo) throw new Error(`Your vault is in ${homeLabel()} already.`);
    const to = st.moveTo;
    await fsp.mkdir(nodePath.dirname(to), { recursive: true });
    // It goes inside Documents\Ironleaf: it says it is a vault of its own first, so the vault there keeps it apart.
    if (!(await readIdentity(st.current.path)) && !(await ensureIdentity(st.current.path))) throw new Error('Ironleaf can’t write in your vault’s folder, so it can’t be moved.');
    const plan = await planMove(st.current.path, nodePath.dirname(to), homeLabel(), { templates: d.templates(), name: nodePath.basename(to) });
    if (isRefusal(plan)) {
      pendingPlan = null;
      return plan;
    }
    pendingPlan = { from: plan.from, to: plan.to };
    return { from: plan.from, to: plan.to, files: plan.files, bytes: plan.bytes };
  }

  async function homeMove(): Promise<MoveDone> {
    const planned = pendingPlan;
    if (!planned) throw new Error('Choose to move your vault first.');
    if (d.moving.get()) throw new Error('Your vault is already moving.');
    pendingPlan = null;
    d.moving.set(true);
    try {
      const wasLibrary = same(planned.from, d.library());
      const plan = { from: planned.from, to: planned.to, label: homeLabel(), files: 0, bytes: 0 };
      const reopen = async (folder: string) => {
        if (wasLibrary) await d.useLibrary(folder);
        else await d.openVault(folder);
      };
      const done = await moveVault(plan, {
        onProgress: (pr: MoveProgress) => d.send('place:progress', pr),
        switchTo: async (dest) => {
          await d.carryLibraryData(plan.from, dest);
          await reopen(dest);
        },
        switchBack: async (from) => {
          await reopen(from);
        },
        // No trash: the old folder is kept until the person says it can go.
      });
      await d.settings.keepOldFolder({ from: plan.from, to: done.path });
      await d.settings.forgetVault(plan.from);
      foundCache = null;
      const at = d.vaultRoot() ?? done.path;
      return { path: at, trashed: false, words: `Your vault is now in ${homeLabel()}, at ${at}, and every file was checked. The old folder is still at ${plan.from}: once you’re happy everything is here, put it in the Bin from Settings › Files and links.` };
    } finally {
      d.moving.set(false);
    }
  }

  async function oldFolder(from: unknown, action: unknown): Promise<string> {
    if (typeof from !== 'string' || (action !== 'trash' && action !== 'keep')) throw new Error('Unknown folder.');
    const entry = (d.settings.raw.homeOld ?? []).find((x) => same(x.from, from));
    if (!entry) throw new Error('That folder isn’t waiting any more.');
    if (action === 'keep') {
      await d.settings.keepOldFolder(null, entry.from);
      return `The old folder stays at ${entry.from}. Ironleaf won’t ask about it again.`;
    }
    // Never the vault open now, or one inside it.
    if (d.vaultRoot() && (insideOf(nodePath, d.vaultRoot()!, entry.from) || insideOf(nodePath, entry.from, d.vaultRoot()!))) throw new Error('That folder holds the vault open now, so it stays.');
    const there = await fsp.stat(entry.from).then(() => true, () => false);
    if (there) await d.toTrash(entry.from);
    await d.settings.keepOldFolder(null, entry.from);
    return there ? `The old folder is in the Bin, if you ever need it.` : 'The old folder was already gone.';
  }

  // ── A new vault ──
  async function newVault(name: unknown, choose: unknown): Promise<VaultInfo | null> {
    if (d.moving.get()) throw new Error('Your vault is moving.');
    const clean = typeof name === 'string' ? name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) : '';
    if (!clean) throw new Error('Give the new vault a name.');
    let parent = home();
    if (choose === true) {
      const w = d.win();
      const r = w ? await dialog.showOpenDialog(w, { title: `Choose where “${clean}” goes`, buttonLabel: 'Make it here', properties: ['openDirectory', 'createDirectory'] }) : null;
      if (!r || r.canceled || !r.filePaths[0]) return null;
      parent = r.filePaths[0];
      // Somewhere only on this PC while Documents\Ironleaf is synced: said plainly, with the standard place offered.
      const p = await d.places();
      const where = placeOf(parent, p, d.placeDeps);
      const homePlace = placeOf(home(), p, d.placeDeps);
      if (where.kind === 'local' && homePlace.kind !== 'local' && w) {
        const ask = await dialog.showMessageBox(w, {
          type: 'warning',
          title: 'Only on this PC',
          message: 'Only on this PC: your other PCs won’t see it.',
          detail: `${parent} isn’t synced, so “${clean}” would stay on this PC and nobody would back it up. ${homeLabel()} is synced with ${homePlace.name}.`,
          buttons: [`Put it in ${homeLabel()}`, 'Use this folder anyway', 'Cancel'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
        if (ask.response === 2) return null;
        if (ask.response === 0) parent = home();
      }
    }
    const homeHasVault = !!(await readIdentity(home())) || (await lookAtVault(home(), { templates: d.templates() })).isVault;
    // The first vault in an empty Documents\Ironleaf is the home itself only when asked for by its own name; else a
    // folder inside it, by its name.
    const target = same(parent, home()) && !homeHasVault && clean === nodePath.basename(home()) ? home() : nodePath.join(parent, clean);
    const look = await lookAtVault(target, { templates: d.templates() });
    if (look.exists && !look.empty) throw new Error(`There’s already a folder called “${clean}” there. Choose another name.`);
    await fsp.mkdir(target, { recursive: true });
    await ensureIdentity(target, clean);
    const info = await d.useLibrary(target);
    foundCache = null;
    return info;
  }

  // ── Export and import ──
  const progress = (p: ImportProgress) => d.send('home:progress', p);
  async function exportNow(): Promise<ExportDone | null> {
    const root = d.vaultRoot();
    if (!root) throw new Error('Ironleaf’s notes are not open yet.');
    const w = d.win();
    const id = await readIdentity(root);
    const day = isoOf(new Date());
    const name = `${(id?.name || nodePath.basename(root)).replace(/[<>:"/\\|?*]/g, ' ')} export ${day}.zip`;
    const r = stubExport ? { canceled: false, filePath: stubExport } : w ? await dialog.showSaveDialog(w, { title: 'Export vault', defaultPath: nodePath.join(os.homedir(), name), buttonLabel: 'Export', filters: [{ name: 'Zip file', extensions: ['zip'] }] }) : null;
    if (!r || r.canceled || !r.filePath) return null;
    return exportTo(r.filePath.toLowerCase().endsWith('.zip') ? r.filePath : `${r.filePath}.zip`);
  }

  async function exportTo(file: string): Promise<ExportDone> {
    const root = d.vaultRoot();
    if (!root) throw new Error('Ironleaf’s notes are not open yet.');
    const library: Record<string, string> = {};
    const dir = nodePath.join(d.host.dataDir, 'libraries', libraryKey(root));
    for (const n of await fsp.readdir(dir).catch(() => [] as string[])) if (/^[a-z]+\.json$/.test(n)) library[n] = await fsp.readFile(nodePath.join(dir, n), 'utf8');
    return exportVault(root, file, { settings: travellingSettings(d.settings.raw), library, identity: await readIdentity(root), version: d.host.version ?? '' }, progress);
  }

  let pendingImport: ImportSource | null = null;
  /** An import merging now (F3): the screen's Stop flips `stopped`; the merge finishes its file and returns. */
  let importing: { stopped: boolean } | null = null;
  async function pickImport(kind: unknown, given?: unknown): Promise<ImportPlan | null> {
    const root = d.vaultRoot();
    if (!root) throw new Error('Ironleaf’s notes are not open yet.');
    let source = typeof given === 'string' && nodePath.isAbsolute(given) && !app.isPackaged ? given : stubImport && kind === (stubImport.toLowerCase().endsWith('.zip') ? 'zip' : 'folder') ? stubImport : null;
    if (!source) {
      const w = d.win();
      const r = w ? await dialog.showOpenDialog(w, kind === 'zip' ? { title: 'Import a vault export', buttonLabel: 'Import', properties: ['openFile'], filters: [{ name: 'Zip file', extensions: ['zip'] }] } : { title: 'Import a folder of notes', buttonLabel: 'Import', properties: ['openDirectory'] }) : null;
      if (!r || r.canceled || !r.filePaths[0]) return null;
      source = r.filePaths[0];
    }
    await pendingImport?.done();
    pendingImport = null;
    const tempDir = nodePath.join(d.host.dataDir, 'import-temp');
    pendingImport = await readImport(source, root, { tempDir, onProgress: progress });
    return pendingImport.plan;
  }

  async function importNow(): Promise<ImportSummary> {
    const src = pendingImport;
    const root = d.vaultRoot();
    if (!src || !root) throw new Error('Choose what to import first.');
    pendingImport = null;
    importing = { stopped: false };
    try {
      const counts = d.ownCounts();
      const hold = d.holdWatch ?? (<T,>(run: () => Promise<T>) => run());
      const signal = importing;
      const summary = await hold(async () => {
        const merged = await importInto(root, src, {
        targetIsNew: isNewVault(counts),
        beforeChange: (rel, before) => d.keepRecovery(rel, before),
        applySettings: async (settings, library) => {
          const s = settings as { prefs?: unknown; dailyFolder?: unknown; dailyFormat?: unknown; dailyTemplate?: unknown };
          const patch: Record<string, unknown> = {};
          if (s.prefs && typeof s.prefs === 'object') patch.prefs = s.prefs;
          for (const k of ['dailyFolder', 'dailyFormat', 'dailyTemplate'] as const) if (typeof s[k] === 'string') patch[k] = s[k];
          await d.settings.update(patch as never).catch(() => undefined);
          const dir = nodePath.join(d.host.dataDir, 'libraries', libraryKey(root));
          await fsp.mkdir(dir, { recursive: true });
          for (const [n, json] of Object.entries(library)) await fsp.writeFile(nodePath.join(dir, n), json, 'utf8').catch(() => undefined);
        },
        onProgress: progress,
        signal,
        });
        // Read once, still inside the hold: one announcement at the end. Nothing else is rewritten for what came in
        // (20 Nov 2026: the relations seam used to write the imported notes' links back into them and into templates).
        await d.rescan();
        return merged;
      });
      // A vault that took its identity from the export: said so to the former host app and a chat
      // bot.
      await opened(root);
      return summary;
    } finally {
      importing = null;
      await src.done();
    }
  }

  async function cancelImport(): Promise<void> {
    // Stopping a merge in flight (F3): the merge finishes its file, keeps what came in, and says it stopped.
    if (importing) importing.stopped = true;
    await pendingImport?.done();
    pendingImport = null;
  }

  /** One Undo for a folder/vault import: everything it made to the Bin, every note it combined restored. */
  async function undoImportNow(id: unknown): Promise<{ words: string; notes: number; files: number; restored: number; left: string[] }> {
    const root = d.vaultRoot();
    if (!root || typeof id !== 'string') throw new Error('That import is not there any more.');
    const back = await undoHomeImport(root, id, { trash: (rel) => d.trashRel(rel), beforeChange: (rel, before) => d.keepRecovery(rel, before) });
    await d.rescan();
    d.log?.(`Undid bringing a folder in: ${back.words}`);
    return back;
  }

  function register(handle: (channel: string, fn: (...args: any[]) => unknown) => void): void {
    handle('home:status', (fresh: unknown) => status(fresh === true));
    handle('home:open', (folder: unknown) => openListed(folder));
    handle('home:plan-move', () => planHomeMove());
    handle('home:move', () => homeMove());
    handle('home:old-folder', (from: unknown, action: unknown) => oldFolder(from, action));
    handle('home:dismiss', async () => {
      const c = d.settings.raw.current;
      if (c) await d.settings.dismissHome(c.id || c.path);
    });
    handle('home:new-vault', (name: unknown, choose: unknown) => newVault(name, choose));
    handle('home:export', (file: unknown) => (typeof file === 'string' && nodePath.isAbsolute(file) && !app.isPackaged ? exportTo(file) : exportNow()));
    handle('home:import-pick', (kind: unknown, given: unknown) => pickImport(kind, given));
    handle('home:import', () => importNow());
    handle('home:import-cancel', () => cancelImport());
    handle('home:import-undo', (id: unknown) => undoImportNow(id));
  }

  return { opened, firstStart, status, register, found, confirmAdopt };
}
