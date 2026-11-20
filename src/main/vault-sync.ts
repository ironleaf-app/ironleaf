// This PC's sync state for the open vault, and the fixes (24 Oct 2026, WS1 step 0; the words are in
// src/shared/vault-sync.ts). Everything here runs as the person, never with admin rights:
//  - each PC that opens the vault writes .neuralvault/pcs/<its id>.json (its name, when) at open and every ten minutes;
//    the others' files arrive through the same sync as the notes, so "Up to date with Office-PC" is what came through;
//  - OneDrive running: Windows' task list (tasklist);
//  - OneDrive paused or stuck: this PC's own file still waiting to go up minutes after it was written (the Shell's
//    System.StorageProviderState: 4 waiting to upload, 10 waiting, 6 moving, 7 a problem);
//  - files only in the cloud: the offline attribute (dir /a:o) that OneDrive's Files On-Demand sets with
//    FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS on a file not downloaded;
//  - conflict copies: by their names (src/shared/vault-sync.ts findConflictCopies);
//  - the fixes: start OneDrive (from where it says it is installed), keep the whole vault on this PC (attrib +P -U:
//    "Always keep on this device"), merge a conflict copy into its note (src/shared/vault-merge.ts, every line kept; the
//    copy to Recently deleted) or keep both under a name that says whose it is.
// A development build's checks give made-up Windows facts in NV_SYNC_STUB (tools/shots-vault-sync.mjs).

import { execFile, spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import type { PcEntry } from '../shared/vault-home';
import { ID_DIR } from '../shared/vault-home';
import { mergeNote, sameText } from '../shared/vault-merge';
import { isSystemsTableText, mergeSystemsTables } from '../shared/system-tables';
import { isBillsTableText, mergeBillsTables } from '../shared/bills-table';
import { findConflictCopies, keptName, syncView, type ConflictCopy, type OtherPc, type SyncFacts, type SyncFixDone, type SyncView } from '../shared/vault-sync';
import { vaultFiles } from './vault-home';

export const PCS_DIR = `${ID_DIR}/pcs`;
const BEAT_MS = 10 * 60_000;
const CACHE_MS = 60_000;
const PROBE_MS = 90_000;

/** Made-up Windows facts for a development build's checks. */
interface SyncStub {
  windows?: boolean;
  running?: boolean;
  /** Files only in the cloud (paths in the vault). */
  offline?: string[];
  /** This PC's own file's state (System.StorageProviderState) and how many minutes ago it was written. */
  state?: number;
  minutes?: number;
  /** What the fixes did, written here instead of running anything. */
  log?: string;
}

export interface SyncDeps {
  root(): string | null;
  device: { id: string; name: string };
  version: string;
  identityId(root: string): Promise<string | null>;
  place(root: string): Promise<{ kind: string; name: string }>;
  pcs(): Promise<PcEntry[] | null>;
  mayWrite(): Promise<boolean>;
  readNote(rel: string): Promise<string>;
  writeNote(rel: string, text: string): Promise<void>;
  trash(rel: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  rescan(): Promise<void>;
  /** A development build's made-up Windows facts (NV_SYNC_STUB): a file path. */
  stub?: string;
  platform?: NodeJS.Platform;
  now?(): number;
  log?(message: string): void;
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv, timeout = 20_000): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...env } }, (err, stdout) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout ?? '') });
    });
  });
}

/** The person's PCs' names that OneDrive puts in a conflict copy's name. */
function pcNames(device: { name: string }, others: OtherPc[], pcs: PcEntry[] | null): string[] {
  return [device.name, os.hostname(), ...others.map((o) => o.name), ...(pcs ?? []).map((p) => p.name)].filter(Boolean);
}

export function createVaultSync(d: SyncDeps) {
  const now = () => d.now?.() ?? Date.now();
  const platform = d.platform ?? process.platform;
  let cache: { root: string; at: number; view: Promise<SyncView> } | null = null;
  let probe: { root: string; at: number; value: Promise<Pick<SyncFacts, 'oneDrive' | 'cloudOnly' | 'windows'>> } | null = null;
  let timer: NodeJS.Timeout | null = null;
  /** When this PC's own file was first found still waiting to go up (null: it went up). */
  let pendingSince: number | null = null;
  /** When the person chose Keep on this PC, for which vault (the files only in the cloud are then on their way). */
  let keepAsked: { root: string; at: number } | null = null;

  async function stub(): Promise<SyncStub | null> {
    if (!d.stub) return null;
    try {
      return JSON.parse(await fsp.readFile(d.stub, 'utf8')) as SyncStub;
    } catch {
      return null;
    }
  }
  const myFile = (root: string) => nodePath.join(root, ...PCS_DIR.split('/'), `${d.device.id}.json`);

  /** This PC says it has the vault open (its file in .neuralvault/pcs). */
  async function beat(): Promise<void> {
    const root = d.root();
    if (!root || !(await d.mayWrite().catch(() => false))) return;
    const file = myFile(root);
    const text = `${JSON.stringify({ id: d.device.id, name: d.device.name, at: new Date(now()).toISOString(), version: d.version }, null, 1)}\n`;
    try {
      await fsp.mkdir(nodePath.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.nvtmp`;
      await fsp.writeFile(temp, text, 'utf8');
      await fsp.rename(temp, file);
    } catch (err) {
      d.log?.(`Ironleaf could not say this PC has the vault open: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** The other PCs that had this vault open, from their files (a conflict copy of one is left out; the newest of a name). */
  async function othersOf(root: string, pcs: PcEntry[] | null, vaultId: string | null): Promise<OtherPc[]> {
    const dir = nodePath.join(root, ...PCS_DIR.split('/'));
    const byName = new Map<string, OtherPc>();
    for (const n of await fsp.readdir(dir).catch(() => [] as string[])) {
      if (!/^[0-9a-f-]{36}\.json$/i.test(n) || n.toLowerCase() === `${d.device.id}.json`) continue;
      try {
        const v = JSON.parse(await fsp.readFile(nodePath.join(dir, n), 'utf8')) as { name?: unknown; at?: unknown };
        const name = typeof v.name === 'string' ? v.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) : '';
        const at = typeof v.at === 'string' ? Date.parse(v.at) : NaN;
        if (!name || !Number.isFinite(at)) continue;
        // The same PC under a new id (Ironleaf set up again): its newest.
        if (name.toLowerCase() === d.device.name.toLowerCase()) continue;
        const pc = (pcs ?? []).find((p) => !p.me && p.name.toLowerCase() === name.toLowerCase());
        const entry: OtherPc = { name, at, online: pc ? pc.online : null, sameVault: pc?.vault ? (pc.vault.id && vaultId ? pc.vault.id === vaultId : pc.vault.name === nodePath.basename(root)) : null };
        const have = byName.get(name.toLowerCase());
        if (!have || have.at < at) byName.set(name.toLowerCase(), entry);
      } catch {
        // Half arrived: read next time.
      }
    }
    return [...byName.values()];
  }

  /** Windows' facts: OneDrive running, this PC's own file gone up, files only in the cloud. */
  function windowsFacts(root: string, place: { kind: string }): Promise<Pick<SyncFacts, 'oneDrive' | 'cloudOnly' | 'windows'>> {
    if (probe && probe.root === root && now() - probe.at < PROBE_MS) return probe.value;
    const value = (async (): Promise<Pick<SyncFacts, 'oneDrive' | 'cloudOnly' | 'windows'>> => {
      const s = await stub();
      const windows = s?.windows ?? platform === 'win32';
      if (!windows) return { windows: false, oneDrive: null, cloudOnly: null };
      // Files only in the cloud.
      let offline: string[] = [];
      if (s) offline = s.offline ?? [];
      else {
        const r = await run('cmd.exe', ['/d', '/c', 'dir', '/s', '/b', '/a:o-d', root], undefined, 30_000);
        offline = r.stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .map((abs) => nodePath.relative(root, abs).split(nodePath.sep).join('/'))
          .filter((rel) => rel && !rel.startsWith('..') && !/^\.git(\/|$)/.test(rel));
      }
      const cloudOnly = { count: offline.length, notes: offline.filter((r) => /\.(md|markdown)$/i.test(r)).length, sample: offline.slice(0, 8) };
      if (place.kind !== 'onedrive') return { windows, oneDrive: null, cloudOnly };
      // OneDrive running.
      let running: boolean | null = null;
      if (s) running = s.running ?? true;
      else {
        const r = await run('tasklist.exe', ['/FI', 'IMAGENAME eq OneDrive.exe', '/NH', '/FO', 'CSV']);
        running = r.code === 0 ? /"onedrive\.exe"/i.test(r.stdout) : null;
      }
      // This PC's own file: gone up, or still waiting.
      let pendingMinutes: number | null = null;
      let error = false;
      if (running) {
        if (s) {
          if (s.state !== undefined && [4, 6, 10].includes(s.state)) pendingMinutes = s.minutes ?? 0;
          error = s.state === 7;
        } else {
          const file = myFile(root);
          const st = await fsp.stat(file).catch(() => null);
          if (st) {
            const script = "$f=$env:NV_SYNC_FILE;$sh=New-Object -ComObject Shell.Application;$it=$sh.Namespace([IO.Path]::GetDirectoryName($f)).ParseName([IO.Path]::GetFileName($f));if($it){[string]$it.ExtendedProperty('System.StorageProviderState')}";
            const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { NV_SYNC_FILE: file });
            const state = Number(r.stdout.trim());
            // Waiting since the first look that found it waiting (this PC writes its file again every ten minutes, so
            // the file's own time would start again each time).
            if ([4, 6, 10].includes(state)) {
              pendingSince = Math.min(pendingSince ?? st.mtimeMs, st.mtimeMs);
              pendingMinutes = Math.floor((now() - pendingSince) / 60_000);
            } else if (r.stdout.trim()) pendingSince = null;
            error = state === 7;
          }
        }
      }
      return { windows, oneDrive: { running, pendingMinutes, error }, cloudOnly };
    })().catch((err) => {
      d.log?.(`Ironleaf could not look at how the vault syncs: ${err instanceof Error ? err.message : String(err)}`);
      return { windows: false, oneDrive: null, cloudOnly: null };
    });
    probe = { root, at: now(), value };
    return value;
  }

  async function gather(root: string): Promise<SyncView> {
    const [place, pcs, vaultId] = await Promise.all([d.place(root), d.pcs().catch(() => null), d.identityId(root).catch(() => null)]);
    const others = await othersOf(root, pcs, vaultId);
    const { files } = await vaultFiles(root).catch(() => ({ files: [] as { rel: string }[] }));
    const conflicts = findConflictCopies(
      files.map((f) => f.rel),
      pcNames(d.device, others, pcs),
    );
    const win = await windowsFacts(root, place);
    const downloading = !!keepAsked && keepAsked.root === root && now() - keepAsked.at < 60 * 60_000;
    const cloudOnly = win.cloudOnly ? { ...win.cloudOnly, ...(downloading ? { downloading: true } : {}) } : null;
    return syncView({ place, windows: win.windows, oneDrive: win.oneDrive, cloudOnly, conflicts, others, now: now() });
  }

  function status(fresh = false): Promise<SyncView | null> {
    const root = d.root();
    if (!root) return Promise.resolve(null);
    if (fresh) probe = null;
    if (!fresh && cache && cache.root === root && now() - cache.at < CACHE_MS) return cache.view;
    const view = gather(root);
    cache = { root, at: now(), view };
    view.catch(() => (cache = null));
    return view;
  }

  async function conflict(rel: unknown): Promise<ConflictCopy> {
    const v = await status();
    const c = v?.conflicts.find((x) => x.copy === rel);
    if (!c) throw new Error('That copy isn’t there any more.');
    return c;
  }

  const day = () => new Date(now()).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

  /** A conflict copy's lines brought into its note (every line kept), the copy then to Recently deleted. */
  async function mergeOne(c: ConflictCopy): Promise<boolean> {
    if (!c.note) throw new Error('Only notes can be merged. Keep both for this one.');
    const [mine, theirs] = await Promise.all([d.readNote(c.original), d.readNote(c.copy)]);
    if (!sameText(mine, theirs)) {
      // A Systems list merges row by row (every row from both sides kept, a record changed on both kept twice
      // and named); the Bills list the same way; any other note merges line by line.
      const bills = isBillsTableText(mine) || isBillsTableText(theirs);
      if ((isSystemsTableText(mine) || isSystemsTableText(theirs)) || bills) {
        try {
          const m = bills ? mergeBillsTables(mine, theirs, `${c.pc ?? 'the other PC'}’s copy`, day()) : mergeSystemsTables(mine, theirs, `${c.pc ?? 'the other PC'}’s copy`, day());
          if (m.changed) await d.writeNote(c.original, m.text);
        } catch {
          // Half arrived or mismatched: the line merge still keeps every line from both sides.
          const m = mergeNote(mine, theirs, `${c.pc ?? 'the other PC'}’s copy`, day());
          if (m.changed) await d.writeNote(c.original, m.text);
        }
      } else {
        const m = mergeNote(mine, theirs, `${c.pc ?? 'the other PC'}’s copy`, day());
        if (m.changed) await d.writeNote(c.original, m.text);
      }
    }
    await d.trash(c.copy);
    return true;
  }

  async function startOneDrive(show: boolean): Promise<string> {
    const s = await stub();
    if (s) {
      if (s.log) await fsp.appendFile(s.log, `${show ? 'show' : 'start'}-onedrive\n`).catch(() => undefined);
      return show ? 'OneDrive is open.' : 'OneDrive is starting. What this PC saved goes up in a moment.';
    }
    if (platform !== 'win32') throw new Error('OneDrive is on Windows.');
    const tried: string[] = [];
    const reg = await run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\OneDrive', '/v', 'OneDriveTrigger']);
    const m = /OneDriveTrigger\s+REG_\w+\s+(.+)$/im.exec(reg.stdout);
    if (m) tried.push(m[1].trim());
    if (process.env.LOCALAPPDATA) tried.push(nodePath.join(process.env.LOCALAPPDATA, 'Microsoft', 'OneDrive', 'OneDrive.exe'));
    if (process.env.ProgramFiles) tried.push(nodePath.join(process.env.ProgramFiles, 'Microsoft OneDrive', 'OneDrive.exe'));
    for (const exe of tried) {
      if (!(await fsp.stat(exe).then(() => true, () => false))) continue;
      // Always hidden (16 Nov 2026 audit finding 10): OneDrive is a windowed app, so this hides only a
      // console window — its window still opens when asked.
      spawn(exe, show ? [] : ['/background'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return show ? 'OneDrive is open. If it says syncing is paused, choose Resume syncing.' : 'OneDrive is starting. What this PC saved goes up in a moment.';
    }
    throw new Error('OneDrive isn’t installed on this PC. Install it from Microsoft, then sign in with the account your other PCs use.');
  }

  async function keepHere(root: string): Promise<string> {
    const s = await stub();
    if (s) {
      if (s.log) await fsp.appendFile(s.log, `keep-here ${root}\n`).catch(() => undefined);
    } else {
      if (platform !== 'win32') throw new Error('Keeping files on this PC is for Windows.');
      await run('attrib.exe', ['+P', '-U', root]);
      const r = await run('attrib.exe', ['+P', '-U', '/S', '/D', nodePath.join(root, '*')], undefined, 120_000);
      if (r.code !== 0) throw new Error('Windows didn’t keep the vault on this PC. Make sure OneDrive is running, then try again.');
    }
    probe = null;
    cache = null;
    keepAsked = { root, at: now() };
    return 'The whole vault is downloading, and it stays on this PC from now on.';
  }

  async function fix(id: unknown, arg?: unknown): Promise<SyncFixDone> {
    const root = d.root();
    if (!root) throw new Error('Ironleaf’s notes are not open yet.');
    let words: string;
    if (id === 'start-onedrive') words = await startOneDrive(false);
    else if (id === 'show-onedrive') words = await startOneDrive(true);
    else if (id === 'keep-here') words = await keepHere(root);
    else if (id === 'merge') {
      const c = await conflict(arg);
      await mergeOne(c);
      words = `${c.copy.split('/').pop()} is merged into ${c.original.split('/').pop()}, every line kept. The copy is in Recently deleted.`;
    } else if (id === 'keep-both') {
      const c = await conflict(arg);
      const { files } = await vaultFiles(root);
      const taken = new Set(files.map((f) => f.rel.toLowerCase()));
      const target = keptName(c, (rel) => taken.has(rel.toLowerCase()));
      await d.move(c.copy, target);
      words = `Both kept: ${c.pc ?? 'the other PC'}’s version is now “${target.split('/').pop()}”, beside the note.`;
    } else if (id === 'merge-all') {
      const v = await status(true);
      const notes = (v?.conflicts ?? []).filter((c) => c.note);
      let n = 0;
      for (const c of notes) if (await mergeOne(c).catch((err) => (d.log?.(`Merging ${c.copy}: ${err instanceof Error ? err.message : String(err)}`), false))) n++;
      const rest = (v?.conflicts.length ?? 0) - notes.length;
      words = `${n === 1 ? '1 note' : `${n} notes`} merged, every line kept; the copies are in Recently deleted.${rest ? ` ${rest === 1 ? '1 file isn’t a note' : `${rest} files aren’t notes`}: keep both of ${rest === 1 ? 'it' : 'each'}.` : ''}`;
    } else throw new Error('That can’t be fixed from here.');
    cache = null;
    if (id === 'merge' || id === 'keep-both' || id === 'merge-all') await d.rescan().catch(() => undefined);
    return { words };
  }

  return {
    beat,
    status,
    fix,
    /** The vault opened: this PC says so now and every ten minutes. */
    opened(): void {
      cache = null;
      probe = null;
      void beat();
      if (!timer) {
        timer = setInterval(() => void beat(), BEAT_MS);
        timer.unref?.();
      }
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
