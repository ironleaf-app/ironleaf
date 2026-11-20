// Paired sources (V9, 28 Oct 2026): notes brought in from another app keep where they came from, and bringing them in
// again never overwrites what the person changed. One engine (src/main/pairing/engine.ts), one small reader per app
// (src/main/pairing/*.ts), the same module in Ironleaf (Settings › Files and links › Import…) and in the former host app
// and a chat bot (the vault_import tool, built into the former host app's desktop plugin as vault-import.mjs).
//
// Each imported note says, in its properties: `source` (the app), `source-file` (the export's file name), `source-id`
// (the app's own id for it) and `imported` (the day it first came in; `synced` the day it last changed from the source).
// What was last agreed with the source is kept in .neuralvault/pairs/<pair>.json, which travels with the vault: per
// item, where its note is and a fingerprint of the words the source gave and of the words written. Bringing a source in
// again compares the three: a note only the source changed is brought up to date; a note only the person changed is
// kept; a note both changed is kept and the source's words are put beside it as a copy, with the difference shown.

/** Apps whose export file or folder is brought in (Import… › From another app). */
export type FileKind = 'evernote' | 'notion' | 'keep' | 'readwise' | 'logseq' | 'roam';
/** Every source a pair can have: the file exports, and Todoist, which is only ever kept in step live (V11). */
export type SourceKind = FileKind | 'todoist';

export const SOURCE_KINDS: FileKind[] = ['evernote', 'notion', 'keep', 'readwise', 'logseq', 'roam'];

export const SOURCE_APPS: Record<SourceKind, string> = {
  evernote: 'Evernote',
  notion: 'Notion',
  keep: 'Google Keep',
  readwise: 'Readwise',
  logseq: 'Logseq',
  roam: 'Roam Research',
  todoist: 'Todoist',
};

/** What a person picks for each app, and how they get it from the app (shown on the Import screen). */
export const SOURCE_HOW: Record<FileKind, { pick: 'file' | 'folder' | 'either'; what: string; how: string; extensions: string[] }> = {
  evernote: { pick: 'file', what: 'A notebook export (.enex)', how: 'In Evernote, right-click a notebook › Export notebook…, and choose ENEX. Pick one file, or a folder of them.', extensions: ['enex'] },
  notion: { pick: 'file', what: 'A workspace or page export (.zip)', how: 'In Notion: Settings › Export all workspace content (or ··· › Export on a page), Markdown & CSV, with subpages. If you have HTML pages instead, bring the folder as A folder of notes.', extensions: ['zip'] },
  keep: { pick: 'either', what: 'A Google Takeout export (.zip)', how: 'At takeout.google.com choose only Keep, then pick the zip it sends you, or its unpacked folder.', extensions: ['zip'] },
  readwise: { pick: 'file', what: 'Your highlights (.csv)', how: 'In Readwise: Export › CSV. Every book and article comes in as a note with its highlights.', extensions: ['csv'] },
  logseq: { pick: 'folder', what: 'A graph folder', how: 'Pick the folder Logseq keeps your graph in (it holds pages and journals).', extensions: [] },
  roam: { pick: 'file', what: 'A graph export (.json)', how: 'In Roam: ··· › Export All, and choose JSON.', extensions: ['json'] },
};

/** How-to for any source kind, in plain words (9.2: a kind with no entry, such as Todoist, answers instead of crashing). */
export function sourceHow(kind: SourceKind): { what: string; how: string } {
  const h = (SOURCE_HOW as Partial<Record<SourceKind, { what: string; how: string }>>)[kind];
  return h ?? { what: `An export from ${SOURCE_APPS[kind] ?? kind}`, how: `Export your notes from ${SOURCE_APPS[kind] ?? kind} and pick that file here.` };
}

/** What reading a source found, before anything is written (the Import screen's preview, the tool's preview). */
export interface PairPlan {
  kind: SourceKind;
  app: string;
  /** The export's own name (a notebook, a graph, a workspace). */
  name: string;
  /** The export's file or folder name, as `source-file` says it. */
  sourceFile: string;
  /** The folder the notes go into ("From Evernote/Recipes"); daily pages go to the vault's daily notes. */
  into: string;
  notes: number;
  /** Pictures and other files that come with them. */
  files: number;
  /** Views made (a Notion database becomes a table or board). */
  views: number;
  /** Daily pages (Logseq and Roam journals), which go into the vault's daily notes. */
  daily: number;
  /** A few of the notes' names, to show. */
  sample: string[];
  /** Left out, and why ("3 notes in the bin"). */
  skipped: { what: string; why: string }[];
  /** This source was brought in before: what changed is compared with what was agreed then. */
  again: { lastRun: string; notes: number } | null;
  /** Plain words for the person (what will happen). */
  words: string;
}

export interface PairConflict {
  /** The person's note, kept as it is. */
  rel: string;
  /** The source's words, put beside it. */
  copy: string;
}

/** One run's take-back record (v4-no-clutter item 2): everything the run made or changed, so one Undo takes it
 *  all back. Kept in the pair's record (the last runs); old records without it simply have nothing to take back. */
export interface PairRunUndo {
  /** When the run happened (ISO). */
  at: string;
  /** Notes made (vault paths): Undo moves them to the Bin. */
  added: string[];
  /** Copies put beside the person's notes: Undo moves them to the Bin. */
  beside: string[];
  /** Notes brought up to date: Undo restores `before` when untouched since (`before` null: too big to keep, said so). */
  updated: { rel: string; before: string | null; after: string; remoteBefore: string; fresh?: boolean; tooBig?: boolean }[];
  /** Pictures and files made: Undo moves them to the Bin. */
  files: string[];
  /** Files replaced: Undo restores `before64` when untouched since (base64; null: too big to keep, said so). */
  filesBack: { rel: string; before64: string | null; after: string; tooBig?: boolean }[];
  /** Views made: Undo moves them to the Bin. */
  views: string[];
  /** Views replaced: Undo restores `before` when untouched since. */
  viewsBack: { rel: string; before: string | null; after: string; tooBig?: boolean }[];
  /** Taken back already. */
  undone?: boolean;
  /** Stopped halfway: what came in is still taken back whole. */
  stopped?: boolean;
}

export interface PairSummary {
  kind: SourceKind;
  app: string;
  into: string;
  /** The pair's record (for Undo). */
  pairId: string;
  added: number;
  updated: number;
  same: number;
  /** Changed here and not in the source: kept as the person left it. */
  keptYours: number;
  /** Removed here: not brought back. */
  removedHere: number;
  /** Changed in both: kept, with the source's words beside it. */
  conflicts: PairConflict[];
  files: number;
  views: number;
  /** Changes made here sent back to a two-way source (Notion's properties, Todoist's tasks). */
  sent?: number;
  skipped: { what: string; why: string }[];
  /** The notes written or brought up to date (vault paths), for the AI and the screen to open. */
  written: string[];
  /** Stopped halfway by the person: what came in stays; bringing it in again continues. */
  stopped?: boolean;
  /** Held for confirmation: more than a handful of notes, and the check shown first wasn't confirmed. Nothing written. */
  held?: boolean;
  /** This check's signature: bring it back as `confirmed` to bring in what it found. */
  check?: string;
  /** Notes it will add (while held). */
  fresh?: number;
  /** The plan's words, for the screen to show while held. */
  preview?: string;
  /** What one Undo takes back now. */
  undoable?: { notes: number; files: number };
  words: string;
}

/** A large import's progress (9.5 F1): the phase and how far through it (the screen's bar, the tool's updates). */
export interface PairProgress {
  phase: 'indexing' | 'notes' | 'files' | 'views';
  done: number;
  total: number;
}

/** Live sources kept in step with the person's own token (V10, V11). */
export type LiveKind = 'notion' | 'todoist';

/** Where the person gets each live token, in plain words (shown before they paste it). The token itself is kept in
 *  the app's secret store on this PC (src/main/providers/keys.ts), never in the vault or any file. */
export const LIVE_HOW: Record<LiveKind, { get: string; steps: string }> = {
  notion: { get: 'A Notion internal integration token', steps: 'In Notion, open Settings, then Connections, then Develop or manage integrations. Make a new internal integration for the workspace you want, copy its token (it starts with ntn_ or secret_), and paste it here. Then, in Notion, open each page or database you want here and use its menu to add that integration, or nothing comes across.' },
  todoist: { get: 'Your Todoist API token', steps: 'In Todoist, open Settings, then Integrations, then the Developer tab. Copy your API token and paste it here.' },
};

/** A pair as listed (Settings › Files and links › Paired sources, the tool's list). */
export interface PairListed {
  /** Kept in step live through the former host app (Notion, Todoist, Readwise by token), not an export brought in. */
  live?: boolean;
  /** Paused by the person: nothing is brought in or sent back until they resume it. */
  paused?: boolean;
  id: string;
  kind: SourceKind;
  app: string;
  name: string;
  into: string;
  sourceFile: string;
  firstRun: string;
  lastRun: string;
  notes: number;
  /** Its last run can be taken back with one Undo (when and how many notes). */
  undoable?: { at: string; notes: number };
}

/** "28 Oct 2026". */
export function pairDay(d: Date = new Date()): string {
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString('en-AU')} ${count === 1 ? one : many}`;

/** The preview in words. */
export function planWords(p: Omit<PairPlan, 'words'>): string {
  const parts = [n(p.notes, 'note')];
  if (p.files) parts.push(n(p.files, 'file'));
  if (p.views) parts.push(n(p.views, 'view'));
  const where = p.daily ? `, into “${p.into}” (${n(p.daily, 'daily page')} into your daily notes)` : `, into “${p.into}”`;
  const again = p.again ? ` You brought this in before (${p.again.lastRun}): notes you changed since are kept, and where ${p.app} changed one too, its words go beside yours.` : ' Each note keeps where it came from, so bringing it in again later never overwrites your changes.';
  const left = p.skipped.length ? ` Left out: ${p.skipped.map((s) => `${s.what} (${s.why})`).join('; ')}.` : '';
  return `${parts.join(', ')} from ${p.app}${p.name && p.name !== p.app ? ` “${p.name}”` : ''}${where}.${again}${left}`;
}

/** The summary in words. */
export function summaryWords(s: Omit<PairSummary, 'words'>): string {
  if (s.held) {
    const fresh = s.fresh ?? 0;
    return `This will add ${n(fresh, 'note')}, from the check just now: from ${s.app} into “${s.into}”. Nothing is written until you say so.`;
  }
  const parts: string[] = [];
  if (s.added) parts.push(`${n(s.added, 'note')} added`);
  if (s.updated) parts.push(`${n(s.updated, 'note')} brought up to date`);
  if (s.same) parts.push(`${n(s.same, 'note')} already the same`);
  if (s.keptYours) parts.push(`${n(s.keptYours, 'note')} you changed kept as you left ${s.keptYours === 1 ? 'it' : 'them'}`);
  if (s.removedHere) parts.push(`${n(s.removedHere, 'note')} you removed left out`);
  if (s.files) parts.push(n(s.files, 'file'));
  if (s.views) parts.push(n(s.views, 'view'));
  if (s.sent) parts.push(`${n(s.sent, 'change')} made here sent to ${s.app}`);
  let words = `From ${s.app} into “${s.into}”: ${parts.length ? parts.join(', ') : 'nothing new'}.`;
  if (s.conflicts.length) words += ` ${n(s.conflicts.length, 'note')} changed both here and in ${s.app}: yours ${s.conflicts.length === 1 ? 'is' : 'are'} kept, and ${s.app}’s words are beside ${s.conflicts.length === 1 ? 'it' : 'them'} as a copy to compare.`;
  if (s.skipped.length) words += ` Left out: ${s.skipped.map((x) => `${x.what} (${x.why})`).join('; ')}.`;
  if (s.stopped) words += ' Stopped halfway. What came in stays; bring it in again to continue.';
  return words;
}
