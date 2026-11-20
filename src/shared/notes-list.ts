// The Notes page's list (8.0 Job C, 29 Oct 2026; SPEC section C): recent notes as rows a person can scan, not a table
// of folder paths. Pure: no files, no DOM. The window (views/NotesPage.tsx) resolves each note's type and project
// from the index it already holds, then this module groups, filters and words them; the tests check it as it is.
//
// A snippet is one plain line of the note itself (its Markdown marks left out, src/shared/snippet.ts), never raw
// Markdown: "**Telstra invoice due Mon**" reads "Telstra invoice due Mon".

import { plainText } from './plain-text';
import { headingWords, stripTitleHeading } from './note-page';
import { isMachineryPath, isQuietPath, type MachineryCtx } from './fewer-folders';
import { typeOfNote, type NoteType } from './note-types';

/** Which kind the Notes page's filter is showing: every note, plain notes, docs, daily notes, or the packs'
 *  records. Docs is a filter here, not a separate place (SPEC C). Records shows only while records are on
 *  show (t277: NotesPage draws it then, through this same mechanism, so every row belongs to a chip). */
export type NoteKindFilter = 'all' | 'notes' | 'docs' | 'daily' | 'records';
export type NoteKind = 'note' | 'doc' | 'daily';

export const NOTE_KIND_FILTERS: readonly { id: NoteKindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'notes', label: 'Notes' },
  { id: 'docs', label: 'Docs' },
  { id: 'daily', label: 'Daily' },
  { id: 'records', label: 'Records' },
];

/** One note as the Notes page needs it: the index's facts, with its kind and its project resolved by the caller. */
export interface NoteListNote {
  path: string;
  title: string;
  /** The name a person sees (a project's own notes go by their project; src/shared/types.ts NoteMeta.label). */
  label?: string;
  mtime: number;
  /** The note type's id as resolved (note-types.ts typeOfNote): 'note', 'doc', 'person'… */
  typeId?: string | null;
  props?: Record<string, unknown>;
  headings?: string[];
  tags?: string[];
}

export interface NoteListRow extends NoteListNote {
  kind: NoteKind;
  /** True when the note is a pack's record (service, bill…: NotesPage marks it from its type, and the page
   *  leaves records out unless the person asks for everything). */
  record?: boolean;
  kindLabel: string;
  /** A record's pack colour (its type's, stone…teal): the row's kind chip wears it (t277). */
  kindColor?: string;
  /** The title as a person reads it, when it differs from the name as written (a daily note's ISO day). */
  displayTitle?: string;
  /** One plain line from the note ('' when nothing readable is known yet). */
  snippet: string;
  /** Its project, when the caller found one (a chip, never a folder path). */
  project?: { path: string; name: string };
  /** Its area's name, when the caller found one and it has no project. */
  area?: string;
}

const DATE_TITLE = /^\d{4}-\d{2}-\d{2}$|^\d{1,2} [A-Z][a-z]{2} \d{4}$/;

/** A note's kind for the Notes filter: a doc by its type, a daily note by its type, its Daily folder or a date
 *  for a name, everything else a plain note. */
export function noteKindOf(note: Pick<NoteListNote, 'path' | 'title' | 'typeId' | 'props'>): NoteKind {
  const type = typeof note.props?.type === 'string' ? note.props.type.trim().toLowerCase() : '';
  if (note.typeId === 'doc' || type === 'doc' || type === 'docs') return 'doc';
  if (note.typeId === 'daily' || type === 'daily' || /(^|\/)daily\//i.test(note.path) || (DATE_TITLE.test(note.title.trim()) && /(^|\/)(daily|diary|journal)\//i.test(note.path))) return 'daily';
  return 'note';
}

export const KIND_LABEL: Record<NoteKind, string> = { note: 'Note', doc: 'Doc', daily: 'Daily' };

/** A pack record's kind in the words its pack uses on its own page (t277, 13 Nov 2026: every record read
 *  "Note", so 17 bills read as notes): its type's name — Bill, Machine, Service, Runbook, Appliance, Trip,
 *  Goal and the rest — read from the pack registries (note-types.ts, built from module-records.ts), never a
 *  hand list, so a new pack's kind reads right by itself. A Bill with kind Subscription reads Subscription,
 *  as Money's Bills page sections them: when the type's own kind options include its own name, the note's
 *  kind (when it matches an option) is the pack's word for it; otherwise the type's name stands (a
 *  Fridge-kind appliance reads Appliance, a Server-kind machine reads Machine). */
export function recordKindWords(type: Pick<NoteType, 'name' | 'fields'>, props?: Record<string, unknown>): string {
  const name = type.name;
  const kindField = type.fields.find((f) => f.key.toLowerCase() === 'kind' && f.kind === 'choice' && Array.isArray(f.options));
  const options = kindField?.options ?? [];
  if (options.some((o) => o.trim().toLowerCase() === name.trim().toLowerCase())) {
    const v = typeof props?.kind === 'string' ? props.kind.trim() : '';
    const hit = v && options.find((o) => o.trim().toLowerCase() === v.toLowerCase());
    if (hit) return hit;
  }
  return name;
}

/** Front matter off, so a snippet never starts with "type: project". */
function withoutFrontMatter(text: string): string {
  const t = String(text ?? '').replace(/^\uFEFF/, '');
  if (!t.startsWith('---')) return t;
  const end = t.indexOf('\n---', 3);
  return end < 0 ? t : t.slice(end + 4);
}

/**
 * One plain line of a note for a list: the first readable line of its text, its Markdown marks left out, cut to
 * about a line. Headings, empty lines, picture embeds, table rows and tick boxes on their own are passed over:
 * a preview is never table headers ("Date · Status · Note"), and a note with only a table or nothing to say
 * shows no preview line (5 Nov 2026, "your notes are yours"). '' when the note has no words of its own.
 */
export function plainSnippet(text: string, max = 150): string {
  const lines = withoutFrontMatter(text).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^```|^~~~/.test(line)) continue;
    if (/^!\[\[/.test(line) || /^!\[/.test(line)) continue;
    // A table's rows (its headers, its rule and its data alike) are never a preview.
    if (line.startsWith('|')) continue;
    if (/^#{1,6}\s+/.test(line)) continue;
    // Plain words the plainText way (29 Oct 2026, sweep 047/055): a comment is never a snippet, and a link
    // to a file keeps its label, never "[[path|label]]" or the path itself.
    const plain = plainText(line).replace(/^\[( |x|X)\]\s*/, '').trim();
    if (!plain || /^\[.\]$/.test(plain)) continue;
    return cutLine(plain, max);
  }
  return '';
}

// Whole words: note rows wrap or clip with hover (t207 pass 2).
function cutLine(text: string, _max: number): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A row's snippet: from the note's text when the caller read it, else its first heading that isn't its title,
 *  else a summary-like property (summary, description, about), else ''. */
export function snippetFor(note: NoteListNote, text?: string): string {
  if (text !== undefined) return plainSnippet(text);
  const heading = (note.headings ?? []).find((h) => h.trim() && h.trim().toLowerCase() !== note.title.trim().toLowerCase());
  if (heading) return cutLine(plainText(heading), 150);
  for (const key of ['summary', 'description', 'about']) {
    const v = note.props?.[key];
    if (typeof v === 'string' && v.trim()) return cutLine(plainText(v), 150);
  }
  return '';
}

/**
 * A snippet as a Notes row shows it, beside its project chip (Polish round 1, 29 Oct 2026, ITEMS 5): a snippet that
 * starts by repeating the chip ("Part of <project> …") loses that lead, so the row says the project once. Only the
 * named project's own lead goes: another project's words, or "Part of" in the middle of a line, stay as written.
 */
export function snippetForDisplay(snippet: string, projectName?: string | null): string {
  const text = String(snippet ?? '').replace(/\s+/g, ' ').trim();
  // A snippet with no words (a lone dash from a list mark) shows as nothing (sweep 3, 028).
  if (/^[-–—·•*]+$/.test(text)) return '';
  if (!text || !projectName?.trim()) return text;
  const name = projectName.replace(/\s+/g, ' ').trim();
  const lead = /^part of\s+/i.exec(text);
  if (!lead) return text;
  const rest = text.slice(lead[0].length);
  if (rest.slice(0, name.length).toLowerCase() !== name.toLowerCase()) return text;
  const after = rest.slice(name.length);
  // The project name must end the lead (not be the start of a longer name): what follows is its end or punctuation.
  if (after && !/^[).,;:·—-]/u.test(after)) return text;
  return after.replace(/^[\s).,;:·—-]+/u, '').trim();
}

const ISO_DAY_TITLE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A daily note's day as a person reads it ("Tue 28 Oct 2026"), from its ISO name; '' for any other title. */
export function dailyTitleWords(title: string): string {
  const m = ISO_DAY_TITLE.exec(title.trim());
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime()) || d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return '';
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A daily note's day for its page title ("Friday 30 October"), from its ISO name; '' for any other title. */
export function dailyPageTitle(title: string): string {
  const m = ISO_DAY_TITLE.exec(title.trim());
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime()) || d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return '';
  return `${FULL_DAYS[d.getDay()]} ${d.getDate()} ${FULL_MONTHS[d.getMonth()]}`;
}

/** A note as a Notes row (kind, snippet and chip words worked out; the caller adds project and area). */
export function noteRow(note: NoteListNote, text?: string): NoteListRow {
  const kind = noteKindOf(note);
  // A daily note is named for its day (sweep 049/057): show the day in a person's words, not "2026-10-28".
  const displayTitle = kind === 'daily' ? dailyTitleWords(note.label || note.title) || dailyTitleWords(note.title) : '';
  return { ...note, kind, kindLabel: KIND_LABEL[kind], snippet: snippetFor(note, text), ...(displayTitle ? { displayTitle } : {}) };
}

/** The notes the filter leaves: one kind (or all), one folder (or all), one project (or all), and the words typed,
 *  in title or snippet. A pack's records stay out unless `includeRecords` (5 Nov 2026, "your notes are yours":
 *  Notes shows what the person wrote, with one quiet Show everything). Notes counts notes only (t277: records
 *  read under All and their own Records chip, never as notes). */
export function filterNoteRows(rows: readonly NoteListRow[], filter: { kind?: NoteKindFilter; folder?: string | null; project?: string | null; query?: string; includeRecords?: boolean } = {}): NoteListRow[] {
  const kind = filter.kind ?? 'all';
  const q = (filter.query ?? '').trim().toLowerCase();
  return rows.filter((r) => {
    if (r.record && !filter.includeRecords) return false;
    if (kind === 'notes' && (r.kind !== 'note' || r.record)) return false;
    if (kind === 'docs' && (r.kind !== 'doc' || r.record)) return false;
    if (kind === 'daily' && (r.kind !== 'daily' || r.record)) return false;
    if (kind === 'records' && !r.record) return false;
    if (filter.folder && !(r.path === filter.folder || r.path.startsWith(`${filter.folder}/`))) return false;
    if (filter.project && r.project?.path !== filter.project) return false;
    if (q && !`${r.label ?? r.title} ${r.title} ${r.snippet}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Types with their own pages (NotesPage): projects, people, meetings and series never list among notes. */
const NOTES_OWN_PAGES = new Set(['project', 'person', 'meeting', 'meeting-series']);

/** Whether a note's type lists on the Notes page: templates (null) never do, and a plain note of a type with its
 *  own page lives on that page instead. */
export function notesPageKeepsType(typeId: string | null, kind: NoteKind): boolean {
  if (typeId === null) return false;
  if (kind === 'note' && NOTES_OWN_PAGES.has(typeId)) return false;
  return true;
}

/** Whether a note's path lists on the Notes page: a folder the person kept out of view never shows (unless
 *  everything shows); the app's own folders hide everything but docs and daily notes (the person's own, a1).
 *  A pack's records show only when asked. */
export function notesPageKeepsPath(path: string, kind: NoteKind, record: boolean, machinery: MachineryCtx, includeRecords = false): boolean {
  if (record && !includeRecords) return false;
  if (isQuietPath(path, machinery)) return false;
  if (kind !== 'doc' && kind !== 'daily' && isMachineryPath(path, machinery)) return false;
  return true;
}

/** Whether a note from the index counts on the Notes page — and on the one side bar (one window, 9 Nov 2026: the
 *  bar said Work 52 while the page said 19). One rule, counted both places, so every count of the same
 *  folder says what the person will see when they click. */
export function countsOnNotes(
  note: { path: string; title: string; props?: Record<string, unknown> },
  types: readonly NoteType[],
  templatesFolder: string | undefined,
  machinery: MachineryCtx,
): boolean {
  const typeId = typeOfNote(note, types, templatesFolder);
  if (typeId === null) return false;
  const kind = noteKindOf({ path: note.path, title: note.title, typeId, props: note.props });
  if (!notesPageKeepsType(typeId, kind)) return false;
  const record = !!types.find((t) => t.id === typeId)?.module;
  return notesPageKeepsPath(note.path, kind, record, machinery, false);
}

/** One folder as the Notes rail shows it: its top folder and count, with its subfolders and theirs. */
export interface NoteFolder {
  name: string;
  /** The path prefix selecting it ('House' or 'House/Appliances'). */
  prefix: string;
  count: number;
  subs: { name: string; prefix: string; count: number }[];
}

/** The folders a set of rows lives in, most notes first: top folders with their second-level folders under them.
 *  Notes in no folder read as their own top row, so nothing hides. A subfolder holding a single note of its own
 *  name reads as that note (5 Nov 2026, fewer folders): no sub row for it, its note still counted with its top. */
export function folderChoices(rows: readonly NoteListRow[]): NoteFolder[] {
  const tops = new Map<string, { name: string; prefix: string; count: number; subs: Map<string, { name: string; prefix: string; count: number; only?: string }> }>();
  for (const r of rows) {
    const parts = r.path.split('/');
    const top = parts.length > 1 ? parts[0] : '';
    let t = tops.get(top);
    if (!t) {
      t = { name: top || 'No folder', prefix: top, count: 0, subs: new Map() };
      tops.set(top, t);
    }
    t.count++;
    if (parts.length > 2) {
      const prefix = `${parts[0]}/${parts[1]}`;
      const sub = t.subs.get(prefix) ?? { name: parts[1], prefix, count: 0, only: r.path };
      sub.count++;
      // More than one row, or a row deeper than the sub itself: not a lone namesake.
      if (sub.count > 1 || r.path !== sub.only || parts.length > 3) sub.only = undefined;
      else sub.only = r.path;
      t.subs.set(prefix, sub);
    }
  }
  // The vault's own daily and docs folders are kinds already (the Daily and Docs filters); listing them again as
  // folders would show the same notes twice, so they stay out of the rail. Notes in no folder show under All notes.
  return [...tops.values()]
    .filter((t) => t.prefix !== '' && t.name.toLowerCase() !== 'daily' && t.name.toLowerCase() !== 'docs')
    .map((t) => ({
      name: t.name,
      prefix: t.prefix,
      count: t.count,
      subs: [...t.subs.values()]
        .filter((s) => {
          if (s.count !== 1 || !s.only) return true;
          const stem = s.only.split('/').pop()!.replace(/\.md$/i, '');
          return stem.toLowerCase() !== s.name.toLowerCase();
        })
        .map((s) => ({ name: s.name, prefix: s.prefix, count: s.count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export interface NoteGroup {
  id: 'pinned' | 'today' | 'week' | 'earlier';
  label: string;
  rows: NoteListRow[];
}

/** How the Notes page orders its rows: newest changed first, or by name. */
export type NoteSort = 'changed' | 'name';
export const NOTE_SORTS: readonly { id: NoteSort; label: string }[] = [
  { id: 'changed', label: 'Newest first' },
  { id: 'name', label: 'Name' },
];

/** Rows in the page's order: newest changed first (ties by name), or by name. */
export function sortNoteRows(rows: readonly NoteListRow[], sort: NoteSort = 'changed'): NoteListRow[] {
  const out = [...rows];
  if (sort === 'name') out.sort((a, b) => (a.displayTitle ?? a.label ?? a.title).localeCompare(b.displayTitle ?? b.label ?? b.title) || b.mtime - a.mtime);
  else out.sort((a, b) => b.mtime - a.mtime || (a.displayTitle ?? a.label ?? a.title).localeCompare(b.displayTitle ?? b.label ?? b.title));
  return out;
}

/** Whether a note is pinned (the pinned set holds paths, kept beside the vault). */
export function isPinned(pinned: readonly string[], path: string): boolean {
  return pinned.includes(path);
}

/** The pinned set with one note pinned or unpinned (paths kept once, in the order pinned). */
export function togglePinned(pinned: readonly string[], path: string): string[] {
  return pinned.includes(path) ? pinned.filter((p) => p !== path) : [...pinned, path];
}

/** Rows split into the pinned ones (in pinned order) and the rest (in the order given). */
export function partitionPinned(rows: readonly NoteListRow[], pinned: readonly string[]): { pinned: NoteListRow[]; rest: NoteListRow[] } {
  const order = new Map(pinned.map((p, i) => [p, i]));
  const pin: NoteListRow[] = [];
  const rest: NoteListRow[] = [];
  for (const r of rows) (order.has(r.path) ? pin : rest).push(r);
  pin.sort((a, b) => order.get(a.path)! - order.get(b.path)!);
  return { pinned: pin, rest };
}

/** Each row's place in the flat list (path to index), so the window finds a row without scanning. */
export function rowPositions(rows: readonly NoteListRow[]): Map<string, number> {
  const out = new Map<string, number>();
  rows.forEach((r, i) => {
    if (!out.has(r.path)) out.set(r.path, i);
  });
  return out;
}

/** A bulk selection (paths) with one row ticked or unticked. */
export function toggleSelected(selected: readonly string[], path: string): string[] {
  return selected.includes(path) ? selected.filter((p) => p !== path) : [...selected, path];
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Monday of the week a day is in (Australian weeks start on Monday). */
const mondayOf = (d: Date) => { const s = startOfDay(d); return new Date(s.getFullYear(), s.getMonth(), s.getDate() - ((s.getDay() + 6) % 7)); };

/**
 * Recent first, in Today / This week / Earlier: today is the same local day, this week is since Monday (and not
 * today), everything older is earlier. Groups with nothing in them are left out. Pinned notes lead in their own
 * group; by name, each group reads by name.
 */
export function groupNoteRows(rows: readonly NoteListRow[], now: Date = new Date(), opts: { sort?: NoteSort; pinned?: readonly string[] } = {}): NoteGroup[] {
  const { pinned: pin, rest } = partitionPinned(rows, opts.pinned ?? []);
  const sorted = sortNoteRows(rest, opts.sort ?? 'changed');
  const today = startOfDay(now).getTime();
  const monday = mondayOf(now).getTime();
  const groups: NoteGroup[] = [
    { id: 'today', label: 'Today', rows: [] },
    { id: 'week', label: 'This week', rows: [] },
    { id: 'earlier', label: 'Earlier', rows: [] },
  ];
  for (const r of sorted) groups[r.mtime >= today ? 0 : r.mtime >= monday ? 1 : 2].rows.push(r);
  const out = groups.filter((g) => g.rows.length);
  // Pinned notes lead, sorted the page's way among themselves.
  if (pin.length) out.unshift({ id: 'pinned', label: 'Pinned', rows: sortNoteRows(pin, opts.sort ?? 'changed') });
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** When a note last changed, as a person reads it: "Today 9:41 am", "Yesterday", "Tue 28 Oct", "12 Mar 2025". */
export function changedWords(mtime: number, now: Date = new Date()): string {
  const d = new Date(mtime);
  if (Number.isNaN(d.getTime())) return '';
  const day = startOfDay(d).getTime();
  const today = startOfDay(now).getTime();
  const mins = Math.floor((today - day) / 86400000);
  let h = d.getHours();
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  const time = `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
  if (mins === 0) return `Today ${time}`;
  if (mins === 1) return `Yesterday ${time}`;
  if (mins > 1 && mins < 7) return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** When a note last changed, short for a row's right side: "9:12 am" today, "Tue" this week, "21 Oct" this
 *  year, "21 Oct 2025" before that. */
export function shortWhen(mtime: number, now: Date = new Date()): string {
  const d = new Date(mtime);
  if (Number.isNaN(d.getTime())) return '';
  const day = startOfDay(d).getTime();
  const today = startOfDay(now).getTime();
  const mins = Math.floor((today - day) / 86400000);
  if (mins === 0) {
    let h = d.getHours();
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
  }
  if (mins > 0 && mins < 7) return DAYS[d.getDay()];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** The projects in a set of rows, most notes first, for the project filter. */
export function projectChoices(rows: readonly NoteListRow[]): { path: string; name: string; count: number }[] {
  const counts = new Map<string, { path: string; name: string; count: number }>();
  for (const r of rows) {
    if (!r.project) continue;
    const had = counts.get(r.project.path);
    if (had) had.count++;
    else counts.set(r.project.path, { ...r.project, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const normTitle = (s: string) => s.trim().toLowerCase().replace(/[\s._-]+/g, ' ');

const MONTH_NUM: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const DAY_NUM: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };

/** A day read from words the app writes (an ISO day, "Fri 30 Oct 2026", "Friday 30 October" with or without the
 *  year, "30 October 2026", "October 30, 2026"); null when it reads as no day. The weekday is kept to check. */
function parseDayWords(s: string): { y: number | null; m: number; d: number; w: number | null } | null {
  const t = String(s ?? '').trim().replace(/,/g, '').replace(/\s+/g, ' ');
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), w: d.getDay() } : null;
  }
  m = /^(?:([a-z]+)\s+)?(\d{1,2})\s+([a-z]+)\s*(\d{4})?$/i.exec(t);
  if (m) {
    const month = MONTH_NUM[m[3].toLowerCase()];
    const day = Number(m[2]);
    if (!month || day < 1 || day > 31) return null;
    const year = m[4] ? Number(m[4]) : null;
    const w = m[1] ? DAY_NUM[m[1].toLowerCase()] ?? null : null;
    if (m[1] && w === null) return null;
    if (year !== null) {
      const d = new Date(year, month - 1, day);
      if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
      return { y: year, m: month, d: day, w };
    }
    return { y: null, m: month, d: day, w };
  }
  m = /^([a-z]+)\s+(\d{1,2})\s+(\d{4})$/i.exec(t);
  if (m) {
    const month = MONTH_NUM[m[1].toLowerCase()];
    const day = Number(m[2]);
    const year = Number(m[3]);
    if (!month || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? { y: year, m: month, d: day, w: null } : null;
  }
  return null;
}

/** Whether a heading only repeats the page title: the same words (marks off, round 4: any note, not only the
 *  daily one), or a daily note's day in any date form the app writes (round 3: ISO, short and full words, with or
 *  without the year). */
function repeatsDay(heading: string, title: string): boolean {
  if (headingWords(heading) === headingWords(title)) return true;
  if (normTitle(heading) === normTitle(title)) return true;
  const words = dailyTitleWords(title);
  if (words && normTitle(heading) === normTitle(words)) return true;
  const page = dailyPageTitle(title);
  if (page && normTitle(heading) === normTitle(page)) return true;
  const a = parseDayWords(heading);
  const b = parseDayWords(title);
  if (!a || !b) return false;
  if (a.m !== b.m || a.d !== b.d) return false;
  if (a.y !== null && b.y !== null) return a.y === b.y;
  // No year on one side: the weekday, when the heading names one, must be the title day's (so "Friday 30
  // October" never hides on a Thursday 30 October).
  if (a.w !== null && b.y !== null) return a.w === new Date(b.y, b.m - 1, b.d).getDay();
  if (a.w !== null && b.w !== null) return a.w === b.w;
  return true;
}

/** The body's first heading line (0-based) when it only repeats the page title, else null (round 4: any note; a
 *  daily note's day in any form counts too). The file keeps its line; the view hides it (Live through the editor,
 *  Reading by leaving it out of its copy). */
export function firstRepeatLine(text: string, title: string): number | null {
  if (!String(title ?? '').trim()) return null;
  const s = String(text ?? '');
  let pos = 0;
  let i = 0;
  // One line at a time (t102, 9 Nov 2026): splitting the whole note on every keystroke cost more than the
  // scan, and the answer sits in the first lines. Same lines, same indexes, same nulls as the split.
  const next = (): string | null => {
    if (pos > s.length) return null;
    const nl = s.indexOf('\n', pos);
    const line = nl < 0 ? s.slice(pos) : s.slice(pos, nl);
    pos = nl < 0 ? s.length + 1 : nl + 1;
    i++;
    return line;
  };
  const first = next();
  if (first !== null && first.trim() === '---') {
    let closed = false;
    for (;;) {
      const l = next();
      if (l === null) break;
      if (/^(---|\.\.\.)\s*$/.test(l)) { closed = true; break; }
    }
    // Unclosed: the old code rescanned from the top, whose first line ('---') is never a heading — null.
    if (!closed) return null;
  } else {
    // Not properties: the first line is body, examined below like the old loop's line 0.
    pos = 0;
    i = 0;
  }
  let fence = false;
  for (;;) {
    const line = next();
    if (line === null) return null;
    const idx = i - 1;
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || !line.trim()) continue;
    const h = /^#[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/.exec(line);
    if (!h) return null;
    return repeatsDay(h[1], title) ? idx : null;
  }
}

/** Whether a note's body starts with a heading that only repeats its title (8.7 w2b round 2 for the daily note,
 *  round 4 for any note): the page head already says it. The file keeps its line; the view hides it. */
export function hidesFirstLine(text: string, title: string): boolean {
  return firstRepeatLine(text, title) !== null;
}

/**
 * The text as a reading copy shows it (8.7 w2b round 4): the body's first heading left out when it only repeats
 * the page title, a daily note's day in any form the app writes counted too. The one copy for Reading, peeks and
 * embedded notes; the file keeps its heading. An ordinary title strips once; the daily words and page forms fall
 * away to nothing on any other title.
 */
export function stripRepeatHeading(text: string, title: string): string {
  return stripTitleHeading(stripTitleHeading(stripTitleHeading(text, title), dailyTitleWords(title)), dailyPageTitle(title));
}
