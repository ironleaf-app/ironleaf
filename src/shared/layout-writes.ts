// Project layouts, written by the assistant (21 Oct 2026; docs/LAYOUTS.md is the contract: a project picks a layout —
// programme, site, register, fitness, wellbeing or venture — or composes blocks, and its page reads front matter,
// Markdown tables, tick-box lines and log notes). and have it done right, for any kind of work: "it's still corporate
// but the ability to adapt". Nothing here knows anyone's topics: a log is written from its own fields and entries, a
// table from its own columns, a layout chosen from the shape of the information. The writing half, pure (no files): the
// assistant's tools (src/main/agent.ts) find the notes and keep every change for Undo; the dashboards
// (src/shared/layouts.ts, whose log reading and writing this reuses) read the same Markdown back.
//  writeLogEntry    a dated entry in a log note (type: log), in the log's own order, style, field names and units
//   parseLogWords    "calls 12, meetings 3, no follow-ups" → Calls: 12, Meetings: 3, Follow-ups: N (names matched later)
//   chooseLog        which of a project's logs a set of fields belongs in (never a second log for the same thing)
//   addTableRow      a row into a section's table by the table's own columns; the same first-column name updates it
//   setLayout        layout: (or blocks:) and its keys in the properties, and the sections it reads added empty
//   missingFacts     what a rewrite lost: every number, date and link of the old text must still be in the new one
//Nothing here ever drops a line it doesn't understand: text before, between and after what it writes stays as written.

import { isMap } from 'yaml';
import { changeProps, frontMatterRange, readProps, type PropValue } from './frontmatter';
import { readDay } from './days';
import { appendLogEntry as appendLog, BLOCK_TYPES, LAYOUT_IDS, layoutOf as layoutOfProps, newLogNote, parseBlocks, parseLog, SECTION_TABLES, type LayoutId, type LogNote } from './layouts';

export const LAYOUTS = LAYOUT_IDS;
export type Layout = LayoutId;

export interface SectionSpec {
  heading: string;
  /** A table's columns, when the section is read as a table. */
  table?: string[];
  /** H3 phases with tick-box lines (a site's run sheet). */
  phases?: string[];
}

const KEY_DATES: SectionSpec = { heading: 'Key dates', table: ['Date', 'Milestone', 'Status'] };
const RISKS: SectionSpec = { heading: 'Risks and issues', table: ['Risk', 'Impact', 'Owner', 'Status'] };
const tableOf = (heading: string): SectionSpec => ({ heading, table: SECTION_TABLES[heading] });

/**
 * Each layout: the shape of information it suits (never a topic), its own keys, and the sections it reads beyond the
 * ones every project keeps.
 */
export const LAYOUT_SPECS: Record<Layout, { shape: string; keys: string[]; sections: SectionSpec[] }> = {
  programme: { shape: 'several parallel streams of work, each with an owner, a status and progress, with milestones and risks', keys: ['sponsor', 'budget', 'phase'], sections: [tableOf('Workstreams'), KEY_DATES, RISKS] },
  site: { shape: 'one fixed day everything counts down to (an opening, a close, an event, a launch), worked through in phases of tick boxes, with suppliers and contacts', keys: ['go_live', 'site_kind', 'address', 'phase'], sections: [{ heading: 'Run sheet', phases: ['Eight weeks out', 'Build week', 'Go-live day', 'After'] }, tableOf('Suppliers and contacts'), KEY_DATES] },
  register: { shape: 'a list of like things, one row each, with a status or a quantity to count and filter', keys: ['register_of'], sections: [tableOf('Register'), KEY_DATES] },
  fitness: { shape: '(shown as Tracker) numbers logged over days charted against a start and a target (start_<field>, target_<field>), between a start and an end date, how often a week (<things>_per_week), the latest entry and a plan', keys: ['goal', 'start', 'end', 'start_<field>', 'target_<field>', '<things>_per_week'], sections: [tableOf('Plan'), KEY_DATES] },
  wellbeing: { shape: '(shown as Habit) a daily yes/no kept as a streak from a start date, with milestones in days and small numeric check-ins in a log', keys: ['streak_start', 'streak_label', 'milestones'], sections: [{ heading: 'Plan', table: ['When', 'What'] }, KEY_DATES] },
  venture: { shape: 'items moving through stages (a pipeline or campaigns) with owners and due dates, and a website', keys: ['stage', 'site'], sections: [tableOf('Pipeline'), tableOf('Suppliers and contacts'), KEY_DATES] },
};

/** Keys every project keeps (whatever its layout). */
export const COMMON_KEYS = ['status', 'health', 'progress', 'owner', 'due', 'started', 'updated', 'tags', 'folder', 'neuralspark-project'];

/** The blocks a project's dashboard is made of (src/shared/layouts.ts BLOCK_TYPES; each may name what it reads). */
export const BLOCKS = BLOCK_TYPES;
/** A block as written in `blocks:` ("trend:Calls", "board:Pipeline", "countdown"), tidied by the dashboards' own reader; '' when it isn't one. */
export function cleanBlock(v: unknown): string {
  const b = parseBlocks([v])[0];
  return b ? (b.arg ? `${b.type}:${b.arg.replace(/[\[\]{},#]/g, '').trim()}` : b.type) : '';
}
/** The blocks as the assistant is told them: each with what it may read. */
const BLOCK_WORDS = BLOCKS.map((b) => ({ countdown: 'countdown[:date key]', progress: 'progress[:section]', timeline: 'timeline[:section]', board: 'board[:section]', grid: 'grid[:section]', trend: 'trend[:field]', streak: 'streak[:field]', cards: 'cards[:section]' } as Record<string, string>)[b] ?? b).join(', ');

/** A layout's id from what was said (its other names too: tracker, habit, event, program), or null. */
export const layoutId = (v: unknown): Layout | null => (typeof v === 'string' && v.trim() ? (layoutOfProps({ layout: v }) ?? null) : null);
export const isLayout = (v: unknown): v is Layout => !!layoutId(v);

/** A project's layout (its `layout:` property), or null for the plain project page. */
export function layoutOf(text: string): Layout | null {
  return layoutOfProps(readProps(text)) ?? null;
}

/** The layouts in words for the assistant (its system prompt): structure first, never topics. */
export function layoutsGuide(): string {
  const table = (s: SectionSpec) => (s.table ? ` | ${s.table.join(' | ')} |` : s.phases ? ` (### phases such as ${s.phases.join(', ')}, each with tick-box lines)` : '');
  const lines = LAYOUTS.map((l) => {
    const s = LAYOUT_SPECS[l];
    return `  - ${l}: ${s.shape}. Keys: ${s.keys.join(', ')}. Sections: ${s.sections.map((x) => `## ${x.heading}${table(x)}`).join('; ')}.`;
  });
  return [
    '- Project layouts (21 Oct 2026): a project can show its information as a dashboard that suits how it is shaped: layout: picks a preset, blocks: composes one. Choose from the STRUCTURE of the information (a date everything leads to, parallel streams with owners and progress, a list of like things, items moving through stages, numbers logged over days, a daily yes/no), never from topic words, and only when the shape is plain or the person asks; otherwise the project stays plain, as today. The presets:',
    ...lines,
    `  - When no preset fits, compose blocks (they win over a layout): blocks: [${BLOCK_WORDS}]. A number logged over days → trend:<field>; a yes/no logged daily → streak:<field>; a date it all leads to → countdown:<key>; key dates or any dated table → timeline; a table with a Stage or Status column → board:<section>; any list of like things → grid:<section>; a table with Progress or phases of tick boxes → progress:<section>; the latest log entry and a form to add one → entry; people or contacts → cards; health, progress and the simple facts → status; open next steps → actions. Use the log’s own field names and the sections’ own headings.`,
    '  Keys: dates are written YYYY-MM-DD (the year the person means: the next one unless their words say otherwise, such as an event named for its year); numbers as numbers; milestones as a list of day counts ([7, 14, 30, 90]); site_kind opening, close, event or pop-up; stage idea, building, launched or growing. Every layout keeps Summary, What’s next, Key dates (| Date | Milestone | Status |), Risks and issues, Decisions, Updates, Documents and Notes.',
    '  - A new project with a shape ("new project: a pop-up opening on 10 Jan"): save_project for it, then set_layout with the preset (or blocks) and the keys the person said. "This project should be a <layout>": set_layout (it adds layout: and the empty sections the layout reads).',
    '  - "Add a <row> to <project>": add_row into the section whose table holds that kind of row, giving cells by the table’s own column names (a row with the same first-column name is updated, never added twice; a cell with no column goes in Notes or is refused, never dropped).',
    '  - Anything tracked over time (counts, amounts, readings, hours, a daily yes/no, a short note a day) is entries in a log note (type: log, project: the project, fields: the numbers to chart, units: their units), one "## Wed 21 Oct 2026" heading a day with "- Field: value" bullets. For "log …", "check in …" or a line of numbers for a project, call log_entry with the project and the fields: it finds the project’s log, adds to the day’s entry or makes one where the file keeps them (newest at the top or the bottom), uses the log’s own field names and units, and makes the log only when the project has none. Name fields as the log already does when you know it (read the log, or the fields log_entry reports back); the tool also matches close names (plural, first word, "no X" for an X-free field). Never make a second log for the same thing, never put entries in the project file, never retype a log by hand. Say what was logged in one line, and anything it replaced.',
    '  - "Tidy this project", "put this into its layout": reorganise_project with the whole project rewritten into its layout. Never lose information when reorganising: move it. Every number, date, name, link and tick-box line stays (a list of milestones becomes Key dates rows, a list of streams becomes the Workstreams table), the person’s own Notes stay word for word, and anything that fits nowhere goes under Notes. The tool checks every number, date and link survived and shows the person the change to accept before anything is written.',
  ].join('\n');
}

// ── Lines and sections ──

const H2 = /^##(?!#)\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}%]+/gu, ' ').trim();

/** Headings people write for the same section. */
const SECTION_ALIASES: Record<string, string[]> = {
  'key dates': ['key dates', 'dates', 'milestones', 'timeline', 'schedule'],
  workstreams: ['workstreams', 'work streams', 'streams'],
  'risks and issues': ['risks and issues', 'risks', 'issues', 'risks issues', 'raid'],
  'suppliers and contacts': ['suppliers and contacts', 'suppliers', 'contacts', 'vendors', 'suppliers contacts'],
  'run sheet': ['run sheet', 'runsheet', 'run of show', 'checklist'],
  register: ['register', 'inventory', 'items'],
  plan: ['plan', 'training plan', 'programme plan', 'schedule plan'],
  pipeline: ['pipeline', 'deals'],
  campaigns: ['campaigns', 'marketing'],
  'whats next': ['whats next', 'next steps', 'next', 'actions', 'to do', 'todo'],
};
const sectionKey = (heading: string) => {
  const n = norm(heading);
  for (const [key, names] of Object.entries(SECTION_ALIASES)) if (names.includes(n)) return key;
  return n;
};

/** The note's H2 headings (outside code), with where each starts and ends (line indexes; end is exclusive). */
function sections(lines: string[]): { heading: string; start: number; end: number }[] {
  const out: { heading: string; start: number; end: number }[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) fence = !fence;
    if (fence) continue;
    const m = H2.exec(lines[i]);
    if (m) {
      if (out.length) out[out.length - 1].end = i;
      out.push({ heading: m[1], start: i, end: lines.length });
    }
  }
  return out;
}
/** Where the body starts (after the properties). */
function bodyStart(text: string): number {
  const fm = frontMatterRange(text);
  return fm ? text.slice(0, fm.to).split('\n').length - (text.slice(0, fm.to).endsWith('\n') ? 1 : 0) : 0;
}
const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');
const linesOf = (text: string) => text.replace(/\r\n/g, '\n').split('\n');
const join = (lines: string[], eol: string) => lines.join('\n').replace(/\n/g, eol);

/** The section named (or one of its other names), or null. */
export function findSection(text: string, heading: string): { heading: string; start: number; end: number } | null {
  const key = sectionKey(heading);
  return sections(linesOf(text)).find((s) => sectionKey(s.heading) === key) ?? null;
}

// ── Tables ──

/** A Markdown table row's cells ("\|" kept inside a cell). */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '\\|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}
const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
export const cellText = (v: unknown) => String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/(?<!\\)\|/g, '\\|');
const rowLine = (cells: string[]) => `| ${cells.map((c) => c || ' ').join(' | ')} |`.replace(/\|  \|/g, '|   |');

/** The first table between two lines: its columns and where its rows are. */
function tableIn(lines: string[], from: number, to: number): { header: string[]; head: number; first: number; end: number } | null {
  for (let i = from; i < to - 1; i++) {
    if (isRow(lines[i]) && isSeparator(lines[i + 1])) {
      let end = i + 2;
      while (end < to && isRow(lines[end])) end++;
      return { header: splitRow(lines[i]), head: i, first: i + 2, end };
    }
  }
  return null;
}

/** Column names people write for the same thing (the first is the contract's). */
const COLUMN_ALIASES: string[][] = [
  ['date', 'when', 'day', 'on'],
  ['milestone', 'what', 'event', 'item'],
  ['workstream', 'stream', 'name'],
  ['owner', 'who', 'lead', 'responsible'],
  ['status', 'state'],
  ['progress', 'complete', 'percent', '%', 'done'],
  ['next step', 'next', 'next action', 'next steps'],
  ['item', 'name', 'title', 'device', 'asset', 'thing'],
  ['stage', 'phase', 'column'],
  ['due', 'due date', 'by', 'deadline', 'date'],
  ['notes', 'note', 'comments', 'comment', 'details'],
  ['contact', 'email', 'phone', 'mobile'],
  ['company', 'business', 'organisation', 'organization', 'supplier', 'vendor'],
  ['role', 'job', 'does'],
  ['qty', 'quantity', 'count', 'number', 'how many'],
  ['risk', 'issue', 'risk or issue'],
  ['impact', 'level', 'severity', 'rating'],
  ['session', 'workout', 'training'],
];
/** The column of a table a given name means: exactly, then by its other names. -1 when none. */
export function columnOf(header: string[], given: string): number {
  const g = norm(given);
  const cols = header.map(norm);
  const exact = cols.indexOf(g);
  if (exact >= 0) return exact;
  for (const group of COLUMN_ALIASES) {
    if (!group.includes(g)) continue;
    const i = cols.findIndex((c) => group.includes(c));
    if (i >= 0) return i;
  }
  const starts = cols.filter((c) => c.startsWith(g) || (c.length > 3 && g.startsWith(c)));
  return starts.length === 1 ? cols.indexOf(starts[0]) : -1;
}

const DATE_COLUMN = /^(date|when|day|due|due date|deadline|go live)$/;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** A date as people write it, as YYYY-MM-DD (null when it isn't one). */
export function isoDate(text: string, ref: Date = new Date()): string | null {
  const t = String(text ?? '').trim();
  if (!t || !/\d/.test(t)) return null;
  const d = readDay(t.replace(/,\s*.*$/, ''), ref) ?? readDay(t, ref);
  return d ? iso(d) : null;
}

/** The spec of a section by its name in any layout (for a table's columns when it is made). */
function specOf(heading: string, layout: Layout | null): SectionSpec | null {
  const key = sectionKey(heading);
  const order = layout ? [layout, ...LAYOUTS.filter((l) => l !== layout)] : [...LAYOUTS];
  for (const l of order) for (const s of LAYOUT_SPECS[l].sections) if (sectionKey(s.heading) === key) return s;
  if (key === 'campaigns') return { heading: 'Campaigns', table: ['Item', 'Stage', 'Owner', 'Due', 'Notes'] };
  return null;
}

export interface RowResult {
  text: string;
  action: 'added' | 'updated';
  section: string;
  columns: string[];
  /** The row as written. */
  row: string[];
  /** The row before an update. */
  was?: string[];
  /** Given cells with no column of their own, put in Notes. */
  inNotes: string[];
  madeSection: boolean;
  madeTable: boolean;
}

/**
 * A row into the table of a section (made with the layout's columns when the section or its table isn't there). Cells
 * are given by column name (any of a column's usual names: Who for Owner, When for Date); the first column names the
 * row, and a row of that name already there is updated (only the cells given) rather than added twice. Rows of a table
 * whose first column is a date go in date order; others go at the end. A cell with no column goes in a Notes column
 * when the table has one; otherwise it is refused with the table's columns, so nothing is quietly lost.
 */
export function addTableRow(text: string, section: string, cells: Record<string, unknown>, opts: { layout?: Layout | null; today?: Date } = {}): RowResult {
  const eol = eolOf(text);
  const lines = linesOf(text);
  const given = Object.entries(cells ?? {}).filter(([k, v]) => k.trim() && v !== undefined && v !== null && String(v).trim() !== '');
  if (!given.length) throw new Error('Give the row’s cells by column name, for example {"Workstream": "Driver remediation", "Owner": "Sam", "Progress": "40%"}.');
  const layout = opts.layout ?? layoutOf(text);
  const spec = specOf(section, layout);
  let found = sections(lines).find((s) => sectionKey(s.heading) === sectionKey(section));
  let madeSection = false;
  let madeTable = false;
  const heading = found?.heading ?? spec?.heading ?? section.replace(/^#+\s*/, '').trim();
  if (!found) {
    // A new section goes at the end (where project files keep sections of their own).
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push('', `## ${heading}`, '');
    found = { heading, start: lines.length - 2, end: lines.length };
    madeSection = true;
  }
  let table = tableIn(lines, found.start + 1, found.end);
  if (!table) {
    const header = spec?.table ?? given.map(([k]) => k.trim());
    // After the section's own words, a blank line before it and (when more follows) after it.
    let at = found.end;
    while (at > found.start + 1 && !lines[at - 1].trim()) at--;
    lines.splice(at, found.end - at, '', rowLine(header), `|${header.map(() => ' --- ').join('|')}|`, '');
    table = tableIn(lines, found.start + 1, lines.length)!;
    madeTable = true;
  }
  const { header } = table;
  const row: string[] = header.map(() => '');
  const inNotes: string[] = [];
  const unknown: string[] = [];
  const notesCol = header.findIndex((h) => ['notes', 'note', 'comments', 'details'].includes(norm(h)));
  const today = opts.today ?? new Date();
  for (const [k, v] of given) {
    const i = columnOf(header, k);
    let value = cellText(v);
    if (i < 0) {
      if (notesCol >= 0) inNotes.push(`${k.trim()}: ${value}`);
      else unknown.push(k.trim());
      continue;
    }
    const col = norm(header[i]);
    if (DATE_COLUMN.test(col)) value = isoDate(value, today) ?? value;
    if (/^(progress|complete|percent|%)$/.test(col) && /^\d{1,3}(\.\d+)?$/.test(value)) value = `${value}%`;
    row[i] = value;
  }
  if (unknown.length) throw new Error(`The ${heading} table has no column for ${unknown.join(', ')}. Its columns: ${header.join(', ')}. Give the cells by those names.`);
  if (inNotes.length) row[notesCol] = [row[notesCol], ...inNotes].filter(Boolean).join('; ');
  if (!row[0]) throw new Error(`Give the ${header[0]} (the table’s first column): it names the row.`);
  // The same row again: the cells given are brought up to date, the rest kept. A date-first table names a row by
  // its date and its What/Milestone (fnv3 F33): two milestones can share a date, and neither overwrites the other.
  const rows = lines.slice(table.first, table.end);
  const whatCol = DATE_COLUMN.test(norm(header[0])) ? header.findIndex((h) => /^(milestone|what|event|title|name)$/.test(norm(h))) : -1;
  const same = rows.findIndex((l) => { const cells = splitRow(l); return norm(cells[0] ?? '') === norm(row[0]) && (whatCol < 0 || !row[whatCol] || norm(cells[whatCol] ?? '') === norm(row[whatCol])); });
  if (same >= 0) {
    const was = splitRow(rows[same]);
    while (was.length < header.length) was.push('');
    const merged = was.map((c, i) => (i > 0 && row[i] ? row[i] : c));
    lines[table.first + same] = rowLine(merged);
    return { text: join(lines, eol), action: 'updated', section: heading, columns: header, row: merged, was, inNotes, madeSection, madeTable };
  }
  let at = table.end;
  if (DATE_COLUMN.test(norm(header[0])) && /^\d{4}-\d{2}-\d{2}$/.test(row[0])) {
    const later = rows.findIndex((l) => {
      const d = isoDate(splitRow(l)[0] ?? '', today);
      return !!d && d > row[0];
    });
    if (later >= 0) at = table.first + later;
  }
  lines.splice(at, 0, rowLine(row));
  return { text: join(lines, eol), action: 'added', section: heading, columns: header, row, inNotes, madeSection, madeTable };
}

// ── Layouts ──

export interface LayoutResult {
  text: string;
  /** Sections added (empty). */
  added: string[];
  /** Keys set. */
  keys: string[];
  /** Keys given that the layout doesn't read (left out). */
  ignored: string[];
  /** Blocks written. */
  blocks: string[];
}

/** An empty section as the layout reads it. */
function emptySection(s: SectionSpec, keys: Record<string, unknown>): string[] {
  if (s.table) {
    const header = [...s.table];
    // A register names its first column for what one row is.
    if (s.heading === 'Register' && typeof keys.register_of === 'string' && keys.register_of.trim()) header[0] = keys.register_of.trim().replace(/^./, (c) => c.toUpperCase());
    return [`## ${s.heading}`, '', rowLine(header), `|${header.map(() => ' --- ').join('|')}|`];
  }
  if (s.phases) return [`## ${s.heading}`, '', ...s.phases.flatMap((p, i) => [...(i ? [''] : []), `### ${p}`])];
  return [`## ${s.heading}`, ''];
}

const DATE_KEYS = ['go_live', 'start', 'end', 'streak_start', 'due', 'started'];
const NUMBER_KEYS = ['progress'];
/** Keys any layout may take from the shape of the information: a start and target for a field, how often a week. */
const PATTERN_KEYS = /^(?:start|target)_[\p{L}\p{N}_]{1,40}$|^[\p{L}\p{N}_]{1,40}_per_week$/u;
const keyValue = (key: string, v: unknown): PropValue | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (key === 'milestones') {
    const list = (Array.isArray(v) ? v : String(v).split(/[,\s]+/)).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    return list.length ? list : undefined;
  }
  if (NUMBER_KEYS.includes(key) || (PATTERN_KEYS.test(key) && /^[\s$€£~]*-?\d/.test(String(v)))) {
    const n = Number(String(v).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) && String(v).trim() !== '' ? n : undefined;
  }
  if (DATE_KEYS.includes(key)) return isoDate(String(v)) ?? String(v).trim();
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v).replace(/[\r\n]+/g, ' ').trim();
};

/**
 * A project's layout written: layout: (a preset) and/or blocks: (composed), the keys the layout reads, and the sections
 * it reads added empty when missing (none removed or changed). Keys the layout doesn't read are left out and said.
 */
export function setLayout(text: string, layout: string | null | undefined, keys: Record<string, unknown> = {}, blocks?: unknown[]): LayoutResult {
  const said = String(layout ?? '').trim();
  const l = said ? (layoutId(said) ?? said.toLowerCase()) : '';
  const composed = Array.isArray(blocks) ? [...new Set(blocks.map(cleanBlock).filter(Boolean))] : [];
  if (l && !isLayout(l)) throw new Error(`There is no layout called “${layout}”. The layouts: ${LAYOUTS.join(', ')}; or compose blocks (${BLOCK_WORDS}).`);
  if (!l && !composed.length) throw new Error(`Give a layout (${LAYOUTS.join(', ')}) or blocks to compose (${BLOCK_WORDS}).`);
  const spec = l ? LAYOUT_SPECS[l as Layout] : null;
  const set: string[] = [];
  const ignored: string[] = [];
  // With blocks, any preset's keys are welcome (a countdown reads go_live, a trend a target).
  const allowed = new Set([...(spec ? spec.keys : []), ...(composed.length ? LAYOUTS.flatMap((x) => LAYOUT_SPECS[x].keys) : []), ...COMMON_KEYS]);
  let out = changeProps(text, (doc) => {
    if (!isMap(doc.contents)) return;
    // A preset and composed blocks are two ways to say the same thing: the new one replaces the old (fnv3 F31),
    // or blocksOf would keep showing the old blocks and the tool's "now has the programme layout" would be untrue.
    if (l) { doc.set('layout', l); doc.delete('blocks'); }
    if (composed.length) { doc.set('blocks', composed); doc.delete('layout'); }
    for (const [k, v] of Object.entries(keys ?? {})) {
      if ((!allowed.has(k) && !PATTERN_KEYS.test(k)) || k === 'layout' || k === 'type' || k === 'blocks') {
        ignored.push(k);
        continue;
      }
      const value = keyValue(k, v);
      if (value === undefined) continue;
      if (value === null) doc.delete(k);
      else doc.set(k, value);
      set.push(k);
    }
  });
  const added: string[] = [];
  const eol = eolOf(out);
  for (const s of spec?.sections ?? []) {
    if (findSection(out, s.heading)) continue;
    const lines = linesOf(out);
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push('', ...emptySection(s, keys), '');
    out = join(lines, eol);
    added.push(s.heading);
  }
  return { text: out, added, keys: set, ignored, blocks: composed };
}

// ── Logs ──

const singular = (s: string) => s.replace(/(?<=\w{3})(?:es|s)$/, '');
const titleCase = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase());
const stem = (w: string) => (w.length >= 4 ? w : '');

/** Every field a log knows: the ones it charts, then the ones its entries use, as written (first seen wins). */
export function logFields(log: LogNote): string[] {
  const seen = new Map<string, string>();
  for (const f of log.fields) if (!seen.has(norm(f))) seen.set(norm(f), f);
  for (const e of log.entries) for (const f of Object.keys(e.values)) if (!seen.has(norm(f))) seen.set(norm(f), f);
  return [...seen.values()];
}

/**
 * The name a log uses for a field the person said, by its shape alone: the same name (any case or plural), then the
 * one field whose first word is it or starts the same way ("follow" → "Follow-ups", "mins" → "Minutes"). Else the name
 * as said, tidied (a new field).
 */
export function resolveField(given: string, known: string[]): string {
  const g = norm(given);
  if (!g) return titleCase(given);
  const k = known.map((x) => ({ x, n: norm(x), first: norm(x).split(' ')[0] }));
  const exact = k.find((x) => x.n === g) ?? k.find((x) => singular(x.n) === singular(g));
  if (exact) return exact.x;
  const gFirst = g.split(' ')[0];
  const one = (list: typeof k) => (list.length === 1 ? list[0].x : null);
  return (
    one(k.filter((x) => x.first === gFirst || singular(x.first) === singular(gFirst))) ??
    one(k.filter((x) => (stem(gFirst) && x.first.startsWith(gFirst)) || (stem(x.first) && gFirst.startsWith(x.first)) || (stem(g) && x.n.startsWith(g)))) ??
    // An abbreviation shares its first letters, not a prefix ("mins" -> "Minutes"; fnv3 F32).
    one(k.filter((x) => gFirst.length >= 3 && x.first.slice(0, 3) === gFirst.slice(0, 3))) ??
    titleCase(given)
  );
}

/** "no X" said of a log: its "X-free" / "No X" / "Without X" field set to Y when it has one, else X set to N. */
export function negatedField(thing: string, known: string[]): [string, string] {
  const t = singular(norm(thing));
  const words = new RegExp(`(?:^| )(?:${t}s? free|no ${t}s?|without ${t}s?)(?: |$)`);
  const hit = known.find((f) => words.test(norm(f)));
  return hit ? [hit, 'Y'] : [resolveField(thing, known), 'N'];
}

export interface LogWords {
  fields: [string, string][];
  notes: string[];
  /** Fields said as "no X" (matched to the log later). */
  negated: string[];
  /** Bare numbers said without a name (a log with one number field takes them). */
  bare: string[];
}

const UNIT = '(?:kg|kgs|g|cm|mm|km|m|mi|%|\\/\\s*10|out of 10|h|hrs?|hours?|mins?|minutes?|secs?|l|litres?|ml|bpm|kcal|cal|k)';
const NUMBER = '[$€£]?-?\\d+(?:[.,]\\d+)?';

/**
 * A tracker line as people say it, into fields and notes, knowing nothing of the topic: "Name: value", "name 12",
 * "12 names", "name yes", "no name"; a bare number is kept for a log with one number field; anything else is a note.
 * A lead-in ("log", "check in:", "today's numbers -") is dropped. Names are matched to a log's own later.
 */
export function parseLogWords(text: string): LogWords {
  let s = String(text ?? '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:please\s+)?(?:(?:log|record|track|enter|add|save)\b\s*)?(?:(?:my|today'?s|the|a|this)\s+)?/i, '');
  // "check in:", "evening numbers -": a short label before a colon or dash, with no number in it.
  const label = /^([^\d:,;]{1,30}?)\s*[:–—-]\s+(?=\S)/.exec(s);
  if (label && label[1].trim().split(/\s+/).length <= 3 && /[,;]|\d/.test(s.slice(label[0].length))) s = s.slice(label[0].length);
  const fields: [string, string][] = [];
  const notes: string[] = [];
  const negated: string[] = [];
  const bare: string[] = [];
  const parts = s.split(/\s*[,;\n]\s*|\s+and\s+(?=no\s|\d|[\p{L}][\p{L}\s-]{0,30}\s+\d)/iu).map((p) => p.trim()).filter(Boolean);
  let pending = '';
  for (const part of parts) {
    let x: RegExpExecArray | null;
    if ((x = /^(?:no|zero|without)\s+([\p{L}][\p{L}\s'’-]{0,38})$/iu.exec(part))) {
      negated.push(x[1].trim());
      continue;
    }
    if ((x = /^([^:]{1,40}?)\s*:\s*(.+)$/.exec(part))) {
      fields.push([x[1].trim(), yesNo(x[2])]);
      continue;
    }
    if ((x = new RegExp(`^(${NUMBER})\\s*(${UNIT})?$`, 'i').exec(part))) {
      if (pending) {
        fields.push([pending, withUnit(x[1], x[2])]);
        pending = '';
      } else bare.push(withUnit(x[1], x[2]));
      continue;
    }
    if ((x = new RegExp(`^([\\p{L}][\\p{L}\\s'’-]{0,38}?)\\s*(?:=|is|was|at|of)?\\s*(${NUMBER})\\s*(${UNIT})?$`, 'iu').exec(part))) {
      fields.push([x[1].trim(), withUnit(x[2], x[3])]);
      continue;
    }
    if ((x = new RegExp(`^(${NUMBER})\\s*(${UNIT})?\\s+(?:of\\s+)?([\\p{L}][\\p{L}\\s'’-]{0,38})$`, 'iu').exec(part))) {
      fields.push([x[3].trim(), withUnit(x[1], x[2])]);
      continue;
    }
    if ((x = /^([\p{L}][\p{L}\s'’-]{0,38}?)\s+(yes|no|y|n|done)$/iu.exec(part))) {
      fields.push([x[1].trim(), yesNo(x[2])]);
      continue;
    }
    // A name on its own with its number next ("visits, 4").
    if (!pending && /^[\p{L}][\p{L}\s-]{1,30}$/u.test(part) && parts.length > 1) {
      pending = part;
      continue;
    }
    notes.push(part);
  }
  if (pending) notes.push(pending);
  return { fields, notes, negated, bare };
}
const yesNo = (v: string) => (/^(y|yes|yep|true|done)$/i.test(v.trim()) ? 'Y' : /^(n|no|nope|false)$/i.test(v.trim()) ? 'N' : v.trim());
const withUnit = (n: string, unit?: string) => {
  const num = n.replace(/(\d),(\d)/, '$1.$2');
  if (!unit) return num;
  const u = unit.replace(/\s+/g, '').toLowerCase().replace(/^kgs$/, 'kg').replace(/^outof10$/, '/10');
  return u === '/10' ? `${num}/10` : `${num} ${u}`;
};

/** A value as the log writes it: a bare number gets the field's unit; yes and no are Y and N. */
export function logValue(value: unknown, unit?: string): string {
  if (typeof value === 'boolean') return value ? 'Y' : 'N';
  const v = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (unit && /^-?\d+(?:\.\d+)?$/.test(v)) return `${v} ${unit}`;
  return yesNo(v);
}

/** The words a log said said as fields of that log: names matched, "no X" placed, a lone number given to its one field. */
export function fieldsFromWords(words: LogWords, log: LogNote | null): { fields: [string, string][]; notes: string[] } {
  const known = log ? logFields(log) : [];
  const fields: [string, string][] = words.fields.map(([f, v]) => [resolveField(f, known), v]);
  for (const n of words.negated) fields.push(negatedField(n, known));
  const notes = [...words.notes];
  const numeric = log ? (log.fields.length ? log.fields : known.filter((f) => log.entries.some((e) => e.values[f]?.kind === 'number'))) : [];
  if (words.bare.length === 1 && numeric.length === 1 && !fields.some(([f]) => norm(f) === norm(numeric[0]))) fields.push([numeric[0], words.bare[0]]);
  else notes.push(...words.bare);
  return { fields, notes };
}

export interface LogEntryIn {
  /** YYYY-MM-DD. */
  date: string;
  /** Field name → value, as said (names matched to the log's own). */
  fields: [string, unknown][];
  /** Free lines without a field. */
  notes?: string[];
}

export interface LogResult {
  text: string;
  /** The day's heading as written. */
  heading: string;
  /** The day was already there and was added to. */
  addedTo: boolean;
  /** Fields as written: name and value. */
  written: [string, string][];
  /** A field the day already had, given a new value: what it was. */
  replaced: { field: string; was: string; now: string }[];
  /** Fields the log didn't have before. */
  newFields: string[];
  /** Where the newest entries are in the file. */
  order: 'top' | 'bottom';
  /** The log's fields after the entry (for the assistant's next one). */
  fields: string[];
}

const dateOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/**
 * An entry added to a log in its own order, style, names and units (src/shared/layouts.ts appendLogEntry writes it):
 * the day there already is added to (a field it has takes the new value, and what it was is said back); a new day goes
 * where its date falls, newest at the top or the bottom as the file keeps them; a log that counts its days ("…, Day 12")
 * goes on counting. Everything else in the file stays exactly as written.
 */
export function writeLogEntry(text: string, entry: LogEntryIn, ref: Date = new Date()): LogResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) throw new Error('The entry’s date is YYYY-MM-DD.');
  const log = parseLog(text, ref);
  const known = logFields(log);
  const unitOf = (name: string) => Object.entries(log.units).find(([k]) => norm(k) === norm(name))?.[1];
  const written: [string, string][] = [];
  for (const [name, value] of entry.fields) {
    if (!String(name ?? '').trim() || value === undefined || value === null || String(value).trim() === '') continue;
    const field = resolveField(String(name), known);
    const v = logValue(value, unitOf(field));
    const at = written.findIndex(([f]) => norm(f) === norm(field));
    if (at >= 0) written[at] = [field, v];
    else written.push([field, v]);
  }
  const notes = (entry.notes ?? []).map((n) => String(n).replace(/[\r\n]+/g, ' ').trim()).filter(Boolean);
  if (!written.length && !notes.length) throw new Error('Give at least one field (Name: value) or a note to log.');
  const newFields = written.map(([f]) => f).filter((f) => !known.some((k) => norm(k) === norm(f)));
  const day = log.entries.find((e) => e.date === entry.date);
  const replaced: LogResult['replaced'] = [];
  if (day) for (const [f, v] of written) {
    const had = Object.entries(day.values).find(([k]) => norm(k) === norm(f));
    if (had && had[1].text !== v) replaced.push({ field: had[0], was: had[1].text, now: v });
  }
  // The day's label goes on counting when the log counts its days ("Day 12").
  let label = '';
  if (!day) {
    const counted = [...log.entries].reverse().find((e) => /^Day\s+\d+$/i.test(e.label));
    if (counted) {
      const n = Number(/\d+/.exec(counted.label)![0]) + Math.round((dateOf(entry.date).getTime() - dateOf(counted.date).getTime()) / 86400000);
      if (n > 0) label = `Day ${n}`;
    }
  }
  const values = Object.fromEntries(written);
  const out = appendLog(text, { date: dateOf(entry.date), values, notes, ...(label ? { label } : {}) }, ref);
  const after = parseLog(out, ref);
  const heading = linesOf(out).find((l) => {
    const m = H2.exec(l);
    return m && entryDateOf(m[1], ref) === entry.date;
  });
  return { text: out, heading: heading ? heading.replace(/^##\s+/, '').trim() : entry.date, addedTo: !!day, written, replaced, newFields, order: log.newestFirst ? 'top' : 'bottom', fields: logFields(after) };
}
const entryDateOf = (heading: string, ref: Date) => {
  const head = heading.split(',')[0].trim();
  if (!/\d/.test(head)) return null;
  const d = readDay(head, ref);
  return d ? iso(d) : null;
};

/**
 * A new log's text: linked to its project, the number fields to chart and their units (a unit said with the first value,
 * "12.5 h", becomes the log's), and its first entry.
 */
export function newLogText(opts: { title: string; project: string; entry: LogEntryIn; units?: Record<string, string> }, ref: Date = new Date()): string {
  const units: Record<string, string> = { ...(opts.units ?? {}) };
  const charted: string[] = [];
  const fields: [string, unknown][] = [];
  for (const [name0, value] of opts.entry.fields) {
    const name = titleCase(String(name0));
    const v = String(value ?? '').trim();
    const m = /^([$€£]?)(-?\d+(?:\.\d+)?)\s*([a-z%][a-z0-9/]*)?$/i.exec(v);
    if (m) {
      charted.push(name);
      const unit = m[1] || m[3];
      if (unit && !units[name]) units[name] = unit;
      fields.push([name, m[1] ? v : m[2]]);
    } else fields.push([name, value]);
  }
  const base = newLogNote(opts.project, { title: opts.title, fields: charted, units: Object.fromEntries(Object.entries(units).filter(([k]) => charted.includes(k))) }, ref);
  return writeLogEntry(base, { ...opts.entry, fields }, ref).text;
}

export interface LogCandidate {
  path: string;
  text: string;
  mtime?: number;
}

/**
 * Which of a project's logs these fields go in: the one whose fields they share most, then the newest; with one log,
 * that one (a new field is added to it rather than a second log made). Null when the project has no log.
 */
export function chooseLog(logs: LogCandidate[], fields: string[], ref: Date = new Date()): LogCandidate | null {
  if (!logs.length) return null;
  if (logs.length === 1) return logs[0];
  const scored = logs.map((l) => {
    const known = logFields(parseLog(l.text, ref));
    const hits = fields.filter((f) => known.some((k) => norm(k) === norm(resolveField(f, known)))).length;
    return { l, hits };
  });
  scored.sort((a, b) => b.hits - a.hits || (b.l.mtime ?? 0) - (a.l.mtime ?? 0));
  return scored[0].l;
}

// ── Reorganising without losing anything ──

const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE_PATTERNS: RegExp[] = [
  /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
  new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}(?:,?\\s+(\\d{4}))?`, 'gi'),
  new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'gi'),
  /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g,
];
const MONTH_INDEX = (m: string) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m.slice(0, 3).toLowerCase());
const two = (n: number) => String(n).padStart(2, '0');

export interface Facts {
  /** Dates, as YYYY-MM-DD (or --MM-DD when written without a year). */
  dates: string[];
  numbers: string[];
  links: string[];
}

/** The facts a note holds that a rewrite must keep: its dates, numbers and links (each written however it was). */
export function factsOf(text: string): Facts {
  let s = String(text ?? '');
  const links: string[] = [];
  s = s.replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, (_, t: string) => {
    links.push(`[[${t.trim().toLowerCase()}]]`);
    return ' ';
  });
  s = s.replace(/\[[^\]]*\]\(([^)\s]+)[^)]*\)/g, (all, u: string) => {
    links.push(u.replace(/[.,;:]+$/, ''));
    return ' ' + all.slice(1, all.indexOf(']')) + ' ';
  });
  s = s.replace(/\b(?:https?:\/\/|www\.)[^\s<>|)\]]+/gi, (u) => {
    links.push(u.replace(/[.,;:!?'"]+$/, '').replace(/^www\./i, 'https://www.').replace(/^http:/i, 'https:'));
    return ' ';
  });
  const dates: string[] = [];
  DATE_PATTERNS.forEach((re, i) => {
    s = s.replace(re, (...m: string[]) => {
      let y = 0, mo = -1, d = 0;
      if (i === 0) [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
      else if (i === 1) [d, mo, y] = [Number(m[1]), MONTH_INDEX(m[2]), Number(m[3] ?? 0)];
      else if (i === 2) [mo, d, y] = [MONTH_INDEX(m[1]), Number(m[2]), Number(m[3] ?? 0)];
      else [d, mo, y] = [Number(m[1]), Number(m[2]) - 1, Number(m[3].length === 2 ? `20${m[3]}` : m[3])];
      if (mo < 0 || mo > 11 || d < 1 || d > 31) return m[0];
      dates.push(y ? `${y}-${two(mo + 1)}-${two(d)}` : `--${two(mo + 1)}-${two(d)}`);
      return ' ';
    });
  });
  const numbers: string[] = [];
  s.replace(/(?<![\p{L}\d.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\p{L}\d.])-?\d+(?:\.\d+)?/gu, (n) => {
    const v = Number(n.replace(/,/g, ''));
    if (Number.isFinite(v)) numbers.push(String(v));
    return n;
  });
  return { dates, numbers, links };
}

/**
 * What a rewrite lost: each date, number and link of the old text not found in the new one (a date may change how it
 * is written, "10 Jan 2027" to 2027-01-10; one written without its year matches the same day in any year), and any
 * property the old text had that the new one dropped. Empty when nothing was lost.
 */
export function missingFacts(before: string, after: string): string[] {
  const a = factsOf(before), b = factsOf(after);
  const out: string[] = [];
  const has = (list: string[], x: string) => list.includes(x);
  const bDays = new Set(b.dates.map((d) => d.slice(-5)));
  for (const d of new Set(a.dates)) {
    if (d.startsWith('--') ? !bDays.has(d.slice(-5)) : !has(b.dates, d) && !has(b.dates, `--${d.slice(5)}`)) out.push(`the date ${d.startsWith('--') ? d.slice(2) : d}`);
  }
  // Numbers: each as many times as… at least once (a figure repeated in a summary may be said once after).
  const bNums = new Set(b.numbers);
  for (const n of new Set(a.numbers)) if (!bNums.has(n)) out.push(`the number ${n}`);
  const bLinks = new Set(b.links.map((l) => l.toLowerCase()));
  for (const l of new Set(a.links)) if (!bLinks.has(l.toLowerCase())) out.push(`the link ${l}`);
  const keysBefore = Object.keys(readProps(before)), keysAfter = new Set(Object.keys(readProps(after)));
  for (const k of keysBefore) if (!keysAfter.has(k)) out.push(`the property ${k}`);
  return out;
}

/** A rewrite's headings, for the summary the person sees ("Sections: Summary, Workstreams, Key dates…"). */
export function headingsOf(text: string): string[] {
  return sections(linesOf(text)).map((s) => s.heading);
}

/** Where the body starts in a note's lines (after its properties). Exported for the tools' own checks. */
export const bodyLine = (text: string) => bodyStart(text);

// For the former host app's built copy (tools/build-embedded.mjs → its desktop plugin's layout-writes.mjs): the log
// reading it finds logs with, from the dashboards' module, so both apps read a log the same way.
export { isLogProps, logsFor, parseLog } from './layouts';
