// Files agents make, delivered into the project they are for (18 Oct 2026). ONE RULE: anything an agent makes for a
// project lands in that project. The parts that are only data and words: the limits, a safe file name, the next free name
// ("Report (2).pdf"), where a project keeps the files saved for it when it has no folder on this PC, and the card a
// delivered file shows as. src/main/agent-files.ts carries the uploads out.

import { filesFolderFor } from './file-records';
import { cleanFileName, isReservedName } from './paths';

/** The largest file an agent may send (bytes): files over 200 MB too, in parts that carry on after a break. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;
/** One piece of a file sent in parts: at most this many base64 characters (well under the relay's 1 MB body). */
export const CHUNK_CHARS = 600 * 1024;
/** The piece size agents are told to use (bytes before base64: 450 KB is 600 KB of base64). */
export const CHUNK_BYTES = (CHUNK_CHARS / 4) * 3;
/** A file sent in one call: at most this much base64 (else begin, append, finish). */
export const ONE_CALL_CHARS = CHUNK_CHARS;
/** Plain text sent in one call (Markdown, CSV…): at most this many characters. */
export const ONE_CALL_TEXT = 400_000;
/** An upload not finished within this long is tidied away. */
export const UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;
/** Uploads open at once (across every agent). */
export const MAX_UPLOADS = 20;

/** Kinds of file never saved into a project (they run when opened on Windows). */
const NEVER = new Set(['exe', 'msi', 'msix', 'appx', 'appxbundle', 'scr', 'com', 'bat', 'cmd', 'lnk', 'url', 'pif', 'hta', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'reg', 'dll', 'cpl', 'inf', 'scf', 'msc', 'jar', 'ps1', 'psm1', 'application', 'gadget', 'settingcontent-ms', 'library-ms', 'search-ms']);

export const extOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

/**
 * The name a file is saved under: only its last part, nothing Windows refuses (\/:*?"<>| and control characters), no
 * dots or spaces at the end, not a device name, at most 150 characters (its extension kept). Throws with plain words for
 * no name, or a kind that runs when opened.
 */
export function safeFileName(raw: unknown): string {
  const last = String(raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .normalize('NFC');
  // No cap here: the kind is checked before the extension-aware cap below cuts it.
  const name = cleanFileName(last, '', 100000);
  if (!name) throw new Error('Give the file a name with its extension, such as "Closeout report.pdf".');
  const ext = extOf(name);
  if (ext && NEVER.has(ext)) throw new Error(`A .${ext} file runs when it is opened, so agents can’t save one into a project. Send a document, a picture, a table or a zip of the work instead.`);
  if (name.length <= 150) return name;
  const keep = ext ? ext.length + 1 : 0;
  return `${name.slice(0, 150 - keep).trimEnd()}${ext ? `.${ext}` : ''}`;
}

/** A folder inside the project's folder ("Reports", "Handover/Drawings"), cleaned; '' for the folder itself. */
export function safeSubfolder(raw: unknown): string {
  const given = String(raw ?? '').replace(/\\/g, '/').trim();
  if (!given) return '';
  if (given.split('/').some((p) => p.trim() === '..') || /^[a-z]:/i.test(given) || given.startsWith('/')) throw new Error('folder is a folder inside the project’s folder, such as "Reports".');
  const rawParts = given.split('/');
  // A device name is refused outright (an agent's folder is an explicit choice, like a rename); the rest is cleaned.
  const headOf = (p: string) => (p.indexOf('.') < 0 ? p : p.slice(0, p.indexOf('.')));
  if (rawParts.some((p) => isReservedName(headOf(p)))) throw new Error('That folder name can’t be used. Choose another, such as "Reports".');
  const clean = rawParts.map((p) => cleanFileName(p, '', 80)).filter((p) => p && p !== '.');
  if (clean.some((p) => p.startsWith('.'))) throw new Error('That folder name can’t be used. Choose another, such as "Reports".');
  if (clean.length > 4) throw new Error('Keep folder to at most 4 levels, such as "Reports/2026".');
  return clean.join('/');
}

/** The next name not taken: "Report.pdf" → "Report (2).pdf" → "Report (3).pdf" (taken: lower-case names). */
export function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  const ext = extOf(name);
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  const stem = base.replace(/ \((\d+)\)$/, '');
  for (let n = 2; n < 10_000; n++) {
    const next = `${stem} (${n})${ext ? `.${ext}` : ''}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  throw new Error('Too many files with that name are there already. Choose another name.');
}

/**
 * Where a project keeps files saved for it when it has no folder on this PC (or its folder is on a remote computer,
 * which Ironleaf reads but never changes): a Files folder beside its project file, "Projects/Studio Upgrade/Files".
 * A project file that isn't in a folder of its own gets "<Name> files" beside it.
 */
export function ownFilesFolder(projectRel: string): string {
  // One rule for every record's files (src/shared/file-records.ts filesFolderFor): Files beside it.
  return filesFolderFor(projectRel);
}

/** "4.2 MB", "820 KB", "12 bytes". */
export function bytesWords(n: number): string {
  if (n < 1024) return `${n} ${n === 1 ? 'byte' : 'bytes'}`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
}

/** A file an agent delivered, as the window shows it (a card: its first page, name, what it is, Open / Show in folder). */
export interface DeliveredFile {
  /** The activity line it belongs to. */
  id: string;
  at: number;
  agentName: string;
  name: string;
  ext: string;
  size: number;
  /** The agent's one line on what it is. */
  what?: string;
  /** In the project's folder on this PC ('folder': `path` inside it), or in the library ('library': `path` from the top
   *  of the library: the project's own Files folder, or a note's attachments). */
  place: 'folder' | 'library';
  path: string;
  /** The whole path on this PC (for its picture). */
  abs: string;
  project?: { path: string; name: string };
  /** A note it was attached to. */
  note?: string;
  /** The project's folder is on a remote computer (read only), so the file was kept in Ironleaf: that computer. */
  remoteName?: string;
  /** It replaced a file of the same name (Full control, asked for). */
  replaced?: boolean;
  /** Still where it was saved (moved or deleted since: false). */
  exists: boolean;
  /** Put away on Today, or looked at. */
  seen: boolean;
}

/** "Other AI apps delivered Closeout report.pdf to Harbour Lane". */
export function deliveredWords(f: Pick<DeliveredFile, 'agentName' | 'name' | 'project' | 'note'>): string {
  const to = f.project ? ` to ${f.project.name}` : f.note ? ` to “${(f.note.split('/').pop() ?? f.note).replace(/\.md$/i, '')}”` : '';
  return `${f.agentName} delivered ${f.name}${to}`;
}

/** File names a line of words names that are among `names` (a project's files): each once, longest first. */
export function namedFiles(words: string, names: string[]): string[] {
  const low = words.toLowerCase();
  const out: string[] = [];
  for (const n of [...new Set(names)].sort((a, b) => b.length - a.length)) {
    if (n.length < 5 || !/\.[a-z0-9]{2,5}$/i.test(n)) continue;
    const at = low.indexOf(n.toLowerCase());
    if (at < 0) continue;
    // Not inside a longer name already found ("Report (2).pdf" holds "2).pdf"…).
    if (out.some((o) => o.toLowerCase().includes(n.toLowerCase()))) continue;
    const before = at === 0 ? ' ' : low[at - 1];
    if (/[a-z0-9]/i.test(before)) continue;
    out.push(n);
  }
  return out;
}
