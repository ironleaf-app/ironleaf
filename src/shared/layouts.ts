// Project layouts (21 Oct 2026; docs/LAYOUTS.md is the contract)., then: "it's still corporate but the ability to adapt".
// So a project's dashboard is made of generic BLOCKS that adapt to whatever the project holds (a status band, a
// countdown, progress, a timeline, a board, a grid, trends, a streak, the latest log entry with a form to add one,
// cards), and the six layouts are only presets of blocks. A project can list its own blocks (`blocks: [countdown,
// board:Pipeline, trend:Weight]`); with neither `layout:` nor `blocks:` the page stays exactly as it was (a quiet
// suggestion may offer a preset, worked out from the file's structure, never from its topic). Pure (no window, no files):
// the main side reads the notes and hands them in; the window draws what these return; the assistant (and the former host
// app's built copy) can use the same helpers to write contract-correct Markdown:
//   LAYOUTS, layoutOf, blocksOf, parseBlocks, blockModel, layoutLine, suggestLayout,
//   parseLog, logsFor, appendLogEntry, newLogNote, logFields,
//   readTable, addTableRow, runSheet, toggleRunSheetItem, addRunSheetPhase, addRunSheetItem, SECTION_TABLES
// (and a project's sections are set or made with the project edit { kind: 'section', heading, body }, any property of the
// person's own with { kind: 'prop', key, value }, in src/shared/project-file.ts).
// Clean room: written from the contract only (never another app's code, words or visuals).

import { readProps } from './frontmatter';
import { addDays, daysBetween, isoDay, MONTHS, readDay, startOfDay, WEEKDAYS } from './days';
import { isBoxDone, isFinished } from './finished';
import type { Project } from './project-file';
import { plural } from './words';

// ── Blocks and the layouts (presets of blocks) ───────────────────────────────────────────────────────────────────────

export const BLOCK_TYPES = ['status', 'countdown', 'progress', 'timeline', 'board', 'grid', 'trend', 'streak', 'entry', 'cards', 'actions'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
/** A block, and what it reads when it names one thing: a date key, a section, a log field ("trend:Weight"). */
export interface BlockSpec {
  type: BlockType;
  arg?: string;
}

export const LAYOUT_IDS = ['programme', 'site', 'register', 'fitness', 'wellbeing', 'venture'] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];

export interface LayoutInfo {
  id: LayoutId;
  /** Its name on screen (fitness is shown as Tracker and wellbeing as Habit: the words stay valid in `layout:`). */
  name: string;
  /** One line: what it shows, for the Layout menu and the templates. */
  line: string;
  blocks: BlockSpec[];
}

const b = (type: BlockType, arg?: string): BlockSpec => (arg ? { type, arg } : { type });

export const LAYOUTS: LayoutInfo[] = [
  { id: 'programme', name: 'Programme', line: 'Status, workstreams with their progress, the next actions and the milestone timeline.', blocks: [b('status'), b('progress', 'Workstreams'), b('actions'), b('timeline', 'Key dates')] },
  { id: 'site', name: 'Site or event', line: 'A countdown to the day, the run sheet phase by phase, key dates and who to call.', blocks: [b('countdown'), b('progress', 'Run sheet'), b('timeline', 'Key dates'), b('cards', 'Suppliers and contacts')] },
  { id: 'register', name: 'Register', line: 'Any list of things as a grid you can sort and filter, with counts and totals.', blocks: [b('grid', 'Register')] },
  { id: 'fitness', name: 'Tracker', line: 'Numbers from a log charted against their targets, how often this week, the latest entry and the plan.', blocks: [b('status'), b('countdown', 'end'), b('trend'), b('streak'), b('entry'), b('grid', 'Plan')] },
  { id: 'wellbeing', name: 'Habit', line: 'A streak and its milestones, the last two weeks of check-ins, small trends and the latest entry.', blocks: [b('streak'), b('trend'), b('entry'), b('grid', 'Plan')] },
  { id: 'venture', name: 'Venture', line: 'The stage, a board of the pipeline, a timeline of what’s due and the people involved.', blocks: [b('status'), b('board', 'Pipeline'), b('timeline', 'Campaigns'), b('cards', 'Suppliers and contacts')] },
];

export const layoutInfo = (id: string | undefined): LayoutInfo | undefined => LAYOUTS.find((l) => l.id === id);

/** The layout a project's properties pick (unknown words: none, so the page stays as it was). */
export function layoutOf(props: Record<string, unknown> | undefined): LayoutId | undefined {
  const v = String(props?.layout ?? '').trim().toLowerCase();
  const alias: Record<string, LayoutId> = { tracker: 'fitness', habit: 'wellbeing', event: 'site', program: 'programme' };
  return (LAYOUT_IDS as readonly string[]).includes(v) ? (v as LayoutId) : alias[v];
}

/** `blocks:` as written ([countdown, "trend:Weight", board: Pipeline]): known blocks only, in order. */
export function parseBlocks(v: unknown): BlockSpec[] {
  const out: BlockSpec[] = [];
  const items = Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.replace(/^\[|\]$/g, '').split(',') : [];
  for (const raw of items) {
    // A YAML map item ({ trend: Weight }) is a block and its argument too.
    const pairs = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.entries(raw as Record<string, unknown>).map(([k, x]) => `${k}:${text(x)}`) : [text(raw)];
    for (const one of pairs) {
      const m = /^\s*["']?([a-z-]+)\s*(?::\s*(.*?))?["']?\s*$/i.exec(one);
      // Plural names are the same block (fnv3 F30): normalise once, and strip quotes from the argument too.
      const rawType = m?.[1].toLowerCase() ?? '';
      const singular = rawType.replace(/ies$/, 'y').replace(/s$/, '');
      const type = singular === 'card' ? 'cards' : (BLOCK_TYPES as readonly string[]).includes(rawType) ? rawType : singular;
      const known = BLOCK_TYPES.find((t) => t === type || (type === 'chart' && t === 'trend') || (type === 'habit' && t === 'streak') || (type === 'log' && t === 'entry') || (type === 'table' && t === 'grid') || (type === 'kanban' && t === 'board'));
      const arg = m?.[2]?.trim().replace(/^["']|["']$/g, '');
      if (known) out.push(arg ? { type: known, arg } : { type: known });
    }
  }
  return out;
}

/** The blocks a project's dashboard shows: its own `blocks:`, else its layout's preset, else none (the page as it was). */
export function blocksOf(props: Record<string, unknown> | undefined): BlockSpec[] {
  const own = parseBlocks(props?.blocks);
  if (own.length) return own;
  return layoutInfo(layoutOf(props))?.blocks ?? [];
}

// ── Reading values ───────────────────────────────────────────────────────────────────────────────────────────────────

const text = (v: unknown): string => (v === null || v === undefined ? '' : Array.isArray(v) ? v.map(text).join(', ') : String(v)).trim();
/** A number from a value ("104.2 kg", "3/10", "95%", 104): the first number at its start, else none. */
export function numberIn(v: unknown, anywhere = false): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const t = text(v).replace(/,(?=\d{3}\b)/g, '');
  const m = (anywhere ? /(-?\d+(?:\.\d+)?)/ : /^[~≈<>]?\s*(-?\d+(?:\.\d+)?)/).exec(t);
  return m ? Number(m[1]) : undefined;
}
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.replace(/^\[|\]$/g, '').split(',') : []);
/** A day written in a property or a table ("2026-12-05", "5 Dec 2026", "Fri 5 Dec"), or null. */
export function dayOf(v: unknown, ref: Date): Date | null {
  const t = text(v);
  if (!t) return null;
  return readDay(t, ref);
}
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// One plural rule everywhere (3 Nov 2026, fourth-round G5-G7): imported from ./words above.
/**
 * "spare item" → "spare items" (simple English, enough for a register's noun). A noun written with more words after
 * it ("spare units, grouped by status") is the words before them; one already plural stays ("spare units", and "spare
 * unit" for one).
 */
export function pluralNoun(noun: string, n: number): string {
  const w = nounOf(noun) || 'item';
  const many = /[^s'’]s$/i.test(w) && !/(us|is|ss)$/i.test(w);
  if (n === 1) return !many ? w : /(ss|x|z|ch|sh)es$/i.test(w) ? w.slice(0, -2) : /[^aeiou]ies$/i.test(w) ? `${w.slice(0, -3)}y` : w.slice(0, -1);
  if (many) return w;
  if (/(s|x|z|ch|sh)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}
/** A register's noun: the words before any comma, bracket, dash or colon the person went on with. */
export const nounOf = (noun: string) => String(noun ?? '').split(/\s*[,;(:—–]\s*|\s+-\s+/)[0].trim();
/** "Alcohol-free" → "alcohol-free" (an acronym such as "AFL" stays). */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const shortDay = (d: Date, ref: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== ref.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
/** "Tue 21 Oct 2026": how a log's entry is headed. */
export const logHeading = (d: Date) => `${WEEKDAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// ── Tables and sections ──────────────────────────────────────────────────────────────────────────────────────────────

export interface Table {
  head: string[];
  rows: string[][];
}

const splitRow = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
const isRule = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));

/** The first Markdown table in some words: its header and rows (cells trimmed, "—" kept as written). */
export function readTable(body: string): Table | null {
  const lines = String(body ?? '').split(/\r?\n/);
  let i = lines.findIndex((l) => /^\s*\|.*\|\s*$/.test(l));
  if (i < 0) return null;
  const block: string[][] = [];
  for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) block.push(splitRow(lines[i]));
  if (block.length >= 2 && isRule(block[1])) return { head: block[0], rows: block.slice(2).filter((r) => !isRule(r) && r.some((c) => c)) };
  return { head: [], rows: block.filter((r) => !isRule(r) && r.some((c) => c)) };
}

/** The column whose header matches (or -1). */
export const column = (t: Table | null, re: RegExp) => (t ? t.head.findIndex((h) => re.test(h.trim())) : -1);
const cellAt = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
const blank = (s: string) => !s || /^[—–-]$/.test(s);

/** A section the layouts read, by its exact name (case and apostrophes forgiven): its words, or ''. */
export function sectionText(p: Project, heading: string): string {
  const want = norm(heading);
  return p.extra.find((x) => norm(x.heading) === want)?.body ?? '';
}

const cellText = (s: string) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

/**
 * Some words with a row added to their first table (made with `head` when there is no table yet), every other line
 * kept. Cells are matched to the table's own columns by name when `values` is a record.
 */
export function addTableRow(body: string, head: string[], values: string[] | Record<string, string>): string {
  const lines = String(body ?? '').replace(/\s+$/, '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*\|.*\|\s*$/.test(l));
  const row = (cols: string[]) => `| ${cols.map((c) => cellText(c) || ' ').join(' | ')} |`.replace(/\|\s{2,}(?=\|)/g, '|  ');
  const pick = (cols: string[]) => (Array.isArray(values) ? cols.map((_, i) => values[i] ?? '') : cols.map((c) => Object.entries(values).find(([k]) => norm(k) === norm(c))?.[1] ?? ''));
  if (start < 0) {
    const table = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, row(pick(head))];
    return [...(lines.join('').trim() ? [...lines, ''] : []), ...table].join('\n');
  }
  let end = start;
  while (end + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[end + 1])) end++;
  const cols = splitRow(lines[start]);
  const mine = pick(cols).map((c) => cellText(c));
  // One idempotent append for every log table (9.2): the same row again (a retry) changes nothing.
  for (let i = start + 2; i <= end; i++) if (splitRow(lines[i]).map((c) => c.trim()).join('\n') === mine.join('\n')) return lines.join('\n');
  // The same first-column name updates in place (fnv3 F34), as the writes side does: never a second row for one thing.
  if (mine[0]) { const same = lines.slice(start + 2, end + 1).findIndex((l) => norm(splitRow(l)[0] ?? '') === norm(mine[0])); if (same >= 0) { const was = splitRow(lines[start + 2 + same]); lines[start + 2 + same] = row(cols.map((_, i) => mine[i] || was[i] || '')); return lines.join('\n'); } }
  lines.splice(end + 1, 0, row(pick(cols)));
  return lines.join('\n');
}

// ── Run sheets (### phases with tick boxes) ──────────────────────────────────────────────────────────────────────────

export interface RunItem {
  done: boolean;
  what: string;
  /** Its line in the section's words (for ticking it). */
  line: number;
}
export interface RunPhase {
  name: string;
  /** Its ### heading's line (none for boxes written before any heading). */
  line?: number;
  items: RunItem[];
  done: number;
  total: number;
}

export function runSheet(body: string): RunPhase[] {
  const phases: RunPhase[] = [];
  let current: RunPhase | null = null;
  String(body ?? '')
    .split(/\r?\n/)
    .forEach((l, line) => {
      const h = /^###\s+(.+?)\s*#*\s*$/.exec(l);
      if (h) {
        current = { name: h[1], line, items: [], done: 0, total: 0 };
        phases.push(current);
        return;
      }
      // Any mark reads, through the one box rule (5 Nov 2026, u3 moving-in: `[-]` and `[/]` never counted at all).
      const box = /^\s*[-*+]\s+\[([^\]])\]\s+(.*)$/.exec(l);
      if (!box) return;
      // An empty box is never a task (p12-close-and-noise D, 4 Nov 2026): a template's "- [ ]" with nothing after it
      // is not counted, ticked off or shown as an action anywhere.
      if (!box[2].trim()) return;
      if (!current) {
        current = { name: 'Run sheet', items: [], done: 0, total: 0 };
        phases.push(current);
      }
      const done = isBoxDone(box[1]);
      current.items.push({ done, what: box[2].trim(), line });
      current.total++;
      if (done) current.done++;
    });
  return phases;
}

/** A run sheet's words with one tick box (by its line) ticked or unticked; every other character kept. */
export function toggleRunSheetItem(body: string, line: number, done?: boolean): string {
  const lines = String(body ?? '').split(/\n/);
  const l = lines[line];
  if (l === undefined || !/^\s*[-*+]\s+\[[ xX]\]/.test(l)) return body;
  lines[line] = l.replace(/\[([ xX])\]/, (_, was: string) => `[${(done ?? was === ' ') ? 'x' : ' '}]`);
  return lines.join('\n');
}

// ── Log notes ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type LogValue = { kind: 'number'; n: number; text: string } | { kind: 'yes'; yes: boolean; text: string } | { kind: 'text'; text: string };

export interface LogEntry {
  /** The day, YYYY-MM-DD. */
  date: string;
  /** Words after the date in its heading ("Day 1"). */
  label: string;
  /** The entry's fields in the order written (names as written). */
  values: Record<string, LogValue>;
  /** Bullets without "Field:" (and tick boxes), as written. */
  notes: string[];
}

export interface LogNote {
  path?: string;
  title?: string;
  /** The project it belongs to, as written (link brackets taken off). */
  project?: string;
  /** The numeric fields to chart, from `fields:` (empty: every number found). */
  fields: string[];
  /**
   * The fields the log says an entry has, in its order: the "- Field:" lines its own words show as the format (in
   * backticks before the first entry, "`- Water:` (glasses)"), then any other `fields:`. None when it shows no format.
   */
  declared?: string[];
  units: Record<string, string>;
  /** Oldest first. */
  entries: LogEntry[];
  /** Whether the file has its newest entry at the top (a new entry goes where the person's go). */
  newestFirst: boolean;
}

// A yes or no, alone or with the person's words after it: "Y", "N (drank, amount not given)", "Yes — first try".
const YES = /^(y|yes|true|done|✓|✔)(?=$|\s*[(—–,;:.]|\s+-\s)/i;
const NO = /^(n|no|false|✗|✘)(?=$|\s*[(—–,;:.]|\s+-\s)/i;

/** One value from "- Field: value": a yes/no, a number (at its start, or anywhere for a charted field), or words. */
export function readLogValue(raw: string, charted = false): LogValue {
  const t = raw.trim();
  if (YES.test(t)) return { kind: 'yes', yes: true, text: t };
  if (NO.test(t)) return { kind: 'yes', yes: false, text: t };
  const n = numberIn(t, charted);
  if (n !== undefined) return { kind: 'number', n, text: t };
  return { kind: 'text', text: t };
}

/** A log's heading read as a day: "Sun 18 Oct 2026", "2026-10-18", "Sun 18 Oct 2026, Day 1". */
export function readLogHeading(heading: string, ref: Date = new Date()): { date: Date; label: string } | null {
  const h = heading.replace(/[*_`]/g, '').trim();
  // A day always has a number in it ("## Today" or "## Wed" is a heading, not an entry).
  if (!/\d/.test(h)) return null;
  const whole = readDay(h, ref);
  if (whole) return { date: whole, label: '' };
  const parts = h.split(',');
  for (let k = 1; k < parts.length; k++) {
    const d = readDay(parts.slice(0, k).join(','), ref);
    if (d) return { date: d, label: parts.slice(k).join(',').trim() };
  }
  // "2026-10-18 Day 1" / "18 Oct 2026 — Day 1"
  const iso = /^(\d{4}-\d{1,2}-\d{1,2})\b\s*[—–:-]?\s*(.*)$/.exec(h);
  if (iso) {
    const d = readDay(iso[1], ref);
    if (d) return { date: d, label: iso[2].trim() };
  }
  const dm = /^((?:[A-Za-z]{3,9},?\s+)?\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4})\b\s*[—–:-]?\s*(.*)$/.exec(h);
  if (dm) {
    const d = readDay(dm[1], ref);
    if (d) return { date: d, label: dm[2].trim() };
  }
  return null;
}

const unlink = (s: string) => s.replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();
// "Fri 23 Oct: travel day" or "Reported 19 Oct: …" is a note about a day, not a field an entry keeps.
const MONTH_WORD = `(?:${MONTHS.join('|')}|January|February|March|April|June|July|August|September|October|November|December)\\.?`;
const DAYISH = new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_WORD}(?![a-z])|\\b${MONTH_WORD}\\s+\\d{1,2}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b`, 'i');
/** The "- Field:" lines a log's words show as its format, before its first entry ("`- Urges: 0-10`", "`- Water:`"). */
function declaredFields(preamble: string): string[] {
  const out: string[] = [];
  for (const m of preamble.matchAll(/`\s*[-*+]\s+(?:\*\*)?([A-Za-z][^:`*\n]{0,40}?)(?:\*\*)?:[^`\n]*`/g)) {
    const name = m[1].trim();
    if (!DAYISH.test(name) && !out.some((x) => norm(x) === norm(name))) out.push(name);
  }
  return out;
}

/** Reads a log note (type: log): its project, fields, units and entries, oldest first. Lenient: lines it can't read are skipped. */
export function parseLog(source: string, ref: Date = new Date()): LogNote {
  const props = readProps(String(source ?? ''));
  const fields = listOf(props.fields).map((f) => text(f).replace(/^["']|["']$/g, '')).filter(Boolean);
  const units: Record<string, string> = {};
  if (props.units && typeof props.units === 'object' && !Array.isArray(props.units)) for (const [k, v] of Object.entries(props.units)) units[k] = text(v);
  const charted = new Set(fields.map(norm));
  const body = String(source ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
  const byDate = new Map<string, LogEntry>();
  const order: string[] = [];
  let current: LogEntry | null = null;
  let preamble = '';
  let started = false;
  for (const line of body.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h && !started) preamble += `${line}\n`;
    if (h) {
      const read = readLogHeading(h[1], ref);
      if (read) started = true;
      if (!read) {
        current = null;
        continue;
      }
      const date = isoDay(read.date);
      current = byDate.get(date) ?? { date, label: read.label, values: {}, notes: [] };
      if (!byDate.has(date)) {
        byDate.set(date, current);
        order.push(date);
      }
      continue;
    }
    if (!current) continue;
    const b = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (!b) continue;
    const item = b[1].trim();
    const kv = /^(?:\*\*)?([A-Za-z][^:*\[\]]{0,40}?)(?:\*\*)?:(?:\*\*)?\s+(.+)$/.exec(item) ?? /^(?:\*\*)?([A-Za-z][^:*\[\]]{0,40}?)(?:\*\*)?:\s*$/.exec(item);
    if (kv && !/^https?$/i.test(kv[1]) && kv[2] !== undefined && !DAYISH.test(kv[1])) current.values[kv[1].trim()] = readLogValue(kv[2], charted.has(norm(kv[1])));
    else if (item) current.notes.push(item.replace(/^\[[^\]]\]\s*/, ''));
  }
  const entries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const newestFirst = order.length > 1 ? order[0] > order[order.length - 1] : false;
  // The fields its format shows (and any it charts that the format left out); none when it shows no format.
  const shown = declaredFields(preamble);
  const declared = shown.length ? [...shown, ...fields.filter((f) => !shown.some((x) => norm(x) === norm(f)))] : [];
  return { project: props.project !== undefined ? unlink(text(props.project)) : undefined, fields, ...(declared.length ? { declared } : {}), units, entries, newestFirst };
}

/** Whether a note's properties make it a log. */
export const isLogProps = (props: Record<string, unknown> | undefined) => String(props?.type ?? '').trim().toLowerCase() === 'log';

/** The logs that belong to a project: `project:` names it (by its title or file name), or a log with no project in its folder. */
export function logsFor<T extends { path: string; project?: string }>(logs: T[], projectName: string, projectPath: string): T[] {
  const dir = projectPath.includes('/') ? projectPath.slice(0, projectPath.lastIndexOf('/') + 1) : '';
  const file = (projectPath.split('/').pop() ?? '').replace(/\.md$/i, '');
  const names = new Set([norm(projectName), norm(file)].filter(Boolean));
  // A named log inside a sibling folder (another project's folder under the same parent) is that project's,
  // whatever its project: says (fnv3 F36): same-named projects never share logs through a folder that is not theirs.
  const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const inSibling = (p: string) => { const parent = parentOf(p); return !!dir && parent && `${parent}/` !== dir && parentOf(parent) === parentOf(dir.slice(0, -1)); };
  return logs.filter((l) => (l.project ? names.has(norm(unlink(l.project))) && !inSibling(l.path) : !!dir && l.path.startsWith(dir)));
}

/** A numeric series from logs (oldest first), by field name (case forgiven). */
export function series(logs: LogNote[], field: string): { date: string; n: number }[] {
  const want = norm(field);
  const out = new Map<string, number>();
  for (const l of logs) for (const e of l.entries) for (const [k, v] of Object.entries(e.values)) if (norm(k) === want && v.kind === 'number') out.set(e.date, v.n);
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, n]) => ({ date, n }));
}

/** Every entry across a project's logs, by day (two logs on one day: their fields together), oldest first. */
export function entriesOf(logs: LogNote[]): LogEntry[] {
  const days = new Map<string, LogEntry>();
  for (const l of logs)
    for (const e of l.entries) {
      const had = days.get(e.date);
      days.set(e.date, had ? { ...had, label: had.label || e.label, values: { ...had.values, ...e.values }, notes: [...had.notes, ...e.notes] } : e);
    }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface NewLogEntry {
  /** The day (default today). */
  date?: Date;
  /** Words after the date ("Day 4"). */
  label?: string;
  /** Field → value as it should be written ("104.2 kg", "Y", "3/10"). Empty values are left out. */
  values: Record<string, string | number | boolean>;
  /** Free notes (each a bullet). */
  notes?: string[];
}

const valueWords = (v: string | number | boolean) => (typeof v === 'boolean' ? (v ? 'Y' : 'N') : String(v).replace(/\r?\n/g, ' ').trim());

/**
 * A log's text with an entry added in the contract's format (## Tue 21 Oct 2026, then "- Field: value" bullets). A day
 * already there gets the fields set (a field it has is changed where it is, a new one added under the others) and the
 * notes added; a new day goes where the person's entries go (top when newest is first, else in date order). Everything
 * else in the file is kept as written.
 */
export function appendLogEntry(source: string, entry: NewLogEntry, ref: Date = new Date()): string {
  const day = startOfDay(entry.date ?? ref);
  const iso = isoDay(day);
  const src = String(source ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const front = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(src)?.[0] ?? '';
  const lines = src.slice(front.length).split(/\r?\n/);
  const fields = Object.entries(entry.values).filter(([, v]) => valueWords(v) !== '');
  const notes = (entry.notes ?? []).map((n) => n.replace(/\r?\n/g, ' ').trim()).filter(Boolean);
  const bullets = [...fields.map(([k, v]) => `- ${k}: ${valueWords(v)}`), ...notes.map((n) => `- ${n}`)];
  // The days already written: [line, iso].
  const heads: [number, string][] = [];
  lines.forEach((l, i) => {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(l);
    const read = h ? readLogHeading(h[1], ref) : null;
    if (read) heads.push([i, isoDay(read.date)]);
  });
  const same = heads.find(([, d]) => d === iso);
  if (same) {
    const at = same[0];
    let end = lines.findIndex((l, i) => i > at && /^#{1,2}\s/.test(l));
    if (end < 0) end = lines.length;
    let last = at;
    for (let i = at + 1; i < end; i++) if (lines[i].trim()) last = i;
    const add: string[] = [];
    for (const [k, v] of fields) {
      const i = lines.findIndex((l, j) => j > at && j < end && new RegExp(`^\\s*[-*+]\\s+(?:\\*\\*)?${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\*\\*)?:`, 'i').test(l));
      if (i >= 0) lines[i] = lines[i].replace(/:(?:\*\*)?\s*.*$/, (m) => `${m.startsWith(':**') ? ':**' : ':'} ${valueWords(v)}`);
      else add.push(`- ${k}: ${valueWords(v)}`);
    }
    add.push(...notes.map((n) => `- ${n}`));
    lines.splice(last + 1, 0, ...add);
    return front + lines.join(eol).replace(/\s+$/, '') + eol;
  }
  const head = `## ${logHeading(day)}${entry.label?.trim() ? `, ${entry.label.trim()}` : ''}`;
  const block = [head, '', ...bullets, ''];
  const newestFirst = heads.length > 1 ? heads[0][1] > heads[heads.length - 1][1] : false;
  let at: number;
  if (!heads.length) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    at = lines.length;
    if (at && lines[at - 1].trim()) block.unshift('');
  } else if (newestFirst) {
    const later = heads.find(([, d]) => d < iso);
    at = later ? later[0] : lines.length;
  } else {
    const after = heads.find(([, d]) => d > iso);
    at = after ? after[0] : lines.length;
    if (!after) {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      at = lines.length;
      block.unshift('');
    }
  }
  lines.splice(at, 0, ...block);
  return front + lines.join(eol).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + eol;
}

/** A new log note for a project, in the contract's format, with its first entry when given. */
export function newLogNote(projectName: string, opts: { fields?: string[]; units?: Record<string, string>; title?: string; entry?: NewLogEntry } = {}, ref: Date = new Date()): string {
  const q = (s: string) => (/^[\w .-]+$/.test(s) && !/^\s|\s$/.test(s) ? s : JSON.stringify(s));
  const front = ['---', 'type: log', `project: ${JSON.stringify(projectName)}`];
  if (opts.fields?.length) front.push(`fields: [${opts.fields.map(q).join(', ')}]`);
  const units = Object.entries(opts.units ?? {}).filter(([, v]) => v);
  if (units.length) front.push(`units: {${units.map(([k, v]) => `${q(k)}: ${q(v)}`).join(', ')}}`);
  front.push('---', `# ${opts.title ?? `${projectName} log`}`, '');
  const base = `${front.join('\n')}\n`;
  return opts.entry ? appendLogEntry(base, opts.entry, ref) : base;
}

// ── Key dates, risks, next steps (shared by every layout) ───────────────────────────────────────────────────────────

export interface Milestone {
  when: string;
  what: string;
  status: string;
  /** YYYY-MM-DD when the date can be read. */
  date?: string;
  /** Days from today (negative: passed). */
  offset?: number;
  tone: 'ok' | 'warn' | 'bad' | 'none' | 'next';
  /** Its place in the project's key dates (for editing it where it is). */
  index?: number;
}

function statusTone(status: string, offset?: number): Milestone['tone'] {
  const s = status.toLowerCase();
  // Whole words only: "something" is not met, "unmet" is not met, "belated" is not late. Done but waiting
  // ("Done pending review") waits amber, never green.
  if (/\b(pending|awaiting|under review|in review|review)\b/.test(s)) return 'warn';
  if (/\b(done|complete|completed|met|achieved)\b|✓|\b(live|launched|sent|published|posted|shipped|won)\b/.test(s)) return 'ok';
  if (/\b(late|missed|overdue|slipp\w*)\b/.test(s)) return 'bad';
  if (/\brisks?\b/.test(s)) return 'warn';
  if (/\b(next|current|now)\b/.test(s)) return 'next';
  if (offset !== undefined && offset < 0) return 'bad';
  return 'none';
}

export function milestones(p: Project, today: Date): Milestone[] {
  const out = p.dates.map((d, index) => {
    const day = dayOf(d.when, today);
    const offset = day ? daysBetween(today, day) : undefined;
    const status = d.status ?? '';
    return { when: d.when, what: d.what, status, ...(day ? { date: isoDay(day), offset } : {}), tone: statusTone(status, offset), index } as Milestone;
  });
  return out.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}

/** Risks still open: bullets not closed, and the rows of a risks table whose Status isn't closed. */
export function openRisks(p: Project): { what: string; impact?: string; owner?: string; status?: string }[] {
  const out: { what: string; impact?: string; owner?: string; status?: string }[] = p.risks.filter((r) => !r.closed).map((r) => ({ what: r.what, ...(r.level ? { impact: r.level } : {}) }));
  const t = readTable(p.rest?.risks ?? '');
  if (t) {
    const [wi, ii, oi, si] = [Math.max(0, column(t, /risk|issue|what/i)), column(t, /impact|level|severity/i), column(t, /owner|who/i), column(t, /status|state/i)];
    for (const r of t.rows) {
      const status = cellAt(r, si);
      if (/closed|done|resolved/i.test(status) || !cellAt(r, wi)) continue;
      out.push({ what: cellAt(r, wi), ...(cellAt(r, ii) ? { impact: cellAt(r, ii) } : {}), ...(cellAt(r, oi) ? { owner: cellAt(r, oi) } : {}), ...(status ? { status } : {}) });
    }
  }
  return out;
}

/** "47 days", "1 day", "today". */
const daysWords = (n: number) => (n === 0 ? 'today' : plural(Math.abs(n), 'day'));

// ── What each block shows ────────────────────────────────────────────────────────────────────────────────────────────

export interface LayoutInput {
  project: Project;
  props: Record<string, unknown>;
  logs: LogNote[];
  today: Date;
}

/** What an empty block offers to add, in one click, as contract-correct Markdown. */
export type BlockAdd =
  | { kind: 'row'; section: string; head: string[] }
  | { kind: 'date' }
  | { kind: 'phase'; section: string }
  | { kind: 'entry' }
  | { kind: 'prop'; key: string; label: string; date?: boolean }
  | { kind: 'next' };

interface BlockBase {
  /** Its title on the dashboard. */
  title: string;
  empty: boolean;
  /** When empty (or to grow it): what to add. */
  add?: BlockAdd;
}

export interface Fact {
  key: string;
  label: string;
  value: string;
  /** The value as written in the properties (a date as YYYY-MM-DD), for editing. */
  raw: string;
  kind: 'text' | 'date' | 'link';
}

export interface StatusBlock extends BlockBase {
  type: 'status';
  health?: string;
  progress?: number;
  due?: { date: string; days: number };
  owner?: string;
  /** A one-line aim (a `goal:`, `objective:` or `aim:` key). */
  aim?: string;
  facts: Fact[];
  /** A stage or phase on a known path (`stages:` / `phases:`, the run sheet's phases, or the contract's venture stages). */
  steps?: { key: string; names: string[]; current: number };
  risks: number;
  open: number;
  done: number;
}

export interface CountdownBlock extends BlockBase {
  type: 'countdown';
  key: string;
  /** What it counts to ("opening", "go-live", "the due date"). */
  what: string;
  date?: string;
  days?: number;
  words: string;
  tone: 'ok' | 'warn' | 'bad' | 'none';
  /** From a start key: how far through ("Week 3 of 8"). */
  period?: { start: string; end: string; week: number; weeks: number; fraction: number };
  address?: string;
}

export interface ProgressRow {
  name: string;
  owner: string;
  status: string;
  tone: 'ok' | 'warn' | 'bad' | 'none';
  progress?: number;
  next: string;
  /** Its row in the section's table (as readTable counts them), for editing it where it is. */
  row: number;
}
/** Which column of a table holds each part a block shows (-1: none). */
export type Cols<K extends string> = Record<K, number>;
export interface ProgressBlock extends BlockBase {
  type: 'progress';
  section: string;
  mode: 'table' | 'phases' | 'next' | 'none';
  rows: ProgressRow[];
  phases: RunPhase[];
  /** The phase being worked on: the one `phase:` names, else the first not finished. */
  current: number;
  done: number;
  total: number;
  /** The average of a table's progress, or ticked of all. */
  overall?: number;
  /** A table's header and its columns (table mode). */
  head?: string[];
  cols?: Cols<'name' | 'owner' | 'status' | 'progress' | 'next'>;
}

export interface TimelineItem extends Milestone {
  owner?: string;
  /** Its row in the section's table (a section's timeline). */
  row?: number;
}
export interface TimelineBlock extends BlockBase {
  type: 'timeline';
  section: string;
  source: 'dates' | 'section';
  items: TimelineItem[];
  /** A section's table: its columns. */
  cols?: Cols<'date' | 'what' | 'status' | 'owner'>;
}

export interface BoardCard {
  title: string;
  owner: string;
  due: string;
  date?: string;
  overdue: boolean;
  notes: string;
  /** Its row in the section's table. */
  row: number;
}
export interface BoardBlock extends BlockBase {
  type: 'board';
  section: string;
  /** A section's own table (editable), or one read from its lists (Key dates, People): shown, never edited here. */
  source: 'section' | 'dates' | 'people';
  /** Each stage's column; `value` is the stage as its rows write it. */
  columns: { stage: string; value: string; items: BoardCard[] }[];
  head?: string[];
  cols?: Cols<'title' | 'stage' | 'owner' | 'due' | 'notes'>;
}

export interface GridBlock extends BlockBase {
  type: 'grid';
  section: string;
  /** A section's own table (editable cell by cell), or one the page reads from its lists (Key dates, People). */
  source: 'section' | 'dates' | 'people';
  table: Table;
  /** Its noun (a `register_of:` key): "48 spare items". */
  of?: string;
  statusCol: number;
  /** Rows by their Status; `qty` is how many of the thing they hold when the table has a quantity column. */
  byStatus: { status: string; count: number; qty?: number }[];
  /** Sums of quantity- or money-like columns. */
  totals: { col: number; label: string; sum: number }[];
  /** A quantity column (Qty, Count, On hand…): then a row is several of the thing, and this is how many in all. */
  units?: { col: number; label: string; sum: number };
}

export interface TrendSeries {
  field: string;
  unit: string;
  points: { date: string; n: number }[];
  latest?: number;
  first?: number;
  /** From `start_<field>` (else the first entry) and `target_<field>`. */
  start?: number;
  target?: number;
  /** The plan line's ends, when the project has start and end dates. */
  from?: string;
  to?: string;
}
export interface TrendBlock extends BlockBase {
  type: 'trend';
  series: TrendSeries[];
}

export interface StreakBlock extends BlockBase {
  type: 'streak';
  /** The yes/no field it reads (none: it counts days from `streak_start`). */
  field?: string;
  label: string;
  /** Day N since `streak_start` (the start is day 1). */
  day?: number;
  start?: string;
  /** Yes days in a row up to today (or yesterday, before today is written). */
  run: number;
  best: number;
  grid: { date: string; state: 'yes' | 'no' | 'none' | 'before' }[];
  milestones: { days: number; date: string; reached: boolean }[];
  next?: { days: number; left: number; from: number };
  /** From a `<things>_per_week` key: entries this week (Monday first). */
  week?: { label: string; count: number; of: number; days: boolean[] };
}

export interface EntryField {
  name: string;
  kind: 'number' | 'yes' | 'text';
  unit: string;
}
export interface EntryBlock extends BlockBase {
  type: 'entry';
  /** The project's logs, the one written in most lately first, each with the fields its own entries are written with. */
  logs: { path: string; title: string; fields: EntryField[] }[];
  fields: EntryField[];
  latest?: LogEntry;
  entries: number;
}

export interface CardsBlock extends BlockBase {
  type: 'cards';
  section: string;
  cards: { name: string; role: string; company: string; contact: string; row: number }[];
  source: 'section' | 'people' | 'dates';
  cols?: Cols<'name' | 'role' | 'company' | 'contact'>;
}

export interface ActionsBlock extends BlockBase {
  type: 'actions';
  items: { what: string; who?: string; when?: string; index: number }[];
  open: number;
}

export type BlockModel = StatusBlock | CountdownBlock | ProgressBlock | TimelineBlock | BoardBlock | GridBlock | TrendBlock | StreakBlock | EntryBlock | CardsBlock | ActionsBlock;

// The properties a block reads itself, or the page shows already: never repeated as a fact.
const NOT_FACTS = /^(type|layout|blocks|status|health|progress|owner|folder|repository|started|due|updated|tags|neuralspark-project|aliases|cssclass(es)?|description|fields|units|milestones|stages|phases|streak_.*|start_.+|target_.+|.+_per_week|goal|objective|aim)$/i;
const AIMS = ['goal', 'objective', 'aim'];
const DATE_KEY = /(^|_)(date|day|go_?live|launch|deadline|end|due|start|opening|close|event|from|to|until)$/i;
const VENTURE_STAGES = ['idea', 'building', 'launched', 'growing'];

/** "go_live" → "Go live", "register_of" → "Register of". */
export const keyLabel = (k: string) => cap(k.replace(/[_-]+/g, ' ').trim());
const keyName = (field: string) => field.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
/**
 * The tone a status word carries, whatever list it's from (a health, a workstream, a register's Status column): bad,
 * then warn, then ok; anything else is neutral. "Out of stock" is bad though it says "stock".
 */
export function toneWord(word?: string): 'ok' | 'warn' | 'bad' | 'none' {
  const w = String(word ?? '').toLowerCase();
  if (/\b(off track|red|critical|blocked|late|stuck|broken|lost|missing|faulty|fault|overdue|failed|out of stock|cancelled|missed)\b/.test(w)) return 'bad';
  if (/\b(at risk|risk|amber|warn|warning|behind|watch|repair|pending|waiting|low|on hold|hold|review|delayed|slipping)\b/.test(w)) return 'warn';
  if (/\b(on track|track|green|done|complete|completed|good|ok|in stock|stock|available|active|in use|working|live|won|ready|met|achieved|healthy)\b/.test(w)) return 'ok';
  return 'none';
}
const healthTone = toneWord;
const propOf = (props: Record<string, unknown>, key: string) => {
  const want = keyName(key);
  const k = Object.keys(props).find((x) => keyName(x) === want);
  return k === undefined ? undefined : props[k];
};

/** A section's table, by name: Key dates and People come from what the page already reads. */
function tableOf(p: Project, name: string): { table: Table | null; heading: string; source: 'dates' | 'people' | 'section' } {
  const n = norm(name);
  if (/^(key dates|dates|milestones|timeline|schedule)$/.test(n)) return { heading: 'Key dates', source: 'dates', table: p.dates.length ? { head: p.datesHead ?? ['Date', 'Milestone', 'Status'], rows: p.dates.map((d) => [d.when, d.what, d.status ?? '']) } : null };
  if (/^(people|stakeholders|team|contacts)$/.test(n)) return { heading: 'People', source: 'people', table: p.people.length ? { head: ['Name', 'Role'], rows: p.people.map((x) => [x.name, x.role ?? '']) } : null };
  const x = p.extra.find((e) => norm(e.heading) === n);
  return { heading: x?.heading ?? name, source: 'section', table: x ? readTable(x.body) : null };
}

const PROGRESS_COL = /^(progress|% ?done|percent|complete|completion|%)$/i;
const STAGE_COL = /^(stage|status|state|column|lane)$/i;
const DATE_COL = /^(date|due|when|day|deadline|target|on)$/i;
const QTY_COL = /^(qty|quantity|count|units|on hand|stock|number|no\.?|amount|cost|price|value|total|budget|spend|hours)$/i;
const UNITS_COL = /^(qty|quantity|count|units|on hand|stock|number|no\.?)$/i;

/** The project hub's own sections (src/shared/project-hub.ts): never read as a layout's run sheet or table. */
const HUB_SECTION = /^stage checklist$/i;
/** A project's lifecycle stage word (src/shared/project-hub.ts), shown by the hub's stepper rather than as a fact. */
const LIFECYCLE = /^(idea|planning|active|closing|done)$/i;

/** The first section of the person's own whose table (or words) a block can read, when the block names none. */
function findSection(p: Project, test: (t: Table | null, body: string) => boolean): string | undefined {
  return p.extra.find((x) => !HUB_SECTION.test(x.heading.trim()) && test(readTable(x.body), x.body))?.heading;
}

function statusBlock(p: Project, props: Record<string, unknown>, t0: Date): StatusBlock {
  const facts: Fact[] = [];
  for (const [key, v] of Object.entries(props)) {
    if (NOT_FACTS.test(key) || v === null || v === undefined || typeof v === 'object') continue;
    const value = text(v);
    if (!value) continue;
    if (/^(stage|lifecycle)$/i.test(key) && LIFECYCLE.test(value) && !listOf(propOf(props, 'stages')).length) continue;
    const day = DATE_KEY.test(key) || /^\d{4}-\d{2}-\d{2}$/.test(value) ? dayOf(value, t0) : null;
    facts.push({ key, label: keyLabel(key), value: day ? shortDay(day, t0) : value, raw: value, kind: /^https?:\/\/\S+$/i.test(value) ? 'link' : day ? 'date' : 'text' });
  }
  const aimKey = Object.keys(props).find((k) => AIMS.includes(k.toLowerCase()));
  // A stage or phase on a path: its own list, the run sheet's phases, or the contract's venture stages.
  let steps: StatusBlock['steps'];
  for (const key of ['stage', 'phase']) {
    const value = text(propOf(props, key));
    if (!value) continue;
    const own = listOf(propOf(props, `${key}s`)).map(text).filter(Boolean);
    const sheet = key === 'phase' ? runSheet(sectionText(p, 'Run sheet')).map((x) => x.name) : [];
    const names = own.length ? own : sheet.some((x) => norm(x) === norm(value)) ? sheet : key === 'stage' && VENTURE_STAGES.includes(value.toLowerCase()) ? VENTURE_STAGES.map(cap) : [];
    const current = names.findIndex((x) => norm(x) === norm(value));
    if (names.length > 1 && current >= 0) {
      steps = { key, names, current };
      const at = facts.findIndex((f) => f.key.toLowerCase() === key);
      if (at >= 0) facts.splice(at, 1);
      break;
    }
  }
  // A finished project is never overdue: its due date has stopped counting.
  const due = /^(done|closed|complete|completed|finished|archived|cancelled)$/i.test(String(p.status ?? '').trim()) ? null : dayOf(p.due, t0);
  const open = p.next.filter((x) => !x.done).length;
  const isEmpty = p.progress === undefined && !p.health && !due && !facts.length && !steps && !aimKey;
  return {
    type: 'status',
    title: 'Status',
    empty: isEmpty,
    ...(isEmpty ? { add: { kind: 'prop', key: 'due', label: 'Set a due date', date: true } as BlockAdd } : {}),
    ...(p.health ? { health: p.health } : {}),
    ...(p.progress !== undefined ? { progress: p.progress } : {}),
    ...(due ? { due: { date: isoDay(due), days: daysBetween(t0, due) } } : {}),
    ...(p.owner ? { owner: p.owner } : {}),
    ...(aimKey ? { aim: text(props[aimKey]) } : {}),
    facts,
    ...(steps ? { steps } : {}),
    risks: openRisks(p).length,
    open,
    done: p.next.length - open,
  };
}

const SITE_WHAT: Record<string, string> = { opening: 'opening', close: 'closing', closing: 'closing', event: 'the event', 'pop-up': 'the pop-up', popup: 'the pop-up' };

function countdownBlock(p: Project, props: Record<string, unknown>, t0: Date, arg?: string): CountdownBlock {
  // The date it counts to: the key it names, else the first date the project has (go-live, end, due).
  const keys = arg ? [arg] : ['go_live', 'end', 'due', 'deadline', 'launch', 'date', ...Object.keys(props).filter((k) => DATE_KEY.test(k) && !/start|from|updated|started/i.test(k))];
  let key = keys[0];
  let day: Date | null = null;
  for (const k of keys) {
    const v = k === 'due' ? (propOf(props, 'due') ?? p.due) : propOf(props, k);
    const d = dayOf(v, t0);
    if (d) {
      key = k;
      day = d;
      break;
    }
  }
  const kind = text(propOf(props, 'site_kind')).toLowerCase();
  const what = /^go_?live$/i.test(key) && SITE_WHAT[kind] ? SITE_WHAT[kind] : /^go_?live$/i.test(key) ? 'go-live' : key === 'due' ? 'the due date' : key === 'end' ? 'the end' : keyLabel(key).toLowerCase();
  const address = text(propOf(props, 'address')) || undefined;
  if (!day) return { type: 'countdown', title: 'Countdown', empty: true, add: { kind: 'prop', key: arg ?? (kind ? 'go_live' : 'due'), label: `Set the date for ${what}`, date: true }, key, what, words: '', tone: 'none', ...(address ? { address } : {}) };
  // How far through, from a start.
  const start = dayOf(propOf(props, 'start') ?? propOf(props, 'started') ?? p.started, t0);
  let period: CountdownBlock['period'];
  if (start && start < day) {
    const total = daysBetween(start, day) + 1;
    const gone = Math.max(0, Math.min(total, daysBetween(start, t0) + 1));
    const weeks = Math.max(1, Math.ceil(total / 7));
    // Before it starts it is week 0 of its weeks, and the countdown is to the start.
    period = { start: isoDay(start), end: isoDay(day), week: t0 < start ? 0 : Math.max(1, Math.min(weeks, Math.floor(daysBetween(start, t0) / 7) + 1)), weeks, fraction: gone / total };
  }
  const ahead = !!period && period.week === 0;
  const target = ahead ? start! : day;
  const towards = ahead ? 'the start' : what;
  const days = daysBetween(t0, target);
  const onDay = towards.replace(/^the /, '');
  const words = days > 0 ? `${daysWords(days)} to ${towards}` : days === 0 ? `${cap(onDay)} is today` : `${daysWords(-days)} since ${towards}`;
  return { type: 'countdown', title: 'Countdown', empty: false, key, what: towards, date: isoDay(target), days, words, tone: days < 0 ? 'none' : days <= 7 ? 'warn' : 'none', ...(period ? { period } : {}), ...(address ? { address } : {}) };
}

// ── Live workstream rows ─────────────────────────────────────────────────────────────────────────────────────────────

/** A project as the Desk Hub's Workstreams block reads it live: its name, status, health, progress and the person's own next step. */
export interface LiveProject {
  name: string;
  status?: string;
  health?: string;
  progress?: number;
  /** The project's first open task of the person's own (project-hub.ts firstOwnOpen), '' when it has none. */
  firstOwn?: string;
}

/** A Workstreams row's name as a project name: a link's words, case and spacing folded. */
const matchName = (name: string): string => {
  const t = String(name ?? '').trim();
  const link = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(t);
  return (link ? (link[2] ?? link[1]).trim() : t).toLowerCase().replace(/\s+/g, ' ');
};

/**
 * A Workstreams row read live from its project (p12-close-and-noise C, 4 Nov 2026: the Desk Hub's table went stale
 * because it is typed by hand). When the row's name matches a project, its status (Done when finished, else the
 * health, else the status), progress and next step come from that project — display only, the note's text untouched.
 * Null when no project matches: the person's typed row stays as typed.
 */
export function liveWorkstream(name: string, projects: LiveProject[]): { status: string; progress?: number; next: string } | null {
  const want = matchName(name);
  if (!want) return null;
  const found = projects.find((x) => matchName(x.name) === want);
  if (!found) return null;
  const status = isFinished(found.status) ? 'Done' : found.health?.trim() ? cap(found.health.trim()) : found.status?.trim() ? cap(found.status.trim()) : '';
  return { status, ...(typeof found.progress === 'number' && Number.isFinite(found.progress) ? { progress: Math.max(0, Math.min(100, Math.round(found.progress))) } : {}), next: (found.firstOwn ?? '').trim() };
}

function progressBlock(p: Project, props: Record<string, unknown>, arg?: string): ProgressBlock {
  const section =
    arg ??
    findSection(p, (t) => !!t && column(t, PROGRESS_COL) >= 0) ??
    findSection(p, (_, body) => runSheet(body).length > 0) ??
    "What's next";
  const base = { type: 'progress' as const, title: arg ? cap(section) : 'Progress', section, rows: [] as ProgressRow[], phases: [] as RunPhase[], current: 0, done: 0, total: 0 };
  if (/^what.?s next$/i.test(norm(section).replace(/ /g, ' ')) || norm(section) === 'whats next') {
    const total = p.next.length;
    const done = p.next.filter((x) => x.done).length;
    const phases: RunPhase[] = total ? [{ name: "What's next", items: p.next.map((x, i) => ({ done: x.done, what: x.what, line: i })), done, total }] : [];
    return { ...base, title: 'Progress', mode: total ? 'next' : 'none', phases, done, total, empty: !total, ...(total ? { overall: Math.round((done / total) * 100) } : {}), add: { kind: 'next' } };
  }
  const body = sectionText(p, section);
  const t = readTable(body);
  const head = SECTION_TABLES[cap(section)] ?? SECTION_TABLES.Workstreams;
  if (t && column(t, PROGRESS_COL) >= 0 || (t && t.rows.length && !runSheet(body).length)) {
    const [n, o, s, g, x] = [Math.max(0, column(t!, /^(workstream|stream|name|item|area|task|what)$/i)), column(t!, /^(owner|lead|who)$/i), column(t!, STAGE_COL), column(t!, PROGRESS_COL), column(t!, /^next/i)];
    const rows = t!.rows
      .map((r, row) => {
        const pr = numberIn(cellAt(r, g), true);
        const status = cellAt(r, s);
        return { name: cellAt(r, n), owner: cellAt(r, o), status, tone: healthTone(status), ...(pr !== undefined ? { progress: Math.max(0, Math.min(100, pr)) } : {}), next: cellAt(r, x), row };
      })
      .filter((r) => r.name);
    // One figure for the whole only when every row has its own (the average of some would read as all of them); with
    // some or none, how many are done (a done status, or 100%).
    const withPr = rows.filter((r) => r.progress !== undefined);
    const overall = withPr.length && withPr.length === rows.length ? Math.round(withPr.reduce((a, r) => a + r.progress!, 0) / withPr.length) : undefined;
    const done = rows.filter((r) => r.progress === 100 || /^(done|complete|completed|closed|finished|delivered|achieved)\b/i.test(r.status)).length;
    return { ...base, mode: 'table', rows, done, total: rows.length, empty: !rows.length, add: { kind: 'row', section, head: t!.head.length ? t!.head : head }, ...(overall !== undefined ? { overall } : {}), head: t!.head, cols: { name: n, owner: o, status: s, progress: g, next: x } };
  }
  const phases = runSheet(body);
  if (phases.length) {
    const named = text(propOf(props, 'phase'));
    const at = named ? phases.findIndex((x) => norm(x.name) === norm(named)) : -1;
    // An empty phase (0 of 0) is not finished, and not open either: a fresh sheet opens at its start (fnv3 F35).
    const firstOpen = phases.findIndex((x) => x.total > 0 && x.done < x.total);
    const done = phases.reduce((a, x) => a + x.done, 0);
    const total = phases.reduce((a, x) => a + x.total, 0);
    return { ...base, mode: 'phases', phases, current: at >= 0 ? at : firstOpen >= 0 ? firstOpen : 0, done, total, empty: false, add: { kind: 'phase', section }, ...(total ? { overall: Math.round((done / total) * 100) } : {}) };
  }
  return { ...base, mode: 'none', empty: true, add: /run sheet|checklist|phases?/i.test(section) ? { kind: 'phase', section } : { kind: 'row', section, head } };
}

function timelineBlock(p: Project, t0: Date, arg?: string): TimelineBlock {
  const section = arg ?? (p.dates.length ? 'Key dates' : findSection(p, (t) => !!t && column(t, DATE_COL) >= 0) ?? 'Key dates');
  const { table, heading, source } = tableOf(p, section);
  if (source === 'dates') {
    const items = milestones(p, t0);
    return { type: 'timeline', title: heading === 'Key dates' ? 'Milestones' : cap(heading), section: heading, source: 'dates', items, empty: !items.length, add: { kind: 'date' } };
  }
  const head = SECTION_TABLES[cap(section)] ?? ['Item', 'Stage', 'Owner', 'Due', 'Notes'];
  if (!table) return { type: 'timeline', title: cap(heading), section: heading, source: 'section', items: [], empty: true, add: { kind: 'row', section: heading, head } };
  const d = column(table, DATE_COL);
  const s = column(table, STAGE_COL);
  const o = column(table, /^(owner|who|lead)$/i);
  const w = table.head.findIndex((_, i) => i !== d && i !== s && i !== o);
  const items: TimelineItem[] = table.rows
    .map((r, row) => {
      const when = cellAt(r, d);
      const day = blank(when) ? null : dayOf(when, t0);
      const offset = day ? daysBetween(t0, day) : undefined;
      const status = cellAt(r, s);
      return { when, what: cellAt(r, Math.max(0, w)), status, ...(day ? { date: isoDay(day), offset } : {}), tone: statusTone(status, offset), ...(cellAt(r, o) ? { owner: cellAt(r, o) } : {}), row };
    })
    .filter((x) => x.what)
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  // A table with nothing dated has nothing to put on a timeline.
  return { type: 'timeline', title: cap(heading), section: heading, source: 'section', items, empty: !items.some((x) => x.date), add: { kind: 'row', section: heading, head: table.head }, cols: { date: d, what: Math.max(0, w), status: s, owner: o } };
}

const DONEISH = /done|live|won|lost|closed|complete|launched|sent|shipped|cancel|exclud|reject|dropped|declined|archived/i;

function boardBlock(p: Project, t0: Date, arg?: string): BoardBlock {
  const section = arg ?? findSection(p, (t) => !!t && column(t, /^stage$/i) >= 0) ?? findSection(p, (t) => !!t && column(t, STAGE_COL) >= 0) ?? 'Pipeline';
  const { table, heading, source } = tableOf(p, section);
  const head = SECTION_TABLES[cap(section)] ?? SECTION_TABLES.Pipeline;
  if (!table || !table.rows.length) return { type: 'board', title: cap(heading), section: heading, source, columns: [], empty: true, add: { kind: 'row', section: heading, head: table?.head.length ? table.head : head } };
  const s = Math.max(0, column(table, /^stage$/i) >= 0 ? column(table, /^stage$/i) : column(table, STAGE_COL));
  const d = column(table, DATE_COL);
  const o = column(table, /^(owner|who|lead)$/i);
  const n = column(table, /^notes?$/i);
  const w = table.head.findIndex((_, i) => i !== s && i !== d && i !== o && i !== n);
  const columns: BoardBlock['columns'] = [];
  table.rows.forEach((r, row) => {
    const title = cellAt(r, Math.max(0, w));
    if (!title) return;
    const stage = cellAt(r, s) || 'No stage';
    const due = cellAt(r, d);
    const day = blank(due) ? null : dayOf(due, t0);
    const card = { title, owner: cellAt(r, o), due: blank(due) ? '' : due, ...(day ? { date: isoDay(day) } : {}), overdue: !!day && day < t0 && !DONEISH.test(stage), notes: cellAt(r, n), row };
    const col = columns.find((c) => norm(c.stage) === norm(stage));
    if (col) col.items.push(card);
    else columns.push({ stage: cap(stage), value: cellAt(r, s), items: [card] });
  });
  // Finished columns go last, so the board reads left to right as the work moves.
  columns.sort((a, b) => Number(DONEISH.test(a.stage)) - Number(DONEISH.test(b.stage)));
  return { type: 'board', title: cap(heading), section: heading, source, columns, empty: false, add: { kind: 'row', section: heading, head: table.head }, head: table.head, cols: { title: Math.max(0, w), stage: s, owner: o, due: d, notes: n } };
}

function gridBlock(p: Project, props: Record<string, unknown>, arg?: string): GridBlock {
  const section =
    arg ??
    (p.extra.some((x) => norm(x.heading) === 'register') ? 'Register' : undefined) ??
    p.extra
      .map((x) => ({ h: x.heading, n: readTable(x.body)?.rows.length ?? 0 }))
      .sort((a, b) => b.n - a.n)
      .find((x) => x.n > 0)?.h ??
    'Register';
  const { table, heading, source } = tableOf(p, section);
  const of = text(propOf(props, 'register_of')) || undefined;
  const head = SECTION_TABLES[cap(section)] ?? SECTION_TABLES.Register;
  if (!table || !table.rows.length) return { type: 'grid', title: cap(heading), section: heading, source, table: table ?? { head: [], rows: [] }, statusCol: -1, byStatus: [], totals: [], empty: true, add: { kind: 'row', section: heading, head: table?.head.length ? table.head : head }, ...(of ? { of } : {}) };
  const statusCol = column(table, STAGE_COL);
  const totals: GridBlock['totals'] = [];
  table.head.forEach((h, col) => {
    if (!QTY_COL.test(h.trim())) return;
    const nums = table.rows.map((r) => numberIn(cellAt(r, col).replace(/^[A-Z]{0,3}\$/, ''), true)).filter((x): x is number => x !== undefined);
    if (nums.length) totals.push({ col, label: h.trim(), sum: Math.round(nums.reduce((a, x) => a + x, 0) * 100) / 100 });
  });
  // A count of things (not money or hours): each row holds that many of what the register is of.
  const units = totals.find((x) => UNITS_COL.test(table.head[x.col].trim()));
  const qtyOf = (r: string[]) => (units ? (numberIn(cellAt(r, units.col), true) ?? 0) : 1);
  const groups = new Map<string, { status: string; count: number; qty?: number }>();
  if (statusCol >= 0)
    for (const r of table.rows) {
      const st = cellAt(r, statusCol) || 'No status';
      const g = groups.get(st.toLowerCase()) ?? { status: cap(st), count: 0, ...(units ? { qty: 0 } : {}) };
      g.count++;
      if (units) g.qty! += qtyOf(r);
      groups.set(st.toLowerCase(), g);
    }
  return { type: 'grid', title: cap(heading), section: heading, source, table, statusCol, byStatus: [...groups.values()].sort((a, b) => (b.qty ?? b.count) - (a.qty ?? a.count)), totals, ...(units ? { units } : {}), empty: false, add: { kind: 'row', section: heading, head: table.head }, ...(of ? { of } : {}) };
}

/**
 * A field's kind from everything written under it: yes/no when it has been answered yes or no (a "not confirmed" on one
 * day doesn't make it words), a number when it is charted (`fields:`) or has been a number, else words.
 */
function kindOf(logs: LogNote[], name: string): EntryField['kind'] {
  const want = norm(name);
  let yes = 0;
  let num = 0;
  for (const e of entriesOf(logs))
    for (const [k, v] of Object.entries(e.values))
      if (norm(k) === want) {
        if (v.kind === 'yes') yes++;
        else if (v.kind === 'number') num++;
      }
  if (yes && yes >= num) return 'yes';
  if (num || logs.some((l) => l.fields.some((f) => norm(f) === want))) return 'number';
  return 'text';
}

/** The fields a project's logs keep, each with its kind (from the values written) and unit: what an entry form asks. */
export function logFields(logs: LogNote[]): EntryField[] {
  const out = new Map<string, EntryField>();
  const add = (name: string) => {
    if (!out.has(norm(name))) out.set(norm(name), { name, kind: kindOf(logs, name), unit: unitOf(logs, name) });
  };
  for (const l of logs) for (const f of [...(l.declared ?? []), ...l.fields]) add(f);
  for (const e of entriesOf(logs)) for (const k of Object.keys(e.values)) add(k);
  return [...out.values()];
}

/**
 * The fields one log's entries are written with, for its form: the ones its format shows (with `fields:`), else the ones
 * it charts and the others its entries keep, leaving out a "Plan: …" written once as a sentence.
 */
export function formFields(log: LogNote): EntryField[] {
  const declared = log.declared ?? [];
  const seen = new Map<string, { name: string; times: number; long: number }>();
  for (const e of log.entries)
    for (const [k, v] of Object.entries(e.values)) {
      const x = seen.get(norm(k)) ?? { name: k, times: 0, long: 0 };
      x.times++;
      if (v.kind === 'text' && v.text.length > 60) x.long++;
      seen.set(norm(k), x);
    }
  const kept = [...seen.values()].filter((x) => x.long < x.times || x.times > 1).map((x) => x.name);
  const names = declared.length ? declared : [...log.fields, ...kept.filter((k) => !log.fields.some((f) => norm(f) === norm(k)))];
  return names.map((name) => ({ name, kind: kindOf([log], name), unit: unitOf([log], name) }));
}
function unitOf(logs: LogNote[], field: string): string {
  for (const l of logs) for (const [k, v] of Object.entries(l.units)) if (norm(k) === norm(field)) return v;
  // A unit written after the number ("104.2 kg") when the log names none.
  for (const e of entriesOf(logs).reverse()) {
    const v = Object.entries(e.values).find(([k]) => norm(k) === norm(field))?.[1];
    const u = v?.kind === 'number' ? /^-?[\d.,]+\s*([A-Za-z%°]{1,6})\s*$/.exec(v.text)?.[1] : undefined;
    if (u) return u;
  }
  return '';
}

function trendBlock(logs: LogNote[], props: Record<string, unknown>, t0: Date, arg?: string): TrendBlock {
  const fields = logFields(logs).filter((f) => f.kind === 'number');
  const named = logs.some((l) => l.fields.length) ? fields.filter((f) => logs.some((l) => l.fields.some((x) => norm(x) === norm(f.name)))) : fields;
  const chosen = arg ? [fields.find((f) => norm(f.name) === norm(arg)) ?? { name: arg, kind: 'number' as const, unit: '' }] : named.length ? named : fields;
  const from = dayOf(propOf(props, 'start') ?? propOf(props, 'started'), t0);
  const to = dayOf(propOf(props, 'end') ?? propOf(props, 'due'), t0);
  const list: TrendSeries[] = chosen
    .map((f) => {
      const points = series(logs, f.name);
      const start = numberIn(propOf(props, `start_${keyName(f.name)}`), true);
      const target = numberIn(propOf(props, `target_${keyName(f.name)}`), true);
      return {
        field: f.name,
        unit: f.unit,
        points,
        ...(points.length ? { latest: points[points.length - 1].n, first: points[0].n } : {}),
        ...(start ?? points[0]?.n) !== undefined ? { start: start ?? points[0]?.n } : {},
        ...(target !== undefined ? { target } : {}),
        ...(from ? { from: isoDay(from) } : {}),
        ...(to ? { to: isoDay(to) } : {}),
      };
    })
    .filter((s) => s.points.length || s.target !== undefined)
    // The measure the project gives a start or a target for (start_weight, target_weight) is the one it's about: first.
    .map((s, i) => ({ s, i, own: numberIn(propOf(props, `start_${keyName(s.field)}`), true) !== undefined || s.target !== undefined }))
    .sort((a, c) => Number(c.own) - Number(a.own) || a.i - c.i)
    .map(({ s }) => s);
  return { type: 'trend', title: list.length === 1 ? list[0].field : 'Trends', series: list, empty: !list.length, add: { kind: 'entry' } };
}

function streakBlock(logs: LogNote[], props: Record<string, unknown>, t0: Date, arg?: string): StreakBlock {
  const label0 = text(propOf(props, 'streak_label'));
  const entries = entriesOf(logs);
  const yesFields = logFields(logs).filter((f) => f.kind === 'yes').map((f) => f.name);
  const field = arg ? yesFields.find((f) => norm(f) === norm(arg)) ?? arg : (label0 && (yesFields.find((f) => norm(f) === norm(label0)) ?? yesFields.find((f) => norm(label0).includes(norm(f)) || norm(f).includes(norm(label0))))) || yesFields[0];
  const label = label0 || field || 'Streak';
  const start = dayOf(propOf(props, 'streak_start'), t0);
  const day = start ? daysBetween(start, t0) + 1 : undefined;
  const yesOn = (iso: string): boolean | undefined => {
    const e = entries.find((x) => x.date === iso);
    const v = field && e ? Object.entries(e.values).find(([k]) => norm(k) === norm(field))?.[1] : undefined;
    return v?.kind === 'yes' ? v.yes : undefined;
  };
  const grid = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(t0, i - 13);
    const iso = isoDay(d);
    const y = yesOn(iso);
    return { date: iso, state: (y === true ? 'yes' : y === false ? 'no' : start && d < start ? 'before' : 'none') as StreakBlock['grid'][number]['state'] };
  });
  // The run up to today (today not written yet: up to yesterday), and the best run in the log.
  let run = 0;
  for (let i = yesOn(isoDay(t0)) === undefined ? 1 : 0; i < 3660; i++) {
    if (yesOn(isoDay(addDays(t0, -i))) !== true) break;
    run++;
  }
  let best = 0;
  let cur = 0;
  let prev = '';
  for (const e of entries) {
    const v = field ? Object.entries(e.values).find(([k]) => norm(k) === norm(field))?.[1] : undefined;
    const yes = v?.kind === 'yes' && v.yes;
    const follows = prev && isoDay(addDays(readDay(prev, t0)!, 1)) === e.date;
    cur = yes ? (follows && cur ? cur + 1 : 1) : 0;
    best = Math.max(best, cur);
    prev = e.date;
  }
  const marks = listOf(propOf(props, 'milestones'))
    .map((m) => numberIn(m, true))
    .filter((m): m is number => m !== undefined && m > 0)
    .sort((a, c) => a - c);
  const count = day ?? run;
  const ms = marks.map((m) => ({ days: m, date: start ? isoDay(addDays(start, m - 1)) : '', reached: count >= m }));
  const nextMark = marks.find((m) => m > count);
  const from = [...marks].reverse().find((m) => m <= count) ?? 0;
  // How often this week, from a `<things>_per_week` key.
  let week: StreakBlock['week'];
  const perKey = Object.keys(props).find((k) => /_per_week$/i.test(k));
  const of = perKey ? numberIn(props[perKey], true) : undefined;
  if (perKey && of) {
    const thing = perKey.replace(/_per_week$/i, '');
    const one = norm(thing).replace(/s$/, '');
    const fieldsSeen = logFields(logs).map((f) => f.name);
    const match = fieldsSeen.find((f) => norm(f).startsWith(one) || one.startsWith(norm(f)));
    const counts = (e: LogEntry) => {
      if (!match) return true;
      const v = Object.entries(e.values).find(([k]) => norm(k) === norm(match))?.[1];
      if (!v) return false;
      return v.kind === 'yes' ? v.yes : !/^(rest|none|nil|no|not|skipped|missed|cancelled|—|-|0)\b/i.test(v.text.trim()) && !/^[—–-]$/.test(v.text.trim());
    };
    const monday = addDays(t0, -((t0.getDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, i) => {
      const iso = isoDay(addDays(monday, i));
      return entries.some((e) => e.date === iso && counts(e));
    });
    week = { label: keyLabel(thing).toLowerCase(), count: days.filter(Boolean).length, of, days };
  }
  const isEmpty = !field && day === undefined && !week;
  return {
    type: 'streak',
    title: field || label0 ? 'Streak' : 'This week',
    ...(field ? { field } : {}),
    label,
    ...(day !== undefined ? { day } : {}),
    ...(start ? { start: isoDay(start) } : {}),
    run,
    best,
    grid,
    milestones: ms,
    ...(nextMark !== undefined ? { next: { days: nextMark, left: nextMark - count, from } } : {}),
    ...(week ? { week } : {}),
    empty: isEmpty,
    add: { kind: 'entry' },
  };
}

function entryBlock(logs: LogNote[]): EntryBlock {
  const entries = entriesOf(logs);
  const last = (l: LogNote) => l.entries[l.entries.length - 1]?.date ?? '';
  const own = logs
    .filter((l) => l.path)
    .map((l) => ({ l, fields: formFields(l) }))
    .sort((a, b) => last(b.l).localeCompare(last(a.l)) || b.fields.length - a.fields.length);
  return {
    type: 'entry',
    title: 'Latest entry',
    logs: own.map(({ l, fields }) => ({ path: l.path!, title: l.title ?? l.path!.split('/').pop()!.replace(/\.md$/i, ''), fields })),
    fields: logFields(logs),
    ...(entries.length ? { latest: entries[entries.length - 1] } : {}),
    entries: entries.length,
    empty: !entries.length,
    add: { kind: 'entry' },
  };
}

function cardsBlock(p: Project, arg?: string): CardsBlock {
  const section = arg ?? findSection(p, (t) => !!t && column(t, /^name$/i) >= 0 && column(t, /^(contact|email|phone|role|company)$/i) >= 0) ?? (p.people.length ? 'People' : 'Suppliers and contacts');
  const { table, heading, source } = tableOf(p, section);
  const head = SECTION_TABLES[cap(section)] ?? SECTION_TABLES['Suppliers and contacts'];
  if (!table || !table.rows.length) return { type: 'cards', title: cap(heading), section: heading, cards: [], source, empty: true, add: source === 'people' ? { kind: 'row', section: 'Suppliers and contacts', head } : { kind: 'row', section: heading, head: table?.head.length ? table.head : head } };
  const [n, r, c, k] = [Math.max(0, column(table, /^(name|who|person|supplier)$/i)), column(table, /^(role|what|does)$/i), column(table, /^(company|business|org|organisation|organization|supplier)$/i), column(table, /^(contact|phone|email|mobile|details)$/i)];
  const cards = table.rows.map((row, i) => ({ name: cellAt(row, n), role: cellAt(row, r), company: c === n ? '' : cellAt(row, c), contact: cellAt(row, k), row: i })).filter((x) => x.name);
  return { type: 'cards', title: cap(heading), section: heading, cards, source, cols: { name: n, role: r, company: c === n ? -1 : c, contact: k }, empty: !cards.length, ...(source === 'section' ? { add: { kind: 'row', section: heading, head: table.head } as BlockAdd } : {}) };
}

function actionsBlock(p: Project): ActionsBlock {
  const items = p.next.map((x, index) => ({ x, index })).filter(({ x }) => !x.done);
  return { type: 'actions', title: 'Next actions', items: items.slice(0, 5).map(({ x, index }) => ({ what: x.what, ...(x.who ? { who: x.who } : {}), ...(x.when ? { when: x.when } : {}), index })), open: items.length, empty: !items.length, add: { kind: 'next' } };
}

/** What one block shows, worked out from the project, its properties and its logs. */
export function blockModel(spec: BlockSpec, { project: p, props, logs, today }: LayoutInput): BlockModel {
  const t0 = startOfDay(today);
  switch (spec.type) {
    case 'status':
      return statusBlock(p, props, t0);
    case 'countdown':
      return countdownBlock(p, props, t0, spec.arg);
    case 'progress':
      return progressBlock(p, props, spec.arg);
    case 'timeline':
      return timelineBlock(p, t0, spec.arg);
    case 'board':
      return boardBlock(p, t0, spec.arg);
    case 'grid':
      return gridBlock(p, props, spec.arg);
    case 'trend':
      return trendBlock(logs, props, t0, spec.arg);
    case 'streak':
      return streakBlock(logs, props, t0, spec.arg);
    case 'entry':
      return entryBlock(logs);
    case 'cards':
      return cardsBlock(p, spec.arg);
    case 'actions':
      return actionsBlock(p);
  }
}

/** Each block of a project's layout or own blocks, worked out (a preset's block finding its section when it's named differently). */
function blockModels(input: LayoutInput): { specs: BlockSpec[]; own: boolean; all: BlockModel[] } {
  const specs = blocksOf(input.props);
  const own = parseBlocks(input.props.blocks).length > 0;
  // A preset's section names are where it looks first, not demands: a project without that section (a venture with its
  // stages in Campaigns, no Pipeline) gets the block from what it has instead (the first table that suits it).
  const has = (name: string) => tableOf(input.project, name).table !== null || !!sectionText(input.project, name).trim();
  const all = specs.map((s) => {
    const m = blockModel(s, input);
    if (own || !m.empty || !s.arg || has(s.arg) || !['board', 'timeline', 'progress'].includes(s.type)) return m;
    const found = blockModel({ type: s.type }, input);
    return found.empty ? m : found;
  });
  return { specs, own, all };
}

/** Every block a project shows, in order (a block that reads nothing in a preset is left out unless it's the only one). */
export function dashboard(input: LayoutInput): BlockModel[] {
  const { specs, own, all } = blockModels(input);
  // A date a countdown shows (and the start its "Week 3 of 8" counts from) isn't repeated as a fact in the status band.
  const counted = new Set<string>();
  for (const m of all) if (m.type === 'countdown' && !m.empty) for (const k of [m.key, ...(m.period ? ['start', 'started', 'end'] : [])]) counted.add(keyName(k));
  for (const m of all) if (m.type === 'status') m.facts = m.facts.filter((f) => !counted.has(keyName(f.key)));
  // A preset's optional parts (a plan table, contacts, a streak in a tracker without yes/no fields) step aside when
  // empty, once the project has something else to show; the person's own `blocks:` always show.
  if (own) return all;
  const OPTIONAL = new Set<BlockType>(['grid', 'cards', 'streak', 'actions', 'timeline', 'board', 'trend', 'entry']);
  const shown = all.filter((m, i) => !m.empty || !OPTIONAL.has(specs[i].type) || (specs[i].type === 'grid' && specs.length === 1));
  return shown.length ? shown : all;
}

// ── The one-liner (Projects home, Today) ─────────────────────────────────────────────────────────────────────────────

export interface LayoutLine {
  words: string;
  tone: 'ok' | 'warn' | 'bad' | 'none';
}

/** A project's one line for lists, from its first block that has something to say: "47 days to opening", "Day 4
 *  alcohol-free", "95% · at risk", "Week 3 of 8 · 104.2 kg". Null without a layout or blocks. */
export function layoutLine(input: LayoutInput): LayoutLine | null {
  const models = blockModels(input).all;
  if (!models.length) return null;
  const say = (m: BlockModel): LayoutLine | null => {
    switch (m.type) {
      case 'status': {
        // Health says something next to progress, or when it isn't on track; else a stage on its path.
        const tone = healthTone(m.health);
        // A health said alone ("at risk") says more with where the work is: its phase or stage, when short.
        const phase = m.facts.find((f) => /^(phase|stage)$/i.test(f.key) && f.value.length <= 48)?.value;
        const health = m.health && (m.progress !== undefined || tone === 'warn' || tone === 'bad') ? m.health.toLowerCase() : '';
        const parts = [m.progress !== undefined ? `${m.progress}%` : '', health, m.progress === undefined && m.steps ? m.steps.names[m.steps.current] : m.progress === undefined && health && phase ? phase : ''].filter(Boolean);
        return parts.length ? { words: parts.join(' · '), tone: healthTone(m.health) } : null;
      }
      case 'countdown':
        if (m.empty) return null;
        if (m.period?.week === 0 && m.days !== undefined && m.days > 0) return { words: `Starts in ${daysWords(m.days)}`, tone: 'none' };
        return m.period && m.days !== undefined && m.days > 0 && m.what === 'the end' ? { words: `Week ${m.period.week} of ${m.period.weeks}`, tone: 'none' } : { words: m.words.charAt(0).toUpperCase() + m.words.slice(1), tone: m.tone };
      case 'streak':
        if (m.day !== undefined && m.day >= 1) return { words: `Day ${m.day} ${lowerFirst(m.label)}`, tone: 'ok' };
        if (m.field && m.run) return { words: `${plural(m.run, 'day')} ${lowerFirst(m.label)} in a row`, tone: 'ok' };
        // A run that has ended: where it stands, and the best so far.
        if (m.field && m.best) return { words: `0 days ${lowerFirst(m.label)} · best ${m.best}`, tone: 'warn' };
        if (m.week) return { words: `${m.week.count} of ${m.week.of} ${m.week.label} this week`, tone: m.week.count >= m.week.of ? 'ok' : 'none' };
        return null;
      case 'grid': {
        // With a quantity column, how many of the thing in all (a row is several); else the rows.
        const n = m.units ? m.units.sum : m.table.rows.length;
        if (!m.table.rows.length) return null;
        const words = [`${n} ${m.of ? pluralNoun(m.of, n) : m.units ? (n === 1 ? 'item' : 'items') : n === 1 ? 'row' : 'rows'}`];
        const attention = m.byStatus.find((s) => /repair|fault|missing|lost|broken|overdue|low|out|late|blocked|need|untested|damaged|expired/i.test(s.status));
        if (attention) words.push(`${attention.qty ?? attention.count} ${attention.status.toLowerCase()}`);
        else if (m.totals.find((t) => t !== m.units)) {
          const t = m.totals.find((x) => x !== m.units)!;
          words.push(`${t.sum} ${t.label.toLowerCase()}`);
        }
        return { words: words.join(' · '), tone: attention ? 'warn' : 'none' };
      }
      case 'board': {
        const open = m.columns.filter((c) => !DONEISH.test(c.stage)).reduce((a, c) => a + c.items.length, 0);
        const overdue = m.columns.reduce((a, c) => a + c.items.filter((x) => x.overdue).length, 0);
        if (!open && !overdue) return null;
        return { words: [`${open} open in ${m.title.toLowerCase()}`, overdue ? `${overdue} overdue` : ''].filter(Boolean).join(' · '), tone: overdue ? 'warn' : 'none' };
      }
      case 'progress':
        if (m.mode === 'table' && m.overall === undefined && m.total) return { words: `${m.done} of ${m.total} ${m.title.toLowerCase()} done`, tone: 'none' };
        return m.overall !== undefined && m.mode !== 'next' ? { words: m.mode === 'phases' ? `${m.done} of ${m.total} done` : `${m.overall}% across ${m.title.toLowerCase()}`, tone: 'none' } : null;
      case 'trend': {
        const s = m.series.find((x) => x.latest !== undefined);
        // "88.2 kg", or a score with its scale and name: "Cravings 2/10".
        return s ? { words: /^\//.test(s.unit) ? `${s.field} ${s.latest}${s.unit}` : `${s.latest} ${s.unit || s.field.toLowerCase()}`, tone: 'none' } : null;
      }
      default:
        return null;
    }
  };
  const lines = models.map(say);
  const first = lines.findIndex(Boolean);
  if (first < 0) return null;
  const line = lines[first]!;
  // "Week 3 of 8" says more with where the numbers are.
  const trend = models.findIndex((m, i) => i > first && m.type === 'trend' && lines[i]);
  if (/^(Week \d+ of \d+|Starts in .+)$/.test(line.words) && trend > 0) return { words: `${line.words} · ${lines[trend]!.words}`, tone: line.tone };
  // A stage alone says more with what's moving on the board.
  const board = models.findIndex((m, i) => i > first && m.type === 'board' && lines[i]);
  if (models[first].type === 'status' && !/%/.test(line.words) && board > 0) return { words: `${line.words} · ${lines[board]!.words}`, tone: lines[board]!.tone === 'warn' ? 'warn' : line.tone };
  return line;
}

// ── Suggesting a layout for a project without one (from its structure, never its topic) ──────────────────────────────

export interface LayoutSuggestion {
  layout: LayoutId;
  /** Why, from what the file has: "This project has a go-live date and a run sheet". */
  why: string;
  score: number;
}

export function suggestLayout(p: Project, props: Record<string, unknown> = {}, logs: LogNote[] = []): LayoutSuggestion | null {
  if (layoutOf(props) || parseBlocks(props.blocks).length) return null;
  const tables = p.extra.filter((x) => !HUB_SECTION.test(x.heading.trim())).map((x) => ({ h: x.heading, t: readTable(x.body), body: x.body }));
  const fields = logFields(logs);
  const has = (k: string) => propOf(props, k) !== undefined && text(propOf(props, k)) !== '' && !(k === 'stage' && LIFECYCLE.test(text(propOf(props, k))));
  const scores: [LayoutId, number, string][] = [];
  // A date to count to and phases to work through.
  const phased = tables.find((x) => runSheet(x.body).length >= 2);
  scores.push(['site', (has('go_live') ? 0.6 : 0) + (phased ? 0.45 : 0) + (has('site_kind') ? 0.2 : 0), has('go_live') && phased ? 'This project has a go-live date and a run sheet in phases' : has('go_live') ? 'This project has a go-live date' : 'This project has a checklist in phases']);
  // Workstreams: a table with progress per row.
  const streams = tables.find((x) => x.t && x.t.rows.length >= 2 && column(x.t, PROGRESS_COL) >= 0);
  scores.push(['programme', (streams ? 0.65 : 0) + (has('sponsor') || has('budget') ? 0.2 : 0) + (p.dates.length >= 4 ? 0.1 : 0), streams ? `This project tracks progress for each row of ${streams.h}` : 'This project has a sponsor and a budget']);
  // A table with stages: a board.
  const staged = tables.find((x) => x.t && x.t.rows.length >= 2 && column(x.t, /^stage$/i) >= 0);
  scores.push(['venture', (staged ? 0.6 : 0) + (has('stage') ? 0.25 : 0), staged ? `${staged.h} has a Stage for each row` : 'This project has a stage']);
  // A long list with a status or quantity: a register.
  const long = tables.find((x) => x.t && x.t.rows.length >= 8 && (column(x.t, STAGE_COL) >= 0 || column(x.t, QTY_COL) >= 0));
  scores.push(['register', (long ? 0.6 : 0) + (has('register_of') ? 0.3 : 0), long ? `${long.h} is a long list with ${column(long.t, QTY_COL) >= 0 ? 'quantities' : 'a status'} for each row` : 'This project is a register']);
  // Logs: yes/no days make a habit; numbers make a tracker.
  const yes = fields.filter((f) => f.kind === 'yes').length;
  const nums = fields.filter((f) => f.kind === 'number').length;
  const targets = Object.keys(props).some((k) => /^target_/i.test(k));
  const entries = entriesOf(logs);
  const daily = yes > 0 && entries.length >= 2 && entries.every((e) => Object.values(e.values).some((v) => v.kind === 'yes'));
  scores.push(['wellbeing', (has('streak_start') ? 0.6 : 0) + (yes ? 0.55 : 0) + (daily ? 0.15 : 0), yes ? 'This project’s log has yes/no days' : 'This project has a streak start']);
  scores.push(['fitness', (nums ? 0.5 : 0) + (targets ? 0.25 : 0) + (nums && !yes ? 0.05 : 0) + (has('start') && has('end') && nums ? 0.1 : 0), nums ? 'This project’s log has numbers to chart' : 'This project has targets']);
  const sorted = scores.sort((a, c) => c[1] - a[1]);
  const best = sorted[0];
  if (!best || best[1] < 0.5) return null;
  // Too close to call: no suggestion (a wrong nudge is worse than none).
  if (sorted[1] && sorted[1][1] >= 0.5 && best[1] - sorted[1][1] < 0.1) return null;
  return { layout: best[0], why: best[2], score: Math.min(1, best[1]) };
}

// ── Contract-correct Markdown for the empty states ───────────────────────────────────────────────────────────────────

/** The table each layout section starts with (exact contract headers). */
export const SECTION_TABLES: Record<string, string[]> = {
  Workstreams: ['Workstream', 'Owner', 'Status', 'Progress', 'Next step'],
  'Suppliers and contacts': ['Name', 'Role', 'Company', 'Contact'],
  Pipeline: ['Item', 'Stage', 'Owner', 'Due', 'Notes'],
  Campaigns: ['Item', 'Stage', 'Owner', 'Due', 'Notes'],
  Plan: ['Day', 'Session'],
  Register: ['Item', 'Status', 'Qty', 'Notes'],
};

/** A section's words with a run-sheet phase added (### Name, with its first tick box). */
export function addRunSheetPhase(body: string, phase: string, first = 'First thing to do'): string {
  const b = String(body ?? '').replace(/\s+$/, '');
  return `${b ? `${b}\n\n` : ''}### ${phase.trim() || 'New phase'}\n\n- [ ] ${first.trim() || 'First thing to do'}`;
}

/** A section's words with a tick box added under a phase (made when missing). */
export function addRunSheetItem(body: string, phase: string, what: string): string {
  const lines = String(body ?? '').replace(/\s+$/, '').split(/\r?\n/);
  const at = lines.findIndex((l) => /^###\s+/.test(l) && norm(l.replace(/^###\s+/, '')) === norm(phase));
  if (at < 0) return addRunSheetPhase(lines.join('\n'), phase, what);
  let end = lines.findIndex((l, i) => i > at && /^#{1,3}\s/.test(l));
  if (end < 0) end = lines.length;
  let last = at;
  for (let i = at + 1; i < end; i++) if (lines[i].trim()) last = i;
  lines.splice(last + 1, 0, ...(last === at ? ['', `- [ ] ${what.trim()}`] : [`- [ ] ${what.trim()}`]));
  return lines.join('\n');
}

// ── Editing in place (22 Oct 2026): one cell, one line, one value — every other character kept ──────────────────────
// on the dashboards. Each helper changes only what was changed (a table's cell, a tick box's line, a log's field) and
// keeps the rest of the words byte for byte, so the person's file reads exactly as they wrote it apart from the edit.

/** A table's line: it starts with a pipe and holds another (its closing pipe may be missing, as hand-written tables
 *  often leave it off; a lone "| words" line is prose, not a row). */
const TABLE_LINE = /^\s*\|[^|\r\n]*\|/;
const eolOf = (s: string) => (s.includes('\r\n') ? '\r\n' : '\n');

/** The line (in the words, from 0) of each row readTable reads from them, in the same order. */
export function tableRowLines(body: string): number[] {
  const lines = String(body ?? '').split(/\r?\n/);
  let i = lines.findIndex((l) => TABLE_LINE.test(l));
  if (i < 0) return [];
  const block: { cells: string[]; line: number }[] = [];
  for (; i < lines.length && TABLE_LINE.test(lines[i]); i++) block.push({ cells: splitRow(lines[i]), line: i });
  const rows = block.length >= 2 && isRule(block[1].cells) ? block.slice(2) : block;
  return rows.filter((r) => !isRule(r.cells) && r.cells.some((c) => c)).map((r) => r.line);
}

/** Where each cell of a table line sits: between one unescaped pipe and the next. */
function cellSpans(line: string): { start: number; end: number }[] {
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i++) if (line[i] === '|' && line[i - 1] !== '\\') pipes.push(i);
  const out: { start: number; end: number }[] = [];
  for (let k = 0; k + 1 < pipes.length; k++) out.push({ start: pipes[k] + 1, end: pipes[k + 1] });
  return out;
}

/** A table line with one cell's words changed, its padding kept (a cell left empty is written "| |"). */
function withCell(line: string, col: number, value: string): string {
  let l = line;
  let spans = cellSpans(l);
  // A short row (fewer cells than the header) gets empty cells up to the one being set.
  while (spans.length <= col && spans.length < 64) {
    l = `${l.replace(/\s+$/, '')}  |`;
    spans = cellSpans(l);
  }
  const s = spans[col];
  if (!s) return line;
  const seg = l.slice(s.start, s.end);
  const words = cellText(value);
  const lead = seg.trim() ? /^\s*/.exec(seg)![0] || ' ' : ' ';
  const trail = seg.trim() ? /\s*$/.exec(seg)![0] || ' ' : ' ';
  return l.slice(0, s.start) + (words ? `${lead}${words}${trail}` : ' ') + l.slice(s.end);
}

/** One table line with one cell's words changed (Reading's tables, 4 Nov 2026: the cell
 *  as shown maps to its source line, column from 0): padding kept, pipes escaped,
 *  a short row grown to the column, anything else left as it was. */
export function setTableLineCell(line: string, col: number, value: string): string {
  if (col < 0 || !TABLE_LINE.test(line)) return line;
  return withCell(line, col, value);
}

/** One table line's cell as written (Reading's tables edit the source, links and
 *  all): trimmed, pipes unescaped, null past its last cell or off a table line. */
export function tableLineCell(line: string, col: number): string | null {
  if (col < 0 || !TABLE_LINE.test(line)) return null;
  const spans = cellSpans(line);
  const s = spans[col];
  if (!s) return null;
  return line.slice(s.start, s.end).replace(/\\\|/g, '|').trim();
}

/** Some words with one cell of their first table changed (row as readTable counts them, column from 0). */
export function setTableCell(body: string, row: number, col: number, value: string): string {
  return setTableCells(body, row, { [col]: value });
}

/** Some words with several cells of one row of their first table changed: { column: words }. */
export function setTableCells(body: string, row: number, values: Record<number, string>): string {
  const src = String(body ?? '');
  const at = tableRowLines(src)[row];
  if (at === undefined) return src;
  const lines = src.split(/\r?\n/);
  let line = lines[at];
  for (const [col, v] of Object.entries(values)) if (Number(col) >= 0) line = withCell(line, Number(col), v ?? '');
  if (line === lines[at]) return src;
  lines[at] = line;
  return lines.join(eolOf(src));
}

/** Some words with one row of their first table taken out. */
export function removeTableRow(body: string, row: number): string {
  const src = String(body ?? '');
  const at = tableRowLines(src)[row];
  if (at === undefined) return src;
  const lines = src.split(/\r?\n/);
  lines.splice(at, 1);
  return lines.join(eolOf(src));
}

/** Some words with their first table's rows put in a new order (`order[i]` is the row that goes i-th); lines between them stay put. */
export function orderTableRows(body: string, order: number[]): string {
  const src = String(body ?? '');
  const at = tableRowLines(src);
  if (order.length !== at.length || [...order].sort((a, b) => a - b).some((x, i) => x !== i)) return src;
  const lines = src.split(/\r?\n/);
  const rows = at.map((l) => lines[l]);
  at.forEach((l, i) => (lines[l] = rows[order[i]]));
  return lines.join(eolOf(src));
}

/** Some words with one row of their first table moved to another row's place. */
export function moveTableRow(body: string, from: number, to: number): string {
  const n = tableRowLines(body).length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return String(body ?? '');
  const order = Array.from({ length: n }, (_, i) => i);
  order.splice(to, 0, ...order.splice(from, 1));
  return orderTableRows(body, order);
}

/** A day as the words around it write days: ISO ("2026-11-30") when they do, else "30 Nov 2026". */
export function dayInStyle(iso: string, like: string[]): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const filled = like.map((x) => x.trim()).filter((x) => x && !blank(x));
  if (filled.length && filled.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) return iso;
  if (filled.length && filled.some((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)) && !filled.some((x) => /^\d{1,2}\s+[A-Za-z]{3}/.test(x))) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** A tick box's (or a next step's) words and what follows its dash: "Book the van — Ana · by 2026-11-30". */
export interface ItemParts {
  what: string;
  who: string;
  when: string;
  /** The day was written with its lead word ("by …", "due …": written back "by …"). */
  by: boolean;
}
type TailPart = { kind: 'who' | 'when' | 'other'; text: string; by?: boolean };
function tailParts(tail: string): TailPart[] {
  const out: TailPart[] = [];
  // "— Who — due when", "— Who, due when": the date part is when, never a person (p16-owner-tail, 4 Nov 2026); a
  // second dash or a comma only splits before by/due, so a real name with a hyphen or a dash inside stays whole.
  const segments = tail
    .split(/\s+·\s+/)
    .flatMap((seg) => seg.split(/\s+[—–]\s+(?=(?:by|due)\s+)/i))
    .flatMap((seg) => seg.split(/,\s*(?=(?:by|due)\s+)/i));
  for (const raw of segments) {
    const part = raw.trim();
    if (!part) continue;
    const by = /^(?:by|due)\s+(.+)$/i.exec(part);
    if (by && !out.some((x) => x.kind === 'when')) out.push({ kind: 'when', text: by[1].trim(), by: true });
    else if (!out.some((x) => x.kind === 'when') && /\d/.test(part) && readDay(part, new Date()) && part.length <= 24) out.push({ kind: 'when', text: part, by: false });
    else if (!out.some((x) => x.kind === 'who')) out.push({ kind: 'who', text: part });
    else out.push({ kind: 'other', text: part });
  }
  return out;
}
export function itemParts(text: string): ItemParts {
  const t = String(text ?? '');
  const m = /\s+[—–]\s+(.+)$/.exec(t);
  if (!m) return { what: t.trim(), who: '', when: '', by: false };
  const parts = tailParts(m[1]);
  const when = parts.find((x) => x.kind === 'when');
  return { what: t.slice(0, m.index).trim(), who: parts.filter((x) => x.kind !== 'when').map((x) => x.text).join(' · '), when: when?.text ?? '', by: !!when?.by };
}
/** A tick box's words with its words, who or when changed; the rest of what follows its dash kept as written. */
export function withItemParts(text: string, change: { what?: string; who?: string; when?: string }): string {
  const t = String(text ?? '');
  const tidy = (x: string) => x.replace(/\s+/g, ' ').trim();
  const m = /(\s+)([—–])(\s+)(.+)$/.exec(t);
  const head = m ? t.slice(0, m.index) : t;
  const what = change.what !== undefined ? tidy(change.what) : head;
  if (change.who === undefined && change.when === undefined) return m ? `${what}${t.slice(m.index)}` : what;
  let parts = m ? tailParts(m[4]) : [];
  if (change.who !== undefined) {
    // Who is every word that isn't the day, as one (what itemParts shows), where it was written.
    const v = tidy(change.who);
    const firstWho = parts.findIndex((x) => x.kind !== 'when');
    const whenAt = parts.findIndex((x) => x.kind === 'when');
    parts = parts.filter((x) => x.kind === 'when');
    if (v) parts.splice(firstWho > whenAt && whenAt >= 0 ? parts.length : 0, 0, { kind: 'who', text: v });
  }
  if (change.when !== undefined) {
    const v = tidy(change.when);
    const j = parts.findIndex((x) => x.kind === 'when');
    if (!v) {
      if (j >= 0) parts.splice(j, 1);
    } else if (j >= 0) parts[j] = { ...parts[j], text: v };
    else parts.push({ kind: 'when', text: v, by: true });
  }
  const tail = parts.map((x) => (x.kind === 'when' && x.by ? `by ${x.text}` : x.text)).join(' · ');
  return tail ? `${what}${m ? `${m[1]}${m[2]}${m[3]}` : ' — '}${tail}` : what;
}

const BOX_LINE = /^(\s*[-*+]\s+\[[^\]]\]\s+)(.*)$/;

/** A run sheet's words with one tick box's words, who or when changed (by its line); every other character kept. */
export function setRunSheetItem(body: string, line: number, change: { what?: string; who?: string; when?: string }): string {
  const src = String(body ?? '');
  const lines = src.split(/\r?\n/);
  const m = BOX_LINE.exec(lines[line] ?? '');
  if (!m) return src;
  const next = withItemParts(m[2], change);
  if (!next.trim()) return src;
  lines[line] = `${m[1]}${next}`;
  return lines.join(eolOf(src));
}

/** Where a tick box's lines end: the box and the lines indented under it. */
function boxEnd(lines: string[], line: number): number {
  const indent = /^\s*/.exec(lines[line])![0].length;
  let end = line + 1;
  while (end < lines.length && lines[end].trim() && /^\s*/.exec(lines[end])![0].length > indent) end++;
  return end;
}

/** A run sheet's words with one tick box (and the lines under it) taken out. */
export function removeRunSheetItem(body: string, line: number): string {
  const src = String(body ?? '');
  const lines = src.split(/\r?\n/);
  if (!BOX_LINE.test(lines[line] ?? '')) return src;
  lines.splice(line, boxEnd(lines, line) - line);
  return lines.join(eolOf(src));
}

/** A run sheet's words with one tick box moved before (or after) another; returns the words and the box's new line. */
export function moveRunSheetItem(body: string, line: number, target: number, after = false): { body: string; line: number } {
  const src = String(body ?? '');
  const lines = src.split(/\r?\n/);
  if (!BOX_LINE.test(lines[line] ?? '') || !BOX_LINE.test(lines[target] ?? '') || line === target) return { body: src, line };
  const end = boxEnd(lines, line);
  const block = lines.splice(line, end - line);
  const t = target > line ? target - block.length : target;
  const at = after ? boxEnd(lines, t) : t;
  lines.splice(at, 0, ...block);
  return { body: lines.join(eolOf(src)), line: at };
}

/** A run sheet's words with a phase's heading renamed (phases as runSheet counts them). */
export function renameRunSheetPhase(body: string, phase: number, name: string): string {
  const src = String(body ?? '');
  const p = runSheet(src)[phase];
  const words = name.replace(/\s+/g, ' ').trim();
  if (!p || p.line === undefined || !words) return src;
  const lines = src.split(/\r?\n/);
  lines[p.line] = lines[p.line].replace(/^(###\s+).*?(\s*#*\s*)$/, (_, a: string, b: string) => `${a}${words}${b.trim() ? b : ''}`);
  return lines.join(eolOf(src));
}

/** A log bullet's field and value, as parseLog reads it ("- Weight: 104.2 kg"); null for a note. */
function logBullet(item: string): { field: string; value: string } | null {
  const kv = /^(?:\*\*)?([A-Za-z][^:*\[\]]{0,40}?)(?:\*\*)?:(?:\*\*)?\s+(.+)$/.exec(item);
  return kv && !/^https?$/i.test(kv[1]) && !DAYISH.test(kv[1]) ? { field: kv[1].trim(), value: kv[2] } : null;
}

/** The entries for one day in a log's lines: [heading line, end line) for each heading naming that day. */
function logDays(lines: string[], iso: string, ref: Date): [number, number][] {
  const out: [number, number][] = [];
  lines.forEach((l, i) => {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(l);
    const read = h ? readLogHeading(h[1], ref) : null;
    if (!read || isoDay(read.date) !== iso) return;
    let end = lines.findIndex((x, j) => j > i && /^#{1,2}\s/.test(x));
    if (end < 0) end = lines.length;
    out.push([i, end]);
  });
  return out;
}

/**
 * A log's words with one field of one day's entry set (null takes it off): the field's line changed where it is (its
 * bold and bullet kept), else added under the day's other lines; a day not written yet gets its entry. Nothing else changes.
 */
export function setLogValue(source: string, iso: string, field: string, value: string | null, ref: Date = new Date()): string {
  const src = String(source ?? '');
  const lines = src.split(/\r?\n/);
  const days = logDays(lines, iso, ref);
  const v = value === null ? null : value.replace(/\r?\n/g, ' ').trim();
  const isField = (l: string) => {
    const b = /^\s*[-*+]\s+(.*)$/.exec(l);
    const kv = b ? logBullet(b[1].trim()) ?? /^(?:\*\*)?([A-Za-z][^:*\[\]]{0,40}?)(?:\*\*)?:\s*$/.exec(b[1].trim()) : null;
    const name = kv ? ('field' in kv ? kv.field : kv[1]) : '';
    return !!name && norm(name) === norm(field);
  };
  for (const [a, b] of days)
    for (let i = a + 1; i < b; i++)
      if (isField(lines[i])) {
        if (v === null || v === '') lines.splice(i, 1);
        else lines[i] = lines[i].replace(/^(\s*[-*+]\s+(?:\*\*)?[^:]*?(?:\*\*)?:(?:\*\*)?)(\s*).*$/, (_, pre: string) => `${pre} ${v}`);
        return lines.join(eolOf(src));
      }
  if (v === null || v === '') return src;
  if (!days.length) {
    const [y, m, d] = iso.split('-').map(Number);
    return appendLogEntry(src, { date: new Date(y, m - 1, d), values: { [field]: v } }, ref);
  }
  // Under the day's last field (or its last line), in the day's own bullet.
  const [a, b] = days[0];
  let last = a;
  let lastField = -1;
  for (let i = a + 1; i < b; i++) {
    if (lines[i].trim()) last = i;
    const bl = /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
    if (bl && logBullet(bl[1].trim())) lastField = i;
  }
  const at = lastField >= 0 ? lastField : last;
  const bullet = /^(\s*[-*+])\s/.exec(lines[at] ?? '')?.[1] ?? '-';
  lines.splice(at + 1, 0, ...(at === a ? ['', `${bullet} ${field}: ${v}`] : [`${bullet} ${field}: ${v}`]));
  return lines.join(eolOf(src));
}

/** A log's words with one of a day's notes (its free bullets, counted as parseLog reads them) changed, or taken off (null). */
export function setLogNote(source: string, iso: string, index: number, text: string | null, ref: Date = new Date()): string {
  const src = String(source ?? '');
  const lines = src.split(/\r?\n/);
  let k = 0;
  for (const [a, b] of logDays(lines, iso, ref))
    for (let i = a + 1; i < b; i++) {
      const bl = /^(\s*[-*+]\s+)(.*)$/.exec(lines[i]);
      const item = bl?.[2].trim() ?? '';
      if (!bl || !item || logBullet(item)) continue;
      if (k++ !== index) continue;
      const t = text === null ? '' : text.replace(/\r?\n/g, ' ').trim();
      const box = /^\[[^\]]\]\s*/.exec(bl[2])?.[0] ?? '';
      if (!t) lines.splice(i, 1);
      else lines[i] = `${bl[1]}${box}${t}`;
      return lines.join(eolOf(src));
    }
  return src;
}

/** Today's date as the dashboards count it (handy for callers without a clock of their own). */
export const todayIso = (d: Date = new Date()) => isoDay(d);
