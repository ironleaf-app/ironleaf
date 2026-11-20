// The paired-sources engine (V9, 28 Oct 2026; the model in src/shared/pairing/types.ts): reads an export from another app
// (a file, a folder or a zip of either), says what it will bring in, and brings it in so that nothing the person changed
// is ever overwritten silently. Used by Ironleaf's Import screen (src/main/pairing/service.ts) and, built into the former
// host app's desktop plugin as vault-import.mjs, by the vault_import tool the former host app and a chat bot call. Only
// Node's own modules: nothing here needs Electron.
//
// Each item is a note. The first time, it is written at "<From App>/<its folders>/<its name>.md" (a journal page at the
// vault's daily note for its day), its pictures and files beside it in its Files folder, links between items made into
// vault links. What was agreed is recorded per item in .neuralvault/pairs/<pair>.json: where the note is, a fingerprint
// of the source's words ("remote") and of the words written ("local"). Next time, for each item:
//   - the note is gone from the vault (and not moved elsewhere, which its source-id finds): left out, never brought back;
//   - the person didn't change it: brought up to date when the source changed (the words before kept in File recovery);
//   - the person changed it and the source didn't: kept as it is;
//   - both changed: kept as it is, and the source's words written beside it as "<name> (from App, day).md", which links
//     back to it, so the two can be compared ("Show the difference" on the Import screen).
// A journal page whose day already had a note of the person's is combined into it (the person's words first, the
// journal's under "Merged from App"), never replaced. Files follow the same rules; nothing is ever deleted.
//
// Told first, taken back whole (v4-no-clutter item 2, 5 Nov 2026): more than a handful of new notes holds for
// confirmation ("this will add 14 notes, from the check just now"), and every run keeps a take-back record in the
// pair's file, so one Undo (undoImport) moves everything it made to the Bin and restores everything it changed.

import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import nodePath from 'node:path';
import { changeProps, readProps, type PropValue } from '../../shared/frontmatter';
import { filesFolderFor } from '../../shared/file-records';
import { mergeNote } from '../../shared/vault-merge';
import { SOURCE_APPS, sourceHow, pairDay, planWords, summaryWords, type PairListed, type PairPlan, type PairProgress, type PairRunUndo, type PairSummary, type SourceKind, type FileKind } from '../../shared/pairing/types';
import { writeView } from '../../shared/views';
import { cleanFileName } from '../../shared/paths';
import { extractZip, zipItems } from '../zip';
import { readEnex } from './enex';
import { isKeepNote, keepFolder, readKeep } from './keep';
import { looksLikeNotion, readNotion } from './notion';
import { isLogseqGraph, isRoamExport, readLogseq, readRoam } from './outliner';
import { isReadwiseCsv, readReadwise } from './readwise';
import { listRoamSiblings } from './roam-assets';
import { bytesHash, fileSafe, isoDay, textHash, TOKEN, type SourceItem, type SourceRead } from './source';

export const PAIRS_DIR = '.neuralvault/pairs';

/** More new notes than this says so first and waits ("this will add 14 notes, from the check just now"). */
export const SAYS_FIRST_OVER = 10;
/** A changed note's words before are kept for Undo up to this size (bigger: File recovery has them, and Undo says so). */
const UNDO_BEFORE_CAP = 262144;
/** A replaced file's bytes before are kept for Undo up to this size. */
const UNDO_FILE_CAP = 1048576;

export interface PairSource {
  plan: PairPlan;
  read: SourceRead;
  /** Read live through the former host app (its record says so, for Paired sources). */
  live?: boolean;
  /** The temporary folder a zip was unpacked into: removed. */
  done(): Promise<void>;
}

export interface ReadOptions {
  /** The app the person said it is from (the screen's choice, the tool's `kind`); checked against what the files hold. */
  kind?: FileKind;
  /** Where a zip is unpacked (a folder of Ironleaf's or the former host app's own). */
  tempDir: string;
}

/** A large import stopped by the person (9.5 F1): the screen or tool flips `stopped`, the engine finishes its
 *  current note and returns what came in so far. Writes stay atomic per file, so no half note is ever left. */
export interface PairSignal { stopped: boolean }

export interface ImportOptions {
  /** The vault's daily notes (Ironleaf's settings), for journal pages: folder and file name ("YYYY-MM-DD"). */
  daily?: { folder: string; format: string };
  /** A note about to change, with its words before (for File recovery). */
  beforeChange?(rel: string, before: string): void | Promise<void>;
  /** Any file about to be written or made, by its whole path (the former host app keeps it for Rewind). */
  beforeWrite?(abs: string): void | Promise<void>;
  /** A two-way source's sending back: given a note only the person changed, send its change to the source and update
   *  `item` to what the source holds now; true when the source took it. */
  push?(change: { id: string; rel: string; mine: string; props: Record<string, PropValue>; item: SourceItem; idOfLink(value: string): string | null }): Promise<boolean | { text: string }>;
  /** Items whose change at the source was this sync's own (the person's changes sent back just before this read): the
   *  source's words now are taken as agreed, never as a change on both sides. */
  pushed?: Set<string>;
  /** Progress as it goes (the screen's bar). */
  onProgress?(p: PairProgress): void;
  /** Stopping halfway (checked between notes, files and views). */
  signal?: PairSignal;
  now?: Date;
  /** The check's signature from the plan just shown (readCheck): a big batch is brought in only with it. */
  confirmed?: string;
}

interface ItemState {
  rel: string;
  remote: string;
  local: string;
  merged?: boolean;
}
interface PairState {
  version: 1;
  id: string;
  kind: SourceKind;
  name: string;
  into: string;
  sourceFile: string;
  live?: boolean;
  /** Paused by the person (V9): bringing in or sending back waits until they resume it. Notes stay as they are. */
  paused?: boolean;
  /** Disconnected by the person (V9): the pairing is over. What came in stays in the vault; the record is kept only
   *  so a later connect of the same source knows those notes, and it is never listed as a live pairing. */
  disconnected?: boolean;
  firstRun: string;
  lastRun: string;
  items: Record<string, ItemState>;
  files: Record<string, { rel: string; hash: string }>;
  views: Record<string, { rel: string; hash: string }>;
  /** The last runs' take-back records (v4-no-clutter item 2); old records simply have none. */
  runs?: PairRunUndo[];
}

const exists = (p: string) => fsp.stat(p).then(() => true, () => false);
const absOf = (root: string, rel: string) => nodePath.join(root, ...rel.split('/'));

async function writeAtomic(abs: string, data: string | Buffer): Promise<void> {
  await fsp.mkdir(nodePath.dirname(abs), { recursive: true });
  const tmp = `${abs}.${randomUUID().slice(0, 8)}.nvtmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, abs);
}

const isInside = (child: string, parent: string) => {
  const rel = nodePath.relative(nodePath.resolve(parent), nodePath.resolve(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel));
};

/** A note's words for equality: the import's own bookkeeping lines aside (F15: renaming the export file changes
 *  `source-file`/`source-id` but not the words, so a renamed re-import is agreed, never a conflict). */
const stripBookkeeping = (s: string) => s.replace(/^(source|source-file|source-id|imported|synced|conflict-of):.*\r?\n/gm, '');
const wordsHash = (s: string) => textHash(stripBookkeeping(s));

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A zip unpacked (and the zips inside it, as Notion's big exports come), into a fresh temporary folder. */
async function unpack(file: string, tempDir: string): Promise<{ folder: string; skipped: { what: string; why: string }[]; cleanup(): Promise<void> }> {
  await zipItems(file); // a plain refusal when it isn't a zip
  const temp = nodePath.join(tempDir, `pair-${randomUUID().slice(0, 8)}`);
  await fsp.mkdir(temp, { recursive: true });
  const cleanup = () => fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
  const skipped: { what: string; why: string }[] = [];
  try {
    const free = await fsp.statfs(tempDir).then((s) => Number(s.bavail) * Number(s.bsize), () => undefined);
    const { files } = await extractZip(file, temp, { maxBytes: free });
    for (const inner of files.filter((f) => /\.zip$/i.test(f))) {
      const abs = absOf(temp, inner);
      // An inner file that merely isn't a zip is dropped; one that is damaged is said (F16), never swallowed.
      const items = await zipItems(abs).catch((err: unknown) => err as Error);
      if (items instanceof Error) {
        if (!/isn’t a zip file/.test(items.message)) skipped.push({ what: inner.split('/').pop() ?? inner, why: 'it couldn’t be unpacked' });
        await fsp.rm(abs, { force: true });
        continue;
      }
      const unpacked = await extractZip(abs, abs.replace(/\.zip$/i, ''), { maxBytes: free }).catch((err: unknown) => err as Error);
      if (unpacked instanceof Error) skipped.push({ what: inner.split('/').pop() ?? inner, why: 'it couldn’t be unpacked' });
      await fsp.rm(abs, { force: true });
    }
    // A zip holding one folder is that folder.
    const top = (await fsp.readdir(temp, { withFileTypes: true })).filter((e) => e.name !== '__MACOSX' && !e.name.startsWith('.'));
    return { folder: top.length === 1 && top[0].isDirectory() ? nodePath.join(temp, top[0].name) : temp, skipped, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

const stemOf = (p: string) => nodePath.basename(p).replace(/\.[^.]+$/, '');

/** What a file or folder holds, and its items. */
async function readAny(path: string, isFile: boolean, sourceFile: string): Promise<SourceRead | null> {
  if (isFile) {
    if (/\.enex$/i.test(path)) {
      const { items, skipped } = readEnex(await fsp.readFile(path, 'utf8'), stemOf(path));
      return { kind: 'evernote', name: stemOf(path), items, views: [], skipped };
    }
    if (/\.csv$/i.test(path)) {
      const text = await fsp.readFile(path, 'utf8');
      return isReadwiseCsv(text) ? readReadwise(text) : null;
    }
    if (/\.json$/i.test(path)) {
      const j = await fsp.readFile(path, 'utf8').then((t) => JSON.parse(t) as unknown, () => null);
      // A Roam export with its siblings beside it (10.0 item 16): pictures and files resolve against them.
      if (isRoamExport(j)) return readRoam(j, stemOf(path), await listRoamSiblings(nodePath.dirname(path)));
      if (isKeepNote(j)) return readKeep(nodePath.dirname(path)).then((r) => ({ ...r, items: r.items.filter((i) => i.id.includes(stemOf(path).toLowerCase()) || r.items.length === 1) }));
    }
    return null;
  }
  if (await isLogseqGraph(path)) return readLogseq(path);
  if (await keepFolder(path)) return readKeep(path);
  const names = await fsp.readdir(path).catch(() => [] as string[]);
  const enex = names.filter((n) => /\.enex$/i.test(n));
  if (enex.length) {
    // Several notebooks: one folder each.
    const items: SourceItem[] = [];
    const skipped: SourceRead['skipped'] = [];
    for (const n of enex.sort()) {
      const r = readEnex(await fsp.readFile(nodePath.join(path, n), 'utf8'), stemOf(n));
      items.push(...r.items.map((i) => ({ ...i, folder: enex.length > 1 ? fileSafe(stemOf(n)) : i.folder })));
      skipped.push(...r.skipped);
    }
    return { kind: 'evernote', name: enex.length === 1 ? stemOf(enex[0]) : sourceFile, items, views: [], skipped };
  }
  const deep: string[] = [];
  const walk = async (rel: string, depth: number) => {
    if (depth > 6 || deep.length > 400) return;
    for (const e of await fsp.readdir(rel ? absOf(path, rel) : path, { withFileTypes: true }).catch(() => [])) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && !e.name.startsWith('.')) await walk(r, depth + 1);
      else if (e.isFile()) deep.push(r);
    }
  };
  await walk('', 0);
  if (looksLikeNotion(deep)) return readNotion(path);
  for (const n of names) {
    if (/\.json$/i.test(n) || /\.csv$/i.test(n)) {
      const r = await readAny(nodePath.join(path, n), true, sourceFile);
      if (r) return r;
    }
  }
  return null;
}

const pairIdOf = (kind: SourceKind, into: string) => `${kind}-${into.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`.slice(0, 80);

/** What bringing `source` in will do (nothing is written). A zip is unpacked first, into `tempDir`. */
export async function readSource(source: string, vaultRoot: string, o: ReadOptions): Promise<PairSource> {
  const st = await fsp.stat(source).catch(() => null);
  if (!st) throw new Error('That file or folder can’t be opened.');
  if (st.isDirectory() && (isInside(source, vaultRoot) || isInside(vaultRoot, source))) throw new Error('That folder is this vault, or is inside it. Choose the export from the other app.');
  let path = source;
  let isFile = st.isFile();
  let cleanup = async () => {};
  let unpackSkipped: { what: string; why: string }[] = [];
  const sourceFile = nodePath.basename(source);
  if (isFile && /\.zip$/i.test(source)) {
    const u = await unpack(source, o.tempDir);
    path = u.folder;
    isFile = false;
    cleanup = u.cleanup;
    unpackSkipped = u.skipped;
  }
  try {
    const read = await readAny(path, isFile, stemOf(source));
    if (read && unpackSkipped.length) read.skipped.unshift(...unpackSkipped);
    const want = o.kind;
    if (!read || (want && read.kind !== want)) {
      const how = want ? ` ${sourceHow(want).how}` : '';
      throw new Error(want ? `That doesn’t look like ${/^[aeiou]/i.test(SOURCE_APPS[want]) ? 'an' : 'a'} ${SOURCE_APPS[want]} export.${how}` : 'Ironleaf can’t tell which app that came from. It reads exports from Evernote (.enex), Notion (.zip), Google Keep (Takeout), Readwise (.csv), Logseq (a graph folder) and Roam (.json).');
    }
    const name = read.kind === 'notion' ? (stemOf(source).startsWith('Export-') ? '' : read.name) : read.name;
    return { plan: await planOf(vaultRoot, read, { sourceFile, name }), read, done: cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/** What bringing `read` in will do: where it goes, how many notes and files, whether it came in before. */
export async function planOf(vaultRoot: string, read: SourceRead, o: { sourceFile: string; name?: string; into?: string }): Promise<PairPlan> {
  const app = SOURCE_APPS[read.kind];
  const name = o.name ?? read.name;
  const into = o.into ?? `From ${app}${name ? `/${fileSafe(name)}` : ''}`;
  const state = await loadState(vaultRoot, pairIdOf(read.kind, into));
  const kept = read.items.filter((i) => !itemEmpty(i));
  const leftOut = read.items.filter((i) => itemEmpty(i));
  const notes = kept.filter((i) => !i.day);
  const plan: Omit<PairPlan, 'words'> = {
    kind: read.kind,
    app,
    name: read.name,
    sourceFile: o.sourceFile,
    into,
    notes: notes.length,
    files: kept.reduce((s, i) => s + i.files.length, 0),
    views: read.views.length,
    daily: kept.length - notes.length,
    sample: kept.slice(0, 6).map((i) => i.title),
    skipped: [...read.skipped, ...leftOut.map((i) => ({ what: i.title.trim() || i.id, why: 'Empty: nothing to bring in' }))],
    again: state ? { lastRun: pairDay(new Date(state.lastRun)), notes: Object.keys(state.items).length } : null,
  };
  return { ...plan, words: planWords(plan) };
}

/** Whether an item has nothing to bring in: no words in its title, body or properties, and no files. Database rows
 *  carry their properties, and a named stub keeps its name: only the truly blank is left out (v4-no-clutter item 3). */
function itemEmpty(item: SourceItem): boolean {
  if (item.files.length) return false;
  if (WORDY.test(item.title) || WORDY.test(item.body)) return false;
  return !Object.values(item.props).some((v) => typeof v === 'string' && WORDY.test(v));
}
const WORDY = /[\p{L}\p{N}]/u;

/** A source read live by the former host app (Notion, Todoist, Readwise through the person's own token; V10, V11): the
 *  same plan and the same rules as an export, nothing to unpack. */
export async function liveSource(vaultRoot: string, read: SourceRead, o: { sourceFile: string; into: string }): Promise<PairSource> {
  return { plan: await planOf(vaultRoot, read, o), read, live: true, done: async () => {} };
}

/** A read's signature for the check just now: what the plan showed, so bringing it in with a changed source holds again. */
export function readCheck(plan: PairPlan, read: SourceRead): string {
  return textHash(JSON.stringify([plan.kind, plan.into, plan.sourceFile, read.items.map((i) => [i.id, i.title, i.folder, textHash(i.body), i.day ?? '', i.files.map((f) => f.key), textHash(JSON.stringify(i.props))]), read.views.map((v) => [v.name, v.folder, textHash(JSON.stringify(v.def))])]));
}

/** The id of the pair a source and its folder make (its record is .neuralvault/pairs/<id>.json). */
export const pairIdFor = (kind: SourceKind, into: string): string => pairIdOf(kind, into);

/** What was last agreed with a source (null when it never came in). */
export async function readPairState(root: string, id: string): Promise<{ into: string; lastRun: string; items: Record<string, { rel: string; remote: string; local: string; merged?: boolean }> } | null> {
  const s = await loadState(root, id);
  return s ? { into: s.into, lastRun: s.lastRun, items: s.items } : null;
}

/**
 * The notes of a pair the person changed since they were last agreed with the source (their words now), for a two-way
 * source to send back: a note only the person changed goes to the source, then the next read brings the source's answer
 * back as agreed (importSource's `pushed`). Notes the person removed, and days combined into their own notes, are not.
 */
export async function changedHere(root: string, id: string): Promise<{ id: string; rel: string; text: string }[]> {
  const s = await loadState(root, id);
  if (!s) return [];
  const out: { id: string; rel: string; text: string }[] = [];
  for (const [itemId, it] of Object.entries(s.items)) {
    if (it.merged) continue;
    const text = await fsp.readFile(absOf(root, it.rel), 'utf8').catch(() => null);
    if (text !== null && textHash(text) !== it.local) out.push({ id: itemId, rel: it.rel, text });
  }
  return out;
}

// ── State ────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function loadState(root: string, id: string): Promise<PairState | null> {
  const j = await fsp.readFile(absOf(root, `${PAIRS_DIR}/${id}.json`), 'utf8').then((t) => JSON.parse(t) as PairState, () => null);
  return j && j.version === 1 && j.items ? j : null;
}

/** Every source brought into this vault, most recent first. A disconnected pairing is not listed: it is over. */
export async function listPairs(root: string): Promise<PairListed[]> {
  const out: PairListed[] = [];
  for (const n of await fsp.readdir(absOf(root, PAIRS_DIR)).catch(() => [] as string[])) {
    if (!/\.json$/.test(n)) continue;
    const s = await loadState(root, n.replace(/\.json$/, ''));
    if (!s || s.disconnected) continue;
    const last = s.runs?.filter((r) => !r.undone).pop();
    const takeBack = last && (last.added.length || last.beside.length || last.updated.length || last.files.length || last.filesBack.length || last.views.length || last.viewsBack.length) ? { at: last.at, notes: last.added.length + last.beside.length + last.updated.length } : undefined;
    out.push({ ...(s.live ? { live: true } : {}), ...(s.paused ? { paused: true } : {}), id: s.id, kind: s.kind, app: SOURCE_APPS[s.kind] ?? s.kind, name: s.name, into: s.into, sourceFile: s.sourceFile, firstRun: s.firstRun, lastRun: s.lastRun, notes: Object.keys(s.items).length, ...(takeBack ? { undoable: takeBack } : {}) });
  }
  return out.sort((a, b) => b.lastRun.localeCompare(a.lastRun));
}

/** Pause or resume a pairing (V9). Pausing changes nothing that came in; it only stops the next sync. */
export async function setPairPaused(root: string, id: string, paused: boolean): Promise<void> {
  const s = await loadState(root, id);
  if (!s || s.disconnected) throw new Error('That pairing is not there any more.');
  s.paused = paused || undefined;
  await writeAtomic(absOf(root, `${PAIRS_DIR}/${id}.json`), `${JSON.stringify(s, null, 1)}\n`);
}

/** End a pairing (V9): what came in stays in the vault, untouched. The record stays, marked ended, only so that
 *  connecting the same source again later still knows its notes and never overwrites what the person changed. */
export async function disconnectPair(root: string, id: string): Promise<void> {
  const s = await loadState(root, id);
  if (!s) throw new Error('That pairing is not there any more.');
  s.disconnected = true;
  s.paused = undefined;
  await writeAtomic(absOf(root, `${PAIRS_DIR}/${id}.json`), `${JSON.stringify(s, null, 1)}\n`);
}

// ── Bringing it in ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The vault's daily note for a day ("Daily/2026-10-28.md"). */
export function dailyRel(day: string, daily: { folder: string; format: string } = { folder: 'Daily', format: 'YYYY-MM-DD' }): string {
  const [y, m, d] = day.split('-');
  const stamp = (daily.format || 'YYYY-MM-DD').replace(/YYYY/g, y).replace(/MM/g, m).replace(/DD/g, d).replace(/[\\:*?"<>|]/g, '-');
  // Each level a name Windows keeps (a dated format may nest: YYYY/MM/DD stays nested); dot levels never survive.
  const levels = (s: string) => s.replace(/\\/g, '/').split('/').map((p) => cleanFileName(p, '', 80)).filter((p) => p && p !== '.' && p !== '..');
  const folder = levels(daily.folder || '').join('/');
  const name = levels(stamp).join('/') || levels(day).join('/') || 'Daily note';
  return `${folder ? `${folder}/` : ''}${name}.md`;
}

/** What one walk of the vault finds (F27): existing notes by name (for find-before-create) and notes from this
 *  source by their source-id (a note the person moved is found where it is now). Built once per import, lazily. */
interface VaultIndex {
  byTitle: Map<string, string[]>;
  bySourceId: Map<string, string>;
}

/** A unique place: "Name.md", else "Name 2.md"… (case ignored, against `taken` and the files there). */
async function freeRel(root: string, rel: string, taken: Set<string>): Promise<string> {
  const ext = /\.[^./]+$/.exec(rel)?.[0] ?? '';
  const stem = rel.slice(0, rel.length - ext.length);
  for (let n = 1; ; n++) {
    const r = n === 1 ? rel : `${stem} ${n}${ext}`;
    if (!taken.has(r.toLowerCase()) && !(await exists(absOf(root, r)))) return r;
  }
}

const linkPath = (rel: string) => rel.replace(/\.md$/i, '');

/** Brings what `src` read into the vault at `root`, as the rules at the top say. */
export async function importSource(root: string, src: PairSource, o: ImportOptions = {}): Promise<PairSummary> {
  const { plan, read } = src;
  const now = o.now ?? new Date();
  const today = isoDay(now);
  const id = pairIdOf(plan.kind, plan.into);
  const old = await loadState(root, id);
  if (old?.paused) throw new Error(`This pairing with ${plan.app} is paused. Resume it to bring anything in or send anything back.`);
  const state: PairState = old ?? { version: 1, id, kind: plan.kind, name: plan.name, into: plan.into, sourceFile: plan.sourceFile, firstRun: now.toISOString(), lastRun: now.toISOString(), items: {}, files: {}, views: {} };
  state.lastRun = now.toISOString();
  state.sourceFile = plan.sourceFile;
  state.disconnected = undefined; // Bringing it in again is connecting it again.
  if (src.live) state.live = true;
  const summary: Omit<PairSummary, 'words'> = { kind: plan.kind, app: plan.app, into: plan.into, pairId: id, added: 0, updated: 0, same: 0, keptYours: 0, removedHere: 0, conflicts: [], files: 0, views: 0, skipped: [...plan.skipped], written: [] };
  /** The pages with something in them; the blank ones were left out in the plan, and stay out here. */
  const live = read.items.filter((i) => !itemEmpty(i));
  const taken = new Set<string>();
  /** Every file written goes through here, so the former host app's Rewind can take the import back. */
  const put = async (abs: string, data: string | Buffer) => {
    await o.beforeWrite?.(abs);
    await writeAtomic(abs, data);
  };
  /** This run's take-back record: everything made or changed, for one Undo. */
  const run: PairRunUndo = { at: now.toISOString(), added: [], beside: [], updated: [], files: [], filesBack: [], views: [], viewsBack: [] };
  const keepBefore = (mine: string): { before: string | null; tooBig?: boolean } => (mine.length > UNDO_BEFORE_CAP ? { before: null, tooBig: true } : { before: mine });
  const finishRun = () => {
    // A run that changed nothing keeps no record: there is nothing to take back, and Undo still reaches the last
    // run that did something.
    const content = run.added.length + run.beside.length + run.updated.length + run.files.length + run.filesBack.length + run.views.length + run.viewsBack.length;
    if (!content) return;
    state.runs = [...(state.runs ?? []), run].slice(-10);
    summary.undoable = { notes: run.added.length + run.beside.length + run.updated.length, files: run.files.length + run.views.length };
  };
  /** Stopped halfway (F1): what was agreed is saved, so bringing it in again continues instead of duplicating; what
   *  came in is still taken back whole. */
  const stopHere = async (): Promise<PairSummary> => {
    run.stopped = true;
    finishRun();
    await writeAtomic(absOf(root, `${PAIRS_DIR}/${id}.json`), `${JSON.stringify(state, null, 1)}\n`);
    return { ...summary, stopped: true, words: summaryWords({ ...summary, stopped: true }) };
  };
  let index: VaultIndex | null = null;
  /** One walk finds both (F27): notes by name for find-before-create (9.2), and this source's notes by source-id. */
  const vaultIndex = async (): Promise<VaultIndex> => {
    if (index) return index;
    o.onProgress?.({ phase: 'indexing', done: 0, total: 1 });
    const byTitle = new Map<string, string[]>();
    const bySourceId = new Map<string, string>();
    const owned = new Set(Object.values(state.items).map((s) => s.rel.toLowerCase()));
    const walk = async (rel: string, depth: number) => {
      if (depth > 30) return;
      for (const e of await fsp.readdir(rel ? absOf(root, rel) : root, { withFileTypes: true }).catch(() => [])) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(r, depth + 1);
        else if (e.isFile() && /\.md$/i.test(e.name)) {
          if (!owned.has(r.toLowerCase())) {
            const key = e.name.replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            if (key) byTitle.set(key, [...(byTitle.get(key) ?? []), r]);
          }
          const fh = await fsp.open(absOf(root, r), 'r').catch(() => null);
          if (!fh) continue;
          const buf = Buffer.alloc(4096);
          const { bytesRead } = await fh.read(buf, 0, 4096, 0).finally(() => fh.close());
          const head = buf.subarray(0, bytesRead).toString('utf8');
          if (!head.includes('source-id')) continue;
          const props = readProps(head.includes('\n---', 3) ? head : '');
          if (props.source === plan.app && typeof props['source-id'] === 'string') bySourceId.set(props['source-id'], r);
        }
      }
    };
    await walk('', 0);
    o.onProgress?.({ phase: 'indexing', done: 1, total: 1 });
    return (index = { byTitle, bySourceId });
  };

  // 1. Where each note goes (so links between them can be written).
  const relOf = new Map<string, string>();
  const gone = new Set<string>();
  for (const item of live) {
    const had = state.items[item.id];
    if (had) {
      if (await exists(absOf(root, had.rel))) {
        relOf.set(item.id, had.rel);
        taken.add(had.rel.toLowerCase());
        continue;
      }
      const at = (await vaultIndex()).bySourceId.get(item.id);
      if (at) {
        had.rel = at;
        relOf.set(item.id, at);
        taken.add(at.toLowerCase());
      } else gone.add(item.id);
      continue;
    }
    if (item.day) {
      const rel = dailyRel(item.day, o.daily);
      relOf.set(item.id, rel);
      taken.add(rel.toLowerCase());
      continue;
    }
    const want = `${plan.into}/${item.folder ? `${item.folder}/` : ''}${fileSafe(item.title)}.md`;
    // Find before create (9.2): the one existing note with this name, anywhere in the vault, is adopted; the
    // usual both-changed rules then keep the person's words and put the source's beside them. Only a name with
    // no home, or several homes, gets a fresh place under the import folder.
    const key = fileSafe(item.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const homes = key ? ((await vaultIndex()).byTitle.get(key) ?? []).filter((r) => !taken.has(r.toLowerCase())) : [];
    if (homes.length === 1 && homes[0].toLowerCase() !== want.toLowerCase()) {
      relOf.set(item.id, homes[0]);
      taken.add(homes[0].toLowerCase());
      continue;
    }
    // A note of this name already here that isn't one of this source's: a fresh name beside it.
    const rel = taken.has(want.toLowerCase()) || ((await exists(absOf(root, want))) && !Object.values(state.items).some((s) => s.rel.toLowerCase() === want.toLowerCase())) ? await freeRel(root, want, taken) : want;
    relOf.set(item.id, rel);
    taken.add(rel.toLowerCase());
  }
  // Each file's place: in its note's Files folder.
  const fileRel = new Map<string, string>();
  const fileTaken = new Set<string>();
  for (const item of live) {
    const noteRel = relOf.get(item.id);
    if (!noteRel) continue;
    for (const f of item.files) {
      if (fileRel.has(f.key)) continue;
      const had = state.files[f.key];
      if (had) {
        fileRel.set(f.key, had.rel);
        fileTaken.add(had.rel.toLowerCase());
        continue;
      }
      const want = `${filesFolderFor(noteRel)}/${fileSafe(f.name, 'File')}`;
      let rel = want;
      if (fileTaken.has(want.toLowerCase()) || (await exists(absOf(root, want)))) {
        // An adopted note's file already here with the same bytes (F15): reuse it, never " 2" beside it.
        const same = !fileTaken.has(want.toLowerCase()) && await (async () => {
          try {
            const data = f.data ?? (f.abs ? await fsp.readFile(f.abs) : null);
            if (!data) return false;
            const there = await fsp.readFile(absOf(root, want)).catch(() => null);
            return !!there && bytesHash(there) === bytesHash(data);
          } catch {
            return false;
          }
        })();
        rel = same ? want : await freeRel(root, want, fileTaken);
      }
      fileRel.set(f.key, rel);
      fileTaken.add(rel.toLowerCase());
    }
  }
  const titleOf = new Map(live.map((i) => [i.id, i.title]));
  /** Link tokens made into vault links (an item not brought in: its name as words). */
  const resolve = (s: string): string =>
    s.replace(TOKEN, (_, kind: string, target: string, label: string) => {
      if (kind === 'file' || kind === 'embed-file') {
        const rel = fileRel.get(target);
        if (!rel) return label;
        return kind === 'embed-file' ? `![[${rel}]]` : `[[${rel}${label && label !== rel.split('/').pop() ? `|${label}` : ''}]]`;
      }
      const hash = target.indexOf('#');
      const itemId = hash >= 0 ? target.slice(0, hash) : target;
      const frag = hash >= 0 ? target.slice(hash) : '';
      const rel = relOf.get(itemId);
      if (!rel || gone.has(itemId)) return label || titleOf.get(itemId) || '';
      if (kind === 'embed-note') return `![[${linkPath(rel)}${frag}]]`;
      const shown = label || (frag ? '' : titleOf.get(itemId) ?? '');
      return `[[${linkPath(rel)}${frag}${shown && shown !== rel.split('/').pop()!.replace(/\.md$/i, '') ? `|${shown}` : ''}]]`;
    });
  /** A vault link ("[[From Notion/Team/Ana|Ana]]") back to the source's id for it, for sending a relation back. */
  const byRel = new Map([...relOf.entries()].map(([id, rel]) => [linkPath(rel).toLowerCase(), id]));
  const idOfLink = (v: string): string | null => {
    const m = /\[\[([^\]|#]+)/.exec(v);
    return m ? byRel.get(m[1].trim().toLowerCase()) ?? null : null;
  };
  const resolveProp = (v: PropValue): PropValue => (typeof v === 'string' ? resolve(v) : Array.isArray(v) ? v.map(resolveProp) : v);
  const noteText = (item: SourceItem, stamp: { imported: string; synced?: string; conflictOf?: string } | null) =>
    changeProps('', (doc) => {
      for (const [k, v] of Object.entries(item.props)) doc.set(k, doc.createNode(resolveProp(v)));
      doc.set('source', plan.app);
      doc.set('source-file', plan.sourceFile);
      doc.set('source-id', item.id);
      if (stamp) {
        doc.set('imported', stamp.imported);
        if (stamp.synced) doc.set('synced', stamp.synced);
        if (stamp.conflictOf) doc.set('conflict-of', `[[${linkPath(stamp.conflictOf)}]]`);
      }
    }) + resolve(item.body);

  // 1.5. The check: how many notes this run would add, read before anything is written (counting only; phase 2
  // reads again, so a run's own earlier writes are seen). More than a handful without the plan just shown confirmed
  // holds, and says so first.
  let fresh = 0;
  const freshRels = new Set<string>();
  for (const item of live) {
    if (gone.has(item.id)) continue;
    const rel = relOf.get(item.id);
    if (!rel) continue;
    const mine = await fsp.readFile(absOf(root, rel), 'utf8').catch(() => null);
    const had = state.items[item.id];
    if (mine === null) {
      // Two journal pages for one day make one note, not two.
      if (!freshRels.has(rel.toLowerCase())) {
        freshRels.add(rel.toLowerCase());
        fresh++;
      }
      continue;
    }
    /** A copy beside it unless one's already there identical (putBeside's first candidate). */
    const copyFresh = async (): Promise<boolean> => {
      const copy = `${rel.replace(/\.md$/i, '')} (from ${plan.app}, ${pairDay(now)}).md`;
      const there = await fsp.readFile(absOf(root, copy), 'utf8').catch(() => null);
      return there === null || textHash(there) !== textHash(noteText(item, { imported: today, conflictOf: rel }));
    };
    if (!had) {
      if (item.day) continue;
      if (wordsHash(mine) === wordsHash(noteText(item, null))) continue;
      if (await copyFresh()) fresh++;
      continue;
    }
    const remote = textHash(noteText(item, null));
    const localChanged = textHash(mine) !== had.local;
    const remoteChanged = remote !== had.remote;
    if (had.merged) continue;
    if (localChanged && !remoteChanged && o.push) continue;
    if (remoteChanged && o.pushed?.has(item.id)) continue;
    if (remoteChanged && localChanged && wordsHash(mine) === wordsHash(noteText(item, null))) continue;
    if (!remoteChanged || !localChanged) continue;
    if (await copyFresh()) fresh++;
  }
  const check = readCheck(plan, read);
  if (fresh > SAYS_FIRST_OVER && o.confirmed !== check) {
    const held: Omit<PairSummary, 'words'> = { kind: plan.kind, app: plan.app, into: plan.into, pairId: id, added: 0, updated: 0, same: 0, keptYours: 0, removedHere: 0, conflicts: [], files: 0, views: 0, skipped: [...plan.skipped], written: [], held: true, check, fresh, preview: plan.words };
    return { ...held, words: summaryWords(held) };
  }

  // 2. The notes.
  for (let i = 0; i < live.length; i++) {
    const item = live[i];
    if (o.signal?.stopped) return stopHere();
    o.onProgress?.({ phase: 'notes', done: i, total: live.length });
    if (gone.has(item.id)) {
      summary.removedHere++;
      continue;
    }
    const rel = relOf.get(item.id);
    if (!rel) continue;
    let remote = textHash(noteText(item, null));
    const abs = absOf(root, rel);
    const putBeside = async (at: string, _mine: string) => {
      const base = at.replace(/\.md$/i, '');
      const text = noteText(item, { imported: today, conflictOf: at });
      for (let n = 1; ; n++) {
        const copy = `${base} (from ${plan.app}, ${pairDay(now)}${n > 1 ? `, ${n}` : ''}).md`;
        const there = await fsp.readFile(absOf(root, copy), 'utf8').catch(() => null);
        if (there !== null && textHash(there) === textHash(text)) {
          summary.conflicts.push({ rel: at, copy });
          break;
        }
        if (there === null) {
          await put(absOf(root, copy), text);
          run.beside.push(copy);
          summary.conflicts.push({ rel: at, copy });
          break;
        }
      }
      if (!state.items[item.id]) state.items[item.id] = { rel: at, remote, local: textHash(_mine) };
    };

    let mine = await fsp.readFile(abs, 'utf8').catch(() => null);
    const had = state.items[item.id];
    if (mine === null) {
      const text = noteText(item, { imported: today });
      await put(abs, text);
      state.items[item.id] = { rel, remote, local: textHash(text) };
      run.added.push(rel);
      summary.added++;
      summary.written.push(rel);
      continue;
    }
    if (!had) {
      // A day the person already wrote in (a journal page), or a note the source wrote before its record was lost.
      if (item.day) {
        const m = mergeNote(mine, resolve(item.body), plan.app, pairDay(now));
        if (m.changed) {
          await o.beforeChange?.(rel, mine);
          await put(abs, m.text);
          run.updated.push({ rel, ...keepBefore(mine), after: textHash(m.text), remoteBefore: remote, fresh: true });
          summary.updated++;
          summary.written.push(rel);
        } else summary.same++;
        state.items[item.id] = { rel, remote, local: textHash(m.changed ? m.text : mine), merged: true };
        continue;
      }
      const sameWords = wordsHash(mine) === wordsHash(noteText(item, null));
      if (sameWords) {
        state.items[item.id] = { rel, remote, local: textHash(mine) };
        summary.same++;
        continue;
      }
      await putBeside(rel, mine);
      continue;
    }
    const localChanged = textHash(mine) !== had.local;
    let remoteChanged = remote !== had.remote;
    // A two-way source (V10, V11): a note only the person changed is sent back first; the source's answer (the item as it
    // is now) is then agreed below, so the person's change is never overwritten nor kept apart.
    if (localChanged && !remoteChanged && o.push && !had.merged) {
      let sent: boolean | { text: string } = false;
      try {
        sent = await o.push({ id: item.id, rel, mine, props: readProps(mine), item, idOfLink: (v) => idOfLink(v) });
        if (sent && typeof sent === 'object' && typeof sent.text === 'string' && sent.text !== mine) {
          // The source gave the note something to keep (a new task's id on its line): written, the words before kept.
          await o.beforeChange?.(rel, mine);
          await put(abs, sent.text);
          run.updated.push({ rel, ...keepBefore(mine), after: textHash(sent.text), remoteBefore: had.remote });
          mine = sent.text;
        }
      } catch (err) {
        summary.skipped.push({ what: item.title, why: `${plan.app} didn’t take the change: ${String((err as Error)?.message ?? err).slice(0, 160)}` });
      }
      if (sent) {
        summary.sent = (summary.sent ?? 0) + 1;
        remote = textHash(noteText(item, null));
        remoteChanged = remote !== had.remote;
        (o.pushed ??= new Set()).add(item.id);
      }
    }
    const sameWordsNow = () => wordsHash(mine) === wordsHash(noteText(item, null));
    if (remoteChanged && o.pushed?.has(item.id)) {
      // The source took the person's change just now: its words are agreed. The person's note is agreed too when its
      // words are the source's (a body edited here, which a source may not take back, keeps it the person's).
      had.remote = remote;
      had.rel = rel;
      if (sameWordsNow()) had.local = textHash(mine);
      summary.same++;
      continue;
    }
    if (remoteChanged && localChanged && sameWordsNow()) {
      // Changed in both places to the same words: nothing to keep apart.
      had.remote = remote;
      had.local = textHash(mine);
      had.rel = rel;
      summary.same++;
      continue;
    }
    if (!remoteChanged) {
      if (localChanged) summary.keptYours++;
      else summary.same++;
      had.rel = rel;
      continue;
    }
    if (had.merged) {
      const m = mergeNote(mine, resolve(item.body), plan.app, pairDay(now));
      if (m.changed) {
        await o.beforeChange?.(rel, mine);
        await put(abs, m.text);
        run.updated.push({ rel, ...keepBefore(mine), after: textHash(m.text), remoteBefore: had.remote });
        summary.updated++;
        summary.written.push(rel);
      } else summary.same++;
      state.items[item.id] = { rel, remote, local: textHash(m.changed ? m.text : mine), merged: true };
      continue;
    }
    if (!localChanged) {
      const imported = readProps(mine).imported;
      const text = noteText(item, { imported: typeof imported === 'string' ? imported : today, synced: today });
      await o.beforeChange?.(rel, mine);
      await put(abs, text);
      run.updated.push({ rel, ...keepBefore(mine), after: textHash(text), remoteBefore: had.remote });
      state.items[item.id] = { rel, remote, local: textHash(text) };
      summary.updated++;
      summary.written.push(rel);
      continue;
    }
    // Changed here and in the source: the person's note stays; the source's words go beside it.
    await putBeside(rel, mine);
    had.remote = remote;
    had.rel = rel;
  }

  // State is saved as notes are agreed, not only at the end (9.2): a stopped import is picked up by adoption
  // and source-id on the next run instead of duplicating what already came in. Written directly: it is not a note.
  await writeAtomic(absOf(root, `${PAIRS_DIR}/${id}.json`), `${JSON.stringify(state, null, 1)}\n`);
  o.onProgress?.({ phase: 'notes', done: live.length, total: live.length });

  // 3. Pictures and files.
  const allFiles = live.flatMap((i) => (gone.has(i.id) ? [] : i.files));
  const fileKeys = [...new Set(allFiles.map((f) => f.key))];
  const fileByKey = new Map(allFiles.map((f) => [f.key, f]));
  for (let i = 0; i < fileKeys.length; i++) {
    const f = fileByKey.get(fileKeys[i])!;
    if (o.signal?.stopped) return stopHere();
    o.onProgress?.({ phase: 'files', done: i, total: fileKeys.length });
    const rel = fileRel.get(f.key);
    if (!rel) continue;
    const data = f.data ?? (await fsp.readFile(f.abs!).catch(() => null));
    if (!data) {
      summary.skipped.push({ what: f.name, why: 'it couldn’t be read from the export' });
      continue;
    }
    const hash = bytesHash(data);
    const abs = absOf(root, rel);
    const there = await fsp.readFile(abs).catch(() => null);
    const had = state.files[f.key];
    if (there === null) {
      if (had) continue; // removed here: left out
      await put(abs, data);
      state.files[f.key] = { rel, hash };
      run.files.push(rel);
      summary.files++;
      continue;
    }
    const hereHash = bytesHash(there);
    if (hereHash === hash) {
      state.files[f.key] = { rel, hash };
      continue;
    }
    if (had && hash === had.hash) {
      // The person changed it and the source didn't: theirs stays as it is.
      continue;
    }
    if (had && hereHash === had.hash) {
      // Only the source changed it.
      await put(abs, data);
      state.files[f.key] = { rel, hash };
      run.filesBack.push(there.length > UNDO_FILE_CAP ? { rel, before64: null, after: hash, tooBig: true } : { rel, before64: there.toString('base64'), after: hash });
      summary.files++;
      continue;
    }
    // The person's file stays; the source's copy goes beside it.
    const beside = await freeRel(root, rel.replace(/(\.[^./]+)?$/, ` (from ${plan.app})$1`), new Set());
    await put(absOf(root, beside), data);
    run.files.push(beside);
    summary.files++;
    if (!had) state.files[f.key] = { rel, hash };
  }
  if (fileKeys.length) o.onProgress?.({ phase: 'files', done: fileKeys.length, total: fileKeys.length });

  // 4. Views (a Notion database's table or board), beside the folder they show; one the person changed stays theirs.
  for (let i = 0; i < read.views.length; i++) {
    const v = read.views[i];
    if (o.signal?.stopped) return stopHere();
    o.onProgress?.({ phase: 'views', done: i, total: read.views.length });
    const rel = `${plan.into}/${v.folder}.view.json`;
    const def = { ...v.def, source: { kind: 'folder' as const, value: `${plan.into}/${v.folder}` } };
    const text = writeView(def);
    const hash = textHash(text);
    const there = await fsp.readFile(absOf(root, rel), 'utf8').catch(() => null);
    const had = state.views[v.name];
    if (there === null) {
      if (had) continue;
      await put(absOf(root, rel), text);
      run.views.push(rel);
      summary.views++;
    } else if (textHash(there) !== hash && had && textHash(there) === had.hash) {
      await put(absOf(root, rel), text);
      run.viewsBack.push(there.length > UNDO_BEFORE_CAP ? { rel, before: null, after: hash, tooBig: true } : { rel, before: there, after: hash });
      summary.views++;
    } else if (textHash(there) !== hash) continue;
    state.views[v.name] = { rel, hash };
  }

  finishRun();
  await put(absOf(root, `${PAIRS_DIR}/${id}.json`), `${JSON.stringify(state, null, 1)}\n`);
  return { ...summary, words: summaryWords(summary) };
}

/** One Undo for a pair's last run: everything it made goes to the Bin (through `trash`), everything it changed is
 *  restored when untouched since. A note the person changed since stays as they left it, and is said. Never deletes. */
export async function undoImport(root: string, pairId: string, o: { trash(rel: string): Promise<unknown>; beforeWrite?(abs: string): Promise<unknown>; recoveryWords?: string }): Promise<{ words: string; notes: number; files: number; restored: number; left: string[] }> {
  const clean = (r: string): string | null => {
    const rel = r.replace(/\\/g, '/').replace(/^\/+/, '');
    return !rel || nodePath.isAbsolute(rel) || rel.split('/').some((p) => !p || p === '.' || p === '..') ? null : rel;
  };
  const empty = (words: string) => ({ words, notes: 0, files: 0, restored: 0, left: [] as string[] });
  const state = await loadState(root, pairId);
  const run = state?.runs?.filter((r) => !r.undone).pop();
  if (!state || !run) return empty('Nothing to take back: this source has no run that can be undone.');
  if (!run.added.length && !run.beside.length && !run.updated.length && !run.files.length && !run.filesBack.length && !run.views.length && !run.viewsBack.length) {
    run.undone = true;
    await writeAtomic(absOf(root, `${PAIRS_DIR}/${state.id}.json`), `${JSON.stringify(state, null, 1)}\n`);
    return empty('Nothing to take back: its last run made no notes.');
  }
  let notes = 0;
  let files = 0;
  let restored = 0;
  const left: string[] = [];
  let tooBig = 0;
  for (const rel of [...run.added, ...run.beside]) {
    const at = clean(rel);
    if (!at || !(await exists(absOf(root, at)))) continue;
    await o.trash(at);
    notes++;
  }
  for (const rel of [...run.files, ...run.views]) {
    const at = clean(rel);
    if (!at || !(await exists(absOf(root, at)))) continue;
    await o.trash(at);
    files++;
  }
  /** The item an updated note belongs to, for putting its record back (a fresh one's record goes). */
  const itemOf = (rel: string): string | null => {
    const lower = rel.toLowerCase();
    for (const [itemId, it] of Object.entries(state.items)) if (it.rel.toLowerCase() === lower) return itemId;
    return null;
  };
  for (const u of [...run.updated].reverse()) {
    const at = clean(u.rel);
    if (!at) continue;
    const current = await fsp.readFile(absOf(root, at), 'utf8').catch(() => null);
    if (current === null) {
      const itemId = itemOf(at);
      if (itemId && u.fresh) delete state.items[itemId];
      continue;
    }
    if (u.before === null || textHash(current) !== u.after) {
      if (u.before === null) tooBig++;
      left.push(at);
      continue;
    }
    await o.beforeWrite?.(absOf(root, at));
    await writeAtomic(absOf(root, at), u.before);
    const itemId = itemOf(at);
    if (itemId) {
      if (u.fresh) delete state.items[itemId];
      else state.items[itemId] = { ...state.items[itemId], rel: at, remote: u.remoteBefore, local: textHash(u.before) };
    }
    restored++;
  }
  for (const f of [...run.filesBack].reverse()) {
    const at = clean(f.rel);
    if (!at) continue;
    const current = await fsp.readFile(absOf(root, at)).catch(() => null);
    if (current === null || f.before64 === null || bytesHash(current) !== f.after) {
      if (current !== null) {
        if (f.before64 === null) tooBig++;
        left.push(at);
      }
      continue;
    }
    await o.beforeWrite?.(absOf(root, at));
    await writeAtomic(absOf(root, at), Buffer.from(f.before64, 'base64'));
    for (const [key, it] of Object.entries(state.files)) if (it.rel.toLowerCase() === at.toLowerCase()) state.files[key] = { rel: at, hash: bytesHash(Buffer.from(f.before64, 'base64')) };
    restored++;
  }
  for (const vw of [...run.viewsBack].reverse()) {
    const at = clean(vw.rel);
    if (!at) continue;
    const current = await fsp.readFile(absOf(root, at), 'utf8').catch(() => null);
    if (current === null || vw.before === null || textHash(current) !== vw.after) {
      if (current !== null) {
        if (vw.before === null) tooBig++;
        left.push(at);
      }
      continue;
    }
    await o.beforeWrite?.(absOf(root, at));
    await writeAtomic(absOf(root, at), vw.before);
    for (const [name, it] of Object.entries(state.views)) if (it.rel.toLowerCase() === at.toLowerCase()) state.views[name] = { rel: at, hash: textHash(vw.before) };
    restored++;
  }
  run.undone = true;
  await writeAtomic(absOf(root, `${PAIRS_DIR}/${state.id}.json`), `${JSON.stringify(state, null, 1)}\n`);
  const bit = (count: number, one: string) => (count === 1 ? `1 ${one}` : `${count.toLocaleString('en-AU')} ${one}s`);
  const parts = [`${bit(notes, 'note')} to the Bin`];
  if (restored) parts.push(`${bit(restored, 'note')} restored`);
  if (files) parts.push(bit(files, 'file'));
  let words = `Took back ${parts.join(', ')}.`;
  if (left.length) words += ` ${bit(left.length, 'note')} changed since stayed as you left ${left.length === 1 ? 'it' : 'them'}.`;
  if (tooBig) words += ` ${bit(tooBig, 'note')} ${tooBig === 1 ? 'was' : 'were'} too big to keep: ${o.recoveryWords ?? 'their words before are in File recovery'}.`;
  return { words, notes, files, restored, left };
}

/** A note and the copy put beside it, for "Show the difference". */
export async function readConflict(root: string, rel: string, copy: string): Promise<{ mine: string; theirs: string }> {
  for (const r of [rel, copy]) if (nodePath.isAbsolute(r) || r.split('/').includes('..')) throw new Error('Unknown note.');
  const [mine, theirs] = await Promise.all([fsp.readFile(absOf(root, rel), 'utf8'), fsp.readFile(absOf(root, copy), 'utf8')]);
  return { mine, theirs };
}

/** Read and bring in, in one go (the AI's tool), the temporary folder always removed. */
export async function importPath(root: string, source: string, o: ReadOptions & ImportOptions & { previewOnly?: boolean }): Promise<{ plan: PairPlan; summary: PairSummary | null }> {
  const src = await readSource(source, root, o);
  try {
    if (o.previewOnly) return { plan: src.plan, summary: null };
    return { plan: src.plan, summary: await importSource(root, src, o) };
  } finally {
    await src.done();
  }
}

export { summaryWords, planWords };
export { linkToken, fileSafe, textHash, isoDay, isoMinute, firstWords, tagSafe } from './source';
export { readProps, changeProps } from '../../shared/frontmatter';
export { defaultView } from '../../shared/views';
