// Opening what a click names (t239, 12 Nov 2026). One click on a person, action, file, meeting, milestone, decision
// or risk opens the referenced document itself in the main view, at the top with its title — never in a side panel.
// Back returns to where the person was, scrolled where they were (state/pageScroll.ts); Ctrl or Cmd opens it in a
// new tab. Hover previews stay hover (components/HoverPreview.tsx: never a click to dismiss, never covering what is
// read). The side peek panel below (WS1 part B, 24 Oct 2026) stands for nothing now: no click opens it any more, and
// it goes away once nothing mounts it.

import { useSyncExternalStore } from 'react';
import type { RecordRef, RecordType, VaultRecord } from '../../../shared/records';
import * as A from './actions';
import { revealItem, takeItem, showItem } from '../views/timeline/reveal';
import { getState, showError, toast } from './store';
import type { Where } from './workspace';

export interface PeekEntry {
  ref: RecordRef;
  /** Its name once read (for the trail). */
  title?: string;
  type?: RecordType;
}

interface PeekState {
  stack: PeekEntry[];
  at: number;
  open: boolean;
}

let state: PeekState = { stack: [], at: -1, open: false };
const listeners = new Set<() => void>();
const set = (next: PeekState) => {
  state = next;
  for (const fn of listeners) fn();
};

export function usePeek(): PeekState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

const sameRef = (a: RecordRef, b: RecordRef) => (a.id && b.id ? a.id === b.id : a.path === b.path && a.type === b.type && a.title === b.title && a.line === b.line && a.name === b.name && a.folderFile === b.folderFile);

/**
 * Opens what a click names (t239, 12 Nov 2026): the referenced document itself in the main view, at the top with its
 * title. Every caller that used to open the side peek calls this with the same reference and gets the document. Ctrl
 * or Cmd (held when the click lands) opens it in a new tab instead; `where` says so explicitly.
 */
export interface PeekOpts {
  title?: string;
  type?: RecordType;
  where?: Where;
}

let last: { at: number; ref: RecordRef; before: PeekState } | null = null;

/** Whether Ctrl or Cmd is held on the click being handled now (read off the dispatched event, so every plain-click
 *  caller gets new-tab for free without passing its event down). */
function dispatchingNewTab(): boolean {
  try {
    const e = window.event as (Event & { ctrlKey?: boolean; metaKey?: boolean }) | undefined;
    return !!e && !!(e.ctrlKey || e.metaKey);
  } catch {
    return false;
  }
}

export function peek(ref: RecordRef, opts: PeekOpts = {}): void {
  last = { at: Date.now(), ref, before: state };
  openReference(ref, opts);
}

/** A name as the record model reads it (src/shared/records.ts person): roles and notes in brackets gone. */
function plainName(raw: string): string {
  return String(raw ?? '').replace(/\([^)]*\)/g, ' ').split(/\s+[—–-]\s+|[,;/|]/)[0].replace(/\s+/g, ' ').trim();
}

/** A person's page by their name, when one is kept (a People note titled as they are). */
function personNote(title: string): string | null {
  const want = plainName(title).toLowerCase();
  if (!want) return null;
  return getState().notes.find((n) => n.props?.type === 'person' && n.title.toLowerCase() === want)?.path ?? null;
}

/** A note titled as named (any kind): an organisation's page, when one is kept. */
function titledNote(title: string): string | null {
  const want = title.trim().toLowerCase();
  if (!want) return null;
  return getState().notes.find((n) => n.title.toLowerCase() === want)?.path ?? null;
}

/** The reference opened in the main view: a file in a project's folder in the viewer, a vault file as itself, a person
 *  or organisation by name at their page, and anything else named without its path (an id) resolved through the
 *  connected vault first. Always at the top, never at an item's line: landing mid-page is what a user called out
 *  (critic 3 F7). */
export function openReference(ref: RecordRef, opts: PeekOpts = {}): void {
  closePeek();
  const where = opts.where ?? (dispatchingNewTab() ? 'tab' : 'current');
  if (ref.folderFile && ref.path) return A.openFolderFile(ref.path, ref.folderFile, where);
  if (ref.path) return A.openPath(ref.path, { where });
  // Named without a path: their page when one is kept (the title must match — first spelling wins nowhere), else
  // plain words with a way to make one for a person — never a guessed page, never a silent nothing.
  if ((ref.type === 'person' || ref.type === 'org') && ref.name && !ref.id) {
    const page = ref.type === 'person' ? personNote(ref.name) : titledNote(ref.name);
    if (page) return A.openPath(page, { where });
    if (ref.type === 'person') {
      const name = plainName(ref.name);
      toast(`“${name}” has no page yet.`, { label: 'Make one', run: () => void makePersonPage({ id: '', type: 'person', title: name, path: '', facts: [] } as VaultRecord) });
      return;
    }
    toast(`“${plainName(ref.name)}” has no page yet.`);
    return;
  }
  void window.nv.records.peek(ref).then(
    (r) => {
      if (!r) {
        toast('That isn’t here any more.');
        return;
      }
      const rec = r.record;
      if (rec.type === 'file') {
        if (rec.folderFile) return A.openFolderFile(rec.path, rec.folderFile, where);
        return A.openPath(rec.path, { where });
      }
      if ((rec.type === 'person' || rec.type === 'org') && !rec.page) {
        const page = rec.type === 'person' ? personNote(rec.title) : titledNote(rec.title);
        if (page) return A.openPath(page, { where });
        if (rec.type === 'person') {
          toast(`“${rec.title}” has no page yet.`, { label: 'Make one', run: () => void makePersonPage(rec) });
          return;
        }
        toast(`“${rec.title}” has no page yet.`);
        return;
      }
      A.openPath(rec.path, { where });
    },
    (err: unknown) => showError(err),
  );
}

/**
 * A click on a value that can also be edited: the document opens once the moment for a double-click has passed, so a
 * double-click edits where it is (24 Oct 2026). A double-click calls cancelPeekSoon. Ctrl or Cmd is read now (the
 * timer runs after the click's event is gone).
 */
let soon: number | undefined;
export function peekSoon(ref: RecordRef, opts: PeekOpts = {}): void {
  cancelPeekSoon();
  const tab = dispatchingNewTab();
  soon = window.setTimeout(() => {
    soon = undefined;
    peek(ref, tab ? { ...opts, where: 'tab' } : opts);
  }, 280);
}

export function cancelPeekSoon(): void {
  if (soon === undefined) return;
  window.clearTimeout(soon);
  soon = undefined;
}

/** A double-click edits: the peek its first click opened goes back to how it was. */
export function unpeek(ref: RecordRef): void {
  if (last && Date.now() - last.at < 800 && sameRef(last.ref, ref)) {
    set(last.before);
    last = null;
  }
}

export function closePeek(): void {
  if (state.open) set({ ...state, open: false });
}

export function peekBack(): void {
  if (state.at > 0) set({ ...state, at: state.at - 1 });
}

export function peekForward(): void {
  if (state.at < state.stack.length - 1) set({ ...state, at: state.at + 1 });
}

export function peekGo(index: number): void {
  if (index >= 0 && index < state.stack.length) set({ ...state, at: index });
}

/** The record showing has been read: its name and type go on the trail. */
export function peekNamed(index: number, record: Pick<VaultRecord, 'id' | 'title' | 'type'>): void {
  const e = state.stack[index];
  if (!e || (e.title === record.title && e.type === record.type && e.ref.id === record.id)) return;
  const stack = state.stack.slice();
  stack[index] = { ref: { ...e.ref, id: record.id }, title: record.title, type: record.type };
  set({ ...state, stack });
}

const WHOLE: RecordType[] = ['project', 'meeting', 'note', 'person', 'org'];

/** Opens a record's own page: a note, meeting, person or project as itself; an item on its project's page (at it).
 *  A file in a project's folder opens in the full viewer (t239), never in its program. */
export function openRecordPage(r: VaultRecord, where: 'current' | 'tab' = 'current'): void {
  if (r.type === 'file') {
    if (r.folderFile) return A.openFolderFile(r.path, r.folderFile, where);
    return A.openPath(r.path, { where });
  }
  if (r.page || (WHOLE.includes(r.type) && r.line === 0)) return A.openPath(r.path, { where });
  if (r.item) {
    revealItem(r.path, r.item);
    // Its line too (p14, 4 Nov 2026): the note open as a note scrolls to it and lights it; the project page
    // answers the item below, as before.
    A.openPath(r.path, { where, ...(r.line !== undefined && r.line > 0 ? { line: r.line, span: 0 } : {}), reuse: true });
    // A page already showing never asks for its line again: show it now.
    window.setTimeout(() => {
      const item = takeItem(r.path);
      if (!item) return;
      const pages = [...document.querySelectorAll<HTMLElement>('.pj-page')].filter((p) => p.offsetParent !== null);
      for (const p of pages) if (showItem(p, item)) return;
    }, 160);
    return;
  }
  A.openPath(r.path, { where, ...(r.line !== undefined && r.line > 0 ? { line: r.line, span: 0 } : {}), reuse: true });
}

/** A person named in a project but without a page of their own: their page, found first (9.2 uplift F62) — a
 *  page already here opens instead of a "… 2" — else made the usual way (People, the person type, their role) and
 *  opened; the connected vault knows it is them by their name. */
export async function makePersonPage(r: VaultRecord): Promise<void> {
  const { getState } = await import('./store');
  const same = getState().notes.find((n) => n.props?.type === 'person' && n.title.toLowerCase() === r.title.toLowerCase());
  if (same) {
    const { toast } = await import('./store');
    toast(`“${same.title}” already has a page.`, { label: 'Open', run: () => A.openPath(same.path, { where: 'tab' }) });
    return;
  }
  const { newNoteOfType } = await import('./noteTypes');
  const role = r.facts.find((f) => f.key === 'role')?.value;
  // With areas of life (Wave 4): in the People of the area they were named in.
  const { areaOfPath } = await import('./areas');
  const { homeIn } = await import('../../../shared/areas');
  const area = areaOfPath(r.project ?? r.path);
  await newNoteOfType('person', { title: r.title, ...(area && !area.quiet ? { folder: homeIn(area, 'people') } : {}), ...(role ? { values: { role } } : {}) });
}

/** Edits a record where it is written: its note, at its line, in the editor. */
export function editRecord(r: VaultRecord): void {
  if (r.type === 'file' && !r.line) return openRecordPage(r);
  // At its line, lit for a moment so the eye finds it.
  A.openPath(r.path, { mode: 'live', ...(r.line !== undefined && r.line > 0 ? { line: r.line, span: 0 } : {}) });
}
