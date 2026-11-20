// Notion files no page holds, kept not dropped (10.0 item 16, F17): an export's diagrams
// and files that no page shows go to one Unplaced files note under the import folder,
// listed with where they came from, so none is lost. Pure: the reader collects them.

import { fileSafe, linkToken, type SourceFile, type SourceItem } from './source';

/** One note carrying files no page holds, listed with their relative paths. Null when none. */
export function unplacedFilesItem(orphans: { rel: string; abs: string }[]): SourceItem | null {
  if (!orphans.length) return null;
  const sorted = [...orphans].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const files: SourceFile[] = sorted.map((o) => ({ key: o.rel.toLowerCase(), name: fileSafe(o.rel.split('/').pop()!, 'File'), abs: o.abs }));
  const body = ['Files from the export that no page holds, kept here with where they came from:', '', ...sorted.map((o) => `- ${o.rel}: ${linkToken('file', o.rel.toLowerCase(), fileSafe(o.rel.split('/').pop()!, 'File'))}`), ''].join('\n');
  return { id: 'unplaced-files', title: 'Unplaced files', folder: '', props: {}, body, files };
}
