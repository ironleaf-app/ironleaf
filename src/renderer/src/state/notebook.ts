// Notebook mode in the window (21 Oct 2026, gap G10; views/NotebookView.tsx draws it): opening a folder as a notebook,
// a cited passage opened beside it (a note scrolled to its paragraph and lit for a moment, a PDF at its page with the
// words marked), each notebook's questions and answers kept while Ironleaf is open, and an audio script read aloud in
// two voices with the browser's own speech (free, on this PC, nothing sent anywhere).

import { useSyncExternalStore } from 'react';
import type { NotebookAnswer } from '../../../main/notebook';
import { notebookTabPath, type Citation } from '../../../shared/notebook';
import { pdfAnchor } from '../../../shared/pdf-highlights';
import * as A from './actions';
import { editorFor, getWorkspace, revealLater, setWorkspace } from './layout';
import { prefs, toast } from './store';
import * as W from './workspace';

/** A folder as a notebook ("" is the top of the notes): the tab already showing it comes forward, else it opens beside
 *  the page someone is on. */
export function openNotebook(folder: string, where: W.Where = 'current'): void {
  const path = notebookTabPath(folder);
  const ws = getWorkspace();
  const existing = W.groups(ws.root)
    .flatMap((g) => g.tabs.map((t) => ({ g, t })))
    .find(({ t }) => t.type === 'notebook' && t.path === path);
  if (existing && where === 'current') {
    setWorkspace((w) => W.activate(w, existing.g.id, existing.t.id));
    return;
  }
  const active = W.activeTab(ws);
  const at: W.Where = where === 'current' && active.type !== 'empty' && active.type !== 'notebook' ? 'tab' : where;
  setWorkspace((w) => W.open(w, { type: 'notebook', path }, at));
}

/**
 * A cited passage opened beside the notebook (in the pane next to it, else a new one on the right), so the answer stays
 * in sight: a note at the passage's lines, lit for a moment; a PDF at its page, the passage's first words marked.
 */
export function openPassage(c: Pick<Citation, 'path' | 'kind' | 'line' | 'endLine' | 'page' | 'quote'>): void {
  const isNote = c.kind === 'note';
  const span = c.line !== undefined && c.endLine !== undefined ? Math.max(0, c.endLine - c.line) : 0;
  // A PDF: its page and words; another document opens as itself.
  const heading = c.kind === 'pdf' && c.page ? pdfAnchor(c.page, undefined, c.quote.replace(/…$/, '')) : undefined;
  const ws = getWorkspace();
  // Already showing somewhere: brought forward and taken to the passage.
  for (const g of W.groups(ws.root)) {
    const tab = g.tabs.find((t) => t.path === c.path);
    if (!tab) continue;
    const reading = isNote && (tab.mode ?? prefs().defaultMode) !== 'live' && (tab.mode ?? prefs().defaultMode) !== 'source';
    if (isNote && c.line !== undefined && !reading && editorFor(tab.id)) {
      setWorkspace((w) => W.activate(w, g.id, tab.id));
      requestAnimationFrame(() => editorFor(tab.id)?.scrollToLine(c.line!, span));
      return;
    }
    if (isNote && c.line !== undefined) revealLater(c.path, { line: c.line, span });
    if (heading) revealLater(c.path, { heading });
    setWorkspace((w) => W.activate(reading ? W.updateTab(w, tab.id, { mode: 'live' }) : w, g.id, tab.id));
    return;
  }
  if (isNote && c.line !== undefined) revealLater(c.path, { line: c.line, span });
  if (heading) revealLater(c.path, { heading });
  // A note opens where its words can be lit (Live Preview), whatever the usual mode.
  openBeside(c.path, isNote && prefs().defaultMode !== 'live' && prefs().defaultMode !== 'source' ? 'live' : undefined);
}

/** A file opened beside the notebook, so the notebook stays in sight: in the pane next to it, else a new one on the
 *  right (the tab already showing it comes forward instead). */
export function openBeside(path: string, mode?: W.TabState['mode']): void {
  const ws = getWorkspace();
  const shown = W.revealExisting(ws, path);
  if (shown) return setWorkspace(shown);
  // The notebook's own pane (the active one when it shows a notebook, else the one that does) is never the one used.
  const showsNotebook = (g: W.Group) => g.tabs.find((t) => t.id === g.active)?.type === 'notebook';
  const here = showsNotebook(W.activeGroup(ws)) ? W.activeGroup(ws) : (W.groups(ws.root).find(showsNotebook) ?? W.activeGroup(ws));
  const other = W.groups(ws.root).find((g) => g.id !== here.id);
  const place = { type: W.typeOf(path), path };
  setWorkspace((w) => W.noteOpened(other ? W.open(W.activate(w, other.id), place, 'current', mode) : W.open(w, place, 'right', mode), path));
}

// ── Each notebook's conversation (while Ironleaf is open) ─────────────────────────────────────────────────────

export interface Turn {
  question: string;
  answer?: NotebookAnswer;
  error?: string;
}

const threads = new Map<string, Turn[]>();
export const threadOf = (folder: string): Turn[] => threads.get(folder) ?? [];
export const keepThread = (folder: string, turns: Turn[]) => void threads.set(folder, turns.slice(-40));

// ── Read aloud ───────────────────────────────────────────────────────────────────────────────────────────────────

let reading: string | null = null;
const readers = new Set<() => void>();
const told = () => readers.forEach((fn) => fn());

/** The script being read aloud now, if any. */
export function useReading(): string | null {
  return useSyncExternalStore(
    (fn) => {
      readers.add(fn);
      return () => readers.delete(fn);
    },
    () => reading,
  );
}

/** The voices this PC has (Windows' own), once they have loaded. */
function voicesSoon(): Promise<SpeechSynthesisVoice[]> {
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

/** Two different English voices (Australian first), or one voice twice at two pitches. */
function pickVoices(all: SpeechSynthesisVoice[]): [SpeechSynthesisVoice | null, SpeechSynthesisVoice | null] {
  const rank = (v: SpeechSynthesisVoice) => (/^en-AU/i.test(v.lang) ? 0 : /^en-(GB|NZ)/i.test(v.lang) ? 1 : /^en/i.test(v.lang) ? 2 : 9);
  const english = all.filter((v) => rank(v) < 9).sort((a, b) => rank(a) - rank(b) || Number(b.localService) - Number(a.localService));
  const first = english[0] ?? all[0] ?? null;
  const second = english.find((v) => v.name !== first?.name) ?? first;
  return [first, second];
}

/** Stops reading aloud. */
export function stopReading(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  reading = null;
  told();
}

/** An audio overview's script read aloud, line by line, each speaker in their own voice (pressing again stops it). */
export async function readAloud(path: string): Promise<void> {
  if (reading === path) return stopReading();
  stopReading();
  if (typeof speechSynthesis === 'undefined') return toast('Reading aloud isn’t available on this PC.');
  const script = await window.nv.notebook.script(path);
  if (!script.lines.length) return toast('This note has no lines to read (each line starts with a name in bold, like **Alex:**).');
  const voices = await voicesSoon();
  if (!voices.length) return toast('This PC has no voices for reading aloud. Add one in Windows Settings › Time & language › Speech.');
  const [a, b] = pickVoices(voices);
  const names = script.voices.length ? script.voices : [script.lines[0].voice];
  reading = path;
  told();
  script.lines.forEach((line, i) => {
    const u = new SpeechSynthesisUtterance(line.text);
    const second = names.length > 1 ? line.voice === names[1] : i % 2 === 1;
    u.voice = second ? b : a;
    if (a && b && a.name === b.name) u.pitch = second ? 0.85 : 1.1;
    u.rate = 1.02;
    if (i === script.lines.length - 1) u.onend = () => reading === path && stopReading();
    u.onerror = () => reading === path && stopReading();
    speechSynthesis.speak(u);
  });
}

/** Opens a note or file from a notebook's lists: beside the notebook (Ctrl+click: a new tab). */
export const openFrom = (path: string, e: { ctrlKey: boolean; metaKey: boolean }) => (e.ctrlKey || e.metaKey ? A.openPath(path, { where: 'tab' }) : openBeside(path));
