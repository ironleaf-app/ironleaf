// A project's files as the page shows them (the Files tab, views/project/ProjectTabs87.tsx): what kind each one is, found by
// words, filtered by kind, sorted, grouped by folder with the pinned documents left out of the groups, and how each one
// is previewed. No React and no window here, so it is tested on its own (tests/project-files.test.mjs).

import type { ProjectFile, ProjectFiles } from '../../../../shared/types';

export type FileCategory = 'documents' | 'spreadsheets' | 'slides' | 'pdfs' | 'pictures' | 'other';
export type FileSort = 'newest' | 'name' | 'size';
export type FileViewer = 'image' | 'pdf' | 'video' | 'audio' | 'markdown' | 'text' | 'csv' | 'office' | 'none';

export const CATEGORIES: FileCategory[] = ['documents', 'spreadsheets', 'slides', 'pdfs', 'pictures', 'other'];
export const CATEGORY_WORDS: Record<FileCategory, string> = { documents: 'Documents', spreadsheets: 'Spreadsheets', slides: 'Slides', pdfs: 'PDFs', pictures: 'Pictures', other: 'Other' };
export const SORT_WORDS: Record<FileSort, string> = { newest: 'Newest', name: 'Name', size: 'Size' };

const EXT: Record<string, FileCategory> = {};
for (const e of ['docx', 'doc', 'docm', 'odt', 'rtf', 'md', 'markdown', 'txt', 'pages']) EXT[e] = 'documents';
for (const e of ['xlsx', 'xlsm', 'xls', 'xlsb', 'csv', 'tsv', 'ods', 'numbers']) EXT[e] = 'spreadsheets';
for (const e of ['pptx', 'ppt', 'pptm', 'odp', 'key']) EXT[e] = 'slides';
EXT.pdf = 'pdfs';
for (const e of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif', 'tif', 'tiff', 'ico']) EXT[e] = 'pictures';

export const categoryOf = (ext: string): FileCategory => EXT[ext.toLowerCase()] ?? 'other';

/** How a file is shown in the preview beside the list. */
export function viewerFor(ext: string): FileViewer {
  const e = ext.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'].includes(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (['mp4', 'mov', 'webm', 'm4v', 'ogv', 'mkv'].includes(e)) return 'video';
  if (['mp3', 'wav', 'm4a', 'ogg', 'oga', 'flac', 'aac'].includes(e)) return 'audio';
  if (['md', 'markdown'].includes(e)) return 'markdown';
  if (['csv', 'tsv'].includes(e)) return 'csv';
  if (['txt', 'json', 'yaml', 'yml', 'xml', 'log', 'ini', 'ps1', 'sh', 'bat', 'cmd', 'js', 'ts', 'py', 'sql', 'html', 'css'].includes(e)) return 'text';
  if (['docx', 'doc', 'docm', 'odt', 'rtf', 'xlsx', 'xlsm', 'xls', 'xlsb', 'ods', 'pptx', 'ppt', 'pptm', 'odp', 'msg', 'eml', 'vsdx', 'pub', 'one'].includes(e)) return 'office';
  return 'none';
}

/** Whether Ironleaf can show the file itself (else it opens in its program). */
export const showsHere = (ext: string) => !['office', 'none'].includes(viewerFor(ext));
/** The same for a project's folder on a remote computer, where Word, Excel and PowerPoint files show as their words (they
 *  can't open in their programs from there). */
export const showsHereFor = (ext: string, remote: boolean) => showsHere(ext) || (remote && viewerFor(ext) === 'office');

export const relKey = (rel: string) => rel.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

/** A file's place in the notes' terms: file:// for a path on this PC (C:\… or /…), each part encoded. */
export function folderFileUrl(folder: string, rel: string): string {
  const full = `${folder.replace(/\\/g, '/').replace(/\/+$/, '')}/${rel.replace(/\\/g, '/')}`;
  if (full.startsWith('//')) return `file:${full.split('/').map((part, i) => (i < 2 ? part : encodeURIComponent(part))).join('/')}`;
  const encoded = full
    .split('/')
    .map((part, i) => (i === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)))
    .join('/');
  return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`;
}

/**
 * Files that match the words typed (in their name, folder or description, or, by `inside`, in their words: the files
 * index found them there) and the kind chosen.
 */
export function filterFiles(files: ProjectFile[], query: string, category: FileCategory | 'all', describe: (f: ProjectFile) => string | undefined = () => undefined, inside?: (f: ProjectFile) => boolean): ProjectFile[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return files.filter((f) => {
    if (category !== 'all' && categoryOf(f.ext) !== category) return false;
    if (!words.length) return true;
    const hay = `${f.rel} ${describe(f) ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w)) || !!inside?.(f);
  });
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortFiles(files: ProjectFile[], sort: FileSort): ProjectFile[] {
  const out = [...files];
  if (sort === 'name') out.sort((a, b) => byName.compare(a.name, b.name) || byName.compare(a.rel, b.rel));
  else if (sort === 'size') out.sort((a, b) => b.size - a.size || byName.compare(a.name, b.name));
  else out.sort((a, b) => b.modified - a.modified || byName.compare(a.name, b.name));
  return out;
}

/** How many files of each kind there are (only the kinds there are, in the usual order). */
export function categoryCounts(files: ProjectFile[]): { category: FileCategory; count: number }[] {
  const counts = new Map<FileCategory, number>();
  for (const f of files) counts.set(categoryOf(f.ext), (counts.get(categoryOf(f.ext)) ?? 0) + 1);
  return CATEGORIES.filter((c) => counts.has(c)).map((category) => ({ category, count: counts.get(category)! }));
}

export interface FileGroup {
  /** The folder's name inside the project's folder ('' for the files in the folder itself). */
  name: string;
  /** Its files that are shown (matching, sorted), the pinned ones left out. */
  files: ProjectFile[];
  /** How many files it has in all, the pinned ones left out. */
  total: number;
  /** When its newest file changed. */
  newest: number;
}

/**
 * The folder's groups as the page lists them: every file not pinned, by folder, matching what was typed and chosen,
 * sorted. The folder's own files come first; then folders by their newest file (by name when sorted by name). Groups
 * with nothing left in them are left out.
 */
export function fileGroups(files: ProjectFiles, pinned: Set<string>, query: string, category: FileCategory | 'all', sort: FileSort, describe?: (f: ProjectFile) => string | undefined, inside?: (f: ProjectFile) => boolean): FileGroup[] {
  const out: FileGroup[] = [];
  for (const g of files.groups) {
    const own = g.files.filter((f) => !pinned.has(relKey(f.rel)));
    if (!own.length) continue;
    const shown = sortFiles(filterFiles(own, query, category, describe, inside), sort);
    if (!shown.length) continue;
    out.push({ name: g.name, files: shown, total: own.length, newest: Math.max(...own.map((f) => f.modified)) });
  }
  return out.sort((a, b) => (a.name === '' ? -1 : b.name === '' ? 1 : sort === 'name' ? byName.compare(a.name, b.name) : b.newest - a.newest));
}

/** "3 Oct" style is the page's; this is the group's line: "79 files · newest 2 Oct". */
export function groupWords(g: FileGroup, filtered: boolean, when: (ms: number) => string): string {
  const count = filtered && g.files.length !== g.total ? `${g.files.length} of ${g.total} files` : `${g.total} ${g.total === 1 ? 'file' : 'files'}`;
  return `${count} · newest ${when(g.newest)}`;
}

/** A CSV's first rows as cells (quoted cells understood), for its preview. */
export function csvRows(text: string, maxRows = 60, separator = text.split('\n', 1)[0].includes('\t') ? '\t' : ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === separator) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if ((cell || row.length) && rows.length < maxRows) rows.push([...row, cell]);
  return rows;
}
