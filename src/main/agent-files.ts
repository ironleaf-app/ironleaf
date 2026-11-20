// Files agents make, delivered into the project they are for (18 Oct 2026). ONE RULE: anything an agent makes for a
// project lands in that project. An agent sends a file whole (small ones) or in parts (begin → append → finish, each part
// well under 1 MB and answered in a moment), checked against
// its SHA-256 when it is put together, then saved: into the project's folder on this PC when it has one, else into the
// project's own Files folder in the library (also for a project whose folder is on a remote computer, which Ironleaf
// reads but never changes). A name already there gets a new name ("Report (2).pdf") unless the agent asks to replace and
// is at Full control. Uploads part-way are kept in Ironleaf's own data (they carry on after a break) and tidied away
// after two hours.

import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants, createReadStream, promises as fsp, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CHUNK_BYTES, CHUNK_CHARS, MAX_FILE_BYTES, MAX_UPLOADS, UPLOAD_TTL_MS, freeName, safeFileName, safeSubfolder } from '../shared/agent-files';

/** Where files saved for a project, or attached to a note, go (src/main/app.ts gives it; the tests give folders). */
export interface AgentFilesHost {
  /** Its folder on this PC, else its own Files folder in the library (with the remote computer's name when its folder is
   *  on one). */
  target(projectRel: string): { kind: 'folder'; folder: string } | { kind: 'library'; folder: string; remoteName?: string };
  /** The library's whole path for a path inside it. */
  absolute(rel: string): string;
  /** A file written into the library: indexed and shown. */
  addedToLibrary(rel: string): Promise<void>;
  /** A file written into a project's folder on this PC: its Files and the files index see it. */
  addedToFolder?(projectRel: string, abs: string): void;
  /** A file to the Bin (Undo). */
  trashFile(abs: string): Promise<void>;
  /** The library folder a note's attachments go in. */
  attachmentsFor(noteRel: string): string;
  /** A file written into the library: its record beside it (who sent it, how, what it is, its note; src/main/vault-files.ts). */
  recorded?(rel: string, o: { by: string; how: 'agent' | 'url' | 'upload'; from?: string; what?: string; record?: string }): Promise<void>;
  /** A newer version of a file already in the library: the one there kept as an older version. Its version number. */
  newVersion?(rel: string, src: string, o: { by: string; how: 'agent' | 'url' | 'upload'; from?: string; move: boolean }): Promise<number>;
  /** A file on this PC linked to a note where it is (nothing copied). */
  reference?(record: string, abs: string, o: { by: string; what?: string }): Promise<{ name: string; folder: string }>;
}

export interface UploadMeta {
  id: string;
  agentId: string;
  agentName: string;
  tool: 'project_save_file' | 'note_attach_file';
  project?: string;
  note?: string;
  name: string;
  what?: string;
  folder?: string;
  replace: boolean;
  by?: string;
  /** A newer version of the file of that name (in Ironleaf's own Files). */
  newVersion?: boolean;
  /** Where it came from on the web (the former host app's fetch). */
  sourceUrl?: string;
  size: number;
  sha256?: string;
  received: number;
  next: number;
  created: number;
  touched: number;
}

const SHA = /^[0-9a-f]{64}$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Base64 (or base64url) read strictly: anything else is refused with plain words. */
export function decodeBase64(raw: unknown, max = CHUNK_CHARS): Buffer {
  if (typeof raw !== 'string') throw new Error('Give the file’s bytes as base64 text.');
  const s = raw.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (s.length > max) throw new Error(`That part is ${s.length.toLocaleString('en-AU')} characters of base64; at most ${max.toLocaleString('en-AU')} go in one call. Send the file in parts (step "begin", then "append" parts of ${CHUNK_BYTES.toLocaleString('en-AU')} bytes each).`);
  if (s.length % 4 === 1 || !B64.test(s)) throw new Error('That isn’t valid base64.');
  const padded = s.length % 4 ? s + '='.repeat(4 - (s.length % 4)) : s;
  return Buffer.from(padded, 'base64');
}

export const sha256Hex = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** The SHA-256 of a file, read in a stream (a 200 MB file never sits in memory). */
export function fileSha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

/** Uploads part-way, kept in Ironleaf's own data so a broken one carries on. */
export class AgentUploads {
  private uploads = new Map<string, UploadMeta>();
  private loaded = false;
  private timer?: NodeJS.Timeout;
  constructor(
    private dir: string,
    private now: () => number = Date.now,
    private log: (m: string) => void = () => {},
  ) {}

  private metaFile(id: string) {
    return path.join(this.dir, `${id}.json`);
  }
  partFile(id: string) {
    return path.join(this.dir, `${id}.part`);
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      for (const f of readdirSync(this.dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const m = JSON.parse(readFileSync(path.join(this.dir, f), 'utf8')) as UploadMeta;
          if (m && typeof m.id === 'string' && /^up_[A-Za-z0-9_-]{12,40}$/.test(m.id)) this.uploads.set(m.id, m);
        } catch {
          // A broken record: tidied below.
        }
      }
    } catch {
      // No uploads yet.
    }
    if (!this.timer) {
      this.timer = setInterval(() => void this.tidy(), 15 * 60 * 1000);
      this.timer.unref?.();
    }
  }

  private async save(m: UploadMeta): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
    const temp = `${this.metaFile(m.id)}.${process.pid}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(m), 'utf8');
    await fsp.rename(temp, this.metaFile(m.id));
  }

  /** Uploads not touched for two hours are removed (and stray parts with no record). */
  async tidy(): Promise<number> {
    this.load();
    let gone = 0;
    const old = this.now() - UPLOAD_TTL_MS;
    for (const m of [...this.uploads.values()]) {
      if (m.touched < old) {
        await this.drop(m.id);
        gone++;
      }
    }
    try {
      for (const f of await fsp.readdir(this.dir)) {
        const id = f.replace(/\.(json|part)$/, '');
        if (!this.uploads.has(id) && /\.(json|part)$/.test(f)) {
          const st = await fsp.stat(path.join(this.dir, f)).catch(() => null);
          if (st && st.mtimeMs < old) await fsp.rm(path.join(this.dir, f), { force: true });
        }
      }
    } catch {
      // Nothing there.
    }
    if (gone) this.log(`Agents: ${gone} unfinished ${gone === 1 ? 'upload was' : 'uploads were'} tidied away.`);
    return gone;
  }

  async drop(id: string): Promise<void> {
    this.uploads.delete(id);
    await fsp.rm(this.metaFile(id), { force: true }).catch(() => {});
    await fsp.rm(this.partFile(id), { force: true }).catch(() => {});
  }

  /** A new upload: its id. */
  async begin(input: Omit<UploadMeta, 'id' | 'received' | 'next' | 'created' | 'touched'>): Promise<{ meta: UploadMeta }> {
    this.load();
    await this.tidy();
    if (!Number.isInteger(input.size) || input.size < 1) throw new Error('Give size: the whole file’s size in bytes.');
    if (input.size > MAX_FILE_BYTES) throw new Error(`That file is ${(input.size / 1073741824).toFixed(1)} GB; at most ${MAX_FILE_BYTES / 1073741824} GB go into a project. For a file that big, link it where it is on the PC (reference) instead.`);
    if (input.sha256 !== undefined && !SHA.test(input.sha256)) throw new Error('sha256 is the file’s SHA-256 as 64 hex characters.');
    if (this.uploads.size >= MAX_UPLOADS) throw new Error('Too many uploads are open at once. Finish or cancel one first (or wait: unfinished ones are tidied away after two hours).');
    const id = `up_${randomBytes(12).toString('base64url')}`;
    const t = this.now();
    const meta: UploadMeta = { ...input, id, received: 0, next: 0, created: t, touched: t };
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(this.partFile(id), Buffer.alloc(0));
    await this.save(meta);
    this.uploads.set(id, meta);
    return { meta };
  }

  /** The upload an agent may carry on (its own, by id). */
  get(id: unknown, agentId: string): UploadMeta {
    this.load();
    const m = typeof id === 'string' ? this.uploads.get(id.trim()) : undefined;
    if (!m || m.agentId !== agentId) throw new Error('There is no upload with that id (it may have been finished, cancelled, or tidied away after two hours). Start again with step "begin".');
    return m;
  }

  /** One part, in order (the same part again is fine: it is already there). */
  async append(m: UploadMeta, index: unknown, base64: unknown): Promise<{ received: number; next: number; already?: boolean }> {
    const i = typeof index === 'number' ? index : typeof index === 'string' && /^\d+$/.test(index.trim()) ? Number(index) : NaN;
    if (!Number.isInteger(i) || i < 0) throw new Error('Give index: which part this is (0 is the first).');
    if (i < m.next) return { received: m.received, next: m.next, already: true };
    if (i > m.next) throw new Error(`Part ${m.next} comes next (parts go in order). Send part ${m.next}.`);
    const bytes = decodeBase64(base64);
    if (!bytes.length) throw new Error('That part is empty.');
    if (m.received + bytes.length > m.size) throw new Error(`That part goes past the size given at the start (${m.size.toLocaleString('en-AU')} bytes). Check size, or cancel and begin again.`);
    await fsp.appendFile(this.partFile(m.id), bytes);
    m.received += bytes.length;
    m.next += 1;
    m.touched = this.now();
    await this.save(m);
    return { received: m.received, next: m.next };
  }

  /** The parts put together and checked: the whole file's path (still in Ironleaf's data until it is saved). */
  async finish(m: UploadMeta, sha: unknown): Promise<string> {
    const given = typeof sha === 'string' && sha.trim() ? sha.trim().toLowerCase() : m.sha256;
    if (!given || !SHA.test(given)) throw new Error('Give sha256: the whole file’s SHA-256 (64 hex characters), so it is checked once put together.');
    if (m.received !== m.size) throw new Error(`Only ${m.received.toLocaleString('en-AU')} of ${m.size.toLocaleString('en-AU')} bytes have come (part ${m.next} is next). Send the rest, then finish.`);
    const got = await fileSha256(this.partFile(m.id));
    if (got !== given || (m.sha256 && m.sha256 !== given)) {
      await this.drop(m.id);
      throw new Error('The file put together doesn’t match its SHA-256, so it wasn’t saved (a part was lost or changed on the way). Start again with step "begin".');
    }
    return this.partFile(m.id);
  }
}

export interface Delivered {
  place: 'folder' | 'library';
  /** Inside the project's folder ('folder'), or from the top of the library ('library'). */
  path: string;
  abs: string;
  name: string;
  size: number;
  replaced: boolean;
  remoteName?: string;
  mtime: number;
  /** It became this version of the file of that name (the one there kept). */
  version?: number;
}

/** Moves (or copies) a finished file to its place: never over another file unless `replace`. */
async function putInPlace(source: string, dest: string, replace: boolean, move: boolean): Promise<void> {
  if (move) {
    if (!replace) {
      // A file that appeared since the name was chosen is never written over.
      if (await fsp.stat(dest).catch(() => null)) throw Object.assign(new Error('taken'), { code: 'EEXIST' });
    }
    try {
      await fsp.rename(source, dest);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    }
  }
  await fsp.copyFile(source, dest, replace ? 0 : fsConstants.COPYFILE_EXCL);
  if (move) await fsp.rm(source, { force: true });
}

/**
 * A finished file saved where it belongs: a project (its folder on this PC, else its own Files in the library) or a
 * note's attachments. A name already there: a new name, unless `replace` (the caller checks Full control).
 */
export async function deliver(host: AgentFilesHost, source: string, o: { project?: string; note?: string; name: string; folder?: string; replace: boolean; move: boolean; newVersion?: { by: string; how: 'agent' | 'url' | 'upload'; from?: string } }): Promise<Delivered> {
  const name = safeFileName(o.name);
  let dirAbs: string;
  let relDir: string;
  let place: 'folder' | 'library';
  let remoteName: string | undefined;
  if (o.project) {
    const t = host.target(o.project);
    const sub = safeSubfolder(o.folder);
    if (t.kind === 'folder') {
      const st = await fsp.stat(t.folder).catch(() => null);
      if (!st?.isDirectory()) throw new Error(`The project’s folder ${t.folder} isn’t on this PC any more, so the file wasn’t saved. Ask the person to fix the project’s folder.`);
      place = 'folder';
      relDir = sub;
      dirAbs = sub ? path.join(t.folder, ...sub.split('/')) : t.folder;
    } else {
      place = 'library';
      relDir = sub ? `${t.folder}/${sub}` : t.folder;
      dirAbs = host.absolute(relDir);
      remoteName = t.remoteName;
    }
  } else if (o.note) {
    place = 'library';
    relDir = host.attachmentsFor(o.note);
    dirAbs = relDir ? host.absolute(relDir) : host.absolute('');
  } else throw new Error('Give the project it is for.');
  await fsp.mkdir(dirAbs, { recursive: true });
  // A newer version of a file of that name in Ironleaf: the one there is kept (v1, v2…) and links reach this one.
  if (o.newVersion && place === 'library' && host.newVersion) {
    const here = (await fsp.readdir(dirAbs).catch(() => [] as string[])).find((n) => n.toLowerCase() === name.toLowerCase());
    if (here) {
      const rel = relDir ? `${relDir}/${here}` : here;
      const version = await host.newVersion(rel, source, { ...o.newVersion, move: o.move });
      const abs = path.join(dirAbs, here);
      const st = await fsp.stat(abs);
      return { place, path: rel, abs, name: here, size: st.size, replaced: false, ...(remoteName ? { remoteName } : {}), mtime: st.mtimeMs, version };
    }
  }
  for (let tries = 0; ; tries++) {
    const taken = new Set((await fsp.readdir(dirAbs).catch(() => [] as string[])).map((n) => n.toLowerCase()));
    const replacing = o.replace && taken.has(name.toLowerCase());
    const chosen = replacing ? (await fsp.readdir(dirAbs)).find((n) => n.toLowerCase() === name.toLowerCase())! : freeName(name, taken);
    const abs = path.join(dirAbs, chosen);
    try {
      await putInPlace(source, abs, replacing, o.move);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST' && tries < 5) continue;
      throw err;
    }
    const st = await fsp.stat(abs);
    const rel = relDir ? `${relDir}/${chosen}` : chosen;
    if (place === 'library') await host.addedToLibrary(rel);
    else if (o.project) host.addedToFolder?.(o.project, abs);
    return { place, path: rel, abs, name: chosen, size: st.size, replaced: replacing, ...(remoteName ? { remoteName } : {}), mtime: st.mtimeMs };
  }
}
