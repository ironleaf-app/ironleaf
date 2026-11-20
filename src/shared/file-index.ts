// Searching inside project files (17 Oct 2026): what the index of each project folder's documents holds, a search hit,
// the progress line, and the link the assistant writes to a file. Shared by the main side (src/main/file-index.ts), the
// window and the assistant. The index is kept in Ironleaf's own data on this PC, never among the notes and never in a
// project's folder.

/** How much of a file the index could read. */
export type FileTextState =
  /** Its words are in the index. */
  | 'text'
  /** A picture, a recording, a program file…: found by its name and dates only. */
  | 'name'
  /** Read, but no words in it (a scanned PDF, an empty sheet). */
  | 'empty'
  /** Bigger than the index reads (its name and dates still count). */
  | 'big'
  /** Could not be read (broken, protected by a password, in use). */
  | 'failed'
  /** The index already holds as much text as it keeps: found by name until room is made. */
  | 'full';

export interface IndexedFile {
  /** Path inside the project's folder, with forward slashes ("Quotes/lighting quote.pdf"). */
  rel: string;
  name: string;
  ext: string;
  size: number;
  modified: number;
  /** When it was made, when known (a remote computer never says: omitted, never copied from modified). */
  created?: number;
  state: FileTextState;
  /** Its words: lines; "\f<label>" lines start a page, slide or sheet ("\fpage 3", "\fslide 2", "\fBudget"). */
  text?: string;
  /** The words were cut at the index's limit for one file. */
  cut?: boolean;
  /** Why a failed file couldn't be read. */
  why?: string;
}

export interface FileHitSnippet {
  text: string;
  /** Where the words to mark fall in `text`, [start, end). */
  ranges: [number, number][];
  /** "page 3", "slide 2", a sheet's name. */
  where?: string;
}

export interface FileHit {
  /** The project's file (in the notes) and its name. */
  project: string;
  projectName: string;
  /** The project's folder on this PC, or a remote project's folder handle (src/shared/project-folder.ts folderHandle). */
  folder: string;
  /** A remote project's computer, by name ("fileserver-01"): its files show in Ironleaf's viewer, read only. */
  remoteName?: string;
  rel: string;
  name: string;
  ext: string;
  size: number;
  modified: number;
  created?: number;
  state: FileTextState;
  score: number;
  /** How many times the words appear inside it. */
  matches: number;
  /** Lines inside it where the words are (none when only its name matched). */
  snippets: FileHitSnippet[];
  /** Only its name or folder matched. */
  byName: boolean;
}

export interface FileIndexProject {
  path: string;
  name: string;
  folder: string;
  /** Searched (the person can switch a project off in Settings › Search). */
  on: boolean;
  /** The folder is on this PC. */
  exists: boolean;
  files: number;
  /** Files whose words are in the index. */
  withText: number;
  /** When the index last finished going through the folder. */
  checked?: number;
}

export interface FileIndexStatus {
  /** Settings › Search › Search inside project files. */
  on: boolean;
  /** Reading files now. */
  busy: boolean;
  /** While busy: files read so far of those to read, and the project being read. */
  done: number;
  todo: number;
  current?: string;
  projects: FileIndexProject[];
  files: number;
  withText: number;
  /** Characters of text kept, and the most kept. */
  chars: number;
  maxChars: number;
  /** Documents the former host app reads for Ironleaf (emails, older Office files): inside the former host
app only. */
  bridge: boolean;
}

/** The limits the index keeps to (Settings › Search says them in words). */
export const FILE_INDEX_LIMITS = {
  /** Documents (Word, Excel, PowerPoint, PDF) bigger than this are found by name only. */
  docBytes: 60 * 1024 * 1024,
  /** Text files (Markdown, text, CSV…) bigger than this are found by name only. */
  textBytes: 8 * 1024 * 1024,
  /** A PDF's pages read, at most. */
  pages: 400,
  /** One file's words kept, at most. */
  fileChars: 600_000,
  /** Every file's words kept, at most. */
  totalChars: 60_000_000,
  /** Files in one project's folder, at most (the newest first). */
  files: 3000,
} as const;

/**
 * A link to a project's file, as the assistant writes it in an answer: nv-file:<project>/<file>, each part encoded, so
 * the chat opens the file (in Ironleaf's viewer, else in its program).
 */
export function projectFileHref(project: string, rel: string): string {
  // Brackets too, so a name with one bracket never ends the Markdown link early.
  const enc = (s: string) => encodeURIComponent(s).replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'));
  return `nv-file:${enc(project)}/${enc(rel)}`;
}

/** The project and file a link names, or null. */
export function parseProjectFileHref(href: string): { project: string; rel: string } | null {
  const m = /^nv-file:([^/]+)\/(.+)$/.exec(href.trim());
  if (!m) return null;
  try {
    return { project: decodeURIComponent(m[1]), rel: decodeURIComponent(m[2]) };
  } catch {
    return null;
  }
}

/** "page 3" for the line at `at`: the last "\f<label>" line before it. */
export function placeOf(lines: string[], at: number): string | undefined {
  for (let i = at; i >= 0; i--) if (lines[i].startsWith('\f')) return lines[i].slice(1) || undefined;
  return undefined;
}
