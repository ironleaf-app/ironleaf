// Open documents (notes and canvases): one copy of each file's text however many tabs show it, saved shortly after each
// change, kept in step between tabs, and reloaded when the file changes outside Ironleaf (the former host app saving
// into it, a sync, another editor) unless there are changes here not saved yet. A save can say who made the change (a
// suggested change the person kept is the assistant's; src/main/recovery.ts credits each earlier version).
//
// Guarded saves (Nov 2026, nv-save: Ironleaf never loses an edit): every save carries the fingerprint of what was
// read, and a save that would clobber another change comes back unlanded — the disk keeps the other change, these words
// go into a conflict copy beside it, and the editor says so with both on hand. A file gone since it was read is never
// recreated behind the person's back. A save that fails (disk full, a lock) keeps the words here and tries again.

import { useSyncExternalStore } from 'react';
import { readProps } from '../../../shared/frontmatter';
import { isPrivatePath } from '../../../shared/private';
import { textVersion } from '../../../shared/project-file';
import { diffRelationProps } from '../../../shared/relation-links';
import type { CheckedWrite, SyncedBacklink } from '../../../shared/types';
import { setNoteProp } from '../../../shared/views';
import { errorMessage } from '../lib/errors';
import { getState, showError, toast } from './store';

type Listener = (text: string, origin: unknown) => void;
/** Who the next save is credited to, when not the person typing. */
type SaveBy = 'assistant' | 'restored';
/** Any open document's text changed: typed here ('edit', from `prev`), read again from disk, or loaded. */
type TextListener = (path: string, text: string, how: 'edit' | 'disk' | 'load', prev: string) => void;

interface Doc {
  path: string;
  text: string;
  /** The text as last written to (or read from) the disk. */
  disk: string;
  /** The fingerprint of `disk` (the main side's `version`): what the next save is based on. Null inside private notes. */
  base: string | null;
  refs: number;
  listeners: Set<Listener>;
  timer?: ReturnType<typeof setTimeout>;
  saving?: Promise<void>;
  error?: string;
  /** Who the next save is credited to (src/main/recovery.ts), when not the person. */
  by?: SaveBy;
  /** The next save's back-links are toasted by the writer itself (savedViews.setProp): this save stays quiet. */
  quietSyncOnce?: boolean;
  /** The next save is an import's (20 Nov 2026): it lands as it is, with no back-links written into other notes. */
  importedOnce?: boolean;
  /** The file changed elsewhere: these words are in the named copy beside it; saves wait for the person's choice. */
  conflict?: string;
  /** The file is gone since it was read: nothing recreated; the words stay here until brought back or discarded. */
  missing?: boolean;
  /** A failed save's next try. */
  retry?: ReturnType<typeof setTimeout>;
  attempts: number;
}

/** What the editor banners about a file: its conflict copy, or that it went missing. */
export type DocNotice = { kind: 'conflict'; copy: string } | { kind: 'missing' };

export type SaveState = 'saved' | 'saving' | 'error' | 'conflict';

const renameListeners = new Set<(from: string, to: string) => void>();
const open = new Map<string, Doc>();
const loading = new Map<string, Promise<Doc>>();
// Docs just closed, kept warm (t146, 9 Nov 2026): returning to a note re-read it over the bridge before the
// editor could mount. Clean only (its words on disk, no conflict, nothing missing); read again on anything
// changed — a disk change evicts, a new revision re-reads, another vault clears. Twelve at most, oldest goes.
const recent = new Map<string, { doc: Doc; revision: number }>();
const RECENT_CAP = 12;
const saveListeners = new Set<() => void>();
const textListeners = new Set<TextListener>();
const textChanged = (path: string, text: string, how: 'edit' | 'disk' | 'load', prev: string) => {
  for (const fn of textListeners) fn(path, text, how, prev);
};

const isNote = (path: string) => /\.md$/i.test(path);
// A private note is read and written through the encrypted store, never as a file (src/main/private-notes.ts).
const readDoc = async (path: string): Promise<{ text: string; version: string | null }> => {
  if (isPrivatePath(path)) return { text: await window.nv.private.read(path), version: null };
  if (isNote(path)) return window.nv.notes.open(path);
  return window.nv.files.openText(path);
};
const writeDoc = (path: string, text: string, base: string | null, by?: SaveBy, imported?: boolean): Promise<CheckedWrite> => {
  if (isPrivatePath(path)) return window.nv.private.write(path, text).then(() => ({ ok: true }));
  if (isNote(path)) return imported ? window.nv.notes.write(path, text, by, base, { imported: true }) : window.nv.notes.write(path, text, by, base);
  return window.nv.files.writeText(path, text, base);
};

/** A failed save tries again while the words are still waiting: soon, then rarely (F4). */
const RETRY_WAIT = (attempts: number): number => [2000, 5000, 15000][Math.min(attempts, 2)] ?? 30000;

function emitSave(): void {
  for (const fn of saveListeners) fn();
}

async function load(path: string): Promise<Doc> {
  const { text, version } = await readDoc(path);
  const doc: Doc = { path, text, disk: text, base: version, refs: 0, listeners: new Set(), attempts: 0 };
  open.set(path, doc);
  textChanged(path, text, 'load', text);
  return doc;
}

const shortName = (path: string): string => (path.split('/').pop() ?? path).replace(/\.(md|canvas|nvdraw|view\.json|base)$/i, '');

/** Back-links the relations seam wrote for a save, in plain words (none when it wrote nothing). */
export function syncWords(synced: readonly SyncedBacklink[], missed: number, direction: 'linked' | 'unlinked' | 'updated'): string | null {
  if (!synced.length && !missed) return null;
  const byPath = getState().byPath;
  const label = (p: string): string => byPath.get(p)?.label ?? shortName(p);
  const verb = direction === 'linked' ? 'linked back from' : direction === 'unlinked' ? 'unlinked from' : 'updated the links back from';
  let words: string | null = null;
  if (synced.length === 1) words = `Also ${verb} “${label(synced[0].path)}”${direction === 'updated' ? '' : ` (in its ${synced[0].key})`}.`;
  else if (synced.length === 2) words = `Also ${verb} “${label(synced[0].path)}” and “${label(synced[1].path)}”.`;
  else if (synced.length) words = `Also ${verb} “${label(synced[0].path)}”, “${label(synced[1].path)}” and ${synced.length - 2} other${synced.length - 2 === 1 ? '' : 's'}.`;
  if (missed) words = `${words ? `${words} ` : 'Linked, but '}the other note${missed === 1 ? '' : 's'} could not be updated${missed === 1 ? '' : ` (${missed} of them)`}.`;
  return words;
}

export const docs = {
  /** The document's text, loaded once and shared; release() it when the tab no longer shows it. */
  async acquire(path: string): Promise<string> {
    let doc = open.get(path);
    if (!doc) {
      // Warm from a recent close (t146): the same vault still, so the same words — no read over the bridge.
      const warm = recent.get(path);
      if (warm && warm.revision === getState().revision) {
        recent.delete(path);
        doc = warm.doc;
        open.set(path, doc);
      } else {
        if (warm) recent.delete(path);
        let pending = loading.get(path);
        if (!pending) {
          pending = load(path).finally(() => loading.delete(path));
          loading.set(path, pending);
        }
        doc = await pending;
      }
    }
    doc.refs++;
    return doc.text;
  },

  release(path: string): void {
    const doc = open.get(path);
    if (!doc) return;
    doc.refs = Math.max(0, doc.refs - 1);
    if (doc.refs === 0) {
      void this.flush(path).then(() => {
        if (doc.refs === 0 && doc.text === doc.disk && !doc.conflict && !doc.missing) {
          clearTimeout(doc.retry);
          clearTimeout(doc.timer);
          doc.listeners.clear();
          doc.by = undefined;
          doc.quietSyncOnce = undefined;
          open.delete(path);
          // Kept warm for a return (t146): clean, so nothing unsaved waits anywhere on it.
          recent.delete(path);
          recent.set(path, { doc, revision: getState().revision });
          while (recent.size > RECENT_CAP) recent.delete(recent.keys().next().value!);
          // An empty write-first note closed leaves nothing behind (5 Nov 2026, one rule; through the leaf
          // writeFirst module, never noteTypes — noteTypes statically imports the window's actions, which no
          // standalone bundle of docs.ts can carry).
          void import('./writeFirst').then((m) => m.dropEmptyWriteFirst(path, doc.text).catch(() => false));
        }
      });
    }
  },

  text(path: string): string | undefined {
    return open.get(path)?.text;
  },

  /** A change made in one tab: saved soon, and shown in the other tabs with the same file. */
  update(path: string, text: string, origin: unknown): void {
    const doc = open.get(path);
    if (!doc || doc.text === text) return;
    const prev = doc.text;
    doc.text = text;
    for (const fn of doc.listeners) fn(text, origin);
    textChanged(path, text, 'edit', prev);
    clearTimeout(doc.timer);
    // New typing supersedes a failing save's scheduled retry; the attempts start over with this save.
    clearTimeout(doc.retry);
    doc.retry = undefined;
    doc.attempts = 0;
    doc.timer = setTimeout(() => void this.flush(doc.path), 500);
    emitSave();
  },

  /** Every open document's text as it changes (the suggested changes in a note follow it; state/suggestions.ts). */
  onRename(fn: (from: string, to: string) => void): () => void {
    renameListeners.add(fn);
    return () => { renameListeners.delete(fn); };
  },

  onText(fn: TextListener): () => void {
    textListeners.add(fn);
    return () => textListeners.delete(fn);
  },

  /** The next save of this document is credited to someone other than the person typing (a suggested change kept). */
  credit(path: string, by: SaveBy): void {
    const doc = open.get(path);
    if (doc) doc.by = by;
  },

  subscribe(path: string, fn: Listener): () => void {
    const doc = open.get(path);
    if (!doc) return () => {};
    doc.listeners.add(fn);
    return () => doc.listeners.delete(fn);
  },

  async flush(path?: string): Promise<CheckedWrite | null> {
    if (path === undefined) {
      await Promise.all([...open.keys()].map((p) => this.flush(p)));
      return null;
    }
    const doc = open.get(path);
    if (!doc) return null;
    // A conflict or a missing file waits for the person's choice (their words are already kept); never auto-saved over.
    if (doc.conflict !== undefined || doc.missing) return null;
    clearTimeout(doc.timer);
    if (doc.saving) await doc.saving;
    if (doc.text === doc.disk) {
      doc.by = undefined;
      return null;
    }
    const text = doc.text;
    const prev = doc.disk;
    const base = doc.base;
    const by = doc.by;
    doc.by = undefined;
    const quiet = doc.quietSyncOnce;
    doc.quietSyncOnce = undefined;
    const imported = doc.importedOnce;
    doc.importedOnce = undefined;
    // Boxed: read after the save lands below (a plain let narrows to null, the write hidden in the closure).
    const box: { outcome: CheckedWrite | null } = { outcome: null };
    doc.saving = (async () => {
      try {
        const r = await writeDoc(path, text, base, by, imported);
        box.outcome = r;
        if (!r.ok) {
          if (r.conflict) {
            doc.conflict = r.conflict;
            toast(`“${shortName(path)}” changed elsewhere. Both copies are kept.`, { label: 'Show both', run: () => void import('./actions').then((m) => m.openPath(r.conflict!, { where: 'right' })) }, 9000);
          } else {
            doc.missing = true;
            toast(`“${shortName(path)}” was moved or deleted elsewhere. Your words are still here.`, undefined, 9000);
          }
        } else {
          // Landed: based on what is there now (a save racing in after us conflicts next time, never silently).
          doc.disk = text;
          doc.base = isPrivatePath(path) ? null : textVersion(text);
          doc.error = undefined;
          doc.attempts = 0;
        }
      } catch (err) {
        doc.error = errorMessage(err);
        showError(err);
        // Still waiting: try again in the background until it lands or the tab goes (F4).
        clearTimeout(doc.retry);
        doc.retry = setTimeout(() => void this.flush(doc.path), RETRY_WAIT(doc.attempts++));
      } finally {
        doc.saving = undefined;
        emitSave();
      }
    })();
    emitSave();
    await doc.saving;
    // More typing came in while it saved.
    if (doc.text !== doc.disk && !doc.error && doc.conflict === undefined && !doc.missing) {
      clearTimeout(doc.timer);
      doc.timer = setTimeout(() => void this.flush(doc.path), 300);
    }
    if (box.outcome?.ok && !quiet) this.toastSync(path, box.outcome, prev, text);
    return box.outcome;
  },

  /** Back-links the seam wrote for an open note's save, said once with Undo (reverting only the relation keys). */
  toastSync(path: string, r: CheckedWrite, prev: string, saved: string): void {
    const prevProps = readProps(prev);
    const savedProps = readProps(saved);
    const changed = diffRelationProps(prevProps, savedProps);
    if (!changed.length) return;
    const counts = (v: unknown): number => (Array.isArray(v) ? v.flat(Infinity) : [v]).filter((x) => typeof x === 'string' && !!x.trim()).length;
    const deltas = changed.map((c) => counts(c.after) - counts(c.before));
    const direction = deltas.every((d) => d > 0) ? 'linked' : deltas.every((d) => d < 0) ? 'unlinked' : 'updated';
    const words = syncWords(r.synced ?? [], r.missed ?? 0, direction);
    if (!words) return;
    toast(words, {
      label: 'Undo',
      run: () => {
        if (this.text(path) !== saved) {
          toast('The note changed since, so nothing was undone.');
          return;
        }
        let next = saved;
        for (const c of changed) {
          const own = Object.keys(prevProps).find((k) => k.toLowerCase() === c.key.toLowerCase());
          next = setNoteProp(next, c.key, own ? prevProps[own] : null);
        }
        void this.writeThrough(path, next, 'undo-sync', { quietSync: true }).then(() => toast('Undone.'));
      },
    });
  },

  /** What the editor banners about a file, if anything (a conflict copy, or that it went missing). */
  notice(path: string): DocNotice | null {
    const doc = open.get(path);
    if (!doc) return null;
    if (doc.conflict !== undefined) return { kind: 'conflict', copy: doc.conflict };
    if (doc.missing) return { kind: 'missing' };
    return null;
  },

  /** Whether a file has words only the window holds (unsaved, failing, conflicted, or missing): kept, never dropped. */
  hasUnsaved(path: string): boolean {
    const doc = open.get(path);
    return !!doc && (doc.text !== doc.disk || doc.error !== undefined || doc.conflict !== undefined || doc.missing === true);
  },

  /** Open files with words only the window holds whose file is gone from the list the window just read. */
  stranded(known: Set<string>): string[] {
    const out: string[] = [];
    for (const [path, doc] of open) {
      if (!known.has(path) && (doc.text !== doc.disk || doc.error !== undefined) && doc.conflict === undefined && !doc.missing) out.push(path);
    }
    return out;
  },

  /** A stranded file's words are kept here with a banner (said once), not silently recreated on disk (F3). */
  markMissing(path: string): void {
    const doc = open.get(path);
    if (!doc || doc.conflict !== undefined || doc.missing) return;
    doc.missing = true;
    clearTimeout(doc.timer);
    toast(`“${shortName(path)}” was moved or deleted elsewhere. Your words are still here.`, undefined, 9000);
    emitSave();
  },

  /**
   * A conflict settled (the banner's choice). `mine`: the other change is taken as the base and these words saved over
   * it, the conflict copy to Recently deleted. `theirs`: the other change is taken into the editor; the copy stays
   * beside the note with these words, and the Backup and sync page can still merge it.
   */
  async resolveConflict(path: string, which: 'mine' | 'theirs'): Promise<void> {
    const doc = open.get(path);
    if (!doc || doc.conflict === undefined) return;
    const copy = doc.conflict;
    let fresh: { text: string; version: string | null };
    try {
      fresh = await readDoc(path);
    } catch (err) {
      showError(err);
      return;
    }
    if (which === 'theirs') {
      const prev = doc.text;
      doc.text = fresh.text;
      doc.disk = fresh.text;
      doc.base = fresh.version;
      doc.conflict = undefined;
      doc.error = undefined;
      for (const fn of doc.listeners) fn(fresh.text, 'disk');
      textChanged(path, fresh.text, 'disk', prev);
      toast(`Kept the other change. Your words are still in “${shortName(copy)}”.`, { label: 'Open it', run: () => void import('./actions').then((m) => m.openPath(copy, { where: 'right' })) }, 9000);
      emitSave();
      return;
    }
    doc.base = fresh.version;
    doc.disk = fresh.text;
    doc.conflict = undefined;
    emitSave();
    await this.flush(path);
    if (this.saveState(path) === 'saved') {
      await window.nv.files.trash(copy).catch(() => {});
      toast('Kept your words.', undefined, 5000);
    }
  },

  /** A missing file brought back where it was (an explicit recreate, never an automatic one). When something is
   *  there again already, it is a conflict like any other (both kept), not an overwrite. */
  async bringBack(path: string): Promise<void> {
    const doc = open.get(path);
    if (!doc || !doc.missing) return;
    const fresh = await readDoc(path).catch(() => null);
    doc.missing = undefined;
    // Something there again: the old fingerprint no longer matches, so this save conflicts (both kept) unless it is
    // the same words; still gone: an explicit blind recreate.
    if (!fresh) doc.base = null;
    emitSave();
    await this.flush(path);
  },

  saveState(path: string): SaveState {
    const doc = open.get(path);
    if (!doc) return 'saved';
    if (doc.conflict !== undefined) return 'conflict';
    if (doc.error || doc.missing) return 'error';
    return doc.saving || doc.text !== doc.disk ? 'saving' : 'saved';
  },

  onSaveState(fn: () => void): () => void {
    saveListeners.add(fn);
    return () => saveListeners.delete(fn);
  },

  /** Files changed on disk: open ones without unsaved changes take the new text. */
  async changedOnDisk(paths: string[]): Promise<void> {
    for (const path of paths) {
      recent.delete(path);
      const doc = open.get(path);
      if (!doc || doc.saving || doc.text !== doc.disk || doc.conflict !== undefined || doc.missing) continue;
      let next: { text: string; version: string | null };
      try {
        next = await readDoc(path);
      } catch {
        continue;
      }
      if (next.text === doc.disk || doc.text !== doc.disk) continue;
      const prev = doc.text;
      doc.text = next.text;
      doc.disk = next.text;
      doc.base = next.version;
      for (const fn of doc.listeners) fn(next.text, 'disk');
      textChanged(path, next.text, 'disk', prev);
    }
  },

  /** A file moved: its open document (and anything inside a moved folder) follows. */
  async renamed(from: string, to: string): Promise<void> {
    for (const notify of renameListeners) notify(from, to);
    const moveFile = (p: string): string => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
    for (const p of [...recent.keys()]) if (p === from || p.startsWith(`${from}/`)) recent.delete(p);
    for (const [path, doc] of [...open]) {
      const next = path === from || path.startsWith(`${from}/`) ? moveFile(path) : null;
      if (!next) continue;
      open.delete(path);
      doc.path = next;
      // A conflict copy sitting beside it moved along (a folder moved with both in it).
      if (doc.conflict !== undefined) {
        const copy = moveFile(doc.conflict);
        if (copy !== doc.conflict) doc.conflict = copy;
      }
      open.set(next, doc);
      // Typing that arrived while the move was under way (20 Nov 2026 audit): its save was due at the old path, where
      // the file no longer is (a "moved elsewhere" that was this very move). It goes to the new path now; the words
      // were never lost, only not saved until the next keystroke.
      if (doc.missing) doc.missing = undefined;
      if (doc.text !== doc.disk && doc.conflict === undefined) {
        clearTimeout(doc.timer);
        doc.timer = setTimeout(() => void this.flush(doc.path), 300);
      }
    }
  },

  /**
   * A note's words for a background change (a tick, a log entry, an import): from its open tab when open, so nothing
   * unsaved is missed or overwritten, else from disk. The one read every background write starts from (Nov 2026,
   * nv-save F12: the saved-views and doc-kind pairs did this each on their own; the stragglers read disk and lost).
   */
  async readThrough(path: string): Promise<string> {
    const open = this.text(path);
    if (open !== undefined) return open;
    return isPrivatePath(path) ? window.nv.private.read(path) : isNote(path) ? window.nv.notes.read(path) : window.nv.files.readText(path);
  },

  /**
   * Words written from elsewhere than the editor: through the open tab when open (it shows them straight away, and
   * the guarded save keeps them), else to disk. The one write every background change ends with. Answers the guarded
   * write (with what the relations seam synced), or null for a private note or an open tab that had nothing to save.
   * `quietSync`: the writer toasts the back-links itself. Bulk origins (imports, logs) never toast per note.
   */
  async writeThrough(path: string, text: string, origin: unknown, opts: { quietSync?: boolean } = {}): Promise<CheckedWrite | null> {
    if (this.text(path) !== undefined) {
      const doc = open.get(path);
      if (opts.quietSync && doc) doc.quietSyncOnce = true;
      if (origin === 'import' && doc) doc.importedOnce = true;
      this.update(path, text, origin);
      return this.flush(path);
    }
    // Past the open tabs, onto the disk: nothing warm survives it (t146).
    recent.delete(path);
    if (isPrivatePath(path)) {
      await window.nv.private.write(path, text);
      return null;
    }
    // An import's words land as they are: no back-links into other notes for them (20 Nov 2026).
    const r = isNote(path) ? (origin === 'import' ? await window.nv.notes.write(path, text, undefined, undefined, { imported: true }) : await window.nv.notes.write(path, text)) : await window.nv.files.writeText(path, text);
    if (r.ok && !opts.quietSync && origin !== 'import' && origin !== 'log' && (r.synced?.length || r.missed)) {
      const words = syncWords(r.synced ?? [], r.missed ?? 0, 'updated');
      if (words) toast(words);
    }
    return r;
  },

  /** Saves everything before a move or rename, so nothing is written to the old place afterwards. */
  async settle(): Promise<void> {
    await this.flush();
  },

  /** Another folder of notes opened: everything saved, then nothing kept from the last one. */
  async reset(): Promise<void> {
    await this.flush();
    for (const doc of open.values()) {
      clearTimeout(doc.timer);
      clearTimeout(doc.retry);
    }
    open.clear();
    recent.clear();
    // Write-first marks are this vault's (Nov 2026 break: the same Untitled path in the next vault
    // must never drop for the last one's empty close).
    await import('./writeFirst').then((m) => m.clearAllWriteFirst());
  },

  forget(path: string): void {
    const doc = open.get(path);
    if (doc) {
      clearTimeout(doc.timer);
      clearTimeout(doc.retry);
    }
    open.delete(path);
    recent.delete(path);
  },

  /** A file, or everything open inside a folder, saved now (before a delete: the Bin keeps the last words typed). */
  async flushUnder(path: string): Promise<void> {
    await Promise.all([...open.keys()].filter((p) => p === path || p.startsWith(`${path}/`)).map((p) => this.flush(p)));
  },

  /** A file, or everything inside a folder, let go once it is gone (a delete that landed). */
  forgetUnder(path: string): void {
    for (const p of [...open.keys(), ...recent.keys()]) if (p === path || p.startsWith(`${path}/`)) this.forget(p);
  },
};

/** The saving state of a file, for the status bar. */
export function useSaveState(path: string | undefined): SaveState {
  return useSyncExternalStore(
    (fn) => docs.onSaveState(fn),
    () => (path ? docs.saveState(path) : 'saved'),
  );
}

/** What the editor banners about a file, for the note's banner. */
export function useDocNotice(path: string | undefined): DocNotice | null {
  return useSyncExternalStore(
    (fn) => docs.onSaveState(fn),
    () => (path ? docs.notice(path) : null),
  );
}
