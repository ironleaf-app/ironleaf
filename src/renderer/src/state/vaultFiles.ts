// Files done properly in the window (Wave 4 part c, 24 Oct 2026; src/main/vault-files.ts has the rules): the catalogue
// the Files views read, big imports and their progress (they carry on after a break), and the actions every screen
// shares — add files to a record (a newer version or kept apart when a name is there already), link a file where it is on
// the PC, a new version of a file.

import { useEffect, useRef, useState } from 'react';
import type { CatalogueItem, ImportState } from '../../../shared/vault-files-api';
import { BIG_FILE, PIECE_BYTES, sizeWords } from '../../../shared/file-records';
import { choose, confirm } from '../components/Dialogs';
import { showError, toast, useApp } from './store';

const titleOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.(md|canvas)$/i, '');

/** Every file in the vault (or one folder) with its record, read again when files change. */
export function useCatalogue(under?: string, on = true): { items: CatalogueItem[]; ready: boolean; failed: boolean; reload(): void } {
  const filesRevision = useApp((s) => s.filesRevision);
  const revision = useApp((s) => s.revision);
  const [items, setItems] = useState<CatalogueItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const imports = useImports();
  const doneCount = imports.done;
  useEffect(() => {
    if (!on) return;
    let live = true;
    const t = window.setTimeout(
      () =>
        void window.nv.vfiles.catalogue(under).then(
          (list) => {
            if (!live) return;
            setItems(list);
            setFailed(false);
          },
          // A failed read is failed, never an empty vault (9.2 uplift F72).
          () => live && setFailed(true),
        ),
      items ? 250 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [under, filesRevision, revision, tick, doneCount, on]);
  return { items: items ?? [], ready: items !== null, failed: failed && items === null, reload: () => setTick((n) => n + 1) };
}

// ── Big imports ──

type ImportsState = { list: ImportState[]; done: number };
let imports: ImportsState = { list: [], done: 0 };
const listeners = new Set<() => void>();
let started = false;
const emit = () => {
  for (const fn of listeners) fn();
};

function startImports(): void {
  if (started) return;
  started = true;
  void window.nv.vfiles.imports().then(
    (list) => {
      imports = { ...imports, list };
      emit();
    },
    () => undefined,
  );
  window.nv.vfiles.onProgress((s) => {
    const others = imports.list.filter((x) => x.id !== s.id);
    if (s.state === 'done') {
      imports = { list: others, done: imports.done + 1 };
      toast(`${s.name} is in${s.record ? `, with ${titleOf(s.record)}` : ''}.`, s.rel ? { label: 'Show', run: () => void import('./peek').then((P) => P.peek({ type: 'file', path: s.rel! }, { title: s.name, type: 'file' })) } : undefined);
    } else if (s.state === 'failed' && s.problem === 'Cancelled') imports = { ...imports, list: others };
    else imports = { ...imports, list: [...others, s].sort((a, b) => a.started - b.started) };
    emit();
  });
}

export function useImports(): ImportsState {
  const [, set] = useState(0);
  useEffect(() => {
    startImports();
    const fn = () => set((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);
  return imports;
}

/** "42% of 287 MB". */
export function importWords(s: ImportState): string {
  const pct = s.size ? Math.floor((s.received / s.size) * 100) : 0;
  if (s.state === 'failed') return s.problem ?? 'Stopped.';
  if (s.state === 'paused') return `Paused at ${pct}% of ${sizeWords(s.size)}${s.from === 'window' ? ' (add the file again to carry on)' : ''}`;
  if (s.received >= s.size) return `All ${sizeWords(s.size)} here: checking it arrived whole…`;
  return `${pct}% of ${sizeWords(s.size)}`;
}

// ── Actions every screen shares ──

/** Asks what to do with names already there: a newer version of each, or keep both. Null: cancelled. */
async function askSame(record: string, names: string[]): Promise<'version' | 'both' | null | undefined> {
  // A failed check is not "nothing there" (W5-19): it stops the add, said by the caller's catch.
  const taken = await window.nv.vfiles.taken(record, names);
  if (!taken.length) return undefined;
  const one = taken.length === 1;
  const id = await choose(
    one ? `${taken[0]} is there already` : `${taken.length} of these are there already`,
    [
      { id: 'version', label: one ? 'Make it the new version' : 'Make them new versions', primary: true },
      { id: 'both', label: 'Keep both' },
    ],
    one ? `A new version keeps the one there now as an older version (you can compare and bring it back). Keep both saves this one as “${taken[0].replace(/(\.[^.]+)$/, ' (2)$1')}”.` : `A new version keeps each one there now as an older version. Keep both saves these under new names.`,
  );
  // A renamed copy is never the quiet path (9.2 uplift F78): the drift is said before it is made.
  if (id === 'both') {
    const sure = await confirm(one ? 'Keep both copies?' : 'Keep both copies of each?', {
      message: 'The copies won’t stay in step: changes to one won’t reach the other.',
      ok: 'Keep both',
    });
    if (!sure) return null;
  }
  return id === 'version' || id === 'both' ? id : null;
}

/** Files added to a record: chosen in Windows' own window, or dropped. Big ones import in pieces and show their progress. */
export async function addFilesTo(record: string, files?: File[]): Promise<string[]> {
  try {
    let paths: string[] | null = null;
    if (files?.length) {
      paths = files.map((f) => window.nv.files.pathOf(f)).filter(Boolean);
      // Files without a place on this PC (dragged from a browser): sent as bytes.
      const loose = files.filter((f) => !window.nv.files.pathOf(f));
      for (const f of loose) {
        const same = await askSame(record, [f.name]);
        if (same === null) continue;
        if (f.size > BIG_FILE) void sendInPieces(record, f, same);
        else await window.nv.vfiles.addBytes(record, f.name, new Uint8Array(await f.arrayBuffer()), same);
      }
      if (!paths.length) {
        // Big loose files are still sending in pieces (W5-19): added is said only when they land.
        if (loose.length) {
          const big = loose.filter((f) => f.size > BIG_FILE).length;
          toast(big && big === loose.length ? `Sending ${loose.length === 1 ? loose[0].name : `${loose.length} files`} to ${titleOf(record)}.` : big ? `Added ${loose.length - big} and sending ${big} big ${big === 1 ? 'file' : 'files'} to ${titleOf(record)}.` : `Added ${loose.length === 1 ? loose[0].name : `${loose.length} files`} to ${titleOf(record)}.`);
        }
        return [];
      }
    }
    const names = paths ? paths.map((p) => p.split(/[\\/]/).pop() ?? p) : [];
    const same = paths ? await askSame(record, names) : undefined;
    if (same === null) return [];
    const r = await window.nv.vfiles.add(record, paths, same, files?.length ? 'dropped' : 'added');
    if (r.problems.length) showError(new Error(r.problems.join('\n')));
    const n = r.placed.length;
    if (n || r.importing.length)
      toast(
        [n ? `Added ${n === 1 ? (r.placed[0].split('/').pop() ?? 'a file') : `${n} files`} to ${titleOf(record)}.` : '', r.importing.length ? `${r.importing.length === 1 ? r.importing[0].name : `${r.importing.length} big files`} ${r.importing.length === 1 ? 'is' : 'are'} coming in (it carries on after a break).` : ''].filter(Boolean).join(' '),
        n === 1 ? { label: 'Show', run: () => void import('./peek').then((P) => P.peek({ type: 'file', path: r.placed[0] }, { title: r.placed[0].split('/').pop(), type: 'file' })) } : undefined,
      );
    return r.placed;
  } catch (err) {
    showError(err);
    return [];
  }
}

/** A big file with no place on this PC (dragged from a browser): sent in 8 MB pieces, each at the offset the import has
 *  reached, so a piece lost on the way is sent again rather than the whole file. */
async function sendInPieces(record: string, f: File, same?: 'version' | 'both'): Promise<void> {
  try {
    let s = await window.nv.vfiles.importBegin({ record, name: f.name, size: f.size, ...(same ? { same } : {}) });
    let offset = 0;
    while (offset < f.size && s.state !== 'done') {
      const piece = new Uint8Array(await f.slice(offset, Math.min(f.size, offset + PIECE_BYTES)).arrayBuffer());
      try {
        s = await window.nv.vfiles.importPiece(s.id, offset, piece);
        offset = s.received;
      } catch (err) {
        // The import says where the next piece starts: carry on from there.
        const m = /starts at byte (\d+)/.exec(err instanceof Error ? err.message : '');
        if (!m) throw err;
        offset = Number(m[1]);
      }
    }
  } catch (err) {
    showError(err);
  }
}

/** A file on this PC linked to a record where it is (nothing copied). */
export async function linkFileTo(record: string): Promise<void> {
  try {
    const r = await window.nv.vfiles.reference(record);
    if (r) toast(`Linked ${r.name} to ${titleOf(record)} where it is on this PC. Nothing was copied.`);
  } catch (err) {
    showError(err);
  }
}

/** Remembers the newest value of something a component reads in a callback. */
export function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}
