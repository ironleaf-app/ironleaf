// Files as records for the view builder (Wave 4 part c, 24 Oct 2026): every file in the vault (src/main/vault-files.ts
// catalogue) as a record a view can lay out as a gallery or a table, grouped and filtered by what it is for, its version,
// where it came from, its area, who sent it — the same views a project's workspace builds (src/shared/record-views.ts).
// A project's workspace has its files from its Documents list and its folder; the files kept with it in Ironleaf add
// to them, and what Ironleaf knows (versions, source, a line on what it says) fills in what the list didn't say.
//
// Pure: no files, no window.

import type { CatalogueItem } from './vault-files-api';
import type { FieldValue, WsRecord } from './workspace-records';
import { dayWords, sizeWords, titleFromName } from './file-records';
import { levelLabel, isLevel } from './sensitivity';

export const FILE_FIELDS = ['purpose', 'belongs', 'version', 'status', 'from', 'by', 'added', 'area', 'level', 'what', 'type', 'size', 'where'] as const;

const titleOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.(md|canvas)$/i, '');

/** A file as a record: opened by its path (the peek shows its details, versions and source). */
export function fileRecord(item: CatalogueItem, o: { areaName?: (id: string) => string | undefined; project?: { path: string; name: string } } = {}): WsRecord {
  const by = item.source ? (item.source.by === 'you' ? 'You' : item.source.by) : null;
  const fields: Record<string, FieldValue> = {
    purpose: item.purpose,
    belongs: item.record ? titleOf(item.record) : null,
    version: item.version > 1 || item.older ? `v${item.version}` : null,
    status: item.supersededBy ? 'Superseded' : item.ref ? (item.ref.missing ? 'Not on this PC' : 'On this PC') : 'Latest',
    from: item.sourceWords || null,
    by,
    added: item.added ? item.added.slice(0, 10) : null,
    area: item.area ? (o.areaName?.(item.area) ?? item.area) : null,
    level: isLevel(item.level) && item.level !== 'open' ? levelLabel(item.level) : null,
    // What it is: its line, else a title of its own (not one made from its name, which the tile shows already).
    what: item.summary ?? (item.title && item.title !== titleFromName(item.name) && item.title !== item.name ? item.title : null),
    type: item.ext ? item.ext.toUpperCase() : null,
    size: item.size ? sizeWords(item.size) : null,
    where: item.folder || null,
  };
  return {
    id: `vault::file:${item.path}`,
    kind: 'file',
    title: item.name,
    path: item.path,
    ...(o.project ? { project: o.project.path, projectName: o.project.name } : {}),
    fields,
    links: [],
  };
}

/** Every file in the vault as records (notes' own files: templates and Ironleaf's own left out). */
export function vaultFileRecords(items: CatalogueItem[], areaName?: (id: string) => string | undefined, projects: { path: string; name: string }[] = []): WsRecord[] {
  const byPath = new Map(projects.map((p) => [p.path, p]));
  return items.map((it) => fileRecord(it, { ...(areaName ? { areaName } : {}), ...(it.record && byPath.get(it.record) ? { project: byPath.get(it.record)! } : {}) }));
}

/** The files kept with a project in Ironleaf (its Files folder, or recorded as its), for its workspace. */
export function projectCatalogue(items: CatalogueItem[], projectPath: string): CatalogueItem[] {
  const dir = projectPath.includes('/') ? projectPath.slice(0, projectPath.lastIndexOf('/')) : '';
  return items.filter((it) => it.record === projectPath || (dir && it.path.startsWith(`${dir}/`) && !/\.(md|canvas)$/i.test(it.path)));
}

/**
 * A project's file records with what Ironleaf knows about each: a record from its Documents list or its folder of the
 * same name gets the version, source and line; files kept only in Ironleaf are added.
 */
export function withCatalogue(records: WsRecord[], items: CatalogueItem[], project: { path: string; name: string }): WsRecord[] {
  if (!items.length) return records;
  const byName = new Map<string, CatalogueItem>();
  for (const it of items) if (!byName.has(it.name.toLowerCase())) byName.set(it.name.toLowerCase(), it);
  const used = new Set<string>();
  const out = records.map((r) => {
    if (r.kind !== 'file') return r;
    const it = (r.path && items.find((x) => x.path === r.path)) || byName.get(r.title.toLowerCase());
    if (!it) return r;
    used.add(it.path);
    const extra = fileRecord(it, { project }).fields;
    const fields: Record<string, FieldValue> = { ...r.fields };
    for (const [k, v] of Object.entries(extra)) {
      if (v === null || v === undefined || v === '') continue;
      // What the person wrote in the Documents list stays; the rest fills in.
      if ((k === 'what' || k === 'purpose') && fields[k]) continue;
      fields[k] = v;
    }
    // The file is in the vault: it opens by its path (its details, versions and source in the peek).
    const { ref, ...rest } = r;
    return { ...rest, ...(ref && ref.at !== 'file' ? { ref } : {}), path: it.path, fields };
  });
  for (const it of items) if (!used.has(it.path)) out.push(fileRecord(it, { project }));
  return out;
}

/** "Added 21 Oct 2026 by Chief". */
export function addedWords(item: Pick<CatalogueItem, 'added' | 'source'>): string {
  const d = dayWords(item.added);
  const by = item.source?.by && item.source.by !== 'you' ? ` by ${item.source.by}` : '';
  return d ? `Added ${d}${by}` : '';
}
