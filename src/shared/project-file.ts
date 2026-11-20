// A project's file: the one note that holds a project (docs/PROJECTS-DESIGN.md). Ironleaf's main process, its window
// and the former host app's runtime all read and write projects through this module (the former host app gets a
// built copy, see tools/build-embedded.mjs), so the two apps can never disagree about the format.
//
//   Projects/<Name>/<Name>.md
//   ---
//   type: project
//   status: active            idea · planning · active · on hold · done
//   health: at risk           on track · at risk · off track
//   progress: 95
//   owner, folder, started, due, updated, tags, neuralspark-project (the former host app's key for the folder)
//   ---
//   # Name
//   ## Summary · ## What's next · ## Key dates · ## People · ## Risks and issues · ## Decisions · ## Updates ·
//   ## Documents · ## Notes (the person's own: kept word for word), and any other section kept as written.
//
// Plain text people can read and change anywhere; no library needed (the former host app's runtime uses it as it
// is).

// The one shared read: whether a list line starts with a date ("2026-11-06: Retry fix live"). Sibling modules only,
// bundled into the one file the former host app gets, so the promise above stands.
import { readDay } from './timeline';
import { isBoxDone } from './finished';
import { cleanFileName, fitTypedName } from './paths';

// Each line may carry `more`: the indented lines written under it (a sub-list, a note), kept word for word.
export interface ProjectNext {
  done: boolean;
  what: string;
  who?: string;
  when?: string;
  more?: string;
  /** Lines written just before it in its section (a sub-heading over a group: "### By Mon 26 Oct"), kept above it. */
  before?: string;
  /** What followed its dash as written ("Ben · by 20 Nov · after: the quote"), with the who and when read from it: written
   *  back the same while they haven't changed (the parts in the person's order). */
  tail?: { text: string; who?: string; when?: string };
}
export interface ProjectDate {
  when: string;
  what: string;
  status?: string;
}
export interface ProjectPerson {
  name: string;
  role?: string;
  more?: string;
  /** Lines written just before it in its section (a sub-heading over a group: "### By Mon 26 Oct"), kept above it. */
  before?: string;
}
export interface ProjectRisk {
  level?: string;
  what: string;
  /** Dealt with: kept in the file, shown apart (written "*Closed:* 17 Oct 2026", or "Closed 17 Oct 2026" in a table's Status). */
  closed?: boolean;
  closedOn?: string;
  /** From a risks table: its Owner and Status as written. */
  owner?: string;
  status?: string;
  /** From a risks table: the row's cells as written, so columns the page doesn't show are written back the same. */
  cells?: string[];
  more?: string;
  /** Lines written just before it in its section (a sub-heading over a group: "### By Mon 26 Oct"), kept above it. */
  before?: string;
}
export interface ProjectDecision {
  date?: string;
  what: string;
  why?: string;
  more?: string;
  /** Lines written just before it in its section (a sub-heading over a group: "### By Mon 26 Oct"), kept above it. */
  before?: string;
}
export interface ProjectUpdate {
  date?: string;
  what: string;
  from?: string;
  more?: string;
  /** Lines written just before it in its section (a sub-heading over a group: "### By Mon 26 Oct"), kept above it. */
  before?: string;
}
export interface ProjectDocument {
  path: string;
  what?: string;
  /** Written as a link to a note or file ("[[Weekly Updates]]", "[[Attachments/a.xlsx|a.xlsx]]"): kept as that link. */
  link?: string;
  more?: string;
  /** Lines written just before it in its section (a sub-heading over a group: "### By Mon 26 Oct"), kept above it. */
  before?: string;
}

/** The lists in a project, by the name edits use. */
export type ProjectList = 'next' | 'dates' | 'people' | 'risks' | 'decisions' | 'updates' | 'documents';

export interface Project {
  name: string;
  status?: string;
  health?: string;
  progress?: number;
  owner?: string;
  /** The project's folder on this PC: its file store, shown live. */
  folder?: string;
  /** Where its code is kept (a Git remote, without any sign-in: github.com/owner/name), when it has code. */
  repository?: string;
  started?: string;
  due?: string;
  updated?: string;
  tags: string[];
  /** The former host app's key for the folder ("local:c:/…"), so the former host app finds the project when it works
there. */
  key?: string;
  /** How its page is laid out (docs/LAYOUTS.md; 21 Oct 2026): programme, site, register, fitness, wellbeing, venture. */
  layout?: string;
  summary: string;
  /**
   * Words between the title and the first ## heading when the file also has a Summary section ("Part of [[Desk Hub]]…"):
   * kept above the sections, where they were, never moved under the Summary heading (24 Oct 2026).
   */
  intro?: string;
  /** The summary was written above the sections with no heading of its own: written back there, the same. */
  summaryTop?: boolean;
  /** The known sections in the order the file has them ("summary", "next", "people"…): written back in that order. */
  order?: string[];
  next: ProjectNext[];
  dates: ProjectDate[];
  people: ProjectPerson[];
  risks: ProjectRisk[];
  decisions: ProjectDecision[];
  updates: ProjectUpdate[];
  documents: ProjectDocument[];
  /** The person's own words (## Notes), kept exactly. */
  notes: string;
  /**
   * Any other section, kept exactly. `after` is the known section it followed in the file ("summary" for one before
   * them all), so it is written back in its place; a section added later (no `after`) goes after the known ones.
   */
  extra: { heading: string; body: string; after?: string }[];
  /** Lines inside a known section that aren't one of its items (a paragraph, a sub-heading): kept, after the items. */
  rest?: Partial<Record<ProjectList, string>>;
  /** Properties of the person's own to set when written (a layout's go_live, target_weight…; null takes one off). */
  own?: Record<string, string | null>;
  /** The key dates table's header as the person wrote it ("| Date | Milestone | Status |"), written back the same. */
  datesHead?: string[];
  /** A risks table's header as the person wrote it ("| Risk | Impact | Owner | Status |"): its risks are its rows, written back as a table. */
  risksHead?: string[];
  /** A known section's heading as the person wrote it ("Files" for Documents, "Milestones" for Key dates), written back the same. */
  headings?: Partial<Record<string, string>>;
}

export const STATUSES = ['idea', 'planning', 'active', 'on hold', 'done'] as const;
export const HEALTHS = ['on track', 'at risk', 'off track'] as const;

type Section = 'summary' | 'next' | 'dates' | 'people' | 'risks' | 'decisions' | 'updates' | 'documents' | 'notes';
export const HEADINGS: Record<Section, string> = {
  summary: 'Summary',
  next: 'What’s next',
  dates: 'Key dates',
  people: 'People',
  risks: 'Risks and issues',
  decisions: 'Decisions',
  updates: 'Updates',
  documents: 'Documents',
  notes: 'Notes',
};
const ORDER: Section[] = ['summary', 'next', 'dates', 'people', 'risks', 'decisions', 'updates', 'documents', 'notes'];
// Headings people (and other tools) write for the same things.
const ALIASES: [RegExp, Section][] = [
  [/^(summary|about( this project)?|overview)$/i, 'summary'],
  [/^(what['’]s next|next steps?|next|to do|todo|actions?)$/i, 'next'],
  [/^(key dates|dates|milestones|timeline|schedule)$/i, 'dates'],
  [/^(people|stakeholders|team|contacts)$/i, 'people'],
  [/^(risks( and issues)?|issues|risks & issues)$/i, 'risks'],
  [/^(decisions|decision log)$/i, 'decisions'],
  [/^(updates|progress|log|activity log|history)$/i, 'updates'],
  [/^(documents|key (files|documents)|files)$/i, 'documents'],
  [/^(notes|my notes)$/i, 'notes'],
];

const FRONT = /^---\r?\n([\s\S]*?)\r?\n(---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const clean = (s: unknown, max = 2000) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// The Tasks list's own day mark on a step's line (5 Nov 2026: the list reads project steps too, and setting a
// step's day there writes the one plain "📅 day" — the step reads it as its day, never its owner or its words).
const DAY_MARK = /📅\s*(\d{4}-\d{1,2}-\d{1,2})(?:\s+(\d{1,2}:\d{2}))?/g;
// A fact written back out: tidied to one line, never cut short (5 Nov 2026, data safety: ticking a 5000-character step
// cut it to 400, and a 200-character owner set by hand came back as 120). Length caps bound new words where they come
// in (applyProjectEdit, the assistant's save); the file's own words, long or not, are written whole.
const emit = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const unquote = (v: string) => {
  const t = v.trim();
  if (/^".*"$/.test(t)) {
    try {
      return String(JSON.parse(t));
    } catch {
      return t.slice(1, -1);
    }
  }
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  return t;
};
const needsQuotes = (s: string) => s === '' || /^[\s\-?:,[\]{}#&*!|>'"%@`]|:\s|:$|\s#|\s$/.test(s) || /^(true|false|yes|no|null|on|off|~)$/i.test(s) || /^[\d.+-]+$/.test(s);
const yamlText = (s: string) => (needsQuotes(s) ? JSON.stringify(s) : s);

/**
 * A project file put right before it is read or written (18 Oct 2026: an assistant wrote "# Minecraft server" above the
 * properties, so the page had no health, next steps or dates, and every reply added another block). Every word is kept:
 * a byte-order mark goes; properties written below a title (or below blank lines) move to the top, the title staying
 * first in the body; a second block of properties straight after the first (or after the title) joins it, its keys
 * added where the first has none (a key both have keeps the first one's value, the other kept as `<key>-was`).
 * `repaired` says in words what was put right (empty when the file was already well formed).
 */
export function repairProjectText(text: string): { text: string; repaired: string[] } {
  let t = String(text ?? '');
  const repaired: string[] = [];
  if (t.startsWith('\uFEFF')) {
    t = t.replace(/^\uFEFF+/, '');
    repaired.push('took out a byte-order mark before the properties');
  }
  const isProps = (lines: string[]) => lines.some((l) => /^[A-Za-z][\w-]*:/.test(l)) && lines.every((l) => !l.trim() || /^[A-Za-z][\w-]*:/.test(l) || /^\s+\S/.test(l));
  // A block of properties at `at` (a "---" line): its lines and where it ends, or null. It may close with "...",
  // as the index and every note scan read it (5 Nov 2026, data safety: a "..." file read no properties at all).
  const blockAt = (lines: string[], at: number) => {
    if (!/^---[ \t]*$/.test(lines[at] ?? '')) return null;
    for (let j = at + 1; j < Math.min(lines.length, at + 200); j++) if (/^(---|\.\.\.)[ \t]*$/.test(lines[j])) return isProps(lines.slice(at + 1, j)) ? { props: lines.slice(at + 1, j), end: j } : null;
    return null;
  };
  let lines = t.split(/\r?\n/);
  const eol = /\r\n/.test(t) ? '\r\n' : '\n';
  if (!FRONT.test(t)) {
    // Up to a few lines before it: blank lines and one title.
    let i = 0, titles = 0;
    while (i < lines.length && i < 6 && (!lines[i].trim() || (/^#\s+\S/.test(lines[i]) && ++titles <= 1))) i++;
    const b = i > 0 ? blockAt(lines, i) : null;
    if (b) {
      const lead = lines.slice(0, i).filter((l) => l.trim());
      lines = ['---', ...b.props, '---', ...lead, ...lines.slice(b.end + 1).filter((l, k) => !(k === 0 && !l.trim() && !lead.length))];
      repaired.push(lead.length ? 'moved the properties above the title' : 'took out blank lines before the properties');
    }
  }
  // A second block of properties right after the first (blank lines and a title between them at most).
  const first = blockAt(lines, 0);
  if (first) {
    let i = first.end + 1, title = -1;
    while (i < lines.length && i < first.end + 6 && (!lines[i].trim() || (title < 0 && /^#\s+\S/.test(lines[i]) && (title = i) >= 0))) i++;
    const second = blockAt(lines, i);
    if (second) {
      const keyOf = (l: string) => /^([A-Za-z][\w-]*):/.exec(l)?.[1];
      const have = new Set(first.props.map(keyOf).filter(Boolean));
      const extra: string[] = [];
      let owner: string | undefined;
      for (const l of second.props) {
        const k = keyOf(l);
        if (k) owner = have.has(k) ? `${k}-was` : k;
        if (!l.trim()) continue;
        if (k && have.has(k)) {
          const was = first.props.find((x) => keyOf(x) === k) ?? '';
          if (was.trim() === l.trim()) { owner = undefined; continue; }
          if (have.has(`${k}-was`)) continue;
          extra.push(l.replace(/^[A-Za-z][\w-]*:/, `${k}-was:`));
          have.add(`${k}-was`);
        } else if (owner) extra.push(l);
      }
      lines = ['---', ...first.props, ...extra, '---', ...lines.slice(first.end + 1, i).filter((l) => l.trim()), ...(title >= 0 ? [''] : []), ...lines.slice(second.end + 1).filter((l, k) => !(k === 0 && !l.trim() && title < 0))];
      repaired.push('joined a second block of properties to the first');
    }
  }
  return { text: repaired.length ? lines.join(eol) : t, repaired };
}

/** The properties a project file keeps, in the order they are written. */
const KEYS = ['type', 'layout', 'status', 'health', 'progress', 'owner', 'folder', 'repository', 'started', 'due', 'updated', 'tags', 'neuralspark-project'] as const;

/**
 * The properties: each line, the key it belongs to (a YAML list written one item a line belongs to its key), and the
 * values (a list written that way read as [a, b]).
 */
function readFront(text: string): { lines: string[]; owners: (string | null)[]; values: Record<string, string>; body: string; close: string } {
  const m = FRONT.exec(text);
  if (!m) return { lines: [], owners: [], values: {}, body: text, close: '---' };
  const lines = m[1].split(/\r?\n/);
  const owners: (string | null)[] = [];
  const values: Record<string, string> = {};
  let open: string | null = null;
  const items: Record<string, string[]> = {};
  for (const line of lines) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      values[kv[1]] = kv[2];
      open = kv[2].trim() === '' ? kv[1] : null;
      owners.push(kv[1]);
      continue;
    }
    const item = open ? /^\s+-\s*(.*)$/.exec(line) ?? (/^\s*$/.test(line) ? null : /^\s+(.*)$/.exec(line)) : null;
    if (open && item) {
      if (/^\s+-/.test(line)) (items[open] ??= []).push(item[1]);
      owners.push(open);
    } else {
      open = null;
      owners.push(null);
    }
  }
  for (const [k, list] of Object.entries(items)) if (list.length) values[k] = `[${list.map((x) => unquote(x)).join(', ')}]`;
  return { lines, owners, values, body: text.slice(m[0].length), close: m[2] === '...' ? '...' : '---' };
}

function readList(v: string | undefined): string[] {
  if (!v) return [];
  const t = v.trim();
  const inner = /^\[(.*)\]$/.exec(t)?.[1] ?? t;
  return inner
    .split(',')
    .map((x) => unquote(x).replace(/^#/, '').trim())
    .filter(Boolean);
}

/** "**bold** — rest", "bold — rest", "date: rest" or "lead: rest" pieces of a list line. */
function splitLead(line: string): { lead: string; rest: string } {
  const bold = /^\*\*(.+?)\*\*\s*(?:[—–:·-]\s*)?(.*)$/.exec(line);
  if (bold) return { lead: bold[1].trim(), rest: bold[2].trim() };
  const dash = /^(.+?)\s+[—–]\s+(.*)$/.exec(line);
  if (dash) return { lead: dash[1].trim(), rest: dash[2].trim() };
  // A plain "2026-11-06: Retry fix live" lead (5 Nov 2026, v9-vault-truth: the seed vault writes key dates and
  // decisions this way, and the page said "No milestones yet" while they existed). Short and unpunctuated, so a
  // bracket's colon ("… (owner: Sam, level: low)") never splits and a sentence past four words stays whole.
  const colon = /^([^:()]{1,48}?):\s+(.+)$/.exec(line);
  if (colon) {
    const lead = colon[1].trim();
    const rest = colon[2].trim();
    if (lead && rest && !/[.?!]/.test(lead) && lead.split(/\s+/).length <= 4) return { lead, rest };
  }
  // A date before the colon the short rule misses ("Fri 6 Nov 2026, 11:00: doors", 5 Nov 2026, folio F5: key dates
  // written so never read, so Next milestones said none while the file held two). Only a date splits here: any
  // other long or punctuated lead keeps the line whole, as before.
  const dated = /^(.+?)\s*:\s+(.*)$/.exec(line);
  if (dated && readDay(dated[1].trim()) !== null) return { lead: dated[1].trim(), rest: dated[2].trim() };
  return { lead: '', rest: line.trim() };
}

/**
 * A section's list: each item (a top-level "- " line) with the indented lines under it, and every other line kept as
 * written (`rest`), so nothing the person wrote is lost when the page writes the file back.
 */
function scan(body: string, keep: (line: string) => boolean = () => false): { items: { text: string; more?: string; before?: string; raw: string }[]; rest: string[] } {
  const items: { text: string; more: string[]; before?: string; raw: string }[] = [];
  // Lines that aren't items (a "### By Mon 26 Oct" over a group, a paragraph): kept just above the item that follows
  // them, as written (24 Oct 2026: they were written after all the items on every change, so a hub's groups lost their
  // headings); those after the last item are the section's other lines (rest).
  let pending: string[] = [];
  let gap = false;
  let current: { text: string; more: string[]; before?: string; raw: string } | null = null;
  for (const line of body.split(/\r?\n/)) {
    if (keep(line)) {
      current = null;
      continue;
    }
    const b = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (b && (b[1].length < 2 || !current) && b[2].trim()) {
      current = { text: b[2], more: [], raw: line };
      if (pending.length) current.before = [...(gap && items.length ? [''] : []), ...pending].join('\n');
      pending = [];
      gap = false;
      items.push(current);
    } else if (current && /^\s{2,}\S/.test(line)) current.more.push(line);
    else if (line.trim()) {
      current = null;
      pending.push(line);
    } else if (current) {
      current = null;
      gap = true;
    } else if (pending.length && pending[pending.length - 1] !== '') pending.push('');
    else if (!pending.length) gap = true;
  }
  const rest = pending;
  while (rest.length && rest[rest.length - 1] === '') rest.pop();
  return { items: items.map((i) => ({ text: i.text, ...(i.more.length ? { more: i.more.join('\n') } : {}), ...(i.before ? { before: i.before } : {}), raw: i.raw })), rest };
}
const withMore = <T extends object>(item: T, more?: string, before?: string): T => (more || before ? { ...item, ...(more ? { more } : {}), ...(before ? { before } : {}) } : item);
// A line as the file wrote it, kept on what was read so a save writes back only what changed (4 Nov 2026: a catch-up
// reworded three steps and every line was rewritten, en dashes to em dashes). Non-enumerable: never in JSON or tests.
const RAW = Symbol('projectRawLine');
const setRaw = <T extends object>(item: T, raw: string): T => {
  Object.defineProperty(item, RAW, { value: raw, enumerable: false, writable: true });
  return item;
};
const getRaw = (item: unknown): string | undefined => (item && typeof item === 'object' ? (item as Record<symbol, unknown>)[RAW] as string | undefined : undefined);
const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l);

function tableRows(body: string): string[][] {
  const rows = body
    .split(/\r?\n/)
    .filter((l) => /^\s*\|.*\|\s*$/.test(l))
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((c) => c.replace(/\\\|/g, '|').trim()),
    );
  // Without its header and the --- row.
  return rows.filter((r, i) => !(i === 0 && rows[1] && rows[1].every((c) => /^:?-{2,}:?$/.test(c))) && !r.every((c) => /^:?-{2,}:?$/.test(c)));
}

/** A table's data lines as written, in the same order as tableRows: lines a list cannot fully read are kept from these. */
function tableRowLines(body: string): string[] {
  const lines = body.split(/\r?\n/).filter((l) => /^\s*\|.*\|\s*$/.test(l));
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
  const rows = lines.map(cells);
  return lines.filter((_, i) => !(i === 0 && rows[1] && rows[1].every((c) => /^:?-{2,}:?$/.test(c))) && !rows[i].every((c) => /^:?-{2,}:?$/.test(c)));
}

/** A table's header and separator lines as written, when it has a header. */
function tableHeadLines(body: string): string[] {
  const lines = body.split(/\r?\n/).filter((l) => /^\s*\|.*\|\s*$/.test(l));
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
  return lines.length >= 2 && cells(lines[1]).every((c) => /^:?-{2,}:?$/.test(c)) ? lines.slice(0, 2) : [];
}

/** A table's header cells, when it has a header (a --- row under its first line). */
function tableHead(body: string): string[] | null {
  const lines = body.split(/\r?\n/).filter((l) => /^\s*\|.*\|\s*$/.test(l));
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
  return lines.length >= 2 && cells(lines[1]).every((c) => /^:?-{2,}:?$/.test(c)) ? cells(lines[0]) : null;
}

// A risks table's columns (docs/LAYOUTS.md: | Risk | Impact | Owner | Status |), found by their names.
const RISK_COLS = { what: /^(risks?|issues?|risks? (and|&|or) issues?|what|description)$/i, level: /^(impact|level|severity|rating|priority)$/i, owner: /^(owner|who)$/i, status: /^(status|state)$/i };
const riskCol = (head: string[], re: RegExp) => head.findIndex((h) => re.test(h.trim()));
const CLOSED_WORD = /^(closed|done|resolved|mitigated)\b/i;
const LEVEL_WORD = /^(low|medium|high|critical)$/i;

/** A risk bullet's tail as the person writes it ("… (owner: Sam, level: low)", either part alone, any order):
 *  split for display, so no page reads file syntax (vault rebuild step 2). Only a trailing bracket whose every
 *  part is owner or level splits — anything else stays whole, never guessed. The file keeps its line; tables
 *  keep their cells. Pure. */
export interface RiskTail {
  what: string;
  owner?: string;
  level?: string;
  /** The tail as written ("owner: Sam, level: low", '' when none): edits keep it on the line. */
  tail: string;
}

export function splitRiskTail(what: string): RiskTail {
  const line = String(what ?? '');
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(line);
  if (!m) return { what: line, tail: '' };
  let owner: string | undefined;
  let level: string | undefined;
  for (const part of m[2].split(',').map((s) => s.trim()).filter(Boolean)) {
    const o = /^owner\s*:\s*(.+)$/i.exec(part);
    if (o) {
      owner = o[1].trim();
      continue;
    }
    const l = /^(?:level|impact)\s*:\s*(.+)$/i.exec(part);
    if (l) {
      level = l[1].trim();
      continue;
    }
    return { what: line, tail: '' };
  }
  if (!owner && !level) return { what: line, tail: '' };
  return { what: m[1].trim(), ...(owner ? { owner } : {}), ...(level ? { level } : {}), tail: m[2].trim() };
}

/** A risks table's rows as risks (a closed Status shown apart; the row kept for the columns the page doesn't show). */
function riskRows(head: string[], rows: string[][], raw?: string[]): ProjectRisk[] {
  const [wi, li, oi, si] = [riskCol(head, RISK_COLS.what), riskCol(head, RISK_COLS.level), riskCol(head, RISK_COLS.owner), riskCol(head, RISK_COLS.status)];
  const out: ProjectRisk[] = [];
  for (let n = 0; n < rows.length; n++) {
    const r = rows[n];
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const what = cell(wi);
    if (!what || r.length > head.length) continue;
    const level = cell(li);
    const status = cell(si);
    const shut = CLOSED_WORD.exec(status);
    const on = shut ? status.slice(shut[0].length).replace(/^[\s:,—–-]+/, '').trim() : '';
    out.push(setRaw({
      what,
      ...(LEVEL_WORD.test(level) ? { level: level.toLowerCase() } : {}),
      ...(cell(oi) ? { owner: cell(oi) } : {}),
      ...(status ? { status } : {}),
      ...(shut ? { closed: true, ...(on ? { closedOn: on } : {}) } : {}),
      cells: head.map((_, i) => cell(i)),
    }, raw?.[n] ?? ''));
  }
  return out;
}

/** A risk as a row of the person's risks table: what, level, owner and status where they are, the rest as written. */
function riskRow(head: string[], r: ProjectRisk): string[] {
  const [wi, li, oi, si] = [riskCol(head, RISK_COLS.what), riskCol(head, RISK_COLS.level), riskCol(head, RISK_COLS.owner), riskCol(head, RISK_COLS.status)];
  const cells = head.map((_, i) => r.cells?.[i] ?? '');
  if (wi >= 0) cells[wi] = r.what;
  // A level the page took off ("Not said") empties the cell; a word of the person's own that isn't a level stays.
  if (li >= 0) cells[li] = r.level ? r.level.charAt(0).toUpperCase() + r.level.slice(1) : LEVEL_WORD.test(cells[li]) ? '' : cells[li];
  // (an owner or status taken off on the page empties its cell; one the page never read stays as written)
  if (oi >= 0 && (r.owner !== undefined || r.cells)) cells[oi] = r.owner ?? '';
  if (si >= 0) {
    const was = r.status ?? r.cells?.[si] ?? '';
    cells[si] = r.closed ? (CLOSED_WORD.test(was) ? was : `Closed${r.closedOn ? ` ${r.closedOn}` : ''}`) : CLOSED_WORD.test(was) || !r.cells ? 'Open' : was;
  }
  return cells;
}

/** The former host app's key for a project, kept in step with its folder field (8.0 R4, linked both ways): a folder on
 *  this PC names its own local key, so the former host app's workspace folder and the project file's folder field
 *  can never drift apart, whoever set the folder. A remote key (another computer's workspace) is kept as it is. */
export function linkedKey(folder: string | undefined, key: string | undefined): string | undefined {
  const k = String(key ?? '').trim();
  if (/^remote:/i.test(k)) return k || undefined;
  const f = String(folder ?? '').trim();
  return f ? projectKey(f) : k || undefined;
}

/** Reads a project file (or anything close to one: headings and lines people write by hand are understood). */
export function parseProject(text: string, fileName = ''): Project {
  const { values, body } = readFront(repairProjectText(String(text ?? '')).text);
  const v = (k: string) => (values[k] !== undefined ? unquote(values[k]) : undefined);
  const progress = v('progress') !== undefined ? Number(String(v('progress')).replace(/%$/, '')) : undefined;
  const project: Project = {
    name: '',
    status: v('status') || undefined,
    health: v('health') || undefined,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress!)) : undefined,
    owner: v('owner') || undefined,
    folder: v('folder') || undefined,
    ...(v('repository') ? { repository: v('repository') } : {}),
    started: v('started') || undefined,
    due: v('due') || undefined,
    updated: v('updated') || undefined,
    tags: readList(values.tags),
    key: linkedKey(v('folder') || undefined, v('neuralspark-project') || undefined),
    ...(v('layout') ? { layout: v('layout') } : {}),
    summary: '',
    next: [],
    dates: [],
    people: [],
    risks: [],
    decisions: [],
    updates: [],
    documents: [],
    notes: '',
    extra: [],
  };
  const lines = body.split(/\r?\n/);
  const title = lines.findIndex((l) => /^#\s+\S/.test(l));
  project.name = title >= 0 ? lines[title].replace(/^#\s+/, '').trim() : fileName.replace(/\.md$/i, '').split('/').pop() || 'Untitled project';
  // Sections by their ## headings; words before the first heading count as the summary.
  const sections: { heading: string; body: string[] }[] = [{ heading: '', body: [] }];
  for (let i = 0; i < lines.length; i++) {
    if (i === title) continue;
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (h) sections.push({ heading: h[1].trim(), body: [] });
    else sections[sections.length - 1].body.push(lines[i]);
  }
  const keepRest = (kind: ProjectList, rest: string[]) => {
    if (!rest.length) return;
    project.rest ??= {};
    project.rest[kind] = [project.rest[kind], rest.join('\n')].filter(Boolean).join('\n\n');
  };
  let lastKnown: Section = 'summary';
  let top = '';
  let summaryHeading = false;
  for (const s of sections) {
    const text = s.body.join('\n').replace(/^\s*\n|\n\s*$/g, '');
    if (!s.heading) {
      top = text.trim();
      continue;
    }
    const kind = ALIASES.find(([re]) => re.test(s.heading))?.[1];
    if (!kind) {
      project.extra.push({ heading: s.heading, body: text, after: lastKnown });
      continue;
    }
    lastKnown = kind;
    if (!project.order?.includes(kind)) project.order = [...(project.order ?? []), kind];
    if (s.heading !== HEADINGS[kind] && !project.headings?.[kind]) project.headings = { ...(project.headings ?? {}), [kind]: s.heading };
    if (kind === 'summary') {
      summaryHeading = true;
      project.summary = [project.summary, text.trim()].filter(Boolean).join('\n\n');
      continue;
    }
    if (kind === 'notes') {
      project.notes = text;
      continue;
    }
    // A table of key dates is read as one; any other line in the section is kept as written.
    const rows = kind === 'dates' ? tableRows(text) : [];
    if (kind === 'dates' && rows.length) {
      const head = tableHead(text);
      if (head && head.length === 3 && !/^when$/i.test(head[0])) project.datesHead = head;
      setHeadRaw(project, 'dates', tableHeadLines(text));
    }
    // So is a risks table with a Risk (or Issue) column: each row a risk, written back as the same table.
    const riskHead = kind === 'risks' ? tableHead(text) : null;
    const riskTable = !!riskHead && riskCol(riskHead, RISK_COLS.what) >= 0 && !project.risksHead;
    const readRisks = riskTable ? riskRows(riskHead!, tableRows(text), tableRowLines(text)) : [];
    if (riskTable) {
      project.risksHead = riskHead!;
      setHeadRaw(project, 'risks', tableHeadLines(text));
      project.risks.push(...readRisks);
    }
    const { items, rest } = scan(text, (kind === 'dates' && rows.length) || riskTable ? isTableLine : undefined);
    const unread = [...rest];
    // A table row a list cannot fully read (no risk of its own, more cells than the table has) is kept as written.
    if (riskTable) {
      const wi = riskCol(riskHead!, RISK_COLS.what);
      const dropped = tableRows(text).flatMap((r, i) => (!r[wi]?.trim() || r.length > riskHead!.length ? [tableRowLines(text)[i]] : [])).filter(Boolean);
      if (dropped.length) unread.push(...(readRisks.length ? [] : tableHeadLines(text)), ...dropped);
    }
    const lost = (i: { text: string; more?: string; before?: string; raw: string }) => unread.push(...(i.before ? [i.before] : []), i.raw, ...(i.more ? [i.more] : []));
    switch (kind) {
      case 'next':
        for (const i of items) {
          // Any mark reads, through the one box rule (5 Nov 2026, u3 moving-in: `[-]` leaked into the words as open).
          const box = /^\[([^\]])\]\s*(.*)$/.exec(i.text);
          const done = !!box && isBoxDone(box[1]);
          let what = (box ? box[2] : i.text).trim();
          let who: string | undefined;
          let when: string | undefined;
          const tail = /\s+[—–]\s+(.+)$/.exec(what);
          if (tail) {
            what = what.slice(0, tail.index).trim();
            // "— Who · by when", "— Who — due when", "— Who, due when": the date part is when, never a person
            // (p16-owner-tail, 4 Nov 2026: a date in an owner line is never a person); every other part is kept, in
            // order, as who (a day written without its lead word, a note after). A second dash or a comma only splits
            // before by/due, so a real name with a hyphen or a dash inside stays whole.
            const others: string[] = [];
            const segments = tail[1]
              .split(/\s+·\s+/)
              .flatMap((seg) => seg.split(/\s+[—–]\s+(?=(?:by|due)\s+)/i))
              .flatMap((seg) => seg.split(/,\s*(?=(?:by|due)\s+)/i));
            for (const part of segments) {
              const lead = /^(?:by|due)\s+(.+)$/i.exec(part.trim());
              if (lead && when === undefined) when = lead[1].trim();
              else if (part.trim()) others.push(part.trim());
            }
            if (others.length) who = others.join(' · ');
          }
          // The Tasks day mark, wherever the line carries it (a tail "— Alex 📅 2026-11-04", or straight on the
          // words when the step names nobody): it is the step's day. Read from the words and the owner, kept in
          // the tail as written (so an untouched line writes back byte for byte); a by/due tail still wins.
          let markWhen: string | undefined;
          const stripMark = (s: string): string => {
            let hit = false;
            const out = s.replace(DAY_MARK, (_m, day: string, time: string | undefined) => {
              hit = true;
              if (markWhen === undefined) markWhen = time ? `${day} ${time}` : day;
              return '';
            });
            return hit ? out.replace(/\s{2,}/g, ' ').trim() : s;
          };
          what = stripMark(what);
          if (who !== undefined) {
            const cleaned = stripMark(who);
            who = cleaned ? cleaned : undefined;
          }
          if (when === undefined) when = markWhen;
          // Kept as written only when writing who · by when again would put its parts in another order.
          const written = tail?.[1].trim() ?? '';
          const asWritten = !!tail && written !== [who ?? '', when ? `by ${when}` : ''].filter(Boolean).join(' · ');
          if (what) project.next.push(setRaw(withMore({ done, what, ...(who ? { who } : {}), ...(when ? { when } : {}), ...(asWritten ? { tail: { text: written, ...(who ? { who } : {}), ...(when ? { when } : {}) } } : {}) }, i.more, i.before), i.raw));
          else lost(i);
        }
        break;
      case 'dates': {
        // A row with a milestone but no date is a milestone not yet dated: kept as a key date with no date.
        // A row the three cells cannot hold (no milestone, extra cells) is kept as written, never dropped.
        const rawDates = tableRowLines(text);
        const datesBefore = project.dates.length;
        rows.forEach((r, i) => {
          if (r[1] && r.length <= 3) project.dates.push(setRaw({ when: r[0] ?? '', what: r[1], ...(r[2] && r[2] !== '—' ? { status: r[2] } : {}) }, rawDates[i] ?? ''));
          else if (rawDates[i]) unread.push(rawDates[i]);
        });
        if (rows.length && project.dates.length === datesBefore) unread.unshift(...tableHeadLines(text));
        // Bullets read as dates too — beside a table or on their own — so a write leaves one shape, never two
        // (5 Nov 2026, v8-vault-assistant: old bullets survived beside the new table). A lead is bold, a dash or a
        // colon ("2026-11-06: live", "Fri 6: review"); anything else stays as written, never dropped.
        for (const i of items) {
          const line = i.text.replace(/^\[[ xX]\]\s*/, '');
          const { lead, rest: words } = splitLead(line);
          const colon = !lead ? /^(.{1,40}?)\s*:\s+(\S.*)$/.exec(line) : null;
          const when = lead || colon?.[1].trim() || '';
          const what = (lead ? words : colon?.[2].trim()) || '';
          if (when && what && !i.more) project.dates.push(setRaw({ when, what }, i.raw));
          else lost(i);
        }
        break;
      }
      case 'people':
        for (const i of items) {
          const { lead, rest: words } = splitLead(i.text);
          project.people.push(setRaw(withMore(lead ? { name: lead, ...(words ? { role: words } : {}) } : { name: words }, i.more, i.before), i.raw));
        }
        break;
      case 'risks':
        for (const i of items) {
          const shut = /\s*\*Closed(?::\*\s*(.*?)|\.?\*)\s*$/.exec(i.text);
          const line = shut ? i.text.slice(0, shut.index) : i.text;
          const { lead, rest: words } = splitLead(line);
          const risk: ProjectRisk = lead && /^(high|medium|low|critical)$/i.test(lead) ? { level: lead.toLowerCase(), what: words } : { what: lead ? `${lead} — ${words}` : words };
          if (shut) {
            risk.closed = true;
            if (shut[1]?.trim()) risk.closedOn = shut[1].trim();
          }
          project.risks.push(setRaw(withMore(risk, i.more, i.before), i.raw));
        }
        break;
      case 'decisions':
        for (const i of items) {
          const { lead, rest: words } = splitLead(i.text);
          const why = /\s*\*Why:\*\s*(.+)$/.exec(words);
          const what = (why ? words.slice(0, why.index) : words).trim();
          project.decisions.push(setRaw(withMore({ ...(lead ? { date: lead } : {}), what: what || lead, ...(why ? { why: why[1].trim() } : {}) }, i.more, i.before), i.raw));
        }
        break;
      case 'updates':
        for (const i of items) {
          const { lead, rest: words } = splitLead(i.text);
          const from = /\s*\*From:\*\s*(.+)$/.exec(words);
          const what = (from ? words.slice(0, from.index) : words).trim();
          project.updates.push(setRaw(withMore({ ...(lead ? { date: lead } : {}), what: what || lead, ...(from ? { from: from[1].trim() } : {}) }, i.more, i.before), i.raw));
        }
        break;
      case 'documents':
        for (const i of items) {
          let code: RegExpExecArray | string[] | null = /^`([^`]+)`\s*(?:[—–:·-]\s*(.*))?$/.exec(i.text.trim());
          // "`Report.pdf — the final one`": the file's name and its words written together inside the quotes (27 Oct 2026:
          // the side chat wrote them so, and the project page opened none of them).
          if (code && !code[2] && !/\.[A-Za-z0-9]{2,5}$/.test(code[1].trim())) {
            const split = /^(.+?\.[A-Za-z0-9]{2,5})\s+[—–-]\s+(.+)$/.exec(code[1].trim());
            if (split) code = [code[0], split[1], split[2]];
          }
          const link = code ? null : /^(\[\[([^\]|]+)(?:\|[^\]]*)?\]\])\s*(?:[—–:·-]\s*(.*))?$/.exec(i.text.trim());
          if (code) project.documents.push(setRaw(withMore({ path: code[1].trim(), ...(code[2] ? { what: code[2].trim() } : {}) }, i.more, i.before), i.raw));
          else if (link) project.documents.push(setRaw(withMore({ path: link[2].trim(), link: link[1], ...(link[3] ? { what: link[3].trim() } : {}) }, i.more, i.before), i.raw));
          else {
            const { lead, rest: words } = splitLead(i.text);
            if (lead) project.documents.push(setRaw(withMore({ path: lead, ...(words ? { what: words } : {}) }, i.more, i.before), i.raw));
            else lost(i);
          }
        }
        break;
    }
    keepRest(kind, unread);
  }
  // The usual order with a Notes section: nothing to remember.
  if (project.order && project.order.includes('notes') && project.order.every((k, i, all) => i === 0 || ORDER.indexOf(all[i - 1] as Section) < ORDER.indexOf(k as Section))) delete project.order;
  // Words above the sections: the file's own introduction when it has a Summary section too, else its summary.
  if (top && summaryHeading) project.intro = top;
  else if (top) {
    project.summary = top;
    project.summaryTop = true;
  }
  return project;
}

const cell = (s: string) => emit(s).replace(/\|/g, '\\|');

// A date as its ISO day, for the two shapes files use ("2026-10-16", "16 Oct 2026"): null for anything else (a time, a
// phrase, an undated line). Self-contained: this module reaches the former host app's runtime with no library.
export const isoDayOf = (text: string | undefined): string | null => {
  const t = String(text ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) {
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return dt.getFullYear() === Number(m[1]) && dt.getMonth() === Number(m[2]) - 1 && dt.getDate() === Number(m[3]) ? t : null;
  }
  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(t);
  if (!m) return null;
  const mon = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }[m[2].toLowerCase().slice(0, 3) as 'jan'];
  if (mon === undefined) return null;
  const dt = new Date(Number(m[3]), mon, Number(m[1]));
  return dt.getFullYear() === Number(m[3]) && dt.getMonth() === mon && dt.getDate() === Number(m[1]) ? `${m[3]}-${String(mon + 1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}` : null;
};

// Whether two lines say the same thing (their kept parts, not how they were written): an unchanged line is written
// back as it was, byte for byte. A date counts the same in either shape ("16 Oct 2026" is "2026-10-16").
const sameLine = (list: ProjectList, a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
  const eq = (...keys: string[]) => keys.every((k) => (a[k] ?? '') === (b[k] ?? ''));
  const eqDay = (k: string) => {
    const [x, y] = [a[k] as string | undefined, b[k] as string | undefined];
    if ((x ?? '') === (y ?? '')) return true;
    const [ix, iy] = [isoDayOf(x), isoDayOf(y)];
    return !!ix && ix === iy;
  };
  switch (list) {
    case 'next': return eq('done', 'what', 'who') && eqDay('when');
    case 'dates': return eqDay('when') && eq('what', 'status');
    case 'people': return eq('name', 'role');
    case 'risks': return eq('level', 'what', 'closed', 'owner', 'status') && eqDay('closedOn');
    case 'decisions': return eqDay('date') && eq('what', 'why');
    case 'updates': return eqDay('date') && eq('what', 'from');
    case 'documents': return eq('path', 'what', 'link');
  }
};

// A table's header lines as the file wrote them (kept on what was read, as its lines are).
const HEAD_RAW = Symbol('projectHeadRaw');
const setHeadRaw = (p: Project, kind: 'dates' | 'risks', lines: string[]): void => {
  const kept = ((p as unknown as Record<symbol, unknown>)[HEAD_RAW] as Record<string, string[]> | undefined) ?? {};
  if (!kept[kind] && lines.length) {
    kept[kind] = lines;
    Object.defineProperty(p, HEAD_RAW, { value: kept, enumerable: false, writable: true });
  }
};
const getHeadRaw = (p: Project | null, kind: 'dates' | 'risks'): string[] | undefined => (p && typeof p === 'object' ? ((p as unknown as Record<symbol, unknown>)[HEAD_RAW] as Record<string, string[]> | undefined)?.[kind] : undefined);

/**
 * What's still to do, in order: the open What's next lines, else the open tick boxes in a section of the person's own (a
 * run sheet's phases), each without its "— who · by when". For lists that show a project's next step.
 */
export function openSteps(p: Project): string[] {
  const own = p.next.filter((n) => !n.done).map((n) => n.what);
  if (own.length) return own;
  const out: string[] = [];
  for (const x of p.extra)
    for (const l of x.body.split(/\r?\n/)) {
      const m = /^\s*[-*+]\s+\[ \]\s+(.+)$/.exec(l);
      if (m) out.push(m[1].replace(/\s+[—–]\s+.*$/, '').trim());
    }
  return out.filter(Boolean);
}

/** Writes a project file. With the file as it was, only the lines an edit touched change; the rest stay byte for byte. */
export function serializeProject(p: Project, previous = ''): string {
  const front = readFront(repairProjectText(String(previous ?? '')).text);
  const { lines: oldLines, owners, values: oldValues } = front;
  // A blank line the file keeps after its properties stays (hand-written files have one).
  const frontGap = previous && /^\s*\n/.test(front.body) ? '\n' : '';
  // What the file held: unchanged lines are written back as they were, and a date the file already holds keeps the
  // shape it was written in ("16 Oct 2026", never rewritten to ISO by a reworded step).
  const orig = previous ? parseProject(previous) : null;
  // Whether the key dates say something new (5 Nov 2026 polish list item 6: unchanged dates stay as written, so a
  // tick never reformats list-form key dates; only changed dates are written as the one table, v8 F12).
  const datesChanged = !orig || p.dates.length !== orig.dates.length || (() => {
    const pool = orig.dates.map((d) => ({ d, used: false }));
    return !p.dates.every((cur) => {
      const f = pool.find((c) => !c.used && sameLine('dates', cur as unknown as Record<string, unknown>, c.d as unknown as Record<string, unknown>));
      if (!f) return false;
      f.used = true;
      return true;
    });
  })();
  const dateStyle = new Map<string, string>();
  // How many dates each list already holds in each shape (5 Nov 2026, p24-date-shape: a catch-up wrote
  // "by 2026-11-06" and "by 9 Nov 2026" into one file whose other lines all say "by 29 Oct 2026").
  const listShape = new Map<ProjectList, { iso: number; dmy: number }>();
  const fileShape = { iso: 0, dmy: 0 };
  if (orig) {
    const addDate = (list: ProjectList, t: string | undefined) => {
      if (!t) return;
      const iso = isoDayOf(t);
      if (!iso) return;
      if (!dateStyle.has(iso)) dateStyle.set(iso, t.trim());
      const isoShape = /^\d{4}-\d{2}-\d{2}$/.test(t.trim());
      const counts = listShape.get(list) ?? { iso: 0, dmy: 0 };
      if (isoShape) counts.iso++;
      else counts.dmy++;
      listShape.set(list, counts);
      if (isoShape) fileShape.iso++;
      else fileShape.dmy++;
    };
    for (const n of orig.next) addDate('next', n.when);
    for (const d of orig.dates) addDate('dates', d.when);
    for (const x of orig.decisions) addDate('decisions', x.date);
    for (const u of orig.updates) addDate('updates', u.date);
    for (const r of orig.risks) addDate('risks', r.closedOn);
  }
  // The shape a list already uses (its own dates, else the file's; a tie keeps the person's dmy over the model's
  // ISO): null when the file holds no dates at all, so a new date keeps the app's normal shape.
  const targetShape = (list: ProjectList): 'iso' | 'dmy' | null => {
    const own = listShape.get(list);
    const pick = (c: { iso: number; dmy: number }) => (c.iso + c.dmy > 0 ? (c.dmy > 0 && c.dmy >= c.iso ? 'dmy' : 'iso') : null);
    return (own && pick(own)) ?? pick(fileShape);
  };
  const DMY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const asDmy = (iso: string): string => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${DMY_MONTHS[m - 1]} ${y}`;
  };
  // A new or changed date takes the shape the file already uses for dates on that list (key dates and decisions go
  // through here too, the one path). A date the file already holds for that day keeps its own words; anything that
  // is not a real date stays as it is.
  const keepStyle = (t: string | undefined, list: ProjectList): string | undefined => {
    if (!t) return t;
    const iso = isoDayOf(t);
    if (!iso) return t;
    const same = dateStyle.get(iso);
    if (same) return same;
    const want = targetShape(list);
    if (!want) return t;
    const isIso = /^\d{4}-\d{2}-\d{2}$/.test(t.trim());
    if ((want === 'iso') === isIso) return t;
    return want === 'iso' ? iso : asDmy(iso);
  };
  // Each list as it was, each line once: a line still saying the same thing is written back as it was.
  const pools = orig ? (Object.fromEntries((['next', 'dates', 'people', 'risks', 'decisions', 'updates', 'documents'] as ProjectList[]).map((list) => [list, (orig[list] as unknown as Record<string, unknown>[]).map((item) => ({ item, raw: getRaw(item), used: false }))])) as Record<ProjectList, { item: Record<string, unknown>; raw: string | undefined; used: boolean }[]>) : null;
  const keptRaw = (list: ProjectList, current: Record<string, unknown>): string | null => {
    if (!pools) return null;
    // Key dates keep their lines while they say the same things; only changed dates are written as the one table.
    const tableOnly = list === 'dates' && datesChanged;
    const found = pools[list].find((c) => !c.used && c.raw && (!tableOnly || c.raw.trim().startsWith('|')) && sameLine(list, current, c.item));
    if (!found) return null;
    found.used = true;
    return found.raw!;
  };
  const values: Record<string, string | undefined> = {
    type: 'project',
    status: p.status ? yamlText(emit(p.status)) : undefined,
    health: p.health ? yamlText(emit(p.health)) : undefined,
    progress: typeof p.progress === 'number' && Number.isFinite(p.progress) ? String(Math.round(Math.max(0, Math.min(100, p.progress)))) : undefined,
    owner: p.owner ? yamlText(emit(p.owner)) : undefined,
    folder: p.folder ? yamlText(emit(p.folder)) : undefined,
    repository: p.repository ? yamlText(emit(p.repository)) : undefined,
    started: p.started ? yamlText(emit(p.started)) : undefined,
    due: p.due ? yamlText(emit(p.due)) : undefined,
    updated: p.updated ? yamlText(emit(p.updated)) : undefined,
    tags: p.tags.length ? `[${p.tags.map((t) => emit(t).replace(/[,[\]]/g, ' ').trim()).filter(Boolean).join(', ')}]` : undefined,
    'neuralspark-project': linkedKey(p.folder, p.key) ? yamlText(emit(linkedKey(p.folder, p.key)!)) : undefined,
    layout: p.layout ? yamlText(emit(p.layout)) : undefined,
  };
  const out: string[] = [];
  const seen = new Set<string>();
  // The person's own properties stay where they were; ours are set (or dropped when emptied).
  const own = p.own ?? {};
  // A number of the person's own is written as a number ("target_weight: 110"), as they write them.
  const ownText = (v: string) => (/^-?\d+(?:\.\d+)?$/.test(emit(v)) ? emit(v) : yamlText(emit(v)));
  // Tags written one item a line stay that way while they say the same things.
  const tagsKeptMultiline = values.tags !== undefined && oldLines.some((l, i) => owners[i] === 'tags' && !/^tags:/.test(l)) && readList(oldValues.tags ?? '').join('\n') === p.tags.join('\n');
  oldLines.forEach((line, i) => {
    const k = /^([A-Za-z][\w-]*):/.exec(line)?.[1];
    if (k && k in own) {
      seen.add(k);
      if (own[k] !== null) out.push(`${k}: ${ownText(own[k]!)}`);
    } else if (owners[i] && owners[i]! in own) {
      // (a list of the person's written one item a line: replaced by the value set)
    } else if (k && (KEYS as readonly string[]).includes(k)) {
      seen.add(k);
      // A property not changed keeps its line as written (its quotes, its spacing: "updated: 2026-10-16" stays).
      if (k === 'tags' && values.tags !== undefined && (tagsKeptMultiline || readList(unquote(line.slice(line.indexOf(':') + 1))).join('\n') === p.tags.join('\n'))) out.push(line);
      else if (k !== 'tags' && values[k] !== undefined && unquote(line.slice(line.indexOf(':') + 1)) === unquote(values[k]!)) out.push(line);
      else if (values[k] !== undefined) out.push(`${k}: ${values[k]}`);
      // A property written empty (`due: ""`: not set yet, not taken off) stays as it was.
      else if (/^:\s*(?:""|''\s*)?$/.test(line.slice(line.indexOf(':')))) out.push(line);
    } else if (owners[i] === 'tags' && tagsKeptMultiline) out.push(line);
    else if (!(owners[i] && (KEYS as readonly string[]).includes(owners[i]!))) out.push(line);
    // (a list of ours written one item a line is written again on the key's own line)
  });
  for (const k of KEYS) if (!seen.has(k) && values[k] !== undefined) out.splice(k === 'type' ? 0 : out.length, 0, `${k}: ${values[k]}`);
  for (const [k, v] of Object.entries(own)) if (!seen.has(k) && v !== null) out.push(`${k}: ${ownText(v)}`);

  const headingKey = (h: string) => h.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
  // An empty heading the file has stays, with its blank lines, until that section changes (5 Nov 2026, p22
  // fidelity: an empty ## Updates was dropped, breaking identical bytes). From the file as it was: each ##
  // heading whose lines to the next ## are all blank, with how many blank lines followed it.
  const emptyKnown = new Map<Section, number>();
  const emptyExtra = new Map<string, number>();
  if (previous) {
    const prevLines = String(previous).split(/\r?\n/);
    for (let i = 0; i < prevLines.length; i++) {
      const h = /^##\s+(.+?)\s*#*\s*$/.exec(prevLines[i]);
      if (!h) continue;
      const name = h[1].trim();
      const kind = ALIASES.find(([re]) => re.test(name))?.[1];
      let j = i + 1, blanks = 0, empty = true;
      while (j < prevLines.length && !/^##\s+.+/.test(prevLines[j])) {
        if (prevLines[j].trim() !== '') { empty = false; break; }
        blanks++;
        j++;
      }
      if (j >= prevLines.length && blanks > 0 && prevLines[prevLines.length - 1] === '' && String(previous).endsWith('\n')) blanks--;
      if (!empty) continue;
      if (kind) { if (!emptyKnown.has(kind)) emptyKnown.set(kind, blanks); }
      else { const k = headingKey(name); if (!emptyExtra.has(k)) emptyExtra.set(k, blanks); }
    }
  }
  const body: string[] = [`# ${emit(p.name) || 'Untitled project'}`, ''];
  // The words above the sections stay there: an introduction above ## Summary, or a summary written with no heading.
  if (p.intro?.trim()) body.push(p.intro.replace(/\s+$/, ''), '');
  const section = (kind: Section, text: string) => {
    if (!text.trim()) {
      const blanks = previous ? emptyKnown.get(kind) : undefined;
      if (blanks !== undefined) {
        body.push(`## ${p.headings?.[kind] ?? HEADINGS[kind]}`, ...Array(blanks).fill(''));
        return;
      }
      if (kind !== 'notes') return;
      // An empty Notes to write (emptied, or a new file's own): clean, one blank line. It pushed three before,
      // relying on the flattening below, which no longer runs for a file that was there.
      body.push(`## ${p.headings?.[kind] ?? HEADINGS[kind]}`, '');
      return;
    }
    // New text starts clean under its heading (5 Nov 2026: a first line carrying its group's heading after a remove,
    // move or reorder, or a body beginning with a blank, left "## H\n\n\n..." once the save stopped flattening; the
    // person's own blanks deeper in stay, and a blank straight after a heading was already written as one).
    body.push(`## ${p.headings?.[kind] ?? HEADINGS[kind]}`, '', text.replace(/^\n+/, '').replace(/\s+$/, ''), '');
  };
  // A list's lines, each with the lines written under it, then the section's other lines as they were. A line still
  // saying the same thing is written back as it was.
  const list = <T extends { more?: string; before?: string }>(kind: ProjectList, items: T[], line: (item: T) => string, head: string[] = []) => {
    const lines = items.length ? [...head, ...items.flatMap((x) => [...(x.before ? x.before.split('\n') : []), keptRaw(kind, x as Record<string, unknown>) ?? line(x), ...(x.more ? [x.more.replace(/\s+$/, '')] : [])])] : [];
    // The other lines start without a blank: a line the list cannot read keeps the blank before it, and the join
    // adds its own (5 Nov 2026, p23 fidelity: a second blank before a kept line, hidden by the flattening).
    const rest = p.rest?.[kind]?.replace(/^\n+/, '').replace(/\s+$/, '');
    section(kind, [lines.join('\n'), rest].filter(Boolean).join('\n\n'));
  };
  const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
  // The person's own sections where they were: each after the known section it followed. A section a caller replaced
  // with a new object of its own (heading and body only, as the former host app's save does) keeps the place it had in
  // the file as it was; only a section that wasn't there before goes after the known ones.
  const before = previous && p.extra.some((x) => !x.after) ? (orig?.extra ?? []) : [];
  const afterOf = (x: Project['extra'][number]) => x.after ?? before.find((b) => headingKey(b.heading) === headingKey(x.heading))?.after;
  const extraPush = (x: Project['extra'][number]) => {
    if (!x.body.trim()) {
      const blanks = previous ? emptyExtra.get(headingKey(x.heading)) : undefined;
      if (blanks !== undefined) {
        body.push(`## ${x.heading}`, ...Array(blanks).fill(''));
        return;
      }
      body.push(`## ${x.heading}`, '');
      return;
    }
    // As above: a body beginning with a blank starts clean (the checklist's first write did, until fixed beside this).
    body.push(`## ${x.heading}`, '', x.body.replace(/^\n+/, '').replace(/\s+$/, ''), '');
  };
  const extrasAfter = (kind: Section) => {
    for (const x of p.extra) if (afterOf(x) === kind) extraPush(x);
  };
  // The known sections in the file's own order; one it didn't have goes after the one before it in the usual order.
  const order: Section[] = (p.order ?? []).filter((k): k is Section => (ORDER as string[]).includes(k));
  for (const kind of ORDER) {
    if (order.includes(kind)) continue;
    const prev = ORDER.slice(0, ORDER.indexOf(kind)).reverse().find((k) => order.includes(k));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, kind);
  }
  for (const kind of order) {
    switch (kind) {
      case 'summary':
        if (p.summaryTop && !p.intro?.trim()) {
          if (p.summary.trim()) body.push(p.summary.trim(), '');
        } else section(kind, p.summary.trim());
        break;
      case 'next':
        list(kind, p.next, (n) => {
          // Who and when as they were read: the words after the dash as written; changed: written who · by when. A date
          // the file already holds keeps its shape ("16 Oct 2026", never ISO from a reworded step).
          const when = keepStyle(n.when, 'next');
          const asRead = n.tail && (n.tail.who ?? '') === (n.who ?? '') && (n.tail.when ?? '') === (when ?? '') && (n.who || when);
          const tail = asRead ? n.tail!.text : [n.who ? emit(n.who) : '', when ? `by ${emit(when)}` : ''].filter(Boolean).join(' · ');
          return `- [${n.done ? 'x' : ' '}] ${emit(n.what)}${tail ? ` — ${tail}` : ''}`;
        });
        break;
      case 'dates':
        // A blank status stays blank in the person's own table (the contract's | Date | Milestone | Status |).
        // Unchanged dates keep the head they had, if any: list-form dates stay headless, never gaining a table.
        const datesHead = datesChanged ? (getHeadRaw(orig, 'dates') ?? [`| ${(p.datesHead ?? ['When', 'What', 'Status']).map((h) => cell(h)).join(' | ')} |`, '| --- | --- | --- |']) : (getHeadRaw(orig, 'dates') ?? []);
        list(kind, p.dates as (ProjectDate & { more?: string })[], (d) => `| ${cell(keepStyle(d.when, 'dates') ?? '')} | ${cell(d.what)} | ${cell(d.status ?? '') || (p.datesHead ? '' : '—')} |`.replace(/\| {2}(?=\|)/g, '| '), datesHead);
        break;
      case 'people':
        list(kind, p.people, (x) => `- **${emit(x.name)}**${x.role ? ` — ${emit(x.role)}` : ''}`);
        break;
      case 'risks':
        if (p.risksHead?.length) {
          const head = p.risksHead;
          list(kind, p.risks, (r) => `| ${riskRow(head, r.closedOn ? { ...r, closedOn: keepStyle(r.closedOn, 'risks') } : r).map((c) => emit(c).replace(/\|/g, '\\|')).join(' | ')} |`.replace(/\| {2}(?=\|)/g, '| '), getHeadRaw(orig, 'risks') ?? [`| ${head.map((h) => cell(h)).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`]);
        } else list(kind, p.risks, (r) => `- ${r.level ? `**${cap(emit(r.level))}** — ` : ''}${emit(r.what)}${r.closed ? (keepStyle(r.closedOn, 'risks') ? ` *Closed:* ${emit(keepStyle(r.closedOn, 'risks')!)}` : ' *Closed.*') : ''}`);
        break;
      case 'decisions':
        list(kind, p.decisions, (d) => `- ${keepStyle(d.date, 'decisions') ? `**${emit(keepStyle(d.date, 'decisions')!)}** — ` : ''}${emit(d.what).replace(/[.!]+$/, '')}.${d.why ? ` *Why:* ${emit(d.why)}` : ''}`);
        break;
      case 'updates':
        list(kind, p.updates, (u) => `- ${keepStyle(u.date, 'updates') ? `**${emit(keepStyle(u.date, 'updates')!)}** — ` : ''}${emit(u.what)}${u.from ? ` *From:* ${emit(u.from)}` : ''}`);
        break;
      case 'documents':
        // A line naming its notes by their links ("[[A]] and [[B]] — …") is written as it was, never as a file's path.
        list(kind, p.documents, (d) => `- ${d.link && d.link.slice(2).split(/[|\]]/)[0].trim() === d.path ? d.link : /\[\[[^\]]+\]\]/.test(d.path) ? emit(d.path) : `\`${emit(d.path).replace(/`/g, "'")}\``}${d.what ? ` — ${emit(d.what)}` : ''}`);
        break;
      case 'notes':
        // The person's own place in the file, there from the start; a file written without one isn't given an empty one
        // on every change (it stays as it was until there are notes to keep).
        if (p.notes.trim() || !p.order || p.order.includes('notes')) section(kind, p.notes);
        break;
    }
    extrasAfter(kind);
  }
  for (const x of p.extra) if (!afterOf(x) || !(ORDER as string[]).includes(afterOf(x)!)) extraPush(x);
  // The file's own shape stays: its properties close as they did ("..." included), its line ends stay Windows where
  // they were (a save then touches one line, not every line), and a missing last newline stays missing (5 Nov 2026,
  // data safety: a CRLF file came back all-LF, and "..." properties were read as body text). Every line above is built
  // without carriage returns, so the one conversion at the end is safe. The person's own spacing stays in a file that
  // was there; a new file still gets clean spacing (5 Nov 2026, p22 fidelity: the flattening took two blank lines in
  // Notes to one on every save).
  const joined = body.join('\n');
  const spaced = previous ? joined : joined.replace(/\n{3,}/g, '\n\n');
  let text = `---\n${out.join('\n')}\n${previous ? front.close : '---'}\n${frontGap}${spaced.replace(/\s+$/, '')}\n`;
  if (previous && previous.includes('\r\n')) text = text.replace(/\n/g, '\r\n');
  if (previous && !previous.endsWith('\n')) text = text.replace(/\r?\n$/, '');
  return text;
}

export function emptyProject(name: string): Project {
  return { name, tags: [], summary: '', next: [], dates: [], people: [], risks: [], decisions: [], updates: [], documents: [], notes: '', extra: [] };
}

/** Whether a note's properties say it is a project: `type: project` in any case, quoted or [[linked]], under `type:`
 *  or `Type:` (5 Nov 2026, u3 moving-in: `type: Project` counted in records but not in Projects or Today — one rule, one
 *  place, every door reads this). */
export function isProjectProps(props: Record<string, unknown> | undefined): boolean {
  const raw = props?.type ?? (props as Record<string, unknown> | undefined)?.Type;
  if (typeof raw !== 'string') return false;
  const id = raw.trim().replace(/^\[\[|\]\]$/g, '').replace(/^["']|["']$/g, '').trim().toLowerCase();
  return id === 'project';
}

/** Whether a note is a project file (by its text): the same rule as isProjectProps, read from the raw front matter. */
export const isProjectText = (text: string) => /^---\r?\n[\s\S]*?^type:\s*["']?(?:\[\[)?project(?:\]\])?["']?\s*$/mi.test(repairProjectText(String(text ?? '').slice(0, 4000)).text);

/** Whether a project reads as worked, not just claimed (5 Nov 2026, u3 moving-in): one next step, a due date or key\n *  date, a live status, or a health word. The blank-file line, not liveliness — a stall is honest, an empty claim is\n *  offered back ("Project files to check"). */
export function hasProjectSubstance(p: Project): boolean {
  if (!p) return false;
  if (p.next.length > 0 || p.dates.length > 0) return true;
  if (p.due && p.due.trim()) return true;
  if (p.health && p.health.trim()) return true;
  const status = (p.status ?? '').trim().toLowerCase();
  return ['active', 'on hold', 'on track', 'at risk', 'off track', 'done', 'complete', 'completed'].includes(status);
}

/** Taking a note's project claim back: the `type: project` line out of its front matter (null when it claims\n *  nothing), the note otherwise untouched — an emptied block goes with the line. */
export function unclaimProjectText(text: string): string | null {
  const lines = String(text ?? '').split('\n');
  if (lines[0]?.replace(/\r$/, '') !== '---') return null;
  let end = -1;
  for (let i = 1; i < Math.min(lines.length, 60); i++) {
    if ((lines[i] ?? '').replace(/\r$/, '') === '---') { end = i; break; }
  }
  if (end < 0) return null;
  const drops: number[] = [];
  for (let i = 1; i < end; i++) {
    const raw = (lines[i] ?? '').replace(/\r$/, '');
    const m = /^\s*["']?type["']?\s*:\s*(.+?)\s*$/i.exec(raw);
    if (!m) continue;
    const id = m[1].replace(/\s+#.*$/, '').trim().replace(/^\[\[|\]\]$/g, '').replace(/^["']|["']$/g, '').trim().toLowerCase();
    if (id === 'project') drops.push(i);
  }
  if (!drops.length) return null;
  const drop = new Set(drops);
  const inner = lines.slice(1, end).filter((_, k) => !drop.has(k + 1));
  const rest = lines.slice(end + 1);
  if (inner.every((l) => !l.replace(/\r$/, '').trim())) {
    let cut = 0;
    while (cut < rest.length && !rest[cut].replace(/\r$/, '').trim()) cut++;
    return rest.slice(cut).join('\n');
  }
  return [...lines.slice(0, 1), ...inner, ...lines.slice(end)].join('\n');
}

/** The file Making a folder a project writes: blank but for the claim, in the folder's own name. */
export function claimFolderText(name: string): string {
  return `---\ntype: project\n---\n# ${String(name ?? '').trim()}\n`;
}

/** Whether a project file owns its folder: kept as `<Folder>/<Folder>.md` (any case), the documented shape — the
 *  one project-owner confidence (5 Nov 2026, u3 moving-in: a coincidental `type: project` note claimed its whole
 *  folder, pulling unrelated notes' tasks onto its page). Only an owned folder files notes under its project;
 *  anything else files by deliberate signals (a `project:` property, a link). */
export function projectOwnsFolder(projectPath: string): boolean {
  const parts = String(projectPath ?? '').split('/');
  if (parts.length < 2) return false;
  const stem = parts[parts.length - 1].replace(/\.md$/i, '').trim().toLowerCase();
  const folder = parts[parts.length - 2].trim().toLowerCase();
  return !!stem && stem === folder;
}

/** The former host app's key for a project in a folder on this PC (its vault-notes): on Windows, lower case with forward
slashes. */
export function projectKey(folder: string, windows = /^[A-Za-z]:[\\/]|^\\\\/.test(folder)): string {
  let r = folder.replace(/[\\/]+$/, '');
  if (windows) r = r.toLowerCase().replace(/\\/g, '/');
  return `local:${r}`;
}

/** A name Windows takes for a folder or note. */
export function safeName(text: string, max = 80): string {
  const name = cleanFileName(text, '', max, 'project').replace(/^[. ]+/, '');
  return name || 'Untitled project';
}

/** The notes' own projects folder ("Projects", or one numbered as people number their areas: "02 Projects"). */
export function projectsFolder(topFolders: string[]): string {
  const names = topFolders.filter((n) => /^(?:\d+[\s._-]*)?projects$/i.test(n));
  return names.find((n) => n === 'Projects') ?? names.sort()[0] ?? 'Projects';
}

/** Where a project's file goes: Projects/<Name>/<Name>.md. */
export const projectPath = (root: string, name: string) => `${root}/${safeName(name)}/${safeName(name)}.md`;

// ── Changes made by hand on the project page (and by anything else that edits one fact at a time) ─────────────────────
// One way in: the page sends a ProjectEdit, Ironleaf's main side reads the file, applies it here, and writes the file
// back with serializeProject (which keeps every line it doesn't understand). Each change says, in words, what it did.

/** The facts set one at a time. */
export type ProjectField = 'name' | 'status' | 'health' | 'progress' | 'owner' | 'started' | 'due' | 'repository' | 'summary' | 'notes' | 'layout';

export type ProjectEdit =
  | { kind: 'set'; field: ProjectField; value: string | number | null }
  | { kind: 'tags'; tags: string[] }
  | { kind: 'add'; list: ProjectList; item: Record<string, unknown>; at?: number }
  /** Changes some of a line's parts (a part given as null or '' is taken off). */
  | { kind: 'change'; list: ProjectList; index: number; item: Record<string, unknown> }
  | { kind: 'remove'; list: ProjectList; index: number }
  | { kind: 'move'; list: ProjectList; from: number; to: number }
  /** A file in the project's folder pinned (listed in Documents) or not. */
  | { kind: 'pin'; path: string; pinned: boolean; what?: string }
  /** What a file is (pins it when it isn't yet: descriptions live in Documents). */
  | { kind: 'describe'; path: string; what: string }
  /** A section of the person's own (kept as written) changed. */
  | { kind: 'extra'; index: number; body: string }
  /** A property of the person's own (go_live, target_weight, register_of…), set or taken off (null). */
  | { kind: 'prop'; key: string; value: string | number | null }
  /** A section of the person's own, by its heading (a layout's Workstreams, Run sheet…), changed or added at the end;
   *  `words` says what changed, for its message ("Set Northgate’s status to At risk."). */
  | { kind: 'section'; heading: string; body: string; words?: string }
  /** A list's lines put in a new order: `order[i]` is the line that goes i-th (key dates by their dates, say). */
  | { kind: 'order'; list: ProjectList; order: number[] }
  /** The project's lifecycle stage (src/shared/project-hub.ts: idea, planning, active, closing, done), written as
   *  `stage:` (or `lifecycle:` when `stage:` holds another kind of stage), its status following where it must. */
  | { kind: 'stage'; stage: string; key?: 'stage' | 'lifecycle' }
  // Kept for older windows and callers.
  | { kind: 'next-toggle'; index: number }
  | { kind: 'next-add' | 'update-add'; text: string };

/** What each list's lines are made of: [part, longest], the first part being the one a line can't be without. */
const PARTS: Record<ProjectList, [string, number][]> = {
  next: [['what', 400], ['who', 300], ['when', 300], ['more', 2000]],
  dates: [['what', 300], ['when', 60], ['status', 60]],
  people: [['name', 120], ['role', 200]],
  risks: [['what', 400], ['level', 20], ['closedOn', 40], ['owner', 120], ['status', 60]],
  decisions: [['what', 400], ['date', 40], ['why', 400]],
  updates: [['what', 600], ['date', 40], ['from', 300]],
  documents: [['path', 300], ['what', 300], ['more', 2000]],
};
const NOUN: Record<ProjectList, string> = { next: 'next step', dates: 'key date', people: 'person', risks: 'risk', decisions: 'decision', updates: 'update', documents: 'document' };
const FIELD_WORDS: Record<ProjectField, string> = { name: 'name', status: 'status', health: 'health', progress: 'progress', owner: 'owner', started: 'start date', due: 'due date', repository: 'code’s place', summary: 'summary', notes: 'notes', layout: 'layout' };
export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
/** The layouts a project can have (src/shared/layouts.ts draws them), by the word written in `layout:`. */
const LAYOUT_NAMES: Record<string, string> = { programme: 'Programme', site: 'Site or event', register: 'Register', fitness: 'Fitness', wellbeing: 'Wellbeing', venture: 'Venture' };
export const LISTS = Object.keys(PARTS) as ProjectList[];

const samePath = (a: string, b: string) => a.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase() === b.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
// Whole words: change words wrap where they show (t207 pass 2).
const quoteWords = (s: string, _max = 48) => `“${s}”`;

/** A line for a list from what was sent: only its own parts, cleaned; null when the part it can't be without is missing. */
function lineOf(list: ProjectList, raw: Record<string, unknown>, base: Record<string, unknown> = {}): Record<string, unknown> | null {
  const out: Record<string, unknown> = { ...base };
  for (const [key, max] of PARTS[list]) {
    if (!(key in raw)) continue;
    const v = raw[key];
    // A step's detail keeps its lines (indented under the step when written), each tidied.
    const more = () => String(v ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).map((l) => `  ${l}`).join('\n').slice(0, max);
    const text = key === 'more' ? more() : v === null || v === undefined ? '' : clean(v, max);
    if (text) out[key] = key === 'level' ? text.toLowerCase() : text;
    else delete out[key];
  }
  if (list === 'next' && 'done' in raw) out.done = !!raw.done;
  if (list === 'next' && typeof out.done !== 'boolean') out.done = false;
  if (list === 'risks' && 'closed' in raw) {
    if (raw.closed) out.closed = true;
    else {
      delete out.closed;
      delete out.closedOn;
    }
  }
  if (list === 'risks' && out.level && !/^(low|medium|high|critical)$/.test(String(out.level))) delete out.level;
  // A risk's Status written by hand (a risks table's column): "Closed …" closes it, anything else opens it; emptied, the cell is left empty.
  if (list === 'risks' && 'status' in raw) {
    const status = String(out.status ?? '');
    out.status = status;
    if (CLOSED_WORD.test(status)) {
      out.closed = true;
      const on = status.replace(CLOSED_WORD, '').replace(/^[\s:,—–-]+/, '').trim();
      if (on) out.closedOn = on;
    } else {
      delete out.closed;
      delete out.closedOn;
    }
  }
  const must = PARTS[list][0][0];
  // A key date may have no date yet (a milestone not yet dated): its `what` is the part it can't be without.
  if (!out[must]) return null;
  if (list === 'dates' && out.when === undefined) out.when = '';
  return out;
}

/** A line about to leave its place hands the lines written above it (a group's heading) to the line after it, else to
 *  the section's other lines, so the heading stays where it was. */
function handOnBefore(p: Project, list: ProjectList, i: number): void {
  const items = p[list] as { before?: string }[];
  const before = items[i]?.before;
  if (!before) return;
  items[i] = { ...items[i] };
  delete items[i].before;
  const next = items[i + 1];
  if (next) items[i + 1] = { ...next, before: next.before ? `${before.replace(/\n*$/, '')}\n${next.before.startsWith('\n') ? '' : '\n'}${next.before}` : before };
  else {
    p.rest ??= {};
    p.rest[list] = [before.trim(), p.rest[list]].filter(Boolean).join('\n\n');
  }
}

/** A project line's identity for find-before-write: its fields tidied (case, spacing and articles folded, as
 *  meeting actions compare in src/shared/meetings.ts sameWhat), keys in order. */
function lineKey(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (typeof x === 'string') return x.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, val]) => val !== undefined && val !== null && val !== '').sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, norm(val)]));
    return x;
  };
  return JSON.stringify(norm(v));
}

/**
 * Applies one change to a project, as the person made it. `today` is the date as written in the file's lines
 * ("17 Oct 2026"). Returns what was done, in words ("Added a risk."). Throws, in words, when the change can't be made.
 */
export function applyProjectEdit(p: Project, edit: ProjectEdit, today = ''): string {
  const e = (edit && typeof edit === 'object' ? edit : {}) as ProjectEdit;
  const listOf = (name: unknown): ProjectList => {
    if (typeof name === 'string' && (LISTS as string[]).includes(name)) return name as ProjectList;
    throw new Error('That change isn’t one Ironleaf knows.');
  };
  const at = (list: ProjectList, index: unknown) => {
    const items = p[list] as unknown[];
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= items.length) throw new Error('That line isn’t in the project any more.');
    return index;
  };
  switch (e.kind) {
    case 'set': {
      const field = e.field;
      if (!(field in FIELD_WORDS)) throw new Error('That change isn’t one Ironleaf knows.');
      if (field === 'progress') {
        const n = typeof e.value === 'number' ? e.value : e.value === null || e.value === '' ? NaN : Number(String(e.value).replace(/%$/, ''));
        p.progress = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : undefined;
        return p.progress === undefined ? 'Cleared the progress.' : `Set progress to ${p.progress}%.`;
      }
      if (field === 'summary' || field === 'notes') {
        const text = typeof e.value === 'string' ? e.value.replace(/\r\n/g, '\n').replace(/\s+$/, '').slice(0, 20000) : '';
        p[field] = field === 'summary' ? text.trim() : text;
        return `Changed the ${FIELD_WORDS[field]}.`;
      }
      const text = typeof e.value === 'string' || typeof e.value === 'number' ? clean(e.value, 300) : '';
      if (field === 'layout') {
        const id = text.toLowerCase();
        if (id && !LAYOUT_NAMES[id]) throw new Error('That layout isn’t one Ironleaf knows.');
        p.layout = id || undefined;
        return id ? `Set the layout to ${LAYOUT_NAMES[id]}.` : 'Back to the standard page.';
      }
      if (field === 'name') {
        // A typed name past 120 letters is fitted to leading words, said aloud (t207 pass 2: it cut mid-word,
        // silently — the renameConversation style wrapper).
        const fit = fitTypedName(e.value, 120, false);
        if (!fit.name) throw new Error('A project needs a name.');
        p.name = fit.name;
        return `Renamed the project to ${quoteWords(fit.name)}.${fit.cut ? ' That name was shortened to fit.' : ''}`;
      }
      p[field] = text || undefined;
      if (field === 'status' || field === 'health') return text ? `Set ${field} to ${text.charAt(0).toUpperCase()}${text.slice(1)}.` : `Cleared the ${field}.`;
      return text ? `Changed the ${FIELD_WORDS[field]}.` : `Cleared the ${FIELD_WORDS[field]}.`;
    }
    case 'tags': {
      const seen = new Set<string>();
      p.tags = (Array.isArray(e.tags) ? e.tags : [])
        .map((t) => clean(t, 40).replace(/^#/, '').replace(/[,[\]]/g, ' ').trim())
        .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
        .slice(0, 30);
      return 'Changed the tags.';
    }
    case 'add': {
      const list = listOf(e.list);
      const raw = (e.item && typeof e.item === 'object' ? e.item : {}) as Record<string, unknown>;
      const line = lineOf(list, list === 'updates' && !('date' in raw) && today ? { ...raw, date: today } : list === 'risks' && raw.closed && !raw.closedOn && today ? { ...raw, closedOn: today } : raw);
      if (!line) throw new Error(`Write the ${list === 'dates' ? 'what happens then' : NOUN[list]} first.`);
      const items = p[list] as unknown[];
      // Updates are newest first; everything else goes at the end (or where it was asked for: an undone removal).
      const where = typeof e.at === 'number' && Number.isInteger(e.at) ? Math.max(0, Math.min(items.length, e.at)) : list === 'updates' ? 0 : items.length;
      if (list === 'documents' && p.documents.some((d) => samePath(d.path, String(line.path)))) return 'That file is pinned already.';
      // The same line again (a retry, a double tap, a meeting filed twice) is not written twice (9.2 fresh eyes).
      if (items.some((x) => lineKey(x) === lineKey(line))) return `That ${NOUN[list]} is there already.`;
      items.splice(where, 0, line);
      return `Added ${list === 'updates' ? 'an' : 'a'} ${NOUN[list]}.`;
    }
    case 'change': {
      const list = listOf(e.list);
      const i = at(list, e.index);
      const items = p[list] as unknown as Record<string, unknown>[];
      const raw = (e.item && typeof e.item === 'object' ? e.item : {}) as Record<string, unknown>;
      const was = items[i];
      const closing = list === 'risks' && raw.closed === true && !was.closed;
      const line = lineOf(list, closing && !('closedOn' in raw) && today ? { ...raw, closedOn: today } : raw, was);
      if (!line) throw new Error(`A ${NOUN[list]} can’t be empty: remove it instead.`);
      items[i] = line;
      if (list === 'next' && 'done' in raw && Object.keys(raw).length === 1) return line.done ? `Ticked off ${quoteWords(String(line.what))}.` : `Put ${quoteWords(String(line.what))} back on the list.`;
      if (list === 'risks' && 'closed' in raw && Object.keys(raw).length === 1) return line.closed ? 'Closed a risk.' : 'Reopened a risk.';
      return `Changed a ${NOUN[list]}.`;
    }
    case 'remove': {
      const list = listOf(e.list);
      const i = at(list, e.index);
      handOnBefore(p, list, i);
      (p[list] as unknown[]).splice(i, 1);
      return list === 'documents' ? 'Unpinned a document.' : `Removed ${list === 'updates' ? 'an' : 'a'} ${NOUN[list]}.`;
    }
    case 'move': {
      const list = listOf(e.list);
      const from = at(list, e.from);
      const items = p[list] as unknown[];
      const to = typeof e.to === 'number' && Number.isInteger(e.to) ? Math.max(0, Math.min(items.length - 1, e.to)) : from;
      if (to === from) return 'Nothing moved.';
      // A heading over its group stays where it was: the line moved leaves it to the next, and takes the one where it lands.
      handOnBefore(p, list, from);
      const [item] = items.splice(from, 1) as { before?: string }[];
      delete item.before;
      // `to` is in the list as it was: past the removal, what was there sits one earlier when moving down.
      const there = items[from < to ? to - 1 : to] as { before?: string } | undefined;
      if (there?.before) {
        item.before = there.before;
        delete there.before;
      }
      items.splice(to, 0, item);
      return `Moved a ${NOUN[list]}.`;
    }
    case 'pin': {
      const path = clean(e.path, 300).replace(/\\/g, '/');
      if (!path) throw new Error('Which file?');
      const i = p.documents.findIndex((d) => samePath(d.path, path));
      const name = quoteWords(path.split('/').pop() ?? path);
      if (e.pinned) {
        if (i >= 0) return `${name} is pinned already.`;
        const what = clean(e.what ?? '', 300);
        p.documents.push({ path, ...(what ? { what } : {}) });
        return `Pinned ${name}.`;
      }
      if (i < 0) return `${name} isn’t pinned.`;
      p.documents.splice(i, 1);
      return `Unpinned ${name}.`;
    }
    case 'describe': {
      const path = clean(e.path, 300).replace(/\\/g, '/');
      if (!path) throw new Error('Which file?');
      const what = clean(e.what, 300);
      const i = p.documents.findIndex((d) => samePath(d.path, path));
      const name = quoteWords(path.split('/').pop() ?? path);
      if (i < 0) {
        if (!what) return 'Nothing changed.';
        p.documents.push({ path, what });
        return `Described and pinned ${name}.`;
      }
      const doc = p.documents[i];
      if (what) doc.what = what;
      else delete doc.what;
      return `Described ${name}.`;
    }
    case 'extra': {
      if (typeof e.index !== 'number' || !p.extra[e.index]) throw new Error('That section isn’t in the project any more.');
      p.extra[e.index].body = String(e.body ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '').slice(0, 50000);
      return `Changed ${quoteWords(p.extra[e.index].heading)}.`;
    }
    case 'prop': {
      const key = String(e.key ?? '').trim();
      if (!/^[A-Za-z][\w-]{0,60}$/.test(key) || (KEYS as readonly string[]).includes(key)) throw new Error('That property can’t be set here.');
      const value = e.value === null || e.value === undefined ? '' : clean(e.value, 300);
      p.own = { ...(p.own ?? {}), [key]: value || null };
      return value ? `Set ${key.replace(/[_-]+/g, ' ')} to ${quoteWords(value)}.` : `Took off ${key.replace(/[_-]+/g, ' ')}.`;
    }
    case 'section': {
      const heading = clean(e.heading, 120).replace(/^#+\s*/, '');
      if (!heading) throw new Error('Which section?');
      const body = String(e.body ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '').slice(0, 50000);
      const key = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
      const at = p.extra.findIndex((x) => key(x.heading) === key(heading));
      const said = typeof e.words === 'string' ? clean(e.words, 160) : '';
      if (at >= 0) {
        p.extra[at].body = body;
        return said || `Changed ${quoteWords(p.extra[at].heading)}.`;
      }
      p.extra.push({ heading, body });
      return said || `Added ${quoteWords(heading)}.`;
    }
    case 'order': {
      const list = listOf(e.list);
      const items = p[list] as unknown[];
      const order = Array.isArray(e.order) ? e.order : [];
      if (order.length !== items.length || [...order].sort((a, b) => a - b).some((x, i) => x !== i)) throw new Error('That line isn’t in the project any more.');
      if (order.every((x, i) => x === i)) return 'Nothing moved.';
      const was = [...items];
      order.forEach((from, i) => (items[i] = was[from]));
      return list === 'dates' ? 'Put the key dates in date order.' : `Put the ${NOUN[list]}s in a new order.`;
    }
    case 'stage': {
      const stage = String(e.stage ?? '').trim().toLowerCase();
      const words: Record<string, string> = { idea: 'Idea', planning: 'Planning', active: 'Active', closing: 'Closing', done: 'Done' };
      if (!words[stage]) throw new Error('That stage isn’t one Ironleaf knows.');
      // `stage:`, or `lifecycle:` when the page says `stage:` holds another kind of stage (a venture's "building").
      const key = e.key === 'lifecycle' ? 'lifecycle' : 'stage';
      p.own = { ...(p.own ?? {}), [key]: stage };
      if (stage === 'idea' || stage === 'planning' || stage === 'done') p.status = stage;
      else if (!/on hold/i.test(p.status ?? '')) p.status = 'active';
      return `Moved the project to ${words[stage]}.`;
    }
    case 'next-toggle':
      return applyProjectEdit(p, { kind: 'change', list: 'next', index: e.index, item: { done: !p.next[at('next', e.index)].done } }, today);
    case 'next-add':
      return applyProjectEdit(p, { kind: 'add', list: 'next', item: { what: e.text } }, today);
    case 'update-add':
      return applyProjectEdit(p, { kind: 'add', list: 'updates', item: { what: e.text } }, today);
    default:
      throw new Error('That change isn’t one Ironleaf knows.');
  }
}

/** A short fingerprint of a file's text: an edit made on what the page showed is refused when the file has changed since. */
export function textVersion(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${h.toString(36)}`;
}

/**
 * The open project as an assistant is told it (2 Nov 2026, seams O5: the side chat knew the folder only, the former
 * host app the summary, next steps, risks and pages): one line each, capped short for a system prompt, '' when it
 * says nothing. `pages` are the project's pinned Documents and the notes joined to it, as one-line names most
 * telling first (the caller finds them; only the first few are kept). Shared with the former host app through this
 * module, so both sides brief from the same words.
 */
export function projectContext(p: Project, pages: string[]): string {
  const lines: string[] = [];
  const summary = p.summary.replace(/\s+/g, ' ').trim().slice(0, 400);
  if (summary) lines.push(`Summary: ${summary}`);
  const open = p.next.filter((n) => !n.done);
  if (open.length) {
    const steps = open.slice(0, 5).map((n) => `${n.what}${n.who ? ` — ${n.who}` : ''}${n.when ? ` (${n.when})` : ''}`);
    lines.push(`Next: ${steps.join('; ')}${open.length > 5 ? `; and ${open.length - 5} more` : ''}`);
  }
  const risks = p.risks.filter((r) => !r.closed);
  if (risks.length) {
    lines.push(`Risks: ${risks.slice(0, 3).map((r) => `${r.level ? `${r.level}: ` : ''}${r.what}`).join('; ')}${risks.length > 3 ? `; and ${risks.length - 3} more` : ''}`);
  }
  const kept = pages.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (kept.length) lines.push(`Pages: ${kept.slice(0, 8).join('; ')}${kept.length > 8 ? `; and ${kept.length - 8} more` : ''}`);
  return lines.join('\n');
}
