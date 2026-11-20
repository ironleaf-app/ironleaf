// Folding one area into another (9 Nov 2026; the list: "Health and Publications fold into Me once the app allows").
// The folder moves with the app's own move (every link, embed, canvas, view and kept-out setting follows it), its
// area leaves the list, and Ironleaf's own files, note properties and project workspaces are brought up to date like
// the move into areas does. A full backup first (the bills tidy-up's way), one plain preview, and one Undo per fold
// that puts every file and every link back exactly. Nothing is ever deleted.

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { AREAS_FILE, areaNamed, readAreas, writeAreas, type AreasConfig } from '../shared/areas';
import { areasAfterFold, foldPreviewWords, followFoldIn, validateAreaFold, type FoldPlan, type FoldState } from '../shared/area-fold';
import { changeProps, readProps } from '../shared/frontmatter';
import { encodeLinkPath, normalizeTarget, replaceMarkdownLinks, replaceWikilinks } from '../shared/markdown';
import { readWorkspace, workspaceFileOf, writeWorkspace } from '../shared/project-workspace';
import type { VaultIndex } from './indexer';
import { writeZip } from './zip';

export const AREA_FOLD_FILE = '.neuralvault/area-fold.json';
export const AREA_FOLD_LOCK = '.neuralvault/area-fold.lock';
/** A lock older than this is a dead app's, and is taken over (the bills tidy-up's rule). */
const LOCK_FRESH_MS = 5 * 60 * 1000;

const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
const cleanDir = (d: string) => d.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
const lower = (s: string) => s.toLowerCase();
const under = (p: string, dir: string) => lower(p) === lower(dir) || lower(p).startsWith(`${lower(dir)}/`);

/** What the fold needs from the app (life.ts wires the real ones; tests wire a faithful stand-in over a real disk). */
export interface FoldWork {
  root: string;
  index: VaultIndex;
  movePath(from: string, to: string, updateLinks: boolean): Promise<{ path: string; linksUpdated: number; notesUpdated: number }>;
  /** A file written outside the app's move, re-read into the index (notes only; other files are plain writes). */
  indexFile(rel: string): Promise<void>;
  refreshFiles(): Promise<void>;
  changed(paths: string[], moves?: [string, string][]): void;
  filesChanged(): void;
  /** A note's links synced back after a direct write (the relations seam). */
  syncAfterWrite?(rel: string, before: string, after: string): Promise<void> | void;
  dataDir?: string;
  device?: { id: string; name: string };
  appVersion?: string;
}

export interface FoldDone {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  areaId?: string;
  at: string;
  backup: { zip: string; files: number; bytes: number } | null;
  /** Every file whose words changed, with its words before (Undo writes these back). Pre-move paths. */
  changed: { rel: string; before: string }[];
  /** Files the fold created (renamed workspace files' new names): Undo takes them away. */
  added: string[];
  linksUpdated: number;
  notesMoved: number;
}

interface FoldStack {
  version: 1;
  folds: FoldDone[];
}

// ── Listing ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, base: string): Promise<void> => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
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

async function walkFolders(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, base: string): Promise<void> => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || e.name === '.git') continue;
      const rel = base ? `${base}/${e.name}` : e.name;
      out.push(rel);
      await walk(path.join(dir, e.name), rel);
    }
  };
  await walk(root, '');
  return out.sort();
}

const isTextFile = (rel: string): boolean => /\.(md|canvas|base|view\.json|json)$/i.test(rel);

/** Every text file's words (notes, canvases, views, Ironleaf's own files): the before picture for Undo. */
async function snapshotTexts(root: string, rels: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const rel of rels) {
    if (!isTextFile(rel)) continue;
    if (/^\.neuralvault\/(safety|migrations|audit)\//i.test(rel)) continue;
    if (lower(rel) === lower(AREA_FOLD_FILE) || lower(rel) === lower(AREA_FOLD_LOCK)) continue;
    try {
      out.set(rel, await fsp.readFile(path.join(root, ...rel.split('/')), 'utf8'));
    } catch {
      // Unreadable now (locked, still fetching): left alone, like the tidy-ups leave such notes.
    }
  }
  return out;
}

async function areasConfig(root: string): Promise<{ config: AreasConfig | null; text: string | null }> {
  let text: string | null = null;
  try {
    text = await fsp.readFile(path.join(root, ...AREAS_FILE.split('/')), 'utf8');
  } catch {
    text = null;
  }
  return { config: readAreas(text).config, text };
}

// ── The plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function planAreaFold(w: FoldWork, fromRaw: string, toAreaId: string): Promise<FoldPlan> {
  const { config } = await areasConfig(w.root);
  const areas = config?.areas ?? [];
  const folders = await walkFolders(w.root);
  const files = await walkFiles(w.root);
  const { from, to, area } = validateAreaFold({ from: fromRaw, toArea: toAreaId, areas, folders, files });
  const toArea = areas.find((a) => a.id === toAreaId)!;
  const inside = files.filter((f) => under(f, from));
  const notes = inside.filter((f) => /\.md$/i.test(f)).length;
  // Links that will be rewritten: ones reaching into the moved folder from outside, and ones written from the
  // folder of a note that itself moves (they read from its new folder after, like the app's own move).
  let links = 0;
  const linkNotes = new Set<string>();
  for (const meta of w.index.allMeta()) {
    const sourceMoves = under(meta.path, from);
    for (const link of [...meta.links, ...(meta.propLinks ?? [])]) {
      const reached = w.index.resolveAny(link.target, meta.path);
      if (!reached) continue;
      if (under(reached, from) || (sourceMoves && w.index.writtenFromFolder(link.target, meta.path))) {
        links++;
        linkNotes.add(meta.path);
      }
    }
  }
  const fromName = area?.name ?? from.split('/').pop() ?? from;
  return {
    from,
    to,
    fromName,
    toName: toArea.name,
    ...(area ? { areaId: area.id } : {}),
    notes,
    files: inside.length,
    links,
    linkNotes: linkNotes.size,
    words: foldPreviewWords({ fromName, toName: toArea.name, to, notes, files: inside.length, links, linkNotes: linkNotes.size }),
  };
}

// ── The receipt (a stack: one Undo per fold) ─────────────────────────────────────────────────────────────────────────

const receiptPath = (w: FoldWork): string => path.join(w.root, ...AREA_FOLD_FILE.split('/'));

async function readStack(w: FoldWork): Promise<FoldStack> {
  try {
    const v = JSON.parse(await fsp.readFile(receiptPath(w), 'utf8')) as FoldStack;
    if (v && v.version === 1 && Array.isArray(v.folds)) return v;
  } catch {
    // No folds yet, or a broken file: start clean (the backup zips still stand).
  }
  return { version: 1, folds: [] };
}

async function writeStack(w: FoldWork, s: FoldStack): Promise<void> {
  if (!s.folds.length) {
    await fsp.rm(receiptPath(w), { force: true });
    return;
  }
  const file = receiptPath(w);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.nvtmp`;
  await fsp.writeFile(temp, JSON.stringify(s, null, 1), 'utf8');
  await fsp.rename(temp, file);
}

// ── The backup (the bills tidy-up's way: the whole vault as a zip on this PC) ───────────────────────────────────────

export async function backupVaultForFold(w: FoldWork, from: string, to: string): Promise<{ zip: string; files: number; bytes: number }> {
  const root = w.root;
  const dataDir = w.dataDir ?? path.join(root, '.neuralvault', 'tmp');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const vaultName = path.basename(root).replace(/[^\w .-]+/g, '').trim() || 'vault';
  const tag = `${cleanDir(from).replace(/\//g, '-').slice(0, 40)}-into-${cleanDir(to).replace(/\//g, '-').slice(0, 40)}`;
  let dest = path.join(dataDir, 'backups', `${vaultName}-before-fold-${tag}-${stamp}.zip`);
  for (let n = 2; await fsp.stat(dest).then(() => true, () => false); n++) {
    dest = path.join(dataDir, 'backups', `${vaultName}-before-fold-${tag}-${stamp}-${n}.zip`);
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const files = await walkFiles(root);
  const { bytes } = await writeZip(dest, files.map((rel) => ({ name: rel, abs: path.join(root, ...rel.split('/')) })));
  return { zip: dest, files: files.length, bytes };
}

// ── The lock (one PC folds at a time: the bills tidy-up's rule) ─────────────────────────────────────────────────────

const lockPath = (w: FoldWork): string => path.join(w.root, ...AREA_FOLD_LOCK.split('/'));

export async function acquireFoldLock(w: FoldWork): Promise<string | null> {
  const file = lockPath(w);
  const self = w.device?.id ?? '';
  const selfName = w.device?.name?.trim() || 'This PC';
  const words = JSON.stringify({ pc: self, name: selfName, at: Date.now() });
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });
  } catch (e) {
    throw new Error(`Couldn't start the move (${plainFsError(e)}). Nothing changed.`);
  }
  try {
    await fsp.writeFile(file, words, { flag: 'wx' });
    return null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'EEXIST') throw new Error(`Couldn't start the move (${plainFsError(e)}). Nothing changed.`);
  }
  let cur: { pc: string; name: string; at: number } | null = null;
  try {
    const v = JSON.parse(await fsp.readFile(file, 'utf8')) as Partial<{ pc: string; name: string; at: number }>;
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
    throw new Error(`Couldn't start the move (${plainFsError(e)}). Nothing changed.`);
  }
  return null;
}

export async function releaseFoldLock(w: FoldWork): Promise<void> {
  try {
    const file = lockPath(w);
    const text = await fsp.readFile(file, 'utf8').catch((): null => null);
    if (!text) return;
    const v = JSON.parse(text) as Partial<{ pc: string }> | null;
    if (v && v.pc === (w.device?.id ?? '')) await fsp.rm(file, { force: true });
  } catch {
    // A leftover lock goes stale and is taken over; never blocking for good.
  }
}

let foldRunning = false;

async function guardFoldLocked<T>(w: FoldWork, fn: () => Promise<T>): Promise<T> {
  if (foldRunning) throw new Error('A move is already running. Wait for it to finish.');
  foldRunning = true;
  try {
    const holder = await acquireFoldLock(w);
    if (holder) throw new Error(`${holder} is moving a folder right now. Wait a moment, then try again.`);
    try {
      return await fn();
    } finally {
      await releaseFoldLock(w);
    }
  } finally {
    foldRunning = false;
  }
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

// ── Running ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Every link in every note, and what it reaches now (links that would land somewhere else after are pinned). */
function linkMap(w: FoldWork): Map<string, { target: string; reached: string | null }[]> {
  const out = new Map<string, { target: string; reached: string | null }[]>();
  for (const m of w.index.allMeta()) out.set(m.path, m.links.map((l) => ({ target: l.target, reached: w.index.resolveAny(l.target, m.path) })));
  return out;
}

const mapPath = (p: string, from: string, to: string): string => (under(p, from) ? `${to}${p.slice(from.length)}` : p);

async function writeTextFile(w: FoldWork, rel: string, text: string, indexIt: boolean): Promise<void> {
  const abs = path.join(w.root, ...rel.split('/'));
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const temp = `${abs}.${process.pid}.nvtmp`;
  await fsp.writeFile(temp, text, 'utf8');
  await fsp.rename(temp, abs);
  if (indexIt) await w.indexFile(rel);
}

/** A project's workspace file moved with its project (its content follows the folder too). */
async function followWorkspaces(w: FoldWork, from: string, to: string, added: string[]): Promise<void> {
  const dir = path.join(w.root, '.neuralvault', 'workspaces');
  const names = await fsp.readdir(dir).catch((): string[] => []);
  for (const name of names) {
    if (!/\.json$/i.test(name) || name.startsWith('.')) continue;
    const rel = `.neuralvault/workspaces/${name}`;
    let text: string;
    try {
      text = await fsp.readFile(path.join(w.root, ...rel.split('/')), 'utf8');
    } catch {
      continue;
    }
    let project = '';
    try {
      project = (JSON.parse(text) as { project?: unknown }).project as string;
    } catch {
      continue;
    }
    if (typeof project !== 'string' || !under(project, from)) continue;
    const nextProject = mapPath(project, from, to);
    const nextRel = workspaceFileOf(nextProject);
    const { value } = followFoldIn(JSON.parse(text), from, to);
    const out = writeWorkspace({ ...readWorkspace(JSON.stringify(value), nextProject), project: nextProject });
    await writeTextFile(w, nextRel, out, false);
    added.push(nextRel);
    await fsp.rm(path.join(w.root, ...rel.split('/')), { force: true });
  }
}

export async function runAreaFold(w: FoldWork, fromRaw: string, toAreaId: string): Promise<string> {
  return guardFoldLocked(w, async () => {
    const plan = await planAreaFold(w, fromRaw, toAreaId);
    const { from, to } = plan;
    const { config } = await areasConfig(w.root);
    if (!config) throw new Error('Set up areas first, then fold.');
    // The backup first (nothing changes before it stands).
    let backup: { zip: string; files: number; bytes: number };
    try {
      backup = await backupVaultForFold(w, from, to);
    } catch (e) {
      throw new Error(`Couldn't back up the vault (${plainFsError(e)}). Nothing changed.`);
    }
    const before = linkMap(w);
    const allBefore = await walkFiles(w.root);
    const textsBefore = await snapshotTexts(w.root, allBefore);
    // The move itself, with the app's own move (links, embeds, canvases, views and kept-out settings follow).
    const moved = await w.movePath(from, to, true);
    // Its area leaves the list (its notes are the other area's now).
    const nextAreas = areasAfterFold(config, plan.areaId);
    await writeTextFile(w, AREAS_FILE, writeAreas(nextAreas), false);
    // Ironleaf's own files follow (views, layouts, sensitivity, workspaces' content): every path in them.
    const added: string[] = [];
    const ownFiles = (await walkFiles(w.root)).filter((f) => /^\.neuralvault\/.+\.json$/i.test(f) && !/^\.neuralvault\/(safety|migrations|audit|workspaces)\//i.test(f) && lower(f) !== lower(AREAS_FILE) && lower(f) !== lower(AREA_FOLD_FILE) && lower(f) !== lower(AREA_FOLD_LOCK));
    for (const rel of ownFiles) {
      let text: string;
      try {
        text = await fsp.readFile(path.join(w.root, ...rel.split('/')), 'utf8');
      } catch {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      const { value, changed } = followFoldIn(parsed, from, to);
      if (!changed) continue;
      await writeTextFile(w, rel, `${JSON.stringify(value, null, text.includes('\t') ? '\t' : 2)}\n`, false);
    }
    // Project workspaces go with their projects.
    await followWorkspaces(w, from, to, added);
    // Notes' properties follow (paths in them, and `area:` into the other area).
    await followNotePropsInner(w, from, to, plan.areaId, plan.toName, config);
    // Every link checked: one that now reaches something else (two notes of one name, a shorter path) is written as
    // the path of what it reached before (the move into areas' rule).
    let pinned = 0;
    const movedSet = new Map<string, string>();
    for (const p of allBefore) if (under(p, from)) movedSet.set(p, mapPath(p, from, to));
    for (const [oldPath, links] of before) {
      const now = mapPath(oldPath, from, to);
      const want = new Map<string, string>();
      for (const l of links) {
        if (!l.reached) continue;
        const expected = movedSet.get(l.reached) ?? (under(l.reached, from) ? mapPath(l.reached, from, to) : l.reached);
        if (w.index.resolveAny(l.target, now) !== expected) want.set(normalizeTarget(l.target), expected);
      }
      if (!want.size) continue;
      let text: string | null = null;
      try {
        text = await fsp.readFile(path.join(w.root, ...now.split('/')), 'utf8');
      } catch {
        continue;
      }
      if (text === null || !/\.md$/i.test(now)) continue;
      let count = 0;
      let out = replaceWikilinks(text, (link, raw, embed) => {
        const dest = want.get(normalizeTarget(link.target));
        if (!dest) return raw;
        count++;
        return `${embed ? '!' : ''}[[${/\.md$/i.test(dest) ? dest.replace(/\.md$/i, '') : dest}${link.heading ? `#${link.heading}` : ''}|${link.alias ?? link.target}]]`;
      });
      out = replaceMarkdownLinks(out, (target, fragment, raw, embed, label) => {
        const dest = want.get(normalizeTarget(target));
        if (!dest) return raw;
        count++;
        return `${embed ? '!' : ''}[${label}](${encodeLinkPath(dest)}${fragment})`;
      });
      if (count && out !== text) {
        await writeTextFile(w, now, out, true);
        if (w.syncAfterWrite) await w.syncAfterWrite(now, text, out);
        pinned += count;
      }
    }
    // What changed, for the one Undo (pre-move paths with their words before).
    const allAfter = await walkFiles(w.root);
    const afterSet = new Set(allAfter);
    const changed: { rel: string; before: string }[] = [];
    for (const [rel, text] of textsBefore) {
      const now = mapPath(rel, from, to);
      const live = afterSet.has(now) ? await fsp.readFile(path.join(w.root, ...now.split('/')), 'utf8').catch((): null => null) : null;
      if (live === null || live !== text) changed.push({ rel, before: text });
    }
    // Workspace files renamed above: their old words go with the rest (their new names are already in `added`).
    const stack = await readStack(w);
    stack.folds.push({ from, to, fromName: plan.fromName, toName: plan.toName, ...(plan.areaId ? { areaId: plan.areaId } : {}), at: new Date().toISOString(), backup, changed, added, linksUpdated: moved.linksUpdated + pinned, notesMoved: plan.notes });
    await writeStack(w, stack);
    await w.refreshFiles();
    w.changed([...movedSet.values()], [[from, to]]);
    w.filesChanged();
    const links = moved.linksUpdated + pinned;
    return `${plan.fromName} is in ${plan.toName} now (${to}). ${plan.notes === 1 ? '1 note' : `${plan.notes} notes`} moved${links ? `, ${links === 1 ? '1 link' : `${links} links`} brought up to date` : ''}. The backup is at ${backup.zip}, and Undo puts every file and every link back.`;
  });
}

/** Note properties brought up to date: paths follow the folder, and `area:` follows the folded area into its new one. */
async function followNotePropsInner(w: FoldWork, from: string, to: string, areaId: string | undefined, destName: string, config: AreasConfig): Promise<void> {
  const rels = (await walkFiles(w.root)).filter((f) => /\.md$/i.test(f));
  for (const rel of rels) {
    let text: string;
    try {
      text = await fsp.readFile(path.join(w.root, ...rel.split('/')), 'utf8');
    } catch {
      continue;
    }
    const props = readProps(text);
    // `area:` is a name, not a path: it follows the folded area into its new one, never through the path follow
    // (which would read "Health" as the folder and write "Me/Health").
    let areaChanged = false;
    let areaValue: unknown;
    if (areaId && props.area !== undefined) {
      const named = areaNamed(props.area, config.areas);
      if (named?.id === areaId) {
        areaValue = destName;
        areaChanged = true;
      } else {
        areaValue = props.area;
      }
    }
    const rest = { ...props };
    delete rest.area;
    const { value, changed: pathChanged } = followFoldIn(rest, from, to);
    const next: Record<string, unknown> = { ...(value as Record<string, unknown>), ...(areaValue !== undefined || areaChanged ? { area: areaValue } : {}) };
    if (!pathChanged && !areaChanged) continue;
    const out = changeProps(text, (doc) => {
      for (const k of Object.keys(next)) if (JSON.stringify(props[k]) !== JSON.stringify(next[k])) doc.set(k, next[k]);
    });
    if (out === text) continue;
    await writeTextFile(w, rel, out, true);
    if (w.syncAfterWrite) await w.syncAfterWrite(rel, text, out);
  }
}

/** One Undo: the last fold back where it was, every file and every link byte for byte. */
export async function undoAreaFold(w: FoldWork): Promise<string> {
  return guardFoldLocked(w, async () => {
    const stack = await readStack(w);
    const last = stack.folds[stack.folds.length - 1];
    if (!last) return 'Nothing to put back.';
    // The folder back first, without touching links (their words come back from the receipt next).
    const backThere = await fsp.stat(path.join(w.root, ...last.to.split('/'))).then(() => true, () => false);
    const clashThere = await fsp.stat(path.join(w.root, ...last.from.split('/'))).then(() => true, () => false);
    if (backThere && !clashThere) {
      try {
        await w.movePath(last.to, last.from, false);
      } catch (e) {
        throw new Error(`Couldn't move ${last.to} back (${plainFsError(e)}). Nothing changed. The backup still has everything: ${last.backup?.zip ?? 'no backup was taken'}.`);
      }
    } else if (!backThere && !clashThere) {
      throw new Error(`${last.to} is gone, so there is nothing to put back. The backup still has everything: ${last.backup?.zip ?? 'no backup was taken'}.`);
    } else if (clashThere && backThere) {
      throw new Error(`${last.from} is there again already, so nothing was put back. Move it away first, then Undo.`);
    }
    // Every changed file's words back, byte for byte; files the fold created taken away.
    const failed: string[] = [];
    for (const c of last.changed) {
      try {
        await writeTextFile(w, c.rel, c.before, /\.md$/i.test(c.rel));
      } catch {
        failed.push(c.rel);
      }
    }
    for (const rel of last.added) {
      await fsp.rm(path.join(w.root, ...rel.split('/')), { force: true });
    }
    if (failed.length) {
      throw new Error(`${failed.length === 1 ? '1 file could' : `${failed.length} files could`} not be put back (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' and others' : ''}). The backup still has everything: ${last.backup?.zip ?? 'no backup was taken'}.`);
    }
    // Byte check before the receipt goes: every kept file back word for word.
    for (const c of last.changed) {
      const live = await fsp.readFile(path.join(w.root, ...c.rel.split('/')), 'utf8').catch((): null => null);
      if (live === null || sha(live) !== sha(c.before)) {
        throw new Error(`“${c.rel}” did not come back word for word. The backup still has everything: ${last.backup?.zip ?? 'no backup was taken'}.`);
      }
    }
    stack.folds.pop();
    await writeStack(w, stack);
    await w.refreshFiles();
    w.changed(last.changed.map((c) => c.rel), [[last.to, last.from]]);
    w.filesChanged();
    const n = last.notesMoved;
    return `${last.fromName} is back where it was${n ? `, ${n === 1 ? '1 note' : `${n} notes`} and every link` : ''}, word for word.`;
  });
}

/** What the window shows: whether a fold can be undone, and what the last one did. */
export async function foldState(w: FoldWork): Promise<FoldState> {
  const stack = await readStack(w);
  const last = stack.folds[stack.folds.length - 1] ?? null;
  const backupExists = last?.backup ? await fsp.stat(last.backup.zip).then(() => true, () => false) : false;
  return { undoable: !!last, last: last ? { fromName: last.fromName, toName: last.toName, at: last.at, notes: last.notesMoved } : null, backupExists };
}
