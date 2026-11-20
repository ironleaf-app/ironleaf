// Files done properly (Wave 4 part c, 24 Oct 2026). The target: files live with the thing they belong to, every file has
// "what is this", versions (v1, v2, superseded) and its source (who sent it, when), large uploads carry on after a break,
// and each area of life has its asset library, Family photos asked for each time they are used. ONE RULE: a file lives
// with its record. A file added to a project, a meeting, a person or any note goes in a Files folder beside that note:
//   Projects/Tessaly/Tessaly.md          → Projects/Tessaly/Files/Survey.xlsx          (the note owns its folder)
//  Meetings/2026-10-23 Alignment.md → Meetings/Files/2026-10-23 Alignment/a.pdf (a folder of many notes)
// Beside the files, one small record per Files folder (`.files.json`, plain JSON people can read; the dot keeps it out of
//search and lists): what each file is for, what it is (type, pages, a title and one line on what it says), where it came
//from, its version and the older versions kept (`.versions/`, also out of search: links always reach the latest). A
//folder moved with its record carries its files' records with it. A file's sensitivity level stays where every agent
//reads it (src/shared/sensitivity.ts, the vault's sensitivity file), never copied here, so the two can't disagree. Pure:
//no files, no Node, no DOM. src/main/vault-files.ts carries it out; the window, the tests, the migration's verification
//and the former host app (built into its desktop plugin) read the same rules.


import { stripTrailingDots } from './paths';
import { plural } from './words';

export const FILES_FOLDER = 'Files';
export const SIDECAR = '.files.json';
export const VERSIONS_FOLDER = '.versions';
/** From this size a file is imported in pieces that carry on after a break (and shows its progress). */
export const BIG_FILE = 200 * 1024 * 1024;
/** One piece of a big import. */
export const PIECE_BYTES = 8 * 1024 * 1024;
/** The largest file Ironleaf takes in (an import, an agent's upload or a fetch). */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024 * 1024;

/** What a file is for, from its name and how the person described it: a report, a quote, a design… */
export const PURPOSES = ['Reports', 'Quotes and pricing', 'Designs and drawings', 'Plans and playbooks', 'Meeting notes', 'Contracts and orders', 'Reference', 'Data and lists', 'Pictures', 'Other'] as const;
export function filePurpose(name: string, what = ''): string {
  const t = `${name} ${what}`.toLowerCase();
  if (/\b(report|status|update|summary|progress)\b/.test(t)) return 'Reports';
  if (/\b(quote|pricing|price|cost|budget|invoice|estimate)\b/.test(t)) return 'Quotes and pricing';
  if (/\b(design|drawing|layout|floor ?plan|cad|dwg|diagram)\b/.test(t)) return 'Designs and drawings';
  if (/\b(playbook|plan|schedule|run ?sheet|roadmap|timeline|guide|checklist)\b/.test(t)) return 'Plans and playbooks';
  if (/\b(meeting|minutes|notes|agenda)\b/.test(t)) return 'Meeting notes';
  if (/\b(contract|order|po|sow|agreement|terms)\b/.test(t)) return 'Contracts and orders';
  if (/\.(png|jpe?g|gif|webp|heic|svg)$/.test(name.toLowerCase())) return 'Pictures';
  if (/\b(manual|reference|standard|policy|spec|specification|raci|bom)\b/.test(t)) return 'Reference';
  if (/\.(xlsx?|csv|tsv|json)$/.test(name.toLowerCase())) return 'Data and lists';
  return 'Other';
}
/** A version written in a file's name ("v2", "v2.2", "rev 3", "-final"). */
export function fileVersion(name: string): string | null {
  const m = /(?:^|[\s_.-])(v|ver|version|rev)\s*\.?\s*(\d+(?:\.\d+)*)/i.exec(name);
  if (m) return `v${m[2]}`;
  return /(?:^|[\s_.-])final(?:[\s_.-]|$)/i.test(name) ? 'final' : null;
}

export type Purpose = (typeof PURPOSES)[number];
export const isPurpose = (v: unknown): v is Purpose => typeof v === 'string' && (PURPOSES as readonly string[]).includes(v);

const cleanRel = (p: string) => p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.split('/').pop() ?? p;
const noteBase = (p: string) => baseOf(p).replace(/\.(md|canvas)$/i, '');

// ── Where a record's files go ────────────────────────────────────────────────────────────────────────────────────────

/** Whether a note owns its folder: its name is the folder's ("Projects/Tessaly/Tessaly.md"). Trailing dots and spaces
 *  don't count on either side (r2, Nov 2026: a note titled with a full stop still owns its folder). */
export function ownsFolder(noteRel: string): boolean {
  const p = cleanRel(noteRel);
  const dir = folderOf(p);
  return !!dir && stripTrailingDots(baseOf(dir)).toLowerCase() === stripTrailingDots(noteBase(p)).toLowerCase();
}

/** The Files folder for a note: beside it ("<folder>/Files" when the note owns its folder, else "<folder>/Files/<name>").
 *  The folder's own name never ends with a dot or a space (Windows strips those, which broke a meeting's recording). */
export function filesFolderFor(noteRel: string): string {
  const p = cleanRel(noteRel);
  const dir = folderOf(p);
  if (ownsFolder(p)) return `${dir}/${FILES_FOLDER}`;
  return `${dir ? `${dir}/` : ''}${FILES_FOLDER}/${stripTrailingDots(noteBase(p), noteBase(p))}`;
}

/** The Files folder a path sits in ("Projects/Tessaly/Files" for "Projects/Tessaly/Files/Reports/a.pdf"), or null. */
export function filesFolderOf(rel: string): string | null {
  const parts = cleanRel(rel).split('/');
  // The innermost Files folder that isn't the file itself.
  for (let i = parts.length - 2; i >= 0; i--) if (parts[i].toLowerCase() === FILES_FOLDER.toLowerCase()) return parts.slice(0, i + 1).join('/');
  return null;
}

/**
 * The notes a Files folder can belong to, most likely first: "Projects/Tessaly/Files" → Projects/Tessaly/Tessaly.md;
 * "Meetings/Files/2026-10-23 Alignment" → Meetings/2026-10-23 Alignment.md. The caller keeps the first that exists.
 */
export function recordCandidates(fileRel: string): string[] {
  const rel = cleanRel(fileRel);
  const files = filesFolderOf(rel);
  if (!files) return [];
  const dir = folderOf(files);
  const out: string[] = [];
  const inside = rel.slice(files.length + 1).split('/');
  // A folder of its own inside Files, named after a note beside the Files folder.
  if (inside.length > 1) {
    out.push(`${dir ? `${dir}/` : ''}${inside[0]}.md`, `${dir ? `${dir}/` : ''}${inside[0]}.canvas`);
  }
  if (dir) out.push(`${dir}/${baseOf(dir)}.md`, `${dir}/${baseOf(dir)}.canvas`);
  return out;
}

/** A file's name and extension ("Survey v2.xlsx" → "Survey v2", ".xlsx"). */
export function splitName(name: string): { stem: string; ext: string } {
  const b = baseOf(name);
  const dot = b.lastIndexOf('.');
  return dot > 0 ? { stem: b.slice(0, dot), ext: b.slice(dot) } : { stem: b, ext: '' };
}

/** The name an older version is kept under in `.versions` ("Survey.xlsx", 1 → "Survey (v1).xlsx"). */
export function versionFileName(name: string, n: number): string {
  const { stem, ext } = splitName(name);
  return `${stem} (v${n})${ext}`;
}

/** Where an older version of a file is kept, from the top of the vault. */
export function versionPath(fileRel: string, n: number): string {
  const rel = cleanRel(fileRel);
  const dir = folderOf(rel);
  return `${dir ? `${dir}/` : ''}${VERSIONS_FOLDER}/${versionFileName(baseOf(rel), n)}`;
}

export const sidecarPath = (folder: string) => `${cleanRel(folder) ? `${cleanRel(folder)}/` : ''}${SIDECAR}`;

// ── The record beside the files ──────────────────────────────────────────────────────────────────────────────────────

export type SourceHow = 'added' | 'dropped' | 'pasted' | 'agent' | 'url' | 'upload' | 'reference' | 'recording' | 'email' | 'telegram' | 'migrated' | 'version' | 'restored';
const HOWS: SourceHow[] = ['added', 'dropped', 'pasted', 'agent', 'url', 'upload', 'reference', 'recording', 'email', 'telegram', 'migrated', 'version', 'restored'];

export interface FileSource {
  /** Who: "you", an agent's name ("Chief"), a person who emailed it. */
  by: string;
  how: SourceHow;
  /** Where from: a web address, the path it was copied from, the folder it was moved out of. */
  from?: string;
  /** When (ISO). */
  at: string;
}

export interface FileVersion {
  n: number;
  /** Its name in `.versions`. */
  file: string;
  size: number;
  /** When it was the latest from (ISO). */
  added?: string;
  source?: FileSource;
  sha256?: string;
}

export interface FileEntry {
  /** The latest version's name in this folder. */
  name: string;
  /** The note it belongs to (the vault path), when it was added to one. */
  record?: string;
  /** What it is for, chosen by the person (else worked out from its name: `purposeOf`). */
  purpose?: Purpose;
  /** What it is: its title (a document's own, else from its name) and one line on what it says. */
  title?: string;
  summary?: string;
  /** Who wrote the line: read from the file here, the assistant, an agent, or the person. */
  summaryBy?: 'file' | 'assistant' | 'agent' | 'you';
  /** "PDF", "Excel workbook"… and pages (slides, sheets) when they could be counted. */
  kind?: string;
  pages?: number;
  pagesWord?: 'pages' | 'slides' | 'sheets';
  size?: number;
  sha256?: string;
  /** When it came into the vault (ISO), and how. */
  added?: string;
  source?: FileSource;
  /** Its version (1 for a file with no older versions); the older ones kept, newest first. */
  version: number;
  versions: FileVersion[];
  /** A newer file of the same family in this folder (named "… v3" beside "… v2"): this one is superseded by it. */
  supersededBy?: string;
  /** A file on this PC kept where it is (never copied): its whole path, size and time when it was linked. The path is
   *  this PC's own (kept in Ironleaf's data, src/main/vault-files.ts › LinkedRefs, found by `id`): never written into
   *  the vault's .files.json, and a path that arrives in that file is never followed ('' until this PC knows it). */
  ref?: { path: string; id?: string; size: number; mtime: number };
  /** An area chosen for it (else its folder's). */
  area?: string;
}

export interface FilesSidecar {
  version: 1;
  files: Record<string, FileEntry>;
}

export const emptySidecar = (): FilesSidecar => ({ version: 1, files: {} });
export const entryKey = (name: string) => baseOf(name).normalize('NFC').toLowerCase();

const str = (v: unknown, max = 300): string | undefined => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const iso = (v: unknown): string | undefined => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 30) : undefined);
const safeName = (v: unknown): string | undefined => {
  const s = str(v, 200);
  return s && !/[\\/]/.test(s) && s !== '.' && s !== '..' ? s : undefined;
};

function cleanSource(raw: unknown): FileSource | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const how = HOWS.includes(r.how as SourceHow) ? (r.how as SourceHow) : undefined;
  const at = iso(r.at);
  if (!how || !at) return undefined;
  const from = str(r.from, 600);
  return { by: str(r.by, 80) ?? 'you', how, at, ...(from ? { from } : {}) };
}

function cleanVersion(raw: unknown): FileVersion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = num(r.n);
  const file = safeName(r.file);
  if (!n || !Number.isInteger(n) || !file) return null;
  const source = cleanSource(r.source);
  const added = iso(r.added);
  const sha = typeof r.sha256 === 'string' && /^[0-9a-f]{64}$/.test(r.sha256) ? r.sha256 : undefined;
  return { n, file, size: num(r.size) ?? 0, ...(added ? { added } : {}), ...(source ? { source } : {}), ...(sha ? { sha256: sha } : {}) };
}

/** One file's record as written (a hand-edited one keeps what can be read). */
export function cleanEntry(raw: unknown, nameHint?: string): FileEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = safeName(r.name) ?? safeName(nameHint);
  if (!name) return null;
  const versions = (Array.isArray(r.versions) ? r.versions : []).map(cleanVersion).filter((v): v is FileVersion => !!v).sort((a, b) => b.n - a.n);
  const version = Math.max(num(r.version) ?? 1, (versions[0]?.n ?? 0) + 1, 1);
  const e: FileEntry = { name, version: Math.round(version), versions };
  const record = str(r.record, 600);
  if (record && !record.split('/').includes('..')) e.record = cleanRel(record);
  if (isPurpose(r.purpose)) e.purpose = r.purpose;
  const title = str(r.title, 200);
  if (title) e.title = title;
  const summary = str(r.summary, 400);
  if (summary) e.summary = summary;
  if (r.summaryBy === 'file' || r.summaryBy === 'assistant' || r.summaryBy === 'agent' || r.summaryBy === 'you') e.summaryBy = r.summaryBy;
  const kind = str(r.kind, 60);
  if (kind) e.kind = kind;
  const pages = num(r.pages);
  if (pages && Number.isInteger(pages)) e.pages = pages;
  if (r.pagesWord === 'pages' || r.pagesWord === 'slides' || r.pagesWord === 'sheets') e.pagesWord = r.pagesWord;
  const size = num(r.size);
  if (size !== undefined) e.size = size;
  if (typeof r.sha256 === 'string' && /^[0-9a-f]{64}$/.test(r.sha256)) e.sha256 = r.sha256;
  const added = iso(r.added);
  if (added) e.added = added;
  const source = cleanSource(r.source);
  if (source) e.source = source;
  const sup = safeName(r.supersededBy);
  if (sup && entryKey(sup) !== entryKey(name)) e.supersededBy = sup;
  if (r.ref && typeof r.ref === 'object') {
    // A linked file's place is this PC's own: the vault's file says only that it is linked (and which link, by id).
    // A path written there (by anyone: a shared or synced vault) is not read, so it can never send Ironleaf to a share
    // (\\host\…, whose very stat hands over this PC's sign-in) or have it open a program (security review, 20 Nov 2026).
    const ref = r.ref as Record<string, unknown>;
    const id = typeof ref.id === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(ref.id) ? ref.id : undefined;
    e.ref = { path: '', ...(id ? { id } : {}), size: num(ref.size) ?? 0, mtime: num(ref.mtime) ?? 0 };
  }
  const area = str(r.area, 40);
  if (area) e.area = area;
  return e;
}

/** A Files folder's record, forgiving: anything it can't read is left out, never an error. */
export function parseSidecar(text: string | null | undefined): FilesSidecar {
  if (!text) return emptySidecar();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptySidecar();
  }
  const out = emptySidecar();
  const files = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).files : null;
  if (!files || typeof files !== 'object') return out;
  for (const [k, v] of Object.entries(files as Record<string, unknown>)) {
    const e = cleanEntry(v, k);
    if (e) out.files[entryKey(e.name)] = e;
  }
  return out;
}

/** Written so a person can read it: entries by name, two-space indents, a line break at the end. */
export function writeSidecar(s: FilesSidecar): string {
  const files: Record<string, FileEntry> = {};
  // A linked file's path stays on this PC (FileEntry.ref): the vault's file keeps only its id, size and time.
  for (const e of Object.values(s.files).sort((a, b) => a.name.localeCompare(b.name))) files[e.name] = e.ref ? { ...e, ref: { ...(e.ref.id ? { id: e.ref.id } : {}), size: e.ref.size, mtime: e.ref.mtime } as FileEntry['ref'] } : e;
  return `${JSON.stringify({ version: 1, files }, null, 2)}\n`;
}

/** The entry for a file in a sidecar (by name, whatever its case). */
export const entryOf = (s: FilesSidecar, name: string): FileEntry | undefined => s.files[entryKey(name)];

// ── What a file is ───────────────────────────────────────────────────────────────────────────────────────────────────

const extOf = (name: string) => (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] ?? '').toLowerCase();

/** The kind of file in words ("PDF", "Word document", "Excel workbook", "Picture (PNG)"). */
export function kindWords(name: string): string {
  const e = extOf(name);
  if (e === 'pdf') return 'PDF';
  if (/^(docx?|docm|dotx|odt|rtf|pages)$/.test(e)) return 'Word document';
  if (/^(xlsx?|xlsm|xltx|ods|numbers)$/.test(e)) return 'Excel workbook';
  if (/^(csv|tsv)$/.test(e)) return `Table (${e.toUpperCase()})`;
  if (/^(pptx?|pptm|potx|ppsx|odp|key)$/.test(e)) return 'PowerPoint deck';
  if (/^(png|jpe?g|gif|webp|bmp|avif|heic|heif|tiff?)$/.test(e)) return `Picture (${e === 'jpeg' ? 'JPG' : e.toUpperCase()})`;
  if (e === 'svg') return 'Drawing (SVG)';
  if (/^(mp4|mov|m4v|mkv|webm|avi|wmv)$/.test(e)) return 'Video';
  if (/^(mp3|wav|m4a|ogg|oga|flac|aac|weba)$/.test(e)) return 'Recording';
  if (/^(txt|text|log)$/.test(e)) return 'Text';
  if (/^(zip|7z|rar|tar|gz)$/.test(e)) return 'Archive';
  if (/^(ttf|otf|woff2?)$/.test(e)) return 'Font';
  if (/^(md|markdown)$/.test(e)) return 'Note';
  if (/^(eml|msg)$/.test(e)) return 'Email';
  return e ? `${e.toUpperCase()} file` : 'File';
}

/** What a file is for: the person's choice, else from its name and title (filePurpose above). */
export function purposeOf(name: string, entry?: Pick<FileEntry, 'purpose' | 'title' | 'summary'>): Purpose {
  if (entry?.purpose) return entry.purpose;
  // Words joined by underscores ("Harbour_Quote_v2.pdf") read as words.
  return filePurpose(name.replace(/_+/g, ' '), `${entry?.title ?? ''} ${entry?.summary ?? ''}`.trim()) as Purpose;
}

/** A title from a file's name when it has none of its own ("Tessaly_Survey_Review_2026-10-22.xlsx" → "Tessaly Survey Review 2026-10-22"). */
export function titleFromName(name: string): string {
  const { stem } = splitName(name);
  const t = stem
    .replace(/[_]+/g, ' ')
    .replace(/(?<=[a-z])-(?=[A-Za-z])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t || name;
}

const BOILER = /^(page \d+( of \d+)?|\d+|confidential|draft|internal use only|copyright.*|©.*|all rights reserved.*|table of contents|contents|untitled)$/i;

/**
 * One line on what a file says, from its words (cheap, local, nothing sent anywhere): a workbook by its sheets and first
 * heading row, a deck by its first slide, anything else by its first real sentence. Never more than 180 characters.
 */
export function summaryFromText(text: string, name: string): string | undefined {
  if (!text || !text.trim()) return undefined;
  const e = extOf(name);
  // A gist shortens to leading words, never … (t207 pass 2).
  const cut = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > 180 ? t.slice(0, 177).replace(/\s+\S*$/, '') : t;
  };
  if (/^(xlsx?|xlsm|xltx|ods)$/.test(e)) {
    const sheets = [...text.matchAll(/\f([^\n]+)/g)].map((m) => m[1].trim()).filter(Boolean);
    const first = text
      .split('\n')
      .filter((l) => !l.startsWith('\f'))
      .map((l) => l.trim())
      .find(Boolean);
    const head = first ? first.split(' | ').slice(0, 5).join(', ') : '';
    if (!sheets.length) return head ? cut(`Columns: ${head}`) : undefined;
    const names = sheets.length > 6 ? `${sheets.slice(0, 6).join(', ')} and ${sheets.length - 6} more` : sheets.join(', ');
    return cut(`${sheets.length === 1 ? 'One sheet' : `${sheets.length} sheets`}: ${names}${head ? `. First row: ${head}` : ''}`);
  }
  if (/^(csv|tsv)$/.test(e)) {
    const first = text.split('\n').find((l) => l.trim());
    const rows = text.split('\n').filter((l) => l.trim()).length;
    return first ? cut(`${Math.max(0, rows - 1).toLocaleString('en-AU')} rows. Columns: ${first.split(e === 'tsv' ? '\t' : ',').slice(0, 6).map((c) => c.replace(/^"|"$/g, '').trim()).join(', ')}`) : undefined;
  }
  const lines = text
    .replace(/\f[^\n]*\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^#+\s*|^[-*•]\s+|^\d+[.)]\s+/g, '').trim())
    .filter((l) => l && !BOILER.test(l) && /[a-z]/i.test(l));
  if (!lines.length) return undefined;
  // The first line that reads as a sentence (some words and a stop), else the first two lines that say something.
  const sentence = lines.find((l) => l.split(/\s+/).length >= 6 && /[.!?:]/.test(l));
  if (sentence) {
    const m = /^(.{30,}?[.!?])(\s|$)/.exec(sentence);
    return cut(m ? m[1] : sentence);
  }
  return cut(lines.slice(0, 2).join(' — '));
}

/** A document's own title, when the words begin with one (a heading-like first line, not a sentence). */
export function titleFromText(text: string): string | undefined {
  const first = text
    .replace(/\f[^\n]*\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l && !BOILER.test(l) && /[a-z]/i.test(l));
  if (!first || first.length > 90 || first.split(/\s+/).length > 12 || /[.!?]$/.test(first)) return undefined;
  return first;
}

/** "PDF, 6 pages, 1.2 MB". */
export function whatWords(e: Pick<FileEntry, 'name' | 'kind' | 'pages' | 'pagesWord' | 'size'>): string {
  const bits = [e.kind ?? kindWords(e.name)];
  if (e.pages) bits.push(`${e.pages.toLocaleString('en-AU')} ${e.pages === 1 ? (e.pagesWord ?? 'pages').replace(/s$/, '') : (e.pagesWord ?? 'pages')}`);
  if (e.size !== undefined) bits.push(sizeWords(e.size));
  return bits.join(', ');
}

export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "21 Oct 2026". */
export function dayWords(isoText: string | undefined): string {
  if (!isoText) return '';
  const d = new Date(isoText);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const HOW_WORDS: Record<SourceHow, string> = {
  added: 'Added',
  dropped: 'Dropped in',
  pasted: 'Pasted',
  agent: 'Sent',
  url: 'Fetched from the web',
  upload: 'Uploaded',
  reference: 'Linked where it is on this PC',
  recording: 'Recorded',
  email: 'Emailed',
  telegram: 'Sent on Telegram',
  migrated: 'Moved here from',
  version: 'New version',
  restored: 'Brought back',
};

/** Where a file came from, in words: "Sent by Chief, 21 Oct 2026", "Moved here from Attachments, 24 Oct 2026". */
export function sourceWords(s: FileSource | undefined): string {
  if (!s) return '';
  const who = s.by && s.by !== 'you' ? ` by ${s.by}` : s.how === 'migrated' ? '' : ' by you';
  const day = dayWords(s.at);
  if (s.how === 'migrated') return `Moved here from ${s.from ? folderOf(s.from) || 'the top of the vault' : 'elsewhere'}${day ? `, ${day}` : ''}`;
  if (s.how === 'url') return `Fetched${who}${s.from ? ` from ${hostOf(s.from)}` : ''}${day ? `, ${day}` : ''}`;
  if (s.how === 'reference') return `Linked${who} where it is on this PC${day ? `, ${day}` : ''}`;
  return `${HOW_WORDS[s.how]}${who}${day ? `, ${day}` : ''}`;
}

function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1] : url;
}

// ── Versions ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A version written in a name ("v2", "v2.2", "rev 3") as a number, else null. */
export function versionInName(name: string): number | null {
  const v = fileVersion(splitName(name).stem);
  if (!v || v === 'final') return null;
  const n = Number(v.slice(1).split('.')[0]);
  return Number.isFinite(n) ? n : null;
}

/** A name with its version taken out, for finding a family ("CV_2026_v3.pdf" and "CV_2026_v2.pdf" → "cv_2026.pdf"). */
export function familyKey(name: string): string {
  const { stem, ext } = splitName(name);
  const bare = stem
    .replace(/(^|[\s_.-])(v|ver|version|rev)\s*\.?\s*\d+(\.\d+)*(?=$|[\s_.()-])/gi, '')
    .replace(/[\s_.-]+$/g, '')
    .replace(/[\s_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return `${bare}${ext.toLowerCase()}`;
}

/**
 * Families of files named by version in one folder ("… v2.pdf", "… v3.pdf"): each older one superseded by the newest.
 * Returns name → the name that supersedes it. Files of different kinds (the PDF and the Word copy) are separate families.
 */
export function namedFamilies(names: string[]): Map<string, string> {
  const fam = new Map<string, { name: string; v: number }[]>();
  for (const n of names) {
    const v = versionInName(n);
    if (v === null) continue;
    const k = familyKey(n);
    const list = fam.get(k) ?? [];
    list.push({ name: n, v });
    fam.set(k, list);
  }
  const out = new Map<string, string>();
  for (const list of fam.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.v - a.v);
    const newest = list[0];
    if (list[1].v === newest.v) continue; // two of the same version: not a line of versions
    for (const older of list.slice(1)) out.set(older.name, newest.name);
  }
  return out;
}

/** The versions of a file as one list, the latest first: managed versions and older files named by version beside it. */
export interface VersionRow {
  n: number;
  /** The latest (what links reach). */
  latest: boolean;
  /** Its path from the top of the vault. */
  path: string;
  name: string;
  size?: number;
  added?: string;
  source?: FileSource;
  /** A file of its own beside the latest ("… v2.pdf"), not kept in `.versions`. */
  named?: boolean;
}

export function versionRows(fileRel: string, entry: FileEntry | undefined, folderEntries: FileEntry[]): VersionRow[] {
  const rel = cleanRel(fileRel);
  const dir = folderOf(rel);
  const name = baseOf(rel);
  const at = (n: string) => `${dir ? `${dir}/` : ''}${n}`;
  // Versions kept here count from 1; a file with none counts from the version in its name ("… v3.pdf" is v3).
  const managed = !!entry && (entry.version > 1 || entry.versions.length > 0);
  const rows: VersionRow[] = [{ n: managed ? entry!.version : (versionInName(name) ?? entry?.version ?? 1), latest: true, path: rel, name, ...(entry?.size !== undefined ? { size: entry.size } : {}), ...(entry?.added ? { added: entry.added } : {}), ...(entry?.source ? { source: entry.source } : {}) }];
  for (const v of entry?.versions ?? []) rows.push({ n: v.n, latest: false, path: versionPath(rel, v.n), name: v.file, size: v.size, ...(v.added ? { added: v.added } : {}), ...(v.source ? { source: v.source } : {}) });
  for (const other of folderEntries) {
    if (other.supersededBy && entryKey(other.supersededBy) === entryKey(name)) rows.push({ n: versionInName(other.name) ?? 0, latest: false, path: at(other.name), name: other.name, named: true, ...(other.size !== undefined ? { size: other.size } : {}), ...(other.added ? { added: other.added } : {}), ...(other.source ? { source: other.source } : {}) });
  }
  return rows.sort((a, b) => Number(b.latest) - Number(a.latest) || b.n - a.n);
}

/** The entry after a new version arrives: the one it replaces kept as version n in `.versions`, newest first. */
export function withNewVersion(entry: FileEntry, kept: { size: number; sha256?: string }, next: { size: number; sha256?: string; source: FileSource }): FileEntry {
  const n = entry.version;
  const old: FileVersion = { n, file: versionFileName(entry.name, n), size: kept.size, ...(entry.added ? { added: entry.added } : {}), ...(entry.source ? { source: entry.source } : {}), ...(kept.sha256 ?? entry.sha256 ? { sha256: (kept.sha256 ?? entry.sha256)! } : {}) };
  const { summary: _s, summaryBy: _b, title: _t, pages: _p, pagesWord: _w, sha256: _h, ...rest } = entry;
  return { ...rest, version: n + 1, versions: [old, ...entry.versions.filter((v) => v.n !== n)], size: next.size, ...(next.sha256 ? { sha256: next.sha256 } : {}), added: next.source.at, source: next.source };
}

/**
 * The entry after an older version is brought back: it becomes the latest (a new number, so the history reads in order),
 * and the one it replaces is kept as an older version, so nothing is lost.
 */
export function withRestored(entry: FileEntry, n: number, at: string, current: { size: number; sha256?: string }): { entry: FileEntry; from: FileVersion; keepAs: FileVersion } | null {
  const from = entry.versions.find((v) => v.n === n);
  if (!from) return null;
  const keepAs: FileVersion = { n: entry.version, file: versionFileName(entry.name, entry.version), size: current.size, ...(entry.added ? { added: entry.added } : {}), ...(entry.source ? { source: entry.source } : {}), ...(current.sha256 ?? entry.sha256 ? { sha256: (current.sha256 ?? entry.sha256)! } : {}) };
  const { summary: _s, summaryBy: _b, title: _t, pages: _p, pagesWord: _w, sha256: _h, ...rest } = entry;
  const next: FileEntry = {
    ...rest,
    version: entry.version + 1,
    versions: [keepAs, ...entry.versions].sort((a, b) => b.n - a.n),
    size: from.size,
    ...(from.sha256 ? { sha256: from.sha256 } : {}),
    added: at,
    source: { by: 'you', how: 'restored', from: `v${n}`, at },
  };
  return { entry: next, from, keepAs };
}

// ── The move of today's flat Attachments into place ─────────────────────────────────────────────────────────────────

export interface MoveNote {
  path: string;
  props?: Record<string, unknown>;
  /** What each of its links reaches now (null: nothing). */
  links: { target: string; reached: string | null }[];
  /** Its words (for a file named in plain words without a link). */
  text?: string;
}

export type HomeKind = 'project' | 'project-note' | 'meeting' | 'person' | 'note' | 'daily';
export type HomeSure = 'linked' | 'named' | 'guess' | 'none';

export interface FileMovePlan {
  from: string;
  /** Where it goes (unset: it stays, and why). */
  to?: string;
  /** The note it belongs with, and why that one. */
  record?: string;
  kind?: HomeKind;
  sure: HomeSure;
  why: string;
  /** Notes whose links reach it now (they are rewritten by the move). */
  linkedFrom: string[];
  size?: number;
}

export interface FileMigrationInput {
  notes: MoveNote[];
  /** Every file in the vault that isn't a note (vault paths), with sizes. */
  files: { path: string; size?: number }[];
  attachmentsFolder: string;
  templatesFolder?: string;
  dailyFolder?: string;
  /** Project files' paths ("Projects/Tessaly/Tessaly.md"). */
  projects: string[];
  /** Other flat folders whose files may belong beside a note (each area's own Files folder, where the move into areas
   *  put the attachments): a file there that a note links to goes beside it; the rest stay, as that is their place. */
  alsoFrom?: string[];
}

const HOME_SCORE: Record<HomeKind, number> = { project: 100, 'project-note': 90, meeting: 80, person: 70, note: 50, daily: 20 };

const STOP = new Set('a an and are as at be by for from has have in into is it its of on or our the their this to was were with your you notes note file files untitled copy final draft new'.split(' '));
// Words that can make a guess: never numbers (a date in two names is no reason), never a version.
const wordsOf = (s: string) => (s.toLowerCase().normalize('NFKD').match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !/\d/.test(w) && !STOP.has(w));
/** A recording Ironleaf made is named after its meeting ("Recording – Kick-off 2026-10-22 05.02.m4a" → "Kick-off"). */
const RECORDING = /^recording\s*[–-]\s*(.+?)\s+\d{4}-\d{2}-\d{2}\b/i;

/** Where a note's files would belong: itself, or its project when it is one of a project's notes. */
function homeOf(n: MoveNote, projects: string[], dailyFolder: string): { record: string; kind: HomeKind } {
  const type = String(n.props?.type ?? '').toLowerCase();
  if (type === 'project' || projects.includes(n.path)) return { record: n.path, kind: 'project' };
  const dir = folderOf(n.path);
  // One of a project's notes (in the project's folder, or below it): the project's Files.
  const proj = projects.filter((p) => ownsFolder(p) && (dir === folderOf(p) || dir.startsWith(`${folderOf(p)}/`))).sort((a, b) => b.length - a.length)[0];
  if (proj) return { record: proj, kind: 'project-note' };
  if (type === 'meeting' || /^meetings?\//i.test(n.path)) return { record: n.path, kind: 'meeting' };
  if (type === 'person' || /^people\//i.test(n.path)) return { record: n.path, kind: 'person' };
  if (dailyFolder && dir.toLowerCase() === dailyFolder.toLowerCase()) return { record: n.path, kind: 'daily' };
  return { record: n.path, kind: 'note' };
}

/**
 * The plan: each file in the attachments folder goes beside the note it belongs with — the project, meeting, person or
 * note that links to it (a project beats a document that also lists it); a file no link reaches goes with the note that
 * names it in words, else with the note whose name it shares most words with (a guess, shown as one); a file with no
 * home at all stays where it is and says so. Nothing is decided by a file's place alone.
 */
export function planFileMigration(input: FileMigrationInput): FileMovePlan[] {
  const attach = cleanRel(input.attachmentsFolder || '');
  if (!attach) return [];
  const templates = cleanRel(input.templatesFolder ?? '').toLowerCase();
  const daily = cleanRel(input.dailyFolder ?? '');
  const inAttach = (p: string) => p.toLowerCase().startsWith(`${attach.toLowerCase()}/`);
  // A file directly in an area's own Files folder (not in a note's folder inside it).
  const also = (input.alsoFrom ?? []).map((d) => cleanRel(d).toLowerCase()).filter(Boolean);
  const inAlso = (p: string) => also.includes(folderOf(p).toLowerCase());
  const notes = input.notes.filter((n) => !(templates && n.path.toLowerCase().startsWith(`${templates}/`)) && !inAttach(n.path));
  const taken = new Set([...input.files.map((f) => f.path.toLowerCase()), ...input.notes.map((n) => n.path.toLowerCase())]);
  const out: FileMovePlan[] = [];
  for (const f of input.files) {
    const flat = inAttach(f.path);
    if (!flat && !inAlso(f.path)) continue;
    const name = baseOf(f.path);
    const linkers = notes.filter((n) => n.links.some((l) => l.reached === f.path));
    // In an area's Files folder only a link moves it (that folder is a proper place for a file no note claims).
    if (!flat && !linkers.length) continue;
    let pick: { record: string; kind: HomeKind; score: number } | null = null;
    let sure: HomeSure = 'none';
    let why = '';
    const consider = (n: MoveNote, bonus: number) => {
      const h = homeOf(n, input.projects, daily);
      const score = HOME_SCORE[h.kind] + bonus;
      if (!pick || score > pick.score || (score === pick.score && h.record.localeCompare(pick.record) < 0)) pick = { ...h, score };
    };
    if (linkers.length) {
      for (const n of linkers) consider(n, Math.min(9, n.links.filter((l) => l.reached === f.path).length));
      sure = 'linked';
    } else {
      const lowName = name.toLowerCase();
      const namers = notes.filter((n) => n.text && n.text.toLowerCase().includes(lowName));
      if (namers.length) {
        for (const n of namers) consider(n, 0);
        sure = 'named';
      } else if (RECORDING.test(name)) {
        // A recording: the note of its meeting (a meeting first, when several notes have that name).
        const title = RECORDING.exec(name)![1].trim().toLowerCase();
        const same = notes.filter((n) => noteBase(n.path).toLowerCase() === title).sort((a, b) => Number(!/^meetings?\//i.test(a.path)) - Number(!/^meetings?\//i.test(b.path)) || a.path.localeCompare(b.path));
        if (same[0]) {
          consider(same[0], 0);
          sure = 'named';
        }
      } else {
        // A guess: the note whose name shares the most words with the file's (two at least).
        const fw = new Set(wordsOf(splitName(name).stem));
        let best: { n: MoveNote; hits: number } | null = null;
        for (const n of notes) {
          const hits = wordsOf(noteBase(n.path)).filter((w) => fw.has(w)).length;
          if (hits >= 2 && (!best || hits > best.hits || (hits === best.hits && n.path.localeCompare(best.n.path) < 0))) best = { n, hits };
        }
        if (best) {
          consider(best.n, 0);
          sure = 'guess';
        }
      }
    }
    const chosen = pick as { record: string; kind: HomeKind; score: number } | null;
    if (!chosen) {
      out.push({ from: f.path, sure: 'none', why: 'No note links to it or names it. Choose where it belongs, or leave it.', linkedFrom: [], ...(f.size !== undefined ? { size: f.size } : {}) });
      continue;
    }
    const recTitle = noteBase(chosen.record);
    why =
      sure === 'linked'
        ? chosen.kind === 'project-note'
          ? `Linked from a note of ${recTitle}`
          : linkers.length > 1
            ? `Linked from ${plural(linkers.length, 'note')}; ${recTitle} is its home`
            : `Linked from ${recTitle}`
        : sure === 'named'
          ? RECORDING.test(name)
            ? `A recording of ${recTitle}`
            : `Named in ${recTitle}`
          : `A guess: its name is like ${recTitle}`;
    const dir = filesFolderFor(chosen.record);
    let to = `${dir}/${name}`;
    if (taken.has(to.toLowerCase()) && to.toLowerCase() !== f.path.toLowerCase()) {
      const { stem, ext } = splitName(name);
      for (let i = 2; i < 1000; i++) {
        const t = `${dir}/${stem} (${i})${ext}`;
        if (!taken.has(t.toLowerCase())) {
          to = t;
          break;
        }
      }
    }
    taken.add(to.toLowerCase());
    out.push({ from: f.path, to, record: chosen.record, kind: chosen.kind, sure, why, linkedFrom: linkers.map((n) => n.path), ...(f.size !== undefined ? { size: f.size } : {}) });
  }
  return out.sort((a, b) => Number(!a.to) - Number(!b.to) || a.from.localeCompare(b.from));
}

/** The person's choices put on the plan: a note chosen for a file ('' leaves it where it is). */
export function withFileChoices(plan: FileMovePlan[], choices: Record<string, string>, existing: string[]): FileMovePlan[] {
  const taken = new Set(existing.map((p) => p.toLowerCase()));
  for (const p of plan) if (p.to && !(p.from in choices)) taken.add(p.to.toLowerCase());
  return plan.map((p) => {
    if (!(p.from in choices)) return p;
    const record = choices[p.from];
    if (!record) {
      const { to: _t, record: _r, kind: _k, ...rest } = p;
      return { ...rest, why: 'You chose to leave it where it is.' };
    }
    const dir = filesFolderFor(record);
    let to = `${dir}/${baseOf(p.from)}`;
    if (taken.has(to.toLowerCase())) {
      const { stem, ext } = splitName(baseOf(p.from));
      for (let i = 2; i < 1000; i++) {
        const t = `${dir}/${stem} (${i})${ext}`;
        if (!taken.has(t.toLowerCase())) {
          to = t;
          break;
        }
      }
    }
    taken.add(to.toLowerCase());
    return { ...p, to, record, sure: 'linked' as HomeSure, why: 'You chose it' };
  });
}

/** The plan in one line ("12 files go beside their notes; 2 stay where they are"). */
export function fileMigrationWords(plan: FileMovePlan[]): string {
  const moving = plan.filter((p) => p.to).length;
  const staying = plan.length - moving;
  if (!plan.length) return 'There is nothing in the attachments folder to move.';
  const a = `${moving.toLocaleString('en-AU')} ${moving === 1 ? 'file goes' : 'files go'} beside ${moving === 1 ? 'its note' : 'their notes'}`;
  return staying ? `${a}; ${staying.toLocaleString('en-AU')} ${staying === 1 ? 'stays' : 'stay'} where ${staying === 1 ? 'it is' : 'they are'}.` : `${a}.`;
}

// ── Markdown links to files ([words](Attachments/a%20b.pdf)): the index follows links to notes only, so these are found
//    and brought up to date here, so a move never breaks one.

const MD_FILE_LINK = /(!?)\[([^\]\n]*)\]\(\s*([^()\s]+?)(\s+"[^"\n]*")?\s*\)/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A path with ./ and ../ worked out ("a/b/../c" → "a/c"), or null when it climbs out of the vault. */
export function normalPath(p: string): string | null {
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join('/');
}

const decodeTarget = (t: string) => {
  try {
    return decodeURI(t);
  } catch {
    return t;
  }
};

/** The files a note's Markdown links reach (not notes: the index has those), each as written and where it reaches. */
export function mdFileTargets(text: string, notePath: string, exists: (p: string) => boolean): { target: string; path: string; fromFolder: boolean }[] {
  const out: { target: string; path: string; fromFolder: boolean }[] = [];
  const dir = folderOf(notePath);
  for (const m of text.matchAll(MD_FILE_LINK)) {
    const raw = m[3].replace(/^<|>$/g, '');
    if (SCHEME.test(raw) || raw.startsWith('#')) continue;
    const t = decodeTarget(raw.replace(/#.*$/, ''));
    if (!t || /\.md$/i.test(t)) continue;
    const near = normalPath(dir ? `${dir}/${t}` : t);
    const top = normalPath(t);
    if (near && exists(near)) out.push({ target: raw, path: near, fromFolder: !!dir });
    else if (top && exists(top)) out.push({ target: raw, path: top, fromFolder: false });
  }
  return out;
}

/** The path from a note's folder to a file ("Files/a.pdf", "../Files/a.pdf"). */
export function relativeFrom(noteDir: string, to: string): string {
  const a = noteDir ? noteDir.split('/') : [];
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

const encodePath = (p: string) => p.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/#/g, '%23');

/** A note's Markdown links to moved files rewritten to where they are now (written the same way: from the note's folder or the top). */
export function rewriteMdFileLinks(text: string, notePath: string, moved: Map<string, string>, existedBefore: (p: string) => boolean): { text: string; count: number } {
  const dir = folderOf(notePath);
  let count = 0;
  const next = text.replace(MD_FILE_LINK, (all, bang: string, label: string, target: string, title: string | undefined) => {
    const raw = target.replace(/^<|>$/g, '');
    if (SCHEME.test(raw) || raw.startsWith('#')) return all;
    const hash = /#.*$/.exec(raw)?.[0] ?? '';
    const t = decodeTarget(raw.replace(/#.*$/, ''));
    if (!t || /\.md$/i.test(t)) return all;
    const near = normalPath(dir ? `${dir}/${t}` : t);
    const top = normalPath(t);
    const was = near && existedBefore(near) ? { p: near, folder: !!dir } : top && existedBefore(top) ? { p: top, folder: false } : null;
    if (!was) return all;
    const to = moved.get(was.p);
    if (!to) return all;
    count++;
    const written = was.folder ? relativeFrom(dir, to) : to;
    return `${bang}[${label}](${encodePath(written)}${hash}${title ?? ''})`;
  });
  return { text: next, count };
}
