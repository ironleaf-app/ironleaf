// The vault's own Bin (5 Nov 2026). Nothing the Vault's assistant takes out is deleted for good: a note, canvas, view,
// file or folder goes to the Bin, kept 30 days with who took it out, when and why, and comes back where it was with
// Restore. The Bin is inside the vault (.neuralvault/bin, a hidden folder the index and every AI's reads leave out), so
// it travels with the notes and a second PC sees the same Bin — the same Bin the former host app's Bin tool uses (its
// vault-bin.mjs), on purpose: one Bin, both apps, Recently deleted showing the same items however they got there. Each
// item is a folder of its own:
//   .neuralvault/bin/<id>/item.json   {id, path, kind, title, by, at, why, files?, attachments?}
//   .neuralvault/bin/<id>/item/…      the note (or folder) as it was, and a note's own Files folder beside it
// Restore puts it back at its path (a free name when something else is there now). After 30 days an item leaves the Bin;
// that is the only removal, and it is the Bin's, never a tool's. The operating system's trash is never used for the
// vault here: what went there could not be listed or brought back by anyone but the person.

import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { emailAttachmentsFor, isEmailNoteText } from '../shared/email-note';
import { filesFolderFor, ownsFolder, parseSidecar, writeSidecar } from '../shared/file-records';

export const BIN_DIR = '.neuralvault/bin';
export const KEEP_DAYS = 30;
const DAY = 86400000;
const ID = /^[a-z0-9]{6,12}-[a-z0-9]{4,10}$/;
const KIND_WORDS: Record<string, string> = { note: 'note', canvas: 'canvas', view: 'view', file: 'file', folder: 'folder' };

export type BinKind = 'note' | 'canvas' | 'view' | 'file' | 'folder';

export interface BinItem {
  id: string;
  /** Where it was in the vault. */
  path: string;
  kind: BinKind;
  title: string;
  by: string;
  at: number;
  why?: string;
  /** A folder: how many notes went with it, said when it goes and when it comes back. */
  notes?: number;
  /** A note's words as a fingerprint, so an item back where it was word for word leaves the Bin. */
  sha?: string;
  /** Its own Files folder, moved with it. */
  files?: string;
  /** Its Files folder, when it could not move with it. */
  filesLeftBehind?: string;
  /** An email note's attachments folder, moved with it (t244: the front door's own rule, emailAttachmentsFor). */
  attachments?: string;
  /** Its attachments folder, when it could not move with it. */
  attachmentsLeftBehind?: string;
}

export interface BinListed extends BinItem {
  daysLeft: number;
}

export interface BinRestored extends BinItem {
  /** Where it came back (a free name when something else is there now). */
  restored: string;
  renamed: boolean;
}

const sha = (text: string | null): string | null => (text === null ? null : createHash('sha256').update(text).digest('hex'));
const kindOf = (rel: string): BinKind => (/\.md$/i.test(rel) ? 'note' : /\.canvas$/i.test(rel) ? 'canvas' : /\.(view\.json|base)$/i.test(rel) ? 'view' : 'file');
const titleOf = (rel: string): string => (rel.split('/').pop() ?? rel).replace(/\.(md|canvas|view\.json|base)$/i, '');
const folderOf = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const dayWords = (ms: number): string => new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
const daysLeft = (at: number, now: number): number => Math.max(0, Math.ceil((at + KEEP_DAYS * DAY - now) / DAY));
const listWords = (titles: string[]): string => (titles.length < 2 ? titles.join('') : `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`);

async function moveTo(src: string, dest: string): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  // Across drives (a OneDrive placeholder can refuse a rename): copy, then take the original away. When the copy
  // lands but the original cannot go, the copy is taken back: a failed move leaves one copy, where it was.
  try {
    await rename(src, dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EXDEV' && (error as NodeJS.ErrnoException)?.code !== 'EPERM') throw error;
    await cp(src, dest, { recursive: true, errorOnExist: true, force: false });
    try {
      await rm(src, { recursive: true, force: true });
    } catch (rmError) {
      await rm(dest, { recursive: true, force: true }).catch(() => {});
      throw rmError;
    }
  }
}

/** The notes under a folder, vault-relative from it (a folder's count, said when it goes to the Bin). */
async function notesUnder(dir: string, base = ''): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = await readdir(base ? path.join(dir, ...base.split('/')) : dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT' || (error as NodeJS.ErrnoException)?.code === 'ENOTDIR') return out;
    throw new Error(`Could not read the folder: ${String((error as Error)?.message ?? error)}`);
  }
  for (const e of entries) {
    const r = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory() && !e.name.startsWith('.')) out.push(...(await notesUnder(dir, r)));
    else if (e.isFile() && /\.md$/i.test(e.name)) out.push(r);
  }
  return out;
}

async function pruneEmpty(dir: string, stop: string): Promise<void> {
  for (let i = 0; i < 8 && path.resolve(dir) !== path.resolve(stop) && path.resolve(dir).startsWith(`${path.resolve(stop)}${path.sep}`); i++) {
    try {
      if ((await readdir(dir)).length) return;
      await rmdir(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

/** A vault-relative path cleaned, or '' when it is not one (outside the vault, the Bin itself, Private notes). */
export function cleanBinRel(given: unknown): string {
  if (typeof given !== 'string') return '';
  const rel = given.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  if (!rel || rel.split('/').includes('..') || rel === '.neuralvault' || rel.startsWith('.neuralvault/') || rel.split('/')[0].toLowerCase() === 'private') return '';
  return rel;
}

/** What `which` means: an id, a path, a title, else the one sure near title ("restore kick off" is Kick-off).
 *  Shared by restore and the gate (which checks what it means before it comes back). */
export function matchBinItems(items: BinItem[], given: string): { matches: BinItem[]; suggestions: string[] } {
  const w = String(given ?? '').trim();
  const byId = items.find((x) => x.id === w);
  if (byId) return { matches: [byId], suggestions: [] };
  const byPath = items.filter((x) => x.path.toLowerCase() === w.replace(/\\/g, '/').toLowerCase());
  if (byPath.length) return { matches: byPath, suggestions: [] };
  const titled = items.filter((x) => x.title.toLowerCase() === titleOf(w).toLowerCase());
  if (titled.length) return { matches: titled, suggestions: [] };
  return nearTitled(titleOf(w), items);
}

/** The one near title ("restore kick off" is Kick-off), else did-you-mean suggestions. */
function nearTitled(want: string, items: BinItem[]): { matches: BinItem[]; suggestions: string[] } {
  const low = want.toLowerCase();
  const words = low.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const scored = items
    .map((it) => {
      const title = it.title.toLowerCase();
      if (title === low) return { it, score: 100 };
      if (title.replace(/[^a-z0-9]+/g, '') === low.replace(/[^a-z0-9]+/g, '')) return { it, score: 90 };
      if (!words.length) return { it, score: 0 };
      const hit = words.filter((w) => title.includes(w)).length;
      return { it, score: hit === words.length ? 50 + words.length : hit ? 10 + hit : 0 };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  const matches = scored.length === 1 || (scored.length > 1 && scored[0].score >= 50 && scored[1].score < scored[0].score) ? [scored[0].it] : [];
  return { matches, suggestions: scored.slice(0, 3).map((s) => s.it.title) };
}

/** The Bin over one vault folder. `now` is the clock (tests move it past 30 days). */
export function createVaultBin({ root, now = () => Date.now() }: { root: string; now?: () => number }): {
  put(rel: string, opts?: { by?: string; why?: string }): Promise<BinItem>;
  list(): Promise<BinListed[]>;
  restore(which: string): Promise<BinRestored>;
  forget(id: string): Promise<{ forgotten: boolean }>;
} {
  const binOf = () => path.join(root, ...BIN_DIR.split('/'));
  const full = (rel: string) => path.join(root, ...rel.split('/'));

  async function readItem(id: string): Promise<BinItem | null> {
    try {
      const v = JSON.parse(await readFile(path.join(binOf(), id, 'item.json'), 'utf8')) as BinItem;
      return v && v.id === id && typeof v.path === 'string' ? v : null;
    } catch {
      return null;
    }
  }

  /** A move the app died inside of, finished: the note already across gets its card (with the Files
   *  beside it when they came too); an intent with nothing across is cleaned, the original untouched. */
  async function recoverMoving(id: string): Promise<BinItem | null> {
    const home = path.join(binOf(), id);
    let moving: { path?: unknown; kind?: unknown; title?: unknown; by?: unknown; at?: unknown; why?: unknown; sha?: unknown } | null = null;
    try {
      moving = JSON.parse(await readFile(path.join(home, 'moving.json'), 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (!moving || typeof moving.path !== 'string' || !moving.path) {
      await rm(home, { recursive: true, force: true }).catch(() => {});
      return null;
    }
    const itemFile = path.join(home, 'item', path.posix.basename(moving.path));
    const across = await stat(itemFile).then(() => true, () => false);
    if (!across) {
      await rm(home, { recursive: true, force: true }).catch(() => {});
      return null;
    }
    // Its Files folder came across too when it sits beside the note (put moves it before its card).
    const own = filesFolderFor(moving.path);
    const filesHome = await stat(path.join(home, 'files', path.posix.basename(own))).then(() => true, () => false);
    const files = filesHome ? own : undefined;
    // Its email attachments too, when they came across (put moves them beside the Files, under their own name).
    const att = emailAttachmentsFor(moving.path);
    const attHome = att ? await stat(path.join(home, 'attachments', path.posix.basename(att))).then(() => true, () => false) : false;
    const attachments = att && attHome ? att : undefined;
    const item: BinItem = {
      id,
      path: moving.path,
      kind: moving.kind === 'folder' || moving.kind === 'canvas' || moving.kind === 'view' || moving.kind === 'file' ? moving.kind : 'note',
      title: typeof moving.title === 'string' && moving.title ? moving.title : titleOf(moving.path),
      by: typeof moving.by === 'string' && moving.by ? moving.by.slice(0, 80) : 'The side chat',
      at: typeof moving.at === 'number' && Number.isFinite(moving.at) ? moving.at : now(),
      ...(typeof moving.why === 'string' && moving.why ? { why: moving.why.slice(0, 300) } : {}),
      ...(typeof moving.sha === 'string' && moving.sha ? { sha: moving.sha } : {}),
      ...(files ? { files } : {}),
      ...(attachments ? { attachments } : {}),
    };
    await writeFile(path.join(home, 'item.json'), `${JSON.stringify(item, null, '\t')}\n`);
    await rm(path.join(home, 'moving.json'), { force: true }).catch(() => {});
    return item;
  }

  async function items(): Promise<BinItem[]> {
    let names: string[] = [];
    try {
      names = (await readdir(binOf(), { withFileTypes: true })).filter((e) => e.isDirectory() && ID.test(e.name)).map((e) => e.name);
    } catch {
      return [];
    }
    const out: BinItem[] = [];
    for (const id of names) {
      const item = await readItem(id);
      if (item) {
        out.push(item);
        continue;
      }
      const recovered = await recoverMoving(id).catch(() => null);
      if (recovered) out.push(recovered);
    }
    return out.sort((a, b) => b.at - a.at);
  }

  /** Items older than 30 days leave the Bin; an item whose note is back where it was, word for word (Undo put it
   *  back), leaves it too, as it is not missing any more; its Files home with it, never deleted with the Bin copy.
   *  When its Files cannot come home, the item stays, so they are never lost. */
  async function prune(): Promise<BinItem[]> {
    const all = await items();
    const left: BinItem[] = [];
    for (const it of all) {
      if (now() - it.at > KEEP_DAYS * DAY) {
        await rm(path.join(binOf(), it.id), { recursive: true, force: true });
        continue;
      }
      if (it.kind !== 'folder' && it.sha) {
        const back = await readFile(full(it.path), 'utf8').catch(() => null);
        if (back !== null && sha(back) === it.sha) {
          if (it.files) {
            const from = path.join(binOf(), it.id, 'files', path.basename(it.files));
            const there = await stat(from).then(() => true, () => false);
            if (there) {
              let target = it.files;
              try {
                await stat(full(target));
                target = `${target} (restored)`;
              } catch {
                // Free: home where it was.
              }
              try {
                await moveTo(from, full(target));
              } catch {
                left.push(it);
                continue;
              }
            }
          }
          // Its email attachments home with it too; when they cannot, the item stays, never half restored.
          if (it.attachments) {
            const from = path.join(binOf(), it.id, 'attachments', path.basename(it.attachments));
            const there = await stat(from).then(() => true, () => false);
            if (there) {
              let target = it.attachments;
              try {
                await stat(full(target));
                target = `${target} (restored)`;
              } catch {
                // Free: home where it was.
              }
              try {
                await moveTo(from, full(target));
              } catch {
                left.push(it);
                continue;
              }
            }
          }
          await rm(path.join(binOf(), it.id), { recursive: true, force: true });
          continue;
        }
      }
      left.push(it);
    }
    return left;
  }

  /**
   * Into the Bin: a note, canvas, view or file in the vault, or a folder (a project's whole folder) with everything
   * in it. A note that keeps its files in a folder of its own takes them with it. Never anything for good: restore
   * brings it back.
   */
  async function put(given: string, { by = 'The side chat', why = '' }: { by?: string; why?: string } = {}): Promise<BinItem> {
    const rel = cleanBinRel(given);
    if (!rel) throw new Error('That isn’t something in the notes that can go to the Bin (Private notes and hidden folders are their own).');
    const src = full(rel);
    let folder = false;
    try {
      folder = (await stat(src)).isDirectory();
    } catch {
      throw new Error(`There is nothing at ${rel} in the notes.`);
    }
    if (folder && !rel.includes('/') && /^(?:\d+[\s._-]*)?(projects|notes|people|files|assets|templates|views|docs)$/i.test(rel))
      throw new Error(`${rel} is one of the vault’s own folders; take out what is in it instead.`);
    const kind: BinKind = folder ? 'folder' : kindOf(rel);
    const text = kind === 'note' || kind === 'canvas' || kind === 'view' ? await readFile(src, 'utf8').catch(() => null) : null;
    const notes = folder ? (await notesUnder(src)).length : undefined;
    const id = `${now().toString(36)}-${randomBytes(4).toString('hex').slice(0, 6)}`;
    const home = path.join(binOf(), id);
    const dest = path.join(home, 'item', path.basename(src));
    // The intent first, so an app dying mid-move is finished on the next list (recoverMoving): the note
    // already across gets its card, and nothing across is cleaned with the original untouched.
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, 'moving.json'), `${JSON.stringify({ id, path: rel, kind, title: titleOf(rel), by: String(by || 'The side chat').slice(0, 80), at: now(), ...(why ? { why: String(why).replace(/\s+/g, ' ').trim().slice(0, 300) } : {}), ...(text !== null && sha(text) ? { sha: sha(text) } : {}) })}\n`);
    await moveTo(src, dest);
    // From here a failure puts it all back where it was and leaves no half item: a failed move never destroys anything.
    let filesHome = '';
    let attachmentsHome = '';
    try {
      // A note's own Files folder goes with it (a project's note shares its folder's Files, which stays);
      // when it cannot move, the note still goes and the reply says its files stayed behind.
      let files: string | undefined;
      let filesLeftBehind: string | undefined;
      if (kind === 'note' && !ownsFolder(rel)) {
        const own = filesFolderFor(rel);
        // Most notes have no Files folder: that is not "left behind", only a folder that failed to move is.
        const hasFiles = await stat(full(own)).then((s) => s.isDirectory(), () => false);
        if (hasFiles) {
          try {
            await moveTo(full(own), path.join(home, 'files', path.basename(own)));
            files = own;
            filesHome = own;
            await pruneEmpty(path.dirname(full(own)), root);
          } catch {
            filesLeftBehind = own;
          }
        }
      }
      // An email note's attachments go with it too (t244: the Bin left them orphaned, because only the front
      // door knew where they sit; the front door's own rule now, emailAttachmentsFor). Only an email note's:
      // any other note leaves a same-named folder alone.
      let attachments: string | undefined;
      let attachmentsLeftBehind: string | undefined;
      if (kind === 'note' && text !== null && isEmailNoteText(text)) {
        const att = emailAttachmentsFor(rel);
        const hasAtt = att ? await stat(full(att)).then((s) => s.isDirectory(), () => false) : false;
        if (att && hasAtt) {
          try {
            await moveTo(full(att), path.join(home, 'attachments', path.basename(att)));
            attachments = att;
            attachmentsHome = att;
            await pruneEmpty(path.dirname(full(att)), root);
          } catch {
            attachmentsLeftBehind = att;
          }
        }
      }
      const item: BinItem = { id, path: rel, kind, title: titleOf(rel), by: String(by || 'The side chat').slice(0, 80), at: now(), ...(why ? { why: String(why).replace(/\s+/g, ' ').trim().slice(0, 300) } : {}), ...(text !== null ? { sha: sha(text)! } : {}), ...(notes !== undefined ? { notes } : {}), ...(files ? { files } : {}), ...(filesLeftBehind ? { filesLeftBehind } : {}), ...(attachments ? { attachments } : {}), ...(attachmentsLeftBehind ? { attachmentsLeftBehind } : {}) };
      await mkdir(home, { recursive: true });
      await writeFile(path.join(home, 'item.json'), `${JSON.stringify(item, null, '\t')}\n`);
      await rm(path.join(home, 'moving.json'), { force: true }).catch(() => {});
      await pruneEmpty(path.dirname(src), root);
      return item;
    } catch (error) {
      if (filesHome) await moveTo(path.join(home, 'files', path.basename(filesHome)), full(filesHome)).catch(() => {});
      if (attachmentsHome) await moveTo(path.join(home, 'attachments', path.basename(attachmentsHome)), full(attachmentsHome)).catch(() => {});
      await moveTo(dest, src).catch(() => {});
      await rm(home, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  /** What is in the Bin, newest first. */
  async function list(): Promise<BinListed[]> {
    return (await prune()).map((it) => ({ ...it, daysLeft: daysLeft(it.at, now()) }));
  }

  /** Back where it was (a free name when something is there now), its own files with it; links to it work again. */
  async function restore(given: string): Promise<BinRestored> {
    const all = await prune();
    const w = String(given ?? '').trim();
    const { matches, suggestions } = matchBinItems(all, w);
    if (!matches.length) throw new Error(`Nothing called “${w}” is in the Bin (it keeps things ${KEEP_DAYS} days). Bin list shows what is there.${suggestions.length ? ` Did you mean ${listWords(suggestions.slice(0, 3).map((s) => `“${s}”`))}?` : ''}`);
    // Two of the same name (or path) in the Bin are named with their ids — restoring the wrong one is never a guess.
    if (matches.length > 1) throw new Error(`“${w}” is in the Bin ${matches.length} times: ${matches.slice(0, 5).map((x) => `“${x.title}” (was ${x.path}, taken out ${dayWords(x.at)} by ${x.by}) [${x.id}]`).join('; ')}. Give its id, as list shows it.`);
    const it = matches[0];
    const home = path.join(binOf(), it.id);
    const src = path.join(home, 'item', path.basename(it.path));
    let rel = it.path;
    let renamed = false;
    try {
      await stat(full(rel));
      renamed = true;
      const dot = /^(.*?)((?:\.view\.json|\.[A-Za-z0-9]{1,8})?)$/.exec(path.posix.basename(rel))!;
      for (let i = 1; i < 1000; i++) {
        const next = `${folderOf(rel) ? `${folderOf(rel)}/` : ''}${dot[1]} (restored${i > 1 ? ` ${i}` : ''})${dot[2]}`;
        try {
          await stat(full(next));
        } catch {
          rel = next;
          break;
        }
      }
    } catch {
      // Nothing there now: back where it was.
    }
    await moveTo(src, full(rel));
    let files: string | undefined;
    let filesLeftBehind: string | undefined;
    if (it.files) {
      const from = path.join(home, 'files', path.basename(it.files));
      try {
        await stat(from);
        const to = renamed ? `${folderOf(it.files)}/${titleOf(rel)}` : it.files;
        let target = to;
        try {
          await stat(full(target));
          target = `${to} (restored)`;
        } catch {
          // Free: back where it was.
        }
        await moveTo(from, full(target));
        files = target;
        // The files' record names the note they belong to: the restored note, under its new name when it has one.
        if (renamed || target !== it.files) {
          const side = path.join(full(target), '.files.json');
          const s = parseSidecar(await readFile(side, 'utf8').catch(() => null));
          for (const e of Object.values(s.files)) e.record = rel;
          await writeFile(side, writeSidecar(s));
        }
      } catch {
        filesLeftBehind = it.files;
      }
    }
    // An email note's attachments come back with it; renamed, beside the restored note under its new name.
    let attachments: string | undefined;
    let attachmentsLeftBehind: string | undefined;
    if (it.attachments) {
      const from = path.join(home, 'attachments', path.basename(it.attachments));
      try {
        await stat(from);
        const to = renamed ? (emailAttachmentsFor(rel) ?? it.attachments) : it.attachments;
        let target = to;
        try {
          await stat(full(target));
          target = `${to} (restored)`;
        } catch {
          // Free: back where it was.
        }
        await moveTo(from, full(target));
        attachments = target;
      } catch {
        attachmentsLeftBehind = it.attachments;
      }
    }
    // Files that could not come back stay in the Bin's home (never deleted with it), named for the retry.
    if (filesLeftBehind || attachmentsLeftBehind) {
      await rm(path.join(home, 'item'), { recursive: true, force: true }).catch(() => {});
      await rm(path.join(home, 'item.json'), { force: true }).catch(() => {});
    } else await rm(home, { recursive: true, force: true });
    return { ...it, restored: rel, renamed, ...(files ? { files } : {}), ...(filesLeftBehind ? { filesLeftBehind } : {}), ...(attachments ? { attachments } : {}), ...(attachmentsLeftBehind ? { attachmentsLeftBehind } : {}) };
  }

  /** One item removed for good before its 30 days (Recently deleted's Delete now, or Empty all). Never a tool's. */
  async function forget(given: string): Promise<{ forgotten: boolean }> {
    if (!ID.test(String(given ?? ''))) return { forgotten: false };
    const found = await readItem(String(given));
    if (!found) return { forgotten: false };
    await rm(path.join(binOf(), found.id), { recursive: true, force: true });
    return { forgotten: true };
  }

  return { put, list, restore, forget };
}

/** The words for things taken out, put back, or the Bin's list (the same words the former host app's Bin tool uses, so
 *  both doors read the same). A folder says its name and how many notes went with it, never "1 note". */
export function binnedWords(items: { path: string; title?: string; kind?: string; notes?: number; filesLeftBehind?: string; attachmentsLeftBehind?: string; error?: string }[]): string {
  const ok = items.filter((x) => !x.error);
  const bad = items.filter((x) => x.error);
  const named = (x: { title?: string; kind?: string; notes?: number }): string => (x.kind === 'folder' ? `the folder “${x.title}”${x.notes ? ` with ${x.notes} ${x.notes === 1 ? 'note' : 'notes'}` : ''}` : `“${x.title}”`);
  const said: string[] = [];
  if (ok.length === 1 && ok[0].kind === 'folder') said.push(`Moved ${named(ok[0])} to the Bin. It can be restored for ${KEEP_DAYS} days.`);
  else if (ok.length)
    said.push(
      `Moved ${ok.length === 1 ? `“${ok[0].title}”` : `${ok.length} items`} to the Bin${ok.length > 1 ? ` (${listWords(ok.slice(0, 6).map(named))}${ok.length > 6 ? ` and ${ok.length - 6} more` : ''})` : ''}. ${ok.length === 1 ? 'It' : 'They'} can be restored for ${KEEP_DAYS} days.`,
    );
  for (const x of ok.filter((x) => x.filesLeftBehind)) said.push(`“${x.title}”’s files stayed in ${x.filesLeftBehind}: they could not move with it.`);
  for (const x of ok.filter((x) => x.attachmentsLeftBehind)) said.push(`“${x.title}”’s attachments stayed in ${x.attachmentsLeftBehind}: they could not move with it.`);
  for (const b of bad) said.push(`Not moved: ${b.path}: ${b.error}`);
  return said.join('\n');
}

export function restoredWords(r: BinRestored): string {
  const what = r.kind === 'folder' ? `the folder “${r.title}”${r.notes ? ` with ${r.notes} ${r.notes === 1 ? 'note' : 'notes'}` : ''}` : `“${titleOf(r.restored)}”`;
  return `Restored ${what} to ${r.restored}${r.renamed ? ` (something else is at ${r.path} now, so it came back beside it)` : ''}${r.files ? `, with its files in ${r.files}` : ''}${r.filesLeftBehind ? `, but its files from ${r.filesLeftBehind} could not come back: they are still in the Bin’s storage` : ''}${r.attachments ? `, with its attachments in ${r.attachments}` : ''}${r.attachmentsLeftBehind ? `, but its attachments from ${r.attachmentsLeftBehind} could not come back: they are still in the Bin’s storage` : ''}. Links to it work again.`;
}

export function binListWords(list: BinListed[]): string {
  if (!list.length) return `The Bin is empty (it keeps what is taken out for ${KEEP_DAYS} days).`;
  return [`${list.length} ${list.length === 1 ? 'item' : 'items'} in the Bin, newest first:`, ...list.map((x) => `- ${x.title} (${KIND_WORDS[x.kind] ?? x.kind}, was ${x.path}): taken out by ${x.by} on ${dayWords(x.at)}${x.why ? `, “${x.why}”` : ''}; ${x.daysLeft} ${x.daysLeft === 1 ? 'day' : 'days'} left to restore [${x.id}]`)].join('\n');
}
