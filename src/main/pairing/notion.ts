// Notion's export, "Markdown & CSV" (V9, 28 Oct 2026): a page is "Title <32 hex>.md", the pages under it sit in a
// folder of the same name, its pictures and files beside them; a database is "Name <32 hex>.csv" (and "_all.csv" with
// every row) with each row a page in the folder "Name <32 hex>/", its properties both in the CSV and as "Key: value"
// lines under the row page's title. The hex is Notion's own id: kept as each note's source-id and taken out of names and
// links. A database becomes a folder of notes whose properties come from its CSV (numbers, ticks, days as such;
// relations to other pages as links) and a view over them: a board when it has a Status, else a table.

import { promises as fsp } from 'node:fs';
import nodePath from 'node:path';
import type { PropValue } from '../../shared/frontmatter';
import { parseCsv, planImport } from '../../shared/csv';
import { defaultView } from '../../shared/views';
import { unplacedFilesItem } from './orphans';
import { fileSafe, linkToken, type SourceFile, type SourceItem, type SourceRead, type SourceView } from './source';

const HEX = /[ _-]?([0-9a-f]{32})$/i;
const stemOf = (name: string) => name.replace(/\.[^.]+$/, '');
/** "Tasks 1f2e….csv" → { name: "Tasks", id: "1f2e…" }. */
export function notionName(name: string): { name: string; id: string | null } {
  const stem = stemOf(name).replace(/_all$/, '');
  const m = HEX.exec(stem);
  return { name: (m ? stem.slice(0, m.index) : stem).trim() || 'Untitled', id: m ? m[1].toLowerCase() : null };
}
/** A path inside the export with every part's id taken out ("Home 1f2e…/Tasks 3a4b…" → "Home/Tasks"). */
const cleanFolder = (rel: string) => rel.split('/').filter(Boolean).map((p) => fileSafe(notionName(p).name)).join('/');

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const go = async (rel: string, depth: number) => {
    if (depth > 30) return;
    for (const e of await fsp.readdir(rel ? nodePath.join(root, ...rel.split('/')) : root, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.') || e.name === '__MACOSX') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await go(r, depth + 1);
      else if (e.isFile()) out.push(r);
    }
  };
  await go('', 0);
  return out;
}

/** Whether a folder looks like a Notion export (names that end in Notion's ids). */
export function looksLikeNotion(rels: string[]): boolean {
  return rels.filter((r) => /\.(md|csv)$/i.test(r) && notionName(r.split('/').pop()!).id).length >= 1;
}

export async function readNotion(root: string): Promise<SourceRead> {
  const rels = await walk(root);
  const has = new Set(rels.map((r) => r.toLowerCase()));
  const skipped: { what: string; why: string }[] = [];
  const pages = rels.filter((r) => /\.md$/i.test(r));
  const htmls = rels.filter((r) => /\.html?$/i.test(r));
  if (htmls.length) skipped.push({ what: `${htmls.length} HTML ${htmls.length === 1 ? 'page' : 'pages'}`, why: pages.length ? 'only Markdown pages come in this way — bring the folder as A folder of notes for HTML' : 'export again from Notion choosing Markdown & CSV, or bring the folder as A folder of notes' });
  const pageId = (rel: string) => notionName(rel.split('/').pop()!).id ?? `path:${rel.toLowerCase()}`;
  // Each page: its id, its name, the folder it goes in.
  const info = new Map<string, { id: string; title: string; folder: string }>();
  for (const rel of pages) {
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    info.set(rel.toLowerCase(), { id: pageId(rel), title: fileSafe(notionName(rel.split('/').pop()!).name), folder: cleanFolder(dir) });
  }
  const byTitle = new Map<string, string[]>();
  for (const [, p] of info) byTitle.set(p.title.toLowerCase(), [...(byTitle.get(p.title.toLowerCase()) ?? []), p.id]);

  // Databases: the CSV with every row when there is one.
  const csvs = rels.filter((r) => /\.csv$/i.test(r));
  const dbs = csvs.filter((r) => /_all\.csv$/i.test(r) || !has.has(r.replace(/\.csv$/i, '_all.csv').toLowerCase()));
  const rowProps = new Map<string, Record<string, PropValue>>();
  const rowKeys = new Map<string, Set<string>>();
  const views: SourceView[] = [];
  const extraRows: SourceItem[] = [];
  for (const csv of dbs) {
    const text = await fsp.readFile(nodePath.join(root, ...csv.split('/')), 'utf8').catch(() => '');
    const table = parseCsv(text.replace(/^\uFEFF/, ''));
    if (table.length < 1) continue;
    const plan = planImport(table);
    const dir = csv.includes('/') ? csv.slice(0, csv.lastIndexOf('/')) : '';
    const dbFolderRaw = `${dir ? `${dir}/` : ''}${stemOf(csv.split('/').pop()!).replace(/_all$/, '')}`;
    const dbFolder = cleanFolder(dbFolderRaw);
    const dbName = fileSafe(notionName(csv.split('/').pop()!).name);
    const keys = new Set(plan.columns.map((c) => c.key));
    for (const note of plan.notes) {
      const props: Record<string, PropValue> = {};
      for (const [k, v] of Object.entries(note.props)) props[k] = relationLinks(v, dbFolderRaw, has, info, byTitle);
      // The row's page: in the database's folder, by its name.
      const row = pages.find((p) => p.toLowerCase().startsWith(`${dbFolderRaw.toLowerCase()}/`) && !p.slice(dbFolderRaw.length + 1).includes('/') && info.get(p.toLowerCase())?.title.toLowerCase() === fileSafe(note.name).toLowerCase() && !rowProps.has(p.toLowerCase()));
      if (row) {
        rowProps.set(row.toLowerCase(), props);
        rowKeys.set(row.toLowerCase(), keys);
      } else extraRows.push({ id: `row:${dbFolderRaw.toLowerCase()}/${note.name.toLowerCase()}`, title: fileSafe(note.name), folder: dbFolder, props, body: '', files: [] });
    }
    const status = plan.columns.find((c) => /^(status|stage|state)$/i.test(c.key) && c.kind === 'text');
    const def = defaultView({ kind: 'folder', value: dbFolder }, status ? 'board' : 'table');
    def.columns = plan.columns.map((c) => c.key);
    if (status) {
      def.groupBy = status.key;
      def.cardProps = plan.columns.filter((c) => c !== status).slice(0, 2).map((c) => c.key);
    }
    views.push({ name: dbName, folder: dbFolder, def });
  }

  // Pages: their words with Notion's links made into tokens, their pictures and files with them.
  const owned = new Set<string>();
  const items: SourceItem[] = [];
  for (const rel of pages) {
    const me = info.get(rel.toLowerCase())!;
    let text = (await fsp.readFile(nodePath.join(root, ...rel.split('/')), 'utf8').catch(() => '')).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    // The title line (the note's name says it).
    text = text.replace(/^\s*#[ \t]+[^\n]*\n?/, '');
    const props = rowProps.get(rel.toLowerCase()) ?? {};
    const keys = rowKeys.get(rel.toLowerCase());
    if (keys) {
      // The row's "Key: value" lines repeat its CSV: taken out (the properties hold them now).
      const lines = text.replace(/^\n+/, '').split('\n');
      let i = 0;
      while (i < lines.length && lines[i].trim() && keys.has(/^([^:]+):/.exec(lines[i])?.[1]?.trim() ?? '\u0000')) i++;
      if (i > 0) text = lines.slice(i).join('\n');
    }
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const files: SourceFile[] = [];
    const attach = (target: string): SourceFile => {
      const f = { key: target.toLowerCase(), name: fileSafe(target.split('/').pop()!, 'File'), abs: nodePath.join(root, ...target.split('/')) };
      if (!files.some((x) => x.key === f.key)) files.push(f);
      owned.add(f.key);
      return f;
    };
    text = text.replace(/(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g, (all, bang: string, label: string, href: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return all;
      let target = href;
      try {
        target = decodeURIComponent(href);
      } catch {
        // kept as written
      }
      const joined = nodePath.posix.normalize(`${dir ? `${dir}/` : ''}${target}`).replace(/^\.\//, '');
      const key = joined.toLowerCase();
      if (/\.md$/i.test(joined)) {
        const to = info.get(key);
        return to ? linkToken('note', to.id, label && label !== to.title ? label : '') : label || all;
      }
      if (/\.csv$/i.test(joined)) return label;
      if (!has.has(key)) return all;
      const f = attach(rels.find((r) => r.toLowerCase() === key)!);
      return bang || /\.(png|jpe?g|gif|webp|svg|pdf)$/i.test(f.name) ? linkToken('embed-file', f.key) : linkToken('file', f.key, label || f.name);
    });
    items.push({ id: me.id, title: me.title, folder: me.folder, props, body: text.replace(/^\n+/, ''), files });
  }
  // Files no page showed: with the page whose folder they're in, listed at its end; the rest kept together (10.0 item 16).
  const orphans: { rel: string; abs: string }[] = [];
  for (const rel of rels) {
    if (/\.(md|csv|html?)$/i.test(rel) || owned.has(rel.toLowerCase())) continue;
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const owner = dir && pages.find((p) => p.toLowerCase() === `${dir}.md`.toLowerCase());
    // A file in a database's folder (no page of its own): with the first row page there, so none is lost (F17).
    const sibling = !owner && dir ? pages.find((p) => p.toLowerCase().startsWith(`${dir.toLowerCase()}/`) && !p.slice(dir.length + 1).includes('/')) : undefined;
    const item = (owner || sibling) ? items.find((i) => i.id === pageId((owner || sibling)!)) : undefined;
    if (!item) {
      orphans.push({ rel, abs: nodePath.join(root, ...rel.split('/')) });
      continue;
    }
    const f = { key: rel.toLowerCase(), name: fileSafe(rel.split('/').pop()!, 'File'), abs: nodePath.join(root, ...rel.split('/')) };
    item.files.push(f);
    item.body = `${item.body.trimEnd()}\n\n- ${linkToken('file', f.key, f.name)}\n`;
  }
  const unplaced = unplacedFilesItem(orphans);
  if (unplaced) items.push(unplaced);
  items.push(...extraRows);
  return { kind: 'notion', name: '', items, views, skipped };
}

/** A CSV cell naming other pages ("Ana (People 1f…/Ana 2b….md), Ben (…)" or "Ana, Ben" when each is a page) as links. */
function relationLinks(v: PropValue, dbFolderRaw: string, has: Set<string>, info: Map<string, { id: string; title: string }>, byTitle: Map<string, string[]>): PropValue {
  if (typeof v !== 'string' || !v.trim()) return v;
  const withPaths = [...v.matchAll(/([^,()]+?)\s*\(([^()]+\.md)\)/g)];
  if (withPaths.length && withPaths.map((m) => m[0]).join(',').replace(/[\s,]/g, '').length >= v.replace(/[\s,]/g, '').length - 2) {
    const base = dbFolderRaw.includes('/') ? dbFolderRaw.slice(0, dbFolderRaw.lastIndexOf('/')) : '';
    const links = withPaths.map((m) => {
      let p = m[2];
      try {
        p = decodeURIComponent(p);
      } catch {
        // as written
      }
      const joined = nodePath.posix.normalize(`${base ? `${base}/` : ''}${p}`).toLowerCase();
      const to = info.get(joined) ?? [...info.entries()].find(([k]) => k.endsWith(`/${p.toLowerCase()}`) || k === p.toLowerCase())?.[1];
      return to ? linkToken('note', to.id) : m[1].trim();
    });
    return links;
  }
  const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length && parts.every((p) => byTitle.get(fileSafe(p).toLowerCase())?.length === 1) && !has.has(v.toLowerCase())) return parts.map((p) => linkToken('note', byTitle.get(fileSafe(p).toLowerCase())![0]));
  return v;
}
