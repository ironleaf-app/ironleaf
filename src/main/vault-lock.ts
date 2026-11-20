// One vault, one writer (the Neural Launcher contract, 16 Nov 2026: standalone Ironleaf opens the same vault
// folder the former host app's Vault uses). The app writing names itself in the vault; the other says so in
// plain words and reads only. A crash never leaves a stale lock: the heartbeat stops with the app, and a lock
// whose app is gone is taken over. No Electron here, so the tests bundle this file as it stands.

import { promises as fsp } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';

export type LockApp = 'neuralspark' | 'neuralvault';
export const LOCK_REL = path.join('.neuralvault', 'writer.json');
const APP_NAME: Record<LockApp, string> = { neuralspark: 'Another app', neuralvault: 'Ironleaf' };

export interface WriterLock {
  app: LockApp;
  pid: number;
  token: string;
  host: string;
  startedAt: string;
  heartbeat: string;
}

export type LockState = { held: false } | { held: true; lock: WriterLock };

/** The lock file's words as a lock, or null when missing, torn or for no app (never blocking). */
export function parseLock(text: string): WriterLock | null {
  try {
    const v = JSON.parse(String(text).replace(/^\uFEFF/, '')) as Partial<WriterLock>;
    if ((v.app !== 'neuralspark' && v.app !== 'neuralvault') || !Number.isSafeInteger(v.pid) || (v.pid as number) <= 0) return null;
    if (typeof v.token !== 'string' || !v.token || typeof v.heartbeat !== 'string' || !Number.isFinite(Date.parse(v.heartbeat))) return null;
    return { app: v.app, pid: v.pid as number, token: v.token, host: typeof v.host === 'string' ? v.host : '', startedAt: typeof v.startedAt === 'string' ? v.startedAt : v.heartbeat, heartbeat: v.heartbeat };
  } catch {
    return null;
  }
}

/** Whether the lock is left over: its app is gone and its heartbeat is old. An app still alive keeps it. */
export function lockStale(lock: WriterLock, o: { now?: number; alive?: (pid: number) => boolean; maxAgeMs?: number } = {}): boolean {
  const now = o.now ?? Date.now();
  const age = now - Date.parse(lock.heartbeat);
  if (Number.isFinite(age) && age < 0) return false;
  if (!Number.isFinite(age) || age <= (o.maxAgeMs ?? 20_000)) return false;
  try {
    return !(o.alive ?? defaultAlive)(lock.pid);
  } catch {
    return true;
  }
}

const defaultAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Plain words for the app that found the vault held: who has it, and that this side reads only. */
export function holderWords(lock: WriterLock, self: LockApp): string {
  const other = APP_NAME[lock.app] ?? 'The other app';
  return self === lock.app ? `${other} has your vault open in another window, so this one reads only for now.` : `${other} has your vault open on this PC, so Ironleaf reads only here for now. Your notes still open and export.`;
}

/** Throws the plain words when the state says another app writes; reading is never gated. */
export function assertWritable(state: LockState, self: LockApp): void {
  if (state.held) throw new Error(holderWords(state.lock, self));
}

export interface VaultLockOpts {
  app: LockApp;
  pid?: number;
  token?: string;
  now?: () => number;
  alive?: (pid: number) => boolean;
  heartbeatMs?: number;
  maxAgeMs?: number;
}

export class VaultLock {
  private timer: NodeJS.Timeout | undefined;
  private readonly token: string;
  constructor(
    private readonly root: string,
    private readonly opts: VaultLockOpts,
  ) {
    this.token = opts.token ?? `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private get file(): string {
    return path.join(this.root, LOCK_REL);
  }

  private wall(): number {
    return (this.opts.now ?? Date.now)();
  }

  private async read(): Promise<WriterLock | null> {
    return fsp.readFile(this.file, 'utf8').then((t) => parseLock(t), () => null);
  }

  /** Takes the lock when free, stale or already ours; otherwise says who holds it. */
  async acquire(): Promise<LockState> {
    const current = await this.read();
    if (current && current.token !== this.token && !lockStale(current, { now: this.wall(), alive: this.opts.alive, maxAgeMs: this.opts.maxAgeMs })) return { held: true, lock: current };
    const at = new Date(this.wall()).toISOString();
    const lock: WriterLock = { app: this.opts.app, pid: this.opts.pid ?? process.pid, token: this.token, host: hostname(), startedAt: at, heartbeat: at };
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(lock));
    await fsp.rename(temp, this.file);
    this.beat();
    return { held: false };
  }

  private beat(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.pulse().finally(() => this.beat()), this.opts.heartbeatMs ?? 5000);
    this.timer.unref?.();
  }

  /** For tests: the heartbeat a crash stops. */
  stopHeartbeatForTest(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async pulse(): Promise<void> {
    const current = await this.read();
    if (!current || current.token !== this.token) return;
    const temp = `${this.file}.${process.pid}.tmp`;
    await fsp.writeFile(temp, JSON.stringify({ ...current, heartbeat: new Date(this.wall()).toISOString() })).then(() => fsp.rename(temp, this.file), () => {});
  }

  /** Lets go, but only of a lock this holder took. */
  async release(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const current = await this.read();
    if (current && current.token === this.token) await fsp.unlink(this.file).catch(() => {});
  }
}
