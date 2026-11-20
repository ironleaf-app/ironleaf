// Ironleaf Sync's engine (docs/SYNC.md § The client engine): pull the server's changes and apply them, scan the vault
// against what both sides last agreed, push what changed here. The server's compare-and-swap per slot decides who was
// first; the PC that lost keeps its version as a conflict copy and sends it up as a new file. Nothing is dropped: a
// change that can't be applied or sent stays in the journal (saved with the state) and is tried again next round.
// No Electron here; `SyncRunner` below is the loop with its debounce, long poll, pause and back-off.

import { randomBytes, randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { VaultKeys, sha256hex, Tampered } from './crypto';
import { absOf, carried, hashFile, isExcluded, listLocal, safeRel, tempBeside, type LocalFile, type LocalWriter } from './local';
import { CHUNK_BYTES, SyncHttpError, type ChangeIn, type ChangeOut, type DeleteMeta, type FileMeta, type Meta, type SyncApi } from './protocol';

/** What this PC and the server last agreed for one slot. `sha` null: a tombstone (deleted everywhere). */
export interface BaseEntry {
  path: string;
  id: string;
  head: number;
  sha: string | null;
  size: number;
  /** For an excluded path: its sealed metadata, so it can be fetched when the folder is included again. */
  meta?: string;
  excluded?: boolean;
}

export interface SyncState {
  v: 1;
  vaultId: string;
  cursor: number;
  base: Record<string, BaseEntry>;
  /** Fingerprints by size and time, so unchanged files aren't read again. */
  seen: Record<string, { size: number; mtime: number; sha: string }>;
  journal: {
    /** Uploads in flight by slot: the file's SHA-256 and the nonces its chunks were sealed with (resume). */
    uploads: Record<string, { sha: string; id: string; nonces: string[] }>;
    /** Server changes not applied yet (a locked file, a full disk), in order, with how often they were tried. */
    remote: (ChangeOut & { tries?: number })[];
    /** Conflict copies made, by slot: the SHA-256 of this PC's version kept, so a retried round never makes another. */
    copied?: Record<string, string>;
  };
  stats: { conflicts: number; lastOk: number };
}

export const emptyState = (vaultId: string): SyncState => ({ v: 1, vaultId, cursor: 0, base: {}, seen: {}, journal: { uploads: {}, remote: [] }, stats: { conflicts: 0, lastOk: 0 } });

export interface StateStore {
  load(): Promise<SyncState | null>;
  save(s: SyncState): Promise<void>;
}

/** The state as JSON in a file of Ironleaf's own data (never in the vault), written whole or not at all. */
export class FileStateStore implements StateStore {
  constructor(private readonly file: string) {}
  async load(): Promise<SyncState | null> {
    try {
      return JSON.parse(await fsp.readFile(this.file, 'utf8')) as SyncState;
    } catch {
      return null;
    }
  }
  async save(s: SyncState): Promise<void> {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomBytes(4).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(s));
    await fsp.rename(tmp, this.file);
  }
}

export interface EngineDeps {
  api: SyncApi;
  keys: VaultKeys;
  root: string;
  device: { id: string; name: string };
  writer: LocalWriter;
  store: StateStore;
  excluded(): readonly string[];
  /** Files sync wrote, moved or removed (the app reads them again: index, links, recovery). */
  applied?(rels: string[], moves: [string, string][]): void;
  log?(message: string): void;
  now?(): number;
  /** A file changed on both sides that the app has its own rule for: merged bytes, 'theirs' (the server's version
   *  wins, this PC's goes to the Bin), or null for the usual conflict copy. */
  resolve?(rel: string, mine: Buffer, theirs: Buffer): Promise<{ bytes: Buffer } | 'theirs' | null>;
  /** Keeps this PC's version of a file the server's replaced ('theirs'), outside the vault. */
  keepAside?(rel: string, bytes: Buffer): Promise<void>;
}

/** Keeps replaced versions in a folder of Ironleaf's own data: `<dir>/<time>-<random>.bin` with a line saying what each
 *  was (the folder is this PC's, never synced or sent). */
export function asideIn(dir: string): (rel: string, bytes: Buffer) => Promise<void> {
  return async (rel, bytes) => {
    await fsp.mkdir(dir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(4).toString('hex')}`;
    await fsp.writeFile(path.join(dir, `${name}.bin`), bytes);
    await fsp.appendFile(path.join(dir, 'index.txt'), `${name}\t${rel}\n`);
  };
}

export interface RoundResult {
  pulled: number;
  applied: number;
  pushed: number;
  conflicts: number;
  waiting: number;
  skipped: number;
}

/** A remote change that couldn't land now (the file changed under it, or is locked): tried again next round. */
class NotNow extends Error {}

const POST_BATCH = 100;
const PULL_LIMIT = 500;
const MAX_REMOTE_TRIES = 50;

export class SyncEngine {
  state!: SyncState;
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  /** Entries the last scan couldn't read. */
  skipped = 0;
  /** Files changed here that are not on the server yet (after the last round). */
  waiting = 0;
  /** Changes whose metadata failed its check (never applied). */
  rejected = 0;

  constructor(private readonly d: EngineDeps) {}

  private now() {
    return this.d.now?.() ?? Date.now();
  }
  private get vid() {
    return this.d.keys.vaultId;
  }

  async load(): Promise<SyncState> {
    if (!this.loaded) {
      const s = await this.d.store.load();
      this.state = s && s.v === 1 && s.vaultId === this.vid ? s : emptyState(this.vid);
      this.state.stats ??= { conflicts: 0, lastOk: 0 };
      this.loaded = true;
    }
    return this.state;
  }

  private save() {
    return this.d.store.save(this.state);
  }

  /** One round, one at a time: pull and apply, scan and push, again while the server had something newer. */
  sync(): Promise<RoundResult> {
    const run = this.queue.then(() => this.round());
    this.queue = run.catch(() => {});
    return run;
  }

  private async round(): Promise<RoundResult> {
    await this.load();
    const r: RoundResult = { pulled: 0, applied: 0, pushed: 0, conflicts: 0, waiting: 0, skipped: 0 };
    const wrote: string[] = [];
    const moves: [string, string][] = [];
    try {
      for (let i = 0; i < 4; i++) {
        r.pulled += await this.pull();
        await this.applyRemote(r, wrote, moves);
        const { pushed, conflicted } = await this.scanAndPush(wrote);
        r.pushed += pushed;
        if (!conflicted) break;
      }
      this.state.stats.lastOk = this.now();
      r.waiting = this.waiting;
      r.skipped = this.skipped;
      return r;
    } finally {
      await this.save();
      if (wrote.length || moves.length) this.d.applied?.([...new Set(wrote)], moves);
    }
  }

  /** The server's changes since the cursor, into the journal (the cursor moves only once they are saved there). */
  private async pull(): Promise<number> {
    let n = 0;
    for (;;) {
      const { changes } = await this.d.api.changes(this.vid, this.state.cursor, { limit: PULL_LIMIT, device: this.d.device.id });
      for (const c of changes) {
        if (c.seq <= this.state.cursor) continue;
        this.state.journal.remote.push(c);
        this.state.cursor = c.seq;
        n++;
      }
      await this.save();
      if (changes.length < PULL_LIMIT) return n;
    }
  }

  private openMeta(c: ChangeOut): Meta | null {
    try {
      const m = this.d.keys.openMeta<Meta>(c.slot, c.meta);
      // The path must be the one the slot was made from, and safe to write: else it was tampered with.
      if (!m || m.v !== 1 || !safeRel(m.path) || this.d.keys.slot(m.path) !== c.slot || typeof m.id !== 'string') throw new Tampered('change');
      if (!!m.deleted !== !!c.deleted) throw new Tampered('change');
      return m;
    } catch {
      this.rejected++;
      this.d.log?.('Sync: a change failed its integrity check and was not applied.');
      return null;
    }
  }

  private async localSha(rel: string): Promise<string | null> {
    const abs = absOf(this.d.root, rel);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st?.isFile()) return null;
    const seen = this.state.seen[rel];
    const mtime = Math.round(st.mtimeMs);
    if (seen && seen.size === st.size && seen.mtime === mtime) return seen.sha;
    const sha = await hashFile(abs);
    if (sha === null) throw new NotNow('unreadable');
    this.state.seen[rel] = { size: st.size, mtime, sha };
    return sha;
  }

  /** Remembers what a file sync just wrote looks like, so the next scan doesn't read it again. */
  private async noteSeen(rel: string, sha: string) {
    const st = await fsp.stat(absOf(this.d.root, rel)).catch(() => null);
    if (st) this.state.seen[rel] = { size: st.size, mtime: Math.round(st.mtimeMs), sha };
  }

  /** The journal's server changes applied in order; one that can't land now holds back later ones for its slot only. */
  private async applyRemote(r: RoundResult, wrote: string[], moves: [string, string][]) {
    const left: SyncState['journal']['remote'] = [];
    const held = new Set<string>();
    // Each change carries its slot's whole state, so only a slot's latest matters (an older one's chunks may be gone).
    const latest = new Map<string, number>();
    for (const c of this.state.journal.remote) latest.set(c.slot, c.seq);
    for (const c of this.state.journal.remote) {
      if (latest.get(c.slot) !== c.seq) continue;
      if (held.has(c.slot)) {
        left.push(c);
        continue;
      }
      try {
        if (await this.applyOne(c, r, wrote, moves)) r.applied++;
      } catch (err) {
        c.tries = (c.tries ?? 0) + 1;
        if (c.tries < MAX_REMOTE_TRIES || !(err instanceof Tampered)) {
          left.push(c);
          held.add(c.slot);
        }
        if (!(err instanceof NotNow)) this.d.log?.(`Sync: a change couldn’t be applied yet (${errCode(err)}).`);
      }
    }
    this.state.journal.remote = left;
    await this.save();
  }

  private async applyOne(c: ChangeOut, r: RoundResult, wrote: string[], moves: [string, string][]): Promise<boolean> {
    const b = this.state.base[c.slot];
    if (b && b.head >= c.seq) return false; // this PC's own change, or one already agreed
    const m = this.openMeta(c);
    if (!m) return false;
    const rel = m.path;
    const remote: BaseEntry = { path: rel, id: m.id, head: c.seq, sha: m.deleted ? null : m.sha, size: m.deleted ? 0 : m.size };
    if (!carried(rel) || isExcluded(rel, this.d.excluded())) {
      this.state.base[c.slot] = { ...remote, excluded: true, ...(m.deleted ? {} : { meta: c.meta }) };
      return false;
    }
    // A case-only rename on the other PC: the slot is the same, the name isn't. The old spelling is what's on disk here.
    const here = b && b.path !== rel && b.path.toLowerCase() === rel.toLowerCase() ? b.path : rel;
    const local = await this.localSha(here);
    const baseSha = b?.sha ?? null;
    if (local === remote.sha) {
      // Already the same here (the same edit, or the same file on both PCs before they first synced).
      if (here !== rel && local !== null) {
        if ((await this.d.writer.move(here, rel, local)) !== 'ok') throw new NotNow('changed');
        moves.push([here, rel]);
        delete this.state.seen[here];
        await this.noteSeen(rel, local);
      }
      this.state.base[c.slot] = remote;
      return here !== rel;
    }
    if (local === baseSha) {
      // Unchanged here: the server's version lands.
      if (m.deleted) {
        if (local !== null) {
          if ((await this.d.writer.remove(here, local)) !== 'ok') throw new NotNow('changed');
          delete this.state.seen[here];
          wrote.push(here);
        }
      } else {
        const moved = local === null ? await this.renamedFrom(c.slot, m) : null;
        if (moved && (await this.d.writer.move(moved, rel, m.sha)) === 'ok') {
          moves.push([moved, rel]);
          delete this.state.seen[moved];
          await this.noteSeen(rel, m.sha);
        } else {
          await this.download(rel, m, local);
          wrote.push(rel);
        }
      }
      this.state.base[c.slot] = remote;
      return true;
    }
    // Changed here too.
    if (m.deleted) {
      // Deleted there, changed here: the change stays and goes up again as a new file.
      this.state.base[c.slot] = { ...remote, id: randomUUID() };
      return true;
    }
    if (local === null) {
      // Deleted here, changed there: it comes back.
      await this.download(rel, m, null);
      wrote.push(rel);
      this.state.base[c.slot] = remote;
      return true;
    }
    // Changed on both. A file the app merges itself (its keyed settings documents) is merged, or one only the server's
    // version of makes sense (the vault's identity) takes it with this PC's to the Bin: the app says which (resolve).
    if (this.d.resolve && here === rel && (await this.resolveBoth(rel, m, local, wrote))) {
      this.state.base[c.slot] = remote;
      return true;
    }
    // Otherwise the server's version takes the name, this PC's is kept beside it (sent up next scan). The server's is
    // fetched and checked first, and the copy made once per version, so a round that fails part-way never repeats it.
    const theirs = await tempBeside(this.d.root, rel);
    try {
      await this.fetchInto(theirs, m);
      const copied = (this.state.journal.copied ??= {});
      if (copied[c.slot] !== local) {
        const copy = await this.d.writer.conflictName(rel);
        const temp = await tempBeside(this.d.root, copy);
        await fsp.copyFile(absOf(this.d.root, here), temp);
        if ((await hashFile(temp)) !== local || (await this.d.writer.place(copy, temp, null)) !== 'ok') {
          await fsp.rm(temp, { force: true }).catch(() => {});
          throw new NotNow('changed');
        }
        copied[c.slot] = local;
        await this.save();
        wrote.push(copy);
      }
      if (here !== rel && (await this.d.writer.remove(here, local)) !== 'ok') throw new NotNow('changed');
      if ((await this.d.writer.place(rel, theirs, here !== rel ? null : local)) !== 'ok') throw new NotNow('changed');
      await this.noteSeen(rel, m.sha);
      delete copied[c.slot];
    } finally {
      await fsp.rm(theirs, { force: true }).catch(() => {});
    }
    wrote.push(rel);
    this.state.base[c.slot] = remote;
    this.state.stats.conflicts++;
    r.conflicts++;
    this.d.log?.('Sync: changed on two PCs; this PC’s version kept as a conflict copy.');
    return true;
  }

  /** The path of a file here that is the same file (same id, same bytes) as an add from a rename on another PC. */
  private async renamedFrom(slot: string, m: FileMeta): Promise<string | null> {
    for (const [s, e] of Object.entries(this.state.base)) {
      if (s === slot || e.id !== m.id || e.sha !== m.sha || e.excluded) continue;
      if ((await this.localSha(e.path).catch(() => null)) === m.sha) return e.path;
    }
    return null;
  }

  /** A file's chunks fetched, checked and opened into a temp beside it, then put in place if the file here is still `expect`. */
  /** Both changed and the app has a rule for the file: true when it was applied (merged, or the server's taken). */
  private async resolveBoth(rel: string, m: FileMeta, local: string, wrote: string[]): Promise<boolean> {
    const theirsTemp = await tempBeside(this.d.root, rel);
    try {
      await this.fetchInto(theirsTemp, m);
      const mine = await fsp.readFile(absOf(this.d.root, rel));
      if (sha256hex(mine) !== local) throw new NotNow('changed');
      const choice = await this.d.resolve!(rel, mine, await fsp.readFile(theirsTemp));
      if (!choice) return false;
      if (choice === 'theirs') {
        // This PC's version kept aside in Ironleaf's own data (recoverable, never in the vault), the server's in its place.
        if (!this.d.keepAside) return false;
        await this.d.keepAside(rel, mine);
        if ((await this.d.writer.place(rel, theirsTemp, local)) !== 'ok') throw new NotNow('changed');
        await this.noteSeen(rel, m.sha);
      } else {
        // Merged: lands here, and goes up as this PC's next change on top of the server's.
        const t = await tempBeside(this.d.root, rel);
        await fsp.writeFile(t, choice.bytes);
        if ((await this.d.writer.place(rel, t, local)) !== 'ok') throw new NotNow('changed');
        await this.noteSeen(rel, sha256hex(choice.bytes));
      }
      wrote.push(rel);
      return true;
    } finally {
      await fsp.rm(theirsTemp, { force: true }).catch(() => {});
    }
  }

  /** A file's chunks fetched, checked and opened into `temp` (its SHA-256 checked against the metadata). */
  private async fetchInto(temp: string, m: FileMeta): Promise<void> {
    const key = this.d.keys.fileKey(m.id);
    const fh = await fsp.open(temp, 'w');
    try {
      for (let i = 0; i < m.chunks.length; i++) {
        const ch = m.chunks[i]!;
        const sealed = await this.d.api.getBlob(this.vid, ch.h);
        if (sha256hex(sealed) !== ch.h) throw new Tampered('file');
        const plain = this.d.keys.openChunk(key, m.id, i, sealed);
        if (plain.length !== ch.n) throw new Tampered('file');
        await fh.write(plain);
      }
      await fh.sync();
    } finally {
      await fh.close();
    }
    if ((await hashFile(temp)) !== m.sha) throw new Tampered('file');
  }

  private async download(rel: string, m: FileMeta, expect: string | null): Promise<void> {
    const temp = await tempBeside(this.d.root, rel);
    try {
      await this.fetchInto(temp, m);
      if ((await this.d.writer.place(rel, temp, expect)) !== 'ok') throw new NotNow('changed');
      await this.noteSeen(rel, m.sha);
    } finally {
      await fsp.rm(temp, { force: true }).catch(() => {});
    }
  }

  // ---- Scan and push ----------------------------------------------------------------------------------------------

  private async scanAndPush(wrote: string[]): Promise<{ pushed: number; conflicted: boolean }> {
    const excluded = this.d.excluded();
    const { files, skipped } = await listLocal(this.d.root, excluded);
    this.skipped = skipped;
    const pendingSlots = new Set(this.state.journal.remote.map((c) => c.slot));
    // Folders included again: what the server has there comes down.
    for (const [slot, e] of Object.entries(this.state.base)) {
      if (!e.excluded || isExcluded(e.path, excluded) || !carried(e.path)) continue;
      if (e.sha && e.meta && !files.has(e.path)) {
        const m = this.d.keys.openMeta<FileMeta>(slot, e.meta);
        try {
          await this.download(e.path, m, null);
          wrote.push(e.path);
          const st = await fsp.stat(absOf(this.d.root, e.path));
          files.set(e.path, { rel: e.path, abs: absOf(this.d.root, e.path), size: st.size, mtime: Math.round(st.mtimeMs) });
        } catch (err) {
          this.d.log?.(`Sync: a file in a folder included again couldn’t be fetched yet (${errCode(err)}).`);
          continue;
        }
      }
      delete e.excluded;
      delete e.meta;
    }
    const bySlot = new Map<string, LocalFile & { slot: string }>();
    for (const f of files.values()) bySlot.set(this.d.keys.slot(f.rel), { ...f, slot: this.d.keys.slot(f.rel) });

    interface Put {
      f: LocalFile;
      slot: string;
      sha: string;
      id: string;
      base: number;
    }
    interface Del {
      e: BaseEntry;
      slot: string;
      to?: string;
    }
    const puts: Put[] = [];
    const dels: Del[] = [];
    const seen: SyncState['seen'] = {};
    for (const [slot, f] of bySlot) {
      if (pendingSlots.has(slot)) continue;
      const b = this.state.base[slot];
      const s = this.state.seen[f.rel];
      let sha = s && s.size === f.size && s.mtime === f.mtime ? s.sha : null;
      if (!sha) {
        sha = await hashFile(f.abs);
        if (!sha) {
          this.skipped++;
          continue;
        }
      }
      seen[f.rel] = { size: f.size, mtime: f.mtime, sha };
      if (b && !b.excluded && b.sha === sha && b.path === f.rel) continue;
      const j = this.state.journal.uploads[slot];
      // A file keeps its id; a new one reuses the id of its interrupted upload, so the chunks already sent still match.
      const id = b && b.sha !== null && !b.excluded ? b.id : j && j.sha === sha ? j.id : randomUUID();
      puts.push({ f, slot, sha, id, base: b?.head ?? 0 });
    }
    for (const [slot, e] of Object.entries(this.state.base)) {
      if (e.sha === null || e.excluded || bySlot.has(slot) || pendingSlots.has(slot)) continue;
      if (isExcluded(e.path, excluded)) {
        // Excluded on this PC now: kept on the server and the other PCs, never deleted from here.
        e.excluded = true;
        continue;
      }
      if (!carried(e.path)) continue;
      dels.push({ e, slot });
    }
    // Renames: a delete and an add of the same bytes keep the file's id, so the other PCs move it instead.
    for (const d of dels) {
      const p = puts.find((x) => x.sha === d.e.sha && !this.state.base[x.slot]?.sha && !dels.some((o) => o.to === x.f.rel));
      if (p) {
        p.id = d.e.id;
        d.to = p.f.rel;
      }
    }
    this.state.seen = { ...seen };

    let pushed = 0;
    let conflicted = false;
    const ready: { change: ChangeIn; done: () => void }[] = [];
    for (const p of puts) {
      try {
        const up = await this.upload(p.f, p.slot, p.sha, p.id);
        if (!up) continue;
        const meta: FileMeta = { v: 1, id: p.id, path: p.f.rel, sha: p.sha, size: p.f.size, mtime: p.f.mtime, chunks: up.chunks, by: this.d.device.id };
        ready.push({
          change: { slot: p.slot, base: p.base, meta: this.d.keys.sealMeta(p.slot, meta), blobs: up.chunks.map((c) => c.h), size: up.bytes, deleted: false },
          done: () => {
            this.state.base[p.slot] = { path: p.f.rel, id: p.id, head: 0, sha: p.sha, size: p.f.size };
            delete this.state.journal.uploads[p.slot];
          },
        });
      } catch (err) {
        if (err instanceof SyncHttpError && (err.status === 401 || err.status === 403 || err.code === 'quota')) throw err;
        this.d.log?.(`Sync: a file couldn’t be sent yet (${errCode(err)}).`);
      }
    }
    for (const d of dels) {
      const meta: DeleteMeta = { v: 1, id: d.e.id, path: d.e.path, deleted: true, ...(d.to ? { to: d.to } : {}), by: this.d.device.id };
      ready.push({
        change: { slot: d.slot, base: d.e.head, meta: this.d.keys.sealMeta(d.slot, meta), blobs: [], size: 0, deleted: true },
        done: () => {
          this.state.base[d.slot] = { path: d.e.path, id: d.e.id, head: 0, sha: null, size: 0 };
        },
      });
    }
    for (let i = 0; i < ready.length; i += POST_BATCH) {
      const batch = ready.slice(i, i + POST_BATCH);
      const results = await this.d.api.postChanges(this.vid, this.d.device.id, batch.map((x) => x.change));
      batch.forEach((x, j) => {
        const res = results[j];
        if (res?.ok) {
          x.done();
          this.state.base[x.change.slot]!.head = res.seq;
          pushed++;
        } else if (res && 'conflict' in res) conflicted = true;
      });
      await this.save();
    }
    this.waiting = puts.length + dels.length - pushed;
    return { pushed, conflicted };
  }

  /** A file's chunks sealed and sent (only those the server doesn't have: an interrupted upload picks up where it
   *  stopped, since the same bytes are sealed with the same nonces again). Null when the file changed meanwhile. */
  private async upload(f: LocalFile, slot: string, sha: string, id: string): Promise<{ chunks: { h: string; n: number }[]; bytes: number } | null> {
    const count = Math.max(1, Math.ceil(f.size / CHUNK_BYTES));
    let j = this.state.journal.uploads[slot];
    if (!j || j.sha !== sha || j.id !== id || j.nonces.length !== count) {
      j = { sha, id, nonces: Array.from({ length: count }, () => randomBytes(12).toString('hex')) };
      this.state.journal.uploads[slot] = j;
      await this.save();
    }
    const key = this.d.keys.fileKey(id);
    const sealAll = async (want: Set<number> | null, each: (i: number, sealed: Buffer, n: number) => Promise<void>) => {
      const fh = await fsp.open(f.abs, 'r');
      try {
        const buf = Buffer.alloc(Math.min(CHUNK_BYTES, Math.max(f.size, 1)));
        for (let i = 0; i < count; i++) {
          const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK_BYTES, f.size - i * CHUNK_BYTES), i * CHUNK_BYTES);
          if (want && !want.has(i)) continue;
          const plain = buf.subarray(0, bytesRead);
          await each(i, this.d.keys.sealChunk(key, id, i, plain, Buffer.from(j!.nonces[i]!, 'hex')), bytesRead);
        }
      } finally {
        await fh.close();
      }
    };
    const chunks: { h: string; n: number }[] = [];
    let bytes = 0;
    await sealAll(null, async (_i, sealed, n) => {
      chunks.push({ h: sha256hex(sealed), n });
      bytes += sealed.length;
    });
    if ((await hashFile(f.abs)) !== sha) return null; // changed while being read: next round
    const missing = new Set(await this.d.api.missing(this.vid, [...new Set(chunks.map((c) => c.h))]));
    if (missing.size) {
      const want = new Set(chunks.map((c, i) => (missing.has(c.h) ? i : -1)).filter((i) => i >= 0));
      await sealAll(want, async (i, sealed) => {
        const h = sha256hex(sealed);
        if (h !== chunks[i]!.h) throw new NotNow('changed');
        if (!missing.has(h)) return;
        await this.d.api.putBlob(this.vid, h, sealed);
        missing.delete(h);
      });
    }
    return { chunks, bytes };
  }
}

const errCode = (err: unknown): string =>
  err instanceof SyncHttpError ? `${err.status} ${err.code}` : err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string' ? (err as { code: string }).code : err instanceof Error ? err.constructor.name : 'error';

// ---- The loop ---------------------------------------------------------------------------------------------------

export type RunnerState = 'idle' | 'syncing' | 'paused' | 'offline' | 'error' | 'stopped';

export interface RunnerDeps {
  engine: SyncEngine;
  api: SyncApi;
  vaultId: string;
  deviceId: string;
  /** Long-poll seconds (0: plain polling every `pollMs`). */
  wait?: number;
  pollMs?: number;
  debounceMs?: number;
  /** A full round at least this often even with nothing heard (config folders the watcher leaves out). */
  sweepMs?: number;
  /** Whether this PC may write the vault now (another app holding it: sync waits). */
  gate?(): Promise<boolean>;
  onStatus?(s: RunnerState, detail: { error?: string; err?: unknown; result?: RoundResult }): void;
}

/** Runs rounds: on a kick (the vault's watcher, debounced), when the long poll hears something, and now and then. */
export class SyncRunner {
  state: RunnerState = 'stopped';
  error = '';
  last: RoundResult | null = null;
  private running = false;
  private paused = false;
  private wake: (() => void) | null = null;
  private poll: AbortController | null = null;
  private debounce: NodeJS.Timeout | undefined;
  private kicked = false;
  private backoff = 0;
  private loop: Promise<void> | null = null;

  constructor(private readonly d: RunnerDeps) {}

  private set(s: RunnerState, detail: { error?: string; err?: unknown; result?: RoundResult } = {}) {
    this.state = s;
    this.d.onStatus?.(s, detail);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.kicked = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.debounce);
    this.poll?.abort();
    this.wake?.();
    await this.loop?.catch(() => {});
    this.loop = null;
    this.set('stopped');
  }

  pause(): void {
    this.paused = true;
    this.poll?.abort();
    this.set('paused');
  }

  resume(): void {
    this.paused = false;
    this.kick(0);
  }

  get isPaused() {
    return this.paused;
  }

  /** Something changed here: a round after the debounce (another change restarts the wait). */
  kick(ms = this.d.debounceMs ?? 2000): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.kicked = true;
      this.poll?.abort();
      this.wake?.();
    }, ms);
    this.debounce.unref?.();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      t.unref?.();
      this.wake = () => {
        clearTimeout(t);
        this.wake = null;
        resolve();
      };
    });
  }

  private async run(): Promise<void> {
    let lastRound = 0;
    while (this.running) {
      if (this.paused) {
        await this.sleep(60_000);
        continue;
      }
      const due = this.kicked || Date.now() - lastRound >= (this.d.sweepMs ?? 5 * 60_000);
      if (due && this.d.gate && !(await this.d.gate().catch(() => false))) {
        this.set('stopped', { error: 'read-only' });
        await this.sleep(30_000);
        continue;
      }
      if (due) {
        this.kicked = false;
        this.set('syncing');
        try {
          this.last = await this.d.engine.sync();
          lastRound = Date.now();
          this.backoff = 0;
          this.error = '';
          this.set('idle', { result: this.last });
        } catch (err) {
          const offline = !(err instanceof SyncHttpError) || err.status >= 500;
          this.error = err instanceof Error ? err.message : String(err);
          this.set(offline ? 'offline' : 'error', { error: this.error, err });
          this.backoff = Math.min(300_000, this.backoff ? this.backoff * 2 : 5_000);
          await this.sleep(this.backoff);
          this.kicked = true;
          continue;
        }
      }
      if (!this.running || this.paused) continue;
      // Wait for the server to have something newer (long poll), a kick, or the next sweep.
      const wait = this.d.wait ?? 25;
      if (wait > 0) {
        this.poll = new AbortController();
        try {
          const { changes } = await this.d.api.changes(this.d.vaultId, this.d.engine.state.cursor, { limit: 1, wait, device: this.d.deviceId, signal: this.poll.signal });
          if (changes.length) this.kicked = true;
        } catch (err) {
          if (!this.poll.signal.aborted) await this.sleep(Math.min(60_000, 5_000 + this.backoff));
          void err;
        } finally {
          this.poll = null;
        }
      } else await this.sleep(this.d.pollMs ?? 30_000);
    }
  }
}
