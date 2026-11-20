// Links resolved in the window, without asking the main side (for drawing links as found or missing, embeds, previews):
// the same rules as the index — a path when the link names a folder, else a title or alias (the same folder first, then
// the shortest path), else a file by its name.

import { getState } from '../state/store';
import type { ListedFile, NoteMeta } from '../../../shared/types';

interface Maps {
  notes: NoteMeta[];
  files: ListedFile[];
  byName: Map<string, string[]>;
  byPath: Map<string, string>;
  fileByName: Map<string, string[]>;
  fileByPath: Map<string, string>;
}

let cache: Maps | null = null;

const norm = (s: string) => s.replace(/\\/g, '/').replace(/\.md$/i, '').trim().toLowerCase();

function maps(): Maps {
  const { notes, files } = getState();
  if (cache && cache.notes === notes && cache.files === files) return cache;
  const byName = new Map<string, string[]>();
  const byPath = new Map<string, string>();
  for (const n of notes) {
    byPath.set(norm(n.path), n.path);
    for (const name of [n.title, ...n.aliases]) {
      const key = norm(name);
      const list = byName.get(key) ?? [];
      list.push(n.path);
      byName.set(key, list);
    }
  }
  const fileByName = new Map<string, string[]>();
  const fileByPath = new Map<string, string>();
  for (const f of files) {
    if (f.kind === 'note') continue;
    fileByPath.set(f.rel.toLowerCase(), f.rel);
    const key = (f.rel.split('/').pop() ?? f.rel).toLowerCase();
    const list = fileByName.get(key) ?? [];
    list.push(f.rel);
    fileByName.set(key, list);
  }
  cache = { notes, files, byName, byPath, fileByName, fileByPath };
  return cache;
}

const dirOf = (p?: string) => (p && p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

export function resolveNote(target: string, from?: string): string | null {
  const m = maps();
  const key = norm(target);
  if (!key) return from ?? null;
  if (key.includes('/')) {
    const exact = m.byPath.get(key);
    if (exact) return exact;
    const rel = m.byPath.get(norm(dirOf(from) ? `${dirOf(from)}/${target}` : target));
    if (rel) return rel;
  }
  const list = m.byName.get(key.split('/').pop() ?? key);
  if (!list?.length) return null;
  if (list.length === 1) return list[0];
  const dir = dirOf(from);
  const same = list.find((p) => dir && dirOf(p) === dir);
  // Ambiguous and no same-folder winner (9.2 uplift F71): nothing, never a silent pick of the shortest path.
  // Callers treat it as unresolved (near-match choice, picker, or a new note).
  return same ?? null;
}

export function resolveFile(target: string, from?: string): string | null {
  const m = maps();
  const t = target.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!t || /\.md$/i.test(t)) return null;
  const exact = m.fileByPath.get(t.toLowerCase());
  if (exact) return exact;
  if (dirOf(from)) {
    const rel = m.fileByPath.get(`${dirOf(from)}/${t}`.toLowerCase());
    if (rel) return rel;
  }
  const list = m.fileByName.get((t.split('/').pop() ?? t).toLowerCase());
  // Ambiguous (9.2 uplift F71): nothing, never a silent pick of the shortest path.
  return list?.length === 1 ? list[0] : null;
}

/** A link's target: a note, else a file. */
export function resolveAny(target: string, from?: string): string | null {
  return resolveNote(target, from) ?? resolveFile(target, from);
}

/** A file in the notes as a URL the window can show (pictures, PDFs, audio, video). */
export function fileUrl(rel: string): string {
  const root = getState().vault?.path ?? '';
  const full = `${root.replace(/\\/g, '/').replace(/\/$/, '')}/${rel}`;
  const encoded = full
    .split('/')
    .map((part, i) => (i === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)))
    .join('/');
  return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`;
}

export const isImage = (p: string) => /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(p);
export const isPdf = (p: string) => /\.pdf$/i.test(p);
export const isAudio = (p: string) => /\.(mp3|wav|m4a|ogg|oga|flac|aac|weba)$/i.test(p);
export const isVideo = (p: string) => /\.(mp4|mov|mkv|webm|ogv|m4v)$/i.test(p);
