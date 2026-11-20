// The one-time move to records as data (5 Nov 2026; the approved plan). A full backup first, then a preview in
// plain words of what stays a note and what folds, one button, and one Undo that puts every file back byte for byte.
// Folded notes go to the Bin (never deleted for good); it never runs by itself; it is offered once, calmly, on the
// Systems page; and it resumes where it stopped if the app dies part way. It waits until every PC that opens the
// vault has the new version (a vault only ever opened on one PC may go ahead).

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { createVaultBin } from '../bin';
import { retryLocked } from '../save-guard';
import type { WorkModules } from '../work-modules';
import { writeZip } from '../zip';
import { readProps } from '../../shared/frontmatter';
import { withFields } from '../../shared/inline-fields';
import { moduleTypeLevel } from '../../shared/module-records';
import { SENSITIVITY_FILE, emptyStore, levelOf, type SensitivityStore } from '../../shared/sensitivity';
import { classifySystemsNote, compareVersions, PATTERN_WORDS, patternForName, restMembersFromSteps, type SystemsTableKind } from '../../shared/system-tables';
import { systemsModel } from '../../shared/systems';
import { notesOf, type LifeNote } from './common';
import { dropTableRows, readTable, tableRelFor, writeTable } from './system-tables';

export const MOVE_FILE = '.neuralvault/systems-move.json';
/** Why folded notes carry in the Bin (resume and Undo find them by it). */
export const MOVE_WHY = 'folded into the Systems lists';
const MOVE_BY = 'Systems tidy-up';
const TYPES = ['machine', 'service', 'runbook'];
/** Another PC counts as in play when it opened the vault within this long (older files are named, not blocking). */
const PC_FRESH_DAYS = 30;

const sha = (t: string): string => createHash('sha256').update(t).digest('hex');

export interface MoveCandidate { rel: string; name: string; kind: SystemsTableKind; why: string }
export interface PcsBlock { names: string[]; words: string }
export interface MovePlan {
  fold: MoveCandidate[];
  stay: MoveCandidate[];
  clash: string | null;
  pcsBlock: PcsBlock | null;
  /** PCs that have not opened the vault in over a month (named, not blocking). */
  stalePcs: string[];
  /** Notes on the disk the index could not read (online-only files among them): left alone, and named. */
  unreadable: { rel: string; name: string }[];
  tables: Record<SystemsTableKind, string>;
}

export interface MoveReceipt {
  version: 1;
  startedAt: string;
  phase: 'backup' | 'tables' | 'moves' | 'done';
  backup: { zip: string; files: number; bytes: number } | null;
  planned: MoveCandidate[];
  /** Rows already in the lists before the move (never touched by Undo). */
  preRows: Record<SystemsTableKind, string[]>;
  /** Planned notes skipped while moving (changed since the backup, or gone): left as notes, rows taken out. */
  skipped?: MoveCandidate[];
  /** Planned notes the person moved themselves mid-move: left where they put them, rows kept (never dropped). */
  kept?: MoveCandidate[];
  /** Whatever stopped the run (a held file, the app closing), in plain words for the Systems page. */
  stopped?: MoveStopped;
  /** Rows the move wrote, as written (Undo keeps ones the person changed since, with their changes). */
  rowSig?: Record<SystemsTableKind, Record<string, string>>;
  moved: { rel: string; binId: string; sha: string }[];
  doneAt?: string;
}

/** Why a run stopped, kept in the receipt: plain words for the page (never a code), the code kept apart so the
 *  next open knows whether the move may carry on by itself (a brief lock) or waits for the person. */
export interface MoveStopped {
  at: string;
  phase: 'backup' | 'tables' | 'moves' | 'finish';
  words: string;
  rel?: string;
  name?: string;
  code?: string;
}

// ── The plan ───────────────────────────────────────────────────────────────────────────────────────────────────────────

async function systemsNotes(w: WorkModules): Promise<LifeNote[]> {
  return notesOf(w, w.d.index, TYPES, true);
}

const andWords = (names: string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The vault's privacy file, for the level each note folds at (a missing or broken file is no markings). */
async function sensitivityStore(root: string): Promise<SensitivityStore> {
  const clean = emptyStore();
  try {
    const v = JSON.parse(await fsp.readFile(path.join(root, ...SENSITIVITY_FILE.split('/')), 'utf8')) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return clean;
    for (const k of ['folders', 'types', 'items'] as const) if (v[k] && typeof v[k] === 'object' && !Array.isArray(v[k])) (clean as unknown as Record<string, unknown>)[k] = v[k];
  } catch {
    // No markings: everything folds at the Systems level.
  }
  return clean;
}

/** Notes on the disk the index could not read (an online-only file whose read failed leaves no trace in the
 *  index): found by walking what the folders hold, so the move can leave them alone and say so. */
async function unreadableSystemsNotes(w: WorkModules): Promise<{ rel: string; name: string }[]> {
  const out = new Map<string, string>();
  for (const kind of TYPES) {
    let folder = '';
    try {
      folder = await w.folderOf(kind);
    } catch {
      continue;
    }
    if (!folder) continue;
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
        if (w.d.index.get(rel) === undefined && !w.d.index.isExcluded(rel)) out.set(rel, e.name.replace(/\.md$/i, ''));
      }
    };
    await walk(path.join(w.d.vault().root, ...folder.split('/')), folder);
  }
  return [...out].map(([rel, name]) => ({ rel, name })).sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Every Systems note read as fold or stay, with the plain reason each way. */
export async function planMove(w: WorkModules): Promise<MovePlan> {
  const notes = await systemsNotes(w);
  const model = systemsModel(notes, w.today(), {});
  const osByName: Record<string, string> = {};
  const servicesByMachine: Record<string, { name: string; kind?: string }[]> = {};
  const machineByService: Record<string, string> = {};
  for (const m of model.machines) {
    if (m.os) osByName[m.name.toLowerCase()] = m.os;
    servicesByMachine[m.name.toLowerCase()] = model.services.filter((s) => s.machinePath === m.path).map((s) => ({ name: s.name, kind: s.kind }));
  }
  for (const s of model.services) if (s.machinePath) machineByService[s.name.toLowerCase()] = model.machines.find((m) => m.path === s.machinePath)?.name ?? '';
  // One row per name in each list: two notes sharing one, or a row already there, stay notes.
  const counts = new Map<string, number>();
  for (const n of notes) {
    const k = `${n.type}|||${n.title.toLowerCase()}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const existing = new Map<string, Set<string>>();
  for (const kind of TYPES as SystemsTableKind[]) {
    try {
      existing.set(kind, new Set((await readTable(w, kind)).doc.rows.map((r) => r.name.toLowerCase())));
    } catch {
      existing.set(kind, new Set());
    }
  }
  // Rows read at the Systems level: a note marked otherwise stays, so no agent gains a word.
  const store = await sensitivityStore(w.d.vault().root);
  const systemsLevel = moduleTypeLevel('machine') ?? 'personal';
  const fold: MoveCandidate[] = [];
  const stay: MoveCandidate[] = [];
  for (const n of notes) {
    const kind = n.type as SystemsTableKind;
    const at = { rel: n.path, name: n.title, kind };
    if ((counts.get(`${n.type}|||${n.title.toLowerCase()}`) ?? 0) > 1) {
      stay.push({ ...at, why: 'another note shares its name' });
      continue;
    }
    const c = classifySystemsNote({ type: n.type, title: n.title, props: n.props, content: n.content, files: n.files }, { osByName, servicesByMachine, machineByService });
    if (!c.fold) {
      stay.push({ ...at, why: c.why });
      continue;
    }
    if (existing.get(kind)?.has(n.title.toLowerCase())) {
      stay.push({ ...at, why: 'already in the list' });
      continue;
    }
    let level = systemsLevel;
    try {
      level = levelOf(store, n.path, n.props.sensitivity, n.type).level;
    } catch {
      level = 'family';
    }
    if (level !== systemsLevel) {
      stay.push({ ...at, why: 'has its own privacy marking' });
      continue;
    }
    fold.push({ ...at, why: c.why });
  }
  fold.sort((a, b) => a.name.localeCompare(b.name));
  stay.sort((a, b) => a.name.localeCompare(b.name));
  const tables = { machine: await tableRelFor(w, 'machine'), service: await tableRelFor(w, 'service'), runbook: await tableRelFor(w, 'runbook') };
  const clashes: string[] = [];
  for (const kind of TYPES as SystemsTableKind[]) {
    try {
      await readTable(w, kind);
    } catch (e) {
      clashes.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { fold, stay, clash: clashes.length ? [...new Set(clashes)].join(' ') : null, pcsBlock: await pcsBlock(w), stalePcs: await stalePcs(w), unreadable: await unreadableSystemsNotes(w), tables };
}

const unreadableWords = (list: { rel: string; name: string }[]): string => {
  const names = andWords(list.slice(0, 4).map((u) => `“${u.name}”`));
  const more = list.length > 4 ? ` and ${list.length - 4} more` : '';
  return list.length === 1 ? `${names} couldn't be read (OneDrive may still be fetching it), so it stays a note, untouched.` : `${list.length} notes couldn't be read (OneDrive may still be fetching them): ${names}${more}. They stay as notes, untouched.`;
};

const staleWords = (names: string[]): string => `${andWords(names)} ${names.length < 2 ? "hasn't" : "haven't"} opened the vault in over a month, so the tidy-up goes ahead without ${names.length < 2 ? 'it' : 'them'}.`;

/** The preview in plain words: what stays a note and why, what folds and why, the backup and the Bin. */
export function previewWords(plan: MovePlan): string[] {
  const lines = [
    `This tidies ${plan.fold.length === 1 ? '1 note' : `${plan.fold.length} notes`} your checks made into three lists you can read: Machines, Services and Runbooks.`,
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
export async function pcsBlock(w: WorkModules): Promise<PcsBlock | null> {
  const root = w.d.vault().root;
  const selfId = w.d.device?.id ?? '';
  const selfVersion = w.d.appVersion ?? '';
  const { ok: others, broken } = await pcsOf(root, selfId);
  if (!selfVersion) {
    // Without our own version to compare, only the single-PC shape may go ahead.
    const total = (await fsp.readdir(path.join(root, '.neuralvault', 'pcs')).catch(() => [] as string[])).filter((n) => /^[0-9a-f-]{36}\.json$/i.test(n));
    if (total.length <= 1) return null;
    return { names: others.map((o) => o.name), words: 'Another PC opens this vault, so the tidy-up waits until every PC has the new Ironleaf. Update each PC, open the vault there once, then come back.' };
  }
  const fresh = others.filter((o) => Date.now() - o.at < PC_FRESH_DAYS * 86400000);
  const behind = fresh.filter((o) => !o.version || compareVersions(o.version, selfVersion) < 0);
  if (behind.length) {
    const names = [...new Set(behind.map((o) => o.name))];
    const who = andWords(names);
    return { names, words: `${who} still ${names.length < 2 ? 'has' : 'have'} the older Ironleaf, so the tidy-up waits. Update Ironleaf on ${who}, open the vault there once, then come back.` };
  }
  if (broken.some((b) => b.fresh)) return { names: [], words: `A file from another PC couldn't be read, so the tidy-up waits. Open the vault on each PC once, then come back.` };
  return null;
}

/** PCs that opened the vault over a month ago: named in the preview, never blocking. */
export async function stalePcs(w: WorkModules): Promise<string[]> {
  const { ok } = await pcsOf(w.d.vault().root, w.d.device?.id ?? '');
  return [...new Set(ok.filter((o) => Date.now() - o.at >= PC_FRESH_DAYS * 86400000).map((o) => o.name))].sort((a, b) => a.localeCompare(b));
}

// ── The receipt (resume and Undo) ──────────────────────────────────────────────────────────────────────────────────────

const receiptPath = (w: WorkModules): string => path.join(w.d.vault().root, ...MOVE_FILE.split('/'));
async function readReceipt(w: WorkModules): Promise<MoveReceipt | null> {
  try {
    const v = JSON.parse(await fsp.readFile(receiptPath(w), 'utf8')) as MoveReceipt;
    return v && v.version === 1 && Array.isArray(v.planned) && Array.isArray(v.moved) ? v : null;
  } catch {
    return null;
  }
}
async function writeReceipt(w: WorkModules, r: MoveReceipt): Promise<void> {
  const file = receiptPath(w);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.nvtmp`;
  await fsp.writeFile(temp, JSON.stringify(r, null, 1), 'utf8');
  await fsp.rename(temp, file);
}
async function clearReceipt(w: WorkModules): Promise<void> {
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
export async function backupVault(w: WorkModules): Promise<{ zip: string; files: number; bytes: number }> {
  const root = w.d.vault().root;
  const dataDir = w.d.dataDir ?? path.join(root, '.neuralvault', 'tmp');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const vaultName = path.basename(root).replace(/[^\w .-]+/g, '').trim() || 'vault';
  // Its own name even twice in a minute (two backups sharing a name would write one zip over the other).
  let dest = path.join(dataDir, 'backups', `${vaultName}-before-systems-lists-${stamp}.zip`);
  for (let n = 2; await fsp.stat(dest).then(() => true, () => false); n++) {
    dest = path.join(dataDir, 'backups', `${vaultName}-before-systems-lists-${stamp}-${n}.zip`);
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const files = await vaultFiles(root);
  const { bytes } = await writeZip(dest, files.map((rel) => ({ name: rel, abs: path.join(root, ...rel.split('/')) })));
  return { zip: dest, files: files.length, bytes };
}

// ── Running ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const linkOf = (name: string): string => (name ? `[[${name}]]` : '');

function entryToRow(kind: SystemsTableKind, entry: { name: string; [k: string]: unknown }, pattern?: string): { cells: Record<string, string>; logs: [string, string, string][]; runs: [string, string, string][] } {
  if (kind === 'machine') {
    const m = entry as unknown as { kind: string; role: string; os: string; address: string; location: string; status: string; checked: string | null; credentials: { label: string; id: string }[]; health: { date: string | null; status: string; note: string }[] };
    return {
      cells: { kind: m.kind, role: m.role, os: m.os, address: m.address, location: m.location, status: m.status, checked: m.checked ?? '', logins: m.credentials.map((c) => `${c.label}: [locked](secret:${c.id})`).join('; ') },
      logs: m.health.map((h) => [h.date ?? '', h.status, h.note]),
      runs: [],
    };
  }
  if (kind === 'service') {
    const s = entry as unknown as { kind: string; runsOn: string; url: string; port: string; status: string; dependsOn: { name: string }[]; runbook: string; checked: string | null; credentials: { label: string; id: string }[]; health: { date: string | null; status: string; note: string }[] };
    return {
      cells: { kind: s.kind, runsOn: linkOf(s.runsOn), url: s.url, port: s.port, status: s.status, dependsOn: s.dependsOn.map((d) => linkOf(d.name)).join(', '), runbook: linkOf(s.runbook), checked: s.checked ?? '', logins: s.credentials.map((c) => `${c.label}: [locked](secret:${c.id})`).join('; ') },
      logs: s.health.map((h) => [h.date ?? '', h.status, h.note]),
      runs: [],
    };
  }
  const r = entry as unknown as { name: string; for: { name: string }[]; every: string; lastRun: string | null; runs: { date: string | null; result: string; note: string }[]; steps: { text: string }[] };
  // The shared restarter keeps its members after its machine, so its page fills the same steps back in.
  const forNames = r.for.map((f) => f.name);
  const all = pattern === PATTERN_WORDS.rest ? [forNames[0], ...restMembersFromSteps(r.steps.map((s) => s.text))].filter(Boolean) : forNames;
  return {
    cells: { for: [...new Set(all)].map((n) => linkOf(n)).join(', '), every: r.every, lastRun: r.lastRun ?? '', pattern: pattern ?? '' },
    logs: [],
    runs: r.runs.map((x) => [x.date ?? '', x.result, x.note]),
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

/** One PC holds the run: the lock file in the vault while a move or Undo runs (two windows share the flag
 *  above; two PCs share only the folder). A lock older than this is a dead app's, and is taken over. */
export const MOVE_LOCK = '.neuralvault/systems-move.lock';
const LOCK_FRESH_MS = 5 * 60 * 1000;

interface MoveLock {
  pc: string;
  name: string;
  at: number;
}

const lockPath = (w: WorkModules): string => path.join(w.d.vault().root, ...MOVE_LOCK.split('/'));

/** This PC holds the run now, or the name of the PC that does. The first writer wins (an atomic create);
 *  a stale or unreadable lock is taken over, never blocking for good. A lock that cannot be written stops
 *  the run in plain words before anything changes. */
export async function acquireMoveLock(w: WorkModules): Promise<string | null> {
  const file = lockPath(w);
  const self = w.d.device?.id ?? '';
  const selfName = w.d.device?.name?.trim() || 'This PC';
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
  let cur: MoveLock | null = null;
  try {
    const v = JSON.parse(await fsp.readFile(file, 'utf8')) as Partial<MoveLock>;
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
async function touchMoveLock(w: WorkModules): Promise<void> {
  try {
    const file = lockPath(w);
    const v = JSON.parse(await fsp.readFile(file, 'utf8')) as Partial<MoveLock>;
    if (!v || v.pc !== (w.d.device?.id ?? '')) return;
    const temp = `${file}.${process.pid}.nvtmp`;
    await fsp.writeFile(temp, JSON.stringify({ pc: v.pc, name: v.name ?? 'This PC', at: Date.now() }));
    await fsp.rename(temp, file);
  } catch {
    // The lock stands as it was: a missed touch only matters after five quiet minutes.
  }
}

/** The run is over: this PC's lock goes, so the next run starts clean. Best effort. */
export async function releaseMoveLock(w: WorkModules): Promise<void> {
  try {
    const file = lockPath(w);
    const text = await fsp.readFile(file, 'utf8').catch((): null => null);
    if (!text) return;
    const v = JSON.parse(text) as Partial<MoveLock> | null;
    if (v && v.pc === (w.d.device?.id ?? '')) await fsp.rm(file, { force: true });
  } catch {
    // A leftover lock goes stale and is taken over; never blocking for good.
  }
}

/** One PC runs at a time: the lock held for the whole run, in-process guard outside it. */
async function guardMoveLocked<T>(w: WorkModules, fn: () => Promise<T>): Promise<T> {
  return guardMove(async () => {
    const holder = await acquireMoveLock(w);
    if (holder) throw new Error(`${holder} is tidying the Systems lists right now. Wait a moment, then carry on.`);
    try {
      return await fn();
    } finally {
      await releaseMoveLock(w);
    }
  });
}

/** A held file (OneDrive, antivirus, an indexer) is retried a few times with short waits before the run stops. */
const moveFile = <T>(fn: () => Promise<T>): Promise<T> => retryLocked(fn, 3, (n) => [150, 400, 900][n] ?? 900);

/** A lock the next open may carry on past by itself (briefly held, likely clear by then). */
const AUTO_LOCK_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** The app closed part way through: kept in the receipt when found that way, said on the Systems page. */
const APP_CLOSED_WORDS = 'The app closed part way through. Nothing is half done: carry on, or put back what moved so far.';

/** Whatever stopped the run, kept in the receipt for the Systems page and the next open. Best effort: the write
 *  must never mask the stop itself (a full disk stops the run and the write together). */
async function writeStopped(w: WorkModules, phase: MoveStopped['phase'], err: unknown): Promise<void> {
  const receipt = await readReceipt(w).catch((): null => null);
  if (!receipt || receipt.phase === 'done') return;
  const words = err instanceof Error ? err.message : String(err);
  const e = err as { code?: unknown; fsCode?: unknown; moveRel?: unknown; moveName?: unknown };
  const code = typeof e?.fsCode === 'string' ? e.fsCode : typeof e?.code === 'string' ? e.code : undefined;
  const rel = typeof e?.moveRel === 'string' ? e.moveRel : undefined;
  const name = typeof e?.moveName === 'string' ? e.moveName : undefined;
  receipt.stopped = { at: new Date().toISOString(), phase, words, ...(rel ? { rel } : {}), ...(name ? { name } : {}), ...(code ? { code } : {}) };
  await writeReceipt(w, receipt).catch(() => undefined);
}

/** The file's own code kept on a wrapped error (a wrapped TABLES_WRITE still carries its EPERM for the next open). */
const fsCodeOf = (e: unknown): { fsCode: string } | Record<string, never> => {
  const code = (e as NodeJS.ErrnoException)?.code;
  return typeof code === 'string' ? { fsCode: code } : {};
};

/** Whether a planned note gone from its path is a note the person moved themselves: the same Systems note
 *  (same title and type) under another path. The index first, then the disk itself (a move the index hasn't
 *  caught up with still counts); renamed as well as moved reads as gone, and the file itself stays safe
 *  whatever the move decides. */
async function noteMovedElsewhere(w: WorkModules, f: MoveCandidate): Promise<boolean> {
  const name = f.name.trim().toLowerCase();
  const sameType = (t: unknown): boolean => TYPES.includes(String(t ?? '').trim().toLowerCase());
  for (const m of w.d.index.allMeta()) {
    if (m.path !== f.rel && m.title.trim().toLowerCase() === name && sameType((m.props as Record<string, unknown> | undefined)?.type)) return true;
  }
  const base = f.rel.split('/').pop()?.toLowerCase() ?? '';
  if (!base) return false;
  const root = w.d.vault().root;
  const dirs = [''];
  while (dirs.length) {
    const dir = dirs.pop()!;
    const entries = await fsp.readdir(path.join(root, ...dir.split('/').filter(Boolean)), { withFileTypes: true }).catch((): never[] => []);
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === '.neuralvault' || e.name === 'node_modules') continue;
        dirs.push(rel);
      } else if (e.isFile() && e.name.toLowerCase() === base && rel !== f.rel && rel.toLowerCase().endsWith('.md')) {
        const text = await fsp.readFile(path.join(root, ...rel.split('/')), 'utf8').catch(() => null);
        if (text !== null && sameType(readProps(text).type)) return true;
      }
    }
  }
  return false;
}

async function guardMove<T>(fn: () => Promise<T>): Promise<T> {
  if (moveRunning) throw new Error('A tidy-up is already running. Wait for it to finish.');
  moveRunning = true;
  try {
    return await fn();
  } finally {
    moveRunning = false;
  }
}

/** The notes folder still there (renamed or moved mid-move reads as plain words, never a mystery). */
async function requireRoot(w: WorkModules): Promise<void> {
  const there = await fsp.stat(w.d.vault().root).then(() => true, () => false);
  if (!there) throw new Error('Your notes folder is no longer there. Put it back, then carry on.');
}

/** A folding note's row brought up to the bytes being moved: the note changed since the lists were
 *  written (typed into, or an agent's doing) and still folds. Compared by fingerprint, so an unchanged row
 *  costs no list read; a row the person changed since keeps theirs instead (its fingerprint no longer
 *  matches what the move wrote); a missing row is written back. */
async function refreshRowForMove(w: WorkModules, receipt: MoveReceipt, f: { kind: SystemsTableKind; rel: string; name: string }, diskEntry: { name: string } | undefined): Promise<void> {
  if (!diskEntry) return;
  const pattern = f.kind === 'runbook' ? (() => {
    const id = patternForName(f.name);
    return id ? PATTERN_WORDS[id] : undefined;
  })() : undefined;
  const { cells, logs: ls, runs: rs } = entryToRow(f.kind, diskEntry, pattern);
  const sigLogs = ls.map(([date, status, note]) => ({ date: date || null, status, note }));
  const sigRuns = rs.map(([date, result, note]) => ({ date: date || null, result, note }));
  const key = f.name.toLowerCase();
  if (sha(JSON.stringify({ cells, logs: sigLogs, runs: sigRuns })) === receipt.rowSig?.[f.kind]?.[key]) return;
  const read = await readTable(w, f.kind).catch(() => null);
  if (!read) return;
  const row = read.doc.rows.find((r) => r.name.toLowerCase() === key);
  const was = receipt.rowSig?.[f.kind]?.[key];
  if (row && (was === undefined || sha(JSON.stringify({ cells: row.cells, logs: read.doc.logs[key] ?? [], runs: read.doc.runs[key] ?? [] })) !== was)) return;
  const rows = row ? read.doc.rows.map((r) => (r.name.toLowerCase() === key ? { name: r.name, cells, note: null } : r)) : [...read.doc.rows, { name: f.name, cells, note: null }];
  const logs = { ...read.doc.logs };
  const runs = { ...read.doc.runs };
  if (ls.length) logs[key] = sigLogs;
  else delete logs[key];
  if (rs.length) runs[key] = sigRuns;
  else delete runs[key];
  await writeTable(w, f.kind, { ...read.doc, rows, logs, runs });
  (receipt.rowSig ??= { machine: {}, service: {}, runbook: {} })[f.kind][key] = sha(JSON.stringify({ cells, logs: sigLogs, runs: sigRuns }));
  await writeReceipt(w, receipt);
}

/** One phase of the move, so a crash between phases resumes cleanly (tests drive these one at a time).
 *  Whatever stops it is kept in the receipt (writeStopped) for the Systems page and the next open. */
export async function runMovePhase(w: WorkModules, phase: 'backup' | 'tables' | 'moves' | 'finish', opts: { limit?: number; bin?: Pick<ReturnType<typeof createVaultBin>, 'put' | 'list'> } = {}): Promise<string> {
  await requireRoot(w);
  try {
    return await runMovePhaseInner(w, phase, opts);
  } catch (err) {
    await writeStopped(w, phase, err);
    throw err;
  }
}

async function runMovePhaseInner(w: WorkModules, phase: 'backup' | 'tables' | 'moves' | 'finish', opts: { limit?: number; bin?: Pick<ReturnType<typeof createVaultBin>, 'put' | 'list'> }): Promise<string> {
  const plan = await planMove(w);
  // The gates keep their codes in the receipt's reason, so the next open waits for the person (another PC to
  // update, a list to unclash), never carrying on past them by itself.
  if (plan.pcsBlock) throw Object.assign(new Error(plan.pcsBlock.words), { code: 'PCS_BLOCK' });
  if (plan.clash) throw Object.assign(new Error(plan.clash), { code: 'TABLES_CLASH' });
  let receipt = await readReceipt(w);
  if (phase === 'backup') {
    if (receipt?.backup) return 'The backup is already there.';
    let backup: { zip: string; files: number; bytes: number };
    try {
      backup = await backupVault(w);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      const why = code === 'ENOSPC' ? 'the disk is full' : code === 'EACCES' || code === 'EPERM' ? 'its folder is locked' : 'it could not be written';
      throw Object.assign(new Error(`Couldn't back up the vault (${why}). Nothing changed.`), typeof code === 'string' ? { code } : {});
    }
    // Rows already in the lists before anything is written (Undo never touches these, even across a crash).
    const preRows: Record<SystemsTableKind, string[]> = { machine: [], service: [], runbook: [] };
    for (const kind of TYPES as SystemsTableKind[]) {
      const read = await readTable(w, kind).catch(() => null);
      if (read) preRows[kind] = read.doc.rows.map((r) => r.name);
    }
    receipt = { version: 1, startedAt: new Date().toISOString(), phase: 'backup', backup, planned: plan.fold, preRows, moved: receipt?.moved ?? [] };
    await writeReceipt(w, receipt);
    await touchMoveLock(w);
    return `Backed up ${backup.files} files to ${backup.zip}.`;
  }
  if (!receipt?.backup) throw new Error('Take the backup first.');
  if (phase === 'tables') {
    // Rows for every planned note (the backup's plan, frozen: names already there are left alone, so
    // resuming never doubles). Each list freshly read just before it is written, so a record added while
    // the move runs (by the person, an agent, another PC's sync) is merged in, never written over.
    try {
      const notes = await systemsNotes(w);
      const model = systemsModel(notes, w.today(), {});
      const byPath = new Map<string, unknown>();
      for (const m of model.machines) byPath.set(m.path, m);
      for (const s of model.services) byPath.set(s.path, s);
      for (const r of model.runbooks) byPath.set(r.path, r);
      const rowSig = receipt.rowSig ?? { machine: {}, service: {}, runbook: {} };
      for (const kind of TYPES as SystemsTableKind[]) {
        const read = await readTable(w, kind);
        const rows = [...read.doc.rows];
        const logs = { ...read.doc.logs };
        const runs = { ...read.doc.runs };
        for (const f of receipt.planned.filter((x) => x.kind === kind)) {
          const entry = byPath.get(f.rel) as { name: string } | undefined;
          if (!entry) continue;
          // A folded runbook matched a generated one (the plan's test); its row keeps the pattern's name,
          // not a copy of the steps, and its page fills the one shared set in.
          const pattern = kind === 'runbook' ? (() => {
            const id = patternForName(f.name);
            return id ? PATTERN_WORDS[id] : undefined;
          })() : undefined;
          const { cells, logs: ls, runs: rs } = entryToRow(kind, entry, pattern);
          const sigLogs = ls.map(([date, status, note]) => ({ date: date || null, status, note }));
          const sigRuns = rs.map(([date, result, note]) => ({ date: date || null, result, note }));
          // The fingerprint stands once set (a retry never moves it: what the move wrote is what Undo
          // compares). A row already there without one (added by hand under the same name mid-move) is
          // fingerprinted as the move would write it, so Undo keeps the person's version, never drops it.
          rowSig[kind][f.name.toLowerCase()] ??= sha(JSON.stringify({ cells, logs: sigLogs, runs: sigRuns }));
          if (rows.some((r) => r.name.toLowerCase() === f.name.toLowerCase())) continue;
          rows.push({ name: f.name, cells, note: null });
          if (ls.length) logs[f.name.toLowerCase()] = sigLogs;
          if (rs.length) runs[f.name.toLowerCase()] = sigRuns;
        }
        try {
          await moveFile(() => writeTable(w, kind, { ...read.doc, rows, logs, runs }));
          // Kept after each list (a full disk or a dead app between lists still leaves every written row
          // fingerprinted, so a retry never doubles and Undo still knows a row the person changed since).
          receipt.rowSig = { ...rowSig, [kind]: { ...rowSig[kind] } };
          await writeReceipt(w, receipt);
          await touchMoveLock(w);
        } catch (e) {
          throw Object.assign(new Error(`Couldn't write the lists (${plainFsError(e)}). Carry on to finish.`), { code: 'TABLES_WRITE' }, fsCodeOf(e));
        }
      }
      receipt.rowSig = rowSig;
    } catch (e) {
      // A clashing list, or a failed write, is already in plain words; reading troubles are said as reading
      // troubles, never as write troubles.
      const code = (e as { code?: unknown })?.code;
      if (code === 'TABLES_CLASH' || code === 'TABLES_WRITE') throw e;
      throw new Error(`Couldn't read the lists (${plainFsError(e)}). Carry on to try again.`);
    }
    try {
      receipt.phase = 'tables';
      await writeReceipt(w, receipt);
    } catch (e) {
      throw new Error(`Couldn't write the lists (${plainFsError(e)}). Carry on to finish.`);
    }
    return 'The lists are written.';
  }
  if (phase === 'moves') {
    // Each planned note to the Bin, the receipt after each one (a crash resumes from the receipt). Read
    // from the disk, not the index, and read again as fold or stay: a note that gained words since the
    // backup stays a note, and the fingerprint is of the bytes that moved.
    const root = w.d.vault().root;
    const bin = opts.bin ?? createVaultBin({ root });
    const notes = await systemsNotes(w);
    const model = systemsModel(notes, w.today(), {});
    const osByName: Record<string, string> = {};
    const servicesByMachine: Record<string, { name: string; kind?: string }[]> = {};
    const machineByService: Record<string, string> = {};
    for (const m of model.machines) {
      if (m.os) osByName[m.name.toLowerCase()] = m.os;
      servicesByMachine[m.name.toLowerCase()] = model.services.filter((s) => s.machinePath === m.path).map((s) => ({ name: s.name, kind: s.kind }));
    }
    for (const s of model.services) if (s.machinePath) machineByService[s.name.toLowerCase()] = model.machines.find((m) => m.path === s.machinePath)?.name ?? '';
    // Entries from each planned note's disk words (read once): the refresh check below compares them with
    // what the lists hold. Rebuilt for a note whose disk words move again mid-loop.
    const diskTexts = new Map<string, string | null>();
    for (const f of receipt.planned) diskTexts.set(f.rel, await fsp.readFile(path.join(root, ...f.rel.split('/')), 'utf8').catch(() => null));
    const subbed = () => notes.map((n) => {
      const disk = diskTexts.get(n.path);
      return disk == null ? n : { ...n, props: withFields(readProps(disk), disk), content: disk };
    });
    let diskModel = systemsModel(subbed(), w.today(), {});
    const diskByPath = new Map<string, unknown>();
    const reindexDisk = (): void => {
      diskByPath.clear();
      for (const m of diskModel.machines) diskByPath.set(m.path, m);
      for (const s of diskModel.services) diskByPath.set(s.path, s);
      for (const r of diskModel.runbooks) diskByPath.set(r.path, r);
    };
    reindexDisk();
    const diskEntryFor = (f: { rel: string }, disk: string): { name: string } | undefined => {
      if (diskTexts.get(f.rel) !== disk) {
        diskTexts.set(f.rel, disk);
        diskModel = systemsModel(subbed(), w.today(), {});
        reindexDisk();
      }
      return diskByPath.get(f.rel) as { name: string } | undefined;
    };
    const limit = opts.limit ?? Number.MAX_SAFE_INTEGER;
    const skipped = receipt.skipped ?? [];
    const kept = receipt.kept ?? [];
    let n = 0;
    for (const f of receipt.planned) {
      if (n >= limit) break;
      if (receipt.moved.some((m) => m.rel === f.rel)) continue;
      if (skipped.some((s) => s.rel === f.rel)) continue;
      if (kept.some((s) => s.rel === f.rel)) continue;
      const disk = await fsp.readFile(path.join(root, ...f.rel.split('/')), 'utf8').catch(() => null);
      if (disk === null) {
        // Gone from the disk: crashed between the Bin and the receipt, the person took it out to the Bin
        // themselves, or the person moved it. The Bin's copy (tagged with this move) stands for it; one the
        // person took out may drop its row, because the Bin has it; one the person moved keeps its row —
        // dropping it would lose the record, since the lists are the only place it shows.
        const items = await bin.list();
        const mine = items.find((it) => it.path === f.rel && it.why === MOVE_WHY);
        if (mine?.sha) {
          receipt.moved.push({ rel: f.rel, binId: mine.id, sha: mine.sha });
          await writeReceipt(w, receipt);
        } else if (items.some((it) => it.path === f.rel)) {
          skipped.push({ rel: f.rel, name: f.name, kind: f.kind, why: 'taken out to the Bin by the person' });
          receipt.skipped = skipped;
          await writeReceipt(w, receipt);
        } else if (await noteMovedElsewhere(w, f)) {
          kept.push({ rel: f.rel, name: f.name, kind: f.kind, why: 'moved by the person while tidying' });
          receipt.kept = kept;
          await writeReceipt(w, receipt);
        } else {
          skipped.push({ rel: f.rel, name: f.name, kind: f.kind, why: 'went missing while tidying' });
          receipt.skipped = skipped;
          await writeReceipt(w, receipt);
        }
        continue;
      }
      const props = withFields(readProps(disk), disk);
      const files = await w.filesOf(f.rel).catch(() => [] as string[]);
      const c = classifySystemsNote({ type: f.kind, title: f.name, props, content: disk, files }, { osByName, servicesByMachine, machineByService });
      if (!c.fold) {
        skipped.push({ rel: f.rel, name: f.name, kind: f.kind, why: c.why });
        receipt.skipped = skipped;
        await writeReceipt(w, receipt);
        continue;
      }
      // The note changed since the lists were written and still folds: its row is brought up to the bytes
      // being moved (a row the person changed since keeps theirs instead).
      try {
        await moveFile(() => refreshRowForMove(w, receipt, f, diskEntryFor(f, disk)));
      } catch (e) {
        if ((e as { code?: unknown })?.code === 'TABLES_CLASH') throw e;
        throw Object.assign(new Error(`Couldn't write the lists (${plainFsError(e)}). Carry on to finish.`), fsCodeOf(e));
      }
      const digest = sha(disk);
      let item: { id: string };
      try {
        item = await moveFile(() => bin.put(f.rel, { by: MOVE_BY, why: MOVE_WHY }));
      } catch (e) {
        const movedBits = receipt.moved.length ? ` ${receipt.moved.length === 1 ? '1 note is' : `${receipt.moved.length} notes are`} already in the Bin; fix it and carry on, or Undo puts them back.` : ' Nothing moved yet; fix it and carry on.';
        const code = (e as NodeJS.ErrnoException)?.code;
        throw Object.assign(new Error(`Couldn't move “${f.name}” to the Bin (${plainFsError(e)}).${movedBits}`), typeof code === 'string' ? { code } : {}, { moveRel: f.rel, moveName: f.name });
      }
      w.d.index.delete?.(f.rel);
      receipt.moved.push({ rel: f.rel, binId: item.id, sha: digest });
      await writeReceipt(w, receipt);
      await touchMoveLock(w);
      n++;
    }
    receipt.skipped = skipped;
    receipt.kept = kept;
    receipt.phase = 'moves';
    await writeReceipt(w, receipt);
    return 'The notes are in the Bin.';
  }
  // finish
  const skipped = receipt.skipped ?? [];
  for (const kind of TYPES as SystemsTableKind[]) {
    const names = skipped.filter((s) => s.kind === kind).map((s) => s.name);
    if (names.length) await dropTableRows(w, kind, names).catch(() => 0);
  }
  receipt.phase = 'done';
  receipt.doneAt = new Date().toISOString();
  await writeReceipt(w, receipt);
  await w.setOptions('systems', { settings: { recordsMove: 'done' } } as unknown as Parameters<WorkModules['setOptions']>[1]);
  return skipped.length ? `The tidy-up is done. ${skipped.length === 1 ? '1 note changed while tidying and stayed a note' : `${skipped.length} notes changed while tidying and stayed notes`}.` : 'The tidy-up is done.';
}

const skippedWords = (n: number): string => (n === 1 ? '1 note changed while tidying and stayed a note.' : `${n} notes changed while tidying and stayed notes.`);

/** The whole move, one phase after another: backup, lists, Bin, done. Never runs by itself. */
export async function runMove(w: WorkModules): Promise<string> {
  return guardMoveLocked(w, async () => {
    const plan = await planMove(w);
    if (!plan.fold.length) {
      const nothing = 'Nothing to tidy: every Systems note holds words you wrote.';
      return plan.unreadable.length ? `${nothing} ${unreadableWords(plan.unreadable)}` : nothing;
    }
    await runMovePhase(w, 'backup');
    await runMovePhase(w, 'tables');
    await runMovePhase(w, 'moves');
    await runMovePhase(w, 'finish');
    const receipt = (await readReceipt(w))!;
    const n = receipt.moved.length;
    let out = `Folded ${n === 1 ? '1 note' : `${n} notes`} into the Systems lists. The backup is at ${receipt.backup!.zip}, and Undo puts every file back.`;
    if (plan.unreadable.length) out += ` ${unreadableWords(plan.unreadable)}`;
    if ((receipt.skipped ?? []).length) out += ` ${skippedWords(receipt.skipped!.length)}`;
    return out;
  });
}

/** Carry on after the app died part way (every finished step is skipped, nothing doubles). */
export async function resumeMove(w: WorkModules): Promise<string> {
  return guardMoveLocked(w, async () => {
    const receipt = await readReceipt(w);
    if (!receipt || receipt.phase === 'done') return 'Nothing to carry on with.';
    if (!receipt.backup) await runMovePhase(w, 'backup');
    const afterBackup = (await readReceipt(w))!;
    if (afterBackup.phase === 'backup') await runMovePhase(w, 'tables');
    await runMovePhase(w, 'moves');
    await runMovePhase(w, 'finish');
    const after = (await readReceipt(w))!;
    let out = `Finished the tidy-up: ${after.moved.length} notes folded into the Systems lists. Undo still puts every file back.`;
    if ((after.skipped ?? []).length) out += ` ${skippedWords(after.skipped!.length)}`;
    return out;
  });
}

/** Carry on by itself (8 Nov 2026, the plan item 2): a move the person already started, stopped by the
 *  app closing or a briefly locked file, finishes the next time the vault opens — same receipt, backup and
 *  Undo. Anything else (a full disk, a list the person changed) waits for the person: Carry on stays on the
 *  page. A move never starts by itself: with no receipt, or nothing interrupted, nothing runs. */
export async function maybeResumeMove(w: WorkModules): Promise<string | null> {
  if (moveRunning) return null;
  const receipt = await readReceipt(w).catch((): null => null);
  if (!receipt || receipt.phase === 'done' || !w.isOn('systems')) return null;
  // No code means the app closed part way (older receipts, and found-that-way backfills, too); a brief
  // lock likely cleared since. Anything with another code (a full disk, a changed list) waits for the person.
  if (receipt.stopped?.code && !AUTO_LOCK_CODES.has(receipt.stopped.code)) return null;
  try {
    return await resumeMove(w);
  } catch {
    // The failure kept its reason in the receipt (writeStopped): the Systems page says it, with Carry on.
    return null;
  }
}

/** One Undo: every folded note back where it was, byte for byte, and the move's rows taken out. Rows
 *  the person changed since (typed into, or fixed in the list) stay with their changes, and their folded
 *  copies stay in the Bin; a note already back word for word counts as back, so a retry names only
 *  what is still missing. */
export async function undoMove(w: WorkModules): Promise<string> {
  return guardMoveLocked(w, async () => {
    await requireRoot(w);
    const receipt = await readReceipt(w);
    if (!receipt || (receipt.phase !== 'done' && receipt.phase !== 'moves' && receipt.moved.length === 0)) return 'Nothing to put back.';
    const root = w.d.vault().root;
    const bin = createVaultBin({ root });
    const items = await bin.list();
    const plannedOf = (kind: SystemsTableKind): Set<string> => new Set(receipt.planned.filter((p) => p.kind === kind).map((p) => p.name.toLowerCase()));
    const beforeOf = (kind: SystemsTableKind): Set<string> => new Set((receipt.preRows[kind] ?? []).map((n) => n.toLowerCase()));
    // Rows the person changed since the move stay with their changes (a row pointing at a note of its own
    // among them: typing made it a note, and the note is the record now).
    const keepRows = new Set<string>();
    for (const kind of TYPES as SystemsTableKind[]) {
      const read = await readTable(w, kind).catch(() => null);
      if (!read) continue;
      const planned = plannedOf(kind);
      const before = beforeOf(kind);
      for (const row of read.doc.rows) {
        const key = row.name.toLowerCase();
        if (!planned.has(key) || before.has(key)) continue;
        const now = sha(JSON.stringify({ cells: row.cells, logs: read.doc.logs[key] ?? [], runs: read.doc.runs[key] ?? [] }));
        const was = receipt.rowSig?.[kind]?.[key];
        if (row.note || (was !== undefined && was !== now)) keepRows.add(`${kind}|||${key}`);
      }
    }
    const failed: string[] = [];
    const kept: string[] = [];
    let back = 0;
    for (const m of [...receipt.moved].reverse()) {
      const entry = receipt.planned.find((p) => p.rel === m.rel);
      const name = entry?.name ?? m.rel;
      if (entry && keepRows.has(`${entry.kind}|||${entry.name.toLowerCase()}`)) {
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
        w.d.index.set(r.restored, text, 0, text.length);
        back++;
      } catch {
        failed.push(m.rel);
      }
    }
    // The move's rows out (rows the person added since stay, rows they changed since stay changed, and rows
    // for notes they moved themselves stay: the note was never folded, and the row is the record's safety net).
    const personMoved = new Set((receipt.kept ?? []).map((p) => `${p.kind}|||${p.name.toLowerCase()}`));
    for (const kind of TYPES as SystemsTableKind[]) {
      const read = await readTable(w, kind).catch(() => null);
      if (!read) continue;
      const planned = plannedOf(kind);
      const before = beforeOf(kind);
      const drop = read.doc.rows.filter((r) => planned.has(r.name.toLowerCase()) && !before.has(r.name.toLowerCase()) && !keepRows.has(`${kind}|||${r.name.toLowerCase()}`) && !personMoved.has(`${kind}|||${r.name.toLowerCase()}`)).map((r) => r.name);
      if (drop.length) {
        const rows = read.doc.rows.filter((r) => !drop.map((d) => d.toLowerCase()).includes(r.name.toLowerCase()));
        const logs = { ...read.doc.logs };
        const runs = { ...read.doc.runs };
        for (const d of drop) {
          delete logs[d.toLowerCase()];
          delete runs[d.toLowerCase()];
        }
        await writeTable(w, kind, { ...read.doc, rows, logs, runs });
      }
    }
    if (failed.length) {
      const zip = receipt.backup ? ` The backup zip still has everything: ${receipt.backup.zip}.` : '';
      throw new Error(`${failed.length === 1 ? '1 note had' : `${failed.length} notes had`} already left the Bin, so ${failed.length === 1 ? 'it stays' : 'they stay'} out: ${failed.slice(0, 4).join(', ')}${failed.length > 4 ? ' and others' : ''}.${zip}`);
    }
    await clearReceipt(w);
    await w.setOptions('systems', { settings: { recordsMove: 'deferred' } } as unknown as Parameters<WorkModules['setOptions']>[1]);
    if (!back && kept.length) return kept.length === 1 ? `“${kept[0]}” you changed since stays in the list with your changes. Nothing else moved, so there is nothing to put back.` : `The ${kept.length} records you changed since stay in the lists with your changes. Nothing else moved, so there is nothing to put back.`;
    const base = back === 1 ? 'Put 1 note back where it was, word for word.' : `Put ${back} notes back where they were, word for word.`;
    if (!kept.length) return base;
    return kept.length === 1 ? `${base} “${kept[0]}” you changed since stays in the list with your changes (its folded copy stays in the Bin).` : `${base} ${kept.length} you changed since stay in the lists with your changes (their folded copies stay in the Bin).`;
  });
}

// ── State for the page ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface MoveState {
  offer: boolean;
  deferred: boolean;
  done: { at: string; folded: number; backup: string } | null;
  interrupted: boolean;
  undoable: boolean;
  pcsBlock: PcsBlock | null;
  counts: { fold: number; stay: number };
  /** Lists the move wrote that are gone now (deleted by hand or by sync), said on the Systems page. */
  missingLists: string[];
  /** The missing lists said in plain words, with the Undo or the backup offered. */
  missingWords: string[];
  /** Whether the backup zip is still on this PC. */
  backupExists: boolean;
  /** Whatever stopped the run, in plain words for the Systems page (with Carry on). */
  stoppedWords: string[];
}

/** Lists the move wrote that are gone now, said plainly, with the Undo or the backup offered. */
export function missingListsWords(missing: string[], undoable: boolean, backup: string, backupExists: boolean): string[] {
  if (!missing.length) return [];
  const names = missing.map((r) => `“${r.split('/').pop() ?? r}”`);
  const gone = missing.length === 1 ? `${names[0]} is gone from your notes.` : `${andWords(names)} are gone from your notes.`;
  if (undoable) return [gone, 'One Undo puts every folded note back word for word. Anything added to the list since may still be in File recovery.'];
  if (backup && backupExists) return [gone, `The backup from the tidy-up still has everything: ${backup}.`];
  return [gone, 'The backup is gone too. The list keeps its history (File recovery).'];
}

/** What the Systems page shows: offered once, resumable when interrupted, quietly done after. */
export async function moveState(w: WorkModules): Promise<MoveState> {
  const receipt = await readReceipt(w);
  const interrupted = !!receipt && receipt.phase !== 'done';
  // Whatever stopped it, in plain words (kept in the receipt when found that way: an interrupted move with no
  // reason means the app closed part way — older receipts too. Never while a move runs: nothing stopped then).
  let stoppedWords: string[] = [];
  if (interrupted && receipt && receipt.phase !== 'done') {
    if (receipt.stopped) {
      stoppedWords = [receipt.stopped.words];
    } else if (!moveRunning) {
      receipt.stopped = { at: new Date().toISOString(), phase: receipt.phase, words: APP_CLOSED_WORDS };
      await writeReceipt(w, receipt).catch(() => undefined);
      stoppedWords = [APP_CLOSED_WORDS];
    }
  }
  let undoable = false;
  let done: MoveState['done'] = null;
  if (receipt?.phase === 'done') {
    const items = await createVaultBin({ root: w.d.vault().root }).list().catch(() => []);
    const have = new Set(items.map((x) => x.id));
    undoable = receipt.moved.length > 0 && receipt.moved.every((m) => have.has(m.binId));
    done = { at: receipt.doneAt ?? receipt.startedAt, folded: receipt.moved.length, backup: receipt.backup?.zip ?? '' };
  }
  const settings = ((await w.options().catch(() => ({}))) as Record<string, { settings?: Record<string, unknown> }>).systems?.settings ?? {};
  const status = settings.recordsMove;
  // Lists the move wrote that are gone now (the tables phase wrote all three; only a move that reached
  // it can miss one, never a vault that never moved).
  let missingLists: string[] = [];
  if (receipt && receipt.phase !== 'backup') {
    for (const kind of TYPES as SystemsTableKind[]) {
      const rel = await tableRelFor(w, kind).catch(() => '');
      if (!rel) continue;
      const live = w.d.index.content(rel);
      const there = live !== undefined || await fsp.stat(path.join(w.d.vault().root, ...rel.split('/'))).then(() => true, () => false);
      if (!there) missingLists.push(rel);
    }
  }
  const backupZip = receipt?.backup?.zip ?? done?.backup ?? '';
  const backupExists = backupZip ? await fsp.stat(backupZip).then(() => true, () => false) : false;
  // Undo puts back from a finished move and from a half-done one with notes already in the Bin.
  undoable = undoable || (interrupted && (receipt?.moved.length ?? 0) > 0);
  const plan = await planMove(w).catch((): MovePlan => ({ fold: [], stay: [], clash: null, pcsBlock: null, stalePcs: [], unreadable: [], tables: { machine: '', service: '', runbook: '' } }));
  return {
    offer: !done && !interrupted && status !== 'deferred' && status !== 'done' && plan.fold.length > 0,
    deferred: status === 'deferred',
    done,
    interrupted,
    undoable,
    pcsBlock: plan.pcsBlock,
    counts: { fold: plan.fold.length, stay: plan.stay.length },
    missingLists,
    missingWords: missingListsWords(missingLists, undoable, backupZip, backupExists),
    backupExists,
    stoppedWords,
  };
}

/** Put away for now (the offer was made once; the lists still work and the move waits). */
export async function deferMove(w: WorkModules): Promise<string> {
  await w.setOptions('systems', { settings: { recordsMove: 'deferred' } } as unknown as Parameters<WorkModules['setOptions']>[1]);
  return 'Left as it is. The tidy-up stays on the Systems page for when you want it.';
}
