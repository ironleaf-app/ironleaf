// Synced blocks from the editor (8.8 database depth; src/shared/synced-blocks.ts): the selected words made into a
// synced block (kept once under Synced blocks/, the selection replaced by its ![[reference]]), or an existing block
// placed where the cursor is. Chosen from the / menu beside the other blocks.

import type { EditorView } from '@codemirror/view';
import { makeSyncedFile, nameFromText, SYNCED_FOLDER, syncRefFor, isSyncedPath } from '../../../shared/synced-blocks';
import { pick } from '../components/Pickers';
import { fuzzyFilter } from '../lib/fuzzy';
import { docs } from '../state/docs';
import { getState, loadFiles, showError, toast } from '../state/store';
import { trashPath } from '../state/actions';
import { insertBlock } from './commands';

/** The selected words made into a synced block, replaced by its reference (with Undo putting them back). */
export async function makeSyncedBlock(view: EditorView): Promise<void> {
  const range = view.state.selection.main;
  const words = view.state.sliceDoc(range.from, range.to).trim();
  if (!words) {
    toast('Select the words to sync first.');
    return;
  }
  try {
    const blocks = getState().notes.filter((n) => isSyncedPath(n.path));
    // Reuse before making (9.2 uplift F84): words already kept as a block place its reference,
    // never a "Name 2" copy.
    for (const b of blocks) {
      const body = docs.text(b.path) ?? (await window.nv.notes.read(b.path).catch(() => ''));
      if (body.replace(/\s+$/, '') === words) {
        const ref = syncRefFor(b.path);
        view.dispatch({ changes: { from: range.from, to: range.to, insert: ref }, selection: { anchor: range.from + ref.length }, userEvent: 'input' });
        view.focus();
        toast(`Used the “${b.title}” synced block.`);
        return;
      }
    }
    const have = new Set(blocks.map((n) => n.title.toLowerCase()));
    let name = nameFromText(words);
    for (let i = 2; have.has(name.toLowerCase()); i++) name = `${nameFromText(words)} ${i}`;
    const path = await window.nv.files.create(SYNCED_FOLDER, name, '.md', makeSyncedFile(name, words));
    await loadFiles();
    const ref = syncRefFor(path);
    const from = range.from;
    view.dispatch({ changes: { from: range.from, to: range.to, insert: ref }, selection: { anchor: range.from + ref.length }, userEvent: 'input' });
    view.focus();
    toast(`Made “${name}” a synced block.`, {
      label: 'Undo',
      run: () => {
        // Undo's own insert (9.2 uplift F153): the reference at or after where it was placed, never the
        // first match when the same block is used twice.
        const doc = view.state.doc.toString();
        const at = doc.indexOf(ref, Math.min(from, doc.length));
        const pos = at >= 0 ? at : doc.indexOf(ref);
        if (pos >= 0) view.dispatch({ changes: { from: pos, to: pos + ref.length, insert: words }, userEvent: 'input' });
        void trashPath(path);
      },
    });
  } catch (err) {
    showError(err);
  }
}

/** An existing synced block placed where the cursor is. */
export async function insertSyncedBlock(view: EditorView): Promise<void> {
  const blocks = getState().notes.filter((n) => isSyncedPath(n.path));
  if (!blocks.length) {
    toast('There are no synced blocks yet. Select some words and make one first.');
    return;
  }
  const id = await pick({
    placeholder: 'Which synced block? Type to search',
    items: (q) => fuzzyFilter(blocks, q, (b) => b.title, 40).map((b) => ({ id: b.path, label: b.title, detail: 'Synced block', icon: 'copy' as const })),
    footer: '↑↓ to move · Enter to place it · Esc to cancel',
  });
  if (!id) return;
  insertBlock(view, syncRefFor(id), undefined, view.state.selection.main.from !== view.state.selection.main.to);
}
