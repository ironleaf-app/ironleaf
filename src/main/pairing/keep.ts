// Google Keep through Google Takeout (V9, 28 Oct 2026): Takeout/Keep holds one JSON file per note — title, textContent
// or listContent (each item's text and isChecked), labels, color, isPinned, isArchived, isTrashed, created and edited
// times in microseconds, annotations (web links) and attachments (a picture or recording beside the JSON) — plus an
// HTML copy of each, which is not needed. Notes in Keep's bin stay out.

import { promises as fsp } from 'node:fs';
import nodePath from 'node:path';
import { fileSafe, firstWords, isoMinute, linkToken, tagSafe, type SourceFile, type SourceItem, type SourceRead } from './source';

interface KeepNote {
  title?: string;
  textContent?: string;
  listContent?: { text?: string; isChecked?: boolean }[];
  labels?: { name?: string }[];
  color?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  isTrashed?: boolean;
  createdTimestampUsec?: number;
  userEditedTimestampUsec?: number;
  annotations?: { url?: string; title?: string }[];
  attachments?: { filePath?: string; mimetype?: string }[];
}

/** Whether a parsed JSON is a Keep note. */
export const isKeepNote = (j: unknown): j is KeepNote => !!j && typeof j === 'object' && !Array.isArray(j) && ('textContent' in j || 'listContent' in j) && ('userEditedTimestampUsec' in j || 'isTrashed' in j || 'isArchived' in j);

/** The folder of Keep's JSON files inside a Takeout export (or the folder itself). */
export async function keepFolder(root: string): Promise<string | null> {
  for (const c of [nodePath.join(root, 'Takeout', 'Keep'), nodePath.join(root, 'Keep'), root]) {
    const names = await fsp.readdir(c).catch(() => [] as string[]);
    for (const n of names.filter((x) => /\.json$/i.test(x)).slice(0, 5)) {
      const j = await fsp.readFile(nodePath.join(c, n), 'utf8').then((t) => JSON.parse(t) as unknown, () => null);
      if (isKeepNote(j)) return c;
    }
  }
  return null;
}

const usec = (n: unknown) => (typeof n === 'number' && n > 0 ? new Date(Math.floor(n / 1000)) : null);

export async function readKeep(root: string): Promise<SourceRead> {
  const dir = (await keepFolder(root)) ?? root;
  const names = (await fsp.readdir(dir).catch(() => [] as string[])).filter((n) => /\.json$/i.test(n)).sort();
  const listed = await fsp.readdir(dir).catch(() => [] as string[]);
  const all = new Set(listed.map((n) => n.toLowerCase()));
  const items: SourceItem[] = [];
  let trashed = 0;
  let missing = 0;
  for (const name of names) {
    const j = await fsp.readFile(nodePath.join(dir, name), 'utf8').then((t) => JSON.parse(t) as unknown, () => null);
    if (!isKeepNote(j)) continue;
    if (j.isTrashed) {
      trashed++;
      continue;
    }
    const created = usec(j.createdTimestampUsec);
    const edited = usec(j.userEditedTimestampUsec);
    const text = (j.textContent ?? '').replace(/\r\n?/g, '\n');
    const list = (j.listContent ?? []).map((i) => `- [${i.isChecked ? 'x' : ' '}] ${(i.text ?? '').replace(/\n+/g, ' ').trim()}`);
    const title = fileSafe((j.title ?? '').trim() || firstWords(text || (j.listContent ?? []).map((i) => i.text ?? '').join(' '), 50) || (created ? `Keep note ${isoMinute(created).replace('T', ' ')}` : stemOf(name)), 'Keep note');
    const files: SourceFile[] = [];
    const shown: string[] = [];
    for (const a of j.attachments ?? []) {
      const p = a.filePath ?? '';
      // Takeout sometimes names the picture with another ending than the note says (.jpg for .jpeg, .png): found by its name.
      const stem = p.replace(/\.[^.]+$/, '').toLowerCase();
      const found = p && (all.has(p.toLowerCase()) ? p : [...all].find((x) => x.replace(/\.[^.]+$/, '') === stem && !/\.(json|html)$/.test(x)));
      if (!found) {
        if (p) missing++;
        continue;
      }
      const real = listed.find((x) => x.toLowerCase() === found.toLowerCase()) ?? found;
      const f = { key: `keep/${real.toLowerCase()}`, name: fileSafe(real, 'Picture'), abs: nodePath.join(dir, real) };
      files.push(f);
      shown.push((a.mimetype ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(found) ? linkToken('embed-file', f.key) : linkToken('file', f.key, f.name));
    }
    const links = (j.annotations ?? []).filter((a) => a.url).map((a) => `- [${(a.title || a.url)!.replace(/[[\]]/g, '')}](${a.url})`);
    const body = [text.trim(), list.join('\n'), shown.join('\n\n'), links.length ? `## Links\n\n${links.join('\n')}` : ''].filter(Boolean).join('\n\n');
    const props: Record<string, string | boolean | string[]> = {};
    const tags = (j.labels ?? []).map((l) => tagSafe(l.name ?? '')).filter(Boolean);
    if (tags.length) props.tags = [...new Set(tags)];
    if (created) props.created = isoMinute(created);
    if (edited) props.updated = isoMinute(edited);
    if (j.color && j.color !== 'DEFAULT') props.color = j.color.toLowerCase();
    if (j.isPinned) props.pinned = true;
    if (j.isArchived) props.archived = true;
    items.push({ id: j.createdTimestampUsec ? `keep/${j.createdTimestampUsec}` : `keep/${name.toLowerCase()}`, title, folder: '', props, body: body ? `${body}\n` : '', files });
  }
  const skipped: { what: string; why: string }[] = [];
  if (trashed) skipped.push({ what: `${trashed} ${trashed === 1 ? 'note' : 'notes'}`, why: 'in Keep’s bin' });
  if (missing) skipped.push({ what: `${missing} ${missing === 1 ? 'picture' : 'pictures'}`, why: 'not in the export' });
  return { kind: 'keep', name: '', items, views: [], skipped };
}

const stemOf = (name: string) => name.replace(/\.[^.]+$/, '');
