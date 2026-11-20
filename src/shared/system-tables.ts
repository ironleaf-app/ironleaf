// Machine records as data (5 Nov 2026): one readable file per Systems kind inside the vault, each a plain
// Markdown table the person can open and read. Machines.md, Services.md and Runbooks.md sit beside the Machines,
// Services and Runbooks folders; each holds one row per record plus the record's own checks (machines and
// services) or runs (runbooks) under it. One row per line, so OneDrive's own line merging keeps every row from
// both sides; two PCs changing the same record keep both lines and the reader says which records disagree. A
// record that gains typed words becomes a note file of its own again, and its row keeps pointing at it. Pure: no
// files, no Node, no DOM.

import { readDay, readTable } from './personal-records';
import { credentialsOf, listOf, RUNS, HEALTH_LOG, runbooksFromCheck, STEPS_HEADING, type ProbeService } from './systems';

export type SystemsTableKind = 'machine' | 'service' | 'runbook';

export const TABLE_FILES: Record<SystemsTableKind, string> = { machine: 'Machines.md', service: 'Services.md', runbook: 'Runbooks.md' };
export const TABLE_TITLES: Record<SystemsTableKind, string> = { machine: 'Machines', service: 'Services', runbook: 'Runbooks' };
export const TABLE_PLURAL: Record<SystemsTableKind, string> = { machine: 'machines', service: 'services', runbook: 'runbooks' };
export const TABLE_VERSION = 1;

/** A table file's path under its module folder. */
export const tableRel = (moduleFolder: string, kind: SystemsTableKind): string => `${moduleFolder}/${TABLE_FILES[kind]}`;

/** A record's row path: its table file plus its slug (`Services.md#photo-library`). Opens its record page. */
export const rowSlug = (name: string): string => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'row';
export const rowPath = (table: string, name: string): string => `${table}#${rowSlug(name)}`;
/** Every row's slug in file order (shared slugs numbered: `A B` keeps `a-b`, `A-B` opens `a-b-2`). */
function slugsOf(rows: SystemsRow[]): string[] {
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
/** A record's slug among its table's rows, so names sharing one open their own pages. */
export function rowSlugIn(rows: SystemsRow[], name: string): string {
  const i = rows.findIndex((r) => r.name.toLowerCase() === String(name ?? '').toLowerCase());
  return i < 0 ? rowSlug(name) : slugsOf(rows)[i];
}
/** A record's row path among its table's rows (shared slugs numbered, each opening its own page). */
export const rowPathIn = (rows: SystemsRow[], table: string, name: string): string => `${table}#${rowSlugIn(rows, name)}`;
/** The row a slug names (null when none; a shared slug opens its own page, never the first). */
export function findRowBySlug(rows: SystemsRow[], slug: string): SystemsRow | null {
  const i = slugsOf(rows).indexOf(String(slug ?? '').toLowerCase());
  return i < 0 ? null : rows[i];
}
export function splitRowPath(p: unknown): { table: string; kind: SystemsTableKind; slug: string } | null {
  if (typeof p !== 'string') return null;
  const m = /^(.+\.md)#([^#]+)$/.exec(p);
  if (!m) return null;
  const kind = tableKindOfPath(m[1]);
  return kind ? { table: m[1], kind, slug: m[2] } : null;
}

/** Which table a vault path is, by its file name (a row path's table part too). */
export function tableKindOfPath(rel: string): SystemsTableKind | null {
  const base = String(rel ?? '').split('#')[0].split('/').pop() ?? '';
  const hit = (Object.keys(TABLE_FILES) as SystemsTableKind[]).find((k) => TABLE_FILES[k].toLowerCase() === base.toLowerCase());
  return hit ?? null;
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

export const isSystemsTableText = (text: string): boolean => frontmatterOf(text).type === 'systems-table';
export function tableKindOfText(text: string): SystemsTableKind | null {
  if (!isSystemsTableText(text)) return null;
  const t = frontmatterOf(text).table;
  const hit = (Object.keys(TABLE_PLURAL) as SystemsTableKind[]).find((k) => TABLE_PLURAL[k] === t);
  return hit ?? null;
}

// ── Columns ────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Column { head: string; key: string }
const COLUMNS: Record<SystemsTableKind, Column[]> = {
  machine: [
    { head: 'Name', key: 'name' }, { head: 'Kind', key: 'kind' }, { head: 'Role', key: 'role' }, { head: 'System', key: 'os' },
    { head: 'Address', key: 'address' }, { head: 'Where it is', key: 'location' }, { head: 'Status', key: 'status' },
    { head: 'Last checked', key: 'checked' }, { head: 'Logins', key: 'logins' }, { head: 'Note file', key: 'note' },
  ],
  service: [
    { head: 'Name', key: 'name' }, { head: 'Kind', key: 'kind' }, { head: 'Runs on', key: 'runsOn' }, { head: 'Address', key: 'url' },
    { head: 'Port', key: 'port' }, { head: 'Status', key: 'status' }, { head: 'Depends on', key: 'dependsOn' },
    { head: 'Runbook', key: 'runbook' }, { head: 'Last checked', key: 'checked' }, { head: 'Logins', key: 'logins' }, { head: 'Note file', key: 'note' },
  ],
  runbook: [
    { head: 'Name', key: 'name' }, { head: 'For', key: 'for' }, { head: 'How often', key: 'every' },
    { head: 'Last run', key: 'lastRun' }, { head: 'Pattern', key: 'pattern' }, { head: 'Note file', key: 'note' },
  ],
};

export interface SystemsRow { name: string; cells: Record<string, string>; note: string | null }
export interface HealthLine { date: string | null; status: string; note: string }
export interface RunLine { date: string | null; result: string; note: string }
export interface SystemsTableDoc {
  kind: SystemsTableKind;
  version: number;
  rows: SystemsRow[];
  /** Health and run lines by record name (lowercased), in file order. */
  logs: Record<string, HealthLine[]>;
  runs: Record<string, RunLine[]>;
  /** Records whose lines disagree (both kept; the first read wins until the person tidies the file). */
  dupes: string[];
  /** Each disagreeing record's other versions (lowercased name to rows), in file order after the shown one. */
  conflicts: Record<string, SystemsRow[]>;
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

const headerKeys = (heads: string[], kind: SystemsTableKind): string[] | null => {
  const cols = COLUMNS[kind];
  if (heads.length !== cols.length) return null;
  if (heads[0].toLowerCase() !== 'name') return null;
  for (let i = 1; i < cols.length; i++) if (heads[i].toLowerCase() !== cols[i].head.toLowerCase()) return null;
  return cols.map((c) => c.key);
};

interface TableBlock { start: number; end: number; keys: string[] | 'log' | 'runs' | null }

function blocksOf(lines: string[], kind: SystemsTableKind): TableBlock[] {
  // Every table in the file, wherever it sits (the main one and any merged copies below it).
  const out: TableBlock[] = [];
  let inLog = false;
  let inRuns = false;
  for (let i = 0; i < lines.length; i++) {
    const h2 = /^\s*##\s+(.+?)\s*$/.exec(lines[i]);
    if (h2) {
      inLog = /^health log$/i.test(h2[1]);
      inRuns = /^runs?$/i.test(h2[1]);
    }
    if (!isTableLine(lines[i]) || !isSep(lines[i + 1] ?? '')) continue;
    const heads = splitCells(lines[i]);
    let end = i + 2;
    while (end < lines.length && isTableLine(lines[end]) && !isSep(lines[end])) end++;
    const keys = headerKeys(heads, kind);
    out.push({ start: i, end, keys: keys ?? (inLog && !inRuns ? 'log' : inRuns && !inLog ? 'runs' : null) });
    i = end - 1;
  }
  return out;
}

/** The file read: every row in every matching table (first wins), every health and run line, disagreements named. */
export function readSystemsTable(text: string): SystemsTableDoc {
  const src = String(text ?? '');
  const fm = frontmatterOf(src);
  const kind = tableKindOfText(src);
  if (!kind) throw new Error('That file is not a Systems list.');
  const version = /^\d+$/.test(fm.version ?? '') ? Number(fm.version) : TABLE_VERSION;
  const lines = src.split(/\r?\n/);
  const blocks = blocksOf(lines, kind);
  const rows: SystemsRow[] = [];
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  const conflicts: Record<string, SystemsRow[]> = {};
  const conflictSigs = new Map<string, Set<string>>();
  for (const b of blocks) {
    if (!Array.isArray(b.keys) || !b.keys.length) continue;
    for (let i = b.start + 2; i < b.end; i++) {
      const cells = splitCells(lines[i]);
      if (!cells.length || cells.every((c) => !c)) continue;
      const byKey: Record<string, string> = {};
      b.keys.forEach((k, n) => {
        byKey[k] = cells[n] ?? '';
      });
      const name = (byKey.name ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const sig = b.keys.map((k) => byKey[k]).join('\n');
      if (!seen.has(key)) {
        seen.set(key, sig);
        rows.push({ name, cells: rowCells(kind, byKey), note: noteOf(byKey.note ?? '') });
      } else if (seen.get(key) !== sig) {
        if (!dupes.some((d) => d.toLowerCase() === key)) dupes.push(name);
        // Each other version kept for the record's page, where the person chooses (the same line twice
        // from two merges still chooses once).
        const known = conflictSigs.get(key) ?? new Set<string>([seen.get(key)!]);
        if (!known.has(sig)) {
          known.add(sig);
          conflictSigs.set(key, known);
          (conflicts[key] ??= []).push({ name, cells: rowCells(kind, byKey), note: noteOf(byKey.note ?? '') });
        }
      }
    }
  }
  // Health and runs: the `### <name>` tables under each section, in file order.
  const logs: Record<string, HealthLine[]> = {};
  const runs: Record<string, RunLine[]> = {};
  let section: 'log' | 'runs' | null = null;
  let at = '';
  for (let i = 0; i < lines.length; i++) {
    const h2 = /^\s*##\s+(.+?)\s*$/.exec(lines[i]);
    if (h2) {
      section = /^health log$/i.test(h2[1]) ? 'log' : /^runs?$/i.test(h2[1]) ? 'runs' : null;
      at = '';
      continue;
    }
    const h3 = /^\s*###\s+(.+?)\s*$/.exec(lines[i]);
    if (h3 && section) {
      at = h3[1].trim();
      continue;
    }
    if (section && at && isTableLine(lines[i]) && isSep(lines[i + 1] ?? '')) {
      const heads = splitCells(lines[i]).map((h) => h.toLowerCase());
      const di = heads.findIndex((h) => /^(date|when|day)$/.test(h));
      const si = heads.findIndex((h) => /^(status|state|result|outcome)$/.test(h));
      const ni = heads.findIndex((h) => /^(notes?|what|details?)$/.test(h));
      if (di >= 0) {
        const key = at.toLowerCase();
        for (let j = i + 2; j < lines.length && isTableLine(lines[j]) && !isSep(lines[j]); j++) {
          const cells = splitCells(lines[j]);
          if (cells.every((c) => !c)) continue;
          if (section === 'log') (logs[key] ??= []).push({ date: readDay(cells[di] ?? '') ?? null, status: cells[si] ?? '', note: cells[ni] ?? '' });
           
          else (runs[key] ??= []).push({ date: readDay(cells[di] ?? '') ?? null, result: cells[si] ?? '', note: cells[ni] ?? '' });
        }
      }
    }
  }
  return { kind, version, rows, logs, runs, dupes, conflicts };
}

const rowCells = (kind: SystemsTableKind, byKey: Record<string, string>): Record<string, string> => {
  const cells: Record<string, string> = {};
  for (const c of COLUMNS[kind]) if (c.key !== 'name' && c.key !== 'note') cells[c.key] = byKey[c.key] ?? '';
  return cells;
};
const noteOf = (cell: string): string | null => {
  const t = String(cell ?? '').trim();
  if (!t) return null;
  return t.replace(/^\[\[|\]\]$/g, '').split('|')[0].trim() || null;
};

const INTRO: Record<SystemsTableKind, string> = {
  machine: 'One line per machine. You can read this file; the Systems page reads it too.',
  service: 'One line per service. You can read this file; the Systems page reads it too.',
  runbook: 'One line per runbook. Steps come from the shared pattern, filled in for what each is for.',
};

function renderTable(kind: SystemsTableKind, rows: SystemsRow[]): string {
  const cols = COLUMNS[kind];
  const head = `| ${cols.map((c) => c.head).join(' | ')} |`;
  const sep = `|${cols.map(() => ' --- ').join('|')}|`;
  const lines = rows.map((r) => `| ${cols.map((c) => (c.key === 'name' ? esc(r.name) : c.key === 'note' ? (r.note ? esc(`[[${r.note}]]`) : '') : esc(r.cells[c.key] ?? ''))).join(' | ')} |`);
  return [head, sep, ...lines].join('\n');
}

function renderLogs(kind: SystemsTableKind, doc: Pick<SystemsTableDoc, 'rows' | 'logs' | 'runs'>): string {
  const out: string[] = [];
  const hasLogs = kind !== 'runbook' && Object.values(doc.logs).some((l) => l.length);
  const hasRuns = kind === 'runbook' && Object.values(doc.runs).some((l) => l.length);
  if (hasLogs) {
    out.push('## Health log', '');
    for (const r of doc.rows) {
      const lines = doc.logs[r.name.toLowerCase()];
      if (!lines?.length) continue;
      out.push(`### ${r.name}`, '', '| Date | Status | Note |', '| --- | --- | --- |', ...lines.map((l) => `| ${esc(l.date ?? '')} | ${esc(l.status)} | ${esc(l.note)} |`), '');
    }
  }
  if (hasRuns) {
    out.push('## Runs', '');
    for (const r of doc.rows) {
      const lines = doc.runs[r.name.toLowerCase()];
      if (!lines?.length) continue;
      out.push(`### ${r.name}`, '', '| Date | Result | Note |', '| --- | --- | --- |', ...lines.map((l) => `| ${esc(l.date ?? '')} | ${esc(l.result)} | ${esc(l.note)} |`), '');
    }
  }
  return out.join('\n').replace(/\n+$/, '');
}

/** A fresh table file: frontmatter with its version, a plain heading, the rows, then the checks. */
export function renderSystemsTable(kind: SystemsTableKind, doc: { rows: SystemsRow[]; logs?: Record<string, HealthLine[]>; runs?: Record<string, RunLine[]>; version?: number }): string {
  const full: Pick<SystemsTableDoc, 'rows' | 'logs' | 'runs'> = { rows: doc.rows, logs: doc.logs ?? {}, runs: doc.runs ?? {} };
  const body = renderLogs(kind, full);
  return `---\ntype: systems-table\ntable: ${TABLE_PLURAL[kind]}\nversion: ${doc.version ?? TABLE_VERSION}\n---\n# ${TABLE_TITLES[kind]}\n\n${INTRO[kind]}\n\n${renderTable(kind, doc.rows)}\n${body ? `\n${body}\n` : ''}`;
}

/** Lines this side never writes (merged copies, a person's own sections and lines) kept verbatim across writes. */
function preservedOf(text: string, kind: SystemsTableKind): string[] {
  const lines = String(text ?? '').split(/\r?\n/);
  const keep = new Array<boolean>(lines.length).fill(true);
  // Frontmatter, the title and the main table are managed; merged copies (later tables) are preserved.
  const fm = /^---\r?$/.test(lines[0] ?? '') ? lines.findIndex((l, i) => i > 0 && /^---\r?$/.test(l)) : -1;
  if (fm > 0) for (let i = 0; i <= fm; i++) keep[i] = false;
  const blocks = blocksOf(lines, kind);
  const main = blocks.find((b) => Array.isArray(b.keys));
  // Managed regions: the title block, the main table, and the Health log / Runs sections.
  let inManaged = false;
  for (let i = 0; i < lines.length; i++) {
    const h = /^\s*(#{1,3})\s+(.+?)\s*$/.exec(lines[i]);
    if (h && h[1].length <= 2) {
      const words = h[2].trim().toLowerCase();
      const title = TABLE_TITLES[kind].toLowerCase();
      if ((h[1].length === 1 && words === title) || words === 'health log' || words === 'runs' || words === 'run') {
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
export function updateSystemsTable(text: string, kind: SystemsTableKind, fn: (doc: SystemsTableDoc) => SystemsTableDoc): string {
  const doc = readSystemsTable(text);
  if (doc.kind !== kind) throw new Error('That list is for another kind of record.');
  const next = fn(doc);
  const kept = preservedOf(text, kind);
  let out = renderSystemsTable(kind, { rows: next.rows, logs: next.logs, runs: next.runs, version: doc.version });
  if (kept.length) out = `${out.replace(/\n+$/, '')}\n\n${kept.join('\n')}\n`;
  return out;
}

/** Two PCs' copies united: every row from both sides kept, a record changed on both kept twice and named. */
export function mergeSystemsTables(mine: string, theirs: string, source: string, day: string): { text: string; changed: boolean } {
  const a = readSystemsTable(mine);
  const b = readSystemsTable(theirs);
  if (a.kind !== b.kind) throw new Error('Those lists are for different records.');
  const have = new Map<string, string>();
  for (const r of a.rows) have.set(r.name.toLowerCase(), sigOf(r));
  const rows = [...a.rows];
  const conflicts: SystemsRow[] = [];
  for (const r of b.rows) {
    const key = r.name.toLowerCase();
    if (!have.has(key)) {
      have.set(key, sigOf(r));
      rows.push(r);
    } else if (have.get(key) !== sigOf(r) && !conflicts.some((c) => c.name.toLowerCase() === key)) {
      conflicts.push(r);
    }
  }
  const logs: Record<string, HealthLine[]> = JSON.parse(JSON.stringify(a.logs));
  const runs: Record<string, RunLine[]> = JSON.parse(JSON.stringify(a.runs));
  const logSig = (l: HealthLine | RunLine) => `${l.date ?? ''}\n${'status' in l ? l.status : (l as RunLine).result}\n${l.note}`;
  for (const [k, lines] of Object.entries(b.logs)) {
    const seen = new Set((logs[k] ?? []).map(logSig));
    for (const l of lines) if (!seen.has(logSig(l))) {
      seen.add(logSig(l));
      (logs[k] ??= []).push(l);
    }
  }
  for (const [k, lines] of Object.entries(b.runs)) {
    const seen = new Set((runs[k] ?? []).map(logSig));
    for (const l of lines) if (!seen.has(logSig(l))) {
      seen.add(logSig(l));
      (runs[k] ??= []).push(l);
    }
  }
  let text = updateSystemsTable(mine, a.kind, (doc) => ({ ...doc, rows, logs, runs }));
  let changed = text !== mine;
  if (conflicts.length) {
    // Their versions kept as their own lines under a merged heading (read again as rows, first still winning).
    const missing = conflicts.filter((r) => !text.split('\n').some((l) => l.trim() === tableLineOf(a.kind, r).trim()));
    if (missing.length) {
      text = `${text.replace(/\n+$/, '')}\n\n${[`## Merged from ${source} (${day})`, '', renderTable(a.kind, missing), ''].join('\n')}`;
      changed = true;
    }
  }
  return { text, changed };
}

const sigOf = (r: SystemsRow): string => [r.name.toLowerCase(), ...Object.keys(r.cells).sort().map((k) => r.cells[k]), r.note ?? ''].join('\n');
const tableLineOf = (kind: SystemsTableKind, r: SystemsRow): string => renderTable(kind, [r]).split('\n').pop() ?? '';

/** One version chosen for a record changed on both PCs (`keep` counts the shown one as 0): its line becomes
 *  the record's own line and the other lines go, everything else in the file byte for byte (blank runs left
 *  by the removal collapse to one). A merged table left with no rows loses its own header too, and an emptied
 *  merged section its heading, so the file still reads clean. */
export function resolveSystemsConflict(text: string, kind: SystemsTableKind, name: string, keep: number): string {
  const src = String(text ?? '');
  const doc = readSystemsTable(src);
  if (doc.kind !== kind) throw new Error('That list is for another kind of record.');
  const key = String(name ?? '').trim().toLowerCase();
  const kept = doc.rows.find((r) => r.name.toLowerCase() === key);
  const others = doc.conflicts[key] ?? [];
  if (!kept || !others.length) throw new Error('That record agrees now. Nothing to choose.');
  const versions = [kept, ...others];
  if (!Number.isInteger(keep) || keep < 0 || keep >= versions.length) throw new Error('Choose one of the versions shown.');
  const chosen = versions[keep];
  const lines = src.split(/\r?\n/);
  // The first line naming it becomes the chosen version; every later copy goes (even one merged twice:
  // the page chose once, the file holds once).
  const drop = new Set<number>();
  let first = -1;
  for (const b of blocksOf(lines, kind)) {
    if (!Array.isArray(b.keys) || !b.keys.length) continue;
    for (let i = b.start + 2; i < b.end; i++) {
      if ((splitCells(lines[i])[0] ?? '').trim().toLowerCase() !== key) continue;
      if (first < 0) first = i;
      else drop.add(i);
    }
  }
  if (first < 0) throw new Error('That record agrees now. Nothing to choose.');
  lines[first] = tableLineOf(kind, { name: kept.name, cells: chosen.cells, note: chosen.note });
  const out = lines.filter((_, i) => !drop.has(i));
  // A merged table left rowless loses its header lines with its rows (the main table always stays).
  const pruned: string[] = [];
  const again = blocksOf(out, kind);
  const mainIdx = again.findIndex((b) => Array.isArray(b.keys));
  const skip = new Set<number>();
  again.forEach((b, bi) => {
    if (!Array.isArray(b.keys) || bi === mainIdx) return;
    let rows = 0;
    for (let i = b.start + 2; i < b.end; i++) if (splitCells(out[i]).some((c) => c)) rows++;
    if (!rows) {
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

export interface TableRowLink { target: string; words: string }
export interface TableRowOut { kind: SystemsTableKind; path: string; name: string; note: string | null; targets: TableRowLink[] }

/** Every row in table texts (path with text), with the [[targets]] its cells name: the one reading every door
 *  uses (link checks, backlinks, the graph). One list per kind, the first by path; each target with the fact
 *  that names it, as the backlinks panel reads it. */
export function rowsInTableTexts(texts: [path: string, text: string][]): TableRowOut[] {
  const seenKind = new Set<SystemsTableKind>();
  const out: TableRowOut[] = [];
  for (const [p, text] of [...texts].sort(([a], [b]) => a.localeCompare(b))) {
    const kind = tableKindOfPath(p);
    if (!kind || seenKind.has(kind)) continue;
    let doc: SystemsTableDoc;
    try {
      if (!isSystemsTableText(text)) continue;
      doc = readSystemsTable(text);
    } catch {
      continue;
    }
    seenKind.add(kind);
    for (const row of doc.rows) {
      const targets: TableRowLink[] = [];
      for (const col of COLUMNS[kind]) {
        if (col.key === 'name' || col.key === 'note') continue;
        const cell = row.cells[col.key] ?? '';
        for (const m of cell.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g)) {
          const t = m[1].trim();
          if (t) targets.push({ target: t, words: `${col.head}: ${cell.trim()}` });
        }
      }
      out.push({ kind, path: rowPathIn(doc.rows, p, row.name), name: row.name, note: row.note, targets });
    }
  }
  return out;
}

// ── Logins in a cell ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface LoginCell { label: string; id: string }
/** Locked links in a Logins cell (`Admin: [locked](secret:…); …`): labels and ids, never values. */
export function loginsOfCell(cell: string): LoginCell[] {
  const out: LoginCell[] = [];
  for (const part of String(cell ?? '').split(';')) {
    const id = /\(secret:([A-Za-z0-9_-]{6,40})\)/.exec(part)?.[1];
    if (!id || out.some((l) => l.id === id)) continue;
    const label = part.split(':')[0].replace(/\[|\]/g, ' ').trim() || 'Login';
    out.push({ label: label.slice(0, 80), id });
  }
  return out;
}
export const loginsCellOf = (logins: LoginCell[]): string => logins.map((l) => `${l.label}: [locked](secret:${l.id})`).join('; ');

// ── Runbook patterns (one set of steps, filled in from the record) ────────────────────────────────────────────────────

export type RunbookPattern = 'update' | 'backups' | 'restore' | 'restart' | 'rest';
export const PATTERN_WORDS: Record<RunbookPattern, string> = { update: 'Update', backups: 'Check backups', restore: 'Restore', restart: 'Restart', rest: 'Restart others' };
const WORD_PATTERN = new Map(Object.entries(PATTERN_WORDS).map(([id, words]) => [words.toLowerCase(), id as RunbookPattern]));

/** A generated runbook's name back to its pattern (`Update Juniper` is the Update pattern). */
export function patternForName(name: string): RunbookPattern | null {
  const t = String(name ?? '').trim();
  if (/^restart the other services on /i.test(t)) return 'rest';
  if (/^update /i.test(t)) return 'update';
  if (/^check backups on /i.test(t)) return 'backups';
  if (/^restore /i.test(t)) return 'restore';
  if (/^restart /i.test(t)) return 'restart';
  return null;
}
export const patternOfCell = (cell: string): RunbookPattern | null => WORD_PATTERN.get(String(cell ?? '').trim().toLowerCase()) ?? null;

/** The shared steps for a pattern, filled in for the record (the one set of steps every copy shared). */
export function fillPatternSteps(pattern: RunbookPattern, vars: { machine: string; service?: string; os?: string; members?: string[] }): string[] {
  const machine = vars.machine?.trim() || 'the machine';
  const os = vars.os?.trim() || '';
  if (pattern === 'update' || pattern === 'backups' || pattern === 'restore') {
    const all = runbooksFromCheck(machine, os || 'its system', []);
    const want = pattern === 'update' ? `Update ${machine}` : pattern === 'backups' ? `Check backups on ${machine}` : `Restore ${machine}`;
    return all.find((r) => r.name === want)?.steps ?? [];
  }
  if (pattern === 'restart') {
    const service = vars.service?.trim() || 'the service';
    return runbooksFromCheck(machine, os, [{ name: service, kind: '' }]).find((r) => r.name.toLowerCase() === `restart ${service}`.toLowerCase())?.steps ?? [];
  }
  const members = (vars.members ?? []).map((m) => m.trim()).filter(Boolean);
  const padding: ProbeService[] = Array.from({ length: 8 }, (_, i) => ({ name: `zz-pad-${i}`, kind: '', port: '' }));
  const all = runbooksFromCheck(machine, os, [...padding, ...members.map((name) => ({ name, kind: '', port: '' }))]);
  return all.find((r) => r.name.toLowerCase() === `restart the other services on ${machine}`.toLowerCase())?.steps ?? [];
}

/** A factory runbook matched back to what the checker wrote (name and every step exactly), or null. */
export function matchGeneratedRunbook(name: string, machine: string, os: string, services: { name: string; kind: string }[]): { pattern: RunbookPattern; steps: string[]; for: string } | null {
  const pattern = patternForName(name);
  if (!pattern || !machine.trim()) return null;
  const all = runbooksFromCheck(machine, os, services);
  const gen = all.find((r) => r.name.toLowerCase() === String(name).trim().toLowerCase());
  return gen ? { pattern, steps: gen.steps, for: gen.for } : null;
}

/** The members a shared restarter covers, read from its own factory first line (`these 3 share this one: A, B`). */
export function restMembersFromSteps(steps: string[]): string[] {
  const first = String(steps[0] ?? '');
  const m = /share this one:\s*(.+?)\.?$/.exec(first);
  if (m) return m[1].split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean).slice(0, 40);
  const out: string[] = [];
  for (const s of steps) {
    const r = /^restart (.+?) \(on the machine:/i.exec(String(s).trim());
    if (r && !out.includes(r[1].trim())) out.push(r[1].trim());
  }
  return out.slice(0, 40);
}

export interface RowFillCtx {
  osByName: Record<string, string>;
  machineByService: Record<string, string>;
  membersByRunbook: Record<string, string[]>;
}

/** What each runbook row's pattern needs: its machine, its service, the machine's system, the rest's members. */
export function docsFillCtx(docs: Record<SystemsTableKind, SystemsTableDoc>): RowFillCtx {
  const osByName: Record<string, string> = {};
  const machineByService: Record<string, string> = {};
  for (const r of docs.machine.rows) if (r.cells.os) osByName[r.name.toLowerCase()] = r.cells.os;
  for (const r of docs.service.rows) if (r.cells.runsOn) machineByService[r.name.toLowerCase()] = r.cells.runsOn.replace(/^\[\[|\]\]$/g, '');
  return { osByName, machineByService, membersByRunbook: {} };
}

const linkTargetOf = (v: string): string => String(v ?? '').replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();

/** A runbook row's steps: its pattern filled in, or none when it has its own (a blank added by hand). */
export function stepsForDocRow(row: SystemsRow, ctx: RowFillCtx): string[] {
  const pattern = patternOfCell(row.cells.pattern ?? '');
  if (!pattern) return [];
  const forNames = String(row.cells.for ?? '').split(/\s*,\s*/).map(linkTargetOf).filter(Boolean);
  const machine = ctx.machineByService[forNames[0]?.toLowerCase() ?? ''] && pattern === 'restart' ? ctx.machineByService[forNames[0].toLowerCase()] : forNames[0] ?? '';
  const service = pattern === 'restart' ? forNames[0] : undefined;
  const members = pattern === 'rest' ? forNames.slice(1) : undefined;
  return fillPatternSteps(pattern, { machine, ...(service ? { service } : {}), os: ctx.osByName[machine.toLowerCase()], ...(members ? { members } : {}) });
}

/** Table texts (as the index holds them) read: a row path rendered as the note it would be, else null. */
export function renderRowFromTableTexts(texts: Partial<Record<SystemsTableKind, string>>, rowPathStr: string): string | null {
  const split = splitRowPath(rowPathStr);
  if (!split) return null;
  const docs = {} as Record<SystemsTableKind, SystemsTableDoc>;
  for (const kind of ['machine', 'service', 'runbook'] as SystemsTableKind[]) {
    const text = texts[kind];
    if (text === undefined) {
      docs[kind] = readSystemsTable(renderSystemsTable(kind, { rows: [] }));
      continue;
    }
    try {
      docs[kind] = readSystemsTable(text);
    } catch {
      return null;
    }
  }
  const row = findRowBySlug(docs[split.kind].rows, split.slug);
  if (!row || row.note) return null;
  const ctx = docsFillCtx(docs);
  const steps = split.kind === 'runbook' ? stepsForDocRow(row, ctx) : [];
  const body = renderRowNote(split.kind, row, docs[split.kind].logs, docs[split.kind].runs, split.kind === 'runbook' ? { steps } : {});
  return `# ${row.name}\n\n${body}`;
}

/** A row rendered as the note it would be: facts as properties, checks as tables, steps filled from its pattern. */
export function renderRowNote(kind: SystemsTableKind, row: SystemsRow, logs: Record<string, HealthLine[]>, runs: Record<string, RunLine[]>, filled: { steps?: string[] } = {}): string {
  const yq = (s: string) => JSON.stringify(s);
  const line = (k: string, v: string) => `${k}:${v ? ` ${/^[\w./:-]+$/.test(v) && !/^\d+$/.test(v) ? v : yq(v)}` : ''}`;
  const c = row.cells;
  const key = row.name.toLowerCase();
  const creds = loginsOfCell(c.logins ?? '');
  const credSection = creds.length ? `## Credentials\n\n${creds.map((l) => `- ${l.label}: [locked](secret:${l.id})`).join('\n')}\n\n` : '';
  const health = logs[key] ?? [];
  const healthSection = kind !== 'runbook' && health.length ? `## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n${health.map((l) => `| ${l.date ?? ''} | ${l.status} | ${l.note} |`).join('\n')}\n\n` : '';
  if (kind === 'machine') return `---\ntype: machine\nkind: ${yq(c.kind || 'Server')}\n${line('role', c.role ?? '')}\n${line('os', c.os ?? '')}\n${line('address', c.address ?? '')}\n${line('location', c.location ?? '')}\n${line('status', c.status ?? '')}\n${line('checked', c.checked ?? '')}\n---\n${credSection}${healthSection}`;
  if (kind === 'service') {
    const deps = String(c.dependsOn ?? '').split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
    return `---\ntype: service\nkind: ${yq(c.kind || 'Web app')}\nruns_on:${c.runsOn ? ` ${yq(c.runsOn)}` : ''}\n${line('url', c.url ?? '')}\n${line('port', c.port ?? '')}\n${line('status', c.status ?? '')}\ndepends_on: [${deps.map((d) => yq(d.startsWith('[[') ? d : `[[${d}]]`)).join(', ')}]\n${line('runbook', c.runbook ?? '')}\n${line('checked', c.checked ?? '')}\n---\n${credSection}${healthSection}`;
  }
  const forList = String(c.for ?? '').split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
  const steps = filled.steps ?? [];
  const runLines = runs[key] ?? [];
  return `---\ntype: runbook\nfor: [${forList.map((d) => yq(d.startsWith('[[') ? d : `[[${d}]]`)).join(', ')}]\nevery: ${yq(c.every || 'On demand')}\nlast_run:${c.lastRun ? ` ${c.lastRun}` : ''}\n---\n## Steps\n\n${steps.length ? steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : '1. '}\n\n## Runs\n\n| Date | Result | Note |\n| --- | --- | --- |\n${runLines.map((l) => `| ${l.date ?? ''} | ${l.result} | ${l.note} |`).join('\n')}${runLines.length ? '\n' : ''}\n## Notes\n\n`;
}

// ── The filler's test (the approved plan) ──────────────────────────────────────────────────────────────────────────────

export interface ClassifyNote { type: string; title: string; props: Record<string, unknown>; content: string; files?: string[] }
export interface ClassifyCtx {
  osByName?: Record<string, string>;
  servicesByMachine?: Record<string, { name: string; kind?: string }[]>;
  machineByService?: Record<string, string>;
}
export interface ClassifyOut { fold: boolean; why: string }

/** Machine-written health lines (a check's summary, a failed check, a fix's result): not the person's words. */
const MACHINE_HEALTH = /^(Checked:|Check now:|Install the updates:|Reboot when done:|Free disk space|Restart .+: )/;
const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

/** A frame's own details (frontmatter a check wrote; the lists carry each of these, and nothing else). */
const FRAME_KEYS: Record<string, Set<string>> = {
  machine: new Set(['type', 'kind', 'role', 'os', 'address', 'location', 'status', 'checked']),
  service: new Set(['type', 'kind', 'runs_on', 'url', 'port', 'status', 'depends_on', 'runbook', 'checked']),
  runbook: new Set(['type', 'for', 'every', 'last_run']),
};
const NOTES_HEADING = /^(notes?|about)$/i;
const LIST_ITEM = /^\s*(?:\d+[.)]|[-*+])\s+/;

/** Whether the details block holds a `#` comment (outside quotes): the person's own words, which the lists
 *  never carry, so the note stays. A `#` inside quotes, or without a space before it, is a value, not a note. */
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
      // Only a check's own ## sections belong to a frame (a person's # or ### heading is their structure).
      if (h[1] !== '##') return null;
      cur = { name: h[2], lines: [] };
      sections.push(cur);
      continue;
    }
    (cur ? cur.lines : preface).push(line);
  }
  return { preface, sections };
}

/** Whether a Systems note is a machine-made frame (folds into the lists) or holds something of the person's (stays).
 *  When unsure it stays: only a note that is clearly all machine work folds. */
export function classifySystemsNote(n: ClassifyNote, ctx: ClassifyCtx = {}): ClassifyOut {
  const type = String(n.type ?? '').toLowerCase();
  if (type !== 'machine' && type !== 'service' && type !== 'runbook') return { fold: false, why: 'not a Systems record' };
  const text = String(n.content ?? '');
  if (text.startsWith('\uFEFF')) return { fold: false, why: 'not written as a record, so it stays' };
  if (!/^\s*---\s*\r?\n/.test(text)) return { fold: false, why: 'not written as a record, so it stays' };
  // Files kept with it are the person's, always; details the lists cannot carry stay with the note.
  if ((n.files ?? []).length) return { fold: false, why: 'has files kept with it' };
  const props = n.props ?? {};
  if (!Object.keys(props).length) return { fold: false, why: 'not written as a record, so it stays' };
  const known = FRAME_KEYS[type];
  if (Object.keys(props).some((k) => !known.has(String(k).toLowerCase()))) return { fold: false, why: 'has extra details' };
  if (hasDetailsComment(text)) return { fold: false, why: 'has a note in its details' };
  // The body must be all frame: nothing before the first section, only a check's own sections, each holding
  // only what a check writes (checks and runs as tables, steps as a list, notes empty).
  const frame = frameSections(text);
  if (!frame) return { fold: false, why: 'not written as a record, so it stays' };
  if (frame.preface.some((l) => l.trim())) return { fold: false, why: 'has words you wrote' };
  for (const s of frame.sections) {
    const isNotes = NOTES_HEADING.test(s.name);
    const isHealth = type !== 'runbook' && HEALTH_LOG.heading.test(s.name);
    const isSteps = type === 'runbook' && STEPS_HEADING.test(s.name);
    const isRuns = type === 'runbook' && RUNS.heading.test(s.name);
    // The app writes this heading into every record; empty, it is frame. A login or a word under it stays a note.
    const isCredentials = type !== 'runbook' && /^credentials$/i.test(s.name.trim());
    if (isCredentials && s.lines.some((l) => l.trim())) return { fold: false, why: 'has a login linked' };
    if (!isNotes && !isHealth && !isSteps && !isRuns && !isCredentials) return { fold: false, why: 'has a section of its own' };
    // Words in the notes area are the person's, always.
    if (isNotes && s.lines.some((l) => l.trim())) return { fold: false, why: 'has words you wrote' };
    if ((isHealth || isRuns) && s.lines.some((l) => l.trim() && !/^\s*\|/.test(l))) return { fold: false, why: type === 'runbook' ? 'has words you wrote' : 'notes what you saw' };
    if (isSteps && s.lines.some((l) => l.trim() && !LIST_ITEM.test(l))) return { fold: false, why: 'has steps you changed' };
  }
  // Nothing hidden: no comment, link, picture, tag or reminder outside what a check writes.
  const body = frame.sections.map((s) => s.lines.join('\n')).join('\n');
  if (body.includes('<!--')) return { fold: false, why: 'has a hidden note' };
  if (body.includes('⏰')) return { fold: false, why: 'has a reminder' };
  if (body.includes('[[') || body.includes('![')) return { fold: false, why: 'links to something else' };
  if (/(?:^|[\s(])#[A-Za-z]/.test(body)) return { fold: false, why: 'has a tag' };
  // A linked login carries the person's label words; a written password needs Secrets first.
  if (credentialsOf(text).length) return { fold: false, why: 'has a login linked' };
  // Health: a line in the person's own words stays; a check's lines fold with the frame.
  const health = readTable(text, HEALTH_LOG).rows;
  for (const h of health) {
    const note = str(h.values.note).trim();
    const status = str(h.values.status).trim();
    if (note && !MACHINE_HEALTH.test(note)) return { fold: false, why: 'notes what you saw' };
    if (!note && status && !/^up$/i.test(status)) return { fold: false, why: 'marks what you saw' };
  }
  if (type === 'runbook') {
    const runs = readTable(text, RUNS).rows.filter((r) => str(r.values.date).trim() || str(r.values.result).trim() || str(r.values.note).trim());
    if (runs.length || str(n.props?.last_run).trim()) return { fold: false, why: 'was run before' };
    const every = str(n.props?.every).trim();
    if (every && !/^on demand$/i.test(every)) return { fold: false, why: `runs ${every.toLowerCase()}` };
    const forNames = (Array.isArray(n.props?.for) ? (n.props.for as unknown[]) : str(n.props?.for).split(',')).map((x) => str(x).replace(/^\[\[|\]\]$/g, '').split('|')[0].trim()).filter(Boolean);
    if (!forNames.length) return { fold: false, why: 'written by hand' };
    const pattern = patternForName(n.title);
    if (!pattern) return { fold: false, why: 'written by hand' };
    const steps = listOf(text, STEPS_HEADING).map((s) => s.text);
    if (!steps.length) return { fold: false, why: 'has no steps from a check' };
    // The factory set for its pattern: an Update, Restart or Restore matches its shared steps whatever else the
    // vault holds (services found one check at a time still match); the shared restarter matches the check that
    // lists the machine's services now, and stays when they have changed since.
    const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((s, i) => s === b[i]);
    if (pattern === 'rest') {
      if (forNames.length !== 1) return { fold: false, why: 'has steps you changed' };
      const machine = forNames[0];
      const services = (ctx.servicesByMachine?.[machine.toLowerCase()] ?? []).map((s) => ({ name: s.name, kind: s.kind ?? '' }));
      const gen = matchGeneratedRunbook(n.title, machine, ctx.osByName?.[machine.toLowerCase()] ?? '', services);
      if (!gen || !same(gen.steps, steps) || gen.for.toLowerCase() !== forNames[0].toLowerCase()) return { fold: false, why: 'has steps you changed' };
      return { fold: true, why: `steps as written for ${forNames[0]}` };
    }
    if (forNames.length !== 1) return { fold: false, why: 'has steps you changed' };
    const machine = pattern === 'restart' ? (ctx.machineByService?.[forNames[0].toLowerCase()] ?? '') : forNames[0];
    if (!machine) return { fold: false, why: 'has steps you changed' };
    const filled = fillPatternSteps(pattern, { machine, service: pattern === 'restart' ? forNames[0] : undefined, os: ctx.osByName?.[machine.toLowerCase()] ?? '' });
    if (!filled.length || !same(filled, steps)) return { fold: false, why: 'has steps you changed' };
    return { fold: true, why: `steps as written for ${forNames[0]}` };
  }
  return { fold: true, why: 'made by a check, nothing added' };
}

// ── App versions (the move waits until every PC has the new one) ──────────────────────────────────────────────────────

/** Compare dotted versions (`9.9.0` above `1.0.0`): negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a ?? '').trim().split('.');
  const pb = String(b ?? '').trim().split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny) && nx !== ny) return nx < ny ? -1 : 1;
    if (Number.isNaN(nx) || Number.isNaN(ny)) {
      if (x !== y) return x < y ? -1 : 1;
    }
  }
  return 0;
}
