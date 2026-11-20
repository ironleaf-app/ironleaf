// A project's folder, wherever it is (src/shared/project-folder.ts): on this PC, read from the disk; on a remote computer
// the former host app connects to, read through the former host app (the host's remoteFolder: its connection, its saved
// sign-in, read only). The Files panel, the viewer, the assistant's folder tools and Catch up all come here, so a remote
// project is as readable as one on this PC, and the project itself is the permission: nobody names or adds its folder to
// read it.

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { FILE_INDEX_LIMITS, type IndexedFile } from '../shared/file-index';
import { remoteProblem, type ProjectWhere, type RemoteProblem, type RemoteWhere } from '../shared/project-folder';
import type { ProjectFile, ProjectFiles } from '../shared/types';
import { folderFiles, groupFiles, insideFolder, walkFolder } from './projects';
import { isAppData, shouldSkipFile, skipDir } from './project-places';

/** One request to the former host app for a remote folder (the former host app's remote-servers/project-folder.js
answers). */
export type RemoteFolderAsk = (request: { computer: string; root: string; op: 'info' | 'list' | 'changed' | 'find' | 'read' | 'bytes'; path?: string; depth?: number; limit?: number; since?: number | string; query?: string; maxBytes?: number }) => Promise<any>;

export interface FolderEntry {
  /** From the project's folder, with forward slashes. */
  path: string;
  name: string;
  kind: 'folder' | 'file';
  ext?: string;
  size?: number;
  modified?: number;
}

/** A folder that couldn't be read, with the person's words for why. */
export class FolderProblem extends Error {
  constructor(readonly problem: RemoteProblem) {
    super(problem.hint ? `${problem.words} ${problem.hint}` : problem.words);
  }
}

const extOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
const entryOf = (e: { path: string; name: string; kind: string; size?: number; modified?: number | null }): FolderEntry => ({
  path: String(e.path),
  name: String(e.name),
  kind: e.kind === 'folder' ? 'folder' : 'file',
  ...(e.kind === 'folder' ? {} : { ext: extOf(String(e.name)), size: Number(e.size) || 0 }),
  ...(typeof e.modified === 'number' ? { modified: e.modified } : {}),
});

/** The former host app's remote folders, with the computers' names as the former host app gives them and a short memory of
listings. */
export class RemoteFolders {
  private names = new Map<string, string>();
  private cache = new Map<string, { at: number; value: unknown }>();
  /** Requests on their way, so the same look asked twice at once goes to the computer once. */
  private asking = new Map<string, Promise<unknown>>();
  constructor(
    private ask: RemoteFolderAsk | undefined,
    private now: () => number = Date.now,
  ) {}

  get available(): boolean {
    return !!this.ask;
  }

  /** The former host app installed after this start (16 Nov 2026 audit finding 12): its remote folders attach, no
restart. */
  setAsk(ask: RemoteFolderAsk | undefined): void {
    this.ask = ask;
  }

  /** The computer's name: The former host app's once it has answered, else what the project says. */
  nameOf(w: RemoteWhere): string {
    return this.names.get(w.computer) ?? w.computerName;
  }

  async call<T = any>(w: RemoteWhere, op: Parameters<RemoteFolderAsk>[0]['op'], extra: Record<string, unknown> = {}, ttl = 0): Promise<T> {
    const key = JSON.stringify([w.computer, w.path, op, extra]);
    if (ttl) {
      const hit = this.cache.get(key);
      if (hit && this.now() - hit.at < ttl) return hit.value as T;
    }
    if (!this.ask) throw new FolderProblem(remoteProblem('standalone', this.nameOf(w)));
    let value: any;
    const ask = this.ask;
    let going = op === 'bytes' ? undefined : this.asking.get(key);
    if (!going) {
      going = ask({ computer: w.computer, root: w.path, op, ...extra }).finally(() => this.asking.delete(key));
      if (op !== 'bytes') this.asking.set(key, going);
    }
    try {
      value = await going;
    } catch (err) {
      const e = err as { kind?: string; message?: string };
      throw new FolderProblem(remoteProblem(e?.kind, this.nameOf(w), e?.message));
    }
    if (typeof value?.computer?.name === 'string' && value.computer.name) this.names.set(w.computer, value.computer.name);
    if (ttl) {
      this.cache.set(key, { at: this.now(), value });
      if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
    }
    return value as T;
  }

  /** What was kept of a folder is forgotten (Refresh). The prefix is unambiguous: JSON escapes quotes in names. */
  forget(w: RemoteWhere): void {
    for (const k of [...this.cache.keys()]) if (k.startsWith(JSON.stringify([w.computer, w.path]).slice(0, -1))) this.cache.delete(k);
  }

}

/** How a folder is named in words: "MarketingMachine on fileserver-01", or the folder's path on this PC. */
export function placeWords(w: ProjectWhere, remote: RemoteFolders): string {
  return w.kind === 'local' ? w.folder : `${w.folderName} on ${remote.nameOf(w)}`;
}

/** One level, or a tree to `depth`, of a folder on this PC (hidden, junk, links and app data left out). */
async function listLocal(folder: string, rel: string, depth: number, limit: number): Promise<{ entries: FolderEntry[]; truncated: boolean }> {
  const start = rel ? insideFolder(folder, rel) : folder;
  const info = await stat(start).catch(() => null);
  if (!info) throw new FolderProblem({ kind: rel ? 'missing' : 'gone', words: rel ? `There is no ${rel} in the project’s folder.` : `The folder ${folder} isn’t on this PC (it may have moved).` });
  if (!info.isDirectory()) throw new FolderProblem({ kind: 'not-a-file', words: `${rel} is a file, not a folder.` });
  const entries: FolderEntry[] = [];
  let truncated = false;
  let level = [start];
  for (let d = 1; d <= depth && level.length && !truncated; d++) {
    const next: string[] = [];
    for (const dir of level) {
      let list;
      try {
        list = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of list) {
        if (e.name.startsWith('.') || e.name.startsWith('~$') || e.isSymbolicLink()) continue;
        const abs = path.join(dir, e.name);
        const r = path.relative(folder, abs).split(path.sep).join('/');
        if (e.isDirectory()) {
          if (skipDir(e.name) || (await isAppData(abs))) continue;
          const s = await stat(abs).catch(() => null);
          entries.push({ path: r, name: e.name, kind: 'folder', ...(s ? { modified: s.mtimeMs } : {}) });
          if (d < depth) next.push(abs);
        } else if (e.isFile() && !shouldSkipFile(e.name)) {
          const s = await stat(abs).catch(() => null);
          if (s) entries.push({ path: r, name: e.name, kind: 'file', ext: extOf(e.name), size: s.size, modified: s.mtimeMs });
        }
        if (entries.length >= limit) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
    level = next;
  }
  return { entries, truncated };
}

/** A project's folder read the same way wherever it is. */
export class ProjectFolders {
  constructor(
    readonly remote: RemoteFolders,
    private readIndexed: (project: string, rel: string) => Promise<{ file: IndexedFile }>,
  ) {}

  /** Every file for the Files panel (four folders deep, newest first, grouped), or why it can't be listed. */
  async files(w: ProjectWhere, { fresh = false } = {}): Promise<ProjectFiles> {
    if (w.kind === 'local') return folderFiles(w.folder);
    const handle = `remote:${w.computer}:${w.path}`;
    if (fresh) this.remote.forget(w);
    try {
      const v = await this.remote.call<{ computer: { name: string; os?: string | null }; root: string; entries: { path: string; name: string; kind: string; size?: number; modified?: number | null }[]; truncated?: boolean }>(w, 'list', { depth: 4, limit: FILE_INDEX_LIMITS.files + 1500 }, 20_000);
      const all: ProjectFile[] = v.entries.filter((e) => e.kind === 'file').map((e) => ({ rel: e.path, name: e.name, ext: extOf(e.name), size: Number(e.size) || 0, modified: Number(e.modified) || 0 }));
      return { ...groupFiles(handle, all, FILE_INDEX_LIMITS.files), remote: { computer: w.computer, name: v.computer?.name || this.remote.nameOf(w), path: v.root || w.path, os: v.computer?.os ?? null }, ...(v.truncated ? { partial: true } : {}) };
    } catch (err) {
      const problem = err instanceof FolderProblem ? err.problem : remoteProblem('failed', this.remote.nameOf(w), err instanceof Error ? err.message : String(err));
      return { folder: handle, exists: false, groups: [], total: 0, more: 0, remote: { computer: w.computer, name: this.remote.nameOf(w), path: w.path }, problem };
    }
  }

  /** One level (or a few) of the folder, or a folder inside it. */
  async list(w: ProjectWhere, rel = '', depth = 1): Promise<{ entries: FolderEntry[]; truncated: boolean }> {
    if (w.kind === 'local') return listLocal(w.folder, rel, depth, 600);
    const v = await this.remote.call(w, 'list', { path: rel, depth, limit: 600 }, 10_000);
    return { entries: (v.entries ?? []).map(entryOf), truncated: !!v.truncated };
  }

  /** The files changed since a time, newest first. */
  async changed(w: ProjectWhere, since: number, limit = 80): Promise<{ files: FolderEntry[]; more: number; truncated: boolean }> {
    if (w.kind === 'local') {
      const all = await walkFolder(w.folder, 8);
      if (!all) throw new FolderProblem({ kind: 'gone', words: `The folder ${w.folder} isn’t on this PC (it may have moved).` });
      const files = all.filter((f) => f.modified > since);
      const more = Math.max(0, files.length - limit);
      return { files: files.slice(0, limit).map((f) => ({ path: f.rel, name: f.name, kind: 'file', ext: f.ext, size: f.size, modified: f.modified })), more, truncated: more > 0 };
    }
    const v = await this.remote.call(w, 'changed', { since, limit }, 10_000);
    const more = Number(v.more) || 0;
    return { files: (v.files ?? []).map(entryOf), more, truncated: !!v.truncated || more > 0 };
  }

  /** Files and folders whose path holds every word. */
  async find(w: ProjectWhere, query: string, limit = 60): Promise<{ entries: FolderEntry[]; more: number }> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return { entries: [], more: 0 };
    if (w.kind === 'local') {
      const all = (await walkFolder(w.folder, 8)) ?? [];
      const found = all.filter((f) => words.every((x) => f.rel.toLowerCase().includes(x)));
      return { entries: found.slice(0, limit).map((f) => ({ path: f.rel, name: f.name, kind: 'file', ext: f.ext, size: f.size, modified: f.modified })), more: Math.max(0, found.length - limit) };
    }
    const v = await this.remote.call(w, 'find', { query: words.join(' '), limit }, 10_000);
    return { entries: (v.entries ?? []).map(entryOf), more: Number(v.more) || 0 };
  }

  /** A file's words: text as it is, documents by their readers (the former host app's, on a remote computer). */
  async read(project: string, w: ProjectWhere, rel: string): Promise<IndexedFile> {
    if (w.kind === 'local') return (await this.readIndexed(project, rel)).file;
    const v = await this.remote.call<{ file: { path: string; name: string; size: number; modified: number | null }; kind: 'text' | 'document' | 'binary'; text: string | null; truncated?: boolean }>(w, 'read', { path: rel, maxBytes: 1024 * 1024 });
    const f = v.file;
    const base = { rel: f.path, name: f.name, ext: extOf(f.name), size: f.size, modified: f.modified ?? 0 };
    if (v.kind === 'binary') return { ...base, state: 'name' };
    if (typeof v.text !== 'string') return { ...base, state: v.kind === 'document' ? 'failed' : 'name' };
    const text = v.text.slice(0, FILE_INDEX_LIMITS.fileChars);
    return { ...base, state: text.replace(/^\f.*$/gm, '').trim() ? 'text' : 'empty', text, ...(v.truncated || v.text.length > text.length ? { cut: true } : {}) };
  }

  /** A remote file as it is (a picture, a PDF, a recording), for the viewer. */
  async bytes(w: RemoteWhere, rel: string): Promise<Buffer> {
    const v = await this.remote.call<{ base64: string }>(w, 'bytes', { path: rel }, 0);
    return Buffer.from(v.base64, 'base64');
  }
}
