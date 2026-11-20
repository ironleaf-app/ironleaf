// Systems rows on the main side (5 Nov 2026; src/shared/system-tables.ts is the file shape). Reads and writes the
// three lists through the app's own ways in (writeNote, so the index, file recovery and open tabs follow), turns rows
// into the notes they would be so the model reads them down its one path, and promotes a row to a real note file
// when typed into (words in the notes area, an edited step, or a recorded run). Plain fixes stay in the row.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  docsFillCtx,
  isSystemsTableText,
  loginsCellOf,
  loginsOfCell,
  PATTERN_WORDS,
  readSystemsTable,
  renderRowNote,
  renderSystemsTable,
  findRowBySlug,
  resolveSystemsConflict,
  rowPathIn,
  rowsInTableTexts,
  splitRowPath,
  stepsForDocRow,
  tableKindOfPath,
  tableRel,
  updateSystemsTable,
  type HealthLine,
  type RowFillCtx,
  type RunLine,
  type SystemsRow,
  type SystemsTableDoc,
  type SystemsTableKind,
  type RunbookPattern,
} from '../../shared/system-tables';
import type { SystemNote } from '../../shared/systems';
import type { WorkModules } from '../work-modules';

export type { SystemsTableKind };

/** This vault's table file for a kind (the Systems folder, whatever the areas call it). */
export async function tableRelFor(w: WorkModules, kind: SystemsTableKind): Promise<string> {
  return tableRel(await w.moduleFolder('systems'), kind);
}

const clashWords = (rel: string): string => `“${rel.split('/').pop()}” is already a note you wrote. Rename that note first, then the list can move in.`;

/** A table file's words now: the index first (fresh), the disk when the index has not seen it yet. */
async function tableText(w: WorkModules, rel: string): Promise<string | null> {
  const live = w.d.index.content(rel);
  if (live !== undefined) return live;
  try {
    return await fsp.readFile(path.join(w.d.vault().root, ...rel.split('/')), 'utf8');
  } catch {
    return null;
  }
}

export interface TableRead { rel: string; exists: boolean; doc: SystemsTableDoc }
/** A table read (missing reads as empty; a person's note sitting on its name refuses in plain words). */
export async function readTable(w: WorkModules, kind: SystemsTableKind): Promise<TableRead> {
  const rel = await tableRelFor(w, kind);
  const text = await tableText(w, rel);
  if (text === null) return { rel, exists: false, doc: readSystemsTable(renderSystemsTable(kind, { rows: [] })) };
  if (!isSystemsTableText(text)) throw Object.assign(new Error(clashWords(rel)), { code: 'TABLES_CLASH' });
  return { rel, exists: true, doc: readSystemsTable(text) };
}

/** A table written as every save is (indexed, kept in file recovery, shown in open tabs). */
export async function writeTable(w: WorkModules, kind: SystemsTableKind, doc: SystemsTableDoc): Promise<string> {
  await w.d.requireCreate();
  const rel = await tableRelFor(w, kind);
  const text = await tableText(w, rel);
  const next = text === null ? renderSystemsTable(kind, { rows: doc.rows, logs: doc.logs, runs: doc.runs }) : updateSystemsTable(text, kind, () => doc);
  await w.d.writeNote(rel, next);
  return rel;
}

export const findRow = (doc: SystemsTableDoc, name: string): SystemsRow | null => doc.rows.find((r) => r.name.toLowerCase() === String(name ?? '').trim().toLowerCase()) ?? null;

/** A row added (a name already there refuses with where it is). Returns its row path. */
export async function addTableRow(w: WorkModules, kind: SystemsTableKind, row: SystemsRow): Promise<string> {
  const { rel, doc } = await readTable(w, kind);
  if (findRow(doc, row.name)) throw new Error(`There’s already something called ${row.name.trim()} in Systems.`);
  await writeTable(w, kind, { ...doc, rows: [...doc.rows, row] });
  return rowPathIn([...doc.rows, row], rel, row.name);
}

/** One version chosen for a record changed on both PCs: its line becomes the record's, the other lines
 *  go. Returns its row path. */
export async function resolveTableConflict(w: WorkModules, kind: SystemsTableKind, name: string, keep: number): Promise<string> {
  const rel = await tableRelFor(w, kind);
  const text = await tableText(w, rel);
  if (text === null) throw new Error('That list isn’t there any more.');
  if (!isSystemsTableText(text)) throw new Error('That list isn’t a list any more.');
  const next = resolveSystemsConflict(text, kind, name, keep);
  await w.d.requireCreate();
  await w.d.writeNote(rel, next);
  const doc = readSystemsTable(next);
  const row = doc.rows.find((r) => r.name.toLowerCase() === String(name ?? '').trim().toLowerCase());
  return row ? rowPathIn(doc.rows, rel, row.name) : rel;
}

/** Rows taken back out (one Undo's half for rows): their checks go with them. */
export async function dropTableRows(w: WorkModules, kind: SystemsTableKind, names: string[]): Promise<number> {
  const { doc } = await readTable(w, kind);
  const want = new Set(names.map((n) => String(n ?? '').toLowerCase()));
  const rows = doc.rows.filter((r) => !want.has(r.name.toLowerCase()));
  if (rows.length === doc.rows.length) return 0;
  const logs = { ...doc.logs };
  const runs = { ...doc.runs };
  for (const k of Object.keys(logs)) if (want.has(k)) delete logs[k];
  for (const k of Object.keys(runs)) if (want.has(k)) delete runs[k];
  await writeTable(w, kind, { ...doc, rows, logs, runs });
  return doc.rows.length - rows.length;
}

// ── Rows as the notes they would be ──────────────────────────────────────────────────────────────────────────────────

/** The fill context with the notes' facts over the rows' (a note carries the newer word). */
export function fillCtxOf(docs: Record<SystemsTableKind, SystemsTableDoc>, notes: { title: string; props: Record<string, unknown>; type: string }[]): RowFillCtx {
  const ctx = docsFillCtx(docs);
  for (const n of notes) {
    if (n.type === 'machine' && typeof n.props.os === 'string' && n.props.os) ctx.osByName[n.title.toLowerCase()] = n.props.os;
    if (n.type === 'service' && n.props.runs_on) ctx.machineByService[n.title.toLowerCase()] = String(n.props.runs_on).replace(/^\[\[|\]\]$/g, '');
  }
  return ctx;
}

export const stepsForRow = stepsForDocRow;

const linkTarget = (v: string): string => String(v ?? '').replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();

/** A synchronous row resolver over an index's table texts (link checks that cannot wait on a read). */
export function makeRowResolver(index: { content(rel: string): string | undefined; allMeta(): { path: string }[] }): ((target: string) => string | null) & { tables(): Partial<Record<SystemsTableKind, string>> } {
  let built = false;
  const byName = new Map<string, string>();
  const rels: Partial<Record<SystemsTableKind, string>> = {};
  const build = (): void => {
    if (built) return;
    built = true;
    const texts: [string, string][] = [];
    for (const m of index.allMeta()) {
      const kind = tableKindOfPath(m.path);
      if (!kind || rels[kind]) continue;
      const text = index.content(m.path);
      if (text === undefined || !isSystemsTableText(text)) continue;
      rels[kind] = m.path;
      texts.push([m.path, text]);
    }
    // Rows through the one reading (a half-written list reads next time, with its path kept).
    for (const row of rowsInTableTexts(texts)) {
      if (!row.note && !byName.has(row.name.toLowerCase())) byName.set(row.name.toLowerCase(), row.path);
    }
  };
  const fn = (target: string): string | null => {
    build();
    const name = String(target ?? '').replace(/^\[\[|\]\]$/g, '').split('|').pop()!.trim().toLowerCase();
    return (name && byName.get(name)) ?? null;
  };
  fn.tables = (): Partial<Record<SystemsTableKind, string>> => {
    build();
    return rels;
  };
  return fn as ((target: string) => string | null) & { tables(): Partial<Record<SystemsTableKind, string>> };
}

export interface SyntheticOut { notes: SystemNote[]; rowOf: Map<string, { kind: SystemsTableKind; row: SystemsRow }> }

/** Table rows as the notes they would be, for the model's one path. A row pointing at a note stays out (the note
 *  reads instead); a note carrying a row's name wins over a row without a pointer (back from the Bin). */
export function rowsAsNotes(
  docs: Record<SystemsTableKind, SystemsTableDoc>,
  rels: Record<SystemsTableKind, string>,
  notes: { path: string; title: string }[],
  indexHas: (rel: string) => boolean,
): SyntheticOut {
  const ctx = fillCtxOf(docs, []);
  const titles = new Set(notes.map((n) => n.title.toLowerCase()));
  const out: SystemNote[] = [];
  const rowOf = new Map<string, { kind: SystemsTableKind; row: SystemsRow }>();
  (Object.keys(docs) as SystemsTableKind[]).forEach((kind) => {
    const doc = docs[kind];
    for (const row of doc.rows) {
      if (row.note) {
        if (indexHas(row.note)) continue;
        // Its note is gone (binned): the record went with it.
        continue;
      }
      if (titles.has(row.name.toLowerCase())) continue;
      const steps = kind === 'runbook' ? stepsForRow(row, ctx) : [];
      const content = renderRowNote(kind, row, doc.logs, doc.runs, kind === 'runbook' ? { steps } : {});
      const p = rowPathIn(doc.rows, rels[kind], row.name);
      out.push({ path: p, title: row.name, props: propsOf(kind, row), content, type: kind });
      rowOf.set(p, { kind, row });
    }
  });
  return { notes: out, rowOf };
}

const propsOf = (kind: SystemsTableKind, row: SystemsRow): Record<string, unknown> => {
  const c = row.cells;
  if (kind === 'machine') return { type: 'machine', kind: c.kind, role: c.role, os: c.os, address: c.address, location: c.location, status: c.status, checked: c.checked };
  if (kind === 'service') return { type: 'service', kind: c.kind, runs_on: c.runsOn, url: c.url, port: c.port, status: c.status, depends_on: c.dependsOn, runbook: c.runbook, checked: c.checked };
  return { type: 'runbook', for: c.for, every: c.every, last_run: c.lastRun };
};

// ── Promotion (typed into, so a note again) ────────────────────────────────────────────────────────────────────────────

/** A row become a real note file: its facts, checks and steps written out, the row kept pointing at it. */
export async function promoteToNote(w: WorkModules, kind: SystemsTableKind, name: string, extra: { notesWords?: string; steps?: string[] } = {}): Promise<string> {
  const [machines, services, runbooks] = await Promise.all([readTable(w, 'machine'), readTable(w, 'service'), readTable(w, 'runbook')]);
  const docs = { machine: machines.doc, service: services.doc, runbook: runbooks.doc };
  const doc = docs[kind];
  const row = findRow(doc, name);
  if (!row) throw new Error('That record isn’t in the list any more.');
  if (row.note) return row.note;
  const key = row.name.toLowerCase();
  // Its page's own steps, filled from the records as the page shows them (the note keeps them word for word).
  const steps = kind === 'runbook' ? (extra.steps ?? stepsForRow(row, fillCtxOf(docs, []))) : [];
  let text = renderRowNote(kind, row, doc.logs, doc.runs, kind === 'runbook' ? { steps } : {});
  if (extra.notesWords?.trim()) text = `${text.replace(/\n*$/, '')}\n\n## Notes\n\n${extra.notesWords.trim()}\n`;
  const rel = await w.newNote(await w.folderOf(kind), row.name, text);
  const cells: Record<string, string> = {};
  for (const k of Object.keys(row.cells)) cells[k] = '';
  const rows = doc.rows.map((r) => (r.name.toLowerCase() === key ? { ...r, cells, note: rel } : r));
  const logs = { ...doc.logs };
  const runs = { ...doc.runs };
  delete logs[key];
  delete runs[key];
  await writeTable(w, kind, { ...doc, rows, logs, runs });
  return rel;
}

// ── Finding rows ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A name (or a [[link]] to it) to its row path, across the three lists (null when no row carries it). */
export async function resolveRowTarget(w: WorkModules, target: string): Promise<string | null> {
  const name = String(target ?? '').replace(/^\[\[|\]\]$/g, '').split('|').pop()!.trim().toLowerCase();
  if (!name) return null;
  for (const kind of ['machine', 'service', 'runbook'] as SystemsTableKind[]) {
    const { rel, doc } = await readTable(w, kind).catch(() => null as never);
    if (!doc) continue;
    const row = doc.rows.find((r) => r.name.toLowerCase() === name && !r.note);
    if (row) return rowPathIn(doc.rows, rel, row.name);
  }
  return null;
}

export interface RowHit { kind: SystemsTableKind; name: string; path: string; words: string }
/** Rows naming a search: names first, then facts, each with its line in plain words. */
export async function searchTableRows(w: WorkModules, query: string): Promise<RowHit[]> {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const hits: RowHit[] = [];
  for (const kind of ['machine', 'service', 'runbook'] as SystemsTableKind[]) {
    const read = await readTable(w, kind).catch(() => null);
    if (!read) continue;
    for (const row of read.doc.rows) {
      if (row.note) continue;
      const facts = Object.values(row.cells).join(' ');
      const inName = row.name.toLowerCase().includes(q);
      if (!inName && !facts.toLowerCase().includes(q)) continue;
      const c = row.cells;
      const words = kind === 'machine' ? ['Machine', c.address, c.os, c.status].filter(Boolean).join(' · ') : kind === 'service' ? ['Service', c.runsOn ? `on ${linkTarget(c.runsOn)}` : '', c.port ? `port ${c.port}` : '', c.status].filter(Boolean).join(' · ') : ['Runbook', c.for ? `for ${String(c.for).split(/\s*,\s*/).map(linkTarget).filter(Boolean).join(', ')}` : '', c.every].filter(Boolean).join(' · ');
      hits.push({ kind, name: row.name, path: rowPathIn(read.doc.rows, read.rel, row.name), words });
    }
  }
  return hits.sort((a, b) => Number(b.name.toLowerCase().includes(q)) - Number(a.name.toLowerCase().includes(q)) || a.name.localeCompare(b.name)).slice(0, 30);
}

/** A row's words as its note would read (for the window's reading and agents' file tools). */
export async function rowNoteText(w: WorkModules, kind: SystemsTableKind, name: string): Promise<string> {
  const [machines, services, runbooks] = await Promise.all([readTable(w, 'machine'), readTable(w, 'service'), readTable(w, 'runbook')]);
  const docs = { machine: machines.doc, service: services.doc, runbook: runbooks.doc };
  const row = findRow(docs[kind], name);
  if (!row || row.note) throw new Error('That record isn’t in the list any more.');
  const ctx = fillCtxOf(docs, []);
  const steps = kind === 'runbook' ? stepsForRow(row, ctx) : [];
  return `# ${row.name}\n\n${renderRowNote(kind, row, docs[kind].logs, docs[kind].runs, kind === 'runbook' ? { steps } : {})}`;
}

/** Row details for a row path (null when it names no row any more). */
export async function rowByPath(w: WorkModules, rowPathStr: string): Promise<{ kind: SystemsTableKind; row: SystemsRow; rel: string } | null> {
  const split = splitRowPath(rowPathStr);
  if (!split) return null;
  const { rel, doc } = await readTable(w, split.kind).catch(() => null as never);
  if (!doc) return null;
  const row = findRowBySlug(doc.rows, split.slug);
  return row ? { kind: split.kind, row, rel } : null;
}

export { PATTERN_WORDS, loginsCellOf, loginsOfCell };
export type { HealthLine, RunLine, RunbookPattern, SystemsRow, SystemsTableDoc };
