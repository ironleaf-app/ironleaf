// A file in a project's folder opens in the peek (27 Oct 2026). The project page's Latest files lists the files in the
// project's folder on the PC, but only those its Documents list names had a record, so every other one (a design's
// picture, a workbook in a dated subfolder) opened as "This isn't in the vault any more" while it sat right there, in every
// project; the side chat then went round in circles mending records. Now a file there is read from the disk and shown
// with its kind, place, size and date; only one that truly isn't in the folder any more says so.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { peekOf, type RecordModel, type RecordPeek, type RecordRef, type VaultRecord } from '../shared/records';

// The PC's own day (tests/local-days.test.mjs: never a world-time date).
const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const sizeWords = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The peek for a record, or for a file in its project's folder (`folderOf` gives a project note's folder: property). */
export async function peekWithFolderFiles(model: RecordModel, ref: RecordRef, folderOf: (projectPath: string) => unknown): Promise<RecordPeek | null> {
  const found = peekOf(model, ref);
  if (found || !ref.folderFile || !ref.path) return found;
  const folder = folderOf(ref.path);
  if (typeof folder !== 'string' || !folder.trim()) return null;
  const rel = ref.folderFile.replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(folder.trim(), ...rel.split('/'));
  const inside = path.relative(folder.trim(), abs);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return null;
  const st = await fsp.stat(abs).catch(() => null);
  if (!st?.isFile()) return null;
  const where = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')).replace(/\//g, ' › ') : '';
  const ext = (/\.([^./\\]+)$/.exec(rel)?.[1] ?? '').toUpperCase();
  const record = {
    id: `file:${ref.path}::${rel}`,
    type: 'file',
    title: rel.split('/').pop() ?? rel,
    path: ref.path,
    line: 0,
    project: ref.path,
    folderFile: rel,
    facts: [
      { key: 'kind', label: 'Kind', value: ext || 'File' },
      { key: 'where', label: 'In', value: `The project’s folder${where ? ` › ${where}` : ''}` },
      { key: 'size', label: 'Size', value: sizeWords(st.size) },
      { key: 'date', label: 'Changed', value: localDay(st.mtimeMs) },
    ],
  } as unknown as VaultRecord;
  const project = model.records.get(`project:${ref.path}`);
  return { record, groups: [], ...(project ? { projectTitle: project.title } : {}) };
}
