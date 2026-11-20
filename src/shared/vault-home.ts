// One standard home for vaults, and the same vault on every PC (23 Oct 2026; src/main/vault-home.ts). The desktop opened
// a second, local vault (C:\Users\<them>\Documents\Work, a plain folder while Windows had moved Documents into OneDrive)
// while a laptop, the former host app and a chat bot used OneDrive\Documents\NeuralVault, so two PCs showed
// two different vaults. What the window is told, and the rules that need no disk (tests/vault-home.test.mjs):
//  - every vault lives in Windows' own Documents folder (the redirected one), in Documents\Ironleaf: the main vault is
//    that folder itself (as every NeuralVault, the former host app and a chat bot before this kept it, in
//    Documents\NeuralVault:
//    that folder stays the home wherever it is already there; LEGACY_HOME_FOLDER), and any extra vault is a
//    folder inside it with its own identity (Documents\Ironleaf\Work), kept out of the main vault's notes;
//  - each vault knows who it is (.neuralvault/vault.json: id, name, created; written once), so every PC and every app
//    recognises the same vault even where its path differs;
//  - a vault only on this PC is warned about when the person's other PCs (the former host app's computer list) have
//  another
//    vault open, with the vault they use (when it is on this PC too) and a checked move into Documents\Ironleaf.

import type { PlaceKind, VaultPlace } from './vault-place';

/** The folder in Documents every vault lives in (a new install's). */
export const HOME_FOLDER = 'Ironleaf';
/** The folder before the rename to Ironleaf (20 Nov 2026), kept: where it already is, it stays the home, and vaults
 *  in it (on this PC, in synced places) are still found. */
export const LEGACY_HOME_FOLDER = 'NeuralVault';
/** Both names, the current one first. */
export const HOME_FOLDERS = [HOME_FOLDER, LEGACY_HOME_FOLDER] as const;

/** The default library in Documents: Documents\NeuralVault where an earlier version's notes are, else Documents\Ironleaf. */
export function defaultLibraryIn(documents: string, p: { join(...p: string[]): string }, exists: (file: string) => boolean): string {
  const legacy = p.join(documents, LEGACY_HOME_FOLDER);
  return exists(legacy) ? legacy : p.join(documents, HOME_FOLDER);
}
/** A vault's own folder of Ironleaf's things (hidden, synced with the notes). */
export const ID_DIR = '.neuralvault';
export const ID_FILE = 'vault.json';

export interface VaultIdentity {
  id: string;
  name: string;
  /** ISO time it was first written. */
  created: string;
}

/** The vault a PC has open, as that PC says it (the former host app's computer list carries it, sealed, between the person's
PCs). */
export interface PcVaultInfo {
  id: string | null;
  name: string;
  path?: string;
  place: PlaceKind;
  /** "OneDrive", "Dropbox", "this PC"… */
  placeName: string;
}

export interface PcEntry {
  id: string;
  name: string;
  me: boolean;
  online: boolean;
  lastSeen: number | null;
  vault: PcVaultInfo | null;
}

/** A vault on this PC, for Settings › Files and links › Your vaults. */
export interface HomeVault {
  path: string;
  name: string;
  id: string | null;
  notes: number;
  projects: number;
  place: VaultPlace;
  /** Open in Ironleaf now. */
  open: boolean;
  /** Ironleaf's library (the vault it opens at start). */
  library: boolean;
  /** In Documents\Ironleaf (the main vault, or a folder inside it). */
  inHome: boolean;
  /** The person's other PCs that have this vault open (by name). */
  pcs: string[];
}

export interface HomeWarning {
  title: string;
  words: string;
  /** The other PCs and the vault each has open. */
  others: { pc: string; vault: string; placeName: string }[];
  /** The vault the other PCs use, when it is on this PC too: open it instead. */
  openHere: { path: string; name: string } | null;
  /** Where "Move it to Documents\Ironleaf" puts it (the folder it would become). */
  moveTo: string | null;
}

/** A folder a move into Documents\Ironleaf left behind, kept until the person says it can go. */
export interface OldFolder {
  from: string;
  to: string;
  at: string;
}

export interface HomeStatus {
  /** Documents\Ironleaf on this PC (Windows' own Documents, wherever it has been moved to). */
  home: string;
  /** Where the home is: synced (OneDrive's Documents backup, Dropbox, Google Drive…) or only on this PC. */
  homePlace: VaultPlace;
  /** The vault open now, as the former host app and a chat bot are told it. */
  current: { path: string; id: string | null; name: string } | null;
  vaults: HomeVault[];
  /** The person's PCs and the vault each has open; null: not known (the former host app isn't signed in to an account, or
   *  this Ironleaf runs on its own). */
  pcs: PcEntry[] | null;
  warning: HomeWarning | null;
  oldFolders: OldFolder[];
  /** The vault open now isn't in Documents\Ironleaf: where a move there would put it. */
  moveTo: string | null;
}

/** What a move into Documents\Ironleaf will do. */
export interface HomeMovePlan {
  from: string;
  to: string;
  files: number;
  bytes: number;
}

// ── Import and export ─────────────────────────────────────────────────────────────────────────────────────────────

export type ImportKind = 'vault' | 'notes';

/** What an import will bring, shown before it starts. */
export interface ImportPlan {
  source: string;
  /** "Work", "Evernote export". */
  sourceName: string;
  kind: ImportKind;
  /** Where in the vault it goes ("" the top: an Ironleaf vault's own paths; else a folder named after the source). */
  into: string;
  files: number;
  notes: number;
  bytes: number;
  /** From a .zip. */
  zip: boolean;
}

export interface ImportSummary {
  sourceName: string;
  into: string;
  /** New files written. */
  added: number;
  /** Already here, the same: left as they were. */
  identical: number;
  /** Notes here that differed: combined, every line of the import kept (under "Merged from …" when new). */
  merged: string[];
  /** Files that differed and can't be combined (pictures, documents): the import's copy kept beside, in its own folder. */
  keptApart: { rel: string; at: string }[];
  /** Pages from another app made into notes (HTML, Word, web archive, CSV). */
  converted: number;
  skipped: { rel: string; why: string }[];
  /** An Ironleaf export's settings: used (the vault here was new), or this vault's own kept. */
  settings: 'applied' | 'kept' | null;
  /** Stopped halfway by the person: what came in stays; importing again continues. */
  stopped?: boolean;
  /** The run's take-back record (for Undo). */
  batchId?: string;
  /** What one Undo takes back now. */
  undoable?: { notes: number; files: number };
  words: string;
}

/** One folder/vault import's take-back record (v4-no-clutter item 2): everything it made or combined, so one Undo
 *  takes it all back. Kept in .neuralvault/import-batches/<id>.json. */
export interface HomeUndoBatch {
  id: string;
  at: string;
  sourceName: string;
  into: string;
  /** Files made (vault paths): Undo moves them to the Bin. */
  added: string[];
  /** Copies kept beside (vault paths): Undo moves them to the Bin. */
  apart: string[];
  /** Notes combined: Undo restores `before` when untouched since (`before` null: too big to keep, said so). */
  updated: { rel: string; before: string | null; after: string; tooBig?: boolean }[];
  /** Taken back already. */
  undone?: boolean;
  /** Stopped halfway: what came in is still taken back whole. */
  stopped?: boolean;
}

export interface ExportDone {
  file: string;
  files: number;
  bytes: number;
  words: string;
}

export interface ImportProgress {
  phase: 'reading' | 'unpacking' | 'merging' | 'packing';
  done: number;
  total: number;
}

// ── Rules ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How long another PC's word about its vault counts (a PC not seen for longer is likely gone). */
export const PC_FRESH_MS = 45 * 24 * 3600 * 1000;

type PathLike = { join(...p: string[]): string; basename(p: string): string; resolve(...p: string[]): string; relative(a: string, b: string): string; isAbsolute(p: string): boolean };

/** Documents\Ironleaf. */
export const homeOf = (documents: string, p: PathLike) => p.join(documents, HOME_FOLDER);

const keyOf = (p: PathLike, x: string) => p.resolve(x).replace(/[\\/]+$/, '').toLowerCase();
export function insideOf(p: PathLike, child: string, parent: string): boolean {
  const c = keyOf(p, child);
  const q = keyOf(p, parent);
  if (c === q) return true;
  const rel = p.relative(q, c);
  return !!rel && !rel.startsWith('..') && !p.isAbsolute(rel);
}

/**
 * Where a vault goes in Documents\Ironleaf: the home itself when it holds no vault yet (the main vault), else a folder
 * inside it by the vault's own name. null: it is in the home already.
 */
export function moveTargetIn(home: string, vault: string, homeHoldsVault: boolean, p: PathLike): string | null {
  if (insideOf(p, vault, home)) return null;
  return homeHoldsVault ? p.join(home, p.basename(vault) || 'Vault') : home;
}

/**
 * The warning: this vault is only on this PC, and the person's other PCs have another vault open. Nothing when the vault
 * is synced (or on a network drive every PC reaches), when no other PC is known, or when they all have this one.
 */
export function homeWarning(o: {
  place: VaultPlace;
  current: { path: string; id: string | null; name: string } | null;
  pcs: PcEntry[] | null;
  now: number;
  /** Vaults on this PC (to offer the one the other PCs use). */
  vaults: { path: string; id: string | null; name: string }[];
  moveTo: string | null;
  homeLabel: string;
}): HomeWarning | null {
  if (!o.current || o.place.kind !== 'local' || !o.pcs) return null;
  const others = o.pcs.filter((pc) => !pc.me && pc.vault && (pc.lastSeen === null ? pc.online : o.now - pc.lastSeen < PC_FRESH_MS) && !sameVault(pc.vault, o.current!));
  if (!others.length) return null;
  const want = others.find((pc) => pc.vault?.id && o.vaults.some((v) => v.id === pc.vault!.id && v.path !== o.current!.path));
  const here = want ? o.vaults.find((v) => v.id === want.vault!.id && v.path !== o.current!.path)! : null;
  const list = others.map((pc) => ({ pc: pc.name, vault: pc.vault!.name, placeName: pc.vault!.placeName }));
  const first = list[0];
  const who = list.length === 1 ? first.pc : `${list.slice(0, -1).map((x) => x.pc).join(', ')} and ${list[list.length - 1].pc}`;
  const theirs = list.every((x) => x.vault === first.vault && x.placeName === first.placeName) ? `“${first.vault}”${placeIn(first.placeName)}` : 'other vaults';
  const words = `${who} ${list.length === 1 ? 'has' : 'have'} ${theirs} open. This one, “${o.current.name}”, is only on this PC, so your other PCs can’t see what you write here.${here ? ` “${here.name}” is on this PC too.` : ''}${o.moveTo ? ` Move it to ${o.homeLabel} and it’s kept with your other vaults.` : ''}`;
  return { title: 'Your PCs have different vaults open', words, others: list, openHere: here ? { path: here.path, name: here.name } : null, moveTo: o.moveTo };
}

const placeIn = (name: string) => (!name || name === 'this PC' ? ' (only on that PC)' : `, synced with ${name}`);

/** The same vault: by its identity when both have one, else by path. */
export function sameVault(a: { id?: string | null; path?: string }, b: { id?: string | null; path?: string }): boolean {
  if (a.id && b.id) return a.id === b.id;
  return !!a.path && !!b.path && a.path.toLowerCase() === b.path.toLowerCase();
}

/** "Synced with OneDrive" / "Only on this PC" / "On a network drive". */
export function placeLine(place: VaultPlace): string {
  if (place.kind === 'local') return 'Only on this PC';
  if (place.kind === 'network') return 'On a network drive';
  return `Synced with ${place.name}`;
}

/** The import's summary in one paragraph. */
export function importWords(s: Omit<ImportSummary, 'words'>): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString('en-AU')} ${k === 1 ? one : many}`;
  const parts: string[] = [];
  if (s.added) parts.push(`${n(s.added, 'new file')}`);
  if (s.merged.length) parts.push(`${n(s.merged.length, 'note')} combined with ${s.merged.length === 1 ? 'the one' : 'the ones'} here`);
  if (s.identical) parts.push(`${n(s.identical, 'file')} already here, the same`);
  if (s.keptApart.length) parts.push(`${n(s.keptApart.length, 'file')} that differed kept beside ${s.keptApart.length === 1 ? 'its' : 'their'} own in “${s.keptApart[0].at.split('/')[0]}”`);
  const head = s.added || s.merged.length || s.keptApart.length ? `From ${s.sourceName}: ${parts.join(', ')}.` : `Nothing new from ${s.sourceName}: ${s.identical ? `all ${n(s.identical, 'file')} ${s.identical === 1 ? 'was' : 'were'} here already, the same` : 'there was nothing to bring in'}.`;
  const conv = s.converted ? ` ${n(s.converted, 'page')} from another app ${s.converted === 1 ? 'was' : 'were'} made into notes.` : '';
  const where = s.into ? ` It’s in the folder “${s.into}”.` : '';
  const set = s.settings === 'applied' ? ' Its settings are in use.' : s.settings === 'kept' ? ' This vault’s own settings were kept.' : '';
  const skip = s.skipped.length ? ` ${n(s.skipped.length, 'file')} couldn’t be brought in.` : '';
  const stop = s.stopped ? ' Stopped halfway. What came in stays; import it again to continue.' : '';
  return `${head}${conv}${where}${set}${skip}${stop} Nothing was renamed or lost.`;
}
