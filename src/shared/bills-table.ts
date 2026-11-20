// Bills as one list (8 Nov 2026): one readable file, Me/Finance/Bills.md beside the Bills folder, a plain Markdown
// table the person can open and read. One row per bill with every field plus its note; each bill's price history
// and machine payment lines under it. One row per line, so OneDrive's own line merging keeps every row from both
// sides; two PCs changing the same bill keep both lines and the reader says which bills disagree. A bill that gains
// typed words (or a price history longer than the first line) becomes a note file of its own again, and its row
// keeps pointing at it. Pure: no files, no Node, no DOM.

import { readIsoDay, readMoney } from './finance';

export const TABLE_FILE = 'Bills.md';
export const TABLE_TITLE = 'Bills';
export const TABLE_VERSION = 1;

/** This vault's Bills list: the Money folder's Bills.md (with areas Me/Finance, else Finance). */
export const tableRel = (moduleFolder: string): string => `${moduleFolder}/${TABLE_FILE}`;

/** A bill's name for matching (spacing and punctuation folded away, as sameRecordName): `A B` and
 *  `A-B` are one bill, never two rows. Every row, price, payment and conflict key in this file uses it. */
export const billNameKey = (s: string): string => {
  const k = String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return k || String(s ?? '').toLowerCase().trim();
};

/** A bill's row path: its table file plus its slug (`Bills.md#harbour-internet`). Opens its bill page. */
export const rowSlug = (name: string): string => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'row';
export const rowPath = (table: string, name: string): string => `${table}#${rowSlug(name)}`;
/** Every row's slug in file order (shared slugs numbered: `A B` keeps `a-b`, `A-B` opens `a-b-2`). */
function slugsOf(rows: BillsRow[]): string[] {
  const claimed = new Set<string>();
  return rows.map((r) => {
    const base = rowSlug(r.name);
    let s = base;
    let i = 2;
    while (claimed.has(s)) s = `${base}-${i++}`;
    claimed.add(s);
    return s;
  });
}
/** A bill's slug among its table's rows, so names sharing one open their own pages. */
export function rowSlugIn(rows: BillsRow[], name: string): string {
  const i = rows.findIndex((r) => billNameKey(r.name) === billNameKey(name));
  return i < 0 ? rowSlug(name) : slugsOf(rows)[i];
}
/** A bill's row path among its table's rows (shared slugs numbered, each opening its own page). */
export const rowPathIn = (rows: BillsRow[], table: string, name: string): string => `${table}#${rowSlugIn(rows, name)}`;
/** The row a slug names (null when none; a shared slug opens its own page, never the first). */
export function findRowBySlug(rows: BillsRow[], slug: string): BillsRow | null {
  const i = slugsOf(rows).indexOf(String(slug ?? '').toLowerCase());
  return i < 0 ? null : rows[i];
}
export function splitBillRow(p: unknown): { table: string; slug: string } | null {
  if (typeof p !== 'string') return null;
  const m = /^(.+\.md)#([^#]+)$/.exec(p);
  if (!m || !isBillsTablePath(m[1])) return null;
  return { table: m[1], slug: m[2] };
}

/** Whether a vault path is the Bills list, by its file name (a row path's table part too). */
export function isBillsTablePath(rel: string): boolean {
  const base = String(rel ?? '').split('#')[0].split('/').pop() ?? '';
  return base.toLowerCase() === TABLE_FILE.toLowerCase();
}

const frontmatterOf = (text: string): Record<string, string> => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(String(text ?? ''));
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (kv) out[kv[1].toLowerCase()] = kv[2].trim().replace(/^"|"$/g, '');
  }
  return out;
};

export const isBillsTableText = (text: string): boolean => {
  const fm = frontmatterOf(text);
  return fm.type === 'bills-table' && fm.table === 'bills';
};

// ── Columns ────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Column { head: string; key: string }
const COLUMNS: Column[] = [
  { head: 'Name', key: 'name' }, { head: 'Kind', key: 'kind' }, { head: 'Amount', key: 'amount' }, { head: 'Cycle', key: 'cycle' },
  { head: 'Due', key: 'due' }, { head: 'Category', key: 'category' }, { head: 'Account', key: 'account' }, { head: 'Project', key: 'project' },
  { head: 'Autopay', key: 'autopay' }, { head: 'Status', key: 'status' }, { head: 'Paid', key: 'paid' }, { head: 'Note file', key: 'note' },
];
export const COLUMN_HEADS: string[] = COLUMNS.map((c) => c.head);

export interface BillsRow { name: string; cells: Record<string, string>; note: string | null }
export interface PriceLine { date: string | null; amount: number; note: string }
export interface BillsTableDoc {
  version: number;
  rows: BillsRow[];
  /** Price lines by bill name (billNameKey), in file order. */
  prices: Record<string, PriceLine[]>;
  /** Machine payment lines by bill name (billNameKey), in file order (`- Paid …`). */
  payments: Record<string, string[]>;
  /** Bills whose lines disagree (both kept; the first read wins until the person tidies the file). */
  dupes: string[];
  /** Each disagreeing bill's other versions (billNameKey to rows), in file order after the shown one. */
  conflicts: Record<string, BillsRow[]>;
}

const esc = (v: string): string => String(v ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
const unesc = (v: string): string => String(v ?? '').replace(/\\\|/g, '|').replace(/\\\\/g, '\\').trim();
function splitCells(line: string): string[] {
  // A table line split on unescaped pipes ("a \| b" stays one cell).
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && (line[i + 1] === '|' || line[i + 1] === '\\')) {
      cur += c + line[i + 1];
      i++;
    } else if (c === '|') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  // Drop the empty ends outside the edge pipes.
  if (out.length && !out[0].trim()) out.shift();
  if (out.length && !out[out.length - 1].trim()) out.pop();
  return out.map(unesc);
}
const isSep = (line: string): boolean => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line);
const isTableLine = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line);

const headerKeys = (heads: string[]): string[] | null => {
  if (heads.length !== COLUMNS.length) return null;
  if (heads[0].toLowerCase() !== 'name') return null;
  for (let i = 1; i < COLUMNS.length; i++) if (heads[i].toLowerCase() !== COLUMNS[i].head.toLowerCase()) return null;
  return COLUMNS.map((c) => c.key);
};

interface TableBlock { start: number; end: number; main: boolean }

function blocksOf(lines: string[]): TableBlock[] {
  // Every table in the file, wherever it sits (the main one and any merged copies below it).
  const out: TableBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isTableLine(lines[i]) || !isSep(lines[i + 1] ?? '')) continue;
    const heads = splitCells(lines[i]);
    let end = i + 2;
    while (end < lines.length && isTableLine(lines[end]) && !isSep(lines[end])) end++;
    out.push({ start: i, end, main: headerKeys(heads) !== null });
    i = end - 1;
  }
  return out;
}

/** The file read: every row in every matching table (first wins), every price and payment line, disagreements named. */
export function readBillsTable(text: string): BillsTableDoc {
  const src = String(text ?? '');
  const fm = frontmatterOf(src);
  if (!isBillsTableText(src)) throw new Error('That file is not the Bills list.');
  const version = /^\d+$/.test(fm.version ?? '') ? Number(fm.version) : TABLE_VERSION;
  const lines = src.split(/\r?\n/);
  const blocks = blocksOf(lines);
  const rows: BillsRow[] = [];
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  const conflicts: Record<string, BillsRow[]> = {};
  const conflictSigs = new Map<string, Set<string>>();
  for (const b of blocks) {
    if (!b.main) continue;
    for (let i = b.start + 2; i < b.end; i++) {
      const cells = splitCells(lines[i]);
      if (!cells.length || cells.every((c) => !c)) continue;
      const byKey: Record<string, string> = {};
      COLUMNS.forEach((c, n) => {
        byKey[c.key] = cells[n] ?? '';
      });
      const name = (byKey.name ?? '').trim();
      if (!name) continue;
      const key = billNameKey(name);
      const sig = COLUMNS.map((c) => byKey[c.key]).join('\n');
      if (!seen.has(key)) {
        seen.set(key, sig);
        rows.push({ name, cells: rowCells(byKey), note: noteOf(byKey.note ?? '') });
      } else if (seen.get(key) !== sig) {
        if (!dupes.some((d) => billNameKey(d) === key)) dupes.push(name);
        // Each other version kept for the bill's page, where the person chooses (the same line twice
        // from two merges still chooses once).
        const known = conflictSigs.get(key) ?? new Set<string>([seen.get(key)!]);
        if (!known.has(sig)) {
          known.add(sig);
          conflictSigs.set(key, known);
          (conflicts[key] ??= []).push({ name, cells: rowCells(byKey), note: noteOf(byKey.note ?? '') });
        }
      }
    }
  }
  // Prices and payments: the `### <name>` tables and lines under each section, in file order.
  const prices: Record<string, PriceLine[]> = {};
  const payments: Record<string, string[]> = {};
  let section: 'prices' | 'payments' | null = null;
  let at = '';
  for (let i = 0; i < lines.length; i++) {
    const h2 = /^\s*##\s+(.+?)\s*$/.exec(lines[i]);
    if (h2) {
      section = /^price history$/i.test(h2[1]) ? 'prices' : /^payments$/i.test(h2[1]) ? 'payments' : null;
      at = '';
      continue;
    }
    const h3 = /^\s*###\s+(.+?)\s*$/.exec(lines[i]);
    if (h3 && section) {
      at = h3[1].trim();
      continue;
    }
    if (section === 'prices' && at && isTableLine(lines[i]) && isSep(lines[i + 1] ?? '')) {
      const heads = splitCells(lines[i]).map((h) => h.toLowerCase());
      const di = heads.findIndex((h) => /^(date|when|from)$/.test(h));
      const ai = heads.findIndex((h) => /^(amount|price|cost)$/.test(h));
      const ni = heads.findIndex((h) => /^(notes?|why)$/.test(h));
      if (ai >= 0) {
        const key = billNameKey(at);
        for (let j = i + 2; j < lines.length && isTableLine(lines[j]) && !isSep(lines[j]); j++) {
          const cells = splitCells(lines[j]);
          if (cells.every((c) => !c)) continue;
          const amount = readMoney(cells[ai] ?? '');
          if (amount === null) continue;
          (prices[key] ??= []).push({ date: di >= 0 ? (readIsoDay(cells[di] ?? '') ?? null) : null, amount, note: ni >= 0 ? (cells[ni] ?? '') : '' });
        }
      }
    }
    if (section === 'payments' && at && /^\s*-\s+Paid(\s|$)/.test(lines[i])) (payments[billNameKey(at)] ??= []).push(lines[i].trim());
  }
  return { version, rows, prices, payments, dupes, conflicts };
}

const rowCells = (byKey: Record<string, string>): Record<string, string> => {
  const cells: Record<string, string> = {};
  for (const c of COLUMNS) if (c.key !== 'name' && c.key !== 'note') cells[c.key] = byKey[c.key] ?? '';
  return cells;
};
const noteOf = (cell: string): string | null => {
  const t = String(cell ?? '').trim();
  if (!t) return null;
  return t.replace(/^\[\[|\]\]$/g, '').split('|')[0].trim() || null;
};

function renderTable(rows: BillsRow[]): string {
  const head = `| ${COLUMNS.map((c) => c.head).join(' | ')} |`;
  const sep = `|${COLUMNS.map(() => ' --- ').join('|')}|`;
  const lines = rows.map((r) => `| ${COLUMNS.map((c) => (c.key === 'name' ? esc(r.name) : c.key === 'note' ? (r.note ? esc(`[[${r.note}]]`) : '') : esc(r.cells[c.key] ?? ''))).join(' | ')} |`);
  return [head, sep, ...lines].join('\n');
}

function renderLogs(doc: Pick<BillsTableDoc, 'rows' | 'prices' | 'payments'>): string {
  const out: string[] = [];
  if (Object.values(doc.prices).some((l) => l.length)) {
    out.push('## Price history', '');
    for (const r of doc.rows) {
      const lines = doc.prices[billNameKey(r.name)];
      if (!lines?.length) continue;
      out.push(`### ${r.name}`, '', '| Date | Amount | Note |', '| --- | --- | --- |', ...lines.map((l) => `| ${esc(l.date ?? '')} | ${l.amount.toFixed(2)} | ${esc(l.note)} |`), '');
    }
  }
  if (Object.values(doc.payments).some((l) => l.length)) {
    out.push('## Payments', '');
    for (const r of doc.rows) {
      const lines = doc.payments[billNameKey(r.name)];
      if (!lines?.length) continue;
      out.push(`### ${r.name}`, '', ...lines, '');
    }
  }
  return out.join('\n').replace(/\n+$/, '');
}

/** A fresh list file: frontmatter with its version, a plain heading, the rows, then the histories. */
export function renderBillsTable(doc: { rows: BillsRow[]; prices?: Record<string, PriceLine[]>; payments?: Record<string, string[]>; version?: number }): string {
  const full: Pick<BillsTableDoc, 'rows' | 'prices' | 'payments'> = { rows: doc.rows, prices: doc.prices ?? {}, payments: doc.payments ?? {} };
  const body = renderLogs(full);
  return `---\ntype: bills-table\ntable: bills\nversion: ${doc.version ?? TABLE_VERSION}\n---\n# ${TABLE_TITLE}\n\nOne line per bill. You can read this file; the Money page reads it too.\n\n${renderTable(doc.rows)}\n${body ? `\n${body}\n` : ''}`;
}

/** Lines this side never writes (merged copies, a person's own sections and lines) kept verbatim across writes. */
function preservedOf(text: string): string[] {
  const lines = String(text ?? '').split(/\r?\n/);
  const keep = new Array<boolean>(lines.length).fill(true);
  // Frontmatter, the title and the main table are managed; merged copies (later tables) are preserved.
  const fm = /^---\r?$/.test(lines[0] ?? '') ? lines.findIndex((l, i) => i > 0 && /^---\r?$/.test(l)) : -1;
  if (fm > 0) for (let i = 0; i <= fm; i++) keep[i] = false;
  const blocks = blocksOf(lines);
  const main = blocks.find((b) => b.main);
  // Managed regions: the title block, the main table, and the Price history / Payments sections.
  let inManaged = false;
  for (let i = 0; i < lines.length; i++) {
    const h = /^\s*(#{1,3})\s+(.+?)\s*$/.exec(lines[i]);
    if (h && h[1].length <= 2) {
      const words = h[2].trim().toLowerCase();
      if ((h[1].length === 1 && words === TABLE_TITLE.toLowerCase()) || words === 'price history' || words === 'payments' || words === 'payment') {
        inManaged = true;
        keep[i] = false;
        continue;
      }
      inManaged = false;
      continue;
    }
    if (inManaged) keep[i] = false;
  }
  if (main) for (let i = main.start; i < main.end; i++) keep[i] = false;
  if (main) {
    // Lines the reader skips for want of a name still hold facts: keep them byte for byte.
    for (let i = main.start + 2; i < main.end; i++) {
      const cells = splitCells(lines[i]);
      if (cells.some((c) => c) && !cells[0].trim()) keep[i] = true;
    }
  }
  // The intro line under the title is rewritten each time; anything else outside managed parts stays.
  const kept: string[] = [];
  lines.forEach((line, i) => {
    if (keep[i]) kept.push(line);
  });
  // Squeeze only the blank edges; every other line stays byte for byte.
  while (kept.length && !kept[0].trim()) kept.shift();
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  return kept;
}

/** The file changed through its reader: managed parts rewritten, everything else kept byte for byte. */
export function updateBillsTable(text: string, fn: (doc: BillsTableDoc) => BillsTableDoc): string {
  const doc = readBillsTable(text);
  const next = fn(doc);
  const kept = preservedOf(text);
  let out = renderBillsTable({ rows: next.rows, prices: next.prices, payments: next.payments, version: doc.version });
  if (kept.length) out = `${out.replace(/\n+$/, '')}\n\n${kept.join('\n')}\n`;
  return out;
}

/** Two PCs' copies united: every row from both sides kept, a bill changed on both kept twice and named. */
export function mergeBillsTables(mine: string, theirs: string, source: string, day: string): { text: string; changed: boolean } {
  const a = readBillsTable(mine);
  const b = readBillsTable(theirs);
  const have = new Map<string, string>();
  for (const r of a.rows) have.set(billNameKey(r.name), sigOf(r));
  const rows = [...a.rows];
  const conflicts: BillsRow[] = [];
  for (const r of b.rows) {
    const key = billNameKey(r.name);
    if (!have.has(key)) {
      have.set(key, sigOf(r));
      rows.push(r);
    } else if (have.get(key) !== sigOf(r) && !conflicts.some((c) => billNameKey(c.name) === key)) {
      conflicts.push(r);
    }
  }
  // Their own disagreements travel too (a version their file kept twice is still money, never dropped).
  for (const vers of Object.values(b.conflicts)) {
    for (const v of vers) {
      const key = billNameKey(v.name);
      if (have.get(key) === sigOf(v)) continue;
      if (rows.some((r) => billNameKey(r.name) === key && sigOf(r) === sigOf(v))) continue;
      if (conflicts.some((c) => sigOf(c) === sigOf(v))) continue;
      conflicts.push(v);
    }
  }
  const prices: Record<string, PriceLine[]> = JSON.parse(JSON.stringify(a.prices));
  const payments: Record<string, string[]> = JSON.parse(JSON.stringify(a.payments));
  const priceSig = (l: PriceLine) => `${l.date ?? ''}\n${l.amount}\n${l.note}`;
  for (const [k, lines] of Object.entries(b.prices)) {
    const seen = new Set((prices[k] ?? []).map(priceSig));
    for (const l of lines) if (!seen.has(priceSig(l))) {
      seen.add(priceSig(l));
      (prices[k] ??= []).push(l);
    }
  }
  for (const [k, lines] of Object.entries(b.payments)) {
    const seen = new Set(payments[k] ?? []);
    for (const l of lines) if (!seen.has(l)) {
      seen.add(l);
      (payments[k] ??= []).push(l);
    }
  }
  let text = updateBillsTable(mine, (doc) => ({ ...doc, rows, prices, payments }));
  let changed = text !== mine;
  if (conflicts.length) {
    // Their versions kept as their own lines under a merged heading (read again as rows, first still winning).
    const missing = conflicts.filter((r) => !text.split('\n').some((l) => l.trim() === tableLineOf(r).trim()));
    if (missing.length) {
      text = `${text.replace(/\n+$/, '')}\n\n${[`## Merged from ${source} (${day})`, '', renderTable(missing), ''].join('\n')}`;
      changed = true;
    }
  }
  return { text, changed };
}

const sigOf = (r: BillsRow): string => [billNameKey(r.name), ...Object.keys(r.cells).sort().map((k) => r.cells[k]), r.note ?? ''].join('\n');
const tableLineOf = (r: BillsRow): string => renderTable([r]).split('\n').pop() ?? '';

/** One version chosen for a bill changed on both PCs (`keep` counts the shown one as 0): its line becomes
 *  the bill's own line and the other lines go, everything else in the file byte for byte (blank runs left
 *  by the removal collapse to one). A merged table left with no rows loses its own header too, and an emptied
 *  merged section its heading, so the file still reads clean. */
export function resolveBillsConflict(text: string, name: string, keep: number): string {
  const src = String(text ?? '');
  const doc = readBillsTable(src);
  const key = billNameKey(String(name ?? '').trim());
  const kept = doc.rows.find((r) => billNameKey(r.name) === key);
  const others = doc.conflicts[key] ?? [];
  if (!kept || !others.length) throw new Error('That bill agrees now. Nothing to choose.');
  const versions = [kept, ...others];
  if (!Number.isInteger(keep) || keep < 0 || keep >= versions.length) throw new Error('Choose one of the versions shown.');
  const chosen = versions[keep];
  const lines = src.split(/\r?\n/);
  // The first line naming it becomes the chosen version; every later copy goes (even one merged twice:
  // the page chose once, the file holds once).
  const drop = new Set<number>();
  let first = -1;
  for (const b of blocksOf(lines)) {
    if (!b.main) continue;
    for (let i = b.start + 2; i < b.end; i++) {
      if (billNameKey((splitCells(lines[i])[0] ?? '').trim()) !== key) continue;
      if (first < 0) first = i;
      else drop.add(i);
    }
  }
  if (first < 0) throw new Error('That bill agrees now. Nothing to choose.');
  lines[first] = tableLineOf({ name: kept.name, cells: chosen.cells, note: chosen.note });
  const out = lines.filter((_, i) => !drop.has(i));
  // A merged table left rowless loses its header lines with its rows (the main table always stays).
  const pruned: string[] = [];
  const again = blocksOf(out);
  const mainIdx = again.findIndex((b) => b.main);
  const skip = new Set<number>();
  again.forEach((b, bi) => {
    if (!b.main || bi === mainIdx) return;
    let n = 0;
    for (let i = b.start + 2; i < b.end; i++) if (splitCells(out[i]).some((c) => c)) n++;
    if (!n) {
      skip.add(b.start);
      skip.add(b.start + 1);
    }
  });
  out.forEach((l, i) => {
    if (!skip.has(i)) pruned.push(l);
  });
  // A merged section left with nothing under it loses its heading too (history stays in File recovery).
  const final: string[] = [];
  for (let i = 0; i < pruned.length; i++) {
    if (/^## Merged from\b/.test(pruned[i].trim())) {
      let j = i + 1;
      while (j < pruned.length && !pruned[j].trim()) j++;
      if (j >= pruned.length || /^##(?!#)/.test(pruned[j].trim())) continue;
    }
    final.push(pruned[i]);
  }
  return final.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

export interface BillsRowLink { target: string; words: string }
export interface BillsRowOut { path: string; name: string; note: string | null; targets: BillsRowLink[] }

/** Every row in Bills list texts (path with text), with the [[targets]] its cells name: the one reading every door
 *  uses (link checks, backlinks, the graph). The first list by path; each target with the fact
 *  that names it, as the backlinks panel reads it. */
export function rowsInBillsTexts(texts: [path: string, text: string][]): BillsRowOut[] {
  const out: BillsRowOut[] = [];
  let done = false;
  for (const [p, text] of [...texts].sort(([a], [b]) => a.localeCompare(b))) {
    if (done || !isBillsTablePath(p)) continue;
    let doc: BillsTableDoc;
    try {
      if (!isBillsTableText(text)) continue;
      doc = readBillsTable(text);
    } catch {
      continue;
    }
    done = true;
    for (const row of doc.rows) {
      const targets: BillsRowLink[] = [];
      for (const col of COLUMNS) {
        if (!['account', 'project'].includes(col.key)) continue;
        const cell = row.cells[col.key] ?? '';
        for (const m of cell.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g)) {
          const t = m[1].trim();
          if (t) targets.push({ target: t, words: `${col.head}: ${cell.trim()}` });
        }
      }
      out.push({ path: rowPathIn(doc.rows, p, row.name), name: row.name, note: row.note, targets });
    }
  }
  return out;
}

/** A row rendered as the note it would be: facts as properties, its histories as sections. */
export function renderBillRowNote(row: BillsRow, prices: Record<string, PriceLine[]>, payments: Record<string, string[]>): string {
  const c = row.cells;
  const link = (v: string) => (v ? ` "[[${v.replace(/^\[\[|\]\]$/g, '').replace(/"/g, '')}]]"` : '');
  const front = [
    'type: bill',
    `kind: ${c.kind || 'Bill'}`,
    `amount:${c.amount ? ` ${c.amount}` : ''}`,
    `cycle: ${c.cycle || 'Monthly'}`,
    `due:${c.due ? ` ${c.due}` : ''}`,
    `category: ${c.category || 'Other'}`,
    `account:${link(c.account)}`,
    `project:${link(c.project)}`,
    `autopay: ${c.autopay || 'No'}`,
    `status: ${c.status || 'Active'}`,
    ...(c.paid ? [`paid: ${c.paid}`] : []),
  ];
  const key = billNameKey(row.name);
  const history = prices[key] ?? [];
  const priceSection = history.length ? `## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n${history.map((l) => `| ${l.date ?? ''} | ${l.amount.toFixed(2)} | ${l.note} |`).join('\n')}\n\n` : '';
  const paid = payments[key] ?? [];
  return `---\n${front.join('\n')}\n---\n${priceSection}## Notes\n\n${paid.length ? `${paid.join('\n')}\n` : ''}`;
}

/** A Bills list text (as the index holds it) read: a row path rendered as the note it would be, else null. */
export function renderBillRowFromTableText(text: string, rowPathStr: string): string | null {
  const split = splitBillRow(rowPathStr);
  if (!split) return null;
  let doc: BillsTableDoc;
  try {
    doc = readBillsTable(text);
  } catch {
    return null;
  }
  const row = findRowBySlug(doc.rows, split.slug);
  if (!row || row.note) return null;
  return `# ${row.name}\n\n${renderBillRowNote(row, doc.prices, doc.payments)}`;
}

// ── The filler's test (records as data) ──────────────────────────────────────────────────────────────────────────────

export interface ClassifyBillNote { type?: string; title: string; props: Record<string, unknown>; content: string; files?: string[] }
export interface ClassifyBillOut { fold: boolean; why: string }

/** A payment's own line on a bill (`- Paid $150.00 on Mon 2 Nov.`): machine words, carried in the list. */
export const MACHINE_PAID = /^- Paid(\s|$)/;

/** A frame's own details (frontmatter an assistant wrote; the list carries each of these, and nothing else). */
const FRAME_KEYS = new Set(['type', 'kind', 'amount', 'cycle', 'due', 'category', 'account', 'project', 'nickname', 'aliases', 'autopay', 'status', 'paid']);
const NOTES_HEADING = /^(notes?|about)$/i;
const PRICE_HEADING = /^price history$/i;

/** Whether the details block holds a `#` comment (outside quotes): the person's own words, which the list
 *  never carries, so the note stays. A `#` inside quotes, or without a space before it, is a value, not a note. */
function hasDetailsComment(text: string): boolean {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(String(text ?? ''));
  if (!m) return false;
  for (const line of m[1].split(/\r?\n/)) {
    let quote: string | null = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (c === quote) quote = null;
        else if (c === '\\' && quote === '"') i++;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if (c === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) return true;
    }
  }
  return false;
}

/** The body split into its sections (null when the frame around it is broken). */
function frameSections(text: string): { preface: string[]; sections: { name: string; lines: string[] }[] } | null {
  const lines = String(text ?? '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (lines[i]?.trim() !== '---') return null;
  i++;
  while (i < lines.length && lines[i].trim() !== '---' && lines[i].trim() !== '...') i++;
  if (i >= lines.length) return null;
  const preface: string[] = [];
  const sections: { name: string; lines: string[] }[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  for (const line of lines.slice(i + 1)) {
    const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (h) {
      // Only an assistant's own ## sections belong to a frame (a person's # or ### heading is their structure).
      if (h[1] !== '##') return null;
      cur = { name: h[2], lines: [] };
      sections.push(cur);
      continue;
    }
    (cur ? cur.lines : preface).push(line);
  }
  return { preface, sections };
}

/** Whether a bill note is a machine-made frame (folds into the list) or holds something of the person's (stays).
 *  When unsure it stays: only a note that is clearly all machine work folds. */
export function classifyBillNote(n: ClassifyBillNote): ClassifyBillOut {
  const type = String(n.type ?? n.props?.type ?? '').toLowerCase();
  if (type !== 'bill') return { fold: false, why: 'not a bill' };
  const text = String(n.content ?? '');
  if (text.startsWith('﻿')) return { fold: false, why: 'not written as a bill, so it stays' };
  if (!/^\s*---\s*\r?\n/.test(text)) return { fold: false, why: 'not written as a bill, so it stays' };
  // Files kept with it are the person's, always; details the list cannot carry stay with the note.
  if ((n.files ?? []).length) return { fold: false, why: 'has files kept with it' };
  const props = n.props ?? {};
  if (!Object.keys(props).length) return { fold: false, why: 'not written as a bill, so it stays' };
  if (Object.keys(props).some((k) => !FRAME_KEYS.has(String(k).toLowerCase()))) return { fold: false, why: 'has extra details' };
  if (hasDetailsComment(text)) return { fold: false, why: 'has a note in its details' };
  // Words the list cannot carry stay with the note (an amount or day it cannot read would fold to blank).
  const said = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : v === null || v === undefined ? '' : String(v)).trim();
  if (said(props.amount) && readMoney(props.amount) === null) return { fold: false, why: 'has an amount the list cannot carry' };
  if (said(props.due) && readIsoDay(props.due) === null) return { fold: false, why: 'has a due day the list cannot carry' };
  if (said(props.paid) && readIsoDay(props.paid) === null) return { fold: false, why: 'has a paid day the list cannot carry' };
  // The body must be all frame: nothing before the first section, only an assistant's own sections, each holding
  // only what an assistant writes (prices as a table, payment lines and an empty notes area).
  const frame = frameSections(text);
  if (!frame) return { fold: false, why: 'not written as a bill, so it stays' };
  if (frame.preface.some((l) => l.trim())) return { fold: false, why: 'has words you wrote' };
  for (const s of frame.sections) {
    const isNotes = NOTES_HEADING.test(s.name);
    const isPrices = PRICE_HEADING.test(s.name);
    if (!isNotes && !isPrices) return { fold: false, why: 'has a section of its own' };
    // Words in the notes area are the person's, always; a payment's own lines are the machine's.
    if (isNotes && s.lines.some((l) => l.trim() && !MACHINE_PAID.test(l.trim()))) return { fold: false, why: 'has words you wrote' };
    if (isPrices && s.lines.some((l) => l.trim() && !/^\s*\|/.test(l))) return { fold: false, why: 'has words you wrote' };
  }
  // Nothing hidden: no comment, link, picture, tag or reminder outside what an assistant writes.
  const body = frame.sections.map((s) => s.lines.join('\n')).join('\n');
  if (body.includes('<!--')) return { fold: false, why: 'has a hidden note' };
  if (body.includes('⏰')) return { fold: false, why: 'has a reminder' };
  if (body.includes('[[') || body.includes('![')) return { fold: false, why: 'links to something else' };
  if (/(?:^|[\s(])#[A-Za-z]/.test(body)) return { fold: false, why: 'has a tag' };
  // Prices: the first line is the assistant's; a longer history means it changed hands, so it stays.
  let priceRows = 0;
  for (const s of frame.sections) {
    if (!PRICE_HEADING.test(s.name)) continue;
    for (const l of s.lines) {
      if (!/^\s*\|.*\|\s*$/.test(l) || /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(l)) continue;
      const cells = l.split('|').map((x) => x.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
      if (cells.some((c) => c) && !/^(date|when|from|amount|price|cost|notes?|why)$/i.test(cells[0] ?? '')) priceRows++;
    }
  }
  if (priceRows > 1) return { fold: false, why: 'its price changed before' };
  return { fold: true, why: 'added by an assistant, nothing written' };
}
