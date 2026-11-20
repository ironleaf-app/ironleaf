// The extra far-side capture's main side (6 Nov 2026, m6-any-speaker-capture: a call on any output, not just the
// Windows default). Chromium's loopback hears only the default speakers; while a meeting records and the call plays
// elsewhere, this runs the contained native child (extra-loopback-child.cjs) capturing the missed output's loopback
// and forwards its sound to the window, where it joins the existing far-side path — the same pieces, the same echo
// and voice gate, the same billing. The child is never trusted: missing, unloadable, silent, sulking or dead, the
// recorder carries on as it does today (and the m1 notice still speaks).
//
// No Electron import here (fork and send are handed in), so the node tests run this file as it is.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { pickExtraDevice, pickLoudest, unheardCall, type NativeOutputDevice } from '../shared/recorder';

/** The contained child, however it was spawned (the utility process in the product, a fork in tests). */
export interface ExtraChild {
  on(event: 'message' | 'exit' | 'error', fn: (...args: any[]) => void): void;
  send(msg: unknown): void;
  kill(): void;
}

export interface ExtraLoopbackDeps {
  platform: NodeJS.Platform;
  /** The main bundle's own folder (the embed's src/neuralvault, else the development tree above out/main). */
  here: string;
  exists?: (p: string) => boolean;
  /** The child spawned contained: a crash there is an exit, never a lost recording. */
  fork: (childPath: string, vendorPath: string) => ExtraChild;
  /** The window told (audio chunks while capturing, the state when it changes). */
  send: (channel: string, payload: unknown) => void;
  /** How long the child has to answer (tests shorten these). */
  readyMs?: number;
  probeMs?: number;
  tickMs?: number;
}

export interface ExtraStartResult {
  started: boolean;
  device?: string;
  reason?: string;
}

export interface ExtraStatus {
  /** The part is here to run (Windows, its files beside the app). */
  available: boolean;
  capturing: boolean;
  device: string;
}

/** Where the contained child and its library live: the shipped folder beside the app (the embed's src/neuralvault, the
 *  standalone's app folder), else the development tree's own copies. */
export function extraLoopbackPaths(here: string, exists: (p: string) => boolean): { child: string; vendor: string } | null {
  let dir = here;
  for (let i = 0; i < 5; i++) {
    const shippedChild = path.join(dir, 'extra-loopback', 'child.cjs');
    const shippedVendor = path.join(dir, 'extra-loopback', 'vendor', 'native-recorder-nodejs');
    if (exists(shippedChild) && exists(path.join(shippedVendor, 'dist', 'index.js'))) return { child: shippedChild, vendor: shippedVendor };
    const srcChild = path.join(dir, 'src', 'main', 'extra-loopback-child.cjs');
    const srcVendor = path.join(dir, 'vendor', 'native-recorder-nodejs');
    if (exists(srcChild) && exists(path.join(srcVendor, 'dist', 'index.js'))) return { child: srcChild, vendor: srcVendor };
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

type ChildMessage = { t: string; [k: string]: unknown };

export function createExtraLoopback(d: ExtraLoopbackDeps) {
  const exists = d.exists ?? existsSync;
  const readyMs = d.readyMs ?? 10_000;
  const probeMs = d.probeMs ?? 2500;
  const tickMs = d.tickMs ?? 12_000;
  let child: ExtraChild | null = null;
  let capturing = false;
  let device = '';
  let starting: Promise<ExtraStartResult> | null = null;
  let watch: NodeJS.Timeout | null = null;
  /** Waiting asks, in turn (one at a time: boot, devices, probe, capture). */
  let waiters: { ts: string[]; ok: (m: ChildMessage) => void }[] = [];
  /** Messages arrived before their ask waited (two levels in one breath): held for it, never dropped. */
  let pending: ChildMessage[] = [];

  const status = (): ExtraStatus => ({
    available: d.platform === 'win32' && extraLoopbackPaths(d.here, exists) !== null,
    capturing,
    device,
  });

  const clearWatch = () => {
    if (watch) {
      clearTimeout(watch);
      watch = null;
    }
  };

  const hear = (m: ChildMessage) => {
    if (capturing) {
      // Anything from the child proves it alive (sound while the route plays, ticks while it is quiet).
      clearWatch();
      watch = setTimeout(() => died(), tickMs);
      if (watch.unref) watch.unref();
    }
    if (m.t === 'audio' && capturing) {
      d.send('recorder:extra-audio', { seq: m.seq, pcm: m.pcm, rms: m.rms });
      return;
    }
    if (m.t === 'error') {
      // Mid-capture the ask is over (the device went away); while asking, the ask fails.
      if (capturing) died();
      else for (const w of waiters.splice(0)) w.ok(m);
      return;
    }
    const at = waiters.findIndex((w) => w.ts.includes(m.t));
    if (at >= 0) waiters.splice(at, 1)[0].ok(m);
    else if (pending.length < 50) pending.push(m);
  };

  /** The child gone mid-capture: the window told, the recording carrying on with Chromium's sound alone. */
  const died = () => {
    if (!capturing && !child) return;
    const was = capturing;
    capturing = false;
    device = '';
    clearWatch();
    pending = [];
    for (const w of waiters.splice(0)) w.ok({ t: 'gone' });
    if (child) {
      const c = child;
      child = null;
      try {
        c.kill();
      } catch {
        // Already gone.
      }
    }
    if (was) d.send('recorder:extra-state', { capturing: false, device: '', died: true });
  };

  const quitChild = () => {
    capturing = false;
    device = '';
    clearWatch();
    pending = [];
    for (const w of waiters.splice(0)) w.ok({ t: 'gone' });
    if (child) {
      const c = child;
      child = null;
      try {
        c.send({ t: 'quit' });
      } catch {
        // Gone already.
      }
      try {
        c.kill();
      } catch {
        // Gone already.
      }
    }
  };

  /** The next message of one kind (held ones first), else `gone` (the child left) or an error, or never (the wait
   *  has its own time). */
  const next = (...ts: string[]): Promise<ChildMessage> =>
    new Promise((ok) => {
      const at = pending.findIndex((m) => ts.includes(m.t));
      if (at >= 0) ok(pending.splice(at, 1)[0]);
      else waiters.push({ ts, ok });
    });

  const withTime = async <T>(p: Promise<T>, ms: number): Promise<T | 'late'> =>
    await Promise.race([p, new Promise<'late'>((ok) => setTimeout(() => ok('late'), ms))]);

  async function run(outputs: readonly { deviceId: string; label: string }[]): Promise<ExtraStartResult> {
    if (d.platform !== 'win32') return { started: false, reason: 'not-windows' };
    if (capturing) return { started: true, device };
    const paths = extraLoopbackPaths(d.here, exists);
    if (!paths) return { started: false, reason: 'missing' };
    try {
      child = d.fork(paths.child, paths.vendor);
    } catch {
      child = null;
      return { started: false, reason: 'spawn-failed' };
    }
    child.on('message', (m: ChildMessage) => hear(m ?? { t: '' }));
    child.on('exit', () => (capturing ? died() : quitChild()));
    child.on('error', () => (capturing ? died() : quitChild()));
    // Boot: ready, or unloadable said cleanly, or given up on.
    const boot = await withTime(next('ready', 'unavailable'), readyMs);
    if (boot === 'late') {
      quitChild();
      return { started: false, reason: 'timeout' };
    }
    if (boot.t === 'unavailable') {
      quitChild();
      return { started: false, reason: 'unavailable' };
    }
    if (boot.t !== 'ready') return { started: false, reason: 'died' };
    const fail = (reason: string): ExtraStartResult => {
      quitChild();
      return { started: false, reason };
    };
    try {
      child.send({ t: 'devices' });
    } catch {
      return fail('died');
    }
    const listed = await withTime(next('devices'), readyMs);
    if (listed === 'late' || listed.t !== 'devices') return fail(listed === 'late' ? 'timeout' : 'died');
    const natives: NativeOutputDevice[] = Array.isArray(listed.devices)
      ? (listed.devices as unknown[])
          .map((e) => (e && typeof e === 'object' ? (e as Record<string, unknown>) : null))
          .filter((e): e is Record<string, unknown> => !!e && typeof e.id === 'string' && !!e.id && typeof e.name === 'string' && !!e.name && (e.type === undefined || e.type === 'output'))
          .map((e) => ({ id: e.id as string, name: (e.name as string).slice(0, 200), isDefault: e.isDefault === true }))
      : [];
    // The missed speakers by name; else, when a mismatch is known but the name maps nowhere, the active endpoints
    // probed and the one with real sound taken. The default is never probed: it is heard already.
    let pick = pickExtraDevice(outputs, natives);
    if (!pick && unheardCall(outputs)) {
      const ids = natives.filter((n) => !n.isDefault).map((n) => n.id).slice(0, 6);
      if (!ids.length) return fail('none');
      try {
        child.send({ t: 'probe', ids });
      } catch {
        return fail('died');
      }
      const loud = new Map<string, number>();
      const until = Date.now() + probeMs;
      for (;;) {
        const left = until - Date.now();
        if (left <= 0) break;
        const level = await withTime(next('level'), left);
        if (level === 'late' || level.t !== 'level') break;
        if (typeof level.id === 'string' && typeof level.rms === 'number') loud.set(level.id, Math.max(loud.get(level.id) ?? 0, level.rms));
      }
      const id = pickLoudest(ids.map((i) => ({ id: i, rms: loud.get(i) ?? 0 })));
      const found = id ? (natives.find((n) => n.id === id) ?? null) : null;
      if (!found) {
        try {
          child.send({ t: 'probe-stop' });
        } catch {
          // Gone already.
        }
        return fail('silent');
      }
      pick = found;
    }
    if (!pick) return fail('none');
    try {
      child.send({ t: 'start', id: pick.id });
    } catch {
      return fail('died');
    }
    capturing = true;
    device = pick.name;
    clearWatch();
    watch = setTimeout(() => died(), tickMs);
    if (watch.unref) watch.unref();
    return { started: true, device };
  }

  async function start(outputs: readonly { deviceId: string; label: string }[]): Promise<ExtraStartResult> {
    if (starting) return starting;
    starting = run(outputs).finally(() => {
      starting = null;
    });
    return starting;
  }

  async function stop(): Promise<void> {
    quitChild();
  }

  async function dispose(): Promise<void> {
    quitChild();
  }

  return { status, start, stop, dispose };
}

export type ExtraLoopback = ReturnType<typeof createExtraLoopback>;
