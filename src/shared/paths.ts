// Paths inside the notes: forward slashes, no leading slash, '' is the top. Shared by the main side (resolving and
// rewriting links) and the window (writing new links).

export const folderOfPath = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/**
 * The parts of a path as the path bar shows them (Polish round 4, 29 Oct 2026): at most the last two
 * parts, each whole, with one ellipsis at the start when earlier parts are left out. Never a stub of a part.
 */
/** Device names Windows keeps for itself (never a file or folder, with any extension or none). */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Whether a name's head (before its first dot) is a device name Windows refuses. */
export function isReservedName(head: string): boolean {
  return RESERVED.test(String(head ?? '').trim());
}

/** A file's name with its stem's trailing dots and spaces dropped ("LF meeting..md" → "LF meeting.md", r2 merge:
 *  a title's full stop met the appended extension): null when the stem has no such ending, or nothing would be left. */
function dottedStemFixed(seg: string): string | null {
  const m = /^(.+[. ])\.([A-Za-z0-9]{1,8})$/.exec(seg);
  if (!m) return null;
  const stem = m[1].replace(/[. ]+$/, '');
  return stem ? `${stem}.${m[2]}` : null;
}

/** Whether a file or folder name needs repair before Windows can keep it: the Windows rule only, on any computer. */
export function needsWindowsRepair(name: string): boolean {
  const seg = String(name ?? '');
  if (!seg || seg === '.' || seg === '..') return true;
  if (/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(seg)) return true;
  if (/[. ]$/.test(seg)) return true;
  if (dottedStemFixed(seg) !== null) return true;
  const dot = seg.indexOf('.');
  return isReservedName(dot < 0 ? seg : seg.slice(0, dot));
}

/** Cut at a word where one fits (the same rule both apps cut titles by). */
const softCut = (text: string, max: number): string => {
  const cut = text.slice(0, max);
  const word = cut.replace(/\s+\S*$/, '');
  return word.length >= max / 2 ? word : cut;
};

/**
 * A title as a file name: nothing the file system refuses, at most `max` letters. The one rule, shared by every door
 * that turns words into a file or folder name (notes, folders, imports, captures, attachments, exports, projects,
 * agents): the person's words kept whole (case, spaces and all), only what Windows refuses changed — a device name
 * gains a word ("CON" → "CON file"), capped at a word, never mid-word. (Nov 2026: a note titled with a full stop
 * became a folder Windows could only reach by a special path.)
 */
export function cleanFileName(raw: unknown, fallback: string, max = 80, reservedWord = 'file'): string {
  let name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|#[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (name.length > max) name = softCut(name, max).replace(/[. ]+$/, '').trimEnd();
  if (!name || /^\.+$/.test(name)) return fallback;
  const stemFixed = dottedStemFixed(name);
  if (stemFixed !== null) name = stemFixed;
  const dot = name.indexOf('.');
  const head = dot < 0 ? name : name.slice(0, dot);
  if (isReservedName(head)) name = dot < 0 ? `${name} ${reservedWord}` : `${head} ${reservedWord}${name.slice(dot)}`;
  return name || fallback;
}

/**
 * A name a person typed, fitted to leading words at most `max` letters: the fitted name and whether it was
 * shortened, so the door can say so (t207 pass 2: names cut silently, the hover never knowing the rest — the
 * renameConversation style wrapper, shared by notes and projects). File-bound names (notes) clean the way the
 * file rule cleans, so what is fitted is what is kept; bare titles (projects) keep every character but the
 * surrounding space. The default 80 is what the main side keeps (cleanFileName's own cap): fitting further
 * (t212, 11 Nov 2026: 179 fitted, 78 kept) cut a second time with no words.
 */
export function fitTypedName(raw: unknown, max = 80, fileSafe = true): { name: string; cut: boolean } {
  let cleaned = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (fileSafe) cleaned = cleanFileName(cleaned, '', 1 << 30);
  if (cleaned.length <= max) return { name: cleaned, cut: false };
  const cut = softCut(cleaned, max).trimEnd();
  const name = fileSafe ? cut.replace(/[. ]+$/, '').trimEnd() : cut;
  return { name: name || cleaned.slice(0, max), cut: true };
}

export function pathParts(parts: readonly string[]): string[] {
  const clean = parts.filter((p) => p.trim());
  return clean.length <= 2 ? [...clean] : ['…', ...clean.slice(-2)];
}

/**
 * A name with Windows' trailing dots and spaces dropped ("LF internal IT meeting. " becomes "LF internal IT meeting"):
 * Windows strips them from ordinary paths, so a folder kept with them is reachable only through a \\?\ path (r2, Nov
 * 2026: a meeting titled with a full stop broke its recording's playback). The one rule every path that makes a name
 * shares, on all platforms; dots inside stay. The fallback when nothing is left.
 */
export function stripTrailingDots(raw: unknown, fallback = ''): string {
  const clean = String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return clean || fallback;
}

/** Whether a segment ends the way Windows cannot keep (a trailing dot or space). */
export const hasTrailingDots = (segment: string): boolean => /[. ]$/.test(segment);

/**
 * A vault path with every segment's trailing dots and spaces dropped: a file's own stem, never its extension
 * ("LF internal IT meeting..md" becomes "LF internal IT meeting.md"), and every folder on the way. Unchanged when
 * already clean. A segment that would become empty is left as it is (the caller says so; never silently renamed).
 */
export function healRel(rel: string): string {
  return rel
    .split('/')
    .map((seg, i, all) => {
      if (!hasTrailingDots(seg)) {
        // A file's stem may still end with a dot before its extension ("X..md").
        if (i === all.length - 1) {
          const m = /^(.*[. ])\.([A-Za-z0-9]{1,8})$/.exec(seg);
          if (m) {
            const stem = m[1].replace(/[. ]+$/, '');
            if (stem) return `${stem}.${m[2]}`;
          }
        }
        return seg;
      }
      const m = i === all.length - 1 ? /^(.*)\.([A-Za-z0-9]{1,8})$/.exec(seg) : null;
      if (m && m[1]) {
        const stem = m[1].replace(/[. ]+$/, '');
        if (stem) return `${stem}.${m[2]}`;
      }
      const clean = seg.replace(/[. ]+$/, '');
      return clean || seg;
    })
    .join('/');
}

/**
 * An absolute path in the form Windows' own calls need when trailing dots or spaces are in it: the \\?\ prefix with
 * backslashes, which skips Windows' stripping so the file is reached as named. Unchanged on other platforms and when
 * clean. Pure on purpose: the platform is passed in so the Windows rule is tested on Linux.
 */
export function win32Abs(abs: string, platform: string): string {
  if (platform !== 'win32' || !abs.split(/[\\/]/).some(hasTrailingDots) || abs.startsWith('\\\\?\\')) return abs;
  return `\\\\?\\${abs.replace(/\//g, '\\')}`;
}

/** A link written as a path from the note's folder (./ beside it, ../ a folder up). */
export const isRelativeTarget = (target: string): boolean => /^\.\.?\//.test(target.replace(/\\/g, '/').trim());

/** A path written from a folder (./ and ../ allowed), as a path from the top; null when it climbs out of the notes. */
export function joinPath(dir: string, target: string): string | null {
  const parts = dir ? dir.split('/') : [];
  for (const part of target.replace(/\\/g, '/').trim().split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

/** The path from a folder to a place in the notes: ../ to climb, ./ for one in the same folder or below. */
export function relativePath(fromDir: string, to: string): string {
  const a = fromDir ? fromDir.split('/') : [];
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  const up = a.length - i;
  return up ? [...Array<string>(up).fill('..'), ...b.slice(i)].join('/') : `./${b.slice(i).join('/')}`;
}

/** Whether a note is inside a folder (the folder written with a slash or not): the one check every templates/skip rule
 *  shares (Nov 2026 audit: three skips normalised differently, so 'Templates/' missed its notes). */
/** Cleaned folders for inFolder, kept (t102, 9 Nov 2026): the same folder checks thousands of notes. Pure. */
const inFolders = new Map<string, string>();
export function inFolder(notePath: string, folder: string): boolean {
  let f = inFolders.get(folder);
  if (f === undefined) {
    f = folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/').toLowerCase();
    if (inFolders.size > 20000) inFolders.clear();
    inFolders.set(folder, f);
  }
  return !!f && notePath.toLowerCase().startsWith(`${f}/`);
}
