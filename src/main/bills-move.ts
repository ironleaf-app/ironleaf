// The one-time move to bills as one list (8 Nov 2026; records as data). A full backup first, then a preview in
// plain words of what stays a note and what folds, one button, and one Undo that puts every file back byte for byte.
// Folded notes go to the Bin (never deleted for good); it never runs by itself; it is offered once, calmly, on the
// Money page; and it resumes where it stopped if the app dies part way. It waits until every PC that opens the
// vault has the new version (a vault only ever opened on one PC may go ahead).

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { createVaultBin } from './bin';
import { writeZip } from './zip';
import { readProps } from '../shared/frontmatter';
import { withFields } from '../shared/inline-fields';
import { financeModel, priceHistory, readMoney, type FinanceNote } from '../shared/finance';
import { typeFolder } from '../shared/module-records';
import { moduleTypeLevel } from '../shared/module-records';
import { SENSITIVITY_FILE, emptyStore, levelOf, type SensitivityStore } from '../shared/sensitivity';
import { billNameKey, classifyBillNote, MACHINE_PAID } from '../shared/bills-table';
import { compareVersions as compareSystemsVersions } from '../shared/system-tables';
import { dropBillsRows, readBills, billsTableRelFor, writeBills, type BillsWork } from './bills-tables';

export const BILLS_MOVE_FILE = '.neuralvault/bills-move.json';
/** Why folded notes carry in the Bin (resume and Undo find them by it). */
export const BILLS_MOVE_WHY = 'folded into the Bills list';
const MOVE_BY = 'Bills tidy-up';
/** Another PC counts as in play when it opened the vault within this long (older files are named, not blocking). */
const PC_FRESH_DAYS = 30;

const sha = (t: string): string => createHash('sha256').update(t).digest('hex');

export interface BillsMoveCandidate { rel: string; name: string; why: string }
export interface BillsPcsBlock { names: string[]; words: string }
export interface BillsMovePlan {
  fold: BillsMoveCandidate[];
  stay: BillsMoveCandidate[];
  clash: string | null;
  pcsBlock: BillsPcsBlock | null;
  /** PCs that have not opened the vault in over a month (named, not blocking). */
  stalePcs: string[];
  /** Notes on the disk the index could not read (online-only files among them): left alone, and named. */
  unreadable: { rel: string; name: string }[];
  table: string;
}

export interface BillsMoveReceipt {
  version: 1;
  startedAt: string;
  phase: 'backup' | 'tables' | 'moves' | 'done';
  backup: { zip: string; files: number; bytes: number } | null;
  planned: BillsMoveCandidate[];
  /** Rows already in the list before the move (never touched by Undo). */
  preRows: string[];
  /** Planned notes skipped while moving (changed since the backup, or gone): left as notes, rows taken out. */
  skipped?: BillsMoveCandidate[];
  /** Rows the move wrote, as written (Undo keeps ones the person changed since, with their changes). */
  rowSig?: Record<string, string>;
  moved: { rel: string; binId: string; sha: string }[];
  doneAt?: string;
}

// ── The plan ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const andWords = (names: string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The vault's privacy file, for the level each note folds at (a missing or broken file is no markings). */
async function sensitivityStore(root: string): Promise<SensitivityStore> {
  const clean = emptyStore();
  try {
    const v = JSON.parse(await fsp.readFile(path.join(root, ...SENSITIVITY_FILE.split('/')), 'utf8')) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return clean;
    for (const k of ['folders', 'types', 'items'] as const) if (v[k] && typeof v[k] === 'object' && !Array.isArray(v[k])) (clean as unknown as Record<string, unknown>)[k] = v[k];
  } catch {
    // No markings: everything folds at the Money level.
  }
  return clean;
}

/** Notes on the disk the index could not read (an online-only file whose read failed leaves no trace in the
 *  index): found by walking what the folder holds, so the move can leave them alone and say so. */
async function unreadableBillNotes(w: BillsWork, bills: FinanceNote[]): Promise<{ rel: string; name: string }[]> {
  const out = new Map<string, string>();
  let folder = '';
  try {
    folder = typeFolder('bill', await w.areas());
  } catch {
    return [];
  }
  if (!folder) return [];
  const seen = new Set(bills.map((b) => b.path));
  const walk = async (dir: string, base: string): Promise<void> => {
    let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[] = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || out.size >= 40) continue;
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(path.join(dir, e.name), rel);
        continue;
      }
      if (!/\.md$/i.test(e.name)) continue;
      if (!seen.has(rel) && w.index.get(rel) === undefined && !w.index.isExcluded(rel)) out.set(rel, e.name.replace(/\.md$/i, ''));
    }
  };
  await walk(path.join(w.root, ...folder.split('/')), folder);
  return [...out].map(([rel, name]) => ({ rel, name })).sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Every bill note read as fold or stay, with the plain reason each way. */
export async function planBillsMove(w: BillsWork, bills: FinanceNote[]): Promise<BillsMovePlan> {
  // One row per name in the list: two notes sharing one, or a row already there, stay notes.
  const counts = new Map<string, number>();
  for (const n of bills) {
    const k = billNameKey(n.title);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let existing = new Set<string>();
  try {
    existing = new Set((await readBills(w)).doc.rows.map((r) => billNameKey(r.name)));
  } catch {
    existing = new Set();
  }
  // Rows read at the Money level: a note marked otherwise stays, so no agent gains a word.
  const store = await sensitivityStore(w.root);
  const billsLevel = moduleTypeLevel('bill') ?? 'personal';
  const fold: BillsMoveCandidate[] = [];
  const stay: BillsMoveCandidate[] = [];
  for (const n of bills) {
    const at = { rel: n.path, name: n.title };
    if ((counts.get(billNameKey(n.title)) ?? 0) > 1) {
      stay.push({ ...at, why: 'another note shares its name' });
      continue;
    }
    const files = await w.filesOf(n.path).catch(() => [] as string[]);
    const c = classifyBillNote({ type: 'bill', title: n.title, props: n.props, content: n.content, files });
    if (!c.fold) {
      stay.push({ ...at, why: c.why });
      continue;
    }
    if (existing.has(billNameKey(n.title))) {
      stay.push({ ...at, why: 'already in the list' });
      continue;
    }
    let level = billsLevel;
    try {
      level = levelOf(store, n.path, n.props.sensitivity, 'bill').level;
    } catch {
      level = 'family';
    }
    if (level !== billsLevel) {
      stay.push({ ...at, why: 'has its own privacy marking' });
      continue;
    }
    fold.push({ ...at, why: c.why });
  }
  fold.sort((a, b) => a.name.localeCompare(b.name));
  stay.sort((a, b) => a.name.localeCompare(b.name));
  const table = await billsTableRelFor(w).catch(() => '');
  let clash: string | null = null;
  try {
    await readBills(w);
  } catch (e) {
    clash = e instanceof Error ? e.message : String(e);
  }
  return { fold, stay, clash, pcsBlock: await billsPcsBlock(w), stalePcs: await billsStalePcs(w), unreadable: await unreadableBillNotes(w, bills), table };
}

const unreadableWords = (list: { rel: string; name: string }[]): string => {
  const names = andWords(list.slice(0, 4).map((u) => `“${u.name}”`));
  const more = list.length > 4 ? ` and ${list.length - 4} more` : '';
  return list.length === 1 ? `${names} couldn't be read (OneDrive may still be fetching it), so it stays a note, untouched.` : `${list.length} notes couldn't be read (OneDrive may still be fetching them): ${names}${more}. They stay as notes, untouched.`;
};

const staleWords = (names: string[]): string => `${andWords(names)} ${names.length < 2 ? "hasn't" : "haven't"} opened the vault in over a month, so the tidy-up goes ahead without ${names.length < 2 ? 'it' : 'them'}.`;

/** The preview in plain words: what stays a note and why, what folds and why, the backup and the Bin. */
export function billsPreviewWords(plan: BillsMovePlan): string[] {
  const lines = [
    `This tidies ${plan.fold.length === 1 ? '1 note' : `${plan.fold.length} notes`} your assistant made into one Bills list you can read.`,
    `${plan.stay.length === 1 ? '1 note holds' : `${plan.stay.length} notes hold`} words you wrote, so ${plan.stay.length === 1 ? 'it stays' : 'they stay'} as notes, untouched.`,
    'Before anything changes, a backup of the whole vault is saved as a zip on this PC.',
    'Folded notes go to the Bin, and one Undo puts every file back word for word.',
  ];
  if (plan.stalePcs.length) lines.push(staleWords(plan.stalePcs));
  if (plan.unreadable.length) lines.push(unreadableWords(plan.unreadable));
  if (plan.pcsBlock) lines.push(plan.pcsBlock.words);
  if (plan.clash) lines.push(plan.clash);
  return lines;
}

// ── Both PCs on the new version ────────────────────────────────────────────────────────────────────────────────────────

interface PcFile { id: string; name: string; at: number; version: string }
async function pcsOf(root: string, selfId: string): Promise<{ ok: PcFile[]; broken: { id: string; fresh: boolean }[] }> {
  const dir = path.join(root, '.neuralvault', 'pcs');
  const ok: PcFile[] = [];
  const broken: { id: string; fresh: boolean }[] = [];
  for (const n of await fsp.readdir(dir).catch(() => [] as string[])) {
    if (!/^[0-9a-f-]{36}\.json$/i.test(n)) continue;
    if (n.toLowerCase() === `${selfId.toLowerCase()}.json`) continue;
    const abs = path.join(dir, n);
    let v: { name?: unknown; at?: unknown; version?: unknown } | null = null;
    try {
      v = JSON.parse(await fsp.readFile(abs, 'utf8')) as { name?: unknown; at?: unknown; version?: unknown };
    } catch {
      // Half arrived, or broken: judged below by its age.
    }
    const name = v && typeof v.name === 'string' ? v.name.trim().slice(0, 60) : '';
    const at = v && typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : v && typeof v.at === 'string' ? Date.parse(v.at) : NaN;
    if (v && name && Number.isFinite(at)) {
      ok.push({ id: n, name, at, version: typeof v.version === 'string' ? v.version : '' });
      continue;
    }
    // Unreadable: fresh ones block (unsure means wait); stale ones rest with the other stale PCs.
    let fresh = true;
    try {
      fresh = Date.now() - (await fsp.stat(abs)).mtimeMs < PC_FRESH_DAYS * 86400000;
    } catch {
      fresh = true;
    }
    broken.push({ id: n, fresh });
  }
  return { ok, broken };
}

/** The gate: null when the move may go ahead, else the PCs to update named in plain words. */
export async function billsPcsBlock(w: BillsWork): Promise<BillsPcsBlock | null> {
  const root = w.root;
  const selfId = w.device?.id ?? '';
  const selfVersion = w.appVersion ?? '';
  const { ok: others, broken } = await pcsOf(root, selfId);
  if (!selfVersion) {
    // Without our own version to compare, only the single-PC shape may go ahead.
    const total = (await fsp.readdir(path.join(root, '.neuralvault', 'pcs')).catch(() => [] as string[])).filter((n) => /^[0-9a-f-]{36}\.json$/i.test(n));
    if (total.length <= 1) return null;
    return { names: others.map((o) => o.name), words: 'Another PC opens this vault, so the tidy-up waits until every PC has the new Ironleaf. Update each PC, open the vault there once, then come back.' };
  }
  const fresh = others.filter((o) => Date.now() - o.at < PC_FRESH_DAYS * 86400000);
  const behind = fresh.filter((o) => !o.version || compareSystemsVersions(o.version, selfVersion) < 0);
  if (behind.length) {
    const names = [...new Set(behind.map((o) => o.name))];
    const who = andWords(names);
    return { names, words: `${who} still ${names.length < 2 ? 'has' : 'have'} the older Ironleaf, so the tidy-up waits. Update Ironleaf on ${who}, open the vault there once, then come back.` };
  }
  if (broken.some((b) => b.fresh)) return { names: [], words: `A file from another PC couldn't be read, so the tidy-up waits. Open the vault on each PC once, then come back.` };
  return null;
}

/** PCs that opened the vault over a month ago: named in the preview, never blocking. */
export async function billsStalePcs(w: BillsWork): Promise<string[]> {
  const { ok } = await pcsOf(w.root, w.device?.id ?? '');
  return [...new Set(ok.filter((o) => Date.now() - o.at >= PC_FRESH_DAYS * 86400000).map((o) => o.name))].sort((a, b) => a.localeCompare(b));
}

// ── The receipt (resume and Undo) ──────────────────────────────────────────────────────────────────────────────────────

const receiptPath = (w: BillsWork): string => path.join(w.root, ...BILLS_MOVE_FILE.split('/'));
async function readReceipt(w: BillsWork): Promise<BillsMoveReceipt | null> {
  try {
    const v = JSON.parse(await fsp.readFile(receiptPath(w), 'utf8')) as BillsMoveReceipt;
    return v && v.version === 1 && Array.isArray(v.planned) && Array.isArray(v.moved) ? v : null;
  } catch {
    return null;
  }
}
async function writeReceipt(w: BillsWork, r: BillsMoveReceipt): Promise<void> {
  try {
    const file = receiptPath(w);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.nvtmp`;
    await fsp.writeFile(temp, JSON.stringify(r, null, 1), 'utf8');
    await fsp.rename(temp, file);
  } catch (e) {
    if ((e as { code?: unknown })?.code === 'RECEIPT_WRITE') throw e;
    throw Object.assign(new Error(`Couldn't keep track of the tidy-up (${plainFsError(e)}). Carry on to finish.`), { code: 'RECEIPT_WRITE' });
  }
}
async function clearReceipt(w: BillsWork): Promise<void> {
  await fsp.rm(receiptPath(w), { force: true });
}

// ── The backup ─────────────────────────────────────────────────────────────────────────────────────────────────────────

async function vaultFiles(root: string): Promise<string[]> {
  // Every file in the vault (the Bin and sync files with it; Git's own folder aside).
  const out: string[] = [];
  const walk = async (dir: string, base: string): Promise<void> => {
    for (const e of await fsp.readdir(path.join(dir), { withFileTypes: true }).catch(() => [])) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === '.git') continue;
        await walk(path.join(dir, e.name), rel);
      } else if (e.isFile()) out.push(rel);
    }
  };
  await walk(root, '');
  return out.sort();
}

/** The full backup first: the vault as a zip on this PC (outside the notes, beside the app's own data). */
export async function backupVaultForBills(w: BillsWork): Promise<{ zip: string; files: number; bytes: number }> {
  const root = w.root;
  const dataDir = w.dataDir ?? path.join(root, '.neuralvault', 'tmp');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const vaultName = path.basename(root).replace(/[^\w .-]+/g, '').trim() || 'vault';
  // Its own name even twice in a minute (two backups sharing a name would write one zip over the other).
  let dest = path.join(dataDir, 'backups', `${vaultName}-before-bills-list-${stamp}.zip`);
  for (let n = 2; await fsp.stat(dest).then(() => true, () => false); n++) {
    dest = path.join(dataDir, 'backups', `${vaultName}-before-bills-list-${stamp}-${n}.zip`);
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const files = await vaultFiles(root);
  const { bytes } = await writeZip(dest, files.map((rel) => ({ name: rel, abs: path.join(root, ...rel.split('/')) })));
  return { zip: dest, files: files.length, bytes };
}

// ── Running ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const linkOf = (name: string): string => (name ? `[[${name}]]` : '');

interface BillsMoveEntry { name: string; kind: string; amount: number | null; cycle: string; anchor: string | null; category: string; account: string | null; project: string | null; autopay: boolean; status: string; paid: string | null }

/** An amount's cell: the note's own words when they read as the moved amount (`USD 89` stays `USD 89`,
 *  never folded to bare figures), else the figures. */
function amountCellOf(amount: number | null, orig: unknown): string {
  if (amount === null) return '';
  const s = typeof orig === 'string' ? orig.trim().slice(0, 80) : '';
  if (s && readMoney(s) === amount) return s;
  return amount.toFixed(2);
}

function entryToRow(b: BillsMoveEntry, content: string, orig?: { amount?: unknown }): { cells: Record<string, string>; prices: [string, number, string][]; payments: string[] } {
  const history = priceHistory(content);
  const paid: string[] = [];
  for (const line of content.split(/\r?\n/)) if (MACHINE_PAID.test(line.trim())) paid.push(line.trim());
  return {
    cells: {
      kind: b.kind, amount: amountCellOf(b.amount, orig?.amount), cycle: b.cycle, due: b.anchor ?? '', category: b.category,
      account: linkOf(b.account ?? ''), project: linkOf(b.project ?? ''), autopay: b.autopay ? 'Yes' : 'No', status: b.status, paid: b.paid ?? '',
    },
    prices: history.map((h) => [h.date, h.amount, h.note]),
    payments: paid,
  };
}

/** A file failure in plain words (never an error code). */
const plainFsError = (e: unknown): string => {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC') return 'the disk is full';
  if (code === 'EACCES' || code === 'EPERM') return 'it is locked by something else';
  if (code === 'EBUSY') return 'it is busy somewhere else';
  if (code === 'EROFS') return 'the disk is read-only';
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'it could not be found';
  return 'it could not be moved';
};

/** A move running in this window: a second trigger while one runs is refused in plain words, never run
 *  twice (the app runs once per PC, so one flag covers every door). */
let moveRunning = false;

async function guardMove<T>(fn: () => Promise<T>): Promise<T> {
  if (moveRunning) throw new Error('A tidy-up is already running. Wait for it to finish.');
  moveRunning = true;
  try {
    return await fn();
  } finally {
    moveRunning = false;
  }
}

/** One PC holds the run: the lock file in the vault while a move or Undo runs (two windows share the flag
 *  above; two PCs share only the folder, as the Systems tidy-up does). A lock older than this is a dead
 *  app's, and is taken over. */
export const BILLS_MOVE_LOCK = '.neuralvault/bills-move.lock';
const LOCK_FRESH_MS = 5 * 60 * 1000;

interface BillsMoveLock { pc: string; name: string; at: number }

const lockPath = (w: BillsWork): string => path.join(w.root, ...BILLS_MOVE_LOCK.split('/'));

/** This PC holds the run now, or the name of the PC that does. The first writer wins (an atomic create);
 *  a stale or unreadable lock is taken over, never blocking for good. A lock that cannot be written stops
 *  the run in plain words before anything changes. */
export async function acquireMoveLock(w: BillsWork): Promise<string | null> {
  const file = lockPath(w);
  const self = w.device?.id ?? '';
  const selfName = w.device?.name?.trim() || 'This PC';
  const words = JSON.stringify({ pc: self, name: selfName, at: Date.now() });
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });
  } catch (e) {
    throw new Error(`Couldn't start the tidy-up (${plainFsError(e)}). Nothing changed.`);
  }
  try {
    await fsp.writeFile(file, words, { flag: 'wx' });
    return null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'EEXIST') throw new Error(`Couldn't start the tidy-up (${plainFsError(e)}). Nothing changed.`);
  }
  let cur: BillsMoveLock | null = null;
  try {
    const v = JSON.parse(await fsp.readFile(file, 'utf8')) as Partial<BillsMoveLock>;
    if (v && typeof v.pc === 'string' && typeof v.at === 'number') cur = { pc: v.pc, name: typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 60) : 'Another PC', at: v.at };
  } catch {
    cur = null;
  }
  if (cur && cur.pc !== self && Date.now() - cur.at < LOCK_FRESH_MS) return cur.name;
  try {
    const temp = `${file}.${process.pid}.nvtmp`;
    await fsp.writeFile(temp, words);
    await fsp.rename(temp, file);
  } catch (e) {
    throw new Error(`Couldn't start the tidy-up (${plainFsError(e)}). Nothing changed.`);
  }
  return null;
}

/** The run is still alive: a long move touches its lock as it goes, so a second PC never takes over mid-run.
 *  Best effort, and never creates a lock (phases run without one hold nothing). */
async function touchMoveLock(w: BillsWork): Promise<void> {
  try {
    const file = lockPath(w);
    const v = JSON.parse(await fsp.readFile(file, 'utf8')) as Partial<BillsMoveLock>;
    if (!v || v.pc !== (w.device?.id ?? '')) return;
    const temp = `${file}.${process.pid}.nvtmp`;
    await fsp.writeFile(temp, JSON.stringify({ pc: v.pc, name: v.name ?? 'This PC', at: Date.now() }));
    await fsp.rename(temp, file);
  } catch {
    // The lock stands as it was: a missed touch only matters after five quiet minutes.
  }
}

/** The run is over: this PC's lock goes, so the next run starts clean. Best effort. */
export async function releaseMoveLock(w: BillsWork): Promise<void> {
  try {
    const file = lockPath(w);
    const text = await fsp.readFile(file, 'utf8').catch((): null => null);
    if (!text) return;
    const v = JSON.parse(text) as Partial<BillsMoveLock> | null;
    if (v && v.pc === (w.device?.id ?? '')) await fsp.rm(file, { force: true });
  } catch {
    // A leftover lock goes stale and is taken over; never blocking for good.
  }
}

/** One PC runs at a time: the lock held for the whole run, in-process guard outside it. */
async function guardMoveLocked<T>(w: BillsWork, fn: () => Promise<T>): Promise<T> {
  return guardMove(async () => {
    const holder = await acquireMoveLock(w);
    if (holder) throw new Error(`${holder} is tidying the Bills list right now. Wait a moment, then carry on.`);
    try {
      return await fn();
    } finally {
      await releaseMoveLock(w);
    }
  });
}

/** The notes folder still there (renamed or moved mid-move reads as plain words, never a mystery). */
async function requireRoot(w: BillsWork): Promise<void> {
  const there = await fsp.stat(w.root).then(() => true, () => false);
  if (!there) throw new Error('Your notes folder is no longer there. Put it back, then carry on.');
}

/** A folding note's row brought up to the bytes being moved: the note changed since the list was
 *  written (typed into, or an agent's doing) and still folds. Compared by fingerprint, so an unchanged row
 *  costs no list read; a row the person changed since keeps theirs instead (its fingerprint no longer
 *  matches what the move wrote); a missing row is written back. */
async function refreshRowForMove(w: BillsWork, receipt: BillsMoveReceipt, f: { rel: string; name: string }, content: string | undefined): Promise<void> {
  if (content === undefined) return;
  const props = withFields(readProps(content), content);
  const m = financeModel([{ path: f.rel, title: f.name, props, content, type: 'bill' }], new Date());
  const entry = m.bills[0];
  if (!entry) return;
  const { cells, prices: ps, payments } = entryToRow(entry, content, { amount: props.amount });
  const sigPrices = ps.map(([date, amount, note]) => ({ date: date || null, amount, note }));
  const key = billNameKey(f.name);
  if (sha(JSON.stringify({ cells, prices: sigPrices, payments })) === receipt.rowSig?.[key]) return;
  const read = await readBills(w).catch(() => null);
  if (!read) return;
  const row = read.doc.rows.find((r) => billNameKey(r.name) === key);
  const was = receipt.rowSig?.[key];
  if (row && (was === undefined || sha(JSON.stringify({ cells: row.cells, prices: read.doc.prices[key] ?? [], payments: read.doc.payments[key] ?? [] })) !== was)) return;
  const rows = row ? read.doc.rows.map((r) => (billNameKey(r.name) === key ? { name: r.name, cells, note: null } : r)) : [...read.doc.rows, { name: f.name, cells, note: null }];
  const prices = { ...read.doc.prices };
  const pays = { ...read.doc.payments };
  if (ps.length) prices[key] = sigPrices;
  else delete prices[key];
  if (payments.length) pays[key] = payments;
  else delete pays[key];
  await writeBills(w, { ...read.doc, rows, prices, payments: pays });
  (receipt.rowSig ??= {})[key] = sha(JSON.stringify({ cells, prices: sigPrices, payments }));
  await writeReceipt(w, receipt);
}

/** One phase of the move, so a crash between phases resumes cleanly (tests drive these one at a time). */
export async function runBillsMovePhase(w: BillsWork, phase: 'backup' | 'tables' | 'moves' | 'finish', opts: { limit?: number; bin?: Pick<ReturnType<typeof createVaultBin>, 'put' | 'list'> } = {}): Promise<string> {
  await requireRoot(w);
  const bills = await w.billNotes();
  const plan = await planBillsMove(w, bills);
  if (plan.pcsBlock) throw new Error(plan.pcsBlock.words);
  if (plan.clash) throw new Error(plan.clash);
  let receipt = await readReceipt(w);
  if (phase === 'backup') {
    if (receipt?.backup) return 'The backup is already there.';
    let backup: { zip: string; files: number; bytes: number };
    try {
      backup = await backupVaultForBills(w);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      const why = code === 'ENOSPC' ? 'the disk is full' : code === 'EACCES' || code === 'EPERM' ? 'its folder is locked' : 'it could not be written';
      throw new Error(`Couldn't back up the vault (${why}). Nothing changed.`);
    }
    // Rows already in the list before anything is written (Undo never touches these, even across a crash).
    let preRows: string[] = [];
    const read = await readBills(w).catch(() => null);
    if (read) preRows = read.doc.rows.map((r) => r.name);
    receipt = { version: 1, startedAt: new Date().toISOString(), phase: 'backup', backup, planned: plan.fold, preRows, moved: receipt?.moved ?? [] };
    await writeReceipt(w, receipt);
    return `Backed up ${backup.files} files to ${backup.zip}.`;
  }
  if (!receipt?.backup) throw new Error('Take the backup first.');
  if (phase === 'tables') {
    // Rows for every planned note (the backup's plan, frozen: names already there are left alone, so
    // resuming never doubles). The list freshly read just before it is written, so a bill added while
    // the move runs (by the person, an agent, another PC's sync) is merged in, never written over.
    try {
      const notes = await w.billNotes();
      const model = financeModel(notes, new Date());
      const byPath = new Map<string, unknown>();
      for (const b of model.bills) byPath.set(b.path, b);
      const byContent = new Map<string, string>();
      for (const n of notes) byContent.set(n.path, n.content);
      const byProps = new Map<string, Record<string, unknown>>();
      for (const n of notes) byProps.set(n.path, n.props);
      const rowSig = receipt.rowSig ?? {};
      const read = await readBills(w);
      const rows = [...read.doc.rows];
      const prices = { ...read.doc.prices };
      const payments = { ...read.doc.payments };
      for (const f of receipt.planned) {
        const entry = byPath.get(f.rel) as BillsMoveEntry | undefined;
        const content = byContent.get(f.rel);
        if (!entry || content === undefined) continue;
        const { cells, prices: ps, payments: pay } = entryToRow(entry, content, { amount: byProps.get(f.rel)?.amount });
        const sigPrices = ps.map(([date, amount, note]) => ({ date: date || null, amount, note }));
        // The fingerprint stands once set (a retry never moves it: what the move wrote is what Undo
        // compares). A row already there without one (added by hand under the same name mid-move) is
        // fingerprinted as the move would write it, so Undo keeps the person's version, never drops it.
        rowSig[billNameKey(f.name)] ??= sha(JSON.stringify({ cells, prices: sigPrices, payments: pay }));
        if (rows.some((r) => billNameKey(r.name) === billNameKey(f.name))) continue;
        rows.push({ name: f.name, cells, note: null });
        if (ps.length) prices[billNameKey(f.name)] = sigPrices;
        if (pay.length) payments[billNameKey(f.name)] = pay;
      }
      try {
        await writeBills(w, { ...read.doc, rows, prices, payments: payments });
        // Kept after the write (a full disk or a dead app right after still leaves every written row
        // fingerprinted, so a retry never doubles and Undo still knows a row the person changed since).
        receipt.rowSig = { ...rowSig };
        await writeReceipt(w, receipt);
      } catch (e) {
        if ((e as { code?: unknown })?.code === 'RECEIPT_WRITE') throw e;
        throw Object.assign(new Error(`Couldn't write the list (${plainFsError(e)}). Carry on to finish.`), { code: 'TABLES_WRITE' });
      }
      receipt.rowSig = rowSig;
    } catch (e) {
      // A clashing list, or a failed write, is already in plain words; reading troubles are said as reading
      // troubles, never as write troubles.
      const code = (e as { code?: unknown })?.code;
      if (code === 'TABLES_CLASH' || code === 'TABLES_WRITE' || code === 'RECEIPT_WRITE') throw e;
      throw new Error(`Couldn't read the list (${plainFsError(e)}). Carry on to try again.`);
    }
    try {
      receipt.phase = 'tables';
      await writeReceipt(w, receipt);
    } catch (e) {
      if ((e as { code?: unknown })?.code === 'RECEIPT_WRITE') throw e;
      throw new Error(`Couldn't write the list (${plainFsError(e)}). Carry on to finish.`);
    }
    return 'The list is written.';
  }
  if (phase === 'moves') {
    // Each planned note to the Bin, the receipt after each one (a crash resumes from the receipt). Read
    // from the disk, not the index, and read again as fold or stay: a note that gained words since the
    // backup stays a note, and the fingerprint is of the bytes that moved.
    const root = w.root;
    const bin = opts.bin ?? createVaultBin({ root });
    const limit = opts.limit ?? Number.MAX_SAFE_INTEGER;
    const skipped = receipt.skipped ?? [];
    let n = 0;
    for (const f of receipt.planned) {
      if (n >= limit) break;
      if (receipt.moved.some((m) => m.rel === f.rel)) continue;
      if (skipped.some((s) => s.rel === f.rel)) continue;
      const disk = await fsp.readFile(path.join(root, ...f.rel.split('/')), 'utf8').catch(() => null);
      if (disk === null) {
        // Gone from the disk: crashed between the Bin and the receipt, or the person moved it. The
        // Bin's copy (tagged with this move) stands for it; otherwise its row goes at the finish.
        const items = await bin.list();
        const mine = items.find((it) => it.path === f.rel && it.why === BILLS_MOVE_WHY);
        if (mine?.sha) {
          w.index.delete?.(f.rel);
          receipt.moved.push({ rel: f.rel, binId: mine.id, sha: mine.sha });
          await writeReceipt(w, receipt);
        } else {
          skipped.push({ rel: f.rel, name: f.name, why: 'went missing while tidying' });
          receipt.skipped = skipped;
          await writeReceipt(w, receipt);
        }
        continue;
      }
      const props = withFields(readProps(disk), disk);
      const files = await w.filesOf(f.rel).catch(() => [] as string[]);
      const c = classifyBillNote({ type: 'bill', title: f.name, props, content: disk, files });
      if (!c.fold) {
        skipped.push({ rel: f.rel, name: f.name, why: c.why });
        receipt.skipped = skipped;
        await writeReceipt(w, receipt);
        continue;
      }
      // The note changed since the list was written and still folds: its row is brought up to the bytes
      // being moved (a row the person changed since keeps theirs instead).
      try {
        await refreshRowForMove(w, receipt, f, disk);
      } catch (e) {
        const code = (e as { code?: unknown })?.code;
        if (code === 'TABLES_CLASH' || code === 'RECEIPT_WRITE') throw e;
        throw new Error(`Couldn't write the list (${plainFsError(e)}). Carry on to finish.`);
      }
      const digest = sha(disk);
      let item: { id: string };
      try {
        item = await bin.put(f.rel, { by: MOVE_BY, why: BILLS_MOVE_WHY });
      } catch (e) {
        const movedBits = receipt.moved.length ? ` ${receipt.moved.length === 1 ? '1 note is' : `${receipt.moved.length} notes are`} already in the Bin; fix it and carry on, or Undo puts them back.` : ' Nothing moved yet; fix it and carry on.';
        throw new Error(`Couldn't move “${f.name}” to the Bin (${plainFsError(e)}).${movedBits}`);
      }
      w.index.delete?.(f.rel);
      receipt.moved.push({ rel: f.rel, binId: item.id, sha: digest });
      await writeReceipt(w, receipt);
      await touchMoveLock(w);
      n++;
    }
    receipt.skipped = skipped;
    receipt.phase = 'moves';
    await writeReceipt(w, receipt);
    return 'The notes are in the Bin.';
  }
  // finish
  const skipped = receipt.skipped ?? [];
  if (skipped.length) await dropBillsRows(w, skipped.map((s) => s.name)).catch(() => 0);
  receipt.phase = 'done';
  receipt.doneAt = new Date().toISOString();
  await writeReceipt(w, receipt);
  await w.setFinanceSettings({ billsMove: 'done' });
  return skipped.length ? `The tidy-up is done. ${skipped.length === 1 ? '1 note changed while tidying and stayed a note' : `${skipped.length} notes changed while tidying and stayed notes`}.` : 'The tidy-up is done.';
}

const skippedWords = (n: number): string => (n === 1 ? '1 note changed while tidying and stayed a note.' : `${n} notes changed while tidying and stayed notes.`);

/** The whole move, one phase after another: backup, list, Bin, done. Never runs by itself. */
export async function runBillsMove(w: BillsWork): Promise<string> {
  return guardMoveLocked(w, async () => {
    const plan = await planBillsMove(w, await w.billNotes());
    if (!plan.fold.length) {
      const nothing = 'Nothing to tidy: every bill note holds words you wrote.';
      return plan.unreadable.length ? `${nothing} ${unreadableWords(plan.unreadable)}` : nothing;
    }
    await runBillsMovePhase(w, 'backup');
    await runBillsMovePhase(w, 'tables');
    await runBillsMovePhase(w, 'moves');
    await runBillsMovePhase(w, 'finish');
    const receipt = (await readReceipt(w))!;
    const n = receipt.moved.length;
    let out = `Folded ${n === 1 ? '1 note' : `${n} notes`} into the Bills list. The backup is at ${receipt.backup!.zip}, and Undo puts every file back.`;
    if (plan.unreadable.length) out += ` ${unreadableWords(plan.unreadable)}`;
    if ((receipt.skipped ?? []).length) out += ` ${skippedWords(receipt.skipped!.length)}`;
    return out;
  });
}

/** Carry on after the app died part way (every finished step is skipped, nothing doubles). */
export async function resumeBillsMove(w: BillsWork): Promise<string> {
  return guardMoveLocked(w, async () => {
    const receipt = await readReceipt(w);
    if (!receipt || receipt.phase === 'done') return 'Nothing to carry on with.';
    if (!receipt.backup) await runBillsMovePhase(w, 'backup');
    const afterBackup = (await readReceipt(w))!;
    if (afterBackup.phase === 'backup') await runBillsMovePhase(w, 'tables');
    await runBillsMovePhase(w, 'moves');
    await runBillsMovePhase(w, 'finish');
    const after = (await readReceipt(w))!;
    let out = `Finished the tidy-up: ${after.moved.length} notes folded into the Bills list. Undo still puts every file back.`;
    if ((after.skipped ?? []).length) out += ` ${skippedWords(after.skipped!.length)}`;
    return out;
  });
}

/** One Undo: every folded note back where it was, byte for byte, and the move's rows taken out. Rows
 *  the person changed since (typed into, or fixed in the list) stay with their changes, and their folded
 *  copies stay in the Bin; a note already back word for word counts as back, so a retry names only
 *  what is still missing. */
export async function undoBillsMove(w: BillsWork): Promise<string> {
  return guardMoveLocked(w, async () => {
    await requireRoot(w);
    const receipt = await readReceipt(w);
    if (!receipt || (receipt.phase !== 'done' && receipt.phase !== 'moves' && receipt.moved.length === 0)) return 'Nothing to put back.';
    const root = w.root;
    const bin = createVaultBin({ root });
    const items = await bin.list();
    const planned = new Set(receipt.planned.map((p) => billNameKey(p.name)));
    const before = new Set((receipt.preRows ?? []).map((n) => billNameKey(n)));
    // Rows the person changed since the move stay with their changes (a row pointing at a note of its own
    // among them: typing made it a note, and the note is the record now).
    const keepRows = new Set<string>();
    const read = await readBills(w).catch(() => null);
    if (read) {
      for (const row of read.doc.rows) {
        const key = billNameKey(row.name);
        if (!planned.has(key) || before.has(key)) continue;
        const now = sha(JSON.stringify({ cells: row.cells, prices: read.doc.prices[key] ?? [], payments: read.doc.payments[key] ?? [] }));
        const was = receipt.rowSig?.[key];
        if (row.note || (was !== undefined && was !== now)) keepRows.add(key);
      }
    }
    const failed: string[] = [];
    const kept: string[] = [];
    let back = 0;
    for (const m of [...receipt.moved].reverse()) {
      const entry = receipt.planned.find((p) => p.rel === m.rel);
      const name = entry?.name ?? m.rel;
      if (entry && keepRows.has(billNameKey(entry.name))) {
        kept.push(name);
        continue;
      }
      const onDisk = await fsp.readFile(path.join(root, ...m.rel.split('/')), 'utf8').catch(() => null);
      if (onDisk !== null && sha(onDisk) === m.sha) {
        back++;
        continue;
      }
      if (onDisk !== null) {
        // Something else lives there now: the folded copy stays in the Bin rather than doubling it.
        kept.push(name);
        continue;
      }
      const it = items.find((x) => x.id === m.binId);
      if (!it) {
        failed.push(m.rel);
        continue;
      }
      try {
        const r = await bin.restore(m.binId);
        const text = await fsp.readFile(path.join(root, ...r.restored.split('/')), 'utf8').catch(() => null);
        if (text === null || sha(text) !== m.sha) {
          failed.push(m.rel);
          continue;
        }
        w.index.set(r.restored, text, 0, text.length);
        back++;
      } catch {
        failed.push(m.rel);
      }
    }
    // The move's rows out (rows the person added since stay, and rows they changed since stay changed).
    const read2 = await readBills(w).catch(() => null);
    if (read2) {
      const drop = read2.doc.rows.filter((r) => planned.has(billNameKey(r.name)) && !before.has(billNameKey(r.name)) && !keepRows.has(billNameKey(r.name))).map((r) => r.name);
      if (drop.length) {
        const dropKeys = new Set(drop.map((d) => billNameKey(d)));
        const rows = read2.doc.rows.filter((r) => !dropKeys.has(billNameKey(r.name)));
        const prices = { ...read2.doc.prices };
        const payments = { ...read2.doc.payments };
        for (const d of dropKeys) {
          delete prices[d];
          delete payments[d];
        }
        await writeBills(w, { ...read2.doc, rows, prices, payments });
      }
    }
    if (failed.length) {
      const zip = receipt.backup ? ` The backup zip still has everything: ${receipt.backup.zip}.` : '';
      throw new Error(`${failed.length === 1 ? '1 note had' : `${failed.length} notes had`} already left the Bin, so ${failed.length === 1 ? 'it stays' : 'they stay'} out: ${failed.slice(0, 4).join(', ')}${failed.length > 4 ? ' and others' : ''}.${zip}`);
    }
    await clearReceipt(w);
    await w.setFinanceSettings({ billsMove: 'deferred' });
    if (!back && kept.length) return kept.length === 1 ? `“${kept[0]}” you changed since stays in the list with your changes. Nothing else moved, so there is nothing to put back.` : `The ${kept.length} bills you changed since stay in the list with your changes. Nothing else moved, so there is nothing to put back.`;
    const base = back === 1 ? 'Put 1 note back where it was, word for word.' : `Put ${back} notes back where they were, word for word.`;
    if (!kept.length) return base;
    return kept.length === 1 ? `${base} “${kept[0]}” you changed since stays in the list with your changes (its folded copy stays in the Bin).` : `${base} ${kept.length} you changed since stay in the list with your changes (their folded copies stay in the Bin).`;
  });
}

// ── State for the page ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface BillsMoveState {
  offer: boolean;
  deferred: boolean;
  done: { at: string; folded: number; backup: string } | null;
  interrupted: boolean;
  undoable: boolean;
  pcsBlock: BillsPcsBlock | null;
  counts: { fold: number; stay: number };
  /** The list the move wrote gone now (deleted by hand or by sync), said on the Money page. */
  missingLists: string[];
  /** The missing list said in plain words, with the Undo or the backup offered. */
  missingWords: string[];
  /** Whether the backup zip is still on this PC. */
  backupExists: boolean;
}

/** The list the move wrote gone now, said plainly, with the Undo or the backup offered. */
export function billsMissingWords(missing: string[], undoable: boolean, backup: string, backupExists: boolean): string[] {
  if (!missing.length) return [];
  const names = missing.map((r) => `“${r.split('/').pop() ?? r}”`);
  const gone = missing.length === 1 ? `${names[0]} is gone from your notes.` : `${andWords(names)} are gone from your notes.`;
  if (undoable) return [gone, 'One Undo puts every folded note back word for word. Anything added to the list since may still be in File recovery.'];
  if (backup && backupExists) return [gone, `The backup from the tidy-up still has everything: ${backup}.`];
  return [gone, 'The backup is gone too. The list keeps its history (File recovery).'];
}

/** What the Money page shows: offered once, resumable when interrupted, quietly done after. */
export async function billsMoveState(w: BillsWork): Promise<BillsMoveState> {
  const receipt = await readReceipt(w);
  const interrupted = !!receipt && receipt.phase !== 'done';
  let undoable = false;
  let done: BillsMoveState['done'] = null;
  if (receipt?.phase === 'done') {
    const items = await createVaultBin({ root: w.root }).list().catch(() => []);
    const have = new Set(items.map((x) => x.id));
    undoable = receipt.moved.length > 0 && receipt.moved.every((m) => have.has(m.binId));
    done = { at: receipt.doneAt ?? receipt.startedAt, folded: receipt.moved.length, backup: receipt.backup?.zip ?? '' };
  }
  const settings = (await w.options().catch(() => null))?.finance?.settings ?? {};
  const status = settings.billsMove;
  // The list the move wrote gone now (the tables phase wrote it; only a move that reached
  // it can miss it, never a vault that never moved).
  let missingLists: string[] = [];
  if (receipt && receipt.phase !== 'backup') {
    const rel = await billsTableRelFor(w).catch(() => '');
    if (rel) {
      const live = w.index.content(rel);
      const there = live !== undefined || await fsp.stat(path.join(w.root, ...rel.split('/'))).then(() => true, () => false);
      if (!there) missingLists.push(rel);
    }
  }
  const backupZip = receipt?.backup?.zip ?? done?.backup ?? '';
  const backupExists = backupZip ? await fsp.stat(backupZip).then(() => true, () => false) : false;
  // Undo puts back from a finished move and from a half-done one with notes already in the Bin.
  undoable = undoable || (interrupted && (receipt?.moved.length ?? 0) > 0);
  const bills = await w.billNotes().catch((): FinanceNote[] => []);
  const plan = await planBillsMove(w, bills).catch((): BillsMovePlan => ({ fold: [], stay: [], clash: null, pcsBlock: null, stalePcs: [], unreadable: [], table: '' }));
  return {
    offer: !done && !interrupted && status !== 'deferred' && status !== 'done' && plan.fold.length > 0,
    deferred: status === 'deferred',
    done,
    interrupted,
    undoable,
    pcsBlock: plan.pcsBlock,
    counts: { fold: plan.fold.length, stay: plan.stay.length },
    missingLists,
    missingWords: billsMissingWords(missingLists, undoable, backupZip, backupExists),
    backupExists,
  };
}

/** Put away for now (the offer was made once; the list still works and the move waits). */
export async function deferBillsMove(w: BillsWork): Promise<string> {
  await w.setFinanceSettings({ billsMove: 'deferred' });
  return 'Left as it is. The tidy-up stays on the Money page for when you want it.';
}
