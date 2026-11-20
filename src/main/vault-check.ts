// The vault looks after itself (27 Oct 2026). The side chat had gone round in circles over a project's picture that said
// "This isn't in the vault any more": its record in the project's Files list was named register-20-internal.jpg while the
// file it pointed to is "Homebush Register 20 internal sign-on screen.jpg", and a second record had been added for the
// same file instead of fixing the first; nothing could find a record by a name its file doesn't have, and nothing could
// mend or remove one. The check goes through the whole vault and puts right what can only be put one way, by itself:
//  · a file record (Files/.files.json) pointing at a file on this PC under another name: named as the file is, and a
//     second record of the same file folded into the first (the better summary kept, links to the old name moved);
//   · a record whose file on this PC has moved: pointed at it again, found by its name and size (the project's folder
//     first, then the vault);
//   · a record of a file kept in the vault that is no longer beside it: the record follows the file where it went, or,
//     when the file is gone everywhere, the record goes (said so);
//   · a note's link to a file that has moved inside the vault: the link brought up to date (one place it can be, or the
//     one beside the note's own project or area).
// What has more than one right answer (two files it could be, a file gone from everywhere a note still names) is left as
// it is and said plainly, with where it is. Runs when the vault opens, and whenever the side chat or the former host app
// asks.

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { entryKey, type FileEntry, type FilesSidecar } from '../shared/file-records';
import { INBOX_NOTE } from '../shared/inbox';
import { encodeLinkPath, normalizeTarget, replaceMarkdownLinks, replaceWikilinks } from '../shared/markdown';
import { cleanFileName, isRelativeTarget, needsWindowsRepair, win32Abs } from '../shared/paths';
import { isPrivatePath } from '../shared/private';
import { bodyWords, isThinNote, SETTLED_MS } from '../shared/weekly-tidy';

export interface CheckHost {
  root(): string;
  listAll(): Promise<{ rel: string; size: number; mtime?: number }[]>;
  notes(): { path: string; props?: Record<string, unknown> }[];
  resolve(target: string, from: string): string | null;
  readNote(rel: string): Promise<string>;
  writeNote(rel: string, text: string): Promise<void>;
  sidecarFolders(): Promise<string[]>;
  readSidecar(folder: string): Promise<FilesSidecar>;
  changeSidecar(folder: string, fn: (s: FilesSidecar) => void | Promise<void>): Promise<FilesSidecar>;
  /** The app's own move (links, canvases, views, file records and the index follow it), for name repairs. */
  movePath?(from: string, to: string, updateLinks: boolean): Promise<{ path: string; linksUpdated: number }>;
}

export interface CheckResult {
  /** What was put right, one line each. */
  fixed: string[];
  /** What needs the person (more than one right answer, or gone everywhere), one line each. */
  left: string[];
  checked: { notes: number; files: number; records: number; links: number };
  /** Notes that hold almost nothing (vault paths, titles, word counts): offered for a look-over, never touched. */
  thin: { path: string; title: string; words: number }[];
  words: string;
  /** The name repairs planned this run (old path, new path): what the person approves, in order. */
  renames: [string, string][];
  /** The name repairs that need the person (version control, twins, long paths, failures), one line each. */
  nameLeft: string[];
}

/** A list of names in words: “Aye”, “Aye and Bee”, “Aye, Bee and Cee”, “Aye, Bee, Cee and 2 more”. */
function namesWords(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  if (names.length <= 5) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

/** One over-long path said: how long, the Windows limit, and what would fix it. */
function longLine(root: string, rel: string): string {
  const n = path.join(root, ...rel.split('/')).length;
  const hint = rel.length > 200 ? 'Shorten its name or move it nearer the top.' : 'A shorter vault path would fix it.';
  return `${rel}: its full path is ${n} letters long, past what Windows opens (260). It was left alone. ${hint}`;
}

/** The deepest folder holding every path (for one line about many long paths). */
function commonDir(rels: string[]): string {
  const parts = rels.map((r) => r.split('/').slice(0, -1));
  let i = 0;
  while (parts.every((p) => p.length > i && p[i] === parts[0][i])) i++;
  return parts[0].slice(0, Math.max(1, i)).join('/') || '.';
}

/** The quiet bell line offering thin notes: one line, opening the first to look over. The key names the exact list,
 *  so it is said once per list — a changed list says again, the same list never nags. */
export function thinNotice(thin: { path: string; title: string; words: number }[]): { key: string; kind: string; title: string; body: string; path: string } {
  const key = createHash('sha256').update(thin.map((t) => t.path).sort().join('\n'), 'utf8').digest('hex').slice(0, 12);
  const title = thin.length === 1 ? '1 note holds almost nothing' : `${thin.length} notes hold almost nothing`;
  return { key: `check:thin:${key}`, kind: 'check', title, body: `${namesWords(thin.map((t) => t.title))}. Nothing was moved: say which to put in the Bin.`, path: thin[0].path };
}

// ── Names Windows cannot keep: the ask, the telling, and the receipt ──
// A repair that would surprise a person asks once first, naming the files (Nov 2026 break audit: the check used to
// rename real files about 8 seconds after every vault open, with no ask and no visible word). The receipt lives in
// the vault (.neuralvault/name-repairs.json), so every PC asks once for the same plan, an approved plan applies the
// same way everywhere, a declined plan never nags, and a crash or a locked file resumes where it stopped.

/** The one key for a plan (renames plus what needs the person): order-free, so the same plan asks once. */
export function namesHash(pairs: readonly (readonly [string, string])[], notes: readonly string[] = []): string {
  const body = [...pairs.map(([a, b]) => `${a}\n${b}`), ...notes].sort().join('\n');
  return createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 12);
}

/** The one ask for a plan: how many, naming the files, and that nothing moves until the person chooses. */
export function namesAsk(pairs: readonly (readonly [string, string])[], notes: readonly string[] = []): { key: string; kind: string; title: string; body: string } {
  const key = `names:${namesHash(pairs, notes)}`;
  const becomings = pairs.map(([a, b]) => `“${a.split('/').pop()}” would become “${b.split('/').pop()}”`);
  const title = pairs.length ? (pairs.length === 1 ? '1 name Windows can’t open' : `${pairs.length} names Windows can’t open`) : notes.length === 1 ? 'A file name needs you' : 'Some file names need you';
  const body = pairs.length
    ? `${namesWords(becomings)}. Nothing is renamed until you choose.${notes.length ? ` ${notes.length === 1 ? 'One more needs you' : `${notes.length} more need you`}: ${notes.slice(0, 2).join(' ')}` : ''}`
    : `${namesWords(notes.slice(0, 3))}${notes.length > 3 ? ` and ${notes.length - 3} more` : ''}`;
  return { key, kind: 'names', title, body };
}

/** The one telling after a repair: what moved, and what could not, each said once per plan. */
export function namesTold(applied: readonly (readonly [string, string])[], failed: readonly string[] = []): { key: string; kind: string; title: string; body: string; path: string } {
  const key = `names:done:${namesHash(applied, failed)}:${applied.length}`;
  const title = applied.length === 1 ? '1 name repaired, so Windows can open it' : `${applied.length} names repaired, so Windows can open them`;
  const body = `${namesWords(applied.map(([a, b]) => `“${a.split('/').pop()}” is “${b.split('/').pop()}” now`))}.${failed.length ? ` ${failed.join(' ')}` : ''}`;
  return { key, kind: 'names', title, body, path: applied.length ? applied[0][1] : '' };
}

const NAME_RECEIPT = '.neuralvault/name-repairs.json';
interface NameReceipt {
  version: 1;
  plans: Record<string, { decision: 'approved' | 'declined'; at: number; pairs: [string, string][]; applied: [string, string][]; undone?: number }>;
}
async function readNameReceipt(root: string): Promise<NameReceipt> {
  try {
    const v = JSON.parse(await fsp.readFile(path.join(root, ...NAME_RECEIPT.split('/')), 'utf8')) as Partial<NameReceipt>;
    if (v && v.version === 1 && v.plans && typeof v.plans === 'object') return v as NameReceipt;
  } catch {
    /* none yet, or unreadable: treated as none, never blocking */
  }
  return { version: 1, plans: {} };
}
async function writeNameReceipt(root: string, r: NameReceipt): Promise<void> {
  const abs = path.join(root, ...NAME_RECEIPT.split('/'));
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, JSON.stringify(r));
}

/** The person's answer for a plan, kept in the vault so every PC honours it. */
export async function namesDecide(root: string, pairs: readonly (readonly [string, string])[], notes: readonly string[], decision: 'approved' | 'declined'): Promise<void>;
export async function namesDecide(root: string, pairs: readonly (readonly [string, string])[], decision: 'approved' | 'declined'): Promise<void>;
export async function namesDecide(root: string, pairs: readonly (readonly [string, string])[], notesOrDecision: readonly string[] | 'approved' | 'declined', decision?: 'approved' | 'declined'): Promise<void> {
  const notes = Array.isArray(notesOrDecision) ? notesOrDecision : [];
  const say = (decision ?? notesOrDecision) as 'approved' | 'declined';
  const r = await readNameReceipt(root);
  const h = namesHash(pairs, notes);
  const prev = r.plans[h];
  r.plans[h] = { decision: say, at: Date.now(), pairs: pairs.map(([a, b]) => [a, b] as [string, string]), applied: prev?.applied ?? [] };
  await writeNameReceipt(root, r);
}

/** Pairs of a plan that landed (each recorded as it lands, so a crash resumes instead of redoing). */
export async function namesApplied(root: string, applied: readonly (readonly [string, string])[]): Promise<void> {
  if (!applied.length) return;
  const r = await readNameReceipt(root);
  for (const plan of Object.values(r.plans)) {
    for (const [a, b] of applied) {
      if (plan.pairs.some(([x, y]) => x === a && y === b) && !plan.applied.some(([x, y]) => x === a && y === b)) plan.applied.push([a, b]);
    }
  }
  await writeNameReceipt(root, r);
}

/** What of a plan still wants doing: nothing when it was declined, undone, or is fully applied. */
export async function namesPending(root: string, pairs: readonly (readonly [string, string])[], notes: readonly string[] = []): Promise<[string, string][]> {
  const plan = (await readNameReceipt(root)).plans[namesHash(pairs, notes)];
  if (!plan || plan.decision !== 'approved' || plan.undone) return [];
  return pairs.filter(([a, b]) => !plan.applied.some(([x, y]) => x === a && y === b)).map(([a, b]) => [a, b] as [string, string]);
}

/** The latest applied plan's pairs, newest first: what one Undo puts back. */
export async function namesUndoPairs(root: string): Promise<[string, string][]> {
  const plans = Object.values((await readNameReceipt(root)).plans).filter((p) => p.decision === 'approved' && p.applied.length && !p.undone).sort((a, b) => b.at - a.at);
  return plans.length ? [...plans[0].applied].reverse() : [];
}

/** The person's answer for a plan, if any (an undone plan counts as declined: it never asks again). */
export async function namesDecision(root: string, pairs: readonly (readonly [string, string])[], notes: readonly string[] = []): Promise<'approved' | 'declined' | null> {
  const plan = (await readNameReceipt(root)).plans[namesHash(pairs, notes)];
  if (!plan || plan.undone) return plan?.undone ? 'declined' : null;
  return plan.decision;
}

/** An Undo that put the latest applied plan back, so the same plan never asks again. */
export async function namesUndoneLatest(root: string): Promise<void> {
  const r = await readNameReceipt(root);
  const plans = Object.values(r.plans).filter((p) => p.decision === 'approved' && p.applied.length && !p.undone).sort((a, b) => b.at - a.at);
  if (plans.length) {
    plans[0].undone = Date.now();
    await writeNameReceipt(root, r);
  }
}

/** A move's failure in plain words: the reason, never an error code. */
function moveWords(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'ENAMETOOLONG' || /too long/i.test(msg)) return 'its new name is too long';
  if (code === 'ENOENT' || /no longer there|isn’t there any more/i.test(msg)) return 'it isn’t there any more';
  if (code === 'EEXIST' || /already there|already exists/i.test(msg)) return 'something with the new name is already there';
  if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || /locked or not writable|read-only|read only/i.test(msg)) return 'it is locked or read-only just now';
  if (/can’t be moved into itself/i.test(msg)) return 'it can’t move into itself';
  if (/outside the vault/i.test(msg)) return 'it leads outside the vault';
  if (/reserved/i.test(msg)) return 'that folder is reserved';
  return 'it couldn’t be moved just now';
}

const lower = (s: string) => s.toLowerCase();
const baseOf = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p;
const winBase = (p: string) => p.split(/[\\/]/).pop() ?? p;
const isFile = (p: string) => fsp.stat(p).then((s) => (s.isFile() ? s : null), () => null);
const folderProp = (props?: Record<string, unknown>): string | null => {
  const f = props?.folder;
  return typeof f === 'string' && /^([A-Za-z]:[\\/]|\/)/.test(f.trim()) ? f.trim() : null;
};

/** Files on this PC under a folder with this name (case aside), as whole paths: walked once per folder, kept for the check. */
async function filesNamed(dir: string, name: string, cache: Map<string, Map<string, string[]>>): Promise<string[]> {
  if (!cache.has(dir)) {
    const byName = new Map<string, string[]>();
    const walk = async (d: string, depth: number) => {
      if (depth > 10) return;
      const list = await fsp.readdir(win32Abs(d, process.platform), { withFileTypes: true }).catch(() => []);
      for (const x of list) {
        if (x.name.startsWith('.') || x.name === 'node_modules') continue;
        const p = path.join(d, x.name);
        if (x.isDirectory()) await walk(p, depth + 1);
        else if (x.isFile()) {
          const k = lower(x.name);
          byName.set(k, [...(byName.get(k) ?? []), p]);
        }
      }
    };
    await walk(dir, 0);
    cache.set(dir, byName);
  }
  return cache.get(dir)!.get(lower(name)) ?? [];
}

/** The one of several places that fits: the only one, else the one of the right size, else the one nearest `near`. */
function pick<T extends { at: string; size?: number }>(found: T[], size: number | undefined, near: string): T | null {
  if (found.length === 1) return found[0];
  const sized = size ? found.filter((f) => f.size === size) : found;
  if (sized.length === 1) return sized[0];
  const top = (p: string) => p.replace(/\\/g, '/').split('/').slice(0, 2).join('/').toLowerCase();
  const close = (sized.length ? sized : found).filter((f) => top(f.at) === top(near));
  return close.length === 1 ? close[0] : null;
}

// Links to files (not notes) in a note: [[file.pdf]], ![[picture.jpg|300]], [words](path/file.pdf), ![](picture.png).
const LINKS = /(!?)\[\[([^\]|#\n]+?\.(?!md\b)[A-Za-z0-9]{2,5})((?:[|#][^\]\n]*)?)\]\]|(!?)\[([^\]\n]*)\]\((?!https?:|mailto:|#|file:)(<[^>\n]+>|[^)\s\n]+?\.(?!md\b)[A-Za-z0-9]{2,5})\)/g;

export async function checkVault(host: CheckHost, o: { repair: boolean; templatesFolder?: string; plan?: readonly (readonly [string, string])[]; receipt?: boolean; names?: boolean } = { repair: true }): Promise<CheckResult> {
  const fixed: string[] = [];
  const left: string[] = [];
  const nameLeft: string[] = [];
  const sayLeft = (line: string) => {
    left.push(line);
    nameLeft.push(line);
  };
  const root = host.root();
  // ── Names Windows cannot keep ──
  // A folder or file whose name ends in a dot or a space, is a device name, or holds characters Windows refuses
  // (Nov 2026: a note titled "LF meeting." became a folder Windows could only reach by a special path). Planned here,
  // approved by the person once (namesAsk), then renamed through the one shared cleaner with the app's own move, so
  // links, canvases, views, file records and the index follow it; nothing is lost. Empty folders too (they hold no
  // files to list). Version control, twins, long paths and failures are left alone and said. The locked store is never
  // checked, read or repaired (10.0 v2locked): sealed files are not file records' business.
  const renames: [string, string][] = [];
  const appliedFolders: [string, string][] = [];
  const appliedFiles: [string, string][] = [];
  {
    const seen = (await host.listAll()).map((f) => f.rel);
    const have = new Set(seen.map((r) => r.toLowerCase()));
    const folders = new Set<string>();
    for (const rel of seen) {
      let d = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      while (d) {
        folders.add(d);
        d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '';
      }
    }
    // Folders under version control (a .git in them): renaming under git breaks its history, so they are left alone.
    const gitRoots = new Set<string>();
    const walkDirs = async (dir: string, rel: string, depth: number): Promise<void> => {
      if (depth > 32) return;
      // Through a \\?\ path on Windows (r2): a folder with a trailing dot is listed as named.
      const list = await fsp.readdir(win32Abs(dir, process.platform), { withFileTypes: true }).catch(() => []);
      if (list.some((x) => x.name === '.git')) gitRoots.add(rel.toLowerCase());
      for (const x of list) {
        if (!x.isDirectory() || x.name.startsWith('.') || x.name === 'node_modules') continue;
        const full = path.join(dir, x.name);
        // A link to elsewhere (a symlink, or a junction on Windows, which also answers readlink): never descended,
        // so nothing outside the vault is ever reached through it.
        if (x.isSymbolicLink() || (await fsp.readlink(full).then(() => true, () => false))) continue;
        const r = rel ? `${rel}/${x.name}` : x.name;
        if (isPrivatePath(r)) continue;
        folders.add(r);
        await walkDirs(full, r, depth + 1);
      }
    };
    await walkDirs(root, '', 0);
    const underGit = (rel: string): string | null => {
      const low = rel.toLowerCase();
      for (const g of gitRoots) if (low === g || low.startsWith(`${g}/`)) return g;
      return null;
    };
    // A candidate that resolves outside the vault (through a link the listing descended): never touched.
    let rootReal: string | null = null;
    const inside = async (rel: string): Promise<boolean> => {
      try {
        rootReal ??= await fsp.realpath(root);
        const real = await fsp.realpath(path.join(rootReal, ...rel.split('/')));
        const back = path.relative(rootReal, real);
        return back === '' || (!back.startsWith('..') && !path.isAbsolute(back));
      } catch {
        return true;
      }
    };
    // Twins that differ only by case: Windows treats them as one file, so neither is renamed blind.
    {
      const groups = new Map<string, string[]>();
      for (const rel of seen) {
        const k = rel.toLowerCase();
        groups.set(k, [...(groups.get(k) ?? []), rel]);
      }
      const twins = [...groups.values()].filter((g) => g.length > 1).sort((a, b) => (a[0] < b[0] ? -1 : 1));
      for (const g of twins.slice(0, 5)) sayLeft(`${namesWords([...g].sort())} differ only by case. Windows treats them as one file, so they were left alone. Rename one by hand to use them on Windows.`);
      if (twins.length > 5) sayLeft(`${twins.length - 5} more pairs of names differ only by case, and were left alone too.`);
    }
    // Absolute paths past what Windows opens (260): said, never shortened blind.
    {
      const long = seen.filter((rel) => path.join(root, ...rel.split('/')).length > 260).sort();
      if (long.length && long.length <= 3) {
        for (const rel of long) sayLeft(longLine(root, rel));
      } else if (long.length) {
        const top = commonDir(long);
        sayLeft(`${long.length} files under ${top} have paths past what Windows opens (260 letters). They were left alone: move the folder nearer the top.`);
      }
    }
    // An approved plan repairs only what was approved: anything newer waits for its own ask.
    const only = o.plan ? new Set(o.plan.map(([a]) => a)) : null;
    // Name repairs run only when approved (`names`, defaulting to the run itself): records and links keep their own
    // repair while names wait for the person.
    const namesApply = o.names ?? o.repair;
    // A renamed folder carries what is inside it: shallowest first, later paths mapped through earlier renames.
    // Folders move before files are planned, and only successes map (a failed folder's children keep their names
    // and say so once, instead of being tried under a name they were never given).
    const movedPrefix = new Map<string, string>();
    const at = (rel: string): string => {
      for (const [a, b] of movedPrefix) if (rel === a || rel.startsWith(`${a}/`)) return b + rel.slice(a.length);
      return rel;
    };
    const free = (rel: string): string => {
      if (!have.has(rel.toLowerCase())) return rel;
      const i = rel.lastIndexOf('/');
      const dir = i < 0 ? '' : rel.slice(0, i);
      const file = i < 0 ? rel : rel.slice(i + 1);
      const dot = file.lastIndexOf('.');
      const base = dot > 0 ? file.slice(0, dot) : file;
      const ext = dot > 0 ? file.slice(dot) : '';
      for (let n = 2; n < 10000; n++) {
        const cand = `${dir ? `${dir}/` : ''}${base} ${n}${ext}`;
        if (!have.has(cand.toLowerCase())) return cand;
      }
      return rel;
    };
    const renameLine = (from: string, to: string) => `${from}: named “${to.split('/').pop()}” now, so Windows can open it too.`;
    const gitSkipped = new Map<string, number>();
    const folderMoves: [string, string][] = [];
    const folderList = [...folders].filter((f) => !isPrivatePath(f)).sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1));
    for (const folder of folderList) {
      const cur = at(folder);
      const last = cur.split('/').pop()!;
      if (!needsWindowsRepair(last)) continue;
      const git = underGit(folder);
      if (git !== null) {
        gitSkipped.set(git, (gitSkipped.get(git) ?? 0) + 1);
        continue;
      }
      if (!(await inside(folder))) {
        sayLeft(`${folder} leads outside the vault through a link, so it was left alone.`);
        continue;
      }
      const parent = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : '';
      const to = free(`${parent ? `${parent}/` : ''}${cleanFileName(last, 'Folder', 80)}`);
      if (to.toLowerCase() === cur.toLowerCase()) continue;
      if (only && !only.has(cur)) continue;
      folderMoves.push([cur, to]);
      for (const r of [...have]) {
        if (r !== cur.toLowerCase() && !r.startsWith(`${cur.toLowerCase()}/`)) continue;
        have.delete(r);
        have.add((to + r.slice(cur.length)).toLowerCase());
      }
      have.add(to.toLowerCase());
      movedPrefix.set(folder, to);
    }
    const failed = new Map<string, string>();
    const failedKids = new Map<string, number>();
    const failedAbove = (rel: string): string | null => {
      const low = rel.toLowerCase();
      for (const f of failed.keys()) if (low === f || low.startsWith(`${f}/`)) return f;
      return null;
    };
    if (!namesApply) {
      for (const [from, to] of folderMoves) {
        if (!o.repair) fixed.push(renameLine(from, to));
        renames.push([from, to]);
      }
    } else {
      for (const [from, to] of folderMoves) {
        const above = failedAbove(from);
        if (above !== null) {
          failedKids.set(above, (failedKids.get(above) ?? 0) + 1);
          continue;
        }
        if (!host.movePath) {
          sayLeft(`${from}: its name needs repairing for Windows, which can’t be done from here.`);
          continue;
        }
        try {
          await host.movePath(from, to, true);
          fixed.push(renameLine(from, to));
          appliedFolders.push([from, to]);
          if (o.receipt) await namesApplied(root, [[from, to]]);
        } catch (err) {
          failed.set(from.toLowerCase(), moveWords(err));
        }
      }
      movedPrefix.clear();
      for (const [a, b] of appliedFolders) movedPrefix.set(a, b);
    }
    const fileMoves: [string, string][] = [];
    for (const rel of [...seen].filter((r) => !isPrivatePath(r)).sort()) {
      const cur = at(rel);
      const last = cur.split('/').pop()!;
      if (!needsWindowsRepair(last)) continue;
      if (namesApply) {
        const above = failedAbove(cur);
        if (above !== null) {
          failedKids.set(above, (failedKids.get(above) ?? 0) + 1);
          continue;
        }
      }
      const git = underGit(rel);
      if (git !== null) {
        gitSkipped.set(git, (gitSkipped.get(git) ?? 0) + 1);
        continue;
      }
      if (!(await inside(rel))) {
        sayLeft(`${rel} leads outside the vault through a link, so it was left alone.`);
        continue;
      }
      const parent = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : '';
      const to = free(`${parent ? `${parent}/` : ''}${cleanFileName(last, 'File', 180)}`);
      if (to.toLowerCase() === cur.toLowerCase()) continue;
      if (only && !only.has(cur)) continue;
      fileMoves.push([cur, to]);
      have.delete(cur.toLowerCase());
      have.add(to.toLowerCase());
    }
    if (!namesApply) {
      for (const [from, to] of fileMoves) {
        if (!o.repair) fixed.push(renameLine(from, to));
        renames.push([from, to]);
      }
    } else {
      for (const [from, to] of fileMoves) {
        if (!host.movePath) {
          sayLeft(`${from}: its name needs repairing for Windows, which can’t be done from here.`);
          continue;
        }
        try {
          await host.movePath(from, to, true);
          fixed.push(renameLine(from, to));
          appliedFiles.push([from, to]);
          if (o.receipt) await namesApplied(root, [[from, to]]);
        } catch (err) {
          sayLeft(`${from}: couldn’t be renamed (${moveWords(err)}).`);
        }
      }
      for (const [folder, reason] of failed) {
        const kids = failedKids.get(folder) ?? 0;
        const orig = folderMoves.find(([a]) => a.toLowerCase() === folder)?.[0] ?? folder;
        sayLeft(`${orig}: couldn’t be renamed (${reason})${kids ? `, so ${kids} inside ${kids === 1 ? 'kept its name' : 'kept their names'}` : ''}.`);
      }
    }
    if (o.repair && namesApply) renames.push(...folderMoves, ...fileMoves);
    for (const [git, n] of [...gitSkipped.entries()].sort()) {
      const show = seen.find((r) => r.toLowerCase() === git || r.toLowerCase().startsWith(`${git}/`))?.slice(0, git.length) ?? git;
      sayLeft(`${show}: ${n === 1 ? '1 name was' : `${n} names were`} left alone. The folder is under version control (git), and renaming would break its history.`);
    }
  }
  const files = (await host.listAll()).filter((f) => !isPrivatePath(f.rel));
  const byName = new Map<string, { at: string; size: number }[]>();
  for (const f of files) {
    const k = lower(baseOf(f.rel));
    byName.set(k, [...(byName.get(k) ?? []), { at: f.rel, size: f.size }]);
  }
  const notes = host.notes().filter((n) => !isPrivatePath(n.path));
  const folderOfNote = new Map(notes.map((n) => [n.path, folderProp(n.props)]));
  const pcCache = new Map<string, Map<string, string[]>>();
  const renamedLinks: [string, string][] = []; // vault paths of Files entries renamed or folded: old → new
  let records = 0;
  let links = 0;

  // ── After a repair: everything the moves should have carried, checked ──
  // The app's own move brings links, records and canvases with it; a crash or a missed follower between the rename
  // and those writes must never strand them. So every applied move is checked back here, scoped to what moved only:
  // a file's record under its new name, a record's note where it is now, and a note's still-stale link to a moved
  // note or file brought up to date (only links that reach nowhere now; anything resolving is left as written).
  // Silent when the move did it all, as it usually does.
  if (o.repair && (appliedFolders.length || appliedFiles.length)) {
    for (const folder of await host.sidecarFolders()) {
      if (isPrivatePath(folder)) continue;
      await host.changeSidecar(folder, (s) => {
        for (const [from, to] of [...appliedFolders, ...appliedFiles]) {
          for (const e of Object.values(s.files ?? {})) {
            if (typeof e.record === 'string' && (e.record === from || e.record.startsWith(`${from}/`))) e.record = to + e.record.slice(from.length);
          }
          const oldBase = from.split('/').pop()!;
          const newBase = to.split('/').pop()!;
          const fromDir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
          if (folder === fromDir && oldBase !== newBase) {
            const hit = Object.entries(s.files ?? {}).find(([, x]) => x.name === oldBase);
            if (hit && !Object.values(s.files ?? {}).some((x) => x.name === newBase)) {
              delete s.files[hit[0]];
              s.files[entryKey(newBase)] = { ...hit[1], name: newBase };
            }
          }
        }
      });
    }
    const oldIds = new Map<string, { to: string; note: boolean }>();
    const folderIds: [string, string][] = [];
    for (const [from, to] of appliedFiles) {
      const note = to.toLowerCase().endsWith('.md');
      for (const id of [from, from.replace(/\.md$/i, ''), from.split('/').pop()!, (from.split('/').pop()!).replace(/\.md$/i, '')]) oldIds.set(normalizeTarget(id), { to, note });
    }
    for (const [from, to] of appliedFolders) folderIds.push([from, to]);
    const bareUnique = (name: string): boolean => {
      const hits = [...(byName.get(lower(name)) ?? []), ...(byName.get(lower(`${name}.md`)) ?? [])];
      return hits.length === 1;
    };
    for (const n of notes) {
      let text: string;
      try {
        text = await host.readNote(n.path);
      } catch {
        continue;
      }
      const before = text;
      let said = '';
      const wikiNew = (target: string): string | null => {
        if (isRelativeTarget(target) || host.resolve(target, n.path)) return null;
        for (const [from, to] of folderIds) {
          if (target === from || target.startsWith(`${from}/`)) return to + target.slice(from.length);
        }
        const hit = oldIds.get(normalizeTarget(target));
        if (!hit) return null;
        if (!target.includes('/')) {
          const bare = hit.note ? hit.to.replace(/\.md$/i, '').split('/').pop()! : hit.to.split('/').pop()!;
          if (bareUnique(hit.note ? `${bare}.md` : bare)) return bare;
        }
        return hit.note ? hit.to.replace(/\.md$/i, '') : hit.to;
      };
      text = replaceWikilinks(text, (link, raw, embed) => {
        const to = wikiNew(link.target);
        if (!to || to === link.target) return raw;
        said = said || `${n.path}: its link to ${link.target} now goes to ${to}.`;
        return `${embed ? '!' : ''}[[${to}${link.heading ? `#${link.heading}` : ''}${link.alias ? `|${link.alias}` : ''}]]`;
      });
      text = replaceMarkdownLinks(text, (target, fragment, raw, embed, label) => {
        if (/^(https?:|mailto:|#|file:)/.test(target) || isRelativeTarget(target) || host.resolve(target, n.path)) return raw;
        for (const [from, to] of folderIds) {
          if (target === from || target.startsWith(`${from}/`)) {
            const next = to + target.slice(from.length);
            said = said || `${n.path}: its link to ${target} now goes to ${next}.`;
            return `${embed ? '!' : ''}[${label}](${encodeLinkPath(next)}${fragment})`;
          }
        }
        const hit = oldIds.get(normalizeTarget(target));
        if (!hit) return raw;
        const next = hit.to;
        said = said || `${n.path}: its link to ${target} now goes to ${next}.`;
        return `${embed ? '!' : ''}[${label}](${encodeLinkPath(next)}${fragment})`;
      });
      if (text !== before) {
        await host.writeNote(n.path, text);
        if (said) fixed.push(said);
      }
    }
  }

  // ── File records ──
  for (const folder of (await host.sidecarFolders()).filter((f) => !isPrivatePath(f))) {
    const s = await host.readSidecar(folder);
    const entries = Object.values(s.files ?? {});
    records += entries.length;
    const plan: { drop: string[]; rename: [string, string][]; repoint: [string, string, number][]; follow: [string, string][] } = { drop: [], rename: [], repoint: [], follow: [] };
    const where = (n: string) => (folder ? `${folder}/${n}` : n);
    // Linked where they are on this PC: each pointed at its file (found again when it has moved), then the records of
    // one file folded into the one named as the file is.
    const targetOf = new Map<FileEntry, string>();
    for (const e of entries.filter((x) => x.ref?.path)) {
      const target = e.ref!.path;
      if (await isFile(target)) {
        targetOf.set(e, target);
        continue;
      }
      const name = winBase(target);
      const project = e.record ? folderOfNote.get(e.record) : null;
      const onPc = project ? await filesNamed(project, name, pcCache) : [];
      const sized = await Promise.all(onPc.map(async (at) => ({ at, size: (await isFile(at))?.size })));
      const one = pick(sized, e.ref!.size, project ?? '');
      if (one) {
        plan.repoint.push([e.name, one.at, one.size ?? e.ref!.size]);
        fixed.push(`${where(e.name)}: its file had moved on this PC; it points to ${one.at} again.`);
        targetOf.set(e, one.at);
      } else left.push(`${where(e.name)}: the file it links to, ${target}, isn’t on this PC any more${onPc.length > 1 ? ` (${onPc.length} files of that name are in the project’s folder)` : ''}.`);
    }
    const groups = new Map<string, FileEntry[]>();
    const spelt = new Map<string, string>();
    for (const [e, t] of targetOf) {
      groups.set(lower(t), [...(groups.get(lower(t)) ?? []), e]);
      spelt.set(lower(t), t);
    }
    for (const [key, group] of groups) {
      const real = winBase(spelt.get(key) ?? key);
      const keep = group.find((x) => lower(x.name) === lower(real)) ?? group[0];
      for (const e of group) {
        if (e === keep) continue;
        plan.drop.push(e.name);
        renamedLinks.push([where(e.name), where(lower(keep.name) === lower(real) ? keep.name : real)]);
        fixed.push(`${where(e.name)}: a second record of ${real}; folded into one record named “${real}”.`);
      }
      if (lower(keep.name) !== lower(real) && !entries.some((x) => !group.includes(x) && lower(x.name) === lower(real))) {
        plan.rename.push([keep.name, real]);
        renamedLinks.push([where(keep.name), where(real)]);
        fixed.push(`${where(keep.name)}: renamed “${real}”, as its file is called, so it can be found.`);
      }
    }
    // Kept in the vault.
    for (const e of entries.filter((x) => !x.ref)) {
      if (await isFile(path.join(root, ...where(e.name).split('/')))) continue;
      const found = (byName.get(lower(e.name)) ?? []).filter((f) => f.at !== where(e.name));
      const one = pick(found, e.size, where(e.name));
      if (one && /\.md$/i.test(e.name)) {
        // A file that became a note: a note needs no file record.
        plan.drop.push(e.name);
        fixed.push(`${where(e.name)}: it is a note now (${one.at}), so its old file record was taken out.`);
      } else if (one) {
        plan.follow.push([e.name, one.at]);
        fixed.push(`${where(e.name)}: the file is now at ${one.at}; its record went with it.`);
      } else if (found.length) {
        left.push(`${where(e.name)}: no longer beside its record; ${found.length} files of that name are in the vault (${found.map((f) => f.at).slice(0, 3).join(', ')}).`);
      } else {
        plan.drop.push(e.name);
        fixed.push(`${where(e.name)}: the file is gone from the vault, so its record (it said the file was here) was taken out.`);
      }
    }
    if (!o.repair || !(plan.drop.length || plan.rename.length || plan.repoint.length || plan.follow.length)) continue;
    const moving: FileEntry[] = [];
    await host.changeSidecar(folder, (sc) => {
      const get = (n: string) => Object.entries(sc.files).find(([, x]) => lower(x.name) === lower(n));
      for (const [name, at, size] of plan.repoint) {
        const hit = get(name);
        if (hit?.[1].ref) hit[1].ref = { ...hit[1].ref, path: at, size };
      }
      for (const name of plan.drop) {
        const hit = get(name);
        if (!hit) continue;
        const [key, gone] = hit;
        delete sc.files[key];
        // Its words kept by the record it was folded into, when that one has none.
        const keep = gone.ref ? Object.values(sc.files).find((x) => x.ref && lower(x.ref.path) === lower(gone.ref!.path)) : undefined;
        if (keep && !keep.summary && gone.summary) Object.assign(keep, { summary: gone.summary, summaryBy: gone.summaryBy });
      }
      for (const [from, to] of plan.rename) {
        const hit = get(from);
        if (!hit) continue;
        delete sc.files[hit[0]];
        sc.files[entryKey(to)] = { ...hit[1], name: to };
      }
      for (const [name] of plan.follow) {
        const hit = get(name);
        if (!hit) continue;
        delete sc.files[hit[0]];
        moving.push(hit[1]);
      }
    });
    for (const e of moving) {
      const to = plan.follow.find(([n]) => n === e.name)![1];
      const dir = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '';
      await host.changeSidecar(dir, (sc) => {
        sc.files[entryKey(baseOf(to))] = { ...e, name: baseOf(to) };
      });
    }
  }

  // ── Links in notes ──
  const moved = new Map(renamedLinks.map(([a, b]) => [lower(a), b]));
  for (const n of notes) {
    let text: string;
    try {
      text = await host.readNote(n.path);
    } catch {
      continue;
    }
    let changed = false;
    const out = text.replace(LINKS, (whole, wBang: string, wTarget: string | undefined, wRest: string, mBang: string, mWords: string, mTarget: string | undefined) => {
      const raw = (wTarget ?? mTarget ?? '').trim();
      const target = raw.startsWith('<') ? raw.slice(1, -1) : raw;
      let decoded = target;
      try {
        decoded = decodeURIComponent(target);
      } catch {
        /* as written */
      }
      links++;
      const folded = moved.get(lower(decoded)) ?? moved.get(lower(path.posix.join(path.posix.dirname(n.path), decoded)));
      let to: string | null = folded ?? null;
      if (!to) {
        if (host.resolve(decoded, n.path)) return whole;
        const found = byName.get(lower(baseOf(decoded))) ?? [];
        const one = pick(found, undefined, n.path);
        if (!one) {
          left.push(found.length ? `${n.path}: its link to ${decoded} could be any of ${found.length} files of that name (${found.map((f) => f.at).slice(0, 3).join(', ')}).` : `${n.path}: links to ${decoded}, which isn’t in the vault.`);
          return whole;
        }
        to = one.at;
      }
      changed = true;
      fixed.push(`${n.path}: its link to ${decoded} now goes to ${to}.`);
      if (wTarget !== undefined) return `${wBang}[[${to}${wRest}]]`;
      const shown = /[\s()<>]/.test(to) ? `<${to}>` : to;
      return `${mBang}[${mWords}](${raw.startsWith('<') || !/%[0-9A-F]{2}/i.test(target) ? shown : encodeURI(to)})`;
    });
    if (changed && o.repair) await host.writeNote(n.path, out);
  }

  // ── A project's Documents list ──
  // Each line names a file in the project's folder on the PC ("`Designs/Report.pdf` — what it is"). One naming a file that
  // isn't there (its name alone, or the words written inside the quotes) is pointed at the one file of that name in the
  // folder; one kept in the vault becomes a link to it.
  for (const n of notes) {
    const folder = folderOfNote.get(n.path);
    if (!folder) continue;
    let text: string;
    try {
      text = await host.readNote(n.path);
    } catch {
      continue;
    }
    const lines = text.split('\n');
    let inDocs = false;
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^##\s/.test(line)) inDocs = /^##\s+Documents\s*$/i.test(line.trim());
      if (!inDocs) continue;
      const m = /^(\s*[-*]\s+)`([^`]+)`\s*(?:[—–:·-]\s*(.*))?$/.exec(line.replace(/\r$/, ''));
      if (!m) continue;
      let [, lead, inside, what] = m;
      inside = inside.trim();
      if (!what && !/\.[A-Za-z0-9]{2,5}$/.test(inside)) {
        const split = /^(.+?\.[A-Za-z0-9]{2,5})\s+[—–-]\s+(.+)$/.exec(inside);
        if (!split) continue;
        [, inside, what] = split;
      }
      const name = inside.replace(/\\/g, '/');
      links++;
      // A whole path names its place itself (often another project's folder): checked as written, never guessed.
      if (/^([A-Za-z]:\/|\/)/.test(name)) {
        if (!(await isFile(inside))) left.push(`${n.path}: its Documents list names ${inside}, which isn’t on this PC.`);
        continue;
      }
      const here = await isFile(path.join(folder, ...name.split('/')));
      let next: string | null = null;
      if (here) {
        if (m[2].trim() !== inside) next = `${lead}\`${name}\`${what ? ` — ${what}` : ''}`;
      } else {
        const onPc = await filesNamed(folder, baseOf(name), pcCache);
        if (onPc.length === 1) {
          const rel = path.relative(folder, onPc[0]).split(path.sep).join('/');
          next = `${lead}\`${rel}\`${what ? ` — ${what}` : ''}`;
          fixed.push(`${n.path}: its Documents line for ${baseOf(name)} now names where it is in the project’s folder (${rel}).`);
        } else {
          const inVault = byName.get(lower(baseOf(name))) ?? [];
          const one = onPc.length ? null : pick(inVault, undefined, n.path);
          if (one) {
            next = `${lead}[[${one.at}]]${what ? ` — ${what}` : ''}`;
            fixed.push(`${n.path}: its Documents line for ${baseOf(name)} now links to it in the vault (${one.at}).`);
          } else left.push(`${n.path}: its Documents list names ${name}, ${onPc.length > 1 ? `and ${onPc.length} files of that name are in the project’s folder` : 'which isn’t in the project’s folder or the vault'}.`);
        }
      }
      if (next !== null && next !== line) {
        lines[i] = next;
        changed = true;
      }
    }
    if (changed && o.repair) await host.writeNote(n.path, lines.join('\n'));
  }

  // ── Notes that hold almost nothing ──
  // One quiet line offering them for a look-over (v4-no-clutter item 5): listed, never touched. Empty notes stay the
  // weekly tidy's; fresh notes, templates, projects and the Inbox are never offered. Big notes can't be thin (their
  // size says so without reading them), so the scan stays quick on a big vault. The one thin reading
  // (src/shared/weekly-tidy.ts isThinNote): the tidy's thin lines answer this list (Nov 2026, b6 break job).
  const thin: { path: string; title: string; words: number }[] = [];
  {
    const templates = `${(o.templatesFolder ?? 'Templates').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()}/`;
    const filesByRel = new Map(files.map((x) => [x.rel.toLowerCase(), x]));
    const nowMs = Date.now();
    for (const n of notes) {
      if (isPrivatePath(n.path)) continue;
      if (`${n.path.toLowerCase()}/`.startsWith(templates)) continue;
      if (n.path.toLowerCase() === INBOX_NOTE.toLowerCase()) continue;
      if (typeof n.props?.type === 'string' && n.props.type.toLowerCase() === 'project') continue;
      const f = filesByRel.get(n.path.toLowerCase());
      if (f && f.size > 6000) continue;
      if (f?.mtime !== undefined && nowMs - f.mtime < SETTLED_MS) continue;
      let text: string;
      try {
        text = await host.readNote(n.path);
      } catch {
        continue;
      }
      // No mtime from the listing (an old host): the note's age from the disk, so fresh notes are never offered.
      let mtime = f?.mtime;
      if (mtime === undefined) {
        const st = await fsp.stat(win32Abs(path.join(root, ...n.path.split('/')), process.platform)).catch(() => null);
        if (!st) continue;
        mtime = st.mtimeMs;
      }
      if (!isThinNote(text, mtime, nowMs)) continue;
      const title = /^\s*#{1,6}\s+(.+)$/m.exec(text)?.[1]?.trim() || baseOf(n.path).replace(/\.md$/i, '');
      thin.push({ path: n.path, title, words: bodyWords(text) });
      if (thin.length >= 50) break;
    }
    thin.sort((a, b) => a.path.localeCompare(b.path));
  }

  const unique = (a: string[]) => [...new Set(a)];
  const f = unique(fixed);
  const l = unique(left);
  const checked = { notes: notes.length, files: files.length, records, links };
  const scope = `Checked ${checked.notes} notes, ${checked.files} files, ${checked.records} file records and ${checked.links} links to files.`;
  const line = thin.length ? `${thinNotice(thin).title}: ${namesWords(thin.map((t) => t.title))}. Nothing was moved — say which to put in the Bin.` : '';
  const words = [
    scope,
    f.length ? `${o.repair ? 'Put right' : 'Would put right'} (${f.length}):\n${f.map((x) => `- ${x}`).join('\n')}` : 'Nothing needed putting right.',
    l.length ? `Needs you (${l.length}):\n${l.map((x) => `- ${x}`).join('\n')}` : '',
    line,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { fixed: f, left: l, checked, thin, words, renames, nameLeft: unique(nameLeft) };
}
