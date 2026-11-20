// Publications (Wave 6 part a, 24 Oct 2026; module 7 of the catalogue: "Publications, editions, items, puzzles, layout,
// schedule · Edition builder, archive search, print and deliver · Family", and their plan of 22 Oct: a publication with
// its masthead, motto, schedule, sections and their page budgets, house style and delivery; editions with their number,
// date, status, PDF and every piece inside stored as a reusable item with its source; sources and rules per section
// "editable in the vault, not hidden in a script"; a layout studio that shows pages fill and overflow before printing;
// archive and search across every edition; printing to a named printer on a schedule).
//
// Everything is a plain note the person owns, of three types, kept in the Publications area:
//   - a publication   (type: publication)       its masthead, motto, schedule, delivery and house style as properties,
//                                                and its sections as a table: | Section | Pages | Sources | Rules |;
//   - an edition      (type: edition)           its number, date, status, template and PDF as properties, and under a
//                                                heading for each section, links to the items in it, in order;
//   - an item         (type: publication-item)  one piece (a story, a brief, a weather table, a puzzle…) with its
//                                                source and credit; a puzzle keeps its grid and answers in a ```puzzle
//                                                block, its answers in words and the household's solve times.
// A publication's editions and items live in a folder of its own beside it ("Publications/The Gazette/Editions",
// ".../Items"). Since 27 Oct 2026 (one evening's paper made 35 notes) a piece lives inside its edition's note, under its
// section, as a "### Headline" block with its details in a hidden mark: an edition is one note. Older editions' links to
// item notes are still read, and folded in (src/main/publications.ts). Nothing here is about one family's paper: the
// masthead, sections, sources and rules are all data.

import { foldDiacritics } from './markdown';
import { cleanFileName } from './paths';
import { plural } from './words';
// Pure: no files, no Node, no DOM (the edition's pages are made by src/shared/edition-doc.ts).

import { answersText, puzzleWords, readPuzzle, readSolveTime, solveTimeWords, type Puzzle } from './puzzles';

// ── Kinds, statuses, templates ───────────────────────────────────────────────────────────────────────────────────────

export interface ItemKind {
  id: string;
  name: string;
  /** What it is, in a line (the item store's form). */
  words: string;
  /** A puzzle (made by the puzzle engine; its answers print in the next edition). */
  puzzle?: boolean;
}

export const ITEM_KINDS: ItemKind[] = [
  { id: 'story', name: 'Headline story', words: 'A story with a headline, an optional standfirst and picture, and its source.' },
  { id: 'brief', name: 'Brief', words: 'A few lines with a bold head and its source.' },
  { id: 'weather', name: 'Weather', words: 'A forecast as a table: places down the side, days across.' },
  { id: 'sports', name: 'Sports table', words: 'Fixtures, results or a ladder, as a table.' },
  { id: 'image', name: 'Image', words: 'A picture with its caption and credit.' },
  { id: 'cartoon', name: 'Cartoon strip', words: 'A strip of panels with a caption for each.' },
  { id: 'crossword', name: 'Crossword', words: 'Made from your words and clues; its answers print next edition.', puzzle: true },
  { id: 'sudoku', name: 'Sudoku', words: 'Easy, medium or hard, always with exactly one answer.', puzzle: true },
  { id: 'wordsearch', name: 'Word search', words: 'Your words hidden in a square of letters.', puzzle: true },
  { id: 'dailyword', name: 'Daily word', words: 'A word to find from a few guesses already marked.', puzzle: true },
  { id: 'quote', name: 'Quote', words: 'A line worth keeping, and who said it.' },
  { id: 'onthisday', name: 'On this day', words: 'What happened on this day in years gone by.' },
];

export const kindInfo = (id: string): ItemKind | undefined => ITEM_KINDS.find((k) => k.id === id);

/** A kind as written in a note ("Headline story", "story", "Word search", "word-search") → its id. Null when it
 *  names no known kind (9.5: "Potato" read back as a story hid the person's own word; readers keep the raw text). */
export function readKind(v: unknown): string | null {
  const t = String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!t) return 'story';
  const k = ITEM_KINDS.find((x) => x.id === t || x.name.toLowerCase().replace(/[^a-z]/g, '') === t);
  if (k) return k.id;
  if (/^(news|article|headline|lead)/.test(t)) return 'story';
  if (/^(photo|picture|image)/.test(t)) return 'image';
  if (/^(comic|cartoon|strip)/.test(t)) return 'cartoon';
  if (/^(wordle|dailyword|word)$/.test(t)) return 'dailyword';
  if (/^(sport|ladder|fixture|result)/.test(t)) return 'sports';
  if (/^(forecast|weather)/.test(t)) return 'weather';
  if (/onthisday|history/.test(t)) return 'onthisday';
  return null;
}

export const EDITION_STATUSES = ['Draft', 'Built', 'Delivered', 'Printed'] as const;
export type EditionStatus = (typeof EDITION_STATUSES)[number];
export function readStatus(v: unknown): EditionStatus {
  const t = String(v ?? '').trim().toLowerCase();
  return EDITION_STATUSES.find((s) => s.toLowerCase() === t) ?? (/(sent|deliver)/.test(t) ? 'Delivered' : /print/.test(t) ? 'Printed' : /built|ready/.test(t) ? 'Built' : 'Draft');
}

/** A page layout an edition is set in (A4 portrait). Sizes are in points and millimetres, as a printer counts them. */
export interface Template {
  id: string;
  name: string;
  words: string;
  /** Columns on a page (the front can have its own). */
  columns: number;
  frontColumns: number;
  /** Body type size (pt) and leading (times the size). */
  size: number;
  leading: number;
  /** Page margin (mm) and the gap between columns (mm). */
  margin: number;
  gutter: number;
  /** The lead story's headline size (pt). */
  lead: number;
}

export const TEMPLATES: Template[] = [
  { id: 'broadsheet', name: 'Broadsheet', words: 'Four tight columns, small type, rules between columns: the look of a daily paper.', columns: 4, frontColumns: 4, size: 8.6, leading: 1.26, margin: 11, gutter: 4, lead: 30 },
  { id: 'classic', name: 'Classic', words: 'Three columns at an easy reading size: a weekly paper or a long newsletter.', columns: 3, frontColumns: 3, size: 9.4, leading: 1.3, margin: 13, gutter: 5, lead: 28 },
  { id: 'tabloid', name: 'Tabloid', words: 'Two wide columns, bigger type and bold heads: quick to read, good for younger readers.', columns: 2, frontColumns: 2, size: 10.6, leading: 1.32, margin: 14, gutter: 6, lead: 34 },
];
export const templateOf = (id: unknown): Template => TEMPLATES.find((t) => t.id === String(id ?? '').trim().toLowerCase() || t.name.toLowerCase() === String(id ?? '').trim().toLowerCase()) ?? TEMPLATES[0]!;

export const PAGE = { width: 210, height: 297 } as const;

// ── Small readers ────────────────────────────────────────────────────────────────────────────────────────────────────

export type Props = Record<string, unknown>;
export interface NoteIn {
  path: string;
  title: string;
  props: Props;
  content: string;
}

const str = (v: unknown, max = 400): string => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const unlink = (v: unknown): string =>
  str(v, 600)
    .replace(/^"+|"+$/g, '')
    .replace(/^!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/, '$1')
    .trim();
const yes = (v: unknown): boolean => v === true || /^(yes|true|on|y|1)$/i.test(str(v));
const isoDay = (v: unknown): string | null => {
  const t = str(v, 40);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean) : str(v, 2000) ? str(v, 2000).split(/\s*[,;]\s*/).filter(Boolean) : []);
const baseOf = (p: string) => p.split('/').pop() ?? p;
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const stripMd = (p: string) => p.replace(/\.md$/i, '');

/** A name safe for a file ("Snowy 2.0: the bill" → "Snowy 2.0 the bill"). */
export function fileName(name: string, max = 90): string {
  return cleanFileName(name, 'Untitled', max);
}

/** The text of a note below its front matter. */
export function bodyOf(content: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
  return m ? content.slice(m[0].length) : content;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3).toLowerCase());
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** An ISO day (or the day part of a date-time) as a Date, when it is a real day; null for anything else. */
function validDay(iso: unknown): Date | null {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

/** "Monday 26 October 2026" (a paper's dateline). Nothing when the day cannot be read (8.7.1, 31 Oct 2026, pages
 *  that "couldn't show": an edition's Delivery table held a channel where a day was expected, and the weekday of an
 *  Invalid Date threw): the page shows the words as written instead. */
export function longDate(iso: unknown): string {
  const d = validDay(iso);
  if (!d) return '';
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
/** "Mon 26 Oct". Nothing when the day cannot be read (8.7.1, 31 Oct 2026). */
export function shortDate(iso: unknown): string {
  const d = validDay(iso);
  if (!d) return '';
  return `${WEEKDAYS[d.getDay()]!.slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()]!.slice(0, 3)}`;
}
/** "Tuesday 27 October" for an edition's day. Nothing when it cannot be read (8.7.1, 31 Oct 2026). */
export function editionDay(iso: unknown): string {
  const d = validDay(iso);
  if (!d) return '';
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
/** "07:00" → "7:00 am". As written when it cannot be read (8.7.1, 31 Oct 2026). */
export function timeWords(hhmm: unknown): string {
  if (typeof hhmm !== 'string') return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59 || h < 0 || m < 0) return hhmm;
  const am = h < 12;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${am ? 'am' : 'pm'}`;
}

// ── Schedule ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Schedule {
  /** Days of the week (0 Sunday … 6 Saturday). */
  days: number[];
  /** HH:MM, 24-hour. */
  time: string;
}

// No global flag: every use makes its own copy, so one read never moves another's place (9.5: the shared /g DAY_RE
// relied on manual lastIndex resets across call sites, and matchAll starts from the shared place).
const DAY_RE = /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|rsday|urday)?s?\b/i;
const DAY_RE_ALL = () => new RegExp(DAY_RE.source, 'gi');
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** "Mon, Fri 07:00", "Monday and Friday, 7am", "daily 6:30", "weekdays at 7" → the days and the time; null when it says
 *  neither a day nor a time. A lone time keeps no days (9.5: it used to come back Daily, claiming every day). */
export function readSchedule(v: unknown): Schedule | null {
  const t = str(v, 300).toLowerCase();
  if (!t) return null;
  let days: number[] = [];
  if (/\b(daily|every ?day)\b/.test(t)) days = [0, 1, 2, 3, 4, 5, 6];
  else if (/\bweekdays?\b/.test(t)) days = [1, 2, 3, 4, 5];
  else if (/\bweekends?\b/.test(t)) days = [0, 6];
  for (const m of t.matchAll(DAY_RE_ALL())) {
    const k = DAY_KEYS.indexOf(m[1]!.slice(0, 3));
    if (k >= 0 && !days.includes(k)) days.push(k);
  }
  days.sort((a, b) => a - b);
  let time = '';
  const tm = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/.exec(t) ?? /\b(?:at\s+)?(\d{1,2})[:.](\d{2})\b/.exec(t) ?? /\bat\s+(\d{1,2})\b/.exec(t) ?? /^\s*(\d{1,2})\s*$/.exec(t);
  if (tm) {
    let h = Number(tm[1]);
    const mi = Number(tm[2] ?? 0);
    if (tm[3] === 'pm' && h < 12) h += 12;
    if (tm[3] === 'am' && h === 12) h = 0;
    if (h <= 23 && mi <= 59) time = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }
  if (!days.length && !time) return null;
  return { days, time: time || '07:00' };
}

/** A schedule as written back ("Mon, Fri 07:00"; a lone time on its own, so it reads back as one). */
export function scheduleText(s: Schedule | null): string {
  if (!s) return '';
  if (!s.days.length) return s.time;
  const d = s.days.length === 7 ? 'Daily' : s.days.join() === '1,2,3,4,5' ? 'Weekdays' : s.days.map((x) => WEEKDAYS[x]!.slice(0, 3)).join(', ');
  return `${d} ${s.time}`;
}

/** A schedule in words ("Mondays and Fridays at 7:00 am"). */
export function scheduleWords(s: Schedule | null): string {
  if (!s) return 'No schedule';
  const [h, m] = s.time.split(':').map(Number);
  const at = `${((h! + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h! < 12 ? 'am' : 'pm'}`;
  if (!s.days.length) return `At ${at}`;
  if (s.days.length === 7) return `Every day at ${at}`;
  if (s.days.join() === '1,2,3,4,5') return `Weekdays at ${at}`;
  const names = s.days.map((x) => `${WEEKDAYS[x]}s`);
  return `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]} at ${at}`;
}

/** The latest scheduled day whose time has passed by `now` (YYYY-MM-DD), looking back a week: the one edition to
 *  catch up on when the app was closed (built once on return, never one per missed day). Null without a schedule. */
export function lastScheduledDay(s: Schedule | null, now: Date): string | null {
  if (!s || !s.days.length) return null;
  const [h, m] = s.time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, h, m, 0, 0);
    if (s.days.includes(d.getDay()) && d.getTime() <= now.getTime()) return isoOf(d);
  }
  return null;
}

/** The next time a schedule falls, at or after `now` (null without one). */
export function nextRun(s: Schedule | null, now: Date): Date | null {
  if (!s || !s.days.length) return null;
  const [h, m] = s.time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m, 0, 0);
    if (s.days.includes(d.getDay()) && d.getTime() >= now.getTime() - 59_000) return d;
  }
  return null;
}

// ── A publication ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Section {
  name: string;
  /** Its page budget. */
  pages: number;
  /** Where its items may come from: outlets by name, "Any named source" (every item names one), or nothing (no rule). */
  sources: string;
  /** Its rules in the person's words (shown to the assistants and in the layout studio). */
  rules: string;
}

export interface HouseStyle {
  /** Font files in the vault (a .ttf, .otf, .woff or .woff2) for the masthead, headlines and body. */
  mastheadFont: string;
  headFont: string;
  bodyFont: string;
  /** Other faces of the body font (bold, italic) in the vault. */
  bodyFaces: string[];
  /** A picture for the masthead (a crest or logo) in the vault. */
  crest: string;
  /** The ink: '#1a1a1a' unless set; pictures are printed in greyscale when `greyscale` is on. */
  ink: string;
  greyscale: boolean;
  /** Body text set flush on both edges (else ragged on the right, which reads better in narrow columns). */
  justify: boolean;
}

export interface Delivery {
  telegram: boolean;
  email: string[];
  /** The printer by its name on this PC ('' for none) and whether it prints on the schedule. */
  printer: string;
  print: boolean;
  copies: number;
}

export interface Publication {
  path: string;
  title: string;
  masthead: string;
  motto: string;
  schedule: Schedule | null;
  template: Template;
  sections: Section[];
  style: HouseStyle;
  delivery: Delivery;
  /** Where its editions and items are kept ("Publications/The Gazette"). */
  folder: string;
  /** Set up as a module record (it has a Sections table); an older note waiting for import has none. */
  ready: boolean;
}

export const SECTIONS_HEAD = ['Section', 'Pages', 'Sources', 'Rules'];
export const DEFAULT_SECTIONS: Section[] = [
  { name: 'Front', pages: 1, sources: '', rules: 'The lead story, the weather and what is inside.' },
  { name: 'News', pages: 2, sources: 'Any named source', rules: 'Named outlets only; every story says where it came from.' },
  { name: 'Sport', pages: 1, sources: 'Any named source', rules: 'Results, fixtures and tables for the sports the household follows.' },
  { name: 'Puzzles', pages: 1, sources: '', rules: 'Crossword, sudoku, word search and the daily word, with the last edition’s answers.' },
];

/** The folder a publication keeps its editions and items in: its own folder when the note is its folder's
 *  ("Publications/The Gazette/The Gazette.md"), else a folder of its name beside it. */
export function publicationFolder(pubPath: string): string {
  const dir = dirOf(pubPath);
  const name = stripMd(baseOf(pubPath));
  if (dir && baseOf(dir).toLowerCase() === name.toLowerCase()) return dir;
  return `${dir ? `${dir}/` : ''}${name}`;
}
export const editionsFolder = (pub: Pick<Publication, 'folder'>) => `${pub.folder}/Editions`;
export const itemsFolder = (pub: Pick<Publication, 'folder'>) => `${pub.folder}/Items`;

/** One Markdown table row: a leading pipe and at least one more (the closing pipe is optional, as people write
 *  tables both ways). One matcher for every table read: the sections, solve-times and delivery tables here, the pages'
 *  tables, and the weather/sports check (9.5: each had its own, and they disagreed). */
export const TABLE_ROW_RE = /^\s*\|.*\|/;
/** One bullet or numbered line (• included, as the pages draw it). One matcher for every list read. */
export const BULLET_RE = /^\s*(?:\d+[.)]|[-*•])\s+/;

/** A Markdown table's rows under a heading (or the first table in the text when no heading is named). The heading
 *  matches by the words in it, so the person's own variant ("Paper Sections", "My Solve Times", "Solve Times (2026)")
 *  reuses its table instead of growing a second one beside it (9.5). */
function tableUnder(body: string, heading: RegExp): { head: string[]; rows: string[][]; start: number; end: number } | null {
  const lines = body.split(/\r?\n/);
  let i = 0;
  const h = lines.findIndex((l) => /^#{1,6}\s/.test(l) && heading.test(l.replace(/^#{1,6}\s+/, '').trim()));
  if (h < 0) return null;
  i = h + 1;
  while (i < lines.length && !TABLE_ROW_RE.test(lines[i]!)) {
    if (/^#{1,6}\s/.test(lines[i]!)) return null;
    i++;
  }
  if (i >= lines.length) return null;
  const start = i;
  const rows: string[][] = [];
  for (; i < lines.length && TABLE_ROW_RE.test(lines[i]!); i++) rows.push(splitRow(lines[i]!));
  if (rows.length < 2) return null;
  const head = rows[0]!;
  const body2 = rows.slice(1).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)) && r.some((c) => c));
  return { head, rows: body2, start, end: i };
}
const splitRow = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
const cell = (s: string) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

/** A publication's sections from its "## Sections" table (columns found by their headings, in any order). */
export function readSections(content: string): Section[] | null {
  const t = tableUnder(bodyOf(content), /\bsections?\b/i);
  if (!t) return null;
  const col = (re: RegExp) => t.head.findIndex((h) => re.test(h));
  const cn = col(/^(section|name)$/i);
  const cp = col(/^pages?$/i);
  const cs = col(/^sources?$/i);
  const cr = col(/^rules?$/i);
  const out: Section[] = [];
  for (const r of t.rows) {
    const name = (r[cn >= 0 ? cn : 0] ?? '').trim();
    if (!name) continue;
    const pages = Number.parseFloat((r[cp] ?? '').replace(',', '.'));
    out.push({ name: name.slice(0, 60), pages: Number.isFinite(pages) && pages > 0 ? Math.min(40, Math.round(pages * 2) / 2) : 1, sources: (r[cs] ?? '').slice(0, 400), rules: (r[cr] ?? '').slice(0, 600) });
  }
  return out;
}

/** The sections table as written. */
export function sectionsTable(sections: readonly Section[]): string {
  return [`| ${SECTIONS_HEAD.join(' | ')} |`, '| --- | --- | --- | --- |', ...sections.map((s) => `| ${cell(s.name)} | ${s.pages} | ${cell(s.sources)} | ${cell(s.rules)} |`)].join('\n');
}

/** A note with its "## Sections" table set (put in place of the one there, else before "## Editions", else at the end);
 *  everything else in the note stays as written. */
export function withSections(content: string, sections: readonly Section[]): string {
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content)?.[0] ?? '';
  const body = content.slice(fm.length);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const t = tableUnder(body, /\bsections?\b/i);
  const lines = body.split(/\r?\n/);
  if (t) {
    lines.splice(t.start, t.end - t.start, ...sectionsTable(sections).split('\n'));
    return fm + lines.join(eol);
  }
  const block = ['## Sections', '', sectionsTable(sections), ''];
  const at = lines.findIndex((l) => /^##\s+editions?\s*$/i.test(l.trim()));
  if (at >= 0) {
    lines.splice(at, 0, ...block);
    return fm + lines.join(eol);
  }
  return `${fm}${body.replace(/\s*$/, '')}${eol}${eol}${block.join(eol)}`;
}

const FONT_RE = /\.(ttf|otf|woff2?)$/i;

export function readPublication(n: NoteIn): Publication {
  const p = n.props;
  const sections = readSections(n.content);
  const masthead = str(p.masthead, 120) || n.title;
  const email = listOf(p.email).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const font = (v: unknown) => {
    const f = unlink(v);
    return FONT_RE.test(f) ? f : '';
  };
  return {
    path: n.path,
    title: n.title,
    masthead,
    motto: str(p.motto, 200),
    schedule: readSchedule(p.schedule),
    template: templateOf(p.template),
    sections: sections && sections.length ? sections : DEFAULT_SECTIONS.map((s) => ({ ...s })),
    style: {
      mastheadFont: font(p.masthead_font),
      headFont: font(p.head_font),
      bodyFont: font(p.body_font),
      bodyFaces: listOf(p.body_faces).map(unlink).filter((f) => FONT_RE.test(f)),
      crest: unlink(p.crest),
      ink: /^#[0-9a-f]{6}$/i.test(str(p.ink)) ? str(p.ink) : '#1a1a1a',
      greyscale: p.greyscale === undefined ? false : yes(p.greyscale),
      justify: yes(p.justify),
    },
    delivery: { telegram: yes(p.telegram), email, printer: str(p.printer, 120), print: yes(p.print), copies: Math.max(1, Math.min(20, Math.round(Number(p.copies) || 1))) },
    folder: publicationFolder(n.path),
    ready: !!sections,
  };
}

export interface DeliveryWay {
  /** 'telegram', 'email' or 'print' (what to send by). */
  id: string;
  /** The way in words ("email to a@x.com", "printed on Lab"). */
  label: string;
}

/** The ways a publication goes out, each as an id and its words: the one list for sending, the readiness check, the
 *  catalogue words and the schedule's own gate (9.5: each built its own strings, and they disagreed). */
export function deliveryWays(pub: Pick<Publication, 'delivery'>): DeliveryWay[] {
  const d = pub.delivery;
  const out: DeliveryWay[] = [];
  if (d.telegram) out.push({ id: 'telegram', label: 'Telegram' });
  if (d.email.length) out.push({ id: 'email', label: `email to ${d.email.join(', ')}` });
  if (d.print && d.printer) out.push({ id: 'print', label: `printed on ${d.printer}` });
  return out;
}

/** The paper's puzzle section by any of its names ("Puzzles", "Fun", a kind's own: "Crossword", "Daily word"). An
 *  imported paper's kind-named section takes its puzzles (9.5: only /puzzle|fun|game/ matched, so a "Crossword"
 *  section's puzzles landed in the last section instead). */
export function puzzleSectionName(sections: readonly { name: string }[]): string | null {
  return sections.find((s) => /puzzle|fun|game|crossword|sudoku|word ?search|daily word|wordle/i.test(s.name))?.name ?? null;
}

/** A file reference's picture extension ("png", "jpg"…), or null when it names no picture (a PDF, a page). */
export function imageExtOf(ref: string): string | null {
  const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(String(ref ?? '').trim());
  const ext = (m?.[1] ?? '').toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'].includes(ext) ? ext : null;
}

/** A picture the pages can print, from the file's first bytes — never its name (9.5: a crest was refused for its
 *  extension while a link was stored and silently broke). "tiff"/"heic" when it holds one of those (seen, but they
 *  don't print), else null. */
export function sniffImage(head: Uint8Array): 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'bmp' | 'svg' | 'tiff' | 'heic' | null {
  const b = head ?? new Uint8Array();
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'heim' || brand === 'heis' || brand === 'hevm' || brand === 'hevs') return 'heic';
  }
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if ((b.length >= 4 && b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) || (b.length >= 4 && b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) return 'tiff';
  if (b.length) {
    let text = '';
    for (let i = 0; i < Math.min(b.length, 2048); i++) text += String.fromCharCode(b[i]!);
    if (/<svg(\s|>|$)/.test(text.toLowerCase())) return 'svg';
  }
  return null;
}

export interface PublicationInput {
  title: string;
  masthead?: string;
  motto?: string;
  schedule?: string;
  template?: string;
  sections?: Section[];
}

/** A new publication's note. */
export function newPublicationText(i: PublicationInput): string {
  const s = readSchedule(i.schedule);
  const lines = ['---', 'type: publication', `masthead: ${yamlStr(i.masthead || i.title)}`];
  if (i.motto) lines.push(`motto: ${yamlStr(i.motto)}`);
  if (s) lines.push(`schedule: ${scheduleText(s)}`);
  lines.push(`template: ${templateOf(i.template).name}`, 'telegram: No', 'print: No', '---', `# ${i.title}`, '', '## Sections', '', sectionsTable(i.sections?.length ? i.sections : DEFAULT_SECTIONS), '');
  return lines.join('\n');
}

/** A value for YAML (quoted when it needs to be). */
export function yamlStr(v: string): string {
  const t = String(v ?? '').replace(/\r?\n/g, ' ').trim();
  return /^[\w][\w .,'’&()!?-]*$/.test(t) && !/^(yes|no|true|false|null|on|off|\d[\d.]*)$/i.test(t) && !/:\s/.test(t) ? t : JSON.stringify(t);
}

/** Which item a section's sources rule allows: null when it is fine, else why not (in words an assistant can pass on). */
export function sourceProblem(section: Section | undefined, source: string): string | null {
  const rule = (section?.sources ?? '').trim();
  if (!rule) return null;
  const s = source.trim();
  if (/^any\b/i.test(rule) || /named/i.test(rule)) return s ? null : `${section!.name} needs every item to say where it came from (its source).`;
  const allowed = rule.split(/\s*[,;]\s*|\s+or\s+/i).filter(Boolean);
  if (!s) return `${section!.name} takes items only from ${allowed.join(', ')}: give the source.`;
  const low = s.toLowerCase();
  return allowed.some((a) => low.includes(a.toLowerCase()) || a.toLowerCase().includes(low)) ? null : `${section!.name} takes items only from ${allowed.join(', ')}, not ${s}.`;
}

// ── An item ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Solve {
  who: string;
  seconds: number;
  day: string;
  note: string;
}

export interface Item {
  path: string;
  title: string;
  /** Its kind id, or the person's own word when it names no known kind (kept, never silently a story). */
  kind: string;
  publication: string;
  section: string;
  headline: string;
  deck: string;
  source: string;
  sourceUrl: string;
  credit: string;
  who: string;
  image: string;
  lead: boolean;
  date: string | null;
  /** The words below the headline, as written (without the puzzle block, answers and solve times). */
  body: string;
  puzzle: Puzzle | null;
  solves: Solve[];
  /** What could not be read about it (a broken piece mark): said, never swallowed. */
  problems?: string[];
}

const PUZZLE_BLOCK = /```puzzle\s*\r?\n([\s\S]*?)\r?\n```/;
const SECTION_HEAD = /^##\s+(answers|solve times|clues)\s*$/i;

export function readItem(n: NoteIn): Item {
  const p = n.props;
  const body = bodyOf(n.content);
  const lines = body.split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^#\s+\S/.test(l));
  const headline = str(p.headline, 300) || (h1 >= 0 ? lines[h1]!.replace(/^#\s+/, '').trim() : n.title);
  // The words: below the headline, until a section the module keeps (Clues, Answers, Solve times), the puzzle block out.
  const after = (h1 >= 0 ? lines.slice(h1 + 1) : lines).join('\n').replace(PUZZLE_BLOCK, '');
  const cut = after.split(/\r?\n/);
  const stop = cut.findIndex((l) => SECTION_HEAD.test(l.trim()));
  const words = (stop >= 0 ? cut.slice(0, stop) : cut).join('\n').trim();
  const pz = PUZZLE_BLOCK.exec(body);
  const rawKind = typeof p.kind === 'string' ? p.kind.trim().slice(0, 60) : '';
  const kind = readKind(p.kind) ?? (rawKind || 'story');
  return {
    path: n.path,
    title: n.title,
    kind,
    problems: [],
    publication: unlink(p.publication),
    section: str(p.section, 60),
    headline,
    deck: str(p.deck ?? p.standfirst, 400),
    source: str(p.source, 200),
    sourceUrl: str(p.source_url, 600),
    credit: str(p.credit, 200),
    who: str(p.who, 200),
    image: unlink(p.image),
    lead: yes(p.lead),
    date: isoDay(p.date),
    body: words,
    puzzle: pz ? readPuzzle(pz[1]) : null,
    solves: readSolves(body),
  };
}

export const SOLVES_HEAD = ['Who', 'Time', 'Day', 'Note'];

export function readSolves(body: string): Solve[] {
  const t = tableUnder(body, /\bsolve times\b/i);
  if (!t) return [];
  const out: Solve[] = [];
  for (const r of t.rows) {
    const seconds = readSolveTime(r[1]);
    if (!r[0] || !seconds) continue;
    out.push({ who: r[0].slice(0, 80), seconds, day: isoDay(r[2]) ?? '', note: (r[3] ?? '').slice(0, 200) });
  }
  return out;
}

/** An item's note with one solve time added to its table (the table made when there is none). */
export function withSolve(content: string, s: Solve): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const row = `| ${cell(s.who)} | ${solveTimeWords(s.seconds)} | ${s.day} | ${cell(s.note)} |`;
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content)?.[0] ?? '';
  const body = content.slice(fm.length);
  const t = tableUnder(body, /\bsolve times\b/i);
  const lines = body.split(/\r?\n/);
  if (t) {
    lines.splice(t.end, 0, row);
    return fm + lines.join(eol);
  }
  return `${fm}${body.replace(/\s*$/, '')}${eol}${eol}## Solve times${eol}${eol}| ${SOLVES_HEAD.join(' | ')} |${eol}| --- | --- | --- | --- |${eol}${row}${eol}`;
}

export interface ItemInput {
  kind: string;
  headline: string;
  section?: string;
  body?: string;
  deck?: string;
  source?: string;
  sourceUrl?: string;
  credit?: string;
  who?: string;
  image?: string;
  lead?: boolean;
  date?: string;
  puzzle?: Puzzle | null;
}

/** A new item's note (a puzzle's grid and answers kept with it). */
export function newItemText(pubTitle: string, i: ItemInput): string {
  const kind = kindInfo(readKind(i.kind) ?? '') ?? ITEM_KINDS[0]!;
  const fm = ['---', 'type: publication-item', `kind: ${kind.name}`, `publication: "[[${pubTitle}]]"`];
  if (i.section) fm.push(`section: ${yamlStr(i.section)}`);
  if (i.date && isoDay(i.date)) fm.push(`date: ${isoDay(i.date)}`);
  if (i.deck) fm.push(`deck: ${yamlStr(i.deck)}`);
  if (i.source) fm.push(`source: ${yamlStr(i.source)}`);
  if (i.sourceUrl && /^https?:\/\//i.test(i.sourceUrl)) fm.push(`source_url: ${JSON.stringify(i.sourceUrl.trim())}`);
  if (i.credit) fm.push(`credit: ${yamlStr(i.credit)}`);
  if (i.who) fm.push(`who: ${yamlStr(i.who)}`);
  if (i.image) fm.push(`image: "[[${unlink(i.image)}]]"`);
  if (i.lead) fm.push('lead: Yes');
  fm.push('---');
  const out = [...fm, `# ${String(i.headline || kind.name).replace(/\r?\n/g, ' ').trim()}`, ''];
  if (i.body?.trim()) out.push(i.body.trim(), '');
  if (i.puzzle) out.push(...puzzleSections(i.puzzle));
  return out.join('\n');
}

/** A puzzle's part of its note: the block the engine reads back, its clues and its answers in words. */
export function puzzleSections(p: Puzzle): string[] {
  const out = ['```puzzle', JSON.stringify(p), '```', ''];
  if (p.kind === 'crossword') {
    out.push('## Clues', '', '**Across**', '', ...p.across.map((e) => `${e.n}. ${e.clue} (${e.enumeration})`), '', '**Down**', '', ...p.down.map((e) => `${e.n}. ${e.clue} (${e.enumeration})`), '');
    if (p.left.length) out.push(`Left out (no room to join them): ${p.left.join(', ')}.`, '');
  }
  if (p.kind === 'wordsearch' && p.left.length) out.push(`Left out (no room): ${p.left.join(', ')}.`, '');
  out.push('## Answers', '', answersText(p), '');
  return out;
}

// ── An edition ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DeliveryRow {
  when: string;
  how: string;
  to: string;
  result: string;
}

export interface Edition {
  path: string;
  title: string;
  publication: string;
  number: number | null;
  date: string | null;
  status: EditionStatus;
  template: string;
  pdf: string;
  pages: number | null;
  preview: boolean;
  lead: string;
  /** Each section and the items in it (their link targets, in order). */
  sections: { name: string; items: string[] }[];
  delivery: DeliveryRow[];
  /** The words under ## Notes (and an imported edition's own line). */
  notes: string;
  /** Brought in from a publication note written before the module (its PDF is the one that went out). */
  imported: boolean;
}

const EDITION_RESERVED = /^(delivery|notes|imported|layout|answers)$/i;

// ── Pieces inside their edition (27 Oct 2026) ──────────────────────────────────────────────────────────────────────

/** The hidden line under a piece's heading in its edition's note: its kind and details. */
export const PIECE_MARK = /^<!--nv:piece (\{.*\})-->\s*$/;
const pieceSlug = (headline: string) =>
  headline
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'piece';
/** A piece's own name: its edition's note and its headline ("…/No. 5 – 2026-10-27.md#weather-seven-days"). */
export const pieceId = (editionPath: string, headline: string) => `${editionPath}#${pieceSlug(headline)}`;
export const isPieceId = (target: string) => /\.md#[a-z0-9-]+$/i.test(target);

/** A piece's block in its edition's note: its heading, its details, its words and (a puzzle) its grid and answers. */
export function pieceBlock(i: ItemInput): string[] {
  const kind = kindInfo(readKind(i.kind) ?? '') ?? ITEM_KINDS[0]!;
  const meta: Record<string, unknown> = { kind: kind.id };
  if (i.lead) meta.lead = true;
  if (i.date && isoDay(i.date)) meta.date = isoDay(i.date);
  for (const k of ['deck', 'source', 'credit', 'who'] as const) if (i[k]) meta[k] = String(i[k]).replace(/\r?\n/g, ' ').trim();
  if (i.sourceUrl && /^https?:\/\//i.test(i.sourceUrl)) meta.sourceUrl = i.sourceUrl.trim();
  if (i.image) meta.image = unlink(i.image);
  // Kept inside an HTML comment: "--" and ">" never end it early.
  const json = JSON.stringify(meta).replace(/--/g, '-\\u002d').replace(/>/g, '\\u003e');
  const out = [`### ${String(i.headline || kind.name).replace(/\r?\n/g, ' ').trim()}`, `<!--nv:piece ${json}-->`, ''];
  if (i.body?.trim()) out.push(i.body.trim().replace(/^(#{1,3})\s/gm, '#### '), '');
  if (i.puzzle) out.push(...puzzleSections(i.puzzle).map((l) => l.replace(/^## /, '#### ')));
  return out;
}

/** A piece's mark as written, sound or broken (a broken one is kept and said, never dropped). */
const PIECE_MARK_ANY = (l: string) => l.trimStart().startsWith('<!--nv:piece');

/** Each piece block in an edition's note, by its id, as written (heading to the line before the next heading). A
 *  piece the person wrote by hand, without its mark, is kept as a piece too (9.5: it was silently dropped on the next
 *  rewrite); only the app's own regions (Notes, Delivery…) never hold pieces. */
export function editionBlocks(content: string, editionPath: string): Map<string, string[]> {
  const lines = bodyOf(content).split(/\r?\n/);
  const out = new Map<string, string[]>();
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const h2 = /^##\s+(.+?)\s*$/.exec(lines[i]!);
    if (h2) {
      inSection = !EDITION_RESERVED.test(h2[1]!.trim());
      continue;
    }
    const h = /^###\s+(.+?)\s*$/.exec(lines[i]!);
    if (!h || !inSection) continue;
    let j = i + 1;
    while (j < lines.length && !/^#{2,3}\s/.test(lines[j]!)) j++;
    const block = lines.slice(i, j);
    while (block.length > 1 && !block.at(-1)!.trim()) block.pop();
    out.set(pieceId(editionPath, h[1]!), [...block, '']);
    i = j - 1;
  }
  return out;
}

/** The pieces kept inside an edition's note, as items (path = their id). */
export function readEditionPieces(n: NoteIn, sections?: { name: string; items: string[] }[]): Item[] {
  const out: Item[] = [];
  const sectionOf = (id: string) => sections?.find((s) => s.items.includes(id))?.name ?? '';
  for (const [id, block] of editionBlocks(n.content, n.path)) {
    let meta: Record<string, unknown> = {};
    let broken = '';
    const marked = PIECE_MARK_ANY(block[1] ?? '');
    if (marked) {
      try {
        meta = JSON.parse(PIECE_MARK.exec(block[1]!)![1]!);
      } catch {
        broken = 'Its details line doesn’t read, so it is kept as plain words.';
      }
    }
    const headline = block[0]!.replace(/^###\s+/, '').trim();
    const props: Record<string, unknown> = { kind: meta.kind, publication: n.props.publication, section: sectionOf(id), date: meta.date ?? n.props.date, deck: meta.deck, source: meta.source, source_url: meta.sourceUrl, credit: meta.credit, who: meta.who, image: meta.image, lead: meta.lead ? 'Yes' : '' };
    const content = `# ${headline}\n\n${block.slice(marked ? 2 : 1).join('\n').replace(/^#### /gm, '## ')}`;
    const it = { ...readItem({ path: id, title: headline, props, content }), path: id, title: headline };
    if (broken) it.problems = [...(it.problems ?? []), broken];
    out.push(it);
  }
  return out;
}

export function readEdition(n: NoteIn): Edition {
  const p = n.props;
  const body = bodyOf(n.content);
  const lines = body.split(/\r?\n/);
  const sections: Edition['sections'] = [];
  let cur: { name: string; items: string[] } | null = null;
  let notes: string[] | null = null;
  const noteLines: string[] = [];
  for (let pos = 0; pos < lines.length; pos++) {
    const l = lines[pos]!;
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h) {
      const name = h[1]!.trim();
      notes = /^(notes|imported)$/i.test(name) ? noteLines : null;
      cur = EDITION_RESERVED.test(name) ? null : { name, items: [] };
      if (cur) sections.push(cur);
      continue;
    }
    if (notes) {
      notes.push(l);
      continue;
    }
    if (!cur) continue;
    const piece = /^###\s+(.+?)\s*$/.exec(l);
    if (piece) {
      cur.items.push(pieceId(n.path, piece[1]!));
      continue;
    }
    const m = /^\s*(?:[-*]|\d+[.)])\s+!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/.exec(l);
    if (m) cur.items.push(m[1]!.trim());
  }
  const dt = tableUnder(body, /\bdelivery\b/i);
  // Delivery rows by their header (8.7.1, 31 Oct 2026, pages that "couldn't show": an older deliver automation writes
  // Channel|Time|Result, and reading it by position put the channel where the day goes and crashed the edition page).
  // A header the app doesn't know falls back to the app's own order, When|How|To|Result.
  const KNOWN = ['when', 'time', 'day', 'date', 'sent', 'sent at', 'at', 'how', 'channel', 'via', 'method', 'by', 'to', 'recipient', 'target', 'result', 'status', 'outcome'];
  const byHeader = !!dt && dt.head.some((h) => KNOWN.includes(h.trim().toLowerCase()));
  const col = (names: string[], fallback: number): number => {
    if (!dt || !byHeader) return fallback;
    const i = dt.head.findIndex((h) => names.includes(h.trim().toLowerCase()));
    return i >= 0 ? i : -1;
  };
  const cWhen = col(['when', 'time', 'day', 'date', 'sent', 'sent at', 'at'], 0);
  const cHow = col(['how', 'channel', 'via', 'method', 'by'], 1);
  const cTo = col(['to', 'recipient', 'target'], 2);
  const cResult = col(['result', 'status', 'outcome'], 3);
  const delivery = dt ? dt.rows.map((r) => ({ when: cWhen >= 0 ? (r[cWhen] ?? '') : '', how: cHow >= 0 ? (r[cHow] ?? '') : '', to: cTo >= 0 ? (r[cTo] ?? '') : '', result: cResult >= 0 ? (r[cResult] ?? '') : '' })) : [];
  const num = Number(p.number);
  return {
    path: n.path,
    title: n.title,
    publication: unlink(p.publication),
    number: Number.isFinite(num) && num > 0 ? Math.round(num) : null,
    date: isoDay(p.date),
    status: readStatus(p.status),
    template: str(p.template, 40),
    pdf: unlink(p.pdf),
    pages: Number.isFinite(Number(p.pages)) && Number(p.pages) > 0 ? Math.round(Number(p.pages)) : null,
    preview: yes(p.preview),
    lead: str(p.lead, 300),
    sections,
    delivery,
    notes: noteLines.join('\n').trim(),
    imported: !!isoDay(p.imported),
  };
}

/** "No. 3" (a preview says so). */
export const editionLabel = (e: Pick<Edition, 'number' | 'preview' | 'title'>) => (e.number ? `No. ${e.number}${e.preview ? ' (preview)' : ''}` : e.title);

/** An edition's file name: "No. 3 – 2026-10-26". */
export const editionFileName = (number: number | null, date: string | null, preview = false) => fileName(`No. ${number ?? '?'}${preview ? ' preview' : ''}${date ? ` – ${date}` : ''}`);

export interface EditionInput {
  number: number;
  date: string;
  template?: string;
  status?: EditionStatus;
  sections: { name: string; items: string[] }[];
  preview?: boolean;
  pdf?: string;
  lead?: string;
  notes?: string;
  imported?: string;
  /** Blocks for the pieces kept inside this note, by their id (pieceBlock). */
  blocks?: Map<string, string[]>;
}

/** A PDF of one of the publication's editions filed anywhere in the vault (26 Oct 2026: an agent filed The Arlow
 *  Times No. 3 into the asset store as "Arlow Times No3 2026-10-26.pdf"; the publication never saw it and printed a
 *  bare masthead instead): its name carries the publication's name, and the edition's date or number ("No3", "No. 3",
 *  "No_3"). Null when the name is another publication's or names no edition. */
export function editionFileOf(pub: Pick<Publication, 'title' | 'masthead'>, file: string): { number: number | null; date: string | null } | null {
  const base = (file.split(/[\\/]/).pop() ?? file).replace(/_/g, ' ');
  if (!/\.pdf$/i.test(base)) return null;
  const words = (t: string) => t.toLowerCase().replace(/\.pdf$/i, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && w !== 'the');
  const have = new Set(words(base).map((w) => w.replace(/^no(\d+)$/, 'no')));
  const named = [pub.title, pub.masthead].some((n) => {
    const want = words(n).filter((w) => !/^\d+$/.test(w));
    return want.length > 0 && want.every((w) => have.has(w));
  });
  if (!named) return null;
  const date = /\d{4}-\d{2}-\d{2}/.exec(base)?.[0] ?? null;
  const n = /\bno\.?[\s-]*(\d{1,4})\b/i.exec(base)?.[1];
  const number = n ? Number(n) : null;
  return date || number != null ? { number, date } : null;
}

/** The filed PDF that is this edition: same date (and number, when both say one), else the same number when the file
 *  has no date; the biggest when there are several (a bare masthead is small). Hidden folders (.versions) are skipped. */
export function filedEditionPdf(pub: Pick<Publication, 'title' | 'masthead'>, ed: { number: number | null; date: string | null }, files: { path: string; size: number }[]): { path: string; number: number | null } | null {
  if (!ed.date && ed.number == null) return null;
  const hits = files
    .filter((f) => !/(^|\/)\.[^/]+\//.test(f.path))
    .map((f) => ({ f, m: editionFileOf(pub, f.path) }))
    .filter(({ m }) => m && (ed.date && m.date ? m.date === ed.date && (m.number == null || ed.number == null || m.number === ed.number) : m.number != null && m.number === ed.number))
    .sort((a, b) => b.f.size - a.f.size);
  return hits[0] ? { path: hits[0].f.path, number: hits[0].m!.number } : null;
}

/** A section's lines: each piece kept in the note as its block, any other as a link to its note. */
function itemLines(items: readonly string[], blockOf: (id: string) => string[] | undefined): string[] {
  const out: string[] = [];
  let links = false;
  for (const it of items) {
    const b = blockOf(it);
    if (b) {
      if (links) out.push('');
      out.push(...b);
      links = false;
    } else if (!isPieceId(it)) {
      out.push(`- [[${stripMd(it)}]]`);
      links = true;
    }
  }
  return out;
}

/** A new edition's note. */
export function newEditionText(pub: Pick<Publication, 'title' | 'masthead'>, i: EditionInput): string {
  const fm = ['---', 'type: edition', `publication: "[[${pub.title}]]"`, `number: ${i.number}`, `date: ${i.date}`, `status: ${i.status ?? 'Draft'}`];
  if (i.template) fm.push(`template: ${templateOf(i.template).name}`);
  if (i.preview) fm.push('preview: Yes');
  if (i.pdf) fm.push(`pdf: "[[${unlink(i.pdf)}]]"`);
  if (i.lead) fm.push(`lead: ${yamlStr(i.lead)}`);
  if (i.imported) fm.push(`imported: ${i.imported}`);
  fm.push('---');
  const out = [...fm, `# ${pub.masthead} · No. ${i.number}${i.preview ? ' (preview)' : ''} · ${longDate(i.date)}`, ''];
  for (const s of i.sections) out.push(`## ${s.name}`, '', ...itemLines(s.items, (id) => i.blocks?.get(id)), '');
  if (i.notes) out.push('## Notes', '', i.notes, '');
  return out.join('\n');
}

/** An edition's note with its sections (and the items in each) set; the rest of the note stays as written. Sections
 *  the caller doesn't name (the person's own headings) are kept word for word, heading and all (9.5: a rewrite razed
 *  a custom section and its pieces' words); a piece moved into a named section is not kept twice. */
export function withEditionSections(content: string, sections: readonly { name: string; items: string[] }[], editionPath = '', add?: Map<string, string[]>): string {
  // The pieces kept in this note keep their blocks wherever they move; new ones come from `add` (27 Oct 2026).
  const blocks = editionPath ? editionBlocks(content, editionPath) : new Map<string, string[]>();
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content)?.[0] ?? '';
  const body = content.slice(fm.length);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  // Keep the top (title and any words before the first section) and the reserved parts (Notes, Delivery…) in place.
  const firstH2 = lines.findIndex((l) => /^##\s+/.test(l));
  const top = firstH2 < 0 ? lines : lines.slice(0, firstH2);
  const named = new Set(sections.map((s) => s.name.toLowerCase()));
  const listed = new Set(sections.flatMap((s) => s.items));
  const kept: string[] = [];
  const own: string[] = [];
  let keepRes = false;
  let keepOwn = false;
  let skipMoved = false;
  for (const l of firstH2 < 0 ? [] : lines.slice(firstH2)) {
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h) {
      const name = h[1]!.trim();
      keepRes = EDITION_RESERVED.test(name);
      keepOwn = !keepRes && !named.has(name.toLowerCase());
      skipMoved = false;
      if (keepRes) kept.push(l);
      else if (keepOwn) own.push(l);
      continue;
    }
    const h3 = /^###\s+(.+?)\s*$/.exec(l);
    if (h3 && keepOwn) skipMoved = editionPath ? listed.has(pieceId(editionPath, h3[1]!)) : false;
    if (keepRes) kept.push(l);
    else if (keepOwn && !skipMoved) own.push(l);
  }
  const block: string[] = [];
  for (const s of sections) block.push(`## ${s.name}`, '', ...itemLines(s.items, (id) => add?.get(id) ?? blocks.get(id)), '');
  const topText = top.join(eol).replace(/\s*$/, '');
  const ownText = own.length ? eol + own.join(eol).replace(/\s*$/, '') + eol : '';
  return `${fm}${topText}${eol}${eol}${block.join(eol)}${ownText}${kept.length ? eol + kept.join(eol).replace(/\s*$/, '') + eol : ''}`;
}

/** An edition's note with its Notes set where they are (made at the end when missing; taken off when blank). The one
 *  Notes section stays one, beside the edition it describes — never a second copy at the bottom (9.5). */
export function withEditionNotes(content: string, notes: string): string {
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content)?.[0] ?? '';
  const body = content.slice(fm.length);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((l) => /^##\s+notes\s*$/i.test(l.trim()));
  const words = String(notes ?? '').replace(/\s*$/, '');
  if (at < 0) {
    if (!words) return content;
    return `${fm}${body.replace(/\s*$/, '')}${eol}${eol}## Notes${eol}${eol}${words}${eol}`;
  }
  let end = at + 1;
  while (end < lines.length && !/^##\s+/.test(lines[end]!)) end++;
  const next = words ? [...lines.slice(0, at + 1), '', words, ...lines.slice(end)] : [...lines.slice(0, at), ...lines.slice(end)];
  return `${fm}${next.join(eol).replace(/\s*$/, '')}${eol}`;
}

/** An edition's note with a line added to its delivery log. */
export function withDeliveryRow(content: string, row: DeliveryRow): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const line = `| ${cell(row.when)} | ${cell(row.how)} | ${cell(row.to)} | ${cell(row.result)} |`;
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content)?.[0] ?? '';
  const body = content.slice(fm.length);
  const t = tableUnder(body, /\bdelivery\b/i);
  const lines = body.split(/\r?\n/);
  if (t) {
    lines.splice(t.end, 0, line);
    return fm + lines.join(eol);
  }
  return `${fm}${body.replace(/\s*$/, '')}${eol}${eol}## Delivery${eol}${eol}| When | How | To | Result |${eol}| --- | --- | --- | --- |${eol}${line}${eol}`;
}

// ── The archive ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A publication's editions newest first (by date, then number). */
export function sortEditions<T extends Pick<Edition, 'date' | 'number' | 'preview'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.number ?? 0) - (a.number ?? 0) || Number(a.preview) - Number(b.preview));
}

/** The edition before this one (the one whose puzzles' answers this one prints): the highest number below it that isn't a
 *  preview, else the latest dated before it. */
export function previousEdition<T extends Pick<Edition, 'path' | 'date' | 'number' | 'preview'>>(list: readonly T[], e: Pick<Edition, 'path' | 'date' | 'number'>): T | null {
  const others = list.filter((x) => x.path !== e.path && !x.preview);
  if (e.number) {
    const below = others.filter((x) => x.number !== null && x.number < e.number!).sort((a, b) => b.number! - a.number!);
    if (below[0]) return below[0];
  }
  if (e.date) {
    const before = others.filter((x) => x.date && x.date < e.date!).sort((a, b) => b.date!.localeCompare(a.date!));
    if (before[0]) return before[0];
  }
  return null;
}

/** The next edition's number (one after the highest that isn't a preview). */
export const nextNumber = (list: readonly Pick<Edition, 'number' | 'preview'>[]) => Math.max(0, ...list.filter((e) => !e.preview).map((e) => e.number ?? 0)) + 1;

/** An edition's number as given (1, "1", "No 13", "#4", "number 2") → the number; null when none is named ("latest",
 *  "", missing). One reading for every path that names an edition (9.5: "No 13" read as no number silently fetched the
 *  latest — the wrong edition — instead of saying it isn't there). */
export function parseEditionNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  const m = /(\d{1,4})/.exec(String(v ?? ''));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

const titleNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = next;
    }
  }
  return prev[b.length]!;
}

/** The titles among `titles` that `asked` names allowing for a typo ("Weeknd Post" → "Weekend Post"): an exact or
 *  normalized match first, else every close one (9.5: a typo set up a second paper beside the first; two close papers
 *  are asked about, never guessed). */
export function closeTitles(titles: readonly string[], asked: string): string[] {
  const want = titleNorm(String(asked ?? ''));
  if (!want) return [];
  const exact = titles.find((t) => titleNorm(t) === want);
  if (exact !== undefined) return [exact];
  if (want.length < 8) return [];
  return titles.filter((t) => {
    const n = titleNorm(t);
    return n.length >= 8 && editDistance(n, want) <= 2;
  });
}

/** The item a link in an edition points to, among the items (by path, by name, by title). */
export function findItem<T extends Pick<Item, 'path' | 'title'>>(items: readonly T[], target: string, from = ''): T | undefined {
  const t = stripMd(target).toLowerCase();
  const dir = dirOf(from).toLowerCase();
  return (
    items.find((i) => stripMd(i.path).toLowerCase() === t) ??
    items.find((i) => dir && stripMd(i.path).toLowerCase() === `${dir}/${t}`) ??
    items.find((i) => stripMd(i.path).toLowerCase().endsWith(`/${t}`)) ??
    items.find((i) => i.title.toLowerCase() === baseOf(t))
  );
}

// ── Search across every edition ─────────────────────────────────────────────────────────────────────────────────────

export interface SearchHit {
  /** The item found (null when the edition's own words or its PDF matched). */
  item: string | null;
  edition: string | null;
  editionLabel: string;
  date: string | null;
  kind: string;
  headline: string;
  snippet: string;
  score: number;
}

const KIND_WORDS: [RegExp, string][] = [
  [/\bcrosswords?\b/i, 'crossword'],
  [/\bsudokus?\b/i, 'sudoku'],
  [/\bword ?searches?\b/i, 'wordsearch'],
  [/\b(daily word|wordles?)\b/i, 'dailyword'],
  [/\b(cartoons?|comics?|strips?)\b/i, 'cartoon'],
  [/\b(weather|forecasts?)\b/i, 'weather'],
  [/\b(quotes?)\b/i, 'quote'],
  [/\b(stories|story|articles?|news)\b/i, 'story'],
  [/\b(briefs?)\b/i, 'brief'],
  [/\b(pictures?|photos?|images?)\b/i, 'image'],
  [/\b(ladders?|fixtures?|results?|sports? tables?)\b/i, 'sports'],
];
const FILLER = /\b(the|a|an|with|in|it|that|has|had|which|where|every|all|any|find|show|me|my|our|about|of|on|for|edition|editions|paper|papers|one|ones|was|is|were|from|did|we|run|ran|printed)\b/gi;

/** A search in plain words ("the crossword with BOLAND in it", "every Storm story") → the kind asked for, the words,
 *  and whether the newest is asked for ("the latest report" wants the newest one, not the word "latest", 9.2). */
export function readQuery(q: string): { kind: string | null; words: string[]; recent: boolean } {
  let t = ` ${String(q ?? '').slice(0, 300)} `;
  let kind: string | null = null;
  for (const [re, k] of KIND_WORDS) {
    if (re.test(t)) {
      kind = k;
      t = t.replace(re, ' ');
      break;
    }
  }
  const recent = /\b(latest|newest|most recent|current)\b/i.test(t);
  t = t.replace(/\b(latest|newest|most recent|current)\b/gi, ' ');
  const words = t
    .replace(/["“”‘’']/g, ' ')
    .replace(FILLER, ' ')
    .split(/[^\p{L}\p{N}.$-]+/u)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((w) => w.length >= 2);
  return { kind, words, recent };
}

function snippetOf(text: string, words: string[]): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, p: string, l?: string) => l || p.split('/').pop()!.replace(/\.[a-z0-9]+$/i, ''))
    .replace(/[#>*_`|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const low = flat.toLowerCase();
  let at = -1;
  for (const w of words) {
    at = low.indexOf(w.toLowerCase());
    if (at >= 0) break;
  }
  if (at < 0) return flat.slice(0, 160);
  const from = Math.max(0, at - 60);
  return `${from ? '…' : ''}${flat.slice(from, at + 110).trim()}${at + 110 < flat.length ? '…' : ''}`;
}

/**
 * Every item and edition the words are in, best first: an item's headline, words, source, and a puzzle's answers and clues;
 * an edition's own words and the words of its PDF (`pdfText`, read by the main side). An item says which editions it ran
 * in. A kind in the words ("crossword", "story") keeps to that kind.
 */
export function searchArchive(query: string, input: { editions: readonly Edition[]; items: readonly Item[]; pdfText?: Readonly<Record<string, string>> }): SearchHit[] {
  const { kind, words, recent } = readQuery(query);
  if (!words.length && !kind) return [];
  const hits: SearchHit[] = [];
  const has = (hay: string, w: string) => foldDiacritics(hay).includes(foldDiacritics(w).toLowerCase());
  const ranIn = new Map<string, Edition[]>();
  for (const e of input.editions)
    for (const s of e.sections)
      for (const t of s.items) {
        const it = findItem(input.items, t, e.path);
        if (it) ranIn.set(it.path, [...(ranIn.get(it.path) ?? []), e]);
      }
  for (const it of input.items) {
    if (kind && it.kind !== kind && !(kind === 'story' && it.kind === 'brief')) continue;
    const answers = it.puzzle ? puzzleWords(it.puzzle).join(' ') : '';
    const head = it.headline.toLowerCase();
    const hay = [it.headline, it.deck, it.body, it.source, it.credit, it.section, it.who, answers].join(' ').toLowerCase();
    if (words.length && !words.every((w) => has(hay, w))) continue;
    const score = words.reduce((a, w) => a + (has(head, w) ? 3 : 0) + (answers && has(answers.toLowerCase(), w) ? 4 : 0) + 1, kind ? 2 : 0);
    const eds = sortEditions(ranIn.get(it.path) ?? []);
    const e = eds[0];
    const inAnswers = words.find((w) => it.puzzle && has(answers.toLowerCase(), w));
    hits.push({ item: it.path, edition: e?.path ?? null, editionLabel: e ? editionLabel(e) : 'Not in an edition yet', date: e?.date ?? it.date, kind: it.kind, headline: it.headline, snippet: inAnswers ? `${kindInfo(it.kind)?.name ?? 'Puzzle'} with ${inAnswers.toUpperCase()} in its answers` : snippetOf([it.deck, it.body].join(' '), words), score });
  }
  if (!kind || kind === 'story') {
    for (const e of input.editions) {
      const own = [e.title, e.lead, e.notes].join(' ');
      const pdf = input.pdfText?.[e.path] ?? '';
      const hay = `${own} ${pdf}`.toLowerCase();
      if (!words.length || !words.every((w) => has(hay, w))) continue;
      // An edition whose items already matched isn't said twice for the same words.
      if (hits.some((h) => h.edition === e.path)) continue;
      hits.push({ item: null, edition: e.path, editionLabel: editionLabel(e), date: e.date, kind: 'edition', headline: e.lead || `${editionLabel(e)}, ${longDate(e.date)}`, snippet: snippetOf(pdf && words.some((w) => has(pdf.toLowerCase(), w)) && !words.every((w) => has(own.toLowerCase(), w)) ? pdf : own, words), score: words.length + (words.every((w) => has(own.toLowerCase(), w)) ? 2 : 0) });
    }
  }
  if (recent) return hits.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.score - a.score).slice(0, 80);
  return hits.sort((a, b) => b.score - a.score || (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 80);
}

// ── Fitting an edition onto its pages (an estimate, for the assistants and before the pages are drawn) ───────────────
// The layout studio draws the real pages (src/shared/edition-doc.ts) and measures them; this is the same arithmetic in
// round numbers, so an assistant building an edition is told "Sport runs about half a page over" before anything is
// drawn, and a test can check that more words than fit are said to overflow.

const MM_PER_PT = 0.3528;

export interface FitItem {
  id: string;
  kind: string;
  headline: string;
  body: string;
  lead?: boolean;
  image?: boolean;
  /** Rows of a table (weather, sports). */
  rows?: number;
  puzzle?: Puzzle | null;
  /** Panels of a cartoon. */
  panels?: number;
}

export interface SectionFit {
  name: string;
  budget: number;
  /** Pages it fills (2.4: two pages and four tenths of a third). */
  used: number;
  over: boolean;
  /** Items that land past the budget. */
  overflow: string[];
}

/** How much of one column (in mm of height) an item takes. */
export function itemHeight(it: FitItem, t: Template, columns: number): { mm: number; span: boolean } {
  const colW = (PAGE.width - t.margin * 2 - t.gutter * (columns - 1)) / columns;
  const line = t.size * t.leading * MM_PER_PT;
  const cpl = Math.max(12, colW / (t.size * MM_PER_PT * 0.47));
  const textLines = (s: string, perLine = cpl) =>
    String(s ?? '')
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .reduce((a, p) => a + Math.ceil(p.length / perLine) + 0.35, 0);
  const pageW = PAGE.width - t.margin * 2;
  switch (it.kind) {
    case 'story': {
      if (it.lead) {
        const head = Math.ceil(it.headline.length / (pageW / (t.lead * MM_PER_PT * 0.5))) * t.lead * 1.1 * MM_PER_PT;
        const pic = it.image ? pageW * 0.42 : 0;
        // A lead spans the page above the columns: its words flow across them.
        return { mm: head + pic + 8 + (textLines(it.body) * line) / columns, span: true };
      }
      const hs = Math.max(13, t.size * 1.7);
      const head = Math.ceil(it.headline.length / (colW / (hs * MM_PER_PT * 0.5))) * hs * 1.1 * MM_PER_PT;
      return { mm: head + 6 + textLines(it.body) * line + (it.image ? colW * 0.68 + 6 : 0), span: false };
    }
    case 'brief':
      return { mm: 4 + (Math.ceil(it.headline.length / cpl) + textLines(it.body)) * line, span: false };
    case 'weather':
      return { mm: 12 + (it.rows ?? 6) * line * 1.3, span: true };
    case 'sports':
      return { mm: 10 + (it.rows ?? 6) * line * 1.25 + textLines(it.body) * line, span: false };
    case 'image':
      return { mm: colW * 0.72 + 4 + textLines(it.body) * line, span: false };
    case 'cartoon':
      return { mm: pageW * 0.36 + 12 + ((it.panels ?? 4) > 4 ? 6 : 0), span: true };
    case 'quote':
      return { mm: 10 + textLines(it.body, cpl * 0.85) * line * 1.25, span: false };
    case 'onthisday':
      return { mm: 8 + textLines(it.body) * line, span: false };
    case 'crossword': {
      const p = it.puzzle?.kind === 'crossword' ? it.puzzle : null;
      const cellMm = Math.min(6, (pageW * 0.55) / Math.max(1, p?.width ?? 13));
      const clueLines = p ? [...p.across, ...p.down].reduce((a, e) => a + Math.ceil((e.clue.length + 8) / (cpl * 0.95)), 0) + 4 : 20;
      return { mm: Math.max(cellMm * (p?.height ?? 13), ((clueLines * line) / 2) * 1.0) + 14, span: true };
    }
    case 'wordsearch': {
      const p = it.puzzle?.kind === 'wordsearch' ? it.puzzle : null;
      return { mm: Math.min(6, (pageW * 0.55) / (p?.size ?? 12)) * (p?.size ?? 12) + 14, span: true };
    }
    case 'sudoku':
      return { mm: Math.min(colW, 62) + 12, span: false };
    case 'dailyword': {
      const p = it.puzzle?.kind === 'dailyword' ? it.puzzle : null;
      return { mm: ((p?.guesses.length ?? 4) + 1) * Math.min(7, colW / 6.5) + 18, span: false };
    }
  }
  return { mm: 10 + textLines(it.body) * line, span: false };
}

/** Each section's items packed into its columns and pages in order, as the studio does (pieces flow down the columns;
 *  a piece that would run off the page goes whole to the next one; a spanning piece sits below what is above it), in
 *  round numbers. */
export function estimateFit(sections: readonly { name: string; pages: number; items: FitItem[] }[], t: Template, o: { mastheadMm?: number } = {}): SectionFit[] {
  const out: SectionFit[] = [];
  const pageH = PAGE.height - t.margin * 2 - 9; // less the running head
  const gap = 3.5;
  sections.forEach((s, si) => {
    const cols = si === 0 ? t.frontColumns : t.columns;
    let page = 0;
    let bandTop = si === 0 ? (o.mastheadMm ?? 46) : 11; // the masthead, or the section's heading
    let flow = 0;
    const overflow: string[] = [];
    const at = () => page + Math.min(1, (bandTop + flow / cols) / pageH);
    for (const it of s.items) {
      const h = itemHeight(it, t, cols);
      if (h.span) {
        let top = bandTop + flow / cols;
        if (top + h.mm > pageH && top > 0) {
          page++;
          top = 0;
        }
        bandTop = top + h.mm + gap;
        flow = 0;
        while (bandTop > pageH && page < 80) {
          page++;
          bandTop -= pageH;
        }
      } else {
        const had = flow > 0 || bandTop > 0;
        flow += h.mm + gap;
        if (bandTop + flow / cols > pageH) {
          if (had) {
            page++;
            bandTop = 0;
            flow = h.mm + gap;
          }
          while (bandTop + flow / cols > pageH && page < 80) {
            flow -= (pageH - bandTop) * cols;
            page++;
            bandTop = 0;
          }
        }
      }
      if (at() > s.pages + 0.02) overflow.push(it.id);
    }
    const used = Math.round(at() * 10) / 10;
    out.push({ name: s.name, budget: s.pages, used: s.items.length ? Math.max(0.1, used) : 0, over: used > s.pages + 0.05, overflow });
  });
  return out;
}

/** A fit in words ("News fills 1.8 of its 2 pages; Sport runs 0.4 of a page over its 1"). */
export function fitWords(fit: readonly SectionFit[]): string {
  return fit.map((f) => (f.over ? `${f.name} runs ${Math.round((f.used - f.budget) * 10) / 10} of a page over its ${f.budget}` : `${f.name} fills ${f.used} of its ${f.budget} ${f.budget === 1 ? 'page' : 'pages'}`)).join('; ');
}

/** An item as the fit counts it. */
export function fitItemOf(it: Item): FitItem {
  const rows = (it.body.match(new RegExp(TABLE_ROW_RE.source, 'gm')) ?? []).length;
  const panels = (it.body.match(new RegExp(BULLET_RE.source, 'gm')) ?? []).length;
  return { id: it.path, kind: it.kind, headline: it.headline, body: it.kind === 'weather' || it.kind === 'sports' ? it.body.replace(new RegExp(TABLE_ROW_RE.source, 'gm'), '') : it.body, lead: it.lead, image: !!it.image, rows, puzzle: it.puzzle, panels };
}

// ── The puzzles' answers, printed in the next edition ───────────────────────────────────────────────────────────────

export interface AnswerBlock {
  item: string;
  kind: string;
  title: string;
  puzzle: Puzzle;
}

/** The answers the next edition prints: every puzzle in this edition, in order. */
export function answersFrom(e: Edition | null, items: readonly Item[]): AnswerBlock[] {
  if (!e) return [];
  const out: AnswerBlock[] = [];
  for (const s of e.sections)
    for (const t of s.items) {
      const it = findItem(items, t, e.path);
      if (it?.puzzle) out.push({ item: it.path, kind: it.kind, title: it.headline, puzzle: it.puzzle });
    }
  return out;
}

// ── Solve times: who's quickest ─────────────────────────────────────────────────────────────────────────────────────

export interface SolveBoard {
  /** The household's best time per kind of puzzle, and who holds it. */
  best: { kind: string; who: string; seconds: number; item: string; day: string }[];
  /** Each person's solves, average and best by kind. */
  people: { who: string; solves: number; byKind: Record<string, { best: number; average: number; count: number }> }[];
  recent: { who: string; seconds: number; day: string; item: string; kind: string; headline: string }[];
}

export function solveBoard(items: readonly Item[]): SolveBoard {
  const all = items.flatMap((it) => it.solves.map((s) => ({ ...s, item: it.path, kind: it.kind, headline: it.headline })));
  const best: SolveBoard['best'] = [];
  for (const k of ITEM_KINDS.filter((x) => x.puzzle)) {
    const b = all.filter((s) => s.kind === k.id).sort((a, b) => a.seconds - b.seconds)[0];
    if (b) best.push({ kind: k.id, who: b.who, seconds: b.seconds, item: b.item, day: b.day });
  }
  const byWho = new Map<string, typeof all>();
  for (const s of all) byWho.set(s.who.toLowerCase(), [...(byWho.get(s.who.toLowerCase()) ?? []), s]);
  const people = [...byWho.values()].map((list) => {
    const byKind: Record<string, { best: number; average: number; count: number }> = {};
    for (const s of list) {
      const k = (byKind[s.kind] ??= { best: Infinity, average: 0, count: 0 });
      k.best = Math.min(k.best, s.seconds);
      k.average = Math.round((k.average * k.count + s.seconds) / (k.count + 1));
      k.count++;
    }
    return { who: list[0]!.who, solves: list.length, byKind };
  });
  const recent = [...all].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 12);
  return { best, people: people.sort((a, b) => b.solves - a.solves), recent };
}

// ── Import: a publication note written before the module (its editions' PDFs linked in it) ────────────────────────────

export interface ImportEdition {
  number: number | null;
  date: string | null;
  preview: boolean;
  pdf: string;
  /** The note's own line about it, kept word for word. */
  words: string;
  lead: string;
  /** Pictures on its line (a cartoon), each to become a Cartoon strip item. */
  pictures: { path: string; label: string }[];
  status: EditionStatus;
  /** Found in the vault, not linked from the note (offered, unticked). */
  unlinked?: boolean;
  /** The same file as another edition's PDF (same name stem or size), said so. */
  sameAs?: string;
}

export interface ImportPlan {
  path: string;
  title: string;
  masthead: string;
  schedule: Schedule | null;
  printer: string;
  telegram: boolean;
  /** The page layout named in the note (a template's name), when it names one. */
  template?: string;
  sections: Section[];
  /** The house style read from the note (fonts and crest found in the vault). */
  style: Partial<HouseStyle>;
  editions: ImportEdition[];
  /** What was read, in words, for the review. */
  read: string[];
}

const NUM_RE = /\bNo\.?\s*_?(\d{1,4})\b|\bNo(\d{1,4})\b|\b#(\d{1,4})\b|\bEdition\s+(\d{1,4})\b|\bIssue\s+(\d{1,4})\b/i;

function dateIn(s: string, year: number): string | null {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{4})?\b/i.exec(s);
  if (m) {
    const mo = MONTHS_SHORT.indexOf(m[2]!.toLowerCase().slice(0, 3));
    return `${m[3] ?? year}-${String(mo + 1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  }
  return null;
}

/**
 * What a publication note written before the module would become: its schedule, printer and Telegram from its words; its
 * sections from a list of "**Name (pages):** what goes in it"; its fonts and crest from files named in it that are in the
 * vault; and an edition for every PDF linked from it (number, date and preview from the link's words and the file's
 * name), its cartoon pictures, and its line kept word for word. PDFs in the vault named like it but not linked are offered
 * too, unticked. Nothing is changed here: the main side writes what the person agrees to.
 */
export function planImport(n: NoteIn, files: readonly { path: string; size?: number }[], today: string): ImportPlan {
  const body = bodyOf(n.content);
  const year = Number(today.slice(0, 4));
  const read: string[] = [];
  const lines = body.split(/\r?\n/);
  // The schedule: the first line with a day of the week and a time.
  let schedule: Schedule | null = null;
  for (const l of lines) {
    if (DAY_RE.test(l) && /\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b/i.test(l)) {
      schedule = readSchedule(l.replace(/\(.*?\)/g, ''));
      if (schedule) break;
    }
  }
  if (!schedule) schedule = readSchedule(n.props.schedule);
  if (schedule) read.push(`Schedule: ${scheduleWords(schedule)}`);
  const printer = /\bprint(?:ed|s)?\s+on\s+(?:the\s+)?([A-Z][\w+-]*(?:\s+[A-Z0-9][\w+-]*){0,4})/.exec(body)?.[1]?.replace(/\s+at$/i, '').trim() ?? '';
  if (printer) read.push(`Printer: ${printer}`);
  const telegram = /\btelegram\b/i.test(body);
  if (telegram) read.push('Delivered on Telegram');
  // The page layout named in the note ("a tabloid", "set as a broadsheet"); a font's name ("Classic-Regular.ttf") is
  // not the layout, so a match joined to a file name by a dash is skipped.
  let template: string | undefined;
  for (const m of body.matchAll(/\b(tabloid|broadsheet|classic)\b/gi)) {
    const before = body[m.index! - 1] ?? '';
    const after = body[m.index! + m[0].length] ?? '';
    if (before === '-' || after === '-') continue;
    template = templateOf(m[1]).name;
    break;
  }
  if (template) read.push(`Layout: ${template}`);
  // Sections: "- **Front (1):** words" (pages in brackets after the name).
  const sections: Section[] = [];
  for (const l of lines) {
    const m = /^\s*[-*]\s+\*\*(.+?)\s*\((\d+(?:\.\d+)?)\)\s*:?\s*\*\*\s*:?\s*(.*)$/.exec(l);
    if (!m) continue;
    const words = m[3]!.replace(/\*\*/g, '').trim();
    sections.push({ name: m[1]!.trim().slice(0, 60), pages: Math.max(0.5, Math.min(40, Number(m[2]))), sources: /\bsourced?\b|\bnamed outlets?\b/i.test(words) ? 'Any named source' : '', rules: words.slice(0, 600) });
  }
  if (sections.length) read.push(`${plural(sections.length, 'section')}: ${sections.map((s) => `${s.name} (${s.pages})`).join(', ')}`);
  // Fonts and a crest named in the note and kept in the vault.
  const text = n.content;
  const style: Partial<HouseStyle> = {};
  const fonts = files.filter((f) => FONT_RE.test(f.path));
  const named = fonts.filter((f) => text.includes(stripExt(baseOf(f.path))) || text.includes(baseOf(f.path)));
  // What a font is for: the words said right after its name ("UnifrakturCook-Bold.ttf (masthead)", "Regular, Bold and
  // Italic.ttf (body, headlines)"), up to the end of the bracket that follows it, else the rest of its line.
  const roleOf = (stem: string) => {
    const at = text.indexOf(stem);
    if (at < 0) return '';
    const after = text.slice(at + stem.length, at + stem.length + 120);
    const close = after.indexOf(')');
    const nl = after.indexOf('\n');
    return (close >= 0 && (nl < 0 || close < nl) ? after.slice(0, close) : nl >= 0 ? after.slice(0, nl) : after).toLowerCase();
  };
  for (const f of named) {
    const stem = stripExt(baseOf(f.path));
    const role = roleOf(stem);
    if (/masthead|nameplate|\btitle\b/.test(role) && !/\bbody\b/.test(role) && !style.mastheadFont) style.mastheadFont = f.path;
    else if (!style.bodyFont && (/\bbody\b|\btext\b/.test(role) || /regular|roman|book/i.test(stem))) style.bodyFont = f.path;
  }
  if (style.bodyFont) {
    // Its family's other faces beside it ("OldStandard-Bold.ttf" with "OldStandard-Regular.ttf").
    const fam = stripExt(baseOf(style.bodyFont)).split(/[-_ ]/)[0]!.toLowerCase();
    style.bodyFaces = fonts.filter((f) => f.path !== style.bodyFont && dirOf(f.path) === dirOf(style.bodyFont!) && stripExt(baseOf(f.path)).toLowerCase().startsWith(fam)).map((f) => f.path);
  }
  if (style.mastheadFont) read.push(`Masthead type: ${baseOf(style.mastheadFont)}`);
  if (style.bodyFont) read.push(`Body type: ${baseOf(style.bodyFont)}${style.bodyFaces?.length ? ` (+${style.bodyFaces.length} more)` : ''}`);
  const embeds = [...body.matchAll(/!\[\[([^\]|]+?\.(?:png|jpe?g|webp|gif|svg))(?:\|[^\]]*)?\]\]/gi)].map((m) => m[1]!);
  const crest = embeds.find((e) => /crest|logo|masthead|nameplate/i.test(e)) ?? embeds[0];
  if (crest) {
    style.crest = crest;
    read.push(`Masthead picture: ${baseOf(crest)}`);
  }
  if (/black ink only|black and white|greyscale|grayscale/i.test(body)) style.greyscale = true;
  // Editions: every line that links a PDF.
  const editions: ImportEdition[] = [];
  const linked = new Set<string>();
  for (const l of lines) {
    const pdfs = [...l.matchAll(/\[\[([^\]|]+?\.pdf)(?:\|([^\]]*))?\]\]/gi)];
    if (!pdfs.length) continue;
    // One edition keeps one PDF: a second link on the line is said, never silently dropped (9.5).
    for (const extra of pdfs.slice(1)) read.push(`Also on the line: ${extra[1]!.trim()} (kept out: one edition keeps one PDF)`);
    for (const m of pdfs.slice(0, 1)) {
      const pdf = m[1]!.trim();
      linked.add(pdf.toLowerCase());
      const label = m[2] ?? '';
      const where = `${label} ${baseOf(pdf)} ${l}`;
      const nm = NUM_RE.exec(`${label} ${baseOf(pdf).replace(/_/g, ' ')}`) ?? NUM_RE.exec(l);
      const number = nm ? Number(nm.slice(1).find(Boolean)) : null;
      const preview = /\bpreview\b/i.test(`${label} ${baseOf(pdf)}`);
      const date = dateIn(baseOf(pdf), year) ?? dateIn(l.replace(/\[\[[^\]]*\]\]/g, ''), year);
      const lead = /\bLead:\s*([^.]+(?:\.\d[^.]*)?)\./i.exec(l)?.[1]?.trim() ?? '';
      const pictures = [...l.matchAll(/\[\[([^\]|]+?\.(?:png|jpe?g|webp|gif))(?:\|([^\]]*))?\]\]/gi)].map((p) => ({ path: p[1]!.trim(), label: (p[2] ?? stripExt(baseOf(p[1]!))).trim() }));
      const words = l.replace(/\s+/g, ' ').trim();
      const past = !!date && date < today;
      editions.push({ number, date, preview, pdf, words, lead, pictures, status: preview || /not printed/i.test(where) ? 'Draft' : past ? 'Delivered' : 'Built' });
    }
  }
  // PDFs in the vault named like the publication but not linked (offered, unticked; a copy of a linked one says so).
  const titleWords = n.title
    .toLowerCase()
    .replace(/^the\s+/, '')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  for (const f of files) {
    if (!/\.pdf$/i.test(f.path) || linked.has(f.path.toLowerCase())) continue;
    const name = baseOf(f.path).toLowerCase().replace(/[_-]+/g, ' ');
    if (!titleWords.length || !titleWords.every((w) => name.includes(w))) continue;
    const nm = NUM_RE.exec(baseOf(f.path).replace(/_/g, ' '));
    const number = nm ? Number(nm.slice(1).find(Boolean)) : null;
    const preview = /preview/i.test(name);
    const date = dateIn(baseOf(f.path), year);
    const same = editions.find((e) => {
      const ef = files.find((x) => x.path.toLowerCase() === e.pdf.toLowerCase());
      return (ef?.size && f.size && ef.size === f.size) || (e.number === number && e.preview === preview && e.date === date);
    });
    editions.push({ number, date, preview, pdf: f.path, words: `Found in the vault: ${f.path}`, lead: '', pictures: [], status: preview ? 'Draft' : date && date < today ? 'Delivered' : 'Built', unlinked: true, ...(same ? { sameAs: same.pdf } : {}) });
  }
  editions.sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || Number(b.preview) - Number(a.preview) || (a.date ?? '').localeCompare(b.date ?? ''));
  read.push(`${plural(editions.filter((e) => !e.unlinked).length, 'edition')} linked${editions.some((e) => e.unlinked) ? `, ${editions.filter((e) => e.unlinked).length} more found in the vault` : ''}`);
  return { path: n.path, title: n.title, masthead: str(n.props.masthead, 120) || n.title, schedule, printer, telegram, template, sections, style, editions, read };
}

const stripExt = (s: string) => s.replace(/\.[^.]+$/, '');

/** The properties an import adds to a publication note (none it already has is changed). */
export function importProps(plan: ImportPlan, has: Props): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (k: string, v: string | undefined) => {
    if (v && has[k] === undefined) out[k] = v;
  };
  add('masthead', plan.masthead);
  add('schedule', plan.schedule ? scheduleText(plan.schedule) : undefined);
  add('template', plan.template ?? templateOf('').name);
  add('printer', plan.printer || undefined);
  add('print', plan.printer ? 'Yes' : undefined);
  add('telegram', plan.telegram ? 'Yes' : undefined);
  add('masthead_font', plan.style.mastheadFont ? `[[${plan.style.mastheadFont}]]` : undefined);
  add('body_font', plan.style.bodyFont ? `[[${plan.style.bodyFont}]]` : undefined);
  add('crest', plan.style.crest ? `[[${plan.style.crest}]]` : undefined);
  add('greyscale', plan.style.greyscale ? 'Yes' : undefined);
  return out;
}

// ── What the window and the assistants are told ─────────────────────────────────────────────────────────────────────

export const PUBLICATION_RULES =
  'Publications: use publication_list for the publications, their sections with each section’s sources and rules, and their latest editions; publication_search to find anything in the archive ("the crossword with BOLAND in it", "every Storm story"); publication_edition_build to put an edition together from items (each new story or brief needs its source, and a section that names its sources takes only those); puzzle_generate for a crossword (from answers and clues), sudoku, word search or daily word; puzzle_solve_time to record how long someone took. Never make up a news story, a result or a source: write only what the person or a source you were given says.';
