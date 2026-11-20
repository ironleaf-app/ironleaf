// Bills rows on the main side (8 Nov 2026; src/shared/bills-table.ts is the file shape). Reads and writes the
// one list through the app's own way in (writeNote, so the index, file recovery and open tabs follow), turns rows
// into the notes they would be so Money, Today, search and the tools read them down their one path, and promotes
// a row to a real note file when written on (typed words, or a price history longer than the first line). Plain
// fixes and machine payment lines stay in the row.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  billNameKey,
  findRowBySlug,
  isBillsTableText,
  readBillsTable,
  renderBillsTable,
  renderBillRowNote,
  resolveBillsConflict,
  rowPathIn,
  rowsInBillsTexts,
  splitBillRow,
  tableRel,
  updateBillsTable,
  type BillsRow,
  type BillsTableDoc,
} from '../shared/bills-table';
import { readMoney, type FinanceNote } from '../shared/finance';
import { moduleFolder, typeFolder } from '../shared/module-records';
import type { ModuleOptionsFile } from '../shared/module-records';
import type { VaultIndex } from './indexer';

/** What the Bills list and its move need from Money's main side (RecordModules answers it). */
export interface BillsWork {
  /** The vault's root on this PC. */
  root: string;
  index: VaultIndex;
  /** Writes a note as every save does (indexed, file recovery, open tabs told). */
  writeNote(rel: string, text: string): Promise<void>;
  requireCreate(): Promise<void>;
  areas(): Promise<{ id: string; folder: string }[] | null>;
  today(): Date;
  options(): Promise<ModuleOptionsFile>;
  /** Money's own settings changed (the move's flag among them). */
  setFinanceSettings(patch: Record<string, string | number | boolean>): Promise<void>;
  /** Every bill note (type bill) for the move's plan. */
  billNotes(): Promise<FinanceNote[]>;
  /** A new note under a free name in a folder. */
  newNote(folder: string, name: string, text: string): Promise<string>;
  /** Files kept beside a note, newest first. */
  filesOf(note: string): Promise<string[]>;
  /** This PC's app data (the move's backup zip goes beside it). */
  dataDir?: string;
  device?: { id: string; name: string };
  appVersion?: string;
}

/** This vault's Bills list (the Money folder's Bills.md, whatever the areas call it). */
export async function billsTableRelFor(w: BillsWork): Promise<string> {
  return tableRel(moduleFolder('finance', await w.areas()));
}

const clashWords = (rel: string): string => `“${rel.split('/').pop()}” is already a note you wrote. Rename that note first, then the list can move in.`;

/** The list's words now: the index first (fresh), the disk when the index has not seen it yet.
 *  Missing reads as null; a file there that will not give up its words (locked, held, still fetching)
 *  refuses in plain words, never as empty (an empty read would write over it). */
async function tableText(w: BillsWork, rel: string): Promise<string | null> {
  const live = w.index.content(rel);
  if (live !== undefined) return live;
  const abs = path.join(w.root, ...rel.split('/'));
  try {
    return await fsp.readFile(abs, 'utf8');
  } catch (e) {
    const there = await fsp.stat(abs).then(() => true, () => false);
    if (!there) return null;
    const code = (e as NodeJS.ErrnoException)?.code;
    const why = code === 'EACCES' || code === 'EPERM' ? 'it is locked by something else' : code === 'EBUSY' ? 'it is busy somewhere else' : 'it could not be read (OneDrive may still be fetching it)';
    throw Object.assign(new Error(`The Bills list couldn't be read (${why}). Nothing changed.`), { code: 'TABLES_UNREADABLE' });
  }
}

export interface BillsRead { rel: string; exists: boolean; doc: BillsTableDoc }
/** The list read (missing reads as empty; a person's note sitting on its name refuses in plain words). */
export async function readBills(w: BillsWork): Promise<BillsRead> {
  const rel = await billsTableRelFor(w);
  const text = await tableText(w, rel);
  if (text === null) return { rel, exists: false, doc: readBillsTable(renderBillsTable({ rows: [] })) };
  if (!isBillsTableText(text)) throw Object.assign(new Error(clashWords(rel)), { code: 'TABLES_CLASH' });
  return { rel, exists: true, doc: readBillsTable(text) };
}

/** The list written as every save is (indexed, kept in file recovery, shown in open tabs). */
export async function writeBills(w: BillsWork, doc: BillsTableDoc): Promise<string> {
  await w.requireCreate();
  const rel = await billsTableRelFor(w);
  const text = await tableText(w, rel);
  const next = text === null ? renderBillsTable({ rows: doc.rows, prices: doc.prices, payments: doc.payments }) : updateBillsTable(text, () => doc);
  await w.writeNote(rel, next);
  return rel;
}

export const findBillRow = (doc: BillsTableDoc, name: string): BillsRow | null => doc.rows.find((r) => billNameKey(r.name) === billNameKey(String(name ?? '').trim())) ?? null;

/** A row added (a name already there refuses with where it is). Returns its row path. */
export async function addBillsRow(w: BillsWork, row: BillsRow): Promise<string> {
  const { rel, doc } = await readBills(w);
  if (findBillRow(doc, row.name)) throw new Error(`There’s already a bill called ${row.name.trim()} in Money.`);
  await writeBills(w, { ...doc, rows: [...doc.rows, row] });
  return rowPathIn([...doc.rows, row], rel, row.name);
}

/** One version chosen for a bill changed on both PCs: its line becomes the bill's, the other lines
 *  go. Returns its row path. */
export async function resolveBillsConflictAt(w: BillsWork, name: string, keep: number): Promise<string> {
  const rel = await billsTableRelFor(w);
  const text = await tableText(w, rel);
  if (text === null) throw new Error('That list isn’t there any more.');
  if (!isBillsTableText(text)) throw new Error('That list isn’t a list any more.');
  const next = resolveBillsConflict(text, name, keep);
  await w.requireCreate();
  await w.writeNote(rel, next);
  const doc = readBillsTable(next);
  const row = doc.rows.find((r) => billNameKey(r.name) === billNameKey(String(name ?? '').trim()));
  return row ? rowPathIn(doc.rows, rel, row.name) : rel;
}

/** Rows taken back out (one Undo's half for rows): their histories go with them. */
export async function dropBillsRows(w: BillsWork, names: string[]): Promise<number> {
  const { doc } = await readBills(w);
  const want = new Set(names.map((n) => billNameKey(String(n ?? ''))));
  const rows = doc.rows.filter((r) => !want.has(billNameKey(r.name)));
  if (rows.length === doc.rows.length) return 0;
  const prices = { ...doc.prices };
  const payments = { ...doc.payments };
  for (const k of Object.keys(prices)) if (want.has(k)) delete prices[k];
  for (const k of Object.keys(payments)) if (want.has(k)) delete payments[k];
  await writeBills(w, { ...doc, rows, prices, payments });
  return doc.rows.length - rows.length;
}

// ── Rows as the notes they would be ──────────────────────────────────────────────────────────────────────────────────

/** A row's cells as the note properties they would be. */
export const billsRowProps = (row: BillsRow): Record<string, unknown> => {
  const c = row.cells;
  return { type: 'bill', kind: c.kind, amount: c.amount, cycle: c.cycle, due: c.due, category: c.category, account: c.account, project: c.project, autopay: c.autopay, status: c.status, paid: c.paid };
};

export interface BillsSyntheticOut { notes: FinanceNote[]; rowOf: Map<string, { row: BillsRow }> }

/** Bills rows as the notes they would be, for Money's one path. A row pointing at a note stays out (the note
 *  reads instead); a note carrying a row's name wins over a row without a pointer (back from the Bin). */
export function rowsAsBillNotes(doc: BillsTableDoc, rel: string, notes: { path: string; title: string }[], indexHas: (rel: string) => boolean): BillsSyntheticOut {
  const titles = new Set(notes.map((n) => billNameKey(n.title)));
  const out: FinanceNote[] = [];
  const rowOf = new Map<string, { row: BillsRow }>();
  for (const row of doc.rows) {
    if (row.note) {
      if (indexHas(row.note)) continue;
      // Its note is gone (binned): the bill went with it.
      continue;
    }
    if (titles.has(billNameKey(row.name))) continue;
    const p = rowPathIn(doc.rows, rel, row.name);
    out.push({ path: p, title: row.name, props: billsRowProps(row), content: renderBillRowNote(row, doc.prices, doc.payments), type: 'bill' });
    rowOf.set(p, { row });
  }
  return { notes: out, rowOf };
}

/** A synchronous row resolver over an index's list text (link checks that cannot wait on a read). */
export function makeBillRowResolver(index: { content(rel: string): string | undefined; allMeta(): { path: string }[] }): ((target: string) => string | null) & { table(): string | null } {
  let built = false;
  const byName = new Map<string, string>();
  let rel: string | null = null;
  const build = (): void => {
    if (built) return;
    built = true;
    const texts: [string, string][] = [];
    for (const m of index.allMeta()) {
      if (rel || !/Bills\.md$/i.test(m.path.split('#')[0].split('/').pop() ?? '')) continue;
      const text = index.content(m.path);
      if (text === undefined || !isBillsTableText(text)) continue;
      rel = m.path;
      texts.push([m.path, text]);
    }
    // Rows through the one reading (a half-written list reads next time, with its path kept).
    for (const row of rowsInBillsTexts(texts)) {
      if (!row.note && !byName.has(billNameKey(row.name))) byName.set(billNameKey(row.name), row.path);
    }
  };
  const fn = (target: string): string | null => {
    build();
    const name = billNameKey(String(target ?? '').replace(/^\[\[|\]\]$/g, '').split('|').pop()!.trim());
    return (name && byName.get(name)) ?? null;
  };
  fn.table = (): string | null => {
    build();
    return rel;
  };
  return fn as ((target: string) => string | null) & { table(): string | null };
}

// ── Promotion (written on, so a note again) ────────────────────────────────────────────────────────────────────────────

/** A row become a real note file: its facts and histories written out, the row kept pointing at it. */
export async function promoteToBillNote(w: BillsWork, name: string, extra: { notesWords?: string } = {}): Promise<string> {
  const { doc } = await readBills(w);
  const row = findBillRow(doc, name);
  if (!row) throw new Error('That bill isn’t in the list any more.');
  if (row.note) return row.note;
  const key = billNameKey(row.name);
  let text = renderBillRowNote(row, doc.prices, doc.payments);
  if (extra.notesWords?.trim()) text = `${text.replace(/\n*$/, '')}\n\n${extra.notesWords.trim()}\n`;
  const rel = await w.newNote(typeFolder('bill', await w.areas()), row.name, text);
  const cells: Record<string, string> = {};
  for (const k of Object.keys(row.cells)) cells[k] = '';
  const rows = doc.rows.map((r) => (billNameKey(r.name) === key ? { ...r, cells, note: rel } : r));
  const prices = { ...doc.prices };
  const payments = { ...doc.payments };
  delete prices[key];
  delete payments[key];
  await writeBills(w, { ...doc, rows, prices, payments });
  return rel;
}

// ── Finding rows ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A name (or a [[link]] to it) to its row path (null when no row carries it). */
export async function resolveBillRowTarget(w: BillsWork, target: string): Promise<string | null> {
  const name = billNameKey(String(target ?? '').replace(/^\[\[|\]\]$/g, '').split('|').pop()!.trim());
  if (!name) return null;
  const { rel, doc } = await readBills(w).catch(() => null as never);
  if (!doc) return null;
  const row = doc.rows.find((r) => billNameKey(r.name) === name && !r.note);
  return row ? rowPathIn(doc.rows, rel, row.name) : null;
}

export interface BillRowHit { name: string; path: string; words: string }
/** Rows naming a search: names first, then facts, each with its line in plain words. */
export async function searchBillsRows(w: BillsWork, query: string): Promise<BillRowHit[]> {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const read = await readBills(w).catch(() => null);
  if (!read) return [];
  const hits: BillRowHit[] = [];
  for (const row of read.doc.rows) {
    if (row.note) continue;
    const facts = Object.values(row.cells).join(' ');
    const inName = row.name.toLowerCase().includes(q);
    if (!inName && !facts.toLowerCase().includes(q)) continue;
    const c = row.cells;
    const sum = readMoney(c.amount || null);
    const words = ['Bill', sum !== null ? `$${sum.toFixed(2)}` : '', c.cycle ? c.cycle.toLowerCase() : '', c.due ? `due ${c.due}` : 'due date not set'].filter(Boolean).join(' · ');
    hits.push({ name: row.name, path: rowPathIn(read.doc.rows, read.rel, row.name), words });
  }
  return hits.sort((a, b) => Number(b.name.toLowerCase().includes(q)) - Number(a.name.toLowerCase().includes(q)) || a.name.localeCompare(b.name)).slice(0, 30);
}

/** A row's words as its note would read (for the window's reading and agents' file tools). */
export async function billRowNoteText(w: BillsWork, name: string): Promise<string> {
  const { doc } = await readBills(w);
  const row = findBillRow(doc, name);
  if (!row || row.note) throw new Error('That bill isn’t in the list any more.');
  return `# ${row.name}\n\n${renderBillRowNote(row, doc.prices, doc.payments)}`;
}

/** Row details for a row path (null when it names no row any more). */
export async function billRowByPath(w: BillsWork, rowPathStr: string): Promise<{ row: BillsRow; rel: string } | null> {
  const split = splitBillRow(rowPathStr);
  if (!split) return null;
  const { rel, doc } = await readBills(w).catch(() => null as never);
  if (!doc) return null;
  const row = findRowBySlug(doc.rows, split.slug);
  return row ? { row, rel } : null;
}

export type { BillsRow, BillsTableDoc };
