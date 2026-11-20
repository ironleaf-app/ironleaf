// The Import page's memory (8.7 w4a, views/ImportView.tsx): what the last import brought in, so it can be undone
// (its notes go to the Bin, like any delete), and bringing Markdown files from this PC in as notes. Kept on this PC
// only (localStorage, per vault): another PC has its own last import.

import { needsChoice, previewByName, previewWords } from '../../../shared/import-preview';
import { sameText } from '../../../shared/vault-merge';
import { choose, prompt } from '../components/Dialogs';
import * as A from './actions';
import { docs } from './docs';
import { getState, loadFiles, showError, toast } from './store';

export interface LastImport {
  /** What it was: 'suppliers.csv' or '3 Markdown files'. */
  source: string;
  /** Where it went: the folder in the vault. */
  where: string;
  /** The notes made, as vault paths (for Undo). */
  paths: string[];
  /** When, as Date.now(). */
  at: number;
  /** Undone already (its notes went to the Bin). */
  undone?: boolean;
}

const keyOf = (vault: string): string => `nv:last-import:${vault}`;

export function loadLastImport(vault: string | undefined): LastImport | null {
  if (!vault) return null;
  try {
    const raw = localStorage.getItem(keyOf(vault));
    if (!raw) return null;
    const v = JSON.parse(raw) as LastImport;
    return v && Array.isArray(v.paths) ? v : null;
  } catch {
    return null;
  }
}

export function saveLastImport(vault: string | undefined, v: LastImport): void {
  if (!vault) return;
  try {
    localStorage.setItem(keyOf(vault), JSON.stringify(v));
  } catch {}
}

/** Undo: the notes the import made go to the Bin (restorable there for 30 days). Returns what is left on record. */
export async function undoLastImport(vault: string | undefined, v: LastImport): Promise<LastImport> {
  const n = await A.trashPaths(v.paths);
  // Undone said only when something moved (9.2 uplift F145): with nothing left to move, the record stays so the
  // undo can be tried again.
  if (!n) {
    toast('Those notes are already gone, so nothing was undone. The import stays on record.');
    return v;
  }
  toast(`The import is undone: ${n} ${n === 1 ? 'note went' : 'notes went'} to the Bin.`);
  const next = { ...v, undone: true };
  saveLastImport(vault, next);
  await loadFiles().catch(() => undefined);
  return next;
}

const baseOf = (name: string): string => name.replace(/\.[a-z0-9]+$/i, '').trim() || 'Untitled';

/**
 * Markdown files from this PC become notes: each file a note in a folder the person names, filed where they say,
 * links kept working. A note already there is updated or kept beside the new one, asked once (as the CSV import does);
 * a file already here, the same, is left (F5: a second import adds only what is new). Many files show their share
 * and stop on the word Stop (F2).
 */
export async function importMarkdownFiles(files: { name: string; text: string }[], onDone?: (made: string[], where: string, source: string) => void): Promise<void> {
  const made: string[] = [];
  let where = '';
  const source = files.length === 1 ? files[0]?.name : `${files.length} Markdown files`;
  try {
    if (!getState().canEdit || !files.length) return;
    const folder = await prompt('Bring Markdown files in', {
      value: '',
      ok: `Make ${files.length} ${files.length === 1 ? 'note' : 'notes'}`,
      placeholder: 'A folder, such as Clients',
      message: `Each file becomes a note in this folder (made if it isn’t there). A file naming a note already there updates it (ones already the same are left) or keeps both. You see how many are new, to update and already here before you choose.`,
    });
    if (!folder?.trim()) return;
    where = folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    // Found first (W5-9): same-name notes are asked about once, as the CSV import asks.
    // Compared before asking (10.0 item 16): the person sees how many are new, to update and already here.
    const there = new Map(getState().notes.filter((n) => A.folderOf(n.path) === where).map((n) => [n.title.toLowerCase(), n.path]));
    const collide = files.filter((f) => there.has(baseOf(f.name).toLowerCase()));
    let update = false;
    // Files already here with the same words: left in both choices, never duplicated.
    const sameSet = new Set<string>();
    if (collide.length) {
      const existing = new Map<string, string | null>();
      for (const f of collide) existing.set(baseOf(f.name).toLowerCase(), await window.nv.notes.read(there.get(baseOf(f.name).toLowerCase())!).catch(() => null));
      const full = previewByName(existing, files.map((f) => ({ name: baseOf(f.name), text: f.text })));
      for (const f of collide) {
        const t = existing.get(baseOf(f.name).toLowerCase());
        if (t !== null && t !== undefined && sameText(t, f.text)) sameSet.add(baseOf(f.name).toLowerCase());
      }
      if (needsChoice(full)) {
        const id = await choose(
          collide.length === 1 ? `“${baseOf(collide[0].name)}” is already in ${where || 'your notes'}` : `${collide.length} files name notes already in ${where || 'your notes'}`,
          [
            { id: 'update', label: collide.length === 1 ? 'Update it' : 'Update them', primary: true },
            { id: 'both', label: 'Keep both' },
          ],
          `${previewWords(full)}. Updating replaces each note with its file. Keeping both makes new notes with numbers in their names. Notes already here are left as they are in both choices.`,
        );
        if (!id) return;
        update = id === 'update';
      }
    }
    const signal = { stopped: false };
    let identical = 0;
    /** A free name for keep-both ("Name 2", "Name 3"…): never over a note already there. */
    const freeName = (name: string): string => {
      if (!there.has(name.toLowerCase())) return name;
      for (let n = 2; ; n++) {
        const next = `${name} ${n}`;
        if (!there.has(next.toLowerCase())) return next;
      }
    };
    for (let i = 0; i < files.length; i++) {
      if (signal.stopped) break;
      if (files.length >= 20) toast(`Making notes… ${i} of ${files.length}.`, { label: 'Stop', run: () => { signal.stopped = true; } }, 600000);
      const f = files[i];
      const name = baseOf(f.name);
      const at = there.get(name.toLowerCase());
      if (update && at) {
        const mine = await window.nv.notes.read(at).catch(() => null);
        if (mine !== null && sameText(mine, f.text)) {
          identical++;
          continue;
        }
        await docs.writeThrough(at, f.text, 'import');
        made.push(at);
      } else if (!update && at) {
        // Already here with the same words: left, never a numbered copy beside it.
        if (sameSet.has(name.toLowerCase())) {
          identical++;
          continue;
        }
        const name2 = freeName(name);
        const madePath = await window.nv.notes.create(where ? `${where}/${name2}.md` : `${name2}.md`, f.text, { imported: true });
        there.set(name2.toLowerCase(), madePath);
        made.push(madePath);
      } else {
        const madePath = await window.nv.notes.create(where ? `${where}/${name}.md` : `${name}.md`, f.text, { imported: true });
        there.set(name.toLowerCase(), madePath);
        made.push(madePath);
      }
    }
    await loadFiles();
    if (!made.length && !signal.stopped) {
      // Nothing written (every file already here, the same): no undo record.
      toast(`${identical} ${identical === 1 ? 'note is' : 'notes are'} already here, the same. Nothing was made.`);
      return;
    }
    toast(
      [`${signal.stopped ? 'Stopped. ' : ''}Made ${made.length} ${made.length === 1 ? 'note' : 'notes'} in ${where || 'the top of your notes'}.`, identical ? `${identical} ${identical === 1 ? 'was' : 'were'} already the same.` : ''].filter(Boolean).join(' '),
    );
    if (made.length) onDone?.(made, where, source);
  } catch (err) {
    // What was made is recorded even when a later file failed (W5-9), so it can be undone as one import.
    if (made.length) onDone?.(made, where, source);
    showError(err);
  }
}
