// Notes from another app, in the running Ironleaf (V9, 28 Oct 2026; the engine in ./engine.ts): Settings › Files and
// links › Import… › From another app, and the Paired sources list under it. The person picks the app, then its export
// (Windows' own file or folder window), sees what will come in, and brings it in; a source brought in before shows when
// and how many notes, and "Bring in again" takes a newer export of it through the same three-way rules. A note changed
// both here and in the app shows its two versions side by side.

import { app, dialog, type BrowserWindow } from 'electron';
import nodePath from 'node:path';
import { SOURCE_APPS, SOURCE_HOW, SOURCE_KINDS, type FileKind, type LiveKind, type PairListed, type PairPlan, type PairProgress, type PairSummary } from '../../shared/pairing/types';
import { disconnectPair, importSource, listPairs, readCheck, readConflict, readSource, setPairPaused, undoImport, type PairSource } from './engine';
import { syncLive } from './live';
import type { FetchFn } from './notion-live';

export interface PairingDeps {
  dataDir: string;
  vaultRoot(): string | null;
  win(): BrowserWindow | null;
  daily(): { folder: string; format: string };
  /** The licence allows writing (read-only before one). */
  requireCreate(): Promise<void>;
  keepRecovery(rel: string, text: string): Promise<void> | void;
  /** A note, file or folder to Recently deleted (Undo's door: never a permanent delete). */
  trashPath(rel: string): Promise<unknown>;
  rescan(): Promise<void>;
  /** The watcher's file-by-file news held while `run` writes many notes (an import); rescan after. */
  holdWatch?<T>(run: () => Promise<T>): Promise<T>;
  log?(message: string): void;
  /** The app's secret store on this PC (Electron's protected store): live tokens live here and nowhere else.
   *  Absent only where the host keeps keys itself; then live pairing says so plainly. */
  tokens?: { get(id: string): string | undefined; set(id: string, token: string): Promise<void>; remove(id: string): Promise<void> };
  /** How a live source is reached (the tests stand in their own servers; the app uses the real addresses). */
  fetchFn?: FetchFn;
  liveBase?: Partial<Record<LiveKind, string>>;
}

const KINDS: FileKind[] = SOURCE_KINDS;

export function createPairing(d: PairingDeps) {
  const hold = <T,>(run: () => Promise<T>): Promise<T> => (d.holdWatch ? d.holdWatch(run) : run());
  let pending: PairSource | null = null;
  /** An import running now (F1): the screen's Stop flips `stopped`; the engine finishes its note and returns. */
  let bringing: { stopped: boolean } | null = null;
  /** Progress as it goes (F1): the screen's bar listens on `pair:progress`. */
  const progress = (p: PairProgress): void => {
    const w = d.win();
    if (w && !w.isDestroyed()) w.webContents.send('pair:progress', p);
  };
  // A development build's checks pick without Windows' window (NV_PAIR_PATH), as Import vault's do.
  const stub = !app.isPackaged ? process.env.NV_PAIR_PATH : undefined;

  async function pick(kind: unknown, mode: unknown, given?: unknown): Promise<PairPlan | null> {
    const root = d.vaultRoot();
    if (!root) throw new Error('Ironleaf’s notes are not open yet.');
    if (!KINDS.includes(kind as FileKind)) throw new Error('Choose which app the notes come from.');
    const k = kind as FileKind;
    const how = SOURCE_HOW[k];
    const folder = mode === 'folder' || (mode !== 'file' && how.pick === 'folder');
    let source = typeof given === 'string' && nodePath.isAbsolute(given) && !app.isPackaged ? given : stub ?? null;
    if (!source) {
      const w = d.win();
      const title = `Bring in from ${SOURCE_APPS[k]}`;
      const r = w ? await dialog.showOpenDialog(w, folder ? { title, buttonLabel: 'Choose', properties: ['openDirectory'] } : { title, buttonLabel: 'Choose', properties: ['openFile'], filters: [{ name: how.what, extensions: how.extensions }] }) : null;
      if (!r || r.canceled || !r.filePaths[0]) return null;
      source = r.filePaths[0];
    }
    await pending?.done();
    pending = null;
    pending = await readSource(source, root, { kind: k, tempDir: nodePath.join(d.dataDir, 'import-temp') });
    return pending.plan;
  }

  async function bring(): Promise<PairSummary> {
    const src = pending;
    const root = d.vaultRoot();
    if (!src || !root) throw new Error('Choose what to bring in first.');
    pending = null;
    bringing = { stopped: false };
    try {
      await d.requireCreate();
      // The plan was shown by pick: its check confirms the bring, whatever its size.
      const summary = await hold(async () => {
        const brought = await importSource(root, src, { daily: d.daily(), beforeChange: (rel, before) => d.keepRecovery(rel, before), onProgress: progress, signal: bringing ?? undefined, confirmed: readCheck(src.plan, src.read) });
        // Brought in as they were: no back-writes into them or other notes (20 Nov 2026).
        await d.rescan();
        return brought;
      });
      d.log?.(`Brought in from ${summary.app}: ${summary.words}`);
      return summary;
    } finally {
      bringing = null;
      await src.done();
    }
  }

  async function cancel(): Promise<void> {
    // Stopping an import in flight (F1): the engine finishes its note, keeps what came in, and says it stopped.
    if (bringing) bringing.stopped = true;
    await pending?.done();
    pending = null;
  }

  async function list(): Promise<PairListed[]> {
    const root = d.vaultRoot();
    return root ? listPairs(root) : [];
  }

  async function compare(rel: unknown, copy: unknown): Promise<{ mine: string; theirs: string }> {
    const root = d.vaultRoot();
    if (!root || typeof rel !== 'string' || typeof copy !== 'string') throw new Error('Unknown note.');
    return readConflict(root, rel, copy);
  }

  const LIVE: LiveKind[] = ['notion', 'todoist'];
  const tokenId = (kind: LiveKind) => `pair-${kind}`;
  const liveKind = (kind: unknown): LiveKind => {
    if (!LIVE.includes(kind as LiveKind)) throw new Error('Choose Notion or Todoist.');
    return kind as LiveKind;
  };

  /** Whether each live source has a token saved on this PC (never the token itself). */
  async function liveStatus(): Promise<Record<LiveKind, boolean>> {
    return { notion: !!d.tokens?.get(tokenId('notion')), todoist: !!d.tokens?.get(tokenId('todoist')) };
  }

  /** Save the person's token in the secret store, then sync once so they see it work. */
  async function liveConnect(kind: unknown, token: unknown): Promise<PairSummary> {
    const k = liveKind(kind);
    const root = d.vaultRoot();
    if (!root) throw new Error('Ironleaf’s notes are not open yet.');
    if (!d.tokens) throw new Error('This copy of Ironleaf cannot keep tokens safely, so live pairing is off here. You can still bring in an export.');
    const value = typeof token === 'string' ? token.trim() : '';
    if (!value || value.length > 4096 || /[\u0000-\u001f]/.test(value)) throw new Error('Paste the whole token, with nothing around it.');
    await d.requireCreate();
    await d.tokens.set(tokenId(k), value);
    return liveSync(k);
  }

  async function liveSync(kind: unknown, confirmed?: unknown): Promise<PairSummary> {
    const k = liveKind(kind);
    const root = d.vaultRoot();
    if (!root) throw new Error('Ironleaf’s notes are not open yet.');
    const token = d.tokens?.get(tokenId(k));
    if (!token) throw new Error(k === 'notion' ? 'Connect Notion first: paste your integration token.' : 'Connect Todoist first: paste your API token.');
    await d.requireCreate();
    bringing = { stopped: false };
    try {
      const summary = await hold(async () => {
        const synced = await syncLive(root, k, token, { daily: d.daily(), beforeChange: (rel, before) => d.keepRecovery(rel, before), onProgress: progress, signal: bringing ?? undefined, ...(typeof confirmed === 'string' && confirmed ? { confirmed } : {}), ...(d.fetchFn ? { fetchFn: d.fetchFn } : {}), ...(d.liveBase?.[k] ? { base: d.liveBase[k] } : {}) });
        if (!synced.held) await d.rescan();
        return synced;
      });
      d.log?.(summary.held ? `Held from ${summary.app}: ${summary.words}` : `Kept in step with ${summary.app}: ${summary.words}`);
      return summary;
    } finally {
      bringing = null;
    }
  }

  /** End a live pairing: the token goes from the secret store, the notes stay exactly as they are. */
  async function liveDisconnect(kind: unknown): Promise<void> {
    const k = liveKind(kind);
    const root = d.vaultRoot();
    if (root) {
      const pair = (await listPairs(root)).find((p) => p.live && p.kind === k);
      if (pair) await disconnectPair(root, pair.id);
    }
    await d.tokens?.remove(tokenId(k));
  }

  async function setPaused(id: unknown, paused: unknown): Promise<void> {
    const root = d.vaultRoot();
    if (!root || typeof id !== 'string') throw new Error('That pairing is not there any more.');
    await setPairPaused(root, id, paused === true);
  }

  async function disconnect(id: unknown): Promise<void> {
    const root = d.vaultRoot();
    if (!root || typeof id !== 'string') throw new Error('That pairing is not there any more.');
    const pair = (await listPairs(root)).find((p) => p.id === id);
    await disconnectPair(root, id);
    if (pair?.live && (pair.kind === 'notion' || pair.kind === 'todoist')) await d.tokens?.remove(tokenId(pair.kind));
  }

  /** One Undo for a pair's last run: everything it made to the Bin, everything it changed restored. */
  async function undo(id: unknown): Promise<{ words: string; notes: number; files: number; restored: number; left: string[] }> {
    const root = d.vaultRoot();
    if (!root || typeof id !== 'string') throw new Error('That pairing is not there any more.');
    await d.requireCreate();
    const back = await undoImport(root, id, { trash: (rel) => d.trashPath(rel) });
    await d.rescan();
    d.log?.(`Undid a bringing-in: ${back.words}`);
    return back;
  }

  function register(handle: (channel: string, fn: (...args: any[]) => unknown) => void): void {
    handle('pair:pick', (kind: unknown, mode: unknown, given: unknown) => pick(kind, mode, given));
    handle('pair:import', () => bring());
    handle('pair:cancel', () => cancel());
    handle('pair:list', () => list());
    handle('pair:compare', (rel: unknown, copy: unknown) => compare(rel, copy));
    handle('pair:undo', (id: unknown) => undo(id));
    handle('pair:live-status', () => liveStatus());
    handle('pair:live-connect', (kind: unknown, token: unknown) => liveConnect(kind, token));
    handle('pair:live-sync', (kind: unknown, confirmed: unknown) => liveSync(kind, confirmed));
    handle('pair:live-disconnect', (kind: unknown) => liveDisconnect(kind));
    handle('pair:set-paused', (id: unknown, paused: unknown) => setPaused(id, paused));
    handle('pair:disconnect', (id: unknown) => disconnect(id));
  }

  return { register, liveStatus, liveConnect, liveSync, liveDisconnect };
}
