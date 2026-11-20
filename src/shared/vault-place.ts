// Where the vault is (Settings › Files and links › Where your vault is; src/main/vault-place.ts): what the window is told
// about the folder the notes live in, the places it can move to, and a vault found in a synced folder on a new PC.

/** The services that keep a folder the same on every PC signed in to them. */
export type SyncService = 'onedrive' | 'dropbox' | 'gdrive' | 'icloud';
/** Where a folder is: in one of those, on a network drive, or only on this PC. */
export type PlaceKind = SyncService | 'network' | 'local';

export interface VaultPlace {
  kind: PlaceKind;
  /** The service by name, as people know it ("OneDrive", "OneDrive – Contoso", "Dropbox", "Google Drive"…). */
  name: string;
  /** One plain line: where the notes are, and what that means for them. */
  words: string;
  /** The folder of the service (or the network share) it is in. */
  root?: string;
}

/** A place the vault can move to (its parent: the vault goes in an Ironleaf folder inside it). */
export interface MoveTarget {
  id: string;
  kind: PlaceKind;
  /** "OneDrive › Documents", "Dropbox", "Google Drive › My Drive", "Z: on \\nas\home". */
  label: string;
  path: string;
}

/** A vault in a synced folder (or a network drive), for a new PC to open. */
export interface FoundVault {
  path: string;
  kind: PlaceKind;
  /** The service by name ("Dropbox"). */
  name: string;
  notes: number;
  projects: number;
}

export interface PlaceStatus {
  /** The vault's folder (the library). */
  library: string;
  /** The folder of notes open now, which everything here describes and a move acts on (the library, or another
   *  folder of notes the person opened). */
  folder: string;
  /** Whether the folder open is the library. */
  isLibrary: boolean;
  place: VaultPlace;
  targets: MoveTarget[];
  /** Today's one-time card: the notes are only on this PC, and there are enough of them to care. */
  onlyHereCard: boolean;
  /** Today's card on a new PC: a vault elsewhere to open instead of this new, empty one. */
  found: FoundVault | null;
  /** The folder open is another app's notes, not the library (5 Nov 2026, u3 moving-in): Home offers to make it
   *  the vault, Settings keeps the offer. */
  adoptable: boolean;
}

/** What a move will do, shown before it starts. */
export interface MovePlan {
  from: string;
  to: string;
  label: string;
  files: number;
  bytes: number;
}

/** Why a move can't go there, in words; and when another vault is there, that vault (to open instead). */
export interface MoveRefusal {
  refused: 'inside' | 'same' | 'vault' | 'space' | 'unreadable';
  words: string;
  vault?: FoundVault;
}

export interface MoveProgress {
  phase: 'copying' | 'checking' | 'switching' | 'tidying';
  done: number;
  total: number;
  files: number;
  totalFiles: number;
}

export interface MoveDone {
  path: string;
  /** Whether the old folder went to the Bin (else it is still where it was, and `words` says so). */
  trashed: boolean;
  words: string;
}

export const isRefusal = (x: unknown): x is MoveRefusal => !!x && typeof x === 'object' && typeof (x as MoveRefusal).refused === 'string';

/** "1 note", "214 notes". */
export const countWords = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-AU')} ${n === 1 ? one : many}`;

/** "1.4 MB". */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

/** The first note a new library holds (written once, never over the person's own). */
export const WELCOME_NAME = 'Welcome to Ironleaf.md';
/** The first note earlier versions wrote (kept: libraries made before the rename to Ironleaf still have it). */
export const LEGACY_WELCOME_NAME = 'Welcome to NeuralVault.md';
/** Either first note. */
export const isWelcomeName = (rel: string): boolean => rel === WELCOME_NAME || rel === LEGACY_WELCOME_NAME;

/**
 * Whether a note is the person's own: not the first note, not a ready-made template (t156, 9 Nov 2026: the
 * setup steps and the day's teaching line read `notes.length === 0`, which a new vault never is — the welcome
 * note and the templates folder are already in it — so a new person never saw them).
 */
export function isOwnNote(rel: string, templatesFolder: string): boolean {
  if (isWelcomeName(rel)) return false;
  const t = (templatesFolder || '').toLowerCase().replace(/\/+$/, '');
  if (t && rel.toLowerCase().startsWith(`${t}/`)) return false;
  return true;
}

/** A vault nobody used yet: nothing in it but the app's own files (or nothing at all). */
export function isFreshVault(paths: readonly string[], templatesFolder: string): boolean {
  return paths.every((p) => !isOwnNote(p, templatesFolder));
}
